"""Rank candidates, rank reference period and alignment states (analytics spec 4.3, T41).

Pure functions on ``SnapshotRow``; the same code serves the full and the published candidate set
(``published_only``). Rules:

- candidates: ranked-country entity, rank mode ``monotone_good`` / ``target_distance``, usable
  ``transformed_value``, not stale, not inherited, not fiscal-year basis, and (target_distance) a
  target; in the published set additionally ``publish_scope = 'ranked'``;
- ``rank_reference_period`` = the value at 1-based position ``(pct * n + 99) // 100`` of the
  candidates' latest ``ref_period_end`` values, descending (INTEGER arithmetic; a fraction such as
  0.55 is rejected);
- candidates later than it are ``ahead``; on or before it within ``max_lag`` days ``aligned``;
  further behind ``lagging``; ``calendar_basis <> 'CAL'`` is ``unaligned`` with reason
  ``fiscal_year_basis`` and takes no part in the position or the spread;
- non-candidates with a usable value (stale, inherited, not published in the published set) keep
  ``ref_offset_days``; they are ``lagging`` when beyond ``max_lag`` behind, otherwise ``n/a``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal

from macro_monitor.analytics.snapshot import SnapshotRow

RANKED_MODES = frozenset({"monotone_good", "target_distance"})
DEFAULT_COVERAGE_PCT = 70
DEFAULT_MAX_LAG_DAYS: Mapping[str, int] = {"M": 92, "Q": 190, "A": 366}  # config P2
FISCAL_REASON = "fiscal_year_basis"


def validate_coverage_pct(pct: object) -> int:
    """Integer percent in [1, 100]; fractions (0.70), floats, bools, out-of-range rejected."""
    if isinstance(pct, bool) or not isinstance(pct, int):
        raise ValueError(f"rank_period_coverage_pct must be an integer percent, got {pct!r}")
    if not 1 <= pct <= 100:
        raise ValueError(f"rank_period_coverage_pct must be in [1, 100], got {pct}")
    return pct


def rank_position(n: int, pct: int) -> int:
    """1-based position ``(pct * n + 99) // 100`` (= ceil(pct/100 * n) without floats)."""
    if n < 1:
        raise ValueError("rank position needs at least one candidate")
    return (validate_coverage_pct(pct) * n + 99) // 100


@dataclass(frozen=True)
class SeriesMeta:
    frequency: str  # 'M' | 'Q' | 'A' | 'D'
    calendar_basis: str = "CAL"


@dataclass(frozen=True)
class Target:
    """``ref.indicator_target`` row in force; band edges optional (distance 0 inside the band)."""

    value: Decimal
    band_low: Decimal | None = None
    band_high: Decimal | None = None


@dataclass(frozen=True)
class RankSpec:
    indicator_id: str
    rank_mode: str
    good_dir: int
    coverage_pct: int = DEFAULT_COVERAGE_PCT
    max_lag_days: int | None = None  # indicator override; None = frequency default


@dataclass(frozen=True)
class AlignmentSummary:
    """One ``indicator_alignment`` row."""

    indicator_id: str
    rank_reference_period: date
    reference_period_spread_days: int
    n_ranked: int
    n_unaligned: int
    max_ref_spread_days: int


@dataclass(frozen=True)
class Aligned:
    rows: list[SnapshotRow]  # same order and length as the input
    summary: AlignmentSummary | None  # None: no candidates
    ranked: frozenset[str]  # entities in R (aligned + ahead)


def max_lag(spec: RankSpec, meta: SeriesMeta) -> int:
    if spec.max_lag_days is not None:
        return spec.max_lag_days
    try:
        return DEFAULT_MAX_LAG_DAYS[meta.frequency]
    except KeyError:
        raise ValueError(f"no max lag for frequency {meta.frequency!r}") from None


def deviation(tv: Decimal, target: Target) -> Decimal:
    """Transformed value minus target (snapshot ``deviation``)."""
    return tv - target.value


def distance(tv: Decimal, target: Target) -> Decimal:
    """Absolute distance to the target, or to the nearest band edge (0 inside the band)."""
    if target.band_low is not None and target.band_high is not None:
        if tv < target.band_low:
            return target.band_low - tv
        if tv > target.band_high:
            return tv - target.band_high
        return Decimal(0)
    return abs(tv - target.value)


def _usable(spec: RankSpec, row: SnapshotRow, targets: Mapping[str, Target]) -> bool:
    if row.transformed_value is None or row.ref_period_end is None:
        return False
    return spec.rank_mode != "target_distance" or row.entity_id in targets


def align_indicator(
    spec: RankSpec,
    rows: Sequence[SnapshotRow],
    meta: Mapping[int, SeriesMeta],
    targets: Mapping[str, Target],
    ranked_entities: frozenset[str],
    *,
    published_only: bool = False,
) -> Aligned:
    """Align one indicator's snapshot rows. ``rows`` are the rows of ``spec.indicator_id`` only.

    Rows of entities outside ``ranked_entities`` (WLD, aggregates) and rows of indicators that are
    not ranked are returned unchanged.
    """
    if spec.rank_mode not in RANKED_MODES:
        return Aligned(list(rows), None, frozenset())
    validate_coverage_pct(spec.coverage_pct)

    def is_fiscal(r: SnapshotRow) -> bool:
        return r.series_id is not None and meta[r.series_id].calendar_basis != "CAL"

    cands = [
        r
        for r in rows
        if r.entity_id in ranked_entities
        and _usable(spec, r, targets)
        and r.is_stale is False
        and not r.inherited
        and not is_fiscal(r)
        and (not published_only or r.publish_scope == "ranked")
    ]
    ref: date | None = None
    if cands:
        latest = sorted((c.ref_period_end for c in cands if c.ref_period_end), reverse=True)
        ref = latest[rank_position(len(cands), spec.coverage_pct) - 1]
    cand_ids = {c.entity_id for c in cands}

    out: list[SnapshotRow] = []
    ranked: set[str] = set()
    ranked_periods: list[date] = []
    lags: list[int] = []
    n_unaligned = 0
    for r in rows:
        if r.entity_id not in ranked_entities:
            out.append(r)
            continue
        usable = _usable(spec, r, targets)
        dev = (
            deviation(r.transformed_value, targets[r.entity_id])
            if spec.rank_mode == "target_distance" and usable and r.transformed_value is not None
            else None
        )
        if not usable or r.ref_period_end is None or r.series_id is None:
            out.append(replace(r, alignment="n/a", alignment_reason=None, ref_offset_days=None,
                               deviation=dev))  # fmt: skip
            continue
        offset = (r.ref_period_end - ref).days if ref is not None else None
        if is_fiscal(r):
            n_unaligned += 1
            out.append(replace(r, alignment="unaligned", alignment_reason=FISCAL_REASON,
                               ref_offset_days=offset, deviation=dev))  # fmt: skip
            continue
        lag = max_lag(spec, meta[r.series_id])
        if offset is None:
            state = "n/a"
        elif r.entity_id in cand_ids:
            state = "ahead" if offset > 0 else ("aligned" if offset >= -lag else "lagging")
        else:
            state = "lagging" if offset < -lag else "n/a"
        if state in ("aligned", "ahead"):
            ranked.add(r.entity_id)
            ranked_periods.append(r.ref_period_end)
            lags.append(lag)
        elif state == "lagging":
            n_unaligned += 1
        out.append(replace(r, alignment=state, alignment_reason=None, ref_offset_days=offset,
                           deviation=dev))  # fmt: skip
    summary = None
    if ref is not None:
        summary = AlignmentSummary(
            spec.indicator_id,
            ref,
            (max(ranked_periods) - min(ranked_periods)).days,
            len(ranked),
            n_unaligned,
            max(lags),
        )
    return Aligned(out, summary, frozenset(ranked))
