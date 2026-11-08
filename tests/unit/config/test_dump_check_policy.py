"""T70 / AC-WF-10 (offline): hash_only valid, private needs a repo, no RAW_PRIVATE_TOKEN."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from test_sources_config import assert_fails, doc, src

from macro_monitor.registry.config import validate_sources
from macro_monitor.storage import dump_check
from macro_monitor.storage.dump import DumpError

ROOT = Path(__file__).resolve().parents[3]


def test_hash_only_source_is_valid_and_private_without_repo_is_not() -> None:
    d = doc()
    src(d)["archive"] = "hash_only"
    assert validate_sources(d) == []
    d = doc()
    src(d)["archive"] = "private"
    assert d["archive_policy"]["private_repo"] is None
    assert_fails(d, "17")


def test_no_workflow_references_raw_private_token() -> None:
    gh = ROOT / ".github"
    workflows = sorted(gh.rglob("*.yml")) + sorted(gh.rglob("*.yaml"))
    assert workflows
    for wf in workflows:
        assert "RAW_PRIVATE_TOKEN" not in wf.read_text(encoding="utf-8"), wf.name


def test_missing_manifest_fails_closed(tmp_path: Path) -> None:
    assert dump_check.check_dump(tmp_path)
    with pytest.raises(dump_check.DumpSelfCheckError) as exc:
        dump_check.assert_dump_ok(tmp_path)
    assert isinstance(exc.value, DumpError)
