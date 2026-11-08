"""European Commission business and consumer survey ZIP parser, version 1 (FROZEN once released).

Input: the bytes of the survey ZIP as downloaded. Pure function of the bytes and the series filter.
Layout asserted (fail closed with PARSE-01 on any difference):

- exactly one member named ``main_indicators_nace2.xlsx`` (other members are ignored);
- for every worksheet that the series filter needs (``<SHEET>.<COUNTRY>`` refs): cell ``A1`` is
  ``DATE``; the other cells of row 1 are unique country codes (``DE``, ``EU``, ``EA``, ...);
- data rows from row 2: a month in column A (a date cell, ``YYYY-MM`` or ``YYYY-MM-DD``); the block
  ends at the first empty column A.

Series reference: ``<worksheet>.<country code>`` (``CONSUMER.DE``). Values are seasonally adjusted
balances (unit ``BALANCE``). Empty cells are skipped; text in ``missing_markers`` gives ``MISS``;
other text is a rejected row (PARSE-03).

[UNVERIFIED] Member name, worksheet names (``INDUSTRY`` = industry confidence indicator,
``CONSUMER`` = consumer confidence indicator), the ``DATE`` anchor, country codes and seasonal
adjustment follow the synthetic fixture only; no real survey ZIP was captured. If a real file
differs, add ``ecsurvey_v2`` instead of editing this module.
"""

from __future__ import annotations

import io
import re
import zipfile
import zlib
from collections.abc import Sequence
from datetime import date, datetime
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
from macro_monitor.models.enums import Frequency
from macro_monitor.models.periods import PeriodError, calendar_bounds
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "1"
PARSER_ID = f"ecsurvey_v1@{PARSER_VERSION}"
MEMBER = "main_indicators_nace2.xlsx"
MAX_MEMBER_BYTES = 64 * 1024**2  # the survey workbook is a few MiB
MAX_MEMBERS = 100
MAX_TOTAL_BYTES = 64 * 1024**2
# BadZipFile, encrypted member (RuntimeError), unsupported compression, corrupt/truncated stream
_ZIP_ERRORS = (zipfile.BadZipFile, RuntimeError, NotImplementedError, zlib.error, EOFError)
_MONTH = re.compile(r"^(\d{4})-(\d{2})(?:-\d{2})?$")


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    workbook = _workbook(raw.body)
    wanted: dict[str, set[str]] = {}
    for ref in series_filter.series_refs:
        sheet, _, country = ref.partition(".")
        if not country:
            raise ParseError(f"PARSE-01: series ref {ref!r} is not <sheet>.<country>")
        wanted.setdefault(sheet, set()).add(country)
    obs: dict[str, list[ParsedObservation]] = {}
    rejected: list[RejectedRow] = []
    for sheet in sorted(wanted):
        rows = sheet_rows(workbook, sheet)
        if not rows or text(rows[0][0] if rows[0] else None) != "DATE":
            raise ParseError(f"PARSE-01: {sheet}!A1 is not 'DATE'")
        codes = [text(c) for c in rows[0][1:]]
        if len(set(codes)) != len(codes) or "" in codes:
            raise ParseError(f"PARSE-01: {sheet}: header countries are not unique and non-empty")
        for code in codes:
            if code in wanted[sheet]:
                obs[f"{sheet}.{code}"] = []
        for row in rows[1:]:
            label = row[0] if row else None
            if label is None or text(label) == "":
                break
            try:
                start, end = _month(label)
            except PeriodError as exc:
                rejected.extend(
                    RejectedRow(f"{sheet}.{c}", text(label), None, f"PARSE-02: {exc}")
                    for c in codes
                    if c in wanted[sheet]
                )
                continue
            for idx, code in enumerate(codes, start=1):
                key = f"{sheet}.{code}"
                cell = row[idx] if idx < len(row) else None
                if key not in obs or cell is None or text(cell) == "":
                    continue
                value = _number(cell)
                if value is None and text(cell) not in series_filter.missing_markers:
                    rejected.append(
                        RejectedRow(key, start.isoformat()[:7], text(cell), "PARSE-03: non-numeric")
                    )
                    continue
                obs[key].append(
                    ParsedObservation(
                        series_ref=key,
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
            series_ref=key,
            entity_code=key.partition(".")[2],
            frequency="M",
            unit_code="BALANCE",
            unit_mult=0,
            base_period=None,
            price_basis="NA",
            currency_code=None,
            seasonal_adjustment="SA",
            calendar_basis="CAL",
            title=f"EC survey {key}",
            flow_basis="NA",
            published_decimals=_decimals(obs[key]),
        )
        for key in sorted(obs)
    )
    return ParseOutput(
        metas=metas,
        observations=tuple(o for k in sorted(obs) for o in obs[k]),
        rejected=tuple(rejected),
    )


def _workbook(body: bytes) -> bytes:
    """The bytes of the one survey workbook inside the ZIP."""
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_MEMBERS:
                raise ParseError("PARSE-01: too many zip members")
            if sum(i.file_size for i in infos) > MAX_TOTAL_BYTES:
                raise ParseError("PARSE-01: zip too large")
            members = [i for i in infos if i.filename.rsplit("/", 1)[-1].lower() == MEMBER]
            if len(members) != 1:
                raise ParseError(f"PARSE-01: expected exactly one {MEMBER}, found {len(members)}")
            if members[0].file_size > MAX_MEMBER_BYTES:
                raise ParseError("PARSE-01: workbook member too large")
            return zf.read(members[0])
    except _ZIP_ERRORS as exc:
        raise ParseError(f"PARSE-01: bad zip: {exc}") from exc


def _month(label: Any) -> tuple[date, date]:
    if isinstance(label, datetime | date):
        year, month = label.year, label.month
    else:
        m = _MONTH.match(text(label))
        if m is None:
            raise PeriodError(f"unrecognised month {text(label)!r}")
        year, month = int(m[1]), int(m[2])
    try:
        return calendar_bounds(Frequency.M, year, month)
    except ValueError as exc:
        raise PeriodError(f"invalid month {year}-{month}: {exc}") from exc


def _number(cell: Any) -> Decimal | None:
    if isinstance(cell, bool):
        return None
    try:
        number = Decimal(str(cell).strip())
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


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
