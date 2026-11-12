import assert from "node:assert/strict";
import {test} from "node:test";
import {busyBlock, emptyBlock, errorBlock, errorTitle, failureBlocks, failureKind, loadAll, noscriptHtml, setBusy, settle} from "../src/lib/state-blocks.js";
import {pageHead, headerHtml} from "../src/lib/shell.js";
import {ManifestError, parseManifest} from "../src/lib/manifest.js";
import {listOf} from "../src/lib/meta.js";
import {DRAFT_CONSEQUENCE, DRAFT_NOSCRIPT, DRAFT_REGIONS, EMPTY_GROUP, NO_SERIES} from "../src/lib/copy.js";
import config from "../observablehq.config.js";
import {readFileSync} from "node:fs";
import {createScorecardLoader, mountHomeDashboard, mountHomeFailure} from "../src/lib/home-dashboard.js";
import {hiddenRowsBlock} from "../src/lib/rank-view.js";
import {DRAFT_EMPTY_CARD, DRAFT_HIDDEN_ROWS} from "../src/lib/copy.js";

// Minimal stand-in for htl's `html` (see shell.test.mjs).
class Raw {
  constructor(s) {
    this.s = s;
  }
}
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const part = (v) => (v instanceof Raw || v instanceof Lazy ? v.s : Array.isArray(v) ? v.map(part).join("") : esc(v));
const html = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? part(vals[i]) : ""), ""));

const URLISH = /https?:|\/_file|\.json|\.parquet|data\/|undefined|\[object|Error:|ENOENT|404|fetch/i;
const NO_DIGITS = /\d/;

test("error block: role=alert, names the region and the consequence, kind as data attribute", () => {
  for (const kind of ["missing", "invalid", "version"]) {
    const out = errorBlock(html, {region: DRAFT_REGIONS.scorecard, kind, consequence: DRAFT_CONSEQUENCE.scorecard, id: "x"}).s;
    assert.ok(out.includes('role="alert"') && out.includes(`data-kind="${kind}"`) && out.includes('id="x"'), kind);
    assert.ok(out.includes("the scorecard of this domain") && out.includes(DRAFT_CONSEQUENCE.scorecard), kind);
    assert.ok(!URLISH.test(out) && !NO_DIGITS.test(out), `${kind}: ${out}`);
  }
  assert.match(errorTitle("R", "missing"), /^Could not load R\.$/);
  assert.match(errorTitle("R", "version"), /not supported/);
  assert.match(errorTitle("R", "invalid"), /format check/);
});

test("failureKind: version stays version, a JSON syntax error is invalid, a plain failure takes the fallback", () => {
  assert.equal(failureKind(new ManifestError("x", "version")), "version");
  assert.equal(failureKind(new ManifestError("x")), "invalid");
  assert.equal(failureKind(new SyntaxError("x")), "invalid");
  assert.equal(failureKind(new Error("Unable to load file"), "missing"), "missing");
  assert.equal(failureKind(null), "invalid");
});

test("settle: a failed load is missing, a failed parse is invalid; the raw message is dropped", async () => {
  const miss = await settle({key: "a", region: "R", load: async () => { throw new Error("secret-ish raw text https://x.example/a.json"); }});
  assert.deepEqual(miss, {ok: false, key: "a", region: "R", kind: "missing"});
  const bad = await settle({key: "a", region: "R", load: async () => ({}), parse: (d) => listOf(d, "domains")});
  assert.deepEqual(bad, {ok: false, key: "a", region: "R", kind: "invalid"});
  const ver = await settle({key: "m", region: "R", load: async () => ({schema_version: "2.0", files: []}), parse: parseManifest});
  assert.equal(ver.kind, "version");
  const ok = await settle({key: "d", region: "R", load: async () => ({schema_version: "1.0", domains: [1]}), parse: (d) => listOf(d, "domains")});
  assert.deepEqual(ok, {ok: true, key: "d", region: "R", value: [1]});
});

test("loadAll: collects every failed region, keeps loaded ones, and skips derive on failure", async () => {
  let derived = 0;
  const good = {schema_version: "1.0", files: []};
  const r = await loadAll(
    [
      {key: "manifest", region: "M", load: async () => good, parse: parseManifest},
      {key: "meta", region: "T", load: async () => { throw new Error("404 https://u"); }},
      {key: "status", region: "S", load: async () => ({}), parse: () => { throw new Error("schema"); }}
    ],
    () => { derived++; return {}; }
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures.map((f) => [f.key, f.kind]), [["meta", "missing"], ["status", "invalid"]]);
  assert.equal(r.data.manifest, good);
  assert.equal(derived, 0);
  assert.equal(r.derived, null);
  const okAll = await loadAll([{key: "manifest", region: "M", load: async () => good, parse: parseManifest}], (d) => ({n: d.manifest.files.length}), "D");
  assert.deepEqual([okAll.ok, okAll.derived], [true, {n: 0}]);
  const dFail = await loadAll([{key: "manifest", region: "M", load: async () => good}], () => { throw new Error("shape"); }, "The derived region");
  assert.deepEqual(dFail.failures, [{key: "derived", region: "The derived region", kind: "invalid"}]);
});

test("failureBlocks: one alert per failed region, no URL, no raw text, no number", async () => {
  const r = await loadAll([
    {key: "scorecard", region: DRAFT_REGIONS.scorecard, load: async () => { throw new Error("Unable to load file: /_file/data/scorecard/labour.abc123.json (404) 12345"); }},
    {key: "meta", region: DRAFT_REGIONS.meta, load: async () => ({}), parse: (d) => listOf(d, "series")}
  ]);
  const out = failureBlocks(html, r.failures, DRAFT_CONSEQUENCE.scorecard).s;
  assert.equal((out.match(/role="alert"/g) ?? []).length, 2);
  assert.ok(!URLISH.test(out) && !NO_DIGITS.test(out), out);
});

test("busy block: aria-busy true and role=status while loading, text names what loads; setBusy toggles", () => {
  const out = busyBlock(html, DRAFT_REGIONS.loadingData).s;
  assert.ok(out.includes('aria-busy="true"') && out.includes('role="status"') && out.includes("Loading the dashboard data..."));
  assert.ok(busyBlock(html, "x", {visible: false}).s.includes('aria-busy="false"'));
  const attrs = {};
  const el = {setAttribute: (k, v) => { attrs[k] = v; }, hidden: false};
  setBusy(el, true);
  assert.deepEqual([attrs["aria-busy"], el.hidden], ["true", false]);
  setBusy(el, false);
  assert.deepEqual([attrs["aria-busy"], el.hidden], ["false", true]);
  setBusy(null, true); // no element: no effect
});

test("empty block: the confirmed sentence verbatim, then a next step, id kept", () => {
  const g = emptyBlock(html, {id: "empty-group", text: EMPTY_GROUP, next: "Next."}).s;
  assert.ok(g.includes('id="empty-group"') && g.includes(`${EMPTY_GROUP} <span class="mm-next">Next.</span>`));
  assert.ok(emptyBlock(html, {id: "no-series", text: NO_SERIES, next: "N."}).s.includes(NO_SERIES));
});

test("noscript notice is static markup in the header of every page", () => {
  assert.equal(noscriptHtml(), `<noscript><p class="mm-noscript" role="note">${DRAFT_NOSCRIPT}</p></noscript>`);
  for (const p of config.pages) assert.ok(headerHtml({title: "T", pages: config.pages, path: p.path}).includes("<noscript>"));
});

test("pageHead: status line when the manifest loaded, alerts for failures, nothing else", () => {
  const manifest = {known_cutoff: "2026-11-01T00:00:00Z", build_id: "b1", schema_version: "1.0", files: []};
  const NOW = Date.parse("2026-11-04T00:00:00Z");
  const fine = pageHead(html, {ok: true, data: {manifest}, failures: []}, "lists", NOW).s;
  assert.ok(fine.includes("Data cut-off") && !fine.includes("mm-state"));
  const part_ = pageHead(html, {ok: false, data: {manifest}, failures: [{key: "alerts", region: DRAFT_REGIONS.alerts, kind: "missing"}]}, "lists", NOW).s;
  assert.ok(part_.includes("Data cut-off") && part_.includes('role="alert"') && part_.includes(DRAFT_CONSEQUENCE.lists));
  const none = pageHead(html, {ok: false, data: {}, failures: [{key: "manifest", region: DRAFT_REGIONS.manifest, kind: "version"}]}, "lists", NOW).s;
  assert.ok(!none.includes("Data cut-off") && none.includes("not supported") && none.includes(DRAFT_CONSEQUENCE.lists));
  const stale = pageHead(html, {ok: true, data: {manifest: {...manifest, known_cutoff: "2026-01-01T00:00:00Z"}}, failures: []}, "lists", NOW).s;
  assert.ok(stale.includes('id="stale-banner"') && stale.includes('role="alert"'));
});

// ---- L15: card-level states (layout amendment 5, AC-DB-03, AC-DB-12, AC-RD-14, ADR-036) -----------------------------------------------

// A just-enough element for mountHomeDashboard / mountHomeFailure: serialises to markup, so the page structure can be asserted offline.
class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.dataset = {};
    this.attrs = {};
    this.kids = [];
    this.textContent = "";
    this.hidden = false;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  replaceChildren(...n) {
    this.kids = n;
  }
  get markup() {
    const data = Object.entries(this.dataset).map(([k, v]) => ` data-${k}="${v}"`).join("");
    const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
    return `<${this.tag} class="${this.className}"${data}${attrs}>${this.textContent}${this.kids.map(inner).join("")}</${this.tag}>`;
  }
}
const inner = (v) => (v instanceof FakeEl ? v.markup : v instanceof Raw || v instanceof Lazy ? v.s : Array.isArray(v) ? v.map(inner).join("") : esc(v));
// Lazy: the slots are filled after the template is built, so the markup is assembled when it is read.
class Lazy {
  constructor(strings, vals) {
    this.dataset = {};
    this.strings = strings;
    this.vals = vals;
  }
  get s() {
    return this.strings.reduce((a, s, i) => a + s + (i < this.vals.length ? inner(this.vals[i]) : ""), "");
  }
}
const fhtml = (strings, ...vals) => new Lazy(strings, vals);
const fakeDoc = {createElement: (tag) => new FakeEl(tag)};

test("mountHomeFailure: every card slot holds exactly one alert of the failed region, nothing is busy, no table, chart or number", () => {
  const root = mountHomeFailure(fhtml, {failures: [{key: "manifest", region: DRAFT_REGIONS.manifest, kind: "version"}], doc: fakeDoc});
  const out = root.s;
  assert.equal((out.match(/role="alert"/g) ?? []).length, 6, "one alert per slot, six slots");
  for (const name of ["overview", "compare", "facts", "domain", "indicators", "overTime"]) {
    assert.ok(out.includes(`data-slot="${name}"`) && out.includes(`id="mm-error-card-${name}"`), name);
  }
  assert.ok(!out.includes('aria-busy="true"'), "nothing left busy");
  assert.ok(out.includes("not supported") && out.includes(DRAFT_REGIONS.manifest) && out.includes(DRAFT_CONSEQUENCE.scorecard));
  assert.ok(!/<table|<svg/.test(out) && !URLISH.test(out));
  assert.ok(!/\d/.test(out.replace(/mm-(?:error-card|dashboard|dband|grid|card|band)[\w-]*|band-[\w-]+|span-\d+|h2|<h[1-6]/g, "")), "no digit in the visible text");
  const none = mountHomeFailure(fhtml, {failures: [], doc: fakeDoc}).s;
  assert.ok(none.includes(DRAFT_REGIONS.meta), "no failure given: the generic meta region is named");
});

test("a card that throws does not stop the other cards of the dashboard", () => {
  let tick = null;
  const store = {get: () => ({}), subscribe: (fn) => (tick = fn), attach() {}};
  const data = {domains: [{domain_id: "a", name: "A", ranked: true, indicator_ids: []}], indicators: []};
  const dash = mountHomeDashboard(fhtml, {store, data, loadScorecard: () => new Promise(() => {}), doc: fakeDoc});
  let before = 0;
  let after = 0;
  let fail = false;
  dash.onChange(() => before++);
  dash.onChange(() => { if (fail) throw new Error("card bug"); });
  dash.onChange(() => after++);
  fail = true;
  assert.doesNotThrow(() => tick());
  assert.equal(before, 2);
  assert.equal(after, 2, "the card after the failing one still rendered");
});

test("scorecard loader: a failed domain does not poison the next Domain change nor its own retry", async () => {
  const calls = [];
  let aFails = true;
  const load = createScorecardLoader({
    a: async () => { calls.push("a"); if (aFails) throw new Error("404"); return {id: "a"}; },
    b: async () => { calls.push("b"); return {id: "b"}; }
  });
  await assert.rejects(load("a"));
  assert.deepEqual(await load("b"), {id: "b"});
  aFails = false;
  assert.deepEqual(await load("a"), {id: "a"}, "the retry reaches the loader again");
  assert.deepEqual(await load("b"), {id: "b"});
  assert.deepEqual(calls, ["a", "b", "a"], "a successful domain is requested once, a failed one again");
});

test("busy block: a status region with aria-busy and the reserved height in style.css; a hidden idle form", () => {
  const out = busyBlock(html, DRAFT_REGIONS.scorecard, {id: "rank-loading"}).s;
  assert.ok(out.includes('role="status"') && out.includes('aria-busy="true"') && out.includes('id="rank-loading"') && out.includes("mm-loading"));
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  const m = /\.mm-loading\s*\{[^}]*min-height:\s*([\d.]+)rem/.exec(css);
  assert.ok(m && Number(m[1]) >= 8, "the loading block reserves at least 8rem");
  assert.ok(busyBlock(html, "x", {visible: false}).s.includes('aria-busy="false"'));
});

test("empty card sentence is the confirmed copy and carries no number", () => {
  assert.equal(DRAFT_EMPTY_CARD, "No values for this selection.");
  const out = emptyBlock(html, {id: "rank-empty", text: DRAFT_EMPTY_CARD, next: ""}).s;
  assert.ok(out.includes(DRAFT_EMPTY_CARD) && out.includes('data-state="empty"') && !/\d/.test(out));
});

test("hidden-rows disclosure (ADR-036): shown only by the sentence, list and carried links; heatmap and KPI modules do not use it", () => {
  assert.equal(hiddenRowsBlock(html, {hiddenSentence: "", hiddenRows: []}), "");
  const model = {hiddenSentence: DRAFT_HIDDEN_ROWS(2), hiddenRows: [{entityId: "DEU", hasCountryPage: true, text: "Germany: latest value 2019 Q4"}, {entityId: "XX", hasCountryPage: false, text: "Xland: latest value 2018"}]};
  const out = hiddenRowsBlock(html, model).s;
  assert.ok(out.includes("<summary>2 rows hidden by the period filter</summary>") && out.includes("data-carry") && out.includes('data-entity="XX"'));
  const src = (f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8");
  for (const f of ["rank-view.js", "heatmap-card.js", "kpi-view.js", "state-blocks.js"]) {
    assert.ok(!/hidden(?:Rows)?\.length|countPeriodHiddenRows|splitByPeriod/.test(src(f)), `${f} neither counts nor splits rows by Period (the count comes from rank-model through countPeriodHiddenRows)`);
  }
  for (const f of ["heatmap-card.js", "kpi-view.js"]) assert.ok(!/hiddenRowsBlock|hiddenSentence|DRAFT_HIDDEN_ROWS/.test(src(f)), `${f}: Period hides no rows here`);
});
