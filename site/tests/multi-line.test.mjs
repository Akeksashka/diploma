// V18 (C1; AC-V2-30..34, 71, 73, 75, 76, 82, 86): the multi-country line on the SYNTHETIC v2 fixture. Invented data, not a measurement.
import assert from "node:assert/strict";
import {test} from "node:test";
import {DRAFT_BLOCKED_MESSAGE, DRAFT_NO_ALIGNED, DRAFT_REBASE_STATEMENT} from "../src/lib/copy.js";
import {emptyHashState} from "../src/lib/hash.js";
import {MAX_COLOURED, lineTipLines, multiLineBlock, multiLineChart, multiLineModel, multiLineTableRows} from "../src/lib/multi-line.js";
import {DRAFT_HOME_COUNTRIES} from "../src/lib/home-constants.js";
import {blockedState} from "../src/lib/blocked.js";
import {html} from "./support/html-standin.mjs";
import {entities, fakePlot, groups, indicators, manifest, scorecards, series, seriesRows} from "./support/load-v2.mjs";

const build = (indicatorId, state = {}, extra = {}) => {
  const indicator = {...indicators.find((i) => i.indicator_id === indicatorId), ...(extra.indicator ?? {})};
  return multiLineModel({indicator, rows: seriesRows(indicatorId), entities, groups, series, scorecards, state: {...emptyHashState(), ...state}, knownCutoff: manifest.known_cutoff});
};
const block = (m, Plot = fakePlot().Plot) => String(multiLineBlock(html, Plot, m, {id: "c1-test", revisionsHref: "../revisions"}));

test("at most five coloured lines, in the order of c; the colour is never the only identity (end labels, tips) (AC-V2-30)", () => {
  const m = build("M09", {c: ["DEU", "FRA", "ITA", "ESP", "POL", "USA", "JPN"].filter((x) => entities.some((e) => e.entity_id === x))});
  assert.ok(m.plotted.filter((x) => x.role === "highlight").length <= MAX_COLOURED);
  const {Plot, plots} = fakePlot();
  multiLineChart(Plot, m);
  const names = plots[0].marks.find((mk) => mk.type === "text").data.map((p) => p.name);
  assert.deepEqual(names, m.plotted.map((x) => x.name), "one direct label per plotted line");
  assert.deepEqual(plots[0].color.domain, m.plotted.filter((x) => x.role === "highlight").map((x) => x.entityId));
  assert.ok(plots[0].color.domain.length <= 5);
});

test("no country chosen: the default countries DEU, FRA, ITA, ESP, POL in that order, only those present in the stored entities, and the page says so (D4)", () => {
  assert.deepEqual([...DRAFT_HOME_COUNTRIES], ["DEU", "FRA", "ITA", "ESP", "POL"]);
  const m = build("M09");
  assert.equal(m.defaulted, true);
  assert.deepEqual(m.entries.filter((x) => x.role === "highlight").map((x) => x.entityId), ["DEU", "FRA", "ITA", "ESP", "POL"]);
  assert.match(block(m), /data-field="default-countries"/);
  assert.doesNotMatch(block(build("M09", {c: ["DEU"]})), /default-countries/);
  const indicator = indicators.find((i) => i.indicator_id === "M09");
  const without = multiLineModel({indicator, rows: seriesRows("M09"), entities: entities.filter((e) => e.entity_id !== "POL"), groups, series, scorecards, state: emptyHashState(), knownCutoff: manifest.known_cutoff});
  assert.deepEqual(without.entries.filter((x) => x.role === "highlight").map((x) => x.entityId), ["DEU", "FRA", "ITA", "ESP"]);
});

test("plotted values are the stored values (no scaling) and the axis title carries the unit once (AC-V2-33)", () => {
  const m = build("M09", {c: ["DEU"]});
  const stored = seriesRows("M09").filter((r) => r.entity === "DEU" && r.value !== null).map((r) => r.value);
  assert.deepEqual(m.plotted[0].live.map((p) => p.value), stored);
  const {Plot, plots} = fakePlot();
  multiLineChart(Plot, m);
  assert.equal(plots[0].y.label, "% of labour force");
  assert.equal(m.rebased, false);
});

test("a selection with two stored unit codes is blocked with the stored-field message and values; nothing is drawn (AC-V2-31, 71)", () => {
  const m = build("V01", {c: ["DEU", "ITA"]});
  assert.equal(m.blocked, true);
  assert.ok(m.compat.blocked.some((b) => b.field === "unit_code"));
  const out = block(m);
  assert.ok(out.includes(DRAFT_BLOCKED_MESSAGE(["unit code"])) || out.includes("differing stored fields: unit code"), out.slice(0, 300));
  assert.match(out, /EUR_BN/);
  assert.doesNotMatch(out, /<svg/);
  const same = build("V01", {c: ["DEU", "FRA"]});
  assert.equal(same.blocked, false, "DEU and FRA share a unit code");
});

test("SA and NSA are marked, never blocked: the caption lists both, the note says it, each tip carries the stored adjustment (AC-V2-76)", () => {
  const m = build("V02", {c: ["DEU", "FRA"]});
  assert.equal(m.blocked, false);
  assert.equal(m.marked, true);
  assert.deepEqual(m.caption.fields.find((f) => f.key === "seasonal").value, "NSA, SA");
  assert.match(block(m), /data-field="seasonal-mix"/);
  const line = m.plotted.find((x) => x.entityId === "FRA");
  assert.ok(lineTipLines(m, line, line.lastLive).includes("NSA"));
});

test("a stale series is drawn in full with a square last-point marker and `stale` in the tip; a fresh series has none (A1.1, AC-V2-82, 86)", () => {
  const m = build("M09", {c: ["DEU", "FRA"]});
  const fra = m.plotted.find((x) => x.entityId === "FRA");
  const deu = m.plotted.find((x) => x.entityId === "DEU");
  assert.equal(fra.stale, true);
  assert.equal(deu.stale, false);
  assert.equal(fra.live.length, seriesRows("M09").filter((r) => r.entity === "FRA" && r.value !== null).length, "all stored points are drawn");
  const {Plot, plots} = fakePlot();
  multiLineChart(Plot, m);
  const square = plots[0].marks.find((mk) => mk.type === "dot" && mk.options.symbol === "square");
  assert.deepEqual(square.data.map((p) => p.series), ["FRA"]);
  assert.ok(lineTipLines(m, fra, fra.lastLive).some((l) => /^stale, latest stored period /.test(l)));
  assert.ok(!lineTipLines(m, deu, deu.lastLive).some((l) => /stale/.test(l)));
  assert.equal(m.hidden.length, 0, "stale series are never hidden on a line chart");
});

test("a country with no stored value in the plotted period is not drawn and goes to the disclosure (AC-V2-80)", () => {
  const m = build("M09", {c: ["DEU", "BRA"].filter((x) => entities.some((e) => e.entity_id === x)), from: 2018, to: 2019});
  assert.equal(m.plotted.length, 0, "nothing in 2018-2019 in the fixture");
  assert.ok(m.hidden.length > 0 && m.hidden.every((h) => h.reason === "no_data"));
  const out = block(m);
  assert.match(out, /mm-hidden-rows/);
  assert.ok(out.includes(DRAFT_NO_ALIGNED));
  assert.doesNotMatch(out, /<svg/);
});

test("context lines are off by default and grey, unlabelled and not in the colour domain when on (AC-V2: ctx)", () => {
  const off = build("M09", {c: ["DEU"]});
  assert.equal(off.drawn.filter((x) => x.role === "context").length, 0);
  const on = build("M09", {c: ["DEU"], ctx: true});
  const ctx = on.drawn.filter((x) => x.role === "context");
  assert.ok(ctx.length > 5);
  const {Plot, plots} = fakePlot();
  multiLineChart(Plot, on);
  assert.deepEqual(plots[0].color.domain, ["DEU"]);
  assert.equal(plots[0].marks.find((mk) => mk.type === "text").data.length, 1, "context lines carry no label");
});

test("a selected aggregate is a dashed grey reference line and is not one of the five colours", () => {
  const m = build("A04", {c: ["DEU", "EU27"]});
  const agg = m.plotted.find((x) => x.entityId === "EU27");
  assert.equal(agg.role, "aggregate");
  const {Plot, plots} = fakePlot();
  multiLineChart(Plot, m);
  assert.ok(plots[0].marks.some((mk) => mk.type === "line" && mk.options.strokeDasharray === "5 3"));
  assert.deepEqual(plots[0].color.domain, ["DEU"]);
});

test("rebase is absent without scale_hint = index (A1.5); with a synthetic marker the code path rebases and states it (AC-V2-32, 73, 74)", () => {
  const plain = build("P01", {c: ["EA"], rb: "2024-01"});
  assert.equal(plain.rebased, false);
  assert.doesNotMatch(block(plain), /rebased for display/);
  const synthetic = build("P01", {c: ["EA"]}, {indicator: {scale_hint: "index"}});
  assert.equal(synthetic.rebased, true);
  assert.ok(synthetic.plotted[0].live.every((p) => /^-?\d+\.\d$/.test(p.text)));
  assert.match(block(synthetic), new RegExp(DRAFT_REBASE_STATEMENT(synthetic.baseIso).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("no resampling: one frequency; a second frequency of the same indicator is selected, never mixed (AC-V2-75)", () => {
  const monthly = build("V06", {c: ["DEU"]});
  const quarterly = build("V06", {c: ["DEU"], f: "Q"});
  assert.equal(monthly.frequency, "M");
  assert.equal(quarterly.frequency, "Q");
  assert.ok(monthly.plotted[0].live.every((p) => /^\d{4}-\d{2}$/.test(p.period)));
  assert.ok(quarterly.plotted[0].live.every((p) => /^\d{4} Q[1-4]$/.test(p.period)));
});

test("the table lists every drawn point with the unit in the header; the card links to the revisions page (AC-V2-34, 77)", () => {
  const m = build("M09", {c: ["DEU"]});
  assert.equal(multiLineTableRows(m).length, m.plotted[0].live.length);
  const out = block(m);
  assert.match(out, /View as table/);
  assert.match(out, /href="\.\.\/revisions"/);
  assert.match(out, /<caption>/);
});

test("the caption names the indicator, unit, frequency, seasonal adjustment, period, source and vintage (AC-V2-70)", () => {
  const m = build("M09", {c: ["DEU"]});
  assert.deepEqual(m.caption.fields.map((f) => f.key), ["indicator", "unit", "frequency", "seasonal", "period", "source", "vintage"]);
  assert.ok(m.caption.fields.every((f) => f.value && f.value !== "n/a"));
});

test("stale + Period window: the stale point is the last of ALL stored points; the square only when it is inside the window, the stored period is always printed (A1.1)", () => {
  const stored = build("M09", {c: ["FRA"]}).plotted[0].stalePoint;
  assert.equal(stored.period, "2025-12", "FRA's last stored point");
  // window 2024-2025: the stale point is inside, the square is drawn on it
  const inside = build("M09", {c: ["FRA"], from: 2024, to: 2025});
  const fra = inside.plotted[0];
  assert.equal(fra.stale, true);
  assert.equal(fra.staleDrawn, fra.lastLive);
  const a = fakePlot();
  multiLineChart(a.Plot, inside);
  assert.deepEqual(a.plots[0].marks.find((mk) => mk.type === "dot" && mk.options.symbol === "square").data.map((p) => p.series), ["FRA"]);
  assert.ok(lineTipLines(inside, fra, fra.staleDrawn).some((l) => l === "stale, latest stored period 2025-12"));
  // window 2024-2024: lines are drawn, the stale point is outside; no square, no stale tip on the window's last point, but the flag and the stored period are kept
  const outside = build("M09", {c: ["FRA"], from: 2024, to: 2024});
  const f2 = outside.plotted[0];
  assert.equal(f2.stale, true);
  assert.equal(f2.staleDrawn, null);
  assert.equal(f2.stalePoint.period, "2025-12");
  assert.notEqual(f2.lastLive.period, "2025-12");
  const b = fakePlot();
  multiLineChart(b.Plot, outside);
  assert.equal(b.plots[0].marks.find((mk) => mk.type === "dot" && mk.options.symbol === "square").data.length, 0);
  assert.ok(!lineTipLines(outside, f2, f2.lastLive).some((l) => /stale/.test(l)));
  // window with no live point (2026): not drawn, listed, and the stale flag is still kept on the entry
  const none = build("M09", {c: ["FRA", "DEU"], from: 2026, to: 2026});
  assert.ok(none.hidden.some((h) => h.row.entityId === "FRA"));
  const entry = none.entries.find((x) => x.entityId === "FRA");
  assert.equal(entry.stale, true);
  assert.equal(entry.stalePoint.period, "2025-12");
});

test("the table alternative lists the hidden rows too, with the stored reason sentence (spec 7.3)", () => {
  const m = build("M09", {c: ["FRA", "DEU"], from: 2026, to: 2026});
  assert.ok(m.hidden.length > 0);
  const rows = multiLineTableRows(m);
  for (const h of m.hidden) {
    const r = rows.find((x) => x.entity === h.row.entityId);
    assert.ok(r, `${h.row.entityId} is in the table`);
    assert.equal(r.status, h.row.reasonSentence);
  }
  assert.equal(rows.length, m.drawn.flatMap((x) => x.live).length + m.hidden.length);
  assert.match(block(m), /data-entity="FRA"/);
});

test("the compatibility check runs among the chosen series only: grey context lines never block the chart (spec C1)", () => {
  const without = build("V01", {c: ["DEU", "FRA"]});
  assert.equal(without.blocked, false);
  const on = build("V01", {c: ["DEU", "FRA"], ctx: true});
  assert.ok(on.drawn.some((x) => x.role === "context" && x.entityId === "ITA"), "ITA (EUR_BN) is a context line");
  assert.equal(on.blocked, false, "a context line with another unit code does not block");
  assert.doesNotMatch(block(on), /data-state="blocked"/);
  assert.equal(build("V01", {c: ["DEU", "ITA"], ctx: true}).blocked, true, "two chosen series with different unit codes still block");
});

test("a blocked state offers no share or count: only the stored fields and values are printed (D5)", () => {
  const m = build("V01", {c: ["DEU", "ITA"]});
  const text = String(blockedState(html, m.compat));
  assert.doesNotMatch(text, /share|percent|%|single basis|single-basis|\d+ of \d+/i);
  assert.doesNotMatch(block(m), /share of|single basis|single-basis/i);
});
