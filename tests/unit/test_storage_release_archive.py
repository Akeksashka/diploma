"""T45 unit tests: ``release_public`` backend against a mock GitHub API (no network)."""

from __future__ import annotations

import json
import os
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest

from macro_monitor.ingestion.archive import (
    BytesCorruptError,
    BytesMissingError,
    StorageRef,
    decompress,
    sha256_hex,
)
from macro_monitor.storage.release_archive import (
    MANIFEST_NAME,
    ReleaseArchiveError,
    ReleaseArchiveStore,
    release_store_from_env,
    release_tag,
    upload_name,
)

pytestmark = pytest.mark.unit

REPO = "acme/raw"
TOKEN = "tok-SECRET-123"
TODAY = date(2026, 11, 4)


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += max(0.0, seconds)

    def wall(self) -> datetime:
        return datetime(2026, 11, 4, 12, 0, tzinfo=UTC) + timedelta(seconds=self.t)


class MockGitHub:
    def __init__(self) -> None:
        self.releases: list[dict[str, Any]] = []
        self.assets: dict[int, dict[str, Any]] = {}  # id -> {name, release_id, data}
        self.next_id = 100
        self.log: list[tuple[str, str]] = []
        self.auth_seen: list[tuple[str, str | None]] = []
        self.draft_download_works = True
        self.fail_next: list[int] = []

    def _new_id(self) -> int:
        self.next_id += 1
        return self.next_id

    def add_release(self, tag: str, draft: bool) -> dict[str, Any]:
        rel = {"id": self._new_id(), "tag_name": tag, "draft": draft}
        self.releases.append(rel)
        return rel

    def release_assets(self, rid: int) -> list[dict[str, Any]]:
        return [a for a in self.assets.values() if a["release_id"] == rid]

    def by_tag(self, tag: str) -> dict[str, Any]:
        return next(r for r in self.releases if r["tag_name"] == tag)

    def names(self, tag: str) -> list[str]:
        return sorted(a["name"] for a in self.release_assets(self.by_tag(tag)["id"]))

    def handler(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        self.log.append((req.method, f"{req.url.host}{path}"))
        self.auth_seen.append((req.url.host, req.headers.get("authorization")))
        if self.fail_next:
            return httpx.Response(self.fail_next.pop(0), headers={"Retry-After": "7"})
        pre = f"/repos/{REPO}/releases"
        q = req.url.params
        if req.url.host == "objects.example.test":
            return httpx.Response(200, content=self.assets[int(path.rsplit("/", 1)[1])]["data"])
        if req.method == "POST" and path == pre:
            body = json.loads(req.content)
            if any(r["tag_name"] == body["tag_name"] for r in self.releases):
                return httpx.Response(422, json={"message": "already_exists"})
            return httpx.Response(201, json=self.add_release(body["tag_name"], body["draft"]))
        if req.method == "GET" and path == pre:
            return self._page(self.releases, q)
        if req.method == "GET" and path.startswith(pre + "/tags/"):
            tag = path.removeprefix(pre + "/tags/")
            rel = next((r for r in self.releases if r["tag_name"] == tag and not r["draft"]), None)
            return httpx.Response(200, json=rel) if rel else httpx.Response(404)
        if req.method == "PATCH" and path.startswith(pre + "/"):
            rel = next(r for r in self.releases if r["id"] == int(path.rsplit("/", 1)[1]))
            rel["draft"] = json.loads(req.content)["draft"]
            return httpx.Response(200, json=rel)
        if req.method == "GET" and path.endswith("/assets") and path.startswith(pre):
            rid = int(path.split("/")[-2])
            rows = [{"id": a["id"], "name": a["name"]} for a in self.release_assets(rid)]
            return self._page(rows, q)
        if req.method == "POST" and path.endswith("/assets"):
            rid = int(path.split("/")[-2])
            rel = next(r for r in self.releases if r["id"] == rid)
            name = q["name"]
            if not rel["draft"]:
                return httpx.Response(422, json={"message": "immutable release"})
            if any(a["name"] == name for a in self.release_assets(rid)):
                return httpx.Response(422, json={"message": "already_exists"})
            aid = self._new_id()
            self.assets[aid] = {"id": aid, "name": name, "release_id": rid, "data": req.content}
            return httpx.Response(201, json={"id": aid, "name": name})
        if req.method == "GET" and "/releases/assets/" in path:
            asset = self.assets[int(path.rsplit("/", 1)[1])]
            rel = next(r for r in self.releases if r["id"] == asset["release_id"])
            if rel["draft"]:
                if not self.draft_download_works:
                    return httpx.Response(404)
                return httpx.Response(200, content=asset["data"])
            return httpx.Response(
                302, headers={"Location": f"https://objects.example.test/a/{asset['id']}"}
            )
        return httpx.Response(500, text=f"unrouted {req.method} {path}")

    @staticmethod
    def _page(rows: list[dict[str, Any]], q: httpx.QueryParams) -> httpx.Response:
        per, page = int(q["per_page"]), int(q["page"])
        return httpx.Response(200, json=rows[(page - 1) * per : page * per])


def make(
    gh: MockGitHub, clock: FakeClock | None = None, run_id: int = 7, **kw: Any
) -> ReleaseArchiveStore:
    return ReleaseArchiveStore(
        REPO,
        TOKEN,
        run_id=run_id,
        today=TODAY,
        clock=clock or FakeClock(),
        transport=httpx.MockTransport(gh.handler),
        **kw,
    )


def blob(i: int, size: int = 2000) -> tuple[str, bytes]:
    data = (f"payload-{i}-".encode() * (size // 8 + 1))[:size]
    return sha256_hex(data), data


def big(i: int) -> tuple[str, bytes]:
    data = os.urandom(300 * 1024) + str(i).encode()
    return sha256_hex(data), data


def test_tag_names() -> None:
    assert release_tag(TODAY, 7) == "raw-2026-11-04-r7"
    assert release_tag(TODAY, 7, 3) == "raw-2026-11-04-r7-p3"
    assert upload_name("src/ab-x.json.zst") == "src__ab-x.json.zst"


def test_open_creates_draft_and_is_idempotent() -> None:
    gh = MockGitHub()
    s = make(gh)
    assert s.open() == "raw-2026-11-04-r7"
    assert s.open() == "raw-2026-11-04-r7"
    assert [r["draft"] for r in gh.releases] == [True]
    s2 = make(gh)  # re-run with the same run id re-attaches
    s2.open()
    assert len(gh.releases) == 1


def test_large_blob_uploaded_as_zst_asset_and_roundtrips() -> None:
    gh = MockGitHub()
    s = make(gh)
    sha, data = big(1)
    ref = s.put(sha, data, f"src/{sha[:16]}-x.bin")
    assert ref == StorageRef(asset=f"src/{sha[:16]}-x.bin.zst", release_tag="raw-2026-11-04-r7")
    assert gh.names(ref.release_tag or "") == [f"src__{sha[:16]}-x.bin.zst"]
    stored = gh.release_assets(gh.by_tag("raw-2026-11-04-r7")["id"])[0]["data"]
    assert decompress(stored) == data
    assert s.put(sha, data, f"src/{sha[:16]}-x.bin") == ref  # idempotent, no second upload
    assert s.upload_count == 1
    assert s.exists(sha)
    assert s.get(ref) == data  # draft download through the API


def test_small_blobs_bundled_one_asset_per_source_and_run() -> None:
    gh = MockGitHub()
    s = make(gh)
    refs = {}
    for i in range(5):
        sha, data = blob(i)
        refs[sha] = (s.put(sha, data, f"a/{sha[:16]}-x.json"), data)
    sha, data = blob(99)
    other = s.put(sha, data, f"b/{sha[:16]}-x.json")
    assert gh.assets == {}  # nothing uploaded before flush
    # unflushed bundle members are readable (fallback path)
    ref0, d0 = next(iter(refs.values()))
    assert s.get(ref0) == d0
    s.finalize()
    names = gh.names("raw-2026-11-04-r7")
    assert names == ["a__bundle-r7-1.tar.zst", "b__bundle-r7-1.tar.zst", MANIFEST_NAME]
    assert other.asset.startswith("b/bundle-r7-1.tar.zst#")
    for ref, d in refs.values():
        assert s.get(ref) == d  # via published asset + redirect
    assert s.upload_count == 3


def test_corrupt_bundle_member_and_missing() -> None:
    gh = MockGitHub()
    s = make(gh)
    sha, data = blob(1)
    ref = s.put(sha, data, f"a/{sha[:16]}-x.json")
    s.finalize()
    with pytest.raises(BytesMissingError):
        s.get(
            StorageRef(asset=ref.asset.split("#")[0] + "#" + "0" * 64, release_tag=ref.release_tag)
        )
    aid = next(a["id"] for a in gh.assets.values() if a["name"].startswith("a__bundle"))
    gh.assets[aid]["data"] = b"not zstd"
    with pytest.raises(BytesCorruptError):
        s.get(ref)


def test_single_asset_corruption_detected() -> None:
    gh = MockGitHub()
    s = make(gh)
    sha, data = big(2)
    ref = s.put(sha, data, f"src/{sha[:16]}-x.bin")
    other = big(3)[1]
    aid = next(iter(gh.assets))
    from macro_monitor.ingestion.archive import compress

    gh.assets[aid]["data"] = compress(other)
    with pytest.raises(BytesCorruptError):
        s.get(ref)


def test_draft_download_unavailable_falls_back_to_memory_then_missing() -> None:
    gh = MockGitHub()
    gh.draft_download_works = False
    s = make(gh)
    sha, data = big(4)
    ref = s.put(sha, data, f"src/{sha[:16]}-x.bin")
    assert s.get(ref) == data  # BB18 fallback
    fresh = make(gh)  # another process: no memory, draft not downloadable
    with pytest.raises(BytesMissingError):
        fresh.get(ref)


def test_continuation_release_at_asset_cap_and_manifest_lists_parts() -> None:
    gh = MockGitHub()
    s = make(gh, asset_cap=3)
    refs = []
    for i in range(5):
        sha, data = big(i)
        refs.append(s.put(sha, data, f"src/{sha[:16]}-x.bin"))
    assert [r.release_tag for r in refs] == [
        "raw-2026-11-04-r7",
        "raw-2026-11-04-r7",
        "raw-2026-11-04-r7",
        "raw-2026-11-04-r7-p2",
        "raw-2026-11-04-r7-p2",
    ]
    published = s.finalize()
    assert published == ["raw-2026-11-04-r7", "raw-2026-11-04-r7-p2"]
    assert all(not r["draft"] for r in gh.releases)
    for tag in published:
        man = [a for a in gh.release_assets(gh.by_tag(tag)["id"]) if a["name"] == MANIFEST_NAME]
        head = json.loads(man[0]["data"].splitlines()[0])
        assert head["parts"] == published


def test_cap_at_default_900_counts_bundle_reservations() -> None:
    gh = MockGitHub()
    s = make(gh, asset_cap=2)
    tags = set()
    for src in ("a", "b", "c"):
        sha, data = blob(ord(src))
        tags.add(s.put(sha, data, f"{src}/{sha[:16]}-x.json").release_tag)
    assert tags == {"raw-2026-11-04-r7", "raw-2026-11-04-r7-p2"}
    s.finalize()
    for r in gh.releases:
        assert len(gh.release_assets(r["id"])) <= 3  # cap + manifest


def test_upload_throttle_600_per_hour_sleeps() -> None:
    gh = MockGitHub()
    clock = FakeClock()
    s = make(gh, clock, uploads_per_hour=3, asset_cap=10_000, bundle_threshold=1)
    for i in range(4):
        sha, data = blob(i, 300)
        s.put(sha, data, f"src/{sha[:16]}-x.json")
    assert clock.sleeps == [3600.0]  # the 4th upload waited for the window
    assert s.upload_count == 4


def test_default_limits_are_the_adr_values() -> None:
    from macro_monitor.storage import release_archive as ra

    assert (ra.ASSET_CAP, ra.UPLOADS_PER_HOUR, ra.BUNDLE_THRESHOLD) == (900, 600, 256 * 1024)


def test_blob_reuse_only_from_published_release() -> None:
    gh = MockGitHub()
    gh.add_release("raw-2026-10-01-r1", draft=False)
    gh.add_release("raw-2026-10-02-r2", draft=True)
    s = make(gh)
    assert s.blob_reusable(StorageRef("a/x.zst", "raw-2026-10-01-r1"))
    assert not s.blob_reusable(StorageRef("a/x.zst", "raw-2026-10-02-r2"))
    assert not s.blob_reusable(StorageRef("a/x.zst", "raw-2026-09-01-r0"))  # unknown
    sha, data = big(5)
    ref = s.put(sha, data, f"src/{sha[:16]}-x.bin")
    assert not s.blob_reusable(ref)  # own draft
    s.finalize()
    assert s.blob_reusable(ref)  # published now


def test_finalize_publishes_orphan_drafts_and_published_is_immutable() -> None:
    gh = MockGitHub()
    gh.add_release("raw-2026-10-20-r3", draft=True)  # crashed run
    gh.add_release("other-thing", draft=True)  # not ours
    s = make(gh)
    sha, data = big(6)
    s.put(sha, data, f"src/{sha[:16]}-x.bin")
    published = s.finalize()
    assert published == ["raw-2026-10-20-r3", "raw-2026-11-04-r7"]
    assert gh.by_tag("other-thing")["draft"] is True
    # published releases reject new assets (immutability), through the store as well
    s2 = make(gh)
    with pytest.raises(ReleaseArchiveError):
        s2.open()  # already published, cannot be re-attached
    rid = gh.by_tag("raw-2026-11-04-r7")["id"]
    resp = httpx.Client(transport=httpx.MockTransport(gh.handler)).post(
        f"https://uploads.github.com/repos/{REPO}/releases/{rid}/assets?name=x", content=b"x"
    )
    assert resp.status_code == 422


def test_manifest_jsonl_content_and_routing() -> None:
    gh = MockGitHub()
    s = make(gh)
    s.add_manifest_line(None)
    s.add_manifest_line({"sha256": "a" * 64, "release_tag": "raw-2026-11-04-r7", "raw_id": 1})
    s.add_manifest_line(
        {"sha256": "b" * 64, "release_tag": "raw-2020-01-01-r1", "blob_reused": True}
    )
    s.finalize()
    man = next(a for a in gh.assets.values() if a["name"] == MANIFEST_NAME)["data"].decode()
    rows = [json.loads(x) for x in man.splitlines()]
    assert rows[0]["kind"] == "release"
    assert rows[0]["parts"] == ["raw-2026-11-04-r7"]
    assert [r["sha256"][0] for r in rows[1:]] == ["a", "b"]


def test_rerun_reattaches_and_skips_already_uploaded_assets() -> None:
    gh = MockGitHub()
    s = make(gh)
    sha, data = big(7)
    s.put(sha, data, f"src/{sha[:16]}-x.bin")
    s2 = make(gh)  # crashed run retried: same draft, same blob
    s2.put(sha, data, f"src/{sha[:16]}-x.bin")
    assert s2.upload_count == 0
    assert len(gh.assets) == 1


def test_request_counting_and_retry_after() -> None:
    gh = MockGitHub()
    clock = FakeClock()
    s = make(gh, clock)
    gh.fail_next = [503]
    s.open()
    assert clock.sleeps == [7.0]
    assert s.stats()["github_requests"] == s.request_count == len(gh.log)
    assert s.stats()["release_parts"] == 1


def test_token_never_in_errors_and_not_sent_to_redirect_host() -> None:
    gh = MockGitHub()

    def boom(req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text=f"echo {TOKEN}")

    s = ReleaseArchiveStore(
        REPO, TOKEN, run_id=1, today=TODAY, clock=FakeClock(), transport=httpx.MockTransport(boom)
    )
    with pytest.raises(ReleaseArchiveError) as ei:
        s.open()
    assert TOKEN not in str(ei.value)

    s = make(gh)
    sha, data = big(8)
    ref = s.put(sha, data, f"src/{sha[:16]}-x.bin")
    s.finalize()
    s.get(ref)
    assert all(a is None for h, a in gh.auth_seen if h == "objects.example.test")
    assert any(a for h, a in gh.auth_seen if h == "api.github.com")


def test_constructor_and_env_validation() -> None:
    with pytest.raises(ValueError, match="owner/name"):
        ReleaseArchiveStore("bad", TOKEN, run_id=1, today=TODAY)
    with pytest.raises(ReleaseArchiveError):
        ReleaseArchiveStore(REPO, "", run_id=1, today=TODAY)
    with pytest.raises(ReleaseArchiveError):
        ReleaseArchiveStore(REPO, TOKEN, run_id=1, today=TODAY, api_url="http://x.test")
    with pytest.raises(ReleaseArchiveError):
        release_store_from_env({}, run_id=1)
    st = release_store_from_env({"GITHUB_TOKEN": "t", "GITHUB_REPOSITORY": REPO}, run_id=1)
    assert st.backend_id == "release_public"
    st.close()


@pytest.mark.network
def test_ac_ops_5_publish_then_modify_fails() -> None:  # pragma: no cover - operator run
    """AC-OPS-5: needs OP-01 (immutable releases enabled), a token and a scratch repository."""
    repo = os.environ.get("MM_IMMUTABILITY_TEST_REPO")
    token = os.environ.get("GITHUB_TOKEN")
    if os.environ.get("MM_ALLOW_NETWORK") != "1" or not repo or not token:
        pytest.skip("needs MM_ALLOW_NETWORK=1, MM_IMMUTABILITY_TEST_REPO and GITHUB_TOKEN")
    run_id = int(datetime.now(UTC).timestamp())
    with ReleaseArchiveStore(repo, token, run_id=run_id, today=datetime.now(UTC).date()) as s:
        sha, data = big(run_id % 1000)
        ref = s.put(sha, data, f"probe/{sha[:16]}-x.bin")
        tag = s.finalize()[-1]
        assert s.get(ref) == data
        client = httpx.Client(headers={"Authorization": f"Bearer {token}"})
        rel = client.get(f"https://api.github.com/repos/{repo}/releases/tags/{tag}").json()
        resp = client.post(
            f"https://uploads.github.com/repos/{repo}/releases/{rel['id']}/assets",
            params={"name": "late.bin"},
            content=b"late",
        )
        assert resp.status_code >= 400
