"""Insert-on-change comparison (I-CUR-3, ingestion spec section 5 step 7). Pure functions, no I/O.

Values are equal when ``|a-b| <= max(rel_epsilon * max(|a|,|b|), 0.5 * 10^-d)``: a difference of
exactly half a published unit is "equal", a larger one is a revision. ``d`` is the series'
``published_decimals`` (or the group's fixed decimals); when it is unknown the smaller scale of
the two values is the fallback and the caller counts it. ``value_status`` compares exactly; two
rows without a value (``MISS``/``DEL``) are equal when their statuses are equal.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, localcontext
from enum import StrEnum

_HALF = Decimal("0.5")


class Action(StrEnum):
    INSERT = "insert"
    EQUAL = "equal"  # no row
    BELOW_TOL = "below_tol"  # revision under snapshot_mode diff_above_tol, counted, no row


@dataclass(frozen=True)
class ComparePolicy:
    """The part of ``ref.series_group`` the comparison needs."""

    compare_mode: str = "published_decimals"  # or 'fixed_decimals'
    fixed_decimals: int | None = None
    rel_epsilon: Decimal = Decimal("1e-9")
    snapshot_mode: str = "none"
    materiality_abs: Decimal = Decimal(0)
    materiality_rel: Decimal = Decimal(0)
    ratio_unit: bool = False  # ref.unit.dimension = 'ratio': materiality_abs alone decides


@dataclass(frozen=True)
class Stored:
    """The comparison row: latest stored version of the key (PROJ: same ``vintage_label``)."""

    value: Decimal | None
    value_status: str


@dataclass(frozen=True)
class Decision:
    action: Action
    fallback: bool = False  # d unknown: smaller scale of the two values was used


def scale(value: Decimal) -> int:
    """Decimals of a parsed value as written in the source (``2.10`` has scale 2)."""
    exp = value.as_tuple().exponent
    return max(0, -exp) if isinstance(exp, int) else 0


def max_scale(values: list[Decimal]) -> int | None:
    return max((scale(v) for v in values), default=None)


def effective_decimals(policy: ComparePolicy, published_decimals: int | None) -> int | None:
    if policy.compare_mode == "fixed_decimals":
        return policy.fixed_decimals
    return published_decimals


def tolerance(a: Decimal, b: Decimal, d: int, rel_epsilon: Decimal) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = 80
        return max(rel_epsilon * max(abs(a), abs(b)), _HALF * Decimal(10) ** -d)


def values_equal(
    a: Decimal, b: Decimal, d: int | None, rel_epsilon: Decimal = Decimal("1e-9")
) -> tuple[bool, bool]:
    """``(equal, used_fallback)`` for two present values."""
    fallback = d is None
    dd = min(scale(a), scale(b)) if d is None else d
    with localcontext() as ctx:
        ctx.prec = 80
        return abs(a - b) <= tolerance(a, b, dd, rel_epsilon), fallback


def decide(
    stored: Stored | None,
    new_value: Decimal | None,
    new_status: str,
    policy: ComparePolicy,
    published_decimals: int | None,
) -> Decision:
    """Insert, skip as equal, or count as below tolerance."""
    if stored is None:
        return Decision(Action.INSERT)
    if stored.value_status != new_status:
        return Decision(Action.INSERT)  # status changes ignore the tolerance (incl. value <-> MISS)
    if stored.value is None or new_value is None:
        return Decision(Action.EQUAL)  # both without a value, same status
    d = effective_decimals(policy, published_decimals)
    equal, fallback = values_equal(stored.value, new_value, d, policy.rel_epsilon)
    if equal:
        return Decision(Action.EQUAL, fallback)
    if policy.snapshot_mode == "diff_above_tol":
        rel = Decimal(0) if policy.ratio_unit else policy.materiality_rel * abs(stored.value)
        with localcontext() as ctx:
            ctx.prec = 80
            if abs(new_value - stored.value) <= max(policy.materiality_abs, rel):
                return Decision(Action.BELOW_TOL, fallback)
    return Decision(Action.INSERT, fallback)
