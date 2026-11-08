# ruff: noqa: E501
"""sync-config: idempotent load of ``config/`` into ``ref.*`` (plan T18).

Sources of truth: DDL spec section 2 and 8, source-config spec rules 8, 9, 12, 14, 17 and
section 4, ADR-009, ADR-012, ADR-014, ADR-018.

- One ``ingest.run`` row (workflow ``sync-config``) is committed first; the changes run in one
  transaction that sets the session settings ``mm.run_id`` and ``mm.git_sha`` (transaction-local)
  read by the ``ref.config_history`` feeder. Every write is ``INSERT ... ON CONFLICT DO UPDATE ...
  WHERE <columns> IS DISTINCT FROM <new>``, so an unchanged row writes nothing and a second run
  adds no ``config_history`` rows.
- No DELETE: rows that leave the config are closed (``valid_to`` / ``enabled = false``).
- sync-config NEVER creates ``ref.series`` rows (ADR-018). A map entry whose series does not
  exist yet is *pending*: no ``ref.series_map`` row, reported in :class:`SyncReport`.
- The DB checks (rule 8 against the stored ``seasonal_adjustment``, WLD seed) fail the run before
  anything is committed.
"""

from __future__ import annotations

import hashlib
import itertools
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from macro_monitor.analytics.transforms import TRANSFORMS, requires_sa
from macro_monitor.registry.config import (
    ConfigError,
    ConfigIssue,
    SourcesConfig,
    load_sources,
    load_yaml,
)
from macro_monitor.registry.entities import load_entities
from macro_monitor.registry.indicators import IndicatorsConfig, ResolvedIndicator, load_indicators

DEFAULT_VALID_FROM = "1991-01-01"
SA_OK = frozenset({"SA", "SCA"})
ROLES = frozenset({"headline", "fallback", "comparison"})
_ENTRY_KEYS = frozenset(
    {
        "dataset",
        "key",
        "entity",
        "indicator",
        "role",
        "valid_from",
        "valid_to",
        "rationale",
        "expect",
        "splice_note",
    }
)
_ENTRY_REQUIRED = ("dataset", "key", "entity", "indicator", "role", "rationale")
#: Default ``revision:`` values of a group (rules 30-32).
_REEST_MATERIALITY_REL = Decimal("0.001")
_LOCK_NAME = "mm-sync-config"


class SyncError(ConfigError):
    """Configuration or database state rejected by sync-config; nothing was committed."""


# --------------------------------------------------------------------------------------
# Loaded configuration
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class MapEntry:
    """One entry of a ``series_map`` file with its group."""

    source_id: str
    group_id: str
    dataset: str
    key: str
    entity: str
    indicator: str
    role: str
    valid_from: str
    valid_to: str | None
    rationale: str
    splice_note: str | None
    expect: Mapping[str, Any]
    #: the group's ``unit_from_expect`` flag (ADR-029); carried so the loader needs no second lookup
    unit_from_expect: bool = False

    def label(self) -> str:
        return f"{self.group_id}:{self.dataset}/{self.key} ({self.indicator}, {self.entity})"


@dataclass(frozen=True)
class LoadedConfig:
    root: Path
    sources: SourcesConfig
    indicators: IndicatorsConfig
    indicators_raw: Mapping[str, Mapping[str, Any]]
    entities: Mapping[str, Any]
    map_entries: tuple[MapEntry, ...]
    config_sha256: str


@dataclass
class SyncReport:
    run_id: int | None = None
    git_sha: str = "unknown"
    config_sha256: str = ""
    mapped: list[MapEntry] = field(default_factory=list)
    pending: list[MapEntry] = field(default_factory=list)
    closed_map_rows: int = 0
    closed_other: int = 0
    orphans: list[str] = field(default_factory=list)
    skipped_review: tuple[str, ...] = ()


def _canon(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _sha(obj: Any) -> str:
    return hashlib.sha256(_canon(obj).encode("utf-8")).hexdigest()


def config_tree_sha256(config_dir: Path) -> str:
    """sha256 over the relative paths and bytes of every file under ``config_dir``."""
    h = hashlib.sha256()
    for p in sorted(q for q in config_dir.rglob("*") if q.is_file()):
        h.update(p.relative_to(config_dir).as_posix().encode())
        h.update(b"\0")
        h.update(hashlib.sha256(p.read_bytes()).digest())
    return h.hexdigest()


# --------------------------------------------------------------------------------------
# Validation of series maps (no database)
# --------------------------------------------------------------------------------------


def parse_series_map(
    source_id: str,
    group_id: str,
    data: object,
    label: str,
    *,
    unit_from_expect: bool = False,
) -> list[MapEntry]:
    """Parse one series-map file; raises :class:`SyncError` on shape errors."""
    issues: list[ConfigIssue] = []
    out: list[MapEntry] = []
    if not isinstance(data, Mapping) or not isinstance(data.get("series"), list):
        raise SyncError([ConfigIssue("schema", label, "expected a mapping with a 'series' list")])
    for i, e in enumerate(data["series"]):
        p = f"{label}.series[{i}]"
        if not isinstance(e, Mapping):
            issues.append(ConfigIssue("schema", p, "entry must be a mapping"))
            continue
        for k in sorted(set(e) - _ENTRY_KEYS):
            issues.append(ConfigIssue("schema", p, f"unknown key {k!r}"))
        for k in _ENTRY_REQUIRED:
            if not e.get(k):
                issues.append(ConfigIssue("schema", p, f"missing required key {k!r}"))
        if e.get("role") not in ROLES:
            issues.append(ConfigIssue("schema", p, f"role must be one of {sorted(ROLES)}"))
        if issues and issues[-1].path == p:
            continue
        out.append(
            MapEntry(
                source_id=source_id,
                group_id=group_id,
                dataset=str(e["dataset"]),
                key=str(e["key"]),
                entity=str(e["entity"]),
                indicator=str(e["indicator"]),
                role=str(e["role"]),
                valid_from=str(e.get("valid_from") or DEFAULT_VALID_FROM),
                valid_to=str(e["valid_to"]) if e.get("valid_to") else None,
                rationale=str(e["rationale"]),
                splice_note=str(e["splice_note"]) if e.get("splice_note") else None,
                expect=dict(e.get("expect") or {}),
                unit_from_expect=unit_from_expect,
            )
        )
    if issues:
        raise SyncError(issues)
    return out


def unit_from_expect_issues(entries: Sequence[MapEntry]) -> list[ConfigIssue]:
    """ADR-029: a group with ``unit_from_expect: true`` needs ``expect.unit`` on every entry."""
    return [
        ConfigIssue(
            "ADR-029",
            e.label(),
            f"group {e.group_id} has unit_from_expect: true; entry needs a non-empty expect.unit",
        )
        for e in entries
        if e.unit_from_expect and not str(e.expect.get("unit") or "").strip()
    ]


def map_issues(
    entries: Sequence[MapEntry],
    indicators: IndicatorsConfig,
    entity_ids: frozenset[str],
) -> list[ConfigIssue]:
    """Rules 8, 12 (global scope only to WLD), AC-CFG-2 and the one-headline rule (T-DDL-4)."""
    out: list[ConfigIssue] = []
    by_id = {i.id: i for i in indicators.indicators}
    seen: set[tuple[str, str, str, str, str]] = set()
    headlines: dict[tuple[str, str], list[MapEntry]] = {}
    for e in entries:
        ind = by_id.get(e.indicator)
        if ind is None:
            out.append(ConfigIssue("AC-CFG-2", e.label(), f"unknown indicator {e.indicator!r}"))
            continue
        if ind.values["priority"] == "dropped":
            out.append(ConfigIssue("AC-CFG-2", e.label(), f"indicator {e.indicator} is dropped"))
        if e.entity not in entity_ids:
            out.append(ConfigIssue("14", e.label(), f"unknown entity {e.entity!r}"))
        if ind.values["scope"] == "global" and e.entity != "WLD":
            out.append(ConfigIssue("12", e.label(), "a scope: global indicator maps only to WLD"))
        if e.role == "comparison" and not ind.values["is_comparison"]:
            out.append(
                ConfigIssue("12", e.label(), "role comparison needs an is_comparison indicator")
            )
        transform = str(ind.values["transform"])
        if (
            transform in TRANSFORMS
            and requires_sa(transform)
            and e.role in ("headline", "fallback")
        ):
            sa = e.expect.get("seasonal_adjustment")
            if sa not in SA_OK:
                out.append(
                    ConfigIssue(
                        "8",
                        e.label(),
                        f"indicator {e.indicator} (transform {transform}) requires "
                        f"seasonal_adjustment SA or SCA; entry declares {sa!r} "
                        f"(entity {e.entity}, series {e.key})",
                    )
                )
        ident = (e.indicator, e.entity, e.dataset + "/" + e.key, e.role, e.valid_from)
        if ident in seen:
            out.append(ConfigIssue("schema", e.label(), "duplicate map entry"))
        seen.add(ident)
        if e.role == "headline":
            headlines.setdefault((e.indicator, e.entity), []).append(e)
    for (ind_id, ent), group in headlines.items():
        spans = sorted(
            (
                date.fromisoformat(g.valid_from),
                date.fromisoformat(g.valid_to) if g.valid_to else None,
            )
            for g in group
        )
        for (_, a_to), (b_from, _) in itertools.pairwise(spans):
            if a_to is None or a_to > b_from:
                out.append(
                    ConfigIssue(
                        "T-DDL-4", f"{ind_id}/{ent}", "overlapping headline validity windows"
                    )
                )
    return out


def _indicator_issues(cfg: IndicatorsConfig) -> list[ConfigIssue]:
    out: list[ConfigIssue] = []
    for i in cfg.indicators:
        t = str(i.values["transform"])
        if t not in TRANSFORMS:
            out.append(ConfigIssue("12", i.id, f"unknown transform {t!r}"))
        elif TRANSFORMS[t].support_inputs and not i.values["inputs"]:
            out.append(
                ConfigIssue("12", i.id, f"transform {t} declares support inputs; inputs: is empty")
            )
    return out


def load_config(root: Path, *, today: date | None = None) -> LoadedConfig:
    """Load and validate everything under ``root/config``; raises :class:`ConfigError`."""
    cfg = root / "config"
    env_example = root / ".env.example"
    entities = load_entities(cfg / "entities.yaml")
    groups = {g["id"] for g in entities["groups"]}
    sources = load_sources(
        cfg / "sources.yaml",
        env_example=env_example if env_example.is_file() else None,
        project_root=root,
        today=today,
    )
    indicators = load_indicators(
        cfg / "indicators.yaml", cfg / "indicator_defaults.yaml", entity_groups=groups
    )
    raw = load_yaml(cfg / "indicators.yaml")
    raw_by_id = {e["id"]: e for e in raw["indicators"]}
    entries: list[MapEntry] = []
    for s in sources.data["sources"]:
        for g in s["groups"]:
            entries.extend(
                parse_series_map(
                    s["id"], g["id"], load_yaml(root / g["series_map"]), str(g["series_map"]),
                    unit_from_expect=bool(g.get("unit_from_expect", False)),
                )
            )  # fmt: skip
    issues = _indicator_issues(indicators) + unit_from_expect_issues(entries)
    issues += map_issues(entries, indicators, frozenset(e["id"] for e in entities["entities"]))
    if issues:
        raise SyncError(issues)
    return LoadedConfig(
        root, sources, indicators, raw_by_id, entities, tuple(entries), config_tree_sha256(cfg)
    )


# --------------------------------------------------------------------------------------
# Row builders (pure)
# --------------------------------------------------------------------------------------


def _dec(v: object) -> Decimal:
    return Decimal(str(v))


def source_row(s: Mapping[str, Any], enabled: bool) -> dict[str, Any]:
    return {
        "source_id": s["id"],
        "provider": s["provider"],
        "kind": s["kind"],
        "archive_mode": s["archive"],
        "publish_site": s["publish_site"],
        "licence_id": s["licence"]["id"],
        "attribution": s["licence"]["attribution"],
        "config_sha256": _sha(s),
        "enabled": enabled,
    }


def group_row(source_id: str, g: Mapping[str, Any]) -> dict[str, Any]:
    """``ref.series_group`` row with the rule 30-32 defaults."""
    rev = g.get("revision") or {}
    reest = bool(g.get("reestimating", False))
    return {
        "source_id": source_id,
        "group_id": g["id"],
        "reestimating": reest,
        "compare_mode": rev.get("compare", "published_decimals"),
        "fixed_decimals": rev.get("decimals"),
        "rel_epsilon": _dec(rev.get("rel_epsilon", "1e-9")),
        "materiality_abs": _dec(rev.get("materiality_abs", 0)),
        "materiality_rel": _dec(rev.get("materiality_rel", _REEST_MATERIALITY_REL if reest else 0)),
        "snapshot_mode": rev.get("snapshot_mode", "diff_above_tol" if reest else "none"),
        "max_revised_rows": rev.get("max_revised_rows"),
        "edition_ordered": bool(g.get("edition_ordered", False)),
        "enabled": bool(g.get("enabled", True)),  # the group's own flag (ADR-027 decision 10)
        "config_sha256": _sha(g),
    }


_PARAM_LEAVES = (
    "alert.alert_z",
    "alert.watch_z",
    "alert.window_obs",
    "alert.min_obs",
    "rank_period_coverage_pct",
)


def indicator_row(r: ResolvedIndicator, raw: Mapping[str, Any]) -> dict[str, Any]:
    """``ref.indicator`` row from the resolved values; provenance and review go to ``params``."""
    v = r.values
    params: dict[str, Any] = {leaf.split(".")[-1]: v[leaf] for leaf in _PARAM_LEAVES}
    params["provenance"] = dict(sorted(r.provenance.items()))
    params["review"] = dict(r.review)
    for k in ("notes", "requires_flow_basis", "calendar_basis"):
        if raw.get(k) is not None:
            params[k] = raw[k]
    if v["inputs"]:
        params["inputs_max_denominator_age_days"] = {
            i["id"]: i["max_denominator_age_days"]
            for i in v["inputs"]
            if i.get("max_denominator_age_days") is not None
        }
    return {
        "indicator_id": r.id,
        "name": v["name"],
        "kind": v["kind"],
        "scope": v["scope"],
        "tier": v["tier"],
        "priority": v["priority"],
        "currency_basis": v["currency_basis"],
        "staleness_class": v["staleness_class"],
        "transform_id": v["transform"],
        "sa_required": requires_sa(str(v["transform"])),
        "alert_method": v["alert.method"],
        "adverse_dir": v["alert.adverse"],
        "good_dir": v["rank.good_dir"],
        "display_dir": v["rank.display_dir"],
        "rank_mode": v["rank.mode"],
        "max_ref_spread_days": v["max_ref_spread_days"],
        "stationarity_class": v["stationarity_class"],
        "release_lag_aware": v["release_lag_aware"],
        "alert_override": Jsonb(list(r.alert_override)) if r.alert_override else None,
        "params": Jsonb(params),
        "is_comparison": v["is_comparison"],
        "concept_id": raw.get("concept_id"),
        "concept_priority": raw.get("concept_priority"),
    }


# --------------------------------------------------------------------------------------
# Database writes
# --------------------------------------------------------------------------------------


def _upsert(
    conn: psycopg.Connection, table: str, key: Sequence[str], row: Mapping[str, Any]
) -> None:
    """Insert or update; an unchanged row is not written (no trigger, no history row)."""
    cols = list(row)
    rest = [c for c in cols if c not in key]
    ident = sql.Identifier
    stmt = sql.SQL("INSERT INTO ref.{t} ({cols}) VALUES ({vals}) ON CONFLICT ({key}) ").format(
        t=ident(table),
        cols=sql.SQL(", ").join(map(ident, cols)),
        vals=sql.SQL(", ").join(sql.Placeholder() * len(cols)),
        key=sql.SQL(", ").join(map(ident, key)),
    )
    if rest:
        stmt += sql.SQL("DO UPDATE SET {sets} WHERE ({old}) IS DISTINCT FROM ({new})").format(
            sets=sql.SQL(", ").join(sql.SQL("{c} = EXCLUDED.{c}").format(c=ident(c)) for c in rest),
            old=sql.SQL(", ").join(
                sql.SQL("ref.{t}.{c}").format(t=ident(table), c=ident(c)) for c in rest
            ),
            new=sql.SQL(", ").join(sql.SQL("EXCLUDED.{c}").format(c=ident(c)) for c in rest),
        )
    else:
        stmt += sql.SQL("DO NOTHING")
    conn.execute(stmt, [row[c] for c in cols])


def _one(conn: psycopg.Connection, query: str, params: Sequence[Any] = ()) -> Any:
    row = conn.execute(query, params).fetchone()
    return None if row is None else row[0]


def _sync_entities(
    conn: psycopg.Connection, ent: Mapping[str, Any], today: date, rep: SyncReport
) -> None:
    for e in ent["entities"]:
        _upsert(
            conn,
            "entity",
            ["entity_id"],
            {
                "entity_id": e["id"],
                "name": e["name"],
                "kind": e["kind"],
                "is_ranked": e["is_ranked"],
                "is_global": e["is_global"],
            },
        )
    wanted: set[tuple[str, str, date]] = set()
    for g in ent["groups"]:
        for m in g["members"]:
            vf = date.fromisoformat(m["valid_from"])
            vt = date.fromisoformat(m["valid_to"]) if m["valid_to"] else None
            wanted.add((g["id"], m["entity"], vf))
            _upsert(
                conn,
                "entity_group_member",
                ["group_id", "entity_id", "valid_from"],
                {
                    "group_id": g["id"],
                    "entity_id": m["entity"],
                    "valid_from": vf,
                    "valid_to": vt,
                },
            )
    rows = conn.execute(
        "SELECT group_id, entity_id, valid_from FROM ref.entity_group_member WHERE valid_to IS NULL"
    ).fetchall()
    for gid, eid, vf in rows:
        if (gid, eid, vf) not in wanted:
            conn.execute(
                "UPDATE ref.entity_group_member SET valid_to = greatest(%s::date, valid_from) "
                "WHERE group_id = %s AND entity_id = %s AND valid_from = %s",
                [today, gid, eid, vf],
            )
            rep.closed_other += 1


def _sync_sources(conn: psycopg.Connection, cfg: LoadedConfig, rep: SyncReport) -> None:
    ids: list[str] = []
    for s in cfg.sources.data["sources"]:
        ids.append(s["id"])
        _upsert(
            conn, "source", ["source_id"], source_row(s, cfg.sources.effective_enabled[s["id"]])
        )
        for g in s["groups"]:
            _upsert(conn, "series_group", ["source_id", "group_id"], group_row(s["id"], g))
    closed = conn.execute(
        "UPDATE ref.source SET enabled = false WHERE enabled AND source_id <> ALL(%s)", [ids]
    )
    rep.closed_other += closed.rowcount
    known = {(s["id"], g["id"]) for s in cfg.sources.data["sources"] for g in s["groups"]}
    for sid, gid in conn.execute("SELECT source_id, group_id FROM ref.series_group").fetchall():
        if (sid, gid) not in known:
            rep.orphans.append(f"series_group {sid}/{gid} is not in config (kept; no DELETE)")


def _targets(cfg: LoadedConfig, r: ResolvedIndicator) -> list[dict[str, Any]]:
    t = r.values.get("rank.targets")
    if not t:
        return []
    countries = [
        e["id"] for e in cfg.entities["entities"] if e["kind"] == "country" and e["is_ranked"]
    ]
    if "by_entity" in t:
        spec = load_yaml(cfg.root / t["by_entity"])
        if spec.get("indicator") != r.id:
            raise SyncError(
                [ConfigIssue("22", r.id, f"{t['by_entity']} is not the target file of {r.id}")]
            )
        tg = spec["target"]
    else:
        tg = t
    return [
        {
            "indicator_id": r.id,
            "entity_id": c,
            "target_value": _dec(tg["value"]),
            "band_low": _dec(tg["band_low"]) if tg.get("band_low") is not None else None,
            "band_high": _dec(tg["band_high"]) if tg.get("band_high") is not None else None,
            "source_note": str(tg["source_note"]),
            "valid_from": date.fromisoformat(DEFAULT_VALID_FROM),
        }
        for c in countries
    ]


def _sync_indicators(
    conn: psycopg.Connection, cfg: LoadedConfig, today: date, rep: SyncReport
) -> None:
    for d in cfg.indicators.domains:
        _upsert(
            conn,
            "domain",
            ["domain_id"],
            {
                "domain_id": d["id"],
                "name": d["name"],
                "is_ranked": d["ranked"],
                "min_coverage_for_rank": _dec(d.get("min_coverage_for_rank", 0.5)),
                "notice": d.get("notice"),
            },
        )
    for r in cfg.indicators.indicators:
        _upsert(conn, "indicator", ["indicator_id"], indicator_row(r, cfg.indicators_raw[r.id]))
    wanted_targets: set[tuple[str, str]] = set()
    for r in cfg.indicators.indicators:
        for d in r.values["domains"]:
            _upsert(
                conn,
                "indicator_domain",
                ["indicator_id", "domain_id"],
                {"indicator_id": r.id, "domain_id": d["id"], "is_ranked": d["ranked"]},
            )
        for i in r.values["inputs"]:
            _upsert(
                conn,
                "indicator_input",
                ["indicator_id", "input_id", "usage"],
                {
                    "indicator_id": r.id,
                    "input_id": i["id"],
                    "usage": i["usage"],
                    "currency_match": i["currency_match"],
                    "annualised_policy": i.get("annualised_policy", "fail"),
                },
            )
        for row in _targets(cfg, r):
            wanted_targets.add((row["indicator_id"], row["entity_id"]))
            _upsert(conn, "indicator_target", ["indicator_id", "entity_id", "valid_from"], row)
    for ind, ent, vf in conn.execute(
        "SELECT indicator_id, entity_id, valid_from FROM ref.indicator_target WHERE valid_to IS NULL"
    ).fetchall():
        if (ind, ent) not in wanted_targets:
            conn.execute(
                "UPDATE ref.indicator_target SET valid_to = greatest(%s::date, valid_from) "
                "WHERE indicator_id = %s AND entity_id = %s AND valid_from = %s",
                [today, ind, ent, vf],
            )
            rep.closed_other += 1
    cfg_dom = {(r.id, d["id"]) for r in cfg.indicators.indicators for d in r.values["domains"]}
    for ind, dom in conn.execute(
        "SELECT indicator_id, domain_id FROM ref.indicator_domain"
    ).fetchall():
        if (ind, dom) not in cfg_dom:
            rep.orphans.append(f"indicator_domain {ind}/{dom} is not in config (kept; no DELETE)")


def _sync_series_map(
    conn: psycopg.Connection, cfg: LoadedConfig, today: date, rep: SyncReport
) -> None:
    """Map rows only for series that exist; the rest is pending (ADR-018). Never inserts a series."""
    sa_required = {
        r.id: bool(requires_sa(str(r.values["transform"]))) for r in cfg.indicators.indicators
    }
    wanted: set[tuple[str, str, int, str, date]] = set()
    configured_series: set[int] = set()
    issues: list[ConfigIssue] = []
    for e in cfg.map_entries:
        row = conn.execute(
            "SELECT series_id, seasonal_adjustment FROM ref.series "
            "WHERE source_id = %s AND dataset_id = %s AND series_key = %s "
            "ORDER BY version DESC LIMIT 1",
            [e.source_id, e.dataset, e.key],
        ).fetchone()
        if row is None:
            rep.pending.append(e)
            continue
        sid, sa = row
        if sa_required[e.indicator] and e.role in ("headline", "fallback") and sa not in SA_OK:
            issues.append(
                ConfigIssue(
                    "8",
                    e.label(),
                    f"stored series {sid} has seasonal_adjustment {sa!r}; {e.indicator} needs SA or SCA",
                )
            )
            continue
        vf = date.fromisoformat(e.valid_from)
        wanted.add((e.indicator, e.entity, sid, e.role, vf))
        configured_series.add(sid)
        _upsert(
            conn,
            "series_map",
            ["indicator_id", "entity_id", "series_id", "role", "valid_from"],
            {
                "indicator_id": e.indicator,
                "entity_id": e.entity,
                "series_id": sid,
                "role": e.role,
                "valid_from": vf,
                "valid_to": date.fromisoformat(e.valid_to) if e.valid_to else None,
                "splice_note": e.splice_note,
                "rationale": e.rationale,
            },
        )
        rep.mapped.append(e)
    if issues:
        raise SyncError(issues)
    # Close open rows of configured groups that no longer appear in config.
    groups = sorted({(e.source_id, e.group_id) for e in cfg.map_entries})
    for src, grp in groups:
        for ind, ent, sid, role, vf in conn.execute(
            "SELECT m.indicator_id, m.entity_id, m.series_id, m.role, m.valid_from "
            "FROM ref.series_map m JOIN ref.series s USING (series_id) "
            "WHERE s.source_id = %s AND s.group_id = %s AND m.valid_to IS NULL",
            [src, grp],
        ).fetchall():
            if (ind, ent, sid, role, vf) not in wanted:
                conn.execute(
                    "UPDATE ref.series_map SET valid_to = greatest(%s::date, valid_from) "
                    "WHERE indicator_id = %s AND entity_id = %s AND series_id = %s "
                    "AND role = %s AND valid_from = %s",
                    [today, ind, ent, sid, role, vf],
                )
                rep.closed_map_rows += 1


def _db_checks(conn: psycopg.Connection) -> None:
    """Rule 14 against the database: WLD is the one global aggregate."""
    wld = conn.execute(
        "SELECT entity_id, kind, is_ranked FROM ref.entity WHERE is_global"
    ).fetchall()
    if wld != [("WLD", "aggregate", False)]:
        raise SyncError(
            [ConfigIssue("14", "ref.entity", f"expected only WLD as global, got {wld}")]
        )


def sync_config(
    conn: psycopg.Connection,
    root: Path,
    *,
    git_sha: str = "unknown",
    code_version: str = "dev",
    trigger: str = "local",
    today: date | None = None,
    config: LoadedConfig | None = None,
) -> SyncReport:
    """Load ``root/config`` into ``ref.*``; commits on success, rolls back on any error.

    The run row (``ingest.run``) is committed first so that a failure is still visible as
    ``failed``. ``conn`` must be a non-autocommit connection with no open transaction.
    """
    run_date = today or date.today()
    cfg = config or load_config(root, today=run_date)
    rep = SyncReport(
        git_sha=git_sha, config_sha256=cfg.config_sha256, skipped_review=cfg.sources.skipped_review
    )
    run_id = _one(
        conn,
        "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, status) "
        "VALUES ('sync-config', %s, 'refresh', %s, %s, now(), 'running') RETURNING run_id",
        [trigger, git_sha, code_version],
    )
    conn.commit()
    rep.run_id = int(run_id)
    try:
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [_LOCK_NAME])
        conn.execute("SELECT set_config('mm.run_id', %s, true)", [str(run_id)])
        conn.execute("SELECT set_config('mm.git_sha', %s, true)", [git_sha])
        # Pipeline mode: ~600 small writes would otherwise cost one round trip each.
        with conn.pipeline():
            _sync_entities(conn, cfg.entities, run_date, rep)
            _sync_sources(conn, cfg, rep)
            _sync_indicators(conn, cfg, run_date, rep)
            _sync_series_map(conn, cfg, run_date, rep)
        _db_checks(conn)
        conn.execute(
            "UPDATE ingest.run SET status = 'ok', finished_at = now() WHERE run_id = %s", [run_id]
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        conn.execute(
            "UPDATE ingest.run SET status = 'failed', finished_at = now() WHERE run_id = %s",
            [run_id],
        )
        conn.commit()
        raise
    return rep
