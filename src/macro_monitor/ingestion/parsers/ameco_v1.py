"""AMECO output gap (AVGDGP) via the DBnomics REST API, parser version 1 (FROZEN once released).

Input: the body of one ``/v22/series/AMECO/AVGDGP?observations=1`` JSON response (DBnomics direct
REST; the AGPL ``dbnomics`` Python client is NOT used). Pure function of the bytes and the series
filter. Layout asserted (fail closed with PARSE-01 on any difference):

- top-level object with ``series`` = ``{docs, limit, num_found, offset}``;
- ``offset == 0`` and ``num_found <= limit``: a truncated page is a failure, never a partial load
  (there is no paging in v1); ``len(docs) == num_found`` and no duplicate ``series_code``;
- every mapped doc has ``provider_code == "AMECO"``, ``dataset_code == "AVGDGP"``,
  ``@frequency == "annual"`` and ``period`` / ``value`` lists of equal length.

Series reference: ``series_code`` (``DEU.1.0.0.0.AVGDGP``). Values: numbers; ``NA`` (in
``missing_markers``) gives ``MISS``; other text is a rejected row (PARSE-03). Forecast years cannot
be told from outturn in this response, so every value is ``OBS`` and the series map must not claim
otherwise. VINTAGES: DBnomics serves the current AMECO release only; the stored raw object is our
only vintage of it.

WARNING: every AMECO value is OBS, including European Commission forecast years. Series A02c
must stay out of snapshots and alerts until a forecast/outturn cut-off rule is decided (pending
user decision); this parser deliberately applies none.

[UNVERIFIED] The response shape, the series code layout, ``@frequency`` spelling and the unit
(percent of potential GDP, ``PCT_POT_GDP``) follow the synthetic fixture and research notes only;
no live response was captured. If a real response differs, add ``ameco_v2`` instead of editing
this module.
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
PARSER_ID = f"ameco_v1@{PARSER_VERSION}"
PROVIDER, DATASET = "AMECO", "AVGDGP"
UNIT = "PCT_POT_GDP"


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    try:
        doc = json.loads(raw.body, parse_float=Decimal)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ParseError(f"PARSE-01: not JSON: {exc}") from exc
    series = doc.get("series") if isinstance(doc, dict) else None
    if not isinstance(series, dict) or not isinstance(series.get("docs"), list):
        raise ParseError("PARSE-01: no series.docs list")
    limit, found, offset = series.get("limit"), series.get("num_found"), series.get("offset")
    if not (isinstance(limit, int) and isinstance(found, int) and isinstance(offset, int)):
        raise ParseError("PARSE-01: series.limit / num_found / offset missing")
    if offset != 0 or found > limit:
        raise ParseError(
            f"PARSE-01: truncated page (offset {offset}, {found} found, limit {limit})"
        )
    if len(series["docs"]) != found:
        raise ParseError(f"PARSE-01: truncated docs ({len(series['docs'])} of {found})")
    obs: dict[str, list[ParsedObservation]] = {}
    metas: list[ParsedSeriesMeta] = []
    rejected: list[RejectedRow] = []
    seen: set[str] = set()
    for item in series["docs"]:
        code = item.get("series_code") if isinstance(item, dict) else None
        if not isinstance(code, str):
            raise ParseError("PARSE-01: a doc without series_code")
        if code in seen:
            raise ParseError(f"PARSE-01: duplicate series_code {code}")
        seen.add(code)
        if code not in series_filter.series_refs:
            continue
        _assert_doc(code, item)
        rows: list[ParsedObservation] = []
        for period, value in zip(item["period"], item["value"], strict=True):
            try:
                bounds = parse_period(str(period))
                if bounds.frequency.value != "A":
                    raise PeriodError(f"{period!r} is not annual")
            except PeriodError as exc:
                rejected.append(RejectedRow(code, str(period), str(value), f"PARSE-02: {exc}"))
                continue
            number = _number(value)
            if number is None and str(value) not in series_filter.missing_markers:
                rejected.append(RejectedRow(code, str(period), str(value), "PARSE-03: non-numeric"))
                continue
            rows.append(
                ParsedObservation(
                    series_ref=code,
                    ref_period_start=bounds.start,
                    ref_period_end=bounds.end,
                    value=number,
                    value_status="OBS" if number is not None else "MISS",
                    source_release_at=None,
                    vintage_label=None,
                    source_flags=None if number is not None else str(value),
                )
            )
        obs[code] = rows
        exps = [
            -e
            for o in rows
            if o.value is not None
            for e in [o.value.as_tuple().exponent]
            if isinstance(e, int)
        ]
        metas.append(
            ParsedSeriesMeta(
                series_ref=code,
                entity_code=code.partition(".")[0],
                frequency="A",
                unit_code=UNIT,
                unit_mult=0,
                base_period=None,
                price_basis="NA",
                currency_code=None,
                seasonal_adjustment="NA",
                calendar_basis="CAL",
                title=str(item.get("series_name") or code),
                flow_basis="NA",
                published_decimals=max(0, max(exps)) if exps else None,
            )
        )
    metas.sort(key=lambda m: m.series_ref)
    return ParseOutput(
        metas=tuple(metas),
        observations=tuple(o for k in sorted(obs) for o in obs[k]),
        rejected=tuple(rejected),
    )


def _assert_doc(code: str, item: dict[str, Any]) -> None:
    if item.get("provider_code") != PROVIDER or item.get("dataset_code") != DATASET:
        raise ParseError(f"PARSE-01: {code}: not {PROVIDER}/{DATASET}")
    if item.get("@frequency") != "annual":
        raise ParseError(f"PARSE-01: {code}: @frequency {item.get('@frequency')!r} is not annual")
    period, value = item.get("period"), item.get("value")
    if not isinstance(period, list) or not isinstance(value, list) or len(period) != len(value):
        raise ParseError(f"PARSE-01: {code}: period/value lists missing or of unequal length")


def _number(value: Any) -> Decimal | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
