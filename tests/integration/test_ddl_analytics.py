# ruff: noqa: E501
"""T-DDL-12/24/26/28 and AC-R-3 against migration 0008_analytics (plus the grants of section 8)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

import psycopg
import pytest
from psycopg import errors

from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

NOW = datetime(2026, 10, 1, tzinfo=UTC)

RUN_PUBLISHED_COLUMNS = [
    "analysis_run_id", "ingest_run_id", "as_of_run_date", "known_cutoff", "load_cutoff",
    "code_version", "git_sha", "config_sha256",
]  # fmt: skip
SNAPSHOT_PUBLISHED_COLUMNS = [
    "analysis_run_id", "indicator_id", "entity_id", "series_id", "ref_period_end", "known_at",
    "source_release_at", "age_days", "stale_limit_days", "limit_source", "is_stale", "inherited",
    "transform_id", "alignment", "alignment_reason", "value_kind", "publish", "publish_scope",
    "value", "transformed_value", "deviation", "ref_offset_days",
]  # fmt: skip
R_MANDATORY = {
    "analysis_run_id": "bigint",
    "module": "text",
    "method": "text",
    "package_versions": "jsonb",
    "known_cutoff": "timestamp with time zone",
    "created_at": "timestamp with time zone",
}


@pytest.fixture
def db(test_database: TestDatabase) -> TestDatabase:
    with test_database.connect("mm_owner", timeout=120) as c:
        migrate.migrate(c)
        c.commit()
    return test_database


def _ingest_run(admin: psycopg.Connection) -> int:
    row = admin.execute(
        "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status) "
        "VALUES ('pipeline','local','refresh','g','v1', %s, 'ok') RETURNING run_id",
        [NOW],
    ).fetchone()
    assert row is not None
    return int(row[0])


def _run_insert(conn: psycopg.Connection, ingest_run_id: int) -> int:
    row = conn.execute(
        "INSERT INTO analytics.run (ingest_run_id, as_of_run_date, known_cutoff, load_cutoff, code_version, "
        "params, git_sha, config_asof, config_sha256, mapping_sha256, overrides_sha256) "
        "VALUES (%s, %s, %s, %s, 'v1', '{\"config_sha256\":\"c\"}', 'g', %s, 'c', 'm', 'o') RETURNING analysis_run_id",
        [ingest_run_id, date(2026, 10, 1), NOW, NOW, NOW],
    ).fetchone()
    assert row is not None
    return int(row[0])


def _snap(conn: psycopg.Connection, run: int, ind: str, ent: str, **kw: object) -> None:
    cols: dict[str, object] = {
        "analysis_run_id": run, "indicator_id": ind, "entity_id": ent, "publish": True,
        "publish_scope": "ranked",
    }  # fmt: skip
    cols.update(kw)
    names = ", ".join(cols)
    marks = ", ".join(["%s"] * len(cols))
    conn.execute(
        f"INSERT INTO analytics.indicator_snapshot ({names}) VALUES ({marks})", list(cols.values())
    )


def _scoped(db: TestDatabase) -> int:
    with db.connect() as admin:
        rid = _ingest_run(admin)
        admin.commit()
    return rid


def test_t_ddl_12_reader_privileges(db: TestDatabase) -> None:
    roles = db.roles
    with db.connect() as c:

        def can(role: str, obj: str) -> bool:
            row = c.execute(
                "SELECT has_table_privilege(%s, %s::regclass, 'SELECT')", [roles[role], obj]
            ).fetchone()
            assert row is not None
            return bool(row[0])

        assert can("mm_reader", "analytics.scorecard_published")
        assert not can("mm_reader", "analytics.scorecard")
    rid = _scoped(db)
    with db.connect("mm_analytics") as a:
        run = _run_insert(a, rid)
        a.execute(
            "INSERT INTO analytics.scorecard_published (analysis_run_id, domain_id, entity_id, n_available, n_defined, publish_scope) "
            "VALUES (%s,'d','DE',1,2,'ranked')", [run],
        )  # fmt: skip
        a.commit()
    with db.connect("mm_reader") as rd:
        assert rd.execute("SELECT count(*) FROM analytics.scorecard_published").fetchone() == (1,)
        with pytest.raises(errors.InsufficientPrivilege):
            rd.execute("SELECT count(*) FROM analytics.scorecard")


@pytest.mark.parametrize(
    "table", ["indicator_rank_published", "indicator_alignment_published", "scorecard_published"]
)
def test_t_ddl_24_published_scope_required(db: TestDatabase, table: str) -> None:
    cols = {
        "indicator_rank_published": "(analysis_run_id, indicator_id, entity_id, percentile, n_ranked)",
        "indicator_alignment_published": "(analysis_run_id, indicator_id, rank_reference_period, reference_period_spread_days, n_ranked, n_unaligned, max_ref_spread_days)",
        "scorecard_published": "(analysis_run_id, domain_id, entity_id, n_available, n_defined)",
    }[table]
    vals = {
        "indicator_rank_published": "1,'i','DE',0.5,10",
        "indicator_alignment_published": "1,'i','2026-01-01',5,10,0,30",
        "scorecard_published": "1,'d','DE',1,2",
    }[table]
    ok_scopes = {"scorecard_published": {"ranked", "info_only"}}.get(table, {"ranked"})
    with db.connect("mm_owner") as c:
        with pytest.raises(errors.NotNullViolation):
            c.execute(f"INSERT INTO analytics.{table} {cols} VALUES ({vals})")
        c.rollback()
        for scope in ("ranked", "info_only", "excluded"):
            sql = f"INSERT INTO analytics.{table} {cols[:-1]}, publish_scope) VALUES ({vals}, %s)"
            if scope in ok_scopes:
                c.execute(sql, [scope])
                c.execute(f"DELETE FROM analytics.{table}")
            else:
                with pytest.raises(errors.CheckViolation):
                    c.execute(sql, [scope])
                c.rollback()


def test_t_ddl_24_snapshot_checks(db: TestDatabase) -> None:
    with db.connect("mm_owner") as c:
        for kw in (
            {"alignment": "unaligned"},
            {"alignment": "aligned", "alignment_reason": "fiscal_year_basis"},
            {"alignment": "unaligned", "alignment_reason": "other"},
            {"value_kind": "forecast"},
            {"limit_source": "other"},
            {"publish_scope": "everything"},
        ):
            with pytest.raises(errors.CheckViolation):
                _snap(c, 1, "i", "DE", **kw)
            c.rollback()
        _snap(
            c,
            1,
            "i",
            "DE",
            alignment="unaligned",
            alignment_reason="fiscal_year_basis",
            value_kind="estimate",
            limit_source="release_lag_aware",
        )
        c.commit()


def test_t_ddl_24_published_snapshot_view(db: TestDatabase) -> None:
    with db.connect("mm_owner") as c:
        cols = [r[0] for r in c.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='analytics' "
            "AND table_name='v_indicator_snapshot_published' ORDER BY ordinal_position").fetchall()]  # fmt: skip
        assert cols == SNAPSHOT_PUBLISHED_COLUMNS
        _snap(
            c,
            1,
            "i",
            "DE",
            value=1.5,
            transformed_value=2.5,
            deviation=0.1,
            ref_offset_days=-3,
            publish=True,
            value_kind="estimate",
        )
        _snap(c, 1, "i", "FR", value=1.5, transformed_value=2.5, deviation=0.1, ref_offset_days=-3, publish=False,
              publish_scope="excluded", alignment="unaligned", alignment_reason="fiscal_year_basis", value_kind="estimate")  # fmt: skip
        c.commit()
        shown = c.execute("SELECT value, transformed_value, deviation, ref_offset_days, publish_scope, value_kind, alignment_reason "
                          "FROM analytics.v_indicator_snapshot_published WHERE entity_id = %s", ["DE"]).fetchone()  # fmt: skip
        assert shown == (
            Decimal("1.5"),
            Decimal("2.5"),
            Decimal("0.1"),
            -3,
            "ranked",
            "estimate",
            None,
        )
        withheld = c.execute("SELECT value, transformed_value, deviation, ref_offset_days, publish_scope, value_kind, alignment_reason "
                             "FROM analytics.v_indicator_snapshot_published WHERE entity_id = %s", ["FR"]).fetchone()  # fmt: skip
        assert withheld == (None, None, None, None, "excluded", "estimate", "fiscal_year_basis")


def test_t_ddl_24_scorecard_peer_set_columns(db: TestDatabase) -> None:
    with db.connect("mm_owner") as c:
        for t in ("scorecard", "scorecard_published"):
            scope = ", 'ranked'" if t.endswith("published") else ""
            extra = ", publish_scope" if t.endswith("published") else ""
            for ent in ("DE", "FR"):
                c.execute(
                    f"INSERT INTO analytics.{t} (analysis_run_id, domain_id, entity_id, n_available, n_defined, "
                    f"heterogeneous_peer_set, peer_set_size_min, peer_set_size_max{extra}) VALUES (1,'d',%s,1,2,true,10,20{scope})",
                    [ent],
                )
            row = c.execute(
                f"SELECT count(DISTINCT (heterogeneous_peer_set, peer_set_size_min, peer_set_size_max)) FROM analytics.{t}"
            ).fetchone()
            assert row == (1,)


def test_alert_and_published_view(db: TestDatabase) -> None:
    with db.connect("mm_owner") as c:
        for ent, pub in (("DE", True), ("FR", False)):
            c.execute(
                "INSERT INTO analytics.alert (analysis_run_id, indicator_id, entity_id, series_id, ref_period_end, method, window_obs, n_obs, level, confidence, publish) "
                "VALUES (1,'i',%s,1,'2026-01-01','z',12,12,'watch','full',%s)", [ent, pub],
            )  # fmt: skip
        assert c.execute("SELECT entity_id FROM analytics.v_alert_published").fetchall() == [
            ("DE",)
        ]
        with pytest.raises(errors.CheckViolation):
            c.execute(
                "INSERT INTO analytics.alert (analysis_run_id, indicator_id, entity_id, series_id, ref_period_end, method, window_obs, n_obs, level, confidence, publish) "
                "VALUES (1,'j','DE',1,'2026-01-01','z',12,12,'bad','full',true)"
            )


def test_t_ddl_26_run_view(db: TestDatabase) -> None:
    rid = _scoped(db)
    with db.connect("mm_analytics") as a:
        run = _run_insert(a, rid)
        a.commit()
    with db.connect("mm_reader") as rd:
        cols = [
            d.name for d in rd.execute("SELECT * FROM analytics.v_run_published").description or []
        ]
        assert cols == RUN_PUBLISHED_COLUMNS
        assert rd.execute("SELECT analysis_run_id FROM analytics.v_run_published").fetchall() == [
            (run,)
        ]
        for q in (
            "SELECT params FROM analytics.v_run_published",
            "SELECT * FROM analytics.run",
            "SELECT * FROM ingest.run",
            "SELECT * FROM ops.run_summary",
        ):
            with pytest.raises((errors.UndefinedColumn, errors.InsufficientPrivilege)):
                rd.execute(q)
            rd.rollback()
        sel = ("SELECT analysis_run_id FROM analytics.v_run_published WHERE ingest_run_id = %s "
               "ORDER BY analysis_run_id DESC LIMIT 1")  # fmt: skip
        assert rd.execute(sel, [rid]).fetchall() == [(run,)]
        assert rd.execute(sel, [rid + 1000]).fetchall() == []
    with db.connect("mm_ingest") as ing, pytest.raises(errors.InsufficientPrivilege):
        ing.execute("SELECT * FROM analytics.run")


def test_t_ddl_28_run_id_generator(db: TestDatabase) -> None:
    rid = _scoped(db)
    with db.connect("mm_analytics") as a:
        ids = [_run_insert(a, rid), _run_insert(a, rid), _run_insert(a, rid)]
        a.commit()
        assert len(set(ids)) == 3
        assert ids == sorted(ids)
        with pytest.raises(errors.GeneratedAlways):
            a.execute(
                "INSERT INTO analytics.run (analysis_run_id, ingest_run_id, as_of_run_date, known_cutoff, load_cutoff, code_version, params, git_sha, config_asof, config_sha256, mapping_sha256, overrides_sha256) "
                "VALUES (999, %s, %s, %s, %s, 'v', '{}', 'g', %s, 'c', 'm', 'o')", [rid, date(2026, 10, 1), NOW, NOW, NOW],
            )  # fmt: skip
        a.rollback()
    with db.connect("mm_ingest") as ing:
        with pytest.raises(errors.InsufficientPrivilege):
            _run_insert(ing, rid)
        ing.rollback()
    with db.connect() as c:
        row = c.execute(
            "SELECT has_sequence_privilege(%s, 'analytics.run_analysis_run_id_seq', 'USAGE')",
            [db.roles["mm_analytics"]],
        ).fetchone()
        assert row == (True,)


def _r_missing(conn: psycopg.Connection) -> dict[str, set[str]]:
    """Catalog contract test (AC-R-3): analytics_r tables missing a mandatory column, name or type, or nullable."""
    out: dict[str, set[str]] = {}
    for (tbl,) in conn.execute(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'analytics_r' AND c.relkind IN ('r','p')"
    ).fetchall():
        have = {
            name: (typ, notnull)
            for name, typ, notnull in conn.execute(
                "SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull FROM pg_attribute a "
                "WHERE a.attrelid = ('analytics_r.' || quote_ident(%s))::regclass AND a.attnum > 0 AND NOT a.attisdropped",
                [tbl],
            ).fetchall()
        }
        bad = {
            c for c, t in R_MANDATORY.items() if c not in have or have[c][0] != t or not have[c][1]
        }
        if bad:
            out[tbl] = bad
    return out


def test_ac_r_3_mandatory_columns(db: TestDatabase) -> None:
    with db.connect() as c:
        assert c.execute("SELECT to_regnamespace('analytics_r') IS NOT NULL").fetchone() == (True,)
        assert _r_missing(c) == {}  # v1 ships no R table
        c.execute(
            "CREATE TABLE analytics_r.good (analysis_run_id bigint NOT NULL, module text NOT NULL, method text NOT NULL, "
            "package_versions jsonb NOT NULL, known_cutoff timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), x numeric)"
        )
        c.execute(
            "CREATE TABLE analytics_r.bad (analysis_run_id bigint NOT NULL, module text, method text NOT NULL)"
        )
        assert _r_missing(c) == {
            "bad": {"module", "package_versions", "known_cutoff", "created_at"}
        }
        c.rollback()
    with db.connect() as c:
        assert c.execute(
            "SELECT has_schema_privilege(%s,'analytics_r','USAGE'), has_schema_privilege(%s,'analytics_r','USAGE')",
            [db.roles["mm_r"], db.roles["mm_reader"]],
        ).fetchone() == (True, False)
