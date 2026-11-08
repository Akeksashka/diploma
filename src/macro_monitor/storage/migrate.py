"""Forward-only SQL migration runner (ADR-002, ADR-008, DDL spec section 7).

- Files ``NNNN_name.sql`` in ``storage/migrations/`` are applied in version order, each in its
  own transaction together with its ``ops.schema_migration`` row (version, name, sha256).
- The checksum of an applied file must never change; a difference is a mismatch (exit code 40).
- ``migrate`` holds ``pg_advisory_lock(hashtext('mm-migrate'))`` for the whole run and refuses to
  run while an ``ingest.run`` is ``running`` and started less than 6 hours ago (workflows spec).
- ``check_schema_version`` is the pipeline-start helper for check DB-03.

Run it on a direct (non-pooled) Neon endpoint under the owner role.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import psycopg

from macro_monitor.storage.db import (
    EXIT_MIGRATION_MISMATCH,
    DatabaseError,
    is_pooled_dsn,
)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
LOCK_NAME = "mm-migrate"
RUNNING_WINDOW_HOURS = 6

_FILE_RE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")


class MigrationMismatch(DatabaseError):
    """Applied migrations differ from the files, or the schema version is not the expected one."""

    exit_code = EXIT_MIGRATION_MISMATCH


class MigrationBlocked(DatabaseError):
    """Migration refused because a pipeline run is in progress."""


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    checksum: str  # sha256 hex of the file bytes
    sql: str
    path: Path


def discover(directory: Path | None = None) -> list[Migration]:
    """Read migration files in version order; versions must be unique and run 0000, 0001, ..."""
    directory = MIGRATIONS_DIR if directory is None else directory
    found: list[Migration] = []
    for path in sorted(directory.glob("*.sql")):
        match = _FILE_RE.match(path.name)
        if match is None:
            raise MigrationMismatch(f"bad migration file name: {path.name}")
        data = path.read_bytes()
        found.append(
            Migration(
                version=int(match.group(1)),
                name=match.group(2),
                checksum=hashlib.sha256(data).hexdigest(),
                sql=data.decode("utf-8"),
                path=path,
            )
        )
    found.sort(key=lambda m: m.version)
    for index, migration in enumerate(found):
        if migration.version != index:
            raise MigrationMismatch(
                f"migration versions must be contiguous from 0000; found {migration.path.name} "
                f"at position {index}"
            )
    return found


def expected_version(migrations: list[Migration] | None = None) -> int:
    """The schema version the code expects: the highest version among the migration files."""
    files = discover() if migrations is None else migrations
    return files[-1].version if files else -1


def applied(conn: psycopg.Connection) -> dict[int, tuple[str, str]]:
    """Applied migrations as ``{version: (name, checksum)}``; empty before 0000 ran."""
    exists = conn.execute("SELECT to_regclass('ops.schema_migration')").fetchone()
    if exists is None or exists[0] is None:
        return {}
    rows = conn.execute("SELECT version, name, checksum FROM ops.schema_migration").fetchall()
    return {int(v): (str(n), str(c)) for v, n, c in rows}


def _verify_applied(done: dict[int, tuple[str, str]], files: list[Migration]) -> None:
    by_version = {m.version: m for m in files}
    for version, (name, checksum) in sorted(done.items()):
        migration = by_version.get(version)
        if migration is None:
            raise MigrationMismatch(f"applied migration {version:04d} {name} has no file")
        if migration.checksum != checksum:
            raise MigrationMismatch(
                f"checksum of applied migration {version:04d} {name} changed "
                f"(recorded {checksum}, file {migration.checksum})"
            )


def check_schema_version(conn: psycopg.Connection, migrations_dir: Path | None = None) -> int:
    """DB-03: the applied version (and every applied checksum) equals the code expectation.

    Returns the applied version; raises ``MigrationMismatch`` (exit code 40) otherwise.
    """
    files = discover(migrations_dir)
    done = applied(conn)
    _verify_applied(done, files)
    current = max(done) if done else -1
    expected = expected_version(files)
    if current != expected:
        raise MigrationMismatch(f"schema version is {current}, code expects {expected}")
    return current


def _refuse_if_run_active(conn: psycopg.Connection) -> None:
    exists = conn.execute("SELECT to_regclass('ingest.run')").fetchone()
    if exists is None or exists[0] is None:
        return
    row = conn.execute(
        "SELECT count(*) FROM ingest.run "
        "WHERE status = 'running' AND started_at > now() - make_interval(hours => %s)",
        [RUNNING_WINDOW_HOURS],
    ).fetchone()
    if row is not None and row[0] > 0:
        raise MigrationBlocked(
            f"{row[0]} ingest.run row(s) are running and started within "
            f"{RUNNING_WINDOW_HOURS} hours; refusing to migrate"
        )


def migrate(
    conn: psycopg.Connection,
    migrations_dir: Path | None = None,
    *,
    dsn: str | None = None,
) -> list[int]:
    """Apply all pending migrations; return the versions applied (empty when up to date).

    ``dsn``, when given, is only inspected to refuse a pooled endpoint. The connection must be
    in the default (non-autocommit) mode and is left open.
    """
    if dsn is not None and is_pooled_dsn(dsn):
        raise DatabaseError("migrate needs a direct (non-pooled) endpoint; advisory lock (BB20)")
    files = discover(migrations_dir)
    conn.rollback()
    conn.execute("SELECT pg_advisory_lock(hashtext(%s))", [LOCK_NAME])
    conn.commit()
    try:
        done = applied(conn)
        _verify_applied(done, files)
        _refuse_if_run_active(conn)
        conn.rollback()
        newly: list[int] = []
        for migration in files:
            if migration.version in done:
                continue
            try:
                conn.execute(migration.sql.encode("utf-8"))
                conn.execute(
                    "INSERT INTO ops.schema_migration (version, name, checksum, applied_at) "
                    "VALUES (%s, %s, %s, now())",
                    [migration.version, migration.name, migration.checksum],
                )
                conn.commit()
            except BaseException:
                conn.rollback()
                raise
            newly.append(migration.version)
        return newly
    finally:
        conn.rollback()
        conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", [LOCK_NAME])
        conn.commit()
