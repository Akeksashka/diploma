// L11: the PG-HOME band skeleton and its loading policy (layout amendment 4.1, 5; AC-DB-12, 13), offline.
import assert from "node:assert/strict";
import {test} from "node:test";
import {homePageSource} from "../scripts/lib.mjs";
import {DRAFT_BAND_TITLES, DRAFT_BROWSE_SUMMARY, DRAFT_GROUP_BROWSE, DRAFT_HOME_H1} from "../src/lib/copy.js";
import {createScorecardLoader, defaultDomainId, effectiveSelection, SLOT_NAMES} from "../src/lib/home-dashboard.js";

const domains = [
  {domain_id: "agri", name: "Agriculture", ranked: false, indicator_ids: ["A01"]},
  {domain_id: "growth", name: "Growth", ranked: true, indicator_ids: ["G01", "G02"]},
  {domain_id: "labour", name: "Labour", ranked: true, indicator_ids: ["M09"]}
];
const indicators = [
  {indicator_id: "A01", domain_ids: ["agri"]}, {indicator_id: "G01", domain_ids: ["growth"]},
  {indicator_id: "G02", domain_ids: ["growth", "labour"]}, {indicator_id: "M09", domain_ids: ["labour"]}
];

test("defaults: declared ranked domain, else first ranked in stored order (never an unranked first), else first", () => {
  assert.equal(defaultDomainId(domains, "labour"), "labour");
  assert.equal(defaultDomainId(domains, "agri"), "growth"); // declared but unranked
  assert.equal(defaultDomainId(domains, "nope"), "growth");
  assert.equal(defaultDomainId(domains), "growth");
  assert.equal(defaultDomainId([domains[0]]), "agri");
  assert.equal(defaultDomainId([]), null);
});

test("effective selection: defaults for an empty state; Domain wins; an Indicator in two domains reads its first domain_ids entry", () => {
  const opts = {domains, indicators};
  assert.deepEqual(effectiveSelection({d: null, i: null}, opts).domainId, "growth");
  assert.equal(effectiveSelection({d: null, i: null}, opts).indicatorId, "G01");
  assert.equal(effectiveSelection({d: "labour", i: null}, opts).indicatorId, "M09");
  assert.equal(effectiveSelection({d: null, i: "G02"}, opts).domainId, "growth");
  assert.equal(effectiveSelection({d: "labour", i: "G02"}, opts).domainId, "labour");
  assert.equal(effectiveSelection({d: "unknown", i: null}, opts).domainId, "growth");
});

test("effective selection: with no Indicator chosen, the fallback respects the Frequency filter (the first indicator the bar offers)", () => {
  const ind = [
    {indicator_id: "G01", domain_ids: ["growth"], frequency_set: ["A"]}, {indicator_id: "G02", domain_ids: ["growth"], frequency_set: ["Q", "A"]},
    {indicator_id: "M09", domain_ids: ["labour"], frequency_set: ["M"]}
  ];
  const opts = {domains, indicators: ind};
  assert.equal(effectiveSelection({d: "growth", f: null}, opts).indicatorId, "G01");
  assert.equal(effectiveSelection({d: "growth", f: "Q"}, opts).indicatorId, "G02"); // G01 is not offered under Quarterly
  assert.equal(effectiveSelection({d: "growth", f: "M"}, opts).indicatorId, null); // none offered
  assert.equal(effectiveSelection({d: "growth", f: "Q", i: "G01"}, opts).indicatorId, "G01"); // an explicit choice is kept as it is
});

test("scorecard loader: one request per domain, shared while pending, cached on success, a failure is not cached", async () => {
  const calls = [];
  let failNext = true;
  const load = createScorecardLoader({
    growth: async () => (calls.push("growth"), {id: "growth"}),
    labour: async () => {
      calls.push("labour");
      if (failNext) throw new Error("boom");
      return {id: "labour"};
    }
  });
  const [a, b] = await Promise.all([load("growth"), load("growth")]);
  assert.equal(a, b);
  await load("growth");
  assert.deepEqual(calls, ["growth"]);
  await assert.rejects(load("labour"), /boom/);
  failNext = false;
  assert.deepEqual(await load("labour"), {id: "labour"});
  await load("labour");
  assert.deepEqual(calls, ["growth", "labour", "labour"]);
  await assert.rejects(load("zzz"), /no scorecard file/);
});

const source = homePageSource({entities: [{entity_id: "USA", name: "United States", kind: "country", is_global: false}], indicators: [{indicator_id: "M09", name: "Unemployment rate", domain_ids: ["labour"]}], domains});

test("generated home page: static h1, caveat, bar slot, dashboard mount, Browse details with lists and C-HOME-4 links; literal scorecard loaders", () => {
  assert.equal((source.match(/<h1>/g) ?? []).length, 1);
  assert.ok(source.includes("<h1>Country scorecards</h1>") && DRAFT_HOME_H1 !== "Country scorecards", "h1 text unchanged (B-H1)");
  assert.ok(source.includes('id="caveat"') && source.includes('id="filterbar-slot"') && source.includes('id="dashboard-slot"'));
  assert.ok(source.includes("mountHomeDashboard(") && !source.includes("proofCard") && !source.includes("filter-proof"));
  const browse = source.slice(source.indexOf('<details class="mm-browse"'), source.lastIndexOf("</details>"));
  assert.ok(source.includes(`<h2 id="band-browse-heading">${DRAFT_GROUP_BROWSE}</h2>`) && browse.includes(DRAFT_BROWSE_SUMMARY));
  assert.ok(!/^<details[^>]*\sopen/.test(browse), "Browse is collapsed");
  for (const part of ['id="country-list"', 'href="./country/USA"', 'href="./indicator/M09"', 'id="home-links"', 'href="./explorer"']) assert.ok(browse.includes(part), part);
  for (const d of domains) assert.ok(source.includes(`FileAttachment("data/scorecard/${d.domain_id}.json")`), d.domain_id);
  assert.ok(!source.includes("data/series/") && !source.includes(".parquet"), "no series file is referenced");
});

test("band titles and slot names", () => {
  assert.deepEqual(Object.values(DRAFT_BAND_TITLES), ["Overview", "Compare", "Indicators", "Over time"]);
  assert.deepEqual([...SLOT_NAMES], ["overview", "compare", "facts", "domain", "indicators", "overTime"]);
});

test("an unsafe domain id is refused at build time", () => {
  assert.throws(() => homePageSource({entities: [], indicators: [], domains: [{domain_id: '../x"', name: "x"}]}), /unsafe/);
});
