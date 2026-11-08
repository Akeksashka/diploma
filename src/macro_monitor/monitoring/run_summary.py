# ruff: noqa: E501
"""``ops.run_summary`` writer and the ``ops/heartbeat.json`` payload (validation-monitoring-spec section 5).

The heartbeat carries only the run id, a UTC timestamp and group statuses: no data values.
"""

from __future__ import annotations

import json
import time
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

GROUP_STATUSES = frozenset(
    {"ok", "partial", "failed", "skipped_disabled", "skipped_unchanged", "skipped_manual"}
)


def measure_clock_offset_ms(conn: psycopg.Connection) -> int:
    """Runner clock minus database ``clock_timestamp()`` in ms (positive: runner ahead), midpoint-corrected."""
    t0 = time.time()
    row = conn.execute("SELECT extract(epoch FROM clock_timestamp())").fetchone()
    t1 = time.time()
    assert row is not None
    return round(((t0 + t1) / 2 - float(row[0])) * 1000)


def measure_connect_ms(dsn: str) -> int:
    """Time a fresh connection (Neon cold start included) in ms."""
    t0 = time.monotonic()
    with psycopg.connect(dsn, connect_timeout=30):
        pass
    return round((time.monotonic() - t0) * 1000)


def database_bytes(conn: psycopg.Connection) -> int:
    row = conn.execute("SELECT pg_database_size(current_database())").fetchone()
    assert row is not None
    return int(row[0])


def run_counts(conn: psycopg.Connection, run_id: int) -> dict[str, int]:
    """Unscoped counts for the run (the public-scope variant is ``ops.v_run_summary_public``)."""
    row = conn.execute(
        """
        SELECT (SELECT count(*) FROM ingest.raw_object WHERE run_id = %(r)s),
               (SELECT count(*) FILTER (WHERE load_kind IN ('initial','new_period')) FROM curated.observation WHERE run_id = %(r)s),
               (SELECT count(*) FILTER (WHERE load_kind = 'revision') FROM curated.observation WHERE run_id = %(r)s),
               (SELECT count(*) FILTER (WHERE load_kind = 'tombstone') FROM curated.observation WHERE run_id = %(r)s),
               (SELECT count(*) FILTER (WHERE value_status = 'MISS') FROM curated.observation WHERE run_id = %(r)s)
        """,
        {"r": run_id},
    ).fetchone()
    assert row is not None
    keys = ("new_raw_objects", "new_observations", "revisions", "tombstones", "miss_rows")
    return dict(zip(keys, (int(x) for x in row), strict=True))


def record_run_summary(
    conn: psycopg.Connection,
    run_id: int,
    group_statuses: Mapping[str, str],
    *,
    counts: Mapping[str, int] | None = None,
    neon_connect_ms: int | None = None,
    db_bytes: int | None = None,
    runner_clock_offset_ms: int | None = None,
    alerts_opened: int | None = None,
    cu_hours_note: str | None = None,
    extra: Mapping[str, Any] | None = None,
) -> None:
    """Insert the run's ``ops.run_summary`` row. ``groups`` holds statuses plus tombstone/MISS counts."""
    bad = {g: s for g, s in group_statuses.items() if s not in GROUP_STATUSES}
    if bad:
        raise ValueError(f"unknown group status: {bad}")
    c = dict(counts or {})
    groups: dict[str, Any] = {
        "statuses": dict(group_statuses),
        "tombstones": c.get("tombstones"),
        "miss_rows": c.get("miss_rows"),
        **(extra or {}),
    }
    conn.execute(
        "INSERT INTO ops.run_summary (run_id, neon_connect_ms, db_bytes, groups, new_raw_objects,"
        " new_observations, revisions, alerts_opened, cu_hours_note, runner_clock_offset_ms)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [run_id, neon_connect_ms, db_bytes, Jsonb(groups), c.get("new_raw_objects"),
         c.get("new_observations"), c.get("revisions"), alerts_opened, cu_hours_note,
         runner_clock_offset_ms],
    )  # fmt: skip


def heartbeat_payload(
    run_id: int | str, group_statuses: Mapping[str, str], now: datetime | None = None
) -> dict[str, Any]:
    ts = (now or datetime.now(UTC)).astimezone(UTC)
    return {
        "run_id": run_id,
        "timestamp_utc": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "groups": {g: str(s) for g, s in sorted(group_statuses.items())},
    }


def write_heartbeat(
    path: Path, run_id: int | str, group_statuses: Mapping[str, str], now: datetime | None = None
) -> dict[str, Any]:
    """Write the heartbeat JSON (committed by Actions, not here)."""
    payload = heartbeat_payload(run_id, group_statuses, now)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return payload
