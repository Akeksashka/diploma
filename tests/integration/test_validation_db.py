"""T24 db tests: ops.validation_result writer, staging.rejected, all-or-nothing load gate."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING

import psycopg
import pytest

from macro_monitor.models.enums import QualityFlag
from macro_monitor.storage import migrate
from macro_monitor.validation import checks, quarantine
from macro_monitor.validation.checks import (
    CheckResult,
    RejectedItem,
    Severity,
    Thresholds,
)

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

RUN, RAW = 7, 11


@pytest.fixture
def conn(test_database: TestDatabase) -> psycopg.Connection:
    c = test_database.connect()
    migrate.migrate(c)
    c.commit()
    c.execute("CREATE TABLE public.load_probe (v int)")  # stands in for the load targets
    c.commit()
    return c


def _count(c: psycopg.Connection, sql: str, *args: object) -> int:
    row = c.execute(sql, list(args)).fetchone()  # type: ignore[arg-type]
    assert row is not None
    n: int = row[0]
    return n


def _ok() -> CheckResult:
    return CheckResult("RAW-01", Severity.INFO, True, metric=200.0)


def _blocking() -> CheckResult:
    return CheckResult("RAW-01", Severity.ERROR, False, metric=500.0)


def _load(c: psycopg.Connection) -> None:
    c.execute("INSERT INTO public.load_probe VALUES (1), (2)")


def test_validation_result_rows_and_thresholds_recorded(conn: psycopg.Connection) -> None:
    t = Thresholds(clock_skew_warn_s=30.0)
    skew = checks.check_meta_05(
        datetime(2026, 11, 1, 6, 1, 0, tzinfo=UTC), datetime(2026, 11, 1, 6, 0, tzinfo=UTC), t
    )
    n = quarantine.insert_results(conn, RUN, "S", [_ok(), skew])
    conn.commit()
    assert n == 2
    rows = conn.execute(
        "SELECT check_id, severity, passed, metric, threshold, source_id "
        "FROM ops.validation_result WHERE run_id = %s ORDER BY check_id",
        [RUN],
    ).fetchall()
    assert [r[0] for r in rows] == ["META-05", "RAW-01"]
    meta05 = rows[0]
    assert (meta05[1], meta05[2], float(meta05[3]), float(meta05[4]), meta05[5]) == (
        "warn",
        False,
        60.0,
        30.0,  # the overridden threshold of this run, not the default
        "S",
    )


def test_db_clock_drives_meta_05(conn: psycopg.Connection) -> None:
    db_now = quarantine.read_db_clock(conn)
    assert db_now.tzinfo is not None
    assert checks.check_meta_05(db_now + timedelta(seconds=120), db_now).severity is Severity.WARN
    assert checks.check_meta_05(db_now + timedelta(seconds=360), db_now).severity is Severity.ERROR
    assert checks.check_meta_05(db_now - timedelta(seconds=360), db_now).passed


def test_rejected_rows_quarantined_and_idempotent(conn: psycopg.Connection) -> None:
    items = [
        RejectedItem("S1", "2024-02", "n/a", "PARSE-03", "undeclared text"),
        RejectedItem("S1", None, None, "PARSE-02", "bad period"),
    ]
    assert quarantine.insert_rejected(conn, RUN, RAW, items) == 2
    assert quarantine.insert_rejected(conn, RUN, RAW, items) == 0  # retry adds nothing
    conn.commit()
    row = conn.execute(
        "SELECT series_ref, ref_period, raw_value, reason_code, detail "
        "FROM staging.rejected WHERE reason_code = 'PARSE-03'"
    ).fetchone()
    assert row == ("S1", "2024-02", "n/a", "PARSE-03", "undeclared text")
    assert _count(conn, "SELECT count(*) FROM staging.rejected") == 2


def test_passing_object_is_loaded(conn: psycopg.Connection) -> None:
    out = quarantine.load_gated(
        conn, run_id=RUN, source_id="S", raw_id=RAW, results=[_ok()], load=_load
    )
    assert out.loaded
    assert _count(conn, "SELECT count(*) FROM public.load_probe") == 2


def test_pre_load_error_leaves_no_load_but_keeps_findings(conn: psycopg.Connection) -> None:
    """AC-VAL-6: an error result blocks the object; rejected rows and the result stay."""
    calls: list[int] = []
    rj = CheckResult(
        "PARSE-03",
        Severity.WARN,
        False,
        rejected=(RejectedItem("S1", "p", "x", "PARSE-03", "bad"),),
    )

    def load(c: psycopg.Connection) -> None:
        calls.append(1)
        _load(c)

    out = quarantine.load_gated(
        conn, run_id=RUN, source_id="S", raw_id=RAW, results=[_blocking(), rj], load=load
    )
    assert not out.loaded
    assert out.verdict.blocking == ("RAW-01",)
    assert calls == []
    assert _count(conn, "SELECT count(*) FROM public.load_probe") == 0
    assert _count(conn, "SELECT count(*) FROM ops.validation_result WHERE severity = 'error'") == 1
    assert _count(conn, "SELECT count(*) FROM staging.rejected") == 1


def test_post_load_error_rolls_back_whole_load(conn: psycopg.Connection) -> None:
    def post(_c: psycopg.Connection) -> list[CheckResult]:
        return [CheckResult("META-04", Severity.ERROR, False, metric=2.0)]

    out = quarantine.load_gated(
        conn,
        run_id=RUN,
        source_id="S",
        raw_id=RAW,
        results=[_ok()],
        load=_load,
        post_checks=post,
    )
    assert not out.loaded
    assert out.verdict.blocking == ("META-04",)
    assert _count(conn, "SELECT count(*) FROM public.load_probe") == 0  # no partial load
    assert (
        _count(conn, "SELECT count(*) FROM ops.validation_result WHERE check_id = 'META-04'") == 1
    )


def test_load_exception_rolls_back_partial_load(conn: psycopg.Connection) -> None:
    def broken(c: psycopg.Connection) -> None:
        _load(c)
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        quarantine.load_gated(
            conn, run_id=RUN, source_id="S", raw_id=RAW, results=[_ok()], load=broken
        )
    assert _count(conn, "SELECT count(*) FROM public.load_probe") == 0
    assert _count(conn, "SELECT count(*) FROM ops.validation_result WHERE run_id = %s", RUN) == 1


def test_warn_result_still_loads(conn: psycopg.Connection) -> None:
    warn = CheckResult("RAW-05", Severity.WARN, False, metric=0.1, threshold=0.5)
    out = quarantine.load_gated(
        conn, run_id=RUN, source_id="S", raw_id=RAW, results=[warn], load=_load
    )
    assert out.loaded
    assert out.verdict.warnings == ("RAW-05",)


def test_series_error_does_not_block_object(conn: psycopg.Connection) -> None:
    r = checks.check_meta_03([_meta_stub()], frozenset({"DE"}))
    out = quarantine.load_gated(
        conn, run_id=RUN, source_id="S", raw_id=RAW, results=[r], load=_load
    )
    assert out.loaded
    assert out.verdict.skipped_series == {"S1"}


def test_load_gated_requires_idle_connection(conn: psycopg.Connection) -> None:
    conn.execute("SELECT 1")
    with pytest.raises(RuntimeError, match="open transaction"):
        quarantine.load_gated(
            conn, run_id=RUN, source_id="S", raw_id=RAW, results=[_ok()], load=_load
        )
    conn.rollback()


def test_suspect_rows_flagged() -> None:  # pure, kept with the gate tests
    r = CheckResult("SEM-01", Severity.WARN, False, suspects=(("S1", date(2024, 2, 1)),))
    flags = quarantine.quality_flags(checks.decide([r]))
    assert flags == {("S1", date(2024, 2, 1)): QualityFlag.SUSPECT}


def _meta_stub() -> object:
    from macro_monitor.models.types import ParsedSeriesMeta

    return ParsedSeriesMeta(
        "S1", "XX", "M", "PCT", 0, None, "NA", None, "NSA", "CAL", "t", "NA", None
    )
