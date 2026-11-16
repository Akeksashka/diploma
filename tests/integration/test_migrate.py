"""T-DDL-5 and runner behaviour against a throwaway database (needs MM_TEST_DATABASE_URL)."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest

from macro_monitor.storage import migrate
from macro_monitor.storage.db import DatabaseError

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

_CREATE_RUN = (
    "CREATE SCHEMA ingest; CREATE TABLE ingest.run (run_id bigint GENERATED ALWAYS AS IDENTITY "
    "PRIMARY KEY, status text NOT NULL, started_at timestamptz NOT NULL)"
)


def _write(directory: Path, name: str, text: str) -> None:
    (directory / name).write_text(text, encoding="utf-8")


def _real_dir(tmp_path: Path) -> Path:
    """A copy of the 0000 migration so tests can append synthetic files.

    Later real migrations are left out so these tests do not depend on them.
    """
    for m in migrate.discover():
        if m.version == 0:
            _write(tmp_path, m.path.name, m.sql)
    return tmp_path


def test_applies_on_empty_database_and_is_idempotent(test_database: TestDatabase) -> None:
    with test_database.connect() as conn:
        assert migrate.applied(conn) == {}
        done = migrate.migrate(conn)
        assert done == [m.version for m in migrate.discover()]
        rows = conn.execute(
            "SELECT version, name, checksum, applied_at IS NOT NULL "
            "FROM ops.schema_migration ORDER BY version"
        ).fetchall()
        assert rows[0] == (0, "schema_migration", migrate.discover()[0].checksum, True)
        assert migrate.migrate(conn) == []
        assert migrate.check_schema_version(conn) == migrate.expected_version()


def test_runs_under_the_owner_role(test_database: TestDatabase) -> None:
    with test_database.connect("mm_owner") as conn:
        assert migrate.migrate(conn)[0] == 0


def test_changed_checksum_of_applied_file_is_rejected(
    test_database: TestDatabase, tmp_path: Path
) -> None:
    directory = _real_dir(tmp_path)
    _write(directory, "0001_extra.sql", "CREATE TABLE ops.extra (id int);\n")
    with test_database.connect() as conn:
        assert migrate.migrate(conn, directory) == [0, 1]
        _write(directory, "0001_extra.sql", "CREATE TABLE ops.extra (id bigint);\n")
        with pytest.raises(migrate.MigrationMismatch) as info:
            migrate.migrate(conn, directory)
        assert info.value.exit_code == 40
        with pytest.raises(migrate.MigrationMismatch):
            migrate.check_schema_version(conn, directory)


def test_applied_version_without_file_is_rejected(
    test_database: TestDatabase, tmp_path: Path
) -> None:
    directory = _real_dir(tmp_path)
    _write(directory, "0001_extra.sql", "SELECT 1;\n")
    with test_database.connect() as conn:
        migrate.migrate(conn, directory)
        (directory / "0001_extra.sql").unlink()
        with pytest.raises(migrate.MigrationMismatch):
            migrate.migrate(conn, directory)


def test_schema_version_check_detects_pending_and_empty(
    test_database: TestDatabase, tmp_path: Path
) -> None:
    directory = _real_dir(tmp_path)
    with test_database.connect() as conn:
        with pytest.raises(migrate.MigrationMismatch, match="-1"):
            migrate.check_schema_version(conn, directory)
        migrate.migrate(conn, directory)
        assert migrate.check_schema_version(conn, directory) == 0
        _write(directory, "0001_extra.sql", "SELECT 1;\n")
        with pytest.raises(migrate.MigrationMismatch, match="expects 1"):
            migrate.check_schema_version(conn, directory)


def test_failed_migration_rolls_back_and_keeps_earlier_ones(
    test_database: TestDatabase, tmp_path: Path
) -> None:
    directory = _real_dir(tmp_path)
    _write(directory, "0001_ok.sql", "CREATE TABLE ops.ok (id int);\n")
    _write(directory, "0002_bad.sql", "CREATE TABLE ops.half (id int); SELECT 1/0;\n")
    with test_database.connect() as conn:
        with pytest.raises(psycopg.errors.DivisionByZero):
            migrate.migrate(conn, directory)
        assert sorted(migrate.applied(conn)) == [0, 1]
        assert conn.execute("SELECT to_regclass('ops.half')").fetchone() == (None,)
        # the advisory lock was released
        assert conn.execute(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' "
            "AND database = (SELECT oid FROM pg_database WHERE datname = current_database())"
        ).fetchone() == (0,)


def test_refuses_while_recent_run_is_running(test_database: TestDatabase, tmp_path: Path) -> None:
    directory = _real_dir(tmp_path)
    with test_database.connect() as conn:
        migrate.migrate(conn, directory)
        conn.execute(_CREATE_RUN)
        conn.execute("INSERT INTO ingest.run (status, started_at) VALUES ('running', now())")
        conn.commit()
        _write(directory, "0001_extra.sql", "CREATE TABLE ops.extra (id int);\n")
        with pytest.raises(migrate.MigrationBlocked):
            migrate.migrate(conn, directory)
        assert sorted(migrate.applied(conn)) == [0]


def test_ignores_old_or_finished_runs(test_database: TestDatabase, tmp_path: Path) -> None:
    directory = _real_dir(tmp_path)
    with test_database.connect() as conn:
        migrate.migrate(conn, directory)
        conn.execute(_CREATE_RUN)
        conn.execute(
            "INSERT INTO ingest.run (status, started_at) VALUES "
            "('running', now() - interval '7 hours'), ('ok', now()), ('failed', now())"
        )
        conn.commit()
        _write(directory, "0001_extra.sql", "CREATE TABLE ops.extra (id int);\n")
        assert migrate.migrate(conn, directory) == [1]


def test_second_runner_waits_on_the_migrate_lock(
    test_database: TestDatabase,
    two_sessions: Callable[
        ..., AbstractContextManager[tuple[psycopg.Connection, psycopg.Connection]]
    ],
) -> None:
    with two_sessions(test_database.dsn(), timeout=1.5) as (a, b):
        a.execute("SELECT pg_advisory_lock(hashtext('mm-migrate'))")
        with pytest.raises(psycopg.errors.LockNotAvailable):
            migrate.migrate(b)
        a.execute("SELECT pg_advisory_unlock(hashtext('mm-migrate'))")
        b.rollback()
        assert migrate.migrate(b)[0] == 0


def test_pooled_dsn_is_refused(test_database: TestDatabase) -> None:
    with test_database.connect() as conn, pytest.raises(DatabaseError):
        migrate.migrate(conn, dsn="postgresql://u@ep-x-1-pooler.neon.tech/db")


def test_db03_through_the_reader_view(test_database: TestDatabase, tmp_path: Path) -> None:
    """ADR-038: mm_reader runs the full DB-03 (version and checksums) via ops.v_schema_version."""
    view = "ops.v_schema_version"
    directory = _real_dir(tmp_path)
    _write(directory, "0001_view.sql", "CREATE VIEW ops.v_schema_version AS "
           "SELECT version, name, checksum FROM ops.schema_migration;\n"
           "DO $mm$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA ops TO %1$I; "
           "GRANT SELECT ON ops.v_schema_version TO %1$I', "
           "'mm_reader' || CASE WHEN current_database() ~ '^mm_test_[0-9a-f]+$' "
           "THEN '_' || substr(current_database(), 9) ELSE '' END); END $mm$;\n")  # fmt: skip
    with test_database.connect() as conn:
        migrate.migrate(conn, directory)
    with test_database.connect("mm_reader") as rd:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            migrate.check_schema_version(rd, directory)
        rd.rollback()
        assert migrate.check_schema_version(rd, directory, relation=view) == 1
        # pending file: version mismatch
        _write(directory, "0002_extra.sql", "SELECT 1;\n")
        with pytest.raises(migrate.MigrationMismatch, match="expects 2") as info:
            migrate.check_schema_version(rd, directory, relation=view)
        assert info.value.exit_code == 40
        (directory / "0002_extra.sql").unlink()
        # changed checksum of an applied file
        _write(directory, "0001_view.sql", "SELECT 2;\n")
        with pytest.raises(migrate.MigrationMismatch, match="checksum"):
            migrate.check_schema_version(rd, directory, relation=view)
