"""Per-host rate limiting and request budgets (ingestion spec section 3, items 2 and 4).

Time is injected (``Clock``) so tests run on a fake clock. Hour and day budgets live in a
``BudgetStore``; T20 provides the Postgres-backed store (``ingest.request_state`` counters), the
in-memory store here is for tests and single-run use.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol


class Clock(Protocol):
    def monotonic(self) -> float: ...

    def sleep(self, seconds: float) -> None: ...

    def wall(self) -> datetime: ...


class SystemClock:
    def monotonic(self) -> float:
        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        if seconds > 0:
            time.sleep(seconds)

    def wall(self) -> datetime:
        return datetime.now(UTC)


class BudgetStore(Protocol):
    """Counters of requests made in a window, persisted across runs by the DB implementation."""

    def get(self, host: str, window: str) -> int: ...

    def increment(self, host: str, window: str) -> None: ...

    def try_acquire(
        self,
        host: str,
        hour: tuple[str, int | None],
        day: tuple[str, int | None],
    ) -> str | None:
        """Atomically count one request in the hour and day windows unless a limit is reached.

        Each argument is ``(window label, limit or None)``. Returns ``None`` when counted, else
        the label of the exhausted window (nothing counted). Check and increment are one step,
        so two processes cannot both pass at ``limit - 1``.
        """
        ...


class InMemoryBudgetStore:
    def __init__(self) -> None:
        self._counts: dict[tuple[str, str], int] = {}
        self._lock = threading.Lock()

    def get(self, host: str, window: str) -> int:
        with self._lock:
            return self._counts.get((host, window), 0)

    def increment(self, host: str, window: str) -> None:
        with self._lock:
            self._counts[(host, window)] = self._counts.get((host, window), 0) + 1

    def try_acquire(
        self,
        host: str,
        hour: tuple[str, int | None],
        day: tuple[str, int | None],
    ) -> str | None:
        with self._lock:
            for window, limit in (hour, day):
                if limit is not None and self._counts.get((host, window), 0) >= limit:
                    return window
            for window, _ in (hour, day):
                self._counts[(host, window)] = self._counts.get((host, window), 0) + 1
            return None


@dataclass(frozen=True)
class RateLimitConfig:
    max_concurrent: int = 1
    min_interval_s: float = 0.0
    budget_per_hour: int | None = None
    budget_per_day: int | None = None

    def __post_init__(self) -> None:
        if self.max_concurrent < 1:
            raise ValueError("max_concurrent must be >= 1")
        if self.min_interval_s < 0:
            raise ValueError("min_interval_s must be >= 0")
        for name in ("budget_per_hour", "budget_per_day"):
            v = getattr(self, name)
            if v is not None and v < 0:
                raise ValueError(f"{name} must be >= 0 or None")


class BudgetExhausted(Exception):
    """The hour or day budget of a host is used up; remaining requests defer to catch-up."""

    def __init__(self, host: str, window: str) -> None:
        super().__init__(f"request budget exhausted for {host} ({window})")
        self.host = host
        self.window = window


def hour_window(now: datetime) -> str:
    return now.astimezone(UTC).strftime("h%Y%m%d%H")


def day_window(now: datetime) -> str:
    return now.astimezone(UTC).strftime("d%Y%m%d")


class RateLimiter:
    """Spacing (min interval), concurrency and budgets for one host."""

    def __init__(
        self,
        host: str,
        config: RateLimitConfig,
        clock: Clock,
        budgets: BudgetStore | None = None,
    ) -> None:
        self.host = host
        self.config = config
        self._clock = clock
        self._budgets: BudgetStore = budgets if budgets is not None else InMemoryBudgetStore()
        self._lock = threading.Lock()
        self._next_slot: float | None = None
        self._semaphore = threading.BoundedSemaphore(config.max_concurrent)

    def acquire(self) -> None:
        """Reserve a request slot: check budgets, count the request, wait for the spacing.

        Raises ``BudgetExhausted`` without counting when a budget is used up. Call ``release``
        when the request finishes.
        """
        self._semaphore.acquire()
        try:
            with self._lock:
                now_wall = self._clock.wall()
                exhausted = self._budgets.try_acquire(
                    self.host,
                    (hour_window(now_wall), self.config.budget_per_hour),
                    (day_window(now_wall), self.config.budget_per_day),
                )
                if exhausted is not None:
                    raise BudgetExhausted(self.host, exhausted)
                now = self._clock.monotonic()
                slot = now if self._next_slot is None else max(now, self._next_slot)
                self._next_slot = slot + self.config.min_interval_s
                wait = slot - now
            self._clock.sleep(wait)
        except BaseException:
            self._semaphore.release()
            raise

    def release(self) -> None:
        self._semaphore.release()
