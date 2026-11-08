"""ingest-manual.yml contract (T76; workflows spec section 5, AC-WF-4, AC-WF-7, AC-WF-16)."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ingest-manual.yml"
SCRIPT = ROOT / "scripts" / "ci" / "ingest_manual.sh"


def _doc() -> dict[object, object]:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(doc, dict)
    return doc


def _steps() -> list[dict[str, object]]:
    job = _doc()["jobs"]["ingest"]  # type: ignore[index]
    return list(job["steps"])  # type: ignore[index]


def test_triggers_and_path_filter() -> None:
    doc = _doc()
    triggers = doc.get("on", doc.get(True))  # PyYAML parses the bare key `on` as True
    assert isinstance(triggers, dict)
    assert set(triggers) == {"push", "workflow_dispatch"}
    assert triggers["push"] == {"branches": ["main"], "paths": ["manual_inbox/**"]}
    assert set(triggers["workflow_dispatch"]["inputs"]) == {"path"}


def test_concurrency_and_constants() -> None:
    doc = _doc()
    assert doc["concurrency"] == {"group": "mm-manual", "cancel-in-progress": False}
    env = doc["env"]
    assert isinstance(env, dict)
    assert env["MM_ENV"] == "production"  # AC-WF-16
    assert env["MM_RAW_STORE"] == "release_public"
    job = doc["jobs"]["ingest"]  # type: ignore[index]
    assert job["runs-on"] == "ubuntu-24.04"
    assert job["timeout-minutes"]


def test_each_secret_in_its_own_step_only() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert set(re.findall(r"secrets\.(\w+)", text)) == {"NEON_URL_MM_INGEST"}
    holders = [s for s in _steps() if "secrets." in str(s)]
    assert len(holders) == 1
    assert holders[0]["env"]["DATABASE_URL"] == "${{ secrets.NEON_URL_MM_INGEST }}"  # type: ignore[index]
    assert holders[0]["run"] == "scripts/ci/ingest_manual.sh run"


def test_path_input_only_through_env() -> None:
    steps = _steps()
    assert "inputs." not in "".join(str(s.get("run", "")) for s in steps)
    users = [s for s in steps if "inputs.path" in str(s)]
    assert len(users) == 1
    assert users[0]["env"]["MM_INPUT_PATH"] == "${{ inputs.path }}"  # type: ignore[index]
    assert users[0]["run"] == "scripts/ci/ingest_manual.sh plan"
    assert "github.event.before" not in "".join(str(s.get("run", "")) for s in steps)


def test_no_heartbeat_or_ops_writes() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "ops/" not in text
    assert "git push" not in text


def test_script_validates_path_like_the_cli() -> None:
    from macro_monitor.settings import INBOX_PATH_PATTERN

    text = SCRIPT.read_text(encoding="utf-8")
    m = re.search(r"path_re='(.*)'", text)
    assert m is not None
    shell_re = re.compile(m.group(1))
    for ok in ("manual_inbox/imf_weo/2026-10/WEO_Oct.xlsx", "manual_inbox/a_b/2026-01/f"):
        assert shell_re.match(ok)
        assert INBOX_PATH_PATTERN.fullmatch(ok)
    for bad in (
        "manual_inbox/../etc/passwd",
        "manual_inbox/x/2026-13/f",
        "manual_inbox/x/2026-10/.hidden",
        "manual_inbox/x/2026-10/a b",
        "manual_inbox/x/2026-10/f; echo INJECTED",
        "other/x/2026-10/f",
    ):
        assert not shell_re.match(bad)
        assert not INBOX_PATH_PATTERN.fullmatch(bad)


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash not available")
@pytest.mark.parametrize(
    "bad",
    ["x; echo INJECTED", "manual_inbox/../../etc/passwd", "$(id)", "manual_inbox/x/2026-10/a b"],
)
def test_script_rejects_bad_dispatch_path(bad: str, tmp_path: Path) -> None:
    env = {
        **os.environ,
        "MM_EVENT_NAME": "workflow_dispatch",
        "MM_INPUT_PATH": bad,
        "MM_PLAN_FILE": str(tmp_path / "plan.tsv"),
    }
    res = subprocess.run(
        ["bash", str(SCRIPT), "plan"], env=env, capture_output=True, text=True, check=False
    )
    assert res.returncode == 2
    assert "invalid path" in res.stderr
    assert "INJECTED" not in res.stdout


def test_script_run_requires_database_url(tmp_path: Path) -> None:
    env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
    env["MM_LOG_FILE"] = str(tmp_path / "log")
    env["MM_PLAN_FILE"] = str(tmp_path / "plan")
    res = subprocess.run(
        ["bash", str(SCRIPT), "run"], env=env, capture_output=True, text=True, check=False
    )
    assert res.returncode == 1
    assert "DATABASE_URL is not set" in res.stderr


def test_script_summary_counts(tmp_path: Path) -> None:
    log = tmp_path / "log"
    log.write_text(
        "ingest-manual manual_inbox/s/2026-10/f.xlsx: imported\n"
        "load raw_id=1: loaded\nload raw_id=2: deferred\n",
        encoding="utf-8",
    )
    env = {**os.environ, "MM_LOG_FILE": str(log)}
    res = subprocess.run(
        ["bash", str(SCRIPT), "summary"], env=env, capture_output=True, text=True, check=True
    )
    assert "files processed: 1" in res.stdout
    assert "objects loaded: 1" in res.stdout
    assert "other load status: 1" in res.stdout
