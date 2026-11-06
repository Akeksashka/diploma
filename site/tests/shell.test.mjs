import assert from "node:assert/strict";
import {test} from "node:test";
import {attributionBlock, headerHtml, statusBlock} from "../src/lib/shell.js";
import {NAV_LABEL, SKIP_LINK_TEXT} from "../src/lib/copy.js";
import config from "../observablehq.config.js";
import {domainPageSource, peersPageSource} from "../scripts/lib.mjs";

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
  assert.ok(out.includes("Data as of 2026-11-01T04:23:41Z"));
});

test("old manifest: banner with id and role", () => {
  const out = text(statusBlock(html, {known_cutoff: "2026-09-01T00:00:00Z", build_id: "b1"}, NOW));
  assert.ok(out.includes('id="stale-banner"'));
  assert.ok(out.includes("known_cutoff 2026-09-01T00:00:00Z"));
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
  assert.ok(old.includes("Data may be out of date: the latest data cutoff (known_cutoff 2026-09-01T00:00:00Z) is 64 days old, older than 45 days."));
  const bad = text(statusBlock(html, {build_id: "b1"}, NOW));
  assert.ok(bad.includes('role="alert"'));
  assert.ok(bad.includes("Data freshness unknown: the build has no readable known_cutoff (missing). Treat the data as out of date."));
});

test("freshness line wording is unchanged", () => {
  assert.ok(text(statusBlock(html, {known_cutoff: "2026-11-01T04:23:41Z", build_id: "b1"}, NOW)).includes('<p class="mm-asof">Data as of 2026-11-01T04:23:41Z (build b1).</p>'));
});

test("every page source calls statusBlock (banner on every page)", async () => {
  const {readFileSync} = await import("node:fs");
  const files = ["index", "explorer", "revisions", "status"].map((n) => readFileSync(new URL(`../src/${n}.md`, import.meta.url), "utf8"));
  files.push(domainPageSource("labour", "Labour"), peersPageSource("labour", "Labour"));
  for (const f of files) assert.ok(/display\(pageHead\(html, boot, "\w+"\)\);/.test(f)) // pageHead = statusBlock + the failed-region alerts;
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
  assert.ok(h.includes('<a href="/explorer" aria-current="page">Explorer</a>'));
  assert.ok(headerHtml({title: "T", pages: config.pages, path: "/index"}).includes('<a href="/" aria-current="page">'));
  assert.ok(!headerHtml({title: "T", pages: config.pages, path: "/domain/labour"}).includes("aria-current"));
});

test("header escapes titles; config keeps Framework chrome off and sets the header", () => {
  assert.ok(headerHtml({title: "A <b>", pages: [], path: "/"}).includes("A &lt;b&gt;"));
  assert.equal(config.sidebar, false);
  assert.equal(config.pager, false);
  assert.equal(config.toc, false);
  assert.equal(typeof config.header, "function");
  assert.ok(config.header({path: "/status"}).includes("mm-nav"));
});

test("generated pages have exactly one static h1, escaped, before any cell", () => {
  for (const src of [domainPageSource("labour", "Labour <x>"), peersPageSource("labour", "Labour <x>"), domainPageSource("fin")]) {
    assert.equal((src.match(/<h1>/g) ?? []).length, 1);
    assert.ok(!/^# /m.test(src.replace(/```[\s\S]*?```/g, "")));
    assert.ok(src.indexOf("<h1>") < src.indexOf("```js"));
  }
  assert.ok(domainPageSource("labour", "Labour <x>").includes("<h1>Domain scorecard: Labour &lt;x&gt;</h1>"));
  assert.ok(domainPageSource("fin").includes("<h1>Domain scorecard</h1>"));
});

test("hand-written pages have exactly one static h1", async () => {
  const {readFileSync} = await import("node:fs");
  for (const n of ["index", "status"]) {
    const f = readFileSync(new URL(`../src/${n}.md`, import.meta.url), "utf8").replace(/```[\s\S]*?```/g, "");
    assert.equal((f.match(/^# /gm) ?? []).length, 1, n);
  }
});
