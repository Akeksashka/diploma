# ruff: noqa: E501, PT018, PT022
"""sync-config against a migrated throwaway database (T18).

AC-CFG-6/T-DDL-18 (stored SA), AC-PAR-8 (golden), AC-CFG-15, AC-CFG-14, T-DDL-16 idempotence,
ADR-018 (no ref.series created, pending entries, no series_map row).
"""

from __future__ import annotations

import csv
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest
import yaml

from macro_monitor.registry.config import ConfigError
from macro_monitor.registry.sync import sync_config
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "tests" / "fixtures" / "golden" / "resolved_indicators.csv"
SHA = "a" * 40


def _map_entry_count() -> int:
    """Number of series_map entries shipped in config (every entry is pending until a series exists)."""
    n = 0
    for f in sorted((ROOT / "config" / "series_map").glob("*.yaml")):
        data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        n += len(data.get("series", []))
    return n


@pytest.fixture
def dbs(test_database: TestDatabase) -> Iterator[TestDatabase]:
    with test_database.connect("mm_owner", timeout=120) as c:
        migrate.migrate(c)
        c.commit()
    yield test_database


def history_count(conn: psycopg.Connection) -> int:
    row = conn.execute("SELECT count(*) FROM ref.config_history").fetchone()
    assert row is not None
    return int(row[0])


def scalar(conn: psycopg.Connection, q: str) -> int:
    row = conn.execute(q).fetchone()  # type: ignore[call-overload]
    assert row is not None
    return int(row[0])


def test_sync_idempotent_and_contents(dbs: TestDatabase) -> None:
    with dbs.connect("mm_ingest", timeout=120) as conn:
        r1 = sync_config(conn, ROOT, git_sha=SHA)
        n1 = (
            history_count(conn) if False else None
        )  # mm_ingest cannot read history (privilege matrix)
        assert n1 is None
        assert r1.run_id is not None and len(r1.pending) == _map_entry_count() and not r1.mapped
    with dbs.connect() as admin:
        n1 = history_count(admin)
        assert n1 > 0
        assert admin.execute(
            "SELECT DISTINCT git_sha, run_id FROM ref.config_history"
        ).fetchall() == [(SHA, r1.run_id)]
        assert admin.execute(
            "SELECT status FROM ingest.run WHERE run_id = %s", [r1.run_id]
        ).fetchone() == ("ok",)
        # WLD seeded, 42 countries, domains (AC-CFG-15)
        assert admin.execute(
            "SELECT entity_id, kind, is_ranked FROM ref.entity WHERE is_global"
        ).fetchall() == [("WLD", "aggregate", False)]
        assert scalar(admin, "SELECT count(*) FROM ref.entity WHERE kind = 'country'") == 42
        assert scalar(admin, "SELECT count(*) FROM ref.domain") == 11
        assert admin.execute(
            "SELECT domain_id FROM ref.domain WHERE NOT is_ranked ORDER BY 1"
        ).fetchall() == [("agri",), ("global",)]
        # source hash, group flags
        assert admin.execute(
            "SELECT length(config_sha256), enabled FROM ref.source WHERE source_id = 'eurostat'"
        ).fetchone() == (64, False)
        assert admin.execute(
            "SELECT snapshot_mode, materiality_abs, materiality_rel, reestimating FROM ref.series_group"
        ).fetchone() == ("none", 0, 0, False)
        # AC-CFG-14: is_support exactly for inputs
        assert (
            scalar(admin, "SELECT count(*) FROM ref.indicator WHERE is_support <> (kind = 'input')")
            == 0
        )
        # ADR-018: never a series, pending only
        assert scalar(admin, "SELECT count(*) FROM ref.series") == 0
        assert scalar(admin, "SELECT count(*) FROM ref.series_map") == 0
        # A02 targets expanded
        assert (
            scalar(admin, "SELECT count(*) FROM ref.indicator_target WHERE indicator_id = 'A02'")
            == 42
        )
    with dbs.connect("mm_ingest", timeout=120) as conn:
        r2 = sync_config(conn, ROOT, git_sha=SHA)
        assert r2.run_id != r1.run_id
    with dbs.connect() as admin:
        assert history_count(admin) == n1  # second run writes no config_history rows


def test_par8_golden_and_provenance(dbs: TestDatabase) -> None:
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, ROOT, git_sha=SHA)
    with dbs.connect() as admin:
        db = {
            r[0]: r[1:]
            for r in admin.execute(
                "SELECT indicator_id, stationarity_class, release_lag_aware, staleness_class, alert_method, max_ref_spread_days, "
                "params -> 'provenance' ->> 'stationarity_class', params -> 'review' ->> 'status', "
                "(SELECT count(*) FROM jsonb_object_keys(params -> 'provenance')) FROM ref.indicator"
            ).fetchall()
        }
    with GOLDEN.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == len(db) == 83
    for g in rows:
        st, lag, stale, method, spread, prov, review, nprov = db[g["id"]]
        assert st == g["stationarity_class"], g["id"]
        assert str(lag).lower() == g["release_lag_aware"], g["id"]
        assert (
            stale == g["staleness_class"]
            and method == g["alert_method"]
            and spread == int(g["max_ref_spread_days"])
        )
        assert prov in {"global", "indicator"} or prov.startswith("family:")
        assert review == g["review_status"] and nprov > 0


def test_closing_by_enabled_and_change_history(dbs: TestDatabase, tmp_path: Path) -> None:
    shutil.copytree(ROOT / "config", tmp_path / "config")
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, tmp_path, git_sha=SHA)
    p = tmp_path / "config/sources.yaml"
    p.write_text(
        p.read_text(encoding="utf-8").replace("publish_site: public ", "publish_site: withheld", 1),
        encoding="utf-8",
    )
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, tmp_path, git_sha="b" * 40)
    with dbs.connect() as admin:
        assert admin.execute(
            "SELECT publish_site FROM ref.source WHERE source_id = 'eurostat'"
        ).fetchone() == ("withheld",)
        assert (
            scalar(
                admin,
                "SELECT count(*) FROM ref.config_history WHERE table_name = 'source' AND op = 'update' AND git_sha = '"
                + "b" * 40
                + "'",
            )
            == 1
        )


def _seed_series(
    admin: psycopg.Connection, sa: str, key: str = "M.SA.TOTAL.PC_ACT.T.DE", ent: str = "DEU"
) -> int:
    # PC_ACT is emitted by the Eurostat parser but is not in the ref.unit seed (T23 gap): the test adds it.
    admin.execute(
        "INSERT INTO ref.unit VALUES ('PC_ACT', 'ratio', 'Percent of active population') ON CONFLICT DO NOTHING"
    )
    row = admin.execute(
        "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, frequency, unit_code, price_basis, seasonal_adjustment, first_seen_at) "
        "VALUES ('eurostat', 'eurostat_labour', 'une_rt_m', %s, %s, 't', 'M', 'PC_ACT', 'NA', %s, now()) RETURNING series_id",
        [key, ent, sa],
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_existing_series_is_mapped_rest_pending(dbs: TestDatabase) -> None:
    with dbs.connect() as admin:
        # sources must exist first: run sync once, then add the series row (as the loader would)
        pass
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, ROOT, git_sha=SHA)
    with dbs.connect() as admin:
        sid = _seed_series(admin, "SA")
        admin.commit()
    with dbs.connect("mm_ingest", timeout=120) as conn:
        r = sync_config(conn, ROOT, git_sha=SHA)
        assert [e.entity for e in r.mapped] == ["DEU"] and len(r.pending) == _map_entry_count() - 1
    with dbs.connect() as admin:
        assert admin.execute("SELECT series_id, role FROM ref.series_map").fetchall() == [
            (sid, "headline")
        ]
        assert scalar(admin, "SELECT count(*) FROM ref.series") == 1  # sync created none
    # entry removed from config: the open mapping row is closed, not deleted
    # (done through a config copy below)


def test_removed_entry_closes_row(dbs: TestDatabase, tmp_path: Path) -> None:
    shutil.copytree(ROOT / "config", tmp_path / "config")
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, tmp_path, git_sha=SHA)
    with dbs.connect() as admin:
        _seed_series(admin, "SA")
        admin.commit()
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, tmp_path, git_sha=SHA)
    m = tmp_path / "config/series_map/eurostat_labour.yaml"
    text = m.read_text(encoding="utf-8")
    m.write_text(
        text.split("  - dataset", 1)[0]
        + "  - dataset"
        + text.split("  - dataset")[2]
        + "  - dataset"
        + text.split("  - dataset")[3],
        encoding="utf-8",
    )
    with dbs.connect("mm_ingest", timeout=120) as conn:
        r = sync_config(conn, tmp_path, git_sha=SHA)
        assert r.closed_map_rows == 1
    with dbs.connect() as admin:
        assert scalar(admin, "SELECT count(*) FROM ref.series_map WHERE valid_to IS NOT NULL") == 1


def test_ddl18_stored_ca_series_rejected(dbs: TestDatabase, tmp_path: Path) -> None:
    shutil.copytree(ROOT / "config", tmp_path / "config")
    ip = tmp_path / "config/indicators.yaml"
    t = ip.read_text(encoding="utf-8")
    s = t.index("  - id: M09\n")
    e = t.index("\n  - id:", s)
    ip.write_text(
        t[:s] + t[s:e].replace("transform: LEVEL", "transform: M3M3_ANN") + t[e:], encoding="utf-8"
    )
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, tmp_path, git_sha=SHA)
    with dbs.connect() as admin:
        _seed_series(admin, "CA")
        admin.commit()
    with dbs.connect("mm_ingest", timeout=120) as conn, pytest.raises(ConfigError, match="rule 8"):
        sync_config(conn, tmp_path, git_sha=SHA)
    with dbs.connect() as admin:
        assert scalar(admin, "SELECT count(*) FROM ref.series_map") == 0
        assert admin.execute(
            "SELECT status FROM ingest.run ORDER BY run_id DESC LIMIT 1"
        ).fetchone() == ("failed",)


def test_g02_stale_agri_link_removed_by_0012_and_not_recreated(dbs: TestDatabase) -> None:
    """AC-G02: 0012 deletes the stale (G02, agri) link; sync-config with the new config never recreates it."""
    q = "SELECT domain_id FROM ref.indicator_domain WHERE indicator_id = 'G02' ORDER BY 1"
    sql = (
        ROOT / "src/macro_monitor/storage/migrations/0012_g02_remove_agri_domain_link.sql"
    ).read_text(encoding="utf-8")
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, ROOT, git_sha=SHA)
    with dbs.connect() as admin:
        assert [r[0] for r in admin.execute(q).fetchall()] == ["global"]
        # Simulate a database synced before the amendment: the stale link is present.
        admin.execute(
            "INSERT INTO ref.indicator_domain (indicator_id, domain_id, is_ranked) VALUES ('G02', 'agri', false)"
        )
        admin.commit()
        assert [r[0] for r in admin.execute(q).fetchall()] == ["agri", "global"]
        before = scalar(admin, "SELECT count(*) FROM ref.indicator_domain")
        admin.execute(sql)  # type: ignore[call-overload]
        admin.commit()
        assert [r[0] for r in admin.execute(q).fetchall()] == ["global"]
        assert scalar(admin, "SELECT count(*) FROM ref.indicator_domain") == before - 1
        assert (
            scalar(
                admin,
                "SELECT count(*) FROM ref.config_history WHERE table_name = 'indicator_domain' "
                "AND op = 'delete' AND git_sha = 'migration-0012'",
            )
            == 1
        )
        admin.execute(sql)  # type: ignore[call-overload]  # idempotent no-op
        admin.commit()
    with dbs.connect("mm_ingest", timeout=120) as conn:
        sync_config(conn, ROOT, git_sha="c" * 40)
    with dbs.connect() as admin:
        assert [r[0] for r in admin.execute(q).fetchall()] == ["global"]
