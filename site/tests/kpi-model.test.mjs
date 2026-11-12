// L14: KPI tile model and view (layout amendment 4.6, AC-DB-20, AC-DB-21, AC-RD-12), offline.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_CHOOSE_COUNTRY_PLACEHOLDER, DRAFT_EMPTY_CARD, G_STR1_NO_SERIES, DRAFT_NA_DEFINED_SENTENCE} from "../src/lib/copy.js";
import {kpiModel, MAX_INDICATOR_TILES_RANKED, MAX_TILES, tileIndicatorIds} from "../src/lib/kpi-model.js";
import {domainFigureCard, indicatorTileCard, kpiNodes} from "../src/lib/kpi-view.js";
import {html} from "./support/html-standin.mjs";
import {applyAllowList, computeHits} from "./support/static-scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..", "src", "lib");

const ids = Array.from({length: 11}, (_, k) => `X${String(k + 1).padStart(2, "0")}`);
const domain = {domain_id: "growth", name: "Growth", ranked: true, indicator_ids: ids, percentile_rank_label: "mean percentile of the domain's indicators"};
const indicators = ids.map((id, k) => ({indicator_id: id, name: `Indicator ${id}`, unit_label: "%", frequency_set: k % 2 === 0 ? ["M"] : ["Q", "A"], domain_ids: ["growth"]}));
const entities = [
  {entity_id: "DEU", name: "Germany", kind: "country"},
  {entity_id: "EA", name: "Euro area", kind: "aggregate"},
  {entity_id: "FRA", name: "France", kind: "country"}
];
const cell = (id, extra = {}) => ({indicator_id: id, value: 3.1, percentile: 0.9, ref_period_end: "2025-12-31", ref_offset_days: 0, published: true, publish_scope: "ranked", rank_mode: "monotone_good", value_kind: "observed", ...extra});
const scorecard = {
  domain_id: "growth", ranked: true,
  entities: [
    {entity_id: "DEU", percentile_rank: 0.77, percentile_rank_label: "mean percentile of the domain's indicators", n_available: 9, n_defined: 11, rank_position: 3, n_ranked_entities: 6, low_coverage: false, indicators: ids.map((id) => cell(id))},
    {entity_id: "EA", percentile_rank: null, n_available: 0, n_defined: 11, indicators: ids.map((id) => cell(id, {percentile: null}))}
  ]
};
const series = ids.flatMap((id) => [{indicator_id: id, entity_id: "DEU", frequency: "M"}]);

test("placeholder unless exactly one known entity is in focus", () => {
  for (const focusIds of [[], ["DEU", "FRA"], ["ZZZ"]]) {
    const m = kpiModel({focusIds, entities, indicators, domain, scorecard, series});
    assert.deepEqual(m, {kind: "placeholder", text: DRAFT_CHOOSE_COUNTRY_PLACEHOLDER});
  }
  assert.equal(kpiModel({focusIds: ["DEU"], entities, indicators, domain, scorecard, series}).kind, "tiles");
});

test("selection: pinned indicator first (even outside the Domain), then indicator_ids order, at most 8 tiles with the figure tile, priority ignored", () => {
  const open = {...domain, ranked: false};
  assert.equal(MAX_INDICATOR_TILES_RANKED + 1, MAX_TILES);
  assert.deepEqual(tileIndicatorIds({domain: open, indicators}), ids.slice(0, MAX_TILES), "unranked: no figure tile, 8 indicator tiles");
  assert.deepEqual(tileIndicatorIds({domain, indicators}), ids.slice(0, MAX_TILES - 1), "ranked: the figure tile is one of the 8");
  assert.deepEqual(tileIndicatorIds({domain, indicators, pinnedId: "X10"}), ["X10", ...ids.filter((i) => i !== "X10").slice(0, MAX_TILES - 2)]);
  assert.equal(tileIndicatorIds({domain, indicators, pinnedId: "X10"}).length, MAX_TILES - 1);
  const outside = [...indicators, {indicator_id: "ZZ9", name: "Elsewhere", domain_ids: ["other"], frequency_set: ["M"]}];
  assert.deepEqual(tileIndicatorIds({domain, indicators: outside, pinnedId: "ZZ9"}), ["ZZ9", ...ids.slice(0, MAX_TILES - 2)], "a known pinned indicator outside the Domain comes first");
  assert.deepEqual(tileIndicatorIds({domain, indicators, pinnedId: "UNKNOWN"}), ids.slice(0, MAX_TILES - 1), "an unknown pinned id is not added");
  const withPriority = indicators.map((i, k) => ({...i, priority: k % 3 === 0 ? "dropped" : "core"}));
  assert.deepEqual(tileIndicatorIds({domain, indicators: withPriority}), tileIndicatorIds({domain, indicators}), "priority has no effect");
  const q = tileIndicatorIds({domain, indicators, frequency: "Q"});
  assert.deepEqual(q, ids.filter((_, k) => k % 2 === 1), "Frequency keeps indicators whose frequency_set holds it");
  assert.deepEqual(tileIndicatorIds({domain, indicators, frequency: "D"}), []);
  assert.deepEqual(tileIndicatorIds({domain: null, indicators}), []);
});

test("tile fields equal the stored scorecard row (value, unit, period, offset, percentile, bin, estimate, inherited)", () => {
  const sc = {...scorecard, entities: [{...scorecard.entities[0], indicators: [cell("X01", {value: 12.3456789012, percentile: 0.15, ref_offset_days: 45, value_kind: "estimate"}), cell("X02", {inherited: true, percentile: null})]}]};
  const dom = {...domain, indicator_ids: ["X01", "X02"]};
  const m = kpiModel({focusIds: ["DEU"], entities, indicators, domain: dom, scorecard: sc, series});
  const [a, b] = m.tiles;
  assert.equal(a.valueText, "12.34568");
  assert.equal(a.unit, "%");
  assert.equal(a.periodText, "2025-12");
  assert.equal(a.offsetFlag, true);
  assert.equal(a.refOffsetDays, 45);
  assert.equal(a.percentileText, "0.15");
  assert.equal(a.bin, 1);
  assert.equal(a.estimate, true);
  assert.equal(a.state.key, "ranked");
  assert.equal(b.inherited, true);
  assert.equal(b.state.key, "inherited");
  assert.equal(a.href, "./indicator/X01");
  assert.equal(a.seriesHref, "./explorer#i=X01&c=DEU");
});

test("a row without a value shows its state code and sentence, never a number; the two na sentences follow the series lookup", () => {
  const sc = {...scorecard, entities: [{...scorecard.entities[0], indicators: [cell("X01", {value: null, percentile: null}), cell("X03", {value: null, percentile: null}), cell("X02", {published: false})]}]};
  const dom = {...domain, indicator_ids: ["X01", "X03", "X02", "X04"]};
  const m = kpiModel({focusIds: ["DEU"], entities, indicators, domain: dom, scorecard: sc, series: [{indicator_id: "X01", entity_id: "DEU", frequency: "M"}]});
  const [defined, undefinedSeries, notPublished, absent] = m.tiles;
  for (const t of m.tiles) {
    assert.equal(t.hasValue, false);
    assert.equal(t.valueText, null);
    assert.equal(t.percentileText, null);
  }
  assert.equal(defined.state.sentence, DRAFT_NA_DEFINED_SENTENCE);
  assert.equal(undefinedSeries.state.sentence, G_STR1_NO_SERIES);
  assert.equal(notPublished.state.key, "not_published");
  assert.equal(absent.state.key, "na", "an indicator with no row in the scorecard is a state tile, not dropped");
  const card = String(indicatorTileCard(html, defined));
  assert.ok(card.includes(DRAFT_NA_DEFINED_SENTENCE) && !card.includes("mm-tile-number"), "the state replaces the number");
});

test("domain-figure tile: ranked domains only; stored label, rank, coverage and position; low coverage drops the position; aggregate and unranked wording", () => {
  const m = kpiModel({focusIds: ["DEU"], entities, indicators, domain, scorecard, series});
  assert.equal(m.figure.percentileText, "0.77");
  assert.equal(m.figure.label, "mean percentile of the domain's indicators");
  assert.equal(m.figure.coverageText, "9 of 11 indicators available");
  assert.equal(m.figure.positionText, "position 3 of 6");
  const card = String(domainFigureCard(html, m.figure));
  assert.ok(card.includes("0.77") && card.includes("9 of 11 indicators available") && card.includes("position 3 of 6"));
  assert.ok(!card.includes("%"), "no percent sign");
  const low = kpiModel({focusIds: ["DEU"], entities, indicators, domain, scorecard: {...scorecard, entities: [{...scorecard.entities[0], low_coverage: true}]}, series});
  assert.equal(low.figure.lowCoverage, true);
  assert.ok(!String(domainFigureCard(html, low.figure)).includes("position 3"), "low coverage shows no position");
  assert.ok(String(domainFigureCard(html, low.figure)).includes("no position (low coverage)"));
  const ea = kpiModel({focusIds: ["EA"], entities, indicators, domain, scorecard, series});
  assert.equal(ea.figure.state.key, "aggregate");
  assert.ok(String(domainFigureCard(html, ea.figure)).includes("aggregate (not ranked)"));
  const unranked = kpiModel({focusIds: ["DEU"], entities, indicators, domain: {...domain, ranked: false}, scorecard: {...scorecard, ranked: false}, series});
  assert.equal(unranked.figure, null, "an unranked domain has no figure tile and no percentile_rank");
  assert.ok(!String(kpiNodes(html, unranked).nodes.join("")).includes("data-tile=\"domain-figure\""));
});

test("empty: no row for the entity in the scorecard, or no tile id after Frequency", () => {
  assert.deepEqual(kpiModel({focusIds: ["FRA"], entities, indicators, domain, scorecard, series}), {kind: "empty", text: DRAFT_EMPTY_CARD});
  assert.equal(kpiModel({focusIds: ["DEU"], entities, indicators, domain, scorecard, series, frequency: "D"}).kind, "empty");
});

test("view: title links carry the hash, the Time series link has i and c, no delta, arrow or count appears in the markup", () => {
  const m = kpiModel({focusIds: ["DEU"], entities, indicators, domain, scorecard, series});
  const out = kpiNodes(html, m);
  assert.equal(out.kind, "tiles");
  assert.equal(out.nodes.length, MAX_TILES, "the figure tile and the indicator tiles are 8 in all");
  const markup = out.nodes.map(String).join("");
  assert.equal([...markup.matchAll(/data-tile="indicator"/g)].length, MAX_INDICATOR_TILES_RANKED);
  assert.equal([...markup.matchAll(/data-carry/g)].length, MAX_INDICATOR_TILES_RANKED, "indicator name links opt in to carry");
  assert.ok(markup.includes('href="./explorer#i=X01&amp;c=DEU"'));
  assert.ok(markup.includes('data-bin="5"'));
  assert.ok(!/[↑↓▲▼↗↘]|delta|change/i.test(markup), "no delta or arrow");
  assert.ok(!markup.includes("%</span>") || markup.includes('class="mm-unit">%'), "the percent sign appears only as a stored unit");
  const ph = kpiNodes(html, kpiModel({focusIds: [], entities, indicators, domain, scorecard}));
  assert.equal(ph.kind, "placeholder");
  assert.ok(String(ph.nodes[0]).includes(DRAFT_CHOOSE_COUNTRY_PLACEHOLDER));
});

// Static scan (AC-DB-20, AC-RD-50): the KPI modules compute nothing and have no change/delta/arrow/rank/total/mean/count helper.
const MODULES = ["kpi-model.js", "kpi-view.js"];
const FORBIDDEN_NAME = /\b(?:delta|arrow|change|diff|total|sum|mean|average|count|rank(?:ing)?)\b/i;

test("scan: kpi-model.js and kpi-view.js have no compute hit and no change, delta, arrow, total, mean, count or rank helper name", () => {
  for (const m of MODULES) {
    const src = readFileSync(join(lib, m), "utf8");
    assert.deepEqual(applyAllowList({[m]: computeHits(src)}, []).violations, [], `${m} computes something`);
    const idents = [...src.replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "").matchAll(/\b(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)].map((x) => x[1]);
    assert.deepEqual(idents.filter((n) => FORBIDDEN_NAME.test(n)), [], `${m} declares a forbidden helper name`);
    assert.ok(!/[↑↓▲▼↗↘]/.test(src), `${m} has an arrow character`);
    assert.ok(!/\bpriority\b/.test(src.replace(/\/\/.*$/gm, "")), `${m} reads priority`);
  }
});

test("scan: a seeded delta helper, a division and an arrow are caught", () => {
  const bad = "export const delta = (a, b) => (a - b) / b; // ↑";
  assert.ok(computeHits(bad).length > 0);
  assert.ok(FORBIDDEN_NAME.test("delta"));
  assert.ok(/[↑↓]/.test(bad));
});

test("value uses the stored published_precision hint when present (display only)", () => {
  const withPrecision = series.map((s) => ({...s, published_precision: 1}));
  const m = kpiModel({focusIds: ["DEU"], entities, indicators, domain, scorecard: {...scorecard, entities: [{...scorecard.entities[0], indicators: ids.map((id) => cell(id, {value: 12.3456789}))}, scorecard.entities[1]]}, series: withPrecision});
  assert.equal(m.tiles[0].valueText, "12.3");
});
