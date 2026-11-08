"""Enums mirroring the SQL CHECK lists of docs/specs/ddl-neon-schema.md.

Each member value is the exact SQL literal. A cross-check against the applied
migrations is added in T15 (risk: Python/SQL enum drift).
"""

from __future__ import annotations

from enum import StrEnum


class ValueStatus(StrEnum):
    """curated.observation.value_status. DEL = our tombstone; MISS = source-declared missing."""

    OBS = "OBS"
    EST = "EST"
    PROV = "PROV"
    PROJ = "PROJ"
    DEL = "DEL"
    MISS = "MISS"


class LoadKind(StrEnum):
    """curated.observation.load_kind."""

    INITIAL = "initial"
    NEW_PERIOD = "new_period"
    REVISION = "revision"
    TOMBSTONE = "tombstone"
    IMPORT = "import"


class QualityFlag(StrEnum):
    """curated.observation.quality_flag."""

    OK = "ok"
    SUSPECT = "suspect"


class RevisionClass(StrEnum):
    """curated.observation.revision_class."""

    REGULAR = "regular"
    REESTIMATION = "reestimation"


class FetchMode(StrEnum):
    """ingest.raw_object.fetch_mode."""

    FULL = "full"
    INCREMENTAL = "incremental"


class FetchScope(StrEnum):
    """ingest.raw_object.fetch_scope."""

    COMPLETE = "complete"
    PARTIAL = "partial"


class FetchOutcome(StrEnum):
    """ingest.fetch_attempt.outcome (also FetchResult.outcome)."""

    NEW = "new"
    UNCHANGED = "unchanged"
    NOT_MODIFIED = "not_modified"
    SKIPPED_ROBOTS = "skipped_robots"
    BLOCKED = "blocked"
    RATE_LIMITED = "rate_limited"
    ERROR = "error"


class LoadOutcome(StrEnum):
    """ingest.raw_load.outcome."""

    LOADED = "loaded"
    SKIPPED_OUT_OF_ORDER = "skipped_out_of_order"
    SKIPPED_BY_DECISION = "skipped_by_decision"
    REJECTED = "rejected"


class SeriesLoadStatus(StrEnum):
    """ingest.raw_series_status.status."""

    DEFERRED = "deferred"
    LOADED = "loaded"
    REJECTED = "rejected"
    SKIPPED_OUT_OF_ORDER = "skipped_out_of_order"


class DriftKind(StrEnum):
    """ops.drift_event.kind."""

    UNIT = "unit"
    BASE_PERIOD = "base_period"
    SEASONAL_ADJUSTMENT = "seasonal_adjustment"
    FREQUENCY = "frequency"
    FLOW_BASIS = "flow_basis"
    CLASSIFICATION = "classification"
    COMPOSITION = "composition"
    DATASET_MOVED = "dataset_moved"
    MASS_REVISION = "mass_revision"
    SCHEMA_DRIFT = "schema_drift"
    PRECISION_CHANGE = "precision_change"


class DriftStatus(StrEnum):
    """ops.drift_event.status."""

    OPEN = "open"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class DriftDecision(StrEnum):
    """ops.drift_decision.decision."""

    ACCEPTED = "accepted"
    REJECTED = "rejected"
    REOPENED = "reopened"


class Frequency(StrEnum):
    """ref.series.frequency."""

    D = "D"
    M = "M"
    Q = "Q"
    A = "A"


class PriceBasis(StrEnum):
    """ref.series.price_basis."""

    NOM = "NOM"
    REAL = "REAL"
    IDX = "IDX"
    RATIO = "RATIO"
    NA = "NA"


class SeasonalAdjustment(StrEnum):
    """ref.series.seasonal_adjustment."""

    SA = "SA"
    NSA = "NSA"
    SCA = "SCA"
    CA = "CA"
    NA = "NA"


class CalendarBasis(StrEnum):
    """ref.series.calendar_basis."""

    CAL = "CAL"
    FISCAL = "FISCAL"
    MKTYR = "MKTYR"


class FlowBasis(StrEnum):
    """ref.series.flow_basis."""

    PERIOD_FLOW = "PERIOD_FLOW"
    ANNUALISED_RATE = "ANNUALISED_RATE"
    STOCK = "STOCK"
    NA = "NA"


class Composition(StrEnum):
    """ref.series.composition."""

    FIXED = "FIXED"
    CHANGING = "CHANGING"
    NA = "NA"


class CompareMode(StrEnum):
    """ref.series_group.compare_mode."""

    PUBLISHED_DECIMALS = "published_decimals"
    FIXED_DECIMALS = "fixed_decimals"


class SnapshotMode(StrEnum):
    """ref.series_group.snapshot_mode."""

    NONE = "none"
    DIFF_ABOVE_TOL = "diff_above_tol"


class SourceKind(StrEnum):
    """ref.source.kind."""

    SDMX = "sdmx"
    REST = "rest"
    BULK = "bulk"
    WEB = "web"
    MANUAL = "manual"
