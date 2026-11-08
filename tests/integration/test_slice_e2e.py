"""T31 / M1 exit: offline fetch -> raw -> staging -> curated -> validation, two releases, run twice.

Starts from an empty database (series rows come from first-sight creation). HTTP is a mock
transport serving the recorded synthetic Eurostat fixtures; no network. AC-SYS-2/3/4.
"""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import psycopg
import pytest

from macro_monitor import cli
from macro_monitor.ingestion import fetch
from macro_monitor.ingestion.archive import LocalDirStore
from macro_monitor.ingestion.base import GroupConfig
from macro_monitor.ingestion.connectors.sdmx import EurostatConnector, load_series_entries
from macro_monitor.ingestion.fetch import GroupJob
from macro_monitor.ingestion.http import HttpClient, HttpSettings
from macro_monitor.registry.sync import load_config

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "tests/fixtures/raw/eurostat"
R1 = (FIX / "une_rt_m_synthetic.json").read_bytes()
R2 = (FIX / "une_rt_m_synthetic_r2.json").read_bytes()
GROUP = "eurostat_labour"


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    shutil.copytree(ROOT / "config", tmp_path / "config")
    shutil.copy(ROOT / ".env.example", tmp_path / ".env.example")
    cfg = tmp_path / "config" / "sources.yaml"
    cfg.write_text(cfg.read_text().replace("enabled: false", "enabled: true", 1))
    return tmp_path


def _scalar(c: psycopg.Connection, sql: str) -> Any:
    row = c.execute(sql).fetchone()
    assert row is not None
    return row[0]


def _fetch(c: psycopg.Connection, repo: Path, raw_dir: Path, body: bytes) -> list[str]:
    cfg = load_config(repo)
    source = next(s for s in cfg.sources.data["sources"] if s["id"] == "eurostat")
    group = next(g for g in source["groups"] if g["id"] == GROUP)
    series = load_series_entries(repo / group["series_map"])
    job = GroupJob(
        source=source,
        group=GroupConfig.from_config(source, group, series),
        connector=EurostatConnector(),
        parser_id="jsonstat_v1@1",
        archive_mode="public",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, headers={"content-type": "application/json"})

    def http_for(j: GroupJob) -> HttpClient:
        return HttpClient(
            HttpSettings.from_source(j.source),
            repo_url="https://example.invalid/repo",
            transport=httpx.MockTransport(handler),
        )

    run_id = fetch.open_run(
        c, workflow="fetch", trigger="local", mode="refresh", git_sha="g", code_version="c",
        started_at=datetime.now(UTC),
    )  # fmt: skip
    report = fetch.fetch_groups(c, LocalDirStore(raw_dir), [job], http_for, run_id=run_id)
    assert report.status == "ok"
    return [o for g in report.groups for o in g.outcomes]


def _counts(c: psycopg.Connection) -> tuple[int, int, int]:
    return (
        _scalar(c, "SELECT count(*) FROM ingest.raw_object"),
        _scalar(c, "SELECT count(*) FROM curated.observation"),
        _scalar(c, "SELECT count(*) FROM ops.validation_result"),
    )


def test_slice_two_releases_run_twice(
    test_database: TestDatabase,
    repo: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw_dir = tmp_path / "raw"
    for name in ("MM_ENV", "MM_GROUPS", "MM_MODE", "MM_RAW_ID", "MM_RAW_STORE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", test_database.dsn())
    monkeypatch.setenv("MM_RAW_DIR", str(raw_dir))
    root = ["--root", str(repo)]
    assert cli.main(["migrate", *root]) == 0
    assert cli.main(["sync-config", *root]) == 0

    with test_database.connect() as c:
        assert _scalar(c, "SELECT count(*) FROM ref.series") == 0  # empty: first-sight creates
        assert _fetch(c, repo, raw_dir, R1) == ["new"]
    assert cli.main(["load", "--drain", *root]) == 0

    with test_database.connect() as c:
        t1 = _scalar(c, "SELECT max(known_at) FROM curated.observation")
        assert _scalar(c, "SELECT count(*) FROM ref.series") == 3
        n1 = _counts(c)
        # 3 countries x 3 months; ES 2026-08 has no value (status c): MISS rows count as rows
        assert n1[0] == 1
        assert n1[1] > 0
        assert n1[2] > 0  # validation results stored
        de_july = c.execute(
            "SELECT o.value FROM curated.v_observation_latest o JOIN ref.series s USING (series_id)"
            " WHERE s.series_key LIKE '%.DE' AND o.ref_period_start = '2026-07-01'"
        ).fetchall()
        assert [float(v) for (v,) in de_july] == [3.2]

        assert _fetch(c, repo, raw_dir, R2) == ["new"]
    assert cli.main(["load", "--drain", *root]) == 0

    with test_database.connect() as c:
        n2 = _counts(c)
        assert n2[0] == 2
        assert n2[1] == n1[1] + 1  # AC-SYS-4: exactly one new row for the one revised key
        rows = c.execute(
            "SELECT o.value, o.load_kind, o.known_at FROM curated.observation o"
            " JOIN ref.series s USING (series_id)"
            " WHERE s.series_key LIKE '%.DE' AND o.ref_period_start = '2026-07-01'"
            " ORDER BY o.known_at"
        ).fetchall()
        assert [float(r[0]) for r in rows] == [3.2, 3.3]
        assert rows[1][1] == "revision"
        t2 = rows[1][2]
        assert t2 > t1
        # earlier rows untouched: everything except the revision was loaded at or before t1
        assert (
            _scalar(
                c, f"SELECT count(*) FROM curated.observation WHERE known_at <= '{t1.isoformat()}'"
            )
            == n1[1]
        )
        # as-of before / after the revision
        sql = (
            "SELECT o.value FROM curated.fn_observation_asof(%s) o"
            " JOIN ref.series s USING (series_id)"
            " WHERE s.series_key LIKE '%%.DE' AND o.ref_period_start = '2026-07-01'"
        )  # fmt: skip
        assert [float(r[0]) for r in c.execute(sql, (t1,)).fetchall()] == [3.2]
        assert [float(r[0]) for r in c.execute(sql, (t2,)).fetchall()] == [3.3]

        # second pipeline run over the same release: nothing new (AC-SYS-3)
        assert _fetch(c, repo, raw_dir, R2) == ["unchanged"]
    assert cli.main(["load", "--drain", *root]) == 0
    with test_database.connect() as c:
        n3 = _counts(c)
        assert n3[0] == n2[0]
        assert n3[1] == n2[1]
        assert _scalar(c, "SELECT count(*) FROM ingest.v_raw_unloaded") == 0
