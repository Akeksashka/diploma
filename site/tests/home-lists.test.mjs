// Redesign R17/R18: static lists of PG-HOME and PG-DOMAINS (spec 4.1 C-HOME-2..4, 4.5; AC-RD-02, 05, 62), offline.
import assert from "node:assert/strict";
import {test} from "node:test";
import {domainsPageSource, homePageSource} from "../scripts/lib.mjs";
import {CAVEAT, DRAFT_HOME_LINKS} from "../src/lib/copy.js";
import {domainsListHtml} from "../src/lib/domains-list.js";
import {applyFilter, countryGroups, homeListsHtml, indicatorGroups, matches} from "../src/lib/home-lists.js";

const entities = [
  {entity_id: "WLD", name: "World", kind: "aggregate", is_global: true},
  {entity_id: "EA", name: "Euro area", kind: "aggregate", is_global: false},
  {entity_id: "USA", name: "United States", kind: "country", is_global: false},
  {entity_id: "DEU", name: "Germany", kind: "country", is_global: false},
  {entity_id: "AUS", name: "Australia", kind: "country", is_global: false}
];
const domains = [
  {domain_id: "labour", name: "Labour", ranked: true, notices: [], indicator_ids: ["M09"]},
  {domain_id: "agri", name: "Agri & food", ranked: false, notices: [], indicator_ids: ["A01"]},
  {domain_id: "fin", name: "Finance", ranked: false, notices: ["note <b>"], indicator_ids: []}
];
const indicators = [
  {indicator_id: "M09", name: "Unemployment rate", domain_ids: ["labour"]},
  {indicator_id: "A01", name: "Food prices", domain_ids: ["agri", "labour"]},
  {indicator_id: "Z01", name: "Orphan", domain_ids: ["gone"]}
];

test("countries alphabetical, aggregates separate, global entity (no page) excluded", () => {
  const g = countryGroups(entities);
  assert.deepEqual(g.countries.map((c) => c.id), ["AUS", "DEU", "USA"]);
  assert.deepEqual(g.aggregates.map((c) => c.id), ["EA"]);
});

test("indicators grouped by domain; one in two domains is in both; unknown domain goes to the last group; empty domains omitted", () => {
  const g = indicatorGroups(indicators, domains);
  assert.deepEqual(g.map((x) => x.id), ["labour", "agri", "other"]);
  assert.deepEqual(g[0].items.map((i) => i.id), ["A01", "M09"]);
  assert.deepEqual(g[1].items.map((i) => i.id), ["A01"]);
});

test("home lists: every non-global entity and every indicator is a link; anchors, labelled sections and the three page links exist", () => {
  const h = homeListsHtml({entities, indicators, domains});
  for (const id of ["AUS", "DEU", "USA", "EA"]) assert.ok(h.includes(`href="./country/${id}"`), id);
  assert.ok(!h.includes("country/WLD"));
  for (const id of ["M09", "A01", "Z01"]) assert.ok(h.includes(`href="./indicator/${id}"`), id);
  assert.ok(h.includes('<section id="countries"') && h.includes('<section id="indicators"'));
  assert.ok(h.includes('aria-labelledby="countries-heading"') && h.includes('id="indicators-heading"'));
  assert.equal((h.match(/<details /g) ?? []).length, 3);
  assert.ok(h.includes("Agri &amp; food") && !h.includes("Agri & food"));
  assert.ok(h.indexOf("country-list") < h.indexOf('id="aggregates"'));
  for (const [k, href] of [["series", "./explorer"], ["domains", "./domains"], ["revisions", "./revisions"]]) assert.ok(h.includes(`<a href="${href}">${DRAFT_HOME_LINKS[k]}</a>`), k);
});

test("unsafe ids are refused", () => {
  assert.throws(() => homeListsHtml({entities: [{entity_id: '../x"', name: "x", kind: "country"}], indicators: [], domains: []}), /unsafe/);
  assert.throws(() => domainsListHtml([{domain_id: "a/b", name: "x"}]), /unsafe/);
});

test("home page source: title, caveat, shell only; no heatmap, overall figure, status block, Guide, Data status or withdrawn sentences", () => {
  const s = homePageSource({entities, indicators, domains});
  assert.equal((s.match(/<h1>/g) ?? []).length, 1);
  assert.ok(s.includes(`<p class="mm-caveat" id="caveat">${CAVEAT}</p>`));
  assert.ok(/display\(pageHead\(html, boot, "lists"\)\);/.test(s));
  for (const bad of ["heatmap", "Heatmap", "scorecard/", "Guide", "Data status", "/status", "/guide", "Projections are not shown", "all lines share one unit", "Look at one series", "Domain overviews", "domain-heatmap", "mm-overall"]) assert.ok(!s.includes(bad), bad);
  assert.ok(s.includes("mountFilters(document)"));
});

test("domains list: name, notices and a link per domain; unranked without notices shows the informational wording; escaped", () => {
  const h = domainsListHtml(domains);
  assert.equal((h.match(/<li>/g) ?? []).length, 3);
  assert.ok(h.includes('<a href="./domain/labour">Labour</a></li>'));
  assert.ok(h.includes("<em>(informational, unranked)</em>"));
  assert.ok(h.includes("note &lt;b&gt;"));
  assert.ok(!h.includes("<table"));
  const s = domainsPageSource(domains);
  assert.ok(s.includes("<h1>Domains</h1>") && s.includes('id="domain-list"'));
  assert.ok(!s.includes("mountFilters") && !s.includes("Guide") && !s.includes("Data status"));
});

// Minimal DOM double for applyFilter.
function el(tag, text, children = [], extra = {}) {
  const e = {tag, hidden: false, open: false, dataset: {}, textContent: text, children, tagName: tag.toUpperCase(), ...extra};
  return e;
}
test("filter: matches is case-insensitive substring; applyFilter hides non-matching items and empty groups, opens matching details, restores on empty", () => {
  assert.ok(matches("Unemployment rate", " EMPLOY ") && matches("x", "") && !matches("Food", "labour"));
  const a = el("li", "Unemployment rate"), b = el("li", "Food prices"), c = el("li", "Orphan");
  const d1 = el("details", "", [a, b], {dataset: {open: "0"}}), d2 = el("details", "", [c], {dataset: {open: "0"}});
  const section = {querySelectorAll: (sel) => (sel === "li" ? [a, b, c] : [d1, d2])};
  for (const d of [d1, d2]) d.querySelectorAll = () => d.children;
  assert.equal(applyFilter(section, "food"), 1);
  assert.deepEqual([a.hidden, b.hidden, c.hidden, d1.hidden, d2.hidden, d1.open], [true, false, true, false, true, true]);
  assert.equal(applyFilter(section, ""), 3);
  assert.deepEqual([a.hidden, b.hidden, c.hidden, d1.hidden, d2.hidden, d1.open], [false, false, false, false, false, false]);
  assert.equal(applyFilter(section, "zzz"), 0);
});

test("sparse fixture: every page-bearing entity and every indicator has a link in the static HTML (AC-RD-02)", async () => {
  const {readFileSync} = await import("node:fs");
  const {join, dirname} = await import("node:path");
  const {fileURLToPath} = await import("node:url");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sparse_export", "meta");
  const read = (k) => JSON.parse(readFileSync(join(dir, `${k}.json`), "utf8"))[k];
  const e = read("entities");
  const i = read("indicators");
  const html = homeListsHtml({entities: e, indicators: i, domains: read("domains")});
  for (const x of e.filter((r) => r.is_global !== true)) assert.ok(html.includes(`href="./country/${x.entity_id}"`), x.entity_id);
  for (const x of i) assert.ok(html.includes(`href="./indicator/${x.indicator_id}"`), x.indicator_id);
  assert.doesNotMatch(html, /status|guide/i);
});
