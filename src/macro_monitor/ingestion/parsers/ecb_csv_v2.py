"""ECB Data Portal SDMX-CSV parser, version 2 (FROZEN once released): the real IRS layout.

The real responses (captured 2026-11-09, dataflow ``IRS``) have no ``ADJUSTMENT`` column and carry
``UNIT=PC`` (ECB code list "percent"), which is not in the project unit vocabulary (``PCT``).
Rows are parsed by ``ecb_csv_v1``; the only change is the unit code mapping ``PC`` -> ``PCT``.
Seasonal adjustment stays ``NA`` (the file states none; a yield rate is not adjusted). Any other
unit code is passed through unchanged, so an unknown unit still surfaces as a drift event.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

from macro_monitor.ingestion.base import ParseOutput, RawObject, SeriesFilter
from macro_monitor.ingestion.parsers import ecb_csv_v1

PARSER_VERSION = "2"
PARSER_ID = f"ecb_csv_v{PARSER_VERSION}@{PARSER_VERSION}"
UNITS = {"PC": "PCT"}


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    out = ecb_csv_v1.parse(raw, series_filter)
    metas = tuple(replace(m, unit_code=UNITS.get(m.unit_code, m.unit_code)) for m in out.metas)
    return replace(out, metas=metas)


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
