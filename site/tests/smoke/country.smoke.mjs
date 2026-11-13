// Redesign R7 browser smoke of PG-COUNTRY (AC-RD-10, 11, 12, 13, 15, 40, 42, 45, 54 country part, 62 country part).
// Runs against a built site (npm run build). States, sentences and the grayscale check (AC-RD-40) need the SYNTHETIC sparse fixture
// (tests/fixtures/sparse_export, entities SY01..SY09, SYA1); on another export those tests skip, the generic ones still run.
// Localhost only; off-origin requests abort. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1 (CI).
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {formatValue} from "../../src/lib/scorecard.js";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";
import {horizontalOverflow, setViewport} from "./ux-support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;
const READY = ".mm-country-domain table tbody tr";

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
let entities = [];
let domains = [];
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
  domains = dataJson("meta/domains.json").domains;
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const isSparse = () => entities.some((e) => e.entity_id === "SY01");
const clean = (log) => {
  assert.deepEqual(log.errors, [], "page or console errors");
  assert.deepEqual(log.offOrigin, [], "off-origin requests");
  assert.deepEqual(log.failed, [], "failed requests");
};

async function withPage(t, path, fn, {sparse = false, width = null} = {}) {
  if (!browser) return t.skip(reason);
  if (sparse && !isSparse()) return t.skip("needs the synthetic sparse fixture export (entities SY01...)");
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    if (width) await setViewport(page, width);
    await page.goto(`${site.origin}${path}`);
    await page.waitForSelector(READY, {timeout: TIMEOUT});
    await fn({page, log});
  } finally {
    await context.close();
  }
}

// First country of the export that has rows with and without a value (any export), else the first country.
const firstCountry = () => entities.find((e) => e.is_global !== true)?.entity_id;

describe("R7 PG-COUNTRY", () => {
  test("AC-RD-10, 12, 62: every indicator once per domain section, links, caveat once per page, no percentile layer by default, orientation once with pc=1, no Guide/Status link", async (t) => {
    const id = isSparse() ? "SY01" : firstCountry();
    await withPage(t, `/country/${id}`, async ({page, log}) => {
      for (const d of domains) {
        const sc = dataJson(`scorecard/${d.domain_id}.json`);
        if (!sc.entities.some((e) => e.entity_id === id)) {
          assert.equal(await page.locator(`#domain-${d.domain_id}`).count(), 0, `${d.domain_id} has no row for ${id}`);
          continue;
        }
        const sec = page.locator(`#domain-${d.domain_id}`);
        for (const ind of d.indicator_ids) assert.equal(await sec.locator(`tr[data-indicator="${ind}"]`).count(), 1, `${d.domain_id}/${ind}`);
        assert.equal(await sec.locator("h2 a[data-link=domain]").getAttribute("href"), `../domain/${d.domain_id}`);
        assert.equal(await sec.locator('[data-tile="domain-figure"]').count(), 0, `${d.domain_id}: the percentile tile is the opt-in layer (ADR-037 decision 3)`);
        assert.equal(await sec.locator('[id^="profile-"]').count(), 0, `${d.domain_id}: no percentile strip by default`);
      }
      assert.equal(await page.locator(".mm-caveat").count(), 1, "the standing caveat is printed once per page, whatever pc is (C-CTRY-6, AC-RD-62)");
      assert.equal(await page.locator(".mm-orientation, td.mm-pct").count(), 0, "no orientation sentence or percentile column by default (AC-V2-25, 26)");
      assert.equal(await page.locator('a[href*="guide" i], a[href*="status" i]:not(.mm-nav a)').count(), 0);
      clean(log);
    });
    await withPage(t, `/country/${id}#pc=1`, async ({page}) => {
      for (const d of domains) {
        const sc = dataJson(`scorecard/${d.domain_id}.json`);
        if (!sc.entities.some((e) => e.entity_id === id)) continue;
        assert.equal(await page.locator(`#domain-${d.domain_id} [data-tile="domain-figure"]`).count(), d.ranked ? 1 : 0, `${d.domain_id}: domain-figure tile only for a ranked domain, with pc=1`);
        if (!d.ranked) assert.equal(await page.locator(`#domain-${d.domain_id} [id^="profile-"]`).count(), 0, "an unranked domain draws no percentile chart");
      }
      assert.equal(await page.locator(".mm-caveat").count(), 1);
      assert.equal(await page.locator(".mm-orientation").count(), 1, "the orientation sentence is printed whenever pc=1 (decided 2026-11-13)");
      assert.equal(await page.locator("#show-percentile").isChecked(), true, "the control follows the hash");
    });
  });

  test("AC-RD-11, 42: shown value, unit, percentile (pc=1) and period equal the stored JSON (sampled rows)", async (t) => {
    const id = isSparse() ? "SY01" : firstCountry();
    await withPage(t, `/country/${id}#pc=1`, async ({page}) => {
      let checked = 0;
      for (const d of domains) {
        const row = dataJson(`scorecard/${d.domain_id}.json`).entities.find((e) => e.entity_id === id);
        if (!row) continue;
        for (const c of row.indicators.filter((x) => x.value !== null && x.published !== false)) {
          const tr = page.locator(`#domain-${d.domain_id} tr[data-indicator="${c.indicator_id}"]`);
          const shown = (await tr.locator(".mm-num .mm-fig").innerText()).trim();
          assert.equal(shown, formatValue(c.value), `${c.indicator_id}: shown text vs formatValue(stored ${c.value})`); // the page prints the stored number formatted by scorecard.js formatValue (toPrecision(7))
          assert.notEqual((await tr.locator(".mm-num .mm-unit").innerText()).trim(), "", `${c.indicator_id}: a value without a unit text`);
          if (typeof c.percentile === "number" && c.alignment !== "lagging" && c.alignment !== "unaligned" && c.is_stale !== true && c.inherited !== true) {
            assert.equal(await tr.locator("td.mm-pct .mm-fig").innerText(), c.percentile.toFixed(2));
          }
          checked++;
        }
        const head = await page.locator(`#table-${d.domain_id} thead th`).allInnerTexts();
        const anyStored = row.indicators.some((c) => d.indicator_ids.includes(c.indicator_id) && typeof c.percentile === "number");
        assert.equal(head.includes("percentile vs all ranked countries"), anyStored, `${d.domain_id}: the percentile header is printed iff a row of the table has a stored percentile (decided 2026-11-13)`);
        if (!anyStored) assert.ok(head.includes("State"), `${d.domain_id}: the stored state column instead`);
      }
      assert.ok(checked > 0);
    });
  });

  test("AC-RD-13, 45: the profile chart is role=img with a generated label, plots only stored percentiles, hollow dots for estimates, table beneath", async (t) => {
    await withPage(t, "/country/SY01#pc=1", async ({page}) => {
      const fig = page.locator("#profile-growth");
      assert.equal(await fig.getAttribute("role"), "img");
      assert.equal(await fig.getAttribute("aria-label"), "percentile of each indicator for Synthetic SY01, domain Synthetic growth; table below lists the same values");
      const stored = await page.locator("#domain-growth tr[data-has-value=true] td.mm-pct .mm-fig").count(); // ranked or ahead cells
      const dots = await fig.locator("circle").count();
      assert.equal(dots, stored, "one dot per stored percentile");
      assert.equal(await fig.locator('circle[fill="none"]').count(), 1, "T02 is an estimate: one hollow dot");
      assert.equal(await page.locator("#domain-growth tr[data-indicator=T02] [data-mark=estimate]").innerText().then((x) => x.includes("e")), true);
      const after = await page.evaluate(() => {
        const f = document.querySelector("#profile-growth");
        const tb = document.querySelector("#table-growth");
        return Boolean(f && tb && f.compareDocumentPosition(tb) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      assert.equal(after, true, "the table comes after the chart");
      assert.equal(await page.locator("#profile-agri").count(), 0);
    }, {sparse: true});
  });

  test("AC-RD-15: the filter hides the rows without a value and nothing else; no hidden-row count is shown", async (t) => {
    await withPage(t, "/country/SY07", async ({page}) => {
      const total = await page.locator("tr[data-indicator]").count();
      const visibleBefore = await page.locator("tr[data-indicator]:visible").count();
      assert.equal(visibleBefore, total);
      // L22: one filter per table card (radio group country-filter-<domain>).
      const setAll = async (v) => { for (const r of await page.locator(`input[name^="country-filter-"][value="${v}"]`).all()) await r.check(); };
      await setAll("value");
      assert.equal(await page.locator('tr[data-has-value="false"]:visible').count(), 0);
      assert.equal(await page.locator('tr[data-has-value="true"]:visible').count(), await page.locator('tr[data-has-value="true"]').count());
      assert.equal(await page.locator(".mm-group-row:visible").count(), 0);
      assert.equal(await page.locator(".mm-country-domain:visible").count(), await page.locator(".mm-country-domain").count());
      // AC-RD-15 is about the Show filter of the table card: it prints no count. (K1 has its own ADR-036 hidden-rows disclosure, AC-V2-13.)
      for (const card of await page.locator("[data-table-card]").all()) assert.doesNotMatch(await card.innerText(), /\b\d+\s+(rows?|indicators?)?\s*(hidden|filtered)/i);
      await setAll("all");
      assert.equal(await page.locator("tr[data-indicator]:visible").count(), total);
    }, {sparse: true});
  });

  test("country switcher: choosing an option does not navigate (WCAG 3.2.2); the Go button and Enter do", async (t) => {
    const start = isSparse() ? "SY01" : firstCountry();
    await withPage(t, `/country/${start}`, async ({page}) => {
      const list = entities.filter((e) => e.is_global !== true);
      const target = list.at(-1).entity_id;
      const other = list.at(-2).entity_id;
      const path = new URL(page.url()).pathname;
      await page.selectOption("#country-switcher", target);
      await page.waitForTimeout(500);
      assert.equal(new URL(page.url()).pathname, path, "selecting an option does not navigate"); // V9: the choice is written as c (spec A1.2), the page stays
      await page.focus("#country-switcher-go");
      await Promise.all([page.waitForURL(`**/country/${target}**`), page.keyboard.press("Enter")]);
      await page.waitForSelector(READY, {timeout: TIMEOUT});
      assert.equal(await page.locator("h1").getAttribute("data-entity"), target);
      await page.selectOption("#country-switcher", other);
      await page.focus("#country-switcher");
      await Promise.all([page.waitForURL(`**/country/${other}**`), page.keyboard.press("Enter")]);
      await page.waitForSelector(READY, {timeout: TIMEOUT});
      assert.equal(await page.locator("h1").getAttribute("data-entity"), other);
    });
  });

  test("row links: PG-INDICATOR, PG-DOMAIN and PG-SERIES with #i= and #c=", async (t) => {
    await withPage(t, "/country/SY01", async ({page}) => {
      const tr = page.locator("#domain-growth tr[data-indicator=T01]");
      assert.equal(await tr.locator("a[data-link=indicator-name]").getAttribute("href"), "../indicator/T01");
      assert.equal(await tr.locator("a[data-link=indicator]").getAttribute("href"), "../indicator/T01#c=SY01");
      assert.equal(await tr.locator("a[data-link=series]").getAttribute("href"), "../explorer#i=T01&c=SY01");
      assert.equal(await tr.locator("a[data-link=series]").innerText(), "Time series");
    }, {sparse: true});
  });

  describe("AC-RD-40: every state of spec 5.1 renders its code, signature and sentence", () => {
    // [entity, indicator, section, state key, code, sentence fragment]
    const CASES = [
      ["SY01", "T01", "growth", "ranked", null, null],
      ["SY06", "T02", "growth", "ahead", "ahead", "ranked at its latest value"],
      ["SY02", "T02", "growth", "inherited", "inherited from the euro area", "not ranked (inherited)"],
      ["SY03", "T02", "growth", "stale", "stale", "stale: no rank"],
      ["SY04", "T02", "growth", "lagging", "lagging", "not ranked (lagging)"],
      ["SY05", "T02", "growth", "unaligned", "unaligned", "not ranked (unaligned)"],
      ["SY07", "T04", "growth", "na", "n/a", "A series is defined for this country, but this export holds no value for it."],
      ["SY08", "T04", "growth", "na", "n/a", "This export lists no series for this country and indicator."],
      ["SY09", "T02", "growth", "not_published", "np", "Not published on this site."]
    ];
    const shots = new Map();
    const sigs = new Map();
    for (const [ent, ind, dom, key, code, sentence] of CASES) {
      test(`${key}: ${ent} ${ind}`, async (t) => {
        await withPage(t, `/country/${ent}#pc=1`, async ({page}) => {
          await page.addStyleTag({content: "html { filter: grayscale(1); }"});
          const tr = page.locator(`#domain-${dom} tr[data-indicator="${ind}"]`);
          const cell = tr.locator("td[data-state]");
          assert.equal(await cell.getAttribute("data-state"), key);
          const sig = await cell.getAttribute("data-signature");
          assert.ok(sig, "a data-signature");
          if (code) assert.equal((await cell.locator(".mm-code, .mm-tag").first().innerText()).trim(), code);
          if (sentence) assert.ok((await cell.innerText()).includes(sentence), `sentence ${sentence}`);
          if (key === "na") assert.ok((await cell.locator(".mm-sentence").innerText()).trim().length > 0, "n/a never without a sentence");
          if (!sigs.has(key)) sigs.set(key, sig);
          if (!shots.has(key)) {
            const el = cell.locator(".mm-cell").first();
            await el.scrollIntoViewIfNeeded();
            shots.set(key, createHash("sha256").update(await el.screenshot()).digest("hex"));
          }
        }, {sparse: true});
      });
    }
    test("signatures are pairwise distinct and grayscale images differ (same run)", async (t) => {
      if (!browser) return t.skip(reason);
      if (!isSparse()) return t.skip("needs the synthetic sparse fixture export");
      const list = [...sigs.values()].map((x) => x.split("+")[0]);
      assert.equal(new Set(list).size, list.length, `signatures: ${[...sigs].map(([k, v]) => `${k}=${v}`).join(", ")}`);
      assert.equal(new Set(shots.values()).size, shots.size, "two states produced the same cell image under grayscale");
    });
    test("n/a never appears without an adjacent sentence on any page of the fixture", async (t) => {
      await withPage(t, "/country/SY07", async ({page}) => {
        const bad = await page.$$eval(".mm-code", (els) => els.filter((e) => e.textContent.trim() === "n/a" && !(e.closest("td, p")?.querySelector(".mm-sentence")?.textContent ?? "").trim()).length);
        assert.equal(bad, 0);
      }, {sparse: true});
    });
  });

  test("AC-RD-12: an aggregate shows the not ranked wording; an unranked domain shows no percentile", async (t) => {
    await withPage(t, "/country/SYA1#pc=1", async ({page}) => {
      assert.ok((await page.locator('#domain-growth [data-tile="domain-figure"]').innerText()).includes("aggregate (not ranked)"));
      assert.equal(await page.locator('#domain-agri [data-tile="domain-figure"]').count(), 0);
      assert.equal(await page.locator("#domain-agri td.mm-pct .mm-fig").count(), 0);
    }, {sparse: true});
  });

  test("AC-RD-54: at 320 px the page does not overflow, the table scrolls inside its container with a sticky header and is keyboard reachable", async (t) => {
    await withPage(t, `/country/${isSparse() ? "SY01" : firstCountry()}`, async ({page, log}) => {
      const o = await horizontalOverflow(page);
      assert.deepEqual(o.offenders, [], `page overflow ${o.scrollW} > ${o.vw}`);
      const info = await page.evaluate(() => {
        const box = document.querySelector(".mm-ctry-scroll");
        const th = document.querySelector(".mm-country-table thead th");
        return {scrolls: box.scrollWidth > box.clientWidth, tab: box.getAttribute("tabindex"), sticky: getComputedStyle(th).position, overflow: getComputedStyle(box).overflowX};
      });
      assert.equal(info.scrolls, true, "the table is wider than its container at 320 px");
      assert.equal(info.tab, "0");
      assert.equal(info.sticky, "sticky");
      assert.equal(info.overflow, "auto");
      clean(log);
    }, {width: 320});
  });
});

// V16 (Country page assembly; AC-V2-40 fixture part, 61; AC-RD-01, 53): K1, L1, T1 per domain, the percentile control, no controls that do not act. Needs the SYNTHETIC v2 fixture export
// (EXPORT_DIR=tests/fixtures/v2_export: entities DEU..., indicator V06); on another export the tests skip.
describe("V16 Country page assembly", () => {
  const isV2 = () => domains.some((d) => d.domain_id === "qa") && entities.some((e) => e.entity_id === "DEU");

  test("each domain band holds K1, then L1, then the T1 table, in the stored domain order", async (t) => {
    if (!browser) return t.skip(reason);
    if (!isV2()) return t.skip("needs the synthetic v2 fixture export (tests/fixtures/v2_export)");
    await withPage(t, "/country/DEU", async ({page, log}) => {
      const order = await page.locator("section.mm-country-domain").evaluateAll((els) => els.map((e) => e.getAttribute("data-domain")));
      assert.deepEqual(order, domains.map((d) => d.domain_id));
      for (const id of order) {
        const kinds = await page.locator(`#domain-${id} [data-card="k1"], #domain-${id} [data-card="l1"], #domain-${id} [data-table-card]`).evaluateAll((els) => els.map((e) => (e.matches("[data-card=k1]") ? "k1" : e.matches("[data-card=l1]") ? "l1" : "t1")));
        assert.deepEqual(kinds, ["k1", "l1", "t1"], id);
      }
      assert.deepEqual(await page.locator("section.mm-country-domain details.mm-l1").evaluateAll((els) => els.map((e) => e.open)), [true, true, false, false, false, false], "the first two L1 cards are expanded");
      assert.equal(await page.locator("#filter-indicator, [id$='-rebase'], [data-action='proj']").count(), 0, "no control that does not act on this page");
      clean(log);
    });
  });

  test("AC-V2-25, 26: the Show percentile checkbox writes pc, adds the percentile layer with the caveat and the orientation sentence, and removes them again", async (t) => {
    if (!browser) return t.skip(reason);
    if (!isV2()) return t.skip("needs the synthetic v2 fixture export (tests/fixtures/v2_export)");
    await withPage(t, "/country/DEU", async ({page}) => {
      assert.equal(await page.locator("td.mm-pct, .mm-orientation").count(), 0);
      assert.equal(await page.locator(".mm-caveat").count(), 1, "the caveat stands without pc");
      await page.check("#show-percentile");
      await page.waitForFunction(() => document.querySelectorAll("td.mm-pct").length > 0);
      assert.equal(new URL(page.url()).hash, "#pc=1");
      assert.equal(await page.locator(".mm-caveat").count(), 1);
      assert.equal(await page.locator(".mm-orientation").count(), 1);
      assert.ok((await page.locator(".mm-pc-notes").innerHTML()).indexOf("mm-caveat") < (await page.locator(".mm-pc-notes").innerHTML()).indexOf("mm-orientation"), "caveat first");
      await page.uncheck("#show-percentile");
      await page.waitForFunction(() => document.querySelectorAll("td.mm-pct").length === 0);
      assert.equal(new URL(page.url()).hash, "", "off is the default: an empty hash");
      assert.equal(await page.locator(".mm-orientation").count(), 0);
      assert.equal(await page.locator(".mm-caveat").count(), 1, "the caveat stays once per page");
    });
  });

  test("AC-V2-40 (fixture): the series files read by the first interaction (two open L1 cards, then one more card) are a few KB and none is read twice", async (t) => {
    if (!browser) return t.skip(reason);
    if (!isV2()) return t.skip("needs the synthetic v2 fixture export (tests/fixtures/v2_export)");
    await withPage(t, "/country/DEU", async ({page, log}) => {
      await page.waitForLoadState("networkidle");
      await page.locator("#domain-fiscal details.mm-l1 > summary").click();
      await page.waitForSelector("#domain-fiscal .mm-facet");
      await page.waitForLoadState("networkidle");
      const files = log.requests.filter((u) => /\/_file\/data\/series\//.test(u));
      assert.equal(new Set(files).size, files.length, "each series file once");
      assert.ok(files.length >= 4, `series files read: ${files.length}`);
      assert.ok(files.length <= 8);
    });
  });
});
