"""T66 unit tests: DB-01/02, LOAD-01, ORD-02, FRESH-03 (AC-VAL-7, AC-VAL-8, AC-VAL-10)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import psycopg
import pytest

from macro_monitor.monitoring import backlog as b
from macro_monitor.monitoring import db_budget as d

MB = d.MB


def test_ac_val_7_projection_warns() -> None:
    samples = [x * MB for x in (600, 640, 680, 720, 760, 800)]
    proj = d.project_size(samples)
    assert proj is not None
    assert abs(proj - 1280 * MB) < 1
    assert proj >= d.ERROR_BYTES


def test_projection_flat_and_short() -> None:
    assert d.project_size([100 * MB] * 6) == pytest.approx(100 * MB)
    assert d.project_size([1.0, 2.0]) is None


def test_size_thresholds() -> None:
    assert d.size_severity(700 * MB) == "info"
    assert d.size_severity(701 * MB) == "warn"
    assert d.size_severity(901 * MB) == "error"


def test_db01_retries_then_fails() -> None:
    calls: list[float] = []

    def boom() -> int:
        raise psycopg.OperationalError("x")

    with pytest.raises(d.DatabaseUnavailable):
        d.connect_with_retry(boom, attempts=3, sleep=calls.append)
    assert calls == [2.0, 4.0]


def test_db01_succeeds_on_second_attempt() -> None:
    state = {"n": 0}

    def flaky() -> str:
        state["n"] += 1
        if state["n"] < 2:
            raise psycopg.OperationalError("x")
        return "ok"

    assert d.connect_with_retry(flaky, sleep=lambda _: None) == "ok"


def test_ac_val_8_backlog_ages() -> None:
    assert b.backlog_severity(0.5) == "info"
    assert b.backlog_severity(2) == "warn"
    assert b.backlog_severity(41) == "error"
    assert b.backlog_severity(None) == "info"


NOW = datetime(2026, 11, 4, 12, tzinfo=UTC)


def test_ord02_held_behind_oldest() -> None:
    objs = [
        b.UnloadedObject(3, "S", "G", NOW - timedelta(days=1)),
        b.UnloadedObject(1, "S", "G", NOW - timedelta(days=2)),
        b.UnloadedObject(9, "S", "H", NOW - timedelta(hours=1)),
    ]
    g, h = b.evaluate_backlog(objs, NOW)
    assert (g.blocking_raw_id, g.held_raw_ids, g.severity) == (1, (3,), "warn")
    assert (h.held_raw_ids, h.severity) == ((), "info")


REM = b.Reminder("imf", "weo", 10, 25, "t")


@pytest.mark.parametrize(
    ("today", "state"),
    [
        (date(2026, 10, 24), "none"),
        (date(2026, 10, 25), "reminder"),
        (date(2026, 11, 14), "reminder"),
        (date(2026, 11, 15), "escalation"),  # 1 Oct + 45 d
    ],
)
def test_ac_val_10_october(today: date, state: str) -> None:
    assert b.fresh03_state(REM, today, edition_present=False)[0] == state


def test_ac_val_10_present_and_april() -> None:
    assert b.fresh03_state(REM, date(2026, 10, 25), edition_present=True)[0] == "none"
    apr = b.Reminder("imf", "weo", 4, 25, "t")
    got = [b.fresh03_state(apr, date(2026, 4, d), edition_present=False)[0] for d in (24, 25)]
    assert got == ["none", "reminder"]
    assert b.fresh03_state(apr, date(2026, 5, 16), edition_present=False)[0] == "escalation"


def test_reminders_from_config() -> None:
    src = {
        "id": "imf",
        "groups": [{"id": "weo", "edition_ordered": True}],
        "reminders": [{"remind_on": {"month": 4, "day": 25}, "text": "t"}],
    }
    assert b.reminders_from_config([src, {"id": "x"}]) == [b.Reminder("imf", "weo", 4, 25, "t")]
