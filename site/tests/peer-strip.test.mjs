// V14 (P1a strip plot; AC-V2-21, 80, 81, 93): the stored latest values of all countries for one indicator on one axis, on the SYNTHETIC v2 fixture.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_BLOCKED_FIELD_LABELS, DRAFT_BLOCKED_MESSAGE, DRAFT_NOT_STATED, DRAFT_NO_ALIGNED, DRAFT_P1A_NO_REFERENCE, DRAFT_P1A_REFERENCE} from "../src/lib/copy.js";
import {countHiddenRowsByReason} from "../src/lib/filter-model.js";
import {peerHiddenModel, peerStripBlock, peerStripChart, peerStripModel, peerTableRows} from "../src/lib/peer-strip.js";
import {html} from "./support/html-standin.mjs";
import {entities, fakePlot, groups, indicators, manifest, scorecards, series} from "./support/load-v2.mjs";

const model = (domainId, indicatorId, o = {}) => peerStripModel({indicator: indicators.find((i) => i.indicator_id === indicatorId), scorecard: scorecards[domainId], domainRanked: true, entities, groups, series, focusId: "DEU", ...o});
const reasons = (m) => Object.fromEntries(Object.entries(countHiddenRowsByReason(m.hidden)).filter(([, n]) => n > 0));

test("P1a: the reference period is the stored rank_reference_period of the scorecard and is printed (PLAN)", () => {
  const m = model("fiscal", "A05");
  const stored = scorecards.fiscal.alignment.find((a) => a.indicator_id === "A05").rank_reference_period;
  assert.equal(m.referencePeriod, stored);
  assert.equal(m.referenceLabel, "2025");
  const out = String(peerStripBlock(html, fakePlot().Plot, m, {id: "p1-test", knownCutoff: manifest.known_cutoff}));
  assert.ok(out.includes(`<p class="mm-note" data-field="reference-period">${DRAFT_P1A_REFERENCE("2025")}</p>`));
});

test("P1a: only rows aligned to the printed period and not stale are drawn; every other row is in the disclosure with its stored reason (AC-V2-80, 81)", () => {
  const m = model("fiscal", "A05");
  assert.ok(m.points.every((p) => p.ref_period_end === m.referencePeriod && p.is_stale === false && p.alignment !== "unaligned"));
  assert.deepEqual(m.hidden.map((h) => [h.row.entityId, h.reason]).sort(), [["BGR", "stale"], ["CHN", "other_period"], ["ROU", "stale"], ["TUR", "other_period"]]);
  const counts = countHiddenRowsByReason(m.hidden);
  assert.equal(counts.total, m.hidden.length);
  assert.equal(counts.no_data + counts.stale + counts.other_period + counts.other, counts.total);
  const lines = peerHiddenModel(m);
  assert.equal(lines.items.length, counts.total, "the list is the hidden array that the count tallies");
  assert.ok(lines.items.every((i) => i.label && i.period && i.sentence));
  const out = String(peerStripBlock(html, fakePlot().Plot, m, {id: "p1-test"}));
  assert.equal(out.split("<li data-reason=").length - 1, counts.total);
  assert.ok(out.includes("4 rows hidden: 2 stale, 2 other period"));
});

test("P1a: a country without a stored value is `no_data` in the disclosure (the stored state sentence), not silently dropped", () => {
  const m = model("labour", "M09");
  const nd = m.hidden.filter((h) => h.reason === "no_data");
  assert.ok(nd.length > 0 && nd.every((h) => h.row.hasValue === false && h.row.state.sentence));
  assert.equal(m.drawn.length + m.hidden.length, m.rows.length, "drawn + hidden = every row of the comparison set");
  assert.ok(m.hidden.some((h) => h.row.entityId === "FRA" && h.reason === "stale"), "FRA M09 is stale in the fixture");
  assert.ok(m.hidden.some((h) => h.row.entityId === "USA" && h.reason === "other_period"), "USA M09 is lagging: another reference period");
});

test("P1a: `oth` draws the other-period rows hollow with their own period in the tip; stale rows stay hidden (A1.7, oth does not unhide stale)", () => {
  const off = model("labour", "M09");
  const on = model("labour", "M09", {includeOther: true});
  const usa = on.points.find((p) => p.entityId === "USA");
  assert.ok(usa && usa.hollow && usa.periodText !== on.referenceLabel);
  assert.equal(off.points.some((p) => p.entityId === "USA"), false);
  assert.equal(on.hidden.some((h) => h.reason === "other_period"), false);
  assert.equal(on.hidden.filter((h) => h.reason === "stale").length, off.hidden.filter((h) => h.reason === "stale").length);
  const {Plot, plots} = fakePlot();
  peerStripChart(Plot, on);
  const tip = plots[0].marks.find((m) => m.type === "tip");
  assert.ok(tip.options.title(usa).includes(usa.periodText));
});

test("P1a: with only stale or other-period rows the card says `No aligned values for this selection` with the disclosure, never an empty axis (AC-V2-81)", () => {
  const sc = structuredClone(scorecards.fiscal);
  for (const e of sc.entities) for (const c of e.indicators) if (c.indicator_id === "A05") c.is_stale = true;
  const m = model("fiscal", "A05", {scorecard: sc});
  assert.equal(m.points.length + m.ticks.length, 0);
  const {Plot, plots} = fakePlot();
  const out = String(peerStripBlock(html, Plot, m, {id: "p1-test"}));
  assert.ok(out.includes(DRAFT_NO_ALIGNED));
  assert.equal(plots.length, 0, "no chart is built");
  assert.match(out, /class="mm-hidden-rows"/);
});

test("P1a: a scorecard without a stored reference period prints the stated sentence and draws no row (every row is another period)", () => {
  const sc = structuredClone(scorecards.fiscal);
  sc.alignment = [];
  const m = model("fiscal", "A05", {scorecard: sc});
  assert.equal(m.referencePeriod, null);
  assert.equal(m.points.length, 0);
  assert.ok(String(peerStripBlock(html, fakePlot().Plot, m, {id: "p1-test"})).includes(DRAFT_P1A_NO_REFERENCE));
  assert.equal(m.hidden.length, m.rows.length, "every row is in the disclosure");
  assert.ok(m.hidden.every((h) => ["other_period", "stale", "no_data"].includes(h.reason)));
});

test("P1a: vertical slots follow entity_id in ascending code-point order, fixed: never by value, never random (AC-V2-93)", () => {
  const a = model("fiscal", "A05");
  const b = model("fiscal", "A05");
  assert.deepEqual(a.points.map((p) => [p.entityId, p.slot]), b.points.map((p) => [p.entityId, p.slot]), "two renders give the same positions");
  const sorted = a.points.map((p) => p.entityId).sort();
  assert.deepEqual(a.order, sorted);
  for (const p of a.points) assert.equal(p.slot, sorted.indexOf(p.entityId));
  // reorder the stored rows and change every stored value: the slots do not change
  const sc = structuredClone(scorecards.fiscal);
  sc.entities.reverse();
  let k = 0;
  for (const e of sc.entities) for (const c of e.indicators) if (c.indicator_id === "A05" && typeof c.value === "number") c.value = (k += 7) % 101;
  const c = model("fiscal", "A05", {scorecard: sc});
  assert.deepEqual(Object.fromEntries(c.points.map((p) => [p.entityId, p.slot])), Object.fromEntries(a.points.map((p) => [p.entityId, p.slot])));
  const {Plot, plots} = fakePlot();
  peerStripChart(Plot, a);
  assert.deepEqual(plots[0].y.domain, sorted, "the y scale is the fixed id order");
  assert.equal(plots[0].y.axis, null);
});

test("P1a: the chosen country is highlighted; aggregates are dashed reference ticks, not dots; no summary line is drawn (AC-V2-21)", () => {
  const m = model("fiscal", "A05");
  assert.equal(m.points.filter((p) => p.focus).length, 1);
  assert.equal(m.points.find((p) => p.focus).entityId, "DEU");
  assert.deepEqual(m.ticks.map((t) => t.entityId).sort(), ["EA", "EU27"]);
  assert.ok(m.points.every((p) => p.kind === "country"));
  const {Plot, plots} = fakePlot();
  peerStripChart(Plot, m);
  const marks = plots[0].marks;
  assert.deepEqual(marks.filter((x) => x.type === "ruleX").map((x) => x.options.strokeDasharray).filter(Boolean), ["5 3"]);
  assert.ok(marks.some((x) => x.type === "text" && x.options.fontWeight === 700), "the chosen country has a label");
  assert.equal(marks.filter((x) => x.type === "dot").length, 4, "solid, hollow, focus dot, focus ring");
  assert.ok(!marks.some((x) => /median|quartile|mean|band|area/.test(x.type)));
});

test("P1a: Group limits the countries drawn; the aggregates stay as reference rows (spec 5.3)", () => {
  const all = model("fiscal", "A05");
  const g7 = model("fiscal", "A05", {groupId: "g7"});
  assert.ok(g7.points.length < all.points.length);
  assert.ok(g7.points.every((p) => ["DEU", "FRA", "ITA", "USA", "JPN", "GBR", "CAN"].includes(p.entityId)));
  assert.deepEqual(g7.ticks.map((t) => t.entityId).sort(), ["EA", "EU27"]);
});

test("P1a: one unit on the axis, zero rule only when the stored values cross zero, the table lists every row with the unit in the header (AC-V2-21, PLAN)", () => {
  const m = model("fiscal", "A04");
  assert.equal(m.unit, indicators.find((i) => i.indicator_id === "A04").unit_label);
  const crosses = m.drawn.map((r) => r.value);
  assert.equal(m.crossesZero, crosses.some((v) => v < 0) && crosses.some((v) => v > 0));
  const {Plot, plots} = fakePlot();
  peerStripChart(Plot, m);
  assert.equal(plots[0].x.label, m.unit);
  assert.equal(plots[0].marks.some((x) => x.type === "ruleX" && Array.isArray(x.data) && x.data[0] === 0), m.crossesZero);
  const rows = peerTableRows(model("labour", "M09"));
  assert.equal(rows.length, model("labour", "M09").rows.length, "every row is in the table");
  assert.ok(rows.every((r) => r.value && r.period && r.state), "no empty cell");
  assert.ok(rows.some((r) => r.value === DRAFT_NOT_STATED), "a country without a value says so, not a bare n/a");
  assert.ok(!rows.some((r) => /^\s*n\/a\s*$/i.test(r.value) || /^\s*n\/a\s*$/i.test(r.state)));
  const out = String(peerStripBlock(html, fakePlot().Plot, m, {id: "p1-test"}));
  assert.ok(out.includes(`Value (${m.unit})`));
  assert.match(out, /role="img" aria-label="Strip plot of /);
});

test("P1a: the module draws no summary statistic and does no arithmetic on values (static, AC-V2-21)", () => {
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "peer-strip.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bd3\b|Math\.|median|quantile|\.reduce\(|Plot\.(?:area|band|bin|group|stack)/);
  assert.doesNotMatch(code, /random/i);
});

test("P1a: drawn rows with differing stored unit fields are blocked with the stored-field message, no plot is built (spec 6.2, A1.6, AC-V2-71; F1)", () => {
  const v01 = indicators.find((i) => i.indicator_id === "V01");
  const sc = structuredClone(scorecards.qa);
  const deu = sc.entities.find((e) => e.entity_id === "DEU").indicators.find((c) => c.indicator_id === "V01");
  sc.alignment = [...(sc.alignment ?? []).filter((a) => a.indicator_id !== "V01"), {indicator_id: "V01", rank_reference_period: deu.ref_period_end}];
  const run = (o) => peerStripModel({indicator: v01, scorecard: sc, domainRanked: true, entities, groups, series, focusId: "DEU", ...o});
  // oth off: only the rows of the printed period are drawn; the case is blocked iff those rows disagree.
  for (const includeOther of [false, true]) {
    const m = run({includeOther});
    assert.deepEqual(m.drawn.map((r) => r.entityId).sort(), ["DEU", "FRA", "ITA", "POL"]);
    assert.equal(m.blocked, true, `blocked (oth=${includeOther})`);
    assert.ok(m.compat.blocked.some((b) => b.field === "unit_code"));
    const {Plot, plots} = fakePlot();
    const out = String(peerStripBlock(html, Plot, m, {id: "p1-test"}));
    assert.equal(plots.length, 0, "no chart is built");
    assert.ok(out.includes(DRAFT_BLOCKED_MESSAGE(m.compat.blocked.map((b) => DRAFT_BLOCKED_FIELD_LABELS[b.field]))));
    assert.match(out, /data-state="blocked"/);
    assert.doesNotMatch(out, /role="img"/);
  }
});

test("P1a: oth=1 on a mixed-unit indicator (fixture V01, other-period rows drawn) is blocked; oth=0 draws nothing (every row is another period)", () => {
  const v01 = indicators.find((i) => i.indicator_id === "V01");
  const run = (includeOther) => peerStripModel({indicator: v01, scorecard: scorecards.qa, domainRanked: true, entities, groups, series, focusId: "DEU", includeOther});
  const off = run(false);
  const on = run(true);
  assert.equal(off.blocked, false);
  assert.equal(off.points.length, 0);
  assert.equal(on.blocked, true);
  assert.deepEqual(on.compat.blocked.map((b) => b.field), ["unit_code", "unit_mult"]);
  const {Plot, plots} = fakePlot();
  const out = String(peerStripBlock(html, Plot, on, {id: "p1-test"}));
  assert.equal(plots.length, 0);
  assert.ok(out.includes("Not drawn together; differing stored fields: unit code, unit multiplier"));
});

test("P1a: a compatible selection is not blocked (fiscal A05)", () => {
  const m = model("fiscal", "A05");
  assert.equal(m.blocked, false);
  assert.notEqual(m.compat.status, "blocked");
});
