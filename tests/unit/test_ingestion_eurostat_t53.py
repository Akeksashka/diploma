"""T53: Eurostat full coverage (offline; recorded SYNTHETIC fixtures).

Covers: request sizing (500k / 5M cells), async polling (15 min, 15 s -> 120 s), 413 and 404
handling, dataset-code drift (``prc_hicp_manr`` -> ``prc_hicp_minr``), golden parses of the new
groups, ``expect`` against the parsed metadata, COMP-01/COMP-02 baselines, release-calendar
equality, the SA groups' use of the spec's ``revision:`` keys only, and reproducibility of the
proposed series maps.

[UNVERIFIED] Every fixture is synthetic: dimension order, category codes and the asynchronous
status body are assumptions until the operator capture (OP-04) runs the ``network`` probe.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import shutil
import sys
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import httpx
import pytest

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import GroupConfig, RawObject
from macro_monitor.ingestion.connectors import sdmx
from macro_monitor.ingestion.connectors.sdmx import (
    ConnectorConfigError,
    EurostatConnector,
    load_series_entries,
    series_filter_for,
)
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.registry.config import load_sources, load_yaml
from macro_monitor.storage.manifest import LatestState
from macro_monitor.validation.revision_checks import check_comp_01, check_comp_02

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "tests" / "fixtures" / "raw" / "eurostat"
BASE = "https://ec.europa.eu/eurostat/api/dissemination/"
NEW_GROUPS = ("eurostat_sts", "eurostat_hicp", "eurostat_gov_debt")
ALL_GROUPS = ("eurostat_labour", *NEW_GROUPS)
FETCHED = datetime(2026, 11, 5, tzinfo=UTC)


class FakeState:
    def __init__(self) -> None:
        self._latest = LatestState()

    def latest(self, source_id: str, request_key: str) -> LatestState:
        return self._latest


class RecordingClock:
    def __init__(self) -> None:
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return sum(self.sleeps)

    def sleep(self, seconds: float) -> None:
        if seconds > 0:  # the rate limiter also calls sleep(0)
            self.sleeps.append(seconds)

    def wall(self) -> datetime:
        return datetime(2026, 11, 5, tzinfo=UTC)


def _sources() -> dict[str, Any]:
    conf = load_sources(
        ROOT / "config" / "sources.yaml",
        env_example=ROOT / ".env.example",
        project_root=ROOT,
        check_parsers=True,
    )
    return next(s for s in conf.data["sources"] if s["id"] == "eurostat")


def _group_cfg(group_id: str) -> tuple[dict[str, Any], GroupConfig]:
    source = _sources()
    group = next(g for g in source["groups"] if g["id"] == group_id)
    entries = load_series_entries(ROOT / group["series_map"])
    return group, GroupConfig.from_config(source, group, entries)


def _http(
    handler: Callable[[httpx.Request], httpx.Response], clock: RecordingClock | None = None
) -> HttpClient:
    return HttpClient(
        HttpSettings(base_url=BASE, retries=RetryConfig(max=3)),
        repo_url="https://example.invalid/repo",
        clock=clock or RecordingClock(),
        transport=httpx.MockTransport(handler),
    )


def _template(g: GroupConfig, **changes: Any) -> GroupConfig:
    return replace(g, request_template={**g.request_template, **changes})


# ---------------------------------------------------------------- golden parses per group

#: group -> (fixture, dataset, series_ref -> list of (period end, value, status))
GOLDEN: dict[str, tuple[str, str, dict[str, list[tuple[str, str, str]]]]] = {
    "eurostat_sts": (
        "sts_inpr_m_synthetic",
        "sts_inpr_m",
        {
            "M.PROD.B-D.SCA.I21.DE": [
                ("2026-06-30", "100.1", "OBS"),
                ("2026-07-31", "100.4", "OBS"),
                ("2026-08-31", "100.2", "PROV"),
            ],
            "M.PROD.B-D.SCA.I21.EL": [("2026-06-30", "92.5", "OBS"), ("2026-08-31", "93.0", "OBS")],
            "M.PROD.B-D.SCA.I21.FR": [
                ("2026-06-30", "99.0", "OBS"),
                ("2026-07-31", "99.3", "OBS"),
                ("2026-08-31", "99.8", "PROV"),
            ],
        },
    ),
    "eurostat_hicp": (
        "prc_hicp_minr_synthetic",
        "prc_hicp_minr",
        {
            # the first cell (TOTAL, DE, 2026-06) is absent; (TOTAL, FR, 2026-07) is provisional
            "M.I25.TOTAL.DE": [("2026-07-31", "100.2", "OBS"), ("2026-08-31", "100.4", "OBS")],
            "M.I25.TOTAL.FR": [
                ("2026-06-30", "100.7", "OBS"),
                ("2026-07-31", "100.9", "PROV"),
                ("2026-08-31", "101.1", "OBS"),
            ],
            "M.I25.TOT_X_NRG_FOOD.TR": [
                ("2026-06-30", "102.9", "OBS"),
                ("2026-07-31", "103.1", "OBS"),
                ("2026-08-31", "103.3", "OBS"),
            ],
            "M.I25.CP01.DE": [
                ("2026-06-30", "103.0", "OBS"),
                ("2026-07-31", "103.2", "OBS"),
                ("2026-08-31", "103.4", "OBS"),
            ],
        },
    ),
    "eurostat_gov_debt": (
        "gov_10q_ggdebt_synthetic",
        "gov_10q_ggdebt",
        {
            "Q.GD.S13.PC_GDP.DE": [
                ("2025-12-31", "62.9", "OBS"),
                ("2026-03-31", "63.1", "OBS"),
                ("2026-06-30", "63.0", "OBS"),
            ],
            "Q.GD.S13.PC_GDP.EL": [
                ("2025-12-31", "151.2", "OBS"),
                ("2026-03-31", "150.4", "OBS"),
                ("2026-06-30", "149.9", "OBS"),
            ],
        },
    ),
}


def _parse(group_id: str, fixture: str, dataset: str) -> Any:
    _, cfg = _group_cfg(group_id)
    raw = RawObject(
        body=(RAW / f"{fixture}.json").read_bytes(),
        source_id="eurostat",
        group_id=group_id,
        fetched_at=FETCHED,
        parser_id=sdmx.PARSER_ID,
    )
    return EurostatConnector().parse(
        raw, series_filter_for(cfg.series, dataset, cfg.missing_markers)
    )


@pytest.mark.parametrize("group_id", sorted(GOLDEN))
def test_golden_parse_per_group(group_id: str) -> None:
    fixture, dataset, golden = GOLDEN[group_id]
    out = _parse(group_id, fixture, dataset)
    got: dict[str, list[tuple[str, str, str]]] = {}
    for o in out.observations:
        assert o.value is not None
        got.setdefault(o.series_ref, []).append(
            (o.ref_period_end.isoformat(), str(o.value), o.value_status)
        )
    for ref, rows in golden.items():
        assert got[ref] == rows
    assert {m.series_ref for m in out.metas} == set(got)
    assert out.source_updated == "2026-10-30T11:00:00+0100"
    assert out.rejected == ()


@pytest.mark.parametrize("group_id", sorted(GOLDEN))
def test_fixture_series_are_all_in_the_series_map(group_id: str) -> None:
    """The recorded keys equal map keys: dimension order of the map follows the fixture."""
    fixture, dataset, _ = GOLDEN[group_id]
    out = _parse(group_id, fixture, dataset)
    _, cfg = _group_cfg(group_id)
    mapped = {e.key for e in cfg.series if e.dataset == dataset}
    assert {m.series_ref for m in out.metas} <= mapped
    assert len(out.metas) > 0


@pytest.mark.parametrize("group_id", sorted(GOLDEN))
def test_parsed_metadata_matches_the_expect_block(group_id: str) -> None:
    """META-02 without a database: the map's ``expect`` equals what the parser publishes."""
    fixture, dataset, _ = GOLDEN[group_id]
    out = _parse(group_id, fixture, dataset)
    group, _ = _group_cfg(group_id)
    expect_by_key = {e["key"]: e["expect"] for e in load_yaml(ROOT / group["series_map"])["series"]}
    alias = {"unit": "unit_code"}
    for meta in out.metas:
        for name, want in expect_by_key[meta.series_ref].items():
            assert getattr(meta, alias.get(name, name)) == want, (meta.series_ref, name)


def test_geo_codes_use_eurostat_spelling_and_every_entity_exists() -> None:
    entities = {e["id"] for e in load_yaml(ROOT / "config" / "entities.yaml")["entities"]}
    for gid in NEW_GROUPS:
        _, cfg = _group_cfg(gid)
        assert {e.entity for e in cfg.series} <= entities
        geos = {sdmx.geo_code(e.key) for e in cfg.series}
        assert "EL" in geos  # Greece is EL at Eurostat
        assert "GR" not in geos
        assert ("TR" in geos) == (gid != "eurostat_gov_debt")  # research F5: no TR in Q08


# ---------------------------------------------------------------- M01 uses SCA (rule 8)


def test_m01_and_m02_use_sca_everywhere() -> None:
    group, cfg = _group_cfg("eurostat_sts")
    fixed = group["request_template"]["fixed_filters"]
    assert fixed["sts_inpr_m"]["s_adj"] == "SCA"
    assert fixed["sts_trtu_m"]["s_adj"] == "SCA"
    sts = load_yaml(ROOT / group["series_map"])["series"]
    assert {e["indicator"] for e in sts} == {"M01", "M02"}
    for e in sts:
        assert e["expect"]["seasonal_adjustment"] == "SCA"
        assert ".CA." not in e["key"]
    assert len({e.key for e in cfg.series if e.indicator == "M01"}) == 28


# ---------------------------------------------------------------- plan: sizing and drift


@pytest.mark.parametrize("group_id", ALL_GROUPS)
def test_shipped_groups_plan_below_the_sync_cell_limit(group_id: str) -> None:
    _, cfg = _group_cfg(group_id)
    specs = EurostatConnector().plan(cfg, FakeState(), "refresh")
    assert len(specs) == len(cfg.request_template["datasets"])
    for spec in specs:
        pairs = parse_qsl(urlsplit(spec.url).query)
        cells = sdmx.estimate_cells(pairs)
        assert 0 < cells < sdmx.SYNC_CELL_LIMIT
        assert ("sinceTimePeriod", cfg.request_template["params"]["sinceTimePeriod"]) in pairs
        assert not any(k.startswith("c[") for k, _ in pairs)


def test_hicp_request_uses_the_new_dataset_and_repeats_the_list_filter() -> None:
    _, cfg = _group_cfg("eurostat_hicp")
    (spec,) = EurostatConnector().plan(cfg, FakeState(), "refresh")
    parts = urlsplit(spec.url)
    assert parts.path.endswith("/statistics/1.0/data/prc_hicp_minr")
    q = parse_qsl(parts.query)
    assert [v for k, v in q if k == "coicop18"] == ["CP01", "TOTAL", "TOT_X_NRG_FOOD"]  # sorted
    assert ("unit", "I25") in q  # index 2025=100
    assert len([v for k, v in q if k == "geo"]) == 28
    configured = {d for g in _sources()["groups"] for d in g["request_template"]["datasets"]}
    assert not configured & set(sdmx.RETIRED_DATASETS)


def test_multi_dataset_group_plans_one_request_each() -> None:
    _, cfg = _group_cfg("eurostat_sts")
    specs = EurostatConnector().plan(cfg, FakeState(), "refresh")
    assert [urlsplit(s.url).path.rsplit("/", 1)[-1] for s in specs] == ["sts_inpr_m", "sts_trtu_m"]
    assert len({s.request_key for s in specs}) == 2


def test_retired_dataset_code_is_a_config_error_naming_the_successor() -> None:
    _, cfg = _group_cfg("eurostat_hicp")
    old = list(cfg.series)
    cfg2 = _template(cfg, datasets=["prc_hicp_manr"])
    cfg2 = replace(cfg2, series=tuple(replace(e, dataset="prc_hicp_manr") for e in old))
    with pytest.raises(ConnectorConfigError, match="prc_hicp_minr"):
        EurostatConnector().plan(cfg2, FakeState(), "refresh")


def test_sdmx_style_time_filter_is_rejected_at_plan() -> None:
    """AC-ETF-2 / E7: ``c[TIME_PERIOD]`` is never sent to statistics/1.0/data."""
    _, cfg = _group_cfg("eurostat_sts")
    params = {
        "format": "JSON",
        "sinceTimePeriod": "1991-01",
        "c[TIME_PERIOD]": "ge:1991",
        "geo": "{entities}",
    }
    with pytest.raises(ConnectorConfigError, match=r"c\[TIME_PERIOD\]"):
        EurostatConnector().plan(_template(cfg, params=params), FakeState(), "refresh")


def test_request_of_500k_cells_or_more_is_refused_and_5m_names_the_413_ceiling() -> None:
    _, cfg = _group_cfg("eurostat_hicp")
    # 28 countries x 45 years x 12 months = 15,120 cells per pinned combination
    many = [f"C{i:03d}" for i in range(34)]  # 34 x 15,120 = 514,080 >= 500,000
    fixed = {"prc_hicp_minr": {"freq": "M", "unit": "I25", "coicop18": many}}
    with pytest.raises(ConnectorConfigError, match="synchronous limit"):
        EurostatConnector().plan(_template(cfg, fixed_filters=fixed), FakeState(), "refresh")
    huge = [f"C{i:03d}" for i in range(400)]  # > 5,000,000
    fixed = {"prc_hicp_minr": {"freq": "M", "unit": "I25", "coicop18": huge}}
    with pytest.raises(ConnectorConfigError, match="413"):
        EurostatConnector().plan(_template(cfg, fixed_filters=fixed), FakeState(), "refresh")
    ok = [f"C{i:03d}" for i in range(33)]  # 33 x 15,120 = 498,960 < 500,000
    fixed = {"prc_hicp_minr": {"freq": "M", "unit": "I25", "coicop18": ok}}
    assert EurostatConnector().plan(_template(cfg, fixed_filters=fixed), FakeState(), "refresh")


def test_estimate_cells_uses_the_frequency() -> None:
    base = [("sinceTimePeriod", "1991-01"), ("geo", "DE"), ("geo", "FR")]
    assert sdmx.estimate_cells([*base, ("freq", "M")]) == 2 * 45 * 12
    assert sdmx.estimate_cells([*base, ("freq", "Q")]) == 2 * 45 * 4
    assert sdmx.estimate_cells([*base, ("freq", "A")]) == 2 * 45
    with pytest.raises(ConnectorConfigError):
        sdmx.estimate_cells([*base, ("freq", "D")])


def test_body_cells_and_dataset_identity_helpers() -> None:
    body = (RAW / "prc_hicp_minr_synthetic.json").read_bytes()
    assert sdmx.body_cells(body) == 1 * 1 * 3 * 3 * 3
    assert sdmx.body_dataset(body) == "PRC_HICP_MINR"
    assert sdmx.body_cells(b"not json") is None
    assert sdmx.body_dataset(b"[]") is None
    assert sdmx.dataset_of(f"{BASE}statistics/1.0/data/prc_hicp_minr?x=1") == "prc_hicp_minr"


# ---------------------------------------------------------------- fetch: async, 413, drift


def _spec(group_id: str = "eurostat_hicp") -> Any:
    _, cfg = _group_cfg(group_id)
    return EurostatConnector().plan(cfg, FakeState(), "refresh")[0]


def test_poll_schedule_is_15s_doubling_to_120s_within_15_minutes() -> None:
    delays = sdmx.poll_delays()
    assert delays[:5] == [15.0, 30.0, 60.0, 120.0, 120.0]
    assert max(delays) == 120.0
    assert sum(delays) <= 900.0 < sum(delays) + 120.0


def test_async_response_is_polled_until_the_data_is_ready() -> None:
    data = (RAW / "prc_hicp_minr_synthetic.json").read_bytes()
    pending = (RAW / "async_pending_synthetic.json").read_bytes()
    ready = (RAW / "async_ready_synthetic.json").read_bytes()
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.url.path)
        n = len(seen)
        if "/async/result/" in req.url.path:
            return httpx.Response(200, content=data)
        return httpx.Response(200, content=pending if n < 3 else ready)

    clock = RecordingClock()
    spec = _spec()
    result = EurostatConnector().fetch(spec, _http(handler, clock), FakeState())
    assert result.outcome == "new"
    assert result.body == data  # the dataset bytes, untouched
    assert result.spec == spec  # keyed by the ORIGINAL request, not the status URL
    assert result.update_marker == "2026-10-30T11:00:00+0100"
    assert clock.sleeps == [15.0, 30.0]  # two waits, then the ready answer
    assert seen[0].endswith("/prc_hicp_minr")
    assert seen[-1].startswith("/eurostat/api/dissemination/async/result/")


def test_async_that_never_finishes_gives_up_after_15_minutes() -> None:
    pending = (RAW / "async_pending_synthetic.json").read_bytes()
    clock = RecordingClock()
    result = EurostatConnector().fetch(
        _spec(), _http(lambda r: httpx.Response(200, content=pending), clock), FakeState()
    )
    assert result.outcome == "error"
    assert result.body is None
    assert sum(clock.sleeps) == sum(sdmx.poll_delays()) <= 900.0


def test_async_failure_status_is_an_error() -> None:
    failed = (RAW / "async_failed_synthetic.json").read_bytes()
    result = EurostatConnector().fetch(
        _spec(), _http(lambda r: httpx.Response(200, content=failed)), FakeState()
    )
    assert (result.outcome, result.body) == ("error", None)


def test_async_status_url_on_another_host_is_refused() -> None:
    body = json.dumps({"status": "PROCESSING", "statusUrl": "https://evil.example/s"}).encode()
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(str(req.url.host))
        return httpx.Response(200, content=body)

    result = EurostatConnector().fetch(_spec(), _http(handler), FakeState())
    assert result.outcome == "error"
    assert seen == ["ec.europa.eu"]  # the foreign host was never contacted


def test_a_dataset_is_never_mistaken_for_an_async_status() -> None:
    for name in ("prc_hicp_minr_synthetic", "une_rt_m_live_20261104"):
        assert sdmx.parse_async_status((RAW / f"{name}.json").read_bytes()) is None
    assert sdmx.parse_async_status(b"not json") is None
    assert sdmx.parse_async_status(b'{"status": "weird"}') is None


def test_http_413_is_not_retried_and_reported(caplog: pytest.LogCaptureFixture) -> None:
    body = (RAW / "too_large_413_synthetic.json").read_bytes()
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(413, content=body)

    clock = RecordingClock()
    with caplog.at_level(logging.ERROR, logger=sdmx.log.name):
        result = EurostatConnector().fetch(_spec(), _http(handler, clock), FakeState())
    assert calls == 1  # max_retries is 3, yet 413 is final
    assert clock.sleeps == []
    assert (result.outcome, result.status, result.body) == ("error", 413, None)
    assert "413" in caplog.text


def test_http_404_is_an_error_that_points_at_dataset_code_drift(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.ERROR, logger=sdmx.log.name):
        result = EurostatConnector().fetch(
            _spec(), _http(lambda r: httpx.Response(404, content=b"{}")), FakeState()
        )
    assert (result.outcome, result.status) == ("error", 404)
    assert "dataset-code drift" in caplog.text


def test_body_of_another_dataset_is_dataset_code_drift() -> None:
    other = (RAW / "gov_10q_ggdebt_synthetic.json").read_bytes()  # asked for prc_hicp_minr
    result = EurostatConnector().fetch(
        _spec(), _http(lambda r: httpx.Response(200, content=other)), FakeState()
    )
    assert (result.outcome, result.body) == ("error", None)


@pytest.mark.parametrize("group_id", sorted(GOLDEN))
def test_matching_dataset_body_is_returned_untouched(group_id: str) -> None:
    fixture, dataset, _ = GOLDEN[group_id]
    body = (RAW / f"{fixture}.json").read_bytes()
    _, cfg = _group_cfg(group_id)
    spec = next(
        s
        for s in EurostatConnector().plan(cfg, FakeState(), "refresh")
        if sdmx.dataset_of(s.url) == dataset
    )
    result = EurostatConnector().fetch(
        spec, _http(lambda r: httpx.Response(200, content=body)), FakeState()
    )
    assert result.outcome == "new"
    assert result.body == body


def test_no_conditional_headers_are_sent_without_stored_validators() -> None:
    """AC-ETF-3 for the new datasets: neither header on the first or the second fetch."""
    body = (RAW / "prc_hicp_minr_synthetic.json").read_bytes()
    heads: list[httpx.Headers] = []

    def handler(req: httpx.Request) -> httpx.Response:
        heads.append(req.headers)
        return httpx.Response(200, content=body)

    spec = _spec()
    http = _http(handler)
    for _ in range(2):
        EurostatConnector().fetch(spec, http, FakeState())
    assert len(heads) == 2
    assert all("if-none-match" not in h and "if-modified-since" not in h for h in heads)


# ---------------------------------------------------------------- COMP-01 / COMP-02 baseline


def test_comp_01_and_comp_02_baseline_on_the_hicp_golden() -> None:
    fixture, dataset, _ = GOLDEN["eurostat_hicp"]
    out = _parse("eurostat_hicp", fixture, dataset)
    refs = [m.series_ref for m in out.metas]
    assert len(refs) == 9
    assert check_comp_01(len(refs), 9).passed
    assert not check_comp_01(len(refs), 84).passed  # the shipped floor needs the full capture
    previous = {m.series_ref: m.entity_code for m in out.metas}  # first load = the baseline
    assert check_comp_02(previous, refs).passed  # identical second load
    assert not check_comp_02(previous, refs[1:]).passed  # 1 of 9 gone = 11 % > 5 %
    core_only = check_comp_02(previous, refs[1:], core=[refs[0]])
    assert not core_only.passed
    assert core_only.detail["core_disappeared"] == [refs[0]]


# ---------------------------------------------------------------- config (AC-CFG-2, freshness)


@pytest.mark.parametrize("group_id", ALL_GROUPS)
def test_ac_cfg_2_and_floor_for_each_eurostat_group(group_id: str) -> None:
    group, cfg = _group_cfg(group_id)
    assert (ROOT / group["series_map"]).is_file()
    assert registry.resolve(sdmx.PARSER_ID)
    assert group["parser"] == "macro_monitor.ingestion.parsers.jsonstat_v1:parse"
    indicators = {i["id"]: i for i in load_yaml(ROOT / "config" / "indicators.yaml")["indicators"]}
    keys = [(e.dataset, e.key) for e in cfg.series]
    assert len(keys) == len(set(keys))
    for e in cfg.series:
        assert indicators[e.indicator]["priority"] != "dropped"
    assert 0 < group["expected_series_min"] <= len(cfg.series)
    assert group["request_template"]["params"]["sinceTimePeriod"]


@pytest.mark.parametrize("group_id", ALL_GROUPS)
def test_freshness_equals_the_release_calendar(group_id: str) -> None:
    """Rule 34: the duplicated numbers must agree."""
    group, _ = _group_cfg(group_id)
    cal = load_yaml(ROOT / "config" / "release_calendar.yaml")[group_id]
    assert group["freshness"] == cal
    assert (
        group["freshness"]["tolerance_days"] <= {"M": 45, "Q": 60}[group["freshness"]["frequency"]]
    )


def test_group_frequencies_match_their_series_maps() -> None:
    for gid in ALL_GROUPS:
        group, cfg = _group_cfg(gid)
        assert {
            e["expect"]["frequency"] for e in load_yaml(ROOT / group["series_map"])["series"]
        } == {group["freshness"]["frequency"]}
        assert cfg.series


def test_sa_groups_are_reestimating_with_only_keys_the_spec_defines() -> None:
    """DG-01: only the ``revision:`` keys of rules 10 and 30-32 are used."""
    spec_keys = {
        "compare", "decimals", "rel_epsilon", "max_revised_rows",
        "materiality_abs", "materiality_rel", "snapshot_mode",
    }  # fmt: skip
    source = _sources()
    flags = {g["id"]: g["reestimating"] for g in source["groups"]}
    assert flags == {
        "eurostat_labour": False,  # SA but live; design Q18 pending, unchanged
        "eurostat_sts": True,  # SCA
        "eurostat_hicp": False,
        "eurostat_gov_debt": False,
        # T62: SCA; reestimating false pending the user's SA-register decision
        "eurostat_gdp_q": False,
    }
    for g in source["groups"]:
        assert set(g.get("revision") or {}) <= spec_keys
        if g["reestimating"]:
            assert g["revision"]["max_revised_rows"] >= 1
            assert g["note"]
            assert not g.get("edition_ordered")
    cfg = _group_cfg("eurostat_sts")[1]
    assert cfg.snapshot_mode == "diff_above_tol"  # default for reestimating groups (rule 31)
    assert _group_cfg("eurostat_hicp")[1].snapshot_mode == "none"


# ---------------------------------------------------------------- proposal reproducibility


def _load_script(name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec is not None
    assert spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_checked_in_maps_are_the_output_of_the_proposal_generator(tmp_path: Path) -> None:
    gen = _load_script("eurostat_proposal_csv")
    seed = _load_script("seed_series_map")
    import csv

    shutil.copytree(ROOT / "config", tmp_path / "config")
    csv_path = tmp_path / "proposal.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=gen.COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(gen.rows())
    out = seed.seed(csv_path, tmp_path, write=False)
    for group in NEW_GROUPS:
        rel = f"config/series_map/{group}.yaml"
        assert out[rel] == (ROOT / rel).read_text(encoding="utf-8"), rel
    # rerun is idempotent and invents nothing beyond the proposal
    assert len(gen.rows()) == 56 + 84 + 27


def test_m12_q01_q05_are_not_mapped_by_this_task() -> None:
    """Open design questions (see the plan note of T53): no silent guesses in the maps."""
    mapped = {
        e["indicator"]
        for g in NEW_GROUPS
        for e in load_yaml(ROOT / "config" / "series_map" / f"{g}.yaml")["series"]
    }
    assert mapped == {"M01", "M02", "M06", "M07", "G01", "Q08"}


# ---------------------------------------------------------------- network probe (operator-run)


@pytest.mark.network
def test_live_probe_hicp_dataset_and_series_keys() -> None:
    import os

    if os.environ.get("MM_ALLOW_NETWORK") != "1":
        pytest.skip("MM_ALLOW_NETWORK=1 not set")
    group, cfg = _group_cfg("eurostat_hicp")
    (spec,) = EurostatConnector().plan(cfg, FakeState(), "refresh")
    settings = HttpSettings.from_source(_sources())
    with HttpClient(settings, repo_url="https://example.invalid/repo") as http:
        result = EurostatConnector().fetch(spec, http, FakeState())
    assert result.outcome == "new"
    assert result.body
    out = EurostatConnector().parse(
        RawObject(result.body, "eurostat", group["id"], result.fetched_at, sdmx.PARSER_ID),
        series_filter_for(cfg.series, "prc_hicp_minr", cfg.missing_markers),
    )
    assert len(out.metas) >= group["expected_series_min"]
