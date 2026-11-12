"""Parser registry (ingestion spec section 2, B12; AC-ING-11).

``parser_id = "<module>@<PARSER_VERSION>"``. Released versions are frozen modules; every
historical id stays resolvable, because rebuild and re-staging use the recorded id.
Never delete or edit a released entry: add a new module and a new entry.
"""

from __future__ import annotations

from importlib import import_module

from macro_monitor.ingestion.base import ParseFn

# parser_id -> module under macro_monitor.ingestion.parsers (function ``parse``).
RELEASED_PARSERS: dict[str, str] = {
    "jsonstat_v1@1": "macro_monitor.ingestion.parsers.jsonstat_v1",
    "ecb_csv_v1@1": "macro_monitor.ingestion.parsers.ecb_csv_v1",
    "worldbank_v1@1": "macro_monitor.ingestion.parsers.worldbank_v1",
    "bis_v1@1": "macro_monitor.ingestion.parsers.bis_v1",
    "sdmxcsv_v1@1": "macro_monitor.ingestion.parsers.sdmxcsv_v1",
    "pinksheet_v1@1": "macro_monitor.ingestion.parsers.pinksheet_v1",
    "fao_ffpi_v1@1": "macro_monitor.ingestion.parsers.fao_ffpi_v1",
    "fao_csdb_v1@1": "macro_monitor.ingestion.parsers.fao_csdb_v1",
    "fao_stat_v1@1": "macro_monitor.ingestion.parsers.fao_stat_v1",
    "ecsurvey_v1@1": "macro_monitor.ingestion.parsers.ecsurvey_v1",
    "ameco_v1@1": "macro_monitor.ingestion.parsers.ameco_v1",
    "jsonstat_v2@2": "macro_monitor.ingestion.parsers.jsonstat_v2",
    "worldbank_v2@2": "macro_monitor.ingestion.parsers.worldbank_v2",
    "fao_csdb_v2@2": "macro_monitor.ingestion.parsers.fao_csdb_v2",
    "sdmxcsv_v2@2": "macro_monitor.ingestion.parsers.sdmxcsv_v2",
    "bis_v2@2": "macro_monitor.ingestion.parsers.bis_v2",
    "fao_ffpi_v2@2": "macro_monitor.ingestion.parsers.fao_ffpi_v2",
    "ecb_csv_v2@2": "macro_monitor.ingestion.parsers.ecb_csv_v2",
    "ecsurvey_v2@2": "macro_monitor.ingestion.parsers.ecsurvey_v2",
    "weo_v1@1": "macro_monitor.ingestion.parsers.weo_v1",
}


class UnknownParserError(LookupError):
    pass


def resolve(parser_id: str) -> ParseFn:
    module_name = RELEASED_PARSERS.get(parser_id)
    if module_name is None:
        raise UnknownParserError(f"parser_id {parser_id!r} is not in the registry")
    parse: ParseFn = import_module(module_name).parse
    return parse
