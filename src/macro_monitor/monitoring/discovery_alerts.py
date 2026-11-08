"""One ``discovery_failed`` alert per source per month (ADR-028 D5, ADR-007).

The alert key is ``[discovery_failed] <source_id> <YYYY-MM>``: ``sync_issues`` opens one issue per
key and comments on repeats, so a source that fails on every run of a month raises one issue, and
the next month opens a new one. Bodies carry counts only.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import psycopg

from macro_monitor.monitoring.issues import Finding

FAMILY = "discovery_failed"
LABELS = ("source-drift", "manual-action")


def month_key(source_id: str, at: datetime) -> str:
    return f"{source_id} {at:%Y-%m}"


def discovery_findings(conn: psycopg.Connection, now: datetime) -> Sequence[Finding]:
    """One finding per source with a ``discovery_failed`` fetch attempt in ``now``'s UTC month."""
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    rows = conn.execute(
        "SELECT source_id, count(*) FROM ingest.fetch_attempt"
        " WHERE error_class = 'discovery_failed' AND attempted_at >= %s AND attempted_at < %s"
        " GROUP BY source_id ORDER BY source_id",
        [start, end],
    ).fetchall()
    return [
        Finding(FAMILY, month_key(str(src), now), labels=LABELS, metrics={"attempts": int(n)})
        for src, n in rows
    ]
