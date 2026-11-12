// L17: the indicator table card of PG-HOME (amendment 4.9 phase A, AC-DB-03, AC-DB-26, ADR-036). Pure model + markup on the SYNTHETIC sparse fixture.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_EMPTY_CARD, DRAFT_HIDDEN_ROWS} from "../src/lib/copy.js";
import {domainTable} from "../src/lib/country-view.js";
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
  assert.equal(m.hiddenSentence, "");
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

test("Period hides valued rows outside the range, lists them, never hides rows without a value (ADR-036)", () => {
  const m = tableModel({...base, state: {from: 2019, to: 2020}});
  const valued = tableModel(base).domain.withValue.length;
  assert.equal(m.kind, "table", "the rows without a value stay");
  assert.equal(m.domain.withValue.length, 0);
  assert.equal(m.domain.withoutValue.length, tableModel(base).domain.withoutValue.length);
  assert.equal(m.hiddenSentence, DRAFT_HIDDEN_ROWS(valued));
  assert.equal(m.hiddenRows.length, valued);
  assert.ok(m.hiddenRows[0].text.includes("latest value"));
  const kept = tableModel({...base, state: {from: 2025, to: 2025}});
  assert.equal(kept.hiddenSentence, "");
  assert.equal(kept.domain.withValue.length, valued);
  const block = String(hiddenRowsBlock(html, m));
  assert.ok(block.includes("mm-hidden-rows") && block.includes('href="./indicator/'));
  assert.equal(String(hiddenRowsBlock(html, kept)), "");
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
  assert.deepEqual(m.hiddenRows.map((h) => h.indicatorId), expected);
  assert.notDeepEqual(expected, ids, "the test must differ from the domain order");
});

test("the disclosure sits directly under the card title (amendment 2.2)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "table-card.js"), "utf8");
  assert.ok(src.includes("dash.fill(slot, title, status, controls, body)"));
  assert.ok(!src.includes("title, controls, status"));
});
