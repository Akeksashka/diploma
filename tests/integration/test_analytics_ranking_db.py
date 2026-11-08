# ruff: noqa: E501, PT018
"""T41 db tests: ranking and alignment on seeded scenarios, written by mm_analytics and read back
(AC-AN-2 percentile parts, AC-AN-4, AC-AN-14 on stored rows, published set from published values only).
Expected numbers are the analytics spec 4.3 worked examples."""

from __future__ import annotations

import sys
from collections.abc import Callable, Iterator
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "analytics"))
import builder as b

from macro_monitor.analytics import runctx, scoring, snapshot

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

RUN_DATE = date(2026, 10, 15)
T = 60


class Env:
    def __init__(self, db: TestDatabase, sc: b.Scenario) -> None:
        from macro_monitor.storage import migrate

        self.db = db
        self.admin = db.connect(timeout=T)
        migrate.migrate(self.admin)
        b.seed(self.admin, sc)
        self.ingest_run = int(
            self.admin.execute("SELECT max(run_id) FROM ingest.run").fetchone()[0]
        )  # type: ignore[index]

    def run(self) -> tuple[runctx.RunRecord, scoring.RankingResult, psycopg.Connection[Any]]:
        ana = self.db.connect("mm_analytics", timeout=T)
        rec = runctx.start_run(
            ana, ingest_run_id=self.ingest_run, as_of_run_date=RUN_DATE, code_version="t",
            params={}, git_sha="g", config_asof=datetime.now(UTC), config_sha256="c",
            mapping_sha256="m", overrides_sha256="o",
        )  # fmt: skip
        snap = snapshot.compute_snapshot(ana, rec, release_calendar={})
        res = scoring.rank_run(ana, rec, snap.rows)
        snapshot.write_snapshot(ana, rec.analysis_run_id, res.rows)  # completed rows, insert-only
        scoring.write_ranking(ana, rec.analysis_run_id, res)
        ana.commit()
        return rec, res, ana

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


def q(c: psycopg.Connection[Any], sql: str, *a: Any) -> list[tuple[Any, ...]]:
    rows = c.execute(sql, list(a)).fetchall()
    c.rollback()
    return rows


def test_percentile_ties_spec_example(env: Callable[[b.Scenario], Env]) -> None:
    e = env(b.percentile_ties())
    rec, _res, ana = e.run()
    got = dict(
        q(
            ana,
            "SELECT entity_id, percentile FROM analytics.indicator_rank WHERE analysis_run_id=%s",
            rec.analysis_run_id,
        )
    )
    assert got == {
        "A": Decimal("0.875"),
        "B": Decimal("0.5"),
        "C": Decimal("0.5"),
        "D": Decimal("0.125"),
    }
    n = q(
        ana,
        "SELECT DISTINCT n_ranked FROM analytics.indicator_rank WHERE analysis_run_id=%s",
        rec.analysis_run_id,
    )
    assert n == [(4,)]
    pub = q(
        ana,
        "SELECT count(*) FROM analytics.indicator_rank_published WHERE analysis_run_id=%s AND publish_scope='ranked'",
        rec.analysis_run_id,
    )
    assert pub == [(4,)]


def test_rank_period_10_alignment_stored(env: Callable[[b.Scenario], Env]) -> None:
    sc = b.rank_period_10()
    # Mar-2026 is 198 days old on the run date; give the indicator a class where it is not stale (AC-AN-4 needs 10 candidates)
    sc = replace(sc, indicators=tuple(replace(i, staleness_class="A730") for i in sc.indicators))
    e = env(sc)
    rec, _res, ana = e.run()
    al = q(
        ana,
        "SELECT rank_reference_period, reference_period_spread_days, n_ranked, n_unaligned, max_ref_spread_days FROM analytics.indicator_alignment WHERE analysis_run_id=%s",
        rec.analysis_run_id,
    )
    assert al == [(date(2026, 7, 31), 62, 9, 1, 92)]
    snap = q(
        ana,
        "SELECT entity_id, alignment, ref_offset_days FROM analytics.indicator_snapshot WHERE analysis_run_id=%s AND indicator_id='U1' ORDER BY entity_id",
        rec.analysis_run_id,
    )
    assert [s[1] for s in snap] == ["ahead"] * 6 + ["aligned"] * 3 + ["lagging"]
    assert [s[2] for s in snap] == [31] * 6 + [0, -31, -31, -122]
    ranked = q(
        ana,
        "SELECT count(*), max(n_ranked) FROM analytics.indicator_rank WHERE analysis_run_id=%s",
        rec.analysis_run_id,
    )
    assert ranked == [(9, 9)]  # the lagging entity has no percentile
    assert q(
        ana,
        "SELECT count(*) FROM analytics.indicator_rank WHERE analysis_run_id=%s AND entity_id='E09'",
        rec.analysis_run_id,
    ) == [(0,)]


def test_stale_candidate_excluded_default_class(env: Callable[[b.Scenario], Env]) -> None:
    e = env(b.rank_period_10())  # ACT120: Mar-2026 entity is stale (198 days) and not a candidate
    rec, _res, ana = e.run()
    al = q(
        ana,
        "SELECT n_ranked, n_unaligned FROM analytics.indicator_alignment WHERE analysis_run_id=%s",
        rec.analysis_run_id,
    )
    assert al == [(9, 1)]


def test_fiscal_year_unaligned_stored(env: Callable[[b.Scenario], Env]) -> None:
    sc = b.latest_values(
        "fy",
        {"A": "1.0", "B": "2.0", "C": "3.0", "IN": "9.0"},
        dict.fromkeys(["A", "B", "C", "IN"], date(2025, 1, 1)),
    )
    series = tuple(
        replace(s, frequency="A", calendar_basis="FISCAL" if s.entity == "IN" else "CAL")
        for s in sc.series
    )
    sc = replace(
        sc,
        series=series,
        indicators=tuple(replace(i, staleness_class="A730") for i in sc.indicators),
    )
    e = env(sc)
    rec, _res, ana = e.run()
    row = q(
        ana,
        "SELECT alignment, alignment_reason FROM analytics.indicator_snapshot WHERE analysis_run_id=%s AND entity_id='IN'",
        rec.analysis_run_id,
    )
    assert row == [("unaligned", "fiscal_year_basis")]
    assert q(
        ana,
        "SELECT n_ranked, n_unaligned FROM analytics.indicator_alignment WHERE analysis_run_id=%s",
        rec.analysis_run_id,
    ) == [(3, 1)]
    assert q(
        ana,
        "SELECT count(*) FROM analytics.indicator_rank WHERE analysis_run_id=%s AND entity_id='IN'",
        rec.analysis_run_id,
    ) == [(0,)]
    assert {
        r[0]
        for r in q(
            ana,
            "SELECT alignment FROM analytics.indicator_snapshot WHERE analysis_run_id=%s AND entity_id IN ('A','B','C') AND indicator_id='U1'",
            rec.analysis_run_id,
        )
    } == {"aligned"}


def test_withheld_source_absent_from_published_ranks(env: Callable[[b.Scenario], Env]) -> None:
    sc = b.percentile_ties()
    sc = replace(
        sc,
        sources=(*sc.sources, b.Source("W", publish_site="withheld")),
        groups=(*sc.groups, b.Group("W")),
        series=tuple(replace(s, source="W") if s.entity == "D" else s for s in sc.series),
    )
    e = env(sc)
    rec, _res, ana = e.run()
    full = dict(
        q(
            ana,
            "SELECT entity_id, percentile FROM analytics.indicator_rank WHERE analysis_run_id=%s",
            rec.analysis_run_id,
        )
    )
    pub = dict(
        q(
            ana,
            "SELECT entity_id, percentile FROM analytics.indicator_rank_published WHERE analysis_run_id=%s",
            rec.analysis_run_id,
        )
    )
    assert len(full) == 4 and set(pub) == {"A", "B", "C"}
    # published set R = {3.0, 4.0, 4.0}, higher is worse: A W=2 -> (2+0.5)/3; B, C W=0 T=2 -> 1/3
    assert pub["A"] == Decimal(5) / Decimal(6) and pub["B"] == pub["C"] == Decimal(1) / Decimal(3)
    assert q(
        ana,
        "SELECT n_ranked FROM analytics.indicator_alignment_published WHERE analysis_run_id=%s",
        rec.analysis_run_id,
    ) == [(3,)]
