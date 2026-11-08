"""``scorecard/<domain_id>.json`` and ``alerts.json`` (T83; export spec section 5, EXP-05).

The export copies the stored published-scope rows (``analytics.scorecard_published``,
``v_indicator_snapshot_published``, ``indicator_rank_published``, ``indicator_alignment_published``,
``v_alert_published``). It computes nothing: ``publish_scope``, ``ref_offset_days``, ``value_kind``,
``limit_source``, ``alignment_reason``, ``heterogeneous_peer_set`` and the peer-set sizes are read
from their stored columns and only formatted (AC-EXP-11; static check in the tests). A missing row
is a ``null``, never a derived value. Checks that fail the export: EXP-02 (global entity or input
indicator in a wrong place), EXP-05 (peer-set fields differ within a domain; rank figures in an
unranked domain).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from macro_monitor.publish.export import ExportError, ExportSession, ExportSink
from macro_monitor.publish.manifest import RunInfo, utc_text
from macro_monitor.publish.meta import META_SCHEMA_VERSION, PERCENTILE_RANK_LABEL

SCORECARD_SCHEMA_VERSION = "1.0"
PERCENTILE_LABEL = "percentile vs all ranked countries"
GLOBAL_DOMAIN_ID = "global"


def num(v: Any) -> float | int | None:
    """Format a stored number for JSON (``Decimal`` -> float); ``None`` stays ``None``."""
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    return v  # type: ignore[no-any-return]


def day(v: date | None) -> str | None:
    return None if v is None else v.isoformat()


def stamp(v: datetime | None) -> str | None:
    return None if v is None else utc_text(v, fractional=True)


def _consistent(
    rows: Sequence[Mapping[str, Any]], domain_id: str
) -> tuple[bool, int | None, int | None]:
    """Domain-level peer-set fields: identical on every stored row (EXP-05)."""
    seen = {
        (r["heterogeneous_peer_set"], r["peer_set_size_min"], r["peer_set_size_max"]) for r in rows
    }
    if len(seen) > 1:
        raise ExportError(f"EXP-05: peer-set fields differ within domain {domain_id}", "EXP-05")
    if not seen:
        return False, None, None
    het, lo, hi = next(iter(seen))
    return bool(het), lo, hi


SC_COLS = (
    "domain_id", "entity_id", "n_available", "n_defined", "percentile_rank", "rank_position",
    "n_ranked_entities", "low_coverage", "heterogeneous_peer_set", "peer_set_size_min",
    "peer_set_size_max", "publish_scope",
)  # fmt: skip
SNAP_COLS = (
    "indicator_id", "entity_id", "series_id", "value", "transformed_value", "transform_id",
    "value_kind", "ref_period_end", "ref_offset_days", "known_at", "source_release_at", "age_days",
    "stale_limit_days", "limit_source", "is_stale", "alignment", "alignment_reason", "inherited",
    "deviation", "publish", "publish_scope",
)  # fmt: skip


def _dicts(cols: Sequence[str], rows: Sequence[tuple[Any, ...]]) -> list[dict[str, Any]]:
    return [dict(zip(cols, r, strict=True)) for r in rows]


def scorecard_producer(session: ExportSession, run: RunInfo, sink: ExportSink) -> None:
    """Producer of every ``scorecard/<domain_id>.json`` (one per ``ref.domain`` row)."""
    rid = run.analysis_run_id
    domains = session.fetch(
        "SELECT domain_id, is_ranked, min_coverage_for_rank FROM ref.domain ORDER BY domain_id"
    )
    ind_info = {
        r[0]: r[1]
        for r in session.fetch(
            "SELECT indicator_id, rank_mode FROM ref.indicator "
            "WHERE kind = 'indicator' AND NOT is_comparison"
        )
    }
    in_domain: dict[str, list[str]] = defaultdict(list)
    for did, iid in session.fetch("SELECT domain_id, indicator_id FROM ref.indicator_domain"):
        if iid in ind_info:
            in_domain[did].append(iid)
    is_global = {
        r[0]: bool(r[1]) for r in session.fetch("SELECT entity_id, is_global FROM ref.entity")
    }

    sc_all = _dicts(
        SC_COLS,
        session.fetch(
            f"SELECT {', '.join(SC_COLS)} FROM analytics.scorecard_published "
            "WHERE analysis_run_id = %s ORDER BY domain_id, entity_id",
            [rid],
        ),
    )
    snaps = {
        (r["indicator_id"], r["entity_id"]): r
        for r in _dicts(
            SNAP_COLS,
            session.fetch(
                f"SELECT {', '.join(SNAP_COLS)} FROM analytics.v_indicator_snapshot_published "
                "WHERE analysis_run_id = %s",
                [rid],
            ),
        )
    }
    ranks = {
        (r[0], r[1]): (r[2], r[3])
        for r in session.fetch(
            "SELECT indicator_id, entity_id, percentile, n_ranked "
            "FROM analytics.indicator_rank_published WHERE analysis_run_id = %s",
            [rid],
        )
    }
    aligns = {
        r[0]: r[1:]
        for r in session.fetch(
            "SELECT indicator_id, rank_reference_period, reference_period_spread_days, n_ranked, "
            "n_unaligned, max_ref_spread_days FROM analytics.indicator_alignment_published "
            "WHERE analysis_run_id = %s",
            [rid],
        )
    }
    alerts = {
        (r[0], r[1]): (r[2], r[3])
        for r in session.fetch(
            "SELECT indicator_id, entity_id, level, confidence FROM analytics.v_alert_published "
            "WHERE analysis_run_id = %s",
            [rid],
        )
    }
    bad_alert = sorted({i for i, _ in alerts} - set(ind_info))
    if bad_alert:
        raise ExportError(f"EXP-02: alert rows for non-indicators {bad_alert}", "EXP-02")

    for did, ranked, min_cov in domains:
        ids = sorted(in_domain.get(did, ()))
        sc_rows = {r["entity_id"]: r for r in sc_all if r["domain_id"] == did}
        entity_ids = sorted(
            set(sc_rows) | {e for (i, e) in snaps if i in ids}
        )  # entities without a scorecard row (informational domains) still show their values
        if did != GLOBAL_DOMAIN_ID:
            wld = [e for e in entity_ids if is_global.get(e)]
            if wld:
                raise ExportError(f"EXP-02: global entity {wld} in domain {did}", "EXP-02")
        het, lo, hi = _consistent(list(sc_rows.values()), did)
        entities = []
        for eid in entity_ids:
            sc = sc_rows.get(eid)
            rows = []
            for iid in ids:
                s = snaps.get((iid, eid))
                if s is None:
                    continue
                pct, n_rk = ranks.get((iid, eid), (None, None))
                lvl, conf = alerts.get((iid, eid), (None, None))
                rows.append(
                    {
                        "indicator_id": iid,
                        "series_id": s["series_id"],
                        "value": num(s["value"]),
                        "transformed_value": num(s["transformed_value"]),
                        "transform_id": s["transform_id"],
                        "rank_mode": ind_info[iid],
                        "value_kind": s["value_kind"],
                        "ref_period_end": day(s["ref_period_end"]),
                        "ref_offset_days": s["ref_offset_days"],
                        "known_at": stamp(s["known_at"]),
                        "source_release_at": stamp(s["source_release_at"]),
                        "age_days": s["age_days"],
                        "stale_limit_days": s["stale_limit_days"],
                        "limit_source": s["limit_source"],
                        "is_stale": s["is_stale"],
                        "alignment": s["alignment"],
                        "alignment_reason": s["alignment_reason"],
                        "inherited": s["inherited"],
                        "deviation": num(s["deviation"]),
                        "published": s["publish"],
                        "publish_scope": s["publish_scope"],
                        "percentile": num(pct),
                        "percentile_label": PERCENTILE_LABEL,
                        "n_ranked": n_rk,
                        "alert_level": lvl,
                        "alert_confidence": conf,
                    }
                )
            entities.append(
                {
                    "entity_id": eid,
                    "n_available": sc["n_available"] if sc else None,
                    "n_defined": sc["n_defined"] if sc else None,
                    "percentile_rank": num(sc["percentile_rank"]) if sc else None,
                    "percentile_rank_label": PERCENTILE_RANK_LABEL,
                    "rank_position": sc["rank_position"] if sc else None,
                    "n_ranked_entities": sc["n_ranked_entities"] if sc else None,
                    "low_coverage": sc["low_coverage"] if sc else None,
                    "indicators": rows,
                }
            )
        alignment = []
        for iid in ids:
            a = aligns.get(iid)
            alignment.append(
                {
                    "indicator_id": iid,
                    "rank_reference_period": day(a[0]) if a else None,
                    "reference_period_spread_days": a[1] if a else None,
                    "n_ranked": a[2] if a else None,
                    "n_unaligned": a[3] if a else None,
                    "max_ref_spread_days": a[4] if a else None,
                }
            )
        if not ranked:
            leaks = [
                e["entity_id"]
                for e in entities
                if e["percentile_rank"] is not None
                or e["rank_position"] is not None
                or any(i["percentile"] is not None for i in e["indicators"])
            ]
            if leaks:
                raise ExportError(
                    f"EXP-05: rank figures in unranked domain {did}: {leaks[:5]}", "EXP-05"
                )
        doc = {
            "schema_version": SCORECARD_SCHEMA_VERSION,
            "domain_id": did,
            "analysis_run_id": rid,
            "ranked": bool(ranked),
            "min_coverage_for_rank": float(min_cov),
            "percentile_rank_label": PERCENTILE_RANK_LABEL,
            "heterogeneous_peer_set": het,
            "peer_set_size_by_indicator": {"min": lo, "max": hi},
            "alignment": alignment,
            "entities": entities,
        }
        sink.add_json(f"scorecard/{did}.json", doc, schema="scorecard", rows=len(entities))


ALERT_COLS = (
    "indicator_id", "entity_id", "series_id", "ref_period_end", "method", "z", "level",
    "confidence", "reason", "label", "override_rule",
)  # fmt: skip


def alerts_producer(session: ExportSession, run: RunInfo, sink: ExportSink) -> None:
    """``alerts.json``: published ``watch`` and ``alert`` rows of the run (nothing else)."""
    known = {
        r[0]
        for r in session.fetch(
            "SELECT indicator_id FROM ref.indicator WHERE kind = 'indicator' AND NOT is_comparison"
        )
    }
    rows = _dicts(
        ALERT_COLS,
        session.fetch(
            f"SELECT {', '.join(ALERT_COLS)} FROM analytics.v_alert_published "
            "WHERE analysis_run_id = %s AND level IN ('watch', 'alert') "
            "ORDER BY indicator_id, entity_id",
            [run.analysis_run_id],
        ),
    )
    stray = sorted({r["indicator_id"] for r in rows} - known)
    if stray:
        raise ExportError(f"EXP-02: alerts for non-indicators {stray}", "EXP-02")
    for r in rows:
        r["z"] = num(r["z"])
        r["ref_period_end"] = day(r["ref_period_end"])
    sink.add_json(
        "alerts.json",
        {
            "schema_version": META_SCHEMA_VERSION,
            "analysis_run_id": run.analysis_run_id,
            "alerts": rows,
        },
        schema="alerts",
        rows=len(rows),
    )
