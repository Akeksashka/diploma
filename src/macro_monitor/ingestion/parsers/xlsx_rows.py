"""Guarded XLSX reader shared by the bulk-file parsers (FROZEN contract, version 1).

``sheet_rows`` returns the rows of one named worksheet as tuples of plain cell values. A bad
archive, a missing sheet or an oversized workbook is ``PARSE-01``. If the contract has to change,
add ``xlsx_rows_v2`` instead of editing this module (the parsers that use it are frozen).
"""

from __future__ import annotations

import io
import zipfile
import zlib
from collections.abc import Sequence
from typing import Any

from openpyxl import load_workbook

from macro_monitor.ingestion.base import ParseError

MAX_UNCOMPRESSED_BYTES = 64 * 1024**2  # zip-bomb guard on the sum of member sizes
MAX_MEMBERS = 100  # zip-bomb guard on the member count (an xlsx has a few dozen parts)
MAX_ROWS = 2_000_000
_ZIP_MAGIC = b"PK\x03\x04"


def is_xlsx(body: bytes) -> bool:
    """True if ``body`` is a zip that carries a workbook part (not any zip)."""
    if not body.startswith(_ZIP_MAGIC):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            return "xl/workbook.xml" in zf.namelist()
    except (
        zipfile.BadZipFile,
        RuntimeError,
        NotImplementedError,
        zlib.error,
        EOFError,
        OSError,
        ValueError,
    ):
        return False


def sheet_rows(body: bytes, sheet: str) -> list[tuple[Any, ...]]:
    """All rows of worksheet ``sheet`` (values only, formulas as cached values)."""
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_MEMBERS:
                raise ParseError("PARSE-01: too many zip members")
            if sum(i.file_size for i in infos) > MAX_UNCOMPRESSED_BYTES:
                raise ParseError("PARSE-01: workbook too large")
        wb = load_workbook(io.BytesIO(body), read_only=True, data_only=True)
    except ParseError:
        raise
    except Exception as exc:  # openpyxl raises a wide family on corrupt files
        raise ParseError(f"PARSE-01: unreadable workbook: {exc}") from exc
    try:
        if sheet not in wb.sheetnames:
            raise ParseError(f"PARSE-01: worksheet {sheet!r} not found (have {wb.sheetnames})")
        rows: list[tuple[Any, ...]] = []
        for row in wb[sheet].iter_rows(values_only=True):
            rows.append(tuple(row))
            if len(rows) > MAX_ROWS:
                raise ParseError("PARSE-01: worksheet too long")
        return rows
    finally:
        wb.close()


def text(cell: Any) -> str:
    """Stripped text of a cell ('' for an empty cell)."""
    return "" if cell is None else str(cell).strip()


__all__: Sequence[str] = ["is_xlsx", "sheet_rows", "text"]
