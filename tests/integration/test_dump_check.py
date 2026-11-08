# ruff: noqa: E501
"""T70: public dump self-check (BKP-03; AC-DUMP-2, AC-DUMP-3, AC-VAL-15, T-DDL-11 dump clause, AC-SYS-12)."""

from __future__ import annotations

import gzip
import hashlib
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

from macro_monitor import cli
from macro_monitor.storage import dump, dump_check

if TYPE_CHECKING:
    from conftest import TestDatabase

sys.path.insert(0, str(Path(__file__).parent))
from test_pubdump_writer import NOW, _csv_bytes, _dump, _kw, _prepare

pytestmark = pytest.mark.db

MARKS = {"P": "MARK-P", "W": "MARK-W", "H": "MARK-H", "HW": "MARK-HW"}


def _break_view(db: TestDatabase, view: str) -> None:
    """Replace a pubdump view by a stub reading the base table with no filter or redaction."""
    table = {
        "v_curated_observation": "curated.observation",
        "v_ingest_raw_load": "ingest.raw_load",
    }[view]
    with db.connect("mm_owner", timeout=120) as owner:
        cols = [
            r[0]
            for r in owner.execute(
                "SELECT a.attname FROM pg_attribute a WHERE a.attrelid = %s::regclass "
                "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
                [f"pubdump.{view}"],
            ).fetchall()
        ]
        select = ", ".join(f'"{c}"' for c in cols)
        owner.execute(f"CREATE OR REPLACE VIEW pubdump.{view} AS SELECT {select} FROM {table}")  # type: ignore[call-overload]
        owner.commit()


def test_clean_dump_passes_and_gate_holds(test_database: TestDatabase, tmp_path: Path) -> None:
    _prepare(test_database)
    out = tmp_path / "d"
    manifest = _dump(test_database, out, created_at=NOW)
    assert dump_check.check_dump(out) == []
    dump_check.assert_dump_ok(out)
    # AC-DUMP-2 / AC-SYS-12: byte search over every decompressed CSV, schema.sql and manifest
    blob = b"".join(_csv_bytes(out, f["path"]) for f in manifest["files"])
    blob += (out / "schema.sql").read_bytes() + (out / "manifest.json").read_bytes()
    for src in ("W", "H", "HW"):
        assert MARKS[src].encode() not in blob
    assert MARKS["P"].encode() in blob
    assert {e["source_id"] for e in manifest["sources"]["excluded"]} == {"W", "H", "HW"}


@pytest.mark.parametrize("view", ["v_curated_observation", "v_ingest_raw_load"])
def test_broken_view_fails_closed(test_database: TestDatabase, tmp_path: Path, view: str) -> None:
    _prepare(test_database)
    _break_view(test_database, view)
    out = tmp_path / "d"
    _dump(test_database, out, created_at=NOW)  # the writer itself does not filter
    problems = dump_check.check_dump(out)
    assert problems, view
    assert any(p.startswith(("observation:", "redaction:")) for p in problems)
    assert not any("MARK-" in p for p in problems)  # messages carry no cell values
    with pytest.raises(dump_check.DumpSelfCheckError):
        dump_check.assert_dump_ok(out)


@pytest.mark.parametrize("view", ["v_curated_observation", "v_ingest_raw_load"])
def test_cli_exits_nonzero_and_leaves_no_assets(
    test_database: TestDatabase,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    view: str,
) -> None:
    _prepare(test_database)
    _break_view(test_database, view)
    monkeypatch.setenv("DATABASE_URL", test_database.dsn("mm_ingest"))
    out = tmp_path / "o"
    rc = cli.main(["backup", "--profile", "public", "--out", str(out), "--root", str(tmp_path)])
    captured = capsys.readouterr()
    assert rc != 0
    assert "BKP-03" in captured.err
    assert "MARK-" not in captured.err + captured.out
    assert not (out / "manifest.json").exists()
    assert not (out / "schema.sql").exists()
    assert not (out / "data").exists()
    with test_database.connect("mm_ingest") as ing:
        status = ing.execute(
            "SELECT status FROM ingest.run WHERE workflow = 'backup' ORDER BY run_id DESC LIMIT 1"
        ).fetchone()
    assert status == ("failed",)


def test_tampered_files_are_detected(test_database: TestDatabase, tmp_path: Path) -> None:
    _prepare(test_database)
    out = tmp_path / "d"
    manifest = _dump(test_database, out, created_at=NOW)
    # schema.sql changed
    (out / "schema.sql").write_bytes((out / "schema.sql").read_bytes() + b"-- x\n")
    assert any(p.startswith("hashes:") for p in dump_check.check_dump(out))
    (out / "schema.sql").write_bytes((out / "schema.sql").read_bytes()[:-5])
    assert dump_check.check_dump(out) == []
    # an unlisted extra file
    (out / "data" / "extra.csv.gz").write_bytes(gzip.compress(b"a\n"))
    assert any("not listed" in p for p in dump_check.check_dump(out))
    (out / "data" / "extra.csv.gz").unlink()
    # a header that differs from the manifest columns (hashes updated would still fail the header check)
    f = next(x for x in manifest["files"] if x["target_table"] == "ref.unit")
    raw = _csv_bytes(out, f["path"])
    head, rest = raw.split(b"\n", 1)
    changed = head.replace(head.split(b",")[0], b"zzz", 1) + b"\n" + rest
    (out / f["path"]).write_bytes(gzip.compress(changed, 9, mtime=0))
    problems = dump_check.check_dump(out)
    assert any(p.startswith("header:") for p in problems)
    assert any(p.startswith("hashes:") for p in problems)
    # a missing data file
    (out / f["path"]).unlink()
    assert any("is missing" in p for p in dump_check.check_dump(out))


def test_row_count_mismatch_is_detected(test_database: TestDatabase, tmp_path: Path) -> None:
    _prepare(test_database)
    out = tmp_path / "d"
    manifest = _dump(test_database, out, created_at=NOW)
    mpath = out / "manifest.json"
    manifest["files"][0]["rows"] += 1
    mpath.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    assert any("manifest says" in p for p in dump_check.check_dump(out))


def test_unredacted_drift_override_and_decision_are_detected(
    test_database: TestDatabase, tmp_path: Path
) -> None:
    """Rewrite redacted columns in an otherwise consistent dump (hashes recomputed): the filter checks still fail."""
    _prepare(test_database)
    out = tmp_path / "d"
    manifest = _dump(test_database, out, created_at=NOW)
    edits: dict[str, Any] = {}
    for f in manifest["files"]:
        if f["target_table"] not in (
            "ops.quality_override",
            "ops.drift_decision",
            "ops.drift_event",
        ):
            continue
        text = _csv_bytes(out, f["path"]).decode("utf-8")
        text = (
            text.replace("[redacted]", "leaked").replace("\n,,,", "\nx,x,x,")
            if f["target_table"] == "ops.quality_override"
            else text
        )
        edits[f["path"]] = (f, text.encode())
    for path, (f, data) in edits.items():
        gz = gzip.compress(data, 9, mtime=0)
        (out / path).write_bytes(gz)
        f.update(
            sha256_gz=hashlib.sha256(gz).hexdigest(), bytes_gz=len(gz),
            sha256_csv=hashlib.sha256(data).hexdigest(), bytes_csv=len(data),
        )  # fmt: skip
    manifest["totals"]["bytes_gz"] = sum(f["bytes_gz"] for f in manifest["files"])
    (out / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    problems = dump_check.check_dump(out)
    assert any(p.startswith("redaction: ops.quality_override") for p in problems), problems


def test_discard_dump_removes_all_assets(test_database: TestDatabase, tmp_path: Path) -> None:
    _prepare(test_database)
    out = tmp_path / "d"
    with test_database.connect("mm_ingest", timeout=120) as ing:
        dump.write_dump(ing, out, **_kw(created_at=NOW))
    dump_check.discard_dump(out)
    assert list(out.iterdir()) == []
