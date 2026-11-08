"""T27 comparison function (I-CUR-3, T-DDL-13, AC-ING-16): pure, offline."""

from __future__ import annotations

from decimal import Decimal as D

import pytest

from macro_monitor.storage.compare import (
    Action,
    ComparePolicy,
    Stored,
    decide,
    max_scale,
    scale,
    values_equal,
)

P = ComparePolicy()


def act(old: str, new: str, d: int | None, policy: ComparePolicy = P) -> Action:
    return decide(Stored(D(old), "OBS"), D(new), "OBS", policy, d).action


def test_scale() -> None:
    assert (scale(D("2.10")), scale(D("2.1")), scale(D("5")), scale(D("1E+2"))) == (2, 1, 0, 0)
    assert max_scale([D("1"), D("2.25"), D("3.5")]) == 2
    assert max_scale([]) is None


def test_float_noise_and_trailing_zero_are_equal() -> None:
    assert act("2.1", "2.1000000001", 1) is Action.EQUAL
    assert act("2.10", "2.1", 2) is Action.EQUAL


def test_one_decimal_boundaries() -> None:
    assert act("2.1", "2.14", 1) is Action.EQUAL
    assert act("2.1", "2.16", 1) is Action.INSERT
    assert act("2.1", "2.2", 1) is Action.INSERT


def test_exactly_half_unit_is_equal_and_one_unit_is_stored() -> None:
    assert act("1.00", "1.005", 2) is Action.EQUAL
    assert act("1.005", "1.00", 2) is Action.EQUAL
    assert act("1.00", "1.01", 2) is Action.INSERT


def test_zero_decimals_ac_ing_16() -> None:
    assert act("100", "100.4", 0) is Action.EQUAL
    assert act("100", "100.5", 0) is Action.EQUAL
    assert act("100", "101", 0) is Action.INSERT


def test_unknown_decimals_uses_smaller_scale_and_flags_fallback() -> None:
    dec = decide(Stored(D("2.1"), "OBS"), D("2.14"), "OBS", P, None)
    assert dec.action is Action.EQUAL
    assert dec.fallback
    assert decide(Stored(D("2.1"), "OBS"), D("2.16"), "OBS", P, None).action is Action.INSERT
    assert decide(Stored(D("2.1"), "OBS"), D("2.1"), "OBS", P, 1).fallback is False


def test_relative_epsilon_dominates_for_large_values() -> None:
    assert values_equal(D("1000000000"), D("1000000000.4"), 0, D("1e-9")) == (True, False)
    assert values_equal(D("1000000000"), D("1000000005"), 0, D("1e-9"))[0] is False
    assert values_equal(D("1000000000"), D("1000000005"), 0, D("1e-8"))[0] is True


def test_fixed_decimals_overrides_series_decimals() -> None:
    pol = ComparePolicy(compare_mode="fixed_decimals", fixed_decimals=0)
    assert act("10", "10.4", 3, pol) is Action.EQUAL


def test_status_compares_exactly() -> None:
    assert decide(Stored(D("2.1"), "PROV"), D("2.1"), "OBS", P, 1).action is Action.INSERT


def test_miss_rows() -> None:
    assert decide(Stored(None, "MISS"), None, "MISS", P, 1).action is Action.EQUAL
    assert decide(Stored(D("1"), "OBS"), None, "MISS", P, 1).action is Action.INSERT
    assert decide(Stored(None, "MISS"), D("1"), "OBS", P, 1).action is Action.INSERT
    assert decide(Stored(None, "DEL"), D("1"), "OBS", P, 1).action is Action.INSERT


def test_absent_key_inserts() -> None:
    assert decide(None, D("1"), "OBS", P, 1).action is Action.INSERT


@pytest.mark.parametrize(
    ("ratio", "new", "want"),
    [
        (False, "100.2", Action.BELOW_TOL),
        (False, "101", Action.INSERT),
        (True, "100.2", Action.INSERT),
    ],
)
def test_diff_above_tol_materiality(ratio: bool, new: str, want: Action) -> None:
    pol = ComparePolicy(
        snapshot_mode="diff_above_tol",
        materiality_abs=D("0.05"),
        materiality_rel=D("0.005"),
        ratio_unit=ratio,
    )
    assert act("100", new, 1, pol) is want
    # status changes and new periods ignore the tolerance
    assert decide(Stored(D("100"), "PROV"), D("100"), "OBS", pol, 1).action is Action.INSERT
    assert decide(None, D("100"), "OBS", pol, 1).action is Action.INSERT
