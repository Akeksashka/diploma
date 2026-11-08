"""T137 / ADR-027 / AC-CFG-20 (a)-(h), (j), AC-ING-23 disabled-group part."""

from __future__ import annotations

import copy
import dataclasses
import json
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest
import yaml

from macro_monitor import cli
from macro_monitor.monitoring.freshness import SeriesInput, record_freshness
from macro_monitor.registry import config as cfg
from macro_monitor.registry.config import load_sources, load_yaml, validate_sources
from macro_monitor.registry.report import build_report
from macro_monitor.registry.sync import LoadedConfig, MapEntry, group_row, load_config

ROOT = Path(__file__).resolve().parents[3]
TODAY = date(2026, 11, 5)
PARKED = (
    "eurostat_sts",
    "eurostat_hicp",
    "eurostat_gov_debt",
    "eurostat_gdp_q",
    "worldbank_support",
)

pytestmark = pytest.mark.unit


def raw_doc() -> dict[str, Any]:
    d = load_yaml(ROOT / "config" / "sources.yaml")
    assert isinstance(d, dict)
    return d


def source(d: dict[str, Any], sid: str) -> dict[str, Any]:
    return next(s for s in d["sources"] if s["id"] == sid)  # type: ignore[no-any-return]


def group(d: dict[str, Any], gid: str) -> dict[str, Any]:
    for s in d["sources"]:
        for g in s.get("groups") or []:
            if g["id"] == gid:
                return g  # type: ignore[no-any-return]
    raise KeyError(gid)


def load(d: dict[str, Any], tmp_path: Path) -> cfg.SourcesConfig:
    p = tmp_path / "s.yaml"
    p.write_text(yaml.safe_dump(d), encoding="utf-8")
    return load_sources(p, today=TODAY)


# ------------------------------------------------------------------ schema (h)


def test_schema_accepts_boolean_and_rejects_other_types() -> None:
    d = raw_doc()
    for ok in (True, False):
        group(d, "eurostat_labour")["enabled"] = ok
        assert validate_sources(d) == []
    group(d, "eurostat_labour")["enabled"] = "no"
    assert validate_sources(d)
    del group(d, "eurostat_labour")["enabled"]
    group(d, "eurostat_labour")["enable"] = False  # typo is still an unknown key
    assert validate_sources(d)


# ------------------------------------------------------------ effective state (a)(c)


@pytest.mark.parametrize(
    ("src_on", "grp_on", "want"),
    [(True, True, True), (True, False, False), (False, True, False), (False, False, False)],
)
def test_effective_group_enabled_matrix(
    tmp_path: Path, src_on: bool, grp_on: bool, want: bool
) -> None:
    d = raw_doc()
    source(d, "eurostat")["enabled"] = src_on
    group(d, "eurostat_labour")["enabled"] = grp_on
    conf = load(d, tmp_path)
    assert conf.effective_group_enabled[("eurostat", "eurostat_labour")] is want
    assert conf.effective_enabled["eurostat"] is src_on


def test_missing_key_equals_source_state(tmp_path: Path) -> None:
    conf = load(raw_doc(), tmp_path)
    assert conf.effective_group_enabled[("eurostat", "eurostat_labour")] is True
    assert conf.effective_group_enabled[("worldbank", "worldbank_annual")] is True
    assert conf.effective_group_enabled[("ecb", "ecb_yields")] is False  # source disabled


def test_web_source_forced_off_disables_groups_despite_group_true(tmp_path: Path) -> None:
    d = raw_doc()
    s = source(d, "eurostat")
    s["kind"] = "web"
    s["rate_limit"] = {"min_interval_s": 5}
    s["terms_review"] = {
        "decision": "permitted", "reviewed_on": "2020-01-01",
        "url": "https://example.org/t", "clause": "q",
    }  # fmt: skip
    s["robots_review"] = {
        "robots_url": "https://example.org/robots.txt",
        "decision": "permitted", "reviewed_on": "2020-01-01",
    }  # fmt: skip
    group(d, "eurostat_labour")["enabled"] = True
    conf = load(d, tmp_path)
    assert conf.skipped_review == ("eurostat",)
    assert conf.effective_group_enabled[("eurostat", "eurostat_labour")] is False
    assert "source switch" in (conf.group_off_reason("eurostat", "eurostat_labour") or "")


def test_off_reason_names_the_switch(tmp_path: Path) -> None:
    d = raw_doc()
    conf = load(d, tmp_path)
    assert conf.group_off_reason("eurostat", "eurostat_labour") is None
    assert "group switch" in (conf.group_off_reason("eurostat", "eurostat_sts") or "")
    assert "source switch" in (conf.group_off_reason("ecb", "ecb_yields") or "")


# ------------------------------------------------------- validation not skipped (d)


def test_disabled_group_still_fails_existing_negatives() -> None:
    d = raw_doc()
    g = group(d, "eurostat_sts")
    assert g["enabled"] is False
    g["series_map"] = "config/series_map/does_not_exist.yaml"
    assert any(i.rule == "7" for i in validate_sources(d, project_root=ROOT))
    g2 = copy.deepcopy(raw_doc())
    del group(g2, "eurostat_sts")["expected_series_min"]
    assert validate_sources(g2)  # schema: required key
    g3 = raw_doc()
    group(g3, "eurostat_sts")["edition_ordered"] = True  # with reestimating: true
    assert any(i.rule == "27" for i in validate_sources(g3))
    g4 = raw_doc()
    group(g4, "eurostat_hicp")["mode_default"] = "incremental"
    assert any(i.rule == "9" for i in validate_sources(g4))
    # rule 6 (check_parsers=True): unimportable parser of a disabled group
    g5 = raw_doc()
    group(g5, "eurostat_sts")["parser"] = "macro_monitor.no_such_module:parse"
    assert any(i.rule == "6" for i in validate_sources(g5, check_parsers=True))
    # missing `freshness` (schema-required) in a disabled group
    g6 = raw_doc()
    del group(g6, "eurostat_sts")["freshness"]
    assert validate_sources(g6)


def test_disabled_group_still_fails_rule_8_ca_seasonal_adjustment(tmp_path: Path) -> None:
    import shutil

    from macro_monitor.registry.sync import SyncError

    shutil.copytree(ROOT / "config", tmp_path / "config")
    shutil.copy(ROOT / ".env.example", tmp_path / ".env.example")
    # Rule 8 only bites for a transform that requires SA; no shipped indicator uses one, so switch
    # M01 (mapped only by the disabled group eurostat_sts) to M3M3_ANN and declare CA there.
    ind = tmp_path / "config" / "indicators.yaml"
    text = ind.read_text(encoding="utf-8")
    sm = tmp_path / "config" / "series_map" / "eurostat_sts.yaml"
    sm.write_text(sm.read_text(encoding="utf-8").replace("SCA", "CA"), encoding="utf-8")
    start = text.index("  - id: M01\n")
    end = text.index("  - id: M02\n")
    ind.write_text(
        text[:start]
        + text[start:end].replace("transform: YOY", "transform: M3M3_ANN")
        + text[end:],
        encoding="utf-8",
    )
    with pytest.raises(SyncError) as exc:
        load_config(tmp_path)
    assert any(i.rule == "8" for i in exc.value.issues)


# ------------------------------------------------------------------ warnings (e)(f)


def test_warning_for_disabled_without_note_only(tmp_path: Path) -> None:
    d = raw_doc()
    g = group(d, "eurostat_labour")
    g["enabled"] = False
    g.pop("note", None)
    conf = load(d, tmp_path)
    notes = [w for w in conf.warnings if "note" in str(w)]
    assert len(notes) == 1 and notes[0].rule == "45"  # noqa: PT018
    g["note"] = "parked until probe"
    assert not [w for w in load(d, tmp_path).warnings if "note" in str(w)]


def test_warning_enabled_source_without_enabled_group(tmp_path: Path) -> None:
    d = raw_doc()
    s = source(d, "eurostat")
    for g in s["groups"]:
        g["enabled"] = False
        g.setdefault("note", "parked")
    conf = load(d, tmp_path)
    assert [str(w) for w in conf.warnings if "no group enabled" in str(w)]
    assert all(w.rule == "45" for w in conf.warnings)


def test_real_config_has_no_warnings(tmp_path: Path) -> None:
    assert load(raw_doc(), tmp_path).warnings == ()


# --------------------------------------------------------------------- rule 3 (g)


def test_rule3_applies_only_with_an_enabled_group(tmp_path: Path) -> None:
    d = raw_doc()
    source(d, "eurostat")["auth"] = {"type": "token", "env": "SOME_TOKEN"}
    conf = load(d, tmp_path)
    assert [i.rule for i in cfg.check_env_present(conf, {})] == ["3"]
    for g in source(d, "eurostat")["groups"]:
        g["enabled"] = False
        g.setdefault("note", "parked")
    assert cfg.check_env_present(load(d, tmp_path), {}) == []


# ------------------------------------------------------------ sha and group_row (a)(i)


def test_group_without_key_keeps_sha_and_row_carries_own_flag() -> None:
    d = raw_doc()
    g = group(d, "eurostat_labour")
    assert "enabled" not in g
    row = group_row("eurostat", g)
    assert row["enabled"] is True
    from macro_monitor.registry.sync import _sha

    assert row["config_sha256"] == _sha(g)
    # golden: sha of the group as written, unchanged by the row's own enabled column
    assert _sha(g) == "99df01f4b1c34442eff7fd83448c7a8695cc6c68d26bf277dfa5044889bcd0d0"
    off = group_row("eurostat", group(d, "eurostat_sts"))
    assert off["enabled"] is False
    assert group_row("x", {"id": "g", "enabled": True})["enabled"] is True


# ----------------------------------------------------------------- real config / CLI


def test_real_config_matrix_excludes_parked_groups() -> None:
    conf = load_config(ROOT)
    matrix = {g["id"] for _, g in cli._groups_of(conf, enabled_only=True)}
    assert not matrix & set(PARKED)
    assert {"eurostat_labour", "worldbank_annual"} <= matrix
    all_ids = {g["id"] for _, g in cli._groups_of(conf, enabled_only=False)}
    assert set(PARKED) <= all_ids  # parked, not removed
    for gid in PARKED:
        g = group(raw_doc(), gid)
        assert g["enabled"] is False
        assert g["note"]


def test_fetch_of_disabled_group_exits_20_naming_group_switch(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert cli.main(["fetch", "--group", "eurostat_sts", "--root", str(ROOT)]) == 20
    err = capsys.readouterr().err
    assert "eurostat_sts" in err
    assert "group switch" in err


def test_fetch_names_source_switch(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["fetch", "--group", "ecb_yields", "--root", str(ROOT)]) == 20
    assert "source switch" in capsys.readouterr().err


def test_ingest_manual_of_disabled_group_exits_20(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    conf = load_config(ROOT)
    d = copy.deepcopy(dict(conf.sources.data))
    group(d, "pinksheet_manual")["enabled"] = False
    group(d, "pinksheet_manual")["note"] = "parked"
    off = load(d, tmp_path)
    monkeypatch.setattr(cli, "_config", lambda root: dataclasses.replace(conf, sources=off))
    assert cli.main(["ingest-manual", "--group", "pinksheet_manual", "--root", str(ROOT)]) == 20
    assert "group switch" in capsys.readouterr().err


def test_load_does_not_skip_a_disabled_group(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """ADR-027 decision 4: the group check passes; it stops later at the missing database."""
    monkeypatch.setenv("MM_GROUPS", "eurostat_sts")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert cli.main(["load", "--root", str(ROOT)]) == 20
    err = capsys.readouterr().err
    assert "DATABASE_URL" in err
    assert "disabled" not in err
    assert "unknown group" not in err


# ------------------------------------------------------------------ monitoring


class _Conn:
    def __init__(self) -> None:
        self.rows: list[list[Any]] = []

    def execute(self, sql: str, params: list[Any]) -> None:
        self.rows.append(params)


def test_record_freshness_skips_disabled_group_and_reenabling_evaluates() -> None:
    entry = {"frequency": "M", "typical_lag_days": 45, "tolerance_days": 20}
    calendar = {"g_on": entry, "g_off": entry}
    inputs = {
        ("s", "g_on"): [SeriesInput(1, date(2026, 8, 31))],
        ("s", "g_off"): [SeriesInput(2, date(2026, 8, 31))],
    }
    at = datetime(2026, 11, 3, tzinfo=UTC)
    conn = _Conn()
    flags = {("s", "g_on"): True, ("s", "g_off"): False}
    res = record_freshness(conn, calendar, inputs, at, group_enabled=flags)  # type: ignore[arg-type]
    assert set(res) == {("s", "g_on")}
    assert [r[1] for r in conn.rows] == ["g_on"]
    conn2 = _Conn()
    res2 = record_freshness(
        conn2, calendar, inputs, at, group_enabled={**flags, ("s", "g_off"): True}
    )  # type: ignore[arg-type]
    assert set(res2) == {("s", "g_on"), ("s", "g_off")}
    conn3 = _Conn()
    assert set(record_freshness(conn3, calendar, inputs, at, group_enabled={})) == set(res2)  # type: ignore[arg-type]


# ---------------------------------------------------------------------- report (j)


@pytest.fixture(scope="module")
def loaded() -> LoadedConfig:
    return load_config(ROOT)


def test_report_disabled_bucket_is_not_mapped(loaded: LoadedConfig) -> None:
    ents = [e for e in loaded.map_entries if e.group_id == "eurostat_sts"][:2]
    assert ents
    rep = build_report(loaded, mapped=ents, pending=[])
    for e in ents:
        c = rep.by_id(e.indicator)
        assert e.entity in c.disabled
        assert c.mapped == 0
        assert e.entity not in c.unmapped
        assert e.entity not in c.pending
    assert rep.disabled_total() == len(ents)
    assert "disabled" in rep.to_text()
    assert json.loads(rep.to_json())["disabled_total"] == len(ents)
    assert not rep.launch_ready()


def test_report_launch_ready_flips_when_disabled_group_is_enabled(
    loaded: LoadedConfig, tmp_path: Path
) -> None:
    """Every core pair is a known_gap except one supplied only by a disabled group."""
    from macro_monitor.registry.report import expected_pairs

    core = {i.id for i in loaded.indicators.indicators if i.values["priority"] == "core"}
    ent = next(
        e
        for e in loaded.map_entries
        if e.group_id == "eurostat_sts" and e.role == "headline" and e.indicator in core
    )
    pair = (ent.indicator, ent.entity)
    gaps = {(i, e) for i, ents in expected_pairs(loaded).items() for e in ents} - {pair}
    assert pair not in gaps
    rep = build_report(loaded, mapped=[ent], pending=[], known_gaps=gaps)
    assert rep.by_id(ent.indicator).disabled == (ent.entity,)
    assert not rep.launch_ready()
    d = raw_doc()
    group(d, "eurostat_sts")["enabled"] = True
    on = dataclasses.replace(loaded, sources=load(d, tmp_path))
    assert build_report(on, mapped=[ent], pending=[], known_gaps=gaps).launch_ready()


def test_report_enabled_group_unchanged(loaded: LoadedConfig) -> None:
    e: MapEntry = next(x for x in loaded.map_entries if x.group_id == "eurostat_labour")
    rep = build_report(loaded, mapped=[e], pending=[])
    c = rep.by_id(e.indicator)
    assert c.mapped == 1
    assert c.disabled == ()
