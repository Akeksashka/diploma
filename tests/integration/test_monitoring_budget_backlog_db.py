# ruff: noqa: E501, PT018
"""T66 db tests: DB-02 history/projection, DB-03, LOAD-01, ORD-01..03, FRESH-03 against the migrations."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING

import psycopg
import pytest

from macro_monitor.monitoring import backlog, db_budget
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

NOW = datetime(2026, 11, 4, 12, tzinfo=UTC)
MB = db_budget.MB


@pytest.fixture
def conn(test_database: TestDatabase) -> psycopg.Connection:
    with test_database.connect("mm_owner", timeout=120) as c:
        migrate.migrate(c)
        c.commit()
    return test_database.connect()


def _base(c: psycopg.Connection) -> int:
    c.execute("INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)")
    for g in ("G", "H"):
        c.execute(
            "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES ('S',%s,'x')",
            [g],
        )
    row = c.execute(
        "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status)"
        " VALUES ('w','local','refresh','g','c', now(), 'ok') RETURNING run_id"
    ).fetchone()
    assert row is not None
    return int(row[0])


def _obj(
    c: psycopg.Connection, run: int, group: str, key: str, age_days: float, *,
    manual: bool = False, edition: tuple[str, date] | None = None,
) -> int:  # fmt: skip
    c.execute(
        "INSERT INTO ingest.raw_blob VALUES (%s,1,'local_dir',%s,now()) ON CONFLICT DO NOTHING",
        [key, key],
    )
    row = c.execute(
        "INSERT INTO ingest.raw_object (run_id, source_id, group_id, request_key, request_url, request_params, http_status,"
        " fetched_at, sha256, fetch_mode, fetch_scope, manual, edition_label, edition_date, parser_id)"
        " VALUES (%s,'S',%s,%s,'https://x/y','{}',200,%s,%s,'full','complete',%s,%s,%s,'p@1') RETURNING raw_id",
        [run, group, key, NOW - timedelta(days=age_days), key, manual, *(edition or (None, None))],
    ).fetchone()
    assert row is not None
    return int(row[0])


def _load(c: psycopg.Connection, run: int, raw: int, outcome: str, detail: str = "{}") -> None:
    c.execute(
        "INSERT INTO ingest.raw_load (raw_id, outcome, load_run_id, loaded_at, detail) VALUES (%s,%s,%s,%s,%s::jsonb)",
        [raw, outcome, run, NOW, detail],
    )


def test_db02_projection_from_monthly_history(conn: psycopg.Connection) -> None:
    for i, mb in enumerate((600, 640, 680, 720, 760)):
        conn.execute(
            "INSERT INTO ops.validation_result (check_id, severity, subject, passed, metric, created_at)"
            " VALUES ('DB-02','info','size',true,%s,%s)",
            [mb * MB, datetime(2026, 6 + i, 15, tzinfo=UTC)],
        )
    # two measurements in one month: only the latest counts
    conn.execute(
        "INSERT INTO ops.validation_result (check_id, severity, subject, passed, metric, created_at)"
        " VALUES ('DB-02','info','size',true,1,%s)",
        [datetime(2026, 10, 1, tzinfo=UTC)],
    )
    res = db_budget.record_db02(conn, None, 800 * MB)  # now(): the real current month
    assert res.severity == "warn"
    assert res.n_samples >= 3
    row = conn.execute(
        "SELECT severity, passed FROM ops.validation_result WHERE check_id='DB-02' AND subject='projection'"
    ).fetchone()
    assert row is not None and row[0] in {"warn", "info"}


def test_db02_projection_warns_with_six_samples(conn: psycopg.Connection) -> None:
    now = datetime.now(UTC)
    for i, mb in enumerate((600, 640, 680, 720, 760)):
        month_start = (now.replace(day=1) - timedelta(days=31 * (5 - i))).replace(day=15)
        conn.execute(
            "INSERT INTO ops.validation_result (check_id, severity, subject, passed, metric, created_at)"
            " VALUES ('DB-02','info','size',true,%s,%s)",
            [mb * MB, month_start],
        )
    res = db_budget.record_db02(conn, None, 800 * MB)
    assert res.n_samples == 6 and res.projection_warn
    assert [f.title for f in res.findings()] == ["[DB-02] database", "[DB-02] database-projection"]


def test_db03_pass_and_fail(conn: psycopg.Connection) -> None:
    assert db_budget.record_db03(conn, None) == migrate.expected_version()
    conn.execute("INSERT INTO ops.schema_migration VALUES (9999, 'x', 'c', now())")
    with pytest.raises(migrate.MigrationMismatch):
        db_budget.record_db03(conn, None)
    assert conn.execute(
        "SELECT passed FROM ops.validation_result WHERE check_id='DB-03' ORDER BY created_at DESC, ctid DESC LIMIT 1"
    ).fetchone() == (False,)


def test_load01_and_ord02(conn: psycopg.Connection) -> None:
    run = _base(conn)
    first = _obj(conn, run, "G", "a", 41)
    held = _obj(conn, run, "G", "b", 0.5)
    _obj(conn, run, "H", "c", 0.5)
    done = _obj(conn, run, "H", "d", 3)
    _load(conn, run, done, "loaded")
    findings, passed = backlog.record_backlog(conn, run, NOW)
    titles = {f.title for f in findings}
    assert titles == {"[LOAD-01] G", "[ORD-02] G"}
    ord02 = conn.execute(
        "SELECT metric, detail FROM ops.validation_result WHERE check_id='ORD-02'"
    ).fetchone()
    assert (
        ord02 is not None
        and ord02[1]["blocking_raw_id"] == first
        and ord02[1]["held_raw_ids"] == [held]
    )
    sev = conn.execute(
        "SELECT subject, severity FROM ops.validation_result WHERE check_id='LOAD-01' ORDER BY subject"
    ).fetchall()
    assert sev == [("G", "error"), ("H", "info")]
    assert "[LOAD-01] H" in passed and "[LOAD-01] G" not in passed


def test_ord01_and_ord03(conn: psycopg.Connection) -> None:
    run = _base(conn)
    e_new = _obj(conn, run, "G", "new", 5, manual=True, edition=("WEO-2026-10", date(2026, 10, 13)))
    _load(conn, run, e_new, "loaded")
    e_old = _obj(conn, run, "G", "old", 4, manual=True, edition=("WEO-2026-04", date(2026, 4, 14)))
    _load(conn, run, e_old, "skipped_out_of_order", '{"reason": "older_edition"}')
    whole = _obj(conn, run, "H", "w", 3)
    _load(conn, run, whole, "skipped_out_of_order", '{"reason": "later_known_at"}')
    part = _obj(conn, run, "H", "p", 2)
    _load(conn, run, part, "loaded")
    for ref in ("d|1", "d|2"):
        conn.execute(
            "INSERT INTO ingest.raw_series_status VALUES (%s,%s,'skipped_out_of_order',NULL,%s,%s)",
            [part, ref, run, NOW],
        )
    ord1, ord3 = backlog.read_order_skips(conn, NOW - timedelta(days=1))
    assert [(s.raw_id, s.n_series) for s in ord1] == [(whole, 0), (part, 2)]
    assert [(s.raw_id, s.newer_edition) for s in ord3] == [(e_old, "WEO-2026-10")]
    findings = backlog.record_order_checks(conn, run, NOW - timedelta(days=1))
    assert {f.title for f in findings} == {"[ORD-01] H", "[ORD-03] G"}
    assert backlog.read_order_skips(conn, NOW + timedelta(days=1)) == ([], [])


def test_fresh03_from_inbox(conn: psycopg.Connection) -> None:
    run = _base(conn)
    rem = backlog.Reminder("S", "G", 10, 25, "t")
    assert backlog.record_fresh03(conn, run, [rem], date(2026, 10, 24)) == []
    f25 = backlog.record_fresh03(conn, run, [rem], date(2026, 10, 25))
    assert [f.title for f in f25] == ["[FRESH-03] S 2026-10"]
    esc = backlog.record_fresh03(conn, run, [rem], date(2026, 11, 15))
    assert esc[0].metrics == {"escalated": 1}
    _obj(conn, run, "G", "e", 1, manual=True, edition=("WEO-2026-10", date(2026, 10, 13)))
    assert backlog.record_fresh03(conn, run, [rem], date(2026, 11, 15)) == []
