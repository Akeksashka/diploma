// L12 (AC-DB-22, AC-DB-23, AC-DB-36, AC-DB-03 card part, AC-RD-22, 45, 54): the ranked comparison card model and view, offline.
// Models are built from the synthetic 44-entity sparse export and from small tables; the view runs on the htl stand-in with a recording Plot.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_EMPTY_CARD, DRAFT_GROUP_REFERENCE_ROWS, DRAFT_HIDDEN_ROW_ITEM, DRAFT_HIDDEN_ROWS} from "../src/lib/copy.js";
import {factRows} from "../src/lib/facts-card.js";
import {axisDomain, buildComparison, hasSingleUnit, RANK_SORT_OPTIONS} from "../src/lib/rank-model.js";
import {barPlot, hiddenRowsBlock, comparisonTable, tableAlternative} from "../src/lib/rank-view.js";
import {indicatorHeader} from "../src/lib/indicator-model.js";
import {html, Raw} from "./support/html-standin.mjs";
import {computeHits, stripNoise} from "./support/static-scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (rel) => JSON.parse(readFileSync(join(here, "fixtures", "sparse_export", rel), "utf8"));
const entities = fx("meta/entities.json").entities;
const indicators = fx("meta/indicators.json").indicators;
const domains = fx("meta/domains.json").domains;
const groups = fx("meta/groups.json").groups;
const series = fx("meta/series.json").series;
const growth = fx("scorecard/growth.json");
const T02 = indicators.find((i) => i.indicator_id === "T02");
const ids = (rows) => rows.map((r) => r.entityId);
const base = {indicator: T02, domainId: "growth", domains, scorecard: growth, entities, groups, series};

test("AC-DB-22: one row per entity of the comparison set, none dropped; aggregates only in the Reference rows group", () => {
  const m = buildComparison(base);
  const countries = entities.filter((e) => e.kind === "country" && !e.is_global).map((e) => e.entity_id);
  const aggregates = entities.filter((e) => e.kind === "aggregate" && !e.is_global).map((e) => e.entity_id);
  assert.deepEqual([...ids(m.countries)].sort(), [...countries].sort());
  assert.deepEqual([...ids(m.references)].sort(), [...aggregates].sort());
  assert.ok(!ids(m.countries).some((id) => aggregates.includes(id)));
  assert.equal(m.hasReferences, true);
  assert.equal(m.empty, false);
  assert.equal(m.hiddenSentence, "");
  assert.deepEqual(m.hiddenRows, []);
});

test("AC-DB-22: rows without a value come last in their group with a state code and sentence; the value rows keep stored order by the sort", () => {
  for (const sort of ["name", "value", "percentile"]) {
    const m = buildComparison({...base, sort});
    for (const group of [m.countries, m.references]) {
      const flags = group.map((r) => r.hasValue);
      assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)), `${sort}: value rows first, then rows without a value`);
      for (const r of group.filter((x) => !x.hasValue)) assert.ok(r.state.code !== undefined && r.state.sentence, `${r.entityId} shows a state code and sentence`);
    }
  }
  const byValue = buildComparison({...base, sort: "value"}).countries.filter((r) => r.hasValue).map((r) => r.value);
  assert.deepEqual(byValue, [...byValue].sort((a, b) => b - a));
  const byName = buildComparison({...base, sort: "name"}).countries.filter((r) => r.hasValue).map((r) => r.name);
  assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b, "en")));
  const byPct = buildComparison({...base, sort: "percentile"}).countries.filter((r) => r.percentile !== null).map((r) => r.percentile);
  assert.deepEqual(byPct, [...byPct].sort((a, b) => b - a));
  assert.deepEqual(RANK_SORT_OPTIONS.map((o) => o.id), ["name", "value", "percentile"]);
  assert.equal(buildComparison({...base, sort: "nope"}).sortId, "name");
});

test("AC-DB-03 card part: Group narrows the countries, the references stay; a focus country outside the Group is the outlined in-focus row", () => {
  const g = [{group_id: "g", members: [{entity_id: "SY01", valid_to: null}, {entity_id: "SY02", valid_to: null}]}];
  const m = buildComparison({...base, groups: g, state: {g: "g", c: ["SY05"]}});
  assert.deepEqual(ids(m.countries).sort(), ["SY01", "SY02", "SY05"]);
  assert.deepEqual(m.countries.filter((r) => r.inFocus).map((r) => r.entityId), ["SY05"]);
  assert.equal(m.references.length, 3);
});

test("AC-DB-23: shared axis only for one unit; the axis domain is two stored values widened to 0 by comparison", () => {
  assert.equal(hasSingleUnit({unit_label: "%"}), true);
  assert.equal(hasSingleUnit({unit_label: "%, index"}), false);
  assert.equal(hasSingleUnit({unit_label: ""}), false);
  assert.equal(hasSingleUnit({unit_label: null}), false);
  assert.equal(hasSingleUnit({unit_label: "%", unit_text_varies: true}), false, "CR-5 field wins when present");
  assert.equal(hasSingleUnit({unit_label: "%, index", unit_text_varies: false}), true);
  assert.deepEqual(axisDomain([3, 1, 7]), [0, 7]);
  assert.deepEqual(axisDomain([-4, 2]), [-4, 2]);
  assert.deepEqual(axisDomain([-4, -2]), [-4, 0]);
  assert.equal(axisDomain([]), null);
  assert.equal(axisDomain([null, undefined]), null);
  const one = buildComparison(base);
  assert.equal(one.form, "bar");
  assert.deepEqual(one.domain, [0, Math.max(...one.withValue.map((r) => r.value))], "stored extremes, widened to 0");
  const mixed = buildComparison({...base, indicator: {...T02, unit_label: "%, index"}});
  assert.equal(mixed.form, "dot");
  assert.equal(mixed.domain, null);
});

test("AC-DB-23: mixed units draw the percentile dot (no bar axis), the value text keeps the row's own series unit; bars take the stored value", () => {
  const plots = [];
  const Plot = {
    plot: (o) => (plots.push(o), new Raw("<svg></svg>")),
    barX: (data, o) => ({kind: "barX", data, o}),
    dot: (data, o) => ({kind: "dot", data, o}),
    axisX: (o) => ({kind: "axisX", o})
  };
  const bar = buildComparison(base);
  const withValue = bar.withValue[0];
  barPlot(Plot, bar, withValue);
  const p = plots.at(-1);
  assert.deepEqual(p.x.domain, bar.domain, "the shared domain is the model's stored extremes");
  assert.equal(p.marks[0].data[0].value, withValue.value, "bar length input is the stored value");
  const table = String(comparisonTable(html, Plot, bar));
  assert.match(table, /data-axis="shared"/);
  const mixed = buildComparison({...base, indicator: {...T02, unit_label: "%, index"}});
  const dotRow = mixed.withValue.find((r) => r.percentile !== null);
  const before = plots.length;
  barPlot(Plot, mixed, dotRow);
  assert.equal(plots.length, before + 1);
  assert.deepEqual(plots.at(-1).x.domain, [0, 1]);
  assert.equal(plots.at(-1).marks[0].kind, "dot");
  assert.equal(barPlot(Plot, mixed, mixed.withValue.find((r) => r.percentile === null)), "", "no percentile, no dot");
  const mixedHtml = String(comparisonTable(html, Plot, mixed));
  assert.match(mixedHtml, /data-axis="none"/);
  assert.equal(plots.slice(before).some((q) => q.marks.some((m) => m.kind === "axisX")), false, "no axis is drawn for mixed units");
  for (const r of mixed.shown) assert.ok(r.unit, `${r.entityId} shows a unit`);
});

test("AC-DB-22: the table has the Reference rows group, a fill token per row, an outlined focus row and no total or average row", () => {
  const Plot = {plot: () => new Raw("<svg></svg>"), barX: () => ({}), dot: () => ({}), axisX: () => ({})};
  const m = buildComparison({...base, state: {c: ["SY02"]}});
  const out = String(comparisonTable(html, Plot, m));
  assert.ok(out.includes(`>${DRAFT_GROUP_REFERENCE_ROWS}<`));
  assert.match(out, /data-group="reference"/);
  assert.match(out, /data-entity="SY02"[^>]*data-focus="true"/);
  assert.match(out, /data-entity="SY01"[^>]*data-focus="false"/);
  assert.match(out, /data-bin="3"/, "the stored 0.5 percentile of SY01 gives bin 3");
  assert.match(out, /data-bin="none"/);
  assert.ok(!/\b(total|average|mean|sum)\b/i.test(out.replace(/Synthetic/g, "")), "no Total or average label");
  assert.ok(out.includes("data-carry"), "country links carry the hash");
  assert.ok(out.includes('aria-sort="ascending"'), "the active sort is on its header");
  assert.ok(out.includes("About this value"));
});

test("AC-DB-22: 'View as table' lists the same rows as the card (RD C-IND-5 columns)", () => {
  const m = buildComparison(base);
  const alt = String(tableAlternative(html, m));
  for (const r of m.shown) assert.ok(alt.includes(`data-entity="${r.entityId}"`), r.entityId);
  for (const col of ["Country", "Latest value", "Reference period", "Offset (days)", "Flags", "Source", "Actions"]) assert.ok(alt.includes(col), col);
});

const dated = (id, name, end) => ({entity_id: id, indicators: [{indicator_id: "X1", value: 1, percentile: 0.5, ref_period_end: end, published: true, publish_scope: "ranked", rank_mode: "monotone_good", alignment: "aligned", ref_offset_days: 0, value_kind: "observed", transform_id: "LEVEL"}], name});
test("AC-DB-36: hidden rows from the Period filter: N equals the hidden list, A to Z, singular and plural, N = 0 renders nothing", () => {
  const ents = [["BB", "Beta", "2019-12-31"], ["AA", "Alpha", "2018-12-31"], ["CC", "Gamma", "2025-12-31"], ["DD", "Delta", null]].map(([id, name]) => ({entity_id: id, name, kind: "country", is_global: false}));
  const sc = {ranked: true, entities: [dated("BB", "Beta", "2019-12-31"), dated("AA", "Alpha", "2018-12-31"), dated("CC", "Gamma", "2025-12-31"), {entity_id: "DD", indicators: []}]};
  const ind = {indicator_id: "X1", name: "X", unit_label: "%", domain_ids: ["d"], frequency_set: ["A"], rank_mode: "monotone_good", good_dir: 1, notes: []};
  const dom = [{domain_id: "d", name: "D", ranked: true, indicator_ids: ["X1"]}];
  const args = {indicator: ind, domainId: "d", domains: dom, scorecard: sc, entities: ents, groups: [], series: []};
  const none = buildComparison(args);
  assert.equal(none.hiddenSentence, "");
  assert.equal(String(hiddenRowsBlock(html, none)), "", "N = 0 renders no element");
  const some = buildComparison({...args, state: {from: 2020, to: 2026}});
  assert.deepEqual(some.hiddenRows.map((h) => h.entityId), ["AA", "BB"]);
  assert.equal(some.hiddenSentence, DRAFT_HIDDEN_ROWS(2));
  assert.equal(Number(some.hiddenSentence.split(" ")[0]), some.hiddenRows.length, "I1: N equals the length of the listed rows");
  assert.ok(ids(some.shown).includes("DD"), "a row without a reference date is never hidden");
  assert.ok(ids(some.shown).includes("CC") && !ids(some.shown).includes("AA"));
  const block = String(hiddenRowsBlock(html, some));
  assert.match(block, /<details class="mm-hidden-rows"><summary>2 rows hidden by the period filter<\/summary>/);
  assert.ok(block.indexOf("Alpha") < block.indexOf("Beta"));
  assert.ok(block.includes(DRAFT_HIDDEN_ROW_ITEM("Alpha", "2018")));
  assert.ok(!/%|total|of \d/.test(block.replace("<details", "")));
  const one = buildComparison({...args, state: {from: 2019, to: 2026}});
  assert.equal(one.hiddenSentence, "1 row hidden by the period filter");
  assert.deepEqual(one.hiddenRows.map((h) => h.entityId), ["AA"]);
  const all = buildComparison({...args, state: {from: 2000, to: 2001}});
  assert.equal(all.empty, false, "DD has no date, so it stays; the card is not empty");
  const empty = buildComparison({...args, entities: ents.filter((e) => e.entity_id !== "DD"), scorecard: {...sc, entities: sc.entities.filter((e) => e.entity_id !== "DD")}, state: {from: 2000, to: 2001}});
  assert.equal(empty.empty, true);
  assert.equal(empty.hiddenSentence, DRAFT_HIDDEN_ROWS(3));
  assert.equal(DRAFT_EMPTY_CARD, "No values for this selection.");
});

test("facts card: stored unit, frequency names, direction, reference line and notes verbatim; nothing else", () => {
  const ind = {...T02, frequency_set: ["M", "Q"], notes: ["First note.", "Second note."]};
  const m = buildComparison({...base, indicator: ind});
  const rows = factRows(indicatorHeader(ind, domains), m.referenceLine);
  assert.deepEqual(rows.map((r) => r.key), ["unit", "frequency", "direction", "refPeriod", "notes"]);
  assert.equal(rows[0].text, "SYNTH_UNIT");
  assert.equal(rows[1].text, "Monthly, Quarterly");
  assert.deepEqual(rows[4].items, ["First note.", "Second note."]);
  assert.deepEqual(factRows(indicatorHeader({...ind, notes: []}, domains), null).map((r) => r.key), ["unit", "frequency", "direction"]);
});

// ---- static scans of the L12 modules (AC-DB-22, AC-DB-36, AC-RD-50)
const MODULES = ["rank-model", "rank-view", "facts-card"].map((n) => `lib/${n}.js`);
const read = (m) => readFileSync(join(here, "..", "src", m), "utf8");

test("AC-RD-50 / AC-DB-22: the L12 modules compute nothing (no allow-list entry), name no total or average, and import only local files", () => {
  for (const m of MODULES) {
    assert.deepEqual(computeHits(read(m)), [], `${m} computes something`);
    assert.ok(!/\b(Total|Average)\b/.test(read(m).replace(/\/\/.*$/gm, "")), `${m} names a Total or Average`);
    assert.ok(!/from\s+["'][^./]/.test(read(m)), `${m} imports a package`);
  }
});

test("AC-DB-36: no view module reads a .length (the hidden-rows list or any filtered list); seeded negatives are caught", () => {
  const lengthRead = (code) => /\.length\b/.test(stripNoise(code));
  for (const m of ["lib/rank-view.js", "lib/facts-card.js"]) assert.equal(lengthRead(read(m)), false, `${m} reads a .length`);
  for (const bad of ["const n = model.hiddenRows.length;", "if (hidden.length > 0) {}", "const k = rows.filter((r) => r.hasValue).length;"]) assert.equal(lengthRead(bad), true, bad);
  assert.ok(!/DRAFT_HIDDEN_ROWS\s*\(/.test(read("lib/rank-view.js")), "the view takes the sentence from the model, it does not count");
});
