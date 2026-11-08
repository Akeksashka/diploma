"""T23: Eurostat connector, slice config and series map (AC-ING-20, AC-CFG-2)."""

from __future__ import annotations

import inspect
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, get_type_hints
from urllib.parse import parse_qsl, urlsplit

import httpx
import pytest

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import (
    Connector,
    GroupConfig,
    RawObject,
    SeriesFilter,
    SeriesMapEntry,
)
from macro_monitor.ingestion.connectors import sdmx
from macro_monitor.ingestion.connectors.sdmx import (
    ConnectorConfigError,
    EurostatConnector,
    load_series_entries,
    series_filter_for,
    update_marker,
)
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.registry.config import load_sources, load_yaml
from macro_monitor.storage.manifest import LatestState

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "raw" / "eurostat" / "une_rt_m_synthetic.json"
LIVE = ROOT / "tests" / "fixtures" / "raw" / "eurostat" / "une_rt_m_live_20261104.json"
MAP = ROOT / "config" / "series_map" / "eurostat_labour.yaml"
BASE = "https://ec.europa.eu/eurostat/api/dissemination/"


class FakeState:
    def __init__(self, latest: LatestState | None = None) -> None:
        self._latest = latest or LatestState()

    def latest(self, source_id: str, request_key: str) -> LatestState:
        return self._latest


def _group() -> GroupConfig:
    conf = load_sources(ROOT / "config" / "sources.yaml", env_example=ROOT / ".env.example")
    source = conf.data["sources"][0]
    return GroupConfig.from_config(source, source["groups"][0], load_series_entries(MAP))


def _http(handler: Any) -> HttpClient:
    class Clock:
        def monotonic(self) -> float:
            return 0.0

        def sleep(self, seconds: float) -> None:
            return None

        def wall(self) -> datetime:
            return datetime(2026, 11, 1, tzinfo=UTC)

    return HttpClient(
        HttpSettings(base_url=BASE, retries=RetryConfig(max=0)),
        repo_url="https://example.invalid/repo",
        clock=Clock(),
        transport=httpx.MockTransport(handler),
    )


# ------------------------------------------------------------------ AC-ING-20


def test_connector_protocol_has_exactly_the_adr_013_members() -> None:
    members = {n for n in vars(Connector) if not n.startswith("_") or n == "__annotations__"} - {
        "__annotations__"
    }
    assert members == {"plan", "fetch", "parse"}  # source_id is an annotation, not a callable
    assert "source_id" in get_type_hints(Connector)
    assert not hasattr(Connector, "describe_series")
    assert not hasattr(EurostatConnector, "describe_series")


def test_eurostat_connector_signatures_match_the_protocol() -> None:
    public = {n for n in dir(EurostatConnector) if not n.startswith("_")}
    assert public == {"source_id", "plan", "fetch", "parse"}
    for name in ("plan", "fetch", "parse"):
        want = list(inspect.signature(getattr(Connector, name)).parameters)
        got = list(inspect.signature(getattr(EurostatConnector, name)).parameters)
        assert got == want
    assert EurostatConnector.source_id == "eurostat"


FIXTURE_ENTITIES = frozenset({"DEU", "FRA", "ESP"})  # the recorded captures hold three countries


def _fixture_entries() -> list[SeriesMapEntry]:
    """Series-map entries covered by the recorded captures (the shipped map now has 28)."""
    return [e for e in load_series_entries(MAP) if e.entity in FIXTURE_ENTITIES]


def test_non_discovery_fixture_returns_metas_and_observations() -> None:
    entries = _fixture_entries()
    assert len(entries) == 3
    out = EurostatConnector().parse(
        RawObject(
            body=FIXTURE.read_bytes(),
            source_id="eurostat",
            group_id="eurostat_labour",
            fetched_at=datetime(2026, 11, 1, tzinfo=UTC),
            parser_id="jsonstat_v1@1",
        ),
        series_filter_for(entries, "une_rt_m", [":"]),
    )
    assert len(out.metas) == 3
    assert out.observations
    assert out.source_updated == "2026-10-30T11:00:00+0100"
    assert {m.series_ref for m in out.metas} == {e.key for e in entries}


def test_live_capture_parses_with_the_series_map_keys() -> None:
    """Real Eurostat bytes (OP-04): dimension order and keys match config/series_map."""
    entries = _fixture_entries()
    assert len(entries) == 3
    out = EurostatConnector().parse(
        RawObject(
            body=LIVE.read_bytes(),
            source_id="eurostat",
            group_id="eurostat_labour",
            fetched_at=datetime(2026, 11, 4, tzinfo=UTC),
            parser_id="jsonstat_v1@1",
        ),
        series_filter_for(entries, "une_rt_m", [":"]),
    )
    assert {m.series_ref for m in out.metas} == {e.key for e in entries}
    assert out.source_updated == "2026-10-30T11:00:00+0100"
    assert len(out.observations) > 1000


def test_live_capture_sidecar_hash_matches() -> None:
    import hashlib

    side = load_yaml(LIVE.with_suffix(".meta.yaml"))
    assert side["sha256"] == hashlib.sha256(LIVE.read_bytes()).hexdigest()
    assert "sinceTimePeriod=1991-01" in side["source_url"]


def test_discovery_fixture_yields_metas_only() -> None:
    out = EurostatConnector().parse(
        RawObject(
            body=FIXTURE.read_bytes(),
            source_id="eurostat",
            group_id="eurostat_labour",
            fetched_at=datetime(2026, 11, 1, tzinfo=UTC),
        ),
        SeriesFilter(series_refs=frozenset(), discover=True),
    )
    assert out.metas
    assert out.observations == ()


# ------------------------------------------------------------------ plan


def test_plan_carries_time_filter_country_list_and_fixed_filters() -> None:
    specs = EurostatConnector().plan(_group(), FakeState(), "refresh")
    assert len(specs) == 1
    spec = specs[0]
    parts = urlsplit(spec.url)
    assert parts.scheme == "https"
    assert parts.path == "/eurostat/api/dissemination/statistics/1.0/data/une_rt_m"
    q = parse_qsl(parts.query)
    assert ("sinceTimePeriod", "1991-01") in q
    assert sorted(v for k, v in q if k == "geo") == sorted(
        sdmx.geo_code(e.key) for e in load_series_entries(MAP)
    )
    assert len([v for k, v in q if k == "geo"]) == 28  # eurostat_labour widened to 28 countries
    for k, v in (
        ("freq", "M"),
        ("s_adj", "SA"),
        ("age", "TOTAL"),
        ("unit", "PC_ACT"),
        ("sex", "T"),
    ):
        assert (k, v) in q
    assert (spec.fetch_mode, spec.expect_scope) == ("full", "complete")
    assert spec.source_id == "eurostat"
    assert spec.group_id == "eurostat_labour"


def test_plan_is_deterministic_and_key_depends_on_the_url() -> None:
    a = EurostatConnector().plan(_group(), FakeState(), "refresh")
    b = EurostatConnector().plan(_group(), FakeState(), "catchup")
    assert a == b
    assert len(a[0].request_key) == 64


def test_plan_rejects_a_template_without_time_filter_or_geo() -> None:
    g = _group()
    tpl = dict(g.request_template)
    tpl["params"] = {"format": "JSON", "geo": "{entities}"}
    with pytest.raises(ConnectorConfigError):
        EurostatConnector().plan(_replace(g, request_template=tpl), FakeState(), "refresh")
    tpl["params"] = {"format": "JSON", "sinceTimePeriod": "1991-01"}
    with pytest.raises(ConnectorConfigError):
        EurostatConnector().plan(_replace(g, request_template=tpl), FakeState(), "refresh")


def test_plan_rejects_incremental_mode() -> None:
    with pytest.raises(ConnectorConfigError):
        EurostatConnector().plan(
            _replace(_group(), mode_default="incremental", fetch_scope="partial"),
            FakeState(),
            "refresh",
        )


def _replace(g: GroupConfig, **kw: Any) -> GroupConfig:
    from dataclasses import replace

    return replace(g, **kw)


# ------------------------------------------------------------------ fetch


def test_fetch_returns_bytes_untouched_and_reads_updated_marker() -> None:
    body = FIXTURE.read_bytes()
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, content=body, headers={"ETag": '"e1"'})

    spec = EurostatConnector().plan(_group(), FakeState(), "refresh")[0]
    result = EurostatConnector().fetch(spec, _http(handler), FakeState())
    assert result.outcome == "new"
    assert result.body == body  # byte-for-byte
    assert result.update_marker == "2026-10-30T11:00:00+0100"
    assert result.etag == '"e1"'
    assert len(seen) == 1
    q = parse_qsl(seen[0].url.query.decode())
    assert ("sinceTimePeriod", "1991-01") in q
    assert q.count(("geo", "DE")) == 1


def test_fetch_sends_stored_validators_and_passes_304_through() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["If-None-Match"] == '"e1"'
        return httpx.Response(304)

    spec = EurostatConnector().plan(_group(), FakeState(), "refresh")[0]
    state = FakeState(LatestState(raw_id=1, sha256="a" * 64, etag='"e1"'))
    result = EurostatConnector().fetch(spec, _http(handler), state)
    assert result.outcome == "not_modified"
    assert result.body is None
    assert result.update_marker is None


def test_fetch_keeps_non_json_body_untouched() -> None:
    body = b"\xff not json"
    spec = EurostatConnector().plan(_group(), FakeState(), "refresh")[0]
    result = EurostatConnector().fetch(
        spec, _http(lambda r: httpx.Response(200, content=body)), FakeState()
    )
    assert result.body == body
    assert result.update_marker is None


def test_update_marker_probe() -> None:
    assert update_marker(b'{"updated": "2026-01-01T00:00:00+0100"}') == "2026-01-01T00:00:00+0100"
    assert update_marker(b'{"x": 1}') is None
    assert update_marker(b"[1]") is None
    assert update_marker(b"\xff") is None


# ------------------------------------------------------------------ config (AC-CFG-2, T23)


def test_slice_config_validates_with_parser_and_series_map_checks() -> None:
    conf = load_sources(
        ROOT / "config" / "sources.yaml",
        env_example=ROOT / ".env.example",
        project_root=ROOT,
        check_parsers=True,
    )
    (source,) = (s for s in conf.data["sources"] if s["id"] == "eurostat")
    assert source["kind"] == "sdmx"
    assert source["publish_site"] == "public"
    assert source["archive"] == "public"
    assert source["licence"]["redistribution_of_raw"] == "allowed"
    assert source["licence"]["id"]
    assert source["licence"]["attribution"]
    group = source["groups"][
        0
    ]  # T53 appended further Eurostat groups (test_ingestion_eurostat_t53)
    assert group["id"] == "eurostat_labour"
    assert group["request_template"]["params"]["sinceTimePeriod"] == "1991-01"


def test_ac_cfg_2_parser_resolves_in_the_registry_and_map_indicators_exist() -> None:
    source = load_yaml(ROOT / "config" / "sources.yaml")["sources"][0]
    group = source["groups"][0]
    assert (ROOT / group["series_map"]).is_file()
    assert group["parser"] == "macro_monitor.ingestion.parsers.jsonstat_v1:parse"
    assert registry.resolve(sdmx.PARSER_ID)  # the id used by the connector is released

    indicators = {i["id"]: i for i in load_yaml(ROOT / "config" / "indicators.yaml")["indicators"]}
    doc = load_yaml(MAP)
    assert len(doc["series"]) >= group["expected_series_min"]
    for e in doc["series"]:
        assert e["indicator"] in indicators
        assert indicators[e["indicator"]]["priority"] != "dropped"
        assert e["indicator"] == "M09"
        assert e["role"] == "headline"
        assert e["expect"]["seasonal_adjustment"] == "SA"  # rule 8 is satisfied even for LEVEL
        assert e["expect"]["frequency"] == "M"


def test_series_map_keys_match_the_fixture_series_and_geo_codes() -> None:
    entries = load_series_entries(MAP)
    assert len(entries) == 28
    assert {"DEU", "FRA", "ESP"} <= {e.entity for e in entries}
    assert {"DE", "FR", "ES"} <= {sdmx.geo_code(e.key) for e in entries}
    assert len({sdmx.geo_code(e.key) for e in entries}) == len(entries)
    assert len({e.key for e in entries}) == len(entries)


def test_release_calendar_covers_every_group() -> None:
    cal = load_yaml(ROOT / "config" / "release_calendar.yaml")
    groups = {
        g["id"] for s in load_yaml(ROOT / "config" / "sources.yaml")["sources"] for g in s["groups"]
    }
    assert groups <= set(cal)
    entry = cal["eurostat_labour"]
    assert entry["frequency"] == "M"
    assert entry["typical_lag_days"] > 0
    assert entry["tolerance_days"] > 0


# ------------------------------------------------------------------ network probe (operator-run)


@pytest.mark.network
def test_live_probe_eurostat_updated_marker() -> None:
    import os

    if os.environ.get("MM_ALLOW_NETWORK") != "1":
        pytest.skip("MM_ALLOW_NETWORK=1 not set")
    spec = EurostatConnector().plan(_group(), FakeState(), "refresh")[0]
    settings = HttpSettings.from_source(load_yaml(ROOT / "config" / "sources.yaml")["sources"][0])
    with HttpClient(settings, repo_url="https://example.invalid/repo") as http:
        result = EurostatConnector().fetch(spec, http, FakeState())
    assert result.outcome == "new"
    assert result.body
    assert result.update_marker
