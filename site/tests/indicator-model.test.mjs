// Redesign R9: indicator row model and generated page on the SYNTHETIC sparse fixture (spec 4.3, C-IND-2, C-IND-5, AC-RD-20, 21, 24, 25).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {firstDomainId, indicatorHeader, indicatorModel, storedPercentileDifferences, storedTransformId, transformLabel} from "../src/lib/indicator-model.js";
import {indicatorPageSource} from "../scripts/lib.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dir = join(root, "fixtures", "sparse_export");
const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const entities = load("meta/entities.json").entities;
const indicators = load("meta/indicators.json").indicators;
const series = load("meta/series.json").series;
const domains = load("meta/domains.json").domains;
const scorecards = Object.fromEntries(domains.map((d) => [d.domain_id, load(`scorecard/${d.domain_id}.json`)]));
const ind = (id) => indicators.find((i) => i.indicator_id === id);
const build = (id, extra = {}) => indicatorModel({indicator: {...ind(id), ...extra}, domains, scorecards, entities, series});

test("one row per entity of the first domain's scorecard, none dropped (AC-RD-20)", () => {
  const m = build("T02");
  assert.equal(m.domainId, "growth");
  assert.deepEqual([...m.rows.map((r) => r.entityId)].sort(), scorecards.growth.entities.map((e) => e.entity_id).sort());
  assert.equal(m.rows.length, scorecards.growth.entities.length);
  assert.equal(m.rows.length, m.withValue.length + m.withoutValue.length);
  assert.ok(m.rows.some((r) => r.kind === "aggregate"), "aggregates are rows too");
});

test("rows with a value first, then without; each group Country A-Z; reason sentence for rows without (AC-RD-20)", () => {
  const m = build("T04");
  const seen = m.rows.map((r) => r.hasValue);
  assert.deepEqual(seen, [...seen].sort((a, b) => Number(b) - Number(a)));
  for (const g of [m.withValue, m.withoutValue]) {
    const names = g.map((r) => r.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en")));
  }
  const defined = m.rows.find((r) => r.entityId === "SY07");
  assert.equal(defined.hasValue, false);
  assert.equal(defined.state.key, "na");
  assert.ok(defined.state.sentence);
  const undef = m.rows.find((r) => r.entityId === "SY08");
  if (undef) assert.ok(undef.state.sentence);
});

test("stored cells: states, estimate, inherited, percentile and bin as stored; nothing computed", () => {
  const m = build("T02");
  const by = (id) => m.rows.find((r) => r.entityId === id);
  assert.equal(by("SY01").estimate, true);
  assert.equal(by("SY02").inherited, true);
  assert.equal(by("SY03").state.key, "stale");
  assert.equal(by("SY04").state.key, "lagging");
  assert.equal(by("SY05").state.key, "unaligned");
  assert.equal(by("SY06").state.key, "ahead");
  assert.equal(by("SY09").state.key, "not_published");
  assert.equal(by("SY09").hasValue, false);
  const cell = scorecards.growth.entities.find((e) => e.entity_id === "SY01").indicators.find((c) => c.indicator_id === "T02");
  assert.equal(by("SY01").value, cell.value);
  assert.equal(by("SY01").percentile, cell.percentile ?? null);
});

test("two-domain indicator T01 reads the first domain and both scorecards store equal percentiles (AC-RD-24)", () => {
  assert.deepEqual(ind("T01").domain_ids, ["growth", "fin"]);
  assert.equal(firstDomainId(ind("T01")), "growth");
  assert.equal(build("T01").domainId, "growth");
  assert.deepEqual(storedPercentileDifferences(ind("T01"), scorecards), []);
  assert.deepEqual(storedPercentileDifferences(ind("T02"), scorecards), []);
});

test("seeded negative: a differing percentile in the second domain is reported (AC-RD-24)", () => {
  const bad = structuredClone(scorecards);
  const e = bad.fin.entities.find((x) => (x.indicators ?? []).some((c) => c.indicator_id === "T01" && typeof c.percentile === "number"));
  assert.ok(e, "fixture has a percentile of T01 in fin");
  e.indicators.find((c) => c.indicator_id === "T01").percentile = 0.01;
  const out = storedPercentileDifferences(ind("T01"), bad);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].domains, ["growth", "fin"]);
  assert.throws(() => firstDomainId({indicator_id: "X", domain_ids: []}));
  assert.throws(() => indicatorModel({indicator: ind("T01"), domains, scorecards: {}, entities, series}));
});

test("header: name, id, domains, unit, frequency, direction, notes verbatim (AC-RD-25 header part)", () => {
  const h = indicatorHeader({indicator_id: "M18", name: "Cost <x>", domain_ids: ["growth", "fin"], unit_label: "% y/y", frequency_set: ["M", "Q"], rank_mode: "monotone_good", good_dir: -1, notes: ["Euro area only & note"], default_transform: "YOY"}, domains);
  assert.equal(h.name, "Cost <x>");
  assert.deepEqual(h.domains.map((d) => d.id), ["growth", "fin"]);
  assert.equal(h.domains[0].name, domains.find((d) => d.domain_id === "growth").name);
  assert.equal(h.unit, "% y/y");
  assert.deepEqual(h.frequencies, ["M", "Q"]);
  assert.equal(h.directionText, "lower is better");
  assert.deepEqual(h.notes, ["Euro area only & note"]);
  assert.equal(h.transformLabel, "YOY");
});

test("transform label: from a labelled transform_options entry, else the stored transform_id", () => {
  assert.equal(transformLabel({transform_options: ["LEVEL", "YOY"]}, "YOY"), "YOY");
  assert.equal(transformLabel({transform_options: [{id: "YOY", label: "Year-on-year"}]}, "YOY"), "Year-on-year");
  assert.equal(transformLabel({transform_options: [{id: "YOY"}]}, "YOY"), "YOY");
  assert.equal(transformLabel({}, "MOM"), "MOM");
  assert.equal(transformLabel({}, null), null);
  assert.equal(storedTransformId({entities: [{indicators: [{indicator_id: "A", transform_id: "YOY"}]}]}, "A"), "YOY");
  assert.equal(storedTransformId({entities: []}, "A"), null);
});

test("transformed value only for a non-level transform, as a number with its label and no unit (CR-6)", () => {
  const sc = structuredClone(scorecards);
  const cells = sc.growth.entities.map((e) => e.indicators.find((c) => c.indicator_id === "T02")).filter((c) => c && c.value !== null);
  assert.ok(cells.length >= 2);
  cells[0].transform_id = "YOY";
  cells[0].transformed_value = 1.5;
  const m = indicatorModel({indicator: ind("T02"), domains, scorecards: sc, entities, series});
  const withT = m.rows.filter((r) => r.transformedValue !== null);
  assert.equal(withT.length, 1);
  assert.equal(withT[0].transformedValue, 1.5);
  assert.equal(withT[0].transformLabel, "YOY");
  assert.equal(m.header.transformLabel, "YOY");
  assert.ok(!("transformedUnit" in withT[0]));
  assert.ok(build("T02").rows.every((r) => r.transformedValue === null), "level transform shows none");
});

test("reference-period line fields are the stored alignment entry; unranked when both null (C-IND-2)", () => {
  // The sparse fixture holds no alignment[] entries; synthesize the stored entry shape.
  const sc = structuredClone(scorecards);
  sc.growth.alignment = [{indicator_id: "T02", max_ref_spread_days: 92, n_ranked: 3, n_unaligned: 1, rank_reference_period: "2025-12-31", reference_period_spread_days: 31}, {indicator_id: "T03", max_ref_spread_days: 92, n_ranked: null, n_unaligned: 0, rank_reference_period: null, reference_period_spread_days: null}];
  const m = indicatorModel({indicator: ind("T02"), domains, scorecards: sc, entities, series});
  assert.equal(m.referenceLine.spreadDays, 31);
  assert.equal(m.referenceLine.commonPeriod, "2025-12-31");
  assert.equal(m.referenceLine.ranked, true);
  assert.equal(m.referenceLine.nUnaligned, 1);
  assert.equal(indicatorModel({indicator: ind("T03"), domains, scorecards: sc, entities, series}).referenceLine.ranked, false);
  const un =indicatorModel({indicator: ind("T05"), domains, scorecards, entities, series});
  assert.equal(un.domainRanked, false);
  const none = structuredClone(scorecards);
  none.growth.alignment = [];
  assert.equal(indicatorModel({indicator: ind("T02"), domains, scorecards: none, entities, series}).referenceLine.ranked, false);
});

test("showsPercentiles drives the orientation line; the global entity has no country page", () => {
  assert.equal(build("T02").showsPercentiles, true);
  assert.equal(build("T05").showsPercentiles, false);
  const g = indicatorModel({indicator: {indicator_id: "G1", name: "G", domain_ids: ["global"], unit_label: "u"}, domains: [...domains, {domain_id: "global", name: "Global", ranked: false}], scorecards: {global: {domain_id: "global", entities: [{entity_id: "WLD", indicators: []}]}}, entities: [{entity_id: "WLD", name: "World", is_global: true}], series: []});
  assert.equal(g.rows[0].hasCountryPage, false);
});

test("generated page: one h1 = name, one shell nav only, breadcrumb, first-domain scorecard only, caveat before orientation", () => {
  const src = indicatorPageSource({...ind("T01"), notes: ["A & <B>"], name: "N & <M>"}, domains, "LEVEL");
  assert.equal(src.match(/<h1\b/g).length, 1);
  assert.ok(src.includes('<h1 data-indicator="T01">N &amp; &lt;M&gt;</h1>'));
  assert.ok(src.indexOf("mm-crumb") < src.indexOf("<h1"));
  assert.ok(!/<nav[\s>]/.test(src), "indicator page adds no second <nav>");
  assert.ok(src.includes('FileAttachment("../data/scorecard/growth.json")'));
  assert.ok(!src.includes('scorecard/fin.json'), "only the first domain's scorecard");
  assert.ok(src.includes("<li>A &amp; &lt;B&gt;</li>"));
  assert.ok(src.includes('href="../domain/growth"') && src.includes('href="../domain/fin"'));
  assert.ok(src.includes("<dd>LEVEL</dd>") && src.includes("<dd>SYNTH_UNIT</dd>"));
  assert.ok(src.indexOf("mm-caveat") < src.indexOf("mm-orientation"));
  assert.ok(src.includes("model.showsPercentiles"));
  assert.throws(() => indicatorPageSource({indicator_id: "../x", domain_ids: ["growth"]}, domains));
  assert.throws(() => indicatorPageSource({indicator_id: "X1", domain_ids: ["a/b"]}, domains));
  assert.throws(() => indicatorPageSource({indicator_id: "X1", domain_ids: []}, domains));
});

test("model source computes nothing: no mean, sum, rank derivation or count", () => {
  const code = readFileSync(join(root, "..", "src", "lib", "indicator-model.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\b(reduce|Math\.(min|max|round|floor)|sort\()|\.length\s*[-+*/]|\+\+/);
});

test("exports on disk: every indicator of meta/indicators.json builds (CI fixture in src/data when present)", () => {
  const p = join(root, "..", "src", "data", "meta", "indicators.json");
  let list;
  try {
    list = JSON.parse(readFileSync(p, "utf8")).indicators;
  } catch {
    return;
  }
  const d = JSON.parse(readFileSync(join(root, "..", "src", "data", "meta", "domains.json"), "utf8")).domains;
  const ents = JSON.parse(readFileSync(join(root, "..", "src", "data", "meta", "entities.json"), "utf8")).entities;
  const ser = JSON.parse(readFileSync(join(root, "..", "src", "data", "meta", "series.json"), "utf8")).series;
  const scs = Object.fromEntries(d.map((x) => [x.domain_id, JSON.parse(readFileSync(join(root, "..", "src", "data", "scorecard", `${x.domain_id}.json`), "utf8"))]));
  for (const i of list) {
    const m = indicatorModel({indicator: i, domains: d, scorecards: scs, entities: ents, series: ser});
    assert.equal(m.rows.length, scs[firstDomainId(i)].entities.length, i.indicator_id);
    assert.deepEqual(storedPercentileDifferences(i, scs), [], i.indicator_id);
  }
});

test("hasCountryPage is false for an entity absent from meta/entities.json, true for a listed non-global one", () => {
  const sc = {growth: {domain_id: "growth", entities: [{entity_id: "ZZ99", indicators: []}, {entity_id: "SY01", indicators: []}]}};
  const m = indicatorModel({indicator: ind("T01"), domains, scorecards: sc, entities: [{entity_id: "SY01", name: "Syn"}], series});
  assert.equal(m.rows.find((r) => r.entityId === "ZZ99").hasCountryPage, false);
  assert.equal(m.rows.find((r) => r.entityId === "SY01").hasCountryPage, true);
});

test("download link (C-IND-7): only a .parquet path is ever used, even when the manifest also lists a .json", () => {
  const both = {files: [{path: "series/T01.json"}, {path: "series/T01.parquet"}]};
  const src = indicatorPageSource(ind("T01"), domains, "LEVEL", both);
  assert.ok(src.includes('FileAttachment("../data/series/T01.parquet")'));
  assert.ok(!src.includes("series/T01.json"));
  const jsonOnly = indicatorPageSource(ind("T01"), domains, "LEVEL", {files: [{path: "series/T01.json"}]});
  assert.ok(jsonOnly.includes("const seriesFile = null;") && !jsonOnly.includes("series/T01.json"));
});
