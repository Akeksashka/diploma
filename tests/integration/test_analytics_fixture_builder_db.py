# ruff: noqa: E501
"""T37 db tests: the builder seeds a migrated database that the production views read back.

Seeding uses a SUPERUSER connection (see tests/fixtures/analytics/builder.py); reads in the last
test use the real mm_analytics role. Expected numbers are literals from the analytics spec
(AC-AN-2, AC-AN-4, AC-AN-22), computed in the test, not by the builder.
"""

from __future__ import annotations

import sys
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "analytics"))
import builder as b

from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db


@pytest.fixture
def seeded(test_database: TestDatabase) -> Iterator[Callable[[b.Scenario], psycopg.Connection]]:
    conns: list[psycopg.Connection] = []

    def make(sc: b.Scenario) -> psycopg.Connection:
        c = test_database.connect()
        conns.append(c)
        migrate.migrate(c)
        b.seed(c, sc)
        return c

    yield make
    for c in conns:
        c.close()


def rows(c: psycopg.Connection, q: str, *a: object) -> list[tuple[object, ...]]:
    r = c.execute(q, list(a)).fetchall()  # type: ignore[arg-type]
    c.rollback()
    return [tuple(x) for x in r]


def test_percentile_ties_from_db(seeded: Callable[[b.Scenario], psycopg.Connection]) -> None:
    c = seeded(b.percentile_ties())
    got = rows(c, "SELECT entity_id, value FROM curated.v_headline_obs_observed ORDER BY entity_id")
    xs = {str(e): Decimal(str(v)) for e, v in got}
    assert xs == {
        "A": Decimal("3.0"),
        "B": Decimal("4.0"),
        "C": Decimal("4.0"),
        "D": Decimal("9.0"),
    }
    pct = {
        e: (
            Fraction(sum(y > x for y in xs.values()))
            + Fraction(sum(y == x for y in xs.values()), 2)
        )
        / len(xs)
        for e, x in xs.items()
    }  # good_dir = -1: higher is worse
    assert [float(pct[e]) for e in "ABCD"] == [0.875, 0.5, 0.5, 0.125]


@pytest.mark.parametrize(
    ("make", "n", "pct", "position", "ref_end"),
    [
        (b.rank_period_10, 10, 70, 7, date(2026, 7, 31)),
        (b.rank_period_20, 20, 55, 11, date(2026, 7, 31)),
    ],
)
def test_rank_reference_period_from_db(
    seeded: Callable[[b.Scenario], psycopg.Connection],
    make: Callable[[], b.Scenario],
    n: int,
    pct: int,
    position: int,
    ref_end: date,
) -> None:
    c = seeded(make())
    ends = [
        r[0]
        for r in rows(
            c,
            "SELECT max(ref_period_end) FROM curated.v_headline_obs_observed "
            "GROUP BY entity_id ORDER BY 1 DESC",
        )
    ]
    assert len(ends) == n
    assert (pct * n + 99) // 100 == position
    assert ends[position - 1] == ref_end


def test_kitchen_sink_edge_cases(seeded: Callable[[b.Scenario], psycopg.Connection]) -> None:
    c = seeded(b.kitchen_sink())
    # MISS after a valid value: observed view returns the MISS row with NULL value (AC-AN-22)
    assert rows(
        c,
        "SELECT ref_period_start, value, value_status FROM curated.v_headline_obs_observed "
        "WHERE entity_id='MISS' ORDER BY 1",
    ) == [(date(2026, 7, 1), Decimal("7.0"), "OBS"), (date(2026, 8, 1), None, "MISS")]
    # PROJ never in the observed view, but stored
    assert rows(
        c, "SELECT value_status FROM curated.v_headline_obs_observed WHERE entity_id='PROJ'"
    ) == [("OBS",)]
    assert rows(c, "SELECT count(*) FROM curated.observation WHERE value_status='PROJ'")[0][0] == 3
    # import rows are invisible to the latest view; the normal rows carry the value
    assert rows(
        c,
        "SELECT ref_period_start, value FROM curated.v_headline_obs WHERE entity_id='IMP' ORDER BY 1",
    ) == [(date(2026, 1, 1), Decimal("8.5")), (date(2026, 2, 1), Decimal("8.6"))]
    assert rows(c, "SELECT count(*) FROM curated.observation WHERE load_kind='import'")[0][0] == 1
    # revision: latest vintage wins, as-of before the revision sees the old value
    assert rows(
        c,
        "SELECT value FROM curated.v_headline_obs WHERE entity_id='REV' AND "
        "ref_period_start='2026-07-01'",
    ) == [(Decimal("1.2"),)]
    early = datetime(2026, 10, 7, tzinfo=UTC)
    assert rows(
        c,
        "SELECT o.value FROM curated.fn_observation_asof(%s) o JOIN ref.series s USING (series_id) "
        "WHERE s.entity_id='REV' AND o.ref_period_start='2026-07-01'",
        early,
    ) == [(Decimal("1.0"),)]
    assert (
        rows(c, "SELECT count(*) FROM curated.v_revision_history WHERE entity_id='REV'")[0][0] == 2
    )
    # withheld source: visible internally, absent from the published views
    assert rows(c, "SELECT count(*) FROM curated.v_headline_obs WHERE entity_id='WH'")[0][0] == 1
    assert (
        rows(c, "SELECT count(*) FROM curated.v_headline_obs_published WHERE entity_id='WH'")[0][0]
        == 0
    )
    assert (
        rows(c, "SELECT count(*) FROM curated.v_headline_obs_published WHERE entity_id='A'")[0][0]
        > 0
    )
    # fiscal-year entity: July-June periods
    assert rows(
        c,
        "SELECT ref_period_start, ref_period_end FROM curated.v_headline_obs WHERE entity_id='FY' "
        "ORDER BY 1",
    ) == [(date(2024, 7, 1), date(2025, 6, 30)), (date(2025, 7, 1), date(2026, 6, 30))]
    # WEO editions: two vintages per period, edition-ordered group, history view lists both
    assert rows(
        c,
        "SELECT vintage_label, value FROM curated.v_revision_history WHERE entity_id='WEOX' "
        "AND ref_period_start='2025-01-01' ORDER BY known_at",
    ) == [("WEO-2026-04", Decimal("2.0")), ("WEO-2026-10", Decimal("2.1"))]
    # stale / lagging: latest periods far behind the others
    last = {
        str(e): d
        for e, d in rows(
            c,
            "SELECT entity_id, max(ref_period_end) FROM curated.v_headline_obs GROUP BY 1",
        )
    }
    assert last["STALE"] == date(2025, 1, 31)
    assert last["LAG"] == date(2026, 5, 31)
    assert last["A"] == date(2026, 8, 31)


def test_seeded_scenario_is_readable_by_mm_analytics(
    test_database: TestDatabase, seeded: Callable[[b.Scenario], psycopg.Connection]
) -> None:
    seeded(b.percentile_ties())
    with test_database.connect("mm_analytics") as a:
        n = a.execute("SELECT count(*) FROM curated.v_headline_obs_observed").fetchone()
        assert n is not None
        assert n[0] == 4
