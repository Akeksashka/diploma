"""ADR-029: effective_unit table, config key and validation (AC-UNIT-1, 8, 9 (no DB), 11)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.parsers import worldbank_v1
from macro_monitor.registry.config import ConfigError, load_yaml
from macro_monitor.registry.sync import MapEntry, load_config, parse_series_map
from macro_monitor.storage.series_create import (
    StagedMeta,
    effective_unit,
    unit_from_expect_used,
    with_effective_unit,
)

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "config" / "sources.yaml"
WB_MAP = "config/series_map/worldbank_annual.yaml"


@pytest.mark.parametrize(
    ("staged", "expect", "opt_in", "want"),
    [
        ("USD", None, False, "USD"),  # row 1: non-empty, no expect
        ("USD", None, True, "USD"),
        ("USD", "USD", False, "USD"),  # row 2: equal
        ("USD", "USD", True, "USD"),
        ("EUR", "USD", True, "EUR"),  # row 3: the source value always wins
        ("EUR", "USD", False, "EUR"),
        ("", "USD", True, "USD"),  # row 4: filled from expect
        (None, "USD", True, "USD"),  # None is empty
        ("   ", "USD", True, "USD"),  # whitespace only is empty
        ("", "USD", False, ""),  # row 5: no opt-in, stays empty
        (None, "USD", False, ""),
        ("", None, True, ""),  # row 6: nothing to fill with
        ("", None, False, ""),
        ("", "  ", True, ""),  # blank expect is no expect
        ("usd", "USD", True, "usd"),  # no case folding: a mismatch, not equal
        (" USD ", "USD", True, " USD "),  # a non-empty value is never trimmed
    ],
)
def test_ac_unit_1_effective_unit_table(
    staged: str | None, expect: str | None, opt_in: bool, want: str
) -> None:
    assert effective_unit(staged, expect, opt_in) == want


def _entry(**over: object) -> MapEntry:
    base: dict[str, object] = {
        "source_id": "S", "group_id": "G", "dataset": "d", "key": "k", "entity": "DEU",
        "indicator": "A01", "role": "headline", "valid_from": "1991-01-01", "valid_to": None,
        "rationale": "r", "splice_note": None, "expect": {"unit": "USD"},
        "unit_from_expect": True,
    }  # fmt: skip
    return MapEntry(**{**base, **over})  # type: ignore[arg-type]


def test_with_effective_unit_is_pure_and_idempotent() -> None:
    meta = StagedMeta("d|k", {"unit_code": "", "frequency": "A"})
    e = _entry()
    once = with_effective_unit(e, meta)
    assert once.values["unit_code"] == "USD"
    assert meta.values["unit_code"] == ""
    assert with_effective_unit(e, once) is once
    assert unit_from_expect_used(e, meta)
    assert not unit_from_expect_used(e, once)
    # no opt-in / non-empty staged / nothing to fill with: the very same object comes back
    assert with_effective_unit(_entry(unit_from_expect=False), meta) is meta
    full = StagedMeta("d|k", {"unit_code": "EUR"})
    assert with_effective_unit(e, full) is full
    assert with_effective_unit(_entry(expect={}), meta) is meta


def test_ac_unit_8_parsers_untouched() -> None:
    assert "worldbank_v1@1" in registry.RELEASED_PARSERS
    assert "worldbank_v2@2" in registry.RELEASED_PARSERS
    assert not any(k.startswith("worldbank_v3") for k in registry.RELEASED_PARSERS)
    doc = (ROOT / "tests/fixtures/raw/worldbank/fi_res_totl_cd_synthetic_p1.json").read_bytes()
    assert b'"unit": ""' in doc  # the recorded API bytes carry an empty unit
    assert worldbank_v1.__name__.endswith("worldbank_v1")


def test_ac_unit_9_staging_is_config_independent() -> None:
    """Parsing takes no configuration beyond the series filter: same bytes, same ``''`` unit."""
    from datetime import UTC, datetime

    from macro_monitor.ingestion.base import RawObject, SeriesFilter

    raw = RawObject(
        body=(ROOT / "tests/fixtures/raw/worldbank/fi_res_totl_cd_synthetic_p1.json").read_bytes(),
        source_id="worldbank",
        group_id="worldbank_annual",
        fetched_at=datetime(2026, 11, 3, tzinfo=UTC),
        parser_id="worldbank_v1@1",
    )
    flt = SeriesFilter(
        series_refs=frozenset({"FI.RES.TOTL.CD.DEU"}), missing_markers=frozenset({".."})
    )
    a, b = worldbank_v1.parse(raw, flt), worldbank_v1.parse(raw, flt)
    assert a == b
    assert [m.unit_code for m in a.metas] == [""]


# ---------------------------------------------------------------- config (AC-UNIT-11)


def _tree(tmp: Path) -> Path:
    shutil.copytree(ROOT / "config", tmp / "config")
    shutil.copy(ROOT / ".env.example", tmp / ".env.example")
    return tmp


def _set_flag(root: Path, value: str) -> None:
    p = root / "config/sources.yaml"
    text = p.read_text(encoding="utf-8")
    marker = "      - id: worldbank_annual\n"
    assert marker in text
    p.write_text(
        text.replace(marker, marker + f"        unit_from_expect: {value}\n", 1), encoding="utf-8"
    )


@pytest.mark.parametrize("value", ["true", "false"])
def test_ac_unit_11_schema_accepts_boolean(tmp_path: Path, value: str) -> None:
    root = _tree(tmp_path)
    _set_flag(root, value)
    cfg = load_config(root)
    group = next(
        g for s in cfg.sources.data["sources"] for g in s["groups"] if g["id"] == "worldbank_annual"
    )
    assert group["unit_from_expect"] is (value == "true")
    flags = {e.unit_from_expect for e in cfg.map_entries if e.group_id == "worldbank_annual"}
    assert flags == {value == "true"}


@pytest.mark.parametrize("value", ['"yes"', "1", "null"])
def test_ac_unit_11_schema_rejects_non_boolean(tmp_path: Path, value: str) -> None:
    root = _tree(tmp_path)
    _set_flag(root, value)
    with pytest.raises(ConfigError):
        load_config(root)


def test_ac_unit_11_flag_requires_expect_unit_on_every_entry(tmp_path: Path) -> None:
    root = _tree(tmp_path)
    _set_flag(root, "true")
    p = root / WB_MAP
    text = p.read_text(encoding="utf-8")
    assert "    unit: INTL_USD_PPP\n" in text or "    unit: USD\n" in text
    first = "    unit: INTL_USD_PPP\n" if "    unit: INTL_USD_PPP\n" in text else "    unit: USD\n"
    p.write_text(text.replace(first, "", 1), encoding="utf-8")
    with pytest.raises(ConfigError, match="unit_from_expect"):
        load_config(root)
    # the same map without the flag is fine (no unit is required without opt-in)
    root2 = _tree(tmp_path / "second")
    p2 = root2 / WB_MAP
    t2 = p2.read_text(encoding="utf-8")
    p2.write_text(t2.replace(first, "", 1), encoding="utf-8")
    load_config(root2)


def test_ac_unit_11_unknown_group_key_still_rejected(tmp_path: Path) -> None:
    root = _tree(tmp_path)
    p = root / "config/sources.yaml"
    marker = "      - id: worldbank_annual\n"
    p.write_text(
        p.read_text(encoding="utf-8").replace(
            marker, marker + "        unit_from_exepct: true\n", 1
        ),
        encoding="utf-8",
    )
    with pytest.raises(ConfigError):
        load_config(root)


def test_ac_unit_11_shipped_config_passes_and_every_wb_entry_has_unit() -> None:
    cfg = load_config(ROOT)
    wb = [e for e in cfg.map_entries if e.group_id == "worldbank_annual"]
    assert len(wb) == 210
    assert all(str(e.expect.get("unit") or "").strip() for e in wb)
    data = load_yaml(ROOT / WB_MAP)
    assert len(parse_series_map("worldbank", "worldbank_annual", data, WB_MAP)) == 210
