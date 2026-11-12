// Redesign R10 browser smoke of PG-INDICATOR (AC-RD-20, 21, 22, 23, 25, 40, 42, 45, 54 indicator part, 62 indicator part), retargeted at the
// L23 arrangement (layout amendment 4.3): Group and the indicator switcher are in the filter bar (#filter-group, #filter-indicator + Go), the sort is
// in the header of the C-RANK card (#rank-sort, ".mm-rank-table") and the Table band (#indicator-table) follows it.
// Runs against a built site (npm run build). States and the sort/filter checks that need rows with and without values, estimates and
// all the state kinds need the SYNTHETIC sparse fixture (tests/fixtures/sparse_export, entities SY01..SY41, SYA1..SYA3, indicators T01..T05);
// on another export those tests skip and the generic ones still run. The download link needs a series file, so that test needs an
// export that has one (the CI site fixture) and skips on the sparse fixture. Localhost only; off-origin requests abort.
// Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1 (CI).
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {FILTER_NOTE} from "../../src/lib/copy.js";
import {formatValue} from "../../src/lib/scorecard.js";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";
import {horizontalOverflow, setViewport} from "./ux-support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;
const READY = ".mm-indicator-table tbody tr";
const PCT_LABEL = "percentile vs all ranked countries";

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
let entities = [];
let domains = [];
let indicators = [];
let groups = [];
let manifest = null;
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
  indicators = dataJson("meta/indicators.json").indicators;
  groups = dataJson("meta/groups.json").groups;
  manifest = dataJson("manifest.json");
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
const nameOf = (id) => entities.find((e) => e.entity_id === id)?.name ?? id;
const asc = (a, b) => nameOf(a.entity_id).localeCompare(nameOf(b.entity_id), "en");

// The stored cells of one indicator in the scorecard of its first domain (spec section 3).
function stored(indicatorId) {
  const ind = indicators.find((i) => i.indicator_id === indicatorId);
  const sc = dataJson(`scorecard/${ind.domain_ids[0]}.json`);
  const cells = sc.entities.map((e) => ({entity_id: e.entity_id, ...(e.indicators.find((c) => c.indicator_id === indicatorId) ?? {indicator_id: indicatorId, value: null})}));
  return {ind, sc, cells, withValue: cells.filter((c) => c.value !== null && c.published !== false && c.publish_scope !== "excluded")};
}
const firstIndicator = () => indicators.find((i) => stored(i.indicator_id).withValue.length >= 2) ?? indicators[0];

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

const shownOrder = (page, group = "with-value") => page.$$eval(`tbody[data-group="${group}"] tr[data-entity]`, (rows) => rows.map((r) => r.getAttribute("data-entity")));

describe("R10 PG-INDICATOR", () => {
  test("AC-RD-20, 25, 62: one row per entity of the scorecard, header facts, caveat once, orientation at most once, one nav, no Guide/Status link", async (t) => {
    const id = firstIndicator().indicator_id;
    await withPage(t, `/indicator/${id}`, async ({page, log}) => {
      const s = stored(id);
      assert.equal(await page.locator("#indicator-table tr[data-entity]").count(), s.sc.entities.length);
      for (const e of s.sc.entities) assert.equal(await page.locator(`#indicator-table tr[data-entity="${e.entity_id}"]`).count(), 1, e.entity_id);
      assert.equal(await page.locator('tbody[data-group="with-value"] tr[data-entity]').count(), s.withValue.length);
      assert.equal(await page.locator('tbody[data-group="without-value"] tr[data-entity]').count(), s.cells.length - s.withValue.length);
      assert.equal(await page.locator("h1").getAttribute("data-indicator"), id);
      assert.equal(await page.locator("h1").innerText(), s.ind.name);
      assert.ok((await page.locator(".mm-indicator-facts").innerText()).includes(s.ind.unit_label), "the unit is in the header");
      assert.equal(await page.locator(".mm-caveat").count(), 1);
      assert.ok((await page.locator(".mm-orientation").count()) <= 1);
      assert.equal(await page.locator("nav").count(), 1, "exactly one nav");
      assert.equal(await page.locator('a[href*="guide" i], a[href*="status" i]:not(.mm-nav a)').count(), 0);
      clean(log);
    });
  });

  test("AC-RD-21: the stored reference-period spread and common period are printed above the table; an unranked indicator says so", async (t) => {
    for (const ind of indicators) {
      const a = stored(ind.indicator_id).sc.alignment?.find((x) => x.indicator_id === ind.indicator_id) ?? null;
      const spread = a?.reference_period_spread_days ?? null;
      const common = a?.rank_reference_period ?? null;
      await withPage(t, `/indicator/${ind.indicator_id}`, async ({page}) => {
        const line = (await page.locator("#reference-spread").innerText()).trim();
        if (spread === null && common === null) assert.match(line, /^No ranking for this indicator/);
        else {
          if (spread !== null) assert.ok(line.includes(`spread of the ranked set: ${spread} days`), line);
          if (common !== null) assert.ok(line.includes(`common reference period of the ranking ${common}`), line);
        }
        const above = await page.evaluate(() => Boolean(document.querySelector("#reference-spread").compareDocumentPosition(document.querySelector("#indicator-table")) & Node.DOCUMENT_POSITION_FOLLOWING));
        assert.equal(above, true, "the line comes before the table");
      });
    }
  });

  test("AC-RD-23: the filter note is verbatim, the percentile header is the stored label, the group control (in the filter bar) only filters", async (t) => {
    const id = firstIndicator().indicator_id;
    await withPage(t, `/indicator/${id}`, async ({page}) => {
      assert.equal((await page.locator("#filter-note").innerText()).trim(), FILTER_NOTE);
      assert.ok((await page.locator("#indicator-table thead th").allInnerTexts()).includes(PCT_LABEL));
      const group = groups.find((g) => g.members.length > 0 && g.members.length < entities.length);
      if (!group) return;
      const read = () => page.$$eval("#indicator-table tr[data-entity]", (rs) => rs.map((r) => [r.getAttribute("data-entity"), r.querySelector("td.mm-pct")?.textContent ?? r.querySelector("td.mm-reason")?.textContent ?? ""]));
      const before = new Map(await read());
      await page.selectOption("#filter-group", group.group_id);
      const members = new Set(group.members.map((m) => m.entity_id));
      for (const [ent, pct] of await read()) {
        assert.ok(members.has(ent), `${ent} is in the group`);
        assert.equal(pct, before.get(ent), `${ent}: the percentile is the stored one, not recomputed within the group`);
      }
      await page.selectOption("#filter-group", "");
      assert.equal(await page.locator("#indicator-table tr[data-entity]").count(), before.size);
    });
  });

  test("decisions 3.5: the Group select writes #g (keeping #c) with replaceState, and a hashchange reads g and the focus", async (t) => {
    const id = firstIndicator().indicator_id;
    const group = groups.find((g) => g.members.length > 0 && g.members.length < entities.length);
    if (!group) return;
    await withPage(t, `/indicator/${id}`, async ({page}) => {
      const total = await page.locator("#indicator-table tr[data-entity]").count();
      const length = await page.evaluate(() => history.length);
      await page.selectOption("#filter-group", group.group_id);
      assert.equal(await page.evaluate(() => location.hash), `#g=${group.group_id}`);
      assert.equal(await page.evaluate(() => history.length), length, "replaceState: no history entry");
      // #c is kept: choose a country in the reader, then the group again.
      const member = group.members[0].entity_id;
      const options = await page.$$eval("#rank-reader-country option", (os) => os.map((o) => o.value));
      if (options.includes(member)) {
        await page.selectOption("#rank-reader-country", member);
        await page.waitForFunction((v) => location.hash.includes(`c=${v}`), member, {timeout: TIMEOUT});
        const hash = await page.evaluate(() => location.hash);
        assert.ok(hash.includes(`c=${member}`) && hash.includes(`g=${group.group_id}`), `both keys are kept: ${hash}`);
      }
      // hashchange reads g: back to "all" via the address, the radio and the rows follow.
      await page.evaluate(() => { location.hash = "#g="; });
      await page.waitForFunction((n) => document.querySelectorAll("#indicator-table tr[data-entity]").length === n, total, {timeout: TIMEOUT});
      assert.equal(await page.inputValue("#filter-group"), "");
      await page.evaluate((g) => { location.hash = `#g=${g}`; }, group.group_id);
      await page.waitForFunction((g) => document.querySelector("#filter-group")?.value === g, group.group_id, {timeout: TIMEOUT});
      assert.ok((await page.locator("#indicator-table tr[data-entity]").count()) <= group.members.length);
    });
  });

  test("AC-RD-22: each sort orders the rows by the stored field, nulls last, ties by name; aria-sort follows; no rank is shown", async (t) => {
    const id = isSparse() ? "T02" : firstIndicator().indicator_id;
    await withPage(t, `/indicator/${id}`, async ({page}) => {
      const s = stored(id);
      const cmp = (field, dir) => (a, b) => {
        const x = a[field] ?? null;
        const y = b[field] ?? null;
        if ((x === null) !== (y === null)) return x === null ? 1 : -1;
        if (x !== null && x !== y) return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
        return asc(a, b);
      };
      const expected = (field, dir) => [...s.withValue].sort(cmp(field, dir)).map((c) => c.entity_id);
      assert.deepEqual(await shownOrder(page), [...s.withValue].sort(asc).map((c) => c.entity_id), "default: Country A-Z");
      assert.equal(await page.getAttribute("#indicator-table thead th:first-child", "aria-sort"), "ascending");
      for (const [option, field, dir] of [["value", "value", "desc"], ["percentile", "percentile", "desc"], ["period", "ref_period_end", "desc"], ["name", "entity_id", "asc"]]) {
        await page.selectOption("#rank-sort", option);
        const want = field === "entity_id" ? [...s.withValue].sort(asc).map((c) => c.entity_id) : expected(field, dir);
        assert.deepEqual(await shownOrder(page), want, option);
        assert.deepEqual(await page.$$eval('.mm-rank-table tbody[data-group="countries"] tr[data-has-value="true"]', (rows) => rows.map((r) => r.getAttribute("data-entity")).filter((e) => !e.startsWith("SYA"))), want.filter((e) => !e.startsWith("SYA")), `${option}: the C-RANK card orders the same`);
        const sorted = await page.$$eval("#indicator-table th[aria-sort]", (ths) => ths.filter((x) => x.getAttribute("aria-sort") !== "none").map((x) => x.getAttribute("aria-sort")));
        assert.deepEqual(sorted, [dir === "asc" ? "ascending" : "descending"], `${option}: exactly one active aria-sort`);
      }
      assert.doesNotMatch(await page.locator("main").innerText(), /\brank(ed)? #?\d+|\bposition \d+/i);
    }, {sparse: true});
  });

  test("AC-RD-42, 25: values carry unit and period; the value chart draws one bar per entity with a value and an axis title with name and unit", async (t) => {
    const id = firstIndicator().indicator_id;
    await withPage(t, `/indicator/${id}`, async ({page, log}) => {
      const s = stored(id);
      for (const c of s.withValue) {
        const tr = page.locator(`#indicator-table tr[data-entity="${c.entity_id}"]`);
        assert.equal((await tr.locator("td.mm-num .mm-fig").first().innerText()).trim(), formatValue(c.value), `${c.entity_id}: shown vs stored`);
        assert.equal((await tr.locator(".mm-unit").first().innerText()).trim(), s.ind.unit_label, `${c.entity_id}: unit`);
        if (typeof c.percentile === "number" && c.alignment !== "lagging" && c.alignment !== "unaligned" && c.is_stale !== true && c.inherited !== true) {
          assert.equal(await tr.locator("td.mm-pct .mm-fig").innerText(), c.percentile.toFixed(2));
        }
      }
      // The value chart is the bar column of the C-RANK card (a span with the stored value, unit and period in its title); one per entity with a value.
      const bars = page.locator(".mm-rank-table .mm-rank-bar-wrap");
      assert.equal(await bars.count(), s.withValue.length, "one bar per entity with a stored value");
      const title = await bars.first().getAttribute("title");
      assert.ok(title.includes(s.ind.unit_label), `the bar carries the unit "${s.ind.unit_label}": ${title}`);
      assert.ok(s.withValue.some((c) => title.includes(formatValue(c.value))), `the bar carries a stored value: ${title}`);
      clean(log);
    });
  });

  test("AC-RD-22: bar order follows the sort select", async (t) => {
    await withPage(t, "/indicator/T02", async ({page}) => {
      for (const option of ["value", "name"]) {
        await page.selectOption("#rank-sort", option);
        const order = await shownOrder(page);
        const bars = await page.$$eval('.mm-rank-table tbody[data-group="countries"] tr[data-has-value="true"]', (rows) => rows.filter((r) => r.querySelector(".mm-rank-bar-wrap")).map((r) => r.getAttribute("data-entity")));
        assert.deepEqual(bars, order.filter((e) => bars.includes(e)), `${option}: bars are drawn in table order`);
      }
    }, {sparse: true});
  });

  test("the V2 dot plot is kept: role=img, one dot per shown percentile", async (t) => {
    await withPage(t, "/indicator/T02", async ({page}) => {
      const fig = page.locator("#indicator-dot-figure");
      assert.equal(await fig.getAttribute("role"), "img");
      const shown = await page.locator('#indicator-table tr[data-has-value="true"] td.mm-pct[data-bin]:not([data-bin="none"])').count();
      assert.ok(shown > 0);
      assert.equal(await fig.locator("circle").count(), shown, "one dot per percentile shown in the table");
    }, {sparse: true});
    await withPage(t, "/indicator/T05", async ({page}) => {
      assert.equal(await page.locator("#indicator-dot-figure").count(), 0, "an unranked domain draws no percentile chart");
    }, {sparse: true});
  });

  test("AC-RD-45: an estimate has the hollow marker and e in the table and an e on the bar", async (t) => {
    await withPage(t, "/indicator/T02", async ({page}) => {
      const mark = page.locator('#indicator-table tr[data-entity="SY01"] [data-mark=estimate]');
      assert.equal(await mark.count(), 1);
      assert.ok((await mark.innerText()).includes("e"));
      assert.equal(await mark.locator(".mm-hollow").count(), 1);
      assert.ok((await page.locator('.mm-rank-table tr[data-entity="SY01"] .mm-rank-bar-wrap').getAttribute("title")).includes(" e "), "an e in the bar title");
    }, {sparse: true});
  });

  describe("AC-RD-40: every state of spec 5.1 renders its code, signature and sentence", () => {
    // [entity, indicator, state key, code, sentence fragment]
    const CASES = [
      ["SY01", "T02", "ranked", null, null],
      ["SY06", "T02", "ahead", "ahead", "ranked at its latest value"],
      ["SY02", "T02", "inherited", "inherited from the euro area", "not ranked (inherited)"],
      ["SY03", "T02", "stale", "stale", "stale: no rank"],
      ["SY04", "T02", "lagging", "lagging", "not ranked (lagging)"],
      ["SY05", "T02", "unaligned", "unaligned", "not ranked (unaligned)"],
      ["SY07", "T04", "na", "n/a", "A series is defined for this country, but this export holds no value for it."],
      ["SY08", "T04", "na", "n/a", "This export lists no series for this country and indicator."],
      ["SY09", "T02", "not_published", "np", "Not published on this site."]
    ];
    const shots = new Map();
    const sigs = new Map();
    for (const [ent, ind, key, code, sentence] of CASES) {
      test(`${key}: ${ent} ${ind}`, async (t) => {
        await withPage(t, `/indicator/${ind}`, async ({page}) => {
          await page.addStyleTag({content: "html { filter: grayscale(1); }"});
          const tr = page.locator(`#indicator-table tr[data-entity="${ent}"]`);
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
  });

  test("C-IND-6: Open as time series preselects the country in focus, else the first five A-Z, whatever the sort", async (t) => {
    await withPage(t, "/indicator/T02", async ({page}) => {
      const href = () => page.getAttribute("#open-series", "href");
      assert.equal(await href(), "../explorer#i=T02&c=SY01,SY02,SY03,SY04,SY05");
      for (const option of ["value", "percentile", "period"]) {
        await page.selectOption("#rank-sort", option);
        assert.equal(await href(), "../explorer#i=T02&c=SY01,SY02,SY03,SY04,SY05", `${option}: never chosen by value or percentile`);
      }
    }, {sparse: true});
    await withPage(t, "/indicator/T02#c=SY06", async ({page}) => {
      assert.equal(await page.getAttribute("#open-series", "href"), "../explorer#i=T02&c=SY06");
      assert.equal(await page.locator('#indicator-table tr[data-entity="SY06"]').getAttribute("data-focus"), "true");
    }, {sparse: true});
  });

  test("C-IND-5: country names link to PG-COUNTRY and each value row links to PG-SERIES with #i= and #c=", async (t) => {
    const id = firstIndicator().indicator_id;
    await withPage(t, `/indicator/${id}`, async ({page}) => {
      const c = stored(id).withValue.find((x) => !entities.find((e) => e.entity_id === x.entity_id)?.is_global);
      const tr = page.locator(`#indicator-table tr[data-entity="${c.entity_id}"]`);
      assert.equal(await tr.locator("a[data-link=country]").getAttribute("href"), `../country/${c.entity_id}`);
      assert.equal(await tr.locator("a[data-link=series]").getAttribute("href"), `../explorer#i=${id}&c=${c.entity_id}`);
      assert.equal(await page.locator(`details.mm-about[data-for="${id}"][id^="about-"]`).count(), stored(id).withValue.length, "About this value per value row");
      const d = page.locator(`#about-${id}-${c.entity_id}`);
      await d.locator("summary").click();
      assert.ok((await d.innerText()).includes(nameOf(c.entity_id)));
    });
  });

  test("C-IND-7: the data file link resolves to the served series file of this indicator", async (t) => {
    const hasSeries = (id) => (manifest?.files ?? []).some((f) => f.path.startsWith(`series/${id}.`));
    const ind = indicators.find((i) => hasSeries(i.indicator_id));
    if (!ind) return t.skip("this export has no series file");
    await withPage(t, `/indicator/${ind.indicator_id}`, async ({page, log}) => {
      const link = page.locator("#indicator-download");
      const href = await link.getAttribute("href");
      assert.ok(href && href.includes(ind.indicator_id), href);
      const res = await page.request.get(new URL(href, page.url()).toString());
      assert.equal(res.status(), 200);
      assert.equal(log.requests.filter((u) => /\.parquet/.test(u) && !u.includes(ind.indicator_id)).length, 0, "no other series file is requested");
    });
    const other = indicators.find((i) => !hasSeries(i.indicator_id));
    if (other) await withPage(t, `/indicator/${other.indicator_id}`, async ({page}) => assert.equal(await page.locator("#indicator-download").count(), 0));
  });

  test("indicator switcher: choosing an option does not navigate (WCAG 3.2.2); the Go button and Enter do", async (t) => {
    const start = firstIndicator().indicator_id;
    await withPage(t, `/indicator/${start}`, async ({page}) => {
      const target = indicators.at(-1).indicator_id;
      const other = indicators.at(-2).indicator_id;
      const url = page.url();
      await page.selectOption("#filter-indicator", target);
      await page.waitForTimeout(500);
      assert.equal(page.url(), url, "selecting an option does not navigate");
      await page.focus("#indicator-switcher-go");
      await Promise.all([page.waitForURL(`**/indicator/${target}`), page.keyboard.press("Enter")]);
      await page.waitForSelector(READY, {timeout: TIMEOUT});
      assert.equal(await page.locator("h1").getAttribute("data-indicator"), target);
      await page.selectOption("#filter-indicator", other);
      await page.focus("#filter-indicator");
      await Promise.all([page.waitForURL(`**/indicator/${other}`), page.keyboard.press("Enter")]);
      await page.waitForSelector(READY, {timeout: TIMEOUT});
      assert.equal(await page.locator("h1").getAttribute("data-indicator"), other);
    });
  });

  test("AC-RD-54: at 320 px the page does not overflow and the table becomes cards with labelled cells", async (t) => {
    await withPage(t, `/indicator/${isSparse() ? "T02" : firstIndicator().indicator_id}`, async ({page, log}) => {
      const o = await horizontalOverflow(page);
      assert.deepEqual(o.offenders, [], `page overflow ${o.scrollW} > ${o.vw}`);
      const info = await page.evaluate(() => {
        const head = document.querySelector("#indicator-table thead");
        const td = document.querySelector('#indicator-table tbody[data-group="with-value"] td[data-label]');
        return {headHidden: head.getBoundingClientRect().width <= 1, tdDisplay: getComputedStyle(td).display, label: getComputedStyle(td, "::before").content, tableDisplay: getComputedStyle(document.querySelector("#indicator-table")).display};
      });
      assert.equal(info.headHidden, true, "the header row is visually removed in card mode");
      assert.equal(info.tdDisplay, "grid");
      assert.notEqual(info.label, "none");
      assert.equal(info.tableDisplay, "block");
      clean(log);
    }, {width: 320});
  });

  test("AC-RD-54: at 1280 px the table keeps a sticky header inside a keyboard-reachable scroll container", async (t) => {
    await withPage(t, `/indicator/${isSparse() ? "T02" : firstIndicator().indicator_id}`, async ({page}) => {
      const info = await page.evaluate(() => {
        const box = document.querySelector(".mm-ind-scroll");
        const th = document.querySelector("#indicator-table thead th");
        return {tab: box.getAttribute("tabindex"), sticky: getComputedStyle(th).position, overflow: getComputedStyle(box).overflowX};
      });
      assert.equal(info.tab, "0");
      assert.equal(info.sticky, "sticky");
      assert.equal(info.overflow, "auto");
    }, {width: 1280});
  });
});

describe("R16 PG-INDICATOR point reader (AC-RD-30), on the C-RANK card", () => {
  test("the reader select is the country in focus and reads value; period; the output element and the focus are kept", async (t) => {
    await withPage(t, "/indicator/T02", async ({page}) => {
      assert.equal(await page.locator("#rank-reader legend").count(), 1);
      const id = await page.$eval("#rank-reader-country option:nth-child(2)", (o) => o.value);
      await page.$eval("#rank-reader-output", (o) => { o.dataset.kept = "yes"; });
      await page.focus("#rank-reader-country");
      await page.selectOption("#rank-reader-country", id);
      await page.waitForFunction((v) => location.hash.includes(v), id, {timeout: TIMEOUT});
      assert.equal(await page.$eval("#rank-reader-output", (o) => o.dataset.kept), "yes", "the live <output> is not rebuilt");
      assert.equal(await page.evaluate(() => document.activeElement.id), "rank-reader-country", "focus stays on the select");
      assert.equal(await page.locator(`#indicator-table tr[data-entity="${id}"]`).getAttribute("data-focus"), "true", "the table row of the country in focus is marked");
      const text = await page.textContent("#rank-reader-output");
      assert.ok(text.includes(nameOf(id)), text);
      const cell = await page.locator(`#indicator-table tr[data-entity="${id}"] td.mm-num`).first().evaluate((td) => {
        const c = td.cloneNode(true);
        for (const h of c.querySelectorAll(".mm-visually-hidden")) h.remove();
        return c.textContent.replace(/\s+/g, " ").trim();
      });
      assert.ok(text.replace(/\s+/g, " ").includes(cell), `the reader carries the table value cell "${cell}": ${text}`);
    }, {sparse: true});
  });
});
