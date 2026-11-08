"""Group fetch: request, archive, parse, manifest + staging in ONE transaction (T25).

Ingestion spec sections 2, 4, 6 and 7 (``fetch``), ADR-004, ADR-013. The per-object work is done
by :func:`macro_monitor.ingestion.archive.record_fetch`: bytes to the raw store first (idempotent
per sha256), then ``raw_blob`` + ``raw_object`` + ``fetch_attempt`` + the staging rows written by
the ``stage`` callback below in one transaction, and only after that commit the fetch-side
``request_state`` pointers advance. A crash between the upload and the commit leaves an asset
without a manifest row and no database row (I-ING-5, AC-ING-5(b)); the re-run fetches again.
An unchanged or not-modified fetch writes only a ``fetch_attempt``.

Validation and loading are the loader's job (T26); this module stages the parser output
(observations, series metadata, parser-rejected rows), every row carrying ``run_id`` and
``raw_id``. Groups are isolated: one failing group never stops the others.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urlsplit

import psycopg

from macro_monitor.ingestion import archive
from macro_monitor.ingestion.archive import ObjectContext, RawStore
from macro_monitor.ingestion.base import (
    Connector,
    GroupConfig,
    Mode,
    ParseOutput,
    RawObject,
    SeriesFilter,
)
from macro_monitor.ingestion.http import HttpClient
from macro_monitor.ingestion.robots import RobotsDecision, RobotsGate
from macro_monitor.models.types import FetchResult, ParsedObservation, ParsedSeriesMeta, RequestSpec
from macro_monitor.storage import manifest
from macro_monitor.storage.manifest import LatestState
from macro_monitor.storage.snapshot import SnapshotRow, record_snapshot
from macro_monitor.validation.checks import RejectedItem
from macro_monitor.validation.quarantine import insert_rejected

log = logging.getLogger(__name__)

FAILING_OUTCOMES = frozenset({"blocked", "error", "rate_limited"})
"""A rate_limited request is deferred to catch-up, so its group is not ok (exit code 10)."""
RunStatus = Literal["ok", "partial", "failed"]

FilterFn = Callable[[RequestSpec], tuple[str | None, SeriesFilter]]
"""Maps a planned request to ``(dataset_id or None, series filter)``."""


@dataclass(frozen=True)
class GroupJob:
    """Everything ``fetch`` needs for one group (built by the CLI from validated config)."""

    source: Mapping[str, Any]  # the validated sources.yaml entry (robots gate, kind)
    group: GroupConfig
    connector: Connector
    parser_id: str
    archive_mode: Literal["public", "hash_only"] = "public"
    basename: str | None = None  # asset basename; default <group_id>.dat
    filter_for: FilterFn | None = None


@dataclass
class GroupFetchReport:
    group_id: str
    outcomes: list[str] = field(default_factory=list)
    raw_ids: list[int] = field(default_factory=list)
    error: str | None = None
    deferred: list[str] = field(default_factory=list)  # request keys left for catch-up
    skipped: list[str] = field(default_factory=list)  # request keys not tried after a block

    @property
    def ok(self) -> bool:
        return self.error is None and not any(o in FAILING_OUTCOMES for o in self.outcomes)


@dataclass
class FetchRunReport:
    run_id: int
    status: RunStatus
    groups: list[GroupFetchReport]


class DbState:
    """``StateStore`` over ``ingest.request_state`` / the manifest; never leaves a tx open."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def latest(self, source_id: str, request_key: str) -> LatestState:
        try:
            return manifest.latest_state(self._conn, source_id, request_key)
        finally:
            self._conn.rollback()  # read only; do not hold a transaction across HTTP


# ------------------------------------------------------------------------------------ runs


def open_run(
    conn: psycopg.Connection,
    *,
    workflow: str,
    trigger: str,
    mode: str,
    git_sha: str,
    code_version: str,
    started_at: datetime,
    gh_run_id: int | None = None,
    gh_run_attempt: int | None = None,
) -> int:
    row = conn.execute(
        "INSERT INTO ingest.run (gh_run_id, gh_run_attempt, workflow, trigger, mode, git_sha, "
        "code_version, started_at, status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'running') "
        "RETURNING run_id",
        [gh_run_id, gh_run_attempt, workflow, trigger, mode, git_sha, code_version, started_at],
    ).fetchone()
    assert row is not None
    conn.commit()
    return int(row[0])


def close_run(conn: psycopg.Connection, run_id: int, status: RunStatus) -> None:
    conn.execute(
        "UPDATE ingest.run SET status = %s, finished_at = clock_timestamp() WHERE run_id = %s",
        [status, run_id],
    )
    conn.commit()


# --------------------------------------------------------------------------------- staging


def _row_hash(o: ParsedObservation) -> str:
    parts = [
        o.series_ref,
        o.ref_period_start.isoformat(),
        o.ref_period_end.isoformat(),
        "" if o.value is None else str(o.value),
        o.value_status,
        "" if o.source_release_at is None else o.source_release_at.isoformat(),
        o.vintage_label or "",
        o.source_flags or "",
    ]
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def _ref(dataset: str | None, series_ref: str) -> str:
    return series_ref if dataset is None else f"{dataset}|{series_ref}"


def stage_output(
    conn: psycopg.Connection,
    *,
    run_id: int,
    raw_id: int,
    output: ParseOutput,
    dataset: str | None = None,
) -> None:
    """Insert the parse output into ``staging.*`` (run-scoped; ``series_ref`` = dataset|key)."""
    obs = [
        (
            run_id,
            raw_id,
            _ref(dataset, o.series_ref),
            o.ref_period_start,
            o.ref_period_end,
            o.value,
            o.value_status,
            o.source_release_at,
            o.vintage_label,
            o.source_flags,
            _row_hash(o),
        )
        for o in output.observations
    ]
    metas = [_meta_row(run_id, raw_id, dataset, m) for m in output.metas]
    with conn.cursor() as cur:
        if obs:
            cur.executemany(
                "INSERT INTO staging.observation_load (run_id, raw_id, series_ref, "
                "ref_period_start, ref_period_end, value, value_status, source_release_at, "
                "vintage_label, source_flags, row_hash) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                obs,
            )
        if metas:
            cur.executemany(
                "INSERT INTO staging.series_meta_load (run_id, raw_id, series_ref, entity_code, "
                "frequency, unit_code, unit_mult, base_period, price_basis, currency_code, "
                "seasonal_adjustment, calendar_basis, flow_basis, title, published_decimals) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                metas,
            )
    insert_rejected(
        conn,
        run_id,
        raw_id,
        [
            RejectedItem(
                _ref(dataset, r.series_ref),
                r.period,
                r.raw_value,
                r.reason.split(":", 1)[0].strip() if ":" in r.reason else "PARSE-03",
                r.reason,
            )
            for r in output.rejected
        ],
    )


def snapshot_rows(output: ParseOutput, dataset: str | None) -> list[SnapshotRow]:
    """Snapshot rows of the parsed full vintage (spec step 3a), keyed like the staging rows."""
    return [
        (_ref(dataset, o.series_ref), o.ref_period_start, o.value, o.value_status)
        for o in output.observations
    ]


def _meta_row(
    run_id: int, raw_id: int, dataset: str | None, m: ParsedSeriesMeta
) -> tuple[object, ...]:
    return (
        run_id,
        raw_id,
        _ref(dataset, m.series_ref),
        m.entity_code,
        m.frequency,
        m.unit_code,
        m.unit_mult,
        m.base_period,
        m.price_basis,
        m.currency_code,
        m.seasonal_adjustment,
        m.calendar_basis,
        m.flow_basis,
        m.title,
        m.published_decimals,
    )


def _path_matches(template: str, dataset: str, url_path: str) -> bool:
    """True if ``url_path`` is the template path for ``dataset``, compared on whole segments.

    ``{dataset}`` and ``{indicator}`` are replaced by the dataset id; any other placeholder
    (e.g. ``{entities}``, ``{key}``) is a one-segment wildcard.
    """
    parts: list[str] = []
    for i, piece in enumerate(re.split(r"\{(\w+)\}", template.lstrip("/"))):
        if i % 2 == 0:
            parts.append(re.escape(piece))
        elif piece in ("dataset", "indicator"):
            parts.append(re.escape(dataset))
        else:
            parts.append(r"[^/]+")
    return re.search(r"(?:^|/)" + "".join(parts) + r"(?:/|$)", url_path.lstrip("/")) is not None


def default_filter(group: GroupConfig, spec: RequestSpec) -> tuple[str | None, SeriesFilter]:
    """Dataset of a request = the template dataset named in its URL; whitelist = its series."""
    datasets = [str(d) for d in (group.request_template.get("datasets") or ())]
    path = str(group.request_template.get("path") or "")
    url_path = urlsplit(spec.url).path
    dataset = next((d for d in datasets if path and _path_matches(path, d, url_path)), None)
    if spec.resolve is not None:  # discovered file: the logical dataset, not the URL, decides
        dataset = spec.resolve.dataset
    keys = frozenset(e.key for e in group.series if dataset is None or e.dataset == dataset)
    return dataset, SeriesFilter(series_refs=keys, missing_markers=group.missing_markers)


# ----------------------------------------------------------------------------- group fetch


def _record_failure(
    conn: psycopg.Connection,
    run_id: int,
    spec: RequestSpec,
    at: datetime,
    exc: BaseException,
) -> None:
    conn.rollback()
    manifest.insert_fetch_attempt(
        conn,
        run_id=run_id,
        source_id=spec.source_id,
        request_key=spec.request_key,
        attempted_at=at,
        outcome="error",
        error_class=str(getattr(exc, "error_class", type(exc).__name__)),
        error_detail=str(exc)[:500],
    )
    conn.commit()


def _robots_for_resolved(
    robots: RobotsGate,
    source: Mapping[str, Any],
    landing: RobotsDecision,
    result: FetchResult,
) -> tuple[RobotsDecision, FetchResult]:
    """Evaluate the resolved file URL; its decision is the one stored on the raw object."""
    assert result.resolved_url is not None
    file_decision = robots.check(source, result.resolved_url)
    if file_decision.escalate:
        log.warning("robots Disallow for the resolved URL of %s: escalate", result.spec.group_id)
    discovery = dict(result.discovery or {})
    discovery["landing_robots_decision"] = landing.decision
    discovery["file_robots_decision"] = file_decision.decision
    return file_decision, replace(result, discovery=discovery)


def _fetch_request(
    conn: psycopg.Connection,
    store: RawStore,
    job: GroupJob,
    http: HttpClient,
    run_id: int,
    spec: RequestSpec,
    state: DbState,
    robots: RobotsGate | None,
    report: GroupFetchReport,
) -> None:
    started = time.monotonic()
    decision = robots.check(job.source, spec.url) if robots is not None else None
    results: list[FetchResult]
    if decision is not None and not decision.allowed:
        results = [
            FetchResult(
                spec, "skipped_robots", None, None, http.clock.wall(), None, None, None, None
            )
        ]
    else:
        fetch_all = getattr(job.connector, "fetch_all", None)  # paginated connectors (World Bank)
        if fetch_all is not None:
            results = list(fetch_all(spec, http, state))
        else:
            results = [job.connector.fetch(spec, http, state)]
        if robots is not None and decision is not None:
            for i, res in enumerate(results):
                if res.resolved_url is not None:
                    # ADR-028 D8: the gate also covers the discovered file URL (other host or
                    # path than the landing page); log-only for bulk, so a Disallow is flagged,
                    # never overridden.
                    decision, results[i] = _robots_for_resolved(robots, job.source, decision, res)
    conn.rollback()
    # Every page is its own immutable raw object (own URL, timestamp, hash); bodies never merge.
    for result in results:
        _record_result(conn, store, job, run_id, result, decision, started, report)


def _record_result(
    conn: psycopg.Connection,
    store: RawStore,
    job: GroupJob,
    run_id: int,
    result: FetchResult,
    decision: RobotsDecision | None,
    started: float,
    report: GroupFetchReport,
) -> None:
    spec = result.spec
    ctx = ObjectContext(
        run_id=run_id,
        parser_id=job.parser_id,
        archive_mode=job.archive_mode,
        basename=job.basename or f"{job.group.group_id}.dat",
        robots_decision=None if decision is None else decision.decision,
        robots_checked_at=None if decision is None else decision.checked_at,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    dataset, flt = (job.filter_for or (lambda s: default_filter(job.group, s)))(spec)

    def stage(c: psycopg.Connection, raw_id: int) -> None:
        assert result.body is not None
        raw = RawObject(
            body=result.body,
            source_id=spec.source_id,
            group_id=spec.group_id,
            fetched_at=result.fetched_at,
            parser_id=job.parser_id,
        )
        output = job.connector.parse(raw, flt)
        stage_output(c, run_id=run_id, raw_id=raw_id, output=output, dataset=dataset)
        if job.group.snapshot_mode == "diff_above_tol":
            record_snapshot(
                c,
                store,
                raw_id=raw_id,
                source_id=spec.source_id,
                rows=snapshot_rows(output, dataset),
                parser_id=job.parser_id,
            )

    outcome = archive.record_fetch(conn, store, result, ctx, stage=stage)
    archive.collect_manifest_line(store, outcome)
    report.outcomes.append(outcome.outcome)
    if outcome.outcome == "new" and outcome.raw_id is not None:
        report.raw_ids.append(outcome.raw_id)


def fetch_group(
    conn: psycopg.Connection,
    store: RawStore,
    job: GroupJob,
    http: HttpClient,
    run_id: int,
    *,
    mode: Mode = "refresh",
    robots: RobotsGate | None = None,
) -> GroupFetchReport:
    """Fetch every planned request of one group; never raises for a per-request failure."""
    report = GroupFetchReport(job.group.group_id)
    state = DbState(conn)
    try:
        specs = job.connector.plan(job.group, state, mode)
    except Exception as exc:
        conn.rollback()
        report.error = f"plan: {type(exc).__name__}: {exc}"[:500]
        return report
    if mode == "catchup":
        try:
            specs = order_for_catchup(specs, load_attempt_history(conn, specs))
        except Exception as exc:  # ordering is an optimisation; keep the planned order
            conn.rollback()
            log.warning("catch-up ordering skipped for %s: %s", job.group.group_id, exc)
    for i, spec in enumerate(specs):
        try:
            _fetch_request(conn, store, job, http, run_id, spec, state, robots, report)
        except Exception as exc:  # per-request isolation: record and continue
            log.error("fetch failed for %s/%s: %s", job.group.group_id, spec.request_key, exc)
            report.outcomes.append("error")
            try:
                _record_failure(conn, run_id, spec, http.clock.wall(), exc)
            except Exception as exc2:  # database unusable: abort this group only
                conn.rollback()
                report.error = f"{type(exc2).__name__}: {exc2}"[:500]
                return report
        last = report.outcomes[-1] if report.outcomes else None
        rest = specs[i + 1 :]
        if last == "blocked":  # ADR-005: never retried or bypassed; skip the group's rest
            report.skipped.extend(s.request_key for s in rest)
            log.error("%s: blocked; %d request(s) skipped", job.group.group_id, len(rest))
            break
        if last == "rate_limited":  # budget or HTTP 429: stop and defer the rest to catch-up
            report.deferred.append(spec.request_key)
            report.deferred.extend(s.request_key for s in rest)
            try:
                _record_deferred(conn, run_id, rest, http.clock.wall())
            except Exception as exc2:
                conn.rollback()
                report.error = f"{type(exc2).__name__}: {exc2}"[:500]
            break
    return report


# ------------------------------------------------------------------ catch-up ordering

ATTEMPT_HISTORY_SQL = (
    "SELECT DISTINCT ON (request_key) request_key, attempted_at, outcome "
    "FROM ingest.fetch_attempt WHERE source_id = %s AND request_key = ANY(%s) "
    "ORDER BY request_key, attempted_at DESC, attempt_id DESC"
)
_DEFER_OUTCOMES = frozenset({"rate_limited"})


def load_attempt_history(
    conn: psycopg.Connection, specs: Sequence[RequestSpec]
) -> dict[str, tuple[datetime, str]]:
    """Latest ``(attempted_at, outcome)`` per request key from ``ingest.fetch_attempt``."""
    if not specs:
        return {}
    try:
        rows = conn.execute(
            ATTEMPT_HISTORY_SQL, [specs[0].source_id, [s.request_key for s in specs]]
        ).fetchall()
    finally:
        conn.rollback()  # read only
    return {str(r[0]): (r[1], str(r[2])) for r in rows}


def order_for_catchup(
    specs: Sequence[RequestSpec], history: Mapping[str, tuple[datetime, str]]
) -> list[RequestSpec]:
    """Never-attempted and rate_limited/deferred requests first, then least recently attempted.

    Deterministic (ties keep the planned order), so a group with more requests than one hour
    budget covers (OECD, 8/hour) makes progress through all of them across catch-up runs
    instead of re-running the first ones (AC-WF-13).
    """
    epoch = datetime.min.replace(tzinfo=UTC)

    def key(item: tuple[int, RequestSpec]) -> tuple[int, datetime, int]:
        idx, spec = item
        seen = history.get(spec.request_key)
        if seen is None:
            return (0, epoch, idx)
        at, outcome = seen
        return (0 if outcome in _DEFER_OUTCOMES else 1, at, idx)

    return [s for _, s in sorted(enumerate(specs), key=key)]


def _record_deferred(
    conn: psycopg.Connection, run_id: int, rest: Sequence[RequestSpec], at: datetime
) -> None:
    """One ``rate_limited`` fetch_attempt (error_class ``deferred``) per request left over."""
    for spec in rest:
        manifest.insert_fetch_attempt(
            conn,
            run_id=run_id,
            source_id=spec.source_id,
            request_key=spec.request_key,
            attempted_at=at,
            outcome="rate_limited",
            error_class="deferred",
        )
    conn.commit()


def fetch_groups(
    conn: psycopg.Connection,
    store: RawStore,
    jobs: Iterable[GroupJob],
    http_for: Callable[[GroupJob], HttpClient],
    *,
    run_id: int,
    mode: Mode = "refresh",
    robots_for: Callable[[GroupJob, HttpClient], RobotsGate | None] | None = None,
) -> FetchRunReport:
    """Run the groups one after another, isolated; set the run status (ok/partial/failed)."""
    reports: list[GroupFetchReport] = []
    for job in jobs:
        try:
            http = http_for(job)
            robots = robots_for(job, http) if robots_for is not None else None
            reports.append(fetch_group(conn, store, job, http, run_id, mode=mode, robots=robots))
        except Exception as exc:
            conn.rollback()
            reports.append(
                GroupFetchReport(job.group.group_id, error=f"{type(exc).__name__}: {exc}"[:500])
            )
    status = _status(reports)
    close_run(conn, run_id, status)
    return FetchRunReport(run_id, status, reports)


def _status(reports: Sequence[GroupFetchReport]) -> RunStatus:
    if all(r.ok for r in reports):
        return "ok"
    return "failed" if not any(r.ok for r in reports) else "partial"
