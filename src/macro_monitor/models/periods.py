"""Period arithmetic: reference-period labels to (start, end) and I-CUR-6 bound checks.

Labels: ``2026`` (A), ``2026-Q3`` (Q), ``2026-09`` (M), ``2026-09-30`` (D).
Only calendar periods are derived from labels. For ``calendar_basis <> 'CAL'``
(fiscal, marketing year) bounds always come from the source and are only
length-checked; they are never guessed from a label (docs/specs/ddl-neon-schema.md,
I-CUR-6).
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date

from macro_monitor.models.enums import CalendarBasis, Frequency

__all__ = [
    "NON_CAL_ANNUAL_MAX_DAYS",
    "NON_CAL_ANNUAL_MIN_DAYS",
    "PeriodBounds",
    "PeriodError",
    "calendar_bounds",
    "check_bounds",
    "format_period",
    "parse_period",
]

NON_CAL_ANNUAL_MIN_DAYS = 364
NON_CAL_ANNUAL_MAX_DAYS = 366

_RE_A = re.compile(r"^(\d{4})$")
_RE_Q = re.compile(r"^(\d{4})-Q([1-4])$")
_RE_M = re.compile(r"^(\d{4})-(\d{2})$")
_RE_D = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


class PeriodError(ValueError):
    """Invalid period label or bounds inconsistent with the series frequency."""


@dataclass(frozen=True, slots=True)
class PeriodBounds:
    """Inclusive reference-period bounds."""

    frequency: Frequency
    start: date
    end: date


def calendar_bounds(frequency: Frequency, year: int, index: int = 1) -> tuple[date, date]:
    """Calendar bounds. ``index`` is the quarter (Q), month (M) or ordinal day-of-year (D)."""
    try:
        if frequency is Frequency.A:
            return date(year, 1, 1), date(year, 12, 31)
        if frequency is Frequency.Q:
            if not 1 <= index <= 4:
                raise ValueError("quarter must be 1-4")
            first = 3 * index - 2
            return date(year, first, 1), date(
                year, first + 2, calendar.monthrange(year, first + 2)[1]
            )
        if frequency is Frequency.M:
            return date(year, index, 1), date(year, index, calendar.monthrange(year, index)[1])
        d = date.fromordinal(date(year, 1, 1).toordinal() + index - 1)
        if d.year != year:
            raise ValueError("day of year out of range")
        return d, d
    except ValueError as exc:
        raise PeriodError(f"invalid {frequency.value} period: {year}/{index}: {exc}") from exc


def parse_period(label: str) -> PeriodBounds:
    """Parse a calendar-period label; the frequency is implied by the label shape."""
    s = label.strip()
    try:
        if m := _RE_A.match(s):
            y = int(m[1])
            return PeriodBounds(Frequency.A, *calendar_bounds(Frequency.A, y))
        if m := _RE_Q.match(s):
            return PeriodBounds(Frequency.Q, *calendar_bounds(Frequency.Q, int(m[1]), int(m[2])))
        if m := _RE_M.match(s):
            return PeriodBounds(Frequency.M, *calendar_bounds(Frequency.M, int(m[1]), int(m[2])))
        if m := _RE_D.match(s):
            d = date(int(m[1]), int(m[2]), int(m[3]))
            return PeriodBounds(Frequency.D, d, d)
    except ValueError as exc:  # includes PeriodError
        raise PeriodError(f"invalid period label {label!r}: {exc}") from exc
    raise PeriodError(f"unrecognised period label {label!r}")


def format_period(frequency: Frequency, start: date) -> str:
    """Canonical label of the calendar period of ``frequency`` that contains ``start``."""
    if frequency is Frequency.A:
        return f"{start.year:04d}"
    if frequency is Frequency.Q:
        return f"{start.year:04d}-Q{(start.month - 1) // 3 + 1}"
    if frequency is Frequency.M:
        return f"{start.year:04d}-{start.month:02d}"
    return start.isoformat()


def check_bounds(
    frequency: Frequency,
    calendar_basis: CalendarBasis,
    start: date,
    end: date,
) -> None:
    """I-CUR-6: raise PeriodError unless the bounds fit the frequency and basis.

    CAL: bounds must equal the calendar period containing ``start``.
    Non-CAL: bounds come from the source; ``end >= start`` and, for A, the
    inclusive length must be 364-366 days. No other length rule is specified,
    so none is applied for Q/M/D.
    """
    if end < start:
        raise PeriodError(f"period end {end} precedes start {start}")
    if calendar_basis is CalendarBasis.CAL:
        if frequency is Frequency.D:
            expected = (start, start)
        else:
            expected = calendar_bounds(
                frequency,
                start.year,
                {Frequency.A: 1, Frequency.Q: (start.month - 1) // 3 + 1, Frequency.M: start.month}[
                    frequency
                ],
            )
        if (start, end) != expected:
            raise PeriodError(
                f"{frequency.value} CAL bounds {start}..{end} != calendar period "
                f"{expected[0]}..{expected[1]}"
            )
        return
    if frequency is Frequency.A:
        days = (end - start).days + 1
        if not NON_CAL_ANNUAL_MIN_DAYS <= days <= NON_CAL_ANNUAL_MAX_DAYS:
            raise PeriodError(
                f"{calendar_basis.value} annual period {start}..{end} is {days} days; "
                f"expected {NON_CAL_ANNUAL_MIN_DAYS}-{NON_CAL_ANNUAL_MAX_DAYS}"
            )
