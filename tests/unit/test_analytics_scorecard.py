# ruff: noqa: E501, PT018
"""T42 unit tests: domain eligibility, concept de-duplication, coverage, competition rank and
peer-set columns (analytics spec 4.4; AC-AN-6, -9, -19, -20; AC-SYS-7). Numbers come from the spec."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal

from macro_monitor.analytics import scorecard as sc
from macro_monitor.analytics.scoring import RankRow
from macro_monitor.analytics.snapshot import SnapshotRow

D = Decimal


def dom(i: str = "d", ranked: bool = True, cov: str = "0.5") -> sc.DomainDef:
    return sc.DomainDef(i, ranked, D(cov))


def mem(*ids: str, domain: str = "d") -> list[sc.DomainIndicator]:
    return [sc.DomainIndicator(domain, i) for i in ids]


def ranks(ind: str, pcts: dict[str, str]) -> list[RankRow]:
    return [RankRow(ind, e, D(p), len(pcts)) for e, p in pcts.items()]


def build(
    members: list[sc.DomainIndicator],
    rk: list[RankRow],
    ents: list[str],
    d: sc.DomainDef | None = None,
) -> dict[str, sc.ScorecardRow]:
    d = d or dom()
    elig = sc.eligible_domains([d], members)
    return {r.entity_id: r for r in sc.build_scorecard(elig, members, rk, ents)}


def test_domain_below_three_ranked_is_descriptive() -> None:  # AC-AN-6
    two = mem("I1", "I2")
    assert sc.eligible_domains([dom()], two) == {}
    assert set(sc.eligible_domains([dom()], mem("I1", "I2", "I3"))) == {"d"}
    assert sc.build_scorecard({}, two, ranks("I1", {"A": "0.5"}), ["A"]) == []
    assert (
        sc.eligible_domains([dom("agri", ranked=False)], mem("I1", "I2", "I3", domain="agri")) == {}
    )


def test_mean_percentile_n_defined_and_competition_rank() -> None:
    m = mem("I1", "I2", "I3")
    rk = (
        ranks("I1", {"A": "0.9", "B": "0.5", "C": "0.5"})
        + ranks("I2", {"A": "0.7", "B": "0.5", "C": "0.5"})
        + ranks("I3", {"A": "0.8", "B": "0.5"})
    )
    r = build(m, rk, ["A", "B", "C", "D"])
    assert (r["A"].n_available, r["A"].n_defined) == (3, 3)
    assert r["A"].percentile_rank == D("0.8")
    assert r["A"].rank_position == 1
    assert r["B"].rank_position == 2 and r["B"].percentile_rank == D("0.5")
    assert r["C"].n_available == 2 and r["C"].percentile_rank == D("0.5")
    assert r["C"].rank_position == 2  # tie shares the best position
    assert all(x.n_ranked_entities == 3 for x in r.values())


def test_zero_available_has_null_figure_and_rank() -> None:  # AC-SYS-7
    r = build(mem("I1", "I2", "I3"), ranks("I1", {"A": "0.5"}), ["A", "Z"])
    z = r["Z"]
    assert (z.n_available, z.n_defined) == (0, 3)
    assert z.percentile_rank is None and z.rank_position is None and z.low_coverage


def test_low_coverage_threshold_and_one_of_ten_never_outranks() -> None:  # AC-AN-9
    ids = [f"I{i}" for i in range(10)]
    m = mem(*ids)
    rk = ranks("I0", {"ONE": "1.0", "NINE": "0.4", "FIVE": "0.3"})
    for i in ids[1:9]:
        rk += ranks(i, {"NINE": "0.4"})
    for i in ids[1:5]:
        rk += ranks(i, {"FIVE": "0.3"})
    r = build(m, rk, ["ONE", "NINE", "FIVE"])
    assert r["ONE"].low_coverage and r["ONE"].rank_position is None
    assert r["ONE"].percentile_rank == D("1.0")  # shown unranked, n/N present
    assert not r["FIVE"].low_coverage and r["FIVE"].n_available == 5  # exactly 0.5 is ranked
    assert r["NINE"].rank_position == 1 and r["FIVE"].rank_position == 2
    four = ranks("I0", {"X": "0.5"}) + [x for i in ids[1:4] for x in ranks(i, {"X": "0.5"})]
    assert build(m, four, ["X"])["X"].low_coverage  # 0.4 < 0.5


def test_concept_counts_once_and_lowest_priority_wins() -> None:  # AC-AN-20
    m = [
        sc.DomainIndicator("d", "A05", "debt", 2),
        sc.DomainIndicator("d", "Q08", "debt", 1),
        sc.DomainIndicator("d", "I1"),
        sc.DomainIndicator("d", "I2"),
    ]
    rk = (
        ranks("A05", {"EU": "0.2", "US": "0.6"})
        + ranks("Q08", {"EU": "0.8"})
        + ranks("I1", {"EU": "0.4", "US": "0.4"})
        + ranks("I2", {"EU": "0.6", "US": "0.4"})
    )
    r = build(m, rk, ["EU", "US"])
    assert r["EU"].n_defined == r["US"].n_defined == 3
    assert r["EU"].n_available == 3 and r["EU"].percentile_rank == D("0.6")  # Q08 0.8, not A05
    assert r["US"].percentile_rank == (D("0.6") + D("0.4") + D("0.4")) / 3  # A05 used when no Q08


def _peer(small: int, big: int) -> sc.ScorecardRow:
    m = mem("A02", "I2", "I3")
    rk = [RankRow("A02", f"E{i}", D("0.5"), small) for i in range(2)]
    rk += [RankRow("I2", f"E{i}", D("0.5"), big) for i in range(2)]
    rk += [RankRow("I3", f"E{i}", D("0.5"), big) for i in range(2)]
    return next(iter(build(m, rk, ["E0", "E1"]).values()))


def test_heterogeneous_peer_set_boundary() -> None:  # AC-AN-19
    hi = _peer(25, 42)  # 42/25 = 1.68
    assert hi.heterogeneous_peer_set and (hi.peer_set_size_min, hi.peer_set_size_max) == (25, 42)
    lo = _peer(25, 36)  # 1.44
    assert not lo.heterogeneous_peer_set and (lo.peer_set_size_min, lo.peer_set_size_max) == (
        25,
        36,
    )
    assert not _peer(2, 3).heterogeneous_peer_set  # exactly 1.5 is not greater


def test_peer_set_identical_on_every_row() -> None:
    m = mem("A02", "I2", "I3")
    rk = [RankRow("A02", "A", D("0.5"), 25), RankRow("I2", "B", D("0.5"), 42)]
    rk += [RankRow("I3", "A", D("0.5"), 42)]
    rows = sc.build_scorecard(sc.eligible_domains([dom()], m), m, rk, ["A", "B", "C"])
    assert {(r.heterogeneous_peer_set, r.peer_set_size_min, r.peer_set_size_max) for r in rows} == {
        (True, 25, 42)
    }


def test_no_cross_domain_composite() -> None:
    m = mem("I1", "I2", "I3") + mem("J1", "J2", "J3", domain="e")
    elig = sc.eligible_domains([dom(), dom("e")], m)
    rows = sc.build_scorecard(elig, m, ranks("I1", {"A": "0.9"}) + ranks("J1", {"A": "0.1"}), ["A"])
    assert {(r.domain_id, r.percentile_rank) for r in rows} == {("d", D("0.9")), ("e", D("0.1"))}


def test_demote_ineligible_publish_scope() -> None:
    def row(ind: str, scope: str) -> SnapshotRow:
        return SnapshotRow(ind, "A", None, None, date(2026, 1, 1), None, None, 1, 1, False,
                           "class", False, None, None, True, scope)  # fmt: skip

    m = mem("I1", "I2", "I3") + mem("J1", "J2", domain="e")
    elig = sc.eligible_domains([dom(), dom("e")], m)
    rows = [row("I1", "ranked"), row("J1", "ranked"), row("J2", "excluded")]
    out = sc.demote_ineligible(rows, elig, m)
    assert [r.publish_scope for r in out] == ["ranked", "info_only", "excluded"]
    assert replace(rows[0]) == out[0]
