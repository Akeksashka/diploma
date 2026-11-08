# ruff: noqa: E501, PT011, PT018
"""T82 unit tests: deterministic writers, manifest, schemas, run flow with a stub session."""

from __future__ import annotations

import hashlib
import io
import json
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import jsonschema
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from macro_monitor.publish import export as ex
from macro_monitor.publish import manifest as mf

CUTOFF = datetime(2026, 11, 1, 4, 23, 41, tzinfo=UTC)
GEN = datetime(2026, 11, 1, 6, 5, 0, tzinfo=UTC)


def run_info(analysis: int = 6, ingest: int = 10) -> mf.RunInfo:
    return mf.RunInfo(analysis, ingest, date(2026, 10, 1), CUTOFF, CUTOFF, "v1", "g" * 7, "c")


def table(n_entities: int = 3, per: int = 4) -> pa.Table:
    ents, starts, vals = [], [], []
    for e in range(n_entities):
        for i in range(per):
            ents.append(f"E{e}")
            starts.append(date(2020, 1 + i, 1))
            vals.append(None if i == 1 else e + i / 10)
    return pa.table(
        {
            "entity_id": pa.array(ents, pa.string()),
            "ref_period_start": pa.array(starts, pa.date32()),
            "value": pa.array(vals, pa.float64()),
        }
    )


def test_json_bytes_sorted_keys_and_stable() -> None:
    a = ex.json_bytes({"b": 1, "a": {"z": 1, "y": [2, 1]}})
    assert a == ex.json_bytes({"a": {"y": [2, 1], "z": 1}, "b": 1})
    assert list(json.loads(a)) == ["a", "b"] and a.endswith(b"\n")
    assert "é".encode() in ex.json_bytes({"k": "é"})


@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_json_bytes_rejects_non_finite(bad: float) -> None:
    with pytest.raises(ValueError):
        ex.json_bytes({"v": bad})


def test_json_bytes_rejects_non_json_types() -> None:
    with pytest.raises(TypeError):
        ex.json_bytes({"v": datetime(2026, 1, 1, tzinfo=UTC)})


def test_sorted_by_id() -> None:
    assert [r["id"] for r in ex.sorted_by_id([{"id": "b"}, {"id": "a"}])] == ["a", "b"]


def test_parquet_deterministic_and_settings() -> None:
    t = table()
    a, b = ex.parquet_bytes(t, group_by="entity_id"), ex.parquet_bytes(t, group_by="entity_id")
    assert a == b
    pf = pq.ParquetFile(io.BytesIO(a))
    md = pf.metadata
    assert md.num_row_groups == 3  # one row group per entity
    assert md.format_version == "2.6"
    rg = md.row_group(0)
    col = rg.column(2)
    assert col.compression == "ZSTD" and col.is_stats_set
    assert pf.read().equals(t)
    kv = md.metadata or {}
    assert set(kv) <= {b"ARROW:schema"}  # no pandas metadata, no timestamps


def test_parquet_row_group_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ex, "MAX_ROW_GROUP_ROWS", 5)
    data = ex.parquet_bytes(table(2, 6), group_by="entity_id")
    md = pq.ParquetFile(io.BytesIO(data)).metadata
    assert [md.row_group(i).num_rows for i in range(md.num_row_groups)] == [5, 1, 5, 1]


def test_parquet_ignores_input_schema_metadata() -> None:
    t = table()
    assert ex.parquet_bytes(t) == ex.parquet_bytes(t.replace_schema_metadata({"k": "v"}))


def test_parquet_empty_table() -> None:
    assert pq.read_table(io.BytesIO(ex.parquet_bytes(table(0)))).num_rows == 0


def test_sink_rejects_bad_and_duplicate_paths() -> None:
    s = ex.ExportSink()
    s.add_json("meta/a.json", {"a": 1})
    for bad in ("meta/a.json", "../x.json", "/abs.json", "manifest.json"):
        with pytest.raises(ex.ExportError):
            s.add_json(bad, {})
    assert [f.path for f in s.files] == ["meta/a.json"]


def test_sink_validates_against_named_schema() -> None:
    s = ex.ExportSink()
    with pytest.raises(jsonschema.ValidationError):
        s.add_json("x.json", {"nope": 1}, schema="manifest")


def test_manifest_content_and_schema() -> None:
    s = ex.ExportSink()
    s.add_parquet("series/M01.parquet", table(), group_by="entity_id")
    s.add_json("meta/entities.json", [{"id": "A"}])
    m = mf.build_manifest(run_info(), s.files, generated_at=GEN)
    mf.validate_json(m, "manifest")
    assert [f["path"] for f in m["files"]] == ["meta/entities.json", "series/M01.parquet"]
    assert m["analysis_run_id"] == 6 and m["ingest_run_id"] == 10
    assert m["known_cutoff"] == "2026-11-01T04:23:41Z" and m["code_version"] == "v1"
    assert m["build_id"] == "2026-11-01T06:05Z-r10" and m["generated_at"] == "2026-11-01T06:05:00Z"
    assert m["totals"] == {"bytes": sum(f["bytes"] for f in m["files"]), "files": 2}
    f0 = s.files[0]
    assert m["files"][0]["sha256"] == hashlib.sha256(f0.data).hexdigest()
    assert m["files"][1]["rows"] == 12
    assert mf.verify_files(m, s.files) == []


def test_manifest_verify_detects_problems() -> None:
    s = ex.ExportSink()
    s.add_json("a.json", {"a": 1})
    m = mf.build_manifest(run_info(), s.files, generated_at=GEN)
    other = ex.ExportSink()
    other.add_json("a.json", {"a": 2})
    other.add_json("b.json", {})
    assert len(mf.verify_files(m, other.files)) == 2


def test_known_cutoff_keeps_microseconds() -> None:
    assert mf.utc_text(CUTOFF.replace(microsecond=120000), fractional=True).endswith(":41.12Z")


def test_status_schema_rejects_unknown_status() -> None:
    doc = {
        "schema_version": "1.0", "status": "weird", "ingest_run_id": 1, "analysis_run_id": None,
        "duration_ms": 0, "bytes_read": 0, "sessions": 0,
        "file_counts": {"json": 0, "parquet": 0, "total": 0},
        "detail": {"bytes_written": 0, "failures": [], "warnings": []},
    }  # fmt: skip
    with pytest.raises(jsonschema.ValidationError):
        mf.validate_json(doc, "export-status")
    doc["status"] = "failed"
    mf.validate_json(doc, "export-status")


# -- run flow with a stub connection --------------------------------------------------


class _Cur:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows


class StubConn:
    isolation_level: Any = None
    read_only: bool = False

    def __init__(self, runs: dict[int, tuple[Any, ...]]) -> None:
        self.runs = runs
        self.statements = 0

    def execute(self, query: str, params: Any = None) -> _Cur:
        self.statements += 1
        assert query.startswith("SELECT") and "analytics.v_run_published" in query
        r = self.runs.get(params[0])
        return _Cur([r] if r else [])

    def rollback(self) -> None:
        pass


def stub(analysis: int = 6, ingest: int = 10) -> StubConn:
    r = run_info(analysis, ingest)
    return StubConn({ingest: (r.analysis_run_id, r.ingest_run_id, r.as_of_run_date, r.known_cutoff,
                              r.load_cutoff, r.code_version, r.git_sha, r.config_sha256)})  # fmt: skip


def producer(session: ex.ExportSession, run: mf.RunInfo, sink: ex.ExportSink) -> None:
    sink.add_json("meta/run.json", {"analysis_run_id": run.analysis_run_id, "b": 1, "a": 2})
    sink.add_parquet("series/M01.parquet", table(), group_by="entity_id")


def tree(root: Path) -> dict[str, bytes]:
    return {
        str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()
    }


def test_run_export_single_session_and_status(tmp_path: Path) -> None:
    conn = stub()
    res = ex.run_export(conn, 10, tmp_path, [producer], now=lambda: GEN)  # type: ignore[arg-type]
    assert conn.read_only is True and conn.statements == 1
    status = json.loads((tmp_path / "export-status.json").read_text())
    mf.validate_json(status, "export-status")
    assert status["status"] == "ok" and status["sessions"] == 1
    assert status["analysis_run_id"] == 6 and status["bytes_read"] > 0
    assert status["duration_ms"] >= 0
    assert status["file_counts"] == {"json": 2, "parquet": 1, "total": 3}  # incl. manifest
    assert not (tmp_path / "data" / "export-status.json").exists()
    manifest = json.loads((tmp_path / "data" / "manifest.json").read_text())
    assert manifest == res.manifest and "manifest.json" not in [
        f["path"] for f in manifest["files"]
    ]


def test_run_export_is_deterministic(tmp_path: Path) -> None:
    ex.run_export(stub(), 10, tmp_path / "a", [producer], now=lambda: GEN)  # type: ignore[arg-type]
    ex.run_export(stub(), 10, tmp_path / "b", [producer], now=lambda: GEN)  # type: ignore[arg-type]
    ta, tb = tree(tmp_path / "a" / "data"), tree(tmp_path / "b" / "data")
    assert ta == tb and len(ta) == 3


def test_only_manifest_generated_at_varies(tmp_path: Path) -> None:
    ex.run_export(stub(), 10, tmp_path / "a", [producer], now=lambda: GEN)  # type: ignore[arg-type]
    later = datetime(2026, 11, 2, tzinfo=UTC)
    ex.run_export(stub(), 10, tmp_path / "b", [producer], now=lambda: later)  # type: ignore[arg-type]
    ta, tb = tree(tmp_path / "a" / "data"), tree(tmp_path / "b" / "data")
    assert {k for k in ta if ta[k] != tb[k]} == {"manifest.json"}


def test_exp10_failure_deploys_nothing(tmp_path: Path) -> None:
    stale = tmp_path / "data"
    stale.mkdir()
    (stale / "old.json").write_text("{}")
    with pytest.raises(ex.ExportError, match="EXP-10") as ei:
        ex.run_export(stub(), 12, tmp_path, [producer], now=lambda: GEN)  # type: ignore[arg-type]
    assert ei.value.check == "EXP-10"
    assert not (tmp_path / "data").exists()
    status = json.loads((tmp_path / "export-status.json").read_text())
    mf.validate_json(status, "export-status")
    assert status["status"] == "failed" and status["analysis_run_id"] is None
    assert status["detail"]["failures"][0].startswith("EXP-10")


def test_producer_error_marks_failed_and_writes_no_data(tmp_path: Path) -> None:
    def boom(session: ex.ExportSession, run: mf.RunInfo, sink: ex.ExportSink) -> None:
        sink.add_json("a.json", {})
        raise RuntimeError("producer failed")

    with pytest.raises(RuntimeError):
        ex.run_export(stub(), 10, tmp_path, [boom], now=lambda: GEN)  # type: ignore[arg-type]
    assert not (tmp_path / "data").exists()
    assert json.loads((tmp_path / "export-status.json").read_text())["status"] == "failed"
