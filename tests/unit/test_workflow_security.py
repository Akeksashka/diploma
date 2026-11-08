"""Workflow hygiene (CLAUDE.md, workflows spec section 1): pinned actions, no injection in run."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

WORKFLOW_DIR = Path(__file__).resolve().parents[2] / ".github" / "workflows"
WORKFLOWS = sorted([*WORKFLOW_DIR.glob("*.yml"), *WORKFLOW_DIR.glob("*.yaml")])

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
EXPR_RE = re.compile(r"\$\{\{(.*?)\}\}", re.DOTALL)
# Trusted contexts allowed inside run: scripts; everything else is treated as user-controlled.
SAFE_EXPR_RE = re.compile(
    r"^\s*(github\.(run_id|run_number|run_attempt|workflow|server_url|repository|sha|event_name)"
    r"|runner\.\w+|job\.status|matrix\.[\w-]+)\s*$"
)


def _jobs(doc: dict[object, object]) -> dict[str, dict[str, object]]:
    jobs = doc.get("jobs")
    return jobs if isinstance(jobs, dict) else {}


def unpinned_uses(doc: dict[object, object]) -> list[str]:
    bad: list[str] = []
    for name, job in _jobs(doc).items():
        entries: list[object] = [job.get("uses")]
        steps = job.get("steps")
        if isinstance(steps, list):
            entries.extend(s.get("uses") for s in steps if isinstance(s, dict))
        for uses in entries:
            if not isinstance(uses, str) or uses.startswith("./"):
                continue
            if uses.startswith("docker://"):
                bad.append(f"{name}: {uses} (docker reference not pinned by sha)")
                continue
            _, _, ref = uses.partition("@")
            if not SHA_RE.match(ref):
                bad.append(f"{name}: {uses}")
    return bad


def unsafe_run_expressions(doc: dict[object, object]) -> list[str]:
    bad: list[str] = []
    for name, job in _jobs(doc).items():
        steps = job.get("steps")
        if not isinstance(steps, list):
            continue
        for step in steps:
            if not isinstance(step, dict):
                continue
            scripts = [step.get("run")]
            with_ = step.get("with")
            if isinstance(with_, dict) and str(step.get("uses", "")).startswith(
                "actions/github-script@"
            ):
                scripts.append(with_.get("script"))
            for script in scripts:
                if not isinstance(script, str):
                    continue
                for expr in EXPR_RE.findall(script):
                    if not SAFE_EXPR_RE.match(expr):
                        bad.append(f"{name}: ${{{{{expr}}}}}")
    return bad


def _load(path: Path) -> dict[object, object]:
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert isinstance(doc, dict)
    return doc


def test_workflows_exist() -> None:
    assert (WORKFLOW_DIR / "ci.yml").is_file()


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_actions_pinned_by_sha(path: Path) -> None:
    assert unpinned_uses(_load(path)) == []


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_no_user_controlled_expressions_in_run(path: Path) -> None:
    assert unsafe_run_expressions(_load(path)) == []


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_default_permissions_read_only(path: Path) -> None:
    assert _load(path).get("permissions") == {"contents": "read"}


def test_ci_has_no_secrets_and_no_network_tests() -> None:
    text = (WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8")
    assert "secrets." not in text
    for script in (Path(__file__).resolve().parents[2] / "scripts" / "ci").glob("*.sh"):
        assert "-m network" not in script.read_text(encoding="utf-8")


def test_scanner_detects_violations() -> None:
    doc: dict[object, object] = {
        "jobs": {
            "j": {
                "steps": [
                    {"uses": "actions/checkout@v4"},
                    {"uses": "actions/checkout@" + "a" * 40},
                    {"uses": "./local"},
                    {"run": "echo ${{ inputs.groups }} ${{ github.run_id }}"},
                    {"run": "echo ${{ github.event.pull_request.title }}"},
                ]
            }
        }
    }
    assert unpinned_uses(doc) == ["j: actions/checkout@v4"]
    assert len(unsafe_run_expressions(doc)) == 2


def test_migrate_workflow_contract() -> None:
    path = WORKFLOW_DIR / "migrate.yml"
    doc = _load(path)
    # PyYAML parses the bare key `on` as boolean True.
    triggers = doc.get("on", doc.get(True))
    assert isinstance(triggers, dict)
    assert set(triggers) == {"workflow_dispatch"}
    assert doc["concurrency"] == {"group": "mm-migrate", "cancel-in-progress": False}
    jobs = _jobs(doc)
    assert len(jobs) == 1
    job = next(iter(jobs.values()))
    assert job["runs-on"] == "ubuntu-24.04"
    steps = job["steps"]
    assert isinstance(steps, list)
    holders = [s for s in steps if "secrets." in str(s)]
    assert len(holders) == 1
    holder = holders[0]
    assert holder["env"]["DATABASE_URL"] == "${{ secrets.NEON_URL_MM_OWNER }}"
    assert holder["run"] == "scripts/ci/migrate.sh apply"
    assert set(re.findall(r"secrets\.(\w+)", path.read_text(encoding="utf-8"))) == {
        "NEON_URL_MM_OWNER"
    }
    # The dispatch input is read only through env:, never in run:.
    assert "inputs." not in "".join(str(s.get("run", "")) for s in steps)
    assert not [s for s in steps if "with" in s and "inputs." in str(s["with"])]
    assert any(s.get("run") == "scripts/ci/migrate.sh check" for s in steps)


def test_migrate_script_validates_and_applies() -> None:
    root = Path(__file__).resolve().parents[2]
    text = (root / "scripts" / "ci" / "migrate.sh").read_text(encoding="utf-8")
    assert "^(latest|[0-9]{4})$" in text
    assert "macro-monitor migrate" in text
