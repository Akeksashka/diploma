// T110-T112: heatmap view-model, table markup, legend, sorting. Offline, on the fixture export (src/data when built, or
// MM_FIXTURE_EXPORT) and on synthetic scorecards. Interaction in a browser is in tests/smoke/ux.smoke.mjs.
import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import {test} from "node:test";
import {listOf} from "../src/lib/meta.js";
import {domainView} from "../src/lib/scorecard.js";
import {heatmapModel, nextSort, sortRows} from "../src/lib/heatmap.js";
import {factsView, heatmapTable} from "../src/lib/heatmap-view.js";
import {legendBlock} from "../src/lib/legend.js";
import {domainBlock} from "../src/lib/scorecard-view.js";
import {ORIENTATION_NOTE} from "../src/lib/copy.js";
import {html} from "./support/html-standin.mjs";

const LABEL = "mean percentile of the domain's indicators";
const ind = (id, o = {}) => ({indicator_id: id, value: 3.1, rank_mode: "monotone_good", is_stale: false, alignment: "aligned", inherited: false, published: true, publish_scope: "ranked", percentile: 0.9, ref_period_end: "2026-09-30", ref_offset_days: 0, source_release_at: "2026-11-01T04:23:41Z", age_days: 30, stale_limit_days: 120, ...o});
const ent = (id, pr, pos, inds, o = {}) => ({entity_id: id, n_available: inds.length, n_defined: inds.length, percentile_rank: pr, percentile_rank_label: LABEL, rank_position: pos, n_ranked_entities: 3, low_coverage: false, indicators: inds, ...o});
const sc = (entities, o = {}) => ({domain_id: "labour", ranked: true, percentile_rank_label: LABEL, heterogeneous_peer_set: false, alignment: [], entities, ...o});
const meta = {
  entities: [{entity_id: "AAA", name: "Aaa", kind: "country"}, {entity_id: "BBB", name: "Bbb", kind: "country"}, {entity_id: "CCC", name: "Ccc", kind: "country"}, {entity_id: "ZZZ", name: "Agg", kind: "aggregate"}],
  indicators: [
    {indicator_id: "I1", name: "Unemployment", unit_label: "%", rank_mode: "monotone_good", good_dir: -1, target: null},
    {indicator_id: "I2", name: "Growth", unit_label: "% y/y", rank_mode: "monotone_good", good_dir: 1, target: null},
    {indicator_id: "I3", name: "Inflation", unit_label: "% y/y", rank_mode: "target_distance", good_dir: 0, target: {value: 2, source_note: "x"}},
    {indicator_id: "I4", name: "Population", unit_label: "million", rank_mode: "descriptive_only", good_dir: 0, target: null}
  ],
  domains: [{domain_id: "labour", name: "Labour", indicator_ids: ["I2", "I1", "I3", "I4"]}]
};
const synthetic = () =>
  domainView(
    sc([
      ent("CCC", 0.2, 3, [ind("I1", {percentile: 0.2}), ind("I2", {percentile: 0.2}), ind("I3", {percentile: null, value: 2.5, alignment: "lagging"}), ind("I4", {rank_mode: "descriptive_only", percentile: null})]),
      ent("AAA", 0.9, 1, [ind("I1", {percentile: 0.9}), ind("I2", {percentile: null, is_stale: true, age_days: 400}), ind("I3", {percentile: 0.5}), ind("I4", {rank_mode: "descriptive_only", percentile: null})]),
      ent("BBB", 0.5, 2, [ind("I1", {percentile: 0.5}), ind("I2", {percentile: 0.8}), ind("I3", {percentile: 0.5, alignment: "ahead", value_kind: "estimate"})]),
      ent("ZZZ", null, null, [ind("I1", {percentile: null})], {n_available: 0})
    ]),
    meta
  );

test("columns follow the stored domain order, with direction labels from rank_mode, good_dir and the stored target only", () => {
  const v = synthetic();
  assert.deepEqual(v.columns.map((c) => c.indicatorId), ["I2", "I1", "I3", "I4"]);
  assert.deepEqual(v.columns.map((c) => c.direction.text), ["higher is better", "lower is better", "closer to target is better (target 2 % y/y)", "descriptive, not ranked"]);
  const noTarget = domainView(sc([ent("AAA", 0.9, 1, [ind("I3")])]), {...meta, indicators: [{...meta.indicators[2], target: {value: null, source_note: "x"}}]});
  assert.equal(noTarget.columns[0].direction.text, "closer to target is better");
  assert.equal(domainView(sc([ent("AAA", 0.9, 1, [ind("I9")])]), meta).columns[0].direction, null);
  // the alert direction is not used: a different adverse_dir does not change the label
  const other = domainView(sc([ent("AAA", 0.9, 1, [ind("I1")])]), {...meta, indicators: [{...meta.indicators[0], adverse_dir: -1}]});
  assert.equal(other.columns[0].direction.text, "lower is better");
});

test("rows are alphabetical by name by default (not by position or percentile), aggregates are flagged", () => {
  const v = synthetic();
  assert.deepEqual(v.rows.map((r) => r.name), ["Agg", "Aaa", "Bbb", "Ccc"].sort((a, b) => a.localeCompare(b)));
  const m = heatmapModel(v);
  assert.deepEqual(sortRows(m).map((r) => r.entityId), ["AAA", "BBB", "CCC"]);
  assert.deepEqual(m.rows.filter((r) => r.aggregate).map((r) => r.entityId), ["ZZZ"]);
});

test("bins come from the stored number only; aggregates, stale, lagging and descriptive cells get none", () => {
  const m = heatmapModel(synthetic());
  const cellOf = (e, i) => m.rows.find((r) => r.entityId === e).cells[m.columns.findIndex((c) => c.indicatorId === i)];
  assert.equal(cellOf("AAA", "I1").bin, 5);
  assert.equal(cellOf("CCC", "I1").bin, 2); // 0.2 is the lower edge of bin 2
  assert.equal(cellOf("AAA", "I2").bin, null); // stale: no rank
  assert.equal(cellOf("CCC", "I3").bin, null); // lagging
  assert.equal(cellOf("CCC", "I4").bin, null); // descriptive
  assert.equal(cellOf("BBB", "I3").state.key, "ahead");
  assert.equal(cellOf("BBB", "I3").bin, 3);
  assert.equal(cellOf("ZZZ", "I1").bin, null);
  const mean = (e) => m.rows.find((r) => r.entityId === e).mean;
  assert.equal(mean("AAA").bin, 5);
  assert.equal(mean("ZZZ").bin, null);
  assert.equal(mean("ZZZ").state.key, "aggregate");
});

test("a percentile outside [0, 1] becomes an unbinned n/a error cell, not a clamped bin (AC-UX-15)", () => {
  const m = heatmapModel(domainView(sc([ent("AAA", 0.9, 1, [ind("I1", {percentile: 1.2})])]), meta));
  const c = m.rows[0].cells[0];
  assert.deepEqual([c.bin, c.invalid, c.state.key], [null, true, "na"]);
  assert.match(heatmapTable(html, m).s, /data-invalid="true"/);
});

test("table markup: caption, th scope, a tbody per group, text in every cell, aggregate group without colour", () => {
  const out = heatmapTable(html, heatmapModel(synthetic())).s;
  assert.match(out, /<caption>Labour: mean percentile of the domain's indicators/);
  assert.equal((out.match(/<tbody/g) ?? []).length, 2);
  assert.match(out, /<th scope="rowgroup" colspan="8">aggregate \(not ranked\)/);
  assert.equal((out.match(/<th scope="col"/g) ?? []).length, 8);
  assert.equal((out.match(/<th scope="row"/g) ?? []).length, 4);
  const agg = out.slice(out.indexOf('data-group="aggregates"'));
  assert.ok(!/data-bin="[1-5]"/.test(agg), "no colour in the aggregate group");
  // every td has text content (visible or hidden) and no td is empty
  for (const td of out.match(/<td[^>]*>[^]*?<\/td>/g)) assert.ok(td.replace(/<[^>]*>/g, "").trim() !== "", td);
  // the domain-figure header carries the orientation note as title and as a described-by target that exists and is non-empty
  assert.match(out, /aria-describedby="domain-heatmap-orientation" title="Higher percentile means/);
  assert.match(out, /<span id="domain-heatmap-orientation" class="mm-visually-hidden">Higher percentile means a more favourable position by each indicator's stated direction\.<\/span>/);
  assert.ok(out.includes("lower is better") && out.includes("higher is better") && out.includes("closer to target is better (target 2 % y/y)"));
  // sortable headers are buttons with aria-sort; the country header starts ascending
  assert.match(out, /<th scope="col" class="mm-hm-country" aria-sort="ascending"><button type="button" class="mm-sort" data-sort="name">Country<\/button>/);
  assert.match(out, /aria-sort="none"[^>]*><button type="button" class="mm-sort" data-sort="mean">/);
});

test("R11: row headers link to the country page, column headers to the indicator page; full names stay accessible; no peers/ link", () => {
  const model = heatmapModel(synthetic());
  const out = heatmapTable(html, model).s;
  assert.match(out, /<th scope="row" class="mm-hm-country"><a href="\.\.\/country\/AAA" data-link="country">Aaa<\/a><\/th>/);
  assert.equal((out.match(/data-link="country"/g) ?? []).length, 4, "every row incl. the aggregate has a country page");
  assert.match(out, /<a class="mm-hm-open" href="\.\.\/indicator\/I1" data-link="indicator" aria-label="Indicator page: Unemployment">Indicator page<\/a>/);
  assert.equal((out.match(/data-link="indicator"/g) ?? []).length, model.columns.length);
  assert.ok(out.includes('title="Unemployment') && out.includes('<span class="mm-hm-name">Unemployment</span>'), "full name still in the header");
  assert.ok(!out.includes("peers/"));
  // a global entity has no country page: its name stays plain text
  const g = heatmapModel(domainView(sc([ent("AAA", 0.9, 1, [ind("I1")]), ent("GGG", null, null, [])]), {...meta, entities: [...meta.entities, {entity_id: "GGG", name: "Globe", kind: "aggregate", is_global: true}]}));
  const gout = heatmapTable(html, g).s;
  assert.ok(gout.includes('class="mm-hm-country">Globe</th>') && !gout.includes("country/GGG"));
});

test("cell names carry the state wording, the bin label and the direction", () => {
  const out = heatmapTable(html, heatmapModel(synthetic())).s;
  assert.ok(out.includes('aria-label="Aaa, Unemployment: 0.90, percentile vs all ranked countries; highest fifth of the panel; lower is better"'));
  assert.ok(out.includes('aria-label="Ccc, Inflation: not ranked (lagging); closer to target is better (target 2 % y/y)"'));
  assert.ok(out.includes("ranked at its latest value, ahead of the common period"));
});

test("informational domain: no colour, no figure column, header says informational, unranked", () => {
  const v = domainView(sc([ent("AAA", null, null, [ind("I1", {percentile: 0.5})])], {ranked: false}), meta);
  const m = heatmapModel(v);
  const out = heatmapTable(html, m).s;
  assert.equal(m.informational, true);
  assert.ok(!/data-bin="[1-5]"/.test(out));
  assert.ok(!out.includes("data-sort=\"mean\"") && !out.includes("Position"));
  assert.ok(out.includes("informational, unranked"));
  assert.match(out, /data-state="plain"/);
  assert.equal(m.hasBins, false);
  assert.ok(!legendBlock(html, {states: m.states, bins: m.hasBins}).s.includes(ORIENTATION_NOTE));
});

test("sorting: indicator column by stored percentile (desc first, then asc), nulls last; figure column by rank_position; name", () => {
  const m = heatmapModel(synthetic());
  const ids = (s) => sortRows(m, s).map((r) => r.entityId);
  assert.deepEqual(nextSort({key: "name", dir: "asc"}, "I1"), {key: "I1", dir: "desc"});
  assert.deepEqual(nextSort({key: "I1", dir: "desc"}, "I1"), {key: "I1", dir: "asc"});
  assert.deepEqual(nextSort(null, "mean"), {key: "mean", dir: "asc"});
  assert.deepEqual(ids({key: "I1", dir: "desc"}), ["AAA", "BBB", "CCC"]);
  assert.deepEqual(ids({key: "I1", dir: "asc"}), ["CCC", "BBB", "AAA"]);
  assert.deepEqual(ids({key: "I2", dir: "desc"}), ["BBB", "CCC", "AAA"]); // AAA is stale: no percentile shown, last
  assert.deepEqual(ids({key: "I2", dir: "asc"}), ["CCC", "BBB", "AAA"]); // still last
  assert.deepEqual(ids({key: "I3", dir: "desc"}), ["AAA", "BBB", "CCC"]); // CCC lagging: last
  assert.deepEqual(ids({key: "mean", dir: "asc"}), ["AAA", "BBB", "CCC"]);
  assert.deepEqual(ids({key: "mean", dir: "desc"}), ["CCC", "BBB", "AAA"]);
  assert.deepEqual(ids({key: "name", dir: "desc"}), ["CCC", "BBB", "AAA"]);
  assert.throws(() => sortRows(m, {key: "nope", dir: "asc"}));
  // ties by name, and aggregates never enter the sorted group
  assert.ok(!ids({key: "I1", dir: "desc"}).includes("ZZZ"));
  // a missing rank_position sorts last in both directions
  const low = heatmapModel(domainView(sc([ent("AAA", 0.5, null, [ind("I1")], {low_coverage: true}), ent("BBB", 0.5, 2, [ind("I1")])]), meta));
  assert.deepEqual(sortRows(low, {key: "mean", dir: "asc"}).map((r) => r.entityId), ["BBB", "AAA"]);
  assert.deepEqual(sortRows(low, {key: "mean", dir: "desc"}).map((r) => r.entityId), ["BBB", "AAA"]);
});

test("legend: orientation note exactly once, five bins, only the marks present on the page", () => {
  const m = heatmapModel(synthetic());
  const out = legendBlock(html, {states: m.states, bins: m.hasBins}).s;
  assert.equal(out.split(ORIENTATION_NOTE).length, 2);
  assert.equal((out.match(/<li data-bin=/g) ?? []).length, 5);
  assert.ok(out.includes("lowest fifth of the panel") && out.includes("highest fifth of the panel"));
  assert.ok(out.startsWith("<section") && out.includes("<ol") && out.includes("<ul"));
  for (const k of ["stale", "lagging", "ahead", "descriptive", "aggregate", "estimate"]) assert.ok(out.includes(`<li data-state="${k}">`), k);
  for (const k of ["unaligned", "not_published", "inherited", "alert_watch"]) assert.ok(!out.includes(`<li data-state="${k}">`), `${k} is not on this page`);
  assert.throws(() => legendBlock(html, {states: ["unknown"]}));
});

test("facts of a cell are the stored fields; the same facts are columns of the detail table", () => {
  const v = synthetic();
  const m = heatmapModel(v);
  const r = m.rows.find((x) => x.entityId === "AAA");
  const k = m.columns.findIndex((c) => c.indicatorId === "I2");
  const f = factsView(html, r, m.columns[k], r.cells[k]).s;
  for (const t of ["Latest value", "3.1 % y/y", "2026-09-30", "Reference offset (days)", "2026-11-01", "400", "120", "stale (400 days old, limit 120 days)"]) assert.ok(f.includes(t), t);
  const page = domainBlock(html, v).s;
  assert.ok(page.includes('<details class="mm-values" id="domain-values"><summary>Values and reference periods</summary>'));
  const detail = page.slice(page.indexOf('id="domain-detail"'));
  assert.ok(detail.includes("Reference offset (days)") && detail.includes("Source release") && detail.includes("Age (days)"));
  assert.equal((page.match(/id="domain-detail"/g) ?? []).length, 1, "the detail table is in the DOM once");
  assert.ok(page.includes('href="#domain-values"') && page.includes("Skip to values table"));
  assert.ok(page.indexOf('id="caveat"') < page.indexOf('id="domain-legend"'), "the caveat precedes the legend");
  assert.equal(page.split(ORIENTATION_NOTE).length - 1, 3, "the note: legend once, plus the header title and its hidden description");
});

// Fixture export (built site data or MM_FIXTURE_EXPORT): every number shown equals the stored one (AC-UX-10).
const dir = process.env.MM_FIXTURE_EXPORT ?? (existsSync(new URL("../src/data/manifest.json", import.meta.url)) ? new URL("../src/data", import.meta.url).pathname : null);
test("fixture domains (labour, prices, agri, global): shown numbers and bins equal the stored scorecard", { skip: dir === null && "no fixture export" }, () => {
  const load = (p) => JSON.parse(readFileSync(`${dir}/${p}`, "utf8"));
  const m0 = {entities: listOf(load("meta/entities.json"), "entities"), indicators: listOf(load("meta/indicators.json"), "indicators"), domains: listOf(load("meta/domains.json"), "domains")};
  let checked = 0;
  for (const d of ["labour", "prices", "agri", "global"]) {
    const raw = load(`scorecard/${d}.json`);
    const v = domainView(raw, m0);
    const m = heatmapModel(v);
    const out = heatmapTable(html, m).s;
    assert.ok(out.includes("<caption>"));
    for (const e of raw.entities) {
      const row = m.rows.find((r) => r.entityId === e.entity_id);
      assert.ok(row, `${d}/${e.entity_id} row`);
      for (const i of e.indicators) {
        const cell = row.cells[m.columns.findIndex((c) => c.indicatorId === i.indicator_id)];
        if (typeof cell.cell.percentile === "number") {
          assert.equal(cell.cell.percentile, i.percentile);
          assert.equal(cell.cell.percentileText, i.percentile.toFixed(2));
          assert.ok(cell.bin >= 1 && cell.bin <= 5);
          checked += 1;
        } else assert.equal(cell.bin, null);
      }
    }
    if (d === "agri" || d === "global") assert.ok(!/data-bin="[1-5]"/.test(out), `${d}: no colour`);
  }
  assert.ok(checked >= 5, `only ${checked} ranked cells checked`);
});
