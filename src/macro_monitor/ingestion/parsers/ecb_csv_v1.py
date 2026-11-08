"""ECB Data Portal SDMX-CSV (``format=csvdata``) parser, version 1 (FROZEN once released).

Pure function of the bytes and the series filter. Series reference: the ``KEY`` column without
its dataflow prefix (``IRS.M.DE.L.L40.CI.0000.EUR.N.Z`` -> ``M.DE.L.L40.CI.0000.EUR.N.Z``).

[UNVERIFIED] Column names and OBS_STATUS codes follow the synthetic fixture and the public SDMX
csvdata layout; no live capture exists yet (OP-04 style probe).
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation

from macro_monitor.ingestion.base import (
    ParseError,
    ParseOutput,
    RawObject,
    RejectedRow,
    SeriesFilter,
)
from macro_monitor.models.enums import Frequency, SeasonalAdjustment
from macro_monitor.models.periods import PeriodError, parse_period
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "1"
PARSER_ID = f"ecb_csv_v1@{PARSER_VERSION}"
REQUIRED = ("KEY", "FREQ", "REF_AREA", "TIME_PERIOD", "OBS_VALUE")
_STATUS = {"A": "OBS", "E": "EST", "F": "PROJ", "P": "PROV"}


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    try:
        text = raw.body.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ParseError(f"PARSE-01: not UTF-8: {exc}") from exc
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
    if missing:
        raise ParseError(f"PARSE-01: missing columns {missing}")
    obs: dict[str, list[ParsedObservation]] = {}
    first_row: dict[str, dict[str, str]] = {}
    rejected: list[RejectedRow] = []
    for row in reader:
        key = row["KEY"].split(".", 1)[-1]
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
        exps = [o.value.as_tuple().exponent for o in obs[key] if o.value is not None]
        scales_i = [-e for e in exps if isinstance(e, int)]
        sa = row.get("ADJUSTMENT", "") or "N"
        metas.append(
            ParsedSeriesMeta(
                series_ref=key,
                entity_code=row["REF_AREA"],
                frequency=row["FREQ"] if row["FREQ"] in {f.value for f in Frequency} else "",
                unit_code=row.get("UNIT", ""),
                unit_mult=0,
                base_period=None,
                price_basis="NA",
                currency_code=None,
                seasonal_adjustment=sa if sa in {s.value for s in SeasonalAdjustment} else "NA",
                calendar_basis="CAL",
                title=row.get("TITLE", "") or key,
                flow_basis="NA",
                published_decimals=max(0, max(scales_i)) if scales_i else None,
            )
        )
    observations = tuple(o for k in sorted(obs) for o in obs[k])
    return ParseOutput(metas=tuple(metas), observations=observations, rejected=tuple(rejected))


def _obs(key: str, bounds, value, status, flags):  # type: ignore[no-untyped-def]
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
