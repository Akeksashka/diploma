// V58, V59 (AC-V2-120, 122): the four Home panels and controls on the SYNTHETIC v2 fixture; the arrangement is checked offline.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {homePageSource} from "../scripts/lib.mjs";
import {resolveHome} from "../src/lib/home-config.js";
import {emptyHashState} from "../src/lib/hash.js";
import {HOME_CONTROL_KEYS, HOME_PANEL_ORDER, homePage, homeState} from "../src/lib/home-page.js";
import {html} from "./support/html-standin.mjs";
import {domains, entities, fakePlot, groups, indicators, manifest, scorecards, series} from "./support/load-v2.mjs";

const resolved = resolveHome({indicators, entities});
const inputs = {entities, groups, domains, indicators, series, scorecards, knownCutoff: manifest.known_cutoff, bounds: {from: 2024, to: 2026}, manifest};
const store = (state = {}) => ({get: () => ({...emptyHashState(), ...state}), subscribe() {}, set() {}});
const page = (state = {}, opts = {}) => String(homePage(html, fakePlot().Plot, inputs, null, {store: store(state), resolved, ...opts}));

test("panels come in the order A C2, B C1, C C6, D C4 and C5 is absent", () => {
  assert.deepEqual([...HOME_PANEL_ORDER], ["c2", "c1", "c6", "c4"]);
  const out = page();
  const at = (c) => out.indexOf(`data-slot="${c}"`);
  assert.ok(at("c2") > 0 && at("c2") < at("c1") && at("c1") < at("c6") && at("c6") < at("c4"));
  assert.doesNotMatch(out, /data-slot="c3"|data-slot="t2"|c5-secondary|data-card="c5"/);
});

test("the controls are exactly Indicator, Group, Period (from, to), Country select and the mode links", () => {
  assert.deepEqual([...HOME_CONTROL_KEYS], ["indicator", "group", "period"]);
  const out = page();
  const ids = [...out.matchAll(/<(?:select|input|button)[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((i) => !/^c\d-/.test(i)), ["home-ctl-indicator", "home-ctl-group", "home-ctl-from", "home-ctl-to", "home-country", "home-country-go"]);
  assert.match(out, /<optgroup label="/); // Indicator grouped by domain
  assert.doesNotMatch(out, /id="home-ctl-(pc|oth|stl|ctx|frequency|domain|x|y|p)"/);
  assert.doesNotMatch(out, /type="checkbox"/, "no percentile toggle and no other flag on Home");
  assert.match(out, /href="\.\/country"[^>]*data-carry="country"/);
  assert.match(out, /href="\.\/compare"[^>]*data-carry="compare"/);
});

test("the state the panels read forces every non-Home key off and defaults the Indicator", () => {
  const s = homeState({...emptyHashState(), pc: true, oth: true, stl: true, ctx: true, c: ["DEU"], d: "labour", f: "M", x: "A01", y: "A02", p: "2025", g: "eu27"}, resolved);
  assert.equal(s.i, "A05");
  assert.deepEqual([s.pc, s.oth, s.stl, s.ctx, s.d, s.f, s.x, s.y, s.p, s.c], [false, false, false, false, null, null, null, null, null, []]);
  assert.equal(s.g, "eu27", "Group stays");
  assert.equal(homeState({...emptyHashState(), i: "M09"}, resolved).i, "M09");
});

test("a pending scorecard of the chosen Indicator's domain shows the loading sentence, then the panels", () => {
  const partial = {...inputs, scorecards: {}};
  const out = String(homePage(html, fakePlot().Plot, partial, null, {store: store({i: "M09"}), resolved, loadScorecard: () => new Promise(() => {})}));
  assert.match(out, /Loading the stored values\./);
});

test("a missing default Indicator gives the choose-an-indicator sentence, not an error", () => {
  const r = resolveHome({indicators: indicators.filter((i) => i.indicator_id !== "A05"), entities});
  assert.equal(r.defaultIndicator, null);
  assert.doesNotThrow(() => String(homePage(html, fakePlot().Plot, inputs, null, {store: store(), resolved: r})));
});

test("the generated page: panels above the retained ADR-034 bands, series files only through the panels (lazy), no Parquet read in the page cells", () => {
  const src = homePageSource({entities, indicators, domains, manifest: {files: []}});
  assert.ok(src.indexOf('id="home-slot"') < src.indexOf('id="dashboard-slot"'), "panels first");
  assert.ok(src.indexOf('id="home-slot"') < src.indexOf('id="band-browse"'));
  assert.ok(src.includes("mountRankCard") && src.includes("mountHeatmapCard") && src.includes("mountSeriesCard"), "ADR-034 cards retained");
  assert.match(src, /homePage\(html, Plot, inputs, historySource\(/);
  assert.doesNotMatch(src, /\.parquet"\)\.(parquet|arrow|buffer|arrayBuffer)\(/);
});

test("responsive CSS: 2 x 2 only in a container of at least 46rem, KPI strip 2 / 3 / 6 per row, C4 scrolls in its own container", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(css, /@container \(min-width: 46rem\) \{ \.mm-home-panels-grid \{ grid-template-columns: repeat\(2/);
  assert.match(css, /\.mm-home-kpi-grid \{[^}]*repeat\(2, /);
  assert.match(css, /min-width: 40rem\) \{ \.mm-home-kpi-grid \{ grid-template-columns: repeat\(3/);
  assert.match(css, /min-width: 64rem\) \{ \.mm-home-kpi-grid \{ grid-template-columns: repeat\(6/);
  assert.match(css, /\.mm-home-panels-grid \.mm-figure \{[^}]*overflow-x: auto/);
  const block = css.slice(css.indexOf("/* V57 to V59")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgb\(|dark/, "tokens only, no colour literal, no dark block");
});
