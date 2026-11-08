# ruff: noqa: E501, F401, F811
"""T27 loader B against a throwaway database: insert-on-change, first-sight creation, precision.

T-DDL-13, T-DDL-25, AC-ING-4 steps 1-3, AC-ING-16, AC-ING-21, I-CUR-2/3/5. The series map is a
fake provider (the git-sha lookup itself is covered separately); everything else is the real seam.
"""

from __future__ import annotations

import calendar
import sys
from collections.abc import Callable, Iterator, Sequence
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg import errors

sys.path.insert(0, str(Path(__file__).parent))  # --import-mode=importlib: no sibling imports
from test_loader_queue import Fx, conn, one

from macro_monitor.registry.sync import MapEntry
from macro_monitor.storage import loader
from macro_monitor.storage.loader import LoadContext, LoadCounts, LoadStatus, make_insert

pytestmark = pytest.mark.db

T0 = datetime(2026, 10, 1, 6, 0, tzinfo=UTC)
DAY = timedelta(days=1)
M = [date(2026, m, 1) for m in range(1, 7)]

META: dict[str, Any] = {
    "entity_code": "E1", "frequency": "M", "unit_code": "PC", "unit_mult": 0, "price_basis": "NA",
    "seasonal_adjustment": "SA", "calendar_basis": "CAL", "flow_basis": "NA", "title": "T",
    "published_decimals": None,
}  # fmt: skip
EXPECT = {
    "frequency": "M", "unit": "PC", "seasonal_adjustment": "SA", "price_basis": "NA",
    "composition": "FIXED",
}  # fmt: skip


def entry(key: str, group: str = "G1", **over: Any) -> MapEntry:
    base: dict[str, Any] = {
        "source_id": "S", "group_id": group, "dataset": "d", "key": key, "entity": "E1",
        "indicator": "I1", "role": "headline", "valid_from": "1991-01-01", "valid_to": None,
        "rationale": "r", "splice_note": None, "expect": dict(EXPECT),
    }  # fmt: skip
    return MapEntry(**{**base, **over})


class Env:
    def __init__(self, c: psycopg.Connection, entries: list[MapEntry]) -> None:
        self.c = c
        self.fx = Fx(c)
        self.entries = entries
        self.insert = make_insert(self.provider)

    def provider(self, source: str, group: str, sha: str) -> Sequence[MapEntry]:
        return [e for e in self.entries if e.source_id == source]

    def stage(
        self,
        at: datetime,
        series: dict[str, list[tuple[date, str] | tuple[date, str, str, str | None]]],
        meta: dict[str, dict[str, Any] | None] | None = None,
        **kw: Any,
    ) -> int:
        raw_id = self.fx.obj(at, {}, **kw)
        for key, rows in series.items():
            ref = f"d|{key}"
            m = (meta or {}).get(key, {})
            if m is not None:
                v = {**META, **m}
                cols = ", ".join(v)
                self.c.execute(
                    f"INSERT INTO staging.series_meta_load (run_id, raw_id, series_ref, {cols}) "
                    f"VALUES (%s,%s,%s,{','.join(['%s'] * len(v))})",
                    [self.fx.run_id, raw_id, ref, *v.values()],
                )
            batch = []
            for r in rows:
                start, val = r[0], r[1]
                status = r[2] if len(r) > 2 else "OBS"
                label = r[3] if len(r) > 3 else None
                end = date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])
                batch.append([self.fx.run_id, raw_id, ref, start, end, val, status, label])
            with self.c.cursor() as cur:
                cur.executemany(
                    "INSERT INTO staging.observation_load (run_id, raw_id, series_ref, "
                    "ref_period_start, ref_period_end, value, value_status, vintage_label, row_hash) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'h')",
                    batch,
                )
        self.c.commit()
        return raw_id

    def drain(self, **kw: Any) -> loader.DrainReport:
        return loader.drain(self.c, run_id=self.fx.run_id, insert=self.insert, **kw)

    def obs(self, key: str) -> list[tuple[Any, ...]]:
        rows = self.c.execute(
            "SELECT o.ref_period_start, o.value, o.value_status, o.load_kind, o.revision_class, "
            "o.known_at FROM curated.observation o JOIN ref.series s USING (series_id) "
            "WHERE s.series_key = %s ORDER BY o.known_at, o.ref_period_start",
            [key],
        ).fetchall()
        self.c.rollback()
        return [(r[0], None if r[1] is None else float(r[1]), *r[2:]) for r in rows]


@pytest.fixture
def env(conn: psycopg.Connection) -> Env:
    conn.execute(
        "INSERT INTO ref.indicator (indicator_id, name, kind, tier, priority, currency_basis, "
        "staleness_class, transform_id, alert_method, adverse_dir, good_dir, rank_mode, "
        "stationarity_class, release_lag_aware) VALUES ('I1','I1','indicator','M','core','NA',"
        "'ACT120','level','z',0,1,'monotone_good','stationary',false)"
    )
    conn.commit()
    return Env(conn, [entry(k) for k in "xyzvwpq"])


def n(c: psycopg.Connection, table: str, where: str = "true") -> int:
    return int(one(c, f"SELECT count(*) FROM {table} WHERE {where}"))


# ------------------------------------------------------------------ first sight (AC-ING-21)


def test_first_sight_creates_series_map_and_observations(env: Env) -> None:
    c = env.c
    env.stage(T0, {"x": [(M[0], "2.1"), (M[1], "2.15")]})
    rep = env.drain()
    assert rep.results[0].status is LoadStatus.LOADED
    row = c.execute(
        "SELECT version, supersedes_series_id, first_seen_at, group_id, dataset_id, entity_id, title, "
        "frequency, unit_code, seasonal_adjustment, price_basis, flow_basis, composition, "
        "published_decimals FROM ref.series"
    ).fetchall()
    c.rollback()
    assert row == [(1, None, T0, "G1", "d", "E1", "T", "M", "PC", "SA", "NA", "NA", "FIXED", 2)]
    assert n(c, "ref.series_map", "role = 'headline' AND indicator_id = 'I1'") == 1
    assert n(c, "ref.config_history", "table_name = 'series_map' AND git_sha = 'g'") == 1
    obs = env.obs("x")
    assert [(o[0], o[3], o[5]) for o in obs] == [(M[0], "initial", T0), (M[1], "initial", T0)]
    assert one(c, "SELECT rows_inserted FROM ingest.raw_load") == 2
    # a second drain and a second object with the same data create nothing (I-CUR-2)
    assert env.drain().results == []
    env.stage(T0 + DAY, {"x": [(M[0], "2.1"), (M[1], "2.15")]})
    env.drain()
    assert n(c, "ref.series") == 1
    assert n(c, "ref.series_map") == 1
    assert n(c, "curated.observation") == 2


def test_rollback_leaves_no_series_row(env: Env) -> None:
    c = env.c
    env.stage(T0, {"x": [(M[0], "1")]})

    def boom(ctx: LoadContext) -> LoadCounts:
        env.insert(ctx)
        raise RuntimeError("after insert")

    rep = loader.drain(c, run_id=env.fx.run_id, insert=boom)
    assert rep.results[0].status is LoadStatus.ERROR
    assert n(c, "ref.series") == n(c, "ref.series_map") == n(c, "curated.observation") == 0
    assert n(c, "ref.config_history", "table_name = 'series_map'") == 0
    assert env.drain().results[0].status is LoadStatus.LOADED  # retried from stored staging
    assert n(c, "ref.series") == 1


@pytest.mark.parametrize(
    ("meta", "entry_over", "kind"),
    [
        ({"frequency": "Q"}, {}, "frequency"),  # differs from expect
        ({"seasonal_adjustment": "NSA"}, {}, "seasonal_adjustment"),
        ({"unit_code": "ZZZ"}, {"expect": {**EXPECT, "unit": "ZZZ"}}, "unit"),  # not in ref.unit
        ({}, {"group_id": "NOGROUP"}, "schema_drift"),  # group missing from ref.series_group
        (None, {}, "schema_drift"),  # no published metadata at all
        ({"frequency": "X"}, {"expect": {"composition": "FIXED"}}, "schema_drift"),  # CHECK domain
    ],
)
def test_first_sight_failures_create_no_row_and_defer(
    env: Env, meta: dict[str, Any] | None, entry_over: dict[str, Any], kind: str
) -> None:
    c = env.c
    env.entries = [entry("x", **entry_over), entry("y")]
    env.stage(T0, {"x": [(M[0], "1")], "y": [(M[0], "5")]}, meta={"x": meta})
    rep = env.drain()
    assert rep.results[0].status is LoadStatus.LOADED  # the object loads, the series is deferred
    assert n(c, "ref.series", "series_key = 'x'") == 0
    assert n(c, "ref.series_map") == 1  # only y
    assert n(c, "curated.observation") == 1
    assert (
        one(c, "SELECT kind FROM ops.drift_event WHERE series_ref = 'd|x' ORDER BY event_id")
        == kind
    )
    assert (
        one(
            c,
            "SELECT count(*) FROM ingest.v_series_deferred WHERE series_ref = 'd|x' AND event_id IS NOT NULL",
        )
        == 1
    )
    assert one(c, "SELECT (detail->>'series_deferred')::int FROM ingest.raw_load") == 1


def test_unmapped_series_is_never_created(env: Env) -> None:
    c = env.c
    env.entries = [entry("x")]
    env.stage(T0, {"x": [(M[0], "1")], "z": [(M[0], "9")]})
    env.drain()
    assert one(c, "SELECT array_agg(series_key) FROM ref.series") == ["x"]
    assert n(c, "ops.drift_event") == 0
    assert one(c, "SELECT detail->'series_unmapped' FROM ingest.raw_load") == ["d|z"]


def test_existing_series_attribute_drift_defers(env: Env) -> None:
    c = env.c
    env.stage(T0, {"x": [(M[0], "1")], "y": [(M[0], "1")]})
    env.drain()
    env.stage(
        T0 + DAY,
        {"x": [(M[0], "7")], "y": [(M[0], "7")]},
        meta={"x": {"seasonal_adjustment": "NSA", "unit_code": "PC"}},
    )
    env.drain()
    kinds = c.execute("SELECT kind, series_ref FROM ops.drift_event").fetchall()
    c.rollback()
    assert kinds == [("seasonal_adjustment", "d|x")]
    assert [o[1] for o in env.obs("x")] == [1]  # deferred: the 7 is not loaded
    assert [o[1] for o in env.obs("y")] == [1, 7]
    # an identical open event is reused by the next object, not duplicated
    env.stage(T0 + 2 * DAY, {"x": [(M[0], "8")]}, meta={"x": {"seasonal_adjustment": "NSA"}})
    env.drain()
    assert n(c, "ops.drift_event") == 1
    assert n(c, "ingest.v_series_deferred") == 2


# ----------------------------------------------------- insert-on-change (T-DDL-13, AC-ING-4)


def test_insert_on_change_one_decimal(env: Env) -> None:
    env.stage(T0, {"x": [(M[0], "2.1"), (M[1], "3")]})  # d = 1 from the first-load history
    env.stage(T0 + DAY, {"x": [(M[0], "2.14"), (M[1], "3.0000000001"), (M[2], "4.0")]})
    env.stage(T0 + 2 * DAY, {"x": [(M[0], "2.16"), (M[1], "3.00"), (M[2], "4")]})
    env.stage(T0 + 3 * DAY, {"x": [(M[0], "2.10"), (M[1], "3.2")]})  # 2.10 vs stored 2.16: 0.06
    rep = env.drain()
    assert rep.ok
    assert [(o[0], o[1], o[3], o[4]) for o in env.obs("x")] == [
        (M[0], 2.1, "initial", "regular"),
        (M[1], 3, "initial", "regular"),
        (M[2], 4, "new_period", "regular"),
        (M[0], 2.16, "revision", "regular"),
        (M[0], 2.1, "revision", "regular"),
        (M[1], 3.2, "revision", "regular"),
    ]
    assert one(env.c, "SELECT published_decimals FROM ref.series") == 1
    counts = env.c.execute("SELECT rows_inserted FROM ingest.raw_load ORDER BY raw_id").fetchall()
    env.c.rollback()
    assert [r[0] for r in counts] == [2, 1, 1, 2]


def test_half_unit_boundary_two_decimals(env: Env) -> None:
    env.stage(T0, {"w": [(M[0], "1.00"), (M[1], "1.01")]})
    env.stage(T0 + DAY, {"w": [(M[0], "1.005")]})  # exactly half a unit: equal, not stored
    env.stage(T0 + 2 * DAY, {"w": [(M[0], "1.01")]})  # 0.01 versus stored 1.00: stored
    env.drain()
    assert [(o[0], o[1], o[3]) for o in env.obs("w")][2:] == [(M[0], 1.01, "revision")]
    assert n(env.c, "curated.observation") == 3


def test_published_decimals_max_of_history_and_precision_change(env: Env) -> None:
    c = env.c
    env.stage(T0, {"v": [(M[0], "100"), (M[1], "101"), (M[2], "102.25")]})  # AC-ING-16
    env.drain()
    assert one(c, "SELECT published_decimals FROM ref.series") == 2
    env.stage(T0 + DAY, {"v": [(M[0], "100.01")]})  # revision of 0.01 is stored
    env.drain()
    assert [o[1] for o in env.obs("v")][-1] == pytest.approx(100.01)
    with pytest.raises(errors.RestrictViolation):  # lowering is rejected
        c.execute("UPDATE ref.series SET published_decimals = 1")
    c.rollback()
    with pytest.raises(errors.RestrictViolation):  # increase without an event is rejected
        c.execute("UPDATE ref.series SET published_decimals = 3")
    c.rollback()
    # noise in a later value does not raise it; an explicit larger DECIMALS does, with an event
    env.stage(T0 + 2 * DAY, {"v": [(M[0], "100.0100000001")]})
    env.drain()
    assert one(c, "SELECT published_decimals FROM ref.series") == 2
    assert n(c, "ops.drift_event") == 0
    env.stage(T0 + 3 * DAY, {"v": [(M[0], "100.012")]}, meta={"v": {"published_decimals": 3}})
    env.drain()
    assert one(c, "SELECT published_decimals FROM ref.series") == 3
    assert one(c, "SELECT kind FROM ops.drift_event") == "precision_change"
    assert one(c, "SELECT old->>'value' || '>' || (new->>'value') FROM ops.drift_event") == "2>3"


def test_proj_new_label_same_number_is_stored(env: Env) -> None:
    env.stage(T0, {"p": [(M[0], "5.0", "PROJ", "WEO-A")]})
    env.stage(T0 + DAY, {"p": [(M[0], "5.0", "PROJ", "WEO-B")]})  # new edition: stored
    env.stage(T0 + 2 * DAY, {"p": [(M[0], "5.0", "PROJ", "WEO-B")]})  # same label, same number
    env.stage(T0 + 3 * DAY, {"p": [(M[0], "5.0", "PROJ", "WEO-A")]})  # back to an older label
    env.drain()
    assert [(o[2], o[3]) for o in env.obs("p")] == [("PROJ", "initial"), ("PROJ", "revision")]


def test_value_status_and_miss_changes(env: Env) -> None:
    env.stage(T0, {"q": [(M[0], "1.0", "PROV"), (M[1], None, "MISS")]})  # type: ignore[list-item]
    env.stage(T0 + DAY, {"q": [(M[0], "1.0", "OBS"), (M[1], None, "MISS"), (M[2], None, "MISS")]})  # type: ignore[list-item]
    env.stage(T0 + 2 * DAY, {"q": [(M[1], "3", "OBS")]})
    env.drain()
    assert [(o[0], o[2], o[3]) for o in env.obs("q")] == [
        (M[0], "PROV", "initial"),
        (M[1], "MISS", "initial"),
        (M[0], "OBS", "revision"),
        (M[2], "MISS", "new_period"),
        (M[1], "OBS", "revision"),
    ]


def test_import_kind_inserts_every_row(env: Env) -> None:
    env.stage(T0, {"x": [(M[0], "1")]})
    env.stage(
        T0 + DAY, {"x": [(M[0], "1"), (M[1], "2")]}, manual=True, import_label="archive_import"
    )
    env.stage(T0 + 2 * DAY, {"x": [(M[0], "1")]})  # imports are ignored by the comparison
    env.drain()
    assert [(o[3]) for o in env.obs("x")] == ["initial", "import", "import"]
    assert n(env.c, "curated.observation") == 3


def test_reestimating_group_marks_revision_class_and_counts_below_tol(env: Env) -> None:
    c = env.c
    c.execute(
        "INSERT INTO ref.series_group (source_id, group_id, reestimating, snapshot_mode, "
        "materiality_rel, config_sha256) VALUES ('S','RE',true,'diff_above_tol',0.05,'x')"
    )
    c.commit()
    env.entries = [entry("x", group="RE", expect={**EXPECT, "unit": "IDX"})]
    idx = {"x": {"unit_code": "IDX"}}  # a ratio unit would use the absolute tolerance only
    env.stage(T0, {"x": [(M[0], "100.0")]}, meta=idx, grp="RE")
    # above half unit, below 5 % materiality
    env.stage(T0 + DAY, {"x": [(M[0], "100.2")]}, meta=idx, grp="RE")
    env.stage(T0 + 2 * DAY, {"x": [(M[0], "110.0")]}, meta=idx, grp="RE")
    env.drain()
    assert [(o[3], o[4]) for o in env.obs("x")] == [
        ("initial", "regular"),
        ("revision", "reestimation"),
    ]
    assert one(c, "SELECT sum(rows_below_tol) FROM ingest.raw_load") == 1


def test_one_headline_rule_enforced_by_loader_without_btree_gist(env: Env) -> None:
    """T11 carry-over: with `mm.headline_exclusion=loader` the loader enforces T-DDL-4 itself."""
    c = env.c
    c.execute("ALTER TABLE ref.series_map DROP CONSTRAINT series_map_one_headline")
    c.commit()
    env.stage(T0, {"x": [(M[0], "1")], "y": [(M[0], "2")]})  # both claim I1/E1 as headline
    env.drain()
    assert one(c, "SELECT array_agg(series_key) FROM ref.series") == ["x"]
    assert n(c, "ref.series_map", "role = 'headline'") == 1
    assert one(c, "SELECT kind FROM ops.drift_event WHERE series_ref = 'd|y'") == "classification"
    assert n(c, "curated.observation") == 1
