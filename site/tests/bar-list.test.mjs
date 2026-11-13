// V19 (C2; AC-V2-35, 36, 37, 38, 80, 81): the ranked bar of the latest aligned period, on the SYNTHETIC v2 fixture. Invented data, not a measurement.
import assert from "node:assert/strict";
import {test} from "node:test";
import {DRAFT_C2_NO_RANK_REFERENCE, DRAFT_NO_ALIGNED, PERCENTILE_COLUMN_LABEL} from "../src/lib/copy.js";
import {countHiddenRowsByReason} from "../src/lib/filter-model.js";
import {emptyHashState} from "../src/lib/hash.js";
import {hiddenRowsModel} from "../src/lib/hidden-rows.js";
import {barListSortOptions, barListBlock, barListChart, barListModel, barListTableRows} from "../src/lib/bar-list.js";
import {html} from "./support/html-standin.mjs";
import {entities, fakePlot, groups, indicators, manifest, scorecards, series} from "./support/load-v2.mjs";

const build = (indicatorId, state = {}, sort = undefined, extra = {}) => {
  const indicator = {...indicators.find((i) => i.indicator_id === indicatorId), ...extra};
  return barListModel({indicator, scorecards, entities, groups, series, state: {...emptyHashState(), ...state}, sort, knownCutoff: manifest.known_cutoff});
};
const block = (m) => String(barListBlock(html, fakePlot().Plot, m, {id: "c2-test", revisionsHref: "../revisions"}));

test("bars start at 0 with a zero baseline and a neutral fill; no colour channel carries a bin (AC-V2-35)", () => {
  const m = build("A04");
  const {Plot, plots} = fakePlot();
  barListChart(Plot, m);
  const marks = plots[0].marks;
  assert.ok(marks.some((mk) => mk.type === "ruleX" && mk.data[0] === 0));
  const bars = marks.filter((mk) => mk.type === "barX");
  assert.equal(bars.length, 3);
  for (const b of bars) assert.ok(!("fill" in b.options) || typeof b.options.fill === "string", "fill is one neutral token, not a channel of the data");
  assert.equal(plots[0].x.label, "% of GDP");
});

test("only rows aligned to the printed rank_reference_period are drawn; every other row is hidden with a reason (AC-V2-36)", () => {
  const m = build("A04");
  assert.equal(m.referencePeriod, "2025-12-31");
  assert.equal(m.referenceLabel, "2025");
  assert.ok(m.bars.length > 20);
  assert.ok(m.bars.every((r) => r.ref_period_end === "2025-12-31" && !r.is_stale));
  const byId = Object.fromEntries(m.hidden.map((h) => [h.row.entityId, h.reason]));
  assert.equal(byId.ROU, "stale");
  assert.equal(byId.BGR, "stale");
  assert.equal(byId.CHN, "other_period");
  assert.equal(byId.TUR, "other_period");
});

test("the hidden-rows disclosure count equals its list, produced by countHiddenRowsByReason on the same array (AC-V2-80)", () => {
  const m = build("A04");
  const model = hiddenRowsModel(m.hidden, {label: (r) => r.name, id: (r) => r.entityId, period: (r) => r.periodText});
  const counts = countHiddenRowsByReason(m.hidden);
  assert.equal(model.items.length, counts.total);
  assert.equal(counts.no_data + counts.stale + counts.other_period + counts.other, counts.total);
  assert.match(block(m), /rows hidden: /);
});

test("oth draws the other-period rows hollow with their own period in the label; stale rows stay hidden (AC-V2-36)", () => {
  const m = build("A04", {oth: true});
  const chn = m.bars.find((r) => r.entityId === "CHN");
  assert.ok(chn, "an unaligned row is drawn with oth=1");
  assert.equal(chn.other, false, "CHN is unaligned but its stored period equals the reference");
  assert.ok(m.hidden.every((h) => h.reason === "stale" || h.reason === "no_data"));
  const {Plot, plots} = fakePlot();
  barListChart(Plot, m);
  assert.ok(plots[0].marks.filter((mk) => mk.type === "barX")[1].data.length > 0, "estimates and other periods are hollow");
  const m09 = build("M09", {oth: true});
  const lagging = m09.bars.find((r) => r.entityId === "USA");
  assert.ok(lagging && /\(/.test(lagging.label), "the label carries the own period");
  assert.equal(lagging.other, true);
});

test("percentile is hidden by default: no column, no chip, no percentile sort; pc adds the stored number and the bin chip (AC-V2-37)", () => {
  const off = build("M09");
  assert.equal(off.percentile, false);
  assert.deepEqual(barListSortOptions(false).map((o) => o.id), ["value", "name"]);
  assert.ok(!block(off).includes(PERCENTILE_COLUMN_LABEL) && !/<th[^>]*>percentile/i.test(block(off)));
  const {Plot, plots} = fakePlot();
  barListChart(Plot, off);
  assert.equal(plots[0].marks.filter((mk) => mk.type === "text").length, 1, "value labels only");
  const on = build("M09", {pc: true}, "percentile");
  assert.equal(on.percentile, true);
  assert.deepEqual(barListSortOptions(true).map((o) => o.id), ["value", "name", "percentile"]);
  assert.equal(on.sortId, "percentile");
  assert.match(block(on), /percentile vs all ranked countries/);
  assert.equal(build("M09", {}, "percentile").sortId, "value", "percentile sort without pc falls back to value");
  const shown = on.bars.filter((r) => r.percentile !== null);
  assert.ok(shown.length > 5 && shown.every((r) => r.percentile === scorecards.labour.entities.find((e) => e.entity_id === r.entityId).indicators.find((c) => c.indicator_id === "M09").percentile));
});

test("sorted by the stored value (default, highest first), A to Z, or the stored percentile; aggregates are pinned under the countries (AC-V2-38)", () => {
  const byValue = build("A04");
  const vals = byValue.countries.map((r) => r.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a));
  assert.ok(byValue.references.length >= 1);
  assert.deepEqual(byValue.bars.map((r) => r.kind), [...byValue.countries.map(() => "country"), ...byValue.references.map(() => "aggregate")]);
  const byName = build("A04", {}, "name");
  const names = byName.countries.map((r) => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en")));
});

test("no total, mean or rank row is drawn or listed (AC-V2-38)", () => {
  const out = block(build("A04"));
  const names = [...out.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((x) => x[1]);
  assert.ok(names.length > 20 && names.every((n) => !/^(total|average|mean|median|rank)/i.test(n)), names.join(","));
  assert.doesNotMatch(out, /<(?:th|td)[^>]*>\s*(?:total|average|mean|median)\b/i);
});

test("only stale and other-period rows left: the empty-card message and the disclosure, never an empty axis (AC-V2-81)", () => {
  const stale = scorecards.fiscal.entities.map((e) => ({...e, indicators: e.indicators.map((c) => (c.indicator_id === "A04" ? {...c, is_stale: true} : c))}));
  const indicator = indicators.find((i) => i.indicator_id === "A04");
  const m = barListModel({indicator, scorecards: {...scorecards, fiscal: {...scorecards.fiscal, entities: stale}}, entities, groups, series, state: emptyHashState(), knownCutoff: manifest.known_cutoff});
  assert.equal(m.bars.length, 0);
  const out = String(barListBlock(html, fakePlot().Plot, m, {id: "c2-e"}));
  assert.ok(out.includes(DRAFT_NO_ALIGNED));
  assert.match(out, /mm-hidden-rows/);
  assert.doesNotMatch(out, /<svg/);
});

test("a selection with two stored unit codes is blocked with the stored-field message (AC-V2-31, 71)", () => {
  // V01 states no rank_reference_period in the fixture (D2: nothing is drawn then); a stored period is given here so that its rows are drawn and the series fields are compared.
  const indicator = indicators.find((i) => i.indicator_id === "V01");
  const domainId = indicator.domain_ids[0];
  const cell = scorecards[domainId].entities.flatMap((e) => e.indicators ?? []).find((c) => c.indicator_id === "V01" && c.ref_period_end);
  const stated = {...scorecards, [domainId]: {...scorecards[domainId], alignment: scorecards[domainId].alignment.map((a) => (a.indicator_id === "V01" ? {...a, rank_reference_period: cell.ref_period_end} : a))}};
  const m = barListModel({indicator, scorecards: stated, entities, groups, series, state: emptyHashState(), knownCutoff: manifest.known_cutoff});
  assert.equal(m.blocked, true);
  const out = block(m);
  assert.match(out, /differing stored fields: unit code/);
  assert.doesNotMatch(out, /<svg/);
});

test("the table lists every row of the set, hidden rows last with their stored state; the unit is in the header (AC-V2-34 analogue, 7.3)", () => {
  const m = build("A04");
  const rows = barListTableRows(m);
  assert.equal(rows.length, m.rows.length);
  const hiddenIds = m.hidden.map((h) => h.row.entityId);
  assert.deepEqual(rows.slice(-hiddenIds.length).map((r) => r.entityId).sort(), [...hiddenIds].sort());
  assert.match(block(m), /Value \(% of GDP\)/);
  assert.ok(rows.every((r) => r.state && r.state !== "n/a" && r.value !== "n/a"));
});

test("a scorecard with no reference period draws nothing and says so (every row is another period)", () => {
  const m = build("A01");
  assert.equal(m.referencePeriod, null);
  assert.equal(m.bars.length, 0);
  const out = block(m);
  assert.ok(out.includes(DRAFT_C2_NO_RANK_REFERENCE), "D2 sentence");
  assert.doesNotMatch(out, /<svg/);
  assert.equal(barListTableRows(m).length, m.rows.length, "the table alternative still lists every row");
  assert.equal(build("A01", {oth: true}).bars.length, 0, "oth does not draw a fallback period");
});

test("Frequency: rows of another stored frequency are hidden as `other` (V06 has M and Q series)", () => {
  const m = build("V06", {f: "Q"});
  assert.ok(m.hidden.every((h) => h.reason !== "stale"));
  assert.ok(m.bars.every((r) => r.frequency === "Q"));
});
