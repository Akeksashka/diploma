// V16 (Country page assembly; AC-V2-40 fixture part, 61; AC-RD-01, 02, 05): K1, L1, L2, P1a and T1 composed on /country/<id>, on the SYNTHETIC v2 fixture (stand-ins for htl and Plot).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_COUNTRY_CARD_TITLES} from "../src/lib/copy.js";
import {countryPage} from "../src/lib/country-page.js";
import {switcherOptions} from "../src/lib/country-view.js";
import {countryPageSource} from "../scripts/lib.mjs";
import {html} from "./support/html-standin.mjs";
import {entities, domains, groups, inputsOf, manifest, modelOf} from "./support/load-v2.mjs";

const plot = {plot: () => "<svg></svg>", rectX: (d, o) => ({d, o}), ruleX: (d, o) => ({d, o}), dot: (d, o) => ({d, o})};
const page = (id, v2 = {}) => String(countryPage(html, plot, modelOf(id), switcherOptions(entities), null, null, {inputs: inputsOf(id), ...v2}));
const section = (out, domainId) => new RegExp(`<section class="mm-dband mm-country-domain" id="domain-${domainId}"[\\s\\S]*?</section>`).exec(out)[0];

test("V16: one band per domain in the stored order, each with K1, then L1, then the T1 table (AC-V2-10, 14, 25)", () => {
  const out = page("DEU");
  const ids = [...out.matchAll(/<section class="mm-dband mm-country-domain" id="domain-([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, domains.map((d) => d.domain_id).filter((id) => modelOf("DEU").domains.some((x) => x.domainId === id)));
  for (const id of ids) {
    const s = section(out, id);
    const at = (needle) => s.indexOf(needle);
    assert.ok(at('data-card="k1"') > 0 && at('data-card="l1"') > at('data-card="k1"') && at("data-table-card=") > at('data-card="l1"'), `${id}: K1, L1, T1 in that order`);
    assert.match(s, new RegExp(`<h3>${DRAFT_COUNTRY_CARD_TITLES.k1}</h3>`));
    assert.match(s, new RegExp(`<h3>${DRAFT_COUNTRY_CARD_TITLES.t1}: `));
  }
});

test("V16: the first two L1 cards are open, the rest collapsed; panels with no series file wait or state it, they are never invented", () => {
  const out = page("DEU");
  const opens = [...out.matchAll(/<details class="mm-card mm-card--span-12 mm-l1" data-card="l1" data-domain="([a-z]+)" open=(true|false)>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(opens.map((o) => o[1]), ["true", "true", "false", "false", "false", "false"]);
  assert.ok(!/<svg><\/svg>/.test(out.replace(/<svg class="mm-sprite"[\s\S]*?<\/svg>/, "")), "no chart is drawn before a series file has been read");
});

test("V16: without the percentile layer the page has no percentile tile, strip, column or sentence; the control sits above the bands (spec 5.3: K1 and T1 have pc)", () => {
  const out = page("DEU");
  assert.doesNotMatch(out, /data-tile="domain-figure"|mm-card--strip|class="mm-orientation"|class="mm-pct"/);
  assert.equal(out.split('class="mm-caveat"').length - 1, 1, "the standing caveat is printed once per page, whatever pc is (C-CTRY-6, AC-RD-62)");
  const on = page("DEU", {percentile: true});
  assert.match(on, /data-tile="domain-figure"/);
  assert.equal(on.split('class="mm-caveat"').length - 1, 1);
  assert.equal(on.split('class="mm-orientation"').length - 1, 1, "the orientation sentence follows pc alone");
  assert.ok(on.indexOf("mm-caveat") < on.indexOf("mm-orientation"), "caveat first");
});

test("V16: the Country switcher sits above the bands without a store; the empty card and the stated unreadable-series sentence exist; no controls that do not act (no Indicator, no rebase, no projection)", () => {
  const out = page("DEU");
  assert.ok(out.indexOf("country-switcher") < out.indexOf('id="domain-labour"'));
  assert.match(out, /id="country-empty" hidden/);
  assert.doesNotMatch(out, /id="filter-indicator"|-rebase"|projection|data-action="proj"/i);
});

test("V16: the page source retains the static breadcrumb, the heading and the scorecard, series and meta files, and drops the old caveat block (AC-RD-01, 02, 05)", () => {
  const src = countryPageSource(entities.find((e) => e.entity_id === "DEU"), groups, domains.map((d) => d.domain_id), manifest);
  assert.equal(src.match(/<h1\b/g).length, 1);
  assert.match(src, /class="mm-crumb"/);
  for (const d of domains) assert.ok(src.includes(`FileAttachment("../data/scorecard/${d.domain_id}.json")`), d.domain_id);
  for (const id of ["M09", "A05", "V06"]) assert.ok(src.includes(`"${id}": FileAttachment("../data/series/${id}.json")`), `lazy series file ${id}`);
  assert.ok(src.includes("entities: d.meta.entities") && src.includes("knownCutoff: d.manifest.known_cutoff") && src.includes("bounds: periodBounds(d.manifest)"));
  assert.ok(!src.includes("mm-caveat"));
  assert.match(src, /countryPage\(html, Plot, model, boot\.derived\.options, historySource\(boot\.data\.manifest, seriesFiles\), \{store, inputs: boot\.derived\.inputs\}\)/);
});

test("V16: series files are read lazily: only the page's own series attachments name them, and nothing in the page source fetches before the page code runs (AC-V2-40, 62)", () => {
  const src = countryPageSource(entities.find((e) => e.entity_id === "DEU"), groups, domains.map((d) => d.domain_id), manifest);
  assert.doesNotMatch(src, /\.parquet\(\)|\.json\(\)[^\n]*series\//, "no eager read of a series file");
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "country-page.js"), "utf8");
  assert.match(code, /addEventListener\?\.\("load"/, "L1 reads start after the load event");
  assert.match(code, /loadSeries\(history\.entries\.get\(indicatorId\), history\.files\[indicatorId\]\)/, "one file per indicator, through the shared 5 MB guarded loader");
});

test("V16: the page computes nothing: no rank, percentile, mean, quantile, regression, resampling, unit conversion, difference or growth in the Country modules (static)", () => {
  const here = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib");
  for (const n of ["country-page.js", "l1-card.js", "peer-strip.js", "series-chart.js"]) {
    const code = readFileSync(join(here, n), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bd3\b|Math\.|\.reduce\(|quantile|median|regress|resampl|correlat/, n);
  }
});

test("D3 (decided 2026-11-13): with pc=1 and no stored percentile in any row the orientation sentence is still printed, the percentile column header is not", () => {
  const strip = (id) => {
    const m = modelOf(id);
    for (const d of m.domains) for (const r of [...d.rows, ...d.withValue, ...d.withoutValue]) Object.assign(r, {percentile: null, percentileText: null, bin: null});
    m.showsPercentiles = false;
    return m;
  };
  const inputs = structuredClone(inputsOf("DEU"));
  for (const sc of Object.values(inputs.scorecards)) for (const e of sc.entities) for (const c of e.indicators) c.percentile = null;
  const out = String(countryPage(html, plot, strip("DEU"), switcherOptions(entities), null, null, {inputs, percentile: true}));
  assert.equal(out.split('class="mm-orientation"').length - 1, 1);
  assert.equal(out.split('class="mm-caveat"').length - 1, 1);
  assert.doesNotMatch(out, /<th scope="col">percentile vs all ranked countries<\/th>/);
  assert.match(out, /<th scope="col">State<\/th>/);
  const withPct = String(countryPage(html, plot, modelOf("DEU"), switcherOptions(entities), null, null, {inputs: inputsOf("DEU"), percentile: true}));
  assert.match(withPct, /<th scope="col">percentile vs all ranked countries<\/th>/, "a table holding a stored percentile keeps the header");
});
