# ruff: noqa: E501, PT018, C408
"""T83 unit tests: meta files, scorecard and alerts (pass-through, labels, EXP-02/03/05), status helpers.

A stub session answers the producers' SQL by substring, so no database is involved."""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import jsonschema
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "fixtures" / "export"))
import export_fixtures as fx

from macro_monitor.publish import export as ex
from macro_monitor.publish import manifest as mf
from macro_monitor.publish import meta, scorecard, status

CUT = datetime(2026, 10, 15, 6, 0, tzinfo=UTC)
RUN = mf.RunInfo(9, 3, date(2026, 10, 15), CUT, CUT, "v1", fx.FIXTURE_SHA, "c")


class Stub:
    """Quacks like ExportSession: ``fetch`` returns the rows registered for the first matching key."""

    def __init__(self, answers: list[tuple[str, list[tuple[Any, ...]]]]) -> None:
        self.answers = answers
        self.bytes_read = 0
        self.queries = 0

    def fetch(self, query: str, params: Any = None) -> list[tuple[Any, ...]]:
        for key, rows in self.answers:
            if key in query:
                return rows
        raise AssertionError(f"unexpected query: {query[:80]}")


def sink_files(sink: ex.ExportSink) -> dict[str, Any]:
    return {f.path: json.loads(f.data) for f in sink.files}


# ------------------------------------------------------------------ ConfigTree and EXP-03


def test_config_verify_exp_03_sha_mismatch_and_prefix() -> None:
    fx.fixture_config().verify(RUN)
    fx.fixture_config(fx.FIXTURE_SHA[:9]).verify(RUN)  # abbreviated sha of the same commit
    with pytest.raises(ex.ExportError) as ei:
        fx.fixture_config("0" * 40).verify(RUN)
    assert ei.value.check == "EXP-03"


def test_config_from_git_reads_the_commit_not_the_working_tree(tmp_path: Path) -> None:
    def git(*a: str) -> str:
        return subprocess.run(
            ["git", "-C", str(tmp_path), "-c", "user.name=t", "-c", "user.email=t@x", *a],
            check=True, capture_output=True, text=True,
        ).stdout.strip()  # fmt: skip

    git("init", "-q")
    (tmp_path / "config" / "targets").mkdir(parents=True)
    (tmp_path / "config" / "sources.yaml").write_text("sources: []\n")
    (tmp_path / "config" / "targets" / "a.yaml").write_text("indicator: A02\n")
    git("add", ".")
    git("commit", "-q", "-m", "c1")
    sha = git("rev-parse", "HEAD")
    (tmp_path / "config" / "sources.yaml").write_text("sources: [changed]\n")  # working tree drifts
    cfg = meta.ConfigTree.from_git(tmp_path, sha[:10])
    assert cfg.git_sha == sha and cfg.yaml("config/sources.yaml") == {"sources": []}
    assert cfg.listdir("config/targets") == ["a.yaml"]
    cfg.verify(mf.RunInfo(1, 1, date(2026, 1, 1), CUT, CUT, "v", sha, "c"))
    for bad in ("unknown", "--output=x", "f" * 40):
        with pytest.raises(ex.ExportError) as ei:
            meta.ConfigTree.from_git(tmp_path, bad)
        assert ei.value.check == "EXP-03"


def test_config_sourced_fields() -> None:
    cfg = fx.fixture_config()
    assert meta.source_urls(cfg) == {
        "S": "https://example.org/public-source",
        "W": "https://example.org/withheld-source",
        "MAN": "https://example.org/manual",
    }
    prec = meta.group_precisions(cfg)
    assert prec[("S", "U1.DEU")] == 1 and prec[("W", "U2.DEU")] is None  # key absent => null
    assert ("S", "U2.DEU") not in prec
    assert meta.targets_by_indicator(cfg) == {
        "U3": {"value": 0.0, "source_note": "Fixture target: zero by definition."}
    }


# ------------------------------------------------------------------ meta producers


def meta_stub(*, extra_series: list[tuple[Any, ...]] = ()) -> Stub:  # type: ignore[assignment]
    series = [
        (11, "M18", "DEU", "S", "Fixture public source", "U1.DEU", "M", "PC", 0, None, "NSA", "NOM", "NA", "CAL", False, "attr", "public", False),
        (12, "U2", "DEU", "W", "Fixture withheld source", "U2.DEU", "M", "PC", 0, None, "NSA", "NOM", "NA", "CAL", False, "attr", "withheld", False),
        (13, "X01", "DEU", "S", "Fixture public source", "X.DEU", "M", "PC", 0, None, "NSA", "NOM", "NA", "CAL", False, "attr", "public", False),
        *extra_series,
    ]  # fmt: skip
    return Stub(
        [
            ("FROM ref.entity ORDER", [("DEU", "Germany", "country", True, False), ("EA", "Euro area", "aggregate", False, False), ("WLD", "World", "aggregate", False, True)]),
            ("FROM ref.entity_group_member", [("euro_area", "DEU", date(1999, 1, 1), None), ("euro_area", "BGR", date(2026, 1, 1), None), ("old", "DEU", date(1999, 1, 1), date(2000, 1, 1))]),
            ("FROM ref.indicator WHERE", [
                ("M18", "Bond yield", "country", "core", "B1", "MKT45", "SPREAD_VS_REF", "robust_z", 1, 0, None, "descriptive_only", 92),
                ("U2", "Target thing", "country", "core", "B1", "ACT120", "LEVEL", "z", 0, 0, None, "target_distance", 92),
            ]),
            ("FROM ref.indicator_domain", [("fin", "M18"), ("growth", "U2"), ("growth", "X01")]),
            ("FROM ref.v_series_export", series),
            ("FROM ref.domain", [("fin", "Financial", False, Decimal("0.5"), "informational, unranked"), ("growth", "Growth", True, Decimal("0.5"), None)]),
        ]
    )  # fmt: skip


def run_meta(stub: Stub) -> dict[str, Any]:
    sink = ex.ExportSink()
    meta.meta_producer(fx.fixture_config())(stub, RUN, sink)  # type: ignore[arg-type]
    return sink_files(sink)


def test_meta_files_content_and_support_absent() -> None:
    files = run_meta(meta_stub())
    assert sorted(files) == [
        f"meta/{n}.json" for n in ("domains", "entities", "groups", "indicators", "series")
    ]
    ents = {e["entity_id"]: e for e in files["meta/entities.json"]["entities"]}
    assert ents["DEU"]["group_ids"] == ["euro_area"] and ents["DEU"]["iso3"] == "DEU"
    assert ents["EA"]["iso3"] is None and ents["WLD"]["is_global"] is True
    grp = {g["group_id"]: g for g in files["meta/groups.json"]["groups"]}
    assert grp["euro_area"]["members"][0] == {
        "entity_id": "BGR",
        "valid_from": "2026-01-01",
        "valid_to": None,
    }
    inds = {i["indicator_id"]: i for i in files["meta/indicators.json"]["indicators"]}
    assert set(inds) == {"M18", "U2"}
    assert all("is_support" not in i for i in inds.values())  # AC-EXP-7
    assert (
        inds["M18"]["notes"] and "not sovereign credit risk" in inds["M18"]["notes"][0]
    )  # AC-EXP-6
    assert inds["U2"]["target"] is None  # the config target is for U3 only
    assert inds["M18"]["staleness_limit_days"] == 45 and inds["M18"]["frequency_set"] == ["M"]
    assert inds["M18"]["domain_ids"] == ["fin"] and inds["U2"]["domain_ids"] == [
        "growth"
    ]  # X01 row dropped
    doms = {d["domain_id"]: d for d in files["meta/domains.json"]["domains"]}
    assert doms["fin"]["notices"] == ["informational, unranked"] and doms["growth"][
        "indicator_ids"
    ] == ["U2"]
    assert doms["fin"]["percentile_rank_label"] == "mean percentile of the domain's indicators"
    series = {s["series_id"]: s for s in files["meta/series.json"]["series"]}
    assert set(series) == {11, 12}  # the input X01 series is absent
    assert (
        series[11]["source_url"] == "https://example.org/public-source"
        and series[11]["published_precision"] == 1
    )
    assert series[12]["publish"] == "withheld" and series[12]["published_precision"] is None
    assert "X01" not in json.dumps(files)


def test_meta_target_for_target_distance_indicator() -> None:
    stub = meta_stub()
    stub.answers[2] = ("FROM ref.indicator WHERE", [
        ("U3", "T", "country", "core", "B1", "ACT120", "LEVEL", "z", 0, 0, None, "target_distance", 92)
    ])  # fmt: skip
    stub.answers[4] = ("FROM ref.v_series_export", [])
    files = run_meta(stub)
    assert files["meta/indicators.json"]["indicators"][0]["target"] == {
        "value": 0.0,
        "source_note": "Fixture target: zero by definition.",
    }


def test_meta_exp_03_incomplete_series_and_wrong_sha() -> None:
    bad = (
        14,
        "M18",
        "USA",
        "S",
        "n",
        "",
        "M",
        "PC",
        0,
        None,
        "NSA",
        "NOM",
        "NA",
        "CAL",
        False,
        "a",
        "public",
        False,
    )
    with pytest.raises(ex.ExportError) as ei:
        run_meta(meta_stub(extra_series=[bad]))
    assert ei.value.check == "EXP-03"
    with pytest.raises(ex.ExportError) as e2:
        meta.meta_producer(fx.fixture_config("1" * 40))(meta_stub(), RUN, ex.ExportSink())  # type: ignore[arg-type]
    assert e2.value.check == "EXP-03"


def test_meta_schemas_reject_is_support_and_unknown_keys() -> None:
    files = run_meta(meta_stub())
    doc = files["meta/indicators.json"]
    doc["indicators"][0]["is_support"] = False
    with pytest.raises(jsonschema.ValidationError):
        mf.validate_json(doc, "meta-indicators")


# ------------------------------------------------------------------ scorecard


def snap(ind: str, ent: str, **kw: Any) -> tuple[Any, ...]:
    base: dict[str, Any] = dict(
        series_id=100, value=Decimal("3.4"), transformed_value=Decimal("3.4"), transform_id="LEVEL",
        value_kind="observed", ref_period_end=date(2026, 8, 31), ref_offset_days=0,
        known_at=datetime(2026, 10, 2, 4, 30, tzinfo=UTC), source_release_at=None, age_days=48,
        stale_limit_days=120, limit_source="class", is_stale=False, alignment="aligned",
        alignment_reason=None, inherited=False, deviation=None, publish=True, publish_scope="ranked",
    )  # fmt: skip
    base.update(kw)
    return (ind, ent, *[base[c] for c in scorecard.SNAP_COLS[2:]])


def sc_row(domain: str, ent: str, **kw: Any) -> tuple[Any, ...]:
    base: dict[str, Any] = dict(
        n_available=3, n_defined=3, percentile_rank=Decimal("0.62"), rank_position=2, n_ranked_entities=3,
        low_coverage=False, heterogeneous_peer_set=True, peer_set_size_min=25, peer_set_size_max=42,
        publish_scope="ranked",
    )  # fmt: skip
    base.update(kw)
    return (domain, ent, *[base[c] for c in scorecard.SC_COLS[2:]])


def sc_stub(*, snaps: list[tuple[Any, ...]], sc: list[tuple[Any, ...]], domains: list[tuple[Any, ...]] | None = None, in_dom: list[tuple[Any, ...]] | None = None, ents: list[tuple[Any, ...]] | None = None, ranks: list[tuple[Any, ...]] | None = None, alerts: list[tuple[Any, ...]] | None = None) -> Stub:  # fmt: skip
    return Stub(
        [
            ("FROM ref.domain", domains or [("labour", True, Decimal("0.5")), ("global", False, Decimal("0.5"))]),
            ("rank_mode FROM ref.indicator", [("M09", "monotone_good"), ("M10", "monotone_good"), ("M11", "descriptive_only"), ("G1", "descriptive_only")]),
            ("FROM ref.indicator_domain", in_dom or [("labour", "M09"), ("labour", "M10"), ("labour", "M11"), ("global", "G1"), ("labour", "X01")]),
            ("is_global FROM ref.entity", ents or [("DEU", False), ("IND", False), ("LAG", False), ("AHD", False), ("WLD", True)]),
            ("analytics.scorecard_published", sc),
            ("v_indicator_snapshot_published", snaps),
            ("indicator_rank_published", ranks or []),
            ("indicator_alignment_published", [("M09", date(2026, 8, 31), 61, 38, 2, 92)]),
            ("v_alert_published", alerts or []),
        ]
    )  # fmt: skip


def run_scorecard(stub: Stub) -> dict[str, Any]:
    sink = ex.ExportSink()
    scorecard.scorecard_producer(stub, RUN, sink)  # type: ignore[arg-type]
    return sink_files(sink)


def full_stub() -> Stub:
    snaps = [
        snap("M09", "DEU"),
        snap("M09", "IND", alignment="unaligned", alignment_reason="fiscal_year_basis", ref_offset_days=-300),
        snap("M09", "LAG", alignment="lagging", ref_offset_days=-120, ref_period_end=date(2026, 4, 30)),
        snap("M09", "AHD", alignment="ahead", ref_offset_days=30),
        snap("M10", "DEU", value_kind="estimate", limit_source="release_lag_aware"),
        snap("M09", "XXX", publish=False, publish_scope="excluded", value=None, transformed_value=None, ref_offset_days=None),
        snap("G1", "WLD", publish_scope="info_only"),
    ]  # fmt: skip
    sc = [sc_row("labour", e) for e in ("DEU", "IND", "LAG", "AHD")]
    ranks = [("M09", "DEU", Decimal("0.70"), 38), ("M09", "AHD", Decimal("0.40"), 38)]
    alerts = [("M09", "DEU", "none", "full"), ("M10", "DEU", "watch", "low")]
    return sc_stub(snaps=snaps, sc=sc, ranks=ranks, alerts=alerts)


def test_scorecard_pass_through_ac_exp_6_and_11() -> None:
    files = run_scorecard(full_stub())
    assert sorted(files) == ["scorecard/global.json", "scorecard/labour.json"]
    lab = files["scorecard/labour.json"]
    assert "modal_ref_period_end" not in json.dumps(files)  # AC-EXP-6
    assert lab["alignment"][0] == {
        "indicator_id": "M09",
        "rank_reference_period": "2026-08-31",
        "reference_period_spread_days": 61,
        "n_ranked": 38,
        "n_unaligned": 2,
        "max_ref_spread_days": 92,
    }
    assert [a["indicator_id"] for a in lab["alignment"]] == ["M09", "M10", "M11"]
    assert (
        lab["alignment"][2]["rank_reference_period"] is None
    )  # unranked indicator: null, not derived
    assert lab["heterogeneous_peer_set"] is True and lab["peer_set_size_by_indicator"] == {
        "min": 25,
        "max": 42,
    }  # AC-EXP-11
    ents = {e["entity_id"]: e for e in lab["entities"]}
    assert set(ents) == {"DEU", "IND", "LAG", "AHD", "XXX"}
    row = {e: {i["indicator_id"]: i for i in v["indicators"]} for e, v in ents.items()}
    assert (
        row["IND"]["M09"]["alignment"] == "unaligned"
        and row["IND"]["M09"]["alignment_reason"] == "fiscal_year_basis"
    )
    assert row["IND"]["M09"]["percentile"] is None and row["LAG"]["M09"]["percentile"] is None
    assert row["LAG"]["M09"]["alignment"] == "lagging"
    assert row["AHD"]["M09"]["percentile"] == 0.4 and row["AHD"]["M09"]["alignment"] == "ahead"
    assert row["DEU"]["M09"]["percentile"] == 0.7 and row["DEU"]["M09"]["n_ranked"] == 38
    assert (
        row["DEU"]["M10"]["value_kind"] == "estimate"
        and row["DEU"]["M10"]["limit_source"] == "release_lag_aware"
    )
    assert (row["DEU"]["M09"]["alert_level"], row["DEU"]["M10"]["alert_level"]) == ("none", "watch")
    assert row["AHD"]["M09"]["alert_level"] is None  # no alert row => null, never "none"
    ph = row["XXX"]["M09"]  # withheld placeholder: stored view already masks the numbers
    assert (
        ph["published"] is False
        and ph["publish_scope"] == "excluded"
        and ph["value"] is None
        and ph["ref_offset_days"] is None
    )
    assert ents["XXX"]["n_available"] is None  # no scorecard row: not derived
    for e in lab["entities"]:  # label beside every percentile_rank and percentile (AC-EXP-6)
        assert e["percentile_rank_label"] and all(i["percentile_label"] for i in e["indicators"])
    assert "X01" not in json.dumps(files)
    assert [i["indicator_id"] for i in ents["DEU"]["indicators"]] == ["M09", "M10"]


def test_scorecard_wld_only_in_global_domain() -> None:
    files = run_scorecard(full_stub())
    glob = files["scorecard/global.json"]
    assert [e["entity_id"] for e in glob["entities"]] == ["WLD"]
    wld = glob["entities"][0]["indicators"][0]
    assert wld["percentile"] is None and wld["publish_scope"] == "info_only"
    assert "WLD" not in json.dumps(files["scorecard/labour.json"])
    stub = full_stub()
    stub.answers[2] = (
        "FROM ref.indicator_domain",
        [("labour", "G1")],
    )  # WLD under a country domain
    with pytest.raises(ex.ExportError) as ei:
        run_scorecard(stub)
    assert ei.value.check == "EXP-02"


def _g02_stub(domain_id: str) -> Stub:
    """G02 WLD snapshot row; its domain membership is the one given (the shipped config's, or a bad one)."""
    snaps = [snap("M09", "DEU"), snap("G02", "WLD", publish_scope="info_only")]
    doms = [
        ("labour", True, Decimal("0.5")),
        ("agri", False, Decimal("0.5")),
        ("global", False, Decimal("0.5")),
    ]
    stub = sc_stub(snaps=snaps, sc=[sc_row("labour", "DEU")], domains=doms, in_dom=[("labour", "M09"), (domain_id, "G02")])  # fmt: skip
    stub.answers[1] = (
        "rank_mode FROM ref.indicator",
        [("M09", "monotone_good"), ("G02", "descriptive_only")],
    )
    return stub


def test_g02_wld_row_exports_under_global_without_exp_02() -> None:
    from pathlib import Path

    from macro_monitor.registry.indicators import load_indicators

    root = Path(__file__).resolve().parents[2]
    cfg = load_indicators(root / "config/indicators.yaml", root / "config/indicator_defaults.yaml")
    shipped = [d["id"] for d in cfg.by_id("G02").values["domains"]]
    assert shipped == ["global"]  # AC-G02-1: the shipped membership is what the export sees
    files = run_scorecard(_g02_stub(shipped[0]))
    assert [e["entity_id"] for e in files["scorecard/global.json"]["entities"]] == ["WLD"]
    assert "WLD" not in json.dumps(files["scorecard/labour.json"])
    with pytest.raises(
        ex.ExportError
    ) as ei:  # the pre-amendment membership, as seen on the real slice
        run_scorecard(_g02_stub("agri"))
    assert ei.value.check == "EXP-02"


def test_scorecard_exp_05_checks() -> None:
    stub = full_stub()
    stub.answers[4] = (
        "analytics.scorecard_published",
        [sc_row("labour", "DEU"), sc_row("labour", "IND", peer_set_size_max=41)],
    )
    with pytest.raises(ex.ExportError) as ei:
        run_scorecard(stub)
    assert ei.value.check == "EXP-05"
    stub = full_stub()  # rank figures stored for an unranked domain must not be published
    stub.answers[4] = (
        "analytics.scorecard_published",
        [sc_row("global", "WLD", percentile_rank=Decimal("0.5"))],
    )
    with pytest.raises(ex.ExportError) as e2:
        run_scorecard(stub)
    assert e2.value.check == "EXP-05"


def test_scorecard_schema_rejects_modal_ref_period_end() -> None:
    doc = run_scorecard(full_stub())["scorecard/labour.json"]
    doc["alignment"][0]["modal_ref_period_end"] = "2026-08-31"
    with pytest.raises(jsonschema.ValidationError):
        mf.validate_json(doc, "scorecard")


def test_alerts_only_watch_and_alert_rows() -> None:
    stub = Stub(
        [
            ("FROM ref.indicator WHERE", [("M09",), ("M10",)]),
            ("v_alert_published", [("M09", "DEU", 1, date(2026, 8, 31), "robust_z", Decimal("2.4"), "alert", "full", None, "persistent_shift", None)]),
        ]
    )  # fmt: skip
    sink = ex.ExportSink()
    scorecard.alerts_producer(stub, RUN, sink)  # type: ignore[arg-type]
    doc = sink_files(sink)["alerts.json"]
    assert (
        doc["analysis_run_id"] == 9
        and doc["alerts"][0]["z"] == 2.4
        and doc["alerts"][0]["label"] == "persistent_shift"
    )
    stub.answers[1] = (
        "v_alert_published",
        [("X01", "DEU", 1, date(2026, 8, 31), "z", None, "alert", "full", None, None, None)],
    )
    with pytest.raises(ex.ExportError):
        scorecard.alerts_producer(stub, RUN, ex.ExportSink())  # type: ignore[arg-type]


# AC-EXP-11 static check: stored fields are read from their row, never assigned from other fields.
PASS_THROUGH = {"publish_scope", "ref_offset_days", "value_kind", "limit_source", "alignment_reason", "heterogeneous_peer_set", "peer_set_size_by_indicator"}  # fmt: skip


def test_ac_exp_11_static_pass_through_fields() -> None:
    src = Path(scorecard.__file__).read_text()
    tree = ast.parse(src)
    seen: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for k, v in zip(node.keys, node.values, strict=True):
            if isinstance(k, ast.Constant) and k.value in PASS_THROUGH:
                seen.add(str(k.value))
                if (
                    k.value == "peer_set_size_by_indicator"
                ):  # {"min": lo, "max": hi} from _consistent
                    assert isinstance(v, ast.Dict) and all(
                        isinstance(x, ast.Name) for x in v.values
                    )
                elif k.value == "heterogeneous_peer_set":
                    assert isinstance(v, ast.Name) and v.id == "het"
                else:  # s["<same field>"] only: no arithmetic, comparison, call or other column
                    assert isinstance(v, ast.Subscript) and isinstance(v.slice, ast.Constant)
                    assert v.slice.value == k.value, f"{k.value} assigned from {v.slice.value}"
    assert seen == PASS_THROUGH
    for node in ast.walk(tree):  # no augmented assignment or arithmetic on the stored fields
        if (
            isinstance(node, ast.Subscript)
            and isinstance(node.slice, ast.Constant)
            and node.slice.value in PASS_THROUGH
        ):
            assert isinstance(node.ctx, ast.Load)


# ------------------------------------------------------------------ status


def test_last_run_alerts_opened_null_passthrough() -> None:
    started = datetime(2026, 10, 1, 4, 0, tzinfo=UTC)
    stub = Stub([("v_run_summary_public", [(3, started, None, "refresh", 2, 10, 1, None)])])
    doc = status.last_run(stub, 3)  # type: ignore[arg-type]
    assert (
        doc["alerts_opened"] is None
        and doc["started_at"] == "2026-10-01T04:00:00Z"
        and doc["finished_at"] is None
    )
    with pytest.raises(ex.ExportError):
        status.last_run(Stub([("v_run_summary_public", [])]), 3)  # type: ignore[arg-type]


def test_validation_block_cov01_and_drift_counts() -> None:
    stub = Stub([
        ("v_validation_counts", [
            ("COV", "COV-01", "info", "M01", 1, 0, 12, False),
            ("COV", "COV-01", "info", "M02", 1, 0, 3, True),
            ("COV", "COV-01", "warn", "M03", 1, 1, 15, False),
            ("REV", "REV-01", "warn", None, 4, 2, None, None),
        ]),
        ("v_open_drift", [("unit",), ("unit",), ("frequency",)]),
    ])  # fmt: skip
    v = status.validation_block(stub, 3)  # type: ignore[arg-type]
    assert {"check_family": "COV", "severity": "info", "n_results": 2, "n_failed": 0} in v["counts"]
    cov = {c["indicator_id"]: c for c in v["cov01"]}
    assert cov["M02"] == {"indicator_id": "M02", "n_qualifying": 3, "state": "not_yet_measurable"}
    assert cov["M03"]["state"] == "measured" and cov["M03"]["n_failed"] == 1
    assert v["open_drift"] == {"n_open": 3, "by_kind": {"frequency": 1, "unit": 2}}
    assert "old" not in json.dumps(v) and "new" not in v["open_drift"]


def test_manual_sources_next_window_from_config() -> None:
    stub = Stub(
        [("v_manual_sources", [("MAN", date(2026, 4, 14), datetime(2026, 4, 20, tzinfo=UTC))])]
    )
    out = status.manual_sources(stub, fx.fixture_config(), date(2026, 10, 15))  # type: ignore[arg-type]
    assert out == [{"source_id": "MAN", "last_edition_date": "2026-04-14", "last_ingested_at": "2026-04-20T00:00:00Z",
                    "next_expected": {"window_from": "2026-10-10", "window_to": "2026-10-24", "remind_on": "2026-10-25"}}]  # fmt: skip
    after = status.manual_sources(
        Stub([("v_manual_sources", [])]), fx.fixture_config(), date(2026, 10, 30)
    )  # type: ignore[arg-type]
    assert (
        after[0]["next_expected"]["window_from"] == "2027-04-10"
        and after[0]["last_ingested_at"] is None
    )


def test_groups_block_omits_disabled_groups() -> None:
    import textwrap

    text = textwrap.dedent("""
        sources:
          - id: a
            enabled: true
            groups: [{id: on}, {id: off, enabled: false}]
          - id: b
            enabled: false
            groups: [{id: own_true, enabled: true}]
    """)
    cfg = mf_config(text)
    rows = [
        (sg, ser, "fresh", date(2026, 9, 30), date(2026, 9, 30), CUT)
        for sg, ser in [("a", "on"), ("a", "off"), ("b", "own_true"), ("z", "unlisted")]
    ]
    stub = Stub([("ops.v_freshness_latest", rows), ("ops.v_backlog", [(0, None)])])
    out = status.groups_block(stub, cfg)  # type: ignore[arg-type]
    assert [(g["source_group"], g["series_group"]) for g in out["groups"]] == [
        ("a", "on"),
        ("z", "unlisted"),
    ]


def mf_config(sources_yaml: str) -> meta.ConfigTree:
    return meta.ConfigTree(fx.FIXTURE_SHA, lambda rel: sources_yaml, lambda rel: [])


def test_status_producer_document_validates_and_is_deterministic() -> None:
    gen = datetime(2026, 11, 1, 6, 5, tzinfo=UTC)
    stub = Stub([
        ("ops.v_freshness_latest", [("ecb", "yields", "late", date(2026, 9, 30), date(2026, 8, 31), CUT)]),
        ("ops.v_backlog", [(2, timedelta(days=1, hours=1, seconds=5))]),
        ("v_run_summary_public", [(3, CUT, CUT, "refresh", 1, 2, 3, 4)]),
        ("v_validation_counts", []),
        ("v_open_drift", []),
        ("v_manual_sources", []),
    ])  # fmt: skip
    outs = []
    for _ in range(2):
        sink = ex.ExportSink()
        status.status_producer(fx.fixture_config(), generated_at=gen)(stub, RUN, sink)  # type: ignore[arg-type]
        outs.append(sink.files[0].data)
    assert outs[0] == outs[1]
    doc = json.loads(outs[0])
    assert doc["backlog"] == {"n_unloaded": 2, "oldest_age_days": 1}
    assert (
        doc["groups"][0]["state"] == "late"
        and doc["schedule_check"]["generated_at"] == "2026-11-01T06:05:00Z"
    )
    assert "(5) every April and October" in doc["schedule_check"]["text"]


def test_ac_exp_12_no_vintage_resolution_fields_in_code_or_schemas() -> None:
    root = Path(meta.__file__).parent
    for p in [*root.glob("*.py"), *root.glob("schemas/*.json")]:
        text = p.read_text()
        assert "vintage_resolution" not in text.replace("`vintage_resolution`", ""), p.name
        assert "release_cadence_note" not in text, p.name
