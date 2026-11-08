"""JSON-stat parser, version 2 (FROZEN once released): v1 plus the flow basis of GDP levels.

``jsonstat_v1`` publishes ``flow_basis = "NA"`` for everything. Version 2 parses with v1 and then
declares ``PERIOD_FLOW`` for one family only: a current-price GDP level (``B1GQ`` in the series
key, unit ``CP_MNAC`` or ``CP_MEUR``) of a Eurostat quarterly national-accounts cube, which is the
quarter's own level and not a seasonally adjusted annualised rate (research
``data-sources-support-series-reserves-targets.md`` F1, design P18). Any other series is returned
exactly as v1 produced it.

[UNVERIFIED] The ``unit`` and ``na_item`` category codes are from the research, not a live capture.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

from macro_monitor.ingestion.base import ParseOutput, RawObject, SeriesFilter
from macro_monitor.ingestion.parsers import jsonstat_v1

PARSER_VERSION = "2"
PARSER_ID = f"jsonstat_v{PARSER_VERSION}@{PARSER_VERSION}"
GDP_ITEM = "B1GQ"
PERIOD_FLOW_UNITS = frozenset({"CP_MNAC", "CP_MEUR"})


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    out = jsonstat_v1.parse(raw, series_filter)
    metas = tuple(
        replace(m, flow_basis="PERIOD_FLOW")
        if m.flow_basis == "NA"
        and m.unit_code in PERIOD_FLOW_UNITS
        and GDP_ITEM in m.series_ref.split(".")
        else m
        for m in out.metas
    )
    return replace(out, metas=metas)


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
