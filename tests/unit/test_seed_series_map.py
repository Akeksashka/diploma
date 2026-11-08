"""T52: scripts/seed_series_map.py on small fixture CSVs (no network, no DB)."""

from __future__ import annotations

import importlib.util
import shutil
import sys
from pathlib import Path
from types import ModuleType

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
HEADER = "indicator,entity,source,dataset,key,role,expect,rationale\n"
GOOD = (
    HEADER + "M09,DEU,fx_labour,une_rt_m,M.SA.TOTAL.PC_ACT.T.DE,headline,"
    '"frequency=M;unit=PC_ACT;seasonal_adjustment=SA;price_basis=NA",fixture\n'
    "M09,FRA,fx_labour,une_rt_m,M.SA.TOTAL.PC_ACT.T.FR,headline,"
    '"{""frequency"": ""M"", ""composition"": ""FIXED""}",fixture\n'
    "M07,DEU,fx_labour,,,known_gap,,extra gap\n"
)

pytestmark = pytest.mark.unit


@pytest.fixture(scope="module")
def mod() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "seed_series_map", ROOT / "scripts/seed_series_map.py"
    )
    assert spec is not None
    assert spec.loader is not None
    m = importlib.util.module_from_spec(spec)
    sys.modules["seed_series_map"] = m
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def root(tmp_path: Path) -> Path:
    shutil.copytree(ROOT / "config", tmp_path / "config")
    (tmp_path / "config/known_gaps.yaml").unlink(missing_ok=True)
    return tmp_path


def _csv(tmp_path: Path, text: str) -> Path:
    p = tmp_path / "in.csv"
    p.write_text(text, encoding="utf-8")
    return p


def test_baseline_gap_counts(mod: ModuleType) -> None:
    n: dict[str, int] = {}
    for ind, _, _ in mod.BASELINE_GAPS:
        n[ind] = n.get(ind, 0) + 1
    assert n == {"M07": 14, "Q08": 15, "M18": 3, "A02": 17}  # A02: 42 - 17 = 25 covered
    assert len(set(mod.NON_EU)) == 15
    assert len(set(mod.A02_MISSING)) == 17


def test_no_csv_writes_only_gaps_and_is_idempotent(mod: ModuleType, root: Path) -> None:
    mod.seed(None, root)
    gaps = root / "config/known_gaps.yaml"
    first = gaps.read_bytes()
    mod.seed(None, root)
    assert gaps.read_bytes() == first
    assert len(yaml.safe_load(first)["known_gaps"]) == 49


def test_csv_to_yaml_roundtrip_and_idempotent(mod: ModuleType, root: Path) -> None:
    src = _csv(root, GOOD)
    mod.seed(src, root)
    out = root / "config/series_map/fx_labour.yaml"
    first = out.read_bytes()
    data = yaml.safe_load(first)
    assert [e["entity"] for e in data["series"]] == ["DEU", "FRA"]
    assert data["series"][1]["expect"]["composition"] == "FIXED"
    mod.seed(src, root)
    assert out.read_bytes() == first
    pairs = {
        (g["indicator"], g["entity"])
        for g in yaml.safe_load((root / "config/known_gaps.yaml").read_text())["known_gaps"]
    }
    assert ("M07", "DEU") in pairs
    assert ("M18", "ARG") in pairs


def test_rule_8_rejects_ca_for_sa_required_indicator(mod: ModuleType, root: Path) -> None:
    bad = (
        HEADER + "M01,DEU,fx_ip,sts_inpr_m,M.PROD.B-D.CA.I21.DE,headline,"
        '"seasonal_adjustment=CA",fixture\n'
    )
    # No shipped indicator uses a requires_sa transform yet: switch M01 in the temp copy.
    ind = root / "config/indicators.yaml"
    text = ind.read_text(encoding="utf-8")
    start = text.index("  - id: M01")
    ind.write_text(
        text[:start] + text[start:].replace("transform: YOY", "transform: M3M3_ANN", 1),
        encoding="utf-8",
    )
    with pytest.raises(mod.SeedError, match="rule 8"):
        mod.seed(_csv(root, bad), root)
    assert not (root / "config/series_map/fx_ip.yaml").exists()


def test_rule_12_global_scope_and_unknown_entity(mod: ModuleType, root: Path) -> None:
    bad = HEADER + "M09,XXX,fx,d,k,headline,,fixture\n"
    with pytest.raises(mod.SeedError, match="unknown entity"):
        mod.seed(_csv(root, bad), root)


def test_known_gap_conflicting_with_headline(mod: ModuleType, root: Path) -> None:
    bad = GOOD + "M09,DEU,fx_labour,,,known_gap,,oops\n"
    with pytest.raises(mod.SeedError, match="also has a headline"):
        mod.seed(_csv(root, bad), root)


def test_bad_expect_and_missing_columns(mod: ModuleType, root: Path) -> None:
    with pytest.raises(mod.SeedError, match="unknown expect keys"):
        mod.seed(_csv(root, HEADER + "M09,DEU,fx,d,k,headline,bogus=1,r\n"), root)
    with pytest.raises(mod.SeedError, match="missing CSV columns"):
        mod.seed(_csv(root, "indicator,entity\nM09,DEU\n"), root)


def test_missing_input_csv_is_reported(
    mod: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert mod.main([str(tmp_path / "nope.csv"), "--root", str(ROOT), "--check"]) == 2
    assert "does not exist" in capsys.readouterr().err
