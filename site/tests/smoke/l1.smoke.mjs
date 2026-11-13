// V12, V13 browser smoke of the COUNTRY page small multiples (L1) and the expanded panel (L2 with P1a): AC-V2-14, 15, 16, 17, 18, 19 (absent control), 20, 72, 73, 75, 82, 86, 18/21 table alternatives.
// Runs against a built site over the SYNTHETIC v2 fixture (EXPORT_DIR=tests/fixtures/v2_export: 42 countries, series files as JSON); on another export the tests skip. Localhost only; off-origin requests abort.
// Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 30000;

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
let indicators = [];
let entities = [];
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
  indicators = dataJson("meta/indicators.json").indicators;
  entities = dataJson("meta/entities.json").entities;
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const isV2 = () => indicators.some((i) => i.indicator_id === "V06") && entities.some((e) => e.entity_id === "DEU");
const clean = (log) => {
  assert.deepEqual(log.errors, [], "page or console errors");
  assert.deepEqual(log.offOrigin, [], "off-origin requests");
  assert.deepEqual(log.failed, [], "failed requests");
};

async function withCountry(t, id, fn, hash = "") {
  if (!browser) return t.skip(reason);
  if (!isV2()) return t.skip("needs the synthetic v2 fixture export (tests/fixtures/v2_export)");
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    await page.goto(`${site.origin}/country/${id}${hash}`);
    await page.waitForSelector(".mm-country-domain table tbody tr", {timeout: TIMEOUT});
    await fn({page, log});
  } finally {
    await context.close();
  }
}

const panels = (page, domainId) => page.locator(`#domain-${domainId} .mm-facet`);
// The first two L1 cards are open at load; any other card is opened by its summary (its series files are read then, not before).
const openCard = async (page, domainId) => {
  if ((await page.locator(`#domain-${domainId} details.mm-l1`).getAttribute("open")) === null) await page.locator(`#domain-${domainId} details.mm-l1 > summary`).click();
};
const settled = (page, domainId, n) => page.waitForFunction(([d, k]) => document.querySelectorAll(`#domain-${d} .mm-facet`).length >= k && !document.querySelector(`#l1-${d}-loading`), [domainId, n], {timeout: TIMEOUT});

describe("V12 L1 small multiples of the country page", () => {
  test("AC-V2-14, 15, 72: one panel per indicator with a stored series, each its own Plot with its own unit on the y axis and a caption block", async (t) => {
    await withCountry(t, "DEU", async ({page, log}) => {
      await settled(page, "labour", 3);
      const ids = await panels(page, "labour").evaluateAll((els) => els.map((e) => e.getAttribute("data-indicator")));
      assert.deepEqual(ids, ["M09", "M10", "M11"], "the stored indicator order");
      for (const id of ids) {
        const unit = indicators.find((i) => i.indicator_id === id).unit_label;
        const facet = page.locator(`#domain-labour .mm-facet[data-indicator="${id}"]`);
        assert.equal(await facet.locator("figure[role=img] svg").count(), 1, `${id}: its own Plot`);
        assert.ok((await facet.locator("figure svg").textContent()).includes(unit), `${id}: the y axis title carries the unit ${unit}`);
        assert.ok((await facet.locator('.mm-caption [data-field="unit"] dd').innerText()).includes(unit));
        for (const key of ["frequency", "seasonal", "source", "period", "vintage"]) assert.equal(await facet.locator(`.mm-caption [data-field="${key}"]`).count(), 1, `${id}: ${key}`);
      }
      assert.equal(await page.locator("#domain-labour details.mm-l1 > summary").innerText(), "Labour: time series");
      clean(log);
    });
  });

  test("AC-V2-18: the table alternative lists the plotted points of the panel (same rows)", async (t) => {
    await withCountry(t, "DEU", async ({page}) => {
      await settled(page, "labour", 3);
      const stored = dataJson("series/M09.json").rows.filter((r) => r[0] === "DEU" && r[5] !== null).length;
      const facet = page.locator('#domain-labour .mm-facet[data-indicator="M09"]');
      await facet.locator("details.mm-view-table summary").click();
      assert.equal(await facet.locator("details.mm-view-table tbody tr").count(), stored);
      assert.ok((await facet.locator("details.mm-view-table thead").innerText()).includes("% of labour force"), "the unit is in the value header");
    });
  });

  test("AC-V2-86, 82: a stale series is drawn (all points), with a square last-point marker and the word stale beside the title and in the tip", async (t) => {
    await withCountry(t, "FRA", async ({page}) => {
      await settled(page, "labour", 3);
      const facet = page.locator('#domain-labour .mm-facet[data-indicator="M09"]');
      assert.equal(await facet.getAttribute("data-stale"), "true");
      assert.match(await facet.locator(".mm-stale").innerText(), /^stale\s+2025-12$/i);
      assert.equal(await facet.locator("figure svg path").evaluateAll((els) => els.filter((e) => /^M-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?h-?\d+(?:\.\d+)?v-?\d+(?:\.\d+)?h-?\d+(?:\.\d+)?z$/i.test(e.getAttribute("d") ?? "")).length), 1, "one square symbol");
      assert.equal(await page.locator('#domain-labour .mm-facet[data-indicator="M10"]').getAttribute("data-stale"), "false");
      assert.equal(await page.locator('#domain-labour .mm-facet[data-stale="true"] .mm-stale').count(), 1);
      assert.equal(await page.locator("#domain-labour .mm-l1 .mm-hidden-rows").count(), 0, "a time-series card never hides a stale series (nothing else is hidden for FRA)");
    });
  });

  test("AC-V2-17, 80, 89: a panel with no stored value is in ONE disclosure of the card (ITA M10 has only missing rows)", async (t) => {
    await withCountry(t, "ITA", async ({page}) => {
      await settled(page, "labour", 2);
      const box = page.locator("#domain-labour .mm-l1 .mm-hidden-rows");
      assert.equal(await box.count(), 1);
      const summary = (await box.locator("summary").innerText()).trim();
      const n = await box.locator("li").count();
      assert.ok(n > 0);
      assert.match(summary, new RegExp(`^${n} rows? hidden: ${n} no data$`));
      assert.ok((await box.locator("li").first().textContent()).includes("Employment rate (synthetic): No data"));
      assert.equal(await page.locator('#domain-labour .mm-facet[data-indicator="M10"]').count(), 0, "not drawn");
    });
  });

  test("AC-V2-75: the Frequency control keeps one stored frequency: monthly V06 only", async (t) => {
    await withCountry(t, "DEU", async ({page}) => {
      await openCard(page, "qa");
      await settled(page, "qa", 7);
      const before = await page.locator('#domain-qa .mm-facet[data-indicator="V06"]').count();
      assert.equal(before, 2, "DEU V06 has a monthly and a quarterly series: one panel each");
      await page.selectOption("#filter-frequency", "M");
      await page.waitForFunction(() => document.querySelectorAll('#domain-qa .mm-facet[data-indicator="V06"]').length === 1, null, {timeout: TIMEOUT});
      assert.match(await page.locator('#domain-qa .mm-facet[data-indicator="V06"] .mm-caption [data-field="frequency"] dd').innerText(), /Monthly/);
    });
  });
});

describe("V13 L2 expanded panel", () => {
  test("AC-V2-19, 20, 73: Expand opens the long line with its caption, table and revisions link; no rebase control and no projection control, also for an index series", async (t) => {
    await withCountry(t, "DEU", async ({page, log}) => {
      await settled(page, "prices", 1);
      await page.locator('#domain-prices .mm-facet[data-indicator="P01"] button[data-action=expand]').click();
      const l2 = page.locator("#l2-prices");
      await l2.waitFor({timeout: TIMEOUT});
      assert.equal(await l2.locator("figure[role=img]").count(), 1);
      assert.equal(await l2.locator('a[data-link="revisions"]').getAttribute("href"), "../revisions");
      assert.equal(await page.locator('#domain-prices .mm-facet[data-indicator="P01"] button[data-action=expand]').getAttribute("aria-expanded"), "true");
      // P01 is an index series with a stored base_period and unit_label "index": still no rebase (A1.5), no projection
      assert.equal(await page.locator("#domain-prices input[type=checkbox][id$='-rebase']").count(), 0);
      assert.doesNotMatch(await page.locator("#domain-prices").innerText(), /rebase|rebased|projection/i);
      assert.equal(await page.locator("#domain-prices [data-action=proj]").count(), 0);
      await page.locator('#domain-prices .mm-facet[data-indicator="P01"] button[data-action=expand]').click();
      assert.equal(await page.locator("#l2-prices").count(), 0, "a second activation collapses it");
      clean(log);
    });
  });

  test("V13: the expanded panel adds the P1a strip of the same indicator (V14)", async (t) => {
    await withCountry(t, "DEU", async ({page}) => {
      await openCard(page, "fiscal");
      await settled(page, "fiscal", 2);
      await page.locator('#domain-fiscal .mm-facet[data-indicator="A05"] button[data-action=expand]').click();
      await page.locator("#p1-fiscal").waitFor({timeout: TIMEOUT});
      assert.equal(await page.locator("#l2-fiscal").count(), 1);
    });
  });
});
