// L15 browser smoke: card-level states of PG-HOME (layout amendment 5, AC-DB-03, AC-DB-12, AC-RD-14, ADR-036). Route interception breaks or
// delays one scorecard file. Runs against a built site (npm run build) of the site_spike export or any export with two ranked domains.
// Localhost only; skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {DRAFT_EMPTY_CARD, DRAFT_HIDDEN_ROWS} from "../../src/lib/copy.js";
import {defaultDomainId} from "../../src/lib/home-dashboard.js";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;
const RAW_TEXT = /https?:|\/_file|\.json|\.parquet|Unable to load|TypeError|SyntaxError|Error:|\b404\b|undefined|NaN|\[object|schema_version/;

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
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
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const stored = () => {
  const doc = dataJson("meta/domains.json");
  const first = defaultDomainId(doc.domains, doc.default_domain ?? null);
  const other = doc.domains.find((d) => d.domain_id !== first && d.ranked !== false)?.domain_id;
  const country = dataJson("meta/entities.json").entities.find((e) => e.kind === "country")?.entity_id;
  assert.ok(other && country, "the export needs two ranked domains and one country");
  return {first, other, country};
};
const SC = (id) => new RegExp(`/_file/data/scorecard/${id}\\.[0-9a-f]+\\.json`);
const notFound = (route) => route.fulfill({status: 404, contentType: "text/plain", body: "missing"});
const expectedErrors = (log) => log.errors.filter((e) => !/Failed to load resource/.test(e));

// routes: [[regexp, handler]] installed on the page before navigation. ready: a selector that proves the states settled.
async function withHome(t, {hash = "", routes = [], ready, waitUntil = "load", width = 1280}, fn) {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    for (const [re, handler] of routes) await page.route(re, handler);
    await page.setViewportSize({width, height: 900});
    await page.goto(`${site.origin}/${hash}`, {waitUntil});
    if (ready) await page.waitForSelector(ready, {timeout: TIMEOUT});
    await fn({page, log});
    assert.deepEqual(expectedErrors(log), [], "page or console errors");
    assert.deepEqual(log.offOrigin, [], "off-origin requests");
  } finally {
    await context.close();
  }
}

// Every card slot (L12-L14 and the L17 indicators / L18 over-time cards) must leave the busy state once its data is loaded or failed.
const BUSY_CARDS = "[data-slot='overview'][aria-busy='true'], [data-slot='compare'][aria-busy='true'], [data-slot='facts'][aria-busy='true'], [data-slot='domain'][aria-busy='true'], [data-slot='indicators'][aria-busy='true'], [data-slot='overTime'][aria-busy='true'], .mm-loading[aria-busy='true']";
const alertsIn = (page, slot) => page.locator(`[data-slot="${slot}"] [role="alert"]`);
async function assertCardAlert(page, slot, id, kind) {
  const alerts = alertsIn(page, slot);
  assert.equal(await alerts.count(), 1, `${slot}: exactly one alert inside the card`);
  assert.equal(await alerts.first().getAttribute("id"), id);
  assert.equal(await alerts.first().getAttribute("data-kind"), kind);
  const text = (await alerts.first().innerText()).trim();
  assert.ok(text.includes("the scorecard of this domain"), `${slot}: names the region: ${text}`);
  assert.ok(!RAW_TEXT.test(text) && !/\d/.test(text), `${slot}: no URL, raw text or number: ${text}`);
  assert.equal(await page.locator(`[data-slot="${slot}"] table, [data-slot="${slot}"] svg`).count(), 0, `${slot}: no table or chart of the failed file`);
}

describe("L15 card states", () => {
  test("one failed scorecard: an alert inside each card that needs it, nowhere else; the other cards and the filter bar stay", async (t) => {
    const s = stored();
    await withHome(t, {hash: `#c=${s.country}`, routes: [[SC(s.first), notFound]], ready: "#rank-error"}, async ({page}) => {
      await page.waitForSelector("#heatmap-error");
      await page.waitForSelector("#mm-error-kpi");
      await assertCardAlert(page, "compare", "rank-error", "missing");
      await assertCardAlert(page, "domain", "heatmap-error", "missing");
      await assertCardAlert(page, "overview", "mm-error-kpi", "missing");
      await page.waitForSelector("#table-error"); // L17: the Indicators table card reads the same scorecard when one Country is in focus
      await assertCardAlert(page, "indicators", "table-error", "missing");
      assert.equal(await page.locator("#observablehq-main [role='alert']").count(), 4, "no alert outside the affected cards");
      assert.equal(await alertsIn(page, "facts").count(), 0, "the facts card has no alert");
      assert.ok((await page.locator("[data-slot='facts']").innerText()).trim().length > 0, "the facts card (stored indicator fields) is still shown");
      assert.ok((await page.locator("[data-slot='compare'] h3").innerText()).trim().length > 0, "the rank card keeps its title");
      assert.ok((await page.locator("#filterbar-slot button, #filterbar-slot select, #filterbar-slot input").count()) > 0, "the filter bar stays");
      assert.ok((await page.locator("#country-list a").count()) > 0, "the Browse lists stay");
      assert.equal(await page.locator(BUSY_CARDS).count(), 0, "nothing left busy");
      assert.equal(await page.locator("#observablehq-main .observablehq--error").count(), 0, "no Framework error cell");
    });
  });

  test("a failed scorecard does not poison the cache: another Domain loads, the failed Domain retries after the file is back", async (t) => {
    const s = stored();
    let failing = true;
    const handler = (route) => (failing ? notFound(route) : route.continue());
    await withHome(t, {routes: [[SC(s.first), handler]], ready: "#rank-error"}, async ({page, log}) => {
      const count = () => log.requests.filter((u) => SC(s.first).test(u)).length;
      assert.equal(count(), 1, "one request for the failed file so far");
      await page.evaluate((d) => globalThis.__mmFilterStore.set({d}), s.other);
      await page.waitForSelector("#home-heatmap", {timeout: TIMEOUT});
      assert.equal(await page.locator("#observablehq-main [role='alert']").count(), 0, "the other Domain shows no alert");
      assert.ok((await page.locator(".mm-rank-table tbody tr").count()) > 0, "the other Domain's rank card has rows");
      failing = false;
      await page.evaluate((d) => globalThis.__mmFilterStore.set({d}), s.first);
      await page.waitForSelector("#home-heatmap", {timeout: TIMEOUT});
      assert.equal(await page.locator("#observablehq-main [role='alert']").count(), 0, "the retry of the failed Domain succeeds");
      assert.equal(count(), 2, "the failed file was requested again (a failure is not cached)");
      assert.equal(await page.locator(BUSY_CARDS).count(), 0);
    });
  });

  test("a failure for the next Domain does not poison the Domain that is cached", async (t) => {
    const s = stored();
    await withHome(t, {routes: [[SC(s.other), notFound]], ready: "#home-heatmap"}, async ({page}) => {
      await page.evaluate((d) => globalThis.__mmFilterStore.set({d}), s.other);
      await page.waitForSelector("#rank-error", {timeout: TIMEOUT});
      await assertCardAlert(page, "compare", "rank-error", "missing");
      await assertCardAlert(page, "domain", "heatmap-error", "missing");
      await page.evaluate((d) => globalThis.__mmFilterStore.set({d}), s.first);
      await page.waitForSelector("#home-heatmap", {timeout: TIMEOUT});
      assert.equal(await page.locator("#observablehq-main [role='alert']").count(), 0, "back on the cached Domain: no alert left");
    });
  });

  test("a scorecard that is not JSON, or has the wrong shape, gives kind invalid inside the cards only", async (t) => {
    const s = stored();
    const bodies = [["not json", "<html>not json"], ["wrong shape", JSON.stringify({schema_version: "1.0", entities: 3})]];
    for (const [label, body] of bodies) {
      const route = (r) => r.fulfill({status: 200, contentType: "application/json", body});
      await withHome(t, {routes: [[SC(s.first), route]], ready: "#rank-error"}, async ({page}) => {
        await page.waitForSelector("#heatmap-error");
        await assertCardAlert(page, "compare", "rank-error", "invalid");
        await assertCardAlert(page, "domain", "heatmap-error", "invalid");
        assert.equal(await page.locator("#observablehq-main [role='alert']").count(), 2, label);
        assert.equal(await page.locator(BUSY_CARDS).count(), 0, label);
        assert.match(await alertsIn(page, "compare").first().innerText(), /format check/, label);
      });
    }
  });

  test("busy block: reserved height, role status, aria-busy while the scorecard is pending; nothing busy afterwards", async (t) => {
    const s = stored();
    let release;
    const gate = new Promise((ok) => (release = ok));
    const slow = async (route) => {
      await gate;
      await route.continue();
    };
    await withHome(t, {routes: [[SC(s.first), slow]], ready: "#rank-loading", waitUntil: "commit"}, async ({page}) => {
      await page.waitForSelector("#heatmap-loading");
      for (const id of ["rank-loading", "heatmap-loading"]) {
        const el = page.locator(`#${id}`);
        assert.equal(await el.getAttribute("role"), "status", id);
        assert.equal(await el.getAttribute("aria-busy"), "true", id);
        const box = await el.boundingBox();
        assert.ok(box && box.height >= 150, `${id} reserves height (got ${box?.height})`);
        assert.ok(!/\d/.test(await el.innerText()), `${id}: no number in the loading text`);
      }
      assert.equal(await page.locator("[data-slot='compare']").getAttribute("aria-busy"), "true");
      assert.equal(await page.locator("#observablehq-main [role='alert']").count(), 0, "loading is not an alert");
      release();
      await page.waitForSelector("#home-heatmap", {timeout: TIMEOUT});
      await page.waitForSelector(".mm-rank-table");
      assert.equal(await page.locator(BUSY_CARDS).count(), 0, "nothing left busy");
    });
  });

  test("empty cards: a filter combination with no rows shows the sentence under the kept title; the filter bar stays", async (t) => {
    const s = stored();
    await withHome(t, {hash: `#c=${s.country}&f=D`, ready: "#heatmap-empty"}, async ({page}) => {
      const heat = page.locator("[data-slot='domain']");
      assert.equal((await page.locator("#heatmap-empty").innerText()).trim(), DRAFT_EMPTY_CARD);
      assert.equal(await heat.locator("table").count(), 0, "no table in the empty heatmap card");
      assert.ok((await page.locator("#band-domain-heading").innerText()).trim().length > 0, "the Domain title stays");
      assert.equal(await page.locator("[data-slot='overview'] #kpi-empty").innerText(), DRAFT_EMPTY_CARD, "the KPI card shows the same sentence");
      assert.equal(await page.locator("#observablehq-main [role='alert']").count(), 0, "empty is not an error");
      assert.ok((await page.locator("#filterbar-slot button, #filterbar-slot select, #filterbar-slot input").count()) > 0, "the filter bar stays");
      assert.equal(await page.locator(BUSY_CARDS).count(), 0);
    });
  });

  test("empty rank card under Period: title kept, sentence, and the ADR-036 disclosure lists the rows that were hidden", async (t) => {
    await withHome(t, {ready: "#home-heatmap"}, async ({page}) => {
      await page.evaluate(() => globalThis.__mmFilterStore.set({from: 1900, to: 1900}));
      await page.waitForSelector("#rank-empty", {timeout: TIMEOUT});
      const card = page.locator("[data-slot='compare']");
      assert.equal((await page.locator("#rank-empty").innerText()).trim(), DRAFT_EMPTY_CARD);
      assert.ok((await card.locator("h3").innerText()).trim().length > 0, "the card keeps its title");
      assert.equal(await card.locator("table").count(), 0);
      const items = await card.locator(".mm-hidden-rows li").count();
      assert.ok(items > 0, "the hidden rows are listed");
      assert.equal(await card.locator(".mm-hidden-rows > summary").innerText(), DRAFT_HIDDEN_ROWS(items), "the sentence counts the listed rows");
      assert.equal(await card.locator("[role='status'] details.mm-hidden-rows").count(), 1);
      assert.equal(await page.locator("[data-slot='domain'] .mm-hidden-rows, [data-slot='overview'] .mm-hidden-rows").count(), 0, "Period hides no rows on the heatmap or the KPI card");
      assert.ok((await page.locator("[data-slot='domain'] table").count()) > 0, "the heatmap ignores Period");
      assert.equal(await page.locator("#observablehq-main [role='alert']").count(), 0);
    });
  });
});
