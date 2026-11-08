"""Eurostat connector (``kind: sdmx``; JSON-stat responses), three steps per ADR-013.

- ``plan``: pure; one request per dataset of the group, always with the time filter
  ``sinceTimePeriod=1991-01`` and an explicit country list (ADR-004 request sizing).
- ``fetch``: the shared ``HttpClient`` is injected; the body is returned untouched. The
  source-declared ``updated`` timestamp is read from a copy of the bytes into ``update_marker``
  (change-detection step 2); the decision to store or skip is the fetch command's (T25).
- ``parse``: delegates to the frozen parser registry (``jsonstat_v1@1``).

T53 additions (request sizing, async, drift), all connector-side and config-free:

- ``plan`` refuses a request whose estimated cell count (countries x pinned filter values x
  periods) reaches the 500,000-cell synchronous limit (ADR-004) and names the 5,000,000-cell
  ceiling above which Eurostat answers 413. Dimensions the filters do not pin cannot be counted;
  ``body_cells`` measures the delivered cube and ``fetch`` logs a warning at the limit.
- ``fetch`` polls a Eurostat asynchronous status response (ingestion spec section 3.4: at most
  15 minutes, backoff 15 s doubling to 120 s) through the same ``HttpClient`` (rate limit, host
  policy). A 413 is never retried. A body whose JSON-stat ``extension.id`` names another dataset
  is an error (dataset-code drift), and ``RETIRED_DATASETS`` makes ``plan`` reject a code Eurostat
  replaced (``prc_hicp_manr`` -> ``prc_hicp_minr``, data-sources research F5/F13).
- A filter value may be a list; it is written as repeated query parameters
  (``coicop18=A&coicop18=B``).

[UNVERIFIED] The asynchronous status body (``parse_async_status``: JSON ``{"status": ...}``) is a
synthetic stand-in: no real async response has been captured (operator probe pending). The
polling schedule, ceilings and the 413 rule follow the documents; only the body shape is assumed.

T57 adds ``OecdConnector`` (below): OECD whole-dataflow downloads, persisted request budget,
bot-challenge stop with the manual fallback.

Request parameters that repeat (``geo``) are written into the URL query because
``RequestSpec.params`` is a plain mapping.

Verified live 2026-11-04 (OP-04; fixture ``une_rt_m_live_20261104``): ``sinceTimePeriod=1991-01``
and ``freq=M&...&geo=DE&geo=ES&geo=FR`` return HTTP 200 JSON-stat 2.0. The SDMX-style
``c[TIME_PERIOD]=ge:1991`` answers HTTP 500 (GET_FILTERED_DIMENSIONS) on this endpoint.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlencode, urlsplit

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.archive import conditional_headers
from macro_monitor.ingestion.base import (
    GroupConfig,
    Mode,
    ParseOutput,
    RawObject,
    SeriesFilter,
    SeriesMapEntry,
    StateStore,
)
from macro_monitor.ingestion.http import HttpClient, Validators
from macro_monitor.models.types import FetchResult, RequestSpec
from macro_monitor.registry.config import load_yaml
from macro_monitor.storage.manifest import LatestState

log = logging.getLogger(__name__)

SOURCE_ID = "eurostat"
PARSER_ID = "jsonstat_v1@1"
TIME_FILTER_PARAM = "sinceTimePeriod"
GEO_PARAM = "geo"
ENTITIES_PLACEHOLDER = "{entities}"

SYNC_CELL_LIMIT = 500_000  # ADR-004: above this Eurostat answers asynchronously
MAX_CELLS = 5_000_000  # ADR-004: above this Eurostat answers 413
ESTIMATE_UNTIL_YEAR = 2035  # conservative end of the period range used by estimate_cells
PERIODS_PER_YEAR = {"M": 12, "Q": 4, "A": 1}

ASYNC_POLL_FIRST_S = 15.0  # ingestion spec section 3.4
ASYNC_POLL_MAX_STEP_S = 120.0
ASYNC_POLL_CEILING_S = 900.0  # 15 minutes of waiting in total
ASYNC_PENDING = frozenset({"QUEUED", "PENDING", "PROCESSING", "RUNNING"})  # [UNVERIFIED]
ASYNC_FAILED = frozenset({"FAILED", "ERROR", "CANCELLED"})  # [UNVERIFIED]
ASYNC_READY = frozenset({"AVAILABLE", "FINISHED", "READY"})  # [UNVERIFIED]

#: Dataset codes Eurostat replaced: configuring one is an error naming the successor.
RETIRED_DATASETS: Mapping[str, str] = {"prc_hicp_manr": "prc_hicp_minr"}


class ConnectorConfigError(ValueError):
    """The group configuration cannot be turned into requests."""


def load_series_entries(path: Path) -> tuple[SeriesMapEntry, ...]:
    """Read the whitelist keys of a ``config/series_map/<group>.yaml`` file."""
    doc = load_yaml(path)
    if not isinstance(doc, Mapping) or not isinstance(doc.get("series"), list):
        raise ConnectorConfigError(f"{path}: expected a top-level 'series' list")
    return tuple(
        SeriesMapEntry(
            dataset=str(e["dataset"]),
            key=str(e["key"]),
            entity=str(e["entity"]),
            indicator=str(e["indicator"]),
            role=str(e["role"]),
        )
        for e in doc["series"]
    )


def geo_code(key: str) -> str:
    """Eurostat ``geo`` code of a series key: the last dimension before time."""
    return key.rsplit(".", 1)[-1]


def request_key(method: str, url: str, params: Mapping[str, str]) -> str:
    """sha256 of the canonical (method, url, sorted params, empty body)."""
    canon = json.dumps([method.upper(), url, sorted(params.items()), ""], separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def series_filter_for(
    entries: Iterable[SeriesMapEntry],
    dataset: str,
    missing_markers: Iterable[str] = (),
    *,
    discover: bool = False,
) -> SeriesFilter:
    """Whitelist of the series keys of one dataset (the parser's ``series_refs``)."""
    return SeriesFilter(
        series_refs=frozenset(e.key for e in entries if e.dataset == dataset),
        discover=discover,
        missing_markers=frozenset(missing_markers),
    )


def update_marker(body: bytes) -> str | None:
    """The source-declared ``updated`` timestamp of a JSON-stat body, or ``None``."""
    try:
        doc = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return None
    value = doc.get("updated") if isinstance(doc, dict) else None
    return value if isinstance(value, str) else None


DEFAULT_LADDER: tuple[str, ...] = ("http_validators", "content_hash")


def _conditional_validators(ladder: tuple[str, ...], latest: LatestState) -> Validators | None:
    """Validators for the request, only when the ladder has ``http_validators`` (spec step 3)."""
    headers = conditional_headers(ladder, latest)
    if not headers:
        return None
    return Validators(
        etag=headers.get("If-None-Match"), last_modified=headers.get("If-Modified-Since")
    )


class EurostatConnector:
    source_id = SOURCE_ID

    def __init__(self, change_detection: Sequence[str] | None = None) -> None:
        self.ladder: tuple[str, ...] = tuple(change_detection or DEFAULT_LADDER)

    def plan(self, group: GroupConfig, state: StateStore, mode: Mode) -> list[RequestSpec]:
        del state, mode  # a full request per dataset in every mode; no state needed to plan
        if group.mode_default != "full" or group.fetch_scope != "complete":
            raise ConnectorConfigError(
                f"{group.group_id}: only full/complete Eurostat requests are supported"
            )
        tpl = group.request_template
        path = str(tpl.get("path") or "")
        if "{dataset}" not in path:
            raise ConnectorConfigError(f"{group.group_id}: request_template.path needs {{dataset}}")
        params_tpl: Mapping[str, Any] = tpl.get("params") or {}
        if TIME_FILTER_PARAM not in params_tpl:
            raise ConnectorConfigError(f"{group.group_id}: params must carry {TIME_FILTER_PARAM}")
        bad = sorted(k for k in params_tpl if str(k).startswith("c["))
        if bad:  # AC-ETF-2 / rule E7: the SDMX-style filter is rejected by this endpoint (HTTP 500)
            raise ConnectorConfigError(
                f"{group.group_id}: params {bad} use the SDMX filter form; "
                f"use {TIME_FILTER_PARAM} on statistics/1.0/data"
            )
        fixed: Mapping[str, Mapping[str, Any]] = tpl.get("fixed_filters") or {}
        base = group.base_url.rstrip("/") + "/"
        specs: list[RequestSpec] = []
        for dataset in tpl.get("datasets") or ():
            dataset = str(dataset)
            if dataset in RETIRED_DATASETS:
                raise ConnectorConfigError(
                    f"{group.group_id}: dataset {dataset} was replaced by "
                    f"{RETIRED_DATASETS[dataset]} (dataset-code drift)"
                )
            geos = sorted({geo_code(e.key) for e in group.series if e.dataset == dataset})
            if not geos:
                raise ConnectorConfigError(f"{group.group_id}: no mapped series for {dataset}")
            pairs: list[tuple[str, str]] = []
            for name, value in {**params_tpl, **fixed.get(dataset, {})}.items():
                if isinstance(value, list | tuple):
                    pairs.extend((name, str(v)) for v in value)
                elif str(value) == ENTITIES_PLACEHOLDER:
                    pairs.extend((name, g) for g in geos)
                else:
                    pairs.append((name, str(value)))
            if not any(n == GEO_PARAM for n, _ in pairs):
                raise ConnectorConfigError(f"{group.group_id}: params must list {GEO_PARAM}")
            cells = estimate_cells(pairs)
            if cells >= MAX_CELLS:
                raise ConnectorConfigError(
                    f"{group.group_id}/{dataset}: about {cells} cells; Eurostat answers 413 "
                    f"above {MAX_CELLS}. Split the group or narrow the filters"
                )
            if cells >= SYNC_CELL_LIMIT:
                raise ConnectorConfigError(
                    f"{group.group_id}/{dataset}: about {cells} cells, not below the "
                    f"{SYNC_CELL_LIMIT} synchronous limit (ADR-004). Split the group or narrow "
                    "the filters"
                )
            pairs.sort()
            url = base + path.format(dataset=dataset).lstrip("/") + "?" + urlencode(pairs)
            specs.append(
                RequestSpec(
                    source_id=group.source_id,
                    group_id=group.group_id,
                    method="GET",
                    url=url,
                    params={},
                    headers={},
                    request_key=request_key("GET", url, {}),
                    fetch_mode="full",
                    expect_scope="complete",
                )
            )
        return specs

    def fetch(self, spec: RequestSpec, http: HttpClient, state: StateStore) -> FetchResult:
        latest = state.latest(spec.source_id, spec.request_key)
        validators = _conditional_validators(self.ladder, latest)
        result = http.fetch(spec, validators)
        if result.body is None:
            if result.status == 413:
                log.error(
                    "%s: HTTP 413, request too large (limit %d cells); not retried",
                    spec.group_id,
                    MAX_CELLS,
                )
            elif result.status == 404:
                log.error(
                    "%s: HTTP 404; the dataset code may have been renamed or retired "
                    "(dataset-code drift; check the structure endpoint)",
                    spec.group_id,
                )
            return result
        pending = parse_async_status(result.body)
        if pending is not None:
            result = _poll(spec, result, pending, http)
        body = result.body
        if body is None:
            return result
        dataset = dataset_of(spec.url)
        found = body_dataset(body)
        if found is not None and found.lower() != dataset.lower():
            log.error(
                "%s: asked for %s, received %s (dataset-code drift)", spec.group_id, dataset, found
            )
            return replace(result, outcome="error", body=None)
        cells = body_cells(body)
        if cells is not None and cells >= SYNC_CELL_LIMIT:
            log.warning(
                "%s/%s: %d cells delivered, at or above %d",
                spec.group_id,
                dataset,
                cells,
                SYNC_CELL_LIMIT,
            )
        marker = update_marker(body)  # reads a copy; result.body stays as received
        return result if marker is None else _with_marker(result, marker)

    def parse(self, raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
        return registry.resolve(raw.parser_id or PARSER_ID)(raw, series_filter)


def _with_marker(result: FetchResult, marker: str) -> FetchResult:
    return replace(result, update_marker=marker)


def dataset_of(url: str) -> str:
    """Dataset code of a ``.../data/<dataset>?...`` request URL (the last path segment)."""
    return urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]


def body_dataset(body: bytes) -> str | None:
    """JSON-stat ``extension.id`` (the dataset code, upper case), or ``None`` when absent."""
    doc = _json_object(body)
    ext = doc.get("extension") if doc else None
    value = ext.get("id") if isinstance(ext, dict) else None
    return value if isinstance(value, str) else None


def body_cells(body: bytes) -> int | None:
    """Cells of the delivered cube: the product of the JSON-stat ``size`` array."""
    doc = _json_object(body)
    size = doc.get("size") if doc else None
    if not isinstance(size, list) or not size or not all(isinstance(n, int) for n in size):
        return None
    return math.prod(size)


def _json_object(body: bytes) -> dict[str, Any] | None:
    try:
        doc = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


def estimate_cells(
    pairs: Iterable[tuple[str, str]],
    until_year: int | None = None,
    *,
    current_year: int | None = None,
) -> int:
    """Cells of a request: geo count x product of the pinned filter values x periods.

    Counts only dimensions the request pins; an unpinned dimension returns every category and
    is invisible here (see ``body_cells``). ``freq`` selects the periods per year (M, Q, A).
    The period range ends at ``until_year``, default ``max(2035, current year)``; a list-valued
    ``freq`` or ``sinceTimePeriod`` is rejected (the estimate would silently pick one value).
    """
    values: dict[str, set[str]] = {}
    for name, value in pairs:
        values.setdefault(name, set()).add(value)
    for single in ("freq", TIME_FILTER_PARAM):
        if len(values.get(single, ())) > 1:
            raise ConnectorConfigError(
                f"{single} must be a single value, got {sorted(values[single])}"
            )
    if until_year is None:
        year_now = current_year if current_year is not None else datetime.now(UTC).year
        until_year = max(ESTIMATE_UNTIL_YEAR, year_now)
    since = next(iter(values.get(TIME_FILTER_PARAM, {"1991"})))
    try:
        years = max(1, until_year - int(since[:4]) + 1)
    except ValueError as exc:
        raise ConnectorConfigError(f"{TIME_FILTER_PARAM} {since!r} is not a period") from exc
    freq = next(iter(values.get("freq", {"M"})))
    per_year = PERIODS_PER_YEAR.get(freq)
    if per_year is None:
        raise ConnectorConfigError(f"freq {freq!r} is not one of {sorted(PERIODS_PER_YEAR)}")
    skip = {"format", "lang", "freq", TIME_FILTER_PARAM, "untilTimePeriod", "lastTimePeriod"}
    count = 1
    for name, vals in values.items():
        if name not in skip:
            count *= len(vals)
    return count * years * per_year


@dataclass(frozen=True)
class AsyncStatus:
    state: Literal["pending", "failed", "ready"]
    url: str | None  # where to poll (pending) or fetch the result (ready)


def parse_async_status(body: bytes) -> AsyncStatus | None:
    """Recognise an asynchronous status body; ``None`` for a normal JSON-stat dataset.

    [UNVERIFIED] shape: ``{"status": "<STATE>", "statusUrl": ..., "dataUrl": ...}``. A dataset
    (``"class": "dataset"`` or a ``value`` array) is never mistaken for a status body.
    """
    doc = _json_object(body)
    if doc is None or "value" in doc or doc.get("class") == "dataset":
        return None
    state = doc.get("status")
    if not isinstance(state, str):
        return None
    word = state.upper()
    if word in ASYNC_PENDING:
        url = doc.get("statusUrl")
        return AsyncStatus("pending", url if isinstance(url, str) else None)
    if word in ASYNC_READY:
        url = doc.get("dataUrl")
        return AsyncStatus("ready", url if isinstance(url, str) else None)
    if word in ASYNC_FAILED:
        return AsyncStatus("failed", None)
    return None


def poll_delays() -> list[float]:
    """Sleep schedule: 15 s doubling to 120 s, never more than 15 minutes in total."""
    out: list[float] = []
    delay, total = ASYNC_POLL_FIRST_S, 0.0
    while total + delay <= ASYNC_POLL_CEILING_S:
        out.append(delay)
        total += delay
        delay = min(delay * 2, ASYNC_POLL_MAX_STEP_S)
    return out


def _poll_spec(spec: RequestSpec, url: str) -> RequestSpec:
    return replace(spec, url=url, params={}, request_key=request_key("GET", url, {}))


def _poll(
    spec: RequestSpec, first: FetchResult, status: AsyncStatus, http: HttpClient
) -> FetchResult:
    """Follow an asynchronous Eurostat response to the data; the result keeps the ORIGINAL spec.

    The whole sequence, poll sleeps and http-level retry waits included, is bounded by
    ``ASYNC_POLL_CEILING_S``. The final data URL is reported as ``resolved_url`` so the robots
    gate and the manifest provenance cover it.
    """
    current = status
    delays = iter(poll_delays())
    start = http.clock.monotonic()

    def remaining() -> float:
        return ASYNC_POLL_CEILING_S - (http.clock.monotonic() - start)

    while True:
        if current.state == "failed" or current.url is None:
            log.error("%s: Eurostat asynchronous request failed or gave no URL", spec.group_id)
            return replace(first, outcome="error", body=None)
        step = _poll_spec(spec, current.url)
        if current.state == "ready":
            data = http.fetch(step, None, max_total_wait_s=max(0.0, remaining()))
            return (
                replace(data, spec=spec, resolved_url=step.url)
                if data.body is not None
                else replace(first, outcome="error", body=None)
            )
        delay = next(delays, None)
        if delay is None or delay > remaining():
            log.error(
                "%s: asynchronous request not ready after %d s", spec.group_id, ASYNC_POLL_CEILING_S
            )
            return replace(first, outcome="error", body=None)
        http.clock.sleep(delay)
        polled = http.fetch(step, None, max_total_wait_s=max(0.0, remaining()))
        if polled.body is None:
            return replace(polled, spec=spec)
        nxt = parse_async_status(polled.body)
        if nxt is None:  # the status URL answered with the dataset itself
            return replace(polled, spec=spec, resolved_url=step.url)
        current = nxt


# ----------------------------------------------------------------------------------- OECD (T57)

OECD_SOURCE_ID = "oecd"
OECD_PARSER_ID = "sdmxcsv_v1@1"
OECD_START_PARAM = "startPeriod"
OECD_FORBIDDEN_PARAMS = frozenset(
    {"lastnobservations", "firstnobservations", "updatedafter", "endperiod"}
)
MANUAL_FALLBACK_HINT = (
    "download the dataflow by hand and place it in manual_inbox/oecd/<YYYY-MM>/ with a "
    ".meta.yaml sidecar (ADR-005); the challenge is never retried or bypassed"
)


@dataclass(frozen=True)
class BudgetedFetch:
    """Outcome of a budget-aware pass over a group's requests (AC-WF-13 logic).

    ``results`` holds every request that was actually attempted; ``deferred`` holds the requests
    left for the next catch-up run (budget used up, or a bot challenge stopped the group).
    """

    results: tuple[FetchResult, ...]
    deferred: tuple[RequestSpec, ...]
    stopped_by: Literal["budget", "blocked"] | None


class OecdConnector:
    """OECD SDMX REST (``kind: sdmx``; SDMX-CSV), three steps per ADR-013.

    - ``plan``: pure; one whole-dataflow request per dataset: no key (no wildcards), no
      ``lastNObservations``/``UpdatedAfter``, always ``startPeriod`` from 1991 (ADR-004).
    - ``fetch``: shared ``HttpClient``; its persisted hour budget (``rate_limit.budget_per_hour``, 8
      for OECD) turns an exhausted budget into outcome ``rate_limited`` (deferred, never counted).
      A bot challenge is outcome ``blocked``: logged with the manual fallback, never retried.
    - ``fetch_budgeted``: one pass over the planned requests that stops at the first
      ``rate_limited`` or ``blocked`` outcome and reports the rest as deferred to catch-up.
    - ``parse``: delegates to the frozen parser registry (``sdmxcsv_v1@1``).

    [UNVERIFIED] ``format=csvfile`` and the dataflow ids other than KEI and PRICES_ALL (research
    F13) are not confirmed by a live capture; the source stays ``enabled: false`` until probed.
    """

    source_id = OECD_SOURCE_ID

    def __init__(self, change_detection: Sequence[str] | None = None) -> None:
        self.ladder: tuple[str, ...] = tuple(change_detection or DEFAULT_LADDER)

    def plan(self, group: GroupConfig, state: StateStore, mode: Mode) -> list[RequestSpec]:
        del state, mode  # always the whole dataflow; no state needed to plan
        if group.mode_default != "full" or group.fetch_scope != "complete":
            raise ConnectorConfigError(f"{group.group_id}: only full/complete OECD requests")
        tpl = group.request_template
        path = str(tpl.get("path") or "")
        if path.rstrip("/").rsplit("/", 1)[-1] != "{dataset}":
            raise ConnectorConfigError(
                f"{group.group_id}: path must end in {{dataset}} (whole dataflow, no key)"
            )
        params: Mapping[str, Any] = tpl.get("params") or {}
        bad = sorted(str(k) for k in params if str(k).lower() in OECD_FORBIDDEN_PARAMS)
        if bad:
            raise ConnectorConfigError(f"{group.group_id}: parameters {bad} are not allowed")
        since = str(params.get(OECD_START_PARAM) or "")
        if not since[:4].isdigit() or int(since[:4]) > 1991:
            raise ConnectorConfigError(f"{group.group_id}: {OECD_START_PARAM} must start in 1991")
        query = urlencode(sorted((str(k), str(v)) for k, v in params.items()))
        base = group.base_url.rstrip("/") + "/"
        specs: list[RequestSpec] = []
        for dataset in sorted(str(d) for d in tpl.get("datasets") or ()):
            if any(ch in dataset for ch in "*+ ") or "/" in dataset:
                raise ConnectorConfigError(f"{group.group_id}: {dataset!r} is not a plain dataflow")
            if not any(e.dataset == dataset for e in group.series):
                raise ConnectorConfigError(f"{group.group_id}: no mapped series for {dataset}")
            url = base + path.format(dataset=dataset).lstrip("/") + "?" + query
            specs.append(
                RequestSpec(
                    source_id=group.source_id,
                    group_id=group.group_id,
                    method="GET",
                    url=url,
                    params={},
                    headers={},
                    request_key=request_key("GET", url, {}),
                    fetch_mode="full",
                    expect_scope="complete",
                )
            )
        if not specs:
            raise ConnectorConfigError(f"{group.group_id}: request_template.datasets is empty")
        return specs

    def fetch(self, spec: RequestSpec, http: HttpClient, state: StateStore) -> FetchResult:
        latest = state.latest(spec.source_id, spec.request_key)
        validators = _conditional_validators(self.ladder, latest)
        result = http.fetch(spec, validators)
        if result.outcome == "blocked":
            log.error("%s: OECD bot challenge; %s", spec.group_id, MANUAL_FALLBACK_HINT)
        return result

    def fetch_budgeted(
        self, specs: Iterable[RequestSpec], http: HttpClient, state: StateStore
    ) -> BudgetedFetch:
        results: list[FetchResult] = []
        pending = list(specs)
        while pending:
            spec = pending[0]
            result = self.fetch(spec, http, state)
            if result.outcome == "rate_limited":
                return BudgetedFetch(tuple(results), tuple(pending), "budget")
            pending.pop(0)
            results.append(result)
            if result.outcome == "blocked":
                return BudgetedFetch(tuple(results), tuple(pending), "blocked")
        return BudgetedFetch(tuple(results), (), None)

    def parse(self, raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
        return registry.resolve(raw.parser_id or OECD_PARSER_ID)(raw, series_filter)
