"""Shared HTTP client (ingestion spec section 3, normative).

Covers: User-Agent template, per-host rate limiting and budgets, conditional headers, retries
with Retry-After and a 10-minute cap on total wait, bot-challenge detection, redirect host
policy, secret redaction, TLS always on and clock-offset stamping (BB25).

Not here: the robots gate and the persisted budget store (T20), Eurostat async polling
(T23, connector-specific), change-detection ladder (T21).
"""

from __future__ import annotations

import logging
import random
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit

import httpx

from macro_monitor import __version__
from macro_monitor.ingestion.ratelimit import (
    BudgetExhausted,
    BudgetStore,
    Clock,
    RateLimitConfig,
    RateLimiter,
    SystemClock,
)
from macro_monitor.models.types import FetchResult, RequestSpec

log = logging.getLogger(__name__)

MAX_TOTAL_WAIT_S = 600.0  # spec 3.4: maximum total wait per request
MAX_REDIRECTS = 5
MAX_BODY_BYTES = 256 * 1024 * 1024  # response size cap, enforced while streaming (not a config key)
ERR_REDIRECT_REFUSED = "redirect_refused"
ERR_BODY_TOO_LARGE = "body_too_large"
NEVER_RETRIED = frozenset(
    {413}
)  # request too large: retrying cannot help, whatever retries.on says
CLOCK_OFFSET_WARN_S = 5.0  # spec 3.9
REDACTED = "***"

_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_CHALLENGE_STATUSES = frozenset({403, 503})
_CHALLENGE_MARKERS = (
    b"just a moment",
    b"cf-chl",
    b"cf-browser-verification",
    b"_incapsula_",
    b"attention required! | cloudflare",
)
_CHALLENGE_SCAN_BYTES = 65536
_BROWSER_LIKE = ("mozilla", "chrome", "safari", "gecko", "applewebkit")


class HttpClientError(Exception):
    """Configuration or usage error of the client (messages are redacted)."""


@dataclass(frozen=True)
class RetryConfig:
    max: int = 4
    backoff_s: float = 2.0
    backoff_factor: float = 2.0
    jitter: bool = True
    on: frozenset[int | str] = frozenset({429, 500, 502, 503, 504, "timeout"})


def _discover_hosts(source: Mapping[str, Any]) -> frozenset[str]:
    """Hosts named by the ``discover.allowed_hosts`` of the source's groups (ADR-028)."""
    hosts: set[str] = set()
    for g in source.get("groups") or ():
        disc = (g.get("request_template") or {}).get("discover") or {}
        hosts.update(str(h) for h in disc.get("allowed_hosts") or ())
    return frozenset(hosts)


@dataclass(frozen=True)
class HttpSettings:
    """The ``http`` and ``rate_limit`` blocks of a sources.yaml entry plus its host policy."""

    base_url: str
    user_agent_template: str = "macro-monitor/{version} (+{repo_url}; non-commercial research)"
    timeout_s: float = 120.0
    retries: RetryConfig = field(default_factory=RetryConfig)
    rate_limit: RateLimitConfig = field(default_factory=RateLimitConfig)
    extra_hosts: frozenset[str] = frozenset()  # other hosts a redirect may go to

    @property
    def allowed_hosts(self) -> frozenset[str]:
        host = urlsplit(self.base_url).hostname
        return frozenset({host, *self.extra_hosts} if host else self.extra_hosts)

    @classmethod
    def from_source(cls, source: Mapping[str, Any]) -> HttpSettings:
        """Build from one validated ``sources.yaml`` source entry."""
        http = dict(source.get("http") or {})
        rl = dict(source.get("rate_limit") or {})
        r = dict(http.get("retries") or {})
        retry = RetryConfig(
            max=int(r.get("max", 4)),
            backoff_s=float(r.get("backoff_s", 2)),
            backoff_factor=float(r.get("backoff_factor", 2)),
            jitter=bool(r.get("jitter", True)),
            on=frozenset(r.get("on", RetryConfig().on)),
        )
        limit = RateLimitConfig(
            max_concurrent=int(rl.get("max_concurrent", 1)),
            min_interval_s=float(rl.get("min_interval_s", 0)),
            budget_per_hour=rl.get("budget_per_hour"),
            budget_per_day=rl.get("budget_per_day"),
        )
        kwargs: dict[str, Any] = {}
        if "user_agent_template" in http:
            kwargs["user_agent_template"] = str(http["user_agent_template"])
        if "timeout_s" in http:
            kwargs["timeout_s"] = float(http["timeout_s"])
        return cls(
            base_url=str(source["base_url"]),
            retries=retry,
            rate_limit=limit,
            extra_hosts=frozenset(source.get("redirect_hosts") or ()) | _discover_hosts(source),
            **kwargs,
        )


def render_user_agent(template: str, repo_url: str, version: str = __version__) -> str:
    """Render the User-Agent; never empty and never browser-like (spec 3.1)."""
    ua = template.format(version=version, repo_url=repo_url).strip()
    if not ua:
        raise HttpClientError("User-Agent is empty")
    lowered = ua.lower()
    if any(tok in lowered for tok in _BROWSER_LIKE):
        raise HttpClientError("User-Agent must identify the project, not impersonate a browser")
    return ua


class Redactor:
    """Removes secrets from URLs and text (spec 3.8)."""

    def __init__(self, secrets: Iterable[str] = (), param_names: Iterable[str] = ()) -> None:
        self._secrets = tuple(sorted({s for s in secrets if s}, key=len, reverse=True))
        self._params = frozenset(p.lower() for p in param_names)

    def text(self, value: str) -> str:
        for s in self._secrets:
            for variant in (s, quote(s, safe=""), quote(s)):
                value = value.replace(variant, REDACTED)
        return value

    def url(self, url: str) -> str:
        parts = urlsplit(url)
        query = [
            (k, REDACTED if k.lower() in self._params else v)
            for k, v in parse_qsl(parts.query, keep_blank_values=True)
        ]
        cleaned = urlunsplit(
            parts._replace(query=urlencode(query, safe="*"), netloc=_no_userinfo(parts))
        )
        return self.text(cleaned)


def _no_userinfo(parts: Any) -> str:
    host: str = parts.hostname or ""
    return f"{host}:{parts.port}" if parts.port else host


@dataclass(frozen=True)
class Validators:
    """Stored HTTP validators for a conditional request (change-detection ladder)."""

    etag: str | None = None
    last_modified: str | None = None


def measure_clock_offset(db_now: datetime, runner_now: datetime) -> timedelta:
    """Offset to add to the runner clock to get database time (BB25)."""
    return db_now - runner_now


def stamp_fetched_at(runner_now: datetime, offset: timedelta) -> datetime:
    """``fetched_at = runner_now + offset`` (UTC, timezone-aware)."""
    if runner_now.tzinfo is None:
        raise ValueError("runner_now must be timezone-aware")
    return runner_now + offset


def offset_needs_warning(offset: timedelta) -> bool:
    return abs(offset.total_seconds()) > CLOCK_OFFSET_WARN_S


def is_challenge(status: int, body: bytes) -> bool:
    if status not in _CHALLENGE_STATUSES:
        return False
    head = body[:_CHALLENGE_SCAN_BYTES].lower()
    return any(m in head for m in _CHALLENGE_MARKERS)


def parse_retry_after(value: str | None, now: datetime) -> float | None:
    """Seconds from a Retry-After header (delta-seconds or HTTP-date); None when unusable."""
    if value is None:
        return None
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        return None
    return max(0.0, (when - now).total_seconds())


class HttpClient:
    """One client per source. Synchronous; ``fetch`` never raises for HTTP-level problems."""

    def __init__(
        self,
        settings: HttpSettings,
        *,
        repo_url: str,
        clock: Clock | None = None,
        transport: httpx.BaseTransport | None = None,
        budgets: BudgetStore | None = None,
        secrets: Iterable[str] = (),
        secret_params: Iterable[str] = (),
        clock_offset: timedelta = timedelta(0),
        rng: random.Random | None = None,
        version: str = __version__,
    ) -> None:
        if not settings.base_url.lower().startswith("https://"):
            raise HttpClientError("TLS is always on: base_url must be https")
        self.settings = settings
        self.clock: Clock = clock or SystemClock()
        self.redactor = Redactor(secrets, secret_params)
        self.clock_offset = clock_offset
        self._rng = rng or random.Random()
        self.user_agent = render_user_agent(settings.user_agent_template, repo_url, version)
        host = urlsplit(settings.base_url).hostname or ""
        self.limiter = RateLimiter(host, settings.rate_limit, self.clock, budgets)
        # verify is left at the httpx default (True); redirects are followed by hand.
        self._client = httpx.Client(
            transport=transport,
            timeout=settings.timeout_s,
            follow_redirects=False,
            headers={"User-Agent": self.user_agent},
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> HttpClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------------------------------ public

    def fetch(
        self,
        spec: RequestSpec,
        validators: Validators | None = None,
        *,
        max_total_wait_s: float | None = None,
        max_body_bytes: int | None = None,
    ) -> FetchResult:
        """Execute ``spec``. Outcomes: new, not_modified, blocked, rate_limited, error.

        ``max_total_wait_s`` lowers the retry-wait ceiling (``MAX_TOTAL_WAIT_S``) for this call.
        ``max_body_bytes`` lowers the streamed body cap (``MAX_BODY_BYTES``) for this call.
        """
        body_cap = MAX_BODY_BYTES if max_body_bytes is None else min(MAX_BODY_BYTES, max_body_bytes)
        wait_cap = (
            MAX_TOTAL_WAIT_S
            if max_total_wait_s is None
            else min(MAX_TOTAL_WAIT_S, max(0.0, max_total_wait_s))
        )
        if not spec.url.lower().startswith("https://"):
            return self._result(spec, "error", None, None, None)
        host = urlsplit(spec.url).hostname
        if host not in self.settings.allowed_hosts:
            log.error("host not allowed for source %s: %s", spec.source_id, host)
            return self._result(spec, "error", None, None, None)

        headers = dict(spec.headers)
        if validators is not None:
            if validators.etag:
                headers["If-None-Match"] = validators.etag
            if validators.last_modified:
                headers["If-Modified-Since"] = validators.last_modified

        waited = 0.0
        attempt = 0
        retry = self.settings.retries
        while True:
            try:
                response = self._send(spec, headers, body_cap)
            except BudgetExhausted as exc:
                log.warning("%s: deferred to catch-up", self.redactor.text(str(exc)))
                return self._result(spec, "rate_limited", None, None, None)
            except _RedirectError as exc:
                log.error("redirect refused: %s", self.redactor.text(str(exc)))
                return self._result(
                    spec, "error", exc.status, None, None, error_class=ERR_REDIRECT_REFUSED
                )
            except _BodyTooLargeError as exc:
                log.error("response too large: %s", self.redactor.text(str(exc)))
                return self._result(
                    spec, "error", exc.status, None, None, error_class=ERR_BODY_TOO_LARGE
                )
            except httpx.TimeoutException as exc:
                log.warning("timeout: %s", self.redactor.text(str(exc)))
                if "timeout" in retry.on and attempt < retry.max:
                    delay = self._backoff(attempt)
                    if waited + delay <= wait_cap:
                        self.clock.sleep(delay)
                        waited += delay
                        attempt += 1
                        continue
                return self._result(spec, "error", None, None, None)
            except httpx.HTTPError as exc:
                log.error("transport error: %s", self.redactor.text(str(exc)))
                return self._result(spec, "error", None, None, None)

            status = response.status_code
            if status == 304:
                return self._result(spec, "not_modified", status, None, response)
            if 200 <= status < 300:
                return self._result(spec, "new", status, response.content, response)
            if is_challenge(status, response.content):
                # Never retried, never bypassed (ADR-005).
                return self._result(spec, "blocked", status, None, response)
            if status in retry.on and status not in NEVER_RETRIED and attempt < retry.max:
                delay = self._backoff(attempt)
                if status in (429, 503):
                    hinted = parse_retry_after(
                        response.headers.get("Retry-After"), self.clock.wall()
                    )
                    if hinted is not None:
                        delay = max(delay, hinted)
                if waited + delay <= wait_cap:
                    self.clock.sleep(delay)
                    waited += delay
                    attempt += 1
                    continue
            outcome = "rate_limited" if status == 429 else "error"
            return self._result(spec, outcome, status, None, response)

    # ----------------------------------------------------------------- helpers

    def _backoff(self, attempt: int) -> float:
        r = self.settings.retries
        delay = r.backoff_s * (r.backoff_factor**attempt)
        if r.jitter:
            delay *= 0.5 + self._rng.random() / 2
        return delay

    def _send(
        self, spec: RequestSpec, headers: Mapping[str, str], body_cap: int = MAX_BODY_BYTES
    ) -> httpx.Response:
        """One attempt (counted against the budget), following redirects within allowed hosts."""
        self.limiter.acquire()
        try:
            url = spec.url
            params: Mapping[str, str] | None = spec.params or None
            method = spec.method
            hdrs = dict(headers)
            origin = urlsplit(url).hostname
            for _ in range(MAX_REDIRECTS + 1):
                with self._client.stream(method, url, params=params, headers=hdrs) as streamed:
                    if streamed.status_code not in _REDIRECT_STATUSES:
                        return _read_capped(streamed, body_cap)
                    response = streamed
                    location = response.headers.get("Location")
                    if not location:
                        return _read_capped(streamed, body_cap)
                    target = urljoin(str(response.request.url), location)
                    status_code = response.status_code
                parts = urlsplit(target)
                if parts.scheme != "https":
                    raise _RedirectError(
                        f"redirect to non-TLS URL {self.redactor.url(target)}", status_code
                    )
                if parts.hostname not in self.settings.allowed_hosts:
                    raise _RedirectError(f"redirect to unlisted host {parts.hostname}", status_code)
                if parts.hostname != origin:
                    hdrs = {}  # never forward credentials to another host
                url, params = target, None
                if status_code == 303:
                    method = "GET"
            raise _RedirectError("too many redirects", 310)
        finally:
            self.limiter.release()

    def _result(
        self,
        spec: RequestSpec,
        outcome: str,
        status: int | None,
        body: bytes | None,
        response: httpx.Response | None,
        *,
        error_class: str | None = None,
    ) -> FetchResult:
        fetched_at = stamp_fetched_at(self.clock.wall(), self.clock_offset)
        h = response.headers if response is not None else httpx.Headers()
        return FetchResult(
            spec=spec,
            outcome=outcome,  # type: ignore[arg-type]
            status=status,
            body=body,
            fetched_at=fetched_at,
            etag=h.get("ETag"),
            last_modified=h.get("Last-Modified"),
            content_type=h.get("Content-Type"),
            update_marker=None,
            error_class=error_class,
        )


class _RedirectError(Exception):
    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


class _BodyTooLargeError(Exception):
    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


def _read_capped(response: httpx.Response, cap: int = MAX_BODY_BYTES) -> httpx.Response:
    """Read a streamed response, failing once it passes ``cap`` (decoded bytes)."""
    declared = response.headers.get("Content-Length")
    if declared is not None and declared.isdigit() and int(declared) > cap:
        raise _BodyTooLargeError(f"Content-Length {declared} exceeds {cap}", response.status_code)
    buf = bytearray()
    for chunk in response.iter_bytes():
        buf += chunk
        if len(buf) > cap:
            raise _BodyTooLargeError(f"body exceeds {cap} bytes", response.status_code)
    # iter_bytes already decoded the content: drop the encoding/length headers of the copy.
    headers = [
        (k, v)
        for k, v in response.headers.multi_items()
        if k.lower() not in ("content-encoding", "content-length")
    ]
    return httpx.Response(
        response.status_code,
        headers=headers,
        content=bytes(buf),
        request=response.request,
    )
