"""Unit tests for macro_monitor.ingestion.{http,ratelimit} (T19); MockTransport, fake clock."""

from __future__ import annotations

import logging
import random
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from macro_monitor.ingestion.http import (
    MAX_TOTAL_WAIT_S,
    HttpClient,
    HttpClientError,
    HttpSettings,
    Redactor,
    RetryConfig,
    Validators,
    measure_clock_offset,
    offset_needs_warning,
    parse_retry_after,
    render_user_agent,
    stamp_fetched_at,
)
from macro_monitor.ingestion.ratelimit import (
    BudgetExhausted,
    InMemoryBudgetStore,
    RateLimitConfig,
    RateLimiter,
)
from macro_monitor.models.types import RequestSpec

pytestmark = pytest.mark.unit

BASE = "https://api.example.test/"
REPO = "https://example.test/repo"


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []
        self._wall0 = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)

    def monotonic(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += max(0.0, seconds)

    def wall(self) -> datetime:
        return self._wall0 + timedelta(seconds=self.t)


def spec(url: str = BASE + "data", **kw: object) -> RequestSpec:
    base: dict[str, object] = {
        "source_id": "s",
        "group_id": "g",
        "method": "GET",
        "url": url,
        "params": {},
        "headers": {},
        "request_key": "k",
        "fetch_mode": "full",
        "expect_scope": "complete",
    }
    base.update(kw)
    return RequestSpec(**base)  # type: ignore[arg-type]


def client(
    handler: object,
    clock: FakeClock | None = None,
    *,
    settings: HttpSettings | None = None,
    **kw: object,
) -> HttpClient:
    st = settings or HttpSettings(
        base_url=BASE, retries=RetryConfig(max=3, backoff_s=1, backoff_factor=2, jitter=False)
    )
    return HttpClient(
        st,
        repo_url=REPO,
        clock=clock or FakeClock(),
        transport=httpx.MockTransport(handler),  # type: ignore[arg-type]
        **kw,  # type: ignore[arg-type]
    )


def test_user_agent_template_and_rejections() -> None:
    ua = render_user_agent("macro-monitor/{version} (+{repo_url}; x)", REPO, "1.2")
    assert ua == f"macro-monitor/1.2 (+{REPO}; x)"
    with pytest.raises(HttpClientError):
        render_user_agent("  ", REPO)
    with pytest.raises(HttpClientError):
        render_user_agent("Mozilla/5.0 (X11)", REPO)


def test_user_agent_sent() -> None:
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.headers["user-agent"])
        return httpx.Response(200, content=b"ok")

    r = client(handler).fetch(spec())
    assert r.outcome == "new"
    assert r.body == b"ok"
    assert seen[0].startswith("macro-monitor/")
    assert REPO in seen[0]


def test_tls_required() -> None:
    with pytest.raises(HttpClientError):
        HttpClient(HttpSettings(base_url="http://api.example.test/"), repo_url=REPO)

    def handler(req: httpx.Request) -> httpx.Response:
        raise AssertionError("must not be called")

    assert client(handler).fetch(spec("http://api.example.test/x")).outcome == "error"


def test_ac_ing_3_challenge_blocked_no_retry() -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(403, content=b"<html>Just a moment...</html>")

    clock = FakeClock()
    r = client(handler, clock).fetch(spec())
    assert r.outcome == "blocked"
    assert r.status == 403
    assert r.body is None
    assert calls == 1
    assert clock.sleeps == [0.0]


def test_plain_403_is_error_not_blocked() -> None:
    r = client(lambda req: httpx.Response(403, content=b"forbidden")).fetch(spec())
    assert r.outcome == "error"


def test_ac_ing_6_min_interval_five_requests_take_eight_seconds() -> None:
    clock = FakeClock()
    st = HttpSettings(base_url=BASE, rate_limit=RateLimitConfig(min_interval_s=2))
    c = client(lambda req: httpx.Response(200, content=b"x"), clock, settings=st)
    for _ in range(5):
        assert c.fetch(spec()).outcome == "new"
    assert clock.t >= 8.0


def test_ac_ing_6_hour_budget_defers() -> None:
    clock = FakeClock()
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=b"x")

    st = HttpSettings(base_url=BASE, rate_limit=RateLimitConfig(budget_per_hour=2))
    c = client(handler, clock, settings=st)
    outcomes = [c.fetch(spec()).outcome for _ in range(4)]
    assert outcomes == ["new", "new", "rate_limited", "rate_limited"]
    assert calls == 2


def test_budget_persists_in_store_and_resets_next_hour() -> None:
    clock = FakeClock()
    store = InMemoryBudgetStore()
    cfg = RateLimitConfig(budget_per_hour=1)
    RateLimiter("h", cfg, clock, store).acquire()
    lim = RateLimiter("h", cfg, clock, store)  # new run, same store
    with pytest.raises(BudgetExhausted):
        lim.acquire()
    clock.t += 3600
    lim.acquire()


def test_retry_on_503_honours_retry_after() -> None:
    answers = [
        httpx.Response(503, headers={"Retry-After": "30"}),
        httpx.Response(200, content=b"ok"),
    ]
    clock = FakeClock()
    r = client(lambda req: answers.pop(0), clock).fetch(spec())
    assert r.outcome == "new"
    assert 30.0 in clock.sleeps


def test_retry_after_beyond_cap_gives_rate_limited() -> None:
    clock = FakeClock()
    r = client(
        lambda req: httpx.Response(429, headers={"Retry-After": str(int(MAX_TOTAL_WAIT_S) + 1)}),
        clock,
    ).fetch(spec())
    assert r.outcome == "rate_limited"
    assert r.status == 429
    assert max(clock.sleeps) == 0.0


def test_total_wait_never_exceeds_cap() -> None:
    clock = FakeClock()
    st = HttpSettings(
        base_url=BASE, retries=RetryConfig(max=20, backoff_s=100, backoff_factor=2, jitter=False)
    )
    r = client(lambda req: httpx.Response(500), clock, settings=st).fetch(spec())
    assert r.outcome == "error"
    assert sum(clock.sleeps) <= MAX_TOTAL_WAIT_S


def test_exponential_backoff_and_exhaustion() -> None:
    clock = FakeClock()
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    r = client(handler, clock).fetch(spec())
    assert r.outcome == "error"
    assert calls == 4
    assert [s for s in clock.sleeps if s] == [1.0, 2.0, 4.0]


def test_timeout_is_retried() -> None:
    n = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal n
        n += 1
        if n == 1:
            raise httpx.ReadTimeout("slow", request=req)
        return httpx.Response(200, content=b"ok")

    assert client(handler).fetch(spec()).outcome == "new"


def test_non_retryable_status_is_error_without_retry() -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(404)

    assert client(handler).fetch(spec()).outcome == "error"
    assert calls == 1


def test_conditional_headers_and_304() -> None:
    seen: dict[str, str] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(req.headers)
        return httpx.Response(304)

    r = client(handler).fetch(
        spec(), Validators(etag='"abc"', last_modified="Sat, 01 Nov 2026 00:00:00 GMT")
    )
    assert r.outcome == "not_modified"
    assert r.body is None
    assert seen["if-none-match"] == '"abc"'
    assert seen["if-modified-since"].startswith("Sat, 01 Nov")


def test_response_validators_captured() -> None:
    r = client(
        lambda req: httpx.Response(
            200,
            content=b"x",
            headers={"ETag": '"v1"', "Last-Modified": "L", "Content-Type": "text/csv"},
        )
    ).fetch(spec())
    assert (r.etag, r.last_modified, r.content_type) == ('"v1"', "L", "text/csv")


def test_redirect_to_unlisted_host_is_error() -> None:
    hits: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        hits.append(str(req.url))
        return httpx.Response(302, headers={"Location": "https://evil.test/x"})

    r = client(handler).fetch(spec())
    assert r.outcome == "error"
    assert r.status == 302
    assert len(hits) == 1


def test_redirect_within_allowed_hosts_followed_and_credentials_dropped() -> None:
    seen: list[tuple[str, str | None]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.url.host, req.headers.get("x-api-key")))
        if req.url.host == "api.example.test":
            return httpx.Response(301, headers={"Location": "https://cdn.example.test/f"})
        return httpx.Response(200, content=b"file")

    st = HttpSettings(base_url=BASE, extra_hosts=frozenset({"cdn.example.test"}))
    r = client(handler, settings=st).fetch(spec(headers={"X-Api-Key": "k1"}))
    assert r.outcome == "new"
    assert r.body == b"file"
    assert seen == [("api.example.test", "k1"), ("cdn.example.test", None)]


def test_redirect_to_http_refused() -> None:
    r = client(
        lambda req: httpx.Response(302, headers={"Location": "http://api.example.test/x"})
    ).fetch(spec())
    assert r.outcome == "error"


def test_request_to_unlisted_host_refused() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise AssertionError("must not be called")

    assert client(handler).fetch(spec("https://other.test/x")).outcome == "error"


def test_redaction_of_url_text_and_logs(caplog: pytest.LogCaptureFixture) -> None:
    red = Redactor(["s3cr3t!"], ["api_key"])
    cleaned = red.url("https://u:p@h.test/x?api_key=abc&a=1")
    assert "abc" not in cleaned
    assert "a=1" in cleaned
    assert "u:p" not in red.url("https://u:p@h.test/x")
    assert "s3cr3t" not in red.text("boom s3cr3t! and s3cr3t%21")

    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(
            "failed for https://api.example.test/data?api_key=s3cr3t", request=req
        )

    c = client(handler, secrets=["s3cr3t"], secret_params=["api_key"])
    with caplog.at_level(logging.DEBUG):
        assert c.fetch(spec(params={"api_key": "s3cr3t"})).outcome == "error"
    assert "s3cr3t" not in caplog.text


def test_clock_offset_stamping() -> None:
    runner = datetime(2026, 11, 1, 12, 0, 0, tzinfo=UTC)
    off = measure_clock_offset(runner + timedelta(seconds=7), runner)
    assert stamp_fetched_at(runner, off) == runner + timedelta(seconds=7)
    assert offset_needs_warning(off)
    assert not offset_needs_warning(timedelta(seconds=5))
    with pytest.raises(ValueError, match="timezone-aware"):
        stamp_fetched_at(datetime(2026, 1, 1), off)

    clock = FakeClock()
    c = client(
        lambda req: httpx.Response(200, content=b"x"), clock, clock_offset=timedelta(seconds=3)
    )
    assert c.fetch(spec()).fetched_at == clock.wall() + timedelta(seconds=3)


def test_parse_retry_after_forms() -> None:
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    assert parse_retry_after("120", now) == 120.0
    assert parse_retry_after("Sun, 01 Nov 2026 12:01:00 GMT", now) == 60.0
    assert parse_retry_after("garbage", now) is None
    assert parse_retry_after(None, now) is None


def test_settings_from_source_entry() -> None:
    st = HttpSettings.from_source(
        {
            "base_url": BASE,
            "http": {"timeout_s": 30, "retries": {"max": 2, "on": [429, "timeout"]}},
            "rate_limit": {"max_concurrent": 2, "min_interval_s": 2, "budget_per_hour": 8},
        }
    )
    assert st.timeout_s == 30
    assert st.retries.max == 2
    assert st.retries.on == {429, "timeout"}
    assert st.rate_limit == RateLimitConfig(2, 2.0, 8, None)
    assert st.allowed_hosts == {"api.example.test"}


def test_jitter_is_bounded() -> None:
    st = HttpSettings(base_url=BASE, retries=RetryConfig(max=1, backoff_s=10, jitter=True))
    c = client(lambda req: httpx.Response(500), settings=st, rng=random.Random(1))
    assert 5.0 <= c._backoff(0) <= 10.0
