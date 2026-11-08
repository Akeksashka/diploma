"""First-sight creation of ``ref.series`` and its ``ref.series_map`` rows (ADR-018, loader step 6).

Also the drift side of step 6 for series that already exist: a published attribute that differs
from the stored one raises ``ops.drift_event`` rows and defers the series
(``ingest.raw_series_status``). Nothing here writes ``raw_load``, ``request_state`` or staging, and
no SAVEPOINT is used: everything happens in the loader's locked top-level transaction.

``series_ref`` in staging is ``'<dataset>|<series_key>'`` (``fetch._ref``); a ref without ``|``
(a connector without datasets) has no dataset part and is looked up by series key alone.
"""

from __future__ import annotations

import subprocess
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from macro_monitor.registry.config import load_yaml_text
from macro_monitor.registry.sync import MapEntry, parse_series_map

#: ``(source_id, group_id, git_sha) -> series-map entries of the group at that config version``.
MapProvider = Callable[[str, str, str], Sequence[MapEntry]]

META_COLUMNS = (
    "entity_code", "frequency", "unit_code", "unit_mult", "base_period", "price_basis",
    "currency_code", "seasonal_adjustment", "calendar_basis", "flow_basis", "title",
    "published_decimals",
)  # fmt: skip
_ENUMS: Mapping[str, frozenset[str]] = {
    "frequency": frozenset({"D", "M", "Q", "A"}),
    "price_basis": frozenset({"NOM", "REAL", "IDX", "RATIO", "NA"}),
    "seasonal_adjustment": frozenset({"SA", "NSA", "SCA", "CA", "NA"}),
    "calendar_basis": frozenset({"CAL", "FISCAL", "MKTYR"}),
    "flow_basis": frozenset({"PERIOD_FLOW", "ANNUALISED_RATE", "STOCK", "NA"}),
    "composition": frozenset({"FIXED", "CHANGING", "NA"}),
}
_DRIFT_KIND = {
    "unit_code": "unit",
    "unit_mult": "unit",
    "base_period": "base_period",
    "seasonal_adjustment": "seasonal_adjustment",
    "frequency": "frequency",
    "flow_basis": "flow_basis",
    "price_basis": "classification",
    "currency_code": "classification",
    "calendar_basis": "classification",
}
_EXPECT_ALIAS = {"unit": "unit_code"}
_NULLABLE_META = frozenset({"base_period", "currency_code"})  # None is a published value


def is_blank(value: str | None) -> bool:
    """ADR-029: "empty" means ``None``, ``''`` or whitespace only."""
    return value is None or not value.strip()


def effective_unit(staged_unit: str | None, expect_unit: str | None, group_opt_in: bool) -> str:
    """The unit the loader works with (ADR-029 decision 1); pure.

    A non-empty staged unit always wins and is returned untouched (no trim, case-fold or mapping).
    An empty one is replaced by ``expect.unit`` only for a group with ``unit_from_expect`` and a
    non-empty ``expect.unit``; otherwise the result is ``''`` (empty: the caller rejects it).
    """
    if not is_blank(staged_unit):
        assert staged_unit is not None
        return staged_unit
    if group_opt_in and not is_blank(expect_unit):
        assert expect_unit is not None
        return expect_unit
    return ""


def with_effective_unit(entry: MapEntry, meta: StagedMeta) -> StagedMeta:
    """``meta`` with the effective unit where the config value is used; otherwise unchanged.

    Idempotent. Only a substitution changes anything, so an unpublished (``None``) or blank unit
    that is not substituted keeps today's handling (``diff_meta`` skips ``None``, ``''`` differs).
    """
    staged = meta.values.get("unit_code")
    want = effective_unit(staged, entry.expect.get("unit"), entry.unit_from_expect)
    if want and want != staged:
        return StagedMeta(meta.series_ref, {**meta.values, "unit_code": want})
    return meta


def unit_from_expect_used(entry: MapEntry, meta: StagedMeta) -> bool:
    """True when the config ``expect.unit`` replaces an empty staged unit (provenance count)."""
    return with_effective_unit(entry, meta) is not meta


@dataclass(frozen=True)
class Problem:
    kind: str  # an ops.drift_event.kind
    attribute: str
    old: Any
    new: Any


@dataclass(frozen=True)
class StagedMeta:
    series_ref: str
    values: Mapping[str, Any]  # META_COLUMNS -> value


@dataclass(frozen=True)
class StoredSeries:
    series_id: int
    group_id: str
    version: int
    published_decimals: int | None
    values: Mapping[str, Any]  # measurement attributes


def split_ref(ref: str) -> tuple[str | None, str]:
    """``'dataset|key'`` -> ``(dataset, key)``; a ref without ``|`` has no dataset."""
    if "|" not in ref:
        return None, ref
    dataset, key = ref.split("|", 1)
    return dataset, key


# ------------------------------------------------------------------------------ config at a sha


def git_map_provider(root: Path) -> MapProvider:
    """Series-map entries read from the config tree of ``git_sha`` (``git show``).

    When the sha is unknown to git (shallow checkout, local run with ``unknown``) the working tree
    is read instead; CI must check out enough history (plan T51).
    """

    def read(sha: str, rel: str) -> str:
        if sha and sha != "unknown":
            proc = subprocess.run(
                ["git", "-C", str(root), "show", f"{sha}:{rel}"],
                capture_output=True, text=True, check=False,
            )  # fmt: skip
            if proc.returncode == 0:
                return proc.stdout
        return (root / rel).read_text(encoding="utf-8")

    def provider(source_id: str, group_id: str, git_sha: str) -> Sequence[MapEntry]:
        sources = load_yaml_text(read(git_sha, "config/sources.yaml"))
        for s in sources["sources"]:
            if s["id"] != source_id:
                continue
            for g in s["groups"]:
                if g["id"] == group_id and g.get("series_map"):
                    rel = str(g["series_map"])
                    return parse_series_map(
                        source_id, group_id, load_yaml_text(read(git_sha, rel)), rel,
                        unit_from_expect=bool(g.get("unit_from_expect", False)),
                    )  # fmt: skip
        return ()

    return provider


# ------------------------------------------------------------------------------- drift handling


def record_drift(
    conn: psycopg.Connection,
    *,
    run_id: int,
    source_id: str,
    raw_id: int,
    problem: Problem,
    series_ref: str,
    fresh: bool = False,
) -> int:
    """Insert (or reuse an identical open) drift event; returns ``event_id``.

    ``fresh`` forces a new row (``precision_change`` must be created in the transaction that
    raises ``published_decimals``; ``series_ref`` is then the bare series key, as matched by
    ``ref.fn_series_published_decimals``).
    """
    old = Jsonb({"attribute": problem.attribute, "value": problem.old})
    new = Jsonb({"attribute": problem.attribute, "value": problem.new})
    if not fresh:
        row = conn.execute(
            "SELECT event_id FROM ops.drift_event WHERE source_id = %s AND series_ref = %s "
            "AND kind = %s AND status = 'open' AND new = %s ORDER BY event_id DESC LIMIT 1",
            [source_id, series_ref, problem.kind, new],
        ).fetchone()
        if row is not None:
            return int(row[0])
    row = conn.execute(
        "INSERT INTO ops.drift_event (run_id, source_id, raw_id, kind, series_ref, old, new) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING event_id",
        [run_id, source_id, raw_id, problem.kind, series_ref, old, new],
    ).fetchone()
    assert row is not None
    return int(row[0])


def defer(
    conn: psycopg.Connection,
    *,
    run_id: int,
    raw_id: int,
    series_ref: str,
    event_id: int,
    recorded_at: datetime,
) -> None:
    conn.execute(
        "INSERT INTO ingest.raw_series_status (raw_id, series_ref, status, event_id, run_id, "
        "recorded_at) VALUES (%s,%s,'deferred',%s,%s,%s) ON CONFLICT DO NOTHING",
        [raw_id, series_ref, event_id, run_id, recorded_at],
    )


# -------------------------------------------------------------------------------- staged / stored


def read_staged_metas(conn: psycopg.Connection, raw_id: int) -> dict[str, StagedMeta]:
    cols = ", ".join(META_COLUMNS)
    rows = conn.execute(
        f"SELECT series_ref, {cols} FROM staging.series_meta_load WHERE raw_id = %s", [raw_id]
    ).fetchall()
    return {r[0]: StagedMeta(r[0], dict(zip(META_COLUMNS, r[1:], strict=True))) for r in rows}


def find_series(
    conn: psycopg.Connection, source_id: str, dataset: str | None, key: str
) -> StoredSeries | None:
    """Latest version of ``(source_id, dataset_id, series_key)``."""
    params: list[Any] = [source_id, key]
    where = "source_id = %s AND series_key = %s"
    if dataset is not None:
        where += " AND dataset_id = %s"
        params.append(dataset)
    attrs = [c for c in META_COLUMNS if c not in ("entity_code", "title", "published_decimals")]
    row = conn.execute(
        f"SELECT series_id, group_id, version, published_decimals, {', '.join(attrs)} "
        f"FROM ref.series WHERE {where} ORDER BY version DESC LIMIT 1",
        params,
    ).fetchone()
    if row is None:
        return None
    return StoredSeries(
        int(row[0]), row[1], int(row[2]), row[3], dict(zip(attrs, row[4:], strict=True))
    )


def diff_meta(stored: StoredSeries, meta: StagedMeta) -> list[Problem]:
    """Published attributes that differ from the stored measurement attributes (step 6)."""
    out: list[Problem] = []
    for col, old in stored.values.items():
        new = meta.values.get(col)
        if new is None and col not in _NULLABLE_META:
            continue  # not published in this object
        if new != old:
            out.append(Problem(_DRIFT_KIND[col], col, old, new))
    return out


def expect_problems(entry: MapEntry, meta: StagedMeta) -> list[Problem]:
    """META-02 against the entry's ``expect`` block (``unit`` means ``unit_code``)."""
    out: list[Problem] = []
    meta = with_effective_unit(entry, meta)
    for name, want in entry.expect.items():
        col = _EXPECT_ALIAS.get(name, name)
        if col == "composition" or col not in _DRIFT_KIND:
            continue
        got = meta.values.get(col)
        if got != want:
            out.append(Problem(_DRIFT_KIND[col], col, want, got))
    return out


def headline_conflicts(
    conn: psycopg.Connection, entries: Sequence[MapEntry], entry: MapEntry
) -> list[Problem]:
    """One-headline rule (T-DDL-4) when ``series_map_one_headline`` is absent (no btree_gist).

    Checks the entry's headline rows against stored rows and against each other.
    """
    if conn.execute(
        "SELECT 1 FROM pg_constraint WHERE conname = 'series_map_one_headline'"
    ).fetchone():
        return []  # the database enforces it
    mine = [
        e
        for e in entries
        if (e.dataset, e.key) == (entry.dataset, entry.key) and e.role == "headline"
    ]
    out: list[Problem] = []
    for e in mine:
        lo = date.fromisoformat(e.valid_from)
        hi = date.fromisoformat(e.valid_to) if e.valid_to else None
        hit = conn.execute(
            "SELECT 1 FROM ref.series_map WHERE role = 'headline' AND indicator_id = %s "
            "AND entity_id = %s AND daterange(valid_from, valid_to) && daterange(%s, %s)",
            [e.indicator, e.entity, lo, hi],
        ).fetchone()
        if hit:
            out.append(Problem("classification", "headline", "one per window", e.indicator))
    return out


def first_sight_problems(
    conn: psycopg.Connection,
    entry: MapEntry,
    meta: StagedMeta | None,
    entries: Sequence[MapEntry] = (),
) -> list[Problem]:
    """Every precondition of ADR-018 decision 2; an empty list means the series may be created."""
    if meta is None:
        return [Problem("schema_drift", "series_meta_load", "row", None)]
    meta = with_effective_unit(entry, meta)
    out = expect_problems(entry, meta) + headline_conflicts(conn, entries, entry)
    v = meta.values
    if is_blank(v.get("unit_code")) and is_blank(entry.expect.get("unit")):
        # ADR-029: no row with a blank unit is ever written (ref.series.unit_code is NOT NULL FK)
        out.append(Problem("unit", "unit_code", "non-empty unit", ""))
    for col, allowed in _ENUMS.items():
        got = v.get(col) if col != "composition" else entry.expect.get("composition", "NA")
        if got is not None and got not in allowed:
            out.append(Problem("schema_drift", col, sorted(allowed), got))
    for col in ("frequency", "unit_code", "price_basis", "seasonal_adjustment", "title"):
        if v.get(col) is None and not (col == "unit_code" and is_blank(entry.expect.get("unit"))):
            out.append(Problem("schema_drift", col, "non-null", None))
    unit = v.get("unit_code")
    if (
        not is_blank(unit)
        and conn.execute("SELECT 1 FROM ref.unit WHERE unit_code = %s", [unit]).fetchone() is None
    ):
        out.append(Problem("unit", "unit_code", "in ref.unit", unit))
    if (
        conn.execute("SELECT 1 FROM ref.entity WHERE entity_id = %s", [entry.entity]).fetchone()
        is None
    ):
        out.append(Problem("classification", "entity_id", "in ref.entity", entry.entity))
    if (
        conn.execute(
            "SELECT 1 FROM ref.series_group WHERE source_id = %s AND group_id = %s",
            [entry.source_id, entry.group_id],
        ).fetchone()
        is None
    ):
        out.append(Problem("schema_drift", "group_id", "in ref.series_group", entry.group_id))
    return out


def create_series(
    conn: psycopg.Connection,
    *,
    entry: MapEntry,
    meta: StagedMeta,
    entries: Sequence[MapEntry],
    fetched_at: datetime,
    published_decimals: int | None,
    version: int = 1,
    supersedes_series_id: int | None = None,
) -> int:
    """Insert a series version plus the map rows declared for the key; returns ``series_id``.

    First sight: ``version=1``, no predecessor. After an accepted drift decision (ADR-018
    decision 4, T49) the same function creates ``version = n + 1`` with ``supersedes_series_id``.
    """
    meta = with_effective_unit(entry, meta)
    v = meta.values
    if is_blank(v["unit_code"]):
        raise ValueError(f"refusing to create series {entry.key!r} with a blank unit (ADR-029)")
    row = conn.execute(
        "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, version, entity_id, "
        "title, frequency, unit_code, unit_mult, base_period, price_basis, currency_code, "
        "seasonal_adjustment, calendar_basis, flow_basis, composition, published_decimals, "
        "first_seen_at, supersedes_series_id) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        "RETURNING series_id",
        [
            entry.source_id, entry.group_id, entry.dataset, entry.key, version, entry.entity,
            v["title"],
            v["frequency"], v["unit_code"], v["unit_mult"] or 0, v["base_period"],
            v["price_basis"], v["currency_code"], v["seasonal_adjustment"],
            v["calendar_basis"] or "CAL", v["flow_basis"] or "NA",
            entry.expect.get("composition", "NA"), published_decimals, fetched_at,
            supersedes_series_id,
        ],
    ).fetchone()  # fmt: skip
    assert row is not None
    series_id = int(row[0])
    for e in entries:
        if (e.dataset, e.key) != (entry.dataset, entry.key):
            continue
        conn.execute(
            "INSERT INTO ref.series_map (indicator_id, entity_id, series_id, role, valid_from, "
            "valid_to, splice_note, rationale) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT DO NOTHING",
            [
                e.indicator, e.entity, series_id, e.role, date.fromisoformat(e.valid_from),
                date.fromisoformat(e.valid_to) if e.valid_to else None, e.splice_note, e.rationale,
            ],
        )  # fmt: skip
    return series_id
