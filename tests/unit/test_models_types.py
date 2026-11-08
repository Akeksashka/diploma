"""Unit tests for macro_monitor.models.{types,enums} (T05)."""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from macro_monitor.models.enums import (
    DriftKind,
    FetchOutcome,
    LoadKind,
    LoadOutcome,
    ValueStatus,
)
from macro_monitor.models.types import ParsedObservation, RequestSpec, RevisionPolicy

pytestmark = pytest.mark.unit


def _spec(**kw: Any) -> RequestSpec:
    base: dict[str, Any] = {
        "source_id": "eurostat",
        "group_id": "une",
        "method": "GET",
        "url": "https://example.test/x",
        "params": {},
        "headers": {},
        "request_key": "k",
        "fetch_mode": "full",
        "expect_scope": "complete",
    }
    base.update(kw)
    return RequestSpec(**base)


def _obs(value: Decimal | None, status: str) -> ParsedObservation:
    return ParsedObservation(
        series_ref="d|k",
        ref_period_start=date(2026, 9, 1),
        ref_period_end=date(2026, 9, 30),
        value=value,
        value_status=status,  # type: ignore[arg-type]
        source_release_at=None,
        vintage_label=None,
        source_flags=None,
    )


def test_request_spec_valid_combinations() -> None:
    _spec()
    _spec(fetch_mode="full", expect_scope="partial")
    _spec(fetch_mode="incremental", expect_scope="partial")


def test_request_spec_rejects_incremental_complete() -> None:
    with pytest.raises(ValueError, match="incremental"):
        _spec(fetch_mode="incremental", expect_scope="complete")


def test_request_spec_rejects_unknown_mode() -> None:
    with pytest.raises(ValueError, match="fetch_mode"):
        _spec(fetch_mode="delta")


def test_request_spec_frozen() -> None:
    with pytest.raises(FrozenInstanceError):
        _spec().url = "x"  # type: ignore[misc]


@pytest.mark.parametrize("status", ["OBS", "EST", "PROV", "PROJ"])
def test_observation_value_required_for_real_status(status: str) -> None:
    _obs(Decimal("5.10"), status)
    with pytest.raises(ValueError, match="value must be None"):
        _obs(None, status)


@pytest.mark.parametrize("status", ["DEL", "MISS"])
def test_observation_value_must_be_none_for_del_miss(status: str) -> None:
    _obs(None, status)
    with pytest.raises(ValueError, match="value must be None"):
        _obs(Decimal("1"), status)


def test_observation_keeps_decimal_scale() -> None:
    assert str(_obs(Decimal("5.10"), "OBS").value) == "5.10"


def test_observation_rejects_bad_status_and_period() -> None:
    with pytest.raises(ValueError, match="value_status"):
        _obs(Decimal("1"), "XXX")
    with pytest.raises(ValueError, match="precedes"):
        ParsedObservation(
            "s", date(2026, 9, 30), date(2026, 9, 1), Decimal(1), "OBS", None, None, None
        )


def test_revision_policy_defaults() -> None:
    p = RevisionPolicy()
    assert (p.compare, p.decimals, p.rel_epsilon) == ("published_decimals", None, 1e-9)
    assert p.snapshot_mode == "none"
    assert not p.edition_ordered
    assert not p.reestimating


def test_revision_policy_edition_ordered_excludes_reestimating() -> None:
    RevisionPolicy(edition_ordered=True)
    RevisionPolicy(reestimating=True)
    with pytest.raises(ValueError, match="mutually exclusive"):
        RevisionPolicy(edition_ordered=True, reestimating=True)


def test_revision_policy_snapshot_requires_reestimating() -> None:
    RevisionPolicy(reestimating=True, snapshot_mode="diff_above_tol")
    with pytest.raises(ValueError, match="reestimating"):
        RevisionPolicy(snapshot_mode="diff_above_tol")
    with pytest.raises(ValueError, match="requires reestimating"):
        RevisionPolicy(edition_ordered=True, snapshot_mode="diff_above_tol")


def test_revision_policy_fixed_decimals_needs_decimals() -> None:
    RevisionPolicy(compare="fixed_decimals", decimals=2)
    with pytest.raises(ValueError, match="decimals"):
        RevisionPolicy(compare="fixed_decimals")


def _values(e: type[Any]) -> set[str]:
    return {m.value for m in e}


def test_enums_mirror_ddl_check_lists() -> None:
    assert _values(ValueStatus) == {"OBS", "EST", "PROV", "PROJ", "DEL", "MISS"}
    assert _values(LoadKind) == {"initial", "new_period", "revision", "tombstone", "import"}
    assert _values(LoadOutcome) == {
        "loaded",
        "skipped_out_of_order",
        "skipped_by_decision",
        "rejected",
    }
    assert _values(FetchOutcome) == {
        "new",
        "unchanged",
        "not_modified",
        "skipped_robots",
        "blocked",
        "rate_limited",
        "error",
    }
    assert _values(DriftKind) == {
        "unit",
        "base_period",
        "seasonal_adjustment",
        "frequency",
        "flow_basis",
        "classification",
        "composition",
        "dataset_moved",
        "mass_revision",
        "schema_drift",
        "precision_change",
    }
