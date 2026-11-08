# ruff: noqa: E501
"""Release-calendar-aware freshness (validation-monitoring-spec section 2; FRESH-01).

Pure evaluation functions plus a thin database reader/writer for ``ops.freshness_state``.
``source_group`` stores the source id and ``series_group`` the group id (calendar keys are group ids).
"""

from __future__ import annotations

import calendar
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal

import psycopg

State = Literal["fresh", "late", "stale", "broken"]
STALE_SHARE_LIMIT = 0.20


class CalendarError(ValueError):
    """A release_calendar entry cannot be evaluated."""


@dataclass(frozen=True)
class CalendarEntry:
    frequency: str | None = None
    typical_lag_days: int = 0
    tolerance_days: int = 0
    release_months: tuple[int, ...] = ()

    @classmethod
    def from_mapping(cls, m: Mapping[str, Any]) -> CalendarEntry:
        if "dates" in m:
            raise CalendarError("explicit 'dates' are not supported yet (format unspecified)")
        months = tuple(int(x) for x in m.get("release_months", ()))
        if months:
            return cls(None, 0, int(m["tolerance_days"]), months)
        freq = str(m["frequency"])
        if freq not in {"M", "Q", "A"}:
            raise CalendarError(f"unsupported frequency {freq!r}")
        return cls(freq, int(m["typical_lag_days"]), int(m["tolerance_days"]))


def _month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def period_end_on_or_before(freq: str, d: date) -> date:
    """End of the latest period of ``freq`` that ends on or before ``d``."""
    step = {"M": 1, "Q": 3, "A": 12}[freq]
    y, m = d.year, d.month
    if freq == "Q":
        m = (m - 1) // 3 * 3 + 3
    elif freq == "A":
        m = 12
    end = _month_end(y, m)
    while end > d:
        m -= step
        while m < 1:
            m += 12
            y -= 1
        end = _month_end(y, m)
    return end


def previous_period_end(freq: str, end: date) -> date:
    return period_end_on_or_before(freq, _first_of_period(freq, end) - timedelta(days=1))


def _first_of_period(freq: str, end: date) -> date:
    back = {"M": 0, "Q": 2, "A": 11}[freq]
    y, m = end.year, end.month - back
    if m < 1:
        m += 12
        y -= 1
    return date(y, m, 1)


def _periods_behind(freq: str, latest: date, expected: date) -> int:
    n, cur = 0, expected
    while cur > latest and n < 1000:
        cur = previous_period_end(freq, cur)
        n += 1
    return n


def expected_period_end(entry: CalendarEntry, today: date) -> date | None:
    if entry.release_months:
        return _latest_release_month_end(entry, today)
    assert entry.frequency is not None
    return period_end_on_or_before(entry.frequency, today - timedelta(days=entry.typical_lag_days))


def _latest_release_month_start(entry: CalendarEntry, today: date) -> date | None:
    best: date | None = None
    for y in (today.year - 1, today.year):
        for m in entry.release_months:
            first = date(y, m, 1)
            if first <= today and (best is None or first > best):
                best = first
    return best


def _latest_release_month_end(entry: CalendarEntry, today: date) -> date | None:
    first = _latest_release_month_start(entry, today)
    return _month_end(first.year, first.month) if first else None


def series_state(
    entry: CalendarEntry, today: date, latest_period_end: date | None, *, broken: bool = False
) -> tuple[State, date | None]:
    """Return (state, expected_period_end) for one series. ``latest_period_end`` counts MISS periods."""
    expected = expected_period_end(entry, today)
    if broken:
        return "broken", expected
    if expected is None:
        return "fresh", None
    if latest_period_end is None:
        return "stale", expected
    if latest_period_end >= expected:
        return "fresh", expected
    if entry.release_months:
        first = _latest_release_month_start(entry, today)
        assert first is not None
        if today <= first + timedelta(days=entry.tolerance_days):
            return "fresh", expected
        prev_end = _previous_edition_end(entry, first)
        return ("late" if latest_period_end >= prev_end else "stale"), expected
    freq = entry.frequency
    assert freq is not None
    behind = _periods_behind(freq, latest_period_end, expected)
    if today <= expected + timedelta(days=entry.typical_lag_days + entry.tolerance_days):
        # still within tolerance of the expected period's normal publication date
        return ("fresh" if behind <= 1 else "stale"), expected
    if behind >= 2:
        return "stale", expected
    age_since_pub = (today - (latest_period_end + timedelta(days=entry.typical_lag_days))).days
    if age_since_pub > 2 * entry.typical_lag_days + entry.tolerance_days:
        return "stale", expected
    return "late", expected


def _previous_edition_end(entry: CalendarEntry, first: date) -> date:
    d = first - timedelta(days=1)
    prev = _latest_release_month_start(entry, d)
    assert prev is not None
    return _month_end(prev.year, prev.month)


@dataclass(frozen=True)
class SeriesInput:
    series_id: int
    latest_period_end: date | None
    broken: bool = False
    core: bool = False
    known_stale: bool = False


def group_state(
    entry: CalendarEntry, today: date, series: Iterable[SeriesInput]
) -> tuple[State, date | None, date | None, list[int]]:
    """Group rule (spec section 2). Returns (state, expected, latest, known_stale series ids).

    ``known_stale`` series are reported separately (info) and excluded from the state vote.
    """
    items = list(series)
    info = [s.series_id for s in items if s.known_stale]
    voting = [s for s in items if not s.known_stale]
    expected = expected_period_end(entry, today)
    latest = max((s.latest_period_end for s in items if s.latest_period_end), default=None)
    states = [
        (s, series_state(entry, today, s.latest_period_end, broken=s.broken)[0]) for s in voting
    ]
    if any(st == "broken" and s.core for s, st in states):
        return "broken", expected, latest, info
    counts = Counter(st for _, st in states)
    if states and counts["stale"] / len(states) > STALE_SHARE_LIMIT:
        return "stale", expected, latest, info
    return ("late" if counts["late"] > counts["fresh"] else "fresh"), expected, latest, info


def read_series_inputs(
    conn: psycopg.Connection, known_stale: Mapping[int, str] | None = None
) -> dict[tuple[str, str], list[SeriesInput]]:
    """Headline series per (source_id, group_id): latest non-projection period end (MISS counts),
    core flag, and ``broken`` = error/blocked outcome in each of the last two runs that attempted the
    request key of the series' newest raw object."""
    known = known_stale or {}
    rows = conn.execute(
        """
        SELECT s.source_id, s.group_id, s.series_id,
               (SELECT max(o.ref_period_end) FROM curated.observation o
                 WHERE o.series_id = s.series_id AND o.value_status NOT IN ('PROJ','DEL')) AS latest,
               EXISTS (SELECT 1 FROM ref.series_map m JOIN ref.indicator i ON i.indicator_id = m.indicator_id
                        WHERE m.series_id = s.series_id AND m.role = 'headline' AND i.priority = 'core') AS core,
               (SELECT count(*) = 2 AND bool_and(a.outcome IN ('error','blocked'))
                  FROM (SELECT a2.outcome FROM ingest.fetch_attempt a2
                         WHERE a2.source_id = s.source_id AND a2.request_key = (
                               SELECT ro.request_key FROM curated.observation o2
                                 JOIN ingest.raw_object ro ON ro.raw_id = o2.raw_id
                                WHERE o2.series_id = s.series_id ORDER BY o2.obs_id DESC LIMIT 1)
                         ORDER BY a2.attempted_at DESC LIMIT 2) a) AS broken
          FROM ref.series s
         WHERE EXISTS (SELECT 1 FROM ref.series_map m WHERE m.series_id = s.series_id AND m.role = 'headline')
         ORDER BY s.source_id, s.group_id, s.series_id
        """
    ).fetchall()
    out: dict[tuple[str, str], list[SeriesInput]] = {}
    for src, grp, sid, latest, core, broken in rows:
        out.setdefault((src, grp), []).append(
            SeriesInput(sid, latest, bool(broken), bool(core), sid in known)
        )
    return out


def record_freshness(
    conn: psycopg.Connection,
    calendar_cfg: Mapping[str, Mapping[str, Any]],
    inputs: Mapping[tuple[str, str], list[SeriesInput]],
    evaluated_at: datetime,
    *,
    group_enabled: Mapping[tuple[str, str], bool],
) -> dict[tuple[str, str], State]:
    """Evaluate every group present in the calendar and insert one ``ops.freshness_state`` row each.

    Groups without a calendar entry are skipped (not evaluable); the caller may report them.
    ``group_enabled`` is ``SourcesConfig.effective_group_enabled`` (ADR-027 decision 7): a group
    mapped to false is not evaluated, so it has no row, no roll-up entry and no issue in this run.
    A group absent from the map is evaluated.
    """
    result: dict[tuple[str, str], State] = {}
    for (src, grp), series in inputs.items():
        if not group_enabled.get((src, grp), True):
            continue
        raw = calendar_cfg.get(grp)
        if raw is None:
            continue
        state, expected, latest, _ = group_state(
            CalendarEntry.from_mapping(raw), evaluated_at.date(), series
        )
        conn.execute(
            "INSERT INTO ops.freshness_state (source_group, series_group, evaluated_at, expected_period_end,"
            " latest_period_end, state) VALUES (%s,%s,%s,%s,%s,%s)",
            [src, grp, evaluated_at, expected, latest, state],
        )
        result[(src, grp)] = state
    return result
