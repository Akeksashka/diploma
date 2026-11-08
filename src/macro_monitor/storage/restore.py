"""Restore of the public database dump and round trip (ADR-015, dump spec section 6; plan T71).

Runs exactly the six steps of the spec with ``psql``, ``gzip`` and ``sha256sum`` (external
processes found on PATH; ``pg_dump`` and ``pg_restore`` are never used or needed, AC-WF-14).
Python only parses the manifest and orchestrates the commands.

1. Verify every file hash against ``manifest.json`` (and the ``schema.sql`` hash) before any SQL.
2. ``psql -f schema.sql`` into an empty database.
3. Per table in ``load_order``: ``DISABLE TRIGGER USER``, plain ``DELETE`` of rows seeded by
   migrations when the table is non-empty (ADR-022; aborts for ``ref.config_history`` and
   ``ops.schema_migration``), ``\\copy`` every part, then ``ENABLE TRIGGER USER``.
4. Reset identity sequences.
5. Verify row counts and the migration checksums.
6. (Passwords: out of band, nothing to do.)

The optional round trip (``roundtrip``) re-runs the dump writer on the restored database and
compares ``sha256_csv`` of every file (AC-DUMP-5). The target is addressed through ``PG*``
environment variables so no DSN or password appears on a command line or in a log.

Release assets are named with ``/`` mapped to ``__`` (``release_archive.upload_name``); the
file resolver below maps back through the manifest paths.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from psycopg.conninfo import conninfo_to_dict

from macro_monitor.storage.db import DatabaseError
from macro_monitor.storage.dump import validate_manifest, write_dump
from macro_monitor.storage.release_archive import upload_name

_IDENT = re.compile(r"^[a-z_][a-z_0-9]*$")
_TABLE = re.compile(r"^[a-z_]+\.[a-z_][a-z_0-9]*$")
_DATA_PATH = re.compile(r"^data/[a-z_]+\.[a-z_0-9]+(\.part-[0-9]{4})?\.csv\.gz$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_PG_ENV = {
    "host": "PGHOST",
    "hostaddr": "PGHOSTADDR",
    "port": "PGPORT",
    "dbname": "PGDATABASE",
    "user": "PGUSER",
    "password": "PGPASSWORD",
    "sslmode": "PGSSLMODE",
    "sslrootcert": "PGSSLROOTCERT",
    "channel_binding": "PGCHANNELBINDING",
    "options": "PGOPTIONS",
    "connect_timeout": "PGCONNECT_TIMEOUT",
    "application_name": "PGAPPNAME",
}
SUPPORTED_MAJOR = "1"
_NEEDED_TOOLS = ("psql", "gzip")
_MAX_ERR = 400
# Schemas whose presence means the target is not empty.
_SCHEMAS = ("ref", "ingest", "staging", "curated", "analytics", "analytics_r", "ops", "pubdump")


class RestoreError(DatabaseError):
    """The restore cannot proceed or a verification failed."""


class HashMismatch(RestoreError):
    """A file does not match the manifest; raised before any SQL runs."""


@dataclass
class RestoreResult:
    dump_id: str
    tables: dict[str, int] = field(default_factory=dict)  # target table -> restored row count
    roundtrip_mismatches: list[str] | None = None  # None: not run


# ----------------------------------------------------------------------------- process helpers


def pg_environment(dsn: str, base: Mapping[str, str] | None = None) -> dict[str, str]:
    """Process environment for ``psql``: the DSN as ``PG*`` variables, stale ones removed."""
    env = dict(base if base is not None else os.environ)
    for key in list(env):
        if key.startswith("PG") and key != "PGPASSFILE":
            del env[key]
    params = conninfo_to_dict(dsn)
    unknown = sorted(k for k in params if k not in _PG_ENV)
    if unknown:
        raise RestoreError(f"unsupported connection parameter(s): {', '.join(unknown)}")
    for key, value in params.items():
        env[_PG_ENV[key]] = str(value)
    env["PGCONNECT_TIMEOUT"] = env.get("PGCONNECT_TIMEOUT", "30")
    return env


def _short_error(stderr: bytes) -> str:
    # Keep only ERROR lines: CONTEXT/DETAIL lines of a failed COPY quote the data row.
    lines = [
        ln
        for ln in stderr.decode("utf-8", "replace").splitlines()
        if "ERROR:" in ln or "FATAL:" in ln
    ]
    return "; ".join(lines)[:_MAX_ERR] or "no error text"


class _Tools:
    def __init__(self, env: dict[str, str]) -> None:
        self.env = env
        path = env.get("PATH", "")
        self.psql = self._find("psql", path)
        self.gzip = self._find("gzip", path)
        sha = shutil.which("sha256sum", path=path)
        shasum = shutil.which("shasum", path=path)
        if sha:
            self.sha: list[str] = [sha]
        elif shasum:  # macOS development hosts have no sha256sum
            self.sha = [shasum, "-a", "256"]
        else:
            raise RestoreError("required tool not found on PATH: sha256sum")

    @staticmethod
    def _find(name: str, path: str) -> str:
        found = shutil.which(name, path=path)
        if found is None:
            raise RestoreError(f"required tool not found on PATH: {name}")
        return found

    def psql_cmd(self, *args: str) -> list[str]:
        return [self.psql, "-X", "-q", "-v", "ON_ERROR_STOP=1", *args]

    def run_sql(self, statement: str) -> None:
        proc = subprocess.run(
            self.psql_cmd("-c", statement), env=self.env, capture_output=True, check=False
        )
        if proc.returncode != 0:
            raise RestoreError(f"psql failed ({statement[:60]!r}): {_short_error(proc.stderr)}")

    def query(self, statement: str) -> list[list[str]]:
        proc = subprocess.run(
            self.psql_cmd("-A", "-t", "-F", "|", "-c", statement),
            env=self.env,
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RestoreError(f"psql query failed: {_short_error(proc.stderr)}")
        return [ln.split("|") for ln in proc.stdout.decode("utf-8").splitlines() if ln]

    def sha256_file(self, path: Path) -> str:
        proc = subprocess.run([*self.sha, str(path)], capture_output=True, check=False)
        if proc.returncode != 0:
            raise RestoreError(f"sha256sum failed for {path.name}")
        return proc.stdout.decode("ascii").split()[0]

    def sha256_gunzipped(self, path: Path) -> str:
        with subprocess.Popen(
            [self.gzip, "-dc", str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE
        ) as gz:
            assert gz.stdout is not None
            sha = subprocess.run(self.sha, stdin=gz.stdout, capture_output=True, check=False)
            gz.stdout.close()
            gz.wait()
            if gz.returncode != 0 or sha.returncode != 0:
                raise HashMismatch(f"{path.name}: cannot decompress")
        return sha.stdout.decode("ascii").split()[0]


# ----------------------------------------------------------------------------- manifest


def _resolve(directory: Path, rel: str) -> Path:
    """File of manifest path ``rel`` inside ``directory`` (also under its release-asset name)."""
    for candidate in (directory / rel, directory / upload_name(rel)):
        if candidate.is_file():
            return candidate
    raise HashMismatch(f"file missing from the download directory: {rel}")


def _load_manifest(directory: Path) -> dict[str, Any]:
    path = directory / "manifest.json"
    if not path.is_file():
        raise RestoreError("manifest.json missing from the download directory")
    try:
        manifest: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        validate_manifest(manifest)
    except Exception as exc:  # jsonschema.ValidationError, JSON and unicode errors
        raise RestoreError(f"manifest.json is invalid: {type(exc).__name__}") from exc
    if str(manifest["format_version"]).split(".")[0] != SUPPORTED_MAJOR:
        raise RestoreError(f"unsupported manifest format_version {manifest['format_version']!r}")
    _check_names(manifest)
    return manifest


def _check_names(manifest: dict[str, Any]) -> None:
    """Names from the manifest end up in SQL and file paths: only the safe shapes pass."""
    tables = set(manifest["load_order"])
    for table in tables:
        if not _TABLE.match(table):
            raise RestoreError("manifest: unsafe table name")
    for f in manifest["files"]:
        if not _DATA_PATH.match(f["path"]) or f["target_table"] not in tables:
            raise RestoreError("manifest: unsafe file path or unknown target table")
        if not all(_IDENT.match(c) for c in f["columns"]):
            raise RestoreError("manifest: unsafe column name")
        if not (_SHA.match(f["sha256_gz"]) and _SHA.match(f["sha256_csv"])):
            raise RestoreError("manifest: malformed hash")
    for s in manifest["sequences"]:
        if not (
            _TABLE.match(s["sequence"]) and _TABLE.match(s["table"]) and _IDENT.match(s["column"])
        ):
            raise RestoreError("manifest: unsafe sequence entry")
    for t in manifest["trigger_tables"]:
        if t not in tables:
            raise RestoreError("manifest: trigger table not in load_order")
    if {f["target_table"] for f in manifest["files"]} != tables:
        raise RestoreError("manifest: load_order does not cover the file targets")


def _qualified(name: str) -> str:
    schema, table = name.split(".")
    return f'"{schema}"."{table}"'


# ----------------------------------------------------------------------------- steps


def verify_files(directory: Path, manifest: dict[str, Any], tools: _Tools) -> None:
    """Step 1: no SQL has run yet; any mismatch raises ``HashMismatch``."""
    schema = manifest["schema"]
    schema_path = directory / schema["path"]
    if not schema_path.is_file():
        raise HashMismatch("schema.sql missing from the download directory")
    if tools.sha256_file(schema_path) != schema["sha256"]:
        raise HashMismatch("schema.sql: sha256 differs from the manifest")
    for f in manifest["files"]:
        path = _resolve(directory, f["path"])
        if path.stat().st_size != f["bytes_gz"] or tools.sha256_file(path) != f["sha256_gz"]:
            raise HashMismatch(f"{f['path']}: sha256_gz differs from the manifest")
        if tools.sha256_gunzipped(path) != f["sha256_csv"]:
            raise HashMismatch(f"{f['path']}: sha256_csv differs from the manifest")


def _copy_part(directory: Path, f: dict[str, Any], tools: _Tools) -> None:
    cols = ", ".join(f'"{c}"' for c in f["columns"])
    copy = (
        f"\\copy {_qualified(f['target_table'])} ({cols}) FROM STDIN WITH (FORMAT csv, HEADER true)"
    )
    path = _resolve(directory, f["path"])
    with subprocess.Popen(
        [tools.gzip, "-dc", str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE
    ) as gz:
        assert gz.stdout is not None
        proc = subprocess.run(
            tools.psql_cmd("-c", copy),
            stdin=gz.stdout,
            env=tools.env,
            capture_output=True,
            check=False,
        )
        gz.stdout.close()
        gz.wait()
    if gz.returncode != 0:
        raise RestoreError(f"gzip failed for {f['path']}")
    if proc.returncode != 0:
        raise RestoreError(f"\\copy of {f['path']} failed: {_short_error(proc.stderr)}")


def _assert_empty(tools: _Tools) -> None:
    names = ", ".join(f"'{s}'" for s in _SCHEMAS)
    found = tools.query(f"SELECT nspname FROM pg_namespace WHERE nspname IN ({names})")
    if found:
        raise RestoreError("target database is not empty (a dump schema already exists)")


# ADR-022: history and ledger tables are never cleared; a non-empty one aborts the restore.
_NEVER_CLEARED = frozenset({"ref.config_history", "ops.schema_migration"})


def _clear_seeded(tools: _Tools, table: str, qualified: str) -> None:
    """Delete rows that migrations seeded (plain DELETE, no TRUNCATE) before the table's copy."""
    if int(tools.query(f"SELECT count(*) FROM {qualified}")[0][0]) == 0:
        return
    if table in _NEVER_CLEARED:
        raise RestoreError(f"{table} is not empty after schema.sql; refusing to delete from it")
    tools.run_sql(f"DELETE FROM {qualified}")


def restore(
    directory: Path, dsn: str, *, environ: Mapping[str, str] | None = None
) -> RestoreResult:
    """Run spec section 6 steps 1-5 into the empty database addressed by ``dsn``."""
    env = pg_environment(dsn, environ)
    tools = _Tools(env)
    manifest = _load_manifest(directory)
    verify_files(directory, manifest, tools)  # step 1; nothing touched the database yet
    _assert_empty(tools)
    proc = subprocess.run(
        tools.psql_cmd("-f", str(directory / manifest["schema"]["path"])),
        env=env,
        capture_output=True,
        check=False,
    )  # step 2
    if proc.returncode != 0:
        raise RestoreError(f"schema.sql failed: {_short_error(proc.stderr)}")
    by_table: dict[str, list[dict[str, Any]]] = {}
    for f in manifest["files"]:
        by_table.setdefault(f["target_table"], []).append(f)
    triggers = set(manifest["trigger_tables"])
    for table in manifest["load_order"]:  # step 3
        qualified = _qualified(table)
        if table in triggers:
            tools.run_sql(f"ALTER TABLE {qualified} DISABLE TRIGGER USER")
        _clear_seeded(tools, table, qualified)  # ADR-022
        for f in sorted(by_table[table], key=lambda x: x["part"] or 0):
            _copy_part(directory, f, tools)
        if table in triggers:
            tools.run_sql(f"ALTER TABLE {qualified} ENABLE TRIGGER USER")
    for s in manifest["sequences"]:  # step 4
        col = f'"{s["column"]}"'
        tools.run_sql(
            f"SELECT setval('{s['sequence']}', "
            f"COALESCE((SELECT max({col}) FROM {_qualified(s['table'])}), 0) + 1, false)"
        )
    result = RestoreResult(dump_id=manifest["dump_id"])
    for table in manifest["load_order"]:  # step 5
        expected = sum(f["rows"] for f in by_table[table])
        got = int(tools.query(f"SELECT count(*) FROM {_qualified(table)}")[0][0])
        if got != expected:
            raise RestoreError(f"{table}: {got} rows restored, manifest says {expected}")
        result.tables[table] = got
    applied = [
        (int(v), n, c)
        for v, n, c in tools.query(
            "SELECT version, name, checksum FROM ops.schema_migration ORDER BY version"
        )
    ]
    wanted = [(m["version"], m["name"], m["sha256"]) for m in manifest["schema"]["migrations"]]
    if applied != wanted:
        raise RestoreError("ops.schema_migration differs from manifest.schema.migrations (step 5)")
    return result


# ----------------------------------------------------------------------------- round trip


def _inferred_part_size(manifest: dict[str, Any]) -> int | None:
    sizes = [f["rows"] for f in manifest["files"] if f["part"] == 1]
    return max(sizes) if sizes else None


def roundtrip(directory: Path, dsn: str, *, work_dir: Path | None = None) -> list[str]:
    """AC-DUMP-5: re-dump the restored database; list files whose sha256_csv differs."""
    import psycopg

    from macro_monitor.storage.dump import DEFAULT_MAX_ROWS_PER_PART

    manifest = _load_manifest(directory)
    base = work_dir or Path(tempfile.mkdtemp(prefix="mm-roundtrip-"))
    out = base / "redump"
    try:
        with psycopg.connect(dsn, connect_timeout=30) as conn:
            again = write_dump(
                conn,
                out,
                ingest_run_id=manifest["ingest_run_id"],
                git_sha=manifest["git_sha"],
                code_version=manifest["code_version"],
                dump_id=manifest["dump_id"],
                max_rows_per_part=_inferred_part_size(manifest) or DEFAULT_MAX_ROWS_PER_PART,
                created_at=datetime.now(UTC),
            )
    finally:
        if work_dir is None:
            shutil.rmtree(base, ignore_errors=True)
    old = {f["path"]: f["sha256_csv"] for f in manifest["files"]}
    new = {f["path"]: f["sha256_csv"] for f in again["files"]}
    return sorted(p for p in old.keys() | new.keys() if old.get(p) != new.get(p))


def restore_test(directory: Path, dsn: str, *, do_roundtrip: bool = True) -> RestoreResult:
    result = restore(directory, dsn)
    if do_roundtrip:
        result.roundtrip_mismatches = roundtrip(directory, dsn)
        if result.roundtrip_mismatches:
            raise RestoreError(
                "round trip: sha256_csv differs for " + ", ".join(result.roundtrip_mismatches)
            )
    return result
