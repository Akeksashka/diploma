"""monthly_refresh.sh plan on a throwaway database: the dry-run path changes nothing (AC-WF-2)."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from macro_monitor import cli

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ci" / "monthly_refresh.sh"


def _counts(db: TestDatabase) -> dict[str, int]:
    with db.connect() as c:
        return {
            t: int(c.execute(f"SELECT count(*) FROM {t}").fetchone()[0])  # type: ignore[index]
            for t in ("ref.series", "ref.indicator", "ingest.request_state", "ingest.raw_load")
        }


def _uv_shim(directory: Path) -> None:
    """A minimal `uv` (sync is a no-op, run executes from the project venv) for hosts without uv."""
    directory.mkdir()
    shim = directory / "uv"
    shim.write_text(
        '#!/usr/bin/env bash\nset -e\n[ "$1" = sync ] && exit 0\n'
        f'shift\nexec env PATH="{ROOT}/.venv/bin:$PATH" "$@"\n',
        encoding="utf-8",
    )
    shim.chmod(0o755)


def test_dry_run_plans_only(
    test_database: TestDatabase, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("MM_ENV", "MM_RAW_STORE", "MM_GROUPS", "MM_MODE", "MM_RAW_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", test_database.dsn())
    assert cli.main(["migrate", "--root", str(ROOT)]) == 0
    before = _counts(test_database)
    if shutil.which("uv") is None:
        _uv_shim(tmp_path / "bin")
        monkeypatch.setenv("PATH", f"{tmp_path / 'bin'}{os.pathsep}{os.environ['PATH']}")
    out = tmp_path / "out"
    env = {
        **os.environ,
        "PATH": os.environ["PATH"],
        "RUNNER_TEMP": str(tmp_path),
        "GITHUB_OUTPUT": str(out),
        "MM_EVENT_NAME": "workflow_dispatch",
        "MM_INPUT_MODE": "refresh",
        "MM_INPUT_GROUPS": "",
        "MM_INPUT_DRY_RUN": "true",
        "MM_RAW_STORE": "local_dir",
    }
    env.pop("MM_ENV", None)
    res = subprocess.run(
        ["bash", str(SCRIPT), "plan"], env=env, capture_output=True, text=True, check=False
    )
    assert res.returncode == 0, res.stderr
    lines = dict(line.split("=", 1) for line in out.read_text().splitlines())
    assert lines["dry_run"] == "true"
    assert lines["has_fetch"] == "false"
    assert lines["fetch_matrix"] == '{"include": []}'
    assert lines["load_groups"] == ""
    assert lines["mode"] == "refresh"
    assert _counts(test_database) == before
