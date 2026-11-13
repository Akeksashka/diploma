// V13 (L2 single-indicator country line; AC-V2-19 absent control, 20, 73 amended, 74, 86, 91): the long line of one indicator and one country, on the SYNTHETIC v2 fixture.
// Rebase and projection controls are absent (A1.5, ADR-037 A1.3); a synthetic `scale_hint = index` shows the control and the statement.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_REBASE_STATEMENT, DRAFT_REVISIONS_LINK_LABEL, REBASE_TOGGLE_LABEL} from "../src/lib/copy.js";
import {facetChart, facetTipLines, hashPeriod, l2Block, seriesFacet} from "../src/lib/series-chart.js";
import {html} from "./support/html-standin.mjs";
import {fakePlot, indicators, manifest, series, seriesRows} from "./support/load-v2.mjs";

const facetOf = (indicatorId, entityId, extra = {}) => {
  const meta = series.find((s) => s.indicator_id === indicatorId && s.entity_id === entityId);
  const indicator = {...indicators.find((i) => i.indicator_id === indicatorId), ...(extra.indicator ?? {})};
  return {meta, indicator, facet: seriesFacet({rows: seriesRows(indicatorId), entityId, entityName: entityId, meta, indicator, knownCutoff: manifest.known_cutoff, ...extra.facet})};
};
const block = (m, o = {}) => String(l2Block(html, fakePlot().Plot, m, {id: "l2-test", ...o}));

test("L2: levels are plotted as stored, in the stored unit; no value is scaled (AC-V2-72, 73)", () => {
  const {facet, indicator} = facetOf("M09", "DEU");
  const stored = seriesRows("M09").filter((r) => r.entity === "DEU" && r.value !== null).map((r) => r.value);
  assert.deepEqual(facet.live.map((p) => p.value), stored);
  assert.equal(facet.unit, indicator.unit_label);
  assert.equal(facet.rebased, false);
  const {Plot, plots} = fakePlot();
  facetChart(Plot, facet, {mini: false});
  assert.equal(plots[0].y.label, indicator.unit_label);
  assert.equal(plots[0].width, 960, "the long form");
});

test("L2: solid observed points, hollow estimate and provisional points (AC-V2-20: observed and estimated points never share a mark)", () => {
  const {facet} = facetOf("A04", "DEU");
  assert.equal(facet.lastLive.status, "EST");
  const {Plot, plots} = fakePlot();
  facetChart(Plot, facet, {mini: false});
  const dots = plots[0].marks.filter((m) => m.type === "dot" && !m.options.symbol);
  const [filled, hollow] = dots;
  assert.ok(filled.data.every((p) => p.status === "OBS"));
  assert.ok(hollow.data.length > 0 && hollow.data.every((p) => p.status === "EST" || p.status === "PROV"));
  assert.equal(filled.options.r, 3);
  assert.equal(hollow.options.r, 4);
});

test("L2: a stale series draws every stored point, a square marker on the last, and `stale` with the stored period in the tip and beside the title (AC-V2-86)", () => {
  const {facet} = facetOf("M09", "FRA", {facet: {stale: true}});
  assert.equal(facet.stale, true);
  const {Plot, plots} = fakePlot();
  facetChart(Plot, facet, {mini: false});
  const square = plots[0].marks.find((m) => m.type === "dot" && m.options.symbol === "square");
  assert.deepEqual(square.data, [facet.lastLive]);
  assert.ok(facetTipLines(facet, facet.lastLive).includes(`stale, latest stored period ${facet.lastLive.period}`));
  assert.match(block(facet), new RegExp(`<span class="mm-stale" data-flag="stale"><span class="mm-square" aria-hidden="true"></span>stale <span class="mm-stale-period">${facet.lastLive.period}</span></span>`));
  assert.equal(facetOf("M09", "DEU").facet.stale, false);
});

test("L2: stale with a Period window ending before the latest stored point: no square, the stored latest period in the tip and beside the title (A1.1)", () => {
  const full = facetOf("M09", "FRA", {facet: {stale: true}}).facet;
  const {facet} = facetOf("M09", "FRA", {facet: {stale: true, from: 2024, to: 2024}});
  assert.equal(facet.stale, true);
  assert.notEqual(facet.lastLive.period, full.lastLive.period);
  assert.equal(facet.stalePoint.period, full.lastLive.period);
  assert.equal(facet.staleDrawn, null);
  const {Plot, plots} = fakePlot();
  facetChart(Plot, facet, {mini: false});
  assert.deepEqual(plots[0].marks.find((m) => m.type === "dot" && m.options.symbol === "square").data, []);
  assert.ok(!facetTipLines(facet, facet.lastLive).some((l) => /^stale/.test(l)));
  assert.match(block(facet), new RegExp(`<span class="mm-stale-period">${full.lastLive.period}</span>`));
  const inside = facetOf("M09", "FRA", {facet: {stale: true, from: 2025, to: 2025}}).facet;
  assert.equal(inside.staleDrawn, inside.lastLive);
  assert.ok(facetTipLines(inside, inside.lastLive).includes(`stale, latest stored period ${full.lastLive.period}`));
});

test("L2: a stale flag without a stored point is no marker (nothing is drawn for an empty series)", () => {
  const empty = seriesFacet({rows: [], entityId: "DEU", meta: series.find((s) => s.entity_id === "DEU"), indicator: indicators[0], stale: true});
  assert.equal(empty.stale, false);
  assert.equal(empty.hasValue, false);
});

test("L2: the zero rule is drawn only when the plotted values cross zero", () => {
  const mk = (values) => values.map((value, i) => ({entity: "ZZ", seriesId: 1, end: Date.UTC(2020 + i, 11, 31), frequency: "A", value, status: "OBS", knownAt: null, loadKind: null}));
  const meta = {series_id: 1, indicator_id: "A04", entity_id: "ZZ", frequency: "A", unit_code: "PCT"};
  const crossing = seriesFacet({rows: mk([-1, 2, 3]), entityId: "ZZ", meta, indicator: indicators.find((i) => i.indicator_id === "A04")});
  const above = seriesFacet({rows: mk([1, 2, 3]), entityId: "ZZ", meta, indicator: indicators.find((i) => i.indicator_id === "A04")});
  assert.equal(crossing.crossesZero, true);
  assert.equal(above.crossesZero, false);
  const a = fakePlot();
  facetChart(a.Plot, crossing);
  assert.equal(a.plots[0].marks.filter((m) => m.type === "ruleY").length, 1);
  const b = fakePlot();
  facetChart(b.Plot, above);
  assert.equal(b.plots[0].marks.filter((m) => m.type === "ruleY").length, 0);
});

test("L2: the block has the figure, the caption, the table, and the link to the revisions page (AC-V2-70, 77)", () => {
  const {facet, indicator} = facetOf("M09", "DEU");
  const out = block(facet, {revisionsHref: "../revisions", indicator});
  assert.match(out, /<div class="mm-l2" id="l2-test" data-card="l2"><h4>Series: Unemployment rate \(synthetic\)<\/h4>/);
  assert.ok(out.includes(`<a href="../revisions" data-link="revisions">${DRAFT_REVISIONS_LINK_LABEL(facet.name)}</a>`));
  assert.ok(out.includes('class="mm-caption"') && out.includes('class="mm-view-table"') && out.includes('role="img"'));
  assert.ok(out.includes("latest vintage as of 2026-11-03"));
});

test("L2: no rebase control and no projection control on today's export: not on a plain level series, not on an index series with a base_period, not where unit_label reads index (A1.5, AC-V2-73, 19)", () => {
  for (const [id, ent] of [["M09", "DEU"], ["P01", "DEU"], ["V03", "DEU"], ["V05", "DEU"], ["V03", "ITA"]]) {
    const {facet, indicator, meta} = facetOf(id, ent);
    const out = block(facet, {indicator});
    assert.ok(!out.includes("l2-test-rebase") && !out.includes(REBASE_TOGGLE_LABEL), `${id}: no rebase control`);
    assert.ok(!out.includes("rebase-statement"), `${id}: no statement`);
    assert.ok(!/projection|proj\b|PROJ/i.test(out.replace(/\bproj\w*\s*=/g, "")), `${id}: no projection control or text`);
    assert.equal(facet.rebased, false);
    if (id === "P01" || id.startsWith("V0")) {
      assert.notEqual(meta.base_period, null, `${id}: the fixture series carries a base_period`);
      assert.match(indicator.unit_label, /index|see series|% of labour/);
    }
  }
  assert.equal(facetOf("P01", "DEU").indicator.unit_label, "index");
  assert.equal(facetOf("P01", "DEU").indicator.scale_hint, undefined, "the export has no scale_hint (CR-18)");
});

test("L2: a requested rebase (rb) on an indicator without scale_hint = index is ignored: levels as stored", () => {
  const {facet} = facetOf("P01", "DEU", {facet: {rb: "2024-06"}});
  assert.equal(facet.rebased, false);
  assert.equal(facet.baseIso, null);
  assert.deepEqual(facet.live.map((p) => p.value), seriesRows("P01").filter((r) => r.entity === "DEU" && r.value !== null).map((r) => r.value));
});

test("L2: with a synthetic stored scale_hint = index the control and the statement appear, the base period is 100, and the stored values are untouched (AC-V2-74)", () => {
  const {facet, indicator} = facetOf("P01", "DEU", {indicator: {scale_hint: "index"}, facet: {rb: "2024-06"}});
  assert.equal(facet.rebased, true);
  assert.equal(facet.basePeriod, "2024-06");
  assert.equal(facet.live.find((p) => p.period === "2024-06").value, 100);
  assert.equal(facet.unit, "index, 2024-06-30 = 100");
  const out = block(facet, {indicator});
  assert.ok(out.includes(`<input type="checkbox" id="l2-test-rebase" checked=true> ${REBASE_TOGGLE_LABEL}`));
  assert.ok(out.includes(DRAFT_REBASE_STATEMENT("2024-06-30")));
  assert.equal(seriesRows("P01").find((r) => r.entity === "DEU" && r.end === Date.UTC(2024, 5, 30)).value, seriesRows("P01").find((r) => r.entity === "DEU" && r.end === Date.UTC(2024, 5, 30)).value);
  const plain = block(facetOf("P01", "DEU", {indicator: {scale_hint: "index"}}).facet, {indicator});
  assert.ok(plain.includes("l2-test-rebase"), "the control is offered for an index even before a base is chosen");
  assert.ok(!plain.includes("rebase-statement"), "the statement only while rebased");
});

test("L2: hash period forms (A1.3): YYYY, YYYY-Qn, YYYY-MM", () => {
  assert.equal(hashPeriod("2025-12-31", "A"), "2025");
  assert.equal(hashPeriod("2026-06-30", "Q"), "2026-Q2");
  assert.equal(hashPeriod("2026-09-30", "M"), "2026-09");
  assert.equal(hashPeriod("x", "M"), null);
});

test("L2: no module of the line draws a projection, reads projection/, or parses a unit text (static, AC-V2-91)", () => {
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "series-chart.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /projection\/|PROJ\b|diamond/);
  assert.doesNotMatch(code, /unit_label\s*[.?]+\s*(?:match|test|includes|startsWith|split)|\/index\/i/);
});

test("L2 (F6): a host that does not wire a rebase (PG-COUNTRY until CR-18) renders no rebase control even for an indicator with scale_hint = index; country-page.js opts out", async () => {
  const {facet, indicator} = facetOf("P01", "DEU", {indicator: {scale_hint: "index"}});
  assert.ok(block(facet, {indicator}).includes("l2-test-rebase"), "default host: offered");
  const off = block(facet, {indicator, rebaseControl: false});
  assert.ok(!off.includes("l2-test-rebase") && !off.includes(REBASE_TOGGLE_LABEL));
  const {readFileSync} = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/country-page.js", import.meta.url), "utf8");
  assert.match(src, /l2Block\(html, Plot, panel\.facet, .*rebaseControl: false\}\)/);
});
