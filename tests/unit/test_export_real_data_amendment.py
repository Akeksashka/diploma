"""export-real-data-amendment: country-scope/WLD rule, published set, EXP-02 domain_ids clause."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from macro_monitor.publish import checks
from macro_monitor.publish.manifest import FileEntry
from macro_monitor.publish.published import PUBLISHED_INDICATOR_IDS_SQL
from macro_monitor.registry.indicators import load_indicators
from macro_monitor.registry.sync import MapEntry, map_issues

ROOT = Path(__file__).resolve().parents[2]


def _entry(indicator: str, entity: str) -> MapEntry:
    return MapEntry(
        "s", "g", "d", "k", entity, indicator, "headline", "2000-01-01", None, "r", None, {}
    )


def test_country_scope_indicator_must_not_map_to_wld() -> None:
    cfg = load_indicators(ROOT / "config/indicators.yaml", ROOT / "config/indicator_defaults.yaml")
    ents = frozenset({"WLD", "DEU"})
    bad = map_issues([_entry("M18", "WLD")], cfg, ents)
    assert any("must not map to WLD" in i.message for i in bad)
    for ok in (_entry("G03", "WLD"), _entry("M18", "DEU")):
        assert not any("must not map to WLD" in i.message for i in map_issues([ok], cfg, ents))


def test_published_set_requires_a_domain_membership() -> None:
    sql = PUBLISHED_INDICATOR_IDS_SQL
    assert "ref.indicator_domain" in sql
    assert "NOT i.is_comparison" in sql
    assert "kind = 'indicator'" in sql
    for mod in ("meta", "series", "scorecard", "revisions", "checks"):
        src = (ROOT / f"src/macro_monitor/publish/{mod}.py").read_text(encoding="utf-8")
        assert "PUBLISHED_INDICATOR_IDS_SQL" in src, mod
        assert "NOT is_comparison" not in src, mod
        assert "NOT i.is_comparison" not in src, mod


def test_exp04_expected_counts_use_the_shared_published_set() -> None:
    seen: list[str] = []

    def fetch(sql: str, params: Any = None) -> list[Any]:
        seen.append(sql)
        return []

    ref: Any = SimpleNamespace(session=SimpleNamespace(fetch=fetch))
    run: Any = SimpleNamespace(known_cutoff="2026-01-01")
    out = checks._Run("EXP-04", checks.CheckReport())
    checks.check_exp04([], {}, ref, run, out)
    assert len(seen) >= 2
    for sql in seen[:2]:
        assert PUBLISHED_INDICATOR_IDS_SQL in sql
        assert "PROJ" in sql


def test_exp05_alerts_ignore_domainless_indicators() -> None:
    rows = [("M18", "DEU", "alert", 3.0, "high"), ("M22", "DEU", "watch", 2.0, "high")]

    def fetch(sql: str, params: Any = None) -> list[Any]:
        return rows if "v_alert_published" in sql else []

    ref: Any = SimpleNamespace(session=SimpleNamespace(fetch=fetch), allowed={"M18"})
    run: Any = SimpleNamespace(analysis_run_id=1)
    doc = {"alerts": [{"indicator_id": "M18", "entity_id": "DEU", "level": "alert",
                       "z": 3.0, "confidence": "high"}]}  # fmt: skip
    out = checks._Run("EXP-05", checks.CheckReport())
    checks.check_exp05({"alerts.json": doc}, ref, run, out)
    assert not any("alerts.json" in str(m) for m in getattr(out, "messages", []))
    assert out.n_fail == 0


def test_exp02_fails_on_empty_domain_ids() -> None:
    ref: Any = SimpleNamespace(allowed={"M18"}, inputs=set(), series_ind={}, scope={}, is_global={})
    for domain_ids, n_fail in ((["fin"], 0), ([], 1)):
        doc = {"indicators": [{"indicator_id": "M18", "domain_ids": domain_ids}]}
        f = FileEntry("meta/indicators.json", "json", json.dumps(doc).encode())
        out = checks._Run("EXP-02", checks.CheckReport())
        checks.check_exp02([f], {f.path: doc}, ref, out)
        assert out.n_fail == n_fail
