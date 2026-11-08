# ruff: noqa: E501
"""AC-VAL-4 freshness table (>= 12 cases incl. quarter ends and WEO months), group rules, heartbeat."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from macro_monitor.monitoring.freshness import (
    CalendarEntry,
    SeriesInput,
    expected_period_end,
    group_state,
    period_end_on_or_before,
    series_state,
)
from macro_monitor.monitoring.run_summary import heartbeat_payload, write_heartbeat

M = CalendarEntry("M", 45, 20)
Q = CalendarEntry("Q", 60, 15)
A = CalendarEntry("A", 300, 120)
WEO = CalendarEntry(None, 0, 45, (4, 10))
D = date.fromisoformat

CASES = [
    # entry, run date, latest period end, expected state, expected_period_end
    (M, "2026-11-03", "2026-08-31", "fresh", "2026-08-31"),
    (M, "2026-11-03", "2026-07-31", "fresh", "2026-08-31"),  # inside tolerance of Aug publication
    (M, "2026-12-10", "2026-08-31", "late", "2026-09-30"),  # one behind, beyond tolerance
    (M, "2026-12-10", "2026-09-30", "fresh", "2026-09-30"),
    (M, "2027-01-20", "2026-09-30", "stale", "2026-11-30"),  # two behind
    (M, "2026-11-03", None, "stale", "2026-08-31"),
    (Q, "2026-05-30", "2025-12-31", "fresh", "2026-03-31"),  # quarter end, inside tolerance
    (Q, "2026-06-20", "2025-12-31", "late", "2026-03-31"),
    (Q, "2026-05-31", "2026-03-31", "fresh", "2026-03-31"),
    (Q, "2026-03-31", "2025-09-30", "late", "2025-12-31"),  # run date on a quarter end
    (A, "2027-03-15", "2024-12-31", "late", "2025-12-31"),
    (A, "2026-10-30", "2025-12-31", "fresh", "2025-12-31"),
    (WEO, "2026-04-10", "2025-10-31", "fresh", "2026-04-30"),  # April edition inside tolerance
    (WEO, "2026-06-01", "2025-10-31", "late", "2026-04-30"),
    (WEO, "2026-11-20", "2026-04-30", "late", "2026-10-31"),
    (WEO, "2026-11-20", "2026-10-31", "fresh", "2026-10-31"),
    (WEO, "2027-06-01", "2026-04-30", "stale", "2027-04-30"),
]


def test_period_ends() -> None:
    assert period_end_on_or_before("Q", D("2026-05-15")) == D("2026-03-31")
    assert period_end_on_or_before("Q", D("2026-06-30")) == D("2026-06-30")
    assert period_end_on_or_before("M", D("2026-03-01")) == D("2026-02-28")
    assert period_end_on_or_before("A", D("2026-12-30")) == D("2025-12-31")
    assert expected_period_end(Q, D("2026-03-31")) == D("2025-12-31")


@pytest.mark.parametrize(("entry", "today", "latest", "state", "expected"), CASES)
def test_freshness_table(
    entry: CalendarEntry, today: str, latest: str | None, state: str, expected: str
) -> None:
    got_state, got_exp = series_state(entry, D(today), D(latest) if latest else None)
    assert got_exp == D(expected)
    assert got_state == state


def test_broken_overrides() -> None:
    assert series_state(M, D("2026-11-03"), D("2026-09-30"), broken=True)[0] == "broken"


def test_group_rules() -> None:
    today = D("2027-01-20")
    ok, old = D("2026-11-30"), D("2026-09-30")
    mk = lambda i, p, **k: SeriesInput(i, p, **k)  # noqa: E731
    # >20 % stale -> stale
    assert group_state(M, today, [mk(1, ok), mk(2, ok), mk(3, ok), mk(4, old)])[0] == "stale"
    # exactly 20 % stale is not "more than 20 %"
    assert group_state(M, today, [mk(i, ok) for i in range(4)] + [mk(9, old)])[0] == "fresh"
    # core broken wins; non-core broken does not
    assert group_state(M, today, [mk(1, ok), mk(2, ok, broken=True, core=True)])[0] == "broken"
    assert (
        group_state(M, today, [mk(1, ok), mk(2, ok), mk(3, ok), mk(4, ok), mk(5, ok, broken=True)])[
            0
        ]
        == "fresh"
    )
    # known_stale: excluded from the vote, listed as info
    st, _, _, info = group_state(M, today, [mk(1, ok), mk(2, old, known_stale=True)])
    assert st == "fresh"
    assert info == [2]


def test_miss_counts_as_published() -> None:
    # caller passes max ref_period_end including MISS periods; a MISS period 2026-10-31 is fresh
    assert series_state(M, D("2026-12-10"), D("2026-10-31"))[0] == "fresh"


def test_heartbeat_has_no_values(tmp_path: Path) -> None:
    now = datetime(2026, 11, 1, 5, 0, 7, tzinfo=UTC)
    p = tmp_path / "ops" / "heartbeat.json"
    write_heartbeat(p, 42, {"b": "ok", "a": "partial"}, now)
    assert json.loads(p.read_text()) == {
        "run_id": 42,
        "timestamp_utc": "2026-11-01T05:00:07Z",
        "groups": {"a": "partial", "b": "ok"},
    }
    assert set(heartbeat_payload(1, {}, now)) == {"run_id", "timestamp_utc", "groups"}
