"""Wiring of the release_public store: env factory, blob reuse rule, manifest lines ."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from macro_monitor.ingestion import archive
from macro_monitor.ingestion.archive import ObjectContext, RecordOutcome, StorageRef
from macro_monitor.models.types import FetchResult, RequestSpec
from macro_monitor.storage import manifest
from macro_monitor.storage.release_archive import ReleaseArchiveStore

BODY = b'{"v": 1}' * 50
SHA = archive.sha256_hex(BODY)
ENV = {
    "MM_ENV": "production",
    "MM_RAW_STORE": "release_public",
    "GITHUB_TOKEN": "t",
    "GITHUB_REPOSITORY": "o/r",
}


def test_factory_builds_release_store() -> None:
    store = archive.raw_store_from_env({**ENV, "GITHUB_RUN_ID": "7"})
    assert isinstance(store, ReleaseArchiveStore)
    assert archive.raw_store_from_env(ENV, run_id=9).backend_id == "release_public"


def test_factory_errors_are_config_errors() -> None:
    with pytest.raises(archive.RawStoreConfigError):
        archive.raw_store_from_env(ENV)  # no run id
    with pytest.raises(archive.RawStoreConfigError):
        archive.raw_store_from_env({"MM_RAW_STORE": "release_public"}, run_id=1)  # no token


class _Conn:
    def commit(self) -> None: ...


class _Store:
    backend_id = "release_public"

    def __init__(self, reusable: bool | None) -> None:
        self.reusable = reusable
        self.puts = 0
        self.lines: list[Any] = []

    def put(self, sha256: str, data: bytes, name: str) -> StorageRef:
        self.puts += 1
        return StorageRef(asset=f"{name}.zst", release_tag="raw-new")

    def add_manifest_line(self, line: Any) -> None:
        self.lines.append(line)

    def get(self, ref: StorageRef) -> bytes:
        raise NotImplementedError

    def exists(self, sha256: str) -> bool:
        return False


class _ReusableStore(_Store):
    def blob_reusable(self, ref: StorageRef) -> bool:
        assert self.reusable is not None
        return self.reusable


def _result() -> FetchResult:
    spec = RequestSpec(
        method="GET", headers={}, source_id="S", group_id="g", request_key="k",
        url="http://x", params={},
        fetch_mode="full", expect_scope="complete",
    )  # fmt: skip
    return FetchResult(
        spec=spec,
        outcome="new",
        status=200,
        body=BODY,
        etag=None,
        last_modified=None,
        content_type=None,
        update_marker=None,
        fetched_at=datetime(2026, 11, 1, tzinfo=UTC),
    )


def _run(
    monkeypatch: pytest.MonkeyPatch, store: _Store, existing: bool
) -> tuple[RecordOutcome, list[Any]]:
    inserted: list[Any] = []
    blob = (
        manifest.BlobRow(SHA, len(BODY), "release_public", "raw-old/S/x.zst") if existing else None
    )
    monkeypatch.setattr(manifest, "latest_state", lambda *a: manifest.LatestState())
    monkeypatch.setattr(manifest, "get_blob", lambda *a: blob)
    monkeypatch.setattr(manifest, "insert_blob", lambda c, **kw: inserted.append(kw) or True)
    monkeypatch.setattr(manifest, "insert_raw_object", lambda *a: 5)
    monkeypatch.setattr(manifest, "insert_fetch_attempt", lambda *a, **k: None)
    monkeypatch.setattr(manifest, "advance_fetch_pointers", lambda *a, **k: None)
    ctx = ObjectContext(run_id=1, parser_id="p", archive_mode="public", basename="x.json")
    out = archive.record_fetch(_Conn(), store, _result(), ctx)  # type: ignore[arg-type]
    return out, inserted


def test_published_blob_is_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _ReusableStore(True)
    out, inserted = _run(monkeypatch, store, existing=True)
    assert out.blob_reused
    assert store.puts == 0
    assert inserted == []
    assert out.ref == StorageRef(asset="S/x.zst", release_tag="raw-old")


def test_draft_blob_is_restored_and_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _ReusableStore(False)
    out, inserted = _run(monkeypatch, store, existing=True)
    assert not out.blob_reused
    assert store.puts == 1
    assert out.ref is not None
    assert out.ref.release_tag == "raw-new"
    assert len(inserted) == 1
    assert inserted[0]["storage_ref"].startswith("raw-new/")


def test_store_without_rule_reuses(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store(None)
    out, _ = _run(monkeypatch, store, existing=True)
    assert out.blob_reused
    assert store.puts == 0


def test_manifest_line_collected(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store(None)
    out, _ = _run(monkeypatch, store, existing=False)
    archive.collect_manifest_line(store, out)
    assert store.lines == [out.manifest_line]
    assert out.manifest_line is not None
    archive.collect_manifest_line(object(), out)  # store without the hook: no-op


def test_failed_fetch_attempt_stores_error_class(monkeypatch: pytest.MonkeyPatch) -> None:
    from dataclasses import replace

    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(manifest, "insert_fetch_attempt", lambda c, **kw: calls.append(kw) or 1)
    ctx = ObjectContext(run_id=1, parser_id="p", archive_mode="public", basename="x.json")
    for outcome, cls in (("error", "body_too_large"), ("error", None), ("blocked", None)):
        res = replace(_result(), outcome=outcome, body=None, status=200, error_class=cls)
        out = archive.record_fetch(_Conn(), _Store(None), res, ctx)  # type: ignore[arg-type]
        assert (out.outcome, out.raw_id) == (outcome, None)
    assert [(c["outcome"], c["error_class"]) for c in calls] == [
        ("error", "body_too_large"),
        ("error", None),
        ("blocked", None),
    ]
