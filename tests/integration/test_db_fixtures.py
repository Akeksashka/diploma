"""Self-test of the Postgres fixtures in tests/conftest.py (needs MM_TEST_DATABASE_URL)."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import TYPE_CHECKING

import psycopg
import pytest

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

BASE_ROLES = ("mm_owner", "mm_ingest", "mm_analytics", "mm_r", "mm_reader")
_created: list[tuple[str, str]] = []  # (database, tag) of the first test, checked by the next


def test_database_is_created_with_per_database_roles(test_database: TestDatabase) -> None:
    _created.append((test_database.name, test_database.tag))
    with test_database.connect() as conn:
        assert conn.execute("SELECT current_database()").fetchone() == (test_database.name,)
    assert set(test_database.roles) == set(BASE_ROLES)
    with test_database.connect("mm_ingest") as conn:
        assert conn.execute("SELECT current_user").fetchone() == (test_database.roles["mm_ingest"],)
    with test_database.connect() as conn:
        owner = conn.execute(
            "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()"
        ).fetchone()
    assert owner == (test_database.roles["mm_owner"],)


def test_database_and_roles_are_dropped_afterwards(
    test_database: TestDatabase, pg_admin_dsn: str
) -> None:
    # Relies on file order: the first test's database and roles must be gone by now.
    assert _created, "first test did not record its database"
    name, tag = _created[0]
    assert name != test_database.name
    with psycopg.connect(pg_admin_dsn, autocommit=True) as conn:
        dbs = conn.execute("SELECT count(*) FROM pg_database WHERE datname = %s", [name])
        assert dbs.fetchone() == (0,)
        roles = conn.execute("SELECT count(*) FROM pg_roles WHERE rolname LIKE %s", [f"%\\_{tag}"])
        assert roles.fetchone() == (0,)


def test_two_sessions_are_independent_and_time_out(
    test_database: TestDatabase,
    two_sessions: Callable[
        ..., AbstractContextManager[tuple[psycopg.Connection, psycopg.Connection]]
    ],
) -> None:
    with test_database.connect() as setup:
        setup.execute("CREATE TABLE t (id int PRIMARY KEY)")
        setup.execute("INSERT INTO t VALUES (1)")
        setup.commit()
    with two_sessions(test_database.dsn(), timeout=1.5) as (a, b):
        pid_a = a.execute("SELECT pg_backend_pid()").fetchone()
        pid_b = b.execute("SELECT pg_backend_pid()").fetchone()
        assert pid_a != pid_b
        a.execute("SELECT id FROM t WHERE id = 1 FOR UPDATE")
        with pytest.raises(psycopg.errors.LockNotAvailable):
            b.execute("SELECT id FROM t WHERE id = 1 FOR UPDATE")


def test_roles_do_not_leak_between_databases(
    test_database: TestDatabase, pg_admin_dsn: str
) -> None:
    with psycopg.connect(pg_admin_dsn, autocommit=True) as conn:
        rows = conn.execute(
            "SELECT count(*) FROM pg_roles WHERE rolname LIKE %s",
            [f"%\\_{test_database.tag}"],
        ).fetchone()
    assert rows == (len(BASE_ROLES),)
