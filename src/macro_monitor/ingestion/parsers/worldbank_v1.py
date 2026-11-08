"""World Bank Indicators API v2 parser, version 1 (FROZEN once released: add worldbank_v2).

Input: one page of ``?format=json`` output, ``[meta, rows]``. ``meta`` carries ``page``,
``pages``, ``per_page``, ``total`` and ``lastupdated``; each row carries ``indicator.id``,
``countryiso3code``, ``date`` (a year), ``value`` (number or null), optionally ``unit``,
``obs_status`` and ``decimal``. Numbers are parsed into ``Decimal``.

Series reference: ``<indicator id>.<ISO3>`` (indicator ids contain dots; the entity is the last
part). A cell with value null or the declared marker ``..`` is a missing cell: emitted as MISS
only when ``..`` is in ``series_filter.missing_markers``, otherwise skipped.

[UNVERIFIED] The response shape is the documented one and has not been captured live (fixture is
synthetic).
"""

from __future__ import annotations

import json
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
from macro_monitor.models.periods import PeriodError, parse_period
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "1"
PARSER_ID = f"worldbank_v{PARSER_VERSION}@{PARSER_VERSION}"
MISSING = ".."


def _fail(msg: str) -> ParseError:
    return ParseError(f"PARSE-01: {msg}")


def page_info(body: bytes) -> dict[str, Any]:
    """The page-metadata object (first element), validated for the keys pagination needs."""
    try:
        doc = json.loads(body, parse_float=Decimal, parse_int=Decimal)
    except (ValueError, UnicodeDecodeError) as exc:
        raise _fail(f"not valid JSON: {exc}") from exc
    if not isinstance(doc, list) or not doc or not isinstance(doc[0], dict):
        raise _fail("expected a [meta, rows] array")
    meta: dict[str, Any] = doc[0]
    if "message" in meta:  # the API reports errors as a 200 with a message array
        raise _fail(f"API error payload: {str(meta['message'])[:200]}")
    for key in ("page", "pages"):
        if key not in meta:
            raise _fail(f"meta missing {key!r}")
    return meta


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    meta = page_info(raw.body)
    doc = json.loads(raw.body, parse_float=Decimal, parse_int=Decimal)
    rows = doc[1] if len(doc) > 1 else []
    if rows is None:
        rows = []
    if not isinstance(rows, list):
        raise _fail("rows element is not an array")
    metas: dict[str, ParsedSeriesMeta] = {}
    obs: list[ParsedObservation] = []
    rejected: list[RejectedRow] = []
    scales: dict[str, int] = {}
    for row in rows:
        try:
            ind = str(row["indicator"]["id"])
            iso = str(row["countryiso3code"])
            date = str(row["date"])
        except (KeyError, TypeError) as exc:
            raise _fail(f"row without indicator/country/date: {exc}") from exc
        ref = f"{ind}.{iso}"
        if ref not in series_filter.series_refs:
            continue
        if ref not in metas:
            metas[ref] = ParsedSeriesMeta(
                series_ref=ref,
                entity_code=iso,
                frequency="A",
                unit_code=str(row.get("unit") or ""),
                unit_mult=0,
                base_period=None,
                price_basis="NA",
                currency_code=None,
                seasonal_adjustment="NA",
                calendar_basis="CAL",
                title=_title(row, ind, iso),
                flow_basis="NA",
                published_decimals=None,
            )
        try:
            bounds = parse_period(date)
        except PeriodError as exc:
            rejected.append(RejectedRow(ref, date, None, f"PARSE-02: {exc}"))
            continue
        cell = row.get("value")
        flags = str(row["obs_status"]) if row.get("obs_status") else None
        if cell is None or (isinstance(cell, str) and cell.strip() == MISSING):
            if MISSING in series_filter.missing_markers:
                obs.append(
                    ParsedObservation(
                        series_ref=ref,
                        ref_period_start=bounds.start,
                        ref_period_end=bounds.end,
                        value=None,
                        value_status="MISS",
                        source_release_at=None,
                        vintage_label=None,
                        source_flags=MISSING,
                    )
                )
            continue
        try:
            value = Decimal(str(cell).strip()) if not isinstance(cell, Decimal) else cell
        except InvalidOperation:
            rejected.append(RejectedRow(ref, date, str(cell), "PARSE-03: non-numeric value"))
            continue
        if not value.is_finite():
            rejected.append(RejectedRow(ref, date, str(cell), "PARSE-03: non-numeric value"))
            continue
        exp = value.as_tuple().exponent
        scales[ref] = max(scales.get(ref, 0), -exp if isinstance(exp, int) and exp < 0 else 0)
        obs.append(
            ParsedObservation(
                series_ref=ref,
                ref_period_start=bounds.start,
                ref_period_end=bounds.end,
                value=value,
                value_status="OBS",
                source_release_at=None,
                vintage_label=None,
                source_flags=flags,
            )
        )
    metas_out = tuple(
        m if m.series_ref not in scales else _with_decimals(m, scales[m.series_ref])
        for m in sorted(metas.values(), key=lambda m: m.series_ref)
    )
    updated = meta.get("lastupdated")
    return ParseOutput(
        metas=metas_out,
        observations=tuple(obs),
        rejected=tuple(rejected),
        source_updated=str(updated) if updated is not None else None,
    )


def _title(row: dict[str, Any], ind: str, iso: str) -> str:
    name = row["indicator"].get("value", ind)
    country = (row.get("country") or {}).get("value", iso)
    return f"{name} | {country}"


def _with_decimals(m: ParsedSeriesMeta, n: int) -> ParsedSeriesMeta:
    from dataclasses import replace

    return replace(m, published_decimals=n)


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "page_info", "parse"]
