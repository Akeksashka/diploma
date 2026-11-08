"""FAOSTAT bulk "All Data (Normalized)" zip parser, version 1 (FROZEN once released).

Input: the bytes of one FAOSTAT domain zip as served (e.g. Food Security Data). Pure function of the
bytes and the series filter. Layout asserted (fail closed with PARSE-01 on any difference):

- exactly one member whose name ends with ``All_Data_(Normalized).csv`` (the zip also carries
  flag and code lists, which are ignored), UTF-8 with optional BOM;
- columns ``Area Code (M49)``, ``Area``, ``Item Code``, ``Item``, ``Element Code``, ``Element``,
  ``Year``, ``Unit``, ``Value``, ``Flag``.

Series reference: ``<M49 area code>.<Item Code>.<Element Code>`` (a leading apostrophe of the M49
code is dropped). ``Year`` is ``YYYY`` or a three-year average ``YYYY-YYYY+2``; a three-year average
is stored at its CENTRE year (the FAOSTAT year code convention) as an annual calendar period, with
the source label kept in ``source_flags`` (``3yr:2021-2023``). Flag ``E`` -> EST, ``F`` -> PROJ,
anything else OBS with the flag kept. Non-numeric values (for example ``<2.5``) are rejected rows
unless listed in ``missing_markers``.

[UNVERIFIED] Member name, column names (including the apostrophe on M49 codes), the flag letters and
the centre-year convention follow the synthetic fixture and recollection of the public file only;
no real file was captured. If a real file differs, add ``fao_stat_v2`` instead of editing this
module.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
import zlib
from collections.abc import Sequence
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from macro_monitor.ingestion.base import (
    ParseError,
    ParseOutput,
    RawObject,
    RejectedRow,
    SeriesFilter,
)
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "1"
PARSER_ID = f"fao_stat_v1@{PARSER_VERSION}"
MEMBER_SUFFIX = "all_data_(normalized).csv"
# Largest plausible uncompressed domain CSV (real domains are tens to low hundreds of MiB); a
# bigger member is treated as a zip bomb or a layout change and fails closed.
MAX_MEMBER_BYTES = 256 * 1024**2
MAX_TOTAL_BYTES = 64 * 1024**2 * 4  # whole archive incl. flag/code lists; >= one member
MAX_MEMBERS = 100
# BadZipFile, encrypted member (RuntimeError), unsupported compression, corrupt/truncated stream
_ZIP_ERRORS = (zipfile.BadZipFile, RuntimeError, NotImplementedError, zlib.error, EOFError)
REQUIRED = (
    "Area Code (M49)",
    "Area",
    "Item Code",
    "Item",
    "Element Code",
    "Element",
    "Year",
    "Unit",
    "Value",
    "Flag",
)
_YEAR = re.compile(r"^(\d{4})(?:-(\d{4}))?$")
# E = estimated; F = FAO estimate in FAOSTAT flag scheme [UNVERIFIED]; mapped to PROJ; verify at
# the first probe.
_STATUS: dict[str, Literal["OBS", "EST", "PROJ"]] = {"E": "EST", "F": "PROJ"}


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    try:
        with zipfile.ZipFile(io.BytesIO(raw.body)) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_MEMBERS:
                raise ParseError("PARSE-01: too many zip members")
            if sum(i.file_size for i in infos) > MAX_TOTAL_BYTES:
                raise ParseError("PARSE-01: zip too large")
            members = [i for i in infos if i.filename.lower().endswith(MEMBER_SUFFIX)]
            if len(members) != 1:
                raise ParseError(
                    f"PARSE-01: expected exactly one *{MEMBER_SUFFIX}, found {len(members)}"
                )
            if members[0].file_size > MAX_MEMBER_BYTES:
                raise ParseError("PARSE-01: csv member too large")
            with io.TextIOWrapper(zf.open(members[0]), encoding="utf-8-sig", newline="") as text:
                reader = csv.DictReader(text)
                missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
                if missing:
                    raise ParseError(f"PARSE-01: missing columns {missing}")
                return _rows(reader, series_filter)
    except _ZIP_ERRORS as exc:
        raise ParseError(f"PARSE-01: bad zip: {exc}") from exc
    except UnicodeDecodeError as exc:
        raise ParseError(f"PARSE-01: not UTF-8: {exc}") from exc
    except csv.Error as exc:
        raise ParseError(f"PARSE-01: unreadable csv: {exc}") from exc


def _area(row: dict[str, str]) -> str:
    """M49 area code without the leading apostrophe some files carry."""
    return row["Area Code (M49)"].strip().lstrip("'")


def _rows(reader: csv.DictReader[str], series_filter: SeriesFilter) -> ParseOutput:
    obs: dict[str, list[ParsedObservation]] = {}
    first: dict[str, dict[str, str]] = {}
    rejected: list[RejectedRow] = []
    for row in reader:
        key = f"{_area(row)}.{row['Item Code'].strip()}.{row['Element Code'].strip()}"
        if key not in series_filter.series_refs:
            continue
        first.setdefault(key, row)
        obs.setdefault(key, [])
        label, value_text, flag = row["Year"].strip(), row["Value"].strip(), row["Flag"].strip()
        m = _YEAR.match(label)
        if m is None or (m[2] is not None and int(m[2]) != int(m[1]) + 2):
            rejected.append(RejectedRow(key, label, value_text, "PARSE-02: unrecognised year"))
            continue
        year = int(m[1]) + (1 if m[2] else 0)
        try:
            value: Decimal | None = Decimal(value_text)
            if value is not None and not value.is_finite():
                raise InvalidOperation
        except InvalidOperation:
            value = None
            if value_text not in series_filter.missing_markers:
                rejected.append(RejectedRow(key, label, value_text, "PARSE-03: non-numeric"))
                continue
        flags = ";".join(p for p in (flag, f"3yr:{label}" if m[2] else "") if p) or None
        obs[key].append(
            ParsedObservation(
                series_ref=key,
                ref_period_start=date(year, 1, 1),
                ref_period_end=date(year, 12, 31),
                value=value,
                value_status="MISS" if value is None else _STATUS.get(flag, "OBS"),
                source_release_at=None,
                vintage_label=None,
                source_flags=flags if value is not None else (value_text or flags),
            )
        )
    metas = []
    for key in sorted(first):
        row = first[key]
        exps = [
            -e
            for o in obs[key]
            if o.value is not None
            for e in [o.value.as_tuple().exponent]
            if isinstance(e, int)
        ]
        unit = row["Unit"].strip()
        metas.append(
            ParsedSeriesMeta(
                series_ref=key,
                entity_code=_area(row),
                frequency="A",
                unit_code="PCT" if unit == "%" else unit,
                unit_mult=0,
                base_period=None,
                price_basis="NA",
                currency_code=None,
                seasonal_adjustment="NA",
                calendar_basis="CAL",
                title=row["Item"].strip() or key,
                flow_basis="NA",
                published_decimals=max(0, max(exps)) if exps else None,
            )
        )
    return ParseOutput(
        metas=tuple(metas),
        observations=tuple(o for k in sorted(obs) for o in obs[k]),
        rejected=tuple(rejected),
    )


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
