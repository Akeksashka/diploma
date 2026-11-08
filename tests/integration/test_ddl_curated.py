# ruff: noqa: E501
"""T-DDL-1/2/19/22/33 and I-CUR-1/4a/6/8/10/11 against migration 0005_curated.

Gaps (reported, not worked around):
- Roles and grants are T16 and the roles do not exist yet, so every statement here runs as the
  owner/superuser. "As mm_ingest" (insert) and "as mm_reader" (select) are therefore checked on
  the objects only; the trigger tests prove the append-only rule binds even the owner.
- I-CUR-2, 3, 5, 7 and 9 describe loader behaviour (T-series for the loader); they are not
  testable on the schema alone and are not covered here.
- Migration 0004 (ops) is written concurrently, so the fixture applies 0000-0003, a no-op 0004
  placeholder and 0005 from a temporary directory.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
import pytest
from psycopg import errors

from macro_monitor.models import enums
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

BASE = datetime(2026, 1, 1, tzinfo=UTC)

REVISION_COLUMNS = [
    "series_id", "entity_id", "indicator_id", "ref_period_start", "ref_period_end", "known_at",
    "source_release_at", "vintage_label", "value", "value_status", "load_kind", "revision_class",
    "edition_ordered", "is_base_version",
]  # fmt: skip


@pytest.fixture
def conn(test_database: TestDatabase, tmp_path: Path) -> Iterator[psycopg.Connection]:
    real = {m.version: m for m in migrate.discover()}
    for v in (0, 1, 2, 3, 5):
        (tmp_path / real[v].path.name).write_text(real[v].sql, encoding="utf-8")
    (tmp_path / "0004_placeholder.sql").write_text("SELECT 1;", encoding="utf-8")
    with test_database.connect() as c:
        migrate.migrate(c, tmp_path)
        c.commit()
        yield c


class Fx:
    """Builds reference data, series, mappings and observations through raw objects."""

    def __init__(self, c: psycopg.Connection) -> None:
        self.c = c
        self.n = 0
        self.series: dict[str, int] = {}
        c.execute(
            "INSERT INTO ref.source VALUES ('P','p','rest','public','public','l','a','x',true), "
            "('W','p','rest','public','withheld','l','a','x',true), "
            "('H','p','rest','hash_only','public','l','a','x',true)"
        )
        for src in ("P", "W", "H"):
            c.execute(
                "INSERT INTO ref.series_group (source_id, group_id, edition_ordered, config_sha256) "
                "VALUES (%s,'ED',true,'x'), (%s,'REG',false,'x')",
                [src, src],
            )
        c.execute("INSERT INTO ref.entity VALUES ('E1','One','country',true,false)")
        c.execute("INSERT INTO ref.unit VALUES ('PC','ratio','percent')")
        for ind, kind in (("I1", "indicator"), ("I2", "indicator"), ("I3", "indicator"),
                          ("I4", "indicator"), ("I5", "indicator"), ("I6", "indicator"),
                          ("IX", "input")):  # fmt: skip
            self._indicator(ind, kind)
        row = c.execute(
            "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status) "
            "VALUES ('w','local','refresh','g','c', now(), 'running') RETURNING run_id"
        ).fetchone()
        assert row is not None
        self.run_id = int(row[0])

    def _indicator(self, ind: str, kind: str) -> None:
        inp = kind == "input"
        self.c.execute(
            "INSERT INTO ref.indicator (indicator_id, name, kind, tier, priority, currency_basis, "
            "staleness_class, transform_id, alert_method, adverse_dir, good_dir, rank_mode, "
            "stationarity_class, release_lag_aware) VALUES (%s,%s,%s,'A','core','NA','A730','level',"
            "%s,0,%s,%s,'stationary',false)",
            [ind, ind, kind, "none" if inp else "z", 0 if inp else 1,
             "descriptive_only" if inp else "monotone_good"],
        )  # fmt: skip

    def mk(self, key: str, *, src: str = "P", grp: str = "ED", ind: str | None = None,
           role: str = "headline", freq: str = "A", basis: str = "CAL") -> int:  # fmt: skip
        row = self.c.execute(
            "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, "
            "frequency, unit_code, price_basis, seasonal_adjustment, calendar_basis, first_seen_at) "
            "VALUES (%s,%s,'d',%s,'E1','t',%s,'PC','NA','NA',%s, now()) RETURNING series_id",
            [src, grp, key, freq, basis],
        ).fetchone()
        assert row is not None
        sid = int(row[0])
        self.series[key] = sid
        if ind:
            self.c.execute(
                "INSERT INTO ref.series_map (indicator_id, entity_id, series_id, role, rationale) "
                "VALUES (%s,'E1',%s,%s,'r')",
                [ind, sid, role],
            )
        return sid

    def raw(self, ts: int, src: str = "P", grp: str = "ED", *, imp: bool = False) -> int:
        self.n += 1
        sha = f"sha{self.n}"
        self.c.execute("INSERT INTO ingest.raw_blob VALUES (%s,1,'local_dir',%s,now())", [sha, sha])
        row = self.c.execute(
            "INSERT INTO ingest.raw_object (run_id, source_id, group_id, request_key, request_url, "
            "request_params, http_status, fetched_at, sha256, fetch_mode, fetch_scope, manual, "
            "import_label, parser_id) VALUES (%s,%s,%s,%s,'https://x/y','{}',200,%s,%s,'full','complete',"
            "%s,%s,'p@1') RETURNING raw_id",
            [self.run_id, src, grp, f"k{self.n}", BASE + timedelta(days=ts), sha, imp, "archive_import" if imp else None],
        ).fetchone()  # fmt: skip
        assert row is not None
        return int(row[0])

    def obs(self, key: str, year: int, status: str, value: float | None, ts: int, *,
            kind: str = "revision", label: str | None = None, src: str = "P", grp: str = "ED",
            start: date | None = None, end: date | None = None) -> None:  # fmt: skip
        self.c.execute(
            "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, "
            "value_status, load_kind, known_at, loaded_at, vintage_label, raw_id, run_id) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,now(),%s,%s,%s)",
            [self.series[key], start or date(year, 1, 1), end or date(year, 12, 31), value, status,
             kind, BASE + timedelta(days=ts), label, self.raw(ts, src, grp, imp=kind == "import"), self.run_id],
        )  # fmt: skip


E1, E2, E3, E4 = 10, 20, 30, 40  # edition fetch days
LABELS = {E1: "WEO-2026-04", E2: "WEO-2026-10", E3: "WEO-2027-04", E4: "WEO-2027-10"}


def build(fx: Fx, *, proj: bool = True, extra_edition: bool = False) -> None:
    """T-DDL-33 fixture S1-S4 plus the T-DDL-22 controls. proj=False omits every PROJ row."""

    def p(key: str, year: int, vals: dict[int, float], first: str = "new_period") -> None:
        if not proj:
            return
        for i, (ts, v) in enumerate(vals.items()):
            fx.obs(key, year, "PROJ", v, ts, kind=first if i == 0 else "revision", label=LABELS[ts])

    eds = {E1: 1.0, E2: 2.0, E3: 3.0}
    fx.mk("S1", ind="I1")
    p("S1", 2027, eds, "initial")
    fx.mk("S2", ind="I2")
    fx.obs("S2", 2025, "OBS", 10.0, 5, kind="initial")
    fx.obs("S2", 2025, "OBS", 11.0, 25, kind="revision")
    p("S2", 2026, {k: v + 100 for k, v in eds.items()})
    p("S2", 2027, {k: v + 200 for k, v in eds.items()})
    fx.mk("S3", ind="I3")
    p("S3", 2026, {E1: 5.0}, "initial")
    fx.obs("S3", 2026, "EST", 6.0, E2, kind="revision", label=LABELS[E2])
    fx.obs("S3", 2026, "EST", 7.0, E3, kind="revision", label=LABELS[E3])
    fx.mk("S4", ind="I4")
    p("S4", 2026, {E1: 5.0}, "initial")
    fx.obs("S4", 2026, "EST", 6.0, E2, kind="revision", label=LABELS[E2])
    if extra_edition and proj:  # one more projection edition for S1, S2, S3
        fx.obs("S1", 2027, "PROJ", 4.0, E4, label=LABELS[E4])
        fx.obs("S2", 2026, "PROJ", 104.0, E4, label=LABELS[E4])
        fx.obs("S3", 2027, "PROJ", 9.0, E4, kind="new_period", label=LABELS[E4])
    # controls: regular group, input, comparison, withheld copy of S2, import row
    fx.mk("R1", grp="REG", ind="I5")
    fx.obs("R1", 2025, "OBS", 1.0, 5, kind="initial", grp="REG")
    fx.obs("R1", 2025, "OBS", 2.0, 15, grp="REG")
    fx.obs("R1", 2024, "OBS", 9.0, 6, kind="initial", grp="REG")
    fx.obs("R1", 2024, "OBS", 8.0, 7, kind="import", grp="REG")  # import never counts
    fx.mk("X01", grp="REG", ind="IX")
    fx.obs("X01", 2025, "OBS", 1.0, 5, kind="initial", grp="REG")
    fx.obs("X01", 2025, "OBS", 2.0, 15, grp="REG")
    fx.mk("C1", grp="REG", ind="I5", role="comparison")
    fx.obs("C1", 2025, "OBS", 1.0, 5, kind="initial", grp="REG")
    fx.obs("C1", 2025, "OBS", 2.0, 15, grp="REG")
    fx.mk("W2", src="W", ind="I6")
    fx.obs("W2", 2025, "OBS", 10.0, 5, kind="initial", src="W")
    fx.obs("W2", 2025, "OBS", 11.0, 25, src="W")


def _hist(c: psycopg.Connection) -> list[tuple[Any, ...]]:
    return c.execute(
        "SELECT s.series_key, h.ref_period_start, h.known_at, h.value, h.value_status, "
        "h.is_base_version, h.edition_ordered FROM curated.v_revision_history h "
        "JOIN ref.series s USING (series_id) ORDER BY 1, 2, 3"
    ).fetchall()


@pytest.fixture
def full(conn: psycopg.Connection) -> psycopg.Connection:
    build(Fx(conn))
    conn.commit()
    return conn


# --- T-DDL-2, I-CUR-1 --------------------------------------------------------------------


@pytest.mark.parametrize(
    "stmt",
    ["UPDATE curated.observation SET value = 1", "DELETE FROM curated.observation",
     "TRUNCATE curated.observation"],
)  # fmt: skip
def test_append_only_binds_even_the_owner(full: psycopg.Connection, stmt: str) -> None:
    with pytest.raises(errors.RestrictViolation):
        full.execute(stmt)
    full.rollback()
    assert full.execute("SELECT count(*) FROM curated.observation").fetchone() != (0,)


# --- constraints: T-DDL-19, backstop, I-CUR-4a, I-CUR-6 ---------------------------------


def test_miss_and_value_presence(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    fx.mk("M1", ind="I1")
    fx.obs("M1", 2020, "OBS", 1.0, 1, kind="initial")
    fx.obs("M1", 2020, "MISS", None, 2)
    fx.obs("M1", 2020, "OBS", 1.0, 3)  # same value again: three rows
    for status, value in (("MISS", 1.0), ("OBS", None), ("DEL", 1.0), ("PROJ", None)):
        with pytest.raises(errors.CheckViolation, match="obs_value_presence"), conn.transaction():
            fx.obs("M1", 2021, status, value, 4)
    assert conn.execute("SELECT count(*) FROM curated.observation").fetchone() == (3,)
    row = conn.execute("SELECT value_status, value FROM curated.v_observation_latest").fetchall()
    assert row == [("OBS", 1)]
    fx.obs("M1", 2020, "MISS", None, 4)
    assert conn.execute(
        "SELECT value_status, value FROM curated.v_observation_latest"
    ).fetchall() == [("MISS", None)]
    fx.obs("M1", 2020, "DEL", None, 5, kind="tombstone")
    assert conn.execute("SELECT count(*) FROM curated.v_observation_latest").fetchone() == (0,)
    conn.rollback()


def test_known_not_future_one_hour_backstop(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    fx.mk("F1", ind="I1")
    soon = int((datetime.now(UTC) - BASE).total_seconds() // 86400) + 1
    with pytest.raises(errors.CheckViolation, match="obs_known_not_future"):
        fx.obs("F1", 2020, "OBS", 1.0, soon + 1)
    conn.rollback()


def test_period_order_known_at_and_ordering(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    fx.mk("A1", ind="I1")
    fx.mk("Q1", ind="I2", freq="Q")
    fx.mk("D1", ind="I3", freq="D")
    fx.mk("M1", ind="I4", freq="M")
    fx.mk("F1", ind="I5", freq="A", basis="FISCAL")
    fx.obs("Q1", 0, "OBS", 1.0, 1, kind="initial", start=date(2020, 4, 1), end=date(2020, 6, 30))
    fx.obs("D1", 0, "OBS", 1.0, 1, kind="initial", start=date(2020, 4, 1), end=date(2020, 4, 1))
    fx.obs("M1", 0, "OBS", 1.0, 1, kind="initial", start=date(2020, 2, 1), end=date(2020, 2, 29))
    fx.obs("F1", 0, "OBS", 1.0, 1, kind="initial", start=date(2020, 7, 1), end=date(2021, 6, 30))
    conn.commit()
    bad = [("Q1", date(2020, 4, 1), date(2020, 6, 29)), ("Q1", date(2020, 5, 1), date(2020, 7, 31)),
           ("D1", date(2020, 4, 1), date(2020, 4, 2)), ("M1", date(2020, 2, 1), date(2020, 2, 28)),
           ("A1", date(2020, 1, 1), date(2020, 12, 30)), ("F1", date(2020, 7, 1), date(2020, 8, 1))]  # fmt: skip
    for key, s, e in bad:
        with pytest.raises(errors.CheckViolation, match=r"I-CUR-"):
            fx.obs(key, 0, "OBS", 1.0, 2, start=s, end=e)
        conn.rollback()
    with pytest.raises(errors.CheckViolation, match=r"obs_period_order|I-CUR-6"):
        fx.obs("A1", 0, "OBS", 1.0, 2, start=date(2020, 1, 2), end=date(2020, 1, 1))
    conn.rollback()
    # known_at must equal fetched_at of the raw object, and must increase per key
    raw = fx.raw(5)
    with pytest.raises(errors.CheckViolation, match="I-CUR-4a"):
        conn.execute(
            "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, "
            "value_status, load_kind, known_at, loaded_at, raw_id, run_id) VALUES "
            "(%s,'2020-01-01','2020-12-31',1,'OBS','initial',%s,now(),%s,%s)",
            [fx.series["A1"], BASE + timedelta(days=6), raw, fx.run_id],
        )
    conn.rollback()


def test_known_at_strictly_increasing_per_key(conn: psycopg.Connection) -> None:
    fx = Fx(conn)
    fx.mk("A1", ind="I1")
    fx.obs("A1", 2020, "OBS", 1.0, 10, kind="initial")
    with pytest.raises(errors.CheckViolation, match="increase"):
        fx.obs("A1", 2020, "OBS", 2.0, 5)
    conn.rollback()


# --- views: I-CUR-8, I-CUR-10, T-DDL-22 --------------------------------------------------


def test_latest_asof_headline_and_import(full: psycopg.Connection) -> None:
    c = full
    latest = dict(c.execute(
        "SELECT s.series_key || o.ref_period_start::text, o.value FROM curated.v_observation_latest o "
        "JOIN ref.series s USING (series_id)").fetchall())  # fmt: skip
    assert latest["R12024-01-01"] == 9  # import row (8.0, later known_at) never latest
    assert latest["S22025-01-01"] == 11
    q = "SELECT count(*) FROM curated.fn_observation_asof(%s, %s) WHERE series_id = %s AND ref_period_start = '2025-01-01'"
    sid = c.execute("SELECT series_id FROM ref.series WHERE series_key = 'S2'").fetchone()
    assert sid is not None
    ts = BASE + timedelta(days=12)
    assert c.execute(
        "SELECT value FROM curated.fn_observation_asof(%s) WHERE series_id = %s AND ref_period_start = '2025-01-01'",
        [ts, sid[0]]).fetchone() == (10,)  # fmt: skip
    assert c.execute(q, [BASE + timedelta(days=2), None, sid[0]]).fetchone() == (0,)
    assert c.execute(  # load_cutoff restricts on loaded_at (all rows were loaded after BASE)
        "SELECT count(*) FROM curated.fn_observation_asof(%s, %s)",
        [BASE + timedelta(days=100), BASE],
    ).fetchone() == (0,)
    for view in ("v_headline_obs", "v_headline_obs_observed", "v_headline_obs_published"):
        assert c.execute(f"SELECT count(*) FROM curated.{view} h JOIN curated.observation o USING (obs_id) WHERE o.load_kind = 'import'").fetchone() == (0,)  # fmt: skip
    assert c.execute(
        "SELECT count(*) FROM curated.v_headline_obs_observed WHERE is_projection"
    ).fetchone() == (0,)  # I-CUR-8
    assert c.execute(
        "SELECT count(*) FROM curated.v_headline_obs WHERE is_projection"
    ).fetchone() != (0,)
    # public dump: archive_mode public AND publish_site public; import rows included (restorable)
    pub = c.execute(
        "SELECT DISTINCT s.series_key, o.load_kind = 'import' FROM curated.v_observation_public o "
        "JOIN ref.series s USING (series_id)"
    ).fetchall()
    assert ("R1", True) in pub
    assert not [r for r in pub if r[0] == "W2"]  # withheld source


def test_views_filters_and_published_sets(full: psycopg.Connection) -> None:
    c = full

    def keys(view: str) -> set[str]:
        rows = c.execute(
            f"SELECT DISTINCT s.series_key FROM curated.{view} v JOIN ref.series s USING (series_id)"
        ).fetchall()
        return {r[0] for r in rows}

    assert "C1" not in keys("v_headline_obs")
    assert keys("v_comparison_obs") == {"C1"}
    assert "X01" in keys("v_headline_obs")
    assert "X01" not in keys("v_headline_obs_published")
    assert keys("v_input_obs_published") == {"X01"}
    assert "W2" in keys("v_headline_obs")
    assert "W2" not in keys("v_headline_obs_published")
    assert "W2" not in keys("v_input_obs_published")


# --- T-DDL-22 / T-DDL-33 -----------------------------------------------------------------


def test_revision_history_columns_and_exclusions(full: psycopg.Connection) -> None:
    c = full
    cols = [r[0] for r in c.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='curated' "
        "AND table_name='v_revision_history' ORDER BY ordinal_position").fetchall()]  # fmt: skip
    assert cols == REVISION_COLUMNS
    keys = {r[0] for r in _hist(c)}
    assert keys == {"S2", "S3", "R1"}  # no X01, no C1, no W2 (withheld), no S1, no S4
    assert {r[0]: r[6] for r in _hist(c)} == {"S2": True, "S3": True, "R1": False}


def test_t_ddl_33_assertions(full: psycopg.Connection) -> None:
    c = full
    rows = _hist(c)
    assert all(r[4] != "PROJ" for r in rows)  # (a)
    by: dict[tuple[str, date], list[tuple[Any, ...]]] = {}
    for r in rows:
        by.setdefault((r[0], r[1]), []).append(r)
    assert not [k for k in by if k[0] in ("S1", "S4")]  # (b), (e)
    assert [(r[3], r[5]) for r in by[("S2", date(2025, 1, 1))]] == [(10, True), (11, False)]  # (c)
    assert not [k for k in by if k[0] == "S2" and k[1].year in (2026, 2027)]
    k_rows = by[("S3", date(2026, 1, 1))]  # (d)
    assert [(r[3], r[4], r[5]) for r in k_rows] == [(6, "EST", True), (7, "EST", False)]
    stored = c.execute(
        "SELECT load_kind FROM curated.observation o JOIN ref.series s USING (series_id) "
        "WHERE s.series_key='S3' AND vintage_label='WEO-2026-10'").fetchone()  # fmt: skip
    assert stored == ("revision",)  # base version stored as 'revision' yet is the base
    for key_rows in by.values():  # (f)
        assert [r[5] for r in key_rows].count(True) == 1
        assert key_rows[0][5] is True


def test_t_ddl_33_perturbation(conn: psycopg.Connection) -> None:
    """(g) the view with and without any PROJ row is identical; an extra edition changes nothing."""
    build(Fx(conn))
    with_proj = _hist(conn)
    conn.rollback()
    build(Fx(conn), proj=False)
    without_proj = _hist(conn)
    conn.rollback()
    build(Fx(conn), extra_edition=True)
    more = _hist(conn)
    conn.rollback()
    assert with_proj == without_proj == more
    assert len(with_proj) == 6


_WRONG = """CREATE OR REPLACE VIEW curated.v_revision_history AS
WITH v AS (
  SELECT o.series_id, m.entity_id, m.indicator_id, o.ref_period_start, o.ref_period_end,
         o.known_at, o.source_release_at, o.vintage_label, o.value, o.value_status,
         o.load_kind, o.revision_class, g.edition_ordered
  FROM curated.observation o
  JOIN ref.series s ON s.series_id = o.series_id
  JOIN ref.source src ON src.source_id = s.source_id AND src.publish_site = 'public'
  JOIN ref.series_group g ON g.source_id = s.source_id AND g.group_id = s.group_id
  JOIN ref.series_map m ON m.series_id = o.series_id AND m.role = 'headline'
   AND o.ref_period_start >= m.valid_from AND (m.valid_to IS NULL OR o.ref_period_start <= m.valid_to)
  JOIN ref.indicator i ON i.indicator_id = m.indicator_id AND i.kind = 'indicator'
  WHERE o.load_kind <> 'import'
), c AS (
  SELECT v.*, count(*) OVER w AS n_versions, row_number() OVER (w ORDER BY v.known_at) AS rn
  FROM v WINDOW w AS (PARTITION BY v.series_id, v.indicator_id, v.entity_id, v.ref_period_start)
)
SELECT series_id, entity_id, indicator_id, ref_period_start, ref_period_end, known_at,
       source_release_at, vintage_label, value, value_status, load_kind, revision_class,
       edition_ordered, (rn = 1) AS is_base_version FROM c WHERE n_versions >= 2"""


def test_t_ddl_33_negative_control(conn: psycopg.Connection) -> None:
    """A view that omits the PROJ filter must fail (a), (b) and (g)."""
    build(Fx(conn))
    good = _hist(conn)
    conn.execute(_WRONG)
    bad = _hist(conn)
    conn.rollback()
    assert any(r[4] == "PROJ" for r in bad)  # (a) fails
    assert "S1" in {r[0] for r in bad}  # (b) fails
    assert bad != good  # (g) fails


def test_t_ddl_33_independent_query(full: psycopg.Connection) -> None:
    """(k) a differently written query over the base table, with the section 5 definition."""
    c = full
    independent = c.execute(
        """
        SELECT count(*) FROM curated.observation o
        WHERE o.load_kind <> 'import' AND o.value_status <> 'PROJ'
          AND EXISTS (SELECT 1 FROM ref.series s JOIN ref.source r USING (source_id)
                      WHERE s.series_id = o.series_id AND r.publish_site = 'public')
          AND EXISTS (SELECT 1 FROM ref.series_map m JOIN ref.indicator i USING (indicator_id)
                      WHERE m.series_id = o.series_id AND m.role = 'headline' AND i.kind = 'indicator'
                        AND m.valid_from <= o.ref_period_start
                        AND coalesce(m.valid_to, 'infinity') >= o.ref_period_start)
          AND (SELECT count(*) FROM curated.observation p
               WHERE p.series_id = o.series_id AND p.ref_period_start = o.ref_period_start
                 AND p.load_kind <> 'import' AND p.value_status <> 'PROJ') >= 2
        """
    ).fetchone()
    assert independent == (len(_hist(c)),) == (6,)
    # (j) the base version is the least known_at, computed independently
    least = c.execute(
        """
        SELECT count(*) FROM curated.v_revision_history h
        WHERE h.is_base_version AND h.known_at = (
          SELECT min(p.known_at) FROM curated.observation p
          WHERE p.series_id = h.series_id AND p.ref_period_start = h.ref_period_start
            AND p.load_kind <> 'import' AND p.value_status <> 'PROJ')
        """
    ).fetchone()
    assert least == (3,)


# --- Python enums versus SQL CHECK lists (closes the T05 risk) ---------------------------

_ENUM_COLUMNS: dict[type[StrEnum], tuple[str, str, str]] = {
    enums.ValueStatus: ("curated", "observation", "value_status"),
    enums.LoadKind: ("curated", "observation", "load_kind"),
    enums.QualityFlag: ("curated", "observation", "quality_flag"),
    enums.RevisionClass: ("curated", "observation", "revision_class"),
    enums.FetchMode: ("ingest", "raw_object", "fetch_mode"),
    enums.FetchScope: ("ingest", "raw_object", "fetch_scope"),
    enums.LoadOutcome: ("ingest", "raw_load", "outcome"),
    enums.FetchOutcome: ("ingest", "fetch_attempt", "outcome"),
    enums.SeriesLoadStatus: ("ingest", "raw_series_status", "status"),
    enums.Frequency: ("ref", "series", "frequency"),
    enums.PriceBasis: ("ref", "series", "price_basis"),
    enums.SeasonalAdjustment: ("ref", "series", "seasonal_adjustment"),
    enums.CalendarBasis: ("ref", "series", "calendar_basis"),
    enums.FlowBasis: ("ref", "series", "flow_basis"),
    enums.Composition: ("ref", "series", "composition"),
    enums.CompareMode: ("ref", "series_group", "compare_mode"),
    enums.SnapshotMode: ("ref", "series_group", "snapshot_mode"),
    enums.SourceKind: ("ref", "source", "kind"),
}


def _check_literals(c: psycopg.Connection, schema: str, table: str, column: str) -> set[str]:
    defs = c.execute(
        "SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid "
        "JOIN pg_namespace n ON n.oid = t.relnamespace WHERE k.contype = 'c' AND n.nspname = %s AND t.relname = %s",
        [schema, table],
    ).fetchall()
    found: list[set[str]] = []
    for (d,) in defs:
        m = re.match(rf"CHECK \(\({column} = ANY \(\(?ARRAY\[(.*?)\]", d)
        if m:
            found.append(set(re.findall(r"'([^']*)'::text", m.group(1))))
    assert len(found) == 1, f"expected one CHECK list on {schema}.{table}.{column}, got {found}"
    return found[0]


def test_python_enums_match_sql_check_lists(conn: psycopg.Connection) -> None:
    for enum_cls, (schema, table, column) in _ENUM_COLUMNS.items():
        assert {m.value for m in enum_cls} == _check_literals(conn, schema, table, column), (
            enum_cls.__name__
        )


def test_every_enum_mapped_or_deferred() -> None:
    """Enums not in the map belong to tables that do not exist yet (ops.*, T14)."""
    all_enums = {
        o for o in vars(enums).values()
        if isinstance(o, type) and issubclass(o, StrEnum) and o is not StrEnum
    }  # fmt: skip
    deferred = {e.__name__ for e in all_enums - set(_ENUM_COLUMNS)}
    assert deferred <= {"DriftKind", "DriftStatus", "DriftDecision"}, deferred
