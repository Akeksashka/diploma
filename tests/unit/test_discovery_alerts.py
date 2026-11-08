"""ADR-028 D5: one alert key per source per month."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from macro_monitor.monitoring import discovery_alerts as da


class Conn:
    def __init__(self, rows: list[tuple[str, int]]) -> None:
        self.rows = rows
        self.params: list[Any] = []

    def execute(self, sql: str, params: list[Any]) -> Conn:
        self.params = params
        return self

    def fetchall(self) -> list[tuple[str, int]]:
        return self.rows


def test_one_finding_per_source_keyed_by_month() -> None:
    conn = Conn([("fao", 3), ("worldbank_pinksheet", 1)])
    found = da.discovery_findings(conn, datetime(2026, 11, 20, 9, tzinfo=UTC))  # type: ignore[arg-type]
    assert [f.title for f in found] == [
        "[discovery_failed] fao 2026-11",
        "[discovery_failed] worldbank_pinksheet 2026-11",
    ]
    assert found[0].metrics == {"attempts": 3}
    assert conn.params == [datetime(2026, 11, 1, tzinfo=UTC), datetime(2026, 12, 1, tzinfo=UTC)]


def test_december_window_rolls_the_year_and_next_month_is_a_new_key() -> None:
    conn = Conn([("fao", 1)])
    dec = da.discovery_findings(conn, datetime(2026, 12, 31, tzinfo=UTC))  # type: ignore[arg-type]
    assert conn.params[1] == datetime(2027, 1, 1, tzinfo=UTC)
    jan = da.discovery_findings(conn, datetime(2027, 1, 2, tzinfo=UTC))  # type: ignore[arg-type]
    assert dec[0].title != jan[0].title
