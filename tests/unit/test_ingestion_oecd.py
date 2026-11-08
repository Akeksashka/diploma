"""T57: OECD connector, sdmxcsv_v1 parser, request budget on a fake clock (synthetic; offline).

The KEI fixture is SYNTHETIC and trimmed by hand ([UNVERIFIED] layout, codes, URL shape).
"""

from __future__ import annotations

import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import GroupConfig, ParseError, RawObject, SeriesMapEntry
from macro_monitor.ingestion.connectors.sdmx import (
    MANUAL_FALLBACK_HINT,
    ConnectorConfigError,
    OecdConnector,
    load_series_entries,
    series_filter_for,
)
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.ingestion.ratelimit import InMemoryBudgetStore, RateLimitConfig
from macro_monitor.registry.config import load_sources
from macro_monitor.storage.manifest import LatestState

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
KEI_CSV = ROOT / "tests" / "fixtures" / "raw" / "oecd" / "kei_synthetic.csv"
KEI = "OECD.SDD.STES,DSD_KEI@DF_KEI"
GROUPS = ("oecd_kei", "oecd_prices", "oecd_cli")


class FakeState:
    def latest(self, source_id: str, request_key: str) -> LatestState:
        return LatestState()


class FakeClock:
    """Wall and monotonic time move only through ``sleep`` and ``advance``."""

    def __init__(self) -> None:
        self.now = datetime(2026, 11, 5, 10, 5, tzinfo=UTC)
        self.mono = 0.0
        self.slept = 0.0

    def monotonic(self) -> float:
        return self.mono

    def sleep(self, seconds: float) -> None:
        self.mono += seconds
        self.slept += seconds
        self.now += timedelta(seconds=seconds)

    def wall(self) -> datetime:
        return self.now

    def advance(self, **kw: float) -> None:
        self.now += timedelta(**kw)


def _source() -> dict[str, Any]:
    conf = load_sources(ROOT / "config" / "sources.yaml", env_example=ROOT / ".env.example")
    return next(s for s in conf.data["sources"] if s["id"] == "oecd")


def _group(group_id: str) -> GroupConfig:
    source = _source()
    g = next(g for g in source["groups"] if g["id"] == group_id)
    return GroupConfig.from_config(source, g, load_series_entries(ROOT / g["series_map"]))


def _many(n: int) -> GroupConfig:
    """A synthetic group with n dataflows (budget tests)."""
    g = _group("oecd_kei")
    names = [f"OECD.SDD.STES,DSD_X{i:02d}@DF_X{i:02d}" for i in range(n)]
    series = tuple(
        SeriesMapEntry(dataset=d, key="A.B", entity="USA", indicator="M18", role="headline")
        for d in names
    )
    return replace(g, request_template={**g.request_template, "datasets": names}, series=series)


def _http(
    handler: Any, clock: FakeClock, store: InMemoryBudgetStore, budget: int | None = 8
) -> HttpClient:
    return HttpClient(
        HttpSettings(
            base_url="https://sdmx.oecd.org/public/rest/",
            retries=RetryConfig(max=0),
            rate_limit=RateLimitConfig(min_interval_s=30, budget_per_hour=budget),
        ),
        repo_url="https://example.invalid/repo",
        clock=clock,
        transport=httpx.MockTransport(handler),
        budgets=store,
    )


def _ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, content=b"DATAFLOW,REF_AREA\n")


# ------------------------------------------------------------------------------ config


def test_source_is_disabled_and_budget_and_timeout_are_set() -> None:
    source = _source()
    assert source["enabled"] is False  # until probed
    assert source["rate_limit"]["budget_per_hour"] == 8
    assert [g["id"] for g in source["groups"]] == list(GROUPS)
    assert {g["job_timeout_min"] for g in source["groups"]} == {300}


def test_cli_group_is_reestimating_with_default_revision_keys_only() -> None:
    g = next(g for g in _source()["groups"] if g["id"] == "oecd_cli")
    assert g["reestimating"] is True
    assert set(g["revision"]) == {"max_revised_rows"}
    assert _group("oecd_cli").snapshot_mode == "diff_above_tol"  # the rule-31 default
    assert _group("oecd_kei").snapshot_mode == "none"


# ------------------------------------------------------------------------------- plan


@pytest.mark.parametrize("group_id", GROUPS)
def test_plan_is_one_whole_dataflow_request_from_1991(group_id: str) -> None:
    specs = OecdConnector().plan(_group(group_id), FakeState(), "refresh")
    assert len(specs) == 1
    spec = specs[0]
    assert spec.url.startswith("https://sdmx.oecd.org/public/rest/data/OECD.SDD.")
    assert spec.url.split("?")[0].endswith("/")  # whole dataflow, no key segment
    assert "startPeriod=1991-01" in spec.url
    for forbidden in ("lastNObservations", "UpdatedAfter", "*", "endPeriod"):
        assert forbidden not in spec.url
    assert (spec.fetch_mode, spec.expect_scope) == ("full", "complete")
    assert specs == OecdConnector().plan(_group(group_id), FakeState(), "catchup")


def test_plan_url_for_kei() -> None:
    [spec] = OecdConnector().plan(_group("oecd_kei"), FakeState(), "refresh")
    assert spec.url == (
        f"https://sdmx.oecd.org/public/rest/data/{KEI}/?format=csvfile&startPeriod=1991-01"
    )


@pytest.mark.parametrize(
    ("patch", "match"),
    [
        ({"params": {"startPeriod": "1991-01", "lastNObservations": "1"}}, "not allowed"),
        ({"params": {"startPeriod": "1991-01", "updatedAfter": "2026-01-01"}}, "not allowed"),
        ({"params": {"format": "csvfile"}}, "1991"),
        ({"params": {"startPeriod": "2000-01"}}, "1991"),
        ({"path": "data/{dataset}/{key}"}, "whole dataflow"),
        ({"datasets": ["OECD.SDD.STES,DSD_KEI@DF_KEI/*"]}, "plain dataflow"),
        ({"datasets": ["A+B"]}, "plain dataflow"),
        ({"datasets": ["OECD.SDD.OTHER,DSD_Y@DF_Y"]}, "no mapped series"),
        ({"datasets": []}, "empty"),
    ],
)
def test_plan_rejects_forbidden_shapes(patch: dict[str, Any], match: str) -> None:
    g = _group("oecd_kei")
    g = replace(g, request_template={**g.request_template, **patch})
    with pytest.raises(ConnectorConfigError, match=match):
        OecdConnector().plan(g, FakeState(), "refresh")


def test_plan_rejects_incremental_or_partial() -> None:
    with pytest.raises(ConnectorConfigError, match="full/complete"):
        OecdConnector().plan(replace(_group("oecd_kei"), fetch_scope="partial"), FakeState(), "x")  # type: ignore[arg-type]


# ----------------------------------------------------------- parser (golden, KEI fixture)


def _kei_raw() -> RawObject:
    return RawObject(
        body=KEI_CSV.read_bytes(),
        source_id="oecd",
        group_id="oecd_kei",
        fetched_at=datetime(2026, 11, 5, tzinfo=UTC),
    )


def test_parser_registered() -> None:
    assert registry.resolve("sdmxcsv_v1@1") is not None


def test_golden_parse_of_trimmed_kei_fixture() -> None:
    g = _group("oecd_kei")
    flt = series_filter_for(g.series, KEI, g.missing_markers)
    out = OecdConnector().parse(_kei_raw(), flt)
    usa_y = "USA.M.IRLT.PA._Z.N._Z._Z._Z"
    jpn_y = "JPN.M.IRLT.PA._Z.N._Z._Z._Z"
    usa_c = "USA.M.CCICP.IX._Z._Z._Z._Z._Z"
    jpn_c = "JPN.M.CCICP.IX._Z._Z._Z._Z._Z"
    assert [m.series_ref for m in out.metas] == sorted(
        [usa_y, jpn_y, usa_c, jpn_c]
    )  # DEU/Q dropped
    meta = {m.series_ref: m for m in out.metas}
    assert (meta[usa_y].entity_code, meta[usa_y].frequency, meta[usa_y].unit_code) == (
        "USA",
        "M",
        "PCT",
    )
    assert meta[usa_y].seasonal_adjustment == "NSA"
    assert meta[usa_y].published_decimals == 2
    assert meta[usa_c].unit_code == "IDX"
    assert meta[usa_c].base_period == "2015"
    assert meta[usa_c].seasonal_adjustment == "NA"
    got = [
        (o.series_ref, str(o.ref_period_start), o.value, o.value_status, o.source_flags)
        for o in out.observations
    ]
    assert got == [
        (jpn_c, "2025-01-01", Decimal("100.4"), "OBS", "A"),
        (jpn_y, "2025-01-01", Decimal("1.21"), "OBS", "A"),
        (jpn_y, "2025-02-01", Decimal("1.35"), "PROV", "P"),
        (usa_c, "2025-01-01", Decimal("99.1"), "OBS", "A"),
        (usa_c, "2025-02-01", Decimal("98.7"), "OBS", "A"),
        (usa_y, "2025-01-01", Decimal("4.62"), "OBS", "A"),
        (usa_y, "2025-02-01", Decimal("4.50"), "OBS", "A"),
        (usa_y, "2025-03-01", None, "MISS", "M"),
    ]
    assert [(r.series_ref, r.period, r.reason.split(":")[0]) for r in out.rejected] == [
        (jpn_c, "2025-13", "PARSE-02"),
        (jpn_c, "2025-02", "PARSE-03"),
    ]


def test_parse_is_deterministic_and_every_meta_is_in_the_series_map() -> None:
    g = _group("oecd_kei")
    flt = series_filter_for(g.series, KEI, g.missing_markers)
    a = OecdConnector().parse(_kei_raw(), flt)
    assert a == OecdConnector().parse(_kei_raw(), flt)
    assert {m.series_ref for m in a.metas} == {e.key for e in g.series}


def test_label_suffixed_headers_and_bad_input_fail_closed() -> None:
    body = (
        b"DATAFLOW,REF_AREA:Reference area,FREQ:Frequency,MEASURE,TIME_PERIOD,OBS_VALUE\n"
        b"X,USA,A,GDP,2024,1.5\n"
    )
    flt = series_filter_for((), "x", ())
    flt = replace(flt, series_refs=frozenset({"USA.A.GDP"}))
    out = OecdConnector().parse(RawObject(body, "oecd", "g", datetime(2026, 1, 1, tzinfo=UTC)), flt)
    assert [(o.series_ref, o.value) for o in out.observations] == [("USA.A.GDP", Decimal("1.5"))]
    for bad in (b"A,B\n1,2\n", b"REF_AREA,FREQ,TIME_PERIOD\n", b"\xff\xfe"):
        with pytest.raises(ParseError, match="PARSE-01"):
            OecdConnector().parse(
                RawObject(bad, "oecd", "g", datetime(2026, 1, 1, tzinfo=UTC)), flt
            )


_HDR = (
    "REF_AREA,FREQ,MEASURE,UNIT_MEASURE,ADJUSTMENT,TIME_PERIOD,OBS_VALUE,OBS_STATUS,"
    "UNIT_MULT,DECIMALS\n"
)


def _parse_rows(*rows: str) -> Any:
    body = (_HDR + "".join(r + "\n" for r in rows)).encode()
    flt = replace(
        series_filter_for((), "x", ("",)),
        series_refs=frozenset({"USA.M.GDP.IX.N", "USA.M.GDP.IX.Q"}),
        missing_markers=frozenset({"M"}),
    )
    raw = RawObject(body, "oecd", "g", datetime(2026, 1, 1, tzinfo=UTC))
    return OecdConnector().parse(raw, flt)


def test_parser_ok_row_uses_decimals_column() -> None:
    out = _parse_rows("USA,M,GDP,IX,N,2025-01,1.5,A,0,3")
    assert [(o.value, o.value_status) for o in out.observations] == [(Decimal("1.5"), "OBS")]
    assert out.metas[0].published_decimals == 3


@pytest.mark.parametrize(
    ("row", "reason"),
    [
        ("USA,M,GDP,IX,Q,2025-01,1.5,A,0,1", "PARSE-03: unknown ADJUSTMENT"),
        ("USA,M,GDP,IX,N,2025-01,1.5,A,x,1", "PARSE-03: non-integer UNIT_MULT"),
        ("USA,M,GDP,IX,N,2025-01,1.5,A,1.5,1", "PARSE-03: non-integer UNIT_MULT"),
        ("USA,M,GDP,IX,N,2025-01,1.5,M,0,1", "PARSE-03: status M with a value"),
        ("USA,M,GDP,IX,N,2025-01,NaN,A,0,1", "PARSE-03: non-finite"),
        ("USA,M,GDP,IX,N,2025-01,abc,A,0,1", "PARSE-03: non-numeric"),
    ],
)
def test_parser_rejects_instead_of_coercing(row: str, reason: str) -> None:
    out = _parse_rows(row)
    assert out.observations == ()
    assert out.rejected[0].reason.startswith(reason)


def test_parser_unknown_status_is_obs_with_raw_flag() -> None:
    out = _parse_rows("USA,M,GDP,IX,N,2025-01,1.5,Z,0,1")
    assert out.rejected == ()
    assert [(o.value, o.value_status, o.source_flags) for o in out.observations] == [
        (Decimal("1.5"), "OBS", "Z")
    ]


def test_parser_non_ascii_decimals_do_not_raise() -> None:
    out = _parse_rows("USA,M,GDP,IX,N,2025-01,1.5,A,0,\u00b2")
    assert out.metas[0].published_decimals == 1  # derived from the value text


def test_parser_unknown_freq_is_parse_02_not_empty_frequency() -> None:
    body = (_HDR + "USA,X,GDP,IX,N,2025-01,1.5,A,0,1\n").encode()
    flt = replace(series_filter_for((), "x", ()), series_refs=frozenset({"USA.X.GDP.IX.N"}))
    out = OecdConnector().parse(RawObject(body, "oecd", "g", datetime(2026, 1, 1, tzinfo=UTC)), flt)
    assert out.metas == ()
    assert out.rejected[0].reason.startswith("PARSE-02: unknown FREQ")
    flt = replace(flt, series_refs=frozenset(), discover=True)
    with pytest.raises(ParseError, match="PARSE-01: unknown FREQ"):
        OecdConnector().parse(RawObject(body, "oecd", "g", datetime(2026, 1, 1, tzinfo=UTC)), flt)


def test_parser_short_row_is_parse_error_not_key_error() -> None:
    with pytest.raises(ParseError, match="PARSE-01: short row"):
        _parse_rows("USA,M,GDP,IX,N,2025-01")


def test_parser_duplicate_series_period_is_parse_04() -> None:
    with pytest.raises(ParseError, match="PARSE-04"):
        _parse_rows(
            "USA,M,GDP,IX,N,2025-01,1.5,A,0,1",
            "USA,M,GDP,IX,N,2025-01,1.6,A,0,1",
        )


@pytest.mark.parametrize("value", ["NaN", ""])
def test_parser_marker_wins_over_non_finite_check(value: str) -> None:
    out = _parse_rows(f"USA,M,GDP,IX,N,2025-01,{value},M,0,1")
    assert [(o.value, o.value_status, o.source_flags) for o in out.observations] == [
        (None, "MISS", "M")
    ]
    assert out.rejected == ()


# ------------------------------------------------- budget on a fake clock (AC-WF-13 logic)


def test_budget_of_eight_per_hour_defers_the_rest_to_catch_up() -> None:
    clock, store, calls = FakeClock(), InMemoryBudgetStore(), []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=b"x")

    specs = OecdConnector().plan(_many(10), FakeState(), "refresh")
    assert len(specs) == 10
    out = OecdConnector().fetch_budgeted(specs, _http(handler, clock, store), FakeState())
    assert len(out.results) == 8
    assert len(calls) == 8
    assert out.stopped_by == "budget"
    assert all(r.outcome == "new" for r in out.results)
    assert [s.url for s in out.deferred] == [s.url for s in specs[8:]]
    assert clock.slept >= 7 * 30  # min interval honoured between the requests

    # a new process (new HttpClient) with the same persisted counters still has no budget
    again = OecdConnector().fetch_budgeted(out.deferred, _http(handler, clock, store), FakeState())
    assert len(calls) == 8
    assert not again.results
    assert again.stopped_by == "budget"
    assert again.deferred == out.deferred

    # next hour window: catch-up fetches exactly the deferred ones
    clock.now = datetime(2026, 11, 5, 11, 0, tzinfo=UTC)
    final = OecdConnector().fetch_budgeted(out.deferred, _http(handler, clock, store), FakeState())
    assert len(final.results) == 2
    assert not final.deferred
    assert final.stopped_by is None
    assert len(calls) == 10


def test_rate_limited_outcome_is_not_counted_and_exact_eight_is_not_deferred() -> None:
    clock, store = FakeClock(), InMemoryBudgetStore()
    specs = OecdConnector().plan(_many(8), FakeState(), "refresh")
    out = OecdConnector().fetch_budgeted(specs, _http(_ok, clock, store), FakeState())
    assert len(out.results) == 8
    assert not out.deferred
    assert out.stopped_by is None
    extra = OecdConnector().plan(_many(9), FakeState(), "refresh")[-1]
    blocked_by_budget = _http(_ok, clock, store).fetch(extra)
    assert blocked_by_budget.outcome == "rate_limited"
    assert store.get("sdmx.oecd.org", "h2026110510") == 8  # the refused request did not count


# ------------------------------------------------------------ bot challenge -> blocked


def test_bot_challenge_is_blocked_not_retried_and_stops_the_group(
    caplog: pytest.LogCaptureFixture,
) -> None:
    clock, store, calls = FakeClock(), InMemoryBudgetStore(), []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(403, content=b"<html><title>Just a moment...</title>cf-chl</html>")

    http = HttpClient(
        HttpSettings(
            base_url="https://sdmx.oecd.org/public/rest/",
            retries=RetryConfig(max=4, on=frozenset({403, 503})),
            rate_limit=RateLimitConfig(budget_per_hour=8),
        ),
        repo_url="https://example.invalid/repo",
        clock=clock,
        transport=httpx.MockTransport(handler),
        budgets=store,
    )
    specs = OecdConnector().plan(_many(3), FakeState(), "refresh")
    with caplog.at_level("ERROR"):
        out = OecdConnector().fetch_budgeted(specs, http, FakeState())
    assert len(calls) == 1  # never retried, never bypassed
    assert [r.outcome for r in out.results] == ["blocked"]
    assert out.results[0].body is None
    assert out.stopped_by == "blocked"
    assert len(out.deferred) == 2
    assert "manual_inbox/oecd" in caplog.text
    assert MANUAL_FALLBACK_HINT in caplog.text


def test_plain_403_without_challenge_markers_is_an_error_not_blocked() -> None:
    clock = FakeClock()
    http = _http(lambda r: httpx.Response(403, content=b"Forbidden"), clock, InMemoryBudgetStore())
    [spec] = OecdConnector().plan(_group("oecd_kei"), FakeState(), "refresh")
    assert OecdConnector().fetch(spec, http, FakeState()).outcome == "error"


# ---------------------------------------------------------------------------- network


@pytest.mark.network
@pytest.mark.skipif(
    os.environ.get("MM_ALLOW_NETWORK") != "1", reason="operator-run: MM_ALLOW_NETWORK=1"
)
def test_probe_at_most_one_request_for_the_kei_dataflow() -> None:  # pragma: no cover
    """Operator probe: ONE whole-dataflow request (about 35 MB); it only checks the layout."""
    source = _source()
    http = HttpClient(
        HttpSettings.from_source(source), repo_url="https://github.com/oleksandrdzuba/macro-monitor"
    )
    [spec] = OecdConnector().plan(_group("oecd_kei"), FakeState(), "refresh")
    result = OecdConnector().fetch(spec, http, FakeState())
    assert result.outcome in {"new", "blocked", "rate_limited"}
    if result.body is not None:
        assert result.body.split(b"\n", 1)[0].count(b",") >= 5
