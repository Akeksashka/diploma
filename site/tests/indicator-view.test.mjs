// Redesign R10: indicator page rendering on the SYNTHETIC sparse fixture, with the htl stand-in (string output).
// AC-RD-20, 21, 22, 23, 25, 42, 45 (markup level; the browser checks are in tests/smoke/indicator.smoke.mjs).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import * as copy from "../src/lib/copy.js";
import {indicatorModel} from "../src/lib/indicator-model.js";
import {
  DEFAULT_SORT, SORTS, dotCardBody, dotRows, indicatorBlock, indicatorTable, pageState, peerGroups, referenceLineText, resultsBlock, seriesCountries, viewRows
} from "../src/lib/indicator-view.js";
import {INDICATOR_SORT_OPTIONS, RANK_SORT_OPTIONS} from "../src/lib/rank-model.js";
import {valueChart, valueFigure, valueRows} from "../src/lib/value-chart.js";
import {indicatorPageSource} from "../scripts/lib.mjs";
import {html} from "./support/html-standin.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dir = join(root, "fixtures", "sparse_export");
const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const entities = load("meta/entities.json").entities;
const indicators = load("meta/indicators.json").indicators;
const series = load("meta/series.json").series;
const domains = load("meta/domains.json").domains;
const scorecards = Object.fromEntries(domains.map((d) => [d.domain_id, load(`scorecard/${d.domain_id}.json`)]));
const build = (id, sc = scorecards) => indicatorModel({indicator: indicators.find((i) => i.indicator_id === id), domains, scorecards: sc, entities, series});
const calls = [];
const fakePlot = {
  plot: (o) => {
    calls.push(o);
    return "<svg></svg>";
  },
  barX: (d, o) => ({type: "barX", d, o}),
  ruleX: (d, o) => ({type: "ruleX", d, o}),
  text: (d, o) => ({type: "text", d, o}),
  dot: (d, o) => ({type: "dot", d, o}),
  tip: (d, o) => ({type: "tip", d, o}),
  pointerY: (o) => o
};
const groups = [{group_id: "g7", members: [{entity_id: "SY02", valid_from: "1999-01-01", valid_to: null}, {entity_id: "SY03", valid_from: "1999-01-01", valid_to: null}]}];
const store = {get: () => ({c: [], g: null}), subscribe() {}};
const page = (id, opts = {}) => String(indicatorBlock(html, fakePlot, build(id), {groups, knownCutoff: "2026-11-01", store, ...opts}));

test("sort options are Country, Value, Percentile, Reference period; Country A-Z is the default (C-IND-1, AC-RD-22)", () => {
  assert.deepEqual(INDICATOR_SORT_OPTIONS.map((o) => o.label), ["Country", "Value", "Percentile", "Reference period"]);
  assert.deepEqual(RANK_SORT_OPTIONS.map((o) => o.id), ["name", "value", "percentile"], "the PG-HOME card keeps three sorts");
  assert.equal(DEFAULT_SORT, "name");
  assert.deepEqual(Object.keys(SORTS), ["name", "value", "percentile", "period"]);
});

test("each sort orders by the stored field, nulls last, ties by name (AC-RD-22)", () => {
  const m = build("T02");
  const ids = (sort) => viewRows(m, {sort}).withValue.map((r) => r.entityId);
  const byName = viewRows(m, {sort: "name", reading: false}).withValue.map((r) => r.name);
  assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b, "en")));
  const pct = viewRows(m, {sort: "percentile"}).withValue.map((r) => r.percentile);
  const firstNull = pct.findIndex((p) => p === null);
  assert.ok(firstNull > 0 && pct.slice(firstNull).every((p) => p === null), "rows without a stored percentile come last");
  assert.deepEqual(pct.slice(0, firstNull), [...pct.slice(0, firstNull)].sort((a, b) => b - a));
  const vals = viewRows(m, {sort: "value"}).withValue.map((r) => r.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a));
  const periods = viewRows(m, {sort: "period"}).withValue.map((r) => r.refPeriodEnd);
  assert.deepEqual(periods, [...periods].sort().reverse());
  assert.equal(new Set([ids("name"), ids("value"), ids("percentile"), ids("period")].map((x) => x.length)).size, 1, "a sort never drops a row");
});

test("rows without a value stay in the second group, whatever the sort (AC-RD-20)", () => {
  const m = build("T04");
  for (const sort of Object.keys(SORTS)) {
    const v = viewRows(m, {sort});
    assert.ok(v.withValue.every((r) => r.hasValue) && v.withoutValue.every((r) => !r.hasValue), sort);
    assert.equal(v.withValue.length + v.withoutValue.length, m.rows.length);
  }
});

test("the peer group only filters: the stored percentile of a kept row is unchanged (C-IND-1, AC-RD-23)", () => {
  const m = build("T01");
  const pg = peerGroups(groups, "2026-11-01");
  const all = viewRows(m, {group: "all"}, pg.members);
  const g7 = viewRows(m, {group: "g7"}, pg.members);
  assert.deepEqual(g7.withValue.map((r) => r.entityId).sort(), ["SY02", "SY03"]);
  for (const r of g7.withValue) assert.equal(r.percentile, all.withValue.find((x) => x.entityId === r.entityId).percentile);
  assert.deepEqual(pg.options.map((o) => o.id), ["all", "g7"]);
  assert.equal(viewRows(m, {group: "unknown"}, pg.members).withValue.length, all.withValue.length, "an unknown group keeps all rows");
});

test("the filter note and the percentile column label are present verbatim (AC-RD-23)", () => {
  const out = page("T01");
  assert.match(out, new RegExp(`<p class="mm-filter-note" id="filter-note">${copy.FILTER_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</p>`));
  assert.match(out, /percentile vs all ranked countries/);
  assert.doesNotMatch(out, /id="indicator-group"/, "the peer group control is the Group select of the filter bar (L23)");
  assert.doesNotMatch(out, /id="indicator-sort"/, "the sort select is in the C-RANK card header, which the unit stand-in does not mount");
  assert.equal(out.includes("<nav"), false, "the page keeps exactly one nav (the shell's)");
});

test("the table has one row per entity of the scorecard, nothing dropped, aggregates included (AC-RD-20)", () => {
  const m = build("T04");
  const out = String(indicatorTable(html, m, viewRows(m, {}), SORTS.name, null));
  assert.equal(out.split('<tr role="row" data-entity=').length - 1, scorecards.growth.entities.length);
  for (const e of scorecards.growth.entities) assert.equal(out.split(`<tr role="row" data-entity="${e.entity_id}"`).length, 2, e.entity_id);
  assert.match(out, /<tbody data-group="without-value"><tr class="mm-group-row"><th scope="rowgroup" colspan="8">Indicators without a value in this export<\/th>/);
  assert.match(out, new RegExp(`<span class="mm-sentence">${copy.DRAFT_NA_DEFINED_SENTENCE}`));
  assert.match(out, /<caption>/);
});

test("aria-sort follows the active sort on the four sortable headers only (AC-RD-22)", () => {
  const m = build("T02");
  const head = (sort) => /<thead>[\s\S]*<\/thead>/.exec(String(indicatorTable(html, m, viewRows(m, {sort}), SORTS[sort], null)))[0];
  assert.match(head("name"), /<th scope="col" class="" aria-sort="ascending">Country<\/th>/);
  assert.match(head("name"), /aria-sort="none">Latest value</);
  assert.match(head("value"), /aria-sort="descending">Latest value</);
  assert.match(head("percentile"), /aria-sort="descending">percentile vs all ranked countries</);
  assert.match(head("period"), /aria-sort="descending">Reference period</);
  assert.equal(head("name").split("aria-sort=").length - 1, 4);
});

test("every value carries its unit, the estimate mark, the stored percentile and bin, the offset and links (AC-RD-42, 45)", () => {
  const m = build("T02");
  const out = String(indicatorTable(html, m, viewRows(m, {}), SORTS.name, null));
  const tr = (id) => new RegExp(`<tr role="row" data-entity="${id}"[\\s\\S]*?</tr>`).exec(out)[0];
  assert.match(tr("SY01"), /<span class="mm-unit">SYNTH_UNIT<\/span>/);
  assert.match(tr("SY01"), /data-mark="estimate"/);
  assert.match(tr("SY01"), /<a href="\.\.\/country\/SY01" data-link="country" data-carry>Synthetic SY01<\/a>/);
  assert.match(tr("SY01"), /<a href="\.\.\/explorer#i=T02&amp;c=SY01" data-link="series" aria-label="Time series: Synthetic indicator T02, Synthetic SY01">Time series<\/a>/);
  assert.match(tr("SY01"), /data-label="Offset \(days\)"/);
  assert.match(tr("SY03"), /data-state="stale"/);
  assert.match(out, /<details class="mm-about" id="about-T02-SY01"/);
  assert.equal(out.split("<details class=\"mm-about\"").length - 1, m.withValue.length, "an About this value disclosure per value row");
});

test("a transformed value column appears only when a cell has a non-level transform; the header uses the transform label (C-IND-5, CR-6)", () => {
  const plain = build("T02");
  assert.doesNotMatch(String(indicatorTable(html, plain, viewRows(plain, {}), SORTS.name, null)), /Transformed value/);
  const sc = structuredClone(scorecards);
  const cell = sc.growth.entities.find((e) => e.entity_id === "SY01").indicators.find((c) => c.indicator_id === "T02");
  Object.assign(cell, {transform_id: "YOY", transformed_value: 1.5});
  const m = build("T02", sc);
  const out = String(indicatorTable(html, m, viewRows(m, {}), SORTS.name, null));
  assert.match(out, /<th scope="col" class="mm-num">Transformed value \(YOY\)<\/th>/);
  assert.match(out, /data-label="Transformed value \(YOY\)">1\.5 <span class="mm-unit">YOY<\/span>/);
  assert.match(out, /colspan="9"/);
});

test("reference-period line: the stored spread and period, or the not-ranked wording (C-IND-2, AC-RD-21)", () => {
  assert.equal(referenceLineText(build("T01").referenceLine), copy.NO_RANKING_SPREAD);
  const sc = structuredClone(scorecards);
  sc.growth.alignment = [{indicator_id: "T02", reference_period_spread_days: 12, rank_reference_period: "2025-12", n_ranked: 3}];
  assert.equal(referenceLineText(build("T02", sc).referenceLine), "Reference-period spread of the ranked set: 12 days; common reference period of the ranking 2025-12; countries ranked 3.");
  sc.growth.alignment = [{indicator_id: "T02", reference_period_spread_days: 12, rank_reference_period: "2025-12", max_ref_spread_days: 45, n_ranked: 3, n_unaligned: 1}];
  assert.equal(referenceLineText(build("T02", sc).referenceLine), "Reference-period spread of the ranked set: 12 days (limit 45 days); common reference period of the ranking 2025-12; countries ranked 3; shown but not ranked because unaligned 1.");
  assert.match(page("T01"), /<p class="mm-spread" id="reference-spread">No ranking for this indicator/);
});

test("Open as time series: the country in focus, else the first five A-Z, never by percentile (C-IND-6)", () => {
  const m = build("T02");
  for (const sort of Object.keys(SORTS)) {
    const v = viewRows(m, {sort});
    const shown = [...v.withValue, ...v.withoutValue];
    assert.deepEqual(seriesCountries(shown, null), ["SY01", "SY02", "SY03", "SY04", "SY05"], sort);
    assert.deepEqual(seriesCountries(shown, "SY06"), ["SY06"], sort);
  }
  assert.match(page("T02"), /href="\.\.\/explorer#i=T02&amp;c=SY01,SY02,SY03,SY04,SY05" id="open-series" data-link="series-all">Open as time series</);
  assert.match(String(resultsBlock(html, m, {group: "all", sort: "percentile", focus: "SY06"}, peerGroups(groups, null))), /href="\.\.\/explorer#i=T02&amp;c=SY06" id="open-series"/);
});

test("the Parquet download link is present only when an address is given (C-IND-7)", () => {
  assert.doesNotMatch(page("T02"), /id="indicator-download"/);
  assert.match(page("T02", {downloadHref: "../_file/data/series/T02.abc.parquet"}), /<a href="\.\.\/_file\/data\/series\/T02\.abc\.parquet" download id="indicator-download" data-link="download">Download the data file of this indicator<\/a>/);
});

test("value chart: only entities with a stored value, in the sort order, bin fill, axis title with name and unit (C-IND-3, AC-RD-25)", () => {
  const m = build("T02");
  const v = viewRows(m, {sort: "value"});
  const rows = valueRows(v.withValue, "SY02");
  assert.deepEqual(rows.map((r) => r.entityId), v.withValue.filter((r) => r.hasValue).map((r) => r.entityId));
  assert.equal(rows.filter((r) => r.focus).length, 1);
  assert.equal(rows.find((r) => r.entityId === "SY03").bin, null, "a stale cell shows no percentile, so its bar is neutral");
  assert.equal(valueRows(v.withoutValue).length, 0, "entities without a value are not drawn");
  calls.length = 0;
  const fig = String(valueFigure(html, fakePlot, rows, {name: "Synthetic T02", unit: "SYNTH_UNIT"}));
  assert.match(fig, /<figure class="mm-figure" id="value-figure" role="img" aria-label="Bar chart of Synthetic T02, in SYNTH_UNIT, \d+ countries; table below lists the same values">/);
  assert.equal(calls.at(-1).x.label, "Synthetic T02 (SYNTH_UNIT)");
  assert.deepEqual(calls.at(-1).y.domain, rows.map((r) => r.label));
  assert.equal(valueChart(fakePlot, [], {name: "x", unit: "u"}), null);
  assert.equal(String(valueFigure(html, fakePlot, [], {name: "x", unit: "u"})), "");
});

test("an estimate bar carries the e mark; the dot plot keeps the V2 drawing and plots only shown percentiles (C-IND-4)", () => {
  const m = build("T02");
  calls.length = 0;
  valueChart(fakePlot, valueRows(m.withValue, null), {name: "N", unit: "U"});
  const text = calls.at(-1).marks.find((x) => x.type === "text");
  assert.ok(text.d.some((r) => r.entityId === "SY01"));
  const dots = dotRows(m.withValue, "SY01");
  assert.ok(dots.every((r) => r.percentile !== null));
  assert.ok(!dots.some((r) => r.entityId === "SY03"), "stale: not plotted");
  assert.equal(dots.filter((r) => r.focus).length, 1);
  const out = String(dotCardBody(html, fakePlot, m, viewRows(m, {}), null));
  assert.match(out, /id="indicator-dot-figure" role="img"/);
  assert.match(out, /<ol class="mm-legend-bins">/);
  const unranked = build("T05");
  const none = String(dotCardBody(html, fakePlot, unranked, viewRows(unranked, {}), null));
  assert.doesNotMatch(none, /indicator-dot-figure/);
  assert.match(none, /id="indicator-dot-empty"[^>]*>No values for this selection\./);
  assert.doesNotMatch(String(resultsBlock(html, m, {group: "all", sort: "name", focus: null}, peerGroups([], null))), /indicator-dot-figure/, "the dot plot is its own card, not part of the table body");
});

test("an empty peer group shows the empty state, not an empty table", () => {
  const out = String(resultsBlock(html, build("T02"), {group: "g7", sort: "name", focus: null}, peerGroups([{group_id: "g7", members: []}], null)));
  assert.match(out, /id="empty-group"/);
  assert.doesNotMatch(out, /<table/);
});

test("the page renders no switcher of its own: the Indicator switcher with its explicit Go is the filter bar's (L23, WCAG 3.2.2)", () => {
  const out = page("T02");
  assert.doesNotMatch(out, /<select|indicator-switcher-go/);
  const bar = readFileSync(join(root, "..", "src", "lib", "filter-bar.js"), "utf8");
  const fn = /const indicatorSwitcher = [\s\S]*?\n  };\n/.exec(bar)[0];
  assert.doesNotMatch(fn, /addEventListener\("change"/);
  assert.match(fn, /"click"/);
  assert.match(fn, /e\.key !== "Enter"/);
  assert.match(fn, /id="indicator-switcher-go"/);
});

test("the page state reads the Group and the country in focus from the filter store, only for countries on the page", () => {
  assert.deepEqual(pageState({c: ["SY02"], g: null}, ["SY01", "SY02"]), {group: "all", focus: "SY02", sort: "name", reading: false});
  assert.deepEqual(pageState({c: ["NOPE"], g: "g7"}, ["SY01"]), {group: "g7", focus: null, sort: "name", reading: false});
  assert.deepEqual(pageState({c: [], g: null}, ["SY01"], "value"), {group: "all", focus: null, sort: "value", reading: false});
});

test("the page is a Compare band (rank card slot, dot card beside it) and a Table band; an unranked domain has no dot card (L23, 4.3)", () => {
  const out = page("T02");
  assert.match(out, /<h2 id="band-compare-heading">Compare<\/h2>/);
  assert.match(out, /<h2 id="band-table-heading">Table<\/h2>/);
  assert.match(out, /id="indicator-compare" data-slot="compare"/);
  assert.match(out, /mm-card--span-8" id="indicator-compare"[\s\S]*mm-card--span-4 mm-card--dot" id="indicator-dot-card"/);
  assert.doesNotMatch(page("T05"), /indicator-dot-card/);
  assert.match(page("T05"), /mm-card--span-12" id="indicator-compare"/);
});

test("the generated page names the series file only when the manifest lists it, and loads the groups", () => {
  const ind = indicators.find((i) => i.indicator_id === "T02");
  const none = indicatorPageSource(ind, domains, "LEVEL");
  assert.match(none, /const seriesFile = null;/);
  const src = indicatorPageSource(ind, domains, "LEVEL", {files: [{path: "series/T02.parquet"}, {path: "series/T01.parquet"}]});
  assert.match(src, /const seriesFile = FileAttachment\("\.\.\/data\/series\/T02\.parquet"\);/);
  assert.doesNotMatch(src, /series\/T01/);
  assert.match(src, /meta\/groups\.json/);
  assert.match(src, /indicatorBlock\(html, Plot, model,/);
  assert.match(src, /id="indicator-header"/);
  assert.match(src, /mountFilterBar\(html, \{page: "indicator"/);
  assert.match(src, /maxEntities: 1/);
  assert.doesNotMatch(src, /R9 placeholder/);
});

test("AC-RD-42: a PG-INDICATOR indicator with no unit_label states the defect on the axis, label, tip and table; nothing throws", () => {
  const bare = {...indicators.find((i) => i.indicator_id === "T02"), unit_label: null};
  const m = indicatorModel({indicator: bare, domains, scorecards, entities, series});
  const stated = "This export holds no unit for this value.";
  assert.equal(m.header.unit, null);
  const rows = valueRows(viewRows(m, {sort: "name"}).withValue);
  calls.length = 0;
  const fig = String(valueFigure(html, fakePlot, rows, {name: m.header.name, unit: m.header.unit}));
  assert.ok(fig.includes(stated), "figure label states the defect");
  assert.equal(calls.at(-1).x.label, `${m.header.name} (${stated})`);
  const tips = calls.at(-1).marks.filter((mk) => mk.type === "tip");
  assert.ok(tips.length > 0);
  for (const tip of tips) for (const r of rows) assert.ok(tip.o.title(r).split("\n")[1].endsWith(` ${stated}`) && tip.o.title(r).split("\n")[1].startsWith(r.estimate ? `${r.valueText} e` : r.valueText), "the tip keeps the value and states the defect");
  const table = String(resultsBlock(html, m, {group: "all", sort: "name", focus: null}, peerGroups([], null)));
  assert.ok(table.includes(stated));
});
