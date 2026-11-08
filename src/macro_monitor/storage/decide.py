"""Human decisions (T49; ingestion spec AC-ING-12, workflows spec section 11).

Everything here is insert-only history: ``ops.drift_decision`` (the ``ops.drift_event`` status
columns are a cache written in the same transaction, as the I-ING-6 style trigger demands) and
``ops.quality_override`` (a change of mind inserts a row that supersedes the previous one).
``skip_object`` ends a blocked object with ``raw_load.outcome = 'skipped_by_decision'``.
Deferred series are released afterwards by ``loader.release_deferred`` (``load --drain``).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

import psycopg
from psycopg.types.json import Jsonb

from macro_monitor.storage.loader import DEFAULT_LOCK_TIMEOUT_MS, _take_lock

DriftDecision = Literal["accepted", "rejected", "reopened"]
DRIFT_DECISIONS = ("accepted", "rejected", "reopened")
OVERRIDE_DECISIONS = ("exclude", "include")
_STATUS = {"accepted": "accepted", "rejected": "rejected", "reopened": "open"}


class DecideError(Exception):
    """A decision that cannot be recorded (unknown target, no change); the CLI exits 20."""


def decide_drift(
    conn: psycopg.Connection,
    *,
    event_id: int,
    decision: DriftDecision,
    decided_by: str,
    decided_on: date,
    note: str | None = None,
    git_sha: str | None = None,
) -> int:
    """Append a decision for a drift event and refresh its status cache; returns ``decision_id``."""
    if decision not in _STATUS:
        raise DecideError(f"decision must be one of {', '.join(DRIFT_DECISIONS)}")
    with conn.transaction():  # top-level: the trigger compares the xmin of the decision row
        row = conn.execute(
            "SELECT status FROM ops.drift_event WHERE event_id = %s FOR UPDATE", [event_id]
        ).fetchone()
        if row is None:
            raise DecideError(f"unknown drift event {event_id}")
        if row[0] == _STATUS[decision]:
            raise DecideError(f"drift event {event_id} is already {row[0]}")
        new = conn.execute(
            "INSERT INTO ops.drift_decision (event_id, decision, decided_by, decided_on, note, "
            "git_sha) VALUES (%s,%s,%s,%s,%s,%s) RETURNING decision_id",
            [event_id, decision, decided_by, decided_on, note, git_sha],
        ).fetchone()
        assert new is not None
        conn.execute(
            "UPDATE ops.drift_event SET status = %s, decided_by = %s, decided_on = %s, note = %s "
            "WHERE event_id = %s",
            [_STATUS[decision], decided_by, decided_on, note, event_id],
        )
    return int(new[0])


def skip_object(
    conn: psycopg.Connection,
    *,
    raw_id: int,
    run_id: int,
    decided_by: str,
    decided_on: date,
    note: str | None = None,
    lock_timeout_ms: int = DEFAULT_LOCK_TIMEOUT_MS,
) -> None:
    """End an unloaded (for example blocked) object: ``raw_load`` outcome ``skipped_by_decision``.

    Later objects of the group are no longer held behind it (ORD-02). No observation is written
    and the load-side ``request_state`` pointers do not advance.
    """
    with conn.transaction():
        t_load = _take_lock(conn, lock_timeout_ms)
        if (
            conn.execute(
                "SELECT 1 FROM ingest.v_raw_unloaded WHERE raw_id = %s", [raw_id]
            ).fetchone()
            is None
        ):
            raise DecideError(f"raw_id {raw_id} does not exist or is already loaded or decided")
        detail: dict[str, Any] = {
            "decision": "skip_object", "decided_by": decided_by, "decided_on": str(decided_on),
            "note": note,
        }  # fmt: skip
        conn.execute(
            "INSERT INTO ingest.raw_load (raw_id, outcome, load_run_id, loaded_at, detail) "
            "VALUES (%s,'skipped_by_decision',%s,%s,%s)",
            [raw_id, run_id, t_load, Jsonb(detail)],
        )


def quality_override(
    conn: psycopg.Connection,
    *,
    series_id: int,
    ref_period_start: date,
    known_at: datetime | None,
    decision: str,
    reason: str,
    decided_by: str,
    decided_on: date,
) -> int:
    """Insert an exclude/include override; it supersedes the latest one of the same key."""
    if decision not in OVERRIDE_DECISIONS:
        raise DecideError(f"override decision must be one of {', '.join(OVERRIDE_DECISIONS)}")
    if not reason.strip():
        raise DecideError("an override needs a reason")
    with conn.transaction():
        if (
            conn.execute("SELECT 1 FROM ref.series WHERE series_id = %s", [series_id]).fetchone()
            is None
        ):
            raise DecideError(f"unknown series_id {series_id}")
        prev = conn.execute(
            "SELECT override_id FROM ops.quality_override WHERE series_id = %s "
            "AND ref_period_start = %s AND known_at IS NOT DISTINCT FROM %s "
            "ORDER BY override_id DESC LIMIT 1",
            [series_id, ref_period_start, known_at],
        ).fetchone()
        row = conn.execute(
            "INSERT INTO ops.quality_override (series_id, ref_period_start, known_at, decision, "
            "reason, decided_by, decided_on, supersedes_override_id) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING override_id",
            [
                series_id, ref_period_start, known_at, decision, reason, decided_by, decided_on,
                None if prev is None else prev[0],
            ],
        ).fetchone()  # fmt: skip
    assert row is not None
    return int(row[0])
