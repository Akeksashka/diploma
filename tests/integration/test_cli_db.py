"""CLI commands against a throwaway database (T30): migrate, sync-config, plan, load."""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest

from macro_monitor import cli
from macro_monitor.storage import manifest, migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[2]
GROUP = "eurostat_labour"


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A config tree with the eurostat source enabled (the repo copy is disabled until OP-04)."""
    shutil.copytree(ROOT / "config", tmp_path / "config")
    shutil.copy(ROOT / ".env.example", tmp_path / ".env.example")
    cfg = tmp_path / "config" / "sources.yaml"
    cfg.write_text(cfg.read_text().replace("enabled: false", "enabled: true", 1))
    return tmp_path


@pytest.fixture
def env(test_database: TestDatabase, monkeypatch: pytest.MonkeyPatch) -> TestDatabase:
    for name in ("MM_ENV", "MM_RAW_STORE", "MM_GROUPS", "MM_MODE", "MM_RAW_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", test_database.dsn())
    return test_database


def _plan(repo: Path, capsys: pytest.CaptureFixture[str], *extra: str) -> dict[str, object]:
    capsys.readouterr()
    assert cli.main(["plan", "--root", str(repo), *extra]) == 0
    out: dict[str, object] = json.loads(capsys.readouterr().out)
    return out


def test_migrate_sync_plan_load(
    env: TestDatabase, repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # plan before migrate: schema version mismatch -> 40
    assert cli.main(["plan", "--root", str(repo)]) == 40
    assert cli.main(["migrate", "--root", str(repo)]) == 0
    assert cli.main(["migrate", "--root", str(repo)]) == 0  # idempotent
    assert cli.main(["sync-config", "--root", str(repo)]) == 0

    out = _plan(repo, capsys)
    assert out["fetch_matrix"] == {"include": [{"group": GROUP, "job_timeout_min": 120}]}
    assert out["load_groups"] == GROUP
    assert out["release_tag"] is None  # local_dir store
    assert isinstance(out["run_id"], int)

    with env.connect() as c:
        runs = c.execute("SELECT workflow, status FROM ingest.run ORDER BY run_id").fetchall()
    assert ("plan", "ok") in runs


def _unloaded_object(c: psycopg.Connection, run_id: int) -> int:
    at = datetime(2026, 11, 1, tzinfo=UTC)
    manifest.insert_blob(
        c, sha256="1" * 64, byte_count=1, storage_backend="local_dir",
        storage_ref="x/1", first_stored_at=at,
    )  # fmt: skip
    raw_id = manifest.insert_raw_object(
        c,
        manifest.NewRawObject(
            run_id=run_id, source_id="eurostat", group_id=GROUP, request_key="k",
            request_url="https://x/", request_params={}, http_status=200, etag=None,
            last_modified=None, content_type=None, fetched_at=at, sha256="1" * 64,
            parser_id="jsonstat_v1@1", fetch_mode="full", fetch_scope="complete",
        ),
        None,
    )  # fmt: skip
    c.commit()
    return raw_id


def test_plan_selects_backlog_group_without_fetch(
    env: TestDatabase, repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with env.connect() as c:
        migrate.migrate(c)
        c.commit()
    assert cli.main(["sync-config", "--root", str(repo)]) == 0
    with env.connect() as c:
        row = c.execute("SELECT max(run_id) FROM ingest.run").fetchone()
        assert row is not None
        _unloaded_object(c, int(row[0]))
    manual = _plan(repo, capsys, "--mode", "manual")
    assert manual["fetch_matrix"] == {"include": []}
    assert manual["load_groups"] == GROUP


def test_plan_without_backlog_manual_is_empty(
    env: TestDatabase, repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with env.connect() as c:
        migrate.migrate(c)
        c.commit()
    assert cli.main(["sync-config", "--root", str(repo)]) == 0
    manual = _plan(repo, capsys, "--mode", "manual")
    assert manual["load_groups"] == ""
