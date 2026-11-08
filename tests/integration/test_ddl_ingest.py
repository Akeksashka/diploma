# ruff: noqa: E501
"""T-DDL-7, T-DDL-8 and I-ING-1..7 against migration 0003_ingest_staging.

Roles and grants are T16, so the mm_ingest privilege parts of T-DDL-8 are checked here as
trigger behaviour (which also binds the superuser); the grant side belongs to the T16 tests.
Migration 0002 may be absent or in flux, so the fixture applies 0000, 0001, a no-op 0002
placeholder and 0003 from a temporary directory.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest
from psycopg import errors

from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

_OBJ = (
    "INSERT INTO ingest.raw_object (run_id, source_id, group_id, request_key, prev_raw_id, request_url, "
    "request_params, http_status, fetched_at, sha256, fetch_mode, fetch_scope, manual, import_label, parser_id) "
    "VALUES (%s, %s, 'G', %s, %s, 'https://x/y', '{}', 200, %s, %s, %s, %s, %s, %s, 'p@1') RETURNING raw_id"
)


@pytest.fixture
def conn(test_database: TestDatabase, tmp_path: Path) -> Iterator[psycopg.Connection]:
    real = {m.version: m for m in migrate.discover()}
    (tmp_path / real[0].path.name).write_text(real[0].sql, encoding="utf-8")
    (tmp_path / real[1].path.name).write_text(real[1].sql, encoding="utf-8")
    (tmp_path / "0002_placeholder.sql").write_text("SELECT 1;", encoding="utf-8")
    (tmp_path / real[3].path.name).write_text(real[3].sql, encoding="utf-8")
    with test_database.connect() as c:
        migrate.migrate(c, tmp_path)
        c.execute(
            "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true), "
            "('H','p','rest','hash_only','withheld','l','a','x',true)"
        )
        c.execute(
            "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status) "
            "VALUES ('w','local','refresh','g','c', now(), 'running')"
        )
        for sha in ("A", "B", "C"):
            c.execute(
                "INSERT INTO ingest.raw_blob VALUES (%s, 1, 'local_dir', %s, now())", [sha, sha]
            )
        c.commit()
        yield c


def _obj(
    conn: psycopg.Connection,
    prev: int | None,
    sha: str,
    ts: int,
    *,
    source: str = "S",
    key: str = "k",
    mode: str = "full",
    scope: str = "complete",
    manual: bool = False,
    label: str | None = None,
) -> int:
    row = conn.execute(
        _OBJ,
        [1, source, key, prev, f"2026-01-01T00:00:{ts:02d}Z", sha, mode, scope, manual, label],
    ).fetchone()
    assert row is not None
    return int(row[0])


def _load(
    conn: psycopg.Connection, raw_id: int, outcome: str = "loaded", detail: str = "{}"
) -> None:
    conn.execute(
        "INSERT INTO ingest.raw_load (raw_id, outcome, load_run_id, loaded_at, detail) "
        "VALUES (%s, %s, 1, now(), %s::jsonb)",
        [raw_id, outcome, detail],
    )


# --- T-DDL-7 -----------------------------------------------------------------------------


def test_aba_gives_three_objects_two_blobs(conn: psycopg.Connection) -> None:
    a1 = _obj(conn, None, "A", 1)
    b = _obj(conn, a1, "B", 2)
    a2 = _obj(conn, b, "A", 3)
    conn.commit()
    assert conn.execute("SELECT count(*) FROM ingest.raw_object").fetchone() == (3,)
    assert conn.execute(
        "SELECT count(*) FROM ingest.raw_blob WHERE sha256 IN ('A','B')"
    ).fetchone() == (2,)
    assert a1 < b < a2


def test_equal_to_prev_rejected(conn: psycopg.Connection) -> None:
    a1 = _obj(conn, None, "A", 1)
    with pytest.raises(errors.UniqueViolation):
        _obj(conn, a1, "A", 2)
    conn.rollback()


def test_prev_must_be_latest(conn: psycopg.Connection) -> None:
    a1 = _obj(conn, None, "A", 1)
    _obj(conn, a1, "B", 2)
    conn.commit()
    with pytest.raises(errors.CheckViolation):
        _obj(conn, a1, "C", 3)  # branch
    conn.rollback()
    with pytest.raises(errors.CheckViolation):
        _obj(conn, None, "C", 3, key="k")  # first-object claim on a non-empty key
    conn.rollback()


def test_fetched_at_must_advance(conn: psycopg.Connection) -> None:
    a1 = _obj(conn, None, "A", 5)
    with pytest.raises(errors.CheckViolation):
        _obj(conn, a1, "B", 4)
    conn.rollback()


def test_keys_are_independent(conn: psycopg.Connection) -> None:
    _obj(conn, None, "A", 1, key="k1")
    _obj(conn, None, "A", 1, key="k2")
    _obj(conn, None, "A", 1, key="k1", source="H")
    conn.commit()


def test_hash_only_bytes_unavailable_exception_once(conn: psycopg.Connection) -> None:
    h1 = _obj(conn, None, "A", 1, source="H")
    with pytest.raises(errors.UniqueViolation):  # no raw_load row yet
        _obj(conn, h1, "A", 2, source="H")
    conn.rollback()
    h1 = _obj(conn, None, "A", 1, source="H")
    _load(conn, h1, "rejected", '{"reason": "bytes_unavailable"}')
    h2 = _obj(conn, h1, "A", 2, source="H")  # accepted once
    with pytest.raises(errors.UniqueViolation):
        _obj(conn, h2, "A", 3, source="H")  # h2 itself is not rejected
    conn.rollback()


def test_exception_only_for_hash_only_source_and_reason(conn: psycopg.Connection) -> None:
    s1 = _obj(conn, None, "A", 1)
    _load(conn, s1, "rejected", '{"reason": "bytes_unavailable"}')
    with pytest.raises(errors.UniqueViolation):  # source is archive_mode public
        _obj(conn, s1, "A", 2)
    conn.rollback()
    h1 = _obj(conn, None, "A", 1, source="H")
    _load(conn, h1, "rejected", '{"reason": "other"}')
    with pytest.raises(errors.UniqueViolation):
        _obj(conn, h1, "A", 2, source="H")
    conn.rollback()


def test_duplicate_key_rejected(conn: psycopg.Connection) -> None:
    _obj(conn, None, "A", 1)
    # same (source, key, fetched_at); prev/ts checks fire first or the unique does: both reject
    with pytest.raises((errors.UniqueViolation, errors.CheckViolation)):
        _obj(conn, None, "B", 1)
    conn.rollback()


def test_incremental_complete_rejected(conn: psycopg.Connection) -> None:
    with pytest.raises(errors.CheckViolation):
        _obj(conn, None, "A", 1, mode="incremental", scope="complete")
    conn.rollback()
    _obj(conn, None, "A", 1, mode="incremental", scope="partial")
    conn.commit()


def test_import_label_requires_manual(conn: psycopg.Connection) -> None:
    with pytest.raises(errors.CheckViolation):
        _obj(conn, None, "A", 1, manual=False, label="archive_import")
    conn.rollback()
    with pytest.raises(errors.CheckViolation):
        _obj(conn, None, "A", 1, manual=True, label="other")
    conn.rollback()
    _obj(conn, None, "A", 1, manual=True, label="archive_import")
    conn.commit()


def test_edition_date_column(conn: psycopg.Connection) -> None:
    cols = {
        r[0]
        for r in conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='ingest' AND table_name='raw_object'"
        )
    }
    assert {"edition_date", "import_label", "edition_label", "group_id"} <= cols


# --- T-DDL-8 / I-ING-1, 4, 6 -------------------------------------------------------------


def test_unloaded_view_and_single_load_row(conn: psycopg.Connection) -> None:
    a = _obj(conn, None, "A", 1)
    b = _obj(conn, a, "B", 2)

    def unloaded() -> set[int]:
        return {r[0] for r in conn.execute("SELECT raw_id FROM ingest.v_raw_unloaded")}

    assert unloaded() == {a, b}
    _load(conn, a)
    assert unloaded() == {b}
    with pytest.raises(errors.UniqueViolation):
        _load(conn, a, "rejected")
    conn.rollback()


@pytest.mark.parametrize(
    "stmt",
    [
        "UPDATE ingest.raw_blob SET byte_count = 2",
        "DELETE FROM ingest.raw_blob",
        "UPDATE ingest.raw_object SET http_status = 201",
        "DELETE FROM ingest.raw_object",
        "UPDATE ingest.raw_snapshot SET row_count = 2",
        "DELETE FROM ingest.raw_snapshot",
        "UPDATE ingest.raw_load SET rows_inserted = 5",
        "DELETE FROM ingest.raw_load",
        "UPDATE ingest.raw_series_status SET event_id = 5",
        "DELETE FROM ingest.raw_series_status",
        "UPDATE ingest.fetch_attempt SET bytes = 5",
        "DELETE FROM ingest.fetch_attempt",
    ],
)
def test_append_only(conn: psycopg.Connection, stmt: str) -> None:
    a = _obj(conn, None, "A", 1)
    _load(conn, a)
    conn.execute("INSERT INTO ingest.raw_snapshot VALUES (%s, 'P', 'ref', 1, 1, 'p@1')", [a])
    conn.execute(
        "INSERT INTO ingest.raw_series_status VALUES (%s, 'D|K', 'deferred', NULL, 1, now())", [a]
    )
    conn.execute(
        "INSERT INTO ingest.fetch_attempt (run_id, source_id, request_key, attempted_at, outcome) "
        "VALUES (1, 'S', 'k', now(), 'new')"
    )
    conn.commit()
    with pytest.raises(errors.RestrictViolation):
        conn.execute(stmt)
    conn.rollback()


def test_run_update_limited(conn: psycopg.Connection) -> None:
    conn.execute("UPDATE ingest.run SET status = 'ok', finished_at = now()")
    with pytest.raises(errors.RestrictViolation):
        conn.execute("UPDATE ingest.run SET git_sha = 'z'")
    conn.rollback()
    with pytest.raises(errors.RestrictViolation):
        conn.execute("DELETE FROM ingest.run")
    conn.rollback()


@pytest.mark.parametrize(
    "table",
    [
        "ingest.run",
        "ingest.request_state",
        "ingest.raw_blob",
        "ingest.raw_object",
        "ingest.raw_snapshot",
        "ingest.raw_load",
        "ingest.raw_series_status",
        "ingest.fetch_attempt",
        "staging.observation_load",
        "staging.series_meta_load",
        "staging.rejected",
    ],
)
def test_no_truncate(conn: psycopg.Connection, table: str) -> None:
    with pytest.raises(errors.RestrictViolation):
        conn.execute(f"TRUNCATE {table} CASCADE")
    conn.rollback()


def test_series_deferred_view(conn: psycopg.Connection) -> None:
    a = _obj(conn, None, "A", 1)

    def status(ref: str, st: str) -> None:
        conn.execute(
            "INSERT INTO ingest.raw_series_status VALUES (%s, %s, %s, NULL, 1, now())", [a, ref, st]
        )

    def deferred() -> set[str]:
        return {r[0] for r in conn.execute("SELECT series_ref FROM ingest.v_series_deferred")}

    for ref in ("s1", "s2", "s3", "s4"):
        status(ref, "deferred")
    assert deferred() == {"s1", "s2", "s3", "s4"}
    status("s1", "loaded")
    status("s2", "rejected")
    status("s3", "skipped_out_of_order")
    assert deferred() == {"s3", "s4"}
    conn.rollback()


def test_last_loaded_changes_only_with_loaded_row(conn: psycopg.Connection) -> None:
    a = _obj(conn, None, "A", 1)
    b = _obj(conn, a, "B", 2)
    conn.execute(
        "INSERT INTO ingest.request_state (source_id, request_key, last_url) VALUES ('S','k','u')"
    )
    conn.commit()
    # fetch-side columns move freely
    conn.execute("UPDATE ingest.request_state SET last_sha256 = 'B', last_status = '200'")
    conn.commit()
    upd = "UPDATE ingest.request_state SET last_loaded_sha256 = %s, last_loaded_raw_id = %s"
    with pytest.raises(errors.RestrictViolation):  # no raw_load row
        conn.execute(upd, ["A", a])
    conn.rollback()
    _load(conn, a, "rejected")
    with pytest.raises(errors.RestrictViolation):  # wrong outcome
        conn.execute(upd, ["A", a])
    conn.rollback()
    _load(conn, a)
    conn.execute(upd, ["A", a])  # same transaction as the loaded row
    conn.commit()
    _load(conn, b)
    conn.commit()
    with pytest.raises(errors.RestrictViolation):  # loaded row from an earlier transaction
        conn.execute(upd, ["B", b])
    conn.rollback()
    with pytest.raises(errors.RestrictViolation):  # mismatching sha256
        conn.execute(upd, ["A", b])
    conn.rollback()
    with pytest.raises(errors.RestrictViolation):  # cannot be cleared
        conn.execute(
            "UPDATE ingest.request_state SET last_loaded_sha256 = NULL, last_loaded_raw_id = NULL"
        )
    conn.rollback()
    assert conn.execute(
        "SELECT last_loaded_sha256, last_loaded_raw_id FROM ingest.request_state"
    ).fetchone() == ("A", a)


def test_last_loaded_with_loaded_row_same_transaction_for_next_object(
    conn: psycopg.Connection,
) -> None:
    a = _obj(conn, None, "A", 1)
    b = _obj(conn, a, "B", 2)
    conn.execute(
        "INSERT INTO ingest.request_state (source_id, request_key, last_url) VALUES ('S','k','u')"
    )
    conn.commit()
    _load(conn, a)
    conn.execute(
        "UPDATE ingest.request_state SET last_loaded_sha256 = 'A', last_loaded_raw_id = %s", [a]
    )
    conn.commit()
    _load(conn, b)
    conn.execute(
        "UPDATE ingest.request_state SET last_loaded_sha256 = 'B', last_loaded_raw_id = %s", [b]
    )
    conn.commit()
    assert conn.execute("SELECT last_loaded_sha256 FROM ingest.request_state").fetchone() == ("B",)


# --- staging -----------------------------------------------------------------------------


def test_staging_tables_accept_rows_and_delete_per_raw_id(conn: psycopg.Connection) -> None:
    conn.execute(
        "INSERT INTO staging.observation_load (run_id, raw_id, series_ref, ref_period_start, ref_period_end, "
        "value, value_status, row_hash) VALUES (1, 7, 'D|K', '2026-01-01', '2026-01-31', 1.5, 'OBS', 'h')"
    )
    conn.execute(
        "INSERT INTO staging.series_meta_load (run_id, raw_id, series_ref) VALUES (1, 7, 'D|K')"
    )
    conn.execute("INSERT INTO staging.rejected (run_id, raw_id, reason_code) VALUES (1, 7, 'X')")
    conn.execute("DELETE FROM staging.observation_load WHERE raw_id = 7")  # S-4
    assert conn.execute("SELECT count(*) FROM staging.observation_load").fetchone() == (0,)
    conn.rollback()


def test_migration_idempotent_schemas(conn: psycopg.Connection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS ingest")  # the migration used IF NOT EXISTS too
    assert 3 in migrate.applied(conn)
    conn.rollback()
