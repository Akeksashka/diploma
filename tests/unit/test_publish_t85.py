"""T85 unit tests: revision versions, recent list and edition summaries (offline)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pyarrow as pa
import pytest

from macro_monitor.publish import revisions as rv
from macro_monitor.publish.export import ExportError, parquet_bytes

T0 = datetime(2026, 6, 1, tzinfo=UTC)
CUT = datetime(2026, 11, 1, tzinfo=UTC)


def row(
    sid: int, ind: str, start: date, day: int, value: str | None, *, kind: str = "revision",
    label: str | None = None, status: str = "OBS", ordered: bool = False, cls: str = "regular",
) -> tuple[object, ...]:  # fmt: skip
    return (
        sid, "DEU", ind, start, start + timedelta(days=27), T0 + timedelta(days=day), None, label,
        None if value is None else Decimal(value), status, kind, cls, ordered,
    )  # fmt: skip


def pair(
    sid: int, ind: str, start: date, v1: str, v2: str, **kw: object
) -> list[tuple[object, ...]]:
    return [
        row(sid, ind, start, 0, v1, kind="initial", **kw),  # type: ignore[arg-type]
        row(sid, ind, start, 10, v2, **kw),  # type: ignore[arg-type]
    ]


def test_sizes_base_version_and_single_versions() -> None:
    rows = [
        *pair(1, "I", date(2026, 1, 1), "1.0", "1.2"),
        *pair(1, "I", date(2026, 2, 1), "0", "5"),
        row(1, "I", date(2026, 3, 1), 0, "9", kind="initial"),  # one version: excluded
        row(1, "I", date(2026, 4, 1), 0, "4", kind="initial"),
        row(1, "I", date(2026, 4, 1), 10, None, kind="tombstone", status="DEL"),
    ]
    vs = rv.build_versions(rows, CUT)
    assert len(vs) == 6
    assert [v.base for v in vs] == [True, False, True, False, True, False]
    assert vs[1].abs_change == Decimal("0.2")
    assert float(vs[1].pct or 0) == pytest.approx(20.0)
    assert vs[3].abs_change == Decimal("5")
    assert vs[3].pct is None
    assert vs[5].abs_change is None
    assert vs[5].is_revision
    assert vs[0].abs_change is None
    assert vs[0].previous is None
    # versions newer than the cutoff are dropped and the two-version rule re-evaluated
    assert rv.build_versions(rows, T0 + timedelta(days=5)) == []


def test_recent_cap_order_and_exclusion_of_editions() -> None:
    rows: list[tuple[object, ...]] = []
    for i in range(3000):
        rows += pair(i, "I", date(2026, 1, 1), "100", str(100 + 1 + i % 50))
    rows += pair(9000, "I", date(2026, 1, 1), "100", "190", ordered=True, label="E")
    rows += pair(9001, "I", date(2026, 1, 1), "100", "150", cls="reestimation")
    vs = rv.build_versions(rows, CUT)
    out = rv.ordinary_revisions(vs, CUT)
    assert len(out) == 2000
    assert all(r["series_id"] != 9000 for r in out)  # edition rows never ranked here
    assert out[0]["revision_class"] == "regular"
    assert out[0]["revision_pct"] == 50.0
    pcts = [r["revision_pct"] for r in out]
    assert pcts == sorted(pcts, reverse=True)
    assert rv.ordinary_revisions(vs, CUT) == out  # deterministic
    old = rv.build_versions(pair(1, "I", date(2026, 1, 1), "1", "2"), T0 + timedelta(days=400))
    assert rv.ordinary_revisions(old, T0 + timedelta(days=400)) == []  # outside 12 months


def test_edition_summary_identity_and_null_label() -> None:
    rows: list[tuple[object, ...]] = []
    for s in range(3):
        for k in range(4):
            rows += pair(s, "I", date(2026, 1 + k, 1), "100", str(100 + (k + 1) * (s + 1)),
                         ordered=True, label=None if s == 2 else "WEO-2")  # fmt: skip
    # a base-version-only history never counts
    vs = rv.build_versions(rows, CUT)
    sm = rv.edition_summaries(vs, {0: "w", 1: "w", 2: "w"}, CUT)
    assert sorted((e["vintage_label"], e["n_series"], e["n_keys_revised"]) for e in sm) == [
        ("2026-06-11", 1, 4),  # label null: UTC date of known_at
        ("WEO-2", 2, 8),
    ]
    e = next(x for x in sm if x["vintage_label"] == "WEO-2")
    allp = sorted(
        (abs(float(v.pct)) for v in vs if v.is_revision and v.series_id < 2 and v.pct), reverse=True
    )
    assert e["max_abs_pct"] == pytest.approx(allp[0])
    assert len(e["top_revisions"]) == 8
    assert [r["revision_pct"] for r in e["top_revisions"]] == sorted(
        (r["revision_pct"] for r in e["top_revisions"]), reverse=True
    )
    with pytest.raises(ExportError):
        rv.edition_summaries(vs, {}, CUT)


def test_table_columns_and_deterministic_bytes() -> None:
    vs = rv.build_versions(pair(1, "I", date(2026, 1, 1), "1", "2"), CUT)
    t = rv.build_table(vs)
    assert isinstance(t, pa.Table)
    assert t.schema == rv.SCHEMA
    assert t.column("is_base_version").to_pylist() == [True, False]
    assert t.column("revision_abs").to_pylist() == [None, 1.0]
    assert "PROJ" not in t.column("value_status").to_pylist()
    assert parquet_bytes(t, group_by="entity_id") == parquet_bytes(t, group_by="entity_id")


def test_ac_exp_13_scale_rebase_with_projection_free_counts() -> None:
    rows: list[tuple[object, ...]] = []
    for s in range(25):
        for k in range(200):  # 25 series x 200 keys = 5,000 keys rebased by 0.5..40 percent
            pct = 0.5 + (k % 80) * 0.5
            rows += pair(s, "A", date(2000, 1, 1) + timedelta(days=31 * k), "100", str(100 + pct),
                         ordered=True, label="WEO-2026-10")  # fmt: skip
    rows += [row(900 + i, "O", date(2026, 1, 1), 10, str(100 + i % 5 + 1)) for i in range(30)]
    rows += [row(900 + i, "O", date(2026, 1, 1), 0, "100", kind="initial") for i in range(30)]
    vs = rv.build_versions(rows, CUT)
    out = rv.ordinary_revisions(vs, CUT)
    assert len(out) == 30
    assert all(r["indicator_id"] == "O" for r in out)
    (e,) = rv.edition_summaries(vs, dict.fromkeys(range(25), "imf_weo_manual"), CUT)
    assert (e["n_series"], e["n_keys_revised"], len(e["top_revisions"])) == (25, 5000, 10)
    assert e["max_abs_pct"] == pytest.approx(40.0)
