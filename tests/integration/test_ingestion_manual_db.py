"""T59 against a throwaway database: import stamps now, carries edition_date, is idempotent."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest

from macro_monitor.ingestion import fetch
from macro_monitor.ingestion.archive import LocalDirStore
from macro_monitor.ingestion.base import GroupConfig, ParseOutput, RawObject, SeriesFilter
from macro_monitor.ingestion.connectors.manual import ManualConnector, ingest_files
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta
from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

ROOT = Path(__file__).resolve().parents[2]
SIDECAR = (
    "source_url: https://example.org/x\ndownloaded_on: 2026-10-20\ndownloaded_by: op\n"
    "edition_label: WEO-2026-10\nedition_date: 2026-10-14\n"
)


class _Conn(ManualConnector):
    def parse(self, raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
        meta = ParsedSeriesMeta(
            "X", "DEU", "A", "PCT", 0, None, "NA", None, "NSA", "NA", "x", "NA", None
        )
        obs = ParsedObservation(
            "X", date(2026, 1, 1), date(2026, 12, 31), Decimal("1.5"), "OBS", None, None, None
        )
        return ParseOutput(metas=(meta,), observations=(obs,))


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
            "('imf_weo_manual','p','manual','public','public','l','a','x',true)"
        )
        c.commit()
        yield c


def test_import_records_manual_object_and_is_idempotent(
    conn: psycopg.Connection, tmp_path: Path
) -> None:
    d = tmp_path / "inbox" / "manual_inbox" / "imf_weo_manual" / "2026-10"
    d.mkdir(parents=True)
    (d / "weo.csv").write_bytes(b"a,b\n1,2\n")
    (d / "weo.csv.meta.yaml").write_text(SIDECAR, encoding="utf-8")
    root = tmp_path / "inbox"
    store = LocalDirStore(tmp_path / "raw")
    group = GroupConfig("imf_weo_manual", "imf_weo_files", "", {}, "complete")
    before = datetime.now(UTC)
    run = fetch.open_run(
        conn, workflow="ingest-manual", trigger="local", mode="manual", git_sha="g",
        code_version="c", started_at=before,
    )  # fmt: skip

    def go() -> dict[str, str]:
        rep = ingest_files(
            conn, store, _Conn(root), group, run_id=run, parser_id="weo_v1@1",
            archive_mode="public", root=root, edition_ordered=True,
        )  # fmt: skip
        assert rep.ok
        return rep.outcomes

    rel = "manual_inbox/imf_weo_manual/2026-10/weo.csv"
    assert go() == {rel: "new"}
    row = conn.execute(
        "SELECT manual, edition_label, edition_date, import_label, fetched_at, request_url "
        "FROM ingest.raw_object"
    ).fetchone()
    assert row is not None
    assert row[0] is True
    assert row[1:4] == ("WEO-2026-10", date(2026, 10, 14), None)
    assert row[4] >= before  # actual import time, not the file's date
    assert row[5] == "manual://imf_weo_manual/2026-10/weo.csv"
    assert conn.execute("SELECT count(*) FROM staging.observation_load").fetchone() == (1,)
    assert conn.execute("SELECT count(*) FROM ingest.v_raw_unloaded").fetchone() == (1,)

    assert go() == {rel: "unchanged"}
    assert conn.execute("SELECT count(*) FROM ingest.raw_object").fetchone() == (1,)


def test_bad_sidecar_is_reported_not_stored(conn: psycopg.Connection, tmp_path: Path) -> None:
    d = tmp_path / "manual_inbox" / "imf_weo_manual" / "2026-10"
    d.mkdir(parents=True)
    (d / "weo.csv").write_bytes(b"x")
    (d / "weo.csv.meta.yaml").write_text(SIDECAR.replace("edition_date", "nope"), encoding="utf-8")
    run = fetch.open_run(
        conn, workflow="w", trigger="local", mode="manual", git_sha="g", code_version="c",
        started_at=datetime.now(UTC),
    )  # fmt: skip
    group = GroupConfig("imf_weo_manual", "imf_weo_files", "", {}, "complete")
    rep = ingest_files(
        conn, LocalDirStore(tmp_path / "raw"), _Conn(tmp_path), group, run_id=run,
        parser_id="weo_v1@1", archive_mode="public", root=tmp_path, edition_ordered=True,
    )  # fmt: skip
    assert not rep.ok
    assert conn.execute("SELECT count(*) FROM ingest.raw_object").fetchone() == (0,)
