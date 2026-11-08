"""T84 unit tests: series table construction (offline)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest

from macro_monitor.publish import series
from macro_monitor.publish.export import parquet_bytes

KN = datetime(2026, 1, 1, tzinfo=UTC)


def row(e: str, y: int, m: int, v: str | None, status: str = "OBS") -> tuple[object, ...]:
    end = date(y + (m == 12), m % 12 + 1, 1)
    return (
        "I", e, 7, date(y, m, 1), end - timedelta(days=1), "M", "NSA",
        None if v is None else Decimal(v), status, KN, KN, "initial",
    )  # fmt: skip


def test_start_and_yoy_use_full_history() -> None:
    rows = [row("DEU", 1990, m, str(100 + m)) for m in range(1, 13)] + [row("DEU", 1991, 1, "224")]
    t = series.build_table(rows, "YOY")
    assert t.num_rows == 1  # 1990 rows dropped from the output but used for YOY
    assert t.column("value_default_tf")[0].as_py() == pytest.approx(100 * (224 / 101 - 1))


def test_miss_is_null_and_nsa_qoq_is_null() -> None:
    rows = [
        row("DEU", 1991, m, None if m == 2 else "10", "MISS" if m == 2 else "OBS")
        for m in range(1, 5)
    ]
    t = series.build_table(rows, "M3M3_ANN")  # needs SA: whole column null, no error
    assert t.column("value").to_pylist() == [10.0, None, 10.0, 10.0]
    assert t.column("value_status").to_pylist()[1] == "MISS"
    assert t.column("value_default_tf").to_pylist() == [None] * 4


def test_multi_input_transform_is_null_and_bytes_deterministic() -> None:
    rows = [row("DEU", 1991, m, "10") for m in range(1, 4)]
    t = series.build_table(rows, "SUM12_PCT_GDP")
    assert t.column("value_default_tf").to_pylist() == [None] * 3
    assert parquet_bytes(t, group_by="entity_id") == parquet_bytes(t, group_by="entity_id")
    assert not series.is_single_series("RESERVE_COVER")
    assert series.is_single_series("LEVEL")
