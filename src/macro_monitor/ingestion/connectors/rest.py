"""World Bank Indicators API connector (``kind: rest``), three steps per ADR-013.

- ``plan``: pure; one first-page request per indicator (``dataset`` of the series map) with an
  explicit country list and ``date=1991:<end>``. Page 1 only: the page count is known only from
  the response.
- ``fetch``: one page through the shared ``HttpClient`` (1 request/s comes from the source
  ``rate_limit``). The body is returned untouched; ``lastupdated`` is read from a copy into
  ``update_marker``.
- ``parse``: delegates to the frozen parser registry (``worldbank_v1@1``).

Pagination: ``next_page`` derives the next page's request from a fetched page; ``fetch_all``
follows pages until ``page >= pages`` (each page is its own raw object; bodies are never merged).

[UNVERIFIED] Query syntax (``country/DEU;FRA/indicator/<id>``, ``date``, ``per_page``,
``page``), the per_page ceiling and the page metadata keys are from API documentation, not a
live capture; the fixture is synthetic.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import replace
from typing import Any
from urllib.parse import urlencode

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import (
    GroupConfig,
    Mode,
    ParseOutput,
    RawObject,
    SeriesFilter,
    StateStore,
)
from macro_monitor.ingestion.connectors.sdmx import ConnectorConfigError, request_key
from macro_monitor.ingestion.http import HttpClient, Validators
from macro_monitor.models.types import FetchResult, RequestSpec

SOURCE_ID = "worldbank"
PARSER_ID = "worldbank_v1@1"
ENTITIES_PLACEHOLDER = "{entities}"
MAX_PAGES = 200  # safety stop against a runaway ``pages`` value


def iso3(key: str) -> str:
    """Entity of a series key ``<indicator>.<ISO3>``."""
    return key.rsplit(".", 1)[-1]


def update_marker(body: bytes) -> str | None:
    """The source-declared ``lastupdated`` date of a page, or ``None``."""
    try:
        doc = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return None
    if isinstance(doc, list) and doc and isinstance(doc[0], dict):
        value = doc[0].get("lastupdated")
        return value if isinstance(value, str) else None
    return None


def _page_spec(spec: RequestSpec, page: int) -> RequestSpec:
    head, _, query = spec.url.partition("?")
    pairs = [(k, v) for k, v in _pairs(query) if k != "page"] + [("page", str(page))]
    url = head + "?" + urlencode(sorted(pairs))
    return replace(spec, url=url, request_key=request_key("GET", url, {}))


def _pairs(query: str) -> list[tuple[str, str]]:
    from urllib.parse import parse_qsl

    return parse_qsl(query, keep_blank_values=True)


def next_page(spec: RequestSpec, body: bytes) -> RequestSpec | None:
    """Request for the page after the one in ``body``; ``None`` when exhausted."""
    from macro_monitor.ingestion.parsers.worldbank_v1 import page_info

    meta = page_info(body)
    page, pages = int(meta["page"]), int(meta["pages"])
    return None if page >= pages else _page_spec(spec, page + 1)


class WorldBankConnector:
    source_id = SOURCE_ID

    def plan(self, group: GroupConfig, state: StateStore, mode: Mode) -> list[RequestSpec]:
        del state, mode
        if group.mode_default != "full" or group.fetch_scope != "complete":
            raise ConnectorConfigError(
                f"{group.group_id}: only full/complete World Bank requests are supported"
            )
        tpl = group.request_template
        path = str(tpl.get("path") or "")
        if "{indicator}" not in path or ENTITIES_PLACEHOLDER not in path:
            raise ConnectorConfigError(
                f"{group.group_id}: request_template.path needs {{entities}} and {{indicator}}"
            )
        params: Mapping[str, Any] = tpl.get("params") or {}
        for needed in ("date", "per_page"):
            if needed not in params:
                raise ConnectorConfigError(f"{group.group_id}: params must carry {needed}")
        base = group.base_url.rstrip("/") + "/"
        specs: list[RequestSpec] = []
        for indicator in tpl.get("datasets") or ():
            codes = sorted({iso3(e.key) for e in group.series if e.dataset == indicator})
            if not codes:
                raise ConnectorConfigError(f"{group.group_id}: no mapped series for {indicator}")
            rel = path.replace(ENTITIES_PLACEHOLDER, ";".join(codes)).replace(
                "{indicator}", str(indicator)
            )
            pairs = sorted([*((k, str(v)) for k, v in params.items()), ("page", "1")])
            url = base + rel.lstrip("/") + "?" + urlencode(pairs, safe=":")
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
        validators = (
            None
            if latest.bytes_unavailable or not (latest.etag or latest.last_modified)
            else Validators(etag=latest.etag, last_modified=latest.last_modified)
        )
        result = http.fetch(spec, validators)
        if result.body is None:
            return result
        marker = update_marker(result.body)
        return result if marker is None else replace(result, update_marker=marker)

    def fetch_all(
        self, spec: RequestSpec, http: HttpClient, state: StateStore
    ) -> list[FetchResult]:
        """Fetch ``spec`` and every following page; stops at the first non-body result."""
        results: list[FetchResult] = []
        current: RequestSpec | None = spec
        while current is not None and len(results) < MAX_PAGES:
            result = self.fetch(current, http, state)
            results.append(result)
            if result.body is None:
                break
            current = next_page(current, result.body)
        return results

    def parse(self, raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
        return registry.resolve(raw.parser_id or PARSER_ID)(raw, series_filter)
