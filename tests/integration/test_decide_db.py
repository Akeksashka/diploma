# ruff: noqa: E501, F401, F811, PT018, C408
"""T49: drift decisions, deferral release from stored raw, skip_object, quality override.

AC-ING-12, AC-VAL-2 (open events), ADR-018 clause 4 (new version with supersedes_series_id),
decisions insert-only. Real loader and decide seams; the series map is a fake provider and the
re-staging hook re-inserts the staging rows that the first load deleted (no network, no refetch).
"""

from __future__ import annotations

import calendar
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg import errors

sys.path.insert(0, str(Path(__file__).parent))  # --import-mode=importlib: no sibling imports
from test_loader_insert import DAY, META, T0, Env, M, entry, env, n
from test_loader_queue import conn, one

from macro_monitor.storage import decide, loader
from macro_monitor.storage.loader import LoadStatus

pytestmark = pytest.mark.db

TODAY = date(2026, 11, 3)
NSA = {"seasonal_adjustment": "NSA"}


class Restager:
    """Re-inserts staging rows for an object from the recorded fixture spec (stands in for the parser)."""

    def __init__(self, env: Env) -> None:
        self.env = env
        self.spec: dict[
            int, tuple[dict[str, list[tuple[date, str]]], dict[str, dict[str, Any]]]
        ] = {}
        self.calls = 0

    def stage(self, at: datetime, series: Any, meta: Any) -> int:
        raw_id = self.env.stage(at, series, meta=meta)
        self.spec[raw_id] = (series, meta)
        return raw_id

    def __call__(self, c: psycopg.Connection, obj: loader.QueuedObject, run_id: int) -> None:
        self.calls += 1
        series, meta = self.spec[obj.raw_id]
        for key, rows in series.items():
            ref = f"d|{key}"
            v = {**META, **meta.get(key, {})}
            c.execute(
                f"INSERT INTO staging.series_meta_load (run_id, raw_id, series_ref, {', '.join(v)}) "
                f"VALUES (%s,%s,%s,{','.join(['%s'] * len(v))})",
                [run_id, obj.raw_id, ref, *v.values()],
            )
            for start, val in rows:
                end = date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])
                c.execute(
                    "INSERT INTO staging.observation_load (run_id, raw_id, series_ref, ref_period_start, "
                    "ref_period_end, value, value_status, row_hash) VALUES (%s,%s,%s,%s,%s,%s,'OBS','h')",
                    [run_id, obj.raw_id, ref, start, end, val],
                )


def accept(c: psycopg.Connection, event_id: int, decision: Any = "accepted") -> int:
    return decide.decide_drift(
        c,
        event_id=event_id,
        decision=decision,
        decided_by="alina",
        decided_on=TODAY,
        note="reviewed",
    )


def first_event(c: psycopg.Connection, ref: str) -> int:
    v = one(c, "SELECT min(event_id) FROM ops.drift_event WHERE series_ref = %s", ref)
    return int(v)


def drain(env: Env, rs: Restager | None) -> loader.DrainReport:
    return env.drain(maps=env.provider, restage=rs)


def test_first_sight_deferral_accepted_loads_from_stored_raw(env: Env) -> None:
    c = env.c
    rs = Restager(env)
    env.entries = [entry("x"), entry("y")]
    raw = rs.stage(T0, {"x": [(M[0], "1"), (M[1], "2")], "y": [(M[0], "5")]}, {"x": NSA})
    env.drain()
    assert n(c, "ref.series", "series_key = 'x'") == 0  # deferred: expect says SA, published NSA
    ev = first_event(c, "d|x")
    # open event: nothing happens, reported as pending
    rep = drain(env, rs)
    assert rep.release.pending == [(raw, "d|x", "event_open")] and rs.calls == 0
    # the reviewed config commit (expect updated) comes first, then the decision
    env.entries = [
        entry("x", expect={**entry("x").expect, "seasonal_adjustment": "NSA"}),
        entry("y"),
    ]
    accept(c, ev)
    rep = drain(env, rs)
    assert rep.release.loaded == [(raw, "d|x")] and rs.calls == 1
    assert one(c, "SELECT version FROM ref.series WHERE series_key = 'x'") == 1
    assert one(c, "SELECT supersedes_series_id FROM ref.series WHERE series_key = 'x'") is None
    obs = env.obs("x")
    assert [o[1] for o in obs] == [1, 2] and all(o[5] == T0 for o in obs)  # original known_at
    assert n(c, "ingest.v_series_deferred") == 0
    assert n(c, "staging.observation_load") == 0  # re-staged rows removed again
    # idempotent: a second drain changes nothing and does not restage
    drain(env, rs)
    assert rs.calls == 1 and len(env.obs("x")) == 2


def test_accepted_drift_on_existing_series_creates_superseding_version(env: Env) -> None:
    c = env.c
    rs = Restager(env)
    rs.stage(T0, {"x": [(M[0], "1")]}, {})
    env.drain()
    old = int(one(c, "SELECT series_id FROM ref.series WHERE series_key = 'x'"))
    raw2 = rs.stage(T0 + DAY, {"x": [(M[0], "7"), (M[1], "8")]}, {"x": NSA})
    env.drain()
    assert [o[1] for o in env.obs("x")] == [1]
    ev = first_event(c, "d|x")
    env.entries = [entry("x", expect={**entry("x").expect, "seasonal_adjustment": "NSA"})]
    accept(c, ev)
    rep = drain(env, rs)
    assert rep.release.loaded == [(raw2, "d|x")]
    rows = c.execute(
        "SELECT series_id, version, supersedes_series_id, seasonal_adjustment FROM ref.series ORDER BY version"
    ).fetchall()
    c.rollback()
    assert rows[0][0] == old and rows[0][1:] == (1, None, "SA")  # the old version is untouched
    assert rows[1][1:] == (2, old, "NSA")
    new_obs = c.execute(
        "SELECT ref_period_start, value, known_at, raw_id FROM curated.observation WHERE series_id = %s ORDER BY 1",
        [rows[1][0]],
    ).fetchall()
    c.rollback()
    assert [(r[0], float(r[1]), r[2], r[3]) for r in new_obs] == [
        (M[0], 7.0, T0 + DAY, raw2),
        (M[1], 8.0, T0 + DAY, raw2),
    ]
    assert n(c, "curated.observation", f"series_id = {old}") == 1  # history never rewritten


def test_config_not_updated_keeps_deferral(env: Env) -> None:
    c = env.c
    rs = Restager(env)
    env.entries = [entry("x")]
    raw = rs.stage(T0, {"x": [(M[0], "1")]}, {"x": NSA})
    env.drain()
    accept(c, first_event(c, "d|x"))  # accepted without the reviewed config commit
    rep = drain(env, rs)
    assert rep.release.pending == [(raw, "d|x", "config_not_updated")]
    assert n(c, "ref.series") == 0 and n(c, "ingest.v_series_deferred") == 1


def test_rejected_appends_rejected_and_loads_nothing(env: Env) -> None:
    c = env.c
    rs = Restager(env)
    env.entries = [entry("x"), entry("y")]
    raw = rs.stage(T0, {"x": [(M[0], "1")], "y": [(M[0], "5")]}, {"x": NSA})
    env.drain()
    accept(c, first_event(c, "d|x"), "rejected")
    rep = drain(env, rs)
    assert rep.release.rejected == [(raw, "d|x")] and rs.calls == 0
    assert (
        one(
            c,
            "SELECT status FROM ingest.raw_series_status WHERE series_ref = 'd|x' AND status <> 'deferred'",
        )
        == "rejected"
    )
    assert n(c, "ref.series", "series_key = 'x'") == 0 and n(c, "ingest.v_series_deferred") == 0
    assert n(c, "curated.observation") == 1  # only y


def test_no_restage_hook_reports_pending(env: Env) -> None:
    c = env.c
    rs = Restager(env)
    env.entries = [entry("x", expect={**entry("x").expect, "seasonal_adjustment": "NSA"})]
    raw = rs.stage(
        T0, {"x": [(M[0], "1")]}, {"x": {"seasonal_adjustment": "NSA", "unit_code": "NOPE"}}
    )
    env.drain()
    ev = first_event(c, "d|x")
    accept(c, ev)
    assert drain(env, None).release.pending == [(raw, "d|x", "restage_unavailable")]


def test_decisions_are_insert_only_history(env: Env) -> None:
    c = env.c
    rs = Restager(env)
    env.entries = [entry("x")]
    rs.stage(T0, {"x": [(M[0], "1")]}, {"x": NSA})
    env.drain()
    ev = first_event(c, "d|x")
    d1 = accept(c, ev, "rejected")
    d2 = accept(c, ev, "reopened")
    d3 = accept(c, ev, "accepted")
    assert d1 < d2 < d3
    assert one(c, "SELECT status FROM ops.drift_event WHERE event_id = %s", ev) == "accepted"
    assert (
        one(
            c,
            "SELECT count(*) FROM ops.drift_decision WHERE event_id = %s AND recorded_at IS NOT NULL AND decided_by = 'alina'",
            ev,
        )
        == 3
    )
    with pytest.raises(decide.DecideError):
        accept(c, ev, "accepted")  # no change
    with pytest.raises(decide.DecideError):
        accept(c, 999999)
    for sql in ("UPDATE ops.drift_decision SET note = 'x'", "DELETE FROM ops.drift_decision"):
        with pytest.raises(errors.RestrictViolation):
            c.execute(sql)
        c.rollback()


def test_skip_object_ends_a_blocked_object(env: Env) -> None:
    c = env.c
    raw = env.stage(T0, {"x": [(M[0], "1")]})
    decide.skip_object(
        c, raw_id=raw, run_id=env.fx.run_id, decided_by="alina", decided_on=TODAY, note="bad file"
    )
    row = c.execute(
        "SELECT outcome, detail->>'decided_by', detail->>'decision' FROM ingest.raw_load WHERE raw_id = %s",
        [raw],
    ).fetchone()
    c.rollback()
    assert row == ("skipped_by_decision", "alina", "skip_object")
    assert n(c, "curated.observation") == 0
    with pytest.raises(decide.DecideError):
        decide.skip_object(
            c, raw_id=raw, run_id=env.fx.run_id, decided_by="alina", decided_on=TODAY
        )
    assert env.drain().results == []  # nothing left in the queue


def test_quality_override_history_supersedes(env: Env) -> None:
    c = env.c
    env.stage(T0, {"x": [(M[0], "1")]})
    env.drain()
    sid = int(one(c, "SELECT series_id FROM ref.series WHERE series_key = 'x'"))
    kw: dict[str, Any] = dict(
        series_id=sid,
        ref_period_start=M[0],
        known_at=T0,
        reason="outlier",
        decided_by="alina",
        decided_on=TODAY,
    )
    o1 = decide.quality_override(c, decision="exclude", **kw)
    o2 = decide.quality_override(c, decision="include", **kw)
    rows = c.execute(
        "SELECT override_id, decision, supersedes_override_id FROM ops.quality_override ORDER BY 1"
    ).fetchall()
    c.rollback()
    assert rows == [(o1, "exclude", None), (o2, "include", o1)]
    with pytest.raises(decide.DecideError):
        decide.quality_override(c, decision="maybe", **kw)
    with pytest.raises(decide.DecideError):
        decide.quality_override(c, decision="exclude", **{**kw, "reason": " "})
    with pytest.raises(decide.DecideError):
        decide.quality_override(c, decision="exclude", **{**kw, "series_id": 987654})
    with pytest.raises(errors.RestrictViolation):
        c.execute("DELETE FROM ops.quality_override")
    c.rollback()


def test_released_deferral_respects_out_of_order_rule(env: Env) -> None:
    """ORD-01 also applies when a deferral is released: a late row is never inserted."""
    c = env.c
    rs = Restager(env)
    raw1 = rs.stage(T0, {"x": [(M[0], "1")]}, {"x": NSA})  # deferred: expect says SA
    env.drain()
    ev = first_event(c, "d|x")
    rs.stage(T0 + DAY, {"x": [(M[0], "2"), (M[1], "3")]}, {})  # a later object loads the series
    env.drain()
    assert [o[1] for o in env.obs("x")] == [2, 3]
    env.entries = [entry("x", expect={**entry("x").expect, "seasonal_adjustment": "NSA"})]
    accept(c, ev)
    rep = drain(env, rs)
    assert rep.release.loaded == [] and rep.release.pending == [
        (raw1, "d|x", "skipped_out_of_order")
    ]
    assert [o[1] for o in env.obs("x")] == [2, 3]  # nothing late inserted
    assert n(c, "ref.series", "series_key = 'x'") == 1  # no superseding version either
    assert n(c, "ingest.raw_series_status", "status = 'skipped_out_of_order'") == 1
    drain(env, rs)  # repeated drains stay idempotent and warn once
    assert n(c, "ops.validation_result", "check_id = 'ORD-01'") == 1
