// L21 (AC-DB-01, 02, 03; AC-RD-31, 34): the filter bar on PG-SERIES drives the rail through the one store.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {explorerContext} from "../src/lib/explorer.js";
import {modelPeriod, narrowedGroups, offeredIds, pickerGroups, railPatch, railValues, resolveIndicator, rowsOfFrequency, storeWatch, wireRailPeriod} from "../src/lib/explorer-filters.js";
import {createFilterStore} from "../src/lib/filter-store.js";
import {summaryParts} from "../src/lib/filter-bar-options.js";
import {explorerPageSource} from "../scripts/lib.mjs";

const manifest = {files: [{path: "series/GDP.json", format: "json"}, {path: "series/CPI.json", format: "json"}, {path: "series/UNE.json", format: "json"}]};
const indicators = [
  {indicator_id: "GDP", name: "GDP", unit_label: "index", domain_ids: ["growth"], frequency_set: ["Q", "A"]},
  {indicator_id: "CPI", name: "CPI", unit_label: "% y/y", domain_ids: ["prices"], frequency_set: ["M"]},
  {indicator_id: "UNE", name: "Unemployment", unit_label: "%", domain_ids: ["labour", "growth"], frequency_set: ["M", "Q"]}
];
const domains = [
  {domain_id: "growth", name: "Growth", indicator_ids: ["GDP", "UNE"]},
  {domain_id: "prices", name: "Prices", indicator_ids: ["CPI"]},
  {domain_id: "labour", name: "Labour", indicator_ids: ["UNE"]}
];
const ctx = explorerContext({manifest, seriesMeta: [], entities: [], indicators, alerts: [], domains});

test("L21: Domain and Frequency narrow the picker by stored fields only (AC-DB-03); no filter keeps the V1 picker", () => {
  assert.deepEqual(offeredIds(narrowedGroups(ctx, {})), ["GDP", "UNE", "CPI"]);
  assert.deepEqual(offeredIds(narrowedGroups(ctx, {d: "growth"})), ["GDP", "UNE"]);
  assert.deepEqual(offeredIds(narrowedGroups(ctx, {f: "M"})), ["UNE", "CPI"]);
  assert.deepEqual(offeredIds(narrowedGroups(ctx, {d: "prices", f: "Q"})), []);
  assert.deepEqual(narrowedGroups(ctx, {d: "growth"}).map((g) => g.label), ["Growth"]);
});

test("L21: a wanted indicator stays when offered; otherwise the first offered one with the fallback flag; an empty list keeps it", () => {
  assert.deepEqual(resolveIndicator(ctx, "UNE", {d: "growth", f: null}), {indicator: "UNE", fell: false});
  assert.deepEqual(resolveIndicator(ctx, "CPI", {d: "growth", f: null}), {indicator: "GDP", fell: true});
  assert.deepEqual(resolveIndicator(ctx, "CPI", {d: "prices", f: "Q"}), {indicator: "CPI", fell: false});
});

test("L21: rows keep the stored frequency (no resampling); period maps both ways", () => {
  const rows = [{frequency: "M", end: 1}, {frequency: "Q", end: 2}];
  assert.deepEqual(rowsOfFrequency(rows, "Q"), [rows[1]]);
  assert.equal(rowsOfFrequency(rows, null), rows);
  assert.deepEqual(modelPeriod({from: null, to: null}), {from: "", to: ""});
  assert.deepEqual(modelPeriod({from: 2015, to: 2020}), {from: 2015, to: 2020});
  assert.deepEqual(railValues({from: 2015, to: 2020}), {from: "2015", to: "2020"});
  assert.deepEqual(railValues({from: null, to: null}), {from: "", to: ""});
});

test("L21: a rail choice becomes a valid stored pair, or nothing", () => {
  const ms = (y) => Date.UTC(y, 0, 1);
  const rows = [{end: ms(2010)}, {end: ms(2020)}];
  assert.deepEqual(railPatch("", "", rows), {ok: true, from: null, to: null});
  assert.deepEqual(railPatch("2012", "2015", rows), {ok: true, from: 2012, to: 2015});
  assert.deepEqual(railPatch("2015", "", rows), {ok: true, from: 2015, to: 2020});
  assert.deepEqual(railPatch("", "2015", rows), {ok: true, from: 2010, to: 2015});
  assert.deepEqual(railPatch("2016", "2012", rows), {ok: false});
  assert.deepEqual(railPatch("2016", "", []), {ok: false});
});

const fakeWin = (hash) => {
  const w = {location: {hash, pathname: "/explorer", search: ""}, history: {length: 1, state: null, writes: [], replaceState(_s, _t, url) { this.writes.push(url); w.location.hash = url.slice(url.indexOf("#")); }}, addEventListener() {}, removeEventListener() {}};
  return w;
};
const option = (value) => ({value});
const fakeSelect = () => {
  const s = {options: [option("")], listeners: [], value: "", ownerDocument: {createElement: () => ({})}, insertBefore(o, ref) { this.options.splice(ref ? this.options.indexOf(ref) : this.options.length, 0, o); }, addEventListener(_t, f) { this.listeners.push(f); }, removeEventListener(_t, f) { this.listeners = this.listeners.filter((x) => x !== f); }};
  for (const y of ["2010", "2012", "2015", "2020"]) s.options.push(option(y));
  return s;
};
const label = (sel) => ({querySelector: () => sel});

test("L21 one state: the rail years and the store stay in sync both ways; a refused choice restores the stored value; other hash parts are kept", () => {
  const win = fakeWin("#i=GDP&d=growth&g=g7");
  const store = createFilterStore({win, known: {bounds: {from: 2010, to: 2020}}, ignore: ["g"]});
  assert.equal(store.get().g, null, "g in the address is ignored (amendment 2.3)");
  assert.equal(store.get().note, false, "ignoring g is not an invalid link");
  const from = fakeSelect();
  const to = fakeSelect();
  const rows = [{end: Date.UTC(2010, 0, 1)}, {end: Date.UTC(2020, 0, 1)}];
  const detach = wireRailPeriod({from: label(from), to: label(to)}, store, rows);
  assert.deepEqual([from.value, to.value], ["", ""]);
  assert.equal(win.history.writes.length, 0, "nothing is written on load");
  store.set({from: 2012, to: 2015}); // the Period chip
  assert.deepEqual([from.value, to.value], ["2012", "2015"]);
  from.value = "2015"; // the rail
  to.value = "2020";
  from.listeners.forEach((f) => f());
  assert.deepEqual([store.get().from, store.get().to], [2015, 2020]);
  assert.equal(win.location.hash, "#i=GDP&d=growth&from=2015&to=2020", "g is never written");
  store.set({g: "g7"});
  assert.equal(store.get().g, null);
  assert.ok(!win.location.hash.includes("g="));
  from.value = "2020"; // refused: from > to
  to.value = "2012";
  to.listeners.forEach((f) => f());
  assert.deepEqual([from.value, to.value], ["2015", "2020"], "restored to the stored pair");
  store.set({from: 2013, to: 2014}); // a year the file has no row for is still shown
  assert.deepEqual([from.value, to.value], ["2013", "2014"]);
  detach();
  assert.equal(from.listeners.length, 0);
});

test("L21: storeWatch yields on a change of the watched part only", () => {
  const win = fakeWin("");
  const store = createFilterStore({win});
  const seen = [];
  const Generators = {observe: (init) => init((v) => seen.push(v))};
  storeWatch(Generators, store, (s) => s.f);
  store.set({i: "GDP"});
  store.set({f: "M"});
  store.set({c: []});
  store.set({f: "Q"});
  assert.deepEqual(seen, [null, "M", "Q"]);
});

test("L21: chips and print line of a bar that renders a subset list only those (AC-DB-01)", () => {
  const state = {c: ["DEU"], d: "growth", f: "M", i: "GDP", from: 2015, to: 2020, g: null};
  const parts = summaryParts(state, "series", {domains, indicators, controls: ["domain", "period", "frequency"]});
  assert.deepEqual(parts.map((p) => p.split(":")[0]), ["Domain", "Period", "Frequency"]);
  assert.equal(summaryParts(state, "series", {domains, indicators}).length, 5, "without the list the page row is used");
});

test("L21: the generated page mounts Domain, Frequency and Period only, reads the store, and keeps the hash grammar (g ignored, no new key)", () => {
  const page = explorerPageSource({files: [{path: "series/M09.json"}]});
  assert.match(page, /mountFilterBar\(html, \{page: "series", only: \["domain", "period", "frequency"\]/);
  assert.match(page, /id="filterbar-slot"/);
  assert.match(page, /wireRailPeriod\(box, store, rows\)/);
  assert.match(page, /initialSelection\(ctx, pHash\)/);
  assert.doesNotMatch(page, /replaceHash/);
  assert.doesNotMatch(page, /\bg:|store\.set\(\{g/, "Group is neither shown nor written");
  const hash = readFileSync(new URL("../src/lib/hash.js", import.meta.url), "utf8");
  assert.match(hash, /const KEYS = \["i", "c", "g", "d", "f", "from", "to", "x", "y", "p", "pc", "ctx", "oth", "stl", "rb"\]/);
});

test("PG-SERIES narrows the picker on load: pickerGroups follows d and f; an empty narrowed list keeps the full picker", () => {
  assert.deepEqual(offeredIds(pickerGroups(ctx, {d: "prices"})), ["CPI"]);
  assert.deepEqual(offeredIds(pickerGroups(ctx, {})), ["GDP", "UNE", "CPI"]);
  assert.deepEqual(offeredIds(pickerGroups(ctx, {d: "prices", f: "Q"})), ["GDP", "UNE", "CPI"]);
});

test("PG-SERIES fallback note: a default replaced because of Domain is silent; an indicator named by the address and not offered sets it", () => {
  assert.deepEqual(resolveIndicator(ctx, "GDP", {d: "prices"}, false), {indicator: "CPI", fell: false});
  assert.deepEqual(resolveIndicator(ctx, "GDP", {d: "prices"}, true), {indicator: "CPI", fell: true});
  assert.deepEqual(resolveIndicator(ctx, "CPI", {d: "prices"}, true), {indicator: "CPI", fell: false});
});

test("PG-SERIES page wiring: the store ignores g, the picker starts narrowed, the note needs an address indicator", () => {
  const src = explorerPageSource(manifest);
  assert.ok(src.includes('ignore: ["g"]'));
  assert.ok(src.includes("pickerGroups(ctx, store.get())"));
  assert.ok(src.includes("store.get().i !== null"));
});
