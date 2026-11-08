# ruff: noqa: E501, PT018
"""T84 db tests: ``series/*.parquet`` exported by a real ``mm_reader`` session from a database filled
by the production analytics run (AC-EXP-3 series clause, AC-EXP-7 value_default_tf clause,
AC-EXP-8, EXP-02, EXP-04, EXP-08)."""

from __future__ import annotations

import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import pyarrow.parquet as pq
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "analytics"))
import builder as b

from macro_monitor.analytics import run
from macro_monitor.publish import export as ex
from macro_monitor.publish import series
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

T = 120
GEN = datetime(2026, 11, 1, 6, 5, tzinfo=UTC)
MONTHS = b.months(date(1990, 10, 1), 40)  # starts before 1991-01-01


def level(base: int, miss_at: int | None = None) -> tuple[b.Obs, ...]:
    return tuple(
        b.Obs(
            p, None if i == miss_at else str(base + i), 5, status="MISS" if i == miss_at else "OBS"
        )
        for i, p in enumerate(MONTHS)
    )


def scenario() -> b.Scenario:
    s = [
        b.Series("U1.DEU", "DEU", "U1", level(100, miss_at=20)),
        b.Series("U1.FRA", "FRA", "U1", level(200)),
        b.Series("U2.DEU", "DEU", "U2", level(50)),
        b.Series("W.DEU", "DEU", "U3", level(70), source="W"),  # withheld source
        b.Series("X.DEU", "DEU", "X01", level(7)),
        b.Series("M13.DEU", "DEU", "M13", level(9)),
    ]
    # PROJ row, an import row and a revision on U2.DEU
    s[2] = b.Series(
        "U2.DEU", "DEU", "U2",
        (
            *level(50),
            b.Obs(MONTHS[3], "999", 9, kind="revision"),
            b.Obs(date(2030, 1, 1), "123", 5, status="PROJ"),
            b.Obs(MONTHS[4], "888", 4, kind="import"),
        ),
    )  # fmt: skip
    return b.Scenario(
        name="export_t84",
        sources=(b.Source("S"), b.Source("W", publish_site="withheld")),
        groups=(b.Group("S", "G"), b.Group("W", "G")),
        entities=("DEU", "FRA"),
        indicators=(
            *(b.Indicator(i) for i in ("U1", "U2", "U3", "M13")),
            b.Indicator("X01", good_dir=0, rank_mode="descriptive_only", kind="input"),
        ),
        series=tuple(s),
    )


@pytest.fixture
def db(test_database: TestDatabase) -> TestDatabase:
    admin = test_database.connect(timeout=T)
    migrate.migrate(admin)
    b.seed(admin, scenario())
    admin.execute("UPDATE ref.indicator SET transform_id='YOY' WHERE indicator_id='U1'")
    admin.execute("UPDATE ref.indicator SET transform_id='SUM12_PCT_GDP' WHERE indicator_id='M13'")
    admin.execute(
        "UPDATE ref.indicator SET params = %s::jsonb",
        ['{"alert_z": 3, "watch_z": 2, "window_obs": 60, "min_obs": 5}'],
    )
    admin.commit()
    ing = int(admin.execute("SELECT max(run_id) FROM ingest.run").fetchone()[0])  # type: ignore[index]
    ana = test_database.connect("mm_analytics", timeout=T)
    run.analyze(
        ana,
        run.AnalyzeOptions(
            ingest_run_id=ing, as_of_run_date=date(2026, 10, 15), code_version="t", git_sha="abc1234",
            config_asof=datetime.now(UTC), config_sha256="c", mapping_sha256="m", overrides_sha256="o",
        ),
    )  # fmt: skip
    ana.close()
    admin.close()
    return test_database


def export(db: TestDatabase, out: Path) -> ex.ExportResult:
    with db.connect("mm_reader", timeout=T) as rd:
        ing = int(
            rd.execute("SELECT max(ingest_run_id) FROM analytics.v_run_published").fetchone()[0]
        )  # type: ignore[index]
        rd.rollback()
        return ex.run_export(rd, ing, out, [series.series_producer], now=lambda: GEN)


def test_series_files(db: TestDatabase, tmp_path: Path) -> None:
    res = export(db, tmp_path / "a")
    assert res.status == "ok"
    paths = sorted(f.path for f in res.files if f.path.startswith("series/"))
    # no file for the withheld-only indicator U3 or the input X01
    assert paths == ["series/M13.parquet", "series/U1.parquet", "series/U2.parquet"]
    t1 = pq.read_table(tmp_path / "a/data/series/U1.parquet").to_pylist()
    assert all(r["ref_period_start"] >= date(1991, 1, 1) for r in t1)  # 1991-01-01 start
    assert [r["entity_id"] for r in t1] == sorted(r["entity_id"] for r in t1)
    deu = {r["ref_period_start"]: r for r in t1 if r["entity_id"] == "DEU"}
    fra = {r["ref_period_start"]: r for r in t1 if r["entity_id"] == "FRA"}
    # AC-EXP-8: MISS is null with value_status MISS, never zero
    miss = deu[MONTHS[20]]
    assert miss["value"] is None and miss["value_status"] == "MISS"
    assert not any(r["value"] == 0 for r in t1)
    # default transform = YOY through the shared code: 100 * (v / v_12 - 1) with independent arithmetic
    p = MONTHS[30]
    assert fra[p]["value"] == 230.0
    assert fra[p]["value_default_tf"] == pytest.approx(100 * (230 / 218 - 1))
    assert fra[p]["value_yoy"] == fra[p]["value_default_tf"]
    assert fra[MONTHS[5]]["value_default_tf"] is None  # first year: no base
    assert deu[MONTHS[32]]["value_default_tf"] is None  # base period is MISS
    # AC-EXP-3 (series clause): latest vintage supplied the value; no PROJ, no import row
    t2 = pq.read_table(tmp_path / "a/data/series/U2.parquet").to_pylist()
    assert all(r["value_status"] != "PROJ" for r in t2)
    assert not any(r["ref_period_start"] == date(2030, 1, 1) for r in t2)
    by = {r["ref_period_start"]: r for r in t2}
    assert by[MONTHS[3]]["value"] == 999.0 and by[MONTHS[3]]["load_kind"] == "revision"
    assert by[MONTHS[4]]["value"] == 54.0  # import row (888) absent
    assert by[MONTHS[3]]["known_at"].tzinfo is not None
    # EXP-04 row counts: manifest rows equal rows in the file
    rows = {f.path: f.rows for f in res.files}
    assert rows["series/U1.parquet"] == len(t1)
    # AC-EXP-7: inputs and withheld values nowhere
    blob = b"".join(p.read_bytes() for p in (tmp_path / "a/data").rglob("*") if p.is_file())
    assert b"X01" not in blob
    # multi-input transform: null default (documented gap), level still published
    t3 = pq.read_table(tmp_path / "a/data/series/M13.parquet").to_pylist()
    assert t3 and all(r["value_default_tf"] is None for r in t3) and t3[0]["value"] is not None


def test_series_files_deterministic(db: TestDatabase, tmp_path: Path) -> None:
    a = export(db, tmp_path / "a")
    c = export(db, tmp_path / "b")
    assert {f.path: f.data for f in a.files} == {f.path: f.data for f in c.files}  # EXP-08
