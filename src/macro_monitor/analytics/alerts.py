"""Alerts (analytics spec section 5, T43): z, robust_z and fixed_only on the transformed series.

Rules implemented (pure core; the caller supplies observations, config and run facts):
- the window is the trailing ``window_obs`` observations of the transformed series that END AT THE
  PREVIOUS observation: the current observation never enters its own mean, sd, median or MAD;
  ``MISS`` periods (no value) and ``PROJ`` rows are absent from the window, never imputed, and
  periods where the transform cannot be computed are absent too;
- ``trending_level`` indicators score z on ``DIFF12`` of the indicator's transformed series; the
  stored ``transform_id`` is not touched and a fixed override still evaluates the LEVEL;
- minimum observations (60 M / 20 Q / 10 A prior) plus the effective-sample rule: for M and Q the
  window plus the current observation must span at least 5 years (``n_eff`` of at least 5
  non-overlapping years); below that ``level = none``, ``confidence = none``, ``below_min_obs``;
- ``confidence`` is ``full`` with the complete window, else ``low``;
- ``sd_zero`` / ``mad_zero`` give level ``none`` and z NULL (never a division by zero); a fixed
  override still evaluates;
- adverse direction: +1 high z is adverse, -1 low z is adverse, 0 both tails (direction n/a);
- the window starts at max(1991-01-01, ``regime_start``) and is NOT re-based by a shift; a third
  consecutive ``alert`` (the current observation and the two before it, each scored on the window
  ending at its own previous observation) sets ``label = 'persistent_shift'``; ``level`` unchanged;
- fixed overrides (P19) apply only to members of the entry's ``entity_group`` and every entry needs
  a rationale (config error otherwise); none ships in v1 (Q50), tested with fixtures only; a
  ``goods_only`` reserve cover never gets one (caller passes ``override_allowed=False``);
- stale series are not alerted (``reason = stale``); withheld sources are evaluated and stored with
  ``publish = False``.

Choices where the spec is silent: sd is the sample standard deviation (n - 1); the ``percentile``
method is undefined in the spec and raises ``AlertConfigError``.
"""

from __future__ import annotations

import statistics
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

import psycopg

from macro_monitor.analytics import transforms
from macro_monitor.analytics.snapshot import _SINGLE, Obs
from macro_monitor.analytics.transforms import Point
from macro_monitor.models.enums import Frequency

MAD_SCALE = Decimal("1.4826")
REGIME_FLOOR = date(1991, 1, 1)
PERSISTENT_RUN = 3
MIN_SPAN_YEARS = 5  # n_eff: at least 5 non-overlapping years for M and Q
_Z_PLACES = Decimal("0.000001")
_RANK = {"none": 0, "watch": 1, "alert": 2}


class AlertConfigError(ValueError):
    """Invalid alert configuration (missing rationale, unsupported method, ...)."""


@dataclass(frozen=True)
class AlertConfig:
    indicator_id: str
    method: str  # z | robust_z | fixed_only | none | percentile
    adverse: int  # +1 | -1 | 0
    alert_z: Decimal
    watch_z: Decimal
    window_obs: int
    min_obs: int
    transform_id: str
    stationarity_class: str = "stationary"
    overrides: tuple[Mapping[str, Any], ...] = ()

    @classmethod
    def from_resolved(cls, r: Any, frequency: str) -> AlertConfig:
        """Build from ``registry.indicators.ResolvedIndicator`` for the series' frequency."""
        v = r.values

        def per_freq(x: Any) -> int:
            return int(x[frequency] if isinstance(x, Mapping) else x)

        return cls(
            indicator_id=r.id,
            method=str(v["alert.method"]),
            adverse=int(v["alert.adverse"]),
            alert_z=Decimal(str(v["alert.alert_z"])),
            watch_z=Decimal(str(v["alert.watch_z"])),
            window_obs=per_freq(v["alert.window_obs"]),
            min_obs=per_freq(v["alert.min_obs"]),
            transform_id=str(v["transform"]),
            stationarity_class=str(v["stationarity_class"]),
            overrides=tuple(r.alert_override),
        )


@dataclass(frozen=True)
class AlertRow:
    """One ``analytics.alert`` row (``n_eff`` is informational, not stored)."""

    indicator_id: str
    entity_id: str
    series_id: int
    ref_period_end: date
    method: str
    window_obs: int
    n_obs: int
    z: Decimal | None
    level: str
    confidence: str
    reason: str | None
    label: str | None
    override_rule: str | None
    publish: bool
    n_eff: Decimal | None = None


@dataclass
class _Eval:
    z: Decimal | None
    level: str
    confidence: str
    reason: str | None
    n_obs: int
    n_eff: Decimal | None
    override_rule: str | None


def _quant(x: Decimal) -> Decimal:
    return x.quantize(_Z_PLACES)


def _months(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + b.month - a.month


def _level_from_z(z: Decimal, adverse: int, cfg: AlertConfig) -> str:
    s = z * adverse if adverse else abs(z)
    if s >= cfg.alert_z:
        return "alert"
    if s >= cfg.watch_z:
        return "watch"
    return "none"


def _applicable_overrides(
    cfg: AlertConfig, entity_groups: Collection[str]
) -> list[Mapping[str, Any]]:
    out = []
    for o in cfg.overrides:
        if not str(o.get("rationale") or "").strip():
            raise AlertConfigError(
                f"{cfg.indicator_id}: alert override for {o.get('entity_group')!r} has no rationale"
            )
        if o["entity_group"] in entity_groups:
            out.append(o)
    return out


def _override_level(
    cfg: AlertConfig, value: Decimal, entries: Sequence[Mapping[str, Any]]
) -> tuple[str, str | None]:
    if entries and cfg.adverse == 0:
        raise AlertConfigError(f"{cfg.indicator_id}: a fixed override needs a non-zero adverse")
    best, rule = "none", None
    for o in entries:
        for lvl in ("alert", "watch"):
            if o.get(lvl) is None:
                continue
            thr = Decimal(str(o[lvl]))
            hit = value * cfg.adverse >= thr * cfg.adverse
            if hit:
                if _RANK[lvl] > _RANK[best]:
                    best, rule = lvl, f"{o['entity_group']}:{lvl}:{thr}"
                break
    return best, rule


def _evaluate_at(
    cfg: AlertConfig,
    pts: Sequence[Point],
    i: int,
    frequency: Frequency,
    start: date,
    level_by_period: Mapping[date, Decimal],
    overrides: Sequence[Mapping[str, Any]],
) -> _Eval:
    cur = pts[i]
    assert cur.value is not None
    window = [p for p in pts[:i] if p.period_end >= start and p.value is not None]
    window = window[-cfg.window_obs :]
    n = len(window)
    ov_level, ov_rule = "none", None
    if overrides and cur.period_end in level_by_period:
        ov_level, ov_rule = _override_level(cfg, level_by_period[cur.period_end], overrides)

    def done(
        z: Decimal | None, lvl: str, conf: str, reason: str | None, n_eff: Decimal | None = None
    ) -> _Eval:
        rule = None
        if ov_level != "none" and _RANK[ov_level] >= _RANK[lvl]:
            lvl, rule = ov_level, ov_rule
            if conf == "none":
                conf = "full"
        return _Eval(z, lvl, conf, reason, n, n_eff, rule)

    if n == 0:
        return done(None, "none", "none", "no_window")
    first = window[0].period_end
    if frequency is Frequency.M:
        n_eff: Decimal | None = Decimal(_months(first, cur.period_end)) / 12
    elif frequency is Frequency.Q:
        n_eff = Decimal(_months(first, cur.period_end)) / 12
    else:
        n_eff = Decimal(n)
    span_ok = frequency is Frequency.A or (n_eff is not None and n_eff >= MIN_SPAN_YEARS)
    if n < cfg.min_obs or not span_ok:
        return done(None, "none", "none", "below_min_obs", n_eff)
    conf = "full" if n >= cfg.window_obs else "low"
    xs = [p.value for p in window if p.value is not None]
    x = cur.value
    if cfg.method == "fixed_only":
        return done(None, "none", conf, None, n_eff)
    if cfg.method == "z":
        if all(v == xs[0] for v in xs):
            return done(None, "none", conf, "sd_zero", n_eff)
        mean = sum(xs, Decimal(0)) / n
        sd = (sum(((v - mean) ** 2 for v in xs), Decimal(0)) / (n - 1)).sqrt()
        z = _quant((x - mean) / sd)
    else:  # robust_z
        med = statistics.median(xs)
        mad = statistics.median([abs(v - med) for v in xs])
        if mad == 0:
            return done(None, "none", conf, "mad_zero", n_eff)
        z = _quant((x - med) / (MAD_SCALE * mad))
    return done(z, _level_from_z(z, cfg.adverse, cfg), conf, None, n_eff)


def _series(
    obs: Sequence[Obs],
    cfg: AlertConfig,
    frequency: Frequency,
    seasonal_adjustment: str,
    transformed: Sequence[Point] | None,
) -> tuple[list[Point], list[Point]]:
    """(level series, alert series): valid transformed points; DIFF12 of them for trending_level."""
    if transformed is None:
        base = [Point(o.ref_period_end, o.value) for o in obs]
        fn = _single(cfg.transform_id)
        level_all = fn(base, frequency, seasonal_adjustment)
    else:
        level_all = [p for p in transformed if p.value is not None]
    level_pts = [p for p in level_all if p.value is not None]
    if cfg.stationarity_class == "trending_level":
        alert_pts = [p for p in transforms.diff12(level_pts, frequency) if p.value is not None]
    else:
        alert_pts = level_pts
    return level_pts, alert_pts


def _single(transform_id: str) -> Any:
    fn = _SINGLE.get(transform_id)
    if fn is None:
        raise AlertConfigError(
            f"transform {transform_id!r} needs its inputs: pass the transformed series explicitly"
        )
    return fn


def evaluate_alert(
    cfg: AlertConfig,
    entity_id: str,
    obs: Sequence[Obs],
    *,
    is_stale: bool,
    entity_groups: Collection[str] = (),
    regime_start: date | None = None,
    transformed: Sequence[Point] | None = None,
    override_allowed: bool = True,
) -> AlertRow | None:
    """Alert row for one (indicator, entity), or None when nothing is alerted.

    ``obs`` is the as-of headline history (``snapshot._OBS_SQL`` order); ``MISS`` and ``PROJ``
    rows are dropped here. ``transformed`` supplies the transformed series for transforms that
    need inputs (REAL_RATE, SPREAD_VS_REF, denominator transforms, wired by T44).
    ``override_allowed=False`` (``goods_only`` reserve cover) disables fixed overrides.
    """
    if cfg.method == "none":
        return None
    if cfg.method not in ("z", "robust_z", "fixed_only"):
        raise AlertConfigError(
            f"{cfg.indicator_id}: alert method {cfg.method!r} is undefined in the analytics spec"
        )
    usable = [o for o in obs if o.value is not None and o.value_status not in ("MISS", "PROJ")]
    if not usable:
        return None
    last = usable[-1]
    freq = Frequency(last.frequency)
    level_pts, alert_pts = _series(usable, cfg, freq, last.seasonal_adjustment, transformed)
    idx = next((j for j, p in enumerate(alert_pts) if p.period_end == last.ref_period_end), None)
    if idx is None:
        return None
    entries = _applicable_overrides(cfg, entity_groups) if override_allowed else []
    start = max(REGIME_FLOOR, regime_start or REGIME_FLOOR)
    levels = {p.period_end: p.value for p in level_pts if p.value is not None}
    ev = _evaluate_at(cfg, alert_pts, idx, freq, start, levels, entries)
    label = None
    if is_stale:
        ev = _Eval(None, "none", "none", "stale", ev.n_obs, ev.n_eff, None)
    elif ev.level == "alert" and idx >= PERSISTENT_RUN - 1:
        run = [
            _evaluate_at(cfg, alert_pts, j, freq, start, levels, entries)
            for j in range(idx - PERSISTENT_RUN + 1, idx)
        ]
        if all(e.level == "alert" for e in run):
            label = "persistent_shift"
    return AlertRow(
        indicator_id=cfg.indicator_id,
        entity_id=entity_id,
        series_id=last.series_id,
        ref_period_end=last.ref_period_end,
        method=cfg.method,
        window_obs=cfg.window_obs,
        n_obs=ev.n_obs,
        z=ev.z,
        level=ev.level,
        confidence=ev.confidence,
        reason=ev.reason,
        label=label,
        override_rule=ev.override_rule,
        publish=last.source_public,
        n_eff=ev.n_eff,
    )


@dataclass
class AlertResult:
    rows: list[AlertRow]
    warnings: list[str] = field(default_factory=list)


_COLUMNS = (
    "indicator_id", "entity_id", "series_id", "ref_period_end", "method", "window_obs", "n_obs",
    "z", "level", "confidence", "reason", "label", "override_rule", "publish",
)  # fmt: skip


def write_alerts(
    conn: psycopg.Connection[Any], analysis_run_id: int, rows: Sequence[AlertRow]
) -> int:
    """Insert the rows for a run (insert-only table); the caller commits."""
    cols = ", ".join(_COLUMNS)
    ph = ", ".join(["%s"] * (len(_COLUMNS) + 1))
    with conn.cursor() as cur:
        cur.executemany(
            f"INSERT INTO analytics.alert (analysis_run_id, {cols}) VALUES ({ph})",
            [[analysis_run_id, *(getattr(r, c) for c in _COLUMNS)] for r in rows],
        )
    return len(rows)
