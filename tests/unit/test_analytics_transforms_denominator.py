"""Unit tests for analytics.transforms_denominator (T39: AC-AN-7, 13, 20, 21, AC-VAL-11)."""

from __future__ import annotations

import calendar
import inspect
from datetime import date
from decimal import Decimal

import pytest

from macro_monitor.analytics import transforms_denominator as td
from macro_monitor.analytics.transforms import Point
from macro_monitor.analytics.transforms_denominator import (
    EntityContext,
    GuardConfig,
    SupportPoint,
)
from macro_monitor.models.enums import Frequency

pytestmark = pytest.mark.unit

D = Decimal
AT = date(2026, 6, 30)
CTX = EntityContext(cpi_yoy=D(5), lcu_currency="EUR")


def month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def trade(
    value: str = "10",
    basis: str = "PERIOD_FLOW",
    ccy: str = "EUR",
    n: int = 12,
    start: tuple[int, int] = (2025, 7),
) -> list[SupportPoint]:
    out = []
    y, m = start
    for _ in range(n):
        out.append(SupportPoint(month_end(y, m), D(value), Frequency.M, basis, ccy))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def gdp_q(
    value: str = "250",
    basis: str = "PERIOD_FLOW",
    ccy: str = "EUR",
    last_end: date = date(2026, 3, 31),
) -> list[SupportPoint]:
    ends = []
    y, q = last_end.year, (last_end.month - 1) // 3 + 1
    for _ in range(4):
        ends.append(month_end(y, 3 * q))
        q -= 1
        if q == 0:
            y, q = y - 1, 4
    return [SupportPoint(e, D(value), Frequency.Q, basis, ccy) for e in sorted(ends)]


def gdp_a(
    value: str = "1000", basis: str = "PERIOD_FLOW", ccy: str = "EUR", year: int = 2025
) -> SupportPoint:
    return SupportPoint(date(year, 12, 31), D(value), Frequency.A, basis, ccy)


def test_sum12_computed_from_four_quarters() -> None:
    r = td.sum12_pct_gdp(trade(), gdp_q(), AT, ctx=CTX)
    assert r.value == D(100) * D(120) / D(1000)  # 12 months of 10 over 4 x 250
    assert r.reason is None
    assert not r.comp05


def test_ac_an_13_denominator_older_than_120_days_is_na() -> None:
    at = date(2026, 7, 31)  # last quarter-end 31 Mar is 122 days earlier
    num = trade(start=(2025, 8))
    r = td.sum12_pct_gdp(num, gdp_q(), at, ctx=CTX)
    assert (r.value, r.reason) == (None, td.DENOMINATOR_AGE)
    assert r.comp05


def test_ac_an_13_100_day_old_denominator_with_low_inflation_is_computed() -> None:
    q = gdp_q(last_end=date(2026, 3, 31))  # 91 days before 30 Jun
    assert td.sum12_pct_gdp(trade(), q, AT, ctx=EntityContext(cpi_yoy=D(5))).value is not None
    q2 = gdp_q(last_end=date(2025, 12, 31))  # 181 days: too old
    assert td.sum12_pct_gdp(trade(), q2, AT, ctx=CTX).reason == td.DENOMINATOR_AGE


def test_ac_an_13_annual_fallback_needs_low_inflation() -> None:
    ok = td.sum12_pct_gdp(trade(), [gdp_a()], AT, ctx=EntityContext(cpi_yoy=D(5)))
    assert ok.value == D(100) * D(120) / D(1000)
    r = td.sum12_pct_gdp(trade(), [gdp_a()], AT, ctx=EntityContext(cpi_yoy=D(12)))
    assert (r.value, r.reason) == (None, td.HIGH_INFLATION)
    assert (
        td.sum12_pct_gdp(trade(), [gdp_a()], AT, ctx=EntityContext(cpi_yoy=None)).reason
        == td.INFLATION_UNKNOWN
    )


def test_ac_an_13_high_inflation_and_fx_regime_for_usd_over_usd() -> None:
    cfg = GuardConfig(currency_match="usd")
    num, den = trade(ccy="USD"), gdp_q(ccy="USD")
    assert (
        td.sum12_pct_gdp(num, den, AT, ctx=EntityContext(cpi_yoy=D(30)), cfg=cfg).reason
        == td.HIGH_INFLATION
    )
    managed = EntityContext(cpi_yoy=D(3), fx_regime_flag="managed")
    assert td.sum12_pct_gdp(num, den, AT, ctx=managed, cfg=cfg).reason == td.FX_REGIME
    assert (
        td.sum12_pct_gdp(num, den, AT, ctx=EntityContext(cpi_yoy=D(3)), cfg=cfg).value is not None
    )


def test_ac_an_21_annualised_denominator_is_na_not_a_small_number() -> None:
    r = td.sum12_pct_gdp(
        trade(), gdp_q("1000", "ANNUALISED_RATE"), AT, ctx=CTX
    )  # 4 x 250 per quarter
    assert r.value is None
    assert r.reason == td.ANNUALISED_DENOMINATOR


def test_ac_an_21_period_flow_equals_formula() -> None:
    r = td.sum12_pct_gdp(trade("7.5"), gdp_q("260"), AT, ctx=CTX)
    assert r.value == D(100) * (D("7.5") * 12) / (D(260) * 4)


@pytest.mark.parametrize(
    ("basis", "reason"),
    [
        ("STOCK", td.INVALID_FLOW_BASIS),
        ("NA", td.INVALID_FLOW_BASIS),
        ("WEIRD", td.INVALID_FLOW_BASIS),
    ],
)
def test_ac_an_21_denominator_basis_not_proven(basis: str, reason: str) -> None:
    assert td.sum12_pct_gdp(trade(), gdp_q(basis=basis), AT, ctx=CTX).reason == reason


def test_ac_an_21_numerator_flow_basis() -> None:
    assert (
        td.sum12_pct_gdp(trade(basis="ANNUALISED_RATE"), gdp_q(), AT, ctx=CTX).reason
        == td.ANNUALISED_NUMERATOR
    )
    assert td.sum12_pct_gdp(trade(basis="NA"), gdp_q(), AT, ctx=CTX).reason == td.INVALID_FLOW_BASIS


def test_ac_an_21_annual_period_flow_fallback_unaffected() -> None:
    r = td.sum12_pct_gdp(trade(), [gdp_a(basis="PERIOD_FLOW")], AT, ctx=CTX)
    assert r.value is not None


def test_ac_an_21_annualised_quarters_do_not_fall_back_to_annual() -> None:
    den = [*gdp_q(basis="ANNUALISED_RATE"), gdp_a()]
    assert td.sum12_pct_gdp(trade(), den, AT, ctx=CTX).reason == td.ANNUALISED_DENOMINATOR


def test_no_latest_single_path_exists() -> None:
    src = inspect.getsource(td)
    assert "latest_single" not in src
    assert "annualised_policy" not in src


def test_ac_val_11_missing_stale_and_currency_mismatch_are_na_never_substituted() -> None:
    assert td.sum12_pct_gdp(trade(), [], AT, ctx=CTX).reason == td.MISSING_OR_STALE
    stale_annual = gdp_a(year=2022)
    assert td.sum12_pct_gdp(trade(), [stale_annual], AT, ctx=CTX).reason == td.MISSING_OR_STALE
    usd_gdp = gdp_q(ccy="USD")
    r = td.sum12_pct_gdp(trade(ccy="EUR"), usd_gdp, AT, ctx=CTX)  # LCU numerator over USD GDP
    assert (r.value, r.reason) == (None, td.CURRENCY_MISMATCH)
    assert r.comp05
    assert (
        td.sum12_pct_gdp(trade(ccy="USD"), gdp_q(ccy="EUR"), AT, ctx=CTX).reason
        == td.CURRENCY_MISMATCH
    )


def test_currency_match_lcu_and_usd_declared() -> None:
    lcu = GuardConfig(currency_match="lcu")
    assert (
        td.sum12_pct_gdp(trade(ccy="EUR"), gdp_q(ccy="EUR"), AT, ctx=CTX, cfg=lcu).value is not None
    )
    assert (
        td.sum12_pct_gdp(trade(ccy="USD"), gdp_q(ccy="USD"), AT, ctx=CTX, cfg=lcu).reason
        == td.CURRENCY_MISMATCH
    )
    with pytest.raises(td.TransformError):
        td.sum12_pct_gdp(trade(), gdp_q(), AT, ctx=CTX, cfg=GuardConfig(currency_match="x"))


def test_calendar_basis_must_be_cal() -> None:
    den = [
        SupportPoint(p.period_end, p.value, p.frequency, p.flow_basis, p.currency, "FISCAL")
        for p in gdp_q()
    ]
    assert td.sum12_pct_gdp(trade(), den, AT, ctx=CTX).reason == td.INVALID_CALENDAR_BASIS


def test_incomplete_numerator_is_absent_not_comp05() -> None:
    r = td.sum12_pct_gdp(trade(n=11), gdp_q(), AT, ctx=CTX)
    assert (r.value, r.reason) == (None, td.NUMERATOR_INCOMPLETE)
    assert not r.comp05


def test_missing_quarter_in_window_falls_back_to_annual_when_available() -> None:
    q = gdp_q()
    del q[1]
    assert td.sum12_pct_gdp(trade(), q, AT, ctx=CTX).reason == td.MISSING_OR_STALE
    r = td.sum12_pct_gdp(trade(), [*q, gdp_a()], AT, ctx=EntityContext(cpi_yoy=D(4)))
    assert r.value == D(100) * D(120) / D(1000)


def test_usd_stock_pct_gdp() -> None:
    stock = Point(date(2026, 6, 30), D(50))
    den = [gdp_a("1000", ccy="USD")]
    r = td.usd_stock_pct_gdp(stock, "USD", den, ctx=EntityContext(cpi_yoy=D(3)))
    assert r.value == D(5)
    assert td.usd_stock_pct_gdp(stock, "EUR", den, ctx=CTX).reason == td.CURRENCY_MISMATCH
    assert td.usd_stock_pct_gdp(stock, "USD", [], ctx=CTX).reason == td.MISSING_OR_STALE
    assert (
        td.usd_stock_pct_gdp(stock, "USD", den, ctx=EntityContext(cpi_yoy=D(40))).reason
        == td.HIGH_INFLATION
    )


def imports_m(
    value: str = "10", n: int = 12, ccy: str = "USD", basis: str = "PERIOD_FLOW"
) -> list[SupportPoint]:
    return trade(value, basis, ccy, n)


def test_reserve_cover_months_of_imports() -> None:
    r = td.reserve_cover(Point(AT, D(60)), "USD", imports_m("10"))
    assert r.value == D(6)  # 60 / (120 / 12)
    assert r.label is None
    assert r.fixed_override_allowed


def test_ac_an_20_goods_only_label_and_no_override() -> None:
    r = td.reserve_cover(Point(AT, D(20)), "USD", imports_m("10"), imports_scope="goods_only")
    assert r.value == D(2)
    assert r.label == td.LABEL_GOODS_ONLY
    assert r.fixed_override_allowed is False
    with pytest.raises(td.TransformError):
        td.reserve_cover(Point(AT, D(20)), "USD", [], imports_scope="x")


def test_reserve_cover_annual_fallback_and_failures() -> None:
    annual = SupportPoint(date(2025, 12, 31), D(120), Frequency.A, "PERIOD_FLOW", "USD")
    assert td.reserve_cover(Point(AT, D(60)), "USD", [annual]).value == D(6)
    assert td.reserve_cover(Point(AT, D(60)), "USD", []).reason == td.MISSING_OR_STALE
    assert td.reserve_cover(Point(AT, None), "USD", imports_m()).reason == td.NUMERATOR_INCOMPLETE
    assert td.reserve_cover(Point(AT, D(60)), "EUR", imports_m()).reason == td.CURRENCY_MISMATCH
    assert (
        td.reserve_cover(Point(AT, D(60)), "USD", imports_m(ccy="EUR")).reason
        == td.CURRENCY_MISMATCH
    )
    assert (
        td.reserve_cover(Point(AT, D(60)), "USD", imports_m(basis="ANNUALISED_RATE")).reason
        == td.ANNUALISED_DENOMINATOR
    )
    assert td.reserve_cover(Point(AT, D(60)), "USD", imports_m("0")).reason == td.ZERO_DENOMINATOR
    stale = SupportPoint(date(2022, 12, 31), D(120), Frequency.A, "PERIOD_FLOW", "USD")
    assert td.reserve_cover(Point(AT, D(60)), "USD", [stale]).reason == td.MISSING_OR_STALE


def test_support_inputs_never_rankable() -> None:
    assert td.is_rankable_kind(is_support=False)
    assert not td.is_rankable_kind(is_support=True)
