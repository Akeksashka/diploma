"""Postgres-backed persistent state in ``ingest.request_state`` (T20).

- ``PostgresBudgetStore`` keeps the hour/day request counters of a host (``BudgetStore``), so a
  catch-up run cannot exceed the budgets. Row key: ``budget:<host>``; columns
  ``requests_this_hour``, ``requests_this_day``, ``counters_reset_at`` (start of the window of
  the last increment).
- ``PostgresRobotsCache`` keeps the robots.txt cache. Row key: ``robots:<host>``; columns
  ``robots_sha256``, ``robots_checked_at``, ``last_status`` (``robots_present``/``robots_absent``).
  The table has no column for the file itself, so the (public, size-capped) text is kept in
  ``update_marker`` of that row; no migration is needed.

Both take a dedicated psycopg connection (not shared with a load transaction); every call runs
in its own transaction and commits, so counters survive a crash and a new runner.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime

import psycopg

from macro_monitor.ingestion.ratelimit import day_window, hour_window
from macro_monitor.ingestion.robots import CachedRobots, RobotsState

BUDGET_PREFIX = "budget:"
ROBOTS_PREFIX = "robots:"


def window_start(window: str) -> datetime:
    """Start (UTC) of a window label made by ``hour_window`` / ``day_window``."""
    if window.startswith("h"):
        return datetime.strptime(window[1:], "%Y%m%d%H").replace(tzinfo=UTC)
    if window.startswith("d"):
        return datetime.strptime(window[1:], "%Y%m%d").replace(tzinfo=UTC)
    raise ValueError(f"unknown budget window: {window!r}")


class PostgresBudgetStore:
    def __init__(self, conn: psycopg.Connection, source_id: str) -> None:
        self._conn = conn
        self._source_id = source_id
        self._lock = threading.Lock()

    def _key(self, host: str) -> str:
        return BUDGET_PREFIX + host

    def get(self, host: str, window: str) -> int:
        with self._lock, self._conn.transaction():
            row = self._conn.execute(
                "SELECT requests_this_hour, requests_this_day, counters_reset_at "
                "FROM ingest.request_state WHERE source_id = %s AND request_key = %s",
                [self._source_id, self._key(host)],
            ).fetchone()
        if row is None or row[2] is None:
            return 0
        hour, day, stamp = row
        if window.startswith("h"):
            return int(hour or 0) if hour_window(stamp) == window else 0
        return int(day or 0) if day_window(stamp) == window else 0

    def increment(self, host: str, window: str) -> None:
        start = window_start(window)
        with self._lock, self._conn.transaction():
            self._conn.execute(
                "INSERT INTO ingest.request_state (source_id, request_key, last_url, "
                "requests_this_hour, requests_this_day, counters_reset_at) "
                "VALUES (%s, %s, %s, 0, 0, NULL) ON CONFLICT DO NOTHING",
                [self._source_id, self._key(host), f"https://{host}/"],
            )
            row = self._conn.execute(
                "SELECT requests_this_hour, requests_this_day, counters_reset_at "
                "FROM ingest.request_state WHERE source_id = %s AND request_key = %s FOR UPDATE",
                [self._source_id, self._key(host)],
            ).fetchone()
            assert row is not None
            hour, day, stamp = int(row[0] or 0), int(row[1] or 0), row[2]
            if window.startswith("h"):
                if stamp is None or hour_window(stamp) != window:
                    hour = 0
                if stamp is None or day_window(stamp) != day_window(start):
                    day = 0
                hour += 1
                stamp = start
            else:
                if stamp is None or day_window(stamp) != window:
                    day, hour, stamp = 0, 0, start
                day += 1
            self._conn.execute(
                "UPDATE ingest.request_state SET requests_this_hour = %s, requests_this_day = %s, "
                "counters_reset_at = %s WHERE source_id = %s AND request_key = %s",
                [hour, day, stamp, self._source_id, self._key(host)],
            )

    def try_acquire(
        self,
        host: str,
        hour: tuple[str, int | None],
        day: tuple[str, int | None],
    ) -> str | None:
        """One conditional ``UPDATE ... WHERE count < limit RETURNING``: atomic across processes.

        The row lock taken by the UPDATE serialises concurrent callers; under READ COMMITTED the
        waiting one re-evaluates the WHERE clause on the new row version, so only one of two
        callers at ``limit - 1`` is counted. Windows are fixed UTC clock hours and days.
        """
        (hour_label, hour_limit), (day_label, day_limit) = hour, day
        hour_start = window_start(hour_label)
        day_start = window_start(day_label)
        hour_now = "(counters_reset_at = %(hs)s AND requests_this_hour IS NOT NULL)"
        day_now = (
            "(counters_reset_at >= %(ds)s AND counters_reset_at < %(ds)s + interval '1 day' "
            "AND requests_this_day IS NOT NULL)"
        )
        hour_val = f"(CASE WHEN {hour_now} THEN requests_this_hour ELSE 0 END)"
        day_val = f"(CASE WHEN {day_now} THEN requests_this_day ELSE 0 END)"
        params = {
            "hs": hour_start,
            "ds": day_start,
            "hl": hour_limit,
            "dl": day_limit,
            "sid": self._source_id,
            "key": self._key(host),
            "url": f"https://{host}/",
        }
        with self._lock, self._conn.transaction():
            self._conn.execute(
                "INSERT INTO ingest.request_state (source_id, request_key, last_url, "
                "requests_this_hour, requests_this_day, counters_reset_at) "
                "VALUES (%(sid)s, %(key)s, %(url)s, 0, 0, NULL) ON CONFLICT DO NOTHING",
                params,
            )
            row = self._conn.execute(
                f"UPDATE ingest.request_state SET requests_this_hour = {hour_val} + 1, "
                f"requests_this_day = {day_val} + 1, counters_reset_at = %(hs)s "
                "WHERE source_id = %(sid)s AND request_key = %(key)s "
                f"AND (%(hl)s::int IS NULL OR {hour_val} < %(hl)s::int) "
                f"AND (%(dl)s::int IS NULL OR {day_val} < %(dl)s::int) "
                "RETURNING requests_this_hour",
                params,
            ).fetchone()
        if row is not None:
            return None
        if hour_limit is not None and self.get(host, hour_label) >= hour_limit:
            return hour_label
        return day_label


class PostgresRobotsCache:
    def __init__(self, conn: psycopg.Connection, source_id: str) -> None:
        self._conn = conn
        self._source_id = source_id
        self._lock = threading.Lock()

    def load(self, host: str) -> CachedRobots | None:
        with self._lock, self._conn.transaction():
            row = self._conn.execute(
                "SELECT last_url, last_status, update_marker, robots_sha256, robots_checked_at "
                "FROM ingest.request_state WHERE source_id = %s AND request_key = %s",
                [self._source_id, ROBOTS_PREFIX + host],
            ).fetchone()
        if row is None or row[4] is None or row[1] not in ("robots_present", "robots_absent"):
            return None
        state: RobotsState = "present" if row[1] == "robots_present" else "absent"
        return CachedRobots(row[0], state, row[2], row[3], row[4])

    def save(self, host: str, entry: CachedRobots) -> None:
        with self._lock, self._conn.transaction():
            self._conn.execute(
                "INSERT INTO ingest.request_state (source_id, request_key, last_url, last_status, "
                "update_marker, robots_sha256, robots_checked_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (source_id, request_key) DO UPDATE SET last_url = EXCLUDED.last_url, "
                "last_status = EXCLUDED.last_status, update_marker = EXCLUDED.update_marker, "
                "robots_sha256 = EXCLUDED.robots_sha256, "
                "robots_checked_at = EXCLUDED.robots_checked_at",
                [
                    self._source_id,
                    ROBOTS_PREFIX + host,
                    entry.url,
                    "robots_present" if entry.state == "present" else "robots_absent",
                    entry.body,
                    entry.sha256,
                    entry.checked_at,
                ],
            )
