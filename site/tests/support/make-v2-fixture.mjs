// Deterministic generator of the SYNTHETIC v2 fixture tests/fixtures/v2_export (V7, dashboard v2 analytical plan).
// Every number, name-of-series and date is invented for tests; nothing here is a measurement and it is not a real export
// (plan gate G-REAL stays open). Country and aggregate names are only labels so tests read naturally.
// Differences from a real export, stated so that no test treats the fixture as evidence about it:
//  - series/<indicator_id>.json is JSON ({columns, rows}); the real export stores Parquet. Node cannot write Parquet without a
//    new dependency (not allowed), so the same columns are written as JSON rows. Readers under test take rows, not bytes.
//  - fixture indicators V01..V06 exist only to exercise the compatibility, hidden-rows and caption rules.
// Run `node tests/support/make-v2-fixture.mjs` to rewrite the directory; tests/fixtures.test.mjs fails if the files drift.
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

export const V2_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "v2_export");
export const FIXED = {generated_at: "2026-11-03T00:05:00Z", known_cutoff: "2026-11-03T00:00:00Z", known_at: "2026-11-01T04:23:41Z"};
const json = (o) => JSON.stringify(o, null, 1) + "\n";

// [entity_id, name, group ids]. 42 countries (the dense variant, decisions O-1) then 3 aggregates.
const EA = ["DEU", "FRA", "ITA", "ESP", "NLD", "BEL", "AUT", "PRT", "IRL", "FIN", "GRC", "SVK", "SVN", "EST", "LVA", "LTU", "LUX", "MLT", "CYP", "HRV"];
const NON_EURO_EU = ["POL", "CZE", "HUN", "ROU", "BGR", "SWE", "DNK"];
const OTHER = ["USA", "JPN", "GBR", "CAN", "AUS", "CHN", "IND", "BRA", "TUR", "UKR", "KOR", "MEX", "ZAF", "IDN", "NOR"];
export const COUNTRY_IDS = [...EA, ...NON_EURO_EU, ...OTHER];
const NAMES = {DEU: "Germany", FRA: "France", ITA: "Italy", ESP: "Spain", NLD: "Netherlands", BEL: "Belgium", AUT: "Austria", PRT: "Portugal", IRL: "Ireland", FIN: "Finland", GRC: "Greece", SVK: "Slovakia", SVN: "Slovenia", EST: "Estonia", LVA: "Latvia", LTU: "Lithuania", LUX: "Luxembourg", MLT: "Malta", CYP: "Cyprus", HRV: "Croatia", POL: "Poland", CZE: "Czechia", HUN: "Hungary", ROU: "Romania", BGR: "Bulgaria", SWE: "Sweden", DNK: "Denmark", USA: "United States", JPN: "Japan", GBR: "United Kingdom", CAN: "Canada", AUS: "Australia", CHN: "China", IND: "India", BRA: "Brazil", TUR: "Turkiye", UKR: "Ukraine", KOR: "South Korea", MEX: "Mexico", ZAF: "South Africa", IDN: "Indonesia", NOR: "Norway"};
const G7 = ["DEU", "FRA", "ITA", "USA", "JPN", "GBR", "CAN"];
const ADVANCED = [...G7, "ESP", "NLD", "BEL", "AUT", "AUS", "KOR", "NOR", "DNK", "SWE"];
const GROUPS = {euro_area: EA, g7: G7, advanced: ADVANCED, emerging: ["CHN", "IND", "BRA", "TUR", "MEX", "ZAF", "IDN", "UKR"], non_euro_eu: NON_EURO_EU};
const groupIdsOf = (id) => Object.keys(GROUPS).filter((g) => GROUPS[g].includes(id)).sort();

export function entitiesDoc() {
  const countries = COUNTRY_IDS.map((id) => ({entity_id: id, group_ids: groupIdsOf(id), is_global: false, is_ranked: true, iso3: id, kind: "country", name: NAMES[id]}));
  const aggregates = [["EU27", "European Union"], ["EA", "Euro area"], ["WLD", "World"]].map(([id, name]) => ({entity_id: id, group_ids: [], is_global: id === "WLD", is_ranked: false, iso3: null, kind: "aggregate", name}));
  return {schema_version: "1.0", entities: [...countries, ...aggregates]};
}

export function groupsDoc() {
  return {schema_version: "1.0", groups: Object.entries(GROUPS).map(([group_id, ids]) => ({group_id, name: group_id, members: ids.map((entity_id) => ({entity_id, valid_from: "1999-01-01", valid_to: null}))}))};
}

const IND = (indicator_id, name, unit_label, domain_ids, frequency_set, extra = {}) => ({adverse_dir: 0, alert_method: "none", currency_basis: "n/a", default_transform: "LEVEL", display_dir: null, domain_ids, frequency_set, good_dir: 0, indicator_id, max_ref_spread_days: 92, name, notes: [], priority: "core", rank_mode: "monotone_good", scope: "country", staleness_limit_days: 120, target: null, transform_options: ["LEVEL"], unit_label, ...extra});
const INDICATORS = [
  IND("M09", "Unemployment rate (synthetic)", "% of labour force", ["labour"], ["M"], {adverse_dir: 1, good_dir: -1}),
  IND("M10", "Employment rate (synthetic)", "% of population 15-64", ["labour"], ["M"], {adverse_dir: -1, good_dir: 1}),
  IND("M11", "Population 15-64 (synthetic)", "million", ["labour"], ["M"], {rank_mode: "descriptive_only"}),
  IND("P01", "Consumer price index (synthetic)", "index", ["prices"], ["M"], {rank_mode: "descriptive_only"}),
  IND("A01", "Agricultural land share (synthetic)", "% of land area", ["agri"], ["A"], {rank_mode: "descriptive_only"}),
  IND("A02", "Real GDP growth (synthetic)", "% y/y", ["growth"], ["A"], {adverse_dir: -1, good_dir: 1}),
  IND("Q08", "Business confidence (synthetic)", "balance, points", ["growth"], ["Q"], {adverse_dir: -1, good_dir: 1}),
  IND("A04", "General government balance (synthetic)", "% of GDP", ["fiscal"], ["A"], {adverse_dir: -1, good_dir: 1}),
  IND("A05", "Gross government debt (synthetic)", "% of GDP", ["fiscal"], ["A"], {adverse_dir: 1, good_dir: -1}),
  IND("V01", "QA: two unit codes (synthetic)", "see series", ["qa"], ["A"], {rank_mode: "descriptive_only"}),
  IND("V02", "QA: SA and NSA mix (synthetic)", "% of labour force", ["qa"], ["M"], {rank_mode: "descriptive_only"}),
  IND("V03", "QA: index, two base periods (synthetic)", "index", ["qa"], ["M"], {rank_mode: "descriptive_only"}),
  IND("V04", "QA: flow_basis absent for some series (synthetic)", "% of GDP", ["qa"], ["A"], {rank_mode: "descriptive_only"}),
  IND("V05", "QA: stored value_yoy (synthetic)", "index", ["qa"], ["M"], {rank_mode: "descriptive_only"}),
  IND("V06", "QA: more than one frequency (synthetic)", "% of GDP", ["qa"], ["M", "Q"], {rank_mode: "descriptive_only"})
];
const DOMAINS = [
  ["labour", "Labour", ["M09", "M10", "M11"], true],
  ["prices", "Prices", ["P01"], true],
  ["fiscal", "Fiscal", ["A04", "A05"], true],
  ["growth", "Growth", ["A02", "Q08"], true],
  ["agri", "Agriculture", ["A01"], false],
  ["qa", "QA cases (synthetic)", ["V01", "V02", "V03", "V04", "V05", "V06"], false]
];
export const domainsDoc = () => ({schema_version: "1.0", domains: DOMAINS.map(([domain_id, name, indicator_ids, ranked]) => ({domain_id, indicator_ids, min_coverage_for_rank: 0.5, name, notices: ranked ? [] : ["informational, unranked"], percentile_rank_label: "mean percentile of the domain's indicators", ranked}))});
export const indicatorsDoc = () => ({schema_version: "1.0", indicators: INDICATORS});

// Periods. Monthly 2024-01..2026-09 (33, inside the 36-column window), quarterly 2018Q1..2026Q2 (34), annual 1995..2025 (31).
const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthly = () => Array.from({length: 33}, (_, i) => { const y = 2024 + Math.floor(i / 12); const m = (i % 12) + 1; return {start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${lastDay(y, m)}`}; });
const quarterly = () => Array.from({length: 34}, (_, i) => { const y = 2018 + Math.floor(i / 4); const q = i % 4; const m = q * 3 + 3; return {start: `${y}-${pad(q * 3 + 1)}-01`, end: `${y}-${pad(m)}-${lastDay(y, m)}`}; });
const annual = () => Array.from({length: 31}, (_, i) => ({start: `${1995 + i}-01-01`, end: `${1995 + i}-12-31`}));
const GRID = {M: monthly(), Q: quarterly(), A: annual()};
const LATEST = {M: "2026-09-30", Q: "2026-06-30", A: "2025-12-31"};

// mulberry32 over a string seed: deterministic pseudo-random in [0, 1).
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Series catalogue. Each spec: {ind, ent, freq, unit, sa, ...overrides}.
// overrides: end (last period end stored; earlier = stale series), gaps (period ends stored as MISS), est (last row EST), prov (last row PROV),
// base (base_period), flow ("absent" omits the key), mult, yoy (write value_yoy), level/scale (value generator), price.
const series = [];
let nextId = 1000;
const add = (ind, ent, freq, unit, o = {}) => series.push({series_id: nextId++, ind, ent, freq, unit, sa: o.sa ?? "NSA", ...o});

const first = (arr, n) => arr.slice(0, n);
for (const e of first(COUNTRY_IDS, 28)) { // M09, M10, M11: 28 countries (configured coverage pattern of the coverage-42 plan)
  add("M09", e, "M", "PCT", {sa: "SA", level: 6, scale: 3, ...(e === "DEU" ? {prov: true} : {}), ...(e === "FRA" || e === "ITA" ? {end: "2025-12-31"} : {}), ...(e === "USA" ? {end: "2026-06-30"} : {}), ...(e === "ESP" ? {gaps: ["2025-03-31", "2025-04-30", "2025-05-31"]} : {})});
  add("M10", e, "M", "PCT", {sa: "SA", level: 68, scale: 6, ...(e === "ITA" ? {nodata: true} : {})});
  add("M11", e, "M", "MIO_PER", {level: 40, scale: 20});
}
for (const e of [...first(EA, 19), "EA"]) add("P01", e, "M", "INDEX", {base: "2015", level: 115, scale: 5, trend: 0.25});
for (const e of COUNTRY_IDS) add("A01", e, "A", "PCT", {level: 35, scale: 25});
for (const e of first(COUNTRY_IDS, 25)) add("A02", e, "A", "PCT", {level: 2, scale: 3, ...(e === "ITA" ? {est: true} : {})});
for (const e of first(COUNTRY_IDS, 27)) add("Q08", e, "Q", "PTS", {level: 0, scale: 12, sa: "SA"});
for (const e of [...COUNTRY_IDS, "EU27", "EA", "WLD"]) {
  const extra = e === "TUR" || e === "CHN" ? {nonaligned: true} : e === "ROU" || e === "BGR" ? {end: "2023-12-31"} : {};
  add("A04", e, "A", "PCT", {level: -3, scale: 3, est: true, ...extra});
  add("A05", e, "A", "PCT", {level: 70, scale: 40, est: true, ...extra});
}
// QA indicators.
add("V01", "DEU", "A", "PCT", {level: 5, scale: 2});
add("V01", "FRA", "A", "PCT", {level: 5, scale: 2});
add("V01", "ITA", "A", "EUR_BN", {level: 1800, scale: 100});
add("V01", "POL", "A", "PCT", {level: 5, scale: 2, mult: 3});
for (const [e, sa] of [["DEU", "SA"], ["FRA", "NSA"], ["ITA", "SA"], ["ESP", "NSA"]]) add("V02", e, "M", "PCT", {sa, level: 7, scale: 2});
for (const [e, base] of [["DEU", "2015"], ["FRA", "2015"], ["ITA", "2010"], ["ESP", "2015"]]) add("V03", e, "M", "INDEX", {base, level: 100, scale: 4, trend: 0.3});
for (const [e, flow] of [["DEU", "n/a"], ["FRA", "n/a"], ["ITA", "absent"], ["ESP", "absent"]]) add("V04", e, "A", "PCT", {flow, level: 3, scale: 1});
for (const e of ["DEU", "FRA"]) add("V05", e, "M", "INDEX", {base: "2015", level: 100, scale: 3, trend: 0.4, yoy: true});
add("V05", "ITA", "M", "INDEX", {base: "2015", level: 100, scale: 3, trend: 0.4});
add("V06", "DEU", "M", "PCT", {level: 2, scale: 1});
add("V06", "DEU", "Q", "PCT", {level: 2, scale: 1});
add("V06", "FRA", "M", "PCT", {level: 2, scale: 1});
add("V06", "ITA", "Q", "PCT", {level: 2, scale: 1});

const CAN_BE = new Set(COUNTRY_IDS);
const aggOk = (e) => CAN_BE.has(e) || ["EU27", "EA", "WLD"].includes(e);
if (!series.every((s) => aggOk(s.ent))) throw new Error("unknown entity in the series catalogue");

export function seriesDoc() {
  return {
    schema_version: "1.0",
    series: series.map((s) => {
      const row = {
        base_period: s.base ?? null,
        calendar_basis: "n/a",
        entity_id: s.ent,
        ...(s.flow === "absent" ? {} : {flow_basis: "n/a"}),
        frequency: s.freq,
        indicator_id: s.ind,
        inherited: false,
        licence_attribution: "Synthetic fixture data (Synthetic source)",
        price_basis: "n/a",
        publish: "public",
        published_precision: 1,
        reestimating: false,
        seasonal_adjustment: s.sa,
        series_id: s.series_id,
        series_key: `SYN.${s.ind}.${s.ent}.${s.freq}`,
        source_id: "S1",
        source_name: "Synthetic source",
        source_url: "https://example.org/synthetic",
        unit_code: s.unit,
        unit_mult: s.mult ?? 0
      };
      if (s.flow && s.flow !== "absent") row.flow_basis = s.flow;
      return row;
    })
  };
}

const COLUMNS = ["entity_id", "series_id", "ref_period_start", "ref_period_end", "frequency", "value", "value_default_tf", "value_yoy", "value_status", "known_at", "load_kind"];
const r1 = (x) => Math.round(x * 10) / 10;

// The stored points of one series: [{start, end, value|null, status}], never empty before the series' own end.
function points(s) {
  const grid = GRID[s.freq];
  const rand = rng(`${s.ind}|${s.ent}|${s.freq}`);
  const offset = (rng(`${s.ind}|${s.ent}`)() - 0.5) * (s.scale ?? 1); // fixed level offset per (indicator, entity)
  const end = s.end ?? LATEST[s.freq];
  const out = [];
  let drift = 0;
  for (let i = 0; i < grid.length; i++) {
    const p = grid[i];
    if (p.end > end) break;
    drift += (rand() - 0.5) * (s.scale ?? 1) * 0.15;
    const raw = (s.level ?? 0) + (s.trend ?? 0) * i + drift + offset + (rand() - 0.5) * (s.scale ?? 1) * 0.3;
    out.push({start: p.start, end: p.end, value: s.nodata ? null : r1(raw), status: s.nodata ? "MISS" : "OBS"});
  }
  for (const p of out) if (s.gaps?.includes(p.end)) { p.value = null; p.status = "MISS"; }
  const last = out.at(-1);
  if (last && last.value !== null) {
    if (s.est) last.status = "EST";
    else if (s.prov) last.status = "PROV";
  }
  return out;
}

export function seriesFiles() {
  const files = {};
  const byInd = new Map();
  for (const s of series) {
    const pts = points(s);
    const rows = byInd.get(s.ind) ?? [];
    pts.forEach((p, i) => {
      const yoy = s.yoy && p.value !== null && i >= 12 && pts[i - 12].value !== null ? r1(((p.value / pts[i - 12].value) - 1) * 100) : null;
      rows.push([s.ent, s.series_id, p.start, p.end, s.freq, p.value, p.value, yoy, p.status, FIXED.known_at, "initial"]);
    });
    byInd.set(s.ind, rows);
  }
  for (const [ind, rows] of byInd) files[`series/${ind}.json`] = `{"schema_version": "1.0", "indicator_id": ${JSON.stringify(ind)}, "columns": ${JSON.stringify(COLUMNS)}, "rows": [\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`; // one row per line
  return files;
}

// Scorecard cell from a series' last non-null stored point. Staleness and alignment come from the rules stated here (fixture generation
// only; the browser never derives them): stale = series end earlier than 2026 for M/Q or earlier than 2024 for A; unaligned = fiscal-year basis.
function cellOf(s, indicator, percentile, nRanked) {
  const pts = points(s).filter((p) => p.value !== null);
  const last = pts.at(-1);
  const stale = !!last && (s.end ?? LATEST[s.freq]) < ({M: "2026-01-01", Q: "2026-01-01", A: "2024-01-01"}[s.freq]);
  const latestRef = LATEST[s.freq];
  const alignment = !last ? "n/a" : indicator.rank_mode === "descriptive_only" ? "n/a" : s.nonaligned ? "unaligned" : last.end === latestRef || stale ? "aligned" : "lagging";
  return {
    age_days: stale ? 400 : 30,
    alert_confidence: "full",
    alert_level: "none",
    alignment,
    alignment_reason: s.nonaligned ? "fiscal_year_basis" : null,
    deviation: null,
    indicator_id: s.ind,
    inherited: false,
    is_stale: stale,
    known_at: FIXED.known_at,
    limit_source: "class",
    n_ranked: alignment === "aligned" && !stale && percentile !== null ? nRanked : null,
    percentile,
    percentile_label: "percentile vs all ranked countries",
    publish_scope: "ranked",
    published: true,
    rank_mode: indicator.rank_mode,
    ref_offset_days: last ? (s.nonaligned ? 150 : last.end === latestRef ? 0 : -92) : null,
    ref_period_end: last ? last.end : null,
    series_id: s.series_id,
    source_release_at: FIXED.known_at,
    stale_limit_days: 120,
    transform_id: "LEVEL",
    transformed_value: last ? last.value : null,
    value: last ? last.value : null,
    value_kind: last ? (last.status === "OBS" ? "observed" : "estimate") : "observed"
  };
}

export function scorecardFiles() {
  const out = {};
  for (const [domain_id, , indicator_ids, ranked] of DOMAINS) {
    const perEntity = new Map();
    const alignment = [];
    for (const id of indicator_ids) {
      const indicator = INDICATORS.find((i) => i.indicator_id === id);
      // Ranked set: countries with a value, aligned and not stale, for a ranked indicator. Percentile = stored fraction of that set below.
      const specs = series.filter((s) => s.ind === id && s.freq === indicator.frequency_set[0]);
      const cells = specs.map((s) => cellOf(s, indicator, null, null));
      const rankedCells = cells.filter((c, i) => ranked && indicator.rank_mode !== "descriptive_only" && c.value !== null && c.alignment === "aligned" && !c.is_stale && CAN_BE.has(specs[i].ent));
      const sorted = [...rankedCells].sort((a, b) => (indicator.good_dir >= 0 ? a.value - b.value : b.value - a.value) || a.series_id - b.series_id);
      sorted.forEach((c, i) => { c.percentile = rankedCells.length > 1 ? Math.round((i / (rankedCells.length - 1)) * 100) / 100 : null; c.n_ranked = rankedCells.length; });
      specs.forEach((s, i) => { const list = perEntity.get(s.ent) ?? []; list.push(cells[i]); perEntity.set(s.ent, list); });
      alignment.push({indicator_id: id, max_ref_spread_days: 92, n_ranked: rankedCells.length || null, n_unaligned: cells.filter((c) => c.alignment === "unaligned").length, rank_reference_period: rankedCells.length ? LATEST[indicator.frequency_set[0]] : null, reference_period_spread_days: rankedCells.length ? 31 : null});
    }
    const entities = [...perEntity.entries()].map(([entity_id, indicators]) => ({
      entity_id,
      low_coverage: false,
      n_available: indicators.filter((c) => c.value !== null).length,
      n_defined: indicators.length,
      n_ranked_entities: null,
      percentile_rank: null,
      percentile_rank_label: "mean percentile of the domain's indicators",
      rank_position: null,
      indicators
    }));
    out[`scorecard/${domain_id}.json`] = json({schema_version: "1.0", domain_id, analysis_run_id: 0, ranked, min_coverage_for_rank: 0.5, percentile_rank_label: "mean percentile of the domain's indicators", heterogeneous_peer_set: false, peer_set_size_by_indicator: {max: 0, min: 0}, alignment, entities});
  }
  return out;
}

export function allFiles() {
  const base = {
    "meta/entities.json": json(entitiesDoc()),
    "meta/groups.json": json(groupsDoc()),
    "meta/domains.json": json(domainsDoc()),
    "meta/indicators.json": json(indicatorsDoc()),
    "meta/series.json": json(seriesDoc()),
    "alerts.json": json({schema_version: "1.0", analysis_run_id: 0, alerts: []}),
    "revisions_recent.json": json({schema_version: "1.0", known_cutoff: FIXED.known_cutoff, edition_summaries: [], revisions: []}),
    "status.json": json({schema_version: "1.0", backlog: {n_unloaded: 0, oldest_age_days: null}, groups: [], last_run: {alerts_opened: 0, finished_at: FIXED.known_cutoff, ingest_run_id: 0, mode: "refresh", new_observations: 0, new_raw_objects: 0, revisions: 0, started_at: FIXED.known_cutoff}, manual_sources: [], schedule_check: {generated_at: FIXED.generated_at, text: "Synthetic fixture; no schedule."}, validation: {counts: [], cov01: [], open_drift: {by_kind: {}, n_open: 0}}}),
    ...scorecardFiles(),
    ...seriesFiles()
  };
  const paths = Object.keys(base).sort();
  const files = paths.map((path) => {
    const o = JSON.parse(base[path]);
    const rows = path.startsWith("series/") ? o.rows.length : path.startsWith("scorecard/") ? o.entities.length : o.entities?.length ?? o.groups?.length ?? o.domains?.length ?? o.indicators?.length ?? o.series?.length ?? null;
    return {bytes: Buffer.byteLength(base[path]), format: "json", path, rows, sha256: createHash("sha256").update(base[path]).digest("hex")};
  });
  const manifest = {analysis_run_id: 0, build_id: "synthetic-v2-fixture", code_version: "0.0.0", files, generated_at: FIXED.generated_at, history_start: "1995-01-01", ingest_run_id: 0, known_cutoff: FIXED.known_cutoff, schema_version: "1.0"};
  return {"manifest.json": json(manifest), ...base, "README.md": README};
}

const README = `# v2_export: SYNTHETIC fixture (dashboard v2 analytical plan, V7)

All values, series and dates are invented for tests. This is not a measurement and not a real export (plan gate G-REAL stays open);
nothing here is evidence about the real export. Generated by \`tests/support/make-v2-fixture.mjs\` (deterministic); do not edit by hand.
\`tests/fixtures.test.mjs\` fails if the files drift from the generator.

Shape: 42 countries (the dense variant, decisions O-1) plus aggregates EU27, EA, WLD (global). Groups: euro_area, g7, advanced, emerging,
non_euro_eu (no G20, no EU27 group, as in the real-export check of decisions D-9). \`series/<indicator>.json\` is JSON rows with the
Parquet column names (Parquet cannot be written without a new dependency); every series file shares \`columns\`.

Coverage (configured pattern of the coverage-42 plan): M09, M10, M11 28 countries; P01 19 euro-area countries plus EA; A01, A04, A05 42
countries (A04, A05 also EU27, EA, WLD); A02 25; Q08 27.

Cases (all synthetic):
- Two unit codes in one indicator: V01 (DEU, FRA PCT; ITA EUR_BN; POL PCT with unit_mult 3).
- SA and NSA mix: V02 (DEU, ITA SA; FRA, ESP NSA).
- Pairs: monthly M09 x M10 overlap on the same 28 countries (C3 pair); annual A04 x A05 on 42 (annual pair); frequency mismatch M09 (M) x A05 (A) or Q08 (Q).
- Index with base_period: P01 ("2015"), V03 (DEU, FRA, ESP "2015"; ITA "2010"), V05 ("2015"). No series carries scale_hint (CR-18 absent).
- flow_basis: present ("n/a") for some series and absent (key missing) for others in V04 (DEU, FRA present; ITA, ESP absent). Absent for all: delete the key in a test copy.
- EST: last row of every A04, A05 series and A02 ITA; PROV: M09 DEU. MISS gaps: M09 ESP (2025-03..05); M10 ITA has only MISS rows (series defined, no value).
- Stale scorecard rows (is_stale true): M09 FRA, ITA (series end 2025-12) and A04/A05 ROU, BGR (series end 2023). Lagging: M09 USA (end 2026-06).
  Unaligned (fiscal-year basis): A04/A05 TUR, CHN. Rows without a scorecard entry exist wherever no series exists (cells are only emitted where a series exists).
- More than one frequency in one indicator: V06 (frequency_set M and Q; DEU has both series, FRA monthly only, ITA quarterly only).
- Stored value_yoy: V05 DEU, FRA (null for ITA and for the first 12 months).
- Percentiles are stored values, assigned at generation to aligned, not-stale countries of ranked indicators.
`;

export function writeV2Fixture(dir = V2_DIR) {
  rmSync(dir, {recursive: true, force: true});
  for (const [p, t] of Object.entries(allFiles())) {
    mkdirSync(dirname(join(dir, p)), {recursive: true});
    writeFileSync(join(dir, p), t);
  }
}
export const readV2 = (p) => JSON.parse(readFileSync(join(V2_DIR, p), "utf8"));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) writeV2Fixture();
