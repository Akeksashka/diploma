"""AC-DASH-6: the golden values for the JavaScript rebase (site/src/lib/rebase.js) come from this
Python reference; the JS unit test (site/tests/explorer.test.mjs) reads the checked-in JSON and
compares within 1e-9. The reference rule is the export spec section 6 "pure scaling":
value / value at the base period * 100, with a missing, zero or negative base giving no values.
It uses ``Decimal`` arithmetic, so it is an independent check of the double arithmetic in JS.

Regenerate after a deliberate rule change: ``python -m tests.unit.test_rebase_golden``.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from tests.fixtures.site_spike.make_export import level

from macro_monitor.publish.export import parquet_bytes
from macro_monitor.publish.series import build_table

pytestmark = pytest.mark.unit

GOLDEN = Path(__file__).resolve().parents[1] / "fixtures" / "site_spike" / "rebase_golden.json"
TOLERANCE = 1e-9


def reference_rebase(values: Sequence[float | None], base_index: int | None) -> list[float | None]:
    """Display-only rebase to 100 at ``base_index``; no value when the base is absent or not > 0."""
    base = values[base_index] if base_index is not None and 0 <= base_index < len(values) else None
    if base is None or Decimal(repr(base)) <= 0:
        return [None] * len(values)
    b = Decimal(repr(base))
    return [None if v is None else float(Decimal(repr(v)) / b * 100) for v in values]


def _case(name: str, values: list[float | None], base: int | None) -> dict[str, object]:
    return {
        "name": name,
        "values": values,
        "base_index": base,
        "expected": reference_rebase(values, base),
    }


def golden_document() -> dict[str, object]:
    cases = [
        _case("simple", [2.0, 4.0, 3.0, 1.0], 0),
        _case("base_in_the_middle", [50.0, 100.0, 125.0, 80.0], 1),
        _case("with_gaps", [3.1, None, 3.4, None, 2.9], 2),
        _case("zero_base", [0.0, 1.0, 2.0], 0),
        _case("negative_base", [-2.0, 1.0, 2.0], 0),
        _case("null_base", [None, 1.0, 2.0], 0),
        _case("base_outside_the_series", [1.0, 2.0], None),
        _case("thirds", [3.0, 1.0, 2.0, 0.1], 0),
        _case("large_values", [1.23456789e9, 2.5e9, 9.87654321e8], 0),
        _case("small_values", [1.5e-6, 3.1e-6, 4.7e-7], 0),
        _case("negative_values_positive_base", [4.0, -2.0, 0.0, 6.5], 0),
    ]
    for ei in range(3):  # the synthetic M09 fixture series (make_export.level)
        vals: list[float | None] = [level(ei, i) for i in range(36)]
        for base in (0, 12, 35):
            cases.append(_case(f"fixture_m09_entity{ei}_base{base}", vals, base))
    return {"tolerance": TOLERANCE, "cases": cases}


def test_golden_file_matches_the_python_reference() -> None:
    assert json.loads(GOLDEN.read_text(encoding="utf-8")) == golden_document()


def test_reference_rule() -> None:
    out = reference_rebase([2.0, 4.0, None, 1.0], 0)
    assert out == [100.0, 200.0, None, 50.0]
    assert reference_rebase([0.0, 1.0], 0) == [None, None]
    assert reference_rebase([-1.0, 1.0], 0) == [None, None]
    assert reference_rebase([1.0], None) == [None]
    assert reference_rebase([5.0, 6.0], 0)[0] == 100.0


def test_realistic_series_file_is_far_below_the_interaction_budget() -> None:
    """44 entities x 35 years of monthly data, written with the real producer code and writer."""
    known = datetime(2026, 11, 1, tzinfo=UTC)
    rows: list[tuple[object, ...]] = []
    from datetime import date

    for e in range(44):
        for y in range(1991, 2026):
            for m in range(1, 13):
                end = date(y + (m == 12), m % 12 + 1, 1)
                end = date.fromordinal(end.toordinal() - 1)
                v = Decimal(str(round(2 + 0.01 * ((y * 12 + m) % 97) + 0.1 * e, 3)))
                rows.append(
                    (
                        "M09",
                        f"E{e:02d}",
                        e,
                        end.replace(day=1),
                        end,
                        "M",
                        "SA",
                        v,
                        "OBS",
                        known,
                        known,
                        "new_period",
                    )
                )
    size = len(parquet_bytes(build_table(rows, "LEVEL"), group_by="entity_id"))  # type: ignore[arg-type]
    assert size < 5_000_000  # spec section 8: one explorer interaction


if __name__ == "__main__":
    GOLDEN.write_text(json.dumps(golden_document(), indent=1) + "\n", encoding="utf-8")
