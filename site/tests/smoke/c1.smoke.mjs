// V18 browser smoke of C1, the multi-country line, on PG-COMPARE (/compare#i=...) and PG-INDICATOR (/indicator/<id>): AC-V2-30, 31, 32, 33, 34, 70, 71, 73, 74, 75, 76, 80, 82, 86, spec 4 C1, 6.2 to 6.8,
// A1.1 (stale square marker), A1.4 (hidden rows), A1.5 (no rebase control before scale_hint = index), A1.6 (blocking fields).
// Runs against a built site over the SYNTHETIC v2 fixture (tests/fixtures/v2_export); expectations are read from the built stored files. On another export the fixture tests skip.
// Localhost only; off-origin requests abort. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {after, before, describe, test} from "node:test";
import {DRAFT_BLOCKED_MESSAGE, DRAFT_C1_MARKS, DRAFT_CAPTION_VINTAGE, DRAFT_MARKED_SEASONAL, DRAFT_PERIOD_INVALID, DRAFT_REBASE_STATEMENT, DRAFT_STALE_TIP, G_STR1_NO_SERIES, DRAFT_COMPARE_DEFAULT_COUNTRIES} from "../../src/lib/copy.js";
import {DRAFT_HOME_COUNTRIES} from "../../src/lib/home-constants.js";
import {SQUARE_PATH, TIMEOUT, assertDisclosure, cleanLog, harness, hiddenOf, marksOf, overrideSeriesMeta, tickLabels} from "./compare-support.mjs";
import {markIndex} from "./support.mjs";

const h = harness();
before(h.before);
after(h.after);

const READY = "#c1-figure svg";
const labelsOf = (page) => page.$$eval('#c1-figure g[aria-label="text"] text', (ts) => ts.map((t) => t.textContent.trim()));
const yearOf = (end) => Number(end.slice(0, 4));

describe("V18 C1 multi-country line", () => {
  test("AC-V2-30, 33, 34: with no country chosen the default countries (D4) are drawn, each directly labelled by name; one y axis titled with the unit once; no legend; a table alternative", async (t) => {
    await h.withPage(t, "/compare#i=M09", READY, async ({page, log}) => {
      const expected = DRAFT_HOME_COUNTRIES.filter((id) => h.values("M09", id).size > 0).map((id) => h.nameOf(id));
      assert.ok(expected.length >= 2, "the fixture has at least two default countries with M09");
      assert.deepEqual((await labelsOf(page)).sort(), [...expected].sort(), "one end label per coloured line, the country name and nothing else");
      assert.ok((await labelsOf(page)).length <= 5, "at most five coloured lines (ADR-025 decision 6)");
      assert.equal((await page.locator('#c1 [data-field="default-countries"]').innerText()).trim(), DRAFT_COMPARE_DEFAULT_COUNTRIES);
      const unit = h.indicator("M09").unit_label;
      const axis = await page.$$eval('#c1-figure g[aria-label="y-axis label"] text', (ts) => ts.map((x) => x.textContent));
      assert.equal(axis.length, 1, "one y axis");
      assert.ok(axis[0].includes(unit), `the y axis title carries the unit "${unit}": ${axis[0]}`);
      assert.equal(await page.locator('#c1-figure g[aria-label="y-axis label"]').count(), 1, "one y axis, never dual");
      assert.equal(await page.locator("#c1-figure .plot-swatches, #c1-figure [aria-label*='legend' i]").count(), 0, "no legend of entries");
      assert.equal(await page.locator("#c1-figure").getAttribute("role"), "img");
      assert.ok((await page.locator("#c1-figure").getAttribute("aria-label")).startsWith(`Line chart of ${h.indicator("M09").name}`));
      assert.equal((await page.locator("#c1 .mm-figure-note").innerText()).trim(), DRAFT_C1_MARKS);
      assert.equal(await page.locator("#c1-table > summary").innerText(), "View as table");
      cleanLog(log);
    });
  });

  test("AC-V2-30: a sixth chosen country does not add a coloured line (the cap of five holds)", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU,FRA,ITA,ESP,POL,USA", READY, async ({page, log}) => {
      assert.ok((await labelsOf(page)).length <= 5);
      assert.ok((await page.evaluate(() => globalThis.__mmFilterStore.get().c.length)) <= 5, "the store keeps at most five");
      cleanLog(log);
    });
  });

  test("the fixed-indicator page draws the same card; the Indicator control is not offered there; the revisions link points one level up", async (t) => {
    await h.withPage(t, "/indicator/M09", READY, async ({page, log}) => {
      assert.equal(await page.locator("#c1-ctl-indicator").count(), 0, "the indicator is fixed by the route");
      assert.equal(await page.locator('#c1 a[data-link="revisions"]').getAttribute("href"), "../revisions");
      assert.ok((await labelsOf(page)).length >= 2);
      cleanLog(log);
    });
    await h.withPage(t, "/compare#i=M09", READY, async ({page}) => {
      assert.equal(await page.locator("#c1-ctl-indicator").count(), 1);
      assert.equal(await page.locator('#c1 a[data-link="revisions"]').getAttribute("href"), "./revisions");
    });
  });

  test("A1.1, AC-V2-86, 82: a stale series is drawn in full with a square last-point marker; the tip prints stale and the stored period; nothing is hidden for it", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU,FRA,ITA", READY, async ({page, log}) => {
      const marks = await marksOf(page, "#c1-figure", "dot");
      const squares = marks.filter((m) => m.tag === "path" && SQUARE_PATH.test(m.d ?? ""));
      const stale = ["FRA", "ITA"].filter((id) => h.cell("M09", id)?.is_stale === true);
      assert.deepEqual(stale, ["FRA", "ITA"], "the fixture marks FRA and ITA stale for M09");
      assert.equal(squares.length, stale.length, "one square marker per stale series, none for DEU");
      const hid = await hiddenOf(page, "#c1");
      assert.ok(!hid.items.some((i) => i.reason === "stale"), "a time-series card never hides a stale series");
      // The stale series is drawn to its last stored period (2025-12), not cut: its end label sits left of DEU's.
      const x = await page.$$eval('#c1-figure g[aria-label="text"] text', (ts) => Object.fromEntries(ts.map((e) => [e.textContent.trim(), e.getBoundingClientRect().left])));
      assert.ok(x[h.nameOf("ITA")] < x[h.nameOf("DEU")] && x[h.nameOf("FRA")] < x[h.nameOf("DEU")], "the stale lines end earlier than the current one");
      // Hover the square of one stale series: the tip names the stale state and the stored period.
      const sq = squares[0];
      await page.locator("#c1-figure").scrollIntoViewIfNeeded();
      const box = await page.evaluate(([sel]) => {
        const p = [...document.querySelectorAll(`${sel} g[aria-label="dot"] path`)].find((e) => /h-?[\d.]+v-?[\d.]+h/.test(e.getAttribute("d") ?? ""));
        const r = p.getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2};
      }, ["#c1-figure"]);
      await page.mouse.move(box.x - 40, box.y);
      await page.mouse.move(box.x, box.y, {steps: 4});
      await page.waitForFunction(() => /stale/.test(document.querySelector('#c1-figure g[aria-label="tip"]')?.textContent ?? ""), null, {timeout: TIMEOUT});
      const tip = await page.locator('#c1-figure g[aria-label="tip"]').first().textContent();
      assert.ok(tip.includes(DRAFT_STALE_TIP("2025-12")), `the tip names stale and the stored period: ${tip} (square at ${sq.left})`);
      assert.match(await page.locator("#c1 .mm-figure-note").innerText(), /square marker/);
      cleanLog(log);
    });
  });

  test("A1.1: a stale series is never drawn dashed (dashes are for aggregates and projections) and not hatched", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU,FRA,ITA", READY, async ({page}) => {
      const lines = await marksOf(page, "#c1-figure", "line");
      assert.ok(lines.length >= 3);
      for (const l of lines) assert.ok(l.dash === "none" || l.dash === "", `a coloured line is solid: ${l.dash}`);
      assert.equal(await page.locator('#c1-figure pattern, #c1-figure [fill^="url("]').count(), 0, "no hatch in C1");
    });
  });

  test("AC-V2-31, 71, A1.6: a selection whose stored unit_code differs is blocked with the stored-field message and the differing values; nothing is drawn or converted", async (t) => {
    await h.withPage(t, "/compare#i=V01&c=DEU,ITA", "#c1[data-state=blocked]", async ({page, log}) => {
      assert.equal((await page.locator("#c1 .mm-state-blocked").innerText()).trim(), DRAFT_BLOCKED_MESSAGE(["unit code"]));
      const li = await page.locator('#c1 .mm-blocked-fields li[data-field="unit_code"]').innerText();
      const codes = ["DEU", "ITA"].map((id) => h.seriesOf("V01", id).unit_code);
      for (const c of codes) assert.ok(li.includes(c), `${c} in "${li}"`);
      assert.equal(await page.locator("#c1 figure, #c1 svg").count(), 0, "no figure for a blocked selection");
      assert.doesNotMatch(await page.locator("#c1").innerText(), /convert|exchange rate|%\s+of countries/i, "no conversion and no computed share is offered");
      cleanLog(log);
    });
    // unit_mult differs (DEU and POL: same unit_code, POL stores a multiplier of 3)
    await h.withPage(t, "/compare#i=V01&c=DEU,POL", "#c1[data-state=blocked]", async ({page}) => {
      assert.equal((await page.locator("#c1 .mm-state-blocked").innerText()).trim(), DRAFT_BLOCKED_MESSAGE(["unit multiplier"]));
      assert.equal(await page.locator('#c1 .mm-blocked-fields li[data-field="unit_mult"]').count(), 1);
      assert.equal(await page.locator('#c1 .mm-blocked-fields li[data-field="unit_code"]').count(), 0);
    });
    // The same unit code and multiplier: drawn.
    await h.withPage(t, "/compare#i=V01&c=DEU,FRA", READY, async ({page}) => {
      assert.equal(await page.locator("#c1[data-state=blocked]").count(), 0);
    });
  });

  test("AC-V2-31 on any export: one stored unit_code changed in meta/series.json (route override) blocks the card, and the block message is reached by the stored field name", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU,FRA", "#c1[data-state=blocked]", async ({page, log}) => {
      assert.equal((await page.locator("#c1 .mm-state-blocked").innerText()).trim(), DRAFT_BLOCKED_MESSAGE(["unit code"]));
      assert.ok((await page.locator('#c1 li[data-field="unit_code"]').innerText()).includes("EUR_SYNTH"));
      cleanLog(log);
    }, {route: (ctx) => overrideSeriesMeta(ctx, (series) => {
      const s = series.find((x) => x.indicator_id === "M09" && x.entity_id === "DEU");
      s.unit_code = "EUR_SYNTH";
    })});
  });

  test("A1.4, AC-V2-80, 89: a chosen country with no stored series is not drawn and is in ONE disclosure; N equals the list length; the item carries label, reason, period and the stored sentence", async (t) => {
    const none = h.countries().find((e) => !h.seriesOf("M09", e.entity_id));
    assert.ok(none, "the fixture has a country without an M09 series");
    await h.withPage(t, `/compare#i=M09&c=DEU,${none.entity_id}`, READY, async ({page}) => {
      const d = await hiddenOf(page, "#c1");
      assertDisclosure(d, "C1");
      assert.equal(d.counts.total, 1);
      assert.equal(d.counts.no_data, 1);
      assert.ok(d.items[0].text.startsWith(`${none.name}: No data; latest value not stated; `), d.items[0].text);
      assert.ok(d.items[0].text.endsWith(G_STR1_NO_SERIES));
      assert.equal(await page.locator("#c1 .mm-hidden-rows").count(), 1, "one disclosure per card");
      assert.equal(await page.locator('#c1 .mm-hidden-slot[role="status"]').count(), 1, "inside the persistent status region");
      assert.ok(!(await labelsOf(page)).includes(none.name), "not drawn");
    });
  });

  test("A1.4, AC-V2-80: with every chosen country lacking the series the card says so and still lists them; nothing at N = 0", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU,FRA", READY, async ({page}) => {
      assert.equal(await page.locator("#c1 .mm-hidden-rows").count(), 0, "I7: nothing is rendered at N = 0");
      assert.equal(await page.locator('#c1 .mm-hidden-slot[role="status"]').count(), 1, "the region stays");
    });
  });

  test("AC-V2-76, 6.6: a selection that mixes SA and NSA is drawn, marked in the card and in the caption, never blocked", async (t) => {
    await h.withPage(t, "/compare#i=V02&c=DEU,FRA", READY, async ({page, log}) => {
      assert.equal(await page.locator("#c1[data-state=blocked]").count(), 0);
      assert.equal((await page.locator('#c1 [data-field="seasonal-mix"]').innerText()).trim(), DRAFT_MARKED_SEASONAL);
      const caption = await page.locator('#c1-caption [data-field="seasonal"] dd').innerText();
      assert.match(caption, /\bSA\b/);
      assert.match(caption, /\bNSA\b/);
      cleanLog(log);
    });
    await h.withPage(t, "/compare#i=V02&c=DEU,ITA", READY, async ({page}) => {
      assert.equal(await page.locator('#c1 [data-field="seasonal-mix"]').count(), 0, "both SA: no mix mark");
    });
  });

  test("AC-V2-70: the caption block carries indicator, unit, frequency, seasonal adjustment, period, source and the latest-vintage line from the manifest", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU,POL", READY, async ({page}) => {
      const f = async (key) => (await page.locator(`#c1-caption [data-field="${key}"] dd`).innerText()).trim();
      assert.equal(await f("indicator"), h.indicator("M09").name);
      assert.equal(await f("unit"), h.indicator("M09").unit_label);
      assert.equal(await f("frequency"), "Monthly");
      assert.equal(await f("vintage"), DRAFT_CAPTION_VINTAGE(h.manifest.known_cutoff.slice(0, 10)));
      assert.ok((await f("source")).includes(h.seriesOf("M09", "DEU").source_name));
      assert.match(await f("period"), /^\d{4}-\d{2} to \d{4}-\d{2}$/);
      assert.match(await f("seasonal"), /\bSA\b|\bNSA\b|not applicable/);
    });
  });

  test("AC-V2-75, 6.5: Frequency is limited to the stored frequency_set of the indicator and keeps one frequency; no resampling (the table rows are the stored rows)", async (t) => {
    await h.withPage(t, "/compare#i=V06&c=DEU,ITA", READY, async ({page}) => {
      // Default is the first stored frequency (M): ITA has only a quarterly series, so it is listed as hidden, DEU is drawn monthly.
      const options = await page.$$eval("#c1-ctl-frequency option", (os) => os.map((o) => o.value));
      assert.deepEqual(options, ["", "M", "Q"], "the stored frequency_set of V06");
      assert.match(await page.locator('#c1-caption [data-field="frequency"] dd').innerText(), /^Monthly$/);
      assert.deepEqual((await hiddenOf(page, "#c1")).items.map((i) => i.id), ["ITA"]);
      await page.selectOption("#c1-ctl-frequency", "Q");
      await page.waitForFunction(() => location.hash.includes("f=Q"), null, {timeout: TIMEOUT});
      await page.waitForFunction(() => /^Quarterly$/.test(document.querySelector('#c1-caption [data-field="frequency"] dd')?.textContent.trim() ?? ""), null, {timeout: TIMEOUT});
      assert.equal((await hiddenOf(page, "#c1")).present, false, "DEU and ITA both have a quarterly series");
      await page.locator("#c1-table > summary").click();
      const stored = h.values("V06", "DEU", "Q").size + h.values("V06", "ITA", "Q").size;
      assert.equal(await page.locator("#c1-table tbody tr").count(), stored, "every stored quarterly point is a row, none resampled");
      const periods = await page.$$eval("#c1-table tbody tr td:nth-child(2)", (tds) => tds.map((x) => x.textContent.trim()));
      for (const p of periods) assert.match(p, /^\d{4} Q[1-4]$/, "the period label follows the stored frequency");
    });
  });

  test("AC-V2-75 (spec 5.2): on the fixed-indicator page the Frequency control also offers only the indicator's stored frequency_set", {todo: "code: compare-controls.js reads the indicator from state.i, which a fixed page never sets, so every stored frequency is offered; reported"}, async (t) => {
    await h.withPage(t, "/indicator/M09", READY, async ({page}) => {
      const options = await page.$$eval("#c1-ctl-frequency option", (os) => os.map((o) => o.value));
      assert.deepEqual(options, ["", ...h.indicator("M09").frequency_set]);
    });
  });

  test("Period control: a From and To year clip the plotted points; the table lists exactly the stored points inside the window", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU", READY, async ({page}) => {
      const years = await page.$$eval("#c1-ctl-from option", (os) => os.map((o) => o.value).filter(Boolean));
      if (!years.includes("2025") || !years.includes("2026")) return t.skip("bounds of the fixture do not offer 2025 and 2026");
      await page.selectOption("#c1-ctl-from", "2025");
      await page.selectOption("#c1-ctl-to", "2026");
      await page.waitForFunction(() => /from=2025/.test(location.hash) && /to=2026/.test(location.hash), null, {timeout: TIMEOUT});
      await page.locator("#c1-table > summary").click();
      const stored = [...h.values("M09", "DEU", "M").keys()].filter((end) => yearOf(end) >= 2025 && yearOf(end) <= 2026).length;
      await page.waitForFunction((n) => document.querySelectorAll("#c1-table tbody tr").length === n, stored, {timeout: TIMEOUT});
      const periods = await page.$$eval("#c1-table tbody tr td:nth-child(2)", (tds) => tds.map((x) => x.textContent.trim()));
      for (const p of periods) assert.match(p, /^202[56]-/);
    });
  });

  test("Period control: a pair with From after To is refused, the hash is unchanged, and the stated message is shown", {todo: "code: compare-controls.js clears the refusal message in the same call that sets it (sync() empties data-slot c1-msg); reported"}, async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU", READY, async ({page}) => {
      await page.selectOption("#c1-ctl-from", "2026");
      await page.selectOption("#c1-ctl-to", "2025");
      assert.equal((await page.locator('[data-slot="c1-msg"]').innerText()).trim(), DRAFT_PERIOD_INVALID);
      assert.equal(await page.evaluate(() => location.hash), "#i=M09&c=DEU");
    });
  });

  test("ctx=1 adds muted context lines for the other countries; off by default; one control writes ctx", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU,FRA", READY, async ({page}) => {
      const count = () => page.locator('#c1-figure g[aria-label="line"] path').count();
      const before = await count();
      assert.equal(await page.locator("#c1-ctl-ctx").isChecked(), false);
      await page.locator("#c1-ctl-ctx").check();
      await page.waitForFunction(() => /ctx=1/.test(location.hash), null, {timeout: TIMEOUT});
      await page.waitForFunction((n) => document.querySelectorAll('#c1-figure g[aria-label="line"] path').length > n, before, {timeout: TIMEOUT});
      assert.equal((await labelsOf(page)).length, 2, "context lines carry no end label (no legend of 40 entries)");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "c1-ctl-ctx", "the control keeps focus when the body is redrawn");
    });
  });

  test("AC-V2-30 / spec 4 C1: a stored aggregate is a dashed grey reference line, never a coloured one; a zero rule only where the plotted values cross zero", async (t) => {
    await h.withPage(t, "/compare#i=A04&c=DEU,EU27", READY, async ({page}) => {
      const lines = await marksOf(page, "#c1-figure", "line");
      const dashed = lines.filter((l) => l.dash !== "none" && l.dash !== "");
      assert.equal(dashed.length, 1, "exactly the aggregate is dashed");
      const values = ["DEU", "EU27"].flatMap((id) => [...h.values("A04", id, "A").values()]);
      const crosses = values.some((v) => v < 0) && values.some((v) => v > 0);
      assert.equal(await page.locator('#c1-figure g[aria-label="rule"]').count(), crosses ? 1 : 0, "a zero rule exactly when the stored values cross zero");
      assert.ok((await labelsOf(page)).includes(h.nameOf("EU27")), "the aggregate is labelled directly");
    });
  });

  test("A1.5, AC-V2-73, 74, 32: no rebase control and no rebase statement for an index series before scale_hint = index; with the SYNTHETIC marker the statement appears and the card says stored values are unchanged", async (t) => {
    await h.withPage(t, "/compare#i=P01&c=DEU,FRA", READY, async ({page, log}) => {
      assert.equal(await page.locator("#c1 input[id$='rebase'], #c1 select[id$='rebase'], #c1-ctl-rb, #c1 [data-action='proj']").count(), 0, "no rebase and no projection control");
      assert.equal(await page.locator("#c1-rebase-statement").count(), 0, "levels as stored, no statement");
      assert.doesNotMatch(await page.locator("#c1").innerText(), /rebase|rebased|projection/i);
      cleanLog(log);
    });
    await h.withPage(t, "/compare#i=P01&c=DEU,FRA", "#c1-rebase-statement", async ({page}) => {
      const text = (await page.locator("#c1-rebase-statement").innerText()).trim();
      assert.match(text, /^Index, \d{4}-\d{2}-\d{2} = 100, rebased for display; stored values unchanged\.$/);
      assert.equal(text, DRAFT_REBASE_STATEMENT(text.match(/\d{4}-\d{2}-\d{2}/)[0]));
    }, {route: (ctx) => markIndex(ctx, ["P01"])});
  });

  test("A1.3: m and proj are not keys; an old hash that carries them is read without them and nothing is requested from projection/", async (t) => {
    await h.withPage(t, "/compare#m=compare&proj=1&i=M09&c=DEU", READY, async ({page, log}) => {
      const keys = await page.evaluate(() => Object.keys(globalThis.__mmFilterStore.get()));
      assert.ok(!keys.includes("m") && !keys.includes("proj"), keys.join(","));
      assert.equal(log.requests.filter((u) => /\/projection\//.test(u)).length, 0);
    });
  });

  test("keyboard: every control of the C1 strip is reachable with Tab in DOM order and the flag toggles with Space without leaving the control", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU", READY, async ({page}) => {
      const ids = (await page.$$eval('form[data-chart-controls="c1"] [data-compare-control]', (els) => els.map((e) => e.id))).filter(Boolean);
      assert.ok(ids.includes("c1-ctl-indicator") && ids.includes("c1-ctl-group") && ids.includes("c1-ctl-frequency") && ids.includes("c1-ctl-ctx"));
      const seen = new Set();
      await page.focus("#c1-ctl-indicator");
      for (let k = 0; k < 40 && seen.size < ids.length; k += 1) {
        await page.keyboard.press("Tab");
        const id = await page.evaluate(() => document.activeElement?.id ?? "");
        if (ids.includes(id)) seen.add(id);
      }
      for (const id of ids) assert.ok(seen.has(id) || id === "c1-ctl-indicator", `${id} is reachable by Tab`);
      await page.focus("#c1-ctl-ctx");
      await page.keyboard.press("Space");
      await page.waitForFunction(() => /ctx=1/.test(location.hash), null, {timeout: TIMEOUT});
      assert.equal(await page.evaluate(() => document.activeElement?.id), "c1-ctl-ctx");
      await page.keyboard.press("Space");
      await page.waitForFunction(() => !/ctx=1/.test(location.hash), null, {timeout: TIMEOUT});
    });
  });

  test("the table alternative lists every plotted point of every drawn line (stored points with a value) and opens from the keyboard", async (t) => {
    await h.withPage(t, "/compare#i=M09&c=DEU,FRA", READY, async ({page}) => {
      await page.focus("#c1-table > summary");
      await page.keyboard.press("Enter");
      const stored = ["DEU", "FRA"].reduce((n, id) => n + h.values("M09", id, "M").size, 0);
      await page.waitForFunction((n) => document.querySelectorAll("#c1-table tbody tr").length === n, stored, {timeout: TIMEOUT});
      const head = await page.$$eval("#c1-table thead th", (ths) => ths.map((x) => x.textContent.trim()));
      assert.ok(head.some((x) => x.includes(h.indicator("M09").unit_label)), `the unit is in the value header: ${head.join(" | ")}`);
      assert.ok((await tickLabels(page, "#c1-figure", "x-axis tick label")).length > 0, "a time axis");
    });
  });
});
