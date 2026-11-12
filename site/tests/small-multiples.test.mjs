// L19 small multiples (layout amendment 4.10; AC-DB-27, AC-DB-26) and L20 bars toggle (4.4; AC-DB-28), offline: the pure models and the block builders with a
// Plot stand-in. The browser behaviour (12 facets, Show more, shared axis, reader, toggle, bars equal the table) is in tests/smoke/series-card.smoke.mjs.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {DRAFT_CHART_MODES, DRAFT_EMPTY_CARD, DRAFT_SHOW_MORE} from "../src/lib/copy.js";
import {MAX_BAR_TICKS, barPoints, barTicks, barsAvailable, modeFor} from "../src/lib/bar-chart.js";
import {explorerContext} from "../src/lib/explorer.js";
import {chart, tableRowsOf} from "../src/lib/explorer-view.js";
import {FACET_PAGE, facetOrder, multiplesModel} from "../src/lib/small-multiples.js";
import {multiplesBlock, cardBlock, cardModel} from "../src/lib/series-card.js";
import {html} from "./support/html-standin.mjs";

const ids = Array.from({length: 30}, (_, i) => `E${String(i).padStart(2, "0")}`);
const entities = [...ids.map((id, i) => ({entity_id: id, name: `Name ${String(29 - i).padStart(2, "0")}`, kind: "country"})), {entity_id: "AGG", name: "Aggregate", kind: "aggregate"}];
const manifest = {files: [{path: "series/M09.parquet", format: "parquet", bytes: 10000, rows: 60}]};
const indicators = [{indicator_id: "M09", name: "Unemployment rate", unit_label: "% of labour force", default_transform: "LEVEL"}];
const seriesMeta = ids.map((e, i) => ({series_id: i + 1, indicator_id: "M09", entity_id: e, seasonal_adjustment: "SA", source_name: "S", unit_code: "PCT", unit_mult: 0, base_period: null}));
const ectx = explorerContext({manifest, seriesMeta, entities, indicators, alerts: []});
const row = (entity, y, v, status = "OBS", frequency = "A") => ({entity, seriesId: ids.indexOf(entity) + 1, end: Date.UTC(y, 11, 31), frequency, value: v, value_default_tf: v, value_yoy: null, status, knownAt: 0, loadKind: "new_period"});
// E29 has no row at all; the others have three annual values.
const rows = ids.slice(0, 29).flatMap((e, i) => [2019, 2020, 2021].map((y, k) => row(e, y, i + k, y === 2021 && i === 0 ? "EST" : "OBS")));

test("facetOrder: countries only (aggregates are reference rows), A to Z by name without a scorecard; a Group restricts the set", () => {
  const order = facetOrder({entities, state: {}});
  assert.equal(order.length, 30);
  assert.ok(!order.includes("AGG"));
  assert.equal(order[0], "E29"); // "Name 00"
  assert.equal(order.at(-1), "E00");
  const groups = [{group_id: "G", members: [{entity_id: "E01", valid_to: null}, {entity_id: "E02", valid_to: null}]}];
  assert.deepEqual(facetOrder({entities, groups, state: {g: "G"}}).sort(), ["E01", "E02"]);
});

test("AC-DB-27: at most 12 facets, then the next 12 (no count printed); shared axis; entity-name title; every drawn value stored", () => {
  const order = facetOrder({entities, state: {}});
  const first = multiplesModel(ectx, "M09", rows, {}, order);
  assert.equal(FACET_PAGE, 12);
  assert.equal(first.visible.length, 12);
  const drawn = (b, n) => order.slice(0, n).filter((id) => !b.noData.includes(id)); // an entity without a row keeps its place in the no-data list
  assert.equal(first.model.series.length, drawn(first, 12).length);
  assert.equal(first.model.facets, true);
  assert.equal(first.more, true);
  assert.deepEqual(first.model.series.map((s) => s.entity), drawn(first, 12));
  const second = multiplesModel(ectx, "M09", rows, {}, order, 24);
  assert.equal(second.model.series.length, drawn(second, 24).length);
  assert.deepEqual(second.model.series.slice(0, drawn(first, 12).length).map((s) => s.entity), drawn(first, 12)); // the first block keeps its place
  assert.equal(multiplesModel(ectx, "M09", rows, {}, order, 36).more, false);
  // a stored value is shown as stored
  const e00 = first.model.series.find((s) => s.entity === "E00") ?? second.model.series.find((s) => s.entity === "E00");
  assert.deepEqual((e00 ?? first.model.series[0]).lines.map((p) => p.value).length, 3);
});

test("an entity without any row is kept with the empty-card sentence, not dropped; Period clips, Frequency keeps the stored one (AC-DB-26: file only)", () => {
  const order = ["E29", "E00", "E01"];
  const built = multiplesModel(ectx, "M09", rows, {}, order);
  assert.deepEqual(built.noData, ["E29"]);
  assert.deepEqual(built.model.series.map((s) => s.entity), ["E00", "E01"]);
  const out = String(multiplesBlock(html, {plot: () => html`<svg></svg>`, line: (d) => d, dot: (d) => d, ruleX: (d) => d, text: (d) => d, tip: (d) => d, pointer: (o) => o}, {...built, noData: [{id: "E29", name: "Name 00"}]}));
  assert.ok(out.includes('data-entity="E29"') && out.includes(`Name 00: ${DRAFT_EMPTY_CARD}`));
  const clipped = multiplesModel(ectx, "M09", rows, {from: 2020, to: 2020}, order);
  assert.deepEqual(clipped.model.series[0].lines.map((p) => p.value), [1]);
  assert.equal(multiplesModel(ectx, "M09", rows, {f: "M"}, order).model.series.length, 0);
});

const Plot = {plot: (o) => html`<svg></svg>`, line: (d) => d, dot: (d) => d, ruleX: (d) => d, ruleY: (d) => d, text: (d) => d, tip: (d) => d, pointer: (o) => o, pointerX: (o) => o, barY: (d) => d};

test("multiplesBlock: Show more only while entities remain; the block has the figure, reader and table alternative of the card", () => {
  const order = facetOrder({entities, state: {}});
  const more = String(multiplesBlock(html, Plot, multiplesModel(ectx, "M09", rows, {}, order)));
  assert.ok(more.includes(`>${DRAFT_SHOW_MORE}</button>`) && more.includes('id="series-card-more"'));
  assert.ok(more.includes('id="series-card-figure"') && more.includes('id="series-card-view"'));
  assert.ok(!/\b30\b|\b12 of\b|of 30/.test(more.replace(/<[^>]*>/g, "")), "no count printed");
  const done = String(multiplesBlock(html, Plot, multiplesModel(ectx, "M09", rows, {}, order, 40)));
  assert.ok(!done.includes("series-card-more"));
});

test("AC-DB-28: the toggle applies to exactly one selected series; mode falls back to lines otherwise", () => {
  assert.deepEqual([0, 1, 2, 5].map(barsAvailable), [false, true, false, false]);
  assert.equal(modeFor(1, "bars"), "bars");
  assert.equal(modeFor(2, "bars"), "lines");
  assert.equal(modeFor(1, "lines"), "lines");
  assert.deepEqual(Object.values(DRAFT_CHART_MODES), ["Lines", "Bars"]);
});

test("AC-DB-28: bars are the stored period values and equal the table rows of the line view (same rows in both views)", () => {
  const model = cardModel(ectx, "M09", rows, {}, ["E00"]);
  const bars = barPoints(model);
  const table = tableRowsOf(model);
  assert.equal(bars.length, 3);
  assert.deepEqual(bars.map((b) => b.point.value), model.series[0].lines.map((p) => p.value));
  assert.deepEqual(bars.map((b) => b.label), table.map((t) => t.date));
  assert.deepEqual(bars.map((b) => b.estimate), [false, false, true]); // the EST period is the hollow outline
  assert.deepEqual(bars.map((b) => String(b.point.text)), table.map((t) => t.valueText.replace(/\s*\(.*\)$/, "").replace(/^\S*\s?\*$/, (m) => m)).map((t, i) => (bars[i].estimate ? String(bars[i].point.text) : t)));
  const lineBlock = String(cardBlock(html, Plot, model, {mode: "lines", selected: 1, toggle: html`<fieldset id="t"></fieldset>`}));
  const barBlock = String(cardBlock(html, Plot, model, {mode: "bars", selected: 1, toggle: html`<fieldset id="t"></fieldset>`}));
  const rowsOf = (h) => h.match(/<tr data-entity[\s\S]*?<\/tr>/g) ?? [];
  assert.ok(lineBlock.includes('id="t"') && barBlock.includes('id="t"'));
  assert.deepEqual(rowsOf(barBlock), rowsOf(lineBlock));
  const two = String(cardBlock(html, Plot, cardModel(ectx, "M09", rows, {}, ["E00", "E01"]), {mode: "bars", selected: 2, toggle: html`<fieldset id="t"></fieldset>`}));
  assert.ok(!two.includes('id="t"'), "toggle hidden with two series");
});

test("bar x-axis: at most MAX_BAR_TICKS labels, evenly spaced by position; every bar is still drawn", () => {
  const labels = Array.from({length: 95}, (_, i) => `L${i}`);
  const t = barTicks(labels);
  assert.ok(t.length <= MAX_BAR_TICKS && t[0] === "L0");
  assert.deepEqual(barTicks(["a", "b"]), ["a", "b"]);
});

test("chart(): bars only for a model with exactly one series; lines otherwise (stand-in Plot)", () => {
  let barCalls = 0;
  const P = {...Plot, barY: (d) => { barCalls += 1; return d; }, plot: () => html`<svg></svg>`};
  chart(P, cardModel(ectx, "M09", rows, {}, ["E00"]), {html, mode: "bars"});
  assert.ok(barCalls > 0);
  barCalls = 0;
  chart(P, cardModel(ectx, "M09", rows, {}, ["E00", "E01"]), {html, mode: "bars"});
  assert.equal(barCalls, 0);
});

test("PG-SERIES hash grammar is unchanged: the chart type is not written to or read from the address; explorer page wires the toggle", async () => {
  const {explorerPageSource} = await import("../scripts/lib.mjs");
  const src = explorerPageSource({files: [{path: "series/M09.parquet", format: "parquet", bytes: 1, rows: 1}]});
  assert.ok(src.includes('chartModeToggle(html, {id: "explorer-chart-mode"})'));
  const hash = readFileSync(new URL("../src/lib/hash.js", import.meta.url), "utf8");
  assert.ok(!/bars|chart.?mode|mode/i.test(hash.replace(/\/\/.*$/gm, "")), "hash.js knows no chart type");
  assert.ok(!/selectionHash\([^)]*mode/.test(src));
});

test("source scan: small-multiples.js and bar-chart.js open no file and read no storage", () => {
  for (const f of ["small-multiples.js", "bar-chart.js"]) {
    const code = readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/FileAttachment|loadSeries|fetch\(|localStorage|sessionStorage|document\.cookie/.test(code), f);
  }
});
