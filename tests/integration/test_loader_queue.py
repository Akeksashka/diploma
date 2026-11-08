# ruff: noqa: E501
"""T26 loader A against a throwaway database: queue, lock, order, idempotence.

AC-ING-5(a)(c)(d), AC-ING-7, AC-ING-8, AC-ING-9 (staging of other runs untouched, drains equal
sequential execution), AC-ING-15 scenarios A and B (loader side), T-DDL-17, T-DDL-20. The insert
seam is replaced by a stub that writes one observation per staged row (T27 owns the real one).
"""

from __future__ import annotations

import calendar
import threading
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any

import psycopg
import pytest
from psycopg import errors

from macro_monitor.storage import loader, manifest, migrate
from macro_monitor.storage.loader import LoadContext, LoadCounts, LoadStatus
from macro_monitor.validation.checks import CheckResult, Severity

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

T0 = datetime(2026, 11, 1, 6, 0, tzinfo=UTC)
P1, P2 = date(2026, 1, 1), date(2026, 2, 1)


def stub_insert(ctx: LoadContext) -> LoadCounts:
    """Stand-in for the T27 seam: one row per staged observation of a loadable series."""
    c = ctx.conn
    n = 0
    for ref in ctx.series_refs:
        dataset, key = ref.split("|", 1)
        row = c.execute(
            "SELECT series_id FROM ref.series WHERE source_id=%s AND dataset_id=%s AND series_key=%s",
            [ctx.obj.source_id, dataset, key],
        ).fetchone()
        if row is None:
            continue
        cur = c.execute(
            "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, "
            "value_status, load_kind, known_at, loaded_at, raw_id, run_id) "
            "SELECT %s, ref_period_start, (ref_period_start + interval '1 month')::date - 1, value, "
            "value_status, %s, %s, %s, %s, %s FROM staging.observation_load "
            "WHERE raw_id = %s AND series_ref = %s",
            [
                row[0],
                "import" if ctx.import_kind else "initial",
                ctx.obj.fetched_at,
                ctx.t_load,
                ctx.obj.raw_id,
                ctx.run_id,
                ctx.obj.raw_id,
                ref,
            ],
        )
        n += cur.rowcount
    return LoadCounts(rows_inserted=n)


@pytest.fixture
def conn(test_database: TestDatabase) -> Iterator[psycopg.Connection]:
    with test_database.connect() as c:
        migrate.migrate(c)
        c.execute(
            "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)"
        )
        c.execute(
            "INSERT INTO ref.source VALUES ('H','p','rest','hash_only','public','l','a','x',true)"
        )
        for src, grp, ed in (
            ("S", "G1", False),
            ("S", "G2", False),
            ("S", "ED", True),
            ("H", "G1", False),
        ):
            c.execute(
                "INSERT INTO ref.series_group (source_id, group_id, edition_ordered, config_sha256) "
                "VALUES (%s,%s,%s,'x')",
                [src, grp, ed],
            )
        c.execute("INSERT INTO ref.entity VALUES ('E1','One','country',true,false)")
        c.execute("INSERT INTO ref.unit VALUES ('PC','ratio','percent')")
        c.commit()
        yield c


class Fx:
    def __init__(self, c: psycopg.Connection) -> None:
        self.c = c
        row = c.execute(
            "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, "
            "status) VALUES ('w','local','refresh','g','c', now(), 'running') RETURNING run_id"
        ).fetchone()
        assert row is not None
        self.run_id = int(row[0])
        c.commit()
        self.n = 0

    def series(self, key: str, src: str = "S", grp: str = "G1") -> int:
        row = self.c.execute(
            "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, "
            "frequency, unit_code, price_basis, seasonal_adjustment, first_seen_at) "
            "VALUES (%s,%s,'d',%s,'E1','t','M','PC','NA','NA', now()) RETURNING series_id",
            [src, grp, key],
        ).fetchone()
        self.c.commit()
        assert row is not None
        return int(row[0])

    def obj(
        self,
        at: datetime,
        refs: dict[str, list[tuple[date, str]]],
        *,
        src: str = "S",
        grp: str = "G1",
        key: str | None = None,
        backend: str = "local_dir",
        stage: bool = True,
        **kw: Any,
    ) -> int:
        self.n += 1
        kw = {"fetch_mode": "full", "fetch_scope": "complete", **kw}
        key = key or f"{grp}-req{self.n}"
        sha = f"{self.n:064x}"
        manifest.insert_blob(
            self.c, sha256=sha, byte_count=1, storage_backend=backend,
            storage_ref=None if backend == "none" else f"x/{self.n}", first_stored_at=at,
        )  # fmt: skip
        prev = manifest.latest_state(self.c, src, key).raw_id
        raw_id = manifest.insert_raw_object(
            self.c,
            manifest.NewRawObject(
                run_id=self.run_id, source_id=src, group_id=grp, request_key=key,
                request_url="https://x/", request_params={}, http_status=200, etag=None,
                last_modified=None, content_type=None, fetched_at=at, sha256=sha,
                parser_id="p@1", **kw,
            ),
            prev,
        )  # fmt: skip
        manifest.advance_fetch_pointers(
            self.c, source_id=src, request_key=key, url="https://x/", checked_at=at,
            status="new", sha256=sha, changed=True,
        )  # fmt: skip
        if stage:
            for ref, rows in refs.items():
                self.c.execute(
                    "INSERT INTO staging.series_meta_load (run_id, raw_id, series_ref) "
                    "VALUES (%s,%s,%s)",
                    [self.run_id, raw_id, ref],
                )
                for period, val in rows:
                    self.c.execute(
                        "INSERT INTO staging.observation_load (run_id, raw_id, series_ref, "
                        "ref_period_start, ref_period_end, value, value_status, row_hash) "
                        "VALUES (%s,%s,%s,%s,%s,%s,'OBS','h')",
                        [self.run_id, raw_id, ref, period, _month_end(period), val],
                    )
        self.c.commit()
        return raw_id


def _month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def one(c: psycopg.Connection, sql: str, *args: object) -> Any:
    row = c.execute(sql, list(args)).fetchone()  # type: ignore[arg-type]
    c.rollback()
    assert row is not None
    return row[0]


def snapshot(c: psycopg.Connection) -> dict[str, Any]:
    tabs = {
        "obs": "SELECT obs_id, series_id, ref_period_start, value, known_at, loaded_at, raw_id "
        "FROM curated.observation ORDER BY obs_id",
        "load": "SELECT raw_id, outcome, loaded_at, rows_inserted, detail FROM ingest.raw_load ORDER BY 1",
        "rs": "SELECT * FROM ingest.request_state ORDER BY 1, 2",
        "stg": "SELECT raw_id, series_ref, ref_period_start FROM staging.observation_load ORDER BY 1,2,3",
        "ss": "SELECT raw_id, series_ref, status FROM ingest.raw_series_status ORDER BY 1,2,3",
    }
    out = {k: [tuple(r) for r in c.execute(q).fetchall()] for k, q in tabs.items()}
    c.rollback()
    return out


def drain(c: psycopg.Connection, fx: Fx, **kw: Any) -> loader.DrainReport:
    kw.setdefault("insert", stub_insert)
    kw.setdefault("lock_timeout_ms", 3000)
    return loader.drain(c, run_id=fx.run_id, **kw)


def test_drain_order_state_and_idempotence(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    fx.series("a")
    fx.series("b")
    # inserted out of fetched_at order on purpose: o2 (later request) first in id order
    o_late = fx.obj(T0 + timedelta(hours=2), {"d|b": [(P1, "2")]}, key="rb")
    o_early = fx.obj(T0 + timedelta(hours=1), {"d|a": [(P1, "1")]}, key="ra")
    # manifest accepts any order across request keys; queue order must be by fetched_at
    q = loader.read_queue(conn)
    assert [o.raw_id for o in q] == [o_early, o_late]

    # AC-ING-5(a): fetch pointer ahead of the load pointer before the drain
    assert (
        one(conn, "SELECT last_loaded_sha256 FROM ingest.request_state WHERE request_key='ra'")
        is None
    )
    rep = drain(conn, fx)
    assert [r.raw_id for r in rep.results] == [o_early, o_late]
    assert all(r.status is LoadStatus.LOADED for r in rep.results)
    assert rep.ok

    assert one(conn, "SELECT count(*) FROM ingest.v_raw_unloaded") == 0
    # pointers: last_loaded = last_sha256 (AC-ING-5a); known_at = original fetched_at
    assert one(
        conn,
        "SELECT bool_and(last_loaded_sha256 = last_sha256 AND last_loaded_raw_id IS NOT NULL) "
        "FROM ingest.request_state",
    )
    assert one(conn, "SELECT known_at FROM curated.observation WHERE raw_id=%s", o_early) == (
        T0 + timedelta(hours=1)
    )
    # loaded_at: one t_load per object, shared by raw_load and its rows, later than the fetch
    assert one(
        conn,
        "SELECT bool_and(o.loaded_at = l.loaded_at AND l.loaded_at > o.known_at) "
        "FROM curated.observation o JOIN ingest.raw_load l USING (raw_id)",
    )
    assert one(
        conn, "SELECT (SELECT loaded_at FROM ingest.raw_load WHERE raw_id=%s) <= "
        "(SELECT loaded_at FROM ingest.raw_load WHERE raw_id=%s)", o_early, o_late,
    )  # fmt: skip
    # staging of loaded objects is gone
    assert one(conn, "SELECT count(*) FROM staging.observation_load") == 0

    before = snapshot(conn)
    again = drain(conn, fx)
    assert again.results == []
    assert snapshot(conn) == before  # drain twice: identical state (step 10)


def test_staging_of_other_run_untouched_and_equal_to_sequential(conn: psycopg.Connection) -> None:
    """AC-ING-5(c) / AC-ING-9: only the loaded object's rows are deleted."""
    fx = Fx(conn)
    fx.series("a")
    fx.series("c", grp="G2")
    o1 = fx.obj(T0, {"d|a": [(P1, "1")]}, grp="G1")
    o2 = fx.obj(T0, {"d|c": [(P1, "3")]}, grp="G2")
    loader.load_object(
        conn, loader.read_queue(conn, [("S", "G1")])[0], run_id=fx.run_id, insert=stub_insert
    )
    assert one(conn, "SELECT count(*) FROM staging.observation_load WHERE raw_id=%s", o1) == 0
    assert one(conn, "SELECT count(*) FROM staging.observation_load WHERE raw_id=%s", o2) == 1
    drain(conn, fx)
    assert one(conn, "SELECT count(*) FROM curated.observation") == 2
    assert one(conn, "SELECT count(*) FROM ingest.raw_load WHERE outcome='loaded'") == 2


def test_validation_error_rolls_back_then_retry_loads_from_stored_staging(
    conn: psycopg.Connection,
) -> None:
    """AC-ING-5(d) and AC-ING-7: failed load keeps staging and pointers; later load succeeds."""
    fx = Fx(conn)
    fx.series("a")
    o = fx.obj(T0, {"d|a": [(P1, "1")]})
    bad = CheckResult("RAW-01", Severity.ERROR, False, metric=500.0)

    rep = drain(conn, fx, validate=lambda c, ob: [bad])
    assert rep.results[0].status is LoadStatus.BLOCKED
    assert one(conn, "SELECT count(*) FROM ingest.raw_load") == 0
    assert one(conn, "SELECT count(*) FROM curated.observation") == 0
    assert one(conn, "SELECT count(*) FROM staging.observation_load WHERE raw_id=%s", o) == 1
    assert one(conn, "SELECT last_loaded_sha256 FROM ingest.request_state") is None
    assert one(conn, "SELECT count(*) FROM ingest.v_raw_unloaded") == 1

    # post-check error also rolls the load back
    post_bad = drain(conn, fx, post_checks=lambda c: [bad])
    assert post_bad.results[0].status is LoadStatus.BLOCKED
    assert one(conn, "SELECT count(*) FROM curated.observation") == 0
    assert one(conn, "SELECT count(*) FROM staging.observation_load WHERE raw_id=%s", o) == 1

    # condition gone; no refetch; known_at is the original fetched_at
    rep = drain(conn, fx)
    assert rep.results[0].status is LoadStatus.LOADED
    assert one(conn, "SELECT known_at FROM curated.observation") == T0
    assert one(conn, "SELECT last_loaded_raw_id FROM ingest.request_state") == o


def test_exception_in_insert_leaves_object_queued(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    fx.series("a")
    fx.obj(T0, {"d|a": [(P1, "1")]})

    def boom(ctx: LoadContext) -> LoadCounts:
        stub_insert(ctx)
        raise RuntimeError("boom")

    rep = drain(conn, fx, insert=boom)
    assert rep.results[0].status is LoadStatus.ERROR
    assert one(conn, "SELECT count(*) FROM curated.observation") == 0
    assert one(conn, "SELECT count(*) FROM ingest.raw_load") == 0
    assert one(conn, "SELECT count(*) FROM staging.observation_load") == 1


def test_group_order_hold_and_raw_id_refusal(conn: psycopg.Connection) -> None:
    """AC-ING-8 / T-DDL-17: O2 is held behind failing O1; --raw-id O2 is refused."""
    fx = Fx(conn)
    fx.series("a")
    fx.series("c", grp="G2")
    o1 = fx.obj(T0, {"d|a": [(P1, "1")]}, key="r1")
    o2 = fx.obj(T0 + timedelta(hours=1), {"d|a": [(P2, "2")]}, key="r2")  # other request key
    o_other = fx.obj(T0, {"d|c": [(P1, "3")]}, grp="G2")  # other group: unaffected
    bad = CheckResult("RAW-01", Severity.ERROR, False, metric=500.0)

    rep = drain(conn, fx, validate=lambda c, ob: [bad] if ob.raw_id == o1 else [])
    st = {r.raw_id: r.status for r in rep.results}
    assert st == {o1: LoadStatus.BLOCKED, o2: LoadStatus.HELD, o_other: LoadStatus.LOADED}
    assert one(conn, "SELECT count(*) FROM ingest.raw_load") == 1
    assert one(
        conn, "SELECT detail->>'blocked_by' FROM ops.validation_result WHERE check_id='ORD-02'"
    ) == str(o1)
    with pytest.raises(loader.OrderRefusedError) as ei:
        loader.load_raw_id(conn, o2, run_id=fx.run_id, insert=stub_insert)
    assert ei.value.exit_code == 10
    assert one(conn, "SELECT count(*) FROM curated.observation WHERE raw_id=%s", o2) == 0

    # human decision on O1 (skipped_by_decision) releases O2
    conn.execute(
        "INSERT INTO ingest.raw_load (raw_id, outcome, load_run_id, loaded_at) "
        "VALUES (%s,'skipped_by_decision',%s, clock_timestamp())",
        [o1, fx.run_id],
    )
    conn.commit()
    res = loader.load_raw_id(conn, o2, run_id=fx.run_id, insert=stub_insert)
    assert res.status is LoadStatus.LOADED
    assert loader.load_raw_id(conn, o2, run_id=fx.run_id, insert=stub_insert).status is (
        LoadStatus.ALREADY_LOADED
    )


def test_series_out_of_order_skipped_per_series(conn: psycopg.Connection) -> None:
    """ORD-01 / T-DDL-17: per-series skip; all-skipped object is recorded skipped_out_of_order."""
    fx = Fx(conn)
    fx.series("a")
    fx.series("b")
    # later object of ANOTHER group loaded first (e.g. the manual inbox)
    late = fx.obj(T0 + timedelta(hours=5), {"d|a": [(P1, "9")]}, grp="G2", key="manual")
    drain(conn, fx, only=[("S", "G2")])
    early_mixed = fx.obj(T0, {"d|a": [(P1, "1")], "d|b": [(P1, "2")]}, key="e1")
    early_all = fx.obj(T0 + timedelta(hours=1), {"d|a": [(P2, "1")]}, key="e2")
    rep = drain(conn, fx)
    st = {r.raw_id: r.status for r in rep.results}
    assert st == {
        early_mixed: LoadStatus.LOADED,
        early_all: LoadStatus.SKIPPED_OUT_OF_ORDER,
    }
    assert one(conn, "SELECT count(*) FROM curated.observation WHERE raw_id=%s", early_mixed) == 1
    assert one(conn, "SELECT count(*) FROM curated.observation WHERE raw_id=%s", early_all) == 0
    assert (
        one(conn, "SELECT count(*) FROM ingest.raw_load WHERE outcome='skipped_out_of_order'") == 1
    )
    assert (
        one(
            conn,
            "SELECT series_ref||status FROM ingest.raw_series_status WHERE raw_id=%s",
            early_mixed,
        )
        == "d|askipped_out_of_order"
    )
    assert (
        one(
            conn,
            "SELECT metric FROM ops.validation_result WHERE check_id='ORD-01' ORDER BY 1 LIMIT 1",
        )
        == 1
    )
    assert late  # the later object stays the latest state
    assert (
        one(conn, "SELECT value FROM curated.v_observation_latest WHERE ref_period_start=%s", P1)
        == 9
    )
    # a skipped object is terminal: it does not block later objects of the group
    nxt = fx.obj(T0 + timedelta(hours=6), {"d|b": [(P2, "5")]}, key="e1")
    assert drain(conn, fx).results[0].raw_id == nxt


def test_edition_order_older_edition_skipped(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    fx.series("a", grp="ED")
    e2 = fx.obj(T0 + timedelta(hours=1), {"d|a": [(P1, "2")]}, grp="ED", key="m2",
                manual=True, edition_date=date(2026, 10, 13))  # fmt: skip
    e1 = fx.obj(T0 + timedelta(hours=2), {"d|a": [(P2, "1")]}, grp="ED", key="m1",
                manual=True, edition_date=date(2026, 4, 14))  # fmt: skip
    imp = fx.obj(T0 + timedelta(hours=3), {"d|a": [(date(2025, 1, 1), "0")]}, grp="ED", key="m3",
                 manual=True, edition_date=date(2026, 4, 14), import_label="archive_import")  # fmt: skip
    seen: list[bool] = []

    def ins(ctx: LoadContext) -> LoadCounts:
        seen.append(ctx.import_kind)
        return stub_insert(ctx)

    rep = drain(conn, fx, insert=ins)
    st = {r.raw_id: r.status for r in rep.results}
    assert st == {
        e2: LoadStatus.LOADED,
        e1: LoadStatus.SKIPPED_OUT_OF_ORDER,
        imp: LoadStatus.LOADED,
    }
    assert seen == [False, True]
    assert (
        one(conn, "SELECT detail->>'reason' FROM ingest.raw_load WHERE raw_id=%s", e1)
        == "older_edition"
    )
    assert one(conn, "SELECT count(*) FROM ops.validation_result WHERE check_id='ORD-03'") == 1


def test_missing_staging_restage_hook_and_hash_only(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    fx.series("a")
    o = fx.obj(T0, {"d|a": [(P1, "1")]}, stage=False)
    # no staging, no restager: stays queued
    assert drain(conn, fx).results[0].status is LoadStatus.ERROR
    assert one(conn, "SELECT count(*) FROM ingest.raw_load") == 0

    def restage(c: psycopg.Connection, ob: loader.QueuedObject, run_id: int) -> None:
        c.execute(
            "INSERT INTO staging.observation_load (run_id, raw_id, series_ref, ref_period_start, "
            "ref_period_end, value, value_status, row_hash) VALUES (%s,%s,'d|a',%s,%s,5,'OBS','h')",
            [run_id, ob.raw_id, P1, P1],
        )

    rep = drain(conn, fx, restage=restage)
    assert rep.results[0].status is LoadStatus.LOADED
    assert one(conn, "SELECT value FROM curated.observation WHERE raw_id=%s", o) == 5

    h = fx.obj(T0, {}, src="H", grp="G1", backend="none", stage=False)
    rep = drain(conn, fx)
    assert rep.results[0].status is LoadStatus.REJECTED
    assert one(conn, "SELECT detail->>'reason' FROM ingest.raw_load WHERE raw_id=%s", h) == (
        "bytes_unavailable"
    )


def test_lock_timeout_leaves_object_queued(
    conn: psycopg.Connection, test_database: TestDatabase
) -> None:
    fx = Fx(conn)
    fx.series("a")
    o = fx.obj(T0, {"d|a": [(P1, "1")]})
    with test_database.connect() as holder:
        holder.execute("SELECT pg_advisory_xact_lock(hashtext('mm-load'))")
        rep = drain(conn, fx, lock_timeout_ms=300)
        assert rep.results[0].status is LoadStatus.LOCK_TIMEOUT
        assert not rep.ok
        holder.rollback()
    assert one(conn, "SELECT count(*) FROM ingest.raw_load") == 0
    assert one(conn, "SELECT count(*) FROM staging.observation_load WHERE raw_id=%s", o) == 1
    assert drain(conn, fx).results[0].status is LoadStatus.LOADED  # the next drain takes it


def test_loaded_row_in_top_level_transaction(conn: psycopg.Connection) -> None:
    """I-ING-6 / xmin: the trigger accepts the pointer update only for a same-transaction row."""
    fx = Fx(conn)
    fx.series("a")
    o = fx.obj(T0, {"d|a": [(P1, "1")]})
    drain(conn, fx)
    row = conn.execute(
        "SELECT l.xmin::text, o.xmin::text FROM ingest.raw_load l, curated.observation o "
        "WHERE l.raw_id=%s AND o.raw_id=%s",
        [o, o],
    ).fetchone()
    conn.rollback()
    assert row is not None
    assert row[0] == row[1]  # raw_load and observation rows share one transaction
    # a pointer move without a same-transaction loaded row is refused by the DB
    with pytest.raises(errors.RestrictViolation):
        conn.execute("UPDATE ingest.request_state SET last_loaded_raw_id = last_loaded_raw_id + 1")
    conn.rollback()


def test_loaded_at_cutoff_scenario_a_straddling_load(
    conn: psycopg.Connection, test_database: TestDatabase
) -> None:
    """AC-ING-15 A / T-DDL-20: analytics blocks on the load lock; its cutoff is >= t_load."""
    fx = Fx(conn)
    fx.series("a")
    fx.obj(T0, {"d|a": [(P1, "1")]})
    inserted, release = threading.Event(), threading.Event()
    result: list[loader.DrainReport] = []

    def slow_insert(ctx: LoadContext) -> LoadCounts:
        counts = stub_insert(ctx)
        inserted.set()
        assert release.wait(20)
        return counts

    def run() -> None:
        with test_database.connect(timeout=30) as lc:
            result.append(
                loader.drain(lc, run_id=fx.run_id, insert=slow_insert, lock_timeout_ms=5000)
            )

    th = threading.Thread(target=run)
    th.start()
    try:
        assert inserted.wait(20)
        with test_database.connect() as r:
            r.execute("SELECT set_config('lock_timeout','300ms',false)")
            with pytest.raises(errors.LockNotAvailable):  # R blocks while L holds the lock
                r.execute("SELECT pg_advisory_xact_lock(hashtext('mm-load'))")
            r.rollback()
            release.set()
            th.join(20)
            r.execute("SELECT set_config('lock_timeout','5s',false)")
            r.execute("SELECT pg_advisory_xact_lock(hashtext('mm-load'))")
            row = r.execute("SELECT clock_timestamp()").fetchone()
            assert row is not None
            cutoff = row[0]
            t_load = r.execute("SELECT loaded_at FROM ingest.raw_load").fetchone()
            assert t_load is not None
            assert cutoff >= t_load[0]
            n = r.execute(
                "SELECT count(*) FROM curated.fn_observation_asof(%s, %s)", [cutoff, cutoff]
            ).fetchone()
            assert n is not None
            assert n[0] == 1
    finally:
        release.set()
        th.join(20)
    assert result[0].ok


def test_loaded_at_cutoff_scenario_b_held_back_object(conn: psycopg.Connection) -> None:
    """AC-ING-15 B: P fetched at t1, cutoff c at t2, P loaded at t3 with known_at = t1."""
    fx = Fx(conn)
    fx.series("a")
    t1 = datetime.now(UTC) - timedelta(minutes=30)
    fx.obj(t1, {"d|a": [(P1, "1")]})
    cutoff = one(conn, "SELECT clock_timestamp()")
    drain(conn, fx)
    assert one(conn, "SELECT loaded_at > %s FROM ingest.raw_load", cutoff)
    assert one(conn, "SELECT known_at FROM curated.observation") == t1
    assert (
        one(conn, "SELECT count(*) FROM curated.fn_observation_asof(%s, %s)", cutoff, cutoff) == 0
    )
    assert one(conn, "SELECT count(*) FROM curated.fn_observation_asof(%s)", cutoff) == 1


def test_default_insert_seam_is_the_real_loader(conn: psycopg.Connection) -> None:
    """T27: the default seam loads existing series and never creates an unmapped one."""
    fx = Fx(conn)
    fx.series("a")
    fx.obj(T0, {"d|a": [(P1, "1")], "d|nope": [(P1, "2")]})
    rep = loader.drain(conn, run_id=fx.run_id)
    assert rep.results[0].status is LoadStatus.LOADED
    assert one(conn, "SELECT load_kind FROM curated.observation") == "initial"
    assert one(conn, "SELECT known_at FROM curated.observation") == T0
    assert one(conn, "SELECT count(*) FROM ref.series") == 1
    assert one(conn, "SELECT detail->'series_unmapped' FROM ingest.raw_load") == ["d|nope"]


def test_edition_order_real_insert_successor_and_import(conn: psycopg.Connection) -> None:
    """T47 / AC-ING-18: E2 then E1 (skipped, terminal), E3 not blocked, import loads as import."""
    fx = Fx(conn)
    fx.series("a", grp="ED")
    e2 = fx.obj(T0 + timedelta(hours=1), {"d|a": [(P1, "2")]}, grp="ED", key="m2",
                manual=True, edition_date=date(2026, 10, 13))  # fmt: skip
    e1 = fx.obj(T0 + timedelta(hours=2), {"d|a": [(P2, "1")]}, grp="ED", key="m1",
                manual=True, edition_date=date(2026, 4, 14))  # fmt: skip
    e3 = fx.obj(T0 + timedelta(hours=3), {"d|a": [(P2, "3")]}, grp="ED", key="m3",
                manual=True, edition_date=date(2026, 11, 12))  # fmt: skip
    imp = fx.obj(T0 + timedelta(hours=4), {"d|a": [(date(2025, 1, 1), "0")]}, grp="ED", key="m4",
                 manual=True, edition_date=date(2026, 11, 12), import_label="archive_import")  # fmt: skip
    rep = loader.drain(conn, run_id=fx.run_id, lock_timeout_ms=3000)
    st = {r.raw_id: r.status for r in rep.results}
    assert st == {
        e2: LoadStatus.LOADED,
        e1: LoadStatus.SKIPPED_OUT_OF_ORDER,
        e3: LoadStatus.LOADED,
        imp: LoadStatus.LOADED,
    }
    assert one(conn, "SELECT count(*) FROM curated.observation WHERE raw_id=%s", e1) == 0
    assert one(conn, "SELECT load_kind FROM curated.observation WHERE raw_id=%s", imp) == "import"
    assert one(conn, "SELECT load_kind FROM curated.observation WHERE raw_id=%s", e3) != "import"
