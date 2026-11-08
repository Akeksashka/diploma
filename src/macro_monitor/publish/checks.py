"""Export checks EXP-01..07, 09, 10 and the size budgets (T86; export spec sections 8 and 10).

``standard_checker`` returns the :data:`~macro_monitor.publish.export.Checker` that ``run_export``
calls on the finished (in-memory) files before the manifest is built. Every check compares the
FILES with an independent read of the published views on the same ``mm_reader`` snapshot, so a
producer or view that regresses (for example a revision view that includes ``PROJ``) is caught
here and not only by the producer's own tests. EXP-08 (determinism) is the second pass of
``run_export``. A ``fail`` finding fails the export (nothing is deployed); ``warn`` findings go to
``export-status.json``.
"""

from __future__ import annotations

import io
import re
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import UTC
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from macro_monitor.publish import manifest as mf
from macro_monitor.publish import revisions as rev
from macro_monitor.publish import series as ser
from macro_monitor.publish.export import (
    Checker,
    CheckReport,
    ExportSession,
    Finding,
)
from macro_monitor.publish.manifest import FileEntry, RunInfo, utc_text
from macro_monitor.publish.meta import ConfigTree
from macro_monitor.publish.scorecard import day, num

MB = 1_000_000
FILE_WARN, FILE_FAIL = 5 * MB, 20 * MB
SERIES_WARN, REVISIONS_WARN = 40 * MB, 20 * MB
DATA_WARN, DATA_FAIL = 100 * MB, 250 * MB
SITE_FAIL = 300 * MB

#: Path pattern -> JSON Schema name (EXP-01). A JSON file that matches none fails.
JSON_SCHEMAS = (
    ("meta/entities.json", "meta-entities"),
    ("meta/groups.json", "meta-groups"),
    ("meta/domains.json", "meta-domains"),
    ("meta/indicators.json", "meta-indicators"),
    ("meta/series.json", "meta-series"),
    ("scorecard/*.json", "scorecard"),
    ("alerts.json", "alerts"),
    ("status.json", "status"),
    ("revisions_recent.json", "revisions-recent"),
)
#: Keys that must appear in no file (AC-EXP-6, 7, 12).
FORBIDDEN_KEYS = frozenset(
    {"is_support", "modal_ref_period_end"}
    | {"_".join(w) for w in (("vintage", "resolution"), ("release", "cadence", "note"))}
)  # joined: the AC-EXP-12 static scan greps the source text for these names
#: Secret-like patterns (EXP-07). Only the pattern NAME is ever reported, never the match.
SECRET_PATTERNS: tuple[tuple[str, re.Pattern[bytes]], ...] = (
    (
        "connection URL",
        re.compile(rb"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?)://"),
    ),
    ("URL with credentials", re.compile(rb"\b[a-z][a-z0-9+.-]*://[^\s/:@\"']+:[^\s/@\"']+@")),
    ("bearer token", re.compile(rb"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}")),
    ("GitHub token", re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})")),
    ("AWS access key", re.compile(rb"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("private key", re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    (
        "credential assignment",
        re.compile(
            rb"(?i)[\"']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret|passwd|password)"
            rb"[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9._~+/=-]{12,}"
        ),
    ),
)


def _json_schema_for(path: str) -> str | None:
    return next((name for pat, name in JSON_SCHEMAS if fnmatchcase(path, pat)), None)


def _indicator_of(path: str) -> str:
    return Path(path).stem


def _table(f: FileEntry, columns: Sequence[str] | None = None) -> pa.Table:
    return pq.read_table(io.BytesIO(f.data), columns=list(columns) if columns else None)


def _walk(obj: Any, keys: Iterable[str]) -> Iterable[tuple[str, Any]]:
    """Every (key, value) pair of nested JSON whose key is in ``keys``."""
    want = frozenset(keys)
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in want:
                yield k, v
            yield from _walk(v, want)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v, want)


def _all_keys(obj: Any) -> Iterable[str]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _all_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _all_keys(v)


def scan_secrets(data: bytes) -> list[str]:
    """Names of the secret-like patterns found in ``data`` (the match itself is never returned)."""
    return [name for name, pat in SECRET_PATTERNS if pat.search(data)]


class _Run:
    """Collects findings for one check."""

    def __init__(self, check: str, report: CheckReport) -> None:
        self.check, self.report = check, report
        self.n_fail = self.n_warn = 0

    def fail(self, message: str) -> None:
        self.report.findings.append(Finding(self.check, "fail", message))
        self.n_fail += 1

    def warn(self, message: str) -> None:
        self.report.findings.append(Finding(self.check, "warn", message))
        self.n_warn += 1

    def done(self) -> None:
        self.report.results[self.check] = (
            "fail" if self.n_fail else ("warn" if self.n_warn else "pass")
        )


def _json(files: Sequence[FileEntry]) -> dict[str, Any]:
    import json

    return {f.path: json.loads(f.data) for f in files if f.format == "json"}


# --------------------------------------------------------------------------------------------
# EXP-01 .. EXP-10
# --------------------------------------------------------------------------------------------


def check_exp01(files: Sequence[FileEntry], docs: Mapping[str, Any], out: _Run) -> None:
    import jsonschema

    for f in files:
        if f.format == "json":
            name = _json_schema_for(f.path)
            if name is None:
                out.fail(f"{f.path}: no JSON Schema is registered for this path")
                continue
            try:
                mf.validate_json(docs[f.path], name)
            except jsonschema.ValidationError as exc:
                out.fail(f"{f.path}: violates {name} schema at {list(exc.absolute_path)}")
        elif fnmatchcase(f.path, "series/*.parquet") or fnmatchcase(f.path, "revisions/*.parquet"):
            want = ser.SCHEMA if f.path.startswith("series/") else rev.SCHEMA
            got = pq.ParquetFile(io.BytesIO(f.data)).schema_arrow
            if not got.equals(want, check_metadata=False):
                out.fail(f"{f.path}: Parquet columns or types differ from the specified schema")
        else:
            out.fail(f"{f.path}: unexpected file")


class Reference:
    """Independent reads of the published objects, fetched once per check run."""

    def __init__(self, session: ExportSession, run: RunInfo) -> None:
        self.session, self.run = session, run
        f = session.fetch
        ind = f("SELECT indicator_id, kind, is_comparison, scope FROM ref.indicator")
        self.allowed = {str(r[0]) for r in ind if r[1] == "indicator" and not r[2]}
        self.scope = {str(r[0]): str(r[3]) for r in ind}
        self.inputs = {str(r[0]) for r in ind if r[1] == "input"}
        self.is_global = {
            str(r[0]): bool(r[1]) for r in f("SELECT entity_id, is_global FROM ref.entity")
        }
        sx = f("SELECT series_id, indicator_id, source_id, publish FROM ref.v_series_export")
        self.series_ind: dict[int, set[str]] = defaultdict(set)
        self.source_of: dict[int, str] = {}
        self.public_ids: set[int] = set()
        for sid, iid, src, pub in sx:
            if iid in self.allowed:
                self.series_ind[int(sid)].add(str(iid))
                self.source_of[int(sid)] = str(src)
                if pub == "public":
                    self.public_ids.add(int(sid))


def check_exp02(
    files: Sequence[FileEntry], docs: Mapping[str, Any], ref: Reference, out: _Run
) -> None:
    for f in files:
        if f.format == "parquet":
            tab = _table(f, ["entity_id", "series_id", "value_status", "load_kind"])
            ind = _indicator_of(f.path)
            if ind not in ref.allowed:
                out.fail(f"{f.path}: not a published indicator (input, comparison or unknown)")
            if "PROJ" in set(tab["value_status"].to_pylist()):
                out.fail(f"{f.path}: contains value_status PROJ rows")
            if "import" in set(tab["load_kind"].to_pylist()):
                out.fail(f"{f.path}: contains load_kind import rows")
            stray = sorted(set(tab["series_id"].to_pylist()) - set(ref.series_ind))
            if stray:
                out.fail(f"{f.path}: series_id {stray[:5]} is not a published headline series")
            if ref.scope.get(ind) == "country":
                glob = sorted({e for e in tab["entity_id"].to_pylist() if ref.is_global.get(e)})
                if glob:
                    out.fail(f"{f.path}: global entity {glob} in a per-country file")
            continue
        doc = docs[f.path]
        for key in sorted(FORBIDDEN_KEYS & set(_all_keys(doc))):
            out.fail(f"{f.path}: forbidden key {key!r}")
        for _key, val in _walk(doc, ("indicator_id", "indicator_ids")):
            for iid in val if isinstance(val, list) else [val]:
                if iid is None:
                    continue
                if iid in ref.inputs:
                    out.fail(f"{f.path}: input indicator {iid} (support set) is exported")
                elif iid not in ref.allowed:
                    out.fail(f"{f.path}: indicator {iid} is not a published indicator")
        if f.path != "meta/series.json":
            for _, sid in _walk(doc, ("series_id",)):
                if sid is not None and sid not in ref.series_ind:
                    out.fail(f"{f.path}: series_id {sid} is not a published headline series")
        if fnmatchcase(f.path, "scorecard/*.json") and doc["domain_id"] != "global":
            glob = [e["entity_id"] for e in doc["entities"] if ref.is_global.get(e["entity_id"])]
            if glob:
                out.fail(f"{f.path}: global entity {glob} outside the global domain")


def check_exp03(
    files: Sequence[FileEntry],
    docs: Mapping[str, Any],
    run: RunInfo,
    config: ConfigTree | None,
    out: _Run,
) -> None:
    if config is not None:
        try:
            config.verify(run)
        except Exception as exc:
            out.fail(str(exc).removeprefix("EXP-03: "))
    meta = docs.get("meta/series.json")
    listed: set[int] = set()
    if meta is not None:
        for r in meta["series"]:
            listed.add(r["series_id"])
            missing = [
                k
                for k in (
                    "source_id",
                    "series_key",
                    "frequency",
                    "unit_code",
                    "seasonal_adjustment",
                )
                if r.get(k) in (None, "")
            ]
            if missing:
                out.fail(f"meta/series.json: series {r['series_id']} lacks {missing}")
    for f in files:
        if f.format == "parquet":
            ids = set(_table(f, ["series_id"])["series_id"].to_pylist())
            if meta is not None and ids - listed:
                out.fail(
                    f"{f.path}: series without a meta/series.json entry: {sorted(ids - listed)[:5]}"
                )


def check_exp04(
    files: Sequence[FileEntry], docs: Mapping[str, Any], ref: Reference, run: RunInfo, out: _Run
) -> None:
    f = ref.session.fetch
    # The reference counts repeat the PROJ and comparison exclusions on purpose: a regression of a
    # view that lets PROJ versions through must show up as a count mismatch (AC-EXP-14(e)).
    want_s = {
        str(r[0]): int(r[1])
        for r in f(
            "SELECT h.indicator_id, count(*) FROM curated.v_headline_obs_published h "
            "JOIN ref.indicator i ON i.indicator_id = h.indicator_id AND i.kind = 'indicator' "
            "AND NOT i.is_comparison WHERE h.value_status <> 'PROJ' "
            "AND h.ref_period_start >= %s GROUP BY h.indicator_id",
            [ser.SERIES_START],
        )
    }
    want_r = {
        str(r[0]): int(r[1])
        for r in f(
            "SELECT indicator_id, count(*) FROM (SELECT r.indicator_id, count(*) OVER "
            "(PARTITION BY r.series_id, r.indicator_id, r.entity_id, r.ref_period_start) AS n "
            "FROM curated.v_revision_history r JOIN ref.indicator i "
            "ON i.indicator_id = r.indicator_id AND NOT i.is_comparison "
            "WHERE r.value_status <> 'PROJ' AND r.known_at <= %s) t WHERE n >= 2 "
            "GROUP BY indicator_id",
            [run.known_cutoff],
        )
    }
    got: dict[str, dict[str, int]] = {"series": {}, "revisions": {}}
    rev_tabs: dict[str, pa.Table] = {}
    for fe in files:
        if fe.format != "parquet":
            continue
        kind = fe.path.split("/", 1)[0]
        n = _table(fe, ["series_id"]).num_rows
        got[kind][_indicator_of(fe.path)] = n
        if fe.rows is not None and fe.rows != n:
            out.fail(f"{fe.path}: manifest rows {fe.rows} differ from file rows {n}")
        if kind == "revisions":
            rev_tabs[fe.path] = _table(fe)
            if not any(not b for b in rev_tabs[fe.path]["is_base_version"].to_pylist()):
                out.fail(f"{fe.path}: no revision row (only base versions)")
    for kind, want in (("series", want_s), ("revisions", want_r)):
        for ind in sorted(set(want) | set(got[kind])):
            if want.get(ind, 0) != got[kind].get(ind, 0):
                out.fail(
                    f"{kind}/{ind}.parquet: {got[kind].get(ind, 0)} rows, "
                    f"views have {want.get(ind, 0)}"
                )
    # revisions_recent.json against the revision files
    doc = docs.get("revisions_recent.json")
    if doc is None:
        return
    rows = [r for t in rev_tabs.values() for r in t.to_pylist()]
    non_base = {
        (
            r["series_id"],
            r["ref_period_start"].isoformat(),
            utc_text(r["known_at"], fractional=True),
        )
        for r in rows
        if not r["is_base_version"]
    }
    ordered = {r["series_id"] for r in rows if r["edition_ordered"]}
    for r in doc["revisions"]:
        key = (r["series_id"], r["ref_period_start"], r["known_at"])
        if r["series_id"] in ordered:
            out.fail(f"revisions_recent.json: row of edition-ordered series {r['series_id']}")
        elif key not in non_base:
            out.fail(f"revisions_recent.json: row {key} is not a revision row of a revision file")
    since = run.known_cutoff - rev.WINDOW
    counts: Counter[tuple[str, str]] = Counter()
    for r in rows:
        if r["edition_ordered"] and not r["is_base_version"] and r["known_at"] >= since:
            label = r["vintage_label"] or r["known_at"].astimezone(UTC).date().isoformat()
            counts[(ref.source_of.get(r["series_id"], "?"), label)] += 1
    for e in doc["edition_summaries"]:
        n = counts.get((e["source_id"], e["vintage_label"]), 0)
        if e["n_keys_revised"] != n:
            out.fail(
                f"revisions_recent.json: edition {e['source_id']}/{e['vintage_label']} "
                f"n_keys_revised {e['n_keys_revised']} but revision files hold {n}"
            )


def _d(cols: Sequence[str], rows: Iterable[Sequence[Any]]) -> list[dict[str, Any]]:
    return [dict(zip(cols, r, strict=True)) for r in rows]


def check_exp05(docs: Mapping[str, Any], ref: Reference, run: RunInfo, out: _Run) -> None:
    """Scorecard, alignment and alerts equal the published-scope rows (no number outside them)."""
    f, rid = ref.session.fetch, run.analysis_run_id
    sc = {
        (r["domain_id"], r["entity_id"]): r
        for r in _d(
            ("domain_id", "entity_id", "n_available", "n_defined", "percentile_rank",
             "rank_position", "n_ranked_entities", "low_coverage", "heterogeneous_peer_set",
             "peer_set_size_min", "peer_set_size_max"),
            f("SELECT domain_id, entity_id, n_available, n_defined, percentile_rank, "
              "rank_position, n_ranked_entities, low_coverage, heterogeneous_peer_set, "
              "peer_set_size_min, peer_set_size_max FROM analytics.scorecard_published "
              "WHERE analysis_run_id = %s", [rid]),
        )
    }  # fmt: skip
    snap = {
        (r["indicator_id"], r["entity_id"]): r
        for r in _d(
            ("indicator_id", "entity_id", "series_id", "value", "transformed_value", "deviation",
             "inherited", "publish"),
            f("SELECT indicator_id, entity_id, series_id, value, transformed_value, deviation, "
              "inherited, publish FROM analytics.v_indicator_snapshot_published "
              "WHERE analysis_run_id = %s", [rid]),
        )
    }  # fmt: skip
    ranks = {(r[0], r[1]): (num(r[2]), r[3]) for r in f(
        "SELECT indicator_id, entity_id, percentile, n_ranked FROM "
        "analytics.indicator_rank_published WHERE analysis_run_id = %s", [rid])}  # fmt: skip
    aligns = {r[0]: (day(r[1]), r[2], r[3], r[4], r[5]) for r in f(
        "SELECT indicator_id, rank_reference_period, reference_period_spread_days, n_ranked, "
        "n_unaligned, max_ref_spread_days FROM analytics.indicator_alignment_published "
        "WHERE analysis_run_id = %s", [rid])}  # fmt: skip
    peer: dict[str, set[tuple[Any, ...]]] = defaultdict(set)
    for (dom, _), r in sc.items():
        peer[dom].add((r["heterogeneous_peer_set"], r["peer_set_size_min"], r["peer_set_size_max"]))
    for dom, vals in sorted(peer.items()):
        if len(vals) > 1:
            out.fail(f"domain {dom}: peer-set fields differ between its scorecard rows")

    def same(where: str, name: str, got: Any, want: Any) -> None:
        if got != want:
            out.fail(f"{where}: {name} is {got!r} but the published row has {want!r}")

    for path, doc in sorted(docs.items()):
        if not fnmatchcase(path, "scorecard/*.json"):
            continue
        dom = doc["domain_id"]
        want_peer = {
            (r["heterogeneous_peer_set"], r["peer_set_size_min"], r["peer_set_size_max"])
            for (d, _), r in sc.items()
            if d == dom
        }
        got_peer = (
            doc["heterogeneous_peer_set"],
            doc["peer_set_size_by_indicator"]["min"],
            doc["peer_set_size_by_indicator"]["max"],
        )
        if want_peer and got_peer not in want_peer:
            out.fail(f"{path}: peer-set fields differ from the published rows")
        for a in doc["alignment"]:
            aw = aligns.get(a["indicator_id"], (None,) * 5)
            got = (a["rank_reference_period"], a["reference_period_spread_days"], a["n_ranked"],
                   a["n_unaligned"], a["max_ref_spread_days"])  # fmt: skip
            same(f"{path} alignment {a['indicator_id']}", "alignment fields", got, aw)
        for e in doc["entities"]:
            srow = sc.get((dom, e["entity_id"]))
            for k in (
                "n_available",
                "n_defined",
                "rank_position",
                "n_ranked_entities",
                "low_coverage",
            ):
                same(f"{path} {e['entity_id']}", k, e[k], srow[k] if srow else None)
            same(f"{path} {e['entity_id']}", "percentile_rank", e["percentile_rank"],
                 num(srow["percentile_rank"]) if srow else None)  # fmt: skip
            if e["n_available"] is not None and e["n_available"] > e["n_defined"]:
                out.fail(f"{path} {e['entity_id']}: n_available exceeds n_defined")
            for i in e["indicators"]:
                sw = snap.get((i["indicator_id"], e["entity_id"]))
                where = f"{path} {e['entity_id']}/{i['indicator_id']}"
                if sw is None:
                    out.fail(f"{where}: no published snapshot row")
                    continue
                for k in ("value", "transformed_value", "deviation"):
                    same(where, k, i[k], num(sw[k]))
                same(where, "inherited", i["inherited"], sw["inherited"])  # EXP-02 clause
                same(where, "series_id", i["series_id"], sw["series_id"])
                pct, n_rk = ranks.get((i["indicator_id"], e["entity_id"]), (None, None))
                same(where, "percentile", i["percentile"], pct)
                same(where, "n_ranked", i["n_ranked"], n_rk)
    alerts = {(r[0], r[1]): (r[2], num(r[3]), r[4]) for r in f(
        "SELECT indicator_id, entity_id, level, z, confidence FROM analytics.v_alert_published "
        "WHERE analysis_run_id = %s AND level IN ('watch', 'alert')", [rid])}  # fmt: skip
    if "alerts.json" in docs:
        got_a = {(a["indicator_id"], a["entity_id"]): (a["level"], a["z"], a["confidence"])
                 for a in docs["alerts.json"]["alerts"]}  # fmt: skip
        if got_a != alerts:
            out.fail("alerts.json: rows differ from analytics.v_alert_published")


def check_exp06(files: Sequence[FileEntry], report: CheckReport, out: _Run) -> None:
    sizes = {f.path: len(f.data) for f in files}
    for p, n in sorted(sizes.items()):
        if n > FILE_FAIL:
            out.fail(f"{p}: {n} bytes exceeds the {FILE_FAIL // MB} MB file limit")
        elif n > FILE_WARN:
            out.warn(f"{p}: {n} bytes exceeds the {FILE_WARN // MB} MB file warning")
    total = sum(sizes.values())
    by = {
        k: sum(n for p, n in sizes.items() if p.startswith(k + "/"))
        for k in ("series", "revisions")
    }
    if by["series"] > SERIES_WARN:
        out.warn(f"series/* total {by['series']} bytes exceeds {SERIES_WARN // MB} MB")
    if by["revisions"] > REVISIONS_WARN:
        out.warn(f"revisions/* total {by['revisions']} bytes exceeds {REVISIONS_WARN // MB} MB")
    if total > DATA_FAIL:
        out.fail(f"data/ total {total} bytes exceeds the {DATA_FAIL // MB} MB limit")
    elif total > DATA_WARN:
        out.warn(f"data/ total {total} bytes exceeds {DATA_WARN // MB} MB")
    report.detail["budgets"] = {
        "data_bytes": total,
        "largest_file_bytes": max(sizes.values(), default=0),
        "series_bytes": by["series"],
        "revisions_bytes": by["revisions"],
        "limits": {
            "file_warn": FILE_WARN, "file_fail": FILE_FAIL, "data_warn": DATA_WARN,
            "data_fail": DATA_FAIL, "site_fail": SITE_FAIL,
        },
    }  # fmt: skip


def check_exp07(files: Sequence[FileEntry], out: _Run) -> None:
    for f in files:
        hits = scan_secrets(f.data)
        if f.format == "parquet":  # compressed bytes hide strings: scan the decoded text too
            tab = _table(f)
            text = "\n".join(
                str(v)
                for col in tab.columns
                if pa.types.is_string(col.type) or pa.types.is_dictionary(col.type)
                for v in set(col.to_pylist())
                if v is not None
            )
            hits += scan_secrets(text.encode())
        for name in sorted(set(hits)):
            out.fail(f"{f.path}: secret-like string ({name})")


def check_exp09(
    files: Sequence[FileEntry], docs: Mapping[str, Any], ref: Reference, out: _Run
) -> None:
    """Every exported series has ``publish = public``; withheld pairs carry no number."""
    for f in files:
        if f.format == "parquet":
            bad = sorted(set(_table(f, ["series_id"])["series_id"].to_pylist()) - ref.public_ids)
            if bad:
                out.fail(f"{f.path}: series {bad[:5]} are not from a public source")
            continue
        doc = docs[f.path]
        if f.path in ("revisions_recent.json", "alerts.json"):
            for _, sid in _walk(doc, ("series_id",)):
                if sid is not None and sid not in ref.public_ids:
                    out.fail(f"{f.path}: series {sid} is not from a public source")
        if fnmatchcase(f.path, "scorecard/*.json"):
            numeric = (
                "value",
                "transformed_value",
                "deviation",
                "percentile",
                "n_ranked",
                "alert_level",
            )
            for e in doc["entities"]:
                for i in e["indicators"]:
                    sid = i["series_id"]
                    if (sid is not None and sid not in ref.public_ids) or i["published"] is False:
                        held = [k for k in numeric if i[k] is not None]
                        if held:
                            out.fail(
                                f"{f.path} {e['entity_id']}/{i['indicator_id']}: withheld pair "
                                f"carries {held}"
                            )


def check_exp10(docs: Mapping[str, Any], ref: Reference, run: RunInfo, out: _Run) -> None:
    rows = ref.session.fetch(
        "SELECT max(analysis_run_id) FROM analytics.v_run_published WHERE ingest_run_id = %s",
        [run.ingest_run_id],
    )
    if not rows or rows[0][0] != run.analysis_run_id:
        out.fail(
            f"analysis run {run.analysis_run_id} is not the latest of ingest run "
            f"{run.ingest_run_id}"
        )
    for path, doc in sorted(docs.items()):
        if "analysis_run_id" in doc and doc["analysis_run_id"] != run.analysis_run_id:
            out.fail(f"{path}: analysis_run_id {doc['analysis_run_id']} differs from the run")
    st = docs.get("status.json")
    if st is not None and st["last_run"]["ingest_run_id"] != run.ingest_run_id:
        out.fail("status.json: last_run belongs to another ingest run")


# --------------------------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------------------------


def standard_checker(config: ConfigTree | None = None) -> Checker:
    """The checker of the production export. ``config`` is the config tree used by the producers
    (its git sha is verified again, EXP-03)."""

    def check(session: ExportSession, run: RunInfo, files: Sequence[FileEntry]) -> CheckReport:
        report = CheckReport()
        docs = _json(files)
        ref = Reference(session, run)
        steps: list[tuple[str, Callable[[_Run], None]]] = [
            ("EXP-01", lambda o: check_exp01(files, docs, o)),
            ("EXP-02", lambda o: check_exp02(files, docs, ref, o)),
            ("EXP-03", lambda o: check_exp03(files, docs, run, config, o)),
            ("EXP-04", lambda o: check_exp04(files, docs, ref, run, o)),
            ("EXP-05", lambda o: check_exp05(docs, ref, run, o)),
            ("EXP-06", lambda o: check_exp06(files, report, o)),
            ("EXP-07", lambda o: check_exp07(files, o)),
            ("EXP-09", lambda o: check_exp09(files, docs, ref, o)),
            ("EXP-10", lambda o: check_exp10(docs, ref, run, o)),
        ]
        for cid, step in steps:
            out = _Run(cid, report)
            step(out)
            out.done()
        return report

    return check


def site_findings(site_dir: Path) -> list[Finding]:
    """Whole-site budget (export spec section 8): the built site, ``data/`` included, must stay
    under 300 MB. Run by the ``site`` job after the build."""
    total = sum(p.stat().st_size for p in site_dir.rglob("*") if p.is_file())
    if total > SITE_FAIL:
        return [
            Finding("EXP-06", "fail", f"site is {total} bytes, over the {SITE_FAIL // MB} MB limit")
        ]
    return []
