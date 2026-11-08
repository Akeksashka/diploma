"""Deterministic Parquet snapshot of a parsed full vintage (T46, ADR-002, ingestion spec 3a).

Used for groups with ``snapshot_mode = 'diff_above_tol'``: the snapshot is a pure function of the
parsed rows, so equal input gives equal bytes (sorted rows, fixed schema, no metadata, no
compression variance, no pandas). ``record_snapshot`` stores the bytes in the raw store and the
manifest row ``ingest.raw_snapshot`` (append-only, one per ``raw_id``).
"""

from __future__ import annotations

import hashlib
import io
from collections.abc import Iterable
from datetime import date
from decimal import Decimal

import psycopg
import pyarrow as pa
import pyarrow.parquet as pq

from macro_monitor.ingestion.archive import RawStore

SNAPSHOT_SCHEMA = pa.schema(
    [
        pa.field("series_ref", pa.string(), nullable=False),
        pa.field("ref_period_start", pa.date32(), nullable=False),
        pa.field("value", pa.string(), nullable=True),  # exact decimal text, no float rounding
        pa.field("value_status", pa.string(), nullable=False),
    ]
)

SnapshotRow = tuple[str, date, Decimal | None, str]


def _dec_text(v: Decimal | None) -> str | None:
    return None if v is None else format(v, "f")


def snapshot_bytes(rows: Iterable[SnapshotRow]) -> tuple[bytes, int]:
    """Parquet bytes and row count; rows are sorted by (series_ref, period, status)."""
    ordered = sorted(rows, key=lambda r: (r[0], r[1], r[3]))
    table = pa.table(
        {
            "series_ref": [r[0] for r in ordered],
            "ref_period_start": [r[1] for r in ordered],
            "value": [_dec_text(r[2]) for r in ordered],
            "value_status": [r[3] for r in ordered],
        },
        schema=SNAPSHOT_SCHEMA,
    )
    buf = io.BytesIO()
    pq.write_table(
        table, buf, compression="none", use_dictionary=False, write_statistics=False,
        store_schema=False, data_page_version="1.0", version="2.6", row_group_size=1_000_000,
    )  # fmt: skip
    return buf.getvalue(), len(ordered)


def read_snapshot(data: bytes) -> list[SnapshotRow]:
    out: list[SnapshotRow] = []
    for r in pq.read_table(io.BytesIO(data)).to_pylist():
        v = r["value"]
        out.append(
            (
                r["series_ref"],
                r["ref_period_start"],
                None if v is None else Decimal(v),
                r["value_status"],
            )
        )
    return out


def record_snapshot(
    conn: psycopg.Connection,
    store: RawStore,
    *,
    raw_id: int,
    source_id: str,
    rows: Iterable[SnapshotRow],
    parser_id: str,
) -> int:
    """Write the snapshot asset and its ``ingest.raw_snapshot`` row; returns the row count.

    Idempotent per ``raw_id`` (an existing row is kept: the snapshot is a pure function of the
    object). Call inside the transaction that registers the object (I-ING-5).
    """
    data, n = snapshot_bytes(rows)
    sha = hashlib.sha256(data).hexdigest()
    ref = store.put(sha, data, f"{source_id}/{sha[:16]}-snapshot.parquet")
    conn.execute(
        "INSERT INTO ingest.raw_snapshot (raw_id, sha256, storage_ref, byte_count, row_count, "
        "parser_id) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (raw_id) DO NOTHING",
        [raw_id, sha, ref.encode(), len(data), n, parser_id],
    )
    return n
