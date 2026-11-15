// V21 (C4; AC-V2-46..50, 84, 85, 82): the heatmap countries by period on the SYNTHETIC v2 fixture. Invented data, not a measurement.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_C4_SCALE, DRAFT_NO_ALIGNED} from "../src/lib/copy.js";
import {countHiddenRowsByReason} from "../src/lib/filter-model.js";
import {emptyHashState} from "../src/lib/hash.js";
import {C4_SORTS, WINDOW_CAPS, scaleKind, timeHeatmapBlock, timeHeatmapChart, timeHeatmapModel, timeHeatmapTableRows} from "../src/lib/time-heatmap.js";
import {html} from "./support/html-standin.mjs";
import {entities, fakePlot, groups, indicators, manifest, scorecards, series, seriesRows} from "./support/load-v2.mjs";

const build = (id, state = {}, sort = undefined, drop = null) => {
  const indicator = indicators.find((i) => i.indicator_id === id);
  const sc = drop ? Object.fromEntries(Object.entries(scorecards).map(([k, v]) => [k, {...v, entities: v.entities.map((e) => ({...e, indicators: e.indicators.filter((c) => !(c.indicator_id === id && drop.includes(e.entity_id)))}))}])) : scorecards;
  return timeHeatmapModel({indicator, rows: seriesRows(id), entities, groups, series, scorecards: sc, state: {...emptyHashState(), ...state}, sort, knownCutoff: manifest.known_cutoff});
};
const block = (m) => String(timeHeatmapBlock(html, fakePlot().Plot, m, {id: "c4-test"}));
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("scale type: sequential for a non-negative range, diverging with midpoint 0 when the displayed range holds a negative value (AC-V2-47)", () => {
  assert.equal(scaleKind({min: 0, max: 5}), "sequential");
  assert.equal(scaleKind({min: 2, max: 5}), "sequential");
  assert.equal(scaleKind({min: -5, max: -1}), "diverging", "D3: an all-negative range uses the diverging scale with midpoint 0");
  assert.equal(scaleKind({min: -5, max: 0}), "diverging");
  assert.equal(scaleKind({min: -1, max: 3}), "diverging");
  assert.equal(scaleKind(null), "sequential");
  assert.equal(build("M09").scaleKind, "sequential");
  const bal = build("A04");
  assert.equal(bal.scaleKind, bal.extent.min < 0 ? "diverging" : "sequential");
  const {Plot, plots} = fakePlot();
  timeHeatmapChart(Plot, build("A05"));
  assert.equal(plots[0].color.type, "linear");
  const growth = build("A02");
  const g = fakePlot();
  timeHeatmapChart(g.Plot, growth);
  assert.equal(g.plots[0].color.type, growth.scaleKind === "diverging" ? "diverging" : "linear");
  if (growth.scaleKind === "diverging") assert.equal(g.plots[0].color.pivot, 0);
});

test("the colour domain is the displayed lowest and highest stored value, stated in the caption text (AC-V2-46)", () => {
  const m = build("M09");
  const shown = m.filled.map((c) => c.value);
  assert.equal(m.extent.min, [...shown].sort((a, b) => a - b)[0]);
  assert.equal(m.extent.max, [...shown].sort((a, b) => b - a)[0]);
  assert.ok(m.scaleText.includes(DRAFT_C4_SCALE(String(m.extent.min), String(m.extent.max))));
  assert.match(block(m), /Colour scale<\/dt><dd>[^<]* the lowest and highest cell shown/);
  assert.match(block(m), /mm-c4-legend/);
  assert.match(block(m), /data-end="min"/);
  assert.match(block(m), /data-end="max"/);
});

test("window caps per frequency: annual 35, quarterly 40, monthly 36, the latest columns kept (AC-V2-49)", () => {
  assert.deepEqual({...WINDOW_CAPS}, {A: 35, Q: 40, M: 36});
  const m = build("M09");
  assert.ok(m.columns.length <= 36);
  const all = [...new Set(seriesRows("M09").filter((r) => r.value !== null).map((r) => r.end))].sort((a, b) => a - b);
  assert.equal(m.columns.at(-1).ms, all.at(-1), "the newest period is kept");
  assert.deepEqual(m.columns.map((c) => c.ms), all.slice(-m.columns.length));
  assert.equal(m.cap, 36);
  assert.equal(build("A04").cap, 35);
  assert.equal(build("Q08").cap, 40);
  // a synthetic series longer than the cap
  const long = Array.from({length: 50}, (_, k) => ({entity: "DEU", seriesId: 1000, end: Date.UTC(2000 + k, 11, 31), frequency: "A", value: k, status: "OBS", knownAt: 0, loadKind: "initial"}));
  const ind = {...indicators.find((i) => i.indicator_id === "A04")};
  const meta = [{...series.find((s) => s.indicator_id === "A04" && s.entity_id === "DEU")}];
  const capped = timeHeatmapModel({indicator: ind, rows: long.map((r) => ({...r, seriesId: meta[0].series_id})), entities, groups, series: meta, scorecards: {}, state: emptyHashState()});
  assert.equal(capped.columns.length, 35);
  assert.equal(capped.columns.at(-1).period, "2049");
});

test("a blank cell is never a value: it is a blank (hatched) cell, in no extent and no table value (AC-V2-48)", () => {
  const m = build("M09");
  const esp = m.rows.find((r) => r.entityId === "ESP");
  const gap = esp.values.filter((v) => v.value === null);
  assert.ok(gap.length >= 3, "ESP has no stored value 2025-03..05");
  assert.ok(gap.every((v) => v.blank === true && v.text === null));
  assert.ok(m.blanks.every((c) => c.value === null) && m.filled.every((c) => c.value !== null));
  const {Plot, plots} = fakePlot();
  timeHeatmapChart(Plot, m);
  const cells = plots[0].marks.filter((mk) => mk.type === "cell");
  assert.equal(cells[1].options.fill, "url(#mm-blank-c4)");
  assert.equal(cells[0].options.fill, "value");
  assert.ok(!m.filled.some((c) => c.value === 0 && c.blank));
  assert.ok(timeHeatmapTableRows(m).filter((r) => r.entity === "ESP").every((r) => r.valueText !== "0"));
});

test("no PROJ cell and no projection input: the module reads no projection and the cell statuses are stored value_status only (AC-V2-50)", () => {
  const text = readFileSync(join(root, "src", "lib", "time-heatmap.js"), "utf8");
  assert.doesNotMatch(text.replace(/\/\/.*$/gm, ""), /PROJ\b|projection/);
  const m = build("A04");
  assert.ok(m.cells.every((c) => c.status === null || ["OBS", "EST", "PROV"].includes(c.status)));
});

test("stl=0: a row with stored is_stale true is not drawn and is listed with reason `stale` (A1.1, AC-V2-84)", () => {
  const m = build("M09");
  assert.ok(!m.rows.some((r) => ["FRA", "ITA"].includes(r.entityId)));
  const stale = m.hidden.filter((h) => h.reason === "stale").map((h) => h.row.entityId).sort();
  assert.deepEqual(stale, ["FRA", "ITA"]);
  assert.ok(m.rows.every((r) => !r.is_stale));
  assert.match(block(m), /data-reason="stale"/);
  assert.equal(countHiddenRowsByReason(m.hidden).stale, 2);
});

test("stl=1: the stale rows are drawn with a dashed outline and the text code after the label, and leave the hidden array (A1.1, AC-V2-85)", () => {
  const off = build("M09");
  const on = build("M09", {stl: true});
  assert.deepEqual(on.hidden.filter((h) => h.reason === "stale"), []);
  assert.equal(on.rows.length, off.rows.length + 2);
  const fra = on.rows.find((r) => r.entityId === "FRA");
  assert.equal(fra.label, "France stale");
  assert.equal(fra.stale, true);
  assert.equal(on.rows.find((r) => r.entityId === "DEU").label, "Germany");
  const {Plot, plots} = fakePlot();
  timeHeatmapChart(Plot, on);
  const outline = plots[0].marks.find((mk) => mk.type === "cell" && mk.options.strokeDasharray === "4 2");
  assert.ok(outline && outline.data.length > 0 && outline.data.every((c) => ["France stale", "Italy stale"].includes(c.label)));
  assert.equal(outline.options.fill, "none", "an outline, not a fill: the hatch is reserved for blank cells");
  assert.ok(plots[0].y.domain.includes("France stale"));
  const none = fakePlot();
  timeHeatmapChart(none.Plot, off);
  assert.ok(!none.plots[0].marks.some((mk) => mk.options?.strokeDasharray === "4 2"), "no outline with stl=0");
});

test("the hidden array identity: the list renders the array whose tally is the summary (AC-V2-80)", () => {
  const m = build("M09");
  const counts = countHiddenRowsByReason(m.hidden);
  assert.equal(counts.total, m.hidden.length);
  assert.equal(counts.no_data + counts.stale + counts.other_period + counts.other, counts.total);
  const out = block(m);
  assert.equal((out.match(/<li data-reason=/g) ?? []).length, counts.total);
  assert.ok(out.includes(`${counts.total} rows hidden: `));
});

test("a row with no scorecard entry is not flagged stale and is drawn (A1.1, unverified premise recorded)", () => {
  const m = build("M09", {}, undefined, ["FRA"]);
  const fra = m.rows.find((r) => r.entityId === "FRA");
  assert.ok(fra, "FRA has no scorecard cell here and is drawn");
  assert.equal(fra.is_stale, false);
  assert.ok(m.hidden.some((h) => h.row.entityId === "ITA" && h.reason === "stale"));
});

test("rows by the latest stored value (default, highest first) or A to Z; one frequency per chart", () => {
  const m = build("A04");
  const latest = m.rows.map((r) => r.latest);
  assert.deepEqual(latest, [...latest].sort((a, b) => b - a));
  const byName = build("A04", {}, "name");
  assert.deepEqual(byName.rows.map((r) => r.name), byName.rows.map((r) => r.name).sort((a, b) => a.localeCompare(b, "en")));
  assert.deepEqual({...C4_SORTS}.value.field, "latest");
  const q = build("V06", {f: "Q"});
  assert.equal(q.frequency, "Q");
  assert.ok(q.columns.every((c) => /^\d{4} Q[1-4]$/.test(c.period)));
});

test("text in the cell when the width permits (at most 24 columns), none beyond", () => {
  assert.equal(build("A04", {from: 2016, to: 2025}).showText, true);
  assert.equal(build("M09").showText, false);
  const {Plot, plots} = fakePlot();
  timeHeatmapChart(Plot, build("A04", {from: 2016, to: 2025}));
  assert.ok(plots[0].marks.some((mk) => mk.type === "text"));
  const w = fakePlot();
  timeHeatmapChart(w.Plot, build("M09"));
  assert.ok(!w.plots[0].marks.some((mk) => mk.type === "text"));
});

test("only stale rows left: the empty-card message with the disclosure, never an empty axis (AC-V2-81)", () => {
  const stale = Object.fromEntries(Object.entries(scorecards).map(([k, v]) => [k, {...v, entities: v.entities.map((e) => ({...e, indicators: e.indicators.map((c) => (c.indicator_id === "A05" ? {...c, is_stale: true} : c))}))}]));
  const m = timeHeatmapModel({indicator: indicators.find((i) => i.indicator_id === "A05"), rows: seriesRows("A05"), entities, groups, series, scorecards: stale, state: emptyHashState()});
  assert.equal(m.rows.length, 0);
  const out = String(timeHeatmapBlock(html, fakePlot().Plot, m, {id: "c4-e"}));
  assert.ok(out.includes(DRAFT_NO_ALIGNED));
  assert.match(out, /mm-hidden-rows/);
  assert.doesNotMatch(out, /<svg/);
});

test("a selection with differing stored unit fields is blocked with the stored-field message", () => {
  const m = build("V01");
  assert.equal(m.blocked, true);
  assert.match(block(m), /differing stored fields: unit code/);
});

test("the numeric table lists every drawn cell and the hidden rows after them with their stored state (AC-V2: table alternative, 7.3)", () => {
  const m = build("M09");
  const rows = timeHeatmapTableRows(m);
  const drawn = m.rows.flatMap((r) => r.values.filter((v) => v.value !== null));
  assert.equal(rows.filter((r) => !m.hidden.some((h) => h.row.entityId === r.entity)).length, drawn.length);
  const fra = rows.filter((r) => r.entity === "FRA");
  assert.ok(fra.length > 0 && fra.every((r) => /^stale, /.test(r.status)));
  assert.ok(rows.every((r) => r.valueText !== "n/a" && r.status !== "n/a"));
  assert.match(block(m), /View as table/);
});

test("the module never uses the blank-cell fill for a stale row and the caption names the unit and frequency", () => {
  const m = build("A05");
  assert.deepEqual(m.caption.fields.map((f) => f.key), ["indicator", "unit", "frequency", "seasonal", "period", "scale", "source", "vintage"]);
  assert.equal(m.caption.fields.find((f) => f.key === "frequency").value, "Annual");
});
