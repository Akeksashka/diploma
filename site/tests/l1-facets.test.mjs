// V12 (L1 domain small multiples of lines; AC-V2-14, 15, 16, 17, 18, 72, 75, 82, 86): panel selection, ordering, one Plot per panel, gaps, the stale marker and
// the hidden-rows disclosure, on the SYNTHETIC v2 fixture (Plot and htl are stand-ins; the browser checks are in tests/smoke/l1.smoke.mjs).
import assert from "node:assert/strict";
import {test} from "node:test";
import {DRAFT_HIDDEN_SUMMARY, DRAFT_NOT_STATED, DRAFT_SERIES_UNREADABLE} from "../src/lib/copy.js";
import {countHiddenRowsByReason} from "../src/lib/filter-model.js";
import {l1Build, l1Card, l1Panels} from "../src/lib/l1-card.js";
import {facetChart, facetTableRows, facetTipLines} from "../src/lib/series-chart.js";
import {FACET_PAGE, l1Items, l1Reveal} from "../src/lib/small-multiples.js";
import {html} from "./support/html-standin.mjs";
import {domains, entity, fakePlot, indicators, inputsOf, modelOf, series, seriesRows} from "./support/load-v2.mjs";

const domainOf = (id, domainId) => modelOf(id).domains.find((d) => d.domainId === domainId);
const build = (id, domainId, files, extra = {}) => {
  const d = domainOf(id, domainId);
  const found = l1Items({domain: d, indicators, series, entityId: id, frequency: extra.frequency ?? null});
  const shown = l1Reveal(found.items, [], false);
  const loaded = new Map(files.map((f) => [f, seriesRows(f)]));
  return {d, found, shown, b: l1Build({items: found.items, none: found.none, loaded, failed: extra.failed ?? new Set(), indicators, entity: entity(id), state: extra.state ?? {}, knownCutoff: inputsOf(id).knownCutoff, shown})};
};

test("L1: panels follow the stored indicator order; an indicator with no series for the pair is listed in `none` (hidden, no_data)", () => {
  const {d, found} = build("DEU", "labour", []);
  const stored = domains.find((x) => x.domain_id === "labour").indicator_ids;
  assert.deepEqual([...new Set(found.items.map((i) => i.row.indicatorId))], stored.filter((id) => found.items.some((i) => i.row.indicatorId === id)), "meta/domains.json indicator_ids order, not the value-first order of d.rows");
  assert.deepEqual([...found.items.map((i) => i.row.indicatorId), ...found.none.map((r) => r.indicatorId)].sort(), [...stored].sort());
  const noSeries = l1Items({domain: {rows: [{indicatorId: "M09"}, {indicatorId: "ZZ9"}]}, indicators, series, entityId: "DEU"});
  assert.deepEqual(noSeries.none.map((r) => r.indicatorId), ["ZZ9"]);
  assert.deepEqual(noSeries.items.map((i) => i.row.indicatorId), ["M09"]);
});

test("L1 (F5): an indicator with a series but no scorecard value keeps its place in the stored indicator_ids order", () => {
  for (const dom of domains) {
    const m = modelOf("DEU").domains.find((x) => x.domainId === dom.domain_id);
    if (!m) continue;
    const found = l1Items({domain: m, indicators, series, entityId: "DEU"});
    const seen = [...new Set(found.items.map((i) => i.row.indicatorId))];
    assert.deepEqual(seen, dom.indicator_ids.filter((id) => seen.includes(id)), dom.domain_id);
  }
  // synthetic: the first stored indicator has a series but no value, the second has a value; rows (value-first) put the second first, `ordered` keeps the stored order.
  const rowOf = (id, hasValue) => ({indicatorId: id, hasValue});
  const a = rowOf("M09", false);
  const b = rowOf("P01", true);
  const fake = {rows: [b, a], ordered: [a, b]};
  const metas = [{indicator_id: "M09", entity_id: "DEU", series_id: 1}, {indicator_id: "P01", entity_id: "DEU", series_id: 2}];
  assert.deepEqual(l1Items({domain: fake, indicators, series: metas, entityId: "DEU"}).items.map((i) => i.row.indicatorId), ["M09", "P01"]);
});

test("L1: an indicator with two stored frequencies gets one panel per frequency; Frequency keeps only that stored frequency (no resampling)", () => {
  const all = build("DEU", "qa", []).found.items.filter((i) => i.row.indicatorId === "V06");
  assert.deepEqual(all.map((i) => i.meta.frequency).sort(), ["M", "Q"]);
  const monthly = build("DEU", "qa", [], {frequency: "M"}).found.items.filter((i) => i.row.indicatorId === "V06");
  assert.deepEqual(monthly.map((i) => i.meta.frequency), ["M"]);
  assert.deepEqual(build("DEU", "labour", [], {frequency: "A"}).found.items, [], "no monthly indicator has an annual series");
});

test("L1: at most FACET_PAGE panels, then the next block (Show more), by list selection (AC-V2-16)", () => {
  assert.equal(FACET_PAGE, 12);
  const items = Array.from({length: 30}, (_, i) => ({key: `k${i}`}));
  const first = l1Reveal(items, [], false);
  assert.equal(first.length, 12);
  assert.deepEqual(first, items.slice(0, 12).map((i) => i.key));
  assert.deepEqual(l1Reveal(items, first, false), first, "no change without a click");
  const second = l1Reveal(items, first, true);
  assert.equal(second.length, 24);
  assert.deepEqual(second.slice(0, 12), first, "the shown panels keep their place");
  assert.equal(l1Reveal(items, second, true).length, 30);
  assert.deepEqual(l1Reveal(items.slice(0, 3), second, false), ["k0", "k1", "k2"], "keys of vanished panels are dropped");
});

test("L1: one Plot per panel; each y axis carries its own unit; no panel shares a scale with another (AC-V2-14, 72)", () => {
  const {b, d} = build("DEU", "labour", ["M09", "M10", "M11"]);
  const {Plot, plots} = fakePlot();
  const out = String(l1Card(html, Plot, {domain: d, build: b, bounds: {from: 2024, to: 2026}}));
  assert.equal(plots.length, 3, "three panels, three Plots");
  assert.deepEqual(plots.map((p) => p.y.label), ["% of labour force", "% of population 15-64", "million"]);
  assert.ok(plots.every((p) => !("fy" in p) && !("facet" in p)), "no Plot facet (they share one y scale)");
  assert.equal(out.split('class="mm-facet"').length - 1, 3);
  for (const p of plots) assert.deepEqual(p.x.domain.map((x) => x.toISOString().slice(0, 10)), ["2024-01-01", "2026-12-31"], "shared x domain from the stored bounds");
});

test("L1: the Period control clips the shared x domain; stored points outside it are not drawn (no row filter)", () => {
  const {b, d} = build("DEU", "labour", ["M09"], {state: {from: 2025, to: 2025}});
  const {Plot, plots} = fakePlot();
  String(l1Card(html, Plot, {domain: d, build: b, bounds: {from: 2024, to: 2026}, state: {from: 2025, to: 2025}}));
  assert.deepEqual(plots[0].x.domain.map((x) => x.getUTCFullYear()), [2025, 2025]);
  const facet = b.drawn.find((f) => f.indicatorId === "M09");
  assert.ok(facet.live.every((p) => p.date.getUTCFullYear() === 2025));
});

test("L1: a gap (stored MISS, null value) is a break in the line, never bridged or filled (AC-V2-17)", () => {
  const {b} = build("ESP", "labour", ["M09"]);
  const f = b.drawn.find((x) => x.indicatorId === "M09");
  assert.ok(f.points.some((p) => p.value === null), "the fixture has MISS rows for ESP M09");
  const {Plot, plots} = fakePlot();
  facetChart(Plot, f);
  const line = plots[0].marks.find((m) => m.type === "line");
  assert.equal(line.data.filter((p) => p.value === null).length, f.points.filter((p) => p.value === null).length, "the null points are passed on, so Plot breaks the line");
  assert.ok(f.live.every((p) => p.value !== null) && f.live.length < f.points.length);
});

test("L1: a stale series is drawn with all points, a square marker on the last point and `stale` with the stored period in the tip (AC-V2-82, 86)", () => {
  const {b, d} = build("FRA", "labour", ["M09"]);
  const f = b.drawn.find((x) => x.indicatorId === "M09");
  assert.equal(f.stale, true);
  assert.ok(f.live.length > 12, "all stored points");
  const {Plot, plots} = fakePlot();
  facetChart(Plot, f);
  const square = plots[0].marks.filter((m) => m.type === "dot" && m.options.symbol === "square");
  assert.equal(square.length, 1);
  assert.deepEqual(square[0].data, [f.lastLive], "the square is the last stored point");
  const lines = facetTipLines(f, f.lastLive);
  assert.ok(lines.some((l) => /^stale, latest stored period /.test(l)));
  assert.ok(lines.includes(f.lastLive.period) || lines.some((l) => l.includes(f.lastLive.period)));
  assert.ok(!facetTipLines(f, f.live[0]).some((l) => /^stale/.test(l)), "only the last point carries it");
  const out = String(l1Card(html, fakePlot().Plot, {domain: d, build: b, bounds: {from: 2024, to: 2026}}));
  assert.match(out, /data-stale="true"/);
  assert.match(out, /<span class="mm-stale" data-flag="stale">/);
  assert.equal(b.hidden.filter((h) => h.reason === "stale").length, 0, "a time-series card never hides a stale series");
});

test("L1: stale with a Period window ending before the latest stored point: no square, the tip and title code still print the stored latest period (A1.1)", () => {
  const stored = build("FRA", "labour", ["M09"]).b.drawn.find((x) => x.indicatorId === "M09");
  const {b, d} = build("FRA", "labour", ["M09"], {state: {from: 2024, to: 2024}});
  const f = b.drawn.find((x) => x.indicatorId === "M09");
  assert.equal(f.stale, true);
  assert.ok(f.live.length > 0 && f.live.length < stored.live.length, "the window clips the points");
  assert.notEqual(f.lastLive.period, stored.lastLive.period, "the last point inside the window is not the latest stored one");
  assert.equal(f.stalePoint.period, stored.lastLive.period, "the stale period is the stored latest, not the last in the window");
  assert.equal(f.staleDrawn, null);
  const {Plot, plots} = fakePlot();
  facetChart(Plot, f);
  const square = plots[0].marks.find((m) => m.type === "dot" && m.options.symbol === "square");
  assert.deepEqual(square.data, [], "the latest stored point is outside the window: no square");
  assert.ok(!facetTipLines(f, f.lastLive).some((l) => /^stale/.test(l)), "the in-window last point is not the stale one");
  const out = String(l1Card(html, fakePlot().Plot, {domain: d, build: b, state: {from: 2024, to: 2024}, bounds: {from: 2024, to: 2026}}));
  assert.ok(out.includes(`<span class="mm-stale-period">${stored.lastLive.period}</span>`), "the title code prints the stored period");
  const inside = build("FRA", "labour", ["M09"], {state: {from: 2025, to: 2025}}).b.drawn.find((x) => x.indicatorId === "M09");
  assert.equal(inside.staleDrawn, inside.lastLive, "a window holding the stale point draws the square on it");
  assert.ok(facetTipLines(inside, inside.lastLive).includes(`stale, latest stored period ${stored.lastLive.period}`));
});

test("L1: a current series has no stale marker; estimate and provisional points are hollow, observed points solid", () => {
  const {b} = build("DEU", "labour", ["M09"]);
  const f = b.drawn.find((x) => x.indicatorId === "M09");
  assert.equal(f.stale, false);
  const {Plot, plots} = fakePlot();
  facetChart(Plot, f);
  assert.equal(plots[0].marks.filter((m) => m.type === "dot" && m.options.symbol === "square").length, 1);
  assert.deepEqual(plots[0].marks.find((m) => m.type === "dot" && m.options.symbol === "square").data, [], "no square for a current series");
  const hollow = plots[0].marks.filter((m) => m.type === "dot" && !m.options.symbol && m.options.r === 4); // the hollow mark is the larger ring (tokens are not resolved in node)
  assert.deepEqual(hollow[0].data.map((p) => p.status), ["PROV"], "DEU M09 ends with a PROV row in the fixture");
});

test("L1: a panel whose series file holds no stored value, and an indicator with no series, are in ONE disclosure; N is its list length (AC-V2-80, 89)", () => {
  const {b, d} = build("ITA", "labour", ["M09", "M10", "M11"]);
  assert.ok(b.hidden.some((h) => h.row.row.indicatorId === "M10" && h.reason === "no_data"), "ITA M10 has only MISS rows");
  const counts = countHiddenRowsByReason(b.hidden);
  assert.equal(counts.total, b.hidden.length);
  assert.equal(counts.stale, 0);
  const out = String(l1Card(html, fakePlot().Plot, {domain: d, build: b, bounds: null}));
  assert.ok(out.includes(`<summary>${DRAFT_HIDDEN_SUMMARY(counts)}</summary>`));
  assert.equal(out.split("<li data-reason=").length - 1, counts.total);
  assert.ok(out.includes("Employment rate (synthetic): No data; latest value "), "label, reason, stored period or the not-stated marker, stored sentence");
  assert.ok(!out.includes("undefined"));
  const noneHere = l1Build({items: [], none: d.rows.slice(0, 1), indicators, entity: entity("ITA")});
  assert.equal(noneHere.hidden.length, 1);
  assert.equal(noneHere.hidden[0].reason, "no_data");
});

test("L1: a series file that could not be read is stated per panel; nothing partial is drawn (AC-V2-16 states)", () => {
  const {b, d} = build("DEU", "labour", ["M10", "M11"], {failed: new Set(["M09"])});
  assert.equal(b.broken.length, 1);
  const out = String(l1Card(html, fakePlot().Plot, {domain: d, build: b}));
  assert.ok(out.includes(`${b.broken[0].row.name}: ${DRAFT_SERIES_UNREADABLE}`));
  const waiting = build("DEU", "labour", ["M10"]);
  assert.equal(waiting.b.pending.length, 2);
  assert.match(String(l1Card(html, fakePlot().Plot, {domain: waiting.d, build: waiting.b, open: true})), /mm-state-loading|aria-busy|loading/i);
  // a CLOSED card reads nothing, so it prints no busy block (a stuck aria-busy found by the failed-fetch smoke test on the country page)
  assert.doesNotMatch(String(l1Card(html, fakePlot().Plot, {domain: waiting.d, build: waiting.b, open: false})), /aria-busy|mm-loading/);
});

test("L1: every panel has a role=img figure with a generated name, a caption block and a table alternative with the same rows (AC-V2-15, 18)", () => {
  const {b, d} = build("DEU", "labour", ["M09"]);
  const f = b.drawn.find((x) => x.indicatorId === "M09");
  const out = String(l1Card(html, fakePlot().Plot, {domain: d, build: b}));
  assert.match(out, /<figure class="mm-figure" id="l1-labour-M09-\d+-figure" role="img" aria-label="Line chart of Unemployment rate \(synthetic\), Germany, y-axis % of labour force/);
  for (const key of ["indicator", "unit", "frequency", "seasonal", "period", "source", "vintage"]) assert.ok(out.includes(`data-field="${key}"`), key);
  assert.equal(out.split("<tr data-entity=").length - 1, f.live.length, "the table lists every plotted point");
  const rows = facetTableRows(f);
  assert.ok(rows.every((r) => r.valueText && r.status && r.status !== "n/a"), "no empty cell, never a bare n/a");
  assert.ok(rows.some((r) => r.status === "PROV"));
  assert.ok(out.includes("<caption>"));
  assert.ok(f.caption.fields.every((c) => c.value !== "" && c.value !== undefined));
  assert.ok(f.caption.fields.find((c) => c.key === "frequency").value.length > 0);
  assert.notEqual(f.caption.fields.find((c) => c.key === "period").value, DRAFT_NOT_STATED);
});

test("L1: the period label per stored frequency in the tip and the caption (AC-V2-75): month 2026-09, quarter 2026 Q3, year 2025", () => {
  const m = build("DEU", "qa", ["V06"]).b.drawn;
  const monthly = m.find((f) => f.frequency === "M");
  const quarterly = m.find((f) => f.frequency === "Q");
  assert.match(monthly.lastLive.period, /^\d{4}-\d{2}$/);
  assert.match(quarterly.lastLive.period, /^\d{4} Q[1-4]$/);
  assert.match(build("DEU", "fiscal", ["A04"]).b.drawn[0].lastLive.period, /^\d{4}$/);
});

test("L1: the card has its detail slot for the expanded panel; the panels list matches the drawn facets (expand targets)", () => {
  const {b, d} = build("DEU", "labour", ["M09", "M10", "M11"]);
  assert.deepEqual(l1Panels(b).map((p) => p.item.row.indicatorId), ["M09", "M10", "M11"]);
  const out = String(l1Card(html, fakePlot().Plot, {domain: d, build: b, expandedKey: l1Panels(b)[1].item.key, detail: "<p>detail</p>"}));
  assert.match(out, /data-action="expand" data-facet-key="M10-\d+" aria-expanded="true">Collapse</);
  assert.equal(out.split('aria-expanded="false"').length - 1, 2);
  assert.match(out, /<div class="mm-l1-detail" data-slot="detail"/);
});
