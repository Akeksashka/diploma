# ruff: noqa: E501, PT018
"""T86 db tests: EXP-01..10 on the fixture database (AC-EXP-1, golden manifest), the leak test
(AC-EXP-4 / AC-SYS-11: byte search and perturbation over two databases), the negative control of
AC-EXP-14(e), AC-EXP-14(f), AC-EXP-2 (forced failure deploys nothing), AC-EXP-5 and AC-SYS-14
(``record-export`` under ``mm_ingest``; ``mm_reader`` cannot write or read internal tables).

Expected values come from SQL on the internal tables (superuser) or from the scenario itself, never
from the export code."""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
import pyarrow.parquet as pq
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "analytics"))
sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "export"))
import builder as b
import export_fixtures as fx

from macro_monitor import cli
from macro_monitor.analytics import run
from macro_monitor.publish import checks, meta, revisions, scorecard, series, status
from macro_monitor.publish import export as ex
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = [pytest.mark.db, pytest.mark.timeout(1800)]

T = 180
ENTS = ("DEU", "USA", "FRA", "ITA", "ESP")
WITHHELD_ENTS = ("ITA", "ESP")
MONTHS = b.months(date(2021, 3, 1), 66)
GEN = datetime(2026, 11, 1, 6, 5, tzinfo=UTC)
GOLDEN = Path(__file__).parents[1] / "fixtures" / "export" / "golden_manifest_t86.json"
WM = b.months(date(2025, 1, 1), 30)
FUT = (date(2030, 1, 1), date(2031, 1, 1), date(2032, 1, 1))


def pub_vals(base: int, spike: int = 0) -> tuple[b.Obs, ...]:
    return tuple(
        b.Obs(p, str(base + (i % 3) + (spike if i == len(MONTHS) - 1 else 0)), 5)
        for i, p in enumerate(MONTHS)
    )


def secret_vals(v: int, base: int, spike: int) -> tuple[b.Obs, ...]:
    """Withheld values with distinctive digits; the last month is a spike and is revised later."""
    out = [b.Obs(p, f"{base}.{(i * 37 + v * 1111) % 9000 + 1000}", 5) for i, p in enumerate(MONTHS)]
    last = MONTHS[-1]
    out[-1] = b.Obs(last, f"{base + spike}.{v}{v}25", 5)
    out.append(b.Obs(last, f"{base + spike + 9}.{v}7{v}3", 9, kind="revision"))
    return tuple(out)


def weo(key: str, ind: str, j: int) -> b.Series:
    hist = [b.Obs(WM[i], str(100 + i), 0, label="WEO-1") for i in range(10)]
    hist += [
        b.Obs(WM[i], str(100 + i + (i + 1) * j), 5, kind="revision", label="WEO-2")
        for i in range(10)
    ]
    proj = [
        b.Obs(f, str(50 + n), d, status="PROJ", kind="initial" if d == 0 else "revision", label=lab)
        for n, f in enumerate(FUT)
        for d, lab in ((0, "WEO-1"), (5, "WEO-2"), (10, "WEO-3"))
    ]
    return b.Series(key, "DEU", ind, (*hist, *proj), source="WEO", group="WEO")


def scenario(v: int) -> b.Scenario:
    """``v`` selects the withheld values (1 or 2); everything public is identical."""
    s: list[b.Series] = []
    for k, e in enumerate(ENTS):
        spike = 8 if e == "ITA" else 0
        u1 = list(pub_vals(2 + k, spike))
        if e == "DEU":
            u1.append(b.Obs(MONTHS[-1], "99", 9, kind="revision"))  # a public revision
        s.append(b.Series(f"U1.{e}", e, "U1", tuple(u1)))
        if e in WITHHELD_ENTS:
            base = 4200 + 17 * k + 31 * v
            s.append(b.Series(f"U2.{e}", e, "U2", secret_vals(v, base, 600 + 40 * v), source="W"))
        else:
            s.append(b.Series(f"U2.{e}", e, "U2", pub_vals(10 + k)))
    a05 = weo("A05.DEU", "A05", 1)
    k_ = WM[20]
    s.append(
        b.Series(
            a05.key, "DEU", "A05",
            (
                *a05.obs,
                b.Obs(k_, "10", 0, status="PROJ", kind="initial", label="WEO-1"),
                b.Obs(k_, "20", 5, status="EST", kind="revision", label="WEO-2"),
                b.Obs(k_, "30", 10, status="EST", kind="revision", label="WEO-3"),
            ),
            source="WEO", group="WEO",
        )
    )  # fmt: skip
    s.append(
        b.Series(
            "A03.DEU", "DEU", "A03",
            tuple(b.Obs(FUT[0], str(1 + d), d, status="PROJ", kind="initial" if d == 0 else "revision", label=f"WEO-{n}") for n, d in ((1, 0), (2, 5), (3, 10))),
            source="WEO", group="WEO",
        )
    )  # fmt: skip
    s.append(b.Series("X.DEU", "DEU", "X01", pub_vals(7)))
    return b.Scenario(
        name=f"export_t86_{v}",
        sources=(b.Source("S"), b.Source("WEO"), b.Source("W", publish_site="withheld")),
        groups=(b.Group("S", "G"), b.Group("WEO", "WEO", edition_ordered=True), b.Group("W", "G")),
        entities=ENTS,
        indicators=(
            *(b.Indicator(i) for i in ("U1", "U2", "A03", "A05")),
            b.Indicator("X01", good_dir=0, rank_mode="descriptive_only", kind="input"),
        ),
        series=tuple(s),
    )


def expected_public_revisions(sc: b.Scenario) -> tuple[int, int]:
    """(revision rows without PROJ, with PROJ) of public sources and kind=indicator mappings."""
    pub = {s.source_id for s in sc.sources if s.publish_site == "public"}
    kinds = {i.indicator_id: i.kind for i in sc.indicators}
    rows = [
        o
        for s in sc.series
        if s.source in pub and kinds[s.indicator] == "indicator"
        for o in s.obs
        if o.kind in ("revision", "tombstone")
    ]
    return sum(1 for o in rows if o.status != "PROJ"), len(rows)


def build(db: TestDatabase, v: int) -> None:
    admin = db.connect(timeout=T)
    migrate.migrate(admin)
    b.seed(admin, scenario(v))
    admin.execute(
        "UPDATE ref.indicator SET params = %s::jsonb",
        ['{"alert_z": 3, "watch_z": 2, "window_obs": 60, "min_obs": 5}'],
    )
    # the builder writes no ingest.raw_load rows; ops.v_run_summary_public counts through them
    admin.execute(
        "INSERT INTO ingest.raw_load (raw_id, outcome, load_run_id, loaded_at) "
        "SELECT raw_id, 'loaded', run_id, fetched_at FROM ingest.raw_object"
    )
    admin.commit()
    ing = int(admin.execute("SELECT max(run_id) FROM ingest.run").fetchone()[0])  # type: ignore[index]
    ana = db.connect("mm_analytics", timeout=T)
    run.analyze(
        ana,
        run.AnalyzeOptions(
            ingest_run_id=ing, as_of_run_date=date(2026, 10, 15), code_version="t",
            git_sha=fx.FIXTURE_SHA, config_asof=datetime.now(UTC), config_sha256="c",
            mapping_sha256="m", overrides_sha256="o",
        ),
    )  # fmt: skip
    ana.close()
    admin.close()


def export(db: TestDatabase, out: Path) -> ex.ExportResult:
    cfg = fx.fixture_config()
    producers = [
        meta.meta_producer(cfg),
        scorecard.scorecard_producer,
        scorecard.alerts_producer,
        status.status_producer(cfg, generated_at=GEN),
        series.series_producer,
        revisions.revisions_producer,
    ]
    with db.connect("mm_reader", timeout=T) as rd:
        ing = int(
            rd.execute("SELECT max(ingest_run_id) FROM analytics.v_run_published").fetchone()[0]  # type: ignore[index]
        )
        rd.rollback()
        return ex.run_export(
            rd, ing, out, producers, now=lambda: GEN,
            checker=checks.standard_checker(cfg), verify_determinism=True,
        )  # fmt: skip


def all_text(res: ex.ExportResult) -> str:
    """Every byte of JSON as text plus every value of every Parquet column as text."""
    parts = []
    for f in res.files:
        if f.format == "json":
            parts.append(f.data.decode())
        else:
            import io

            t = pq.read_table(io.BytesIO(f.data))
            parts += [f"{c}={v!r}" for c in t.column_names for v in t.column(c).to_pylist()]
    return "\n".join(parts)


def tokens(x: Any) -> set[str]:
    """Number and string forms of ``x`` at several precisions; only distinctive ones (>= 5 chars)."""
    if x is None:
        return set()
    f = float(x)
    forms = {str(x), repr(f), str(f)}
    for p in (1, 2, 3, 4, 6):
        forms |= {f"{f:.{p}f}", str(round(f, p))}
    return {t for t in forms if len(t.lstrip("-")) >= 5}


def raw_tokens(v: int) -> set[str]:
    return {
        t for s in scenario(v).series if s.source == "W" for o in s.obs for t in tokens(o.value)
    }


def withheld_tokens(db: TestDatabase, v: int) -> set[str]:
    out = raw_tokens(v)
    with db.connect(timeout=T) as admin:
        q = (
            "SELECT value, transformed_value, deviation FROM analytics.indicator_snapshot "
            "WHERE indicator_id = 'U2' AND entity_id = ANY(%s)"
        )
        for row in admin.execute(q, [list(WITHHELD_ENTS)]).fetchall():
            for x in row:
                out |= tokens(x)
        for (z,) in admin.execute(
            "SELECT z FROM analytics.alert WHERE indicator_id = 'U2' AND entity_id = ANY(%s)",
            [list(WITHHELD_ENTS)],
        ).fetchall():
            out |= tokens(z)
        for (pc,) in admin.execute(
            "SELECT percentile FROM analytics.indicator_rank WHERE indicator_id = 'U2' "
            "AND entity_id = ANY(%s)",
            [list(WITHHELD_ENTS)],
        ).fetchall():
            out |= tokens(pc)
    return out


def comparable(res: ex.ExportResult) -> dict[str, Any]:
    """Files of an export for the perturbation test. The database clock (``known_cutoff``) is the
    only value that differs between two databases; it appears in the manifest and in
    ``revisions_recent.json``, which are compared without it."""
    out: dict[str, Any] = {}
    for f in res.files:
        if f.path == "manifest.json":
            m = json.loads(f.data)
            m.pop("known_cutoff")
            m.pop("totals")
            m["files"] = [e for e in m["files"] if e["path"] != "revisions_recent.json"]
            out[f.path] = m
        elif f.path == "revisions_recent.json":
            d = json.loads(f.data)
            d.pop("known_cutoff")
            out[f.path] = d
        else:
            out[f.path] = f.data
    return out


def golden_view(res: ex.ExportResult) -> list[dict[str, Any]]:
    return [{"path": f.path, "format": f.format, "rows": f.rows} for f in res.files]


@pytest.fixture
def dbs(
    test_database: TestDatabase, test_database_b: TestDatabase
) -> tuple[TestDatabase, TestDatabase]:
    build(test_database, 1)
    build(test_database_b, 2)
    return test_database, test_database_b


def test_exp_checks_leak_and_perturbation(
    dbs: tuple[TestDatabase, TestDatabase], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db, db2 = dbs
    res = export(db, tmp_path / "a")
    st = res.export_status
    # AC-EXP-1: EXP-01..10 pass (EXP-08 is the second producer pass); golden manifest matches
    assert st["status"] == "ok" and st["detail"]["failures"] == []
    assert st["detail"]["checks"] == {f"EXP-{n:02d}": "pass" for n in range(1, 11)}
    if os.environ.get("MM_UPDATE_GOLDEN"):  # regenerate: MM_UPDATE_GOLDEN=1 pytest -m db <file>
        GOLDEN.write_text(json.dumps(golden_view(res), indent=2, sort_keys=True) + "\n")
    assert golden_view(res) == json.loads(GOLDEN.read_text())
    # AC-EXP-5: one session, duration and bytes read recorded; the export wrote nothing to Neon
    assert st["sessions"] == 1 and st["bytes_read"] > 0 and st["duration_ms"] >= 0
    with db.connect(timeout=T) as admin:
        assert admin.execute("SELECT count(*) FROM ops.export_status").fetchone() == (0,)

    # AC-EXP-4(a): byte search over ALL files for withheld raw and derived values
    toks = withheld_tokens(db, 1)
    assert len(toks) > 40
    text = all_text(res)
    assert [t for t in sorted(toks) if t in text] == []
    # the search can find something: a public number is found (control)
    assert "99.0" in text or "99" in text
    # AC-EXP-4(b): no z/percentile/rank/deviation/revision/alert for a withheld pair
    docs = {f.path: json.loads(f.data) for f in res.files if f.format == "json"}
    sc = docs["scorecard/D1.json"]
    for e in sc["entities"]:
        for i in e["indicators"]:
            if i["indicator_id"] == "U2" and e["entity_id"] in WITHHELD_ENTS:
                assert i["published"] is False
                for k in (
                    "value",
                    "transformed_value",
                    "deviation",
                    "percentile",
                    "n_ranked",
                    "alert_level",
                ):
                    assert i[k] is None, (e["entity_id"], k)
    assert all(
        a["indicator_id"] != "U2" or a["entity_id"] not in WITHHELD_ENTS
        for a in docs["alerts.json"]["alerts"]
    )
    assert {a["indicator_id"] for a in docs["alerts.json"]["alerts"]} == {
        "U1"
    }  # public ITA spike only
    w_ids = {
        i["series_id"]
        for e in sc["entities"]
        for i in e["indicators"]
        if i["indicator_id"] == "U2" and e["entity_id"] in WITHHELD_ENTS
    }
    assert w_ids
    assert not any(
        f.path in ("series/U2.parquet",)
        and set(pq.read_table(tmp_path / "a/data" / f.path)["series_id"].to_pylist()) & w_ids
        for f in res.files
    )
    blob = json.dumps(docs["revisions_recent.json"])
    assert all(f'"series_id": {s}' not in blob for s in w_ids)
    # AC-EXP-4(c): public U2 ranks are those of the 3 public pairs only
    pub_u2 = {
        e["entity_id"]: i
        for e in sc["entities"]
        for i in e["indicators"]
        if i["indicator_id"] == "U2" and e["entity_id"] not in WITHHELD_ENTS
    }
    assert {i["n_ranked"] for i in pub_u2.values()} == {3}
    pcts = sorted(i["percentile"] for i in pub_u2.values())
    assert pcts == pytest.approx(
        [1 / 6, 1 / 2, 5 / 6]
    )  # mid-ranks of 3 pairs; 5 pairs would differ
    # AC-EXP-4(e): mm_reader cannot read the full analytics tables (T-DDL-12)
    for tbl in ("indicator_snapshot", "scorecard", "indicator_rank", "alert", "run"):
        with (
            db.connect("mm_reader", timeout=T) as rd,
            pytest.raises(psycopg.errors.InsufficientPrivilege),
        ):
            rd.execute(f"SELECT * FROM analytics.{tbl}")
    # AC-EXP-4(f): status.json has no drift JSON and no withheld values
    keys = set(checks._all_keys(docs["status.json"]))
    assert not keys & {"old", "new", "detail"}
    # AC-EXP-14(f) / AC-EXP-10: last_run.revisions counts no PROJ row and no withheld row
    n_no_proj, n_with_proj = expected_public_revisions(scenario(1))
    assert n_no_proj != n_with_proj
    assert docs["status.json"]["last_run"]["revisions"] == n_no_proj

    # AC-EXP-4(d): perturb every withheld value (second database): all files identical
    res2 = export(db2, tmp_path / "b")
    assert raw_tokens(2).isdisjoint(raw_tokens(1))
    assert [t for t in sorted(withheld_tokens(db2, 2)) if t in all_text(res2)] == []
    a, c = comparable(res), comparable(res2)
    assert sorted(a) == sorted(c)
    assert {p for p in a if a[p] != c[p]} == set()

    # ... and the withheld values really differ between the two databases
    def u2_ita(d: TestDatabase) -> list[Any]:
        with d.connect(timeout=T) as admin:
            return admin.execute(
                "SELECT value FROM analytics.indicator_snapshot WHERE indicator_id='U2' AND entity_id='ITA' ORDER BY analysis_run_id"
            ).fetchall()

    assert u2_ita(db) != u2_ita(db2)

    # AC-EXP-5 / AC-SYS-14: record-export under mm_ingest writes one row; mm_reader cannot write
    for name in ("MM_ENV", "MM_RAW_STORE", "MM_GROUPS", "MM_MODE", "MM_RAW_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", db.dsn("mm_ingest"))
    assert (
        cli.main(
            [
                "record-export",
                "--status-file",
                str(tmp_path / "a" / "export-status.json"),
                "--root",
                str(tmp_path),
            ]
        )
        == 0
    )
    with db.connect(timeout=T) as admin:
        row = admin.execute(
            "SELECT run_id, analysis_run_id, status, duration_ms, bytes_read, file_counts->>'total', detail->'checks'->>'EXP-04' FROM ops.export_status"
        ).fetchall()
    assert row == [
        (
            st["ingest_run_id"],
            st["analysis_run_id"],
            "ok",
            st["duration_ms"],
            st["bytes_read"],
            str(st["file_counts"]["total"]),
            "pass",
        )
    ]
    with db.connect("mm_reader", timeout=T) as rd:
        assert rd.execute("SELECT status FROM ops.v_export_status_latest").fetchone() == ("ok",)
        rd.rollback()
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            rd.execute("INSERT INTO ops.export_status (run_id, status) VALUES (1, 'ok')")
    monkeypatch.setenv("DATABASE_URL", db.dsn("mm_reader"))  # a reader session cannot record
    assert (
        cli.main(
            [
                "record-export",
                "--status-file",
                str(tmp_path / "a" / "export-status.json"),
                "--root",
                str(tmp_path),
            ]
        )
        != 0
    )

    # AC-EXP-14(e): negative control. A revision view that includes PROJ fails EXP-02 and EXP-04,
    # nothing is deployed, and a previously built tree elsewhere is untouched (AC-EXP-2).
    with db.connect(timeout=T) as owner:  # superuser: mm_owner has no table privileges
        owner.execute(
            "CREATE OR REPLACE VIEW curated.v_revision_history AS "
            "WITH v AS (SELECT o.series_id, m.entity_id, m.indicator_id, o.ref_period_start, o.ref_period_end, "
            "o.known_at, o.source_release_at, o.vintage_label, o.value, o.value_status, o.load_kind, "
            "o.revision_class, g.edition_ordered FROM curated.observation o "
            "JOIN ref.series s ON s.series_id = o.series_id "
            "JOIN ref.source src ON src.source_id = s.source_id AND src.publish_site = 'public' "
            "JOIN ref.series_group g ON g.source_id = s.source_id AND g.group_id = s.group_id "
            "JOIN ref.series_map m ON m.series_id = o.series_id AND m.role = 'headline' "
            "AND o.ref_period_start >= m.valid_from AND (m.valid_to IS NULL OR o.ref_period_start <= m.valid_to) "
            "JOIN ref.indicator i ON i.indicator_id = m.indicator_id AND i.kind = 'indicator' "
            "WHERE o.load_kind <> 'import'), "
            "c AS (SELECT v.*, count(*) OVER w AS n_versions, row_number() OVER (w ORDER BY v.known_at) AS rn FROM v "
            "WINDOW w AS (PARTITION BY v.series_id, v.indicator_id, v.entity_id, v.ref_period_start)) "
            "SELECT series_id, entity_id, indicator_id, ref_period_start, ref_period_end, known_at, "
            "source_release_at, vintage_label, value, value_status, load_kind, revision_class, "
            "edition_ordered, (rn = 1) AS is_base_version FROM c WHERE n_versions >= 2"
        )
        owner.commit()
    with pytest.raises(ex.ExportError) as ei:
        export(db, tmp_path / "bad")
    failed = {f.split(":")[0] for f in ei.value.failures}
    assert {"EXP-02", "EXP-04"} <= failed
    assert not (tmp_path / "bad" / "data").exists()
    bad = json.loads((tmp_path / "bad" / "export-status.json").read_text())
    assert bad["status"] == "failed" and bad["detail"]["checks"]["EXP-02"] == "fail"
    assert (tmp_path / "a" / "data" / "manifest.json").is_file()  # the earlier build stays
