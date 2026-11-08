"""Raw manifest writers: ``ingest.raw_blob``, ``ingest.raw_object``, ``ingest.fetch_attempt`` and
the fetch-side pointers of ``ingest.request_state`` (ingestion spec sections 4 and 6, ADR-002/003).

All functions run on the caller's connection and never commit; the caller owns the transaction.
Rows are only inserted (the tables are append-only); ``request_state`` is a cache and is upserted,
touching only fetch-side columns (``last_loaded_*`` belong to the load transaction).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb


@dataclass(frozen=True)
class LatestState:
    """Fetch-side facts about the LATEST object of a request key."""

    raw_id: int | None = None
    sha256: str | None = None
    etag: str | None = None
    last_modified: str | None = None
    update_marker: str | None = None
    last_url: str | None = None  # last URL sent (the resolved file URL of a discovered request)
    bytes_unavailable: bool = False  # latest is a hash_only object rejected as bytes_unavailable


@dataclass(frozen=True)
class BlobRow:
    sha256: str
    byte_count: int
    storage_backend: str
    storage_ref: str | None


@dataclass(frozen=True)
class NewRawObject:
    run_id: int
    source_id: str
    group_id: str
    request_key: str
    request_url: str
    request_params: Mapping[str, object]
    http_status: int
    etag: str | None
    last_modified: str | None
    content_type: str | None
    fetched_at: datetime
    sha256: str
    fetch_mode: str
    fetch_scope: str
    parser_id: str
    manual: bool = False
    edition_label: str | None = None
    edition_date: date | None = None
    import_label: str | None = None
    robots_decision: str | None = None
    robots_checked_at: datetime | None = None


def latest_state(conn: psycopg.Connection, source_id: str, request_key: str) -> LatestState:
    """Latest object of ``(source_id, request_key)`` plus the stored validators."""
    obj = conn.execute(
        "SELECT o.raw_id, o.sha256, s.archive_mode, l.outcome, l.detail ->> 'reason' "
        "FROM ingest.raw_object o JOIN ref.source s ON s.source_id = o.source_id "
        "LEFT JOIN ingest.raw_load l ON l.raw_id = o.raw_id "
        "WHERE o.source_id = %s AND o.request_key = %s "
        "ORDER BY o.fetched_at DESC, o.raw_id DESC LIMIT 1",
        [source_id, request_key],
    ).fetchone()
    state = conn.execute(
        "SELECT etag, last_modified, update_marker, last_url FROM ingest.request_state "
        "WHERE source_id = %s AND request_key = %s",
        [source_id, request_key],
    ).fetchone()
    etag, last_modified, marker, last_url = state if state else (None, None, None, None)
    if obj is None:
        return LatestState(
            etag=etag, last_modified=last_modified, update_marker=marker, last_url=last_url
        )
    raw_id, sha, mode, outcome, reason = obj
    return LatestState(
        raw_id=int(raw_id),
        sha256=str(sha),
        etag=etag,
        last_modified=last_modified,
        update_marker=marker,
        last_url=last_url,
        bytes_unavailable=(
            mode == "hash_only" and outcome == "rejected" and reason == "bytes_unavailable"
        ),
    )


def get_blob(conn: psycopg.Connection, sha256: str) -> BlobRow | None:
    row = conn.execute(
        "SELECT sha256, byte_count, storage_backend, storage_ref FROM ingest.raw_blob "
        "WHERE sha256 = %s",
        [sha256],
    ).fetchone()
    return None if row is None else BlobRow(row[0], int(row[1]), row[2], row[3])


def insert_blob(
    conn: psycopg.Connection,
    *,
    sha256: str,
    byte_count: int,
    storage_backend: str,
    storage_ref: str | None,
    first_stored_at: datetime,
) -> bool:
    """Insert a blob; False when the sha256 already exists (deduplication applies to bytes only)."""
    cur = conn.execute(
        "INSERT INTO ingest.raw_blob (sha256, byte_count, storage_backend, storage_ref, "
        "first_stored_at) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (sha256) DO NOTHING",
        [sha256, byte_count, storage_backend, storage_ref, first_stored_at],
    )
    return cur.rowcount == 1


def insert_raw_object(conn: psycopg.Connection, obj: NewRawObject, prev_raw_id: int | None) -> int:
    """Insert a manifest row chained to the latest object (the DB trigger enforces the chain)."""
    row = conn.execute(
        "INSERT INTO ingest.raw_object (run_id, source_id, group_id, request_key, prev_raw_id, "
        "request_url, request_params, http_status, etag, last_modified, content_type, fetched_at, "
        "sha256, fetch_mode, fetch_scope, manual, edition_label, edition_date, import_label, "
        "robots_decision, robots_checked_at, parser_id) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        "RETURNING raw_id",
        [
            obj.run_id,
            obj.source_id,
            obj.group_id,
            obj.request_key,
            prev_raw_id,
            obj.request_url,
            Jsonb(dict(obj.request_params)),
            obj.http_status,
            obj.etag,
            obj.last_modified,
            obj.content_type,
            obj.fetched_at,
            obj.sha256,
            obj.fetch_mode,
            obj.fetch_scope,
            obj.manual,
            obj.edition_label,
            obj.edition_date,
            obj.import_label,
            obj.robots_decision,
            obj.robots_checked_at,
            obj.parser_id,
        ],
    ).fetchone()
    assert row is not None
    return int(row[0])


def insert_fetch_attempt(
    conn: psycopg.Connection,
    *,
    run_id: int,
    source_id: str,
    request_key: str,
    attempted_at: datetime,
    outcome: str,
    http_status: int | None = None,
    duration_ms: int | None = None,
    byte_count: int | None = None,
    raw_id: int | None = None,
    error_class: str | None = None,
    error_detail: str | None = None,
) -> int:
    row = conn.execute(
        "INSERT INTO ingest.fetch_attempt (run_id, source_id, request_key, attempted_at, outcome, "
        "http_status, duration_ms, bytes, raw_id, error_class, error_detail) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING attempt_id",
        [
            run_id,
            source_id,
            request_key,
            attempted_at,
            outcome,
            http_status,
            duration_ms,
            byte_count,
            raw_id,
            error_class,
            error_detail,
        ],
    ).fetchone()
    assert row is not None
    return int(row[0])


def advance_fetch_pointers(
    conn: psycopg.Connection,
    *,
    source_id: str,
    request_key: str,
    url: str,
    checked_at: datetime,
    status: str,
    sha256: str | None = None,
    etag: str | None = None,
    last_modified: str | None = None,
    update_marker: str | None = None,
    changed: bool = False,
) -> None:
    """Upsert the fetch-side pointers. Call only after the manifest commit (spec section 6).

    Validators that a 304 omits keep their stored value; ``last_loaded_*`` is never touched.
    ``last_sha256`` advances only with ``changed`` (a new object).
    """
    params: dict[str, Any] = {
        "source_id": source_id,
        "request_key": request_key,
        "url": url,
        "etag": etag,
        "last_modified": last_modified,
        "update_marker": update_marker,
        "sha256": sha256 if changed else None,
        "status": status,
        "checked_at": checked_at,
        "changed_at": checked_at if changed else None,
    }
    conn.execute(
        "INSERT INTO ingest.request_state (source_id, request_key, last_url, etag, last_modified, "
        "update_marker, last_sha256, last_status, last_checked_at, last_changed_at) "
        "VALUES (%(source_id)s, %(request_key)s, %(url)s, %(etag)s, %(last_modified)s, "
        "%(update_marker)s, %(sha256)s, %(status)s, %(checked_at)s, %(changed_at)s) "
        "ON CONFLICT (source_id, request_key) DO UPDATE SET "
        "last_url = EXCLUDED.last_url, "
        "etag = COALESCE(EXCLUDED.etag, ingest.request_state.etag), "
        "last_modified = COALESCE(EXCLUDED.last_modified, ingest.request_state.last_modified), "
        "update_marker = COALESCE(EXCLUDED.update_marker, ingest.request_state.update_marker), "
        "last_sha256 = COALESCE(EXCLUDED.last_sha256, ingest.request_state.last_sha256), "
        "last_status = EXCLUDED.last_status, last_checked_at = EXCLUDED.last_checked_at, "
        "last_changed_at = COALESCE(EXCLUDED.last_changed_at, "
        "ingest.request_state.last_changed_at)",
        params,
    )
