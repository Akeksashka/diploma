// R14: "About these series" table (C-SER-6), unit text and estimate marker of PG-SERIES (AC-RD-32, 33, 42, 45).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {buildModel, explorerContext} from "../src/lib/explorer.js";
import {explorerBlock, tableRowsOf, uniformUnit} from "../src/lib/explorer-view.js";
import {viewAsTable} from "../src/lib/figure.js";
import {aboutSeriesRows, aboutSeriesTable, isEstimateStatus, markedValue, shortUnit} from "../src/lib/series-meta.js";
import {seriesTipLines} from "../src/lib/tip.js";
import {html} from "./support/html-standin.mjs";

const manifest = {files: [{path: "series/M09.parquet", format: "parquet", bytes: 100, rows: 4}]};
const indicators = [{indicator_id: "M09", name: "Unemployment rate", unit_label: "% of labour force", default_transform: "LEVEL"}];
const entities = [{entity_id: "DEU", name: "Germany"}, {entity_id: "FRA", name: "France"}];
const seriesMeta = [
  {series_id: 1, indicator_id: "M09", entity_id: "DEU", frequency: "M", seasonal_adjustment: "SA", price_basis: "current prices", source_name: "Src A", source_url: "https://example.org/a", licence_attribution: "Attribution A", unit_code: "PCT", unit_mult: 0, reestimating: false},
  {series_id: 2, indicator_id: "M09", entity_id: "FRA", frequency: "Q", seasonal_adjustment: "NSA", price_basis: null, source_name: "Src B", source_url: "javascript:alert(1)", licence_attribution: "Attribution B", unit_code: "PCT", unit_mult: 0, reestimating: true}
];
const ctx = explorerContext({manifest, seriesMeta, entities, indicators, alerts: []});
const KNOWN = Date.parse("2026-11-01T04:23:41Z");
const ms = (y, m) => Date.UTC(y, m, 0);
const row = (entity, seriesId, frequency, end, value, status = "OBS") => ({entity, seriesId, end, frequency, value, value_default_tf: value, value_yoy: null, status, knownAt: KNOWN, loadKind: "new_period"});
const rows = [
  row("DEU", 1, "M", ms(2024, 1), 5), row("DEU", 1, "M", ms(2024, 2), 6, "EST"),
  row("FRA", 2, "Q", ms(2024, 3), 7), row("FRA", 2, "Q", ms(2024, 6), 8)
];
const state = (o = {}) => ({entities: ["DEU", "FRA"], transform: "value", from: "", to: "", rebase: false, base: "auto", ...o});
const stubPlot = {plot: (o) => html`<svg data-marks="${o.marks.length}"></svg>`, line: () => ({}), dot: () => ({}), ruleX: () => ({}), ruleY: () => ({}), text: () => ({}), tip: () => ({}), pointer: (o) => o};

test("AC-RD-33: one row per selected series with every C-SER-6 field, as stored", () => {
  const m = buildModel(ctx, "M09", rows, state());
  const r = aboutSeriesRows(m);
  assert.deepEqual(r.map((x) => x.entity), ["FRA", "DEU"]);
  const deu = r.find((x) => x.entity === "DEU");
  assert.deepEqual(
    [deu.country, deu.source, deu.sourceUrl, deu.attribution, deu.frequency, deu.seasonal, deu.priceBasis, deu.lastPeriod, deu.knownAt, deu.reestimated],
    ["Germany", "Src A", "https://example.org/a", "Attribution A", "M", "SA", "current prices", "2024-02", "2026-11-01T04:23Z", false]
  );
  assert.match(deu.unit, /PCT/);
  assert.match(deu.unit, /% of labour force/);
});

test("quarterly series use the pinned period label; unsafe source URL is not a link; missing fields print n/a", () => {
  const fra = aboutSeriesRows(buildModel(ctx, "M09", rows, state())).find((x) => x.entity === "FRA");
  assert.equal(fra.lastPeriod, "2024 Q2");
  assert.equal(fra.sourceUrl, null);
  assert.equal(fra.priceBasis, "n/a");
  assert.equal(fra.reestimated, true);
});

test("table: heading, source link, re-estimated marker only when true, id kept for the smoke tests", () => {
  const m = buildModel(ctx, "M09", rows, state());
  const out = aboutSeriesTable(html, m).s;
  assert.ok(out.includes("<h3>About these series</h3>"));
  assert.ok(out.includes('id="series-captions"'));
  assert.ok(out.includes('<a href="https://example.org/a" rel="noopener">Src A</a>'));
  assert.ok(!out.includes("javascript:"));
  assert.equal(out.match(/re-estimated/g).length, 1, "marker for the one re-estimating series only; the column header differs");
  assert.equal(out.match(/<th scope="col">/g).length, 10);
  assert.equal(aboutSeriesTable(html, buildModel(ctx, "M09", rows, state({entities: []}))), "");
});

test("AC-RD-42: rebased series use the index unit text in the table, title, axis and end labels", () => {
  // A1.5 (plan V13): the rebase runs only for an indicator that stored metadata marks as an index (scale_hint = index, CR-18); this test marks M09 so the code path is exercised.
  const idx = explorerContext({manifest, seriesMeta, entities, indicators: indicators.map((i) => (i.indicator_id === "M09" ? {...i, scale_hint: "index"} : i)), alerts: []});
  const m = buildModel(idx, "M09", rows, state({entities: ["DEU"], rebase: true, base: "2024-01-31"}));
  assert.equal(m.series[0].unit, "index, 2024-01-31 = 100");
  assert.equal(m.yLabel, "index, 2024-01-31 = 100");
  assert.equal(aboutSeriesRows(m)[0].unit, "index, 2024-01-31 = 100");
  const out = explorerBlock(html, stubPlot, m, null, {}).s;
  assert.match(out, /<h3 id="explorer-title">Unemployment rate: Level, rebased to 100 at 2024-01-31 \(index, 2024-01-31 = 100\)<\/h3>/);
});

test("AC-RD-32: the unit is in the title and the View-as-table value header; units never empty", () => {
  const m = buildModel(ctx, "M09", rows, state({entities: ["DEU"]}));
  const out = explorerBlock(html, stubPlot, m, null, {}).s;
  assert.ok(out.includes('<h3 id="explorer-title">Unemployment rate: Level (% of labour force)</h3>'));
  assert.ok(out.includes('<th scope="col" class="mm-num">Value (% of labour force)</th>'));
  assert.equal(shortUnit({indicator: null, series: null, column: "value", rebaseBase: null}), null, "no unit is null, never \"n/a\"");
  assert.equal(shortUnit({indicator: {}, series: {unit_code: "PCT"}, column: "value", rebaseBase: null}), "PCT");
  assert.equal(shortUnit({indicator: indicators[0], series: null, column: "value_yoy", rebaseBase: null}), "%");
  assert.equal(shortUnit({indicator: indicators[0], series: null, column: "value", rebaseBase: "2020-01-31"}), "index, 2020-01-31 = 100");
});

// P01-like: the indicator's unit_label describes the level ("% y/y"), the default transform is M3M3_ANN, whose unit is not stored (CR-6).
const p01 = {indicator_id: "P01", name: "Consumer prices", unit_label: "% y/y", default_transform: "M3M3_ANN", transform_options: ["LEVEL", {id: "M3M3_ANN", label: "3m on 3m, annualised"}]};
const p01Ctx = explorerContext({manifest: {files: [{path: "series/P01.parquet", format: "parquet", bytes: 1, rows: 2}]}, seriesMeta: [{...seriesMeta[0], series_id: 9, indicator_id: "P01", seasonal_adjustment: "SA"}], entities, indicators: [p01], alerts: []});
const p01Rows = [row("DEU", 9, "M", ms(2024, 1), 2.5), row("DEU", 9, "M", ms(2024, 2), 2.7)].map((r) => ({...r, value_default_tf: r.value + 0.1}));

test("AC-RD-32: a transformed column never takes the level's unit_label; title, axis, end label, tip, reader and table agree", () => {
  assert.equal(shortUnit({indicator: p01, series: null, column: "value_default_tf", rebaseBase: null}), "3m on 3m, annualised");
  assert.equal(shortUnit({indicator: {...p01, transform_options: ["M3M3_ANN"]}, series: null, column: "value_default_tf", rebaseBase: null}), "M3M3_ANN");
  assert.equal(shortUnit({indicator: p01, series: null, column: "value", rebaseBase: null}), "% y/y");
  assert.equal(shortUnit({indicator: indicators[0], series: null, column: "value_default_tf", rebaseBase: null}), "% of labour force", "a LEVEL default is the level");
  const m = buildModel(p01Ctx, "P01", p01Rows, {...state({entities: ["DEU"]}), transform: "value_default_tf"});
  assert.equal(m.series[0].unit, "3m on 3m, annualised");
  assert.equal(m.titleUnit, "3m on 3m, annualised");
  assert.ok(!m.yLabel.includes("% y/y") && m.yLabel.includes("3m on 3m, annualised"), m.yLabel);
  assert.ok(!m.captions[0].unit.includes("% y/y") && m.captions[0].unit.includes("3m on 3m, annualised"));
  assert.equal(aboutSeriesRows(m)[0].unit, m.captions[0].unit);
  const out = explorerBlock(html, stubPlot, m, null, {}).s;
  assert.ok(!out.includes("% y/y"), "the level's unit appears nowhere for the transformed column");
  assert.ok(out.includes("Value (3m on 3m, annualised)</th>") && out.includes("(3m on 3m, annualised)</h3>"));
  assert.ok(seriesTipLines({ms: ms(2024, 2), text: "2.8", status: "OBS", knownAt: KNOWN}, m.series[0])[2] === "2.8 3m on 3m, annualised");
  const level = buildModel(p01Ctx, "P01", p01Rows, state({entities: ["DEU"]}));
  assert.equal(level.series[0].unit, "% y/y");
});

test("AC-RD-42: PG-SERIES with no stored unit states the defect in title, axis, label, tip, table and About table; nothing throws", () => {
  const bare = {indicator_id: "M09", name: "Unemployment rate", default_transform: "LEVEL"};
  const c = explorerContext({manifest, seriesMeta: seriesMeta.map((s) => ({...s, unit_code: null})), entities, indicators: [bare], alerts: []});
  const m = buildModel(c, "M09", rows, state({entities: ["DEU"]}));
  const stated = "This export holds no unit for this value.";
  assert.equal(m.series[0].unit, null);
  assert.ok(m.yLabel.includes(stated) && m.titleUnit === stated && m.captions[0].unit === stated);
  const out = explorerBlock(html, stubPlot, m, null, {}).s;
  assert.ok(out.includes(`Unemployment rate: Level (${stated})`));
  assert.equal(tableRowsOf(m)[0].unit, null);
  assert.ok(/<td class="mm-num">[0-9.]+( e)? This export holds no unit for this value\.<\/td>/.test(out) && !/<td class="mm-num">[0-9.]+( e)?<\/td>/.test(out), "value kept, never bare");
  assert.equal(seriesTipLines({ms: ms(2024, 2), text: "6", status: "OBS", knownAt: KNOWN}, m.series[0])[2], `6 ${stated}`);
  assert.ok(out.includes(`<td>${stated}</td>`), "About table unit cell");
});

test("View as table: with differing units the header is plain and each cell carries its unit", () => {
  const rs = [{entity: "A", name: "A", date: "2024-01-31", valueText: "1", unit: "u1", status: "OBS"}, {entity: "B", name: "B", date: "2024-01-31", valueText: "2", unit: "u2", status: "OBS"}];
  const out = viewAsTable(html, {id: "t", title: "x", rows: rs}).s;
  assert.ok(out.includes(">Value</th>") && out.includes('<td class="mm-num">1 u1</td>') && out.includes('<td class="mm-num">2 u2</td>'));
  const same = viewAsTable(html, {id: "t", title: "x", rows: rs, valueUnit: "u"}).s;
  assert.ok(same.includes(">Value (u)</th>") && same.includes('<td class="mm-num">1</td>'));
  const m = buildModel(ctx, "M09", rows, state());
  assert.equal(uniformUnit(m), "% of labour force");
});

test("AC-RD-45: EST and PROV get the e mark beside the value in the table rows and the end label text; OBS does not", () => {
  assert.equal(isEstimateStatus("EST"), true);
  assert.equal(isEstimateStatus("PROV"), true);
  assert.equal(isEstimateStatus("OBS"), false);
  assert.equal(isEstimateStatus(null), false);
  assert.equal(markedValue("6", "EST"), "6 e");
  assert.equal(markedValue("6", "OBS"), "6");
  const m = buildModel(ctx, "M09", rows, state({entities: ["DEU"]}));
  assert.deepEqual(tableRowsOf({...m, title: "t"}).map((r) => r.valueText), ["5", "6 e"]);
});

test("series-meta.js computes nothing and is a pure view helper (static scan)", () => {
  const src = readFileSync(new URL("../src/lib/series-meta.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/Math\.|\.reduce\(|percentile|rank/i.test(src));
  assert.ok(!/FileAttachment|https?:\/\//.test(src));
  assert.ok(!/PROJ/.test(src), "no projection element (AC-RD-44)");
});
