"""T09: indicator config schema and the ADR-014 resolution engine."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import pytest

from macro_monitor.registry.config import ConfigError, ConfigIssue, load_yaml
from macro_monitor.registry.indicators import (
    load_indicators,
    resolve_indicator,
    validate_defaults,
    validate_indicators,
)

ROOT = Path(__file__).resolve().parents[3]
DEFAULTS = ROOT / "config" / "indicator_defaults.yaml"
INDICATORS = ROOT / "config" / "indicators.yaml"

pytestmark = pytest.mark.unit

DOMAINS: list[dict[str, Any]] = [
    {"id": "growth", "name": "Growth", "ranked": True, "min_coverage_for_rank": 0.5},
    {"id": "prices", "name": "Prices", "ranked": True},
    {"id": "fiscal", "name": "Fiscal", "ranked": True},
    {"id": "external", "name": "External", "ranked": True},
    {"id": "agri", "name": "Agri-food", "ranked": False},
    {"id": "global", "name": "Global", "ranked": False},
]


@pytest.fixture
def defaults() -> dict[str, Any]:
    d = load_yaml(DEFAULTS)
    assert isinstance(d, dict)
    return d


def entry(**over: Any) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": "M06",
        "name": "Headline CPI",
        "kind": "indicator",
        "scope": "country",
        "tier": "M",
        "priority": "core",
        "currency_basis": "B1",
        "family": "price_rate",
        "transform": "YOY",
        "alert": {"adverse": 1},
        "rank": {"mode": "descriptive_only", "good_dir": 0},
        "domains": [{"id": "prices", "ranked": False}],
    }
    e.update(over)
    return e


def doc(*entries: dict[str, Any], domains: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"domains": copy.deepcopy(domains or DOMAINS), "indicators": list(entries)}


def rules(issues: list[ConfigIssue]) -> set[str]:
    return {i.rule for i in issues}


def x01(**over: Any) -> dict[str, Any]:
    e = entry(
        id="X01",
        name="Nominal GDP",
        kind="input",
        tier="Q",
        family="support_input",
        staleness_class="Q270",
        transform="LEVEL",
        alert={"adverse": 0},
        domains=[],
    )
    e.update(over)
    return e


# ---------------------------------------------------------------- checked-in files


def test_checked_in_files_load() -> None:
    cfg = load_indicators(INDICATORS, DEFAULTS)
    m09 = cfg.by_id("M09")
    assert m09.values["staleness_class"] == "ACT120"
    assert m09.values["alert.method"] == "z"
    assert m09.values["stationarity_class"] == "trending_level"
    assert m09.values["alert.window_obs"] == 240
    assert m09.values["alert.min_obs"] == 60
    assert m09.values["max_ref_spread_days"] == 92
    assert m09.values["release_lag_aware"] is False
    assert m09.provenance["release_lag_aware"] == "global"
    assert m09.provenance["staleness_class"] == "family:labour_rate_level"
    assert m09.provenance["rank.mode"] == "indicator"
    assert "M09" in cfg.proposed()  # T32: the full catalog is loaded, all proposed


def test_checked_in_defaults_valid_and_release_lag_default_false(defaults: dict[str, Any]) -> None:
    assert validate_defaults(defaults) == []
    assert defaults["global"]["release_lag_aware"] is False


def test_checked_in_indicators_have_no_override_unless_confirmed() -> None:
    data = load_yaml(INDICATORS)
    for e in data["indicators"]:
        override = (e.get("alert") or {}).get("override")
        confirmed = (e.get("review") or {}).get("status") == "confirmed"
        assert not override or confirmed, e["id"]


# ---------------------------------------------------------------- AC-PAR-2 / AC-PAR-3


def test_missing_rank_mode_fails_even_with_family(defaults: dict[str, Any]) -> None:
    e = entry(rank={"good_dir": 0})
    issues = validate_indicators(doc(e), defaults)
    assert any(i.rule == "22" and "rank.mode" in i.path for i in issues)


def test_each_no_default_field_is_required(defaults: dict[str, Any]) -> None:
    for path in ("kind", "scope", "tier", "priority", "currency_basis", "transform", "domains"):
        e = entry()
        del e[path]
        issues = validate_indicators(doc(e), defaults)
        assert any(i.rule == "22" and path in i.path for i in issues), path
    e = entry(alert={})
    assert any(
        i.rule == "22" and "adverse" in i.path for i in validate_indicators(doc(e), defaults)
    )


def test_precedence_and_provenance(defaults: dict[str, Any]) -> None:
    defaults["global"]["max_ref_spread_days"] = {"M": 10, "Q": 20, "A": 30}
    defaults["families"]["price_rate"]["max_ref_spread_days"] = {"M": 11, "Q": 21, "A": 31}
    e = entry(max_ref_spread_days=12)
    r = resolve_indicator(e, defaults)
    assert (r.values["max_ref_spread_days"], r.provenance["max_ref_spread_days"]) == (
        12,
        "indicator",
    )
    del e["max_ref_spread_days"]
    r = resolve_indicator(e, defaults)
    assert (r.values["max_ref_spread_days"], r.provenance["max_ref_spread_days"]) == (
        11,
        "family:price_rate",
    )
    del defaults["families"]["price_rate"]["max_ref_spread_days"]
    r = resolve_indicator(e, defaults)
    assert (r.values["max_ref_spread_days"], r.provenance["max_ref_spread_days"]) == (10, "global")


def test_alert_leaves_resolve_individually(defaults: dict[str, Any]) -> None:
    e = entry(alert={"adverse": 1, "method": "z", "alert_z": 3.0})
    r = resolve_indicator(e, defaults)
    assert r.values["alert.method"] == "z"
    assert r.provenance["alert.method"] == "indicator"
    assert r.values["alert.alert_z"] == 3.0
    assert r.values["alert.watch_z"] == 1.5
    assert r.provenance["alert.watch_z"] == "global"
    q = resolve_indicator(entry(tier="Q"), defaults)
    assert q.values["alert.window_obs"] == 80
    assert q.values["max_ref_spread_days"] == 190


def test_override_is_never_inherited(defaults: dict[str, Any]) -> None:
    r = resolve_indicator(entry(), defaults)
    assert r.alert_override == ()


# ---------------------------------------------------------------- AC-PAR-9 (rules 22-26)


def test_rule22_missing_adverse(defaults: dict[str, Any]) -> None:
    issues = validate_indicators(doc(entry(alert={})), defaults)
    assert "rule 22" in str(next(i for i in issues if i.rule == "22"))


def test_rule22_unresolved_defaulted_field(defaults: dict[str, Any]) -> None:
    e = entry()
    del e["family"]
    issues = validate_indicators(doc(e), defaults)
    assert any(i.rule == "22" and "staleness_class" in i.path for i in issues)


def test_rule23_unknown_family_and_key(defaults: dict[str, Any]) -> None:
    assert "23" in rules(validate_indicators(doc(entry(family="nope")), defaults))
    issues = validate_indicators(doc(entry(bogus=1)), defaults)
    assert "23" in rules(issues)
    assert "rule 23" in str(issues[0])


def test_rule23_unknown_value_fails(defaults: dict[str, Any]) -> None:
    assert validate_indicators(doc(entry(stationarity_class="seasonal")), defaults)
    assert validate_indicators(doc(entry(release_lag_aware="yes")), defaults)


def test_rule24_review(defaults: dict[str, Any]) -> None:
    assert "24" in rules(validate_indicators(doc(entry(review={"status": "maybe"})), defaults))
    assert "24" in rules(validate_indicators(doc(entry(review={"status": "confirmed"})), defaults))
    assert "24" in rules(
        validate_indicators(doc(entry(review={"status": "confirmed", "by": "u"})), defaults)
    )
    ok = entry(review={"status": "confirmed", "by": "user", "on": "2026-10-27"})
    assert validate_indicators(doc(ok), defaults) == []
    assert validate_indicators(doc(entry(review={"status": "proposed"})), defaults) == []
    assert validate_indicators(doc(entry()), defaults) == []


def test_rule25_monotone_good_in_unranked_domain(defaults: dict[str, Any]) -> None:
    e = entry(
        family="activity_yoy",
        rank={"mode": "monotone_good", "good_dir": 1},
        domains=[{"id": "agri", "ranked": False}],
    )
    assert "25" in rules(validate_indicators(doc(e), defaults))
    e2 = entry(domains=[{"id": "agri", "ranked": True}])
    assert "25" in rules(validate_indicators(doc(e2), defaults))
    ok = entry(
        family="activity_yoy",
        rank={"mode": "monotone_good", "good_dir": 1},
        domains=[{"id": "growth", "ranked": True}],
    )
    assert validate_indicators(doc(ok), defaults) == []


def test_rule26_alert_none_for_input_comparison_weo(defaults: dict[str, Any]) -> None:
    assert "26" in rules(
        validate_indicators(doc(x01(alert={"adverse": 0, "method": "z"})), defaults)
    )
    comp = entry(id="A02b", family="comparison_series", tier="A", is_comparison=True)
    assert validate_indicators(doc(comp), defaults) == []
    comp["alert"]["method"] = "z"
    assert "26" in rules(validate_indicators(doc(comp), defaults))
    weo = entry(id="A03", family="weo_projection", tier="A", alert={"adverse": 0, "method": "z"})
    assert "26" in rules(validate_indicators(doc(weo), defaults))


# ---------------------------------------------------------------- rules 12, 13, 20, 28, 29


def test_rule12_good_dir_and_input_shape(defaults: dict[str, Any]) -> None:
    bad = entry(
        rank={"mode": "monotone_good", "good_dir": 0}, domains=[{"id": "prices", "ranked": True}]
    )
    assert "12" in rules(validate_indicators(doc(bad), defaults))
    bad2 = entry(rank={"mode": "descriptive_only", "good_dir": 1})
    assert "12" in rules(validate_indicators(doc(bad2), defaults))
    assert "12" in rules(
        validate_indicators(doc(x01(domains=[{"id": "prices", "ranked": False}])), defaults)
    )
    assert "12" in rules(
        validate_indicators(doc(x01(rank={"mode": "monotone_good", "good_dir": 1})), defaults)
    )
    assert validate_indicators(doc(x01()), defaults) == []


def test_rule12_target_distance_needs_target(defaults: dict[str, Any]) -> None:
    e = entry(
        family="annual_alerted",
        tier="A",
        rank={"mode": "target_distance", "good_dir": 0},
        domains=[{"id": "growth", "ranked": True}],
    )
    assert "22" in rules(validate_indicators(doc(e), defaults))
    e["rank"]["targets"] = {"value": 0.0, "source_note": "x"}
    assert validate_indicators(doc(e), defaults) == []


def test_rule12_global_scope_descriptive_and_inputs_reference(defaults: dict[str, Any]) -> None:
    g = entry(
        scope="global",
        family="market_rate",
        rank={"mode": "monotone_good", "good_dir": 1},
        domains=[{"id": "global", "ranked": False}],
    )
    assert "12" in rules(validate_indicators(doc(g), defaults))
    inp = {"id": "X01", "usage": "denominator_gdp_lcu", "currency_match": "numerator"}
    m13 = entry(
        id="M13",
        family="external_ratio",
        inputs=[inp],
        domains=[{"id": "external", "ranked": False}],
    )
    assert validate_indicators(doc(m13, x01()), defaults) == []
    assert "12" in rules(validate_indicators(doc(m13), defaults))
    m13b = copy.deepcopy(m13)
    m13b["inputs"][0]["id"] = "M06"
    assert "12" in rules(validate_indicators(doc(m13b, entry()), defaults))


def test_rule13_domains(defaults: dict[str, Any]) -> None:
    markets = [*DOMAINS, {"id": "markets", "name": "Markets", "ranked": True}]
    assert "13" in rules(validate_indicators(doc(entry(), domains=markets), defaults))
    e = entry(domains=[{"id": "markets", "ranked": False}])
    assert "13" in rules(validate_indicators(doc(e), defaults))
    unranked_wrong = [{**d, "ranked": True} if d["id"] == "agri" else d for d in DOMAINS]
    assert "13" in rules(validate_indicators(doc(entry(), domains=unranked_wrong), defaults))
    bad_cov = [{**DOMAINS[0], "min_coverage_for_rank": 1.5}]
    assert validate_indicators(doc(entry(domains=[]), domains=bad_cov), defaults)


def _g02(**over: Any) -> dict[str, Any]:
    e = entry(
        id="G02",
        scope="global",
        family="market_rate",
        domains=[{"id": "global", "ranked": False}],
    )
    e.update(over)
    return e


def test_rule44_global_scope_lives_in_global_only(defaults: dict[str, Any]) -> None:
    assert validate_indicators(doc(_g02()), defaults) == []
    cases = {
        "agri only": [{"id": "agri", "ranked": False}],
        "agri and global": [{"id": "agri", "ranked": False}, {"id": "global", "ranked": False}],
        "no membership": [],
    }
    for label, doms in cases.items():
        issues = [
            i for i in validate_indicators(doc(_g02(domains=doms)), defaults) if i.rule == "44"
        ]
        assert len(issues) == 1, label
        assert "G02" in issues[0].message, label
        assert "'global'" in issues[0].message, label
    agri = validate_indicators(doc(_g02(domains=cases["agri only"])), defaults)
    assert any(i.rule == "44" and "['agri']" in i.message for i in agri)


def test_rule44_country_scope_not_in_global(defaults: dict[str, Any]) -> None:
    bad = entry(domains=[{"id": "global", "ranked": False}])
    issues = [i for i in validate_indicators(doc(bad), defaults) if i.rule == "44"]
    assert len(issues) == 1
    assert "M06" in issues[0].message
    assert "'global'" in issues[0].message
    assert "44" not in rules(validate_indicators(doc(entry()), defaults))


def test_rule44_shipped_file_passes() -> None:
    cfg = load_indicators(INDICATORS, DEFAULTS)  # raises on any issue, rule 44 included
    for i in cfg.indicators:
        members = [d["id"] for d in i.values["domains"]]
        if i.values["scope"] == "global":
            assert members == ["global"], i.id
        else:
            assert "global" not in members, i.id


def test_rule20_override_needs_rationale(defaults: dict[str, Any]) -> None:
    ov = {
        "entity_group": "advanced",
        "watch": 60.0,
        "alert": 90.0,
        "rationale": "r",
        "source_note": "s",
    }
    ok = entry(alert={"adverse": 1, "override": [ov]})
    assert validate_indicators(doc(ok), defaults) == []
    no_rat = entry(alert={"adverse": 1, "override": [{**ov, "rationale": ""}]})
    assert "20" in rules(validate_indicators(doc(no_rat), defaults))
    missing = entry(
        alert={"adverse": 1, "override": [{k: v for k, v in ov.items() if k != "rationale"}]}
    )
    assert "20" in rules(validate_indicators(doc(missing), defaults))
    no_group = {k: v for k, v in ov.items() if k != "entity_group"}
    assert validate_indicators(doc(entry(alert={"adverse": 1, "override": [no_group]})), defaults)


def test_rule20_override_requires_confirmed_for_shipped_file(defaults: dict[str, Any]) -> None:
    ov = {
        "entity_group": "advanced",
        "watch": 60.0,
        "alert": 90.0,
        "rationale": "r",
        "source_note": "s",
    }
    e = entry(alert={"adverse": 1, "override": [ov]})
    assert "20" in rules(validate_indicators(doc(e), defaults, forbid_unconfirmed_override=True))
    e["review"] = {"status": "confirmed", "by": "user", "on": "2026-10-27"}
    assert validate_indicators(doc(e), defaults, forbid_unconfirmed_override=True) == []
    assert "20" in rules(
        validate_indicators(
            doc(entry(alert={"adverse": 1, "override": [ov]})), defaults, entity_groups={"emerging"}
        )
    )


def test_rule28_latest_single(defaults: dict[str, Any]) -> None:
    inp = {
        "id": "X01",
        "usage": "denominator_gdp_lcu",
        "currency_match": "numerator",
        "annualised_policy": "latest_single",
    }
    m13 = entry(
        id="M13",
        family="external_ratio",
        inputs=[inp],
        domains=[{"id": "external", "ranked": False}],
    )
    issues = validate_indicators(doc(m13, x01()), defaults)
    assert "28" in rules(issues)
    assert "rule 28" in str(next(i for i in issues if i.rule == "28"))
    m13["inputs"][0]["annualised_policy"] = "fail"
    assert validate_indicators(doc(m13, x01()), defaults) == []


def test_rule29_trending_level_with_level_transform(defaults: dict[str, Any]) -> None:
    e = entry(
        id="A05",
        tier="A",
        family="annual_alerted",
        stationarity_class="trending_level",
        transform="LEVEL",
        domains=[{"id": "fiscal", "ranked": False}],
    )
    assert validate_indicators(doc(e), defaults) == []
    r = resolve_indicator(e, defaults)
    assert r.values["stationarity_class"] == "trending_level"
    assert r.provenance["stationarity_class"] == "indicator"


def test_duplicate_id_and_defaults_schema(defaults: dict[str, Any]) -> None:
    assert validate_indicators(doc(entry(), entry()), defaults)
    defaults["global"]["bogus"] = 1
    assert validate_defaults(defaults)
    assert validate_defaults({"global": {}})


def test_loader_raises_on_bad_file(tmp_path: Path) -> None:
    bad = tmp_path / "i.yaml"
    bad.write_text("domains: []\nindicators:\n  - {id: M01, name: x}\n")
    with pytest.raises(ConfigError) as exc:
        load_indicators(bad, DEFAULTS)
    assert "rule 22" in str(exc.value)
