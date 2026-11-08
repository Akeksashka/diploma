# ruff: noqa: E501
"""T68: the `pubdump` views of the public dump (ADR-015, docs/specs/public-dump-spec.md section 2).

AC-DUMP-6 (completeness and column lists), AC-DUMP-7 (privileges), T-DDL-31, the T-DDL-11 view clause and the
redactions. Owner-rights behaviour on Neon is exercised here only to the extent that the test database runs there
(throwaway database, own roles); it remains UNVERIFIED for the production database.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest
from psycopg import errors

from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

DUMP_SCHEMAS = ("ref", "ingest", "staging", "curated", "analytics", "analytics_r", "ops")

# view -> (target table, order key); mirrors the table of public-dump-spec section 2.
TARGETS: dict[str, tuple[str, tuple[str, ...]]] = {
    "v_schema_migration": ("ops.schema_migration", ("version",)),
    "v_ref_unit": ("ref.unit", ("unit_code",)),
    "v_ref_domain": ("ref.domain", ("domain_id",)),
    "v_ref_entity": ("ref.entity", ("entity_id",)),
    "v_ref_source": ("ref.source", ("source_id",)),
    "v_ref_series_group": ("ref.series_group", ("source_id", "group_id")),
    "v_ref_entity_group_member": (
        "ref.entity_group_member",
        ("group_id", "entity_id", "valid_from"),
    ),
    "v_ref_indicator": ("ref.indicator", ("indicator_id",)),
    "v_ref_indicator_domain": ("ref.indicator_domain", ("indicator_id", "domain_id")),
    "v_ref_indicator_input": ("ref.indicator_input", ("indicator_id", "input_id", "usage")),
    "v_ref_indicator_target": (
        "ref.indicator_target",
        ("indicator_id", "entity_id", "valid_from"),
    ),
    "v_ref_global_translation": (
        "ref.global_translation",
        ("indicator_id", "entity_id", "valid_from"),
    ),
    "v_ref_inheritance_rule": (
        "ref.inheritance_rule",
        ("indicator_id", "entity_id", "valid_from"),
    ),
    "v_ref_series": ("ref.series", ("series_id",)),
    "v_ref_series_map": (
        "ref.series_map",
        ("indicator_id", "entity_id", "series_id", "role", "valid_from"),
    ),
    "v_ingest_run": ("ingest.run", ("run_id",)),
    "v_ref_config_history": ("ref.config_history", ("history_id",)),
    "v_ingest_raw_blob": ("ingest.raw_blob", ("sha256",)),
    "v_ingest_raw_object": ("ingest.raw_object", ("raw_id",)),
    "v_ingest_raw_snapshot": ("ingest.raw_snapshot", ("raw_id",)),
    "v_ingest_raw_series_status": (
        "ingest.raw_series_status",
        ("raw_id", "series_ref", "status"),
    ),
    "v_ingest_raw_load": ("ingest.raw_load", ("raw_id",)),
    "v_curated_observation": ("curated.observation", ("obs_id",)),
    "v_ops_drift_event": ("ops.drift_event", ("event_id",)),
    "v_ops_drift_decision": ("ops.drift_decision", ("decision_id",)),
    "v_ops_quality_override": ("ops.quality_override", ("override_id",)),
}

# Spec section 2 "Explicitly excluded".
EXCLUDED = {
    "ingest.request_state",
    "ingest.fetch_attempt",
    "staging.observation_load",
    "staging.series_meta_load",
    "staging.rejected",
    "ops.validation_result",
    "ops.run_summary",
    "ops.export_status",
    "ops.freshness_state",
}
EXCLUDED_PREFIXES = ("analytics.", "analytics_r.")

ROLES_NO_ACCESS = ("mm_reader", "mm_analytics", "mm_r")


def _migrated(test_database: TestDatabase) -> psycopg.Connection:
    conn = test_database.connect("mm_owner", timeout=120)
    migrate.migrate(conn)
    conn.commit()
    return conn


def _tables(conn: psycopg.Connection) -> set[str]:
    return {
        f"{n}.{r}"
        for n, r in conn.execute(
            "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = ANY(%s) AND c.relkind IN ('r','p')",
            [list(DUMP_SCHEMAS)],
        ).fetchall()
    }


def _columns(conn: psycopg.Connection, rel: str, *, generated: bool) -> list[str]:
    rows = conn.execute(
        "SELECT a.attname, a.attgenerated <> '' FROM pg_attribute a WHERE a.attrelid = %s::regclass "
        "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
        [rel],
    ).fetchall()
    return [c for c, g in rows if generated or not g]


def test_targets_table_is_self_consistent() -> None:
    targets = [t for t, _ in TARGETS.values()]
    assert len(targets) == len(set(targets))
    assert not set(targets) & EXCLUDED


def test_every_table_is_a_view_target_or_excluded(test_database: TestDatabase) -> None:
    """AC-DUMP-6 / T-DDL-31: a migration adding a table fails here until the dump is updated."""
    with _migrated(test_database) as conn:
        tables = _tables(conn)
        covered = {t for t, _ in TARGETS.values()} | EXCLUDED
        covered |= {t for t in tables if t.startswith(EXCLUDED_PREFIXES)}
        assert tables - covered == set(), "tables neither dumped nor excluded"
        assert {t for t, _ in TARGETS.values()} <= tables, "target table does not exist"
        assert tables >= EXCLUDED, "stale entry in the exclusion list"
        views = {
            v
            for (v,) in conn.execute(
                "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'pubdump' AND c.relkind <> 'i'"
            ).fetchall()
        }
        assert views == set(TARGETS) | {"v_p_public_source"}


def test_view_columns_equal_non_generated_table_columns(test_database: TestDatabase) -> None:
    with _migrated(test_database) as conn:
        for view, (table, order_key) in TARGETS.items():
            got = _columns(conn, f"pubdump.{view}", generated=True)
            assert got == _columns(conn, table, generated=False), view
            assert set(order_key) <= set(got), view
            comment = conn.execute(
                "SELECT obj_description(%s::regclass, 'pg_class')", [f"pubdump.{view}"]
            ).fetchone()
            assert comment is not None
            assert f"target: {table}; order_key: {', '.join(order_key)}" in str(comment[0]), view
        # generated columns are omitted on purpose
        assert "is_projection" not in _columns(
            conn, "pubdump.v_curated_observation", generated=True
        )
        assert "is_support" not in _columns(conn, "pubdump.v_ref_indicator", generated=True)
        assert _columns(conn, "pubdump.v_p_public_source", generated=True) == ["source_id"]


def test_views_are_owner_rights_and_owned_by_the_owner(test_database: TestDatabase) -> None:
    roles = test_database.roles
    with _migrated(test_database) as conn:
        rows = conn.execute(
            "SELECT c.relname, pg_get_userbyid(c.relowner), c.reloptions FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'pubdump' AND c.relkind = 'v'"
        ).fetchall()
        assert rows
        for name, owner, opts in rows:
            assert owner == roles["mm_owner"], name
            assert not any("security_invoker" in o for o in (opts or [])), name


def test_privileges_only_mm_ingest_reads_nobody_writes(test_database: TestDatabase) -> None:
    """AC-DUMP-7. The expected-matrix row `pubdump.v_*` is checked against the live catalog by test_privileges."""
    roles = test_database.roles
    with _migrated(test_database) as conn:
        views = [f"pubdump.{v}" for v in [*TARGETS, "v_p_public_source"]]
        for view in views:
            for base in ("mm_ingest", *ROLES_NO_ACCESS):
                for priv in ("INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                    row = conn.execute(
                        "SELECT has_table_privilege(%s, %s::regclass, %s)",
                        [roles[base], view, priv],
                    ).fetchone()
                    assert row == (False,), (base, view, priv)
            row = conn.execute(
                "SELECT has_table_privilege(%s, %s::regclass, 'SELECT')", [roles["mm_ingest"], view]
            ).fetchone()
            assert row == (True,), view
            for base in ROLES_NO_ACCESS:
                row = conn.execute(
                    "SELECT has_table_privilege(%s, %s::regclass, 'SELECT')", [roles[base], view]
                ).fetchone()
                assert row == (False,), (base, view)
        for base in ROLES_NO_ACCESS:
            row = conn.execute(
                "SELECT has_schema_privilege(%s, 'pubdump', 'USAGE')", [roles[base]]
            ).fetchone()
            assert row == (False,), base
        for base in ("mm_ingest", *ROLES_NO_ACCESS):
            row = conn.execute(
                "SELECT has_schema_privilege(%s, 'pubdump', 'CREATE')", [roles[base]]
            ).fetchone()
            assert row == (False,), base
    with test_database.connect("mm_ingest") as ing:
        for view in views:
            ing.execute(f"SELECT * FROM {view} LIMIT 1").fetchall()  # type: ignore[call-overload]
        with pytest.raises(errors.InsufficientPrivilege):
            ing.execute("INSERT INTO pubdump.v_ref_unit (unit_code) VALUES ('Z')")
        ing.rollback()
    for base in ROLES_NO_ACCESS:
        with test_database.connect(base) as c:
            with pytest.raises(errors.InsufficientPrivilege):
                c.execute("SELECT 1 FROM pubdump.v_ref_source")
            c.rollback()


# --- four-source fixture (ADR-003 AC-BKP-GATE shape): redaction and filter behaviour -------------

SOURCES = {  # source_id -> (archive_mode, publish_site)
    "P": ("public", "public"),
    "W": ("public", "withheld"),
    "H": ("hash_only", "public"),
    "HW": ("hash_only", "withheld"),
}
MARK = {s: f"MARK-{s}" for s in SOURCES}


def _build(ing: psycopg.Connection) -> None:
    here = str(Path(__file__).parent)
    if here not in sys.path:
        sys.path.insert(0, here)
    from test_ddl_curated import Fx  # Fx creates P, W, H, entity E1, unit PC and a run

    fx = Fx(ing)
    ing.execute(
        "INSERT INTO ref.source VALUES ('HW','p','rest','hash_only','withheld','l','a','x',true)"
    )
    ing.execute(
        "INSERT INTO ref.series_group (source_id, group_id, edition_ordered, config_sha256) "
        "VALUES ('HW','ED',true,'x'), ('HW','REG',false,'x')"
    )
    for i, src in enumerate(SOURCES):
        key = f"S{src}"
        fx.mk(key, src=src)
        base = 7770000 + 100 * i
        fx.obs(key, 2024, "OBS", base + 0.5, 5, kind="initial", src=src)
        fx.obs(key, 2024, "OBS", base + 1.5, 15, kind="revision", src=src)
        raw_id = ing.execute(
            "SELECT min(raw_id) FROM ingest.raw_object WHERE source_id = %s", [src]
        ).fetchone()
        assert raw_id is not None
        ing.execute(
            "INSERT INTO ingest.raw_load (raw_id, outcome, load_run_id, loaded_at, rows_inserted, detail) "
            "VALUES (%s,'loaded',%s, now(), 2, %s::jsonb)",
            [raw_id[0], fx.run_id, f'{{"count": "{MARK[src]}"}}'],
        )
        ev = ing.execute(
            "INSERT INTO ops.drift_event (run_id, source_id, raw_id, kind, series_ref, old, new, note) "
            "VALUES (%s,%s,%s,'unit',%s,%s::jsonb,%s::jsonb,%s) RETURNING event_id",
            [fx.run_id, src, raw_id[0], key, f'{{"v": "old-{MARK[src]}"}}',
             f'{{"v": "new-{MARK[src]}"}}', f"note-{MARK[src]}"],
        ).fetchone()  # fmt: skip
        assert ev is not None
        ing.execute(
            "INSERT INTO ops.drift_decision (event_id, decision, decided_by, decided_on, note) "
            "VALUES (%s,'accepted','u', current_date, %s)",
            [ev[0], f"dnote-{MARK[src]}"],
        )
        ing.execute(
            "INSERT INTO ops.quality_override (series_id, decision, reason, decided_by, decided_on) "
            "VALUES (%s,'exclude',%s,'u', current_date)",
            [fx.series[key], f"reason-{MARK[src]}"],
        )
    ing.commit()


def test_filter_and_redactions(test_database: TestDatabase) -> None:
    with _migrated(test_database):
        pass
    with test_database.connect("mm_ingest", timeout=120) as ing:
        _build(ing)
    with test_database.connect("mm_ingest") as ing:
        # T-DDL-11 view clause: v_observation_public and the observation dump view return public/public only
        obs = ing.execute("SELECT series_id, value FROM pubdump.v_curated_observation").fetchall()
        sid = dict(ing.execute("SELECT source_id, series_id FROM ref.series").fetchall())
        assert {s for s, _ in obs} == {sid["P"]}
        assert sorted(float(v) for _, v in obs) == [7770000.5, 7770001.5]
        pub = ing.execute("SELECT count(*) FROM curated.v_observation_public").fetchone()
        assert pub == (2,)

        # metadata of restricted sources stays (rows), values do not
        assert {r[0] for r in ing.execute("SELECT source_id FROM pubdump.v_ref_source")} == set(
            SOURCES
        )
        assert {r[0] for r in ing.execute("SELECT source_id FROM pubdump.v_ref_series")} == set(
            SOURCES
        )
        public = {r[0] for r in ing.execute("SELECT source_id FROM pubdump.v_p_public_source")}
        assert public == {"P"}

        raw_src = dict(ing.execute("SELECT raw_id, source_id FROM ingest.raw_object").fetchall())
        loads = ing.execute("SELECT raw_id, detail FROM pubdump.v_ingest_raw_load").fetchall()
        assert len(loads) == 4
        for raw_id, detail in loads:
            src = raw_src[raw_id]
            assert detail == ({"count": MARK[src]} if src == "P" else {}), src

        events = ing.execute(
            'SELECT source_id, "old", "new", note FROM pubdump.v_ops_drift_event'
        ).fetchall()
        assert len(events) == 4
        for src, old, new, note in events:
            if src == "P":
                assert old == {"v": f"old-{MARK[src]}"}
                assert new == {"v": f"new-{MARK[src]}"}
                assert note == f"note-{MARK[src]}"
            else:
                assert (old, new, note) == (None, None, None), src

        ev_src = dict(ing.execute("SELECT event_id, source_id FROM ops.drift_event").fetchall())
        decisions = ing.execute(
            "SELECT event_id, note FROM pubdump.v_ops_drift_decision"
        ).fetchall()
        assert len(decisions) == 4
        for event_id, note in decisions:
            src = ev_src[event_id]
            assert note == (f"dnote-{MARK[src]}" if src == "P" else None), src

        by_series = {v: k for k, v in sid.items()}
        overrides = ing.execute(
            "SELECT series_id, reason FROM pubdump.v_ops_quality_override"
        ).fetchall()
        assert len(overrides) == 4
        for series_id, reason in overrides:
            src = by_series[series_id]
            assert reason == (f"reason-{MARK[src]}" if src == "P" else "[redacted]"), src

    # nothing else changed: every non-observation view has as many rows as its table (owner counts)
    with test_database.connect("mm_owner") as owner:
        for view, (table, _) in TARGETS.items():
            if view == "v_curated_observation":
                continue
            n_view = owner.execute(f"SELECT count(*) FROM pubdump.{view}").fetchone()  # type: ignore[call-overload]
            n_tab = owner.execute(f"SELECT count(*) FROM {table}").fetchone()  # type: ignore[call-overload]
            assert n_view == n_tab, view
