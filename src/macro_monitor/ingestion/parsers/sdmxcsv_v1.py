"""OECD SDMX-CSV parser, version 1 (FROZEN once released).

Pure function of the bytes and the series filter. The file is one whole dataflow (OECD data API,
``format=csvfile``); the series reference is the dimension values joined by ``.`` in file order, the
columns between the leading structure columns (``DATAFLOW``, ``STRUCTURE``, ``STRUCTURE_ID``,
``STRUCTURE_NAME``, ``ACTION``) and ``TIME_PERIOD``. A header written as ``CODE:Label`` is read as
``CODE``. A missing required column fails closed (PARSE-01).

Mappings to project vocabulary: ``UNIT_MEASURE`` to ``ref.unit`` codes (``UNIT_MAP``; an unknown
code is passed through and will need a ``ref.unit`` seed before first-sight creation),
``ADJUSTMENT`` to the seasonal-adjustment enum, ``OBS_STATUS`` to the value status.

[UNVERIFIED] Column names, dimension order, and the ``ADJUSTMENT``, ``UNIT_MEASURE`` and
``OBS_STATUS`` codes follow the OECD SDMX-CSV convention as recalled and the synthetic fixture;
no raw capture of the OECD file is stored yet (operator probe, at most one request).
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation
from typing import Literal

from macro_monitor.ingestion.base import (
    ParseError,
    ParseOutput,
    RawObject,
    RejectedRow,
    SeriesFilter,
)
from macro_monitor.models.enums import Frequency
from macro_monitor.models.periods import PeriodBounds, PeriodError, parse_period
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "1"
PARSER_ID = f"sdmxcsv_v1@{PARSER_VERSION}"
REQUIRED = ("REF_AREA", "FREQ", "TIME_PERIOD", "OBS_VALUE")
LEADING = frozenset({"DATAFLOW", "STRUCTURE", "STRUCTURE_ID", "STRUCTURE_NAME", "ACTION"})
# Known simplification pending the unit vocabulary: PA (percent per annum) and PC (percent) both map
# to PCT, so the per-annum qualifier is lost.
UNIT_MAP = {"IX": "IDX", "PA": "PCT", "PC": "PCT", "PT_B1GQ": "PCT_GDP", "PT_GDP": "PCT_GDP"}
ADJUSTMENT_MAP = {"Y": "SCA", "S": "SA", "W": "CA", "N": "NSA", "_Z": "NA", "": "NA"}
STATUS_MAP: dict[str, Literal["OBS", "EST", "PROV", "PROJ", "MISS"]] = {
    "A": "OBS",
    "E": "EST",
    "F": "PROJ",
    "P": "PROV",
    "M": "MISS",
}


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    try:
        text = raw.body.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ParseError(f"PARSE-01: not UTF-8: {exc}") from exc
    reader = csv.reader(io.StringIO(text))
    header = [h.split(":", 1)[0].strip() for h in next(reader, [])]
    missing = [c for c in REQUIRED if c not in header]
    if missing:
        raise ParseError(f"PARSE-01: missing columns {missing}")
    dims = [h for h in header[: header.index("TIME_PERIOD")] if h not in LEADING]
    if not dims or "REF_AREA" not in dims or "FREQ" not in dims:
        raise ParseError("PARSE-01: dimension columns must precede TIME_PERIOD")
    obs: dict[str, list[ParsedObservation]] = {}
    first_row: dict[str, dict[str, str]] = {}
    rejected: list[RejectedRow] = []
    need = max(header.index(c) for c in REQUIRED) + 1
    seen: set[tuple[str, str]] = set()
    for fields in reader:
        if not fields:
            continue
        if len(fields) < need:
            # By design one short row fails the whole dataflow (schema drift), no partial load.
            raise ParseError(f"PARSE-01: short row ({len(fields)} < {need} fields)")
        row = dict(zip(header, fields, strict=False))
        key = ".".join(row.get(d, "") for d in dims)
        if key not in series_filter.series_refs and not series_filter.discover:
            continue
        obs.setdefault(key, [])
        bad_attr = _attribute_problem(row)
        if key not in series_filter.series_refs:
            if bad_attr:  # discovery metas are built from this row: fail closed
                raise ParseError(f"PARSE-01: {bad_attr}")
            first_row.setdefault(key, row)
            continue
        period, value_text = row["TIME_PERIOD"], row["OBS_VALUE"].strip()
        status = (row.get("OBS_STATUS") or "").strip()
        if bad_attr:
            code = "PARSE-02" if bad_attr.startswith("unknown FREQ") else "PARSE-03"
            rejected.append(RejectedRow(key, period, value_text, f"{code}: {bad_attr}"))
            continue
        first_row.setdefault(key, row)
        try:
            bounds = parse_period(period)
        except PeriodError as exc:
            rejected.append(RejectedRow(key, period, value_text, f"PARSE-02: {exc}"))
            continue
        if bounds.frequency.value != row["FREQ"]:
            rejected.append(RejectedRow(key, period, value_text, "PARSE-02: period/FREQ mismatch"))
            continue
        # An unknown OBS_STATUS is kept as OBS with the raw flag in source_flags (same as the
        # ECB, BIS and FAOSTAT parsers); status M with a number is still rejected below.
        if (key, str(bounds.start)) in seen:
            raise ParseError(f"PARSE-04: duplicate (series, period) {key}|{period}")
        seen.add((key, str(bounds.start)))
        markers = series_filter.missing_markers
        number: Decimal | None
        try:
            number = Decimal(value_text) if value_text else None
        except InvalidOperation:
            number = None
        is_missing_status = STATUS_MAP.get(status) == "MISS"
        if number is not None and number.is_finite():
            if is_missing_status:
                rejected.append(
                    RejectedRow(key, period, value_text, "PARSE-03: status M with a value")
                )
                continue
            obs[key].append(
                _obs(key, bounds, number, STATUS_MAP.get(status, "OBS"), status or None)
            )
            continue
        # No usable number (empty, text, NaN, Infinity): a declared marker wins over the
        # non-finite and non-numeric checks.
        if status in markers or value_text in markers:
            obs[key].append(_obs(key, bounds, None, "MISS", status or value_text))
        elif number is not None:
            rejected.append(RejectedRow(key, period, value_text, "PARSE-03: non-finite"))
        elif value_text:
            rejected.append(RejectedRow(key, period, value_text, "PARSE-03: non-numeric"))
        else:
            rejected.append(RejectedRow(key, period, value_text, "PARSE-03: no value"))
    metas = tuple(_meta(key, first_row[key], obs[key]) for key in sorted(first_row))
    observations = tuple(o for k in sorted(obs) for o in obs[k])
    return ParseOutput(metas=metas, observations=observations, rejected=tuple(rejected))


def _attribute_problem(row: dict[str, str]) -> str | None:
    """Series-level attribute problems (fail closed instead of coercing to a default)."""
    if row["FREQ"] not in {f.value for f in Frequency}:
        return f"unknown FREQ {row['FREQ']!r}"
    adjustment = (row.get("ADJUSTMENT") or "").strip()
    if adjustment not in ADJUSTMENT_MAP:
        return f"unknown ADJUSTMENT {adjustment!r}"
    mult = (row.get("UNIT_MULT") or "").strip()
    if mult:
        try:
            int(mult)
        except ValueError:
            return f"non-integer UNIT_MULT {mult!r}"
    return None


def _meta(key: str, row: dict[str, str], observations: list[ParsedObservation]) -> ParsedSeriesMeta:
    exps = [o.value.as_tuple().exponent for o in observations if o.value is not None]
    scales = [-e for e in exps if isinstance(e, int)]
    unit = row.get("UNIT_MEASURE", "")
    adjustment = ADJUSTMENT_MAP[(row.get("ADJUSTMENT") or "").strip()]
    mult = (row.get("UNIT_MULT") or "").strip()
    base = (row.get("BASE_PER") or "").strip()
    decimals = (row.get("DECIMALS") or "").strip()
    return ParsedSeriesMeta(
        series_ref=key,
        entity_code=row["REF_AREA"],
        frequency=row["FREQ"],
        unit_code=UNIT_MAP.get(unit, unit),
        unit_mult=int(mult) if mult else 0,
        base_period=base or None,
        price_basis="NA",
        currency_code=None,
        seasonal_adjustment=adjustment,
        calendar_basis="CAL",
        title=row.get("TITLE", "") or key,
        flow_basis="NA",
        # Source DECIMALS attribute when it is a non-negative integer, else derived from the text.
        published_decimals=(
            int(decimals)
            if decimals.isascii() and decimals.isdecimal()
            else (max(0, max(scales)) if scales else None)
        ),
    )


def _obs(
    key: str,
    bounds: PeriodBounds,
    value: Decimal | None,
    status: Literal["OBS", "EST", "PROV", "PROJ", "MISS"],
    flags: str | None,
) -> ParsedObservation:
    return ParsedObservation(
        series_ref=key,
        ref_period_start=bounds.start,
        ref_period_end=bounds.end,
        value=value,
        value_status=status,
        source_release_at=None,
        vintage_label=None,
        source_flags=flags,
    )


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
