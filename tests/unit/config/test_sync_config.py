# ruff: noqa: E501, PT018, RUF043
"""sync-config validation without a database (T18: AC-CFG-6, AC-ING-13, AC-ING-14, rule 17, AC-CFG-13)."""

from __future__ import annotations

import shutil
from decimal import Decimal
from pathlib import Path

import pytest

from macro_monitor.registry.config import ConfigError, load_yaml
from macro_monitor.registry.sync import group_row, load_config, parse_series_map, source_row

ROOT = Path(__file__).resolve().parents[3]
MAP = Path("config/series_map/eurostat_labour.yaml")

pytestmark = pytest.mark.unit


def tree(tmp_path: Path) -> Path:
    shutil.copytree(ROOT / "config", tmp_path / "config")
    return tmp_path


def edit(root: Path, rel: str, old: str, new: str, count: int = 1) -> None:
    p = root / rel
    text = p.read_text(encoding="utf-8")
    assert old in text, old
    p.write_text(text.replace(old, new, count), encoding="utf-8")


def edit_de(root: Path, old: str, new: str) -> None:
    """Edit only the DE entry of the labour map (the shipped map is block-style, 28 entries)."""
    p = root / MAP
    text = p.read_text(encoding="utf-8")
    start = text.index("  key: M.SA.TOTAL.PC_ACT.T.DE\n")
    assert old in text[start:], old
    p.write_text(text[:start] + text[start:].replace(old, new, 1), encoding="utf-8")


def make_sa_required(root: Path) -> None:
    """Make M09 (mapped by the shipped Eurostat map) use a transform that needs SA."""
    text = (root / "config/indicators.yaml").read_text(encoding="utf-8")
    start = text.index("  - id: M09\n")
    end = text.index("\n  - id:", start)
    block = text[start:end].replace("transform: LEVEL", "transform: M3M3_ANN")
    assert block != text[start:end]
    (root / "config/indicators.yaml").write_text(
        text[:start] + block + text[end:], encoding="utf-8"
    )


def test_shipped_config_loads() -> None:
    cfg = load_config(ROOT)
    counts = {
        g: sum(e.group_id == g for e in cfg.map_entries)
        for g in ("eurostat_sts", "eurostat_hicp", "eurostat_gov_debt")
    }
    assert counts == {"eurostat_sts": 56, "eurostat_hicp": 84, "eurostat_gov_debt": 27}  # T53
    by_group: dict[str, set[str]] = {}
    for e in cfg.map_entries:
        by_group.setdefault(e.group_id, set()).add(e.indicator)
    assert by_group == {
        "eurostat_labour": {"M09"},
        "eurostat_sts": {"M01", "M02"},
        "eurostat_hicp": {"M06", "M07", "G01"},
        "eurostat_gov_debt": {"Q08"},
        "ecb_yields": {"M18"},
        "worldbank_annual": {"M14", "A01", "A11", "A14", "A22"},  # 5 indicators x 42 countries
        "bis_cbpol": {"M17"},
        "bis_credit_gap": {"Q06"},
        "oecd_kei": {"M04", "M18"},  # T57 seed
        "oecd_prices": {"M06"},
        "oecd_cli": {"M05"},
        "pinksheet_monthly": {"M24", "G02"},  # T58 seed
        "fao_ffpi": {"G02"},
        "fao_csdb": {"G03"},
        "pinksheet_manual": {"M24", "G02"},  # T64 fallback maps
        "fao_csdb_manual": {"G03"},
        "faostat_sofi": {"G12"},
        "ec_bcs_monthly": {"M03", "M04"},
        "dbnomics_ameco_gap": {"A02c"},
        "worldbank_support": {"X01", "X02"},  # T62
        "eurostat_gdp_q": {"X01"},  # T62
    }


def test_cfg6_ing14_sa_rule(tmp_path: Path) -> None:
    root = tree(tmp_path)
    make_sa_required(root)
    load_config(root)  # SA entries pass
    edit_de(root, "seasonal_adjustment: SA\n", "seasonal_adjustment: SCA\n")
    load_config(root)  # SCA passes
    for bad in ("CA", "NSA", "NA"):
        root2 = tree(tmp_path / bad)
        make_sa_required(root2)
        edit_de(root2, "seasonal_adjustment: SA\n", f"seasonal_adjustment: {bad}\n")
        with pytest.raises(ConfigError) as exc:
            load_config(root2)
        msg = str(exc.value)
        assert "rule 8" in msg and "M09" in msg and "M.SA.TOTAL.PC_ACT.T.DE" in msg and "DEU" in msg


def test_missing_expect_sa_fails_rule8(tmp_path: Path) -> None:
    root = tree(tmp_path)
    make_sa_required(root)
    edit_de(
        root,
        "  expect:\n    frequency: M\n    unit: PC_ACT\n    seasonal_adjustment: SA\n    price_basis: NA\n",
        "  splice_note: x\n",
    )
    with pytest.raises(ConfigError, match="rule 8"):
        load_config(root)


def test_ing13_incremental_with_complete_rejected(tmp_path: Path) -> None:
    root = tree(tmp_path)
    edit(root, "config/sources.yaml", "mode_default: full", "mode_default: incremental")
    with pytest.raises(ConfigError, match="rule 9"):
        load_config(root)


def test_archive_private_rejected_while_private_repo_null(tmp_path: Path) -> None:
    root = tree(tmp_path)
    edit(root, "config/sources.yaml", "archive: public ", "archive: private")
    with pytest.raises(ConfigError, match="rule 17"):
        load_config(root)


def test_unknown_map_indicator_and_entity(tmp_path: Path) -> None:
    root = tree(tmp_path)
    edit(root, str(MAP), "indicator: M09", "indicator: Z99")
    edit(root, str(MAP), "entity: FRA", "entity: XXX")
    with pytest.raises(ConfigError) as exc:
        load_config(root)
    assert "Z99" in str(exc.value) and "XXX" in str(exc.value)


def test_global_indicator_only_to_wld(tmp_path: Path) -> None:
    root = tree(tmp_path)
    data = load_yaml(root / "config/indicators.yaml")
    gid = next(i["id"] for i in data["indicators"] if i.get("scope") == "global")
    edit(root, str(MAP), "indicator: M09", f"indicator: {gid}")
    with pytest.raises(ConfigError, match="rule 12|WLD"):
        load_config(root)


def test_parse_series_map_rejects_unknown_key() -> None:
    bad = {
        "series": [
            {
                "dataset": "d",
                "key": "k",
                "entity": "DEU",
                "indicator": "M09",
                "role": "headline",
                "rationale": "r",
                "bogus": 1,
            }
        ]
    }
    with pytest.raises(ConfigError, match="bogus"):
        parse_series_map("s", "g", bad, "f.yaml")


def test_group_defaults_cfg13() -> None:
    plain = group_row("eurostat", {"id": "g", "reestimating": False})
    assert (plain["materiality_abs"], plain["materiality_rel"], plain["snapshot_mode"]) == (
        Decimal(0),
        Decimal(0),
        "none",
    )
    reest = group_row(
        "bis", {"id": "g", "reestimating": True, "revision": {"max_revised_rows": 5000}}
    )
    assert (
        reest["materiality_rel"] == Decimal("0.001") and reest["snapshot_mode"] == "diff_above_tol"
    )
    assert reest["max_revised_rows"] == 5000
    opt_out = group_row(
        "bis",
        {
            "id": "g",
            "reestimating": True,
            "revision": {"snapshot_mode": "none", "max_revised_rows": 1},
        },
    )
    assert opt_out["snapshot_mode"] == "none" and opt_out["materiality_rel"] == Decimal("0.001")
    ed = group_row("imf", {"id": "w", "edition_ordered": True})
    assert ed["edition_ordered"] is True and ed["snapshot_mode"] == "none"


def test_source_hash_changes_with_entry() -> None:
    cfg = load_config(ROOT)
    s = dict(cfg.sources.data["sources"][0])
    a = source_row(s, False)["config_sha256"]
    s["name"] = "changed"
    assert source_row(s, False)["config_sha256"] != a
