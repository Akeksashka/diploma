# ruff: noqa: E501
"""T-DDL-10 (role-privilege matrix), the T-DDL-33 privilege sides and the T10/T12/T15 carry-overs.

The expected matrix (tests/fixtures/privileges/expected_matrix.csv) is derived from DDL spec section 8
only. Cell syntax: ``-`` none; ``OWNER`` everything the owner has; otherwise ``;``-separated tokens
``S I U D T`` (SELECT INSERT UPDATE DELETE TRUNCATE) or ``X`` (EXECUTE) or ``U`` on a sequence (USAGE).
``U(a+b)`` is a column-level grant on exactly those columns; ``S!(a+b)`` is SELECT on every column
except those. ``?`` means the spec says nothing for that cell (not asserted).

Objects that do not exist yet (``analytics_r.*``, no table in v1) are reported by ``test_not_yet_created_objects_are_the_known_ones``
without failing. FUTURE OBLIGATION: the migration that creates each of them must carry its section-8
grants; the matrix test then applies to it automatically because it enumerates the live catalog.
"""

from __future__ import annotations

import csv
import fnmatch
import re
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest
from psycopg import errors

from macro_monitor.models import enums
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

FIXTURE = Path(__file__).parent.parent / "fixtures" / "privileges" / "expected_matrix.csv"
ROLES = ("mm_owner", "mm_ingest", "mm_analytics", "mm_r", "mm_reader")
SCHEMAS = ("ref", "ingest", "staging", "curated", "ops", "analytics", "analytics_r", "pubdump")
TABLE_PRIVS = {"S": "SELECT", "I": "INSERT", "U": "UPDATE", "D": "DELETE", "T": "TRUNCATE"}
COLUMN_PRIVS = ("S", "I", "U")

# What may legitimately be absent today (see module docstring).
NOT_YET_CREATED = re.compile(r"^analytics_r\..*$")


class Cell:
    """Parsed expected cell for one (role, object)."""

    def __init__(self, text: str, kind: str, role: str) -> None:
        self.unspecified = text == "?"
        self.table: set[str] = set()
        self.cols: dict[str, set[str]] = {}  # priv -> allowed columns
        self.except_cols: dict[
            str, set[str]
        ] = {}  # priv -> columns excluded from a table-wide grant
        self.execute = False
        self.usage = False
        if self.unspecified or text == "-":
            return
        if text == "OWNER":
            if kind == "function":
                self.execute = True
            elif kind == "sequence":
                self.usage = True
            else:
                self.table = set(TABLE_PRIVS)  # the owner holds every privilege (DDL role)
            return
        for tok in text.split(";"):
            if tok == "X":
                self.execute = True
            elif tok == "U" and kind == "sequence":
                self.usage = True
            elif m := re.fullmatch(r"([SIU])!\((.*)\)", tok):
                self.except_cols[m.group(1)] = set(m.group(2).split("+"))
            elif m := re.fullmatch(r"([SIU])\((.*)\)", tok):
                self.cols[m.group(1)] = set(m.group(2).split("+"))
            else:
                assert tok in TABLE_PRIVS, f"bad token {tok!r} for {role}"
                self.table.add(tok)

    def column_allowed(self, priv: str, column: str) -> bool:
        if priv in self.table:
            return True
        if column in self.cols.get(priv, set()):
            return True
        return priv in self.except_cols and column not in self.except_cols[priv]


class Row:
    def __init__(self, rec: dict[str, str]) -> None:
        self.obj = rec["object"]
        self.kind = rec["kind"]
        self.cells = {r: Cell(rec[r], self.kind, r) for r in ROLES}

    def matches(self, name: str) -> bool:
        return fnmatch.fnmatchcase(name, self.obj)


def load_fixture() -> list[Row]:
    with FIXTURE.open(newline="", encoding="utf-8") as fh:
        return [Row(rec) for rec in csv.DictReader(fh)]


def test_fixture_is_well_formed() -> None:
    rows = load_fixture()
    names = [r.obj for r in rows]
    assert len(names) == len(set(names)), "duplicate fixture objects"
    assert {r.kind for r in rows} <= {"table", "view", "function", "sequence"}
    for r in rows:
        if r.obj.startswith("analytics_r.") or r.obj.startswith("analytics."):
            assert not r.cells["mm_ingest"].table, r.obj  # ADR-012


def _migrated(test_database: TestDatabase) -> psycopg.Connection:
    conn = test_database.connect("mm_owner", timeout=120)
    migrate.migrate(conn)
    conn.commit()
    return conn


def _live_objects(conn: psycopg.Connection) -> dict[str, tuple[str, int]]:
    """schema.name -> (kind, oid) for relations, sequences and functions of the application schemas."""
    out: dict[str, tuple[str, int]] = {}
    for nsp, name, relkind, oid in conn.execute(
        "SELECT n.nspname, c.relname, c.relkind, c.oid FROM pg_class c "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = ANY(%s) AND c.relkind IN ('r','p','v','m','S')",
        [list(SCHEMAS)],
    ).fetchall():
        kind = {"r": "table", "p": "table", "v": "view", "m": "view", "S": "sequence"}[relkind]
        out[f"{nsp}.{name}"] = (kind, oid)
    for nsp, name, oid in conn.execute(
        "SELECT n.nspname, p.proname, p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
        "WHERE n.nspname = ANY(%s)",
        [list(SCHEMAS)],
    ).fetchall():
        out[f"{nsp}.{name}"] = ("function", oid)
    return out


def _match(rows: list[Row], name: str) -> Row | None:
    exact = [r for r in rows if r.obj == name]
    if exact:
        return exact[0]
    wild = [r for r in rows if "*" in r.obj and r.matches(name)]
    return wild[0] if wild else None


def _diffs(conn: psycopg.Connection, roles: dict[str, str], rows: list[Row]) -> list[str]:
    """Compare every (role, object, privilege[, column]) cell of the live catalog with the fixture.

    Privileges are read in four bulk queries (one round trip each) because per-cell queries are too
    slow against a remote database.
    """
    problems: list[str] = []
    live = _live_objects(conn)
    by_oid = {oid: (name, kind) for name, (kind, oid) in live.items()}
    base_of = {v: k for k, v in roles.items()}
    role_list = list(roles.values())
    got_table = {
        (oid, base_of[role], priv): bool(v)
        for oid, role, priv, v in conn.execute(
            "SELECT c.oid, r, p, has_table_privilege(r, c.oid, p) FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN unnest(%s::text[]) r "
            "CROSS JOIN unnest(%s::text[]) p WHERE n.nspname = ANY(%s) AND c.relkind IN ('r','p','v','m')",
            [role_list, list(TABLE_PRIVS.values()), list(SCHEMAS)],
        ).fetchall()
    }
    got_col = {
        (oid, col, base_of[role], priv): bool(v)
        for oid, col, role, priv, v in conn.execute(
            "SELECT c.oid, a.attname, r, p, has_column_privilege(r, c.oid, a.attnum, p) FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid "
            "CROSS JOIN unnest(%s::text[]) r CROSS JOIN unnest(%s::text[]) p "
            "WHERE n.nspname = ANY(%s) AND c.relkind IN ('r','p','v','m') AND a.attnum > 0 "
            "AND NOT a.attisdropped",
            [role_list, [TABLE_PRIVS[k] for k in COLUMN_PRIVS], list(SCHEMAS)],
        ).fetchall()
    }
    got_fn = {
        (oid, base_of[role]): bool(v)
        for oid, role, v in conn.execute(
            "SELECT p.oid, r, has_function_privilege(r, p.oid, 'EXECUTE') FROM pg_proc p "
            "JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN unnest(%s::text[]) r "
            "WHERE n.nspname = ANY(%s)",
            [role_list, list(SCHEMAS)],
        ).fetchall()
    }
    got_seq = {
        (oid, base_of[role]): bool(v)
        for oid, role, v in conn.execute(
            "SELECT c.oid, r, has_sequence_privilege(r, c.oid, 'USAGE') FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN unnest(%s::text[]) r "
            "WHERE n.nspname = ANY(%s) AND c.relkind = 'S'",
            [role_list, list(SCHEMAS)],
        ).fetchall()
    }
    cols_of: dict[int, list[str]] = {}
    for oid, col, _r, _p in got_col:
        cols_of.setdefault(oid, [])
        if col not in cols_of[oid]:
            cols_of[oid].append(col)
    for oid, (name, kind) in sorted(by_oid.items(), key=lambda kv: kv[1]):
        row = _match(rows, name)
        if row is None:
            problems.append(f"{name}: database object absent from the expected matrix")
            continue
        if row.kind != kind:
            problems.append(f"{name}: kind {kind} but fixture says {row.kind}")
            continue
        for base in ROLES:
            cell = row.cells[base]
            if cell.unspecified:
                continue
            if kind == "function":
                if got_fn[(oid, base)] != cell.execute:
                    problems.append(f"{name}: {base} EXECUTE expected {cell.execute}")
            elif kind == "sequence":
                if got_seq[(oid, base)] != cell.usage:
                    problems.append(f"{name}: {base} USAGE expected {cell.usage}")
            else:
                for key, priv in TABLE_PRIVS.items():
                    if (oid, base, priv) in got_table and got_table[(oid, base, priv)] != (
                        key in cell.table
                    ):
                        problems.append(
                            f"{name}: {base} table-level {priv} expected {key in cell.table}"
                        )
                for col in cols_of.get(oid, []):
                    for key in COLUMN_PRIVS:
                        exp = cell.column_allowed(key, col)
                        if got_col[(oid, col, base, TABLE_PRIVS[key])] != exp:
                            problems.append(
                                f"{name}.{col}: {base} {TABLE_PRIVS[key]} expected {exp}"
                            )
    return problems


def test_privilege_matrix_equals_fixture(test_database: TestDatabase) -> None:
    rows = load_fixture()
    with _migrated(test_database) as conn:
        problems = _diffs(conn, test_database.roles, rows)
        assert not problems, "\n".join(problems[:60])
        live = set(_live_objects(conn))
        assert len(live) > 60  # the catalog was really enumerated
        # fixture rows without a live object must be the known not-yet-created ones
        pending = [r.obj for r in rows if not any(r.matches(n) for n in live)]
        assert all(NOT_YET_CREATED.match(p) for p in pending), pending


def test_not_yet_created_objects_are_the_known_ones() -> None:
    """Documents the deferral: when T34/T17/pubdump migrations land, their rows become live checks."""
    pending_ok = {r.obj for r in load_fixture() if NOT_YET_CREATED.match(r.obj)}
    assert "analytics_r.*" in pending_ok


def test_explicit_negatives_and_executable_behaviour(test_database: TestDatabase) -> None:
    roles = test_database.roles
    with _migrated(test_database) as conn:

        def can(role: str, obj: str, priv: str) -> bool:
            row = conn.execute(
                "SELECT has_table_privilege(%s, %s::regclass, %s)", [roles[role], obj, priv]
            ).fetchone()
            assert row is not None
            return bool(row[0])

        for obj in ("curated.observation", "ingest.run", "ops.run_summary", "ref.config_history",
                    "ingest.raw_object", "ops.drift_event"):  # fmt: skip
            assert not can("mm_reader", obj, "SELECT"), obj
        # mm_reader: no write privilege on any object, table level or column level
        rows = conn.execute(
            "SELECT c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = ANY(%s) AND c.relkind IN ('r','p','v','m')",
            [list(SCHEMAS)],
        ).fetchall()
        for (obj,) in rows:
            for priv in ("INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                assert not can("mm_reader", obj, priv), (obj, priv)
        got = conn.execute(
            "SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid "
            "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY(%s) AND a.attnum > 0 "
            "AND c.relkind IN ('r','p','v','m') AND (has_column_privilege(%s, c.oid, a.attnum, 'INSERT') "
            "OR has_column_privilege(%s, c.oid, a.attnum, 'UPDATE'))",
            [list(SCHEMAS), roles["mm_reader"], roles["mm_reader"]],
        ).fetchone()
        assert got == (0,)
        for view in ("curated.v_revision_history",):
            assert can("mm_reader", view, "SELECT")
        # mm_ingest: no analytics privilege (those schemas do not exist before T34; vacuous until then)
        analytics_rels = conn.execute(
            "SELECT c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname IN ('analytics','analytics_r') AND c.relkind IN ('r','p','v','m')"
        ).fetchall()
        for (obj,) in analytics_rels:
            assert not can("mm_ingest", obj, "SELECT"), obj
        # no TRUNCATE on staging.*, no UPDATE/DELETE/TRUNCATE on curated.observation for mm_ingest
        for obj in ("staging.observation_load", "staging.series_meta_load", "staging.rejected"):
            assert not can("mm_ingest", obj, "TRUNCATE")
            assert not can("mm_ingest", obj, "UPDATE")
        for priv in ("UPDATE", "DELETE", "TRUNCATE"):
            assert not can("mm_ingest", "curated.observation", priv)
        assert can("mm_ingest", "ops.export_status", "INSERT")
        assert can("mm_ingest", "ops.schema_migration", "SELECT")  # T10 carry-over
        # ADR-038: mm_reader reads the owner-rights view, never the table
        assert can("mm_reader", "ops.v_schema_version", "SELECT")
        assert not can("mm_reader", "ops.schema_migration", "SELECT")
        assert not can("mm_r", "curated.observation", "SELECT")
        # nobody but the owner may create objects in the application schemas
        for sch in ("ref", "ingest", "staging", "curated", "ops"):
            for base in ROLES[1:]:
                row = conn.execute(
                    "SELECT has_schema_privilege(%s, %s, 'CREATE')", [roles[base], sch]
                ).fetchone()
                assert row == (False,), (base, sch)
        # T12 carry-over: fn_config_asof is executable by the config_history readers, not by mm_reader
        for base, exp in (
            ("mm_ingest", True),
            ("mm_analytics", True),
            ("mm_r", True),
            ("mm_reader", False),
        ):
            row = conn.execute(
                "SELECT has_function_privilege(%s, 'ref.fn_config_asof(text, timestamptz)', 'EXECUTE')",
                [roles[base]],
            ).fetchone()
            assert row == (exp,), base
        row = conn.execute(
            "SELECT has_function_privilege(%s, 'pg_advisory_xact_lock(bigint)', 'EXECUTE')",
            [roles["mm_analytics"]],
        ).fetchone()
        assert row == (True,)

    # behaviour under the real login roles
    with test_database.connect("mm_analytics") as a:
        a.execute("SELECT pg_advisory_xact_lock(42)")
        a.rollback()
        with pytest.raises(errors.InsufficientPrivilege):
            a.execute("INSERT INTO ref.source (source_id) VALUES ('x')")
        a.rollback()
        a.execute("SELECT count(*) FROM ref.fn_config_asof('source', now())").fetchone()
        a.rollback()
    with test_database.connect("mm_reader") as rd:
        for stmt in ("SELECT 1 FROM curated.observation", "SELECT 1 FROM ingest.run",
                     "SELECT 1 FROM ops.run_summary", "SELECT 1 FROM ref.config_history",
                     "SELECT params FROM ref.indicator"):  # fmt: skip
            with pytest.raises(errors.InsufficientPrivilege):
                rd.execute(stmt)  # type: ignore[call-overload]
            rd.rollback()
        rd.execute("SELECT indicator_id, name FROM ref.indicator").fetchall()
    with test_database.connect("mm_ingest") as ing:
        with pytest.raises(errors.InsufficientPrivilege):
            ing.execute("TRUNCATE staging.rejected")
        ing.rollback()
        with pytest.raises(errors.InsufficientPrivilege):
            ing.execute("CREATE TABLE ops.x (a int)")
        ing.rollback()
        run = ing.execute(
            "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status) "
            "VALUES ('w','local','refresh','g','c', now(), 'running') RETURNING run_id"
        ).fetchone()
        assert run is not None
        ing.execute("INSERT INTO ops.export_status (run_id, status) VALUES (%s, 'ok')", [run[0]])
        ing.rollback()


# --- T-DDL-33 privilege sides (T15): insert as mm_ingest, read as mm_reader ---------------


def _curated_helpers() -> tuple[type, object]:
    here = str(Path(__file__).parent)
    if here not in sys.path:
        sys.path.insert(0, here)
    import test_ddl_curated as tc

    return tc.Fx, tc.build


def test_ddl33_fixture_inserted_as_ingest_read_as_reader(test_database: TestDatabase) -> None:
    fx_cls, build = _curated_helpers()
    with _migrated(test_database):
        pass
    with test_database.connect("mm_ingest", timeout=120) as ing:
        build(fx_cls(ing))  # type: ignore[operator]
        ing.commit()
        # no role can update or delete observations (append-only, and no privilege either)
        with pytest.raises(errors.InsufficientPrivilege):
            ing.execute("UPDATE curated.observation SET value = 0")
        ing.rollback()
    with test_database.connect("mm_reader") as rd:
        rows = rd.execute(
            "SELECT value_status, is_base_version FROM curated.v_revision_history"
        ).fetchall()
        assert rows, "v_revision_history returned nothing to mm_reader"
        assert all(r[0] != "PROJ" for r in rows)  # I-CUR-11
        assert any(r[1] for r in rows)
        with pytest.raises(errors.InsufficientPrivilege):
            rd.execute("SELECT 1 FROM ref.series")
        rd.rollback()
        with pytest.raises(errors.InsufficientPrivilege):
            rd.execute("SELECT 1 FROM curated.observation")


# --- Python enums versus SQL CHECK lists, ops side (T15 carry-over) ------------------------

_OPS_ENUMS = {
    enums.DriftKind: ("ops", "drift_event", "kind"),
    enums.DriftStatus: ("ops", "drift_event", "status"),
    enums.DriftDecision: ("ops", "drift_decision", "decision"),
}


def test_ops_enums_match_sql_check_lists(test_database: TestDatabase) -> None:
    with _migrated(test_database) as conn:
        for enum_cls, (schema, table, column) in _OPS_ENUMS.items():
            defs = conn.execute(
                "SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k "
                "JOIN pg_class t ON t.oid = k.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace "
                "WHERE k.contype = 'c' AND n.nspname = %s AND t.relname = %s",
                [schema, table],
            ).fetchall()
            found: list[set[str]] = []
            for (d,) in defs:
                m = re.match(rf"CHECK \(\({column} = ANY \(\(?ARRAY\[(.*?)\]", d)
                if m:
                    found.append(set(re.findall(r"'([^']*)'::text", m.group(1))))
            assert len(found) == 1, f"{schema}.{table}.{column}: {found}"
            assert {m.value for m in enum_cls} == found[0], enum_cls.__name__
