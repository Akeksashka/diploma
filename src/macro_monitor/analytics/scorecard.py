"""Domain scorecards (analytics spec 4.4, T42; AC-AN-6, -9, -19, -20; AC-SYS-7).

Pure functions on the stored indicator ranks of ONE candidate set (full or published); the same
code path serves both. Rules:

- a domain is eligible when ``ref.domain.is_ranked`` and it has at least ``MIN_RANKED_INDICATORS``
  (3) ranked indicators (``kind = 'indicator'``, ``rank_mode <> descriptive_only``,
  ``indicator_domain.is_ranked``); an ineligible domain is descriptive: NO scorecard rows;
- concept de-duplication: indicators sharing a ``concept_id`` count once in ``n_defined``; the
  entity's percentile for the concept is that of its available indicator with the lowest
  ``concept_priority`` (A05/Q08, A04/Q12);
- ``percentile_rank`` is the MEAN of the entity's indicator percentiles (``MEAN_PERCENTILE_LABEL``),
  never a percentile of the domain; no imputation; NULL when ``n_available = 0``; no composite
  across domains (D6);
- ``low_coverage`` when ``n_available / n_defined < min_coverage_for_rank`` (exact ``Decimal``
  comparison); ``rank_position`` is the competition rank (ties share the best position) on the mean
  among entities with a figure that are not ``low_coverage``; ``n_ranked_entities`` is that count,
  stored on every row of the domain;
- ``peer_set_size_min/max`` = min/max of ``n_ranked`` over the domain's ranked indicators of the
  set; ``heterogeneous_peer_set`` when max/min > 1.5 (integer test ``2*max > 3*min``); identical
  on every row of the domain.

The ``core_pillars`` rule (P8) is not implemented: ``ref.domain`` has no such column (reported).
Because eligibility is static configuration, ``demote_ineligible`` can (and must, in T44) be applied
to the snapshot rows BEFORE ``write_snapshot`` so ``publish_scope`` is ``info_only`` for indicators
whose every ranked domain is descriptive.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from decimal import Decimal, localcontext
from typing import Any

import psycopg

from macro_monitor.analytics.scoring import RankingResult, RankRow
from macro_monitor.analytics.snapshot import SnapshotRow

MIN_RANKED_INDICATORS = 3
MEAN_PERCENTILE_LABEL = "mean percentile of the domain's indicators"


@dataclass(frozen=True)
class DomainDef:
    domain_id: str
    is_ranked: bool
    min_coverage: Decimal = Decimal("0.5")
    min_ranked_indicators: int = MIN_RANKED_INDICATORS


@dataclass(frozen=True)
class DomainIndicator:
    """A ranked indicator of a domain (already filtered: indicator kind, not descriptive_only,
    ``indicator_domain.is_ranked``)."""

    domain_id: str
    indicator_id: str
    concept_id: str | None = None
    concept_priority: int | None = None


@dataclass(frozen=True)
class ScorecardRow:
    domain_id: str
    entity_id: str
    n_available: int
    n_defined: int
    percentile_rank: Decimal | None
    rank_position: int | None
    n_ranked_entities: int
    low_coverage: bool
    heterogeneous_peer_set: bool
    peer_set_size_min: int | None
    peer_set_size_max: int | None


@dataclass
class ScorecardResult:
    full: list[ScorecardRow] = field(default_factory=list)
    published: list[ScorecardRow] = field(default_factory=list)


def eligible_domains(
    domains: Iterable[DomainDef], members: Iterable[DomainIndicator]
) -> dict[str, DomainDef]:
    """Domains that rank: ``is_ranked`` and at least ``min_ranked_indicators`` ranked indicators."""
    count: dict[str, int] = defaultdict(int)
    for m in members:
        count[m.domain_id] += 1
    return {
        d.domain_id: d
        for d in domains
        if d.is_ranked and count[d.domain_id] >= d.min_ranked_indicators
    }


def demote_ineligible(
    rows: Sequence[SnapshotRow],
    eligible: Mapping[str, DomainDef],
    members: Iterable[DomainIndicator],
) -> list[SnapshotRow]:
    """``publish_scope`` 'ranked' -> 'info_only' for indicators with no eligible ranked domain
    (AC-AN-25 clause 'unranked domain'). Other rows are returned unchanged, input order."""
    ok = {m.indicator_id for m in members if m.domain_id in eligible}
    return [
        replace(r, publish_scope="info_only")
        if r.publish_scope == "ranked" and r.indicator_id not in ok
        else r
        for r in rows
    ]


def _competition(means: Mapping[str, Decimal]) -> dict[str, int]:
    """Competition rank, higher mean = better; ties share the best position (1, 1, 3)."""
    return {e: 1 + sum(1 for y in means.values() if y > x) for e, x in means.items()}


def build_scorecard(
    domains: Mapping[str, DomainDef],
    members: Iterable[DomainIndicator],
    ranks: Iterable[RankRow],
    entities: Iterable[str],
) -> list[ScorecardRow]:
    """Scorecard rows of one candidate set for every eligible domain and every entity."""
    pct: dict[tuple[str, str], Decimal] = {}
    n_ranked: dict[str, int] = {}
    for r in ranks:
        pct[(r.indicator_id, r.entity_id)] = r.percentile
        n_ranked[r.indicator_id] = r.n_ranked
    by_dom: dict[str, list[DomainIndicator]] = defaultdict(list)
    for m in members:
        if m.domain_id in domains:
            by_dom[m.domain_id].append(m)
    ents = sorted(set(entities))
    out: list[ScorecardRow] = []
    for dom_id in sorted(domains):
        dom = domains[dom_id]
        units: dict[str, list[DomainIndicator]] = defaultdict(list)
        for m in by_dom[dom_id]:
            units[m.concept_id or f"\0{m.indicator_id}"].append(m)
        for u in units.values():
            u.sort(
                key=lambda m: (m.concept_priority is None, m.concept_priority or 0, m.indicator_id)
            )
        n_defined = len(units)
        sizes = [n_ranked[m.indicator_id] for m in by_dom[dom_id] if m.indicator_id in n_ranked]
        pmin, pmax = (min(sizes), max(sizes)) if sizes else (None, None)
        hetero = pmin is not None and pmax is not None and 2 * pmax > 3 * pmin
        figs: dict[str, tuple[int, Decimal | None]] = {}
        for e in ents:
            vals = []
            for u in units.values():
                got = next(
                    (pct[(m.indicator_id, e)] for m in u if (m.indicator_id, e) in pct), None
                )
                if got is not None:
                    vals.append(got)
            mean = None
            if vals:
                with localcontext() as ctx:
                    ctx.prec = 28
                    mean = sum(vals, Decimal(0)) / Decimal(len(vals))
            figs[e] = (len(vals), mean)
        low = {e: Decimal(figs[e][0]) < dom.min_coverage * n_defined for e in ents}
        rankable = {e: m for e, (_, m) in figs.items() if m is not None and not low[e]}
        pos = _competition(rankable)
        for e in ents:
            n_av, mean = figs[e]
            out.append(
                ScorecardRow(
                    dom_id, e, n_av, n_defined, mean, pos.get(e), len(rankable), low[e], hetero,
                    pmin, pmax,
                )
            )  # fmt: skip
    return out


# ------------------------------------------------------------------ database access


def load_domain_context(
    conn: psycopg.Connection[Any],
) -> tuple[dict[str, DomainDef], list[DomainIndicator], frozenset[str]]:
    """Domains, ranked domain members and ranked country entities from ``ref.*``."""
    ex = conn.execute
    domains = {
        str(r[0]): DomainDef(str(r[0]), bool(r[1]), Decimal(r[2]))
        for r in ex("SELECT domain_id, is_ranked, min_coverage_for_rank FROM ref.domain").fetchall()
    }
    members = [
        DomainIndicator(str(r[0]), str(r[1]), r[2], r[3])
        for r in ex(
            "SELECT d.domain_id, i.indicator_id, i.concept_id, i.concept_priority "
            "FROM ref.indicator_domain d JOIN ref.indicator i USING (indicator_id) "
            "WHERE i.kind = 'indicator' AND i.rank_mode <> 'descriptive_only' AND d.is_ranked "
            "ORDER BY d.domain_id, i.indicator_id"
        ).fetchall()
    ]
    ents = frozenset(
        str(r[0])
        for r in ex("SELECT entity_id FROM ref.entity WHERE is_ranked AND NOT is_global").fetchall()
    )
    return domains, members, ents


def scorecards(
    conn: psycopg.Connection[Any], res: RankingResult
) -> tuple[ScorecardResult, dict[str, DomainDef], list[DomainIndicator]]:
    """Convenience: load context, build both sets from the (completed) ranking result."""
    domains, members, ents = load_domain_context(conn)
    elig = eligible_domains(domains.values(), members)
    out = ScorecardResult(
        build_scorecard(elig, members, res.full.ranks, ents),
        build_scorecard(elig, members, res.published.ranks, ents),
    )
    return out, elig, members


def write_scorecard(
    conn: psycopg.Connection[Any], analysis_run_id: int, res: ScorecardResult
) -> None:
    """Insert both sets (insert-only); the caller commits."""
    with conn.cursor() as cur:
        for suffix, extra, ph, rows in (
            ("", "", "", res.full),
            ("_published", ", publish_scope", ", 'ranked'", res.published),
        ):
            cur.executemany(
                f"INSERT INTO analytics.scorecard{suffix} (analysis_run_id, domain_id, entity_id, "
                f"n_available, n_defined, percentile_rank, rank_position, n_ranked_entities, "
                f"low_coverage, heterogeneous_peer_set, peer_set_size_min, "
                f"peer_set_size_max{extra}) "
                f"VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s{ph})",
                [(analysis_run_id, r.domain_id, r.entity_id, r.n_available, r.n_defined,
                  r.percentile_rank, r.rank_position, r.n_ranked_entities, r.low_coverage,
                  r.heterogeneous_peer_set, r.peer_set_size_min, r.peer_set_size_max)
                 for r in rows],
            )  # fmt: skip
