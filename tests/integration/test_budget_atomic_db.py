"""T20/T57 follow-up: atomic hour/day budget acquire in ingest.request_state (needs Postgres)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest

from macro_monitor.ingestion.ratelimit import day_window, hour_window
from macro_monitor.ingestion.state import PostgresBudgetStore
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

T0 = datetime(2026, 11, 1, 10, 59, 59, tzinfo=UTC)


@pytest.fixture
def db(test_database: TestDatabase) -> TestDatabase:
    with test_database.connect() as c:
        migrate.migrate(c)
        c.execute(
            "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)"
        )
        c.commit()
    return test_database


def test_try_acquire_stops_at_the_limit_across_connections(db: TestDatabase) -> None:
    hour, day = (hour_window(T0), 3), (day_window(T0), None)
    with db.connect() as c1, db.connect() as c2:
        s1, s2 = PostgresBudgetStore(c1, "S"), PostgresBudgetStore(c2, "S")
        results = [s.try_acquire("h.test", hour, day) for s in (s1, s2, s1, s2, s1)]
        assert results == [None, None, None, hour_window(T0), hour_window(T0)]
        assert s2.get("h.test", hour_window(T0)) == 3
        assert s2.get("h.test", day_window(T0)) == 3  # refused calls count nothing


def test_try_acquire_resets_at_the_clock_hour(db: TestDatabase) -> None:
    nxt = T0 + timedelta(seconds=1)  # 11:00:00
    with db.connect() as c:
        s = PostgresBudgetStore(c, "S")
        assert s.try_acquire("x", (hour_window(T0), 1), (day_window(T0), None)) is None
        assert s.try_acquire("x", (hour_window(T0), 1), (day_window(T0), None)) is not None
        assert s.try_acquire("x", (hour_window(nxt), 1), (day_window(nxt), None)) is None
        assert (s.get("x", hour_window(nxt)), s.get("x", day_window(nxt))) == (1, 2)


def test_two_threads_racing_at_count_seven_exactly_one_passes(db: TestDatabase) -> None:
    """Truly concurrent: two connections released by a barrier at count 7 of 8."""
    import threading

    hour, day = (hour_window(T0), 8), (day_window(T0), None)
    with db.connect() as seed:
        s = PostgresBudgetStore(seed, "S")
        assert [s.try_acquire("race", hour, day) for _ in range(7)] == [None] * 7
    barrier = threading.Barrier(2)
    results: list[str | None] = []
    errors: list[BaseException] = []

    def run() -> None:
        try:
            with db.connect() as c:
                store = PostgresBudgetStore(c, "S")
                barrier.wait(timeout=10)
                results.append(store.try_acquire("race", hour, day))
        except BaseException as exc:  # surfaced below, threads must not swallow failures
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert errors == []
    assert sorted(r is None for r in results) == [False, True]  # one passed, one refused
    with db.connect() as c:
        assert PostgresBudgetStore(c, "S").get("race", hour_window(T0)) == 8
