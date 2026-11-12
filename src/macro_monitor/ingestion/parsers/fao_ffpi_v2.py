"""FAO Food Price Index (FFPI) monthly CSV parser, version 2 (FROZEN once released).

Real layout (captured 2026-11 from ``wfs-library/food_price_indices_data.csv``): a title line, the
base-period line ``2014-2016=100``, the ``Date`` header, then a row of only commas, then
``YYYY-MM`` data rows. Every line is padded with trailing commas to 66 columns, so the header has
empty cells after the last sub-index (``Sugar``). v1 rejects both the padding and the blank row.

This version removes the empty trailing header cells and the blank rows between the header and the
first data row, then hands the text to ``fao_ffpi_v1`` unchanged (same series references, same
metadata). Any other difference still fails closed with PARSE-01 in v1.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from dataclasses import replace

from macro_monitor.ingestion.base import ParseError, ParseOutput, RawObject, SeriesFilter
from macro_monitor.ingestion.parsers import fao_ffpi_v1

PARSER_VERSION = "2"
PARSER_ID = f"fao_ffpi_v{PARSER_VERSION}@{PARSER_VERSION}"
HEADER_SCAN_LINES = fao_ffpi_v1.HEADER_SCAN_LINES


def _normalize(body: bytes) -> bytes:
    try:
        lines = body.decode("utf-8-sig").splitlines()
    except UnicodeDecodeError as exc:
        raise ParseError(f"PARSE-01: not UTF-8: {exc}") from exc
    start = next(
        (i for i, line in enumerate(lines[:HEADER_SCAN_LINES]) if line.split(",", 1)[0] == "Date"),
        -1,
    )
    if start < 0:
        return body  # v1 reports the missing header
    try:
        header = next(csv.reader([lines[start]]))
    except csv.Error as exc:
        raise ParseError(f"PARSE-01: unreadable csv: {exc}") from exc
    while header and not header[-1].strip():
        header.pop()
    out = io.StringIO()
    csv.writer(out, lineterminator="\n").writerow(header)
    rest = lines[start + 1 :]
    first = next((i for i, line in enumerate(rest) if line.strip(", \t")), len(rest))
    text = "\n".join([*lines[:start], out.getvalue().rstrip("\n"), *rest[first:]])
    return text.encode("utf-8")


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    return fao_ffpi_v1.parse(replace(raw, body=_normalize(raw.body)), series_filter)


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
