"""Check registry, severity policy and the RAW, PARSE, META and SEM checks (ADR-007).

Catalogue and default thresholds: docs/specs/validation-monitoring-spec.md section 1. Every check
is a pure function of plain inputs and returns ``CheckResult`` values; nothing here touches the
database, the network or a clock, and no DataFrame ever appears in a signature (ADR-016).

Result convention: a passing result has severity ``info``; a failing result carries the severity
of the policy level it tripped (``warn`` or ``error``). A result has a scope: ``object`` errors
block the load of the raw object, ``series`` errors skip the named series only (spec: "series
skipped").
"""

from __future__ import annotations

import itertools
import re
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Literal

from macro_monitor.ingestion.base import ParseOutput
from macro_monitor.models.enums import Frequency
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta
from macro_monitor.validation import contracts

Scope = Literal["object", "series"]


class Severity(StrEnum):
    INFO = "info"
    WARN = "warn"
    ERROR = "error"


@dataclass(frozen=True)
class CheckSpec:
    check_id: str
    layer: str
    summary: str
    scope: Scope = "object"


def _spec(check_id: str, layer: str, summary: str, scope: Scope = "object") -> CheckSpec:
    return CheckSpec(check_id, layer, summary, scope)


CHECKS: dict[str, CheckSpec] = {
    s.check_id: s
    for s in (
        _spec("RAW-01", "raw", "HTTP status 2xx (or 304 when validators were sent)"),
        _spec("RAW-02", "raw", "body non-empty and at least the group minimum"),
        _spec("RAW-03", "raw", "bot-challenge signature"),
        _spec("RAW-04", "raw", "content type matches the expected format"),
        _spec("RAW-05", "raw", "size change versus the previous raw object"),
        _spec("RAW-06", "raw", "sha256 recorded and blob resolvable"),
        _spec("RAW-07", "raw", "robots decision recorded and not disallowed"),
        _spec("PARSE-01", "parse", "required columns and fields present"),
        _spec("PARSE-02", "parse", "periods parse and match the series frequency", "series"),
        _spec("PARSE-03", "parse", "values numeric or a declared missing marker"),
        _spec("PARSE-04", "parse", "no duplicate (series_ref, period) in one raw object"),
        _spec("PARSE-05", "parse", "rejected share of rows (MISS rows are not rejected)"),
        _spec("META-01", "meta", "entity, frequency, unit, seasonal adjustment non-null", "series"),
        _spec("META-02", "meta", "published metadata equals the series-map expectation", "series"),
        _spec("META-03", "meta", "entity code resolves to ref.entity", "series"),
        _spec("META-04", "meta", "known_at and raw_id present on every inserted observation"),
        _spec("META-05", "meta", "clock skew of known_at versus the database clock"),
        _spec("SEM-01", "semantic", "value within indicator bounds"),
        _spec("SEM-02", "semantic", "jump versus own history"),
        _spec("SEM-03", "semantic", "unit sanity versus previous vintage", "series"),
        _spec("SEM-04", "semantic", "new period gaps inside a series span"),
        _spec("ORD-01", "load order", "series of a raw object skipped as out of order", "series"),
        _spec("ORD-02", "load order", "raw object held behind an unloaded predecessor"),
        _spec("ORD-03", "load order", "older edition of an edition_ordered group not loaded"),
        _spec("REV-01", "revision", "share of existing keys with a material revision"),
        _spec("REV-02", "revision", "single revision magnitude (robust sd or relative)"),
        _spec("REV-03", "revision", "revision depth"),
        _spec("REV-04", "revision", "projection to observed transition"),
        _spec("REV-05", "revision", "float-noise differences suppressed by the comparison rule"),
        _spec("REV-06", "revision", "re-estimating group: material revisions vs max_revised_rows"),
        _spec("REV-07", "revision", "named-edition group: material revision share (report only)"),
        _spec("COMP-01", "completeness", "series returned versus expected_series_min"),
        _spec("COMP-02", "completeness", "coverage versus the previous load of the request"),
        _spec("COMP-03", "completeness", "tombstone volume"),
        _spec("COMP-04", "completeness", "mapped series not seen in a complete fetch"),
        _spec("DB-04", "database", "invariant sample: known_at monotone, series metadata"),
        _spec("DB-05", "database", "rows to insert for one raw object"),
    )
}


@dataclass(frozen=True)
class Thresholds:
    """Defaults of the catalogue; per-group overrides construct a modified copy.

    Every evaluated value is stored in ``ops.validation_result.threshold`` (and the whole set can
    be recorded with ``as_dict``) so that a run is reproducible.
    """

    size_ratio_low: float = 0.5  # RAW-05
    size_ratio_high: float = 3.0
    parse_reject_warn: float = 0.01  # PARSE-05
    parse_reject_error: float = 0.05
    clock_skew_warn_s: float = 60.0  # META-05
    clock_skew_error_s: float = 300.0
    jump_robust_sd: float = 8.0  # SEM-02
    jump_window: int = 60
    jump_min_changes: int = 10
    unit_factor: float = 10.0  # SEM-03
    rev_mass_share: float = 0.20  # REV-01
    rev_robust_sd: float = 5.0  # REV-02
    rev_relative: float = 0.25
    rev_min_history: int = 10
    rev_depth_years_mq: int = 5  # REV-03
    rev_depth_years_a: int = 10
    comp_drop_share: float = 0.05  # COMP-02
    comp_tombstone_share: float = 0.05  # COMP-03
    max_insert_rows_per_load: int = 100_000  # DB-05

    def as_dict(self) -> dict[str, float | int]:
        return asdict(self)


DEFAULT_THRESHOLDS = Thresholds()

DEFAULT_CHALLENGE_MARKERS = (
    "just a moment",
    "cf-chl",
    "challenge-platform",
    "captcha",
    "attention required",
    "checking your browser",
)


@dataclass(frozen=True)
class DriftProposal:
    """A candidate ``ops.drift_event`` raised by a check (writing it is the loader's job)."""

    series_ref: str
    kind: str  # ops.drift_event.kind
    old: str | None
    new: str | None


@dataclass(frozen=True)
class RejectedItem:
    """A row for ``staging.rejected`` (reason_code is the check id, for example PARSE-03)."""

    series_ref: str | None
    ref_period: str | None
    raw_value: str | None
    reason_code: str
    detail: str


@dataclass(frozen=True)
class CheckResult:
    check_id: str
    severity: Severity
    passed: bool
    metric: float | None = None
    threshold: float | None = None
    subject: str | None = None
    detail: Mapping[str, object] = field(default_factory=dict)
    skipped_series: tuple[str, ...] = ()
    suspects: tuple[tuple[str, date], ...] = ()  # (series_ref, ref_period_start) to flag suspect
    drifts: tuple[DriftProposal, ...] = ()
    rejected: tuple[RejectedItem, ...] = ()

    @property
    def scope(self) -> Scope:
        return CHECKS[self.check_id].scope

    @property
    def blocks(self) -> bool:
        """True when this result stops the load of the whole raw object."""
        return not self.passed and self.severity is Severity.ERROR and self.scope == "object"


def _result(
    check_id: str,
    passed: bool,
    fail_severity: Severity,
    **kw: object,
) -> CheckResult:
    if check_id not in CHECKS:
        raise KeyError(check_id)
    return CheckResult(
        check_id=check_id,
        severity=Severity.INFO if passed else fail_severity,
        passed=passed,
        **kw,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------------------
# severity policy
# ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Verdict:
    """Policy outcome for one raw object (ADR-007: error blocks, warn loads and alerts)."""

    blocked: bool
    blocking: tuple[str, ...]
    warnings: tuple[str, ...]
    skipped_series: frozenset[str]
    suspects: frozenset[tuple[str, date]]
    rejected: tuple[RejectedItem, ...]


def decide(results: Iterable[CheckResult]) -> Verdict:
    rs = list(results)
    blocking = tuple(sorted({r.check_id for r in rs if r.blocks}))
    warnings = tuple(
        sorted(
            {
                r.check_id
                for r in rs
                if (not r.passed and r.severity is Severity.WARN)
                or (not r.passed and r.severity is Severity.ERROR and not r.blocks)
            }
        )
    )
    return Verdict(
        blocked=bool(blocking),
        blocking=blocking,
        warnings=warnings,
        skipped_series=frozenset(s for r in rs for s in r.skipped_series),
        suspects=frozenset(s for r in rs for s in r.suspects),
        rejected=tuple(x for r in rs for x in r.rejected),
    )


# ---------------------------------------------------------------------------------------
# RAW
# ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class RawFacts:
    """What the manifest and the fetch know about one raw object (ingest.raw_object / blob)."""

    http_status: int
    body_len: int
    body_head: bytes = b""  # first bytes of the body, for the challenge signature only
    validators_sent: bool = False
    min_bytes: int = 1
    content_type: str | None = None
    expected_content_types: frozenset[str] = frozenset()
    prev_byte_count: int | None = None
    sha256: str | None = None
    storage_backend: str | None = None  # raw_blob.storage_backend
    storage_ref: str | None = None
    blob_present: bool = False  # the stored asset resolves (or already existed)
    robots_decision: str | None = None
    challenge_markers: tuple[str, ...] = DEFAULT_CHALLENGE_MARKERS


_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_ROBOTS_BLOCKING = frozenset({"disallowed", "unreadable", "skipped_review"})


def check_raw_01(f: RawFacts) -> CheckResult:
    ok = 200 <= f.http_status < 300 or (f.http_status == 304 and f.validators_sent)
    return _result("RAW-01", ok, Severity.ERROR, metric=float(f.http_status))


def check_raw_02(f: RawFacts) -> CheckResult:
    floor = max(1, f.min_bytes)
    return _result(
        "RAW-02", f.body_len >= floor, Severity.ERROR, metric=float(f.body_len), threshold=floor
    )


def check_raw_03(f: RawFacts) -> CheckResult:
    head = f.body_head.lower()
    hit = f.http_status in (403, 503) and any(
        m.lower().encode() in head for m in f.challenge_markers
    )
    return _result("RAW-03", not hit, Severity.ERROR, detail={"blocked": hit})


def check_raw_04(f: RawFacts) -> CheckResult:
    if not f.expected_content_types:
        return _result("RAW-04", True, Severity.ERROR, detail={"expected": "unconfigured"})
    seen = (f.content_type or "").split(";")[0].strip().lower()
    ok = seen in {c.lower() for c in f.expected_content_types}
    return _result("RAW-04", ok, Severity.ERROR, detail={"content_type": seen})


def check_raw_05(f: RawFacts, t: Thresholds = DEFAULT_THRESHOLDS) -> CheckResult:
    if not f.prev_byte_count:
        return _result("RAW-05", True, Severity.WARN, detail={"previous": "none"})
    ratio = f.body_len / f.prev_byte_count
    ok = t.size_ratio_low <= ratio <= t.size_ratio_high
    return _result(
        "RAW-05",
        ok,
        Severity.WARN,
        metric=ratio,
        threshold=t.size_ratio_low if ratio < t.size_ratio_low else t.size_ratio_high,
    )


def check_raw_06(f: RawFacts) -> CheckResult:
    hashed = f.sha256 is not None and _SHA256.match(f.sha256) is not None
    if f.storage_backend == "none":  # archive: hash_only
        ok = hashed
    else:
        ok = hashed and bool(f.storage_ref) and f.blob_present
    return _result("RAW-06", ok, Severity.ERROR, detail={"storage_backend": f.storage_backend})


def check_raw_07(f: RawFacts) -> CheckResult:
    d = f.robots_decision
    ok = d is not None and d not in _ROBOTS_BLOCKING
    return _result("RAW-07", ok, Severity.ERROR, detail={"decision": d})


def check_raw(f: RawFacts, t: Thresholds = DEFAULT_THRESHOLDS) -> list[CheckResult]:
    return [
        check_raw_01(f),
        check_raw_02(f),
        check_raw_03(f),
        check_raw_04(f),
        check_raw_05(f, t),
        check_raw_06(f),
        check_raw_07(f),
    ]


# ---------------------------------------------------------------------------------------
# PARSE
# ---------------------------------------------------------------------------------------


def _cap(items: Iterable[str], n: int = 20) -> list[str]:
    return sorted(set(items))[:n]


def _period_label(o: ParsedObservation) -> str:
    return o.ref_period_start.isoformat()


def check_parse(
    output: ParseOutput,
    *,
    frequencies: Mapping[str, str] | None = None,
    calendar_bases: Mapping[str, str] | None = None,
    missing_markers: frozenset[str] | None = None,
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> list[CheckResult]:
    """PARSE-01..05 on a parser output. Rejected rows are the parser's plus the contract's."""
    report = contracts.validate_observation_rows(
        contracts.observation_rows(output.observations),
        frequencies=frequencies,
        calendar_bases=calendar_bases,
        missing_markers=missing_markers,
    )
    parser_rejects = [
        RejectedItem(
            r.series_ref,
            r.period,
            r.raw_value,
            r.reason.split(":", 1)[0].strip() if ":" in r.reason else "PARSE-03",
            r.reason,
        )
        for r in output.rejected
    ]
    results: list[CheckResult] = []

    f01 = report.for_check("PARSE-01")
    results.append(
        _result(
            "PARSE-01",
            not f01,
            Severity.ERROR,
            metric=float(len(f01)),
            detail={"failures": [f.message for f in f01[:20]]},
        )
    )

    f02 = report.for_check("PARSE-02")
    p02_parser = [r for r in parser_rejects if r.reason_code == "PARSE-02"]
    bad02 = {f.series_ref for f in f02 if f.series_ref} | {
        r.series_ref for r in p02_parser if r.series_ref
    }
    results.append(
        _result(
            "PARSE-02",
            not (f02 or p02_parser),
            Severity.ERROR,
            metric=float(len(f02) + len(p02_parser)),
            detail={"series": _cap(bad02)},
            skipped_series=tuple(sorted(bad02)),
            rejected=tuple(
                RejectedItem(f.series_ref, f.ref_period, f.raw_value, "PARSE-02", f.message)
                for f in f02
            )
            + tuple(p02_parser),
        )
    )

    f03 = report.for_check("PARSE-03")
    p03_parser = [r for r in parser_rejects if r.reason_code == "PARSE-03"]
    n_miss = sum(1 for o in output.observations if o.value_status == "MISS")
    # PARSE-03 findings are rejected rows (counted, warn); PARSE-05 judges their share.
    results.append(
        _result(
            "PARSE-03",
            not (f03 or p03_parser),
            Severity.WARN,
            metric=float(len(f03) + len(p03_parser)),
            detail={"miss_rows": n_miss, "rejected_by_parser": len(p03_parser)},
            rejected=tuple(
                RejectedItem(f.series_ref, f.ref_period, f.raw_value, "PARSE-03", f.message)
                for f in f03
            )
            + tuple(p03_parser),
        )
    )

    f04 = report.for_check("PARSE-04")
    dup_keys = {(f.series_ref, f.ref_period) for f in f04}
    results.append(
        _result(
            "PARSE-04",
            not f04,
            Severity.ERROR,
            metric=float(len(dup_keys)),
            detail={"duplicates": [f"{s}|{p}" for s, p in sorted(dup_keys, key=str)[:20]]},
        )
    )

    # PARSE-05: rejected share; declared MISS rows are observations, not rejected rows.
    rejected_total = len(parser_rejects) + len(f02) + len(f03)
    total = len(output.observations) + len(parser_rejects)
    share = rejected_total / total if total else 0.0
    if share > thresholds.parse_reject_error:
        sev, thr, ok = Severity.ERROR, thresholds.parse_reject_error, False
    elif share > thresholds.parse_reject_warn:
        sev, thr, ok = Severity.WARN, thresholds.parse_reject_warn, False
    else:
        sev, thr, ok = Severity.INFO, thresholds.parse_reject_warn, True
    results.append(
        CheckResult(
            "PARSE-05",
            sev,
            ok,
            metric=share,
            threshold=thr,
            detail={"rejected": rejected_total, "rows": total, "miss_rows": n_miss},
        )
    )
    return results


def rejected_items(results: Iterable[CheckResult]) -> list[RejectedItem]:
    """All rows destined for ``staging.rejected`` (parser rejects included), de-duplicated."""
    seen: set[RejectedItem] = set()
    out: list[RejectedItem] = []
    for r in results:
        for item in r.rejected:
            if item not in seen:
                seen.add(item)
                out.append(item)
    return out


# ---------------------------------------------------------------------------------------
# META
# ---------------------------------------------------------------------------------------

_META_FIELD_KIND = {
    "unit_code": "unit",
    "unit_mult": "unit",
    "base_period": "base_period",
    "seasonal_adjustment": "seasonal_adjustment",
    "frequency": "frequency",
    "flow_basis": "flow_basis",
    "price_basis": "classification",
    "currency_code": "classification",
    "calendar_basis": "classification",
}


def check_meta_01(
    metas: Sequence[ParsedSeriesMeta], unit_codes: frozenset[str] | None = None
) -> CheckResult:
    report = contracts.validate_meta_rows(contracts.meta_rows(metas), unit_codes=unit_codes)
    bad = {f.series_ref for f in report.failures if f.series_ref}
    return _result(
        "META-01",
        not report.failures,
        Severity.ERROR,
        metric=float(len(report.failures)),
        detail={"series": _cap(bad), "failures": [f.message for f in report.failures[:20]]},
        skipped_series=tuple(sorted(bad)),
    )


def check_meta_02(
    metas: Sequence[ParsedSeriesMeta], expect: Mapping[str, Mapping[str, object]]
) -> CheckResult:
    """Published metadata versus the series-map ``expect`` block (ParsedSeriesMeta names)."""
    drifts: list[DriftProposal] = []
    for m in metas:
        for name, want in expect.get(m.series_ref, {}).items():
            got = getattr(m, name, None)
            if got != want:
                drifts.append(
                    DriftProposal(
                        m.series_ref,
                        _META_FIELD_KIND.get(name, "classification"),
                        None if want is None else str(want),
                        None if got is None else str(got),
                    )
                )
    bad = sorted({d.series_ref for d in drifts})
    return _result(
        "META-02",
        not drifts,
        Severity.ERROR,
        metric=float(len(drifts)),
        detail={"series": bad[:20], "kinds": sorted({d.kind for d in drifts})},
        skipped_series=tuple(bad),
        drifts=tuple(drifts),
    )


def check_meta_03(metas: Sequence[ParsedSeriesMeta], known_entities: frozenset[str]) -> CheckResult:
    bad = sorted({m.series_ref for m in metas if m.entity_code not in known_entities})
    return _result(
        "META-03",
        not bad,
        Severity.ERROR,
        metric=float(len(bad)),
        detail={"series": bad[:20]},
        skipped_series=tuple(bad),
    )


def check_meta_04(raw_id: int | None, known_at: datetime | None, n_rows: int) -> CheckResult:
    """known_at (= raw_object.fetched_at) and raw_id must exist for every row to insert."""
    ok = raw_id is not None and known_at is not None
    return _result(
        "META-04",
        ok,
        Severity.ERROR,
        metric=float(0 if ok else n_rows),
        detail={"raw_id": raw_id is not None, "known_at": known_at is not None},
    )


def check_meta_05(
    fetched_at: datetime, db_now: datetime, thresholds: Thresholds = DEFAULT_THRESHOLDS
) -> CheckResult:
    """``fetched_at`` ahead of the database clock: warn above 60 s, error above 5 min."""
    skew = (fetched_at - db_now).total_seconds()
    if skew > thresholds.clock_skew_error_s:
        sev, thr, ok = Severity.ERROR, thresholds.clock_skew_error_s, False
    elif skew > thresholds.clock_skew_warn_s:
        sev, thr, ok = Severity.WARN, thresholds.clock_skew_warn_s, False
    else:
        sev, thr, ok = Severity.INFO, thresholds.clock_skew_warn_s, True
    return CheckResult("META-05", sev, ok, metric=skew, threshold=thr)


# ---------------------------------------------------------------------------------------
# SEM
# ---------------------------------------------------------------------------------------


def check_sem_01(
    observations: Sequence[ParsedObservation],
    bounds: Mapping[str, tuple[Decimal | None, Decimal | None]],
) -> CheckResult:
    """Values outside the indicator bounds are loaded and flagged ``suspect``."""
    suspects: list[tuple[str, date]] = []
    for o in observations:
        if o.value is None or o.series_ref not in bounds:
            continue
        lo, hi = bounds[o.series_ref]
        if (lo is not None and o.value < lo) or (hi is not None and o.value > hi):
            suspects.append((o.series_ref, o.ref_period_start))
    return _result(
        "SEM-01",
        not suspects,
        Severity.WARN,
        metric=float(len(suspects)),
        detail={"rows": [f"{s}|{p}" for s, p in suspects[:20]]},
        suspects=tuple(suspects),
    )


def _robust_sd(changes: Sequence[float]) -> float:
    med = statistics.median(changes)
    return 1.4826 * statistics.median(abs(c - med) for c in changes)


def check_sem_02(
    new_observations: Sequence[ParsedObservation],
    history: Mapping[str, Sequence[tuple[date, Decimal]]],
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> CheckResult:
    """Jump of a NEW period against the series' own history.

    ``history`` holds the stored (period start, transformed value) pairs per series, ``MISS``
    excluded. Robust sd = 1.4826 * MAD of the first differences of the last ``jump_window``
    observations. A new period is flagged when |value - previous value| exceeds
    ``jump_robust_sd`` robust sds; with fewer than ``jump_min_changes`` differences or a zero
    robust sd the series is not judged (documented gap). Revisions of stored periods are REV's.
    """
    suspects: list[tuple[str, date]] = []
    worst = 0.0
    by_series: dict[str, list[ParsedObservation]] = {}
    for o in new_observations:
        if o.value is not None:
            by_series.setdefault(o.series_ref, []).append(o)
    for ref, rows in by_series.items():
        hist = sorted(history.get(ref, ()))
        window = [float(v) for _, v in hist][-thresholds.jump_window :]
        diffs = [b - a for a, b in itertools.pairwise(window)]
        if len(diffs) < thresholds.jump_min_changes:
            continue
        sd = _robust_sd(diffs)
        if sd <= 0:
            continue
        last_date, last_val = hist[-1][0], float(hist[-1][1])
        for o in sorted(rows, key=lambda r: r.ref_period_start):
            if o.ref_period_start <= last_date or o.value is None:
                continue
            change = abs(float(o.value) - last_val)
            worst = max(worst, change / sd)
            if change > thresholds.jump_robust_sd * sd:
                suspects.append((ref, o.ref_period_start))
            last_date, last_val = o.ref_period_start, float(o.value)
    return _result(
        "SEM-02",
        not suspects,
        Severity.WARN,
        metric=worst,
        threshold=thresholds.jump_robust_sd,
        detail={"rows": [f"{s}|{p}" for s, p in suspects[:20]]},
        suspects=tuple(suspects),
    )


def check_sem_03(
    new_values: Mapping[str, Sequence[Decimal]],
    previous_values: Mapping[str, Sequence[Decimal]],
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> CheckResult:
    """Median of new values within a factor 10 of the previous vintage median (unit change)."""
    drifts: list[DriftProposal] = []
    worst = 1.0
    for ref, new in new_values.items():
        old = previous_values.get(ref)
        if not new or not old:
            continue
        a = abs(float(statistics.median(new)))
        b = abs(float(statistics.median(old)))
        if a == 0 and b == 0:
            continue
        ratio = float("inf") if a == 0 or b == 0 else max(a / b, b / a)
        worst = max(worst, ratio)
        if ratio > thresholds.unit_factor:
            drifts.append(DriftProposal(ref, "unit", f"median {b:g}", f"median {a:g}"))
    bad = sorted(d.series_ref for d in drifts)
    return _result(
        "SEM-03",
        not drifts,
        Severity.ERROR,
        metric=worst,
        threshold=thresholds.unit_factor,
        detail={"series": bad[:20]},
        skipped_series=tuple(bad),
        drifts=tuple(drifts),
    )


def _next_period(freq: Frequency, d: date) -> date:
    if freq is Frequency.A:
        return date(d.year + 1, 1, 1)
    step = 3 if freq is Frequency.Q else 1
    month = d.month - 1 + step
    return date(d.year + month // 12, month % 12 + 1, 1)


def _gaps(freq: Frequency, starts: Iterable[date]) -> set[date]:
    present = sorted(set(starts))
    if len(present) < 2:
        return set()
    have = set(present)
    gaps: set[date] = set()
    cur = present[0]
    while cur < present[-1]:
        cur = _next_period(freq, cur)
        if cur not in have and cur < present[-1]:
            gaps.add(cur)
    return gaps


def check_sem_04(
    periods: Mapping[str, tuple[str, Iterable[date]]],
    previous_periods: Mapping[str, Iterable[date]],
) -> CheckResult:
    """Gaps inside a series span that were not gaps in the previous vintage.

    ``periods`` maps series_ref to (frequency, period starts in this object, ``MISS`` rows
    included because they fill their period). Daily series are not judged (no business calendar
    is specified).
    """
    new_gaps: dict[str, int] = {}
    for ref, (freq_code, starts) in periods.items():
        freq = Frequency(freq_code)
        if freq is Frequency.D:
            continue
        starts = list(starts)
        added = _gaps(freq, starts) - _gaps(freq, previous_periods.get(ref, ()))
        if added:
            new_gaps[ref] = len(added)
    return _result(
        "SEM-04",
        not new_gaps,
        Severity.WARN,
        metric=float(sum(new_gaps.values())),
        detail={"series": dict(sorted(new_gaps.items())[:20])},
    )
