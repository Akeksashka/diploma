// T94 browser smoke (AC-DASH-1, 3, 4, 7 stale banner, AC-SYS-10) of V1-V5 on a built fixture site.
// Serves dist/ from 127.0.0.1 only; any off-origin request is aborted and fails the test.
// Skips with a clear message when no browser is available, unless MM_SMOKE_REQUIRE_BROWSER=1 (CI).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {gzipBytes, LANDING_LIMIT_BYTES, walk} from "../../scripts/lib.mjs";
import {DIST, REQUIRE_BROWSER, builtManifestPath, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

const NOW = "2026-11-04T12:00:00Z"; // fixed browser clock: the fixture known_cutoff is 2026-11-01
const TIMEOUT = 20000;

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
let staleSite = null;
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
  staleSite = await serve(DIST, {manifestOverride: (m) => ({...m, known_cutoff: "2025-06-01T00:00:00Z"})});
  manifest = JSON.parse(readFileSync(builtManifestPath(), "utf8"));
});

after(async () => {
  await browser?.close();
  await site?.close();
  await staleSite?.close();
});

// Runs `fn({page, log, origin})` in a fresh context with the fixed clock; skips when there is no browser.
async function withPage(t, path, ready, fn, {srv = () => site, fixedTime = NOW} = {}) {
  if (!browser) return t.skip(reason);
  const s = srv();
  const {page, context, log} = await openPage(browser, s.origin, {fixedTime});
  try {
    await page.goto(`${s.origin}${path}`);
    if (ready) await page.waitForSelector(ready, {timeout: TIMEOUT});
    await fn({page, log, origin: s.origin});
  } finally {
    await context.close();
  }
}

async function until(cond, what, ms = TIMEOUT) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const clean = (log) => {
  assert.deepEqual(log.errors, [], "page or console errors");
  assert.deepEqual(log.offOrigin, [], "off-origin requests");
  assert.deepEqual(log.failed, [], "failed requests");
};
// The detail table sits in a closed <details> (T112); open it so its text is rendered. It is in the DOM either way.
const openDetails = (page) => page.evaluate(() => { document.querySelector("#domain-values").open = true; });
// The peer table has the country as a row header (th), so its first cell is a th.
const peerCells = (page) => page.$$eval("#peer-table tbody tr", (rows) => rows.map((r) => [...r.querySelectorAll("th, td")].map((c) => c.innerText.trim())));
const cells = (page, sel) => page.$$eval(sel, (rows) => rows.map((r) => [...r.querySelectorAll("td")].map((c) => c.innerText.trim())));

describe("AC-DASH-1: V1-V5 render without error and without an off-origin request", () => {
  const PAGES = [
    ["V1 landing", "/", "#domain-list li"],
    ["V1 labour", "/domain/labour", "#domain-heatmap tbody tr"],
    ["V1 prices", "/domain/prices", "#domain-heatmap tbody tr"],
    ["V1 agri (unranked)", "/domain/agri", "#domain-heatmap tbody tr"],
    ["V1 global (unranked)", "/domain/global", "#domain-heatmap tbody tr"],
    ["V1 fin", "/domain/fin", "#domain-heatmap tbody tr"],
    ["V2 peers labour", "/peers/labour", "#peer-table tbody tr"],
    ["V2 peers prices", "/peers/prices", "#peer-table tbody tr"],
    ["V3 explorer", "/explorer", "#series-captions tbody tr"],
    ["V4 revisions", "/revisions", "#recent-revisions tbody tr"],
    ["V5 status", "/status", "#group-table tbody tr"]
  ];
  for (const [name, path, ready] of PAGES) {
    test(name, async (t) => {
      await withPage(t, path, ready, async ({page, log}) => {
        await page.waitForLoadState("networkidle");
        const n = await page.locator(ready).count();
        assert.ok(n > 0, `${path}: nothing rendered for ${ready}`);
        clean(log);
      });
    });
  }

  test("landing first load, measured in the browser, is within 1.5 MB gzip -9", async (t) => {
    await withPage(t, "/", "#domain-list li", async ({page, log, origin}) => {
      await page.waitForLoadState("networkidle");
      const urls = [...new Set(log.requests.filter((u) => u.startsWith(origin)))].map((u) => new URL(u).pathname);
      const bodies = urls.map((p) => site.served.findLast((s) => s.path === p)).filter(Boolean);
      assert.ok(bodies.length >= 5);
      const total = bodies.reduce((n, b) => n + gzipBytes(b.bytes), 0);
      assert.ok(total <= LANDING_LIMIT_BYTES, `${total} bytes gzipped over ${bodies.length} files`);
    });
  });
});

describe("V1 golden numbers (AC-DASH-3): ten sampled pairs equal the published tables", () => {
  const fmtValue = (v) => String(Number(v.toPrecision(7)));
  test("displayed value and percentile equal the published scorecard JSON", async (t) => {
    if (!browser) return t.skip(reason);
    const domains = dataJson("meta/domains.json").domains.map((d) => d.domain_id).sort();
    const pool = [];
    for (const d of domains) {
      const sc = dataJson(`scorecard/${d}.json`);
      for (const e of [...sc.entities].sort((a, b) => a.entity_id.localeCompare(b.entity_id))) {
        for (const i of e.indicators) {
          if (i.published !== false && i.publish_scope !== "excluded" && typeof i.value === "number") {
            pool.push({domain: d, ranked: sc.ranked !== false, entity: e.entity_id, ind: i});
          }
        }
      }
    }
    assert.ok(pool.length >= 10, `only ${pool.length} published pairs in the fixture`);
    const step = pool.length / 10;
    const sample = Array.from({length: 10}, (_, k) => pool[Math.floor(k * step)]);
    assert.equal(new Set(sample.map((s) => `${s.domain}/${s.entity}/${s.ind.indicator_id}`)).size, 10);
    const byDomain = new Map();
    for (const s of sample) byDomain.set(s.domain, [...(byDomain.get(s.domain) ?? []), s]);
    let ranked = 0;
    for (const [d, items] of byDomain) {
      await withPage(t, `/domain/${d}`, "#domain-heatmap tbody tr", async ({page}) => {
        await openDetails(page);
        for (const s of items) {
          const row = page.locator(`#domain-detail tr[data-entity="${s.entity}"][data-indicator="${s.ind.indicator_id}"]`);
          const [, , value, , pct] = await row.locator("td").allInnerTexts();
          assert.ok(value.startsWith(fmtValue(s.ind.value)), `${d}/${s.entity}/${s.ind.indicator_id}: shown "${value}", published ${s.ind.value}`);
          const p = s.ind.percentile;
          const shownAsRank = s.ranked && s.ind.is_stale !== true && s.ind.rank_mode !== "descriptive_only" && typeof p === "number";
          if (shownAsRank) {
            assert.equal(pct.trim(), p.toFixed(2), `${d}/${s.entity}/${s.ind.indicator_id} percentile`);
            ranked += 1;
          } else {
            assert.ok(!/^\d\.\d\d$/.test(pct.trim()), `${d}/${s.entity}/${s.ind.indicator_id}: a number is shown where no percentile is published: "${pct}"`);
          }
        }
      });
    }
    assert.ok(ranked >= 3, `only ${ranked} of the ten sampled pairs carry a published percentile`);
  });
});

describe("AC-DASH-4 on the rendered pages", () => {
  test("stale value shows its flag and no rank; unranked domains show no rank", async (t) => {
    await withPage(t, "/domain/labour", "#domain-heatmap tbody tr", async ({page}) => {
      await openDetails(page);
      const staleRows = await cells(page, '#domain-detail tr[data-status="stale"]');
      assert.ok(staleRows.length > 0, "the fixture has stale cells");
      for (const r of staleRows) {
        assert.match(r[5], /stale/);
        assert.equal(r[4], "no rank (stale)");
      }
    });
    for (const d of ["agri", "global"]) {
      await withPage(t, `/domain/${d}`, "#domain-heatmap tbody tr", async ({page}) => {
        await openDetails(page);
        const rows = await cells(page, "#domain-detail tbody tr");
        for (const r of rows) assert.ok(["unranked domain", "n/a"].includes(r[4]), `percentile cell "${r[4]}"`);
        assert.equal(await page.locator("#domain-heatmap [data-bin=\"1\"], #domain-heatmap [data-bin=\"2\"], #domain-heatmap [data-bin=\"3\"], #domain-heatmap [data-bin=\"4\"], #domain-heatmap [data-bin=\"5\"]").count(), 0, "no colour scale");
        assert.equal(await page.locator("#domain-heatmap button[data-sort=\"mean\"]").count(), 0, "no percentile column to sort");
        const body = await page.innerText("body");
        assert.match(body, /informational and unranked/);
      });
    }
  });
});

describe("V2 peer comparison: group filter and sort", () => {
  test("filter keeps only members of the chosen group; sort reorders", async (t) => {
    await withPage(t, "/peers/labour", "#peer-table tbody tr", async ({page, log}) => {
      const all = (await peerCells(page)).map((r) => r[0]);
      const groups = dataJson("meta/groups.json").groups;
      const entities = dataJson("meta/entities.json").entities;
      const nameOf = new Map(entities.map((e) => [e.entity_id, e.name]));
      const g = groups.find((x) => x.members.length < all.length && x.members.some((m) => all.includes(nameOf.get(m.entity_id))));
      assert.ok(g, "the fixture has a group that is a proper subset of the labour panel");
      await page.check(`#peer-group input[value="${g.group_id}"]`);
      await page.waitForFunction((n) => document.querySelectorAll("#peer-table tbody tr").length !== n, all.length, {timeout: TIMEOUT});
      const shown = (await peerCells(page)).map((r) => r[0]);
      const members = new Set(g.members.map((m) => nameOf.get(m.entity_id)));
      assert.ok(shown.length > 0 && shown.length < all.length);
      for (const n of shown) assert.ok(members.has(n), `${n} is not a member of ${g.group_id}`);
      await page.check('#peer-group input[value="all"]');
      await page.waitForFunction((n) => document.querySelectorAll("#peer-table tbody tr").length === n, all.length, {timeout: TIMEOUT});

      await page.selectOption("#peer-sort", "name");
      await page.waitForFunction(() => {
        const n = [...document.querySelectorAll("#peer-table tbody tr")].map((r) => r.querySelector("th").innerText.trim());
        return n.length > 1 && n.every((x, i) => i === 0 || n[i - 1].localeCompare(x) <= 0);
      }, null, {timeout: TIMEOUT});
      const byName = (await peerCells(page)).map((r) => r[0]);
      assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b)));
      await page.selectOption("#peer-sort", "value_asc");
      await page.waitForFunction(() => {
        const v = [...document.querySelectorAll("#peer-table tbody tr")].map((r) => parseFloat(r.querySelectorAll("td")[0].innerText)).filter((x) => !Number.isNaN(x));
        return v.length > 1 && v.every((x, i) => i === 0 || v[i - 1] <= x);
      }, null, {timeout: TIMEOUT});
      const vals = (await peerCells(page)).map((r) => parseFloat(r[1])).filter((v) => !Number.isNaN(v));
      assert.deepEqual(vals, [...vals].sort((a, b) => a - b));
      clean(log);
    });
  });
});

describe("T118 V2 controls: radio group, sort, URL-hash focus", () => {
  const PEERS = "#peer-table tbody tr";
  test("the group is a fieldset with a legend and the six labels; radios are at least 24 px; choosing a group only filters (AC-DASH-9)", async (t) => {
    await withPage(t, "/peers/labour", PEERS, async ({page, log}) => {
      const r = await page.evaluate(() => {
        const fs = document.querySelector("fieldset#peer-group");
        const radios = [...fs.querySelectorAll("input[type=radio]")];
        return {
          legend: fs.querySelector("legend")?.textContent.trim(),
          labels: radios.map((x) => x.closest("label").innerText.trim()),
          checked: radios.filter((x) => x.checked).map((x) => x.value),
          small: radios.filter((x) => x.getBoundingClientRect().width < 24 || x.getBoundingClientRect().height < 24).length,
          sort: document.querySelector("#peer-sort") !== null,
          noGroupSelect: document.querySelector("select#peer-group") === null
        };
      });
      assert.equal(r.legend, "Peer group (filter)");
      assert.equal(r.labels[0], "All countries");
      assert.deepEqual(r.checked, ["all"]);
      assert.equal(r.small, 0, "every radio is at least 24 x 24 CSS px");
      assert.ok(r.sort && r.noGroupSelect);
      const known = new Set(["All countries", "G7", "Euro area", "EU members outside the euro area", "Advanced economies", "Emerging economies"]);
      for (const l of r.labels) assert.ok(known.has(l), l);
      const pctOf = async (name) => page.$$eval(PEERS, (rows, n) => rows.find((x) => x.querySelector("th").innerText.trim() === n)?.querySelectorAll("td")[3].innerText.trim() ?? null, name);
      const before = await pctOf("Germany");
      assert.ok(before);
      await page.check('#peer-group input[value="g7"]');
      await page.waitForFunction(() => document.querySelectorAll("#peer-table tbody tr").length < 7, null, {timeout: TIMEOUT});
      assert.equal(await pctOf("Germany"), before, "the stored percentile is the same with and without the filter");
      clean(log);
    });
  });

  test("a country name sets #c=<id>, highlights chart and table, survives a reload and clears; invalid hash is ignored; nothing is stored", async (t) => {
    await withPage(t, "/peers/labour", PEERS, async ({page, log, origin}) => {
      const id = await page.$eval("#peer-table tbody tr[data-status=ranked]", (r) => r.dataset.entity);
      await page.click(`#peer-table button[data-entity="${id}"]`);
      await page.waitForFunction((x) => document.querySelector(`#peer-table tr[data-entity="${x}"]`)?.dataset.focus === "true", id, {timeout: TIMEOUT});
      assert.equal(new URL(page.url()).hash, `#c=${id}`);
      assert.equal(await page.locator("#peer-table tr[data-focus=true]").count(), 1);
      assert.equal(await page.locator("#peer-figure circle[r='14']").count(), 1, "one focus ring in the chart");
      await page.reload();
      await page.waitForSelector(PEERS, {timeout: TIMEOUT});
      await page.waitForSelector("#peer-table tr[data-focus=true]", {timeout: TIMEOUT});
      assert.equal(await page.getAttribute("#peer-table tr[data-focus=true]", "data-entity"), id);
      // keyboard: Enter on the focused button clears it
      await page.focus(`#peer-table button[data-entity="${id}"]`);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelectorAll("#peer-table tr[data-focus=true]").length === 0, null, {timeout: TIMEOUT});
      for (const bad of ["#c=NOPE", "#c=", "#c=%3Cscript%3E", "#x=1"]) {
        await page.goto(`${origin}/peers/labour${bad}`);
        await page.waitForSelector(PEERS, {timeout: TIMEOUT});
        assert.equal(await page.locator("#peer-table tr[data-focus=true]").count(), 0, bad);
      }
      const stored = await page.evaluate(() => ({ls: localStorage.length, ss: sessionStorage.length, cookie: document.cookie}));
      assert.deepEqual(stored, {ls: 0, ss: 0, cookie: ""});
      clean(log);
    });
  });
});

describe("V3 explorer: indicator, transform, rebase and one-file fetch", () => {
  test("a new indicator fetches exactly one series file; NSA offers no seasonal-only transform; rebase", async (t) => {
    await withPage(t, "/explorer", "#series-captions tbody tr", async ({page, log}) => {
      const seriesReq = () => log.requests.filter((u) => /\/_file\/data\/series\/[A-Za-z0-9]+\.[0-9a-f]+\.parquet/.test(u));
      const first = seriesReq();
      assert.equal(first.length, 1, `first load fetches one series file, got ${first.length}`);
      const startIndicator = await page.inputValue("#explorer-indicator");
      const other = (await page.$$eval("#explorer-indicator option", (o) => o.map((x) => x.value))).find((v) => v !== startIndicator);
      assert.ok(other);
      await page.selectOption("#explorer-indicator", other);
      await until(() => seriesReq().length >= 2, "the second series file request");
      await page.waitForLoadState("networkidle");
      const after = seriesReq();
      assert.equal(after.length, 2, "one more series file, only for the chosen indicator");
      assert.match(after[1], new RegExp(`/series/${other}\\.`));

      // P01 is NSA with a seasonal-only default transform: that transform must not be offered (AC-DASH-4).
      await page.selectOption("#explorer-indicator", "P01");
      await page.waitForFunction(() => /P01|inflation|price/i.test(document.querySelector("#explorer-title")?.textContent ?? ""), null, {timeout: TIMEOUT}).catch(() => {});
      const labels = await page.$$eval("#explorer-transform option", (o) => o.map((x) => x.textContent));
      assert.ok(labels.includes("Level"));
      assert.ok(!labels.some((l) => /M3M3|MOM|QOQ/.test(l)), `NSA offers ${labels.join(", ")}`);

      // The controls are re-created after an indicator change; retry until the new listener is attached.
      const titleHas = (re) => page.evaluate((src) => new RegExp(src).test(document.querySelector("#explorer-title")?.textContent ?? ""), re.source);
      for (let i = 0; i < 20 && !(await titleHas(/Year-on-year/)); i += 1) {
        await page.selectOption("#explorer-transform", "value_yoy");
        await page.waitForTimeout(250);
      }
      assert.ok(await titleHas(/Year-on-year/), "the transform choice did not reach the chart title");
      for (let i = 0; i < 20 && (await page.locator("#rebase-note").count()) === 0; i += 1) {
        await page.check("#explorer-rebase");
        await page.waitForTimeout(250);
      }
      await page.waitForSelector("#rebase-note", {timeout: TIMEOUT});
      assert.match(await page.textContent("#explorer-title"), /Year-on-year, rebased to 100 at/);
      assert.ok((await page.locator("#explorer-title ~ svg, figure svg, svg").count()) > 0, "a chart is drawn");
      clean(log);
    });
  });
});

describe("V4 revisions: class filter and indicator choice", () => {
  test("class filter narrows the list; choosing an indicator fetches one revision file", async (t) => {
    await withPage(t, "/revisions", "#recent-revisions tbody tr", async ({page, log}) => {
      const revReq = () => log.requests.filter((u) => /\/_file\/data\/revisions\/[A-Za-z0-9]+\.[0-9a-f]+\.parquet/.test(u));
      assert.equal(revReq().length, 0, "no revision file is fetched before a choice");
      const allRows = await page.locator("#recent-revisions tbody tr").count();
      await page.selectOption("#revision-kind", "reestimation");
      await page.waitForFunction((n) => document.querySelectorAll("#recent-revisions tbody tr").length !== n || document.querySelector("#no-ordinary"), allRows, {timeout: TIMEOUT});
      const classes = await page.$$eval("#recent-revisions tbody tr", (r) => r.map((x) => x.getAttribute("data-class")));
      assert.ok(classes.every((c) => c === "reestimation"), `classes: ${classes.join(",")}`);
      await page.selectOption("#revision-kind", "regular");
      await page.waitForFunction(() => [...document.querySelectorAll("#recent-revisions tbody tr")].every((r) => r.getAttribute("data-class") === "regular"), null, {timeout: TIMEOUT});
      assert.ok((await page.locator("#recent-revisions tbody tr").count()) > 0);

      await page.selectOption("#vintage-indicator", "M09");
      await page.waitForSelector("#vintage-history, #vintage-none, #vintage-empty, #vintage-error", {timeout: TIMEOUT});
      await page.waitForFunction(() => !document.querySelector("#vintage-choose"), null, {timeout: TIMEOUT});
      const fetched = revReq();
      assert.equal(fetched.length, 1);
      assert.match(fetched[0], /\/revisions\/M09\./);
      assert.equal(await page.locator("#vintage-error").count(), 0);
      assert.ok((await page.locator("#vintage-history tbody tr").count()) > 0, "version history rows are shown");
      clean(log);
    });
  });
});

describe("V5 status page", () => {
  test("renders the fixture status with no raw error text", async (t) => {
    await withPage(t, "/status", "#group-table tbody tr", async ({page, log}) => {
      assert.equal(await page.locator("#group-table tbody tr").count(), 4);
      const exported = dataJson("status.json");
      assert.equal((await page.textContent("#backlog-n")).replace(/,/g, "").trim(), String(exported.backlog.n_unloaded));
      assert.ok((await page.textContent("#monthly-check-text")).length > 10);
      assert.doesNotMatch(await page.innerText("body"), /Traceback|Error:|undefined|\[object Object\]/);
      clean(log);
    });
  });
});

describe("AC-DASH-7 stale banner and AC-SYS-10 build id", () => {
  test("no banner on the fresh fixture; banner on a stale fixture", async (t) => {
    for (const path of ["/", "/status", "/explorer"]) {
      await withPage(t, path, ".mm-asof", async ({page}) => {
        assert.equal(await page.locator("#stale-banner").count(), 0, `${path}: banner on fresh data`);
      });
      await withPage(
        t,
        path,
        ".mm-asof",
        async ({page}) => {
          const banner = page.locator("#stale-banner");
          assert.equal(await banner.count(), 1, `${path}: no banner on stale data`);
          assert.match(await banner.innerText(), /out of date/);
          assert.match(await banner.innerText(), /known_cutoff 2025-06-01/);
        },
        {srv: () => staleSite}
      );
    }
  });

  test("every page shows the build id of the published manifest", async (t) => {
    if (!browser) return t.skip(reason);
    const expected = process.env.MM_EXPECT_BUILD_ID ?? manifest.build_id;
    assert.equal(manifest.build_id, expected, "built manifest build_id differs from the run's build id");
    for (const path of ["/", "/domain/labour", "/peers/labour", "/explorer", "/revisions", "/status"]) {
      await withPage(t, path, ".mm-asof", async ({page, log, origin}) => {
        assert.match(await page.textContent(".mm-asof"), new RegExp(`\\(build ${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
        const f = log.requests.find((n) => /\/_file\/data\/manifest\.[0-9a-f]+\.json/.test(n));
        assert.ok(f, `${path}: the page did not request the manifest`);
        const served = await page.evaluate(async (u) => (await (await fetch(u)).json()).build_id, f);
        assert.equal(served, expected, `${path}: served manifest build_id`);
        assert.ok(origin.startsWith("http://127.0.0.1"));
      });
    }
  });
});

// ---- T105 / AC-UX-8: loading, error and stale states, simulated with Playwright route interception -----------------------
// Each failure must give a role="alert" block that names the logical region and the consequence, with no URL, no raw error
// text, no number from the failed file, and no table or chart of the failed region.
const DATA = (rel) => new RegExp(`/_file/data/${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f]+\\.(?:json|parquet)(?:\\?.*)?$`);
const RAW_TEXT = /https?:|\/_file|\.json|\.parquet|Unable to load|TypeError|SyntaxError|RuntimeError|Error:|\b404\b|undefined|NaN|\[object|schema_version/;

// Like withPage, but installs `routes` ([[regexp, handler]]) before navigating. Console "Failed to load resource" is expected
// for a simulated 404 and is not counted; any other page error still fails the test.
async function withRoutes(t, path, routes, ready, fn, {fixedTime = NOW, waitUntil = "load"} = {}) {
  if (!browser) return t.skip(reason);
  const {page, context, log} = await openPage(browser, site.origin, {fixedTime});
  for (const [re, handler] of routes) await context.route(re, handler);
  try {
    await page.goto(`${site.origin}${path}`, {waitUntil});
    if (ready) await page.waitForSelector(ready, {timeout: TIMEOUT});
    await fn({page, log});
  } finally {
    await context.close();
  }
}
const notFound = (route) => route.fulfill({status: 404, contentType: "text/plain", body: "missing"});
const json = (obj) => (route) => route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(obj)});
const withManifest = (patch) => async (route) => {
  const res = await route.fetch();
  route.fulfill({response: res, body: JSON.stringify({...(await res.json()), ...patch})});
};
const pageErrors = (log) => log.errors.filter((e) => !/Failed to load resource/.test(e));

async function assertAlert(page, selector, {region, consequence}) {
  const alert = page.locator(selector);
  assert.equal(await alert.count(), 1, `${selector}: one alert block`);
  assert.equal(await alert.getAttribute("role"), "alert");
  const text = (await alert.innerText()).trim();
  assert.ok(text.includes(region), `alert names the region "${region}": ${text}`);
  assert.ok(text.includes(consequence), `alert says the consequence: ${text}`);
  assert.ok(!RAW_TEXT.test(text), `alert carries no URL or raw error text: ${text}`);
  assert.ok(!/\d/.test(text), `alert carries no number: ${text}`);
}
async function assertNoPartialData(page, log) {
  const main = await page.innerText("#observablehq-main");
  assert.ok(!RAW_TEXT.test(main), `page text carries a URL or raw error text: ${main.slice(0, 400)}`);
  assert.equal(await page.locator("#observablehq-main table").count(), 0, "no table of the failed region");
  assert.equal(await page.locator("#observablehq-main svg").count(), 0, "no chart of the failed region");
  assert.equal(await page.locator("#observablehq-main .observablehq--error").count(), 0, "no Framework error cell");
  assert.deepEqual(pageErrors(log), [], "page or console errors");
  assert.equal(await page.locator('[aria-busy="true"]').count(), 0, "no container left busy after the failure");
}

describe("AC-UX-8 error states (route interception)", () => {
  test("missing file: the scorecard file of a domain gives one alert and no table", async (t) => {
    await withRoutes(t, "/domain/labour", [[DATA("scorecard/labour"), notFound]], "#mm-error-scorecard", async ({page, log}) => {
      await assertAlert(page, "#mm-error-scorecard", {region: "the scorecard of this domain", consequence: "The tables and charts on this page are not shown."});
      assert.equal(await page.getAttribute("#mm-error-scorecard", "data-kind"), "missing");
      assert.equal(await page.locator(".mm-asof").count(), 1, "the freshness line still shows (the manifest loaded)");
      await assertNoPartialData(page, log);
    });
  });

  test("missing file: the manifest itself (landing and status)", async (t) => {
    for (const [path, consequence] of [["/", "The list of domains is not shown."], ["/status", "The status tables on this page are not shown."]]) {
      await withRoutes(t, path, [[DATA("manifest"), notFound]], "#mm-error-manifest", async ({page, log}) => {
        await assertAlert(page, "#mm-error-manifest", {region: "the data manifest", consequence});
        assert.equal(await page.locator("#domain-list, #group-table").count(), 0);
        await assertNoPartialData(page, log);
      });
    }
  });

  test("schema-invalid file: a meta file without its list gives one alert of kind invalid", async (t) => {
    const consequence = {"/domain/labour": "The tables and charts on this page are not shown.", "/peers/labour": "The tables and charts on this page are not shown.", "/explorer": "The chart and tables on this page are not shown.", "/revisions": "The revision lists on this page are not shown."};
    for (const path of Object.keys(consequence)) {
      await withRoutes(t, path, [[DATA("meta/entities"), json({schema_version: "1.0"})]], "#mm-error-meta", async ({page, log}) => {
        await assertAlert(page, "#mm-error-meta", {region: "the descriptions of countries, indicators and series", consequence: consequence[path]});
        assert.equal(await page.getAttribute("#mm-error-meta", "data-kind"), "invalid", path);
        assert.match(await page.innerText("#mm-error-meta"), /format check/);
        await assertNoPartialData(page, log);
      });
    }
  });

  test("schema-invalid file: the status document and a non-JSON scorecard", async (t) => {
    await withRoutes(t, "/status", [[DATA("status"), json({schema_version: "1.0"})]], "#mm-error-status", async ({page, log}) => {
      await assertAlert(page, "#mm-error-status", {region: "the data status", consequence: "The status tables on this page are not shown."});
      assert.equal(await page.getAttribute("#mm-error-status", "data-kind"), "invalid");
      await assertNoPartialData(page, log);
    });
    await withRoutes(t, "/domain/prices", [[DATA("scorecard/prices"), (route) => route.fulfill({status: 200, contentType: "application/json", body: "<html>not json"})]], "#mm-error-scorecard", async ({page, log}) => {
      assert.equal(await page.getAttribute("#mm-error-scorecard", "data-kind"), "invalid");
      await assertNoPartialData(page, log);
    });
  });

  test("unknown manifest major: every page gives one alert naming the manifest, not the version", async (t) => {
    const cases = [["/", "The list of domains is not shown."], ["/domain/labour", "The tables and charts on this page are not shown."], ["/explorer", "The chart and tables on this page are not shown."], ["/revisions", "The revision lists on this page are not shown."], ["/status", "The status tables on this page are not shown."]];
    for (const [path, consequence] of cases) {
      await withRoutes(t, path, [[DATA("manifest"), withManifest({schema_version: "2.0"})]], "#mm-error-manifest", async ({page, log}) => {
        await assertAlert(page, "#mm-error-manifest", {region: "the data manifest", consequence});
        assert.equal(await page.getAttribute("#mm-error-manifest", "data-kind"), "version", path);
        assert.match(await page.innerText("#mm-error-manifest"), /not supported/);
        assert.equal(await page.locator(".mm-asof").count(), 0, `${path}: no freshness line from an unreadable manifest`);
        await assertNoPartialData(page, log);
      });
    }
  });

  test("stale known_cutoff: the confirmed banner (role=alert) shows beside the data, wording unchanged", async (t) => {
    await withRoutes(t, "/domain/labour", [[DATA("manifest"), withManifest({known_cutoff: "2025-06-01T00:00:00Z"})]], "#domain-heatmap tbody tr", async ({page, log}) => {
      const banner = page.locator("#stale-banner");
      assert.equal(await banner.getAttribute("role"), "alert");
      assert.equal((await banner.innerText()).trim(), "Data may be out of date: the latest data cutoff (known_cutoff 2025-06-01T00:00:00Z) is 521 days old, older than 45 days.");
      assert.ok(!RAW_TEXT.test((await banner.innerText()).replace(/known_cutoff/, "")));
      assert.deepEqual(pageErrors(log), []);
    });
    await withRoutes(t, "/status", [[DATA("manifest"), withManifest({known_cutoff: "not a date"})]], "#stale-banner", async ({page}) => {
      assert.equal(await page.getAttribute("#stale-banner", "role"), "alert");
      assert.match(await page.innerText("#stale-banner"), /^Data freshness unknown: the build has no readable known_cutoff/);
    });
  });

  test("one failed series file shows one alert in the explorer and does not blank the page", async (t) => {
    await withRoutes(t, "/explorer", [[/\/_file\/data\/series\/[A-Za-z0-9]+\.[0-9a-f]+\.parquet/, notFound]], "#explorer-error", async ({page, log}) => {
      await assertAlert(page, "#explorer-error", {region: "the series file of this indicator", consequence: "The rest of this page is still shown."});
      assert.equal(await page.locator("#explorer-indicator").count(), 1, "the indicator control is still there");
      assert.equal(await page.locator(".mm-asof").count(), 1);
      assert.equal(await page.locator("#series-captions").count(), 0, "no caption table of the failed file");
      assert.equal(await page.locator("#observablehq-main svg").count(), 0, "no chart of the failed file");
      assert.ok(!RAW_TEXT.test(await page.innerText("#observablehq-main")));
      assert.deepEqual(pageErrors(log), []);
      assert.equal(await page.locator('[aria-busy="true"]').count(), 0);
    });
  });

  test("one failed revision file shows one alert in the vintage view; the recent list stays", async (t) => {
    await withRoutes(t, "/revisions", [[/\/_file\/data\/revisions\/[A-Za-z0-9]+\.[0-9a-f]+\.parquet/, notFound]], "#recent-revisions tbody tr", async ({page, log}) => {
      const choice = (await page.$$eval("#vintage-indicator option", (o) => o.map((x) => x.value))).find((v) => v && v !== "" && !/choose/i.test(v));
      assert.ok(choice, "an indicator to choose");
      for (let i = 0; i < 20 && (await page.locator("#vintage-error").count()) === 0; i += 1) {
        await page.selectOption("#vintage-indicator", choice);
        await page.waitForTimeout(250);
      }
      await assertAlert(page, "#vintage-error", {region: "the revision file of this indicator", consequence: "The rest of this page is still shown."});
      assert.ok((await page.locator("#recent-revisions tbody tr").count()) > 0, "the recent list is not blanked");
      assert.equal(await page.locator("#vintage-history").count(), 0, "no history table of the failed file");
      assert.ok(!RAW_TEXT.test(await page.innerText("#vintage-view")));
      assert.deepEqual(pageErrors(log), []);
    });
  });
});

describe("AC-UX-8 loading state (route interception)", () => {
  test("the page container is aria-busy with reserved height while the data is held, then clears", async (t) => {
    let release;
    const gate = new Promise((ok) => { release = ok; });
    const hold = async (route) => { await gate; await route.continue(); };
    await withRoutes(t, "/domain/labour", [[DATA("scorecard/labour"), hold]], "#mm-loading", async ({page}) => {
      const box = page.locator("#mm-loading");
      assert.equal(await box.getAttribute("aria-busy"), "true");
      assert.equal(await box.getAttribute("role"), "status");
      assert.match(await box.innerText(), /^Loading the dashboard data\.\.\.$/);
      const h = (await box.boundingBox()).height;
      assert.ok(h >= 150, `loading container reserves height, got ${h}px`);
      assert.equal(await page.locator("#domain-detail").count(), 0, "no data shown while loading");
      release();
      await page.waitForSelector("#domain-heatmap tbody tr", {timeout: TIMEOUT});
      assert.equal(await page.locator('[aria-busy="true"]').count(), 0, "nothing stays busy");
      assert.equal(await page.locator("#mm-loading").isVisible(), false);
    }, {waitUntil: "domcontentloaded"});
  });

  test("explorer: the series container is busy while a series file is held", async (t) => {
    let release;
    const gate = new Promise((ok) => { release = ok; });
    const hold = async (route) => { await gate; await route.continue(); };
    await withRoutes(t, "/explorer", [[/\/_file\/data\/series\/[A-Za-z0-9]+\.[0-9a-f]+\.parquet/, hold]], '#series-loading[aria-busy="true"]', async ({page}) => {
      assert.equal(await page.getAttribute("#series-loading", "role"), "status");
      assert.match(await page.innerText("#series-loading"), /^Loading the series of this indicator\.\.\.$/);
      release();
      await page.waitForSelector("#series-captions tbody tr", {timeout: TIMEOUT});
      assert.equal(await page.locator('[aria-busy="true"]').count(), 0);
    }, {waitUntil: "domcontentloaded"});
  });
});

describe("AC-UX-8 no-JS notice and reduced motion", () => {
  test("the built header of every page carries the noscript notice; with JS disabled it is the visible notice", async (t) => {
    if (!browser) return t.skip(reason);
    const context = await browser.newContext({javaScriptEnabled: false, reducedMotion: "reduce"});
    try {
      const page = await context.newPage();
      for (const path of ["/", "/domain/labour", "/peers/labour", "/explorer", "/revisions", "/status"]) {
        await page.goto(`${site.origin}${path}`);
        const note = page.locator(".mm-noscript");
        assert.equal(await note.count(), 1, `${path}: noscript notice`);
        assert.match(await note.innerText(), /^This dashboard needs JavaScript to show its tables and charts\./);
        assert.equal(await page.locator("table").count(), 0, `${path}: no table without JavaScript`);
      }
    } finally {
      await context.close();
    }
  });

  test("state blocks have no animation or transition under prefers-reduced-motion", async (t) => {
    if (!browser) return t.skip(reason);
    const {page, context} = await openPage(browser, site.origin, {fixedTime: NOW});
    try {
      await context.route(DATA("scorecard/labour"), notFound);
      await page.emulateMedia({reducedMotion: "reduce"});
      await page.goto(`${site.origin}/domain/labour`);
      await page.waitForSelector("#mm-error-scorecard", {timeout: TIMEOUT});
      const s = await page.$eval("#mm-error-scorecard", (el) => {
        const c = getComputedStyle(el);
        return {animation: c.animationName, transition: c.transitionDuration};
      });
      assert.equal(s.animation, "none");
      assert.match(s.transition, /^0s(, 0s)*$/);
    } finally {
      await context.close();
    }
  });
});
