"""Raw store (``RawStore`` protocol, local-directory backend) and the change-detection ladder.

Ingestion spec sections 4, 4a and 6, ADR-003, ADR-004. The ``release_public`` backend arrives
with T45; this module carries the protocol, the ``local_dir`` backend (tests and development),
the stored-reference type that carries ``release_tag`` and ``asset``, and the pure ladder
decision. Database writes live in ``macro_monitor.storage.manifest``.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path, PurePosixPath
from typing import Literal, Protocol

import psycopg
import zstandard

from macro_monitor.models.types import FetchResult
from macro_monitor.settings import ENV_MM_ENV, ENV_MM_RAW_STORE
from macro_monitor.storage import manifest
from macro_monitor.storage.manifest import LatestState

BackendId = Literal["release_public", "local_dir"]
ENV_MM_RAW_DIR = "MM_RAW_DIR"
DEFAULT_RAW_DIR = Path("data") / "raw"
EXIT_CONFIG_ERROR = 20
ZSTD_LEVEL = 3
LADDER_STEPS = frozenset({"http_validators", "update_marker", "content_hash"})


class RawStoreError(Exception):
    """Base class of raw store failures."""


class BytesCorruptError(RawStoreError):
    """``bytes_corrupt``: stored bytes do not match the recorded sha256 (or cannot be decoded)."""


class BytesMissingError(RawStoreError):
    """No stored object exists for the reference."""


class StoreConflictError(RawStoreError):
    """``put`` to an existing name with different content (stored objects are immutable)."""


class RawStoreConfigError(RawStoreError):
    """Configuration error, exit code 20 (non-production store selected in production)."""

    exit_code = EXIT_CONFIG_ERROR


@dataclass(frozen=True)
class StorageRef:
    """Where stored bytes live: ``asset`` plus, for release assets, the ``release_tag``.

    ``local_dir``: ``asset`` is the path relative to the store root, ``release_tag`` is None.
    ``release_public``: ``release_tag`` + ``asset`` (``<source_id>/<sha16>-<name>.zst``).
    """

    asset: str
    release_tag: str | None = None

    def encode(self) -> str:
        """Text stored in ``ingest.raw_blob.storage_ref``."""
        return self.asset if self.release_tag is None else f"{self.release_tag}/{self.asset}"

    @classmethod
    def decode(cls, backend: str, text: str) -> StorageRef:
        """Inverse of ``encode``; dispatches on the recorded backend, never on settings."""
        if backend == "local_dir":
            return cls(asset=text)
        if backend == "release_public":
            tag, sep, asset = text.partition("/")
            if not sep or not tag or not asset:
                raise ValueError(f"malformed release storage_ref: {text!r}")
            return cls(asset=asset, release_tag=tag)
        raise ValueError(f"backend {backend!r} stores no bytes")


class RawStore(Protocol):
    backend_id: BackendId

    def put(self, sha256: str, data: bytes, name: str) -> StorageRef:
        """Idempotent per sha256; ``name`` is the asset name ``<source_id>/<basename>``."""
        ...

    def get(self, ref: StorageRef) -> bytes:
        """Verified read; raises ``BytesCorruptError`` on mismatch, ``BytesMissingError``."""
        ...

    def exists(self, sha256: str) -> bool: ...


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compress(data: bytes) -> bytes:
    """zstd encoding shared by every backend (deterministic for equal input and level)."""
    return zstandard.ZstdCompressor(level=ZSTD_LEVEL, write_checksum=True).compress(data)


def decompress(blob: bytes) -> bytes:
    try:
        return zstandard.ZstdDecompressor().decompress(blob)
    except zstandard.ZstdError as exc:
        raise BytesCorruptError(f"bytes_corrupt: cannot decode zstd frame ({exc})") from exc


def asset_name(source_id: str, sha256: str, basename: str) -> str:
    """ADR-003 asset name ``<source_id>/<sha256[:16]>-<basename>`` (the store adds ``.zst``)."""
    return f"{source_id}/{sha256[:16]}-{basename}"


def _check_source_id(source_id: str) -> str:
    if not source_id or source_id in {".", ".."} or "/" in source_id or "\\" in source_id:
        raise ValueError(f"invalid source_id in asset name: {source_id!r}")
    return source_id


def _check_sha(sha256: str) -> str:
    if len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
        raise ValueError(f"not a lowercase sha256 hex digest: {sha256!r}")
    return sha256


class LocalDirStore:
    """``local_dir`` backend: ``<root>/<source_id>/<sha256[0:2]>/<sha256>.zst``."""

    backend_id: BackendId = "local_dir"

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)

    def _relative(self, source_id: str, sha256: str) -> PurePosixPath:
        return PurePosixPath(source_id) / sha256[:2] / f"{sha256}.zst"

    def _find(self, sha256: str) -> Path | None:
        if not self.root.is_dir():
            return None
        for src in sorted(self.root.iterdir()):
            candidate = src / sha256[:2] / f"{sha256}.zst"
            if candidate.is_file():
                return candidate
        return None

    def put(self, sha256: str, data: bytes, name: str) -> StorageRef:
        _check_sha(sha256)
        if sha256_hex(data) != sha256:
            raise ValueError("sha256 does not match the bytes passed to put")
        source_id = _check_source_id(name.split("/", 1)[0])
        existing = self._find(sha256)
        if existing is not None:
            # Same sha256 stored already (possibly under another source): no-op.
            return StorageRef(asset=existing.relative_to(self.root).as_posix())
        rel = self._relative(source_id, sha256)
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".put-")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(compress(data))
            try:
                os.link(tmp, path)  # fails if the name exists: never overwrites
            except FileExistsError:
                if decompress(path.read_bytes()) != data:
                    raise StoreConflictError(f"{rel} exists with different content") from None
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(tmp)
        return StorageRef(asset=rel.as_posix())

    def get(self, ref: StorageRef) -> bytes:
        rel = PurePosixPath(ref.asset)
        if rel.is_absolute() or ".." in rel.parts or len(rel.parts) != 3:
            raise ValueError(f"invalid local_dir reference: {ref.asset!r}")
        path = self.root / rel
        if not path.is_file():
            raise BytesMissingError(f"no stored object at {ref.asset}")
        expected = rel.name.removesuffix(".zst")
        data = decompress(path.read_bytes())
        if sha256_hex(data) != expected:
            raise BytesCorruptError(f"bytes_corrupt: {ref.asset} does not match its sha256")
        return data

    def exists(self, sha256: str) -> bool:
        return self._find(_check_sha(sha256)) is not None


def raw_store_from_env(
    environ: Mapping[str, str] | None = None, *, run_id: int | None = None
) -> RawStore:
    """Choose the backend once per process (``MM_RAW_STORE``); no ``local_dir`` in production.

    ``release_public`` needs the run id (``run_id`` or ``GITHUB_RUN_ID``) plus ``GITHUB_TOKEN`` and
    ``GITHUB_REPOSITORY``; the store is built lazily and makes no network call until used.
    """
    env = os.environ if environ is None else environ
    choice = env.get(ENV_MM_RAW_STORE, "local_dir")
    if choice not in ("local_dir", "release_public"):
        raise RawStoreConfigError(f"{ENV_MM_RAW_STORE}={choice!r} is not a known raw store")
    if env.get(ENV_MM_ENV) == "production" and choice != "release_public":
        raise RawStoreConfigError(
            f"{ENV_MM_ENV}=production requires {ENV_MM_RAW_STORE}=release_public"
        )
    if choice == "release_public":
        from macro_monitor.storage.release_archive import (  # cycle: it imports this module
            ReleaseArchiveError,
            release_store_from_env,
        )

        rid = run_id
        if rid is None:
            raw_rid = env.get("GITHUB_RUN_ID", "")
            rid = int(raw_rid) if raw_rid.isdigit() else None
        if rid is None:
            raise RawStoreConfigError("release_public needs a run id (run_id or GITHUB_RUN_ID)")
        try:
            return release_store_from_env(env, run_id=rid)
        except ReleaseArchiveError as exc:
            raise RawStoreConfigError(str(exc)) from exc
    return LocalDirStore(env.get(ENV_MM_RAW_DIR) or DEFAULT_RAW_DIR)


# ---------------------------------------------------------------------------------------
# Change-detection ladder (ADR-004, spec section 6)
# ---------------------------------------------------------------------------------------


Decision = Literal["new", "unchanged", "not_modified"]


def validate_ladder(ladder: Sequence[str]) -> tuple[str, ...]:
    unknown = [s for s in ladder if s not in LADDER_STEPS]
    if unknown:
        raise ValueError(f"unknown change_detection step(s): {unknown}")
    return tuple(ladder)


def conditional_headers(ladder: Sequence[str], state: LatestState) -> dict[str, str]:
    """Step 1: validators from the latest fetched object; bypassed once for bytes_unavailable."""
    if "http_validators" not in ladder or state.bytes_unavailable:
        return {}
    headers: dict[str, str] = {}
    if state.etag:
        headers["If-None-Match"] = state.etag
    if state.last_modified:
        headers["If-Modified-Since"] = state.last_modified
    return headers


def marker_unchanged(ladder: Sequence[str], state: LatestState, marker: str | None) -> bool:
    """Step 2: opaque string comparison; True means "skip the fetch" (record ``unchanged``)."""
    return (
        "update_marker" in ladder
        and not state.bytes_unavailable
        and marker is not None
        and state.update_marker is not None
        and marker == state.update_marker
    )


def decide(result: FetchResult, state: LatestState) -> Decision:
    """Step 3: compare the received bytes with the LATEST object only (revert-safe)."""
    if result.status == 304 or result.outcome == "not_modified":
        return "not_modified"
    if result.body is None:
        raise ValueError("a fetched result needs a body to be classified")
    if (
        not state.bytes_unavailable
        and state.sha256 is not None
        and sha256_hex(result.body) == state.sha256
    ):
        return "unchanged"
    return "new"


# ---------------------------------------------------------------------------------------
# Recording a fetch result (store bytes, write the manifest, advance pointers)
# ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ObjectContext:
    """Per-object facts the fetch leg adds to a ``FetchResult`` (manifest columns)."""

    run_id: int
    parser_id: str
    archive_mode: Literal["public", "hash_only"]
    basename: str  # asset basename, e.g. "sts_inpr_m.json"
    manual: bool = False
    edition_label: str | None = None
    edition_date: date | None = None
    import_label: str | None = None
    robots_decision: str | None = None
    robots_checked_at: datetime | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class RecordOutcome:
    outcome: str
    raw_id: int | None  # the new object, or the latest existing one when unchanged/not_modified
    blob_reused: bool = False
    ref: StorageRef | None = None  # carries release_tag / asset; None for hash_only
    manifest_line: Mapping[str, object] | None = None  # only for a new object


def _manifest_line(
    result: FetchResult,
    ctx: ObjectContext,
    raw_id: int,
    sha: str,
    reused: bool,
    ref: StorageRef | None,
    prev_raw_id: int | None,
) -> dict[str, object]:
    spec = result.spec
    assert result.body is not None
    return {
        "raw_id": raw_id,
        "prev_raw_id": prev_raw_id,
        "run_id": ctx.run_id,
        "source_id": spec.source_id,
        "group_id": spec.group_id,
        "request_key": spec.request_key,
        "request_url": result.resolved_url or spec.url,
        "request_params": request_params(result),
        "http_status": result.status,
        "etag": result.etag,
        "last_modified": result.last_modified,
        "content_type": result.content_type,
        "fetched_at": result.fetched_at.isoformat(),
        "byte_count": len(result.body),
        "sha256": sha,
        "blob_reused": reused,
        "asset": None if ref is None else ref.asset,
        "release_tag": None if ref is None else ref.release_tag,
        "parser_id": ctx.parser_id,
        "fetch_mode": spec.fetch_mode,
        "fetch_scope": spec.expect_scope,
        "manual": ctx.manual,
        "edition_label": ctx.edition_label,
        "edition_date": None if ctx.edition_date is None else ctx.edition_date.isoformat(),
        "import_label": ctx.import_label,
        "robots_decision": ctx.robots_decision,
        "robots_checked_at": (
            None if ctx.robots_checked_at is None else ctx.robots_checked_at.isoformat()
        ),
    }


def request_params(result: FetchResult) -> dict[str, object]:
    """``raw_object.request_params``: the spec params plus the ``discovery`` object (ADR-028 D4)."""
    out: dict[str, object] = dict(result.spec.params)
    if result.discovery is not None:
        out["discovery"] = dict(result.discovery)
    return out


def collect_manifest_line(store: RawStore, outcome: RecordOutcome) -> None:
    """Hand a new object's manifest line to stores that publish ``manifest.jsonl``."""
    add = getattr(store, "add_manifest_line", None)
    if add is not None and outcome.manifest_line is not None:
        add(outcome.manifest_line)


def record_fetch(
    conn: psycopg.Connection,
    store: RawStore,
    result: FetchResult,
    ctx: ObjectContext,
    *,
    stage: Callable[[psycopg.Connection, int], None] | None = None,
) -> RecordOutcome:
    """Classify ``result`` against the LATEST object and persist the outcome.

    ``new``: bytes to the store (idempotent per sha256), then in ONE transaction the blob (if new),
    the ``raw_object``, the ``fetch_attempt`` and whatever ``stage`` writes (staging rows); commit;
    only then the fetch-side ``request_state`` pointers advance (second commit).
    ``unchanged`` / ``not_modified``: a ``fetch_attempt`` only (plus the pointer refresh).
    Other outcomes (blocked, error, ...): a ``fetch_attempt`` only. The connection must not have
    an open transaction on entry.
    """
    spec = result.spec
    if result.outcome not in ("new", "unchanged", "not_modified"):
        manifest.insert_fetch_attempt(
            conn,
            run_id=ctx.run_id,
            source_id=spec.source_id,
            request_key=spec.request_key,
            attempted_at=result.fetched_at,
            outcome=result.outcome,
            http_status=result.status,
            duration_ms=ctx.duration_ms,
            error_class=result.error_class,  # e.g. redirect_refused, body_too_large (http.py)
        )
        conn.commit()
        return RecordOutcome(outcome=result.outcome, raw_id=None)

    state = manifest.latest_state(conn, spec.source_id, spec.request_key)
    decision = decide(result, state)
    byte_count = None if result.body is None else len(result.body)

    if decision != "new":
        if state.raw_id is None:
            raise ValueError(f"{decision} fetch for a request key without a stored object")
        manifest.insert_fetch_attempt(
            conn,
            run_id=ctx.run_id,
            source_id=spec.source_id,
            request_key=spec.request_key,
            attempted_at=result.fetched_at,
            outcome=decision,
            http_status=result.status,
            duration_ms=ctx.duration_ms,
            byte_count=byte_count,
            raw_id=state.raw_id,
        )
        conn.commit()
        manifest.advance_fetch_pointers(
            conn,
            source_id=spec.source_id,
            request_key=spec.request_key,
            url=result.resolved_url or spec.url,
            checked_at=result.fetched_at,
            status=decision,
            etag=result.etag,
            last_modified=result.last_modified,
            update_marker=result.update_marker,
        )
        conn.commit()
        return RecordOutcome(outcome=decision, raw_id=state.raw_id)

    body = result.body
    assert body is not None
    sha = sha256_hex(body)
    blob = manifest.get_blob(conn, sha)
    ref: StorageRef | None
    reinsert = False
    if blob is not None:
        reused = True
        ref = (
            None
            if blob.storage_backend == "none" or blob.storage_ref is None
            else StorageRef.decode(blob.storage_backend, blob.storage_ref)
        )
        reusable = getattr(store, "blob_reusable", None)
        if ref is not None and reusable is not None and not reusable(ref):
            # ADR-003 round 3: the recorded release is not published; store again, record anew.
            reused = False
            reinsert = True
            ref = store.put(sha, body, asset_name(spec.source_id, sha, ctx.basename))
    else:
        reused = False
        if ctx.archive_mode == "hash_only":
            ref = None
        else:
            ref = store.put(sha, body, asset_name(spec.source_id, sha, ctx.basename))
    if blob is None or reinsert:
        manifest.insert_blob(
            conn,
            sha256=sha,
            byte_count=len(body),
            storage_backend="none" if ref is None else store.backend_id,
            storage_ref=None if ref is None else ref.encode(),
            first_stored_at=result.fetched_at,
        )
    assert result.status is not None
    raw_id = manifest.insert_raw_object(
        conn,
        manifest.NewRawObject(
            run_id=ctx.run_id,
            source_id=spec.source_id,
            group_id=spec.group_id,
            request_key=spec.request_key,
            request_url=result.resolved_url or spec.url,
            request_params=request_params(result),
            http_status=result.status,
            etag=result.etag,
            last_modified=result.last_modified,
            content_type=result.content_type,
            fetched_at=result.fetched_at,
            sha256=sha,
            fetch_mode=spec.fetch_mode,
            fetch_scope=spec.expect_scope,
            parser_id=ctx.parser_id,
            manual=ctx.manual,
            edition_label=ctx.edition_label,
            edition_date=ctx.edition_date,
            import_label=ctx.import_label,
            robots_decision=ctx.robots_decision,
            robots_checked_at=ctx.robots_checked_at,
        ),
        state.raw_id,
    )
    manifest.insert_fetch_attempt(
        conn,
        run_id=ctx.run_id,
        source_id=spec.source_id,
        request_key=spec.request_key,
        attempted_at=result.fetched_at,
        outcome="new",
        http_status=result.status,
        duration_ms=ctx.duration_ms,
        byte_count=len(body),
        raw_id=raw_id,
    )
    if stage is not None:
        stage(conn, raw_id)
    conn.commit()  # manifest (+ staging) committed ...
    manifest.advance_fetch_pointers(  # ... and only then the fetch-side pointers advance
        conn,
        source_id=spec.source_id,
        request_key=spec.request_key,
        url=result.resolved_url or spec.url,
        checked_at=result.fetched_at,
        status="new",
        sha256=sha,
        etag=result.etag,
        last_modified=result.last_modified,
        update_marker=result.update_marker,
        changed=True,
    )
    conn.commit()
    return RecordOutcome(
        outcome="new",
        raw_id=raw_id,
        blob_reused=reused,
        ref=ref,
        manifest_line=_manifest_line(result, ctx, raw_id, sha, reused, ref, state.raw_id),
    )


def hash_only_sources(conn: psycopg.Connection) -> list[str]:
    """Enabled sources with ``archive_mode = 'hash_only'`` (BKP-02 input: no replay, no backup)."""
    rows = conn.execute(
        "SELECT source_id FROM ref.source WHERE archive_mode = 'hash_only' AND enabled "
        "ORDER BY source_id"
    ).fetchall()
    conn.rollback()
    return [str(r[0]) for r in rows]
