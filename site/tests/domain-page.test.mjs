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

test("the bar of PG-DOMAIN is Group and Frequency only (amendment 2.4)", () => assert.deepEqual(controlsFor("domain"), ["group", "frequency"]));

test("the domain page is one band (h2: name, link to the list) over one card (h3) holding the heatmap block; one h2 only", () => {
  const out = String(domainPage(html, domainView(scorecard, meta), {store, inputs: {scorecard, ...meta}}));
  assert.match(out, new RegExp(`<h2 id="band-domain-heading">${dom.name}</h2><a href="\\.\\./domains">All domains</a>`));
  assert.equal((out.match(/<h2[ >]/g) ?? []).length, 1);
  assert.match(out, new RegExp(`<div class="mm-card mm-card--span-12" id="domain-card">[\\s\\S]*<h3>${dom.name}</h3>`));
  assert.match(out, /id="domain-heatmap"/);
  assert.equal((out.match(/class="mm-card[ "]/g) ?? []).length, 1, "cards do not nest");
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
  const at = (state) => String(domainPage(html, domainView(scorecard, meta), {store: {get: () => state, subscribe() {}}, inputs: {scorecard, ...meta}}));
  assert.equal(at({g, c: [outside]}), at({g, c: []}));
  // sensitivity: the unfiltered cardView would add the carried Country as an outside row
  const rowIds = (c) => cardView(scorecard, {...meta, state: {g, c}}).rows.map((r) => r.entityId);
  assert.ok(rowIds([outside]).includes(outside) && !rowIds([]).includes(outside));
});
