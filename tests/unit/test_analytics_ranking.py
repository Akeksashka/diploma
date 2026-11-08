# ruff: noqa: E501, PT018, PT011
"""T41 unit tests: rank position, alignment states, mid-rank percentiles (AC-AN-2 percentile parts,
AC-AN-4, AC-AN-5, AC-AN-14). Expected numbers come from the analytics spec section 4.3."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from macro_monitor.analytics import alignment, scoring
from macro_monitor.analytics.alignment import RankSpec, SeriesMeta, Target
from macro_monitor.analytics.snapshot import SnapshotRow

D = Decimal
AUG, JUL, JUN, MAR = (date(2026, 8, 31), date(2026, 7, 31), date(2026, 6, 30), date(2026, 3, 31))


def row(
    ent: str, val: str | None, end: date | None, *, ind: str = "U1", stale: bool = False,
    inherited: bool = False, series: int | None = 1, scope: str = "ranked", publish: bool = True,
) -> SnapshotRow:  # fmt: skip
    v = D(val) if val is not None else None
    return SnapshotRow(
        indicator_id=ind, entity_id=ent, series_id=series if v is not None else None, value=v,
        ref_period_end=end, known_at=None, source_release_at=None, age_days=0, stale_limit_days=120,
        is_stale=stale if v is not None else None, limit_source="class", inherited=inherited,
        transformed_value=v, transform_id="LEVEL", publish=publish, publish_scope=scope,
    )  # fmt: skip


META = {1: SeriesMeta("M"), 2: SeriesMeta("A", "FISCAL"), 3: SeriesMeta("A")}


def ents(n: int) -> frozenset[str]:
    return frozenset(f"E{i:02d}" for i in range(n)) | {"IND"}


def test_rank_position_integer_arithmetic() -> None:
    assert alignment.rank_position(10, 70) == 7
    assert alignment.rank_position(20, 55) == 11  # float 0.55 * 20 would ceil to 12
    assert alignment.rank_position(3, 70) == 3
    assert alignment.rank_position(1, 70) == 1


@pytest.mark.parametrize("bad", [0.55, 0.7, 0, 101, True, "70"])
def test_fraction_and_out_of_range_rejected(bad: object) -> None:
    with pytest.raises(ValueError):
        alignment.validate_coverage_pct(bad)


def test_ten_candidates_spec_fixture() -> None:
    periods = [AUG] * 6 + [JUL] + [JUN] * 2 + [MAR]
    rows = [row(f"E{i:02d}", str(3 + i), p) for i, p in enumerate(periods)]
    spec = RankSpec("U1", "monotone_good", -1, 70)
    a = alignment.align_indicator(spec, rows, META, {}, ents(10))
    assert a.summary is not None
    assert a.summary.rank_reference_period == JUL
    states = [r.alignment for r in a.rows]
    assert states == ["ahead"] * 6 + ["aligned"] * 3 + ["lagging"]
    assert [r.ref_offset_days for r in a.rows] == [31] * 6 + [0, -31, -31, -122]
    assert a.summary.reference_period_spread_days == (AUG - JUN).days == 62  # max-min of ranked
    assert (a.summary.n_ranked, a.summary.n_unaligned) == (9, 1)
    assert a.summary.max_ref_spread_days == 92
    assert "E09" not in a.ranked


def test_twenty_candidates_pct_55() -> None:
    periods = [AUG] * 10 + [JUL] + [JUN] * 9
    rows = [row(f"E{i:02d}", str(i), p) for i, p in enumerate(periods)]
    a = alignment.align_indicator(RankSpec("U1", "monotone_good", 1, 55), rows, META, {}, ents(20))
    assert a.summary is not None and a.summary.rank_reference_period == JUL


def test_excluded_rows_stale_inherited_and_no_value() -> None:
    rows = [
        row("E00", "1", AUG), row("E01", "2", AUG), row("E02", "3", AUG),
        row("E03", "4", date(2026, 1, 31), stale=True),
        row("E04", "5", AUG, inherited=True),
        row("E05", None, None),
    ]  # fmt: skip
    a = alignment.align_indicator(RankSpec("U1", "monotone_good", 1), rows, META, {}, ents(6))
    assert [r.alignment for r in a.rows] == ["aligned"] * 3 + ["lagging", "n/a", "n/a"]
    assert a.rows[4].ref_offset_days == 0  # usable value keeps the offset
    assert a.rows[5].ref_offset_days is None
    assert a.ranked == {"E00", "E01", "E02"}
    assert a.summary is not None and a.summary.n_ranked == 3


def test_fiscal_year_basis_unaligned_never_lagging_or_ahead() -> None:
    cal = [row(f"E0{i}", str(i), date(2025, 12, 31), series=3) for i in range(3)]
    ind = row("IND", "9", date(2025, 3, 31), series=2)  # fiscal year ends March
    a = alignment.align_indicator(
        RankSpec("U1", "monotone_good", 1, max_lag_days=366), [*cal, ind], META, {}, ents(4)
    )
    assert a.rows[3].alignment == "unaligned"
    assert a.rows[3].alignment_reason == "fiscal_year_basis"
    assert [r.alignment for r in a.rows[:3]] == ["aligned"] * 3
    assert a.summary is not None
    assert (a.summary.n_ranked, a.summary.n_unaligned) == (3, 1)
    assert a.summary.reference_period_spread_days == 0
    assert "IND" not in a.ranked


def test_non_ranked_entities_and_modes_untouched() -> None:
    rows = [row("WLD", "1", AUG), row("E00", "2", AUG)]
    a = alignment.align_indicator(RankSpec("U1", "monotone_good", 1), rows, META, {}, ents(1))
    assert a.rows[0] == rows[0] and a.rows[0].alignment == "n/a"
    d = alignment.align_indicator(RankSpec("U1", "descriptive_only", 0), rows, META, {}, ents(1))
    assert d.rows == rows and d.summary is None


def test_percentile_mid_rank_spec_example() -> None:
    bad = {"A": D("3.0"), "B": D("4.0"), "C": D("4.00"), "D": D("9.0")}  # higher is worse
    p = scoring.percentiles(bad)
    assert p == {"A": D("0.875"), "B": D("0.5"), "C": D("0.5"), "D": D("0.125")}
    assert sum(p.values()) / 4 == D("0.5")


def test_percentile_single_and_all_tied() -> None:
    assert scoring.percentiles({"A": D("1")}) == {"A": D("0.5")}
    assert set(scoring.percentiles({k: D("2.50") for k in "ABC"}).values()) == {D("0.5")}


def test_decimal_equality_not_float_noise() -> None:
    # 0.1 + 0.2 != 0.3 in floats; stored decimals "0.30" and "0.3" tie
    p = scoring.percentiles({"A": D("0.30"), "B": D("0.3")})
    assert p == {"A": D("0.5"), "B": D("0.5")}


def test_good_dir_orientation() -> None:
    hi = RankSpec("X", "monotone_good", 1)
    lo = RankSpec("X", "monotone_good", -1)
    vals = {"A": D("1"), "B": D("2")}
    up = scoring.percentiles({e: scoring.badness(hi, v, None) for e, v in vals.items()})
    dn = scoring.percentiles({e: scoring.badness(lo, v, None) for e, v in vals.items()})
    assert (up["B"], up["A"]) == (D("0.75"), D("0.25"))  # higher is better
    assert (dn["A"], dn["B"]) == (D("0.75"), D("0.25"))
    with pytest.raises(ValueError):
        scoring.badness(RankSpec("X", "monotone_good", 0), D("1"), None)


def test_target_distance_ties_deviation_and_missing_target() -> None:
    spec = RankSpec("A02", "target_distance", 0)
    rows = [row("E00", "-1", AUG, ind="A02"), row("E01", "1", AUG, ind="A02"),
            row("E02", "3", AUG, ind="A02"), row("E03", "0", AUG, ind="A02")]  # fmt: skip
    tg = {f"E0{i}": Target(D("0")) for i in range(3)}  # E03 has no target
    a = alignment.align_indicator(spec, rows, META, tg, ents(4))
    assert [r.deviation for r in a.rows] == [D("-1"), D("1"), D("3"), None]
    assert a.rows[3].alignment == "n/a" and a.rows[3].ref_offset_days is None
    res = scoring.rank_all(
        rows, {"A02": spec}, META, {("A02", e): t for e, t in tg.items()}, ents(4)
    )
    pct = {r.entity_id: r.percentile for r in res.full.ranks}
    # distances 1, 1, 3: values -1 and +1 around target 0 tie; (W + T/2) / n = (1 + 1) / 3 and 0.5 / 3
    assert pct == {"E00": D(4) / D(6), "E01": D(4) / D(6), "E02": D(1) / D(6)}


def test_band_distance_zero_inside() -> None:
    t = Target(D("2"), D("1"), D("3"))
    assert alignment.distance(D("2.5"), t) == 0
    assert alignment.distance(D("4"), t) == 1
    assert alignment.distance(D("0"), t) == 1


def test_published_set_uses_only_published_pairs() -> None:
    rows = [row(f"E0{i}", str(i), AUG, publish=i != 2, scope="ranked" if i != 2 else "excluded")
            for i in range(4)]  # fmt: skip
    res = scoring.rank_all(rows, {"U1": RankSpec("U1", "monotone_good", -1)}, META, {}, ents(4))
    assert {r.entity_id for r in res.full.ranks} == {"E00", "E01", "E02", "E03"}
    assert {r.entity_id for r in res.published.ranks} == {"E00", "E01", "E03"}
    assert all(r.n_ranked == 3 for r in res.published.ranks)
    assert res.published.alignments[0].n_ranked == 3 and res.full.alignments[0].n_ranked == 4
    assert [r.alignment for r in res.rows] == ["aligned"] * 4  # snapshot uses the full set
