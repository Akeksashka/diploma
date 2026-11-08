"""Frozen domain dataclasses of docs/specs/ingestion-interfaces-spec.md section 1."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from macro_monitor.models.enums import ValueStatus

_VALUELESS = frozenset({ValueStatus.DEL, ValueStatus.MISS})


@dataclass(frozen=True)
class ResolveSpec:
    """Landing-page discovery of the file URL (ADR-028); carried by a ``RequestSpec``."""

    dataset: str  # the logical dataset (series_map key); identifies the request, not the URL
    link_pattern: str  # anchored regex over the resolved absolute URL
    expect_matches: int
    allowed_hosts: tuple[str, ...]
    expect_format: str | None = None  # "xlsx": the fetched bytes must be a workbook

    @property
    def pattern_id(self) -> str:
        return hashlib.sha256(self.link_pattern.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class RequestSpec:
    source_id: str
    group_id: str
    method: str
    url: str
    params: Mapping[str, str]
    headers: Mapping[str, str]  # secrets only in headers, never logged
    request_key: str  # sha256 of canonical (method, url, sorted params, body)
    fetch_mode: Literal["full", "incremental"]
    expect_scope: Literal["complete", "partial"]
    resolve: ResolveSpec | None = None  # discovered file URL (ADR-028); ``url`` is the landing page

    def __post_init__(self) -> None:
        if self.fetch_mode not in ("full", "incremental"):
            raise ValueError(f"invalid fetch_mode: {self.fetch_mode!r}")
        if self.expect_scope not in ("complete", "partial"):
            raise ValueError(f"invalid expect_scope: {self.expect_scope!r}")
        if self.fetch_mode == "incremental" and self.expect_scope == "complete":
            raise ValueError("fetch_mode 'incremental' requires expect_scope 'partial'")


@dataclass(frozen=True)
class FetchResult:
    spec: RequestSpec
    outcome: Literal[
        "new", "unchanged", "not_modified", "blocked", "skipped_robots", "rate_limited", "error"
    ]
    status: int | None
    body: bytes | None
    fetched_at: datetime  # UTC, completion time, clock-offset corrected (BB25)
    etag: str | None
    last_modified: str | None
    content_type: str | None
    update_marker: str | None  # source-declared (e.g. Eurostat 'updated')
    resolved_url: str | None = None  # discovered file URL (ADR-028); None for a plain request
    discovery: Mapping[str, object] | None = None  # provenance of the discovery (ADR-028 D4)
    error_class: str | None = None  # why an `error` outcome: redirect_refused, body_too_large


@dataclass(frozen=True)
class ParsedSeriesMeta:
    """Fields of ref.series that the source publishes."""

    series_ref: str
    entity_code: str
    frequency: str
    unit_code: str
    unit_mult: int
    base_period: str | None
    price_basis: str
    currency_code: str | None
    seasonal_adjustment: str
    calendar_basis: str
    title: str
    flow_basis: Literal["PERIOD_FLOW", "ANNUALISED_RATE", "STOCK", "NA"]
    published_decimals: int | None  # source DECIMALS attribute, else None


@dataclass(frozen=True)
class ParsedObservation:
    series_ref: str
    ref_period_start: date
    ref_period_end: date
    value: Decimal | None  # None iff value_status in (DEL, MISS)
    value_status: Literal["OBS", "EST", "PROV", "PROJ", "DEL", "MISS"]  # parsers never emit DEL
    source_release_at: datetime | None
    vintage_label: str | None
    source_flags: str | None  # for MISS: the marker/flag text

    def __post_init__(self) -> None:
        try:
            status = ValueStatus(self.value_status)
        except ValueError:
            raise ValueError(f"invalid value_status: {self.value_status!r}") from None
        if (status in _VALUELESS) != (self.value is None):
            raise ValueError(
                f"value must be None iff value_status in (DEL, MISS); "
                f"got value={self.value!r}, value_status={self.value_status!r}"
            )
        if self.ref_period_end < self.ref_period_start:
            raise ValueError("ref_period_end precedes ref_period_start")


@dataclass(frozen=True)
class RevisionPolicy:
    """Per-group revision policy; persisted as ref.series_group."""

    compare: Literal["published_decimals", "fixed_decimals"] = "published_decimals"
    decimals: int | None = None
    rel_epsilon: float = 1e-9
    reestimating: bool = False
    snapshot_mode: Literal["none", "diff_above_tol"] = "none"
    materiality_abs: Decimal = Decimal(0)
    materiality_rel: float = 0.0
    max_revised_rows: int | None = None
    edition_ordered: bool = False  # named-edition group (ADR-017); exclusive with reestimating

    def __post_init__(self) -> None:
        if self.compare not in ("published_decimals", "fixed_decimals"):
            raise ValueError(f"invalid compare: {self.compare!r}")
        if self.snapshot_mode not in ("none", "diff_above_tol"):
            raise ValueError(f"invalid snapshot_mode: {self.snapshot_mode!r}")
        if self.edition_ordered and self.reestimating:
            raise ValueError("edition_ordered and reestimating are mutually exclusive")
        if self.snapshot_mode != "none" and not self.reestimating:
            raise ValueError("snapshot_mode other than 'none' requires reestimating")
        if self.compare == "fixed_decimals" and self.decimals is None:
            raise ValueError("compare 'fixed_decimals' requires decimals")
