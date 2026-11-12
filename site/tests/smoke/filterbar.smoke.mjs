// L6/L7 browser smoke: the filter store drives a Framework reactive cell (proof card) and the filter bar controls (AC-DB-01 part, 02, 03).
// Runs against a built site (npm run build with the site_spike export). Localhost only. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {DRAFT_COUNTRY_LIMIT, DRAFT_FILTER_ALL, DRAFT_FILTER_LABELS as L, DRAFT_PERIOD_INVALID, DRAFT_PERIOD_PRESETS, DRAFT_PERIOD_VALUE, HOME_AGGREGATES_HEADING} from "../../src/lib/copy.js";
import {CONTROLS_BY_PAGE} from "../../src/lib/filter-bar-options.js";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;
const RENDERED = ["group", "country", "domain", "indicator", "period", "frequency"]; // L7 to L9
const CHIPS = ["country", "period"];
const SELECTS = RENDERED.filter((c) => !CHIPS.includes(c));
const LABEL_OF = {group: L.group, domain: L.domain, indicator: L.indicator, frequency: L.frequency};
// Country chip on home and series pages only (amendment 2.4).
// The indicator page's Indicator control is the switcher (a navigation, not a store control: no data-filter-control), so it is not listed.
const renderedOn = (page) => CONTROLS_BY_PAGE[page].filter((c) => RENDERED.includes(c) && (c !== "country" || ["home", "series"].includes(page)) && !(c === "indicator" && page === "indicator"));
// A group id of the fixture the site was built from (the sparse fixture has synthetic_a.., the real export euro_area..).
const firstGroup = () => JSON.parse(readFileSync(join(DIST, "_file/data/meta", readdirSync(join(DIST, "_file/data/meta")).find((f) => /^groups\.[0-9a-f]+\.json$/.test(f))), "utf8")).groups[0].group_id;

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;

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

async function withHome(t, hash, fn) {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    // Count history writes before any page script runs.
    await page.addInitScript(() => {
      window.__writes = [];
      for (const k of ["replaceState", "pushState"]) {
        const orig = history[k].bind(history);
        history[k] = (...a) => {
          window.__writes.push([k, String(a[2])]);
          return orig(...a);
        };
      }
    });
    await page.goto(`${site.origin}/${hash}`);
    await page.waitForSelector("#filterbar", {timeout: TIMEOUT});
    await page.waitForSelector("#band-overview", {timeout: TIMEOUT});
    await page.waitForLoadState("networkidle");
    await fn({page, log});
    assert.deepEqual(log.errors, [], "page or console errors");
    assert.deepEqual(log.offOrigin, [], "off-origin requests");
  } finally {
    await context.close();
  }
}

// L11: the L6 proof card is replaced by the home dashboard; its root counts renders and the Group is read from the store.
const proofRenders = (page) => page.$eval("#dashboard", (el) => Number(el.dataset.renders));
const proofTitle = (page) => page.evaluate(() => globalThis.__mmFilterStore.get().g ?? "All countries");
const writes = (page) => page.evaluate(() => window.__writes);
const settle = (page) => page.waitForTimeout(250);

describe("L6 filter store and reactive proof (AC-DB-02)", () => {
  test("no hash write on load, with and without a hash", async (t) => {
    await withHome(t, "", async ({page}) => assert.deepEqual(await writes(page), []));
    await withHome(t, "#g=euro_area", async ({page}) => assert.deepEqual(await writes(page), []));
  });

  test("a programmatic change re-renders the card, writes the hash once, history.length unchanged; back/forward and hashchange re-read", async (t) => {
    await withHome(t, "", async ({page}) => {
      const groups = await page.$$eval("#filter-group option", (os) => os.map((o) => o.value).filter(Boolean));
      assert.ok(groups.length > 0, "fixture has groups");
      const len0 = await page.evaluate(() => history.length);
      const r0 = await proofRenders(page);
      assert.equal(await proofTitle(page), "All countries");

      await page.selectOption("#filter-group", groups[0]);
      await page.waitForFunction((n) => Number(document.querySelector("#dashboard").dataset.renders) > n, r0, {timeout: TIMEOUT});
      await settle(page);
      assert.equal(await page.evaluate(() => location.hash), `#g=${groups[0]}`);
      assert.deepEqual(await writes(page), [["replaceState", `/#g=${groups[0]}`]], "exactly one replaceState");
      assert.equal(await page.evaluate(() => history.length), len0, "history.length unchanged");
      assert.notEqual(await proofTitle(page), "All countries");
      const r1 = await proofRenders(page);

      // The same value again: no render, no write.
      await page.evaluate((g) => globalThis.__mmFilterStore.set({g}), groups[0]);
      await settle(page);
      assert.equal(await proofRenders(page), r1);
      assert.equal((await writes(page)).length, 1);

      // hashchange (a link or a manual edit) re-reads and never writes.
      await page.evaluate(() => {
        location.hash = "#g=nope-not-a-group";
      });
      await page.waitForFunction((n) => Number(document.querySelector("#dashboard").dataset.renders) > n, r1, {timeout: TIMEOUT});
      assert.equal(await proofTitle(page), "All countries", "an unknown group is dropped");
      const w = await writes(page);
      assert.equal(w.length, 1, "a re-read writes nothing");

      // Back/forward: assigning location.hash pushed an entry (browser-made, not the store's).
      await page.goBack();
      await page.waitForFunction((g) => location.hash === `#g=${g}`, groups[0], {timeout: TIMEOUT});
      await page.waitForFunction(() => (globalThis.__mmFilterStore.get().g ?? "All countries") !== "All countries", null, {timeout: TIMEOUT});
      assert.equal(await page.inputValue("#filter-group"), groups[0], "the select follows the state");
      await page.goForward();
      await page.waitForFunction(() => (globalThis.__mmFilterStore.get().g ?? "All countries") === "All countries", null, {timeout: TIMEOUT});
      assert.equal((await writes(page)).length, 1, "back and forward write nothing");
    });
  });

  test("reset clears the state and the hash", async (t) => {
    await withHome(t, `#g=${firstGroup()}`, async ({page}) => {
      await page.click("#filter-reset");
      await settle(page);
      assert.equal(await page.evaluate(() => location.hash), "");
      assert.equal(await proofTitle(page), "All countries");
    });
  });
});

describe("L7 filter bar controls (AC-DB-01 part, 03)", () => {
  test("home renders the implemented controls; each has an accessible name equal to the copy string; group has a name", async (t) => {
    await withHome(t, "", async ({page}) => {
      assert.equal(await page.locator('form#filterbar[role="group"]').getAttribute("aria-label"), L.filters);
      const want = renderedOn("home");
      const got = await page.$$eval("#filterbar [data-filter-control]", (els) => els.map((e) => e.dataset.filterControl));
      assert.deepEqual(got, want);
      for (const key of SELECTS) {
        const name = await page.locator(`#filter-${key}`).evaluate((el) => el.labels?.[0]?.firstChild?.textContent.trim());
        assert.equal(name, LABEL_OF[key]);
        assert.equal(await page.getByRole("combobox", {name: LABEL_OF[key], exact: true}).count(), 1, key);
      }
      assert.equal(await page.getByRole("button", {name: L.reset, exact: true}).count(), 1);
    });
  });

  test("controls per page type: a control that does nothing on the page is not rendered", async (t) => {
    await withHome(t, "", async ({page, log}) => {
      const url = log.requests.find((u) => /\/filter-bar\.[0-9a-f]+\.js$/.test(new URL(u).pathname));
      assert.ok(url, "built filter-bar module requested");
      const found = await page.evaluate(async (u) => {
        // Minimal stand-in for the Framework html tag: strings are escaped, nodes and arrays go into slots.
        const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
        const html = (strings, ...vals) => {
          const slots = [];
          const src = strings.reduce((acc, s, i) => {
            if (i === 0) return s;
            const v = vals[i - 1];
            if (v instanceof Node || Array.isArray(v)) {
              slots.push(v);
              return `${acc}<mm-slot n="${slots.length - 1}"></mm-slot>${s}`;
            }
            return acc + esc(v) + s;
          }, "");
          const t = document.createElement("template");
          t.innerHTML = src.trim();
          for (const el of [...t.content.querySelectorAll("mm-slot")]) el.replaceWith(...[slots[Number(el.getAttribute("n"))]].flat(Infinity));
          return t.content.firstElementChild;
        };
        const {mountFilterBar} = await import(u);
        const store = {get: () => ({c: [], from: null, to: null}), subscribe: () => () => {}, set() {}, reset() {}};
        const data = {groups: [], domains: [], indicators: [], entities: [], manifest: {history_start: "1991-01-01", known_cutoff: "2026-11-04"}};
        const out = {};
        for (const p of ["home", "country", "indicator", "series", "domain"]) {
          out[p] = [...mountFilterBar(html, {page: p, store, data}).querySelectorAll("[data-filter-control]")].map((e) => e.dataset.filterControl);
        }
        return out;
      }, url);
      for (const p of Object.keys(CONTROLS_BY_PAGE)) assert.deepEqual(found[p], renderedOn(p), p);
    });
  });

  test("a selected indicator that falls out of the narrowed list is cleared (pinned rule)", async (t) => {
    await withHome(t, "", async ({page}) => {
      const all = await page.$$eval("#filter-indicator option", (os) => os.map((o) => o.value).filter(Boolean));
      assert.ok(all.length > 1);
      await page.selectOption("#filter-indicator", all[0]);
      await settle(page);
      assert.equal(await page.evaluate(() => globalThis.__mmFilterStore.get().i), all[0]);
      // Try every frequency and domain; whenever all[0] drops out of the list, the store must hold i = null.
      for (const sel of ["#filter-frequency", "#filter-domain"]) {
        for (const v of (await page.$$eval(`${sel} option`, (os) => os.map((o) => o.value))).filter(Boolean)) {
          await page.selectOption("#filter-indicator", all[0]).catch(() => {});
          await page.evaluate((i) => globalThis.__mmFilterStore.set({i, d: null, f: null}), all[0]);
          await page.selectOption(sel, v);
          await settle(page);
          const st = await page.evaluate(() => ({i: globalThis.__mmFilterStore.get().i}));
          const offered = await page.$$eval("#filter-indicator option", (os) => os.map((o) => o.value));
          assert.equal(st.i, offered.includes(all[0]) ? all[0] : null, `${sel}=${v}`);
        }
      }
    });
  });
});

// Built data files carry a content hash in the name (dist/_file/data/<name>.<hash>.json).
const builtJson = (dir, name) => JSON.parse(readFileSync(join(DIST, "_file", "data", dir, readdirSync(join(DIST, "_file", "data", dir)).find((f) => f.startsWith(`${name}.`))), "utf8"));
const state = (page) => page.evaluate(() => {
  const s = globalThis.__mmFilterStore.get();
  return {c: [...s.c], from: s.from, to: s.to, g: s.g};
});
const open = (page, id) => page.$eval(id, (d) => d.open);
const focusId = (page) => page.evaluate(() => document.activeElement?.id ?? "");

describe("L8 Country chip (AC-DB-01, 04)", () => {
  test("keyboard only: Tab to the chip, open, filter by text, select, Escape closes and returns focus to the summary", async (t) => {
    await withHome(t, "", async ({page}) => {
      await page.focus("#filter-group");
      await page.keyboard.press("Tab");
      assert.equal(await focusId(page), "filter-country-summary", "Tab from Group reaches the Country summary");
      assert.match(await page.locator("#filter-country-summary").innerText(), new RegExp(`^${L.country}: ${DRAFT_FILTER_ALL.countries}$`));
      await page.keyboard.press("Enter");
      assert.equal(await open(page, "#filter-country"), true);
      await page.keyboard.press("Tab");
      assert.equal(await focusId(page), "filter-country-text");
      const names = await page.$$eval("#filter-country-countries li", (ls) => ls.map((l) => l.textContent.trim()));
      assert.ok(names.length > 1);
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en")), "alphabetical");
      const target = names[names.length - 1];
      await page.keyboard.type(target); // the whole name: fixture names share a prefix, so a prefix would not narrow the list to one
      const visible = await page.$$eval("#filter-country-countries li:not([hidden])", (ls) => ls.map((l) => l.textContent.trim()));
      assert.ok(visible.includes(target) && visible.length <= names.length);
      for (let k = 0; k < 6; k++) {
        await page.keyboard.press("Tab");
        if ((await page.evaluate(() => document.activeElement?.type)) === "checkbox") break;
      }
      await page.keyboard.press("Space");
      await settle(page);
      assert.equal((await state(page)).c.length, 1);
      assert.match(await page.evaluate(() => location.hash), /^#c=[A-Za-z0-9_.-]+$/);
      assert.equal(await page.locator("#filter-country-summary").innerText(), `${L.country}: ${target}`);
      await page.keyboard.press("Escape");
      assert.equal(await open(page, "#filter-country"), false);
      assert.equal(await focusId(page), "filter-country-summary");
    });
  });

  test("lists: aggregates under their heading, no global entity; the sixth selection is refused with a visible message", async (t) => {
    await withHome(t, "", async ({page}) => {
      await page.click("#filter-country-summary");
      const heading = await page.locator("#filter-country-aggregates-head").innerText();
      assert.equal(heading, HOME_AGGREGATES_HEADING);
      const ids = await page.$$eval("#filter-country li[data-entity]", (ls) => ls.map((l) => l.dataset.entity));
      const raw = builtJson("meta", "entities");
      const globals = (raw.entities ?? raw).filter((e) => e.is_global).map((e) => e.entity_id);
      for (const g of globals) assert.ok(!ids.includes(g), `global ${g} not offered`);
      const boxes = page.locator("#filter-country-countries input[type=checkbox]");
      const n = await boxes.count();
      assert.ok(n >= 6, "fixture has six countries");
      for (let k = 0; k < 5; k++) await boxes.nth(k).check();
      await settle(page);
      assert.equal((await state(page)).c.length, 5);
      await boxes.nth(5).check({force: true}).catch(() => {});
      assert.equal(await boxes.nth(5).isChecked(), false, "sixth box reverts");
      assert.equal((await state(page)).c.length, 5);
      assert.equal(await page.locator("#filter-country-msg").innerText(), DRAFT_COUNTRY_LIMIT(5));
      await boxes.nth(0).uncheck();
      await settle(page);
      assert.equal((await state(page)).c.length, 4);
    });
  });

  test("a Group restricts the list; an outside click and an outside focus close the chip; Reset clears c", async (t) => {
    await withHome(t, "", async ({page}) => {
      const all = await page.$$eval("#filter-country-countries li", (ls) => ls.length);
      const g = (await page.$$eval("#filter-group option", (os) => os.map((o) => o.value).filter(Boolean)))[0];
      await page.selectOption("#filter-group", g);
      await settle(page);
      const some = await page.$$eval("#filter-country-countries li", (ls) => ls.length);
      assert.ok(some <= all, "Group restricts or equals");
      await page.click("#filter-country-summary");
      await page.locator("#filter-country-countries input[type=checkbox]").first().check();
      await settle(page);
      assert.equal(await open(page, "#filter-country"), true);
      await page.mouse.click(5, 400);
      assert.equal(await open(page, "#filter-country"), false, "outside click closes");
      await page.click("#filter-country-summary");
      await page.focus("#filter-domain");
      assert.equal(await open(page, "#filter-country"), false, "focus outside closes");
      await page.click("#filter-reset");
      await settle(page);
      assert.deepEqual((await state(page)).c, []);
      assert.equal(await page.evaluate(() => location.hash), "");
    });
  });
});

describe("L9 Period chip (AC-DB-01, 02, 03, 04)", () => {
  test("year selects span history_start..known_cutoff year; refused from > to writes nothing; preset sets the pair; All and Reset clear", async (t) => {
    await withHome(t, "", async ({page}) => {
      const years = await page.$$eval("#filter-period-from option", (os) => os.map((o) => Number(o.value)));
      const m = builtJson(".", "manifest");
      assert.equal(years[0], Number(m.history_start.slice(0, 4)));
      assert.equal(years.at(-1), Number(m.known_cutoff.slice(0, 4)));
      assert.equal(await page.locator("#filter-period-summary").innerText(), `${L.period}: ${DRAFT_PERIOD_PRESETS.all}`);
      await page.click("#filter-period-summary");
      const w0 = (await writes(page)).length;
      // Select To first (valid), then a From after it (refused).
      const mid = years[Math.floor(years.length / 2)];
      await page.selectOption("#filter-period-to", String(mid));
      await settle(page);
      assert.deepEqual(await state(page).then((s) => [s.from, s.to]), [years[0] === mid ? mid : years[0], mid].map(Number).slice(0, 2));
      const w1 = (await writes(page)).length;
      await page.selectOption("#filter-period-from", String(years.at(-1)));
      await settle(page);
      assert.equal(await page.locator("#filter-period-msg").innerText(), DRAFT_PERIOD_INVALID);
      assert.equal((await writes(page)).length, w1, "refusal writes nothing");
      assert.equal(await page.inputValue("#filter-period-from"), String(years[0]), "select shows the stored value again");
      assert.ok(w1 > w0);
      // Preset.
      await page.click('[data-period-preset="last5"]');
      await settle(page);
      assert.deepEqual(await state(page).then((s) => [s.from, s.to]), [Math.max(years.at(-1) - 4, years[0]), years.at(-1)]);
      assert.equal(await page.evaluate(() => location.hash), `#from=${Math.max(years.at(-1) - 4, years[0])}&to=${years.at(-1)}`);
      assert.equal(await page.locator("#filter-period-summary").innerText(), `${L.period}: ${DRAFT_PERIOD_VALUE(Math.max(years.at(-1) - 4, years[0]), years.at(-1))}`);
      await page.click('[data-period-preset="all"]');
      await settle(page);
      assert.equal(await page.evaluate(() => location.hash), "");
      await page.click('[data-period-preset="last10"]');
      await settle(page);
      assert.equal((await state(page)).to, years.at(-1));
      await page.click("#filter-reset");
      await settle(page);
      assert.deepEqual(await state(page).then((s) => [s.from, s.to]), [null, null]);
      assert.equal(await page.evaluate(() => location.hash), "");
    });
  });

  test("keyboard: Escape closes the Period chip and returns focus to its summary; an outside focus closes it", async (t) => {
    await withHome(t, "", async ({page}) => {
      await page.focus("#filter-period-summary");
      await page.keyboard.press("Enter");
      assert.equal(await open(page, "#filter-period"), true);
      await page.keyboard.press("Tab");
      assert.equal(await focusId(page), "filter-period-from");
      await page.keyboard.press("Escape");
      assert.equal(await open(page, "#filter-period"), false);
      assert.equal(await focusId(page), "filter-period-summary");
      await page.keyboard.press("Enter");
      await page.focus("#filter-frequency");
      assert.equal(await open(page, "#filter-period"), false);
    });
  });

  test("without history_start the chip is disabled with the existing error block and writes nothing", async (t) => {
    await withHome(t, "", async ({page, log}) => {
      const url = log.requests.find((u) => /\/filter-bar\.[0-9a-f]+\.js$/.test(new URL(u).pathname));
      const out = await page.evaluate(async (u) => {
        const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
        const html = (strings, ...vals) => {
          const slots = [];
          const src = strings.reduce((acc, str, i) => {
            if (i === 0) return str;
            const v = vals[i - 1];
            if (v instanceof Node || Array.isArray(v)) {
              slots.push(v);
              return `${acc}<mm-slot n="${slots.length - 1}"></mm-slot>${str}`;
            }
            return acc + esc(v) + str;
          }, "");
          const tp = document.createElement("template");
          tp.innerHTML = src.trim();
          for (const el of [...tp.content.querySelectorAll("mm-slot")]) el.replaceWith(...[slots[Number(el.getAttribute("n"))]].flat(Infinity));
          return tp.content.firstElementChild;
        };
        const {mountFilterBar} = await import(u);
        let sets = 0;
        const store = {get: () => ({c: [], from: null, to: null}), subscribe: () => () => {}, set: () => sets++, reset() {}};
        const bar = mountFilterBar(html, {page: "home", store, data: {groups: [], domains: [], indicators: [], entities: [], manifest: {known_cutoff: "2026-11-04"}}});
        document.body.append(bar);
        const sum = bar.querySelector("#filter-period-summary");
        sum.click();
        const r = {disabled: sum.getAttribute("aria-disabled"), open: bar.querySelector("#filter-period").open, alert: bar.querySelectorAll("#mm-error-period[role=alert]").length, selects: bar.querySelectorAll("#filter-period-from").length, sets};
        bar.remove();
        return r;
      }, url);
      assert.deepEqual(out, {disabled: "true", open: false, alert: 1, selects: 0, sets: 0});
    });
  });
});

// L10 (AC-DB-04 part, 05, 06, 07): sticky bar, compact mode, focus never covered (WCAG 2.4.11), print line, carry. Measured numbers are printed as
// "L10 measure ..." lines and recorded in docs/ops/dashboard-layout-measurements.md.
describe("L10 sticky, compact, print, carry", () => {
  async function openHome(t, width, hash = "") {
    if (!browser) return t.skip(reason), null;
    const o = await openPage(browser, site.origin, {fixedTime: NOW});
    await o.page.setViewportSize({width, height: 800});
    await o.page.goto(`${site.origin}/${hash}`);
    await o.page.waitForSelector("#filterbar", {timeout: TIMEOUT});
    await o.page.waitForSelector(".mm-print-filters", {state: "attached", timeout: TIMEOUT});
    await o.page.waitForLoadState("networkidle");
    return o;
  }
  const firstValue = (page, id) => page.$eval(`#${id}`, (el) => [...el.options].find((o) => o.value)?.value);

  for (const width of [1280, 320]) {
    test(`AC-DB-05 sticky: at ${width}px the bar stays at the top while the page scrolls, equals its reserved height, and the offsets equal it`, async (t) => {
      const o = await openHome(t, width);
      if (!o) return;
      try {
        await o.page.evaluate(() => window.scrollTo(0, 700));
        await o.page.waitForTimeout(100);
        const m = await o.page.evaluate(() => {
          const slot = document.getElementById("filterbar-slot");
          const r = slot.getBoundingClientRect();
          const root = getComputedStyle(document.documentElement);
          const anyLink = document.querySelector("#home-links a, main a");
          return {top: r.top, h: r.height, position: getComputedStyle(slot).position, reserve: parseFloat(getComputedStyle(slot).minHeight), padding: parseFloat(root.scrollPaddingTop), varH: root.getPropertyValue("--fbar-h"), margin: parseFloat(getComputedStyle(anyLink).scrollMarginTop), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, scrolled: window.scrollY};
        });
        console.log(`L10 measure sticky ${width}px: ${JSON.stringify(m)}`);
        assert.ok(m.scrolled > 0, "the page scrolled");
        assert.equal(m.position, "sticky");
        assert.ok(Math.abs(m.top) <= 0.5, `bar top ${m.top}`);
        assert.ok(Math.abs(m.h - m.reserve) <= 1, `bar ${m.h}px vs reserved ${m.reserve}px`);
        assert.ok(Math.abs(m.padding - m.h) <= 1, `scroll-padding-top ${m.padding} vs bar ${m.h}`);
        assert.ok(Math.abs(m.margin - m.h) <= 1, `scroll-margin-top ${m.margin} vs bar ${m.h}`);
        assert.ok(m.sw <= m.cw, `no horizontal page scroll (${m.sw} > ${m.cw})`);
      } finally {
        await o.context.close();
      }
    });
  }

  test("AC-DB-05 compact: at 320px the Filters disclosure holds the controls, chips show the active filters, Escape closes and returns focus", async (t) => {
    const o = await openHome(t, 320);
    if (!o) return;
    try {
      const {page} = o;
      assert.equal(await page.isVisible("#filter-domain"), false, "controls are inside the closed Filters disclosure");
      assert.equal(await page.isVisible("#filterbar-more-summary"), true);
      assert.equal(await page.$$eval("#filterbar > details", (d) => d.length), 1, "one Filters details at the top level");
      await page.evaluate(() => window.__mmFilterStore.set({f: "A"}));
      await page.waitForFunction(() => document.querySelector("#filterbar-chips")?.textContent.includes("Frequency"));
      assert.match(await page.textContent("#filterbar-chips"), /Frequency: Annual/);
      await page.evaluate(() => window.scrollTo(0, 700)); // the sticky bar is now at the top of the viewport
      await page.click("#filterbar-more-summary");
      assert.equal(await page.isVisible("#filter-domain"), true);
      const panel = await page.$eval(".mm-filterbar-controls", (el) => ({bottom: el.getBoundingClientRect().bottom, vh: innerHeight, slot: document.getElementById("filterbar-slot").getBoundingClientRect().height}));
      assert.ok(panel.bottom <= panel.vh, "the panel fits the viewport");
      assert.ok(panel.slot < 60, `the open panel overlays the page and does not grow the bar (${panel.slot}px)`);
      await page.focus("#filter-domain");
      await page.keyboard.press("Escape");
      assert.equal(await page.$eval("#filterbar-more", (d) => d.open), false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "filterbar-more-summary");
    } finally {
      await o.context.close();
    }
  });

  test("AC-DB-05 wide: from 40rem the controls are always visible and the Filters summary is hidden", async (t) => {
    const o = await openHome(t, 1280);
    if (!o) return;
    try {
      assert.equal(await o.page.isVisible("#filterbar-more-summary"), false);
      assert.equal(await o.page.isVisible("#filter-domain"), true);
      assert.equal(await o.page.isVisible("#filterbar-chips"), false);
      await o.page.setViewportSize({width: 400, height: 800});
      await o.page.waitForSelector("#filter-domain", {state: "hidden", timeout: 3000}); // resizing below 40rem collapses the controls
      await o.page.setViewportSize({width: 1280, height: 800});
      await o.page.waitForSelector("#filter-domain", {state: "visible", timeout: 3000});
    } finally {
      await o.context.close();
    }
  });

  for (const width of [1280, 320]) {
    test(`AC-DB-04 focus is never covered by the sticky bar: Tab through the page at ${width}px (WCAG 2.4.11)`, async (t) => {
      const o = await openHome(t, width);
      if (!o) return;
      try {
        const {page} = o;
        await page.evaluate(() => document.activeElement?.blur());
        let worst = Infinity;
        let checked = 0;
        let barBottomSeen = 0;
        let outside = 0;
        for (let k = 0; k < 400; k++) {
          await page.keyboard.press("Tab");
          const m = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const bar = document.getElementById("filterbar-slot").getBoundingClientRect();
            const r = el.getBoundingClientRect();
            const overlap = Math.min(r.bottom, bar.bottom) - Math.max(r.top, bar.top);
            return {inBar: document.getElementById("filterbar-slot").contains(el) || el.classList.contains("mm-skip"), overlap, gap: r.top >= bar.bottom ? r.top - bar.bottom : Infinity, barBottom: bar.bottom, bottomVisible: r.bottom <= innerHeight + 0.5, tag: el.tagName, id: el.id || el.getAttribute("href") || ""};
          });
          if (!m) continue;
          checked++;
          if (m.inBar) continue;
          outside++;
          barBottomSeen = Math.max(barBottomSeen, m.barBottom);
          worst = Math.min(worst, m.gap);
          assert.ok(m.overlap <= 0.5, `focused ${m.tag} ${m.id} is covered by ${m.overlap}px of the bar at ${width}px (stop ${k})`);
        }
        console.log(`L10 measure focus ${width}px: ${checked} focus stops, ${outside} outside the bar, bar bottom ${barBottomSeen.toFixed(1)}px, smallest gap between the bar's bottom edge and a focused element below it ${worst.toFixed(1)}px`);
        assert.ok(outside > 20, "the page has focus stops below the bar");
      } finally {
        await o.context.close();
      }
    });
  }

  test("AC-DB-06 print: the bar is absent and one Filters line under the freshness line names only the active filters", async (t) => {
    const o = await openHome(t, 1280);
    if (!o) return;
    try {
      const {page} = o;
      await page.emulateMedia({media: "print"});
      const line = () => page.$eval(".mm-print-filters", (el) => ({text: el.textContent, shown: getComputedStyle(el).display !== "none", prev: el.previousElementSibling?.className}));
      assert.deepEqual(await line(), {text: "Filters: none", shown: true, prev: "mm-asof"});
      assert.equal(await page.isVisible("#filterbar"), false);
      assert.equal(await page.isVisible("#filterbar-slot"), false);
      const domain = await firstValue(page, "filter-domain");
      await page.evaluate((d) => window.__mmFilterStore.set({d, f: "A", from: 2023, to: 2025}), domain);
      const text = (await line()).text;
      assert.match(text, /^Filters: Domain: .+; Period: 2023 to 2025; Frequency: Annual$/);
      assert.ok(!/Group:|Country:|Indicator:/.test(text), "default controls are not listed");
      await page.emulateMedia({media: "screen"});
      assert.equal((await line()).shown, false, "the line is print-only");
    } finally {
      await o.context.close();
    }
  });

  test("AC-DB-07 carry: header navigation and data-carry links take the current hash on click", async (t) => {
    const o = await openHome(t, 1280, "#f=A");
    if (!o) return;
    try {
      const {page} = o;
      const countryHref = new URL(await page.getAttribute("#country-list a", "href"), page.url()).pathname; // a country of the built fixture
      const domainId = (await page.getAttribute('details[id^="indicators-"]', "id")).replace("indicators-", ""); // a domain of the built fixture
      const href = await page.getAttribute('.mm-nav a[href*="domains"]', "href");
      assert.ok(!href.includes("#"), "the static href is the plain one");
      await page.click('.mm-nav a[href*="domains"]');
      await page.waitForURL(/\/domains.*#f=A$/);
      assert.ok(page.url().endsWith("#f=A"));
      // a country page: indicator names carry as well
      await page.goto(`${site.origin}${countryHref}#d=${domainId}`);
      await page.waitForSelector('a[data-link="indicator-name"][data-carry]', {timeout: TIMEOUT});
      const link = page.locator('a[data-link="indicator-name"][data-carry]').first();
      await link.focus(); // keyboard activation: on the spike export the sticky table header sits over the first link and intercepts a pointer click
      await page.keyboard.press("Enter");
      await page.waitForURL(new RegExp(`/indicator/[^/#]+#d=${domainId}$`));
    } finally {
      await o.context.close();
    }
  });

  test("AC-DB-07 without JavaScript the links work without a hash and the bar is not in the page", async (t) => {
    if (!browser) return t.skip(reason);
    const context = await browser.newContext({javaScriptEnabled: false});
    try {
      const page = await context.newPage();
      await page.goto(`${site.origin}/#f=A`);
      const nav = await page.$$eval(".mm-nav a[data-carry]", (a) => a.map((x) => x.getAttribute("href")));
      assert.ok(nav.length >= 3 && nav.every((h) => !h.includes("#")), "plain hrefs");
      await page.click('.mm-nav a[href*="domains"]');
      await page.waitForURL(/\/domains$/);
      await page.goto(`${site.origin}/`);
      assert.equal(await page.$("#filterbar"), null);
      const min = await page.$eval("#filterbar-slot", (el) => parseFloat(getComputedStyle(el).minHeight));
      assert.equal(min, 0, "no space is reserved when scripts cannot run");
    } finally {
      await context.close();
    }
  });
});
