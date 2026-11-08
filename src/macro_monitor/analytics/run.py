"""``analyze`` orchestration (T44; ADR-011, ADR-012; analytics spec sections 1-6).

Call order (orchestrator notes of T36-T43):

1. ``runctx.start_run``: ONE short transaction (load lock, DB-clock cutoff, run row), committed.
2. ONE output transaction on the same connection: read the as-of history once; ``compute_snapshot``;
   wire the multi-input transforms (REAL_RATE, SPREAD_VS_REF, SUM12_PCT_GDP, RESERVE_COVER) into
   ``transformed_value``; ``rank_run``; ``scorecards``; ``demote_ineligible`` (BEFORE
   ``write_snapshot``); ``write_snapshot``; ``write_ranking``; ``write_scorecard``;
   ``evaluate_alert`` per pair and ``write_alerts``; commit. Any error rolls the whole output
   back, so a run never has partial outputs. The run row itself stays (it was committed with the
   cutoff and no role may delete it); a run without outputs is recognisable by having no rows in
   ``analytics.indicator_snapshot`` (spec gap, see the T44 report).

The full and the published sets come out of the same ``rank_all`` / ``build_scorecard`` code path;
there is one snapshot table and one alert table, the published view masks withheld pairs.

Inputs the database does not hold (``regime_start``, ``spread_reference``, ``fx_regime_flag``,
``lcu_currency``, ``cpi_indicator_id``) are caller-supplied via :class:`AnalyzeOptions`.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg

from macro_monitor.analytics import (
    alerts,
    runctx,
    scorecard,
    scoring,
    snapshot,
    staleness,
    transforms,
    transforms_denominator,
)
from macro_monitor.analytics.alerts import AlertConfig, AlertRow
from macro_monitor.analytics.snapshot import Obs, SnapshotRow
from macro_monitor.analytics.transforms import Point
from macro_monitor.analytics.transforms_denominator import (
    EntityContext,
    GuardConfig,
    SupportPoint,
)
from macro_monitor.models.enums import Frequency

MULTI_INPUT = frozenset({"REAL_RATE", "SPREAD_VS_REF", "SUM12_PCT_GDP", "RESERVE_COVER"})
REAL_TIME_FORBIDDEN_KINDS = frozenset({"initial", "import"})


class RealTimeRefused(ValueError):
    """A backtest asked to treat ``initial`` or ``import`` data as real-time (AC-AN-3)."""


def backtest_label(load_kinds: Iterable[str], *, claim_real_time: bool = False) -> str:
    """AC-AN-3: data containing ``initial`` (reconstructed) or ``import`` rows is "revised-data";
    asking to treat it as real-time raises :class:`RealTimeRefused`."""
    bad = sorted(set(load_kinds) & REAL_TIME_FORBIDDEN_KINDS)
    if not bad:
        return "real-time" if claim_real_time else "revised-data"
    if claim_real_time:
        raise RealTimeRefused(f"load_kind {bad} cannot be treated as real-time (D10)")
    return "revised-data"


@dataclass(frozen=True)
class AnalyzeOptions:
    ingest_run_id: int
    as_of_run_date: date
    code_version: str
    git_sha: str
    config_asof: datetime
    config_sha256: str
    mapping_sha256: str
    overrides_sha256: str
    release_calendar: Mapping[str, staleness.ReleaseTiming] = field(default_factory=dict)
    params: Mapping[str, Any] = field(default_factory=dict)
    regime_start: Mapping[tuple[str, str], date] = field(default_factory=dict)
    spread_reference: Mapping[tuple[str, str], str] = field(default_factory=dict)
    fx_regime_flag: Mapping[str, str] = field(default_factory=dict)
    lcu_currency: Mapping[str, str] = field(default_factory=dict)
    cpi_indicator_id: str | None = None
    estimate_indicators: frozenset[str] = snapshot.DEFAULT_ESTIMATE_INDICATORS
    lock_timeout_ms: int = runctx.DEFAULT_LOCK_TIMEOUT_MS


@dataclass
class AnalyzeResult:
    run: runctx.RunRecord
    n_snapshot: int = 0
    n_alerts: int = 0
    warnings: list[str] = field(default_factory=list)
    comp05: list[tuple[str, str, str]] = field(default_factory=list)  # (indicator, entity, reason)


@dataclass(frozen=True)
class Derived:
    points: list[Point]
    override_allowed: bool = True
    reason_at_latest: str | None = None


@dataclass(frozen=True)
class SeriesAttr:
    flow_basis: str
    currency: str
    calendar_basis: str


@dataclass(frozen=True)
class InputDef:
    input_id: str
    usage: str
    currency_match: str


History = Mapping[tuple[str, str], Sequence[Obs]]


def _points(hist: Sequence[Obs]) -> list[Point]:
    return [Point(o.ref_period_end, o.value) for o in hist]


def _support(hist: Sequence[Obs], attrs: Mapping[int, SeriesAttr]) -> list[SupportPoint]:
    out: list[SupportPoint] = []
    for o in hist:
        a = attrs[o.series_id]
        out.append(
            SupportPoint(
                o.ref_period_end, o.value, Frequency(o.frequency), a.flow_basis, a.currency,
                a.calendar_basis,
            )
        )  # fmt: skip
    return out


def _cpi_yoy(history: History, cpi_id: str | None, entity: str, at: date) -> Decimal | None:
    if cpi_id is None:
        return None
    h = history.get((cpi_id, entity), ())
    if not h:
        return None
    pts = transforms.yoy(_points(h), Frequency(h[-1].frequency))
    ok = [p for p in pts if p.value is not None and p.period_end <= at]
    return ok[-1].value if ok else None


def derive_series(
    transform_id: str,
    indicator_id: str,
    entity: str,
    effective_entity: str,
    history: History,
    inputs: Sequence[InputDef],
    attrs: Mapping[int, SeriesAttr],
    opt: AnalyzeOptions,
    max_age_days: Mapping[str, int],
    warnings: list[str],
) -> Derived | None:
    """Transformed series of one pair for a multi-input transform, or None when not computable.

    Failures that are data conditions (guards) yield absent points, never a number; configuration
    problems add a warning and return None.
    """
    hist = history.get((indicator_id, effective_entity), ())
    if not hist:
        return None
    freq = Frequency(hist[-1].frequency)
    tag = f"{indicator_id}/{entity}"
    try:
        if transform_id == "REAL_RATE":
            core = [i for i in inputs if i.usage.startswith("core")] or list(inputs)
            if not core:
                warnings.append(f"{tag}: REAL_RATE without a core-inflation input")
                return None
            ch = history.get((core[0].input_id, effective_entity), ())
            core_yoy = transforms.yoy(_points(ch), Frequency(ch[-1].frequency)) if ch else []
            return Derived(transforms.real_rate(_points(hist), core_yoy, freq))
        if transform_id == "SPREAD_VS_REF":
            ref = opt.spread_reference.get((indicator_id, entity))
            if ref is None:
                warnings.append(f"{tag}: SPREAD_VS_REF without spread_reference; spread is n/a")
                return None
            rh = history.get((indicator_id, ref), ())
            return Derived(
                transforms.spread_vs_ref(
                    _points(hist), _points(rh), freq, entity=entity, spread_reference=ref
                )
            )
        if not inputs:
            warnings.append(f"{tag}: {transform_id} without inputs; n/a")
            return None
        inp = inputs[0]
        ih = _support(history.get((inp.input_id, effective_entity), ()), attrs)
        num = _support(hist, attrs)
        if transform_id == "SUM12_PCT_GDP":
            cfg = GuardConfig(
                max_denominator_age_days=max_age_days.get(
                    inp.input_id, transforms_denominator.DEFAULT_MAX_DENOMINATOR_AGE_DAYS
                ),
                currency_match=inp.currency_match,
            )
            pts: list[Point] = []
            last_reason: str | None = None
            for n in num:
                if n.value is None:
                    pts.append(Point(n.period_end, None))
                    continue
                ctx = EntityContext(
                    cpi_yoy=_cpi_yoy(history, opt.cpi_indicator_id, effective_entity, n.period_end),
                    fx_regime_flag=opt.fx_regime_flag.get(entity),
                    lcu_currency=opt.lcu_currency.get(entity),
                )
                r = transforms_denominator.sum12_pct_gdp(
                    [p for p in num if p.value is not None], ih, n.period_end, ctx=ctx, cfg=cfg
                )
                pts.append(Point(n.period_end, r.value))
                last_reason = r.reason
            return Derived(pts, True, last_reason)
        if transform_id == "RESERVE_COVER":
            scope = "goods_only" if "goods_only" in inp.usage else "goods_and_services"
            pts = []
            last_reason = None
            allowed = scope != "goods_only"
            for n in num:
                if n.value is None:
                    pts.append(Point(n.period_end, None))
                    continue
                r = transforms_denominator.reserve_cover(
                    Point(n.period_end, n.value), n.currency, ih, imports_scope=scope
                )
                pts.append(Point(n.period_end, r.value))
                last_reason = r.reason
            return Derived(pts, allowed, last_reason)
    except transforms.TransformError as exc:
        warnings.append(f"{tag}: {exc}")
        return None
    warnings.append(f"{tag}: transform {transform_id} is not wired")
    return None


# ------------------------------------------------------------------ database access


def _load_inputs(
    conn: psycopg.Connection[Any],
) -> tuple[dict[str, list[InputDef]], dict[str, dict[str, int]]]:
    inputs: dict[str, list[InputDef]] = defaultdict(list)
    for r in conn.execute(
        "SELECT indicator_id, input_id, usage, currency_match FROM ref.indicator_input "
        "ORDER BY indicator_id, input_id, usage"
    ).fetchall():
        inputs[str(r[0])].append(InputDef(str(r[1]), str(r[2]), str(r[3])))
    ages: dict[str, dict[str, int]] = {}
    for iid, params in conn.execute("SELECT indicator_id, params FROM ref.indicator").fetchall():
        m = (params or {}).get("inputs_max_denominator_age_days")
        if m:
            ages[str(iid)] = {str(k): int(v) for k, v in m.items()}
    return inputs, ages


def _series_attrs(conn: psycopg.Connection[Any], history: History) -> dict[int, SeriesAttr]:
    ids = sorted({o.series_id for h in history.values() for o in h})
    return {
        int(r[0]): SeriesAttr(str(r[1]), str(r[2] or ""), str(r[3]))
        for r in conn.execute(
            "SELECT series_id, flow_basis, currency_code, calendar_basis FROM ref.series "
            "WHERE series_id = ANY(%s)",
            [ids],
        ).fetchall()
    }


def _alert_configs(conn: psycopg.Connection[Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in conn.execute(
        "SELECT indicator_id, alert_method, adverse_dir, params, transform_id, "
        "stationarity_class, alert_override FROM ref.indicator WHERE kind = 'indicator' "
        "AND priority <> 'dropped' AND NOT is_comparison ORDER BY 1"
    ).fetchall():
        out[str(r[0])] = {
            "method": str(r[1]), "adverse": int(r[2]), "params": r[3] or {},
            "transform": str(r[4]), "stationarity": str(r[5]), "overrides": r[6] or [],
        }  # fmt: skip
    return out


def _alert_config(indicator_id: str, c: Mapping[str, Any], frequency: str) -> AlertConfig:
    p = c["params"]

    def per_freq(key: str) -> int:
        if key not in p:
            raise alerts.AlertConfigError(f"{indicator_id}: ref.indicator.params lacks {key!r}")
        x = p[key]
        return int(x[frequency] if isinstance(x, Mapping) else x)

    for k in ("alert_z", "watch_z"):
        if k not in p:
            raise alerts.AlertConfigError(f"{indicator_id}: ref.indicator.params lacks {k!r}")
    return AlertConfig(
        indicator_id=indicator_id,
        method=c["method"],
        adverse=c["adverse"],
        alert_z=Decimal(str(p["alert_z"])),
        watch_z=Decimal(str(p["watch_z"])),
        window_obs=per_freq("window_obs"),
        min_obs=per_freq("min_obs"),
        transform_id=c["transform"],
        stationarity_class=c["stationarity"],
        overrides=tuple(c["overrides"]),
    )


# ------------------------------------------------------------------ orchestration


def analyze(conn: psycopg.Connection[Any], opt: AnalyzeOptions) -> AnalyzeResult:
    """Run the whole analysis on ``conn`` (a DIRECT connection of role ``mm_analytics``, idle)."""
    rec = runctx.start_run(
        conn,
        ingest_run_id=opt.ingest_run_id,
        as_of_run_date=opt.as_of_run_date,
        code_version=opt.code_version,
        params=opt.params,
        git_sha=opt.git_sha,
        config_asof=opt.config_asof,
        config_sha256=opt.config_sha256,
        mapping_sha256=opt.mapping_sha256,
        overrides_sha256=opt.overrides_sha256,
        lock_timeout_ms=opt.lock_timeout_ms,
    )
    result = AnalyzeResult(rec)
    with conn.transaction():
        history = snapshot.load_observations(conn, rec)
        snap = snapshot.compute_snapshot(
            conn, rec, release_calendar=opt.release_calendar,
            estimate_indicators=opt.estimate_indicators, history=history,
        )  # fmt: skip
        result.warnings.extend(snap.warnings)
        inputs, ages = _load_inputs(conn)
        attrs = _series_attrs(conn, history)
        inheritance = {
            (str(r[0]), str(r[1])): str(r[2])
            for r in conn.execute(
                "SELECT indicator_id, entity_id, source_entity_id FROM ref.inheritance_rule "
                "WHERE valid_from <= %s AND (valid_to IS NULL OR valid_to >= %s)",
                [rec.as_of_run_date, rec.as_of_run_date],
            ).fetchall()
        }
        # wire multi-input transforms into transformed_value
        derived: dict[tuple[str, str], Derived] = {}
        rows: list[SnapshotRow] = []
        for row in snap.rows:
            tid = row.transform_id or ""
            if tid in MULTI_INPUT:
                eff = inheritance.get((row.indicator_id, row.entity_id), row.entity_id)
                d = derive_series(
                    tid, row.indicator_id, row.entity_id, eff, history,
                    inputs.get(row.indicator_id, []), attrs, opt,
                    ages.get(row.indicator_id, {}), result.warnings,
                )  # fmt: skip
                if d is not None:
                    derived[(row.indicator_id, row.entity_id)] = d
                    tv = next(
                        (p.value for p in d.points if p.period_end == row.ref_period_end), None
                    )
                    if (
                        row.ref_period_end is not None
                        and tv is None
                        and d.reason_at_latest in transforms_denominator.COMP05_REASONS
                    ):
                        result.comp05.append((row.indicator_id, row.entity_id, d.reason_at_latest))
                    row = replace(row, transformed_value=tv)
            rows.append(row)
        res = scoring.rank_run(conn, rec, rows)
        sres, elig, members = scorecard.scorecards(conn, res)
        final = scorecard.demote_ineligible(res.rows, elig, members)
        result.n_snapshot = snapshot.write_snapshot(conn, rec.analysis_run_id, final)
        scoring.write_ranking(conn, rec.analysis_run_id, res)
        scorecard.write_scorecard(conn, rec.analysis_run_id, sres)
        arows = _evaluate_alerts(conn, rec, final, history, derived, opt, inheritance, result)
        result.n_alerts = alerts.write_alerts(conn, rec.analysis_run_id, arows)
    return result


def _evaluate_alerts(
    conn: psycopg.Connection[Any],
    rec: runctx.RunRecord,
    rows: Sequence[SnapshotRow],
    history: History,
    derived: Mapping[tuple[str, str], Derived],
    opt: AnalyzeOptions,
    inheritance: Mapping[tuple[str, str], str],
    result: AnalyzeResult,
) -> list[AlertRow]:
    cfgs = _alert_configs(conn)
    groups: dict[str, set[str]] = defaultdict(set)
    for ent, grp in conn.execute(
        "SELECT entity_id, group_id FROM ref.entity_group_member WHERE valid_from <= %s "
        "AND (valid_to IS NULL OR valid_to >= %s)",
        [rec.as_of_run_date, rec.as_of_run_date],
    ).fetchall():
        groups[str(ent)].add(str(grp))
    out: list[AlertRow] = []
    for row in sorted(rows, key=lambda r: (r.indicator_id, r.entity_id)):
        c = cfgs.get(row.indicator_id)
        if c is None or c["method"] == "none" or row.series_id is None:
            continue
        if row.inherited:  # OQ-11 default: inherited values are shown, never alerted
            continue
        hist = history.get((row.indicator_id, row.entity_id), ())
        if row.value_kind == "estimate":
            hist = [o for o in hist if o.value_status == "EST"]
        if not hist:
            continue
        d = derived.get((row.indicator_id, row.entity_id))
        if row.transform_id in MULTI_INPUT and d is None:
            continue
        cfg = _alert_config(row.indicator_id, c, hist[-1].frequency)
        a = alerts.evaluate_alert(
            cfg, row.entity_id, hist, is_stale=bool(row.is_stale),
            entity_groups=sorted(groups.get(row.entity_id, ())),
            regime_start=opt.regime_start.get((row.indicator_id, row.entity_id)),
            transformed=d.points if d is not None else None,
            override_allowed=d.override_allowed if d is not None else True,
        )  # fmt: skip
        if a is not None:
            out.append(a)
    return out


def check_reproduction(
    conn: psycopg.Connection[Any], analysis_run_id: int, current: Mapping[str, str]
) -> list[runctx.HashMismatch]:
    """Compare the hashes stored with a run against the current ones (mismatches are reported,
    never silently ignored; spec section 1)."""
    return runctx.compare_hashes(runctx.load_run(conn, analysis_run_id), current)


def _table_digest(conn: psycopg.Connection[Any], table: str) -> str:
    h = hashlib.sha256(table.encode())
    rows = conn.execute(f"SELECT t::text FROM {table} t ORDER BY 1").fetchall()
    for (txt,) in rows:
        h.update(b"\n")
        h.update(str(txt).encode())
    return h.hexdigest()


def compute_hashes(conn: psycopg.Connection[Any]) -> tuple[str, str]:
    """``(mapping_sha256, overrides_sha256)`` from the database as the run will read it (DDL
    section 6): all ``ref.*`` base tables, and ``ops.quality_override`` (a role without SELECT on
    it hashes the fixed marker ``unreadable``, which the run then records)."""
    names = [
        str(r[0])
        for r in conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'ref' "
            "AND table_type = 'BASE TABLE' ORDER BY 1"
        ).fetchall()
    ]
    h = hashlib.sha256()
    for n in names:
        if conn.execute("SELECT has_table_privilege(%s, 'SELECT')", [f"ref.{n}"]).fetchone() == (
            True,
        ):
            h.update(_table_digest(conn, f"ref.{n}").encode())
    can = conn.execute(
        "SELECT has_table_privilege('ops.quality_override', 'SELECT')"
    ).fetchone() == (True,)
    ov = (
        _table_digest(conn, "ops.quality_override")
        if can
        else hashlib.sha256(b"unreadable").hexdigest()
    )
    conn.rollback()
    return h.hexdigest(), ov
