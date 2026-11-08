"""T58 bulk-parser safety limits and zip error mapping (offline, in-memory archives)."""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any

import pytest
from tests.unit.test_ingestion_bulk_t58 import (
    AMECO,
    PINK,
    _ameco,
    _group,
    _pink_variant,
    _raw,
    _zip,
)

from macro_monitor.ingestion.base import ParseError
from macro_monitor.ingestion.connectors.bulk import BulkConnector, DbnomicsConnector
from macro_monitor.ingestion.connectors.sdmx import series_filter_for
from macro_monitor.ingestion.parsers import ecsurvey_v1, fao_stat_v1, xlsx_rows

pytestmark = pytest.mark.unit


def _filter(group: str, dataset: str) -> Any:
    g = _group(group)
    return series_filter_for(g.series, dataset, g.missing_markers)


def test_xlsx_limits_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    body = PINK.read_bytes()
    monkeypatch.setattr(xlsx_rows, "MAX_UNCOMPRESSED_BYTES", 10)
    with pytest.raises(ParseError, match=r"PARSE-01.*too large"):
        xlsx_rows.sheet_rows(body, "Monthly Prices")
    monkeypatch.undo()
    monkeypatch.setattr(xlsx_rows, "MAX_MEMBERS", 2)
    with pytest.raises(ParseError, match=r"PARSE-01.*too many"):
        xlsx_rows.sheet_rows(body, "Monthly Prices")
    monkeypatch.undo()
    monkeypatch.setattr(xlsx_rows, "MAX_ROWS", 3)
    with pytest.raises(ParseError, match=r"PARSE-01.*too long"):
        xlsx_rows.sheet_rows(body, "Monthly Prices")


def test_size_caps_are_realistic() -> None:
    assert xlsx_rows.MAX_UNCOMPRESSED_BYTES == 64 * 1024**2
    assert ecsurvey_v1.MAX_MEMBER_BYTES == 64 * 1024**2
    assert fao_stat_v1.MAX_MEMBER_BYTES == 256 * 1024**2


def test_ecsurvey_member_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    flt = _filter("ec_bcs_monthly", _group("ec_bcs_monthly").series[0].dataset)
    body = _zip({ecsurvey_v1.MEMBER: b"x" * 100, "a.txt": b"y"})
    for name, value, match in (
        ("MAX_MEMBER_BYTES", 10, "too large"),
        ("MAX_TOTAL_BYTES", 10, "too large"),
        ("MAX_MEMBERS", 1, "too many"),
    ):
        monkeypatch.setattr(ecsurvey_v1, name, value)
        with pytest.raises(ParseError, match=rf"PARSE-01.*{match}"):
            BulkConnector("ec_surveys").parse(_raw(body, "ec_bcs_monthly"), flt)
        monkeypatch.undo()


def test_faostat_member_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    flt = _filter("faostat_sofi", "Food_Security_Data")
    body = _zip({"x_All_Data_(Normalized).csv": b"a,b\n" * 50, "flags.csv": b"z"})
    for name, value, match in (
        ("MAX_MEMBER_BYTES", 10, "too large"),
        ("MAX_TOTAL_BYTES", 10, "too large"),
        ("MAX_MEMBERS", 1, "too many"),
    ):
        monkeypatch.setattr(fao_stat_v1, name, value)
        with pytest.raises(ParseError, match=rf"PARSE-01.*{match}"):
            BulkConnector("faostat").parse(_raw(body, "faostat_sofi"), flt)
        monkeypatch.undo()


def _encrypted_zip(name: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(name, b"secret data")
    raw = bytearray(buf.getvalue())
    # set the encryption bit (0x1) in the general purpose flags of local and central headers
    for sig, off in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        i = raw.find(sig)
        raw[i + off] |= 1
    return bytes(raw)


def _unsupported_compression_zip(name: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(name, b"data")
    raw = bytearray(buf.getvalue())
    for sig, off in ((b"PK\x03\x04", 8), (b"PK\x01\x02", 10)):
        i = raw.find(sig)
        raw[i + off : i + off + 2] = (99).to_bytes(2, "little")  # not a zipfile method
    return bytes(raw)


@pytest.mark.parametrize("make", [_encrypted_zip, _unsupported_compression_zip])
def test_encrypted_or_unsupported_member_is_parse01(make: Any) -> None:
    sofi = _filter("faostat_sofi", "Food_Security_Data")
    with pytest.raises(ParseError, match="PARSE-01"):
        BulkConnector("faostat").parse(
            _raw(make("x_All_Data_(Normalized).csv"), "faostat_sofi"), sofi
        )
    bcs = _filter("ec_bcs_monthly", _group("ec_bcs_monthly").series[0].dataset)
    with pytest.raises(ParseError, match="PARSE-01"):
        BulkConnector("ec_surveys").parse(_raw(make(ecsurvey_v1.MEMBER), "ec_bcs_monthly"), bcs)


def test_ameco_docs_count_mismatch_and_duplicate_series_code() -> None:
    flt = _filter("dbnomics_ameco_gap", "AMECO/AVGDGP")
    n = len(json.loads(AMECO.read_text(encoding="utf-8"))["series"]["docs"])
    with pytest.raises(ParseError, match=r"PARSE-01.*truncated docs"):
        DbnomicsConnector().parse(
            _raw(
                _ameco(lambda d: d["series"].__setitem__("num_found", n + 1)),
                "dbnomics_ameco_gap",
            ),
            flt,
        )

    def dup(d: Any) -> None:
        docs = d["series"]["docs"]
        docs.append(dict(docs[0]))
        d["series"]["num_found"] = len(docs)

    with pytest.raises(ParseError, match=r"PARSE-01.*duplicate series_code"):
        DbnomicsConnector().parse(_raw(_ameco(dup), "dbnomics_ameco_gap"), flt)


def test_formula_without_cached_value_is_skipped_as_blank_documented() -> None:
    """Current behaviour (documented, not endorsed): openpyxl yields None for a formula cell with
    no cached value, so the parser treats it as an empty cell and loads no observation."""

    def mutate(wb: Any, ws: Any) -> None:
        ws["B7"] = "=1+1"  # written without a cached result

    g = _group("pinksheet_monthly")
    flt = series_filter_for(g.series, "CMO-Historical-Data-Monthly", g.missing_markers)
    out = BulkConnector("worldbank_pinksheet").parse(
        _raw(_pink_variant(mutate), "pinksheet_monthly"), flt
    )
    assert not [o for o in out.observations if o.value is not None]
