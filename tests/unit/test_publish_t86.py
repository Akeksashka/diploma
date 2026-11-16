# ruff: noqa: PT018
"""T86 unit tests: secret scanner (EXP-07), budgets (EXP-06), schema check (EXP-01), failure flow
(AC-EXP-2), determinism (EXP-08), record-export input handling (AC-EXP-5), CLI wiring."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pyarrow as pa
import pytest

from macro_monitor import cli
from macro_monitor.publish import checks, record
from macro_monitor.publish import export as ex
from macro_monitor.publish import manifest as mf

CUTOFF = datetime(2026, 11, 1, 4, 23, 41, tzinfo=UTC)
GEN = datetime(2026, 11, 1, 6, 5, 0, tzinfo=UTC)
FAKE_DSN = "postgresql://user:pa55word1234@ep-x.example.neon.tech/neondb"


def run_info() -> mf.RunInfo:
    return mf.RunInfo(6, 10, date(2026, 10, 1), CUTOFF, CUTOFF, "v1", "g" * 7, "c")


def out_of(check: str = "EXP-06") -> tuple[ex.CheckReport, checks._Run]:
    report = ex.CheckReport()
    return report, checks._Run(check, report)


# -- EXP-07 -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        FAKE_DSN,
        "https://user:hunter2hunter2@host.example/x",
        "Authorization: Bearer abcdefghijklmnopqrstuvwx",
        "ghp_" + "a" * 30,
        "AKIA" + "A" * 16,
        "-----BEGIN RSA PRIVATE KEY-----",
        '"api_key": "abcdefghijkl1234"',
    ],
)
def test_scan_secrets_finds_and_never_returns_the_match(text: str) -> None:
    hits = checks.scan_secrets(text.encode())
    assert hits and all(text not in h and "pa55word" not in h for h in hits)


@pytest.mark.parametrize(
    "text",
    [
        '{"source_url": "https://example.org/public-source", "value": 1.5}',
        "password policy",
        "token",
    ],
)
def test_scan_secrets_ignores_ordinary_text(text: str) -> None:
    assert checks.scan_secrets(text.encode()) == []


def test_exp07_fails_on_json_and_on_parquet_strings() -> None:
    files = [
        mf.FileEntry("meta/a.json", "json", json.dumps({"u": FAKE_DSN}).encode()),
        mf.FileEntry("series/X.parquet", "parquet", ex.parquet_bytes(pa.table({"s": [FAKE_DSN]}))),
        mf.FileEntry("meta/b.json", "json", b"{}"),
    ]
    report, out = out_of("EXP-07")
    checks.check_exp07(files, out)
    out.done()
    assert {f.message.split(":")[0] for f in report.failures} == {"meta/a.json", "series/X.parquet"}
    assert FAKE_DSN not in "".join(f.message for f in report.findings)
    assert report.results["EXP-07"] == "fail"


# -- EXP-06 budgets -------------------------------------------------------------------------


def entry(path: str, n: int, blob: dict[int, bytes] = {}) -> mf.FileEntry:  # noqa: B006
    return mf.FileEntry(path, "json", blob.setdefault(n, b"x" * n))  # shared bytes: no 250 MB


def test_file_budget_warn_and_fail() -> None:
    report, out = out_of()
    checks.check_exp06([entry("a.json", 5_000_001), entry("b.json", 4_999_999)], report, out)
    out.done()
    assert [(f.severity, f.message.split(":")[0]) for f in report.findings] == [("warn", "a.json")]
    assert report.results["EXP-06"] == "warn"
    report, out = out_of()
    checks.check_exp06([entry("a.json", 20_000_001)], report, out)
    assert [f.severity for f in report.findings] == ["fail"]


def test_directory_and_data_budgets() -> None:
    files = [entry(f"series/{i}.json", 4_900_000) for i in range(9)]  # 44.1 MB of series
    files += [entry(f"revisions/{i}.json", 4_900_000) for i in range(5)]  # 24.5 MB
    report, out = out_of()
    checks.check_exp06(files, report, out)
    msgs = [f.message for f in report.warnings]
    assert any(m.startswith("series/* total") for m in msgs)
    assert any(m.startswith("revisions/* total") for m in msgs)
    assert not report.failures and report.detail["budgets"]["data_bytes"] == 14 * 4_900_000
    warn_only, out2 = out_of()
    checks.check_exp06([entry(f"x/{i}.json", 4_900_000) for i in range(21)], warn_only, out2)
    assert any("data/ total" in f.message for f in warn_only.warnings)  # 102.9 MB: warn
    fail, out3 = out_of()
    checks.check_exp06([entry(f"x/{i}.json", 4_900_000) for i in range(52)], fail, out3)
    assert any("data/ total" in f.message for f in fail.failures)  # 254.8 MB: fail


def test_site_budget(tmp_path: Path) -> None:
    with (tmp_path / "big.bin").open("wb") as fh:
        fh.truncate(300_000_001)  # sparse
    assert [f.severity for f in checks.site_findings(tmp_path)] == ["fail"]
    (tmp_path / "big.bin").write_bytes(b"x")
    assert checks.site_findings(tmp_path) == []


# -- EXP-01 -----------------------------------------------------------------------------------


def test_exp01_unknown_path_bad_schema_and_bad_parquet_columns() -> None:
    bad_json = mf.FileEntry("alerts.json", "json", b'{"nope": 1}')
    unknown = mf.FileEntry("zzz.json", "json", b"{}")
    parquet = mf.FileEntry("series/M01.parquet", "parquet", ex.parquet_bytes(pa.table({"a": [1]})))
    files = [bad_json, unknown, parquet]
    report, out = out_of("EXP-01")
    checks.check_exp01(
        files, {f.path: json.loads(f.data) for f in files if f.format == "json"}, out
    )
    assert len(report.failures) == 3
    assert "no JSON Schema" in report.failures[1].message


# -- run flow: failure leaves nothing (AC-EXP-2), warnings, determinism (EXP-08) ----------------


class StubConn:
    isolation_level: Any = None
    read_only: bool = False

    def execute(self, query: str, params: Any = None) -> Any:
        r = run_info()
        row = (r.analysis_run_id, r.ingest_run_id, r.as_of_run_date, r.known_cutoff, r.load_cutoff,
               r.code_version, r.git_sha, r.config_sha256)  # fmt: skip

        class Cur:
            def fetchall(self) -> list[tuple[Any, ...]]:
                return [row]

        return Cur()

    def rollback(self) -> None:
        pass


def prod(session: ex.ExportSession, run: mf.RunInfo, sink: ex.ExportSink) -> None:
    sink.add_json("meta/run.json", {"a": 1})


def test_failed_check_deploys_nothing_and_reports(tmp_path: Path) -> None:
    def checker(session: ex.ExportSession, run: mf.RunInfo, files: Any) -> ex.CheckReport:
        return ex.CheckReport(
            [ex.Finding("EXP-06", "fail", "a.json: too big"), ex.Finding("EXP-02", "fail", "PROJ")],
            {"EXP-06": "fail", "EXP-02": "fail"},
        )

    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "old.json").write_text("{}")
    with pytest.raises(ex.ExportError) as ei:
        ex.run_export(StubConn(), 10, tmp_path, [prod], now=lambda: GEN, checker=checker)  # type: ignore[arg-type]
    assert ei.value.check == "EXP-06"
    assert not (tmp_path / "data").exists()
    doc = json.loads((tmp_path / "export-status.json").read_text())
    mf.validate_json(doc, "export-status")
    assert doc["status"] == "failed"
    assert doc["detail"]["failures"] == ["EXP-06: a.json: too big", "EXP-02: PROJ"]
    assert doc["detail"]["checks"] == {"EXP-06": "fail", "EXP-02": "fail"}


def test_warnings_and_check_results_reach_export_status(tmp_path: Path) -> None:
    def checker(session: ex.ExportSession, run: mf.RunInfo, files: Any) -> ex.CheckReport:
        return ex.CheckReport(
            [ex.Finding("EXP-06", "warn", "big")],
            {"EXP-06": "warn"},
            {"budgets": {"data_bytes": 7}},
        )

    res = ex.run_export(
        StubConn(), 10, tmp_path, [prod], now=lambda: GEN, checker=checker, verify_determinism=True
    )  # type: ignore[arg-type]
    d = res.export_status
    assert d["status"] == "ok" and d["detail"]["warnings"] == ["EXP-06: big"]
    assert d["detail"]["checks"] == {"EXP-06": "warn", "EXP-08": "pass"}
    assert d["detail"]["budgets"] == {"data_bytes": 7}


def test_nondeterministic_producer_fails_exp08(tmp_path: Path) -> None:
    calls = iter(range(10))

    def flaky(session: ex.ExportSession, run: mf.RunInfo, sink: ex.ExportSink) -> None:
        sink.add_json("a.json", {"n": next(calls)})

    with pytest.raises(ex.ExportError) as ei:
        ex.run_export(StubConn(), 10, tmp_path, [flaky], now=lambda: GEN, verify_determinism=True)  # type: ignore[arg-type]
    assert ei.value.check == "EXP-08" and not (tmp_path / "data").exists()


# -- record-export input ---------------------------------------------------------------------


def good_status() -> dict[str, Any]:
    return {
        "schema_version": "1.0", "status": "ok", "ingest_run_id": 3, "analysis_run_id": 4,
        "duration_ms": 10, "bytes_read": 5, "sessions": 1,
        "file_counts": {"json": 1, "parquet": 0, "total": 1},
        "detail": {"bytes_written": 2, "failures": [], "warnings": []},
    }  # fmt: skip


def test_load_status_validates_and_scans(tmp_path: Path) -> None:
    p = tmp_path / "s.json"
    p.write_text(json.dumps(good_status()))
    assert record.load_status(p)["ingest_run_id"] == 3
    bad = good_status() | {"status": "weird"}
    p.write_text(json.dumps(bad))
    with pytest.raises(record.RecordError, match="invalid"):
        record.load_status(p)
    leaky = good_status()
    leaky["detail"]["failures"] = [f"EXP-10: could not connect to {FAKE_DSN}"]
    p.write_text(json.dumps(leaky))
    with pytest.raises(record.RecordError) as ei:
        record.load_status(p)
    assert "pa55word" not in str(ei.value)
    with pytest.raises(record.RecordError):
        record.load_status(tmp_path / "missing.json")


def test_cli_wiring(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    p = tmp_path / "s.json"
    p.write_text(json.dumps(good_status()))
    assert cli.main(["record-export", "--status-file", str(p), "--root", str(tmp_path)]) == 20
    assert (
        cli.main(
            ["export", "--ingest-run-id", "3", "--out", str(tmp_path), "--root", str(tmp_path)]
        )
        == 20
    )
    for argv in (["export"], ["record-export"]):  # required arguments are missing
        with pytest.raises(SystemExit) as ei:
            cli.main([*argv, "--root", str(tmp_path)])
        assert ei.value.code == 20
    site = tmp_path / "site"
    site.mkdir()
    (site / "a").write_bytes(b"x")
    assert cli.main(["check-site", "--site-dir", str(site), "--root", str(tmp_path)]) == 0
    assert (
        cli.main(["check-site", "--site-dir", str(tmp_path / "nope"), "--root", str(tmp_path)])
        == 20
    )


def test_cmd_export_checks_schema_version_through_the_view(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """ADR-038: export runs DB-03 against ops.v_schema_version (mm_reader cannot read the table)."""
    seen: dict[str, Any] = {}

    class Stop(Exception):
        pass

    class FakeConn:
        def __enter__(self) -> FakeConn:
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    def fake_check(conn: object, *args: object, **kwargs: object) -> int:
        seen["args"] = args
        seen["kwargs"] = kwargs
        raise Stop

    monkeypatch.setenv("DATABASE_URL", "postgresql://u@h/d")
    monkeypatch.setattr(cli, "connect", lambda dsn: FakeConn())
    monkeypatch.setattr(cli, "check_schema_version", fake_check)
    with pytest.raises(Stop):
        cli.main(
            ["export", "--ingest-run-id", "3", "--out", str(tmp_path), "--root", str(tmp_path)]
        )
    assert seen == {"args": (), "kwargs": {"relation": "ops.v_schema_version"}}
