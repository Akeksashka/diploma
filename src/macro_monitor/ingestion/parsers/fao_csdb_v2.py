"""FAO Cereal Supply and Demand Brief (CSDB) XLSX parser, version 2 (FROZEN once released).

Real layout (captured 2026-11): worksheet ``CSDB data``; stacked blocks. A block is a title row
(``WORLD CEREAL MARKET``; only column A filled), a header row (column A empty, one item name per
column, e.g. ``World stock-to-use ratio``), a units row (``million tonnes`` / ``percent`` spread
over the columns, text in the first column of each span), then one row per marketing year
(``2017/18`` in column A). The block ends at the first row whose column A is not a season label.

Series reference: ``<block title> | <item header>``; the one series named in the v1 series map
keeps its v1 name (``WORLD CEREAL MARKET | World stock-to-use ratio`` ->
``World cereals stocks-to-use ratio (%)``). A season runs 1 July to 30 June. Status is not stated
in the file; by FAO convention the last season of a block is a forecast (PROJ), the one before it
an estimate (EST), earlier ones actual (OBS) [UNVERIFIED]. Because this is inferred, every
observation with a value carries ``source_flags="status-inferred"``. Unit text ``percent`` maps to
``PCT``; ``million tonnes`` to ``MT`` with ``unit_mult`` 6; any other unit text is ``PARSE-01``.
No release date is in the sheet:
``source_updated`` is ``None``. As in v1 no vintage label is set; the vintage is the fetch.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import date
from typing import Literal

from macro_monitor.ingestion.base import (
    ParseError,
    ParseOutput,
    RawObject,
    RejectedRow,
    SeriesFilter,
)
from macro_monitor.ingestion.parsers.fao_csdb_v1 import _cell, _decimals, _number
from macro_monitor.ingestion.parsers.xlsx_rows import sheet_rows, text
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "2"
PARSER_ID = f"fao_csdb_v{PARSER_VERSION}@{PARSER_VERSION}"
SHEET = "CSDB data"
_SEASON = re.compile(r"^(\d{4})/(\d{2})$")
_RENAMED = {
    "WORLD CEREAL MARKET | World stock-to-use ratio": "World cereals stocks-to-use ratio (%)"
}
_Status = Literal["OBS", "EST", "PROJ"]


INFERRED_FLAG = "status-inferred"


def _unit(text_: str) -> tuple[str, int]:
    low = " ".join(re.sub(r"[^a-z]+", " ", text_.lower()).split())  # drops '( . . )' padding
    if low == "percent":
        return "PCT", 0
    if low == "million tonnes":
        return "MT", 6
    raise ParseError(f"PARSE-01: unknown unit text {text_!r}")


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    rows = sheet_rows(raw.body, SHEET)
    obs: dict[str, list[ParsedObservation]] = {}
    units: dict[str, tuple[str, int]] = {}
    rejected: list[RejectedRow] = []
    i = 0
    while i < len(rows) - 2:
        title = text(_cell(rows[i], 0))
        header = rows[i + 1]
        if (
            not title
            or _SEASON.match(title)
            or text(_cell(header, 0))
            or not text(_cell(header, 1))
        ):
            i += 1
            continue
        unit_row, unit_by_col, current = rows[i + 2], {}, ""  # unit text per column; checked on use
        for idx in range(1, len(header)):
            current = text(_cell(unit_row, idx)) or current
            unit_by_col[idx] = current
        j = i + 3  # season rows follow the units row directly; never scan into the next block
        k = j
        while k < len(rows) and _SEASON.match(text(_cell(rows[k], 0))):
            k += 1
        for r in range(j, k):
            m = _SEASON.match(text(_cell(rows[r], 0)))
            if m is None or int(m[2]) != (int(m[1]) + 1) % 100:
                raise ParseError(f"PARSE-01: unexpected season label {text(_cell(rows[r], 0))!r}")
            status: _Status = "PROJ" if r == k - 1 else "EST" if r == k - 2 else "OBS"
            start, end = date(int(m[1]), 7, 1), date(int(m[1]) + 1, 6, 30)
            period = f"{start.year}/{end.year % 100:02d}"
            for idx in range(1, len(header)):
                item = text(_cell(header, idx))
                cell = _cell(rows[r], idx)
                if not item or cell is None or text(cell) == "":
                    continue
                ref = f"{title} | {item}"
                ref = _RENAMED.get(ref, ref)
                if ref not in series_filter.series_refs:
                    continue
                units[ref] = _unit(unit_by_col[idx])
                obs.setdefault(ref, [])
                value = _number(cell)
                if value is None and text(cell) not in series_filter.missing_markers:
                    rejected.append(RejectedRow(ref, period, text(cell), "PARSE-03: non-numeric"))
                    continue
                obs[ref].append(
                    ParsedObservation(
                        series_ref=ref,
                        ref_period_start=start,
                        ref_period_end=end,
                        value=value,
                        value_status=status if value is not None else "MISS",
                        source_release_at=None,
                        vintage_label=None,
                        source_flags=INFERRED_FLAG if value is not None else text(cell),
                    )
                )
        i = max(k, i + 1)
    if not obs and not rejected:
        raise ParseError("PARSE-01: no CSDB block with the configured series found")
    metas = tuple(
        ParsedSeriesMeta(
            series_ref=n,
            entity_code="WLD",
            frequency="A",
            unit_code=units[n][0],
            unit_mult=units[n][1],
            base_period=None,
            price_basis="NA",
            currency_code=None,
            seasonal_adjustment="NA",
            calendar_basis="MKTYR",
            title=n,
            flow_basis="NA",
            published_decimals=_decimals(obs[n]),
        )
        for n in sorted(obs)
    )
    return ParseOutput(
        metas=metas,
        observations=tuple(o for n in sorted(obs) for o in obs[n]),
        rejected=tuple(rejected),
        source_updated=None,
    )


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
