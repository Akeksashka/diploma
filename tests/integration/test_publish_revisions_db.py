# ruff: noqa: E501, PT018
"""T85 db tests: ``revisions/*.parquet`` and ``revisions_recent.json`` exported by a real
``mm_reader`` session (AC-EXP-3 revision clauses, AC-EXP-13, AC-EXP-14, EXP-02, EXP-04, EXP-08)."""

from __future__ import annotations

import json
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
from macro_monitor.publish import revisions
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

T = 120
GEN = datetime(2026, 11, 1, 6, 5, tzinfo=UTC)
M = b.months(date(2025, 1, 1), 30)
FUT = (date(2030, 1, 1), date(2031, 1, 1), date(2032, 1, 1))
WEO = ("A05", "A06", "A07", "A08")
SECRET = "777.125"


def weo(key: str, ind: str, j: int) -> b.Series:
    """10 history keys revised in edition 2 (by (i+1)*j), 3 PROJ years re-stored every edition."""
    hist = [b.Obs(M[i], str(100 + i), 0, label="WEO-1") for i in range(10)]
    hist += [
        b.Obs(M[i], str(100 + i + (i + 1) * j), 5, kind="revision", label="WEO-2")
        for i in range(10)
    ]
    proj = [
        b.Obs(f, str(50 + n), d, status="PROJ", kind="initial" if d == 0 else "revision", label=lab)
        for n, f in enumerate(FUT)
        for d, lab in ((0, "WEO-1"), (5, "WEO-2"), (10, "WEO-3"))
    ]
    return b.Series(key, "DEU", ind, (*hist, *proj), source="WEO", group="WEO")


def scenario() -> b.Scenario:
    k = M[20]
    s = [weo(f"{ind}.DEU", ind, j + 1) for j, ind in enumerate(WEO)]
    # A05 also carries key K: PROJ (ed1), EST (ed2), EST changed (ed3); and a PROJ,EST-only key
    a05 = s[0]
    s[0] = b.Series(
        a05.key, "DEU", "A05",
        (
            *a05.obs,
            b.Obs(k, "10", 0, status="PROJ", kind="initial", label="WEO-1"),
            b.Obs(k, "20", 5, status="EST", kind="revision", label="WEO-2"),
            b.Obs(k, "30", 10, status="EST", kind="revision", label="WEO-3"),
            b.Obs(M[21], "7", 0, status="PROJ", kind="initial", label="WEO-1"),
            b.Obs(M[21], "8", 5, status="EST", kind="revision", label="WEO-2"),
        ),
        source="WEO", group="WEO",
    )  # fmt: skip
    s.append(  # A03: only PROJ over three editions with changed numbers
        b.Series(
            "A03.DEU", "DEU", "A03",
            tuple(b.Obs(FUT[0], str(1 + d), d, status="PROJ", kind="initial" if d == 0 else "revision", label=f"WEO-{n}") for n, d in ((1, 0), (2, 5), (3, 10))),
            source="WEO", group="WEO",
        )
    )  # fmt: skip
    s.append(  # ordinary group: two revised keys and one single-version key
        b.Series(
            "R1.DEU", "DEU", "R1",
            (
                b.Obs(M[0], "100", 0), b.Obs(M[0], "110", 5, kind="revision"),
                b.Obs(M[1], "200", 0), b.Obs(M[1], "190", 5, kind="revision"),
                b.Obs(M[2], "300", 0),
            ),
        )
    )  # fmt: skip
    s.append(b.Series("R2.DEU", "DEU", "R2", (b.Obs(M[0], "5", 0),)))  # no revision: no file
    s.append(  # withheld edition-ordered group with a revision
        b.Series(
            "W.DEU", "DEU", "A09",
            (b.Obs(M[0], "1", 0, label="X-1"), b.Obs(M[0], SECRET, 5, kind="revision", label="X-2")),
            source="W", group="WW",
        )
    )  # fmt: skip
    s.append(  # input indicator with a revision
        b.Series("X.DEU", "DEU", "X01", (b.Obs(M[0], "7", 0), b.Obs(M[0], "8", 5, kind="revision")))
    )
    return b.Scenario(
        name="export_t85",
        sources=(b.Source("S"), b.Source("WEO"), b.Source("W", publish_site="withheld")),
        groups=(b.Group("S", "G"), b.Group("WEO", "WEO", edition_ordered=True), b.Group("W", "WW", edition_ordered=True)),
        entities=("DEU",),
        indicators=(
            *(b.Indicator(i) for i in (*WEO, "A03", "A09", "R1", "R2")),
            b.Indicator("X01", good_dir=0, rank_mode="descriptive_only", kind="input"),
        ),
        series=tuple(s),
    )  # fmt: skip


@pytest.fixture
def db(test_database: TestDatabase) -> TestDatabase:
    admin = test_database.connect(timeout=T)
    migrate.migrate(admin)
    b.seed(admin, scenario())
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
        return ex.run_export(rd, ing, out, [revisions.revisions_producer], now=lambda: GEN)


def test_revision_files_and_recent(db: TestDatabase, tmp_path: Path) -> None:
    res = export(db, tmp_path / "a")
    assert res.status == "ok"
    paths = sorted(f.path for f in res.files if f.path.startswith("revisions"))
    # AC-EXP-14(a): no A03 file; no file for R2 (single version), A09 (withheld), X01 (input)
    assert paths == [f"revisions/{i}.parquet" for i in (*WEO, "R1")] + ["revisions_recent.json"]
    data = tmp_path / "a/data"
    # AC-EXP-14(b): A05 has no PROJ row; revision rows are the 10 history keys + K's ed3 row
    a05 = pq.read_table(data / "revisions/A05.parquet").to_pylist()
    assert all(r["value_status"] != "PROJ" for r in a05)
    assert [r["revision_class"] for r in a05] and all(r["edition_ordered"] for r in a05)
    assert sum(1 for r in a05 if not r["is_base_version"]) == 11
    # AC-EXP-14(c): K = EST ed2 (base, null sizes) + EST ed3 (revision)
    kr = [r for r in a05 if r["ref_period_start"] == M[20]]
    assert [(r["value"], r["is_base_version"], r["vintage_label"]) for r in kr] == [
        (20.0, True, "WEO-2"),
        (30.0, False, "WEO-3"),
    ]
    assert kr[0]["revision_abs"] is None and kr[0]["revision_pct"] is None
    assert kr[1]["revision_abs"] == 10.0 and kr[1]["revision_pct"] == 50.0
    # AC-EXP-14(d): PROJ,EST-only key has no row
    assert not any(r["ref_period_start"] == M[21] for r in a05)
    # EXP-04: manifest rows equal rows
    rows = {f.path: f.rows for f in res.files}
    assert rows["revisions/A05.parquet"] == len(a05) == 10 * 2 + 2
    # AC-EXP-3: revision (old and new value, class) in the file and in the recent list
    r1 = pq.read_table(data / "revisions/R1.parquet").to_pylist()
    assert [
        (r["value"], r["revision_class"], r["is_base_version"])
        for r in r1
        if r["ref_period_start"] == M[0]
    ] == [(100.0, "regular", True), (110.0, "regular", False)]
    doc = json.loads((data / "revisions_recent.json").read_bytes())
    assert [
        (r["indicator_id"], r["previous_value"], r["value"], r["revision_pct"])
        for r in doc["revisions"]
    ] == [("R1", 100.0, 110.0, 10.0), ("R1", 200.0, 190.0, -5.0)]
    # AC-EXP-13(a)/(h): no WEO row among ordinary revisions
    assert all(r["indicator_id"] == "R1" for r in doc["revisions"])
    # AC-EXP-13(b)/(h): WEO-2 summary counts the 40 history keys only (no PROJ), WEO-3 only K
    sm = {e["vintage_label"]: e for e in doc["edition_summaries"]}
    assert set(sm) == {"WEO-2", "WEO-3"}  # (d) edition 1 / A03 / withheld X-2: no entry
    e2, e3 = sm["WEO-2"], sm["WEO-3"]
    assert e2["source_id"] == "WEO" and e2["n_series"] == 4 and e2["n_keys_revised"] == 40
    exp = sorted(
        (((i + 1) * (j + 1)) / (100 + i) * 100 for i in range(10) for j in range(4)), reverse=True
    )
    assert e2["max_abs_pct"] == pytest.approx(exp[0])
    assert e2["median_abs_pct"] == pytest.approx((exp[19] + exp[20]) / 2)
    assert [r["revision_pct"] for r in e2["top_revisions"]] == pytest.approx(exp[:10])
    assert e3["n_series"] == 1 and e3["n_keys_revised"] == 1 and e3["max_abs_pct"] == 50.0
    assert [e["vintage_label"] for e in doc["edition_summaries"]] == [
        "WEO-3",
        "WEO-2",
    ]  # first_known_at desc
    # AC-EXP-13(e) / AC-EXP-7: withheld values and the input series occur nowhere
    blob = b"".join(p.read_bytes() for p in data.rglob("*") if p.is_file())
    assert (
        SECRET.encode() not in blob
        and b"X01" not in blob
        and b"A09" not in blob
        and b"A03" not in blob
    )


def test_revisions_deterministic(db: TestDatabase, tmp_path: Path) -> None:
    a = export(db, tmp_path / "a")
    c = export(db, tmp_path / "b")
    assert {f.path: f.data for f in a.files} == {f.path: f.data for f in c.files}  # EXP-08
