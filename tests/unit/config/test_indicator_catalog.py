"""T32: the shipped indicator catalog (AC-PAR-1, 4, 5, 6, 10; AC-CFG-12)."""

from __future__ import annotations

import csv
import io
from pathlib import Path

import pytest

from macro_monitor.registry.config import load_yaml
from macro_monitor.registry.indicators import IndicatorsConfig, load_indicators

ROOT = Path(__file__).resolve().parents[3]
INDICATORS = ROOT / "config" / "indicators.yaml"
DEFAULTS = ROOT / "config" / "indicator_defaults.yaml"
GOLDEN = ROOT / "tests" / "fixtures" / "golden" / "resolved_indicators.csv"

pytestmark = pytest.mark.unit

COLUMNS = (
    "id",
    "kind",
    "scope",
    "tier",
    "priority",
    "currency_basis",
    "family",
    "transform",
    "staleness_class",
    "stationarity_class",
    "release_lag_aware",
    "alert_method",
    "adverse",
    "alert_z",
    "watch_z",
    "window_obs",
    "min_obs",
    "max_ref_spread_days",
    "rank_period_coverage_pct",
    "rank_mode",
    "good_dir",
    "domains",
    "n_override",
    "review_status",
)

#: Analytics spec 4.1 proposed monotone_good members (after the Q06 amendment): 25 ids.
ANALYTICS_4_1_MONOTONE = frozenset(
    [
        "M01",
        "M02",
        "M09",
        "M10",
        "M11",
        "Q01",
        "Q02",
        "Q03",
        "Q08",
        "Q10",
        "Q11",
        "Q12",
        "Q13",
        "Q15",
        "A01",
        "A04",
        "A05",
        "A07",
        "A09",
        "A10",
        "A11",
        "A13",
        "A14",
        "A16",
        "A24",
    ]
)


@pytest.fixture(scope="module")
def cfg() -> IndicatorsConfig:
    return load_indicators(INDICATORS, DEFAULTS)


def resolved_rows(cfg: IndicatorsConfig) -> list[dict[str, str]]:
    families = {e["id"]: str(e.get("family", "")) for e in load_yaml(INDICATORS)["indicators"]}
    rows = []
    for i in cfg.indicators:
        v = i.values
        doms = ";".join(f"{d['id']}:{'R' if d['ranked'] else 'U'}" for d in v["domains"])
        rows.append(
            {
                "id": i.id,
                "kind": v["kind"],
                "scope": v["scope"],
                "tier": v["tier"],
                "priority": v["priority"],
                "currency_basis": v["currency_basis"],
                "family": families[i.id],
                "transform": v["transform"],
                "staleness_class": v["staleness_class"],
                "stationarity_class": v["stationarity_class"],
                "release_lag_aware": str(v["release_lag_aware"]).lower(),
                "alert_method": v["alert.method"],
                "adverse": str(v["alert.adverse"]),
                "alert_z": str(v["alert.alert_z"]),
                "watch_z": str(v["alert.watch_z"]),
                "window_obs": str(v["alert.window_obs"]),
                "min_obs": str(v["alert.min_obs"]),
                "max_ref_spread_days": str(v["max_ref_spread_days"]),
                "rank_period_coverage_pct": str(v["rank_period_coverage_pct"]),
                "rank_mode": v["rank.mode"],
                "good_dir": str(v["rank.good_dir"]),
                "domains": doms or "none",
                "n_override": str(len(i.alert_override)),
                "review_status": str(i.review["status"]),
            }
        )
    return rows


def render(rows: list[dict[str, str]]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def test_par1_golden_resolved_table(cfg: IndicatorsConfig) -> None:
    rows = resolved_rows(cfg)
    assert len(rows) == 83
    assert [r["id"] for r in rows if r["kind"] == "input"] == ["X01", "X02", "X03"]
    assert sum(r["kind"] == "indicator" for r in rows) == 80
    for r in rows:
        assert all(v not in ("", "None") for v in r.values()), r
    assert render(rows) == GOLDEN.read_text(encoding="utf-8")


def test_global_domain_members_are_exactly_m24_g02_g03(cfg: IndicatorsConfig) -> None:
    members = {i.id for i in cfg.indicators if "global" in [d["id"] for d in i.values["domains"]]}
    assert members == {"M24", "G02", "G03"}
    assert [d["id"] for d in cfg.by_id("G02").values["domains"]] == ["global"]
    assert cfg.by_id("G02").values["domains"][0]["ranked"] is False


def test_g03_is_a_global_indicator_in_global_only(cfg: IndicatorsConfig) -> None:
    g03 = cfg.by_id("G03").values
    assert g03["scope"] == "global"
    assert [d["id"] for d in g03["domains"]] == ["global"]
    assert g03["domains"][0]["ranked"] is False


def test_comparison_indicators_flagged_and_domainless(cfg: IndicatorsConfig) -> None:
    for iid in ("A02b", "A02c"):
        assert cfg.by_id(iid).values["is_comparison"] is True
        assert cfg.by_id(iid).values["domains"] == []


def test_all_rows_proposed(cfg: IndicatorsConfig) -> None:
    assert len(cfg.proposed()) == 83
    assert not any(i.review["status"] == "confirmed" for i in cfg.indicators)


def test_par4_staleness_classes_of_researched_rows(cfg: IndicatorsConfig) -> None:
    expect = dict.fromkeys(("M16", "M17", "M18", "M19", "M24", "G02"), "MKT45")
    expect |= {"M03": "SURV75", "M04": "SURV75"}
    expect |= dict.fromkeys(("A13", "A14", "A22", "G12"), "TRI1460")
    for ind in cfg.indicators:
        if ind.id in ("X01", "X02", "X03", "G05"):
            continue
        if ind.id[0] == "Q":
            expect.setdefault(ind.id, "Q270")
        elif ind.values["tier"] == "A" and ind.id[0] in "AG" and ind.id not in expect:
            expect.setdefault(ind.id, "A730")
    mismatches = {
        i: (cfg.by_id(i).values["staleness_class"], want)
        for i, want in expect.items()
        if cfg.by_id(i).values["staleness_class"] != want
    }
    # A26 and G11 are researched as "years and frequency not stated" and G11 is a duplicate
    # of A26 (S:U); both are TRI1460 in the draft table, so they are the only expected deviations.
    assert set(mismatches) <= {"A26", "G11"}, mismatches


def test_par5_monotone_good_set_equals_analytics_list(cfg: IndicatorsConfig) -> None:
    got = {i.id for i in cfg.indicators if i.values["rank.mode"] == "monotone_good"}
    assert got == ANALYTICS_4_1_MONOTONE
    for i in cfg.indicators:
        if i.id in got:
            assert i.values["rank.good_dir"] in (-1, 1)


def test_par6_comparison_projection_inputs_and_target(cfg: IndicatorsConfig) -> None:
    for iid in ("A02b", "A02c", "A03", "X01", "X02", "X03"):
        v = cfg.by_id(iid).values
        assert v["alert.method"] == "none", iid
        assert v["rank.mode"] == "descriptive_only", iid
    target = [i.id for i in cfg.indicators if i.values["rank.mode"] == "target_distance"]
    assert target == ["A02"]
    assert cfg.by_id("A02").values["rank.targets"]
    assert (ROOT / "config" / "targets" / "a02_output_gap.yaml").is_file()


def test_par10_a05_and_no_override(cfg: IndicatorsConfig) -> None:
    assert all(i.alert_override == () for i in cfg.indicators)
    a05 = cfg.by_id("A05").values
    assert a05["alert.method"] == "z"
    assert a05["alert.adverse"] == 1
    assert a05["stationarity_class"] == "trending_level"


def test_q06_z_score_only(cfg: IndicatorsConfig) -> None:
    q06 = cfg.by_id("Q06")
    assert q06.values["alert.method"] == "z"
    assert q06.values["alert.adverse"] == 1
    assert q06.values["stationarity_class"] == "stationary"
    assert q06.values["rank.mode"] == "descriptive_only"
    assert q06.alert_override == ()


def test_cfg12_no_override_entry_in_shipped_file() -> None:
    data = load_yaml(INDICATORS)
    for e in data["indicators"]:
        assert not (e.get("alert") or {}).get("override"), e["id"]
    # the checked-in file loads with the strict flag on
    load_indicators(INDICATORS, DEFAULTS, forbid_unconfirmed_override=True)


def test_recorded_answers(cfg: IndicatorsConfig) -> None:
    for iid in ("M06", "M07", "M08", "G01", "A25"):
        assert cfg.by_id(iid).values["rank.mode"] == "descriptive_only", iid
    m16 = cfg.by_id("M16")
    assert [d["id"] for d in m16.values["domains"]] == ["external"]
    prices = [i for i in cfg.indicators if any(d["id"] == "prices" for d in i.values["domains"])]
    assert prices
    assert all(i.values["rank.mode"] == "descriptive_only" for i in prices)
    lag = {i.id for i in cfg.indicators if i.values["release_lag_aware"]}
    assert lag == {"A12", "A13", "A14", "A22", "A26", "G12"}
    assert {d["id"] for d in cfg.domains} == {
        "growth",
        "prices",
        "labour",
        "external",
        "fiscal",
        "fin",
        "social",
        "structural",
        "environment",
        "agri",
        "global",
    }
