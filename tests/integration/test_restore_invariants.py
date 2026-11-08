# ruff: noqa: PT018, E501
"""T71: psql-only restore of the public dump and round trip (dump spec sections 6-7).

AC-DUMP-4 (restore with psql, gzip, sha256sum only; counts; constraints; identity sequences;
triggers re-enabled; GENERATED ALWAYS identity columns via \\copy = BB29 on the test server),
AC-DUMP-5 (re-dump gives identical sha256_csv), AC-DUMP-9 (changed migration checksum fails at
step 5), AC-WF-14 (no pg_dump/pg_restore on PATH; changed manifest hash fails before any SQL),
invariants after step 5 for P-public sources only and no analytics.* content.

One module-scoped world: a source database with the dump fixture, its dump (parts of 3 rows),
and a restored database. Throwaway databases and roles only.
"""

from __future__ import annotations

import contextlib
import json
import os
import secrets
import shutil
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from macro_monitor.storage import dump, restore
from macro_monitor.storage.release_archive import upload_name

pytestmark = [pytest.mark.db, pytest.mark.db_invariants, pytest.mark.timeout(1800)]

_TESTS = str(Path(__file__).resolve().parents[1])
_HERE = str(Path(__file__).resolve().parent)
for _p in (_TESTS, _HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from test_pubdump_writer import _kw, _prepare  # noqa: E402

from conftest import BASE_ROLES, TestDatabase  # noqa: E402

UNREACHABLE = "postgresql://nobody:x@127.0.0.1:1/none"  # any connection attempt fails


@contextlib.contextmanager
def _new_database(admin_dsn: str) -> Iterator[TestDatabase]:
    """A throwaway database and its five roles (same shape as the ``test_database`` fixture)."""
    tag = secrets.token_hex(4)
    name = f"mm_test_{tag}"
    roles = {r: f"{r}_{tag}" for r in BASE_ROLES}
    passwords = {r: secrets.token_urlsafe(16) for r in BASE_ROLES}
    admin = psycopg.connect(admin_dsn, autocommit=True, connect_timeout=10)
    try:
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
                admin_dsn=make_conninfo(admin_dsn, dbname=name),
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


def _restricted_path(tmp: Path) -> dict[str, str]:
    """Environment whose PATH holds only psql, gzip and sha256sum (AC-WF-14)."""
    bindir = tmp / "bin"
    bindir.mkdir()
    for tool in ("psql", "gzip", "sha256sum"):
        found = shutil.which(tool)
        if found is None and tool == "sha256sum":
            found = shutil.which("shasum")
            if found is not None:
                (bindir / "shasum").symlink_to(found)
                continue
        if found is None:
            pytest.skip(f"{tool} not installed")
        (bindir / tool).symlink_to(found)
    env = dict(os.environ)
    env["PATH"] = str(bindir)
    assert shutil.which("pg_dump", path=env["PATH"]) is None
    assert shutil.which("pg_restore", path=env["PATH"]) is None
    return env


@dataclass
class World:
    src: TestDatabase
    dst: TestDatabase
    dump_dir: Path
    manifest: dict[str, Any]
    result: restore.RestoreResult
    env: dict[str, str] = field(repr=False)  # holds the whole environment: never in a repr
    admin_dsn: str = field(repr=False)  # secret


@pytest.fixture(scope="module")
def world(pg_admin_dsn: str, tmp_path_factory: pytest.TempPathFactory) -> Iterator[World]:
    tmp = tmp_path_factory.mktemp("restore")
    env = _restricted_path(tmp)
    with _new_database(pg_admin_dsn) as src, _new_database(pg_admin_dsn) as dst:
        _prepare(src)
        out = tmp / "dump"
        with src.connect("mm_ingest", timeout=120) as ing:
            manifest = dump.write_dump(ing, out, **_kw(max_rows_per_part=3))
        result = restore.restore(out, dst.dsn("mm_owner"), environ=env)
        yield World(src, dst, out, manifest, result, env, pg_admin_dsn)


def _copy_dump(world: World, tmp: Path) -> Path:
    target = tmp / "d"
    shutil.copytree(world.dump_dir, target)
    return target


def _write_manifest(directory: Path, manifest: dict[str, Any]) -> None:
    (directory / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")


# ------------------------------------------------------------------------------ AC-DUMP-4


def test_counts_equal_manifest(world: World) -> None:
    expected: dict[str, int] = {}
    for f in world.manifest["files"]:
        expected[f["target_table"]] = expected.get(f["target_table"], 0) + f["rows"]
    assert world.result.tables == expected
    assert any(f["part"] is not None for f in world.manifest["files"])  # parts were exercised
    with world.dst.connect("mm_owner", timeout=120) as conn:
        for table, rows in expected.items():
            got = conn.execute(
                sql.SQL("SELECT count(*) FROM {}").format(sql.SQL(table))  # names from our manifest
            ).fetchone()
            assert got is not None and got[0] == rows, table
    assert expected["curated.observation"] > 0


def test_generated_always_identity_columns_loaded(world: World) -> None:
    """BB29 on the test server: \\copy filled GENERATED ALWAYS identity columns with dump values."""
    assert world.manifest["sequences"]
    with world.dst.connect("mm_owner", timeout=120) as dstc:
        for s in world.manifest["sequences"]:
            ident = dstc.execute(
                "SELECT a.attidentity FROM pg_attribute a WHERE a.attrelid = %s::regclass AND a.attname = %s",
                [s["table"], s["column"]],
            ).fetchone()
            assert ident is not None and ident[0] == "a", s  # GENERATED ALWAYS
    with (
        world.src.connect("mm_owner", timeout=120) as srcc,
        world.dst.connect("mm_owner", timeout=120) as dstc,
    ):
        for table, col in (("curated.observation", "obs_id"), ("ref.series", "series_id")):
            q = f"SELECT {col} FROM pubdump.v_{table.replace('.', '_')}"
            if table == "ref.series":
                q = "SELECT series_id FROM pubdump.v_ref_series"
            a = sorted(r[0] for r in srcc.execute(q).fetchall())
            b = sorted(r[0] for r in dstc.execute(f"SELECT {col} FROM {table}").fetchall())
            assert a == b and a, table


def test_constraints_intact_and_validate(world: World) -> None:
    with world.dst.connect("mm_owner", timeout=120) as conn:
        cons = conn.execute(
            "SELECT n.nspname || '.' || c.relname, k.conname, k.convalidated FROM pg_constraint k "
            "JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE k.contype IN ('f', 'c') AND n.nspname IN ('ref','ingest','curated','ops')"
        ).fetchall()
        assert any(c[2] for c in cons)
        for table, name, _ in cons:
            conn.execute(
                sql.SQL("ALTER TABLE {} VALIDATE CONSTRAINT {}").format(
                    sql.SQL(table), sql.Identifier(name)
                )
            )
        # orphan rows: the FK graph is enforced during \copy, so a plain probe finds none
        orphans = conn.execute(
            "SELECT count(*) FROM curated.observation o LEFT JOIN ref.series s USING (series_id) "
            "WHERE s.series_id IS NULL"
        ).fetchone()
        assert orphans is not None and orphans[0] == 0
        conn.commit()


def test_sequences_reset_and_triggers_enabled(world: World) -> None:
    with world.dst.connect("mm_owner", timeout=120) as conn:
        for s in world.manifest["sequences"]:
            top = conn.execute(
                sql.SQL("SELECT COALESCE(max({}), 0) FROM {}").format(
                    sql.Identifier(s["column"]), sql.SQL(s["table"])
                )
            ).fetchone()
            nxt = conn.execute("SELECT nextval(%s::regclass)", [s["sequence"]]).fetchone()
            assert top is not None and nxt is not None and nxt[0] > top[0], s
        conn.commit()
        disabled = conn.execute(
            "SELECT n.nspname || '.' || c.relname || '.' || t.tgname FROM pg_trigger t "
            "JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE NOT t.tgisinternal AND t.tgenabled <> 'O' AND n.nspname IN ('ref','ingest','curated','ops')"
        ).fetchall()
        assert disabled == []
        with pytest.raises(psycopg.Error):  # append-only guard fires again
            conn.execute("UPDATE curated.observation SET value = value")
        conn.rollback()


def test_config_history_count_equals_manifest(world: World) -> None:
    expected = sum(
        f["rows"] for f in world.manifest["files"] if f["target_table"] == "ref.config_history"
    )
    with world.dst.connect("mm_owner", timeout=120) as conn:
        got = conn.execute("SELECT count(*) FROM ref.config_history").fetchone()
    assert got is not None and got[0] == expected  # feeders did not fire


# ------------------------------------------------------------------------------ invariants (P-public only)


def test_public_partition_only_and_no_analytics(world: World) -> None:
    assert world.manifest["sources"]["excluded"]
    with world.dst.connect("mm_owner", timeout=120) as conn:
        bad = conn.execute(
            "SELECT count(*) FROM curated.observation o JOIN ref.series s USING (series_id) "
            "JOIN ref.source r USING (source_id) "
            "WHERE NOT (r.archive_mode = 'public' AND r.publish_site = 'public')"
        ).fetchone()
        assert bad is not None and bad[0] == 0
        tables = conn.execute(
            "SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname IN ('analytics', 'analytics_r') AND c.relkind IN ('r', 'p')"
        ).fetchall()
        for (t,) in tables:
            row = conn.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.SQL(t))).fetchone()
            assert row is not None and row[0] == 0, t
        redacted = conn.execute(
            "SELECT count(*) FROM ops.quality_override q JOIN ref.series s USING (series_id) "
            "JOIN ref.source r USING (source_id) "
            "WHERE NOT (r.archive_mode = 'public' AND r.publish_site = 'public') AND q.reason <> '[redacted]'"
        ).fetchone()
        assert redacted is not None and redacted[0] == 0


# ------------------------------------------------------------------------------ AC-DUMP-5


def test_round_trip_identical_sha256_csv(world: World, tmp_path: Path) -> None:
    assert restore.roundtrip(world.dump_dir, world.dst.dsn("mm_owner"), work_dir=tmp_path) == []


# ------------------------------------------------------------------------------ ADR-022


def test_schema_sql_seeds_only_ref_unit_pin(world: World) -> None:
    """Pin: rows present right after schema.sql on an empty database (the restore deletes them)."""
    schema = (world.dump_dir / world.manifest["schema"]["path"]).read_text(encoding="utf-8")
    with (
        _new_database(world.admin_dsn) as fresh,
        fresh.connect("mm_owner", timeout=120) as conn,
    ):
        conn.execute(schema)  # type: ignore[arg-type]
        conn.commit()
        tables = [
            f"{r[0]}.{r[1]}"
            for r in conn.execute(
                "SELECT schemaname, tablename FROM pg_tables "
                "WHERE schemaname NOT IN ('pg_catalog', 'information_schema')"
            ).fetchall()
        ]
        assert tables
        non_empty = {
            t
            for t in tables
            if conn.execute(
                sql.SQL("SELECT count(*) FROM {}.{}").format(
                    *(sql.Identifier(x) for x in t.split("."))
                )
            ).fetchone()[0]  # type: ignore[index]
            > 0
        }
    assert non_empty == {"ref.unit"}


def test_ref_unit_precedes_ref_series_in_load_order(world: World) -> None:
    order = world.manifest["load_order"]
    assert order.index("ref.unit") < order.index("ref.series")


def test_truncate_of_referenced_ref_unit_fails(world: World) -> None:
    """ADR-022 premise: TRUNCATE is unusable on ref.unit (incoming FK from ref.series)."""
    with _new_database(world.admin_dsn) as fresh:
        schema = (world.dump_dir / world.manifest["schema"]["path"]).read_text(encoding="utf-8")
        with fresh.connect("mm_owner", timeout=120) as conn:
            conn.execute(schema)  # type: ignore[arg-type]
            conn.commit()
            with pytest.raises(psycopg.errors.FeatureNotSupported):
                conn.execute("TRUNCATE ref.unit")


def test_restore_refuses_non_empty_target(world: World) -> None:
    with pytest.raises(restore.RestoreError, match="not empty"):
        restore.restore(world.dump_dir, world.dst.dsn("mm_owner"), environ=world.env)


# ------------------------------------------------------------------------------ AC-WF-14 / AC-DUMP-9


def test_changed_hash_fails_before_any_sql(world: World, tmp_path: Path) -> None:
    """The DSN is unreachable: reaching SQL would raise a connection error, not HashMismatch."""
    d = _copy_dump(world, tmp_path)
    manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    manifest["files"][0]["sha256_gz"] = "0" * 64
    _write_manifest(d, manifest)
    with pytest.raises(restore.HashMismatch):
        restore.restore(d, UNREACHABLE, environ=world.env)


def test_changed_csv_hash_and_corrupt_file_fail_before_sql(world: World, tmp_path: Path) -> None:
    d = _copy_dump(world, tmp_path)
    manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    manifest["files"][1]["sha256_csv"] = "f" * 64
    _write_manifest(d, manifest)
    with pytest.raises(restore.HashMismatch):
        restore.restore(d, UNREACHABLE, environ=world.env)
    d2 = tmp_path / "d2"
    shutil.copytree(world.dump_dir, d2)
    victim = d2 / world.manifest["files"][0]["path"]
    data = bytearray(victim.read_bytes())
    data[-5] ^= 0xFF
    victim.write_bytes(bytes(data))
    with pytest.raises(restore.HashMismatch):
        restore.restore(d2, UNREACHABLE, environ=world.env)
    d3 = tmp_path / "d3"
    shutil.copytree(world.dump_dir, d3)
    (d3 / "schema.sql").write_bytes((d3 / "schema.sql").read_bytes() + b"-- x\n")
    with pytest.raises(restore.HashMismatch):
        restore.restore(d3, UNREACHABLE, environ=world.env)


def test_unsafe_manifest_names_rejected(world: World, tmp_path: Path) -> None:
    d = _copy_dump(world, tmp_path)
    manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    manifest["files"][0]["path"] = "data/../../etc/passwd.csv.gz"
    _write_manifest(d, manifest)
    with pytest.raises(restore.RestoreError):
        restore.restore(d, UNREACHABLE, environ=world.env)


def test_release_asset_names_map_back(world: World, tmp_path: Path) -> None:
    d = tmp_path / "assets"
    d.mkdir()
    for f in world.manifest["files"]:
        shutil.copy(world.dump_dir / f["path"], d / upload_name(f["path"]))
    shutil.copy(world.dump_dir / "schema.sql", d / "schema.sql")
    shutil.copy(world.dump_dir / "manifest.json", d / "manifest.json")
    tools = restore._Tools(restore.pg_environment(UNREACHABLE, world.env))
    restore.verify_files(d, restore._load_manifest(d), tools)  # no SQL, no connection


def test_changed_migration_checksum_fails_at_step_5(world: World, tmp_path: Path) -> None:
    d = _copy_dump(world, tmp_path)
    manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    manifest["schema"]["migrations"][0]["sha256"] = "0" * 64
    _write_manifest(d, manifest)
    with (
        _new_database(world.admin_dsn) as third,
        pytest.raises(restore.RestoreError, match="schema_migration"),
    ):
        restore.restore(d, third.dsn("mm_owner"), environ=world.env)
