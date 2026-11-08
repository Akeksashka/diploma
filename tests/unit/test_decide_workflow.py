"""T78 decide.yml: dispatch-only, validated env-only inputs, injection safety (AC-WF-7/16)."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "decide.yml"
SCRIPT = ROOT / "scripts" / "ci" / "decide.sh"

INPUTS = (
    "kind",
    "decision",
    "event_id",
    "raw_id",
    "series_id",
    "ref_period_start",
    "known_at",
    "note",
)

VALID_DRIFT = {"MM_IN_KIND": "drift", "MM_IN_DECISION": "accepted", "MM_IN_EVENT_ID": "12"}


def _doc() -> dict[object, object]:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(doc, dict)
    return doc


def _steps() -> list[dict[str, object]]:
    job = _doc()["jobs"]["decide"]  # type: ignore[index]
    return list(job["steps"])


def _run(
    mode: str, env: dict[str, str], cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    base = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "MM_ACTOR": "alina-d"}
    base.update(env)
    return subprocess.run(
        ["bash", str(SCRIPT), mode],
        env=base,
        capture_output=True,
        text=True,
        check=False,
        cwd=cwd,
    )


def test_workflow_contract() -> None:
    doc = _doc()
    triggers = doc.get("on", doc.get(True))
    assert isinstance(triggers, dict)
    assert set(triggers) == {"workflow_dispatch"}
    assert set(triggers["workflow_dispatch"]["inputs"]) == set(INPUTS)
    assert doc["concurrency"] == {"group": "mm-decide", "cancel-in-progress": False}
    assert doc["permissions"] == {"contents": "read"}
    # AC-WF-16: production constants at workflow level.
    assert doc["env"] == {"MM_ENV": "production", "MM_RAW_STORE": "release_public"}
    jobs = doc["jobs"]
    assert isinstance(jobs, dict)
    assert len(jobs) == 1
    assert jobs["decide"]["runs-on"] == "ubuntu-24.04"


def test_inputs_only_through_env_and_actor_is_github_actor() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    for step in _steps():
        assert "inputs." not in str(step.get("run", ""))
        assert "github." not in str(step.get("run", ""))
        assert "with" not in step or "inputs." not in str(step["with"])
        if "run" in step:
            env = step["env"]
            assert isinstance(env, dict)
            assert env["MM_ACTOR"] == "${{ github.actor }}"
            for name in INPUTS:
                assert env[f"MM_IN_{name.upper()}"] == "${{ inputs." + name + " }}"
    # Only the ingest role secret is used, in exactly one step.
    assert set(re.findall(r"secrets\.(\w+)", text)) == {"NEON_URL_MM_INGEST"}
    assert len([s for s in _steps() if "secrets." in str(s)]) == 1


def test_steps_call_wrapper_check_then_apply() -> None:
    runs = [s.get("run") for s in _steps() if "run" in s]
    assert runs == ["scripts/ci/decide.sh check", "scripts/ci/decide.sh apply"]


def test_script_uses_decide_then_drain_with_actor() -> None:
    text = SCRIPT.read_text(encoding="utf-8")
    assert text.index("macro-monitor decide") < text.index("macro-monitor load --drain")
    assert '--decided-by "$actor"' in text
    assert "eval" not in text


@pytest.mark.parametrize(
    "extra",
    [
        {},
        {"MM_IN_DECISION": "rejected"},
        {
            "MM_IN_KIND": "drift",
            "MM_IN_DECISION": "skip_object",
            "MM_IN_EVENT_ID": "",
            "MM_IN_RAW_ID": "7",
        },
        {
            "MM_IN_KIND": "override",
            "MM_IN_DECISION": "exclude",
            "MM_IN_EVENT_ID": "",
            "MM_IN_SERIES_ID": "3",
            "MM_IN_REF_PERIOD_START": "2025-01-01",
            "MM_IN_KNOWN_AT": "2026-10-01T06:00:00Z",
            "MM_IN_NOTE": "Reviewed: base year rebased (2015=100).",
        },
    ],
)
def test_valid_inputs_pass(extra: dict[str, str]) -> None:
    res = _run("check", {**VALID_DRIFT, **extra})
    assert res.returncode == 0, res.stderr


INJECTION = "x; echo INJECTED"


@pytest.mark.parametrize("name", list(INPUTS))
def test_injection_executes_nothing(name: str, tmp_path: Path) -> None:
    marker = tmp_path / "pwned"
    env = {
        "MM_IN_KIND": "override",
        "MM_IN_DECISION": "exclude",
        "MM_IN_SERIES_ID": "3",
        "MM_IN_REF_PERIOD_START": "2025-01-01",
        "MM_IN_NOTE": "reason",
        f"MM_IN_{name.upper()}": INJECTION,
    }
    for payload in (INJECTION, f"$(touch {marker})", f"`touch {marker}`"):
        env[f"MM_IN_{name.upper()}"] = payload
        res = _run("check", env)
        # A note may legally contain `x; echo INJECTED` as plain text; it is never executed.
        if name != "note" or payload != INJECTION:
            assert res.returncode == 2
        assert "INJECTED" not in res.stdout
        assert not marker.exists()


def test_injection_in_actor_refused() -> None:
    res = _run("check", {**VALID_DRIFT, "MM_ACTOR": INJECTION})
    assert res.returncode == 2
    assert "INJECTED" not in res.stdout


@pytest.mark.parametrize(
    "env",
    [
        {"MM_IN_KIND": "bogus"},
        {"MM_IN_DECISION": "exclude"},  # decision does not apply to kind drift
        {"MM_IN_EVENT_ID": ""},  # drift needs event_id
        {"MM_IN_DECISION": "skip_object"},  # needs raw_id
        {"MM_IN_EVENT_ID": "1\nINJECTED"},
        {"MM_IN_NOTE": "line\nbreak"},
        {"MM_IN_NOTE": "a" * 501},
        {"MM_IN_KNOWN_AT": "2026-10-01"},
    ],
)
def test_invalid_inputs_refused(env: dict[str, str]) -> None:
    res = _run("check", {**VALID_DRIFT, **env})
    assert res.returncode == 2


def test_override_requires_reason() -> None:
    env = {
        "MM_IN_KIND": "override",
        "MM_IN_DECISION": "include",
        "MM_IN_SERIES_ID": "3",
        "MM_IN_REF_PERIOD_START": "2025-01-01",
    }
    assert _run("check", env).returncode == 2


def test_apply_without_database_url_fails_before_any_work() -> None:
    res = _run("apply", VALID_DRIFT)
    assert res.returncode == 1
    assert "DATABASE_URL" in res.stderr
