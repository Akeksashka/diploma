"""T51: rebuild from archived bytes (AC-SYS-5, I-CUR-7, T-DDL-14, AC-ING-21 rebuild clause).

Offline: the recorded synthetic Eurostat fixtures are fetched through a mock transport, loaded,
then ``curated.observation`` is emptied (owner, throwaway database) and rebuilt from the archive
with the recorded parser and the config at the recorded sha.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).parent))  # --import-mode=importlib: no sibling imports
from test_slice_e2e import R1, R2, _fetch, _scalar, repo  # noqa: F401

from macro_monitor import cli
from macro_monitor.ingestion.archive import LocalDirStore
from macro_monitor.storage import rebuild, replay
from macro_monitor.storage.series_create import git_map_provider

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db


def _truncate(c: psycopg.Connection) -> None:
    with c.transaction():
        c.execute("ALTER TABLE curated.observation DISABLE TRIGGER observation_no_truncate")
        c.execute("TRUNCATE curated.observation")
        c.execute("ALTER TABLE curated.observation ENABLE TRIGGER observation_no_truncate")


def test_rebuild_equals_original_and_labels_approximate(
    test_database: TestDatabase,
    repo: Path,  # noqa: F811
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
        _fetch(c, repo, raw_dir, R1)
    assert cli.main(["load", "--drain", *root]) == 0
    with test_database.connect() as c:
        _fetch(c, repo, raw_dir, R2)
    assert cli.main(["load", "--drain", *root]) == 0

    store = LocalDirStore(raw_dir)
    with test_database.connect() as c:
        before = replay.natural_rows(c)
        assert len(before) > 0
        pre = rebuild.check_prerequisites(c, store, repo)
        assert pre.unknown_parsers == []  # T-DDL-14
        assert pre.missing_bytes == []
        assert pre.missing_shas == ["g", "unknown"]  # shas of the fetch helper and CLI
        with pytest.raises(rebuild.RebuildPrerequisiteError):  # exact needs the sha
            rebuild.rebuild(c, store, repo, git_map_provider(repo), mode="exact")
        with pytest.raises(rebuild.RebuildPrerequisiteError, match="not empty"):
            rebuild.rebuild(c, store, repo, git_map_provider(repo), mode="approximate")
        _truncate(c)
        assert replay.natural_rows(c) == []

    assert cli.main(["rebuild", "--mode", "exact", *root]) == 10  # refused, nothing replayed
    assert cli.main(["rebuild", "--mode", "approximate", *root]) == 0
    with test_database.connect() as c:
        assert replay.natural_rows(c) == before  # AC-SYS-5 / I-CUR-7
        assert _scalar(c, "SELECT count(*) FROM staging.observation_load") == 0
        assert _scalar(c, "SELECT count(*) FROM ingest.raw_load WHERE outcome = 'loaded'") == 2


def test_missing_bytes_is_reported(
    test_database: TestDatabase,
    repo: Path,  # noqa: F811
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
        _fetch(c, repo, raw_dir, R1)
    assert cli.main(["load", "--drain", *root]) == 0
    for f in raw_dir.rglob("*.zst"):
        f.unlink()
    with test_database.connect() as c:
        pre = rebuild.check_prerequisites(c, LocalDirStore(raw_dir), repo)
        assert len(pre.missing_bytes) == 1
        with pytest.raises(rebuild.RebuildPrerequisiteError, match="missing bytes"):
            rebuild.rebuild(
                c, LocalDirStore(raw_dir), repo, git_map_provider(repo), mode="approximate"
            )
