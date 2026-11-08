"""T37 unit tests: scenario data is deterministic and encodes the spec's worked examples.

Expected numbers are literals from docs/specs/analytics-and-r-contract-spec.md (sections 4.3, 4.4,
AC-AN-2, AC-AN-4). The helpers below are independent implementations of the spec formulas written
in the test, not taken from the builder.
"""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "analytics"))
import builder as b


def midrank(values: list[str], good_dir: int) -> list[Fraction]:
    xs = [Decimal(v) for v in values]
    out = []
    for x in xs:
        worse = sum(1 for y in xs if (y < x if good_dir == 1 else y > x))
        ties = sum(1 for y in xs if y == x)
        out.append((Fraction(worse) + Fraction(ties, 2)) / len(xs))
    return out


def coverage_position(n: int, pct: int) -> int:
    return (pct * n + 99) // 100


def latest_period_ends(sc: b.Scenario) -> list[date]:
    return sorted(
        (b.period_end(max(o.start for o in s.obs), s.frequency) for s in sc.series), reverse=True
    )


def test_spec_percentiles_from_scenario_values() -> None:
    sc = b.percentile_ties()
    vals = [s.obs[0].value for s in sc.series]
    assert vals == ["3.0", "4.0", "4.0", "9.0"]
    got = midrank([v for v in vals if v is not None], good_dir=-1)
    assert got == [Fraction(7, 8), Fraction(1, 2), Fraction(1, 2), Fraction(1, 8)]
    assert [float(g) for g in got] == [0.875, 0.5, 0.5, 0.125]


def test_spec_rank_reference_position_n10_pct70() -> None:
    sc = b.rank_period_10()
    assert len(sc.series) == 10
    p = coverage_position(10, 70)
    assert p == 7
    ends = latest_period_ends(sc)
    assert ends[p - 1] == date(2026, 7, 31)  # spec: rank_reference_period = Jul-2026
    assert ends.count(date(2026, 8, 31)) == 6
    assert ends.count(date(2026, 6, 30)) == 2
    assert ends.count(date(2026, 3, 31)) == 1


def test_spec_rank_reference_position_n20_pct55() -> None:
    sc = b.rank_period_20()
    assert len(sc.series) == 20
    p = coverage_position(20, 55)
    assert p == 11
    assert latest_period_ends(sc)[p - 1] == date(2026, 7, 31)


def test_scenarios_are_deterministic() -> None:
    for make in (b.percentile_ties, b.rank_period_10, b.rank_period_20, b.kitchen_sink):
        assert make().fingerprint() == make().fingerprint()
        assert hash(make().fingerprint()) == hash(make().fingerprint())


def test_period_end_arithmetic() -> None:
    assert b.period_end(date(2024, 2, 1), "M") == date(2024, 2, 29)
    assert b.period_end(date(2026, 10, 1), "Q") == date(2026, 12, 31)
    assert b.period_end(date(2025, 1, 1), "A") == date(2025, 12, 31)
    assert b.period_end(date(2024, 7, 1), "A", "FISCAL") == date(2025, 6, 30)
    assert b.months(date(2025, 11, 1), 3) == [
        date(2025, 11, 1),
        date(2025, 12, 1),
        date(2026, 1, 1),
    ]


def test_kitchen_sink_covers_every_feature() -> None:
    sc = b.kitchen_sink()
    obs = [o for s in sc.series for o in s.obs]
    assert {"OBS", "PROJ", "MISS"} <= {o.status for o in obs}
    assert {"initial", "revision", "import"} <= {o.kind for o in obs}
    assert any(s.publish_site == "withheld" for s in sc.sources)
    assert any(g.edition_ordered for g in sc.groups)
    assert any(s.calendar_basis == "FISCAL" for s in sc.series)
    assert len({o.label for o in obs if o.label}) == 2  # two WEO editions
    # MISS rows carry no value, every other row does (obs_value_presence CHECK)
    assert all((o.value is None) == (o.status == "MISS") for o in obs)
    # series keys are unique
    keys = [s.key for s in sc.series]
    assert len(keys) == len(set(keys))
