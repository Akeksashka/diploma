// V19 browser smoke of C2, the ranked bar of the latest aligned period (the bars of the old C-RANK card are replaced), on PG-COMPARE and PG-INDICATOR: AC-V2-35, 36, 37, 38, 80, 81, 89, spec 4 C2, 6.2, 6.3, 7,
// ADR-037 decision 3 (percentile layer only with pc=1), A1.4 (hidden rows), A1.6 (blocking fields), decision D2 (no stored reference period).
// Runs against a built site over the SYNTHETIC v2 fixture (tests/fixtures/v2_export); expectations are derived from the built stored scorecards with the spec's own rules (A1.4 precedence), not from the page code.
// Localhost only; off-origin requests abort. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {after, before, describe, test} from "node:test";
import {
  DRAFT_BLOCKED_MESSAGE, DRAFT_C2_MARKS, DRAFT_C2_NO_RANK_REFERENCE, DRAFT_COMPARE_SORTS, DRAFT_NO_ALIGNED, DRAFT_P1A_REFERENCE, DRAFT_STALE_PERIOD, ORIENTATION_NOTE, PERCENTILE_COLUMN_LABEL
} from "../../src/lib/copy.js";
import {periodLabel} from "../../src/lib/period.js";
import {TIMEOUT, assertDisclosure, cleanLog, harness, hiddenOf, overrideScorecard, overrideSeriesMeta, tickLabels} from "./compare-support.mjs";

const h = harness();
before(h.before);
after(h.after);

const READY = "#c2-figure svg";
const collator = (a, b) => a.localeCompare(b, "en");

// The spec's selection for C2 (A1.4 precedence: no data, stale, other period), computed from the stored scorecard cells. `group`: a stored group id or null.
function expected(indicatorId, {oth = false, group = null} = {}) {
  const ref = h.alignment(indicatorId)?.rank_reference_period ?? null;
  const members = group ? new Set(h.groups.find((g) => g.group_id === group).members.filter((m) => m.valid_to == null).map((m) => m.entity_id)) : null;
  const countries = h.countries().filter((e) => !members || members.has(e.entity_id));
  const rows = [...countries, ...h.aggregates()].map((e) => {
    const cell = h.cell(indicatorId, e.entity_id);
    const has = hasValue(cell);
    let reason = null;
    if (!has) reason = "no_data";
    else if (cell.is_stale === true) reason = "stale";
    else if (!oth && ref !== null && (cell.alignment === "unaligned" || cell.ref_period_end !== ref)) reason = "other_period";
    return {id: e.entity_id, name: e.name, kind: e.kind, cell, value: has ? cell.value : null, percentile: has && typeof cell.percentile === "number" ? cell.percentile : null, reason};
  });
  return {ref, rows, drawn: rows.filter((r) => r.reason === null), hidden: rows.filter((r) => r.reason !== null)};
}
const hasValue = (c) => Boolean(c) && typeof c.value === "number" && c.published !== false && c.publish_scope !== "excluded";
const countsOf = (hidden) => ({total: hidden.length, ...Object.fromEntries(["no_data", "stale", "other_period", "other"].map((k) => [k, hidden.filter((r) => r.reason === k).length]))});

// Each drawn bar with the y tick label nearest to it, its computed paint and its position against the zero rule.
async function barsOf(page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll('#c2-figure g[aria-label="y-axis tick label"] text')].map((t) => {
      const r = t.getBoundingClientRect();
      return {label: t.textContent.trim(), y: r.top + r.height / 2};
    });
    const rule = document.querySelector('#c2-figure g[aria-label="rule"] line');
    const zero = rule ? rule.getBoundingClientRect().left : null;
    return [...document.querySelectorAll('#c2-figure g[aria-label="bar"] rect')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const y = r.top + r.height / 2;
      const nearest = labels.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a));
      return {label: nearest.label, fill: cs.fill, stroke: cs.stroke, dash: cs.strokeDasharray, left: r.left, right: r.right, zero};
    });
  });
}
const hollow = (b) => b.stroke !== "none" && (b.dash === "none" || b.dash === "");
const dashed = (b) => b.dash !== "none" && b.dash !== "";

describe("V19 C2 ranked bar", () => {
  test("AC-V2-35, 36, 38: bars start at the zero rule, only rows of the printed reference period are drawn, no total or mean row; the reference period is the stored one", async (t) => {
    for (const id of ["M09", "A04"]) {
      await h.withPage(t, `/compare#i=${id}`, READY, async ({page, log}) => {
        const want = expected(id);
        const bars = await barsOf(page);
        assert.equal(bars.length, want.drawn.length, `${id}: one bar per row aligned to the stored reference period`);
        assert.deepEqual(bars.map((b) => b.label).sort(), want.drawn.map((r) => r.name).sort(), `${id}: the drawn rows`);
        for (const b of bars) assert.ok(Math.abs(b.left - b.zero) < 1.5 || Math.abs(b.right - b.zero) < 1.5, `${id} ${b.label}: the bar starts at zero (zero ${b.zero}, bar ${b.left}..${b.right})`);
        const freq = h.indicator(id).frequency_set[0];
        assert.equal((await page.locator('#c2 [data-field="reference-period"]').innerText()).trim(), DRAFT_P1A_REFERENCE(periodLabel(want.ref, freq)));
        const text = (await page.locator("#c2").innerText()).replace(h.indicator(id).name, "");
        assert.doesNotMatch(text, /\b(total|average|mean|sum)\b/i, "no total, average or mean row or label");
        assert.equal((await page.locator("#c2 .mm-figure-note").innerText()).trim(), DRAFT_C2_MARKS);
        cleanLog(log);
      });
    }
  });

  test("ADR-037 decision 3, AC-V2-37: by default no percentile anywhere in C2 (no column, no chip, no percentile sort option) and the bar fill is one neutral colour", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      assert.equal(await page.locator("#c2").getAttribute("data-pc"), "false");
      assert.deepEqual(await page.$$eval("#c2-sort option", (os) => os.map((o) => o.value)), ["value", "name"]);
      await page.locator("#c2-view > summary").click();
      const head = await page.$$eval("#c2-table thead th", (ths) => ths.map((x) => x.textContent.trim()));
      assert.ok(!head.includes(PERCENTILE_COLUMN_LABEL), head.join(" | "));
      assert.equal(await page.locator("#c2 .mm-orientation").count(), 0);
      const texts = await page.$$eval('#c2-figure g[aria-label="text"] text', (ts) => ts.map((x) => x.textContent.trim()));
      assert.ok(texts.length > 0 && texts.every((x) => !x.includes("(")), "only stored values are printed beside the bars, no percentile with a bin");
      const solid = (await barsOf(page)).filter((b) => !hollow(b) && !dashed(b));
      assert.ok(solid.length > 0);
      assert.equal(new Set(solid.map((b) => b.fill)).size, 1, "one neutral fill, not the five bin colours");
    });
  });

  test("ADR-037 decision 3: with pc=1 a percentile column, the stored percentile text with its bin and the orientation sentence appear; the bar fill stays neutral; turning pc off removes them", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const fills = async () => new Set((await barsOf(page)).filter((b) => !hollow(b) && !dashed(b)).map((b) => b.fill));
      const neutral = await fills();
      assert.equal(await page.locator(".mm-orientation").count(), 0);
      await page.locator("#c2-ctl-pc").check();
      await page.waitForFunction(() => /pc=1/.test(location.hash) && document.querySelector("#c2")?.getAttribute("data-pc") === "true", null, {timeout: TIMEOUT});
      assert.equal(await page.locator(".mm-orientation").count(), 1, "one orientation sentence on the page while pc is on");
      assert.equal((await page.locator(".mm-orientation").innerText()).trim(), ORIENTATION_NOTE);
      assert.equal(await page.locator(".mm-caveat").count(), 1);
      assert.deepEqual(await page.$$eval("#c2-sort option", (os) => os.map((o) => o.value)), ["value", "name", "percentile"]);
      assert.deepEqual([...(await fills())], [...neutral], "bar fill remains neutral");
      const texts = await page.$$eval('#c2-figure g[aria-label="text"] text', (ts) => ts.map((x) => x.textContent.trim()));
      const withP = expected("M09").drawn.filter((r) => r.percentile !== null && r.kind === "country").slice(0, 3);
      assert.ok(withP.length > 0, "the fixture stores percentiles for M09");
      for (const r of withP) assert.ok(texts.some((x) => x.startsWith(`${r.percentile.toFixed(2)} (`)), `${r.name}: the stored percentile ${r.percentile.toFixed(2)} with its bin in ${texts.slice(0, 6).join(" | ")}`);
      await page.locator("#c2-view > summary").click();
      const head = await page.$$eval("#c2-table thead th", (ths) => ths.map((x) => x.textContent.trim()));
      assert.ok(head.includes(PERCENTILE_COLUMN_LABEL));
      await page.locator("#c2-ctl-pc").uncheck();
      await page.waitForFunction(() => document.querySelectorAll(".mm-orientation").length === 0, null, {timeout: TIMEOUT});
      assert.deepEqual(await page.$$eval("#c2-sort option", (os) => os.map((o) => o.value)), ["value", "name"]);
    });
  });

  test("AC-V2-36, A1.4, AC-V2-80, 89: rows not aligned to the reference period, stale rows and rows without a value are in ONE disclosure; N equals the list and each part equals the stored count", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const want = expected("M09");
      const d = await hiddenOf(page, "#c2");
      assertDisclosure(d, "C2");
      assert.deepEqual(d.counts, countsOf(want.hidden));
      assert.deepEqual(d.items.map((i) => i.id).sort(), want.hidden.map((r) => r.id).sort());
      assert.deepEqual(d.items.filter((i) => i.reason === "stale").map((i) => i.id).sort(), ["FRA", "ITA"]);
      assert.ok(d.counts.other_period >= 1, "the lagging row USA is another period");
      const fra = d.items.find((i) => i.id === "FRA");
      assert.ok(fra.text.startsWith(`${h.nameOf("FRA")}: Stale; latest value 2025-12; `), fra.text);
      assert.equal(await page.locator("#c2 .mm-hidden-rows").count(), 1, "one disclosure per card");
      // The order of the list: reason precedence, then name A to Z.
      const order = ["no_data", "stale", "other_period", "other"];
      const rank = d.items.map((i) => order.indexOf(i.reason));
      assert.deepEqual(rank, [...rank].sort((a, b) => a - b), "reason categories in precedence order");
    });
  });

  test("F7, oth: Include rows from other reference periods draws them hollow with their own period in the label; stale rows stay hidden", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const before = (await barsOf(page)).length;
      await page.locator("#c2-ctl-oth").check();
      await page.waitForFunction(() => /oth=1/.test(location.hash), null, {timeout: TIMEOUT});
      const want = expected("M09", {oth: true});
      await page.waitForFunction((n) => document.querySelectorAll('#c2-figure g[aria-label="bar"] rect').length === n, want.drawn.length, {timeout: TIMEOUT});
      assert.ok(want.drawn.length > before);
      const bars = await barsOf(page);
      const other = want.drawn.filter((r) => r.cell.ref_period_end !== want.ref);
      assert.ok(other.length > 0);
      for (const r of other) {
        const suffix = periodLabel(r.cell.ref_period_end, h.seriesOf("M09", r.id).frequency);
        const bar = bars.find((b) => b.label === `${r.name} (${suffix})`);
        assert.ok(bar, `${r.name} is labelled with its own period (${suffix})`);
        assert.ok(hollow(bar), `${r.name}: hollow`);
      }
      const d = await hiddenOf(page, "#c2");
      assert.deepEqual(d.items.filter((i) => i.reason === "stale").map((i) => i.id).sort(), ["FRA", "ITA"], "oth never unhides stale rows");
      assert.equal(d.items.filter((i) => i.reason === "other_period").length, 0);
      assertDisclosure(d, "C2 with oth");
    });
  });

  test("spec 4 C2: aggregates are pinned under the countries as dashed reference rows", async (t) => {
    await h.withPage(t, "/compare#i=A04", READY, async ({page}) => {
      const want = expected("A04");
      const refs = want.drawn.filter((r) => r.kind === "aggregate");
      assert.ok(refs.length > 0, "the fixture stores A04 for the aggregates");
      const labels = await tickLabels(page, "#c2-figure", "y-axis tick label");
      assert.deepEqual(labels.slice(-refs.length).sort(), refs.map((r) => r.name).sort(), "the aggregates are the last rows");
      const bars = await barsOf(page);
      assert.deepEqual(bars.filter(dashed).map((b) => b.label).sort(), refs.map((r) => r.name).sort());
    });
  });

  test("sort: Value orders by the stored value descending (default), Country A to Z; the percentile sort exists only with pc and orders by the stored percentile, nulls last", async (t) => {
    await h.withPage(t, "/compare#i=A04&pc=1", READY, async ({page}) => {
      const want = expected("A04");
      const byName = new Map(want.drawn.map((r) => [r.name, r]));
      const countriesOnly = (labels) => labels.filter((l) => byName.get(l)?.kind === "country");
      const order = () => tickLabels(page, "#c2-figure", "y-axis tick label");
      const valueOrder = countriesOnly(await order()).map((l) => byName.get(l).value);
      assert.deepEqual(valueOrder, [...valueOrder].sort((a, b) => b - a), "default: stored value, highest first");
      assert.equal(await page.locator("#c2-sort").inputValue(), "value");
      await page.selectOption("#c2-sort", "name");
      await page.waitForFunction(() => document.querySelector("#c2-sort").value === "name", null, {timeout: TIMEOUT});
      const names = countriesOnly(await order());
      assert.deepEqual(names, [...names].sort(collator), "A to Z");
      await page.selectOption("#c2-sort", "percentile");
      await page.waitForFunction(() => document.querySelector("#c2-sort").value === "percentile", null, {timeout: TIMEOUT});
      const ps = countriesOnly(await order()).map((l) => byName.get(l).percentile);
      const firstNull = ps.findIndex((p) => p === null);
      const present = firstNull === -1 ? ps : ps.slice(0, firstNull);
      assert.deepEqual(present, [...present].sort((a, b) => b - a), "stored percentile, highest first");
      if (firstNull !== -1) assert.ok(ps.slice(firstNull).every((p) => p === null), "nulls last");
      // Turning the layer off while the percentile sort is active falls back to the stored value; the select shows it.
      await page.locator("#c2-ctl-pc").uncheck();
      await page.waitForFunction(() => document.querySelector("#c2-sort")?.value === "value", null, {timeout: TIMEOUT});
    });
  });

  test("the sort select is local to the card (no hash key) and keyboard operable: focus stays on it after the card is redrawn", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const hash = await page.evaluate(() => location.hash);
      await page.focus("#c2-sort");
      await page.keyboard.type("C"); // type-ahead: "Country (A to Z)"
      await page.waitForFunction(() => document.querySelector("#c2-sort")?.value === "name", null, {timeout: TIMEOUT});
      assert.equal(await page.evaluate(() => document.activeElement?.id), "c2-sort");
      assert.equal(await page.evaluate(() => location.hash), hash, "the sort is not a hash key");
      assert.equal((await page.locator('#c2-sort option[value="name"]').innerText()).trim(), DRAFT_COMPARE_SORTS.name);
    });
  });

  test("AC-V2-31 on any export: a stored unit_code that differs among the drawn rows blocks C2 with the stored-field message; the table alternative stays", async (t) => {
    await h.withPage(t, "/compare#i=M09", "#c2[data-state=blocked]", async ({page, log}) => {
      assert.equal((await page.locator("#c2 .mm-state-blocked").innerText()).trim(), DRAFT_BLOCKED_MESSAGE(["unit code"]));
      assert.equal(await page.locator("#c2 svg").count(), 0, "no bars for a blocked selection");
      assert.ok((await page.locator('#c2 li[data-field="unit_code"]').innerText()).includes("EUR_SYNTH"));
      assert.equal((await page.locator('#c2 [data-field="reference-period"]').count()), 1, "the reference period is still printed");
      assert.equal(await page.locator("#c2-view").count(), 1, "the table alternative stays");
      cleanLog(log);
    }, {route: (ctx) => overrideSeriesMeta(ctx, (series) => {
      const first = expected("M09").drawn.find((r) => r.kind === "country");
      const id = h.cell("M09", first.id).series_id;
      series.find((s) => s.series_id === id).unit_code = "EUR_SYNTH";
    })});
  });

  test("AC-V2-81: when only stale rows remain the card shows 'No aligned values for this selection' and the disclosure, never an empty axis", async (t) => {
    await h.withPage(t, "/compare#i=M09", "#c2[data-state=empty]", async ({page, log}) => {
      assert.equal((await page.locator("#c2 .mm-state-empty").innerText()).trim(), DRAFT_NO_ALIGNED);
      assert.equal(await page.locator("#c2 svg").count(), 0, "no axis without a bar");
      const d = await hiddenOf(page, "#c2");
      assertDisclosure(d, "C2 all stale");
      const valued = [...h.countries(), ...h.aggregates()].filter((e) => hasValue(h.cell("M09", e.entity_id))).length;
      assert.equal(d.counts.stale, valued, "every row with a stored value is stale");
      assert.equal(d.counts.total, h.countries().length + h.aggregates().length);
      cleanLog(log);
    }, {route: (ctx) => overrideScorecard(ctx, "labour", (sc) => {
      for (const e of sc.entities) for (const c of e.indicators) if (c.indicator_id === "M09") c.is_stale = true;
    })});
  });

  test("D2: an indicator whose stored rank_reference_period is null shows the plain sentence and no bars; the table still lists every row", async (t) => {
    await h.withPage(t, "/compare#i=V01", "#c2[data-state=empty]", async ({page}) => {
      assert.equal((await page.locator("#c2 .mm-state-empty").innerText()).trim(), DRAFT_C2_NO_RANK_REFERENCE);
      assert.equal(await page.locator("#c2 svg").count(), 0);
      await page.locator("#c2-view > summary").click();
      assert.equal(await page.locator("#c2-table tbody tr").count(), h.countries().length + h.aggregates().length, "every row of the comparison set");
    });
  });

  test("spec 7.3: the table alternative lists every row, the drawn ones first, then the hidden ones with their stored state; the unit and reference period are in the header", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const want = expected("M09");
      await page.locator("#c2-view > summary").click();
      const rows = await page.$$eval("#c2-table tbody tr", (trs) => trs.map((tr) => ({id: tr.getAttribute("data-entity"), cells: [...tr.children].map((c) => c.textContent.trim())})));
      assert.equal(rows.length, want.rows.length);
      const drawnIds = new Set(want.drawn.map((r) => r.id));
      const firstHidden = rows.findIndex((r) => !drawnIds.has(r.id));
      assert.ok(rows.slice(0, firstHidden).every((r) => drawnIds.has(r.id)) && rows.slice(firstHidden).every((r) => !drawnIds.has(r.id)), "drawn rows first, hidden rows after");
      const fra = rows.find((r) => r.id === "FRA");
      assert.equal(fra.cells.at(-1), DRAFT_STALE_PERIOD("2025-12"));
      const head = await page.$$eval("#c2-table thead th", (ths) => ths.map((x) => x.textContent.trim()));
      assert.ok(head.some((x) => x.includes(h.indicator("M09").unit_label)), head.join(" | "));
      assert.ok((await page.locator("#c2-table caption").innerText()).includes(periodLabel(want.ref, "M")));
    });
  });

  test("Group control: limits the countries (the aggregates stay as reference rows) and the hidden counts follow the same selection", async (t) => {
    const g = h.groups.find((x) => x.group_id === "g7") ?? h.groups.find((x) => x.members.length > 1 && x.members.length < h.countries().length);
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      await page.selectOption("#c2-ctl-group", g.group_id);
      await page.waitForFunction((id) => location.hash.includes(`g=${id}`), g.group_id, {timeout: TIMEOUT});
      const want = expected("M09", {group: g.group_id});
      await page.waitForFunction((n) => document.querySelectorAll('#c2-figure g[aria-label="bar"] rect').length === n, want.drawn.length, {timeout: TIMEOUT});
      const d = await hiddenOf(page, "#c2");
      if (want.hidden.length > 0) {
        assertDisclosure(d, "C2 group");
        assert.deepEqual(d.counts, countsOf(want.hidden));
      } else assert.equal(d.present, false);
      // The stored percentile is not recomputed within the group (spec 1.1): with pc on the same stored number is shown.
      await page.locator("#c2-ctl-pc").check();
      await page.waitForFunction(() => /pc=1/.test(location.hash), null, {timeout: TIMEOUT});
      const texts = await page.$$eval('#c2-figure g[aria-label="text"] text', (ts) => ts.map((x) => x.textContent.trim()));
      const r = want.drawn.find((x) => x.percentile !== null && x.kind === "country");
      if (r) assert.ok(texts.some((x) => x.startsWith(`${r.percentile.toFixed(2)} (`)), "the stored percentile of the full panel");
    });
  });

  test("the strip offers only the controls that act on C2: Indicator (not on the fixed page), Group, Frequency, Show percentile, Include other periods; no Period, no stale, no rebase, no projection", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      const ids = await page.$$eval('form[data-chart-controls="c2"] [data-compare-control]', (els) => els.map((e) => e.getAttribute("data-compare-control")));
      assert.deepEqual(ids, ["indicator", "group", "frequency", "pc", "oth"]);
    });
    await h.withPage(t, "/indicator/M09", READY, async ({page}) => {
      const ids = await page.$$eval('form[data-chart-controls="c2"] [data-compare-control]', (els) => els.map((e) => e.getAttribute("data-compare-control")));
      assert.deepEqual(ids, ["group", "frequency", "pc", "oth"]);
    });
  });
});
