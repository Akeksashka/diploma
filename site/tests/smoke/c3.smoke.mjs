// V20 browser smoke of C3, the scatter of two indicators, on PG-COMPARE (/compare#x=...&y=...) and PG-INDICATOR: AC-V2-41, 42, 43, 44, 45, 80, 87 (`p`), spec 4 C3, 6.2, 6.5, A1.3 (`p` format), A1.4 (hidden rows).
// Runs against a built site over the SYNTHETIC v2 fixture (tests/fixtures/v2_export): the monthly pair M09 x M10 (28 and 27 countries), the annual pair A04 x A05, and the frequency mismatches M09 x A05 and M09 x Q08.
// Expectations are computed from the built stored series files with the spec's own rules. Localhost only; off-origin requests abort. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {after, before, describe, test} from "node:test";
import {DRAFT_BLOCKED_FIELD_LABELS, DRAFT_BLOCKED_MESSAGE, DRAFT_C3_NO_COMMON, DRAFT_COMPARE_CHOOSE_PAIR, DRAFT_P1A_REFERENCE} from "../../src/lib/copy.js";
import {periodLabel} from "../../src/lib/period.js";
import {TIMEOUT, assertDisclosure, cleanLog, harness, hiddenOf, tickLabels} from "./compare-support.mjs";

const h = harness();
before(h.before);
after(h.after);

const READY = "#c3-figure svg";
// The stored common periods of a pair: ref_period_end -> ids of the countries with BOTH stored values (aggregates excluded), over the first frequency common to x and y.
function common(x, y) {
  const fx = h.indicator(x).frequency_set.find((f) => h.indicator(y).frequency_set.includes(f));
  const out = new Map();
  for (const e of h.countries()) {
    const a = h.values(x, e.entity_id, fx);
    const b = h.values(y, e.entity_id, fx);
    for (const end of a.keys()) if (b.has(end)) out.set(end, [...(out.get(end) ?? []), e.entity_id]);
  }
  return {fx, byEnd: out, ends: [...out.keys()].sort().reverse()};
}
// Spec 4 C3: the latest period with at least five stored points, else the latest common period (threshold 5, Q6).
const defaultEnd = ({byEnd, ends}) => ends.find((e) => byEnd.get(e).length >= 5) ?? ends[0] ?? null;
const hashOf = (end, f) => periodLabel(end, f).replace(" ", "-");
const axisText = (name, unit) => `${name} (${unit})`;

describe("V20 C3 scatter", () => {
  test("AC-V2-42, 43, 45: default period and frequency; one dot per country with both stored values; both axes titled with name and unit; the table lists country, period, x and y", async (t) => {
    await h.withPage(t, "/compare#x=M09&y=M10", READY, async ({page, log}) => {
      const c = common("M09", "M10");
      const end = defaultEnd(c);
      const label = periodLabel(end, c.fx);
      assert.equal(c.fx, "M");
      assert.equal((await page.locator('#c3 [data-field="reference-period"]').innerText()).trim(), DRAFT_P1A_REFERENCE(label), "the default period");
      assert.equal(await page.locator("#c3-ctl-p").inputValue(), "", "the control shows the default");
      assert.deepEqual(await page.$$eval("#c3-ctl-p option", (os) => os.map((o) => o.value)), ["", ...c.ends.map((e) => hashOf(e, c.fx))], "the control offers exactly the stored common periods, newest first");
      assert.deepEqual(await page.$$eval("#c3-ctl-frequency option", (os) => os.map((o) => o.value)), ["", "M"], "only frequencies stored for both indicators");
      assert.equal((await page.locator('#c3-caption-x [data-field="frequency"] dd').innerText()).trim(), "Monthly");
      const dots = await page.$$eval('#c3-figure g[aria-label="dot"] circle', (cs) => cs.map((x) => x.getAttribute("r")));
      assert.equal(dots.filter((r) => r !== "8").length, c.byEnd.get(end).length, "one dot per country with both values in exactly that period");
      const [mx, my] = [h.indicator("M09"), h.indicator("M10")];
      const xl = await page.$eval('#c3-figure g[aria-label="x-axis label"]', (g) => g.textContent);
      const yl = await page.$eval('#c3-figure g[aria-label="y-axis label"]', (g) => g.textContent);
      assert.ok(xl.includes(axisText(mx.name, mx.unit_label)), xl);
      assert.ok(yl.includes(axisText(my.name, my.unit_label)), yl);
      // table: every country of the comparison set once; those with both values carry no state sentence
      await page.locator("#c3-view > summary").click();
      const rows = await page.$$eval("#c3-table tbody tr", (trs) => trs.map((tr) => ({id: tr.getAttribute("data-entity"), cells: [...tr.children].map((x) => x.textContent.trim())})));
      assert.equal(rows.length, h.countries().length);
      assert.equal(rows.filter((r) => r.cells.at(-1) === "").length, c.byEnd.get(end).length);
      for (const r of rows) assert.equal(r.cells[1], label, `${r.id}: the period`);
      assert.equal(await page.locator('#c3-table tbody tr[data-entity="EA"], #c3-table tbody tr[data-entity="EU27"]').count(), 0, "aggregates are excluded by default");
      const head = await page.$$eval("#c3-table thead th", (ths) => ths.map((x) => x.textContent.trim()));
      assert.ok(head.some((x) => x.includes(axisText(mx.name, mx.unit_label))) && head.some((x) => x.includes(axisText(my.name, my.unit_label))), head.join(" | "));
      cleanLog(log);
    });
  });

  test("spec 4 C3: neither axis is forced to zero (a stored range far above zero starts near the data)", async (t) => {
    await h.withPage(t, "/compare#x=M09&y=M10", READY, async ({page}) => {
      const y = (await tickLabels(page, "#c3-figure", "y-axis tick label")).map((s) => Number(s.replace(/,/g, ""))).filter(Number.isFinite);
      assert.ok(Math.min(...y) > 40, `M10 is stored at 60 to 74: the lowest y tick is ${Math.min(...y)}`);
      const x = (await tickLabels(page, "#c3-figure", "x-axis tick label")).map((s) => Number(s.replace(/,/g, ""))).filter(Number.isFinite);
      assert.ok(Math.min(...x) > 0, "the x axis starts at the data, not below it");
    });
  });

  test("AC-V2-42, A1.4, AC-V2-80, 89: each country without both values is listed once with 'no value for <indicator>'; N equals the list; nothing at N = 0", async (t) => {
    await h.withPage(t, "/compare#x=M09&y=M10", READY, async ({page}) => {
      const c = common("M09", "M10");
      const end = defaultEnd(c);
      const have = new Set(c.byEnd.get(end));
      const d = await hiddenOf(page, "#c3");
      assertDisclosure(d, "C3");
      assert.equal(d.counts.total, h.countries().length - have.size);
      assert.equal(d.counts.no_data, d.counts.total, "all are no data");
      for (const e of h.countries().filter((x) => !have.has(x.entity_id))) {
        const lacks = [];
        if (!h.values("M09", e.entity_id, "M").has(end)) lacks.push(h.indicator("M09").name);
        if (!h.values("M10", e.entity_id, "M").has(end)) lacks.push(h.indicator("M10").name);
        const item = d.items.find((i) => i.id === e.entity_id);
        assert.ok(item, `${e.name} is listed`);
        assert.ok(item.text.endsWith(`no value for ${lacks.join(", ")}`), item.text);
      }
      assert.equal(await page.locator("#c3 .mm-hidden-rows").count(), 1);
    });
    // Annual pair: ROU and BGR end in 2023, so they have no value at the default period and are listed.
    await h.withPage(t, "/compare#x=A04&y=A05", READY, async ({page}) => {
      const d = await hiddenOf(page, "#c3");
      assertDisclosure(d, "C3 A04 x A05");
      for (const id of ["ROU", "BGR"]) assert.ok(d.items.some((i) => i.id === id), `${id} has no value at the default period`);
    });
  });

  test("A1.3, AC-V2-87: the Reference period control writes p (YYYY-MM here) from the stored common periods; an invalid or unstored p falls back to the default", async (t) => {
    await h.withPage(t, "/compare#x=M09&y=M10", READY, async ({page}) => {
      const c = common("M09", "M10");
      const older = c.ends[3];
      await page.selectOption("#c3-ctl-p", hashOf(older, c.fx));
      await page.waitForFunction((v) => location.hash.includes(`p=${v}`), hashOf(older, c.fx), {timeout: TIMEOUT});
      await page.waitForFunction((l) => document.querySelector('#c3 [data-field="reference-period"]')?.textContent.trim() === `Reference period: ${l}`, periodLabel(older, c.fx), {timeout: TIMEOUT});
      const n = c.byEnd.get(older).length;
      await page.locator("#c3-view > summary").click();
      assert.equal(await page.locator('#c3-table tbody tr td:last-child:empty').count(), n, "only points with both values in that period");
      assert.ok((await page.locator("#c3-table caption").innerText()).includes(periodLabel(older, c.fx)));
      assert.equal(await page.locator("#c3-ctl-p").inputValue(), hashOf(older, c.fx));
      assert.ok((await page.locator("#c3-figure").getAttribute("aria-label")).includes(periodLabel(older, c.fx)));
    });
    for (const bad of ["p=2026-13", "p=1999-01", "p=abc"]) {
      await h.withPage(t, `/compare#x=M09&y=M10&${bad}`, READY, async ({page}) => {
        const c = common("M09", "M10");
        assert.equal((await page.locator('#c3 [data-field="reference-period"]').innerText()).trim(), DRAFT_P1A_REFERENCE(periodLabel(defaultEnd(c), c.fx)), `${bad}: the default period`);
        assert.equal(await page.locator("#c3-ctl-p").inputValue(), "", `${bad}: the control shows the default`);
      });
    }
  });

  test("A1.3: an annual pair uses YYYY for p and the stored year as the period label", async (t) => {
    await h.withPage(t, "/compare#x=A04&y=A05&p=2024", READY, async ({page}) => {
      assert.equal((await page.locator('#c3 [data-field="reference-period"]').innerText()).trim(), DRAFT_P1A_REFERENCE("2024"));
      assert.equal(await page.locator("#c3-ctl-p").inputValue(), "2024");
      const c = common("A04", "A05");
      const dots = await page.$$eval('#c3-figure g[aria-label="dot"] circle', (cs) => cs.filter((x) => x.getAttribute("r") !== "8").length);
      assert.equal(dots, c.byEnd.get("2024-12-31").length);
    });
  });

  test("AC-V2-41, A1.6: indicators with no stored frequency in common are blocked with the stored reason; no figure and no resampling", async (t) => {
    for (const [x, y] of [["M09", "A05"], ["M09", "Q08"]]) {
      await h.withPage(t, `/compare#x=${x}&y=${y}`, "#c3[data-state=blocked]", async ({page, log}) => {
        assert.equal((await page.locator("#c3 .mm-state-blocked").innerText()).trim(), DRAFT_BLOCKED_MESSAGE([DRAFT_BLOCKED_FIELD_LABELS.frequency]));
        const li = await page.locator('#c3 .mm-blocked-fields li[data-field="frequency"]').innerText();
        assert.ok(li.includes(h.indicator(x).frequency_set[0]) && li.includes(h.indicator(y).frequency_set[0]), li);
        assert.equal(await page.locator("#c3 svg, #c3-view").count(), 0, `${x} x ${y}: nothing drawn`);
        cleanLog(log);
      });
    }
  });

  test("AC-V2-41: a pair with a stored frequency in common is not blocked; it uses that frequency (V06 has M and Q, M09 has M)", async (t) => {
    await h.withPage(t, "/compare#x=M09&y=V06", "#c3[data-state]", async ({page}) => {
      assert.notEqual(await page.locator("#c3").getAttribute("data-state"), "blocked");
      assert.deepEqual(await page.$$eval("#c3-ctl-frequency option", (os) => os.map((o) => o.value)), ["", "M"]);
      const c = common("M09", "V06");
      if (c.ends.length === 0) assert.equal((await page.locator("#c3 .mm-state-empty").innerText()).trim(), DRAFT_C3_NO_COMMON);
      else assert.equal(await page.locator("#c3").getAttribute("data-state"), "ok");
    });
  });

  test("spec 4 C3: labels only for the highlighted countries (c), none by default; no regression line, no correlation, no third variable in size or colour", async (t) => {
    await h.withPage(t, "/compare#x=M09&y=M10&c=DEU,FRA", READY, async ({page, log}) => {
      const c = common("M09", "M10");
      const ids = c.byEnd.get(defaultEnd(c));
      const want = ["DEU", "FRA"].filter((id) => ids.includes(id)).map((id) => h.nameOf(id));
      assert.ok(want.length > 0);
      const labels = await page.$$eval('#c3-figure g[aria-label="text"] text', (ts) => ts.map((x) => x.textContent.trim()));
      assert.deepEqual(labels.sort(), want.sort(), "only the highlighted countries are named");
      assert.equal(await page.locator("#c3-figure g[aria-label=\"line\"], #c3-figure g[aria-label=\"linear-regression\"], #c3-figure g[aria-label=\"link\"]").count(), 0, "no trend, regression or connecting line");
      const radii = await page.$$eval('#c3-figure g[aria-label="dot"] circle', (cs) => [...new Set(cs.map((x) => x.getAttribute("r")))].sort());
      assert.deepEqual(radii, ["4", "8"], "one dot size and the focus ring: no size encoding");
      const fills = await page.$$eval('#c3-figure g[aria-label="dot"] circle', (cs) => [...new Set(cs.map((x) => getComputedStyle(x).fill))]);
      assert.ok(fills.length <= 3, `ink, background and none only: ${fills.join(" | ")}`);
      assert.doesNotMatch(await page.locator("#c3").innerText(), /regress|correlat|trend line|r\s*=|R²|slope/i);
      cleanLog(log);
    });
    await h.withPage(t, "/compare#x=M09&y=M10", READY, async ({page}) => {
      assert.equal(await page.locator('#c3-figure g[aria-label="text"] text').count(), 0, "no country is labelled by default");
    });
  });

  test("spec 4 C3: a zero rule is drawn only where the plotted range crosses zero", async (t) => {
    await h.withPage(t, "/compare#x=A04&y=A05", READY, async ({page}) => {
      const c = common("A04", "A05");
      const ids = c.byEnd.get(defaultEnd(c));
      const xs = ids.map((id) => h.values("A04", id, "A").get(defaultEnd(c)));
      const ys = ids.map((id) => h.values("A05", id, "A").get(defaultEnd(c)));
      const crosses = (v) => v.some((n) => n < 0) && v.some((n) => n > 0);
      assert.equal(await page.locator('#c3-figure g[aria-label="rule"]').count(), (crosses(xs) ? 1 : 0) + (crosses(ys) ? 1 : 0));
    });
  });

  test("the card asks for both indicators until they are chosen; on the fixed-indicator page y is the only choice left to make and choosing it draws the card", async (t) => {
    await h.withPage(t, "/compare", "#c3[data-state=choose]", async ({page}) => {
      assert.equal((await page.locator("#c3 .mm-state-empty").innerText()).trim(), DRAFT_COMPARE_CHOOSE_PAIR);
      assert.equal(await page.locator("#c3 svg").count(), 0);
    });
    await h.withPage(t, "/indicator/M09", "#c3[data-state=choose]", async ({page, log}) => {
      assert.equal(await page.locator("#c3-ctl-indicator").count(), 0);
      await page.selectOption("#c3-ctl-y", "M10");
      await page.waitForFunction(() => /y=M10/.test(location.hash), null, {timeout: TIMEOUT});
      await page.waitForSelector(READY, {timeout: TIMEOUT});
      const c = common("M09", "M10");
      assert.equal((await page.locator('#c3 [data-field="reference-period"]').innerText()).trim(), DRAFT_P1A_REFERENCE(periodLabel(defaultEnd(c), c.fx)));
      cleanLog(log);
    });
  });

  test("the C3 strip offers only the controls that act on it: X, Y, Group, Frequency, Reference period; no Period range, no flags", async (t) => {
    await h.withPage(t, "/compare#x=M09&y=M10", READY, async ({page}) => {
      const ids = await page.$$eval('form[data-chart-controls="c3"] [data-compare-control]', (els) => els.map((e) => e.getAttribute("data-compare-control")));
      assert.deepEqual(ids, ["x", "y", "group", "frequency", "p"]);
    });
  });

  test("keyboard: the Reference period select changes the period by type-ahead and keeps focus; the table alternative opens with Enter", async (t) => {
    await h.withPage(t, "/compare#x=M09&y=M10", READY, async ({page}) => {
      const c = common("M09", "M10");
      await page.focus("#c3-ctl-p");
      await page.keyboard.type(periodLabel(c.ends[2], c.fx));
      await page.waitForFunction((v) => location.hash.includes(`p=${v}`), hashOf(c.ends[2], c.fx), {timeout: TIMEOUT});
      assert.equal(await page.evaluate(() => document.activeElement?.id), "c3-ctl-p", "focus stays on the control after the card is redrawn");
      await page.focus("#c3-view > summary");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#c3-view").getAttribute("open"), "");
    });
  });
});
