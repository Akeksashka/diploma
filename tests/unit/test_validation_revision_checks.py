"""T29 pure layer: REV-01..05, COMP-01..04, DB-05, materiality (AC-VAL-3, AC-VAL-7, AC-VAL-12)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal as D

from macro_monitor.storage.compare import ComparePolicy, Stored
from macro_monitor.validation.checks import Severity, Thresholds
from macro_monitor.validation.revision_checks import (
    StagedRow,
    Tally,
    check_comp_01,
    check_comp_02,
    check_comp_03,
    check_comp_04,
    check_db_05,
    check_rev_01,
    check_rev_05,
    revision_family,
    tally_series,
)

AT = datetime(2026, 10, 1, tzinfo=UTC)


def months(n: int) -> list[date]:
    return [date(2026, m, 1) for m in range(1, n + 1)]


def run(
    old: list[str],
    new: list[str],
    *,
    d: int | None = 1,
    ratio: bool = False,
    pol: ComparePolicy | None = None,
    status: str = "OBS",
) -> Tally:
    ms = months(len(old))
    prior = {m: Stored(D(o), "OBS") for m, o in zip(ms, old, strict=True)}
    rows = [StagedRow(m, D(v), status) for m, v in zip(ms, new, strict=True)]
    return tally_series(
        "d|x", rows, prior, {}, pol or ComparePolicy(), d,
        ratio_unit=ratio, frequency="M", fetched_at=AT,
    )  # fmt: skip


def test_family_chosen_by_flags() -> None:
    assert revision_family(False, False) == "REV-01"
    assert revision_family(True, False) == "REV-06"
    assert revision_family(False, True) == "REV-07"


def test_half_unit_is_noise_and_one_unit_is_material() -> None:
    t = run(["2.0", "2.0"], ["2.05", "2.1"])
    assert (t.material, t.noise, t.inserts) == (1, 1, 1)
    assert check_rev_05(t).metric == 1.0
    assert check_rev_05(t).severity is Severity.INFO


def test_ratio_unit_uses_materiality_abs_only() -> None:
    pol = ComparePolicy(materiality_abs=D("0.5"), materiality_rel=D("0.5"))
    # 0.1 is a revision under the rule; abs 0.5 not exceeded; rel term (50 % of 2) not applied
    t = run(["2.0"], ["2.6"], ratio=True, pol=pol)
    assert (t.material, t.below_materiality) == (1, 0)  # 0.6 > 0.5
    t = run(["2.0"], ["2.4"], ratio=True, pol=pol)
    assert (t.material, t.below_materiality) == (0, 1)
    # non-ratio: rel 50 % of 2 = 1.0 dominates
    t = run(["2.0"], ["2.6"], ratio=False, pol=pol)
    assert (t.material, t.below_materiality) == (0, 1)


def test_ratio_unit_zero_materiality_half_unit() -> None:
    assert run(["2.0"], ["2.05"], ratio=True).material == 0
    assert run(["2.0"], ["2.1"], ratio=True).material == 1


def test_share_25_percent_blocks_and_immaterial_does_not() -> None:
    old = ["10.0"] * 4
    mat = run(old, ["11.0", "10.0", "10.0", "10.0"])
    r = check_rev_01({"d": mat})
    assert mat.share == 0.25
    assert r.blocks
    assert r.metric == 0.25
    noise = run(old, ["10.05", "10.05", "10.05", "10.05"])
    assert not check_rev_01({"d": noise}).blocks
    exactly = run(["10.0"] * 5, ["11.0", "10.0", "10.0", "10.0", "10.0"])
    assert not check_rev_01({"d": exactly}).blocks  # 20 % is not > 20 %


def test_accepted_event_releases() -> None:
    t = run(["1.0"] * 2, ["2.0", "2.0"])
    r = check_rev_01({"d": t}, accepted_event=7)
    assert r.passed
    assert r.detail["accepted_drift_event"] == 7


def test_proj_rows_are_not_revised_keys() -> None:
    ms = months(2)
    prior = {m: Stored(D("1.0"), "PROJ") for m in ms}
    rows = [StagedRow(m, D("9.0"), "PROJ", "2026-04") for m in ms]
    t = tally_series(
        "d|x", rows, prior, {(ms[0], "2026-04"): Stored(D("1.0"), "PROJ")}, ComparePolicy(), 1,
        ratio_unit=False, frequency="A", fetched_at=AT,
    )  # fmt: skip
    assert t.material == 0
    assert t.existing_keys == 0
    assert t.inserts == 2


def test_rev_02_03_04() -> None:
    t = run(["10.0"], ["20.0"])
    assert t.large == ["d|x|2026-01-01"]
    ms = [date(2015, 1, 1)]
    t = tally_series(
        "d|x", [StagedRow(ms[0], D("2.0"), "OBS")], {ms[0]: Stored(D("1.9"), "OBS")},
        {}, ComparePolicy(), 1, ratio_unit=False, frequency="M", fetched_at=AT,
    )  # fmt: skip
    assert t.deep == 1
    t = run(["1.0"], ["3.0"], status="OBS")
    t2 = tally_series(
        "d|x", [StagedRow(date(2026, 1, 1), D("1.0"), "OBS")],
        {date(2026, 1, 1): Stored(D("2.0"), "PROJ")}, {}, ComparePolicy(), 1,
        ratio_unit=False, frequency="M", fetched_at=AT,
    )  # fmt: skip
    assert t2.proj_to_observed == 1
    assert t.proj_to_observed == 0


def test_robust_sd_history() -> None:
    ms = [date(2026, 1, 1)]
    hist = [0.1, 0.12, 0.09, 0.11, 0.1, 0.13, 0.1, 0.11, 0.12, 0.1]
    t = tally_series(
        "d|x", [StagedRow(ms[0], D("100.9"), "OBS")], {ms[0]: Stored(D("100.0"), "OBS")}, {},
        ComparePolicy(), 1, ratio_unit=False, frequency="M", fetched_at=AT, history=lambda: hist,
    )  # fmt: skip
    assert t.large  # 0.9 > 5 robust sd (about 0.02) although only 0.9 % relative


def test_db_05_cap() -> None:
    assert check_db_05(100_000).passed
    r = check_db_05(100_001)
    assert r.blocks
    assert check_db_05(5, 4).blocks
    assert check_db_05(5, 4, accepted_event=3).passed


def test_comp_01() -> None:
    assert check_comp_01(3, 3).passed
    assert check_comp_01(2, 3).blocks


def test_comp_02() -> None:
    prev = {f"d|s{i}": "E1" for i in range(40)}
    assert check_comp_02(prev, list(prev)).passed
    assert check_comp_02(prev, list(prev)[:-1]).passed  # 2.5 %
    r = check_comp_02(prev, list(prev)[:-3])  # 7.5 %
    assert r.blocks
    assert r.detail["by_entity"] == {"E1": 3}
    r = check_comp_02(prev, list(prev)[1:], core=["d|s0"], thresholds=Thresholds())
    assert r.blocks
    assert r.detail["core_disappeared"] == ["d|s0"]


def test_comp_03_04() -> None:
    assert check_comp_03({"a": (5, 100)}).passed
    assert check_comp_03({"a": (6, 100)}).blocks
    assert check_comp_04(["a", "b"], ["a"], True).severity is Severity.WARN
    assert check_comp_04(["a", "b"], ["a"], False).passed
    assert not check_comp_04(["a", "b"], ["a"], True).blocks


def test_rev_07_info_below_and_warn_at_threshold_never_blocks() -> None:
    from macro_monitor.validation.revision_checks import Tally, check_rev_07

    lo = check_rev_07(Tally(existing_keys=10, material=1))
    hi = check_rev_07(Tally(existing_keys=10, material=2))
    assert (lo.passed, lo.severity) == (True, Severity.INFO)
    assert (hi.passed, hi.severity) == (False, Severity.WARN)
    assert not hi.blocks
