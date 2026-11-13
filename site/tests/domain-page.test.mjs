// L24: PG-DOMAIN arrangement (amendment 4.5, AC-DB-01/10/11) and the generated pages of PG-DOMAIN and PG-REVISIONS, offline.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {domainPageSource, revisionsPageSource} from "../scripts/lib.mjs";
import {controlsFor} from "../src/lib/filter-bar-options.js";
import {domainPage} from "../src/lib/domain-page.js";
import {cardView} from "../src/lib/heatmap.js";
import {domainView} from "../src/lib/scorecard.js";
import {html} from "./support/html-standin.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sparse_export");
const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const meta = {entities: load("meta/entities.json").entities, indicators: load("meta/indicators.json").indicators, domains: load("meta/domains.json").domains, groups: load("meta/groups.json").groups};
const dom = meta.domains[0];
const scorecard = load(`scorecard/${dom.domain_id}.json`);
const store = {get: () => ({}), subscribe() {}};
const pcStore = (state) => ({get: () => ({pc: true, ...state}), subscribe() {}});

test("the bar of PG-DOMAIN is Group and Frequency only (amendment 2.4)", () => assert.deepEqual(controlsFor("domain"), ["group", "frequency"]));

test("the domain page is one band (h2: name, link to the list) over one card; the percentile heatmap C5 is absent unless pc is on (AC-V2-51 amended)", () => {
  const off = String(domainPage(html, domainView(scorecard, meta), {store, inputs: {scorecard, ...meta}}));
  assert.match(off, new RegExp(`<h2 id="band-domain-heading">${dom.name}</h2><a href="\\.\\./domains">All domains</a>`));
  assert.equal((off.match(/<h2[ >]/g) ?? []).length, 1);
  assert.doesNotMatch(off, /id="domain-heatmap"|mm-orientation|c5-secondary|percentile vs all ranked/, "no percentile layer without pc");
  assert.match(off, /id="domain-indicators"/);
  assert.match(off, /id="pc-toggle"/);
  assert.equal((off.match(/class="mm-card[ "]/g) ?? []).length, 1, "cards do not nest");
  const rd = meta.domains.find((d) => d.ranked === true) ?? dom;
  const rsc = load(`scorecard/${rd.domain_id}.json`);
  const on = String(domainPage(html, domainView(rsc, meta), {store: {get: () => ({pc: true}), subscribe() {}}, inputs: {scorecard: rsc, ...meta}}));
  assert.match(on, /<details class="mm-secondary" id="c5-secondary" data-card="c5">/);
  assert.doesNotMatch(on, /<details class="mm-secondary"[^>]* open/, "collapsed");
  assert.match(on, /id="domain-heatmap"/);
  assert.equal((on.match(/class="mm-orientation"/g) ?? []).length, 1, "the orientation sentence goes with the layer");
  assert.ok(on.indexOf("domain-indicators") < on.indexOf("c5-secondary"), "after the primary content");
  assert.equal((on.match(/class="mm-card[ "]/g) ?? []).length, 1, "cards do not nest");
});

test("the generated PG-DOMAIN page mounts the bar for page domain, one h1, no write to the address on load", () => {
  const s = domainPageSource(dom.domain_id, dom.name);
  assert.equal((s.match(/<h1>/g) ?? []).length, 1);
  assert.match(s, /id="filterbar-slot"/);
  assert.match(s, /mountFilterBar\(html, \{page: "domain"/);
  assert.match(s, /domainPage\(html, dv, /);
  assert.match(s, new RegExp(`scorecard/${dom.domain_id}\\.json`));
});

test("the generated PG-REVISIONS page gets a band and a card around unchanged content: every original cell is still present", () => {
  const s = revisionsPageSource({files: [{path: "revisions/T01.parquet"}]});
  assert.match(s, /<section class="mm-dband" id="band-revisions"><div class="mm-band"><h2>Revisions<\/h2><\/div><div class="mm-grid"><div class="mm-card mm-card--span-12 mm-card--revisions" id="revisions-card"><h3>Revisions and vintages<\/h3>/);
  assert.ok(s.trimEnd().endsWith("</div></div></section>"));
  for (const part of ["noticeBlock(html)", "ordinaryBlock(html, rv)", "editionsBlock(html, rv, revisionUrls)", "historyBlock(html, hv", "revisions/T01.parquet"]) assert.ok(s.includes(part), part);
});

test("PG-DOMAIN heatmap ignores a carried Country: the page renders the same with and without c in the store state", () => {
  const g = meta.groups[0].group_id;
  const outside = meta.entities.find((e) => !e.is_global && !meta.groups[0].members.some((m) => m.entity_id === e.entity_id)).entity_id;
  const at = (state) => String(domainPage(html, domainView(scorecard, meta), {store: pcStore(state), inputs: {scorecard, ...meta}}));
  assert.equal(at({g, c: [outside]}), at({g, c: []}));
  // sensitivity: the unfiltered cardView would add the carried Country as an outside row
  const rowIds = (c) => cardView(scorecard, {...meta, state: {g, c}}).rows.map((r) => r.entityId);
  assert.ok(rowIds([outside]).includes(outside) && !rowIds([]).includes(outside));
});
