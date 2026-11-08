"""ADR-022: step 3 clears non-empty tables with plain DELETE; guard tables abort."""

from __future__ import annotations

from typing import Any

import pytest

from macro_monitor.storage import restore


class _FakeTools:
    def __init__(self, count: int) -> None:
        self.count = count
        self.sql: list[str] = []

    def query(self, statement: str) -> list[list[str]]:
        return [[str(self.count)]]

    def run_sql(self, statement: str) -> None:
        self.sql.append(statement)


def _clear(table: str, count: int) -> _FakeTools:
    tools = _FakeTools(count)
    fake: Any = tools
    restore._clear_seeded(fake, table, '"x"."y"')
    return tools


def test_empty_table_untouched() -> None:
    assert _clear("ref.series", 0).sql == []


def test_seeded_table_gets_plain_delete() -> None:
    assert _clear("ref.unit", 9).sql == ['DELETE FROM "x"."y"']


@pytest.mark.parametrize("table", ["ref.config_history", "ops.schema_migration"])
def test_guard_tables_abort(table: str) -> None:
    with pytest.raises(restore.RestoreError, match="refusing"):
        _clear(table, 1)
