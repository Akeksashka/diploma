"""ECB Data Portal connector (``kind: sdmx``; SDMX-CSV responses), three steps per ADR-013.

- ``plan``: pure; one request per mapped series key (ADR-004 request sizing), always with
  ``startPeriod=1991-01``. Composition rule: every euro-area aggregate series (REF_AREA ``U2``,
  ``U3``) must declare ``expect.composition`` ``FIXED`` or ``CHANGING`` in the series map, and one
  (indicator, entity) pair must not mix the two: the compositions are never spliced.
- ``fetch``: shared ``HttpClient`` (503/429 retried with backoff by its ``retries`` policy; the
  ECB returned 503 then 200 on 2026-10-17, ADR-004). The body is returned untouched.
- ``parse``: delegates to the frozen parser registry (``ecb_csv_v1@1``).

[UNVERIFIED] URL shape ``service/data/{flow}/{key}?format=csvdata&startPeriod=1991-01`` and the
FIXED/CHANGING key positions are not confirmed by a live capture.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import (
    GroupConfig,
    Mode,
    ParseOutput,
    RawObject,
    SeriesMapEntry,
    StateStore,
)
from macro_monitor.ingestion.connectors.sdmx import ConnectorConfigError, request_key
from macro_monitor.ingestion.http import HttpClient, Validators
from macro_monitor.models.types import FetchResult, RequestSpec
from macro_monitor.registry.config import load_yaml

SOURCE_ID = "ecb"
PARSER_ID = "ecb_csv_v1@1"
START_PARAM = "startPeriod"
AGGREGATE_AREAS = frozenset({"U2", "U3"})
COMPOSITIONS = frozenset({"FIXED", "CHANGING"})


@dataclass(frozen=True)
class EcbSeriesEntry(SeriesMapEntry):
    composition: str = "NA"


def ref_area(key: str) -> str:
    """REF_AREA of an ECB key: the second dimension (after FREQ)."""
    parts = key.split(".")
    return parts[1] if len(parts) > 1 else ""


def check_composition(entries: tuple[SeriesMapEntry, ...]) -> None:
    """Fail closed when an aggregate lacks a composition or a pair mixes compositions."""
    seen: dict[tuple[str, str], set[str]] = {}
    for e in entries:
        comp = e.composition if isinstance(e, EcbSeriesEntry) else "NA"
        if ref_area(e.key) in AGGREGATE_AREAS and comp not in COMPOSITIONS:
            raise ConnectorConfigError(
                f"{e.dataset}/{e.key}: euro-area aggregate must declare expect.composition "
                "FIXED or CHANGING"
            )
        seen.setdefault((e.indicator, e.entity), set()).add(comp)
    for (indicator, entity), comps in seen.items():
        if len(comps & COMPOSITIONS) > 1:
            raise ConnectorConfigError(
                f"{indicator}/{entity}: FIXED and CHANGING compositions must not be spliced"
            )


def load_series_entries(path: Path) -> tuple[EcbSeriesEntry, ...]:
    doc = load_yaml(path)
    if not isinstance(doc, Mapping) or not isinstance(doc.get("series"), list):
        raise ConnectorConfigError(f"{path}: expected a top-level 'series' list")
    entries = tuple(
        EcbSeriesEntry(
            dataset=str(e["dataset"]),
            key=str(e["key"]),
            entity=str(e["entity"]),
            indicator=str(e["indicator"]),
            role=str(e["role"]),
            composition=str((e.get("expect") or {}).get("composition", "NA")),
        )
        for e in doc["series"]
    )
    check_composition(entries)
    return entries


class EcbConnector:
    source_id = SOURCE_ID

    def plan(self, group: GroupConfig, state: StateStore, mode: Mode) -> list[RequestSpec]:
        del state, mode
        if group.mode_default != "full" or group.fetch_scope != "complete":
            raise ConnectorConfigError(f"{group.group_id}: only full/complete requests supported")
        check_composition(group.series)
        tpl = group.request_template
        path = str(tpl.get("path") or "")
        if "{dataset}" not in path or "{key}" not in path:
            raise ConnectorConfigError(f"{group.group_id}: path needs {{dataset}} and {{key}}")
        params: Mapping[str, Any] = tpl.get("params") or {}
        if START_PARAM not in params:
            raise ConnectorConfigError(f"{group.group_id}: params must carry {START_PARAM}")
        query = urlencode(sorted((k, str(v)) for k, v in params.items()))
        base = group.base_url.rstrip("/") + "/"
        specs: list[RequestSpec] = []
        for e in sorted(group.series, key=lambda s: (s.dataset, s.key)):
            url = base + path.format(dataset=e.dataset, key=e.key).lstrip("/") + "?" + query
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
        return http.fetch(spec, validators)

    def parse(self, raw: RawObject, series_filter: Any) -> ParseOutput:
        return registry.resolve(raw.parser_id or PARSER_ID)(raw, series_filter)
