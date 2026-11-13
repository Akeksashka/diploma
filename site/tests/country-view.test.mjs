// Redesign R7: country page rendering on the SYNTHETIC sparse fixture, with the htl stand-in (string output).
// AC-RD-10, 11, 12, 13, 15, 42, 45 (markup level; the browser checks are in tests/smoke/country.smoke.mjs).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {BIN_EDGES} from "../src/lib/bins.js";
import * as copy from "../src/lib/copy.js";
import {countryModel} from "../src/lib/country-model.js";
import {countryPage as countryBlock} from "../src/lib/country-page.js";
import {domainHref, indicatorHref, seriesHref, switcherOptions} from "../src/lib/country-view.js";
import {BANDS, PROFILE_TICKS, profileChart, profileFigure, profileRows} from "../src/lib/profile-chart.js";
import {html} from "./support/html-standin.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sparse_export");
const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const entities = load("meta/entities.json").entities;
const indicators = load("meta/indicators.json").indicators;
const series = load("meta/series.json").series;
const domains = load("meta/domains.json").domains;
const scorecards = Object.fromEntries(domains.map((d) => [d.domain_id, load(`scorecard/${d.domain_id}.json`)]));
const model = (id) => countryModel({entity: entities.find((e) => e.entity_id === id), domains, scorecards, indicators, series, groups: []});
// The page without the percentile layer (the default) and with it (pc on: v2.percentile, ADR-037 decision 3).
const page = (id) => String(countryBlock(html, fakePlot, model(id), switcherOptions(entities)));
const pagePc = (id) => String(countryBlock(html, fakePlot, model(id), switcherOptions(entities), null, null, {percentile: true}));
// Plot stand-in: records the marks, returns a marker string so profileFigure can wrap it.
const calls = [];
const fakePlot = {
  plot: (o) => {
    calls.push(o);
    return "<svg></svg>";
  },
  rectX: (d, o) => ({type: "rectX", d, o}),
  ruleX: (d, o) => ({type: "ruleX", d, o}),
  dot: (d, o) => ({type: "dot", d, o})
};

test("the bands are the ADR-026 bin edges", () => {
  assert.deepEqual(BANDS.map((b) => b.x1).slice(1), [...BIN_EDGES]);
  assert.deepEqual(BANDS.map((b) => b.x2).slice(0, 4), [...BIN_EDGES]);
  assert.deepEqual(PROFILE_TICKS, [0, ...BIN_EDGES, 1]);
});

test("profile rows are the rows with a stored percentile only; hollow for estimate or inherited (AC-RD-13)", () => {
  const g = model("SY01").domains.find((d) => d.domainId === "growth");
  const rows = profileRows(g);
  assert.deepEqual(rows.map((r) => r.indicatorId), g.rows.filter((r) => r.percentile !== null && ["ranked", "ahead"].includes(r.state.key)).map((r) => r.indicatorId));
  assert.ok(rows.length > 0);
  assert.equal(rows.find((r) => r.indicatorId === "T02").hollow, true);
  assert.equal(rows.find((r) => r.indicatorId === "T01").hollow, false);
  for (const r of rows) assert.equal(r.percentile, g.rows.find((x) => x.indicatorId === r.indicatorId).percentile);
});

test("a stale, lagging or unaligned cell with a stored percentile is not plotted, as the table shows no number (AC-RD-13)", () => {
  for (const patch of [{is_stale: true}, {alignment: "lagging"}, {alignment: "unaligned"}]) {
    const sc = structuredClone(scorecards);
    const cell = sc.growth.entities.find((e) => e.entity_id === "SY01").indicators.find((c) => c.indicator_id === "T02");
    Object.assign(cell, patch);
    assert.equal(cell.percentile, 0.5, "the cell keeps a stored percentile");
    const g = countryModel({entity: entities.find((e) => e.entity_id === "SY01"), domains, scorecards: sc, indicators, series, groups: []}).domains.find((d) => d.domainId === "growth");
    const row = g.rows.find((r) => r.indicatorId === "T02");
    assert.notEqual(row.percentile, null);
    assert.ok(!["ranked", "ahead"].includes(row.state.key), JSON.stringify(patch));
    assert.deepEqual(profileRows(g).map((r) => r.indicatorId), ["T01"], JSON.stringify(patch));
  }
});

test("a domain with no stored percentile draws no chart; the figure is role=img with the generated label", () => {
  const empty = model("SY20").domains.find((d) => d.domainId === "growth");
  assert.equal(profileChart(fakePlot, profileRows(empty)), null);
  assert.equal(String(profileFigure(html, fakePlot, empty, "X")), "");
  const g = model("SY01").domains.find((d) => d.domainId === "growth");
  const f = String(profileFigure(html, fakePlot, g, "Synthetic SY01"));
  assert.match(f, /<figure class="mm-figure" id="profile-growth" role="img" aria-label="percentile of each indicator for Synthetic SY01, domain Synthetic growth; table below lists the same values">/);
});

test("every indicator of a domain is in its table exactly once; links carry #i= / #c= (AC-RD-10)", () => {
  const out = page("SY01");
  for (const d of domains) {
    for (const id of d.indicator_ids) {
      const re = new RegExp(`id="table-${d.domain_id}"[\\s\\S]*?</table>`);
      const table = re.exec(out)[0];
      assert.equal(table.split(`<tr data-indicator="${id}"`).length, 2, `${d.domain_id}/${id}`);
    }
  }
  assert.equal(indicatorHref("T01", "SY01"), "../indicator/T01#c=SY01");
  assert.equal(seriesHref("T01", "SY01"), "../explorer#i=T01&c=SY01");
  assert.equal(domainHref("growth"), "../domain/growth");
  assert.match(out, /href="\.\.\/domain\/growth"/);
  assert.match(out, /href="\.\.\/explorer#i=T01&amp;c=SY01"/);
  assert.match(out, new RegExp(`>${copy.INDICATOR_SERIES_LINK}<`));
  assert.match(out, new RegExp(`>${copy.COMPARE_COUNTRIES}<`));
});

test("values carry their unit, the estimate mark, and (pc on) the stored percentile with its bin (AC-RD-11, 42, 45)", () => {
  const out = pagePc("SY01");
  assert.match(out, /<td class="mm-num" data-label="Latest value"><span class="mm-fig">10<\/span> <span class="mm-unit">SYNTH_UNIT<\/span>/);
  assert.match(out, /data-mark="estimate"/);
  assert.match(out, /data-state="ranked" data-signature="solid" data-bin="2"><span class="mm-cell"><span class="mm-fig">0\.20<\/span>/);
  assert.match(out, /percentile vs all ranked countries/);
  // V15 (AC-V2-25, 26): by default no percentile column, chip or number; the State column replaces it
  const off = page("SY01");
  assert.doesNotMatch(off, /percentile vs all ranked countries|data-bin="[1-5]"|mm-pct/);
  assert.match(off, /<th scope="col">State<\/th>/);
  assert.match(off, /<td class="mm-num" data-label="Latest value"><span class="mm-fig">10<\/span> <span class="mm-unit">SYNTH_UNIT<\/span>/);
});

test("rows without a value sit in a second group with code and sentence; the filter hides only that group (AC-RD-15, 40)", () => {
  const out = page("SY07");
  assert.match(out, /<tbody data-group="without-value"><tr class="mm-group-row"><th scope="rowgroup" colspan="6">Indicators without a value in this export<\/th>/);
  assert.match(out, new RegExp(`<span class="mm-code">n/a</span></span> <span class="mm-sentence">${copy.DRAFT_NA_DEFINED_SENTENCE}`));
  assert.match(out, /<fieldset id="country-filter-growth"/, "one Show control per table card (L22)");
  assert.match(out, new RegExp(`${copy.DRAFT_COUNTRY_FILTER_VALUE}`));
  // AC-RD-15: the Show filter of the table card prints no count. (K1 above it has its own hidden-rows disclosure, AC-V2-13, ADR-036.)
  for (const card of out.split('data-table-card="').slice(1)) assert.doesNotMatch(card.split("</section>")[0], /\b\d+ (rows? )?hidden/);
  assert.match(out, /class="mm-hidden-rows"/, "K1 lists the indicators without a stored value in its disclosure");
});

test("ranked domain shows the stored label and figure; unranked domain shows no percentile fields (AC-RD-12; pc on)", () => {
  const out = pagePc("SY01");
  const growth = /id="domain-growth"[\s\S]*?<\/section>/.exec(out)[0];
  assert.match(growth, /mean percentile of the domain&#39;s indicators|mean percentile of the domain's indicators/);
  assert.match(growth, /0\.35/);
  assert.match(growth, /data-tile="domain-figure"[^>]*>/, "domain-figure tile (AC-DB-21)");
  assert.match(growth, /data-field="percentile-rank">0\.35<\/span>/);
  assert.match(growth, /2 of 4 indicators available; position 3 of 3/);
  const agri = /id="domain-agri"[\s\S]*?<\/section>/.exec(out)[0];
  assert.doesNotMatch(agri, /data-tile="domain-figure"|role="img"/); // K1 cards (data-tile="k1") are not the percentile tile
  assert.match(agri, /informational, unranked/);
  const agg = /id="domain-growth"[\s\S]*?<\/section>/.exec(pagePc("SYA1"))[0];
  assert.match(agg, /aggregate \(not ranked\)/);
});

test("the switcher lists the given countries and marks the current one", () => {
  const out = page("SY03");
  assert.match(out, /<option value="SY03" selected=true>/);
  assert.equal(out.split("<option ").length, 1 + entities.length);
});

test("the switcher has an explicit Go button and no change-triggered navigation (WCAG 3.2.2)", () => {
  assert.match(page("SY03"), /<button type="button" id="country-switcher-go" class="mm-country-go">Go<\/button>/);
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "country-view.js"), "utf8");
  const fn = /export function countrySwitcher[\s\S]*?\n}\n/.exec(src)[0];
  assert.doesNotMatch(fn, /addEventListener\("change"/);
  assert.match(fn, /"click"/);
  assert.match(fn, /e\.key === "Enter"/);
});

test("L22: band per domain in stored order; tile span 4, strip span 8 (pc on), table card span 12; no Trend column, no sparkline", () => {
  const out = pagePc("SY01");
  const ids = [...out.matchAll(/<section class="mm-dband mm-country-domain" id="domain-([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, domains.map((d) => d.domain_id).filter((id) => model("SY01").domains.some((x) => x.domainId === id)));
  const growth = /id="domain-growth"[\s\S]*?<\/section>/.exec(out)[0];
  assert.match(growth, /mm-card--tile mm-card--span-4 mm-tile" data-tile="domain-figure"/);
  assert.match(growth, /mm-card--span-8 mm-card--strip/);
  assert.match(growth, /mm-card--span-12 mm-card--table" data-table-card="growth"/);
  assert.match(growth, /<h2 id="h-growth"><a href="\.\.\/domain\/growth" data-link="domain" data-carry>/);
  assert.match(growth, /data-link="indicator-name" data-carry/);
  assert.doesNotMatch(out, /Trend|sparkline/i);
  assert.equal(out.split("<h1").length, 1, "the h1 is the static page heading, not the block");
});

test("L22: without a store the switcher sits above the bands; the page has the hidden empty card", () => {
  const out = page("SY01");
  assert.ok(out.indexOf("country-switcher") < out.indexOf('id="domain-growth"'));
  assert.match(out, /id="country-empty" hidden/);
});

test("L22: the ranked=false domain has no tile and no strip; a low-coverage or aggregate figure follows the stored fields (AC-DB-21)", () => {
  const agri = /id="domain-agri"[\s\S]*?<\/section>/.exec(page("SY01"))[0];
  assert.doesNotMatch(agri, /mm-card--span-4|mm-card--strip|percentile-rank/);
  const agg = /id="domain-growth"[\s\S]*?<\/section>/.exec(page("SYA1"))[0];
  assert.doesNotMatch(agg, /percentile-rank/);
});
