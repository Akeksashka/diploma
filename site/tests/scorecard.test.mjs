import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {listOf} from "../src/lib/meta.js";
import {CAVEAT, ScorecardError, domainView, entitySummary, indicatorCell, peerSetNote, validateScorecard} from "../src/lib/scorecard.js";
import {domainBlock} from "../src/lib/scorecard-view.js";
import {DOMAIN_ID_RE, domainPageSource} from "../scripts/lib.mjs";

const LABEL = "mean percentile of the domain's indicators";
const ind = (o = {}) => ({indicator_id: "M09", value: 3.1, rank_mode: "monotone_good", is_stale: false, alignment: "aligned", inherited: false, published: true, publish_scope: "ranked", percentile: 0.9, ref_period_end: "2026-09-30", ...o});
const ent = (o = {}) => ({entity_id: "DEU", n_available: 2, n_defined: 2, percentile_rank: 0.85, percentile_rank_label: LABEL, rank_position: 1, n_ranked_entities: 4, low_coverage: false, indicators: [ind()], ...o});
const sc = (o = {}) => ({domain_id: "labour", ranked: true, percentile_rank_label: LABEL, heterogeneous_peer_set: false, peer_set_size_by_indicator: {min: 3, max: 3}, alignment: [], entities: [ent()], ...o});
const ctx = {domainRanked: true, indicator: {name: "Unemployment rate", unit_label: "%"}};

test("ranked cell shows the stored percentile to two decimals", () => {
  const c = indicatorCell(ind(), ctx);
  assert.equal(c.status, "ranked");
  assert.equal(c.percentileText, "0.90");
  assert.equal(c.valueText, "3.1");
});

test("stale cell keeps its value, is flagged, and shows no rank even if a percentile were stored", () => {
  const c = indicatorCell(ind({is_stale: true, age_days: 400, stale_limit_days: 120, percentile: 0.4}), ctx);
  assert.equal(c.status, "stale");
  assert.equal(c.valueText, "3.1");
  assert.equal(c.percentileText, "no rank (stale)");
  assert.ok(c.flags[0].startsWith("stale (400 days old, limit 120 days"));
});

test("missing value is n/a; withheld pair is 'not published'", () => {
  assert.equal(indicatorCell(ind({value: null, percentile: null}), ctx).valueText, "n/a");
  const w = indicatorCell(ind({published: false, publish_scope: "excluded", value: null}), ctx);
  assert.equal(w.status, "not_published");
  assert.equal(w.percentileText, "not published");
});

test("descriptive indicator has no percentile", () => {
  const c = indicatorCell(ind({rank_mode: "descriptive_only", percentile: null}), ctx);
  assert.equal(c.status, "descriptive");
  assert.equal(c.percentileText, "descriptive, not ranked");
});

test("lagging, unaligned (fiscal year), inherited and estimate are flagged and not ranked", () => {
  assert.equal(indicatorCell(ind({alignment: "lagging", percentile: null}), ctx).percentileText, "not ranked (lagging)");
  const u = indicatorCell(ind({alignment: "unaligned", alignment_reason: "fiscal_year_basis", percentile: null}), ctx);
  assert.deepEqual(u.flags, ["unaligned (fiscal-year basis)"]);
  const i = indicatorCell(ind({inherited: true, percentile: null, value_kind: "estimate"}), ctx);
  assert.equal(i.percentileText, "not ranked (inherited)");
  assert.deepEqual(i.flags, ["inherited from the euro area", "estimate"]);
});

test("unranked domain: no percentile even if a file wrongly carried one (D6: nothing is recomputed)", () => {
  const c = indicatorCell(ind({percentile: 0.5}), {...ctx, domainRanked: false});
  assert.equal(c.percentileText, "unranked domain");
  const s = entitySummary(ent(), sc({ranked: false}), undefined);
  assert.equal(s.status, "unranked_domain");
  assert.equal(s.meanText, "unranked");
  assert.equal(s.positionText, "unranked");
});

test("ranked entity: stored mean, n/N and 'position of N' are shown verbatim", () => {
  const s = entitySummary(ent(), sc(), {name: "Germany", kind: "country"});
  assert.equal(s.meanText, "0.85");
  assert.equal(s.coverageText, "2/2");
  assert.equal(s.positionText, "1 of 4");
  assert.equal(s.name, "Germany");
});

test("low coverage: mean percentile and n/N shown, no position", () => {
  const s = entitySummary(ent({low_coverage: true, n_available: 1, rank_position: null, n_ranked_entities: null, percentile_rank: 0.5}), sc(), undefined);
  assert.equal(s.status, "low_coverage");
  assert.equal(s.meanText, "0.50");
  assert.equal(s.coverageText, "1/2");
  assert.equal(s.positionText, "no position (low coverage)");
});

test("zero availability: n/a, even if a mean were stored", () => {
  const s = entitySummary(ent({n_available: 0, percentile_rank: 0.3, rank_position: null}), sc(), undefined);
  assert.equal(s.meanText, "n/a");
  assert.equal(s.meanPercentile, null);
  assert.equal(s.coverageText, "0/2");
  assert.equal(entitySummary(ent({percentile_rank: null}), sc(), undefined).meanText, "n/a");
});

test("aggregate without a mean is labelled, not given n/a", () => {
  const s = entitySummary(ent({n_available: 0, percentile_rank: null}), sc(), {name: "Euro area", kind: "aggregate"});
  assert.equal(s.meanText, "aggregate (not ranked)");
});

test("peer-set note only when the stored flag is true, with the stored sizes", () => {
  assert.equal(peerSetNote(sc()), null);
  assert.match(peerSetNote(sc({heterogeneous_peer_set: true, peer_set_size_by_indicator: {min: 2, max: 4}})), /different sets of countries \(2 to 4 countries per indicator\)/);
  assert.match(peerSetNote(sc({heterogeneous_peer_set: true, peer_set_size_by_indicator: {min: null, max: null}})), /different sets of countries,/);
});

test("validateScorecard fails loud on a missing label or malformed entity", () => {
  assert.throws(() => validateScorecard(sc({percentile_rank_label: ""})), ScorecardError);
  assert.throws(() => validateScorecard(sc({entities: [ent({percentile_rank_label: undefined})]})), /percentile_rank_label/);
  assert.throws(() => validateScorecard(sc({ranked: "yes"})), /ranked/);
  assert.throws(() => validateScorecard(null), ScorecardError);
});

test("domainView orders by stored position then name and never reorders by a computed value", () => {
  const entities = [{entity_id: "AAA", name: "Aaa"}, {entity_id: "BBB", name: "Bbb"}, {entity_id: "CCC", name: "Ccc"}];
  const v = domainView(sc({entities: [ent({entity_id: "AAA", rank_position: null, percentile_rank: 0.99}), ent({entity_id: "CCC", rank_position: 1}), ent({entity_id: "BBB", rank_position: 2})]}), {entities});
  assert.deepEqual(v.summaries.map((s) => s.entityId), ["CCC", "BBB", "AAA"]);
  assert.equal(v.label, LABEL);
  assert.equal(v.caveat, CAVEAT);
});

test("listOf unwraps meta files and refuses an unknown major or a missing list", () => {
  assert.deepEqual(listOf({schema_version: "1.0", series: [1]}, "series"), [1]);
  assert.throws(() => listOf({schema_version: "2.0", series: []}, "series"), /unsupported/);
  assert.throws(() => listOf({schema_version: "1.0"}, "series"), /no "series" list/);
  assert.throws(() => listOf([], "series"), /not an object/);
});

// Minimal htl stand-in (same idea as shell.test.mjs).
class Raw {
  constructor(s) {
    this.s = s;
  }
}
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : v == null ? "" : esc(v));
const html = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? part(vals[i]) : ""), ""));

test("rendered fixture domains show label, caveat, flags, and the right rows (generated fixture)", () => {
  const dir = process.env.MM_FIXTURE_EXPORT;
  if (!dir) return; // set by tests/unit/test_site_spike.py; plain `npm test` runs the synthetic cases above
  const load = (p) => JSON.parse(readFileSync(`${dir}/${p}`, "utf8"));
  const meta = {entities: listOf(load("meta/entities.json"), "entities"), indicators: listOf(load("meta/indicators.json"), "indicators"), domains: listOf(load("meta/domains.json"), "domains")};
  const out = (d) => domainBlock(html, domainView(load(`scorecard/${d}.json`), meta)).s;
  const labour = out("labour");
  assert.ok(labour.includes(LABEL) && labour.includes(CAVEAT) && labour.includes('id="peer-set-note"'));
  assert.match(labour, /data-entity="FRA" data-status="low_coverage"/);
  assert.match(labour, /data-entity="ITA" data-status="n\/a"[^]*?<td class="mm-num mm-hm-n">0\/2/);
  assert.match(labour, /data-entity="FRA" data-indicator="M09" data-status="stale"/);
  assert.match(labour, /descriptive, not ranked/);
  assert.match(labour, /aggregate \(not ranked\)/);
  assert.ok(!out("prices").includes("peer-set-note"));
  for (const d of ["agri", "global"]) {
    const h = out(d);
    assert.ok(h.includes("informational and unranked") && h.includes("unranked domain"));
    assert.ok(!/data-bin="[1-5]"/.test(h) && !/<span class="mm-fig">0\.\d\d<\/span>/.test(h), `${d} shows a percentile`);
  }
});

test("the landing page repeats the standing caveat verbatim", () => {
  assert.ok(readFileSync(new URL("../src/index.md", import.meta.url), "utf8").includes(CAVEAT));
});

test("domain page source is built from a validated id only", () => {
  assert.ok(domainPageSource("labour").includes('FileAttachment("../data/scorecard/labour.json")'));
  for (const bad of ["../x", "a/b", "A", "", 'a"b', "labour.json"]) {
    assert.ok(!DOMAIN_ID_RE.test(bad));
    assert.throws(() => domainPageSource(bad), /unsafe domain_id/);
  }
});
