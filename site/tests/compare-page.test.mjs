// V22, V23 (AC-V2-51 amended, 70, 80; AC-RD-01/02/05): the arrangement of PG-COMPARE and PG-INDICATOR on the SYNTHETIC v2 fixture.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {comparePageSource, indicatorPageSource} from "../scripts/lib.mjs";
import {CAVEAT, DRAFT_COMPARE_CHOOSE_INDICATOR, DRAFT_COMPARE_SERIES_PENDING, ORIENTATION_NOTE} from "../src/lib/copy.js";
import {emptyHashState} from "../src/lib/hash.js";
import {COMPARE_CHARTS} from "../src/lib/compare-controls.js";
import {comparePage, pcNotes} from "../src/lib/compare-page.js";
import {html} from "./support/html-standin.mjs";
import {domains, entities, fakePlot, groups, indicators, manifest, scorecards, series} from "./support/load-v2.mjs";

const inputs = {entities, groups, domains, indicators, series, scorecards, knownCutoff: manifest.known_cutoff, bounds: {from: 2024, to: 2026}, manifest};
const store = (state = {}) => ({get: () => ({...emptyHashState(), ...state}), subscribe() {}, set() {}});
const page = (state, fixed = null) => String(comparePage(html, fakePlot().Plot, inputs, null, {store: store(state), fixedIndicator: fixed}));

test("the cards come in order C1, C2, C6, C3, C4, T2 (V55) and the controls of each are only those that act on it; C6 has no control of its own", () => {
  const out = page({i: "M09"});
  const at = (s) => out.indexOf(`data-slot="${s}"`);
  assert.ok(at("c1") < at("c2") && at("c2") < at("c6") && at("c6") < at("c3") && at("c3") < at("c4") && at("c4") < at("t2"));
  assert.doesNotMatch(out, /id="c6-ctl-/);
  assert.match(out, /id="c1-ctl-ctx"/);
  assert.doesNotMatch(out, /id="c1-ctl-stl"|id="c2-ctl-stl"|id="c4-ctl-oth"|id="c3-ctl-oth"/);
  assert.match(out, /id="c4-ctl-stl"/);
  assert.match(out, /id="c2-ctl-oth"/);
  assert.match(out, /id="c3-ctl-x"/);
});

test("the percentile layer is absent by default: caveat yes, orientation sentence no, no C5, no percentile column (ADR-037 decision 3, AC-V2-51 amended)", () => {
  const out = page({i: "A04"});
  assert.ok(out.includes(CAVEAT));
  assert.ok(!out.includes(ORIENTATION_NOTE) && !out.includes("c5-secondary"));
  assert.doesNotMatch(out, /percentile vs all ranked countries/);
});

test("pc on: the orientation sentence follows the caveat once and the C5 block is a closed <details> after the primary cards", () => {
  const out = page({i: "M09", pc: true});
  assert.equal(out.split(ORIENTATION_NOTE).length - 1, 1, "one orientation sentence on the page, the pc note");
  assert.ok(out.indexOf("mm-caveat") < out.indexOf("mm-orientation"));
  assert.match(out, /<details class="mm-secondary" id="c5-secondary" data-card="c5">/);
  assert.doesNotMatch(out, /<details class="mm-secondary"[^>]* open/);
  assert.ok(out.indexOf('data-slot="t2"') < out.indexOf("c5-secondary"));
  assert.match(out, /percentile vs all ranked countries/, "T2 gains its percentile column");
  assert.equal(String(pcNotes(html, false)).includes("mm-orientation"), false);
});

test("no indicator chosen: C1, C2 and C4 ask for one (no silent default); C3 asks for two", () => {
  const out = page({});
  assert.ok(out.split(DRAFT_COMPARE_CHOOSE_INDICATOR).length - 1 >= 3);
  assert.match(out, /Choose two indicators to compare\./);
});

test("series files are read after load: the cards that need one say so until it arrives", () => {
  assert.ok(page({i: "M09"}).includes(DRAFT_COMPARE_SERIES_PENDING));
});

test("PG-INDICATOR fixes the indicator: no Indicator control, the fixed indicator drives the cards without a hash key", () => {
  const out = page({}, "A04");
  assert.doesNotMatch(out, /id="c1-ctl-indicator"|id="c2-ctl-indicator"|id="c4-ctl-indicator"/);
  assert.ok(!out.includes(DRAFT_COMPARE_CHOOSE_INDICATOR) || out.split(DRAFT_COMPARE_CHOOSE_INDICATOR).length === 1);
  assert.match(out, /data-fixed="A04"/);
  assert.match(out, /id="c2"/);
});

test("the generated /compare page: one h1, static mode switch, every scorecard and series attachment literal, no m or proj key (AC-RD-01/02/05)", () => {
  const src = comparePageSource({files: [{path: "series/M09.parquet"}, {path: "series/P01.json"}]}, ["labour", "prices"]);
  assert.equal(src.match(/<h1\b/g).length, 1);
  assert.match(src, /data-mode="compare"/);
  assert.match(src, /aria-current="page"/);
  assert.ok(src.includes('FileAttachment("./data/scorecard/labour.json")') && src.includes('FileAttachment("./data/scorecard/prices.json")'));
  assert.ok(src.includes('"M09": FileAttachment("./data/series/M09.parquet")') && src.includes('"P01": FileAttachment("./data/series/P01.json")'));
  assert.match(src, /comparePage\(html, Plot, inputs/);
  assert.doesNotMatch(src, /[?&#]m=|proj=/);
  assert.match(comparePageSource(), /const seriesFiles = \{\};/);
  assert.throws(() => comparePageSource(null, ["a/b"]));
});

test("PG-INDICATOR keeps the series download link in T2 (ADR-037; the previous indicator page had it): href passed through, absent without one", () => {
  const withHref = String(comparePage(html, fakePlot().Plot, inputs, null, {store: store({}), fixedIndicator: "A04", downloadHref: "../_file/data/series/A04.abc.parquet"}));
  assert.match(withHref, /<a href="\.\.\/_file\/data\/series\/A04\.abc\.parquet" download id="indicator-download" data-link="download">/);
  assert.doesNotMatch(page({}, "A04"), /id="indicator-download"/);
});

test("the generated PG-INDICATOR page registers the lazy parquet FileAttachment of the indicator and passes its address to comparePage; /compare passes none", () => {
  const ind = indicators.find((i) => i.indicator_id === "A04");
  const src = indicatorPageSource(ind, domains, "LEVEL", {files: [{path: "series/A04.parquet"}, {path: "series/M09.parquet"}]});
  assert.ok(src.includes('const seriesFile = FileAttachment("../data/series/A04.parquet");'));
  assert.match(src, /downloadHref = \(await seriesFile\?\.url\(\)\) \?\? null;/);
  assert.match(src, /links: [^\n]*, downloadHref, geo: geoFiles\}\)\);/);
  assert.ok(indicatorPageSource(ind, domains, "LEVEL", null).includes("const seriesFile = null;"));
  assert.ok(comparePageSource({files: [{path: "series/M09.parquet"}]}, ["labour"]).includes("const seriesFile = null;"));
});

test("V55: C6 sits after C2 on /compare and on /indicator/<id>, reads the shared state, and draws from the stored geometry when it is supplied", () => {
  const geo = {asset: JSON.parse(readFileSync(new URL("../src/geo/europe-countries.geojson", import.meta.url), "utf8")), join: JSON.parse(readFileSync(new URL("../src/geo/entity_geo_join.json", import.meta.url), "utf8"))};
  for (const fixed of [null, "A04"]) {
    const out = String(comparePage(html, fakePlot().Plot, inputs, null, {store: store(fixed ? {} : {i: "A04"}), fixedIndicator: fixed, geo}));
    assert.ok(out.indexOf('id="c2"') < out.indexOf('id="c6"') && out.indexOf('id="c6"') < out.indexOf('id="c3"'), String(fixed));
    assert.match(out, /data-card="c6"/);
    assert.match(out, /Map of values/);
  }
});

test("V55: C6 without an indicator says to choose one, and with no geometry supplied it states that the shapes could not be read while the table lists every row", () => {
  assert.ok(page({}).includes(DRAFT_COMPARE_CHOOSE_INDICATOR));
  const out = page({i: "A04"});
  assert.match(out, /data-card="c6" data-state="empty"/);
  assert.match(out, /map shapes could not be read/);
  assert.match(out, /<tr data-entity="DEU">/);
});

test("the applicability matrix lists exactly the control strips the page renders (no strip for C5, T2 or C6; T2 renders always)", () => {
  for (const state of [{i: "M09"}, {i: "M09", pc: true}]) {
    const out = page(state);
    const rendered = [...out.matchAll(/data-chart-controls="([a-z0-9]+)"/g)].map((m) => m[1]);
    assert.deepEqual(rendered, [...COMPARE_CHARTS], `strips rendered = matrix charts (pc ${state.pc === true})`);
    assert.match(out, /data-slot="t2"/, "T2 renders with and without pc");
    assert.doesNotMatch(out, /id="(t2|c5|c6)-ctl-/);
  }
});
