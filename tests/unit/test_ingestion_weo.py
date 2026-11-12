"""IMF WEO manual file: weo_v1 parser against a sample cut from the real October 2026 export."""

from __future__ import annotations

import csv
import io
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from macro_monitor.ingestion.base import ParseError, RawObject, SeriesFilter
from macro_monitor.ingestion.parsers import weo_v1
from macro_monitor.ingestion.registry import resolve

FIXTURE = Path(__file__).parent.parent / "fixtures" / "weo" / "weo_2026_10_sample.csv"
REFS = frozenset(
    {
        "USA.NGAP_NPGDP.A",
        "DEU.NGDP_RPCH.A",
        "IND.NGDP_RPCH.A",
        "DEU.GGXWDG_NGDP.A",
        "ZAF.GGXCNL_NGDP.A",
    }
)


def _raw(body: bytes) -> RawObject:
    return RawObject(
        body=body,
        source_id="imf_weo_manual",
        group_id="imf_weo_files",
        fetched_at=datetime(2026, 11, 10, tzinfo=UTC),
    )


def _filter(refs: frozenset[str] = REFS) -> SeriesFilter:
    return SeriesFilter(series_refs=refs)


def _table() -> list[list[str]]:
    return list(csv.reader(io.StringIO(FIXTURE.read_bytes().decode("utf-8-sig"))))


def _body(rows: list[list[str]]) -> bytes:
    out = io.StringIO()
    csv.writer(out, lineterminator="\n").writerows(rows)
    return out.getvalue().encode("utf-8-sig")


def _row(rows: list[list[str]], code: str) -> list[str]:
    return next(r for r in rows if r[1] == code)


def test_registered() -> None:
    assert resolve("weo_v1@1") is weo_v1.parse


def test_parse_sample() -> None:
    out = weo_v1.parse(_raw(FIXTURE.read_bytes()), _filter())
    assert [m.series_ref for m in out.metas] == sorted(REFS)
    assert not out.rejected
    meta = {m.series_ref: m for m in out.metas}
    assert meta["USA.NGAP_NPGDP.A"].unit_code == "PCT_POT_GDP"
    assert meta["DEU.GGXWDG_NGDP.A"].unit_code == "PCT_GDP"
    assert meta["DEU.NGDP_RPCH.A"].unit_code == "PCT"
    assert meta["DEU.NGDP_RPCH.A"].frequency == "A"
    assert meta["DEU.NGDP_RPCH.A"].entity_code == "DEU"
    assert meta["DEU.NGDP_RPCH.A"].unit_mult == 0
    assert meta["DEU.NGDP_RPCH.A"].published_decimals == 3
    obs = {(o.series_ref, o.ref_period_start.year): o for o in out.observations}
    # USA / DEU: last actual 2025
    assert obs["USA.NGAP_NPGDP.A", 2025].value_status == "OBS"
    assert obs["USA.NGAP_NPGDP.A", 2026].value_status == "PROJ"
    assert obs["DEU.NGDP_RPCH.A", 2031].value == Decimal("0.608")
    assert obs["DEU.NGDP_RPCH.A", 2031].value_status == "PROJ"
    assert obs["DEU.NGDP_RPCH.A", 2025].value == Decimal("0.229")
    assert obs["DEU.NGDP_RPCH.A", 2025].value_status == "OBS"
    first = obs["DEU.NGDP_RPCH.A", 2031]
    assert first.vintage_label == "WEO-2026-10"
    assert first.source_release_at == datetime(2026, 10, 13, 2, 0, tzinfo=UTC)
    assert first.ref_period_end == date(2031, 12, 31)
    # fiscal-year labels: FY2024/25 means last actual column 2024, FY2025/26 means 2025
    assert obs["ZAF.GGXCNL_NGDP.A", 2024].value_status == "OBS"
    assert obs["ZAF.GGXCNL_NGDP.A", 2025].value_status == "PROJ"
    assert obs["IND.NGDP_RPCH.A", 2025].value_status == "OBS"
    assert obs["IND.NGDP_RPCH.A", 2026].value_status == "PROJ"
    assert {o.value_status for o in out.observations} <= {"OBS", "PROJ"}


def test_unmapped_series_not_emitted() -> None:
    out = weo_v1.parse(_raw(FIXTURE.read_bytes()), _filter(frozenset({"DEU.NGDP_RPCH.A"})))
    assert [m.series_ref for m in out.metas] == ["DEU.NGDP_RPCH.A"]
    assert {o.series_ref for o in out.observations} == {"DEU.NGDP_RPCH.A"}


def test_blank_cells_are_not_rows() -> None:
    rows = _table()
    r = _row(rows, "DEU.NGDP_RPCH.A")
    start = rows[0].index("1980")
    r[start] = ""
    out = weo_v1.parse(_raw(_body(rows)), _filter(frozenset({"DEU.NGDP_RPCH.A"})))
    assert 1980 not in {o.ref_period_start.year for o in out.observations}


def test_non_numeric_cell_rejected_not_loaded() -> None:
    rows = _table()
    r = _row(rows, "DEU.NGDP_RPCH.A")
    r[rows[0].index("2030")] = "n/a"
    out = weo_v1.parse(_raw(_body(rows)), _filter(frozenset({"DEU.NGDP_RPCH.A"})))
    assert [(x.period, x.raw_value, x.reason[:8]) for x in out.rejected] == [
        ("2030", "n/a", "PARSE-03")
    ]
    assert 2030 not in {o.ref_period_start.year for o in out.observations}


def test_missing_marker_gives_miss() -> None:
    rows = _table()
    _row(rows, "DEU.NGDP_RPCH.A")[rows[0].index("2030")] = "--"
    f = SeriesFilter(series_refs=frozenset({"DEU.NGDP_RPCH.A"}), missing_markers=frozenset({"--"}))
    out = weo_v1.parse(_raw(_body(rows)), f)
    miss = [o for o in out.observations if o.value_status == "MISS"]
    assert [(o.ref_period_start.year, o.value, o.source_flags) for o in miss] == [
        (2030, None, "--")
    ]


def _drift(mutate: str) -> bytes:
    rows = _table()
    h = rows[0]
    r = _row(rows, "DEU.NGDP_RPCH.A")
    if mutate == "rename_col":
        h[h.index("SCALE")] = "SCALING"
    elif mutate == "year_gap":
        del h[h.index("2000")]
        for x in rows[1:]:
            del x[h.index("2001")]  # keep widths equal (column 2000 removed above)
    elif mutate == "extra_text_col":
        h.append("NOTE")
        for x in rows[1:]:
            x.append("")
    elif mutate == "short_row":
        r.pop()
    elif mutate == "frequency":
        r[h.index("FREQUENCY")] = "Quarterly"
    elif mutate == "dataset":
        r[h.index("DATASET")] = "IMF.STA:CPI(1.0.0)"
    elif mutate == "dup":
        rows.append(list(r))
    elif mutate == "two_editions":
        r[h.index("PUBLICATION_DATE")] = "2026-04-14T02:00:00Z"
    elif mutate == "actual_unreadable":
        r[h.index("LATEST_ACTUAL_ANNUAL_DATA")] = ""
    elif mutate == "scale":
        r[h.index("SCALE")] = "Trillions"
    elif mutate == "unit":
        r[h.index("UNIT")] = "Index"
    elif mutate == "code":
        r[1] = "DEU-NGDP_RPCH-A"
    elif mutate == "empty":
        return b""
    return _body(rows)


@pytest.mark.parametrize(
    "mutate",
    [
        "rename_col",
        "year_gap",
        "extra_text_col",
        "short_row",
        "frequency",
        "dataset",
        "dup",
        "two_editions",
        "actual_unreadable",
        "scale",
        "unit",
        "code",
        "empty",
    ],
)
def test_layout_drift_fails_closed(mutate: str) -> None:
    with pytest.raises(ParseError, match="PARSE-01"):
        weo_v1.parse(_raw(_drift(mutate)), _filter(frozenset({"DEU.NGDP_RPCH.A"})))


def test_not_utf8_fails_closed() -> None:
    with pytest.raises(ParseError, match="PARSE-01"):
        weo_v1.parse(_raw(b"\xff\xfe\x00"), _filter())


def test_unmapped_unit_is_tolerated_when_not_mapped() -> None:
    # USA.NGDP_D.A is an index series: refused only when someone maps it
    weo_v1.parse(_raw(FIXTURE.read_bytes()), _filter())
    with pytest.raises(ParseError, match="UNIT"):
        weo_v1.parse(_raw(FIXTURE.read_bytes()), _filter(frozenset({"USA.NGDP_D.A"})))
