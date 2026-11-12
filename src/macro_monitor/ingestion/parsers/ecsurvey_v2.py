"""European Commission business and consumer survey ZIP parser, version 2 (FROZEN once released).

Real layout (captured 2026-11-10, ``main_indicators_sa_nace2.zip``): one member
``main_indicators_nace2.xlsx`` with worksheets ``MONTHLY``, ``Index`` and ``INFO``. Asserted on
``MONTHLY`` (fail closed with PARSE-01 on any difference):

- cell ``A1`` is empty; every other non-empty cell of row 1 is a header ``<COUNTRY>.<SURVEY>``
  (``DE.INDU``, ``EA.CONS``, ``EU.ESI``); headers are unique; empty header cells are blank
  separator columns between country blocks and are ignored;
- data rows from row 2: a month-end date in column A; the block ends at the first empty column A;
  a month occurs once;
- every requested series ref is present among the headers and has a known survey code.

Series reference: the header as is (``DE.INDU``). Survey codes ``INDU``, ``CONS``, ``BUIL``,
``RETA``, ``SERV`` are seasonally adjusted balances (unit ``BALANCE``); ``ESI`` and ``EEI`` are
indices (unit ``IDX``, long-run average 100; no base period is stated in the sheet, so none is
set). The file is the seasonally adjusted download. Text in ``missing_markers`` (``NA``) gives
``MISS``; other text is a rejected row (PARSE-03). Values are as published; the file carries no
release date, so the vintage is the fetch.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from macro_monitor.ingestion.base import (
    ParseError,
    ParseOutput,
    RawObject,
    RejectedRow,
    SeriesFilter,
)
from macro_monitor.ingestion.parsers.ecsurvey_v1 import _decimals, _month, _number, _workbook
from macro_monitor.ingestion.parsers.xlsx_rows import sheet_rows, text
from macro_monitor.models.periods import PeriodError
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "2"
PARSER_ID = f"ecsurvey_v{PARSER_VERSION}@{PARSER_VERSION}"
SHEET = "MONTHLY"
_HEADER = re.compile(r"^([A-Z]{2})\.([A-Z]{3,4})$")
_BALANCES = frozenset({"INDU", "CONS", "BUIL", "RETA", "SERV"})
_INDICES = frozenset({"ESI", "EEI"})


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    rows = sheet_rows(_workbook(raw.body), SHEET)
    if not rows:
        raise ParseError(f"PARSE-01: {SHEET} is empty")
    head = rows[0]
    if text(head[0] if head else None) != "":
        raise ParseError(f"PARSE-01: {SHEET}!A1 is not empty")
    columns: dict[str, int] = {}
    for idx, cell in enumerate(head[1:], start=1):
        name = text(cell)
        if name == "":
            continue  # blank separator column
        if _HEADER.match(name) is None:
            raise ParseError(f"PARSE-01: {SHEET}: header {name!r} is not <COUNTRY>.<SURVEY>")
        if name in columns:
            raise ParseError(f"PARSE-01: {SHEET}: header {name!r} is not unique")
        columns[name] = idx
    wanted = sorted(set(series_filter.series_refs))
    for ref in wanted:
        m = _HEADER.match(ref)
        if m is None or ref not in columns:
            raise ParseError(f"PARSE-01: {SHEET}: requested series {ref!r} not in the header")
        if m[2] not in _BALANCES | _INDICES:
            raise ParseError(f"PARSE-01: {SHEET}: unknown survey code in {ref!r}")
    obs: dict[str, list[ParsedObservation]] = {ref: [] for ref in wanted}
    rejected: list[RejectedRow] = []
    seen: set[tuple[int, int]] = set()
    for row in rows[1:]:
        label = row[0] if row else None
        if label is None or text(label) == "":
            break
        try:
            start, end = _month(label)
        except PeriodError as exc:
            rejected.extend(
                RejectedRow(ref, text(label), None, f"PARSE-02: {exc}") for ref in wanted
            )
            continue
        if (start.year, start.month) in seen:
            raise ParseError(f"PARSE-01: {SHEET}: month {start.isoformat()[:7]} occurs twice")
        seen.add((start.year, start.month))
        for ref in wanted:
            cell = row[columns[ref]] if columns[ref] < len(row) else None
            if cell is None or text(cell) == "":
                continue
            value = _number(cell)
            if value is None and text(cell) not in series_filter.missing_markers:
                rejected.append(
                    RejectedRow(ref, start.isoformat()[:7], text(cell), "PARSE-03: non-numeric")
                )
                continue
            obs[ref].append(
                ParsedObservation(
                    series_ref=ref,
                    ref_period_start=start,
                    ref_period_end=end,
                    value=value,
                    value_status="OBS" if value is not None else "MISS",
                    source_release_at=None,
                    vintage_label=None,
                    source_flags=None if value is not None else text(cell),
                )
            )
    metas = tuple(
        ParsedSeriesMeta(
            series_ref=ref,
            entity_code=ref.partition(".")[0],
            frequency="M",
            unit_code="IDX" if ref.partition(".")[2] in _INDICES else "BALANCE",
            unit_mult=0,
            base_period=None,
            price_basis="NA",
            currency_code=None,
            seasonal_adjustment="SA",
            calendar_basis="CAL",
            title=f"EC survey {ref}",
            flow_basis="NA",
            published_decimals=_decimals(obs[ref]),
        )
        for ref in wanted
    )
    return ParseOutput(
        metas=metas,
        observations=tuple(o for ref in wanted for o in obs[ref]),
        rejected=tuple(rejected),
    )


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
