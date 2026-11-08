"""Loader A: queue, lock, order, idempotence (ingestion spec section 5, T26).

The loader drains ``ingest.v_raw_unloaded`` per ``(source_id, group_id)`` in ``(fetched_at,
raw_id)`` order, one transaction per raw object. Inside that transaction (the top-level one, never
a savepoint: the ``request_state`` trigger of I-ING-6 compares ``xmin``):

1. ``pg_advisory_xact_lock(hashtext('mm-load'))`` with ``lock_timeout`` (default 10 min); on a
   timeout the object stays unloaded and the drain stops (the next drain takes it);
2. ``t_load := clock_timestamp()`` read once after the lock is held (I-CUR-9);
3. the object must still be unloaded; no earlier unloaded object of its group may exist (ORD-02);
   the edition-order rule (ORD-03) and the per-series out-of-order rule (ORD-01) apply;
4. the **insert seam** :func:`insert_observations` (T27: first-sight series creation,
   insert-on-change; T28 adds tombstones) writes ``curated.observation`` rows;
5. ``raw_load`` row, load-side ``request_state`` pointers and deletion of the object's staging rows.

Validation runs through :func:`macro_monitor.validation.quarantine.load_gated`: findings are
committed first, an ``error`` leaves the object unloaded (staging kept), successors are held.
The pre-load checks, the post-load checks and the re-staging step are injected hooks; the
production wiring arrives with T27/T29/T22.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from pathlib import Path
from typing import Any

import psycopg
from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb

from macro_monitor.registry.sync import MapEntry
from macro_monitor.storage.compare import (
    Action,
    ComparePolicy,
    Stored,
    decide,
    max_scale,
)
from macro_monitor.storage.db import DatabaseError, is_pooled_dsn
from macro_monitor.storage.series_create import (
    MapProvider,
    Problem,
    StagedMeta,
    StoredSeries,
    create_series,
    defer,
    diff_meta,
    find_series,
    first_sight_problems,
    git_map_provider,
    read_staged_metas,
    record_drift,
    split_ref,
    unit_from_expect_used,
    with_effective_unit,
)
from macro_monitor.validation.checks import CheckResult, Severity
from macro_monitor.validation.quarantine import PostChecksFn, insert_results, load_gated

log = logging.getLogger(__name__)

LOCK_NAME = "mm-load"
DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000
EXIT_ORDER_REFUSED = 10


class LoaderError(Exception):
    """Base class of loader failures."""


class OrderRefusedError(LoaderError):
    """``load --raw-id`` for an object behind an unloaded predecessor of its group (exit 10)."""

    exit_code = EXIT_ORDER_REFUSED


class StagingMissingError(LoaderError):
    """No staging rows and no way to re-stage from the stored bytes; the object stays queued."""


class LoadStatus(StrEnum):
    LOADED = "loaded"
    SKIPPED_OUT_OF_ORDER = "skipped_out_of_order"
    REJECTED = "rejected"  # bytes_unavailable (hash_only)
    HELD = "held"  # ORD-02: unloaded predecessor in the group
    BLOCKED = "blocked"  # validation error: object stays unloaded
    LOCK_TIMEOUT = "lock_timeout"  # object stays unloaded
    ALREADY_LOADED = "already_loaded"  # decided or loaded by another loader meanwhile
    ERROR = "error"  # unexpected failure: rolled back, object stays unloaded


TERMINAL = frozenset(
    {
        LoadStatus.LOADED,
        LoadStatus.SKIPPED_OUT_OF_ORDER,
        LoadStatus.REJECTED,
        LoadStatus.ALREADY_LOADED,
    }
)


@dataclass(frozen=True)
class QueuedObject:
    raw_id: int
    source_id: str
    group_id: str
    request_key: str
    fetched_at: datetime
    sha256: str
    fetch_mode: str
    fetch_scope: str
    manual: bool
    edition_date: date | None
    import_label: str | None
    parser_id: str
    storage_backend: str


@dataclass
class LoadCounts:
    rows_inserted: int = 0
    rows_below_tol: int = 0
    rows_tombstoned: int = 0
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class LoadContext:
    """What the insert seam gets: everything it needs, inside the locked load transaction."""

    conn: psycopg.Connection
    obj: QueuedObject
    run_id: int
    t_load: datetime  # loaded_at of every row of this load (step 1b)
    series_refs: tuple[str, ...]  # staged 'dataset|key' refs to load (out-of-order ones removed)
    import_kind: bool  # True: every row loads as load_kind 'import' (archive_import objects)


InsertFn = Callable[[LoadContext], LoadCounts]
ValidateFn = Callable[[psycopg.Connection, QueuedObject], Sequence[CheckResult]]
RestageFn = Callable[[psycopg.Connection, QueuedObject, int], None]


_OBS_COLS = (
    "series_id, ref_period_start, ref_period_end, value, value_status, load_kind, revision_class, "
    "known_at, loaded_at, source_release_at, vintage_label, source_flags, raw_id, run_id"
)


@dataclass(frozen=True)
class _Staged:
    start: date
    end: date
    value: Decimal | None
    status: str
    release_at: datetime | None
    label: str | None
    flags: str | None


def _policy(c: psycopg.Connection, obj: QueuedObject) -> tuple[ComparePolicy, bool]:
    row = c.execute(
        "SELECT compare_mode, fixed_decimals, rel_epsilon, snapshot_mode, materiality_abs, "
        "materiality_rel, reestimating FROM ref.series_group "
        "WHERE source_id = %s AND group_id = %s",
        [obj.source_id, obj.group_id],
    ).fetchone()
    if row is None:
        return ComparePolicy(), False
    return ComparePolicy(row[0], row[1], row[2], row[3], row[4], row[5]), bool(row[6])


def _latest(c: psycopg.Connection, series_id: int) -> dict[date, Stored]:
    """Latest stored version per key (``import`` rows ignored, I-CUR-3)."""
    rows = c.execute(
        "SELECT DISTINCT ON (ref_period_start) ref_period_start, value, value_status "
        "FROM curated.observation WHERE series_id = %s AND load_kind <> 'import' "
        "ORDER BY ref_period_start, known_at DESC",
        [series_id],
    ).fetchall()
    return {r[0]: Stored(r[1], r[2]) for r in rows}


def _latest_by_label(c: psycopg.Connection, series_id: int) -> dict[tuple[date, str], Stored]:
    """PROJ rule: the comparison row is the latest row of the key with the same vintage_label."""
    rows = c.execute(
        "SELECT DISTINCT ON (ref_period_start, vintage_label) ref_period_start, vintage_label, "
        "value, value_status FROM curated.observation WHERE series_id = %s "
        "AND load_kind <> 'import' AND vintage_label IS NOT NULL "
        "ORDER BY ref_period_start, vintage_label, known_at DESC",
        [series_id],
    ).fetchall()
    return {(r[0], r[1]): Stored(r[2], r[3]) for r in rows}


def _staged_rows(c: psycopg.Connection, raw_id: int, ref: str) -> list[_Staged]:
    rows = c.execute(
        "SELECT ref_period_start, ref_period_end, value, value_status, source_release_at, "
        "vintage_label, source_flags FROM staging.observation_load "
        "WHERE raw_id = %s AND series_ref = %s ORDER BY ref_period_start",
        [raw_id, ref],
    ).fetchall()
    return [_Staged(*r) for r in rows]


def _bump(d: dict[str, Any], key: str, n: int = 1) -> None:
    d[key] = d.get(key, 0) + n


def _insert_observations(ctx: LoadContext, maps: MapProvider) -> LoadCounts:
    c, obj = ctx.conn, ctx.obj
    policy, reestimating = _policy(c, obj)
    sha_row = c.execute("SELECT git_sha FROM ingest.run WHERE run_id = %s", [ctx.run_id]).fetchone()
    git_sha = "unknown" if sha_row is None else str(sha_row[0])
    c.execute("SELECT set_config('mm.run_id', %s, true)", [str(ctx.run_id)])
    c.execute("SELECT set_config('mm.git_sha', %s, true)", [git_sha])  # ref.config_history feed
    metas = read_staged_metas(c, obj.raw_id)
    entries: Sequence[MapEntry] | None = None
    counts = LoadCounts()
    det = counts.detail
    det["compare_mode"] = policy.compare_mode
    kinds: dict[str, int] = {}
    classes: dict[str, int] = {}
    unmapped: list[str] = []
    loaded: list[tuple[StoredSeries, str, set[date]]] = []
    for ref in sorted(ctx.series_refs):
        dataset, key = split_ref(ref)
        meta = metas.get(ref)
        staged = _staged_rows(c, obj.raw_id, ref)
        values = [s.value for s in staged if s.value is not None]
        stored = find_series(c, obj.source_id, dataset, key)
        if entries is None:
            entries = maps(obj.source_id, obj.group_id, git_sha)
        entry = next((e for e in entries if e.key == key and dataset in (None, e.dataset)), None)
        if stored is None:
            if entry is None:
                unmapped.append(ref)  # never created (ADR-018 decision 1)
                continue
            problems = first_sight_problems(c, entry, meta, entries)
            if problems or meta is None:
                _defer_all(ctx, ref, problems)
                _bump(det, "series_deferred")
                continue
            if unit_from_expect_used(entry, meta):
                _bump(det, "unit_from_expect")  # ADR-029 provenance
            pd = meta.values["published_decimals"]
            create_series(
                c, entry=entry, meta=meta, entries=entries, fetched_at=obj.fetched_at,
                published_decimals=pd if pd is not None else max_scale(values),
            )  # fmt: skip
            stored = find_series(c, obj.source_id, entry.dataset, entry.key)
            assert stored is not None
            _bump(det, "series_created")
        else:
            # ADR-029: the effective unit (not the staged '') is compared with the stored one
            eff = (
                with_effective_unit(entry, meta) if entry is not None and meta is not None else meta
            )
            problems = diff_meta(stored, eff) if eff is not None else []
            if problems:
                _defer_all(ctx, ref, problems)
                _bump(det, "series_deferred")
                continue
            if entry is not None and meta is not None and eff is not meta:
                _bump(det, "unit_from_expect")
            _settle_decimals(ctx, stored, meta, key, values)
            stored = find_series(c, obj.source_id, dataset, key)
            assert stored is not None
        _load_series(ctx, stored, staged, policy, reestimating, counts, kinds, classes)
        loaded.append((stored, ref, {s.start for s in staged}))
    det["load_kinds"] = kinds
    det["revision_classes"] = classes
    if unmapped:
        det["series_unmapped"] = unmapped[:20]
    if not ctx.import_kind and obj.fetch_mode == "full" and obj.fetch_scope == "complete":
        for stored, ref, present in loaded:
            _tombstone(ctx, stored, ref, present, counts)
    return counts


COMP03_MAX_SHARE = Decimal("0.05")


def _tombstone(
    ctx: LoadContext, stored: StoredSeries, ref: str, present: set[date], counts: LoadCounts
) -> None:
    """Step 8: ``DEL`` for stored keys absent from a full + complete object (I-CUR-5).

    Only series that appear in the object are examined (a series missing wholesale is not a
    statement about its keys). A ``MISS`` key is present, hence never tombstoned. COMP-03: when
    more than 5 % of the series' keys would be tombstoned, none are written for the series and an
    error result is recorded; the observation inserts of the object are kept.
    """
    c, obj = ctx.conn, ctx.obj
    rows = c.execute(
        "SELECT DISTINCT ON (ref_period_start) ref_period_start, ref_period_end, value_status "
        "FROM curated.observation WHERE series_id = %s AND load_kind <> 'import' "
        "ORDER BY ref_period_start, known_at DESC",
        [stored.series_id],
    ).fetchall()
    gone = [r for r in rows if r[0] not in present and r[2] != "DEL"]
    if not gone:
        return
    share = Decimal(len(gone)) / Decimal(len(rows))
    if share > COMP03_MAX_SHARE:
        insert_results(
            c, ctx.run_id, obj.source_id,
            [CheckResult(
                "COMP-03", Severity.ERROR, False, metric=float(share),
                threshold=float(COMP03_MAX_SHARE), subject=f"raw_id={obj.raw_id} {ref}",
                detail={"would_tombstone": len(gone), "keys": len(rows), "aborted": True},
            )],
        )  # fmt: skip
        _bump(counts.detail, "tombstones_aborted_comp03")
        return
    with c.cursor() as cur:
        cur.executemany(
            f"INSERT INTO curated.observation ({_OBS_COLS}) VALUES "
            "(%s,%s,%s,NULL,'DEL','tombstone','regular',%s,%s,NULL,NULL,NULL,%s,%s)",
            [
                (stored.series_id, r[0], r[1], obj.fetched_at, ctx.t_load, obj.raw_id, ctx.run_id)
                for r in gone
            ],
        )
    counts.rows_tombstoned += len(gone)
    _bump(counts.detail, "load_kind_tombstone", len(gone))


def _defer_all(ctx: LoadContext, ref: str, problems: Sequence[Problem]) -> None:
    first: int | None = None
    for p in problems or [Problem("schema_drift", "series_meta_load", "row", None)]:
        ev = record_drift(
            ctx.conn, run_id=ctx.run_id, source_id=ctx.obj.source_id, raw_id=ctx.obj.raw_id,
            problem=p, series_ref=ref,
        )  # fmt: skip
        first = ev if first is None else first
    assert first is not None
    defer(
        ctx.conn, run_id=ctx.run_id, raw_id=ctx.obj.raw_id, series_ref=ref, event_id=first,
        recorded_at=ctx.t_load,
    )  # fmt: skip


def _settle_decimals(
    ctx: LoadContext,
    stored: StoredSeries,
    meta: StagedMeta | None,
    key: str,
    values: list[Decimal],
) -> None:
    """Set ``published_decimals`` when NULL; raise it only on an explicit larger DECIMALS value.

    Increase-only and frozen (I-CUR-3): the scale of ordinary values never raises it later, since
    float noise (``2.1000000001``) would otherwise destroy the tolerance.
    """
    explicit = None if meta is None else meta.values["published_decimals"]
    d = stored.published_decimals
    if d is None:
        new = explicit if explicit is not None else max_scale(values)
    elif explicit is not None and explicit > d:
        new = explicit
        record_drift(
            ctx.conn,
            run_id=ctx.run_id,
            source_id=ctx.obj.source_id,
            raw_id=ctx.obj.raw_id,
            problem=Problem("precision_change", "published_decimals", d, explicit),
            series_ref=key,
            fresh=True,
        )  # fmt: skip  (series_ref = bare key: matched by ref.fn_series_published_decimals)
    else:
        return
    if new is not None:
        ctx.conn.execute(
            "UPDATE ref.series SET published_decimals = %s WHERE series_id = %s",
            [new, stored.series_id],
        )


def _load_series(
    ctx: LoadContext,
    stored: StoredSeries,
    staged: list[_Staged],
    policy: ComparePolicy,
    reestimating: bool,
    counts: LoadCounts,
    kinds: dict[str, int],
    classes: dict[str, int],
) -> None:
    c, obj = ctx.conn, ctx.obj
    latest = {} if ctx.import_kind else _latest(c, stored.series_id)
    by_label = (
        _latest_by_label(c, stored.series_id)
        if not ctx.import_kind and any(s.status == "PROJ" for s in staged)
        else {}
    )
    dim = c.execute(
        "SELECT dimension FROM ref.unit WHERE unit_code = %s", [stored.values["unit_code"]]
    ).fetchone()
    pol = replace(policy, ratio_unit=dim is not None and dim[0] == "ratio")
    rows: list[tuple[Any, ...]] = []
    for s in staged:
        if ctx.import_kind:
            kind, rclass = "import", "regular"
        else:
            prior = latest.get(s.start)
            ref_row = prior
            if s.status == "PROJ" and s.label is not None:
                ref_row = by_label.get((s.start, s.label))  # new edition: always inserts
            dec = decide(ref_row, s.value, s.status, pol, stored.published_decimals)
            if dec.fallback:
                _bump(counts.detail, "precision_fallback")
            if dec.action is Action.EQUAL:
                continue
            if dec.action is Action.BELOW_TOL:
                counts.rows_below_tol += 1
                continue
            kind = ("new_period" if latest else "initial") if prior is None else "revision"
            rclass = "reestimation" if kind == "revision" and reestimating else "regular"
            _bump(classes, rclass)
        _bump(kinds, kind)
        rows.append(
            (stored.series_id, s.start, s.end, s.value, s.status, kind, rclass, obj.fetched_at,
             ctx.t_load, s.release_at, s.label, s.flags, obj.raw_id, ctx.run_id)
        )  # fmt: skip
    if rows:
        with c.cursor() as cur:
            cur.executemany(
                f"INSERT INTO curated.observation ({_OBS_COLS}) VALUES ({','.join(['%s'] * 14)})",
                rows,
            )
    counts.rows_inserted += len(rows)


def make_insert(maps: MapProvider | None = None) -> InsertFn:
    """The T27 insert seam bound to a series-map provider (default: git config at the run's sha)."""
    provider = maps if maps is not None else git_map_provider(Path(__file__).resolve().parents[3])

    def insert(ctx: LoadContext) -> LoadCounts:
        return _insert_observations(ctx, provider)

    return insert


def insert_observations(ctx: LoadContext) -> LoadCounts:
    """Write ``curated.observation`` rows for ``ctx.series_refs`` (loader steps 6-7, T27).

    First-sight creation of ``ref.series``/``ref.series_map`` (ADR-018), drift and deferral,
    ``published_decimals``, insert-on-change at ``published_decimals`` (``compare.py``),
    ``known_at = obj.fetched_at``, ``loaded_at = ctx.t_load``. T28 adds tombstones and replay.
    Runs inside the locked transaction; raising rolls the object back (it stays unloaded). It
    writes no ``raw_load``/``request_state`` row, deletes no staging and uses no SAVEPOINT.
    """
    return make_insert()(ctx)


@dataclass(frozen=True)
class ObjectResult:
    raw_id: int
    status: LoadStatus
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class ReleaseReport:
    """Outcome of :func:`release_deferred`: ``(raw_id, series_ref)`` pairs."""

    loaded: list[tuple[int, str]] = field(default_factory=list)
    rejected: list[tuple[int, str]] = field(default_factory=list)
    pending: list[tuple[int, str, str]] = field(default_factory=list)  # with the reason


@dataclass
class DrainReport:
    results: list[ObjectResult] = field(default_factory=list)
    release: ReleaseReport = field(default_factory=ReleaseReport)

    def by_status(self, status: LoadStatus) -> list[int]:
        return [r.raw_id for r in self.results if r.status is status]

    @property
    def ok(self) -> bool:
        return all(r.status in TERMINAL for r in self.results)


# ----------------------------------------------------------------------------------- helpers


def ensure_direct(conn: psycopg.Connection) -> None:
    """Advisory locks need a direct (non-pooler) endpoint (BB20)."""
    host = conn.info.host or ""
    if is_pooled_dsn(f"host={host}"):
        raise DatabaseError("the loader needs a direct database endpoint, not the pooler (BB20)")


_OBJ_SQL = (
    "SELECT o.raw_id, o.source_id, o.group_id, o.request_key, o.fetched_at, o.sha256, "
    "o.fetch_mode, o.fetch_scope, o.manual, o.edition_date, o.import_label, o.parser_id, "
    "b.storage_backend FROM ingest.raw_object o JOIN ingest.raw_blob b USING (sha256) "
)


def _obj(row: tuple[Any, ...]) -> QueuedObject:
    return QueuedObject(
        int(row[0]), row[1], row[2], row[3], row[4], row[5], row[6], row[7], bool(row[8]),
        row[9], row[10], row[11], row[12],
    )  # fmt: skip


def read_queue(
    conn: psycopg.Connection, only: Sequence[tuple[str, str]] | None = None
) -> list[QueuedObject]:
    """Unloaded objects ordered ``(source_id, group_id, fetched_at, raw_id)``."""
    rows = conn.execute(
        _OBJ_SQL + "WHERE o.raw_id IN (SELECT raw_id FROM ingest.v_raw_unloaded) "
        "ORDER BY o.source_id, o.group_id, o.fetched_at, o.raw_id"
    ).fetchall()
    conn.rollback()
    objs = [_obj(r) for r in rows]
    if only is not None:
        keep = set(only)
        objs = [o for o in objs if (o.source_id, o.group_id) in keep]
    return objs


def _blocker(c: psycopg.Connection, obj: QueuedObject) -> int | None:
    row = c.execute(
        "SELECT raw_id FROM ingest.v_raw_unloaded WHERE source_id = %s AND group_id = %s "
        "AND (fetched_at, raw_id) < (%s, %s) ORDER BY fetched_at, raw_id LIMIT 1",
        [obj.source_id, obj.group_id, obj.fetched_at, obj.raw_id],
    ).fetchone()
    return None if row is None else int(row[0])


def _clock(c: psycopg.Connection) -> datetime:
    row = c.execute("SELECT clock_timestamp()").fetchone()
    assert row is not None
    t: datetime = row[0]
    return t


def _take_lock(c: psycopg.Connection, lock_timeout_ms: int) -> datetime:
    """Lock first, then read ``t_load`` (never ``transaction_timestamp()``, I-CUR-9)."""
    c.execute("SELECT set_config('lock_timeout', %s, true)", [f"{lock_timeout_ms}ms"])
    c.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [LOCK_NAME])
    return _clock(c)


def _staged_count(c: psycopg.Connection, raw_id: int) -> int:
    row = c.execute(
        "SELECT (SELECT count(*) FROM staging.observation_load WHERE raw_id = %(r)s) "
        "+ (SELECT count(*) FROM staging.series_meta_load WHERE raw_id = %(r)s)",
        {"r": raw_id},
    ).fetchone()
    assert row is not None
    return int(row[0])


_STAGED_REFS = (
    "SELECT series_ref FROM staging.series_meta_load WHERE raw_id = %(r)s "
    "UNION SELECT series_ref FROM staging.observation_load WHERE raw_id = %(r)s ORDER BY 1"
)

_OUT_OF_ORDER_REFS = (
    """
SELECT r.series_ref
  FROM ("""
    + _STAGED_REFS.replace("ORDER BY 1", "")
    + """) r
  JOIN ref.series s
    ON s.source_id = %(src)s
   AND s.dataset_id = split_part(r.series_ref, '|', 1)
   AND s.series_key = substr(r.series_ref, position('|' in r.series_ref) + 1)
   AND s.version = (SELECT max(v.version) FROM ref.series v
                     WHERE v.source_id = s.source_id AND v.dataset_id = s.dataset_id
                       AND v.series_key = s.series_key)
 WHERE EXISTS (SELECT 1 FROM curated.observation o
                WHERE o.series_id = s.series_id AND o.load_kind <> 'import'
                  AND o.known_at >= %(fetched)s)
 ORDER BY 1
"""
)


def _insert_raw_load(
    c: psycopg.Connection,
    obj: QueuedObject,
    run_id: int,
    outcome: str,
    t_load: datetime,
    counts: LoadCounts,
) -> None:
    c.execute(
        "INSERT INTO ingest.raw_load (raw_id, outcome, load_run_id, loaded_at, rows_inserted, "
        "rows_below_tol, rows_tombstoned, detail) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        [
            obj.raw_id,
            outcome,
            run_id,
            t_load,
            counts.rows_inserted,
            counts.rows_below_tol,
            counts.rows_tombstoned,
            Jsonb(counts.detail),
        ],
    )


def _advance_load_pointer(c: psycopg.Connection, obj: QueuedObject) -> None:
    """Load-side ``request_state`` pointers (step 9); trigger I-ING-6 checks the raw_load row."""
    cur = c.execute(
        "UPDATE ingest.request_state SET last_loaded_sha256 = %s, last_loaded_raw_id = %s "
        "WHERE source_id = %s AND request_key = %s",
        [obj.sha256, obj.raw_id, obj.source_id, obj.request_key],
    )
    if cur.rowcount == 0:  # fetch-side pointers did not advance (crash after the manifest commit)
        c.execute(
            "INSERT INTO ingest.request_state (source_id, request_key, last_url, last_sha256, "
            "last_loaded_sha256, last_loaded_raw_id) "
            "SELECT o.source_id, o.request_key, o.request_url, o.sha256, %s, %s "
            "FROM ingest.raw_object o WHERE o.raw_id = %s",
            [obj.sha256, obj.raw_id, obj.raw_id],
        )


def _delete_staging(c: psycopg.Connection, raw_id: int) -> None:
    for table in ("observation_load", "series_meta_load"):  # rejected: kept 12 months (DDL 4)
        c.execute(f"DELETE FROM staging.{table} WHERE raw_id = %s", [raw_id])


def _warn(
    c: psycopg.Connection,
    run_id: int,
    obj: QueuedObject,
    check_id: str,
    subject: str,
    metric: float,
    detail: dict[str, Any],
) -> None:
    insert_results(c, run_id, obj.source_id, [_ord_result(check_id, subject, metric, detail)])


def _ord_result(check_id: str, subject: str, metric: float, detail: dict[str, Any]) -> CheckResult:
    return CheckResult(
        check_id, Severity.WARN, False, metric=metric, subject=subject, detail=detail
    )


# ------------------------------------------------------------------------------- one object


def _locked_load(
    c: psycopg.Connection,
    obj: QueuedObject,
    run_id: int,
    insert: InsertFn,
    lock_timeout_ms: int,
    out: list[ObjectResult],
) -> None:
    t_load = _take_lock(c, lock_timeout_ms)
    if (
        c.execute("SELECT 1 FROM ingest.v_raw_unloaded WHERE raw_id = %s", [obj.raw_id]).fetchone()
        is None
    ):
        out.append(ObjectResult(obj.raw_id, LoadStatus.ALREADY_LOADED))
        return
    blocker = _blocker(c, obj)
    if blocker is not None:
        _warn(c, run_id, obj, "ORD-02", f"raw_id={obj.raw_id}", 1.0, {"blocked_by": blocker})
        out.append(ObjectResult(obj.raw_id, LoadStatus.HELD, {"blocked_by": blocker}))
        return

    import_kind = obj.import_label == "archive_import"
    ed = c.execute(
        "SELECT edition_ordered FROM ref.series_group WHERE source_id = %s AND group_id = %s",
        [obj.source_id, obj.group_id],
    ).fetchone()
    if ed is not None and ed[0] and obj.import_label is None and obj.edition_date is not None:
        newest = c.execute(
            "SELECT max(o.edition_date) FROM ingest.raw_object o JOIN ingest.raw_load l "
            "USING (raw_id) WHERE o.source_id = %s AND o.group_id = %s AND l.outcome = 'loaded'",
            [obj.source_id, obj.group_id],
        ).fetchone()
        if newest is not None and newest[0] is not None and obj.edition_date < newest[0]:
            _insert_raw_load(
                c, obj, run_id, "skipped_out_of_order", t_load,
                LoadCounts(detail={"reason": "older_edition", "newest_edition": str(newest[0])}),
            )  # fmt: skip
            _warn(
                c,
                run_id,
                obj,
                "ORD-03",
                f"raw_id={obj.raw_id}",
                1.0,
                {"edition": str(obj.edition_date)},
            )
            out.append(
                ObjectResult(
                    obj.raw_id, LoadStatus.SKIPPED_OUT_OF_ORDER, {"reason": "older_edition"}
                )
            )
            return

    refs = [r[0] for r in c.execute(_STAGED_REFS, {"r": obj.raw_id}).fetchall()]
    skipped: list[str] = []
    if not import_kind:
        skipped = [
            r[0]
            for r in c.execute(
                _OUT_OF_ORDER_REFS,
                {"r": obj.raw_id, "src": obj.source_id, "fetched": obj.fetched_at},
            ).fetchall()
        ]
    for ref in skipped:
        c.execute(
            "INSERT INTO ingest.raw_series_status "
            "(raw_id, series_ref, status, run_id, recorded_at) "
            "VALUES (%s, %s, 'skipped_out_of_order', %s, %s) ON CONFLICT DO NOTHING",
            [obj.raw_id, ref, run_id, t_load],
        )
    if skipped:
        _warn(
            c,
            run_id,
            obj,
            "ORD-01",
            f"raw_id={obj.raw_id}",
            float(len(skipped)),
            {"series": skipped[:20]},
        )
    loadable = tuple(r for r in refs if r not in set(skipped))
    if refs and not loadable:
        _insert_raw_load(
            c, obj, run_id, "skipped_out_of_order", t_load,
            LoadCounts(detail={"reason": "all_series_out_of_order", "series": len(skipped)}),
        )  # fmt: skip
        out.append(
            ObjectResult(obj.raw_id, LoadStatus.SKIPPED_OUT_OF_ORDER, {"series": len(skipped)})
        )
        return

    counts = insert(LoadContext(c, obj, run_id, t_load, loadable, import_kind))
    counts.detail.setdefault("series_loaded", len(loadable))
    if skipped:
        counts.detail["series_skipped_out_of_order"] = len(skipped)
    _insert_raw_load(c, obj, run_id, "loaded", t_load, counts)
    _advance_load_pointer(c, obj)
    _delete_staging(c, obj.raw_id)
    out.append(ObjectResult(obj.raw_id, LoadStatus.LOADED, {"rows_inserted": counts.rows_inserted}))


def _reject_unavailable(
    conn: psycopg.Connection, obj: QueuedObject, run_id: int, lock_timeout_ms: int
) -> ObjectResult:
    """hash_only object without staging rows: nothing to re-stage from (AC-ING-19)."""
    with conn.transaction():
        t_load = _take_lock(conn, lock_timeout_ms)
        if (
            conn.execute(
                "SELECT 1 FROM ingest.v_raw_unloaded WHERE raw_id = %s", [obj.raw_id]
            ).fetchone()
            is None
        ):
            return ObjectResult(obj.raw_id, LoadStatus.ALREADY_LOADED)
        _insert_raw_load(
            conn,
            obj,
            run_id,
            "rejected",
            t_load,
            LoadCounts(detail={"reason": "bytes_unavailable"}),
        )
    return ObjectResult(obj.raw_id, LoadStatus.REJECTED, {"reason": "bytes_unavailable"})


def load_object(
    conn: psycopg.Connection,
    obj: QueuedObject,
    *,
    run_id: int,
    insert: InsertFn = insert_observations,
    validate: ValidateFn | None = None,
    post_checks: PostChecksFn | None = None,
    restage: RestageFn | None = None,
    lock_timeout_ms: int = DEFAULT_LOCK_TIMEOUT_MS,
) -> ObjectResult:
    """Load one raw object (steps 1-9). The connection must be idle; it is idle on return."""
    out: list[ObjectResult] = []
    try:
        if _staged_count(conn, obj.raw_id) == 0:
            conn.rollback()
            if obj.storage_backend == "none":
                return _reject_unavailable(conn, obj, run_id, lock_timeout_ms)
            if restage is None:
                raise StagingMissingError(f"no staging rows for raw_id {obj.raw_id}")
            restage(conn, obj, run_id)
            conn.commit()
        conn.rollback()
        results = list(validate(conn, obj)) if validate is not None else []
        conn.rollback()

        def _load(c: psycopg.Connection) -> None:
            _locked_load(c, obj, run_id, insert, lock_timeout_ms, out)

        def _post(c: psycopg.Connection) -> Sequence[CheckResult]:
            if post_checks is None or not out or out[0].status is not LoadStatus.LOADED:
                return []
            return post_checks(c)

        gate = load_gated(
            conn, run_id=run_id, source_id=obj.source_id, raw_id=obj.raw_id,
            results=results, load=_load, post_checks=_post,
        )  # fmt: skip
    except pg_errors.LockNotAvailable:
        conn.rollback()
        return ObjectResult(obj.raw_id, LoadStatus.LOCK_TIMEOUT)
    except Exception as exc:
        conn.rollback()
        log.error("load of raw_id %s failed: %s", obj.raw_id, exc)
        return ObjectResult(
            obj.raw_id, LoadStatus.ERROR, {"error": f"{type(exc).__name__}: {exc}"[:500]}
        )
    if not gate.loaded:
        return ObjectResult(
            obj.raw_id, LoadStatus.BLOCKED, {"blocking": list(gate.verdict.blocking)}
        )
    return out[0]


# ----------------------------------------------------------------------------------- drain


def _record_held(conn: psycopg.Connection, run_id: int, obj: QueuedObject, blocker: int) -> None:
    insert_results(
        conn, run_id, obj.source_id,
        [_ord_result("ORD-02", f"raw_id={obj.raw_id}", 1.0, {"blocked_by": blocker})],
    )  # fmt: skip
    conn.commit()


def drain(
    conn: psycopg.Connection,
    *,
    run_id: int,
    only: Sequence[tuple[str, str]] | None = None,
    insert: InsertFn = insert_observations,
    validate: ValidateFn | None = None,
    post_checks: PostChecksFn | None = None,
    restage: RestageFn | None = None,
    lock_timeout_ms: int = DEFAULT_LOCK_TIMEOUT_MS,
    maps: MapProvider | None = None,
) -> DrainReport:
    """Drain the whole queue (requested groups plus every backlog), group by group.

    ``only`` restricts the drain to ``(source_id, group_id)`` pairs (tests, targeted runs).

    A group stops at its first object that is not terminal (blocked, error); the later objects
    are held (ORD-02) and untouched. Other groups continue. A lock timeout stops the drain.
    Draining twice leaves the database unchanged the second time (the queue is empty).

    With ``maps`` the drain finishes with :func:`release_deferred` (decided drift events, T49).
    """
    ensure_direct(conn)
    queue = read_queue(conn, only)
    report = DrainReport()
    stopped: dict[tuple[str, str], int] = {}
    for obj in queue:
        key = (obj.source_id, obj.group_id)
        if key in stopped:
            _record_held(conn, run_id, obj, stopped[key])
            report.results.append(
                ObjectResult(obj.raw_id, LoadStatus.HELD, {"blocked_by": stopped[key]})
            )
            continue
        res = load_object(
            conn, obj, run_id=run_id, insert=insert, validate=validate,
            post_checks=post_checks, restage=restage, lock_timeout_ms=lock_timeout_ms,
        )  # fmt: skip
        report.results.append(res)
        if res.status is LoadStatus.LOCK_TIMEOUT:
            break
        if res.status not in TERMINAL:
            stopped[key] = obj.raw_id
    if maps is not None:
        report.release = release_deferred(
            conn, run_id=run_id, maps=maps, restage=restage, lock_timeout_ms=lock_timeout_ms
        )
    return report


def load_raw_id(
    conn: psycopg.Connection,
    raw_id: int,
    *,
    run_id: int,
    insert: InsertFn = insert_observations,
    validate: ValidateFn | None = None,
    post_checks: PostChecksFn | None = None,
    restage: RestageFn | None = None,
    lock_timeout_ms: int = DEFAULT_LOCK_TIMEOUT_MS,
) -> ObjectResult:
    """``load --raw-id N``: one object, never out of group order (refusal: exit 10)."""
    ensure_direct(conn)
    row = conn.execute(_OBJ_SQL + "WHERE o.raw_id = %s", [raw_id]).fetchone()
    if row is None:
        conn.rollback()
        raise LoaderError(f"unknown raw_id {raw_id}")
    obj = _obj(row)
    unloaded = conn.execute(
        "SELECT 1 FROM ingest.v_raw_unloaded WHERE raw_id = %s", [raw_id]
    ).fetchone()
    blocker = _blocker(conn, obj)
    conn.rollback()
    if unloaded is None:
        return ObjectResult(raw_id, LoadStatus.ALREADY_LOADED)
    if blocker is not None:
        raise OrderRefusedError(
            f"raw_id {raw_id} is behind unloaded raw_id {blocker} of group "
            f"{obj.source_id}/{obj.group_id}; load or decide the earlier object first"
        )
    res = load_object(
        conn, obj, run_id=run_id, insert=insert, validate=validate, post_checks=post_checks,
        restage=restage, lock_timeout_ms=lock_timeout_ms,
    )  # fmt: skip
    if res.status is LoadStatus.HELD:  # lost a race: a predecessor appeared under the lock
        raise OrderRefusedError(f"raw_id {raw_id} is held behind raw_id {res.detail['blocked_by']}")
    return res


# ------------------------------------------------------------- deferral release (T49, AC-ING-12)


def _verdict(c: psycopg.Connection, obj: QueuedObject, ref: str, event_id: int | None) -> str:
    """``accepted`` | ``rejected`` | ``open`` over the events behind one deferral."""
    rows = c.execute(
        "SELECT status FROM ops.drift_event WHERE event_id = %s OR (source_id = %s AND raw_id = %s "
        "AND series_ref = %s AND kind <> 'precision_change')",
        [event_id, obj.source_id, obj.raw_id, ref],
    ).fetchall()
    states = {r[0] for r in rows}
    if "rejected" in states:
        return "rejected"
    return "accepted" if states and states == {"accepted"} else "open"


def _release_one(
    c: psycopg.Connection,
    obj: QueuedObject,
    ref: str,
    event_id: int | None,
    run_id: int,
    maps: MapProvider,
    lock_timeout_ms: int,
) -> str | None:
    """Load one accepted deferral in its own locked transaction; returns a pending reason or None.

    The series is created by the first-sight function (``create_series``): version 1 when it never
    existed, else ``version + 1`` with ``supersedes_series_id`` when the published attributes still
    differ from the stored ones (ADR-018 decision 4). The map is read at the releasing run's
    ``git_sha`` (the reviewed config commit made before the decision). Observations keep the
    object's ``known_at`` (``fetched_at``).
    """
    t_load = _take_lock(c, lock_timeout_ms)
    if (
        c.execute(
            "SELECT 1 FROM ingest.v_series_deferred WHERE raw_id = %s AND series_ref = %s",
            [obj.raw_id, ref],
        ).fetchone()
        is None
    ):
        return None  # released meanwhile
    sha_row = c.execute("SELECT git_sha FROM ingest.run WHERE run_id = %s", [run_id]).fetchone()
    git_sha = "unknown" if sha_row is None else str(sha_row[0])
    c.execute("SELECT set_config('mm.run_id', %s, true)", [str(run_id)])
    c.execute("SELECT set_config('mm.git_sha', %s, true)", [git_sha])
    meta = read_staged_metas(c, obj.raw_id).get(ref)
    staged = _staged_rows(c, obj.raw_id, ref)
    if meta is None or not staged:
        return "no_staged_rows"
    dataset, key = split_ref(ref)
    stored = find_series(c, obj.source_id, dataset, key)
    if stored is not None and obj.import_label != "archive_import":
        later = c.execute(  # ORD-01 also holds for released deferrals (no late row inserted)
            "SELECT 1 FROM curated.observation o WHERE o.series_id = %s "
            "AND o.load_kind <> 'import' AND o.known_at >= %s LIMIT 1",
            [stored.series_id, obj.fetched_at],
        ).fetchone()
        if later is not None:
            cur = c.execute(
                "INSERT INTO ingest.raw_series_status "
                "(raw_id, series_ref, status, event_id, run_id, recorded_at) "
                "VALUES (%s, %s, 'skipped_out_of_order', %s, %s, %s) ON CONFLICT DO NOTHING",
                [obj.raw_id, ref, event_id, run_id, t_load],
            )
            if cur.rowcount:  # warn once, not on every later drain
                _warn(c, run_id, obj, "ORD-01", f"raw_id={obj.raw_id}", 1.0, {"series": [ref]})
            return "skipped_out_of_order"
    entries = maps(obj.source_id, obj.group_id, git_sha)
    entry = next((e for e in entries if e.key == key and dataset in (None, e.dataset)), None)
    # ADR-029: the effective unit is compared with the stored one and written by create_series
    diff = (
        []
        if stored is None
        else diff_meta(stored, meta if entry is None else with_effective_unit(entry, meta))
    )
    if stored is None or diff:
        if entry is None:
            return "not_in_series_map"
        if first_sight_problems(c, entry, meta, entries):
            return "config_not_updated"
        pd = meta.values["published_decimals"]
        values = [s.value for s in staged if s.value is not None]
        create_series(
            c, entry=entry, meta=meta, entries=entries, fetched_at=obj.fetched_at,
            published_decimals=pd if pd is not None else max_scale(values),
            version=1 if stored is None else stored.version + 1,
            supersedes_series_id=None if stored is None else stored.series_id,
        )  # fmt: skip
        stored = find_series(c, obj.source_id, entry.dataset, entry.key)
    assert stored is not None
    policy, reestimating = _policy(c, obj)
    ctx = LoadContext(c, obj, run_id, t_load, (ref,), obj.import_label == "archive_import")
    _load_series(ctx, stored, staged, policy, reestimating, LoadCounts(), {}, {})
    c.execute(
        "INSERT INTO ingest.raw_series_status (raw_id, series_ref, status, event_id, run_id, "
        "recorded_at) VALUES (%s,%s,'loaded',%s,%s,%s)",
        [obj.raw_id, ref, event_id, run_id, t_load],
    )
    return None


def release_deferred(
    conn: psycopg.Connection,
    *,
    run_id: int,
    maps: MapProvider,
    restage: RestageFn | None = None,
    lock_timeout_ms: int = DEFAULT_LOCK_TIMEOUT_MS,
) -> ReleaseReport:
    """Resolve pending ``deferred`` series once their drift events are decided.

    Rejected: append ``'rejected'``, load nothing. Accepted: re-stage the object from its stored
    raw bytes (``restage``; no refetch), create the new series version if the published attributes
    still differ and load the series. Open events, a missing ``restage`` or a config that was not
    updated first leave the deferral pending (reported, never an error).
    """
    rep = ReleaseReport()
    pend = conn.execute(
        "SELECT raw_id, series_ref, event_id FROM ingest.v_series_deferred ORDER BY 1, 2"
    ).fetchall()
    conn.rollback()
    by_raw: dict[int, list[tuple[str, int | None]]] = {}
    for raw_id, ref, ev in pend:
        by_raw.setdefault(int(raw_id), []).append((ref, ev))
    for raw_id, items in by_raw.items():
        row = conn.execute(_OBJ_SQL + "WHERE o.raw_id = %s", [raw_id]).fetchone()
        assert row is not None
        obj = _obj(row)
        verdicts = {ref: _verdict(conn, obj, ref, ev) for ref, ev in items}
        conn.rollback()
        events = dict(items)
        for ref, v in verdicts.items():
            if v == "open":
                rep.pending.append((raw_id, ref, "event_open"))
        rejected = [r for r, v in verdicts.items() if v == "rejected"]
        if rejected:
            with conn.transaction():
                t_load = _take_lock(conn, lock_timeout_ms)
                for ref in rejected:
                    conn.execute(
                        "INSERT INTO ingest.raw_series_status (raw_id, series_ref, status, "
                        "event_id, run_id, recorded_at) VALUES (%s,%s,'rejected',%s,%s,%s) "
                        "ON CONFLICT DO NOTHING",
                        [raw_id, ref, events[ref], run_id, t_load],
                    )
            rep.rejected += [(raw_id, r) for r in rejected]
        accepted = [r for r, v in verdicts.items() if v == "accepted"]
        if not accepted:
            continue
        restaged = False
        if _staged_count(conn, raw_id) == 0:
            conn.rollback()
            if restage is None:
                rep.pending += [(raw_id, r, "restage_unavailable") for r in accepted]
                continue
            try:
                restage(conn, obj, run_id)
                conn.commit()
            except LoaderError as exc:  # bytes missing/corrupt, parser unknown: stay pending
                conn.rollback()
                rep.pending += [(raw_id, r, f"restage_failed: {exc}"[:200]) for r in accepted]
                continue
            restaged = True
        conn.rollback()
        for ref in accepted:
            with conn.transaction():
                reason = _release_one(conn, obj, ref, events[ref], run_id, maps, lock_timeout_ms)
            if reason is None:
                rep.loaded.append((raw_id, ref))
            else:
                rep.pending.append((raw_id, ref, reason))
        if restaged:
            with conn.transaction():
                _delete_staging(conn, raw_id)
    return rep
