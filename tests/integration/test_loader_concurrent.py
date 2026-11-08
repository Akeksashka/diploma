# ruff: noqa: E501
"""AC-ING-9 (A3): refresh staging and manual staging truly concurrent, then both drains.

Two sessions run the real fetch+stage leg (`fetch_group`, recorded Eurostat fixture, mock transport)
of two groups at the same moment; a plan-like queue read runs in between. Afterwards no staging row
of either run is missing, both drains complete, and the final state equals the fixture content
exactly once (no duplicate observations) whatever the fetch order was.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import pytest

from macro_monitor.ingestion import fetch
from macro_monitor.ingestion.archive import LocalDirStore
from macro_monitor.ingestion.base import GroupConfig
from macro_monitor.ingestion.connectors.sdmx import EurostatConnector, load_series_entries
from macro_monitor.ingestion.fetch import GroupJob
from macro_monitor.ingestion.http import HttpClient, HttpSettings
from macro_monitor.registry.config import load_yaml
from macro_monitor.registry.sync import MapEntry, parse_series_map
from macro_monitor.storage import loader, migrate
from macro_monitor.storage.loader import make_insert

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[2]
MAP_FILE = ROOT / "config/series_map/eurostat_labour.yaml"
BODY = (ROOT / "tests/fixtures/raw/eurostat/une_rt_m_synthetic.json").read_bytes()
SERIES = load_series_entries(MAP_FILE)
BASE = "https://ec.europa.eu/eurostat/api/dissemination/"
GROUPS = ("eurostat_labour", "eurostat_manual")


def _job(group_id: str) -> GroupJob:
    group = GroupConfig(
        source_id="eurostat",
        group_id=group_id,
        base_url=BASE,
        request_template={
            "path": "statistics/1.0/data/{dataset}",
            "params": {
                "format": "JSON",
                "sinceTimePeriod": "1991-01",
                "geo": "{entities}",
                "g": group_id,
            },
            "datasets": ["une_rt_m"],
            "fixed_filters": {"une_rt_m": {"freq": "M", "s_adj": "SA"}},
        },
        fetch_scope="complete",
        missing_markers=frozenset({":"}),
        series=SERIES,
    )
    return GroupJob(
        source={"id": "eurostat", "kind": "api"},
        group=group,
        connector=EurostatConnector(),
        parser_id="jsonstat_v1@1",
        basename=f"{group_id}.json",
    )


def _http() -> HttpClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=BODY, headers={"content-type": "application/json"})

    return HttpClient(
        HttpSettings(base_url=BASE),
        repo_url="https://example.invalid/repo",
        transport=httpx.MockTransport(handler),
    )


def _provider(source: str, group: str, sha: str) -> Sequence[MapEntry]:
    return parse_series_map(source, group, load_yaml(MAP_FILE), "map")


@pytest.fixture
def db(test_database: TestDatabase) -> Iterator[TestDatabase]:
    with test_database.connect() as c:
        migrate.migrate(c)
        c.execute(
            "INSERT INTO ref.source VALUES ('eurostat','p','rest','public','public','l','a','x',true)"
        )
        for g in GROUPS:
            c.execute(
                "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES ('eurostat',%s,'x')",
                [g],
            )
        for e in _provider("eurostat", GROUPS[0], "g"):
            c.execute(
                "INSERT INTO ref.entity VALUES (%s,%s,'country',true,false) ON CONFLICT DO NOTHING",
                [e.entity, e.entity],
            )
            c.execute(
                "INSERT INTO ref.indicator (indicator_id, name, kind, tier, priority, currency_basis, "
                "staleness_class, transform_id, alert_method, adverse_dir, good_dir, rank_mode, "
                "stationarity_class, release_lag_aware) VALUES (%s,%s,'indicator','M','core','NA',"
                "'ACT120','level','z',0,1,'monotone_good','stationary',false) ON CONFLICT DO NOTHING",
                [e.indicator, e.indicator],
            )
        c.commit()
    return test_database


@pytest.mark.timeout(240)
def test_concurrent_refresh_and_manual_staging_then_drains(
    db: TestDatabase, tmp_path: Path
) -> None:
    store = LocalDirStore(tmp_path / "raw")
    with db.connect(timeout=30) as setup:
        runs = [
            fetch.open_run(
                setup, workflow=w, trigger="local", mode=m, git_sha="g", code_version="c",
                started_at=datetime(2026, 11, 1, tzinfo=UTC),
            )
            for w, m in (("monthly-refresh", "refresh"), ("ingest-manual", "manual"))
        ]  # fmt: skip
    barrier = threading.Barrier(2)
    reports: dict[str, Any] = {}
    errors_: list[BaseException] = []

    def run(group_id: str, run_id: int) -> None:
        try:
            with db.connect(timeout=60) as c:
                barrier.wait(30)
                reports[group_id] = fetch.fetch_group(c, store, _job(group_id), _http(), run_id)
        except BaseException as exc:
            errors_.append(exc)

    threads = [threading.Thread(target=run, args=(g, r)) for g, r in zip(GROUPS, runs, strict=True)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(120)
    assert not errors_, errors_
    assert all(reports[g].ok and reports[g].outcomes == ["new"] for g in GROUPS)

    with db.connect(timeout=60) as c:
        # a third run's plan reads the queue in between: both objects are queued, staging untouched
        assert len(loader.read_queue(c)) == 2
        per_run = dict(
            c.execute(
                "SELECT run_id, count(*) FROM staging.observation_load GROUP BY run_id"
            ).fetchall()
        )
        metas = dict(
            c.execute(
                "SELECT run_id, count(*) FROM staging.series_meta_load GROUP BY run_id"
            ).fetchall()
        )
        assert set(per_run) == set(runs) == set(metas)
        assert per_run[runs[0]] == per_run[runs[1]] > 0

        n_series = c.execute(
            "SELECT count(DISTINCT series_ref) FROM staging.series_meta_load WHERE run_id = %s",
            [runs[0]],
        ).fetchone()
        assert n_series is not None
        c.rollback()
        rep = loader.drain(c, run_id=runs[0], insert=make_insert(_provider))
        assert rep.ok, rep.results
        assert loader.drain(c, run_id=runs[0], insert=make_insert(_provider)).results == []
        left = c.execute(
            "SELECT raw_id, count(*) FROM staging.observation_load GROUP BY 1"
        ).fetchall()
        assert left == [], (left, [(r.raw_id, r.status, r.detail) for r in rep.results])
        total = per_run[runs[0]]
        # identical content loaded through two groups: stored once, no duplicate keys
        assert c.execute("SELECT count(*) FROM curated.observation").fetchone() == (total,)
        dup = c.execute(
            "SELECT count(*) FROM (SELECT series_id, ref_period_start FROM curated.observation "
            "GROUP BY 1, 2 HAVING count(*) > 1) d"
        ).fetchone()
        assert dup == (0,)
        assert c.execute("SELECT count(*) FROM ref.series").fetchone() == n_series
        assert c.execute(
            "SELECT count(*) FROM ingest.raw_load WHERE outcome IN ('loaded','skipped_out_of_order')"
        ).fetchone() == (2,)
