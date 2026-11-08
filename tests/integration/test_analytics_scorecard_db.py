# ruff: noqa: E501, PT018
"""T42 db tests: scorecards written by mm_analytics for the full and the published set (concept
de-duplication, n_available vs n_defined with a withheld source, identical peer-set values)."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "analytics"))
import builder as b

from macro_monitor.analytics import runctx, scorecard, scoring, snapshot

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

RUN_DATE = date(2026, 10, 15)
T = 60
AUG = date(2026, 8, 1)


def scenario() -> b.Scenario:
    vals = {
        "U1": {"A": "1", "B": "2", "C": "3", "D": "4"},
        "U2": {"A": "4", "B": "3", "C": "2", "D": "1"},
        "U3": {"A": "1", "B": "2", "C": "3"},
        "U4": {"A": "1", "B": "2", "C": "3", "D": "4"},
    }
    series = tuple(
        b.Series(f"{i}.{e}", e, i, (b.Obs(AUG, v, 5),), source="W" if i == "U4" else "S", group="G")
        for i, d in vals.items()
        for e, v in d.items()
    )
    return b.Scenario(
        name="scorecard",
        sources=(b.Source("S"), b.Source("W", publish_site="withheld")),
        groups=(b.Group("S", "G"), b.Group("W", "G")),
        entities=("A", "B", "C", "D"),
        indicators=tuple(b.Indicator(i) for i in vals),
        series=series,
    )


@pytest.fixture
def conns(
    test_database: TestDatabase,
) -> Iterator[tuple[psycopg.Connection[Any], psycopg.Connection[Any]]]:
    from macro_monitor.storage import migrate

    admin = test_database.connect(timeout=T)
    migrate.migrate(admin)
    b.seed(admin, scenario())
    admin.execute(
        "UPDATE ref.indicator SET concept_id='C1', concept_priority=2 WHERE indicator_id='U2'"
    )
    admin.execute(
        "UPDATE ref.indicator SET concept_id='C1', concept_priority=1 WHERE indicator_id='U3'"
    )
    admin.commit()
    ana = test_database.connect("mm_analytics", timeout=T)
    yield admin, ana
    ana.close()
    admin.close()


def test_scorecards_full_and_published(
    conns: tuple[psycopg.Connection[Any], psycopg.Connection[Any]],
) -> None:
    from datetime import UTC, datetime

    admin, ana = conns
    ing = int(admin.execute("SELECT max(run_id) FROM ingest.run").fetchone()[0])  # type: ignore[index]
    rec = runctx.start_run(
        ana, ingest_run_id=ing, as_of_run_date=RUN_DATE, code_version="t", params={}, git_sha="g",
        config_asof=datetime.now(UTC), config_sha256="c", mapping_sha256="m", overrides_sha256="o",
    )  # fmt: skip
    snap = snapshot.compute_snapshot(ana, rec, release_calendar={})
    res = scoring.rank_run(ana, rec, snap.rows)
    sres, elig, members = scorecard.scorecards(ana, res)
    assert set(elig) == {"D1"}
    rows = scorecard.demote_ineligible(res.rows, elig, members)
    snapshot.write_snapshot(ana, rec.analysis_run_id, rows)
    scoring.write_ranking(ana, rec.analysis_run_id, res)
    scorecard.write_scorecard(ana, rec.analysis_run_id, sres)
    ana.commit()
    cols = "entity_id, n_available, n_defined, percentile_rank, rank_position, n_ranked_entities, low_coverage, heterogeneous_peer_set, peer_set_size_min, peer_set_size_max"
    out: dict[str, dict[str, tuple[Any, ...]]] = {}
    for t in ("scorecard", "scorecard_published"):
        got = ana.execute(
            f"SELECT {cols} FROM analytics.{t} WHERE analysis_run_id=%s ORDER BY entity_id",
            [rec.analysis_run_id],
        ).fetchall()
        ana.rollback()
        out[t] = {r[0]: r for r in got}
        assert set(out[t]) == {"A", "B", "C", "D"}
        assert len({(r[7], r[8], r[9]) for r in got}) == 1  # identical per domain
        assert all(r[2] == 3 for r in got)  # U2/U3 count once; n_defined unchanged when withheld
    full, pub = out["scorecard"], out["scorecard_published"]
    assert full["A"][1] == 3 and pub["A"][1] == 2  # withheld U4 excluded from n_available
    assert full["D"][1] == 3  # D has no U3 but U2 stands in for the concept
    a_mean = (Decimal("0.875") + Decimal(5) / Decimal(6) + Decimal("0.875")) / 3
    assert abs(full["A"][3] - a_mean) < Decimal("1e-20")
    assert full["A"][4] == 1 and full["A"][5] == 4
    assert (full["A"][8], full["A"][9]) == (3, 4) and not full["A"][7]
    assert (pub["A"][8], pub["A"][9]) == (3, 4)
