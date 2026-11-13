// Redesign R8 browser smoke of PG-COUNTRY "About this value" and "Show history" (AC-RD-14, 42, 46, 51, 54 country part).
// Runs against a built site (npm run build). It needs a country page with a value row whose indicator has a series file in the
// manifest (the CI fixture export has M09 and P01; the SYNTHETIC sparse export has none for its T.. indicators, so there these
// tests skip). Failure case by route interception. Localhost only; off-origin requests abort.
// AC-RD-14, 51 and 53 are AMENDED for PG-COUNTRY by the user's decision of 2026-11-13 (plan V12, spec L1: the first two L1 cards are open): after the `load` event the page
// reads exactly the series files of the first two (open) L1 cards, each once, and nothing else until a user action (expanding a card, Show more, a history button).
// A spec/ADR erratum by the architect is still open (docs/ops/dashboard-v2-decisions.md).
// Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1 (CI).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {periodLabel} from "../../src/lib/period.js";
import {FACET_PAGE} from "../../src/lib/small-multiples.js";
import {walk} from "../../scripts/lib.mjs";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";
import {horizontalOverflow, setViewport} from "./ux-support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;
const READY = ".mm-country-domain table tbody tr";
const SERIES_REQ = /\/_file\/data\/series\/[A-Za-z0-9_]+\.[0-9a-f]+\.parquet/;
// Framework adds modulepreload hints for the two reader scripts to any page that names a .parquet FileAttachment (not avoidable
// from the page); the reader itself is initialised by the first parquet() call, which fetches the WebAssembly binary.
const READER_REQ = /\.wasm(?:\?.*)?$/;

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
let entities = [];
let manifest = null;
let target = null; // {entity, domain, indicator}
let domainList = [];
let seriesMeta = [];
let scorecards = {};

const dataJson = (rel) => {
  const stem = rel.replace(/\.json$/, "");
  const dir = join(DIST, "_file", "data", ...stem.split("/").slice(0, -1));
  const base = stem.split("/").at(-1);
  const f = walk(dir).find((p) => new RegExp(`/${base}\\.[0-9a-f]+\\.json$`).test(p));
  assert.ok(f, `no built data file for ${rel}`);
  return JSON.parse(readFileSync(f, "utf8"));
};

before(async () => {
  if (!distBuilt()) {
    if (REQUIRE_BROWSER) assert.fail(reason);
    return;
  }
  ({browser, reason} = await launchBrowser());
  if (!browser) {
    if (REQUIRE_BROWSER) assert.fail(reason);
    return;
  }
  site = await serve();
  entities = dataJson("meta/entities.json").entities;
  manifest = dataJson("manifest.json");
  const withFile = new Set(manifest.files.map((f) => /^series\/([A-Za-z0-9_]+)\.parquet$/.exec(f.path)?.[1]).filter(Boolean));
  const domains = dataJson("meta/domains.json").domains;
  domainList = domains;
  seriesMeta = dataJson("meta/series.json").series;
  for (const d of domains) scorecards[d.domain_id] = dataJson(`scorecard/${d.domain_id}.json`);
  // First country/domain/indicator whose stored scorecard cell has a value and whose indicator has a series file.
  outer: for (const e of entities.filter((x) => x.is_global !== true)) {
    for (const d of domains) {
      const row = dataJson(`scorecard/${d.domain_id}.json`).entities.find((x) => x.entity_id === e.entity_id);
      const cell = row?.indicators.find((c) => c.value !== null && c.published !== false && withFile.has(c.indicator_id));
      if (cell) {
        target = {entity: e.entity_id, name: e.name ?? e.entity_id, domain: d.domain_id, indicator: cell.indicator_id, cell};
        break outer;
      }
    }
  }
  if (!target) reason = "no country row with a value and a series file in this export";
});

after(async () => {
  await browser?.close();
  await site?.close();
});

// The series files the first two L1 cards of the country page read after `load`: per domain with a scorecard row for the entity (meta/domains.json order, as the page builds
// them), the indicators of the first FACET_PAGE panels (one per stored series of the pair) that have a series file in the manifest. Parquet paths, each once.
function expectedL1(entityId) {
  const listed = new Set(manifest.files.map((f) => f.path));
  const bands = domainList.filter((d) => scorecards[d.domain_id]?.entities?.some((e) => e.entity_id === entityId));
  const out = [];
  for (const d of bands.slice(0, 2)) {
    const panels = d.indicator_ids.flatMap((id) => seriesMeta.filter((s) => s.indicator_id === id && s.entity_id === entityId).map(() => id)).slice(0, FACET_PAGE);
    for (const id of panels) if (listed.has(`series/${id}.parquet`) && !out.includes(`series/${id}.parquet`)) out.push(`series/${id}.parquet`);
  }
  return out.sort();
}
const seriesPaths = (urls) => urls.filter((u) => SERIES_REQ.test(u)).map((u) => `series/${/\/series\/([A-Za-z0-9_]+)\./.exec(u)[1]}.parquet`).sort();

const clean = (log) => {
  assert.deepEqual(log.errors.filter((e) => !/Failed to load resource/.test(e)), [], "page or console errors");
  assert.deepEqual(log.offOrigin, [], "off-origin requests");
};

async function withTarget(t, fn, {width = null, routes = []} = {}) {
  if (!browser) return t.skip(reason);
  if (!target) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  for (const [re, handler] of routes) await context.route(re, handler);
  try {
    if (width) await setViewport(page, width);
    await page.goto(`${site.origin}/country/${target.entity}`);
    await page.waitForSelector(READY, {timeout: TIMEOUT});
    const key = `${target.domain}-${target.indicator}`;
    await fn({page, log, key, btn: page.locator(`button[data-history="${key}"]`), panel: page.locator(`#history-${key}`)});
  } finally {
    await context.close();
  }
}

describe("R8 PG-COUNTRY About this value and Show history", () => {
  test("AC-RD-14 (amended for PG-COUNTRY): after load only the series files of the first two open L1 cards are read, each once; the history button then reads at most the one more file of its row; the chart is this entity only, unit on the axis", async (t) => {
    await withTarget(t, async ({page, log, btn, panel}) => {
      await page.waitForLoadState("load");
      await page.waitForTimeout(1500);
      const expected = expectedL1(target.entity);
      assert.deepEqual(seriesPaths(log.requests), expected, "exactly the series files of the first two open L1 cards, each once, nothing else");
      assert.equal(log.requests.some((u) => READER_REQ.test(u)), expected.length > 0, "the Parquet reader (wasm) is initialised iff an open card reads a series file");
      assert.equal(await btn.getAttribute("aria-expanded"), "false");
      assert.equal(await panel.isHidden(), true);
      assert.equal(await panel.getAttribute("data-state"), "idle");
      const before = seriesPaths(log.requests).length;
      await btn.click();
      await page.waitForSelector(`#history-${target.domain}-${target.indicator}[data-state="loaded"]`, {timeout: TIMEOUT});
      const reqs = seriesPaths(log.requests);
      const own = `series/${target.indicator}.parquet`;
      assert.deepEqual([...new Set(reqs)].sort(), [...new Set([...expected, own])].sort(), "no series file beyond the open L1 cards and the row of the clicked button");
      assert.ok(reqs.length - before <= 1, `the click requests at most the one file of its row (${reqs.length - before} new)`);
      assert.equal(reqs.filter((p) => p === own).length, expected.includes(own) ? 1 + (reqs.length - before) : 1, "the row's own file");
      assert.equal(await btn.getAttribute("aria-expanded"), "true");
      const fig = panel.locator("figure[role=img]");
      assert.equal(await fig.count(), 1);
      const label = await fig.getAttribute("aria-label");
      assert.ok(label.includes(target.name), label);
      const unit = dataJson("meta/indicators.json").indicators.find((i) => i.indicator_id === target.indicator).unit_label;
      assert.ok(unit, "the fixture indicator has a unit");
      assert.ok(label.includes(`in ${unit}`), label);
      assert.ok((await fig.locator("svg").textContent()).includes(unit), "the unit is on the axis");
      const owners = await panel.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-entity")));
      assert.ok(owners.length > 0);
      assert.deepEqual([...new Set(owners)], [target.entity], "only the page's entity");
      const cells = await panel.locator("tbody td.mm-num").evaluateAll((tds) => tds.map((td) => td.textContent)); // the table sits in a closed <details>
      assert.ok(cells.length > 0);
      assert.ok(cells.every((c) => c.trim().endsWith(unit)), "every table value carries the unit");
      // Hiding and showing again does not fetch again.
      const afterClick = seriesPaths(log.requests).length;
      await btn.click();
      assert.equal(await panel.isHidden(), true);
      await btn.click();
      assert.equal(await panel.isVisible(), true);
      assert.equal(seriesPaths(log.requests).length, afterClick);
      clean(log);
    });
  });

  test("AC-RD-14 (amended): a user action reads exactly what it opens: a closed L1 card, once, and nothing before the action", async (t) => {
    await withTarget(t, async ({page, log}) => {
      await page.waitForTimeout(1500);
      const expected = expectedL1(target.entity);
      const closed = page.locator("details.mm-l1:not([open])");
      if ((await closed.count()) === 0) return t.skip("every L1 card is open on this export");
      const domainId = await closed.first().getAttribute("data-domain");
      const d = domainList.find((x) => x.domain_id === domainId);
      const listed = new Set(manifest.files.map((f) => f.path));
      const panels = d.indicator_ids.flatMap((id) => seriesMeta.filter((s) => s.indicator_id === id && s.entity_id === target.entity).map(() => id)).slice(0, FACET_PAGE);
      const more = [...new Set(panels)].map((id) => `series/${id}.parquet`).filter((p) => listed.has(p) && !expected.includes(p));
      assert.deepEqual(seriesPaths(log.requests), expected, "nothing more before the action");
      await closed.first().locator("summary").click();
      await page.waitForTimeout(1500);
      assert.deepEqual(seriesPaths(log.requests), [...expected, ...more].sort(), `opening the ${domainId} card reads its series files, once each`);
      clean(log);
    });
  });

  test("AC-RD-14: a failed fetch shows one inline error block and leaves the rest of the page intact", async (t) => {
    await withTarget(t, async ({page, log, btn, panel}) => {
      const rowsBefore = await page.locator("tr[data-indicator]").count();
      await page.waitForTimeout(1500); // the open L1 cards have tried (and failed) to read their series files
      await btn.click();
      await page.waitForSelector(`#history-${target.domain}-${target.indicator}[data-state="error"]`, {timeout: TIMEOUT});
      const alert = panel.locator("[role=alert]");
      assert.equal(await alert.count(), 1);
      const text = (await alert.innerText()).trim();
      assert.ok(text.includes("the history of this indicator") && text.includes("No history chart is shown for this indicator."), text);
      assert.doesNotMatch(text, /https?:|\/_file|\.parquet|Error|\b404\b|undefined|NaN|\d/);
      assert.equal(await panel.locator("svg, table").count(), 0, "no partial chart");
      assert.equal(await page.locator("tr[data-indicator]").count(), rowsBefore, "the table is intact");
      assert.equal(await page.locator(".mm-country-domain h2").count() > 0, true);
      await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0, null, {timeout: TIMEOUT});
      assert.equal(await page.locator('[aria-busy="true"]').count(), 0, "nothing left busy");
      assert.equal(await page.locator("#observablehq-main .observablehq--error").count(), 0, "no Framework error cell");
      clean(log);
    }, {routes: [[SERIES_REQ, (route) => route.fulfill({status: 404, contentType: "text/plain", body: "missing"})]]});
  });

  test("AC-RD-46: About this value opens by keyboard and shows the stored fields, not tooltip-only", async (t) => {
    await withTarget(t, async ({page, log}) => {
      const details = page.locator(`#about-${target.domain}-${target.indicator}`);
      assert.equal(await details.evaluate((d) => d.open), false);
      const summary = details.locator("summary");
      assert.equal(await summary.getAttribute("title"), null, "no title-only content");
      await summary.focus();
      await page.keyboard.press("Enter");
      assert.equal(await details.evaluate((d) => d.open), true, "Enter opens");
      await page.keyboard.press("Space");
      assert.equal(await details.evaluate((d) => d.open), false, "Space closes");
      await page.keyboard.press("Space");
      assert.equal(await details.evaluate((d) => d.open), true);
      const field = async (k) => (await details.locator(`[data-field="${k}"] dd`).allInnerTexts()).join("|").trim();
      const series = dataJson("meta/series.json").series.find((s) => s.indicator_id === target.indicator && s.entity_id === target.entity);
      const ind = dataJson("meta/indicators.json").indicators.find((i) => i.indicator_id === target.indicator);
      const c = target.cell;
      assert.equal(await field("indicator"), ind.name);
      assert.equal(await field("country"), target.name);
      const mult = typeof series.unit_mult === "number" && series.unit_mult !== 0 ? `; values in ${series.unit_code} x 10^${series.unit_mult}` : "";
      assert.equal(await field("unit"), `${series.unit_code}${mult}`, "series-level unit (spec 5.2), not the indicator unit_label");
      assert.equal(await field("seriesId"), String(c.series_id ?? series.series_id));
      assert.equal(await field("source"), series.source_name);
      assert.equal(await field("frequency"), series.frequency);
      assert.equal(await field("seasonal"), series.seasonal_adjustment);
      for (const [key, stored] of [["attribution", series.licence_attribution], ["priceBasis", series.price_basis]]) {
        if (stored) assert.equal(await field(key), String(stored), key);
        else assert.equal(await details.locator(`[data-field="${key}"]`).count(), 0, `${key} is absent in the export, so not shown`);
      }
      const refShown = await details.locator('[data-field="refPeriod"]').count();
      if (c.ref_period_end) {
        assert.equal(refShown, 1, "reference period");
        assert.equal(await field("refPeriod"), periodLabel(c.ref_period_end, series.frequency) ?? c.ref_period_end);
      } else assert.equal(refShown, 0, "no ref_period_end stored, none shown");
      const flagsShown = await details.locator('[data-field="flags"]').count();
      const expectsFlags = c.alignment === "lagging" || c.alignment === "unaligned" || c.alignment === "ahead" || c.value_kind === "estimate" || c.is_stale === true || c.inherited === true || (typeof c.ref_offset_days === "number" && c.ref_offset_days !== 0);
      if (expectsFlags) assert.equal(flagsShown, 1, "flags stored, so shown");
      if (series.reestimating === true) assert.equal(await details.locator('[data-field="reestimating"]').count(), 1);
      if (c.known_at) assert.equal(await field("knownAt"), c.known_at);
      if (c.source_release_at) assert.equal(await field("sourceRelease"), c.source_release_at);
      if (typeof c.age_days === "number") assert.equal(await field("age"), String(c.age_days));
      if (typeof c.stale_limit_days === "number") assert.equal(await field("staleLimit"), String(c.stale_limit_days));
      if (c.transform_id) assert.equal(await field("transform"), c.transform_id);
      assert.equal(await details.locator("dd:visible").count() > 5, true, "the fields are visible text");
      clean(log);
    });
  });

  test("AC-RD-51 (amended): only same-origin files named in manifest files[] are fetched; the series files are those of the first two open L1 cards, plus at most the one of a clicked history button", async (t) => {
    await withTarget(t, async ({page, log, btn, panel}) => {
      await page.waitForTimeout(1500);
      await btn.click();
      await page.waitForSelector(`#history-${target.domain}-${target.indicator}[data-state="loaded"]`, {timeout: TIMEOUT});
      // Spec section 3 (PG-COUNTRY reads): the five meta files, every scorecard except global, the manifest itself, and the series files of the open L1 cards and of a clicked row.
      const domainIds = dataJson("meta/domains.json").domains.map((d) => d.domain_id).filter((d) => d !== "global");
      const l1 = expectedL1(target.entity);
      const allowed = new Set(["manifest.json", "meta/entities.json", "meta/groups.json", "meta/domains.json", "meta/indicators.json", "meta/series.json", ...domainIds.map((d) => `scorecard/${d}.json`), ...l1, `series/${target.indicator}.parquet`]);
      const named = new Set(manifest.files.map((f) => f.path).concat("manifest.json")); // and each must still be a file the manifest names
      const data = log.requests.filter((u) => /\/_file\/data\//.test(u)).map((u) => new URL(u).pathname.replace(/^.*\/_file\/data\//, "").replace(/\.[0-9a-f]{8,}(\.[a-z]+)$/, "$1"));
      assert.ok(data.length > 0);
      for (const p of data) {
        assert.ok(allowed.has(p), `${p} is not read by the country page (spec section 3)`);
        assert.ok(named.has(p), `${p} is not in manifest files[]`);
      }
      assert.equal(data.includes("scorecard/global.json"), false, "scorecard/global.json is not requested");
      assert.deepEqual([...new Set(data.filter((p) => p.startsWith("series/")))].sort(), [...new Set([...l1, `series/${target.indicator}.parquet`])].sort());
      assert.equal((await panel.innerHTML()).includes("http"), false, "no URL in the history markup");
      clean(log);
    });
  });

  test("AC-RD-54: the buttons are keyboard operable and at 320 px nothing overflows the page with About and history open", async (t) => {
    await withTarget(t, async ({page, log, btn}) => {
      await btn.focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector(`#history-${target.domain}-${target.indicator}[data-state="loaded"]`, {timeout: TIMEOUT});
      await page.locator(`#about-${target.domain}-${target.indicator} summary`).click();
      const o = await horizontalOverflow(page);
      assert.deepEqual(o.offenders, [], `page overflow ${o.scrollW} > ${o.vw}`);
      clean(log);
    }, {width: 320});
  });
});
