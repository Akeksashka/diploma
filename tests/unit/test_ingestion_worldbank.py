"""T55: World Bank REST connector, parser and config (pagination, missing marker, lastupdated)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

import httpx
import pytest

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import (
    Connector,
    GroupConfig,
    ParseError,
    RawObject,
    RequestSpec,
    SeriesFilter,
)
from macro_monitor.ingestion.connectors.rest import WorldBankConnector, next_page, update_marker
from macro_monitor.ingestion.connectors.sdmx import ConnectorConfigError, load_series_entries
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.registry.config import load_sources
from macro_monitor.storage.manifest import LatestState

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
FX = ROOT / "tests" / "fixtures" / "raw" / "worldbank"
P1 = FX / "fi_res_totl_cd_synthetic_p1.json"
P2 = FX / "fi_res_totl_cd_synthetic_p2.json"
MAP = ROOT / "config" / "series_map" / "worldbank_annual.yaml"
BASE = "https://api.worldbank.org/v2/"


class FakeState:
    def latest(self, source_id: str, request_key: str) -> LatestState:
        return LatestState()


def _group() -> GroupConfig:
    conf = load_sources(ROOT / "config" / "sources.yaml", env_example=ROOT / ".env.example")
    source = next(s for s in conf.data["sources"] if s["id"] == "worldbank")
    return GroupConfig.from_config(source, source["groups"][0], load_series_entries(MAP))


def _m14_spec() -> RequestSpec:
    """The M14 (FI.RES.TOTL.CD) request; the shipped group now plans one request per indicator."""
    specs = WorldBankConnector().plan(_group(), FakeState(), "refresh")
    return next(s for s in specs if urlsplit(s.url).path.endswith("/indicator/FI.RES.TOTL.CD"))


def _http(handler: object) -> HttpClient:
    class Clock:
        def monotonic(self) -> float:
            return 0.0

        def sleep(self, seconds: float) -> None:
            return None

        def wall(self) -> datetime:
            return datetime(2026, 11, 3, tzinfo=UTC)

    return HttpClient(
        HttpSettings(base_url=BASE, retries=RetryConfig(max=0)),
        repo_url="https://example.invalid/repo",
        clock=Clock(),
        transport=httpx.MockTransport(handler),  # type: ignore[arg-type]
    )


def _raw(path: Path) -> RawObject:
    return RawObject(
        body=path.read_bytes(),
        source_id="worldbank",
        group_id="worldbank_annual",
        fetched_at=datetime(2026, 11, 3, tzinfo=UTC),
        parser_id="worldbank_v1@1",
    )


def _filter(markers: tuple[str, ...] = ("..",)) -> SeriesFilter:
    return SeriesFilter(
        series_refs=frozenset(e.key for e in load_series_entries(MAP)),
        missing_markers=frozenset(markers),
    )


def test_protocol_surface() -> None:
    assert {n for n in dir(WorldBankConnector) if not n.startswith("_")} == {
        "source_id",
        "plan",
        "fetch",
        "fetch_all",
        "parse",
    }
    assert WorldBankConnector.source_id == "worldbank"
    c: Connector = WorldBankConnector()
    assert c.source_id == "worldbank"


def test_config_is_valid_and_registered() -> None:
    assert _group().group_id == "worldbank_annual"
    assert registry.resolve("worldbank_v1@1")


def test_plan_is_pure_and_first_page_only() -> None:
    specs = WorldBankConnector().plan(_group(), FakeState(), "refresh")
    assert [s.url for s in specs] == [
        s.url for s in WorldBankConnector().plan(_group(), FakeState(), "refresh")
    ]
    assert len(specs) == 5  # one request per indicator (M14, A01, A11, A14, A22)
    spec = _m14_spec()
    parts = urlsplit(spec.url)
    prefix, _, rest = parts.path.partition("/country/")
    codes, _, indicator = rest.partition("/indicator/")
    assert prefix == "/v2"
    assert indicator == "FI.RES.TOTL.CD"
    assert len(codes.split(";")) == 42
    assert {"DEU", "FRA"} <= set(codes.split(";"))
    q = dict(parse_qsl(parts.query))
    assert q["page"] == "1"
    assert q["date"] == "1991:2100"
    assert q["format"] == "json"
    assert spec.expect_scope == "complete"


def test_plan_rejects_incremental() -> None:
    g = _group()
    bad = GroupConfig(**{**g.__dict__, "mode_default": "incremental"})
    with pytest.raises(ConnectorConfigError):
        WorldBankConnector().plan(bad, FakeState(), "refresh")


def test_parse_page1_missing_marker_and_lastupdated() -> None:
    out = WorldBankConnector().parse(_raw(P1), _filter())
    assert out.source_updated == "2026-10-08"
    assert [m.series_ref for m in out.metas] == ["FI.RES.TOTL.CD.DEU"]
    assert out.metas[0].frequency == "A"
    assert out.metas[0].entity_code == "DEU"
    by_year = {o.ref_period_start.year: o for o in out.observations}
    assert by_year[2024].value is not None
    assert by_year[2024].value_status == "OBS"
    assert by_year[2022].value is None
    assert by_year[2022].value_status == "MISS"
    assert by_year[2022].source_flags == ".."
    assert by_year[2024].ref_period_end.year == 2024


def test_undeclared_marker_skips_missing_cell() -> None:
    out = WorldBankConnector().parse(_raw(P1), _filter(()))
    assert {o.ref_period_start.year for o in out.observations} == {2023, 2024}


def test_unmapped_series_dropped() -> None:
    out = WorldBankConnector().parse(
        _raw(P1), SeriesFilter(series_refs=frozenset({"FI.RES.TOTL.CD.FRA"}))
    )
    assert out.metas == ()
    assert out.observations == ()


def test_parse_rejects_garbage_and_error_payload() -> None:
    bad = RawObject(b"<html/>", "worldbank", "g", datetime(2026, 11, 3, tzinfo=UTC))
    with pytest.raises(ParseError):
        WorldBankConnector().parse(bad, _filter())
    err = RawObject(
        b'[{"message":[{"id":"120","key":"Invalid value"}]}]',
        "worldbank",
        "g",
        datetime(2026, 11, 3, tzinfo=UTC),
    )
    with pytest.raises(ParseError):
        WorldBankConnector().parse(err, _filter())


def test_update_marker() -> None:
    assert update_marker(P1.read_bytes()) == "2026-10-08"
    assert update_marker(b"nope") is None


def test_next_page_until_exhausted() -> None:
    spec = _m14_spec()
    nxt = next_page(spec, P1.read_bytes())
    assert nxt is not None
    assert dict(parse_qsl(urlsplit(nxt.url).query))["page"] == "2"
    assert nxt.request_key != spec.request_key
    assert next_page(nxt, P2.read_bytes()) is None


def test_fetch_all_follows_pages_and_keeps_bytes() -> None:
    pages = {"1": P1.read_bytes(), "2": P2.read_bytes()}
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        page = dict(request.url.params)["page"]
        seen.append(page)
        return httpx.Response(
            200, content=pages[page], headers={"content-type": "application/json"}
        )

    spec = _m14_spec()
    results = WorldBankConnector().fetch_all(spec, _http(handler), FakeState())
    assert seen == ["1", "2"]
    assert [r.body for r in results] == [pages["1"], pages["2"]]
    assert all(r.update_marker == "2026-10-08" for r in results)


def test_fetch_all_stops_on_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    spec = _m14_spec()
    results = WorldBankConnector().fetch_all(spec, _http(handler), FakeState())
    assert len(results) == 1
    assert results[0].body is None


def test_fetch_request_records_every_page_as_its_own_raw_object(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import MagicMock

    from macro_monitor.ingestion import archive, fetch

    pages = {"1": P1.read_bytes(), "2": P2.read_bytes()}
    group = _group()
    job = fetch.GroupJob(
        source={"kind": "rest"},
        group=group,
        connector=WorldBankConnector(),
        parser_id="worldbank_v1@1",
    )
    recorded: list[tuple[str, bytes | None]] = []

    def record(c: object, store: object, result: object, ctx: object, *, stage: object) -> object:
        r = result  # a FetchResult
        recorded.append((r.spec.url, r.body))  # type: ignore[attr-defined]
        return archive.RecordOutcome("new", 100 + len(recorded))

    monkeypatch.setattr(archive, "record_fetch", record)
    monkeypatch.setattr(archive, "collect_manifest_line", lambda store, outcome: None)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=pages[dict(request.url.params)["page"]],
            headers={"content-type": "application/json"},
        )

    report = fetch.GroupFetchReport(group.group_id)
    fetch._fetch_request(
        MagicMock(), MagicMock(), job, _http(handler), 1, _m14_spec(), FakeState(), None, report
    )  # type: ignore[arg-type]
    assert [dict(parse_qsl(urlsplit(u).query))["page"] for u, _ in recorded] == ["1", "2"]
    assert [b for _, b in recorded] == [pages["1"], pages["2"]]
    assert report.outcomes == ["new", "new"]
    assert report.raw_ids == [101, 102]
