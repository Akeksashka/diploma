"""``config-report``: coverage of (indicator, entity) pairs and the gates built on it.

Sources: docs/specs/source-config-schema.md section 4 (seeding coverage report, AC-CFG-5),
indicator-parameters spec (AC-PAR-7, AC-PAR-8), ADR-018 (pending versus mapped).

A pair counts as *mapped* only when a ``headline`` map entry exists whose series is already
known (``SyncReport.mapped``). Entries whose series has not been seen yet (``SyncReport.pending``)
are reported separately and never count as mapped. ``known_gap`` pairs are supplied by the caller.
The module is pure except :func:`classify_entries` and :func:`db_param_mismatches`.
"""

from __future__ import annotations

import json
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import psycopg

from macro_monitor.registry.indicators import IndicatorsConfig
from macro_monitor.registry.sync import LoadedConfig, MapEntry, SyncReport

Pair = tuple[str, str]  # (indicator_id, entity_id)


@dataclass(frozen=True)
class IndicatorCoverage:
    indicator: str
    priority: str
    review_status: str
    expected: int
    mapped: int  # headline entry with a known series
    pending: tuple[str, ...]  # entities with a pending headline and no mapped headline
    fallback_only: tuple[str, ...]  # entities with a mapped fallback and no headline (any state)
    known_gap: tuple[str, ...]
    unmapped: tuple[str, ...]  # nothing mapped, pending, fallback or known_gap
    #: entities whose only map entries belong to a disabled group (rule 45); never mapped
    disabled: tuple[str, ...] = ()

    @property
    def mapped_share(self) -> float:
        return self.mapped / self.expected if self.expected else 1.0


@dataclass(frozen=True)
class ConfigReport:
    indicators: tuple[IndicatorCoverage, ...]
    proposed: tuple[str, ...]
    #: (indicator, entity) of ``known_gap`` entries that match no expected pair.
    stray_gaps: tuple[Pair, ...] = field(default=())

    @property
    def n_proposed(self) -> int:
        return len(self.proposed)

    def by_id(self, indicator_id: str) -> IndicatorCoverage:
        for c in self.indicators:
            if c.indicator == indicator_id:
                return c
        raise KeyError(indicator_id)

    def core(self) -> tuple[IndicatorCoverage, ...]:
        return tuple(c for c in self.indicators if c.priority == "core")

    def pending_total(self) -> int:
        return sum(len(c.pending) for c in self.indicators)

    def disabled_total(self) -> int:
        return sum(len(c.disabled) for c in self.indicators)

    def launch_ready(self) -> bool:
        """AC-CFG-5: every core pair is mapped or a ``known_gap`` (pending is not mapped)."""
        return all(c.mapped + len(c.known_gap) == c.expected for c in self.core())

    def baseline(self) -> dict[str, dict[str, int]]:
        """Counts to store as the 'previous report' for :func:`coverage_regressions`."""
        return {
            c.indicator: {"mapped": c.mapped, "known_gap": len(c.known_gap)}
            for c in self.indicators
        }

    def to_json(self) -> str:
        return json.dumps(
            {
                "indicators": [
                    {
                        "indicator": c.indicator,
                        "priority": c.priority,
                        "expected": c.expected,
                        "mapped": c.mapped,
                        "mapped_share": round(c.mapped_share, 4),
                        "pending": list(c.pending),
                        "fallback_only": list(c.fallback_only),
                        "known_gap": list(c.known_gap),
                        "unmapped": list(c.unmapped),
                        "disabled": list(c.disabled),
                    }
                    for c in self.indicators
                ],
                "n_proposed": self.n_proposed,
                "proposed": list(self.proposed),
                "pending_total": self.pending_total(),
                "disabled_total": self.disabled_total(),
                "launch_ready": self.launch_ready(),
            },
            indent=2,
            sort_keys=True,
        )

    def to_text(self) -> str:
        lines = [
            f"{'indicator':10}{'prio':6}{'expected':>9}{'mapped':>8}{'share':>8}"
            f"{'pending':>9}{'fb_only':>8}{'gap':>5}{'unmapped':>9}{'disabled':>9}"
        ]
        for c in self.indicators:
            lines.append(
                f"{c.indicator:10}{c.priority:6}{c.expected:>9}{c.mapped:>8}"
                f"{c.mapped_share:>8.1%}{len(c.pending):>9}{len(c.fallback_only):>8}"
                f"{len(c.known_gap):>5}{len(c.unmapped):>9}{len(c.disabled):>9}"
            )
        lines.append(f"pending entries (not counted as mapped): {self.pending_total()}")
        lines.append(f"disabled-group entries (not counted as mapped): {self.disabled_total()}")
        lines.append(f"core pairs mapped or known_gap: {'yes' if self.launch_ready() else 'no'}")
        lines.append(f"proposed indicators: {self.n_proposed}")
        lines.extend(f"  {i}" for i in self.proposed)
        if self.stray_gaps:
            lines.append("known_gap entries matching no expected pair:")
            lines.extend(f"  {i}/{e}" for i, e in self.stray_gaps)
        return "\n".join(lines)


def expected_pairs(cfg: LoadedConfig) -> dict[str, tuple[str, ...]]:
    """Entities each indicator is expected to cover: ranked countries, or the global entities."""
    ents = cfg.entities["entities"]
    countries = tuple(sorted(e["id"] for e in ents if e["kind"] == "country" and e["is_ranked"]))
    globals_ = tuple(sorted(e["id"] for e in ents if e["is_global"]))
    return {
        i.id: globals_ if i.values["scope"] == "global" else countries
        for i in cfg.indicators.indicators
    }


def _as_set(known_gaps: Iterable[Pair]) -> frozenset[Pair]:
    return frozenset(known_gaps)


def build_report(
    cfg: LoadedConfig,
    *,
    mapped: Sequence[MapEntry],
    pending: Sequence[MapEntry],
    known_gaps: Iterable[Pair] = (),
) -> ConfigReport:
    """Coverage per indicator. ``mapped``/``pending`` are ``SyncReport.mapped``/``.pending``."""
    gaps = _as_set(known_gaps)
    exp = expected_pairs(cfg)
    # rule 45: entries of a disabled group are neither mapped nor pending
    off = cfg.sources.effective_group_enabled
    dis = {
        (e.indicator, e.entity)
        for e in (*mapped, *pending)
        if not off.get((e.source_id, e.group_id), True)
    }
    mapped = [e for e in mapped if off.get((e.source_id, e.group_id), True)]
    pending = [e for e in pending if off.get((e.source_id, e.group_id), True)]
    m_head = {(e.indicator, e.entity) for e in mapped if e.role == "headline"}
    m_fb = {(e.indicator, e.entity) for e in mapped if e.role == "fallback"}
    p_head = {(e.indicator, e.entity) for e in pending if e.role == "headline"}
    p_fb = {(e.indicator, e.entity) for e in pending if e.role == "fallback"}
    out: list[IndicatorCoverage] = []
    all_expected: set[Pair] = set()
    for r in cfg.indicators.indicators:
        n_map = 0
        pend: list[str] = []
        fb: list[str] = []
        gap: list[str] = []
        unm: list[str] = []
        dsb: list[str] = []
        for ent in exp[r.id]:
            pair = (r.id, ent)
            all_expected.add(pair)
            if pair in gaps:
                gap.append(ent)
            elif pair in m_head:
                n_map += 1
            elif pair in p_head:
                pend.append(ent)
            elif pair in m_fb:
                fb.append(ent)
            elif pair in p_fb:
                pend.append(ent)
            elif pair in dis:
                dsb.append(ent)
            else:
                unm.append(ent)
        # a mapped fallback next to a headline-less pair is "fallback only" even if headline pends
        fb += [e for e in pend if (r.id, e) in m_fb]
        out.append(
            IndicatorCoverage(
                indicator=r.id,
                priority=str(r.values["priority"]),
                review_status=str(r.review.get("status")),
                expected=len(exp[r.id]),
                mapped=n_map,
                pending=tuple(pend),
                fallback_only=tuple(sorted(set(fb))),
                known_gap=tuple(gap),
                unmapped=tuple(unm),
                disabled=tuple(dsb),
            )
        )
    stray = tuple(sorted(p for p in gaps if p not in all_expected))
    return ConfigReport(tuple(out), cfg.indicators.proposed(), stray)


def report_from_sync(
    cfg: LoadedConfig, rep: SyncReport, known_gaps: Iterable[Pair] = ()
) -> ConfigReport:
    return build_report(cfg, mapped=rep.mapped, pending=rep.pending, known_gaps=known_gaps)


def classify_entries(
    conn: psycopg.Connection, entries: Iterable[MapEntry]
) -> tuple[list[MapEntry], list[MapEntry]]:
    """Read-only split of entries into (mapped, pending) by whether ``ref.series`` knows the key.

    Same lookup as ``sync-config`` (ADR-018); writes nothing.
    """
    mapped: list[MapEntry] = []
    pending: list[MapEntry] = []
    for e in entries:
        row = conn.execute(
            "SELECT 1 FROM ref.series WHERE source_id = %s AND dataset_id = %s "
            "AND series_key = %s LIMIT 1",
            [e.source_id, e.dataset, e.key],
        ).fetchone()
        (mapped if row else pending).append(e)
    return mapped, pending


def coverage_regressions(
    report: ConfigReport, previous: Mapping[str, Mapping[str, int]]
) -> list[str]:
    """AC-CFG-5 gate: core indicators whose mapped count fell without matching new ``known_gap``.

    ``previous`` is :meth:`ConfigReport.baseline` of the earlier report. Empty list means pass.
    Callers run this warn-only until T63.
    """
    out: list[str] = []
    for c in report.core():
        prev = previous.get(c.indicator)
        if prev is None:
            continue
        drop = prev["mapped"] - c.mapped
        gap_increase = len(c.known_gap) - prev.get("known_gap", 0)
        if drop > 0 and gap_increase < drop:
            out.append(
                f"{c.indicator}: mapped pairs {prev['mapped']} -> {c.mapped} "
                f"without matching known_gap entries (+{max(gap_increase, 0)})"
            )
    return out


def proposed_core_gate(
    indicators: IndicatorsConfig, *, accepted_by_user: bool = False
) -> list[str]:
    """AC-PAR-7: core indicators still ``proposed``; non-empty fails the production workflow.

    ``accepted_by_user`` is True only when the user recorded the acceptance in the decision list.
    """
    if accepted_by_user:
        return []
    return [
        i.id
        for i in indicators.indicators
        if i.values["priority"] == "core" and i.review.get("status") == "proposed"
    ]


def db_param_mismatches(
    conn: psycopg.Connection, indicators: IndicatorsConfig, ids: Collection[str] | None = None
) -> list[str]:
    """AC-PAR-8: ``ref.indicator`` stationarity_class / release_lag_aware vs resolved values."""
    rows: dict[str, tuple[Any, Any]] = {
        str(i): (s, r)
        for i, s, r in conn.execute(
            "SELECT indicator_id, stationarity_class, release_lag_aware FROM ref.indicator"
        ).fetchall()
    }
    out: list[str] = []
    for r in indicators.indicators:
        if ids is not None and r.id not in ids:
            continue
        want = (r.values["stationarity_class"], bool(r.values["release_lag_aware"]))
        got = rows.get(r.id)
        if got != want:
            out.append(f"{r.id}: database {got} != resolved {want}")
    return out
