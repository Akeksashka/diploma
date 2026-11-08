"""Transform registry and single-series transforms (analytics spec section 3, T38).

Pure functions on plain types (no pandas, no database) so ``publish/`` can share them
(AC-DEP-1). A series is a list of ``Point`` sorted by ``period_end``; ``value`` is ``None`` for
an absent period (a ``MISS`` input or a gap). A transform returns one ``Point`` per input period;
``None`` means "not computable here", never zero.

Denominator transforms (SUM12_PCT_GDP, RESERVE_COVER) are registered here but implemented in
``transforms_denominator`` (T39).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from macro_monitor.models.enums import Frequency, SeasonalAdjustment

HUNDRED = Decimal(100)
SA_OK = frozenset({SeasonalAdjustment.SA, SeasonalAdjustment.SCA})
REAL_RATE_NOTE = "ex-post real policy rate"  # label in meta/indicators.json.notes and the UI

# Reference bond currency by spread reference entity (M18, P16).
_REF_CURRENCY = {"DEU": "EUR", "USA": "USD"}
SPREAD_LABEL_CREDIT = "yield spread vs Germany/US (credit and liquidity risk proxy)"
SPREAD_LABEL_LOCAL = (
    "local-currency yield differential (includes inflation and exchange-rate expectations; "
    "not a sovereign-risk measure)"
)


class TransformError(ValueError):
    """Invalid use of a transform (a configuration error, not a data gap)."""


class TransformDisabled(TransformError):
    """The transform is specified but not enabled in v1."""


@dataclass(frozen=True)
class Point:
    period_end: date
    value: Decimal | None


def _key(period_end: date, frequency: Frequency) -> int:
    """Ordinal of the calendar period ending on ``period_end`` (consecutive periods differ by 1)."""
    if frequency is Frequency.M:
        return period_end.year * 12 + period_end.month - 1
    if frequency is Frequency.Q:
        return period_end.year * 4 + (period_end.month - 1) // 3
    if frequency is Frequency.A:
        return period_end.year
    raise TransformError(f"transform not defined for frequency {frequency.value}")


def _lag_year(frequency: Frequency) -> int:
    return {Frequency.M: 12, Frequency.Q: 4, Frequency.A: 1}.get(frequency, 0) or _bad(frequency)


def _bad(frequency: Frequency) -> int:
    raise TransformError(f"year-over-year not defined for frequency {frequency.value}")


def _index(points: Sequence[Point], frequency: Frequency) -> dict[int, Decimal | None]:
    out: dict[int, Decimal | None] = {}
    for p in points:
        k = _key(p.period_end, frequency)
        if k in out:
            raise TransformError(f"duplicate period {p.period_end}")
        out[k] = p.value
    return out


def _map(
    points: Sequence[Point],
    frequency: Frequency,
    fn: Callable[[Callable[[int], Decimal | None]], Decimal | None],
) -> list[Point]:
    """Apply ``fn(get)`` per period; ``get(offset)`` returns the value ``offset`` periods back."""
    idx = _index(points, frequency)
    result: list[Point] = []
    for p in points:
        k = _key(p.period_end, frequency)
        result.append(Point(p.period_end, fn(lambda off, k=k: idx.get(k - off))))  # type: ignore[misc]
    return result


def level(points: Sequence[Point]) -> list[Point]:
    return [Point(p.period_end, p.value) for p in points]


def yoy(points: Sequence[Point], frequency: Frequency) -> list[Point]:
    """Percent change on the same period a year earlier (12 months, 4 quarters or 1 year)."""
    lag = _lag_year(frequency)

    def f(get: Callable[[int], Decimal | None]) -> Decimal | None:
        now, then = get(0), get(lag)
        if now is None or then is None or then == 0:
            return None
        return (now / then - 1) * HUNDRED

    return _map(points, frequency, f)


def diff12(points: Sequence[Point], frequency: Frequency) -> list[Point]:
    """Difference to the same period a year earlier, in the series' own unit."""
    lag = _lag_year(frequency)

    def f(get: Callable[[int], Decimal | None]) -> Decimal | None:
        now, then = get(0), get(lag)
        return None if now is None or then is None else now - then

    return _map(points, frequency, f)


def yoy_pct_point_change(points: Sequence[Point], frequency: Frequency) -> list[Point]:
    """Year-over-year change of a series already in percent, in percentage points."""
    return diff12(points, frequency)


def require_sa(seasonal_adjustment: str, transform_id: str) -> None:
    """Never MoM/QoQ on a series that is not seasonally adjusted (use YoY)."""
    if seasonal_adjustment not in SA_OK:
        raise TransformError(
            f"{transform_id} requires a seasonally adjusted series (SA or SCA), "
            f"got {seasonal_adjustment!r}; use YOY"
        )


def m3m3_ann(points: Sequence[Point], seasonal_adjustment: str) -> list[Point]:
    """Latest 3 months over the previous 3 months, annualised, in percent (monthly SA only)."""
    require_sa(seasonal_adjustment, "M3M3_ANN")

    def f(get: Callable[[int], Decimal | None]) -> Decimal | None:
        recent = [get(i) for i in range(3)]
        prior = [get(i) for i in range(3, 6)]
        if any(v is None for v in (*recent, *prior)):
            return None
        s_new = sum((v for v in recent if v is not None), Decimal(0))
        s_old = sum((v for v in prior if v is not None), Decimal(0))
        if s_old == 0:
            return None
        return ((s_new / s_old) ** 4 - 1) * HUNDRED

    return _map(points, Frequency.M, f)


def qoq_ann(points: Sequence[Point], seasonal_adjustment: str) -> list[Point]:
    """Quarter-on-quarter change, annualised, in percent (quarterly SA only)."""
    require_sa(seasonal_adjustment, "QOQ_ANN")

    def f(get: Callable[[int], Decimal | None]) -> Decimal | None:
        now, prev = get(0), get(1)
        if now is None or prev is None or prev == 0:
            return None
        return ((now / prev) ** 4 - 1) * HUNDRED

    return _map(points, Frequency.Q, f)


def _join(
    a: Sequence[Point],
    b: Sequence[Point],
    frequency: Frequency,
    op: Callable[[Decimal, Decimal], Decimal],
) -> list[Point]:
    other = _index(b, frequency)
    out: list[Point] = []
    for p in a:
        o = other.get(_key(p.period_end, frequency))
        out.append(Point(p.period_end, None if p.value is None or o is None else op(p.value, o)))
    return out


def real_rate(
    policy_rate: Sequence[Point], core_yoy: Sequence[Point], frequency: Frequency
) -> list[Point]:
    """Policy rate minus core inflation YoY (both in percent): an ex-post real policy rate.

    ``core_yoy`` is the already transformed core series. A period missing in either input is
    absent. Staleness of the second series is checked by the caller (snapshot, T40).
    """
    return _join(policy_rate, core_yoy, frequency, lambda r, i: r - i)


def spread_is_computed(entity: str, spread_reference: str | None) -> bool:
    """False for the benchmarks themselves (DEU, USA: level only, no spread)."""
    ref = _require_reference(spread_reference)
    return ref != "self" and entity != ref


def _require_reference(spread_reference: str | None) -> str:
    if spread_reference is None:
        raise TransformError("SPREAD_VS_REF requires spread_reference (DEU, USA or self)")
    if spread_reference not in (*_REF_CURRENCY, "self"):
        raise TransformError(f"invalid spread_reference {spread_reference!r}")
    return spread_reference


def spread_vs_ref(
    yield_series: Sequence[Point],
    reference_yield: Sequence[Point],
    frequency: Frequency,
    *,
    entity: str,
    spread_reference: str | None,
) -> list[Point]:
    """Yield minus the reference yield; no spread for the benchmark entities (all absent)."""
    if not spread_is_computed(entity, spread_reference):
        return [Point(p.period_end, None) for p in yield_series]
    return _join(yield_series, reference_yield, frequency, lambda y, r: y - r)


def spread_label(bond_currency: str, spread_reference: str) -> str:
    """M18 display label (AC-AN-11): credit-risk wording only when both bonds share a currency."""
    ref = _require_reference(spread_reference)
    if ref != "self" and _REF_CURRENCY[ref] == bond_currency:
        return SPREAD_LABEL_CREDIT
    return SPREAD_LABEL_LOCAL


@dataclass(frozen=True)
class TransformSpec:
    key: str
    requires_sa: bool = False
    series_inputs: int = 1  # headline series consumed (2 for REAL_RATE, SPREAD_VS_REF)
    support_inputs: bool = False  # needs ref.indicator_input support series (denominators)
    enabled: bool = True
    note: str | None = None


TRANSFORMS: dict[str, TransformSpec] = {
    s.key: s
    for s in (
        TransformSpec("LEVEL"),
        TransformSpec("YOY"),
        TransformSpec("YOY_PCT_POINT_CHANGE"),
        TransformSpec("DIFF12"),
        TransformSpec("M3M3_ANN", requires_sa=True),
        TransformSpec("QOQ_ANN", requires_sa=True),
        TransformSpec("REAL_RATE", series_inputs=2, note=REAL_RATE_NOTE),
        TransformSpec("SPREAD_VS_REF", series_inputs=2),
        TransformSpec("SUM12_PCT_GDP", support_inputs=True),
        TransformSpec("RESERVE_COVER", support_inputs=True),
        TransformSpec(
            "GLOBAL_LCU_YOY", series_inputs=2, enabled=False, note="specified, deferred in v1"
        ),
    )
}


def get_transform(key: str) -> TransformSpec:
    try:
        return TRANSFORMS[key]
    except KeyError:
        raise TransformError(f"unknown transform {key!r}") from None


def requires_sa(key: str) -> bool:
    """Flag consumed by source-config rule 8 and the DDL ``sa_required`` column."""
    return get_transform(key).requires_sa


def global_lcu_yoy(*_args: object, **_kwargs: object) -> list[Point]:
    raise TransformDisabled("GLOBAL_LCU_YOY is specified but disabled in v1 (design Q23)")
