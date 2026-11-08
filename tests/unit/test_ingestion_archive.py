"""AC-ING-22 (a), (b), (c), (d) and the pure ladder of ADR-004 (unit, no network, no DB)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from macro_monitor.ingestion import archive
from macro_monitor.ingestion.archive import (
    BytesCorruptError,
    BytesMissingError,
    LocalDirStore,
    RawStoreConfigError,
    StorageRef,
    StoreConflictError,
)
from macro_monitor.models.types import FetchResult, RequestSpec
from macro_monitor.storage.manifest import LatestState

DATA = b'{"hello": "world"}\n' * 50
SHA = archive.sha256_hex(DATA)


def test_put_get_roundtrip_and_zstd_decompresses_to_input(tmp_path: Path) -> None:
    store = LocalDirStore(tmp_path)
    ref = store.put(SHA, DATA, "src/abc-x.json")
    assert ref == StorageRef(asset=f"src/{SHA[:2]}/{SHA}.zst")
    assert store.get(ref) == DATA
    assert archive.decompress((tmp_path / ref.asset).read_bytes()) == DATA
    assert store.backend_id == "local_dir"


def test_put_twice_is_noop_one_file(tmp_path: Path) -> None:
    store = LocalDirStore(tmp_path)
    first = store.put(SHA, DATA, "src/a.json")
    second = store.put(SHA, DATA, "src/other-name.json")
    assert first == second
    assert len(list(tmp_path.rglob("*.zst"))) == 1
    assert not list(tmp_path.rglob(".put-*"))


def test_same_sha_from_other_source_reuses_the_stored_object(tmp_path: Path) -> None:
    store = LocalDirStore(tmp_path)
    first = store.put(SHA, DATA, "one/a.json")
    assert store.put(SHA, DATA, "two/a.json") == first


def test_put_rejects_bytes_that_do_not_match_the_sha(tmp_path: Path) -> None:
    store = LocalDirStore(tmp_path)
    with pytest.raises(ValueError, match="does not match"):
        store.put(SHA, b"other", "src/a")


def test_conflict_error_on_link_race(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = LocalDirStore(tmp_path)
    target = tmp_path / "src" / SHA[:2]
    target.mkdir(parents=True)
    # Simulate a racing writer: _find misses, but the name appears before the link.
    monkeypatch.setattr(store, "_find", lambda _sha: None)
    (target / f"{SHA}.zst").write_bytes(archive.compress(b"different"))
    with pytest.raises(StoreConflictError):
        store.put(SHA, DATA, "src/a")


def test_no_delete_or_overwrite_api() -> None:
    public = {n for n in dir(LocalDirStore) if not n.startswith("_")}
    assert public == {"backend_id", "put", "get", "exists"}


def test_get_detects_altered_bytes(tmp_path: Path) -> None:
    store = LocalDirStore(tmp_path)
    ref = store.put(SHA, DATA, "src/a")
    (tmp_path / ref.asset).write_bytes(archive.compress(b"altered"))
    with pytest.raises(BytesCorruptError, match="bytes_corrupt"):
        store.get(ref)
    (tmp_path / ref.asset).write_bytes(b"not zstd at all")
    with pytest.raises(BytesCorruptError):
        store.get(ref)


def test_get_missing_and_unsafe_refs(tmp_path: Path) -> None:
    store = LocalDirStore(tmp_path)
    with pytest.raises(BytesMissingError):
        store.get(StorageRef(asset=f"src/{SHA[:2]}/{SHA}.zst"))
    for bad in ("../x/ab/" + SHA + ".zst", "/abs/ab/x.zst", "a/b"):
        with pytest.raises(ValueError, match="invalid"):
            store.get(StorageRef(asset=bad))


def test_exists(tmp_path: Path) -> None:
    store = LocalDirStore(tmp_path / "missing-root")
    assert not store.exists(SHA)
    store.put(SHA, DATA, "src/a")
    assert store.exists(SHA)
    assert not store.exists(archive.sha256_hex(b"unknown"))


def test_storage_ref_encoding_carries_release_tag_and_asset() -> None:
    rel = StorageRef(asset="eurostat/ab12cd34ef56ab12-x.json.zst", release_tag="raw-2026-11-01-r45")
    assert rel.encode() == "raw-2026-11-01-r45/eurostat/ab12cd34ef56ab12-x.json.zst"
    assert StorageRef.decode("release_public", rel.encode()) == rel
    local = StorageRef(asset="s/ab/x.zst")
    assert StorageRef.decode("local_dir", local.encode()) == local
    assert local.release_tag is None
    with pytest.raises(ValueError, match="stores no bytes"):
        StorageRef.decode("none", "x")
    with pytest.raises(ValueError, match="malformed"):
        StorageRef.decode("release_public", "no-slash")


def test_asset_name() -> None:
    assert archive.asset_name("eurostat", SHA, "x.json") == f"eurostat/{SHA[:16]}-x.json"


def test_production_refuses_local_dir(tmp_path: Path) -> None:
    with pytest.raises(RawStoreConfigError) as err:
        archive.raw_store_from_env({"MM_ENV": "production", "MM_RAW_STORE": "local_dir"})
    assert err.value.exit_code == 20
    with pytest.raises(RawStoreConfigError):
        archive.raw_store_from_env({"MM_ENV": "production"})  # default backend is local_dir
    store = archive.raw_store_from_env({"MM_RAW_STORE": "local_dir", "MM_RAW_DIR": str(tmp_path)})
    assert isinstance(store, LocalDirStore)
    assert store.root == tmp_path
    with pytest.raises(RawStoreConfigError):
        archive.raw_store_from_env({"MM_RAW_STORE": "nonsense"})


# ---- ladder -------------------------------------------------------------------------


def _result(body: bytes | None, status: int | None = 200, outcome: str = "new") -> FetchResult:
    spec = RequestSpec("s", "g", "GET", "https://x", {}, {}, "k", "full", "complete")
    return FetchResult(
        spec=spec,
        outcome=outcome,  # type: ignore[arg-type]
        status=status,
        body=body,
        fetched_at=datetime(2026, 1, 1, tzinfo=UTC),
        etag=None,
        last_modified=None,
        content_type=None,
        update_marker=None,
    )


def test_decide_compares_against_latest_only() -> None:
    latest_a = LatestState(raw_id=3, sha256=SHA)
    assert archive.decide(_result(DATA), latest_a) == "unchanged"
    assert archive.decide(_result(b"B"), latest_a) == "new"
    # A -> B -> A: latest is B now, so A is a change although A was seen earlier.
    latest_b = LatestState(raw_id=4, sha256=archive.sha256_hex(b"B"))
    assert archive.decide(_result(DATA), latest_b) == "new"
    assert archive.decide(_result(DATA), LatestState()) == "new"


def test_decide_304_and_bytes_unavailable_bypass() -> None:
    assert archive.decide(_result(None, 304, "not_modified"), LatestState(raw_id=1)) == (
        "not_modified"
    )
    assert archive.decide(_result(None, 304), LatestState(raw_id=1)) == "not_modified"
    stuck = LatestState(raw_id=1, sha256=SHA, bytes_unavailable=True)
    assert archive.decide(_result(DATA), stuck) == "new"
    with pytest.raises(ValueError, match="body"):
        archive.decide(_result(None, 200), LatestState())


def test_conditional_headers_and_marker() -> None:
    state = LatestState(raw_id=1, sha256=SHA, etag='"e"', last_modified="Mon", update_marker="m1")
    ladder = ("http_validators", "update_marker", "content_hash")
    assert archive.conditional_headers(ladder, state) == {
        "If-None-Match": '"e"',
        "If-Modified-Since": "Mon",
    }
    assert archive.conditional_headers(("content_hash",), state) == {}
    bypass = LatestState(raw_id=1, etag='"e"', bytes_unavailable=True)
    assert archive.conditional_headers(ladder, bypass) == {}
    assert archive.marker_unchanged(ladder, state, "m1")
    assert not archive.marker_unchanged(ladder, state, "m2")
    assert not archive.marker_unchanged(("content_hash",), state, "m1")
    assert not archive.marker_unchanged(ladder, LatestState(), "m1")


def test_validate_ladder() -> None:
    assert archive.validate_ladder(["update_marker", "content_hash"]) == (
        "update_marker",
        "content_hash",
    )
    with pytest.raises(ValueError, match="unknown"):
        archive.validate_ladder(["telepathy"])
