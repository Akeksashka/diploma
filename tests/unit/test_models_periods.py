"""Unit tests for macro_monitor.models.periods (T06)."""

from __future__ import annotations

import random
from datetime import date, timedelta

import pytest

from macro_monitor.models.enums import CalendarBasis, Frequency
from macro_monitor.models.periods import (
    PeriodError,
    calendar_bounds,
    check_bounds,
    format_period,
    parse_period,
)

pytestmark = pytest.mark.unit

A, Q, M, D = Frequency.A, Frequency.Q, Frequency.M, Frequency.D
CAL, FISCAL, MKTYR = CalendarBasis.CAL, CalendarBasis.FISCAL, CalendarBasis.MKTYR


@pytest.mark.parametrize(
    ("label", "freq", "start", "end"),
    [
        ("2026", A, date(2026, 1, 1), date(2026, 12, 31)),
        ("2026-Q1", Q, date(2026, 1, 1), date(2026, 3, 31)),
        ("2026-Q2", Q, date(2026, 4, 1), date(2026, 6, 30)),
        ("2026-Q3", Q, date(2026, 7, 1), date(2026, 9, 30)),
        ("2026-Q4", Q, date(2026, 10, 1), date(2026, 12, 31)),
        ("2026-09", M, date(2026, 9, 1), date(2026, 9, 30)),
        ("2026-02", M, date(2026, 2, 1), date(2026, 2, 28)),
        ("2024-02", M, date(2024, 2, 1), date(2024, 2, 29)),
        ("1900-02", M, date(1900, 2, 1), date(1900, 2, 28)),
        ("2000-02", M, date(2000, 2, 1), date(2000, 2, 29)),
        ("2026-12", M, date(2026, 12, 1), date(2026, 12, 31)),
        ("2026-09-30", D, date(2026, 9, 30), date(2026, 9, 30)),
        ("2024-02-29", D, date(2024, 2, 29), date(2024, 2, 29)),
    ],
)
def test_parse_table(label: str, freq: Frequency, start: date, end: date) -> None:
    p = parse_period(label)
    assert (p.frequency, p.start, p.end) == (freq, start, end)


@pytest.mark.parametrize(
    "label",
    [
        "",
        "26",
        "2026-Q5",
        "2026-Q0",
        "2026-13",
        "2026-00",
        "2026-02-30",
        "2025-02-29",
        "2026Q3",
        "2026-9",
        "FY2026",
        "2026-W10",
        "2026-09-30T00:00",
    ],
)
def test_parse_rejects(label: str) -> None:
    with pytest.raises(PeriodError):
        parse_period(label)


def test_calendar_bounds_day_of_year() -> None:
    assert calendar_bounds(D, 2024, 366) == (date(2024, 12, 31),) * 2
    with pytest.raises(PeriodError):
        calendar_bounds(D, 2026, 366)


def test_round_trip_seeded() -> None:
    rng = random.Random(20261027)
    base = date(1950, 1, 1)
    for _ in range(2000):
        d = base + timedelta(days=rng.randrange(0, 365 * 120))
        for freq in Frequency:
            label = format_period(freq, d)
            p = parse_period(label)
            assert p.frequency is freq
            assert p.start <= d <= p.end
            assert format_period(freq, p.start) == label
            check_bounds(freq, CAL, p.start, p.end)


@pytest.mark.parametrize(
    ("freq", "start", "end"),
    [
        (A, date(2026, 1, 1), date(2026, 12, 30)),
        (A, date(2026, 2, 1), date(2027, 1, 31)),
        (Q, date(2026, 1, 1), date(2026, 3, 30)),
        (Q, date(2026, 2, 1), date(2026, 4, 30)),
        (M, date(2026, 2, 1), date(2026, 3, 1)),
        (D, date(2026, 5, 1), date(2026, 5, 2)),
        (M, date(2026, 5, 2), date(2026, 5, 31)),
    ],
)
def test_cal_bounds_violations(freq: Frequency, start: date, end: date) -> None:
    with pytest.raises(PeriodError):
        check_bounds(freq, CAL, start, end)


def test_end_before_start() -> None:
    with pytest.raises(PeriodError):
        check_bounds(D, CAL, date(2026, 5, 2), date(2026, 5, 1))
    with pytest.raises(PeriodError):
        check_bounds(M, FISCAL, date(2026, 5, 2), date(2026, 5, 1))


@pytest.mark.parametrize("basis", [FISCAL, MKTYR])
def test_non_cal_annual_length(basis: CalendarBasis) -> None:
    start = date(2025, 7, 1)
    ok = [364, 365, 366]
    for n in ok:
        check_bounds(A, basis, start, start + timedelta(days=n - 1))
    for n in (363, 367, 30):
        with pytest.raises(PeriodError):
            check_bounds(A, basis, start, start + timedelta(days=n - 1))


def test_non_cal_leap_fiscal_year() -> None:
    check_bounds(A, FISCAL, date(2023, 7, 1), date(2024, 6, 30))  # 366
    check_bounds(A, FISCAL, date(2025, 7, 1), date(2026, 6, 30))  # 365


def test_non_cal_not_guessed_from_calendar() -> None:
    # Source-supplied non-calendar quarter is accepted as given (no label guessing).
    check_bounds(Q, FISCAL, date(2025, 7, 1), date(2025, 9, 30))
    check_bounds(Q, FISCAL, date(2025, 8, 1), date(2025, 10, 31))
