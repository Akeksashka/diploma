# ruff: noqa: PT018, E501
"""T67 unit tests: COV-01 (AC-VAL-9) and MON-NMAR pure functions."""

from __future__ import annotations

from datetime import date, timedelta

from macro_monitor.monitoring import coverage as c

END = date(2026, 1, 31)


def _inputs(n_stale: int, n_ok: int, kind: str = "new_period") -> list[c.ArrivalInput]:
    out = []
    for k in range(n_stale + n_ok):
        lag = 100 if k < n_stale else 10
        out.append(c.ArrivalInput("I", f"E{k}", END, END + timedelta(days=lag), kind))
    return out


def test_ac_val_9a_warn_at_30_percent() -> None:
    r = c.cov_evaluate("I", _inputs(6, 14), 45)
    assert (r.state, r.n_qualifying, r.share, r.warn) == ("measured", 20, 0.3, True)


def test_ac_val_9a_no_warn_at_20_percent() -> None:
    r = c.cov_evaluate("I", _inputs(4, 16), 45)
    assert r.share == 0.2 and not r.warn


def test_ac_val_9b_all_initial() -> None:
    r = c.cov_evaluate("I", _inputs(20, 0, "initial"), 45)
    assert (r.state, r.n_qualifying, r.n_with_value, r.warn) == ("not_yet_measurable", 0, 20, False)


def test_ac_val_9c_mixed() -> None:
    items = _inputs(15, 0, "initial") + [
        c.ArrivalInput("I", f"N{k}", END, END + timedelta(days=100), "new_period") for k in range(5)
    ]
    r = c.cov_evaluate("I", items, 45, cov_min_entities=10)
    assert (r.state, r.n_qualifying, r.warn, r.share) == ("not_yet_measurable", 5, False, None)


def test_ac_val_9d_limits_unchanged() -> None:
    assert dict(c.STALENESS_LIMITS) == {
        "MKT45": 45, "SURV75": 75, "ACT120": 120, "Q270": 270, "A730": 730, "TRI1460": 1460, "EVENT": 730,
    }  # fmt: skip


def test_nmar() -> None:
    pairs = (
        [("advanced", False)] * 8
        + [("advanced", True)] * 2
        + [("emerging", True)] * 5
        + [("emerging", False)] * 5
    )
    r = c.nmar_evaluate("D", pairs)
    assert r.unavailable_share == {"advanced": 0.2, "emerging": 0.5}
    assert r.warn
    assert not c.nmar_evaluate("D", [("advanced", True), ("emerging", True)]).warn
    assert c.nmar_evaluate("D", [("advanced", True)]).difference_pp is None
