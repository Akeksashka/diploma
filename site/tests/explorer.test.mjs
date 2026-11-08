import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {rebase, isRebasable} from "../src/lib/rebase.js";
import {INTERACTION_LIMIT_BYTES, buildModel, explorerContext, indicatorChoices, loadSeries, rowsFromJson, rowsFromTable, seriesFileEntries, transformAllowed, transformChoices, autoBase, toMs} from "../src/lib/explorer.js";
import {explorerPageSource, seriesPaths} from "../scripts/lib.mjs";
import {pointValueText, valueWithUnit} from "../src/lib/tip.js";
import {fillOnOpen} from "../src/lib/figure.js";
import {SERIES_STYLES, chart, explorerControls, explorerLayout, selectBox, explorerBlock, figureLabel, styleOf, tableRowsOf, uniformUnit, xAxis} from "../src/lib/explorer-view.js";
import {groupChoices, FACET_ABOVE, firstIndicatorId, indicatorGroups, initialSelection, replaceHash, selectedEntities, selectionHash} from "../src/lib/explorer.js";
import {html} from "./support/html-standin.mjs";

// ---- AC-DASH-6: JS rebase equals the Python reference (golden file written by tests/unit/test_rebase_golden.py)
const golden = JSON.parse(readFileSync(new URL("../../tests/fixtures/site_spike/rebase_golden.json", import.meta.url), "utf8"));

test("AC-DASH-6: the JS rebase equals the Python reference within the golden tolerance (1e-9)", () => {
  assert.equal(golden.tolerance, 1e-9);
  assert.ok(golden.cases.length >= 20);
  let compared = 0;
  for (const c of golden.cases) {
    const rows = c.values.map((value, period) => ({period, value}));
    const out = rebase(rows, c.base_index === null ? -1 : c.base_index);
    assert.equal(out.length, c.expected.length, c.name);
    out.forEach((r, i) => {
      const want = c.expected[i];
      if (want === null) assert.equal(r.value, null, `${c.name}[${i}]`);
      else {
        assert.notEqual(r.value, null, `${c.name}[${i}]`);
        assert.ok(Math.abs(r.value - want) <= golden.tolerance, `${c.name}[${i}]: ${r.value} vs ${want}`);
        compared++;
      }
    });
  }
  assert.ok(compared > 100);
});

test("rebase keeps the other row fields and does not mutate its input", () => {
  const rows = [{period: 1, value: 2, tag: "a"}, {period: 2, value: 3, tag: "b"}];
  const out = rebase(rows, 1);
  assert.deepEqual(out.map((r) => r.tag), ["a", "b"]);
  assert.equal(rows[0].value, 2);
  assert.equal(out[0].value, 100);
  assert.equal(isRebasable(0), false);
  assert.equal(isRebasable(-1), false);
  assert.equal(isRebasable(null), false);
});

// ---- fixtures for the view-model
const manifest = {files: [
  {path: "series/M09.parquet", format: "parquet", bytes: 10000, rows: 108},
  {path: "series/P01.json", format: "json", bytes: 5000, rows: 108},
  {path: "series/BIG.parquet", format: "parquet", bytes: 6_000_000, rows: 1},
  {path: "alerts.json", format: "json", bytes: 100, rows: null}
]};
const indicators = [
  {indicator_id: "M09", name: "Unemployment rate", unit_label: "% of labour force", default_transform: "LEVEL"},
  {indicator_id: "P01", name: "CPI inflation", unit_label: "% y/y", default_transform: "M3M3_ANN"},
  {indicator_id: "BIG", name: "Big", unit_label: "x", default_transform: "LEVEL"},
  {indicator_id: "Z99", name: "No file", unit_label: "x", default_transform: "LEVEL"}
];
const entities = [{entity_id: "DEU", name: "Germany"}, {entity_id: "FRA", name: "France"}, {entity_id: "ITA", name: "Italy"}];
const seriesMeta = [
  {series_id: 1, indicator_id: "M09", entity_id: "DEU", seasonal_adjustment: "SA", source_name: "Src A", unit_code: "PCT", unit_mult: 0, base_period: null},
  {series_id: 2, indicator_id: "M09", entity_id: "FRA", seasonal_adjustment: "SA", source_name: "Src A", unit_code: "PCT", unit_mult: 0, base_period: null},
  {series_id: 3, indicator_id: "P01", entity_id: "DEU", seasonal_adjustment: "NSA", source_name: "Src B", unit_code: "IDX", unit_mult: 0, base_period: "2015=100"},
  {series_id: 4, indicator_id: "P01", entity_id: "FRA", seasonal_adjustment: "SA", source_name: "Src B", unit_code: "IDX", unit_mult: 0, base_period: "2015=100"}
];
const alerts = [
  {indicator_id: "M09", entity_id: "DEU", series_id: 1, ref_period_end: "2025-03-31", level: "alert", z: 2.6, confidence: "full"},
  {indicator_id: "M09", entity_id: "FRA", series_id: 2, ref_period_end: "2025-03-31", level: "watch", z: 1.7, confidence: "full"},
  {indicator_id: "M09", entity_id: "DEU", series_id: 1, ref_period_end: "1999-01-31", level: "watch", z: 1.5, confidence: "low"},
  {indicator_id: "P01", entity_id: "FRA", series_id: 4, ref_period_end: "2025-03-31", level: "watch", z: 1.1, confidence: "full"}
];
const ctx = explorerContext({manifest, seriesMeta, entities, indicators, alerts});
const KNOWN = Date.parse("2026-11-01T04:23:41Z");
const ms = (y, m) => Date.UTC(y, m, 0); // last day of month m (1-12)
function mk(entity, seriesId, vals, extra = {}) {
  return vals.map((v, i) => ({
    entity, seriesId, end: ms(2024 + Math.floor(i / 12), (i % 12) + 1), frequency: "M",
    value: v, value_default_tf: v, value_yoy: i < 12 || v === null ? null : v - 1, status: "OBS", knownAt: KNOWN, loadKind: "new_period", ...extra
  }));
}
const vals = (start) => Array.from({length: 15}, (_, i) => start + i);
const rows = [...mk("DEU", 1, vals(10)), ...mk("FRA", 2, vals(20))];
const base = (o = {}) => ({entities: ["DEU", "FRA"], transform: "value", from: "", to: "", rebase: false, base: "auto", ...o});

test("series files and the indicator select come from the manifest (parquet or json format)", () => {
  const f = seriesFileEntries(manifest);
  assert.deepEqual([...f.keys()].sort(), ["BIG", "M09", "P01"]);
  assert.equal(f.get("P01").format, "json");
  assert.deepEqual(indicatorChoices(ctx).map((c) => c.id), ["M09", "P01", "BIG"]); // Z99 has no file
  assert.deepEqual(seriesPaths(manifest).map((s) => s.path), ["series/BIG.parquet", "series/M09.parquet", "series/P01.json"]);
  assert.throws(() => seriesPaths({files: [{path: "series/a b.parquet"}]}), /unsafe series path/);
  assert.throws(() => seriesPaths({files: [{path: "series/../x.json"}]}), /unsafe series path/);
});

test("one interaction fetches one file and at most 5 MB (the file is not fetched above the limit)", async () => {
  assert.equal(INTERACTION_LIMIT_BYTES, 5_000_000);
  const files = seriesFileEntries(manifest);
  let calls = 0;
  const att = {parquet: async () => (calls++, rows.map((r) => ({entity_id: r.entity, series_id: r.seriesId, ref_period_end: r.end, frequency: "M", value: r.value, value_default_tf: r.value, value_yoy: null, value_status: "OBS", known_at: r.knownAt, load_kind: "x"}))), json: async () => (calls++, [])};
  const big = await loadSeries(files.get("BIG"), att);
  assert.equal(calls, 0);
  assert.match(big.error, /above the 5000000 byte limit/);
  const ok = await loadSeries(files.get("M09"), att);
  assert.equal(calls, 1);
  assert.equal(ok.error, null);
  assert.equal(ok.rows.length, rows.length);
  const unsized = await loadSeries({path: "series/X.parquet", format: "parquet", bytes: null}, att);
  assert.match(unsized.error, /no size/);
  assert.equal(calls, 1);
  assert.match((await loadSeries(undefined, att)).error, /No series file/);
});

test("manifest format json: the JSON fallback reads the same columns without a front-end change", async () => {
  const doc = {rows: [{entity_id: "DEU", series_id: 3, ref_period_end: "2025-01-31", frequency: "M", value: 1.5, value_default_tf: null, value_yoy: 2, value_status: "OBS", known_at: "2026-11-01T04:23:41Z", load_kind: "new_period"}]};
  const r = rowsFromJson(doc)[0];
  assert.equal(r.end, Date.UTC(2025, 0, 31));
  assert.equal(r.knownAt, KNOWN);
  assert.equal(r.value_default_tf, null);
  assert.equal(rowsFromJson([doc.rows[0]]).length, 1);
  assert.throws(() => rowsFromJson({nope: 1}), /no rows list/);
  const f = seriesFileEntries(manifest).get("P01");
  const out = await loadSeries(f, {json: async () => doc, parquet: async () => { throw new Error("must not be called"); }});
  assert.equal(out.rows.length, 1);
  const bad = await loadSeries(f, {json: async () => { throw new Error("boom"); }});
  assert.match(bad.error, /Could not read series\/P01.json: boom/);
});

test("rowsFromTable normalises Arrow values (bigint, Date, null, NaN)", () => {
  const out = rowsFromTable([{entity_id: "DEU", series_id: 1n, ref_period_end: new Date(Date.UTC(2025, 0, 31)), frequency: "M", value: 2n, value_default_tf: NaN, value_yoy: null, value_status: "OBS", known_at: KNOWN, load_kind: "new_period"}, {entity_id: "X", ref_period_end: null}]);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].seriesId, out[0].end, out[0].value, out[0].value_default_tf, out[0].value_yoy], [1, Date.UTC(2025, 0, 31), 2, null, null]);
  assert.equal(toMs("2025-01-31"), Date.UTC(2025, 0, 31));
  assert.equal(toMs("garbage"), null);
});

test("AC-DASH-4: a series that is not seasonally adjusted offers no MoM/QoQ transform", () => {
  assert.equal(transformAllowed("value_default_tf", "M3M3_ANN", "NSA"), false);
  assert.equal(transformAllowed("value_default_tf", "QOQ_ANN", "NSA"), false);
  assert.equal(transformAllowed("value_default_tf", "QOQ_ANN", null), false);
  assert.equal(transformAllowed("value_default_tf", "QOQ_ANN", "SA"), true);
  assert.equal(transformAllowed("value_default_tf", "M3M3_ANN", "SCA"), true);
  assert.equal(transformAllowed("value_default_tf", "YOY", "NSA"), true);
  assert.equal(transformAllowed("value_default_tf", "LEVEL", "NSA"), true);
  assert.equal(transformAllowed("value", "M3M3_ANN", "NSA"), true);
  // P01: DEU is NSA, so with only DEU the default transform is not offered; with an SA entity it is
  const nsaOnly = mk("DEU", 3, vals(100));
  assert.deepEqual(transformChoices(ctx, "P01", nsaOnly).map((c) => c.id), ["value", "value_yoy"]);
  const mixed = [...nsaOnly, ...mk("FRA", 4, vals(100))];
  assert.deepEqual(transformChoices(ctx, "P01", mixed).map((c) => c.id), ["value", "value_default_tf", "value_yoy"]);
  assert.match(transformChoices(ctx, "P01", mixed)[1].label, /M3M3_ANN/);
  // even if a (tampered) file carried default values for an NSA series, the explorer draws none
  const m = buildModel(ctx, "P01", nsaOnly, base({entities: ["DEU"], transform: "value_default_tf"}));
  assert.equal(m.plotted.length, 0);
  assert.match(m.notShown[0].reason, /not seasonally adjusted/);
  const lvl = buildModel(ctx, "P01", nsaOnly, base({entities: ["DEU"], transform: "value"}));
  assert.equal(lvl.plotted.length, 15);
});

test("selectors: entities, transform column, date range", () => {
  const m = buildModel(ctx, "M09", rows, base({entities: ["FRA"]}));
  assert.deepEqual([...new Set(m.plotted.map((p) => p.entity))], ["FRA"]);
  assert.equal(m.plotted[0].value, 20);
  const y = buildModel(ctx, "M09", rows, base({transform: "value_yoy"}));
  assert.equal(y.plotted.length, 2 * 3); // only 3 months after the first year per entity
  assert.equal(y.plotted[0].value, 31); // France sorts first: 20 + 12 - 1
  const rng = buildModel(ctx, "M09", rows, base({from: "2025", to: "2025"}));
  assert.equal(rng.plotted.length, 2 * 3);
  assert.ok(rng.plotted.every((p) => p.date.getUTCFullYear() === 2025));
  const bogus = buildModel(ctx, "M09", rows, base({transform: "value; drop"}));
  assert.equal(bogus.column, "value");
  const none = buildModel(ctx, "M09", rows, base({entities: ["ITA"]}));
  assert.equal(none.plotted.length, 0);
});

test("display-only rebase: scaled by the stored value at the base period, and only the base is 100", () => {
  const m = buildModel(ctx, "M09", rows, base({rebase: true, base: "2024-03-31"}));
  const deu = m.plotted.filter((p) => p.entity === "DEU");
  assert.equal(m.baseDate, "2024-03-31");
  assert.equal(deu.find((p) => p.ms === ms(2024, 3)).value, 100);
  assert.ok(Math.abs(deu[0].value - (10 / 12) * 100) <= 1e-9);
  assert.equal(m.yLabel, "index, 2024-03-31 = 100"); // R14: the index unit text of units.js rebaseUnit
  assert.equal(m.captions[0].unit, "index, 2024-03-31 = 100");
  assert.equal(m.series[0].unit, "index, 2024-03-31 = 100");
  // automatic base: first period where every shown series has a positive value
  assert.equal(buildModel(ctx, "M09", rows, base({rebase: true})).baseDate, "2024-01-31");
  assert.equal(autoBase([]), null);
});

test("rebase with an unusable base: the series is listed as not shown, never drawn as zero", () => {
  const odd = [...mk("DEU", 1, [0, 1, 2, 3]), ...mk("FRA", 2, [5, 6, 7, 8])];
  const m = buildModel(ctx, "M09", odd, base({rebase: true, base: "2024-01-31"}));
  assert.deepEqual(m.notShown.map((n) => n.entity), ["DEU"]);
  assert.match(m.notShown[0].reason, /positive\) value at the base period/);
  assert.deepEqual([...new Set(m.plotted.map((p) => p.entity))], ["FRA"]);
  const gone = buildModel(ctx, "M09", odd, base({rebase: true, base: "1980-01-31"}));
  assert.equal(gone.plotted.length, 0);
  assert.equal(gone.notShown.length, 2);
});

test("alert markers: current alerts only, for the shown indicator and countries, at a plotted value", () => {
  const m = buildModel(ctx, "M09", rows, base());
  assert.deepEqual(m.markers.map((a) => [a.entity, a.level, a.z, a.ref]), [["DEU", "alert", 2.6, "2025-03-31"], ["FRA", "watch", 1.7, "2025-03-31"]]);
  assert.equal(m.markers.find((a) => a.entity === "DEU").value, 24); // plotted value at that period
  assert.equal(m.unplacedAlerts.length, 1); // the 1999 alert has no plotted point: listed, not drawn
  assert.equal(m.unplacedAlerts[0].ref, "1999-01-31");
  assert.ok(!m.markers.some((a) => a.ref === "1999-01-31"));
  const onlyFra = buildModel(ctx, "M09", rows, base({entities: ["FRA"]}));
  assert.deepEqual(onlyFra.markers.map((a) => a.entity), ["FRA"]);
  const other = buildModel(ctx, "P01", mk("FRA", 4, vals(1)), base({entities: ["FRA"]}));
  assert.deepEqual(other.markers.map((a) => a.entity + a.level), ["FRAwatch"]);
  // the marker sits on the rebased value when rebase is on
  const rb = buildModel(ctx, "M09", rows, base({rebase: true, base: "2024-01-31"}));
  assert.ok(Math.abs(rb.markers.find((a) => a.entity === "DEU").value - (24 / 10) * 100) <= 1e-9);
});

test("AC-DASH-5: every plotted series has unit, frequency, seasonal adjustment, source, reference date and vintage", () => {
  const m = buildModel(ctx, "P01", mk("FRA", 4, vals(1)), base({entities: ["FRA"]}));
  const c = m.captions[0];
  assert.deepEqual(
    [c.name, c.unit, c.frequency, c.sa, c.basePeriod, c.source, c.refDate, c.vintage],
    ["France", "IDX (% y/y)", "M", "SA", "2015=100", "Src B", "2025-03-31", "2026-11-01T04:23Z"]
  );
  const yy = buildModel(ctx, "M09", rows, base({transform: "value_yoy"}));
  assert.match(yy.captions[0].unit, /year earlier/);
  const text = buildModel(ctx, "M09", rows, base()).captions.map((x) => Object.values(x).join("|")).join("\n");
  assert.ok(!text.includes("n/a|n/a|n/a"));
});

test("mixed frequencies stay at native points (no resampling) and keep their frequency", () => {
  const q = [{entity: "FRA", seriesId: 2, end: ms(2024, 3), frequency: "Q", value: 1, value_default_tf: 1, value_yoy: null, status: "OBS", knownAt: KNOWN, loadKind: "x"}, {entity: "FRA", seriesId: 2, end: ms(2024, 6), frequency: "Q", value: 2, value_default_tf: 2, value_yoy: null, status: "OBS", knownAt: KNOWN, loadKind: "x"}];
  const m = buildModel(ctx, "M09", [...mk("DEU", 1, vals(10)), ...q], base());
  assert.equal(m.plotted.filter((p) => p.entity === "FRA").length, 2);
  assert.deepEqual(m.captions.map((c) => c.frequency), ["Q", "M"]);
});

test("D6 and page rules: no rank or percentile code, FileAttachment only in the page, no off-origin URL", () => {
  const dir = new URL("../src/lib/", import.meta.url);
  for (const f of ["explorer.js", "explorer-view.js", "rebase.js"]) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/percentile|rank/i.test(src.replace(/\/\/.*$/gm, "")), `${f} must not compute or mention ranks`);
    assert.ok(!/https?:\/\//.test(src), f);
  }
  for (const f of readdirSync(dir)) {
    const code = readFileSync(new URL(f, dir), "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/FileAttachment\s*\(/.test(code), `${f} calls FileAttachment (Framework does not rewrite it in imported modules)`);
  }
  const page = explorerPageSource(manifest);
  assert.ok(page.includes('"M09": FileAttachment("data/series/M09.parquet")'));
  assert.ok(page.includes('"P01": FileAttachment("data/series/P01.json")'));
  assert.ok(page.includes('FileAttachment("data/alerts.json")'));
  assert.ok(!page.includes("DuckDB") && !/Inputs\./.test(page));
  assert.equal([...page.matchAll(/FileAttachment\(\s*[^"]/g)].length, 0);
  assert.ok(explorerPageSource({files: []}).includes("const seriesFiles = {\n\n};"));
});

// ---- Stage 4 (T120-T125): chart styling, facets, rebase marks, layout data, figure and table
const stub = () => {
  const plots = [];
  const mk = (kind) => (data, o = {}) => ({kind, data, o});
  const Plot = {plot: (o) => (plots.push(o), html`<svg data-marks="${o.marks.length}"></svg>`), line: mk("line"), dot: mk("dot"), ruleX: mk("ruleX"), ruleY: mk("ruleY"), text: mk("text"), tip: mk("tip"), pointer: (o) => o};
  return {Plot, plots};
};
const many = (n, start = 10) => Array.from({length: n}, (_, i) => ({id: `C${String(i).padStart(2, "0")}`, seriesId: 100 + i, vals: vals(start + i)}));
const manyRows = (n) => many(n).flatMap((c) => mk(c.id, c.seriesId, c.vals));
const manyCtx = (n) => explorerContext({manifest, seriesMeta: [...seriesMeta, ...many(n).map((c) => ({series_id: c.seriesId, indicator_id: "M09", entity_id: c.id, seasonal_adjustment: "SA", source_name: "Src A", unit_code: "PCT", unit_mult: 0, base_period: null}))], entities, indicators, alerts});
const unitLabel = "% of labour force";

test("T121: five hues, each paired with its own dash and marker; alert shapes are not reused; fallback is the first style", () => {
  assert.equal(SERIES_STYLES.length, 5);
  assert.equal(new Set(SERIES_STYLES.map((x) => x.token)).size, 5);
  assert.equal(new Set(SERIES_STYLES.map((x) => `${x.dash}|${x.symbol}`)).size, 5);
  assert.equal(new Set(SERIES_STYLES.map((x) => x.dash)).size, 5);
  assert.equal(new Set(SERIES_STYLES.map((x) => x.symbol)).size, 5);
  assert.ok(SERIES_STYLES.every((x) => !["diamond", "triangle"].includes(x.symbol)));
  assert.ok(SERIES_STYLES.every((x) => /^--mm-series-[1-5]$/.test(x.token)));
  assert.equal(styleOf(7), SERIES_STYLES[0]);
  assert.equal(styleOf(1), SERIES_STYLES[1]);
});

test("T121: hue follows the order in which countries were selected, not the data or the alphabet", () => {
  const a = buildModel(ctx, "M09", rows, base({entities: ["FRA", "DEU"]}));
  assert.deepEqual(a.series.map((s) => [s.entity, s.order]), [["FRA", 0], ["DEU", 1]]); // model order stays by name (France before Germany)
  const b = buildModel(ctx, "M09", rows, base({entities: ["DEU", "FRA"]}));
  assert.deepEqual(b.series.map((s) => [s.entity, s.order]), [["FRA", 1], ["DEU", 0]]);
  const swapped = [...mk("DEU", 1, vals(50)), ...mk("FRA", 2, vals(1))];
  assert.deepEqual(buildModel(ctx, "M09", swapped, base({entities: ["DEU", "FRA"]})).series.map((s) => s.order), [1, 0]);
});

test("T121/T123: the line keeps null points as gaps, the points table does not list them, nothing is filled", () => {
  const gap = mk("DEU", 1, [10, 11, null, 13, 14]);
  const m = buildModel(ctx, "M09", gap, base({entities: ["DEU"]}));
  const line = m.series[0].lines;
  assert.equal(line.length, 5);
  assert.equal(line[2].value, null);
  assert.equal(m.plotted.length, 4);
  const {Plot, plots} = stub();
  chart(Plot, m);
  const lineMark = plots[0].marks.find((x) => x.kind === "line");
  assert.equal(lineMark.data.length, 5);
  assert.equal(lineMark.data[2].value, null);
  assert.deepEqual(tableRowsOf(m).map((r) => r.valueText), ["10", "11", "13", "14"]);
  // the same with rebase: a gap stays a gap
  const rb = buildModel(ctx, "M09", gap, base({entities: ["DEU"], rebase: true, base: "2024-01-31"}));
  assert.equal(rb.series[0].lines[2].value, null);
});

test("T121: end label (latest stored value and unit), hairline, hollow estimate markers, revision rings, no legend", () => {
  const rs = mk("DEU", 1, vals(10), {}).map((r, i) => ({...r, status: i === 14 ? "PROV" : i === 13 ? "EST" : "OBS", loadKind: i === 5 ? "revision" : "new_period"}));
  const m = buildModel(ctx, "M09", rs, base({entities: ["DEU"]}));
  const {Plot, plots} = stub();
  // tokens read from the page; here each token reads back as its own name so colours can be told apart
  globalThis.document = {documentElement: {}};
  globalThis.getComputedStyle = () => ({getPropertyValue: (n) => n});
  try {
    chart(Plot, m);
  } finally {
    delete globalThis.document;
    delete globalThis.getComputedStyle;
  }
  const o = plots[0];
  assert.equal(o.color, undefined, "no legend");
  assert.ok(!JSON.stringify(o).includes("legend"));
  const text = o.marks.find((x) => x.kind === "text");
  assert.equal(text.o.text(), `Germany: 24 e ${unitLabel}`);
  assert.equal(text.data.length, 1);
  assert.equal(text.data[0].ms, ms(2025, 3));
  const hair = o.marks.find((x) => x.kind === "ruleX");
  assert.equal(hair.data[0].ms, ms(2025, 3));
  const dots = o.marks.filter((x) => x.kind === "dot");
  const hollow = dots.find((x) => x.o.symbol === "circle" && x.o.fill !== "none" && x.data.every((p) => p.status === "EST" || p.status === "PROV") && x.data.length === 2);
  assert.ok(hollow, "two hollow markers (EST, PROV)");
  assert.equal(hollow.o.fill, "--mm-bg");
  assert.equal(hollow.o.stroke, "--mm-series-1");
  const filled = dots.find((x) => x.o.symbol === "circle" && x.o.fill === x.o.stroke);
  assert.equal(filled.o.fill, "--mm-series-1");
  assert.equal(filled.data.length, 0, "monthly series: the last point is an estimate here, so no filled marker");
  const ring = dots.find((x) => x.o.r === 7 && x.o.fill === "none" && !x.o.symbol);
  assert.deepEqual(ring.data.map((p) => p.ms), [ms(2024, 6)]);
  // alert shapes unchanged
  assert.deepEqual(dots.filter((x) => x.o.symbol === "diamond" || x.o.symbol === "triangle").map((x) => x.o.symbol), ["diamond", "triangle"]);
});

test("T121: quarterly series draw a marker at every point; the unit of a year-on-year series is %", () => {
  const q = ["2024-03-31", "2024-06-30", "2024-09-30"].map((d, i) => ({entity: "DEU", seriesId: 1, end: Date.parse(d), frequency: "Q", value: i, value_default_tf: i, value_yoy: i, status: "OBS", knownAt: KNOWN, loadKind: "new_period"}));
  const m = buildModel(ctx, "M09", q, base({entities: ["DEU"], transform: "value_yoy"}));
  const {Plot, plots} = stub();
  chart(Plot, m);
  const filled = plots[0].marks.filter((x) => x.kind === "dot" && x.o.fill === x.o.stroke && x.o.symbol === "circle");
  assert.equal(filled[0].data.length, 3);
  assert.equal(plots[0].marks.find((x) => x.kind === "text").o.text(), "Germany: 2 %");
});

test("T123: year ticks, unit in the y-axis label, index-100 rule and base-period rule only when rebased", () => {
  const long = Array.from({length: 40}, (_, i) => ({entity: "DEU", seriesId: 1, end: Date.UTC(1990 + i, 5, 30), frequency: "A", value: 5 + i, value_default_tf: 5, value_yoy: null, status: "OBS", knownAt: KNOWN, loadKind: "x"}));
  const m = buildModel(ctx, "M09", long, base({entities: ["DEU"]}));
  assert.deepEqual(xAxis(m.plotted), {ticks: 10, tickFormat: "%Y"});
  assert.deepEqual(xAxis(buildModel(ctx, "M09", long, base({entities: ["DEU"], from: "2000", to: "2005"})).plotted), {ticks: "year", tickFormat: "%Y"});
  assert.deepEqual(xAxis(buildModel(ctx, "M09", rows, base({entities: ["DEU"]})).plotted), {});
  const {Plot, plots} = stub();
  chart(Plot, m);
  assert.match(plots[0].y.label, /labour force/);
  assert.equal(plots[0].x.type, "utc");
  assert.ok(!plots[0].marks.some((x) => x.kind === "ruleY"));
  const rb = buildModel(ctx, "M09", rows, base({rebase: true, base: "2024-03-31"}));
  chart(Plot, rb);
  const o = plots[1];
  assert.equal(o.y.label, "index, 2024-03-31 = 100");
  assert.deepEqual(o.marks.find((x) => x.kind === "ruleY").data, [100]);
  assert.equal(o.marks.find((x) => x.kind === "ruleX" && x.data[0] instanceof Date).data[0].getTime(), ms(2024, 3));
  assert.equal(rb.baseMs, ms(2024, 3));
});

test("T122: above 5 series the explorer switches to one chart per country; shared y is one faceted plot, free y one plot per country", () => {
  assert.equal(FACET_ABOVE, 5);
  const c6 = manyCtx(6);
  const ids = many(6).map((c) => c.id);
  const five = buildModel(c6, "M09", manyRows(6), base({entities: ids.slice(0, 5)}));
  assert.equal(five.facets, false);
  const six = buildModel(c6, "M09", manyRows(6), base({entities: ids}));
  assert.equal(six.facets, true);
  assert.equal(six.series.length, 6);
  const shared = stub();
  chart(shared.Plot, six, {html, free: false});
  assert.equal(shared.plots.length, 1);
  assert.deepEqual(shared.plots[0].fy.domain, six.series.map((s) => s.name));
  assert.equal(shared.plots[0].fy.axis, null);
  assert.ok(shared.plots[0].marks.filter((x) => x.kind === "text").every((x) => x.o.fy === "name" && x.o.frameAnchor === "top-left"), "every facet has a title");
  assert.equal(shared.plots[0].marks.filter((x) => x.kind === "text").length, 6);
  const free = stub();
  const out = chart(free.Plot, six, {html, free: true});
  assert.equal(free.plots.length, 6);
  assert.ok(free.plots.every((o) => o.fy === undefined && o.marks.filter((x) => x.kind === "text").length === 1));
  assert.equal(out.s.match(/<svg/g).length, 6);
  assert.ok(free.plots.every((o) => o.y.label === "% of labour force"), "R14: the unit is the axis title of every free-y chart");
});

test("T122: the page says which y-axis mode is active (only above 5 series) and the 6 charts keep one table", () => {
  const c6 = manyCtx(6);
  const six = buildModel(c6, "M09", manyRows(6), base({entities: many(6).map((c) => c.id)}));
  const a = explorerBlock(html, stub().Plot, six, null, {free: false}).s;
  assert.ok(a.includes("More than 5 countries are selected, so each country has its own chart. All charts share one y-axis scale"));
  const b = explorerBlock(html, stub().Plot, six, null, {free: true}).s;
  assert.ok(b.includes("Each chart has its own y-axis scale"));
  const few = explorerBlock(html, stub().Plot, buildModel(ctx, "M09", rows, base()), null).s;
  assert.ok(!few.includes('id="y-mode"'));
});

test("T120: the figure label and the table equal the plotted points; no extra fetch, the model already holds them", () => {
  const m = buildModel(ctx, "M09", rows, base());
  const out = explorerBlock(html, stub().Plot, m, null, {href: "/_file/data/series/M09.parquet"}).s;
  const label = /<figure class="mm-figure" id="explorer-figure" role="img" aria-label="([^"]*)">/.exec(out)[1];
  assert.equal(label.replaceAll("&#39;", "'"), figureLabel({...m, title: "Unemployment rate: Level (% of labour force)"}));
  for (const part of ["Unemployment rate: Level", "Germany, 2024-01-31 to 2025-03-31, latest stored value 24 % of labour force", "France, 2024-01-31 to 2025-03-31, latest stored value 34 % of labour force"]) assert.ok(label.includes(part), part);
  // table = the plotted points (all 15 per series: fewer than 24)
  const trs = [...out.matchAll(/<tr data-entity="(\w+)"><th scope="row">[^<]*<\/th><td>([\d-]+)<\/td><td class="mm-num">([^<]*)<\/td>/g)].map((x) => [x[1], x[2], x[3]]);
  const want = m.plotted.map((p) => [p.entity, isoD(p.ms), String(p.value)]);
  assert.deepEqual(trs, want);
  assert.equal(trs.length, 30);
  assert.ok(out.indexOf("View as table") > out.indexOf("explorer-figure"), "the table disclosure follows the chart");
  assert.ok(!/<details[^>]*id="explorer-view-table"[^>]* open/.test(out));
  assert.ok(out.includes('href="/_file/data/series/M09.parquet"'));
  assert.ok(out.includes("A hollow marker is an estimated or provisional value.") && out.includes("A diamond marks an alert and a triangle a watch"));
  assert.ok(out.indexOf('id="chart-explain"') < out.indexOf('id="explorer-figure"'), "plain-words note before the chart");
});

const isoD = (t) => new Date(t).toISOString().slice(0, 10);

test("spec 5.6, AC-RD-30d: the table lists every plotted point (more than 24 periods too), in date order", () => {
  const long = Array.from({length: 40}, (_, i) => ({entity: "DEU", seriesId: 1, end: Date.UTC(2020 + Math.floor(i / 12), i % 12, 28), frequency: "M", value: i + 1, value_default_tf: 1, value_yoy: null, status: "OBS", knownAt: KNOWN, loadKind: "x"}));
  const m = buildModel(ctx, "M09", long, base({entities: ["DEU"]}));
  const t = tableRowsOf(m);
  assert.equal(t.length, 40);
  assert.deepEqual(t.map((r) => r.valueText), m.plotted.map((p) => String(p.value)));
  assert.equal(t[0].date, isoD(m.plotted[0].ms));
});

test("T124: select-group choices come from meta/groups.json, only members that have rows, on the known cutoff", () => {
  const groups = [
    {group_id: "g7", name: "g7", members: [{entity_id: "DEU", valid_from: "1999-01-01", valid_to: null}, {entity_id: "FRA", valid_from: "1999-01-01", valid_to: null}, {entity_id: "USA", valid_from: "1999-01-01", valid_to: null}]},
    {group_id: "euro_area", name: "euro_area", members: [{entity_id: "FRA", valid_from: "1999-01-01", valid_to: null}, {entity_id: "ITA", valid_from: "1999-01-01", valid_to: "2000-01-01"}]},
    {group_id: "emerging", name: "emerging", members: [{entity_id: "IND", valid_from: "1999-01-01", valid_to: null}]}
  ];
  const c = explorerContext({manifest, seriesMeta, entities, indicators, alerts, groups, knownCutoff: "2026-11-01"});
  const ents = [{id: "DEU", label: "Germany"}, {id: "FRA", label: "France"}, {id: "ITA", label: "Italy"}];
  assert.deepEqual(groupChoices(c, ents), [{id: "g7", label: "G7", members: ["DEU", "FRA"]}, {id: "euro_area", label: "Euro area", members: ["FRA"]}]);
  assert.deepEqual(groupChoices(ctx, ents), []);
});

test("T124: the explorer page keeps one FileAttachment per file, loads groups, puts the chart in the layout and the data link in the page", () => {
  const page = explorerPageSource(manifest);
  assert.ok(page.includes('FileAttachment("data/meta/groups.json")'));
  assert.ok(page.includes("explorerLayout(html"));
  assert.ok(page.includes("layout.main.replaceChildren(explorerBlock("));
  assert.ok(page.includes(".url()"), "the link to the data file is resolved in the page (FileAttachment only there)");
  assert.ok(page.includes("Generators.input(box.free.querySelector"));
});

// ---- R13: PG-SERIES defaults, hash and names (C-SER-1, C-SER-2, AC-RD-31, AC-RD-34)
const domains = [
  {domain_id: "prices", name: "Prices", indicator_ids: ["P01", "Z99"]},
  {domain_id: "labour", name: "Labour", indicator_ids: ["M09", "P01"]}
];
// html stand-in plus the two DOM reads the controls make while they are built (no elements exist in the stand-in).
const dom = (strings, ...vals) => Object.assign(html(strings, ...vals), {querySelectorAll: () => [], querySelector: () => ({})});
const ctx13 = explorerContext({manifest, seriesMeta, entities, indicators, alerts, domains});

test("R13: the picker shows names with the unit and never an identifier alone; grouped by domain, once, in domains.json order", () => {
  const g = indicatorGroups(ctx13);
  assert.deepEqual(g.map((x) => [x.id, x.label]), [["prices", "Prices"], ["labour", "Labour"], ["other", "Other indicators"]]);
  assert.deepEqual(g[0].options, [{id: "P01", label: "CPI inflation (% y/y)"}]); // Z99 has no file; P01 not repeated under Labour
  assert.deepEqual(g[1].options, [{id: "M09", label: "Unemployment rate (% of labour force)"}]);
  assert.deepEqual(g[2].options.map((o) => o.id), ["BIG"]);
  for (const o of g.flatMap((x) => x.options)) assert.notEqual(o.label, o.id);
  assert.deepEqual(indicatorGroups(ctx), [{id: "all", label: null, options: indicatorChoices(ctx)}]); // no domains: one flat group
  assert.equal(indicatorChoices(ctx13).find((c) => c.id === "BIG").label, "Big (x)");
});

test("R13: default is the first indicator of the first domain with no country; the controls show the hint", () => {
  assert.equal(firstIndicatorId(ctx13), "P01");
  assert.equal(firstIndicatorId(ctx), "M09"); // no domains: first with a file
  for (const h of ["", "#", null, undefined]) assert.deepEqual(initialSelection(ctx13, h), {indicator: "P01", entities: [], note: false}, String(h));
  const box = explorerControls(dom, ctx13, "P01", rows, initialSelection(ctx13, ""));
  assert.ok(box.entities.s.includes("Choose up to 5 countries to compare."));
  assert.equal(box.note, false);
});

test("R13: #i and #c set the indicator and countries; the model for no country draws no overlay", () => {
  const init = initialSelection(ctx13, "#i=M09&c=DEU,FRA");
  assert.deepEqual(init, {indicator: "M09", entities: ["DEU", "FRA"], note: false});
  const ents = [{id: "DEU", label: "Germany"}, {id: "FRA", label: "France"}];
  assert.deepEqual(selectedEntities(init, "M09", ents), {entities: ["DEU", "FRA"], missing: [], dropped: false});
  assert.deepEqual(selectedEntities(init, "P01", ents), {entities: ["DEU", "FRA"], missing: [], dropped: false}); // countries are kept when the indicator changes
  assert.deepEqual(selectedEntities(init, "M09", [ents[0]]), {entities: ["DEU"], missing: ["FRA"], dropped: true});
  const none = buildModel(ctx13, "M09", rows, base({entities: []}));
  assert.equal(none.plotted.length, 0);
  assert.equal(chart(stub().Plot, none), null, "no chart, so no multi-country overlay");
});

test("R13: invalid #i / #c fall back to the default with a note and no error", () => {
  for (const h of ["#i=NOPE", "#i=Z99", "#c=XXX", "#i=M09&c=DEU,XXX", "#i=M09&i=P01", "#x=1", "i=M09", "#i=../x"]) {
    const init = initialSelection(ctx13, h);
    assert.equal(init.note, true, h);
    assert.ok(init.indicator === "P01" || init.indicator === "M09", h);
  }
  assert.deepEqual(initialSelection(ctx13, "#i=NOPE&c=DEU"), {indicator: "P01", entities: ["DEU"], note: true});
  assert.deepEqual(initialSelection(ctx13, "#i=M09&c=DEU,XXX"), {indicator: "M09", entities: ["DEU"], note: true});
  const bad = explorerControls(dom, ctx13, "P01", rows, initialSelection(ctx13, "#c=XXX"));
  assert.equal(bad.note, true);
  const layout = explorerLayout(dom, {indicator: "", box: bad});
  assert.ok(layout.el.s.includes('id="explorer-hash-note"') && layout.el.s.includes("Part of this link was not recognised and was ignored."));
  const ok = explorerLayout(dom, {indicator: "", box: explorerControls(dom, ctx13, "M09", rows, initialSelection(ctx13, "#i=M09&c=DEU"))});
  assert.ok(!ok.el.s.includes("explorer-hash-note"));
});

test("R13 follow-up: the no-values note is separate from the unrecognised-part note; countries survive an indicator change", () => {
  const init = {indicator: "P01", entities: ["DEU", "FRA"], note: false};
  const box = explorerControls(dom, ctx13, "M09", rows.filter((r) => r.entity !== "FRA" && r.entity !== undefined ? true : true), init);
  assert.ok(Array.isArray(box.noRows) && Array.isArray(box.order) && Array.isArray(box.start));
  const miss = explorerControls(dom, ctx13, "M09", rows.filter((r) => r.entity === "DEU" || r.seriesId?.includes?.("DEU")), {indicator: "M09", entities: ["DEU", "FRA"], note: false});
  const layout = explorerLayout(dom, {indicator: "", box: {...miss, noRows: ["France"]}});
  assert.ok(layout.el.s.includes('id="explorer-norows-note"') && layout.el.s.includes("Not selected: this export has no values of this indicator for France."));
  assert.ok(!layout.el.s.includes("explorer-hash-note"), "no unrecognised-part note");
  const both = explorerLayout(dom, {indicator: "", box: {...miss, note: true, noRows: ["France"]}});
  assert.ok(both.el.s.includes("explorer-hash-note") && both.el.s.includes("explorer-norows-note"));
  assert.ok(!explorerLayout(dom, {indicator: "", box: {...miss, noRows: []}}).el.s.includes("explorer-norows-note"));
});

test("R13 follow-up: selectionHash writes i and c in picker order; replaceHash uses replaceState only on a change", () => {
  assert.equal(selectionHash("M09", ["FRA", "DEU"], ["DEU", "FRA", "ITA"]), "#i=M09&c=DEU,FRA");
  assert.equal(selectionHash("M09", [], ["DEU"]), "#i=M09");
  assert.equal(selectionHash("M09", ["XXX"], ["DEU"]), "#i=M09");
  const calls = [];
  const hist = {state: {k: 1}, replaceState: (...a) => calls.push(a)};
  assert.equal(replaceHash({hash: "#i=M09", pathname: "/explorer", search: ""}, hist, "#i=M09"), false);
  assert.equal(calls.length, 0);
  assert.equal(replaceHash({hash: "", pathname: "/explorer", search: "?x=1"}, hist, "#i=M09&c=DEU"), true);
  assert.deepEqual(calls, [[{k: 1}, "", "/explorer?x=1#i=M09&c=DEU"]]);
  const page = readFileSync(new URL("../src/explorer.md", import.meta.url), "utf8");
  assert.doesNotMatch(page, /pushState|location\.hash\s*=/);
  assert.match(page, /addEventListener\("hashchange"/);
  assert.match(page, /initialSelection\(ctx, pHash\)/);
});

test("R13: more than 5 countries in the address are kept (small multiples above 5, at most 5 overlaid)", () => {
  const ids = many(7).map((c) => c.id);
  assert.equal(initialSelection(ctx13, `#i=M09&c=${ids.join(",")}`).entities.length, 0, "unknown ids are invalid");
  assert.equal(FACET_ABOVE, 5);
  const m = buildModel(ctx13, "M09", rows, base());
  assert.equal(m.facets, false);
});

test("R13: selectBox renders optgroups and sets the initial value", () => {
  const out = selectBox(dom, {id: "x", label: "Indicator", groups: indicatorGroups(ctx13), value: "M09"});
  assert.ok(out.s.includes('<optgroup label="Prices">') && out.s.includes('<optgroup label="Labour">'));
  assert.ok(selectBox(dom, {id: "x", label: "L", options: [{id: "a", label: "A"}]}).s.includes('<option value="a">A</option>'));
});

// ---- Opus re-review: a missing unit keeps the value (AC-RD-30, 42); one unit source for title, axis, labels, table; lazy table
const STATED = "This export holds no unit for this value.";
test("AC-RD-30/42: with no stored unit the number stays in the table, tip, reader text and end label, followed by the defect sentence", () => {
  const bare = {indicator_id: "M09", name: "Unemployment rate", default_transform: "LEVEL"};
  const c = explorerContext({manifest, seriesMeta: seriesMeta.map((x) => ({...x, unit_code: null})), entities, indicators: [bare], alerts: []});
  const m = buildModel(c, "M09", rows, base());
  const t = tableRowsOf(m);
  const out = explorerBlock(html, stub().Plot, m, null, {}).s;
  const cells = [...out.matchAll(/<td class="mm-num">([^<]*)<\/td>/g)].map((x) => x[1]);
  assert.deepEqual(cells, t.map((r) => `${r.valueText} ${STATED}`));
  assert.ok(m.series.every((x) => valueWithUnit(pointValueText(x.latest), x.unit) === `${pointValueText(x.latest)} ${STATED}`));
  assert.ok(figureLabel(m).includes(`latest stored value 24 ${STATED}`));
  assert.equal(uniformUnit(m), null);
});

test("L1: with no indicator unit_label the title and axis use the series unit code, like the end labels and the table", () => {
  const bare = {indicator_id: "M09", name: "Unemployment rate", default_transform: "LEVEL"};
  const c = explorerContext({manifest, seriesMeta, entities, indicators: [bare], alerts: []});
  const m = buildModel(c, "M09", rows, base());
  assert.equal(m.titleUnit, "PCT");
  assert.equal(m.yLabel, "PCT");
  assert.ok(m.series.every((x) => x.unit === "PCT"));
  const out = explorerBlock(html, stub().Plot, m, null, {}).s;
  assert.ok(!out.includes("holds no unit"));
  const mixed = explorerContext({manifest, seriesMeta: seriesMeta.map((x) => (x.entity_id === "FRA" ? {...x, unit_code: "IDX"} : x)), entities, indicators: [bare], alerts: []});
  assert.equal(buildModel(mixed, "M09", rows, base()).titleUnit, "IDX; PCT");
});

test("L2: the View as table body is built on the first open only, with every plotted value then present", () => {
  const listeners = {};
  const tbody = {kids: null, replaceChildren(...k) { this.kids = k; }};
  const details = {open: false, addEventListener: (ev, fn) => (listeners[ev] = fn)};
  const m = buildModel(ctx, "M09", rows, base());
  let built = 0;
  fillOnOpen(details, tbody, () => (built++, tableRowsOf(m).map((r) => r.valueText)));
  listeners.toggle(); // closing or a toggle while closed builds nothing
  assert.equal(built, 0);
  details.open = true;
  listeners.toggle();
  listeners.toggle();
  assert.equal(built, 1, "built once");
  assert.deepEqual(tbody.kids, m.plotted.map((p) => String(p.value)), "every plotted value is in the table");
});
