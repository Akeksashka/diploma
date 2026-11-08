"""git_map_provider reads the series map at the run's git_sha (AC-ING-21, ADR-018)."""

from __future__ import annotations

import subprocess
from pathlib import Path

from macro_monitor.storage.series_create import git_map_provider

SOURCES = """sources:
  - id: S
    groups:
      - id: G
        series_map: config/map.yaml
"""


def _map(key: str) -> str:
    return (
        "series:\n  - dataset: d\n    key: " + key + "\n    entity: E1\n    indicator: I1\n"
        "    role: headline\n    valid_from: 1991-01-01\n    rationale: r\n"
        "    expect: {frequency: M, unit: PC, seasonal_adjustment: SA, price_basis: NA}\n"
    )


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args],
        capture_output=True, text=True, check=True,
    ).stdout.strip()  # fmt: skip


def test_map_is_read_at_the_given_sha_not_the_working_tree(tmp_path: Path) -> None:
    (tmp_path / "config").mkdir()
    (tmp_path / "config/sources.yaml").write_text(SOURCES)
    (tmp_path / "config/map.yaml").write_text(_map("old"))
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-q", "-m", "one")
    sha = _git(tmp_path, "rev-parse", "HEAD")
    (tmp_path / "config/map.yaml").write_text(_map("new"))  # uncommitted edit
    provider = git_map_provider(tmp_path)
    assert [e.key for e in provider("S", "G", sha)] == ["old"]
    assert [e.key for e in provider("S", "G", "unknown")] == ["new"]  # fallback: working tree
    assert provider("S", "NOPE", sha) == ()
    assert provider("OTHER", "G", sha) == ()
