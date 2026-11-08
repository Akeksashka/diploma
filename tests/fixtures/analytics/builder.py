# ruff: noqa: E501
"""Analytics scenario fixture builder (T37).

A scenario is plain, immutable data (no clock, no randomness): sources, entities, indicators,
series and per-series observation versions. ``seed`` writes it into a migrated database.

SEEDING PRIVILEGE: ``seed`` expects a SUPERUSER (or owner) connection. This is deliberate and
test-only: the real loader (mm_ingest, loader.py) needs staging rows, a series map provider and the
load lock, which would couple every analytics test to loader behaviour. What is kept real: every
row passes the production triggers and CHECKs of ref.* and curated.observation (append-only,
known_at = raw_object.fetched_at, known_at increasing per key, period/frequency fit), raw objects
go through ``storage.manifest``.

The builder never computes expected analytics numbers. Tests assert numbers taken from the specs.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg

from macro_monitor.storage import manifest

BASE = datetime(
    2026, 10, 1, 6, 0, tzinfo=UTC
)  # fixed "fetch" epoch; all scenario times derive from it
LOAD_DELAY = timedelta(minutes=1)
RUN_AT = datetime(
    2026, 10, 15, 6, 0, tzinfo=UTC
)  # a convenient analysis cutoff after every vintage


@dataclass(frozen=True)
class Source:
    source_id: str
    publish_site: str = "public"  # 'withheld' = withheld source
    archive_mode: str = "public"


@dataclass(frozen=True)
class Group:
    source_id: str
    group_id: str = "G"
    edition_ordered: bool = False


@dataclass(frozen=True)
class Indicator:
    indicator_id: str
    good_dir: int = -1
    rank_mode: str = "monotone_good"
    staleness_class: str = "ACT120"
    tier: str = "M"
    domain_id: str = "D1"
    kind: str = "indicator"


@dataclass(frozen=True)
class Obs:
    """One stored observation version. ``fetch`` is a day offset from BASE (the raw object's
    fetched_at, hence known_at). ``value`` is a decimal string, None for MISS."""

    start: date
    value: str | None
    fetch: int = 0
    status: str = "OBS"
    kind: str = "initial"
    label: str | None = None


@dataclass(frozen=True)
class Series:
    key: str
    entity: str
    indicator: str
    obs: tuple[Obs, ...]
    source: str = "S"
    group: str = "G"
    frequency: str = "M"
    calendar_basis: str = "CAL"
    role: str = "headline"


@dataclass(frozen=True)
class Scenario:
    name: str
    sources: tuple[Source, ...]
    groups: tuple[Group, ...]
    entities: tuple[str, ...]
    indicators: tuple[Indicator, ...]
    series: tuple[Series, ...] = field(default=())

    def fingerprint(self) -> tuple[Any, ...]:
        """Hashable canonical form: equal scenarios seed identical databases."""
        return (self.name, self.sources, self.groups, self.entities, self.indicators, self.series)


def period_end(start: date, frequency: str, calendar_basis: str = "CAL") -> date:
    if frequency == "M":
        return start.replace(day=calendar.monthrange(start.year, start.month)[1])
    if frequency == "Q":
        m = start.month + 2
        return date(start.year, m, calendar.monthrange(start.year, m)[1])
    if frequency == "A":
        if calendar_basis == "CAL":
            return date(start.year, 12, 31)
        return date(start.year + 1, start.month, 1) - timedelta(days=1)  # fiscal year
    if frequency == "D":
        return start
    raise ValueError(frequency)


def months(first: date, n: int) -> list[date]:
    """n consecutive month starts from ``first``."""
    out = []
    y, m = first.year, first.month
    for _ in range(n):
        out.append(date(y, m, 1))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _latest_series(
    entity: str, indicator: str, start: date, value: str, *, source: str = "S", fetch: int = 0
) -> Series:
    return Series(f"{indicator}.{entity}", entity, indicator, (Obs(start, value, fetch),), source)


def latest_values(
    name: str,
    values: dict[str, str],
    periods: dict[str, date],
    *,
    indicator: str = "U1",
    good_dir: int = -1,
) -> Scenario:
    """One indicator, one observation per entity (entity -> value, entity -> period start)."""
    return Scenario(
        name=name,
        sources=(Source("S"),),
        groups=(Group("S"),),
        entities=tuple(values),
        indicators=(Indicator(indicator, good_dir=good_dir),),
        series=tuple(_latest_series(e, indicator, periods[e], v) for e, v in values.items()),
    )


# ------------------------------------------------------------------ spec worked examples

AUG, JUL, JUN, MAR = date(2026, 8, 1), date(2026, 7, 1), date(2026, 6, 1), date(2026, 3, 1)


def percentile_ties() -> Scenario:
    """Spec 4.3 step 4 / AC-AN-2: unemployment (higher is worse) A 3.0, B 4.0, C 4.0, D 9.0."""
    vals = {"A": "3.0", "B": "4.0", "C": "4.0", "D": "9.0"}
    return latest_values("percentile_ties", vals, dict.fromkeys(vals, AUG))


def rank_period_10() -> Scenario:
    """AC-AN-4: 10 candidates; latest periods Aug x6, Jul x1, Jun x2, Mar x1."""
    periods = [AUG] * 6 + [JUL] + [JUN] * 2 + [MAR]
    ents = [f"E{i:02d}" for i in range(10)]
    return latest_values(
        "rank_period_10",
        {e: str(3 + i) for i, e in enumerate(ents)},
        dict(zip(ents, periods, strict=True)),
    )


def rank_period_20() -> Scenario:
    """AC-AN-4 second fixture: 20 candidates (Aug x10, Jul x1, Jun x9)."""
    periods = [AUG] * 10 + [JUL] + [JUN] * 9
    ents = [f"E{i:02d}" for i in range(20)]
    return latest_values(
        "rank_period_20",
        {e: str(3 + i) for i, e in enumerate(ents)},
        dict(zip(ents, periods, strict=True)),
    )


# ------------------------------------------------------------------ feature scenario


def kitchen_sink() -> Scenario:
    """Multi-entity, multi-vintage database exercising the snapshot/staleness edge cases.

    Entities: A..D ranked monthly; STALE (last value long ago), LAG (3 months behind), WH (only
    source is withheld), MISS (latest period MISS after a valid value), PROJ (projection row),
    IMP (import row besides a normal one), FY (fiscal-year annual), WEOX (WEO editions),
    REV (revised value, two vintages).
    """
    m = months(date(2026, 1, 1), 8)  # Jan..Aug 2026
    series: list[Series] = []
    for e, v in {"A": "3.0", "B": "4.0", "C": "4.0", "D": "9.0"}.items():
        series.append(Series(f"U1.{e}", e, "U1", tuple(Obs(p, v, 5) for p in m)))
    series.append(Series("U1.STALE", "STALE", "U1", (Obs(date(2025, 1, 1), "5.0", 1),)))
    series.append(Series("U1.LAG", "LAG", "U1", tuple(Obs(p, "6.0", 5) for p in m[:5])))
    series.append(
        Series("U1.MISS", "MISS", "U1", (Obs(m[6], "7.0", 5), Obs(m[7], None, 6, "MISS")))
    )
    series.append(
        Series("U1.PROJ", "PROJ", "U1", (Obs(m[6], "2.0", 5), Obs(m[7], "2.5", 6, "PROJ")))
    )
    series.append(
        Series(
            "U1.IMP", "IMP", "U1",
            (Obs(m[0], "8.0", 2, kind="import"), Obs(m[0], "8.5", 3), Obs(m[1], "8.6", 3)),
        )
    )  # fmt: skip
    series.append(
        Series(
            "U1.REV", "REV", "U1",
            (Obs(m[6], "1.0", 4), Obs(m[6], "1.2", 9, kind="revision"), Obs(m[5], "1.1", 4)),
        )
    )  # fmt: skip
    series.append(Series("U1.WH", "WH", "U1", (Obs(m[7], "4.4", 5),), source="W", group="G"))
    series.append(
        Series(
            "F1.FY", "FY", "F1",
            (Obs(date(2024, 7, 1), "-3.1", 5), Obs(date(2025, 7, 1), "-2.9", 5)),
            frequency="A", calendar_basis="FISCAL",
        )
    )  # fmt: skip
    weo = (
        Obs(date(2025, 1, 1), "2.0", 3, "OBS", label="WEO-2026-04"),
        Obs(date(2026, 1, 1), "3.0", 3, "PROJ", label="WEO-2026-04"),
        Obs(date(2025, 1, 1), "2.1", 20, "OBS", kind="revision", label="WEO-2026-10"),
        Obs(date(2026, 1, 1), "3.4", 20, "PROJ", kind="revision", label="WEO-2026-10"),
    )
    series.append(Series("W1.WEOX", "WEOX", "W1", weo, source="WEO", group="WEO", frequency="A"))
    return Scenario(
        name="kitchen_sink",
        sources=(Source("S"), Source("W", publish_site="withheld"), Source("WEO")),
        groups=(Group("S", "G"), Group("W", "G"), Group("WEO", "WEO", edition_ordered=True)),
        entities=(
            "A",
            "B",
            "C",
            "D",
            "STALE",
            "LAG",
            "MISS",
            "PROJ",
            "IMP",
            "REV",
            "WH",
            "FY",
            "WEOX",
        ),
        indicators=(
            Indicator("U1", good_dir=-1),
            Indicator("F1", good_dir=1, tier="A", staleness_class="A730"),
            Indicator("W1", good_dir=1, tier="A", staleness_class="A730"),
        ),
        series=tuple(series),
    )


# ------------------------------------------------------------------ seeding


def seed(conn: psycopg.Connection, sc: Scenario) -> dict[str, int]:
    """Insert ``sc`` (superuser/owner connection; see module docstring). Returns key -> series_id.

    Commits. Deterministic: fixed timestamps, rows inserted in sorted order.
    """
    ex = conn.execute
    ex("INSERT INTO ref.domain (domain_id, name, is_ranked) VALUES ('D1','D1',true) "
       "ON CONFLICT DO NOTHING")  # fmt: skip
    for s in sc.sources:
        ex("INSERT INTO ref.source VALUES (%s,'p','rest',%s,%s,'l','a','x',true)",
           [s.source_id, s.archive_mode, s.publish_site])  # fmt: skip
    for g in sc.groups:
        ex("INSERT INTO ref.series_group (source_id, group_id, edition_ordered, config_sha256) "
           "VALUES (%s,%s,%s,'x')", [g.source_id, g.group_id, g.edition_ordered])  # fmt: skip
    for e in sc.entities:
        ex("INSERT INTO ref.entity VALUES (%s,%s,'country',true,false)", [e, e])
    for u, dim in (("PC", "ratio"), ("PCT_GDP2", "ratio")):
        ex("INSERT INTO ref.unit VALUES (%s,%s,'x') ON CONFLICT DO NOTHING", [u, dim])
    for i in sc.indicators:
        ex(
            "INSERT INTO ref.indicator (indicator_id, name, kind, tier, priority, currency_basis, "
            "staleness_class, transform_id, alert_method, adverse_dir, good_dir, rank_mode, "
            "stationarity_class, release_lag_aware) VALUES (%s,%s,%s,%s,'core','NA',%s,'LEVEL',"
            "%s,%s,%s,%s,'stationary',false)",
            [i.indicator_id, i.indicator_id, i.kind, i.tier, i.staleness_class,
             "none" if i.kind == "input" else "z", -i.good_dir, i.good_dir, i.rank_mode],
        )  # fmt: skip
        if i.kind == "indicator":
            ex("INSERT INTO ref.indicator_domain VALUES (%s,%s,%s)",
               [i.indicator_id, i.domain_id, i.rank_mode != "descriptive_only"])  # fmt: skip
    row = ex(
        "INSERT INTO ingest.run (workflow, trigger, mode, git_sha, code_version, started_at, "
        "status) VALUES ('fixture','local','refresh','g','c', %s, 'running') RETURNING run_id",
        [BASE],
    ).fetchone()
    assert row is not None
    run_id = int(row[0])

    ids: dict[str, int] = {}
    for s in sorted(sc.series, key=lambda x: x.key):
        r = ex(
            "INSERT INTO ref.series (source_id, group_id, dataset_id, series_key, entity_id, title, "
            "frequency, unit_code, price_basis, seasonal_adjustment, calendar_basis, first_seen_at) "
            "VALUES (%s,%s,'d',%s,%s,%s,%s,'PC','NA','NA',%s,%s) RETURNING series_id",
            [s.source, s.group, s.key, s.entity, s.key, s.frequency, s.calendar_basis, BASE],
        ).fetchone()
        assert r is not None
        ids[s.key] = int(r[0])
        ex("INSERT INTO ref.series_map (indicator_id, entity_id, series_id, role, rationale) "
           "VALUES (%s,%s,%s,%s,'fixture')", [s.indicator, s.entity, ids[s.key], s.role])  # fmt: skip

    # One raw object per (source, group, fetch day, load kind); observation order = known_at.
    raws: dict[tuple[str, str, int, str], int] = {}
    todo = sorted(
        ((o, s) for s in sc.series for o in s.obs),
        key=lambda t: (t[0].fetch, t[1].source, t[1].group, t[1].key, t[0].start, t[0].kind),
    )
    for o, s in todo:
        known = BASE + timedelta(days=o.fetch)
        rk = (s.source, s.group, o.fetch, o.kind)
        if rk not in raws:
            n = len(raws) + 1
            req = f"{s.group}-{o.kind}"
            sha = f"{n:064x}"
            manifest.insert_blob(
                conn, sha256=sha, byte_count=1, storage_backend="local_dir",
                storage_ref=f"fixture/{n}", first_stored_at=known,
            )  # fmt: skip
            prev = manifest.latest_state(conn, s.source, req).raw_id
            raws[rk] = manifest.insert_raw_object(
                conn,
                manifest.NewRawObject(
                    run_id=run_id, source_id=s.source, group_id=s.group, request_key=req,
                    request_url="https://x/", request_params={}, http_status=200, etag=None,
                    last_modified=None, content_type=None, fetched_at=known, sha256=sha,
                    fetch_mode="full", fetch_scope="complete", parser_id="p@1",
                ),
                prev,
            )  # fmt: skip
        ex(
            "INSERT INTO curated.observation (series_id, ref_period_start, ref_period_end, value, "
            "value_status, load_kind, known_at, loaded_at, vintage_label, raw_id, run_id) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [ids[s.key], o.start, period_end(o.start, s.frequency, s.calendar_basis), o.value,
             o.status, o.kind, known, known + LOAD_DELAY, o.label, raws[rk], run_id],
        )  # fmt: skip
    conn.commit()
    return ids
