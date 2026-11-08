"""``status.json`` (T83; export spec section 5, AC-EXP-10).

Feed freshness and quality for the dashboard: no secrets, no connection details, no raw error
text, no values. Everything comes from the ``ops.v_*`` views readable by ``mm_reader``;
``last_run`` is copied from ``ops.v_run_summary_public`` (published-scope counts computed by the
view itself, so nothing is filtered or recomputed here). Config-only items (the expected release
windows of manual sources) are read from the config tree at the run's ``git_sha``.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from datetime import UTC, date, datetime
from typing import Any

from macro_monitor.publish.export import ExportError, ExportSession, ExportSink, Producer
from macro_monitor.publish.manifest import RunInfo, utc_text
from macro_monitor.publish.meta import SOURCES_PATH, ConfigTree
from macro_monitor.publish.scorecard import day, stamp

STATUS_JSON_SCHEMA_VERSION = "1.0"
#: Text of the human monthly check (workflows spec section 9, level (b)).
SCHEDULE_CHECK_TEXT = (
    "Monthly check on the 2nd (about two minutes): (1) open the Actions tab and confirm a "
    "monthly-refresh run for the 1st; (2) confirm ops/heartbeat.json has a commit from that date; "
    "(3) confirm the site stale banner is absent; (4) confirm that no pipeline issue is open; "
    "(5) every April and October confirm the WEO file was committed (reminder issue)."
)
RUN_SUMMARY_COLS = (
    "ingest_run_id", "started_at", "finished_at", "mode", "new_raw_objects", "new_observations",
    "revisions", "alerts_opened",
)  # fmt: skip


def last_run(session: ExportSession, ingest_run_id: int) -> dict[str, Any]:
    """The row of ``ops.v_run_summary_public`` for the run (``alerts_opened`` is null when the
    run has no analysis run: the view says so, the export does not)."""
    rows = session.fetch(
        f"SELECT {', '.join(RUN_SUMMARY_COLS)} FROM ops.v_run_summary_public "
        "WHERE ingest_run_id = %s",
        [ingest_run_id],
    )
    if not rows:
        raise ExportError(
            f"STATUS: no ops.v_run_summary_public row for run {ingest_run_id}", "STATUS"
        )
    r = dict(zip(RUN_SUMMARY_COLS, rows[0], strict=True))
    r["started_at"] = stamp(r["started_at"])
    r["finished_at"] = stamp(r["finished_at"])
    return r


def _next_window(reminders: list[Mapping[str, Any]], today: date) -> dict[str, str] | None:
    """First configured expected-release window that has not ended on ``today`` (this year or
    next). Dates are configuration read as is; release months are [UNVERIFIED] in the config."""
    best: tuple[date, dict[str, str]] | None = None
    for year in (today.year, today.year + 1):
        for rem in reminders:
            w, on = rem["expected_window"], rem["remind_on"]
            start = date(year, int(w["month"]), int(w["from_day"]))
            end = date(year, int(w["month"]), int(w["to_day"]))
            if end < today:
                continue
            if best is None or start < best[0]:
                best = (
                    start,
                    {
                        "window_from": start.isoformat(),
                        "window_to": end.isoformat(),
                        "remind_on": date(year, int(on["month"]), int(on["day"])).isoformat(),
                    },
                )
    return None if best is None else best[1]


def manual_sources(session: ExportSession, config: ConfigTree, as_of: date) -> list[dict[str, Any]]:
    stored = {r[0]: r for r in session.fetch(
        "SELECT source_id, last_edition_date, last_ingested_at FROM ops.v_manual_sources"
    )}  # fmt: skip
    cfg = {
        str(s["id"]): s for s in config.yaml(SOURCES_PATH)["sources"] if s.get("kind") == "manual"
    }
    out = []
    for sid in sorted(set(stored) | set(cfg)):
        row = stored.get(sid)
        out.append(
            {
                "source_id": sid,
                "last_edition_date": day(row[1]) if row else None,
                "last_ingested_at": stamp(row[2]) if row else None,
                "next_expected": _next_window(list(cfg[sid].get("reminders") or []), as_of)
                if sid in cfg
                else None,
            }
        )
    return out


def validation_block(session: ExportSession, ingest_run_id: int) -> dict[str, Any]:
    rows = session.fetch(
        "SELECT check_family, check_id, severity, subject, n_results, n_failed, n_qualifying, "
        "not_yet_measurable FROM ops.v_validation_counts WHERE run_id = %s "
        "ORDER BY check_family, check_id, severity, subject",
        [ingest_run_id],
    )
    fam: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    cov = []
    for family, check_id, sev, subject, n, failed, n_qual, not_yet in rows:
        fam[(family, sev)][0] += n
        fam[(family, sev)][1] += failed
        if check_id == "COV-01":
            entry: dict[str, Any] = {"indicator_id": subject, "n_qualifying": n_qual}
            if not_yet:
                entry["state"] = "not_yet_measurable"
            else:
                entry.update(state="measured", n_results=n, n_failed=failed)
            cov.append(entry)
    drift: dict[str, int] = defaultdict(int)
    for (kind,) in session.fetch("SELECT kind FROM ops.v_open_drift ORDER BY event_id"):
        drift[kind] += 1
    return {
        "counts": [
            {"check_family": f, "severity": s, "n_results": v[0], "n_failed": v[1]}
            for (f, s), v in sorted(fam.items())
        ],
        "cov01": cov,
        "open_drift": {"n_open": sum(drift.values()), "by_kind": dict(sorted(drift.items()))},
    }


def disabled_groups(config: ConfigTree) -> set[tuple[str, str]]:
    """(source_id, group_id) pairs whose effective state is disabled (ADR-027: source AND group)."""
    out: set[tuple[str, str]] = set()
    for s in config.yaml(SOURCES_PATH)["sources"]:
        src_on = s.get("enabled", True)
        for g in s.get("groups") or []:
            if not (src_on and g.get("enabled", True)):
                out.add((str(s["id"]), str(g["id"])))
    return out


def groups_block(session: ExportSession, config: ConfigTree) -> dict[str, Any]:
    """Freshness per group; groups whose effective state is disabled are omitted (ADR-027 Q5)."""
    off = disabled_groups(config)
    fresh = [
        {
            "source_group": sg,
            "series_group": ser,
            "state": state,
            "expected_period_end": day(exp),
            "latest_period_end": day(lat),
            "evaluated_at": stamp(ev),
            # No per-group load result exists in any mm_reader view (ops.run_summary.groups is
            # not readable): reported as a gap, null until the DDL spec provides one.
            "load_result": None,
        }
        for sg, ser, state, exp, lat, ev in session.fetch(
            "SELECT source_group, series_group, state, expected_period_end, latest_period_end, "
            "evaluated_at FROM ops.v_freshness_latest ORDER BY source_group, series_group"
        )
        if (sg, ser) not in off
    ]
    n_unloaded, oldest = session.fetch("SELECT n_unloaded, oldest_age FROM ops.v_backlog")[0]
    return {
        "groups": fresh,
        "backlog": {
            "n_unloaded": n_unloaded,
            # ops.v_backlog.oldest_age is now() - min(fetched_at), a database-clock value; whole
            # days keep the file stable between two exports of the same run (EXP-08).
            "oldest_age_days": None if oldest is None else oldest.days,
        },
    }


def status_producer(config: ConfigTree, *, generated_at: datetime) -> Producer:
    """Producer of ``status.json``. ``generated_at`` is the build time of the manifest (the one
    wall-clock value of the export, passed in so that ``now()`` is read once)."""

    def produce(session: ExportSession, run: RunInfo, sink: ExportSink) -> None:
        config.verify(run)
        blocks = groups_block(session, config)
        doc = {
            "schema_version": STATUS_JSON_SCHEMA_VERSION,
            "last_run": last_run(session, run.ingest_run_id),
            "groups": blocks["groups"],
            "backlog": blocks["backlog"],
            "validation": validation_block(session, run.ingest_run_id),
            "manual_sources": manual_sources(session, config, run.as_of_run_date),
            "schedule_check": {
                "generated_at": utc_text(generated_at.astimezone(UTC)),
                "text": SCHEDULE_CHECK_TEXT,
            },
        }
        sink.add_json("status.json", doc, schema="status", rows=None)

    return produce
