"""Unit tests for macro_monitor.ingestion.robots (T20); MockTransport, fake clock, no network."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import httpx
import pytest

from macro_monitor.ingestion.http import HttpClient, HttpSettings
from macro_monitor.ingestion.ratelimit import RateLimitConfig
from macro_monitor.ingestion.robots import (
    ALLOWED,
    ALLOWED_NO_ROBOTS,
    DISALLOWED,
    SKIPPED_REVIEW,
    UNREADABLE,
    InMemoryRobotsCache,
    RobotsGate,
    effective_min_interval,
)

pytestmark = pytest.mark.unit

BASE = "https://site.example.test/"
REPO = "https://example.test/repo"
TODAY = date(2026, 11, 1)


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 1, 6, 0, tzinfo=UTC)
        self.mono = 0.0

    def monotonic(self) -> float:
        return self.mono

    def sleep(self, seconds: float) -> None:
        self.mono += seconds
        self.now += timedelta(seconds=seconds)

    def wall(self) -> datetime:
        return self.now


def web_source(**over: object) -> dict[str, object]:
    src: dict[str, object] = {
        "id": "w",
        "kind": "web",
        "terms_review": {"decision": "permitted", "reviewed_on": "2026-10-17"},
        "robots_review": {"decision": "permitted", "reviewed_on": "2026-10-17"},
    }
    src.update(over)
    return src


def api_source() -> dict[str, object]:
    return {"id": "a", "kind": "rest"}


def make(
    handler: object, clock: FakeClock | None = None, cache: InMemoryRobotsCache | None = None
) -> tuple[RobotsGate, list[httpx.Request], FakeClock]:
    clock = clock or FakeClock()
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)  # type: ignore[operator, no-any-return]

    client = HttpClient(
        HttpSettings(base_url=BASE, rate_limit=RateLimitConfig()),
        repo_url=REPO,
        clock=clock,
        transport=httpx.MockTransport(wrapped),
    )
    return RobotsGate(client, cache), seen, clock


def robots(body: str) -> object:
    return lambda request: httpx.Response(200, text=body)


def test_allowed_and_disallowed_paths() -> None:
    gate, _, _ = make(robots("User-agent: *\nDisallow: /private/\nCrawl-delay: 7\n"))
    ok = gate.check(web_source(), BASE + "data/x.html", today=TODAY)
    assert ok.allowed
    assert ok.decision == ALLOWED
    assert ok.enforced
    assert ok.crawl_delay_s == 7.0
    assert ok.robots_sha256
    assert len(ok.robots_sha256) == 64
    assert ok.checked_at is not None
    no = gate.check(web_source(), BASE + "private/x.html", today=TODAY)
    assert not no.allowed
    assert no.decision == DISALLOWED
    assert no.outcome == "skipped_robots"


def test_project_user_agent_group_is_used() -> None:
    body = "User-agent: macro-monitor\nDisallow: /\n\nUser-agent: *\nDisallow:\n"
    gate, _, _ = make(robots(body))
    assert not gate.check(web_source(), BASE + "a", today=TODAY).allowed


def test_404_means_no_restrictions() -> None:
    gate, _, _ = make(lambda r: httpx.Response(404))
    d = gate.check(web_source(), BASE + "a", today=TODAY)
    assert d.allowed
    assert d.decision == ALLOWED_NO_ROBOTS
    assert d.robots_sha256 is None


@pytest.mark.parametrize("status", [403, 500, 503])
def test_unreadable_robots_skips_web_source(status: int) -> None:
    gate, _, _ = make(lambda r: httpx.Response(status))
    d = gate.check(web_source(), BASE + "a", today=TODAY)
    assert not d.allowed
    assert d.decision == UNREADABLE
    assert d.enforced


def test_transport_error_is_unreadable() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    gate, _, _ = make(boom)
    assert not gate.check(web_source(), BASE + "a", today=TODAY).allowed


def test_documented_api_is_log_only() -> None:
    gate, _, _ = make(robots("User-agent: *\nDisallow: /\n"))
    d = gate.check(api_source(), BASE + "api", today=TODAY)
    assert d.allowed
    assert not d.enforced
    assert d.escalate
    assert d.decision == "log_only:disallowed"
    gate2, _, _ = make(lambda r: httpx.Response(500))
    d2 = gate2.check(api_source(), BASE + "api", today=TODAY)
    assert d2.allowed
    assert d2.escalate
    assert d2.decision == "log_only:unreadable"
    gate3, _, _ = make(robots("User-agent: *\nDisallow: /x\n"))
    d3 = gate3.check(api_source(), BASE + "api", today=TODAY)
    assert d3.allowed
    assert not d3.escalate
    assert d3.decision == "log_only:allowed"


def test_cache_24h_then_refetch() -> None:
    gate, seen, clock = make(robots("User-agent: *\nDisallow:\n"))
    gate.check(web_source(), BASE + "a", today=TODAY)
    gate.check(web_source(), BASE + "b", today=TODAY)
    assert len(seen) == 1
    clock.now += timedelta(hours=23)
    gate.check(web_source(), BASE + "c", today=TODAY)
    assert len(seen) == 1
    clock.now += timedelta(hours=2)
    gate.check(web_source(), BASE + "d", today=TODAY)
    assert len(seen) == 2
    assert all(r.url.path == "/robots.txt" for r in seen)


def test_failures_are_not_cached() -> None:
    answers = [httpx.Response(403), httpx.Response(200, text="User-agent: *\nDisallow:\n")]
    gate, seen, _ = make(lambda r: answers.pop(0))
    assert not gate.check(web_source(), BASE + "a", today=TODAY).allowed
    assert gate.check(web_source(), BASE + "a", today=TODAY).allowed
    assert len(seen) == 2


@pytest.mark.parametrize(
    "over",
    [
        {"terms_review": None},
        {"robots_review": None},
        {"terms_review": {"decision": "forbidden", "reviewed_on": "2026-10-17"}},
        {"terms_review": {"decision": "permitted", "reviewed_on": "2025-01-01"}},
        {"robots_review": {"decision": "disallowed", "reviewed_on": "2026-10-17"}},
    ],
)
def test_ac_cfg_4_web_source_without_review_never_fetched(over: dict[str, object]) -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request may be made for an unreviewed web source")

    gate, seen, _ = make(fail)
    src = web_source(**over)
    for k, v in over.items():
        if v is None:
            del src[k]
    d = gate.check(src, BASE + "page", today=TODAY)
    assert not d.allowed
    assert d.decision == SKIPPED_REVIEW
    assert d.outcome == "skipped_robots"
    assert seen == []


def test_non_https_url_is_refused() -> None:
    gate, seen, _ = make(robots(""))
    assert not gate.check(web_source(), "http://site.example.test/a", today=TODAY).allowed
    assert seen == []


def test_effective_min_interval() -> None:
    assert effective_min_interval(5, 10) == 10
    assert effective_min_interval(5, None) == 5
    assert effective_min_interval(5, 2) == 5
