# ruff: noqa: PT018, PT022
"""T137 / ADR-027 / T-DDL-35 / AC-CFG-20 (i): ref.series_group.enabled against a migrated database.

Needs MM_TEST_DATABASE_URL (the ``test_database`` fixture skips without it).
"""

from __future__ import annotations

import copy
import dataclasses
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest
import yaml
from psycopg import errors

from macro_monitor.registry.config import load_sources
from macro_monitor.registry.sync import LoadedConfig, load_config, sync_config
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[2]
SHA = "b" * 40
PARKED = {
    "eurostat_sts",
    "eurostat_hicp",
    "eurostat_gov_debt",
    "eurostat_gdp_q",
    "worldbank_support",
}


@pytest.fixture
def dbs(test_database: TestDatabase) -> Iterator[TestDatabase]:
    with test_database.connect("mm_owner", timeout=120) as c:
        migrate.migrate(c)
        c.commit()
    yield test_database


def _flags(conn: psycopg.Connection) -> dict[str, bool]:
    rows = conn.execute("SELECT group_id, enabled FROM ref.series_group").fetchall()
    return {str(g): bool(e) for g, e in rows}


def test_default_true_and_null_rejected(dbs: TestDatabase) -> None:
    with dbs.connect("mm_owner", timeout=120) as conn:
        conn.execute(
            "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)"
        )
        conn.execute(
            "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES ('S','G','x')"
        )
        row = conn.execute("SELECT enabled FROM ref.series_group").fetchone()
        assert row is not None
        assert row[0] is True
        with pytest.raises(errors.NotNullViolation):
            conn.execute(
                "INSERT INTO ref.series_group (source_id, group_id, config_sha256, enabled) "
                "VALUES ('S','H','x',NULL)"
            )


def test_sync_stores_own_flag_idempotently_and_deletes_no_map_rows(dbs: TestDatabase) -> None:
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, ROOT, git_sha=SHA)
        flags = _flags(conn)
        assert all(flags[g] is False for g in PARKED)
        assert flags["eurostat_labour"] is True and flags["worldbank_annual"] is True
        n_map = conn.execute("SELECT count(*) FROM ref.series_map").fetchone()
        sync_config(conn, ROOT, git_sha=SHA)
        assert _flags(conn) == flags
        assert conn.execute("SELECT count(*) FROM ref.series_map").fetchone() == n_map


def _with_group_flag(
    base: LoadedConfig, tmp_path: Path, group_id: str, enabled: bool | None
) -> LoadedConfig:
    """Copy of the loaded config with ``enabled`` set on one group (None removes the key)."""
    data = copy.deepcopy(dict(base.sources.data))
    for s in data["sources"]:
        for g in s["groups"]:
            if g["id"] == group_id:
                if enabled is None:
                    g.pop("enabled", None)
                else:
                    g["enabled"] = enabled
                    if not enabled:
                        g["note"] = "parked in test"
    p = tmp_path / "sources.yaml"
    p.write_text(yaml.safe_dump(data), encoding="utf-8")
    return dataclasses.replace(base, sources=load_sources(p, today=date(2026, 11, 5)))


def _history(conn: psycopg.Connection, gid: str) -> int:
    row = conn.execute(
        "SELECT count(*) FROM ref.config_history "
        "WHERE table_name = 'series_group' AND row_data->>'group_id' = %s",
        [gid],
    ).fetchone()
    assert row is not None
    return int(row[0])


def _sha(conn: psycopg.Connection, gid: str) -> str:
    row = conn.execute(
        "SELECT config_sha256 FROM ref.series_group WHERE group_id = %s", [gid]
    ).fetchone()
    assert row is not None
    return str(row[0])


def test_flip_enabled_disabled_enabled_records_history_and_keeps_map_rows(
    dbs: TestDatabase, tmp_path: Path
) -> None:
    gid = "eurostat_labour"
    base = load_config(ROOT)
    on = _with_group_flag(base, tmp_path, gid, True)
    off = _with_group_flag(base, tmp_path, gid, False)
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, ROOT, git_sha=SHA, config=on)
        h_on, sha_on = _history(conn, gid), _sha(conn, gid)
        n_map = conn.execute("SELECT count(*) FROM ref.series_map").fetchone()
        ecb = conn.execute(
            "SELECT bool_and(enabled) FROM ref.series_group WHERE source_id = 'ecb'"
        ).fetchone()
        # AC-CFG-20 (i): the row carries the group's OWN flag, not the source-derived state
        assert ecb == (True,)
        assert _flags(conn)[gid] is True

        sync_config(conn, ROOT, git_sha=SHA, config=off)
        h_off, sha_off = _history(conn, gid), _sha(conn, gid)
        assert h_off == h_on + 1
        assert sha_off != sha_on
        assert _flags(conn)[gid] is False
        assert conn.execute("SELECT count(*) FROM ref.series_map").fetchone() == n_map

        sync_config(conn, ROOT, git_sha=SHA, config=off)  # idempotent: no new history row
        assert _history(conn, gid) == h_off

        sync_config(conn, ROOT, git_sha=SHA, config=on)
        assert _history(conn, gid) == h_off + 1
        assert _sha(conn, gid) == sha_on
        assert _flags(conn)[gid] is True
        assert conn.execute("SELECT count(*) FROM ref.series_map").fetchone() == n_map
