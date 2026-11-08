"""Public database dump writer (ADR-015, docs/specs/public-dump-spec.md; plan T69).

One ``REPEATABLE READ READ ONLY`` transaction reads only ``pubdump.v_*`` views
(never a base table). Output: ``data/<schema>.<table>[.part-NNNN].csv.gz`` per view,
``schema.sql`` (byte-exact migration concatenation with header lines) and ``manifest.json``.
Deterministic: rows in order-key order, fixed session settings, gzip level 9 with mtime 0
and no embedded file name. The self-check (T70) is separate.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg import IsolationLevel, sql

from macro_monitor.storage.db import DatabaseError
from macro_monitor.storage.migrate import MIGRATIONS_DIR, MigrationMismatch, discover

FORMAT_VERSION = "1.0"
PARTITION = "P-public"
DEFAULT_MAX_ROWS_PER_PART = 1_000_000
GZIP_LEVEL = 9
SCHEMA_PATH = Path(__file__).parent / "schemas" / "public-dump-manifest.schema.json"

_COMMENT_RE = re.compile(r"^target: (?P<target>[a-z_]+\.[a-z_0-9]+); order_key: (?P<key>.+)$")
_SESSION_SETTINGS = (
    "SET LOCAL TIME ZONE 'UTC'",
    "SET LOCAL DateStyle = 'ISO, YMD'",
    "SET LOCAL IntervalStyle = 'iso_8601'",
    "SET LOCAL client_encoding = 'UTF8'",
    "SET LOCAL extra_float_digits = 1",
)


class DumpError(DatabaseError):
    """The dump cannot be written (bad profile, bad view comment, dependency cycle, bad target)."""


@dataclass(frozen=True)
class ViewSpec:
    view: str  # pubdump.v_x
    target: str  # schema.table of the restore target
    order_key: tuple[str, ...]
    columns: tuple[str, ...]


def validate_manifest(manifest: dict[str, Any]) -> None:
    """Raise ``jsonschema.ValidationError`` when the manifest does not match the schema."""
    import jsonschema

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator(schema).validate(manifest)


def require_public_profile(profile: str) -> None:
    if profile != "public":
        raise DumpError(f"unknown dump profile {profile!r}: only 'public' exists (AC-WF-10)")


def _iso(value: datetime | None) -> str | None:
    return None if value is None else value.astimezone(UTC).isoformat()


def _view_specs(conn: psycopg.Connection) -> list[ViewSpec]:
    rows = conn.execute(
        "SELECT c.relname, obj_description(c.oid, 'pg_class') FROM pg_class c "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'pubdump' AND c.relkind = 'v' ORDER BY c.relname"
    ).fetchall()
    specs: list[ViewSpec] = []
    for name, comment in rows:
        match = _COMMENT_RE.match(comment or "")
        if match is None:
            continue  # v_p_public_source: the predicate, not dumped
        cols = conn.execute(
            "SELECT a.attname FROM pg_attribute a WHERE a.attrelid = %s::regclass "
            "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
            [f"pubdump.{name}"],
        ).fetchall()
        key = tuple(k.strip() for k in match["key"].split(","))
        columns = tuple(str(c[0]) for c in cols)
        if not set(key) <= set(columns):
            raise DumpError(f"order key of pubdump.{name} is not among its columns")
        specs.append(ViewSpec(f"pubdump.{name}", match["target"], key, columns))
    if not specs:
        raise DumpError("no pubdump views found")
    return specs


def _load_order(conn: psycopg.Connection, targets: list[str]) -> list[str]:
    """Parents first, from foreign keys between target tables; ties broken by name."""
    fks = conn.execute(
        "SELECT cn.nspname || '.' || c.relname, pn.nspname || '.' || p.relname "
        "FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid "
        "JOIN pg_namespace cn ON cn.oid = c.relnamespace "
        "JOIN pg_class p ON p.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = p.relnamespace "
        "WHERE k.contype = 'f'"
    ).fetchall()
    wanted = set(targets)
    parents: dict[str, set[str]] = defaultdict(set)
    for child, parent in fks:
        if child in wanted and parent in wanted and child != parent:
            parents[child].add(parent)
    order: list[str] = []
    remaining = sorted(wanted)
    while remaining:
        ready = [t for t in remaining if parents[t] <= set(order)]
        if not ready:
            raise DumpError(f"foreign-key cycle among dump tables: {remaining}")
        order.append(ready[0])
        remaining.remove(ready[0])
    return order


def _sequences(conn: psycopg.Connection, order: list[str]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for table in order:
        for (col,) in conn.execute(
            "SELECT a.attname FROM pg_attribute a WHERE a.attrelid = %s::regclass "
            "AND a.attnum > 0 AND NOT a.attisdropped AND a.attidentity <> '' ORDER BY a.attnum",
            [table],
        ).fetchall():
            seq = conn.execute("SELECT pg_get_serial_sequence(%s, %s)", [table, col]).fetchone()
            if seq is None or seq[0] is None:
                raise DumpError(f"no sequence for identity column {table}.{col}")
            out.append({"sequence": str(seq[0]), "table": table, "column": str(col)})
    return out


def _trigger_tables(conn: psycopg.Connection, order: list[str]) -> list[str]:
    have = {
        str(r[0])
        for r in conn.execute(
            "SELECT DISTINCT n.nspname || '.' || c.relname FROM pg_trigger t "
            "JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE NOT t.tgisinternal"
        ).fetchall()
    }
    return [t for t in order if t in have]


def _sources(conn: psycopg.Connection) -> dict[str, Any]:
    rows = conn.execute(
        "SELECT source_id, archive_mode, publish_site FROM pubdump.v_ref_source ORDER BY source_id"
    ).fetchall()
    included: list[str] = []
    excluded: list[dict[str, str]] = []
    for sid, archive_mode, publish_site in rows:
        if archive_mode == "public" and publish_site == "public":
            included.append(str(sid))
        else:
            reason = "archive_mode" if archive_mode != "public" else "publish_site"
            excluded.append({"source_id": str(sid), "reason": reason})
    return {"included": included, "excluded": excluded}


def _schema_sql(
    conn: psycopg.Connection, migrations_dir: Path
) -> tuple[bytes, int, list[dict[str, Any]]]:
    applied = {
        int(v): (str(n), str(c))
        for v, n, c in conn.execute(
            "SELECT version, name, checksum FROM pubdump.v_schema_migration ORDER BY version"
        ).fetchall()
    }
    if not applied:
        raise DumpError("no applied migrations")
    files = {m.version: m for m in discover(migrations_dir)}
    parts: list[bytes] = []
    migrations: list[dict[str, Any]] = []
    for version in sorted(applied):
        name, checksum = applied[version]
        mig = files.get(version)
        if mig is None or mig.name != name or mig.checksum != checksum:
            raise MigrationMismatch(f"migration {version:04d} differs from the file on disk")
        data = mig.path.read_bytes()
        parts.append(f"-- migration {version:04d} {name} sha256 {checksum}\n".encode())
        parts.append(data)
        if not data.endswith(b"\n"):
            parts.append(b"\n")  # keeps the next header line on its own line
        migrations.append({"version": version, "name": name, "sha256": checksum})
    return b"".join(parts), max(applied), migrations


def _file_path(target: str, part: int | None) -> str:
    suffix = "" if part is None else f".part-{part:04d}"
    return f"data/{target}{suffix}.csv.gz"


def _write_part(
    conn: psycopg.Connection, spec: ViewSpec, path: Path, *, limit: int | None, offset: int
) -> tuple[int, str, str, int]:
    """Write one gzip file; return (bytes_csv, sha256_csv, sha256_gz, bytes_gz)."""
    query = sql.SQL("SELECT {cols} FROM {view} ORDER BY {key}").format(
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in spec.columns),
        view=sql.Identifier(*spec.view.split(".")),
        key=sql.SQL(", ").join(sql.Identifier(c) for c in spec.order_key),
    )
    if limit is not None:
        query += sql.SQL(" LIMIT {} OFFSET {}").format(sql.Literal(limit), sql.Literal(offset))
    copy_sql = sql.SQL("COPY ({}) TO STDOUT WITH (FORMAT csv, HEADER true)").format(query)
    sha_csv = hashlib.sha256()
    total = 0
    head = b""
    with (
        path.open("wb") as raw,
        gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=GZIP_LEVEL, mtime=0) as gz,
        conn.cursor() as cur,
        cur.copy(copy_sql) as copy,
    ):
        for block in copy:
            chunk = bytes(block)
            if b"\n" not in head:
                head += chunk
            sha_csv.update(chunk)
            gz.write(chunk)
            total += len(chunk)
    header = head.split(b"\n", 1)[0].decode("utf-8").split(",")
    if header != list(spec.columns):
        raise DumpError(f"CSV header of {spec.view} differs from its column list")
    data = path.read_bytes()
    return total, sha_csv.hexdigest(), hashlib.sha256(data).hexdigest(), len(data)


def write_dump(
    conn: psycopg.Connection,
    out_dir: Path,
    *,
    ingest_run_id: int,
    git_sha: str,
    code_version: str,
    dump_id: str,
    max_rows_per_part: int = DEFAULT_MAX_ROWS_PER_PART,
    migrations_dir: Path | None = None,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    """Write the public dump into the empty directory ``out_dir`` and return the manifest."""
    if max_rows_per_part < 1:
        raise DumpError("max_rows_per_part must be at least 1")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise DumpError("output directory is not empty")
    (out_dir / "data").mkdir(parents=True, exist_ok=True)
    conn.rollback()
    conn.isolation_level = IsolationLevel.REPEATABLE_READ
    conn.read_only = True
    try:
        for stmt in _SESSION_SETTINGS:
            conn.execute(stmt.encode())
        clock = conn.execute("SELECT clock_timestamp()").fetchone()  # first query: snapshot start
        assert clock is not None
        specs = _view_specs(conn)
        order = _load_order(conn, [s.target for s in specs])
        specs.sort(key=lambda s: (order.index(s.target), s.view))
        schema_bytes, schema_version, migrations = _schema_sql(
            conn, migrations_dir or MIGRATIONS_DIR
        )
        files: list[dict[str, Any]] = []
        for spec in specs:
            row = conn.execute(
                sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(*spec.view.split(".")))
            ).fetchone()
            assert row is not None
            nrows = int(row[0])
            n_parts = max(1, -(-nrows // max_rows_per_part))
            for index in range(n_parts):
                part = None if n_parts == 1 else index + 1
                rel = _file_path(spec.target, part)
                limit = None if part is None else max_rows_per_part
                bytes_csv, sha_csv, sha_gz, bytes_gz = _write_part(
                    conn, spec, out_dir / rel, limit=limit, offset=index * max_rows_per_part
                )
                files.append(
                    {
                        "view": spec.view,
                        "target_table": spec.target,
                        "path": rel,
                        "part": part,
                        "columns": list(spec.columns),
                        "order_key": list(spec.order_key),
                        "rows": nrows
                        if part is None
                        else min(max_rows_per_part, nrows - index * max_rows_per_part),
                        "bytes_gz": bytes_gz,
                        "sha256_gz": sha_gz,
                        "bytes_csv": bytes_csv,
                        "sha256_csv": sha_csv,
                    }
                )
        max_loaded = conn.execute(
            "SELECT max(loaded_at) FROM pubdump.v_curated_observation"
        ).fetchone()
        assert max_loaded is not None
        sequences = _sequences(conn, order)
        trigger_tables = _trigger_tables(conn, order)
        sources = _sources(conn)
    finally:
        conn.rollback()
        conn.read_only = None
        conn.isolation_level = None
    (out_dir / "schema.sql").write_bytes(schema_bytes)
    manifest: dict[str, Any] = {
        "format_version": FORMAT_VERSION,
        "dump_id": dump_id,
        "created_at": _iso(created_at or datetime.now(UTC)),
        "ingest_run_id": ingest_run_id,
        "git_sha": git_sha,
        "code_version": code_version,
        "snapshot": {
            "isolation": "repeatable read",
            "database_clock": _iso(clock[0]),
            "max_loaded_at": _iso(max_loaded[0]),
        },
        "partition": PARTITION,
        "schema": {
            "path": "schema.sql",
            "sha256": hashlib.sha256(schema_bytes).hexdigest(),
            "bytes": len(schema_bytes),
            "schema_version": schema_version,
            "migrations": migrations,
        },
        "files": files,
        "load_order": order,
        "sequences": sequences,
        "trigger_tables": trigger_tables,
        "sources": sources,
        "totals": {
            "files": len(files),
            "rows": sum(f["rows"] for f in files),
            "bytes_gz": sum(f["bytes_gz"] for f in files),
        },
    }
    validate_manifest(manifest)
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return manifest
