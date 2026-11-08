"""World Bank Pink Sheet monthly XLSX parser, version 1 (FROZEN once released).

Input: the bytes of the monthly historical workbook. Pure function of the bytes and the series
filter. Layout asserted (fail closed with PARSE-01 on any difference):

- worksheet ``Monthly Prices``;
- row 5: ``A5 == "Commodity"``, then one commodity name per column (unique, non-empty);
- row 6: ``A6 == "Unit"``, then the unit text per column, e.g. ``($/bbl)``, ``(2010 = 100)``;
- data rows from row 7: column A is a ``YYYYMnn`` period label (``1960M01``); the block ends at
  the first row with an empty column A (footnotes below are ignored).

Series reference: the commodity name of row 5. Empty value cells are skipped (no observation);
text in ``missing_markers`` gives ``MISS``; other text is a rejected row (PARSE-03).

[UNVERIFIED] The sheet name, the row numbers, the ``Commodity``/``Unit`` anchors and the unit
spellings follow the synthetic fixture only; no real Pink Sheet file was captured (the real file
is believed to have a different header block). If a real file differs, add ``pinksheet_v2``
instead of editing this module.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation
from typing import Any

from macro_monitor.ingestion.base import (
    ParseError,
    ParseOutput,
    RawObject,
    RejectedRow,
    SeriesFilter,
)
from macro_monitor.ingestion.parsers.xlsx_rows import sheet_rows, text
from macro_monitor.models.periods import PeriodError, parse_period
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "1"
PARSER_ID = f"pinksheet_v1@{PARSER_VERSION}"
SHEET = "Monthly Prices"
NAME_ROW, UNIT_ROW, FIRST_DATA_ROW = 5, 6, 7  # 1-based
_PERIOD = re.compile(r"^(\d{4})M(\d{2})$")
_INDEX = re.compile(r"^\((\d{4})\s*=\s*100\)$")
_UNITS = {"($/bbl)": "USD_BBL", "($/mt)": "USD_MT", "($/mmbtu)": "USD_MMBTU"}


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    rows = sheet_rows(raw.body, SHEET)
    if len(rows) < FIRST_DATA_ROW:
        raise ParseError("PARSE-01: worksheet shorter than the header block")
    names, units = rows[NAME_ROW - 1], rows[UNIT_ROW - 1]
    if text(names[0] if names else None) != "Commodity" or text(units[0] if units else None) != (
        "Unit"
    ):
        raise ParseError("PARSE-01: header anchors 'Commodity' (A5) / 'Unit' (A6) not found")
    columns: dict[int, str] = {}
    for idx, cell in enumerate(names[1:], start=1):
        name = text(cell)
        if not name:
            continue
        if name in columns.values():
            raise ParseError(f"PARSE-01: duplicate commodity column {name!r}")
        columns[idx] = name
    if not columns:
        raise ParseError("PARSE-01: no commodity columns")
    wanted = {
        i: n for i, n in columns.items() if n in series_filter.series_refs or series_filter.discover
    }
    obs: dict[str, list[ParsedObservation]] = {n: [] for n in wanted.values()}
    rejected: list[RejectedRow] = []
    for row in rows[FIRST_DATA_ROW - 1 :]:
        label = text(row[0] if row else None)
        if not label:
            break
        m = _PERIOD.match(label)
        try:
            if m is None:
                raise PeriodError(f"unrecognised period label {label!r}")
            bounds = parse_period(f"{m[1]}-{m[2]}")
        except PeriodError as exc:
            for name in wanted.values():
                rejected.append(RejectedRow(name, label, None, f"PARSE-02: {exc}"))
            continue
        for idx, name in wanted.items():
            cell = row[idx] if idx < len(row) else None
            if name not in series_filter.series_refs or cell is None or text(cell) == "":
                continue
            value, flag = _number(cell)
            if value is None and text(cell) not in series_filter.missing_markers:
                rejected.append(RejectedRow(name, label, text(cell), "PARSE-03: non-numeric"))
                continue
            obs[name].append(
                ParsedObservation(
                    series_ref=name,
                    ref_period_start=bounds.start,
                    ref_period_end=bounds.end,
                    value=value,
                    value_status="OBS" if value is not None else "MISS",
                    source_release_at=None,
                    vintage_label=None,
                    source_flags=flag,
                )
            )
    metas = tuple(
        _meta(name, text(units[idx] if idx < len(units) else None), obs[name])
        for idx, name in sorted(wanted.items(), key=lambda kv: kv[1])
    )
    return ParseOutput(
        metas=metas,
        observations=tuple(o for n in sorted(obs) for o in obs[n]),
        rejected=tuple(rejected),
    )


def _number(cell: Any) -> tuple[Decimal | None, str | None]:
    if isinstance(cell, bool):
        return None, None
    if isinstance(cell, int | float | Decimal):
        number = Decimal(str(cell))
    else:
        try:
            number = Decimal(text(cell))
        except InvalidOperation:
            return None, text(cell)
    if not number.is_finite():
        return None, text(cell)
    return number, None


def _meta(name: str, unit_text: str, observations: list[ParsedObservation]) -> ParsedSeriesMeta:
    index = _INDEX.match(unit_text)
    exps = [
        -e
        for o in observations
        if o.value is not None
        for e in [o.value.as_tuple().exponent]
        if isinstance(e, int)
    ]
    return ParsedSeriesMeta(
        series_ref=name,
        entity_code="WLD",
        frequency="M",
        unit_code="IDX" if index else _UNITS.get(unit_text, unit_text),
        unit_mult=0,
        base_period=f"{index[1]}=100" if index else None,
        price_basis="IDX" if index else "NOM",
        currency_code="USD" if unit_text.startswith("($") else None,
        seasonal_adjustment="NA",
        calendar_basis="CAL",
        title=name,
        flow_basis="NA",
        published_decimals=max(0, max(exps)) if exps else None,
    )


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
