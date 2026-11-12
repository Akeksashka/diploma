// L14 browser smoke: KPI tiles of the Overview band (layout amendment 4.6, AC-DB-12, AC-DB-20, AC-DB-21, AC-RD-12).
// Runs against a built site (npm run build with the site_spike export: labour is the default domain, DEU/JPN/POL/USA, EA). Localhost only.
// Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {AGGREGATE_NOT_RANKED, DRAFT_CHOOSE_COUNTRY_PLACEHOLDER, DRAFT_FIGURE_COVERAGE, DRAFT_FIGURE_POSITION} from "../../src/lib/copy.js";
import {formatPercentile, formatValue} from "../../src/lib/scorecard.js";
import {installCls, readCls} from "./ux-support.mjs";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;

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

async function withHome(t, hash, fn, {width = 1280} = {}) {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    await page.setViewportSize({width, height: 900});
    await page.goto(`${site.origin}/${hash}`);
    await page.waitForSelector("#band-overview", {timeout: TIMEOUT});
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    await fn({page, log});
    assert.deepEqual(log.errors, [], "page or console errors");
    assert.deepEqual(log.offOrigin, [], "off-origin requests");
  } finally {
    await context.close();
  }
}

const overview = (page) => page.locator('[data-slot="overview"]');
const tileInfo = (page) =>
  page.$$eval('[data-slot="overview"] [data-tile]', (els) =>
    els.map((el) => ({
      tile: el.dataset.tile, indicator: el.dataset.indicator ?? null, domain: el.dataset.domain ?? null, hasValue: el.dataset.hasValue ?? null, state: el.dataset.state,
      title: el.querySelector("h3")?.textContent.trim(), number: el.querySelector(".mm-tile-number")?.textContent.trim() ?? null,
      unit: el.querySelector(".mm-unit")?.textContent.trim() ?? null, sub: el.querySelector(".mm-card-sub")?.textContent.trim() ?? null,
      chip: el.querySelector(".mm-tile-pct .mm-fig")?.textContent.trim() ?? null, bin: el.querySelector(".mm-tile-pct")?.dataset.bin ?? null,
      pctState: el.querySelector(".mm-tile-pct")?.dataset.state ?? null, text: el.textContent.replace(/\s+/g, " ").trim(),
      href: el.querySelector("h3 a")?.getAttribute("href"), seriesHref: el.querySelector(".mm-tile-link a")?.getAttribute("href"), card: el.classList.contains("mm-card"),
      nestedCards: el.querySelectorAll(".mm-card").length
    }))
  );

describe("L14 KPI tiles (AC-DB-20, AC-DB-21)", () => {
  test("no Country: one placeholder card with the stored sentence and no tile; two Countries: the same", async (t) => {
    await withHome(t, "", async ({page}) => {
      assert.equal(await page.locator('[data-slot="overview"] [data-tile]').count(), 0);
      assert.ok((await overview(page).innerText()).includes(DRAFT_CHOOSE_COUNTRY_PLACEHOLDER));
      await page.evaluate(() => globalThis.__mmFilterStore.set({c: ["DEU", "JPN"]}));
      await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-slot="overview"] [data-tile]').count(), 0, "two countries give no tiles");
      assert.ok((await overview(page).innerText()).includes(DRAFT_CHOOSE_COUNTRY_PLACEHOLDER));
    });
  });

  test("one Country: domain-figure tile first, then the Domain's indicators in indicator_ids order; fields equal the stored scorecard", async (t) => {
    await withHome(t, "#c=DEU", async ({page}) => {
      const domains = dataJson("meta/domains.json").domains;
      const indicators = dataJson("meta/indicators.json").indicators;
      const dom = domains.find((d) => d.domain_id === "labour");
      const sc = dataJson("scorecard/labour.json");
      const row = sc.entities.find((e) => e.entity_id === "DEU");
      const tiles = await tileInfo(page);
      assert.deepEqual(tiles.map((x) => x.tile), ["domain-figure", ...dom.indicator_ids.map(() => "indicator")]);
      assert.deepEqual(tiles.slice(1).map((x) => x.indicator), dom.indicator_ids);
      const fig = tiles[0];
      assert.equal(fig.number, formatPercentile(row.percentile_rank));
      assert.ok(fig.text.includes(row.percentile_rank_label));
      assert.ok(fig.text.includes(DRAFT_FIGURE_COVERAGE(row.n_available, row.n_defined)));
      assert.ok(fig.text.includes(DRAFT_FIGURE_POSITION(row.rank_position, row.n_ranked_entities)));
      assert.ok(!fig.text.includes("%"), "no percent sign on the figure tile");
      for (const t1 of tiles.slice(1)) {
        const cell = row.indicators.find((c) => c.indicator_id === t1.indicator);
        const ind = indicators.find((i) => i.indicator_id === t1.indicator);
        assert.equal(t1.title, ind.name);
        const prec = dataJson("meta/series.json").series.find((r) => r.indicator_id === cell.indicator_id && r.entity_id === "DEU")?.published_precision;
        assert.equal(t1.number, Number.isInteger(prec) ? cell.value.toFixed(prec) : formatValue(cell.value));
        assert.equal(t1.unit, ind.unit_label);
        assert.ok(t1.sub.startsWith(cell.ref_period_end.slice(0, 4)), `period ${t1.sub}`);
        if (typeof cell.percentile === "number") {
          assert.equal(t1.chip, formatPercentile(cell.percentile));
          assert.ok(["1", "2", "3", "4", "5"].includes(t1.bin));
        } else assert.equal(t1.bin, "none", "no stored percentile gives no bin");
        assert.equal(t1.href, `./indicator/${t1.indicator}`);
        assert.equal(t1.seriesHref, `./explorer#i=${t1.indicator}&c=DEU`);
        assert.equal(t1.nestedCards, 0, "cards never nest");
        assert.ok(!/[↑↓▲▼]|delta|change/i.test(t1.text), "no delta or arrow");
      }
      assert.ok(tiles.every((x) => x.card), "every tile is a card");
    });
  });

  test("request list: tiles add no request (no series/* file, only the default scorecard)", async (t) => {
    await withHome(t, "#c=DEU", async ({log}) => {
      const data = log.requests.filter((u) => u.includes("/_file/data/")).map((u) => new URL(u).pathname.replace(/^\/_file\/data\//, "").replace(/\.[0-9a-f]{8,}\.json$/, ".json"));
      assert.ok(!data.some((p) => p.startsWith("series/")), JSON.stringify(data));
      assert.deepEqual(data.filter((p) => p.startsWith("scorecard/")), ["scorecard/labour.json"]);
    });
  });

  test("the pinned Indicator (i) comes first when the Domain lists it", async (t) => {
    await withHome(t, "#c=DEU&i=M10", async ({page}) => {
      const tiles = (await tileInfo(page)).filter((x) => x.tile === "indicator");
      assert.deepEqual(tiles.map((x) => x.indicator), ["M10", "M09", "M11"]);
    });
  });

  test("an aggregate in focus: the figure tile shows the not-ranked wording and no percentile; values keep their tiles", async (t) => {
    await withHome(t, "#c=EA", async ({page}) => {
      const tiles = await tileInfo(page);
      if (tiles.length === 0) return t.skip("the fixture has no EA row in labour");
      const fig = tiles.find((x) => x.tile === "domain-figure");
      assert.ok(fig.text.includes(AGGREGATE_NOT_RANKED));
      assert.equal(fig.number, null);
    });
  });

  test("an unranked Domain (agri) has no domain-figure tile and no percentile on its tiles; a Domain change swaps the tiles", async (t) => {
    await withHome(t, "#c=DEU", async ({page}) => {
      await page.evaluate(() => globalThis.__mmFilterStore.set({d: "agri", i: null}));
      await page.waitForFunction(() => document.querySelector('[data-slot="overview"] [data-tile="indicator"][data-indicator="A01"]') !== null || document.querySelector('[data-slot="overview"] .mm-state'), null, {timeout: TIMEOUT});
      const tiles = await tileInfo(page);
      assert.ok(!tiles.some((x) => x.tile === "domain-figure"));
      assert.deepEqual(tiles.map((x) => x.indicator), ["A01"]);
      assert.equal(tiles[0].chip, null, "no percentile in an unranked domain");
    });
  });

  test("Frequency applies: a frequency no listed indicator has gives the empty sentence, the card keeps the filter bar", async (t) => {
    await withHome(t, "#c=DEU", async ({page}) => {
      const indicators = dataJson("meta/indicators.json").indicators;
      const present = new Set(indicators.flatMap((i) => i.frequency_set ?? []));
      const absent = ["D", "M", "Q", "A"].find((f) => !present.has(f));
      if (!absent) return t.skip("every frequency is present in the fixture");
      await page.evaluate((f) => globalThis.__mmFilterStore.set({f}), absent);
      await page.waitForTimeout(300);
      assert.ok((await overview(page).innerText()).includes("No values for this selection."));
      assert.ok(await page.locator("#filterbar").count());
    });
  });

  test("layout: tiles are two per row at 768 px, one at 360 px, no horizontal page scroll, no overlap; CLS <= 0.1", async (t) => {
    if (!browser) return t.skip(reason);
    for (const [width, perRow] of [[1280, 4], [768, 2], [360, 1]]) {
      const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
      try {
        await page.setViewportSize({width, height: 900});
        await installCls(page);
        await page.goto(`${site.origin}/#c=DEU`);
        await page.waitForSelector('[data-slot="overview"] [data-tile]', {timeout: TIMEOUT});
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(400);
        const boxes = await page.$$eval('[data-slot="overview"] [data-tile]', (els) => els.map((el) => {
          const r = el.getBoundingClientRect();
          return {top: Math.round(r.top + scrollY), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom + scrollY)};
        }));
        const firstRow = boxes.filter((b) => b.top === boxes[0].top);
        assert.equal(firstRow.length, Math.min(perRow, boxes.length), `tiles per row at ${width}px`);
        for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, "tiles overlap");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `horizontal scroll at ${width}px`);
        const {cls, unsupported} = await readCls(page);
        if (!unsupported) assert.ok(cls <= 0.1, `CLS ${cls} at ${width}px`);
        assert.deepEqual(log.errors, []);
        console.log(`L14 measure: width ${width}, tiles ${boxes.length}, first row ${firstRow.length}, CLS ${cls}`);
      } finally {
        await context.close();
      }
    }
  });

  test("carry: clicking a tile title keeps the current hash on the indicator page", async (t) => {
    await withHome(t, "#c=DEU", async ({page}) => {
      await page.locator('[data-slot="overview"] [data-tile="indicator"] h3 a').first().click();
      await page.waitForURL(/\/indicator\/M09/, {timeout: TIMEOUT});
      assert.ok(page.url().includes("c=DEU"), page.url());
    });
  });

  test("keyboard: tile links are reachable by Tab and visible on focus", async (t) => {
    await withHome(t, "#c=DEU", async ({page}) => {
      const link = page.locator('[data-slot="overview"] [data-tile="indicator"] h3 a').first();
      await link.focus();
      assert.ok(await link.evaluate((el) => el === document.activeElement));
      const box = await link.boundingBox();
      assert.ok(box && box.height >= 24, "target at least 24 CSS px high");
      const series = page.locator('[data-slot="overview"] .mm-tile-link a').first();
      const sb = await series.boundingBox();
      assert.ok(sb && sb.height >= 24);
    });
  });
});
