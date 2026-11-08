"""T136 (ADR-028) against a throwaway database: manifest row, request_key, prev_raw_id chain.

Landing page and file are served by a mock transport (SYNTHETIC page and workbook); the link
hash rotates between the two fetches, the logical request_key and the prev_raw_id chain survive.
"""

from __future__ import annotations

import io
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import psycopg
import pytest

from macro_monitor.ingestion import fetch
from macro_monitor.ingestion.archive import LocalDirStore
from macro_monitor.ingestion.base import GroupConfig
from macro_monitor.ingestion.connectors.bulk import BulkConnector
from macro_monitor.ingestion.connectors.sdmx import load_series_entries
from macro_monitor.ingestion.fetch import GroupJob
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.registry.config import load_sources
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[2]
PINK = (ROOT / "tests/fixtures/raw/pinksheet/monthly_synthetic.xlsx").read_bytes()
HASH_A = "74e8be41ceb20fa0da750cda2f6b9e4e-0050012026"
HASH_B = "0123456789abcdef0123456789abcdef-0050022026"
LANDING = "https://www.worldbank.org/en/research/commodity-markets"


def _link(h: str) -> str:
    return f"https://thedocs.worldbank.org/en/doc/{h}/related/CMO-Historical-Data-Monthly.xlsx"


def _changed(body: bytes) -> bytes:
    """Same workbook plus one extra zip member: valid xlsx, different content hash."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(body)) as zin, zipfile.ZipFile(out, "w") as zout:
        for item in zin.infolist():
            zout.writestr(item, zin.read(item.filename))
        zout.writestr("docProps/t136.txt", "revision")
    return out.getvalue()


def _http(h: str, body: bytes) -> HttpClient:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "www.worldbank.org":
            page = f'<html><body><a href="{_link(h)}">Monthly</a></body></html>'.encode()
            return httpx.Response(200, content=page, headers={"Content-Type": "text/html"})
        return httpx.Response(200, content=body)

    return HttpClient(
        HttpSettings(
            base_url="https://thedocs.worldbank.org/",
            retries=RetryConfig(max=0),
            extra_hosts=frozenset({"www.worldbank.org", "thedocs.worldbank.org"}),
        ),
        repo_url="https://example.invalid/repo",
        transport=httpx.MockTransport(handler),
    )


def _job() -> tuple[GroupJob, Any]:
    conf = load_sources(ROOT / "config" / "sources.yaml")
    src = next(s for s in conf.data["sources"] if s["id"] == "worldbank_pinksheet")
    g = next(g for g in src["groups"] if g["id"] == "pinksheet_monthly")
    group = GroupConfig.from_config(src, g, load_series_entries(ROOT / g["series_map"]))
    job = GroupJob(
        source=src,
        group=group,
        connector=BulkConnector(group.source_id),
        parser_id="pinksheet_v1@1",
        basename="CMO-Historical-Data-Monthly.xlsx",
    )
    return job, group


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
            "('worldbank_pinksheet','p','bulk','public','public','l','a','x',false)"
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


def test_rotation_keeps_request_key_and_prev_raw_chain(
    conn: psycopg.Connection, tmp_path: Path
) -> None:
    store = LocalDirStore(tmp_path / "raw")
    job, _ = _job()
    r1 = fetch.fetch_group(conn, store, job, _http(HASH_A, PINK), _run(conn))
    assert r1.outcomes == ["new"], r1.error
    r2 = fetch.fetch_group(conn, store, job, _http(HASH_B, _changed(PINK)), _run(conn))
    assert r2.outcomes == ["new"], r2.error
    rows = conn.execute(
        "SELECT raw_id, prev_raw_id, request_key, request_url, request_params "
        "FROM ingest.raw_object ORDER BY raw_id"
    ).fetchall()
    assert len(rows) == 2
    (id1, prev1, key1, url1, params1), (id2, prev2, key2, url2, params2) = rows
    assert prev1 is None
    assert prev2 == id1
    assert key1 == key2  # logical key: unchanged by the rotated link hash
    assert (url1, url2) == (_link(HASH_A), _link(HASH_B))
    for params, h in ((params1, HASH_A), (params2, HASH_B)):
        d = params["discovery"]
        assert d["landing_url"] == LANDING
        assert d["resolved_url"] == _link(h)
        assert len(d["landing_sha256"]) == 64
    last = conn.execute("SELECT last_url FROM ingest.request_state").fetchone()
    assert last == (_link(HASH_B),)
    assert id2 != id1
