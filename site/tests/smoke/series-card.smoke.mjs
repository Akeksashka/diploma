// L18 browser smoke: the time-series card of the Over time band (layout amendment 4.10, 5; AC-DB-12, AC-DB-03, AC-RD-14, 30, 32).
// Runs against a built site with a series file in the manifest (site_spike export: M09, P01). Localhost only; skips otherwise.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {DRAFT_CHOOSE_COUNTRY_PLACEHOLDER, DRAFT_LOAD_HISTORY} from "../../src/lib/copy.js";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;
const SERIES_REQ = /\/_file\/data\/series\/[A-Za-z0-9_]+\.[0-9a-f]+\.parquet/;
const READER_REQ = /\.wasm(?:\?.*)?$/;
const CARD = '[data-slot="overTime"]';

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
let target = null; // {indicator, entities: [ids with a series of the indicator], name}

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
  const manifest = dataJson("manifest.json");
  const ids = manifest.files.map((f) => /^series\/([A-Za-z0-9_]+)\.parquet$/.exec(f.path)?.[1]).filter(Boolean);
  const ind = dataJson("meta/indicators.json").indicators.find((i) => ids.includes(i.indicator_id));
  if (!ind) {
    reason = "no indicator with a series file in this export";
    return;
  }
  const entities = dataJson("meta/entities.json").entities;
  const ents = [...new Set(dataJson("meta/series.json").series.filter((s) => s.indicator_id === ind.indicator_id).map((s) => s.entity_id))].filter((e) =>
    entities.some((x) => x.entity_id === e && x.is_global !== true)
  );
  if (ents.length === 0) {
    reason = "no entity with a series of the indicator";
    return;
  }
  target = {indicator: ind.indicator_id, name: ind.name, entities: ents};
});

after(async () => {
  await browser?.close();
  await site?.close();
});

async function withHome(t, hash, fn, {routes = []} = {}) {
  if (!browser || !target) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  for (const [re, handler] of routes) await context.route(re, handler);
  try {
    await page.setViewportSize({width: 1280, height: 900});
    await page.goto(`${site.origin}/${hash}`);
    await page.waitForSelector("#band-over-time", {timeout: TIMEOUT});
    await page.waitForSelector(`${CARD}[aria-busy="false"]`, {timeout: TIMEOUT});
    await page.waitForLoadState("networkidle");
    await fn({page, log});
  } finally {
    await context.close();
  }
}
const seriesReqs = (log) => log.requests.filter((u) => SERIES_REQ.test(u));

describe("L18 time-series card", () => {
  test("AC-DB-12, AC-DB-26: no Country selected -> the Load history button (small multiples), no KPI placeholder sentence, no series/* request", async (t) => {
    await withHome(t, `#i=${target?.indicator}`, async ({page, log}) => {
      assert.ok(!(await page.locator(CARD).textContent()).includes(DRAFT_CHOOSE_COUNTRY_PLACEHOLDER));
      assert.equal(await page.locator(`${CARD} #series-card-load`).count(), 1);
      assert.deepEqual(seriesReqs(log), []);
    });
  });

  test("AC-DB-12, AC-RD-14: zero series/* and no Parquet reader before the click; exactly one file after; chart, reader and table in the card", async (t) => {
    await withHome(t, `#i=${target?.indicator}&c=${(target?.entities ?? []).slice(0, 2).join(",")}`, async ({page, log}) => {
      await page.waitForTimeout(800);
      assert.deepEqual(seriesReqs(log), [], "no series file before the click");
      assert.deepEqual(log.requests.filter((u) => READER_REQ.test(u)), [], "the Parquet reader is not initialised before the click");
      const btn = page.locator(`${CARD} #series-card-load`);
      assert.equal(await btn.textContent(), DRAFT_LOAD_HISTORY);
      await btn.click();
      await page.waitForSelector(`${CARD} figure[role=img]`, {timeout: TIMEOUT});
      const reqs = seriesReqs(log);
      assert.equal(reqs.length, 1, `exactly one series file: ${reqs}`);
      assert.ok(new RegExp(`/series/${target.indicator}\\.[0-9a-f]+\\.parquet`).test(reqs[0]), reqs[0]);
      assert.equal(await page.locator(`${CARD} #series-card-reader`).count(), 1, "point reader");
      assert.equal(await page.locator(`${CARD} #series-card-view`).count(), 1, "table alternative");
      assert.ok((await page.locator(`${CARD} figure[role=img]`).getAttribute("aria-label")).length > 0);
      // A Period change redraws from the loaded rows: no further series request.
      await page.evaluate(() => globalThis.__mmFilterStore.set({from: 2000, to: 2005}));
      await page.waitForTimeout(300);
      assert.equal(seriesReqs(log).length, 1, "a filter change does not fetch again");
      assert.deepEqual(log.errors.filter((e) => !/Failed to load resource/.test(e)), [], "page or console errors");
      assert.deepEqual(log.offOrigin, [], "off-origin requests");
    });
  });

  test("states: a failed file shows one alert inside the card only; the card keeps a button to retry", async (t) => {
    await withHome(
      t,
      `#i=${target?.indicator}&c=${(target?.entities ?? [])[0]}`,
      async ({page, log}) => {
        const outside = () => page.locator(`[role=alert]:not(${CARD} *)`).count();
        const before = await outside();
        await page.locator(`${CARD} #series-card-load`).click();
        await page.waitForSelector(`${CARD} [role=alert]`, {timeout: TIMEOUT});
        assert.equal(await page.locator(`${CARD} [role=alert]`).count(), 1);
        assert.equal(await outside(), before, "no alert outside the card");
        assert.equal(await page.locator(`${CARD} #series-card-load`).count(), 1, "retry is offered");
        assert.ok(seriesReqs(log).length >= 1);
      },
      {routes: [[SERIES_REQ, (route) => route.abort()]]}
    );
  });

  test("AC-DB-03: Frequency with no stored series of that frequency leaves the empty-card sentence", async (t) => {
    await withHome(t, `#i=${target?.indicator}&c=${(target?.entities ?? [])[0]}&f=D`, async ({page}) => {
      await page.locator(`${CARD} #series-card-load`).click();
      await page.waitForSelector(`${CARD} #series-card-empty`, {timeout: TIMEOUT});
      assert.equal(await page.locator(`${CARD} figure`).count(), 0);
    });
  });
});

describe("L19 small multiples and L20 Bars toggle", () => {
  test("AC-DB-27: no Country -> after Load history one request and a faceted figure with reader and table; at most 12 facets; no count printed", async (t) => {
    await withHome(t, `#i=${target?.indicator}`, async ({page, log}) => {
      await page.locator(`${CARD} #series-card-load`).click();
      await page.waitForSelector(`${CARD} figure[role=img]`, {timeout: TIMEOUT});
      assert.equal(seriesReqs(log).length, 1);
      assert.equal(await page.locator(`${CARD} #series-card-reader`).count(), 1, "point reader");
      assert.equal(await page.locator(`${CARD} #series-card-view`).count(), 1, "table alternative");
      assert.equal(await page.locator(`${CARD} input[name="series-card-mode"]`).count(), 0, "no Lines / Bars toggle for facets");
      const facets = await page.locator(`${CARD} figure[role=img] [aria-label="fx-axis tick label"], ${CARD} figure[role=img] [aria-label="fy-axis tick label"]`).count();
      assert.ok(facets <= 12, `facets drawn: ${facets}`);
      const more = page.locator(`${CARD} #series-card-more`);
      if (await more.count()) {
        assert.equal((await more.textContent()).trim(), "Show more");
        await more.click();
        await page.waitForSelector(`${CARD} figure[role=img]`, {timeout: TIMEOUT});
        assert.equal(seriesReqs(log).length, 1, "Show more reads the loaded rows, no request");
      }
      assert.deepEqual(log.errors.filter((e) => !/Failed to load resource/.test(e)), [], "page or console errors");
    });
  });

  test("AC-DB-27: the point reader of the facet chart can be focused with the keyboard", async (t) => {
    await withHome(t, `#i=${target?.indicator}`, async ({page}) => {
      await page.locator(`${CARD} #series-card-load`).click();
      await page.waitForSelector(`${CARD} #series-card-reader`, {timeout: TIMEOUT});
      const focusable = page.locator(`${CARD} #series-card-reader select, ${CARD} #series-card-reader button, ${CARD} #series-card-reader [tabindex]`).first();
      await focusable.focus();
      assert.equal(await focusable.evaluate((el) => el === document.activeElement), true);
    });
  });

  test("AC-DB-28: the Lines / Bars group appears with exactly one Country; Bars draw one bar per stored period and the table keeps its rows; not in the address", async (t) => {
    await withHome(t, `#i=${target?.indicator}&c=${(target?.entities ?? [])[0]}`, async ({page}) => {
      await page.locator(`${CARD} #series-card-load`).click();
      await page.waitForSelector(`${CARD} figure[role=img]`, {timeout: TIMEOUT});
      assert.equal(await page.locator(`${CARD} input[name="series-card-mode"]`).count(), 2);
      await page.locator(`${CARD} #series-card-view summary`).click();
      await page.waitForSelector(`${CARD} #series-card-view-table tbody tr`, {timeout: TIMEOUT});
      const linesRows = await page.locator(`${CARD} #series-card-view-table tbody tr`).count();
      const hashBefore = await page.evaluate(() => location.hash);
      await page.locator(`${CARD} input[name="series-card-mode"][value="bars"]`).check();
      await page.waitForSelector(`${CARD} figure[role=img] [aria-label="bar"]`, {timeout: TIMEOUT});
      const bars = await page.locator(`${CARD} figure[role=img] [aria-label="bar"] rect`).count();
      await page.locator(`${CARD} #series-card-view summary`).click();
      const open = await page.locator(`${CARD} #series-card-view`).evaluate((d) => d.open);
      if (!open) await page.locator(`${CARD} #series-card-view summary`).click();
      await page.waitForSelector(`${CARD} #series-card-view-table tbody tr`, {timeout: TIMEOUT});
      const barRows = await page.locator(`${CARD} #series-card-view-table tbody tr`).count();
      assert.equal(barRows, linesRows, "same table rows in both views");
      assert.equal(bars, barRows, "one bar per stored period");
      assert.equal(await page.evaluate(() => location.hash), hashBefore, "chart type is not in the address");
    });
  });

  test("AC-DB-28: with two Countries the toggle is absent", async (t) => {
    if ((target?.entities ?? []).length < 2) return t.skip("fewer than two entities with a series of the indicator");
    await withHome(t, `#i=${target.indicator}&c=${target.entities.slice(0, 2).join(",")}`, async ({page}) => {
      await page.locator(`${CARD} #series-card-load`).click();
      await page.waitForSelector(`${CARD} figure[role=img]`, {timeout: TIMEOUT});
      assert.equal(await page.locator(`${CARD} input[name="series-card-mode"]`).count(), 0);
    });
  });
});
