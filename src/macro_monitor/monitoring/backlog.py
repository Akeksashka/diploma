# ruff: noqa: E501
"""Load backlog and ordering checks, and the manual-download reminder
(validation-monitoring-spec section 2: LOAD-01, ORD-01..03, FRESH-03).

LOAD-01 reads the unloaded queue (``ingest.v_raw_unloaded``). ORD-01..03 report what the loader already
recorded (``raw_load`` / ``raw_series_status``); they never decide anything. FRESH-03 is a pure date rule
over the ``reminders`` of a manual source. All results are appended to ``ops.validation_result``;
failing checks are returned as ``issues.Finding`` (counts and ids only).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal

import psycopg
from psycopg.types.json import Jsonb

from macro_monitor.monitoring.issues import Finding

LOAD_WARN_DAYS = 1.0
LOAD_ERROR_DAYS = 40.0
FRESH03_ESCALATION_DAYS = 45

Severity = Literal["info", "warn", "error"]
Fresh03State = Literal["none", "reminder", "escalation"]


def backlog_severity(oldest_age_days: float | None) -> Severity:
    """LOAD-01: > 1 day warn, > 40 days error."""
    if oldest_age_days is None or oldest_age_days <= LOAD_WARN_DAYS:
        return "info"
    return "error" if oldest_age_days > LOAD_ERROR_DAYS else "warn"


@dataclass(frozen=True)
class UnloadedObject:
    raw_id: int
    source_id: str
    group_id: str
    fetched_at: datetime


def read_unloaded(conn: psycopg.Connection) -> list[UnloadedObject]:
    rows = conn.execute(
        "SELECT raw_id, source_id, group_id, fetched_at FROM ingest.v_raw_unloaded ORDER BY source_id, group_id, fetched_at, raw_id"
    ).fetchall()
    return [UnloadedObject(*r) for r in rows]


@dataclass(frozen=True)
class GroupBacklog:
    source_id: str
    group_id: str
    n_unloaded: int
    oldest_age_days: float
    severity: Severity
    blocking_raw_id: int
    held_raw_ids: tuple[int, ...]  # ORD-02: later objects held behind blocking_raw_id


def evaluate_backlog(objects: Iterable[UnloadedObject], now: datetime) -> list[GroupBacklog]:
    """Per (source, group): oldest age (LOAD-01) and the objects held behind the oldest (ORD-02).

    The oldest unloaded object of a group by ``(fetched_at, raw_id)`` blocks every later one."""
    groups: dict[tuple[str, str], list[UnloadedObject]] = {}
    for o in objects:
        groups.setdefault((o.source_id, o.group_id), []).append(o)
    out: list[GroupBacklog] = []
    for (src, grp), objs in sorted(groups.items()):
        objs.sort(key=lambda o: (o.fetched_at, o.raw_id))
        age = (now - objs[0].fetched_at).total_seconds() / 86400
        out.append(
            GroupBacklog(
                src,
                grp,
                len(objs),
                age,
                backlog_severity(age),
                objs[0].raw_id,
                tuple(o.raw_id for o in objs[1:]),
            )
        )
    return out


def record_backlog(
    conn: psycopg.Connection, run_id: int | None, now: datetime
) -> tuple[list[Finding], list[str]]:
    """Write LOAD-01 and ORD-02 rows; return (findings, passed title keys).

    Passed keys cover every group that has no backlog now, so open issues can be closed."""
    groups = evaluate_backlog(read_unloaded(conn), now)
    findings: list[Finding] = []
    for g in groups:
        ok = g.severity == "info"
        conn.execute(
            "INSERT INTO ops.validation_result (run_id, check_id, severity, source_id, subject, passed, metric, threshold, detail)"
            " VALUES (%s,'LOAD-01',%s,%s,%s,%s,%s,%s,%s)",
            [
                run_id,
                g.severity,
                g.source_id,
                g.group_id,
                ok,
                round(g.oldest_age_days, 3),
                LOAD_ERROR_DAYS if g.severity == "error" else LOAD_WARN_DAYS,
                Jsonb({"n_unloaded": g.n_unloaded, "blocking_raw_id": g.blocking_raw_id}),
            ],
        )
        if not ok:
            findings.append(
                Finding(
                    "LOAD-01",
                    g.group_id,
                    labels=("pipeline",),
                    ids=[str(g.blocking_raw_id)],
                    metrics={"n_unloaded": g.n_unloaded, "oldest_age_days": int(g.oldest_age_days)},
                )
            )
        if g.held_raw_ids:
            conn.execute(
                "INSERT INTO ops.validation_result (run_id, check_id, severity, source_id, subject, passed, metric, detail)"
                " VALUES (%s,'ORD-02','warn',%s,%s,false,%s,%s)",
                [
                    run_id,
                    g.source_id,
                    g.group_id,
                    len(g.held_raw_ids),
                    Jsonb(
                        {
                            "blocking_raw_id": g.blocking_raw_id,
                            "held_raw_ids": list(g.held_raw_ids)[:20],
                        }
                    ),
                ],
            )
            findings.append(
                Finding(
                    "ORD-02",
                    g.group_id,
                    labels=("pipeline",),
                    ids=[str(g.blocking_raw_id)],
                    metrics={"held": len(g.held_raw_ids)},
                )
            )
    if not groups:
        conn.execute(
            "INSERT INTO ops.validation_result (run_id, check_id, severity, subject, passed, metric)"
            " VALUES (%s,'LOAD-01','info','all',true,0)",
            [run_id],
        )
    bad = {f.title for f in findings}
    keys = {
        f"[{fam}] {r[0]}"
        for fam in ("LOAD-01", "ORD-02")
        for r in conn.execute("SELECT DISTINCT group_id FROM ref.series_group").fetchall()
    }
    return findings, sorted(keys - bad)


@dataclass(frozen=True)
class OrderSkip:
    raw_id: int
    source_id: str
    group_id: str
    request_key: str
    n_series: int
    newer_edition: str | None


def read_order_skips(
    conn: psycopg.Connection, since: datetime
) -> tuple[list[OrderSkip], list[OrderSkip]]:
    """(ORD-01 skips, ORD-03 older-edition skips) recorded at or after ``since``.

    ORD-01 counts per-series skips from ``raw_series_status`` (whole-object skips report the object)."""
    rows = conn.execute(
        """
        SELECT o.raw_id, o.source_id, o.group_id, o.request_key,
               coalesce(l.detail ->> 'reason', '') = 'older_edition' AS older,
               (SELECT count(*) FROM ingest.raw_series_status s
                 WHERE s.raw_id = o.raw_id AND s.status = 'skipped_out_of_order'),
               (SELECT x.edition_label FROM ingest.raw_object x JOIN ingest.raw_load xl USING (raw_id)
                 WHERE x.source_id = o.source_id AND x.group_id = o.group_id AND xl.outcome = 'loaded'
                   AND x.edition_date IS NOT NULL
                 ORDER BY x.edition_date DESC, x.raw_id DESC LIMIT 1)
          FROM ingest.raw_load l JOIN ingest.raw_object o USING (raw_id)
         WHERE l.outcome = 'skipped_out_of_order' AND l.loaded_at >= %s
         ORDER BY o.raw_id
        """,
        [since],
    ).fetchall()
    ord1: list[OrderSkip] = []
    ord3: list[OrderSkip] = []
    for raw_id, src, grp, key, older, n, newer in rows:
        (ord3 if older else ord1).append(OrderSkip(raw_id, src, grp, key, int(n), newer))
    seen = {s.raw_id for s in ord1}
    # series-level skips of objects that otherwise loaded
    for raw_id, src, grp, key, n in conn.execute(
        """
        SELECT o.raw_id, o.source_id, o.group_id, o.request_key, count(*)
          FROM ingest.raw_series_status s JOIN ingest.raw_object o USING (raw_id)
         WHERE s.status = 'skipped_out_of_order' AND s.recorded_at >= %s
         GROUP BY o.raw_id, o.source_id, o.group_id, o.request_key ORDER BY o.raw_id
        """,
        [since],
    ).fetchall():
        if raw_id not in seen:
            ord1.append(OrderSkip(raw_id, src, grp, key, int(n), None))
    return sorted(ord1, key=lambda s: s.raw_id), ord3


def record_order_checks(
    conn: psycopg.Connection, run_id: int | None, since: datetime
) -> list[Finding]:
    """Write ORD-01 and ORD-03 rows (warn, one per object) and return one finding per group and check."""
    ord1, ord3 = read_order_skips(conn, since)
    findings: list[Finding] = []
    for check, skips in (("ORD-01", ord1), ("ORD-03", ord3)):
        by_group: dict[str, list[OrderSkip]] = {}
        for s in skips:
            conn.execute(
                "INSERT INTO ops.validation_result (run_id, check_id, severity, source_id, subject, passed, metric, detail)"
                " VALUES (%s,%s,'warn',%s,%s,false,%s,%s)",
                [
                    run_id,
                    check,
                    s.source_id,
                    s.group_id,
                    s.n_series,
                    Jsonb(
                        {
                            "raw_id": s.raw_id,
                            "request_key": s.request_key,
                            "newer_edition": s.newer_edition,
                        }
                    ),
                ],
            )
            by_group.setdefault(s.group_id, []).append(s)
        for grp, items in sorted(by_group.items()):
            ids = (
                [s.request_key for s in items]
                if check == "ORD-03"
                else [str(s.raw_id) for s in items]
            )
            findings.append(
                Finding(
                    check,
                    grp,
                    labels=("pipeline",) if check == "ORD-01" else ("manual-action",),
                    ids=ids,
                    metrics={"objects": len(items), "series": sum(s.n_series for s in items)},
                )
            )
    return findings


@dataclass(frozen=True)
class Reminder:
    source_id: str
    group_id: str
    month: int  # release month (== remind_on.month)
    day: int  # remind_on.day (<= 25, the preflight day)
    text: str


def reminders_from_config(sources: Iterable[Mapping[str, Any]]) -> list[Reminder]:
    """Reminders of manual sources, attached to their first ``edition_ordered`` group."""
    out: list[Reminder] = []
    for s in sources:
        rems = s.get("reminders") or []
        grp = next((g["id"] for g in s.get("groups") or [] if g.get("edition_ordered")), None)
        if rems and grp:
            for r in rems:
                on = r["remind_on"]
                out.append(
                    Reminder(
                        str(s["id"]), str(grp), int(on["month"]), int(on["day"]), str(r["text"])
                    )
                )
    return out


def fresh03_state(
    rem: Reminder, today: date, *, edition_present: bool
) -> tuple[Fresh03State, date]:
    """FRESH-03 for this calendar year's occurrence of the reminder.

    Returns (state, first of the release month): none before ``remind_on`` (and once the edition is
    present), ``reminder`` from ``remind_on``, ``escalation`` 45 days after the first of the release
    month. Last year's occurrence is not re-reported (the window resets on 1 January)."""
    first = date(today.year, rem.month, 1)
    if edition_present or today < date(today.year, rem.month, rem.day):
        return "none", first
    if today >= first + timedelta(days=FRESH03_ESCALATION_DAYS):
        return "escalation", first
    return "reminder", first


def edition_present(conn: psycopg.Connection, rem: Reminder, first_of_month: date) -> bool:
    """A manual object of the group with ``edition_date`` on or after the first of the release month."""
    row = conn.execute(
        "SELECT EXISTS (SELECT 1 FROM ingest.raw_object WHERE source_id = %s AND group_id = %s"
        " AND manual AND edition_date >= %s)",
        [rem.source_id, rem.group_id, first_of_month],
    ).fetchone()
    assert row is not None
    return bool(row[0])


def record_fresh03(
    conn: psycopg.Connection, run_id: int | None, reminders: Iterable[Reminder], today: date
) -> list[Finding]:
    """Evaluate each reminder, write a FRESH-03 row (warn when due) and return findings."""
    findings: list[Finding] = []
    for rem in reminders:
        first = date(today.year, rem.month, 1)
        state, _ = fresh03_state(rem, today, edition_present=edition_present(conn, rem, first))
        due = state != "none"
        conn.execute(
            "INSERT INTO ops.validation_result (run_id, check_id, severity, source_id, subject, passed, detail)"
            " VALUES (%s,'FRESH-03',%s,%s,%s,%s,%s)",
            [
                run_id,
                "warn" if due else "info",
                rem.source_id,
                rem.group_id,
                not due,
                Jsonb({"state": state, "release_month": first.isoformat()}),
            ],
        )
        if due:
            findings.append(
                Finding(
                    "FRESH-03",
                    f"{rem.source_id} {first:%Y-%m}",
                    labels=("manual-action", "freshness"),
                    metrics={"escalated": int(state == "escalation")},
                )
            )
    return findings
