"""``meta/*`` files of the dashboard export (T83; export spec sections 4 and 10, EXP-03).

Everything database-derived comes from objects readable by ``mm_reader`` (``ref.entity``,
``ref.entity_group_member``, ``ref.domain``, ``ref.indicator_domain``, the granted columns of
``ref.indicator`` and ``ref.v_series_export``). The two config-only fields of ``meta/series.json``
(``published_precision``, ``source_url``) and the target of ``target_distance`` indicators are read
from the config tree of the selected analysis run's ``git_sha`` (:class:`ConfigTree`; EXP-03).
Input (support) indicators are one set (``kind = 'input'``) and never appear; comparison-role
indicators (``is_comparison``) are excluded as well (principle 4).
"""

from __future__ import annotations

import re
import subprocess
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any

from macro_monitor.analytics.staleness import CLASS_LIMITS
from macro_monitor.publish.export import (
    ExportError,
    ExportSession,
    ExportSink,
    Producer,
    sorted_by_id,
)
from macro_monitor.publish.manifest import RunInfo
from macro_monitor.registry.config import load_yaml_text
from macro_monitor.registry.sync import MapEntry, SyncError, parse_series_map

META_SCHEMA_VERSION = "1.0"
#: Fixed text of the domain figure (spec section 4 / round 5).
PERCENTILE_RANK_LABEL = "mean percentile of the domain's indicators"
#: The selectors served by the series files (spec section 6); not configurable.
TRANSFORM_OPTIONS = ("level", "default", "yoy")
#: Fixed per-indicator wording required by the spec (section 4, B4). Config ``notes`` are internal
#: working notes and are deliberately NOT copied into a public file.
INDICATOR_NOTES: Mapping[str, tuple[str, ...]] = {
    "M18": (
        "Non-euro countries: local-currency yield spread (includes inflation/FX expectations), "
        "not sovereign credit risk",
    ),
}
_SHA = re.compile(r"[0-9a-f]{7,40}")
SOURCES_PATH = "config/sources.yaml"
TARGETS_DIR = "config/targets"


# --------------------------------------------------------------------------------------
# Config tree at a git sha (EXP-03)
# --------------------------------------------------------------------------------------


def same_sha(a: str, b: str) -> bool:
    """Abbreviated and full shas of one commit compare equal (both at least 7 hex digits)."""
    a, b = a.lower(), b.lower()
    return bool(_SHA.fullmatch(a) and _SHA.fullmatch(b) and (a.startswith(b) or b.startswith(a)))


@dataclass(frozen=True)
class ConfigTree:
    """Read-only view of the repository config at ``git_sha``. ``read`` returns the text of a
    repo-relative file, ``listdir`` the file names directly under a repo-relative directory."""

    git_sha: str
    read: Callable[[str], str]
    listdir: Callable[[str], list[str]]

    @classmethod
    def from_git(cls, root: Path, git_sha: str) -> ConfigTree:
        """Config as committed at ``git_sha`` (``git show``). An unknown or malformed sha is an
        EXP-03 failure: there is no fallback to the working tree (it could be another version)."""
        if not _SHA.fullmatch(git_sha.lower()):
            raise ExportError(f"EXP-03: git_sha {git_sha!r} is not a commit hash", check="EXP-03")

        def git(*args: str) -> str:
            proc = subprocess.run(
                ["git", "-C", str(root), *args], capture_output=True, text=True, check=False
            )
            if proc.returncode != 0:
                raise ExportError(
                    f"EXP-03: git {args[0]} failed for config at {git_sha[:12]}", check="EXP-03"
                )
            return proc.stdout

        full = git("rev-parse", "--verify", f"{git_sha.lower()}^{{commit}}").strip()

        def read(rel: str) -> str:
            return git("show", f"{full}:{rel}")

        def listdir(rel: str) -> list[str]:
            out = git("ls-tree", "--name-only", full, f"{rel.rstrip('/')}/")
            return sorted(PurePosixPath(p).name for p in out.splitlines() if p)

        return cls(full, read, listdir)

    def yaml(self, rel: str) -> Any:
        return load_yaml_text(self.read(rel))

    def verify(self, run: RunInfo) -> None:
        """EXP-03: the config tree used has the ``git_sha`` of the selected analysis run."""
        if not same_sha(self.git_sha, run.git_sha):
            raise ExportError(
                f"EXP-03: config tree is at {self.git_sha[:12]} but the analysis run used "
                f"{run.git_sha[:12]}",
                check="EXP-03",
            )


def source_urls(config: ConfigTree) -> dict[str, str | None]:
    """``source_id -> licence.url`` (landing page for attribution)."""
    out: dict[str, str | None] = {}
    for s in config.yaml(SOURCES_PATH)["sources"]:
        lic = s.get("licence") or {}
        out[str(s["id"])] = lic.get("url")
    return out


def group_precisions(config: ConfigTree) -> dict[tuple[str, str], int | None]:
    """``(source_id, series_key) -> published_precision`` of the group whose series map lists the
    series. ``v_series_export`` has no group column; the group is found through the series map
    files of ``config/sources.yaml`` at the same sha. A key listed by groups that disagree is
    null."""
    found: dict[tuple[str, str], set[int | None]] = defaultdict(set)
    for s in config.yaml(SOURCES_PATH)["sources"]:
        for g in s.get("groups") or []:
            rel = g.get("series_map")
            if not rel:
                continue
            prec = g.get("published_precision")
            try:
                entries: Sequence[MapEntry] = parse_series_map(
                    str(s["id"]), str(g["id"]), config.yaml(str(rel)), str(rel)
                )
            except SyncError as exc:
                raise ExportError(f"EXP-03: unreadable series map {rel}", check="EXP-03") from exc
            for e in entries:
                found[(e.source_id, e.key)].add(None if prec is None else int(prec))
    return {k: next(iter(v)) if len(v) == 1 else None for k, v in found.items()}


def targets_by_indicator(config: ConfigTree) -> dict[str, dict[str, Any]]:
    """``indicator_id -> {value, source_note}`` from ``config/targets/*.yaml``."""
    out: dict[str, dict[str, Any]] = {}
    for name in config.listdir(TARGETS_DIR):
        if not name.endswith((".yaml", ".yml")):
            continue
        doc = config.yaml(f"{TARGETS_DIR}/{name}")
        t = doc.get("target") or {}
        out[str(doc["indicator"])] = {
            "value": None if t.get("value") is None else float(t["value"]),
            "source_note": t.get("source_note"),
        }
    return out


# --------------------------------------------------------------------------------------
# Producers
# --------------------------------------------------------------------------------------


def _iso(d: date | None) -> str | None:
    return None if d is None else d.isoformat()


def _on(valid_from: date, valid_to: date | None, day: date) -> bool:
    return valid_from <= day and (valid_to is None or day < valid_to)


def build_entities_groups(
    entities: Sequence[tuple[Any, ...]], members: Sequence[tuple[Any, ...]], as_of: date
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_entity: dict[str, set[str]] = defaultdict(set)
    by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for gid, eid, vf, vt in members:
        by_group[gid].append({"entity_id": eid, "valid_from": _iso(vf), "valid_to": _iso(vt)})
        if _on(vf, vt, as_of):
            by_entity[eid].add(gid)
    ents = [
        {
            "entity_id": eid,
            "name": name,
            # ref.entity has no iso3 column; entity ids of countries are their ISO alpha-3 codes.
            "iso3": eid if kind == "country" else None,
            "kind": kind,
            "is_ranked": bool(ranked),
            "is_global": bool(is_global),
            "group_ids": sorted(by_entity.get(eid, ())),
        }
        for eid, name, kind, ranked, is_global in entities
    ]
    # Group names are not stored anywhere (neither the database nor entities.yaml): the id is used.
    groups = [
        {"group_id": gid, "name": gid, "members": sorted_by_id(by_group[gid], "entity_id")}
        for gid in sorted(by_group)
    ]
    return sorted(ents, key=lambda e: e["entity_id"]), groups


def check_series_complete(rows: Sequence[Mapping[str, Any]]) -> None:
    """EXP-03: source, series key, frequency, unit and seasonal adjustment on every series."""
    need = ("source_id", "series_key", "frequency", "unit_code", "seasonal_adjustment")
    bad = [f"{r['series_id']}:{k}" for r in rows for k in need if r.get(k) in (None, "")]
    if bad:
        raise ExportError(f"EXP-03: incomplete series metadata: {', '.join(bad[:10])}", "EXP-03")


def meta_producer(config: ConfigTree) -> Producer:
    """Producer of ``meta/{entities,groups,domains,indicators,series}.json``."""

    def produce(session: ExportSession, run: RunInfo, sink: ExportSink) -> None:
        config.verify(run)
        entities = session.fetch(
            "SELECT entity_id, name, kind, is_ranked, is_global FROM ref.entity ORDER BY entity_id"
        )
        members = session.fetch(
            "SELECT group_id, entity_id, valid_from, valid_to FROM ref.entity_group_member "
            "ORDER BY group_id, entity_id, valid_from"
        )
        ent_rows, group_rows = build_entities_groups(entities, members, run.as_of_run_date)
        sink.add_json(
            "meta/entities.json",
            {"schema_version": META_SCHEMA_VERSION, "entities": ent_rows},
            schema="meta-entities",
            rows=len(ent_rows),
        )
        sink.add_json(
            "meta/groups.json",
            {"schema_version": META_SCHEMA_VERSION, "groups": group_rows},
            schema="meta-groups",
            rows=len(group_rows),
        )

        inds = session.fetch(
            "SELECT indicator_id, name, scope, priority, currency_basis, staleness_class, "
            "transform_id, alert_method, adverse_dir, good_dir, display_dir, rank_mode, "
            "max_ref_spread_days FROM ref.indicator "
            "WHERE kind = 'indicator' AND NOT is_comparison ORDER BY indicator_id"
        )
        ids = {r[0] for r in inds}
        dom_of: dict[str, list[str]] = defaultdict(list)
        ind_of: dict[str, list[str]] = defaultdict(list)
        for did, iid in session.fetch(
            "SELECT domain_id, indicator_id FROM ref.indicator_domain "
            "ORDER BY domain_id, indicator_id"
        ):
            if iid in ids:
                dom_of[iid].append(did)
                ind_of[did].append(iid)
        series = session.fetch(
            "SELECT series_id, indicator_id, entity_id, source_id, source_name, series_key, "
            "frequency, unit_code, unit_mult, base_period, seasonal_adjustment, price_basis, "
            "flow_basis, calendar_basis, inherited, licence_attribution, publish, reestimating "
            "FROM ref.v_series_export ORDER BY series_id"
        )
        series = [r for r in series if r[1] in ids]
        freq: dict[str, set[str]] = defaultdict(set)
        units: dict[str, set[str]] = defaultdict(set)
        for r in series:
            freq[r[1]].add(r[6])
            units[r[1]].add(r[7])
        targets = targets_by_indicator(config)

        ind_rows = []
        for iid, name, scope, prio, cur, sclass, tf, alert, adv, good, disp, mode, spread in inds:
            ind_rows.append(
                {
                    "indicator_id": iid,
                    "name": name,
                    "domain_ids": dom_of.get(iid, []),
                    "scope": scope,
                    "frequency_set": sorted(freq.get(iid, ())),
                    # ref.unit.description is not readable by mm_reader: the unit codes are shown.
                    "unit_label": ", ".join(sorted(units.get(iid, ()))) or None,
                    "adverse_dir": adv,
                    "rank_mode": mode,
                    "good_dir": good,
                    "display_dir": disp,
                    "target": targets.get(iid) if mode == "target_distance" else None,
                    "max_ref_spread_days": spread,
                    "staleness_limit_days": CLASS_LIMITS.get(sclass),
                    "transform_options": list(TRANSFORM_OPTIONS),
                    "default_transform": tf,
                    "alert_method": alert,
                    "priority": prio,
                    "currency_basis": cur,
                    "notes": list(INDICATOR_NOTES.get(iid, ())),
                }
            )
        sink.add_json(
            "meta/indicators.json",
            {"schema_version": META_SCHEMA_VERSION, "indicators": ind_rows},
            schema="meta-indicators",
            rows=len(ind_rows),
        )

        doms = session.fetch(
            "SELECT domain_id, name, is_ranked, min_coverage_for_rank, notice FROM ref.domain "
            "ORDER BY domain_id"
        )
        dom_rows = [
            {
                "domain_id": did,
                "name": name,
                "ranked": bool(ranked),
                "min_coverage_for_rank": float(cov),
                "indicator_ids": ind_of.get(did, []),
                "notices": [notice] if notice else [],
                "percentile_rank_label": PERCENTILE_RANK_LABEL,
            }
            for did, name, ranked, cov, notice in doms
        ]
        sink.add_json(
            "meta/domains.json",
            {"schema_version": META_SCHEMA_VERSION, "domains": dom_rows},
            schema="meta-domains",
            rows=len(dom_rows),
        )

        urls = source_urls(config)
        precision = group_precisions(config)
        ser_rows = [
            {
                "series_id": sid,
                "indicator_id": iid,
                "entity_id": eid,
                "source_id": src,
                "source_name": sname,
                "series_key": skey,
                "frequency": fq,
                "unit_code": unit,
                "unit_mult": mult,
                "base_period": base,
                "seasonal_adjustment": sa,
                "price_basis": price,
                "flow_basis": flow,
                "calendar_basis": cal,
                "inherited": bool(inh),
                "licence_attribution": attr,
                "source_url": urls.get(src),
                "publish": pub,
                "reestimating": bool(reest),
                "published_precision": precision.get((src, skey)),
            }
            for (sid, iid, eid, src, sname, skey, fq, unit, mult, base, sa, price, flow, cal,
                 inh, attr, pub, reest) in series
        ]  # fmt: skip
        check_series_complete(ser_rows)
        sink.add_json(
            "meta/series.json",
            {"schema_version": META_SCHEMA_VERSION, "series": ser_rows},
            schema="meta-series",
            rows=len(ser_rows),
        )

    return produce
