// V9 / V8 browser smoke (AC-V2-60, 61, 62; A1.2; spec 2): the native entity picker and the Country / Compare mode switch.
// Runs against a built site (npm run build). Localhost only; off-origin requests abort. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

const TIMEOUT = 20000;
let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
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
  entities = dataJson("meta/entities.json").entities;
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const withPage = async (t, path, ready, fn, {javaScriptEnabled = true} = {}) => {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin);
  try {
    await page.goto(`${site.origin}${path}`);
    if (ready) await page.waitForSelector(ready, {timeout: TIMEOUT});
    await fn({page, log});
  } finally {
    await context.close();
  }
};
const shown = () => entities.filter((e) => e.is_global !== true);

describe("V9 native country picker", () => {
  test("the entity picker is a native select with Countries and Aggregates optgroups, a native Group select, no combobox role", async (t) => {
    await withPage(t, "/country", "#picker-slot select", async ({page, log}) => {
      assert.equal(await page.locator("#country-switcher").evaluate((el) => el.tagName), "SELECT");
      assert.equal(await page.locator("#picker-group").evaluate((el) => el.tagName), "SELECT");
      const groups = await page.$$eval("#country-switcher optgroup", (gs) => gs.map((g) => [g.label, g.querySelectorAll("option").length]));
      const countries = shown().filter((e) => e.kind === "country").length;
      const aggregates = shown().filter((e) => e.kind !== "country").length;
      assert.deepEqual(groups.map((g) => g[0]), aggregates ? ["Countries", "Aggregates"] : ["Countries"]);
      assert.equal(groups[0][1], countries);
      if (aggregates) assert.equal(groups[1][1], aggregates);
      assert.equal(await page.locator('[role="combobox"], [role="listbox"], [aria-activedescendant], datalist').count(), 0);
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.offOrigin, []);
    });
  });

  test("keyboard only: type-ahead picks an option without navigating; Enter on the select opens the country page with c in the address", async (t) => {
    await withPage(t, "/country", "#picker-slot select", async ({page}) => {
      const target = shown().find((e) => e.kind === "country");
      const path = new URL(page.url()).pathname;
      await page.focus("#country-switcher");
      await page.keyboard.type(target.name.slice(0, 3));
      assert.equal(await page.locator("#country-switcher").inputValue(), target.entity_id, "native type-ahead selects it");
      await page.waitForTimeout(300);
      assert.equal(new URL(page.url()).pathname, path, "choosing an option does not navigate (WCAG 3.2.2)");
      assert.match(page.url().split("#")[1] ?? "", /^c=/, "the choice is written as c");
      await Promise.all([page.waitForURL(`**/country/${target.entity_id}**`), page.keyboard.press("Enter")]);
      assert.match(new URL(page.url()).hash, new RegExp(`c=${target.entity_id}`));
    });
  });

  test("the Go button also navigates; the Group select limits the country options and writes g", async (t) => {
    await withPage(t, "/country", "#picker-slot select", async ({page}) => {
      const opts = await page.$$eval("#picker-group option", (os) => os.map((o) => o.value).filter(Boolean));
      if (opts.length) {
        const all = await page.locator("#country-switcher optgroup[label='Countries'] option").count();
        await page.selectOption("#picker-group", opts[0]);
        const limited = await page.locator("#country-switcher optgroup[label='Countries'] option").count();
        assert.ok(limited <= all, "the Group never adds countries");
        assert.match(new URL(page.url()).hash, new RegExp(`g=${opts[0]}`));
      }
      const id = (await page.$$eval("#country-switcher optgroup[label='Countries'] option", (os) => os.map((o) => o.value)))[0];
      await page.selectOption("#country-switcher", id);
      await Promise.all([page.waitForURL(`**/country/${id}**`), page.click("#country-switcher-go")]);
    });
  });

  test("without JavaScript the country list page still holds every country link and the mode switch, all plain links", async (t) => {
    if (!browser) return t.skip(reason);
    const context = await browser.newContext({javaScriptEnabled: false});
    try {
      const page = await context.newPage();
      await page.goto(`${site.origin}/country`);
      const hrefs = await page.$$eval("#country-list a, #aggregate-list a", (as) => as.map((a) => a.getAttribute("href")));
      assert.deepEqual(hrefs.sort(), shown().map((e) => `./country/${e.entity_id}`).sort());
      const sw = await page.$$eval(".mm-mode-switch a", (as) => as.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")]));
      assert.deepEqual(sw, [["Country", "./country", "page"], ["Compare", "./compare", null]]);
      await Promise.all([page.waitForURL("**/country/" + shown()[0].entity_id), page.click(`#country-list a[href="./country/${shown()[0].entity_id}"]`)]);
    } finally {
      await context.close();
    }
  });
});

describe("V8 mode switch and navigation", () => {
  test("header nav is the six pages in order; Country and Compare are real links", async (t) => {
    await withPage(t, "/compare", ".mm-asof", async ({page}) => {
      const nav = await page.$$eval("nav.mm-nav a", (as) => as.map((a) => [a.textContent, new URL(a.href).pathname]));
      assert.deepEqual(nav, [["Home", "/"], ["Country", "/country"], ["Compare", "/compare"], ["Time series", "/explorer"], ["Domains", "/domains"], ["Revisions", "/revisions"]]);
      assert.equal(await page.locator("nav.mm-nav a[aria-current='page']").textContent(), "Compare");
    });
  });

  test("Country page -> Compare keeps the shared keys, drops none that Compare uses and adds c; Compare -> Country drops Compare-only keys", async (t) => {
    const id = shown()[0].entity_id;
    await withPage(t, `/country/${id}#i=M09&g=g7&stl=1&pc=1`, "#filterbar .mm-mode-switch", async ({page}) => {
      assert.equal(await page.locator("#filterbar .mm-mode-switch a[aria-current='page']").textContent(), "Country");
      await Promise.all([page.waitForURL("**/compare**"), page.click("#filterbar .mm-mode-switch a[data-carry='compare']")]);
      const h = new URL(page.url()).hash;
      assert.match(h, new RegExp(`c=${id}`));
      for (const k of ["i=M09", "g=g7", "stl=1", "pc=1"]) assert.ok(h.includes(k), k);
      assert.equal(await page.locator(".mm-mode-switch a[aria-current='page']").textContent(), "Compare");
      await page.goto(`${site.origin}/compare#i=M09&c=${id}&stl=1&x=M09&ctx=1`);
      await page.waitForSelector(".mm-mode-switch a[data-carry='country']");
      await Promise.all([page.waitForURL("**/country**"), page.click(".mm-mode-switch a[data-carry='country']")]);
      assert.equal(new URL(page.url()).pathname, "/country");
      const h2 = new URL(page.url()).hash;
      assert.ok(h2.includes("i=M09") && h2.includes(`c=${id}`));
      assert.ok(!/stl=|x=|ctx=/.test(h2), "Compare-only keys are dropped for Country");
    });
  });

  test("an indicator page is Compare with its indicator fixed: the Compare tab is current and Country carries the Country keys", async (t) => {
    const ind = dataJson("meta/indicators.json").indicators[0].indicator_id;
    await withPage(t, `/indicator/${ind}`, "#filterbar .mm-mode-switch", async ({page}) => {
      assert.equal(await page.locator("#filterbar .mm-mode-switch a[aria-current='page']").textContent(), "Compare");
      assert.equal(await page.locator("#filterbar .mm-mode-switch a[data-carry-set]").getAttribute("data-carry-set"), `i=${ind}`);
    });
  });

  test("the mode switch is the first child of the live filter bar on Country and Indicator pages, above the controls", async (t) => {
    const id = shown()[0].entity_id;
    await withPage(t, `/country/${id}`, "#filterbar .mm-mode-switch", async ({page}) => {
      assert.equal(await page.locator("#filterbar > :first-child").getAttribute("class"), "mm-mode-switch");
      assert.equal(await page.locator("#filterbar-slot > .mm-mode-switch").count(), 0, "the static copy is replaced, not duplicated");
    });
  });
});
