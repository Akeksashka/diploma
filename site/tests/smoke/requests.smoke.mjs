// Redesign R21 / AC-RD-51: per page type, the data files a page requests equal the files spec section 3 says it needs, every one is
// listed in manifest files[] (with the content hash of its file name), and nothing goes off origin.
// Each page is awaited on a data-dependent selector (a rendered data row or control), not on the static h1.
// Runs against a built site (npm run build). Localhost only. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1 (CI).
// MM_EXPECT_BUILD_ID, when set, must equal the built manifest build_id (guards against running against the wrong fixture).
import {defaultDomainId} from "../../src/lib/home-dashboard.js";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {after, before, describe, test} from "node:test";
import {DIST, REQUIRE_BROWSER, builtManifestPath, distBuilt, launchBrowser, openPage, serve} from "./support.mjs";

let browser = null;
let reason = distBuilt() ? "browser not started" : `no built site at ${DIST} (run npm run build with a fixture export first)`;
let site = null;
let manifest = null;
const metaIndex = {};

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
  const mp = builtManifestPath();
  manifest = JSON.parse(readFileSync(mp, "utf8"));
  if (process.env.MM_EXPECT_BUILD_ID) assert.equal(manifest.build_id, process.env.MM_EXPECT_BUILD_ID, "built manifest is not the expected fixture");
  for (const f of manifest.files) {
    if (f.path.startsWith("meta/")) metaIndex[f.path.replace(/^meta\//, "").replace(/\.json$/, "")] = `${f.path.replace(/^meta\//, "").replace(/\.json$/, "")}.${f.sha256.slice(0, 8)}.json`;
  }
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const meta = (stem) => JSON.parse(readFileSync(`${DIST}/_file/data/meta/${metaIndex[stem]}`, "utf8"));

// Requested data files as manifest paths: /_file/data/<path-without-ext>.<sha8>.<ext> -> <path>.<ext>. The manifest itself is "manifest.json".
// Returns a sorted list; with {keepDuplicates: true} a file requested twice appears twice (a Set would hide it).
function dataRequests(urls, {keepDuplicates = false} = {}) {
  const out = [];
  for (const u of urls) {
    const {pathname} = new URL(u);
    const m = pathname.match(/^\/_file\/data\/(.+)\.([0-9a-f]{8,64})\.([a-z]+)$/);
    if (pathname.startsWith("/_file/data/")) assert.ok(m, `unparseable data request ${pathname}`);
    if (!m) continue;
    const path = `${m[1]}.${m[3]}`;
    if (path !== "manifest.json") {
      const entry = manifest.files.find((f) => f.path === path);
      assert.ok(entry, `${path} is requested but not listed in manifest files[]`);
      assert.ok(entry.sha256.startsWith(m[2]), `${path}: file name hash ${m[2]} is not the manifest sha256`);
    }
    if (keepDuplicates || !out.includes(path)) out.push(path);
  }
  return out.sort();
}

async function load(t, path, ready, opts = {}) {
  if (!browser) return t.skip(reason), null;
  const {page, context, log} = await openPage(browser, site.origin);
  await page.goto(`${site.origin}${path}`);
  await page.waitForSelector(ready, {timeout: 20000});
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  const reqs = [...log.requests];
  await context.close();
  assert.deepEqual(log.offOrigin, [], "off-origin requests");
  assert.deepEqual(log.failed, [], "failed requests");
  assert.deepEqual(log.errors, [], "page or console errors");
  return dataRequests(reqs, opts);
}

const metaPaths = (...stems) => stems.map((s) => `meta/${s}.json`);
const sorted = (a) => [...a].sort();

describe("AC-RD-51 requests per page type equal the files of spec section 3", () => {
  test("PG-HOME (AC-DB-12): manifest, meta/* for the bar and exactly one scorecard (the default domain); no series/* and no history", async (t) => {
    // #filterbar exists after meta/* has loaded; the dashboard mounts in the same cell chain, so wait for its first band as well.
    const r = await load(t, "/", "#band-overview", {keepDuplicates: true}); // a list: each file must be requested exactly once
    if (!r) return;
    const d = defaultDomainId(meta("domains").domains, meta("domains").default_domain ?? null);
    assert.deepEqual(r, sorted(["manifest.json", ...metaPaths("entities", "groups", "domains", "indicators", "series"), `scorecard/${d}.json`]), "/"); // L14: meta/series.json for the tiles' reference-period format and the n/a sentence
    assert.ok(!r.some((p) => p.startsWith("series/") || p.endsWith(".parquet")), "no series or history file on first load");
  });

  test("PG-HOME (AC-DB-12): a Domain change adds only that domain's scorecard, once; switching back adds nothing (cache)", async (t) => {
    if (!browser) return t.skip(reason);
    const {page, context, log} = await openPage(browser, site.origin);
    try {
      await page.goto(`${site.origin}/`);
      await page.waitForSelector("#band-overview", {timeout: 20000});
      await page.waitForLoadState("networkidle");
      const first = dataRequests([...log.requests]);
      const domains = meta("domains").domains;
      const dflt = defaultDomainId(domains, meta("domains").default_domain ?? null);
      const other = domains.find((x) => x.domain_id !== dflt);
      assert.ok(other, "fixture has a second domain");
      const change = async (id) => {
        await page.evaluate((d) => globalThis.__mmFilterStore.set({d, i: null}), id);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);
        return dataRequests([...log.requests]);
      };
      const second = await change(other.domain_id);
      assert.deepEqual(second.filter((p) => !first.includes(p)), [`scorecard/${other.domain_id}.json`]);
      assert.equal(await page.locator("#band-domain-heading").innerText(), other.name);
      const again = await change(dflt);
      const third = await change(other.domain_id);
      assert.deepEqual(third, again, "switching back and forth requests nothing new");
      assert.equal(log.requests.filter((u) => u.includes(`/scorecard/${other.domain_id}.`)).length, 1, "one request per domain");
      assert.ok(!third.some((p) => p.startsWith("series/")));
      assert.deepEqual(log.errors, []);
    } finally {
      await context.close();
    }
  });

  test("PG-DOMAINS reads no data file but the manifest (lists are built at build time)", async (t) => {
    const r = await load(t, "/domains", ".mm-asof");
    if (r) assert.deepEqual(r, ["manifest.json"], "/domains");
  });

  test("V9 (AC-V2-62): the country list page and its picker request the manifest, meta/entities.json and meta/groups.json, each once, and nothing else", async (t) => {
    const r = await load(t, "/country", "#picker-slot select", {keepDuplicates: true});
    if (r) assert.deepEqual(r, sorted(["manifest.json", ...metaPaths("entities", "groups")]), "/country");
  });

  test("V8: PG-COMPARE (shell only until V17) reads no data file but the manifest", async (t) => {
    const r = await load(t, "/compare", ".mm-asof");
    if (r) assert.deepEqual(r, ["manifest.json"], "/compare");
  });

  // V12 (spec 3, L1: one series file per indicator on demand; the first two domain cards are open): after the load event the page reads the series file of each indicator that the first two
  // domains list and the country has a stored series for, once each, and no other series file until a card is opened or a history button is used.
  test("PG-COUNTRY: meta/*, one scorecard per domain except global, and the series files of the indicators of the first two (open) L1 cards", async (t) => {
    const id = firstCountry();
    const r = await load(t, `/country/${id}`, ".mm-country-domain table tbody tr", {keepDuplicates: true}); // a list: each file is requested exactly once
    if (!r) return;
    const domains = meta("domains").domains.filter((d) => d.domain_id !== "global");
    const stored = new Set(meta("series").series.filter((s) => s.entity_id === id).map((s) => s.indicator_id));
    const listed = new Set(manifest.files.map((f) => f.path));
    const l1 = new Set(domains.slice(0, 2).flatMap((d) => d.indicator_ids).filter((i) => stored.has(i)).flatMap((i) => ["parquet", "json"].map((x) => `series/${i}.${x}`)).filter((p) => listed.has(p)));
    assert.deepEqual(r, sorted(["manifest.json", ...metaPaths("entities", "groups", "domains", "indicators", "series"), ...domains.map((d) => `scorecard/${d.domain_id}.json`), ...l1]));
    assert.equal(r.filter((p) => p.startsWith("series/")).length, l1.size, "each series file once");
    assert.ok(!r.some((p) => p.startsWith("projection/") || p.startsWith("peer_stats/") || p.startsWith("series_by_entity/")), "no file outside the export contract");
  });

  test("PG-INDICATOR: meta/* and the scorecard of the first domain of the indicator only", async (t) => {
    const ind = meta("indicators").indicators[0];
    const r = await load(t, `/indicator/${ind.indicator_id}`, ".mm-indicator-table tbody tr");
    if (!r) return;
    assert.deepEqual(r, sorted(["manifest.json", ...metaPaths("entities", "indicators", "domains", "groups", "series"), `scorecard/${ind.domain_ids[0]}.json`]));
  });

  test("PG-SERIES: meta/*, alerts and one series file; never a revisions file", async (t) => {
    const r = await load(t, "/explorer", "#explorer-entities");
    if (!r) return;
    const series = r.filter((p) => p.startsWith("series/"));
    assert.equal(series.length, 1, `one series file, got ${series}`);
    assert.deepEqual(r, sorted(["manifest.json", "alerts.json", ...metaPaths("entities", "indicators", "domains", "groups", "series"), ...series]));
  });

  test("PG-DOMAIN: its scorecard and meta/*", async (t) => {
    const d = meta("domains").domains.find((x) => x.domain_id !== "global") ?? meta("domains").domains[0];
    const r = await load(t, `/domain/${d.domain_id}`, "#domain-heatmap tbody tr");
    if (!r) return;
    assert.deepEqual(r, sorted(["manifest.json", `scorecard/${d.domain_id}.json`, ...metaPaths("entities", "groups", "indicators", "domains", "series")])); // the bar has a Group control (L24)
  });

  test("PG-REVISIONS: the recent-revisions file and meta/*, no per-indicator revisions file before a choice", async (t) => {
    const r = await load(t, "/revisions", "#recent-revisions tbody tr");
    if (!r) return;
    assert.deepEqual(r, sorted(["manifest.json", "revisions_recent.json", ...metaPaths("entities", "indicators", "series")]));
  });
});

function firstCountry() {
  return meta("entities").entities.find((e) => e.is_global !== true).entity_id;
}
