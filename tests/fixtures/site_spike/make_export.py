"""Synthetic export tree for the T87 site spike (AC-DASH-0).

Hand-written values that follow the file shapes of ``docs/specs/dashboard-export-spec.md``
(manifest, ``meta/*``, ``scorecard/<domain>.json``, ``series/<indicator>.parquet``). They are NOT
source data and NOT the output of the ``export`` CLI (that needs a database; see
``docs/ops/spike-results.md``). Deterministic: no clock, no randomness.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

from macro_monitor.publish.export import parquet_bytes
from macro_monitor.publish.manifest import utc_text
from macro_monitor.publish.revisions import (
    build_table as revisions_table,
)
from macro_monitor.publish.revisions import (
    build_versions,
    edition_summaries,
    ordinary_revisions,
)
from macro_monitor.publish.series import build_table
from macro_monitor.publish.status import SCHEDULE_CHECK_TEXT, STATUS_JSON_SCHEMA_VERSION

KNOWN_CUTOFF = "2026-11-01T04:23:41Z"
ENTITIES = ["DEU", "FRA", "ITA"]  # the entities that have an M09 series file
INDICATOR = "M09"


def _month_ends(n: int) -> list[date]:
    out: list[date] = []
    y, m = 2023, 1
    for _ in range(n):
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        out.append(date.fromordinal(date(ny, nm, 1).toordinal() - 1))
        y, m = ny, nm
    return out


def level(entity_idx: int, i: int) -> float:
    """Level of the synthetic unemployment-rate series."""
    return round(3.0 + entity_idx * 2.0 + 0.1 * (i % 7) - 0.02 * i, 3)


def _dump(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, sort_keys=True, indent=1) + "\n", encoding="utf-8")


#: indicator_id -> (entities, seasonal adjustment, default transform id, first series id)
SERIES_FILES: dict[str, tuple[list[str], str, str, int]] = {
    "M09": (ENTITIES, "SA", "LEVEL", 100),
    "P01": (["DEU", "FRA", "USA"], "NSA", "M3M3_ANN", 400),
}


def _series_file(out: Path, indicator: str, known_at: datetime) -> None:
    """Writes ``series/<indicator>.parquet`` with the REAL producer code (``publish.series``
    ``build_table`` and ``publish.export.parquet_bytes``): same schema, dictionary columns, zstd,
    format 2.6, one row group per entity. Values are synthetic."""
    ents, sa, default_tf, first_id = SERIES_FILES[indicator]
    ends = _month_ends(36)
    rows: list[tuple[object, ...]] = []
    for ei, ent in enumerate(ents):
        for i, end in enumerate(ends):
            rows.append(
                (
                    indicator,
                    ent,
                    first_id + ei,
                    end.replace(day=1),
                    end,
                    "M",
                    sa,
                    Decimal(str(level(ei, i))),
                    "OBS",
                    known_at,
                    known_at,
                    "new_period",
                )
            )
    table = build_table(rows, default_tf)  # type: ignore[arg-type]
    (out / "series").mkdir(parents=True, exist_ok=True)
    (out / "series" / f"{indicator}.parquet").write_bytes(
        parquet_bytes(table, group_by="entity_id")
    )


def build_export(out: Path, known_cutoff: str = KNOWN_CUTOFF) -> None:
    """Write the fixture export tree to ``out``."""
    ends = _month_ends(36)
    known_at = datetime.fromisoformat(known_cutoff.replace("Z", "+00:00")).astimezone(UTC)
    for indicator in SERIES_FILES:
        _series_file(out, indicator, known_at)

    _write_revisions(out, known_cutoff)
    _write_meta(out)
    _write_scorecards(out, ends[-1].isoformat(), known_cutoff)
    last = ends[-1].isoformat()
    _dump(
        out / "alerts.json",
        {
            "schema_version": "1.0",
            "analysis_run_id": 1,
            "alerts": [
                _alert("M09", "DEU", 100, last, "alert", 2.6),
                _alert("M09", "FRA", 101, last, "watch", 1.7),
                _alert("P01", "USA", 402, last, "watch", -1.8),
            ],
        },
    )
    _write_status(out, known_cutoff)
    files = []
    for p in sorted(out.rglob("*")):
        rel = p.relative_to(out).as_posix()
        if p.is_file() and rel != "manifest.json":
            b = p.read_bytes()
            files.append(
                {
                    "path": rel,
                    "format": p.suffix[1:],
                    "bytes": len(b),
                    "rows": None,
                    "sha256": hashlib.sha256(b).hexdigest(),
                }
            )
    _dump(
        out / "manifest.json",
        {
            "schema_version": "1.0",
            "build_id": "2026-11-01T04:30Z-r1",
            "generated_at": known_cutoff,
            "ingest_run_id": 1,
            "analysis_run_id": 1,
            "known_cutoff": known_cutoff,
            "code_version": "fixture",
            "history_start": "2023-01-01",
            "files": files,
            "totals": {"bytes": sum(f["bytes"] for f in files), "files": len(files)},
        },
    )


def _group(sg: str, ser: str, state: str, exp: str | None, lat: str | None) -> dict[str, object]:
    return {
        "source_group": sg,
        "series_group": ser,
        "state": state,
        "expected_period_end": exp,
        "latest_period_end": lat,
        "evaluated_at": "2026-11-01T04:20:00Z",
        "load_result": None,  # T83 gap: always null in the real export
    }


def status_doc(known_cutoff: str = KNOWN_CUTOFF) -> dict[str, object]:
    """``status.json`` in the shape of the real producer (``publish.status``): same keys, same
    constants, validated against ``status.schema.json`` by the tests. Invented values. Covers a
    withheld group (state and dates only, no values), null ``load_result`` everywhere, COV-01
    "not yet measurable" next to a measured entry, and a manual source without an expected window
    (``alerts_opened`` is 3 here; null is covered by the JS tests). The schema forbids
    extra fields, so the error-text-like extra fields that must not render are injected in the
    JS tests, not written here."""
    return {
        "schema_version": STATUS_JSON_SCHEMA_VERSION,
        "last_run": {
            "ingest_run_id": 1,
            "started_at": "2026-11-01T04:00:03Z",
            "finished_at": "2026-11-01T04:21:40Z",
            "mode": "monthly",
            "new_raw_objects": 12,
            "new_observations": 1834,
            "revisions": 17,
            "alerts_opened": 3,
        },
        "groups": [
            _group("eurostat", "labour", "fresh", "2026-09-30", "2026-09-30"),
            _group("imf_weo_manual", "weo", "late", "2026-10-31", "2026-04-30"),
            _group("oecd_withheld", "prices", "stale", "2026-08-31", "2026-05-31"),
            _group("worldbank", "agri", "broken", None, None),
        ],
        "backlog": {"n_unloaded": 2, "oldest_age_days": 5},
        "validation": {
            "counts": [
                {"check_family": "CUR", "severity": "error", "n_results": 410, "n_failed": 0},
                {"check_family": "CUR", "severity": "warn", "n_results": 410, "n_failed": 6},
                {"check_family": "COV", "severity": "info", "n_results": 8, "n_failed": 1},
            ],
            "cov01": [
                {"indicator_id": "M09", "state": "not_yet_measurable", "n_qualifying": 3},
                {
                    "indicator_id": "P01",
                    "state": "measured",
                    "n_qualifying": 8,
                    "n_results": 8,
                    "n_failed": 1,
                },
            ],
            "open_drift": {"n_open": 2, "by_kind": {"schema_change": 1, "unit_change": 1}},
        },
        "manual_sources": [
            {
                "source_id": "imf_weo_manual",
                "last_edition_date": "2026-04-14",
                "last_ingested_at": "2026-04-20T09:00:00Z",
                "next_expected": {
                    "window_from": "2026-10-10",
                    "window_to": "2026-10-25",
                    "remind_on": "2026-10-15",
                },
            },
            {
                "source_id": "manual_nowindow",
                "last_edition_date": None,
                "last_ingested_at": None,
                "next_expected": None,
            },
        ],
        "schedule_check": {"generated_at": known_cutoff, "text": SCHEDULE_CHECK_TEXT},
    }


def _write_status(out: Path, known_cutoff: str) -> None:
    _dump(out / "status.json", status_doc(known_cutoff))


LABEL = "mean percentile of the domain's indicators"
PCT_LABEL = "percentile vs all ranked countries"

# entity_id -> (name, kind, is_global)
META_ENTITIES = {
    "DEU": ("Germany", "country", False),
    "FRA": ("France", "country", False),
    "ITA": ("Italy", "country", False),
    "USA": ("United States", "country", False),
    "JPN": ("Japan", "country", False),
    "IND": ("India", "country", False),
    "POL": ("Poland", "country", False),
    "EA": ("Euro area", "aggregate", False),
    "WLD": ("World", "aggregate", True),
}
# group_id -> member entity ids (valid_from/valid_to are fixed in _write_meta)
GROUPS = {
    "euro_area": ["DEU", "FRA", "ITA"],
    "g7": ["DEU", "FRA", "ITA", "JPN", "USA"],
    "advanced": ["DEU", "FRA", "ITA", "JPN", "USA"],
    "emerging": ["IND", "POL"],
    "non_euro_eu": ["POL"],
}
WEO_SOURCE = "imf_weo_manual"
#: M10 (employment rate) stands in for a WEO-fed, named-edition indicator in the revision fixture.
WEO_SERIES = {"DEU": 200, "FRA": 300}
WEO_PCT = [Decimal(x) for x in ("0.5", "1.5", "3", "8", "12", "41.7")]
_UTC = UTC


def _ts(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=_UTC)


def _month_span(y: int, m: int) -> tuple[date, date]:
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return date(y, m, 1), date.fromordinal(date(ny, nm, 1).toordinal() - 1)


def _revision_db_rows() -> list[tuple[object, ...]]:
    """Version rows in the column order of ``publish.revisions._SQL`` (what the view
    ``curated.v_revision_history`` returns): ordinary regular revisions (M09, P01), a re-estimation
    family (P01 FRA) and a WEO-style named-edition rebase (M10, ``edition_ordered``).
    Invented values."""
    rows: list[tuple[object, ...]] = []

    def add(
        sid: int,
        ent: str,
        ind: str,
        period: tuple[date, date],
        known: str,
        val: str | None,
        kind: str,
        cls: str = "regular",
        label: str | None = None,
        edition: bool = False,
        status: str = "OBS",
    ) -> None:
        rows.append(
            (
                sid,
                ent,
                ind,
                period[0],
                period[1],
                _ts(known),
                None,
                label,
                None if val is None else Decimal(val),
                "DEL" if kind == "tombstone" else status,
                kind,
                cls,
                edition,
            )
        )

    m09 = [
        (
            100,
            "DEU",
            (2026, 6),
            [("2026-07-02", "5.0"), ("2026-08-04", "5.2"), ("2026-10-05", "5.1")],
        ),
        (100, "DEU", (2026, 7), [("2026-08-04", "5.1"), ("2026-09-03", "5.4")]),
        (101, "FRA", (2026, 5), [("2026-06-03", "7.4"), ("2026-07-02", "7.0")]),
        (101, "FRA", (2026, 6), [("2026-07-02", "7.2"), ("2026-09-03", None)]),
        (102, "ITA", (2026, 4), [("2026-05-05", "9.0"), ("2026-06-03", "9.01")]),
    ]
    for sid, ent, (y, m), versions in m09:
        for i, (known, val) in enumerate(versions):
            kind = "initial" if i == 0 else ("tombstone" if val is None else "revision")
            add(sid, ent, "M09", _month_span(y, m), known, val, kind)
    # P01: one regular revision each for DEU and USA, and a re-estimation family for FRA.
    add(400, "DEU", "P01", _month_span(2026, 9), "2026-10-05", "2.4", "initial")
    add(400, "DEU", "P01", _month_span(2026, 9), "2026-10-21", "2.7", "revision")
    add(402, "USA", "P01", _month_span(2026, 8), "2026-09-03", "3.2", "initial")
    add(402, "USA", "P01", _month_span(2026, 8), "2026-10-05", "3.0", "revision")
    for i in range(10):
        y, m = (2025, 11 + i) if i < 2 else (2026, i - 1)
        base = Decimal("100") + Decimal(i)
        add(
            401, "FRA", "P01", _month_span(y, m), "2026-09-03", str(base), "initial", "reestimation"
        )
        add(
            401,
            "FRA",
            "P01",
            _month_span(y, m),
            "2026-10-05",
            str(base * (Decimal("1") + Decimal(10 + i) / Decimal("1000"))),
            "revision",
            "reestimation",
        )
    # M10: two WEO editions; the second rebases every key of both series (the first is the base).
    for ent, sid in WEO_SERIES.items():
        for i, year in enumerate(range(2019, 2025)):
            period = (date(year, 1, 1), date(year, 12, 31))
            v1 = Decimal("60") + Decimal(i) + (Decimal("2") if ent == "FRA" else Decimal("0"))
            v2 = v1 * (Decimal("1") + WEO_PCT[i] / Decimal("100"))
            add(
                sid,
                ent,
                "M10",
                period,
                "2026-04-22",
                str(v1),
                "initial",
                label="WEO-2026-04",
                edition=True,
                status="EST",
            )
            add(
                sid,
                ent,
                "M10",
                period,
                "2026-10-14",
                str(v2),
                "revision",
                label="WEO-2026-10",
                edition=True,
                status="EST",
            )
    return rows


def _write_revisions(out: Path, known_cutoff: str) -> None:
    """``revisions/<indicator>.parquet`` and ``revisions_recent.json`` through the REAL producer
    code (``publish.revisions``: versions, table, ordinary list, edition summaries)."""
    cutoff = datetime.fromisoformat(known_cutoff.replace("Z", "+00:00")).astimezone(UTC)
    # The real producer stores full-precision floats (reported separately); the fixture rounds the
    # size columns to realistic published precision so the page does not show 16-digit text.
    versions = [
        replace(
            v,
            abs_change=None if v.abs_change is None else v.abs_change.quantize(Decimal("0.01")),
            pct=None if v.pct is None else v.pct.quantize(Decimal("0.1")),
        )
        for v in build_versions(_revision_db_rows(), cutoff)
    ]
    for indicator in sorted({v.indicator_id for v in versions}):
        table = revisions_table([v for v in versions if v.indicator_id == indicator])
        (out / "revisions").mkdir(parents=True, exist_ok=True)
        (out / "revisions" / f"{indicator}.parquet").write_bytes(
            parquet_bytes(table, group_by="entity_id")
        )
    source_of = dict.fromkeys(WEO_SERIES.values(), WEO_SOURCE)
    _dump(
        out / "revisions_recent.json",
        {
            "schema_version": "1.0",
            "known_cutoff": utc_text(cutoff, fractional=True),
            "revisions": ordinary_revisions(versions, cutoff),
            "edition_summaries": edition_summaries(versions, source_of, cutoff),
        },
    )


#: Fixed M18 wording of the real export (publish/meta.py INDICATOR_NOTES, spec section 4, B4).
M18_NOTE = (
    "Non-euro countries: local-currency yield spread (includes inflation/FX expectations), "
    "not sovereign credit risk"
)
# indicator_id -> (name, unit, rank_mode, domain)
META_INDICATORS = {
    "M09": ("Unemployment rate", "% of labour force", "monotone_good", "labour"),
    "M10": ("Employment rate", "% of population 15-64", "monotone_good", "labour"),
    "M11": ("Population 15-64", "million", "descriptive_only", "labour"),
    "P01": ("CPI inflation", "% y/y", "target_distance", "prices"),
    "A01": ("Cereal price index", "index", "descriptive_only", "agri"),
    "B01": ("World trade volume", "% y/y", "descriptive_only", "global"),
    "M18": ("10-year government bond yield spread", "% points", "descriptive_only", "fin"),
}
DOMAINS = {
    "labour": ("Labour", True, ["M09", "M10", "M11"]),
    "prices": ("Prices", True, ["P01"]),
    "agri": ("Agriculture", False, ["A01"]),
    "global": ("Global", False, ["B01"]),
    "fin": ("Financial", False, ["M18"]),
}


def _alert(
    ind: str, ent: str, series_id: int, ref: str, level_: str, z: float
) -> dict[str, object]:
    return {
        "indicator_id": ind,
        "entity_id": ent,
        "series_id": series_id,
        "ref_period_end": ref,
        "method": "zscore",
        "z": z,
        "level": level_,
        "confidence": "full",
        "reason": None,
        "label": None,
        "override_rule": None,
    }


def _write_meta(out: Path) -> None:
    _dump(
        out / "meta" / "entities.json",
        {
            "schema_version": "1.0",
            "entities": [
                {
                    "entity_id": e,
                    "name": n,
                    "iso3": None if kind == "aggregate" else e,
                    "kind": kind,
                    "is_ranked": kind == "country",
                    "is_global": is_global,
                    "group_ids": sorted(g for g, ms in GROUPS.items() if e in ms),
                }
                for e, (n, kind, is_global) in META_ENTITIES.items()
            ],
        },
    )
    _dump(
        out / "meta" / "indicators.json",
        {
            "schema_version": "1.0",
            "indicators": [
                {
                    "indicator_id": i,
                    "name": n,
                    "domain_ids": [dom],
                    "scope": "global" if dom == "global" else "country",
                    "frequency_set": ["M"],
                    "unit_label": unit,
                    "adverse_dir": 0 if mode == "descriptive_only" else (-1 if i == "M10" else 1),
                    "rank_mode": mode,
                    "good_dir": 0 if mode == "descriptive_only" else (1 if i == "M10" else -1),
                    "display_dir": None,
                    "target": {"value": 2.0, "source_note": "synthetic"}
                    if mode == "target_distance"
                    else None,
                    "max_ref_spread_days": 92,
                    "staleness_limit_days": 120,
                    "transform_options": ["LEVEL", "YOY", "M3M3_ANN"] if i == "P01" else ["LEVEL"],
                    "default_transform": "M3M3_ANN" if i == "P01" else "LEVEL",
                    "alert_method": "none",
                    "priority": "core",
                    "currency_basis": "n/a",
                    "notes": [M18_NOTE] if i == "M18" else [],
                }
                for i, (n, unit, mode, dom) in META_INDICATORS.items()
            ],
        },
    )
    _dump(
        out / "meta" / "domains.json",
        {
            "schema_version": "1.0",
            "domains": [
                {
                    "domain_id": d,
                    "name": n,
                    "ranked": ranked,
                    "min_coverage_for_rank": 0.5,
                    "indicator_ids": ids,
                    "notices": [] if ranked else ["informational, unranked", "no composite rank"],
                    "percentile_rank_label": LABEL,
                }
                for d, (n, ranked, ids) in DOMAINS.items()
            ],
        },
    )
    _dump(
        out / "meta" / "groups.json",
        {
            "schema_version": "1.0",
            "groups": [
                {
                    "group_id": g,
                    "name": g,
                    "members": [
                        {"entity_id": e, "valid_from": "1999-01-01", "valid_to": None}
                        for e in sorted(ms)
                    ],
                }
                for g, ms in GROUPS.items()
            ],
        },
    )
    series = []
    for ind, (ents, sa, _, first_id) in SERIES_FILES.items():  # the explorer series files
        for i, e in enumerate(ents):
            series.append(_series_row(first_id + i, ind, e, "S1", "Synthetic source", sa))
    sid = 200
    for _, _, ids in DOMAINS.values():
        for ind in ids:
            if ind not in SERIES_FILES:
                series.append(_series_row(sid, ind, "DEU", "S2", "Synthetic source B"))
                sid += 1
    for row in series:  # M10 stands in for a WEO-fed, named-edition indicator (annual)
        if row["indicator_id"] == "M10":
            row.update(source_id=WEO_SOURCE, source_name="IMF WEO (synthetic)", frequency="A")
    fra = _series_row(WEO_SERIES["FRA"], "M10", "FRA", WEO_SOURCE, "IMF WEO (synthetic)")
    fra["frequency"] = "A"
    series.append(fra)
    _dump(out / "meta" / "series.json", {"schema_version": "1.0", "series": series})


def _series_row(
    series_id: int, ind: str, ent: str, src: str, src_name: str, sa: str = "SA"
) -> dict[str, object]:
    return {
        "series_id": series_id,
        "indicator_id": ind,
        "entity_id": ent,
        "source_id": src,
        "source_name": src_name,
        "series_key": f"SYN.{ind}.{ent}",
        "frequency": "M",
        "unit_code": "PCT",
        "unit_mult": 0,
        "base_period": None,
        "seasonal_adjustment": sa,
        "price_basis": "n/a",
        "flow_basis": "n/a",
        "calendar_basis": "n/a",
        "inherited": False,
        "licence_attribution": f"Synthetic fixture data ({src_name})",
        "source_url": "https://example.org/synthetic",
        "publish": "public",
        "reestimating": False,
        "published_precision": 1,
    }


def _ind(
    ind: str,
    ent: str,
    value: float | None,
    pct: float | None,
    ref: str,
    known: str,
    **kw: object,
) -> dict[str, object]:
    mode = META_INDICATORS[ind][2]
    row: dict[str, object] = {
        "indicator_id": ind,
        "series_id": 100 + ENTITIES.index(ent) if ind == "M09" and ent in ENTITIES else 300,
        "value": value,
        "transformed_value": value,
        "transform_id": "LEVEL",
        "rank_mode": mode,
        "value_kind": "observed",
        "ref_period_end": ref,
        "ref_offset_days": None if mode == "descriptive_only" else 0,
        "known_at": known,
        "source_release_at": known,
        "age_days": 30,
        "stale_limit_days": 120,
        "limit_source": "class",
        "is_stale": False,
        "alignment": "n/a" if mode == "descriptive_only" else "aligned",
        "alignment_reason": None,
        "inherited": False,
        "deviation": None,
        "published": True,
        "publish_scope": "ranked",
        "percentile": pct,
        "percentile_label": PCT_LABEL,
        "n_ranked": None if pct is None else 3,
        "alert_level": "none",
        "alert_confidence": "full",
    }
    row.update(kw)
    return row


def _ent(
    ent: str,
    inds: list[dict[str, object]],
    mean: float | None,
    n_avail: int,
    pos: int | None,
    n_ranked: int | None,
    low: bool = False,
) -> dict[str, object]:
    return {
        "entity_id": ent,
        "n_available": n_avail,
        "n_defined": sum(1 for i in inds if i["rank_mode"] != "descriptive_only"),
        "percentile_rank": mean,
        "percentile_rank_label": LABEL,
        "rank_position": pos,
        "n_ranked_entities": n_ranked,
        "low_coverage": low,
        "indicators": inds,
    }


def _sc(
    dom: str, ref: str, entities: list[dict[str, object]], hetero: bool = False
) -> dict[str, object]:
    ranked = DOMAINS[dom][1]
    # invented-but-consistent stored counts: n_ranked = indicators with a stored percentile
    counts: dict[str, int] = {}
    unaligned: dict[str, int] = {}
    for e in entities:
        for i in e["indicators"]:  # type: ignore[attr-defined]
            iid = str(i["indicator_id"])
            counts[iid] = counts.get(iid, 0) + (1 if i["percentile"] is not None else 0)
            unaligned[iid] = unaligned.get(iid, 0) + (
                1 if i["alignment"] in ("lagging", "unaligned") else 0
            )
    for e in entities:
        for i in e["indicators"]:  # type: ignore[attr-defined]
            i["n_ranked"] = counts[str(i["indicator_id"])] if i["percentile"] is not None else None
    sizes = [3, 3] if not hetero else [3, 6]
    return {
        "schema_version": "1.0",
        "domain_id": dom,
        "analysis_run_id": 1,
        "ranked": ranked,
        "min_coverage_for_rank": 0.5,
        "percentile_rank_label": LABEL,
        "heterogeneous_peer_set": hetero,
        "peer_set_size_by_indicator": {"min": sizes[0], "max": sizes[1]},
        "alignment": [
            {
                "indicator_id": i,
                "rank_reference_period": ref
                if ranked and META_INDICATORS[i][2] != "descriptive_only"
                else None,
                "reference_period_spread_days": 31
                if ranked and META_INDICATORS[i][2] != "descriptive_only"
                else None,
                "n_ranked": counts.get(i)
                if ranked and META_INDICATORS[i][2] != "descriptive_only"
                else None,
                "n_unaligned": unaligned.get(i, 0),
                "max_ref_spread_days": 92,
            }
            for i in DOMAINS[dom][2]
        ],
        "entities": entities,
    }


def _write_scorecards(out: Path, ref: str, known: str) -> None:
    """Domain files covering every AC-DASH-4 case (all numbers invented, none computed here).

    labour (several peer groups, see GROUPS): DEU, JPN, POL ranked (positions 1-3 of 4) and USA
    position 4 with a lagging M09 (value shown, no percentile); IND low coverage with an unaligned
    M09 (fiscal-year basis); FRA low coverage (M09 stale); ITA zero availability (M09 stale, M10
    missing; n/a); EA aggregate; M11 descriptive (no percentile).
    fin: unranked, M18 with the non-euro wording in meta/indicators.json (DEU euro, USA/POL not).
    prices: homogeneous peer set, target_distance indicator, one inherited value.
    agri and global: unranked domains (every percentile and position null).
    """
    old = "2025-12-31"
    lag = "2026-06-30"
    labour = [
        _ent(
            "DEU",
            [
                _ind("M09", "DEU", 3.1, 0.9, ref, known),
                _ind("M10", "DEU", 77.0, 0.8, ref, known),
                _ind("M11", "DEU", 53.1, None, ref, known),
            ],
            0.85,
            2,
            1,
            4,
        ),
        _ent(
            "JPN",
            [
                _ind("M09", "JPN", 2.6, 0.8, ref, known),
                _ind("M10", "JPN", 79.0, 0.7, ref, known),
                _ind("M11", "JPN", 74.0, None, ref, known),
            ],
            0.75,
            2,
            2,
            4,
        ),
        _ent(
            "POL",
            [
                _ind("M09", "POL", 2.9, 0.6, ref, known),
                _ind("M10", "POL", 70.0, 0.4, ref, known),
                _ind("M11", "POL", 25.0, None, ref, known),
            ],
            0.5,
            2,
            3,
            4,
        ),
        _ent(
            "USA",
            [
                _ind(
                    "M09",
                    "USA",
                    4.1,
                    None,
                    lag,
                    known,
                    alignment="lagging",
                    ref_offset_days=-92,
                ),
                _ind("M10", "USA", 71.0, 0.5, ref, known),
                _ind("M11", "USA", 213.0, None, ref, known),
            ],
            0.5,
            1,
            4,
            4,
        ),
        _ent(
            "IND",
            [
                _ind(
                    "M09",
                    "IND",
                    7.9,
                    None,
                    ref,
                    known,
                    alignment="unaligned",
                    alignment_reason="fiscal_year_basis",
                    ref_offset_days=150,
                ),
                _ind("M10", "IND", 52.0, 0.3, ref, known),
                _ind("M11", "IND", 960.0, None, ref, known),
            ],
            0.3,
            1,
            None,
            None,
            low=True,
        ),
        _ent(
            "FRA",
            [
                _ind("M09", "FRA", 7.4, None, old, known, is_stale=True, age_days=400),
                _ind("M10", "FRA", 69.0, 0.5, ref, known),
                _ind("M11", "FRA", 38.9, None, ref, known),
            ],
            0.5,
            1,
            None,
            None,
            low=True,
        ),
        _ent(
            "ITA",
            [
                _ind("M09", "ITA", 6.3, None, old, known, is_stale=True, age_days=400),
                _ind("M10", "ITA", None, None, None, known, alignment="n/a"),
                _ind("M11", "ITA", 36.8, None, ref, known),
            ],
            None,
            0,
            None,
            None,
        ),
        _ent(
            "EA",
            [_ind("M09", "EA", 6.2, None, ref, known, publish_scope="info_only")],
            None,
            0,
            None,
            None,
        ),
    ]
    prices = [
        _ent("DEU", [_ind("P01", "DEU", 2.4, 0.7, ref, known, deviation=0.4)], 0.7, 1, 1, 2),
        _ent(
            "FRA",
            [_ind("P01", "FRA", 1.9, None, ref, known, inherited=True, deviation=-0.1)],
            None,
            0,
            None,
            None,
        ),
        _ent("USA", [_ind("P01", "USA", 3.0, 0.2, ref, known, deviation=1.0)], 0.2, 1, 2, 2),
    ]

    def info(ind: str, ent: str, value: float | None) -> dict[str, object]:
        return _ind(ind, ent, value, None, ref, known, publish_scope="info_only")

    agri = [
        _ent("DEU", [info("A01", "DEU", 118.2)], None, 0, None, None),
        _ent("FRA", [info("A01", "FRA", None)], None, 0, None, None),
    ]
    fin = [
        _ent("DEU", [info("M18", "DEU", 0.4)], None, 0, None, None),
        _ent("USA", [info("M18", "USA", 1.2)], None, 0, None, None),
        _ent("POL", [info("M18", "POL", 2.8)], None, 0, None, None),
        _ent("EA", [info("M18", "EA", 0.5)], None, 0, None, None),
    ]
    glob = [_ent("WLD", [info("B01", "WLD", 2.1)], None, 0, None, None)]
    _dump(out / "scorecard" / "labour.json", _sc("labour", ref, labour, hetero=True))
    _dump(out / "scorecard" / "prices.json", _sc("prices", ref, prices))
    _dump(out / "scorecard" / "agri.json", _sc("agri", ref, agri))
    _dump(out / "scorecard" / "global.json", _sc("global", ref, glob))
    _dump(out / "scorecard" / "fin.json", _sc("fin", ref, fin))


if __name__ == "__main__":
    import sys

    build_export(Path(sys.argv[1]))
