"""World Bank Indicators API parser, version 2 (FROZEN once released): v1 plus unit and flow basis.

``worldbank_v1`` leaves the WDI ``unit`` field as the API sends it (empty) and publishes
``flow_basis = "NA"``. Version 2 parses with v1 and fills, for the listed GDP indicators only, the
unit (``LCU`` or ``USD``), the currency of the USD series and ``flow_basis = PERIOD_FLOW`` (an
annual GDP total is the year's own flow). An indicator not in the table, and any metadata value the
API did send, is left as v1 produced it.

[UNVERIFIED] The indicator ids are from the approved research (F2, F3); the table is not a live
capture.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

from macro_monitor.ingestion.base import ParseOutput, RawObject, SeriesFilter
from macro_monitor.ingestion.parsers import worldbank_v1
from macro_monitor.models.types import ParsedSeriesMeta

PARSER_VERSION = "2"
PARSER_ID = f"worldbank_v{PARSER_VERSION}@{PARSER_VERSION}"

#: indicator id -> (unit_code, currency_code, flow_basis)
INDICATOR_ATTRS: dict[str, tuple[str, str | None, str]] = {
    "NY.GDP.MKTP.CN": ("LCU", None, "PERIOD_FLOW"),  # national currency differs per country
    "NY.GDP.MKTP.CD": ("USD", "USD", "PERIOD_FLOW"),
}


def _complete(m: ParsedSeriesMeta) -> ParsedSeriesMeta:
    attrs = INDICATOR_ATTRS.get(m.series_ref.rsplit(".", 1)[0])
    if attrs is None:
        return m
    unit, currency, flow = attrs
    return replace(
        m,
        unit_code=m.unit_code or unit,
        currency_code=m.currency_code or currency,
        flow_basis=flow if m.flow_basis == "NA" else m.flow_basis,  # type: ignore[arg-type]
    )


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    out = worldbank_v1.parse(raw, series_filter)
    return replace(out, metas=tuple(_complete(m) for m in out.metas))


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
