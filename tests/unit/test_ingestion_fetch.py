"""T25 unit tests (no DB): request-to-dataset resolution, run status, row hash."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from macro_monitor.ingestion import fetch
from macro_monitor.ingestion.base import GroupConfig
from macro_monitor.ingestion.connectors.sdmx import EurostatConnector, load_series_entries
from macro_monitor.ingestion.fetch import GroupFetchReport, GroupJob
from macro_monitor.models.types import ParsedObservation, RequestSpec

ROOT = Path(__file__).resolve().parents[2]
SERIES = load_series_entries(ROOT / "config/series_map/eurostat_labour.yaml")


def _group() -> GroupConfig:
    return GroupConfig(
        source_id="eurostat",
        group_id="g",
        base_url="https://ec.europa.eu/eurostat/api/dissemination/",
        request_template={
            "path": "statistics/1.0/data/{dataset}",
            "params": {"format": "JSON", "sinceTimePeriod": "1991-01", "geo": "{entities}"},
            "datasets": ["une_rt_m"],
        },
        fetch_scope="complete",
        missing_markers=frozenset({":"}),
        series=SERIES,
    )


def test_default_filter_resolves_dataset_and_whitelist() -> None:
    g = _group()
    spec = EurostatConnector().plan(g, MagicMock(), "refresh")[0]
    dataset, flt = fetch.default_filter(g, spec)
    assert dataset == "une_rt_m"
    assert flt.series_refs == frozenset(e.key for e in SERIES)
    assert flt.missing_markers == frozenset({":"})
    assert not flt.discover


WB_DATASETS = [
    "FI.RES.TOTL.CD",
    "NY.GDP.PCAP.PP.CD",
    "SP.DYN.LE00.IN",
    "SI.POV.GINI",
    "SL.TLF.CACT.ZS",
]


def _wb_spec(group: GroupConfig, indicator: str) -> RequestSpec:
    url = f"https://api.worldbank.org/v2/country/DEU;FRA/indicator/{indicator}?format=json"
    return RequestSpec(
        source_id=group.source_id,
        group_id=group.group_id,
        method="GET",
        url=url,
        params={},
        headers={},
        request_key=url,
        fetch_mode="full",
        expect_scope="complete",
    )


def _wb_group(datasets: list[str]) -> GroupConfig:
    series = tuple(
        SimpleNamespace(key=f"{d}.{c}", dataset=d) for d in datasets for c in ("DEU", "FRA")
    )
    return GroupConfig(
        source_id="worldbank",
        group_id="worldbank_annual",
        base_url="https://api.worldbank.org/v2/",
        request_template={
            "path": "country/{entities}/indicator/{indicator}",
            "params": {"date": "1960:2030", "per_page": 1000},
            "datasets": datasets,
        },
        fetch_scope="complete",
        missing_markers=frozenset(),
        series=series,  # type: ignore[arg-type]
    )


def test_default_filter_worldbank_picks_each_indicator() -> None:
    g = _wb_group(WB_DATASETS)
    for d in WB_DATASETS:
        dataset, flt = fetch.default_filter(g, _wb_spec(g, d))
        assert dataset == d
        assert flt.series_refs == frozenset({f"{d}.DEU", f"{d}.FRA"})


def test_default_filter_worldbank_prefix_collision() -> None:
    g = _wb_group(["SI.POV.GINI", "SI.POV.GINI.X"])
    for d in ("SI.POV.GINI", "SI.POV.GINI.X"):
        dataset, flt = fetch.default_filter(g, _wb_spec(g, d))
        assert dataset == d
        assert flt.series_refs == frozenset({f"{d}.DEU", f"{d}.FRA"})


def test_run_status() -> None:
    ok = GroupFetchReport("a", outcomes=["new"])
    bad = GroupFetchReport("b", error="x")
    blocked = GroupFetchReport("c", outcomes=["blocked"])
    assert fetch._status([ok, ok]) == "ok"
    assert fetch._status([ok, bad]) == "partial"
    assert fetch._status([bad, blocked]) == "failed"
    assert GroupFetchReport("d", outcomes=["unchanged", "skipped_robots"]).ok


def test_plan_failure_is_contained() -> None:
    conn = MagicMock()
    connector = MagicMock()
    connector.plan.side_effect = ValueError("boom")
    job = GroupJob(source={}, group=_group(), connector=connector, parser_id="p@1")
    rep = fetch.fetch_group(conn, MagicMock(), job, MagicMock(), 1)
    assert rep.error is not None
    assert "boom" in rep.error
    assert not rep.ok


def test_row_hash_is_stable_and_value_sensitive() -> None:
    def obs(v: str) -> ParsedObservation:
        return ParsedObservation(
            "k",
            date(2026, 1, 1),
            date(2026, 1, 31),
            Decimal(v),
            "OBS",
            datetime(2026, 1, 1, tzinfo=UTC),
            None,
            None,
        )

    assert fetch._row_hash(obs("1.0")) == fetch._row_hash(obs("1.0"))
    assert fetch._row_hash(obs("1.0")) != fetch._row_hash(obs("1.1"))


def test_group_config_snapshot_mode_from_config() -> None:
    src = {"id": "s", "base_url": "u"}

    def mode(g: dict[str, object]) -> str:
        return GroupConfig.from_config(
            src, {"id": "g", "fetch_scope": "complete", **g}
        ).snapshot_mode

    assert mode({}) == "none"
    assert mode({"reestimating": True}) == "diff_above_tol"
    assert mode({"reestimating": True, "revision": {"snapshot_mode": "none"}}) == "none"


def test_snapshot_rows_use_staging_series_ref() -> None:
    from macro_monitor.ingestion.base import ParseOutput

    o = ParsedObservation(
        "k", date(2026, 1, 1), date(2026, 1, 31), Decimal("1.5"), "OBS",
        datetime(2026, 1, 1, tzinfo=UTC), None, None,
    )  # fmt: skip
    out = ParseOutput(observations=[o], metas=[], rejected=[])
    assert fetch.snapshot_rows(out, "ds") == [("ds|k", date(2026, 1, 1), Decimal("1.5"), "OBS")]
