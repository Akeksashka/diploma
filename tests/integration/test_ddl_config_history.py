# ruff: noqa: E501
"""T-DDL-16 and the T-DDL-27 history clause against migration 0002_config_history."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest
from psycopg import errors

from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

_IND_COLS = (
    "indicator_id, name, kind, scope, tier, priority, currency_basis, staleness_class, transform_id, "
    "alert_method, adverse_dir, good_dir, rank_mode, stationarity_class, release_lag_aware"
)


@pytest.fixture
def conn(test_database: TestDatabase) -> Iterator[psycopg.Connection]:
    with test_database.connect() as c:
        migrate.migrate(c)
        c.commit()
        yield c


def _count(conn: psycopg.Connection, table: str, op: str | None = None) -> int:
    row = conn.execute(
        "SELECT count(*) FROM ref.config_history WHERE table_name = %s AND (%s::text IS NULL OR op = %s)",
        [table, op, op],
    ).fetchone()
    assert row is not None
    return int(row[0])


def _indicator(conn: psycopg.Connection, iid: str = "I1") -> None:
    conn.execute(
        f"INSERT INTO ref.indicator ({_IND_COLS}) VALUES "
        "(%s, %s, 'indicator', 'country', 'M', 'core', 'NA', 'ACT120', 'LEVEL', 'z', 1, 1, 'monotone_good', 'stationary', false)",
        [iid, iid],
    )


def _setup_series_map(conn: psycopg.Connection) -> int:
    conn.execute(
        "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)"
    )
    conn.execute(
        "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES ('S','G','x')"
    )
    conn.execute("INSERT INTO ref.entity VALUES ('DEU','Germany','country',true,false)")
    _indicator(conn)
    row = conn.execute(
        "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, frequency, "
        "unit_code, price_basis, seasonal_adjustment, first_seen_at) VALUES "
        "('S','G','D','K','DEU','t','M','PCT','NA','SA','2026-01-01T00:00:00Z') RETURNING series_id"
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_asof_returns_first_state_between_syncs(conn: psycopg.Connection) -> None:
    sid = _setup_series_map(conn)
    conn.execute(
        "INSERT INTO ref.series_map (indicator_id, entity_id, series_id, role, rationale) "
        "VALUES ('I1','DEU',%s,'headline','first')",
        [sid],
    )
    conn.commit()
    t1 = conn.execute("SELECT clock_timestamp()").fetchone()
    assert t1 is not None
    conn.execute("SELECT pg_sleep(0.05)")
    conn.commit()  # recorded_at is the transaction start; the next sync is a new transaction
    conn.execute("UPDATE ref.series_map SET rationale = 'second'")
    conn.execute("UPDATE ref.indicator SET params = '{\"window_obs\": 60}'")
    conn.commit()
    t_mid = t1[0]
    rows = conn.execute(
        "SELECT row_data FROM ref.fn_config_asof('series_map', %s)", [t_mid]
    ).fetchall()
    assert len(rows) == 1
    assert rows[0][0]["rationale"] == "first"
    rows = conn.execute("SELECT row_data FROM ref.fn_config_asof('series_map', now())").fetchall()
    assert len(rows) == 1
    assert rows[0][0]["rationale"] == "second"
    ind = conn.execute(
        "SELECT row_data->'params' FROM ref.fn_config_asof('indicator', %s)", [t_mid]
    ).fetchall()
    assert ind[0][0] == {} or ind[0][0] != {"window_obs": 60}
    ind = conn.execute(
        "SELECT row_data->'params' FROM ref.fn_config_asof('indicator', now())"
    ).fetchall()
    assert ind[0][0] == {"window_obs": 60}
    key = conn.execute("SELECT row_key FROM ref.fn_config_asof('series_map', now())").fetchone()
    assert key is not None
    assert set(key[0]) == {
        "indicator_id",
        "entity_id",
        "series_id",
        "role",
        "valid_from",
    }


def test_asof_drops_deleted_rows(conn: psycopg.Connection) -> None:
    conn.execute("INSERT INTO ref.entity VALUES ('DEU','Germany','country',true,false)")
    conn.commit()
    conn.execute("DELETE FROM ref.entity")
    conn.commit()
    assert _count(conn, "entity", "delete") == 1
    row = conn.execute("SELECT row_data FROM ref.config_history WHERE op = 'delete'").fetchone()
    assert row is not None
    assert row[0] is None
    assert conn.execute("SELECT count(*) FROM ref.fn_config_asof('entity', now())").fetchone() == (
        0,
    )


@pytest.mark.parametrize(
    "stmt",
    [
        "UPDATE ref.config_history SET git_sha = 'x'",
        "DELETE FROM ref.config_history",
        "TRUNCATE ref.config_history",
    ],
)
def test_history_rejects_update_delete_truncate(conn: psycopg.Connection, stmt: str) -> None:
    conn.execute("INSERT INTO ref.entity VALUES ('DEU','Germany','country',true,false)")
    conn.commit()
    with pytest.raises(errors.IntegrityConstraintViolation):
        conn.execute(stmt)
    conn.rollback()


def test_publication_and_ranking_changes_each_write_a_row(conn: psycopg.Connection) -> None:
    conn.execute(
        "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)"
    )
    conn.execute("INSERT INTO ref.entity VALUES ('DEU','Germany','country',true,false)")
    conn.execute("INSERT INTO ref.domain (domain_id, name, is_ranked) VALUES ('D1','d',true)")
    conn.commit()
    for table, stmt in [
        ("source", "UPDATE ref.source SET publish_site = 'withheld'"),
        ("entity", "UPDATE ref.entity SET is_ranked = false"),
        ("domain", "UPDATE ref.domain SET is_ranked = false"),
    ]:
        before = _count(conn, table, "update")
        conn.execute(stmt)
        conn.commit()
        assert _count(conn, table, "update") == before + 1, table
    conn.execute("UPDATE ref.source SET publish_site = 'withheld'")  # no-op: no row
    conn.commit()
    assert _count(conn, "source", "update") == 1


@pytest.mark.parametrize(
    ("col", "val"), [("stationarity_class", "rate_of_change"), ("release_lag_aware", "true")]
)
def test_indicator_column_change_writes_history(
    conn: psycopg.Connection, col: str, val: str
) -> None:
    _indicator(conn)
    conn.commit()
    assert _count(conn, "indicator", "insert") == 1
    conn.execute("SELECT set_config('mm.git_sha', 'abc123', false)")
    conn.execute(
        f"UPDATE ref.indicator SET {col} = " + ("true" if val == "true" else "%s"),
        [] if val == "true" else [val],
    )
    conn.commit()
    assert _count(conn, "indicator", "update") == 1
    row = conn.execute(
        "SELECT row_key, git_sha, row_data->>%s FROM ref.config_history WHERE op = 'update'", [col]
    ).fetchone()
    assert row is not None
    assert row[0] == {"indicator_id": "I1"}
    assert row[1] == "abc123"
    assert row[2] == val


def test_feeder_not_executable_by_public_and_is_security_definer(conn: psycopg.Connection) -> None:
    row = conn.execute(
        "SELECT prosecdef, has_function_privilege('public', oid, 'EXECUTE') FROM pg_proc WHERE proname = 'fn_config_history_feed'"
    ).fetchone()
    assert row == (True, False)


def test_migration_0012_removes_stale_g02_agri_link_via_history(
    test_database: TestDatabase, tmp_path: Path
) -> None:
    """G02/agri removal (g02-domain-move-amendment Q-1): the link goes, a delete history row is appended."""
    sql12 = next(m for m in migrate.discover() if m.version == 12)
    for m in migrate.discover():
        if m.version < 12:
            (tmp_path / m.path.name).write_text(m.sql, encoding="utf-8")
    with test_database.connect() as c:
        migrate.migrate(c, tmp_path)
        c.commit()
        c.execute(
            f"INSERT INTO ref.indicator ({_IND_COLS}) VALUES "
            "('G02','G02','indicator','global','M','ext','B2','MKT45','YOY','robust_z',1,0,'descriptive_only','stationary',false)"
        )
        c.execute(
            "INSERT INTO ref.domain (domain_id, name, is_ranked) VALUES ('agri','Agri-food',false),('global','Global',false)"
        )
        c.execute(
            "INSERT INTO ref.indicator_domain VALUES ('G02','agri',false),('G02','global',false)"
        )
        c.commit()
        before = _count(c, "indicator_domain")
        c.execute(sql12.sql.encode("utf-8"))
        c.commit()
        assert c.execute(
            "SELECT domain_id FROM ref.indicator_domain WHERE indicator_id = 'G02'"
        ).fetchall() == [("global",)]
        rows = c.execute(
            "SELECT op, row_key, git_sha FROM ref.config_history "
            "WHERE table_name = 'indicator_domain' AND op = 'delete'"
        ).fetchall()
        assert rows == [("delete", {"indicator_id": "G02", "domain_id": "agri"}, "migration-0012")]
        assert _count(c, "indicator_domain") == before + 1
        c.execute(sql12.sql.encode("utf-8"))  # second run: no-op
        c.commit()
        assert _count(c, "indicator_domain") == before + 1
