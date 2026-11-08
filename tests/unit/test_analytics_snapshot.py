"""T40 unit tests: staleness classes and snapshot rows. Expected numbers come from the specs
(validation spec section 3 limits; analytics spec sections 1, 2 and 8; DDL spec publish_scope)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from macro_monitor.analytics import snapshot as sn
from macro_monitor.analytics import staleness as st

RUN = date(2026, 10, 15)
KNOWN = datetime(2026, 10, 1, tzinfo=UTC)


def test_class_limits_are_d14() -> None:
    assert dict(st.CLASS_LIMITS) == {
        "MKT45": 45, "SURV75": 75, "ACT120": 120, "Q270": 270,
        "A730": 730, "TRI1460": 1460, "EVENT": 730,
    }  # fmt: skip


@pytest.mark.parametrize("cls", ["MKT45", "SURV75", "ACT120", "Q270", "A730", "TRI1460"])
def test_limit_not_stale_limit_plus_one_stale(cls: str) -> None:
    lim = st.stale_limit(cls, release_lag_aware=False, timing=None)
    assert lim.source == "class"
    assert lim.days == st.CLASS_LIMITS[cls]
    assert not st.is_stale(lim.days, lim.days)
    assert st.is_stale(lim.days + 1, lim.days)


def test_age_is_run_date_minus_period_end() -> None:
    assert st.age_days(date(2026, 10, 15), date(2026, 8, 31)) == 45


def test_release_lag_aware_raises_limit_and_records_source() -> None:
    # spec section 8: max(class_limit, typical_publication_lag_days + tolerance_days)
    t = st.ReleaseTiming(typical_lag_days=150, tolerance_days=30)
    lim = st.stale_limit("ACT120", release_lag_aware=True, timing=t)
    assert (lim.days, lim.source) == (180, "release_lag_aware")
    assert not st.is_stale(180, lim.days)
    assert st.is_stale(181, lim.days)


def test_release_lag_aware_never_lowers_the_class_limit() -> None:
    t = st.ReleaseTiming(30, 20)
    lim = st.stale_limit("ACT120", release_lag_aware=True, timing=t)
    assert (lim.days, lim.source) == (120, "release_lag_aware")


def test_lag_aware_off_ignores_timing() -> None:
    lim = st.stale_limit("ACT120", release_lag_aware=False, timing=st.ReleaseTiming(500, 0))
    assert (lim.days, lim.source) == (120, "class")


def test_unknown_class_rejected() -> None:
    with pytest.raises(ValueError, match="unknown staleness"):
        st.class_limit("NOPE")


def test_load_release_calendar_skips_incomplete(tmp_path: Path) -> None:
    p = tmp_path / "c.yaml"
    p.write_text(
        "g1: {frequency: M, typical_lag_days: 45, tolerance_days: 20}\ng2: {frequency: M}\n"
    )
    assert st.load_release_calendar(p) == {"g1": st.ReleaseTiming(45, 20)}


def test_shipped_release_calendar_loads() -> None:
    cal = st.load_release_calendar(Path(__file__).parents[2] / "config" / "release_calendar.yaml")
    assert cal["eurostat_labour"] == st.ReleaseTiming(45, 20)


@pytest.mark.parametrize(
    ("publish", "glob", "mode", "ranked_dom", "expected"),
    [
        (False, False, "monotone_good", True, "excluded"),
        (False, True, "descriptive_only", False, "excluded"),
        (True, True, "monotone_good", True, "info_only"),  # WLD
        (True, False, "descriptive_only", True, "info_only"),
        (True, False, "monotone_good", False, "info_only"),  # unranked domain
        (True, False, "monotone_good", True, "ranked"),
        (True, False, "target_distance", True, "ranked"),
    ],
)
def test_publish_scope_rule(
    publish: bool, glob: bool, mode: str, ranked_dom: bool, expected: str
) -> None:
    assert (
        sn.publish_scope(
            publish=publish, entity_is_global=glob, rank_mode=mode, in_ranked_domain=ranked_dom
        )
        == expected
    )


def _ind(
    iid: str = "U1",
    *,
    scope: str = "country",
    mode: str = "monotone_good",
    cls: str = "ACT120",
    lag_aware: bool = False,
    ranked: bool = True,
    transform: str = "LEVEL",
) -> sn.IndicatorInfo:
    return sn.IndicatorInfo(iid, scope, mode, cls, lag_aware, transform, ranked)


def _obs(
    end: date, value: str | None, *, status: str = "OBS", public: bool = True, group: str = "G"
) -> sn.Obs:
    return sn.Obs(
        1, "S", group, "M", "NA", public, end, None if value is None else Decimal(value),
        status, KNOWN, None,
    )  # fmt: skip


def _build(
    ind: sn.IndicatorInfo,
    hist: list[sn.Obs],
    *,
    entities: tuple[tuple[str, bool], ...] = (("A", False),),
    inheritance: dict[tuple[str, str], str] | None = None,
    cal: dict[str, st.ReleaseTiming] | None = None,
    est: frozenset[str] = frozenset({"A02"}),
) -> sn.SnapshotResult:
    return sn.build_rows(
        [ind], entities, {(ind.indicator_id, "A"): hist}, inheritance or {}, {},
        run_date=RUN, release_calendar=cal or {}, estimate_indicators=est,
    )  # fmt: skip


def test_latest_row_with_value_and_age() -> None:
    (r,) = _build(_ind(), [_obs(date(2026, 7, 31), "5.0"), _obs(date(2026, 8, 31), "6.0")]).rows
    assert (r.value, r.ref_period_end, r.age_days) == (Decimal("6.0"), date(2026, 8, 31), 45)
    assert (r.stale_limit_days, r.is_stale, r.limit_source) == (120, False, "class")
    assert r.transformed_value == Decimal("6.0")
    assert r.transform_id == "LEVEL"
    assert (r.publish, r.publish_scope, r.value_kind, r.inherited) == (
        True,
        "ranked",
        "observed",
        False,
    )
    assert (r.alignment, r.alignment_reason, r.ref_offset_days) == ("n/a", None, None)


def test_miss_supplies_no_value_and_does_not_reset_age() -> None:
    # AC-AN-22: Aug is MISS; the snapshot is July, aged from July 31 (76 days), not from Aug 31.
    (r,) = _build(
        _ind(), [_obs(date(2026, 7, 31), "7.0"), _obs(date(2026, 8, 31), None, status="MISS")]
    ).rows
    assert (r.value, r.ref_period_end, r.age_days) == (Decimal("7.0"), date(2026, 7, 31), 76)


def test_all_miss_series_has_no_value_and_no_age() -> None:
    (r,) = _build(_ind(), [_obs(date(2026, 8, 31), None, status="MISS")]).rows
    assert (r.value, r.ref_period_end, r.age_days, r.is_stale) == (None, None, None, None)
    assert r.stale_limit_days == 120


def test_miss_series_ages_out_like_any_other() -> None:
    old = [_obs(date(2026, 5, 31), "1.0"), _obs(date(2026, 9, 30), None, status="MISS")]
    (r,) = _build(_ind(), old).rows
    assert (r.age_days, r.is_stale) == (137, True)  # 2026-05-31 -> 2026-10-15; 137 > 120


def test_limit_boundary_in_rows() -> None:
    end = RUN - timedelta(days=120)
    (r,) = _build(_ind(), [_obs(end, "1")]).rows
    assert (r.age_days, r.is_stale) == (120, False)
    (r,) = _build(_ind(), [_obs(end - timedelta(days=1), "1")]).rows
    assert (r.age_days, r.is_stale) == (121, True)


def test_release_lag_aware_row() -> None:
    cal = {"G": st.ReleaseTiming(150, 30)}
    end = RUN - timedelta(days=180)
    (r,) = _build(_ind(lag_aware=True), [_obs(end, "1")], cal=cal).rows
    assert (r.stale_limit_days, r.limit_source, r.is_stale) == (180, "release_lag_aware", False)
    (r,) = _build(_ind(lag_aware=True), [_obs(end - timedelta(days=1), "1")], cal=cal).rows
    assert r.is_stale is True


def test_lag_aware_without_calendar_entry_falls_back_and_warns() -> None:
    res = _build(_ind(lag_aware=True), [_obs(date(2026, 8, 31), "1")])
    assert (res.rows[0].limit_source, res.rows[0].stale_limit_days) == ("class", 120)
    assert len(res.warnings) == 1


def test_withheld_pair_not_published() -> None:
    (r,) = _build(_ind(), [_obs(date(2026, 8, 31), "4.4", public=False)]).rows
    assert (r.publish, r.publish_scope) == (False, "excluded")


def test_estimate_indicator_uses_est_rows_only() -> None:
    hist = [
        _obs(date(2024, 12, 31), "0.5", status="EST"),
        _obs(date(2025, 12, 31), "0.7", status="EST"),
        _obs(date(2026, 12, 31), "0.9", status="PROJ"),
    ]
    hist = [h for h in hist if h.value_status != "PROJ"]  # the view never returns PROJ
    (r,) = _build(_ind("A02", mode="target_distance"), hist).rows
    assert (r.value, r.value_kind) == (Decimal("0.7"), "estimate")
    # an OBS row of an estimate indicator never counts as a value
    (r,) = _build(_ind("A02"), [_obs(date(2025, 12, 31), "9", status="OBS")]).rows
    assert (r.value, r.value_kind) == (None, "estimate")


def test_inherited_member_shows_source_value_flagged() -> None:
    res = sn.build_rows(
        [_ind()], (("A", False), ("EA", False)),
        {("U1", "EA"): [_obs(date(2026, 8, 31), "3.5")]}, {("U1", "A"): "EA"}, {},
        run_date=RUN, release_calendar={},
    )  # fmt: skip
    a = next(r for r in res.rows if r.entity_id == "A")
    ea = next(r for r in res.rows if r.entity_id == "EA")
    assert (a.inherited, a.value) == (True, Decimal("3.5"))
    assert (ea.inherited, ea.value) == (False, Decimal("3.5"))


def test_global_indicator_only_wld_country_indicator_never_wld() -> None:
    ents = (("A", False), ("B", False), ("WLD", True))
    res = sn.build_rows(
        [_ind("U1"), _ind("M24", scope="global", mode="descriptive_only", ranked=False)],
        ents, {}, {}, {}, run_date=RUN, release_calendar={},
    )  # fmt: skip
    by = {(r.indicator_id, r.entity_id): r for r in res.rows}
    assert sorted(by) == [("M24", "WLD"), ("U1", "A"), ("U1", "B")]
    assert by[("M24", "WLD")].publish_scope == "info_only"


def test_yoy_transform_applied_to_latest() -> None:
    hist = [_obs(date(2025, 8, 31), "100"), _obs(date(2026, 8, 31), "103")]
    (r,) = _build(_ind(transform="YOY"), hist).rows
    assert r.transformed_value == Decimal("3")
    (r,) = _build(
        _ind(transform="SUM12_PCT_GDP"), hist
    ).rows  # denominator transforms: caller wires
    assert r.transformed_value is None
    assert r.transform_id == "SUM12_PCT_GDP"
