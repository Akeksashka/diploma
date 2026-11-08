"""Mid-rank percentiles and the ranking driver (analytics spec 4.3 steps 1-4, T41).

``percentile(e) = (W + 0.5 * T) / n`` over the ranked set R (aligned + ahead), ``T`` counting the
entity itself. "Worse" is decided on the stored ``Decimal`` values (never floats): higher value is
worse for ``good_dir = -1``, lower for ``good_dir = +1``, larger distance to the target for
``target_distance``. ``rank_all`` runs ONE code path for the full set and the published set; only
the candidate filter differs. Snapshot rows completed with alignment / ``ref_offset_days`` /
``deviation`` come from the FULL set (the snapshot is one insert-only table; the published view
masks withheld pairs) and must be written BEFORE ``write_snapshot``.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal, localcontext
from typing import Any

import psycopg

from macro_monitor.analytics import alignment
from macro_monitor.analytics.alignment import AlignmentSummary, RankSpec, SeriesMeta, Target
from macro_monitor.analytics.runctx import RunRecord
from macro_monitor.analytics.snapshot import SnapshotRow


@dataclass(frozen=True)
class RankRow:
    indicator_id: str
    entity_id: str
    percentile: Decimal
    n_ranked: int


@dataclass
class SetResult:
    ranks: list[RankRow] = field(default_factory=list)
    alignments: list[AlignmentSummary] = field(default_factory=list)


@dataclass
class RankingResult:
    rows: list[SnapshotRow]  # snapshot rows completed from the FULL set, input order
    full: SetResult
    published: SetResult


def badness(spec: RankSpec, value: Decimal, target: Target | None) -> Decimal:
    """Key where a LARGER number is WORSE (exact Decimal arithmetic only)."""
    if spec.rank_mode == "target_distance":
        if target is None:
            raise ValueError(f"{spec.indicator_id}: target_distance value without a target")
        return alignment.distance(value, target)
    if spec.good_dir == 1:
        return -value
    if spec.good_dir == -1:
        return value
    raise ValueError(f"{spec.indicator_id}: monotone_good needs good_dir +1 or -1")


def percentiles(bad: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """Mid-rank percentile per entity from its badness key; ties compared with Decimal ``==``."""
    n = len(bad)
    out: dict[str, Decimal] = {}
    for e, x in bad.items():
        worse = sum(1 for y in bad.values() if y > x)  # W: larger badness = worse
        ties = sum(1 for y in bad.values() if y == x)  # T, includes e itself
        with localcontext() as ctx:
            ctx.prec = 28
            out[e] = Decimal(2 * worse + ties) / Decimal(2 * n)
    return out


def _score(
    spec: RankSpec,
    aligned: alignment.Aligned,
    targets: Mapping[str, Target],
    res: SetResult,
) -> None:
    if aligned.summary is None:
        return
    res.alignments.append(aligned.summary)
    bad: dict[str, Decimal] = {}
    for r in aligned.rows:
        if r.entity_id in aligned.ranked and r.transformed_value is not None:
            bad[r.entity_id] = badness(spec, r.transformed_value, targets.get(r.entity_id))
    n = len(bad)
    for e, p in sorted(percentiles(bad).items()):
        res.ranks.append(RankRow(spec.indicator_id, e, p, n))


def rank_all(
    rows: Sequence[SnapshotRow],
    specs: Mapping[str, RankSpec],
    meta: Mapping[int, SeriesMeta],
    targets: Mapping[tuple[str, str], Target],
    ranked_entities: frozenset[str],
) -> RankingResult:
    """Align and rank every indicator for the full and the published candidate sets."""
    by_ind: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        by_ind[r.indicator_id].append(i)
    out: list[SnapshotRow] = list(rows)
    full, pub = SetResult(), SetResult()
    for ind in sorted(by_ind):
        idx = by_ind[ind]
        spec = specs.get(ind)
        if spec is None:
            continue
        sub = [rows[i] for i in idx]
        tgt = {e: t for (i2, e), t in targets.items() if i2 == ind}
        a_full = alignment.align_indicator(spec, sub, meta, tgt, ranked_entities)
        for i, r in zip(idx, a_full.rows, strict=True):
            out[i] = r
        _score(spec, a_full, tgt, full)
        a_pub = alignment.align_indicator(
            spec, sub, meta, tgt, ranked_entities, published_only=True
        )
        _score(spec, a_pub, tgt, pub)
    return RankingResult(out, full, pub)


# ------------------------------------------------------------------ database access


def load_context(
    conn: psycopg.Connection[Any], run: RunRecord, rows: Sequence[SnapshotRow]
) -> tuple[
    dict[str, RankSpec], dict[int, SeriesMeta], dict[tuple[str, str], Target], frozenset[str]
]:
    """RankSpecs (``ref.indicator``), series metadata, targets in force on the run date and the
    ranked country entities."""
    ex = conn.execute
    specs: dict[str, RankSpec] = {}
    for iid, mode, gd, lag, params in ex(
        "SELECT indicator_id, rank_mode, good_dir, max_ref_spread_days, params "
        "FROM ref.indicator WHERE kind = 'indicator'"
    ).fetchall():
        pct = (params or {}).get("rank_period_coverage_pct", alignment.DEFAULT_COVERAGE_PCT)
        specs[str(iid)] = RankSpec(
            str(iid), str(mode), int(gd), alignment.validate_coverage_pct(pct), lag
        )
    ids = sorted({r.series_id for r in rows if r.series_id is not None})
    meta = {
        int(r[0]): SeriesMeta(str(r[1]), str(r[2]))
        for r in ex(
            "SELECT series_id, frequency, calendar_basis FROM ref.series WHERE series_id = ANY(%s)",
            [ids],
        ).fetchall()
    }
    d = run.as_of_run_date
    targets = {
        (str(r[0]), str(r[1])): Target(r[2], r[3], r[4])
        for r in ex(
            "SELECT indicator_id, entity_id, target_value, band_low, band_high "
            "FROM ref.indicator_target WHERE valid_from <= %s "
            "AND (valid_to IS NULL OR valid_to >= %s) "
            "ORDER BY valid_from",
            [d, d],
        ).fetchall()
    }
    ranked = frozenset(
        str(r[0])
        for r in ex("SELECT entity_id FROM ref.entity WHERE is_ranked AND NOT is_global").fetchall()
    )
    return specs, meta, targets, ranked


def rank_run(
    conn: psycopg.Connection[Any], run: RunRecord, rows: Sequence[SnapshotRow]
) -> RankingResult:
    """Convenience: load the context from the database and run ``rank_all``."""
    specs, meta, targets, ranked = load_context(conn, run, rows)
    return rank_all(rows, specs, meta, targets, ranked)


def write_ranking(conn: psycopg.Connection[Any], analysis_run_id: int, res: RankingResult) -> None:
    """Insert rank and alignment rows of both sets (insert-only); the caller commits."""
    with conn.cursor() as cur:
        for suffix, extra, s in (
            ("", "", res.full),
            ("_published", ", publish_scope", res.published),
        ):
            ph = ", 'ranked'" if extra else ""
            cur.executemany(
                f"INSERT INTO analytics.indicator_rank{suffix} (analysis_run_id, indicator_id, "
                f"entity_id, percentile, n_ranked{extra}) VALUES (%s,%s,%s,%s,%s{ph})",
                [(analysis_run_id, r.indicator_id, r.entity_id, r.percentile, r.n_ranked)
                 for r in s.ranks],
            )  # fmt: skip
            cur.executemany(
                f"INSERT INTO analytics.indicator_alignment{suffix} (analysis_run_id, "
                f"indicator_id, "
                f"rank_reference_period, reference_period_spread_days, n_ranked, n_unaligned, "
                f"max_ref_spread_days{extra}) VALUES (%s,%s,%s,%s,%s,%s,%s{ph})",
                [(analysis_run_id, a.indicator_id, a.rank_reference_period,
                  a.reference_period_spread_days, a.n_ranked, a.n_unaligned, a.max_ref_spread_days)
                 for a in s.alignments],
            )  # fmt: skip
