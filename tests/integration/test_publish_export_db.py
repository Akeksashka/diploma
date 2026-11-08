# ruff: noqa: E501, PT018
"""T82 db tests: AC-EXP-9 run selection, AC-EXP-5 one read-only mm_reader session, EXP-08."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
import pytest
from psycopg import errors

from macro_monitor.publish import export as ex
from macro_monitor.publish import manifest as mf
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

NOW = datetime(2026, 10, 1, tzinfo=UTC)
GEN = datetime(2026, 11, 1, 6, 5, tzinfo=UTC)
T = 120


@pytest.fixture
def db(test_database: TestDatabase) -> TestDatabase:
    with test_database.connect("mm_owner", timeout=T) as c:
        migrate.migrate(c)
        c.commit()
    return test_database


def ingest_run(conn: psycopg.Connection[Any]) -> int:
    row = conn.execute(
        "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status) "
        "VALUES ('pipeline','local','refresh','g','v1', %s, 'ok') RETURNING run_id",
        [NOW],
    ).fetchone()
    assert row is not None
    return int(row[0])


def analysis_run(conn: psycopg.Connection[Any], ingest: int, cutoff_day: int, code: str) -> int:
    ts = datetime(2026, 10, cutoff_day, 4, 23, 41, tzinfo=UTC)
    row = conn.execute(
        "INSERT INTO analytics.run (ingest_run_id, as_of_run_date, known_cutoff, load_cutoff, code_version, "
        "params, git_sha, config_asof, config_sha256, mapping_sha256, overrides_sha256) "
        "VALUES (%s, %s, %s, %s, %s, '{}', 'g', %s, 'c', 'm', 'o') RETURNING analysis_run_id",
        [ingest, date(2026, 10, 1), ts, ts, code, NOW],
    ).fetchone()
    assert row is not None
    return int(row[0])


def producer(session: ex.ExportSession, run: mf.RunInfo, sink: ex.ExportSink) -> None:
    sink.add_json("meta/run.json", {"analysis_run_id": run.analysis_run_id})


def test_ac_exp_9_run_selection(db: TestDatabase, tmp_path: Path) -> None:
    with db.connect() as admin:
        i10, i11 = ingest_run(admin), ingest_run(admin)
        admin.commit()
    with db.connect("mm_analytics") as a:
        r5 = analysis_run(a, i10, 10, "v-first")
        r6 = analysis_run(a, i10, 11, "v-second")
        r7 = analysis_run(a, i11, 12, "v-other")
        a.commit()
    assert r5 < r6 < r7
    with db.connect("mm_reader", timeout=T) as rd:
        res = ex.run_export(rd, i10, tmp_path / "ok", [producer], now=lambda: GEN)
    assert res.run is not None and res.run.analysis_run_id == r6
    manifest = json.loads((tmp_path / "ok" / "data" / "manifest.json").read_text())
    assert manifest["analysis_run_id"] == r6 and manifest["ingest_run_id"] == i10
    assert manifest["known_cutoff"] == "2026-10-11T04:23:41Z"
    assert manifest["code_version"] == "v-second"
    with db.connect("mm_reader", timeout=T) as rd:
        res11 = ex.run_export(rd, i11, tmp_path / "o11", [producer], now=lambda: GEN)
    assert res11.run is not None and res11.run.analysis_run_id == r7

    missing = i11 + 1  # no analysis run
    with db.connect("mm_reader", timeout=T) as rd, pytest.raises(ex.ExportError) as ei:
        ex.run_export(rd, missing, tmp_path / "bad", [producer], now=lambda: GEN)
    assert ei.value.check == "EXP-10"
    assert not (tmp_path / "bad" / "data").exists()
    status = json.loads((tmp_path / "bad" / "export-status.json").read_text())
    assert status["status"] == "failed"


def test_reader_session_is_read_only_and_cannot_see_run_internals(db: TestDatabase) -> None:
    with db.connect("mm_reader", timeout=T) as rd:
        session = ex.ExportSession(rd)
        for q in ("SELECT params FROM analytics.v_run_published", "SELECT * FROM analytics.run",
                  "SELECT * FROM ingest.run", "SELECT * FROM ops.run_summary"):  # fmt: skip
            with pytest.raises((errors.UndefinedColumn, errors.InsufficientPrivilege)):
                session.fetch(q)
            rd.rollback()
        with pytest.raises(errors.ReadOnlySqlTransaction):
            session.fetch("CREATE TEMP TABLE t (x int)")


def test_ac_exp_5_single_session_status_and_exp_08(db: TestDatabase, tmp_path: Path) -> None:
    with db.connect() as admin:
        i = ingest_run(admin)
        admin.commit()
    with db.connect("mm_analytics") as a:
        analysis_run(a, i, 10, "v1")
        a.commit()
    with db.connect("mm_reader", timeout=T) as rd:
        pid = rd.execute("SELECT pg_backend_pid()").fetchone()
        rd.rollback()
        ex.run_export(rd, i, tmp_path / "a", [producer], now=lambda: GEN)
        assert rd.execute("SELECT pg_backend_pid()").fetchone() == pid  # same connection
        rd.rollback()
    with db.connect("mm_reader", timeout=T) as rd:
        ex.run_export(rd, i, tmp_path / "b", [producer], now=lambda: GEN)
    for name in ("meta/run.json", "manifest.json"):
        assert (tmp_path / "a" / "data" / name).read_bytes() == (
            tmp_path / "b" / "data" / name
        ).read_bytes()
    status = json.loads((tmp_path / "a" / "export-status.json").read_text())
    mf.validate_json(status, "export-status")
    assert status["sessions"] == 1 and status["bytes_read"] > 0 and status["duration_ms"] >= 0
    assert status["detail"]["bytes_written"] > 0
