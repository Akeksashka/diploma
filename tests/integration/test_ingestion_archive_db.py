"""T21 against a throwaway database: AC-ING-2, revert A -> B -> A, hash_only, pointer order.

Migrations 0000, 0001, a 0002 placeholder and 0003 are applied (as in test_ddl_ingest).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest

from macro_monitor.ingestion import archive
from macro_monitor.ingestion.archive import LocalDirStore, ObjectContext, StorageRef
from macro_monitor.models.types import FetchResult, RequestSpec
from macro_monitor.storage import manifest, migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

T0 = datetime(2026, 11, 1, 4, 0, tzinfo=UTC)
A = b'{"v": "A"}' * 100
B = b'{"v": "B"}' * 100


@pytest.fixture
def conn(test_database: TestDatabase, tmp_path: Path) -> Iterator[psycopg.Connection]:
    real = {m.version: m for m in migrate.discover()}
    mig = tmp_path / "mig"
    mig.mkdir()
    for v in (0, 1, 3):
        (mig / real[v].path.name).write_text(real[v].sql, encoding="utf-8")
    (mig / "0002_placeholder.sql").write_text("SELECT 1;", encoding="utf-8")
    with test_database.connect() as c:
        migrate.migrate(c, mig)
        c.execute(
            "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true), "
            "('H','p','rest','hash_only','withheld','l','a','x',true)"
        )
        c.execute(
            "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, "
            "status) VALUES ('w','local','refresh','g','c', now(), 'running')"
        )
        c.commit()
        yield c


@pytest.fixture
def store(tmp_path: Path) -> LocalDirStore:
    return LocalDirStore(tmp_path / "raw")


def _run_id(conn: psycopg.Connection) -> int:
    row = conn.execute("SELECT run_id FROM ingest.run").fetchone()
    assert row is not None
    return int(row[0])


def _fetch(
    n: int,
    body: bytes | None,
    *,
    source: str = "S",
    status: int = 200,
    outcome: str = "new",
    etag: str | None = None,
) -> FetchResult:
    spec = RequestSpec(
        source, "G", "GET", "https://x/y", {"f": "JSON"}, {}, "rk", "full", "complete"
    )
    return FetchResult(
        spec=spec,
        outcome=outcome,  # type: ignore[arg-type]
        status=status,
        body=body,
        fetched_at=T0 + timedelta(minutes=n),
        etag=etag,
        last_modified=None,
        content_type="application/json",
        update_marker=None,
    )


def _ctx(conn: psycopg.Connection, mode: str = "public") -> ObjectContext:
    return ObjectContext(
        run_id=_run_id(conn),
        parser_id="p@1",
        archive_mode=mode,  # type: ignore[arg-type]
        basename="x.json",
    )


def _count(conn: psycopg.Connection, table: str) -> int:
    row = conn.execute(f"SELECT count(*) FROM ingest.{table}").fetchone()
    assert row is not None
    return int(row[0])


def test_unchanged_and_304_write_attempt_not_object(
    conn: psycopg.Connection, store: LocalDirStore
) -> None:
    first = archive.record_fetch(conn, store, _fetch(0, A, etag='"e1"'), _ctx(conn))
    assert first.outcome == "new"
    assert first.manifest_line is not None
    assert first.manifest_line["asset"] == first.ref.asset  # type: ignore[union-attr]
    assert first.manifest_line["release_tag"] is None
    same = archive.record_fetch(conn, store, _fetch(1, A, outcome="unchanged"), _ctx(conn))
    nm = archive.record_fetch(
        conn, store, _fetch(2, None, status=304, outcome="not_modified"), _ctx(conn)
    )
    assert (same.outcome, nm.outcome) == ("unchanged", "not_modified")
    assert same.raw_id == nm.raw_id == first.raw_id
    assert _count(conn, "raw_object") == 1
    rows = conn.execute("SELECT outcome, raw_id FROM ingest.fetch_attempt ORDER BY attempt_id")
    assert rows.fetchall() == [
        ("new", first.raw_id),
        ("unchanged", first.raw_id),
        ("not_modified", first.raw_id),
    ]
    st = conn.execute(
        "SELECT etag, last_sha256, last_status, last_loaded_sha256 FROM ingest.request_state"
    ).fetchone()
    assert st == ('"e1"', archive.sha256_hex(A), "not_modified", None)  # 304 keeps the etag


def test_revert_a_b_a_three_objects_two_blobs_one_asset(
    conn: psycopg.Connection, store: LocalDirStore
) -> None:
    outs = [
        archive.record_fetch(conn, store, _fetch(i, body), _ctx(conn))
        for i, body in enumerate((A, B, A))
    ]
    assert [o.outcome for o in outs] == ["new", "new", "new"]
    assert [o.blob_reused for o in outs] == [False, False, True]
    assert _count(conn, "raw_object") == 3
    assert _count(conn, "raw_blob") == 2
    assert len(list((store.root).rglob("*.zst"))) == 2  # one stored object per distinct bytes
    chain = conn.execute("SELECT raw_id, prev_raw_id FROM ingest.raw_object ORDER BY raw_id")
    ids = [o.raw_id for o in outs]
    assert chain.fetchall() == [(ids[0], None), (ids[1], ids[0]), (ids[2], ids[1])]
    assert outs[2].ref == outs[0].ref
    assert outs[2].manifest_line is not None
    assert outs[2].manifest_line["blob_reused"] is True
    blob = manifest.get_blob(conn, archive.sha256_hex(A))
    assert blob is not None
    assert blob.storage_backend == "local_dir"
    assert blob.storage_ref == outs[0].ref.asset  # type: ignore[union-attr]
    ref = StorageRef.decode(blob.storage_backend, blob.storage_ref or "")
    assert store.get(ref) == A  # asset decompresses to exactly the received bytes


def test_hash_only_blob_has_no_storage(conn: psycopg.Connection, store: LocalDirStore) -> None:
    out = archive.record_fetch(conn, store, _fetch(0, A, source="H"), _ctx(conn, "hash_only"))
    assert out.ref is None
    assert out.manifest_line is not None
    assert out.manifest_line["asset"] is None
    assert out.manifest_line["release_tag"] is None
    blob = manifest.get_blob(conn, archive.sha256_hex(A))
    assert blob is not None
    assert (blob.storage_backend, blob.storage_ref) == ("none", None)
    assert not store.root.exists() or not list(store.root.rglob("*.zst"))


def test_bytes_unavailable_forces_a_new_object_on_identical_hash(
    conn: psycopg.Connection, store: LocalDirStore
) -> None:
    ctx = _ctx(conn, "hash_only")
    first = archive.record_fetch(conn, store, _fetch(0, A, source="H"), ctx)
    assert archive.record_fetch(conn, store, _fetch(1, A, source="H"), ctx).outcome == "unchanged"
    conn.execute(
        "INSERT INTO ingest.raw_load (raw_id, outcome, load_run_id, loaded_at, detail) "
        "VALUES (%s, 'rejected', %s, now(), '{\"reason\": \"bytes_unavailable\"}')",
        [first.raw_id, ctx.run_id],
    )
    conn.commit()
    state = manifest.latest_state(conn, "H", "rk")
    assert state.bytes_unavailable
    again = archive.record_fetch(conn, store, _fetch(2, A, source="H"), ctx)
    assert again.outcome == "new"
    assert again.blob_reused
    assert _count(conn, "raw_object") == 2


def test_pointers_advance_only_after_the_manifest_commit(
    conn: psycopg.Connection, store: LocalDirStore
) -> None:
    seen: list[int] = []

    def stage(c: psycopg.Connection, raw_id: int) -> None:
        # Inside the manifest transaction the pointer row does not exist yet.
        row = c.execute("SELECT count(*) FROM ingest.request_state").fetchone()
        assert row == (0,)
        seen.append(raw_id)

    out = archive.record_fetch(conn, store, _fetch(0, A), _ctx(conn), stage=stage)
    assert seen == [out.raw_id]
    row = conn.execute("SELECT last_sha256 FROM ingest.request_state").fetchone()
    assert row == (archive.sha256_hex(A),)


def test_failed_staging_rolls_back_manifest_and_leaves_pointers(
    conn: psycopg.Connection, store: LocalDirStore
) -> None:
    def boom(_c: psycopg.Connection, _raw_id: int) -> None:
        raise RuntimeError("staging failed")

    with pytest.raises(RuntimeError):
        archive.record_fetch(conn, store, _fetch(0, A), _ctx(conn), stage=boom)
    conn.rollback()
    assert _count(conn, "raw_object") == 0
    assert _count(conn, "raw_blob") == 0
    assert _count(conn, "request_state") == 0
    assert _count(conn, "fetch_attempt") == 0
    # The orphan stored object is harmless; the retry reuses it and commits normally.
    retry = archive.record_fetch(conn, store, _fetch(1, A), _ctx(conn))
    assert retry.outcome == "new"
    assert _count(conn, "raw_object") == 1


def test_non_fetch_outcomes_only_record_an_attempt(
    conn: psycopg.Connection, store: LocalDirStore
) -> None:
    out = archive.record_fetch(
        conn, store, _fetch(0, None, status=403, outcome="blocked"), _ctx(conn)
    )
    assert out.outcome == "blocked"
    assert out.raw_id is None
    assert conn.execute("SELECT outcome FROM ingest.fetch_attempt").fetchall() == [("blocked",)]
    assert _count(conn, "raw_object") == 0
    assert _count(conn, "request_state") == 0


def test_robots_decision_fields_accept_a_robots_decision(
    conn: psycopg.Connection, store: LocalDirStore
) -> None:
    from macro_monitor.ingestion.robots import RobotsDecision

    rd = RobotsDecision(
        allowed=True, decision="allowed", enforced=True, robots_sha256="0" * 64, checked_at=T0
    )
    ctx = ObjectContext(
        run_id=_run_id(conn),
        parser_id="p@1",
        archive_mode="public",
        basename="x.json",
        robots_decision=rd.decision,
        robots_checked_at=rd.checked_at,
    )
    out = archive.record_fetch(conn, store, _fetch(0, A), ctx)
    row = conn.execute(
        "SELECT robots_decision, robots_checked_at FROM ingest.raw_object WHERE raw_id = %s",
        [out.raw_id],
    ).fetchone()
    assert row == ("allowed", T0)
    assert out.manifest_line is not None
    assert out.manifest_line["robots_checked_at"] == T0.isoformat()


def test_ac_ing_19_hash_only_swept_rejected_then_refetched_and_queued(
    conn: psycopg.Connection, store: LocalDirStore
) -> None:
    from macro_monitor.storage import loader

    ctx = _ctx(conn, "hash_only")
    first = archive.record_fetch(conn, store, _fetch(0, A, source="H"), ctx)
    blob = manifest.get_blob(conn, archive.sha256_hex(A))
    assert blob is not None
    assert blob.storage_backend == "none"
    assert archive.hash_only_sources(conn) == ["H"]
    # staging was never written / already swept: the loader cannot re-stage
    queued = loader.read_queue(conn)
    assert [o.raw_id for o in queued] == [first.raw_id]
    res = loader.load_object(conn, queued[0], run_id=ctx.run_id)
    assert res.status is loader.LoadStatus.REJECTED
    assert manifest.latest_state(conn, "H", "rk").bytes_unavailable
    # next plan: identical hash refetched as a new object, queued for loading
    again = archive.record_fetch(conn, store, _fetch(1, A, source="H"), ctx)
    assert again.outcome == "new"
    assert again.raw_id != first.raw_id
    assert [o.raw_id for o in loader.read_queue(conn)] == [again.raw_id]
