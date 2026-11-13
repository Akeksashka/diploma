// V4: hidden-rows disclosure of the v2 cards (ADR-036 Amendment 1, ADR-037 A1.4; AC-V2-80, 81, 88, 89, 90).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {DRAFT_HIDDEN_SUMMARY, DRAFT_NOT_STATED} from "../src/lib/copy.js";
import {countHiddenRowsByReason, splitByCoverage} from "../src/lib/filter-model.js";
import {hiddenRowsDisclosure, hiddenRowsModel, hiddenRowsRegion} from "../src/lib/hidden-rows.js";
import {html} from "./support/html-standin.mjs";

const rows = [
  {entity_id: "ZZZ", name: "Zeta", value: null, frequency: "A", reasonSentence: "This export holds no value."},
  {entity_id: "AAA", name: "Alpha", value: null, frequency: "A", reasonSentence: "This export lists no series."},
  {entity_id: "SSS", name: "Stale one", value: 1, is_stale: true, ref_period_end: "2023-12-31", frequency: "A", state: {sentence: "stale: no rank"}},
  {entity_id: "OOO", name: "Other period", value: 2, ref_period_end: "2024-12-31", frequency: "A"},
  {entity_id: "DRW", name: "Drawn", value: 3, ref_period_end: "2025-12-31", frequency: "A"}
];
const split = () => splitByCoverage(rows, {requireValue: true, hideStale: true, referencePeriod: "2025-12-31"});

test("V4 summary template: 0, 1 and mixed counts (AC-V2-88)", () => {
  const S = (o) => DRAFT_HIDDEN_SUMMARY({total: 0, no_data: 0, stale: 0, other_period: 0, other: 0, ...o});
  assert.equal(S({}), "");
  assert.equal(S({total: 1, no_data: 1}), "1 row hidden: 1 no data");
  assert.equal(S({total: 1, other: 1}), "1 row hidden: 1 other");
  assert.equal(S({total: 7, no_data: 4, stale: 2, other_period: 1}), "7 rows hidden: 4 no data, 2 stale, 1 other period");
  assert.equal(S({total: 3, stale: 3}), "3 rows hidden: 3 stale", "a zero part is omitted");
  assert.equal(S({total: 8, no_data: 4, stale: 2, other_period: 1, other: 1}), "8 rows hidden: 4 no data, 2 stale, 1 other period, 1 other");
  assert.ok(!/other(?!\s+period)/.test(S({total: 7, no_data: 4, stale: 2, other_period: 1})), "the other part only when W > 0");
});

test("V4 model: count, summary and list come from one array; order is reason precedence then label A-Z (AC-V2-80, 89)", () => {
  const {hidden} = split();
  const m = hiddenRowsModel(hidden);
  assert.equal(m.counts.total, m.items.length);
  assert.deepEqual(m.counts, countHiddenRowsByReason(hidden));
  assert.equal(m.summary, "4 rows hidden: 2 no data, 1 stale, 1 other period");
  assert.deepEqual(m.items.map((i) => [i.reason, i.label]), [["no_data", "Alpha"], ["no_data", "Zeta"], ["stale", "Stale one"], ["other_period", "Other period"]]);
  assert.deepEqual(m.items.map((i) => i.reasonLabel), ["No data", "No data", "Stale", "Other period"]);
});

test("V4 model: each item carries label, reason label, stored period or the not-stated marker, and the stored sentence or the marker (AC-V2-89)", () => {
  const m = hiddenRowsModel(split().hidden);
  const by = Object.fromEntries(m.items.map((i) => [i.id, i]));
  assert.equal(by.SSS.period, "2023");
  assert.equal(by.SSS.sentence, "stale: no rank");
  assert.equal(by.AAA.period, DRAFT_NOT_STATED, "no stored period");
  assert.equal(by.AAA.sentence, "This export lists no series.");
  assert.equal(by.OOO.sentence, DRAFT_NOT_STATED, "no stored sentence");
  assert.ok(m.items.every((i) => i.label && i.reasonLabel && i.period && i.sentence), "no empty cell");
});

test("V4 render: details inside a role=status wrapper, summary and one li per hidden row; nothing at N = 0 (I7)", () => {
  const {hidden} = split();
  const out = hiddenRowsRegion(html, hidden).s;
  assert.ok(out.startsWith('<div role="status"'));
  assert.ok(out.includes('<details class="mm-hidden-rows"><summary>4 rows hidden: 2 no data, 1 stale, 1 other period</summary>'));
  assert.equal(out.split("<li ").length - 1, hidden.length, "list length equals N");
  assert.ok(out.includes("Alpha: No data; latest value not stated; This export lists no series."));
  assert.equal(hiddenRowsDisclosure(html, []), "");
  const empty = hiddenRowsRegion(html, []).s;
  assert.ok(empty.includes('role="status"') && !empty.includes("details") && !/\d/.test(empty), "empty persistent live region, no sentence");
});

test("V4 render: a link with the carried hash only when the caller gives an href; no value, percentile or state chip in the list", () => {
  const {hidden} = split();
  assert.ok(!hiddenRowsDisclosure(html, hidden).s.includes("<a "));
  const linked = hiddenRowsDisclosure(html, hidden, {href: (r) => `/country/${r.entity_id}`}).s;
  assert.equal(linked.split("<a ").length - 1, hidden.length);
  assert.ok(linked.includes('data-carry'));
  assert.ok(!/percentile|class="mm-chip|data-state/.test(linked));
});

test("V4: no module other than filter-model.js reads the length of a hidden array (scan on hidden-rows.js)", () => {
  const src = readFileSync(new URL("../src/lib/hidden-rows.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/hidden\w*\s*\.\s*length|\.length/.test(src));
  assert.ok(!/countPeriodHiddenRows/.test(src));
});
