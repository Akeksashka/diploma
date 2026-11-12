"""T07: sources.yaml schema, loader and config rules (docs/specs/source-config-schema.md)."""

from __future__ import annotations

import copy
import re
import sys
import textwrap
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml

from macro_monitor.registry import config as cfg
from macro_monitor.registry.config import (
    ConfigError,
    ConfigIssue,
    indicator_input_issues,
    load_sources,
    load_yaml,
    validate_sources,
)

ROOT = Path(__file__).resolve().parents[3]
TODAY = date(2026, 10, 27)

_DOC = textwrap.dedent(
    """\
    archive_policy:
      private_repo: null
    sources:
      - id: eurostat
        name: Eurostat dissemination API
        provider: Eurostat
        kind: sdmx
        enabled: true
        wave: 1
        base_url: https://ec.europa.eu/eurostat/api/dissemination/
        auth: {type: none}
        http:
          user_agent_template: "macro-monitor/{version} (+{repo_url}; non-commercial research)"
          timeout_s: 120
          retries: {max: 4, backoff_s: 2, backoff_factor: 2, jitter: true, on: [429, 500, timeout]}
        rate_limit: {max_concurrent: 1, min_interval_s: 2, budget_per_hour: null}
        licence:
          id: eurostat-reuse
          url: https://ec.europa.eu/eurostat/web/main/help/copyright-notice
          checked_on: 2026-10-17
          non_commercial_ok: true
          attribution: "Source: Eurostat"
          redistribution_of_raw: allowed
        archive: public
        publish_site: public
        automated_access: allowed
        change_detection: [update_marker, content_hash]
        groups:
          - id: eurostat_sts
            description: Short-term business statistics
            request_template:
              path: statistics/1.0/data/{dataset}
              params: {format: JSON}
              datasets: [sts_inpr_m]
              fixed_filters: {sts_inpr_m: {indic_bt: PROD}}
            format: jsonstat
            parser: macro_monitor.ingestion.parsers.jsonstat:parse
            missing_markers: [":"]
            fetch_scope: complete
            mode_default: full
            full_refresh_every: 3
            series_map: config/series_map/eurostat_sts.yaml
            expected_series_min: 50
            freshness: {frequency: M, typical_lag_days: 50, tolerance_days: 20}
            job_timeout_min: 120
            reestimating: false
            published_precision: null
            revision:
              compare: published_decimals
              decimals: null
              rel_epsilon: 1.0e-9
              max_revised_rows: null
              materiality_abs: 0
              materiality_rel: 0
              snapshot_mode: none
            max_insert_rows_per_load: 100000
            on_failure: alert
      - id: imf_weo_manual
        name: IMF World Economic Outlook (manual download)
        provider: IMF
        kind: manual
        automated_access: manual_only
        enabled: true
        licence: {id: imf-terms, url: "https://www.imf.org/terms", checked_on: 2026-10-17,
                  non_commercial_ok: true, attribution: "Source: IMF WEO",
                  redistribution_of_raw: allowed}
        archive: public
        publish_site: public
        terms_review: {decision: permitted, reviewed_on: 2026-10-17, url: https://www.imf.org/en/About/copyright-and-terms,
                       clause: "[to be quoted]"}
        inbox: {path: manual_inbox/imf_weo_manual,
                sidecar_required: [source_url, downloaded_on, downloaded_by, edition_label,
                                   edition_date],
                sidecar_optional: [licence_note, import_label]}
        reminders:
          - {expected_window: {month: 4, from_day: 10, to_day: 24},
             remind_on: {month: 4, day: 25},
             text: "April WEO should be out by now"}
          - {expected_window: {month: 10, from_day: 10, to_day: 24},
             remind_on: {month: 10, day: 25},
             text: "October WEO should be out by now"}
        groups:
          - id: imf_weo_files
            format: csv_or_xlsx
            parser: macro_monitor.ingestion.parsers.weo:parse
            fetch_scope: complete
            edition_ordered: true
            reestimating: false
            series_map: config/series_map/imf_weo.yaml
            expected_series_min: 100
            freshness: {frequency: A, release_months: [4, 10], tolerance_days: 45}
            published_precision: null
            note: "IMF WEO: semi-annual named editions"
    """
)

REESTIMATING_GROUP: dict[str, Any] = {
    "id": "bis_credit_gap",
    "note": "BIS credit-to-GDP gap, quarterly recompute",
    "format": "csv",
    "parser": "macro_monitor.ingestion.parsers.bis:parse",
    "fetch_scope": "complete",
    "series_map": "config/series_map/bis_credit_gap.yaml",
    "expected_series_min": 40,
    "freshness": {"frequency": "Q", "typical_lag_days": 120, "tolerance_days": 30},
    "reestimating": True,
    "revision": {
        "max_revised_rows": 5000,
        "materiality_rel": 0.001,
        "materiality_abs": 0,
        "snapshot_mode": "diff_above_tol",
    },
}


def doc() -> dict[str, Any]:
    """A fresh valid document (dates as strings, like the loader produces)."""
    loaded = yaml.load(_DOC, Loader=cfg._Loader)
    assert isinstance(loaded, dict)
    return loaded


def src(d: dict[str, Any], source_id: str = "eurostat") -> dict[str, Any]:
    return next(s for s in d["sources"] if s["id"] == source_id)  # type: ignore[no-any-return]


def grp(d: dict[str, Any], source_id: str = "eurostat") -> dict[str, Any]:
    return src(d, source_id)["groups"][0]  # type: ignore[no-any-return]


def rules(issues: list[ConfigIssue]) -> set[str]:
    return {i.rule for i in issues}


def assert_fails(d: object, rule: str, **kw: Any) -> list[ConfigIssue]:
    issues = validate_sources(d, **kw)
    assert rule in rules(issues), [str(i) for i in issues]
    return issues


# ---------------------------------------------------------------- baseline


def test_valid_document_passes() -> None:
    assert validate_sources(doc()) == []


def test_real_config_loads_and_has_archive_policy() -> None:
    conf = load_sources(ROOT / "config" / "sources.yaml", env_example=ROOT / ".env.example")
    assert conf.data["archive_policy"] == {"private_repo": None}
    assert [x["id"] for x in conf.data["sources"]] == [
        "eurostat",
        "ecb",
        "worldbank",
        "bis",
        "oecd",
        "worldbank_pinksheet",
        "fao",
        "worldbank_pinksheet_manual",  # T64
        "fao_manual",  # T64
        "faostat",
        "ec_surveys",
        "dbnomics",
        "imf_weo_manual",  # WEO October 2026
    ]  # T23, T52, T55/T56, T54, T57, T58


def test_schema_is_a_valid_draft_2020_12_schema_and_package_data() -> None:
    from jsonschema import Draft202012Validator

    Draft202012Validator.check_schema(cfg.sources_schema())
    assert (ROOT / "src/macro_monitor/registry/schemas/sources.schema.json").is_file()


def test_load_yaml_keeps_dates_as_strings_and_uses_yaml12_booleans(tmp_path: Path) -> None:
    p = tmp_path / "x.yaml"
    p.write_text("a: 2026-10-17\non: [1]\ncode: NO\nflag: true\n", encoding="utf-8")
    assert load_yaml(p) == {"a": "2026-10-17", "on": [1], "code": "NO", "flag": True}


def test_load_sources_roundtrip_and_error(tmp_path: Path) -> None:
    good = tmp_path / "ok.yaml"
    good.write_text(_DOC, encoding="utf-8")
    conf = load_sources(good, today=TODAY)
    assert conf.effective_enabled == {"eurostat": True, "imf_weo_manual": True}
    bad = tmp_path / "bad.yaml"
    bad.write_text(_DOC.replace("publish_site: public", "publish_site: nope", 1), encoding="utf-8")
    with pytest.raises(ConfigError) as exc:
        load_sources(bad)
    assert "publish_site" in str(exc.value)


# ---------------------------------------------------------------- unknown keys


@pytest.mark.parametrize("where", ["root", "source", "group", "revision", "licence"])
def test_unknown_keys_are_errors(where: str) -> None:
    d = doc()
    target = {
        "root": d,
        "source": src(d),
        "group": grp(d),
        "revision": grp(d)["revision"],
        "licence": src(d)["licence"],
    }[where]
    target["surprise"] = 1
    assert_fails(d, "schema")


# ---------------------------------------------------------------- rules 1-7


def _web(**over: Any) -> dict[str, Any]:
    d = doc()
    s = src(d)
    s["kind"] = "web"
    s["rate_limit"] = {"min_interval_s": 5}
    s["terms_review"] = {
        "decision": "permitted",
        "reviewed_on": "2026-06-01",
        "url": "https://example.org/terms",
        "clause": "quoted",
    }
    s["robots_review"] = {
        "robots_url": "https://example.org/robots.txt",
        "decision": "permitted",
        "reviewed_on": "2026-06-01",
    }
    s.update(over)
    return d


def _load(d: dict[str, Any], tmp_path: Path, today: date = TODAY) -> cfg.SourcesConfig:
    p = tmp_path / "s.yaml"
    p.write_text(yaml.safe_dump(d), encoding="utf-8")
    return load_sources(p, today=today)


def test_rule1_current_web_review_keeps_source_enabled(tmp_path: Path) -> None:
    conf = _load(_web(), tmp_path)
    assert conf.effective_enabled["eurostat"] is True
    assert conf.skipped_review == ()


@pytest.mark.parametrize(
    "mutate",
    [
        lambda s: s["terms_review"].update(reviewed_on="2025-10-26"),  # 366 days old
        lambda s: s["terms_review"].update(decision="unclear"),
        lambda s: s["robots_review"].update(decision="disallowed"),
        lambda s: s.pop("terms_review"),
        lambda s: s.pop("robots_review"),
    ],
)
def test_rule1_stale_or_unpermitted_web_review_is_skipped_review(
    tmp_path: Path, mutate: Any
) -> None:
    d = _web()
    mutate(src(d))
    conf = _load(d, tmp_path)
    assert conf.effective_enabled["eurostat"] is False
    assert conf.skipped_review == ("eurostat",)


def test_rule1_365_days_old_review_is_still_current() -> None:
    s = _web()["sources"][0]
    s["terms_review"]["reviewed_on"] = "2025-10-27"
    assert cfg.web_review_ok(s, TODAY)


def test_rule2_manual_only_requires_manual_kind() -> None:
    d = doc()
    src(d)["automated_access"] = "manual_only"
    assert_fails(d, "2")


def test_rule3_env_name_must_be_documented() -> None:
    d = doc()
    src(d)["auth"] = {"type": "api_key", "env": "FRED_API_KEY", "in": "query", "name": "api_key"}
    assert_fails(d, "3", env_names=frozenset({"OTHER"}))
    assert validate_sources(d, env_names=frozenset({"FRED_API_KEY"})) == []


def test_rule3_env_must_be_set_at_plan_time_when_enabled(tmp_path: Path) -> None:
    d = doc()
    src(d)["auth"] = {"type": "token", "env": "SOME_TOKEN"}
    conf = _load(d, tmp_path)
    assert [i.rule for i in cfg.check_env_present(conf, {})] == ["3"]
    assert cfg.check_env_present(conf, {"SOME_TOKEN": "x"}) == []
    src(d)["enabled"] = False
    assert cfg.check_env_present(_load(d, tmp_path), {}) == []


def test_rule3_auth_type_without_env_is_rejected() -> None:
    d = doc()
    src(d)["auth"] = {"type": "api_key"}
    assert_fails(d, "schema")


def test_rule4_automated_source_without_rate_limit() -> None:
    d = doc()
    del src(d)["rate_limit"]
    assert_fails(d, "4")


def test_rule4_budget_alone_satisfies() -> None:
    d = doc()
    src(d)["rate_limit"] = {"min_interval_s": None, "budget_per_hour": 8}
    assert validate_sources(d) == []


def test_rule4_web_defaults_apply() -> None:
    d = _web()
    del src(d)["rate_limit"]
    assert validate_sources(d) == []


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("rate_limit", {"min_interval_s": 2}),
        ("http", {"timeout_s": 10}),
        ("change_detection", ["content_hash"]),
        ("base_url", "https://example.org"),
        ("auth", {"type": "none"}),
    ],
)
def test_rule4_manual_source_must_not_carry_automated_blocks(key: str, value: Any) -> None:
    d = doc()
    src(d, "imf_weo_manual")[key] = value
    assert_fails(d, "4")


def test_rule5_public_archive_with_forbidden_redistribution() -> None:
    d = doc()
    src(d)["licence"]["redistribution_of_raw"] = "forbidden"
    issues = assert_fails(d, "5")
    assert "15" in rules(issues)  # publish_site: public is rejected too


def test_rule5_unclear_licence_options() -> None:
    d = doc()
    src(d)["licence"]["redistribution_of_raw"] = "unclear"
    assert_fails(d, "5")  # public without user_decision
    src(d)["licence"]["user_decision"] = {"by": "user", "on": "2026-10-27", "rationale": "ok"}
    assert validate_sources(d) == []
    src(d)["archive"] = "hash_only"
    assert validate_sources(d) == []
    src(d)["archive"] = "private"
    d["archive_policy"]["private_repo"] = "owner/name"
    assert_fails(d, "5")


def test_rule6_parser_must_resolve_with_parser_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    d = doc()
    issues = assert_fails(d, "6", check_parsers=True)  # modules do not exist yet
    assert any("not importable" in i.message for i in issues)
    (tmp_path / "t07_parser_ok.py").write_text("PARSER_VERSION = '1'\ndef parse(): ...\n")
    (tmp_path / "t07_parser_nover.py").write_text("def parse(): ...\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    grp(d)["parser"] = "t07_parser_ok:parse"
    src(d, "imf_weo_manual")["groups"][0]["parser"] = "t07_parser_ok:parse"
    assert validate_sources(d, check_parsers=True) == []
    grp(d)["parser"] = "t07_parser_nover:parse"
    assert any("PARSER_VERSION" in i.message for i in assert_fails(d, "6", check_parsers=True))
    grp(d)["parser"] = "t07_parser_ok:missing"
    assert_fails(d, "6", check_parsers=True)
    sys.modules.pop("t07_parser_ok", None)
    sys.modules.pop("t07_parser_nover", None)


@pytest.mark.parametrize("key", ["freshness", "series_map", "expected_series_min"])
@pytest.mark.parametrize("source_id", ["eurostat", "imf_weo_manual"])
def test_rule7_group_keys_required_for_every_kind(key: str, source_id: str) -> None:
    d = doc()
    del grp(d, source_id)[key]
    assert_fails(d, "schema")


def test_rule7_series_map_file_must_exist(tmp_path: Path) -> None:
    d = doc()
    assert_fails(d, "7", project_root=tmp_path)
    for g in (grp(d), grp(d, "imf_weo_manual")):
        p = tmp_path / g["series_map"]
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("series: []\n")
    assert validate_sources(d, project_root=tmp_path) == []


# ---------------------------------------------------------------- rules 9, 10, 11


def test_rule9_incremental_requires_partial() -> None:
    d = doc()
    grp(d)["mode_default"] = "incremental"
    assert_fails(d, "9")
    grp(d)["fetch_scope"] = "partial"
    assert validate_sources(d) == []


def test_rule10_fixed_decimals_requires_decimals() -> None:
    d = doc()
    grp(d)["revision"]["compare"] = "fixed_decimals"
    assert_fails(d, "10")
    grp(d)["revision"]["decimals"] = 2
    assert validate_sources(d) == []


def test_rule10_scale_min_no_longer_exists() -> None:
    d = doc()
    grp(d)["revision"]["compare"] = "scale_min"
    assert_fails(d, "schema")


def test_rule10_reestimating_needs_max_revised_rows_and_note() -> None:
    d = doc()
    g = copy.deepcopy(REESTIMATING_GROUP)
    src(d)["groups"].append(g)
    assert validate_sources(d) == []  # section 1a group is valid
    del g["revision"]["max_revised_rows"]
    assert_fails(d, "10")  # AC-CFG-7
    g["revision"]["max_revised_rows"] = 5000
    del g["note"]
    assert_fails(d, "10")


def test_rule10_old_reestimation_key_is_unknown() -> None:
    d = doc()
    grp(d)["revision"]["reestimation"] = True
    assert_fails(d, "schema")


def test_rule11_reminders() -> None:
    d = doc()
    rem = src(d, "imf_weo_manual")["reminders"]
    rem[0]["remind_on"]["day"] = 26  # AC-CFG-8: could never fire
    assert_fails(d, "11")
    rem[0]["remind_on"]["day"] = 24  # not after to_day 24 (AC-CFG-7)
    assert_fails(d, "11")
    rem[0]["remind_on"]["day"] = 25
    assert validate_sources(d) == []
    rem[0]["remind_on"]["month"] = 5  # not a release month
    assert_fails(d, "11")


# ---------------------------------------------------------------- rules 15-19


def test_rule15_publish_site_is_mandatory_without_default() -> None:
    d = doc()
    del src(d)["publish_site"]
    assert_fails(d, "schema")  # AC-CFG-7


def test_rule15_public_with_forbidden_redistribution() -> None:
    d = doc()
    src(d)["licence"]["redistribution_of_raw"] = "forbidden"
    src(d)["archive"] = "hash_only"
    assert_fails(d, "15")  # AC-CFG-7
    src(d)["publish_site"] = "withheld"
    assert validate_sources(d) == []


def test_rule15_public_site_with_hash_only_archive_is_allowed() -> None:
    d = doc()
    src(d)["archive"] = "hash_only"
    assert validate_sources(d) == []


@pytest.mark.parametrize("value", [-1, 13, 1.5, "2"])
def test_rule16_published_precision_bounds(value: Any) -> None:
    d = doc()
    grp(d)["published_precision"] = value
    assert_fails(d, "schema")


def test_rule16_reestimating_is_boolean_and_precision_accepts_bounds() -> None:
    d = doc()
    grp(d)["reestimating"] = "yes"
    assert_fails(d, "schema")
    grp(d)["reestimating"] = False
    for ok in (0, 12, None):
        grp(d)["published_precision"] = ok
        assert validate_sources(d) == []


def test_rule17_private_archive_rejected_while_no_private_repo() -> None:
    d = doc()
    src(d)["archive"] = "private"
    assert_fails(d, "17")  # AC-CFG-8
    d["archive_policy"]["private_repo"] = "owner/private-raw"
    assert validate_sources(d) == []


def test_rule17_archive_policy_is_required() -> None:
    d = doc()
    del d["archive_policy"]
    assert_fails(d, "schema")


def test_rule18_inbox_declaration_and_import_label_are_schema_shaped() -> None:
    # Rule 18's sidecar checks belong to ingest-manual (T59); T07 only types the inbox block.
    d = doc()
    src(d, "imf_weo_manual")["inbox"]["sidecar_required"] = "edition_date"
    assert_fails(d, "schema")


@pytest.mark.parametrize("value", [400, 9, 356, "120"])
def test_rule19_job_timeout_bounds(value: Any) -> None:
    d = doc()
    grp(d)["job_timeout_min"] = value
    assert_fails(d, "schema")  # AC-CFG-8 (400)


@pytest.mark.parametrize("value", [[""], ["a", 1], ":"])
def test_rule19_missing_markers_are_non_empty_strings(value: Any) -> None:
    d = doc()
    grp(d)["missing_markers"] = value
    assert_fails(d, "schema")


def test_rule19_bounds_accepted() -> None:
    d = doc()
    for ok in (10, 355):
        grp(d)["job_timeout_min"] = ok
        assert validate_sources(d) == []


# ---------------------------------------------------------------- rules 27, 28, 30-32 and AC-CFG-9


def test_weo_example_validates_as_a_whole() -> None:
    d = doc()
    g = grp(d, "imf_weo_manual")
    assert g["edition_ordered"] is True
    assert g["reestimating"] is False
    assert "revision" not in g
    assert validate_sources(d) == []


def test_rule27_edition_ordered_and_reestimating_are_exclusive() -> None:
    d = doc()
    g = grp(d, "imf_weo_manual")
    g["reestimating"] = True
    g["note"] = "x"
    g["revision"] = {"max_revised_rows": 10}
    issues = assert_fails(d, "27")
    assert any("mutually exclusive" in i.message for i in issues)


def test_rule27_named_edition_group_sets_no_mass_revision_keys() -> None:
    d = doc()
    g = grp(d, "imf_weo_manual")
    g["revision"] = {"max_revised_rows": 10}
    assert_fails(d, "27")
    g["revision"] = {"snapshot_mode": "diff_above_tol"}
    assert_fails(d, "27")
    g["revision"] = {"snapshot_mode": "none"}
    assert validate_sources(d) == []


@pytest.mark.parametrize("key", ["vintage_resolution", "release_cadence_note"])
def test_round3_group_keys_are_unknown(key: str) -> None:
    d = doc()
    grp(d, "imf_weo_manual")[key] = "x"
    assert_fails(d, "schema")


def test_materiality_and_snapshot_keys_rules_30_to_32() -> None:
    d = doc()
    rev = grp(d)["revision"]
    rev["snapshot_mode"] = "diff_above_tol"  # rule 31: needs reestimating
    assert_fails(d, "31")
    rev["snapshot_mode"] = "sometimes"
    assert_fails(d, "schema")
    rev["snapshot_mode"] = "none"
    rev["materiality_abs"] = -1
    assert_fails(d, "schema")
    rev["materiality_abs"] = 0
    rev["materiality_rel"] = 1.5
    assert_fails(d, "schema")
    rev["materiality_rel"] = 0.001
    assert validate_sources(d) == []
    g = grp(d)  # rule 32: placement is inside revision:
    del g["revision"]
    g["materiality_abs"] = 0
    assert_fails(d, "schema")


def test_reestimating_group_may_opt_out_of_snapshot_mode() -> None:
    d = doc()
    g = copy.deepcopy(REESTIMATING_GROUP)
    g["revision"] = {"max_revised_rows": 5000}
    g2 = copy.deepcopy(g)
    g2["id"] = "other"
    g2["revision"]["snapshot_mode"] = "none"
    src(d)["groups"].extend([g, g2])
    assert validate_sources(d) == []


def test_ac_cfg_9_pending_series_map_entries_are_not_a_source_config_concern() -> None:
    # series_map entries are validated by the series-map tasks; sources.yaml only names the file.
    assert validate_sources(doc()) == []


def test_duplicate_ids_rejected() -> None:
    d = doc()
    d["sources"].append(copy.deepcopy(src(d)))
    assert_fails(d, "schema")
    d = doc()
    src(d)["groups"].append(copy.deepcopy(grp(d)))
    assert_fails(d, "schema")


def test_type_errors_have_paths() -> None:
    d = doc()
    grp(d)["expected_series_min"] = "many"
    issues = validate_sources(d)
    assert any("expected_series_min" in i.path for i in issues)


@pytest.mark.parametrize(
    "bad", [{"id": "Bad Id"}, {"kind": "ftp"}, {"archive": "cloud"}, {"enabled": "yes"}]
)
def test_enum_and_pattern_violations(bad: dict[str, Any]) -> None:
    d = doc()
    src(d).update(bad)
    assert_fails(d, "schema")


def test_bad_date_rejected() -> None:
    d = doc()
    src(d)["licence"]["checked_on"] = "2026-13-45"
    assert_fails(d, "schema")


# ---------------------------------------------------------------- rule 28 / AC-CFG-10


def _indicator(policy: object | None) -> dict[str, Any]:
    inp: dict[str, Any] = {
        "id": "X01",
        "usage": "denominator_gdp_lcu",
        "currency_match": "numerator",
    }
    if policy is not None:
        inp["annualised_policy"] = policy
    return {"id": "M13", "inputs": [inp]}


@pytest.mark.parametrize("policy", ["latest_single", "other", True])
def test_rule28_annualised_policy_other_than_fail_is_rejected(policy: object) -> None:
    issues = indicator_input_issues(_indicator(policy))
    assert [i.rule for i in issues] == ["28"]
    assert "latest_single" in issues[0].message or "only 'fail'" in issues[0].message


@pytest.mark.parametrize("policy", ["fail", None])
def test_rule28_fail_or_absent_passes(policy: object | None) -> None:
    assert indicator_input_issues(_indicator(policy)) == []


# ---------------------------------------------------------------- AC-CFG-3


_SECRET_PATTERNS = [
    re.compile(
        r"(?i)\b(api[_-]?key|token|secret|password|passwd)\b\s*[:=]\s*['\"]?(?!none\b|null\b)[A-Za-z0-9/+_\-]{16,}"
    ),
    re.compile(r"\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}"),
    re.compile(r"postgres(ql)?://[^\s:@/]+:[^\s@]+@"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]


def scan_for_secrets(root: Path) -> list[str]:
    hits: list[str] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        for n, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if any(rx.search(line) for rx in _SECRET_PATTERNS):
                hits.append(f"{p}:{n}")
    return hits


def test_ac_cfg_3_no_secret_values_under_config() -> None:
    assert scan_for_secrets(ROOT / "config") == []


def test_ac_cfg_3_secret_scan_detects_planted_secrets(tmp_path: Path) -> None:
    (tmp_path / "a.yaml").write_text("api_key: abcdefghijklmnop1234\n")
    (tmp_path / "b.yaml").write_text("dsn: postgresql://user:hunter2@host/db\n")
    (tmp_path / "c.yaml").write_text("auth: {type: api_key, env: FRED_API_KEY}\n")
    hits = scan_for_secrets(tmp_path)
    assert {Path(h).name.split(":")[0] for h in hits} == {"a.yaml", "b.yaml"}


def test_ac_cfg_3_env_example_names_parse() -> None:
    names = cfg.env_example_names("# comment\nFRED_API_KEY=\n# OTHER_KEY=\nnot a var\n")
    assert names == {"FRED_API_KEY", "OTHER_KEY"}


# ---------------------------------------------------------------- AC-CFG-8 constants


def test_preflight_day_is_25() -> None:
    assert cfg.PREFLIGHT_DAY == 25


def test_rule18_edition_ordered_needs_edition_sidecar_keys() -> None:
    d = doc()
    s = src(d, "imf_weo_manual")
    assert validate_sources(d) == []
    s["inbox"]["sidecar_required"].remove("edition_date")
    assert_fails(d, "18")
    s["inbox"]["sidecar_required"].append("edition_date")
    s["inbox"]["sidecar_optional"].append("surprise")
    assert_fails(d, "18")
