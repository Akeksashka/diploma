"""T08: entities.yaml and rule 14."""

from __future__ import annotations

import copy
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from macro_monitor.registry.config import ConfigError, load_yaml
from macro_monitor.registry.entities import group_members_on, load_entities, validate_entities

ROOT = Path(__file__).resolve().parents[3]
PATH = ROOT / "config" / "entities.yaml"

pytestmark = pytest.mark.unit


@pytest.fixture
def data() -> dict[str, Any]:
    d = load_entities(PATH)
    return copy.deepcopy(dict(d))


def test_checked_in_file_valid() -> None:
    d = load_entities(PATH)
    assert len(d["entities"]) == 45
    by_id = {e["id"]: e for e in d["entities"]}
    assert by_id["WLD"]["is_global"] is True
    assert by_id["WLD"]["is_ranked"] is False
    assert by_id["WLD"]["kind"] == "aggregate"
    assert sum(e["kind"] == "country" for e in d["entities"]) == 42


def test_euro_area_membership_dates() -> None:
    d = load_entities(PATH)
    assert len(group_members_on(d, "euro_area", date(2025, 12, 31))) == 20
    ea_2026 = group_members_on(d, "euro_area", date(2026, 1, 1))
    assert len(ea_2026) == 21
    assert "BGR" in ea_2026
    assert "BGR" not in group_members_on(d, "euro_area", date(2025, 12, 31))
    assert group_members_on(d, "g7", date(2026, 1, 1)) == {
        "CAN",
        "FRA",
        "DEU",
        "ITA",
        "JPN",
        "GBR",
        "USA",
    }


def test_advanced_emerging_partition_countries() -> None:
    d = load_entities(PATH)
    on = date(2026, 6, 1)
    adv, emg = group_members_on(d, "advanced", on), group_members_on(d, "emerging", on)
    countries = {e["id"] for e in d["entities"] if e["kind"] == "country"}
    assert adv | emg == countries
    assert not adv & emg


def test_loader_raises_on_bad_file(tmp_path: Path, data: dict[str, Any]) -> None:
    data["entities"] = [e for e in data["entities"] if e["id"] != "WLD"]
    import yaml

    p = tmp_path / "e.yaml"
    p.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_entities(p)
    assert load_yaml(p)["groups"]


def _rules(issues: list[Any]) -> set[str]:
    return {i.rule for i in issues}


def test_rule14_missing_wld(data: dict[str, Any]) -> None:
    data["entities"] = [e for e in data["entities"] if e["id"] != "WLD"]
    issues = validate_entities(data)
    assert any("WLD" in i.message and i.rule == "14" for i in issues)


def test_rule14_duplicate_wld(data: dict[str, Any]) -> None:
    wld = next(e for e in data["entities"] if e["id"] == "WLD")
    data["entities"].append(dict(wld))
    assert "14" in _rules(validate_entities(data))


def test_rule14_41_countries(data: dict[str, Any]) -> None:
    data["entities"] = [e for e in data["entities"] if e["id"] != "ARG"]
    issues = validate_entities(data)
    assert any("42 countries" in i.message for i in issues)


def test_rule14_missing_ea_and_eu27(data: dict[str, Any]) -> None:
    data["entities"] = [e for e in data["entities"] if e["id"] not in ("EA", "EU27")]
    msgs = [i.message for i in validate_entities(data) if i.rule == "14"]
    assert any("EA" in m for m in msgs)
    assert any("EU27" in m for m in msgs)


def test_wld_must_be_global_and_unranked(data: dict[str, Any]) -> None:
    for e in data["entities"]:
        if e["id"] == "WLD":
            e["is_global"] = False
    assert "14" in _rules(validate_entities(data))


def test_aggregate_cannot_be_ranked(data: dict[str, Any]) -> None:
    for e in data["entities"]:
        if e["id"] == "EA":
            e["is_ranked"] = True
    assert "14" in _rules(validate_entities(data))


def test_group_member_unknown_entity_and_bad_dates(data: dict[str, Any]) -> None:
    data["groups"][0]["members"].append(
        {"entity": "XXX", "valid_from": "2000-01-01", "valid_to": None}
    )
    data["groups"][0]["members"].append(
        {"entity": "DEU", "valid_from": "2000-01-01", "valid_to": "1999-01-01"}
    )
    msgs = " ".join(i.message for i in validate_entities(data))
    assert "unknown entity" in msgs
    assert "after valid_from" in msgs


def test_unknown_keys_rejected(data: dict[str, Any]) -> None:
    data["entities"][0]["extra"] = 1
    assert "schema" in _rules(validate_entities(data))
    assert "schema" in _rules(validate_entities({"entities": []}))
