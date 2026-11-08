"""T72 unit tests: public dump release publication against a mock GitHub API (no network)."""

from __future__ import annotations

import gzip
import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest

from macro_monitor.monitoring.issues import GitHubIssues
from macro_monitor.storage.dump_check import DumpSelfCheckError
from macro_monitor.storage.release_archive import (
    ReleaseArchiveError,
    ReleaseArchiveStore,
    publish_dump_or_alert,
)

pytestmark = pytest.mark.unit

REPO = "acme/raw"
TOKEN = "tok-SECRET-123"
RUN_URL = "https://github.com/acme/raw/actions/runs/9"
SECRET_VALUE = "WITHHELD-VALUE-777"


class FakeClock:
    def monotonic(self) -> float:
        return 0.0

    def sleep(self, seconds: float) -> None:
        pass

    def wall(self) -> Any:
        from datetime import UTC, datetime

        return datetime(2026, 11, 4, tzinfo=UTC)


class MockGitHub:
    def __init__(self) -> None:
        self.releases: list[dict[str, Any]] = []
        self.git_tags: set[str] = set()
        self.assets: dict[int, dict[str, Any]] = {}
        self.issues: list[dict[str, Any]] = []
        self.log: list[tuple[str, str]] = []
        self.fail_upload_name: str | None = None
        self.n = 100

    def handler(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        self.log.append((req.method, path))
        pre = f"/repos/{REPO}/releases"
        self.n += 1
        if path == f"/repos/{REPO}/issues":
            if req.method == "GET":
                return httpx.Response(200, json=self.issues)
            body = json.loads(req.content)
            self.issues.append({"number": self.n, **body})
            return httpx.Response(201, json={"number": self.n})
        if req.method == "GET" and path == pre:
            return httpx.Response(200, json=self.releases)
        if req.method == "GET" and path.startswith(f"/repos/{REPO}/git/ref/tags/"):
            tag = path.rsplit("/", 1)[1]
            return httpx.Response(200 if tag in self.git_tags else 404)
        if req.method == "POST" and path == pre:
            body = json.loads(req.content)
            rel = {"id": self.n, "tag_name": body["tag_name"], "draft": body["draft"]}
            self.releases.append(rel)
            return httpx.Response(201, json=rel)
        if req.method == "POST" and path.endswith("/assets"):
            rid = int(path.split("/")[-2])
            name = req.url.params["name"]
            if name == self.fail_upload_name:
                return httpx.Response(422, json={"message": "boom"})
            self.assets[self.n] = {"id": self.n, "name": name, "release_id": rid}
            return httpx.Response(201, json={"id": self.n, "name": name})
        if req.method == "GET" and path.endswith("/assets"):
            rid = int(path.split("/")[-2])
            rows = [a for a in self.assets.values() if a["release_id"] == rid]
            return httpx.Response(200, json=rows)
        if req.method == "PATCH" and path.startswith(pre + "/"):
            rel = next(r for r in self.releases if r["id"] == int(path.rsplit("/", 1)[1]))
            rel["draft"] = json.loads(req.content)["draft"]
            return httpx.Response(200, json=rel)
        if req.method == "DELETE" and path.startswith(pre + "/"):
            rid = int(path.rsplit("/", 1)[1])
            self.releases = [r for r in self.releases if r["id"] != rid]
            return httpx.Response(204)
        return httpx.Response(500, text=f"unrouted {req.method} {path}")

    def published(self) -> list[str]:
        return [r["tag_name"] for r in self.releases if not r["draft"]]

    def asset_names(self, tag: str) -> list[str]:
        rid = next(r["id"] for r in self.releases if r["tag_name"] == tag)
        return sorted(a["name"] for a in self.assets.values() if a["release_id"] == rid)


def _store(gh: MockGitHub) -> ReleaseArchiveStore:
    return ReleaseArchiveStore(
        REPO,
        TOKEN,
        run_id=9,
        today=date(2026, 11, 4),
        clock=FakeClock(),
        transport=httpx.MockTransport(gh.handler),
    )


def _issues(gh: MockGitHub) -> GitHubIssues:
    return GitHubIssues(REPO, TOKEN, httpx.Client(transport=httpx.MockTransport(gh.handler)))


def _csv_gz(path: Path, text: str) -> dict[str, Any]:
    raw = text.encode()
    gz = gzip.compress(raw, 9, mtime=0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gz)
    return {
        "bytes_gz": len(gz),
        "sha256_gz": hashlib.sha256(gz).hexdigest(),
        "bytes_csv": len(raw),
        "sha256_csv": hashlib.sha256(raw).hexdigest(),
    }


def _file(out: Path, target: str, text: str, header: list[str], rows: int) -> dict[str, Any]:
    rel = f"data/{target}.csv.gz"
    return {
        "view": "pubdump.v_" + target.split(".")[1],
        "target_table": target,
        "path": rel,
        "part": None,
        "columns": header,
        "order_key": [header[0]],
        "rows": rows,
        **_csv_gz(out / rel, text),
    }


def make_dump(out: Path, *, dump_id: str = "db-dump-public-2026-11", leak: bool = False) -> None:
    src = ["source_id", "archive_mode", "publish_site"]
    ser = ["series_id", "source_id"]
    obs = ["series_id", "value"]
    obs_rows = "s_pub,1.5\n" + (f"s_wh,{SECRET_VALUE}\n" if leak else "")
    files = [
        _file(
            out,
            "ref.source",
            "source_id,archive_mode,publish_site\npub,public,public\nwh,public,withheld\n",
            src,
            2,
        ),
        _file(out, "ref.series", "series_id,source_id\ns_pub,pub\ns_wh,wh\n", ser, 2),
        _file(out, "curated.observation", "series_id,value\n" + obs_rows, obs, 2 if leak else 1),
    ]
    schema = b"-- migration 1 x sha256 00\nSELECT 1;\n"
    (out / "schema.sql").write_bytes(schema)
    manifest = {
        "format_version": "1.0",
        "dump_id": dump_id,
        "created_at": "2026-11-04T12:00:00.000000+00:00",
        "ingest_run_id": 5,
        "git_sha": "abc",
        "code_version": "0.1",
        "snapshot": {
            "isolation": "repeatable read",
            "database_clock": "2026-11-04T12:00:00.000000+00:00",
            "max_loaded_at": None,
        },
        "partition": "P-public",
        "schema": {
            "path": "schema.sql",
            "sha256": hashlib.sha256(schema).hexdigest(),
            "bytes": len(schema),
            "schema_version": 1,
            "migrations": [{"version": 1, "name": "x", "sha256": "0" * 64}],
        },
        "files": files,
        "load_order": ["ref.source", "ref.series", "curated.observation"],
        "sequences": [],
        "trigger_tables": [],
        "sources": {
            "included": ["pub"],
            "excluded": [{"source_id": "wh", "reason": "publish_site"}],
        },
        "totals": {
            "files": len(files),
            "rows": sum(f["rows"] for f in files),
            "bytes_gz": sum(f["bytes_gz"] for f in files),
        },
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


EXPECTED = sorted(
    [
        "manifest.json",
        "schema.sql",
        "data__ref.source.csv.gz",
        "data__ref.series.csv.gz",
        "data__curated.observation.csv.gz",
    ]
)


def test_publishes_exactly_manifest_files_plus_manifest(tmp_path: Path) -> None:
    make_dump(tmp_path)
    gh = MockGitHub()
    tag = _store(gh).publish_dump(tmp_path)
    assert tag == "db-dump-public-2026-11"
    assert gh.published() == [tag]
    assert gh.asset_names(tag) == EXPECTED  # AC-DUMP-10
    uploads = [p for m, p in gh.log if m == "POST" and p.endswith("/assets")]
    assert len(uploads) == len(EXPECTED)
    # draft first, publish (PATCH) last
    assert gh.log[-1][0] == "PATCH"


def test_suffix_when_release_tag_exists(tmp_path: Path) -> None:
    make_dump(tmp_path)
    gh = MockGitHub()
    gh.releases.append({"id": 1, "tag_name": "db-dump-public-2026-11", "draft": False})
    tag = _store(gh).publish_dump(tmp_path)
    assert tag == "db-dump-public-2026-11-r9"
    assert gh.published() == ["db-dump-public-2026-11", tag]
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["dump_id"] == tag  # dump_id equals the release tag


def test_suffix_when_only_git_tag_exists(tmp_path: Path) -> None:
    make_dump(tmp_path)
    gh = MockGitHub()
    gh.git_tags.add("db-dump-public-2026-11")
    assert _store(gh).publish_dump(tmp_path) == "db-dump-public-2026-11-r9"


def test_suffixed_tag_taken_refuses(tmp_path: Path) -> None:
    make_dump(tmp_path)
    gh = MockGitHub()
    gh.releases += [
        {"id": 1, "tag_name": "db-dump-public-2026-11", "draft": False},
        {"id": 2, "tag_name": "db-dump-public-2026-11-r9", "draft": True},
    ]
    with pytest.raises(ReleaseArchiveError, match="already exists"):
        _store(gh).publish_dump(tmp_path)
    assert gh.published() == ["db-dump-public-2026-11"]


def test_self_check_failure_makes_no_api_call_and_opens_issue(tmp_path: Path) -> None:
    # AC-DUMP-3: leaked withheld observation -> no release API call at all
    make_dump(tmp_path, leak=True)
    gh = MockGitHub()
    with pytest.raises(DumpSelfCheckError):
        publish_dump_or_alert(tmp_path, _store(gh), _issues(gh), RUN_URL)
    release_calls = [p for _, p in gh.log if "/releases" in p or "/git/" in p]
    assert release_calls == []
    assert gh.published() == []
    assert gh.releases == []
    assert gh.assets == {}
    assert len(gh.issues) == 1
    issue = gh.issues[0]
    assert issue["title"] == "[pipeline] db-dump-public"
    assert issue["labels"] == ["pipeline"]
    assert RUN_URL in issue["body"]
    assert SECRET_VALUE not in json.dumps(issue)


def test_self_check_failure_without_issue_client_still_raises(tmp_path: Path) -> None:
    make_dump(tmp_path, leak=True)
    gh = MockGitHub()
    with pytest.raises(DumpSelfCheckError):
        publish_dump_or_alert(tmp_path, _store(gh), None, RUN_URL)
    assert gh.log == []


def test_upload_failure_deletes_draft_and_publishes_nothing(tmp_path: Path) -> None:
    make_dump(tmp_path)
    gh = MockGitHub()
    gh.fail_upload_name = "data__ref.series.csv.gz"
    with pytest.raises(ReleaseArchiveError):
        _store(gh).publish_dump(tmp_path)
    assert gh.published() == []
    assert gh.releases == []  # draft removed


def test_asset_list_mismatch_blocks_publish(tmp_path: Path) -> None:
    make_dump(tmp_path)
    gh = MockGitHub()
    orig = gh.handler

    def handler(req: httpx.Request) -> httpx.Response:
        resp = orig(req)
        if (
            req.method == "GET"
            and req.url.path.endswith("/assets")
            and "issues" not in req.url.path
        ):
            return httpx.Response(200, json=resp.json()[:-1])  # one asset missing
        return resp

    store = ReleaseArchiveStore(
        REPO, TOKEN, run_id=9, today=date(2026, 11, 4), clock=FakeClock(),
        transport=httpx.MockTransport(handler),
    )  # fmt: skip
    with pytest.raises(ReleaseArchiveError, match="asset list"):
        store.publish_dump(tmp_path)
    assert gh.published() == []


def test_token_not_in_error_text(tmp_path: Path) -> None:
    make_dump(tmp_path)
    gh = MockGitHub()
    gh.fail_upload_name = "schema.sql"
    with pytest.raises(ReleaseArchiveError) as ei:
        _store(gh).publish_dump(tmp_path)
    assert TOKEN not in str(ei.value)
