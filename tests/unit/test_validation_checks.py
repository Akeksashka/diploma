"""T24: every validation check with a pass and a fail fixture (AC-VAL-1), offline."""

from __future__ import annotations

import ast
import calendar
import inspect
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from macro_monitor.ingestion.base import ParseOutput, RejectedRow
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta
from macro_monitor.validation import checks, contracts
from macro_monitor.validation.checks import (
    CHECKS,
    CheckResult,
    RawFacts,
    Severity,
    Thresholds,
    decide,
)

pytestmark = pytest.mark.unit


def obs(
    ref: str = "S1",
    start: date = date(2024, 1, 1),
    end: date | None = None,
    value: str | None = "1.5",
    status: str = "OBS",
    flags: str | None = None,
) -> ParsedObservation:
    if end is None:
        end = _eom(start.year, start.month) if start.day == 1 else start
    return ParsedObservation(
        series_ref=ref,
        ref_period_start=start,
        ref_period_end=end,
        value=None if value is None else Decimal(value),
        value_status=status,  # type: ignore[arg-type]
        source_release_at=None,
        vintage_label=None,
        source_flags=flags,
    )


def meta(
    ref: str = "S1",
    entity: str = "DE",
    frequency: str = "M",
    unit: str = "PCT",
    sa: str = "NSA",
) -> ParsedSeriesMeta:
    return ParsedSeriesMeta(
        series_ref=ref,
        entity_code=entity,
        frequency=frequency,
        unit_code=unit,
        unit_mult=0,
        base_period=None,
        price_basis="NA",
        currency_code=None,
        seasonal_adjustment=sa,
        calendar_basis="CAL",
        title="t",
        flow_basis="NA",
        published_decimals=None,
    )


def _good_raw(**kw: object) -> RawFacts:
    base: dict[str, object] = {
        "http_status": 200,
        "body_len": 1000,
        "body_head": b"{}",
        "content_type": "application/json; charset=utf-8",
        "expected_content_types": frozenset({"application/json"}),
        "prev_byte_count": 1000,
        "sha256": "a" * 64,
        "storage_backend": "github_release",
        "storage_ref": "r/1",
        "blob_present": True,
        "robots_decision": "allowed",
    }
    base.update(kw)
    return RawFacts(**base)  # type: ignore[arg-type]


def test_registry_has_all_checks() -> None:
    expected = (
        [f"RAW-0{i}" for i in range(1, 8)]
        + [f"PARSE-0{i}" for i in range(1, 6)]
        + [f"META-0{i}" for i in range(1, 6)]
        + [f"SEM-0{i}" for i in range(1, 5)]
        + [f"ORD-0{i}" for i in range(1, 4)]  # load-order checks, raised by the loader (T26)
        + [f"REV-0{i}" for i in range(1, 8)]  # T29, T46, T48
        + [f"COMP-0{i}" for i in range(1, 5)]
        + ["DB-04", "DB-05"]
    )
    assert sorted(CHECKS) == sorted(expected)


def _by_id(results: list[CheckResult]) -> dict[str, CheckResult]:
    return {r.check_id: r for r in results}


def test_raw_all_pass() -> None:
    rs = checks.check_raw(_good_raw())
    assert [r.check_id for r in rs] == [f"RAW-0{i}" for i in range(1, 8)]
    assert all(r.passed and r.severity is Severity.INFO for r in rs)
    assert not decide(rs).blocked


@pytest.mark.parametrize(
    ("check_id", "kw", "severity"),
    [
        ("RAW-01", {"http_status": 500}, Severity.ERROR),
        ("RAW-02", {"body_len": 0}, Severity.ERROR),
        (
            "RAW-03",
            {"http_status": 403, "body_head": b"<html>Just a moment...</html>"},
            Severity.ERROR,
        ),
        ("RAW-04", {"content_type": "text/html"}, Severity.ERROR),
        ("RAW-05", {"body_len": 100}, Severity.WARN),
        ("RAW-06", {"sha256": "xyz"}, Severity.ERROR),
        ("RAW-07", {"robots_decision": "disallowed"}, Severity.ERROR),
    ],
)
def test_raw_fail(check_id: str, kw: dict[str, object], severity: Severity) -> None:
    r = _by_id(checks.check_raw(_good_raw(**kw)))[check_id]
    assert not r.passed
    assert r.severity is severity
    assert r.blocks is (severity is Severity.ERROR)


def test_raw_01_304_needs_validators() -> None:
    assert not checks.check_raw_01(_good_raw(http_status=304)).passed
    assert checks.check_raw_01(_good_raw(http_status=304, validators_sent=True)).passed


def test_raw_02_group_minimum() -> None:
    assert not checks.check_raw_02(_good_raw(body_len=50, min_bytes=100)).passed
    assert checks.check_raw_02(_good_raw(body_len=100, min_bytes=100)).passed


def test_raw_05_thresholds_recorded() -> None:
    t = Thresholds(size_ratio_low=0.9)
    r = checks.check_raw_05(_good_raw(body_len=800), t)
    assert not r.passed
    assert r.threshold == 0.9
    assert r.metric == pytest.approx(0.8)
    assert checks.check_raw_05(_good_raw(body_len=10, prev_byte_count=None)).passed


def test_raw_06_hash_only_needs_no_blob() -> None:
    ok = _good_raw(storage_backend="none", storage_ref=None, blob_present=False)
    assert checks.check_raw_06(ok).passed
    assert not checks.check_raw_06(_good_raw(blob_present=False)).passed


def test_raw_07_missing_decision_fails() -> None:
    assert not checks.check_raw_07(_good_raw(robots_decision=None)).passed


# --- PARSE ----------------------------------------------------------------------------


def _parse(
    observations: list[ParsedObservation],
    rejected: list[RejectedRow] | None = None,
    **kw: object,
) -> dict[str, CheckResult]:
    out = ParseOutput(observations=tuple(observations), rejected=tuple(rejected or []))
    return _by_id(checks.check_parse(out, **kw))  # type: ignore[arg-type]


def _eom(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def _years(n: int, ref: str = "S1") -> list[ParsedObservation]:
    return [obs(ref, date(1900 + i, 1, 1), None) for i in range(n)]


def _months(n: int, ref: str = "S1") -> list[ParsedObservation]:
    return [obs(ref, date(2024, m, 1), _eom(2024, m)) for m in range(1, n + 1)]


def test_parse_all_pass() -> None:
    rs = _parse(_months(6), frequencies={"S1": "M"})
    assert set(rs) == {f"PARSE-0{i}" for i in range(1, 6)}
    assert all(r.passed for r in rs.values())


def test_parse_01_missing_column() -> None:
    rep = contracts.validate_observation_rows([{"series_ref": "S1"}])
    assert {f.check_id for f in rep.failures} == {"PARSE-01"}
    assert rep.n_rows == 1


def test_parse_01_bad_series_ref_and_status() -> None:
    rows = contracts.observation_rows(_months(2))
    rows[0]["series_ref"] = " "
    rows[1]["value_status"] = "DEL"  # parsers never stage DEL
    rep = contracts.validate_observation_rows(rows)
    assert len(rep.for_check("PARSE-01")) == 2


def test_parse_02_period_does_not_match_frequency() -> None:
    bad = obs("S1", date(2024, 1, 1), date(2024, 3, 31))  # quarter-long for a monthly series
    rs = _parse([bad], frequencies={"S1": "M"})
    r = rs["PARSE-02"]
    assert not r.passed
    assert r.skipped_series == ("S1",)
    assert r.scope == "series"
    assert not r.blocks  # series error skips the series, not the object
    assert r.rejected[0].reason_code == "PARSE-02"


def test_parse_02_non_date_period() -> None:
    rows = contracts.observation_rows(_months(1))
    rows[0]["ref_period_start"] = "2024-01"
    rep = contracts.validate_observation_rows(rows)
    assert rep.for_check("PARSE-02")


def test_parse_03_non_numeric_value_is_rejected() -> None:
    rows = contracts.observation_rows(_months(1))
    rows[0]["value"] = "n/a"
    rep = contracts.validate_observation_rows(rows)
    f = rep.for_check("PARSE-03")
    assert f
    assert f[0].raw_value == "n/a"


def test_parse_03_parser_reject_carried_to_quarantine() -> None:
    rj = RejectedRow("S1", "2024-02", "n/a", "PARSE-03: not numeric and not a declared marker")
    rs = _parse(_years(99), [rj])
    assert not rs["PARSE-03"].passed
    assert rs["PARSE-03"].severity is Severity.WARN
    assert rs["PARSE-03"].rejected[0].raw_value == "n/a"
    assert not rs["PARSE-03"].blocks


def test_parse_03_miss_row_with_declared_marker_passes() -> None:
    """AC-VAL-13: ':' is a MISS row (value NULL, flag kept) and not a rejected row."""
    miss = obs("S1", date(2024, 2, 1), _eom(2024, 2), None, "MISS", ":")
    rs = _parse([*_months(1), miss], missing_markers=frozenset({":"}))
    assert rs["PARSE-03"].passed
    assert rs["PARSE-03"].detail["miss_rows"] == 1


def test_parse_03_miss_row_with_undeclared_marker_fails() -> None:
    miss = obs("S1", date(2024, 2, 1), _eom(2024, 2), None, "MISS", "n/a")
    rs = _parse([miss], missing_markers=frozenset({":"}))
    assert not rs["PARSE-03"].passed
    assert rs["PARSE-03"].rejected[0].reason_code == "PARSE-03"


def test_parse_03_miss_row_without_flag_fails() -> None:
    miss = obs("S1", date(2024, 2, 1), _eom(2024, 2), None, "MISS", None)
    assert not _parse([miss])["PARSE-03"].passed


def test_parse_04_duplicates() -> None:
    dup = [*_months(2), obs("S1", date(2024, 1, 1), _eom(2024, 1), "9")]
    r = _parse(dup)["PARSE-04"]
    assert not r.passed
    assert r.severity is Severity.ERROR
    assert r.blocks
    assert r.metric == 1.0


def test_parse_05_miss_rows_not_counted_as_rejected() -> None:
    """AC-VAL-13: 100 percent MISS rows still pass PARSE-05; one undeclared text is rejected."""
    misses = [obs("S1", date(2024, m, 1), _eom(2024, m), None, "MISS", ":") for m in range(1, 7)]
    rs = _parse(misses, missing_markers=frozenset({":"}))
    assert rs["PARSE-05"].passed
    assert rs["PARSE-05"].metric == 0.0
    rj = RejectedRow("S1", "2024-09", "n/a", "PARSE-03: undeclared text")
    rs2 = _parse(misses, [rj], missing_markers=frozenset({":"}))
    assert rs2["PARSE-05"].metric == pytest.approx(1 / 7)


@pytest.mark.parametrize(
    ("n_rejected", "severity"),
    [(0, Severity.INFO), (2, Severity.WARN), (10, Severity.ERROR)],
)
def test_parse_05_thresholds(n_rejected: int, severity: Severity) -> None:
    rj = [RejectedRow("S1", f"p{i}", "x", "PARSE-03: bad") for i in range(n_rejected)]
    r = _parse(_months(12) * 0 + [obs("S1", date(2000 + i, 1, 1), None) for i in range(88)], rj)[
        "PARSE-05"
    ]
    assert r.severity is severity
    assert r.passed is (severity is Severity.INFO)
    assert r.blocks is (severity is Severity.ERROR)


def test_parse_05_thresholds_are_overridable() -> None:
    rj = [RejectedRow("S1", "p", "x", "PARSE-03: bad")]
    t = Thresholds(parse_reject_warn=0.2, parse_reject_error=0.9)
    assert _parse(_months(2), rj, thresholds=t)["PARSE-05"].severity is Severity.WARN


def test_rejected_items_deduplicated() -> None:
    rj = RejectedRow("S1", "2024-02", "n/a", "PARSE-03: bad")
    rs = list(_parse(_months(3), [rj]).values())
    items = checks.rejected_items(rs + rs)
    assert len(items) == 1
    assert items[0].reason_code == "PARSE-03"


# --- META -----------------------------------------------------------------------------


def test_meta_01() -> None:
    assert checks.check_meta_01([meta()], frozenset({"PCT"})).passed
    bad = checks.check_meta_01([meta(), meta("S2", frequency="X")])
    assert not bad.passed
    assert bad.skipped_series == ("S2",)
    assert not bad.blocks
    assert not checks.check_meta_01([meta(unit="USD")], frozenset({"PCT"})).passed
    assert not checks.check_meta_01([meta(entity=" ")]).passed
    assert not checks.check_meta_01([meta(sa="??")]).passed


def test_meta_02_drift_proposals() -> None:
    expect = {"S1": {"unit_code": "PCT", "seasonal_adjustment": "SA"}}
    assert checks.check_meta_02([meta(sa="SA")], expect).passed
    r = checks.check_meta_02([meta(sa="NSA")], expect)
    assert not r.passed
    assert r.skipped_series == ("S1",)
    assert [(d.kind, d.old, d.new) for d in r.drifts] == [("seasonal_adjustment", "SA", "NSA")]
    assert checks.check_meta_02([meta("S9")], expect).passed  # no expectation, no finding


def test_meta_03() -> None:
    known = frozenset({"DE"})
    assert checks.check_meta_03([meta()], known).passed
    r = checks.check_meta_03([meta(entity="ZZ")], known)
    assert not r.passed
    assert r.skipped_series == ("S1",)


def test_meta_04() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    assert checks.check_meta_04(5, now, 10).passed
    for raw_id, known_at in ((None, now), (5, None)):
        r = checks.check_meta_04(raw_id, known_at, 10)
        assert not r.passed
        assert r.blocks
        assert r.metric == 10.0


@pytest.mark.parametrize(
    ("skew_s", "severity"),
    [
        (-3600, Severity.INFO),  # runner behind the database clock
        (60, Severity.INFO),  # boundary is not above
        (61, Severity.WARN),
        (120, Severity.WARN),  # AC-VAL-13: warns at a 2-minute skew
        (300, Severity.WARN),
        (301, Severity.ERROR),
        (360, Severity.ERROR),  # AC-VAL-13: errors at 6 minutes
    ],
)
def test_meta_05_thresholds_against_db_clock(skew_s: int, severity: Severity) -> None:
    db_now = datetime(2026, 11, 1, 6, 0, tzinfo=UTC)
    r = checks.check_meta_05(db_now + timedelta(seconds=skew_s), db_now)
    assert r.severity is severity
    assert r.passed is (severity is Severity.INFO)
    assert r.blocks is (severity is Severity.ERROR)
    assert r.metric == skew_s


# --- SEM ------------------------------------------------------------------------------


def test_sem_01_flags_out_of_bounds_as_suspect() -> None:
    rows = [obs("S1", date(2024, 1, 1), None, "5"), obs("S1", date(2024, 2, 1), None, "500")]
    bounds = {"S1": (Decimal(0), Decimal(100))}
    r = checks.check_sem_01(rows, bounds)
    assert not r.passed
    assert r.severity is Severity.WARN
    assert r.suspects == (("S1", date(2024, 2, 1)),)
    assert not r.blocks
    v = decide([r])
    assert not v.blocked
    assert v.suspects == {("S1", date(2024, 2, 1))}
    assert checks.check_sem_01(rows[:1], bounds).passed
    miss = obs("S1", date(2024, 3, 1), None, None, "MISS", ":")
    assert checks.check_sem_01([miss], bounds).passed


def _history(n: int = 40) -> list[tuple[date, Decimal]]:
    out = []
    for i in range(n):
        d = date(2020 + i // 12, i % 12 + 1, 1)
        out.append((d, Decimal(100 + (i * i * 3 + i) % 7)))  # bounded noise, MAD > 0
    return out


def test_sem_02_jump() -> None:
    hist = {"S1": _history()}
    nxt = date(2023, 5, 1)
    assert checks.check_sem_02([obs("S1", nxt, None, "101")], hist).passed
    r = checks.check_sem_02([obs("S1", nxt, None, "300")], hist)
    assert not r.passed
    assert r.severity is Severity.WARN
    assert r.suspects == (("S1", nxt),)
    assert r.threshold == 8.0


def test_sem_02_short_history_not_judged() -> None:
    hist = {"S1": _history(5)}
    assert checks.check_sem_02([obs("S1", date(2023, 5, 1), None, "9999")], hist).passed


def test_sem_03_unit_change() -> None:
    prev = {"S1": [Decimal(10), Decimal(12)]}
    assert checks.check_sem_03({"S1": [Decimal(11)]}, prev).passed
    r = checks.check_sem_03({"S1": [Decimal(11000)]}, prev)
    assert not r.passed
    assert r.skipped_series == ("S1",)
    assert r.drifts[0].kind == "unit"
    assert checks.check_sem_03({"S2": [Decimal(1)]}, prev).passed  # no previous vintage


def test_sem_04_new_gap() -> None:
    full = [date(2024, m, 1) for m in range(1, 7)]
    gappy = [d for d in full if d.month != 3]
    assert checks.check_sem_04({"S1": ("M", full)}, {}).passed
    r = checks.check_sem_04({"S1": ("M", gappy)}, {"S1": full})
    assert not r.passed
    assert r.severity is Severity.WARN
    assert r.metric == 1.0
    # a gap that already existed in the previous vintage is not new
    assert checks.check_sem_04({"S1": ("M", gappy)}, {"S1": gappy}).passed
    # a MISS row fills its period: the caller passes it in the period list
    assert checks.check_sem_04({"S1": ("M", full)}, {"S1": full}).passed


def test_sem_04_quarterly_and_daily() -> None:
    q = [date(2024, 1, 1), date(2024, 7, 1)]
    assert not checks.check_sem_04({"S1": ("Q", q)}, {}).passed
    assert checks.check_sem_04({"S1": ("D", [date(2024, 1, 1), date(2024, 2, 1)])}, {}).passed


# --- policy ---------------------------------------------------------------------------


def test_decide_error_blocks_warn_loads() -> None:
    warn = checks.check_raw_05(_good_raw(body_len=100))
    err = checks.check_raw_01(_good_raw(http_status=500))
    v_warn = decide([warn])
    assert not v_warn.blocked
    assert v_warn.warnings == ("RAW-05",)
    v_err = decide([warn, err])
    assert v_err.blocked
    assert v_err.blocking == ("RAW-01",)


def test_series_error_skips_series_without_blocking_object() -> None:
    r = checks.check_meta_03([meta(entity="ZZ")], frozenset({"DE"}))
    v = decide([r])
    assert not v.blocked
    assert v.skipped_series == {"S1"}
    assert v.warnings == ("META-03",)


def test_thresholds_as_dict_records_every_value() -> None:
    d = Thresholds().as_dict()
    assert d["clock_skew_warn_s"] == 60.0
    assert d["clock_skew_error_s"] == 300.0
    assert set(d) >= {"size_ratio_low", "parse_reject_error", "jump_robust_sd", "unit_factor"}


# --- AC-DEP-1: frames only in contracts.py, never returned -----------------------------

_SRC = Path(checks.__file__).parent


def test_only_contracts_imports_pandas() -> None:
    for path in _SRC.glob("*.py"):
        tree = ast.parse(path.read_text())
        mods = {
            n.module if isinstance(n, ast.ImportFrom) else a.name
            for n in ast.walk(tree)
            if isinstance(n, ast.Import | ast.ImportFrom)
            for a in (n.names if isinstance(n, ast.Import) else [n])
        }
        uses = any(str(m).split(".")[0] in ("pandas", "pandera") for m in mods if m)
        assert uses is (path.name == "contracts.py"), path.name


def test_public_signatures_never_expose_frames() -> None:
    for mod in (contracts, checks):
        for name, fn in inspect.getmembers(mod, inspect.isfunction):
            if name.startswith("_") or fn.__module__ != mod.__name__:
                continue
            sig = str(inspect.signature(fn))
            assert "DataFrame" not in sig, f"{mod.__name__}.{name}"
            assert "pd.Series" not in sig, f"{mod.__name__}.{name}"
            assert "pandas" not in sig, f"{mod.__name__}.{name}"


def test_contract_report_is_plain_data() -> None:
    rep = contracts.validate_observation_rows(contracts.observation_rows(_months(2)))
    assert isinstance(rep, contracts.ContractReport)
    assert rep.failures == ()
    assert rep.n_rows == 2


def test_empty_input_passes() -> None:
    assert contracts.validate_observation_rows([]).failures == ()
    assert contracts.validate_meta_rows([]).failures == ()


def test_contract_reports_one_failure_per_bad_row() -> None:
    bad = [obs("S1", date(2024, m, 1), date(2024, m, 28)) for m in (1, 2, 3)]  # not month ends
    rep = contracts.validate_observation_rows(
        contracts.observation_rows(bad), frequencies={"S1": "M"}
    )
    assert [f.row for f in rep.for_check("PARSE-02")] == [0, 1, 2]
