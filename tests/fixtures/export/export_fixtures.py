"""Shared helpers of the T83 export tests: the fixture config tree and a git-free ``ConfigTree``."""

from __future__ import annotations

from pathlib import Path

from macro_monitor.publish.meta import ConfigTree

CONFIG_ROOT = Path(__file__).parent / "config"
FIXTURE_SHA = "abc1234def5678abc1234def5678abc1234def56"


def fixture_config(git_sha: str = FIXTURE_SHA) -> ConfigTree:
    """Config tree read from ``tests/fixtures/export/config`` and labelled with ``git_sha``."""

    def read(rel: str) -> str:
        return (CONFIG_ROOT / rel).read_text(encoding="utf-8")

    def listdir(rel: str) -> list[str]:
        d = CONFIG_ROOT / rel
        return sorted(p.name for p in d.iterdir()) if d.is_dir() else []

    return ConfigTree(git_sha, read, listdir)
