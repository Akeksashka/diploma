"""T46: deterministic Parquet snapshot and the REV-06 pure check."""

from __future__ import annotations

from datetime import date
from decimal import Decimal as D

from macro_monitor.storage.snapshot import read_snapshot, snapshot_bytes
from macro_monitor.validation.revision_checks import Tally, check_rev_06

ROWS = [
    ("d|b", date(2020, 2, 1), D("1.50"), "OBS"),
    ("d|a", date(2020, 1, 1), D("10.0"), "OBS"),
    ("d|a", date(2020, 2, 1), None, "MISS"),
]


def test_snapshot_is_deterministic_and_order_independent() -> None:
    a, n = snapshot_bytes(ROWS)
    b, _ = snapshot_bytes(list(reversed(ROWS)))
    assert a == b
    assert n == 3
    assert a[:4] == b"PAR1"


def test_snapshot_round_trip_keeps_decimal_text() -> None:
    data, _ = snapshot_bytes(ROWS)
    back = read_snapshot(data)
    assert back == sorted(ROWS, key=lambda r: (r[0], r[1], r[3]))


def test_rev_06_cap() -> None:
    t = Tally(existing_keys=100, material=90)
    assert check_rev_06(t, 100).passed
    assert check_rev_06(t, 90).passed  # at the cap
    r = check_rev_06(t, 89)
    assert r.blocks
    assert r.check_id == "REV-06"
    assert check_rev_06(t, 89, accepted_event=4).passed
    assert check_rev_06(t, None).passed
