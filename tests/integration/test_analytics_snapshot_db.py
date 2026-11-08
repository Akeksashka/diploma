# ruff: noqa: E501
"""T40 db tests: snapshot rows of a run, written by mm_analytics and read back (AC-AN-8, 12, 22,
24, AC-SYS-8, AC-AN-25 publish_scope clause). Expected numbers are hand-derived from the specs:
age = run_date - ref_period_end (validation spec 3), D14 limits, MISS rule (analytics spec 1)."""

from __future__ import annotations

import sys
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "analytics"))
import builder as b

from macro_monitor.analytics import runctx, snapshot, staleness
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

RUN_DATE = date(2026, 10, 15)
ADMIN_TIMEOUT = 60


class Env:
    def __init__(self, db: TestDatabase, sc: b.Scenario) -> None:
        self.db = db
        self.admin = db.connect(timeout=ADMIN_TIMEOUT)
        migrate.migrate(self.admin)
        b.seed(self.admin, sc)
        self.ingest_run = int(
            self.admin.execute("SELECT max(run_id) FROM ingest.run").fetchone()[0]
        )  # type: ignore[index]

    def run(
        self, as_of: date = RUN_DATE, cal: dict[str, staleness.ReleaseTiming] | None = None,
        est: frozenset[str] = frozenset({"A02"}),
    ) -> tuple[runctx.RunRecord, list[snapshot.SnapshotRow], psycopg.Connection[Any]]:  # fmt: skip
        ana = self.db.connect("mm_analytics", timeout=ADMIN_TIMEOUT)
        rec = runctx.start_run(
            ana, ingest_run_id=self.ingest_run, as_of_run_date=as_of, code_version="t",
            params={}, git_sha="g", config_asof=datetime.now(UTC), config_sha256="c",
            mapping_sha256="m", overrides_sha256="o",
        )  # fmt: skip
        res = snapshot.compute_snapshot(
            ana, rec, release_calendar=cal or {}, estimate_indicators=est
        )
        snapshot.write_snapshot(ana, rec.analysis_run_id, res.rows)
        ana.commit()
        return rec, res.rows, ana

    def close(self) -> None:
        self.admin.close()


@pytest.fixture
def env(test_database: TestDatabase) -> Iterator[Callable[[b.Scenario], Env]]:
    made: list[Env] = []

    def make(sc: b.Scenario) -> Env:
        e = Env(test_database, sc)
        made.append(e)
        return e

    yield make
    for e in made:
        e.close()


def stored(c: psycopg.Connection[Any], run_id: int) -> dict[tuple[str, str], dict[str, Any]]:
    cur = c.execute(
        "SELECT * FROM analytics.indicator_snapshot WHERE analysis_run_id = %s", [run_id]
    )
    cols = [d.name for d in cur.description or []]
    out = {(r[1], r[2]): dict(zip(cols, r, strict=True)) for r in cur.fetchall()}
    c.rollback()
    return out


def test_kitchen_sink_snapshot_rows(env: Callable[[b.Scenario], Env]) -> None:
    e = env(b.kitchen_sink())
    rec, rows, ana = e.run()
    s = stored(ana, rec.analysis_run_id)
    assert len(s) == 3 * 13 == len(rows)  # every indicator x every non-global entity

    def u(ent: str) -> dict[str, Any]:
        return s[("U1", ent)]

    # A: Aug 2026 -> ref_period_end 2026-08-31, age 45 days, ACT120 limit 120, not stale
    assert (u("A")["value"], u("A")["ref_period_end"], u("A")["age_days"]) == (
        Decimal("3.0"),
        date(2026, 8, 31),
        45,
    )
    assert (u("A")["stale_limit_days"], u("A")["is_stale"], u("A")["limit_source"]) == (
        120,
        False,
        "class",
    )
    assert (u("A")["publish"], u("A")["publish_scope"], u("A")["value_kind"]) == (
        True,
        "ranked",
        "observed",
    )
    assert u("A")["transformed_value"] == Decimal("3.0")
    assert u("A")["transform_id"] == "LEVEL"
    assert (u("A")["alignment"], u("A")["alignment_reason"], u("A")["ref_offset_days"]) == (
        "n/a",
        None,
        None,
    )
    # STALE: Jan 2025 -> 2025-01-31, 622 days > 120
    assert (u("STALE")["age_days"], u("STALE")["is_stale"]) == (622, True)
    # LAG: May 2026 latest -> 2026-05-31, 137 days > 120: stale
    assert (u("LAG")["age_days"], u("LAG")["is_stale"]) == (137, True)
    # AC-AN-22: MISS August; value and age come from July (2026-07-31 -> 76 days)
    assert (u("MISS")["value"], u("MISS")["ref_period_end"], u("MISS")["age_days"]) == (
        Decimal("7.0"),
        date(2026, 7, 31),
        76,
    )
    # PROJ August never used: July estimate 2.0 observed
    assert (u("PROJ")["value"], u("PROJ")["ref_period_end"]) == (Decimal("2.0"), date(2026, 7, 31))
    # import row never read: latest normal version of February is 8.6
    assert (u("IMP")["value"], u("IMP")["ref_period_end"]) == (Decimal("8.6"), date(2026, 2, 28))
    # revised value: latest version of July is 1.2
    assert u("REV")["value"] == Decimal("1.2")
    # fiscal-year annual, A730: 2025-07-01 .. 2026-06-30 -> 107 days
    assert (
        s[("F1", "FY")]["value"],
        s[("F1", "FY")]["age_days"],
        s[("F1", "FY")]["stale_limit_days"],
    ) == (Decimal("-2.9"), 107, 730)
    # entities without a series still get a row without a value
    assert (s[("F1", "A")]["series_id"], s[("F1", "A")]["value"], s[("F1", "A")]["is_stale"]) == (
        None,
        None,
        None,
    )
    assert s[("F1", "A")]["publish_scope"] == "ranked"
    # WEO fixture is not an estimate indicator here: latest observed (non-PROJ) is 2025 revision 2.1
    assert (s[("W1", "WEOX")]["value"], s[("W1", "WEOX")]["value_kind"]) == (
        Decimal("2.1"),
        "observed",
    )


def test_withheld_pair_is_excluded_and_masked_in_published_view(
    env: Callable[[b.Scenario], Env],
) -> None:
    e = env(b.kitchen_sink())
    rec, _, ana = e.run()
    s = stored(ana, rec.analysis_run_id)
    assert (s[("U1", "WH")]["publish"], s[("U1", "WH")]["publish_scope"]) == (False, "excluded")
    assert s[("U1", "WH")]["value"] == Decimal("4.4")  # full set keeps it
    assert {
        k[1] for k, v in s.items() if v["publish_scope"] == "excluded" and v["publish"] is False
    } == {"WH"}
    pub = ana.execute(
        "SELECT value, transformed_value, deviation, ref_offset_days, publish_scope, age_days, is_stale "
        "FROM analytics.v_indicator_snapshot_published WHERE analysis_run_id = %s AND indicator_id = 'U1' AND entity_id = 'WH'",
        [rec.analysis_run_id],
    ).fetchone()
    ana.rollback()
    assert pub is not None
    assert pub[:5] == (None, None, None, None, "excluded")
    pa = ana.execute(
        "SELECT value, publish_scope FROM analytics.v_indicator_snapshot_published WHERE analysis_run_id = %s AND indicator_id = 'U1' AND entity_id = 'A'",
        [rec.analysis_run_id],
    ).fetchone()
    ana.rollback()
    assert pa == (Decimal("3.0"), "ranked")


def test_44_entities_per_country_indicator_and_global_only_wld(
    env: Callable[[b.Scenario], Env],
) -> None:
    ents = (*tuple(f"E{i:02d}" for i in range(44)), "WLD")
    sc = b.Scenario(
        "t40_scope",
        sources=(b.Source("S"),),
        groups=(b.Group("S"),),
        entities=ents,
        indicators=(b.Indicator("U1"), b.Indicator("G1", good_dir=0, rank_mode="descriptive_only")),
        series=(
            b.Series("U1.E00", "E00", "U1", (b.Obs(date(2026, 8, 1), "1.0"),)),
            b.Series("G1.WLD", "WLD", "G1", (b.Obs(date(2026, 8, 1), "2.0"),)),
        ),
    )
    e = env(sc)
    e.admin.execute(
        "UPDATE ref.entity SET kind='aggregate', is_ranked=false, is_global=true WHERE entity_id='WLD'"
    )
    e.admin.execute("UPDATE ref.indicator SET scope='global' WHERE indicator_id='G1'")
    e.admin.execute("UPDATE ref.indicator_domain SET is_ranked=false WHERE indicator_id='G1'")
    e.admin.commit()
    rec, _, ana = e.run()
    s = stored(ana, rec.analysis_run_id)
    assert sum(1 for k in s if k[0] == "U1") == 44
    assert ("U1", "WLD") not in s
    assert [k for k in s if k[0] == "G1"] == [("G1", "WLD")]
    assert s[("G1", "WLD")]["publish_scope"] == "info_only"
    assert s[("G1", "WLD")]["value"] == Decimal("2.0")
    assert s[("U1", "E00")]["publish_scope"] == "ranked"


def test_descriptive_and_unranked_domain_are_info_only(env: Callable[[b.Scenario], Env]) -> None:
    sc = b.Scenario(
        "t40_info",
        sources=(b.Source("S"),),
        groups=(b.Group("S"),),
        entities=("A",),
        indicators=(
            b.Indicator("D1X", good_dir=0, rank_mode="descriptive_only"),
            b.Indicator("R1"),
            b.Indicator("R2"),
        ),
        series=tuple(
            b.Series(f"{i}.A", "A", i, (b.Obs(date(2026, 8, 1), "1.0"),))
            for i in ("D1X", "R1", "R2")
        ),
    )
    e = env(sc)
    e.admin.execute("UPDATE ref.indicator_domain SET is_ranked=false WHERE indicator_id='R2'")
    e.admin.commit()
    rec, _, ana = e.run()
    s = stored(ana, rec.analysis_run_id)
    assert {k[0]: v["publish_scope"] for k, v in s.items()} == {
        "D1X": "info_only",
        "R1": "ranked",
        "R2": "info_only",
    }


def test_release_lag_aware_limit_source_stored(env: Callable[[b.Scenario], Env]) -> None:
    sc = b.Scenario(
        "t40_lag",
        sources=(b.Source("S"),),
        groups=(b.Group("S", "G"),),
        entities=("A", "B"),
        indicators=(b.Indicator("U1"),),
        series=(
            # 180 days before 2026-10-15 is 2026-04-18; use month ends: Apr 30 -> age 168, Mar 31 -> 198
            b.Series("U1.A", "A", "U1", (b.Obs(date(2026, 4, 1), "1.0"),)),
            b.Series("U1.B", "B", "U1", (b.Obs(date(2026, 3, 1), "1.0"),)),
        ),
    )
    e = env(sc)
    e.admin.execute("UPDATE ref.indicator SET release_lag_aware=true WHERE indicator_id='U1'")
    e.admin.commit()
    cal = {"G": staleness.ReleaseTiming(typical_lag_days=150, tolerance_days=30)}  # limit 180
    rec, _, ana = e.run(cal=cal)
    s = stored(ana, rec.analysis_run_id)
    a, bb = s[("U1", "A")], s[("U1", "B")]
    assert (a["age_days"], a["stale_limit_days"], a["limit_source"], a["is_stale"]) == (
        168,
        180,
        "release_lag_aware",
        False,
    )
    assert (bb["age_days"], bb["is_stale"]) == (198, True)
    # without the option the class limit (120) applies and A (168 days) is stale
    e.admin.execute("UPDATE ref.indicator SET release_lag_aware=false WHERE indicator_id='U1'")
    e.admin.commit()
    rec2, _, ana2 = e.run(cal=cal)
    a2 = stored(ana2, rec2.analysis_run_id)[("U1", "A")]
    assert (a2["stale_limit_days"], a2["limit_source"], a2["is_stale"]) == (120, "class", True)


def test_estimate_indicator_and_inheritance(env: Callable[[b.Scenario], Env]) -> None:
    sc = b.Scenario(
        "t40_est",
        sources=(b.Source("S"),),
        groups=(b.Group("S"),),
        entities=("A", "EA", "M1"),
        indicators=(b.Indicator("A02", good_dir=0, rank_mode="target_distance", tier="A", staleness_class="A730"), b.Indicator("P1")),
        series=(
            b.Series("A02.A", "A", "A02", (
                b.Obs(date(2024, 1, 1), "0.5", status="EST"),
                b.Obs(date(2025, 1, 1), "0.7", status="EST"),
                b.Obs(date(2026, 1, 1), "0.9", status="PROJ"),
            ), frequency="A"),
            b.Series("P1.EA", "EA", "P1", (b.Obs(date(2026, 8, 1), "3.5"),)),
        ),
    )  # fmt: skip
    e = env(sc)
    e.admin.execute("INSERT INTO ref.inheritance_rule VALUES ('P1','M1','EA','1999-01-01',NULL)")
    e.admin.commit()
    rec, _, ana = e.run()
    s = stored(ana, rec.analysis_run_id)
    a02 = s[("A02", "A")]
    assert (a02["value"], a02["value_kind"], a02["ref_period_end"]) == (
        Decimal("0.7"),
        "estimate",
        date(2025, 12, 31),
    )
    m1 = s[("P1", "M1")]
    assert (m1["inherited"], m1["value"]) == (True, Decimal("3.5"))
    assert s[("P1", "EA")]["inherited"] is False


def test_quality_override_exclude_removes_observation(env: Callable[[b.Scenario], Env]) -> None:
    sc = b.Scenario(
        "t40_ovr",
        sources=(b.Source("S"),),
        groups=(b.Group("S"),),
        entities=("A",),
        indicators=(b.Indicator("U1"),),
        series=(
            b.Series(
                "U1.A", "A", "U1", (b.Obs(date(2026, 7, 1), "1.0"), b.Obs(date(2026, 8, 1), "2.0"))
            ),
        ),
    )
    e = env(sc)
    sid = e.admin.execute("SELECT series_id FROM ref.series").fetchone()[0]  # type: ignore[index]
    e.admin.execute(
        "INSERT INTO ops.quality_override (series_id, ref_period_start, decision, reason, decided_by, decided_on) "
        "VALUES (%s,'2026-08-01','exclude','r','t','2026-10-02')", [sid],
    )  # fmt: skip
    e.admin.commit()
    rec, _, ana = e.run()
    r = stored(ana, rec.analysis_run_id)[("U1", "A")]
    assert (r["value"], r["ref_period_end"]) == (Decimal("1.0"), date(2026, 7, 31))
