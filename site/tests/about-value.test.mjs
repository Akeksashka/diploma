// Redesign R8: "About this value" field list (spec 5.5, AC-RD-46 markup level) on the SYNTHETIC sparse fixture, htl stand-in.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {aboutDetails, aboutFields, aboutFlags} from "../src/lib/about-value.js";
import * as copy from "../src/lib/copy.js";
import {countryModel} from "../src/lib/country-model.js";
import {switcherOptions} from "../src/lib/country-view.js";
import {countryPage as countryBlock} from "../src/lib/country-page.js";
import {html} from "./support/html-standin.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sparse_export");
const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const entities = load("meta/entities.json").entities;
const indicators = load("meta/indicators.json").indicators;
const series = load("meta/series.json").series;
const domains = load("meta/domains.json").domains;
const scorecards = Object.fromEntries(domains.map((d) => [d.domain_id, load(`scorecard/${d.domain_id}.json`)]));
const model = (id, extraSeries = series) => countryModel({entity: entities.find((e) => e.entity_id === id), domains, scorecards, indicators, series: extraSeries, groups: []});
const rowOf = (m, dom, ind) => m.domains.find((d) => d.domainId === dom).rows.find((r) => r.indicatorId === ind);
const fakePlot = {plot: () => "<svg></svg>", rectX: () => ({}), ruleX: () => ({}), dot: () => ({})};

test("fields come from stored data in the order of spec 5.5, labels from copy.js", () => {
  const m = model("SY01");
  const r = rowOf(m, "growth", "T01");
  const f = aboutFields(r, m.header.name);
  const keys = f.map((x) => x.key);
  assert.deepEqual(keys.slice(0, 2), ["indicator", "country"]);
  for (const x of f) assert.equal(x.label, copy.DRAFT_ABOUT_LABELS[x.key]);
  const order = Object.keys(copy.DRAFT_ABOUT_LABELS);
  assert.deepEqual(keys, order.filter((k) => keys.includes(k)), "field order is the label order");
  assert.equal(f.find((x) => x.key === "indicator").value, r.name);
  assert.equal(f.find((x) => x.key === "unit").value, r.seriesMeta.unit_code, "series-level unit (spec 5.2), unit_mult 0 adds no text");
  assert.equal(f.find((x) => x.key === "source").value, r.seriesMeta.source_name);
});

test("every stored field of spec 5.5 is shown when stored and none is invented when absent", () => {
  const m = model("SY01");
  const r = rowOf(m, "growth", "T01");
  const full = {
    ...r,
    cell: {...r.cell, series_id: 7, known_at: "2026-11-01T04:23:41Z", source_release_at: "2026-10-30T00:00:00Z", age_days: 30, stale_limit_days: 120, transform_id: "LEVEL"},
    seriesMeta: {...r.seriesMeta, series_id: 7, source_name: "Src", source_url: "https://example.org/s", licence_attribution: "Lic", frequency: "M", seasonal_adjustment: "SA", price_basis: "real", reestimating: true}
  };
  const f = Object.fromEntries(aboutFields(full, "Country X").map((x) => [x.key, x]));
  assert.equal(f.seriesId.value, 7);
  assert.equal(f.source.href, "https://example.org/s");
  assert.equal(f.attribution.value, "Lic");
  assert.equal(f.frequency.value, "M");
  assert.equal(f.seasonal.value, "SA");
  assert.equal(f.priceBasis.value, "real");
  assert.equal(f.knownAt.value, "2026-11-01T04:23:41Z");
  assert.equal(f.sourceRelease.value, "2026-10-30T00:00:00Z");
  assert.equal(f.age.value, 30);
  assert.equal(f.staleLimit.value, 120);
  assert.equal(f.transform.value, "LEVEL");
  assert.equal(f.reestimating.value, copy.DRAFT_REESTIMATED_MARK);
  const scaled = Object.fromEntries(aboutFields({...full, unit: "indicator label", seriesMeta: {...full.seriesMeta, unit_code: "USD", unit_mult: 6}}, "C").map((x) => [x.key, x]));
  assert.equal(scaled.unit.value, "USD; values in USD x 10^6", "unit_code plus the unit_mult text, not the indicator unit_label");
  const bare = Object.fromEntries(aboutFields({...r, cell: {}, seriesMeta: null, sourceName: null, sourceUrl: null}, "C").map((x) => [x.key, x]));
  for (const k of ["unit", "seriesId", "knownAt", "age", "staleLimit", "transform", "attribution", "priceBasis", "reestimating"]) assert.equal(k in bare, false, k);
});

test("a source URL that is not http(s) is not a link", () => {
  const r = rowOf(model("SY01"), "growth", "T01");
  const f = aboutFields({...r, seriesMeta: {...r.seriesMeta, source_url: "javascript:alert(1)"}}, "C").find((x) => x.key === "source");
  assert.equal(f.href, null);
});

test("flags are the stored short sentences and tags", () => {
  const est = rowOf(model("SY01"), "growth", "T02");
  assert.ok(aboutFlags(est).includes(copy.FLAG_ESTIMATE));
  const lag = rowOf(model("SY04"), "growth", "T02");
  assert.ok(aboutFlags(lag).includes(copy.FLAG_LAGGING));
  assert.ok(aboutFlags(lag).includes(lag.state.sentence));
  const ahead = rowOf(model("SY06"), "growth", "T02");
  assert.ok(aboutFlags(ahead).includes(copy.FLAG_AHEAD));
  assert.deepEqual(aboutFlags(rowOf(model("SY01"), "growth", "T01")), [], "a plain ranked value has no flags");
});

test("markup: a native <details> with a summary and a definition list, not tooltip-only", () => {
  const m = model("SY01");
  const out = String(aboutDetails(html, rowOf(m, "growth", "T01"), m.header.name, "about-growth-T01"));
  assert.match(out, /^<details class="mm-about" id="about-growth-T01" data-for="T01"><summary>About this value<\/summary><dl class="mm-about-list">/);
  assert.ok(out.includes('<dt>Indicator</dt>') && out.includes("<dt>Unit</dt>"));
  assert.ok(!/\btitle=|aria-describedby|tooltip/i.test(out), "no tooltip-only content");
  assert.ok(!/\bopen\b/.test(out.split("<summary>")[0]), "closed by default");
});

test("the country page has one About details per value row and none for rows without a value", () => {
  const m = model("SY07");
  const out = String(countryBlock(html, fakePlot, m, switcherOptions(entities)));
  const values = m.domains.flatMap((d) => d.withValue).length;
  assert.equal(out.match(/<details class="mm-about"/g)?.length ?? 0, values);
  assert.equal(out.match(/<tr class="mm-sub-row"/g)?.length ?? 0, values);
  assert.ok(!/<nav[\s>]/.test(out), "no <nav> in country markup");
});

test("about-value.js computes nothing", () => {
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "about-value.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\b(reduce|Math\.|sort\()|\.length\s*[-+*/]|\+\+|Date\.|new Date/);
});
