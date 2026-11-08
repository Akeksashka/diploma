"""Unit tests for analytics.transforms (T38)."""

from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal

import pytest

from macro_monitor.analytics import transforms as t
from macro_monitor.analytics.transforms import Point
from macro_monitor.models.enums import Frequency

pytestmark = pytest.mark.unit

D = Decimal


def months(start_year: int, start_month: int, values: list[str | None]) -> list[Point]:
    out: list[Point] = []
    y, m = start_year, start_month
    for v in values:
        out.append(Point(date(y, m, calendar.monthrange(y, m)[1]), None if v is None else D(v)))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def quarters(start_year: int, values: list[str | None]) -> list[Point]:
    out = []
    for i, v in enumerate(values):
        y, q = start_year + i // 4, i % 4 + 1
        end_m = 3 * q
        out.append(
            Point(date(y, end_m, calendar.monthrange(y, end_m)[1]), None if v is None else D(v))
        )
    return out


def vals(points: list[Point]) -> list[Decimal | None]:
    return [p.value for p in points]


def test_level_passes_through_and_keeps_miss() -> None:
    assert vals(t.level(months(2026, 1, ["1", None, "3"]))) == [D(1), None, D(3)]


def test_yoy_monthly() -> None:
    s = months(2025, 1, ["100"] * 12 + ["110", "99"])
    out = t.yoy(s, Frequency.M)
    assert vals(out)[:12] == [None] * 12
    assert out[12].value == D(10)
    assert out[13].value == D(-1)


def test_yoy_quarterly_and_annual() -> None:
    q = quarters(2025, ["100", "100", "100", "100", "105"])
    assert t.yoy(q, Frequency.Q)[4].value == D(5)
    a = [Point(date(2025, 12, 31), D(200)), Point(date(2026, 12, 31), D(210))]
    assert t.yoy(a, Frequency.A)[1].value == D(5)


def test_yoy_miss_is_absent_never_zero() -> None:
    cur_miss = months(2025, 1, ["100"] * 12 + [None])
    assert t.yoy(cur_miss, Frequency.M)[12].value is None  # current period MISS
    base_miss = months(2025, 1, [None] + ["100"] * 11 + ["110"])
    assert t.yoy(base_miss, Frequency.M)[12].value is None  # base period MISS


def test_yoy_gap_in_series_uses_calendar_lag_not_position() -> None:
    s = months(2025, 1, ["100"] * 13)
    del s[5]  # 2025-06 absent from the list
    s += months(2026, 2, ["120"])
    out = t.yoy(s, Frequency.M)
    assert next(p for p in out if p.period_end == date(2026, 2, 28)).value == D(20)
    s_gap = months(2025, 1, ["100"] * 13)
    del s_gap[1]  # 2025-02 absent, so 2026-02 has no base
    s_gap += months(2026, 2, ["120"])
    assert t.yoy(s_gap, Frequency.M)[-1].value is None


def test_yoy_zero_base_is_absent() -> None:
    s = months(2025, 1, ["0"] + ["1"] * 11 + ["5"])
    assert t.yoy(s, Frequency.M)[12].value is None


def test_daily_not_supported() -> None:
    with pytest.raises(t.TransformError):
        t.yoy([Point(date(2026, 1, 1), D(1))], Frequency.D)


def test_diff12_and_pct_point_change() -> None:
    s = months(2025, 1, ["4.0"] * 12 + ["4.5"])
    assert t.diff12(s, Frequency.M)[12].value == D("0.5")
    assert t.yoy_pct_point_change(s, Frequency.M)[12].value == D("0.5")


def test_m3m3_ann_values_and_requirements() -> None:
    s = months(2026, 1, ["100", "100", "100", "101", "101", "101"])
    out = t.m3m3_ann(s, "SA")
    assert out[5].value is not None
    assert out[5].value == ((D(303) / D(300)) ** 4 - 1) * 100
    assert all(p.value is None for p in out[:5])  # fewer than six months of history


def test_m3m3_ann_missing_input_month_is_absent() -> None:
    s = months(2026, 1, ["100", None, "100", "101", "101", "101"])
    assert t.m3m3_ann(s, "SCA")[5].value is None


@pytest.mark.parametrize("sa", ["NSA", "CA", "NA"])
def test_never_period_on_period_for_non_sa(sa: str) -> None:
    with pytest.raises(t.TransformError, match="seasonally adjusted"):
        t.m3m3_ann(months(2026, 1, ["1"] * 6), sa)
    with pytest.raises(t.TransformError, match="seasonally adjusted"):
        t.qoq_ann(quarters(2026, ["1", "2"]), sa)


def test_qoq_ann() -> None:
    out = t.qoq_ann(quarters(2026, ["100", "101"]), "SA")
    assert out[0].value is None
    assert out[1].value == (D("1.01") ** 4 - 1) * 100


def test_requires_sa_flag_for_rule_8() -> None:
    assert t.requires_sa("M3M3_ANN")
    assert t.requires_sa("QOQ_ANN")
    assert not t.requires_sa("YOY")
    assert {k for k, v in t.TRANSFORMS.items() if v.requires_sa} == {"M3M3_ANN", "QOQ_ANN"}


def test_unknown_transform() -> None:
    with pytest.raises(t.TransformError, match="unknown"):
        t.get_transform("NOPE")


def test_real_rate_and_note() -> None:
    policy = months(2026, 1, ["4.5", "4.5", None])
    core = months(2026, 1, ["2.0", None, "2.0"])
    out = t.real_rate(policy, core, Frequency.M)
    assert vals(out) == [D("2.5"), None, None]
    assert t.TRANSFORMS["REAL_RATE"].note == "ex-post real policy rate"
    assert t.TRANSFORMS["REAL_RATE"].series_inputs == 2


def test_spread_vs_ref_and_benchmarks_have_no_spread() -> None:
    y = months(2026, 1, ["4.0", "4.1"])
    ref = months(2026, 1, ["2.5", None])
    assert vals(t.spread_vs_ref(y, ref, Frequency.M, entity="FRA", spread_reference="DEU")) == [
        D("1.5"),
        None,
    ]
    assert vals(t.spread_vs_ref(y, y, Frequency.M, entity="DEU", spread_reference="DEU")) == [
        None,
        None,
    ]
    assert vals(t.spread_vs_ref(y, y, Frequency.M, entity="USA", spread_reference="USA")) == [
        None,
        None,
    ]
    assert not t.spread_is_computed("DEU", "self")


def test_spread_requires_reference() -> None:
    with pytest.raises(t.TransformError, match="spread_reference"):
        t.spread_vs_ref([], [], Frequency.M, entity="FRA", spread_reference=None)
    with pytest.raises(t.TransformError, match="invalid"):
        t.spread_label("EUR", "GBR")


def test_ac_an_11_m18_labels() -> None:
    assert t.spread_label("EUR", "DEU") == t.SPREAD_LABEL_CREDIT  # euro-area member vs Bund
    assert t.spread_label("USD", "USA") == t.SPREAD_LABEL_CREDIT  # USD bond vs UST
    assert t.spread_label("BRL", "USA") == t.SPREAD_LABEL_LOCAL
    assert t.spread_label("PLN", "DEU") == t.SPREAD_LABEL_LOCAL  # non-euro EU member
    assert t.spread_label("USD", "DEU") == t.SPREAD_LABEL_LOCAL


def test_global_lcu_yoy_specified_but_disabled() -> None:
    assert t.TRANSFORMS["GLOBAL_LCU_YOY"].enabled is False
    with pytest.raises(t.TransformDisabled):
        t.global_lcu_yoy()


def test_denominator_transforms_registered_with_support_inputs() -> None:
    for key in ("SUM12_PCT_GDP", "RESERVE_COVER"):
        assert t.TRANSFORMS[key].support_inputs


def test_duplicate_period_rejected() -> None:
    p = Point(date(2026, 1, 31), D(1))
    with pytest.raises(t.TransformError, match="duplicate"):
        t.yoy([p, p], Frequency.M)
