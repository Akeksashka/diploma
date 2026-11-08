"""Denominator transforms with fail-closed guards (analytics spec section 3, T39).

``SUM12_PCT_GDP``, ``RESERVE_COVER`` and USD stock as percent of GDP. Every guard turns a wrong
number into n/a plus a COMP-05 reason code; no substitute denominator is ever invented, and a
single latest annualised value is not an allowed denominator (user answer to Q48; no such
mode exists). Pure functions on plain types (no pandas, no database).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from macro_monitor.analytics.transforms import Point, TransformError
from macro_monitor.models.enums import Frequency

HUNDRED = Decimal(100)

# COMP-05 reason codes (validation spec).
ANNUALISED_DENOMINATOR = "annualised_denominator"
ANNUALISED_NUMERATOR = "annualised_numerator"
INVALID_FLOW_BASIS = "invalid_flow_basis"
DENOMINATOR_AGE = "denominator_age"
HIGH_INFLATION = "high_inflation"
FX_REGIME = "fx_regime"
CURRENCY_MISMATCH = "currency_mismatch"
MISSING_OR_STALE = "missing_or_stale"
INVALID_CALENDAR_BASIS = "invalid_calendar_basis"
INFLATION_UNKNOWN = "inflation_unknown"
COMP05_REASONS = frozenset(
    {
        ANNUALISED_DENOMINATOR,
        ANNUALISED_NUMERATOR,
        INVALID_FLOW_BASIS,
        DENOMINATOR_AGE,
        HIGH_INFLATION,
        FX_REGIME,
        CURRENCY_MISMATCH,
        MISSING_OR_STALE,
        INVALID_CALENDAR_BASIS,
        INFLATION_UNKNOWN,
    }
)
NUMERATOR_INCOMPLETE = "numerator_incomplete"  # an absent period, not a COMP-05 matter
ZERO_DENOMINATOR = "zero_denominator"

LABEL_GOODS_ONLY = "goods_only"

DEFAULT_MAX_DENOMINATOR_AGE_DAYS = 120
DEFAULT_HI_INFLATION_THRESHOLD = Decimal("25")  # percent
ANNUAL_FALLBACK_MAX_INFLATION = Decimal("10")  # percent
QUARTERLY_STALE_DAYS = 270  # Q270 / A730 staleness classes of the support inputs
ANNUAL_STALE_DAYS = 730


@dataclass(frozen=True)
class SupportPoint:
    """One observation of a support or flow input, with the attributes the guards read."""

    period_end: date
    value: Decimal | None
    frequency: Frequency
    flow_basis: str
    currency: str
    calendar_basis: str = "CAL"


@dataclass(frozen=True)
class GuardConfig:
    max_denominator_age_days: int = DEFAULT_MAX_DENOMINATOR_AGE_DAYS
    hi_inflation_threshold: Decimal = DEFAULT_HI_INFLATION_THRESHOLD  # percent
    currency_match: str = "numerator"  # numerator | lcu | usd (ref.indicator_input.currency_match)


@dataclass(frozen=True)
class EntityContext:
    cpi_yoy: Decimal | None  # trailing YoY CPI of the entity, percent, as of the numerator date
    fx_regime_flag: str | None = None  # managed | multiple | None
    lcu_currency: str | None = None  # needed for currency_match = lcu


@dataclass(frozen=True)
class TransformResult:
    value: Decimal | None
    reason: str | None = None
    label: str | None = None
    fixed_override_allowed: bool = True  # RESERVE_COVER goods_only: the 3-month override is off

    @property
    def comp05(self) -> bool:
        """True when COMP-05 (warn) must name this reason."""
        return self.reason in COMP05_REASONS


def _na(reason: str, **kw: object) -> TransformResult:
    return TransformResult(None, reason, **kw)  # type: ignore[arg-type]


def _flow_reason(basis: str, *, numerator: bool) -> str | None:
    """Reason code when ``basis`` may not be summed as a flow; None when it is PERIOD_FLOW."""
    if basis == "PERIOD_FLOW":
        return None
    if basis == "ANNUALISED_RATE":
        return ANNUALISED_NUMERATOR if numerator else ANNUALISED_DENOMINATOR
    return INVALID_FLOW_BASIS  # STOCK, NA or unknown: not proven, fails closed


def _month_key(d: date) -> int:
    return d.year * 12 + d.month - 1


def _quarter_key(d: date) -> int:
    return d.year * 4 + (d.month - 1) // 3


def _expected_currency(cfg: GuardConfig, numerator_currency: str, ctx: EntityContext) -> str | None:
    if cfg.currency_match == "numerator":
        return numerator_currency
    if cfg.currency_match == "usd":
        return "USD"
    if cfg.currency_match == "lcu":
        return ctx.lcu_currency
    raise TransformError(f"invalid currency_match {cfg.currency_match!r}")


def _sum_months(numerator: Sequence[SupportPoint | Point], end: date) -> Decimal | None:
    """Sum of the 12 consecutive months ending ``end``; None unless all are present."""
    by_key = {_month_key(p.period_end): p.value for p in numerator}
    end_key = _month_key(end)
    total = Decimal(0)
    for k in range(end_key - 11, end_key + 1):
        v = by_key.get(k)
        if v is None:
            return None
        total += v
    return total


def _select_denominator(
    denominators: Sequence[SupportPoint],
    at: date,
    cfg: GuardConfig,
    ctx: EntityContext,
    expected_currency: str | None,
) -> tuple[Decimal | None, str | None, bool]:
    """Return (D, reason, used_annual_fallback).

    Four consecutive quarters ending on or before ``at`` (each PERIOD_FLOW, CAL, expected
    currency), else the latest annual value with year-end on or before ``at``.
    """
    quarterly = sorted(
        (p for p in denominators if p.frequency is Frequency.Q and p.period_end <= at),
        key=lambda p: p.period_end,
    )
    annual = sorted(
        (p for p in denominators if p.frequency is Frequency.A and p.period_end <= at),
        key=lambda p: p.period_end,
    )
    by_q = {_quarter_key(p.period_end): p for p in quarterly}
    if quarterly:
        last = _quarter_key(quarterly[-1].period_end)
        window = [by_q.get(k) for k in range(last - 3, last + 1)]
        if all(w is not None and w.value is not None for w in window):
            picked = [w for w in window if w is not None]
            for p in picked:
                if (r := _flow_reason(p.flow_basis, numerator=False)) is not None:
                    return None, r, False
                if p.calendar_basis != "CAL":
                    return None, INVALID_CALENDAR_BASIS, False
                if p.currency != expected_currency:
                    return None, CURRENCY_MISMATCH, False
            age = (at - picked[-1].period_end).days
            if age > cfg.max_denominator_age_days:
                return None, DENOMINATOR_AGE, False
            if age > QUARTERLY_STALE_DAYS:  # only reachable with a looser configured age
                return None, MISSING_OR_STALE, False
            return sum((p.value for p in picked if p.value is not None), Decimal(0)), None, False
    if annual:
        p = annual[-1]
        if p.value is None:
            return None, MISSING_OR_STALE, True
        if (r := _flow_reason(p.flow_basis, numerator=False)) is not None:
            return None, r, True
        if p.calendar_basis != "CAL":
            return None, INVALID_CALENDAR_BASIS, True
        if p.currency != expected_currency:
            return None, CURRENCY_MISMATCH, True
        if (at - p.period_end).days > ANNUAL_STALE_DAYS:
            return None, MISSING_OR_STALE, True
        return p.value, None, True
    return None, MISSING_OR_STALE, False


def _regime_guard(
    ctx: EntityContext, cfg: GuardConfig, *, usd_ratio: bool, annual_fallback: bool
) -> str | None:
    """Inflation and FX-regime guard. Applies to USD-over-USD ratios and the annual fallback."""
    if not (usd_ratio or annual_fallback):
        return None
    if ctx.fx_regime_flag:
        return FX_REGIME
    if ctx.cpi_yoy is None:
        return INFLATION_UNKNOWN
    if ctx.cpi_yoy > cfg.hi_inflation_threshold:
        return HIGH_INFLATION
    if annual_fallback and ctx.cpi_yoy >= ANNUAL_FALLBACK_MAX_INFLATION:
        return HIGH_INFLATION
    return None


def _ratio(numerator_sum: Decimal, denominator: Decimal) -> TransformResult:
    if denominator == 0:
        return _na(ZERO_DENOMINATOR)
    return TransformResult(HUNDRED * numerator_sum / denominator)


def sum12_pct_gdp(
    numerator: Sequence[SupportPoint],
    denominators: Sequence[SupportPoint],
    at: date,
    *,
    ctx: EntityContext,
    cfg: GuardConfig | None = None,
) -> TransformResult:
    """``100 * sum12(numerator) / D`` at the numerator period ending ``at``."""
    cfg = cfg or GuardConfig()
    months = [p for p in numerator if p.period_end <= at]
    if not months:
        return _na(NUMERATOR_INCOMPLETE)
    last = max(months, key=lambda p: p.period_end)
    if (r := _flow_reason(last.flow_basis, numerator=True)) is not None:
        return _na(r)
    expected = _expected_currency(cfg, last.currency, ctx)
    if last.currency != expected:
        return _na(CURRENCY_MISMATCH)
    total = _sum_months(months, at)
    if total is None:
        return _na(NUMERATOR_INCOMPLETE)
    denom, reason, annual = _select_denominator(denominators, at, cfg, ctx, expected)
    if denom is None:
        return _na(reason or MISSING_OR_STALE)
    if (
        g := _regime_guard(ctx, cfg, usd_ratio=cfg.currency_match == "usd", annual_fallback=annual)
    ) is not None:
        return _na(g)
    return _ratio(total, denom)


def usd_stock_pct_gdp(
    stock: Point,
    stock_currency: str,
    denominators: Sequence[SupportPoint],
    *,
    ctx: EntityContext,
    cfg: GuardConfig | None = None,
) -> TransformResult:
    """USD stock over the latest annual (or four-quarter sum) X02 value ending on or before it."""
    cfg = cfg or GuardConfig(currency_match="usd")
    if stock.value is None:
        return _na(NUMERATOR_INCOMPLETE)
    if stock_currency != "USD":
        return _na(CURRENCY_MISMATCH)
    denom, reason, annual = _select_denominator(denominators, stock.period_end, cfg, ctx, "USD")
    if denom is None:
        return _na(reason or MISSING_OR_STALE)
    if (g := _regime_guard(ctx, cfg, usd_ratio=True, annual_fallback=annual)) is not None:
        return _na(g)
    return _ratio(stock.value, denom)


def reserve_cover(
    reserves: Point,
    reserves_currency: str,
    imports: Sequence[SupportPoint],
    *,
    imports_scope: str = "goods_and_services",
) -> TransformResult:
    """Months of imports covered: ``reserves / (imports12 / 12)``; annual imports / 12 fallback.

    ``imports_scope = 'goods_only'`` labels the value ``goods_only`` and switches the fixed
    3-month override off (goods-only cover is overstated).
    """
    if imports_scope not in ("goods_and_services", "goods_only"):
        raise TransformError(f"invalid imports_scope {imports_scope!r}")
    label = LABEL_GOODS_ONLY if imports_scope == "goods_only" else None
    allowed = imports_scope != "goods_only"

    def out(value: Decimal | None, reason: str | None = None) -> TransformResult:
        return TransformResult(value, reason, label, allowed)

    if reserves.value is None:
        return out(None, NUMERATOR_INCOMPLETE)
    if reserves_currency != "USD":
        return out(None, CURRENCY_MISMATCH)
    at = reserves.period_end
    monthly = [p for p in imports if p.frequency is Frequency.M and p.period_end <= at]
    annual = sorted(
        (p for p in imports if p.frequency is Frequency.A and p.period_end <= at),
        key=lambda p: p.period_end,
    )
    by_key = {_month_key(p.period_end): p for p in monthly}
    window = [by_key.get(k) for k in range(_month_key(at) - 11, _month_key(at) + 1)]
    imports_per_month: Decimal | None = None
    if monthly and all(w is not None and w.value is not None for w in window):
        picked = [w for w in window if w is not None]
        for p in picked:
            if (r := _flow_reason(p.flow_basis, numerator=False)) is not None:
                return out(None, r)
            if p.currency != "USD":
                return out(None, CURRENCY_MISMATCH)
        imports_per_month = sum((p.value for p in picked if p.value is not None), Decimal(0)) / 12
    elif annual:
        p = annual[-1]
        if p.value is None:
            return out(None, MISSING_OR_STALE)
        if (r := _flow_reason(p.flow_basis, numerator=False)) is not None:
            return out(None, r)
        if p.currency != "USD":
            return out(None, CURRENCY_MISMATCH)
        if (at - p.period_end).days > ANNUAL_STALE_DAYS:
            return out(None, MISSING_OR_STALE)
        imports_per_month = p.value / 12
    else:
        return out(None, MISSING_OR_STALE)
    if imports_per_month == 0:
        return out(None, ZERO_DENOMINATOR)
    return out(reserves.value / imports_per_month)


def is_rankable_kind(is_support: bool) -> bool:
    """Support inputs are never in snapshots, ranks or scorecards (AC-AN-7)."""
    return not is_support
