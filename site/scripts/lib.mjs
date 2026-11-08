// Pure helpers for the build-check scripts (testable with `node --test`; no network, no deps).
import {createHash} from "node:crypto";
import {readdirSync, readFileSync} from "node:fs";
import {join, posix, relative, sep} from "node:path";
import {gzipSync} from "node:zlib";
import {countryHeader} from "../src/lib/country-model.js";
import {firstDomainId, indicatorHeader} from "../src/lib/indicator-model.js";
import {CAVEAT} from "../src/lib/copy.js";
import {DOMAINS_TITLE, domainsListHtml} from "../src/lib/domains-list.js";
import {homeListsHtml} from "../src/lib/home-lists.js";

export const LANDING_LIMIT_BYTES = 1_500_000; // AC-DASH-2: 1.5 MB (MB = 1,000,000 bytes) gzipped

export function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
export const gzipBytes = (buf) => gzipSync(buf, {level: 9}).length;

// Lines "<sha256>  <bytes>  <path under _npm>" sorted by path; the content of site/npm-imports.lock.
export function npmImportsManifest(distDir) {
  const root = join(distDir, "_npm");
  let files = [];
  try {
    files = walk(root);
  } catch {
    files = [];
  }
  return files
    .map((f) => {
      const buf = readFileSync(f);
      return {path: relative(root, f).split(sep).join("/"), bytes: buf.length, sha256: sha256(buf)};
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function formatLock(entries) {
  return entries.map((e) => `${e.sha256}  ${e.bytes}  ${e.path}`).join("\n") + "\n";
}

export function parseLock(text) {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => {
      const m = /^([0-9a-f]{64}) {2}(\d+) {2}(.+)$/.exec(l);
      if (!m) throw new Error(`malformed lock line: ${l}`);
      return {sha256: m[1], bytes: Number(m[2]), path: m[3]};
    });
}

// Returns human-readable differences; empty means the build matches the committed lock.
export function diffLock(expected, actual) {
  const exp = new Map(expected.map((e) => [e.path, e]));
  const act = new Map(actual.map((e) => [e.path, e]));
  const out = [];
  for (const [p, e] of act) {
    const x = exp.get(p);
    if (!x) out.push(`not in lock: ${p}`);
    else if (x.sha256 !== e.sha256) out.push(`hash differs: ${p}`);
  }
  for (const p of exp.keys()) if (!act.has(p)) out.push(`in lock but not built: ${p}`);
  return out;
}

// Files fetched on first load of a built page: the HTML, then every ./ reference in it (stylesheets,
// module preloads, registered data files), then static imports of those JS files, recursively.
// Dynamic import() and lazily loaded libraries are NOT followed (they are not first-load requests).
// Parquet files registered by a page (series/*, revisions/*) are read lazily after a selection by
// FileAttachment().parquet(); they are budgeted per interaction (interactionBudget), not here.
export function landingSet(distDir, page = "index.html") {
  const seen = new Set();
  const queue = [page];
  const refRe = /(?:href|src)="(\.{1,2}\/[^"]+)"|"(\/_file\/[^"]+)"|"(\.{1,2}\/_file\/[^"]+)"|\bfrom\s*"(\.{1,2}\/[^"]+)"|\bimport\s*"(\.{1,2}\/[^"]+)"/g;
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    let buf;
    try {
      buf = readFileSync(join(distDir, rel));
    } catch {
      continue;
    }
    seen.add(rel);
    if (!/\.(html|js|mjs)$/.test(rel)) continue;
    const text = buf.toString("utf8");
    for (const m of text.matchAll(refRe)) {
      const ref = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
      const base = posix.dirname(rel);
      const target = ref.startsWith("/") ? ref.slice(1) : posix.normalize(posix.join(base, ref));
      if (!target.endsWith(".parquet")) queue.push(target);
    }
  }
  return [...seen].sort().map((rel) => {
    const buf = readFileSync(join(distDir, rel));
    return {path: rel, bytes: buf.length, gzip: gzipBytes(buf)};
  });
}

export function sumGzip(entries) {
  return entries.reduce((s, e) => s + e.gzip, 0);
}

// AC-UX-12 (ADR-025): CSS at most 20 KB gzip -9; landing set at most 600 KB (internal target) and 1.5 MB (hard limit).
export const CSS_LIMIT_BYTES = 20_000;
export const LANDING_TARGET_BYTES = 600_000;
// Sizes of a landing set (entries from landingSet): CSS files alone, everything, and each budget verdict.
export function landingBudget(entries) {
  const css = entries.filter((e) => e.path.endsWith(".css"));
  const cssGzip = sumGzip(css);
  const totalGzip = sumGzip(entries);
  return {
    cssFiles: css.length,
    cssGzip,
    totalGzip,
    cssOk: css.length > 0 && cssGzip <= CSS_LIMIT_BYTES,
    targetOk: totalGzip <= LANDING_TARGET_BYTES,
    limitOk: totalGzip <= LANDING_LIMIT_BYTES
  };
}

// npm audit gate (ADR-023 decision 7, ADR-024 AC-NPM-4). `report` is `npm audit --json` output;
// `shipped` is a Set of package names whose code ships in dist/. Returns {fail, shippedHigh, buildOnlyHigh, counts}.
export function auditGate(report, shipped) {
  const vulns = report?.vulnerabilities ?? {};
  const shippedHigh = [];
  const buildOnlyHigh = [];
  for (const [name, v] of Object.entries(vulns)) {
    if (v.severity !== "high" && v.severity !== "critical") continue;
    (shipped.has(name) ? shippedHigh : buildOnlyHigh).push(`${name} (${v.severity})`);
  }
  return {fail: shippedHigh.length > 0, shippedHigh, buildOnlyHigh, counts: report?.metadata?.vulnerabilities ?? {}};
}

// Package names whose files are in dist/_node or dist/_npm ("name@version" directories).
export function shippedPackages(distDir) {
  const names = new Set();
  for (const sub of ["_node", "_npm"]) {
    let files = [];
    try {
      files = walk(join(distDir, sub));
    } catch {
      continue;
    }
    for (const f of files) {
      const parts = relative(join(distDir, sub), f).split(sep);
      const i = parts[0].startsWith("@") ? 2 : 1;
      const id = parts.slice(0, i).join("/");
      names.add(id.replace(/@[^@/]+$/, ""));
    }
  }
  return names;
}

// Domain pages (T89): Framework resolves FileAttachment paths statically, so prepare-data writes one
// small page per domain in meta/domains.json into src/domain/ (git-ignored) from this template.
export const DOMAIN_ID_RE = /^[a-z][a-z0-9_]{0,40}$/;

// T104: every page has exactly one static h1. Generated pages write it as HTML so the (escaped) domain name needs no
// Markdown escaping; a missing name falls back to the fixed page title.
const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const pageH1 = (prefix, name) => `<h1>${escHtml(name ? `${prefix}: ${name}` : prefix)}</h1>`;

export function domainPageSource(domainId, name = null) {
  if (!DOMAIN_ID_RE.test(domainId)) throw new Error(`unsafe domain_id: ${JSON.stringify(domainId)}`);
  return `---
title: Domain scorecard
---

${pageH1("Domain scorecard", name)}

\`\`\`js
import {parseManifest} from "../lib/manifest.js";
import {listOf} from "../lib/meta.js";
import {pageHead, attributionBlock} from "../lib/shell.js";
import {domainView} from "../lib/scorecard.js";
import {domainBlock} from "../lib/scorecard-view.js";
import {DRAFT_REGIONS as R} from "../lib/copy.js";
import {busyBlock, loadAll, setBusy} from "../lib/state-blocks.js";
\`\`\`

\`\`\`js
const busy = busyBlock(html, R.loadingData);
display(busy);
\`\`\`

\`\`\`js
// A failed file never throws into the page: loadAll returns one failed region per file (T105).
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("../data/manifest.json").json(), parse: parseManifest},
  {key: "meta", region: R.meta, load: async () => ({series: await FileAttachment("../data/meta/series.json").json(), entities: await FileAttachment("../data/meta/entities.json").json(), indicators: await FileAttachment("../data/meta/indicators.json").json(), domains: await FileAttachment("../data/meta/domains.json").json()}),
    parse: (m) => ({seriesMeta: listOf(m.series, "series"), entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators"), domains: listOf(m.domains, "domains")})},
  {key: "scorecard", region: R.scorecard, load: () => FileAttachment("../data/scorecard/${domainId}.json").json()}
], (d) => ({dv: domainView(d.scorecard, {entities: d.meta.entities, indicators: d.meta.indicators, domains: d.meta.domains})}), R.scorecard);
setBusy(busy, false);
\`\`\`

<p><a href="../domains">All domains</a></p>

\`\`\`js
display(pageHead(html, boot, "scorecard"));
if (boot.ok) {
  const dv = boot.derived.dv;
  display(domainBlock(html, dv));
  display(attributionBlock(html, boot.data.meta.seriesMeta, dv.indicatorIds));
}
\`\`\`
`;
}

// V3 explorer page (T91). Framework resolves FileAttachment paths statically, so prepare-data writes
// src/explorer.md (git-ignored) with one FileAttachment per `series/<id>.parquet|json` file of the
// manifest. A FileAttachment is lazy: only the file of the chosen indicator is fetched, on selection.
export const SERIES_PATH_RE = /^series\/([A-Za-z][A-Za-z0-9_]{0,40})\.(parquet|json)$/;

export function seriesPaths(manifest) {
  const out = [];
  for (const f of manifest.files ?? []) {
    const m = SERIES_PATH_RE.exec(f.path ?? "");
    if (m) out.push({id: m[1], path: f.path});
    else if (typeof f.path === "string" && f.path.startsWith("series/")) throw new Error(`unsafe series path: ${JSON.stringify(f.path)}`);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function explorerPageSource(manifest) {
  const attachments = seriesPaths(manifest)
    .map((s) => `  ${JSON.stringify(s.id)}: FileAttachment(${JSON.stringify(`data/${s.path}`)})`)
    .join(",\n");
  return `---
title: Explorer
---

# Time-series explorer

\`\`\`js
import * as Plot from "@observablehq/plot";
import {parseManifest} from "./lib/manifest.js";
import {listOf} from "./lib/meta.js";
import {pageHead, attributionBlock} from "./lib/shell.js";
import {explorerContext, indicatorGroups, initialSelection, loadSeries, buildModel, replaceHash, selectionHash} from "./lib/explorer.js";
import {selectBox, explorerControls, explorerLayout, explorerBlock} from "./lib/explorer-view.js";
import {DRAFT_REGIONS as R} from "./lib/copy.js";
import {busyBlock, loadAll, setBusy} from "./lib/state-blocks.js";
\`\`\`

\`\`\`js
const busy = busyBlock(html, R.loadingData);
display(busy);
// Idle until a series file is being read (aria-busy turns true for that interaction only).
const seriesBusy = busyBlock(html, R.loadingSeries, {id: "series-loading", visible: false});
\`\`\`

\`\`\`js
// FileAttachment must be called in the page (not in an imported module); each one is lazy.
const seriesFiles = {
${attachments}
};
// A failed file never throws into the page: loadAll returns one failed region per file (T105).
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("data/manifest.json").json(), parse: parseManifest},
  {key: "meta", region: R.meta, load: async () => ({series: await FileAttachment("data/meta/series.json").json(), entities: await FileAttachment("data/meta/entities.json").json(), indicators: await FileAttachment("data/meta/indicators.json").json(), domains: await FileAttachment("data/meta/domains.json").json(), groups: await FileAttachment("data/meta/groups.json").json()}),
    parse: (m) => ({seriesMeta: listOf(m.series, "series"), entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators"), domains: listOf(m.domains, "domains"), groups: listOf(m.groups, "groups")})},
  {key: "alerts", region: R.alerts, load: () => FileAttachment("data/alerts.json").json(), parse: (a) => listOf(a, "alerts")}
], (d) => ({ctx: explorerContext({manifest: d.manifest, seriesMeta: d.meta.seriesMeta, entities: d.meta.entities, indicators: d.meta.indicators, alerts: d.alerts, groups: d.meta.groups, domains: d.meta.domains, knownCutoff: d.manifest.known_cutoff})}), R.meta);
setBusy(busy, false);
const ctx = boot.derived?.ctx ?? null;
\`\`\`

\`\`\`js
// The address, re-read on hashchange (also for a link on the page or Back/Forward). replaceState below fires no hashchange, and a
// hash equal to the one last seen or written is not passed on, so an unchanged address re-renders nothing.
const addr = {seen: location.hash};
const pHash = Generators.observe((notify) => {
  const read = () => { if (location.hash !== addr.seen) { addr.seen = location.hash; notify(addr.seen); } };
  notify(addr.seen);
  addEventListener("hashchange", read);
  return () => removeEventListener("hashchange", read);
});
\`\`\`

\`\`\`js
// #i and #c set the first indicator and countries; unrecognised parts fall back to the default (first indicator of the first domain, no country).
// \`sel\` follows the user's choices (countries are kept when the indicator changes); \`touched\` is set by the first user change.
const initial = ctx ? initialSelection(ctx, pHash) : null;
const sel = {entities: initial ? [...initial.entities] : [], touched: false, last: null};
const indicatorBox = ctx ? selectBox(html, {id: "explorer-indicator", label: "Indicator", groups: indicatorGroups(ctx), value: initial.indicator ?? undefined}) : null;
const pIndicator = ctx ? Generators.input(indicatorBox.querySelector("select")) : null;
\`\`\`

\`\`\`js
// One interaction (a new indicator) fetches the one file of that indicator, at most 5 MB.
setBusy(seriesBusy, ctx !== null);
let loaded = {rows: [], error: null};
try {
  if (ctx) loaded = await loadSeries(ctx.files.get(pIndicator), seriesFiles[pIndicator]);
} finally {
  setBusy(seriesBusy, false);
}
// The link to the data file only resolves its address; it fetches nothing.
let fileHref = null;
try {
  if (ctx) fileHref = await seriesFiles[pIndicator]?.url() ?? null;
} catch (e) {
  fileHref = null;
}
const fresh = ctx !== null && !sel.touched && pIndicator === initial.indicator;
const box = ctx ? explorerControls(html, ctx, pIndicator, loaded.rows, {indicator: pIndicator, entities: sel.entities, note: fresh && initial.note}) : null;
const pEntities = box ? Generators.input(box.entities) : null;
const pTransform = box ? Generators.input(box.transform.querySelector("select")) : null;
const pFrom = box ? Generators.input(box.from.querySelector("select")) : null;
const pTo = box ? Generators.input(box.to.querySelector("select")) : null;
const pRebase = box ? Generators.input(box.rebase.querySelector("input")) : null;
const pBase = box ? Generators.input(box.base.querySelector("select")) : null;
const pFree = box ? Generators.input(box.free.querySelector("input")) : null;
\`\`\`

\`\`\`js
display(pageHead(html, boot, "explorer"));
// Shown in its own cell, apart from the controls: the controls cell waits for the series file, the busy block must not.
display(seriesBusy);
\`\`\`

\`\`\`js
// Controls (left rail, or a "Selection" disclosure on compact screens) and the chart area sit side by side in one layout.
const layout = box ? explorerLayout(html, {indicator: indicatorBox, box}) : null;
if (layout) display(layout.el);
\`\`\`

\`\`\`js
if (box) {
  const model = buildModel(ctx, pIndicator, loaded.rows, {entities: pEntities, transform: pTransform, from: pFrom, to: pTo, rebase: pRebase, base: pBase});
  layout.main.replaceChildren(explorerBlock(html, Plot, model, loaded.error, {free: pFree, href: fileHref}), attributionBlock(html, boot.data.meta.seriesMeta, [pIndicator]));
}
\`\`\`

\`\`\`js
// Write the address after a user change of indicator or countries (replaceState, picker order). Nothing is written on load.
if (box && layout) {
  const now = {i: pIndicator, c: selectionHash(pIndicator, pEntities, box.order)};
  if (sel.last === null) sel.last = now;
  else if (now.i !== sel.last.i || now.c !== sel.last.c) {
    const entitiesChanged = now.c !== selectionHash(pIndicator, box.start, box.order);
    sel.last = now;
    sel.touched = true;
    sel.entities = [...pEntities];
    document.getElementById("explorer-hash-note")?.remove();
    if (entitiesChanged) document.getElementById("explorer-norows-note")?.remove();
    if (replaceHash(location, history, now.c)) addr.seen = location.hash;
  }
}
\`\`\`
`;
}

// Explorer interaction budget (T91, spec section 8: data fetched by one explorer interaction <= 5 MB).
// The first interaction loads the Parquet reader (Arrow + parquet-wasm, lazily imported) and one series
// file; later interactions load one series file only. Sizes are real gzip -9 (a proxy: what Pages sends
// is ADR-023 C2, [UNVERIFIED]) and raw.
export const INTERACTION_LIMIT_BYTES = 5_000_000;
const READER_DIR_RE = /^(apache-arrow|parquet-wasm|flatbuffers|tslib)@/;

export function interactionBudget(distDir) {
  const libs = {files: 0, raw: 0, gzip: 0};
  let names = [];
  try {
    names = readdirSync(join(distDir, "_npm"));
  } catch {
    names = [];
  }
  for (const n of names.filter((x) => READER_DIR_RE.test(x))) {
    for (const f of walk(join(distDir, "_npm", n))) {
      const buf = readFileSync(f);
      libs.files++;
      libs.raw += buf.length;
      libs.gzip += gzipBytes(buf);
    }
  }
  let largest = {path: null, raw: 0, gzip: 0};
  try {
    for (const sub of ["series", "revisions"]) {
      let files = [];
      try {
        files = walk(join(distDir, "_file", "data", sub));
      } catch {
        files = []; // no such directory
      }
      for (const f of files) {
        const buf = readFileSync(f);
        if (buf.length > largest.raw) largest = {path: relative(distDir, f).split(sep).join("/"), raw: buf.length, gzip: gzipBytes(buf)};
      }
    }
  } catch {
    // unreadable
  }
  return {libs, largest, firstInteraction: {raw: libs.raw + largest.raw, gzip: libs.gzip + largest.gzip}, laterInteraction: {raw: largest.raw, gzip: largest.gzip}};
}

// V4 vintage and revision page (T92). Like the explorer, FileAttachment needs literal paths, so
// prepare-data writes src/revisions.md (git-ignored) with one lazy FileAttachment per
// `revisions/<id>.parquet` of the manifest. Nothing is read until the user chooses an indicator.
// The page variable is NOT named `view` (collides with a Framework builtin).
export const REVISION_PATH_RE = /^revisions\/([A-Za-z][A-Za-z0-9_]{0,40})\.parquet$/;

export function revisionPaths(manifest) {
  const out = [];
  for (const f of manifest.files ?? []) {
    const m = REVISION_PATH_RE.exec(f.path ?? "");
    if (m) out.push({id: m[1], path: f.path});
    else if (typeof f.path === "string" && f.path.startsWith("revisions/")) throw new Error(`unsafe revisions path: ${JSON.stringify(f.path)}`);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function revisionsPageSource(manifest) {
  const attachments = revisionPaths(manifest)
    .map((s) => `  ${JSON.stringify(s.id)}: FileAttachment(${JSON.stringify(`data/${s.path}`)})`)
    .join(",\n");
  return `---
title: Revisions
---

# Vintage and revision view

\`\`\`js
import {parseManifest} from "./lib/manifest.js";
import {listOf} from "./lib/meta.js";
import {pageHead, attributionBlock} from "./lib/shell.js";
import {KIND_OPTIONS, NO_CHOICE, historyView, indicatorChoices, loadRevisions, parseRecent, recentView, revisionsContext} from "./lib/revisions.js";
import {editionsBlock, historyBlock, historyControls, noticeBlock, ordinaryBlock, selectBox} from "./lib/revisions-view.js";
import * as Plot from "@observablehq/plot";
import {DRAFT_REGIONS as R} from "./lib/copy.js";
import {busyBlock, loadAll, setBusy} from "./lib/state-blocks.js";
\`\`\`

\`\`\`js
const busy = busyBlock(html, R.loadingData);
display(busy);
// Idle until a revision file is being read (aria-busy turns true for that interaction only).
const histBusy = busyBlock(html, R.loadingRevisions, {id: "revisions-loading", visible: false});
\`\`\`

\`\`\`js
// FileAttachment must be called in the page (not in an imported module); each one is lazy.
const revisionFiles = {
${attachments}
};
// A failed file never throws into the page: loadAll returns one failed region per file (T105).
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("data/manifest.json").json(), parse: parseManifest},
  {key: "meta", region: R.meta, load: async () => ({series: await FileAttachment("data/meta/series.json").json(), entities: await FileAttachment("data/meta/entities.json").json(), indicators: await FileAttachment("data/meta/indicators.json").json()}),
    parse: (m) => ({seriesMeta: listOf(m.series, "series"), entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators")})},
  {key: "recent", region: R.recent, load: () => FileAttachment("data/revisions_recent.json").json(), parse: parseRecent}
], (d) => ({ctx: revisionsContext({manifest: d.manifest, seriesMeta: d.meta.seriesMeta, entities: d.meta.entities, indicators: d.meta.indicators})}), R.meta);
setBusy(busy, false);
const ctx = boot.derived?.ctx ?? null;
// url() only resolves the address of each file (for the detail links); it does not fetch the file.
const revisionUrls = ctx ? Object.fromEntries(await Promise.all(Object.entries(revisionFiles).map(async ([id, f]) => [id, await f.url()]))) : {};
const kindBox = ctx ? selectBox(html, {id: "revision-kind", label: "Revision class", options: KIND_OPTIONS}) : null;
const pKind = ctx ? Generators.input(kindBox.querySelector("select")) : null;
const histIndicatorBox = ctx ? selectBox(html, {id: "vintage-indicator", label: "Indicator", options: indicatorChoices(ctx)}) : null;
const pHistIndicator = ctx ? Generators.input(histIndicatorBox.querySelector("select")) : null;
\`\`\`

\`\`\`js
display(pageHead(html, boot, "revisions"));
if (ctx) {
  display(noticeBlock(html));
  display(html\`<div class="mm-revisions">\${kindBox}</div>\`);
}
\`\`\`

\`\`\`js
// The page variable is NOT named view (collides with a Framework builtin).
const rv = ctx ? recentView(boot.data.recent, ctx, {kind: pKind}) : null;
if (rv) {
  display(ordinaryBlock(html, rv));
  display(editionsBlock(html, rv, revisionUrls));
}
\`\`\`

\`\`\`js
// One interaction (a new indicator) fetches the one revision file of that indicator, at most 5 MB.
setBusy(histBusy, ctx !== null && pHistIndicator !== NO_CHOICE);
let loaded = {rows: [], error: null};
try {
  if (ctx && pHistIndicator !== NO_CHOICE) loaded = await loadRevisions(ctx.files.get(pHistIndicator), revisionFiles[pHistIndicator]);
} finally {
  setBusy(histBusy, false);
}
const hbox = ctx ? historyControls(html, ctx, pHistIndicator, loaded.rows) : null;
const pSeries = hbox ? Generators.input(hbox.series.querySelector("select")) : null;
const pPeriod = hbox ? Generators.input(hbox.period.querySelector("select")) : null;
\`\`\`

\`\`\`js
if (hbox) {
  display(html\`<div class="mm-revisions"><h2>Vintage history</h2><div>\${histIndicatorBox}\${hbox.series}\${hbox.period}</div></div>\`);
  display(histBusy);
}
\`\`\`

\`\`\`js
if (hbox) {
  const hv = historyView(ctx, pHistIndicator, loaded.rows, {series: pSeries, period: pPeriod});
  display(historyBlock(html, hv, {error: loaded.error, chosen: pHistIndicator !== NO_CHOICE, Plot}));
  display(attributionBlock(html, boot.data.meta.seriesMeta, [...new Set([...rv.rows.map((r) => r.indicatorId), ...(pHistIndicator === NO_CHOICE ? [] : [pHistIndicator])])]));
}
\`\`\`
`;
}

// Page ids of generated country and indicator pages (git-ignored like domain/*.md).
export const PAGE_ID_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,40}$/;

// R6: the country page (PG-COUNTRY). Static part: breadcrumb, h1 = entity name, kind and group memberships (from the export at
// build time). The scorecard FileAttachment paths must be literal, so one per domain id is written. R7 renders the controls and the domain sections (country-view.js).
// `manifest` (optional): its series files get one lazy FileAttachment each, used only by "Show history" (R8); without it no
// history button is offered. (Framework preloads the Parquet reader scripts for any page that names a .parquet FileAttachment,
// in the page or in a module it imports, dynamically or not; the reader runs and the file is fetched only on activation.)
export function countryPageSource(entity, groups, domainIds, manifest = null) {
  if (!PAGE_ID_RE.test(entity.entity_id)) throw new Error(`unsafe country id: ${JSON.stringify(entity.entity_id)}`);
  for (const d of domainIds) if (!DOMAIN_ID_RE.test(d)) throw new Error(`unsafe domain_id: ${JSON.stringify(d)}`);
  const h = countryHeader(entity, groups);
  const groupText = h.memberships.length ? h.memberships.map((m) => escHtml(m.label)).join(", ") : escHtml(h.noGroupsText);
  // Spec section 3: every scorecard except `global` (it holds WLD only, which has no country page).
  const scorecards = domainIds.filter((d) => d !== "global").map((d) => `${JSON.stringify(d)}: await FileAttachment("../data/scorecard/${d}.json").json()`).join(", ");
  const attachments = manifest ? seriesPaths(manifest).map((s) => `${JSON.stringify(s.id)}: FileAttachment(${JSON.stringify(`../data/${s.path}`)})`).join(", ") : "";
  return `---
title: Country
---

<div role="group" aria-label="${escHtml(h.labels.crumb)}" class="mm-crumb"><ol><li><a href="../">${escHtml(h.labels.home)}</a></li><li><a href="../#countries">${escHtml(h.labels.countries)}</a></li><li aria-current="page">${escHtml(h.name)}</li></ol></div>

<h1 data-entity="${escHtml(h.entityId)}">${escHtml(h.name)}</h1>

<p class="mm-country-facts">${escHtml(h.labels.kind)}: ${escHtml(h.kind ?? "")}. ${escHtml(h.labels.groups)}: ${groupText}.</p>

\`\`\`js
import * as Plot from "@observablehq/plot";
import {parseManifest} from "../lib/manifest.js";
import {listOf} from "../lib/meta.js";
import {pageHead, attributionBlock} from "../lib/shell.js";
import {countryModel} from "../lib/country-model.js";
import {countryBlock, switcherOptions} from "../lib/country-view.js";
import {historySource} from "../lib/history.js";
import {CAVEAT, DRAFT_REGIONS as R, ORIENTATION_NOTE} from "../lib/copy.js";
import {busyBlock, loadAll, setBusy} from "../lib/state-blocks.js";
\`\`\`

\`\`\`js
const busy = busyBlock(html, R.loadingData);
display(busy);
\`\`\`

\`\`\`js
// A failed file never throws into the page: loadAll returns one failed region per file (T105).
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("../data/manifest.json").json(), parse: parseManifest},
  {key: "meta", region: R.meta, load: async () => ({series: await FileAttachment("../data/meta/series.json").json(), entities: await FileAttachment("../data/meta/entities.json").json(), indicators: await FileAttachment("../data/meta/indicators.json").json(), domains: await FileAttachment("../data/meta/domains.json").json(), groups: await FileAttachment("../data/meta/groups.json").json()}),
    parse: (m) => ({seriesMeta: listOf(m.series, "series"), entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators"), domains: listOf(m.domains, "domains"), groups: listOf(m.groups, "groups")})},
  {key: "scorecards", region: R.scorecard, load: async () => ({${scorecards}})}
], (d) => {
  const entity = d.meta.entities.find((e) => e.entity_id === ${JSON.stringify(entity.entity_id)});
  if (!entity) throw new Error("entity not in meta/entities.json");
  return {options: switcherOptions(d.meta.entities.filter((e) => e.is_global !== true)), model: countryModel({entity, domains: d.meta.domains, scorecards: d.scorecards, indicators: d.meta.indicators, series: d.meta.seriesMeta, groups: d.meta.groups})};
}, R.scorecard);
setBusy(busy, false);
\`\`\`

\`\`\`js
// FileAttachment must be called in the page (not in an imported module); each one is lazy and nothing is fetched until "Show history".
const seriesFiles = {${attachments}};
\`\`\`

\`\`\`js
display(pageHead(html, boot, "scorecard"));
if (boot.ok) {
  const model = boot.derived.model;
  // ADR-026 decision 3: caveat first, then the orientation note, and the latter only where a percentile is shown.
  display(html\`<p class="mm-caveat">\${CAVEAT}</p>\${model.showsPercentiles ? html\`<p class="mm-orientation">\${ORIENTATION_NOTE}</p>\` : ""}\`);
  display(countryBlock(html, Plot, model, boot.derived.options, historySource(boot.data.manifest, seriesFiles)));
  display(attributionBlock(html, boot.data.meta.seriesMeta));
}
\`\`\`
`;
}

// R9: the indicator page (PG-INDICATOR). Static part (build time, from meta): breadcrumb, h1 = indicator name, identifier,
// domain links, unit, frequency set, direction label, notes[] verbatim, transform label. The scorecard FileAttachment is
// literal and is only that of the FIRST domain of `domain_ids` (spec section 3, AC-RD-24). `transformId`: the stored
// transform_id of the indicator's cells (storedTransformId), else the indicator's default_transform.
// R10 renders controls, charts and the table (indicator-view.js). `manifest` (optional): when it lists `series/<id>.parquet|json` for
// this indicator, a lazy FileAttachment resolves the address of the download link (nothing is fetched until the link is used).
export function indicatorPageSource(indicator, domains, transformId = null, manifest = null) {
  if (!PAGE_ID_RE.test(indicator.indicator_id)) throw new Error(`unsafe indicator id: ${JSON.stringify(indicator.indicator_id)}`);
  const first = firstDomainId(indicator);
  for (const d of indicator.domain_ids) if (!DOMAIN_ID_RE.test(d)) throw new Error(`unsafe domain_id: ${JSON.stringify(d)}`);
  const h = indicatorHeader(indicator, domains, transformId);
  const seriesFile = manifest ? seriesPaths(manifest).find((p) => p.id === indicator.indicator_id && p.path.endsWith(".parquet")) ?? null : null;
  const f = h.labels.facts;
  const facts = [
    [f.id, escHtml(h.indicatorId)],
    [f.domains, h.domains.map((d) => `<a href="../domain/${escHtml(d.id)}">${escHtml(d.name)}</a>`).join(", ")],
    [f.unit, h.unit === null ? null : escHtml(h.unit)],
    [f.frequency, h.frequencies.length ? escHtml(h.frequencies.join(", ")) : null],
    [f.direction, h.directionText === null ? null : escHtml(h.directionText)],
    [f.transform, h.transformLabel === null ? null : escHtml(h.transformLabel)]
  ].filter(([, v]) => v !== null);
  const notes = h.notes.length ? `<ul class="mm-indicator-notes" aria-label="${escHtml(f.notes)}">${h.notes.map((n) => `<li>${escHtml(n)}</li>`).join("")}</ul>` : "";
  return `---
title: Indicator
---

<div role="group" aria-label="${escHtml(h.labels.crumb)}" class="mm-crumb"><ol><li><a href="../">${escHtml(h.labels.home)}</a></li><li><a href="../#indicators">${escHtml(h.labels.indicators)}</a></li><li aria-current="page">${escHtml(h.name)}</li></ol></div>

<h1 data-indicator="${escHtml(h.indicatorId)}">${escHtml(h.name)}</h1>

<dl class="mm-indicator-facts">${facts.map(([k, v]) => `<div><dt>${escHtml(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>

${notes}

\`\`\`js
import * as Plot from "@observablehq/plot";
import {parseManifest} from "../lib/manifest.js";
import {listOf} from "../lib/meta.js";
import {pageHead, attributionBlock} from "../lib/shell.js";
import {indicatorModel} from "../lib/indicator-model.js";
import {indicatorBlock, indicatorOptions} from "../lib/indicator-view.js";
import {CAVEAT, DRAFT_REGIONS as R, ORIENTATION_NOTE} from "../lib/copy.js";
import {busyBlock, loadAll, setBusy} from "../lib/state-blocks.js";
\`\`\`

\`\`\`js
const busy = busyBlock(html, R.loadingData);
display(busy);
\`\`\`

\`\`\`js
// A failed file never throws into the page: loadAll returns one failed region per file (T105).
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("../data/manifest.json").json(), parse: parseManifest},
  {key: "meta", region: R.meta, load: async () => ({series: await FileAttachment("../data/meta/series.json").json(), entities: await FileAttachment("../data/meta/entities.json").json(), indicators: await FileAttachment("../data/meta/indicators.json").json(), domains: await FileAttachment("../data/meta/domains.json").json(), groups: await FileAttachment("../data/meta/groups.json").json()}),
    parse: (m) => ({seriesMeta: listOf(m.series, "series"), entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators"), domains: listOf(m.domains, "domains"), groups: listOf(m.groups, "groups")})},
  {key: "scorecards", region: R.scorecard, load: async () => ({${JSON.stringify(first)}: await FileAttachment("../data/scorecard/${first}.json").json()})}
], (d) => {
  const indicator = d.meta.indicators.find((i) => i.indicator_id === ${JSON.stringify(indicator.indicator_id)});
  if (!indicator) throw new Error("indicator not in meta/indicators.json");
  return {model: indicatorModel({indicator, domains: d.meta.domains, scorecards: d.scorecards, entities: d.meta.entities, series: d.meta.seriesMeta})};
}, R.scorecard);
setBusy(busy, false);
\`\`\`

\`\`\`js
// FileAttachment must be called in the page; it is lazy and only its address is resolved, for the download link.
const seriesFile = ${seriesFile ? `FileAttachment(${JSON.stringify(`../data/${seriesFile.path}`)})` : "null"};
\`\`\`

\`\`\`js
display(pageHead(html, boot, "scorecard"));
if (boot.ok) {
  const model = boot.derived.model;
  // ADR-026 decision 3: caveat first, then the orientation note, and the latter only where a percentile is shown.
  display(html\`<p class="mm-caveat">\${CAVEAT}</p>\${model.showsPercentiles ? html\`<p class="mm-orientation">\${ORIENTATION_NOTE}</p>\` : ""}\`);
  // Address of the download link; resolving it fetches nothing.
  let downloadHref = null;
  try {
    downloadHref = (await seriesFile?.url()) ?? null;
  } catch (e) {
    downloadHref = null;
  }
  display(indicatorBlock(html, Plot, model, {options: indicatorOptions(boot.data.meta.indicators), groups: boot.data.meta.groups, knownCutoff: boot.data.manifest.known_cutoff, downloadHref}));
  display(attributionBlock(html, boot.data.meta.seriesMeta, [${JSON.stringify(indicator.indicator_id)}]));
}
\`\`\`
`;
}

// R18: the home page (PG-HOME). The country and indicator lists are static HTML built from meta/*.json, so they are in the built page
// without JavaScript; the only script cells are the shell (freshness line, stale banner) and the filter enhancement. No heatmap, figure or status block.
const HOME_TITLE = "Country scorecards";
const SHELL_CELLS = (importPath, withFilters) => `<div class="mm-home-shell">

\`\`\`js
import {parseManifest} from "${importPath}manifest.js";
import {pageHead} from "${importPath}shell.js";
import {DRAFT_REGIONS as R} from "${importPath}copy.js";
import {busyBlock, loadAll, setBusy} from "${importPath}state-blocks.js";${withFilters ? `
import {mountFilters} from "${importPath}home-lists.js";` : ""}
\`\`\`

\`\`\`js
const busy = busyBlock(html, R.loadingData);
display(busy);
\`\`\`

\`\`\`js
// A failed file never throws into the page: loadAll returns one failed region per file (T105). The lists below are static.
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("data/manifest.json").json(), parse: parseManifest}
]);
setBusy(busy, false);
display(pageHead(html, boot, "lists"));
\`\`\`

</div>`;

export function homePageSource({entities, indicators, domains}) {
  return `---
title: ${HOME_TITLE}
---

<h1>${escHtml(HOME_TITLE)}</h1>

${SHELL_CELLS("./lib/", true)}

<p class="mm-caveat" id="caveat">${escHtml(CAVEAT)}</p>

${homeListsHtml({entities, indicators, domains})}

\`\`\`js
mountFilters(document);
\`\`\`
`;
}

// R17: the domains page (PG-DOMAINS): static list of the domains with a link to each PG-DOMAIN page.
export function domainsPageSource(domains) {
  return `---
title: ${DOMAINS_TITLE}
---

<h1>${escHtml(DOMAINS_TITLE)}</h1>

${SHELL_CELLS("./lib/", false)}

${domainsListHtml(domains)}
`;
}
