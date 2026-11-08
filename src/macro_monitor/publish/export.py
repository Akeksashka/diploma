"""Export framework (T82; export spec sections 1-3, 10, ADR-010, ADR-012).

One read-only ``mm_reader`` session per run. The run is selected through
``analytics.v_run_published`` (greatest ``analysis_run_id`` for the supplied ``ingest_run_id``);
no such row fails EXP-10 and nothing is written under ``data/``. Producers (meta, scorecard,
series, ... : T83 onwards) add files to an in-memory :class:`ExportSink` through the deterministic
writers below; files, the manifest and ``export-status.json`` are written only when all of them
passed validation. The checks EXP-01..07, 09, 10 and the size budgets live in ``publish.checks``
(a ``Checker`` passed to :func:`run_export`); EXP-08 (determinism) is the optional second pass here.
``record-export`` is ``publish.record``.
"""

from __future__ import annotations

import json
import shutil
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

import psycopg
import pyarrow as pa
import pyarrow.parquet as pq

from macro_monitor.publish import manifest as mf
from macro_monitor.publish.manifest import FileEntry, RunInfo
from macro_monitor.storage.db import DatabaseError

STATUS_SCHEMA_VERSION = "1.0"
MAX_ROW_GROUP_ROWS = 50_000
PARQUET_COMPRESSION = "zstd"
PARQUET_COMPRESSION_LEVEL = 3
RUN_COLUMNS = (
    "analysis_run_id, ingest_run_id, as_of_run_date, known_cutoff, load_cutoff, code_version, "
    "git_sha, config_sha256"
)
RUN_SELECT = (
    f"SELECT {RUN_COLUMNS} FROM analytics.v_run_published "
    "WHERE ingest_run_id = %s ORDER BY analysis_run_id DESC LIMIT 1"
)


class ExportError(DatabaseError):
    """The export cannot complete; nothing is deployed. ``check`` names the failed check."""

    def __init__(
        self, message: str, check: str = "EXPORT", failures: Sequence[str] | None = None
    ) -> None:
        super().__init__(message)
        self.check = check
        self.failures = list(failures) if failures else [f"{check}: {message}"]


# --------------------------------------------------------------------------------------
# Deterministic writers
# --------------------------------------------------------------------------------------


def sorted_by_id(rows: Iterable[dict[str, Any]], key: str = "id") -> list[dict[str, Any]]:
    """Arrays in the metadata files are sorted by id (export spec section 4)."""
    return sorted(rows, key=lambda r: str(r[key]))


def json_bytes(obj: Any) -> bytes:
    """Canonical JSON: UTF-8, sorted keys, fixed indent, trailing newline, no NaN/Infinity.
    Non-JSON types (Decimal, datetime) raise TypeError: producers format values themselves."""
    return (
        json.dumps(obj, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    ).encode()


def _row_group_slices(table: pa.Table, group_by: str | None) -> list[tuple[int, int]]:
    n = table.num_rows
    if n == 0:
        return []
    bounds: list[tuple[int, int]] = []
    if group_by is None:
        starts = [0]
    else:
        col = table.column(group_by).to_pylist()
        starts = [0] + [i for i in range(1, n) if col[i] != col[i - 1]]
    ends = [*starts[1:], n]
    for s, e in zip(starts, ends, strict=True):
        for k in range(s, e, MAX_ROW_GROUP_ROWS):
            bounds.append((k, min(k + MAX_ROW_GROUP_ROWS, e)))
    return bounds


def parquet_bytes(table: pa.Table, *, group_by: str | None = None) -> bytes:
    """Parquet with fixed settings (spec section 6): format 2.6 / data page v2, zstd, dictionary
    encoding and statistics on, one row group per ``group_by`` value (at most 50,000 rows), no
    key-value metadata beyond the Arrow schema. The caller sorts the table. The ``created_by``
    string is pyarrow's own (fixed per pinned version; it cannot be set through pyarrow)."""
    table = table.replace_schema_metadata(None)
    out = pa.BufferOutputStream()
    with pq.ParquetWriter(
        out,
        table.schema,
        version="2.6",
        data_page_version="2.0",
        compression=PARQUET_COMPRESSION,
        compression_level=PARQUET_COMPRESSION_LEVEL,
        use_dictionary=True,
        write_statistics=True,
    ) as writer:
        for start, stop in _row_group_slices(table, group_by):
            writer.write_table(table.slice(start, stop - start), row_group_size=MAX_ROW_GROUP_ROWS)
    return bytes(out.getvalue().to_pybytes())


class ExportSink:
    """Collects the files of the data tree in memory (relative POSIX paths under ``data/``)."""

    def __init__(self) -> None:
        self._files: dict[str, FileEntry] = {}

    def _add(self, entry: FileEntry) -> FileEntry:
        p = PurePosixPath(entry.path)
        if p.is_absolute() or ".." in p.parts or not entry.path or entry.path == "manifest.json":
            raise ExportError(f"invalid export path {entry.path!r}")
        if entry.path in self._files:
            raise ExportError(f"duplicate export path {entry.path!r}")
        self._files[entry.path] = entry
        return entry

    def add_json(
        self, path: str, obj: Any, *, schema: str | None = None, rows: int | None = None
    ) -> FileEntry:
        """Add a JSON file; ``schema`` names a file in ``publish/schemas`` (EXP-01)."""
        if schema is not None:
            mf.validate_json(obj, schema)
        return self._add(FileEntry(path, "json", json_bytes(obj), rows))

    def add_parquet(self, path: str, table: pa.Table, *, group_by: str | None = None) -> FileEntry:
        return self._add(
            FileEntry(path, "parquet", parquet_bytes(table, group_by=group_by), table.num_rows)
        )

    @property
    def files(self) -> list[FileEntry]:
        return sorted(self._files.values(), key=lambda f: f.path)


# --------------------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------------------


class ExportSession:
    """The single read-only database session of an export run. Counts the text size of every
    value returned (``bytes_read``: an approximation of the data volume, not wire bytes)."""

    def __init__(self, conn: psycopg.Connection[Any]) -> None:
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        conn.read_only = True
        self.conn = conn
        self.bytes_read = 0
        self.queries = 0

    def fetch(self, query: str, params: Sequence[Any] | None = None) -> list[tuple[Any, ...]]:
        rows = self.conn.execute(query, params).fetchall()
        self.queries += 1
        self.bytes_read += sum(len(str(v).encode()) for row in rows for v in row)
        return list(rows)


def select_run(session: ExportSession, ingest_run_id: int) -> RunInfo:
    """ADR-012 decision 3 / EXP-10: greatest ``analysis_run_id`` of the supplied ingest run."""
    rows = session.fetch(RUN_SELECT, [ingest_run_id])
    if not rows:
        raise ExportError(
            f"EXP-10: no analysis run for ingest run {ingest_run_id} in analytics.v_run_published",
            check="EXP-10",
        )
    row = rows[0]
    run = RunInfo(*row)
    if run.ingest_run_id != ingest_run_id:  # defensive: the WHERE clause guarantees equality
        raise ExportError("EXP-10: selected run belongs to another ingest run", check="EXP-10")
    return run


Producer = Callable[[ExportSession, RunInfo, ExportSink], None]


@dataclass(frozen=True)
class Finding:
    """One check result: ``severity`` is ``fail`` (export fails) or ``warn``."""

    check: str
    severity: str
    message: str

    def text(self) -> str:
        return f"{self.check}: {self.message}"


@dataclass
class CheckReport:
    findings: list[Finding] = field(default_factory=list)
    results: dict[str, str] = field(default_factory=dict)  # check id -> pass | warn | fail
    detail: dict[str, Any] = field(default_factory=dict)  # sizes and budgets for export-status

    @property
    def failures(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "fail"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warn"]


Checker = Callable[[ExportSession, RunInfo, Sequence["FileEntry"]], CheckReport]


# --------------------------------------------------------------------------------------
# Run
# --------------------------------------------------------------------------------------


@dataclass
class ExportResult:
    status: str
    run: RunInfo | None
    manifest: dict[str, Any] | None
    export_status: dict[str, Any]
    files: list[FileEntry] = field(default_factory=list)


def _status_doc(
    *,
    status: str,
    ingest_run_id: int,
    run: RunInfo | None,
    duration_ms: int,
    session: ExportSession | None,
    files: list[FileEntry],
    failures: list[str],
    warnings: list[str],
    report: CheckReport | None = None,
) -> dict[str, Any]:
    n_json = sum(1 for f in files if f.format == "json")
    return {
        "schema_version": STATUS_SCHEMA_VERSION,
        "status": status,
        "ingest_run_id": ingest_run_id,
        "analysis_run_id": run.analysis_run_id if run else None,
        "duration_ms": duration_ms,
        "bytes_read": session.bytes_read if session else 0,
        "sessions": 1 if session else 0,
        "file_counts": {"json": n_json, "parquet": len(files) - n_json, "total": len(files)},
        "detail": {
            "bytes_written": sum(len(f.data) for f in files),
            "failures": failures,
            "warnings": warnings,
            "queries": session.queries if session else 0,
            **({"checks": report.results, **report.detail} if report else {}),
        },
    }


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def run_export(
    conn: psycopg.Connection[Any],
    ingest_run_id: int,
    out_root: Path,
    producers: Sequence[Producer] = (),
    *,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    checker: Checker | None = None,
    verify_determinism: bool = False,
) -> ExportResult:
    """Export into ``out_root/data`` (and ``out_root/export-status.json``) on one session.

    ``conn`` must be a ``mm_reader`` connection; it is used read-only and never committed. On
    failure ``export-status.json`` (status ``failed``) is written, ``out_root/data`` is removed,
    and the error is re-raised. Same inputs and the same ``now()`` give identical files (EXP-08).
    ``checker`` (``publish.checks.standard_checker``) runs after the producers; a failed finding
    fails the export. ``verify_determinism`` runs every producer a second time on the same
    snapshot (REPEATABLE READ) and fails EXP-08 if any file differs; its reads are not counted in
    ``bytes_read``.
    """
    started = time.monotonic()
    generated_at = now()
    session = ExportSession(conn)
    run: RunInfo | None = None
    sink = ExportSink()
    report: CheckReport | None = None

    def elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        run = select_run(session, ingest_run_id)
        for produce in producers:
            produce(session, run, sink)
        files = sink.files
        if checker is not None:
            report = checker(session, run, files)
            if report.failures:
                raise ExportError(
                    "; ".join(f.text() for f in report.failures),
                    check=report.failures[0].check,
                    failures=[f.text() for f in report.failures],
                )
        if verify_determinism:
            counted = session.bytes_read
            again = ExportSink()
            for produce in producers:
                produce(session, run, again)
            session.bytes_read = counted
            first = {f.path: f.sha256 for f in files}
            second = {f.path: f.sha256 for f in again.files}
            diff = sorted(p for p in first.keys() | second.keys() if first.get(p) != second.get(p))
            if diff:
                raise ExportError(
                    f"files differ between two exports of the same run: {', '.join(diff[:5])}",
                    check="EXP-08",
                )
            if report is not None:
                report.results["EXP-08"] = "pass"
        manifest = mf.build_manifest(run, files, generated_at=generated_at)
        mf.validate_json(manifest, "manifest")
        problems = mf.verify_files(manifest, files)
        if problems:
            raise ExportError("; ".join(problems), check="EXP-06")
        manifest_entry = FileEntry("manifest.json", "json", json_bytes(manifest))
        conn.rollback()  # read-only transaction ends; nothing to commit
    except Exception as exc:
        conn.rollback()
        doc = _status_doc(
            status="failed", ingest_run_id=ingest_run_id, run=run, duration_ms=elapsed_ms(),
            session=session, files=[], report=report, warnings=[],
            failures=getattr(exc, "failures", None) or [f"{getattr(exc, 'check', 'ERROR')}: {exc}"],
        )  # fmt: skip
        data_dir = out_root / "data"
        if data_dir.is_dir():
            shutil.rmtree(data_dir)
        _write(out_root / "export-status.json", json_bytes(doc))
        raise

    data_dir = out_root / "data"
    if data_dir.is_dir():
        shutil.rmtree(data_dir)
    for f in [*files, manifest_entry]:
        _write(data_dir / f.path, f.data)
    doc = _status_doc(
        status="ok", ingest_run_id=ingest_run_id, run=run, duration_ms=elapsed_ms(),
        session=session, files=[*files, manifest_entry], failures=[], report=report,
        warnings=[f.text() for f in report.warnings] if report else [],
    )  # fmt: skip
    mf.validate_json(doc, "export-status")
    _write(out_root / "export-status.json", json_bytes(doc))
    return ExportResult("ok", run, manifest, doc, [*files, manifest_entry])
