"""T33: config-report (AC-CFG-5, AC-PAR-7, AC-PAR-8 helpers; ADR-018 pending accounting)."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from macro_monitor.registry.report import (
    build_report,
    classify_entries,
    coverage_regressions,
    db_param_mismatches,
    expected_pairs,
    proposed_core_gate,
)
from macro_monitor.registry.sync import LoadedConfig, MapEntry, load_config

ROOT = Path(__file__).resolve().parents[3]

pytestmark = pytest.mark.unit


@pytest.fixture(scope="module")
def cfg() -> LoadedConfig:
    return load_config(ROOT)


def eurostat_entries(cfg: LoadedConfig) -> tuple[MapEntry, ...]:
    """The first three M09 headline entries of eurostat_labour (the group now maps 28 countries)."""
    return tuple(e for e in cfg.map_entries if e.group_id == "eurostat_labour")[:3]


def entry(base: MapEntry, **kw: str) -> MapEntry:
    return dataclasses.replace(base, **kw)


def test_pending_not_counted_as_mapped(cfg: LoadedConfig) -> None:
    euro = eurostat_entries(cfg)
    e = euro[0]
    rep = build_report(cfg, mapped=[], pending=list(euro))
    c = rep.by_id(e.indicator)
    assert c.mapped == 0
    assert c.mapped_share == 0.0
    assert e.entity in c.pending
    assert e.entity not in c.unmapped
    assert rep.pending_total() == len(euro) == 3
    assert not rep.launch_ready()


def test_mapped_headline_counted_and_pending_split(cfg: LoadedConfig) -> None:
    a, b, _ = eurostat_entries(cfg)
    rep = build_report(cfg, mapped=[a], pending=[b])
    c = rep.by_id(a.indicator)
    assert c.mapped == 1
    assert c.pending == (b.entity,)
    assert c.mapped_share == pytest.approx(1 / c.expected)
    assert len(c.unmapped) == c.expected - 2


def test_fallback_only_and_known_gap(cfg: LoadedConfig) -> None:
    a = eurostat_entries(cfg)[0]
    fb = entry(a, role="fallback", entity="JPN")
    rep = build_report(cfg, mapped=[fb], pending=[], known_gaps=[(a.indicator, "USA")])
    c = rep.by_id(a.indicator)
    assert c.fallback_only == ("JPN",)
    assert c.mapped == 0
    assert c.known_gap == ("USA",)
    assert "JPN" not in c.unmapped
    assert "USA" not in c.unmapped


def test_known_gap_for_unexpected_pair_is_stray(cfg: LoadedConfig) -> None:
    rep = build_report(cfg, mapped=[], pending=[], known_gaps=[("M09", "EU27")])
    assert rep.stray_gaps == (("M09", "EU27"),)


def test_launch_ready_when_all_core_mapped_or_gap(cfg: LoadedConfig) -> None:
    exp = expected_pairs(cfg)
    gaps = [
        (i.id, e)
        for i in cfg.indicators.indicators
        if i.values["priority"] == "core"
        for e in exp[i.id]
    ]
    assert build_report(cfg, mapped=[], pending=[], known_gaps=gaps).launch_ready()


def test_global_scope_expects_global_entities(cfg: LoadedConfig) -> None:
    exp = expected_pairs(cfg)
    glob = [i.id for i in cfg.indicators.indicators if i.values["scope"] == "global"]
    assert glob
    assert all(exp[g] == ("WLD",) for g in glob)
    assert "EU27" not in exp["M09"]
    assert len(exp["M09"]) == 42


def test_regression_gate(cfg: LoadedConfig) -> None:
    a, b, c3 = eurostat_entries(cfg)
    before = build_report(cfg, mapped=[a, b, c3], pending=[])
    prev = before.baseline()
    after = build_report(cfg, mapped=[a], pending=[])
    msgs = coverage_regressions(after, prev)
    assert len(msgs) == 1
    assert a.indicator in msgs[0]
    gaps = [(a.indicator, b.entity), (a.indicator, c3.entity)]
    ok = build_report(cfg, mapped=[a], pending=[], known_gaps=gaps)
    assert coverage_regressions(ok, prev) == []
    assert coverage_regressions(before, prev) == []


def test_proposed_count_and_gate(cfg: LoadedConfig) -> None:
    rep = build_report(cfg, mapped=[], pending=[])
    assert rep.n_proposed == len(cfg.indicators.indicators)  # every row is proposed in v1
    gate = proposed_core_gate(cfg.indicators)
    assert gate
    assert all(cfg.indicators.by_id(i).values["priority"] == "core" for i in gate)
    assert proposed_core_gate(cfg.indicators, accepted_by_user=True) == []


def test_output_formats(cfg: LoadedConfig) -> None:
    rep = build_report(cfg, mapped=[], pending=list(eurostat_entries(cfg)))
    data = json.loads(rep.to_json())
    assert data["pending_total"] == 3
    assert data["launch_ready"] is False
    text = rep.to_text()
    assert "pending entries (not counted as mapped): 3" in text
    assert "M09" in text


class FakeConn:
    def __init__(self, known: set[str], rows: list[tuple[str, str, bool]] | None = None) -> None:
        self.known, self.rows, self.last = known, rows or [], ""

    def execute(self, sql: str, params: list[str] | None = None) -> FakeConn:
        self.last = sql
        self.params = params
        return self

    def fetchone(self) -> tuple[int] | None:
        assert self.params
        return (1,) if self.params[2] in self.known else None

    def fetchall(self) -> list[tuple[str, str, bool]]:
        return self.rows


def test_classify_entries(cfg: LoadedConfig) -> None:
    a, b, c3 = eurostat_entries(cfg)
    conn = FakeConn({a.key})
    m, p = classify_entries(conn, eurostat_entries(cfg))  # type: ignore[arg-type]
    assert m == [a]
    assert p == [b, c3]


def test_db_param_mismatches(cfg: LoadedConfig) -> None:
    rows = [
        (i.id, str(i.values["stationarity_class"]), bool(i.values["release_lag_aware"]))
        for i in cfg.indicators.indicators
    ]
    assert db_param_mismatches(FakeConn(set(), rows), cfg.indicators) == []  # type: ignore[arg-type]
    bad = [(rows[0][0], "stationary" if rows[0][1] != "stationary" else "trending_level", False)]
    out = db_param_mismatches(FakeConn(set(), bad + rows[1:]), cfg.indicators)  # type: ignore[arg-type]
    assert len(out) == 1
    assert rows[0][0] in out[0]
