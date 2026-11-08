// Redesign R8: "Show history" (AC-RD-14, markup and logic level; the fetch and failure behaviour are in tests/smoke/country-history.smoke.mjs).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {countryPageSource} from "../scripts/lib.mjs";
import {countryModel} from "../src/lib/country-model.js";
import {countryBlock, switcherOptions} from "../src/lib/country-view.js";
import {hasHistory, historyBlock, historyChart, historyModel, historyPoints, historySource} from "../src/lib/history.js";
import {html} from "./support/html-standin.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sparse_export");
const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const entities = load("meta/entities.json").entities;
const indicators = load("meta/indicators.json").indicators;
const series = load("meta/series.json").series;
const domains = load("meta/domains.json").domains;
const scorecards = Object.fromEntries(domains.map((d) => [d.domain_id, load(`scorecard/${d.domain_id}.json`)]));
const m = countryModel({entity: entities.find((e) => e.entity_id === "SY01"), domains, scorecards, indicators, series, groups: []});
const row = m.domains.find((d) => d.domainId === "growth").rows.find((r) => r.indicatorId === "T01");
const manifest = {files: [{path: "series/T01.parquet", format: "parquet", bytes: 100, rows: 3}, {path: "meta/series.json", format: "json", bytes: 5}]};
const files = {T01: {parquet: () => assert.fail("never read in a unit test")}};
const fakePlot = {plot: (o) => ({opts: o, toString: () => "<svg></svg>"}), line: (d, o) => ({type: "line", d, o}), dot: (d, o) => ({type: "dot", d, o}), rectX: () => ({}), ruleX: () => ({})};

const D = (s) => Date.parse(`${s}T00:00:00Z`);
const rows = [
  {entity: "SY01", seriesId: 1, end: D("2025-02-28"), value: 2, status: "OBS"},
  {entity: "SY02", seriesId: 2, end: D("2025-01-31"), value: 9, status: "OBS"},
  {entity: "SY01", seriesId: 1, end: D("2025-01-31"), value: 1, status: "EST"},
  {entity: "SY01", seriesId: 1, end: D("2025-03-31"), value: null, status: "MISS"}
];

test("the button exists only for an indicator whose series file is in the manifest and registered", () => {
  const src = historySource(manifest, files);
  assert.equal(hasHistory(src, "T01"), true);
  assert.equal(hasHistory(src, "T02"), false);
  assert.equal(hasHistory(historySource(manifest, {}), "T01"), false);
  assert.equal(hasHistory(null, "T01"), false);
});

test("country page: button collapsed, panel hidden and empty before activation; no button without a source", () => {
  const out = String(countryBlock(html, fakePlot, m, switcherOptions(entities), historySource(manifest, files)));
  assert.equal(out.match(/<button type="button" class="mm-history-btn"/g).length, 2, "only T01 has a series file, listed in growth and fin");
  assert.ok(out.includes('data-history="growth-T01" aria-expanded="false" aria-controls="history-growth-T01"'));
  assert.ok(out.includes('<div class="mm-history" id="history-growth-T01" data-state="idle" hidden></div>'));
  assert.ok(!String(countryBlock(html, fakePlot, m, switcherOptions(entities))).includes("mm-history-btn"));
});

test("points: this entity only, by date, the row's series; nulls stay as gaps", () => {
  const p = historyPoints(rows, "SY01", 1);
  assert.deepEqual(p.map((x) => x.value), [1, 2, null]);
  assert.deepEqual(historyPoints(rows, "SY01", 99).map((x) => x.value), [1, 2, null], "an unknown series id falls back to the entity");
  assert.equal(historyPoints(rows, "SY03").length, 0);
});

test("model and chart: unit on the axis, one entity, every point text carries the unit", () => {
  const mod = historyModel({rows, row, entityId: "SY01", entityName: "Synthetic SY01"});
  assert.equal(mod.unit, "SYNTH_UNIT");
  assert.deepEqual(mod.points.map((p) => p.text), ["1 SYNTH_UNIT", "2 SYNTH_UNIT", null]);
  const chart = historyChart(fakePlot, mod);
  assert.equal(chart.opts.y.label, "SYNTH_UNIT");
  const line = chart.opts.marks[0];
  assert.equal(line.type, "line");
  assert.ok(line.d.every((p) => p.date instanceof Date));
  const out = String(historyBlock(html, fakePlot, mod, "history-growth-T01"));
  assert.ok(out.includes('role="img"') && out.includes("in SYNTH_UNIT"));
  assert.ok(out.includes("<td class=\"mm-num\">2 SYNTH_UNIT</td>"), "table values carry the unit");
  assert.ok(!out.includes("SY02"));
});

test("no values for this entity: the n/a code with its sentence, no chart", () => {
  const mod = historyModel({rows, row, entityId: "SY03", entityName: "x"});
  const out = String(historyBlock(html, fakePlot, mod, "h"));
  assert.ok(out.includes("mm-sentence") && !out.includes("<figure"));
});

test("history.js imports no network or reader of its own and computes nothing", () => {
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "history.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|import\(|parquet-wasm|apache-arrow/);
  assert.doesNotMatch(code, /\b(reduce|Math\.)|\.length\s*[-+*/]|\+\+/);
});

test("generated page: one lazy FileAttachment per manifest series file, no reader call or fetch in the page, no <nav>", () => {
  const src = countryPageSource({entity_id: "SY01", name: "x", kind: "country", group_ids: []}, [], ["growth"], manifest);
  assert.ok(src.includes('const seriesFiles = {"T01": FileAttachment("../data/series/T01.parquet")};'));
  assert.ok(src.includes("historySource(boot.data.manifest, seriesFiles)"));
  assert.doesNotMatch(src, /\.parquet\(\)|fetch\(|<nav[\s>]/);
  assert.ok(countryPageSource({entity_id: "SY01", name: "x"}, [], ["growth"]).includes("const seriesFiles = {};"));
  assert.throws(() => countryPageSource({entity_id: "SY01", name: "x"}, [], [], {files: [{path: "series/../x.parquet"}]}));
});
