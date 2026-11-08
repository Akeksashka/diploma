"""T04 spike BB13: pandas 3 + pandera + pyarrow, and pandera on staged-row frames (ADR-016)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from importlib.metadata import version

import pandas as pd
import pandera.pandas as pa
import pyarrow as pa_arrow
import pytest


def _staged_rows() -> list[dict[str, object]]:
    return [
        {
            "series_key": "SYN.M.XX",
            "period_start": date(2026, 1, 1),
            "value": Decimal("100.5"),
            "status": "A",
        },
        {
            "series_key": "SYN.M.XX",
            "period_start": date(2026, 2, 1),
            "value": None,
            "status": "MISS",
        },
    ]


_SCHEMA = pa.DataFrameSchema(
    {
        "series_key": pa.Column(str, nullable=False),
        "period_start": pa.Column(object, nullable=False),
        "value": pa.Column(object, nullable=True),
        "status": pa.Column(str, pa.Check.isin(["A", "P", "MISS", "DEL"])),
    },
    strict=True,
)


def test_pandas_major_version_is_3() -> None:
    assert int(version("pandas").split(".")[0]) == 3


def test_pandera_validates_staged_rows_frame() -> None:
    frame = pd.DataFrame(_staged_rows())
    out = _SCHEMA.validate(frame)
    assert len(out) == 2
    assert isinstance(frame.loc[0, "value"], Decimal)  # Decimal survives in object column


def test_pandera_reports_all_failures_lazily() -> None:
    rows = _staged_rows()
    rows[0]["status"] = "BOGUS"
    rows[1]["series_key"] = None
    with pytest.raises(pa.errors.SchemaErrors) as exc:
        _SCHEMA.validate(pd.DataFrame(rows), lazy=True)
    assert len(exc.value.failure_cases) >= 2


def test_pandera_rejects_unexpected_column_when_strict() -> None:
    frame = pd.DataFrame(_staged_rows()).assign(extra=1)
    with pytest.raises((pa.errors.SchemaError, pa.errors.SchemaErrors)):
        _SCHEMA.validate(frame)


def test_pandera_empty_frame() -> None:
    empty = pd.DataFrame({c: pd.Series(dtype=object) for c in _SCHEMA.columns})
    empty["series_key"] = empty["series_key"].astype(str)
    empty["status"] = empty["status"].astype(str)
    assert len(_SCHEMA.validate(empty)) == 0


def test_pyarrow_roundtrip_with_pandas_3() -> None:
    table = pa_arrow.Table.from_pylist(
        _staged_rows(),
        schema=pa_arrow.schema(
            [
                ("series_key", pa_arrow.string()),
                ("period_start", pa_arrow.date32()),
                ("value", pa_arrow.decimal128(18, 4)),
                ("status", pa_arrow.string()),
            ]
        ),
    )
    frame = table.to_pandas()
    assert len(frame) == 2
    back = pa_arrow.Table.from_pandas(frame, preserve_index=False)
    assert back.num_rows == 2
    # pandas round trip narrows decimal precision (18,4 -> 7,4): scale kept, value exact.
    assert back.column("value").type.scale == 4
    assert back.column("value")[0].as_py() == Decimal("100.5000")
    assert back.column("value")[1].as_py() is None
