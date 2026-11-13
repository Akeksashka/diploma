// V5: caption block from stored fields only (spec 6.1; AC-V2-70, 72, 75, 77, 79) on the synthetic v2_export fixture.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {buildCaption, captionTitle} from "../src/lib/caption.js";
import {DRAFT_NOT_STATED} from "../src/lib/copy.js";

const read = (f) => JSON.parse(readFileSync(new URL(`./fixtures/v2_export/${f}`, import.meta.url), "utf8"));
const meta = read("meta/series.json").series;
const indicators = read("meta/indicators.json").indicators;
const ind = (id) => indicators.find((i) => i.indicator_id === id);
const ser = (id, ents) => meta.filter((s) => s.indicator_id === id && ents.includes(s.entity_id));
const by = (c) => Object.fromEntries(c.fields.map((f) => [f.key, f.value]));
const cutoff = read("manifest.json").known_cutoff;

test("V5: every field is present for a full stored selection, in fixed order", () => {
  const c = buildCaption({indicator: ind("M09"), series: ser("M09", ["DEU"]), range: {from: "2020-01-31", to: "2025-12-31"}, knownCutoff: cutoff});
  assert.deepEqual(c.fields.map((f) => f.key), ["indicator", "unit", "frequency", "seasonal", "period", "source", "vintage"]);
  const v = by(c);
  assert.equal(v.indicator, "Unemployment rate (synthetic)");
  assert.equal(v.unit, "% of labour force");
  assert.equal(v.frequency, "Monthly");
  assert.equal(v.seasonal, "SA");
  assert.equal(v.period, "2020-01 to 2025-12");
  assert.equal(v.source, "Synthetic source");
  assert.equal(v.vintage, "latest vintage as of 2026-11-03");
  assert.ok(c.fields.every((f) => f.value !== "" && f.value !== "n/a"));
  assert.deepEqual(c.legend, []);
});

test("V5: absent stored fields print the not-stated marker, never an empty value", () => {
  const c = buildCaption({});
  assert.ok(c.fields.every((f) => f.value === DRAFT_NOT_STATED));
  const d = buildCaption({indicator: {name: "X"}, series: [{frequency: "Q"}], range: {from: "2025-09-30"}, knownCutoff: null});
  const v = by(d);
  assert.equal(v.unit, DRAFT_NOT_STATED);
  assert.equal(v.seasonal, DRAFT_NOT_STATED);
  assert.equal(v.source, DRAFT_NOT_STATED);
  assert.equal(v.period, "2025 Q3", "one date is one period, labelled by the stored frequency");
  assert.equal(v.vintage, DRAFT_NOT_STATED);
});

test("V5: period label follows the stored frequency (annual, quarterly, monthly) and a range needs one frequency", () => {
  const f = (frequency, from, to) => by(buildCaption({series: [{frequency}], range: {from, to}})).period;
  assert.equal(f("A", "2020-12-31", "2025-12-31"), "2020 to 2025");
  assert.equal(f("Q", "2020-03-31", "2025-12-31"), "2020 Q1 to 2025 Q4");
  assert.equal(f("M", "2026-03-31", "2026-03-31"), "2026-03");
  assert.equal(by(buildCaption({series: [{frequency: "A"}, {frequency: "M"}], range: {from: "2020-12-31"}})).period, DRAFT_NOT_STATED, "mixed frequencies: no single label is invented");
});

test("V5: SA and NSA mixed in a selection are both named; stored not-applicable code is spelled out", () => {
  const c = buildCaption({indicator: ind("V02"), series: ser("V02", ["DEU", "FRA"])});
  assert.equal(by(c).seasonal, "NSA, SA");
  assert.equal(by(buildCaption({series: [{seasonal_adjustment: "n/a"}]})).seasonal, "not applicable");
  assert.equal(by(buildCaption({series: [{seasonal_adjustment: "SA"}, {}]})).seasonal, `SA, ${DRAFT_NOT_STATED}`, "absent for some is shown, not hidden");
});

test("V5: unit text is the stored unit_label; without one it falls back to the stored unit_code and unit_mult note", () => {
  assert.equal(by(buildCaption({indicator: {name: "X", unit_label: "index 2015=100"}, series: [{unit_code: "IDX"}]})).unit, "index 2015=100");
  assert.equal(by(buildCaption({indicator: {name: "X"}, series: [{unit_code: "EUR", unit_mult: 6}]})).unit, "EUR (values in EUR x 10^6)");
});

test("V5: sources are the stored source names, A to Z, once each", () => {
  const c = buildCaption({series: [{source_name: "B src"}, {source_name: "A src"}, {source_name: "B src"}]});
  assert.equal(by(c).source, "A src, B src");
});

test("V5: legend codes only for the statuses present, with their stored code", () => {
  assert.deepEqual(buildCaption({statuses: ["PROV", "EST", "EST", "OBS"]}).legend, [{code: "EST", text: "estimate"}, {code: "PROV", text: "provisional"}]);
});

test("V5: the title shows unit_label verbatim and is never parsed", () => {
  assert.equal(captionTitle({name: "GDP", unit_label: "EUR bn, chain-linked (2015)"}), "GDP (EUR bn, chain-linked (2015))");
  assert.equal(captionTitle({name: "GDP"}), "GDP");
  const src = readFileSync(new URL("../src/lib/caption.js", import.meta.url), "utf8");
  assert.ok(!/unit_label|unit_text/.test(src.replace(/\/\/.*$/gm, "")), "caption.js reads units only through units.js");
});
