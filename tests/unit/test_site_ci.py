"""T94: the ``site`` job of ci.yml, the smoke wrapper and the Dependabot entry (ADR-016, ADR-024).

Static checks of files only: no network, no browser, no secrets.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
import yaml

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]


def _site_job() -> dict[str, Any]:
    ci = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8"))
    job: dict[str, Any] = ci["jobs"]["site"]
    return job


def test_dependabot_has_the_weekly_grouped_npm_entry_for_site_without_auto_merge() -> None:
    text = (ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
    cfg = yaml.safe_load(text)
    entries = [u for u in cfg["updates"] if u["package-ecosystem"] == "npm"]
    assert [e["directory"] for e in entries] == ["/site"]  # AC-NPM-5
    assert entries[0]["schedule"]["interval"] == "weekly"
    assert entries[0]["groups"]
    assert "automerge" not in text.lower()  # no auto-merge setting of any kind


def test_site_job_runs_every_required_step_with_locked_installs_and_no_secrets() -> None:
    job = _site_job()
    runs = "\n".join(s.get("run", "") for s in job["steps"])
    for needle in (
        "npm ci",
        "npm test",
        "npm run build",
        "npm run measure:landing",
        "npm run check:imports",
        "scripts/audit-gate.mjs",
        "macro-monitor check-site",
        "scripts/ci/site-smoke.sh",
    ):
        assert needle in runs, needle
    assert "npm install" not in runs
    assert "secrets." not in json.dumps(job)
    assert "permissions" not in job  # workflow default: contents read
    for step in job["steps"]:
        if "uses" in step:
            assert re.fullmatch(r"[\w./-]+@[0-9a-f]{40}", step["uses"]), step["uses"]


def test_playwright_is_installed_only_by_its_cli_in_the_smoke_wrapper() -> None:
    wrapper = (ROOT / "scripts/ci/site-smoke.sh").read_text(encoding="utf-8")
    assert "playwright install" in wrapper
    assert "chromium" in wrapper
    assert "firefox" not in wrapper
    assert "webkit" not in wrapper
    assert "MM_SMOKE_REQUIRE_BROWSER=1" in wrapper
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "playwright install" not in ci
    assert "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD" in ci  # npm ci never downloads a browser
    pkg = json.loads((ROOT / "site/package.json").read_text(encoding="utf-8"))
    assert re.fullmatch(r"\d+\.\d+\.\d+", pkg["devDependencies"]["playwright"])
    # smoke tests are not unit tests
    assert pkg["scripts"]["test"] == "node --test tests/*.test.mjs"
    assert "smoke" in pkg["scripts"]
