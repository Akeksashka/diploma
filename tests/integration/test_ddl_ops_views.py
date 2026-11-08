# ruff: noqa: E501
"""T-DDL-29 and the other ops.v_* views against migration 0009_ops_views (full chain, plan T35)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING

import psycopg
import pytest
from psycopg import errors

from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

BASE = datetime(2026, 1, 1, tzinfo=UTC)
VIEWS = [
    "v_freshness_latest", "v_run_summary_public", "v_validation_counts", "v_open_drift",
    "v_manual_sources", "v_backlog", "v_export_status_latest",
]  # fmt: skip
RUN_SUMMARY_COLUMNS = [
    "ingest_run_id", "workflow", "mode", "status", "started_at", "finished_at",
    "new_raw_objects", "new_observations", "revisions", "alerts_opened",
]  # fmt: skip


class Fx:
    """Public source P and withheld source W, loaded through raw objects and raw_load rows."""

    def __init__(self, c: psycopg.Connection) -> None:
        self.c = c
        self.n = 0
        self.ts = 0
        c.execute(
            "INSERT INTO ref.source VALUES ('P','p','rest','public','public','l','a','x',true), "
            "('W','p','rest','public','withheld','l','a','x',true), "
            "('M','p','manual','public','public','l','a','x',true)"
        )
        for src in ("P", "W", "M"):
            c.execute(
                "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES (%s,'G','x')",
                [src],
            )
        c.execute(
            "INSERT INTO ref.entity VALUES ('E1','One','country',true,false), ('E2','Two','country',true,false)"
        )
        c.execute("INSERT INTO ref.unit VALUES ('PC','ratio','percent')")
        for ind, kind in (("I1", "indicator"), ("IX", "input")):
            inp = kind == "input"
            c.execute(
                "INSERT INTO ref.indicator (indicator_id, name, kind, tier, priority, currency_basis, "
                "staleness_class, transform_id, alert_method, adverse_dir, good_dir, rank_mode, "
                "stationarity_class, release_lag_aware) VALUES (%s,%s,%s,'A','core','NA','A730','level',"
                "%s,0,%s,%s,'stationary',false)",
                [ind, ind, kind, "none" if inp else "z", 0 if inp else 1,
                 "descriptive_only" if inp else "monotone_good"],
            )  # fmt: skip
        self.run_id = self.new_run()

    def new_run(self) -> int:
        row = self.c.execute(
            "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status) "
            "VALUES ('w','local','refresh','g','c', now(), 'ok') RETURNING run_id"
        ).fetchone()
        assert row is not None
        return int(row[0])

    def series(self, key: str, src: str, ind: str, ent: str, role: str = "headline") -> int:
        row = self.c.execute(
            "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, "
            "frequency, unit_code, price_basis, seasonal_adjustment, calendar_basis, first_seen_at) "
            "VALUES (%s,'G','d',%s,%s,'t','A','PC','NA','NA','CAL', now()) RETURNING series_id",
            [src, key, ent],
        ).fetchone()
        assert row is not None
        sid = int(row[0])
        self.c.execute(
            "INSERT INTO ref.series_map (indicator_id, entity_id, series_id, role, rationale) VALUES (%s,%s,%s,%s,'r')",
            [ind, ent, sid, role],
        )
        return sid

    def raw(self, src: str, *, run: int | None = None, load_run: int | None = None,
            imp: bool = False, manual: bool = False, edition: date | None = None,
            loaded: bool = True) -> int:  # fmt: skip
        self.n += 1
        self.ts += 1
        sha = f"sha{self.n}"
        self.c.execute("INSERT INTO ingest.raw_blob VALUES (%s,1,'local_dir',%s,now())", [sha, sha])
        row = self.c.execute(
            "INSERT INTO ingest.raw_object (run_id, source_id, group_id, request_key, request_url, "
            "request_params, http_status, fetched_at, sha256, fetch_mode, fetch_scope, manual, "
            "edition_date, import_label, parser_id) VALUES (%s,%s,'G',%s,'https://x/y','{}',200,%s,%s,"
            "'full','complete',%s,%s,%s,'p@1') RETURNING raw_id",
            [run or self.run_id, src, f"k{self.n}", BASE + timedelta(days=self.ts), sha,
             manual or imp, edition, "archive_import" if imp else None],
        ).fetchone()  # fmt: skip
        assert row is not None
        raw_id = int(row[0])
        if loaded:
            self.c.execute(
                "INSERT INTO ingest.raw_load (raw_id, outcome, load_run_id, loaded_at) VALUES (%s,'loaded',%s,now())",
                [raw_id, load_run or run or self.run_id],
            )
        return raw_id

    def obs(self, sid: int, src: str, year: int, status: str, kind: str, *, value: float | None = 1.0,
            run: int | None = None, load_run: int | None = None) -> None:  # fmt: skip
        raw_id = self.raw(src, run=run, load_run=load_run, imp=kind == "import")
        self.c.execute(
            "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, "
            "value_status, load_kind, known_at, loaded_at, raw_id, run_id) "
            "SELECT %s,%s,%s,%s,%s,%s,fetched_at,now(),raw_id,%s FROM ingest.raw_object WHERE raw_id = %s",
            [
                sid,
                date(year, 1, 1),
                date(year, 12, 31),
                value,
                status,
                kind,
                run or self.run_id,
                raw_id,
            ],
        )

    def analysis_run(self, ingest_run: int) -> int:
        row = self.c.execute(
            "INSERT INTO analytics.run (ingest_run_id, as_of_run_date, known_cutoff, load_cutoff, code_version, "
            "params, git_sha, config_asof, config_sha256, mapping_sha256, overrides_sha256) "
            "VALUES (%s, %s, now(), now(), 'v1', '{}', 'g', now(), 'c', 'm', 'o') RETURNING analysis_run_id",
            [ingest_run, date(2026, 10, 1)],
        ).fetchone()
        assert row is not None
        return int(row[0])

    def alert(self, run: int, ind: str, ent: str, sid: int, level: str, publish: bool) -> None:
        self.c.execute(
            "INSERT INTO analytics.alert (analysis_run_id, indicator_id, entity_id, series_id, ref_period_end, "
            "method, window_obs, n_obs, level, confidence, publish) VALUES (%s,%s,%s,%s,'2020-12-31','z',10,10,%s,'full',%s)",
            [run, ind, ent, sid, level, publish],
        )

    def scenario(self) -> dict[str, int]:
        """Public headline P1 (E1), withheld headline W1 (E2), public input PX, public comparison PC."""
        s = {
            "P1": self.series("P1", "P", "I1", "E1"),
            "W1": self.series("W1", "W", "I1", "E2"),
            "PX": self.series("PX", "P", "IX", "E1"),
            "PC": self.series("PC", "P", "I1", "E1", role="comparison"),
        }
        for sid, src in ((s["P1"], "P"), (s["W1"], "W")):
            self.obs(sid, src, 2020, "OBS", "initial")
            self.obs(sid, src, 2021, "OBS", "new_period")
            self.obs(sid, src, 2020, "OBS", "revision", value=2.0)
            self.obs(sid, src, 2022, "PROJ", "new_period")  # projection: not counted
            self.obs(sid, src, 2019, "OBS", "import")  # import: not counted
        self.obs(s["PX"], "P", 2020, "OBS", "initial")  # input indicator: not counted
        self.obs(s["PC"], "P", 2020, "OBS", "initial")  # comparison role: not counted
        self.obs(s["PC"], "P", 2021, "OBS", "revision", value=3.0)
        return s


@pytest.fixture
def conn(test_database: TestDatabase) -> psycopg.Connection:
    with test_database.connect("mm_owner", timeout=120) as c:
        migrate.migrate(c)
        c.commit()
    return test_database.connect()


def _row(c: psycopg.Connection, run: int) -> tuple[object, ...]:
    row = c.execute(
        "SELECT * FROM ops.v_run_summary_public WHERE ingest_run_id = %s", [run]
    ).fetchone()
    assert row is not None
    return row


def _cols(c: psycopg.Connection, view: str) -> list[str]:
    return [d.name for d in c.execute(f"SELECT * FROM {view} LIMIT 0").description or []]


def test_columns_are_exact_and_views_are_owner_rights(
    conn: psycopg.Connection, test_database: TestDatabase
) -> None:
    assert _cols(conn, "ops.v_run_summary_public") == RUN_SUMMARY_COLUMNS
    for v in VIEWS:
        row = conn.execute(
            "SELECT c.reloptions, pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'ops' AND c.relname = %s",
            [v],
        ).fetchone()
        assert row is not None
        assert not row[0], v  # no security_invoker / security_barrier option
        assert row[1] == test_database.roles["mm_owner"], v


def test_counts_published_scope_only(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    s = fx.scenario()
    raws_public = conn.execute(
        "SELECT count(*) FROM ingest.raw_object WHERE run_id = %s AND source_id = 'P'", [fx.run_id]
    ).fetchone()
    assert raws_public is not None
    assert raws_public[0] > 0
    row = _row(conn, fx.run_id)
    # P1: initial + new_period = 2 new; 1 revision. PROJ, import, input and comparison rows are excluded.
    assert row[6:] == (raws_public[0], 2, 1, None)
    assert row[1:4] == ("w", "refresh", "ok")
    assert s["P1"]


def test_withheld_source_changes_no_column(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    s = fx.scenario()
    ar = fx.analysis_run(fx.run_id)
    fx.alert(ar, "I1", "E1", s["P1"], "alert", True)
    fx.alert(ar, "I1", "E2", s["W1"], "alert", False)
    before = _row(conn, fx.run_id)
    assert before[9] == 1
    # change every kind of withheld data: more loads, revisions, new periods, raw objects, alerts
    fx.obs(s["W1"], "W", 2023, "OBS", "new_period")
    fx.obs(s["W1"], "W", 2021, "OBS", "revision", value=99.0)
    fx.raw("W")
    fx.raw("W", loaded=False)
    conn.execute("UPDATE analytics.alert SET level = 'watch' WHERE publish IS FALSE")
    after = _row(conn, fx.run_id)
    assert after == before


def test_alerts_opened_null_without_analysis_run_and_published_only(
    conn: psycopg.Connection,
) -> None:
    fx = Fx(conn)
    s = fx.scenario()
    assert _row(conn, fx.run_id)[9] is None
    first = fx.analysis_run(fx.run_id)
    fx.alert(first, "I1", "E1", s["P1"], "alert", True)
    assert _row(conn, fx.run_id)[9] == 1
    second = fx.analysis_run(fx.run_id)  # the greatest analysis_run_id wins
    fx.alert(second, "I1", "E1", s["P1"], "watch", True)
    fx.alert(second, "I1", "E2", s["W1"], "alert", True)
    fx.alert(second, "IX", "E1", s["PX"], "none", True)
    fx.alert(second, "I1", "E3", s["PC"], "alert", False)
    assert _row(conn, fx.run_id)[9] == 2
    other = fx.new_run()
    assert _row(conn, other)[6:] == (0, 0, 0, None)


def test_rows_found_through_raw_load_run_and_obs_raw(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    s = fx.scenario()
    run2 = fx.new_run()
    # observation stored by run 2 whose raw object was fetched by run 1: counted for the loading run only
    fx.obs(s["P1"], "P", 2024, "OBS", "new_period", run=run2, load_run=run2)
    assert _row(conn, run2)[6:] == (1, 1, 0, None)
    assert _row(conn, fx.run_id)[7] == 2
    # a raw object without a raw_load row (unloaded) contributes no observation to any run
    fx.raw("P", run=run2, loaded=False)
    assert _row(conn, run2)[7] == 1
    conn.execute("SET enable_seqscan = off")
    plan = "\n".join(
        str(r[0]) for r in conn.execute("EXPLAIN SELECT * FROM ops.v_run_summary_public").fetchall()
    )
    assert "obs_raw" in plan, plan
    conn.execute("RESET enable_seqscan")


def test_reader_cannot_read_db_bytes_or_base_tables(
    conn: psycopg.Connection, test_database: TestDatabase
) -> None:
    fx = Fx(conn)
    fx.scenario()
    conn.execute(
        "INSERT INTO ops.run_summary (run_id, db_bytes, neon_connect_ms, groups) VALUES (%s, 123, 5, '{}')",
        [fx.run_id],
    )
    conn.commit()
    with test_database.connect("mm_reader") as rd:
        assert rd.execute("SELECT count(*) FROM ops.v_run_summary_public").fetchone() == (1,)
        for sql in (
            "SELECT db_bytes FROM ops.v_run_summary_public",
            "SELECT db_bytes FROM ops.run_summary",
            "SELECT * FROM ops.run_summary",
            "SELECT * FROM ingest.run",
            "SELECT * FROM curated.observation",
            "SELECT * FROM analytics.alert",
            "SELECT * FROM ops.drift_event",
        ):
            with pytest.raises((errors.InsufficientPrivilege, errors.UndefinedColumn)):
                rd.execute(sql)
            rd.rollback()
        for v in VIEWS:
            rd.execute(f"SELECT * FROM ops.{v}")  # owner-rights views are readable
        with pytest.raises(errors.InsufficientPrivilege):
            rd.execute("DELETE FROM ops.v_open_drift")


def test_other_views(conn: psycopg.Connection, test_database: TestDatabase) -> None:
    fx = Fx(conn)
    c = conn
    # freshness: latest evaluation per group
    c.execute(
        "INSERT INTO ops.freshness_state VALUES ('g','s',%s,'2026-01-31','2025-12-31','fresh'), "
        "('g','s',%s,'2026-02-28','2025-12-31','late'), ('g','t',%s,'2026-01-31','2026-01-31','fresh')",
        [BASE, BASE + timedelta(days=30), BASE],
    )
    assert c.execute(
        "SELECT series_group, state FROM ops.v_freshness_latest ORDER BY 1"
    ).fetchall() == [("s", "late"), ("t", "fresh")]
    # validation counts incl. COV-01 detail; no raw detail/subject leaks for other checks
    c.execute(
        "INSERT INTO ops.validation_result (run_id, check_id, severity, source_id, subject, passed, detail) VALUES "
        "(%s,'REV-01','warn','P','secret subject',false,'{\"x\":1}'), (%s,'REV-06','warn','P','s2',true,'{}'), "
        "(%s,'COV-01','info','P','I1',true,'{\"state\":\"not_yet_measurable\",\"n_qualifying\":5}')",
        [fx.run_id] * 3,
    )
    rows = c.execute(
        "SELECT check_family, check_id, subject, n_results, n_failed, n_qualifying, not_yet_measurable "
        "FROM ops.v_validation_counts ORDER BY check_id"
    ).fetchall()
    assert rows == [
        ("COV", "COV-01", "I1", 1, 0, 5, True),
        ("REV", "REV-01", None, 1, 1, None, None),
        ("REV", "REV-06", None, 1, 0, None, None),
    ]
    # open drift: open events only, no old/new
    c.execute(
        "INSERT INTO ops.drift_event (kind, source_id, series_ref, old) VALUES ('unit','P','K','{\"a\":1}')"
    )
    assert _cols(c, "ops.v_open_drift") == ["event_id", "source_id", "kind", "status"]
    assert c.execute("SELECT source_id, kind, status FROM ops.v_open_drift").fetchall() == [
        ("P", "unit", "open")
    ]
    # manual sources: last loaded manual file only
    fx.raw("M", manual=True, edition=date(2026, 4, 15))
    fx.raw("M", manual=True, edition=date(2026, 10, 15), loaded=False)
    assert c.execute(
        "SELECT source_id, last_edition_date FROM ops.v_manual_sources"
    ).fetchall() == [("M", date(2026, 4, 15))]
    # backlog: the unloaded object is counted
    assert c.execute("SELECT n_unloaded FROM ops.v_backlog").fetchone() == (1,)
    # export status: latest row, no detail column
    c.execute("INSERT INTO ops.export_status (run_id, status) VALUES (%s,'failed')", [fx.run_id])
    c.execute(
        "INSERT INTO ops.export_status (run_id, status, detail) VALUES (%s,'ok','{\"err\":\"x\"}')",
        [fx.run_id],
    )
    assert c.execute("SELECT status FROM ops.v_export_status_latest").fetchall() == [("ok",)]
    assert "detail" not in _cols(c, "ops.v_export_status_latest")
    c.commit()
