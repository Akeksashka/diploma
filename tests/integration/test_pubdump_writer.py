# ruff: noqa: PT018, E501
"""T69: the public dump writer (ADR-015, docs/specs/public-dump-spec.md; AC-DUMP-1, 8, 9, profile clause of AC-WF-10)."""

from __future__ import annotations

import contextlib
import csv
import gzip
import hashlib
import io
import json
import secrets
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from macro_monitor import cli
from macro_monitor.storage import dump, migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

NOW = datetime(2026, 11, 4, tzinfo=UTC)


def _kw(**extra: Any) -> dict[str, Any]:
    return {
        "ingest_run_id": 1,
        "git_sha": "a" * 40,
        "code_version": "t",
        "dump_id": "db-dump-public-2026-11",
        **extra,
    }


def _prepare(db: TestDatabase) -> None:
    with db.connect("mm_owner", timeout=120) as conn:
        migrate.migrate(conn)
        conn.commit()
    here = str(Path(__file__).parent)
    if here not in sys.path:
        sys.path.insert(0, here)
    from test_pubdump_views import _build

    with db.connect("mm_ingest", timeout=120) as ing:
        _build(ing)


def _dump(db: TestDatabase, out: Path, **extra: Any) -> dict[str, Any]:
    with db.connect("mm_ingest", timeout=120) as ing:
        return dump.write_dump(ing, out, **_kw(**extra))


def _csv_bytes(out: Path, rel: str) -> bytes:
    return gzip.decompress((out / rel).read_bytes())


def _comparable(manifest: dict[str, Any]) -> dict[str, Any]:
    m = json.loads(json.dumps(manifest))
    m.pop("created_at")
    m["snapshot"].pop("database_clock")  # clock_timestamp() at snapshot start: differs per run
    return m


def test_manifest_files_and_gate(test_database: TestDatabase, tmp_path: Path) -> None:
    _prepare(test_database)
    out = tmp_path / "d"
    manifest = _dump(test_database, out, created_at=NOW)
    on_disk = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert on_disk == manifest
    dump.validate_manifest(on_disk)
    targets = set()
    for f in manifest["files"]:
        gz = (out / f["path"]).read_bytes()
        assert hashlib.sha256(gz).hexdigest() == f["sha256_gz"] and len(gz) == f["bytes_gz"]
        raw = gzip.decompress(gz)
        assert hashlib.sha256(raw).hexdigest() == f["sha256_csv"] and len(raw) == f["bytes_csv"]
        rows = list(csv.reader(io.StringIO(raw.decode("utf-8"))))
        assert rows[0] == f["columns"] and len(rows) - 1 == f["rows"]
        targets.add(f["target_table"])
    assert set(manifest["load_order"]) == targets
    order = manifest["load_order"]
    assert order.index("ref.series") < order.index("curated.observation")
    assert order.index("ingest.raw_object") < order.index("curated.observation")
    assert order.index("ops.drift_event") < order.index("ops.drift_decision")
    assert {
        "sequence": "curated.observation_obs_id_seq",
        "table": "curated.observation",
        "column": "obs_id",
    } in manifest["sequences"]
    assert "curated.observation" in manifest["trigger_tables"]
    assert manifest["sources"]["included"] == ["P"]
    assert manifest["sources"]["excluded"] == [
        {"source_id": "H", "reason": "archive_mode"},
        {"source_id": "HW", "reason": "archive_mode"},
        {"source_id": "W", "reason": "publish_site"},
    ]
    blob = b"".join(_csv_bytes(out, f["path"]) for f in manifest["files"])
    blob += (out / "schema.sql").read_bytes() + (out / "manifest.json").read_bytes()
    for src in ("W", "H", "HW"):
        assert f"MARK-{src}".encode() not in blob
        assert str(7770000 + 100 * ["P", "W", "H", "HW"].index(src)).encode() not in blob
    assert b"MARK-P" in blob
    assert manifest["totals"]["files"] == len(manifest["files"])


def test_awkward_values_round_trip(test_database: TestDatabase, tmp_path: Path) -> None:
    """AC-DUMP-1: NULL vs empty string, 2.10, newlines, quotes, non-ASCII, jsonb quotes, DST timestamps."""
    _prepare(test_database)
    awkward = 'a,"b"\nline2 \u00e9\u4e2d'
    with test_database.connect("mm_ingest", timeout=120) as ing:
        ing.execute(
            "INSERT INTO ref.unit (unit_code, dimension, description) VALUES "
            "('U1','d',%s), ('U2','d','')",
            [awkward],
        )
        ing.execute(
            "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, frequency, unit_code, "
            "price_basis, seasonal_adjustment, calendar_basis, first_seen_at, base_period) "
            "VALUES ('P','ED','d','DST','E1','t','A','PC','NA','NA','CAL','2026-03-29 00:59:59+00','')"
        )
        ing.execute(
            "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, frequency, unit_code, "
            "price_basis, seasonal_adjustment, calendar_basis, first_seen_at) "
            "VALUES ('P','ED','d','DST2','E1','t','A','PC','NA','NA','CAL','2026-10-25 01:00:00+00')"
        )
        ing.execute(
            "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, value_status, load_kind, "
            "known_at, loaded_at, raw_id, run_id) "
            "SELECT s.series_id, '2023-01-01', '2023-12-31', 2.10, 'OBS', 'initial', o.fetched_at, now(), o.raw_id, o.run_id "
            "FROM ref.series s, ingest.raw_object o WHERE s.series_key = 'DST' "
            "AND o.raw_id = (SELECT min(raw_id) FROM ingest.raw_object WHERE source_id = 'P')"
        )
        ing.execute(
            "INSERT INTO ops.drift_event (run_id, source_id, raw_id, kind, series_ref, old, new, note) "
            "SELECT run_id, source_id, raw_id, kind, series_ref, %s::jsonb, '{}'::jsonb, %s "
            "FROM ops.drift_event WHERE source_id = 'P' LIMIT 1",
            ['{"q": "x\\"y, z"}', awkward],
        )
        ing.commit()
    out = tmp_path / "d"
    manifest = _dump(test_database, out)
    wanted = {"ref.unit", "ref.series", "curated.observation", "ops.drift_event"}
    with test_database.connect() as admin:  # superuser: temp tables, reads views
        for f in manifest["files"]:
            if f["target_table"] not in wanted:
                continue
            view = sql.Identifier(*f["view"].split("."))
            admin.execute("DROP TABLE IF EXISTS rt")
            admin.execute(
                sql.SQL("CREATE TEMP TABLE rt AS SELECT * FROM {} WITH NO DATA").format(view)
            )
            with admin.cursor().copy(
                sql.SQL("COPY rt ({}) FROM STDIN WITH (FORMAT csv, HEADER true)").format(
                    sql.SQL(", ").join(sql.Identifier(c) for c in f["columns"])
                )
            ) as cp:
                cp.write(_csv_bytes(out, f["path"]))
            back = sorted(r[0] for r in admin.execute("SELECT t::text FROM rt t").fetchall())
            orig = sorted(
                r[0]
                for r in admin.execute(sql.SQL("SELECT t::text FROM {} t").format(view)).fetchall()
            )
            assert back == orig, f["view"]
            if f["target_table"] == "ref.unit":
                got = dict(admin.execute("SELECT unit_code, description FROM rt").fetchall())
                assert got["U1"] == awkward
                assert got["U2"] == ""
            if f["target_table"] == "ref.series":
                assert admin.execute(
                    "SELECT count(*) FROM rt WHERE first_seen_at IN ('2026-03-29 00:59:59+00','2026-10-25 01:00:00+00')"
                ).fetchone() == (2,)
                got_bp = dict(admin.execute("SELECT series_key, base_period FROM rt").fetchall())
                assert got_bp["DST"] == ""  # empty string preserved
                assert got_bp["DST2"] is None  # NULL preserved
            if f["target_table"] == "curated.observation":
                assert admin.execute(
                    "SELECT count(*) FROM rt WHERE value::text = '2.10'"
                ).fetchone() == (1,)
            if f["target_table"] == "ops.drift_event":
                assert admin.execute(
                    "SELECT count(*) FROM rt WHERE old->>'q' = 'x\"y, z' AND note = %s", [awkward]
                ).fetchone() == (1,)
    unit = next(f for f in manifest["files"] if f["target_table"] == "ref.unit")
    raw = _csv_bytes(out, unit["path"]).decode("utf-8").replace("\r", "")
    assert 'U2,d,""\n' in raw  # empty string is quoted
    obs = next(f for f in manifest["files"] if f["target_table"] == "curated.observation")
    assert ",2.10," in _csv_bytes(out, obs["path"]).decode("utf-8")
    ser = next(f for f in manifest["files"] if f["target_table"] == "ref.series")
    assert "2026-03-29 00:59:59+00" in _csv_bytes(out, ser["path"]).decode("utf-8")


def test_determinism_and_parts(test_database: TestDatabase, tmp_path: Path) -> None:
    """AC-DUMP-8."""
    _prepare(test_database)
    m1 = _dump(test_database, tmp_path / "a", created_at=NOW)
    m2 = _dump(test_database, tmp_path / "b", created_at=datetime(2030, 1, 1, tzinfo=UTC))
    assert _comparable(m1) == _comparable(m2)
    for f in m1["files"]:
        assert (tmp_path / "a" / f["path"]).read_bytes() == (
            tmp_path / "b" / f["path"]
        ).read_bytes()
    one = next(f for f in m1["files"] if f["target_table"] == "ref.series")
    assert one["rows"] == 4 and one["part"] is None
    m3 = _dump(test_database, tmp_path / "c", max_rows_per_part=3)
    parts = [f for f in m3["files"] if f["target_table"] == "ref.series"]
    assert [(p["part"], p["rows"]) for p in parts] == [(1, 3), (2, 1)]
    assert [p["path"] for p in parts] == [
        "data/ref.series.part-0001.csv.gz",
        "data/ref.series.part-0002.csv.gz",
    ]
    joined: list[list[str]] = []
    for p in parts:
        rows = list(csv.reader(io.StringIO(_csv_bytes(tmp_path / "c", p["path"]).decode("utf-8"))))
        assert rows[0] == p["columns"]
        joined += rows[1:]
    whole = list(csv.reader(io.StringIO(_csv_bytes(tmp_path / "a", one["path"]).decode("utf-8"))))
    assert joined == whole[1:]
    ids = [int(r[0]) for r in joined]
    assert ids == sorted(ids)
    for tgt in (
        "ref.source",
        "curated.observation",
    ):  # unaffected tables stay single files below the limit
        assert sum(1 for f in m3["files"] if f["target_table"] == tgt) >= 1


def test_schema_sql_equals_migrations_and_applies(
    test_database: TestDatabase, tmp_path: Path
) -> None:
    """AC-DUMP-9."""
    _prepare(test_database)
    out = tmp_path / "d"
    manifest = _dump(test_database, out)
    expected = b""
    for m in migrate.discover():
        data = m.path.read_bytes()
        assert data.endswith(b"\n")
        expected += f"-- migration {m.version:04d} {m.name} sha256 {m.checksum}\n".encode() + data
    schema = (out / "schema.sql").read_bytes()
    assert schema == expected
    assert manifest["schema"]["sha256"] == hashlib.sha256(schema).hexdigest()
    assert manifest["schema"]["schema_version"] == len(migrate.discover()) - 1
    # applies to an empty database (own throwaway database and roles, dropped afterwards)
    tag = secrets.token_hex(4)
    name = f"mm_test_{tag}"
    roles = [f"{b}_{tag}" for b in ("mm_owner", "mm_ingest", "mm_analytics", "mm_r", "mm_reader")]
    admin = psycopg.connect(test_database.dsn(), autocommit=True)
    try:
        grant_set = admin.info.server_version >= 160000
        for role in roles:
            admin.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
            admin.execute(
                sql.SQL(
                    "GRANT {} TO CURRENT_USER WITH SET TRUE"
                    if grant_set
                    else "GRANT {} TO CURRENT_USER"
                ).format(sql.Identifier(role))
            )
        admin.execute(
            sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(name), sql.Identifier(roles[0])
            )
        )
        try:
            with psycopg.connect(
                make_conninfo(test_database.dsn(), dbname=name), autocommit=False
            ) as fresh:
                fresh.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(roles[0])))
                fresh.execute(schema)
                fresh.commit()
                # migrations seed reference rows, but no data rows
                n = fresh.execute("SELECT count(*) FROM pubdump.v_curated_observation").fetchone()
                assert n == (0,)
                assert fresh.execute(
                    "SELECT count(*) FROM pg_namespace WHERE nspname IN ('ref','curated','ops','ingest','pubdump','analytics')"
                ).fetchone() == (6,)
        finally:
            admin.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
            )
    finally:
        for role in roles:
            with contextlib.suppress(psycopg.Error):
                admin.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))
        admin.close()


def test_checksum_mismatch_refuses(test_database: TestDatabase, tmp_path: Path) -> None:
    _prepare(test_database)
    import shutil

    mdir = tmp_path / "m"
    shutil.copytree(migrate.MIGRATIONS_DIR, mdir)
    f = mdir / "0010_unit_seed_pc_act.sql"
    f.write_bytes(f.read_bytes() + b"-- changed\n")
    with pytest.raises(migrate.MigrationMismatch):
        _dump(test_database, tmp_path / "d", migrations_dir=mdir)


def test_refuses_non_empty_dir_and_profile(test_database: TestDatabase, tmp_path: Path) -> None:
    with pytest.raises(dump.DumpError):
        dump.require_public_profile("full")
    dump.require_public_profile("public")
    (tmp_path / "x").mkdir()
    (tmp_path / "x" / "f").write_text("z")
    with test_database.connect("mm_ingest") as ing, pytest.raises(dump.DumpError):
        dump.write_dump(ing, tmp_path / "x", **_kw())


def test_cli_backup(
    test_database: TestDatabase,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _prepare(test_database)
    monkeypatch.setenv("DATABASE_URL", test_database.dsn("mm_ingest"))
    with pytest.raises(SystemExit) as exc:
        cli.main(["backup", "--profile", "full", "--out", str(tmp_path / "o")])
    assert exc.value.code == 20
    assert not (tmp_path / "o").exists()
    capsys.readouterr()
    assert (
        cli.main(
            ["backup", "--profile", "public", "--out", str(tmp_path / "o"), "--root", str(tmp_path)]
        )
        == 0
    )
    assert "backup public: db-dump-public-" in capsys.readouterr().out
    manifest = json.loads((tmp_path / "o" / "manifest.json").read_text(encoding="utf-8"))
    dump.validate_manifest(manifest)
    assert manifest["ingest_run_id"] >= 1
