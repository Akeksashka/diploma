"""T56: ECB connector (synthetic fixture; offline)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import httpx
import pytest

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import GroupConfig, RawObject, SeriesFilter
from macro_monitor.ingestion.connectors.ecb import (
    EcbConnector,
    EcbSeriesEntry,
    load_series_entries,
)
from macro_monitor.ingestion.connectors.sdmx import ConnectorConfigError, series_filter_for
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.registry.config import load_sources, load_yaml
from macro_monitor.storage.manifest import LatestState

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "raw" / "ecb" / "irs_synthetic.csv"
MAP = ROOT / "config" / "series_map" / "ecb_yields.yaml"
BASE = "https://data-api.ecb.europa.eu/service/"


class FakeState:
    def latest(self, source_id: str, request_key: str) -> LatestState:
        return LatestState()


class Clock:
    def __init__(self) -> None:
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return 0.0

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)

    def wall(self) -> datetime:
        return datetime(2026, 11, 3, tzinfo=UTC)


def _group() -> GroupConfig:
    conf = load_sources(ROOT / "config" / "sources.yaml", env_example=ROOT / ".env.example")
    source = next(s for s in conf.data["sources"] if s["id"] == "ecb")
    return GroupConfig.from_config(source, source["groups"][0], load_series_entries(MAP))


def _http(handler: Any, clock: Clock, retries: int = 0) -> HttpClient:
    return HttpClient(
        HttpSettings(base_url=BASE, retries=RetryConfig(max=retries)),
        repo_url="https://example.invalid/repo",
        clock=clock,
        transport=httpx.MockTransport(handler),
    )


def _raw() -> RawObject:
    return RawObject(
        body=FIXTURE.read_bytes(),
        source_id="ecb",
        group_id="ecb_yields",
        fetched_at=datetime(2026, 11, 3, tzinfo=UTC),
    )


def test_parser_registered_and_golden_parse() -> None:
    assert registry.resolve("ecb_csv_v1@1") is not None
    g = _group()
    flt = series_filter_for(g.series, "IRS", g.missing_markers)
    out = EcbConnector().parse(_raw(), flt)
    assert [m.series_ref for m in out.metas] == [
        "M.DE.L.L40.CI.0000.EUR.N.Z",
        "M.U2.L.L40.CI.0000.EUR.N.Z",
    ]
    assert [m.entity_code for m in out.metas] == ["DE", "U2"]
    assert all(m.frequency == "M" for m in out.metas)
    de = [o for o in out.observations if ".DE." in o.series_ref]
    assert [(str(o.ref_period_start), o.value, o.value_status) for o in de] == [
        ("2025-08-01", Decimal("2.71"), "OBS"),
        ("2025-09-01", Decimal("2.68"), "OBS"),
        ("2025-10-01", Decimal("2.70"), "PROV"),
    ]
    ea = [o for o in out.observations if ".U2." in o.series_ref]
    assert [o.value_status for o in ea] == ["OBS", "MISS", "OBS"]
    assert ea[1].value is None
    assert ea[1].source_flags == "M"
    assert out.rejected == ()  # FR row is not mapped, so it is skipped silently


def test_parse_drift_and_bad_rows() -> None:
    flt = SeriesFilter(series_refs=frozenset({"M.DE.X"}))
    from macro_monitor.ingestion.base import ParseError

    with pytest.raises(ParseError):
        EcbConnector().parse(replace(_raw(), body=b"A,B\n1,2\n"), flt)
    body = b"KEY,FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE\nIRS.M.DE.X,M,DE,2025-01,abc\n"
    out = EcbConnector().parse(replace(_raw(), body=body), flt)
    assert out.rejected
    assert out.rejected[0].reason.startswith("PARSE-03")


def test_plan_one_request_per_series_and_deterministic() -> None:
    specs = EcbConnector().plan(_group(), FakeState(), "refresh")
    assert len(specs) == 2
    parts = urlsplit(specs[0].url)
    assert parts.path == "/service/data/IRS/M.DE.L.L40.CI.0000.EUR.N.Z"
    assert ("startPeriod", "1991-01") in parse_qsl(parts.query)
    assert ("format", "csvdata") in parse_qsl(parts.query)
    assert specs == EcbConnector().plan(_group(), FakeState(), "catchup")


def test_aggregate_without_composition_is_rejected() -> None:
    g = _group()
    series = tuple(replace(e, composition="NA") for e in g.series)  # type: ignore[type-var]
    with pytest.raises(ConnectorConfigError, match="composition"):
        EcbConnector().plan(replace(g, series=series), FakeState(), "refresh")


def test_fixed_and_changing_never_spliced() -> None:
    g = _group()
    ea = next(e for e in g.series if e.entity == "EA")
    assert isinstance(ea, EcbSeriesEntry)
    assert ea.composition == "CHANGING"
    fixed = replace(ea, key="M.U3.L.L40.CI.0000.EUR.N.Z", composition="FIXED")
    with pytest.raises(ConnectorConfigError, match="spliced"):
        EcbConnector().plan(replace(g, series=(*g.series, fixed)), FakeState(), "refresh")


def test_503_is_retried_with_backoff_then_succeeds() -> None:
    calls: list[int] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) < 3:
            return httpx.Response(503)
        return httpx.Response(200, content=FIXTURE.read_bytes())

    clock = Clock()
    spec = EcbConnector().plan(_group(), FakeState(), "refresh")[0]
    result = EcbConnector().fetch(spec, _http(handler, clock, retries=4), FakeState())
    assert result.outcome == "new"
    assert result.body == FIXTURE.read_bytes()
    assert len(calls) == 3
    waits = [d for d in clock.slept if d > 0]  # the limiter also sleeps (0.0)
    assert len(waits) == 2
    assert waits[1] > 0


def test_persistent_503_ends_as_error() -> None:
    spec = EcbConnector().plan(_group(), FakeState(), "refresh")[0]
    result = EcbConnector().fetch(
        spec, _http(lambda r: httpx.Response(503), Clock(), retries=1), FakeState()
    )
    assert result.outcome in ("error", "blocked")
    assert result.body is None


def test_v2_real_layout_maps_pc_to_pct() -> None:
    """Real 2026-11-09 captures: UNIT=PC (-> PCT), no ADJUSTMENT column (-> NA)."""
    assert registry.resolve("ecb_csv_v2@2") is not None
    g = _group()
    for name, ref, area, first, last in (
        ("de", "M.DE.L.L40.CI.0000.EUR.N.Z", "DE", Decimal("8.94"), Decimal("3.473")),
        (
            "u2",
            "M.U2.L.L40.CI.0000.EUR.N.Z",
            "U2",
            Decimal("9.320464354821377"),
            Decimal("3.9283751113081005"),
        ),
    ):
        body = (FIXTURE.parent / f"irs_real_layout_{name}.csv").read_bytes()
        flt = series_filter_for(g.series, "IRS", g.missing_markers)
        out = EcbConnector().parse(replace(_raw(), body=body, parser_id="ecb_csv_v2@2"), flt)
        assert out.rejected == ()
        (meta,) = out.metas
        assert (meta.series_ref, meta.entity_code, meta.frequency) == (ref, area, "M")
        assert (meta.unit_code, meta.seasonal_adjustment) == ("PCT", "NA")
        assert len(out.observations) == 5
        assert out.observations[0].value == first
        assert out.observations[-1].value == last
        assert str(out.observations[-1].ref_period_start) == "2026-09-01"


def test_v2_series_map_expectations_match_parsed_meta() -> None:
    doc = load_yaml(MAP)
    assert [e["expect"]["unit"] for e in doc["series"]] == ["PCT", "PCT"]
    assert [e["expect"]["seasonal_adjustment"] for e in doc["series"]] == ["NA", "NA"]
    source = next(
        s
        for s in load_sources(
            ROOT / "config" / "sources.yaml", env_example=ROOT / ".env.example"
        ).data["sources"]
        if s["id"] == "ecb"
    )
    assert source["groups"][0]["parser"] == "macro_monitor.ingestion.parsers.ecb_csv_v2:parse"
