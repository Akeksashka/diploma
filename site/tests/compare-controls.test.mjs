// V17 (spec 5.2, 5.3 as amended A1.1, A1.3; AC-V2-37 control, 85 control): the Compare controls and their applicability matrix, on the SYNTHETIC v2 fixture.
import assert from "node:assert/strict";
import {test} from "node:test";
import {DRAFT_PERIOD_INVALID} from "../src/lib/copy.js";
import {COMPARE_CHARTS, COMPARE_CONTROLS, CONTROL_KEYS, compareControlKeys, compareControlModel, compareControlPatch, compareControls, frequencyChoices} from "../src/lib/compare-controls.js";
import {emptyHashState, parseHash, serializeHash} from "../src/lib/hash.js";
import {html} from "./support/html-standin.mjs";
import {domains, groups, indicators} from "./support/load-v2.mjs";

const model = (chart, extra = {}) => compareControlModel(chart, {state: emptyHashState(), indicators, domains, groups, bounds: {from: 2024, to: 2026}, ...extra});
const keysOf = (chart, extra) => model(chart, extra).map((d) => d.key);

test("applicability matrix: each chart shows only the controls that act on it (spec 5.3, A1.1)", () => {
  const table = {
    c1: ["indicator", "countries", "group", "period", "frequency", "ctx"],
    c2: ["indicator", "group", "frequency", "pc", "oth"],
    c3: ["x", "y", "group", "frequency", "p"],
    c4: ["indicator", "domain", "group", "frequency", "period", "stl"]
  };
  assert.deepEqual(Object.keys(COMPARE_CONTROLS), COMPARE_CHARTS.slice());
  for (const [chart, keys] of Object.entries(table)) assert.deepEqual(keysOf(chart), keys, chart);
  assert.ok(!keysOf("c4").includes("oth"), "oth does not apply to C4 (A1.1)");
  assert.ok(!keysOf("c1").includes("stl") && !keysOf("c2").includes("stl") && !keysOf("c3").includes("stl"), "Show stale rows is C4 only");
  for (const chart of COMPARE_CHARTS) for (const forbidden of ["proj", "rb", "m"]) assert.ok(!keysOf(chart).includes(forbidden), `${chart} has no ${forbidden} control (A1.3, A1.5)`);
  assert.ok(Object.isFrozen(COMPARE_CONTROLS) && Object.isFrozen(COMPARE_CONTROLS.c1));
});

test("every control writes only keys of the hash grammar, and none writes m or proj", () => {
  const grammar = Object.keys(emptyHashState()).filter((k) => k !== "note");
  for (const keys of Object.values(CONTROL_KEYS)) for (const k of keys) assert.ok(grammar.includes(k), k);
  assert.ok(!Object.values(CONTROL_KEYS).flat().some((k) => k === "m" || k === "proj" || k === "rb"));
});

test("a page that fixes the indicator has no Indicator control, and C4 no Domain list (PG-INDICATOR)", () => {
  assert.deepEqual(compareControlKeys("c2", {fixedIndicator: true}), ["group", "frequency", "pc", "oth"]);
  assert.deepEqual(compareControlKeys("c4", {fixedIndicator: true}), ["group", "frequency", "period", "stl"]);
  assert.deepEqual(compareControlKeys("c5", {fixedIndicator: true}), [], "C5 has no strip, so no controls are listed for it");
});

test("Indicator is a native select with domain optgroups and the stored unit_label in the option text", () => {
  const d = model("c2").find((x) => x.key === "indicator");
  assert.equal(d.kind, "select");
  assert.ok(d.groups.length >= 2 && d.groups.every((g) => g.label));
  const m09 = d.groups.flatMap((g) => g.options).find((o) => o.value === "M09");
  assert.match(m09.label, /% of labour force/);
  const limited = compareControlModel("c4", {state: {...emptyHashState(), d: "labour"}, indicators, domains, groups, bounds: null}).find((x) => x.key === "indicator");
  assert.deepEqual(limited.groups.map((g) => g.label), ["Labour"].map((x) => limited.groups[0].label));
  assert.ok(limited.groups.flatMap((g) => g.options).every((o) => ["M09", "M10", "M11"].includes(o.value)), "Domain limits the Indicator list");
});

test("Frequency lists only the stored frequency_set of the chosen indicator (both, for C3)", () => {
  assert.deepEqual(frequencyChoices(indicators, ["M09"]).map((o) => o.value), ["M"]);
  assert.deepEqual(frequencyChoices(indicators, ["V06"]).map((o) => o.value), ["M", "Q"]);
  assert.deepEqual(frequencyChoices(indicators, ["V06", "M09"]).map((o) => o.value), ["M"]);
  assert.deepEqual(frequencyChoices(indicators, ["M09", "A05"]).map((o) => o.value), [], "no frequency in common: C3 is blocked, no option");
  assert.deepEqual(frequencyChoices(indicators, []).map((o) => o.value), ["M", "Q", "A"]);
  const f = model("c2", {state: {...emptyHashState(), i: "V06"}}).find((x) => x.key === "frequency");
  assert.deepEqual(f.options.map((o) => o.value), ["", "M", "Q"]);
});

test("patches: flags are 0|1, selects write the stored id or null, the Period is a valid pair", () => {
  assert.deepEqual(compareControlPatch("pc", true), {patch: {pc: true}});
  assert.deepEqual(compareControlPatch("stl", false), {patch: {stl: false}});
  assert.deepEqual(compareControlPatch("indicator", "M09"), {patch: {i: "M09"}});
  assert.deepEqual(compareControlPatch("indicator", ""), {patch: {i: null}});
  assert.deepEqual(compareControlPatch("x", "A04"), {patch: {x: "A04"}});
  assert.deepEqual(compareControlPatch("p", "2025"), {patch: {p: "2025"}});
  assert.deepEqual(compareControlPatch("period", {from: "2024", to: "2026"}, {bounds: {from: 2024, to: 2026}}), {patch: {from: 2024, to: 2026}});
  assert.deepEqual(compareControlPatch("period", {from: "", to: ""}), {patch: {from: null, to: null}});
  assert.deepEqual(compareControlPatch("period", {from: "2025", to: ""}), {wait: true});
  assert.deepEqual(compareControlPatch("period", {from: "2026", to: "2025"}, {bounds: {from: 2024, to: 2026}}), {refused: DRAFT_PERIOD_INVALID});
  assert.deepEqual(compareControlPatch("period", {from: "2020", to: "2025"}, {bounds: {from: 2024, to: 2026}}), {refused: DRAFT_PERIOD_INVALID}, "outside the bounds");
  assert.deepEqual(compareControlPatch("nothing", "x"), {});
});

test("a Domain or Frequency that no longer offers the chosen Indicator clears it (the filter bar rule)", () => {
  const st = {...emptyHashState(), i: "A05"};
  assert.deepEqual(compareControlPatch("domain", "labour", {state: st, other: {offered: ["M09", "M10", "M11"]}}), {patch: {d: "labour", i: null}});
  assert.deepEqual(compareControlPatch("domain", "fiscal", {state: st, other: {offered: ["A04", "A05"]}}), {patch: {d: "fiscal"}});
});

test("every patch round-trips through the hash and an all-default state is an empty hash", () => {
  const all = {i: "M09", c: ["DEU", "FRA"], g: "g7", d: "labour", f: "M", from: 2024, to: 2026, x: "M09", y: "M10", p: "2025-09", pc: true, ctx: true, oth: true, stl: true};
  const h = serializeHash(all);
  assert.deepEqual({...parseHash(h), note: undefined}, {...emptyHashState(), ...all, note: undefined});
  assert.equal(serializeHash(emptyHashState()), "");
});

test("the strip renders only its controls, with unique ids and the persistent status region (static markup)", () => {
  const store = {get: () => emptyHashState(), subscribe() {}, set() {}};
  const out = String(compareControls(html, "c2", {store, data: {indicators, domains, groups, entities: [], bounds: null}}));
  for (const k of ["indicator", "group", "frequency", "pc", "oth"]) assert.match(out, new RegExp(`id="c2-ctl-${k}"`), k);
  assert.doesNotMatch(out, /c2-ctl-stl|c2-ctl-ctx|c2-ctl-x"|proj|rb/);
  assert.match(out, /Show percentile/);
  assert.match(out, /Include rows from other reference periods/);
  assert.match(out, /role="group"/);
  const c4 = String(compareControls(html, "c4", {store, data: {indicators, domains, groups, entities: [], bounds: {from: 2024, to: 2026}}}));
  assert.match(c4, /Show stale rows/);
  assert.match(c4, /id="c4-ctl-from"/);
  assert.doesNotMatch(c4, /Include rows from other/);
});
