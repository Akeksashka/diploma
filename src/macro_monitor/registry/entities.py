"""Loader and validation rules for ``config/entities.yaml`` (T08).

Source of truth: ``docs/specs/source-config-schema.md`` rule 14 and ``ref.entity`` /
``ref.entity_group_member`` in ``docs/specs/ddl-neon-schema.md``.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date
from pathlib import Path
from typing import Any

from macro_monitor.registry.config import ConfigError, ConfigIssue, load_yaml

_ENTITY_KEYS = frozenset({"id", "name", "kind", "is_ranked", "is_global"})
_MEMBER_KEYS = frozenset({"entity", "valid_from", "valid_to"})
_AGGREGATES = ("EU27", "EA", "WLD")
N_COUNTRIES = 42


def _iso(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def validate_entities(data: object) -> list[ConfigIssue]:
    """Validate parsed ``entities.yaml``; returns all issues (empty means valid)."""
    out: list[ConfigIssue] = []
    if not isinstance(data, Mapping) or set(data) != {"entities", "groups"}:
        return [
            ConfigIssue("schema", "<root>", "expected exactly the keys 'entities' and 'groups'")
        ]
    entities = data["entities"]
    groups = data["groups"]
    if not isinstance(entities, list) or not isinstance(groups, list):
        return [ConfigIssue("schema", "<root>", "'entities' and 'groups' must be lists")]

    ids: list[str] = []
    countries = 0
    for i, e in enumerate(entities):
        path = f"entities[{i}]"
        if not isinstance(e, Mapping) or set(e) != _ENTITY_KEYS:
            out.append(ConfigIssue("schema", path, f"keys must be exactly {sorted(_ENTITY_KEYS)}"))
            continue
        eid = e["id"]
        path = f"entities[{i}]({eid})"
        if eid in ids:
            out.append(ConfigIssue("schema", path, "duplicate entity id"))
        ids.append(eid)
        kind, ranked, glob = e["kind"], e["is_ranked"], e["is_global"]
        if kind not in ("country", "aggregate"):
            out.append(ConfigIssue("schema", path, "kind must be 'country' or 'aggregate'"))
        if not isinstance(ranked, bool) or not isinstance(glob, bool):
            out.append(ConfigIssue("schema", path, "is_ranked and is_global must be booleans"))
            continue
        if kind == "country":
            countries += 1
        if kind != "country" and ranked:
            out.append(ConfigIssue("14", path, "an aggregate must be unranked (is_ranked: false)"))
        if glob and kind != "aggregate":
            out.append(ConfigIssue("14", path, "is_global requires kind: aggregate"))
        if (eid == "WLD") != glob:
            out.append(ConfigIssue("14", path, "is_global must be true for WLD and only for WLD"))
        if eid in _AGGREGATES and kind != "aggregate":
            out.append(ConfigIssue("14", path, f"{eid} must be an aggregate"))

    for agg in _AGGREGATES:
        n = ids.count(agg)
        if n != 1:
            out.append(ConfigIssue("14", "entities", f"expected exactly one {agg}, found {n}"))
    if countries != N_COUNTRIES:
        out.append(
            ConfigIssue("14", "entities", f"expected {N_COUNTRIES} countries, found {countries}")
        )

    seen_groups: set[str] = set()
    known = set(ids)
    for g_i, g in enumerate(groups):
        gpath = f"groups[{g_i}]"
        if not isinstance(g, Mapping) or set(g) != {"id", "members"}:
            out.append(ConfigIssue("schema", gpath, "keys must be exactly ['id', 'members']"))
            continue
        gid = g["id"]
        gpath = f"groups[{g_i}]({gid})"
        if gid in seen_groups:
            out.append(ConfigIssue("schema", gpath, "duplicate group id"))
        seen_groups.add(gid)
        seen_members: set[tuple[str, str]] = set()
        for m_i, m in enumerate(g["members"]):
            mpath = f"{gpath}.members[{m_i}]"
            if not isinstance(m, Mapping) or set(m) != _MEMBER_KEYS:
                out.append(ConfigIssue("schema", mpath, f"keys must be {sorted(_MEMBER_KEYS)}"))
                continue
            if m["entity"] not in known:
                out.append(ConfigIssue("schema", mpath, f"unknown entity {m['entity']!r}"))
            start = _iso(m["valid_from"])
            end = _iso(m["valid_to"]) if m["valid_to"] is not None else None
            if start is None or (m["valid_to"] is not None and end is None):
                out.append(ConfigIssue("schema", mpath, "valid_from/valid_to must be ISO dates"))
            elif end is not None and end <= start:
                out.append(ConfigIssue("schema", mpath, "valid_to must be after valid_from"))
            key = (m["entity"], str(m["valid_from"]))
            if key in seen_members:
                out.append(ConfigIssue("schema", mpath, "duplicate (entity, valid_from)"))
            seen_members.add(key)
    return out


def load_entities(path: Path) -> Mapping[str, Any]:
    """Load and validate ``entities.yaml``; raises :class:`ConfigError` on any issue."""
    data = load_yaml(path)
    issues = validate_entities(data)
    if issues:
        raise ConfigError(issues)
    assert isinstance(data, Mapping)
    return data


def group_members_on(data: Mapping[str, Any], group_id: str, on: date) -> frozenset[str]:
    """Entity ids that are members of ``group_id`` on date ``on``."""
    out: set[str] = set()
    for g in data["groups"]:
        if g["id"] != group_id:
            continue
        for m in g["members"]:
            start = date.fromisoformat(m["valid_from"])
            end = date.fromisoformat(m["valid_to"]) if m["valid_to"] else None
            if start <= on and (end is None or on < end):
                out.add(m["entity"])
    return frozenset(out)
