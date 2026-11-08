# ruff: noqa: PT018
"""T44 unit tests: multi-input transform wiring, alert config, backtest label, reproduction."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from macro_monitor.analytics import alerts, run, runctx
from macro_monitor.analytics.snapshot import Obs

T0 = datetime(2026, 1, 1, tzinfo=UTC)
OPT = run.AnalyzeOptions(
    ingest_run_id=1, as_of_run_date=date(2026, 10, 15), code_version="c", git_sha="g",
    config_asof=T0, config_sha256="c", mapping_sha256="m", overrides_sha256="o",
)  # fmt: skip


def mobs(sid: int, vals: list[str | None], start: int = 1, freq: str = "M") -> list[Obs]:
    out = []
    for i, v in enumerate(vals):
        m = start + i
        y, mo = 2026 + (m - 1) // 12, (m - 1) % 12 + 1
        end = date(y + (mo == 12), mo % 12 + 1, 1)
        end = date.fromordinal(end.toordinal() - 1)
        out.append(Obs(sid, "S", "G", freq, "NA", True, end, None if v is None else Decimal(v),
                       "OBS" if v else "MISS", T0, None))  # fmt: skip
    return out


def test_backtest_label_refuses_initial_and_import() -> None:
    assert run.backtest_label(["initial"]) == "revised-data"
    assert run.backtest_label(["new_period", "revision"]) == "revised-data"
    assert run.backtest_label(["new_period"], claim_real_time=True) == "real-time"
    for kind in ("initial", "import"):
        with pytest.raises(run.RealTimeRefused):
            run.backtest_label(["revision", kind], claim_real_time=True)


def test_spread_vs_ref_wiring() -> None:
    hist = {("M18", "FRA"): mobs(1, ["5", "6"]), ("M18", "DEU"): mobs(2, ["2", "3"])}
    opt = run.AnalyzeOptions(**{**OPT.__dict__, "spread_reference": {("M18", "FRA"): "DEU"}})
    w: list[str] = []
    d = run.derive_series("SPREAD_VS_REF", "M18", "FRA", "FRA", hist, [], {}, opt, {}, w)
    assert d is not None and [p.value for p in d.points] == [Decimal(3), Decimal(3)]
    d = run.derive_series("SPREAD_VS_REF", "M18", "DEU", "DEU", hist, [], {}, opt, {}, w)
    assert d is None and "without spread_reference" in w[-1]
    opt2 = run.AnalyzeOptions(**{**OPT.__dict__, "spread_reference": {("M18", "DEU"): "DEU"}})
    d = run.derive_series("SPREAD_VS_REF", "M18", "DEU", "DEU", hist, [], {}, opt2, {}, w)
    assert d is not None and all(p.value is None for p in d.points)  # benchmark: no spread


def test_real_rate_miss_is_absent_not_zero() -> None:
    core = mobs(2, [str(100 + i) for i in range(14)])  # index: YoY from month 13
    pol = mobs(1, ["4"] * 14)
    hist = {("R", "X"): pol, ("X05", "X"): core}
    inp = [run.InputDef("X05", "core_inflation_yoy", "numerator")]
    d = run.derive_series("REAL_RATE", "R", "X", "X", hist, inp, {}, OPT, {}, [])
    assert d is not None
    vals = [p.value for p in d.points]
    assert vals[:12] == [None] * 12 and vals[12] is not None and vals[13] is not None
    hist[("X05", "X")][-1:] = mobs(2, [None], start=14)
    d = run.derive_series("REAL_RATE", "R", "X", "X", hist, inp, {}, OPT, {}, [])
    assert d is not None and d.points[-1].value is None


def test_reserve_cover_goods_only_disables_override() -> None:
    res = mobs(1, ["120"])
    imp = mobs(2, ["10"] * 12)
    # series attributes: USD, PERIOD_FLOW
    attrs = {
        1: run.SeriesAttr("STOCK", "USD", "CAL"),
        2: run.SeriesAttr("PERIOD_FLOW", "USD", "CAL"),
    }
    # monthly window ends at the reserves month only when the 12 months align: reserves at Dec
    res = [replace_period(res[0], date(2026, 12, 31))]
    hist = {("M14", "X"): res, ("X03", "X"): imp}
    for usage, allowed in (("imports_goods_only_usd", False), ("imports_goods_services_usd", True)):
        inp = [run.InputDef("X03", usage, "usd")]
        d = run.derive_series("RESERVE_COVER", "M14", "X", "X", hist, inp, attrs, OPT, {}, [])
        assert d is not None and d.override_allowed is allowed
        assert d.points[0].value == Decimal(12)  # 120 / (120/12)


def replace_period(o: Obs, end: date) -> Obs:
    from dataclasses import replace

    return replace(o, ref_period_end=end)


def test_sum12_fails_closed_without_denominator() -> None:
    attrs = {1: run.SeriesAttr("PERIOD_FLOW", "EUR", "CAL")}
    hist = {("M09", "X"): mobs(1, ["1"] * 12)}
    inp = [run.InputDef("X01", "denominator_gdp_lcu", "numerator")]
    d = run.derive_series("SUM12_PCT_GDP", "M09", "X", "X", hist, inp, attrs, OPT, {}, [])
    assert d is not None and d.points[-1].value is None and d.reason_at_latest == "missing_or_stale"


def test_alert_config_from_params() -> None:
    c = {"method": "z", "adverse": 1, "transform": "LEVEL", "stationarity": "stationary",
         "overrides": [], "params": {"alert_z": 3, "watch_z": 2, "window_obs": {"M": 240, "Q": 80},
                                      "min_obs": 60}}  # fmt: skip
    cfg = run._alert_config("U1", c, "Q")
    assert (cfg.window_obs, cfg.min_obs, cfg.alert_z) == (80, 60, Decimal(3))
    c["params"] = {"watch_z": 2}
    with pytest.raises(alerts.AlertConfigError):
        run._alert_config("U1", c, "M")


def test_check_reproduction_reports_mismatch() -> None:
    rec = runctx.RunRecord(1, T0, T0, 1, date(2026, 1, 1), "c", "g", T0, "c", "m", "o")
    cur = {"git_sha": "g", "config_sha256": "X", "mapping_sha256": "m"}
    got = runctx.compare_hashes(rec, cur)
    assert {m.field for m in got} == {"config_sha256", "overrides_sha256"}


def test_cli_analyze_parser_allow_lists() -> None:
    from macro_monitor import cli

    a = cli.build_parser().parse_args(["analyze", "--ingest-run-id", "7", "--as-of", "2026-10-15"])
    assert (a.ingest_run_id, a.as_of) == (7, date(2026, 10, 15))
    for bad in (["--as-of", "2026-13-01"], ["--as-of", "x; rm"], ["--ingest-run-id", "-1"]):
        with pytest.raises(SystemExit) as e:
            cli.build_parser().parse_args(["analyze", *bad])
        assert e.value.code == cli.EXIT_CONFIG_ERROR
