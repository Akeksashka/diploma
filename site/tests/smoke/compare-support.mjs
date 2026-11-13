// Shared helpers for the Compare-mode browser smoke tests (Group D, V18 to V23): c1, c2, c3, c4, compare, and the page-level updates of indicator, domain and requests.
// Conventions as support.mjs: localhost only, off-origin requests abort, skip without a browser unless MM_SMOKE_REQUIRE_BROWSER=1. Expectations are read from the BUILT stored
// files (dist/_file/data), never from the page code. Tests that need the synthetic v2 fixture (tests/fixtures/v2_export: 42 countries, series files as JSON, QA indicators V01 to V06)
// skip on another export. Nothing here runs a build; it only reads dist/.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {walk} from "../../scripts/lib.mjs";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";
import {setViewport} from "./ux-support.mjs";

export const NOW = "2026-11-04T12:00:00Z";
export const TIMEOUT = 30000;

// The square last-point marker of a stale series (Plot symbol "square" renders as a closed h/v path).
export const SQUARE_PATH = /^M-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?h-?\d+(?:\.\d+)?v-?\d+(?:\.\d+)?h-?\d+(?:\.\d+)?z$/i;
// The display text of a stored number, as explorer.js valueText prints it (no float noise).
export const valueText = (v) => String(Number(v.toPrecision(10)));
export const cleanLog = (log) => {
  assert.deepEqual(log.errors, [], "page or console errors");
  assert.deepEqual(log.offOrigin, [], "off-origin requests");
  assert.deepEqual(log.failed, [], "failed requests");
};

// Built data file `<stem>.<hash>.json` of the export that dist/ was built from.
export function builtJson(rel) {
  const stem = rel.replace(/\.json$/, "");
  const dir = join(DIST, "_file", "data", ...stem.split("/").slice(0, -1));
  const base = stem.split("/").at(-1);
  const f = walk(dir).find((p) => new RegExp(`/${base}\\.[0-9a-f]+\\.json$`).test(p));
  assert.ok(f, `no built data file for ${rel}`);
  return JSON.parse(readFileSync(f, "utf8"));
}

// One harness per test file: `before`/`after` for node:test, stored meta, and withPage.
export function harness() {
  const h = {
    browser: null,
    site: null,
    reason: distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`,
    entities: [],
    indicators: [],
    domains: [],
    groups: [],
    seriesMeta: [],
    manifest: null,
    cache: new Map()
  };
  h.data = (rel) => {
    if (!h.cache.has(rel)) h.cache.set(rel, builtJson(rel));
    return h.cache.get(rel);
  };
  h.before = async () => {
    if (!distBuilt()) {
      if (REQUIRE_BROWSER) assert.fail(h.reason);
      return;
    }
    ({browser: h.browser, reason: h.reason} = await launchBrowser());
    if (!h.browser) {
      if (REQUIRE_BROWSER) assert.fail(h.reason);
      return;
    }
    h.site = await serve();
    h.entities = h.data("meta/entities.json").entities;
    h.indicators = h.data("meta/indicators.json").indicators;
    h.domains = h.data("meta/domains.json").domains;
    h.groups = h.data("meta/groups.json").groups;
    h.seriesMeta = h.data("meta/series.json").series;
    h.manifest = h.data("manifest.json");
  };
  h.after = async () => {
    await h.browser?.close();
    await h.site?.close();
  };
  h.isV2 = () => h.indicators.some((i) => i.indicator_id === "V06") && h.entities.some((e) => e.entity_id === "DEU");
  h.indicator = (id) => h.indicators.find((i) => i.indicator_id === id);
  // Countries of the comparison set (kind country, not global) and the stored aggregate reference rows (kind aggregate, not global).
  h.countries = () => h.entities.filter((e) => e.kind === "country" && e.is_global !== true);
  h.aggregates = () => h.entities.filter((e) => e.kind === "aggregate" && e.is_global !== true);
  h.nameOf = (id) => h.entities.find((e) => e.entity_id === id)?.name ?? id;
  // The stored scorecard cell of (entity, indicator): the first of the indicator's domains that holds it (as the stored file order).
  h.cell = (indicatorId, entityId) => {
    for (const d of h.indicator(indicatorId).domain_ids) {
      const e = h.data(`scorecard/${d}.json`).entities.find((x) => x.entity_id === entityId);
      const c = e?.indicators.find((i) => i.indicator_id === indicatorId);
      if (c) return c;
    }
    return null;
  };
  h.alignment = (indicatorId) => {
    for (const d of h.indicator(indicatorId).domain_ids) {
      const a = h.data(`scorecard/${d}.json`).alignment?.find((x) => x.indicator_id === indicatorId);
      if (a) return a;
    }
    return null;
  };
  // Series file rows as objects, only for the v2 fixture (JSON rows with the Parquet column names).
  h.rows = (indicatorId) => {
    const f = h.data(`series/${indicatorId}.json`);
    return f.rows.map((r) => Object.fromEntries(f.columns.map((c, k) => [c, r[k]])));
  };
  h.seriesOf = (indicatorId, entityId, frequency = null) => h.seriesMeta.find((s) => s.indicator_id === indicatorId && s.entity_id === entityId && (frequency === null || s.frequency === frequency)) ?? null;
  // Stored finite values of (indicator, entity, frequency): Map ref_period_end -> value.
  h.values = (indicatorId, entityId, frequency = null) => {
    const meta = h.seriesOf(indicatorId, entityId, frequency);
    const out = new Map();
    if (!meta) return out;
    for (const r of h.rows(indicatorId)) if (r.entity_id === entityId && r.series_id === meta.series_id && typeof r.value === "number") out.set(r.ref_period_end, r.value);
    return out;
  };
  // Runs fn({page, log, context}) in a fresh context with the fixed clock. `v2`: skip unless the synthetic v2 fixture was built. `route(context, page)` runs before goto.
  h.withPage = async (t, path, ready, fn, {v2 = true, width = null, route = null, fixedTime = NOW, javaScriptEnabled = true} = {}) => {
    if (!h.browser) return t.skip(h.reason);
    if (v2 && !h.isV2()) return t.skip("needs the synthetic v2 fixture export (tests/fixtures/v2_export)");
    if (!javaScriptEnabled) {
      const context = await h.browser.newContext({javaScriptEnabled: false});
      try {
        const page = await context.newPage();
        await page.goto(`${h.site.origin}${path}`);
        await fn({page, log: null, context});
      } finally {
        await context.close();
      }
      return;
    }
    const {page, context, log} = await openPage(h.browser, h.site.origin, {fixedTime});
    try {
      if (route) await route(context, page);
      if (width) await setViewport(page, width);
      await page.goto(`${h.site.origin}${path}`);
      if (ready) await page.waitForSelector(ready, {timeout: TIMEOUT});
      await fn({page, log, context});
    } finally {
      await context.close();
    }
  };
  return h;
}

// ---- hidden-rows disclosure (ADR-036 Amendment 1, A1.4; AC-V2-80, 88, 89) ----------------------------------------------------------------------------------------------
const PART_KEYS = {"no data": "no_data", stale: "stale", "other period": "other_period", other: "other"};
// "7 rows hidden: 4 no data, 2 stale, 1 other period" -> {total, no_data, stale, other_period, other}; null when the text does not match the template.
export function parseHiddenSummary(text) {
  const m = /^(\d+) rows? hidden: (.+)$/.exec(text.trim());
  if (!m) return null;
  const counts = {total: Number(m[1]), no_data: 0, stale: 0, other_period: 0, other: 0};
  for (const part of m[2].split(", ")) {
    const p = /^(\d+) (no data|stale|other period|other)$/.exec(part);
    if (!p) return null;
    counts[PART_KEYS[p[2]]] = Number(p[1]);
  }
  return counts;
}

// The disclosure of a card: {present, summary, counts, items}. `scope` is a CSS selector of the card.
export async function hiddenOf(page, scope) {
  const box = page.locator(`${scope} .mm-hidden-rows`);
  if ((await box.count()) === 0) return {present: false, summary: "", counts: null, items: []};
  const summary = (await box.locator("summary").textContent()).trim();
  const items = await box.locator("li").evaluateAll((lis) => lis.map((li) => ({reason: li.getAttribute("data-reason"), id: li.getAttribute("data-id"), text: li.textContent.trim()})));
  return {present: true, summary, counts: parseHiddenSummary(summary), items};
}

// AC-V2-80: the summary N equals the list length, X + Y + Z + W = N, and each reason's count equals the items of that reason.
export function assertDisclosure(d, label) {
  assert.ok(d.present, `${label}: a disclosure`);
  assert.ok(d.counts, `${label}: the summary "${d.summary}" matches the template`);
  assert.equal(d.counts.total, d.items.length, `${label}: N equals the list length`);
  assert.equal(d.counts.no_data + d.counts.stale + d.counts.other_period + d.counts.other, d.counts.total, `${label}: the parts add up to N`);
  for (const k of ["no_data", "stale", "other_period", "other"]) assert.equal(d.items.filter((i) => i.reason === k).length, d.counts[k], `${label}: ${k}`);
}

// ---- requests --------------------------------------------------------------------------------------------------------------------------------------------------------
// Data requests of a page as manifest paths (and, per file, whether it was requested after the load event). Asserts every one is listed in manifest files[] with its content hash.
export function dataRequests(urls, manifest, {keepDuplicates = false} = {}) {
  const out = [];
  for (const u of urls) {
    const {pathname} = new URL(u);
    if (!pathname.startsWith("/_file/data/")) continue;
    const m = pathname.match(/^\/_file\/data\/(.+)\.([0-9a-f]{8,64})\.([a-z]+)$/);
    assert.ok(m, `unparseable data request ${pathname}`);
    const path = `${m[1]}.${m[3]}`;
    if (path !== "manifest.json") {
      const entry = manifest.files.find((f) => f.path === path);
      assert.ok(entry, `${path} is requested but not listed in manifest files[]`);
      assert.ok(entry.sha256.startsWith(m[2]), `${path}: file name hash ${m[2]} is not the manifest sha256`);
    }
    if (keepDuplicates || !out.includes(path)) out.push(path);
  }
  return out.sort();
}

// ---- route overrides (the served files on disk and the build are untouched) -----------------------------------------------------------------------------------------
// Answers meta/series.json with `mutate(series[])` applied (used to give one stored series another unit_code, so the stored-field block can be seen on any export).
export async function overrideSeriesMeta(context, mutate) {
  await context.route(/\/_file\/data\/meta\/series\.[0-9a-f]+\.json$/, async (route) => {
    const res = await route.fetch();
    const doc = await res.json();
    mutate(doc.series);
    await route.fulfill({response: res, json: doc});
  });
}
// Answers scorecard/<domain>.json with `mutate(scorecard)` applied.
export async function overrideScorecard(context, domainId, mutate) {
  await context.route(new RegExp(`/_file/data/scorecard/${domainId}\\.[0-9a-f]+\\.json$`), async (route) => {
    const res = await route.fetch();
    const doc = await res.json();
    mutate(doc);
    await route.fulfill({response: res, json: doc});
  });
}

// ---- C5 (the percentile heatmap) is the percentile layer: only with pc=1, in a closed secondary block (A1.7, V22) -------------------------------------------------------
// `/domain/<id>[#keys]` gains pc=1; any other path is returned unchanged.
export function c5Path(path) {
  if (!/^\/domain\/[^#/]+/.test(path)) return path;
  const [p, h = ""] = path.split("#");
  const keys = h.split("&").filter(Boolean);
  return keys.some((k) => /^pc=/.test(k)) ? path : `${p}#${[...keys, "pc=1"].join("&")}`;
}
// Opens the collapsed secondary block so its heatmap is visible to locators and screenshots.
export async function openC5(page) {
  await page.waitForSelector("#c5-secondary", {state: "attached", timeout: TIMEOUT});
  await page.evaluate(() => {
    document.getElementById("c5-secondary").open = true;
  });
}

// SVG facts, read in the browser: the computed fill, stroke and dash of every mark of a given Plot group.
export function marksOf(page, scope, aria) {
  return page.evaluate(([s, a]) => [...document.querySelectorAll(`${s} g[aria-label="${a}"] > *`)].map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {tag: el.localName, fill: cs.fill, stroke: cs.stroke, dash: cs.strokeDasharray, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, d: el.getAttribute("d")};
  }), [scope, aria]);
}
// The tick labels of an axis, in DOM order.
export const tickLabels = (page, scope, aria) => page.$$eval(`${scope} g[aria-label="${aria}"] text`, (ts) => ts.map((t) => t.textContent.trim()));
