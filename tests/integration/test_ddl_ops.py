# ruff: noqa: E501
"""T-DDL-21 and the T14 guards against migration 0004_ops (chain 0000-0004 only, so later migrations cannot interfere)."""

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

KINDS = [
    "unit",
    "base_period",
    "seasonal_adjustment",
    "frequency",
    "flow_basis",
    "classification",
    "composition",
    "dataset_moved",
    "mass_revision",
    "schema_drift",
    "precision_change",
]
_EV = "INSERT INTO ops.drift_event (kind, source_id, series_ref) VALUES (%s, 'S', 'K1') RETURNING event_id"
_DEC = "INSERT INTO ops.drift_decision (event_id, decision, decided_by, decided_on) VALUES (%s, %s, 'me', current_date)"
_UPD = "UPDATE ops.drift_event SET status = %s, decided_by = 'me', decided_on = current_date WHERE event_id = %s"


@pytest.fixture
def conn(test_database: TestDatabase, tmp_path: Path) -> Iterator[psycopg.Connection]:
    for m in migrate.discover():
        if m.version <= 4:
            (tmp_path / m.path.name).write_text(m.sql, encoding="utf-8")
    with test_database.connect() as c:
        migrate.migrate(c, tmp_path)
        c.execute(
            "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)"
        )
        c.commit()
        yield c


def _event(conn: psycopg.Connection, kind: str = "unit") -> int:
    row = conn.execute(_EV, [kind]).fetchone()
    assert row is not None
    return int(row[0])


@pytest.mark.parametrize("kind", KINDS)
def test_all_kinds_accepted(conn: psycopg.Connection, kind: str) -> None:
    _event(conn, kind)


@pytest.mark.parametrize("kind", ["schema", "bogus"])
def test_retired_and_unknown_kind_rejected(conn: psycopg.Connection, kind: str) -> None:
    with pytest.raises(errors.CheckViolation):
        _event(conn, kind)


def test_drift_event_update_needs_same_transaction_decision(conn: psycopg.Connection) -> None:
    ev = _event(conn)
    conn.commit()
    with pytest.raises(errors.RestrictViolation):
        conn.execute(_UPD, ["accepted", ev])
    conn.rollback()
    # a decision committed earlier does not count
    conn.execute(_DEC, [ev, "accepted"])
    conn.commit()
    with pytest.raises(errors.RestrictViolation):
        conn.execute(_UPD, ["accepted", ev])
    conn.rollback()
    # same transaction: allowed, status must equal the latest decision
    conn.execute(_DEC, [ev, "rejected"])
    with pytest.raises(errors.RestrictViolation):
        conn.execute(_UPD, ["accepted", ev])
    conn.rollback()
    conn.execute(_DEC, [ev, "rejected"])
    conn.execute(_UPD, ["rejected", ev])
    conn.commit()
    conn.execute(_DEC, [ev, "reopened"])
    conn.execute(_UPD, ["open", ev])
    conn.commit()
    row = conn.execute("SELECT status FROM ops.drift_event WHERE event_id = %s", [ev]).fetchone()
    assert row == ("open",)


def test_drift_event_other_columns_and_delete_frozen(conn: psycopg.Connection) -> None:
    ev = _event(conn)
    conn.execute(_DEC, [ev, "accepted"])
    with pytest.raises(errors.RestrictViolation):
        conn.execute("UPDATE ops.drift_event SET kind = 'frequency' WHERE event_id = %s", [ev])
    conn.rollback()
    ev = _event(conn)
    conn.commit()
    with pytest.raises(errors.RestrictViolation):
        conn.execute("DELETE FROM ops.drift_event WHERE event_id = %s", [ev])
    conn.rollback()
    with pytest.raises(errors.RestrictViolation):
        conn.execute("TRUNCATE ops.drift_event CASCADE")
    conn.rollback()


def test_decision_override_export_insert_only(conn: psycopg.Connection) -> None:
    ev = _event(conn)
    conn.execute(_DEC, [ev, "accepted"])
    conn.execute(
        "INSERT INTO ops.quality_override (series_id, decision, reason, decided_by, decided_on) "
        "VALUES (1, 'exclude', 'r', 'me', current_date)"
    )
    conn.execute("INSERT INTO ops.export_status (run_id, status) VALUES (1, 'ok')")
    conn.commit()
    for tbl, col, val in [
        ("drift_decision", "note", "'x'"),
        ("quality_override", "reason", "'x'"),
        ("export_status", "detail", "'{}'"),
    ]:
        for sql in (
            f"UPDATE ops.{tbl} SET {col} = {val}",
            f"DELETE FROM ops.{tbl}",
            f"TRUNCATE ops.{tbl} CASCADE",
        ):
            with pytest.raises(errors.RestrictViolation):
                conn.execute(sql)  # type: ignore[arg-type]
            conn.rollback()
    with pytest.raises(errors.CheckViolation):
        conn.execute(
            "INSERT INTO ops.drift_decision (event_id, decision, decided_by, decided_on) "
            "VALUES (%s, 'maybe', 'me', current_date)",
            [ev],
        )
    conn.rollback()


def test_validation_result_has_no_pk_and_only_lookup_index(conn: psycopg.Connection) -> None:
    pk = conn.execute(
        "SELECT count(*) FROM pg_constraint WHERE conrelid = 'ops.validation_result'::regclass AND contype = 'p'"
    ).fetchone()
    assert pk == (0,)
    idx = conn.execute(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'ops' AND tablename = 'validation_result'"
    ).fetchall()
    assert len(idx) == 1
    assert "(run_id, check_id)" in idx[0][0]
    with pytest.raises(errors.CheckViolation):
        conn.execute(
            "INSERT INTO ops.validation_result (run_id, check_id, severity) VALUES (1,'X','fatal')"
        )


def test_run_summary_and_freshness(conn: psycopg.Connection) -> None:
    conn.execute("INSERT INTO ops.run_summary (run_id, groups) VALUES (1, '{}')")
    conn.execute("UPDATE ops.run_summary SET db_bytes = 5 WHERE run_id = 1")
    conn.execute("INSERT INTO ops.freshness_state VALUES ('g','s', now(), NULL, NULL, 'fresh')")
    with pytest.raises(errors.CheckViolation):
        conn.execute(
            "INSERT INTO ops.freshness_state VALUES ('g','s', now() + interval '1 s', NULL, NULL, 'x')"
        )
    conn.rollback()


def test_carry_over_foreign_keys(conn: psycopg.Connection) -> None:
    rows = conn.execute(
        "SELECT conrelid::regclass::text, confrelid::regclass::text FROM pg_constraint WHERE contype = 'f' "
        "AND conname IN ('config_history_run_id_fkey','raw_series_status_event_id_fkey') ORDER BY 1"
    ).fetchall()
    assert rows == [
        ("ingest.raw_series_status", "ops.drift_event"),
        ("ref.config_history", "ingest.run"),
    ]
    with pytest.raises(errors.ForeignKeyViolation):
        conn.execute(
            "INSERT INTO ref.config_history (table_name, row_key, row_data, op, run_id, git_sha) "
            "VALUES ('source', '{}', '{}', 'insert', 999, 'g')"
        )
    conn.rollback()


def test_published_decimals_trigger_against_real_drift_event(conn: psycopg.Connection) -> None:
    conn.execute("CREATE SCHEMA IF NOT EXISTS curated")
    conn.execute("CREATE TABLE curated.observation (series_id int)")
    conn.execute(
        "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES ('S','G','x')"
    )
    conn.execute("INSERT INTO ref.entity VALUES ('DEU','Germany','country',true,false)")
    row = conn.execute(
        "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, frequency, unit_code, "
        "price_basis, seasonal_adjustment, first_seen_at, published_decimals) "
        "VALUES ('S','G','D','K1','DEU','t','M','PCT','NA','SA','2026-01-01T00:00:00Z', 1) RETURNING series_id"
    ).fetchone()
    assert row is not None
    sid = row[0]
    conn.execute("INSERT INTO curated.observation VALUES (%s)", [sid])
    conn.commit()
    up = "UPDATE ref.series SET published_decimals = 2 WHERE series_id = %s"
    _event(conn, "unit")  # another kind does not count
    with pytest.raises(errors.RestrictViolation):
        conn.execute(up, [sid])
    conn.rollback()
    _event(conn, "precision_change")
    conn.execute(up, [sid])
    conn.commit()
    got = conn.execute(
        "SELECT published_decimals FROM ref.series WHERE series_id = %s", [sid]
    ).fetchone()
    assert got == (2,)
