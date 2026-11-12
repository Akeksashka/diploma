// L18: the time-series card of the Over time band (layout amendment 4.10, 5; AC-DB-12, AC-DB-03), offline. Pure parts and the block builder
// with a Plot stand-in; the request behaviour (zero series/* before the click, one after) is in tests/smoke/series-card.smoke.mjs.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {homePageSource} from "../scripts/lib.mjs";
import {DRAFT_EMPTY_CARD, DRAFT_LOAD_HISTORY} from "../src/lib/copy.js";
import {explorerContext} from "../src/lib/explorer.js";
import {hasHistory, historySource} from "../src/lib/history.js";
import {SERIES_CARD_MAX, cardBlock, cardModel, rowsForCard, seriesCardPlan} from "../src/lib/series-card.js";
import {html} from "./support/html-standin.mjs";

const manifest = {files: [{path: "series/M09.parquet", format: "parquet", bytes: 10000, rows: 60}, {path: "alerts.json", format: "json", bytes: 10, rows: null}]};
const indicators = [{indicator_id: "M09", name: "Unemployment rate", unit_label: "% of labour force", default_transform: "LEVEL"}, {indicator_id: "Z99", name: "No file", unit_label: "x", default_transform: "LEVEL"}];
const entities = ["DEU", "FRA", "ITA", "ESP", "POL", "USA"].map((id) => ({entity_id: id, name: `N-${id}`}));
const seriesMeta = entities.map((e, i) => ({series_id: i + 1, indicator_id: "M09", entity_id: e.entity_id, seasonal_adjustment: "SA", source_name: "S", unit_code: "PCT", unit_mult: 0, base_period: null}));
const ectx = explorerContext({manifest, seriesMeta, entities, indicators, alerts: []});
const source = historySource(manifest, {M09: {}});
const row = (entity, seriesId, y, m, v, frequency = "M") => ({entity, seriesId, end: Date.UTC(y, m, 0), frequency, value: v, value_default_tf: v, value_yoy: null, status: "OBS", knownAt: 0, loadKind: "new_period"});
const rows = [
  ...[2019, 2020, 2021].flatMap((y, i) => [row("DEU", 1, y, 12, 5 + i), row("FRA", 2, y, 12, 8 + i)]),
  row("DEU", 1, 2021, 6, 4, "Q")
];

test("plan: no Country -> multiples (L19); no file -> unavailable; otherwise history; at most 5 entities", () => {
  const ctx = (c, indicatorId) => ({state: {c}, indicatorId});
  assert.equal(seriesCardPlan(ctx([], "M09"), source).kind, "multiples");
  assert.equal(seriesCardPlan(ctx([], "Z99"), source).kind, "unavailable");
  assert.equal(seriesCardPlan(ctx(["DEU"], "Z99"), source).kind, "unavailable");
  assert.equal(seriesCardPlan(ctx(["DEU"], null), source).kind, "unavailable");
  assert.equal(seriesCardPlan(ctx(["DEU"], "M09"), source).kind, "history");
  assert.equal(seriesCardPlan(ctx(["DEU"], "M09"), historySource(manifest, {})).kind, "unavailable"); // listed but not registered on the page
  assert.equal(SERIES_CARD_MAX, 5);
  assert.deepEqual(seriesCardPlan(ctx(["DEU", "FRA", "ITA", "ESP", "POL", "USA"], "M09"), source).entities, ["DEU", "FRA", "ITA", "ESP", "POL"]);
  assert.equal(hasHistory(source, "M09"), true);
});

test("Frequency keeps the rows with that stored frequency; none leaves all rows; no resampling", () => {
  assert.equal(rowsForCard(rows, {f: null}).length, rows.length);
  assert.deepEqual([...new Set(rowsForCard(rows, {f: "M"}).map((r) => r.frequency))], ["M"]);
  assert.equal(rowsForCard(rows, {f: "Q"}).length, 1);
  assert.equal(rowsForCard(rows, {f: "A"}).length, 0);
});

test("Period clips the x-domain by year; values stay as stored; selection order fixes the order", () => {
  const all = cardModel(ectx, "M09", rows, {f: "M"}, ["FRA", "DEU"]);
  assert.deepEqual(all.series.map((s) => s.entity), ["DEU", "FRA"]); // buildModel sorts by name; hue follows the selection order
  assert.deepEqual(all.series.map((s) => s.order), [1, 0]);
  const clipped = cardModel(ectx, "M09", rows, {f: "M", from: 2020, to: 2020}, ["DEU", "FRA"]);
  assert.deepEqual(clipped.series[0].lines.map((p) => p.value), [6]);
  assert.deepEqual(clipped.series[1].lines.map((p) => p.value), [9]);
  const none = cardModel(ectx, "M09", rows, {f: "M", from: 1990, to: 1991}, ["DEU"]);
  assert.equal(none.plotted.length, 0);
  assert.equal(cardModel(ectx, "M09", rows, {f: "A"}, ["DEU"]).plotted.length, 0);
});

test("cardBlock: empty-card sentence when nothing is drawn; otherwise the figure, the table alternative and the stored values", () => {
  const Plot = {plot: () => html`<svg></svg>`, line: (d) => d, dot: (d) => d, ruleX: (d) => d, text: (d) => d, tip: (d) => d, pointer: (o) => o};
  const empty = String(cardBlock(html, Plot, cardModel(ectx, "M09", rows, {f: "A"}, ["DEU"])));
  assert.ok(empty.includes(DRAFT_EMPTY_CARD) && !empty.includes("<svg"));
  const out = String(cardBlock(html, Plot, cardModel(ectx, "M09", rows, {f: "M"}, ["DEU", "FRA"])));
  assert.ok(out.includes('id="series-card-figure"') && out.includes('id="series-card-view"') && out.includes("<svg"));
  assert.ok(out.includes(">8<") || out.includes("8 "), "stored value of FRA 2019 is printed unchanged");
});

test("the generated home page registers one lazy literal FileAttachment per series file and mounts the card; nothing else reads series/", () => {
  const src = homePageSource({entities: [], indicators: [], domains: [], manifest});
  assert.ok(src.includes('"M09": FileAttachment("data/series/M09.parquet")'));
  assert.ok(src.includes("mountSeriesCard(html, Plot, dash"));
  assert.equal([...src.matchAll(/FileAttachment\(\s*[^"]/g)].length, 0);
  assert.ok(!/\.parquet\(\)|\.url\(\)/.test(src), "the page itself never opens a series file");
  assert.ok(homePageSource({entities: [], indicators: [], domains: []}).includes("const seriesFiles = {};"));
});

test("source scan: series-card.js is the only home module that opens a series file, only inside the button handler path", () => {
  const code = readFileSync(new URL("../src/lib/series-card.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/FileAttachment\s*\(/.test(code));
  assert.ok(!/\.url\s*\(/.test(code));
  assert.equal([...code.matchAll(/loadSeries\(/g)].length, 1);
  assert.ok(code.includes('addEventListener("click", () => activate(id))'));
  assert.ok(DRAFT_LOAD_HISTORY === "Load history");
});
