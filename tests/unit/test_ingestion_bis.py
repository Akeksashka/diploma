"""T54: BIS bulk connector (synthetic fixtures; offline)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import GroupConfig, ParseError, RawObject
from macro_monitor.ingestion.connectors.bulk import BulkConnector, file_date
from macro_monitor.ingestion.connectors.sdmx import (
    ConnectorConfigError,
    load_series_entries,
    series_filter_for,
)
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.ingestion.parsers.bis_v1 import zip_member_date
from macro_monitor.registry.config import load_sources, load_yaml
from macro_monitor.storage.manifest import LatestState

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "tests" / "fixtures" / "raw" / "bis"
GAP = FIX / "ws_credit_gap_synthetic.zip"
GAP_R2 = FIX / "ws_credit_gap_synthetic_r2.zip"
CBPOL = FIX / "ws_cbpol_synthetic.zip"


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
        return datetime(2026, 11, 4, tzinfo=UTC)


def _group(group_id: str) -> GroupConfig:
    conf = load_sources(ROOT / "config" / "sources.yaml", env_example=ROOT / ".env.example")
    source = next(s for s in conf.data["sources"] if s["id"] == "bis")
    g = next(g for g in source["groups"] if g["id"] == group_id)
    return GroupConfig.from_config(source, g, load_series_entries(ROOT / g["series_map"]))


def _http(handler: Any) -> HttpClient:
    return HttpClient(
        HttpSettings(base_url="https://data.bis.org/", retries=RetryConfig(max=0)),
        repo_url="https://example.invalid/repo",
        clock=Clock(),
        transport=httpx.MockTransport(handler),
    )


def _raw(path: Path, group: str) -> RawObject:
    return RawObject(
        body=path.read_bytes(),
        source_id="bis",
        group_id=group,
        fetched_at=datetime(2026, 11, 4, tzinfo=UTC),
    )


def test_parser_registered_and_golden_parse() -> None:
    assert registry.resolve("bis_v1@1") is not None
    g = _group("bis_credit_gap")
    flt = series_filter_for(g.series, "WS_CREDIT_GAP", g.missing_markers)
    out = BulkConnector().parse(_raw(GAP, "bis_credit_gap"), flt)
    assert [m.series_ref for m in out.metas] == ["Q.DE.P.A.C", "Q.US.P.A.C"]
    assert all(m.frequency == "Q" and m.unit_code == "PCT_GDP" for m in out.metas)
    us = [o for o in out.observations if o.series_ref == "Q.US.P.A.C"]
    assert [(str(o.ref_period_start), o.value) for o in us] == [
        ("2025-01-01", Decimal("-3.1")),
        ("2025-04-01", Decimal("-2.8")),
        ("2025-07-01", Decimal("-2.5")),
    ]
    assert out.rejected == ()


def test_cbpol_parses_and_bad_input_fails_closed() -> None:
    g = _group("bis_cbpol")
    flt = series_filter_for(g.series, "WS_CBPOL", g.missing_markers)
    out = BulkConnector().parse(_raw(CBPOL, "bis_cbpol"), flt)
    assert out.metas
    assert {m.series_ref for m in out.metas} <= {e.key for e in g.series}
    assert all(m.frequency == "M" for m in out.metas)
    bad = RawObject(body=b"A,B\n1,2\n", source_id="bis", group_id="bis_cbpol", fetched_at=None)  # type: ignore[arg-type]
    with pytest.raises(ParseError, match="PARSE-01"):
        BulkConnector().parse(bad, flt)
    zipbad = RawObject(body=b"PK\x03\x04junk", source_id="bis", group_id="x", fetched_at=None)  # type: ignore[arg-type]
    with pytest.raises(ParseError, match="PARSE-01"):
        BulkConnector().parse(zipbad, flt)


def test_revised_file_changes_values_for_reestimation() -> None:
    g = _group("bis_credit_gap")
    flt = series_filter_for(g.series, "WS_CREDIT_GAP", g.missing_markers)
    a = BulkConnector().parse(_raw(GAP, "bis_credit_gap"), flt)
    b = BulkConnector().parse(_raw(GAP_R2, "bis_credit_gap"), flt)
    va = {(o.series_ref, o.ref_period_start): o.value for o in a.observations}
    vb = {(o.series_ref, o.ref_period_start): o.value for o in b.observations}
    revised = [k for k in va if k in vb and va[k] != vb[k]]
    assert revised  # history was re-estimated
    assert set(vb) - set(va)  # and a new quarter appeared


def test_q06_group_is_reestimating_with_snapshot() -> None:
    g = _group("bis_credit_gap")
    assert g.snapshot_mode == "diff_above_tol"
    assert _group("bis_cbpol").snapshot_mode == "none"


def test_plan_one_full_request_per_dataset() -> None:
    specs = BulkConnector().plan(_group("bis_credit_gap"), FakeState(), "refresh")
    assert len(specs) == 1
    assert specs[0].url == "https://data.bis.org/static/bulk/WS_CREDIT_GAP_csv_flat.zip"
    assert specs[0].expect_scope == "complete"
    assert specs == BulkConnector().plan(_group("bis_credit_gap"), FakeState(), "catchup")


def test_plan_rejects_unmapped_dataset() -> None:
    from dataclasses import replace

    g = _group("bis_cbpol")
    g = replace(g, request_template={**g.request_template, "datasets": ["WS_CBPOL", "WS_X"]})
    with pytest.raises(ConnectorConfigError, match="WS_X"):
        BulkConnector().plan(g, FakeState(), "refresh")


def test_file_date_prefers_last_modified_then_zip_member() -> None:
    body = GAP.read_bytes()
    assert zip_member_date(body) == date(2026, 10, 15)
    assert file_date(None, body) == "2026-10-15"
    assert file_date("Tue, 03 Nov 2026 10:00:00 GMT", body) == "2026-11-03"
    assert file_date("garbage", body) == "2026-10-15"
    assert file_date(None, b"a,b\n") is None


def test_fetch_sets_update_marker_and_detects_change() -> None:
    spec = BulkConnector().plan(_group("bis_credit_gap"), FakeState(), "refresh")[0]
    bodies = iter([GAP.read_bytes(), GAP_R2.read_bytes()])

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=next(bodies))

    http = _http(handler)
    first = BulkConnector().fetch(spec, http, FakeState())
    second = BulkConnector().fetch(spec, http, FakeState())
    assert first.outcome == "new"
    assert first.update_marker == "2026-10-15"
    assert second.update_marker is not None
    assert first.body != second.body


def test_fetch_conditional_request_gives_not_modified() -> None:
    spec = BulkConnector().plan(_group("bis_credit_gap"), FakeState(), "refresh")[0]
    seen: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.headers.get("If-None-Match"))
        return httpx.Response(304)

    state = FakeState(LatestState(etag='"abc"'))
    result = BulkConnector().fetch(spec, _http(handler), state)
    assert seen == ['"abc"']
    assert result.body is None
    assert result.outcome != "new"


def test_known_gaps_declared_and_series_map_whitelist() -> None:
    gaps = load_yaml(ROOT / "config" / "known_gaps.yaml")["known_gaps"]
    pairs = {(g["indicator"], g["entity"]) for g in gaps}
    assert ("M17", "BGR") in pairs
    assert sum(1 for i, _ in pairs if i == "Q06") == 10  # 42 countries minus 32 with the series
