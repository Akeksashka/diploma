"""T20 persistence of budgets and robots cache in ingest.request_state (needs Postgres)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import httpx
import psycopg
import pytest

from macro_monitor.ingestion.http import HttpClient, HttpSettings
from macro_monitor.ingestion.ratelimit import (
    BudgetExhausted,
    RateLimitConfig,
    RateLimiter,
    day_window,
    hour_window,
)
from macro_monitor.ingestion.robots import RobotsGate
from macro_monitor.ingestion.state import PostgresBudgetStore, PostgresRobotsCache
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

T0 = datetime(2026, 11, 1, 6, 10, tzinfo=UTC)


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now
        self.mono = 0.0

    def monotonic(self) -> float:
        return self.mono

    def sleep(self, seconds: float) -> None:
        self.mono += seconds

    def wall(self) -> datetime:
        return self.now


@pytest.fixture
def db(test_database: TestDatabase) -> TestDatabase:
    with test_database.connect() as c:
        migrate.migrate(c)
        c.execute(
            "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)"
        )
        c.commit()
    return test_database


def _row(conn: psycopg.Connection, key: str) -> tuple[object, ...]:
    r = conn.execute(
        "SELECT requests_this_hour, requests_this_day FROM ingest.request_state "
        "WHERE source_id = 'S' AND request_key = %s",
        [key],
    ).fetchone()
    assert r is not None
    return r


def test_budget_counters_persist_across_connections(db: TestDatabase) -> None:
    h, d = hour_window(T0), day_window(T0)
    with db.connect() as c1:
        s1 = PostgresBudgetStore(c1, "S")
        assert s1.get("h.test", h) == 0
        s1.increment("h.test", h)
        s1.increment("h.test", d)
        s1.increment("h.test", h)
        s1.increment("h.test", d)
    with db.connect() as c2:  # a new runner
        s2 = PostgresBudgetStore(c2, "S")
        assert (s2.get("h.test", h), s2.get("h.test", d)) == (2, 2)
        assert s2.get("other.test", h) == 0
        assert _row(c2, "budget:h.test") == (2, 2)


def test_windows_roll_over(db: TestDatabase) -> None:
    h, d = hour_window(T0), day_window(T0)
    nxt_h = hour_window(T0 + timedelta(hours=1))
    nxt_d = day_window(T0 + timedelta(days=1))
    with db.connect() as c:
        s = PostgresBudgetStore(c, "S")
        for w in (h, d, h, d):
            s.increment("x", w)
        assert s.get("x", nxt_h) == 0
        assert s.get("x", d) == 2
        s.increment("x", nxt_h)
        s.increment("x", d)
        assert (s.get("x", nxt_h), s.get("x", d)) == (1, 3)  # new hour, same day
        later = hour_window(T0 + timedelta(days=1))
        s.increment("x", later)
        s.increment("x", nxt_d)
        assert (s.get("x", later), s.get("x", nxt_d)) == (1, 1)
        assert s.get("x", d) == 0


def test_catch_up_run_cannot_exceed_budget(db: TestDatabase) -> None:
    cfg = RateLimitConfig(budget_per_hour=3)
    clock = Clock(T0)
    for run in range(2):  # two separate runs, separate connections
        with db.connect() as c:
            lim = RateLimiter("h.test", cfg, clock, PostgresBudgetStore(c, "S"))
            made = 0
            try:
                for _ in range(2):
                    lim.acquire()
                    lim.release()
                    made += 1
            except BudgetExhausted:
                pass
            assert made == (2 if run == 0 else 1)
    clock.now += timedelta(hours=1)
    with db.connect() as c:
        lim = RateLimiter("h.test", cfg, clock, PostgresBudgetStore(c, "S"))
        lim.acquire()
        lim.release()


def test_robots_cache_persists_across_runs(db: TestDatabase) -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, text="User-agent: *\nDisallow: /private/\n")

    def gate(conn: psycopg.Connection, clock: Clock) -> RobotsGate:
        client = HttpClient(
            HttpSettings(base_url="https://site.example.test/"),
            repo_url="https://example.test/repo",
            clock=clock,
            transport=httpx.MockTransport(handler),
        )
        return RobotsGate(client, PostgresRobotsCache(conn, "S"))

    src = {"id": "S", "kind": "rest"}
    clock = Clock(T0)
    with db.connect() as c1:
        d1 = gate(c1, clock).check(src, "https://site.example.test/private/a")
    assert seen == ["/robots.txt"]
    assert d1.decision == "log_only:disallowed"
    clock.now += timedelta(hours=3)
    with db.connect() as c2:
        d2 = gate(c2, clock).check(src, "https://site.example.test/ok")
        assert seen == ["/robots.txt"]  # served from request_state
        assert d2.decision == "log_only:allowed"
        assert d2.robots_sha256 == d1.robots_sha256
        row = c2.execute(
            "SELECT robots_sha256, robots_checked_at FROM ingest.request_state "
            "WHERE source_id = 'S' AND request_key = 'robots:site.example.test'"
        ).fetchone()
        assert row is not None
        assert row[0] == d1.robots_sha256
        assert row[1] == d1.checked_at
    clock.now += timedelta(hours=25)
    with db.connect() as c3:
        gate(c3, clock).check(src, "https://site.example.test/ok")
    assert seen == ["/robots.txt", "/robots.txt"]
