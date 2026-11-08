"""OP-04 operator probe (2026-11-06): golden parses of the REAL recorded responses, geo=DE only.

Each fixture is the unmodified body of one request built from the group's own ``plan()`` and
narrowed to ``geo=DE`` (World Bank: ``DEU``, ``per_page=100``). Offline, no network.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import RawObject, SeriesFilter
from macro_monitor.ingestion.connectors.sdmx import load_series_entries, series_filter_for
from macro_monitor.registry.config import load_yaml

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
EU = ROOT / "tests" / "fixtures" / "raw" / "eurostat"
WB = ROOT / "tests" / "fixtures" / "raw" / "worldbank"
FETCHED = datetime(2026, 11, 6, tzinfo=UTC)

#: group, dataset, fixture, parser, DE series key, first (end, value), last (end, value, status)
EUROSTAT_CASES = [
    (
        "eurostat_sts",
        "sts_trtu_m",
        "probe_sts_trtu_m_DE_2026-11-06",
        "jsonstat_v1@1",
        "M.VOL_SLS.G47.SCA.I21.DE",
        393,
        (date(1994, 1, 31), Decimal("88.3")),
        (date(2026, 9, 30), Decimal("98.1"), "PROV"),
    ),
    (
        "eurostat_hicp",
        "prc_hicp_minr",
        "probe_prc_hicp_minr_DE_2026-11-06",
        "jsonstat_v1@1",
        "M.I25.TOTAL.DE",
        370,
        (date(1996, 1, 31), Decimal("56.95")),
        (date(2026, 10, 31), Decimal("103.80"), "EST"),
    ),
    (
        "eurostat_gov_debt",
        "gov_10q_ggdebt",
        "probe_gov_10q_ggdebt_DE_2026-11-06",
        "jsonstat_v1@1",
        "Q.GD.S13.PC_GDP.DE",
        106,
        (date(2000, 3, 31), Decimal("60.4")),
        (date(2026, 6, 30), Decimal("63.4"), "PROV"),
    ),
    (
        "eurostat_gdp_q",
        "namq_10_gdp",
        "probe_namq_10_gdp_DE_2026-11-06",
        "jsonstat_v2@2",
        "Q.CP_MNAC.SCA.B1GQ.DE",
        143,
        (date(1991, 3, 31), Decimal("389792.0")),
        (date(2026, 9, 30), Decimal("1189127.0"), "PROV"),
    ),
]


def _entries(group: str) -> Any:
    return load_series_entries(ROOT / "config" / "series_map" / f"{group}.yaml")


def _expect(group: str, key: str) -> dict[str, Any]:
    doc = load_yaml(ROOT / "config" / "series_map" / f"{group}.yaml")
    return next(e["expect"] for e in doc["series"] if e["key"] == key)


def _raw(path: Path, group: str, source: str, parser: str) -> RawObject:
    return RawObject(
        body=path.read_bytes(),
        source_id=source,
        group_id=group,
        fetched_at=FETCHED,
        parser_id=parser,
    )


@pytest.mark.parametrize(
    ("group", "dataset", "fixture", "parser", "key", "n", "first", "last"), EUROSTAT_CASES
)
def test_eurostat_probe_golden_parse(
    group: str,
    dataset: str,
    fixture: str,
    parser: str,
    key: str,
    n: int,
    first: tuple[date, Decimal],
    last: tuple[date, Decimal, str],
) -> None:
    flt = series_filter_for(_entries(group), dataset, (":",))
    out = registry.resolve(parser)(_raw(EU / f"{fixture}.json", group, "eurostat", parser), flt)
    assert out.rejected == ()
    obs = sorted(
        (o for o in out.observations if o.series_ref == key), key=lambda o: o.ref_period_end
    )
    assert len(obs) == n
    assert (obs[0].ref_period_end, obs[0].value) == first
    assert (obs[-1].ref_period_end, obs[-1].value, obs[-1].value_status) == last
    meta = next(m for m in out.metas if m.series_ref == key)
    exp = _expect(group, key)
    assert meta.frequency == exp["frequency"]
    assert meta.unit_code == exp["unit"]
    assert meta.seasonal_adjustment == exp["seasonal_adjustment"]
    assert meta.price_basis == exp["price_basis"]
    assert meta.flow_basis == exp.get("flow_basis", "NA")


def test_hicp_probe_all_three_aggregates_and_flags() -> None:
    flt = series_filter_for(_entries("eurostat_hicp"), "prc_hicp_minr", (":",))
    path = EU / "probe_prc_hicp_minr_DE_2026-11-06.json"
    out = registry.resolve("jsonstat_v1@1")(
        _raw(path, "eurostat_hicp", "eurostat", "jsonstat_v1@1"), flt
    )
    refs = {o.series_ref for o in out.observations}
    assert refs == {"M.I25.TOTAL.DE", "M.I25.TOT_X_NRG_FOOD.DE", "M.I25.CP01.DE"}
    assert {m.unit_code for m in out.metas} == {"I25"}
    # flags b (break) and d (definition differs) keep OBS; e (estimated) maps to EST
    core = {
        o.ref_period_end: o for o in out.observations if o.series_ref == "M.I25.TOT_X_NRG_FOOD.DE"
    }
    for end, value, status, flag in [
        (date(2016, 12, 31), Decimal("80.90"), "OBS", "d"),
        (date(2017, 1, 31), Decimal("79.67"), "OBS", "b"),
        (date(2026, 10, 31), Decimal("103.55"), "EST", "e"),
    ]:
        obs = core[end]
        assert (obs.value, obs.value_status) == (value, status)
        assert flag in repr(obs.source_flags)
    est = [o for o in out.observations if o.value_status == "EST"]
    assert {(o.series_ref, o.ref_period_end) for o in est} == {
        ("M.I25.TOTAL.DE", date(2026, 10, 31)),
        ("M.I25.TOT_X_NRG_FOOD.DE", date(2026, 10, 31)),
    }
    assert {o.value_status for o in out.observations} == {"OBS", "EST"}
    assert out.source_updated == "2026-11-04T11:00:00+0100"


def test_sts_inpr_m_probe_pins_empty_cube_for_prod() -> None:
    """indic_bt=PROD returns an EMPTY cube (size 0 on indic_bt, no values): the code is wrong."""
    doc = json.loads((EU / "probe_sts_inpr_m_DE_2026-11-06.json").read_bytes())
    assert doc["id"] == ["freq", "indic_bt", "nace_r2", "s_adj", "unit", "geo", "time"]
    assert doc["size"][1] == 0
    assert doc["value"] == {}
    flt = series_filter_for(_entries("eurostat_sts"), "sts_inpr_m", (":",))
    raw = _raw(
        EU / "probe_sts_inpr_m_DE_2026-11-06.json", "eurostat_sts", "eurostat", "jsonstat_v1@1"
    )
    assert registry.resolve("jsonstat_v1@1")(raw, flt).observations == ()


def test_probe_de_series_keys_appear_in_series_map() -> None:
    for group, dataset, _fixture, _parser, key, *_ in EUROSTAT_CASES:
        doc = load_yaml(ROOT / "config" / "series_map" / f"{group}.yaml")
        hits = [e for e in doc["series"] if e["key"] == key]
        assert len(hits) == 1, key
        assert hits[0]["dataset"] == dataset


def test_probe_dimension_orders_match_series_keys() -> None:
    expected = {
        "probe_sts_trtu_m_DE_2026-11-06": "freq.indic_bt.nace_r2.s_adj.unit.geo",
        "probe_prc_hicp_minr_DE_2026-11-06": "freq.unit.coicop18.geo",
        "probe_gov_10q_ggdebt_DE_2026-11-06": "freq.na_item.sector.unit.geo",
        "probe_namq_10_gdp_DE_2026-11-06": "freq.unit.s_adj.na_item.geo",
    }
    for name, order in expected.items():
        doc = json.loads((EU / f"{name}.json").read_bytes())
        assert ".".join(doc["id"][:-1]) == order
        assert doc["id"][-1] == "time"
    # quarterly period labels are YYYY-Qn, monthly YYYY-MM
    q = json.loads((EU / "probe_namq_10_gdp_DE_2026-11-06.json").read_bytes())
    assert next(iter(q["dimension"]["time"]["category"]["index"])) == "1991-Q1"


@pytest.mark.parametrize(
    ("indicator", "stem", "unit", "currency", "decimals", "last_value"),
    [
        ("NY.GDP.MKTP.CN", "cn", "LCU", None, 0, Decimal("4469910000000")),
        ("NY.GDP.MKTP.CD", "cd", "USD", "USD", 2, Decimal("5050922925047.05")),
    ],
)
def test_worldbank_support_probe_golden_parse(
    indicator: str,
    stem: str,
    unit: str,
    currency: str | None,
    decimals: int,
    last_value: Decimal,
) -> None:
    key = f"{indicator}.DEU"
    flt = SeriesFilter(
        series_refs=frozenset({key}), discover=False, missing_markers=frozenset({".."})
    )
    path = WB / f"probe_ny_gdp_mktp_{stem}_DE_2026-11-06.json"
    rows = json.loads(path.read_bytes())[1]
    assert {r["countryiso3code"] for r in rows} == {"DEU"}
    out = registry.resolve("worldbank_v2@2")(
        _raw(path, "worldbank_support", "worldbank", "worldbank_v2@2"), flt
    )
    assert out.rejected == ()
    assert out.source_updated == "2026-10-08"
    obs = sorted(out.observations, key=lambda o: o.ref_period_end)
    assert len(obs) == 35
    assert (obs[0].ref_period_end, obs[-1].ref_period_end) == (
        date(1991, 12, 31),
        date(2025, 12, 31),
    )
    assert obs[-1].value == last_value
    meta = out.metas[0]
    exp = _expect("worldbank_support", key)
    assert (meta.frequency, meta.unit_code, meta.currency_code) == ("A", unit, currency)
    assert meta.published_decimals == decimals
    assert (meta.frequency, meta.unit_code) == (exp["frequency"], exp["unit"])
    # Consistency check against the parser's own hard-coded table, NOT evidence from the source:
    # the recorded response `unit` is empty, so unit and flow basis are parser-assigned.
    assert all(r.get("unit") in ("", None) for r in rows)
    assert meta.flow_basis == exp["flow_basis"] == "PERIOD_FLOW"


def test_probe_sidecars_match_recorded_bytes() -> None:
    import yaml

    for folder in (EU, WB):
        for meta in sorted(folder.glob("probe_*_DE_2026-11-06.meta.yaml")):
            side = yaml.safe_load(meta.read_text())
            body = meta.with_name(meta.name.replace(".meta.yaml", ".json")).read_bytes()
            assert side["sha256"] == hashlib.sha256(body).hexdigest()
            assert side["http_status"] == 200
            assert side["synthetic"] is False
            url = side["source_url"]
            if folder == EU:
                assert url.count("geo=DE") == 1
                assert "geo=DE&" in url + "&" or url.endswith("geo=DE")
                doc = json.loads(body)
                assert list(doc["dimension"]["geo"]["category"]["index"]) == ["DE"]
            else:
                assert url.count("/country/DEU/") == 1
                assert {r["countryiso3code"] for r in json.loads(body)[1]} == {"DEU"}
