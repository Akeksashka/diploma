"""T87 / T88: the site builds a scorecard and an explorer page from a fixture export.

Node.js is a build-time tool for ``site/`` only. The build runs in a subprocess (sockets of this
process are blocked, the subprocess is not used for network: it needs the Observable import cache
under ``site/src/.observablehq``, filled once by ``npm run build`` with network access). Without
node, ``site/node_modules`` or that cache the build tests are skipped, with the reason shown.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from tests.fixtures.site_spike.make_export import INDICATOR, build_export

pytestmark = pytest.mark.unit

SITE = Path(__file__).resolve().parents[2] / "site"
NODE_FALLBACK = Path.home() / ".local" / "node" / "bin"
CLI = SITE / "node_modules" / "@observablehq" / "framework" / "dist" / "bin" / "observable.js"
CACHE = SITE / "src" / ".observablehq" / "cache"


def _node() -> str | None:
    return shutil.which("node") or shutil.which("node", path=str(NODE_FALLBACK))


def _run(node: str, args: list[str], export: Path, out: Path) -> subprocess.CompletedProcess[str]:
    env = {
        "PATH": str(Path(node).parent),
        "HOME": str(Path.home()),
        "EXPORT_DIR": str(export),
        "OBSERVABLE_TELEMETRY_DISABLE": "true",
    }
    return subprocess.run(
        [node, *args],
        cwd=SITE,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def test_pinned_versions_and_ignored_outputs() -> None:
    pkg = json.loads((SITE / "package.json").read_text(encoding="utf-8"))
    for name, version in {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}.items():
        assert re.fullmatch(r"\d+\.\d+\.\d+", version), f"{name} is not pinned exactly: {version}"
    assert (SITE / "package-lock.json").is_file()
    ignore = (SITE / ".gitignore").read_text(encoding="utf-8").split()
    assert {"node_modules/", "dist/", "src/data/"} <= set(ignore)


# ADR-024 decision 1 (AC-NPM-1): the only direct dependencies site/ may have. Plot and d3 are the P1
# pins of ADR-023 decision 5; Playwright (ADR-016) arrives with T94.
APPROVED_NPM = {"@observablehq/framework", "@observablehq/plot", "d3", "playwright"}


def test_direct_dependencies_are_on_the_approved_list_and_node_is_pinned() -> None:
    pkg = json.loads((SITE / "package.json").read_text(encoding="utf-8"))
    declared = set(pkg.get("dependencies", {})) | set(pkg.get("devDependencies", {}))
    assert declared <= APPROVED_NPM, sorted(declared - APPROVED_NPM)
    assert {"@observablehq/framework", "@observablehq/plot", "d3"} <= declared
    nvmrc = (SITE / ".nvmrc").read_text(encoding="utf-8").strip()
    assert re.fullmatch(r"\d+\.\d+\.\d+", nvmrc), nvmrc
    assert pkg["engines"]["node"].startswith(f">={nvmrc} "), pkg["engines"]
    config = (SITE / "observablehq.config.js").read_text(encoding="utf-8")
    assert "globalStylesheets: []" in config


def test_js_unit_tests_pass(tmp_path: Path) -> None:
    node = _node()
    if node is None:
        pytest.skip("node not installed")
    build_export(tmp_path / "export")  # the JS render test reads the generated fixture
    res = subprocess.run(
        [node, "--test", "tests/"],
        cwd=SITE,
        env={
            "PATH": str(Path(node).parent),
            "HOME": str(Path.home()),
            "MM_FIXTURE_EXPORT": str(tmp_path / "export"),
        },
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert res.returncode == 0, res.stdout[-3000:] + res.stderr[-1000:]


def test_fixture_export_is_deterministic(tmp_path: Path) -> None:
    build_export(tmp_path / "a")
    build_export(tmp_path / "b")
    ma = (tmp_path / "a" / "manifest.json").read_bytes()
    assert ma == (tmp_path / "b" / "manifest.json").read_bytes()
    manifest = json.loads(ma)
    assert manifest["schema_version"].startswith("1.")
    assert {f["path"] for f in manifest["files"]} >= {
        f"series/{INDICATOR}.parquet",
        "scorecard/labour.json",
    }


def test_fixture_export_matches_the_published_json_schemas(tmp_path: Path) -> None:
    """The synthetic export has the real file shapes (no drifted spike shapes)."""
    from macro_monitor.publish import manifest as mf

    build_export(tmp_path)
    checked = 0
    for p in sorted(tmp_path.rglob("*.json")):
        rel = p.relative_to(tmp_path).as_posix()
        if rel.startswith("scorecard/"):
            name = "scorecard"
        elif rel.startswith("meta/"):
            name = f"meta-{p.stem}"
        else:
            name = p.stem.replace("_", "-")  # revisions_recent.json -> revisions-recent
        mf.validate_json(json.loads(p.read_text(encoding="utf-8")), name)
        checked += 1
    assert checked == 14


def test_fixture_covers_the_ac_dash_4_cases(tmp_path: Path) -> None:
    build_export(tmp_path)
    sc = {
        d: json.loads((tmp_path / "scorecard" / f"{d}.json").read_text(encoding="utf-8"))
        for d in ("labour", "prices", "agri", "global")
    }
    labour = {e["entity_id"]: e for e in sc["labour"]["entities"]}
    stale = [i for e in labour.values() for i in e["indicators"] if i["is_stale"]]
    assert stale
    assert all(i["percentile"] is None for i in stale)
    assert labour["ITA"]["n_available"] == 0
    assert labour["ITA"]["percentile_rank"] is None
    assert labour["FRA"]["low_coverage"]
    assert labour["FRA"]["percentile_rank"] is not None
    assert labour["FRA"]["rank_position"] is None
    assert any(i["rank_mode"] == "descriptive_only" for i in labour["DEU"]["indicators"])
    assert sc["labour"]["heterogeneous_peer_set"]
    assert not sc["prices"]["heterogeneous_peer_set"]
    for d in ("agri", "global"):
        assert sc[d]["ranked"] is False
        for e in sc[d]["entities"]:
            assert e["percentile_rank"] is None
            assert e["rank_position"] is None
            assert all(i["percentile"] is None for i in e["indicators"])


def test_fixture_covers_the_v2_cases(tmp_path: Path) -> None:
    """Peer groups, lagging, unaligned, the spread and the M18 note (AC-DASH-9, M18 wording)."""
    from tests.fixtures.site_spike.make_export import GROUPS, M18_NOTE

    build_export(tmp_path)

    def load(rel: str) -> dict[str, object]:
        out: dict[str, object] = json.loads((tmp_path / rel).read_text(encoding="utf-8"))
        return out

    groups = load("meta/groups.json")["groups"]
    assert {g["group_id"] for g in groups} >= {"euro_area", "g7", "advanced", "emerging"}  # type: ignore[attr-defined,index]
    assert set(GROUPS["emerging"]) & set(GROUPS["g7"]) == set()
    labour = load("scorecard/labour.json")
    ents = {e["entity_id"]: e for e in labour["entities"]}  # type: ignore[attr-defined,index]
    m09 = {
        k: next(i for i in e["indicators"] if i["indicator_id"] == "M09") for k, e in ents.items()
    }
    assert m09["USA"]["alignment"] == "lagging"
    assert m09["USA"]["percentile"] is None
    assert m09["IND"]["alignment"] == "unaligned"
    assert m09["IND"]["alignment_reason"]
    assert m09["IND"]["percentile"] is None
    assert m09["IND"]["value"] is not None
    assert m09["DEU"]["percentile"] is not None
    spread = next(a for a in labour["alignment"] if a["indicator_id"] == "M09")  # type: ignore[attr-defined,index]
    assert spread["reference_period_spread_days"] is not None
    assert spread["n_ranked"] == sum(1 for i in m09.values() if i["percentile"] is not None)
    inds = load("meta/indicators.json")["indicators"]
    m18 = next(i for i in inds if i["indicator_id"] == "M18")  # type: ignore[attr-defined,index]
    assert m18["notes"] == [M18_NOTE]
    fin = load("scorecard/fin.json")
    assert fin["ranked"] is False
    assert {e["entity_id"] for e in fin["entities"]} >= {"DEU", "USA", "POL"}  # type: ignore[attr-defined,index]


def test_fixture_series_files_use_the_real_writer_and_cover_v3_cases(tmp_path: Path) -> None:
    import pyarrow.parquet as pq

    from macro_monitor.publish.series import SCHEMA

    build_export(tmp_path)
    for ind, na in (("M09", False), ("P01", True)):
        f = pq.ParquetFile(tmp_path / "series" / f"{ind}.parquet")
        assert f.schema_arrow.equals(SCHEMA.remove_metadata())  # dictionary columns, date32, UTC ts
        assert f.metadata.num_row_groups == 3  # one row group per entity
        tbl = f.read()
        default_values = tbl.column("value_default_tf").drop_null()
        assert (len(default_values) == 0) is na  # NSA + M3M3_ANN: the producer leaves it null
        assert tbl.column("value_yoy").null_count == 3 * 12
    series = json.loads((tmp_path / "meta" / "series.json").read_text(encoding="utf-8"))["series"]
    assert {s["seasonal_adjustment"] for s in series if s["indicator_id"] == "P01"} == {"NSA"}
    alerts = json.loads((tmp_path / "alerts.json").read_text(encoding="utf-8"))["alerts"]
    assert {a["level"] for a in alerts} == {"alert", "watch"}


def test_fixture_covers_the_v4_cases(tmp_path: Path) -> None:
    """Revision files from the real producer code, an ordinary list with both classes, and one
    WEO-style edition summary kept out of the ordinary list (AC-EXP-13 shape)."""
    import pyarrow.parquet as pq

    from macro_monitor.publish.revisions import SCHEMA

    build_export(tmp_path)
    recent = json.loads((tmp_path / "revisions_recent.json").read_text(encoding="utf-8"))
    series = {
        s["series_id"]: s
        for s in json.loads((tmp_path / "meta" / "series.json").read_text(encoding="utf-8"))[
            "series"
        ]
    }
    rows = recent["revisions"]
    assert rows
    assert {r["revision_class"] for r in rows} == {"regular", "reestimation"}
    assert {"revision", "tombstone"} == {r["load_kind"] for r in rows}
    assert all(r["indicator_id"] != "M10" for r in rows)  # the edition is not in the ordinary list
    order = [r["revision_class"] != "regular" for r in rows]
    assert order == sorted(order)  # regular rows before re-estimation rows
    (edition,) = recent["edition_summaries"]
    assert edition["vintage_label"] == "WEO-2026-10"
    assert (edition["n_series"], edition["n_keys_revised"]) == (2, 12)
    assert edition["max_abs_pct"] == 41.7
    assert 0 < len(edition["top_revisions"]) <= 10
    for r in [*rows, *edition["top_revisions"]]:  # headline series of published indicators only
        assert series[r["series_id"]]["indicator_id"] == r["indicator_id"]
        assert series[r["series_id"]]["publish"] == "public"
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    paths = {f["path"] for f in manifest["files"]}
    assert {
        "revisions_recent.json",
        *(f"revisions/{i}.parquet" for i in ("M09", "M10", "P01")),
    } <= (paths)
    for ind in ("M09", "M10", "P01"):
        f = pq.ParquetFile(tmp_path / "revisions" / f"{ind}.parquet")
        assert f.schema_arrow.equals(SCHEMA.remove_metadata())
        tbl = f.read()
        assert set(tbl.column("value_status").to_pylist()) <= {"OBS", "EST", "DEL"}  # never PROJ
        assert set(tbl.column("revision_class").to_pylist()) <= {"regular", "reestimation"}
    m10 = pq.read_table(tmp_path / "revisions" / "M10.parquet")
    assert set(m10.column("edition_ordered").to_pylist()) == {True}
    assert set(m10.column("vintage_label").to_pylist()) == {"WEO-2026-04", "WEO-2026-10"}


def test_fixture_status_covers_the_v5_cases(tmp_path: Path) -> None:
    build_export(tmp_path)
    st = json.loads((tmp_path / "status.json").read_text(encoding="utf-8"))
    assert all(g["load_result"] is None for g in st["groups"])  # T83 gap: always null
    assert {g["state"] for g in st["groups"]} == {"fresh", "late", "stale", "broken"}
    assert any(g["source_group"].endswith("withheld") for g in st["groups"])
    cov = {c["state"] for c in st["validation"]["cov01"]}
    assert cov == {"not_yet_measurable", "measured"}
    assert all(
        set(c) <= {"indicator_id", "state", "n_qualifying", "n_results", "n_failed"}
        for c in st["validation"]["cov01"]
    )  # no stale-on-arrival share (T83 gap)
    assert st["backlog"].keys() == {"n_unloaded", "oldest_age_days"}  # one block, not per group
    assert any(m["next_expected"] is None for m in st["manual_sources"])
    assert "values" not in json.dumps(st).lower().replace("no values", "")


def test_prepare_data_refuses_unknown_major(tmp_path: Path) -> None:
    node = _node()
    if node is None:
        pytest.skip("node not installed")
    export = tmp_path / "export"
    build_export(export)
    manifest = json.loads((export / "manifest.json").read_text(encoding="utf-8"))
    manifest["schema_version"] = "2.0"
    (export / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    res = _run(node, ["scripts/prepare-data.mjs"], export, tmp_path)
    assert res.returncode != 0
    assert "unsupported manifest major version" in res.stderr


def test_site_builds_scorecard_and_explorer_without_off_origin_urls(tmp_path: Path) -> None:
    node = _node()
    if node is None:
        pytest.skip("node not installed")
    if not CLI.is_file():
        pytest.skip("site/node_modules missing: run `npm ci` in site/")
    if not CACHE.is_dir():
        pytest.skip("Observable import cache missing: run `npm run build` once with network")
    export = tmp_path / "export"
    build_export(export)
    prep = _run(node, ["scripts/prepare-data.mjs"], export, tmp_path)
    assert prep.returncode == 0, prep.stderr
    dist = SITE / "dist"  # git-ignored; the config sets `output: "dist"`
    shutil.rmtree(dist, ignore_errors=True)
    res = _run(node, [str(CLI), "build"], export, tmp_path)
    assert res.returncode == 0, res.stdout + res.stderr
    assert (dist / "index.html").is_file()
    assert (dist / "explorer.html").is_file()
    for d in ("labour", "prices", "agri", "global", "fin"):
        assert (dist / "domain" / f"{d}.html").is_file()
        assert not (dist / "peers" / f"{d}.html").exists()  # peers pages removed in the redesign
    labour_html = (dist / "domain" / "labour.html").read_text(encoding="utf-8")
    assert "registerFile" in labour_html
    assert "scorecard/labour" in labour_html
    index_html = (dist / "index.html").read_text(encoding="utf-8")
    assert "Percentiles are relative position in the covered panel" in index_html
    assert "mm-home-list" in index_html  # the list itself is rendered in the browser
    assert list((dist / "_file" / "data" / "series").glob("M09.*.parquet"))
    assert list((dist / "_file" / "data" / "series").glob("P01.*.parquet"))
    explorer_html = (dist / "explorer.html").read_text(encoding="utf-8")
    assert "series/M09.parquet" in explorer_html  # V3: one lazy FileAttachment per series file
    assert "series/P01.parquet" in explorer_html
    assert "alerts.json" in explorer_html
    assert "duckdb" not in " ".join(p.name.lower() for p in dist.rglob("*"))  # C6: Arrow reader
    revisions_html = (dist / "revisions.html").read_text(encoding="utf-8")  # V4
    assert "revisions/M09.parquet" in revisions_html  # one lazy FileAttachment per revision file
    assert "revisions/M10.parquet" in revisions_html
    assert "revisions/P01.parquet" in revisions_html
    assert "revisions_recent.json" in revisions_html
    assert list((dist / "_file" / "data" / "revisions").glob("M09.*.parquet"))
    assert list((dist / "_file" / "data").glob("revisions_recent.*.json"))
    built_js = "".join(
        p.read_text(encoding="utf-8")
        for pattern in ("revisions*.js", "copy*.js")
        for p in (dist / "_import" / "lib").glob(pattern)
    )
    assert "Vintages are recorded from this system's first fetch" in built_js
    assert "History before the first fetch is revised data, not real time." in built_js
    assert "earliest stored version" in built_js
    assert not (dist / "status.html").exists()  # PG-STATUS withdrawn (ADR-030, redesign spec)
    forbidden = [" ".join(w) for w in (("first", "release"), ("first", "stored", "release"))]
    for p in [*dist.rglob("*"), *(f for f in SITE.rglob("*") if f.is_file())]:
        if (
            not p.is_file()
            or "node_modules" in p.parts
            or ".observablehq" in p.parts
            or p.name == "package-lock.json"
            or p.suffix not in {".html", ".js", ".mjs", ".md", ".json", ".css", ".lock", ".yml"}
        ):
            continue
        low = re.sub(r"[\s_-]+", " ", p.read_text(encoding="utf-8").lower())
        for phrase in forbidden:
            assert phrase not in low, f"{p} contains {phrase!r}"  # AC-EXP-12, source and build
    interaction = _run(node, ["scripts/measure-explorer.mjs", str(dist)], export, tmp_path)
    assert interaction.returncode == 0, interaction.stdout + interaction.stderr  # <= 5 MB gzip -9
    assert list((dist / "_file" / "data" / "scorecard").glob("labour.*.json"))
    measure = _run(node, ["scripts/measure-landing.mjs", str(dist)], export, tmp_path)
    assert measure.returncode == 0, measure.stdout[-2000:] + measure.stderr  # <= 1.5 MB gzip -9
    # the landing page and a domain page (scorecard JSON + meta) are each within the limit
    pages = ("domain/labour.html", "domain/agri.html")
    for page in (*pages, "explorer.html", "revisions.html"):
        m = _run(node, ["scripts/measure-landing.mjs", str(dist), page], export, tmp_path)
        assert m.returncode == 0, m.stdout[-2000:] + m.stderr
    imports = _run(node, ["scripts/check-npm-imports.mjs"], export, tmp_path)
    assert imports.returncode == 0, imports.stdout + imports.stderr  # P2 lock matches dist/_npm
    allowed = ("http://www.w3.org/", "https://www.jsdelivr.com/using-sri-with-dynamic-files")
    offending: set[str] = set()
    for p in dist.rglob("*"):
        if p.suffix in {".html", ".js", ".css"}:
            for url in re.findall(r"https?://[A-Za-z0-9./_-]+", p.read_text(encoding="utf-8")):
                if not url.startswith(allowed):
                    offending.add(url)
    assert not offending, sorted(offending)
