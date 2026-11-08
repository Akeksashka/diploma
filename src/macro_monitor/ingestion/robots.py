"""RobotsGate (ADR-005, ingestion spec section 3.6).

Fetches ``/robots.txt`` once per host and 24 h (cache in ``ingest.request_state``, see
``state.py``), evaluates the exact URL for the project User-Agent and honours ``Crawl-delay``.

- ``kind: web`` sources are fail-closed: a disallowed or unreadable robots file (anything but
  404, which means no restrictions) skips the source. A web source without a current terms and
  robots review is skipped before any request is made (AC-CFG-4).
- Documented APIs and bulk files run in log-only mode: the decision is recorded and a Disallow
  is logged and flagged ``escalate`` for the user, never overridden by the agent.

The decision string is what the manifest stores in ``raw_object.robots_decision``.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal, Protocol
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from macro_monitor.ingestion.http import HttpClient
from macro_monitor.models.types import RequestSpec
from macro_monitor.registry.config import web_review_ok

log = logging.getLogger(__name__)

ROBOTS_TTL = timedelta(hours=24)
MAX_ROBOTS_BYTES = 512 * 1024

# Decision values (fail-closed, kind: web)
ALLOWED = "allowed"
ALLOWED_NO_ROBOTS = "allowed_no_robots"  # robots.txt answered 404: no restrictions
DISALLOWED = "disallowed"
UNREADABLE = "unreadable"
SKIPPED_REVIEW = "skipped_review"  # web source without a current terms/robots review
LOG_ONLY_PREFIX = "log_only:"  # documented API / bulk file: decision recorded, never enforced

RobotsState = Literal["present", "absent"]


@dataclass(frozen=True)
class CachedRobots:
    """A fetched robots.txt as kept in the cache (``body`` is None when the file is absent)."""

    url: str
    state: RobotsState
    body: str | None
    sha256: str | None
    checked_at: datetime


class RobotsCache(Protocol):
    def load(self, host: str) -> CachedRobots | None: ...

    def save(self, host: str, entry: CachedRobots) -> None: ...


class InMemoryRobotsCache:
    def __init__(self) -> None:
        self._entries: dict[str, CachedRobots] = {}
        self._lock = threading.Lock()

    def load(self, host: str) -> CachedRobots | None:
        with self._lock:
            return self._entries.get(host)

    def save(self, host: str, entry: CachedRobots) -> None:
        with self._lock:
            self._entries[host] = entry


@dataclass(frozen=True)
class RobotsDecision:
    """Result of one gate check; decision, robots_sha256 and checked_at go on the raw object."""

    allowed: bool  # False: do not fetch (only ever False for enforced checks)
    decision: str
    enforced: bool
    robots_sha256: str | None
    checked_at: datetime | None
    crawl_delay_s: float | None = None
    escalate: bool = False  # log-only mode saw a Disallow: report to the user

    @property
    def outcome(self) -> Literal["ok", "skipped_robots"]:
        return "ok" if self.allowed else "skipped_robots"


def effective_min_interval(configured_s: float, crawl_delay_s: float | None) -> float:
    """The larger of the configured spacing and the host's ``Crawl-delay``."""
    return max(configured_s, crawl_delay_s or 0.0)


def _evaluate(body: str, user_agent: str, url: str) -> tuple[bool, float | None]:
    parser = RobotFileParser()
    parser.parse(body.splitlines())
    delay = parser.crawl_delay(user_agent)
    return parser.can_fetch(user_agent, url), (float(delay) if delay is not None else None)


class RobotsGate:
    def __init__(
        self, client: HttpClient, cache: RobotsCache | None = None, ttl: timedelta = ROBOTS_TTL
    ) -> None:
        self._client = client
        self._cache: RobotsCache = cache if cache is not None else InMemoryRobotsCache()
        self._ttl = ttl
        self._lock = threading.Lock()

    def check(
        self, source: Mapping[str, Any], url: str, *, today: date | None = None
    ) -> RobotsDecision:
        """Decide whether ``url`` of ``source`` (a validated sources.yaml entry) may be fetched."""
        is_web = source.get("kind") == "web"
        now = self._client.clock.wall()
        if is_web and not web_review_ok(source, today or now.date()):
            # No request of any kind, not even robots.txt (AC-CFG-4).
            return RobotsDecision(False, SKIPPED_REVIEW, True, None, None)

        parts = urlsplit(url)
        host = parts.hostname
        if parts.scheme != "https" or not host:
            return self._finish(False, UNREADABLE, is_web, None, None)

        with self._lock:
            entry = self._get_entry(host, now)
        if entry is None:
            return self._finish(False, UNREADABLE, is_web, None, None)
        if entry.state == "absent" or entry.body is None:
            return self._finish(True, ALLOWED_NO_ROBOTS, is_web, entry, None)
        allowed, delay = _evaluate(entry.body, self._client.user_agent, url)
        return self._finish(allowed, ALLOWED if allowed else DISALLOWED, is_web, entry, delay)

    # ----------------------------------------------------------------- helpers

    def _get_entry(self, host: str, now: datetime) -> CachedRobots | None:
        cached = self._cache.load(host)
        if cached is not None and timedelta(0) <= now - cached.checked_at < self._ttl:
            return cached
        robots_url = f"https://{host}/robots.txt"
        spec = RequestSpec(
            source_id="robots",
            group_id="robots",
            method="GET",
            url=robots_url,
            params={},
            headers={},
            request_key=hashlib.sha256(f"GET {robots_url}".encode()).hexdigest(),
            fetch_mode="full",
            expect_scope="complete",
        )
        result = self._client.fetch(spec)
        if result.outcome == "new" and result.body is not None:
            raw = result.body[:MAX_ROBOTS_BYTES]
            entry = CachedRobots(
                robots_url,
                "present",
                raw.decode("utf-8", errors="replace"),
                hashlib.sha256(raw).hexdigest(),
                result.fetched_at,
            )
        elif result.status == 404:
            entry = CachedRobots(robots_url, "absent", None, None, result.fetched_at)
        else:
            log.warning(
                "robots.txt of %s unreadable (%s, status %s)", host, result.outcome, result.status
            )
            return None  # failures are not cached: the next check tries again
        self._cache.save(host, entry)
        return entry

    def _finish(
        self,
        allowed: bool,
        decision: str,
        is_web: bool,
        entry: CachedRobots | None,
        delay: float | None,
    ) -> RobotsDecision:
        sha = entry.sha256 if entry else None
        checked = entry.checked_at if entry else None
        if is_web:
            return RobotsDecision(allowed, decision, True, sha, checked, delay)
        escalate = decision in (DISALLOWED, UNREADABLE)
        if escalate:
            log.warning(
                "robots (log-only) %s for a documented endpoint: escalate to the user", decision
            )
        return RobotsDecision(
            True, LOG_ONLY_PREFIX + decision, False, sha, checked, delay, escalate=escalate
        )
