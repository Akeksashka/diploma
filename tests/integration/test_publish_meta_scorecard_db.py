# ruff: noqa: E501, PT018
"""T83 db tests: meta, scorecard, alerts and status files exported by a real ``mm_reader`` session
from a database filled by the production analytics run (builder scenario + ``analyze``).

Expected values are read back with SQL (stored columns), never recomputed. Covers AC-EXP-6, 7, 10,
11, 12 (file side) and EXP-03 (git sha of the config tree)."""

from __future__ import annotations

import json
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "analytics"))
sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "export"))
import builder as b
import export_fixtures as fx

from macro_monitor.analytics import run
from macro_monitor.publish import export as ex
from macro_monitor.publish import meta, scorecard, status
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

T = 120
ENTS = ("DEU", "USA", "FRA", "ITA")
MONTHS = b.months(date(2021, 3, 1), 66)  # 5.5 years: the alert window must span 5 years (T43 n_eff)
GEN = datetime(2026, 11, 1, 6, 5, tzinfo=UTC)
RUN_DATE = date(2026, 10, 15)


def vals(base: int, spike: int = 0) -> tuple[b.Obs, ...]:
    return tuple(
        b.Obs(p, str(base + (i % 3) + (spike if i == len(MONTHS) - 1 else 0)), 5)
        for i, p in enumerate(MONTHS)
    )


def scenario() -> b.Scenario:
    series: list[b.Series] = []
    for k, e in enumerate(ENTS):
        series.append(b.Series(f"U1.{e}", e, "U1", vals(2 + k, 8 if e == "ITA" else 0)))
        series.append(b.Series(f"U2.{e}", e, "U2", vals(10 + k), source="W"))
        series.append(b.Series(f"U3.{e}", e, "U3", vals(5 + 2 * k)))
        series.append(b.Series(f"M18.{e}", e, "M18", vals(1 + k)))
    series.append(b.Series("X.DEU", "DEU", "X01", vals(7)))  # support input on a public source
    series.append(b.Series("G1.WLD", "WLD", "G1", vals(3)))
    return b.Scenario(
        name="export_t83",
        sources=(b.Source("S"), b.Source("W", publish_site="withheld")),
        groups=(b.Group("S", "G"), b.Group("W", "G")),
        entities=(*ENTS, "WLD"),
        indicators=(
            *(b.Indicator(i) for i in ("U1", "U2", "U3", "M18")),
            b.Indicator("X01", good_dir=0, rank_mode="descriptive_only", kind="input"),
            b.Indicator("G1", good_dir=0, rank_mode="descriptive_only", domain_id="global"),
        ),
        series=tuple(series),
    )


@pytest.fixture
def bare(test_database: TestDatabase) -> TestDatabase:
    with test_database.connect("mm_owner", timeout=T) as c:
        migrate.migrate(c)
        c.commit()
    return test_database


@pytest.fixture
def db(test_database: TestDatabase) -> TestDatabase:
    admin = test_database.connect(timeout=T)
    migrate.migrate(admin)
    admin.execute(
        "INSERT INTO ref.domain (domain_id, name, is_ranked) VALUES ('global','Global series',false)"
    )
    b.seed(admin, scenario())
    admin.execute(
        "UPDATE ref.entity SET kind='aggregate', is_ranked=false, is_global=true WHERE entity_id='WLD'"
    )
    admin.execute("UPDATE ref.indicator SET scope='global' WHERE indicator_id='G1'")
    admin.execute(
        "UPDATE ref.indicator SET params = %s::jsonb",
        ['{"alert_z": 3, "watch_z": 2, "window_obs": 60, "min_obs": 5}'],
    )
    for e in ("DEU", "FRA", "ITA"):
        admin.execute(
            "INSERT INTO ref.entity_group_member VALUES ('euro_area', %s, '1999-01-01', NULL)", [e]
        )
    admin.commit()
    ing = int(admin.execute("SELECT max(run_id) FROM ingest.run").fetchone()[0])  # type: ignore[index]
    # ops rows read by status.json
    admin.execute(
        "INSERT INTO ops.freshness_state (source_group, series_group, evaluated_at, expected_period_end, latest_period_end, state) "
        "VALUES ('S','G', %s, '2026-08-31', '2026-08-31', 'fresh')",
        [GEN],
    )
    admin.execute(
        "INSERT INTO ops.validation_result (run_id, check_id, severity, subject, passed, metric, threshold, detail) "
        "VALUES (%s, 'COV-01', 'info', 'U1', true, NULL, 0.5, %s::jsonb)",
        [ing, '{"state": "not_yet_measurable", "n_qualifying": 3}'],
    )
    admin.commit()
    ana = test_database.connect("mm_analytics", timeout=T)
    run.analyze(
        ana,
        run.AnalyzeOptions(
            ingest_run_id=ing, as_of_run_date=RUN_DATE, code_version="t", git_sha=fx.FIXTURE_SHA,
            config_asof=datetime.now(UTC), config_sha256="c", mapping_sha256="m", overrides_sha256="o",
        ),
    )  # fmt: skip
    ana.close()
    # target_distance for U3 so the config target of the fixture tree is exported
    admin.execute(
        "UPDATE ref.indicator SET rank_mode='target_distance', good_dir=0 WHERE indicator_id='U3'"
    )
    admin.commit()
    admin.close()
    return test_database


def export(db: TestDatabase, out: Path, config: meta.ConfigTree | None = None) -> ex.ExportResult:
    cfg = config or fx.fixture_config()
    producers = [
        meta.meta_producer(cfg),
        scorecard.scorecard_producer,
        scorecard.alerts_producer,
        status.status_producer(cfg, generated_at=GEN),
    ]
    with db.connect("mm_reader", timeout=T) as rd:
        ing = int(
            rd.execute("SELECT max(ingest_run_id) FROM analytics.v_run_published").fetchone()[0]
        )  # type: ignore[index]
        rd.rollback()
        return ex.run_export(rd, ing, out, producers, now=lambda: GEN)


def load(out: Path) -> dict[str, Any]:
    return {
        str(p.relative_to(out / "data")): json.loads(p.read_text())
        for p in sorted((out / "data").rglob("*.json"))
    }


def stored(db: TestDatabase, query: str) -> list[tuple[Any, ...]]:
    with db.connect(timeout=T) as c:
        return c.execute(query).fetchall()  # type: ignore[arg-type]


def check_files_and_ac_exp_6_7_12(db: TestDatabase, tmp_path: Path) -> None:
    res = export(db, tmp_path / "o")
    assert res.status == "ok"
    files = load(tmp_path / "o")
    assert sorted(files) == [
        "alerts.json", "manifest.json", "meta/domains.json", "meta/entities.json", "meta/groups.json",
        "meta/indicators.json", "meta/series.json", "scorecard/D1.json", "scorecard/global.json",
        "status.json",
    ]  # fmt: skip
    blob = {p.name: p.read_bytes() for p in (tmp_path / "o" / "data").rglob("*.json")}
    text = "\n".join(v.decode() for v in blob.values())
    # AC-EXP-12 (file side) and AC-EXP-6
    assert "vintage_resolution" not in text and "release_cadence_note" not in text
    assert "modal_ref_period_end" not in text
    d1 = files["scorecard/D1.json"]
    assert d1["alignment"] and all("rank_reference_period" in a for a in d1["alignment"])
    for e in d1["entities"]:
        assert "percentile_rank_label" in e
        assert all("percentile_label" in i for i in e["indicators"])
    notes = {i["indicator_id"]: i["notes"] for i in files["meta/indicators.json"]["indicators"]}
    assert "not sovereign credit risk" in notes["M18"][0] and notes["U1"] == []
    targets = {i["indicator_id"]: i["target"] for i in files["meta/indicators.json"]["indicators"]}
    assert targets["U3"] == {"value": 0.0, "source_note": "Fixture target: zero by definition."}
    # AC-EXP-7: WLD only in the global domain file, never ranked; support input X01 nowhere
    assert [e["entity_id"] for e in files["scorecard/global.json"]["entities"]] == ["WLD"]
    wld = files["scorecard/global.json"]["entities"][0]
    assert wld["indicators"][0]["percentile"] is None and wld["percentile_rank"] is None
    assert "WLD" not in json.dumps(d1)
    assert "X01" not in text
    x_series = stored(db, "SELECT series_id FROM ref.series WHERE series_key = 'X.DEU'")[0][0]
    ids = {s["series_id"] for s in files["meta/series.json"]["series"]}
    assert x_series not in ids
    assert all("is_support" not in i for i in files["meta/indicators.json"]["indicators"])
    assert {i["indicator_id"] for i in files["meta/indicators.json"]["indicators"]} == {
        "G1",
        "M18",
        "U1",
        "U2",
        "U3",
    }
    assert [m["path"] for m in files["manifest.json"]["files"]] == sorted(
        m["path"] for m in files["manifest.json"]["files"]
    )
    assert not any("X01" in m["path"] for m in files["manifest.json"]["files"])
    # withheld source: metadata row stays, scorecard pairs are placeholders without numbers
    ser = {s["series_key"]: s for s in files["meta/series.json"]["series"]}
    assert ser["U2.DEU"]["publish"] == "withheld" and ser["U3.DEU"]["publish"] == "public"
    assert (
        ser["U3.DEU"]["source_url"] == "https://example.org/public-source"
        and ser["U3.DEU"]["published_precision"] == 1
    )
    assert (
        ser["U2.DEU"]["source_url"] == "https://example.org/withheld-source"
        and ser["U2.DEU"]["published_precision"] is None
    )
    u2 = [i for e in d1["entities"] for i in e["indicators"] if i["indicator_id"] == "U2"]
    assert u2 and all(
        i["published"] is False
        and i["publish_scope"] == "excluded"
        and i["value"] is None
        and i["percentile"] is None
        for i in u2
    )
    eu = {e["entity_id"]: e for e in files["meta/entities.json"]["entities"]}
    assert (
        eu["DEU"]["group_ids"] == ["euro_area"]
        and eu["USA"]["group_ids"] == []
        and eu["WLD"]["is_global"] is True
    )


def check_ac_exp_11_stored_fields_equal_view_and_scorecard_columns(
    db: TestDatabase, tmp_path: Path
) -> None:
    export(db, tmp_path / "o")
    d1 = load(tmp_path / "o")["scorecard/D1.json"]
    rid = d1["analysis_run_id"]
    snap = {
        (r[0], r[1]): r[2:]
        for r in stored(
            db,
            "SELECT indicator_id, entity_id, publish_scope, ref_offset_days, value_kind, limit_source, alignment, alignment_reason "
            f"FROM analytics.v_indicator_snapshot_published WHERE analysis_run_id = {rid}",
        )
    }
    n = 0
    for e in d1["entities"]:
        for i in e["indicators"]:
            got = (
                i["publish_scope"],
                i["ref_offset_days"],
                i["value_kind"],
                i["limit_source"],
                i["alignment"],
                i["alignment_reason"],
            )
            assert got == snap[(i["indicator_id"], e["entity_id"])]
            n += 1
    assert n >= 16
    sc = stored(
        db,
        "SELECT entity_id, n_available, n_defined, percentile_rank, rank_position, heterogeneous_peer_set, peer_set_size_min, peer_set_size_max "
        f"FROM analytics.scorecard_published WHERE domain_id = 'D1' AND analysis_run_id = {rid}",
    )
    assert sc
    by_e = {e["entity_id"]: e for e in d1["entities"]}
    for eid, avail, defined, pr, pos, het, lo, hi in sc:
        e = by_e[eid]
        assert (e["n_available"], e["n_defined"], e["rank_position"]) == (avail, defined, pos)
        assert e["percentile_rank"] == (None if pr is None else float(pr))
        assert (d1["heterogeneous_peer_set"], d1["peer_set_size_by_indicator"]) == (
            het,
            {"min": lo, "max": hi},
        )
    ranks = {
        (r[0], r[1]): float(r[2])
        for r in stored(
            db,
            f"SELECT indicator_id, entity_id, percentile, n_ranked FROM analytics.indicator_rank_published WHERE analysis_run_id = {rid}",
        )
    }
    for e in d1["entities"]:
        for i in e["indicators"]:
            assert i["percentile"] == ranks.get((i["indicator_id"], e["entity_id"]))
    al = stored(
        db,
        f"SELECT indicator_id, rank_reference_period, reference_period_spread_days FROM analytics.indicator_alignment_published WHERE analysis_run_id = {rid}",
    )
    exported = {a["indicator_id"]: a for a in d1["alignment"]}
    for iid, rrp, spread in al:
        assert (
            exported[iid]["rank_reference_period"] == rrp.isoformat()
            and exported[iid]["reference_period_spread_days"] == spread
        )


def check_alerts_and_ac_exp_10_status(db: TestDatabase, tmp_path: Path) -> None:
    export(db, tmp_path / "o")
    files = load(tmp_path / "o")
    rid = files["manifest.json"]["analysis_run_id"]
    expect = stored(
        db,
        "SELECT indicator_id, entity_id, level FROM analytics.alert "
        f"WHERE analysis_run_id = {rid} AND publish AND level IN ('watch','alert') ORDER BY 1, 2",
    )
    assert (
        expect
        and [
            (a["indicator_id"], a["entity_id"], a["level"]) for a in files["alerts.json"]["alerts"]
        ]
        == expect
    )
    assert not any(
        a["indicator_id"] == "U2" for a in files["alerts.json"]["alerts"]
    )  # withheld source
    row = stored(
        db,
        "SELECT ingest_run_id, started_at, finished_at, mode, new_raw_objects, new_observations, revisions, alerts_opened FROM ops.v_run_summary_public",
    )[0]
    lr = files["status.json"]["last_run"]
    assert lr["ingest_run_id"] == row[0] and lr["mode"] == row[3]
    assert (
        lr["new_raw_objects"],
        lr["new_observations"],
        lr["revisions"],
        lr["alerts_opened"],
    ) == row[4:]
    assert lr["alerts_opened"] == len(expect) and lr["started_at"] == row[1].astimezone(
        UTC
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    st = files["status.json"]
    assert st["groups"] == [
        {
            "source_group": "S",
            "series_group": "G",
            "state": "fresh",
            "expected_period_end": "2026-08-31",
            "latest_period_end": "2026-08-31",
            "evaluated_at": "2026-11-01T06:05:00Z",
            "load_result": None,
        }
    ]
    assert st["validation"]["cov01"] == [
        {"indicator_id": "U1", "n_qualifying": 3, "state": "not_yet_measurable"}
    ]
    assert st["backlog"]["n_unloaded"] == stored(db, "SELECT n_unloaded FROM ops.v_backlog")[0][0]
    assert st["validation"]["open_drift"]["n_open"] == 0
    assert [m["source_id"] for m in st["manual_sources"]] == ["MAN"]
    assert "postgres" not in json.dumps(st)


def test_last_run_alerts_opened_null_without_analysis_run(bare: TestDatabase) -> None:
    with bare.connect(timeout=T) as admin:
        extra = admin.execute(
            "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status) "
            "VALUES ('pipeline','local','refresh','g','v1', %s, 'ok') RETURNING run_id",
            [GEN],
        ).fetchone()
        assert extra is not None
        admin.commit()
    with bare.connect("mm_reader", timeout=T) as rd:
        doc = status.last_run(ex.ExportSession(rd), int(extra[0]))
    assert doc["alerts_opened"] is None


def check_exp_03_wrong_config_sha_fails_and_deploys_nothing(
    db: TestDatabase, tmp_path: Path
) -> None:
    with pytest.raises(ex.ExportError) as ei:
        export(db, tmp_path / "bad", fx.fixture_config("1" * 40))
    assert ei.value.check == "EXP-03"
    assert not (tmp_path / "bad" / "data").exists()
    assert json.loads((tmp_path / "bad" / "export-status.json").read_text())["status"] == "failed"


def check_exp_08_files_are_byte_identical_across_exports(db: TestDatabase, tmp_path: Path) -> None:
    a, b2 = export(db, tmp_path / "a"), export(db, tmp_path / "b")
    assert {f.path: f.sha256 for f in a.files} == {f.path: f.sha256 for f in b2.files}
    assert a.export_status["file_counts"]["total"] == 10


def test_t83_files_end_to_end(db: TestDatabase, tmp_path: Path) -> None:
    """One database setup (migration + analytics run is slow on a remote server), several checks."""
    check_files_and_ac_exp_6_7_12(db, tmp_path / "files")
    check_ac_exp_11_stored_fields_equal_view_and_scorecard_columns(db, tmp_path / "ac11")
    check_alerts_and_ac_exp_10_status(db, tmp_path / "ac10")
    check_exp_03_wrong_config_sha_fails_and_deploys_nothing(db, tmp_path / "exp03")
    check_exp_08_files_are_byte_identical_across_exports(db, tmp_path / "exp08")
