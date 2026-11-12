// L12 browser smoke: the ranked comparison card and the facts card of the Compare band (layout amendment 4.1, 4.7, 5; AC-DB-22, AC-DB-23, AC-DB-36,
// AC-DB-03 card part, AC-RD-22, 45, 54). Runs against a built site (npm run build) of ANY fixture export: expectations are read from the built
// stored files, so it runs on the 8-entity site_spike export and on the 44-entity sparse export. Localhost only; skips without a browser unless
// MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {DRAFT_GROUP_REFERENCE_ROWS, DRAFT_HIDDEN_ROWS} from "../../src/lib/copy.js";
import {defaultDomainId} from "../../src/lib/home-dashboard.js";
import {formatPercentile, formatValue} from "../../src/lib/scorecard.js";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";
import {ARTIFACT_DIR} from "./ux-support.mjs";
import {mkdirSync} from "node:fs";

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

const stored = () => {
  const entities = dataJson("meta/entities.json").entities;
  const indicators = dataJson("meta/indicators.json").indicators;
  const domainsDoc = dataJson("meta/domains.json");
  const domainId = defaultDomainId(domainsDoc.domains, domainsDoc.default_domain ?? null);
  const domain = domainsDoc.domains.find((d) => d.domain_id === domainId);
  const indicator = indicators.find((i) => i.indicator_id === domain.indicator_ids[0]);
  const scorecard = dataJson(`scorecard/${domainId}.json`);
  const cell = (entityId) => (scorecard.entities.find((e) => e.entity_id === entityId)?.indicators ?? []).find((c) => c.indicator_id === indicator.indicator_id) ?? null;
  const inSet = entities.filter((e) => !e.is_global && (e.kind === "country" || e.kind === "aggregate"));
  return {entities, indicators, domainsDoc, domain, indicator, scorecard, cell, inSet};
};

async function withHome(t, fn, {hash = "", width = 1280, route = null} = {}) {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    if (route) await route(page);
    await page.setViewportSize({width, height: 900});
    await page.goto(`${site.origin}/${hash}`);
    await page.waitForSelector("#rank-sort", {timeout: TIMEOUT});
    await page.waitForSelector(".mm-rank-table", {timeout: TIMEOUT});
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    await fn({page, log});
    assert.deepEqual(log.errors, [], "page or console errors");
    assert.deepEqual(log.offOrigin, [], "off-origin requests");
    assert.deepEqual(log.failed, [], "failed requests");
  } finally {
    await context.close();
  }
}

const rowIds = (page, group) => page.$$eval(`.mm-rank-table tbody[data-group="${group}"] > tr[data-entity]`, (rs) => rs.map((r) => r.getAttribute("data-entity")));

describe("L12 ranked comparison card", () => {
  test("one row per entity of the comparison set, none dropped; aggregates only under Reference rows; no Total or average anywhere", async (t) => {
    await withHome(t, async ({page}) => {
      const s = stored();
      const countries = s.inSet.filter((e) => e.kind === "country").map((e) => e.entity_id);
      const aggregates = s.inSet.filter((e) => e.kind === "aggregate").map((e) => e.entity_id);
      assert.deepEqual((await rowIds(page, "countries")).sort(), [...countries].sort());
      assert.deepEqual((await rowIds(page, "reference")).sort(), [...aggregates].sort());
      assert.equal(await page.locator(".mm-rank-table tbody[data-group='reference'] .mm-group-row th").innerText(), DRAFT_GROUP_REFERENCE_ROWS);
      assert.equal(await page.locator("#band-compare h2").innerText(), "Compare");
      assert.equal(await page.locator("[data-slot='compare'] h3").innerText(), s.indicator.name);
      const text = await page.locator("[data-slot='compare']").innerText();
      assert.ok(!/\b(total|average|mean|sum)\b/i.test(text.replace(s.indicator.name, "")), "no Total or average label");
      // one request list: no series file on the dashboard
      assert.equal(await page.locator("[data-slot='compare']").getAttribute("aria-busy"), "false");
    });
  });

  test("sampled rows equal the stored scorecard: value, unit, reference period, percentile chip or state code with its sentence", async (t) => {
    await withHome(t, async ({page}) => {
      const s = stored();
      const rows = await page.$$eval(".mm-rank-table tbody > tr[data-entity]", (rs) => rs.map((r) => ({
        id: r.getAttribute("data-entity"), hasValue: r.getAttribute("data-has-value"), state: r.getAttribute("data-state"),
        value: r.querySelector("td.mm-num .mm-fig")?.textContent ?? null, unit: r.querySelector(".mm-unit")?.textContent ?? null,
        pct: r.querySelector("td.mm-pct .mm-fig")?.textContent ?? null, code: r.querySelector(".mm-code")?.textContent ?? null,
        sentence: r.querySelector(".mm-sentence")?.textContent ?? null
      })));
      let withValue = 0;
      for (const r of rows) {
        const c = s.cell(r.id);
        if (r.hasValue === "true") {
          withValue += 1;
          assert.equal(r.value, formatValue(c.value), `${r.id} value`);
          assert.equal(r.unit, s.indicator.unit_label, `${r.id} unit`);
          if (typeof c.percentile === "number" && r.state === "ranked") assert.equal(r.pct, formatPercentile(c.percentile), `${r.id} percentile`);
        } else {
          assert.ok(r.code !== null && r.sentence, `${r.id}: a row without a value shows its state code and sentence`);
        }
      }
      assert.ok(withValue > 0, "fixture has rows with a value");
      // value rows come before rows without a value, in each group
      for (const g of ["countries", "reference"]) {
        const flags = await page.$$eval(`.mm-rank-table tbody[data-group="${g}"] > tr[data-entity]`, (rs) => rs.map((r) => r.getAttribute("data-has-value")));
        assert.deepEqual(flags, [...flags].sort().reverse(), `${g}: rows without a value are last`);
      }
    });
  });

  test("sort select: Value and Percentile order the rows by the stored field (nulls last); Country is A to Z; the header carries aria-sort", async (t) => {
    await withHome(t, async ({page}) => {
      const s = stored();
      await page.selectOption("#rank-sort", "value");
      let ids = (await rowIds(page, "countries"));
      const withValue = ids.filter((id) => s.cell(id)?.value != null && s.cell(id)?.published !== false);
      const values = withValue.map((id) => s.cell(id).value);
      assert.deepEqual(values, [...values].sort((a, b) => b - a), "descending by stored value");
      assert.equal(await page.locator("th[aria-sort='descending']").first().innerText(), "Latest value");
      await page.selectOption("#rank-sort", "percentile");
      ids = await rowIds(page, "countries");
      const pcts = ids.map((id) => s.cell(id)?.percentile).filter((p) => typeof p === "number");
      assert.deepEqual(pcts, [...pcts].sort((a, b) => b - a));
      await page.selectOption("#rank-sort", "name");
      const names = await page.$$eval(".mm-rank-table tbody[data-group='countries'] > tr[data-has-value='true'] > th", (ths) => ths.map((h) => h.textContent.trim()));
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en")));
    });
  });

  test("bar lengths are proportional to the stored value on one shared axis; the fill is the stored bin token; the focus row is outlined", async (t) => {
    await withHome(t, async ({page}) => {
      const s = stored();
      assert.equal(await page.locator(".mm-rank-table").getAttribute("data-axis"), "shared");
      const bars = await page.$$eval(".mm-rank-table tbody > tr[data-has-value='true']", (rs) => rs.map((r) => {
        const rect = r.querySelector(".mm-rank-bar-wrap rect");
        const wrap = r.querySelector(".mm-rank-bar-wrap");
        return {id: r.getAttribute("data-entity"), w: rect ? Number(rect.getAttribute("width")) : null, bin: wrap.getAttribute("data-bin"), fill: rect ? getComputedStyle(rect).fill : null};
      }));
      const pos = bars.filter((b) => b.w !== null && s.cell(b.id).value > 0);
      assert.ok(pos.length >= 2, "two bars to compare");
      const [a, b] = pos;
      const ratioBar = a.w / b.w;
      const ratioValue = s.cell(a.id).value / s.cell(b.id).value;
      assert.ok(Math.abs(ratioBar - ratioValue) < 0.01 * ratioValue, `bar ratio ${ratioBar} vs value ratio ${ratioValue}`);
      // fill equals the bin token (compare with a probe element coloured by the token)
      const tokenColour = await page.evaluate(() => {
        const out = {};
        for (const n of [1, 2, 3, 4, 5]) {
          const p = document.createElement("i");
          p.style.color = `var(--mm-pct-${n})`;
          document.body.append(p);
          out[n] = getComputedStyle(p).color;
          p.remove();
        }
        return out;
      });
      for (const r of bars.filter((x) => x.fill && /^[1-5]$/.test(x.bin))) assert.equal(r.fill, tokenColour[r.bin], `${r.id} fill is the bin ${r.bin} token`);
      // in focus: from the Country filter
      const id = bars[0].id;
      await page.evaluate((c) => globalThis.__mmFilterStore.set({c: [c]}), id);
      await page.waitForTimeout(200);
      assert.equal(await page.locator(`.mm-rank-table tr[data-entity="${id}"]`).getAttribute("data-focus"), "true");
      const shadow = await page.locator(`.mm-rank-table tr[data-entity="${id}"] > th`).evaluate((e) => getComputedStyle(e).boxShadow);
      assert.notEqual(shadow, "none", "the in-focus row is outlined");
    });
  });

  test("mixed units (unit_label with a comma): no bar axis, the percentile dot plus the value text with its unit", async (t) => {
    const route = (page) => page.route(/\/_file\/data\/meta\/indicators\.[0-9a-f]+\.json/, async (r) => {
      const res = await r.fetch();
      const doc = await res.json();
      const first = dataJson("meta/domains.json").domains.find((d) => d.ranked !== false)?.indicator_ids[0];
      for (const i of doc.indicators) if (i.indicator_id === first) i.unit_label = "% of GDP, index";
      await r.fulfill({response: res, body: JSON.stringify(doc)});
    });
    await withHome(t, async ({page}) => {
      assert.equal(await page.locator(".mm-rank-table").getAttribute("data-axis"), "none");
      assert.equal(await page.locator(".mm-rank-table .mm-rank-bar-wrap rect").count(), 0, "no bar is drawn");
      assert.ok((await page.locator(".mm-rank-table .mm-rank-bar-wrap circle").count()) > 0, "percentile dots are drawn");
      const units = await page.$$eval(".mm-rank-table tbody > tr[data-has-value='true'] .mm-unit", (els) => els.map((e) => e.textContent.trim()));
      assert.ok(units.every((u) => u !== ""), "each row shows its unit");
    }, {route});
  });

  test("facts card: stored unit, frequency, direction, reference-period line and notes", async (t) => {
    await withHome(t, async ({page}) => {
      const s = stored();
      const facts = await page.$$eval("[data-slot='facts'] .mm-fact", (els) => els.map((e) => ({k: e.getAttribute("data-fact"), dt: e.querySelector("dt").textContent, dd: e.querySelector("dd").textContent})));
      assert.equal(facts.find((f) => f.k === "unit").dd, s.indicator.unit_label);
      assert.ok(facts.some((f) => f.k === "frequency"));
      assert.ok(facts.some((f) => f.k === "refPeriod"));
      for (const n of s.indicator.notes ?? []) assert.ok(facts.find((f) => f.k === "notes").dd.includes(n));
      assert.ok((await page.locator("[data-slot='facts'] h3").innerText()) === s.indicator.name);
    });
  });

  test("Period hides rows with the ADR-036 disclosure: sentence in a status region, the list of hidden rows, nothing at the default", async (t) => {
    await withHome(t, async ({page}) => {
      assert.equal(await page.locator(".mm-hidden-rows").count(), 0, "default Period: no disclosure element");
      assert.equal(await page.locator("[data-slot='compare'] [role='status']").count() > 0, true, "a status region exists");
      const before = await rowIds(page, "countries");
      await page.evaluate(() => globalThis.__mmFilterStore.set({from: 2026, to: 2026}));
      await page.waitForTimeout(300);
      const s = stored();
      const hiddenExpected = [...s.inSet].filter((e) => {
        const c = s.cell(e.entity_id);
        const y = c && c.value != null && c.published !== false ? Number(String(c.ref_period_end).slice(0, 4)) : null;
        return y !== null && y !== 2026;
      });
      assert.ok(hiddenExpected.length > 0, "the fixture has dated rows outside 2026");
      const summary = await page.locator(".mm-hidden-rows > summary").innerText();
      assert.equal(summary, DRAFT_HIDDEN_ROWS(hiddenExpected.length));
      const items = await page.$$eval(".mm-hidden-rows li", (ls) => ls.map((l) => l.getAttribute("data-entity")));
      assert.deepEqual(items.sort(), hiddenExpected.map((e) => e.entity_id).sort());
      const after = await rowIds(page, "countries");
      for (const id of items) assert.ok(!after.includes(id), `${id} is hidden from the card`);
      assert.ok(after.length < before.length, "rows left the card");
      assert.ok((await page.locator(".mm-hidden-rows li a[data-carry]").count()) > 0, "hidden rows link with the carried hash");
      assert.equal(await page.locator("[data-slot='compare'] [role='status'] details.mm-hidden-rows").count(), 1, "the details sits in the status wrapper");
      await page.evaluate(() => globalThis.__mmFilterStore.reset());
      await page.waitForTimeout(300);
      assert.equal(await page.locator(".mm-hidden-rows").count(), 0);
    });
  });

  test("sticky header row inside the scroll container; keyboard: the point reader and View as table work without a pointer", async (t) => {
    await withHome(t, async ({page}) => {
      assert.equal(await page.locator(".mm-rank-table thead th").first().evaluate((e) => getComputedStyle(e).position), "sticky");
      const reader = page.locator("#rank-reader-country");
      await reader.focus();
      const s = stored();
      const first = (await rowIds(page, "countries")).find((id) => s.cell(id)?.value != null);
      await reader.selectOption(first);
      assert.ok((await page.locator("#rank-reader-output").innerText()).includes(s.indicator.unit_label));
      assert.equal(await page.locator(`.mm-rank-table tr[data-entity="${first}"]`).getAttribute("data-focus"), "true");
      await page.locator("#rank-table-alt > summary").focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("#rank-table tbody tr");
      const alt = await page.$$eval("#rank-table tbody tr", (rs) => rs.map((r) => r.getAttribute("data-entity")));
      assert.deepEqual([...alt].sort(), [...(await rowIds(page, "countries")), ...(await rowIds(page, "reference"))].sort(), "View as table lists the same rows");
    });
  });

  test("320 px: no horizontal page scroll (the table scrolls inside the card); screenshots saved", async (t) => {
    await withHome(t, async ({page}) => {
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.ok(sw[0] <= sw[1], `page scroll width ${sw[0]} > ${sw[1]}`);
      const card = await page.locator("[data-slot='compare']").boundingBox();
      assert.ok(card.x >= 0 && card.x + card.width <= sw[1] + 1, "card inside the viewport");
      mkdirSync(ARTIFACT_DIR, {recursive: true});
      await page.locator("[data-slot='compare']").screenshot({path: join(ARTIFACT_DIR, "l12-rank-320.png")});
    }, {width: 320});
  });

  test("no series or history request for the card", async (t) => {
    if (!browser) return t.skip(reason);
    await withHome(t, async ({log}) => {
      assert.ok(!log.requests.some((u) => /\/_file\/data\/series\//.test(u)), "no series file");
    });
  });
});
