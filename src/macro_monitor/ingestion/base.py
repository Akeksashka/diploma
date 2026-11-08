"""Types shared by connectors and parsers (ingestion spec section 2).

``RawObject``, ``SeriesFilter`` and ``ParseOutput`` are named by the spec's Connector protocol
but not field-defined there; the definitions below are the minimum a pure ``parse`` needs.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal, Protocol

from macro_monitor.models.types import (
    FetchResult,
    ParsedObservation,
    ParsedSeriesMeta,
    RequestSpec,
)

if TYPE_CHECKING:
    from macro_monitor.ingestion.http import HttpClient
    from macro_monitor.storage.manifest import LatestState


class ParseError(Exception):
    """PARSE-01: the object does not have the expected structure (schema drift)."""


@dataclass(frozen=True)
class RawObject:
    """Stored bytes plus the facts a parser may use (no clock, no network)."""

    body: bytes
    source_id: str
    group_id: str
    fetched_at: datetime
    parser_id: str | None = None


@dataclass(frozen=True)
class SeriesFilter:
    """Only mapped series are emitted; ``discover`` emits metas (no observations) for the rest."""

    series_refs: frozenset[str]
    discover: bool = False
    missing_markers: frozenset[str] = frozenset()


@dataclass(frozen=True)
class RejectedRow:
    """A row dropped by the parser (PARSE-02, PARSE-03) with the reason, for staging.rejected."""

    series_ref: str
    period: str | None
    raw_value: str | None
    reason: str


@dataclass(frozen=True)
class ParseOutput:
    metas: tuple[ParsedSeriesMeta, ...] = ()
    observations: tuple[ParsedObservation, ...] = ()
    rejected: tuple[RejectedRow, ...] = ()
    source_updated: str | None = None  # source-declared update marker, e.g. Eurostat 'updated'
    extras: dict[str, str] = field(default_factory=dict)


ParseFn = Callable[[RawObject, SeriesFilter], ParseOutput]


Mode = Literal["refresh", "catchup", "manual", "preflight"]
"""``plan --mode`` values (ingestion spec section 7)."""


@dataclass(frozen=True)
class SeriesMapEntry:
    """The ``series_map`` entry keys a connector needs (source-config-schema section 4)."""

    dataset: str
    key: str
    entity: str
    indicator: str
    role: str


@dataclass(frozen=True)
class GroupConfig:
    """One validated source group as seen by ``Connector.plan`` (ADR-013).

    ``request_template`` is the group's raw ``request_template`` block; ``series`` are the
    entries of the group's series map (the parser whitelist).
    """

    source_id: str
    group_id: str
    base_url: str
    request_template: Mapping[str, Any]
    fetch_scope: Literal["complete", "partial"]
    mode_default: Literal["full", "incremental"] = "full"
    missing_markers: frozenset[str] = frozenset()
    series: tuple[SeriesMapEntry, ...] = ()
    snapshot_mode: Literal["none", "diff_above_tol"] = "none"
    format: str = ""  # the group's file format (xlsx, csv, ...)

    @classmethod
    def from_config(
        cls,
        source: Mapping[str, Any],
        group: Mapping[str, Any],
        series: tuple[SeriesMapEntry, ...] = (),
    ) -> GroupConfig:
        return cls(
            source_id=str(source["id"]),
            group_id=str(group["id"]),
            base_url=str(source.get("base_url", "")),
            request_template=dict(group.get("request_template") or {}),
            fetch_scope=group["fetch_scope"],
            mode_default=group.get("mode_default", "full"),
            missing_markers=frozenset(group.get("missing_markers") or ()),
            series=series,
            snapshot_mode=_snapshot_mode(group),
            format=str(group.get("format") or ""),
        )


def _snapshot_mode(group: Mapping[str, Any]) -> Literal["none", "diff_above_tol"]:
    """Group snapshot mode; defaults as in ``registry.sync.group_row`` (reestimating -> diff)."""
    rev = group.get("revision") or {}
    default = "diff_above_tol" if group.get("reestimating", False) else "none"
    return "diff_above_tol" if rev.get("snapshot_mode", default) == "diff_above_tol" else "none"


class StateStore(Protocol):
    """Read access to the fetch-side pointers of ``ingest.request_state`` (spec section 6)."""

    def latest(self, source_id: str, request_key: str) -> LatestState: ...


class Connector(Protocol):
    """Three-step connector protocol (ADR-013): exactly these members, no ``describe_series``."""

    source_id: str

    def plan(self, group: GroupConfig, state: StateStore, mode: Mode) -> list[RequestSpec]: ...

    def fetch(self, spec: RequestSpec, http: HttpClient, state: StateStore) -> FetchResult: ...

    def parse(self, raw: RawObject, series_filter: SeriesFilter) -> ParseOutput: ...
