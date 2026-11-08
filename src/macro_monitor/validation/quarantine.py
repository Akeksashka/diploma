"""Persistence of validation outcomes and the all-or-nothing load gate (ADR-007, AC-VAL-6).

``ops.validation_result`` and ``staging.rejected`` are written and committed BEFORE the load
transaction starts, so a blocked object still leaves its findings; the load itself runs in one
transaction that is rolled back when any ``error`` blocks it, either before the load (pre-load
results) or after it (``post_checks`` run inside the same transaction). No frame appears here.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime

import psycopg
from psycopg.pq import TransactionStatus

from macro_monitor.models.enums import QualityFlag
from macro_monitor.validation.checks import (
    CheckResult,
    RejectedItem,
    Verdict,
    decide,
    rejected_items,
)

LoadFn = Callable[[psycopg.Connection], None]
PostChecksFn = Callable[[psycopg.Connection], Sequence[CheckResult]]

_INSERT_RESULT = """
INSERT INTO ops.validation_result
  (run_id, check_id, severity, source_id, subject, passed, metric, threshold, detail)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
"""

_INSERT_REJECTED = """
INSERT INTO staging.rejected
  (run_id, raw_id, series_ref, ref_period, raw_value, reason_code, detail)
SELECT %(run_id)s, %(raw_id)s, %(series_ref)s, %(ref_period)s, %(raw_value)s,
       %(reason_code)s, %(detail)s
WHERE NOT EXISTS (
  SELECT 1 FROM staging.rejected r
   WHERE r.run_id = %(run_id)s AND r.raw_id = %(raw_id)s
     AND r.series_ref IS NOT DISTINCT FROM %(series_ref)s
     AND r.ref_period IS NOT DISTINCT FROM %(ref_period)s
     AND r.reason_code = %(reason_code)s)
"""


class _Rollback(Exception):
    """Internal: a post-load error result rolls the load transaction back."""


@dataclass(frozen=True)
class GateOutcome:
    loaded: bool
    verdict: Verdict


def _detail_json(result: CheckResult) -> str:
    detail = dict(result.detail)
    if result.skipped_series:
        detail.setdefault("skipped_series", list(result.skipped_series[:20]))
    if result.suspects:
        detail.setdefault("suspect_rows", len(result.suspects))
    return json.dumps(detail, default=str, sort_keys=True)


def insert_results(
    conn: psycopg.Connection,
    run_id: int | None,
    source_id: str | None,
    results: Iterable[CheckResult],
) -> int:
    """Append one ``ops.validation_result`` row per result (threshold recorded per row)."""
    rows = [
        (
            run_id,
            r.check_id,
            r.severity.value,
            source_id,
            r.subject,
            r.passed,
            r.metric,
            r.threshold,
            _detail_json(r),
        )
        for r in results
    ]
    with conn.cursor() as cur:
        cur.executemany(_INSERT_RESULT, rows)
    return len(rows)


def insert_rejected(
    conn: psycopg.Connection, run_id: int, raw_id: int, items: Iterable[RejectedItem]
) -> int:
    """Quarantine rejected rows in ``staging.rejected``; a repeated retry adds nothing new."""
    n = 0
    with conn.cursor() as cur:
        for it in items:
            cur.execute(
                _INSERT_REJECTED,
                {
                    "run_id": run_id,
                    "raw_id": raw_id,
                    "series_ref": it.series_ref,
                    "ref_period": it.ref_period,
                    "raw_value": it.raw_value,
                    "reason_code": it.reason_code,
                    "detail": it.detail,
                },
            )
            n += cur.rowcount
    return n


def read_db_clock(conn: psycopg.Connection) -> datetime:
    """The database ``clock_timestamp()`` (META-05 reference)."""
    row = conn.execute("SELECT clock_timestamp()").fetchone()
    assert row is not None
    now: datetime = row[0]
    return now


def quality_flags(verdict: Verdict) -> dict[tuple[str, date], QualityFlag]:
    """``quality_flag`` per (series_ref, ref_period_start): suspect rows load flagged."""
    return dict.fromkeys(verdict.suspects, QualityFlag.SUSPECT)


def load_gated(
    conn: psycopg.Connection,
    *,
    run_id: int,
    source_id: str,
    raw_id: int,
    results: Sequence[CheckResult],
    load: LoadFn,
    post_checks: PostChecksFn | None = None,
) -> GateOutcome:
    """Record findings, then run ``load`` only if no error blocks the object.

    The connection must be idle (no open transaction). Results and rejected rows are committed
    first. If a pre-load result blocks, ``load`` is not called. Otherwise ``load`` runs in one
    transaction together with the optional ``post_checks``; a blocking post-check or any
    exception rolls the whole load back (the exception propagates, the findings stay).
    """
    if conn.info.transaction_status != TransactionStatus.IDLE:
        raise RuntimeError("load_gated needs a connection without an open transaction")
    verdict = decide(results)
    insert_results(conn, run_id, source_id, results)
    insert_rejected(conn, run_id, raw_id, rejected_items(results))
    conn.commit()
    if verdict.blocked:
        return GateOutcome(False, verdict)
    post: list[CheckResult] = []
    try:
        with conn.transaction():
            load(conn)
            if post_checks is not None:
                post = list(post_checks(conn))
                if decide(post).blocked:
                    raise _Rollback
                insert_results(conn, run_id, source_id, post)
    except _Rollback:
        insert_results(conn, run_id, source_id, post)
        conn.commit()
        return GateOutcome(False, decide([*results, *post]))
    conn.commit()
    return GateOutcome(True, decide([*results, *post]))
