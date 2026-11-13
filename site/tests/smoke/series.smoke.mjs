// R13 and R14 browser smoke of PG-SERIES defaults and hash (AC-RD-04 apply hash, AC-RD-31, AC-RD-34); R14 About table and units (AC-RD-32, 33, 42, 44, 45).
// Runs against a built site (npm run build). Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1 (CI). Localhost only.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {periodLabel} from "../../src/lib/period.js";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, markIndex, openPage, serve} from "./support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;
const READY = "#explorer-entities";

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
let domains = [];
let indicators = [];
let seriesMeta = [];
let manifest = null;
let entityList = [];
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
  domains = dataJson("meta/domains.json").domains;
  indicators = dataJson("meta/indicators.json").indicators;
  manifest = dataJson("manifest.json");
  entityList = dataJson("meta/entities.json").entities;
  seriesMeta = dataJson("meta/series.json").series;
});

after(async () => {
  await browser?.close();
  await site?.close();
});

async function withPage(t, hash, fn, {index = null} = {}) {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    if (index) await markIndex(context, index); // SYNTHETIC scale_hint = index (A1.5); see support.mjs
    await page.goto(`${site.origin}/explorer${hash}`);
    await page.waitForSelector(READY, {timeout: TIMEOUT});
    await page.waitForLoadState("networkidle");
    await fn({page, log});
    assert.deepEqual(log.errors, [], "page or console errors");
    assert.deepEqual(log.offOrigin, [], "off-origin requests");
  } finally {
    await context.close();
  }
}

const withFile = (id) => (manifest.files ?? []).some((f) => new RegExp(`^series/${id}\\.`).test(f.path));
// The first indicator (with a series file) of the first domain that has one: the C-SER-2 default.
const expectedDefault = () => domains.flatMap((d) => d.indicator_ids).find(withFile);
const nameOf = (id) => indicators.find((i) => i.indicator_id === id)?.name;
const checked = (page) => page.$$eval("#explorer-entities input:checked", (i) => i.map((x) => x.value));

describe("R13: PG-SERIES defaults and hash", () => {
  test("no hash: first indicator of the first domain, no country, the hint, no chart (AC-RD-31)", async (t) => {
    await withPage(t, "", async ({page}) => {
      assert.equal(await page.inputValue("#explorer-indicator"), expectedDefault());
      assert.deepEqual(await checked(page), []);
      assert.equal((await page.textContent("#explorer-entities-hint")).trim(), "Choose up to 5 countries to compare.");
      assert.equal(await page.locator("#explorer-hash-note").count(), 0, "no note for a clean default");
      assert.equal(await page.locator("#explorer-figure svg").count(), 0, "no overlay with no country");
    });
  });

  test("the picker shows names with the unit, grouped by domain, never an identifier alone", async (t) => {
    await withPage(t, "", async ({page}) => {
      const opts = await page.$$eval("#explorer-indicator option", (o) => o.map((x) => [x.value, x.textContent]));
      assert.ok(opts.length > 0);
      for (const [id, label] of opts) {
        assert.notEqual(label, id);
        const unit = indicators.find((i) => i.indicator_id === id)?.unit_label;
        assert.equal(label, unit ? `${nameOf(id)} (${unit})` : nameOf(id));
      }
      const groups = await page.$$eval("#explorer-indicator optgroup", (g) => g.map((x) => x.label));
      assert.deepEqual(groups.slice(0, 1), [domains.find((d) => d.indicator_ids.some(withFile))?.name]);
    });
  });

  test("#i and #c set the indicator and countries (AC-RD-04, AC-RD-34)", async (t) => {
    await withPage(t, "#i=M09&c=DEU,FRA", async ({page}) => {
      assert.equal(await page.inputValue("#explorer-indicator"), "M09");
      assert.deepEqual((await checked(page)).sort(), ["DEU", "FRA"]);
      assert.equal(await page.locator("#explorer-hash-note").count(), 0);
      assert.ok((await page.locator("#explorer-figure svg").count()) > 0, "a chart is drawn");
      const title = await page.textContent("#explorer-title");
      assert.ok(title.includes(nameOf("M09")));
    });
  });

  test("invalid #i and #c fall back to the default with a visible note and no error (AC-RD-34)", async (t) => {
    for (const hash of ["#i=NOPE&c=XXX", "#i=M09&c=DEU,XXX", "#bogus"]) {
      await withPage(t, hash, async ({page}) => {
        assert.equal(await page.locator("#explorer-hash-note").count(), 1, hash);
        assert.ok((await page.textContent("#explorer-hash-note")).includes("Part of this link was not recognised and was ignored."), hash);
        assert.equal(await page.locator("#explorer-norows-note").count(), 0, hash);
      });
    }
    await withPage(t, "#i=NOPE&c=DEU", async ({page}) => {
      assert.equal(await page.inputValue("#explorer-indicator"), expectedDefault());
    });
  });

  // A valid country with no series of the indicator in this export, if the export has one.
  const withoutRows = (indicatorId) => {
    const have = new Set(seriesMeta.filter((r) => r.indicator_id === indicatorId).map((r) => r.entity_id));
    return entityList.find((e) => !have.has(e.entity_id) && e.kind !== "aggregate" && e.entity_id);
  };

  test("a valid country without values in this export gets its own note, not the unrecognised-part note", async (t) => {
    const e = withoutRows("M09");
    if (!e) return t.skip("every entity of the fixture export has M09 rows");
    await withPage(t, `#i=M09&c=DEU,${e.entity_id}`, async ({page}) => {
      assert.equal(await page.locator("#explorer-hash-note").count(), 0);
      const note = (await page.textContent("#explorer-norows-note")).trim();
      assert.equal(note, `Not selected: this export has no values of this indicator for ${e.name}.`);
      assert.ok(!(await checked(page)).includes(e.entity_id));
    });
  });

  test("a change of indicator keeps the selected countries that have values (J3)", async (t) => {
    await withPage(t, "#i=M09&c=DEU", async ({page}) => {
      await page.selectOption("#explorer-indicator", "P01");
      await page.waitForFunction(() => /i=P01/.test(location.hash), null, {timeout: TIMEOUT});
      const has = seriesMeta.some((r) => r.indicator_id === "P01" && r.entity_id === "DEU");
      await page.waitForSelector("#explorer-entities", {timeout: TIMEOUT});
      assert.deepEqual(await checked(page), has ? ["DEU"] : []);
    });
  });

  test("a user change writes #i and #c with replaceState (picker order, no history entry); nothing is written on load", async (t) => {
    await withPage(t, "", async ({page}) => {
      assert.equal(await page.evaluate(() => location.hash), "", "clean URL on load");
      const len = await page.evaluate(() => history.length);
      await page.check('#explorer-entities input[value="FRA"]');
      await page.check('#explorer-entities input[value="DEU"]');
      const order = await page.$$eval("#explorer-entities input[type=checkbox]", (i) => i.map((x) => x.value).filter((v) => ["DEU", "FRA"].includes(v)));
      await page.waitForFunction((h) => location.hash === h, `#i=${expectedDefault()}&c=${order.join(",")}`, {timeout: TIMEOUT});
      assert.equal(await page.evaluate(() => history.length), len, "replaceState adds no history entry");
    });
  });

  test("the address is re-read on hashchange", async (t) => {
    await withPage(t, "#i=M09&c=DEU", async ({page}) => {
      await page.evaluate(() => { location.hash = "#i=M09&c=FRA"; });
      await page.waitForFunction(() => {
        const on = [...document.querySelectorAll("#explorer-entities input:checked")].map((x) => x.value);
        return on.length === 1 && on[0] === "FRA";
      }, null, {timeout: TIMEOUT});
    });
  });
});

describe("R14: About these series and units", () => {
  const HASH = "#i=M09&c=DEU,FRA";
  const metaOf = (indicator, entity) => seriesMeta.find((r) => r.indicator_id === indicator && r.entity_id === entity);
  const unitOf = (id) => indicators.find((i) => i.indicator_id === id)?.unit_label;

  test("the table lists every selected series with source link, attribution, frequency, unit, SA, price basis, last period, known_at (AC-RD-33)", async (t) => {
    await withPage(t, HASH, async ({page}) => {
      assert.equal((await page.textContent("#about-series h3")).trim(), "About these series");
      const heads = await page.$$eval("#series-captions thead th", (h) => h.map((x) => x.textContent.trim()));
      assert.deepEqual(heads, ["Country", "Source", "Attribution", "Frequency", "Unit", "Seasonal adjustment", "Price basis", "Last period", "Known at (last period)", "Re-estimation"]);
      const rows = await page.$$eval("#series-captions tbody tr", (trs) => trs.map((r) => ({entity: r.dataset.entity, cells: [...r.children].map((c) => c.textContent.trim()), href: r.querySelector("a")?.getAttribute("href") ?? null})));
      assert.deepEqual(rows.map((r) => r.entity).sort(), ["DEU", "FRA"]);
      for (const r of rows) {
        const m = metaOf("M09", r.entity);
        assert.ok(m, `no series.json row for ${r.entity}`);
        assert.equal(r.cells[1], m.source_name ?? "n/a");
        if (/^https?:\/\//.test(m.source_url ?? "")) assert.equal(r.href, new URL(m.source_url).href);
        assert.equal(r.cells[2], m.licence_attribution ?? "n/a");
        assert.equal(r.cells[3], m.frequency ?? "n/a");
        assert.ok(r.cells[4] !== "" && r.cells[4] !== "n/a", "unit text present");
        assert.equal(r.cells[5], m.seasonal_adjustment ?? "n/a");
        assert.equal(r.cells[6], m.price_basis ?? "n/a");
        assert.match(r.cells[7], /^\d{4}(-\d{2}(-\d{2})?| Q[1-4])?$/);
        assert.match(r.cells[8], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);
        assert.equal(r.cells[9], m.reestimating === true ? "re-estimated" : "");
      }
    });
  });

  test("the unit is in the title, the axis title, every end label and the View-as-table header (AC-RD-32, AC-RD-42)", async (t) => {
    await withPage(t, HASH, async ({page}) => {
      const unit = unitOf("M09");
      assert.ok(unit, "fixture indicator has a unit_label");
      assert.ok((await page.textContent("#explorer-title")).trim().endsWith(`(${unit})`));
      const texts = await page.$$eval("#explorer-figure svg text", (x) => x.map((n) => n.textContent.trim()));
      assert.ok(texts.some((x) => x.endsWith(unit) && !/^(Germany|France): /.test(x)), "axis title carries the unit (Plot may prefix an arrow)");
      const ends = texts.filter((s) => /^(Germany|France): /.test(s));
      assert.equal(ends.length, 2);
      for (const e of ends) assert.ok(e.includes(unit), `end label without unit: ${e}`);
      await page.click("#explorer-view-table summary");
      await page.waitForSelector("#explorer-view-table-table tbody tr", {state: "attached"}); // the rows are built on the first open (toggle event)
      assert.equal((await page.textContent("#explorer-view-table-table thead th.mm-num")).trim(), `Value (${unit})`);
    });
  });

  test("estimate and provisional values carry the e mark in the table; observed values do not (AC-RD-45)", async (t) => {
    await withPage(t, HASH, async ({page}) => {
      await page.click("#explorer-view-table summary");
      await page.waitForSelector("#explorer-view-table-table tbody tr", {state: "attached"}); // the rows are built on the first open (toggle event)
      const rows = await page.$$eval("#explorer-view-table-table tbody tr", (trs) => trs.map((r) => [r.children[2].textContent.trim(), r.children[3].textContent.trim()]));
      assert.ok(rows.length > 0);
      for (const [value, status] of rows) assert.equal(/ e$/.test(value), status === "EST" || status === "PROV", `${value} / ${status}`);
    });
  });

  test("A1.5: no rebase control and no base period on the series of this export (none is stored as an index)", async (t) => {
    await withPage(t, HASH, async ({page}) => {
      assert.equal(await page.locator("#explorer-rebase").count(), 0);
      assert.equal(await page.locator("#rebase-note").count(), 0);
      assert.equal(await page.locator("#explorer-base").count(), 0);
    });
  });

  test("rebased series use the index unit text everywhere (AC-RD-42), for an indicator with a synthetic scale_hint = index", async (t) => {
    await withPage(t, HASH, async ({page}) => {
      await page.check("#explorer-rebase");
      await page.waitForSelector("#rebase-note", {timeout: TIMEOUT});
      const title = (await page.textContent("#explorer-title")).trim();
      const m = /\((index, \d{4}-\d{2}-\d{2} = 100)\)$/.exec(title);
      assert.ok(m, title);
      const texts = await page.$$eval("#explorer-figure svg text", (x) => x.map((n) => n.textContent.trim()));
      assert.ok(texts.some((x) => x.endsWith(m[1]) && !/^(Germany|France): /.test(x)), "axis title is the index text");
      for (const c of await page.$$eval("#series-captions tbody tr", (r) => r.map((x) => x.children[4].textContent.trim()))) assert.equal(c, m[1]);
    }, {index: ["M09"]});
  });

  test("no forecast or projection element on the page (AC-RD-44)", async (t) => {
    await withPage(t, HASH, async ({page}) => {
      const text = await page.textContent("#explorer-main");
      assert.ok(!/forecast|projection|projected/i.test(text));
    });
  });
});

describe("R16: pointer tip and the \"Read a value\" point reader (AC-RD-30, 30b)", () => {
  // Screen position of the middle of the first drawn line.
  const onLine = (page) => page.evaluate(() => {
    const path = document.querySelector('#explorer-figure g[aria-label="line"] path');
    const pt = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM();
    return {x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f};
  });
  const tip = (page) => page.locator('#explorer-figure g[aria-label="tip"]:not(.mm-static-tip)').first();

  test("hover shows the tip; Escape hides it; the next pointer move restores it", async (t) => {
    await withPage(t, "#i=M09&c=DEU,FRA", async ({page}) => {
      const {x, y} = await onLine(page);
      await page.mouse.move(x - 4, y);
      await page.mouse.move(x, y);
      await page.waitForFunction(() => /Known at \d{4}-\d\d-\d\d/.test(document.querySelector('#explorer-figure g[aria-label="tip"]')?.textContent ?? ""), null, {timeout: TIMEOUT});
      assert.ok(await tip(page).isVisible());
      await page.keyboard.press("Escape");
      assert.ok(!(await tip(page).isVisible()), "Escape hides the pointer tip");
      await page.mouse.move(x + 2, y);
      assert.ok(await tip(page).isVisible(), "the next pointer move restores it");
    });
  });

  test("Escape hides the static highlight tip while focus is in the reader; ArrowLeft, a select change or re-entering focus brings it back; the output stays", async (t) => {
    await withPage(t, "#i=M09&c=DEU,FRA", async ({page}) => {
      const stat = page.locator("#explorer-figure g.mm-static-tip");
      await page.focus("#explorer-reader-period");
      await stat.waitFor({state: "visible", timeout: 3000}).catch(() => assert.fail("static tip shown on focus"));
      const text = await page.textContent("#explorer-reader-output");
      await page.keyboard.press("Escape");
      await stat.waitFor({state: "hidden", timeout: 3000}).catch(() => assert.fail("Escape hides the static tip"));
      assert.equal(await page.textContent("#explorer-reader-output"), text, "the output text stays");
      assert.ok(await page.locator("#explorer-reader-output").isVisible());
      await page.keyboard.press("ArrowLeft");
      await stat.waitFor({state: "visible", timeout: 3000}).catch(() => assert.fail("the next arrow restores it"));
      await page.keyboard.press("Escape");
      await stat.waitFor({state: "hidden", timeout: 3000}).catch(() => assert.fail("static tip hidden"));
      const other = await page.$$eval("#explorer-reader-country option", (os) => os.map((o) => o.value));
      await page.selectOption("#explorer-reader-country", other.find((v) => v !== other[0]) ?? other[0]);
      await stat.waitFor({state: "visible", timeout: 3000}).catch(() => assert.fail("a select change restores it"));
      await page.keyboard.press("Escape");
      await page.focus("#explorer-view-table summary");
      await page.focus("#explorer-reader-period");
      await stat.waitFor({state: "visible", timeout: 3000}).catch(() => assert.fail("re-entering focus restores it"));
    });
  });

  test("Tab reaches the reader; ArrowLeft changes the output to the previous period, equal to the table row; static highlight while focused", async (t) => {
    await withPage(t, "#i=M09&c=DEU,FRA", async ({page}) => {
      assert.equal(await page.locator("#explorer-figure [tabindex]").count(), 0, "no focusable descendant in the figure");
      assert.equal(await page.locator("#explorer-figure + #explorer-reader").count(), 1, "the reader follows the figure");
      assert.equal(await page.locator("#explorer-reader legend").textContent(), "Read a value");
      assert.equal(await page.locator("#explorer-reader-output").getAttribute("aria-live"), "polite");
      // Tab from the last control before the chart reaches the reader's select (the figure itself takes no focus).
      await page.focus("#explorer-view-table summary");
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "explorer-reader-period");
      assert.equal(await page.locator("#explorer-figure .mm-static-tip, #explorer-figure g.mm-static-tip").count(), 1, "static tip while focus is in the reader");
      const before = await page.textContent("#explorer-reader-output");
      await page.keyboard.press("ArrowLeft");
      const after = await page.textContent("#explorer-reader-output");
      assert.notEqual(after, before);
      const [name, period, ...rest] = after.split("; ");
      const value = rest[0];
      const ring = '#explorer-figure g[aria-label="dot"] circle[r="9"]';
      assert.equal(await page.locator(ring).count(), 1, "the highlight ring exists while the reader is focused");
      await page.evaluate(() => { document.querySelector("#explorer-view-table").open = true; });
      await page.waitForSelector("#explorer-view-table-table tbody tr", {state: "attached"}); // the rows are built on the first open (toggle event)
      const header = (await page.textContent("#explorer-view-table-table thead th.mm-num")).trim();
      const headerUnit = /^Value \((.*)\)$/.exec(header)?.[1] ?? null; // a uniform unit sits in the header, else in each cell
      const rows = await page.$$eval("#explorer-view-table-table tbody tr", (trs) => trs.map((r) => [r.dataset.entity, ...[...r.children].map((c) => c.textContent.trim())]));
      // The period is matched with the series' own frequency (series.json), never by trying several.
      const find = (label) => {
        const hit = rows.find((r) => r[1] === label.name && periodLabel(r[2], seriesMeta.find((m) => m.indicator_id === "M09" && m.entity_id === r[0])?.frequency) === label.period);
        return hit;
      };
      const row = find({name, period});
      assert.ok(row, `a table row for ${name} ${period}`);
      assert.equal(value, headerUnit ? `${row[3]} ${headerUnit}` : row[3], "the output value equals the table value cell (unit and estimate mark included)");
      await page.keyboard.press("Home");
      assert.notEqual(await page.textContent("#explorer-reader-output"), after);
      await page.keyboard.press("End");
      assert.equal(await page.textContent("#explorer-reader-output"), before, "End goes to the latest point");
      // Changing the country select updates the output (a different country's point) and keeps the highlight.
      const options = await page.$$eval("#explorer-reader-country option", (os) => os.map((o) => o.value));
      const current = await page.$eval("#explorer-reader-country", (e) => e.value);
      const other = options.find((v) => v !== current);
      assert.ok(other, "a second country is selectable");
      await page.selectOption("#explorer-reader-country", other);
      const switched = await page.textContent("#explorer-reader-output");
      assert.notEqual(switched, before, "the country select updates the output");
      assert.equal(switched.split("; ")[0], await page.$eval(`#explorer-reader-country option[value="${other}"]`, (o) => o.textContent.trim()));
      assert.equal(await page.locator(ring).count(), 1, "the ring follows the selection");
      // Focus leaves the reader: the static tip and the ring are removed.
      await page.focus("#explorer-view-table summary");
      assert.equal(await page.locator("#explorer-figure .mm-static-tip").count(), 0, "static tip removed on focusout");
      assert.equal(await page.locator(ring).count(), 0, "highlight ring removed on focusout");
    });
  });
});

describe("L20: Lines / Bars toggle of PG-SERIES (AC-DB-28)", () => {
  test("shown with exactly one country only; Bars equal the table rows; the address does not change", async (t) => {
    await withPage(t, "#i=M09&c=DEU", async ({page}) => {
      assert.equal(await page.locator('input[name="explorer-chart-mode"]').count(), 2);
      await page.locator("#explorer-view-table summary").click();
      await page.waitForSelector("#explorer-view-table-table tbody tr", {timeout: TIMEOUT});
      const rows = await page.locator("#explorer-view-table-table tbody tr").count();
      const hash = await page.evaluate(() => location.hash);
      await page.locator('input[name="explorer-chart-mode"][value="bars"]').check();
      await page.waitForSelector('#explorer-figure [aria-label="bar"] rect', {timeout: TIMEOUT});
      assert.equal(await page.locator('#explorer-figure [aria-label="bar"] rect').count(), rows, "one bar per table row");
      assert.equal(await page.evaluate(() => location.hash), hash, "chart type is not in the address");
    });
  });
  test("hidden with two countries", async (t) => {
    await withPage(t, "#i=M09&c=DEU,FRA", async ({page}) => {
      assert.equal(await page.locator('input[name="explorer-chart-mode"]').count(), 0);
    });
  });
});

describe("L21: PG-SERIES filter bar (AC-DB-01, 02, 03; AC-RD-31, 34)", () => {
  const hashOf = (page) => page.evaluate(() => location.hash);
  test("the bar has Domain, Period and Frequency (named) and no Group, Country or Indicator; the rail controls stay", async (t) => {
    await withPage(t, "#i=M09&c=DEU", async ({page}) => {
      const bar = page.locator('form[role="group"][aria-label="Filters"]');
      assert.equal(await bar.count(), 1);
      assert.equal(await bar.locator("#filter-domain").count(), 1);
      assert.equal(await bar.locator("#filter-frequency").count(), 1);
      assert.equal(await bar.locator("#filter-period").count(), 1);
      for (const id of ["#filter-group", "#filter-indicator", "#filter-country"]) assert.equal(await bar.locator(id).count(), 0, id);
      assert.equal(await bar.locator("label", {hasText: "Domain"}).count(), 1);
      for (const id of ["#explorer-indicator", "#explorer-from", "#explorer-to", "#explorer-entities", "#explorer-transform"]) assert.equal(await page.locator(id).count(), 1, id);
    });
  });
  test("Domain narrows the rail picker; a selected indicator that falls out moves to the first offered one; the address is replaced, not pushed", async (t) => {
    await withPage(t, "#i=M09&c=DEU", async ({page}) => {
      const len = await page.evaluate(() => history.length);
      const all = await page.$$eval("#explorer-indicator option", (o) => o.length);
      await page.selectOption("#filter-domain", "prices");
      await page.waitForFunction(() => document.querySelector("#explorer-indicator").value === "P01", null, {timeout: TIMEOUT});
      const offered = await page.$$eval("#explorer-indicator option", (o) => o.map((x) => x.value));
      assert.ok(offered.length < all && offered.every((id) => indicators.find((i) => i.indicator_id === id)?.domain_ids?.includes("prices")), `offered ${offered}`);
      await page.waitForFunction(() => location.hash.includes("i=P01"), null, {timeout: TIMEOUT});
      const h = await hashOf(page);
      assert.match(h, /^#i=P01&c=DEU&d=prices$|^#i=P01&d=prices$/, h);
      assert.equal(await page.evaluate(() => history.length), len, "history.length unchanged");
      await page.locator("#filter-reset").click();
      await page.waitForFunction(() => document.querySelector("#explorer-indicator").options.length > 1, null, {timeout: TIMEOUT});
      assert.equal(await page.inputValue("#explorer-indicator"), "P01", "Reset clears the filters, not the selected indicator");
      assert.doesNotMatch(await hashOf(page), /d=/);
    });
  });
  test("one state: the Period chip and the rail years show and write the same range; the chart is clipped by it", async (t) => {
    await withPage(t, "#i=M09&c=DEU&g=advanced", async ({page}) => {
      const first = await page.$$eval("#explorer-from option", (o) => o.map((x) => x.value).filter(Boolean));
      const [y1, y2] = [first.at(-2), first.at(-1)];
      await page.locator("#filter-period-summary").click();
      await page.selectOption("#filter-period-from", y1);
      await page.selectOption("#filter-period-to", y2);
      await page.waitForFunction(([a, b]) => document.querySelector("#explorer-from").value === a && document.querySelector("#explorer-to").value === b, [y1, y2], {timeout: TIMEOUT});
      assert.match(await hashOf(page), new RegExp(`&from=${y1}&to=${y2}$`), "g is ignored and never written");
      assert.doesNotMatch(await hashOf(page), /g=/);
      await page.locator("#explorer-view-table summary").click();
      await page.waitForSelector("#explorer-view-table-table tbody tr", {state: "attached"});
      const years = await page.$$eval("#explorer-view-table-table tbody tr td:nth-child(2), #explorer-view-table-table tbody tr th:nth-child(2)", (c) => [...new Set(c.map((x) => x.textContent.trim().slice(0, 4)))]);
      assert.ok(years.length > 0 && years.every((y) => y >= y1 && y <= y2), `table years ${years} inside ${y1}..${y2}`);
      // The rail writes the chip.
      await page.selectOption("#explorer-from", y2);
      await page.waitForFunction((y) => document.querySelector("#filter-period-summary").textContent.includes(`${y} to`), y2, {timeout: TIMEOUT});
      assert.match(await hashOf(page), new RegExp(`from=${y2}&to=${y2}$`));
    });
  });
  test("a range in the address is shown by both controls and nothing is written on load; hashchange re-reads it", async (t) => {
    await withPage(t, "#i=M09&c=DEU&from=2024&to=2025", async ({page}) => {
      assert.equal(await page.inputValue("#explorer-from"), "2024");
      assert.equal(await page.inputValue("#explorer-to"), "2025");
      assert.match(await page.textContent("#filter-period-summary"), /2024 to 2025/);
      assert.equal(await hashOf(page), "#i=M09&c=DEU&from=2024&to=2025");
      await page.evaluate(() => { location.hash = "#i=M09&c=DEU&from=2025&to=2025"; });
      await page.waitForFunction(() => document.querySelector("#explorer-from").value === "2025", null, {timeout: TIMEOUT});
      assert.match(await page.textContent("#filter-period-summary"), /2025 to 2025/);
    });
  });
  test("from greater than to in the address: both ignored, with the fallback note", async (t) => {
    await withPage(t, "#i=M09&c=DEU&from=2025&to=2024", async ({page}) => {
      assert.equal(await page.inputValue("#explorer-from"), "");
      assert.equal(await page.locator("#explorer-hash-note").count(), 1);
    });
  });
});

// V13 (A1.5, AC-V2-73 amended): the rebase toggle and the base-period select are absent on PG-SERIES unless stored metadata says scale_hint = index (CR-18), also for an index series with a
// stored base_period and a unit_label that reads index. (The older rebase smoke tests above assume an active control; see the report of the Group C run.)
describe("V13 A1.5: no rebase control on PG-SERIES", () => {
  test("absent for a level series and for an index series", async (t) => {
    if (!browser) return t.skip(reason);
    const ids = ["M09", "P01"].filter((id) => indicators.some((i) => i.indicator_id === id) && withFile(id));
    if (ids.length === 0) return t.skip("no M09 or P01 series file in this export");
    for (const ind of ids) {
      await withPage(t, `#i=${ind}`, async ({page}) => {
        assert.equal(await page.locator("#explorer-rebase, #explorer-base").count(), 0, `${ind}: no rebase control`);
        assert.doesNotMatch(await page.locator("#explorer-main").innerText(), /rebased|rebase/i);
      });
    }
  });
});
