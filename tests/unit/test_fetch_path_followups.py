"""T53/T57 follow-ups of the shared fetch path (offline; fake clocks, mock transports)."""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest

from macro_monitor.ingestion import fetch
from macro_monitor.ingestion import http as http_mod
from macro_monitor.ingestion.base import GroupConfig
from macro_monitor.ingestion.connectors import sdmx
from macro_monitor.ingestion.connectors.sdmx import (
    ASYNC_POLL_CEILING_S,
    ConnectorConfigError,
    EurostatConnector,
    OecdConnector,
    estimate_cells,
)
from macro_monitor.ingestion.fetch import (
    GroupFetchReport,
    GroupJob,
    fetch_group,
    order_for_catchup,
)
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.ingestion.ratelimit import (
    BudgetExhausted,
    InMemoryBudgetStore,
    RateLimitConfig,
    RateLimiter,
    hour_window,
)
from macro_monitor.models.types import FetchResult, RequestSpec
from macro_monitor.registry.config import load_sources
from macro_monitor.storage.manifest import LatestState

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://sdmx.oecd.org/public/rest/"


class FakeClock:
    def __init__(self, now: datetime | None = None) -> None:
        self.now = now or datetime(2026, 11, 5, 10, 5, tzinfo=UTC)
        self.mono = 0.0

    def monotonic(self) -> float:
        return self.mono

    def sleep(self, seconds: float) -> None:
        self.mono += max(0.0, seconds)
        self.now += timedelta(seconds=max(0.0, seconds))

    def wall(self) -> datetime:
        return self.now


def _oecd_source() -> dict[str, Any]:
    conf = load_sources(ROOT / "config" / "sources.yaml", env_example=ROOT / ".env.example")
    return next(s for s in conf.data["sources"] if s["id"] == "oecd")


def _spec(url: str = BASE + "data/X", key: str = "k") -> RequestSpec:
    return RequestSpec("oecd", "g", "GET", url, {}, {}, key, "full", "complete")


def _client(
    handler: Callable[[httpx.Request], httpx.Response],
    clock: FakeClock,
    store: InMemoryBudgetStore | None = None,
    settings: HttpSettings | None = None,
) -> HttpClient:
    return HttpClient(
        settings or HttpSettings.from_source(_oecd_source()),
        repo_url="https://example.invalid/repo",
        clock=clock,
        transport=httpx.MockTransport(handler),
        budgets=store,
    )


# ------------------------------------------------------------- item 4: real OECD config


def test_429_is_one_call_counted_rate_limited_and_not_retried() -> None:
    calls: list[int] = []
    clock, store = FakeClock(), InMemoryBudgetStore()

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429, headers={"Retry-After": "5"})

    result = _client(handler, clock, store).fetch(_spec())
    assert result.outcome == "rate_limited"
    assert len(calls) == 1
    assert store.get("sdmx.oecd.org", hour_window(clock.now)) == 1


def test_503_retry_counts_twice_against_the_budget() -> None:
    calls: list[int] = []
    clock, store = FakeClock(), InMemoryBudgetStore()

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503, content=b"unavailable")

    result = _client(handler, clock, store).fetch(_spec())
    assert result.outcome == "error"
    assert len(calls) == 2  # retries.max is 1 for OECD
    assert store.get("sdmx.oecd.org", hour_window(clock.now)) == 2


# ---------------------------------------------------------- item 8: 413 never retried


def test_413_is_never_retried_even_when_listed() -> None:
    calls: list[int] = []
    settings = HttpSettings(
        base_url=BASE,
        retries=RetryConfig(max=3, backoff_s=1, jitter=False, on=frozenset({413, 503})),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(413)

    result = _client(handler, FakeClock(), settings=settings).fetch(_spec())
    assert (result.outcome, result.status, len(calls)) == ("error", 413, 1)


# ------------------------------------------------- item 5: explicit refused-redirect signal


def test_refused_redirect_is_marked_explicitly() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "https://evil.example/x"})

    result = _client(handler, FakeClock()).fetch(_spec())
    assert result.outcome == "error"
    assert result.error_class == http_mod.ERR_REDIRECT_REFUSED


def test_plain_error_has_no_redirect_marker() -> None:
    result = _client(lambda r: httpx.Response(404), FakeClock()).fetch(_spec())
    assert result.outcome == "error"
    assert result.error_class is None


# --------------------------------------------------------- item 11: body size cap


def test_body_over_cap_fails_with_error_class(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(http_mod, "MAX_BODY_BYTES", 100)
    big = _client(lambda r: httpx.Response(200, content=b"x" * 101), FakeClock()).fetch(_spec())
    assert (big.outcome, big.body, big.error_class) == ("error", None, "body_too_large")
    ok = _client(lambda r: httpx.Response(200, content=b"x" * 100), FakeClock()).fetch(_spec())
    assert ok.outcome == "new"
    assert ok.body == b"x" * 100


def test_cap_applies_while_streaming_without_content_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(http_mod, "MAX_BODY_BYTES", 10)

    def chunks() -> Any:
        yield b"12345"
        yield b"67890"
        yield b"X"

    result = _client(lambda r: httpx.Response(200, content=chunks()), FakeClock()).fetch(_spec())
    assert result.error_class == "body_too_large"


def test_normal_body_headers_survive_the_cap_path() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"abc", headers={"ETag": '"e1"', "Content-Type": "text/csv"}
        )

    result = _client(handler, FakeClock()).fetch(_spec())
    assert (result.body, result.etag, result.content_type) == (b"abc", '"e1"', "text/csv")


# ------------------------------------------------------ item 3: atomic budget acquire


def test_hour_boundary_is_a_fixed_utc_clock_hour() -> None:
    clock = FakeClock(datetime(2026, 11, 5, 10, 59, 59, tzinfo=UTC))
    lim = RateLimiter("h", RateLimitConfig(budget_per_hour=2), clock, InMemoryBudgetStore())
    lim.acquire()
    lim.release()
    lim.acquire()
    lim.release()
    with pytest.raises(BudgetExhausted):
        lim.acquire()  # 10:59:59 is still the 10:00 window
    clock.now = datetime(2026, 11, 5, 11, 0, 0, tzinfo=UTC)
    lim.acquire()  # 11:00:00 opens a new window
    lim.release()


def test_two_acquires_at_count_seven_only_one_passes() -> None:
    clock, store = FakeClock(), InMemoryBudgetStore()
    cfg = RateLimitConfig(budget_per_hour=8)
    for _ in range(7):
        store.increment("h", hour_window(clock.now))
    a, b = RateLimiter("h", cfg, clock, store), RateLimiter("h", cfg, clock, store)
    a.acquire()
    a.release()
    with pytest.raises(BudgetExhausted):
        b.acquire()
    assert store.get("h", hour_window(clock.now)) == 8


def test_concurrent_acquires_never_exceed_the_budget() -> None:
    clock, store = FakeClock(), InMemoryBudgetStore()
    cfg = RateLimitConfig(max_concurrent=20, budget_per_hour=8)
    limiters = [RateLimiter("h", cfg, clock, store) for _ in range(20)]
    passed: list[int] = []
    barrier = threading.Barrier(20)

    def run(lim: RateLimiter) -> None:
        barrier.wait()
        try:
            lim.acquire()
            passed.append(1)
            lim.release()
        except BudgetExhausted:
            pass

    threads = [threading.Thread(target=run, args=(lim,)) for lim in limiters]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(passed) == 8


def test_rate_limiter_uses_the_store_atomic_step_not_get_then_increment() -> None:
    """A store whose get() is stale (race) cannot make the limiter over-count."""
    clock = FakeClock()

    class RacyStore(InMemoryBudgetStore):
        def get(self, host: str, window: str) -> int:
            return 7  # what both racing processes would have read

    store = RacyStore()
    for _ in range(8):
        store.increment("h", hour_window(clock.now))
    with pytest.raises(BudgetExhausted):
        RateLimiter("h", RateLimitConfig(budget_per_hour=8), clock, store).acquire()


# ------------------------------------------------ item 1: stop-and-defer in fetch_group


def _job(specs: list[RequestSpec]) -> GroupJob:
    connector = MagicMock()
    connector.plan.return_value = specs
    group = GroupConfig("oecd", "g", BASE, {}, "complete")
    return GroupJob(source={"id": "oecd"}, group=group, connector=connector, parser_id="p")


def _run(
    monkeypatch: pytest.MonkeyPatch,
    specs: list[RequestSpec],
    outcomes: list[str],
    mode: str = "refresh",
    history: dict[str, tuple[datetime, str]] | None = None,
) -> tuple[GroupFetchReport, list[str], list[str]]:
    tried: list[str] = []
    deferred_rows: list[str] = []
    seq = iter(outcomes)

    def fake_fetch(*args: Any) -> None:
        spec, report = args[5], args[8]
        tried.append(spec.request_key)
        report.outcomes.append(next(seq))

    def fake_deferred(conn: Any, run_id: int, rest: Any, at: datetime) -> None:
        deferred_rows.extend(s.request_key for s in rest)

    monkeypatch.setattr(fetch, "_fetch_request", fake_fetch)
    monkeypatch.setattr(fetch, "_record_deferred", fake_deferred)
    monkeypatch.setattr(fetch, "load_attempt_history", lambda conn, s: history or {})
    http = MagicMock()
    report = fetch_group(MagicMock(), MagicMock(), _job(specs), http, 1, mode=mode)  # type: ignore[arg-type]
    return report, tried, deferred_rows


def _specs(n: int) -> list[RequestSpec]:
    return [_spec(BASE + f"data/D{i}", f"k{i}") for i in range(n)]


def test_blocked_stops_the_group_and_skips_the_rest(monkeypatch: pytest.MonkeyPatch) -> None:
    report, tried, deferred = _run(monkeypatch, _specs(4), ["new", "blocked"])
    assert tried == ["k0", "k1"]
    assert report.skipped == ["k2", "k3"]
    assert report.deferred == []
    assert deferred == []
    assert not report.ok


def test_rate_limited_stops_and_defers_the_rest(monkeypatch: pytest.MonkeyPatch) -> None:
    report, tried, deferred = _run(monkeypatch, _specs(5), ["new", "new", "rate_limited"])
    assert tried == ["k0", "k1", "k2"]
    assert report.deferred == ["k2", "k3", "k4"]
    assert deferred == ["k3", "k4"]  # a deferred attempt row for each not-tried request
    assert not report.ok  # exit code 10 via the existing run status


def test_group_without_rate_limit_is_ok_and_runs_everything(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    report, tried, _ = _run(monkeypatch, _specs(3), ["new", "unchanged", "not_modified"])
    assert tried == ["k0", "k1", "k2"]
    assert report.ok


def test_error_does_not_stop_the_group(monkeypatch: pytest.MonkeyPatch) -> None:
    report, tried, _ = _run(monkeypatch, _specs(3), ["error", "new", "new"])
    assert tried == ["k0", "k1", "k2"]
    assert not report.ok


# ------------------------------------------------------------ item 2: catch-up ordering


def test_catchup_order_deferred_and_never_attempted_first_then_least_recent() -> None:
    specs = _specs(6)
    t = datetime(2026, 11, 1, tzinfo=UTC)
    history = {
        "k0": (t + timedelta(hours=3), "new"),
        "k1": (t + timedelta(hours=1), "new"),
        "k2": (t + timedelta(hours=2), "not_modified"),
        # k3 never attempted
        "k4": (t + timedelta(hours=4), "rate_limited"),
        "k5": (t + timedelta(hours=4, minutes=1), "rate_limited"),
    }
    order = [s.request_key for s in order_for_catchup(specs, history)]
    assert order == ["k3", "k4", "k5", "k1", "k2", "k0"]
    assert order == [s.request_key for s in order_for_catchup(specs, history)]  # deterministic


def test_catchup_without_history_keeps_planned_order() -> None:
    specs = _specs(4)
    assert order_for_catchup(specs, {}) == specs


def test_catchup_progresses_through_more_requests_than_one_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """10 requests, budget 8 per run: the second run starts with the two deferred ones."""
    specs = _specs(10)
    first, tried1, _ = _run(monkeypatch, specs, ["new"] * 8 + ["rate_limited"], mode="catchup")
    assert tried1[-1] == "k8"
    assert first.deferred == ["k8", "k9"]
    t = datetime(2026, 11, 5, tzinfo=UTC)
    history = {f"k{i}": (t + timedelta(minutes=i), "new") for i in range(8)}
    history["k8"] = (t + timedelta(minutes=30), "rate_limited")
    history["k9"] = (t + timedelta(minutes=30), "rate_limited")
    _, tried2, _ = _run(
        monkeypatch, specs, ["new"] * 8 + ["rate_limited"], mode="catchup", history=history
    )
    assert tried2[:2] == ["k8", "k9"]


# ------------------------------------------------------------ item 7: conditional headers


def _latest() -> LatestState:
    return LatestState(etag='"e"', last_modified="Wed, 01 Jan 2025 00:00:00 GMT")


class _State:
    def latest(self, source_id: str, request_key: str) -> LatestState:
        return _latest()


def _seen_headers(connector: Any) -> dict[str, str]:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(304)

    settings = HttpSettings(base_url="https://ec.europa.eu/eurostat/api/")
    spec = _spec("https://ec.europa.eu/eurostat/api/data/X")
    connector.fetch(spec, _client(handler, FakeClock(), settings=settings), _State())
    return seen


@pytest.mark.parametrize("cls", [EurostatConnector, OecdConnector])
def test_no_conditional_headers_without_http_validators(cls: Any) -> None:
    seen = _seen_headers(cls(["update_marker", "content_hash"]))
    assert "if-none-match" not in seen
    assert "if-modified-since" not in seen


@pytest.mark.parametrize("cls", [EurostatConnector, OecdConnector])
def test_conditional_headers_sent_with_http_validators(cls: Any) -> None:
    seen = _seen_headers(cls(["http_validators", "content_hash"]))
    assert seen["if-none-match"] == '"e"'
    assert seen["if-modified-since"].startswith("Wed, 01 Jan 2025")


# --------------------------------------------------------------- item 9: estimate_cells


def test_estimate_rejects_list_valued_freq_and_since() -> None:
    with pytest.raises(ConnectorConfigError):
        estimate_cells([("freq", "M"), ("freq", "Q"), ("sinceTimePeriod", "1991")])
    with pytest.raises(ConnectorConfigError):
        estimate_cells([("freq", "M"), ("sinceTimePeriod", "1991"), ("sinceTimePeriod", "2000")])


def test_estimate_end_year_follows_the_clock() -> None:
    pairs = [("freq", "A"), ("sinceTimePeriod", "2000"), ("geo", "DE")]
    assert estimate_cells(pairs, current_year=2026) == 2035 - 2000 + 1
    assert estimate_cells(pairs, current_year=2040) == 2040 - 2000 + 1
    assert estimate_cells(pairs, 2010) == 11  # explicit until_year wins


# ------------------------------------------------- items 6 and 10: async polling


def _async_url(name: str) -> str:
    return f"https://ec.europa.eu/eurostat/api/{name}"


def _pending(url: str) -> bytes:
    return (f'{{"status": "PROCESSING", "statusUrl": "{url}"}}').encode()


def test_poll_reports_final_data_url_as_resolved_url() -> None:
    data_url = _async_url("files/result.json")
    answers = {
        "status": b'{"status": "FINISHED", "dataUrl": "%s"}' % data_url.encode(),
        "files/result.json": b'{"class": "dataset", "value": [1]}',
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=answers[request.url.path.rsplit("/api/", 1)[-1]])

    settings = HttpSettings(base_url="https://ec.europa.eu/eurostat/api/")
    http = _client(handler, FakeClock(), settings=settings)
    first = FetchResult(_spec(), "new", 200, b"", datetime.now(UTC), None, None, None, None)
    status = sdmx.AsyncStatus("pending", _async_url("status"))
    out = sdmx._poll(_spec(), first, status, http)
    assert out.outcome == "new"
    assert out.resolved_url == data_url
    assert out.spec == _spec()  # the original spec is kept


def test_poll_total_time_including_retry_waits_is_bounded() -> None:
    clock = FakeClock()
    settings = HttpSettings(
        base_url="https://ec.europa.eu/eurostat/api/",
        retries=RetryConfig(
            max=4, backoff_s=200, backoff_factor=1, jitter=False, on=frozenset({503})
        ),
    )
    url = _async_url("status")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, content=b"down")

    http = _client(handler, clock, settings=settings)
    first = FetchResult(_spec(), "new", 200, b"", datetime.now(UTC), None, None, None, None)
    out = sdmx._poll(_spec(), first, sdmx.AsyncStatus("pending", url), http)
    assert out.outcome == "error"
    assert clock.mono <= ASYNC_POLL_CEILING_S


def test_poll_stops_when_never_ready_within_the_ceiling() -> None:
    clock = FakeClock()
    url = _async_url("status")
    settings = HttpSettings(base_url="https://ec.europa.eu/eurostat/api/")
    http = _client(lambda r: httpx.Response(200, content=_pending(url)), clock, settings=settings)
    first = FetchResult(_spec(), "new", 200, b"", datetime.now(UTC), None, None, None, None)
    out = sdmx._poll(_spec(), first, sdmx.AsyncStatus("pending", url), http)
    assert out.outcome == "error"
    assert out.body is None
    assert clock.mono <= ASYNC_POLL_CEILING_S


def test_poll_many_polls_with_retry_waits_stop_at_the_900_s_bound() -> None:
    """Poll sleeps alone fit the 900 s schedule; every poll also owes a 500 s retry wait on a 503.

    Without the shared bound (remaining time passed as ``max_total_wait_s``) the second retry wait
    runs the fake clock past 1000 s; with it the sequence stops at or below the ceiling."""
    clock = FakeClock()
    settings = HttpSettings(
        base_url="https://ec.europa.eu/eurostat/api/",
        retries=RetryConfig(
            max=1, backoff_s=500, backoff_factor=1, jitter=False, on=frozenset({503})
        ),
    )
    url = _async_url("status")
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) % 2 == 1:
            return httpx.Response(503, content=b"down")
        return httpx.Response(200, content=_pending(url))

    http = _client(handler, clock, settings=settings)
    first = FetchResult(_spec(), "new", 200, b"", datetime.now(UTC), None, None, None, None)
    out = sdmx._poll(_spec(), first, sdmx.AsyncStatus("pending", url), http)
    assert out.outcome == "error"
    assert len(calls) >= 3  # polls in a row, with retry waits between
    assert 500 < clock.mono <= ASYNC_POLL_CEILING_S
