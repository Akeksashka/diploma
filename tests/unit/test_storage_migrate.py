"""Offline tests of migration file discovery and helpers (no database)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from macro_monitor.storage import migrate
from macro_monitor.storage.db import EXIT_DATABASE_ERROR, EXIT_MIGRATION_MISMATCH, is_pooled_dsn


def _write(directory: Path, name: str, text: str = "SELECT 1;\n") -> Path:
    path = directory / name
    path.write_text(text, encoding="utf-8")
    return path


def test_checked_in_migrations_start_with_schema_migration() -> None:
    files = migrate.discover()
    assert files[0].version == 0
    assert files[0].name == "schema_migration"
    assert "ops.schema_migration" in files[0].sql
    assert migrate.expected_version(files) == files[-1].version


def test_discover_orders_and_hashes_file_bytes(tmp_path: Path) -> None:
    _write(tmp_path, "0001_b.sql", "SELECT 2;\n")
    _write(tmp_path, "0000_a.sql", "SELECT 1;\n")
    files = migrate.discover(tmp_path)
    assert [(m.version, m.name) for m in files] == [(0, "a"), (1, "b")]
    assert files[0].checksum == hashlib.sha256(b"SELECT 1;\n").hexdigest()


def test_discover_rejects_bad_name(tmp_path: Path) -> None:
    _write(tmp_path, "0000_a.sql")
    _write(tmp_path, "1_b.sql")
    with pytest.raises(migrate.MigrationMismatch):
        migrate.discover(tmp_path)


def test_discover_rejects_gap_and_duplicate(tmp_path: Path) -> None:
    _write(tmp_path, "0000_a.sql")
    _write(tmp_path, "0002_c.sql")
    with pytest.raises(migrate.MigrationMismatch):
        migrate.discover(tmp_path)
    _write(tmp_path, "0002_dup.sql")
    _write(tmp_path, "0001_b.sql")
    with pytest.raises(migrate.MigrationMismatch):  # two files with version 0002
        migrate.discover(tmp_path)


def test_expected_version_of_empty_directory(tmp_path: Path) -> None:
    assert migrate.expected_version(migrate.discover(tmp_path)) == -1


def test_exit_codes() -> None:
    assert migrate.MigrationMismatch.exit_code == EXIT_MIGRATION_MISMATCH == 40
    assert migrate.MigrationBlocked.exit_code == EXIT_DATABASE_ERROR == 30


def test_pooled_dsn_detection() -> None:
    assert is_pooled_dsn("postgresql://u@ep-a-b-123-pooler.eu.neon.tech/db")
    assert not is_pooled_dsn("postgresql://u@ep-a-b-123.eu.neon.tech/db")
    assert not is_pooled_dsn("host=localhost dbname=x")


def test_relation_default_is_the_table() -> None:
    assert migrate.SCHEMA_MIGRATION_RELATION == "ops.schema_migration"


def test_schema_version_view_migration_is_owner_rights_and_reader_only() -> None:
    files = {m.name: m for m in migrate.discover()}
    text = files["ops_schema_version_view"].sql
    sql = "\n".join(line for line in text.splitlines() if not line.startswith("--"))
    assert "CREATE VIEW ops.v_schema_version" in sql
    assert "security_invoker" not in sql
    assert "applied_at" not in sql.split("CREATE VIEW", 1)[1].split(";", 1)[0]
    assert sql.count("GRANT") == 1
    assert "'mm_reader' || sfx" in sql
