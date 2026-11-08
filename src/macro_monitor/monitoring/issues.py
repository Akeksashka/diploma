"""GitHub Issues alert channel (ADR-007, validation-monitoring-spec section 6, AC-VAL-5).

One issue per title key ``[<family>] <group>``: opened on a failing check, commented on repeats
(never duplicated), closed with a comment when a later run passes. At most ``MAX_NEW_ISSUES`` new
issues per run; the rest are summarised in one ``[summary]`` issue. Bodies carry only the run URL,
counts and at most ``MAX_IDS`` identifiers: no data values and no secrets.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

import httpx

API_URL = "https://api.github.com"
MAX_NEW_ISSUES = 20
MAX_IDS = 20
SUMMARY_TITLE = "[summary] additional alerts"
LABELS = frozenset({"pipeline", "data-quality", "source-drift", "freshness", "manual-action"})
_SAFE_ID = re.compile(r"^[A-Za-z0-9_.:/\-]{1,80}$")


def title_key(family: str, group: str) -> str:
    return f"[{family}] {group}"


@dataclass(frozen=True)
class Finding:
    """A failing check at warn/error. ``metrics`` are counts only; ``ids`` are series/object ids."""

    family: str
    group: str
    labels: tuple[str, ...] = ("pipeline",)
    ids: Sequence[str] = ()
    metrics: dict[str, int] = field(default_factory=dict)

    @property
    def title(self) -> str:
        return title_key(self.family, self.group)


@dataclass(frozen=True)
class SyncResult:
    opened: list[str]
    commented: list[str]
    closed: list[str]
    summarised: list[str]


def render_body(finding: Finding, run_url: str) -> str:
    """Issue/comment text: run URL, integer metrics, at most ``MAX_IDS`` safe ids."""
    safe = [i for i in finding.ids if _SAFE_ID.match(i)]
    lines = [f"Run: {run_url}"]
    lines += [f"- {k}: {int(v)}" for k, v in sorted(finding.metrics.items())]
    if safe:
        lines.append(f"Ids ({min(len(safe), MAX_IDS)} of {len(finding.ids)}):")
        lines += [f"- `{i}`" for i in safe[:MAX_IDS]]
    return "\n".join(lines)


class GitHubIssues:
    """Minimal REST client. ``client`` is injectable (tests use ``httpx.MockTransport``)."""

    def __init__(self, repo: str, token: str, client: httpx.Client | None = None) -> None:
        self._repo = repo
        self._client = client or httpx.Client(timeout=30)
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    @classmethod
    def from_env(cls) -> GitHubIssues:
        return cls(os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"])

    def _request(self, method: str, path: str, **kw: object) -> httpx.Response:
        resp = self._client.request(
            method,
            f"{API_URL}/repos/{self._repo}{path}",
            headers=self._headers,
            **kw,  # type: ignore[arg-type]
        )
        resp.raise_for_status()
        return resp

    def open_issues(self) -> dict[str, int]:
        """Open issues by title (pull requests excluded) -> issue number."""
        out: dict[str, int] = {}
        page = 1
        while True:
            items = self._request(
                "GET", "/issues", params={"state": "open", "per_page": 100, "page": page}
            ).json()
            for it in items:
                if "pull_request" not in it:
                    out.setdefault(str(it["title"]), int(it["number"]))
            if len(items) < 100:
                return out
            page += 1

    def create(self, title: str, body: str, labels: Iterable[str]) -> int:
        payload = {"title": title, "body": body, "labels": sorted(set(labels) & LABELS)}
        return int(self._request("POST", "/issues", json=payload).json()["number"])

    def comment(self, number: int, body: str) -> None:
        self._request("POST", f"/issues/{number}/comments", json={"body": body})

    def close(self, number: int) -> None:
        self._request(
            "PATCH", f"/issues/{number}", json={"state": "closed", "state_reason": "completed"}
        )


def sync_issues(
    api: GitHubIssues,
    findings: Sequence[Finding],
    passed_keys: Iterable[str],
    run_url: str,
    *,
    cap: int = MAX_NEW_ISSUES,
) -> SyncResult:
    """Open/comment failing findings, close open issues whose key passed in this run."""
    existing = api.open_issues()
    res = SyncResult([], [], [], [])
    failing = {f.title for f in findings}
    overflow: list[Finding] = []
    for f in findings:
        body = render_body(f, run_url)
        if f.title in existing:
            api.comment(existing[f.title], body)
            res.commented.append(f.title)
        elif len(res.opened) < cap:
            existing[f.title] = api.create(f.title, body, f.labels)
            res.opened.append(f.title)
        else:
            overflow.append(f)
    if overflow:
        lines = [f"Run: {run_url}", f"{len(overflow)} further alerts not opened (cap {cap}):"]
        lines += [f"- {f.title}" for f in overflow[:MAX_IDS]]
        body = "\n".join(lines)
        if SUMMARY_TITLE in existing:
            api.comment(existing[SUMMARY_TITLE], body)
        else:
            api.create(SUMMARY_TITLE, body, ["pipeline"])
        res.summarised.extend(f.title for f in overflow)
    for key in passed_keys:
        if key in existing and key not in failing:
            api.comment(existing[key], f"Check passed in run {run_url}; closing.")
            api.close(existing[key])
            res.closed.append(key)
    return res


def report_workflow_failure(api: GitHubIssues, workflow: str, run_url: str) -> SyncResult:
    """Helper for an ``if: failure()`` step: one ``[pipeline] <workflow>`` issue."""
    finding = Finding("pipeline", workflow, labels=("pipeline",))
    return sync_issues(api, [finding], [], run_url)


def close_workflow_recovered(api: GitHubIssues, workflow: str, run_url: str) -> SyncResult:
    """Close the workflow's failure issue after a successful run."""
    return sync_issues(api, [], [title_key("pipeline", workflow)], run_url)
