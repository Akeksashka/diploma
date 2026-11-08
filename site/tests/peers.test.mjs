import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {listOf} from "../src/lib/meta.js";
import {ALL_GROUP, CAVEAT, FILTER_NOTE, NON_EURO_MARK, PERCENTILE_COLUMN_LABEL, filterRows, focusFromHash, focusHash, groupMembers, panelState, peerView, sortRows, spreadText} from "../src/lib/peers.js";
import {GUIDES, peerChart, peersBlock, radioGroup, selectBox} from "../src/lib/peers-view.js";
import * as pageLib from "../scripts/lib.mjs";
import {DOMAIN_ID_RE, domainPageSource} from "../scripts/lib.mjs";

const LABEL = "mean percentile of the domain's indicators";
const ind = (id, o = {}) => ({indicator_id: id, value: 3.1, rank_mode: "monotone_good", is_stale: false, alignment: "aligned", inherited: false, published: true, publish_scope: "ranked", percentile: 0.9, ref_period_end: "2026-09-30", ...o});
const ent = (id, inds) => ({entity_id: id, n_available: 1, n_defined: 1, percentile_rank: 0.5, percentile_rank_label: LABEL, rank_position: 1, n_ranked_entities: 3, low_coverage: false, indicators: inds});
const align = {indicator_id: "M09", rank_reference_period: "2026-09-30", reference_period_spread_days: 31, max_ref_spread_days: 92, n_ranked: 3, n_unaligned: 2};
const sc = (o = {}) => ({
  domain_id: "labour",
  ranked: true,
  percentile_rank_label: LABEL,
  alignment: [align],
  entities: [
    ent("DEU", [ind("M09", {percentile: 0.9, value: 3.1})]),
    ent("JPN", [ind("M09", {percentile: 0.3, value: 2.6})]),
    ent("POL", [ind("M09", {percentile: 0.6, value: 2.9})]),
    ent("USA", [ind("M09", {percentile: null, value: 4.1, alignment: "lagging", ref_period_end: "2026-06-30"})]),
    ent("IND", [ind("M09", {percentile: null, value: 7.9, alignment: "unaligned", alignment_reason: "fiscal_year_basis"})]),
    ent("EA", [ind("M09", {percentile: null, value: 6.2, publish_scope: "info_only"})])
  ],
  ...o
});
const entities = [
  {entity_id: "DEU", name: "Germany", kind: "country"},
  {entity_id: "JPN", name: "Japan", kind: "country"},
  {entity_id: "POL", name: "Poland", kind: "country"},
  {entity_id: "USA", name: "United States", kind: "country"},
  {entity_id: "IND", name: "India", kind: "country"},
  {entity_id: "EA", name: "Euro area", kind: "aggregate"}
];
const indicators = [{indicator_id: "M09", name: "Unemployment rate", unit_label: "%", rank_mode: "monotone_good", notes: []}];
const grp = (id, ids, extra = {}) => ({group_id: id, name: id, members: ids.map((e) => ({entity_id: e, valid_from: "1999-01-01", valid_to: null, ...extra}))});
const groups = [grp("euro_area", ["DEU"]), grp("g7", ["DEU", "JPN", "USA"]), grp("emerging", ["IND", "POL"])];
const meta = {entities, indicators, groups, knownCutoff: "2026-11-01T04:23:41Z"};
const pv = () => peerView(sc(), meta);

// Minimal htl stand-in (same idea as scorecard.test.mjs).
class Raw {
  constructor(s) {
    this.s = s;
  }
}
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : v == null ? "" : esc(v));
const html = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? part(vals[i]) : ""), ""));
const calls = [];
const Plot = {
  plot: (o) => (calls.push(o), new Raw(`<svg data-y="${o.y.domain.join("|")}"></svg>`)),
  dot: (data, o) => ({kind: "dot", data, o}),
  ruleX: (data, o) => ({kind: "rule", data, o})
};
const render = (state) => peersBlock(html, Plot, pv(), state).s;

test("the filter only filters: stored percentile texts are identical with and without it (D6)", () => {
  const v = pv();
  const all = panelState(v, {indicator: "M09", group: ALL_GROUP}).rows;
  const g7 = panelState(v, {indicator: "M09", group: "g7"}).rows;
  assert.deepEqual(g7.map((r) => r.entityId).sort(), ["DEU", "JPN", "USA"]);
  for (const r of g7) assert.deepEqual(r, all.find((a) => a.entityId === r.entityId));
  assert.equal(g7.find((r) => r.entityId === "DEU").percentileText, "0.90");
  // filterRows keeps the very same row objects, in order, and never adds a field
  const rows = v.indicators[0].rows;
  const filtered = filterRows(rows, "emerging", v.members);
  assert.deepEqual(filtered.map((r) => r.entityId), ["POL", "IND"].sort((a, b) => rows.findIndex((r) => r.entityId === a) - rows.findIndex((r) => r.entityId === b)));
  assert.ok(filtered.every((r) => rows.includes(r)));
});

test("unknown group id keeps all rows; an empty group renders the empty message, not a table", () => {
  const v = pv();
  assert.equal(filterRows(v.indicators[0].rows, "nope", v.members).length, 6);
  const e = peerView(sc(), {...meta, groups: [grp("g7", ["XXX"])]});
  const out = peersBlock(html, Plot, e, {indicator: "M09", group: "g7"}).s;
  assert.ok(out.includes('id="empty-group"') && !out.includes("<table"));
});

test("sort orders by stored percentile (missing last), value, or name; nothing is recomputed", () => {
  const rows = pv().indicators[0].rows;
  assert.deepEqual(sortRows(rows, "percentile").map((r) => r.entityId), ["DEU", "POL", "JPN", "EA", "IND", "USA"]);
  assert.deepEqual(sortRows(rows, "value_asc").map((r) => r.entityId).slice(0, 2), ["JPN", "POL"]);
  assert.deepEqual(sortRows(rows, "value_desc").map((r) => r.entityId).slice(0, 2), ["IND", "EA"]);
  assert.deepEqual(sortRows(rows, "name").map((r) => r.name).slice(0, 2), ["Euro area", "Germany"]);
  assert.deepEqual(panelState(pv(), {indicator: "M09", sort: "bogus"}).sort, "percentile");
});

test("lagging and unaligned entities are shown with their value but unranked, and marked", () => {
  const rows = new Map(pv().indicators[0].rows.map((r) => [r.entityId, r]));
  const usa = rows.get("USA");
  assert.equal(usa.valueText, "4.1");
  assert.equal(usa.percentile, null);
  assert.equal(usa.percentileText, "not ranked (lagging)");
  assert.equal(usa.mark, "lagging");
  assert.ok(usa.flags.includes("lagging"));
  const ind_ = rows.get("IND");
  assert.equal(ind_.percentileText, "not ranked (unaligned)");
  assert.equal(ind_.mark, "unaligned");
  assert.ok(ind_.flags.includes("unaligned (fiscal-year basis)"));
  const out = render({indicator: "M09", group: ALL_GROUP});
  assert.match(out, /data-entity="USA" data-status="unranked" data-mark="lagging"/);
  assert.match(out, /data-entity="IND" data-status="unranked" data-mark="unaligned"/);
});

test("stale values stay visible but carry no rank; aggregates are listed unranked", () => {
  const s = sc();
  s.entities[0].indicators[0] = ind("M09", {is_stale: true, age_days: 400, stale_limit_days: 120, percentile: 0.5});
  const rows = new Map(peerView(s, meta).indicators[0].rows.map((r) => [r.entityId, r]));
  assert.equal(rows.get("DEU").percentileText, "no rank (stale)");
  assert.equal(rows.get("DEU").percentile, null);
  assert.equal(rows.get("EA").percentileText, "aggregate (not ranked)");
  assert.equal(rows.get("EA").status, "aggregate");
});

test("the reference-period spread of the ranked set is the stored figure", () => {
  const v = pv();
  assert.equal(v.indicators[0].spreadDays, 31);
  const text = spreadText(v.indicators[0]);
  assert.ok(text.startsWith("Reference-period spread of the ranked set: 31 days (limit 92 days)"));
  assert.ok(text.includes("common reference period of the ranking 2026-09-30") && text.includes("countries ranked 3"));
  assert.ok(render({indicator: "M09"}).includes(text));
  assert.equal(spreadText({spreadDays: null, rankReferencePeriod: null}), null);
  const none = sc({alignment: [{...align, rank_reference_period: null, reference_period_spread_days: null, n_ranked: null}]});
  assert.match(peersBlock(html, Plot, peerView(none, meta), {indicator: "M09"}).s, /No ranking for this indicator/);
});

test("the percentile column label, caveat and filter note are fixed text", () => {
  const out = render({indicator: "M09"});
  assert.equal(PERCENTILE_COLUMN_LABEL, "percentile vs all ranked countries");
  assert.ok(out.includes(`<th scope="col" role="columnheader" class="mm-num">percentile vs all ranked countries</th>`));
  assert.ok(out.includes(CAVEAT) && out.includes(FILTER_NOTE));
  assert.equal(CAVEAT, "Percentiles are relative position in the covered panel, not a judgement of structural quality.");
  assert.ok(out.includes("<svg"));
});

test("M18: the exported non-euro note is shown and non-euro countries are marked, euro members and aggregates are not", () => {
  const note = "Non-euro countries: local-currency yield spread (includes inflation/FX expectations), not sovereign credit risk";
  const s = sc({
    domain_id: "fin",
    ranked: false,
    alignment: [],
    entities: ["DEU", "USA", "POL", "EA"].map((e) => ent(e, [ind("M18", {rank_mode: "descriptive_only", percentile: null, publish_scope: "info_only"})]))
  });
  const v = peerView(s, {...meta, indicators: [{indicator_id: "M18", name: "10-year yield spread", unit_label: "% points", rank_mode: "descriptive_only", notes: [note]}]});
  const rows = new Map(v.indicators[0].rows.map((r) => [r.entityId, r]));
  assert.ok(!rows.get("DEU").flags.includes(NON_EURO_MARK));
  assert.ok(!rows.get("EA").flags.includes(NON_EURO_MARK));
  assert.ok(rows.get("USA").flags.includes(NON_EURO_MARK) && rows.get("POL").flags.includes(NON_EURO_MARK));
  const out = peersBlock(html, Plot, v, {indicator: "M18"}).s;
  assert.ok(out.includes(`id="indicator-note">${note}</p>`));
  assert.ok(!out.includes("<svg"), "no chart for an unranked domain");
  // no euro_area group in the export: the note is still shown, nobody is marked
  const w = peerView(s, {...meta, groups: [], indicators: [{indicator_id: "M18", name: "x", notes: [note]}]});
  assert.ok(w.indicators[0].rows.every((r) => !r.flags.includes(NON_EURO_MARK)));
  assert.ok(peersBlock(html, Plot, w, {indicator: "M18"}).s.includes(note));
});

test("group membership is evaluated on the manifest date", () => {
  const g = {group_id: "x", members: [{entity_id: "A", valid_from: "2020-01-01", valid_to: null}, {entity_id: "B", valid_from: "1999-01-01", valid_to: "2010-12-31"}, {entity_id: "C", valid_from: "2027-01-01", valid_to: null}]};
  assert.deepEqual([...groupMembers(g, "2026-11-01T04:23:41Z")], ["A"]);
  assert.deepEqual([...groupMembers(g, "2005-06-01")], ["B"]);
  assert.deepEqual([...groupMembers(g, null)].sort(), ["A", "C"]); // unreadable date: open-ended only
});

test("peers.js and peers-view.js compute nothing (D6 static guard)", () => {
  for (const f of ["peers.js", "peers-view.js"]) {
    const src = readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8");
    assert.ok(!/Math\.|\.reduce\(|\bd3\b|peer_group_percentile\s*[:=(]|percentile\s*[-+*/]/.test(src.replace(/\/\/.*$/gm, "")), `${f} computes`);
    assert.ok(!/^import .* from "(https?:|npm:)/m.test(src));
  }
});

test("selectBox renders ids and escaped labels", () => {
  const out = selectBox(html, {id: "peer-group", label: "Peer group", options: [{id: "a", label: "A<b>"}]}).s;
  assert.ok(out.includes('<select id="peer-group">') && out.includes("A&lt;b&gt;"));
});

test("R12: the peers page generator is gone; the domain page source is built from a validated id, imports no Inputs and links no peers/ page", () => {
  assert.equal(pageLib.peersPageSource, undefined);
  const src = domainPageSource("labour");
  assert.ok(src.includes('FileAttachment("../data/scorecard/labour.json")'));
  assert.ok(!src.includes("Inputs") && !src.includes("npm:"));
  assert.ok(!src.includes("peers/"));
  for (const bad of ["../x", "a/b", "A", "", 'a"b']) {
    assert.ok(!DOMAIN_ID_RE.test(bad));
    assert.throws(() => domainPageSource(bad), /unsafe domain_id/);
  }
});

test("rendered fixture domains: peer groups, lagging, unaligned, spread, M18 (generated fixture)", () => {
  const dir = process.env.MM_FIXTURE_EXPORT;
  if (!dir) return; // set by tests/unit/test_site_spike.py
  const load = (p) => JSON.parse(readFileSync(`${dir}/${p}`, "utf8"));
  const m = {entities: listOf(load("meta/entities.json"), "entities"), indicators: listOf(load("meta/indicators.json"), "indicators"), groups: listOf(load("meta/groups.json"), "groups"), knownCutoff: load("manifest.json").known_cutoff};
  const labour = peerView(load("scorecard/labour.json"), m);
  const out = (state) => peersBlock(html, Plot, labour, state).s;
  assert.ok(labour.groupOptions.length >= 4);
  const all = out({indicator: "M09", group: "all"});
  assert.match(all, /data-entity="USA" data-status="unranked" data-mark="lagging"/);
  assert.match(all, /data-entity="IND" data-status="unranked" data-mark="unaligned"/);
  assert.match(all, /Reference-period spread of the ranked set: 31 days/);
  const g7 = out({indicator: "M09", group: "g7"});
  assert.ok(g7.includes('data-entity="DEU"') && g7.includes('data-entity="USA"') && !g7.includes('data-entity="IND"') && !g7.includes('data-entity="POL"'));
  // same stored percentile cell for DEU with and without the filter
  const cell = (h) => h.match(/data-entity="DEU"[^]*?<\/tr>/)[0];
  assert.equal(cell(all), cell(g7));
  const fin = peerView(load("scorecard/fin.json"), m);
  const f = peersBlock(html, Plot, fin, {indicator: "M18", group: "all"}).s;
  assert.ok(f.includes("local-currency yield spread (includes inflation/FX expectations), not sovereign credit risk"));
  assert.match(f, /data-entity="USA"[^]*?non-euro: see the note above/);
  assert.ok(!/data-entity="DEU"[^]*?<\/tr>/.exec(f)[0].includes("non-euro"));
});

test("T117: dot plot draws only stored percentiles, labels carry the stored value, guides are constant and unlabelled", () => {
  calls.length = 0;
  const out = render({indicator: "M09", group: ALL_GROUP});
  const o = calls.at(-1);
  assert.deepEqual(o.y.domain, ["Germany: 3.1 %", "Poland: 2.9 %", "Japan: 2.6 %"]);
  assert.equal(o.y.step, 34);
  const rule = o.marks.find((m) => m.kind === "rule");
  assert.deepEqual(rule.data, [0.25, 0.5, 0.75]);
  assert.deepEqual([...GUIDES], [0.25, 0.5, 0.75]);
  const dot = o.marks.find((m) => m.kind === "dot" && m.o.r === 8);
  assert.deepEqual(dot.data.map((r) => r.entityId), ["DEU", "POL", "JPN"]);
  assert.equal(dot.o.fill({hollow: true}), "none");
  assert.notEqual(dot.o.fill({hollow: false}), "none");
  assert.ok(!/median|quartile/i.test(out + JSON.stringify(o.x) + JSON.stringify(rule.o)));
  // lagging, unaligned and the aggregate stay in the table only
  assert.ok(!o.y.domain.some((l) => /United States|India|Euro area/.test(l)));
  assert.ok(out.includes('data-entity="USA"') && out.includes('data-entity="IND"'));
});

test("T117: figure has an aria-label and a table alternative; orientation and direction sit next to the chart", () => {
  const v = peerView(sc(), {...meta, indicators: [{...indicators[0], good_dir: -1}]});
  const out = peersBlock(html, Plot, v, {indicator: "M09"}).s;
  assert.match(out, /<figure class="mm-figure" id="peer-figure" role="img" aria-label="Dot plot of the percentile vs all ranked countries for Unemployment rate, 3 countries\. The table below lists the same values\.">/);
  assert.ok(out.includes("Higher percentile means a more favourable position by each indicator&#39;s stated direction.") || out.includes("Higher percentile means a more favourable position by each indicator's stated direction."));
  assert.ok(out.includes("Direction of this indicator: lower is better."));
  assert.ok(out.indexOf("peer-figure") < out.indexOf('id="peer-table"'), "chart before its table alternative");
  assert.ok(out.includes('href="#peer-table"') && out.includes("Skip to values table"));
  assert.ok(out.includes("<caption>Unemployment rate: latest value and stored percentile, by country</caption>"));
  assert.ok(!out.includes("<th>") && out.includes('<th scope="row"'));
  // descriptive domain: no chart, so no orientation note
  assert.ok(!peersBlock(html, Plot, peerView(sc({ranked: false}), meta), {indicator: "M09"}).s.includes("peer-orientation"));
});

test("T117/T119: hollow marks for estimate or inherited values; reference offset shown as stored", () => {
  const s = sc();
  s.entities[1].indicators[0] = ind("M09", {percentile: 0.3, value: 2.6, value_kind: "estimate", ref_offset_days: 12});
  const v = peerView(s, meta);
  const rows = new Map(v.indicators[0].rows.map((r) => [r.entityId, r]));
  assert.equal(rows.get("JPN").hollow, true);
  assert.equal(rows.get("JPN").refOffsetDays, 12);
  assert.equal(rows.get("DEU").hollow, false);
  assert.equal(rows.get("DEU").refOffsetDays, null);
  const out = peersBlock(html, Plot, v, {indicator: "M09"}).s;
  assert.ok(out.includes("Reference offset (days)"));
  assert.match(out, /data-entity="JPN"[^]*?data-label="Reference offset \(days\)" class="mm-num">12</);
  assert.match(out, /data-entity="DEU"[^]*?data-label="Reference offset \(days\)" class="mm-num mm-na">n\/a</);
});

test("T118: focus hash parse accepts only known ids; focus is highlighted in chart and table and is not a filter", () => {
  const ids = new Set(["DEU", "JPN"]);
  assert.equal(focusFromHash("#c=DEU", ids), "DEU");
  for (const bad of ["", "#", "#c=", "#c=XXX", "#c=DEU&x=1", "#x=DEU", "c=DEU", "#c=DEU#c=JPN", "#c=%3Cb%3E", "#c=" + "A".repeat(50), null, undefined, 5]) assert.equal(focusFromHash(bad, ids), null, String(bad));
  assert.equal(focusHash("DEU"), "#c=DEU");
  assert.equal(pv().entityIds.has("DEU"), true);
  calls.length = 0;
  const out = peersBlock(html, Plot, pv(), {indicator: "M09", focus: "JPN"}).s;
  assert.match(out, /data-entity="JPN" data-status="ranked" data-mark="" data-focus="true"/);
  assert.match(out, /data-entity="DEU"[^>]*data-focus="false"/);
  assert.match(out, /class="mm-focus-btn" data-entity="JPN" aria-pressed="true"/);
  const ring = calls.at(-1).marks.filter((m) => m.kind === "dot").at(-1);
  assert.deepEqual(ring.data.map((r) => r.entityId), ["JPN"]);
  // a focus outside the filtered rows highlights nothing and does not change the rows
  assert.equal(panelState(pv(), {indicator: "M09", group: "emerging", focus: "DEU"}).focus, null);
  assert.deepEqual(panelState(pv(), {indicator: "M09", focus: "JPN"}).rows, panelState(pv(), {indicator: "M09"}).rows);
});

test("T118: radioGroup is a fieldset with a legend, one checked radio, and a value", () => {
  const out = radioGroup(html, {id: "peer-group", legend: "Peer group (filter)", options: [{id: "all", label: "All countries"}, {id: "g7", label: "G7"}]});
  assert.ok(out.s.startsWith('<fieldset id="peer-group" class="mm-radios"><legend>Peer group (filter)</legend>'));
  assert.equal((out.s.match(/type="radio"/g) ?? []).length, 2);
  // the stand-in html renders a boolean attribute as its text; the real htl sets the property
  assert.ok(/value="all" checked=true/.test(out.s) && /value="g7" checked=false/.test(out.s));
});

test("T118: no cookie or storage in the peers modules and page", () => {
  const files = ["../src/lib/peers.js", "../src/lib/peers-view.js"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8"));
  files.push(domainPageSource("labour"), readFileSync(new URL("../src/lib/indicator-view.js", import.meta.url), "utf8"));
  for (const t of files) assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(t));
  assert.ok(files.at(-1).includes("radioGroup(html"));
});
