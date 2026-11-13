import assert from "node:assert/strict";
import {test} from "node:test";
import {attributionBlock, headerHtml, statusBlock} from "../src/lib/shell.js";
import {NAV_LABEL, SKIP_LINK_TEXT} from "../src/lib/copy.js";
import {carryHrefForAttrs} from "../src/lib/carry.js";
import config from "../observablehq.config.js";
import {domainPageSource, domainsPageSource, homePageSource} from "../scripts/lib.mjs";

// Minimal stand-in for htl's `html`: escapes interpolated strings, passes nested results and arrays.
class Raw {
  constructor(s) {
    this.s = s;
  }
}
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : esc(v));
const html = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? part(vals[i]) : ""), ""));
const text = (r) => r.s;

const NOW = Date.parse("2026-11-04T00:00:00Z");

test("fresh manifest: no banner, as-of line shown", () => {
  const out = text(statusBlock(html, {known_cutoff: "2026-11-01T04:23:41Z", build_id: "b1"}, NOW));
  assert.ok(!out.includes("stale-banner"));
  assert.ok(out.includes("Data cut-off: 2026-11-01 (build b1)."));
});

test("old manifest: banner with id and role", () => {
  const out = text(statusBlock(html, {known_cutoff: "2026-09-01T00:00:00Z", build_id: "b1"}, NOW));
  assert.ok(out.includes('id="stale-banner"'));
  assert.ok(out.includes("the data cut-off (2026-09-01)"));
  assert.ok(!out.includes("known_cutoff"));
});

test("attribution block lists public sources only and escapes text", () => {
  const series = [
    {indicator_id: "M09", publish: "public", source_id: "S1", source_name: "A <b>", licence_attribution: "Source: A", source_url: "https://example.org/a"},
    {indicator_id: "M09", publish: "withheld", source_id: "S2", source_name: "Secret"}
  ];
  const out = text(attributionBlock(html, series));
  assert.ok(out.includes("A &lt;b&gt;"));
  assert.ok(out.includes('href="https://example.org/a"'));
  assert.ok(!out.includes("Secret"));
});

test("attribution block with nothing to list says so", () => {
  assert.ok(text(attributionBlock(html, [])).includes("No source attribution available."));
});

const DAY = 86400000;
const CUTOFF = "2026-09-20T00:00:00Z";

test("AC-DASH-7: 45-day boundary (exactly 45 days is fresh, one millisecond more is stale)", () => {
  const at = Date.parse(CUTOFF);
  assert.ok(!text(statusBlock(html, {known_cutoff: CUTOFF, build_id: "b"}, at + 45 * DAY)).includes("stale-banner"));
  assert.ok(text(statusBlock(html, {known_cutoff: CUTOFF, build_id: "b"}, at + 45 * DAY + 1)).includes("stale-banner"));
});

test("stale banner: role alert and the unchanged wording; unreadable cutoff also alerts", () => {
  const old = text(statusBlock(html, {known_cutoff: "2026-09-01T00:00:00Z", build_id: "b1"}, NOW));
  assert.ok(old.includes('<p class="mm-banner" id="stale-banner" role="alert">'));
  assert.ok(old.includes("Data may be out of date: the data cut-off (2026-09-01) is 64 days old, more than 45 days."));
  const bad = text(statusBlock(html, {build_id: "b1"}, NOW));
  assert.ok(bad.includes('role="alert"'));
  assert.ok(bad.includes("Data freshness unknown: this build has no readable data cut-off. Treat the data as out of date."));
});

test("freshness line wording is unchanged", () => {
  assert.ok(text(statusBlock(html, {known_cutoff: "2026-11-01T04:23:41Z", build_id: "b1"}, NOW)).includes('<p class="mm-asof">Data cut-off: 2026-11-01 (build b1).</p>'));
});

test("every page source calls statusBlock (banner on every page)", async () => {
  const {readFileSync} = await import("node:fs");
  const files = ["explorer", "revisions"].map((n) => readFileSync(new URL(`../src/${n}.md`, import.meta.url), "utf8"));
  files.push(domainPageSource("labour", "Labour"), homePageSource({entities: [], indicators: [], domains: []}), domainsPageSource([]));
  for (const f of files) assert.ok(/display\(pageHead\(html, boot, "\w+"\)\);/.test(f)) // pageHead = statusBlock + the failed-region alerts;
});

// D-1 (OQ-16, ADR-037 A2.6 item 2, spec section 2): AC-RD-01 and G-STR4 now read six pages: Home, Country, Compare, Time series, Domains, Revisions.
test("AC-RD-01 (six pages per spec section 2): header navigation is exactly Home, Country, Compare, Time series, Domains, Revisions; nothing links to status or a guide", async () => {
  assert.deepEqual(config.pages, [{name: "Home", path: "/"}, {name: "Country", path: "/country"}, {name: "Compare", path: "/compare"}, {name: "Time series", path: "/explorer"}, {name: "Domains", path: "/domains"}, {name: "Revisions", path: "/revisions"}]);
  const h = headerHtml({title: "Macro Monitor", pages: config.pages, path: "/"});
  assert.deepEqual([...h.matchAll(/<li><a [^>]*>([^<]*)<\/a><\/li>/g)].map((m) => m[1]), ["Home", "Country", "Compare", "Time series", "Domains", "Revisions"]);
  // the language switch (ADR-037 A2.1) is not a page and stays outside the nav landmark, so it is never one of the six
  assert.ok(!/hreflang|lang=/.test(h.slice(h.indexOf("<nav"), h.indexOf("</nav>"))));
  // the two mode pages carry only the keys that stay meaningful for them (carry.js); the other four carry the whole hash as before
  assert.ok(h.includes('<a href="/country" data-carry="country">Country</a>') && h.includes('<a href="/compare" data-carry="compare">Compare</a>'));
  assert.ok(h.includes('<a href="/explorer" data-carry>Time series</a>'));
  assert.ok(!/status|guide/i.test(h.replace(/<noscript>[\s\S]*<\/noscript>/, "")));
  const {existsSync} = await import("node:fs");
  assert.ok(!existsSync(new URL("../src/status.md", import.meta.url)) && !existsSync(new URL("../src/guide.md", import.meta.url)));
});

test("header: skip link first, then title and the pages nav; no heading", () => {
  const h = headerHtml({title: "Macro Monitor", pages: config.pages, path: "/explorer"});
  assert.ok(h.startsWith(`<a class="mm-skip" href="#observablehq-main">${SKIP_LINK_TEXT}</a>`));
  assert.ok(h.indexOf("mm-skip") < h.indexOf("mm-site-title") && h.indexOf("mm-site-title") < h.indexOf("<nav"));
  assert.ok(h.includes(`<nav class="mm-nav" aria-label="${NAV_LABEL}">`));
  assert.ok(!/<h[1-6][\s>]/.test(h));
  assert.equal((h.match(/<li>/g) ?? []).length, config.pages.length);
  for (const p of config.pages) assert.ok((h.includes(`href="${p.path}"`) && h.includes(`${p.name}</a>`)));
  assert.equal((h.match(/aria-current="page"/g) ?? []).length, 1);
  assert.ok(h.includes('<a href="/explorer" data-carry aria-current="page">Time series</a>'));
  assert.ok(headerHtml({title: "T", pages: config.pages, path: "/index"}).includes('<a href="/" data-carry aria-current="page">'));
  assert.ok(headerHtml({title: "T", pages: config.pages, path: "/country"}).includes('<a href="/country" data-carry="country" aria-current="page">Country</a>'));
  assert.ok(headerHtml({title: "T", pages: config.pages, path: "/compare"}).includes('<a href="/compare" data-carry="compare" aria-current="page">Compare</a>'));
  assert.ok(!headerHtml({title: "T", pages: config.pages, path: "/domain/labour"}).includes("aria-current"));
});

test("Part 0: on a Country page the header Compare link forces c to the page's country; other pages and links are unchanged", () => {
  const onCountry = headerHtml({title: "T", pages: config.pages, path: "/country/DEU"});
  assert.ok(onCountry.includes('<a href="/compare" data-carry="compare" data-carry-set="c=DEU">Compare</a>'));
  assert.equal((onCountry.match(/data-carry-set/g) ?? []).length, 1, "only Compare is forced");
  // the forced key survives a stale hash: carrying #c=FRA&i=M09 to Compare gives c=DEU, i kept
  assert.equal(carryHrefForAttrs("/compare", "#c=FRA&i=M09", "compare", "c=DEU"), "/compare#c=DEU&i=M09");
  assert.ok(!headerHtml({title: "T", pages: config.pages, path: "/country"}).includes("data-carry-set"));
  assert.ok(!headerHtml({title: "T", pages: config.pages, path: "/compare"}).includes("data-carry-set"));
  assert.ok(!headerHtml({title: "T", pages: config.pages, path: "/country/../x"}).includes("data-carry-set"));
});

test("header escapes titles; config keeps Framework chrome off and sets the header", () => {
  assert.ok(headerHtml({title: "A <b>", pages: [], path: "/"}).includes("A &lt;b&gt;"));
  assert.equal(config.sidebar, false);
  assert.equal(config.pager, false);
  assert.equal(config.toc, false);
  assert.equal(typeof config.header, "function");
  assert.ok(config.header({path: "/revisions"}).includes("mm-nav"));
});

test("generated pages have exactly one static h1, escaped, before any cell", () => {
  for (const src of [domainPageSource("labour", "Labour <x>"), domainPageSource("fin")]) {
    assert.equal((src.match(/<h1>/g) ?? []).length, 1);
    assert.ok(!/^# /m.test(src.replace(/```[\s\S]*?```/g, "")));
    assert.ok(src.indexOf("<h1>") < src.indexOf("```js"));
  }
  assert.ok(domainPageSource("labour", "Labour <x>").includes("<h1>Domain scorecard: Labour &lt;x&gt;</h1>"));
  assert.ok(domainPageSource("fin").includes("<h1>Domain scorecard</h1>"));
});

test("hand-written pages have exactly one static h1", async () => {
  const {readFileSync} = await import("node:fs");
  const gen = [["home", homePageSource({entities: [], indicators: [], domains: []})], ["domains", domainsPageSource([])]];
  for (const [n, src] of gen) assert.equal((src.replace(/```[\s\S]*?```/g, "").match(/<h1>/g) ?? []).length, 1, n);
});

test("offset cut-off: freshness line and stale banner show the same UTC date", () => {
  const m = {known_cutoff: "2026-10-01T23:00:00-05:00", build_id: "b1"}; // UTC 2026-10-02T04:00Z
  const out = text(statusBlock(html, m, Date.parse("2026-11-20T00:00:00Z"))); // 49 days later: stale
  assert.ok(out.includes("Data cut-off: 2026-10-02 (build b1)."), out);
  assert.ok(out.includes('id="stale-banner"') && out.includes("2026-10-02") && !out.includes("2026-10-01"), out);
  assert.ok(text(statusBlock(html, m, Date.parse("2026-10-05T00:00:00Z"))).includes("Data cut-off: 2026-10-02"));
});

test("L10: every header navigation link opts in to carrying the hash; the skip link and site title do not", () => {
  const h = headerHtml({title: "T", pages: config.pages, path: "/"});
  const nav = h.slice(h.indexOf("<nav"), h.indexOf("</nav>"));
  assert.equal((nav.match(/<a /g) ?? []).length, (nav.match(/<a [^>]*data-carry/g) ?? []).length);
  assert.ok(!h.slice(0, h.indexOf("<nav")).includes("data-carry"));
});

test("L10: the freshness line is followed by an empty print-filters slot the filter bar fills", () => {
  const out = text(statusBlock(html, {known_cutoff: "2026-11-01T04:23:41Z", build_id: "b1"}, NOW));
  assert.ok(out.includes('</p><p class="mm-print-filters" id="print-filters"></p>'));
});
