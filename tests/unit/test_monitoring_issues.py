# ruff: noqa: PT018
"""T65 / AC-VAL-5: GitHub Issues helper against a mocked API."""

from __future__ import annotations

import json

import httpx

from macro_monitor.monitoring.issues import (
    SUMMARY_TITLE,
    Finding,
    GitHubIssues,
    close_workflow_recovered,
    render_body,
    report_workflow_failure,
    sync_issues,
)

RUN = "https://github.com/o/r/actions/runs/1"


class FakeGitHub:
    def __init__(self) -> None:
        self.issues: dict[int, dict[str, object]] = {}
        self.calls: list[tuple[str, str]] = []
        self.comments: dict[int, list[str]] = {}

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls.append((req.method, req.url.path))
        assert req.headers["Authorization"].startswith("Bearer ")
        path = req.url.path.removeprefix("/repos/o/r")
        if req.method == "GET" and path == "/issues":
            page = int(req.url.params["page"])
            op = [i for i in self.issues.values() if i["state"] == "open"]
            return httpx.Response(200, json=op[(page - 1) * 100 : page * 100])
        body = json.loads(req.content) if req.content else {}
        if req.method == "POST" and path == "/issues":
            n = len(self.issues) + 1
            self.issues[n] = {"number": n, "state": "open", **body}
            return httpx.Response(201, json={"number": n})
        n = int(path.split("/")[2])
        if path.endswith("/comments"):
            self.comments.setdefault(n, []).append(body["body"])
            return httpx.Response(201, json={})
        self.issues[n]["state"] = body["state"]
        return httpx.Response(200, json={})

    def api(self) -> GitHubIssues:
        return GitHubIssues("o/r", "tok", httpx.Client(transport=httpx.MockTransport(self.handler)))

    def open_titles(self) -> list[object]:
        return [i["title"] for i in self.issues.values() if i["state"] == "open"]


def test_repeat_failure_one_issue_then_recovery_closes() -> None:
    gh = FakeGitHub()
    f = Finding("FRESH-01", "ecb", labels=("freshness",), metrics={"late": 3})
    r1 = sync_issues(gh.api(), [f], [], RUN)
    r2 = sync_issues(gh.api(), [f], [], RUN)
    assert (
        r1.opened == ["[FRESH-01] ecb"] and r2.opened == [] and r2.commented == ["[FRESH-01] ecb"]
    )
    assert len(gh.issues) == 1 and len(gh.comments[1]) == 1
    r3 = sync_issues(gh.api(), [], ["[FRESH-01] ecb"], RUN)
    assert r3.closed == ["[FRESH-01] ecb"] and gh.open_titles() == []
    assert sync_issues(gh.api(), [], ["[FRESH-01] ecb"], RUN).closed == []


def test_unevaluated_key_is_not_closed() -> None:
    gh = FakeGitHub()
    sync_issues(gh.api(), [Finding("COMP-04", "wb")], [], RUN)
    sync_issues(gh.api(), [], [], RUN)
    assert gh.open_titles() == ["[COMP-04] wb"]


def test_cap_20_with_single_summary() -> None:
    gh = FakeGitHub()
    fs = [Finding("COMP-04", f"g{i}") for i in range(25)]
    r = sync_issues(gh.api(), fs, [], RUN)
    assert len(r.opened) == 20 and len(r.summarised) == 5
    assert sum(t == SUMMARY_TITLE for t in gh.open_titles()) == 1
    r2 = sync_issues(gh.api(), fs, [], RUN)
    assert len(r2.opened) == 5  # cap is per run
    assert sum(t == SUMMARY_TITLE for t in gh.open_titles()) == 1


def test_body_limits_ids_and_drops_unsafe() -> None:
    ids = [f"S{i}" for i in range(30)] + ["bad id with spaces=1.5", "x" * 200]
    body = render_body(Finding("COMP-04", "g", ids=ids, metrics={"n": 30}), RUN)
    assert body.count("- `") == 20
    assert "1.5" not in body and "xxxx" not in body


def test_labels_filtered_and_pull_requests_ignored() -> None:
    gh = FakeGitHub()
    sync_issues(gh.api(), [Finding("X", "g", labels=("pipeline", "secret-label"))], [], RUN)
    assert gh.issues[1]["labels"] == ["pipeline"]


def test_workflow_failure_helper() -> None:
    gh = FakeGitHub()
    report_workflow_failure(gh.api(), "monthly", RUN)
    report_workflow_failure(gh.api(), "monthly", RUN)
    assert gh.open_titles() == ["[pipeline] monthly"] and len(gh.comments[1]) == 1
    close_workflow_recovered(gh.api(), "monthly", RUN)
    assert gh.open_titles() == []
