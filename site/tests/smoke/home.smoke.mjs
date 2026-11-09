// Redesign R17/R18 browser smoke of PG-HOME and PG-DOMAINS (AC-RD-02, 03, 05, 62 home/domains part, a11y basics).
// Runs against a built site (npm run build). Localhost only; off-origin requests abort. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1 (CI).
import assert from "node:assert/strict";
import {existsSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {HOME_LINKS} from "../../src/lib/copy.js";
import {installCls, readCls} from "./ux-support.mjs";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
let entities = [];
let indicators = [];
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
  indicators = dataJson("meta/indicators.json").indicators;
  domains = dataJson("meta/domains.json").domains;
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const clean = (log) => {
  assert.deepEqual(log.errors, [], "page or console errors");
  assert.deepEqual(log.offOrigin, [], "off-origin requests");
  assert.deepEqual(log.failed, [], "failed requests");
};

async function withPage(t, path, ready, fn) {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    await page.goto(`${site.origin}${path}`);
    await page.waitForSelector(ready, {timeout: TIMEOUT});
    await page.waitForLoadState("networkidle");
    await fn({page, log});
  } finally {
    await context.close();
  }
}

// Built page file of a clean URL path.
const builtFile = (p) => {
  const rel = p.replace(/^\/+/, "").replace(/\/$/, "");
  const isFile = (c) => existsSync(join(DIST, c)) && statSync(join(DIST, c)).isFile();
  for (const c of [rel === "" ? "index.html" : `${rel}.html`, join(rel, "index.html")]) if (isFile(c)) return c;
  return null;
};
const isDistFile = (p) => existsSync(join(DIST, p.replace(/^\//, ""))) && statSync(join(DIST, p.replace(/^\//, ""))).isFile();
const hrefs = (html) => [...html.matchAll(/<a [^>]*href="([^"#][^"]*)"/g)].map((m) => m[1]).filter((h) => !/^[a-z]+:/.test(h));
const resolvePath = (from, href) => new URL(href.split("#")[0].split("?")[0], `http://x${from}`).pathname.replace(/\/$/, "") || "/";

describe("R18 PG-HOME", () => {
  test("AC-RD-02, 62: every non-global entity and indicator is linked; built links resolve; no Guide/Status/heatmap/status block", async (t) => {
    await withPage(t, "/", "#country-list li", async ({page, log}) => {
      const hs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
      for (const e of entities.filter((x) => x.is_global !== true)) assert.ok(hs.includes(`./country/${e.entity_id}`), e.entity_id);
      for (const i of indicators) assert.ok(hs.includes(`./indicator/${i.indicator_id}`), i.indicator_id);
      for (const h of ["./explorer", "./domains", "./revisions"]) assert.ok(hs.includes(h), h);
      for (const h of hs) if (!/^[a-z]+:/.test(h) && !h.startsWith("#")) assert.ok(builtFile(resolvePath("/", h)), `broken link ${h}`);
      assert.deepEqual(await page.locator(".mm-nav a").allInnerTexts(), ["Home", "Time series", "Domains", "Revisions"]);
      assert.equal(await page.locator('a[href*="/status"], a[href*="/guide"]').count(), 0);
      assert.equal(await page.locator("#observablehq-main h1").count(), 1);
      assert.equal(await page.locator("table, svg, #domain-heatmap").count(), 0);
      const text = await page.locator("main, #observablehq-main").first().innerText();
      for (const bad of ["Guide", "Data status", "Projections are not shown", "all lines share one unit", "Domain overviews", "Look at one series"]) assert.ok(!text.includes(bad), bad);
      assert.equal(await page.locator("#caveat").count(), 1);
      assert.equal(await page.locator("#countries").count(), 1);
      assert.equal(await page.locator("#indicators").count(), 1);
      clean(log);
    });
  });

  test("home link labels equal the nav labels (G-STR4)", async (t) => {
    await withPage(t, "/", "#home-links a", async ({page}) => {
      const labels = await page.$$eval("#home-links a", (as) => as.map((a) => a.textContent));
      assert.deepEqual(labels, [HOME_LINKS.series, HOME_LINKS.domains, HOME_LINKS.revisions]);
    });
  });

  test("a11y: landmarks, labelled filters, headings, keyboard-reachable details", async (t) => {
    await withPage(t, "/", "#filter-countries", async ({page}) => {
      assert.equal(await page.locator("main, [role=main]").count() >= 1, true);
      assert.ok((await page.locator("nav[aria-label]").count()) >= 1);
      for (const id of ["filter-countries", "filter-indicators"]) {
        assert.equal(await page.locator(`label[for="${id}"]`).count(), 1, id);
        assert.ok((await page.locator(`label[for="${id}"]`).innerText()).trim().length > 0);
      }
      const names = await page.$$eval("input[type=search]", (is) => is.map((i) => i.labels[0]?.textContent));
      assert.equal(new Set(names).size, names.length, "filters need distinct accessible names");
      assert.equal(await page.locator('section[aria-labelledby="countries-heading"] #countries-heading').count(), 1);
      assert.equal(await page.locator("details > summary").count() >= 1, true);
      assert.equal(await page.locator("[role=status]").count() >= 2, true);
      await page.locator("#filter-countries").focus();
      assert.equal(await page.evaluate(() => document.activeElement?.id), "filter-countries");
    });
  });

  test("filters narrow the lists, open matching groups, report the count and restore on clear", async (t) => {
    await withPage(t, "/", "#filter-indicators", async ({page}) => {
      const total = await page.locator("#country-list li").count();
      assert.ok(total > 1);
      const name = (await page.locator("#country-list li a").first().innerText()).trim();
      await page.fill("#filter-countries", name.toLowerCase());
      assert.ok((await page.locator("#country-list li:not([hidden])").count()) >= 1);
      assert.ok((await page.locator("#country-list li:not([hidden])").count()) < total);
      assert.match(await page.locator("#filter-countries-status").innerText(), /^\d+ shown$/);
      await page.fill("#filter-countries", "zzzzqq");
      assert.equal(await page.locator("#countries li:not([hidden])").count(), 0);
      assert.equal((await page.locator("#filter-countries-status").innerText()).trim(), "No match.");
      await page.fill("#filter-countries", "");
      assert.equal(await page.locator("#country-list li:not([hidden])").count(), total);
      const ind = indicators[0].name;
      await page.fill("#filter-indicators", ind);
      const open = await page.locator("#indicators details[open]:not([hidden])").count();
      assert.ok(open >= 1);
      assert.ok((await page.locator(`#indicators details[open] a:visible`).count()) >= 1);
      await page.fill("#filter-indicators", "");
      assert.equal(await page.locator("#indicators details[open]").count(), 0);
    });
  });

  // Gate E finding 4: reservations come from measured heights (docs/ops/dashboard-redesign-measurements.md). A stale banner (manifest older than
  // 45 days) is not reserved and its single shift is accepted; this test uses the fresh fixture time.
  for (const width of [360, 1280]) {
    test(`layout: CLS <= 0.1 on / at ${width}px and each mounted filter block equals its reserved slot height (1px)`, async (t) => {
      if (!browser) return t.skip(reason);
      const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
      try {
        await page.setViewportSize({width, height: 800});
        await installCls(page);
        await page.goto(`${site.origin}/`);
        await page.waitForSelector(".mm-asof", {timeout: TIMEOUT});
        await page.waitForSelector(".mm-filter input", {timeout: TIMEOUT});
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);
        const {cls, unsupported} = await readCls(page);
        if (unsupported) return t.skip("layout-shift entries unsupported in this browser");
        assert.ok(cls <= 0.1, `CLS ${cls} at ${width}px`);
        const blocks = await page.$$eval(".mm-filter[data-filter-slot]", (els) =>
          els.map((e) => ({h: e.getBoundingClientRect().height, reserved: parseFloat(getComputedStyle(e).minHeight), kids: e.querySelectorAll("label, input, .mm-filter-status").length}))
        );
        assert.equal(blocks.length, 2);
        for (const b of blocks) {
          assert.equal(b.kids, 3, "label, input and status line are mounted");
          assert.ok(Math.abs(b.h - b.reserved) <= 1, `mounted ${b.h}px vs reserved ${b.reserved}px at ${width}px`);
        }
        clean(log);
      } finally {
        await context.close();
      }
    });
  }

  // Natural (content) height versus reservation: min-height is cleared on the element while it is measured (for the shell: the top of the next sibling, which is what shifts), so the check is not
  // vacuous (a reservation compared with itself always passes). The home shell reserves 40.8px (two-line freshness line) below 416px and 20.4px from 416px;
  // 400 and 420 straddle the wrap point measured on the fixture, 700 is in the 640-768 band.
  for (const path of ["/", "/domains"]) {
    for (const width of [360, 400, 420, 700, 768, 1280]) {
      test(`layout: natural height equals the reservation on ${path} at ${width}px (1px)`, async (t) => {
        if (!browser) return t.skip(reason);
        const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
        try {
          await page.setViewportSize({width, height: 800});
          await page.goto(`${site.origin}${path}`);
          await page.waitForSelector(".mm-asof", {timeout: TIMEOUT});
          if (path === "/") await page.waitForSelector(".mm-filter input", {timeout: TIMEOUT});
          await page.waitForLoadState("networkidle");
          const m = await page.evaluate(() => {
            // Shell: the content after it must sit at the same place with the reservation as without it (margins collapse through the
            // Observable blocks, so the box height alone is not the content height). Filters: the box height with min-height cleared.
            const measure = (sel, byNext) => [...document.querySelectorAll(sel)].map((el) => {
              const reserved = parseFloat(getComputedStyle(el).minHeight);
              const at = () => (byNext ? el.nextElementSibling.getBoundingClientRect().top : el.getBoundingClientRect().height);
              const mounted = at();
              const prev = el.style.minHeight;
              el.style.minHeight = "0px";
              const natural = at();
              el.style.minHeight = prev;
              return {natural, reserved, mounted};
            });
            return {shell: measure(".mm-home-shell", true), filters: measure(".mm-filter[data-filter-slot]", false)};
          });
          assert.equal(m.shell.length, 1);
          const expectedShell = width < 416 ? 40.8 : 20.4;
          assert.ok(Math.abs(m.shell[0].reserved - expectedShell) <= 0.1, `shell reserves ${m.shell[0].reserved}px at ${width}px, expected ${expectedShell}`);
          assert.ok(Math.abs(m.shell[0].natural - m.shell[0].mounted) <= 1, `next content top without reservation ${m.shell[0].natural}px vs with ${m.shell[0].mounted}px at ${width}px (reserved ${m.shell[0].reserved}px)`);
          assert.equal(m.filters.length, path === "/" ? 2 : 0);
          for (const f of m.filters) {
            assert.ok(Math.abs(f.reserved - 56) <= 0.1, `filter reserves ${f.reserved}px`);
            assert.ok(Math.abs(f.natural - f.reserved) <= 1, `filter natural ${f.natural}px vs reserved ${f.reserved}px at ${width}px`);
          }
          clean(log);
        } finally {
          await context.close();
        }
      });
    }
  }

  test("AC-RD-03: one click reaches a country page and an indicator page", async (t) => {
    await withPage(t, "/", "#country-list li a", async ({page}) => {
      await page.locator("#country-list li a").first().click();
      await page.waitForSelector("h1[data-entity]", {timeout: TIMEOUT});
      assert.match(page.url(), /\/country\//);
    });
    await withPage(t, "/", "#indicators", async ({page}) => {
      await page.locator("#indicators details").first().evaluate((d) => { d.open = true; });
      await page.locator("#indicators details a").first().click();
      await page.waitForURL(/\/indicator\//, {timeout: TIMEOUT});
    });
  });

  test("AC-RD-05: without JavaScript the full lists are in the page, with no filter control", async (t) => {
    if (!browser) return t.skip(reason);
    const context = await browser.newContext({javaScriptEnabled: false});
    try {
      const page = await context.newPage();
      await page.goto(`${site.origin}/`);
      const n = await page.locator("#country-list li, #aggregate-list li").count();
      assert.equal(n, entities.filter((e) => e.is_global !== true).length);
      assert.equal(await page.locator("#indicators li a").count() >= indicators.length, true);
      assert.equal(await page.locator("input").count(), 0);
      assert.equal(await page.locator("h1").count(), 1);
    } finally {
      await context.close();
    }
  });
});

describe("R17 PG-DOMAINS", () => {
  test("lists every domain with a working link; every domain page links back to it; no table", async (t) => {
    await withPage(t, "/domains", "#domain-list li", async ({page, log}) => {
      assert.equal(await page.locator("#domain-list li").count(), domains.length);
      const hs = await page.$$eval("#domain-list a", (as) => as.map((a) => a.getAttribute("href")));
      // R17: the page lists domains sorted by domain_id (CR-9 display order still open).
      assert.deepEqual(hs, domains.map((d) => d.domain_id).sort().map((id) => `./domain/${id}`));
      for (const h of hs) assert.ok(builtFile(resolvePath("/domains", h)), `broken link ${h}`);
      assert.equal(await page.locator("table").count(), 0);
      assert.equal(await page.locator("#observablehq-main h1").innerText(), "Domains");
      assert.ok((await page.locator("nav[aria-label]").count()) >= 1);
      clean(log);
    });
    if (!browser) return;
    for (const d of domains) {
      const f = builtFile(`/domain/${d.domain_id}`);
      assert.ok(f, d.domain_id);
      const back = hrefs(readFileSync(join(DIST, f), "utf8")).map((h) => resolvePath(`/domain/${d.domain_id}`, h));
      assert.ok(back.includes("/domains"), `${d.domain_id} has no link to /domains`);
    }
  });

  test("link integrity over the static HTML of home and domains pages", (t) => {
    if (!distBuilt()) return t.skip(reason);
    for (const from of ["/", "/domains"]) {
      const f = builtFile(from);
      assert.ok(f, from);
      for (const h of hrefs(readFileSync(join(DIST, f), "utf8"))) {
        const p = resolvePath(from, h);
        assert.ok(builtFile(p) || isDistFile(p), `${from}: broken link ${h} -> ${p}`);
      }
    }
  });
});
