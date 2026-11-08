"""Unit tests for the parser registry and jsonstat_v1 (T22: AC-ING-1, AC-ING-11, AC-ING-17)."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
import yaml

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.base import ParseError, ParseOutput, RawObject, SeriesFilter
from macro_monitor.ingestion.parsers import jsonstat_v1

pytestmark = pytest.mark.unit

FIX = Path(__file__).parent.parent / "fixtures"
RAW = FIX / "raw" / "eurostat" / "une_rt_m_synthetic.json"
SIDECAR = FIX / "raw" / "eurostat" / "une_rt_m_synthetic.meta.yaml"
GOLDEN = FIX / "golden" / "jsonstat_v1_une_rt_m_synthetic.json"

# Released parser ids: removing one of these from the registry must fail this test (AC-ING-11).
RELEASED_IDS = frozenset({"jsonstat_v1@1"})

REFS = frozenset({"M.SA.TOTAL.PC_ACT.T.DE", "M.SA.TOTAL.PC_ACT.T.FR", "M.SA.TOTAL.PC_ACT.T.ES"})


def _raw(body: bytes | None = None) -> RawObject:
    return RawObject(
        body=RAW.read_bytes() if body is None else body,
        source_id="eurostat",
        group_id="une",
        fetched_at=datetime(2026, 11, 1, tzinfo=UTC),
    )


def _filter(
    refs: frozenset[str] = REFS, markers: frozenset[str] = frozenset({":", "c"})
) -> SeriesFilter:
    return SeriesFilter(series_refs=refs, missing_markers=markers)


def _jsonable(out: ParseOutput) -> dict[str, Any]:
    def conv(o: object) -> object:
        if isinstance(o, Decimal):
            return str(o)
        if isinstance(o, date | datetime):
            return o.isoformat()
        raise TypeError(type(o))

    from dataclasses import asdict

    return json.loads(json.dumps(asdict(out), default=conv, sort_keys=True))


def test_golden_output() -> None:
    out = jsonstat_v1.parse(_raw(), _filter())
    assert _jsonable(out) == json.loads(GOLDEN.read_text())


def test_ac_ing_1_parse_twice_identical() -> None:
    assert jsonstat_v1.parse(_raw(), _filter()) == jsonstat_v1.parse(_raw(), _filter())


def test_sidecar_matches_bytes_and_resolves() -> None:
    side = yaml.safe_load(SIDECAR.read_text())
    assert side["sha256"] == hashlib.sha256(RAW.read_bytes()).hexdigest()
    assert side["synthetic"] is True
    for key in ("source_url", "fetched_on", "licence"):
        assert side[key]
    assert callable(registry.resolve(side["parser_id"]))


def test_text_preserving_decimals_and_published_decimals() -> None:
    out = jsonstat_v1.parse(_raw(), _filter())
    de = [o for o in out.observations if o.series_ref.endswith(".DE")]
    assert [str(o.value) for o in de] == ["3.10", "3.2", "3.25"]
    meta = {m.series_ref: m for m in out.metas}
    assert meta["M.SA.TOTAL.PC_ACT.T.DE"].published_decimals == 2
    assert meta["M.SA.TOTAL.PC_ACT.T.ES"].published_decimals == 1


def test_status_flags_and_periods() -> None:
    out = jsonstat_v1.parse(_raw(), _filter())
    last_de = next(
        o for o in out.observations if o.series_ref.endswith(".DE") and o.value == Decimal("3.25")
    )
    assert last_de.value_status == "PROV"
    assert last_de.source_flags == "p"
    assert (last_de.ref_period_start, last_de.ref_period_end) == (
        date(2026, 8, 1),
        date(2026, 8, 31),
    )


def test_ac_ing_17_declared_marker_is_miss_undeclared_is_rejected() -> None:
    out = jsonstat_v1.parse(_raw(), _filter())
    miss = [o for o in out.observations if o.value_status == "MISS"]
    assert {(o.series_ref[-2:], o.source_flags) for o in miss} == {("FR", ":"), ("ES", "c")}
    assert all(o.value is None for o in miss)
    assert [(r.series_ref[-2:], r.raw_value) for r in out.rejected] == [("ES", "n/a")]
    assert out.rejected[0].reason.startswith("PARSE-03")


def test_without_declared_markers_colon_is_rejected_not_miss() -> None:
    out = jsonstat_v1.parse(_raw(), _filter(markers=frozenset()))
    assert not [o for o in out.observations if o.value_status == "MISS"]
    assert {r.raw_value for r in out.rejected} == {":", "n/a"}


def test_series_filter_honoured() -> None:
    out = jsonstat_v1.parse(_raw(), _filter(frozenset({"M.SA.TOTAL.PC_ACT.T.DE"})))
    assert {m.series_ref for m in out.metas} == {"M.SA.TOTAL.PC_ACT.T.DE"}
    assert {o.series_ref for o in out.observations} == {"M.SA.TOTAL.PC_ACT.T.DE"}


def test_discover_emits_metas_without_observations_for_unmapped() -> None:
    out = jsonstat_v1.parse(
        _raw(), SeriesFilter(series_refs=frozenset({"M.SA.TOTAL.PC_ACT.T.DE"}), discover=True)
    )
    assert len(out.metas) == 3
    assert {o.series_ref for o in out.observations} == {"M.SA.TOTAL.PC_ACT.T.DE"}


def test_meta_fields() -> None:
    m = jsonstat_v1.parse(_raw(), _filter()).metas[0]
    assert (m.entity_code, m.frequency, m.unit_code, m.seasonal_adjustment) == (
        "DE",
        "M",
        "PC_ACT",
        "SA",
    )
    assert out_updated() == "2026-10-30T11:00:00+0100"


def out_updated() -> str | None:
    return jsonstat_v1.parse(_raw(), _filter()).source_updated


def test_structure_drift_is_parse_error() -> None:
    doc = json.loads(RAW.read_text())
    del doc["size"]
    with pytest.raises(ParseError, match="PARSE-01"):
        jsonstat_v1.parse(_raw(json.dumps(doc).encode()), _filter())
    with pytest.raises(ParseError, match="PARSE-01"):
        jsonstat_v1.parse(_raw(b"<html>"), _filter())


def test_unparseable_period_is_rejected_row() -> None:
    doc = json.loads(RAW.read_text())
    doc["dimension"]["time"]["category"]["index"] = {"2026-06": 0, "2026-S1": 1, "2026-08": 2}
    out = jsonstat_v1.parse(_raw(json.dumps(doc).encode()), _filter())
    assert any(r.reason.startswith("PARSE-02") and r.period == "2026-S1" for r in out.rejected)


def test_period_frequency_mismatch_is_rejected() -> None:
    doc = json.loads(RAW.read_text())
    doc["dimension"]["time"]["category"]["index"] = {"2026": 0, "2026-07": 1, "2026-08": 2}
    out = jsonstat_v1.parse(_raw(json.dumps(doc).encode()), _filter())
    assert any(r.period == "2026" and "is not M" in r.reason for r in out.rejected)


@pytest.mark.parametrize("parser_id", sorted(RELEASED_IDS))
def test_ac_ing_11_released_ids_resolve(parser_id: str) -> None:
    assert callable(registry.resolve(parser_id))
    assert parser_id in registry.RELEASED_PARSERS


def test_ac_ing_11_released_ids_cannot_be_removed() -> None:
    assert set(registry.RELEASED_PARSERS) >= RELEASED_IDS


def test_unknown_parser_id_fails() -> None:
    with pytest.raises(registry.UnknownParserError):
        registry.resolve("nope@1")


def test_every_fixture_sidecar_parser_id_resolves() -> None:
    for side in (FIX / "raw").rglob("*.meta.yaml"):
        pid = yaml.safe_load(side.read_text()).get("parser_id")
        if pid:
            registry.resolve(pid)
