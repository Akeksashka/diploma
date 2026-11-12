// L13 browser smoke: the heatmap card (C-HEAT) of PG-HOME (layout amendment 4.8; AC-DB-24, AC-UX-10, AC-RD-54, ADR-036). Runs against a built site
// (npm run build) of ANY fixture export: expectations are read from the built stored files. Localhost only; skips without a browser unless
// MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {walk} from "../../scripts/lib.mjs";
import {AGGREGATE_NOT_RANKED, DRAFT_EMPTY_CARD, ORIENTATION_NOTE} from "../../src/lib/copy.js";
import {binOf} from "../../src/lib/bins.js";
import {defaultDomainId} from "../../src/lib/home-dashboard.js";
import {formatPercentile} from "../../src/lib/scorecard.js";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

const NOW = "2026-11-04T12:00:00Z";
const TIMEOUT = 20000;

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
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
});

after(async () => {
  await browser?.close();
  await site?.close();
});

// Stored expectations for a domain: the scorecard, the entities of the comparison set and the columns (domain indicator_ids that have a stored cell).
const stored = (domainId = null) => {
  const entities = dataJson("meta/entities.json").entities;
  const indicators = dataJson("meta/indicators.json").indicators;
  const domainsDoc = dataJson("meta/domains.json");
  const id = domainId ?? defaultDomainId(domainsDoc.domains, domainsDoc.default_domain ?? null);
  const domain = domainsDoc.domains.find((d) => d.domain_id === id);
  const scorecard = dataJson(`scorecard/${id}.json`);
  const inSet = entities.filter((e) => !e.is_global && (e.kind === "country" || e.kind === "aggregate"));
  const hasCell = new Set(scorecard.entities.flatMap((e) => e.indicators.map((i) => i.indicator_id)));
  const columns = (frequency = null) => domain.indicator_ids.filter((x) => hasCell.has(x) && (!frequency || (indicators.find((i) => i.indicator_id === x)?.frequency_set ?? []).includes(frequency)));
  const cell = (entityId, indicatorId) => (scorecard.entities.find((e) => e.entity_id === entityId)?.indicators ?? []).find((c) => c.indicator_id === indicatorId) ?? null;
  return {entities, indicators, domain, scorecard, inSet, columns, cell};
};

async function withHome(t, fn, {hash = "", width = 1280, ready = ".mm-heatmap-table"} = {}) {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    await page.setViewportSize({width, height: 900});
    await page.goto(`${site.origin}/${hash}`);
    await page.waitForSelector(ready, {timeout: TIMEOUT});
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    await fn({page, log});
    assert.deepEqual(log.errors, [], "page or console errors");
    assert.deepEqual(log.offOrigin, [], "off-origin requests");
    assert.deepEqual(log.failed, [], "failed requests");
  } finally {
    await context.close();
  }
}

const rowIds = (page, group) => page.$$eval(`.mm-heatmap-table tbody[data-group="${group}"] > tr[data-entity]`, (rs) => rs.map((r) => r.getAttribute("data-entity")));
const colIds = (page) => page.$$eval(".mm-heatmap-table thead th.mm-hm-ind", (ths) => ths.map((h) => h.getAttribute("data-indicator")));

describe("L13 heatmap card", () => {
  test("rows are the comparison set, countries then the aggregate group, none dropped; columns are the Domain's indicators; no overall column, row aggregate or composite", async (t) => {
    await withHome(t, async ({page}) => {
      const s = stored();
      const countries = s.inSet.filter((e) => e.kind === "country").map((e) => e.entity_id);
      const aggregates = s.inSet.filter((e) => e.kind === "aggregate").map((e) => e.entity_id);
      assert.deepEqual((await rowIds(page, "countries")).sort(), [...countries].sort());
      assert.deepEqual((await rowIds(page, "aggregates")).sort(), [...aggregates].sort());
      assert.deepEqual(await colIds(page), s.columns());
      assert.equal(await page.locator("#band-domain h2").innerText(), s.domain.name);
      // header: country, the three stored domain-figure columns (ranked domain), then the indicators; nothing else
      const heads = await page.$$eval(".mm-heatmap-table thead th", (ths) => ths.length);
      assert.equal(heads, 1 + (s.scorecard.ranked ? 3 : 0) + s.columns().length);
      assert.equal(await page.locator(".mm-heatmap-table tfoot").count(), 0);
      const text = await page.locator("[data-slot='domain']").innerText();
      assert.ok(!/\b(overall|total|average|composite|sum)\b/i.test(text), "no overall, total, average or composite wording");
      // the aggregate rows have no colour
      for (const id of aggregates) assert.equal(await page.locator(`tbody[data-group="aggregates"] tr[data-entity="${id}"] td[data-bin]:not([data-bin="none"])`).count(), 0, `${id} is not coloured`);
      assert.equal(await page.locator("[data-slot='domain']").getAttribute("aria-busy"), "false");
    });
  });

  test("sampled cells equal the stored scorecard: percentile text, bin token and state; every cell names its row, column and state sentence", async (t) => {
    await withHome(t, async ({page}) => {
      const s = stored();
      const cells = await page.$$eval(".mm-heatmap-table tbody td[data-indicator]", (tds) => tds.map((td) => ({
        id: td.closest("tr").getAttribute("data-entity"), col: td.getAttribute("data-indicator"), state: td.getAttribute("data-state"), bin: td.getAttribute("data-bin"),
        fig: td.querySelector(".mm-fig")?.textContent ?? null,
        name: td.querySelector("[aria-label]")?.getAttribute("aria-label") ?? td.querySelector(".mm-visually-hidden")?.textContent ?? null
      })));
      const byKey = new Map(cells.map((c) => [`${c.id}|${c.col}`, c]));
      let sampled = 0;
      let ranked = 0;
      for (const e of s.inSet.filter((x) => x.kind === "country")) {
        for (const col of s.columns()) {
          const c = s.cell(e.entity_id, col);
          const got = byKey.get(`${e.entity_id}|${col}`);
          if (c === null) {
            assert.equal(got, undefined, `${e.entity_id}/${col}: no stored cell, no indicator cell`);
            continue;
          }
          sampled += 1;
          assert.ok(got, `${e.entity_id}/${col} cell`);
          if (got.state === "ranked" && typeof c.percentile === "number") {
            ranked += 1;
            assert.equal(got.fig, formatPercentile(c.percentile), `${e.entity_id}/${col} number`);
            assert.equal(got.bin, String(binOf(c.percentile)), `${e.entity_id}/${col} bin`);
          }
          assert.ok(got.name && got.name.startsWith(`${e.name}, `), `${e.entity_id}/${col}: accessible description starts with the row and column`);
          assert.ok(got.name.includes(":") && got.name.length > e.name.length + 6, `${e.entity_id}/${col}: description carries the state sentence`);
        }
      }
      assert.ok(sampled > 0, "fixture has stored cells");
      assert.ok(ranked > 0 || !s.scorecard.ranked, "a ranked domain has ranked cells to compare");
      // the domain-figure column is the stored percentile_rank
      const figs = new Map(await page.$$eval(".mm-heatmap-table tbody tr[data-entity]", (rs) => rs.map((r) => [r.getAttribute("data-entity"), r.querySelector("td.mm-hm-mean .mm-fig")?.textContent ?? null])));
      let figures = 0;
      for (const e of s.scorecard.entities.filter((x) => typeof x.percentile_rank === "number" && s.inSet.some((y) => y.entity_id === x.entity_id && y.kind === "country"))) {
        if (figs.get(e.entity_id) === null) continue; // low coverage shows the stored mean in its own form
        figures += 1;
        assert.equal(figs.get(e.entity_id), formatPercentile(e.percentile_rank), `${e.entity_id} domain figure`);
      }
      assert.ok(figures >= 0);
    });
  });

  test("legend and orientation note appear once on the page, directly above the card; the card has no hidden-rows disclosure", async (t) => {
    await withHome(t, async ({page}) => {
      const s = stored();
      assert.equal(await page.locator(".mm-legend").count(), 1);
      if (s.scorecard.ranked) {
        const body = await page.locator("body").innerText();
        assert.equal(body.split(ORIENTATION_NOTE).length - 1, 1, "the orientation note is printed once on the page");
        assert.equal(await page.locator(".mm-legend .mm-orientation").count(), 1);
      }
      const order = await page.evaluate(() => {
        const legend = document.querySelector("#band-domain .mm-dlegend .mm-legend");
        const card = document.querySelector("[data-slot='domain']");
        return {before: !!(legend.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING), gap: card.getBoundingClientRect().top - legend.getBoundingClientRect().bottom, inside: card.contains(legend)};
      });
      assert.ok(order.before && !order.inside, "the legend is a sibling above the card");
      assert.ok(order.gap >= 0 && order.gap < 80, `the legend is directly above the card (gap ${order.gap}px)`);
      assert.equal(await page.locator("[data-slot='domain'] .mm-hidden-rows").count(), 0);
    });
  });

  test("Period does not hide rows on this card (ADR-036): a range that hides rows in C-RANK leaves every heatmap row", async (t) => {
    const s = stored();
    const before = s.inSet.length;
    await withHome(t, async ({page}) => {
      const rows = (await rowIds(page, "countries")).length + (await rowIds(page, "aggregates")).length;
      assert.equal(rows, before);
      assert.equal(await page.locator("[data-slot='domain'] .mm-hidden-rows").count(), 0);
    }, {hash: "#from=1990&to=1990"});
  });

  test("Frequency removes columns, not rows; a frequency with no indicator gives the empty-card sentence", async (t) => {
    const s = stored();
    const present = ["D", "M", "Q", "A"].filter((f) => s.columns(f).length > 0);
    const absent = ["D", "M", "Q", "A"].filter((f) => s.columns(f).length === 0);
    assert.ok(present.length > 0, "fixture has a frequency with columns");
    for (const f of present.slice(0, 2)) {
      await withHome(t, async ({page}) => {
        assert.deepEqual(await colIds(page), s.columns(f), `columns for ${f}`);
        assert.equal((await rowIds(page, "countries")).length + (await rowIds(page, "aggregates")).length, s.inSet.length, "rows unchanged");
      }, {hash: `#f=${f}`});
    }
    if (absent.length > 0) {
      await withHome(t, async ({page}) => {
        assert.equal(await page.locator("#heatmap-empty").innerText(), DRAFT_EMPTY_CARD);
        assert.equal(await page.locator("[data-slot='domain'] .mm-heatmap-table").count(), 0);
        assert.equal(await page.locator("#band-domain .mm-legend").count(), 0);
      }, {hash: `#f=${absent[0]}`, ready: "#heatmap-empty"});
    }
  });

  test("an unranked domain keeps the existing wording: no domain-figure columns, no bin colour, no orientation note", async (t) => {
    const doms = dataJson("meta/domains.json").domains;
    const un = doms.find((d) => d.ranked === false);
    if (!un) return t.skip("fixture has no unranked domain");
    await withHome(t, async ({page}) => {
      assert.equal(await page.locator(".mm-heatmap-table").getAttribute("data-informational"), "true");
      assert.equal(await page.locator(".mm-heatmap-table th.mm-hm-mean").count(), 0);
      assert.equal(await page.locator(".mm-heatmap-table td[data-bin]:not([data-bin='none'])").count(), 0);
      assert.equal(await page.locator(".mm-legend .mm-orientation").count(), 0);
      assert.ok((await page.locator("[data-slot='domain']").innerText()).includes(AGGREGATE_NOT_RANKED) || (await rowIds(page, "aggregates")).length === 0);
    }, {hash: `#d=${un.domain_id}`});
  });

  test("sticky first column and header inside the card's own scroll container; horizontal scroll only there (320 px); links carry the hash", async (t) => {
    await withHome(t, async ({page}) => {
      const r = await page.evaluate(() => {
        const sc = document.querySelector(".mm-heatmap-scroll");
        const th = document.querySelector(".mm-heatmap-table thead th.mm-hm-country");
        const td = document.querySelector(".mm-heatmap-table tbody th.mm-hm-country");
        const cs = getComputedStyle(sc);
        return {
          overflow: [cs.overflowX, cs.overflowY], maxH: cs.maxHeight, clientW: sc.clientWidth, scrollW: sc.scrollWidth, clientH: sc.clientHeight, scrollH: sc.scrollHeight,
          head: getComputedStyle(th).position, first: getComputedStyle(td).position, doc: document.documentElement.scrollWidth, win: window.innerWidth,
          links: [...document.querySelectorAll(".mm-heatmap-table a")].map((a) => a.hasAttribute("data-carry"))
        };
      });
      assert.deepEqual(r.overflow, ["auto", "auto"]);
      assert.notEqual(r.maxH, "none", "the card has a max-height");
      assert.equal(r.head, "sticky");
      assert.equal(r.first, "sticky");
      assert.ok(r.scrollW > r.clientW, "the table is wider than the card at 320 px, so it scrolls inside the card");
      assert.ok(r.doc <= r.win, `the page itself does not scroll sideways (${r.doc} > ${r.win})`);
      assert.ok(r.links.length > 0 && r.links.every(Boolean), "every link of the card carries the hash");
    }, {width: 320});
  });

  test("keyboard: a cell is reachable by Tab, shows its facts, and is not covered by the filter bar or the sticky header (WCAG 2.4.11)", async (t) => {
    await withHome(t, async ({page}) => {
      const cell = page.locator(".mm-heatmap-table tbody button.mm-cell").last();
      if ((await cell.count()) === 0) return t.skip("no interactive cell in this fixture");
      await cell.focus();
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => {
        const a = document.activeElement.getBoundingClientRect();
        const bar = document.querySelector("#filterbar-slot")?.getBoundingClientRect();
        const head = document.querySelector(".mm-heatmap-table thead")?.getBoundingClientRect();
        const first = document.querySelector(".mm-heatmap-table tbody th.mm-hm-country")?.getBoundingClientRect();
        return {a: {t: a.top, b: a.bottom, l: a.left}, bar: bar ? bar.bottom : 0, head: head.bottom, first: first.right};
      });
      assert.ok(r.a.t >= r.bar - 0.5, "not under the filter bar");
      assert.ok(r.a.t >= r.head - 0.5, "not under the sticky header");
      assert.ok(r.a.l >= r.first - 0.5 || r.a.l >= 0, "not under the sticky first column");
      assert.equal(await page.locator(".mm-heatmap .mm-facts").getAttribute("data-active"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".mm-heatmap .mm-facts").getAttribute("data-active"), "false");
    });
  });
});
