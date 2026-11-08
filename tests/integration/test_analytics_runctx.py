# ruff: noqa: E501
"""T36: AC-ING-15 / T-DDL-20 / T-DDL-28 under mm_analytics; hash-mismatch reporting."""

from __future__ import annotations

import threading
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any

import psycopg
import pytest

from macro_monitor.analytics import runctx
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

H = {
    "git_sha": "g1",
    "config_sha256": "c1",
    "mapping_sha256": "m1",
    "overrides_sha256": "o1",
}


class Env:
    def __init__(self, db: TestDatabase) -> None:
        self.db = db
        with db.connect(timeout=60) as a:
            a.execute(
                "INSERT INTO ref.source VALUES ('P','p','rest','public','public','l','a','x',true)"
            )
            a.execute(
                "INSERT INTO ref.series_group (source_id, group_id, edition_ordered, config_sha256) "
                "VALUES ('P','G',false,'x')"
            )
            a.execute("INSERT INTO ref.entity VALUES ('E1','One','country',true,false)")
            a.execute("INSERT INTO ref.unit VALUES ('PC','ratio','percent')")
            self.series_id = a.execute(
                "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, "
                "title, frequency, unit_code, price_basis, seasonal_adjustment, calendar_basis, "
                "first_seen_at) VALUES ('P','G','d','k','E1','t','A','PC','NA','NA','CAL', now()) "
                "RETURNING series_id"
            ).fetchone()[0]  # type: ignore[index]
            self.run_id = a.execute(
                "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, "
                "started_at, status) VALUES ('w','local','refresh','g','c', now(), 'running') "
                "RETURNING run_id"
            ).fetchone()[0]  # type: ignore[index]
            a.execute("INSERT INTO ingest.raw_blob VALUES ('s',1,'local_dir','s',now())")
            self.raw_id = a.execute(
                "INSERT INTO ingest.raw_object (run_id, source_id, group_id, request_key, "
                "request_url, request_params, http_status, fetched_at, sha256, fetch_mode, "
                "fetch_scope, manual, parser_id) VALUES (%s,'P','G','k','https://x/y','{}',200,"
                "now() - interval '1 hour','s','full','complete',false,'p@1') RETURNING raw_id",
                [self.run_id],
            ).fetchone()[0]  # type: ignore[index]
            a.commit()

    def load(self, a: psycopg.Connection[Any], year: int, *, after_lock: bool = True) -> datetime:
        """Loader behaviour: lock, then t_load = clock_timestamp(), then insert (not committed)."""
        a.execute("SELECT pg_advisory_xact_lock(hashtext('mm-load'))")
        t_load: datetime
        if after_lock:
            t_load = a.execute("SELECT clock_timestamp()").fetchone()[0]  # type: ignore[index]
        else:  # regression guard: transaction start
            t_load = a.execute("SELECT transaction_timestamp()").fetchone()[0]  # type: ignore[index]
        a.execute(
            "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, "
            "value_status, load_kind, known_at, loaded_at, raw_id, run_id) VALUES "
            "(%s,%s,%s,1,'OBS','new_period', (SELECT fetched_at FROM ingest.raw_object WHERE raw_id = %s), %s, %s, %s)",
            [
                self.series_id,
                date(year, 1, 1),
                date(year, 12, 31),
                self.raw_id,
                t_load,
                self.raw_id,
                self.run_id,
            ],
        )
        return t_load

    def start(self, c: psycopg.Connection[Any], **kw: Any) -> runctx.RunRecord:
        return runctx.start_run(
            c,
            ingest_run_id=self.run_id,
            as_of_run_date=date(2026, 10, 1),
            code_version="cv",
            params={"a": 1},
            config_asof=datetime(2026, 10, 1, tzinfo=UTC),
            **{**H, **kw},
        )


@pytest.fixture
def env(test_database: TestDatabase) -> Env:
    with test_database.connect("mm_owner", timeout=120) as c:
        migrate.migrate(c)
        c.commit()
    return Env(test_database)


def _asof(c: psycopg.Connection[Any], cutoff: datetime) -> int:
    row = c.execute("SELECT count(*) FROM curated.fn_observation_asof(%s, %s)", [cutoff, cutoff])
    return int(row.fetchone()[0])  # type: ignore[index]


def test_straddling_load_is_waited_for(env: Env) -> None:
    db = env.db
    with db.connect() as loader, db.connect("mm_analytics", timeout=60) as ana:
        t_load = env.load(loader, 2020)
        result: dict[str, Any] = {}

        def run() -> None:
            try:
                result["rec"] = env.start(ana)
            except BaseException as exc:
                result["err"] = exc

        th = threading.Thread(target=run)
        th.start()
        th.join(timeout=2.0)
        assert th.is_alive(), "analytics cutoff must block on the load lock"
        loader.commit()
        th.join(timeout=30)
        assert "err" not in result, result.get("err")
        rec: runctx.RunRecord = result["rec"]
        assert rec.known_cutoff == rec.load_cutoff
        assert rec.known_cutoff >= t_load
        assert _asof(ana, rec.known_cutoff) == 1
        # a load that begins after the cutoff has loaded_at > cutoff and is not in the reproduction
        t2 = env.load(loader, 2021)
        loader.commit()
        assert t2 > rec.known_cutoff
        assert _asof(ana, rec.known_cutoff) == 1
        ana.rollback()


def test_transaction_timestamp_regression_guard(env: Env) -> None:
    """A cutoff from transaction_timestamp() would precede the straddling load's t_load."""
    db = env.db
    with db.connect() as loader, db.connect("mm_analytics", timeout=60) as ana:
        t_start = ana.execute("SELECT clock_timestamp()").fetchone()[0]  # type: ignore[index]
        ana.rollback()
        t_load = env.load(loader, 2020)
        res: dict[str, Any] = {}
        th = threading.Thread(target=lambda: res.update(rec=env.start(ana)))
        th.start()
        th.join(timeout=1.0)
        loader.commit()
        th.join(timeout=30)
        rec: runctx.RunRecord = res["rec"]
        # A transaction-start cutoff would be ~t_start < t_load and would miss the committed rows.
        assert t_start < t_load <= rec.known_cutoff
        assert _asof(ana, rec.known_cutoff) == 1
        assert _asof(ana, t_start) == 0
        ana.rollback()


def test_runner_clock_skew_changes_nothing(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    import datetime as dt_mod

    class Skewed(datetime):
        offset = timedelta(minutes=10)

        @classmethod
        def now(cls, tz: Any = None) -> Any:
            return super().now(tz) + cls.offset

    monkeypatch.setattr(dt_mod, "datetime", Skewed)
    with env.db.connect("mm_analytics", timeout=60) as ana:
        results = []
        for off in (timedelta(minutes=10), timedelta(minutes=-10)):
            Skewed.offset = off
            db_now = ana.execute("SELECT clock_timestamp()").fetchone()[0]  # type: ignore[index]
            ana.rollback()
            rec = env.start(ana)
            results.append((db_now, rec.known_cutoff))
        for db_now, cutoff in results:
            assert timedelta(0) <= cutoff - db_now < timedelta(seconds=30)


def test_run_row_and_ids(env: Env) -> None:
    with env.db.connect("mm_analytics", timeout=60) as ana:
        r1 = env.start(ana)
        r2 = env.start(ana)
        assert r2.analysis_run_id > r1.analysis_run_id
        assert r2.known_cutoff >= r1.known_cutoff
        stored = runctx.load_run(ana, r1.analysis_run_id)
        assert stored == r1
        assert runctx.compare_hashes(stored, H) == []


def test_mismatched_hashes_reported(env: Env) -> None:
    with env.db.connect("mm_analytics", timeout=60) as ana:
        rec = env.start(ana)
        cur = {**H, "config_sha256": "c2"}
        del cur["overrides_sha256"]
        got = {m.field: (m.stored, m.current) for m in runctx.compare_hashes(rec, cur)}
        assert got == {"config_sha256": ("c1", "c2"), "overrides_sha256": ("o1", "<missing>")}


def test_lock_timeout_fails_run_without_row(env: Env) -> None:
    db = env.db
    with db.connect() as holder, db.connect("mm_analytics", timeout=60) as ana:
        holder.execute("SELECT pg_advisory_xact_lock(hashtext('mm-load'))")
        with pytest.raises(runctx.CutoffLockTimeout):
            env.start(ana, lock_timeout_ms=300)
        holder.rollback()
        n = ana.execute("SELECT count(*) FROM analytics.run").fetchone()[0]  # type: ignore[index]
        assert n == 0
