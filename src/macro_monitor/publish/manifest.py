"""``manifest.json`` of the dashboard export (export spec section 3, ADR-012).

Pure functions: the run row comes from ``analytics.v_run_published`` and ``generated_at`` is the
only wall-clock value; nothing else here reads a clock or the database.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1.0"
HISTORY_START = "1991-01-01"
SCHEMA_DIR = Path(__file__).parent / "schemas"


@dataclass(frozen=True)
class RunInfo:
    """One row of ``analytics.v_run_published`` (the eight columns ADR-012 exposes)."""

    analysis_run_id: int
    ingest_run_id: int
    as_of_run_date: Any
    known_cutoff: datetime
    load_cutoff: datetime
    code_version: str
    git_sha: str
    config_sha256: str


@dataclass(frozen=True)
class FileEntry:
    path: str  # relative to the site root data/
    format: str  # json | parquet
    data: bytes
    rows: int | None = None

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


def utc_text(ts: datetime, *, fractional: bool = False) -> str:
    """``2026-11-01T04:23:41Z``; microseconds appear only when ``fractional`` and non-zero."""
    u = ts.astimezone(UTC)
    if fractional and u.microsecond:
        return u.strftime("%Y-%m-%dT%H:%M:%S.%f").rstrip("0") + "Z"
    return u.strftime("%Y-%m-%dT%H:%M:%SZ")


def build_id(generated_at: datetime, ingest_run_id: int) -> str:
    return f"{generated_at.astimezone(UTC):%Y-%m-%dT%H:%MZ}-r{ingest_run_id}"


def build_manifest(
    run: RunInfo, files: Iterable[FileEntry], *, generated_at: datetime
) -> dict[str, Any]:
    """Manifest dict. ``ingest_run_id`` is the run's (equal to the supplied value, EXP-10);
    ``analysis_run_id``, ``known_cutoff`` and ``code_version`` are copied from ``run``.
    ``manifest.json`` does not list itself (it cannot carry its own hash)."""
    entries = sorted(files, key=lambda f: f.path)
    listed = [
        {
            "path": f.path,
            "format": f.format,
            "bytes": len(f.data),
            "rows": f.rows,
            "sha256": f.sha256,
        }
        for f in entries
    ]
    return {
        "schema_version": SCHEMA_VERSION,
        "build_id": build_id(generated_at, run.ingest_run_id),
        "generated_at": utc_text(generated_at),
        "ingest_run_id": run.ingest_run_id,
        "analysis_run_id": run.analysis_run_id,
        "known_cutoff": utc_text(run.known_cutoff, fractional=True),
        "code_version": run.code_version,
        "history_start": HISTORY_START,
        "files": listed,
        "totals": {"bytes": sum(len(f.data) for f in entries), "files": len(entries)},
    }


def load_schema(name: str) -> Mapping[str, Any]:
    """Schema ``<name>.schema.json`` from the ``schemas`` directory."""
    loaded: Mapping[str, Any] = json.loads(
        (SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8")
    )
    return loaded


def validate_json(obj: Any, schema_name: str) -> None:
    """Raise ``jsonschema.ValidationError`` when ``obj`` does not match the named schema."""
    import jsonschema

    schema = load_schema(schema_name)
    jsonschema.Draft202012Validator.check_schema(schema)
    jsonschema.Draft202012Validator(schema).validate(obj)


def verify_files(manifest: Mapping[str, Any], files: Iterable[FileEntry]) -> list[str]:
    """Manifest invariant: every file appears with matching bytes and sha256 and nothing else."""
    by_path = {f.path: f for f in files}
    problems: list[str] = []
    listed = {e["path"]: e for e in manifest["files"]}
    for path in sorted(set(by_path) - set(listed)):
        problems.append(f"{path}: not listed in manifest")
    for path in sorted(set(listed) - set(by_path)):
        problems.append(f"{path}: listed but not written")
    for path in sorted(set(listed) & set(by_path)):
        f, e = by_path[path], listed[path]
        if e["bytes"] != len(f.data) or e["sha256"] != f.sha256:
            problems.append(f"{path}: bytes or sha256 differ from manifest")
    return problems
