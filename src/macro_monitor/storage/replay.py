"""Test-only replay harness for I-CUR-7 (DDL spec section 5, ingestion spec AC-ING-4).

Truncates ``curated.observation`` (owner role, throwaway database only) and re-runs the insert
seam over every ``raw_object`` in ``(fetched_at, raw_id)`` order, honouring the recorded outcomes:
objects without an ``ingest.raw_load`` row of outcome ``loaded`` stay skipped, series with a
recorded ``deferred``/``rejected``/``skipped_out_of_order`` status and no ``loaded`` status are
left out, and each object is replayed with its recorded ``load_run_id`` (so the series map is read
at the recording run's ``git_sha``) and ``loaded_at``. Staging rows are deleted after the load, so
the caller supplies ``restage`` (production: re-parse the archived bytes with the recorded
``parser_id``; tests: put back the recorded rows). Nothing is written to ``raw_load``,
``request_state`` or ``raw_series_status``. Never import this from production code paths.

Known limit: a series deferred and released later is replayed with its object, not at the
release time; tests that compare replay do not release deferrals.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import psycopg

from macro_monitor.storage.loader import (
    _OBJ_SQL,
    InsertFn,
    LoadContext,
    QueuedObject,
    _obj,
)

RestageFn = Callable[[psycopg.Connection, QueuedObject, int], None]

NATURAL_KEY_SQL = (
    "SELECT s.source_id, s.dataset_id, s.series_key, s.version, o.ref_period_start, o.known_at, "
    "o.value, o.value_status, o.load_kind, o.revision_class FROM curated.observation o "
    "JOIN ref.series s USING (series_id) "
    "ORDER BY s.source_id, s.dataset_id, s.series_key, s.version, o.ref_period_start, o.known_at"
)


def natural_rows(conn: psycopg.Connection) -> list[tuple[Any, ...]]:
    """Observation rows on the I-CUR-7 natural key (surrogate ids are never compared)."""
    rows = conn.execute(NATURAL_KEY_SQL).fetchall()
    conn.rollback()
    return [tuple(r) for r in rows]


def replay(conn: psycopg.Connection, insert: InsertFn, restage: RestageFn) -> int:
    """Truncate observations and replay all recorded loads; returns the objects replayed."""
    with conn.transaction():  # owner-only test-database override of the I-CUR-1 guard
        conn.execute("ALTER TABLE curated.observation DISABLE TRIGGER observation_no_truncate")
        conn.execute("TRUNCATE curated.observation")
        conn.execute("ALTER TABLE curated.observation ENABLE TRIGGER observation_no_truncate")
    return replay_objects(conn, insert, restage)


def replay_objects(conn: psycopg.Connection, insert: InsertFn, restage: RestageFn) -> int:
    """The replay loop without the truncate (also used by ``storage.rebuild`` on an empty table)."""
    objs = conn.execute(
        _OBJ_SQL + "JOIN ingest.raw_load l USING (raw_id) WHERE l.outcome = 'loaded' "
        "ORDER BY o.fetched_at, o.raw_id"
    ).fetchall()
    conn.rollback()
    done = 0
    for row in objs:
        obj = _obj(row)
        with conn.transaction():
            load = conn.execute(
                "SELECT load_run_id, loaded_at FROM ingest.raw_load WHERE raw_id = %s",
                [obj.raw_id],
            ).fetchone()
            assert load is not None
            restage(conn, obj, int(load[0]))
            refs = [
                r[0]
                for r in conn.execute(
                    "SELECT series_ref FROM (SELECT series_ref FROM staging.series_meta_load "
                    "WHERE raw_id = %(r)s UNION SELECT series_ref FROM staging.observation_load "
                    "WHERE raw_id = %(r)s) u WHERE series_ref NOT IN ("
                    "SELECT series_ref FROM ingest.raw_series_status WHERE raw_id = %(r)s "
                    "AND status IN ('deferred','rejected','skipped_out_of_order') AND series_ref "
                    "NOT IN (SELECT series_ref FROM ingest.raw_series_status WHERE raw_id = %(r)s "
                    "AND status = 'loaded')) ORDER BY 1",
                    {"r": obj.raw_id},
                ).fetchall()
            ]
            ctx = LoadContext(
                conn, obj, int(load[0]), load[1], tuple(refs), obj.import_label == "archive_import"
            )
            insert(ctx)
            for table in ("observation_load", "series_meta_load"):
                conn.execute(f"DELETE FROM staging.{table} WHERE raw_id = %s", [obj.raw_id])
        done += 1
    return done
