"""BIS bulk-download parser, version 1 (FROZEN once released).

Input: the bytes of one BIS bulk "flat CSV" file, either the zip as downloaded (exactly one ``.csv``
member) or a bare CSV. Pure function of the bytes and the series filter. Series reference: the
``KEY`` column without an optional ``<DATAFLOW>:`` prefix (``WS_CBPOL:M.US`` -> ``M.US``).

[UNVERIFIED] The zip/CSV layout, the column names (``KEY``, ``FREQ``, ``REF_AREA``,
``TIME_PERIOD``, ``OBS_VALUE``, optional ``OBS_STATUS``, ``UNIT_MEASURE``, ``TITLE``) and the
OBS_STATUS codes follow the synthetic fixtures only; no real BIS file was captured (OP-04 style
probe pending). If a real file differs, add ``bis_v2`` instead of editing this module.
"""

from __future__ import annotations

import csv
import io
import zipfile
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
from macro_monitor.models.enums import Frequency
from macro_monitor.models.periods import PeriodBounds, PeriodError, parse_period
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

ValueStatus = Literal["OBS", "EST", "PROV", "PROJ", "DEL", "MISS"]

PARSER_VERSION = "1"
PARSER_ID = f"bis_v1@{PARSER_VERSION}"
REQUIRED = ("KEY", "FREQ", "REF_AREA", "TIME_PERIOD", "OBS_VALUE")
MAX_MEMBER_BYTES = 4 * 1024**3  # uncompressed size guard against a corrupt or hostile archive
_STATUS: dict[str, ValueStatus] = {"A": "OBS", "E": "EST", "F": "PROJ", "P": "PROV"}
_ZIP_MAGIC = b"PK\x03\x04"


def csv_text(body: bytes) -> io.TextIOBase:
    """Text stream of the CSV in ``body`` (zip member or bare CSV); PARSE-01 on a bad archive."""
    if not body.startswith(_ZIP_MAGIC):
        return io.TextIOWrapper(io.BytesIO(body), encoding="utf-8-sig", newline="")
    try:
        zf = zipfile.ZipFile(io.BytesIO(body))
        members = [i for i in zf.infolist() if i.filename.lower().endswith(".csv")]
        if len(members) != 1:
            raise ParseError(f"PARSE-01: expected exactly one .csv member, found {len(members)}")
        if members[0].file_size > MAX_MEMBER_BYTES:
            raise ParseError("PARSE-01: csv member too large")
        return io.TextIOWrapper(zf.open(members[0]), encoding="utf-8-sig", newline="")
    except zipfile.BadZipFile as exc:
        raise ParseError(f"PARSE-01: bad zip: {exc}") from exc


def zip_member_date(body: bytes) -> date | None:
    """Newest member date inside a zip (a file-date proxy), or ``None`` if not a readable zip."""
    if not body.startswith(_ZIP_MAGIC):
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            stamps = [i.date_time[:3] for i in zf.infolist() if not i.is_dir()]
        return date(*max(stamps)) if stamps else None
    except (zipfile.BadZipFile, ValueError):
        return None


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    try:
        reader = csv.DictReader(csv_text(raw.body))
        fields = reader.fieldnames or []
        missing = [c for c in REQUIRED if c not in fields]
        if missing:
            raise ParseError(f"PARSE-01: missing columns {missing}")
        return _parse_rows(reader, series_filter)
    except UnicodeDecodeError as exc:
        raise ParseError(f"PARSE-01: not UTF-8: {exc}") from exc
    except (csv.Error, zipfile.BadZipFile) as exc:
        raise ParseError(f"PARSE-01: unreadable csv: {exc}") from exc


def _parse_rows(reader: csv.DictReader[str], series_filter: SeriesFilter) -> ParseOutput:
    obs: dict[str, list[ParsedObservation]] = {}
    first_row: dict[str, dict[str, str]] = {}
    rejected: list[RejectedRow] = []
    for row in reader:
        key = row["KEY"].split(":", 1)[-1]
        if key not in series_filter.series_refs and not series_filter.discover:
            continue
        first_row.setdefault(key, row)
        obs.setdefault(key, [])
        if key not in series_filter.series_refs:
            continue
        period, value_text = row["TIME_PERIOD"], row["OBS_VALUE"].strip()
        status = (row.get("OBS_STATUS") or "").strip()
        try:
            bounds = parse_period(period)
        except PeriodError as exc:
            rejected.append(RejectedRow(key, period, value_text, f"PARSE-02: {exc}"))
            continue
        if bounds.frequency.value != row["FREQ"]:
            rejected.append(RejectedRow(key, period, value_text, "PARSE-02: period/FREQ mismatch"))
            continue
        number: Decimal | None
        try:
            number = Decimal(value_text) if value_text else None
        except InvalidOperation:
            number = None
            if value_text not in series_filter.missing_markers:
                rejected.append(RejectedRow(key, period, value_text, "PARSE-03: non-numeric"))
                continue
        if number is not None and not number.is_finite():
            rejected.append(RejectedRow(key, period, value_text, "PARSE-03: non-finite"))
            continue
        if number is None:
            if status not in series_filter.missing_markers and value_text not in (
                series_filter.missing_markers
            ):
                rejected.append(RejectedRow(key, period, value_text, "PARSE-03: no value"))
                continue
            obs[key].append(_obs(key, bounds, None, "MISS", status or value_text))
        else:
            obs[key].append(_obs(key, bounds, number, _STATUS.get(status, "OBS"), status or None))
    metas: list[ParsedSeriesMeta] = []
    for key in sorted(first_row):
        row = first_row[key]
        scales = [-e for o in obs[key] if o.value is not None for e in [_exp(o.value)]]
        metas.append(
            ParsedSeriesMeta(
                series_ref=key,
                entity_code=row["REF_AREA"],
                frequency=row["FREQ"] if row["FREQ"] in {f.value for f in Frequency} else "",
                unit_code=row.get("UNIT_MEASURE", ""),
                unit_mult=0,
                base_period=None,
                price_basis="NA",
                currency_code=None,
                seasonal_adjustment="NA",
                calendar_basis="CAL",
                title=row.get("TITLE", "") or key,
                flow_basis="NA",
                published_decimals=max(0, max(scales)) if scales else None,
            )
        )
    observations = tuple(o for k in sorted(obs) for o in obs[k])
    return ParseOutput(metas=tuple(metas), observations=observations, rejected=tuple(rejected))


def _exp(value: Decimal) -> int:
    e = value.as_tuple().exponent
    return e if isinstance(e, int) else 0


def _obs(
    key: str, bounds: PeriodBounds, value: Decimal | None, status: ValueStatus, flags: str | None
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


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse", "zip_member_date"]
