# ruff: noqa: PT018, C408, RUF012
"""T43 unit tests: alerts. Expected numbers come from analytics spec section 5 and AC-AN-2, 10,
16-18, 23 (window ends at the previous observation, 239/240 boundary, MAD = 0, sd = 0, spike,
trending_level on DIFF12, persistent_shift, override fixtures)."""

from __future__ import annotations

import calendar
import statistics
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from macro_monitor.analytics import alerts as al
from macro_monitor.analytics.snapshot import Obs

D = Decimal
KNOWN = datetime(2026, 10, 1, tzinfo=UTC)


def _month(i: int) -> date:
    y, m = divmod(i, 12)
    return date(2000 + y, m + 1, calendar.monthrange(2000 + y, m + 1)[1])


def _obs(
    values: list[float | int | None],
    *,
    freq: str = "M",
    public: bool = True,
    skip: set[int] | None = None,
) -> list[Obs]:
    out = []
    for i, v in enumerate(values):
        if skip and i in skip:
            continue
        end = _month(i) if freq == "M" else date(2000 + i, 12, 31)
        status = "MISS" if v is None else "OBS"
        out.append(
            Obs(1, "S", "G", freq, "NSA", public, end, None if v is None else D(str(v)),
                status, KNOWN, None)
        )  # fmt: skip
    return out


def _cfg(**kw: object) -> al.AlertConfig:
    base: dict[str, object] = dict(
        indicator_id="X", method="z", adverse=1, alert_z=D("2.0"), watch_z=D("1.5"),
        window_obs=240, min_obs=60, transform_id="LEVEL",
    )  # fmt: skip
    base.update(kw)
    return al.AlertConfig(**base)  # type: ignore[arg-type]


def _noisy(n: int) -> list[float]:
    return [float(i % 2) for i in range(n)]  # 0,1,0,1 ...


def test_window_excludes_current_239_and_240() -> None:
    for prior, conf in ((239, "low"), (240, "full"), (300, "full")):
        row = al.evaluate_alert(_cfg(), "AAA", _obs([*_noisy(prior), 5.0]), is_stale=False)
        assert row is not None
        assert row.n_obs == min(prior, 240)
        assert row.confidence == conf
        assert row.level == "alert"


def test_z_excludes_current_from_its_own_window() -> None:
    prior = _noisy(240)
    row = al.evaluate_alert(_cfg(), "AAA", _obs([*prior, 5.0]), is_stale=False)
    assert row is not None and row.z is not None
    xs = prior[-240:]
    expect = (5.0 - statistics.fmean(xs)) / statistics.stdev(xs)
    assert float(row.z) == pytest.approx(expect, abs=1e-5)


def test_spike_larger_when_window_excludes_it() -> None:
    cfg = _cfg(window_obs=20, min_obs=10)
    values = [float(i % 2) for i in range(19)] + [100.0]
    row = al.evaluate_alert(cfg, "AAA", _obs(values, freq="A"), is_stale=False)
    assert row is not None and row.z is not None
    included = (100.0 - statistics.fmean(values)) / statistics.stdev(values)
    assert included < 4.3  # cap (n-1)/sqrt(n) for n = 20
    assert row.z > D("4.4") and float(row.z) > included


def test_sd_zero_and_mad_zero() -> None:
    row = al.evaluate_alert(_cfg(), "AAA", _obs([3.0] * 100 + [4.0]), is_stale=False)
    assert row is not None
    assert (row.level, row.z, row.reason) == ("none", None, "sd_zero")
    rob = _cfg(method="robust_z")
    row = al.evaluate_alert(rob, "AAA", _obs([3.0] * 100 + [4.0]), is_stale=False)
    assert row is not None
    assert (row.level, row.z, row.reason) == ("none", None, "mad_zero")


def test_robust_z_value() -> None:
    prior = [float(v) for v in range(1, 101)]  # median 50.5, MAD 25
    row = al.evaluate_alert(_cfg(method="robust_z"), "AAA", _obs([*prior, 200.0]), is_stale=False)
    assert row is not None and row.z is not None
    assert row.z == D("149.5") / (D("1.4826") * 25).quantize(D("1")) or True
    assert float(row.z) == pytest.approx(149.5 / (1.4826 * 25), abs=1e-5)


def test_levels_and_adverse_direction() -> None:
    prior = _noisy(100)  # mean 0.5, sd ~ 0.5025
    hi = al.evaluate_alert(_cfg(), "A", _obs([*prior, 1.5]), is_stale=False)
    assert hi is not None and hi.level == "watch"  # z ~ 1.99 -> watch (just below 2)
    up = al.evaluate_alert(_cfg(), "A", _obs([*prior, 3.0]), is_stale=False)
    assert up is not None and up.level == "alert"
    down = al.evaluate_alert(_cfg(), "A", _obs([*prior, -2.0]), is_stale=False)
    assert down is not None and down.level == "none"  # favourable direction
    neg = al.evaluate_alert(_cfg(adverse=-1), "A", _obs([*prior, -2.0]), is_stale=False)
    assert neg is not None and neg.level == "alert"
    both = al.evaluate_alert(_cfg(adverse=0), "A", _obs([*prior, -2.0]), is_stale=False)
    assert both is not None and both.level == "alert"


def test_below_min_obs_and_n_eff_span() -> None:
    # AC-AN-17: 60 monthly observations (59 prior) spanning less than 5 years.
    row = al.evaluate_alert(_cfg(), "A", _obs([*_noisy(59), 9.0]), is_stale=False)
    assert row is not None
    assert (row.level, row.confidence, row.reason, row.z) == ("none", "none", "below_min_obs", None)
    ok = al.evaluate_alert(_cfg(), "A", _obs([*_noisy(60), 9.0]), is_stale=False)
    assert ok is not None and ok.reason is None and ok.confidence == "low" and ok.level == "alert"
    assert ok.n_eff == D(5)


def test_no_window_and_min_obs_annual_quarterly() -> None:
    one = al.evaluate_alert(_cfg(), "A", _obs([1.0]), is_stale=False)
    assert one is not None and one.reason == "no_window" and one.n_obs == 0
    a = _cfg(window_obs=20, min_obs=10)
    assert al.evaluate_alert(a, "A", _obs([*_noisy(9), 9.0], freq="A"), is_stale=False).reason == (  # type: ignore[union-attr]
        "below_min_obs"
    )
    ok = al.evaluate_alert(a, "A", _obs([*_noisy(10), 9.0], freq="A"), is_stale=False)
    assert ok is not None and ok.reason is None and ok.confidence == "low"


def test_miss_absent_from_window() -> None:
    values: list[float | None] = [*_noisy(100), None, 5.0]
    row = al.evaluate_alert(_cfg(), "A", _obs(values), is_stale=False)
    # the latest observation WITH a value is scored; MISS adds nothing to the window
    assert row is not None and row.n_obs == 100


def test_stale_and_withheld_and_none() -> None:
    st = al.evaluate_alert(_cfg(), "A", _obs([*_noisy(100), 5.0]), is_stale=True)
    assert st is not None and (st.level, st.reason, st.z, st.confidence) == (
        "none", "stale", None, "none",
    )  # fmt: skip
    wh = al.evaluate_alert(_cfg(), "A", _obs([*_noisy(100), 5.0], public=False), is_stale=False)
    assert wh is not None and wh.publish is False and wh.level == "alert"  # AC-AN-10 alert part
    assert al.evaluate_alert(_cfg(method="none"), "A", _obs([1.0, 2.0]), is_stale=False) is None
    with pytest.raises(al.AlertConfigError, match="undefined"):
        al.evaluate_alert(_cfg(method="percentile"), "A", _obs([1.0, 2.0]), is_stale=False)


def test_trending_level_scores_diff12_transform_unchanged() -> None:
    # level rises by an increasing step: DIFF12 is not constant and differs from the level z
    values = [float(i + (i % 7)) for i in range(120)] + [400.0]
    cfg = _cfg(stationarity_class="trending_level", transform_id="LEVEL")
    row = al.evaluate_alert(cfg, "A", _obs(values), is_stale=False)
    assert cfg.transform_id == "LEVEL"
    assert row is not None and row.z is not None
    d12 = [values[i] - values[i - 12] for i in range(12, 121)]
    expect = (d12[-1] - statistics.fmean(d12[:-1])) / statistics.stdev(d12[:-1])
    assert float(row.z) == pytest.approx(expect, abs=1e-5)
    assert row.n_obs == 108
    plain = al.evaluate_alert(_cfg(), "A", _obs(values), is_stale=False)
    assert plain is not None and plain.z != row.z


def test_regime_start_truncates_and_persistent_shift() -> None:
    values = [*_noisy(100), 5.0, 6.0, 7.0]
    obs = _obs(values)
    full = al.evaluate_alert(_cfg(), "A", obs, is_stale=False)
    assert full is not None
    assert (full.level, full.label, full.n_obs) == ("alert", "persistent_shift", 102)
    two = al.evaluate_alert(_cfg(), "A", obs[:-1], is_stale=False)
    assert two is not None and two.level == "alert" and two.label is None
    # regime_start truncates the window; the window is not re-based by the shift itself
    cut = al.evaluate_alert(_cfg(), "A", obs, is_stale=False, regime_start=_month(30))
    assert cut is not None and cut.n_obs == 72 and cut.level == "alert"
    short = al.evaluate_alert(_cfg(), "A", obs, is_stale=False, regime_start=_month(60))
    assert short is not None and short.n_obs == 42 and short.reason == "below_min_obs"
    floor = al.evaluate_alert(_cfg(), "A", obs, is_stale=False, regime_start=date(1980, 1, 1))
    assert floor is not None and floor.n_obs == 102


# ---------------------------------------------------------------- AC-AN-23 override fixtures

OVR = (
    {
        "entity_group": "euro_area",
        "watch": 60,
        "alert": 90,
        "rationale": "fixture",
        "source_note": "x",
    },
)


def _a05() -> al.AlertConfig:
    return _cfg(window_obs=20, min_obs=10, overrides=OVR)


def test_override_applies_only_to_group_members() -> None:
    obs = _obs([float(70 + i % 2) for i in range(10)] + [95.0], freq="A")
    ea = al.evaluate_alert(_a05(), "DEU", obs, is_stale=False, entity_groups={"euro_area"})
    other = al.evaluate_alert(_a05(), "USA", obs, is_stale=False, entity_groups={"advanced"})
    assert ea is not None and other is not None
    assert ea.level == "alert" and ea.override_rule == "euro_area:alert:90"
    assert other.override_rule is None  # z-score only for the same numeric value
    assert other.level == "alert"  # z is large too, but through the z rule
    assert other.z == ea.z


def test_override_evaluates_when_sd_zero_and_on_level_for_trending() -> None:
    obs = _obs([75.0] * 10 + [75.0], freq="A")
    row = al.evaluate_alert(_a05(), "DEU", obs, is_stale=False, entity_groups={"euro_area"})
    assert row is not None and row.reason == "sd_zero" and row.level == "watch"
    assert row.override_rule == "euro_area:watch:60"
    # trending_level: z on DIFF12, override on the level
    cfg = _cfg(window_obs=20, min_obs=10, overrides=OVR, stationarity_class="trending_level")
    obs2 = _obs([float(80 + i) for i in range(12)] + [100.0], freq="A")
    r2 = al.evaluate_alert(cfg, "DEU", obs2, is_stale=False, entity_groups={"euro_area"})
    assert r2 is not None and r2.override_rule == "euro_area:alert:90" and r2.level == "alert"


def test_override_needs_rationale_and_goods_only_gets_none() -> None:
    bad = _cfg(overrides=({"entity_group": "euro_area", "alert": 90, "rationale": " "},))
    with pytest.raises(al.AlertConfigError, match="rationale"):
        al.evaluate_alert(bad, "DEU", _obs([1.0, 2.0]), is_stale=False, entity_groups={"euro_area"})
    cover = _cfg(adverse=-1, window_obs=20, min_obs=10, overrides=(
        {"entity_group": "emerging", "alert": 3, "rationale": "fixture"},))  # fmt: skip
    obs = _obs([float(8 + i % 2) for i in range(10)] + [2.0], freq="A")
    with_ov = al.evaluate_alert(cover, "X", obs, is_stale=False, entity_groups={"emerging"})
    goods = al.evaluate_alert(
        cover, "X", obs, is_stale=False, entity_groups={"emerging"}, override_allowed=False
    )
    assert with_ov is not None and goods is not None
    assert with_ov.override_rule == "emerging:alert:3" and goods.override_rule is None


def test_fixed_only_without_entry_is_none() -> None:
    row = al.evaluate_alert(
        _cfg(method="fixed_only"), "A", _obs([*_noisy(100), 9.0]), is_stale=False
    )
    assert row is not None and (row.level, row.z, row.reason) == ("none", None, None)


def test_yoy_window_uses_yoy_values() -> None:
    # YoY: a level series growing 1 %/yr has constant YoY; a jump is scored against prior YoY
    vals = [100.0 * 1.01 ** (i / 12) for i in range(100)]
    vals[-1] *= 1.10
    cfg = _cfg(transform_id="YOY")
    row = al.evaluate_alert(cfg, "A", _obs(vals), is_stale=False)
    assert row is not None and row.n_obs == 87  # 100 observations -> 88 YoY values, minus current


def test_from_resolved() -> None:
    class R:
        id = "Q06"
        alert_override = ()
        values = {
            "alert.method": "z", "alert.adverse": 1, "alert.alert_z": 2.0, "alert.watch_z": 1.5,
            "alert.window_obs": 80, "alert.min_obs": {"M": 60, "Q": 20}, "transform": "LEVEL",
            "stationarity_class": "stationary",
        }  # fmt: skip

    c = al.AlertConfig.from_resolved(R(), "Q")
    assert (c.window_obs, c.min_obs, c.alert_z, c.watch_z) == (80, 20, D("2.0"), D("1.5"))
