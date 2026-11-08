"""``release_public`` RawStore backend on GitHub Releases (ADR-003, task T45).

Behaviours (ADR-003 "Release layout" and "Release limits"):

* one draft release per run, ``raw-<YYYY-MM-DD>-r<run_id>``; ``open`` (``plan``) creates or
  re-attaches to it, ``finalize`` publishes it (immutable) after orphan drafts of crashed runs;
* assets ``<source_id>/<sha256[:16]>-<basename>.zst`` (zstd of the uncompressed bytes). GitHub
  asset names cannot contain ``/``; the upload name replaces it with ``__`` (UNVERIFIED how GitHub
  would sanitise it itself, so we do it explicitly and deterministically);
* blobs below ``BUNDLE_THRESHOLD`` (256 KB, user to confirm) are bundled into one ``tar.zst`` per
  source, part and run; the member name is the full sha256, the ref is ``<asset>#<sha256>``;
* at ``ASSET_CAP`` (900) assets a continuation draft ``<tag>-p<N>`` is opened; all parts are
  published by ``finalize`` and every part's ``manifest.jsonl`` lists every part;
* at most ``UPLOADS_PER_HOUR`` (600) uploads per sliding hour (sleeps on the injected clock);
* a blob already recorded in ``ingest.raw_blob`` is reusable only when ``blob_reusable`` says its
  release is PUBLISHED; a draft location is not durable (the caller then calls ``put`` again);
* every request is counted (``request_count``) for ``ops.run_summary``.

Own small httpx client rather than ``HttpClient``: that client is GET-only and bound to a
per-source host allow-list and request budget, so it cannot POST an upload body. The shared
``Redactor``, ``Clock`` and ``parse_retry_after`` are reused. The token is never logged.
"""

from __future__ import annotations

import io
import json
import logging
import re
import tarfile
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from macro_monitor import __version__
from macro_monitor.ingestion.archive import (
    BackendId,
    BytesCorruptError,
    BytesMissingError,
    RawStoreError,
    StorageRef,
    _check_sha,
    _check_source_id,
    compress,
    decompress,
    sha256_hex,
)
from macro_monitor.ingestion.http import Redactor, parse_retry_after
from macro_monitor.ingestion.ratelimit import Clock, SystemClock
from macro_monitor.monitoring.issues import Finding, GitHubIssues, sync_issues
from macro_monitor.storage.dump_check import DumpSelfCheckError, assert_dump_ok

log = logging.getLogger(__name__)

API_URL = "https://api.github.com"
UPLOAD_URL = "https://uploads.github.com"
BUNDLE_THRESHOLD = 256 * 1024
BUNDLE_MAX_BYTES = 32 * 1024 * 1024
ASSET_CAP = 900
UPLOADS_PER_HOUR = 600
WINDOW_S = 3600.0
MAX_ATTEMPTS = 4
MAX_TOTAL_WAIT_S = 600.0
PER_PAGE = 100
MANIFEST_NAME = "manifest.jsonl"
RELEASE_TAG_PREFIX = "raw-"
BUNDLE_SEP = "#"
DUMP_TAG_PREFIX = "db-dump-public-"
DUMP_MANIFEST = "manifest.json"
DUMP_SCHEMA = "schema.sql"
_DUMP_SUFFIX = re.compile(r"-r[0-9]+$")


class ReleaseArchiveError(RawStoreError):
    """GitHub API failure (messages are redacted)."""


def release_tag(today: date, run_id: int, part: int = 1) -> str:
    base = f"raw-{today.isoformat()}-r{run_id}"
    return base if part == 1 else f"{base}-p{part}"


def upload_name(asset: str) -> str:
    """Name used on GitHub for logical asset ``<source_id>/<name>``."""
    return asset.replace("/", "__")


@dataclass
class _Part:
    tag: str
    release_id: int
    published: bool = False
    assets: dict[str, int] = field(default_factory=dict)  # upload name -> asset id
    count: int = 0  # uploaded + reserved (bundles)


@dataclass
class _Bundle:
    part_tag: str
    asset: str  # logical, e.g. "src/bundle-r12-1.tar.zst"
    members: dict[str, bytes] = field(default_factory=dict)
    size: int = 0


class ReleaseArchiveStore:
    """RawStore backend ``release_public`` (protocol: ``put`` / ``get`` / ``exists``)."""

    backend_id: BackendId = "release_public"

    def __init__(
        self,
        repo: str,
        token: str,
        *,
        run_id: int,
        today: date,
        clock: Clock | None = None,
        transport: httpx.BaseTransport | None = None,
        api_url: str = API_URL,
        upload_url: str = UPLOAD_URL,
        repo_url: str | None = None,
        asset_cap: int = ASSET_CAP,
        uploads_per_hour: int = UPLOADS_PER_HOUR,
        bundle_threshold: int = BUNDLE_THRESHOLD,
    ) -> None:
        if repo.count("/") != 1 or not all(repo.split("/")):
            raise ValueError("repo must be 'owner/name'")
        if not token:
            raise ReleaseArchiveError("GITHUB_TOKEN is empty")
        if not (api_url.startswith("https://") and upload_url.startswith("https://")):
            raise ReleaseArchiveError("TLS is always on: GitHub URLs must be https")
        self.repo = repo
        self.run_id = run_id
        self.today = today
        self.clock: Clock = clock or SystemClock()
        self.api_url = api_url.rstrip("/")
        self.upload_url = upload_url.rstrip("/")
        self.asset_cap = asset_cap
        self.uploads_per_hour = uploads_per_hour
        self.bundle_threshold = bundle_threshold
        self._redactor = Redactor([token])
        self._client = httpx.Client(
            transport=transport,
            timeout=60.0,
            follow_redirects=True,  # httpx drops Authorization on cross-origin redirects
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": f"macro-monitor/{__version__} ({repo_url or repo})",
            },
        )
        self.request_count = 0
        self.upload_count = 0
        self._upload_times: deque[float] = deque()
        self._parts: list[_Part] = []
        self._refs: dict[str, StorageRef] = {}  # sha256 -> ref, this run only
        self._mem: dict[str, bytes] = {}  # sha256 -> bytes (draft-download fallback, BB18)
        self._bundles: dict[tuple[str, str], list[_Bundle]] = {}
        self._manifest: list[Mapping[str, object]] = []
        self._published_cache: dict[str, bool] = {}

    # ------------------------------------------------------------------ lifecycle

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> ReleaseArchiveStore:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def tags(self) -> list[str]:
        return [p.tag for p in self._parts]

    def stats(self) -> dict[str, int]:
        """Request counts for ``ops.run_summary``."""
        return {
            "github_requests": self.request_count,
            "github_uploads": self.upload_count,
            "release_parts": len(self._parts),
        }

    def open(self) -> str:
        """``plan``: open (or re-attach to) the run's draft release; returns its tag."""
        if not self._parts:
            self._open_part(1)
        return self._parts[0].tag

    def add_manifest_line(self, line: Mapping[str, object] | None) -> None:
        """Collect a ``RecordOutcome.manifest_line`` for ``manifest.jsonl``."""
        if line is not None:
            self._manifest.append(line)

    # ------------------------------------------------------------------ RawStore

    def put(self, sha256: str, data: bytes, name: str) -> StorageRef:
        _check_sha(sha256)
        if sha256_hex(data) != sha256:
            raise ValueError("sha256 does not match the bytes passed to put")
        source_id = _check_source_id(name.split("/", 1)[0])
        known = self._refs.get(sha256)
        if known is not None:
            return known
        part = self._current_part()
        if len(data) < self.bundle_threshold:
            ref = self._bundle_put(part, source_id, sha256, data)
        else:
            asset = f"{name}.zst"
            if part.count >= self.asset_cap:
                part = self._open_part(len(self._parts) + 1)
            self._upload(part, asset, compress(data))
            ref = StorageRef(asset=asset, release_tag=part.tag)
        self._refs[sha256] = ref
        self._mem[sha256] = data
        return ref

    def get(self, ref: StorageRef) -> bytes:
        if ref.release_tag is None:
            raise ValueError("release_public references carry a release_tag")
        asset, _, member = ref.asset.partition(BUNDLE_SEP)
        blob = self._download(ref.release_tag, asset)
        if blob is None:
            return self._from_memory(ref)
        if member:
            return self._read_member(blob, member)
        data = decompress(blob)
        prefix = asset.rsplit("/", 1)[-1].split("-", 1)[0]
        if not sha256_hex(data).startswith(prefix):
            raise BytesCorruptError(f"bytes_corrupt: {ref.asset} does not match its sha256")
        return data

    def exists(self, sha256: str) -> bool:
        """True when this run stored the blob (cross-run knowledge lives in ``ingest.raw_blob``)."""
        return _check_sha(sha256) in self._refs

    # ------------------------------------------------------------------ reuse rule

    def blob_reusable(self, ref: StorageRef) -> bool:
        """ADR-003 round 3: reuse a stored blob only if its release is PUBLISHED."""
        tag = ref.release_tag
        if tag is None:
            return False
        for p in self._parts:
            if p.tag == tag:
                return p.published
        cached = self._published_cache.get(tag)
        if cached is not None:
            return cached
        resp = self._request("GET", f"/repos/{self.repo}/releases/tags/{quote(tag, safe='')}")
        if resp.status_code == 404:  # drafts are not served by the tag endpoint
            ok = False
        elif resp.status_code == 200:
            ok = not bool(resp.json().get("draft", False))
        else:
            raise self._error("release lookup", resp)
        if ok:
            self._published_cache[tag] = True
        return ok

    # ------------------------------------------------------------------ finalize

    def finalize(self) -> list[str]:
        """Flush bundles, upload ``manifest.jsonl`` per part, publish orphans then own parts."""
        self.open()
        published: list[str] = []
        own = {p.tag for p in self._parts}
        for orphan in self._orphan_drafts(own):
            self._publish(orphan)
            published.append(str(orphan["tag_name"]))
        self._flush_bundles()
        tags = [p.tag for p in self._parts]
        for part in self._parts:
            if part.published:
                continue
            self._upload_manifest(part, tags)
        for part in self._parts:
            if not part.published:
                self._publish({"id": part.release_id, "tag_name": part.tag})
                part.published = True
                self._published_cache[part.tag] = True
                published.append(part.tag)
        return published

    # ------------------------------------------------------------------ public dump (T72)

    def publish_dump(self, out_dir: Path) -> str:
        """Publish the public dump in ``out_dir`` as ``db-dump-public-<YYYY-MM>[-r<run_id>]``.

        Runs ``assert_dump_ok`` first (``DumpSelfCheckError`` propagates and NO request is made),
        then draft -> upload exactly the manifest files, ``schema.sql`` and ``manifest.json`` ->
        verify the draft's asset list -> publish. On any failure the draft is deleted (best
        effort) and nothing is published. Returns the tag.
        """
        assert_dump_ok(out_dir)
        manifest: dict[str, Any] = json.loads((out_dir / DUMP_MANIFEST).read_text("utf-8"))
        base = _DUMP_SUFFIX.sub("", str(manifest["dump_id"]))
        tag = base if not self._tag_exists(base) else f"{base}-r{self.run_id}"
        if tag != base and self._tag_exists(tag):
            raise ReleaseArchiveError(f"dump tag {tag} already exists; refusing to reuse it")
        if manifest["dump_id"] != tag:  # dump_id must equal the release tag (spec section 3)
            manifest["dump_id"] = tag
            (out_dir / DUMP_MANIFEST).write_text(
                json.dumps(manifest, sort_keys=True, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            assert_dump_ok(out_dir)
        paths = [str(manifest["schema"]["path"])] + [str(f["path"]) for f in manifest["files"]]
        paths.append(DUMP_MANIFEST)
        if len(paths) != len(set(paths)):
            raise ReleaseArchiveError("dump manifest lists a file twice")
        if len(paths) > self.asset_cap:
            raise ReleaseArchiveError(f"dump has {len(paths)} assets; cap is {self.asset_cap}")
        resp = self._request(
            "POST",
            f"/repos/{self.repo}/releases",
            json={
                "tag_name": tag,
                "name": tag,
                "draft": True,
                "body": f"Public database dump (run {self.run_id}); see manifest.json.",
            },
        )
        if resp.status_code != 201:
            raise self._error("create dump draft release", resp)
        part = _Part(tag=tag, release_id=int(resp.json()["id"]))
        try:
            for rel in paths:  # manifest.json last
                self._upload(part, rel, (out_dir / rel).read_bytes())
            got = sorted(str(a["name"]) for a in self._list_assets(part.release_id))
            if got != sorted(upload_name(x) for x in paths):
                raise ReleaseArchiveError(f"dump draft {tag} asset list differs from the manifest")
            self._publish({"id": part.release_id, "tag_name": tag})
        except BaseException:
            self._discard_draft(part.release_id)
            raise
        part.published = True
        self._parts.append(part)
        self._published_cache[tag] = True
        return tag

    def _tag_exists(self, tag: str) -> bool:
        """True if a release (draft or published) or a git tag of that name exists."""
        if any(r.get("tag_name") == tag for r in self._list_releases()):
            return True
        resp = self._request("GET", f"/repos/{self.repo}/git/ref/tags/{quote(tag, safe='')}")
        if resp.status_code == 404:
            return False
        if resp.status_code == 200:
            return True
        raise self._error("git tag lookup", resp)

    def _discard_draft(self, release_id: int) -> None:
        try:
            self._request("DELETE", f"/repos/{self.repo}/releases/{release_id}")
        except ReleaseArchiveError:
            log.warning("could not delete the dump draft release %s", release_id)

    # ------------------------------------------------------------------ parts / assets

    def _current_part(self) -> _Part:
        if not self._parts:
            self._open_part(1)
        part = self._parts[-1]
        if part.count >= self.asset_cap:
            part = self._open_part(len(self._parts) + 1)
        return part

    def _open_part(self, n: int) -> _Part:
        tag = release_tag(self.today, self.run_id, n)
        existing = next((r for r in self._list_releases() if r.get("tag_name") == tag), None)
        if existing is not None:
            if not existing.get("draft", False):
                raise ReleaseArchiveError(f"release {tag} is already published; cannot add assets")
            rid = int(existing["id"])
        else:
            resp = self._request(
                "POST",
                f"/repos/{self.repo}/releases",
                json={
                    "tag_name": tag,
                    "name": tag,
                    "draft": True,
                    "body": f"Raw archive of macro-monitor run {self.run_id}.",
                },
            )
            if resp.status_code != 201:
                raise self._error("create draft release", resp)
            rid = int(resp.json()["id"])
        part = _Part(tag=tag, release_id=rid)
        for a in self._list_assets(rid):
            part.assets[str(a["name"])] = int(a["id"])
        part.count = len(part.assets)
        self._parts.append(part)
        return part

    def _list_releases(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            resp = self._request(
                "GET",
                f"/repos/{self.repo}/releases",
                params={"per_page": str(PER_PAGE), "page": str(page)},
            )
            if resp.status_code != 200:
                raise self._error("list releases", resp)
            batch = resp.json()
            out.extend(batch)
            if len(batch) < PER_PAGE:
                return out
            page += 1

    def _list_assets(self, release_id: int) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            resp = self._request(
                "GET",
                f"/repos/{self.repo}/releases/{release_id}/assets",
                params={"per_page": str(PER_PAGE), "page": str(page)},
            )
            if resp.status_code != 200:
                raise self._error("list assets", resp)
            batch = resp.json()
            out.extend(batch)
            if len(batch) < PER_PAGE:
                return out
            page += 1

    def _orphan_drafts(self, own: set[str]) -> list[dict[str, Any]]:
        return [
            r
            for r in self._list_releases()
            if r.get("draft")
            and str(r.get("tag_name", "")).startswith(RELEASE_TAG_PREFIX)
            and r.get("tag_name") not in own
        ]

    def _publish(self, release: Mapping[str, Any]) -> None:
        resp = self._request(
            "PATCH", f"/repos/{self.repo}/releases/{release['id']}", json={"draft": False}
        )
        if resp.status_code != 200:
            raise self._error(f"publish {release.get('tag_name')}", resp)

    def _upload(self, part: _Part, asset: str, payload: bytes) -> None:
        name = upload_name(asset)
        if name in part.assets:  # re-attached draft already holds it (idempotent re-run)
            return
        self._throttle()
        resp = self._request(
            "POST",
            f"{self.upload_url}/repos/{self.repo}/releases/{part.release_id}/assets",
            params={"name": name},
            content=payload,
            headers={"Content-Type": "application/octet-stream"},
            upload=True,
        )
        if resp.status_code != 201:
            raise self._error(f"upload {asset}", resp)
        part.assets[name] = int(resp.json()["id"])
        part.count += 1
        self.upload_count += 1

    def _throttle(self) -> None:
        now = self.clock.monotonic()
        while self._upload_times and now - self._upload_times[0] >= WINDOW_S:
            self._upload_times.popleft()
        if len(self._upload_times) >= self.uploads_per_hour:
            wait = WINDOW_S - (now - self._upload_times[0])
            log.info("upload budget reached; sleeping %.0fs", wait)
            self.clock.sleep(wait)
            now = self.clock.monotonic()
            while self._upload_times and now - self._upload_times[0] >= WINDOW_S:
                self._upload_times.popleft()
        self._upload_times.append(now)

    # ------------------------------------------------------------------ bundling

    def _bundle_put(self, part: _Part, source_id: str, sha256: str, data: bytes) -> StorageRef:
        key = (part.tag, source_id)
        bundles = self._bundles.setdefault(key, [])
        if not bundles or bundles[-1].size + len(data) > BUNDLE_MAX_BYTES:
            if part.count >= self.asset_cap:  # the reservation needs a free slot
                part = self._open_part(len(self._parts) + 1)
                key = (part.tag, source_id)
                bundles = self._bundles.setdefault(key, [])
            n = len(bundles) + 1
            bundles.append(_Bundle(part.tag, f"{source_id}/bundle-r{self.run_id}-{n}.tar.zst"))
            part.count += 1  # reserve the slot now so the 900 cap holds
        bundle = bundles[-1]
        bundle.members[sha256] = data
        bundle.size += len(data)
        return StorageRef(asset=f"{bundle.asset}{BUNDLE_SEP}{sha256}", release_tag=bundle.part_tag)

    def _flush_bundles(self) -> None:
        for (tag, _source), bundles in sorted(self._bundles.items()):
            part = next(p for p in self._parts if p.tag == tag)
            for b in bundles:
                if not b.members or upload_name(b.asset) in part.assets:
                    continue
                part.count -= 1  # release the reservation; _upload counts the real asset
                self._upload(part, b.asset, compress(_tar(b.members)))
            bundles.clear()

    @staticmethod
    def _read_member(blob: bytes, member: str) -> bytes:
        try:
            with tarfile.open(fileobj=io.BytesIO(decompress(blob)), mode="r:") as tf:
                fh = tf.extractfile(member)
                if fh is None:
                    raise BytesMissingError(f"bundle has no member {member}")
                data = fh.read()
        except KeyError:
            raise BytesMissingError(f"bundle has no member {member}") from None
        except tarfile.TarError as exc:
            raise BytesCorruptError(f"bytes_corrupt: unreadable bundle ({exc})") from exc
        if sha256_hex(data) != member:
            raise BytesCorruptError(f"bytes_corrupt: bundle member {member} does not match")
        return data

    # ------------------------------------------------------------------ manifest.jsonl

    def _upload_manifest(self, part: _Part, tags: list[str]) -> None:
        lines: list[Mapping[str, object]] = [
            {"kind": "release", "tag": part.tag, "run_id": self.run_id, "parts": tags}
        ]
        first = tags[0]
        for line in self._manifest:
            tag = line.get("release_tag")
            target = tag if tag in tags else first
            if target == part.tag:
                lines.append(line)
        body = "".join(json.dumps(x, sort_keys=True, default=str) + "\n" for x in lines)
        self._upload(part, MANIFEST_NAME, body.encode("utf-8"))

    # ------------------------------------------------------------------ download

    def _download(self, tag: str, asset: str) -> bytes | None:
        """Bytes of a stored asset or None (BB18: draft assets may not be downloadable)."""
        name = upload_name(asset)
        asset_id = self._asset_id(tag, name)
        if asset_id is None:
            return None
        resp = self._request(
            "GET",
            f"/repos/{self.repo}/releases/assets/{asset_id}",
            headers={"Accept": "application/octet-stream"},
        )
        if resp.status_code == 200:
            return resp.content
        if resp.status_code in (403, 404):
            return None
        raise self._error(f"download {asset}", resp)

    def _asset_id(self, tag: str, name: str) -> int | None:
        for p in self._parts:
            if p.tag == tag:
                return p.assets.get(name)
        resp = self._request("GET", f"/repos/{self.repo}/releases/tags/{quote(tag, safe='')}")
        if resp.status_code == 404:
            for r in self._list_releases():
                if r.get("tag_name") == tag:
                    return self._find_asset(int(r["id"]), name)
            return None
        if resp.status_code != 200:
            raise self._error("release lookup", resp)
        return self._find_asset(int(resp.json()["id"]), name)

    def _find_asset(self, release_id: int, name: str) -> int | None:
        for a in self._list_assets(release_id):
            if a["name"] == name:
                return int(a["id"])
        return None

    def _from_memory(self, ref: StorageRef) -> bytes:
        """Documented fallback: bytes put by this process (draft not downloadable, or unflushed)."""
        _, _, member = ref.asset.partition(BUNDLE_SEP)
        sha = member or None
        if sha is None:
            prefix = ref.asset.rsplit("/", 1)[-1].split("-", 1)[0]
            sha = next((s for s in self._mem if s.startswith(prefix)), None)
        if sha is not None and sha in self._mem:
            return self._mem[sha]
        raise BytesMissingError(f"no stored object at {ref.release_tag}/{ref.asset}")

    # ------------------------------------------------------------------ HTTP

    def _request(
        self,
        method: str,
        path_or_url: str,
        *,
        params: Mapping[str, str] | None = None,
        json: object = None,
        content: bytes | None = None,
        headers: Mapping[str, str] | None = None,
        upload: bool = False,
    ) -> httpx.Response:
        url = path_or_url if path_or_url.startswith("https://") else self.api_url + path_or_url
        waited = 0.0
        resp: httpx.Response | None = None
        for attempt in range(MAX_ATTEMPTS):
            self.request_count += 1
            try:
                resp = self._client.request(
                    method, url, params=params, json=json, content=content, headers=headers
                )
            except httpx.TransportError as exc:
                if attempt == MAX_ATTEMPTS - 1:
                    raise ReleaseArchiveError(
                        self._redactor.text(f"{method} {url} failed: {exc}")
                    ) from None
                delay = 2.0**attempt
            else:
                retry_after = parse_retry_after(
                    resp.headers.get("Retry-After"), self.clock.wall().astimezone(UTC)
                )
                limited = resp.status_code in (429, 502, 503, 504) or (
                    resp.status_code == 403
                    and (
                        retry_after is not None or resp.headers.get("X-RateLimit-Remaining") == "0"
                    )
                )
                if not limited:
                    return resp
                delay = retry_after if retry_after is not None else 2.0**attempt
                if resp.status_code == 403 and retry_after is None:
                    reset = resp.headers.get("X-RateLimit-Reset")
                    if reset and reset.isdigit():
                        delay = max(delay, float(reset) - self.clock.wall().timestamp())
            if waited + delay > MAX_TOTAL_WAIT_S or attempt == MAX_ATTEMPTS - 1:
                break
            self.clock.sleep(delay)
            waited += delay
        assert resp is not None
        return resp

    def _error(self, what: str, resp: httpx.Response) -> ReleaseArchiveError:
        text = self._redactor.text(resp.text[:300])
        return ReleaseArchiveError(f"{what} failed: HTTP {resp.status_code} {text}")


def _tar(members: Mapping[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:") as tf:
        for name in sorted(members):
            info = tarfile.TarInfo(name=name)
            info.size = len(members[name])
            info.mtime = 0
            tf.addfile(info, io.BytesIO(members[name]))
    return buf.getvalue()


def release_store_from_env(
    environ: Mapping[str, str], *, run_id: int, today: date | None = None
) -> ReleaseArchiveStore:
    """Build the store from ``GITHUB_TOKEN`` and ``GITHUB_REPOSITORY`` (values never logged)."""
    token = environ.get("GITHUB_TOKEN", "")
    repo = environ.get("GITHUB_REPOSITORY", "")
    if not token or not repo:
        raise ReleaseArchiveError("GITHUB_TOKEN and GITHUB_REPOSITORY are required")
    return ReleaseArchiveStore(repo, token, run_id=run_id, today=today or datetime.now(UTC).date())


def publish_dump_or_alert(
    out_dir: Path, store: ReleaseArchiveStore, issues: GitHubIssues | None, run_url: str
) -> str:
    """Publish the dump; on a self-check failure publish nothing and open a ``pipeline`` issue.

    The issue body carries only the run URL and the problem count (never cell values). The
    ``DumpSelfCheckError`` is re-raised so the caller exits non-zero (BKP-03).
    """
    try:
        return store.publish_dump(out_dir)
    except DumpSelfCheckError as exc:
        if issues is not None:
            finding = Finding(
                "pipeline", "db-dump-public", metrics={"self_check_problems": len(exc.problems)}
            )
            sync_issues(issues, [finding], [], run_url)
        raise
