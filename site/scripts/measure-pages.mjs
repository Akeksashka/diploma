// Usage: node scripts/measure-pages.mjs [distDir] [--time-build] [--build-seconds=N] [--sample=N] [--json]
// AC-RD-53 / R23. Opens each page type in Chromium (Playwright) over a local static server and sums the bytes of the responses
// actually made on first load (HTML, CSS, JS, data), gzip computed locally (zlib level 9). Also: CSS gz, CLS, the gz cost of one
// history interaction on a country page, dist size, build time. Prints PASS/FAIL per target; exits 1 only on a hard-limit breach
// (1.5 MB per page type, ADR-023 decision 6; 5 MB for reader plus series file) and 2 when there is no browser or no built site.
// Target misses are reported, not hidden. Country and indicator rows are the MAXIMUM over every such page (worst page named);
// --sample=N measures only the first N of each to keep runtime down. On the explorer, the Parquet reader (parquet-wasm, Arrow)
// plus the series file are counted separately from the page-own files (AC-RD-53 amendment 2026-11-09).
// --time-build runs `npm run build` first (uses EXPORT_DIR from the environment) and records its duration.
// Fixture numbers understate a real 44-entity export; nothing here extrapolates.
import {spawnSync} from "node:child_process";
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {evaluateTargets, firstLoadSizes, formatReport, hardBreach, homeParts, walk} from "./lib.mjs";
import {launchBrowser, serve} from "../tests/smoke/support.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = join(here, "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const distArg = args.find((a) => !a.startsWith("--"));
const dist = resolve(distArg ?? join(siteDir, "dist"));

let sample = Infinity;
const sampleArg = args.find((a) => a.startsWith("--sample="));
if (sampleArg) sample = Math.max(1, Number(sampleArg.split("=")[1]) || 1);
let buildSeconds = null;
const given = args.find((a) => a.startsWith("--build-seconds="));
if (given) buildSeconds = Number(given.split("=")[1]);
if (flag("--time-build")) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync("npm", ["run", "build"], {cwd: siteDir, stdio: "ignore", env: process.env});
  buildSeconds = Number(process.hrtime.bigint() - t0) / 1e9;
  if (r.status !== 0) {
    console.error("npm run build failed");
    process.exit(2);
  }
}

if (!existsSync(join(dist, "index.html"))) {
  console.error(`no built site at ${dist}`);
  process.exit(2);
}
const dirSize = (d) => walk(d).reduce((n, f) => n + statSync(f).size, 0);
const names = (sub) => (existsSync(join(dist, sub)) ? readdirSync(join(dist, sub)).filter((n) => n.endsWith(".html")).sort() : []);
const manifestFile = readdirSync(join(dist, "_file", "data")).find((n) => /^manifest\.[0-9a-f]+\.json$/.test(n));
const buildId = manifestFile ? JSON.parse(readFileSync(join(dist, "_file", "data", manifestFile), "utf8")).build_id : "unknown";

const {browser, reason} = await launchBrowser();
if (!browser) {
  console.error(reason);
  process.exit(2);
}
const site = await serve(dist);

// V27: interaction selectors per mode page (AC-V2-40). Each selector is clicked in turn (first match, at most `limit` clicks per selector);
// the bytes of responses added by each click (URLs not seen before) are summed per click; the heaviest single click and the cumulative total
// are reported. A page without any matching control reports no interaction (N/A), never zero.
const INTERACTIONS = {
  country: ['details.mm-l1 > summary', 'button[data-action="more"]', 'button[data-action="expand"]', "button[data-history]"],
  compare: ['button[data-action="more"]', 'button[data-action="expand"]', "button[data-history]"]
};

// V60: the heaviest Home interaction: choose another Indicator in the Home control (the scorecard of its domain, and the series file of C1 and C4, are read on demand).
// Up to `limit` Indicators with a domain other than the default are tried in turn; each adds only URLs not seen before.
async function homeInteraction(page, settle, limit = 4) {
  const options = await page.$$eval("#home-ctl-indicator option", (os) => os.map((o) => o.value).filter(Boolean));
  const clicks = [];
  for (const value of options.slice(0, limit)) {
    const seen = new Set((await settle()).map((r) => r.url));
    await page.selectOption("#home-ctl-indicator", value);
    let last = -1;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(600);
      const count = (await settle()).length;
      if (count === last) break;
      last = count;
    }
    clicks.push({value, ...firstLoadSizes((await settle()).filter((r) => !seen.has(r.url)))});
  }
  if (clicks.length === 0) return null;
  const heaviest = clicks.reduce((a, b) => (b.gzip > a.gzip ? b : a));
  return {clicks: clicks.length, gzip: heaviest.gzip, indicator: heaviest.value, total: clicks.reduce((n, c) => n + c.gzip, 0)};
}

async function measurePage(path, {interact = false, interactions = null, homeMode = false} = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pending = [];
  const bodies = [];
  page.on("response", (res) => {
    const p = res.body().then(
      (body) => bodies.push({url: res.url(), body, order: bodies.length}),
      () => {
        /* redirected or aborted body: not counted */
      },
    );
    pending.push(p);
  });
  // Body reads finish after the response event; wait for all of them so late responses are not missed.
  const settle = async () => {
    let n;
    do {
      n = pending.length;
      await Promise.all(pending);
    } while (pending.length !== n);
    return bodies.slice();
  };
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({type: "layout-shift", buffered: true});
  });
  await page.goto(`${site.origin}${path}`, {waitUntil: "networkidle"});
  await page.waitForTimeout(600);
  await page.waitForLoadState("networkidle");
  const responses = await settle();
  const first = firstLoadSizes(responses);
  let history = null;
  if (interact) {
    const btn = page.locator("button[data-history]").first();
    if ((await btn.count()) > 0) {
      const before = (await settle()).length;
      await btn.click();
      const key = await btn.getAttribute("data-history");
      await page.waitForSelector(`#history-${key}[data-state="loaded"], #history-${key}[data-state="error"]`, {timeout: 20000}).catch(() => {});
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      const after = await settle();
      const added = after.slice(before);
      // Responses already counted on first load are excluded by URL.
      const firstUrls = new Set(after.slice(0, before).map((r) => r.url));
      history = {key, state: await page.locator(`#history-${key}`).getAttribute("data-state"), ...firstLoadSizes(added.filter((r) => !firstUrls.has(r.url)))};
    }
  }
  let interaction = null;
  if (interactions) {
    const clicks = [];
    for (const sel of interactions) {
      const loc = page.locator(sel);
      const n = Math.min(await loc.count(), 3);
      for (let k = 0; k < n; k++) {
        const target = loc.nth(k);
        if (!(await target.isVisible().catch(() => false))) continue;
        // A <summary> of an already open <details> would close it (0 B, hides its buttons): click only closed ones.
        if (sel.endsWith("> summary") && (await target.evaluate((el) => el.parentElement.open))) continue;
        const seen = new Set((await settle()).map((r) => r.url));
        const ok = await target.click({timeout: 5000}).then(() => true, () => false);
        if (!ok) continue; // a failed click is not a measured click
        // Wait until the response count stops changing for 600 ms (networkidle returns at once when already idle).
        let last = -1;
        for (let i = 0; i < 40; i++) {
          await page.waitForTimeout(600);
          const count = (await settle()).length;
          if (count === last) break;
          last = count;
        }
        const added = (await settle()).filter((r) => !seen.has(r.url));
        clicks.push({selector: sel, index: k, ...firstLoadSizes(added)});
      }
    }
    if (clicks.length) {
      const heaviest = clicks.reduce((a, b) => (b.gzip > a.gzip ? b : a));
      interaction = {clicks: clicks.length, gzip: heaviest.gzip, selector: heaviest.selector, index: heaviest.index, total: clicks.reduce((n, c) => n + c.gzip, 0)};
    }
  }
  const cls = await page.evaluate(() => window.__cls ?? null);
  const home = homeMode ? {...homeParts(responses), interaction: await homeInteraction(page, settle)} : null;
  await context.close();
  return {first, cls, history, interaction, home};
}

const countries = names("country");
const indicators = names("indicator");
const pages = {};
const detail = {};
const worst = {};
const measuredCount = {};
const record = (name, r, label = name) => {
  const prev = pages[name];
  measuredCount[name] = (measuredCount[name] ?? 0) + 1;
  const cls = Math.max(r.cls ?? 0, prev?.cls ?? 0);
  const css = Math.max(r.first.css, prev?.css ?? 0);
  if (!prev || r.first.gzip > prev.gzip) {
    pages[name] = {gzip: r.first.gzip, own: r.first.own, reader: r.first.reader, css, cls};
    detail[name] = r.first;
    worst[name] = label;
  } else {
    prev.css = css;
    prev.cls = cls;
  }
  pages[name].css = css;
  pages[name].cls = cls;
};
const homeRun = await measurePage("/", {homeMode: true});
record("home", homeRun, "/");
const home = homeRun.home ? {landing: homeRun.home.landing.gzip, landingFiles: homeRun.home.landing.files, deferred: homeRun.home.deferred.gzip, deferredFiles: homeRun.home.deferred.files, deferredReader: homeRun.home.deferred.reader, geometry: homeRun.home.geometry, interaction: homeRun.home.interaction} : null;
let history = null;
let countryPath = null;
// Every country page (or --sample=N); the first one that offers a history button is also used for the history interaction.
for (const c of countries.slice(0, sample)) {
  const r = await measurePage(`/country/${c.replace(/\.html$/, "")}`, {interact: !history});
  record("country", r, c);
  if (r.history && !history) {
    history = r.history;
    countryPath = c;
  }
}
// V27: Country-mode interactions (every country page, or --sample=N) and PG-COMPARE (`/compare`, landing recorded, no new limit).
const interactions = {country: null, compare: null};
const interactionPage = {};
for (const c of countries.slice(0, sample)) {
  const r = await measurePage(`/country/${c.replace(/\.html$/, "")}`, {interactions: INTERACTIONS.country});
  if (r.interaction && (!interactions.country || r.interaction.gzip > interactions.country.gzip)) {
    interactions.country = r.interaction;
    interactionPage.country = c;
  }
}
if (existsSync(join(dist, "compare.html"))) {
  const r = await measurePage("/compare", {interactions: INTERACTIONS.compare});
  record("compare", r, "compare");
  interactions.compare = r.interaction;
  interactionPage.compare = "compare";
}
for (const c of indicators.slice(0, sample)) record("indicator", await measurePage(`/indicator/${c.replace(/\.html$/, "")}`), c);
for (const p of ["explorer", "domains", "revisions"]) if (existsSync(join(dist, `${p}.html`))) record(p === "explorer" ? "series (explorer)" : p, await measurePage(`/${p}`), p);
await browser.close();
await site.close();

const rows = evaluateTargets({pages, history, interactions, home});
if (flag("--json")) console.log(JSON.stringify({buildId, buildSeconds, distBytes: dirSize(dist), pages, detail, worst, measuredCount, history, countryPath, interactions, home, interactionPage, rows}, null, 2));
else {
  console.log(formatReport(rows, {buildId, buildSeconds, distBytes: dirSize(dist)}));
  console.log(`pages measured: ${Object.entries(measuredCount).map(([k, v]) => `${k} ${v}`).join(", ")}${Number.isFinite(sample) ? ` (--sample=${sample})` : " (all)"}`);
  console.log(`worst page (max first load): ${Object.entries(worst).map(([k, v]) => `${k}: ${v} (${pages[k].gzip} B gz)`).join("; ")}`);
  console.log(`history interaction page: ${countryPath ?? "none"}`);
  if (history) console.log(`history interaction: ${history.key}, state ${history.state}, ${history.files} new file(s), ${history.gzip} B gz, ${history.raw} B raw`);
  else console.log("history interaction: not measured (no history button on any country page)");
  for (const [k, v] of Object.entries(interactions)) console.log(v ? `interaction ${k}: ${v.clicks} click(s) measured on ${interactionPage[k]}, heaviest ${v.gzip} B gz (${v.selector} #${v.index}), all clicks ${v.total} B gz` : `interaction ${k}: not measured (no matching control${interactionPage[k] ? "" : " or no page"})`);
  if (home) console.log(`home: landing ${home.landing} B gz in ${home.landingFiles} file(s); deferred ${home.deferred} B gz in ${home.deferredFiles} file(s) (reader and series ${home.deferredReader} B gz); map geometry ${home.geometry ?? "n/a"} B gz; heaviest interaction ${home.interaction ? `${home.interaction.gzip} B gz (indicator ${home.interaction.indicator}, ${home.interaction.clicks} tried, all ${home.interaction.total} B gz)` : "not measured"}`);
  console.log("Fixture-only numbers; a real 44-entity export is heavier (AC-RD-53 stays partly unmet until R24).");
}
process.exit(hardBreach(rows) ? 1 : 0);
