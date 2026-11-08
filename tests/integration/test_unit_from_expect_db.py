# ruff: noqa: E501, F401, F811
"""ADR-029: the series-map ``expect.unit`` supplies an empty source unit for an opted-in group.

AC-UNIT-2..7 and AC-UNIT-10 against a throwaway database (real loader seams, fake series-map
provider; the entry flag ``unit_from_expect`` stands for the group key read by the real provider).
AC-UNIT-9 (rebuild determinism) is covered without a database in tests/unit/test_unit_from_expect.py.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).parent))  # --import-mode=importlib: no sibling imports
from test_decide_db import TODAY, Restager, accept, first_event
from test_loader_insert import DAY, EXPECT, T0, Env, M, entry, env, n
from test_loader_queue import conn, one

from macro_monitor.storage import loader

pytestmark = pytest.mark.db

USD = {**EXPECT, "unit": "USD"}
NO_UNIT = {k: v for k, v in EXPECT.items() if k != "unit"}


def ent(key: str, *, expect: dict[str, Any] = USD, opt_in: bool = True) -> Any:
    return entry(key, expect=expect, unit_from_expect=opt_in)


def events(c: psycopg.Connection) -> list[tuple[Any, ...]]:
    rows = c.execute(
        "SELECT kind, series_ref, old->>'value', new->>'value' FROM ops.drift_event ORDER BY event_id"
    ).fetchall()
    c.rollback()
    return [tuple(r) for r in rows]


def test_ac_unit_2_published_unit_wins_over_expect(env: Env) -> None:
    c = env.c
    env.entries = [ent("x"), ent("y")]
    # x: published EUR, expect USD -> mismatch (the API value is never overridden); y: equal
    env.stage(
        T0,
        {"x": [(M[0], "1")], "y": [(M[0], "1")]},
        meta={"x": {"unit_code": "EUR"}, "y": {"unit_code": "USD"}},
    )
    env.drain()
    assert n(c, "ref.series", "series_key = 'x'") == 0
    assert one(c, "SELECT unit_code FROM ref.series WHERE series_key = 'y'") == "USD"
    assert events(c) == [("unit", "d|x", "USD", "EUR")]
    assert n(c, "ingest.v_series_deferred") == 1


def test_ac_unit_3_empty_unit_filled_from_expect(env: Env) -> None:
    c = env.c
    env.entries = [ent("x"), ent("y"), ent("z")]
    env.stage(
        T0,
        {"x": [(M[0], "1")], "y": [(M[0], "2")], "z": [(M[0], "3")]},
        meta={"x": {"unit_code": ""}, "y": {"unit_code": "  "}, "z": {"unit_code": "USD"}},
    )
    env.drain()
    rows = c.execute("SELECT series_key, unit_code FROM ref.series ORDER BY 1").fetchall()
    c.rollback()
    assert rows == [("x", "USD"), ("y", "USD"), ("z", "USD")]
    assert n(c, "ops.drift_event") == 0
    assert n(c, "curated.observation") == 3
    assert one(c, "SELECT (detail->>'unit_from_expect')::int FROM ingest.raw_load") == 2
    # staging keeps what the parser emitted
    assert n(c, "ref.series", "btrim(unit_code) = ''") == 0


def test_ac_unit_4_empty_without_expect_unit_is_rejected(env: Env) -> None:
    c = env.c
    env.entries = [ent("x", expect=NO_UNIT, opt_in=False), ent("y")]
    env.stage(
        T0,
        {"x": [(M[0], "1")], "y": [(M[0], "1")]},
        meta={"x": {"unit_code": ""}, "y": {"unit_code": ""}},
    )
    env.drain()
    assert n(c, "ref.series", "series_key = 'x'") == 0
    assert n(c, "ref.series", "btrim(unit_code) = ''") == 0
    assert ("unit", "d|x", "non-empty unit", "") in events(c)
    assert n(c, "ingest.v_series_deferred", "series_ref = 'd|x'") == 1
    assert one(c, "SELECT unit_code FROM ref.series WHERE series_key = 'y'") == "USD"


def test_ac_unit_4_opt_in_group_still_needs_expect_unit(env: Env) -> None:
    c = env.c
    env.entries = [ent("x", expect=NO_UNIT, opt_in=True)]
    env.stage(T0, {"x": [(M[0], "1")]}, meta={"x": {"unit_code": ""}})
    env.drain()
    assert n(c, "ref.series") == 0
    assert events(c) == [("unit", "d|x", "non-empty unit", "")]


def test_ac_unit_5_no_opt_in_keeps_drift_event(env: Env) -> None:
    c = env.c
    env.entries = [ent("x", opt_in=False)]
    env.stage(T0, {"x": [(M[0], "1")]}, meta={"x": {"unit_code": ""}})
    env.drain()
    assert n(c, "ref.series") == 0
    assert events(c) == [("unit", "d|x", "USD", "")]
    assert n(c, "ingest.v_series_deferred") == 1


def test_ac_unit_6_known_series_effective_unit_vs_stored(env: Env) -> None:
    c = env.c
    env.entries = [ent("x")]
    env.stage(T0, {"x": [(M[0], "1")]}, meta={"x": {"unit_code": "USD"}})
    env.drain()
    # staged '' + expect USD: effective USD equals stored, loads without an event
    env.stage(T0 + DAY, {"x": [(M[0], "2")]}, meta={"x": {"unit_code": ""}})
    env.drain()
    assert n(c, "ops.drift_event") == 0
    assert [o[1] for o in env.obs("x")] == [1, 2]
    # expect changed to EUR: effective EUR differs from stored USD -> unit event, deferred
    env.entries = [ent("x", expect={**EXPECT, "unit": "EUR"})]
    env.stage(T0 + 2 * DAY, {"x": [(M[0], "3")]}, meta={"x": {"unit_code": ""}})
    env.drain()
    assert events(c) == [("unit", "d|x", "USD", "EUR")]
    assert [o[1] for o in env.obs("x")] == [1, 2]
    assert n(c, "ingest.v_series_deferred") == 1


def test_ac_unit_7_effective_unit_not_in_ref_unit(env: Env) -> None:
    c = env.c
    env.entries = [ent("x", expect={**EXPECT, "unit": "ZZZ"})]
    env.stage(T0, {"x": [(M[0], "1")]}, meta={"x": {"unit_code": ""}})
    env.drain()
    assert n(c, "ref.series") == 0
    assert events(c) == [("unit", "d|x", "in ref.unit", "ZZZ")]


def test_ac_unit_10_release_uses_effective_unit_and_original_known_at(env: Env) -> None:
    c = env.c
    rs = Restager(env)
    env.entries = [ent("x", expect=NO_UNIT, opt_in=False)]
    raw = rs.stage(T0, {"x": [(M[0], "1"), (M[1], "2")]}, {"x": {"unit_code": ""}})
    env.drain()
    assert n(c, "ref.series") == 0
    ev = first_event(c, "d|x")
    # the reviewed config commit (expect.unit + group flag) comes first, then the decision
    env.entries = [ent("x")]
    accept(c, ev)
    rep = env.drain(maps=env.provider, restage=rs)
    assert rep.release.loaded == [(raw, "d|x")]
    assert one(c, "SELECT unit_code FROM ref.series WHERE series_key = 'x'") == "USD"
    assert one(c, "SELECT version FROM ref.series WHERE series_key = 'x'") == 1
    obs = env.obs("x")
    assert [o[1] for o in obs] == [1, 2]
    assert all(o[5] == T0 for o in obs)
    assert n(c, "ingest.v_series_deferred") == 0
