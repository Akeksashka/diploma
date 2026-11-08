"""``revisions/<indicator_id>.parquet`` and ``revisions_recent.json`` (T85; export spec section 7,
EXP-02, EXP-04, AC-EXP-13, AC-EXP-14).

Rows come from ``curated.v_revision_history`` (publishable sources, headline mappings of
``kind = 'indicator'``, no import and no ``PROJ`` versions, keys with at least two versions). The
view carries no revision size: ``revision_abs`` / ``revision_pct`` are computed here against the
previous version of the key. Versions newer than the run's ``known_cutoff`` are dropped and the
"two versions" rule and the base version are re-evaluated on what remains (as-of export).

Edition identity for ``edition_summaries[]`` is ``(source_id, vintage_label)``; when
``vintage_label`` is null the UTC date of ``known_at`` stands in for the label (also in the output
field ``vintage_label``).
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pyarrow as pa

from macro_monitor.publish.export import ExportError, ExportSession, ExportSink
from macro_monitor.publish.manifest import RunInfo, utc_text

SCHEMA_VERSION = "1.0"
WINDOW = timedelta(days=365)  # "last 12 months", relative to the run's known_cutoff
MAX_RECENT = 2000
TOP_N = 10
_DICT = pa.dictionary(pa.int32(), pa.string())
SCHEMA = pa.schema(
    [
        pa.field("entity_id", _DICT, nullable=False),
        pa.field("series_id", pa.int32(), nullable=False),
        pa.field("ref_period_start", pa.date32(), nullable=False),
        pa.field("ref_period_end", pa.date32(), nullable=False),
        pa.field("known_at", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("source_release_at", pa.timestamp("us", tz="UTC")),
        pa.field("vintage_label", pa.string()),
        pa.field("value", pa.float64()),
        pa.field("value_status", _DICT, nullable=False),
        pa.field("load_kind", _DICT, nullable=False),
        pa.field("is_base_version", pa.bool_(), nullable=False),
        pa.field("revision_class", _DICT, nullable=False),
        pa.field("edition_ordered", pa.bool_(), nullable=False),
        pa.field("revision_abs", pa.float64()),
        pa.field("revision_pct", pa.float64()),
    ]
)
_SQL = (
    "SELECT series_id, entity_id, indicator_id, ref_period_start, ref_period_end, known_at, "
    "source_release_at, vintage_label, value, value_status, load_kind, revision_class, "
    "edition_ordered FROM curated.v_revision_history "
    "ORDER BY indicator_id, entity_id, ref_period_start, series_id, known_at"
)


@dataclass(frozen=True)
class Version:
    series_id: int
    entity_id: str
    indicator_id: str
    start: date
    end: date
    known_at: datetime
    release_at: datetime | None
    label: str | None
    value: Decimal | None
    status: str
    load_kind: str
    revision_class: str
    edition_ordered: bool
    base: bool
    previous: Decimal | None
    abs_change: Decimal | None
    pct: Decimal | None

    @property
    def is_revision(self) -> bool:
        return not self.base and self.load_kind in ("revision", "tombstone")


def _f(v: Decimal | None) -> float | None:
    return None if v is None else float(v)


def build_versions(rows: list[tuple[Any, ...]], cutoff: datetime) -> list[Version]:
    """Versions known by ``cutoff`` of keys with at least two such versions, with revision sizes.
    ``rows`` follow the column order of ``_SQL``."""
    keys: dict[tuple[Any, ...], list[tuple[Any, ...]]] = defaultdict(list)
    for r in rows:
        if r[5] <= cutoff:
            keys[(r[0], r[2], r[1], r[3])].append(r)
    out: list[Version] = []
    for k in sorted(keys):
        vs = sorted(keys[k], key=lambda r: r[5])
        if len(vs) < 2:
            continue
        prev: Decimal | None = None
        for i, r in enumerate(vs):
            val: Decimal | None = r[8]
            base = i == 0
            d: Decimal | None = None
            p: Decimal | None = None
            if not base and val is not None and prev is not None:
                d = val - prev
                p = None if prev == 0 else d / abs(prev) * 100
            out.append(
                Version(
                    r[0],
                    r[1],
                    r[2],
                    r[3],
                    r[4],
                    r[5],
                    r[6],
                    r[7],
                    val,
                    r[9],
                    r[10],
                    r[11],
                    r[12],
                    base,
                    None if base else prev,
                    d,
                    p,
                )
            )
            prev = val
    return out


def build_table(versions: list[Version]) -> pa.Table:
    """Versions of ONE indicator to the revision table, ordered (entity, period start, known_at)."""
    cols: dict[str, list[Any]] = {f.name: [] for f in SCHEMA}
    for v in sorted(versions, key=lambda x: (x.entity_id, x.start, x.series_id, x.known_at)):
        cols["entity_id"].append(v.entity_id)
        cols["series_id"].append(v.series_id)
        cols["ref_period_start"].append(v.start)
        cols["ref_period_end"].append(v.end)
        cols["known_at"].append(v.known_at)
        cols["source_release_at"].append(v.release_at)
        cols["vintage_label"].append(v.label)
        cols["value"].append(_f(v.value))
        cols["value_status"].append(v.status)
        cols["load_kind"].append(v.load_kind)
        cols["is_base_version"].append(v.base)
        cols["revision_class"].append(v.revision_class)
        cols["edition_ordered"].append(v.edition_ordered)
        cols["revision_abs"].append(_f(v.abs_change))
        cols["revision_pct"].append(_f(v.pct))
    return pa.table({f.name: pa.array(cols[f.name], type=f.type) for f in SCHEMA}, schema=SCHEMA)


def _row(v: Version) -> dict[str, Any]:
    return {
        "indicator_id": v.indicator_id,
        "entity_id": v.entity_id,
        "series_id": v.series_id,
        "ref_period_start": v.start.isoformat(),
        "known_at": utc_text(v.known_at, fractional=True),
        "previous_value": _f(v.previous),
        "value": _f(v.value),
        "revision_abs": _f(v.abs_change),
        "revision_pct": _f(v.pct),
        "load_kind": v.load_kind,
        "revision_class": v.revision_class,
    }


def _size_key(v: Version) -> tuple[Any, ...]:
    """Largest absolute percentage change first, null last, then a total order (EXP-08)."""
    pct = -abs(v.pct) if v.pct is not None else Decimal(1)
    return (v.pct is None, pct, v.indicator_id, v.entity_id, v.series_id, v.start, v.known_at)


def ordinary_revisions(versions: list[Version], cutoff: datetime) -> list[dict[str, Any]]:
    since = cutoff - WINDOW
    pool = [v for v in versions if v.is_revision and not v.edition_ordered and v.known_at >= since]
    pool.sort(key=lambda v: (v.revision_class != "regular", *_size_key(v)))
    return [_row(v) for v in pool[:MAX_RECENT]]


def edition_summaries(
    versions: list[Version], source_of: dict[int, str], cutoff: datetime
) -> list[dict[str, Any]]:
    since = cutoff - WINDOW
    groups: dict[tuple[str, str], list[Version]] = defaultdict(list)
    for v in versions:
        if not (v.is_revision and v.edition_ordered and v.known_at >= since):
            continue
        if v.series_id not in source_of:
            raise ExportError(f"EXP-10: series {v.series_id} has no source in ref.v_series_export")
        label = v.label if v.label is not None else v.known_at.astimezone(UTC).date().isoformat()
        groups[(source_of[v.series_id], label)].append(v)
    out: list[dict[str, Any]] = []
    for (source_id, label), vs in groups.items():
        pcts = [abs(v.pct) for v in vs if v.pct is not None]
        out.append(
            {
                "source_id": source_id,
                "vintage_label": label,
                "first_known_at": utc_text(min(v.known_at for v in vs), fractional=True),
                "n_series": len({v.series_id for v in vs}),
                "n_keys_revised": len(vs),
                "max_abs_pct": float(max(pcts)) if pcts else None,
                "median_abs_pct": float(statistics.median(pcts)) if pcts else None,
                "top_revisions": [_row(v) for v in sorted(vs, key=_size_key)[:TOP_N]],
            }
        )
    out.sort(key=lambda e: (e["first_known_at"], e["source_id"], e["vintage_label"]))
    out.sort(key=lambda e: e["first_known_at"], reverse=True)
    return out


def revisions_producer(session: ExportSession, run: RunInfo, sink: ExportSink) -> None:
    """Adds ``revisions/<indicator_id>.parquet`` (only indicators with a revision row) and
    ``revisions_recent.json``."""
    comparison = {
        str(r[0])
        for r in session.fetch(
            "SELECT indicator_id FROM ref.indicator WHERE kind = 'indicator' AND is_comparison"
        )
    }
    source_of = {int(r[0]): str(r[1]) for r in session.fetch(
        "SELECT series_id, source_id FROM ref.v_series_export ORDER BY series_id"
    )}  # fmt: skip
    rows = [r for r in session.fetch(_SQL) if r[2] not in comparison]
    versions = build_versions(rows, run.known_cutoff)
    by_ind: dict[str, list[Version]] = defaultdict(list)
    for v in versions:
        by_ind[v.indicator_id].append(v)
    for indicator_id in sorted(by_ind):
        vs = by_ind[indicator_id]
        if any(v.is_revision for v in vs):  # a file of base versions only is not written
            sink.add_parquet(
                f"revisions/{indicator_id}.parquet", build_table(vs), group_by="entity_id"
            )
    sink.add_json(
        "revisions_recent.json",
        {
            "schema_version": SCHEMA_VERSION,
            "known_cutoff": utc_text(run.known_cutoff, fractional=True),
            "revisions": ordinary_revisions(versions, run.known_cutoff),
            "edition_summaries": edition_summaries(versions, source_of, run.known_cutoff),
        },
        schema="revisions-recent",
    )
