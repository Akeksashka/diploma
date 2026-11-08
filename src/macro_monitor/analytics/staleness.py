"""Ranking staleness (analytics spec section 8, validation spec section 3, D14, T40).

``age_days = run_date - ref_period_end`` of the latest observation WITH a value;
``is_stale = age_days > limit``. A limit of exactly ``limit`` days is not stale, ``limit + 1`` is.
With ``release_lag_aware`` the limit is ``max(class_limit, typical_publication_lag_days +
tolerance_days)`` from the release calendar of the series' group, recorded with
``limit_source = 'release_lag_aware'``. Pure functions on plain types.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import yaml

CLASS_LIMITS: Mapping[str, int] = {
    "MKT45": 45,
    "SURV75": 75,
    "ACT120": 120,
    "Q270": 270,
    "A730": 730,
    "TRI1460": 1460,
    "EVENT": 730,  # no active row uses it
}

LIMIT_SOURCE_CLASS = "class"
LIMIT_SOURCE_LAG_AWARE = "release_lag_aware"


@dataclass(frozen=True)
class ReleaseTiming:
    """``typical_lag_days`` and ``tolerance_days`` of a group in ``release_calendar.yaml``."""

    typical_lag_days: int
    tolerance_days: int


@dataclass(frozen=True)
class StaleLimit:
    days: int
    source: str  # 'class' | 'release_lag_aware'


def class_limit(staleness_class: str) -> int:
    try:
        return CLASS_LIMITS[staleness_class]
    except KeyError:
        raise ValueError(f"unknown staleness class {staleness_class!r}") from None


def stale_limit(
    staleness_class: str, *, release_lag_aware: bool, timing: ReleaseTiming | None
) -> StaleLimit:
    """Limit in force. Lag-aware without timing for the group falls back to the class limit."""
    base = class_limit(staleness_class)
    if release_lag_aware and timing is not None:
        return StaleLimit(
            max(base, timing.typical_lag_days + timing.tolerance_days), LIMIT_SOURCE_LAG_AWARE
        )
    return StaleLimit(base, LIMIT_SOURCE_CLASS)


def age_days(run_date: date, ref_period_end: date) -> int:
    return (run_date - ref_period_end).days


def is_stale(age: int, limit_days: int) -> bool:
    return age > limit_days


def load_release_calendar(path: Path) -> dict[str, ReleaseTiming]:
    """``release_calendar.yaml``: group id -> timing (entries without both fields are skipped)."""
    data: Any = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[str, ReleaseTiming] = {}
    for group, entry in data.items():
        if isinstance(entry, Mapping) and "typical_lag_days" in entry and "tolerance_days" in entry:
            out[str(group)] = ReleaseTiming(
                int(entry["typical_lag_days"]), int(entry["tolerance_days"])
            )
    return out
