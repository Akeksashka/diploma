# ruff: noqa: F401, F811
"""T29 against a throwaway database: REV-01..05, DB-04, DB-05 through the loader hooks.

AC-VAL-3 (first clause), AC-VAL-7 (REV-05, DB-05), AC-VAL-12 (half unit, ratio unit), check
family and counts stored in ``raw_load.detail``. Real insert seam, fake series map.
"""

from __future__ import annotations

import sys
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent))  # --import-mode=importlib: no sibling imports
from test_loader_insert import Env, M, entry, env, n
from test_loader_queue import conn, one

from macro_monitor.storage import loader
from macro_monitor.validation.revision_checks import make_ordinary_checks

pytestmark = pytest.mark.db

T0 = datetime(2026, 10, 1, 6, 0, tzinfo=UTC)
DAY = timedelta(days=1)


def drain(env: Env, **kw: Any) -> loader.DrainReport:
    chk = make_ordinary_checks(env.fx.run_id, env.insert, **kw)
    return loader.drain(
        env.c, run_id=env.fx.run_id, insert=chk.insert, validate=chk.validate,
        post_checks=chk.post_checks,
    )  # fmt: skip


def rows(vals: list[str]) -> list[tuple[date, str]]:
    return [(M[i], v) for i, v in enumerate(vals)]


def detail(env: Env, raw_id: int) -> dict[str, Any]:
    d = one(env.c, "SELECT detail FROM ingest.raw_load WHERE raw_id = %s", raw_id)
    env.c.rollback()
    assert isinstance(d, dict)
    return d


def unloaded(env: Env) -> list[int]:
    r = env.c.execute("SELECT raw_id FROM ingest.v_raw_unloaded ORDER BY 1").fetchall()
    env.c.rollback()
    return [x[0] for x in r]


def results(env: Env, check: str) -> list[tuple[Any, ...]]:
    r = env.c.execute(
        "SELECT passed, severity, metric, detail, created_at FROM ops.validation_result "
        "WHERE check_id = %s ORDER BY created_at",
        [check],
    ).fetchall()
    env.c.rollback()
    return r


def test_mass_revision_blocks_object_and_raises_drift(env: Env) -> None:
    env.stage(T0, {"x": rows(["10.0"] * 4)})
    bad = env.stage(T0 + DAY, {"x": rows(["11.0", "10.0", "10.0", "10.0"])})  # 25 %
    rep = drain(env)
    assert not rep.ok
    assert unloaded(env) == [bad]
    assert n(env.c, "curated.observation") == 4
    ev = env.c.execute(
        "SELECT kind, raw_id, status FROM ops.drift_event WHERE kind = 'mass_revision'"
    ).fetchall()
    env.c.rollback()
    assert ev == [("mass_revision", bad, "open")]
    r = results(env, "REV-01")
    assert [(x[0], x[1], float(x[2])) for x in r] == [(True, "info", 0.0), (False, "error", 0.25)]
    drain(env)  # still blocked, the open event is reused
    assert n(env.c, "ops.drift_event", "kind = 'mass_revision'") == 1


def test_accepted_event_releases_the_object(env: Env) -> None:
    env.stage(T0, {"x": rows(["10.0"] * 4)})
    bad = env.stage(T0 + DAY, {"x": rows(["11.0", "10.0", "10.0", "10.0"])})
    drain(env)
    env.c.execute(
        "INSERT INTO ops.drift_decision (event_id, decision, decided_by, decided_on) "
        "SELECT event_id, 'accepted', 'tester', current_date FROM ops.drift_event "
        "WHERE raw_id = %s",
        [bad],
    )
    env.c.execute(
        "UPDATE ops.drift_event SET status = 'accepted', decided_by = 'tester', "
        "decided_on = current_date WHERE raw_id = %s",
        [bad],
    )
    env.c.commit()
    assert drain(env).ok
    assert unloaded(env) == []
    assert detail(env, bad)["revision_check"]["material_revisions"] == 1


def test_noise_is_counted_not_loaded_and_family_is_stored(env: Env) -> None:
    env.stage(T0, {"x": rows(["2.0"] * 4)})
    env.stage(T0 + DAY, {"x": rows(["2.05"] * 4)})  # exactly half a unit: equal under the rule
    assert drain(env).ok
    assert n(env.c, "curated.observation") == 4
    r = results(env, "REV-05")
    assert [float(x[2]) for x in r] == [0.0, 4.0]
    d = detail(env, 2)["revision_check"]
    assert (d["family"], d["noise_suppressed"], d["material_revisions"]) == ("REV-01", 4, 0)
    assert all(x[0] for x in results(env, "DB-04"))
    assert results(env, "DB-05")[-1][0] is True


def test_ratio_unit_one_unit_revision_counts(env: Env) -> None:
    env.stage(T0, {"x": rows(["2.0"] * 4)})  # unit PC is a ratio unit in the fixture
    env.stage(T0 + DAY, {"x": rows(["2.1", "2.0", "2.0", "2.0"])})  # 0.1: material, 25 %
    drain(env)
    assert unloaded(env) == [2]


def test_flagged_groups_choose_their_family_and_never_block_in_t29(env: Env) -> None:
    c = env.c
    c.execute(
        "INSERT INTO ref.series_group (source_id, group_id, reestimating, config_sha256) "
        "VALUES ('S','RE',true,'x')"
    )
    c.execute(
        "INSERT INTO ref.series_group (source_id, group_id, edition_ordered, config_sha256) "
        "VALUES ('S','ED2',true,'x')"
    )
    c.commit()
    env.entries = [entry("x", group="RE"), entry("v", group="ED2")]
    env.stage(T0, {"x": rows(["10.0"] * 4)}, grp="RE")
    env.stage(T0 + DAY, {"x": rows(["20.0"] * 4)}, grp="RE")  # 100 % revised
    env.stage(T0, {"v": rows(["10.0"] * 4)}, grp="ED2", edition_date=date(2026, 4, 1))
    env.stage(T0 + DAY, {"v": rows(["20.0"] * 4)}, grp="ED2", edition_date=date(2026, 10, 1))
    assert drain(env).ok
    fams = {
        r[0]: detail(env, r[0])["revision_check"]
        for r in c.execute("SELECT raw_id FROM ingest.raw_load ORDER BY 1").fetchall()
    }
    c.rollback()
    assert [fams[i]["family"] for i in (1, 2, 3, 4)] == ["REV-06", "REV-06", "REV-07", "REV-07"]
    assert fams[4]["material_revisions"] == 4
    assert n(c, "ops.drift_event", "kind = 'mass_revision'") == 0
    assert results(env, "REV-01") == []


def test_db_05_cap_blocks_with_drift(env: Env) -> None:
    big = env.stage(T0, {"x": rows(["1.0"] * 3)})
    rep = drain(env, max_insert_rows={("S", "G1"): 2})
    assert not rep.ok
    assert unloaded(env) == [big]
    r = results(env, "DB-05")
    assert [(x[0], x[1]) for x in r] == [(False, "error")]
    assert n(env.c, "ops.drift_event", "kind = 'mass_revision'") == 1
    assert drain(env).ok  # default cap 100,000: the object loads
    assert n(env.c, "curated.observation") == 3


def test_comp_01_and_02_through_the_hook(env: Env) -> None:
    env.stage(T0, {k: rows(["1.0"]) for k in "xyz"}, key="rq")
    first = drain(env, expected_series_min={("S", "G1"): 3})
    assert first.ok
    env.stage(T0 + DAY, {k: rows(["1.0"]) for k in "xy"}, key="rq")  # z disappeared: 33 %
    assert not drain(env, expected_series_min={("S", "G1"): 2}).ok
    r = results(env, "COMP-02")
    assert r[-1][0] is False
    assert results(env, "COMP-01")[-1][0] is True


def _edition_group(env: Env, grp: str = "WE") -> None:
    env.c.execute(
        "INSERT INTO ref.series_group (source_id, group_id, edition_ordered, config_sha256) "
        "VALUES ('S',%s,true,'x')",
        [grp],
    )
    env.c.commit()
    env.entries = [entry("x", group=grp)]


def test_rev_07_full_rebase_loads_and_warns(env: Env) -> None:
    _edition_group(env)
    env.stage(T0, {"x": rows(["10.0"] * 4)}, grp="WE", edition_date=date(2026, 4, 1))
    second = env.stage(
        T0 + DAY, {"x": rows(["20.0"] * 4)}, grp="WE", edition_date=date(2026, 10, 1)
    )  # 100 % revised
    assert drain(env).ok
    assert unloaded(env) == []
    assert n(env.c, "ops.drift_event", "kind = 'mass_revision'") == 0
    assert (
        n(env.c, "curated.observation", "revision_class = 'regular' AND load_kind = 'revision'")
        == 4
    )
    d = detail(env, second)["revision_check"]
    assert (d["family"], d["material_revisions"], d["share"], d["evaluated"]) == (
        "REV-07",
        4,
        1.0,
        True,
    )
    r = results(env, "REV-07")
    assert [(x[0], x[1]) for x in r] == [(True, "info"), (False, "warn")]
    assert results(env, "REV-01") == []


def test_rev_07_ten_percent_is_info_and_proj_not_counted(env: Env) -> None:
    _edition_group(env)
    env.entries = [entry("x", group="WE"), entry("y", group="WE")]
    base = rows(["10.0"] * 5)
    env.stage(
        T0,
        {"x": [*base, (M[5], "5.0", "PROJ", "WEO-A")], "y": base},
        grp="WE", edition_date=date(2026, 4, 1),
    )  # fmt: skip
    second = env.stage(
        T0 + DAY,
        {
            "x": [(M[0], "20.0"), *base[1:], (M[5], "9.0", "PROJ", "WEO-B")],  # 1 of 10 keys
            "y": base,
        },
        grp="WE", edition_date=date(2026, 10, 1),
    )  # fmt: skip
    assert drain(env).ok
    r = results(env, "REV-07")
    assert (r[-1][0], r[-1][1], float(r[-1][2])) == (True, "info", 0.1)
    assert detail(env, second)["revision_check"]["material_revisions"] == 1


def test_rev_07_db_05_cap_still_blocks(env: Env) -> None:
    _edition_group(env)
    big = env.stage(T0, {"x": rows(["1.0"] * 3)}, grp="WE", edition_date=date(2026, 4, 1))
    rep = drain(env, max_insert_rows={("S", "WE"): 2})
    assert not rep.ok
    assert unloaded(env) == [big]


def _reest_group(env: Env, cap: int, abs_: str = "0") -> None:
    env.c.execute(
        "INSERT INTO ref.series_group (source_id, group_id, reestimating, snapshot_mode, "
        "materiality_abs, max_revised_rows, config_sha256) "
        "VALUES ('S','RE','true','diff_above_tol',%s,%s,'x')",
        [abs_, cap],
    )
    env.c.commit()
    env.entries = [entry("x", group="RE")]


def test_rev_06_below_cap_loads_as_reestimation(env: Env) -> None:
    _reest_group(
        env, cap=5, abs_="0.1"
    )  # PC is a ratio unit: only materiality_abs applies; half unit 0.05
    env.stage(T0, {"x": rows(["10.0"] * 4)}, grp="RE")
    second = env.stage(T0 + DAY, {"x": rows(["20.0"] * 3 + ["10.06"])}, grp="RE")
    assert drain(env).ok
    assert unloaded(env) == []
    assert n(env.c, "ops.drift_event", "kind = 'mass_revision'") == 0
    assert (
        n(
            env.c,
            "curated.observation",
            "revision_class = 'reestimation' AND load_kind = 'revision'",
        )
        == 3
    )
    d = detail(env, second)
    assert d["revision_check"]["family"] == "REV-06"
    assert d["revision_check"]["material_revisions"] == 3
    assert d["revision_check"]["evaluated"] is True
    assert one(env.c, "SELECT rows_below_tol FROM ingest.raw_load WHERE raw_id = %s", second) == 1
    env.c.rollback()
    r = results(env, "REV-06")
    assert [(x[0], x[1]) for x in r] == [(True, "info"), (True, "info")]
    assert results(env, "REV-01") == []


def test_rev_06_above_cap_blocks_with_drift(env: Env) -> None:
    _reest_group(env, cap=2)
    env.stage(T0, {"x": rows(["10.0"] * 4)}, grp="RE")
    bad = env.stage(T0 + DAY, {"x": rows(["20.0"] * 4)}, grp="RE")
    assert not drain(env).ok
    assert unloaded(env) == [bad]
    assert n(env.c, "curated.observation") == 4
    ev = env.c.execute("SELECT kind, raw_id FROM ops.drift_event").fetchall()
    env.c.rollback()
    assert ev == [("mass_revision", bad)]
    r = results(env, "REV-06")
    assert (r[-1][0], r[-1][1], float(r[-1][2])) == (False, "error", 4.0)


def test_snapshot_row_is_recorded_and_append_only(env: Env, tmp_path: Path) -> None:
    from macro_monitor.ingestion.archive import LocalDirStore
    from macro_monitor.storage.snapshot import read_snapshot, record_snapshot

    _reest_group(env, cap=5)
    raw = env.stage(T0, {"x": rows(["10.0"] * 4)}, grp="RE")
    snap = [("d|x", M[i], Decimal("10.0"), "OBS") for i in range(4)]
    store = LocalDirStore(tmp_path)
    assert record_snapshot(env.c, store, raw_id=raw, source_id="S", rows=snap, parser_id="p1") == 4
    assert record_snapshot(env.c, store, raw_id=raw, source_id="S", rows=snap, parser_id="p1") == 4
    env.c.commit()
    row = env.c.execute(
        "SELECT sha256, byte_count, row_count, parser_id FROM ingest.raw_snapshot"
    ).fetchall()
    env.c.rollback()
    assert len(row) == 1
    assert row[0][2:] == (4, "p1")
    from macro_monitor.ingestion.archive import StorageRef

    ref = StorageRef(asset=f"S/{row[0][0][:2]}/{row[0][0]}.zst")
    assert read_snapshot(store.get(ref)) == snap
    with pytest.raises(Exception, match=r"(?i)append|immutable|not allowed"):
        env.c.execute("UPDATE ingest.raw_snapshot SET row_count = 1")
    env.c.rollback()
