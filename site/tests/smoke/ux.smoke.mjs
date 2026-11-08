// T107 UX smoke (ADR-025 AC-UX-3, 4, 6, 7, 12) over V1-V4 of a built fixture site. Localhost only; off-origin requests abort.
// Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1 (CI). Screenshots go to site/test-artifacts/ (git-ignored).
// Upload as a CI artifact awaits an OP-07 commit SHA for actions/upload-artifact (blocker B5); not added.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {after, before, describe, test} from "node:test";
import {fileURLToPath} from "node:url";
import {contrastRatio, resolveThemes} from "../../scripts/lib/contrast.mjs";
import {NON_COLOUR_PREFIXES} from "../../scripts/contrast-pairs.mjs";
import {DIST, REQUIRE_BROWSER, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";
import {
  SCHEMES,
  VIEWPORTS,
  ARTIFACT_DIR,
  computedTokens,
  cssToHex,
  focusables,
  horizontalOverflow,
  installCls,
  interactiveTargets,
  readCls,
  requiredTextRatio,
  sampleTextColours,
  screenshot,
  setForcedColors,
  setPrint,
  setReducedMotion,
  setTheme,
  setViewport,
  tabTraversal
} from "./ux-support.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = "2026-11-04T12:00:00Z";
const builtJson = (stem) => {
  const dir = join(DIST, "_file", "data", "scorecard");
  const f = readdirSync(dir).find((n) => new RegExp(`^${stem}\\.[0-9a-f]+\\.json$`).test(n));
  return JSON.parse(readFileSync(join(dir, f), "utf8"));
};
const TIMEOUT = 20000;
// V1 (landing and a domain scorecard), V2, V3, V4. Selector = content that proves the page rendered its data.
const PAGES = [
  ["V1 landing", "/", "#country-list li"],
  ["PG-DOMAINS", "/domains", "#domain-list li"],
  ["V1 domain", "/domain/labour", "#domain-heatmap tbody tr"],
  ["PG-INDICATOR", "/indicator/M09", "#indicator-table tbody tr"],
  ["PG-COUNTRY", "/country/DEU", ".mm-country-domain table tbody tr"],
  ["V3 explorer", "/explorer#i=M09&c=FRA,DEU,IND,ITA,JPN", "#series-captions tbody tr"],
  ["V4 revisions", "/revisions", "#recent-revisions tbody tr"]
];
const slug = (p) => (p === "/" ? "index" : p.replace(/^\//, "").replace(/\//g, "-"));

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

async function withPage(t, path, ready, fn, {before: prep = null} = {}) {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
  try {
    if (prep) await prep(page);
    await page.goto(`${site.origin}${path}`);
    await page.waitForSelector(ready, {timeout: TIMEOUT});
    await page.waitForLoadState("networkidle");
    await fn({page, log});
    assert.deepEqual(log.offOrigin, [], "off-origin requests");
  } finally {
    await context.close();
  }
}

describe("AC-UX-3: computed colours in both colour schemes", () => {
  const themes = resolveThemes(readFileSync(join(here, "..", "..", "src", "style.css"), "utf8"), NON_COLOUR_PREFIXES);
  for (const scheme of SCHEMES) {
    for (const [name, path, ready] of PAGES) {
      test(`${name} ${scheme}`, async (t) => {
        await withPage(t, path, ready, async ({page, log}) => {
          await setTheme(page, scheme);
          assert.equal(await page.evaluate((s) => matchMedia(`(prefers-color-scheme: ${s})`).matches, scheme), true);
          // 1. the tokens the page resolves equal style.css for this scheme (the library's own parse of the file)
          const got = await computedTokens(page, Object.keys(themes[scheme]));
          for (const [tok, hex] of Object.entries(themes[scheme])) assert.equal(got[tok].toLowerCase(), hex, `${scheme} ${tok}`);
          // 2. every visible text element: computed colour on its effective opaque background
          const samples = await sampleTextColours(page);
          assert.ok(samples.length > 10, `only ${samples.length} text samples`);
          const bad = [];
          let skipped = 0;
          const skippedWhy = [];
          for (const s of samples) {
            const fg = cssToHex(s.color);
            const bg = s.bg && cssToHex(s.bg);
            if (!fg || !bg || fg.alpha < 1) {
              skipped++;
              skippedWhy.push(`${s.el} color=${s.color} bg=${s.bg} ${s.why ?? ""}`);
              continue;
            }
            const need = requiredTextRatio(s);
            const r = contrastRatio(fg.hex, bg.hex);
            if (r < need) bad.push(`${s.el} "${s.text}" ${fg.hex} on ${bg.hex} = ${r.toFixed(2)} < ${need}`);
          }
          assert.deepEqual(bad, [], `${bad.length} low-contrast text samples (${samples.length} sampled, ${skipped} skipped)`);
          assert.ok(skipped <= samples.length / 4, `${skipped} of ${samples.length} samples had no resolvable opaque colours: ${skippedWhy.slice(0, 3).join(" | ")}`);
          assert.deepEqual(log.errors, []);
        });
      });
    }
  }
});

describe("AC-UX-4: keyboard, focus, targets", () => {
  for (const [name, path, ready] of PAGES) {
    test(`${name}: tab traversal, skip link, focus indicator, not covered`, async (t) => {
      await withPage(t, path, ready, async ({page}) => {
        const expected = await focusables(page);
        assert.ok(expected.length > 2, "page has focusable controls");
        const {stops, trap, left, pressed} = await tabTraversal(page);
        assert.equal(trap, null, `focus trap at ${trap}`);
        assert.ok(left || pressed >= expected.length, "Tab neither left the page nor covered every control");
        // skip link is the first stop and moves focus to main content
        assert.match(stops[0].id, /^a/, "first stop is a link");
        assert.equal(await page.evaluate(() => document.querySelector(".mm-skip") !== null), true, "skip link present");
        // every control reachable
        assert.ok(stops.length >= expected.length, `Tab reached ${stops.length} of ${expected.length} focusable elements`);
        const problems = [];
        for (const s of stops) {
          if (s.outlineStyle === "none" || s.outlineWidth < 2) problems.push(`${s.id}: outline ${s.outlineStyle} ${s.outlineWidth}px`);
          else {
            const fg = cssToHex(s.outlineColor);
            const bg = s.bg && cssToHex(s.bg);
            if (!fg || !bg) problems.push(`${s.id}: cannot resolve focus ring colour ${s.outlineColor} on ${s.bg}`);
            else {
              const r = contrastRatio(fg.hex, bg.hex);
              if (r < 3) problems.push(`${s.id}: focus ring ${fg.hex} on ${bg.hex} = ${r.toFixed(2)} < 3`);
            }
          }
          if (s.covering.length) problems.push(`${s.id}: covered by ${s.covering.join(", ")}`);
          if (!s.inViewport) problems.push(`${s.id}: focused but outside the viewport`);
        }
        assert.deepEqual(problems, []);
      });
    });

    test(`${name}: skip link moves focus to main`, async (t) => {
      await withPage(t, path, ready, async ({page}) => {
        await page.keyboard.press("Tab");
        const first = await page.evaluate(() => document.activeElement?.className ?? "");
        assert.match(String(first), /mm-skip/, "first Tab stop is the skip link");
        await page.keyboard.press("Enter");
        const where = await page.evaluate(() => ({hash: location.hash, id: document.activeElement?.id || document.activeElement?.localName}));
        assert.ok(where.hash.length > 1, "skip link navigates to an anchor");
        const target = await page.evaluate(() => document.querySelector(location.hash)?.closest("main, #observablehq-main") !== null || document.querySelector(location.hash)?.id === "observablehq-main");
        assert.ok(target, `${where.hash} is the main content`);
      });
    });

    test(`${name}: targets are at least 24 x 24 CSS px`, async (t) => {
      await withPage(t, path, ready, async ({page}) => {
        const small = (await interactiveTargets(page)).filter((x) => x.w < 24 - 0.01 || x.h < 24 - 0.01);
        assert.deepEqual(small.map((x) => `${x.el} ${x.w.toFixed(1)}x${x.h.toFixed(1)}`), []);
      });
    });
  }
});

describe("AC-UX-6: no page-level horizontal scroll at 320/390/768/1280/1920", () => {
  for (const [name, path, ready] of PAGES) {
    test(name, async (t) => {
      await withPage(t, path, ready, async ({page}) => {
        const failures = [];
        for (const w of VIEWPORTS) {
          await setViewport(page, w);
          await page.waitForTimeout(100);
          const o = await horizontalOverflow(page);
          if (o.scrollW > o.vw) failures.push(`${w}px: scrollWidth ${o.scrollW} > ${o.vw}; outside a scroll container: ${o.offenders.join("; ") || "none found"}`);
        }
        assert.deepEqual(failures, []);
      });
    });
  }
});

describe("AC-UX-12: cumulative layout shift at most 0.1", () => {
  for (const [name, path, ready] of PAGES) {
    test(name, async (t) => {
      await withPage(
        t,
        path,
        ready,
        async ({page}) => {
          await page.waitForTimeout(500);
          const {cls, unsupported} = await readCls(page);
          assert.equal(unsupported, false, "layout-shift entries unsupported in this browser");
          assert.ok(cls !== null && cls <= 0.1, `CLS ${cls} > 0.1 (headless Chromium)`);
        },
        {before: installCls}
      );
    });
  }
});

describe("AC-UX-7: review screenshots (light, dark, print) and media emulation", () => {
  for (const [name, path, ready] of PAGES) {
    test(name, async (t) => {
      await withPage(t, path, ready, async ({page}) => {
        const files = [];
        for (const scheme of SCHEMES) {
          await setTheme(page, scheme);
          files.push(await screenshot(page, slug(path), scheme));
        }
        await setTheme(page, "light");
        await setPrint(page);
        assert.equal(await page.evaluate(() => matchMedia("print").matches), true);
        files.push(await screenshot(page, slug(path), "print"));
        await setPrint(page, false);
        assert.equal(files.length, 3);
        for (const f of files) assert.ok(f.startsWith(ARTIFACT_DIR));
      });
    });
  }

  test("forced-colors and reduced-motion emulation reach the page; focus ring survives forced colours", async (t) => {
    await withPage(t, "/revisions", "#recent-revisions tbody tr", async ({page}) => {
      await setForcedColors(page);
      await setReducedMotion(page);
      assert.equal(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
      assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
      await page.keyboard.press("Tab");
      const o = await page.evaluate(() => {
        const cs = getComputedStyle(document.activeElement);
        return {style: cs.outlineStyle, width: parseFloat(cs.outlineWidth)};
      });
      assert.ok(o.style !== "none" && o.width >= 2, `focus outline in forced colours: ${o.style} ${o.width}px`);
      const moving = await page.evaluate(() =>
        [...document.querySelectorAll("body *")].filter((e) => {
          const cs = getComputedStyle(e);
          return (cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0) || parseFloat(cs.transitionDuration) > 0;
        }).length
      );
      assert.equal(moving, 0, "elements still animate or transition under reduced motion");
    });
  });
});

// ------------------------------------------------------------------------------------------------------------------
// T113: Stage 1, the V1 domain heatmap (AC-UX-2 browser half, AC-UX-5, AC-UX-10, AC-UX-15 on the built fixture site).
const HM = "#domain-heatmap tbody tr";
const HM_PAGES = ["labour", "prices", "agri", "global", "fin"];

describe("T113 AC-UX-2: states are told apart without colour", () => {
  test("every rendered state has its own DOM signature; under grayscale each state's cell image differs (same run)", async (t) => {
    const bySig = new Map(); // state key -> signature, over the domains that render states
    const shots = new Map(); // state key -> sha256 of the grayscale cell image, taken in one page of one run
    for (const d of HM_PAGES) {
      await withPage(t, `/domain/${d}`, HM, async ({page}) => {
        await page.addStyleTag({content: "html { filter: grayscale(1); }"});
        const cells = await page.$$eval("#domain-heatmap td[data-state]", (tds) => tds.map((td) => ({key: td.getAttribute("data-state"), sig: td.getAttribute("data-signature"), bin: td.getAttribute("data-bin"), text: td.innerText.trim()})));
        assert.ok(cells.length > 0);
        for (const c of cells) {
          assert.ok(c.sig, `${d}: a ${c.key} cell has no data-signature`);
          assert.ok(!bySig.has(c.key) || bySig.get(c.key).startsWith(c.sig.split("+")[0]), `${d}: state ${c.key} has two signatures`);
          bySig.set(c.key, c.sig);
          if (!shots.has(c.key)) {
            const el = page.locator(`#domain-heatmap td[data-state="${c.key}"]`).first();
            await el.scrollIntoViewIfNeeded();
            shots.set(c.key, createHash("sha256").update(await el.screenshot()).digest("hex"));
          }
        }
        if (d === "labour") await screenshot(page, "v1-domain-labour", "grayscale");
      });
    }
    const sigs = [...bySig.values()].map((x) => x.split("+")[0]);
    assert.equal(new Set(sigs).size, sigs.length, `signatures not pairwise distinct: ${[...bySig].map(([k, v]) => `${k}=${v}`).join(", ")}`);
    for (const k of ["ranked", "stale", "lagging", "unaligned", "descriptive", "na", "aggregate", "low_coverage", "inherited", "plain"]) assert.ok(bySig.has(k), `the fixture does not render state ${k}`);
    // hashes are compared within this run only (antialiasing differs between runs); the DOM signatures above are the primary check
    assert.equal(new Set(shots.values()).size, shots.size, "two states produced the same cell image under grayscale");
  });

  test("a deuteranopia-filtered screenshot is saved as a review artifact (not asserted)", async (t) => {
    await withPage(t, "/domain/labour", HM, async ({page}) => {
      await page.evaluate(() => {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
        svg.innerHTML = '<filter id="mm-deut"><feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0"/></filter>';
        document.body.append(svg);
        document.documentElement.setAttribute("data-filter", "deuteranopia");
      });
      await page.addStyleTag({content: 'html[data-filter="deuteranopia"] { filter: url(#mm-deut); }'});
      assert.ok((await screenshot(page, "v1-domain-labour", "deuteranopia")).endsWith("deuteranopia.png"));
    });
  });
});

describe("T113 AC-UX-5 and AC-UX-15: table semantics, legend, orientation", () => {
  for (const d of HM_PAGES) {
    test(`/domain/${d}`, async (t) => {
      await withPage(t, `/domain/${d}`, HM, async ({page}) => {
        const r = await page.evaluate(() => {
          const table = document.querySelector("#domain-heatmap");
          const ths = [...table.querySelectorAll("th")];
          const scroll = document.querySelector(".mm-heatmap-scroll");
          const cs = (el) => getComputedStyle(el);
          const orient = document.querySelector("#domain-heatmap th[aria-describedby]");
          return {
            caption: table.querySelector("caption")?.innerText.trim() ?? "",
            thWithoutScope: ths.filter((th) => !th.getAttribute("scope")).length,
            emptyCells: [...table.querySelectorAll("td")].filter((td) => td.textContent.trim() === "").length,
            groups: table.querySelectorAll("tbody").length,
            sortButtons: [...table.querySelectorAll("th button[data-sort]")].every((b) => b.closest("th").hasAttribute("aria-sort")),
            sticky: [cs(table.querySelector("thead th")).position, cs(table.querySelector("tbody th[scope=row]")).position],
            scrollOverflow: [cs(scroll).overflowX, scroll.getAttribute("tabindex")],
            hint: document.querySelector(".mm-scroll-hint")?.innerText.trim() ?? "",
            described: orient ? document.getElementById(orient.getAttribute("aria-describedby"))?.textContent.trim() ?? "" : null,
            legend: [...document.querySelectorAll(".mm-legend")].length,
            note: (document.querySelector("#domain-legend")?.innerText ?? "").split("Higher percentile means a more favourable position by each indicator's stated direction.").length - 1,
            bins: [...document.querySelectorAll(".mm-legend-bins li")].map((li) => li.innerText.trim()),
            order: (() => { const c = document.querySelector("#caveat"); const l = document.querySelector("#domain-legend"); return Boolean(c && l && (c.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)); })(),
            detailInDom: document.querySelectorAll("#domain-detail").length,
            detailOpen: document.querySelector("#domain-values").open,
            detailSummary: document.querySelector("#domain-values > summary").innerText.trim()
          };
        });
        assert.ok(r.caption.length > 10, "caption");
        assert.equal(r.thWithoutScope, 0);
        assert.equal(r.emptyCells, 0, "every cell has text");
        assert.deepEqual(r.sticky, ["sticky", "sticky"]);
        assert.deepEqual(r.scrollOverflow, ["auto", "0"]);
        assert.match(r.hint, /^Scroll sideways/);
        assert.ok(r.sortButtons);
        assert.equal(r.legend, 1);
        assert.equal(r.detailInDom, 1);
        assert.equal(r.detailOpen, false);
        assert.equal(r.detailSummary, "Values and reference periods");
        if (["agri", "global", "fin"].includes(d)) {
          assert.equal(r.note, 0, "informational domain: no percentile, so no orientation note");
          assert.deepEqual(r.bins, []);
          assert.match(await page.innerText("#domain-heatmap"), /informational, unranked/);
        } else {
          assert.equal(r.note, 1, "the orientation note is visible once in the legend");
          assert.ok(r.described && r.described.startsWith("Higher percentile means"), "aria-describedby target exists and is non-empty");
          assert.equal(r.bins.length, 5);
          assert.equal(r.bins[0], "lowest fifth of the panel");
          assert.equal(r.bins[4], "highest fifth of the panel");
          assert.ok(r.order, "the caveat precedes the legend in DOM order");
          assert.equal(r.groups, d === "labour" ? 2 : 1, "countries and aggregates are separate row groups (aggregates only where the scorecard has one)");
        }
      });
    });
  }

  test("the legend lists only the states present on the page, as glyph + word", async (t) => {
    await withPage(t, "/domain/prices", HM, async ({page}) => {
      const keys = await page.$$eval(".mm-legend-states li", (li) => li.map((x) => x.getAttribute("data-state")));
      const present = await page.$$eval("#domain-heatmap td[data-state]", (tds) => [...new Set(tds.map((td) => td.getAttribute("data-state")))]);
      for (const k of keys) assert.ok(present.includes(k) || ["estimate", "alert_watch", "alert_alert"].includes(k), `legend lists ${k}, not on the page`);
      assert.ok(keys.includes("inherited"));
      assert.ok(!keys.includes("stale"));
      assert.equal(await page.locator(".mm-legend-states li svg[aria-hidden='true']").count() > 0, true);
    });
  });
});

describe("T113 AC-UX-10: numbers and bins equal the published scorecard JSON", () => {
  const BIN = (p) => (p < 0.2 ? 1 : p < 0.4 ? 2 : p < 0.6 ? 3 : p < 0.8 ? 4 : 5);
  for (const d of ["labour", "prices"]) {
    test(`/domain/${d}: every ranked cell and domain figure`, async (t) => {
      const sc = builtJson(d);
      await withPage(t, `/domain/${d}`, HM, async ({page}) => {
        let checked = 0;
        for (const e of sc.entities) {
          for (const i of e.indicators) {
            if (typeof i.percentile !== "number" || i.is_stale === true || i.alignment === "lagging" || i.alignment === "unaligned") continue;
            const td = page.locator(`#domain-heatmap tr[data-entity="${e.entity_id}"] td[data-indicator="${i.indicator_id}"]`);
            assert.equal((await td.locator(".mm-fig").first().innerText()).trim(), i.percentile.toFixed(2), `${d}/${e.entity_id}/${i.indicator_id}`);
            assert.equal(await td.getAttribute("data-bin"), String(BIN(i.percentile)));
            checked += 1;
          }
          if (typeof e.percentile_rank === "number" && e.n_available > 0 && e.indicators.length > 0) {
            const fig = page.locator(`#domain-heatmap tr[data-entity="${e.entity_id}"] td.mm-hm-mean`);
            const agg = (await fig.getAttribute("data-state")) === "aggregate";
            if (!agg) {
              assert.equal((await fig.locator(".mm-fig").first().innerText()).trim(), e.percentile_rank.toFixed(2));
              assert.equal(await fig.getAttribute("data-bin"), String(BIN(e.percentile_rank)));
            }
          }
        }
        assert.ok(checked >= 2, `only ${checked} cells checked`);
        const dir = await page.$$eval("#domain-heatmap th[data-indicator] .mm-hm-dir", (x) => x.map((n) => n.innerText.trim()));
        assert.ok(dir.every((x) => ["higher is better", "lower is better", "descriptive, not ranked"].includes(x) || x.startsWith("closer to target is better")), dir.join(" | "));
      });
    });
  }
});

describe("T113 T112: sorting, facts on focus, Escape, skip link", () => {
  test("a click on an indicator header orders by the stored percentile (desc, then asc), nulls last; aria-sort follows", async (t) => {
    const sc = builtJson("labour");
    const stored = (id) => new Map(sc.entities.map((e) => [e.entity_id, e.indicators.find((i) => i.indicator_id === id)]));
    await withPage(t, "/domain/labour", HM, async ({page}) => {
      const order = () => page.$$eval('#domain-heatmap tbody[data-group="countries"] tr', (r) => r.map((x) => x.getAttribute("data-entity")));
      const shownP = (ind) => (ind && typeof ind.percentile === "number" && !ind.is_stale && ind.alignment !== "lagging" && ind.alignment !== "unaligned" ? ind.percentile : null);
      const names = await page.$$eval('#domain-heatmap tbody[data-group="countries"] tr', (r) => r.map((x) => [x.getAttribute("data-entity"), x.querySelector("th").innerText.trim()]));
      const nameOf = new Map(names);
      const expected = (id, dir) => {
        const m = stored(id);
        return [...nameOf.keys()].sort((a, b) => {
          const pa = shownP(m.get(a));
          const pb = shownP(m.get(b));
          if (pa === null || pb === null) return pa === null && pb === null ? nameOf.get(a).localeCompare(nameOf.get(b)) : pa === null ? 1 : -1;
          return (dir === "desc" ? pb - pa : pa - pb) || nameOf.get(a).localeCompare(nameOf.get(b));
        });
      };
      assert.deepEqual(await order(), [...nameOf.keys()].sort((a, b) => nameOf.get(a).localeCompare(nameOf.get(b))), "default order is alphabetical");
      assert.equal(await page.getAttribute('#domain-heatmap th.mm-hm-country', "aria-sort"), "ascending");
      for (const id of ["M09", "M10"]) {
        await page.click(`#domain-heatmap button[data-sort="${id}"]`);
        assert.deepEqual(await order(), expected(id, "desc"), `${id} desc`);
        assert.equal(await page.getAttribute(`#domain-heatmap th[data-indicator="${id}"]`, "aria-sort"), "descending");
        assert.equal(await page.getAttribute("#domain-heatmap th.mm-hm-country", "aria-sort"), "none");
        await page.click(`#domain-heatmap button[data-sort="${id}"]`);
        assert.deepEqual(await order(), expected(id, "asc"), `${id} asc`);
        assert.equal(await page.getAttribute(`#domain-heatmap th[data-indicator="${id}"]`, "aria-sort"), "ascending");
      }
      // the domain figure column orders by the stored rank_position, nulls last
      await page.click('#domain-heatmap button[data-sort="mean"]');
      const pos = new Map(sc.entities.map((e) => [e.entity_id, typeof e.rank_position === "number" ? e.rank_position : null]));
      const got = (await order()).map((e) => pos.get(e));
      const ranked = got.filter((x) => x !== null);
      assert.deepEqual(ranked, [...ranked].sort((a, b) => a - b));
      assert.deepEqual(got, [...ranked, ...got.filter((x) => x === null)], "nulls are last");
      assert.equal(await page.locator('#domain-heatmap tbody[data-group="aggregates"] tr[data-entity]').count(), 1, "aggregates stay in their group");
    });
  });

  test("focusing a cell shows its stored facts; Escape hides them and keeps focus; Tab is never trapped", async (t) => {
    const sc = builtJson("labour");
    const deu = sc.entities.find((e) => e.entity_id === "DEU").indicators.find((i) => i.indicator_id === "M09");
    await withPage(t, "/domain/labour", HM, async ({page}) => {
      const panel = page.locator("#domain-heatmap-facts");
      assert.equal(await panel.getAttribute("data-active"), "false");
      assert.equal(await panel.getAttribute("aria-hidden"), "true");
      const btn = page.locator('#domain-heatmap tr[data-entity="DEU"] td[data-indicator="M09"] button');
      await btn.focus();
      assert.equal(await panel.getAttribute("data-active"), "true");
      const text = await panel.innerText();
      for (const want of [String(deu.value), deu.ref_period_end, String(deu.ref_offset_days), deu.source_release_at.slice(0, 10), String(deu.age_days), String(deu.stale_limit_days)]) assert.ok(text.includes(want), `facts lack ${want}: ${text}`);
      const reserved = (await panel.boundingBox()).height;
      assert.ok(reserved >= 60);
      await page.keyboard.press("Escape");
      assert.equal(await panel.getAttribute("data-active"), "false");
      assert.equal(await page.evaluate(() => document.activeElement?.closest("td")?.getAttribute("data-indicator")), "M09", "focus stays on the cell");
      await page.keyboard.press("Tab");
      assert.notEqual(await page.evaluate(() => document.activeElement?.closest("td")?.getAttribute("data-indicator") + document.activeElement?.closest("tr")?.getAttribute("data-entity")), "M09DEU", "Tab moves on");
      // the same facts are in the detail table (not tooltip-only)
      await page.evaluate(() => { document.querySelector("#domain-values").open = true; });
      const row = (await page.locator('#domain-detail tr[data-entity="DEU"][data-indicator="M09"]').innerText());
      for (const want of [deu.ref_period_end, String(deu.ref_offset_days), deu.source_release_at.slice(0, 10), String(deu.age_days)]) assert.ok(row.includes(want), `detail row lacks ${want}`);
    });
  });

  test("the skip link opens the details and focuses its summary; the heatmap region scrolls on its own at 320 px", async (t) => {
    await withPage(t, "/domain/labour", HM, async ({page}) => {
      await page.click("#skip-to-values");
      assert.equal(await page.evaluate(() => document.querySelector("#domain-values").open), true);
      assert.equal(await page.evaluate(() => document.activeElement?.localName), "summary");
      assert.ok((await page.locator("#domain-detail tbody tr").count()) > 5);
      await setViewport(page, 320);
      const o = await page.evaluate(() => {
        const s = document.querySelector(".mm-heatmap-scroll");
        return {inner: s.scrollWidth > s.clientWidth, page: document.documentElement.scrollWidth <= innerWidth};
      });
      assert.deepEqual(o, {inner: true, page: true});
    });
  });
});

// R12: the peers/ pages are gone; the V2 dot plot, table alternative and cards are checked on PG-INDICATOR.
describe("T117-T119 V2 dot plot, table alternative and cards, on PG-INDICATOR", () => {
  const PEERS = "#indicator-table tbody tr";
  const ROWS = '#indicator-table tbody[data-group="with-value"] tr[data-entity]';
  test("figure has an aria-label, guides are three constant neutral lines, no statistic words, orientation note and direction near the chart, values beside labels", async (t) => {
    await withPage(t, "/indicator/M09", PEERS, async ({page}) => {
      const read = () =>
        page.evaluate(() => {
          const fig = document.querySelector("#indicator-dot-figure");
          const rules = [...fig.querySelectorAll("[aria-label=rule] line")];
          const dots = [...fig.querySelectorAll("circle")];
          const labels = [...fig.querySelectorAll("[aria-label=\"y-axis tick label\"] text")].map((x) => x.textContent.trim());
          return {
            role: fig.getAttribute("role"),
            label: fig.getAttribute("aria-label"),
            rules: rules.length,
            ruleX: rules.map((l) => l.getAttribute("x1")).join(","),
            radii: [...new Set(dots.map((d) => d.getAttribute("r")))].sort(),
            labels,
            orientation: document.querySelector(".mm-orientation")?.innerText ?? "",
            figureFirst: fig.compareDocumentPosition(document.querySelector("#indicator-table")) & Node.DOCUMENT_POSITION_FOLLOWING,
            body: document.body.innerText,
            tableValues: [...document.querySelectorAll('#indicator-table tbody[data-group="with-value"] tr[data-entity]')].map((r) => [r.querySelector("th").innerText.trim(), r.dataset.state, r.querySelectorAll("td")[0].innerText.replace(/\s+/g, " ").trim()]),
            caption: document.querySelector("#indicator-table caption")?.innerText ?? "",
            noScope: [...document.querySelectorAll("#indicator-table th")].filter((x) => !x.getAttribute("scope")).length
          };
        });
      const a = await read();
      assert.equal(a.role, "img");
      assert.match(a.label, /^Dot plot of the percentile vs all ranked countries for .+, \d+ countr(y|ies)\. The table below lists the same values\.$/);
      assert.equal(a.rules, 3);
      assert.ok(a.radii.includes("8"), "dots are r = 8");
      assert.ok(!/median|quartile/i.test(a.body), "no median or quartile word on the page");
      assert.equal(a.orientation.includes("Higher percentile means a more favourable position by each indicator's stated direction."), true);
      assert.ok(a.figureFirst, "the chart comes before the table alternative");
      assert.ok(a.caption.length > 0 && a.noScope === 0, "table caption and th scope (AC-UX-5)");
      // a stored value beside every drawn country label, taken from the table
      const ranked = a.tableValues.filter((r) => r[1] === "ranked");
      assert.ok(ranked.length >= 2 && a.labels.length === ranked.length);
      for (const [name, , value] of ranked) assert.ok(a.labels.includes(`${name}: ${value}`), `${name}: ${value} in ${a.labels.join(" | ")}`);
      // unranked rows stay in the table and are not drawn
      for (const [name] of a.tableValues.filter((r) => r[1] !== "ranked")) assert.ok(!a.labels.some((l) => l.startsWith(`${name}:`)), name);
      // the guide lines do not move with the group filter or the indicator
      await page.check('#indicator-group input[value="g7"]');
      await page.waitForTimeout(300);
      const b = await read();
      assert.deepEqual([b.rules, b.ruleX], [a.rules, a.ruleX]);
      await page.selectOption("#indicator-sort", "value");
      await page.waitForTimeout(300);
      const c = await page.evaluate(() => [...document.querySelectorAll("#indicator-dot-figure [aria-label=rule] line")].map((l) => l.getAttribute("x1")).join(","));
      assert.equal(c, a.ruleX, "the guide lines do not move with the sort either");
    });
  });

  test("reference offset column shows the stored ref_offset_days; the narrow layout is cards with the same cells in the same order", async (t) => {
    await withPage(t, "/indicator/M09", PEERS, async ({page}) => {
      const indicator = "M09";
      const stored = new Map(builtJson("labour").entities.map((e) => [e.entity_id, e.indicators.find((i) => i.indicator_id === indicator)?.ref_offset_days ?? null]));
      const snap = () =>
        page.evaluate(() =>
          [...document.querySelectorAll('#indicator-table tbody[data-group="with-value"] tr[data-entity]')].map((r) => ({
            id: r.dataset.entity,
            cells: [...r.children].map((c) => c.innerText.replace(/\s+/g, " ").trim()),
            offset: r.querySelectorAll("td")[2].innerText.trim()
          }))
        );
      await setViewport(page, 1280);
      const header = await page.$$eval("#indicator-table thead th", (h) => h.map((x) => x.innerText.trim()));
      assert.ok(header.includes("Offset (days)"));
      const wide = await snap();
      for (const r of wide) assert.equal(r.offset, stored.get(r.id) === null || stored.get(r.id) === undefined ? "" : String(stored.get(r.id)), r.id);
      const displayWide = await page.$eval(ROWS, (r) => getComputedStyle(r).display);
      assert.equal(displayWide, "table-row");
      for (const w of [320, 390]) {
        await setViewport(page, w);
        await page.waitForTimeout(100);
        const card = await page.evaluate(() => {
          const tr = document.querySelector('#indicator-table tbody[data-group="with-value"] tr[data-entity]');
          const td = tr.querySelector("td");
          const head = document.querySelector("#indicator-table thead");
          const label = getComputedStyle(td, "::before").content;
          return {tr: getComputedStyle(tr).display, td: getComputedStyle(td).display, label, headClipped: head.getBoundingClientRect().width <= 1, roles: tr.getAttribute("role"), cardWidth: tr.getBoundingClientRect().width, vw: innerWidth};
        });
        assert.equal(card.tr, "block");
        assert.equal(card.td, "grid");
        assert.match(card.label, /^"Latest value"$/);
        assert.ok(card.headClipped && card.roles === "row");
        assert.ok(card.cardWidth <= card.vw, `${w}px: card fits the viewport`);
        assert.deepEqual(await snap(), wide, `${w}px: same cells in the same order`);
        const o = await horizontalOverflow(page);
        assert.ok(o.scrollW <= o.vw, `${w}px: no page-level horizontal scroll`);
      }
    });
  });
});

// ---- Stage 4 (T125): V3 explorer chart --------------------------------------------------------------------------------
// The fixture export has 3 countries in M09. A recorded 7-country M09 file (tests/fixtures/explorer-m09-7countries.parquet, made
// with the fixture export's own producer code: DEU last month EST, FRA June 2024 a revision row, ITA March 2024 MISS) replaces
// the series file in the browser, so more than 5 countries can be selected without any other change to the site.
const WIDE_M09 = readFileSync(join(here, "..", "fixtures", "explorer-m09-7countries.parquet"));
const useWide = (page) => page.route(/\/_file\/data\/series\/M09\.[0-9a-f]+\.parquet/, (r) => r.fulfill({status: 200, contentType: "application/octet-stream", body: WIDE_M09}));
const withWide = (t, fn, opts = {}) => withPage(t, "/explorer#i=M09&c=FRA,DEU,IND,ITA,JPN", "#explorer-figure svg", fn, {before: async (page) => { await useWide(page); await opts.before?.(page); }});

describe("T125: V3 explorer chart (AC-UX-3 to 6, 12)", () => {
  test("figure label, hollow and ring marks, end labels, no legend, gap kept (AC-UX-5)", async (t) => {
    await withWide(t, async ({page}) => {
      const fig = await page.$eval("#explorer-figure", (f) => ({role: f.getAttribute("role"), label: f.getAttribute("aria-label")}));
      assert.equal(fig.role, "img");
      for (const name of ["France", "Germany", "India", "Italy", "Japan"]) assert.ok(fig.label.includes(`${name}, 2023-01-31 to 2025-12-31, latest stored value`), name);
      assert.ok(fig.label.includes("Germany, 2023-01-31 to 2025-12-31, latest stored value 2.3 e % of labour force"));
      const ends = await page.$$eval("#explorer-figure svg text", (x) => x.map((n) => n.textContent).filter((s) => /^[A-Za-z ]+: [\d.]+( e)? % of labour force$/.test(s)));
      assert.equal(ends.length, 5, "one end label per series");
      assert.ok(ends.includes("Germany: 2.3 e % of labour force"));
      assert.equal(await page.locator("#explorer-figure [aria-label*='legend' i], #explorer-figure form, #explorer-figure .plot-swatches").count(), 0, "no legend");
      // hollow marker for the estimate (Germany, last month): a marker whose fill is the page colour and stroke a series colour
      const hollow = await page.$$eval("#explorer-figure svg g[aria-label='dot']", (gs) => {
        const bg = getComputedStyle(document.documentElement).getPropertyValue("--mm-bg").trim();
        return gs.filter((g) => g.getAttribute("fill") === bg && g.getAttribute("stroke") !== bg && g.querySelector("path")).length;
      });
      assert.ok(hollow >= 1, "hollow estimate marker");
      assert.ok((await page.$$eval("#explorer-figure svg g[aria-label='dot'][fill='none'] circle", (c) => c.length)) >= 1, "ring for revised-data history");
      // the gap: Italy's line is broken at the missing period (more than one sub-path in its line)
      const brokenLines = await page.$$eval("#explorer-figure svg g[aria-label='line'] path", (ps) => ps.filter((p) => (p.getAttribute("d").match(/M/g) ?? []).length > 1).length);
      assert.ok(brokenLines >= 1, "a line with a gap (no fill, no interpolation)");
      assert.ok((await page.textContent("#chart-explain")).includes("A hollow marker is an estimated or provisional value."));
      await screenshot(page, "explorer-chart", "light");
    });
  });

  test("View as table equals the plotted points and the stored values (AC-UX-5)", async (t) => {
    await withWide(t, async ({page}) => {
      const summary = page.locator("#explorer-view-table summary");
      assert.equal((await summary.textContent()).trim(), "View as table");
      assert.equal(await page.$eval("#explorer-view-table", (d) => d.open), false);
      await summary.click();
      await page.waitForSelector("#explorer-view-table-table tbody tr", {state: "attached"}); // the rows are built on the first open (toggle event)
      const rows = await page.$$eval("#explorer-view-table-table tbody tr", (trs) => trs.map((r) => [r.dataset.entity, r.children[1].textContent, r.children[2].textContent, r.children[3].textContent]));
      assert.ok(rows.length > 5 * 24, "five series, every plotted period of each (spec 5.6)");
      const deu = rows.filter((r) => r[0] === "DEU");
      assert.equal(deu.at(-1)[1], "2025-12-31");
      assert.equal(deu.at(-1)[2], "2.3 e");
      assert.equal(deu.at(-1)[3], "EST");
      assert.ok(deu.length > 24 && deu[0][1] < "2024-01-31", "the table holds every plotted period, not only the latest 24");
      assert.deepEqual(deu.map((r) => r[1]), [...deu.map((r) => r[1])].sort(), "date order");
      // the same latest values as the end labels of the chart
      const ends = await page.$$eval("#explorer-figure svg text", (x) => x.map((n) => n.textContent).filter((s) => /^[A-Za-z ]+: [\d.]+( e)? % of labour force$/.test(s)));
      for (const r of rows.filter((x) => x[1] === "2025-12-31")) assert.ok(ends.some((e) => e.endsWith(`: ${r[2]} % of labour force`)), `${r[0]} ${r[2]}`);
      const href = await page.getAttribute("#explorer-view-table-download", "href");
      assert.match(href, /\/_file\/data\/series\/M09\.[0-9a-f]+\.parquet$/);
    });
  });

  test("above 5 countries: one chart per country, the active y-axis mode is written, the free y-axis switches it (AC-DASH-12 reuse: no extra fetch)", async (t) => {
    await withWide(t, async ({page}) => {
      const requests = [];
      page.on("request", (r) => requests.push(r.url()));
      for (const id of ["POL", "USA"]) await page.check(`#explorer-entities input[value=${id}]`);
      await page.waitForFunction(() => document.querySelectorAll("#explorer-figure svg g[aria-label='text']").length === 7 || [...document.querySelectorAll("#explorer-figure svg text")].filter((n) => /: [\\d.]+ % of labour force$/.test(n.textContent)).length === 7);
      assert.ok((await page.textContent("#y-mode")).includes("More than 5 countries are selected, so each country has its own chart."));
      assert.ok((await page.textContent("#y-mode")).includes("All charts share one y-axis scale"));
      assert.equal(await page.$eval("#y-mode", (e) => e.dataset.free), "false");
      const titles = await page.$$eval("#explorer-figure svg text", (x) => x.map((n) => n.textContent).filter((s) => /: [\d.]+( e)? % of labour force$/.test(s)));
      assert.equal(titles.length, 7, "every facet has a title");
      await page.check("#explorer-free-y");
      await page.waitForFunction(() => document.querySelectorAll("#explorer-figure svg").length === 7);
      assert.ok((await page.textContent("#y-mode")).includes("Each chart has its own y-axis scale"));
      assert.equal(await page.$$eval("#explorer-figure svg", (s) => s.length), 7);
      await screenshot(page, "explorer-facets-free", "light");
      assert.deepEqual(requests.filter((u) => /\/_file\/data\/series\//.test(u)), [], "selecting countries fetches no data file");
    });
  });

  test("select group only toggles checkboxes; hue follows selection order", async (t) => {
    await withWide(t, async ({page}) => {
      const g7 = page.locator("#explorer-entities button[data-group=g7]");
      assert.equal((await g7.textContent()).trim(), "Select group: G7");
      await g7.click();
      assert.deepEqual(await page.$$eval("#explorer-entities input:checked", (i) => i.map((x) => x.value).sort()), ["DEU", "FRA", "IND", "ITA", "JPN", "USA"].sort());
      await g7.click();
      assert.deepEqual(await page.$$eval("#explorer-entities input:checked", (i) => i.map((x) => x.value).sort()), ["IND"]);
      // selection order fixes the hue: first selected gets series-1
      for (const id of ["IND", "USA", "POL"]) await page.uncheck(`#explorer-entities input[value=${id}]`).catch(() => {});
      await page.check("#explorer-entities input[value=USA]");
      await page.check("#explorer-entities input[value=DEU]");
      await page.waitForFunction(() => document.querySelectorAll("#explorer-figure svg g[aria-label='line'] path").length === 2);
      const strokes = await page.$$eval("#explorer-figure svg g[aria-label='line']", (gs) => gs.map((g) => g.getAttribute("stroke")));
      const tok = await computedTokens(page, ["--mm-series-1", "--mm-series-2"]);
      const first = await page.$$eval("#explorer-figure svg text", (x) => x.map((n) => n.textContent).filter((s) => /^[A-Za-z ]+: [\d.]+( e)? % of labour force$/.test(s)));
      assert.equal(first.length, 2);
      assert.ok(strokes.includes(tok["--mm-series-1"]) && strokes.includes(tok["--mm-series-2"]), `strokes ${strokes} tokens ${JSON.stringify(tok)}`);
    });
  });

  test("layout: left rail from 64 rem, collapsed Selection on compact; no horizontal page scroll; focus stays reachable", async (t) => {
    await withWide(t, async ({page}) => {
      await setViewport(page, 1280);
      const wide = await page.evaluate(() => {
        const r = document.querySelector("#explorer-selection").getBoundingClientRect();
        const m = document.querySelector("#explorer-main").getBoundingClientRect();
        return {railRight: r.right, mainLeft: m.left, open: document.querySelector("#explorer-selection").open};
      });
      assert.ok(wide.railRight <= wide.mainLeft, "rail is left of the chart");
      assert.equal(wide.open, true);
      for (const w of [320, 390, 768, 1920]) {
        await setViewport(page, w);
        await page.waitForTimeout(150);
        const o = await horizontalOverflow(page);
        assert.ok(o.scrollW <= o.vw, `${w}px: no page-level horizontal scroll`);
      }
      await setViewport(page, 390);
      await page.waitForTimeout(150);
      assert.equal(await page.$eval("#explorer-selection", (d) => d.open), false, "Selection is collapsed on compact screens");
      assert.equal((await page.textContent("#explorer-selection summary")).trim(), "Selection");
      await page.click("#explorer-selection summary");
      assert.equal(await page.$eval("#explorer-selection", (d) => d.open), true);
      const small = await page.$$eval("#explorer-selection input, #explorer-selection select, #explorer-selection button", (els) => els.filter((e) => { const b = e.getBoundingClientRect(); return b.width < 24 || b.height < 24; }).map((e) => e.id || e.value));
      assert.deepEqual(small, [], "targets at least 24 px");
      await screenshot(page, "explorer-compact", "light");
    });
  });

  test("keyboard: summary, selects, checkboxes and group buttons are reachable by Tab and operable by Space", async (t) => {
    await withWide(t, async ({page}) => {
      await setViewport(page, 1280);
      await page.focus("#explorer-selection summary");
      const seen = new Set();
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        seen.add(await page.evaluate(() => document.activeElement?.id || document.activeElement?.dataset?.group || document.activeElement?.value || document.activeElement?.tagName));
      }
      for (const want of ["explorer-indicator", "explorer-transform", "explorer-rebase", "explorer-free-y", "g7", "FRA"]) assert.ok(seen.has(want), `Tab reaches ${want}`);
      await page.focus("#explorer-entities input[value=POL]");
      await page.keyboard.press("Space");
      assert.equal(await page.isChecked("#explorer-entities input[value=POL]"), true);
    });
  });

  test("rebase marks: index-100 and base-period rules, the confirmed title and the display-only note stay (AC-DASH-6 unchanged)", async (t) => {
    await withWide(t, async ({page}) => {
      await page.check("#explorer-rebase");
      await page.waitForFunction(() => /rebased to 100 at/.test(document.querySelector("#explorer-title")?.textContent ?? ""));
      assert.match(await page.textContent("#explorer-title"), /^Unemployment rate: Level, rebased to 100 at \d{4}-\d{2}-\d{2} \(index, \d{4}-\d{2}-\d{2} = 100\)$/);
      assert.ok((await page.textContent("#rebase-note")).startsWith("Rebasing is a display scaling only"));
      assert.ok((await page.textContent("#chart-explain")).includes("The grey lines mark the index value 100 and the base period."));
      assert.ok((await page.$$eval("#explorer-figure svg text", (x) => x.map((n) => n.textContent))).some((s) => /^Germany: [\d.]+( e)? index, \d{4}-\d{2}-\d{2} = 100$/.test(s)));
      assert.match(await page.$eval("#explorer-figure svg", (s) => s.textContent), /index, \d{4}-\d{2}-\d{2} = 100/);
    });
  });

  test("CLS at most 0.1 on the 7-country file", async (t) => {
    await withWide(t, async ({page}) => {
      await page.waitForTimeout(500);
      const {cls, unsupported} = await readCls(page);
      assert.equal(unsupported, false);
      assert.ok(cls !== null && cls <= 0.1, `CLS ${cls}`);
    }, {before: installCls});
  });
});

// ---- T129: V4 revisions (AC-UX-2 class marks, 3, 4, 5, 6, 8, 12) -----------------------------------
const REVISION_FILE = /\/_file\/data\/revisions\/[A-Za-z0-9]+\.[0-9a-f]+\.parquet/;
const STEP = "#step-figure svg";
const SCREEN_RULES = [["V4 revisions", "/revisions", "#recent-revisions tbody tr"]];

// Choose M09, then a series and a reference period; wait until the step figure (or its absence note) is drawn.
async function chooseStep(page, country, period) {
  await page.selectOption("#vintage-indicator", "M09");
  await page.waitForSelector("#vintage-history", {timeout: TIMEOUT});
  await page.selectOption("#vintage-series", {label: country});
  await page.selectOption("#vintage-period", period);
  await page.waitForSelector(STEP, {timeout: TIMEOUT});
  await page.waitForFunction((p) => [...document.querySelectorAll("#vintage-history tbody tr")].every((r) => r.getAttribute("data-period") === p), period, {timeout: TIMEOUT});
  await page.waitForLoadState("networkidle");
}
const withStep = (t, country, period, fn, opts = {}) => withPage(t, "/revisions", "#recent-revisions tbody tr", async (ctx) => {
  await chooseStep(ctx.page, country, period);
  await fn(ctx);
}, opts);

async function textProblems(page) {
  const samples = await sampleTextColours(page);
  const bad = [];
  let skipped = 0;
  for (const s of samples) {
    const fg = cssToHex(s.color);
    const bg = s.bg && cssToHex(s.bg);
    if (!fg || !bg || fg.alpha < 1) { skipped++; continue; }
    const need = requiredTextRatio(s);
    const r = contrastRatio(fg.hex, bg.hex);
    if (r < need) bad.push(`${s.el} "${s.text}" ${fg.hex} on ${bg.hex} = ${r.toFixed(2)} < ${need}`);
  }
  assert.ok(samples.length > 10, `only ${samples.length} text samples`);
  assert.ok(skipped <= samples.length / 4, `${skipped} of ${samples.length} samples unresolved`);
  return bad;
}

describe("T129 AC-UX-2: V4 class marks are told apart without colour", () => {
  test("V4: re-estimation rows carry the class word plus a flag mark and a dashed edge; regular rows a solid edge and no flag; signs are written (true minus, plus) with an aria-hidden triangle", async (t) => {
    await withPage(t, "/revisions", "#recent-revisions tbody tr", async ({page}) => {
      const rows = await page.$$eval("#recent-revisions tbody tr", (trs) => trs.map((tr) => {
        const tds = [...tr.children];
        const cls = tr.getAttribute("data-class");
        const classCell = tds[8];
        const flag = classCell.querySelector("[data-class-mark]");
        const edge = getComputedStyle(tds[0]);
        const signed = (td) => { const s = td.querySelector(".mm-signed"); return s ? {sign: s.getAttribute("data-sign"), text: s.querySelector(".mm-signed-text").textContent, glyphHidden: s.querySelector("svg")?.getAttribute("aria-hidden") ?? null, hasGlyph: Boolean(s.querySelector("svg"))} : {text: td.textContent.trim()}; };
        return {cls, word: classCell.textContent.trim(), flagMark: flag?.getAttribute("data-class-mark") ?? null, edgeStyle: edge.borderLeftStyle, edgeWidth: parseFloat(edge.borderLeftWidth), abs: signed(tds[5]), pct: signed(tds[6]), bar: tds[6].querySelector("svg.mm-bar")?.getAttribute("aria-hidden") ?? null};
      }));
      const classes = new Set(rows.map((r) => r.cls));
      assert.ok(classes.has("regular") && classes.has("reestimation"), `fixture classes: ${[...classes].join(",")}`);
      for (const r of rows) {
        if (r.cls === "reestimation") {
          assert.match(r.word, /re-estimation/i, "class word is visible text");
          assert.equal(r.flagMark, "reestimation");
          assert.equal(r.edgeStyle, "dashed");
        } else {
          assert.equal(r.flagMark, null);
          assert.equal(r.edgeStyle, "solid");
        }
        assert.ok(r.edgeWidth >= 2, `class edge ${r.edgeWidth}px`);
        for (const v of [r.abs, r.pct]) {
          if (v.sign === "neg") { assert.ok(v.text.startsWith("−"), `negative shown with a true minus: ${v.text}`); assert.equal(v.glyphHidden, "true"); }
          if (v.sign === "pos") { assert.ok(v.text.startsWith("+"), `positive shown with a plus: ${v.text}`); assert.equal(v.glyphHidden, "true"); }
          if (v.sign === "zero") assert.equal(v.hasGlyph, false, "zero has no triangle");
          if (!v.sign) assert.ok(!/[+−]/.test(v.text) || v.text === "n/a" || /^-?\d/.test(v.text), v.text);
        }
        if (r.bar !== null) assert.equal(r.bar, "true", "bar is decorative: the number beside it is the content");
      }
      const signs = new Set(rows.flatMap((r) => [r.abs.sign, r.pct.sign]).filter(Boolean));
      assert.ok(signs.has("pos") && signs.has("neg"), `fixture shows both signs: ${[...signs].join(",")}`);
      assert.ok(rows.some((r) => r.cls === "reestimation") && (await page.textContent("#bar-label")).length > 10, "bar label present");
      await screenshot(page, "v4-revisions", "grayscale");
    });
  });
});

describe("T129 V4 step chart (AC-UX-5): a chosen period is drawn from the same versions as the table", () => {
  test("three-version key: figure label matches the table rows; hollow earliest point carries its label; later versions are filled", async (t) => {
    await withStep(t, "Germany", "2026-06-01", async ({page, log}) => {
      const rows = await page.$$eval("#vintage-history tbody tr", (trs) => trs.map((tr) => ({known: tr.children[2].textContent, value: tr.children[5].textContent, label: tr.children[1].textContent.trim(), tomb: tr.children[7].textContent.includes("tombstone")})));
      assert.equal(rows.length, 3, "DEU M09 2026-06 has three stored versions");
      const unit = await page.$eval("#vintage-caption tbody tr td:last-child", (td) => td.textContent.trim());
      const fig = await page.$eval("#step-figure", (f) => ({role: f.getAttribute("role"), label: f.getAttribute("aria-label")}));
      assert.equal(fig.role, "img");
      const parts = rows.map((r) => `${r.known}: ${r.tomb ? "removed" : `${r.value} ${unit}`}`);
      let at = -1;
      for (const p of parts) { const i = fig.label.indexOf(p, at + 1); assert.ok(i > at, `label lacks "${p}" in table order: ${fig.label}`); at = i; }
      assert.equal((fig.label.match(/\d{4}-\d{2}-\d{2}T[\d:]+Z: /g) ?? []).length, rows.length, "one label part per table row, none extra");
      assert.ok(fig.label.includes("Germany") && fig.label.includes("2026-06-01"));
      // marks: one hollow ring (earliest stored version, fill none), the rest filled; positions follow the table order
      const marks = await page.$$eval(`${STEP} g[aria-label="dot"] circle`, (cs) => cs.map((c) => ({r: Number(c.getAttribute("r")), cx: Number(c.getAttribute("cx")), cy: Number(c.getAttribute("cy")), fill: c.closest("g").getAttribute("fill")})));
      const hollow = marks.filter((m) => m.fill === "none");
      assert.equal(hollow.length, 1, "exactly one hollow point");
      assert.equal(marks.length, rows.length, "one point per stored version");
      assert.ok(marks.filter((m) => m.fill !== "none").every((m) => m.r < hollow[0].r), "filled points are smaller than the hollow ring");
      const xs = marks.map((m) => m.cx).sort((a, b) => a - b);
      assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), `three distinct known_at positions: ${xs.join(",")}`);
      assert.equal(hollow[0].cx, Math.min(...marks.map((m) => m.cx)), "the hollow point is the earliest");
      const label = await page.$$eval(`${STEP} text`, (ts) => ts.filter((x) => x.textContent === "earliest stored version").map((x) => { const b = x.getBoundingClientRect(); const s = x.ownerSVGElement.getBoundingClientRect(); return {cx: b.x + b.width / 2 - s.x, bottom: b.bottom - s.y, left: b.left - s.x, right: b.right - s.x}; }));
      assert.equal(label.length, 1, "the earliest point has exactly one label");
      assert.ok(label[0].bottom <= hollow[0].cy, "label sits above its point");
      assert.ok(label[0].left >= -1, `label is not cut off on the left (${label[0].left})`);
      const svgW = await page.$eval(STEP, (s) => s.getBoundingClientRect().width);
      assert.ok(label[0].right <= svgW + 1, "label is not cut off on the right");
      assert.ok(label[0].left >= hollow[0].cx - 12 && label[0].left <= hollow[0].cx + 20, `label starts at its point (${label[0].left} vs ${hollow[0].cx})`);
      assert.equal(await page.locator("#step-block [aria-label*='legend' i], #step-block .plot-swatches").count(), 0, "no legend");
      assert.ok(!/first (stored )?rel\u0065ase/i.test(await page.innerText("#step-block")), "the earliest version is never given the forbidden name (spec section 7)");
      await screenshot(page, "v4-step-three-versions", "light");
      assert.deepEqual(log.errors, []);
    });
  });

  test("tombstone key: a dashed rule and the word removed at its known_at; no value point is drawn for it; the label says removed", async (t) => {
    // The fixture export already holds one: FRA, M09, 2026-06 (initial 7.2, then a tombstone). No fixture was edited.
    await withStep(t, "France", "2026-06-01", async ({page}) => {
      const rows = await page.$$eval("#vintage-history tbody tr", (trs) => trs.map((tr) => ({known: tr.children[2].textContent, value: tr.children[5].textContent, status: tr.children[6].textContent, kind: tr.children[7].textContent})));
      assert.equal(rows.length, 2);
      assert.equal(rows[1].status, "DEL");
      assert.match(rows[1].kind, /tombstone/);
      const fig = await page.getAttribute("#step-figure", "aria-label");
      assert.ok(fig.includes(`${rows[1].known}: removed`), fig);
      assert.equal(await page.locator(`${STEP} g[aria-label="dot"] circle`).count(), 1, "only the stored value is a point; the tombstone has none");
      assert.equal(await page.locator(`${STEP} g[aria-label="dot"][fill="none"]`).count(), 1, "that point is the hollow earliest one");
      const rule = await page.$$eval(`${STEP} g[aria-label="rule"]`, (gs) => gs.map((g) => ({dash: g.getAttribute("stroke-dasharray"), lines: g.querySelectorAll("line").length, x: Number(g.querySelector("line")?.getAttribute("x1"))})));
      assert.equal(rule.length, 1);
      assert.equal(rule[0].lines, 1);
      assert.ok(rule[0].dash && rule[0].dash !== "none", `rule is dashed (${rule[0].dash})`);
      const cross = await page.$$eval(`${STEP} text`, (ts) => ts.filter((x) => /removed/.test(x.textContent)).map((x) => { const b = x.getBoundingClientRect(); const s = x.ownerSVGElement.getBoundingClientRect(); return {text: x.textContent, cx: b.x + b.width / 2 - s.x, right: b.right - s.x}; }));
      assert.equal(cross.length, 1);
      assert.match(cross[0].text, /^× removed$/);
      const svgW = await page.$eval(STEP, (s) => s.getBoundingClientRect().width);
      assert.ok(cross[0].right <= svgW + 1, "the word removed is not cut off");
      assert.ok(Math.abs(cross[0].cx - rule[0].x) < 80, "the word is beside its rule");
      await screenshot(page, "v4-step-tombstone", "light");
    });
  });

  test("keyboard: the skip link is a Tab stop before the figure and the table, and Enter lands on the version table; Tab never gets trapped", async (t) => {
    await withStep(t, "Germany", "2026-06-01", async ({page}) => {
      let found = false;
      const order = [];
      for (let i = 0; i < 80 && !found; i += 1) {
        await page.keyboard.press("Tab");
        const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.localName);
        order.push(id);
        found = id === "step-skip";
      }
      assert.ok(found, `Tab never reached the skip link: ${order.join(" > ")}`);
      const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); const r = document.activeElement.getBoundingClientRect(); return {w: parseFloat(s.outlineWidth), style: s.outlineStyle, inView: r.top >= 0 && r.bottom <= innerHeight, text: document.activeElement.textContent}; });
      assert.ok(ring.style !== "none" && ring.w >= 2, `focus ring ${ring.style} ${ring.w}px`);
      assert.ok(ring.inView, "skip link is visible when focused");
      assert.equal(ring.text, "Skip to version table");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => location.hash), "#vintage-history");
      const inView = await page.$eval("#vintage-history", (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; });
      assert.ok(inView, "the version table is in the viewport after the jump");
      await page.keyboard.press("Tab");
      assert.ok(await page.evaluate(() => document.activeElement !== document.body), "Tab continues after the jump");
    });
  });
});

describe("T129: the V4 page with a step chart drawn in every checked state", () => {
  for (const scheme of SCHEMES) {
    test(`AC-UX-3: V4 with the step chart, ${scheme}: text contrast, and the line, ring and rule against the page colour at 3:1`, async (t) => {
      await withStep(t, "Germany", "2026-06-01", async ({page}) => {
        await setTheme(page, scheme);
        assert.deepEqual(await textProblems(page), []);
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        const ink = await page.$$eval(`${STEP} g[aria-label="line"], ${STEP} g[aria-label="dot"]`, (gs) => gs.map((g) => ({what: g.getAttribute("aria-label"), stroke: g.getAttribute("stroke")})));
        assert.ok(ink.length >= 2);
        const bgc = cssToHex(bg);
        for (const m of ink) {
          const colour = await page.evaluate((c) => { const d = document.createElement("i"); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, m.stroke);
          const fg = cssToHex(colour);
          assert.ok(fg && bgc, `cannot resolve ${m.stroke}`);
          const r = contrastRatio(fg.hex, bgc.hex);
          assert.ok(r >= 3, `${m.what} stroke ${fg.hex} on ${bgc.hex} = ${r.toFixed(2)} < 3 (${scheme})`);
        }
        await screenshot(page, "v4-step-three-versions", scheme);
      });
    });
  }

  test("AC-UX-4: V4 with the step chart: Tab traversal reaches every control, no trap, focus ring and targets", async (t) => {
    await withStep(t, "Germany", "2026-06-01", async ({page}) => {
      const expected = await focusables(page);
      const {stops, trap, left, pressed} = await tabTraversal(page);
      assert.equal(trap, null, `focus trap at ${trap}`);
      assert.ok(left || pressed >= expected.length);
      assert.ok(stops.length >= expected.length, `Tab reached ${stops.length} of ${expected.length}`);
      assert.ok(stops.some((s) => /step-skip/.test(s.id) || /Skip to version table/.test(s.text ?? s.id)), "the skip link is a stop");
      const problems = stops.filter((s) => s.outlineStyle === "none" || s.outlineWidth < 2 || s.covering.length || !s.inViewport).map((s) => `${s.id}: ${s.outlineStyle} ${s.outlineWidth}px covering=${s.covering.join(",")} inViewport=${s.inViewport}`);
      assert.deepEqual(problems, []);
      const small = (await interactiveTargets(page)).filter((x) => x.w < 24 - 0.01 || x.h < 24 - 0.01);
      assert.deepEqual(small.map((x) => `${x.el} ${x.w.toFixed(1)}x${x.h.toFixed(1)}`), []);
    });
  });

  test("AC-UX-6: V4 with the step chart: no page-level horizontal scroll at 320/390/768/1280/1920; the chart is not clipped", async (t) => {
    await withStep(t, "Germany", "2026-06-01", async ({page}) => {
      const failures = [];
      for (const w of VIEWPORTS) {
        await setViewport(page, w);
        await page.waitForTimeout(150);
        const o = await horizontalOverflow(page);
        if (o.scrollW > o.vw) failures.push(`${w}px: scrollWidth ${o.scrollW} > ${o.vw}; ${o.offenders.join("; ") || "none found"}`);
        const fit = await page.evaluate(() => { const f = document.querySelector("#step-figure").getBoundingClientRect(); return {right: f.right, vw: innerWidth}; });
        if (fit.right > fit.vw + 1) failures.push(`${w}px: figure right edge ${fit.right} beyond viewport ${fit.vw}`);
      }
      assert.deepEqual(failures, []);
    });
  });

  test("AC-UX-12: choosing a period adds the chart without layout shift above 0.1", async (t) => {
    await withPage(t, "/revisions", "#recent-revisions tbody tr", async ({page}) => {
      await chooseStep(page, "Germany", "2026-06-01");
      await page.waitForTimeout(500);
      const {cls, unsupported} = await readCls(page);
      assert.equal(unsupported, false);
      assert.ok(cls !== null && cls <= 0.1, `CLS ${cls} > 0.1 (headless Chromium)`);
    }, {before: installCls});
  });

});

describe("T129 AC-UX-8: the error blocks of V4 in the UX checks", () => {
  const notFound = (route) => route.fulfill({status: 404, contentType: "text/plain", body: "missing"});
  for (const scheme of SCHEMES) {
    test(`V4 revision-file failure: alert role, readable in ${scheme}, a border as the non-colour cue, no overflow at 320 px, no focus trap`, async (t) => {
      if (!browser) return t.skip(reason);
      const cases = [
        ["/revisions", [[REVISION_FILE, notFound]], "#recent-revisions tbody tr", "#vintage-error", async (page) => {
          for (let i = 0; i < 20 && (await page.locator("#vintage-error").count()) === 0; i += 1) { await page.selectOption("#vintage-indicator", "M09"); await page.waitForTimeout(250); }
        }],
      ];
      for (const [path, routes, ready, alertSel, act] of cases) {
        const {page, context, log} = await openPage(browser, site.origin, {fixedTime: NOW});
        for (const [re, h] of routes) await context.route(re, h);
        try {
          await page.goto(`${site.origin}${path}`);
          await page.waitForSelector(ready, {timeout: TIMEOUT});
          await page.waitForLoadState("networkidle");
          await setTheme(page, scheme);
          await act(page);
          assert.equal(await page.getAttribute(alertSel, "role"), "alert", `${path}: role=alert`);
          const box = await page.$eval(alertSel, (e) => { const s = getComputedStyle(e); return {border: s.borderTopStyle + " " + s.borderTopWidth, fg: s.color, bg: s.backgroundColor, title: e.querySelector(".mm-state-title")?.textContent.length > 0}; });
          assert.match(box.border, /^solid 1px$/, `${path}: error block border`);
          assert.ok(box.title, "a visible title sentence");
          const fg = cssToHex(box.fg);
          const bg = cssToHex(box.bg);
          assert.ok(fg && bg, `${path}: unresolved colours ${box.fg} on ${box.bg}`);
          assert.ok(contrastRatio(fg.hex, bg.hex) >= 4.5, `${path}: alert text ${fg.hex} on ${bg.hex} (${scheme})`);
          assert.deepEqual(await textProblems(page), [], `${path}: text contrast with the error block shown`);
          await setViewport(page, 320);
          await page.waitForTimeout(150);
          const o = await horizontalOverflow(page);
          assert.ok(o.scrollW <= o.vw, `${path}: horizontal scroll at 320 px with the alert shown: ${o.offenders.join("; ")}`);
          const {trap} = await tabTraversal(page);
          assert.equal(trap, null, `${path}: focus trap`);
          await screenshot(page, `${slug(path)}-error`, scheme);
          assert.equal(log.offOrigin.length, 0);
        } finally {
          await context.close();
        }
      }
    });
  }
});

// T130 (AC-UX-9 print, AC-UX-7): print emulation with the dark screen scheme on, so a dark theme leaking into print would show.
describe("T130 AC-UX-9: print stylesheet", () => {
  const MIN_PT_PX = (8 * 96) / 72;
  for (const [name, path, ready] of PAGES) {
    test(`${name}: light tokens, no controls, details open, fills kept, freshness/caveat/Sources/URL, no clipping, PDF`, async (t) => {
      await withPage(t, path, ready, async ({page}) => {
        await setTheme(page, "dark");
        await setPrint(page);
        await setViewport(page, 704); // A4 minus 12 mm margins is about 704 CSS px: the layout width the PDF uses
        const r = await page.evaluate(() => {
          const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
          const root = getComputedStyle(document.documentElement);
          const textPx = [];
          for (const e of document.querySelectorAll("main *, footer *")) {
            if (e.closest("svg") || e.closest(".mm-visually-hidden, .mm-sprite") || !vis(e)) continue;
            const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (own) textPx.push([e.tagName + "." + e.className, parseFloat(getComputedStyle(e).fontSize)]);
          }
          const svgPx = [...document.querySelectorAll("main svg text")].filter(vis).map((e) => parseFloat(getComputedStyle(e).fontSize));
          return {
            bg: root.getPropertyValue("--mm-bg").trim(), bodyBg: getComputedStyle(document.body).backgroundColor,
            adjust: getComputedStyle(document.body).printColorAdjust || getComputedStyle(document.body).webkitPrintColorAdjust,
            visibleControls: [...document.querySelectorAll("select, nav.mm-nav, .mm-skip, fieldset.mm-radios, .mm-group-btn, .mm-selection, .mm-facts")].filter(vis).map((e) => e.tagName + "." + e.className),
            closedHidden: [...document.querySelectorAll("details:not([open])")].filter((d) => [...d.children].some((c) => c.tagName !== "SUMMARY" && !vis(c) && c.textContent.trim())).length,
            closedCount: document.querySelectorAll("details:not([open])").length,
            asof: document.querySelector(".mm-asof") && vis(document.querySelector(".mm-asof")) ? document.querySelector(".mm-asof").textContent : "",
            caveatPresent: Boolean(document.querySelector(".mm-caveat")), caveatVisible: [...document.querySelectorAll(".mm-caveat")].every(vis),
            sources: document.querySelector("#source-attribution") ? vis(document.querySelector("#source-attribution")) : null,
            url: vis(document.querySelector(".mm-print-url")) ? document.getElementById("mm-print-url").textContent : "",
            href: location.href,
            clipped: [...document.querySelectorAll("table, .mm-heatmap-scroll, .mm-figure")].filter((e) => vis(e) && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).map((e) => e.tagName + "#" + e.id),
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            rowBreak: [...document.querySelectorAll("main tbody tr")].filter(vis).slice(0, 3).map((tr) => getComputedStyle(tr).breakInside),
            small: textPx.filter(([, px]) => px < 10.66), svgMin: svgPx.length ? Math.min(...svgPx) : null
          };
        });
        assert.equal(r.bg.toLowerCase(), "#ffffff", "light --mm-bg in print under dark scheme");
        assert.equal(r.bodyBg, "rgb(255, 255, 255)");
        assert.equal(r.adjust, "exact");
        assert.deepEqual(r.visibleControls, [], "controls hidden");
        assert.equal(r.closedHidden, 0, `closed <details> content not visible in print (${r.closedCount} closed)`);
        assert.match(r.asof, /Data cut-off: .*build/, "freshness line");
        if (r.caveatPresent) assert.equal(r.caveatVisible, true, "caveat");
        if (r.sources !== null) assert.equal(r.sources, true, "Sources");
        assert.equal(r.url, r.href, "page URL");
        assert.deepEqual(r.clipped, [], "no table clipped");
        assert.ok(r.docOverflow <= 1, `document overflows by ${r.docOverflow}px`);
        for (const b of r.rowBreak) assert.equal(b, "avoid");
        assert.deepEqual(r.small, [], "text below 8 pt");
        if (r.svgMin !== null) t.diagnostic(`${path}: smallest chart text ${r.svgMin}px (${((r.svgMin * 72) / 96).toFixed(1)} pt)`);
        const pdf = await page.pdf({format: "A4", printBackground: true});
        assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
        assert.ok(pdf.length > 2000);
        mkdirSync(ARTIFACT_DIR, {recursive: true});
        writeFileSync(join(ARTIFACT_DIR, `${slug(path)}-print.pdf`), pdf);
        await screenshot(page, slug(path), "print-dark-scheme");
        await setPrint(page, false);
        await setTheme(page, "light");
        await setViewport(page, 1280);
      });
    });
  }

  test("beforeprint opens every closed <details> and afterprint restores them", async (t) => {
    await withPage(t, "/domain/labour", "#domain-heatmap tbody tr", async ({page}) => {
      const r = await page.evaluate(() => {
        const closed = document.querySelectorAll("details:not([open])").length;
        dispatchEvent(new Event("beforeprint"));
        const during = document.querySelectorAll("details:not([open])").length;
        dispatchEvent(new Event("afterprint"));
        return {closed, during, after: document.querySelectorAll("details:not([open])").length};
      });
      assert.ok(r.closed > 0, "fixture page has a closed <details>");
      assert.equal(r.during, 0);
      assert.equal(r.after, r.closed);
    });
  });
});

// T131 (AC-UX-9): reduced motion and forced colours. Chromium's forced-colors emulation is not Windows High Contrast
// (system colour mapping, SVG handling and backplates differ): the manual check stays with T134.
describe("T131 AC-UX-9: reduced motion and forced colours", () => {
  // What tells a state apart apart from colour: the words, the four border styles and widths, the glyphs (visible, with a box).
  const SIG = (root) => [...document.querySelectorAll(root)].map((e) => {
    const cs = getComputedStyle(e);
    const glyphs = [...e.querySelectorAll("svg.mm-glyph, .mm-glyph")].map((g) => { const b = g.getBoundingClientRect(); return `${g.querySelector("use")?.getAttribute("href") ?? "svg"}:${b.width > 0 && b.height > 0 && getComputedStyle(g).visibility !== "hidden" && getComputedStyle(g).display !== "none"}`; });
    return {
      key: e.closest("[data-state]")?.getAttribute("data-state") ?? e.getAttribute("data-feed") ?? e.closest("tr")?.getAttribute("data-class") ?? "",
      text: e.textContent.trim().replace(/\s+/g, " "),
      border: ["Top", "Right", "Bottom", "Left"].map((s) => `${cs[`border${s}Style`]} ${cs[`border${s}Width`]}`).join("|"),
      glyphs: glyphs.join(",")
    };
  });
  const moving = (page) => page.evaluate(() => [...document.querySelectorAll("body *, body *::before, body *::after")].length && [...document.querySelectorAll("body *")].filter((e) => {
    return ["", "::before", "::after"].some((p) => { const cs = getComputedStyle(e, p || null); return (cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0) || parseFloat(cs.transitionDuration) > 0; });
  }).map((e) => e.tagName + "." + e.className));

  for (const [name, path, ready] of PAGES) {
    test(`reduced motion: ${name} has no running transition or animation, also after a hover and a focus`, async (t) => {
      await withPage(t, path, ready, async ({page}) => {
        await setReducedMotion(page);
        assert.deepEqual(await moving(page), []);
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        const first = page.locator("main a, main button, main summary, main select").first();
        if (await first.count()) await first.hover().catch(() => {});
        assert.deepEqual(await moving(page), [], "after hover and focus");
      });
    });
  }

  const HM_SEL = "#domain-heatmap td[data-state] .mm-cell";
  const cases = [
    ["V1 heatmap states", "/domain/labour", HM, HM_SEL],
    ["V4 class marks", "/revisions", "#recent-revisions tbody tr", "#recent-revisions tbody tr td:nth-child(9)"]
  ];
  for (const [name, path, ready, sel] of cases) {
    test(`forced colours: ${name} keep text code, border pattern and glyph`, async (t) => {
      const pages = name.startsWith("V1") ? HM_PAGES : [null];
      const seen = new Set();
      let rankedCells = 0;
      for (const d of pages) {
        await withPage(t, d ? `/domain/${d}` : path, ready, async ({page}) => {
          const before = await page.evaluate(SIG, sel);
          await setForcedColors(page);
          assert.equal(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
          const after = await page.evaluate(SIG, sel);
          assert.ok(before.length > 0, `${name}${d ? " " + d : ""}: no elements`);
          assert.equal(after.length, before.length);
          before.forEach((b, i) => {
            const a = after[i];
            assert.ok(a.text.length > 0 || b.text.length === 0, `${name}: text gone`);
            assert.equal(a.text, b.text, `${name} ${b.key}: text code changed`);
            assert.equal(a.border, b.border, `${name} ${b.key}: border pattern changed`);
            assert.equal(a.glyphs, b.glyphs, `${name} ${b.key}: glyph lost`);
            seen.add(b.key);
          });
          if (name.startsWith("V1")) {
            const nums = await page.$$eval("#domain-heatmap td[data-state='ranked'] .mm-cell", (cs) => cs.map((c) => c.textContent.trim()));
            assert.ok(nums.every((x) => /\d/.test(x)), "numbers remain in ranked cells");
            rankedCells += nums.length;
          }
          await screenshot(page, `t131-${slug(path)}-${d ?? "page"}`, "forced");
        });
      }
      if (name.startsWith("V1")) assert.ok(rankedCells > 0, "no ranked heatmap cell was checked for its number");
      if (name.startsWith("V1")) for (const k of ["ranked", "stale", "lagging", "unaligned", "descriptive", "na", "aggregate", "low_coverage", "inherited", "plain"]) assert.ok(seen.has(k), `heatmap state ${k} not covered`);
      if (name.startsWith("V4")) assert.ok(seen.has("reestimation") && seen.has("regular"), `V4 classes: ${[...seen]}`);
    });
  }

  test("forced colours: V4 class edges and the V4 flag mark survive; the signs keep their written +/−", async (t) => {
    await withPage(t, "/revisions", "#recent-revisions tbody tr", async ({page}) => {
      await setForcedColors(page);
      const rows = await page.$$eval("#recent-revisions tbody tr", (trs) => trs.map((tr) => ({cls: tr.getAttribute("data-class"), edge: getComputedStyle(tr.children[0]).borderLeftStyle, w: parseFloat(getComputedStyle(tr.children[0]).borderLeftWidth), flag: tr.querySelector("[data-class-mark]") ? getComputedStyle(tr.querySelector("[data-class-mark]")).display !== "none" : false, signs: [...tr.querySelectorAll(".mm-signed-text")].map((s) => s.textContent.trim()[0])})));
      for (const r of rows) {
        assert.equal(r.edge, r.cls === "reestimation" ? "dashed" : "solid");
        assert.ok(r.w >= 2);
        assert.equal(r.flag, r.cls === "reestimation");
        for (const s of r.signs) assert.match(s, /[+−\d]/);
      }
    });
  });

  test("forced colours: V4 step chart marks (hollow ring, filled points, dashed removal rule, labels) stay drawn and visible", async (t) => {
    const probe = (page) => page.evaluate((STEP_SEL) => {
      const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width + b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      const paint = (e) => { const cs = getComputedStyle(e); return {stroke: cs.stroke, strokeW: cs.strokeWidth, dash: cs.strokeDasharray, fill: cs.fill}; };
      const bg = getComputedStyle(document.body).backgroundColor;
      return {
        bg,
        dots: [...document.querySelectorAll(`${STEP_SEL} g[aria-label="dot"] circle`)].map((c) => ({vis: vis(c), r: c.getAttribute("r"), hollow: c.closest("g").getAttribute("fill") === "none", p: paint(c)})),
        line: [...document.querySelectorAll(`${STEP_SEL} g[aria-label="line"] path`)].map((c) => ({vis: vis(c), p: paint(c)})),
        rules: [...document.querySelectorAll(`${STEP_SEL} g[aria-label="rule"] line`)].map((c) => ({vis: vis(c), p: paint(c)})),
        texts: [...document.querySelectorAll(`${STEP_SEL} text`)].map((x) => x.textContent.trim())
      };
    }, STEP);
    for (const [country, rules] of [["Germany", 0], ["France", 1]]) {
      await withStep(t, country, "2026-06-01", async ({page}) => {
        const before = await probe(page);
        await setForcedColors(page);
        const after = await probe(page);
        assert.ok(after.dots.length > 0);
        assert.deepEqual(after.dots.map((d) => [d.vis, d.r, d.hollow]), before.dots.map((d) => [d.vis, d.r, d.hollow]));
        assert.equal(after.dots.filter((d) => d.hollow).length, 1, "hollow ring remains");
        assert.deepEqual(after.texts, before.texts, "labels (earliest stored version, removed) remain");
        assert.equal(after.rules.length, rules);
        for (const r of after.rules) { assert.ok(r.vis); assert.ok(r.p.dash && r.p.dash !== "none", `rule stays dashed: ${r.p.dash}`); }
        if (country === "Germany") assert.ok(after.line.some((l) => l.vis), "the value line is drawn (three points)");
        assert.deepEqual(after.line.map((l) => l.vis), before.line.map((l) => l.vis), "no mark disappears");
        for (const m of [...after.dots, ...after.line.filter((l) => l.vis), ...after.rules]) {
          assert.ok(m.vis, `mark visible: ${JSON.stringify(m)}`);
          const c = m.p.stroke !== "none" ? m.p.stroke : m.p.fill;
          assert.notEqual(c, "none", "mark has a paint");
          assert.notEqual(c, after.bg, `mark paint equals the canvas colour (${c})`);
        }
        await screenshot(page, `t131-step-${country}`, "forced");
      });
    }
  });
});

describe("T132 AC-UX-6: responsive matrix and the WCAG 1.4.12 text-spacing override", () => {
  // WCAG 1.4.12 values: line height 1.5, paragraph spacing 2x font size, letter spacing 0.12em, word spacing 0.16em.
  const SPACING_CSS = "*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important}p{margin-bottom:2em !important}";
  const EXTRA = [["V1 domain agri", "/domain/agri", "#domain-heatmap tbody tr"], ["PG-INDICATOR M18", "/indicator/M18", "#indicator-table tbody tr"]];
  const MATRIX = [...PAGES, ...EXTRA];

  // Browser side: text that is cut off by a clipping box (overflow hidden/clip, ellipsis, SVG viewport) and interactive controls
  // that overlap one another. Elements inside a scrolling container (overflow auto/scroll) are not clipped, they scroll.
  const layoutProblems = (page) => page.evaluate(() => {
    const clips = (o) => o === "hidden" || o === "clip";
    // content of a closed <details> keeps boxes (content-visibility) but is not shown
    const shut = (el) => { const d = el.closest("details:not([open])"); return Boolean(d) && !el.closest("summary"); };
    const visible = (el) => { const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || shut(el)) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = (el) => `${el.localName}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/)[0]}` : ""}`;
    const clipped = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (["SCRIPT", "STYLE", "OPTION"].includes(el.tagName) || el.closest("svg") && el.localName !== "svg") continue;
      if (!visible(el) || el.closest(".mm-visually-hidden")) continue; // visually hidden text is clipped on purpose
      const cs = getComputedStyle(el);
      const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (el.localName === "svg") continue;
      if (ownsText || el.matches("select, button, input")) {
        if ((clips(cs.overflowX) || cs.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1) clipped.push(`${name(el)}: content ${el.scrollWidth} wider than box ${el.clientWidth}`);
        if (clips(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) clipped.push(`${name(el)}: content ${el.scrollHeight} taller than box ${el.clientHeight}`);
        // a clipping ancestor that hides part of this element's box
        const r = el.getBoundingClientRect();
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const pc = getComputedStyle(n);
          const hx = clips(pc.overflowX), hy = clips(pc.overflowY);
          if (!hx && !hy) continue;
          const p = n.getBoundingClientRect();
          if (p.width <= 1 || p.height <= 1) continue; // a visually hidden wrapper (thead of a card table) clips on purpose
          if ((hx && (r.left < p.left - 1 || r.right > p.right + 1)) || (hy && (r.top < p.top - 1 || r.bottom > p.bottom + 1))) clipped.push(`${name(el)} cut by ${name(n)}`);
        }
      }
    }
    // SVG text that leaves its svg viewport (svg clips by default)
    for (const svg of document.querySelectorAll("svg")) {
      if (!visible(svg)) continue;
      const s = svg.getBoundingClientRect();
      const ov = getComputedStyle(svg).overflow;
      for (const t of svg.querySelectorAll("text")) {
        if (!t.textContent.trim()) continue;
        const b = t.getBoundingClientRect();
        if (b.width === 0) continue;
        if (ov !== "visible" && (b.left < s.left - 1 || b.right > s.right + 1 || b.top < s.top - 1 || b.bottom > s.bottom + 1)) clipped.push(`svg text "${t.textContent.trim().slice(0, 30)}" outside its svg (text ${[b.left, b.right, b.top, b.bottom].map(Math.round)}, svg ${[s.left, s.right, s.top, s.bottom].map(Math.round)}, overflow ${ov})`);
      }
    }
    // controls overlapping each other (ancestor/descendant pairs excluded); only the part visible inside scroll containers counts
    const sel = "a[href], button, select, input, summary, textarea, [tabindex]:not([tabindex='-1'])";
    // one box per line box of an inline link (a wrapped link is not one big rectangle), cut to its scroll containers
    const visibleBoxes = (el) => {
      const out = [];
      for (const r of el.getClientRects()) {
        let box = {l: r.left, t: r.top, r: r.right, b: r.bottom};
        for (let n = el.parentElement; n; n = n.parentElement) {
          const o = getComputedStyle(n);
          if (o.overflowX !== "visible" || o.overflowY !== "visible") { const p = n.getBoundingClientRect(); box = {l: Math.max(box.l, p.left), t: Math.max(box.t, p.top), r: Math.min(box.r, p.right), b: Math.min(box.b, p.bottom)}; }
        }
        if (box.r > box.l && box.b > box.t) out.push(box);
      }
      return out;
    };
    const ctl = [...document.querySelectorAll(sel)].filter((e) => visible(e) && !(e.classList.contains("skip") || /skip/i.test(e.className + e.id))).map((e) => ({e, boxes: visibleBoxes(e)})).filter((x) => x.boxes.length);
    const overlap = [];
    for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
      const a = ctl[i], b = ctl[j];
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      for (const x of a.boxes) for (const y of b.boxes) {
        const w = Math.min(x.r, y.r) - Math.max(x.l, y.l), h = Math.min(x.b, y.b) - Math.max(x.t, y.t);
        if (w > 2 && h > 2) overlap.push(`${name(a.e)} "${a.e.textContent.trim().slice(0, 20)}" overlaps ${name(b.e)} "${b.e.textContent.trim().slice(0, 20)}" (${Math.round(w)}x${Math.round(h)})`);
      }
      if (overlap.length >= 8) break;
    }
    return {clipped: [...new Set(clipped)].slice(0, 12), overlap};
  });

  const sweep = async (page, label, {spacing}) => {
    const failures = [];
    for (const w of VIEWPORTS) {
      await setViewport(page, w);
      await page.waitForTimeout(150);
      const o = await horizontalOverflow(page);
      if (o.scrollW > o.vw) failures.push(`${label} ${w}px: page scrolls horizontally ${o.scrollW} > ${o.vw}; ${o.offenders.join("; ") || "none found"}`);
      const p = await layoutProblems(page);
      for (const c of p.clipped) failures.push(`${label} ${w}px: clipped: ${c}`);
      for (const c of p.overlap) failures.push(`${label} ${w}px: overlap: ${c}`);
      await screenshot(page, `t132-${label}-${w}`, spacing ? "text-spacing" : "default");
    }
    return failures;
  };

  for (const [name, path, ready] of MATRIX) {
    for (const spacing of [false, true]) {
      test(`${name}: ${spacing ? "with the 1.4.12 text-spacing override" : "default spacing"} at 320/390/768/1280/1920: no page scroll, no clipped text, no overlapping controls`, async (t) => {
        await withPage(t, path, ready, async ({page}) => {
          if (spacing) await page.addStyleTag({content: SPACING_CSS});
          assert.deepEqual(await sweep(page, slug(path), {spacing}), []);
        });
      });
    }
  }

  for (const spacing of [false, true]) {
    test(`V4 with the step chart drawn (Germany, three versions): ${spacing ? "text-spacing override" : "default spacing"} at all five widths`, async (t) => {
      await withStep(t, "Germany", "2026-06-01", async ({page}) => {
        if (spacing) await page.addStyleTag({content: SPACING_CSS});
        assert.deepEqual(await sweep(page, "revisions-step-germany", {spacing}), []);
      });
    });
    test(`V4 with the removal rule drawn (France, tombstone): ${spacing ? "text-spacing override" : "default spacing"} at all five widths`, async (t) => {
      await withStep(t, "France", "2026-06-01", async ({page}) => {
        if (spacing) await page.addStyleTag({content: SPACING_CSS});
        assert.deepEqual(await sweep(page, "revisions-step-france", {spacing}), []);
      });
    });
  }
});
