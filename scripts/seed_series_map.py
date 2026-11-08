#!/usr/bin/env python3
"""Seed ``config/series_map/<group>.yaml`` and ``config/known_gaps.yaml`` from a reviewed CSV.

Spec: docs/specs/source-config-schema.md section 4 (T52); ADR-009 (mapping), ADR-018 (pending
entries).  CSV columns: indicator, entity, source, dataset, key, role, expect, rationale
(optional: valid_from, valid_to, splice_note).  ``source`` is the series-map group id (the
file name stem).  ``role`` is headline | fallback | comparison | known_gap; a ``known_gap`` row
needs only indicator, entity and rationale.  ``expect`` is a JSON object or ``k=v;k=v``.

Output is validated with the sync-config rules (8, 12, 14, T-DDL-4) before anything is written,
sorted and deterministic, so re-running on the same CSV changes nothing.  Only the groups named
in the CSV are rewritten; ``known_gaps.yaml`` is merged (existing entries are kept).
No input CSV means no series: this tool never invents data.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from macro_monitor.registry.config import ConfigError, ConfigIssue  # noqa: E402
from macro_monitor.registry.entities import load_entities  # noqa: E402
from macro_monitor.registry.indicators import load_indicators  # noqa: E402
from macro_monitor.registry.sync import map_issues, parse_series_map  # noqa: E402

REQUIRED = ("indicator", "entity", "source", "role", "rationale")
ENTRY_FIELDS = ("dataset", "key", "entity", "indicator", "role", "valid_from", "valid_to")
EXPECT_KEYS = {
    "frequency",
    "unit",
    "base_period",
    "seasonal_adjustment",
    "price_basis",
    "flow_basis",
    "composition",
}

#: 15 non-EU panel countries (indicator-selection doc, "Coverage"; data-sources F13 point 3).
NON_EU = [
    "ARG",
    "AUS",
    "BRA",
    "CAN",
    "CHN",
    "GBR",
    "IDN",
    "IND",
    "JPN",
    "KOR",
    "MEX",
    "SAU",
    "TUR",
    "USA",
    "ZAF",
]
#: IMF WEO output gap present for 25 of 42 (data-sources F6 table, column "IMF gap" = no).
A02_MISSING = [
    "ARG",
    "BGR",
    "BRA",
    "CHN",
    "CZE",
    "HRV",
    "HUN",
    "IDN",
    "IND",
    "LTU",
    "LVA",
    "MEX",
    "POL",
    "ROU",
    "SAU",
    "TUR",
    "ZAF",
]
_F13 = "docs/research/data-sources-g20-eu-cross-country.md"
#: Baseline known gaps stated in plan T52 and source-config-schema section 4, with the
#: research evidence (country lists from data-sources F5/F6/F13, 2026-10-17, VERIFIED-LIVE).
BASELINE_GAPS: tuple[tuple[str, str, str], ...] = (
    *(
        (
            "M07",
            e,
            f"No core-inflation source for non-EU country other than Turkiye ({_F13} F5, F13)",
        )
        for e in NON_EU
        if e != "TUR"
    ),
    *(
        ("Q08", e, f"No quarterly government-debt source for non-EU countries ({_F13} F5, F13)")
        for e in NON_EU
    ),
    *(
        ("M18", e, f"10-year yield source not found ({_F13} F5, F13)")
        for e in ("ARG", "SAU", "TUR")
    ),
    *(
        ("A02", e, f"IMF WEO output gap not published for this country ({_F13} F6)")
        for e in A02_MISSING
    ),
)


class SeedError(Exception):
    """Input or validation problem; nothing is written."""


def parse_expect(text: str, where: str) -> dict[str, str]:
    text = text.strip()
    if not text:
        return {}
    if text.startswith("{"):
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SeedError(f"{where}: expect is not valid JSON: {exc}") from exc
    else:
        raw = {}
        for part in text.split(";"):
            k, sep, v = part.partition("=")
            if not sep:
                raise SeedError(f"{where}: expect part {part!r} is not k=v")
            raw[k.strip()] = v.strip()
    if not isinstance(raw, dict):
        raise SeedError(f"{where}: expect must be an object")
    bad = sorted(set(raw) - EXPECT_KEYS)
    if bad:
        raise SeedError(f"{where}: unknown expect keys {bad}")
    return {str(k): str(v) for k, v in raw.items()}


def read_csv(path: Path) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, str]]]:
    """Return (entries per group, known-gap rows)."""
    groups: dict[str, list[dict[str, Any]]] = {}
    gaps: list[dict[str, str]] = []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if missing:
            raise SeedError(f"{path}: missing CSV columns {missing}")
        for n, row in enumerate(reader, start=2):
            where = f"{path.name}:{n}"
            r = {k: (v or "").strip() for k, v in row.items() if k}
            for c in REQUIRED:
                if not r.get(c):
                    raise SeedError(f"{where}: empty {c!r}")
            if r["role"] == "known_gap":
                gaps.append(
                    {"indicator": r["indicator"], "entity": r["entity"], "reason": r["rationale"]}
                )
                continue
            for c in ("dataset", "key"):
                if not r.get(c):
                    raise SeedError(f"{where}: empty {c!r}")
            e: dict[str, Any] = {c: r[c] for c in ENTRY_FIELDS if r.get(c)}
            e["rationale"] = r["rationale"]
            if r.get("splice_note"):
                e["splice_note"] = r["splice_note"]
            e["expect"] = parse_expect(r.get("expect", ""), where)
            groups.setdefault(r["source"], []).append(e)
    return groups, gaps


def _sort_key(e: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(
        str(e.get(k, "")) for k in ("indicator", "entity", "dataset", "key", "role", "valid_from")
    )


def validate(
    groups: Mapping[str, Sequence[Mapping[str, Any]]],
    gap_pairs: Sequence[tuple[str, str]],
    root: Path,
) -> list[ConfigIssue]:
    """Rules 8, 12, 14, T-DDL-4 on the entries; known gaps must name real pairs."""
    cfg = root / "config"
    ents = load_entities(cfg / "entities.yaml")
    entity_ids = frozenset(e["id"] for e in ents["entities"])
    inds = load_indicators(
        cfg / "indicators.yaml",
        cfg / "indicator_defaults.yaml",
        entity_groups={g["id"] for g in ents["groups"]},
    )
    ind_ids = {i.id for i in inds.indicators}
    issues: list[ConfigIssue] = []
    entries = []
    for gid, items in groups.items():
        entries.extend(parse_series_map("seed", gid, {"series": list(items)}, f"{gid}.yaml"))
    issues += map_issues(entries, inds, entity_ids)
    headline = {(e.indicator, e.entity) for e in entries if e.role == "headline"}
    for ind, ent in gap_pairs:
        if ind not in ind_ids:
            issues.append(ConfigIssue("AC-CFG-2", f"known_gap {ind}/{ent}", "unknown indicator"))
        if ent not in entity_ids:
            issues.append(ConfigIssue("14", f"known_gap {ind}/{ent}", "unknown entity"))
        if (ind, ent) in headline:
            issues.append(
                ConfigIssue("schema", f"known_gap {ind}/{ent}", "pair also has a headline mapping")
            )
    return issues


def _dump(data: object) -> str:
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=100)


def render_group(group: str, items: Sequence[Mapping[str, Any]]) -> str:
    ordered = []
    for e in sorted(items, key=_sort_key):
        ordered.append(
            {
                **{k: e[k] for k in ENTRY_FIELDS if k in e},
                "rationale": e["rationale"],
                **({"splice_note": e["splice_note"]} if "splice_note" in e else {}),
                "expect": dict(e["expect"]),
            }
        )
    head = (
        f"# Series map of group {group}, generated by scripts/seed_series_map.py (reviewed CSV)\n"
        "# (source-config-schema section 4). Edit the CSV and re-run, or review by diff.\n"
    )
    return head + _dump({"series": ordered})


def render_gaps(existing: Sequence[Mapping[str, str]], new: Sequence[Mapping[str, str]]) -> str:
    merged: dict[tuple[str, str], dict[str, str]] = {}
    for g in [*existing, *new]:
        merged.setdefault((g["indicator"], g["entity"]), dict(g))
    rows = [merged[k] for k in sorted(merged)]
    head = (
        "# Known coverage gaps (source-config-schema section 4; ADR-009). Pairs listed here are\n"
        "# separated from missing work by `macro-monitor config-report`. Generated/merged by\n"
        "# scripts/seed_series_map.py; evidence: data-sources research F5/F6/F13 (2026-10-17).\n"
    )
    return head + _dump({"known_gaps": rows})


def seed(csv_path: Path | None, root: Path, *, write: bool = True) -> dict[str, str]:
    """Return {relative path: new content}; write them unless ``write`` is false."""
    groups: dict[str, list[dict[str, Any]]] = {}
    new_gaps = [{"indicator": i, "entity": e, "reason": r} for i, e, r in BASELINE_GAPS]
    if csv_path is not None:
        groups, csv_gaps = read_csv(csv_path)
        new_gaps += csv_gaps
    gaps_file = root / "config" / "known_gaps.yaml"
    existing: list[dict[str, str]] = []
    if gaps_file.is_file():
        existing = (yaml.safe_load(gaps_file.read_text(encoding="utf-8")) or {}).get(
            "known_gaps", []
        )
    pairs = [(g["indicator"], g["entity"]) for g in [*existing, *new_gaps]]
    issues = validate(groups, pairs, root)
    if issues:
        raise SeedError("\n".join(str(i) for i in issues))
    out = {f"config/series_map/{g}.yaml": render_group(g, items) for g, items in groups.items()}
    out["config/known_gaps.yaml"] = render_gaps(existing, new_gaps)
    if write:
        for rel, text in out.items():
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            if not p.is_file() or p.read_text(encoding="utf-8") != text:
                p.write_text(text, encoding="utf-8")
    return out


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0] if __doc__ else None)
    ap.add_argument("csv", nargs="?", type=Path, help="reviewed mapping CSV (omit: gaps only)")
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    a = ap.parse_args(argv)
    if a.csv is not None and not a.csv.is_file():
        print(f"error: input CSV {a.csv} does not exist; no series are invented", file=sys.stderr)
        return 2
    try:
        out = seed(a.csv, a.root, write=not a.check)
    except (SeedError, ConfigError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"{'checked' if a.check else 'wrote'}: {', '.join(sorted(out))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
