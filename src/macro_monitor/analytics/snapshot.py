"""Per (indicator, entity) snapshot with the stored export fields (analytics spec 2 and 8, T40).

``compute_snapshot`` reads the as-of observations of a run (``fn_observation_asof`` at the run's
cutoffs, headline role, no PROJ, quality flag ``ok`` or overridden ``include``, ``exclude``
overrides removed) and returns one ``SnapshotRow`` per snapshot pair; ``write_snapshot`` inserts
them (the table is insert-only). There is ONE snapshot table: the published set is the view
``analytics.v_indicator_snapshot_published`` over the same rows (withheld pairs masked), so full
and published scope differ only by ``publish`` / ``publish_scope``.

Rows carry ``alignment = 'n/a'`` and no ``ref_offset_days`` / ``deviation`` here: T41 (alignment)
completes them with ``dataclasses.replace`` BEFORE ``write_snapshot`` because the table cannot be
updated.

Rules implemented here:
- the snapshot takes the latest row WITH a value: a later ``MISS`` supplies no value and does not
  reset the age (AC-AN-22);
- 44 non-global entities per ``scope = 'country'`` indicator, ``WLD`` (global entity) only for
  ``scope = 'global'`` indicators (AC-AN-8); entities without a value still get a row;
- ``publish`` = the headline series' source has ``publish_site = 'public'``; ``publish_scope``:
  ``excluded`` when not published; else ``info_only`` for global entities, descriptive_only
  indicators, or indicators with no ranked domain; else ``ranked``;
- ``inherited`` (ADR-009, ``ref.inheritance_rule``): the member shows the source entity's value,
  flagged; T41 excludes it from ranks (OQ-11 default);
- ``value_kind = 'estimate'`` for ``estimate_indicators`` (A02): only ``EST`` rows count.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg

from macro_monitor.analytics import staleness, transforms
from macro_monitor.analytics.runctx import RunRecord
from macro_monitor.analytics.transforms import Point
from macro_monitor.models.enums import Frequency

DEFAULT_ESTIMATE_INDICATORS = frozenset({"A02"})  # analytics spec section 2 (P7)


@dataclass(frozen=True)
class IndicatorInfo:
    indicator_id: str
    scope: str  # 'country' | 'global'
    rank_mode: str
    staleness_class: str
    release_lag_aware: bool
    transform_id: str
    in_ranked_domain: bool  # any domain with indicator_domain.is_ranked and domain.is_ranked


@dataclass(frozen=True)
class Obs:
    """One as-of observation of a mapped headline series (``value`` None for MISS)."""

    series_id: int
    source_id: str
    group_id: str
    frequency: str
    seasonal_adjustment: str
    source_public: bool
    ref_period_end: date
    value: Decimal | None
    value_status: str
    known_at: datetime
    source_release_at: datetime | None


@dataclass(frozen=True)
class SnapshotRow:
    indicator_id: str
    entity_id: str
    series_id: int | None
    value: Decimal | None
    ref_period_end: date | None
    known_at: datetime | None
    source_release_at: datetime | None
    age_days: int | None
    stale_limit_days: int | None
    is_stale: bool | None
    limit_source: str
    inherited: bool
    transformed_value: Decimal | None
    transform_id: str | None
    publish: bool
    publish_scope: str
    alignment: str = "n/a"
    alignment_reason: str | None = None
    ref_offset_days: int | None = None
    value_kind: str = "observed"
    deviation: Decimal | None = None


@dataclass
class SnapshotResult:
    rows: list[SnapshotRow]
    warnings: list[str] = field(default_factory=list)


def publish_scope(
    *, publish: bool, entity_is_global: bool, rank_mode: str, in_ranked_domain: bool
) -> str:
    """DDL spec section 6 rule for ``indicator_snapshot.publish_scope``."""
    if not publish:
        return "excluded"
    if entity_is_global or rank_mode == "descriptive_only" or not in_ranked_domain:
        return "info_only"
    return "ranked"


_SINGLE: dict[str, Callable[[Sequence[Point], Frequency, str], list[Point]]] = {
    "LEVEL": lambda p, f, sa: transforms.level(p),
    "YOY": lambda p, f, sa: transforms.yoy(p, f),
    "DIFF12": lambda p, f, sa: transforms.diff12(p, f),
    "YOY_PCT_POINT_CHANGE": lambda p, f, sa: transforms.yoy_pct_point_change(p, f),
    "M3M3_ANN": lambda p, f, sa: transforms.m3m3_ann(p, sa),
    "QOQ_ANN": lambda p, f, sa: transforms.qoq_ann(p, sa),
}

#: Public name for the single-series transform table; ``publish/series.py`` reuses it (T84).
SINGLE_TRANSFORMS = _SINGLE


def _transformed(transform_id: str, history: Sequence[Obs], at: date) -> Decimal | None:
    """Single-series transforms only; multi-input and denominator transforms (T39, REAL_RATE,
    SPREAD_VS_REF) are wired by the caller that has their inputs, so the value stays NULL here."""
    fn = _SINGLE.get(transform_id)
    if fn is None or not history:
        return None
    last = history[-1]
    pts = [Point(o.ref_period_end, o.value) for o in history]
    for p in fn(pts, Frequency(last.frequency), last.seasonal_adjustment):
        if p.period_end == at:
            return p.value
    return None


def build_rows(
    indicators: Sequence[IndicatorInfo],
    entities: Sequence[tuple[str, bool]],  # (entity_id, is_global)
    history: Mapping[tuple[str, str], Sequence[Obs]],
    inheritance: Mapping[tuple[str, str], str],  # (indicator, entity) -> source entity
    mapped_source_public: Mapping[tuple[str, str], bool],
    *,
    run_date: date,
    release_calendar: Mapping[str, staleness.ReleaseTiming],
    estimate_indicators: frozenset[str] = DEFAULT_ESTIMATE_INDICATORS,
) -> SnapshotResult:
    """Pure core: one row per snapshot pair from the observations of a run."""
    out = SnapshotResult([])
    for ind in sorted(indicators, key=lambda i: i.indicator_id):
        want_global = ind.scope == "global"
        for entity_id, is_global in sorted(entities):
            if is_global != want_global:
                continue
            key = (ind.indicator_id, entity_id)
            src_entity = inheritance.get(key)
            inherited = src_entity is not None
            hist = list(history.get((ind.indicator_id, src_entity or entity_id), ()))
            is_estimate = ind.indicator_id in estimate_indicators
            if is_estimate:
                hist = [o for o in hist if o.value_status == "EST"]
            with_value = [o for o in hist if o.value is not None]
            latest = with_value[-1] if with_value else None
            public = (
                latest.source_public
                if latest
                else (hist[-1].source_public if hist else mapped_source_public.get(key, True))
            )
            timing = None
            if latest is not None:
                timing = release_calendar.get(latest.group_id)
                if ind.release_lag_aware and timing is None:
                    out.warnings.append(
                        f"{ind.indicator_id}/{entity_id}: release_lag_aware but no release "
                        f"calendar entry for group {latest.group_id!r}; class limit used"
                    )
            limit = staleness.stale_limit(
                ind.staleness_class, release_lag_aware=ind.release_lag_aware, timing=timing
            )
            scope = publish_scope(
                publish=public,
                entity_is_global=is_global,
                rank_mode=ind.rank_mode,
                in_ranked_domain=ind.in_ranked_domain,
            )
            kind = "estimate" if is_estimate else "observed"
            if latest is None:
                out.rows.append(
                    SnapshotRow(
                        indicator_id=ind.indicator_id,
                        entity_id=entity_id,
                        series_id=None,
                        value=None,
                        ref_period_end=None,
                        known_at=None,
                        source_release_at=None,
                        age_days=None,
                        stale_limit_days=limit.days,
                        is_stale=None,
                        limit_source=limit.source,
                        inherited=inherited,
                        transformed_value=None,
                        transform_id=ind.transform_id,
                        publish=public,
                        publish_scope=scope,
                        value_kind=kind,
                    )
                )
                continue
            age = staleness.age_days(run_date, latest.ref_period_end)
            out.rows.append(
                SnapshotRow(
                    indicator_id=ind.indicator_id,
                    entity_id=entity_id,
                    series_id=latest.series_id,
                    value=latest.value,
                    ref_period_end=latest.ref_period_end,
                    known_at=latest.known_at,
                    source_release_at=latest.source_release_at,
                    age_days=age,
                    stale_limit_days=limit.days,
                    is_stale=staleness.is_stale(age, limit.days),
                    limit_source=limit.source,
                    inherited=inherited,
                    transformed_value=_transformed(ind.transform_id, hist, latest.ref_period_end),
                    transform_id=ind.transform_id,
                    publish=public,
                    publish_scope=scope,
                    value_kind=kind,
                )
            )
    return out


# ------------------------------------------------------------------ database access

_OBS_SQL = """
SELECT m.indicator_id, m.entity_id, s.series_id, s.source_id, s.group_id, s.frequency,
       s.seasonal_adjustment, (src.publish_site = 'public'), o.ref_period_end, o.value,
       o.value_status, o.known_at, o.source_release_at
FROM curated.fn_observation_asof(%(known)s, %(load)s) o
JOIN ref.series s ON s.series_id = o.series_id
JOIN ref.source src ON src.source_id = s.source_id
JOIN ref.series_map m ON m.series_id = s.series_id AND m.role = 'headline'
 AND o.ref_period_start >= m.valid_from AND (m.valid_to IS NULL OR o.ref_period_start <= m.valid_to)
LEFT JOIN LATERAL (
  SELECT q.decision FROM ops.quality_override q
  WHERE q.series_id = o.series_id AND q.ref_period_start = o.ref_period_start
    AND (q.known_at IS NULL OR q.known_at = o.known_at) AND q.recorded_at <= %(cfg)s
  ORDER BY q.recorded_at DESC, q.override_id DESC LIMIT 1) ov ON true
WHERE o.value_status <> 'PROJ'
  AND ((o.quality_flag = 'ok' AND ov.decision IS DISTINCT FROM 'exclude')
       OR ov.decision = 'include')
ORDER BY m.indicator_id, m.entity_id, o.ref_period_end
"""


def load_observations(
    conn: psycopg.Connection[Any], run: RunRecord
) -> dict[tuple[str, str], list[Obs]]:
    """As-of headline history per (indicator, entity), inputs/support indicators included."""
    history: dict[tuple[str, str], list[Obs]] = defaultdict(list)
    for r in conn.execute(
        _OBS_SQL, {"known": run.known_cutoff, "load": run.load_cutoff, "cfg": run.config_asof}
    ):
        history[(r[0], r[1])].append(Obs(*r[2:]))
    return history


def compute_snapshot(
    conn: psycopg.Connection[Any],
    run: RunRecord,
    *,
    release_calendar: Mapping[str, staleness.ReleaseTiming],
    estimate_indicators: frozenset[str] = DEFAULT_ESTIMATE_INDICATORS,
    history: Mapping[tuple[str, str], Sequence[Obs]] | None = None,
) -> SnapshotResult:
    """Read the run's as-of inputs (cutoffs from ``run``) and build the snapshot rows.

    ``history`` (from :func:`load_observations`) avoids a second read when the caller has it.
    """
    ex = conn.execute
    inds = [
        IndicatorInfo(r[0], r[1], r[2], r[3], r[4], r[5], bool(r[6]))
        for r in ex(
            "SELECT i.indicator_id, i.scope, i.rank_mode, i.staleness_class, i.release_lag_aware, "
            "i.transform_id, EXISTS (SELECT 1 FROM ref.indicator_domain d JOIN ref.domain dm "
            "USING (domain_id) WHERE d.indicator_id = i.indicator_id AND d.is_ranked "
            "AND dm.is_ranked) FROM ref.indicator i WHERE i.kind = 'indicator' "
            "AND i.priority <> 'dropped' AND NOT i.is_comparison ORDER BY 1"
        ).fetchall()
    ]
    entities = [
        (str(r[0]), bool(r[1]))
        for r in ex("SELECT entity_id, is_global FROM ref.entity ORDER BY 1").fetchall()
    ]
    if history is None:
        history = load_observations(conn, run)
    inheritance = {
        (str(r[0]), str(r[1])): str(r[2])
        for r in ex(
            "SELECT indicator_id, entity_id, source_entity_id FROM ref.inheritance_rule "
            "WHERE valid_from <= %s AND (valid_to IS NULL OR valid_to >= %s)",
            [run.as_of_run_date, run.as_of_run_date],
        ).fetchall()
    }
    mapped = {
        (str(r[0]), str(r[1])): bool(r[2])
        for r in ex(
            "SELECT m.indicator_id, m.entity_id, bool_and(src.publish_site = 'public') "
            "FROM ref.series_map m JOIN ref.series s USING (series_id) "
            "JOIN ref.source src ON src.source_id = s.source_id WHERE m.role = 'headline' "
            "AND m.valid_from <= %s AND (m.valid_to IS NULL OR m.valid_to >= %s) "
            "GROUP BY 1, 2",
            [run.as_of_run_date, run.as_of_run_date],
        ).fetchall()
    }
    return build_rows(
        inds, entities, history, inheritance, mapped,
        run_date=run.as_of_run_date, release_calendar=release_calendar,
        estimate_indicators=estimate_indicators,
    )  # fmt: skip


_COLUMNS = (
    "indicator_id", "entity_id", "series_id", "value", "ref_period_end", "known_at",
    "source_release_at", "age_days", "stale_limit_days", "is_stale", "limit_source", "inherited",
    "transformed_value", "transform_id", "publish", "publish_scope", "alignment",
    "alignment_reason", "ref_offset_days", "value_kind", "deviation",
)  # fmt: skip


def write_snapshot(
    conn: psycopg.Connection[Any], analysis_run_id: int, rows: Sequence[SnapshotRow]
) -> int:
    """Insert the rows for a run (insert-only table); the caller commits."""
    cols = ", ".join(_COLUMNS)
    ph = ", ".join(["%s"] * (len(_COLUMNS) + 1))
    with conn.cursor() as cur:
        cur.executemany(
            f"INSERT INTO analytics.indicator_snapshot (analysis_run_id, {cols}) VALUES ({ph})",
            [[analysis_run_id, *(getattr(r, c) for c in _COLUMNS)] for r in rows],
        )
    return len(rows)
