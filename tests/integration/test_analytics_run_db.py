# ruff: noqa: E501, PT018, C408
"""T44 db tests: ``analyze`` end to end under mm_analytics (determinism, published set,
perturbation of a withheld source, wiring of SPREAD_VS_REF, reproduction hash mismatches)."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "analytics"))
import builder as b

from macro_monitor.analytics import run, runctx

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

T = 60
RUN_DATE = date(2026, 10, 15)
ENTS = ("DEU", "USA", "FRA", "ITA")
MONTHS = b.months(date(2024, 3, 1), 30)  # Mar-2024 .. Aug-2026
TABLES = (
    "indicator_snapshot", "indicator_rank", "indicator_alignment", "scorecard", "alert",
    "indicator_rank_published", "indicator_alignment_published", "scorecard_published",
)  # fmt: skip


def scenario() -> b.Scenario:
    def vals(base: int, spike: int = 0) -> tuple[b.Obs, ...]:
        return tuple(
            b.Obs(p, str(base + (i % 3) + (spike if i == len(MONTHS) - 1 else 0)), 5)
            for i, p in enumerate(MONTHS)
        )

    series: list[b.Series] = []
    for k, e in enumerate(ENTS):
        series.append(b.Series(f"U1.{e}", e, "U1", vals(2 + k, 8 if e == "ITA" else 0)))
        series.append(b.Series(f"U2.{e}", e, "U2", vals(10 + k), source="W"))
        series.append(b.Series(f"U3.{e}", e, "U3", vals(5 + 2 * k)))
        series.append(b.Series(f"U4.{e}", e, "U4", vals(1 + k)))
    return b.Scenario(
        name="run",
        sources=(b.Source("S"), b.Source("W", publish_site="withheld")),
        groups=(b.Group("S", "G"), b.Group("W", "G")),
        entities=ENTS,
        indicators=tuple(b.Indicator(i) for i in ("U1", "U2", "U3", "U4")),
        series=tuple(series),
    )


@pytest.fixture
def conns(
    test_database: TestDatabase,
) -> Iterator[tuple[psycopg.Connection[Any], psycopg.Connection[Any]]]:
    from macro_monitor.storage import migrate

    admin = test_database.connect(timeout=T)
    migrate.migrate(admin)
    b.seed(admin, scenario())
    admin.execute(
        "UPDATE ref.indicator SET params = %s::jsonb, transform_id = CASE indicator_id "
        "WHEN 'U3' THEN 'SPREAD_VS_REF' ELSE transform_id END",
        ['{"alert_z": 3, "watch_z": 2, "window_obs": 20, "min_obs": 5}'],
    )
    admin.commit()
    ana = test_database.connect("mm_analytics", timeout=T)
    yield admin, ana
    ana.close()
    admin.close()


def options(admin: psycopg.Connection[Any], **kw: Any) -> run.AnalyzeOptions:
    ing = int(admin.execute("SELECT max(run_id) FROM ingest.run").fetchone()[0])  # type: ignore[index]
    base: dict[str, Any] = dict(
        ingest_run_id=ing, as_of_run_date=RUN_DATE, code_version="t", git_sha="g",
        config_asof=datetime.now(UTC), config_sha256="c", mapping_sha256="m",
        overrides_sha256="o",
        spread_reference={("U3", "FRA"): "DEU", ("U3", "ITA"): "DEU", ("U3", "DEU"): "DEU",
                          ("U3", "USA"): "USA"},
    )  # fmt: skip
    base.update(kw)
    return run.AnalyzeOptions(**base)


def dump(ana: psycopg.Connection[Any], run_id: int) -> dict[str, list[str]]:
    """Every output table as sorted JSON text without the database-generated run id."""
    out: dict[str, list[str]] = {}
    for t in TABLES:
        rows = ana.execute(
            f"SELECT (to_jsonb(t) - 'analysis_run_id')::text FROM analytics.{t} t "
            "WHERE analysis_run_id = %s ORDER BY 1",
            [run_id],
        ).fetchall()
        ana.rollback()
        out[t] = [r[0] for r in rows]
    return out


def test_analyze_writes_all_outputs_and_wires_spread(
    conns: tuple[psycopg.Connection[Any], psycopg.Connection[Any]],
) -> None:
    admin, ana = conns
    res = run.analyze(ana, options(admin))
    rid = res.run.analysis_run_id
    d = dump(ana, rid)
    assert all(d[t] for t in TABLES), {t: len(v) for t, v in d.items()}
    assert res.n_snapshot == 16 and res.n_alerts > 0
    tv = dict(
        ana.execute(
            "SELECT entity_id, transformed_value FROM analytics.indicator_snapshot "
            "WHERE analysis_run_id=%s AND indicator_id='U3'",
            [rid],
        ).fetchall()
    )
    ana.rollback()
    # last U3 values: base 5+2k plus (i%3); i=29 -> +2. FRA k=2 (9+2) minus DEU k=0 (5+2)
    assert tv["FRA"] == Decimal(4) and tv["ITA"] == Decimal(6)
    assert tv["DEU"] is None and tv["USA"] is None  # benchmarks: level only, no spread
    # withheld U2: in the full rank table, absent from the published one, masked in the view
    full = ana.execute(
        "SELECT count(*) FROM analytics.indicator_rank WHERE analysis_run_id=%s AND indicator_id='U2'",
        [rid],
    ).fetchone()
    pub = ana.execute(
        "SELECT count(*) FROM analytics.indicator_rank_published WHERE analysis_run_id=%s AND indicator_id='U2'",
        [rid],
    ).fetchone()
    scopes = ana.execute(
        "SELECT DISTINCT publish_scope FROM analytics.indicator_snapshot WHERE analysis_run_id=%s AND indicator_id='U2'",
        [rid],
    ).fetchall()
    ana.rollback()
    assert full == (4,) and pub == (0,) and scopes == [("excluded",)]


def perturb_withheld(admin: psycopg.Connection[Any]) -> None:
    """A new raw object and a new vintage (value * 7 + 3) for every withheld-source series."""
    from datetime import timedelta

    from macro_monitor.storage import manifest

    known = b.BASE + timedelta(days=25)
    run_id = int(admin.execute("SELECT max(run_id) FROM ingest.run").fetchone()[0])  # type: ignore[index]
    sha = f"{999:064x}"
    manifest.insert_blob(
        admin, sha256=sha, byte_count=1, storage_backend="local_dir",
        storage_ref="fixture/p", first_stored_at=known,
    )  # fmt: skip
    prev = manifest.latest_state(admin, "W", "perturb").raw_id
    raw_id = manifest.insert_raw_object(
        admin,
        manifest.NewRawObject(
            run_id=run_id, source_id="W", group_id="G", request_key="perturb",
            request_url="https://x/", request_params={}, http_status=200, etag=None,
            last_modified=None, content_type=None, fetched_at=known, sha256=sha,
            fetch_mode="full", fetch_scope="complete", parser_id="p@1",
        ),
        prev,
    )  # fmt: skip
    admin.execute(
        "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, "
        "value_status, load_kind, known_at, loaded_at, vintage_label, raw_id, run_id) "
        "SELECT o.series_id, o.ref_period_start, o.ref_period_end, o.value * 7 + 3, o.value_status, "
        "'revision', %s, %s, o.vintage_label, %s, %s FROM curated.observation o "
        "JOIN ref.series s USING (series_id) WHERE s.source_id = 'W'",
        [known, known + b.LOAD_DELAY, raw_id, run_id],
    )


def test_two_runs_same_inputs_are_identical(
    conns: tuple[psycopg.Connection[Any], psycopg.Connection[Any]],
) -> None:
    """AC-AN-1: output rows equal over natural keys, analysis_run_id and cutoffs excluded."""
    admin, ana = conns
    opt = options(admin)
    r1 = run.analyze(ana, opt)
    r2 = run.analyze(ana, opt)
    assert r1.run.analysis_run_id != r2.run.analysis_run_id
    assert dump(ana, r1.run.analysis_run_id) == dump(ana, r2.run.analysis_run_id)


def test_withheld_perturbation_leaves_published_set_unchanged(
    conns: tuple[psycopg.Connection[Any], psycopg.Connection[Any]],
) -> None:
    """AC-AN-10 / AC-AN-25: change every withheld value (new vintage), re-run, compare."""
    admin, ana = conns
    opt = options(admin)
    r1 = run.analyze(ana, opt)
    perturb_withheld(admin)
    admin.commit()
    r2 = run.analyze(ana, opt)
    d1, d2 = dump(ana, r1.run.analysis_run_id), dump(ana, r2.run.analysis_run_id)
    for t in ("indicator_rank_published", "indicator_alignment_published", "scorecard_published"):
        assert d1[t] == d2[t], t
    # the full set does see the change (values move; the rank order of a monotone map does not)
    assert d1["indicator_snapshot"] != d2["indicator_snapshot"]
    views = []
    for rid in (r1.run.analysis_run_id, r2.run.analysis_run_id):
        views.append(
            ana.execute(
                "SELECT indicator_id, entity_id, value, transformed_value, deviation, ref_offset_days, publish_scope, alignment "
                "FROM analytics.v_indicator_snapshot_published WHERE analysis_run_id=%s ORDER BY 1, 2",
                [rid],
            ).fetchall()
        )
        ana.rollback()
    assert views[0] == views[1]
    alerts_ = [
        ana.execute(
            "SELECT count(*) FROM analytics.v_alert_published WHERE analysis_run_id=%s AND indicator_id='U2'",
            [rid],
        ).fetchone()
        for rid in (r1.run.analysis_run_id, r2.run.analysis_run_id)
    ]
    ana.rollback()
    assert alerts_ == [(0,), (0,)]


def test_reproduction_reports_hash_mismatch(
    conns: tuple[psycopg.Connection[Any], psycopg.Connection[Any]],
) -> None:
    admin, ana = conns
    r = run.analyze(ana, options(admin))
    ok = {"git_sha": "g", "config_sha256": "c", "mapping_sha256": "m", "overrides_sha256": "o"}
    assert run.check_reproduction(ana, r.run.analysis_run_id, ok) == []
    got = run.check_reproduction(ana, r.run.analysis_run_id, {**ok, "config_sha256": "changed"})
    assert [(m.field, m.stored, m.current) for m in got] == [("config_sha256", "c", "changed")]
    assert runctx.load_run(ana, r.run.analysis_run_id).config_sha256 == "c"


def test_failure_rolls_back_outputs_but_keeps_run_row(
    conns: tuple[psycopg.Connection[Any], psycopg.Connection[Any]],
) -> None:
    """One output transaction: a failing alert config leaves no partial output."""
    admin, ana = conns
    admin.execute("UPDATE ref.indicator SET params = '{}'::jsonb WHERE indicator_id = 'U4'")
    admin.commit()
    from macro_monitor.analytics import alerts

    with pytest.raises(alerts.AlertConfigError):
        run.analyze(ana, options(admin))
    n_run = ana.execute("SELECT count(*) FROM analytics.run").fetchone()
    n_snap = ana.execute("SELECT count(*) FROM analytics.indicator_snapshot").fetchone()
    ana.rollback()
    assert n_run == (1,) and n_snap == (0,)


def test_compute_hashes_stable_and_sensitive_to_mapping(
    conns: tuple[psycopg.Connection[Any], psycopg.Connection[Any]],
) -> None:
    admin, ana = conns
    h1 = run.compute_hashes(ana)
    assert h1 == run.compute_hashes(ana) and len(h1[0]) == 64 and len(h1[1]) == 64
    admin.execute("UPDATE ref.indicator SET priority = 'dropped' WHERE indicator_id = 'U4'")
    admin.commit()
    h2 = run.compute_hashes(ana)
    assert h2[0] != h1[0]


def test_published_tables_match_golden(
    conns: tuple[psycopg.Connection[Any], psycopg.Connection[Any]],
) -> None:
    """Golden output of the published set for the scenario (regenerate: MM_UPDATE_GOLDEN=1)."""
    import json
    import os

    admin, ana = conns
    res = run.analyze(ana, options(admin))
    d = dump(ana, res.run.analysis_run_id)
    names = ("indicator_rank_published", "indicator_alignment_published", "scorecard_published")
    got = {t: [json.loads(x) for x in d[t]] for t in names}
    path = Path(__file__).parents[1] / "fixtures" / "analytics" / "golden" / "published_set.json"
    text = json.dumps(got, indent=1, sort_keys=True) + "\n"
    if os.environ.get("MM_UPDATE_GOLDEN") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    assert path.read_text() == text
