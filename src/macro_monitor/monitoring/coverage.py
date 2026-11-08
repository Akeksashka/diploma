# ruff: noqa: E501
"""Coverage monitoring (validation-monitoring-spec: COV-01, MON-NMAR, BKP-02).

COV-01 is the stale-on-arrival diagnostic (excludes ``initial`` loads, ``not_yet_measurable`` below
``cov_min_entities``). MON-NMAR is the missing-not-at-random report (never changes ranks). BKP-02 lists
enabled sources that are in no database dump. BKP-01 is inactive and deliberately not evaluated.
All results are appended to ``ops.validation_result``.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Literal

import psycopg
from psycopg.types.json import Jsonb

# D14 staleness class limits in days (validation-monitoring-spec section 3); unchanged by this module.
STALENESS_LIMITS: Mapping[str, int] = {
    "MKT45": 45,
    "SURV75": 75,
    "ACT120": 120,
    "Q270": 270,
    "A730": 730,
    "TRI1460": 1460,
    "EVENT": 730,
}
COV_MIN_ENTITIES = 10
COV_WARN_SHARE = 0.25
NMAR_WARN_PP = 0.20

CovState = Literal["measured", "not_yet_measurable"]


@dataclass(frozen=True)
class ArrivalInput:
    """Latest value of one (indicator, entity) pair and how it first arrived."""

    indicator_id: str
    entity_id: str
    ref_period_end: date
    first_known_on: date
    first_load_kind: str


@dataclass(frozen=True)
class CovResult:
    indicator_id: str
    state: CovState
    n_qualifying: int
    n_with_value: int
    n_stale_on_arrival: int
    share: float | None
    warn: bool


def cov_evaluate(
    indicator_id: str,
    inputs: Iterable[ArrivalInput],
    limit_days: int,
    *,
    cov_min_entities: int = COV_MIN_ENTITIES,
    warn_share: float = COV_WARN_SHARE,
) -> CovResult:
    """COV-01 for one indicator. ``initial`` first loads do not qualify (launch date is not a publication date)."""
    items = list(inputs)
    qualifying = [i for i in items if i.first_load_kind != "initial"]
    stale = sum(1 for i in qualifying if (i.first_known_on - i.ref_period_end).days > limit_days)
    n = len(qualifying)
    if n < cov_min_entities:
        return CovResult(indicator_id, "not_yet_measurable", n, len(items), stale, None, False)
    share = stale / n
    return CovResult(indicator_id, "measured", n, len(items), stale, share, share > warn_share)


def read_arrival_inputs(conn: psycopg.Connection) -> dict[str, list[ArrivalInput]]:
    """Per indicator, per entity (headline series): the latest valued period (OBS/EST/PROV; never
    ``import`` rows, projections, MISS or tombstones) and its FIRST stored version's known date and load kind."""
    rows = conn.execute(
        """
        SELECT m.indicator_id, m.entity_id, f.ref_period_end, f.known_at::date, f.load_kind
          FROM ref.series_map m
          JOIN ref.indicator i ON i.indicator_id = m.indicator_id AND i.kind = 'indicator'
          JOIN LATERAL (
                SELECT o.ref_period_end, o.ref_period_start, o.known_at, o.load_kind
                  FROM curated.observation o
                 WHERE o.series_id = m.series_id AND o.load_kind <> 'import'
                   AND o.value_status IN ('OBS','EST','PROV')
                 ORDER BY o.ref_period_end DESC, o.known_at ASC, o.obs_id ASC
                 LIMIT 1) f ON true
         WHERE m.role = 'headline'
         ORDER BY m.indicator_id, m.entity_id
        """
    ).fetchall()
    out: dict[str, list[ArrivalInput]] = {}
    for ind, ent, end, known, kind in rows:
        out.setdefault(ind, []).append(ArrivalInput(ind, ent, end, known, kind))
    return out


def read_limits(conn: psycopg.Connection) -> dict[str, int]:
    """Staleness limit in force per indicator: class limit, or ``max(class, typical lag)`` is NOT derived here;
    ``release_lag_aware`` indicators may pass explicit overrides to :func:`record_cov01`."""
    rows = conn.execute(
        "SELECT indicator_id, staleness_class FROM ref.indicator WHERE kind = 'indicator'"
    ).fetchall()
    return {i: STALENESS_LIMITS[c] for i, c in rows}


def record_cov01(
    conn: psycopg.Connection,
    run_id: int | None,
    *,
    limit_overrides: Mapping[str, int] | None = None,
    cov_min_entities: int = COV_MIN_ENTITIES,
    warn_share: float = COV_WARN_SHARE,
) -> list[CovResult]:
    """Insert one COV-01 row per indicator with values (warn only when measured and above the threshold)."""
    limits = {**read_limits(conn), **(limit_overrides or {})}
    results: list[CovResult] = []
    for ind, items in read_arrival_inputs(conn).items():
        res = cov_evaluate(
            ind, items, limits[ind], cov_min_entities=cov_min_entities, warn_share=warn_share
        )
        results.append(res)
        detail = {
            "state": res.state,
            "n_qualifying": res.n_qualifying,
            "n_with_value": res.n_with_value,
            "n_stale_on_arrival": res.n_stale_on_arrival,
            "share": res.share,
            "limit_days": limits[ind],
            "cov_min_entities": cov_min_entities,
        }
        conn.execute(
            "INSERT INTO ops.validation_result (run_id, check_id, severity, subject, passed, metric, threshold, detail)"
            " VALUES (%s,'COV-01',%s,%s,%s,%s,%s,%s)",
            [
                run_id,
                "warn" if res.warn else "info",
                ind,
                not res.warn,
                res.share,
                warn_share,
                Jsonb(detail),
            ],
        )
    return results


# --- MON-NMAR ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class NmarResult:
    domain_id: str
    unavailable_share: dict[str, float | None]
    difference_pp: float | None
    warn: bool


def nmar_evaluate(
    domain_id: str,
    pairs: Iterable[tuple[str, bool]],
    *,
    warn_pp: float = NMAR_WARN_PP,
) -> NmarResult:
    """``pairs`` = (group, unavailable) per (indicator, entity); groups 'advanced' and 'emerging'."""
    tot = {"advanced": 0, "emerging": 0}
    bad = {"advanced": 0, "emerging": 0}
    for grp, unavailable in pairs:
        if grp in tot:
            tot[grp] += 1
            bad[grp] += int(unavailable)
    share = {g: (bad[g] / tot[g] if tot[g] else None) for g in tot}
    a, e = share["advanced"], share["emerging"]
    diff = abs(a - e) if a is not None and e is not None else None
    return NmarResult(domain_id, share, diff, diff is not None and diff > warn_pp)


def record_nmar(
    conn: psycopg.Connection, run_id: int | None, as_of: date, *, warn_pp: float = NMAR_WARN_PP
) -> list[NmarResult]:
    """Per ranked domain: share of (ranked indicator, ranked country) pairs unavailable (no value, or older
    than the staleness limit at ``as_of``) for advanced vs emerging entities (group membership valid at ``as_of``).
    Report only: writes ``ops.validation_result`` rows, touches no analytics table."""
    rows = conn.execute(
        """
        SELECT d.domain_id, g.group_id,
               (l.ref_period_end IS NULL OR (%(d)s::date - l.ref_period_end) > CASE i.staleness_class
                   WHEN 'MKT45' THEN 45 WHEN 'SURV75' THEN 75 WHEN 'ACT120' THEN 120 WHEN 'Q270' THEN 270
                   WHEN 'A730' THEN 730 WHEN 'TRI1460' THEN 1460 ELSE 730 END) AS unavailable
          FROM ref.indicator_domain d
          JOIN ref.domain dm ON dm.domain_id = d.domain_id AND dm.is_ranked
          JOIN ref.indicator i ON i.indicator_id = d.indicator_id
          JOIN ref.entity e ON e.is_ranked AND e.kind = 'country'
          JOIN ref.entity_group_member g ON g.entity_id = e.entity_id AND g.group_id IN ('advanced','emerging')
               AND g.valid_from <= %(d)s AND (g.valid_to IS NULL OR g.valid_to >= %(d)s)
          LEFT JOIN ref.series_map m ON m.indicator_id = i.indicator_id AND m.entity_id = e.entity_id AND m.role = 'headline'
          LEFT JOIN LATERAL (
                SELECT max(o.ref_period_end) AS ref_period_end FROM curated.observation o
                 WHERE o.series_id = m.series_id AND o.load_kind <> 'import'
                   AND o.value_status IN ('OBS','EST','PROV')) l ON true
         WHERE d.is_ranked
         ORDER BY d.domain_id
        """,
        {"d": as_of},
    ).fetchall()
    by_domain: dict[str, list[tuple[str, bool]]] = {}
    for dom, grp, unavailable in rows:
        by_domain.setdefault(dom, []).append((grp, bool(unavailable)))
    results: list[NmarResult] = []
    for dom, pairs in by_domain.items():
        res = nmar_evaluate(dom, pairs, warn_pp=warn_pp)
        results.append(res)
        detail = {"unavailable_share": res.unavailable_share, "difference_pp": res.difference_pp}
        conn.execute(
            "INSERT INTO ops.validation_result (run_id, check_id, severity, subject, passed, metric, threshold, detail)"
            " VALUES (%s,'MON-NMAR',%s,%s,%s,%s,%s,%s)",
            [
                run_id,
                "warn" if res.warn else "info",
                dom,
                not res.warn,
                res.difference_pp,
                warn_pp,
                Jsonb(detail),
            ],
        )
    return results


# --- BKP-02 -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class UnbackedSources:
    source_ids: tuple[str, ...]
    hash_only: tuple[str, ...]
    newly_listed: tuple[str, ...]

    @property
    def warn(self) -> bool:
        return bool(self.newly_listed)


def record_bkp02(conn: psycopg.Connection, run_id: int | None) -> UnbackedSources:
    """List enabled sources in no dump (``archive_mode <> 'public'`` or ``publish_site <> 'public'``).
    info monthly; warn when a source is listed that the previous BKP-02 row did not list.
    ``hash_only`` sources carry the statement "no replay, no backup". BKP-01 is not evaluated."""
    rows = conn.execute(
        "SELECT source_id, archive_mode FROM ref.source WHERE enabled AND (archive_mode <> 'public' OR publish_site <> 'public') ORDER BY source_id"
    ).fetchall()
    ids = tuple(r[0] for r in rows)
    hash_only = tuple(r[0] for r in rows if r[1] == "hash_only")
    prev = conn.execute(
        "SELECT detail -> 'source_ids' FROM ops.validation_result WHERE check_id = 'BKP-02' ORDER BY created_at DESC, ctid DESC LIMIT 1"
    ).fetchone()
    previous = set(prev[0]) if prev and prev[0] else set()
    new = tuple(s for s in ids if s not in previous)
    res = UnbackedSources(ids, hash_only, new)
    detail = {
        "count": len(ids),
        "source_ids": list(ids),
        "hash_only": list(hash_only),
        "newly_listed": list(new),
        "statement": "hash_only sources: no replay, no backup" if hash_only else None,
    }
    conn.execute(
        "INSERT INTO ops.validation_result (run_id, check_id, severity, subject, passed, metric, detail)"
        " VALUES (%s,'BKP-02',%s,'sources',%s,%s,%s)",
        [run_id, "warn" if res.warn else "info", not ids, len(ids), Jsonb(detail)],
    )
    return res
