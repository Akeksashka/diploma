"""FAO Food Price Index (FFPI) monthly CSV parser, version 1 (FROZEN once released).

Input: the bytes of the FFPI CSV. Pure function of the bytes and the series filter. Layout asserted
(fail closed with PARSE-01 on any difference):

- UTF-8 (BOM allowed); within the first 10 lines a preamble line that names the base period
  ``2014-2016 = 100``;
- a header line (within the first 10 lines) whose first cell is ``Date`` and which contains
  ``Food Price Index``; every other header cell is a sub-index name (unique);
- data lines: ``YYYY-MM`` in the first cell, one value per sub-index; the block ends at the first
  line with an empty first cell.

Series reference: the header cell (``Food Price Index``, ``Cereals``, ...). Empty cells are
skipped; text in ``missing_markers`` gives ``MISS``; other text is a rejected row (PARSE-03).

[UNVERIFIED] The preamble wording, header names and the ``YYYY-MM`` date shape follow the synthetic
fixture only; no real FFPI file was captured. If a real file differs, add ``fao_ffpi_v2`` instead
of editing this module.
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation

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
PARSER_ID = f"fao_ffpi_v1@{PARSER_VERSION}"
HEADER_SCAN_LINES = 10
BASE_PERIOD = "2014-2016=100"
_BASE = re.compile(r"2014\s*-\s*2016\s*=\s*100")


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    try:
        lines = raw.body.decode("utf-8-sig").splitlines()
    except UnicodeDecodeError as exc:
        raise ParseError(f"PARSE-01: not UTF-8: {exc}") from exc
    head = lines[:HEADER_SCAN_LINES]
    if not any(_BASE.search(line) for line in head):
        raise ParseError(f"PARSE-01: base period {BASE_PERIOD} not named in the preamble")
    start = next((i for i, line in enumerate(head) if line.split(",", 1)[0].strip() == "Date"), -1)
    if start < 0:
        raise ParseError("PARSE-01: header line starting with 'Date' not found")
    try:
        table = list(csv.reader(io.StringIO("\n".join(lines[start:]))))
    except csv.Error as exc:
        raise ParseError(f"PARSE-01: unreadable csv: {exc}") from exc
    header = [c.strip() for c in table[0]]
    names = header[1:]
    if "Food Price Index" not in names or len(set(names)) != len(names) or "" in names:
        raise ParseError(f"PARSE-01: unexpected FFPI header {header}")
    obs: dict[str, list[ParsedObservation]] = {n: [] for n in names}
    rejected: list[RejectedRow] = []
    for row in table[1:]:
        label = row[0].strip() if row else ""
        if not label:
            break
        try:
            bounds = parse_period(label)
            if bounds.frequency.value != "M":
                raise PeriodError(f"{label!r} is not a month")
        except PeriodError as exc:
            rejected.extend(
                RejectedRow(n, label, None, f"PARSE-02: {exc}")
                for n in names
                if n in series_filter.series_refs
            )
            continue
        for idx, name in enumerate(names, start=1):
            if name not in series_filter.series_refs:
                continue
            cell = row[idx].strip() if idx < len(row) else ""
            if not cell:
                continue
            try:
                value: Decimal | None = Decimal(cell)
                if value is not None and not value.is_finite():
                    raise InvalidOperation
            except InvalidOperation:
                value = None
                if cell not in series_filter.missing_markers:
                    rejected.append(RejectedRow(name, label, cell, "PARSE-03: non-numeric"))
                    continue
            obs[name].append(
                ParsedObservation(
                    series_ref=name,
                    ref_period_start=bounds.start,
                    ref_period_end=bounds.end,
                    value=value,
                    value_status="OBS" if value is not None else "MISS",
                    source_release_at=None,
                    vintage_label=None,
                    source_flags=None if value is not None else cell,
                )
            )
    metas = tuple(
        ParsedSeriesMeta(
            series_ref=n,
            entity_code="WLD",
            frequency="M",
            unit_code="IDX",
            unit_mult=0,
            base_period=BASE_PERIOD,
            price_basis="IDX",
            currency_code=None,
            seasonal_adjustment="NA",
            calendar_basis="CAL",
            title=f"FAO {n}",
            flow_basis="NA",
            published_decimals=_decimals(obs[n]),
        )
        for n in sorted(names)
        if n in series_filter.series_refs or series_filter.discover
    )
    return ParseOutput(
        metas=metas,
        observations=tuple(o for n in sorted(obs) for o in obs[n]),
        rejected=tuple(rejected),
    )


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
