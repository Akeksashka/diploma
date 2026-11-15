// Redesign R21 / AC-RD-01, 02, 52, 62: the built site has exactly the pages of spec section 2, every internal link resolves,
// every entity and indicator is linked from the home page, no page is unreachable, and there is no status or guide page.
// Runs on dist/ (npm run build with a fixture export); skips with a reason when dist/ is absent. MM_SMOKE_DIST overrides the folder.
import assert from "node:assert/strict";
import {existsSync, readFileSync, statSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {describe, test} from "node:test";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {walk} from "../scripts/lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(process.env.MM_SMOKE_DIST ?? join(root, "dist"));
const built = existsSync(join(dist, "index.html"));
const reason = `no built site at ${dist} (run npm run build with a fixture export first)`;
// MM_REQUIRE_DIST=1 (CI) turns the skip into a failure.
const requireDist = process.env.MM_REQUIRE_DIST === "1";
const skip = built || requireDist ? false : reason;

test("a built site exists when MM_REQUIRE_DIST=1", {skip: requireDist ? false : "MM_REQUIRE_DIST is not 1"}, () => {
  assert.ok(built, reason);
});

const dataFile = (stem) => {
  const dir = join(dist, "_file", "data", ...stem.split("/").slice(0, -1));
  const base = stem.split("/").at(-1);
  const f = existsSync(dir) ? walk(dir).find((p) => new RegExp(`/${base}\\.[0-9a-f]+\\.json$`).test(p)) : undefined;
  assert.ok(f, `no built data file for ${stem}`);
  return JSON.parse(readFileSync(f, "utf8"));
};

// Page URL path of a built html file: index.html -> "/", a/b.html -> "/a/b".
const pagePath = (file) => {
  const rel = relative(dist, file).split("\\").join("/");
  return rel === "index.html" ? "/" : `/${rel.replace(/\.html$/, "")}`;
};
const builtPages = () => walk(dist).filter((f) => f.endsWith(".html")).map(pagePath).sort();
const pageFile = (p) => join(dist, p === "/" ? "index.html" : `${p.slice(1)}.html`);
// V46: the language switch (class mm-lang) points into the other language tree, which this single-tree test cannot see; tests/lang-switch.test.mjs checks its target against the other tree.
const hrefs = (html) => [...html.matchAll(/<a\s(?![^>]*class="mm-lang")[^>]*?href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
const isFile = (f) => existsSync(f) && statSync(f).isFile();
const external = (h) => /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith("//");

describe("R21 build pages", {skip: skip || !built ? skip || "no built site (reported by the MM_REQUIRE_DIST test)" : false}, () => {
  const entities = built ? dataFile("meta/entities").entities : [];
  const indicators = built ? dataFile("meta/indicators").indicators : [];
  const domains = built ? dataFile("meta/domains").domains : [];
  const countries = entities.filter((e) => e.is_global !== true);

  test("AC-RD-01: exactly the pages of spec section 2", () => {
    const expected = [
      "/",
      "/country",
      "/compare",
      "/explorer",
      "/domains",
      "/revisions",
      ...countries.map((e) => `/country/${e.entity_id}`),
      ...indicators.map((i) => `/indicator/${i.indicator_id}`),
      ...domains.map((d) => `/domain/${d.domain_id}`)
    ].sort();
    assert.ok(countries.length > 0 && indicators.length > 0 && domains.length > 0, "export lists entities, indicators and domains");
    assert.deepEqual(builtPages(), expected);
  });

  test("AC-RD-01, 62: no status, guide or peers page or artefact", () => {
    for (const p of builtPages()) assert.ok(!/^\/(status|guide|peers)(\/|$)/.test(p), p);
    // Whole dist tree, any depth: no file or directory named status, guide or peers (with or without extension).
    for (const f of walk(dist)) {
      const rel = relative(dist, f).split("\\").join("/");
      // Only the bundled peers library module (src/lib/peers.js, used by the indicator page) is exempt; no other file or directory is.
      if (/^_import\/lib\/peers\.[0-9a-f]+\.js$/.test(rel)) continue;
      assert.ok(!rel.split("/").some((seg) => /^(status|guide|peers)(\.|$)/.test(seg)), rel);
    }
  });

  test("AC-RD-01 (six pages, D-1): the header navigation is Home, Country, Compare, Time series, Domains, Revisions on every page", () => {
    for (const p of builtPages()) {
      const html = readFileSync(pageFile(p), "utf8");
      const nav = html.match(/<nav[^>]*class="[^"]*mm-nav[^"]*"[^>]*>([\s\S]*?)<\/nav>/);
      assert.ok(nav, `${p}: no .mm-nav`);
      const pairs = [...nav[1].matchAll(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[2].replace(/<[^>]*>/g, "").trim(), new URL(m[1], `http://x${p}`).pathname.replace(/\/$/, "") || "/"]);
      assert.deepEqual(pairs, [["Home", "/"], ["Country", "/country"], ["Compare", "/compare"], ["Time series", "/explorer"], ["Domains", "/domains"], ["Revisions", "/revisions"]], p);
    }
  });

  test("V8 (AC-V2-92, 61): the country list page lists every country page entity in built HTML; mode pages hold the static mode switch as real links", () => {
    const list = readFileSync(pageFile("/country"), "utf8");
    for (const e of countries) assert.ok(list.includes(`href="./country/${e.entity_id}"`), e.entity_id);
    const aggregates = countries.filter((e) => e.kind !== "country");
    if (aggregates.length) assert.ok(list.includes('id="aggregate-list"'), "aggregates sub-list");
    assert.ok(list.indexOf('id="country-list"') < list.indexOf('id="aggregate-list"') || aggregates.length === 0, "countries first");
    const modePages = ["/country", "/compare", ...countries.map((e) => `/country/${e.entity_id}`), ...indicators.map((i) => `/indicator/${i.indicator_id}`)];
    for (const p of modePages) {
      const html = readFileSync(pageFile(p), "utf8");
      const sw = html.match(/<div class="mm-mode-switch"[^>]*>([\s\S]*?)<\/ul><\/div>/);
      assert.ok(sw, `${p}: static mode switch`);
      const links = [...sw[1].matchAll(/<a [^>]*?href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2], new URL(m[1], `http://x${p}`).pathname.replace(/\/$/, "")]);
      assert.deepEqual(links, [["Country", "/country"], ["Compare", "/compare"]], p);
      const mode = p === "/compare" || p.startsWith("/indicator/") ? "Compare" : "Country";
      assert.equal((sw[1].match(/aria-current="page"/g) ?? []).length, 1, p);
      assert.ok(new RegExp(`aria-current="page">${mode}</a>`).test(sw[1]), `${p}: current mode is ${mode}`);
      assert.ok(!/[#&?]m=/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), `${p}: the route is the mode, no m key`);
    }
  });

  test("AC-RD-02: every internal link resolves to a built page or file", () => {
    const pages = new Set(builtPages());
    let checked = 0;
    for (const p of builtPages()) {
      for (const h of hrefs(readFileSync(pageFile(p), "utf8"))) {
        if (h === "" || h.startsWith("#") || external(h)) continue;
        const path = decodeURIComponent(new URL(h, `http://x${p}`).pathname).replace(/\/$/, "") || "/";
        assert.ok(pages.has(path) || isFile(join(dist, path)), `${p}: broken link ${h}`);
        assert.ok(!/^\/(status|guide|peers)(\/|$)/.test(path), `${p}: link to ${h}`);
        checked += 1;
      }
    }
    assert.ok(checked > 20, "checked a plausible number of links");
  });

  test("AC-RD-02: every non-global entity and every indicator is linked from the home page", () => {
    const hs = new Set(hrefs(readFileSync(pageFile("/"), "utf8")));
    for (const e of countries) assert.ok(hs.has(`./country/${e.entity_id}`), e.entity_id);
    for (const i of indicators) assert.ok(hs.has(`./indicator/${i.indicator_id}`), i.indicator_id);
    for (const h of ["./explorer", "./domains", "./revisions"]) assert.ok(hs.has(h), h);
  });

  test("V16 (AC-RD-01, 02, 05): a built country page holds the h1, the breadcrumb and the mode switch links, the no-JS notice, and no chart or percentile layer without JavaScript", () => {
    const id = countries[0].entity_id;
    const h = readFileSync(pageFile(`/country/${id}`), "utf8");
    assert.equal((h.match(/<h1[ >]/g) ?? []).length, 1);
    assert.ok(h.includes('class="mm-crumb"') && h.includes('href="../"') && h.includes('href="../#countries"'));
    assert.ok(h.includes('<a href="../country"') && h.includes('<a href="../compare"'), "the mode switch targets are real links");
    assert.ok(h.includes("<noscript>") || h.includes("mm-noscript"), "the no-JS notice");
    assert.ok(!/class="mm-caveat"|class="mm-orientation"|data-tile="domain-figure"|class="mm-pct"/.test(h), "no percentile layer in the static HTML");
    assert.ok(!h.includes("mm-l1") && !h.includes("data-card=\"k1\""), "the cards are drawn by the page code, not by the static HTML");
    assert.ok(!h.includes("projection") && !h.includes("-rebase"), "no projection or rebase control");
  });

  test("L11 (AC-DB-13, AC-RD-02, 05): built index holds h1, no-JS notice, caveat and the full link lists inside a collapsed Browse details", () => {
    const h = readFileSync(pageFile("/"), "utf8");
    assert.equal((h.match(/<h1[ >]/g) ?? []).length, 1);
    assert.ok(h.includes("mm-noscript") && h.includes('id="caveat"'));
    const start = h.indexOf('<details class="mm-browse" id="browse">');
    assert.ok(start > 0, "Browse details is in the built HTML");
    assert.ok(!/<details[^>]*id="browse"[^>]*\sopen/.test(h), "Browse is collapsed");
    const browse = h.slice(start, h.indexOf("</details>\n</section>", start) > 0 ? h.lastIndexOf("</section>") : undefined);
    for (const e of countries) assert.ok(browse.includes(`href="./country/${e.entity_id}"`), e.entity_id);
    for (const i of indicators) assert.ok(browse.includes(`href="./indicator/${i.indicator_id}"`), i.indicator_id);
    for (const l of ["./explorer", "./domains", "./revisions"]) assert.ok(browse.includes(`href="${l}"`), l);
    assert.ok(!h.includes("filter-proof"), "the L6 proof card is gone");
  });

  test("V54, V55 (AC-V2-112): the C6 geometry asset and join table are in the built site, at most 100 KB gzipped, and the Compare and indicator page scripts are the ones that name them", () => {
    const geoDir = join(dist, "_file", "geo");
    assert.ok(existsSync(geoDir), "dist/_file/geo exists");
    const asset = walk(geoDir).filter((f) => /europe-countries\.[0-9a-f]+\.geojson$/.test(f));
    assert.equal(asset.length, 1);
    assert.ok(gzipSync(readFileSync(asset[0])).length <= 100 * 1024);
    assert.ok(walk(geoDir).some((f) => /entity_geo_join\.[0-9a-f]+\.json$/.test(f)));
    const named = (p) => /europe-countries/.test(readFileSync(pageFile(p), "utf8"));
    assert.ok(!named("/explorer") && !named("/domains") && !named("/revisions"), "the Time series, Domains and Revisions pages do not name the asset (Home gains C6 in V58)");
  });

  test("AC-RD-02: no built page is unreachable from the home page", () => {
    const pages = new Set(builtPages());
    const seen = new Set(["/"]);
    const queue = ["/"];
    while (queue.length) {
      const p = queue.shift();
      for (const h of hrefs(readFileSync(pageFile(p), "utf8"))) {
        if (h === "" || h.startsWith("#") || external(h)) continue;
        const path = decodeURIComponent(new URL(h, `http://x${p}`).pathname).replace(/\/$/, "") || "/";
        if (pages.has(path) && !seen.has(path)) {
          seen.add(path);
          queue.push(path);
        }
      }
    }
    assert.deepEqual([...pages].filter((p) => !seen.has(p)), []);
  });
});

describe("AC-RD-52 no new dependency", () => {
  test("package.json lists only the reviewed dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@observablehq/framework", "@observablehq/plot", "d3"]);
    assert.deepEqual(Object.keys(pkg.devDependencies ?? {}).sort(), ["playwright"]);
    assert.equal(pkg.optionalDependencies, undefined);
    assert.equal(pkg.peerDependencies, undefined);
  });
});
