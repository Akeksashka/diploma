"""Output self-check of the public dump (BKP-03; dump spec section 5; plan T70).

Re-reads the written files only (never the database) and fails closed: any problem makes
``assert_dump_ok`` raise ``DumpSelfCheckError``; the backup step then discards the output so
no release asset set exists. This is the main licence gate of the dump (R34).

Problem messages carry file names, row numbers and ids only, never cell values, so a leak
is not repeated into logs or issues.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import shutil
from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from macro_monitor.storage.dump import DumpError, validate_manifest

MAX_PROBLEMS_PER_CHECK = 20
_CHUNK = 1 << 20
_REDACTED = "[redacted]"


class DumpSelfCheckError(DumpError):
    """The dump output violates the manifest or the licence filter; nothing may be released."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        shown = "; ".join(problems[:10])
        more = f" (+{len(problems) - 10} more)" if len(problems) > 10 else ""
        super().__init__(f"dump self-check failed (BKP-03): {shown}{more}")


class _Problems:
    def __init__(self) -> None:
        self.items: list[str] = []
        self._count: dict[str, int] = defaultdict(int)

    def add(self, check: str, message: str) -> None:
        self._count[check] += 1
        if self._count[check] <= MAX_PROBLEMS_PER_CHECK:
            self.items.append(f"{check}: {message}")
        elif self._count[check] == MAX_PROBLEMS_PER_CHECK + 1:
            self.items.append(f"{check}: further problems suppressed")


def _hash_stream(path: Path) -> tuple[str, int]:
    sha = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        while block := fh.read(_CHUNK):
            sha.update(block)
            size += len(block)
    return sha.hexdigest(), size


def _hash_decompressed(path: Path) -> tuple[str, int]:
    sha = hashlib.sha256()
    size = 0
    with gzip.open(path, "rb") as fh:
        while block := fh.read(_CHUNK):
            sha.update(block)
            size += len(block)
    return sha.hexdigest(), size


def _read_csv(path: Path) -> Iterator[list[str]]:
    with (
        gzip.open(path, "rb") as raw,
        io.TextIOWrapper(raw, encoding="utf-8", newline="") as text,
    ):
        yield from csv.reader(text)


def _table_rows(
    out_dir: Path, files: list[dict[str, Any]], target: str
) -> Iterator[dict[str, str]]:
    """Rows of every part of one target table, in part order, as column -> text."""
    parts = sorted((f for f in files if f["target_table"] == target), key=lambda f: f["part"] or 0)
    for f in parts:
        reader = _read_csv(out_dir / f["path"])
        header = next(reader, None)
        if header is None:
            continue
        for row in reader:
            yield dict(zip(header, row, strict=False))


def check_dump(out_dir: Path) -> list[str]:
    """Return the list of problems found in the written dump (empty when it is clean)."""
    problems = _Problems()
    manifest_path = out_dir / "manifest.json"
    if not manifest_path.is_file():
        return ["manifest: manifest.json is missing"]
    try:
        manifest: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError):
        return ["manifest: manifest.json is not valid JSON"]
    try:
        validate_manifest(manifest)
    except Exception as exc:  # jsonschema.ValidationError and friends
        return [f"manifest: does not match the manifest schema ({type(exc).__name__})"]
    files: list[dict[str, Any]] = manifest["files"]

    # 1. hashes, sizes and row counts equal the manifest; 4. headers equal columns
    schema_path = out_dir / "schema.sql"
    if not schema_path.is_file():
        problems.add("hashes", "schema.sql is missing")
    else:
        sha, size = _hash_stream(schema_path)
        if sha != manifest["schema"]["sha256"] or size != manifest["schema"]["bytes"]:
            problems.add("hashes", "schema.sql differs from the manifest")
    listed = {f["path"] for f in files}
    data_dir = out_dir / "data"
    on_disk = (
        {p.relative_to(out_dir).as_posix() for p in data_dir.rglob("*") if p.is_file()}
        if data_dir.is_dir()
        else set()
    )
    for extra in sorted(on_disk - listed):
        problems.add("hashes", f"{extra} is not listed in the manifest")
    targets = {f["target_table"] for f in files}
    if not targets <= set(manifest["load_order"]):
        problems.add("manifest", "load_order does not cover every target table")
    totals = manifest["totals"]
    if (
        totals["files"] != len(files)
        or totals["rows"] != sum(f["rows"] for f in files)
        or totals["bytes_gz"] != sum(f["bytes_gz"] for f in files)
    ):
        problems.add("manifest", "totals differ from the file list")

    for f in files:
        path = out_dir / f["path"]
        if not path.is_file():
            problems.add("hashes", f"{f['path']} is missing")
            continue
        sha_gz, size_gz = _hash_stream(path)
        if sha_gz != f["sha256_gz"] or size_gz != f["bytes_gz"]:
            problems.add("hashes", f"{f['path']} gzip hash or size differs from the manifest")
        try:
            sha_csv, size_csv = _hash_decompressed(path)
            if sha_csv != f["sha256_csv"] or size_csv != f["bytes_csv"]:
                problems.add("hashes", f"{f['path']} CSV hash or size differs from the manifest")
            reader = _read_csv(path)
            header = next(reader, None)
            if header != f["columns"]:
                problems.add("header", f"{f['path']} header differs from the manifest columns")
            rows = sum(1 for _ in reader)
        except (OSError, EOFError, UnicodeDecodeError, csv.Error):
            problems.add("hashes", f"{f['path']} cannot be decompressed or parsed")
            continue
        if rows != f["rows"]:
            problems.add("hashes", f"{f['path']} has {rows} rows, manifest says {f['rows']}")

    # the licence filter reads the ref files of this same dump
    needed = {"ref.source", "ref.series"}
    if not needed <= targets:
        problems.add("filter", "ref.source or ref.series file is missing from the dump")
        return problems.items
    try:
        _licence_checks(out_dir, files, targets, manifest, problems)
    except (OSError, EOFError, UnicodeDecodeError, csv.Error, KeyError):
        problems.add("filter", "a dump file could not be read for the licence checks")
    return problems.items


def _licence_checks(
    out_dir: Path,
    files: list[dict[str, Any]],
    targets: set[str],
    manifest: dict[str, Any],
    problems: _Problems,
) -> None:
    public_sources: set[str] = set()
    restricted_sources: set[str] = set()
    for row in _table_rows(out_dir, files, "ref.source"):
        if row["archive_mode"] == "public" and row["publish_site"] == "public":
            public_sources.add(row["source_id"])
        else:
            restricted_sources.add(row["source_id"])
    declared = manifest["sources"]
    if (
        set(declared["included"]) != public_sources
        or {e["source_id"] for e in declared["excluded"]} != restricted_sources
    ):
        problems.add("filter", "manifest sources differ from the ref.source file")
    series_source = {
        row["series_id"]: row["source_id"] for row in _table_rows(out_dir, files, "ref.series")
    }

    # 2. every observation belongs to a P-public source
    if "curated.observation" in targets:
        for n, row in enumerate(_table_rows(out_dir, files, "curated.observation"), start=1):
            if series_source.get(row["series_id"]) not in public_sources:
                problems.add(
                    "observation", f"row {n} belongs to a source outside P-public (series_id)"
                )

    # 3. redactions for rows of non-P-public sources
    raw_source: dict[str, str] = {}
    for row in _table_rows(out_dir, files, "ingest.raw_object"):
        raw_source[row["raw_id"]] = row["source_id"]
    if "ingest.raw_load" in targets:
        for n, row in enumerate(_table_rows(out_dir, files, "ingest.raw_load"), start=1):
            source = raw_source.get(row["raw_id"])
            if source in public_sources:
                continue
            if _json_or_none(row["detail"]) != {}:
                problems.add("redaction", f"ingest.raw_load row {n}: detail is not {{}}")
    event_source: dict[str, str] = {}
    if "ops.drift_event" in targets:
        for n, row in enumerate(_table_rows(out_dir, files, "ops.drift_event"), start=1):
            event_source[row["event_id"]] = row["source_id"]
            if row["source_id"] in public_sources:
                continue
            if row["old"] != "" or row["new"] != "" or row["note"] != "":
                problems.add("redaction", f"ops.drift_event row {n}: old/new/note are not empty")
    if "ops.drift_decision" in targets:
        for n, row in enumerate(_table_rows(out_dir, files, "ops.drift_decision"), start=1):
            if event_source.get(row["event_id"]) in public_sources:
                continue
            if row["note"] != "":
                problems.add("redaction", f"ops.drift_decision row {n}: note is not empty")
    if "ops.quality_override" in targets:
        for n, row in enumerate(_table_rows(out_dir, files, "ops.quality_override"), start=1):
            if series_source.get(row["series_id"]) in public_sources:
                continue
            if row["reason"] != _REDACTED:
                problems.add(
                    "redaction", f"ops.quality_override row {n}: reason is not {_REDACTED}"
                )


def _json_or_none(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return text


def discard_dump(out_dir: Path) -> None:
    """Remove every release asset from ``out_dir`` (fail closed: nothing may be published)."""
    shutil.rmtree(out_dir / "data", ignore_errors=True)
    for name in ("manifest.json", "schema.sql"):
        (out_dir / name).unlink(missing_ok=True)


def assert_dump_ok(out_dir: Path) -> None:
    """Run the self-check; raise ``DumpSelfCheckError`` (output stays for inspection) on failure."""
    problems = check_dump(out_dir)
    if problems:
        raise DumpSelfCheckError(problems)
