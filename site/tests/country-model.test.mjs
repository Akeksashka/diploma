// Redesign R6: country row model on the SYNTHETIC sparse fixture (spec 4.2, C-CTRY-1/3/4/5, AC-RD-10, 11, 12, 15).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import * as copy from "../src/lib/copy.js";
import {countryHeader, countryModel} from "../src/lib/country-model.js";
import {countryPageSource} from "../scripts/lib.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sparse_export");
const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const entities = load("meta/entities.json").entities;
const indicators = load("meta/indicators.json").indicators;
const series = load("meta/series.json").series;
const domains = load("meta/domains.json").domains;
const scorecards = Object.fromEntries(domains.map((d) => [d.domain_id, load(`scorecard/${d.domain_id}.json`)]));
const groups = [{group_id: "g7", name: "g7"}, {group_id: "zz", name: "Zed"}];
const build = (id, extra = {}) => countryModel({entity: {...entities.find((e) => e.entity_id === id), ...extra}, domains, scorecards, indicators, series, groups});
const dom = (m, id) => m.domains.find((d) => d.domainId === id);

test("every indicator of every domain appears exactly once, in meta/domains.json order (AC-RD-10)", () => {
  const m = build("SY01");
  assert.deepEqual(m.domains.map((d) => d.domainId), domains.map((d) => d.domain_id));
  for (const d of m.domains) {
    const meta = domains.find((x) => x.domain_id === d.domainId);
    assert.deepEqual([...d.rows.map((r) => r.indicatorId)].sort(), [...meta.indicator_ids].sort());
  }
});

test("rows with a value come first, in indicator_ids order; then rows without (C-CTRY-4)", () => {
  const g = dom(build("SY01"), "growth");
  assert.deepEqual(g.rows.map((r) => r.indicatorId), ["T01", "T02", "T03", "T04"]);
  assert.deepEqual(g.withValue.map((r) => r.indicatorId), ["T01", "T02", "T03"]);
  assert.deepEqual(g.withoutValue.map((r) => r.indicatorId), ["T04"]);
  const empty = dom(build("SY20"), "growth");
  assert.equal(empty.withValue.length, 0);
  assert.equal(empty.withoutValue.length, 4);
  // value before no-value even when indicator_ids order says otherwise: SY08 has T04 (no series) and nothing else
  const seen = g.rows.map((r) => r.hasValue);
  assert.deepEqual(seen, [...seen].sort((a, b) => Number(b) - Number(a)));
});

test("stored values and figure fields are shown as stored (AC-RD-11)", () => {
  const g = dom(build("SY01"), "growth");
  const t1 = g.rows.find((r) => r.indicatorId === "T01");
  assert.equal(t1.value, 10);
  assert.equal(t1.valueText, "10");
  assert.equal(t1.percentile, 0.2);
  assert.equal(t1.percentileText, "0.20");
  assert.equal(t1.bin, 2);
  assert.equal(t1.refPeriodEnd, "2025-12-31");
  assert.equal(t1.periodText, "2025");
  assert.equal(t1.refOffsetDays, 0);
  assert.equal(t1.offsetFlag, false);
  assert.equal(t1.unit, "SYNTH_UNIT");
  assert.equal(t1.sourceName, "Synthetic");
  assert.equal(t1.seriesId, 1);
  assert.equal(g.figure.percentileRank, 0.35);
  assert.equal(g.figure.percentileText, "0.35");
  assert.equal(g.figure.nAvailable, 2);
  assert.equal(g.figure.nDefined, 4);
  assert.equal(g.figure.rankPosition, 3);
  assert.equal(g.figure.nRankedEntities, 3);
  assert.equal(g.figure.positionText, "position 3 of 3");
  assert.equal(g.figure.label, "mean percentile of the domain's indicators");
  assert.equal(g.figure.state.key, "ranked");
});

test("estimate flag, direction label and the model never invent a percentile", () => {
  const g = dom(build("SY01"), "growth");
  assert.equal(g.rows.find((r) => r.indicatorId === "T02").estimate, true);
  assert.equal(g.rows.find((r) => r.indicatorId === "T01").directionText, "higher is better");
  for (const d of build("SY01").domains) for (const r of d.rows) if (r.percentile !== null) assert.equal(r.percentile, d.rows.find((x) => x === r).cell.percentile);
});

test("two-domain indicator T01 carries equal stored percentiles in both domains", () => {
  const m = build("SY01");
  const a = dom(m, "growth").rows.find((r) => r.indicatorId === "T01");
  const b = dom(m, "fin").rows.find((r) => r.indicatorId === "T01");
  assert.equal(a.percentile, b.percentile);
});

test("states come from the missing-data mapping (spec 5.1)", () => {
  assert.equal(dom(build("SY03"), "growth").rows.find((r) => r.indicatorId === "T02").state.key, "stale");
  assert.equal(dom(build("SY04"), "growth").rows.find((r) => r.indicatorId === "T02").state.key, "lagging");
  assert.equal(dom(build("SY05"), "growth").rows.find((r) => r.indicatorId === "T02").state.key, "unaligned");
  assert.equal(dom(build("SY06"), "growth").rows.find((r) => r.indicatorId === "T02").state.key, "ahead");
  assert.equal(dom(build("SY09"), "growth").rows.find((r) => r.indicatorId === "T02").state.key, "not_published");
  const defined = dom(build("SY07"), "growth").rows.find((r) => r.indicatorId === "T04");
  assert.equal(defined.state.sentence, copy.DRAFT_NA_DEFINED_SENTENCE);
  const undef = dom(build("SY08"), "growth").rows.find((r) => r.indicatorId === "T04");
  assert.equal(undef.state.sentence, copy.G_STR1_NO_SERIES);
  for (const e of entities.filter((x) => !x.is_global)) for (const d of build(e.entity_id).domains) for (const r of d.rows) {
    if (r.state.key === "na") assert.ok(r.state.sentence, `${e.entity_id} ${r.indicatorId}`);
    if (!r.hasValue) assert.ok(r.state.sentence);
  }
});

test("n_available = 0: the domain figure is n/a with its sentence (AC-RD-12)", () => {
  const f = dom(build("SY20"), "growth").figure;
  assert.equal(f.state.key, "na");
  assert.equal(f.state.sentence, copy.DRAFT_NA_NO_RANKED_SENTENCE);
  assert.equal(f.percentileText, null);
});

test("low coverage: no position text even if stored fields are present", () => {
  const sc = structuredClone(scorecards);
  const row = sc.growth.entities.find((e) => e.entity_id === "SY01");
  Object.assign(row, {low_coverage: true, rank_position: 2, n_ranked_entities: 3});
  const m = countryModel({entity: entities.find((e) => e.entity_id === "SY01"), domains, scorecards: sc, indicators, series, groups});
  assert.equal(dom(m, "growth").figure.positionText, null);
  assert.equal(dom(m, "growth").figure.lowCoverage, true);
});

test("unranked domain: no percentile figure, notices as stored (AC-RD-12, C-CTRY-5)", () => {
  const a = dom(build("SY01"), "agri");
  assert.equal(a.ranked, false);
  assert.equal(a.figure, null);
  assert.deepEqual(a.notices, ["informational, unranked"]);
  for (const r of a.rows) assert.equal(r.state.key === "plain" || !r.hasValue, true);
});

test("aggregate: domain figure is the not-ranked wording (AC-RD-12)", () => {
  const f = dom(build("SYA1"), "growth").figure;
  assert.equal(f.state.key, "aggregate");
  assert.equal(f.state.sentence, copy.AGGREGATE_NOT_RANKED);
});

test("a domain without a row for the entity is omitted; an absent cell is a row without a value", () => {
  const sc = structuredClone(scorecards);
  sc.fin.entities = sc.fin.entities.filter((e) => e.entity_id !== "SY01");
  sc.growth.entities.find((e) => e.entity_id === "SY01").indicators = [];
  const m = countryModel({entity: entities.find((e) => e.entity_id === "SY01"), domains, scorecards: sc, indicators, series, groups});
  assert.equal(dom(m, "fin"), undefined);
  assert.equal(dom(m, "growth").withValue.length, 0);
  assert.equal(dom(m, "growth").rows.length, 4);
});

test("showsPercentiles is true only where a stored percentile exists (it no longer gates the orientation sentence, which follows pc alone)", () => {
  assert.equal(build("SY01").showsPercentiles, true);
  assert.equal(build("SY20").showsPercentiles, false);
});

test("header: name, kind and memberships from stored group_ids; unknown id falls back to the id", () => {
  const h = countryHeader({entity_id: "X1", name: "Xland", kind: "country", group_ids: ["g7", "zz", "q"]}, groups);
  assert.equal(h.name, "Xland");
  assert.equal(h.kind, "country");
  assert.deepEqual(h.memberships.map((m) => m.label), ["G7", "Zed", "q"]);
  assert.deepEqual(countryHeader({entity_id: "X2", name: "Y", kind: "aggregate", group_ids: []}, []).memberships, []);
});

test("generated page: one h1 = entity name, breadcrumb, caveat before orientation, no computation words", () => {
  const src = countryPageSource({entity_id: "SY01", name: "A & <B>", kind: "country", group_ids: ["g7"]}, groups, ["growth", "fin"]);
  assert.equal(src.match(/<h1\b/g).length, 1);
  assert.ok(src.includes("<h1 data-entity=\"SY01\">A &amp; &lt;B&gt;</h1>"));
  assert.ok(src.indexOf("mm-crumb") < src.indexOf("<h1"));
  assert.ok(!/<nav[\s>]/.test(src), "country page adds no second <nav> beyond the shell nav");
  assert.ok(src.includes("Groups: G7."));
  assert.ok(src.includes('FileAttachment("../data/scorecard/growth.json")') && src.includes('FileAttachment("../data/scorecard/fin.json")'));
  // C-CTRY-6 / AC-RD-62: the page source prints neither line; countryPage prints the caveat once per page whatever pc is, and the orientation sentence after it whenever pc=1.
  assert.ok(!src.includes("mm-caveat") && !src.includes("mm-orientation"));
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "country-page.js"), "utf8");
  assert.ok(page.indexOf("mm-caveat") < page.indexOf("mm-orientation"));
  assert.match(page, /pcNotes = \(html, on\) => html`<p class="mm-caveat">\$\{CAVEAT\}<\/p>\$\{on \?/, "the caveat does not depend on pc");
  assert.throws(() => countryPageSource({entity_id: "../x", name: "x"}, [], []));
  assert.throws(() => countryPageSource({entity_id: "SY01", name: "x"}, [], ["a/b"]));
});

test("model source computes nothing: no mean, sum, rank derivation or count", () => {
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "country-model.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\b(reduce|Math\.(min|max|round|floor)|sort\()|\.length\s*[-+*/]|\+\+/);
});
