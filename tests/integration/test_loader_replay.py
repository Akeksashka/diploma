# ruff: noqa: E501, F401, F811
"""T28 loader C: tombstones, COMP-03 guard, MISS, PROJ rule, revert, replay (I-CUR-3/5/7).

AC-ING-4 steps 4-5, AC-ING-13 (data side), AC-ING-17 (DB side), T-DDL-19, T-DDL-13 (PROJ).
"""

from __future__ import annotations

import random
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).parent))  # --import-mode=importlib: no sibling imports
from test_loader_insert import DAY, T0, Env, M, entry, env, n
from test_loader_queue import conn, one

from macro_monitor.storage import loader, replay
from macro_monitor.storage.loader import LoadStatus, QueuedObject

pytestmark = pytest.mark.db

REQ = "req-1"  # one request key: consecutive fetches of the same request
P = [date(2020 + i // 12, i % 12 + 1, 1) for i in range(40)]  # 40 monthly periods


def rows(vals: list[float | None], first: int = 0, **_: Any) -> list[Any]:
    return [
        (P[first + i], None if v is None else str(v), "MISS" if v is None else "OBS")
        for i, v in enumerate(vals)
    ]


def snapshot(c: psycopg.Connection) -> dict[int, dict[str, list[tuple[Any, ...]]]]:
    out: dict[int, dict[str, list[tuple[Any, ...]]]] = {}
    for table in ("series_meta_load", "observation_load"):
        cur = c.execute(f"SELECT * FROM staging.{table}")
        cols = [d.name for d in cur.description or []]
        for r in cur.fetchall():
            rec = dict(zip(cols, r, strict=True))
            out.setdefault(rec["raw_id"], {}).setdefault(table, []).append((cols, r))  # type: ignore[arg-type]
    c.rollback()
    return out


def restager(snap: dict[int, dict[str, list[Any]]]) -> Any:
    def restage(c: psycopg.Connection, obj: QueuedObject, run_id: int) -> None:
        for table, recs in snap.get(obj.raw_id, {}).items():
            for cols, r in recs:
                keep = [(k, v) for k, v in zip(cols, r, strict=True) if k not in ("staged_at",)]
                c.execute(
                    f"INSERT INTO staging.{table} ({','.join(k for k, _ in keep)}) VALUES ({','.join(['%s'] * len(keep))})",
                    [v for _, v in keep],
                )

    return restage


def check_replay(env: Env, snap: dict[int, dict[str, list[Any]]]) -> list[tuple[Any, ...]]:
    before = replay.natural_rows(env.c)
    assert replay.replay(env.c, env.insert, restager(snap)) > 0
    after = replay.natural_rows(env.c)
    assert after == before  # I-CUR-7
    return before


def kinds(env: Env, key: str) -> list[tuple[Any, ...]]:
    return [(o[0], o[1], o[2], o[3]) for o in env.obs(key)]


# ------------------------------------------------------------------------ tombstones


def test_tombstone_on_full_complete_only_and_replay(env: Env) -> None:
    env.stage(T0, {"x": rows([1, 2, 3] + [4.0] * 17)}, key=REQ)
    env.stage(T0 + DAY, {"x": rows([1, 2, 3] + [4.0] * 16)}, key=REQ)  # last key absent: 1/20 = 5 %
    snap = snapshot(env.c)
    rep = env.drain()
    assert all(r.status is LoadStatus.LOADED for r in rep.results)
    o = env.obs("x")
    assert [(r[0], r[1], r[2], r[3], r[4]) for r in o if r[2] == "DEL"] == [
        (P[19], None, "DEL", "tombstone", "regular")
    ]
    assert (
        one(env.c, "SELECT rows_tombstoned FROM ingest.raw_load ORDER BY raw_id DESC LIMIT 1") == 1
    )
    sid = one(env.c, "SELECT series_id FROM ref.series WHERE series_key = 'x'")
    latest = env.c.execute(
        "SELECT count(*) FROM curated.v_observation_latest WHERE series_id = %s", [sid]
    ).fetchone()
    assert latest == (19,)  # latest DEL key omitted (T-DDL-19)
    env.stage(
        T0 + 2 * DAY, {"x": rows([1, 2, 3] + [4.0] * 16)}, key=REQ
    )  # still absent: no second DEL
    snap = snapshot(env.c) | snap
    env.drain()
    assert sum(1 for r in env.obs("x") if r[2] == "DEL") == 1
    env.stage(T0 + 3 * DAY, {"x": rows([1, 2, 3] + [4.0] * 17)}, key=REQ)  # key returns: revision
    snap = snapshot(env.c) | snap
    env.drain()
    assert env.obs("x")[-1][2:4] == ("OBS", "revision")
    check_replay(env, snap)


@pytest.mark.parametrize(("mode", "scope"), [("incremental", "partial"), ("full", "partial")])
def test_no_tombstone_from_partial_or_incremental(env: Env, mode: str, scope: str) -> None:
    env.stage(T0, {"x": rows([1.0] * 30)}, key=REQ)
    env.stage(T0 + DAY, {"x": rows([1.0] * 29)}, key=REQ, fetch_mode=mode, fetch_scope=scope)
    env.drain()
    assert not any(r[2] == "DEL" for r in env.obs("x"))
    env.stage(T0 + 2 * DAY, {"x": rows([1.0] * 29)}, key=REQ)  # only a full complete object does
    env.drain()
    assert sum(1 for r in env.obs("x") if r[2] == "DEL") == 1


def test_comp03_guard_aborts_tombstones_keeps_observations(env: Env) -> None:
    env.stage(T0, {"x": rows([1.0] * 20)}, key=REQ)
    env.stage(
        T0 + DAY, {"x": rows([1.0] * 17 + [9.0])}, key=REQ
    )  # 2 keys absent (10 %), one revised
    env.drain()
    o = env.obs("x")
    assert not any(r[2] == "DEL" for r in o)
    assert o[-1][1:4] == (9.0, "OBS", "revision")
    res = env.c.execute(
        "SELECT severity, passed, subject FROM ops.validation_result WHERE check_id = 'COMP-03'"
    ).fetchall()
    env.c.rollback()
    assert len(res) == 1
    assert res[0][:2] == ("error", False)
    assert (
        one(
            env.c,
            "SELECT detail->>'tombstones_aborted_comp03' FROM ingest.raw_load ORDER BY raw_id DESC LIMIT 1",
        )
        == "1"
    )


# ------------------------------------------------------------------------ MISS


def test_miss_present_is_not_tombstoned_and_repeats_are_equal(env: Env) -> None:
    env.stage(T0, {"q": rows([1.2, None, 1.3] + [1.0] * 17)}, key=REQ)
    env.stage(
        T0 + DAY, {"q": rows([1.2, None, 1.3] + [1.0] * 17)}, key=REQ
    )  # identical ':' inserts nothing
    env.stage(
        T0 + 2 * DAY, {"q": rows([1.2, 1.4, 1.3] + [1.0] * 17)}, key=REQ
    )  # value for the MISS period
    env.stage(
        T0 + 3 * DAY, {"q": rows([1.2, None, 1.3] + [1.0] * 17)}, key=REQ
    )  # value -> MISS again
    snap = snapshot(env.c)
    env.drain()
    o = [(r[0], r[1], r[2], r[3]) for r in env.obs("q") if r[0] == P[1]]
    assert o == [
        (P[1], None, "MISS", "initial"),
        (P[1], 1.4, "OBS", "revision"),
        (P[1], None, "MISS", "revision"),
    ]
    assert not any(r[2] == "DEL" for r in env.obs("q"))
    check_replay(env, snap)


# ------------------------------------------------------------------------ PROJ + revert


def test_proj_compares_with_same_label_row(env: Env) -> None:
    A, B = "WEO-A", "WEO-B"
    env.stage(T0, {"p": [(P[0], "5.0", "PROJ", A)]}, key=REQ)
    env.stage(
        T0 + DAY, {"p": [(P[0], "5.0", "PROJ", B)]}, key=REQ
    )  # new label, same number: stored
    env.stage(
        T0 + 2 * DAY, {"p": [(P[0], "5.0", "PROJ", B)]}, key=REQ
    )  # same label, same number: none
    env.stage(
        T0 + 3 * DAY, {"p": [(P[0], "5.0", "PROJ", A)]}, key=REQ
    )  # back to A: A's latest row is 5.0, equal: none
    env.stage(
        T0 + 4 * DAY, {"p": [(P[0], "6.0", "PROJ", A)]}, key=REQ
    )  # same label, new number: stored
    env.stage(T0 + 5 * DAY, {"p": [(P[0], "6.0", "PROJ", A)]}, key=REQ)
    snap = snapshot(env.c)
    env.drain()
    assert [(o[1], o[3]) for o in env.obs("p")] == [
        (5.0, "initial"),
        (5.0, "revision"),
        (6.0, "revision"),
    ]
    assert one(env.c, "SELECT count(*) FROM curated.observation WHERE vintage_label = 'WEO-A'") == 2
    check_replay(env, snap)


def test_revert_a_b_a_asof_and_replay(env: Env) -> None:
    for i, v in enumerate(["1.0", "2.0", "1.0"]):
        env.stage(T0 + i * DAY, {"x": [(P[0], v)]}, key=REQ)
    snap = snapshot(env.c)
    env.drain()
    o = env.obs("x")
    assert [(r[1], r[3]) for r in o] == [(1.0, "initial"), (2.0, "revision"), (1.0, "revision")]
    assert len({r[5] for r in o}) == 3
    sid = one(env.c, "SELECT series_id FROM ref.series WHERE series_key = 'x'")

    def asof(ts: datetime) -> float | None:
        r = env.c.execute(
            "SELECT value FROM curated.fn_observation_asof(%s) WHERE series_id = %s", [ts, sid]
        ).fetchone()
        env.c.rollback()
        return None if r is None else float(r[0])

    assert asof(T0 - DAY) is None
    assert [asof(T0 + i * DAY + timedelta(hours=1)) for i in range(3)] == [1.0, 2.0, 1.0]
    assert asof(T0 + 10 * DAY) == 1.0
    check_replay(env, snap)


# ------------------------------------------------------------------------ properties

STEPS = 8
NKEYS = 40


def random_fetches(rng: random.Random) -> list[list[Any]]:
    """Consecutive full+complete fetches: revisions, MISS, one key at a time dropped or returning."""
    state: dict[int, str | None] = {i: f"{rng.randint(10, 20)}.0" for i in range(NKEYS)}
    out = []
    for _step in range(STEPS):
        for _ in range(rng.randint(0, 3)):
            k = rng.randrange(NKEYS)
            if k in state:
                state[k] = rng.choice(
                    [None, f"{rng.randint(10, 20)}.0", f"{rng.randint(10, 20)}.5"]
                )
        k = rng.randrange(NKEYS)
        if k in state and rng.random() < 0.3:
            del state[k]  # at most one newly absent key per fetch: 2.5 % < COMP-03 5 %
        elif k not in state:
            state[k] = f"{rng.randint(10, 20)}.0"  # returns after its tombstone
        out.append([(P[j], v, "MISS" if v is None else "OBS") for j, v in sorted(state.items())])
    return out


def strip(rs: list[tuple[Any, ...]]) -> list[tuple[Any, ...]]:
    """Natural key without the series key (x and y carry the same fetch history)."""
    return [(r[0], r[1], r[3], *r[4:]) for r in rs]


def series_rows(env: Env, key: str) -> list[tuple[Any, ...]]:
    return [r for r in replay.natural_rows(env.c) if r[2] == key]


@pytest.mark.timeout(400)
@pytest.mark.parametrize(("seed", "batch"), [(1, 2), (2, 5), (3, 100)])
def test_random_sequences_batching_independent_asof_and_replay(
    env: Env, seed: int, batch: int
) -> None:
    fetches = random_fetches(random.Random(seed))
    snap: dict[int, dict[str, list[Any]]] = {}
    for i, f in enumerate(fetches):  # x: one object per drain
        raw_id = env.stage(T0 + i * DAY, {"x": f}, key="rx")
        snap.update(snapshot(env.c))
        res = loader.load_raw_id(env.c, raw_id, run_id=env.fx.run_id, insert=env.insert)
        assert res.status is LoadStatus.LOADED
    for i, f in enumerate(fetches):  # y: same history, drained in batches
        env.stage(T0 + i * DAY, {"y": f}, key="ry")
        snap.update(snapshot(env.c))
        if (i + 1) % batch == 0:
            assert env.drain().ok
    assert env.drain().ok
    assert strip(series_rows(env, "x")) == strip(series_rows(env, "y"))

    sid = one(env.c, "SELECT series_id FROM ref.series WHERE series_key = 'x'")
    for i, f in enumerate(fetches):  # as-of reproduces each earlier state
        got = env.c.execute(
            "SELECT ref_period_start, value, value_status FROM curated.fn_observation_asof(%s) "
            "WHERE series_id = %s ORDER BY 1",
            [T0 + i * DAY + timedelta(hours=1), sid],
        ).fetchall()
        env.c.rollback()
        exp = [(p, None if v is None else float(v), st) for p, v, st in f]
        assert [(r[0], None if r[1] is None else float(r[1]), r[2]) for r in got] == exp
    assert any(r[7] == "DEL" for r in series_rows(env, "x"))  # tombstones exercised
    check_replay(env, snap)
