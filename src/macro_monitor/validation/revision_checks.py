"""REV-01..05, COMP-01..04 and DB-04/DB-05 for ordinary groups (T29, ADR-007, ADR-017).

Two layers. The pure layer (``tally_series``, ``check_rev_*``, ``check_comp_*``, ``check_db_05``)
takes plain inputs and has no I/O. The database layer (``OrdinaryChecks``) reads staging and
curated rows and exposes the three loader seams: ``validate`` (pre-load, may block the object),
``insert`` (wraps the real insert seam and stores the check family and counts in
``raw_load.detail``) and ``post_checks`` (DB-04 inside the load transaction).

The revision check family is chosen once per object by the group flags (``reestimating`` ->
REV-06, ``edition_ordered`` -> REV-07, else REV-01) and stored in ``raw_load.detail``.
REV-01, REV-06 (T46) and REV-07 (T48) are evaluated (REV-06/07 in
``OrdinaryChecks._family_results``).
Materiality is the loader's half-unit rule (``storage.compare``) plus the group materiality; for
ratio-dimension units ``materiality_abs`` alone decides (the relative term is not applied).
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, localcontext
from typing import Any

import psycopg

from macro_monitor.storage.compare import Action, ComparePolicy, Stored, decide
from macro_monitor.storage.loader import InsertFn, LoadContext, LoadCounts, QueuedObject
from macro_monitor.storage.series_create import Problem, find_series, record_drift, split_ref
from macro_monitor.validation.checks import (
    DEFAULT_THRESHOLDS,
    CheckResult,
    Severity,
    Thresholds,
    _result,
    _robust_sd,
)

log = logging.getLogger(__name__)

IMPORT_LABEL = "archive_import"
FAMILY_REV01, FAMILY_REV06, FAMILY_REV07 = "REV-01", "REV-06", "REV-07"


def revision_family(reestimating: bool, edition_ordered: bool) -> str:
    """The check family of an object, chosen once by the group flags (mutually exclusive)."""
    if reestimating:
        return FAMILY_REV06
    return FAMILY_REV07 if edition_ordered else FAMILY_REV01


# ---------------------------------------------------------------------------------------
# pure layer
# ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class StagedRow:
    start: date
    value: Decimal | None
    status: str
    label: str | None = None


@dataclass
class Tally:
    """Counts of one series (or, summed, of one dataset or object)."""

    existing_keys: int = 0  # staged non-PROJ keys with a stored comparison row
    material: int = 0  # revisions under the comparison rule AND the group materiality
    below_materiality: int = 0  # revisions under the rule but within the group materiality
    noise: int = 0  # differences suppressed by the comparison rule (REV-05)
    inserts: int = 0  # rows the loader would insert (DB-05)
    new_rows: int = 0
    proj_to_observed: int = 0  # REV-04
    deep: int = 0  # REV-03
    large: list[str] = field(default_factory=list)  # REV-02 "ref|period" strings
    precision_fallback: int = 0

    def add(self, o: Tally) -> None:
        for f in (
            "existing_keys", "material", "below_materiality", "noise", "inserts", "new_rows",
            "proj_to_observed", "deep", "precision_fallback",
        ):  # fmt: skip
            setattr(self, f, getattr(self, f) + getattr(o, f))
        self.large.extend(o.large)

    @property
    def share(self) -> float:
        return self.material / self.existing_keys if self.existing_keys else 0.0


def is_material(
    old: Decimal | None, new: Decimal | None, policy: ComparePolicy, ratio_unit: bool
) -> bool:
    """Group materiality (REV-01 clause b); the rule clause (a) is the comparison decision."""
    if old is None or new is None:
        return True  # value <-> missing is a status change: always material
    rel = Decimal(0) if ratio_unit else policy.materiality_rel * abs(old)
    with localcontext() as ctx:
        ctx.prec = 80
        return abs(new - old) > max(policy.materiality_abs, rel)


def _depth_cutoff(frequency: str, fetched_at: datetime, t: Thresholds) -> date:
    years = t.rev_depth_years_a if frequency == "A" else t.rev_depth_years_mq
    try:
        return fetched_at.date().replace(year=fetched_at.year - years)
    except ValueError:  # 29 February
        return fetched_at.date().replace(year=fetched_at.year - years, day=28)


def tally_series(
    ref: str,
    rows: Sequence[StagedRow],
    prior: Mapping[date, Stored],
    prior_by_label: Mapping[tuple[date, str], Stored],
    policy: ComparePolicy,
    published_decimals: int | None,
    *,
    ratio_unit: bool,
    frequency: str,
    fetched_at: datetime,
    history: Callable[[], Sequence[float]] = lambda: (),
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> Tally:
    """Classify every staged row of one series exactly as the loader will (``compare.decide``)."""
    pol = ComparePolicy(
        policy.compare_mode, policy.fixed_decimals, policy.rel_epsilon, policy.snapshot_mode,
        policy.materiality_abs, policy.materiality_rel, ratio_unit,
    )  # fmt: skip
    t = Tally()
    cutoff = _depth_cutoff(frequency, fetched_at, thresholds)
    sd_cache: list[float] | None = None
    for r in rows:
        stored = prior.get(r.start)
        ref_row = stored
        proj = r.status == "PROJ"
        if proj and r.label is not None:
            ref_row = prior_by_label.get((r.start, r.label))
        if stored is not None and not proj:
            t.existing_keys += 1
        dec = decide(ref_row, r.value, r.status, pol, published_decimals)
        if dec.fallback:
            t.precision_fallback += 1
        if dec.action is Action.EQUAL:
            if (
                ref_row
                and ref_row.value is not None
                and r.value is not None
                and ref_row.value != r.value
            ):
                t.noise += 1
            continue
        if ref_row is None:
            t.inserts += 1
            t.new_rows += 1
            continue
        if ref_row.value_status == "PROJ" and r.status != "PROJ":
            t.proj_to_observed += 1  # REV-04
        if proj:
            t.inserts += 1  # new edition rows are never revised keys (REV-01/06/07)
            continue
        if dec.action is Action.INSERT:
            t.inserts += 1
        if dec.action is Action.BELOW_TOL or not is_material(
            ref_row.value, r.value, pol, ratio_unit
        ):
            t.below_materiality += 1
            continue
        t.material += 1
        if r.start < cutoff:
            t.deep += 1
        old, new = ref_row.value, r.value
        if old is not None and new is not None:
            diff = abs(float(new - old))
            big = old != 0 and diff / abs(float(old)) > thresholds.rev_relative
            if not big:
                if sd_cache is None:
                    sd_cache = list(history())
                if len(sd_cache) >= thresholds.rev_min_history:
                    sd = _robust_sd(sd_cache)
                    big = sd > 0 and diff > thresholds.rev_robust_sd * sd
            if big:
                t.large.append(f"{ref}|{r.start}")
    return t


def check_rev_01(
    by_dataset: Mapping[str, Tally],
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
    *,
    accepted_event: int | None = None,
) -> CheckResult:
    """Mass revision: any dataset with > 20 % of its existing keys materially revised."""
    worst, worst_ds = 0.0, ""
    for ds, t in sorted(by_dataset.items()):
        if t.share > worst:
            worst, worst_ds = t.share, ds
    over = worst > thresholds.rev_mass_share
    detail: dict[str, object] = {
        "datasets": {
            ds: {"existing_keys": t.existing_keys, "material": t.material, "share": t.share}
            for ds, t in sorted(by_dataset.items())
        }
    }
    if over and accepted_event is not None:
        detail["accepted_drift_event"] = accepted_event
        over = False
    return _result(
        "REV-01", not over, Severity.ERROR, metric=worst, threshold=thresholds.rev_mass_share,
        subject=worst_ds or None, detail=detail,
    )  # fmt: skip


def check_rev_07(
    total: Tally, thresholds: Thresholds = DEFAULT_THRESHOLDS, *, subject: str | None = None
) -> CheckResult:
    """Named-edition groups (ADR-017): share of materially revised keys; warn, never blocks."""
    over = total.share >= thresholds.rev_mass_share
    return _result(
        "REV-07", not over, Severity.WARN, metric=total.share,
        threshold=thresholds.rev_mass_share, subject=subject,
        detail={"existing_keys": total.existing_keys, "material": total.material},
    )  # fmt: skip


def check_rev_06(
    total: Tally,
    max_revised_rows: int | None,
    *,
    accepted_event: int | None = None,
    subject: str | None = None,
) -> CheckResult:
    """Re-estimating groups (A4): material revisions of the object vs ``max_revised_rows``.

    At or below the cap: info (the revisions load as ``reestimation``); above: error, the object
    is blocked. A decision-accepted ``mass_revision`` event releases it (as for REV-01).
    """
    cap = max_revised_rows
    over = cap is not None and total.material > cap and accepted_event is None
    detail: dict[str, object] = {
        "revised_rows": total.material, "existing_keys": total.existing_keys,
        "below_materiality": total.below_materiality, "cap": cap,
    }  # fmt: skip
    if accepted_event is not None and cap is not None and total.material > cap:
        detail["accepted_drift_event"] = accepted_event
    return _result(
        "REV-06", not over, Severity.ERROR, metric=float(total.material),
        threshold=None if cap is None else float(cap), subject=subject, detail=detail,
    )  # fmt: skip


def check_rev_02(t: Tally) -> CheckResult:
    return _result(
        "REV-02", not t.large, Severity.WARN, metric=float(len(t.large)),
        detail={"keys": t.large[:20]},
    )  # fmt: skip


def check_rev_03(t: Tally) -> CheckResult:
    return _result("REV-03", t.deep == 0, Severity.WARN, metric=float(t.deep))


def check_rev_04(t: Tally) -> CheckResult:
    return _result("REV-04", True, Severity.INFO, metric=float(t.proj_to_observed))


def check_rev_05(t: Tally) -> CheckResult:
    """Informational count of suppressed float-noise differences."""
    return _result(
        "REV-05", True, Severity.INFO, metric=float(t.noise),
        detail={"suppressed": t.noise, "below_materiality": t.below_materiality},
    )  # fmt: skip


def check_db_05(
    rows_to_insert: int,
    cap: int = DEFAULT_THRESHOLDS.max_insert_rows_per_load,
    *,
    accepted_event: int | None = None,
) -> CheckResult:
    over = rows_to_insert > cap and accepted_event is None
    detail: dict[str, object] = {"rows_to_insert": rows_to_insert, "cap": cap}
    if accepted_event is not None and rows_to_insert > cap:
        detail["accepted_drift_event"] = accepted_event
    return _result(
        "DB-05", not over, Severity.ERROR, metric=float(rows_to_insert), threshold=float(cap),
        detail=detail,
    )  # fmt: skip


# COMP -------------------------------------------------------------------------------


def check_comp_01(n_series: int, expected_series_min: int) -> CheckResult:
    return _result(
        "COMP-01", n_series >= expected_series_min, Severity.ERROR, metric=float(n_series),
        threshold=float(expected_series_min),
    )  # fmt: skip


def check_comp_02(
    previous: Mapping[str, str],
    current: Collection[str],
    core: Collection[str] = (),
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> CheckResult:
    """``previous`` maps series_ref -> entity of the previous successful load of the request."""
    cur = set(current)
    gone = sorted(r for r in previous if r not in cur)
    core_gone = sorted(r for r in gone if r in set(core))
    share = len(gone) / len(previous) if previous else 0.0
    by_entity: dict[str, int] = defaultdict(int)
    for r in gone:
        by_entity[previous[r]] += 1
    failed = share > thresholds.comp_drop_share or bool(core_gone)
    return _result(
        "COMP-02", not failed, Severity.ERROR, metric=share, threshold=thresholds.comp_drop_share,
        detail={
            "disappeared": gone[:20], "core_disappeared": core_gone[:20],
            "by_entity": dict(sorted(by_entity.items())),
        },
    )  # fmt: skip


def check_comp_03(
    tombstones: Mapping[str, tuple[int, int]], thresholds: Thresholds = DEFAULT_THRESHOLDS
) -> CheckResult:
    """``tombstones``: series_ref -> (tombstones to write, keys of the series). For the T28 seam."""
    bad = {
        ref: n / keys
        for ref, (n, keys) in sorted(tombstones.items())
        if keys and n / keys > thresholds.comp_tombstone_share
    }
    worst = max(bad.values(), default=0.0)
    return _result(
        "COMP-03", not bad, Severity.ERROR, metric=worst,
        threshold=thresholds.comp_tombstone_share, detail={"series": list(bad)[:20]},
    )  # fmt: skip


def check_comp_04(mapped: Iterable[str], seen: Collection[str], complete: bool) -> CheckResult:
    """Mapped series not seen in a complete fetch (only judged for complete objects)."""
    missing = sorted(set(mapped) - set(seen)) if complete else []
    return _result(
        "COMP-04", not missing, Severity.WARN, metric=float(len(missing)),
        detail={"missing": missing[:20], "judged": complete},
    )  # fmt: skip


# ---------------------------------------------------------------------------------------
# database layer
# ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Group:
    reestimating: bool
    edition_ordered: bool
    policy: ComparePolicy
    max_revised_rows: int | None = None


@dataclass
class Analysis:
    """Pre-load findings of one object, kept for the insert wrapper."""

    family: str
    tally: Tally
    by_dataset: dict[str, Tally]
    series_seen: int
    results: list[CheckResult]
    blocked: bool


def _group(conn: psycopg.Connection, obj: QueuedObject) -> _Group:
    row = conn.execute(
        "SELECT reestimating, edition_ordered, compare_mode, fixed_decimals, rel_epsilon, "
        "snapshot_mode, materiality_abs, materiality_rel, max_revised_rows FROM ref.series_group "
        "WHERE source_id = %s AND group_id = %s",
        [obj.source_id, obj.group_id],
    ).fetchone()
    if row is None:
        return _Group(False, False, ComparePolicy())
    return _Group(bool(row[0]), bool(row[1]), ComparePolicy(*row[2:8]), row[8])


def _latest(conn: psycopg.Connection, series_id: int) -> dict[date, Stored]:
    rows = conn.execute(
        "SELECT DISTINCT ON (ref_period_start) ref_period_start, value, value_status "
        "FROM curated.observation WHERE series_id = %s AND load_kind <> 'import' "
        "ORDER BY ref_period_start, known_at DESC",
        [series_id],
    ).fetchall()
    return {r[0]: Stored(r[1], r[2]) for r in rows}


def _latest_by_label(conn: psycopg.Connection, series_id: int) -> dict[tuple[date, str], Stored]:
    rows = conn.execute(
        "SELECT DISTINCT ON (ref_period_start, vintage_label) ref_period_start, vintage_label, "
        "value, value_status FROM curated.observation WHERE series_id = %s "
        "AND load_kind <> 'import' AND vintage_label IS NOT NULL "
        "ORDER BY ref_period_start, vintage_label, known_at DESC",
        [series_id],
    ).fetchall()
    return {(r[0], r[1]): Stored(r[2], r[3]) for r in rows}


def _revision_history(conn: psycopg.Connection, series_id: int) -> list[float]:
    rows = conn.execute(
        "SELECT d FROM (SELECT load_kind, abs(value - lag(value) OVER w) AS d "
        "FROM curated.observation WHERE series_id = %s AND load_kind <> 'import' "
        "WINDOW w AS (PARTITION BY ref_period_start ORDER BY known_at)) x "
        "WHERE load_kind = 'revision' AND d IS NOT NULL",
        [series_id],
    ).fetchall()
    return [float(r[0]) for r in rows]


def _accepted_event(conn: psycopg.Connection, raw_id: int) -> int | None:
    row = conn.execute(
        "SELECT max(event_id) FROM ops.drift_event "
        "WHERE raw_id = %s AND kind = 'mass_revision' AND status = 'accepted'",
        [raw_id],
    ).fetchone()
    return None if row is None or row[0] is None else int(row[0])


MappedFn = Callable[[QueuedObject], Collection[str]]


@dataclass
class OrdinaryChecks:
    """Default hooks for ``loader.drain``: pass ``validate``, ``insert`` and ``post_checks``."""

    run_id: int
    base_insert: InsertFn
    thresholds: Thresholds = DEFAULT_THRESHOLDS
    expected_series_min: Mapping[tuple[str, str], int] = field(default_factory=dict)
    max_insert_rows: Mapping[tuple[str, str], int] = field(default_factory=dict)  # group override
    mapped_refs: MappedFn | None = None  # COMP-04 input (mapped series of the object's group)
    _analysis: dict[int, Analysis] = field(default_factory=dict)
    _last_loaded: int | None = None

    # -- analysis ---------------------------------------------------------------------
    def analyse(self, conn: psycopg.Connection, obj: QueuedObject) -> Analysis:
        grp = _group(conn, obj)
        family = revision_family(grp.reestimating, grp.edition_ordered)
        import_kind = obj.import_label == IMPORT_LABEL
        staged: dict[str, list[StagedRow]] = defaultdict(list)
        for ref, start, value, status, label in conn.execute(
            "SELECT series_ref, ref_period_start, value, value_status, vintage_label "
            "FROM staging.observation_load WHERE raw_id = %s ORDER BY series_ref, ref_period_start",
            [obj.raw_id],
        ).fetchall():
            staged[ref].append(StagedRow(start, value, status, label))
        metas = {
            r[0] for r in conn.execute(
                "SELECT series_ref FROM staging.series_meta_load WHERE raw_id = %s", [obj.raw_id]
            ).fetchall()
        }  # fmt: skip
        total = Tally()
        by_ds: dict[str, Tally] = defaultdict(Tally)
        for ref, rows in staged.items():
            dataset, key = split_ref(ref)
            stored = find_series(conn, obj.source_id, dataset, key)
            if stored is None or import_kind:
                t = Tally(inserts=len(rows), new_rows=len(rows))
            else:
                dim = conn.execute(
                    "SELECT dimension FROM ref.unit WHERE unit_code = %s",
                    [stored.values["unit_code"]],
                ).fetchone()
                sid = stored.series_id
                t = tally_series(
                    ref, rows, _latest(conn, sid),
                    _latest_by_label(conn, sid) if any(r.status == "PROJ" for r in rows) else {},
                    grp.policy, stored.published_decimals,
                    ratio_unit=dim is not None and dim[0] == "ratio",
                    frequency=str(stored.values["frequency"]), fetched_at=obj.fetched_at,
                    history=lambda sid=sid: _revision_history(conn, sid),  # type: ignore[misc]
                    thresholds=self.thresholds,
                )  # fmt: skip
            by_ds[dataset or ""].add(t)
            total.add(t)
        results: list[CheckResult] = []
        accepted = _accepted_event(conn, obj.raw_id)
        if family == FAMILY_REV01 and not import_kind:
            results.append(check_rev_01(by_ds, self.thresholds, accepted_event=accepted))
        if not import_kind:
            results += [check_rev_02(total), check_rev_03(total), check_rev_04(total)]
            results.append(check_rev_05(total))
        results += self._family_results(family, total, grp.max_revised_rows, accepted)
        cap = self.max_insert_rows.get(
            (obj.source_id, obj.group_id), self.thresholds.max_insert_rows_per_load
        )
        results.append(check_db_05(total.inserts, cap, accepted_event=accepted))
        series_seen = len(set(staged) | metas)
        results += self._completeness(conn, obj, series_seen, set(staged) | metas, import_kind)
        return Analysis(
            family, total, dict(by_ds), series_seen, results, any(r.blocks for r in results)
        )

    def _family_results(
        self,
        family: str,
        total: Tally,
        max_revised_rows: int | None = None,
        accepted: int | None = None,
    ) -> list[CheckResult]:
        """REV-06 (T46, cap blocks) and REV-07 (T48, report only: warn never blocks)."""
        if family == FAMILY_REV06:
            return [check_rev_06(total, max_revised_rows, accepted_event=accepted)]
        if family == FAMILY_REV07:
            return [check_rev_07(total, self.thresholds)]
        return []

    def _completeness(
        self,
        conn: psycopg.Connection,
        obj: QueuedObject,
        n_series: int,
        refs: set[str],
        import_kind: bool,
    ) -> list[CheckResult]:
        out: list[CheckResult] = []
        complete = obj.fetch_scope == "complete" and not import_kind
        floor = self.expected_series_min.get((obj.source_id, obj.group_id))
        if floor is not None and complete:
            out.append(check_comp_01(n_series, floor))
        if complete:
            prev_rows = conn.execute(
                "SELECT DISTINCT s.dataset_id || '|' || s.series_key, s.entity_id, EXISTS ("
                " SELECT 1 FROM ref.series_map m JOIN ref.indicator i USING (indicator_id) "
                " WHERE m.series_id = s.series_id AND i.priority = 'core') "
                "FROM curated.observation o JOIN ingest.raw_object r USING (raw_id) "
                "JOIN ref.series s USING (series_id) "
                "WHERE r.source_id = %s AND r.group_id = %s AND r.request_key = %s "
                "AND r.raw_id <> %s AND s.is_active AND o.load_kind <> 'import'",
                [obj.source_id, obj.group_id, obj.request_key, obj.raw_id],
            ).fetchall()
            if prev_rows:
                out.append(
                    check_comp_02(
                        {r[0]: r[1] for r in prev_rows},
                        refs,
                        [r[0] for r in prev_rows if r[2]],
                        self.thresholds,
                    )
                )
        if self.mapped_refs is not None:
            out.append(check_comp_04(self.mapped_refs(obj), refs, complete))
        return out

    # -- loader seams -----------------------------------------------------------------
    def validate(self, conn: psycopg.Connection, obj: QueuedObject) -> Sequence[CheckResult]:
        """Pre-load hook (``drain(validate=...)``). A blocking REV-01/DB-05 raises a drift event."""
        a = self.analyse(conn, obj)
        self._analysis[obj.raw_id] = a
        for r in a.results:
            if r.blocks and r.check_id in ("REV-01", "REV-06", "DB-05"):
                ds = r.subject or f"raw_id={obj.raw_id}"
                record_drift(
                    conn, run_id=self.run_id, source_id=obj.source_id, raw_id=obj.raw_id,
                    problem=Problem(
                        "mass_revision", r.check_id, None, round(r.metric or 0.0, 4)
                    ),
                    series_ref=ds,
                )  # fmt: skip
        conn.commit()  # the gate needs an idle connection and the drift event must survive
        return a.results

    def insert(self, ctx: LoadContext) -> LoadCounts:
        """Wrap the real insert seam: store family and counts in ``raw_load.detail``."""
        a = self._analysis.get(ctx.obj.raw_id) or self.analyse(ctx.conn, ctx.obj)
        counts = self.base_insert(ctx)
        counts.detail["revision_check"] = {
            "family": a.family,
            "existing_keys": a.tally.existing_keys,
            "material_revisions": a.tally.material,
            "share": round(a.tally.share, 6),
            "noise_suppressed": a.tally.noise,
            "below_materiality": a.tally.below_materiality,
            "rows_to_insert": a.tally.inserts,
            "evaluated": a.family in (FAMILY_REV01, FAMILY_REV06, FAMILY_REV07),
        }
        self._last_loaded = ctx.obj.raw_id
        self._analysis.pop(ctx.obj.raw_id, None)
        return counts

    def post_checks(self, conn: psycopg.Connection) -> Sequence[CheckResult]:
        """DB-04 on the object just loaded (inside the load transaction)."""
        if self._last_loaded is None:
            return []
        return [check_db_04(conn, self._last_loaded)]


def check_db_04(conn: psycopg.Connection, raw_id: int) -> CheckResult:
    """Sample: no key with non-monotone ``known_at``, no series without metadata."""
    non_mono = conn.execute(
        "SELECT count(*) FROM (SELECT o.known_at <= lag(o.known_at) OVER "
        "(PARTITION BY o.series_id, o.ref_period_start ORDER BY o.obs_id) AS bad "
        "FROM curated.observation o "
        "WHERE o.load_kind <> 'import' AND o.series_id IN (SELECT series_id FROM "
        "curated.observation WHERE raw_id = %s)) x WHERE bad",
        [raw_id],
    ).fetchone()
    no_meta = conn.execute(
        "SELECT count(DISTINCT s.series_id) FROM curated.observation o JOIN ref.series s "
        "USING (series_id) WHERE o.raw_id = %s AND (btrim(s.frequency) = '' "
        "OR btrim(s.unit_code) = '' OR btrim(s.seasonal_adjustment) = '' "
        "OR btrim(s.entity_id) = '' OR btrim(s.title) = '')",
        [raw_id],
    ).fetchone()
    a = int(non_mono[0]) if non_mono else 0
    b = int(no_meta[0]) if no_meta else 0
    return _result(
        "DB-04", a == 0 and b == 0, Severity.ERROR, metric=float(a + b),
        detail={"non_monotone_known_at": a, "series_without_metadata": b},
    )  # fmt: skip


def make_ordinary_checks(run_id: int, insert: InsertFn, **kw: Any) -> OrdinaryChecks:
    """Factory: ``chk = make_ordinary_checks(run_id, make_insert(maps))`` then
    ``drain(conn, run_id=run_id, insert=chk.insert, validate=chk.validate,
    post_checks=chk.post_checks)``."""
    return OrdinaryChecks(run_id=run_id, base_insert=insert, **kw)
