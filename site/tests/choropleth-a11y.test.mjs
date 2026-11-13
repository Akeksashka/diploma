// V54 (C6; AC-V2-112, 117): the accessible name, the table alternative with a skip link, no tab stop per country, the no-JS notice, and where the geometry asset is loaded (and its weight).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {comparePageSource, countryPageSource, domainPageSource, explorerPageSource, indicatorPageSource} from "../scripts/lib.mjs";
import {DRAFT_C6_SKIP_TO_TABLE, DRAFT_C6_TABLE_CAPTION, DRAFT_NOSCRIPT, VIEW_AS_TABLE} from "../src/lib/copy.js";
import {choroplethBlock, choroplethTableRows} from "../src/lib/choropleth.js";
import {choroplethModel} from "../src/lib/choropleth-model.js";
import {comparePage} from "../src/lib/compare-page.js";
import {emptyHashState} from "../src/lib/hash.js";
import {noscriptHtml} from "../src/lib/state-blocks.js";
import {html} from "./support/html-standin.mjs";
import {domains, entities, fakePlot, groups, indicators, manifest, scorecards, series} from "./support/load-v2.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const asset = JSON.parse(readFileSync(join(root, "src", "geo", "europe-countries.geojson"), "utf8"));
const joinTable = JSON.parse(readFileSync(join(root, "src", "geo", "entity_geo_join.json"), "utf8"));
const model = (id, state = {}) => choroplethModel({indicator: indicators.find((i) => i.indicator_id === id), scorecards, entities, groups, series, state: {...emptyHashState(), ...state}, knownCutoff: manifest.known_cutoff, join: joinTable, asset});
const stand = {plot: () => "<svg></svg>", geo: () => ({}), dot: () => ({})};
const block = (m) => String(choroplethBlock(html, stand, m, {id: "c6-test"}));

test("the figure is one image with an accessible name that holds the title, the unit and the reference period (AC-V2-117)", () => {
  const out = block(model("A04"));
  const label = out.match(/<figure class="mm-figure" id="c6-test-figure" role="img" aria-label="([^"]*)"/)?.[1];
  assert.ok(label, "figure role=img with an aria-label");
  assert.match(label, /General government balance/);
  assert.match(label, /reference period 2025/);
  assert.match(label, /% of GDP/);
  assert.equal((out.match(/role="img"/g) ?? []).length, 1);
});

test("no country is a tab stop: no tabindex, no per-country link or button inside the figure; tips are pointer-only (AC-V2-117)", () => {
  const out = block(model("A04"));
  assert.doesNotMatch(out, /tabindex/i);
  const figure = out.slice(out.indexOf("<figure"), out.indexOf("</figure>"));
  assert.doesNotMatch(figure, /<a\s|<button|<input|<select/);
  const src = readFileSync(join(root, "src", "lib", "choropleth.js"), "utf8");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /tabindex|addEventListener\("(?:key|focus)|Plot\.pointer/i);
});

test("the table alternative lists every stored row (entity, value, unit, period, state), aggregates and outside-extent countries included, and a skip link reaches it (AC-V2-117)", () => {
  const m = model("A04");
  const out = block(m);
  assert.match(out, new RegExp(`<a href="#c6-test-view" id="c6-test-skip">${DRAFT_C6_SKIP_TO_TABLE}</a>`));
  assert.ok(out.includes('<details class="mm-view-table" id="c6-test-view">') && out.includes(VIEW_AS_TABLE));
  assert.ok(out.indexOf("c6-test-skip") < out.indexOf("<figure"), "the skip link comes before the figure");
  const rows = choroplethTableRows(m);
  assert.equal(rows.length, m.rows.length);
  assert.deepEqual(rows.map((r) => r.entityId).sort(), m.rows.map((r) => r.entityId).sort());
  for (const r of rows) assert.ok(out.includes(`<tr data-entity="${r.entityId}">`), r.entityId);
  for (const id of ["EU27", "EA", "USA"]) assert.ok(rows.find((r) => r.entityId === id).state.length > 0, id);
  assert.match(out, /% of GDP/);
  assert.ok(out.includes(DRAFT_C6_TABLE_CAPTION(m.name, "2025")));
  assert.ok(rows.filter((r) => r.value !== "not stated").length >= m.mapped.length);
});

test("a table row for a country that is not drawn says why (stored state), and a drawn one carries its stored value and period", () => {
  const rows = choroplethTableRows(model("A04"));
  const usa = rows.find((r) => r.entityId === "USA");
  assert.match(usa.state, /^outside the map extent; /);
  const deu = rows.find((r) => r.entityId === "DEU");
  assert.notEqual(deu.value, "not stated");
  assert.equal(deu.period, "2025");
});

test("no-JS: the page notice is the no-JS notice of the shell, and the card text is data only (V54)", () => {
  assert.ok(noscriptHtml().includes(DRAFT_NOSCRIPT));
  assert.equal(comparePage(html, fakePlot().Plot, {entities, groups, domains, indicators, series, scorecards, knownCutoff: manifest.known_cutoff, bounds: {from: 2024, to: 2026}, manifest}, null, {}).toString().includes('data-slot="c6"'), true);
});

test("the geometry asset and the join table are attached only by the pages that render C6 (Compare and the indicator pages), lazily (AC-V2-112)", () => {
  const withGeo = [comparePageSource({files: []}, ["fiscal"]), indicatorPageSource(indicators.find((i) => i.indicator_id === "A04"), domains)];
  for (const src of withGeo) {
    assert.match(src, /geoFiles = \{asset: FileAttachment\("(?:\.\/|\.\.\/)geo\/europe-countries\.geojson"\), join: FileAttachment\("(?:\.\/|\.\.\/)geo\/entity_geo_join\.json"\)\}/);
    assert.match(src, /geo: geoFiles/);
    assert.doesNotMatch(src, /\.json\(\)[^\n]*geo\//, "FileAttachment is lazy: nothing is fetched by the page cell");
  }
  const others = [countryPageSource(entities.find((e) => e.kind === "country"), groups, ["fiscal"], null), domainPageSource("fiscal", "Fiscal"), explorerPageSource({files: []})];
  for (const src of others) assert.doesNotMatch(src, /geo\/|europe-countries/);
});

test("the geometry asset is at most 100 KB gzipped, with a provenance sidecar (AC-V2-112)", () => {
  const gz = gzipSync(readFileSync(join(root, "src", "geo", "europe-countries.geojson"))).length;
  assert.ok(gz <= 100 * 1024, `${gz} bytes gzipped`);
  const prov = JSON.parse(readFileSync(join(root, "src", "geo", "geo-source.json"), "utf8"));
  for (const k of ["source", "url", "licence", "version", "accessed"]) assert.ok(prov[k], k);
});
