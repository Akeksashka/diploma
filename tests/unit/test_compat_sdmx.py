"""T04 spike BB27: sdmx1 reads SDMX-ML from in-memory bytes (ADR-004).

Fixtures under tests/fixtures/sdmx/ are hand-written and synthetic, not source data.
"""

from __future__ import annotations

import io
from decimal import Decimal
from pathlib import Path

import sdmx

_FIXTURES = Path(__file__).parent.parent / "fixtures" / "sdmx"


def test_read_generic_data_from_bytesio() -> None:
    raw = (_FIXTURES / "synthetic_generic_data.xml").read_bytes()
    msg = sdmx.read_sdmx(io.BytesIO(raw))
    assert len(msg.data) == 1
    series = msg.data[0].series
    assert len(series) == 1
    ((key, obs_list),) = series.items()
    assert str(key) == "(FREQ=M, GEO=XX)"
    periods = [str(o.dimension["TIME_PERIOD"].value) for o in obs_list]
    assert periods == ["2026-01", "2026-02"]
    # Values arrive as strings, so Decimal conversion is lossless.
    assert [Decimal(str(o.value)) for o in obs_list] == [Decimal("100.5"), Decimal("101.25")]
    assert obs_list[1].attrib["OBS_STATUS"].value == "P"
    assert obs_list[0].attrib["UNIT"].value == "IDX"


def test_read_structure_from_bytesio() -> None:
    raw = (_FIXTURES / "synthetic_structure.xml").read_bytes()
    msg = sdmx.read_sdmx(io.BytesIO(raw))
    assert set(msg.codelist["CL_FREQ"].items) == {"M", "Q"}


def test_same_bytes_parse_identically_twice() -> None:
    raw = (_FIXTURES / "synthetic_generic_data.xml").read_bytes()
    a = sdmx.read_sdmx(io.BytesIO(raw)).data[0]
    b = sdmx.read_sdmx(io.BytesIO(raw)).data[0]
    assert [str(k) for k in a.series] == [str(k) for k in b.series]
