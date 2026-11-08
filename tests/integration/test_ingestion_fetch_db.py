"""T25 against a throwaway database: fetch, archive, parse, manifest + staging, isolation.

AC-ING-5(b) (kill between upload and commit leaves no orphan row), AC-ING-2 (unchanged writes only
a fetch_attempt), run-scoped staging, per-group isolation. The mock transport serves the recorded
Eurostat fixture; no network.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import psycopg
import pytest

from macro_monitor.ingestion import fetch
from macro_monitor.ingestion.archive import LocalDirStore
from macro_monitor.ingestion.base import GroupConfig, RawObject, SeriesFilter
from macro_monitor.ingestion.connectors.sdmx import EurostatConnector, load_series_entries
from macro_monitor.ingestion.fetch import GroupJob
from macro_monitor.ingestion.http import HttpClient, HttpSettings
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[2]
BODY = (ROOT / "tests/fixtures/raw/eurostat/une_rt_m_synthetic.json").read_bytes()
SERIES = load_series_entries(ROOT / "config/series_map/eurostat_labour.yaml")
BASE = "https://ec.europa.eu/eurostat/api/dissemination/"


def _group(group_id: str = "eurostat_labour", datasets: tuple[str, ...] = ("une_rt_m",)) -> Any:
    return GroupConfig(
        source_id="eurostat",
        group_id=group_id,
        base_url=BASE,
        request_template={
            "path": "statistics/1.0/data/{dataset}",
            "params": {"format": "JSON", "sinceTimePeriod": "1991-01", "geo": "{entities}"},
            "datasets": list(datasets),
            "fixed_filters": {"une_rt_m": {"freq": "M", "s_adj": "SA"}},
        },
        fetch_scope="complete",
        missing_markers=frozenset({":"}),
        series=SERIES,
    )


def _http(body: bytes = BODY) -> HttpClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, headers={"content-type": "application/json"})

    return HttpClient(
        HttpSettings(base_url=BASE),
        repo_url="https://example.invalid/repo",
        transport=httpx.MockTransport(handler),
    )


@pytest.fixture
def conn(test_database: TestDatabase, tmp_path: Path) -> Iterator[psycopg.Connection]:
    real = {m.version: m for m in migrate.discover()}
    mig = tmp_path / "mig"
    mig.mkdir()
    for v in (0, 1, 3):
        (mig / real[v].path.name).write_text(real[v].sql, encoding="utf-8")
    (mig / "0002_placeholder.sql").write_text("SELECT 1;", encoding="utf-8")
    with test_database.connect() as c:
        migrate.migrate(c, mig)
        c.execute(
            "INSERT INTO ref.source VALUES "
            "('eurostat','p','rest','public','public','l','a','x',true)"
        )
        c.commit()
        yield c


def _run(conn: psycopg.Connection) -> int:
    return fetch.open_run(
        conn,
        workflow="w",
        trigger="local",
        mode="refresh",
        git_sha="g",
        code_version="c",
        started_at=datetime(2026, 11, 1, tzinfo=UTC),
    )


def _job(group: GroupConfig | None = None, connector: Any = None) -> GroupJob:
    return GroupJob(
        source={"id": "eurostat", "kind": "api"},
        group=group or _group(),
        connector=connector or EurostatConnector(),
        parser_id="jsonstat_v1@1",
        basename="une_rt_m.json",
    )


def _n(conn: psycopg.Connection, table: str) -> int:
    row = conn.execute(f"SELECT count(*) FROM {table}").fetchone()
    assert row is not None
    return int(row[0])


def test_new_then_unchanged(conn: psycopg.Connection, tmp_path: Path) -> None:
    store = LocalDirStore(tmp_path / "raw")
    run1 = _run(conn)
    r1 = fetch.fetch_group(conn, store, _job(), _http(), run1)
    assert r1.ok
    assert r1.outcomes == ["new"]
    assert len(r1.raw_ids) == 1
    raw_id = r1.raw_ids[0]
    assert _n(conn, "ingest.raw_object") == 1
    assert _n(conn, "ingest.raw_blob") == 1
    obs_rows = conn.execute(
        "SELECT DISTINCT run_id, raw_id FROM staging.observation_load"
    ).fetchall()
    assert obs_rows == [(run1, raw_id)]
    metas = conn.execute("SELECT DISTINCT run_id, raw_id FROM staging.series_meta_load").fetchall()
    assert metas == [(run1, raw_id)]
    assert _n(conn, "staging.series_meta_load") == 3
    sref = conn.execute("SELECT min(series_ref) FROM staging.series_meta_load").fetchone()
    assert sref is not None
    assert str(sref[0]).startswith("une_rt_m|")
    st = conn.execute("SELECT last_status, last_sha256 FROM ingest.request_state").fetchone()
    assert st is not None
    assert st[0] == "new"
    assert st[1]

    staged = _n(conn, "staging.observation_load")
    run2 = _run(conn)
    r2 = fetch.fetch_group(conn, store, _job(), _http(), run2)
    assert r2.outcomes == ["unchanged"]
    assert r2.ok
    assert _n(conn, "ingest.raw_object") == 1
    assert _n(conn, "staging.observation_load") == staged
    attempts = conn.execute(
        "SELECT run_id, outcome FROM ingest.fetch_attempt ORDER BY attempt_id"
    ).fetchall()
    assert attempts == [(run1, "new"), (run2, "unchanged")]


class _KilledParse(EurostatConnector):
    def parse(self, raw: RawObject, series_filter: SeriesFilter) -> Any:
        raise RuntimeError("killed between upload and commit")


def test_kill_between_upload_and_commit_leaves_no_row(
    conn: psycopg.Connection, tmp_path: Path
) -> None:
    """AC-ING-5(b): asset uploaded, manifest never committed; the re-run fetches again."""
    root = tmp_path / "raw"
    store = LocalDirStore(root)
    run1 = _run(conn)
    r1 = fetch.fetch_group(conn, store, _job(connector=_KilledParse()), _http(), run1)
    assert not r1.ok
    assert r1.outcomes == ["error"]
    assert any(p.is_file() for p in root.rglob("*"))  # the uploaded asset exists ...
    for table in (
        "ingest.raw_object",
        "ingest.raw_blob",
        "staging.observation_load",
        "staging.series_meta_load",
        "ingest.request_state",
    ):
        assert _n(conn, table) == 0, table  # ... but no database row refers to it
    row = conn.execute("SELECT outcome, error_class, raw_id FROM ingest.fetch_attempt").fetchone()
    assert row == ("error", "RuntimeError", None)

    run2 = _run(conn)
    r2 = fetch.fetch_group(conn, store, _job(), _http(), run2)
    assert r2.outcomes == ["new"]
    assert _n(conn, "ingest.raw_object") == 1
    assert _n(conn, "ingest.raw_blob") == 1


def test_group_isolation_and_run_status(conn: psycopg.Connection, tmp_path: Path) -> None:
    store = LocalDirStore(tmp_path / "raw")
    bad = _job(_group("eurostat_bad", datasets=("nope",)))  # plan raises: no mapped series
    good = _job()
    run_id = _run(conn)
    rep = fetch.fetch_groups(conn, store, [bad, good], lambda _j: _http(), run_id=run_id)
    assert rep.status == "partial"
    assert [g.ok for g in rep.groups] == [False, True]
    assert rep.groups[0].error is not None
    assert _n(conn, "ingest.raw_object") == 1
    st = conn.execute(
        "SELECT status, finished_at IS NOT NULL FROM ingest.run WHERE run_id = %s", [run_id]
    ).fetchone()
    assert st == ("partial", True)


def test_snapshot_recorded_only_for_diff_above_tol(
    conn: psycopg.Connection, tmp_path: Path
) -> None:
    import dataclasses

    store = LocalDirStore(tmp_path / "raw")
    grp = dataclasses.replace(_group(), snapshot_mode="diff_above_tol")
    rep = fetch.fetch_group(conn, store, _job(grp), _http(), _run(conn))
    assert rep.ok
    assert _n(conn, "ingest.raw_snapshot") == 1


def test_load_attempt_history_returns_latest_attempt_per_key(conn: psycopg.Connection) -> None:
    """ATTEMPT_HISTORY_SQL against the real ingest.fetch_attempt table (latest wins, per key)."""
    from macro_monitor.models.types import RequestSpec
    from macro_monitor.storage import manifest

    run_id = _run(conn)
    t = [datetime(2026, 11, 1, h, tzinfo=UTC) for h in (1, 2, 3)]
    rows = [("a", t[0], "new"), ("a", t[2], "rate_limited"), ("a", t[1], "error"),
            ("b", t[1], "unchanged"), ("other", t[2], "new")]  # fmt: skip
    for key, at, outcome in rows:
        manifest.insert_fetch_attempt(
            conn, run_id=run_id, source_id="eurostat", request_key=key,
            attempted_at=at, outcome=outcome,
        )  # fmt: skip
    conn.commit()
    specs = [
        RequestSpec("eurostat", "g", "GET", "https://x/", {}, {}, k, "full", "complete")
        for k in ("a", "b", "never")
    ]
    history = fetch.load_attempt_history(conn, specs)
    assert history == {"a": (t[2], "rate_limited"), "b": (t[1], "unchanged")}
    assert fetch.load_attempt_history(conn, []) == {}
