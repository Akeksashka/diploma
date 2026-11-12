"""Bulk-file connectors (``kind: bulk``, plus one ``rest`` JSON source), three steps per ADR-013.

``BulkConnector`` serves BIS (T54) and the T58 file sources, parameterised by source id and default
parser id (``BULK_SOURCES``): Pink Sheet XLSX, FAO files, EC survey ZIP. ``DbnomicsConnector`` is
the direct-REST route to AMECO (A02c); the AGPL ``dbnomics`` client is not used. The BIS description
below applies to every ``BulkConnector`` source; ``update_marker`` for a workbook (XLSX) comes from
``Last-Modified`` only, because XLSX member dates are not a file date.

- ``plan``: pure; one request per dataset of the group (``request_template.datasets``), a plain
  GET of ``path`` with ``{dataset}`` filled in. Bulk files are always complete files:
  ``fetch_scope: complete``, ``mode_default: full``.
- ``fetch``: shared ``HttpClient``; conditional request from the stored validators. The body (the
  zip as served) is returned untouched. ``update_marker`` is the file date (change-detection
  step 2): the ``Last-Modified`` header date, else the newest zip member date, read from a copy.
  The decision to store or skip is the fetch command's; the content hash is the last rung.
- ``parse``: delegates to the frozen parser registry (``bis_v1@1``).

[UNVERIFIED] The file URL shape ``static/bulk/{dataset}_csv_flat.zip`` and the dataset codes are
not confirmed by a live capture; the group stays ``enabled: false`` until an operator probe.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import replace
from email.utils import parsedate_to_datetime

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import (
    GroupConfig,
    Mode,
    ParseError,
    ParseOutput,
    RawObject,
    SeriesFilter,
    StateStore,
)
from macro_monitor.ingestion.connectors.sdmx import ConnectorConfigError, request_key
from macro_monitor.ingestion.discovery import DiscoveryFailed, host_allowed, resolve_link
from macro_monitor.ingestion.http import (
    ERR_BODY_TOO_LARGE,
    ERR_REDIRECT_REFUSED,
    HttpClient,
    Validators,
)
from macro_monitor.ingestion.parsers.bis_v1 import zip_member_date
from macro_monitor.ingestion.parsers.xlsx_rows import is_xlsx
from macro_monitor.models.types import FetchResult, RequestSpec, ResolveSpec

SOURCE_ID = "bis"
PARSER_ID = "bis_v1@1"
#: A landing page larger than this is refused (checked here, not in http.py).
MAX_LANDING_BYTES = 2 * 1024 * 1024
DBNOMICS_SOURCE_ID = "dbnomics"

#: Bulk sources by id -> default parser id (``None``: the group's recorded parser id decides, for
#: a source whose groups use different file layouts). All new sources are disabled until probed.
BULK_SOURCES: dict[str, str | None] = {
    "bis": "bis_v1@1",
    "worldbank_pinksheet": "pinksheet_v1@1",
    "fao": None,  # www.fao.org: FFPI csv and cereal brief xlsx, one parser per group
    "faostat": "fao_stat_v1@1",  # bulks-faostat.fao.org (own host: one host per source)
    "ec_surveys": "ecsurvey_v2@2",
}


def file_date(last_modified: str | None, body: bytes) -> str | None:
    """ISO date of the file: ``Last-Modified`` if parseable, else the newest zip member date.

    A workbook is a zip too, but its member dates are not a file date, so it gets none."""
    if last_modified:
        try:
            return parsedate_to_datetime(last_modified).date().isoformat()
        except (TypeError, ValueError):
            pass
    if is_xlsx(body):
        return None
    member = zip_member_date(body)
    return member.isoformat() if member else None


class BulkConnector:
    def __init__(self, source_id: str = SOURCE_ID) -> None:
        if source_id not in BULK_SOURCES:
            raise ConnectorConfigError(f"{source_id!r} is not a bulk-file source")
        self.source_id = source_id
        self._default_parser = BULK_SOURCES[source_id]

    def plan(self, group: GroupConfig, state: StateStore, mode: Mode) -> list[RequestSpec]:
        del state, mode  # a full file per dataset in every mode
        if group.mode_default != "full" or group.fetch_scope != "complete":
            raise ConnectorConfigError(f"{group.group_id}: only full/complete files supported")
        tpl: Mapping[str, object] = group.request_template
        discover = tpl.get("discover")
        path = str(tpl.get("path") or "")
        if discover is not None:
            if path:
                raise ConnectorConfigError(f"{group.group_id}: path and discover are exclusive")
        elif "{dataset}" not in path:
            raise ConnectorConfigError(f"{group.group_id}: request_template.path needs {{dataset}}")
        datasets = [str(d) for d in tpl.get("datasets") or ()]  # type: ignore[attr-defined]
        if not datasets:
            raise ConnectorConfigError(f"{group.group_id}: request_template.datasets is empty")
        mapped = {e.dataset for e in group.series}
        unmapped = sorted(set(datasets) - mapped)
        if unmapped:
            raise ConnectorConfigError(f"{group.group_id}: no mapped series for {unmapped}")
        if discover is not None:
            return self._plan_discovered(group, dict(discover), datasets)  # type: ignore[call-overload]
        base = group.base_url.rstrip("/") + "/"
        specs: list[RequestSpec] = []
        for dataset in sorted(datasets):
            url = base + path.format(dataset=dataset).lstrip("/")
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

    def _plan_discovered(
        self, group: GroupConfig, disc: Mapping[str, object], datasets: list[str]
    ) -> list[RequestSpec]:
        """ADR-028: pure and offline. ``url`` is the landing page, the key is the logical one."""
        landing = str(disc.get("landing_url") or "")
        pattern = str(disc.get("link_pattern") or "")
        hosts = tuple(str(h) for h in disc.get("allowed_hosts") or ())  # type: ignore[attr-defined]
        expect = disc.get("expect_matches", 1)
        if not landing or not pattern or not hosts:
            raise ConnectorConfigError(
                f"{group.group_id}: discover needs landing_url, pattern, hosts"
            )
        if expect != 1:
            raise ConnectorConfigError(f"{group.group_id}: only expect_matches: 1 is supported")
        if not host_allowed(landing, hosts):
            raise ConnectorConfigError(f"{group.group_id}: landing_url host not in allowed_hosts")
        if len(datasets) != 1:
            raise ConnectorConfigError(f"{group.group_id}: a discovered group has one dataset")
        fmt = group.format or None
        (dataset,) = datasets
        return [
            RequestSpec(
                source_id=group.source_id,
                group_id=group.group_id,
                method="GET",
                url=landing,
                params={"dataset": dataset},
                headers={},
                request_key=request_key("GET", landing, {"dataset": dataset}),
                fetch_mode="full",
                expect_scope="complete",
                resolve=ResolveSpec(dataset, pattern, 1, hosts, fmt),
            )
        ]

    def _fetch_discovered(
        self, spec: RequestSpec, http: HttpClient, state: StateStore
    ) -> FetchResult:
        """Landing GET, anchored single-match assertion, file GET (ADR-028 D3); never a fallback."""
        res = spec.resolve
        assert res is not None
        landing_spec = replace(
            spec, params={}, request_key=request_key("GET", spec.url, {}), resolve=None
        )
        landing = http.fetch(landing_spec, None, max_body_bytes=MAX_LANDING_BYTES)
        if landing.outcome == "error" and landing.error_class == ERR_BODY_TOO_LARGE:
            raise DiscoveryFailed(f"landing page too large: over {MAX_LANDING_BYTES} bytes")
        if landing.outcome != "new":
            if landing.outcome in ("blocked", "rate_limited", "skipped_robots"):
                return replace(landing, spec=spec)  # ADR-005 behaviour, not discovery_failed
            raise DiscoveryFailed(f"landing page fetch failed: {landing.outcome} {landing.status}")
        ctype = (landing.content_type or "").lower()
        if landing.status != 200 or ("html" not in ctype):
            raise DiscoveryFailed(f"landing response is not HTML 200: {landing.status} {ctype!r}")
        assert landing.body is not None
        if len(landing.body) > MAX_LANDING_BYTES:
            raise DiscoveryFailed(f"landing page too large: {len(landing.body)} bytes")
        match = resolve_link(landing.body, spec.url, res)
        file_spec = replace(
            spec,
            url=match.resolved_url,
            params={},
            request_key=request_key("GET", match.resolved_url, {}),
            resolve=None,
        )
        latest = state.latest(spec.source_id, spec.request_key)
        validators = (
            Validators(etag=latest.etag, last_modified=latest.last_modified)
            if not latest.bytes_unavailable
            and (latest.etag or latest.last_modified)
            and latest.last_url == match.resolved_url
            else None
        )
        # Robots note: fetch.py checks the robots rules of the resolved URL after this GET, not
        # before. That is equivalent to checking first only because bulk robots gating is
        # log-only (a Disallow is flagged, never enforced) and rule 44 forbids discover on web
        # sources, which are the only enforced kind. If bulk gating is ever enforced, check first.
        result = http.fetch(file_spec, validators)
        if result.outcome == "error" and result.error_class == ERR_REDIRECT_REFUSED:
            # http.py marks a refused redirect (non-TLS, unlisted host, too many) explicitly.
            raise DiscoveryFailed(
                f"file request refused a redirect off the allow-list: {result.status}"
            )
        discovery = {
            "landing_url": spec.url,
            "landing_status": landing.status,
            "landing_sha256": hashlib.sha256(landing.body).hexdigest(),
            "link_pattern_id": res.pattern_id,
            "matched_href": match.matched_href,
            "resolved_url": match.resolved_url,
            "resolved_at": landing.fetched_at.isoformat(),
        }
        result = replace(result, spec=spec, resolved_url=match.resolved_url, discovery=discovery)
        if result.body is None:
            return result
        if res.expect_format == "xlsx" and not is_xlsx(result.body):
            raise DiscoveryFailed("resolved file is not an xlsx workbook")
        if res.expect_format == "zip" and not result.body.startswith(b"PK\x03\x04"):
            raise DiscoveryFailed("resolved file is not a zip archive")
        marker = file_date(result.last_modified, result.body)
        return result if marker is None else replace(result, update_marker=marker)

    def fetch(self, spec: RequestSpec, http: HttpClient, state: StateStore) -> FetchResult:
        if spec.resolve is not None:
            return self._fetch_discovered(spec, http, state)
        latest = state.latest(spec.source_id, spec.request_key)
        validators = (
            None
            if latest.bytes_unavailable or not (latest.etag or latest.last_modified)
            else Validators(etag=latest.etag, last_modified=latest.last_modified)
        )
        result = http.fetch(spec, validators)
        if result.body is None:
            return result
        marker = file_date(result.last_modified, result.body)
        return result if marker is None else replace(result, update_marker=marker)

    def parse(self, raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
        parser_id = raw.parser_id or self._default_parser
        if parser_id is None:
            raise ParseError(f"PARSE-01: no parser id recorded for {raw.group_id}")
        return registry.resolve(parser_id)(raw, series_filter)


class DbnomicsConnector:
    """AMECO output gap through the DBnomics REST API (``kind: rest``), direct HTTP only.

    ``plan``: one request per ``request_template.datasets`` entry (``PROVIDER/DATASET``), the
    template ``params`` as given, which must set ``limit`` (no paging in v1: the parser fails
    closed if the response was truncated). ``fetch``: shared ``HttpClient`` with validators; no
    ``update_marker`` is claimed (the change ladder is validators, then content hash).
    """

    source_id = DBNOMICS_SOURCE_ID

    def plan(self, group: GroupConfig, state: StateStore, mode: Mode) -> list[RequestSpec]:
        del state, mode
        if group.mode_default != "full" or group.fetch_scope != "complete":
            raise ConnectorConfigError(f"{group.group_id}: only full/complete requests supported")
        tpl: Mapping[str, object] = group.request_template
        path = str(tpl.get("path") or "")
        if "{dataset}" not in path:
            raise ConnectorConfigError(f"{group.group_id}: request_template.path needs {{dataset}}")
        params = {str(k): str(v) for k, v in dict(tpl.get("params") or {}).items()}  # type: ignore[call-overload]
        if not params.get("limit", "").isdigit() or "offset" in params:
            raise ConnectorConfigError(f"{group.group_id}: params need limit and no offset")
        datasets = [str(d) for d in tpl.get("datasets") or ()]  # type: ignore[attr-defined]
        if not datasets:
            raise ConnectorConfigError(f"{group.group_id}: request_template.datasets is empty")
        mapped = {e.dataset for e in group.series}
        unmapped = sorted(set(datasets) - mapped)
        if unmapped:
            raise ConnectorConfigError(f"{group.group_id}: no mapped series for {unmapped}")
        base = group.base_url.rstrip("/") + "/"
        specs: list[RequestSpec] = []
        for dataset in sorted(datasets):
            if dataset.count("/") != 1:
                raise ConnectorConfigError(f"{group.group_id}: dataset {dataset!r} is not P/D")
            url = base + path.format(dataset=dataset).lstrip("/")
            specs.append(
                RequestSpec(
                    source_id=group.source_id,
                    group_id=group.group_id,
                    method="GET",
                    url=url,
                    params=params,
                    headers={},
                    request_key=request_key("GET", url, params),
                    fetch_mode="full",
                    expect_scope="complete",
                )
            )
        return specs

    def fetch(self, spec: RequestSpec, http: HttpClient, state: StateStore) -> FetchResult:
        latest = state.latest(spec.source_id, spec.request_key)
        validators = (
            None
            if latest.bytes_unavailable or not (latest.etag or latest.last_modified)
            else Validators(etag=latest.etag, last_modified=latest.last_modified)
        )
        return http.fetch(spec, validators)

    def parse(self, raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
        return registry.resolve(raw.parser_id or "ameco_v1@1")(raw, series_filter)
