"""T58: bulk-file connectors (Pink Sheet, FAO, EC surveys, AMECO via DBnomics REST).

Offline. Every fixture is SYNTHETIC and every layout is [UNVERIFIED]; the golden values below pin
the parsers to those fixtures only, not to the real files.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
import zlib
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
from openpyxl import Workbook

from macro_monitor.cli import _connector, _parser_id
from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import GroupConfig, ParseError, RawObject
from macro_monitor.ingestion.connectors.bulk import (
    BULK_SOURCES,
    BulkConnector,
    DbnomicsConnector,
    file_date,
)
from macro_monitor.ingestion.connectors.sdmx import (
    ConnectorConfigError,
    load_series_entries,
    series_filter_for,
)
from macro_monitor.ingestion.discovery import DiscoveryFailed
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.ingestion.parsers.xlsx_rows import is_xlsx
from macro_monitor.registry.config import load_sources
from macro_monitor.storage.manifest import LatestState

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "tests" / "fixtures" / "raw"
PINK = FIX / "pinksheet" / "monthly_synthetic.xlsx"
FFPI = FIX / "fao" / "ffpi_synthetic.csv"
CSDB = FIX / "fao" / "csdb_synthetic.xlsx"
SOFI = FIX / "fao" / "foodsecurity_synthetic.zip"
BCS = FIX / "ecsurvey" / "bcs_synthetic.zip"  # v1 layout, kept for the frozen v1 parser
BCS2 = FIX / "ecsurvey" / "main_indicators_sa_nace2_real_layout.zip"
LANDING_EXCERPT = FIX / "ecsurvey" / "landing_excerpt.html"
AMECO = FIX / "dbnomics" / "ameco_avgdgp_synthetic.json"
NEW_SOURCES = ("worldbank_pinksheet", "fao", "faostat", "ec_surveys", "dbnomics")
NEW_GROUPS = (
    "pinksheet_monthly",
    "fao_ffpi",
    "fao_csdb",
    "faostat_sofi",
    "ec_bcs_monthly",
    "dbnomics_ameco_gap",
)


class FakeState:
    def __init__(self, latest: LatestState | None = None) -> None:
        self._latest = latest or LatestState()

    def latest(self, source_id: str, request_key: str) -> LatestState:
        return self._latest


class Clock:
    def monotonic(self) -> float:
        return 0.0

    def sleep(self, seconds: float) -> None:
        pass

    def wall(self) -> datetime:
        return datetime(2026, 11, 5, tzinfo=UTC)


def _conf() -> Any:
    return load_sources(ROOT / "config" / "sources.yaml", env_example=ROOT / ".env.example")


def _source(source_id: str) -> dict[str, Any]:
    return next(s for s in _conf().data["sources"] if s["id"] == source_id)


def _group(group_id: str) -> GroupConfig:
    for source in _conf().data["sources"]:
        for g in source["groups"]:
            if g["id"] == group_id:
                entries = load_series_entries(ROOT / g["series_map"])
                return GroupConfig.from_config(source, g, entries)
    raise AssertionError(group_id)


def _parser_spec(group_id: str) -> str:
    for source in _conf().data["sources"]:
        for g in source["groups"]:
            if g["id"] == group_id:
                return str(g["parser"])
    raise AssertionError(group_id)


def _raw(body: bytes, group: str) -> RawObject:
    pid = _parser_id(_parser_spec(group))
    return RawObject(body=body, source_id="x", group_id=group, fetched_at=None, parser_id=pid)  # type: ignore[arg-type]


def _raw_v1(body: bytes, group: str) -> RawObject:
    return RawObject(
        body=body,
        source_id="x",
        group_id=group,
        fetched_at=None,  # type: ignore[arg-type]
        parser_id="fao_csdb_v1@1",
    )


def _parse(path: Path, group_id: str, dataset: str | None = None) -> Any:
    g = _group(group_id)
    flt = series_filter_for(g.series, dataset or g.series[0].dataset, g.missing_markers)
    source = next(s for s in _conf().data["sources"] if s["id"] == g.source_id)
    connector = _connector(source)
    return connector.parse(_raw(path.read_bytes(), group_id), flt)


def _xlsx(build: Any) -> bytes:
    wb = Workbook()
    build(wb)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _zip(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _values(out: Any, ref: str) -> list[tuple[str, Decimal | None, str]]:
    return [
        (o.ref_period_start.isoformat(), o.value, o.value_status)
        for o in out.observations
        if o.series_ref == ref
    ]


# ------------------------------------------------------------------ registry and config


def test_parsers_registered_and_group_parser_specs_resolve() -> None:
    for pid in (
        "pinksheet_v1@1",
        "fao_ffpi_v1@1",
        "fao_csdb_v1@1",
        "fao_stat_v1@1",
        "ecsurvey_v1@1",
        "ecsurvey_v2@2",
        "ameco_v1@1",
    ):
        assert registry.resolve(pid) is not None
    ids = {g: _parser_id(_parser_spec(g)) for g in NEW_GROUPS}
    assert ids == {
        "pinksheet_monthly": "pinksheet_v1@1",
        "fao_ffpi": "fao_ffpi_v2@2",
        "fao_csdb": "fao_csdb_v2@2",
        "faostat_sofi": "fao_stat_v1@1",
        "ec_bcs_monthly": "ecsurvey_v2@2",
        "dbnomics_ameco_gap": "ameco_v1@1",
    }


def test_new_sources_disabled_explicit_policies_no_group_switch() -> None:
    for sid in NEW_SOURCES:
        s = _source(sid)
        # the source switch is an explicit boolean (operators flip it); the pinksheet stays parked
        assert isinstance(s["enabled"], bool), sid
        if sid == "worldbank_pinksheet":
            assert s["enabled"] is False
        assert s["archive"] in ("public", "hash_only")
        assert s["publish_site"] in (
            "public",
            "withheld",
        )
        assert all("enabled" not in g for g in s["groups"]), sid
        if s["licence"]["redistribution_of_raw"] == "unclear":
            assert (s["archive"], s["publish_site"]) == ("hash_only", "withheld"), sid
    assert _conf().effective_enabled["worldbank_pinksheet"] is False
    assert _source("dbnomics")["kind"] == "rest"
    assert all(_source(s)["kind"] == "bulk" for s in NEW_SOURCES if s != "dbnomics")


def test_fao_keeps_bytes_because_our_copy_is_the_only_vintage() -> None:
    fao = _source("fao")
    assert fao["archive"] == "public"  # hash_only would lose the only copy of each brief
    csdb = next(g for g in fao["groups"] if g["id"] == "fao_csdb")
    assert "only vintage" in csdb["description"]
    assert csdb["reestimating"] is False


def test_connector_dispatch_and_unknown_bulk_source() -> None:
    for sid in BULK_SOURCES:
        assert _connector({"id": sid}).source_id == sid
    assert isinstance(_connector({"id": "dbnomics"}), DbnomicsConnector)
    with pytest.raises(ConnectorConfigError):
        BulkConnector("nope")


def test_ameco_route_has_no_agpl_client() -> None:
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8").lower()
    assert "dbnomics" not in text.replace("dbnomics_", "")
    assert "dbnomics" not in (ROOT / "uv.lock").read_text(encoding="utf-8").lower()


def test_series_map_units_are_seeded_by_migrations() -> None:
    seeded: set[str] = set()
    for sql in sorted((ROOT / "src/macro_monitor/storage/migrations").glob("*.sql")):
        text = sql.read_text(encoding="utf-8")
        if "INSERT INTO ref.unit" in text:
            seeded |= set(
                re.findall(
                    r"\(\s*'([A-Z0-9_]+)'\s*,\s*'(?:ratio|index|currency|count|other)'", text
                )
            )
    used: set[str] = set()
    for group in NEW_GROUPS:
        text = (
            ROOT
            / next(
                g["series_map"]
                for s in _conf().data["sources"]
                for g in s["groups"]
                if g["id"] == group
            )
        ).read_text(encoding="utf-8")
        used |= set(re.findall(r"unit: ([A-Z0-9_]+)", text))
    assert used
    assert used <= seeded, sorted(used - seeded)


# ------------------------------------------------------------------ Pink Sheet


def test_pinksheet_golden_parse() -> None:
    out = _parse(PINK, "pinksheet_monthly")
    assert [m.series_ref for m in out.metas] == ["Crude oil, Brent", "Food price index"]
    brent, food = out.metas
    assert (brent.unit_code, brent.price_basis, brent.currency_code) == ("USD_BBL", "NOM", "USD")
    assert (food.unit_code, food.base_period, food.price_basis) == ("IDX", "2010=100", "IDX")
    assert all(m.entity_code == "WLD" and m.frequency == "M" for m in out.metas)
    assert _values(out, "Crude oil, Brent") == [
        ("2025-08-01", Decimal("67.1"), "OBS"),
        ("2025-09-01", Decimal("68.35"), "OBS"),
        ("2025-10-01", Decimal("66.9"), "OBS"),
    ]
    assert brent.published_decimals == 2
    assert out.rejected == ()


def test_pinksheet_missing_marker_blank_and_unmapped_columns() -> None:
    g = _group("pinksheet_monthly")
    flt = series_filter_for(g.series, "CMO-Historical-Data-Monthly", g.missing_markers)
    wide = replace(flt, series_refs=frozenset({"Urea", "Wheat, US HRW", "Gold"}))
    out = BulkConnector("worldbank_pinksheet").parse(
        _raw(PINK.read_bytes(), "pinksheet_monthly"), wide
    )
    assert _values(out, "Urea")[1] == ("2025-09-01", None, "MISS")  # "…" is a declared marker
    assert len(_values(out, "Wheat, US HRW")) == 2  # the blank cell gives no observation
    assert {m.unit_code for m in out.metas} == {"USD_MT", "($/toz)"}  # unknown unit passes through
    no_marker = replace(wide, missing_markers=frozenset())
    out2 = BulkConnector("worldbank_pinksheet").parse(
        _raw(PINK.read_bytes(), "pinksheet_monthly"), no_marker
    )
    assert [r.reason for r in out2.rejected] == ["PARSE-03: non-numeric"]


def _pink_variant(mutate: Any) -> bytes:
    def build(wb: Workbook) -> None:
        ws = wb.active
        assert ws is not None
        ws.title = "Monthly Prices"
        for _ in range(4):
            ws.append([])
        ws.append(["Commodity", "Crude oil, Brent"])
        ws.append(["Unit", "($/bbl)"])
        ws.append(["2025M08", 67.1])
        mutate(wb, ws)

    return _xlsx(build)


@pytest.mark.parametrize(
    ("mutate", "match"),
    [
        (lambda wb, ws: setattr(ws, "title", "Prices"), "worksheet 'Monthly Prices'"),
        (lambda wb, ws: ws.__setitem__("A5", "Name"), "header anchors"),
        (lambda wb, ws: ws.__setitem__("A6", None), "header anchors"),
        (lambda wb, ws: ws.__setitem__("C5", "Crude oil, Brent"), "duplicate"),
    ],
)
def test_pinksheet_layout_drift_fails_closed(mutate: Any, match: str) -> None:
    g = _group("pinksheet_monthly")
    flt = series_filter_for(g.series, "CMO-Historical-Data-Monthly", g.missing_markers)
    with pytest.raises(ParseError, match=f"PARSE-01.*{match}"):
        BulkConnector("worldbank_pinksheet").parse(
            _raw(_pink_variant(mutate), "pinksheet_monthly"), flt
        )


def test_pinksheet_not_a_workbook_and_bad_period_row() -> None:
    g = _group("pinksheet_monthly")
    flt = series_filter_for(g.series, "CMO-Historical-Data-Monthly", g.missing_markers)
    with pytest.raises(ParseError, match="PARSE-01"):
        BulkConnector("worldbank_pinksheet").parse(
            _raw(b"not a workbook", "pinksheet_monthly"), flt
        )
    body = _pink_variant(lambda wb, ws: ws.append(["1960-01", 1.0]))
    out = BulkConnector("worldbank_pinksheet").parse(_raw(body, "pinksheet_monthly"), flt)
    assert [r.reason.split(":")[0] for r in out.rejected] == ["PARSE-02"]


# ------------------------------------------------------------------ FAO FFPI


def test_ffpi_golden_parse_and_discovery_of_unmapped_columns() -> None:
    out = _parse(FFPI, "fao_ffpi")
    assert [m.series_ref for m in out.metas] == ["Food Price Index"]
    assert out.metas[0].base_period == "2014-2016=100"
    assert _values(out, "Food Price Index") == [
        ("2025-08-01", Decimal("128.0"), "OBS"),
        ("2025-09-01", Decimal("128.8"), "OBS"),
        ("2025-10-01", Decimal("126.4"), "OBS"),
    ]
    g = _group("fao_ffpi")
    flt = series_filter_for(g.series, "food_price_indices_data", g.missing_markers)
    both = replace(flt, series_refs=frozenset({"Food Price Index", "Dairy"}))
    out2 = BulkConnector("fao").parse(_raw(FFPI.read_bytes(), "fao_ffpi"), both)
    assert _values(out2, "Dairy")[2] == ("2025-10-01", None, "MISS")  # ".." is a declared marker


@pytest.mark.parametrize(
    ("edit", "match"),
    [
        (lambda t: t.replace("2014-2016 = 100", "2010 = 100"), "base period"),
        (lambda t: t.replace("Date,", "When,"), "header line"),
        (lambda t: t.replace("Food Price Index", "FPI"), "unexpected FFPI header"),
        (lambda t: t.replace("Meat,Dairy", "Meat,Meat"), "unexpected FFPI header"),
    ],
)
def test_ffpi_layout_drift_fails_closed(edit: Any, match: str) -> None:
    g = _group("fao_ffpi")
    flt = series_filter_for(g.series, "food_price_indices_data", g.missing_markers)
    body = edit(FFPI.read_text(encoding="utf-8")).encode()
    with pytest.raises(ParseError, match=f"PARSE-01.*{match}"):
        BulkConnector("fao").parse(_raw(body, "fao_ffpi"), flt)
    with pytest.raises(ParseError, match="PARSE-01"):
        BulkConnector("fao").parse(_raw(b"\xff\xfe\x00", "fao_ffpi"), flt)


def test_ffpi_bad_date_and_non_numeric_rows_are_rejected_not_loaded() -> None:
    g = _group("fao_ffpi")
    flt = series_filter_for(g.series, "food_price_indices_data", g.missing_markers)
    text = (
        FFPI.read_text(encoding="utf-8")
        .replace("2025-09,128.8", "2025-Q3,128.8")
        .replace("2025-10,126.4", "2025-10,n/a")
    )
    out = BulkConnector("fao").parse(_raw(text.encode(), "fao_ffpi"), flt)
    assert [r.reason.split(":")[0] for r in out.rejected] == ["PARSE-02", "PARSE-03"]
    assert [v[0] for v in _values(out, "Food Price Index")] == ["2025-08-01"]


# ------------------------------------------------------------------ FAO cereal brief


def test_csdb_v1_golden_parse_marketing_year_and_status() -> None:
    g = _group("fao_csdb_manual")
    flt = series_filter_for(g.series, g.series[0].dataset, g.missing_markers)
    out = BulkConnector("fao").parse(_raw_v1(CSDB.read_bytes(), "fao_csdb_manual"), flt)
    name = "World cereals stocks-to-use ratio (%)"
    assert [m.series_ref for m in out.metas] == [name]
    meta = out.metas[0]
    assert (meta.frequency, meta.unit_code, meta.calendar_basis, meta.entity_code) == (
        "A",
        "PCT",
        "MKTYR",
        "WLD",
    )
    assert _values(out, name) == [
        ("2024-07-01", Decimal("30.9"), "OBS"),
        ("2025-07-01", Decimal("31.4"), "EST"),
        ("2026-07-01", Decimal("31.7"), "PROJ"),
    ]
    assert [o.ref_period_end for o in out.observations] == [
        date(2025, 6, 30),
        date(2026, 6, 30),
        date(2027, 6, 30),
    ]
    assert out.source_updated == "2026-10"
    # our copy is the only vintage: the parser invents no source vintage or release time
    assert all(o.vintage_label is None and o.source_release_at is None for o in out.observations)


@pytest.mark.parametrize(
    ("mutate", "match"),
    [
        (lambda ws: ws.__setitem__("A1", "Edition"), "Release"),
        (lambda ws: ws.__setitem__("B1", "October"), "Release"),
        (lambda ws: ws.__setitem__("C3", "2025/27"), "season label"),
        (lambda ws: ws.__setitem__("C4", "guess"), "status"),
        (lambda ws: ws.__setitem__("A4", "State"), "anchors"),
    ],
)
def test_csdb_layout_drift_fails_closed(mutate: Any, match: str) -> None:
    def build(wb: Workbook) -> None:
        ws = wb.active
        assert ws is not None
        ws.title = "CSDB"
        ws.append(["Release", "2026-10"])
        ws.append([])
        ws.append(["Item", "2024/25", "2025/26"])
        ws.append(["Status", "actual", "estimate"])
        ws.append(["World cereals stocks-to-use ratio (%)", 30.9, 31.4])
        mutate(ws)

    g = _group("fao_csdb_manual")
    flt = series_filter_for(g.series, "csdb", g.missing_markers)
    with pytest.raises(ParseError, match=f"PARSE-01.*{match}"):
        BulkConnector("fao").parse(_raw_v1(_xlsx(build), "fao_csdb_manual"), flt)


def test_csdb_wrong_sheet_fails_closed() -> None:
    g = _group("fao_csdb_manual")
    flt = series_filter_for(g.series, "csdb", g.missing_markers)
    body = _xlsx(lambda wb: setattr(wb.active, "title", "Sheet1"))
    with pytest.raises(ParseError, match="worksheet 'CSDB'"):
        BulkConnector("fao").parse(_raw_v1(body, "fao_csdb_manual"), flt)


def test_fao_source_needs_a_recorded_parser_id() -> None:
    g = _group("fao_csdb_manual")
    flt = series_filter_for(g.series, "csdb", g.missing_markers)
    bare = RawObject(
        body=CSDB.read_bytes(), source_id="fao", group_id="fao_csdb_manual", fetched_at=None
    )  # type: ignore[arg-type]
    with pytest.raises(ParseError, match="no parser id"):
        BulkConnector("fao").parse(bare, flt)


def _v2_book(blocks: list[list[list[Any]]]) -> bytes:
    def build(wb: Workbook) -> None:
        ws = wb.active
        assert ws is not None
        ws.title = "CSDB data"
        for block in blocks:
            for row in block:
                ws.append(row)
            ws.append([])

    return _xlsx(build)


_RATIO = "World stock-to-use ratio"


def _v2_parse(body: bytes) -> Any:
    g = _group("fao_csdb_manual")
    flt = series_filter_for(g.series, g.series[0].dataset, g.missing_markers)
    return BulkConnector("fao").parse(_raw(body, "fao_csdb_manual"), flt)


def test_manual_group_uses_v2_and_reads_real_layout() -> None:
    assert _parser_id(_parser_spec("fao_csdb_manual")) == "fao_csdb_v2@2"
    out = _v2_parse(
        _v2_book(
            [
                [
                    ["WORLD CEREAL MARKET"],
                    [None, "World production", _RATIO],
                    [None, "( . . million tonnes . . )", "( . percent . )"],
                    ["2023/24", 2300, 30.9],
                    ["2024/25", 2350, 31.4],
                    ["2025/26", 2400, 31.7],
                ]
            ]
        )
    )
    name = "World cereals stocks-to-use ratio (%)"
    assert [m.series_ref for m in out.metas] == [name]
    assert out.metas[0].unit_code == "PCT"
    assert [(o.value_status, o.source_flags) for o in out.observations] == [
        ("OBS", "status-inferred"),
        ("EST", "status-inferred"),
        ("PROJ", "status-inferred"),
    ]


def test_v2_million_tonnes_unit_mult_and_unknown_unit_fails() -> None:
    def book(unit: str) -> bytes:
        return _v2_book(
            [
                [
                    ["WORLD CEREAL MARKET"],
                    [None, _RATIO],
                    [None, unit],
                    ["2024/25", 5],
                ]
            ]
        )

    # the ratio column is given a tonnage unit on purpose to exercise the mapping
    meta = _v2_parse(book("million tonnes")).metas[0]
    assert (meta.unit_code, meta.unit_mult) == ("MT", 6)
    with pytest.raises(ParseError, match=r"PARSE-01.*unknown unit"):
        _v2_parse(book("US$ per tonne"))


def test_v2_block_without_season_rows_does_not_scan_into_next_block() -> None:
    body = _v2_book(
        [
            [["WORLD CEREAL MARKET"], [None, _RATIO], [None, "( . percent . )"]],
            [["OTHER BLOCK"], [None, _RATIO], [None, "( . percent . )"], ["2024/25", 31.4]],
        ]
    )
    # the data belongs to OTHER BLOCK, not to the empty WORLD CEREAL MARKET block
    with pytest.raises(ParseError, match=r"PARSE-01.*no CSDB block"):
        _v2_parse(body)


# ------------------------------------------------------------------ FAOSTAT SOFI


def test_faostat_golden_parse_centre_year_flags_and_censored_values() -> None:
    g = _group("faostat_sofi")
    assert {e.key for e in g.series} == {"276.21004.6121", "356.21004.6121", "032.21004.6121"}
    out = _parse(SOFI, "faostat_sofi")
    assert [m.series_ref for m in out.metas] == [
        "032.21004.6121",
        "276.21004.6121",
        "356.21004.6121",
    ]
    assert out.metas[0].entity_code == "032"
    assert out.metas[0].unit_code == "PCT"
    assert _values(out, "356.21004.6121") == [
        ("2022-01-01", Decimal("13.7"), "EST"),
        ("2023-01-01", Decimal("13.5"), "EST"),
        # SYNTHETIC row invented to exercise flag F -> PROJ; not real FAOSTAT data, and the
        # F meaning itself is [UNVERIFIED] until the first probe.
        ("2030-01-01", Decimal("9.0"), "PROJ"),
    ]
    india = [o for o in out.observations if o.series_ref == "356.21004.6121"]
    assert india[0].source_flags == "E;3yr:2021-2023"
    assert india[0].ref_period_end == date(2022, 12, 31)
    # "<2.5" (Germany) is censored text: rejected, never loaded as a number; Argentina's empty
    # value is rejected too because no missing marker is declared for this group.
    assert sorted(r.raw_value or "" for r in out.rejected) == ["", "<2.5", "<2.5"]
    assert not [o for o in out.observations if o.series_ref == "276.21004.6121"]


def test_faostat_missing_marker_and_other_items_ignored() -> None:
    g = _group("faostat_sofi")
    flt = series_filter_for(g.series, "Food_Security_Data", ["<2.5"])
    out = BulkConnector("faostat").parse(_raw(SOFI.read_bytes(), "faostat_sofi"), flt)
    assert [o.value_status for o in out.observations if o.series_ref == "276.21004.6121"] == [
        "MISS",
        "MISS",
    ]
    assert not [m for m in out.metas if m.series_ref.endswith(".21010.6121")]  # not whitelisted


@pytest.mark.parametrize(
    "members",
    [
        {"Food_Security_Data_E_Flags.csv": b"a\n"},  # no normalized member
        {
            "A_All_Data_(Normalized).csv": b"x\n",
            "B_All_Data_(Normalized).csv": b"x\n",
        },  # two
        {"Food_Security_Data_E_All_Data_(Normalized).csv": b"Area,Value\n1,2\n"},  # columns
    ],
)
def test_faostat_layout_drift_fails_closed(members: dict[str, bytes]) -> None:
    g = _group("faostat_sofi")
    flt = series_filter_for(g.series, "Food_Security_Data", g.missing_markers)
    with pytest.raises(ParseError, match="PARSE-01"):
        BulkConnector("faostat").parse(_raw(_zip(members), "faostat_sofi"), flt)
    with pytest.raises(ParseError, match="PARSE-01"):
        BulkConnector("faostat").parse(_raw(b"PK\x03\x04junk", "faostat_sofi"), flt)


# ------------------------------------------------------------------ EC surveys


def test_ecsurvey_golden_parse() -> None:
    out = _parse(BCS2, "ec_bcs_monthly")
    refs = [m.series_ref for m in out.metas]
    assert refs == sorted(e.key for e in _group("ec_bcs_monthly").series)
    assert len(refs) == 8
    assert all(m.seasonal_adjustment == "SA" for m in out.metas)
    assert all(
        m.unit_code == ("IDX" if m.series_ref.endswith(".ESI") else "BALANCE") for m in out.metas
    )
    assert "DE.INDU" not in refs  # unmapped columns ignored
    assert "DE.BUIL" not in refs
    assert _values(out, "DE.ESI") == [
        ("1985-01-01", Decimal("97.8"), "OBS"),
        ("1985-02-01", Decimal("97.3"), "OBS"),
        ("1985-03-01", Decimal("96.8"), "OBS"),
        ("2026-08-01", Decimal("94.2"), "OBS"),
        ("2026-09-01", Decimal("94.8"), "OBS"),
        ("2026-10-01", Decimal("94.1"), "OBS"),
    ]
    fr = _values(out, "FR.ESI")
    assert fr[0] == ("1985-01-01", None, "MISS")  # the text marker NA
    assert fr[1] == ("1985-02-01", Decimal("82"), "OBS")
    assert _values(out, "EA.CONS")[-1] == ("2026-10-01", Decimal("-17.9"), "OBS")
    assert out.observations[0].ref_period_end == date(1985, 1, 31)
    assert out.rejected == ()


def _bcs(mutate: Any) -> bytes:
    def build(wb: Workbook) -> None:
        ws = wb.active
        assert ws is not None
        ws.title = "MONTHLY"
        ws.append([None, "DE.ESI", "DE.CONS", None, "FR.ESI"])
        ws.append([datetime(2025, 8, 31), -1.0, -3.0, None, 2.0])
        ws.append([datetime(2025, 9, 30), "NA", -2.0, None, 3.0])
        mutate(wb)

    return _zip({"main_indicators_nace2.xlsx": _xlsx(build)})


def test_ecsurvey_layout_drift_fails_closed() -> None:
    g = _group("ec_bcs_monthly")
    refs = ("DE.ESI", "DE.CONS", "FR.ESI")
    series = [e for e in g.series if e.key in refs]
    flt = series_filter_for(series, "main_indicators_sa_nace2", g.missing_markers)
    ok = BulkConnector("ec_surveys").parse(_raw(_bcs(lambda wb: None), "ec_bcs_monthly"), flt)
    assert _values(ok, "DE.CONS") == [
        ("2025-08-01", Decimal("-3.0"), "OBS"),
        ("2025-09-01", Decimal("-2.0"), "OBS"),
    ]
    assert _values(ok, "DE.ESI")[1] == ("2025-09-01", None, "MISS")
    cases: list[tuple[Any, str]] = [
        (lambda wb: setattr(wb["MONTHLY"], "title", "OTHER"), "MONTHLY"),
        (lambda wb: wb["MONTHLY"].__setitem__("A1", "DATE"), "A1 is not empty"),
        (lambda wb: wb["MONTHLY"].__setitem__("C1", "DE.ESI"), "not unique"),
        (lambda wb: wb["MONTHLY"].__setitem__("C1", "Germany"), "not <COUNTRY>.<SURVEY>"),
        (lambda wb: wb["MONTHLY"].__setitem__("C1", "DE.XXXX"), "requested series 'DE.CONS'"),
        (lambda wb: wb["MONTHLY"].__setitem__("A3", datetime(2025, 8, 31)), "occurs twice"),
    ]
    for mutate, match in cases:
        with pytest.raises(ParseError, match=f"PARSE-01.*{match}"):
            BulkConnector("ec_surveys").parse(_raw(_bcs(mutate), "ec_bcs_monthly"), flt)
    for body in (
        _zip({"readme.txt": b"x"}),
        _zip({"main_indicators_nace2.xlsx": b"x", "sub/main_indicators_nace2.xlsx": b"x"}),
        b"PK\x03\x04junk",
    ):
        with pytest.raises(ParseError, match="PARSE-01"):
            BulkConnector("ec_surveys").parse(_raw(body, "ec_bcs_monthly"), flt)


def test_ecsurvey_non_numeric_text_is_rejected_not_loaded() -> None:
    g = _group("ec_bcs_monthly")
    series = [e for e in g.series if e.key in ("DE.ESI", "DE.CONS", "FR.ESI")]
    flt = series_filter_for(series, "main_indicators_sa_nace2", g.missing_markers)

    def bad(wb: Workbook) -> None:
        wb["MONTHLY"]["B2"] = "n/a"

    out = BulkConnector("ec_surveys").parse(_raw(_bcs(bad), "ec_bcs_monthly"), flt)
    assert [r.reason for r in out.rejected] == ["PARSE-03: non-numeric"]
    assert [v for v in _values(out, "DE.ESI") if v[0] == "2025-08-01"] == []


_ZIP_FAILURES = [
    zlib.error("Error -3 while decompressing data"),
    EOFError("Compressed file ended before the end-of-stream marker"),
    RuntimeError("File is encrypted"),
    NotImplementedError("compression type 99"),
]


@pytest.mark.parametrize("exc", _ZIP_FAILURES, ids=lambda e: type(e).__name__)
def test_faostat_zip_read_errors_are_parse_01(exc: Exception, monkeypatch: Any) -> None:
    # A corrupt deflate stream is hard to build deterministically (CRC errors surface as
    # BadZipFile first), so ZipFile.open is monkeypatched to raise the decompressor errors.
    g = _group("faostat_sofi")
    flt = series_filter_for(g.series, "Food_Security_Data", g.missing_markers)
    body = _zip({"Food_Security_Data_E_All_Data_(Normalized).csv": b"Area,Value\n1,2\n"})

    def boom(self: Any, *a: Any, **k: Any) -> Any:
        raise exc

    monkeypatch.setattr(zipfile.ZipFile, "open", boom)
    with pytest.raises(ParseError, match="PARSE-01: bad zip"):
        BulkConnector("faostat").parse(_raw(body, "faostat_sofi"), flt)


@pytest.mark.parametrize("exc", _ZIP_FAILURES, ids=lambda e: type(e).__name__)
def test_ecsurvey_zip_read_errors_are_parse_01(exc: Exception, monkeypatch: Any) -> None:
    # ZipFile.read is monkeypatched for the same reason as in the FAOSTAT test above.
    g = _group("ec_bcs_monthly")
    flt = series_filter_for(g.series, "main_indicators_sa_nace2", g.missing_markers)
    body = _zip({"main_indicators_nace2.xlsx": b"x"})

    def boom(self: Any, *a: Any, **k: Any) -> Any:
        raise exc

    monkeypatch.setattr(zipfile.ZipFile, "read", boom)
    with pytest.raises(ParseError, match="PARSE-01: bad zip"):
        BulkConnector("ec_surveys").parse(_raw(body, "ec_bcs_monthly"), flt)


@pytest.mark.parametrize(
    "exc",
    [*_ZIP_FAILURES, OSError("disk"), ValueError("bad"), zipfile.BadZipFile("bad")],
    ids=lambda e: type(e).__name__,
)
def test_is_xlsx_returns_false_instead_of_raising(exc: Exception, monkeypatch: Any) -> None:
    body = _zip({"xl/workbook.xml": b"<x/>"})
    assert is_xlsx(body) is True

    def boom(self: Any) -> Any:
        raise exc

    monkeypatch.setattr(zipfile.ZipFile, "namelist", boom)
    assert is_xlsx(body) is False


# ------------------------------------------------------------------ AMECO via DBnomics


def test_ameco_golden_parse() -> None:
    out = _parse(AMECO, "dbnomics_ameco_gap")
    assert [m.series_ref for m in out.metas] == [
        "DEU.1.0.0.0.AVGDGP",
        "FRA.1.0.0.0.AVGDGP",
        "USA.1.0.0.0.AVGDGP",
    ]
    assert all(m.unit_code == "PCT_POT_GDP" and m.frequency == "A" for m in out.metas)
    assert out.metas[0].entity_code == "DEU"
    assert _values(out, "FRA.1.0.0.0.AVGDGP") == [
        ("2023-01-01", Decimal("0.2"), "OBS"),
        ("2024-01-01", Decimal("-0.3"), "OBS"),
        ("2025-01-01", None, "MISS"),
    ]
    assert out.rejected == ()


def _ameco(edit: Any) -> bytes:
    doc = json.loads(AMECO.read_text(encoding="utf-8"))
    edit(doc)
    return json.dumps(doc).encode()


@pytest.mark.parametrize(
    ("edit", "match"),
    [
        (lambda d: d["series"].__setitem__("num_found", 2000), "truncated page"),
        (lambda d: d["series"].__setitem__("offset", 1000), "truncated page"),
        (lambda d: d["series"].pop("limit"), "limit"),
        (lambda d: d.pop("series"), "series.docs"),
        (lambda d: d["series"]["docs"][0].__setitem__("@frequency", "monthly"), "not annual"),
        (lambda d: d["series"]["docs"][0].__setitem__("dataset_code", "OTHER"), "AMECO/AVGDGP"),
        (lambda d: d["series"]["docs"][0]["value"].pop(), "unequal length"),
    ],
)
def test_ameco_layout_drift_fails_closed(edit: Any, match: str) -> None:
    g = _group("dbnomics_ameco_gap")
    flt = series_filter_for(g.series, "AMECO/AVGDGP", g.missing_markers)
    with pytest.raises(ParseError, match=f"PARSE-01.*{match}"):
        DbnomicsConnector().parse(_raw(_ameco(edit), "dbnomics_ameco_gap"), flt)
    with pytest.raises(ParseError, match="PARSE-01"):
        DbnomicsConnector().parse(_raw(b"<html>", "dbnomics_ameco_gap"), flt)


def test_ameco_duplicate_of_unmapped_code_also_fails_closed() -> None:
    g = _group("dbnomics_ameco_gap")
    flt = series_filter_for(g.series, "AMECO/AVGDGP", g.missing_markers)

    def edit(d: Any) -> None:
        extra = json.loads(json.dumps(d["series"]["docs"][0]))
        extra["series_code"] = "ZZZ.1.0.0.0.AVGDGP"
        d["series"]["docs"].extend([extra, json.loads(json.dumps(extra))])
        d["series"]["num_found"] = len(d["series"]["docs"])

    with pytest.raises(ParseError, match=r"PARSE-01.*duplicate series_code ZZZ"):
        DbnomicsConnector().parse(_raw(_ameco(edit), "dbnomics_ameco_gap"), flt)


def test_ameco_published_decimals_follow_json_text_not_float_value() -> None:
    g = _group("dbnomics_ameco_gap")
    flt = series_filter_for(g.series, "AMECO/AVGDGP", g.missing_markers)
    doc = json.loads(AMECO.read_text(encoding="utf-8"))
    doc["series"]["docs"] = [doc["series"]["docs"][0]]
    doc["series"]["num_found"] = 1
    doc["series"]["docs"][0]["value"] = ["@@"]
    doc["series"]["docs"][0]["period"] = ["2023"]
    body = json.dumps(doc).replace('"@@"', "1.50").encode()
    out = DbnomicsConnector().parse(_raw(body, "dbnomics_ameco_gap"), flt)
    assert out.observations[0].value == Decimal("1.50")
    assert out.metas[0].published_decimals == 2


def test_ameco_non_numeric_value_rejected() -> None:
    g = _group("dbnomics_ameco_gap")
    flt = series_filter_for(g.series, "AMECO/AVGDGP", g.missing_markers)
    body = _ameco(lambda d: d["series"]["docs"][0]["value"].__setitem__(0, "n.a."))
    out = DbnomicsConnector().parse(_raw(body, "dbnomics_ameco_gap"), flt)
    assert [r.reason for r in out.rejected] == ["PARSE-03: non-numeric"]


# ------------------------------------------------------------------ plan and fetch


def test_plan_urls_one_full_request_per_dataset() -> None:
    expect = {
        # T64: discovered groups plan the landing page; the file URL is resolved in fetch
        "pinksheet_monthly": "https://www.worldbank.org/en/research/commodity-markets",
        "fao_ffpi": "https://www.fao.org/media/docs/worldfoodsituationlibraries/wfs-library/food_price_indices_data.csv",
        "fao_csdb": "https://www.fao.org/worldfoodsituation/csdb/en/",
        "faostat_sofi": "https://bulks-faostat.fao.org/production/Food_Security_Data_E_All_Data_(Normalized).zip",
        "ec_bcs_monthly": "https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys/download-business-and-consumer-survey-data/time-series_en",
    }
    for group_id, url in expect.items():
        g = _group(group_id)
        specs = BulkConnector(g.source_id).plan(g, FakeState(), "refresh")
        assert [s.url for s in specs] == [url]
        assert specs[0].expect_scope == "complete"
        assert specs[0].fetch_mode == "full"
    g = _group("dbnomics_ameco_gap")
    (spec,) = DbnomicsConnector().plan(g, FakeState(), "refresh")
    assert spec.url == "https://api.db.nomics.world/v22/series/AMECO/AVGDGP"
    assert dict(spec.params) == {"observations": "1", "format": "json", "limit": "1000"}


def test_dbnomics_plan_rejects_bad_config() -> None:
    g = _group("dbnomics_ameco_gap")
    tpl = dict(g.request_template)
    for bad in (
        {**tpl, "params": {"observations": "1"}},  # no limit
        {**tpl, "params": {**tpl["params"], "offset": "1000"}},  # paging not supported
        {**tpl, "datasets": ["AVGDGP"]},  # not PROVIDER/DATASET
        {**tpl, "datasets": []},
    ):
        with pytest.raises(ConnectorConfigError):
            DbnomicsConnector().plan(replace(g, request_template=bad), FakeState(), "refresh")


def _http(handler: Any, base_url: str) -> HttpClient:
    return HttpClient(
        HttpSettings(base_url=base_url, retries=RetryConfig(max=0)),
        repo_url="https://example.invalid/repo",
        clock=Clock(),
        transport=httpx.MockTransport(handler),
    )


def test_xlsx_gets_no_member_date_but_last_modified_wins() -> None:
    body = PINK.read_bytes()
    assert file_date(None, body) is None  # workbook member dates are not a file date
    assert file_date("Tue, 03 Nov 2026 10:00:00 GMT", body) == "2026-11-03"
    assert file_date(None, SOFI.read_bytes()) == "2026-10-15"  # a plain zip still has one
    assert file_date(None, BCS.read_bytes()) == "2026-10-15"
    assert file_date(None, BCS2.read_bytes()) == "2026-10-26"  # zip member date of the real layout


def test_fetch_plain_workbook_marker_and_conditional_request() -> None:
    g = _group("fao_ffpi")
    spec = BulkConnector(g.source_id).plan(g, FakeState(), "refresh")[0]
    seen: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.headers.get("If-None-Match"))
        if req.headers.get("If-None-Match"):
            return httpx.Response(304)
        return httpx.Response(
            200,
            content=PINK.read_bytes(),
            headers={"Last-Modified": "Tue, 03 Nov 2026 10:00:00 GMT"},
        )

    http = _http(handler, "https://www.fao.org/")
    first = BulkConnector(g.source_id).fetch(spec, http, FakeState())
    assert (first.outcome, first.update_marker) == ("new", "2026-11-03")
    second = BulkConnector(g.source_id).fetch(spec, http, FakeState(LatestState(etag='"v1"')))
    assert second.body is None
    assert second.outcome != "new"
    assert seen == [None, '"v1"']


def test_fetch_dbnomics_body_untouched_and_conditional() -> None:
    g = _group("dbnomics_ameco_gap")
    spec = DbnomicsConnector().plan(g, FakeState(), "refresh")[0]
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, content=AMECO.read_bytes())

    http = _http(handler, "https://api.db.nomics.world/")
    result = DbnomicsConnector().fetch(spec, http, FakeState(LatestState(etag='"e"')))
    assert result.body == AMECO.read_bytes()
    assert result.update_marker is None
    assert seen[0].headers.get("If-None-Match") == '"e"'
    assert dict(seen[0].url.params) == {"observations": "1", "format": "json", "limit": "1000"}


def test_csdb_v2_parses_real_layout_blocks() -> None:
    def build(wb: Workbook) -> None:
        ws = wb.active
        ws.title = "CSDB data"
        ws.append(["WORLD CEREAL MARKET"])
        ws.append([None, "Production 1/", "World stock-to-use ratio"])
        ws.append([None, "( . . million tonnes . . )", "( . percent . )"])
        ws.append(["2023/24", 2863.3, 31.5])
        ws.append(["2024/25", 2869.4, 30.1])
        ws.append(["2025/26", 3050.0, 23.7])
        ws.append([None])
        ws.append(["WORLD WHEAT MARKET"])
        ws.append([None, "Production 1/"])

    g = _group("fao_csdb")
    flt = series_filter_for(g.series, "csdb", g.missing_markers)
    out = BulkConnector("fao").parse(_raw(_xlsx(build), "fao_csdb"), flt)
    name = "World cereals stocks-to-use ratio (%)"
    assert [m.series_ref for m in out.metas] == [name]
    assert out.metas[0].unit_code == "PCT"
    assert [(str(o.ref_period_start), o.value_status) for o in out.observations] == [
        ("2023-07-01", "OBS"),
        ("2024-07-01", "EST"),
        ("2025-07-01", "PROJ"),
    ]
    assert out.rejected == ()


def test_ffpi_v2_parses_the_real_layout_with_padding_and_blank_row() -> None:
    real = FIX / "fao" / "ffpi_real_layout.csv"
    out = _parse(real, "fao_ffpi")
    assert [m.series_ref for m in out.metas] == ["Food Price Index"]
    vals = _values(out, "Food Price Index")
    assert vals[0] == ("1990-01-01", Decimal("64.4"), "OBS")
    assert vals[-1] == ("2026-10-01", Decimal("133.9"), "OBS")
    assert len(vals) == 18
    assert not out.rejected
    # v1 cannot read the padded header and the blank row (why v2 exists)
    g = _group("fao_ffpi")
    flt = series_filter_for(g.series, "food_price_indices_data", g.missing_markers)
    v1 = RawObject(
        body=real.read_bytes(),
        source_id="x",
        group_id="fao_ffpi",
        fetched_at=None,  # type: ignore[arg-type]
        parser_id="fao_ffpi_v1@1",
    )
    with pytest.raises(ParseError, match="PARSE-01"):
        BulkConnector("fao").parse(v1, flt)


def test_ecsurvey_discovery_against_landing_excerpt_and_zip_format_check() -> None:
    g = _group("ec_bcs_monthly")
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, FakeState(), "refresh")
    assert spec.resolve is not None
    assert spec.resolve.expect_format == "zip"
    good = (
        "https://ec.europa.eu/economy_finance/db_indicators/surveys/documents/series/"
        "nace2_ecfin_2610/main_indicators_sa_nace2.zip"
    )
    zip_body = BCS2.read_bytes()
    seen: list[str] = []

    def handler(body: bytes) -> Any:
        def h(req: httpx.Request) -> httpx.Response:
            seen.append(str(req.url))
            if req.url.host == "economy-finance.ec.europa.eu":
                return httpx.Response(
                    200, content=LANDING_EXCERPT.read_bytes(), headers={"Content-Type": "text/html"}
                )
            return httpx.Response(200, content=body)

        return h

    settings = HttpSettings(
        base_url="https://ec.europa.eu/",
        retries=RetryConfig(max=0),
        extra_hosts=frozenset(spec.resolve.allowed_hosts),
    )

    def client(body: bytes) -> HttpClient:
        return HttpClient(
            settings,
            repo_url="https://example.invalid/repo",
            clock=Clock(),
            transport=httpx.MockTransport(handler(body)),
        )

    res = conn.fetch(spec, client(zip_body), FakeState())
    assert res.resolved_url == good  # the second (industry_total) anchor does not match
    assert seen == [spec.url, good]
    assert res.body == zip_body
    assert res.update_marker == "2026-10-26"
    with pytest.raises(DiscoveryFailed, match="not a zip archive"):
        conn.fetch(spec, client(b"<html>not a zip</html>"), FakeState())
