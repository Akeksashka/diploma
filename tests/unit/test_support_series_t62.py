"""T62: support-series maps X01/X02, M14/X03 known gaps and COMP-05 reasons on mapped flow_basis.

Offline. The recorded DE probes of 2026-11-06 (namq_10_gdp CP_MNAC and NY.GDP.MKTP.CN, OP-04) drive
the fixture-chained COMP-05 test and the quarterly-sum vs WDI consistency check; the other COMP-05
cases use the ``flow_basis`` declared in the shipped series maps and synthetic values.
"""

from __future__ import annotations

import calendar
import json
import re
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from macro_monitor.analytics import transforms_denominator as td
from macro_monitor.analytics.transforms_denominator import EntityContext, SupportPoint
from macro_monitor.ingestion.base import GroupConfig, RawObject
from macro_monitor.ingestion.connectors.sdmx import (
    PARSER_ID,
    EurostatConnector,
    load_series_entries,
    series_filter_for,
)
from macro_monitor.models.enums import Frequency
from macro_monitor.registry.config import load_sources, load_yaml
from macro_monitor.registry.sync import MapEntry, load_config

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
D = Decimal
T62_GROUPS = ("worldbank_support", "eurostat_gdp_q")


@pytest.fixture(scope="module")
def entries() -> list[MapEntry]:
    cfg = load_config(ROOT)
    return [e for e in cfg.map_entries if e.group_id in T62_GROUPS]


def test_every_x01_x02_series_declares_period_flow(entries: list[MapEntry]) -> None:
    assert entries
    assert {e.indicator for e in entries} == {"X01", "X02"}
    for e in entries:
        assert e.expect.get("flow_basis") == "PERIOD_FLOW", (e.group_id, e.key)


def test_counts_and_frequencies(entries: list[MapEntry]) -> None:
    by = {(e.group_id, e.indicator, e.expect["frequency"]) for e in entries}
    assert by == {
        ("worldbank_support", "X01", "A"),
        ("worldbank_support", "X02", "A"),
        ("eurostat_gdp_q", "X01", "Q"),
    }
    assert sum(e.group_id == "eurostat_gdp_q" for e in entries) == 27
    assert sum(e.group_id == "worldbank_support" for e in entries) == 84


def test_quarterly_is_headline_annual_x01_is_fallback(entries: list[MapEntry]) -> None:
    for e in entries:
        if e.group_id == "eurostat_gdp_q":
            assert e.role == "headline"
        elif e.indicator == "X01":
            assert e.role == "fallback"
        else:
            assert e.role == "headline"


def test_t62_groups_live_in_existing_sources_and_new_sources_are_not_enabled() -> None:
    src = load_yaml(ROOT / "config" / "sources.yaml")
    owners = {
        g["id"]: s["id"]
        for s in src["sources"]
        for g in s.get("groups", [])
        if g["id"] in T62_GROUPS
    }
    assert owners == {"worldbank_support": "worldbank", "eurostat_gdp_q": "eurostat"}
    for s in src["sources"]:
        for g in s.get("groups", []):
            if g["id"] in T62_GROUPS:
                assert g["reestimating"] is False
                # T137 (ADR-027): the unprobed T62 groups are parked by the group-level key
                assert g["enabled"] is False
                assert g["note"]


def test_m14_and_x03_stay_known_gaps_without_a_monthly_route() -> None:
    gaps = load_yaml(ROOT / "config" / "known_gaps.yaml")["known_gaps"]
    cfg = load_config(ROOT)
    ents = load_yaml(ROOT / "config" / "entities.yaml")["entities"]
    countries = {e["id"] for e in ents if e["kind"] == "country"}
    assert len(countries) == 42
    assert not countries & {"EA", "EU27", "WLD"}
    eurostat_q = {e.entity for e in cfg.map_entries if e.group_id == "eurostat_gdp_q"}
    assert len(eurostat_q) == 27

    def covered(ind: str) -> list[str]:
        return [g["entity"] for g in gaps if g["indicator"] == ind]

    for ind, expected in (
        ("M14", countries),
        ("X03", countries),
        ("X01", countries - eurostat_q),
    ):
        got = covered(ind)
        assert len(got) == len(set(got)), ind  # no duplicate gap entries
        assert set(got) == expected, ind
        assert all(g["reason"].strip() for g in gaps if g["indicator"] == ind), ind
    assert len(covered("X01")) == 15
    assert all("RESERVE_COVER stays n/a" in g["reason"] for g in gaps if g["indicator"] == "M14")
    # a known gap must not also be mapped as a headline
    headlines = {(e.indicator, e.entity) for e in cfg.map_entries if e.role == "headline"}
    gap_pairs = {
        (g["indicator"], g["entity"]) for g in gaps if g["indicator"] in ("M14", "X03", "X01")
    }
    assert not (gap_pairs & headlines)


def test_unit_seed_migration_exists() -> None:
    mig = ROOT / "src/macro_monitor/storage/migrations/0015_unit_seed_t62_gdp_levels.sql"
    sql = re.sub(r"--[^\n]*", "", mig.read_text())
    inserts = [st for st in sql.split(";") if "CP_MNAC" in st]
    assert inserts, "0015 must seed CP_MNAC"
    assert any(
        re.search(r"insert\s+into\s+ref\.unit", st, re.I)
        and re.search(r"on\s+conflict[^;]*do\s+nothing", st, re.I)
        for st in inserts
    )


# ---- COMP-05 reasons with the flow_basis the maps declare ------------------------------------


def _me(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def _trade(basis: str = "PERIOD_FLOW") -> list[SupportPoint]:
    out = []
    y, m = 2025, 7
    for _ in range(12):
        out.append(SupportPoint(_me(y, m), D(10), Frequency.M, basis, "EUR"))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _gdp_q(basis: str) -> list[SupportPoint]:
    ends = [date(2025, 6, 30), date(2025, 9, 30), date(2025, 12, 31), date(2026, 3, 31)]
    return [SupportPoint(e, D(250), Frequency.Q, basis, "EUR") for e in ends]


AT = date(2026, 6, 30)
CTX = EntityContext(cpi_yoy=D(5), lcu_currency="EUR")


def test_mapped_basis_sums_as_a_period_flow(entries: list[MapEntry]) -> None:
    basis = next(e for e in entries if e.group_id == "eurostat_gdp_q").expect["flow_basis"]
    r = td.sum12_pct_gdp(_trade(), _gdp_q(basis), AT, ctx=CTX)
    assert r.value == D(12)
    assert r.reason is None


@pytest.mark.parametrize(
    ("basis", "reason"),
    [("ANNUALISED_RATE", td.ANNUALISED_DENOMINATOR), ("STOCK", td.INVALID_FLOW_BASIS)],
)
def test_comp05_when_basis_is_not_period_flow(basis: str, reason: str) -> None:
    r = td.sum12_pct_gdp(_trade(), _gdp_q(basis), AT, ctx=CTX)
    assert r.value is None
    assert r.reason == reason
    assert r.comp05


def test_comp05_missing_denominator_is_never_substituted() -> None:
    r = td.sum12_pct_gdp(_trade(), [], AT, ctx=CTX)
    assert r.value is None
    assert r.reason == td.MISSING_OR_STALE
    assert r.comp05


# ---- fixture-chained COMP-05: real DE probe bytes -> parser -> SupportPoint -> guard ----------

EU_FX = ROOT / "tests" / "fixtures" / "raw" / "eurostat" / "probe_namq_10_gdp_DE_2026-11-06.json"
WB_FX = (
    ROOT / "tests" / "fixtures" / "raw" / "worldbank" / "probe_ny_gdp_mktp_cn_DE_2026-11-06.json"
)
DE_KEY = "Q.CP_MNAC.SCA.B1GQ.DE"


def _de_points() -> list[SupportPoint]:
    sources = load_sources(
        ROOT / "config" / "sources.yaml",
        env_example=ROOT / ".env.example",
        project_root=ROOT,
        check_parsers=True,
    )
    source = next(s for s in sources.data["sources"] if s["id"] == "eurostat")
    group = next(g for g in source["groups"] if g["id"] == "eurostat_gdp_q")
    cfg = GroupConfig.from_config(source, group, load_series_entries(ROOT / group["series_map"]))
    raw = RawObject(
        body=EU_FX.read_bytes(),
        source_id="eurostat",
        group_id="eurostat_gdp_q",
        fetched_at=datetime(2026, 11, 6, tzinfo=UTC),
        parser_id=PARSER_ID,
    )
    out = EurostatConnector().parse(raw, series_filter_for(cfg.series, "namq_10_gdp", ()))
    # flow_basis is declared by the series map (the JSON-stat parser leaves it NA)
    basis = next(
        e for e in load_config(ROOT).map_entries if e.group_id == group["id"] and e.key == DE_KEY
    ).expect["flow_basis"]
    return [
        SupportPoint(o.ref_period_end, o.value, Frequency.Q, basis, "EUR")
        for o in out.observations
        if o.series_ref == DE_KEY
    ]


def _trade_ending(y: int, m: int) -> list[SupportPoint]:
    out = []
    for _ in range(12):
        out.append(SupportPoint(_me(y, m), D(10), Frequency.M, "PERIOD_FLOW", "EUR"))
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out[::-1]


def test_probe_chain_flow_basis_drives_comp05_reason() -> None:
    pts = _de_points()
    assert pts
    assert max(p.period_end for p in pts) == date(2026, 9, 30)
    assert {p.flow_basis for p in pts} == {"PERIOD_FLOW"}
    at = date(2026, 9, 30)
    num = _trade_ending(2026, 9)
    ok = td.sum12_pct_gdp(num, pts, at, ctx=CTX)
    assert ok.value is not None
    assert ok.reason is None
    for basis, reason in (
        ("ANNUALISED_RATE", td.ANNUALISED_DENOMINATOR),
        ("STOCK", td.INVALID_FLOW_BASIS),
    ):
        relabelled = [
            SupportPoint(p.period_end, p.value, p.frequency, basis, p.currency) for p in pts
        ]
        r = td.sum12_pct_gdp(num, relabelled, at, ctx=CTX)
        assert (r.value, r.reason) == (None, reason)
    far = date(2028, 9, 30)
    num_far = _trade_ending(2028, 9)
    # default guard: the age limit trips first; with a looser age the stale limit gives
    # missing_or_stale
    r = td.sum12_pct_gdp(num_far, pts, far, ctx=CTX)
    assert (r.value, r.reason) == (None, td.DENOMINATOR_AGE)
    loose = td.GuardConfig(max_denominator_age_days=100_000)
    r = td.sum12_pct_gdp(num_far, pts, far, ctx=CTX, cfg=loose)
    assert (r.value, r.reason) == (None, td.MISSING_OR_STALE)


def test_de_2025_quarters_sum_to_the_wdi_annual_not_four_times() -> None:
    """Research F1: ratio near 1.015 means a period level; near 4 would mean annualised."""
    q2025 = [p.value for p in _de_points() if p.period_end.year == 2025]
    assert len(q2025) == 4
    assert None not in q2025
    eurostat_eur = sum(v for v in q2025 if v is not None) * D(1_000_000)  # million EUR
    wb = json.loads(WB_FX.read_bytes())[1]
    wdi = D(str(next(r["value"] for r in wb if r["date"] == "2025")))
    ratio = eurostat_eur / wdi
    assert abs(ratio - 1) <= D("0.05"), ratio
