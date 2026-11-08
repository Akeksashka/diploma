"""FAO Cereal Supply and Demand Brief (CSDB) monthly XLSX parser, version 1 (FROZEN once released).

Input: the bytes of one monthly ``csdb-data-<YYYY>-<MM>.xlsx``. Pure function of the bytes and the
series filter. Layout asserted (fail closed with PARSE-01 on any difference):

- worksheet ``CSDB``;
- ``A1 == "Release"`` and ``B1`` the release month ``YYYY-MM`` (returned as ``source_updated``);
- row 3: ``A3 == "Item"``, then one marketing-year label ``YYYY/YY`` per column (the two-digit
  tail must be the next year);
- row 4: ``A4 == "Status"``, then ``actual``, ``estimate`` or ``forecast`` per column;
- data rows from row 5: series name in column A, one value per season; ends at the first empty A.

Series reference: the text of column A, e.g. ``World cereals stocks-to-use ratio (%)``. A season
runs 1 July to 30 June (``calendar_basis = MKTYR``, annual). Status: actual -> OBS, estimate ->
EST, forecast -> PROJ.

VINTAGES: FAO keeps no archive of earlier briefs and revises earlier seasons in each one, so the
raw copy we store is the only vintage. The parser therefore sets no ``vintage_label`` and no
``source_release_at``; the vintage is the fetch (``known_at``) of the stored object.

[UNVERIFIED] Sheet name, anchors, season labels, status words and the 1 July year start follow the
synthetic fixture only; no real brief was captured. If a real file differs, add ``fao_csdb_v2``
instead of editing this module.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from macro_monitor.ingestion.base import (
    ParseError,
    ParseOutput,
    RawObject,
    RejectedRow,
    SeriesFilter,
)
from macro_monitor.ingestion.parsers.xlsx_rows import sheet_rows, text
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "1"
PARSER_ID = f"fao_csdb_v1@{PARSER_VERSION}"
SHEET = "CSDB"
FIRST_DATA_ROW = 5  # 1-based
_SEASON = re.compile(r"^(\d{4})/(\d{2})$")
_RELEASE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_UNIT = re.compile(r"\(([^()]*)\)\s*$")
_STATUS: dict[str, Literal["OBS", "EST", "PROJ"]] = {
    "actual": "OBS",
    "estimate": "EST",
    "forecast": "PROJ",
}


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    rows = sheet_rows(raw.body, SHEET)
    if len(rows) < FIRST_DATA_ROW:
        raise ParseError("PARSE-01: worksheet shorter than the header block")
    release = text(_cell(rows[0], 1))
    if text(_cell(rows[0], 0)) != "Release" or not _RELEASE.match(release):
        raise ParseError("PARSE-01: 'Release' / YYYY-MM anchor (A1:B1) not found")
    if text(_cell(rows[2], 0)) != "Item" or text(_cell(rows[3], 0)) != "Status":
        raise ParseError("PARSE-01: header anchors 'Item' (A3) / 'Status' (A4) not found")
    seasons: dict[int, tuple[date, date, Literal["OBS", "EST", "PROJ"]]] = {}
    for idx, cell in enumerate(rows[2][1:], start=1):
        label = text(cell)
        if not label:
            continue
        m = _SEASON.match(label)
        if m is None or int(m[2]) != (int(m[1]) + 1) % 100:
            raise ParseError(f"PARSE-01: unexpected season label {label!r}")
        status = _STATUS.get(text(_cell(rows[3], idx)).lower())
        if status is None:
            raise ParseError(
                f"PARSE-01: unexpected status for {label}: {text(_cell(rows[3], idx))!r}"
            )
        seasons[idx] = (date(int(m[1]), 7, 1), date(int(m[1]) + 1, 6, 30), status)
    if not seasons:
        raise ParseError("PARSE-01: no season columns")
    obs: dict[str, list[ParsedObservation]] = {}
    rejected: list[RejectedRow] = []
    for row in rows[FIRST_DATA_ROW - 1 :]:
        name = text(_cell(row, 0))
        if not name:
            break
        if name not in series_filter.series_refs:
            continue
        obs.setdefault(name, [])
        for idx, (start, end, status) in seasons.items():
            cell = _cell(row, idx)
            if cell is None or text(cell) == "":
                continue
            period = f"{start.year}/{end.year % 100:02d}"
            value = _number(cell)
            if value is None and text(cell) not in series_filter.missing_markers:
                rejected.append(RejectedRow(name, period, text(cell), "PARSE-03: non-numeric"))
                continue
            obs[name].append(
                ParsedObservation(
                    series_ref=name,
                    ref_period_start=start,
                    ref_period_end=end,
                    value=value,
                    value_status=status if value is not None else "MISS",
                    source_release_at=None,
                    vintage_label=None,
                    source_flags=None if value is not None else text(cell),
                )
            )
    metas = tuple(
        ParsedSeriesMeta(
            series_ref=n,
            entity_code="WLD",
            frequency="A",
            unit_code=_unit(n),
            unit_mult=0,
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
        source_updated=release,
    )


def _cell(row: tuple[Any, ...], idx: int) -> Any:
    return row[idx] if idx < len(row) else None


def _number(cell: Any) -> Decimal | None:
    if isinstance(cell, bool):
        return None
    try:
        number = Decimal(str(cell).strip())
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def _unit(name: str) -> str:
    m = _UNIT.search(name)
    token = m[1].strip() if m else ""
    return "PCT" if token == "%" else token


def _decimals(observations: list[ParsedObservation]) -> int | None:
    exps = [
        -e
        for o in observations
        if o.value is not None
        for e in [o.value.as_tuple().exponent]
        if isinstance(e, int)
    ]
    return max(0, max(exps)) if exps else None


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
