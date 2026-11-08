"""Cutoff transaction and analysis run record (T36, I-CUR-9, ADR-002, AC-ING-15).

At the start of ``analyze``, in one short transaction on a DIRECT connection (never a pooler), the
run takes ``pg_advisory_xact_lock(hashtext('mm-load'))`` (the loader's lock, so it waits for any
in-flight load to commit), reads ``known_cutoff = load_cutoff = clock_timestamp()`` from the
DATABASE (never the runner clock, never ``transaction_timestamp()``) and inserts the
``analytics.run`` row with ``RETURNING analysis_run_id``. The commit releases the lock.

A ``lock_timeout`` failure raises :class:`CutoffLockTimeout` and fails the run by design: a run
without a trustworthy cutoff must not exist.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import psycopg
from psycopg import errors

LOCK_NAME = (
    "mm-load"  # same name as storage.loader.LOCK_NAME (kept local: loader.py is not imported)
)
DEFAULT_LOCK_TIMEOUT_MS = 600_000  # 10 min, as the loader

HASH_FIELDS = ("git_sha", "config_sha256", "mapping_sha256", "overrides_sha256")


class CutoffLockTimeout(RuntimeError):
    """The load lock was not obtained within ``lock_timeout``; the analysis run fails."""


@dataclass(frozen=True)
class RunRecord:
    """The ``analytics.run`` row as written."""

    analysis_run_id: int
    known_cutoff: datetime
    load_cutoff: datetime
    ingest_run_id: int
    as_of_run_date: date
    code_version: str
    git_sha: str
    config_asof: datetime
    config_sha256: str
    mapping_sha256: str
    overrides_sha256: str


@dataclass(frozen=True)
class HashMismatch:
    field: str
    stored: str
    current: str


def start_run(
    conn: psycopg.Connection[Any],
    *,
    ingest_run_id: int,
    as_of_run_date: date,
    code_version: str,
    params: Mapping[str, Any],
    git_sha: str,
    config_asof: datetime,
    config_sha256: str,
    mapping_sha256: str,
    overrides_sha256: str,
    lock_timeout_ms: int = DEFAULT_LOCK_TIMEOUT_MS,
) -> RunRecord:
    """Take the load lock, read the DB-clock cutoff, insert the run row, commit (one short tx).

    ``conn`` must not be inside an open transaction. Raises :class:`CutoffLockTimeout` when the
    lock is not obtained in time (the transaction is rolled back, no run row exists).
    """
    if conn.info.transaction_status != psycopg.pq.TransactionStatus.IDLE:
        raise RuntimeError("start_run needs a connection outside any transaction")
    try:
        with conn.transaction():
            conn.execute(
                "SELECT set_config('lock_timeout', %s, true)", [f"{int(lock_timeout_ms)}ms"]
            )
            conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [LOCK_NAME])
            # AFTER the lock is held; clock_timestamp(), not transaction_timestamp() (I-CUR-9).
            cur = conn.execute("SELECT clock_timestamp()").fetchone()
            assert cur is not None
            cutoff: datetime = cur[0]
            row = conn.execute(
                "INSERT INTO analytics.run (ingest_run_id, as_of_run_date, known_cutoff, "
                "load_cutoff, code_version, params, git_sha, config_asof, config_sha256, "
                "mapping_sha256, overrides_sha256) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "RETURNING analysis_run_id",
                [
                    ingest_run_id, as_of_run_date, cutoff, cutoff, code_version,
                    json.dumps(dict(params), sort_keys=True, default=str), git_sha, config_asof,
                    config_sha256, mapping_sha256, overrides_sha256,
                ],
            ).fetchone()  # fmt: skip
            assert row is not None
    except errors.LockNotAvailable as exc:
        raise CutoffLockTimeout(
            f"load lock not obtained within {lock_timeout_ms} ms; analysis run fails"
        ) from exc
    return RunRecord(
        analysis_run_id=int(row[0]),
        known_cutoff=cutoff,
        load_cutoff=cutoff,
        ingest_run_id=ingest_run_id,
        as_of_run_date=as_of_run_date,
        code_version=code_version,
        git_sha=git_sha,
        config_asof=config_asof,
        config_sha256=config_sha256,
        mapping_sha256=mapping_sha256,
        overrides_sha256=overrides_sha256,
    )


def load_run(conn: psycopg.Connection[Any], analysis_run_id: int) -> RunRecord:
    """Read a stored run row (for reproduction)."""
    row = conn.execute(
        "SELECT analysis_run_id, known_cutoff, load_cutoff, ingest_run_id, as_of_run_date, "
        "code_version, git_sha, config_asof, config_sha256, mapping_sha256, overrides_sha256 "
        "FROM analytics.run WHERE analysis_run_id = %s",
        [analysis_run_id],
    ).fetchone()
    if row is None:
        raise LookupError(f"analysis run {analysis_run_id} not found")
    return RunRecord(*row)


def compare_hashes(stored: RunRecord, current: Mapping[str, str]) -> list[HashMismatch]:
    """Report every recorded hash that differs from the current one (missing keys are mismatches).

    Reproduction of a stored run must report these instead of silently using other inputs.
    """
    out: list[HashMismatch] = []
    for name in HASH_FIELDS:
        have = str(getattr(stored, name))
        want = current.get(name)
        if want is None or want != have:
            out.append(HashMismatch(name, have, "<missing>" if want is None else want))
    return out
