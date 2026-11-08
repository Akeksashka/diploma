# ruff: noqa: E501
"""T64 db tests: freshness reader/writer and ops.run_summary against the full migration chain."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING

import psycopg
import pytest

from macro_monitor.monitoring import freshness, run_summary
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

CAL = {"G": {"frequency": "M", "typical_lag_days": 45, "tolerance_days": 20}}
NOW = datetime(2026, 12, 10, 6, tzinfo=UTC)


@pytest.fixture
def conn(test_database: TestDatabase) -> psycopg.Connection:
    with test_database.connect("mm_owner", timeout=120) as c:
        migrate.migrate(c)
        c.commit()
    return test_database.connect()


def _seed(c: psycopg.Connection) -> tuple[int, int, int]:
    c.execute("INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)")
    c.execute(
        "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES ('S','G','x')"
    )
    c.execute(
        "INSERT INTO ref.entity VALUES ('E1','One','country',true,false), ('E2','Two','country',true,false)"
    )
    c.execute("INSERT INTO ref.unit VALUES ('PC','ratio','percent')")
    c.execute(
        "INSERT INTO ref.indicator (indicator_id, name, kind, tier, priority, currency_basis, staleness_class, transform_id,"
        " alert_method, adverse_dir, good_dir, rank_mode, stationarity_class, release_lag_aware)"
        " VALUES ('I1','I1','indicator','A','core','NA','A730','level','z',0,1,'monotone_good','stationary',false)"
    )
    run = c.execute(
        "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status)"
        " VALUES ('w','local','refresh','g','c', now(), 'ok') RETURNING run_id"
    ).fetchone()
    assert run is not None
    sids = []
    for key, ent in (("a", "E1"), ("b", "E2")):
        r = c.execute(
            "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, frequency, unit_code,"
            " price_basis, seasonal_adjustment, calendar_basis, first_seen_at) VALUES ('S','G','d',%s,%s,'t','M','PC','NA','NA','CAL', now()) RETURNING series_id",
            [key, ent],
        ).fetchone()
        assert r is not None
        sids.append(int(r[0]))
        c.execute(
            "INSERT INTO ref.series_map (indicator_id, entity_id, series_id, role, rationale) VALUES ('I1',%s,%s,'headline','r')",
            [ent, sids[-1]],
        )
    return int(run[0]), sids[0], sids[1]


def _obs(c: psycopg.Connection, run: int, sid: int, end: date, status: str, n: int) -> None:
    sha = f"sha{sid}-{n}"
    c.execute("INSERT INTO ingest.raw_blob VALUES (%s,1,'local_dir',%s,now())", [sha, sha])
    raw = c.execute(
        "INSERT INTO ingest.raw_object (run_id, source_id, group_id, request_key, request_url, request_params, http_status,"
        " fetched_at, sha256, fetch_mode, fetch_scope, manual, parser_id) VALUES (%s,'S','G',%s,'https://x/y','{}',200,"
        " now(),%s,'full','complete',false,'p@1') RETURNING raw_id",
        [run, sha, sha],
    ).fetchone()
    assert raw is not None
    c.execute(
        "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, value_status, load_kind,"
        " known_at, loaded_at, raw_id, run_id) VALUES (%s,%s,%s,%s,%s,'new_period', now(), now(), %s, %s)",
        [sid, end.replace(day=1), end, None if status == "MISS" else 1.0, status, raw[0], run],
    )


def test_freshness_reader_and_writer(conn: psycopg.Connection) -> None:
    run, a, b = _seed(conn)
    _obs(conn, run, a, date(2026, 9, 30), "OBS", 1)
    _obs(conn, run, a, date(2026, 10, 31), "MISS", 2)  # MISS counts as published
    _obs(conn, run, a, date(2026, 11, 30), "PROJ", 3)  # projection ignored
    _obs(conn, run, b, date(2026, 9, 30), "OBS", 1)
    inputs = freshness.read_series_inputs(conn)
    assert {s.series_id: s.latest_period_end for s in inputs[("S", "G")]} == {
        a: date(2026, 10, 31),
        b: date(2026, 9, 30),
    }
    assert all(s.core and not s.broken for s in inputs[("S", "G")])
    res = freshness.record_freshness(conn, CAL, inputs, NOW, group_enabled={})
    assert res == {("S", "G"): "fresh"}  # Oct (MISS) fresh, Sep late; tie -> fresh
    row = conn.execute(
        "SELECT expected_period_end, latest_period_end, state FROM ops.v_freshness_latest"
    ).fetchone()
    assert row == (date(2026, 9, 30), date(2026, 10, 31), "fresh")


def test_broken_after_two_failed_attempts(conn: psycopg.Connection) -> None:
    run, a, _ = _seed(conn)
    _obs(conn, run, a, date(2026, 9, 30), "OBS", 1)
    for i, outcome in enumerate(("error", "blocked")):
        conn.execute(
            "INSERT INTO ingest.fetch_attempt (run_id, source_id, request_key, attempted_at, outcome)"
            " VALUES (%s,'S',%s,%s,%s)",
            [run, f"sha{a}-1", NOW - timedelta(days=2 - i), outcome],
        )
    inputs = {s.series_id: s for s in freshness.read_series_inputs(conn)[("S", "G")]}
    assert inputs[a].broken
    freshness.record_freshness(
        conn, CAL, {("S", "G"): list(inputs.values())}, NOW, group_enabled={}
    )
    state = conn.execute("SELECT state FROM ops.freshness_state").fetchone()
    assert state == ("broken",)


def test_run_summary(conn: psycopg.Connection) -> None:
    run, a, _ = _seed(conn)
    _obs(conn, run, a, date(2026, 9, 30), "OBS", 1)
    _obs(conn, run, a, date(2026, 10, 31), "MISS", 2)
    counts = run_summary.run_counts(conn, run)
    assert counts["miss_rows"] == 1
    assert counts["new_observations"] == 2
    run_summary.record_run_summary(
        conn, run, {"G": "ok"}, counts=counts, runner_clock_offset_ms=run_summary.measure_clock_offset_ms(conn),
        db_bytes=run_summary.database_bytes(conn), neon_connect_ms=12,
    )  # fmt: skip
    row = conn.execute(
        "SELECT runner_clock_offset_ms IS NOT NULL, new_raw_objects, groups -> 'statuses' ->> 'G', db_bytes > 0 FROM ops.run_summary"
    ).fetchone()
    assert row == (True, 2, "ok", True)
    with pytest.raises(ValueError, match="unknown group status"):
        run_summary.record_run_summary(conn, run, {"G": "weird"})
