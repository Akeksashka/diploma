"""monthly-refresh.yml contract, T74 part (workflows spec section 4; AC-WF-3, 7, 11, 13, 16)."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "monthly-refresh.yml"
SCRIPT = ROOT / "scripts" / "ci" / "monthly_refresh.sh"


def _doc() -> dict[object, object]:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(doc, dict)
    return doc


def _jobs() -> dict[str, dict[str, object]]:
    jobs = _doc()["jobs"]
    assert isinstance(jobs, dict)
    return jobs


def _steps(job: str) -> list[dict[str, object]]:
    return list(_jobs()[job]["steps"])  # type: ignore[arg-type]


def test_triggers_and_inputs() -> None:
    doc = _doc()
    triggers = doc.get("on", doc.get(True))
    assert isinstance(triggers, dict)
    assert set(triggers) == {"schedule", "workflow_dispatch"}
    assert [c["cron"] for c in triggers["schedule"]] == ["23 4 1 * *", "23 4 4 * *"]
    inputs = triggers["workflow_dispatch"]["inputs"]
    assert set(inputs) == {"mode", "groups", "dry_run"}
    assert inputs["mode"]["options"] == ["refresh", "catchup"]
    assert inputs["dry_run"]["type"] == "boolean"


def test_concurrency_constants_and_runner() -> None:
    doc = _doc()
    assert doc["concurrency"] == {"group": "mm-refresh", "cancel-in-progress": False}
    assert doc["permissions"] == {"contents": "read"}
    env = doc["env"]
    assert isinstance(env, dict)
    assert env["MM_ENV"] == "production"  # AC-WF-16
    assert env["MM_RAW_STORE"] == "release_public"
    for name, job in _jobs().items():
        assert job["runs-on"] == "ubuntu-24.04", name
        assert "timeout-minutes" in job, name


def test_fetch_matrix_settings() -> None:
    fetch = _jobs()["fetch"]
    strategy = fetch["strategy"]
    assert isinstance(strategy, dict)
    assert strategy["fail-fast"] is False
    assert strategy["max-parallel"] == 4
    assert "fromJSON(needs.plan.outputs.fetch_matrix)" in str(strategy["matrix"])
    assert fetch["timeout-minutes"] == "${{ matrix.job_timeout_min }}"  # AC-WF-13


def test_load_runs_after_failed_legs_but_not_on_dry_run() -> None:  # AC-WF-3
    load = _jobs()["load"]
    cond = str(load["if"])
    assert cond.startswith("always()")
    assert "needs.plan.result == 'success'" in cond
    assert "dry_run == 'false'" in cond
    assert load["needs"] == ["plan", "fetch"]


def test_r_analysis_gate() -> None:
    job = _jobs()["r-analysis"]
    assert "vars.ENABLE_R == 'true'" in str(job["if"])
    assert job["continue-on-error"] is True


def test_secrets_one_role_per_step() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert set(re.findall(r"secrets\.(\w+)", text)) == {
        "NEON_URL_MM_INGEST",
        "NEON_URL_MM_ANALYTICS",
    }
    for job, steps in ((j, _steps(j)) for j in _jobs()):
        for s in steps:
            roles = set(re.findall(r"secrets\.(\w+)", str(s)))
            assert len(roles) <= 1, (job, s.get("name"))
    analyze = [s for s in _steps("load") if "NEON_URL_MM_ANALYTICS" in str(s)]
    assert len(analyze) == 1
    assert analyze[0]["run"] == "scripts/ci/monthly_refresh.sh analyze"
    assert "NEON_URL_MM_ANALYTICS" not in str(_steps("plan")) + str(_steps("fetch"))
    for s in _steps("plan") + _steps("fetch") + _steps("load"):
        if "NEON_URL_MM_INGEST" in str(s):
            assert s["env"]["DATABASE_URL"] == "${{ secrets.NEON_URL_MM_INGEST }}"  # type: ignore[index]


def test_user_values_only_through_env() -> None:  # AC-WF-7
    for job in _jobs():
        for s in _steps(job):
            run = str(s.get("run", ""))
            assert "${{" not in run, (job, s.get("name"))
    plan_step = _steps("plan")[2]
    env = plan_step["env"]
    assert env["MM_INPUT_GROUPS"] == "${{ inputs.groups }}"  # type: ignore[index]
    assert env["MM_INPUT_MODE"] == "${{ inputs.mode }}"  # type: ignore[index]
    assert env["MM_INPUT_DRY_RUN"] == "${{ inputs.dry_run }}"  # type: ignore[index]
    fetch_env = _steps("fetch")[2]["env"]
    assert fetch_env["MM_GROUP"] == "${{ matrix.group }}"  # type: ignore[index]


def test_actions_pinned_by_sha_and_no_pages_or_enable_token() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    for m in re.finditer(r"uses:\s*(\S+)", text):
        assert re.fullmatch(r".+@[0-9a-f]{40}", m.group(1)), m.group(1)
    assert "WORKFLOW_ENABLE_TOKEN" not in text  # T75
    assert "actions: write" not in text
    assert "NEON_URL_MM_OWNER" not in text


def _run(mode: str, extra: dict[str, str], tmp: Path) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("MM_")}
    env.update(
        {"DATABASE_URL": "postgresql://invalid.invalid/none", "GITHUB_OUTPUT": str(tmp / "o")}
    )
    env.update(extra)
    return subprocess.run(
        ["bash", str(SCRIPT), mode], env=env, capture_output=True, text=True, check=False
    )


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash not available")
@pytest.mark.parametrize(
    ("extra", "message"),
    [
        (
            {"MM_EVENT_NAME": "workflow_dispatch", "MM_INPUT_GROUPS": "a;echo INJECTED"},
            "invalid groups",
        ),
        ({"MM_EVENT_NAME": "workflow_dispatch", "MM_INPUT_MODE": "x; id"}, "invalid mode"),
        ({"MM_EVENT_NAME": "workflow_dispatch", "MM_INPUT_DRY_RUN": "yes"}, "invalid dry_run"),
        ({"MM_EVENT_NAME": "schedule", "MM_SCHEDULE": "0 0 * * *"}, "unknown schedule"),
    ],
)
def test_plan_rejects_bad_inputs(extra: dict[str, str], message: str, tmp_path: Path) -> None:
    res = _run("plan", extra, tmp_path)
    assert res.returncode == 2
    assert message in res.stderr
    assert "INJECTED" not in res.stdout


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash not available")
def test_modes_require_database_url_and_valid_group(tmp_path: Path) -> None:
    for mode in ("plan", "fetch", "load", "analyze"):
        env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
        res = subprocess.run(
            ["bash", str(SCRIPT), mode], env=env, capture_output=True, text=True, check=False
        )
        assert res.returncode == 1, mode
        assert "DATABASE_URL is not set" in res.stderr
    res = _run("fetch", {"MM_GROUP": "x; echo INJECTED"}, tmp_path)
    assert res.returncode == 2
    assert "invalid group id" in res.stderr
    assert "INJECTED" not in res.stdout
