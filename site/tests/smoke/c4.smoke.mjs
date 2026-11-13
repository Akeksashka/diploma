// V21 browser smoke of C4, the heatmap of one indicator, countries by period, on PG-COMPARE and PG-INDICATOR: AC-V2-46, 47, 48, 49, 50, 80, 81, 82, 84, 85, spec 4 C4, 7, A1.1 (stale rows and `stl`), A1.4 (hidden rows).
// Runs against a built site over the SYNTHETIC v2 fixture (tests/fixtures/v2_export): M09 monthly (28 countries; stale FRA and ITA; ESP has missing months), A04 annual (stale ROU and BGR), Q08 quarterly (crosses zero),
// V06 with two stored frequencies. Expectations are computed from the built stored files with the spec's rules. Localhost only; off-origin requests abort. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {after, before, describe, test} from "node:test";
import {DRAFT_BLOCKED_MESSAGE, DRAFT_C4_MARKS, DRAFT_C4_OUTLINE_MARK, DRAFT_COMPARE_CHOOSE_INDICATOR, DRAFT_NO_ALIGNED, DRAFT_STALE_CODE, DRAFT_STALE_PERIOD} from "../../src/lib/copy.js";
import {periodLabel} from "../../src/lib/period.js";
import {TIMEOUT, assertDisclosure, cleanLog, harness, hiddenOf, overrideScorecard, overrideSeriesMeta, tickLabels, valueText} from "./compare-support.mjs";

const h = harness();
before(h.before);
after(h.after);

const READY = "#c4-figure svg";
const CAPS = {A: 35, Q: 40, M: 36, D: 36};
const yearOf = (end) => Number(end.slice(0, 4));

// The spec's selection for C4 computed from the stored series and scorecard files: columns = the stored periods of ONE frequency inside the window (newest `cap` kept), rows = countries with at least
// one stored value in those columns; a stale row (stored is_stale of the scorecard cell) is hidden unless stl; a country with no value is hidden as no data.
function expectC4(id, {f = null, stl = false, from = null, to = null} = {}) {
  const ind = h.indicator(id);
  const freq = f && ind.frequency_set.includes(f) ? f : ind.frequency_set[0];
  const inWindow = (end) => from === null || to === null || (yearOf(end) >= from && yearOf(end) <= to);
  const own = new Map(h.countries().map((e) => [e.entity_id, h.values(id, e.entity_id, freq)]));
  const ends = [...new Set([...own.values()].flatMap((m) => [...m.keys()].filter(inWindow)))].sort();
  const columns = ends.slice(-CAPS[freq]);
  const items = h.countries().map((e) => {
    const vals = columns.map((end) => own.get(e.entity_id).get(end) ?? null);
    const filled = vals.filter((v) => v !== null);
    return {id: e.entity_id, name: e.name, vals, filled: filled.length, latest: filled.at(-1) ?? null, has: filled.length > 0, stale: h.cell(id, e.entity_id)?.is_stale === true};
  });
  const drawn = items.filter((r) => r.has && (stl || !r.stale));
  const hidden = items.filter((r) => !(r.has && (stl || !r.stale))).map((r) => ({...r, reason: !r.has ? "no_data" : "stale"}));
  const shown = drawn.flatMap((r) => r.vals.filter((v) => v !== null));
  return {freq, columns, items, drawn, hidden, extent: shown.length ? {min: Math.min(...shown), max: Math.max(...shown)} : null, filledCells: shown.length, allCells: drawn.length * columns.length};
}

// The computed paint of every rect of the three Plot.cell marks.
const cellsOf = (page) => page.evaluate(() => [...document.querySelectorAll('#c4-figure g[aria-label="cell"] rect')].map((el) => {
  const cs = getComputedStyle(el);
  return {fill: cs.fill, dash: cs.strokeDasharray, strokeWidth: cs.strokeWidth};
}));
const isHatch = (c) => /mm-blank-c4/.test(c.fill);
const isDashed = (c) => /^4(px)?[ ,]+2/.test(c.dash);

describe("V21 C4 heatmap, countries by period", () => {
  test("AC-V2-49: the columns are the stored periods of ONE frequency, newest kept under the cap, oldest first; the rows are the countries with a stored value, one cell per row and column", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page, log}) => {
      const want = expectC4("M09");
      const ticks = await tickLabels(page, "#c4-figure", "x-axis tick label");
      assert.deepEqual(ticks, want.columns.map((c) => periodLabel(c, "M")), "the stored periods, oldest first");
      assert.ok(ticks.length <= CAPS.M, "at most 36 monthly columns");
      for (const tk of ticks) assert.match(tk, /^\d{4}-\d{2}$/);
      const rows = await tickLabels(page, "#c4-figure", "y-axis tick label");
      assert.deepEqual([...rows].sort(), want.drawn.map((r) => r.name).sort());
      const cells = await cellsOf(page);
      assert.equal(cells.length, want.allCells, "one cell per drawn row and column");
      cleanLog(log);
    });
  });

  test("spec 4 C4: rows are sorted by the latest stored value (default), or A to Z; the sort is local to the card", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const want = expectC4("M09");
      const latest = new Map(want.drawn.map((r) => [r.name, r.latest]));
      const order = () => tickLabels(page, "#c4-figure", "y-axis tick label");
      const byValue = (await order()).map((n) => latest.get(n));
      assert.deepEqual(byValue, [...byValue].sort((a, b) => b - a), "the latest stored value, highest first");
      const hash = await page.evaluate(() => location.hash);
      await page.selectOption("#c4-sort", "name");
      await page.waitForFunction(() => document.querySelector("#c4-sort").value === "name", null, {timeout: TIMEOUT});
      const names = await order();
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en")));
      assert.equal(await page.evaluate(() => location.hash), hash, "no hash key for the sort");
    });
  });

  test("AC-V2-46: the colour scale is declared in the caption block as the displayed lowest and highest stored value, and the legend ends carry the same two numbers", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const want = expectC4("M09");
      const field = (await page.locator('#c4-caption [data-field="scale"] dd').innerText()).trim();
      assert.equal(field, `${valueText(want.extent.min)} to ${valueText(want.extent.max)}, the lowest and highest cell shown`);
      assert.equal((await page.locator('#c4-caption [data-field="scale"] dt').innerText()).trim(), "Colour scale");
      assert.ok((await page.locator('.mm-c4-legend-end[data-end="min"]').innerText()).includes(valueText(want.extent.min)));
      assert.ok((await page.locator('.mm-c4-legend-end[data-end="max"]').innerText()).includes(valueText(want.extent.max)));
      assert.equal(await page.locator(".mm-c4-ramp").getAttribute("data-scale"), "sequential", "a non-negative range is one hue");
    });
  });

  test("AC-V2-47: a range that crosses zero uses the diverging scale with the midpoint at 0 and the legend marks 0", async (t) => {
    await h.withPage(t, "/compare#i=Q08", READY, async ({page}) => {
      const want = expectC4("Q08");
      assert.ok(want.extent.min < 0 && want.extent.max > 0, "the fixture's Q08 crosses zero");
      assert.equal(await page.locator(".mm-c4-ramp").getAttribute("data-scale"), "diverging");
      assert.equal((await page.locator(".mm-c4-legend-mid").innerText()).trim(), "0");
      const field = (await page.locator('#c4-caption [data-field="scale"] dd').innerText()).trim();
      assert.ok(field.startsWith(`${valueText(want.extent.min)} to ${valueText(want.extent.max)}`), field);
    });
  });

  test("AC-V2-48: a cell with no stored value is hatched, never coloured as zero and never printed; filled cells print their stored value when the width permits", async (t) => {
    await h.withPage(t, "/compare#i=M09&stl=1", READY, async ({page}) => {
      const want = expectC4("M09", {stl: true});
      const cells = (await cellsOf(page)).filter((c) => !isDashed(c));
      const hatched = cells.filter(isHatch);
      assert.equal(hatched.length, want.allCells - want.filledCells, "every blank cell, and only blank cells, are hatched");
      assert.ok(hatched.length > 0, "the fixture has blank cells (ESP has missing months, others start later)");
      assert.equal(cells.length - hatched.length, want.filledCells);
      assert.equal(await page.locator('#c4-figure g[aria-label="text"] text').count(), 0, "33 columns: too narrow for text in the cells");
      assert.equal((await page.locator("#c4 .mm-figure-note").first().innerText()).trim(), DRAFT_C4_MARKS);
    });
    await h.withPage(t, "/compare#i=Q08", READY, async ({page}) => {
      const want = expectC4("Q08");
      const texts = await page.$$eval('#c4-figure g[aria-label="text"] text', (ts) => ts.map((x) => x.textContent.trim()));
      assert.equal(texts.length, want.filledCells, "ten quarterly columns: the stored value in every filled cell");
      for (const v of want.drawn[0].vals.filter((x) => x !== null)) assert.ok(texts.includes(valueText(v)), `${v} printed`);
    });
  });

  test("A1.1, AC-V2-84, 80, 89: with stl off the stale rows are not drawn and are listed in the ONE disclosure with reason stale; the count equals the list; the other no-data rows are listed too", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const want = expectC4("M09");
      assert.deepEqual(want.hidden.filter((r) => r.reason === "stale").map((r) => r.id).sort(), ["FRA", "ITA"]);
      const rows = await tickLabels(page, "#c4-figure", "y-axis tick label");
      for (const id of ["FRA", "ITA"]) assert.ok(!rows.includes(h.nameOf(id)), `${id} is not drawn`);
      assert.equal((await cellsOf(page)).filter(isDashed).length, 0, "no dashed outline without stl");
      const d = await hiddenOf(page, "#c4");
      assertDisclosure(d, "C4");
      assert.equal(d.counts.total, want.hidden.length);
      assert.equal(d.counts.stale, 2);
      assert.equal(d.counts.no_data, want.hidden.length - 2);
      assert.deepEqual(d.items.filter((i) => i.reason === "stale").map((i) => i.id).sort(), ["FRA", "ITA"]);
      const fra = d.items.find((i) => i.id === "FRA");
      assert.ok(fra.text.startsWith(`${h.nameOf("FRA")}: Stale; latest value 2025-12; `), fra.text);
      assert.equal(await page.locator("#c4 .mm-hidden-rows").count(), 1, "one disclosure per card");
    });
  });

  test("A1.1, AC-V2-85: Show stale rows draws them with a dashed outline round the row's cells and the text code 'stale' after the label, and the disclosure no longer lists them", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page, log}) => {
      assert.equal(await page.locator("#c4-ctl-stl").isChecked(), false);
      await page.locator("#c4-ctl-stl").check();
      await page.waitForFunction(() => /stl=1/.test(location.hash), null, {timeout: TIMEOUT});
      const want = expectC4("M09", {stl: true});
      await page.waitForFunction((n) => document.querySelectorAll('#c4-figure g[aria-label="y-axis tick label"] text').length === n, want.drawn.length, {timeout: TIMEOUT});
      const rows = await tickLabels(page, "#c4-figure", "y-axis tick label");
      for (const id of ["FRA", "ITA"]) assert.ok(rows.includes(`${h.nameOf(id)} ${DRAFT_STALE_CODE}`), `${id}: the text code after the label`);
      assert.equal(rows.filter((r) => r.endsWith(` ${DRAFT_STALE_CODE}`)).length, 2, "only the stale rows carry the code");
      const cells = await cellsOf(page);
      const dashed = cells.filter(isDashed);
      assert.equal(dashed.length, 2 * want.columns.length, "a dashed outline round every cell of each stale row");
      for (const c of dashed) assert.equal(c.fill, "none", "the outline is not a fill and not the hatch");
      assert.ok(!dashed.some(isHatch), "the hatch is reserved for blank cells");
      const d = await hiddenOf(page, "#c4");
      assert.equal(d.items.filter((i) => i.reason === "stale").length, 0, "stale rows leave the hidden array");
      assert.ok(!/stale/.test(d.summary), d.summary);
      assertDisclosure(d, "C4 stl");
      assert.equal((await page.locator("#c4 .mm-figure-note").nth(1).innerText()).trim(), DRAFT_C4_OUTLINE_MARK);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "c4-ctl-stl", "the control keeps focus");
      await page.locator("#c4-ctl-stl").uncheck();
      await page.waitForFunction(() => !/stl=1/.test(location.hash), null, {timeout: TIMEOUT});
      await page.waitForFunction(() => document.querySelectorAll('#c4-figure g[aria-label="y-axis tick label"] text').length > 0 && ![...document.querySelectorAll('#c4-figure g[aria-label="y-axis tick label"] text')].some((x) => /stale$/.test(x.textContent)), null, {timeout: TIMEOUT});
      cleanLog(log);
    });
    await h.withPage(t, "/compare#i=A04&stl=1", READY, async ({page}) => {
      const rows = await tickLabels(page, "#c4-figure", "y-axis tick label");
      for (const id of ["ROU", "BGR"]) assert.ok(rows.includes(`${h.nameOf(id)} ${DRAFT_STALE_CODE}`), `${id} (stored stale, annual series ending 2023)`);
    });
  });

  test("A1.1, spec 4 C4 (stale): a row without a scorecard cell is not flagged stale and is drawn (the stale cell of FRA is removed from the served scorecard)", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const rows = await tickLabels(page, "#c4-figure", "y-axis tick label");
      assert.ok(rows.includes(h.nameOf("FRA")), "FRA has no scorecard cell here and is drawn, without the stale code");
      assert.ok(!rows.includes(`${h.nameOf("FRA")} ${DRAFT_STALE_CODE}`));
      assert.ok(!rows.includes(h.nameOf("ITA")), "ITA keeps its stored stale flag and stays hidden");
      const d = await hiddenOf(page, "#c4");
      assert.deepEqual(d.items.filter((i) => i.reason === "stale").map((i) => i.id), ["ITA"]);
    }, {route: (ctx) => overrideScorecard(ctx, "labour", (sc) => {
      const fra = sc.entities.find((e) => e.entity_id === "FRA");
      fra.indicators = fra.indicators.filter((c) => c.indicator_id !== "M09");
    })});
  });

  test("oth does not apply to C4: the strip has Indicator, Domain, Group, Frequency, Period and Show stale rows, and no Include other periods", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const keys = await page.$$eval('form[data-chart-controls="c4"] [data-compare-control]', (els) => els.map((e) => e.getAttribute("data-compare-control")));
      assert.deepEqual(keys, ["indicator", "domain", "group", "frequency", "period", "period", "stl"]);
      assert.equal(await page.locator("#c4-ctl-oth").count(), 0);
    });
    await h.withPage(t, "/indicator/M09", READY, async ({page}) => {
      const keys = await page.$$eval('form[data-chart-controls="c4"] [data-compare-control]', (els) => els.map((e) => e.getAttribute("data-compare-control")));
      assert.deepEqual(keys, ["group", "frequency", "period", "period", "stl"], "the fixed page has neither an Indicator nor a Direction/Domain list on C4");
    });
  });

  test("AC-V2-75: one frequency per chart, no resampling: V06 has monthly and quarterly series; the Frequency control switches the columns and the rows that have that stored frequency", async (t) => {
    await h.withPage(t, "/compare#i=V06", READY, async ({page}) => {
      const monthly = expectC4("V06");
      assert.deepEqual(await tickLabels(page, "#c4-figure", "x-axis tick label"), monthly.columns.map((c) => periodLabel(c, "M")));
      assert.deepEqual((await tickLabels(page, "#c4-figure", "y-axis tick label")).sort(), monthly.drawn.map((r) => r.name).sort());
      await page.selectOption("#c4-ctl-frequency", "Q");
      await page.waitForFunction(() => location.hash.includes("f=Q"), null, {timeout: TIMEOUT});
      const quarterly = expectC4("V06", {f: "Q"});
      await page.waitForFunction((n) => document.querySelectorAll('#c4-figure g[aria-label="x-axis tick label"] text').length === n, quarterly.columns.length, {timeout: TIMEOUT});
      const ticks = await tickLabels(page, "#c4-figure", "x-axis tick label");
      assert.deepEqual(ticks, quarterly.columns.map((c) => periodLabel(c, "Q")));
      for (const tk of ticks) assert.match(tk, /^\d{4} Q[1-4]$/);
      assert.deepEqual((await tickLabels(page, "#c4-figure", "y-axis tick label")).sort(), quarterly.drawn.map((r) => r.name).sort());
      assert.match(await page.locator('#c4-caption [data-field="frequency"] dd').innerText(), /^Quarterly$/);
    });
  });

  test("Period control: a From and To year select the window of columns; the cells are the stored values inside it", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      await page.selectOption("#c4-ctl-from", "2025");
      await page.selectOption("#c4-ctl-to", "2026");
      await page.waitForFunction(() => /from=2025/.test(location.hash) && /to=2026/.test(location.hash), null, {timeout: TIMEOUT});
      const want = expectC4("M09", {from: 2025, to: 2026});
      await page.waitForFunction((n) => document.querySelectorAll('#c4-figure g[aria-label="x-axis tick label"] text').length === n, want.columns.length, {timeout: TIMEOUT});
      const ticks = await tickLabels(page, "#c4-figure", "x-axis tick label");
      assert.deepEqual(ticks, want.columns.map((c) => periodLabel(c, "M")));
      for (const tk of ticks) assert.match(tk, /^202[56]-/);
    });
  });

  test("spec 5.2: choosing a Domain limits the indicator list of the C4 strip to that domain and clears an indicator it does not offer", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const labour = h.domains.find((d) => d.domain_id === "labour");
      await page.selectOption("#c4-ctl-domain", "fiscal");
      await page.waitForFunction(() => /d=fiscal/.test(location.hash), null, {timeout: TIMEOUT});
      const offered = (await page.$$eval("#c4-ctl-indicator option", (os) => os.map((o) => o.value))).filter(Boolean);
      assert.deepEqual(offered, h.domains.find((d) => d.domain_id === "fiscal").indicator_ids);
      assert.ok(!offered.some((id) => labour.indicator_ids.includes(id)));
      assert.ok(!/i=M09/.test(await page.evaluate(() => location.hash)), "M09 is not in fiscal, so the indicator is cleared");
      assert.equal((await page.locator('[data-slot="c4-body"] .mm-state-empty').innerText()).trim(), DRAFT_COMPARE_CHOOSE_INDICATOR);
    });
  });

  test("AC-V2-31 on any export: a stored unit_code that differs among the drawn rows blocks the card with the stored-field message; no figure", async (t) => {
    await h.withPage(t, "/compare#i=M09", "#c4[data-state=blocked]", async ({page, log}) => {
      assert.equal((await page.locator("#c4 .mm-state-blocked").innerText()).trim(), DRAFT_BLOCKED_MESSAGE(["unit code"]));
      assert.equal(await page.locator("#c4 svg").count(), 0);
      cleanLog(log);
    }, {route: (ctx) => overrideSeriesMeta(ctx, (series) => {
      series.find((s) => s.indicator_id === "M09" && s.entity_id === "DEU").unit_code = "EUR_SYNTH";
    })});
  });

  test("AC-V2-81: when only stale rows remain the card shows 'No aligned values for this selection' and the disclosure, never an empty axis", async (t) => {
    await h.withPage(t, "/compare#i=M09", "#c4[data-state=empty]", async ({page}) => {
      assert.equal((await page.locator("#c4 .mm-state-empty").innerText()).trim(), DRAFT_NO_ALIGNED);
      assert.equal(await page.locator("#c4 svg").count(), 0);
      const want = expectC4("M09", {stl: true});
      const d = await hiddenOf(page, "#c4");
      assertDisclosure(d, "C4 all stale");
      assert.equal(d.counts.stale, want.drawn.length, "every country with a stored value is stale");
    }, {route: (ctx) => overrideScorecard(ctx, "labour", (sc) => {
      for (const e of sc.entities) for (const c of e.indicators) if (c.indicator_id === "M09") c.is_stale = true;
    })});
  });

  test("AC-V2-50, AC-V2-43: no projection cell, column or word in the card", async (t) => {
    await h.withPage(t, "/compare#i=A04", READY, async ({page}) => {
      assert.doesNotMatch(await page.locator("#c4").innerText(), /\bPROJ\b|projection|forecast/i);
      assert.equal(await page.locator("#c4 [data-status='PROJ'], #c4 [data-code='PROJ']").count(), 0);
    });
  });

  test("spec 7.3, A1.4: the table alternative has every stored cell of the drawn rows, then the hidden rows (their stored points, or one row with the reason); numbers are the stored values", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const want = expectC4("M09");
      await page.locator("#c4-table > summary").click();
      const expected = want.items.reduce((n, r) => n + (r.filled > 0 ? r.filled : 1), 0);
      await page.waitForFunction((n) => document.querySelectorAll("#c4-table tbody tr").length === n, expected, {timeout: TIMEOUT});
      const fra = await page.$$eval('#c4-table tbody tr[data-entity="FRA"] td:last-child', (tds) => tds.map((x) => x.textContent.trim()));
      assert.ok(fra.length > 0 && fra.every((x) => x === DRAFT_STALE_PERIOD("2025-12")), `the stale row keeps its stored points with the state: ${fra.slice(0, 2)}`);
      const head = await page.$$eval("#c4-table thead th", (ths) => ths.map((x) => x.textContent.trim()));
      assert.ok(head.some((x) => x.includes(h.indicator("M09").unit_label)), head.join(" | "));
    });
  });

  test("the heatmap figure has role img and a generated label; keyboard: Show stale rows toggles with Space and the card keeps focus", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      assert.equal(await page.locator("#c4-figure").getAttribute("role"), "img");
      assert.ok((await page.locator("#c4-figure").getAttribute("aria-label")).startsWith(`Heatmap of ${h.indicator("M09").name}`));
      await page.focus("#c4-ctl-stl");
      await page.keyboard.press("Space");
      await page.waitForFunction(() => /stl=1/.test(location.hash), null, {timeout: TIMEOUT});
      assert.equal(await page.evaluate(() => document.activeElement?.id), "c4-ctl-stl");
    });
  });
});
