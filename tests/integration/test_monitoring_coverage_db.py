# ruff: noqa: E501, PT018
"""T67 db tests: COV-01, MON-NMAR and BKP-02 readers/writers against the full migration chain."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

import psycopg
import pytest

from macro_monitor.monitoring import coverage
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

END = date(2026, 1, 31)


@pytest.fixture
def conn(test_database: TestDatabase) -> psycopg.Connection:
    with test_database.connect("mm_owner", timeout=120) as c:
        migrate.migrate(c)
        c.commit()
    return test_database.connect()


def _seed(c: psycopg.Connection, kinds: list[str], groups: list[str]) -> int:
    c.execute("INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)")
    c.execute(
        "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES ('S','G','x')"
    )
    c.execute("INSERT INTO ref.unit VALUES ('PC','ratio','percent')")
    c.execute("INSERT INTO ref.domain (domain_id, name, is_ranked) VALUES ('D','D',true)")
    c.execute(
        "INSERT INTO ref.indicator (indicator_id, name, kind, tier, priority, currency_basis, staleness_class, transform_id,"
        " alert_method, adverse_dir, good_dir, rank_mode, stationarity_class, release_lag_aware)"
        " VALUES ('I1','I1','indicator','M','core','NA','MKT45','level','z',0,1,'monotone_good','stationary',false)"
    )
    c.execute("INSERT INTO ref.indicator_domain VALUES ('I1','D',true)")
    run = c.execute(
        "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status)"
        " VALUES ('w','local','refresh','g','c', now(), 'ok') RETURNING run_id"
    ).fetchone()
    assert run is not None
    for n, (kind, grp) in enumerate(zip(kinds, groups, strict=True)):
        ent = f"E{n}"
        c.execute("INSERT INTO ref.entity VALUES (%s,%s,'country',true,false)", [ent, ent])
        c.execute(
            "INSERT INTO ref.entity_group_member VALUES (%s,%s,'2000-01-01',NULL)", [grp, ent]
        )
        sid = c.execute(
            "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, frequency, unit_code,"
            " price_basis, seasonal_adjustment, calendar_basis, first_seen_at) VALUES ('S','G','d',%s,%s,'t','M','PC','NA','NA','CAL', now()) RETURNING series_id",
            [ent, ent],
        ).fetchone()
        assert sid is not None
        c.execute(
            "INSERT INTO ref.series_map (indicator_id, entity_id, series_id, role, rationale) VALUES ('I1',%s,%s,'headline','r')",
            [ent, sid[0]],
        )
        if kind == "none":
            continue
        sha = f"sha{n}"
        c.execute("INSERT INTO ingest.raw_blob VALUES (%s,1,'local_dir',%s,now())", [sha, sha])
        raw = c.execute(
            "INSERT INTO ingest.raw_object (run_id, source_id, group_id, request_key, request_url, request_params, http_status,"
            " fetched_at, sha256, fetch_mode, fetch_scope, manual, parser_id) VALUES (%s,'S','G',%s,'https://x/y','{}',200,"
            " now(),%s,'full','complete',false,'p@1') RETURNING raw_id",
            [run[0], sha, sha],
        ).fetchone()
        assert raw is not None
        # stale-on-arrival (limit 45 d): known 100 days after the period end
        c.execute(
            "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, value_status, load_kind,"
            " known_at, loaded_at, raw_id, run_id) VALUES (%s,%s,%s,1,'OBS',%s, now(), now(), %s, %s)",
            [sid[0], END.replace(day=1), END, kind, raw[0], run[0]],
        )
    return int(run[0])


def _rows(c: psycopg.Connection, check: str) -> list[tuple[str, str, bool, dict[str, object]]]:
    return c.execute(
        "SELECT subject, severity, passed, detail FROM ops.validation_result WHERE check_id = %s ORDER BY subject",
        [check],
    ).fetchall()


def test_cov01_excludes_initial_and_not_yet_measurable(conn: psycopg.Connection) -> None:
    run = _seed(conn, ["initial"] * 12 + ["new_period"] * 3, ["advanced"] * 15)
    res = coverage.record_cov01(conn, run)
    assert [(r.state, r.n_qualifying, r.n_with_value) for r in res] == [
        ("not_yet_measurable", 3, 15)
    ]
    ((subject, sev, passed, detail),) = _rows(conn, "COV-01")
    assert (subject, sev, passed, detail["state"], detail["n_qualifying"]) == (
        "I1",
        "info",
        True,
        "not_yet_measurable",
        3,
    )


def test_cov01_warns_when_measured_and_stale(conn: psycopg.Connection) -> None:
    run = _seed(conn, ["new_period"] * 10, ["advanced"] * 10)
    # known_at is "now" (>45 d after the 2026-01-31 period end once today is later); assert via explicit override
    res = coverage.record_cov01(conn, run, limit_overrides={"I1": 1})
    assert res[0].state == "measured" and res[0].warn and res[0].share == 1.0
    ((_, sev, passed, _),) = _rows(conn, "COV-01")
    assert (sev, passed) == ("warn", False)


def test_nmar_report_only(conn: psycopg.Connection) -> None:
    run = _seed(
        conn, ["new_period"] * 2 + ["none"] * 2, ["advanced", "advanced", "emerging", "emerging"]
    )
    before = conn.execute("SELECT count(*) FROM curated.observation").fetchone()
    res = coverage.record_nmar(conn, run, date(2026, 2, 15))
    assert res[0].unavailable_share == {"advanced": 0.0, "emerging": 1.0} and res[0].warn
    ((subject, sev, _, detail),) = _rows(conn, "MON-NMAR")
    assert (subject, sev, detail["difference_pp"]) == ("D", "warn", 1.0)
    assert conn.execute("SELECT count(*) FROM curated.observation").fetchone() == before
    assert conn.execute("SELECT count(*) FROM analytics.scorecard").fetchone() == (0,)


def test_bkp02_lists_hash_only_and_warns_once(conn: psycopg.Connection) -> None:
    conn.execute(
        "INSERT INTO ref.source VALUES ('P','p','rest','public','public','l','a','x',true)"
    )
    conn.execute(
        "INSERT INTO ref.source VALUES ('H','p','rest','hash_only','withheld','l','a','x',true)"
    )
    conn.execute(
        "INSERT INTO ref.source VALUES ('W','p','rest','public','withheld','l','a','x',true)"
    )
    conn.execute(
        "INSERT INTO ref.source VALUES ('X','p','rest','hash_only','withheld','l','a','x',false)"
    )
    first = coverage.record_bkp02(conn, None)
    assert first.source_ids == ("H", "W") and first.hash_only == ("H",) and first.warn
    second = coverage.record_bkp02(conn, None)
    assert not second.warn and second.newly_listed == ()
    rows = _rows(conn, "BKP-02")
    assert [r[1] for r in rows] == ["info", "warn"] or sorted(r[1] for r in rows) == [
        "info",
        "warn",
    ]
    assert not _rows(conn, "BKP-01")
