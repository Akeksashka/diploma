// L17: the indicator table card of PG-HOME (amendment 4.9 phase A, AC-DB-03, AC-DB-26, ADR-036). Pure model + markup on the SYNTHETIC sparse fixture.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_EMPTY_CARD, DRAFT_HIDDEN_LIST_ITEM, DRAFT_HIDDEN_REASON_LABELS, DRAFT_HIDDEN_SUMMARY, DRAFT_NOT_STATED} from "../src/lib/copy.js";
import {domainTable} from "../src/lib/country-view.js";
import {countHiddenRowsByReason} from "../src/lib/filter-model.js";
import {HOME_TABLE_HREFS, hiddenRowsBlock, tableIndicatorIds, tableModel} from "../src/lib/table-card.js";
import {html} from "./support/html-standin.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sparse_export");
const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const entities = load("meta/entities.json").entities;
const indicators = load("meta/indicators.json").indicators;
const series = load("meta/series.json").series;
const domains = load("meta/domains.json").domains;
const growth = domains.find((d) => d.domain_id === "growth");
const scorecard = load("scorecard/growth.json");
const base = {focusIds: ["SY01"], entities, domain: growth, scorecard, indicators, series, state: {}};

test("band hidden unless exactly one known Country is in focus", () => {
  assert.equal(tableModel({...base, focusIds: []}).kind, "hidden");
  assert.equal(tableModel({...base, focusIds: ["SY01", "SY02"]}).kind, "hidden");
  assert.equal(tableModel({...base, focusIds: ["NOPE"]}).kind, "hidden");
  assert.equal(tableModel(base).kind, "table");
});

test("rows are the Domain's indicators, rows without a value last (country table order)", () => {
  const m = tableModel(base);
  assert.deepEqual(m.domain.rows.map((r) => r.indicatorId), [...m.domain.withValue, ...m.domain.withoutValue].map((r) => r.indicatorId));
  assert.ok(m.domain.withoutValue.length > 0 && m.domain.withValue.length > 0);
  assert.deepEqual(m.hidden, []);
  assert.equal(String(hiddenRowsBlock(html, m)).includes("<details"), false);
});

test("Trend is absent in phase A and the table renders without a recent field (AC-DB-26)", () => {
  const m = tableModel(base);
  const out = String(domainTable(html, m.domain, m.entity.name, m.entity.id, null, HOME_TABLE_HREFS));
  assert.ok(!/trend|sparkline|role="img"/i.test(out));
  assert.equal((out.match(/<th scope="col"/g) ?? []).length, 6);
  assert.ok(!JSON.stringify(scorecard).includes('"recent"'));
});

test("home links are page-relative to the site root and the country page defaults are unchanged", () => {
  const m = tableModel(base);
  const home = String(domainTable(html, m.domain, m.entity.name, m.entity.id, null, HOME_TABLE_HREFS));
  assert.ok(home.includes('href="./indicator/T01"') && home.includes('href="./indicator/T01#c=SY01"') && home.includes('href="./explorer#i=T01&amp;c=SY01"'));
  assert.ok(!home.includes("../indicator/"));
  const dflt = String(domainTable(html, m.domain, m.entity.name, m.entity.id));
  assert.ok(dflt.includes('href="../indicator/T01"') && dflt.includes('href="../indicator/T01#c=SY01"'));
});

test("Frequency narrows the Domain's indicators by stored frequency_set", () => {
  const f = indicators.find((i) => growth.indicator_ids.includes(i.indicator_id)).frequency_set[0];
  const other = ["D", "M", "Q", "A"].find((x) => !indicators.some((i) => growth.indicator_ids.includes(i.indicator_id) && i.frequency_set.includes(x)));
  assert.deepEqual(tableIndicatorIds({domain: growth, indicators, frequency: null}), growth.indicator_ids);
  assert.ok(tableIndicatorIds({domain: growth, indicators, frequency: f}).length > 0);
  if (other) {
    const m = tableModel({...base, state: {f: other}});
    assert.deepEqual([m.kind, m.text], ["empty", DRAFT_EMPTY_CARD]);
  }
});

test("Period hides valued rows outside the range, lists them in the A1.4 region, never hides rows without a value (ADR-036)", () => {
  const m = tableModel({...base, state: {from: 2019, to: 2020}});
  const valued = tableModel(base).domain.withValue.length;
  assert.equal(m.kind, "table", "the rows without a value stay");
  assert.equal(m.domain.withValue.length, 0);
  assert.equal(m.domain.withoutValue.length, tableModel(base).domain.withoutValue.length);
  assert.equal(m.hidden.length, valued);
  assert.ok(m.hidden.every((h) => h.reason === "other_period"));
  assert.deepEqual(countHiddenRowsByReason(m.hidden), {total: valued, no_data: 0, stale: 0, other_period: valued, other: 0});
  const kept = tableModel({...base, state: {from: 2025, to: 2025}});
  assert.deepEqual(kept.hidden, []);
  assert.equal(kept.domain.withValue.length, valued);
  const block = String(hiddenRowsBlock(html, m));
  assert.ok(block.startsWith('<div role="status" class="mm-hidden-slot"><details class="mm-hidden-rows">'));
  assert.ok(block.includes(DRAFT_HIDDEN_SUMMARY({total: valued, no_data: 0, stale: 0, other_period: valued, other: 0})));
  assert.ok(block.includes('href="./indicator/') && block.includes('data-reason="other_period"'));
  const first = m.hidden[0].row;
  assert.ok(block.includes(DRAFT_HIDDEN_LIST_ITEM(first.name, DRAFT_HIDDEN_REASON_LABELS.other_period, first.periodText, first.state?.sentence ?? DRAFT_NOT_STATED)), "label, reason category, stored period, reason sentence");
  assert.equal(String(hiddenRowsBlock(html, kept)), '<div role="status" class="mm-hidden-slot"></div>', "the persistent region is empty at N = 0");
});

test("hidden rows are listed by name A to Z, ties by id, whatever the domain order (ADR-036 I4)", () => {
  const ids = tableModel(base).domain.withValue.map((r) => r.indicatorId);
  assert.ok(ids.length >= 2);
  // The last id gets the first name, the others share one name: the tie falls back to the id.
  const renamed = indicators.map((i) => {
    const at = ids.indexOf(i.indicator_id);
    if (at < 0) return i;
    return {...i, name: at === ids.length - 1 ? "A first" : "Same name"};
  });
  const m = tableModel({...base, indicators: renamed, state: {from: 2019, to: 2020}});
  const names = new Map(renamed.map((i) => [i.indicator_id, i.name]));
  const expected = [...ids].sort((a, b) => names.get(a).localeCompare(names.get(b), "en") || (a < b ? -1 : 1));
  const block = String(hiddenRowsBlock(html, m));
  const listed = [...block.matchAll(/data-id="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(listed, expected);
  assert.notDeepEqual(expected, ids, "the test must differ from the domain order");
});

test("the disclosure sits directly under the card title (amendment 2.2)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "table-card.js"), "utf8");
  assert.ok(src.includes("dash.fill(slot, title, status, controls, body)"));
  assert.ok(!src.includes("title, controls, status"));
});

// ---- V15 (T1 latest-values table and the percentile layer; AC-V2-25, 26; ADR-037 decision 3)
import {CAVEAT, DRAFT_SHOW_PERCENTILE, ORIENTATION_NOTE, PERCENTILE_COLUMN_LABEL} from "../src/lib/copy.js";
import {pcToggle} from "../src/lib/country-view.js";
import {countryPage} from "../src/lib/country-page.js";
import {createFilterStore} from "../src/lib/filter-store.js";
import {modelOf as v2Model} from "./support/load-v2.mjs";

test("V15 (AC-V2-25): by default the table has no percentile column, chip or number; the State column carries the stored currency state", () => {
  const m = tableModel(base);
  const off = String(domainTable(html, m.domain, m.entity.name, m.entity.id, null, HOME_TABLE_HREFS));
  assert.ok(!off.includes(PERCENTILE_COLUMN_LABEL) && !/class="mm-pct"|data-bin="[1-5]"/.test(off));
  assert.match(off, /<th scope="col">State<\/th>/);
  const on = String(domainTable(html, m.domain, m.entity.name, m.entity.id, null, HOME_TABLE_HREFS, {percentile: true}));
  assert.ok(on.includes(`<th scope="col">${PERCENTILE_COLUMN_LABEL}</th>`));
  assert.match(on, /class="mm-pct"/);
  assert.equal((off.match(/<th scope="col"/g) ?? []).length, (on.match(/<th scope="col"/g) ?? []).length, "the column is replaced, not added");
});

test("V15: a stale, lagging or unaligned value keeps its state code and sentence in the State column when the layer is off", () => {
  const stale = structuredClone(scorecard);
  stale.entities.find((e) => e.entity_id === "SY01").indicators.find((c) => c.indicator_id === "T01").is_stale = true;
  const m = tableModel({...base, scorecard: stale});
  const out = String(domainTable(html, m.domain, m.entity.name, m.entity.id, null, HOME_TABLE_HREFS));
  assert.match(out, /<td class="mm-state-cell" data-label="State" data-state="stale" data-signature="[^"]+"><span class="mm-cell">/);
  assert.match(out, /<span class="mm-code">stale<\/span>/);
});

test("V15 (AC-V2-26, C-CTRY-6): the caveat is on the page once whatever pc is; the orientation sentence is on it if and only if pc is on (even with no stored percentile, decided 2026-11-13)", () => {
  const model = v2Model("DEU");
  assert.equal(model.showsPercentiles, true);
  const plot = {plot: () => "<svg></svg>", rectX: (d, o) => ({d, o}), ruleX: (d, o) => ({d, o}), dot: (d, o) => ({d, o})};
  const page = (pc) => String(countryPage(html, plot, model, [], null, null, {percentile: pc}));
  const off = page(false);
  assert.equal(off.split(CAVEAT).length - 1, 1, "the standing caveat is printed once per page without pc");
  assert.ok(!off.includes(ORIENTATION_NOTE));
  assert.ok(!off.includes(PERCENTILE_COLUMN_LABEL) && !off.includes('data-tile="domain-figure"') && !off.includes("mm-card--strip"));
  const on = page(true);
  assert.ok(on.includes(`<p class="mm-caveat">${CAVEAT}</p><p class="mm-orientation">${ORIENTATION_NOTE}</p>`), "caveat first, then the orientation sentence");
  assert.equal(on.split(ORIENTATION_NOTE).length - 1, 1, "once");
  assert.ok(on.includes(PERCENTILE_COLUMN_LABEL));
  const none = {...model, showsPercentiles: false};
  assert.equal(String(countryPage(html, plot, none, [], null, null, {percentile: true})).split(ORIENTATION_NOTE).length - 1, 1, "pc=1 prints the orientation sentence even if no row has a stored percentile");
});

test("V15: the Show percentile control is a native checkbox that writes pc through the filter store and follows it", () => {
  const win = {location: {hash: "", pathname: "/country/DEU", search: ""}, history: {state: null, replaceState(_s, _t, url) { win.location.hash = url.slice(url.indexOf("#") < 0 ? url.length : url.indexOf("#")); }}, addEventListener() {}, removeEventListener() {}};
  const store = createFilterStore({win});
  const out = String(pcToggle(html, store));
  assert.match(out, /<label class="mm-percentile-toggle"><input type="checkbox" id="show-percentile" checked=false> Show percentile<\/label>/);
  assert.equal(DRAFT_SHOW_PERCENTILE, "Show percentile");
  store.set({pc: true});
  assert.equal(win.location.hash, "#pc=1");
  assert.equal(String(pcToggle(html, store)).includes("checked=true"), true);
  store.set({pc: false});
  assert.equal(win.location.hash, "", "off is the default: an empty hash");
});

test("V15: the Home indicator table follows the same rule (percentile column only with pc, ADR-037 decision 3)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "table-card.js"), "utf8");
  assert.match(src, /\{percentile: ctx\.state\.pc === true\}/);
});
