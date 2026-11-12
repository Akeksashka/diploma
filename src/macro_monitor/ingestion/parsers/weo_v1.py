"""IMF World Economic Outlook, data-portal CSV export, parser version 1 (FROZEN once released).

Input: the manual download from https://data.imf.org/datasets/WEO (dataset ``IMF.RES:WEO``), a
wide UTF-8 CSV with a BOM: metadata columns, then one column per year. Pure function of the bytes
and the series filter. Layout asserted (fail closed with PARSE-01 on any difference):

- the header contains the columns used below, and the year columns are 4-digit, ascending and
  contiguous (the last metadata column is followed by nothing but years);
- every row has the header's width; ``DATASET`` starts with ``IMF.RES:WEO``, ``OBS_MEASURE`` is
  ``OBS_VALUE``, ``FREQUENCY`` is ``Annual``; ``SERIES_CODE`` is ``<ISO3>.<INDICATOR>.A``; no
  duplicate ``SERIES_CODE``; one single ``PUBLICATION_DATE`` in the whole file;
- for a mapped series: ``SCALE`` and ``UNIT`` are known and ``LATEST_ACTUAL_ANNUAL_DATA`` is
  ``YYYY`` or ``FYYYYY/YY`` (the fiscal year is labelled by its start year, which is also its
  column).

Series reference: ``SERIES_CODE`` (``USA.NGAP_NPGDP.A``). Values: a number, a blank cell (no value
published, no row) or a token in ``missing_markers`` (``MISS``); other text is a rejected row
(PARSE-03).

Status: a year up to and including the series' last actual year is ``OBS``; every later year is
``PROJ`` (ADR-032, ADR-011: the IMF file does not separate estimates from projections, and PROJ
rows stay out of ranks, alerts and exports other than the projection layer; this is the
conservative reading, never ``EST``). Vintage: ``vintage_label`` is ``WEO-<YYYY>-<MM>`` from the
file's ``PUBLICATION_DATE`` (equal to the sidecar ``edition_label``); ``source_release_at`` is
that timestamp.

Units: ``Percent`` becomes ``PCT_POT_GDP`` / ``PCT_GDP`` / ``PCT`` from the indicator text.
Scale ``Units`` 0, ``Millions`` 6, ``Billions`` 9 (``unit_mult``). Currency-denominated and index
series need their own unit mapping: they are refused (PARSE-01) until a parser version adds it.
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation

from macro_monitor.ingestion.base import (
    ParseError,
    ParseOutput,
    RawObject,
    RejectedRow,
    SeriesFilter,
)
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "1"
PARSER_ID = f"weo_v1@{PARSER_VERSION}"
DATASET_PREFIX = "IMF.RES:WEO"
REQUIRED = (
    "DATASET",
    "SERIES_CODE",
    "OBS_MEASURE",
    "COUNTRY",
    "INDICATOR",
    "FREQUENCY",
    "SCALE",
    "UNIT",
    "PUBLICATION_DATE",
    "LATEST_ACTUAL_ANNUAL_DATA",
)
_SCALES = {"Units": 0, "Millions": 6, "Billions": 9}
_CODE = re.compile(r"^[A-Z0-9]{2,5}\.[A-Z0-9_]+\.A$")
_ACTUAL = re.compile(r"^(?:(\d{4})|FY(\d{4})/\d{2})$")
_NUMBER = re.compile(r"^-?\d+(?:\.\d+)?$")


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    try:
        text = raw.body.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ParseError(f"PARSE-01: not UTF-8: {exc}") from exc
    rows = list(csv.reader(io.StringIO(text, newline="")))
    if not rows:
        raise ParseError("PARSE-01: empty file")
    header = rows[0]
    missing = [c for c in REQUIRED if c not in header or header.count(c) != 1]
    if missing:
        raise ParseError(f"PARSE-01: header columns missing or repeated: {missing}")
    col = {name: header.index(name) for name in REQUIRED}
    first_year = next((i for i, c in enumerate(header) if c.isdigit()), None)
    if first_year is None:
        raise ParseError("PARSE-01: no year columns")
    years = header[first_year:]
    if not all(re.fullmatch(r"\d{4}", y) for y in years):
        raise ParseError("PARSE-01: non-year column after the first year column")
    nums = [int(y) for y in years]
    if nums != list(range(nums[0], nums[0] + len(nums))):
        raise ParseError("PARSE-01: year columns are not contiguous and ascending")
    if first_year <= max(col.values()):
        raise ParseError("PARSE-01: year columns precede a required metadata column")

    published: set[str] = set()
    seen: set[str] = set()
    obs: dict[str, list[ParsedObservation]] = {}
    metas: list[ParsedSeriesMeta] = []
    rejected: list[RejectedRow] = []
    body = rows[1:]
    if not body:
        raise ParseError("PARSE-01: no data rows")
    for line_no, row in enumerate(body, start=2):
        if len(row) != len(header):
            raise ParseError(
                f"PARSE-01: line {line_no}: {len(row)} cells, header has {len(header)}"
            )
        code = row[col["SERIES_CODE"]]
        if not _CODE.match(code):
            raise ParseError(f"PARSE-01: line {line_no}: bad SERIES_CODE {code!r}")
        if code in seen:
            raise ParseError(f"PARSE-01: duplicate SERIES_CODE {code}")
        seen.add(code)
        if not row[col["DATASET"]].startswith(DATASET_PREFIX):
            raise ParseError(f"PARSE-01: {code}: DATASET {row[col['DATASET']]!r}")
        if row[col["OBS_MEASURE"]] != "OBS_VALUE" or row[col["FREQUENCY"]] != "Annual":
            raise ParseError(f"PARSE-01: {code}: OBS_MEASURE / FREQUENCY not OBS_VALUE / Annual")
        published.add(row[col["PUBLICATION_DATE"]])
        if code not in series_filter.series_refs:
            continue
        released = _released(row[col["PUBLICATION_DATE"]], code)
        label = f"WEO-{released:%Y-%m}"
        last_actual = _last_actual(row[col["LATEST_ACTUAL_ANNUAL_DATA"]], code)
        mult = _SCALES.get(row[col["SCALE"]])
        if mult is None:
            raise ParseError(f"PARSE-01: {code}: unknown SCALE {row[col['SCALE']]!r}")
        unit = _unit(row[col["UNIT"]], row[col["INDICATOR"]], code)
        rows_out: list[ParsedObservation] = []
        for year, cell in zip(nums, row[first_year:], strict=True):
            value = cell.strip()
            if value == "":
                continue
            number: Decimal | None = None
            if _NUMBER.match(value):
                try:
                    number = Decimal(value)
                except InvalidOperation:  # pragma: no cover - the pattern excludes it
                    number = None
            if number is None and value not in series_filter.missing_markers:
                rejected.append(RejectedRow(code, str(year), value, "PARSE-03: non-numeric"))
                continue
            rows_out.append(
                ParsedObservation(
                    series_ref=code,
                    ref_period_start=date(year, 1, 1),
                    ref_period_end=date(year, 12, 31),
                    value=number,
                    value_status="MISS"
                    if number is None
                    else ("OBS" if year <= last_actual else "PROJ"),
                    source_release_at=released,
                    vintage_label=label,
                    source_flags=value if number is None else None,
                )
            )
        obs[code] = rows_out
        exps = [
            -e
            for o in rows_out
            if o.value is not None
            for e in [o.value.as_tuple().exponent]
            if isinstance(e, int)
        ]
        metas.append(
            ParsedSeriesMeta(
                series_ref=code,
                entity_code=code.partition(".")[0],
                frequency="A",
                unit_code=unit,
                unit_mult=mult,
                base_period=None,
                price_basis="NA",
                currency_code=None,
                seasonal_adjustment="NA",
                calendar_basis="CAL",
                title=f"{row[col['COUNTRY']]}: {row[col['INDICATOR']]}",
                flow_basis="NA",
                published_decimals=max(0, max(exps)) if exps else None,
            )
        )
    if len(published) != 1:
        raise ParseError(f"PARSE-01: expected one PUBLICATION_DATE, found {sorted(published)}")
    metas.sort(key=lambda m: m.series_ref)
    return ParseOutput(
        metas=tuple(metas),
        observations=tuple(o for k in sorted(obs) for o in obs[k]),
        rejected=tuple(rejected),
    )


def _released(cell: str, code: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(cell)
    except ValueError as exc:
        raise ParseError(f"PARSE-01: {code}: bad PUBLICATION_DATE {cell!r}") from exc
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _last_actual(cell: str, code: str) -> int:
    m = _ACTUAL.match(cell.strip())
    if m is None:
        raise ParseError(f"PARSE-01: {code}: unreadable LATEST_ACTUAL_ANNUAL_DATA {cell!r}")
    return int(m.group(1) or m.group(2))


def _unit(unit: str, indicator: str, code: str) -> str:
    if unit != "Percent":
        raise ParseError(f"PARSE-01: {code}: UNIT {unit!r} has no mapping in weo_v1")
    if "Percent of potential GDP" in indicator:
        return "PCT_POT_GDP"
    if "Percent of GDP" in indicator:
        return "PCT_GDP"
    return "PCT"


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
