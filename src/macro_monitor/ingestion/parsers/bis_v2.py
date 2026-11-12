"""BIS bulk-download parser, version 2 (FROZEN once released): the real BIS flat-CSV layout.

The real files (captured 2026-11, ``WS_CBPOL`` and ``WS_CREDIT_GAP``) have no ``KEY`` column.
Header cells are ``CODE:Label`` and data cells are ``CODE: Label`` (``M: Monthly``, ``IL: Israel``).
The series reference is rebuilt from the dimension columns between ``ACTION`` and
``TIME_PERIOD``, joined by ``.`` (``M.US``; ``Q.US.P.A.C``), which matches the series-map keys.
Rows are then parsed by ``bis_v1``; an ``OBS_VALUE`` of ``NaN`` or empty with ``OBS_STATUS``
``M`` is passed on as an empty value (missing, ``MISS``). Unit codes ``368`` and ``770`` are
mapped to ``PCT`` and ``PCT_GDP``; any other code is passed through unchanged.
"""

from __future__ import annotations

import csv
import zipfile
from collections.abc import Iterator, Sequence
from typing import cast

from macro_monitor.ingestion.base import ParseError, ParseOutput, RawObject, SeriesFilter
from macro_monitor.ingestion.parsers import bis_v1

PARSER_VERSION = "2"
PARSER_ID = f"bis_v{PARSER_VERSION}@{PARSER_VERSION}"
REQUIRED = ("FREQ", "TIME_PERIOD", "OBS_VALUE")
ENTITY_COLUMNS = ("REF_AREA", "BORROWERS_CTY")
UNITS = {"368": "PCT", "770": "PCT_GDP"}


def _code(cell: str | None) -> str:
    return (cell or "").split(":", 1)[0].strip()


def _rows(
    reader: csv.DictReader[str], dims: list[str], names: dict[str, str]
) -> Iterator[dict[str, str]]:
    for row in reader:
        code = {c: _code(row.get(names[c])) for c in names}
        key = ".".join(code[d] for d in dims)
        entity = next((code[c] for c in ENTITY_COLUMNS if c in code), "")
        unit = code.get("UNIT_MEASURE", "")
        title = (
            row.get(names.get("TITLE", "")) or row.get(names.get("TITLE_TS", "")) or ""
        ).strip()
        value = row.get(names["OBS_VALUE"]) or ""
        if code.get("OBS_STATUS", "") == "M" and value.strip().lower() in {"", "nan"}:
            value = ""  # missing observation: v1 would reject a literal NaN as non-finite
        yield {
            "KEY": key,
            "FREQ": code["FREQ"],
            "REF_AREA": entity,
            "UNIT_MEASURE": UNITS.get(unit, unit),
            "TIME_PERIOD": (row.get(names["TIME_PERIOD"]) or "").strip(),
            "OBS_VALUE": value,
            "OBS_STATUS": code.get("OBS_STATUS", ""),
            "TITLE": title,
        }


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    try:
        reader = csv.DictReader(bis_v1.csv_text(raw.body))
        fields = reader.fieldnames or []
        names = {f.split(":", 1)[0]: f for f in fields}
        missing = [c for c in REQUIRED if c not in names]
        if missing:
            raise ParseError(f"PARSE-01: missing columns {missing}")
        codes = [f.split(":", 1)[0] for f in fields]
        start = codes.index("ACTION") + 1 if "ACTION" in codes else 0
        dims = [c for c in codes[start : codes.index("TIME_PERIOD")] if c in names]
        if "FREQ" not in dims:
            raise ParseError("PARSE-01: no FREQ dimension before TIME_PERIOD")
        wanted = {*dims, *REQUIRED, "UNIT_MEASURE", "OBS_STATUS", "TITLE", "TITLE_TS"}
        sel = {c: names[c] for c in names if c in wanted}
        return bis_v1._parse_rows(
            cast("csv.DictReader[str]", _rows(reader, dims, sel)), series_filter
        )
    except UnicodeDecodeError as exc:
        raise ParseError(f"PARSE-01: not UTF-8: {exc}") from exc
    except (csv.Error, zipfile.BadZipFile) as exc:
        raise ParseError(f"PARSE-01: unreadable csv: {exc}") from exc


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
