"""Indicator config schema and the ADR-014 resolution engine (T09).

Source of truth: ``docs/specs/source-config-schema.md`` section 3, 3a and rules 12, 13, 20, 28, 29;
``docs/specs/indicator-parameters-spec.md`` sections 2 and 8 (rules 22-26); ADR-014.

Resolution order, lowest to highest: ``global``, ``families.<id>``, the indicator entry. Fields
with no default at any layer must be written in the entry (rule 22). ``alert.override`` is never
inherited (rule 20). ``provenance`` is computed here and is not an authored key.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from importlib import resources
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from macro_monitor.registry.config import (
    ConfigError,
    ConfigIssue,
    indicator_input_issues,
    load_yaml,
)

#: The domain ids of the config (DDL ``ref.domain`` seed; ``markets`` was dropped, rule 13).
KNOWN_DOMAIN_IDS = frozenset(
    {
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
)
#: Domains that must carry ``ranked: false`` (rule 13; D12, B9).
UNRANKED_DOMAIN_IDS = frozenset({"agri", "global"})
#: Fields that must be written in the entry (ADR-014 decision 3, rule 22): dotted paths.
NO_DEFAULT_FIELDS = (
    "kind",
    "scope",
    "tier",
    "priority",
    "currency_basis",
    "transform",
    "rank.mode",
    "rank.good_dir",
    "alert.adverse",
    "domains",
)
#: Resolved leaf fields and their layers (indicator -> family -> global).
_ALERT_LEAVES = ("method", "alert_z", "watch_z", "window_obs", "min_obs")
_TIERED_LEAVES = frozenset({"window_obs", "min_obs"})
_ENTRY_ALERT_KEYS_WITH_SCALAR = ("alert_z", "watch_z", "window_obs", "min_obs")


def indicators_schema() -> dict[str, Any]:
    """The JSON schema shipped as package data of ``macro_monitor.registry``."""
    text = (
        resources.files("macro_monitor.registry")
        .joinpath("schemas/indicators.schema.json")
        .read_text(encoding="utf-8")
    )
    schema: dict[str, Any] = json.loads(text)
    return schema


def _jpath(parts: Sequence[object]) -> str:
    out = ""
    for p in parts:
        out += f"[{p}]" if isinstance(p, int) else (f".{p}" if out else str(p))
    return out or "<root>"


def _schema_issues(data: object, entry_point: str) -> list[ConfigIssue]:
    schema = indicators_schema()
    wrapper = {
        "$schema": schema["$schema"],
        "$defs": schema["$defs"],
        "$ref": f"#/$defs/{entry_point}",
    }
    validator = Draft202012Validator(wrapper, format_checker=Draft202012Validator.FORMAT_CHECKER)
    out: list[ConfigIssue] = []
    for e in sorted(validator.iter_errors(data), key=lambda e: list(map(str, e.absolute_path))):
        # An unknown key in an indicator entry is rule 23 (AC-PAR-9).
        rule = "23" if e.validator == "additionalProperties" else "schema"
        out.append(ConfigIssue(rule, _jpath(list(e.absolute_path)), e.message))
    return out


def _get(d: Mapping[str, Any] | None, dotted: str) -> Any:
    cur: Any = d
    for part in dotted.split("."):
        if not isinstance(cur, Mapping) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _has(d: Mapping[str, Any], dotted: str) -> bool:
    cur: Any = d
    for part in dotted.split("."):
        if not isinstance(cur, Mapping) or part not in cur:
            return False
        cur = cur[part]
    return True


# --------------------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ResolvedIndicator:
    """One indicator after layered resolution.

    ``values`` holds every resolved field by dotted name; ``provenance`` maps the defaulted
    fields to ``global`` | ``family:<id>`` | ``indicator`` (ADR-014 decision 4); ``review`` is
    ``{status, by, on}`` with ``proposed`` when absent.
    """

    id: str
    values: Mapping[str, Any]
    provenance: Mapping[str, str]
    review: Mapping[str, Any]
    alert_override: tuple[Mapping[str, Any], ...] = ()


def _tier_value(value: Any, tier: str) -> Any:
    return value[tier] if isinstance(value, Mapping) else value


def resolve_indicator(entry: Mapping[str, Any], defaults: Mapping[str, Any]) -> ResolvedIndicator:
    """Resolve one (already validated) indicator entry against the defaults file."""
    tier = str(entry["tier"])
    family_id = entry.get("family")
    family: Mapping[str, Any] = defaults["families"][family_id] if family_id else {}
    glob: Mapping[str, Any] = defaults["global"]
    layers: tuple[tuple[str, Mapping[str, Any]], ...] = (
        ("indicator", entry),
        (f"family:{family_id}", family),
        ("global", glob),
    )
    values: dict[str, Any] = {}
    prov: dict[str, str] = {}

    for path in NO_DEFAULT_FIELDS:
        values[path] = copy.deepcopy(_get(entry, path))
        prov[path] = "indicator"
    for path in ("rank.display_dir", "rank.targets", "name", "id", "notes", "is_comparison"):
        values[path] = copy.deepcopy(_get(entry, path))
    values["is_comparison"] = bool(entry.get("is_comparison", False))
    values["inputs"] = copy.deepcopy(list(entry.get("inputs") or []))

    def pick(path: str, *, tiered: bool = False) -> None:
        for layer_name, layer in layers:
            if _has(layer, path):
                v = _get(layer, path)
                values[path] = _tier_value(v, tier) if tiered else v
                prov[path] = layer_name
                return
        values[path] = None

    for simple in (
        "staleness_class",
        "stationarity_class",
        "release_lag_aware",
        "rank_period_coverage_pct",
    ):
        pick(simple)
    pick("max_ref_spread_days", tiered=True)
    for leaf in _ALERT_LEAVES:
        pick(f"alert.{leaf}", tiered=leaf in _TIERED_LEAVES)

    review = dict(entry.get("review") or {"status": "proposed"})
    override = tuple(copy.deepcopy(list(_get(entry, "alert.override") or [])))
    return ResolvedIndicator(str(entry["id"]), values, prov, review, override)


# --------------------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------------------


def validate_defaults(data: object) -> list[ConfigIssue]:
    """Shape of ``indicator_defaults.yaml`` (section 3a)."""
    return _schema_issues(data, "defaults_file")


def _domain_issues(domains: Sequence[Mapping[str, Any]]) -> list[ConfigIssue]:
    out: list[ConfigIssue] = []
    seen: set[str] = set()
    for i, d in enumerate(domains):
        path = f"domains[{i}]({d['id']})"
        if d["id"] not in KNOWN_DOMAIN_IDS:
            out.append(ConfigIssue("13", path, f"unknown domain id {d['id']!r}"))
        if d["id"] in seen:
            out.append(ConfigIssue("13", path, "duplicate domain id"))
        seen.add(d["id"])
        if d["id"] in UNRANKED_DOMAIN_IDS and d["ranked"]:
            out.append(ConfigIssue("13", path, f"domain {d['id']!r} must carry ranked: false"))
    return out


def _entry_issues(
    e: Mapping[str, Any],
    idx: int,
    *,
    defaults: Mapping[str, Any],
    domain_ranked: Mapping[str, bool],
    kinds: Mapping[str, str],
    entity_groups: Collection[str] | None,
    forbid_unconfirmed_override: bool,
) -> list[ConfigIssue]:
    out: list[ConfigIssue] = []
    base = f"indicators[{idx}]({e['id']})"

    def add(rule: str, sub: str, msg: str) -> None:
        out.append(ConfigIssue(rule, f"{base}{sub}", msg))

    family_id = e.get("family")
    families: Mapping[str, Any] = defaults["families"]

    # Rule 23: the family must exist.
    if family_id is not None and family_id not in families:
        add("23", ".family", f"unknown family {family_id!r}")
        return out  # nothing further can be resolved

    # Rule 22: no-default fields written in the entry; defaulted fields resolve somewhere.
    for path in NO_DEFAULT_FIELDS:
        if not _has(e, path):
            add("22", f".{path}", f"{path} has no default at any layer and must be written")
    if _get(e, "rank.mode") == "target_distance" and not e["rank"].get("targets"):
        add("22", ".rank.targets", "target_distance needs rank.targets (target source)")
    required_ok = all(_has(e, p) for p in NO_DEFAULT_FIELDS)
    if "tier" in e:
        r = resolve_indicator(e, defaults)
        for leaf in ("staleness_class", "alert.method", "stationarity_class", "release_lag_aware"):
            if r.values.get(leaf) is None:
                add("22", f".{leaf}", f"{leaf} resolves at no layer (entry, family, global)")
        for leaf in ("max_ref_spread_days", "alert.alert_z", "alert.watch_z"):
            if r.values.get(leaf) is None:
                add("22", f".{leaf}", f"{leaf} resolves at no layer (entry, family, global)")
        for leaf in ("alert.window_obs", "alert.min_obs"):
            if r.values.get(leaf) is None:
                add("22", f".{leaf}", f"{leaf} resolves at no layer (entry, family, global)")
    else:
        r = None
    if not required_ok or r is None:
        return out

    kind = e["kind"]
    rank = e["rank"]
    mode = rank["mode"]
    good_dir = rank.get("good_dir")
    method = r.values["alert.method"]

    # Rule 12: rank and direction consistency.
    if mode == "monotone_good" and good_dir not in (-1, 1):
        add("12", ".rank.good_dir", "monotone_good needs good_dir of +1 or -1")
    if mode in ("target_distance", "descriptive_only") and good_dir != 0:
        add("12", ".rank.good_dir", f"{mode} needs good_dir 0")
    if kind == "input":
        if e["domains"]:
            add("12", ".domains", "a kind: input indicator has no domains")
        if mode != "descriptive_only":
            add("12", ".rank.mode", "a kind: input indicator is descriptive_only")
        if method != "none":
            add("12", ".alert.method", "a kind: input indicator has alert.method none")
    if e.get("scope") == "global" and mode != "descriptive_only":
        add("12", ".rank.mode", "a scope: global indicator is descriptive_only")
    for j, inp in enumerate(e.get("inputs") or []):
        target_kind = kinds.get(inp["id"])
        if target_kind is None:
            add("12", f".inputs[{j}].id", f"unknown input indicator {inp['id']!r}")
        elif target_kind != "input":
            add("12", f".inputs[{j}].id", f"{inp['id']!r} is not a kind: input indicator")

    # Rule 44 (G02 amendment): scope: global <=> exactly one membership, in domain global.
    member_ids = [d["id"] for d in e["domains"]]
    if e.get("scope") == "global" and kind != "input" and member_ids != ["global"]:
        add(
            "44",
            ".domains",
            f"indicator {e['id']!r} has scope: global and must belong to domain 'global' only; "
            f"found {member_ids}",
        )
    elif e.get("scope") != "global" and "global" in member_ids:
        add(
            "44",
            ".domains",
            f"indicator {e['id']!r} has scope: {e.get('scope')} and must not belong to domain "
            "'global'",
        )

    # Rule 13 (reference side): the domain exists; rule 25: ranked flags.
    ranked_in_ranked_domain = False
    for j, d in enumerate(e["domains"]):
        if d["id"] not in KNOWN_DOMAIN_IDS or d["id"] not in domain_ranked:
            add("13", f".domains[{j}].id", f"unknown domain {d['id']!r}")
            continue
        if d["ranked"] and not domain_ranked[d["id"]]:
            add(
                "25",
                f".domains[{j}]",
                f"ranked: true in domain {d['id']!r}, which has ranked: false",
            )
        if d["ranked"] and domain_ranked[d["id"]]:
            ranked_in_ranked_domain = True
        if d["ranked"] and mode == "descriptive_only":
            add("25", f".domains[{j}]", "a descriptive_only indicator cannot be ranked: true")
    if mode != "descriptive_only" and kind == "indicator" and not ranked_in_ranked_domain:
        add(
            "25",
            ".rank.mode",
            f"{mode} requires a ranked: true entry in a domain with ranked: true; "
            "an indicator in unranked domains may be descriptive_only only",
        )

    # Rule 26: alert.method none for input, comparison and weo_projection.
    if method != "none" and (
        kind == "input" or e.get("is_comparison") or family_id == "weo_projection"
    ):
        what = "kind: input" if kind == "input" else "comparison/weo_projection"
        add("26", ".alert.method", f"{what} indicators must have alert.method none")

    # Rule 24: review.
    review = e.get("review")
    if review is not None:
        status = review["status"]
        if status not in ("proposed", "confirmed"):
            add("24", ".review.status", f"{status!r} is not proposed or confirmed")
        elif status == "confirmed" and not (review.get("by") and review.get("on")):
            add("24", ".review", "confirmed requires by and on")

    # Rule 20: alert.override.
    override = _get(e, "alert.override")
    for j, o in enumerate(override or []):
        op = f".alert.override[{j}]"
        if not str(o.get("rationale") or "").strip():
            add("20", op, "an alert.override entry needs a non-empty rationale")
        if entity_groups is not None and o["entity_group"] not in entity_groups:
            add("20", op, f"unknown entity_group {o['entity_group']!r}")
    if override and forbid_unconfirmed_override:
        confirmed = (review or {}).get("status") == "confirmed"
        if not confirmed:
            add("20", ".alert.override", "a non-empty alert.override needs review.status confirmed")

    # Rule 28.
    for issue in indicator_input_issues(e):
        out.append(ConfigIssue(issue.rule, f"{base}{issue.path.split(')', 1)[1]}", issue.message))
    return out


def validate_indicators(
    data: object,
    defaults: Mapping[str, Any],
    *,
    entity_groups: Collection[str] | None = None,
    forbid_unconfirmed_override: bool = False,
) -> list[ConfigIssue]:
    """Validate parsed ``indicators.yaml`` against the (valid) defaults; all issues returned."""
    issues = _schema_issues(data, "indicators_file")
    if issues:
        return issues
    assert isinstance(data, Mapping)
    domains = data["domains"]
    issues.extend(_domain_issues(domains))
    domain_ranked = {d["id"]: bool(d["ranked"]) for d in domains}
    kinds = {i["id"]: i.get("kind", "") for i in data["indicators"]}
    seen: set[str] = set()
    for idx, e in enumerate(data["indicators"]):
        if e["id"] in seen:
            issues.append(ConfigIssue("schema", f"indicators[{idx}].id", f"duplicate {e['id']!r}"))
        seen.add(e["id"])
        issues.extend(
            _entry_issues(
                e,
                idx,
                defaults=defaults,
                domain_ranked=domain_ranked,
                kinds=kinds,
                entity_groups=entity_groups,
                forbid_unconfirmed_override=forbid_unconfirmed_override,
            )
        )
    return issues


@dataclass(frozen=True)
class IndicatorsConfig:
    """Validated and resolved indicator configuration."""

    domains: tuple[Mapping[str, Any], ...]
    indicators: tuple[ResolvedIndicator, ...]
    defaults: Mapping[str, Any]
    warnings: tuple[ConfigIssue, ...] = field(default=())

    def proposed(self) -> tuple[str, ...]:
        """Ids of indicators whose review status is ``proposed`` (``config-report``, AC-PAR-7)."""
        return tuple(i.id for i in self.indicators if i.review.get("status") == "proposed")

    def by_id(self, indicator_id: str) -> ResolvedIndicator:
        for i in self.indicators:
            if i.id == indicator_id:
                return i
        raise KeyError(indicator_id)


def load_indicators(
    indicators_path: Path,
    defaults_path: Path,
    *,
    entity_groups: Collection[str] | None = None,
    forbid_unconfirmed_override: bool = True,
    today: date | None = None,
) -> IndicatorsConfig:
    """Load, validate and resolve the indicator config; raises :class:`ConfigError`.

    ``forbid_unconfirmed_override`` is on for the checked-in file (AC-CFG-12).
    """
    del today
    defaults = load_yaml(defaults_path)
    issues = validate_defaults(defaults)
    if issues:
        raise ConfigError(issues)
    data = load_yaml(indicators_path)
    issues = validate_indicators(
        data,
        defaults,
        entity_groups=entity_groups,
        forbid_unconfirmed_override=forbid_unconfirmed_override,
    )
    if issues:
        raise ConfigError(issues)
    resolved = tuple(resolve_indicator(e, defaults) for e in data["indicators"])
    return IndicatorsConfig(tuple(data["domains"]), resolved, defaults)
