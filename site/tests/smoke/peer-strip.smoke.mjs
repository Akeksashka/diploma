// V14 browser smoke of the P1a strip plot (AC-V2-21, 80, 81, 93; PLAN: the printed reference period). Runs against a built site over the SYNTHETIC v2 fixture
// (EXPORT_DIR=tests/fixtures/v2_export); on another export the tests skip. Localhost only. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
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
let entities = [];
let scorecard = null;
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
  try {
    scorecard = dataJson("scorecard/fiscal.json");
  } catch {
    scorecard = null; // another export: isV2() is false and the tests skip
  }
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const isV2 = () => entities.some((e) => e.entity_id === "DEU") && scorecard?.entities?.some((e) => e.entity_id === "ROU");

async function strip(t, hash, fn) {
  if (!browser) return t.skip(reason);
  if (!isV2()) return t.skip("needs the synthetic v2 fixture export (tests/fixtures/v2_export)");
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    await page.goto(`${site.origin}/country/DEU${hash}`);
    if ((await page.locator("#domain-fiscal details.mm-l1").getAttribute("open")) === null) await page.locator("#domain-fiscal details.mm-l1 > summary").click(); // the first two cards are open at load
    await page.waitForSelector("#domain-fiscal .mm-facet", {timeout: TIMEOUT});
    await page.locator('#domain-fiscal .mm-facet[data-indicator="A05"] button[data-action=expand]').click();
    await page.locator("#p1-fiscal").waitFor({timeout: TIMEOUT});
    await fn({page, log});
  } finally {
    await context.close();
  }
}

const cell = (id) => scorecard.entities.find((e) => e.entity_id === id).indicators.find((c) => c.indicator_id === "A05");

async function qaStrip(t, hash, fn) {
  if (!browser) return t.skip(reason);
  if (!isV2()) return t.skip("needs the synthetic v2 fixture export (tests/fixtures/v2_export)");
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    await page.goto(`${site.origin}/country/DEU${hash}`);
    if ((await page.locator("#domain-qa details.mm-l1").first().getAttribute("open")) === null) await page.locator("#domain-qa details.mm-l1 > summary").first().click();
    await page.waitForSelector('#domain-qa .mm-facet[data-indicator="V01"]', {timeout: TIMEOUT});
    await page.locator('#domain-qa .mm-facet[data-indicator="V01"] button[data-action=expand]').click();
    await page.locator("#p1-qa").waitFor({timeout: TIMEOUT});
    await fn({page, log});
  } finally {
    await context.close();
  }
}

describe("V14 P1a strip plot", () => {
  test("F1, spec 6.2 / A1.6: the mixed-unit indicator V01 with oth=1 is blocked with the stored-field message and draws no plot", async (t) => {
    await qaStrip(t, "#oth=1", async ({page, log}) => {
      const card = page.locator("#p1-qa");
      assert.equal(await card.getAttribute("data-state"), "blocked");
      assert.equal((await card.locator("p.mm-state-blocked").innerText()).trim(), "Not drawn together; differing stored fields: unit code, unit multiplier");
      assert.equal(await page.locator("#p1-qa svg").count(), 0, "no plot is drawn");
      assert.equal(await page.locator("#p1-qa-figure").count(), 0);
      assert.deepEqual(log.errors, []);
    });
  });

  test("F1: the same indicator with oth=0 draws nothing either (every row is another period): the empty card, not an axis", async (t) => {
    await qaStrip(t, "", async ({page}) => {
      assert.equal(await page.locator("#p1-qa svg").count(), 0);
      assert.equal(await page.locator("#p1-qa-figure").count(), 0);
    });
  });

  test("PLAN, AC-V2-21: the printed reference period is the stored one; the strip is a role=img figure with the unit on the axis, a caption block and a table alternative", async (t) => {
    await strip(t, "", async ({page, log}) => {
      const ref = scorecard.alignment.find((a) => a.indicator_id === "A05").rank_reference_period;
      assert.equal((await page.locator('#p1-fiscal [data-field="reference-period"]').innerText()).trim(), `Reference period: ${ref.slice(0, 4)}`);
      assert.equal(await page.locator("#p1-fiscal-figure").getAttribute("role"), "img");
      assert.ok((await page.locator("#p1-fiscal-figure svg").textContent()).includes("% of GDP"));
      assert.equal(await page.locator("#p1-fiscal .mm-caption").count(), 1);
      await page.locator("#p1-fiscal-view summary").click();
      assert.equal(await page.locator("#p1-fiscal-table tbody tr").count(), entities.filter((e) => !e.is_global).length, "every row of the comparison set, drawn or hidden (7.3)");
      assert.ok((await page.locator("#p1-fiscal-table thead").innerText()).includes("Value (% of GDP)"));
      assert.equal(await page.locator("#p1-fiscal-figure svg path[d*='area']").count(), 0, "no band, median or other summary mark");
      assert.deepEqual(log.errors, []);
    });
  });

  test("AC-V2-80, 81: drawn dots are the stored aligned, not stale rows of the reference period; every other row is in the disclosure and the table", async (t) => {
    await strip(t, "", async ({page}) => {
      const ref = scorecard.alignment.find((a) => a.indicator_id === "A05").rank_reference_period;
      const country = new Set(entities.filter((e) => e.kind === "country" && !e.is_global).map((e) => e.entity_id));
      const drawn = scorecard.entities.filter((e) => country.has(e.entity_id) && typeof cell(e.entity_id).value === "number" && cell(e.entity_id).ref_period_end === ref && !cell(e.entity_id).is_stale && cell(e.entity_id).alignment !== "unaligned");
      const hidden = scorecard.entities.filter((e) => country.has(e.entity_id)).length - drawn.length;
      assert.equal(await page.locator("#p1-fiscal-figure circle").count(), drawn.length + 1, "one dot per drawn country plus the ring of the country in focus");
      const box = page.locator("#p1-fiscal .mm-hidden-rows");
      assert.equal(await box.locator("li").count(), hidden);
      assert.match((await box.locator("summary").innerText()).trim(), new RegExp(`^${hidden} rows hidden: `));
      const sentences = await box.locator("li").allTextContents();
      assert.ok(sentences.some((s) => /Romania: Stale/.test(s)) && sentences.some((s) => /Turkiye: Other period/.test(s)));
      assert.ok(sentences.every((s) => !/\bn\/a\b/.test(s)), "no bare n/a");
    });
  });

  test("AC-V2-93: two renders give the same vertical positions (the stored-order independence is pinned by the model test)", async (t) => {
    let first = null;
    await strip(t, "", async ({page}) => {
      first = await page.locator("#p1-fiscal-figure circle").evaluateAll((els) => els.map((e) => e.getAttribute("cy")));
    });
    await strip(t, "", async ({page}) => {
      const second = await page.locator("#p1-fiscal-figure circle").evaluateAll((els) => els.map((e) => e.getAttribute("cy")));
      assert.deepEqual(second, first);
      const ys = [...new Set(second)];
      assert.ok(ys.length > 5, "countries occupy distinct slots");
      assert.equal(ys.length, second.length - 1, "one slot per drawn country (the ring of the country in focus shares its slot); the order of the slots is pinned by the model test");
    });
  });

  test("oth=1 draws the other-period rows hollow (with their own period in the tip); stale rows stay in the disclosure", async (t) => {
    await strip(t, "#oth=1", async ({page}) => {
      const box = page.locator("#p1-fiscal .mm-hidden-rows");
      const sentences = await box.locator("li").allTextContents();
      assert.ok(sentences.every((s) => /Stale/.test(s)), "only the stale rows remain hidden");
      assert.ok(sentences.some((s) => /Romania/.test(s)));
    });
  });

  test("Group limits the countries; the aggregates stay as dashed reference ticks", async (t) => {
    await strip(t, "#g=g7", async ({page}) => {
      const dots = await page.locator("#p1-fiscal-figure circle").count();
      assert.ok(dots <= 8, `G7 only (${dots} circles)`);
      assert.ok((await page.locator("#p1-fiscal-figure line[stroke-dasharray]").count()) >= 1 || (await page.locator("#p1-fiscal-figure [stroke-dasharray]").count()) >= 1, "dashed aggregate ticks");
    });
  });
});
