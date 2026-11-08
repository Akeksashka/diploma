"""Build the SYNTHETIC T58 bulk-file fixtures under tests/fixtures/raw (deterministic bytes).

Usage: .venv/bin/python scripts/make_t58_fixtures.py

Nothing here is real source data and no layout is verified against a live file; every fixture is
[UNVERIFIED] (see the parser docstrings). Workbooks and zips get fixed member dates so reruns
produce identical bytes.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "tests" / "fixtures" / "raw"
FIXED = (2026, 10, 15, 0, 0, 0)


def _zip(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in members.items():
            info = zipfile.ZipInfo(name, FIXED)
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data)
    return buf.getvalue()


def _xlsx(wb: Workbook) -> bytes:
    wb.properties.created = datetime(2026, 10, 15)
    wb.properties.modified = datetime(2026, 10, 15)
    buf = io.BytesIO()
    wb.save(buf)
    with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as zf:
        parts = {i.filename: zf.read(i) for i in zf.infolist()}
    # openpyxl stamps "modified" with the save time; pin it
    core = re.sub(
        rb"(<dcterms:modified[^>]*>)[^<]*",
        rb"\g<1>2026-10-15T00:00:00Z",
        parts["docProps/core.xml"],
    )
    parts["docProps/core.xml"] = core
    return _zip(parts)


def _write(rel: str, data: bytes, source_url: str, parser_id: str, note: str) -> None:
    path = RAW / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    path.with_name(path.name + ".meta.yaml").write_text(
        f"# Sidecar of a SYNTHETIC fixture ({note}); no live capture; not real data.\n"
        "# Layout, names and URL are [UNVERIFIED]. Member dates are fixed.\n"
        "synthetic: true\n"
        f"source_url: {source_url} [UNVERIFIED]\n"
        "fetched_on: 2026-11-05\n"
        f"sha256: {hashlib.sha256(data).hexdigest()}\n"
        f"parser_id: {parser_id}\n"
        "licence: Synthetic test data, project-authored (no third-party content).\n"
    )


def pinksheet() -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "Monthly Prices"
    ws.append(["World Bank Commodity Price Data (SYNTHETIC)"])
    ws.append(["Nominal US dollars"])
    ws.append([])
    ws.append([])
    ws.append(["Commodity", "Crude oil, Brent", "Natural gas, Europe", "Urea",
               "Wheat, US HRW", "Food price index", "Gold"])  # fmt: skip
    ws.append(["Unit", "($/bbl)", "($/mmbtu)", "($/mt)", "($/mt)", "(2010 = 100)", "($/toz)"])
    ws.append(["2025M08", 67.1, 11.2, 410.5, 230.0, 118.4, 3300.1])
    ws.append(["2025M09", 68.35, 11.9, "…", 228.5, 119.0, 3400.0])
    ws.append(["2025M10", 66.9, 12.4, 405.0, None, 118.7, 3500.5])
    ws.append([])
    ws.append(["Note: synthetic footnote below the block, ignored by the parser"])
    return _xlsx(wb)


def ffpi() -> bytes:
    return (
        b"FAO Food Price Index (SYNTHETIC)\n"
        b"Real prices not shown; nominal index, 2014-2016 = 100\n"
        b"\n"
        b"Date,Food Price Index,Meat,Dairy,Cereals,Vegetable Oils,Sugar\n"
        b"2025-08,128.0,126.1,150.2,107.9,166.8,103.6\n"
        b"2025-09,128.8,127.0,148.0,105.0,167.9,99.4\n"
        b"2025-10,126.4,125.9,..,104.7,165.0,98.9\n"
        b"\n"
        b"Note: synthetic trailer line\n"
    )


def csdb() -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "CSDB"
    ws.append(["Release", "2026-10"])
    ws.append([])
    ws.append(["Item", "2024/25", "2025/26", "2026/27"])
    ws.append(["Status", "actual", "estimate", "forecast"])
    ws.append(["World cereals stocks-to-use ratio (%)", 30.9, 31.4, 31.7])
    ws.append(["World cereals production (million tonnes)", 2840.1, 2910.0, 2925.5])
    return _xlsx(wb)


def faostat() -> bytes:
    head = (
        "Area Code,Area Code (M49),Area,Item Code,Item,Element Code,Element,Year Code,Year,"
        "Unit,Value,Flag,Note"
    )
    rows = [
        "79,'276,Germany,21004,Prevalence of undernourishment (percent) (3-year average),"
        "6121,Value,20222,2021-2023,%,<2.5,E,",
        "79,'276,Germany,21004,Prevalence of undernourishment (percent) (3-year average),"
        "6121,Value,20232,2022-2024,%,<2.5,E,",
        "100,'356,India,21004,Prevalence of undernourishment (percent) (3-year average),"
        "6121,Value,20222,2021-2023,%,13.7,E,",
        "100,'356,India,21004,Prevalence of undernourishment (percent) (3-year average),"
        "6121,Value,20232,2022-2024,%,13.5,E,",
        "100,'356,India,21004,Prevalence of undernourishment (percent) (3-year average),"
        "6121,Value,20302,2029-2031,%,9.0,F,",
        "9,'032,Argentina,21004,Prevalence of undernourishment (percent) (3-year average),"
        "6121,Value,20222,2021-2023,%,,M,",
        "9,'032,Argentina,21010,Number of people undernourished (million) (3-year average),"
        "6121,Value,20222,2021-2023,million No,3.1,E,",
    ]
    csv_bytes = ("﻿" + head + "\n" + "\n".join(rows) + "\n").encode()
    return _zip(
        {
            "Food_Security_Data_E_All_Data_(Normalized).csv": csv_bytes,
            "Food_Security_Data_E_Flags.csv": b"Flag,Description\nE,Estimated value\n",
            "Food_Security_Data_E_AreaCodes.csv": b"Area Code,Area\n79,Germany\n",
        }
    )


def ecsurvey() -> bytes:
    wb = Workbook()
    first = wb.active
    assert first is not None
    first.title = "INDUSTRY"
    cons = wb.create_sheet("CONSUMER")
    for ws, base in ((first, -6.0), (cons, -14.0)):
        ws.append(["DATE", "EU", "EA", "DE", "FR", "XX"])
        for i, month in enumerate((8, 9, 10)):
            ws.append([datetime(2025, month, 30), base + i * 0.4, base - 0.5 + i * 0.3,
                       base - 2.0 + i * 0.5, base + 1.0 - i * 0.2, base + 5])  # fmt: skip
        ws.append([])
    return _zip({"main_indicators_nace2.xlsx": _xlsx(wb), "readme.txt": b"synthetic\n"})


def ameco() -> bytes:
    def doc(code: str, name: str, values: list[object]) -> dict[str, object]:
        return {
            "@frequency": "annual",
            "provider_code": "AMECO",
            "dataset_code": "AVGDGP",
            "series_code": code,
            "series_name": name,
            "period": ["2023", "2024", "2025"],
            "period_start_day": ["2023-01-01", "2024-01-01", "2025-01-01"],
            "value": values,
        }

    body = {
        "series": {
            "docs": [
                doc("DEU.1.0.0.0.AVGDGP", "Germany - Output gap", [-0.4, -1.1, -1.6]),
                doc("FRA.1.0.0.0.AVGDGP", "France - Output gap", [0.2, -0.3, "NA"]),
                doc("USA.1.0.0.0.AVGDGP", "United States - Output gap", [0.9, 1.2, 0.7]),
            ],
            "limit": 1000,
            "num_found": 3,
            "offset": 0,
        }
    }
    return (json.dumps(body, indent=1) + "\n").encode()


def main() -> None:
    _write("pinksheet/monthly_synthetic.xlsx", pinksheet(),
           "https://thedocs.worldbank.org/en/doc/HASH/related/CMO-Historical-Data-Monthly.xlsx",
           "pinksheet_v1@1", "hand-built workbook, sheet 'Monthly Prices'")  # fmt: skip
    _write("fao/ffpi_synthetic.csv", ffpi(),
           "https://www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_indices_data.csv",
           "fao_ffpi_v1@1", "hand-built CSV")  # fmt: skip
    _write("fao/csdb_synthetic.xlsx", csdb(),
           "https://www.fao.org/worldfoodsituation/csdb/en/ (csdb-data-2026-10.xlsx)",
           "fao_csdb_v1@1", "hand-built workbook, sheet 'CSDB'")  # fmt: skip
    _write("fao/foodsecurity_synthetic.zip", faostat(),
           "https://bulks-faostat.fao.org/production/Food_Security_Data_E_All_Data_(Normalized).zip",
           "fao_stat_v1@1", "hand-built zip")  # fmt: skip
    _write("ecsurvey/bcs_synthetic.zip", ecsurvey(),
           "https://economy-finance.ec.europa.eu/ (business and consumer survey ZIP)",
           "ecsurvey_v1@1", "hand-built zip with one workbook")  # fmt: skip
    _write("dbnomics/ameco_avgdgp_synthetic.json", ameco(),
           "https://api.db.nomics.world/v22/series/AMECO/AVGDGP?observations=1&format=json&limit=1000",
           "ameco_v1@1", "hand-built JSON")  # fmt: skip


if __name__ == "__main__":
    main()
