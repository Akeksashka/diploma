"""``record-export`` (T86; workflows spec section 6, export spec section 1, AC-EXP-5, AC-SYS-14).

Inserts the ``export-status.json`` artifact of the export step into the insert-only
``ops.export_status`` under ``mm_ingest``. The file is validated against its schema and scanned for
secret-like strings (EXP-07) before anything is written; the export step itself never writes.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import psycopg

from macro_monitor.publish import checks
from macro_monitor.publish import manifest as mf
from macro_monitor.storage.db import DatabaseError

MAX_STATUS_BYTES = 1_000_000


class RecordError(DatabaseError):
    """The status file cannot be recorded."""


def load_status(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > MAX_STATUS_BYTES:
        raise RecordError("export status file is missing or too large")
    data = path.read_bytes()
    hits = checks.scan_secrets(data)
    if hits:
        raise RecordError(f"export status file contains a secret-like string ({hits[0]})")
    try:
        doc = json.loads(data)
        mf.validate_json(doc, "export-status")
    except Exception as exc:  # json and schema errors; only the type is reported
        raise RecordError(f"export status file is invalid: {type(exc).__name__}") from exc
    assert isinstance(doc, dict)
    return doc


def record_export(conn: psycopg.Connection[Any], doc: dict[str, Any]) -> int:
    """Insert one row into ``ops.export_status`` and commit; returns ``export_id``. The ingest
    run must exist (so a stale or foreign artifact is refused)."""
    run_id = int(doc["ingest_run_id"])
    if conn.execute("SELECT 1 FROM ingest.run WHERE run_id = %s", [run_id]).fetchone() is None:
        conn.rollback()
        raise RecordError(f"ingest run {run_id} does not exist")
    row = conn.execute(
        "INSERT INTO ops.export_status (run_id, analysis_run_id, status, duration_ms, bytes_read, "
        "file_counts, detail) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb) "
        "RETURNING export_id",
        [
            run_id,
            doc["analysis_run_id"],
            doc["status"],
            doc["duration_ms"],
            doc["bytes_read"],
            json.dumps(doc["file_counts"], sort_keys=True),
            json.dumps(doc["detail"], sort_keys=True),
        ],
    ).fetchone()
    conn.commit()
    assert row is not None
    return int(row[0])
