# ruff: noqa: E501
"""Database checks DB-01..DB-03 (validation-monitoring-spec section 2; ADR-008).

DB-01 connectivity with retry, DB-02 size thresholds plus a 12-month linear projection from the last
six monthly measurements, DB-03 schema version equals the code expectation. Results are appended to
``ops.validation_result``. A megabyte here is 1024 * 1024 bytes (``pg_database_size`` is in bytes).
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

import psycopg
from psycopg.types.json import Jsonb

from macro_monitor.monitoring.issues import Finding
from macro_monitor.storage import migrate

MB = 1024 * 1024
WARN_BYTES = 700 * MB
ERROR_BYTES = 900 * MB
PROJECTION_MONTHS = 12
PROJECTION_SAMPLES = 6
MIN_PROJECTION_SAMPLES = 3  # two points always fit a line exactly; fewer than three is not a trend

Severity = Literal["info", "warn", "error"]


class DatabaseUnavailable(RuntimeError):
    """DB-01: every connection attempt failed."""


def connect_with_retry[C](
    connect: Callable[[], C],
    *,
    attempts: int = 3,
    base_delay: float = 2.0,
    sleep: Callable[[float], None] = time.sleep,
) -> C:
    """DB-01: call ``connect`` up to ``attempts`` times with exponential backoff (error if all fail)."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return connect()
        except psycopg.OperationalError as exc:
            last = exc
            if i < attempts - 1:
                sleep(base_delay * 2**i)
    raise DatabaseUnavailable(
        f"DB-01: all {attempts} connection attempts failed ({type(last).__name__})"
    )


def db01_finding(exc: DatabaseUnavailable) -> Finding:
    return Finding("DB-01", "database", labels=("pipeline",), metrics={"failed": 1})


def size_severity(size_bytes: float) -> Severity:
    if size_bytes > ERROR_BYTES:
        return "error"
    if size_bytes > WARN_BYTES:
        return "warn"
    return "info"


def project_size(samples: Sequence[float], months_ahead: int = PROJECTION_MONTHS) -> float | None:
    """Least-squares line through the (monthly) samples, evaluated ``months_ahead`` after the last.

    Returns None with fewer than ``MIN_PROJECTION_SAMPLES`` samples. Only the last six are used."""
    ys = list(samples)[-PROJECTION_SAMPLES:]
    n = len(ys)
    if n < MIN_PROJECTION_SAMPLES:
        return None
    xbar = (n - 1) / 2
    ybar = sum(ys) / n
    sxx = sum((x - xbar) ** 2 for x in range(n))
    slope = sum((x - xbar) * (y - ybar) for x, y in enumerate(ys)) / sxx
    return ybar + slope * (n - 1 + months_ahead - xbar)


@dataclass(frozen=True)
class DbSizeResult:
    size_bytes: int
    severity: Severity
    projected_bytes: float | None
    projection_warn: bool
    n_samples: int

    def findings(self) -> list[Finding]:
        out: list[Finding] = []
        if self.severity != "info":
            out.append(
                Finding(
                    "DB-02",
                    "database",
                    labels=("pipeline",),
                    metrics={"size_mb": self.size_bytes // MB},
                )
            )
        if self.projection_warn and self.projected_bytes is not None:
            out.append(
                Finding(
                    "DB-02",
                    "database-projection",
                    labels=("pipeline",),
                    metrics={"projected_mb": int(self.projected_bytes // MB)},
                )
            )
        return out


def monthly_samples(conn: psycopg.Connection) -> list[float]:
    """Last six monthly DB-02 size measurements (latest per calendar month), oldest first."""
    rows = conn.execute(
        """
        SELECT metric FROM (
          SELECT DISTINCT ON (date_trunc('month', created_at)) date_trunc('month', created_at) AS m, metric
            FROM ops.validation_result
           WHERE check_id = 'DB-02' AND subject = 'size' AND metric IS NOT NULL
           ORDER BY date_trunc('month', created_at), created_at DESC
        ) t ORDER BY m DESC LIMIT %s
        """,
        [PROJECTION_SAMPLES],
    ).fetchall()
    return [float(r[0]) for r in reversed(rows)]


def record_db02(conn: psycopg.Connection, run_id: int | None, size_bytes: int) -> DbSizeResult:
    """Append the size row, then evaluate the projection over the monthly history (incl. this row)."""
    sev = size_severity(size_bytes)
    conn.execute(
        "INSERT INTO ops.validation_result (run_id, check_id, severity, subject, passed, metric, threshold, detail)"
        " VALUES (%s,'DB-02',%s,'size',%s,%s,%s,%s)",
        [
            run_id,
            sev,
            sev == "info",
            size_bytes,
            WARN_BYTES if sev != "error" else ERROR_BYTES,
            Jsonb({}),
        ],
    )
    samples = monthly_samples(conn)
    projected = project_size(samples)
    warn = projected is not None and projected >= ERROR_BYTES
    conn.execute(
        "INSERT INTO ops.validation_result (run_id, check_id, severity, subject, passed, metric, threshold, detail)"
        " VALUES (%s,'DB-02',%s,'projection',%s,%s,%s,%s)",
        [
            run_id,
            "warn" if warn else "info",
            not warn,
            None if projected is None else round(projected),
            ERROR_BYTES,
            Jsonb({"months_ahead": PROJECTION_MONTHS, "n_samples": len(samples)}),
        ],
    )
    return DbSizeResult(size_bytes, sev, projected, warn, len(samples))


def record_db03(conn: psycopg.Connection, run_id: int | None) -> int:
    """DB-03: record pass/fail of the schema-version check; re-raises ``MigrationMismatch`` (stop)."""
    try:
        version = migrate.check_schema_version(conn)
    except migrate.MigrationMismatch:
        conn.execute(
            "INSERT INTO ops.validation_result (run_id, check_id, severity, subject, passed)"
            " VALUES (%s,'DB-03','error','schema_version',false)",
            [run_id],
        )
        raise
    conn.execute(
        "INSERT INTO ops.validation_result (run_id, check_id, severity, subject, passed, metric)"
        " VALUES (%s,'DB-03','info','schema_version',true,%s)",
        [run_id, version],
    )
    return version
