#!/usr/bin/env python3
"""Print the PROPOSED Eurostat mapping CSV (T53) for ``scripts/seed_series_map.py``.

Coverage facts come from docs/research/data-sources-g20-eu-cross-country.md F5/F13 (VERIFIED-LIVE
2026-10-17): sts_inpr_m, sts_trtu_m, prc_hicp_minr cover the 27 EU members plus Turkiye;
gov_10q_ggdebt covers the 27 EU members only. M12 (ext_st_27_2020msbec) is NOT proposed: the
indicator is "exports and imports", the series map allows no comparison role for it (rule 12) and
one headline per pair, so the choice needs a design decision (see the plan note of T53).
Dimension ORDER and category codes of each dataset are [UNVERIFIED] until an operator capture
(OP-04) confirms them;
the fixtures of the golden tests are synthetic. The output is a proposal for the T52 review, not
a reviewed CSV: every rationale says so. Deterministic; no network.

Usage: scripts/eurostat_proposal_csv.py > proposal.csv
       scripts/seed_series_map.py proposal.csv
"""

from __future__ import annotations

import csv
import sys
from collections.abc import Sequence
from dataclasses import dataclass

#: Eurostat geo code -> panel entity id (Greece is EL at Eurostat, not GR).
EU27: dict[str, str] = {
    "AT": "AUT", "BE": "BEL", "BG": "BGR", "CY": "CYP", "CZ": "CZE", "DE": "DEU",
    "DK": "DNK", "EE": "EST", "EL": "GRC", "ES": "ESP", "FI": "FIN", "FR": "FRA",
    "HR": "HRV", "HU": "HUN", "IE": "IRL", "IT": "ITA", "LT": "LTU", "LU": "LUX",
    "LV": "LVA", "MT": "MLT", "NL": "NLD", "PL": "POL", "PT": "PRT", "RO": "ROU",
    "SE": "SWE", "SI": "SVN", "SK": "SVK",
}  # fmt: skip
EU27_TR: dict[str, str] = {**EU27, "TR": "TUR"}
PENDING = "PROPOSED from research F5/F13, pending T52 review; key order and codes [UNVERIFIED]"


@dataclass(frozen=True)
class Block:
    group: str
    dataset: str
    indicator: str
    role: str
    key_prefix: str  # all dimensions before geo, joined with '.'
    geos: dict[str, str]
    expect: str
    what: str


BLOCKS: tuple[Block, ...] = (
    Block(
        "eurostat_sts", "sts_inpr_m", "M01", "headline", "M.PROD.B-D.SCA.I21", EU27_TR,
        "frequency=M;unit=I21;seasonal_adjustment=SCA;price_basis=NA",
        "Eurostat industrial production index (excl. construction), seasonally and calendar "
        "adjusted, 2021=100; indic_bt=PROD returned an empty cube in the 2026-11-06 DE probe, "
        "correct code unverified",
    ),
    Block(
        "eurostat_sts", "sts_trtu_m", "M02", "headline", "M.VOL_SLS.G47.SCA.I21", EU27_TR,
        "frequency=M;unit=I21;seasonal_adjustment=SCA;price_basis=NA",
        "Eurostat retail trade volume (G47), seasonally and calendar adjusted, 2021=100",
    ),
    Block(
        "eurostat_hicp", "prc_hicp_minr", "M06", "headline", "M.I25.TOTAL", EU27_TR,
        "frequency=M;unit=I25;seasonal_adjustment=NA;price_basis=NA",
        "Eurostat HICP all-items index, 2025=100 (COICOP 2018)",
    ),
    Block(
        "eurostat_hicp", "prc_hicp_minr", "M07", "headline", "M.I25.TOT_X_NRG_FOOD", EU27_TR,
        "frequency=M;unit=I25;seasonal_adjustment=NA;price_basis=NA",
        "Eurostat HICP excluding energy, food, alcohol and tobacco index, 2025=100",
    ),
    Block(
        "eurostat_hicp", "prc_hicp_minr", "G01", "headline", "M.I25.CP01", EU27_TR,
        "frequency=M;unit=I25;seasonal_adjustment=NA;price_basis=NA",
        "Eurostat HICP food and non-alcoholic beverages index, 2025=100",
    ),
    Block(
        "eurostat_gov_debt", "gov_10q_ggdebt", "Q08", "headline", "Q.GD.S13.PC_GDP", EU27,
        "frequency=Q;unit=PC_GDP;seasonal_adjustment=NA;price_basis=NA",
        "Eurostat quarterly general government gross debt, % of GDP (S13, GD)",
    ),
)  # fmt: skip

COLUMNS = ("indicator", "entity", "source", "dataset", "key", "role", "expect", "rationale")


def rows() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for b in BLOCKS:
        for geo, entity in b.geos.items():
            out.append(
                {
                    "indicator": b.indicator,
                    "entity": entity,
                    "source": b.group,
                    "dataset": b.dataset,
                    "key": f"{b.key_prefix}.{geo}",
                    "role": b.role,
                    "expect": b.expect,
                    "rationale": f"{b.what} ({PENDING})",
                }
            )
    return out


def main(argv: Sequence[str] | None = None) -> int:
    del argv
    writer = csv.DictWriter(sys.stdout, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
