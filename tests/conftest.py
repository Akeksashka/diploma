"""Shared pytest configuration.

- Tests under tests/unit/ are marked ``unit`` automatically; ``unit`` tests run with sockets
  blocked (pytest-socket, ADR-016).
- ``network`` tests are skipped unless selected with ``-m network`` and MM_ALLOW_NETWORK=1.
- ``db`` tests use the ``test_database`` fixture: a throwaway database (plus its own roles) is
  created from the superuser DSN in MM_TEST_DATABASE_URL and dropped afterwards. Without the
  variable, db tests are skipped with a clear message.
"""

from __future__ import annotations

import contextlib
import os
import secrets
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

_UNIT_DIR = Path(__file__).parent / "unit"
DB_TEST_TIMEOUT_S = 300


def network_allowed(markexpr: str, environ: dict[str, str] | os._Environ[str]) -> bool:
    return "network" in markexpr and environ.get("MM_ALLOW_NETWORK") == "1"


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    allowed = network_allowed(str(config.getoption("markexpr") or ""), os.environ)
    skip_network = pytest.mark.skip(reason="network test: needs -m network and MM_ALLOW_NETWORK=1")
    for item in items:
        if _UNIT_DIR in Path(str(item.path)).parents:
            item.add_marker(pytest.mark.unit)
        if item.get_closest_marker("db") is not None and item.get_closest_marker("timeout") is None:
            # Remote (Neon) database setup is slow; the global 60 s applies to unit tests.
            item.add_marker(pytest.mark.timeout(DB_TEST_TIMEOUT_S))
        if "network" in item.keywords and not allowed:
            item.add_marker(skip_network)


@pytest.fixture(autouse=True)
def _unit_blocks_sockets(request: pytest.FixtureRequest) -> None:
    if request.node.get_closest_marker("unit") is not None:
        request.getfixturevalue("socket_disabled")


# --------------------------------------------------------------------------------------
# Postgres fixtures (T02)
# --------------------------------------------------------------------------------------

DB_URL_ENV = "MM_TEST_DATABASE_URL"

# Role names of the DDL spec (section 8, ADR-012). Roles are cluster-global in Postgres, so each
# test database gets its own copies, named "<role>_<tag>" with the database's random tag.
BASE_ROLES = ("mm_owner", "mm_ingest", "mm_analytics", "mm_r", "mm_reader")

DEFAULT_TIMEOUT_S = 10.0


@dataclass(frozen=True)
class TestDatabase:
    """A throwaway database and the per-database roles created for it."""

    __test__ = False  # not a pytest test class

    name: str
    tag: str
    admin_dsn: str = field(repr=False)  # superuser DSN pointing at this database (secret: no repr)
    roles: dict[str, str]  # base role name -> actual (suffixed) role name
    passwords: dict[str, str] = field(repr=False)  # base role name -> password (secret: no repr)

    def dsn(self, role: str | None = None) -> str:
        """DSN for the superuser (role None) or for one of the per-database roles."""
        if role is None:
            return self.admin_dsn
        return make_conninfo(self.admin_dsn, user=self.roles[role], password=self.passwords[role])

    def connect(
        self, role: str | None = None, *, timeout: float = DEFAULT_TIMEOUT_S
    ) -> psycopg.Connection:
        return _connect(self.dsn(role), timeout)


def _connect(dsn: str, timeout: float) -> psycopg.Connection:
    """Open a connection that cannot hang: connect, statement and lock timeouts all apply."""
    ms = int(timeout * 1000)
    # lock_timeout is shorter than statement_timeout so that a blocked lock raises
    # LockNotAvailable instead of racing the statement timeout (QueryCanceled).
    lock_ms = max(1, ms // 2)
    return psycopg.connect(
        dsn,
        connect_timeout=max(1, int(timeout)),
        options=f"-c statement_timeout={ms} -c lock_timeout={lock_ms}",
    )


@contextlib.contextmanager
def _two_sessions(
    dsn: str, timeout: float = DEFAULT_TIMEOUT_S
) -> Iterator[tuple[psycopg.Connection, psycopg.Connection]]:
    """Two independent sessions (own transactions) for concurrency tests.

    Both sessions carry statement_timeout and lock_timeout equal to ``timeout`` seconds, so a
    blocked statement raises instead of hanging the suite.
    """
    a = _connect(dsn, timeout)
    try:
        b = _connect(dsn, timeout)
    except BaseException:
        a.close()
        raise
    try:
        yield a, b
    finally:
        for conn in (a, b):
            with contextlib.suppress(psycopg.Error):
                conn.rollback()
            conn.close()


@pytest.fixture(scope="session")
def pg_admin_dsn() -> str:
    dsn = os.environ.get(DB_URL_ENV)
    if not dsn:
        pytest.skip(
            f"{DB_URL_ENV} is not set: db tests need a Postgres superuser DSN "
            "(see docs/ops/local-development.md, scripts/dev/pg-up.sh)"
        )
    return dsn


@pytest.fixture
def test_database(pg_admin_dsn: str) -> Iterator[TestDatabase]:
    """Create a throwaway database and one login role per base role; drop all afterwards."""
    yield from _new_database(pg_admin_dsn)


@pytest.fixture
def test_database_b(pg_admin_dsn: str) -> Iterator[TestDatabase]:
    """A second, independent throwaway database (perturbation tests compare two databases)."""
    yield from _new_database(pg_admin_dsn)


def _new_database(pg_admin_dsn: str) -> Iterator[TestDatabase]:
    tag = secrets.token_hex(4)
    name = f"mm_test_{tag}"
    roles = {r: f"{r}_{tag}" for r in BASE_ROLES}
    passwords = {r: secrets.token_urlsafe(16) for r in BASE_ROLES}
    admin = psycopg.connect(pg_admin_dsn, autocommit=True, connect_timeout=10)
    try:
        # PostgreSQL 16+: a non-superuser creator is no longer implicitly able to SET ROLE to a
        # role it created, so grant that explicitly. The WITH SET clause does not exist before 16.
        grant_set = admin.info.server_version >= 160000
        for base, role in roles.items():
            admin.execute(
                sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
                    sql.Identifier(role), sql.Literal(passwords[base])
                )
            )
            admin.execute(
                sql.SQL(
                    "GRANT {} TO CURRENT_USER WITH SET TRUE"
                    if grant_set
                    else "GRANT {} TO CURRENT_USER"
                ).format(sql.Identifier(role))
            )
        admin.execute(
            sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(name), sql.Identifier(roles["mm_owner"])
            )
        )
        try:
            yield TestDatabase(
                name=name,
                tag=tag,
                admin_dsn=make_conninfo(pg_admin_dsn, dbname=name),
                roles=roles,
                passwords=passwords,
            )
        finally:
            admin.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
            )
    finally:
        for role in roles.values():
            with contextlib.suppress(psycopg.Error):
                admin.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))
        admin.close()


@pytest.fixture
def two_sessions() -> Callable[
    ..., AbstractContextManager[tuple[psycopg.Connection, psycopg.Connection]]
]:
    """Factory: ``with two_sessions(dsn, timeout=5) as (a, b): ...``."""
    return _two_sessions
