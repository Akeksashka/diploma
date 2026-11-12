"""``series/<indicator_id>.parquet`` (T84; export spec section 6, EXP-02, EXP-04, AC-EXP-8).

Rows come from ``curated.v_headline_obs_published`` (latest vintage, observed only, no import rows,
withheld sources and input indicators absent). ``value_default_tf`` and ``value_yoy`` are computed
with the SAME pure functions as analytics (``analytics.transforms`` through
``snapshot.SINGLE_TRANSFORMS``), over the full history before the 1991-01-01 start is applied.

Known gap (T84 report): multi-input transforms (``REAL_RATE``, ``SPREAD_VS_REF``,
``SUM12_PCT_GDP``, ``RESERVE_COVER``) need inputs that ``mm_reader`` cannot read (the series
currency ``ref.series.currency_code``, ``ref.indicator_input``, indicator ``params``), so their
``value_default_tf`` is null here rather than a value that could differ from analytics.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import pyarrow as pa

from macro_monitor.analytics import transforms
from macro_monitor.analytics.snapshot import SINGLE_TRANSFORMS
from macro_monitor.analytics.transforms import Point
from macro_monitor.models.enums import Frequency
from macro_monitor.publish.export import ExportError, ExportSession, ExportSink
from macro_monitor.publish.manifest import RunInfo
from macro_monitor.publish.published import PUBLISHED_INDICATOR_IDS_SQL

SERIES_START = date(1991, 1, 1)
_DICT = pa.dictionary(pa.int32(), pa.string())
SCHEMA = pa.schema(
    [
        pa.field("entity_id", _DICT, nullable=False),
        pa.field("series_id", pa.int32(), nullable=False),
        pa.field("ref_period_start", pa.date32(), nullable=False),
        pa.field("ref_period_end", pa.date32(), nullable=False),
        pa.field("frequency", _DICT, nullable=False),
        pa.field("value", pa.float64()),
        pa.field("value_default_tf", pa.float64()),
        pa.field("value_yoy", pa.float64()),
        pa.field("value_status", _DICT, nullable=False),
        pa.field("known_at", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("load_kind", _DICT, nullable=False),
    ]
)
_SQL = (
    "SELECT indicator_id, entity_id, series_id, ref_period_start, ref_period_end, frequency, "
    "seasonal_adjustment, value, value_status, known_at, loaded_at, load_kind "
    "FROM curated.v_headline_obs_published "
    "ORDER BY indicator_id, entity_id, ref_period_end"
)


def is_single_series(transform_id: str) -> bool:
    return transform_id in SINGLE_TRANSFORMS


def _f(v: Decimal | None) -> float | None:
    return None if v is None else float(v)


def _computed(
    fn_id: str | None, pts: list[Point], freq: Frequency, sa: str
) -> dict[date, Decimal | None]:
    """Transform output by period end; any transform error (e.g. QoQ on NSA) gives no values."""
    try:
        if fn_id is None:
            out = transforms.yoy(pts, freq)
        else:
            out = SINGLE_TRANSFORMS[fn_id](pts, freq, sa)
    except transforms.TransformError:
        return {}
    return {p.period_end: p.value for p in out}


def build_table(rows: list[tuple[Any, ...]], transform_id: str) -> pa.Table:
    """Rows of ONE indicator (sorted by entity, period end) to the series table."""
    by_entity: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for r in rows:
        by_entity[r[1]].append(r)
    cols: dict[str, list[Any]] = {f.name: [] for f in SCHEMA}
    for entity in sorted(by_entity):
        ers = by_entity[entity]
        last = ers[-1]
        freq, sa = Frequency(last[5]), last[6]
        pts = [Point(r[4], r[7]) for r in ers]
        default = _computed(transform_id, pts, freq, sa) if is_single_series(transform_id) else {}
        yoy = _computed(None, pts, freq, sa)
        for r in sorted(ers, key=lambda x: x[3]):
            if r[3] < SERIES_START:
                continue
            cols["entity_id"].append(entity)
            cols["series_id"].append(r[2])
            cols["ref_period_start"].append(r[3])
            cols["ref_period_end"].append(r[4])
            cols["frequency"].append(r[5])
            cols["value"].append(_f(r[7]))
            cols["value_default_tf"].append(_f(default.get(r[4])))
            cols["value_yoy"].append(_f(yoy.get(r[4])))
            cols["value_status"].append(r[8])
            cols["known_at"].append(r[9])
            cols["load_kind"].append(r[11])
    return pa.table({f.name: pa.array(cols[f.name], type=f.type) for f in SCHEMA}, schema=SCHEMA)


def series_producer(session: ExportSession, run: RunInfo, sink: ExportSink) -> None:
    """Adds one ``series/<indicator_id>.parquet`` per indicator that has published rows."""
    inds = {
        str(r[0]): str(r[1])
        for r in session.fetch(
            "SELECT indicator_id, transform_id FROM ref.indicator "
            f"WHERE indicator_id IN ({PUBLISHED_INDICATOR_IDS_SQL}) ORDER BY indicator_id"
        )
    }
    grouped: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for r in session.fetch(_SQL):
        if r[0] not in inds:
            continue
        # The view is latest-vintage, not as-of: a vintage newer than the run's cutoffs would put
        # a value into the files that the analytics run never saw.
        known: datetime = r[9]
        loaded: datetime = r[10]
        if known > run.known_cutoff or loaded > run.load_cutoff:
            raise ExportError(
                f"EXP-10: observation of series {r[2]} period {r[3]} is newer than the cutoffs "
                f"of analysis run {run.analysis_run_id}; rerun analytics",
                check="EXP-10",
            )
        grouped[r[0]].append(r)
    for indicator_id in sorted(grouped):
        table = build_table(grouped[indicator_id], inds[indicator_id])
        if table.num_rows:
            sink.add_parquet(f"series/{indicator_id}.parquet", table, group_by="entity_id")
