// Pure helpers for the build-check scripts (testable with `node --test`; no network, no deps).
import {createHash} from "node:crypto";
import {readdirSync, readFileSync} from "node:fs";
import {join, posix, relative, sep} from "node:path";
import {gzipSync} from "node:zlib";
import {countryHeader} from "../src/lib/country-model.js";
import {firstDomainId, indicatorHeader} from "../src/lib/indicator-model.js";
import {CAVEAT, DRAFT_BAND_TITLES, DRAFT_BROWSE_SUMMARY, DRAFT_GROUP_BROWSE} from "../src/lib/copy.js";
import {revisionsBandOpen} from "../src/lib/revisions-view.js";
import {DOMAINS_TITLE, domainsListHtml} from "../src/lib/domains-list.js";
import {browseBandHtml} from "../src/lib/home-lists.js";
import {COUNTRY_LIST_TITLE, countryListHtml} from "../src/lib/country-list.js";
import {modeSwitchHtml} from "../src/lib/mode-switch.js";
import {DRAFT_MODE_LABELS} from "../src/lib/copy.js";

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

<div class="mm-filterbar-slot" id="filterbar-slot"></div>

\`\`\`js
import {parseManifest} from "../lib/manifest.js";
import {listOf} from "../lib/meta.js";
import {pageHead, attributionBlock} from "../lib/shell.js";
import {domainView} from "../lib/scorecard.js";
import {domainPage} from "../lib/domain-page.js";
import {createFilterStore} from "../lib/filter-store.js";
import {mountFilterBar} from "../lib/filter-bar.js";
import {periodBounds} from "../lib/filter-model.js";
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
  {key: "meta", region: R.meta, load: async () => ({series: await FileAttachment("../data/meta/series.json").json(), entities: await FileAttachment("../data/meta/entities.json").json(), indicators: await FileAttachment("../data/meta/indicators.json").json(), domains: await FileAttachment("../data/meta/domains.json").json(), groups: await FileAttachment("../data/meta/groups.json").json()}),
    parse: (m) => ({seriesMeta: listOf(m.series, "series"), entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators"), domains: listOf(m.domains, "domains"), groups: listOf(m.groups, "groups")})},
  {key: "scorecard", region: R.scorecard, load: () => FileAttachment("../data/scorecard/${domainId}.json").json()}
], (d) => ({dv: domainView(d.scorecard, {entities: d.meta.entities, indicators: d.meta.indicators, domains: d.meta.domains})}), R.scorecard);
setBusy(busy, false);
\`\`\`

\`\`\`js
display(pageHead(html, boot, "scorecard"));
const barSlot = document.getElementById("filterbar-slot");
if (boot.ok) {
  const md = {...boot.data.meta, manifest: boot.data.manifest};
  // L24: Group (the peer set) and Frequency (the heatmap columns) are the filter bar; the page reads and never writes the address on load.
  const store = createFilterStore({win: window, maxEntities: 5, known: {bounds: periodBounds(md.manifest) ?? undefined,
    indicators: new Set(md.indicators.map((i) => i.indicator_id)), entities: new Set(md.entities.map((e) => e.entity_id)),
    groups: new Set(md.groups.map((g) => g.group_id)), domains: new Set(md.domains.map((d) => d.domain_id))}});
  globalThis.__mmFilterStore = store;
  store.attach();
  barSlot.replaceChildren(mountFilterBar(html, {page: "domain", store, data: md}));
  const dv = boot.derived.dv;
  display(domainPage(html, dv, {store, inputs: {scorecard: boot.data.scorecard, entities: md.entities, groups: md.groups, indicators: md.indicators, domains: md.domains}}));
  display(attributionBlock(html, boot.data.meta.seriesMeta, dv.indicatorIds));
} else barSlot.setAttribute("data-empty", "");
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
import {explorerContext, indicatorGroups, initialSelection, loadSeries, buildModel, selectionHash} from "./lib/explorer.js";
import {selectBox, explorerControls, explorerLayout, explorerBlock} from "./lib/explorer-view.js";
import {chartModeToggle} from "./lib/bar-chart.js";
import {createFilterStore} from "./lib/filter-store.js";
import {mountFilterBar} from "./lib/filter-bar.js";
import {periodBounds} from "./lib/filter-model.js";
import {modelPeriod, pickerGroups, resolveIndicator, rowsOfFrequency, storeWatch, updatePicker, wireRailPeriod} from "./lib/explorer-filters.js";
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
// L21: the one state of the page is the filter store (layout amendment 2.3): #i, #c, #d, #f, #from and #to; #g is ignored and never written.
// The store writes the address (replaceState, user changes only, never on load) and re-reads it on hashchange; \`addr.seen\` follows its writes.
const store = ctx ? createFilterStore({win: {location, history: {get state() { return history.state; }, replaceState: (...a) => { history.replaceState(...a); addr.seen = location.hash; }}, addEventListener: (...a) => addEventListener(...a), removeEventListener: (...a) => removeEventListener(...a)},
  known: {indicators: new Set(ctx.indicators.map((i) => i.indicator_id)), entities: new Set(ctx.entityName.keys()), domains: new Set(boot.data.meta.domains.map((d) => d.domain_id)), bounds: periodBounds(boot.data.manifest) ?? undefined}, ignore: ["g"]}) : null; // amendment 2.3: PG-SERIES ignores g and never writes it
if (store) store.attach();
// Read by the cells below; a cell that mentions one re-runs only when that part changes.
const pFrequency = store ? storeWatch(Generators, store, (s) => s.f) : null;
const pPeriod = store ? storeWatch(Generators, store, modelPeriod) : null;
\`\`\`

\`\`\`js
// #i and #c set the first indicator and countries; unrecognised parts fall back to the default (first indicator of the first domain, no country).
// \`sel\` follows the user's choices (countries are kept when the indicator changes); \`touched\` is set by the first user change.
const initial = ctx ? initialSelection(ctx, pHash) : null;
if (initial) {
  // A hash indicator that Domain or Frequency of the address do not offer falls back to the first offered one (nothing is written); a part the store ignored sets the same note.
  const start = resolveIndicator(ctx, initial.indicator, store.get(), store.get().i !== null); // a default replaced because of Domain/Frequency is not a fallback
  initial.indicator = start.indicator;
  initial.note = initial.note || start.fell || store.get().note;
}
const sel = {entities: initial ? [...initial.entities] : [], touched: false, last: null};
const indicatorBox = ctx ? selectBox(html, {id: "explorer-indicator", label: "Indicator", groups: pickerGroups(ctx, store.get()), value: initial.indicator ?? undefined}) : null;
const pIndicator = ctx ? Generators.input(indicatorBox.querySelector("select")) : null;
// The bar's Domain and Frequency narrow this picker (a chosen indicator stays when still offered, else the first offered); removed when this cell re-runs.
if (ctx) {
  let key = JSON.stringify([store.get().d, store.get().f]);
  const off = store.subscribe((s) => {
    const k = JSON.stringify([s.d, s.f]);
    if (k === key) return;
    key = k;
    updatePicker(html, indicatorBox.querySelector("select"), ctx, s);
  });
  invalidation.then(off);
}
// L20: the Lines / Bars choice lives outside the address (the hash grammar has no chart type) and survives a change of indicator.
const modeBox = chartModeToggle(html, {id: "explorer-chart-mode"});
const pMode = Generators.input(modeBox);
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
// Frequency (the bar) keeps the rows whose stored frequency matches; the series list and the year choices follow.
const rows = rowsOfFrequency(loaded.rows, pFrequency);
const box = ctx ? explorerControls(html, ctx, pIndicator, rows, {indicator: pIndicator, entities: sel.entities, note: fresh && initial.note}) : null;
if (box) {
  // The rail's From / To years show and write the same Period as the bar (one state).
  const detach = wireRailPeriod(box, store, rows);
  invalidation.then(detach);
}
const pEntities = box ? Generators.input(box.entities) : null;
const pTransform = box ? Generators.input(box.transform.querySelector("select")) : null;
// A1.5: the rebase control exists only for an indicator whose stored metadata says scale_hint = index; without it the state is false / "auto".
const pRebase = box?.rebase ? Generators.input(box.rebase.querySelector("input")) : false;
const pBase = box?.base ? Generators.input(box.base.querySelector("select")) : "auto";
const pFree = box ? Generators.input(box.free.querySelector("input")) : null;
\`\`\`

\`\`\`js
display(pageHead(html, boot, "explorer"));
// Shown in its own cell, apart from the controls: the controls cell waits for the series file, the busy block must not.
display(seriesBusy);
\`\`\`

<div class="mm-filterbar-slot" id="filterbar-slot"></div>

\`\`\`js
// L21 (amendment 2.4): Domain, Frequency and Period in the bar. Country and Indicator stay in the rail (C-SER-1); Group is not shown on this page.
const barSlot = document.getElementById("filterbar-slot");
if (ctx) barSlot.replaceChildren(mountFilterBar(html, {page: "series", only: ["domain", "period", "frequency"], store, data: {groups: boot.data.meta.groups, domains: boot.data.meta.domains, indicators: ctx.indicators, entities: boot.data.meta.entities, manifest: boot.data.manifest}}));
else barSlot.setAttribute("data-empty", "");
\`\`\`

\`\`\`js
// Controls (left rail, or a "Selection" disclosure on compact screens) and the chart area sit side by side in one layout.
const layout = box ? explorerLayout(html, {indicator: indicatorBox, box}) : null;
if (layout) display(layout.el);
\`\`\`

\`\`\`js
if (box) {
  const model = buildModel(ctx, pIndicator, rows, {entities: pEntities, transform: pTransform, from: pPeriod.from, to: pPeriod.to, rebase: pRebase, base: pBase});
  const hadFocus = modeBox.contains(document.activeElement);
  layout.main.replaceChildren(explorerBlock(html, Plot, model, loaded.error, {free: pFree, href: fileHref, selected: pEntities.length, toggle: modeBox, mode: pMode}), attributionBlock(html, boot.data.meta.seriesMeta, [pIndicator]));
  if (hadFocus) modeBox.querySelector("input:checked")?.focus(); // the group is moved into the new block; keep the keyboard position
}
\`\`\`

\`\`\`js
// Write the address after a user change of indicator or countries (through the store: replaceState, picker order, other parts kept). Nothing is written on load.
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
    store.set({i: pIndicator, c: box.order.filter((id) => pEntities.includes(id))}); // the store writes the address (other parts kept)
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

${revisionsBandOpen()}

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

</div></div></section>
`;
}

// Page ids of generated country and indicator pages (git-ignored like domain/*.md).
export const PAGE_ID_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,40}$/;

// V8: the mode switch of a page one level below the root (/country/<id>, /indicator/<id>). A page that fixes an entity or an indicator passes it on to Compare.
const countryModeSwitch = (entityId) => ({mode: "country", hrefs: {country: "../country", compare: "../compare"}, set: {compare: {c: entityId}}});
const indicatorModeSwitch = (indicatorId) => ({mode: "compare", hrefs: {country: "../country", compare: "../compare"}, set: {compare: {i: indicatorId}}});

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

<div class="mm-card mm-header-card" id="country-header">
<h1 data-entity="${escHtml(h.entityId)}">${escHtml(h.name)}</h1>
<p class="mm-country-facts">${escHtml(h.labels.kind)}: ${escHtml(h.kind ?? "")}. ${escHtml(h.labels.groups)}: ${groupText}.</p>
</div>

<div class="mm-filterbar-slot" id="filterbar-slot" data-mode="country">${modeSwitchHtml(countryModeSwitch(entity.entity_id))}</div>

\`\`\`js
import * as Plot from "@observablehq/plot";
import {parseManifest} from "../lib/manifest.js";
import {listOf} from "../lib/meta.js";
import {pageHead, attributionBlock} from "../lib/shell.js";
import {countryModel} from "../lib/country-model.js";
import {switcherOptions} from "../lib/country-view.js";
import {countryPicker} from "../lib/picker.js";
import {countryPage} from "../lib/country-page.js";
import {createFilterStore} from "../lib/filter-store.js";
import {mountFilterBar} from "../lib/filter-bar.js";
import {periodBounds} from "../lib/filter-model.js";
import {historySource} from "../lib/history.js";
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
  {key: "meta", region: R.meta, load: async () => ({series: await FileAttachment("../data/meta/series.json").json(), entities: await FileAttachment("../data/meta/entities.json").json(), indicators: await FileAttachment("../data/meta/indicators.json").json(), domains: await FileAttachment("../data/meta/domains.json").json(), groups: await FileAttachment("../data/meta/groups.json").json()}),
    parse: (m) => ({seriesMeta: listOf(m.series, "series"), entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators"), domains: listOf(m.domains, "domains"), groups: listOf(m.groups, "groups")})},
  {key: "scorecards", region: R.scorecard, load: async () => ({${scorecards}})}
], (d) => {
  const entity = d.meta.entities.find((e) => e.entity_id === ${JSON.stringify(entity.entity_id)});
  if (!entity) throw new Error("entity not in meta/entities.json");
  // V16: entities, the cut-off and the stored period bounds feed L1, L2 and P1a (the strip reads every entity of the scorecard).
  const inputs = {entity, entities: d.meta.entities, domains: d.meta.domains, scorecards: d.scorecards, indicators: d.meta.indicators, series: d.meta.seriesMeta, groups: d.meta.groups, knownCutoff: d.manifest.known_cutoff ?? null, bounds: periodBounds(d.manifest)};
  return {options: switcherOptions(d.meta.entities.filter((e) => e.is_global !== true)), inputs, model: countryModel(inputs)};
}, R.scorecard);
setBusy(busy, false);
\`\`\`

\`\`\`js
// FileAttachment must be called in the page (not in an imported module); each one is lazy and nothing is fetched until "Show history".
const seriesFiles = {${attachments}};
\`\`\`

\`\`\`js
display(pageHead(html, boot, "scorecard"));
const barSlot = document.getElementById("filterbar-slot");
let store = null;
if (boot.ok) {
  const md = {...boot.data.meta, manifest: boot.data.manifest};
  // L22: Domain, Period and Frequency are the filter bar; the Country switcher (explicit Go) leads it. The page reads and never writes the hash on load.
  store = createFilterStore({win: window, maxEntities: 5, known: {bounds: periodBounds(md.manifest) ?? undefined,
    indicators: new Set(md.indicators.map((i) => i.indicator_id)), entities: new Set(md.entities.map((e) => e.entity_id)),
    groups: new Set(md.groups.map((g) => g.group_id)), domains: new Set(md.domains.map((d) => d.domain_id))}});
  store.attach();
  barSlot.replaceChildren(mountFilterBar(html, {page: "country", store, data: md, mode: ${JSON.stringify(countryModeSwitch(entity.entity_id))}, leading: countryPicker(html, {entities: md.entities.filter((e) => e.is_global !== true), groups: md.groups, currentId: ${JSON.stringify(entity.entity_id)}, store, hrefFor: (id) => \`../country/\${id}\`})}));
} else barSlot.setAttribute("data-empty", "");
\`\`\`

\`\`\`js
if (boot.ok) {
  const model = boot.derived.model;
  // ADR-026 decision 3 / ADR-037 decision 3: the caveat and the orientation sentence belong to the percentile layer; countryPage prints them only while pc is on.
  display(countryPage(html, Plot, model, boot.derived.options, historySource(boot.data.manifest, seriesFiles), {store, inputs: boot.derived.inputs}));
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

<div class="mm-card mm-card--header mm-card--span-12" id="indicator-header">
<h1 data-indicator="${escHtml(h.indicatorId)}">${escHtml(h.name)}</h1>
<dl class="mm-indicator-facts">${facts.map(([k, v]) => `<div><dt>${escHtml(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>${notes ? `\n${notes}` : ""}
</div>

<div class="mm-filterbar-slot" id="filterbar-slot" data-mode="compare">${modeSwitchHtml(indicatorModeSwitch(indicator.indicator_id))}</div>

${compareCells({rel: "../", fixedId: indicator.indicator_id, domainIds: domains.map((d) => d.domain_id), manifest, seriesFile})}`;
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

// L6/L7: the filter store and bar (a script cell; nothing in the static HTML). The store is created once and seeded from the hash; a cell that
// mentions `filters` re-runs on every change (Generators.observe, see filter-store.js). `globalThis.__mmFilterStore` is a test hook for the smoke suite.
const FILTER_BAR_CELLS = `\`\`\`js
import {listOf} from "./lib/meta.js";
import {createFilterStore, filterGenerator} from "./lib/filter-store.js";
import {mountFilterBar} from "./lib/filter-bar.js";
import {periodBounds} from "./lib/filter-model.js";
import {createScorecardLoader, mountHomeDashboard, mountHomeFailure} from "./lib/home-dashboard.js";
import {mountKpi} from "./lib/kpi-view.js";
import {mountTableCard} from "./lib/table-card.js";
\`\`\`

\`\`\`js
const meta = await loadAll([
  {key: "meta", region: R.meta, load: async () => ({entities: await FileAttachment("data/meta/entities.json").json(), indicators: await FileAttachment("data/meta/indicators.json").json(), domains: await FileAttachment("data/meta/domains.json").json(), groups: await FileAttachment("data/meta/groups.json").json(), series: await FileAttachment("data/meta/series.json").json()}),
    parse: (m) => ({entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators"), domains: listOf(m.domains, "domains"), groups: listOf(m.groups, "groups"), series: listOf(m.series, "series"), domainsDoc: m.domains})}
]);
// L15: any failed meta file (the manifest included) means no data card is built; each card shows the alert instead (amendment 5).
// The manifest is the one boot already loaded; meta/series.json is loaded once here and reused by the rank card.
const md = boot.ok && meta.ok ? {...meta.data.meta, manifest: boot.data.manifest} : null;
\`\`\`

\`\`\`js
const store = createFilterStore({win: window, maxEntities: 5, known: md ? {
  bounds: periodBounds(md.manifest) ?? undefined,
  indicators: new Set(md.indicators.map((i) => i.indicator_id)), entities: new Set(md.entities.map((e) => e.entity_id)),
  groups: new Set(md.groups.map((g) => g.group_id)), domains: new Set(md.domains.map((d) => d.domain_id))} : {}});
globalThis.__mmFilterStore = store;
const barSlot = document.getElementById("filterbar-slot");
if (md) barSlot.replaceChildren(mountFilterBar(html, {page: "home", store, data: md}));
else barSlot.setAttribute("data-empty", "");
\`\`\``;

// L11: one literal FileAttachment per domain (the Framework needs literal paths); only the selected domain's file is requested.
const SCORECARD_LOADERS = (domains) => `{${domains.map((d) => {
  if (!DOMAIN_ID_RE.test(d.domain_id)) throw new Error(`unsafe domain_id: ${JSON.stringify(d.domain_id)}`);
  return `${JSON.stringify(d.domain_id)}: () => FileAttachment("data/scorecard/${d.domain_id}.json").json()`;
}).join(", ")}}`;

// L18: one literal FileAttachment per series file of the manifest (the Framework needs literal paths); lazy, so none is requested on load.
const seriesAttachments = (manifest) => seriesPaths(manifest).map((s) => `${JSON.stringify(s.id)}: FileAttachment(${JSON.stringify(`data/${s.path}`)})`).join(", ");

export function homePageSource({entities, indicators, domains, manifest = {files: []}}) {
  return `---
title: ${HOME_TITLE}
---

<h1>${escHtml(HOME_TITLE)}</h1>

${SHELL_CELLS("./lib/", true)}

<p class="mm-caveat" id="caveat">${escHtml(CAVEAT)}</p>

<div class="mm-filterbar-slot" id="filterbar-slot"></div>

${FILTER_BAR_CELLS}

<div id="dashboard-slot"></div>

\`\`\`js
// L11: band skeleton with empty card slots (slot API in lib/home-dashboard.js). Only the default domain's scorecard loads now; a Domain
// change loads that domain's scorecard once (cached, a failed load is not cached).
const dash = md ? mountHomeDashboard(html, {store, data: md, declaredDomain: md.domainsDoc?.default_domain ?? null,
  loadScorecard: createScorecardLoader(${SCORECARD_LOADERS(domains)})}) : null;
if (dash) document.getElementById("dashboard-slot").replaceChildren(dash.root);
if (!md) document.getElementById("dashboard-slot").replaceChildren(mountHomeFailure(html, {failures: [...boot.failures, ...meta.failures]}));
globalThis.__mmDashboard = dash;
if (dash) mountKpi(html, dash, {data: md}); // L14: Overview band
\`\`\`

\`\`\`js
import * as Plot from "@observablehq/plot";
import {mountRankCard} from "./lib/rank-view.js";
import {mountHeatmapCard} from "./lib/heatmap-card.js";
\`\`\`

\`\`\`js
// L12: the ranked comparison card and the facts card. meta/series.json (reference-period labels, "no series" wording) comes from the meta load above.
if (dash) mountRankCard(html, Plot, dash, {data: md, series: md ? md.series : null});
\`\`\`

\`\`\`js
if (dash) mountHeatmapCard(html, dash, {data: md}); // L13: Domain band
\`\`\`

\`\`\`js
if (dash) mountTableCard(html, dash, {data: md}); // L17: Indicators band (one Country in focus)
\`\`\`

\`\`\`js
import {mountSeriesCard} from "./lib/series-card.js";
\`\`\`

\`\`\`js
// L18: Over time band. One literal FileAttachment per series file; each is lazy and nothing is requested until the "Load history" button.
const seriesFiles = {${seriesAttachments(manifest)}};
if (dash) mountSeriesCard(html, Plot, dash, {data: md, files: seriesFiles});
\`\`\`

${browseBandHtml({entities, indicators, domains})}

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

// V64 (A1.7): the country list page `/country` (src/country.md, git-ignored, regenerated every run; a file next to the country/ folder, so its URL
// has no trailing slash and the page-relative links of the other root pages work unchanged). The mode switch and the list of every entity are static HTML
// (no JavaScript needed); the native picker (V9) is added into #picker-slot when meta/entities.json and meta/groups.json have loaded.
const ROOT_MODE_HREFS = {country: "./country", compare: "./compare"};
export function countryListPageSource(entities) {
  return `---
title: ${COUNTRY_LIST_TITLE}
---

<h1>${escHtml(COUNTRY_LIST_TITLE)}</h1>

<div class="mm-filterbar-slot" id="filterbar-slot" data-mode="country">${modeSwitchHtml({mode: "country", hrefs: ROOT_MODE_HREFS})}</div>

\`\`\`js
import {parseManifest} from "./lib/manifest.js";
import {listOf} from "./lib/meta.js";
import {pageHead} from "./lib/shell.js";
import {countryPicker} from "./lib/picker.js";
import {createFilterStore} from "./lib/filter-store.js";
import {DRAFT_REGIONS as R} from "./lib/copy.js";
import {busyBlock, loadAll, setBusy} from "./lib/state-blocks.js";
\`\`\`

\`\`\`js
const busy = busyBlock(html, R.loadingData);
display(busy);
\`\`\`

\`\`\`js
// A failed file never throws into the page: loadAll returns one failed region per file (T105). The picker reads meta/entities.json and meta/groups.json only (AC-V2-62); the list below is static.
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("data/manifest.json").json(), parse: parseManifest},
  {key: "meta", region: R.meta, load: async () => ({entities: await FileAttachment("data/meta/entities.json").json(), groups: await FileAttachment("data/meta/groups.json").json()}),
    parse: (m) => ({entities: listOf(m.entities, "entities"), groups: listOf(m.groups, "groups")})}
]);
setBusy(busy, false);
display(pageHead(html, boot, "lists"));
\`\`\`

<div class="mm-picker-slot" id="picker-slot"></div>

\`\`\`js
if (boot.ok) {
  const {entities, groups} = boot.data.meta;
  const store = createFilterStore({win: window, maxEntities: 5, known: {entities: new Set(entities.map((e) => e.entity_id)), groups: new Set(groups.map((g) => g.group_id))}});
  globalThis.__mmFilterStore = store;
  document.getElementById("picker-slot").replaceChildren(countryPicker(html, {entities, groups, store, hrefFor: (id) => \`./country/\${id}\`}));
}
\`\`\`

${countryListHtml(entities)}
`;
}

// V23: the script cells shared by PG-COMPARE (`/compare`) and PG-INDICATOR (`/indicator/<id>`). `rel` is the path from the page to the site root ("./" or "../"), `fixedId` the
// indicator a PG-INDICATOR page fixes (null on /compare). FileAttachment paths must be literal: one scorecard per domain and one lazy attachment per series file of the manifest
// (a FileAttachment is lazy: nothing is fetched until comparePage asks for it, after the page has loaded).
function compareCells({rel, fixedId, domainIds, manifest, seriesFile = null}) {
  for (const d of domainIds) if (!DOMAIN_ID_RE.test(d)) throw new Error(`unsafe domain_id: ${JSON.stringify(d)}`);
  const scorecards = domainIds.map((d) => `${JSON.stringify(d)}: await FileAttachment("${rel}data/scorecard/${d}.json").json()`).join(", ");
  const attachments = manifest ? seriesPaths(manifest).map((p) => `${JSON.stringify(p.id)}: FileAttachment(${JSON.stringify(`${rel}data/${p.path}`)})`).join(", ") : "";
  const links = fixedId === null ? `{country: (id) => \`./country/\${id}\`, revisions: "./revisions"}` : `{country: (id) => \`../country/\${id}\`, revisions: "../revisions"}`;
  return `\`\`\`js
import * as Plot from "@observablehq/plot";
import {parseManifest} from "${rel}lib/manifest.js";
import {listOf} from "${rel}lib/meta.js";
import {pageHead, attributionBlock} from "${rel}lib/shell.js";
import {comparePage} from "${rel}lib/compare-page.js";
import {createFilterStore} from "${rel}lib/filter-store.js";
import {periodBounds} from "${rel}lib/filter-model.js";
import {historySource} from "${rel}lib/history.js";
import {DRAFT_REGIONS as R} from "${rel}lib/copy.js";
import {busyBlock, loadAll, setBusy} from "${rel}lib/state-blocks.js";
\`\`\`

\`\`\`js
const busy = busyBlock(html, R.loadingData);
display(busy);
\`\`\`

\`\`\`js
// A failed file never throws into the page: loadAll returns one failed region per file (T105).
const boot = await loadAll([
  {key: "manifest", region: R.manifest, load: () => FileAttachment("${rel}data/manifest.json").json(), parse: parseManifest},
  {key: "meta", region: R.meta, load: async () => ({series: await FileAttachment("${rel}data/meta/series.json").json(), entities: await FileAttachment("${rel}data/meta/entities.json").json(), indicators: await FileAttachment("${rel}data/meta/indicators.json").json(), domains: await FileAttachment("${rel}data/meta/domains.json").json(), groups: await FileAttachment("${rel}data/meta/groups.json").json()}),
    parse: (m) => ({seriesMeta: listOf(m.series, "series"), entities: listOf(m.entities, "entities"), indicators: listOf(m.indicators, "indicators"), domains: listOf(m.domains, "domains"), groups: listOf(m.groups, "groups")})},
  {key: "scorecards", region: R.scorecard, load: async () => ({${scorecards}})}
]);
setBusy(busy, false);
\`\`\`

\`\`\`js
// FileAttachment must be called in the page (not in an imported module); each one is lazy.
const seriesFiles = {${attachments}};
// Lazy: only the address of the download link is resolved (nothing is fetched).
const seriesFile = ${seriesFile ? `FileAttachment(${JSON.stringify(`${rel}data/${seriesFile.path}`)})` : "null"};
// V54: the map geometry and its join table are static site files, read lazily by C6 only (nothing is fetched here), so only a page that renders C6 carries them.
const geoFiles = {asset: FileAttachment("${rel}geo/europe-countries.geojson"), join: FileAttachment("${rel}geo/entity_geo_join.json")};
\`\`\`

\`\`\`js
display(pageHead(html, boot, "scorecard"));
if (boot.ok) {
  const md = boot.data.meta;
  let downloadHref = null;
  try {
    downloadHref = (await seriesFile?.url()) ?? null;
  } catch (e) {
    downloadHref = null;
  }
  const store = createFilterStore({win: window, maxEntities: 5, known: {bounds: periodBounds(boot.data.manifest) ?? undefined,
    indicators: new Set(md.indicators.map((i) => i.indicator_id)), entities: new Set(md.entities.map((e) => e.entity_id)),
    groups: new Set(md.groups.map((g) => g.group_id)), domains: new Set(md.domains.map((d) => d.domain_id))}});
  globalThis.__mmFilterStore = store;
  store.attach();
  const inputs = {entities: md.entities.filter((e) => e.is_global !== true), groups: md.groups, domains: md.domains, indicators: md.indicators, series: md.seriesMeta, scorecards: boot.data.scorecards, knownCutoff: boot.data.manifest.known_cutoff ?? null, bounds: periodBounds(boot.data.manifest), manifest: boot.data.manifest};
  display(comparePage(html, Plot, inputs, historySource(boot.data.manifest, seriesFiles), {store, fixedIndicator: ${fixedId === null ? "null" : JSON.stringify(fixedId)}, links: ${links}, downloadHref, geo: geoFiles}));
  display(attributionBlock(html, md.seriesMeta${fixedId === null ? "" : `, [${JSON.stringify(fixedId)}]`}));
}
\`\`\`
`;
}

// V8, V23: PG-COMPARE (`/compare`, src/compare.md, git-ignored, regenerated every run). The route is the mode (A1.3): no `m` key. Heading, the static mode switch in the filter-bar
// slot (the Compare controls sit in each chart card), then the charts of compare-page.js. Without `manifest` no series file is attached (every card then says it cannot read it).
export function comparePageSource(manifest = null, domainIds = []) {
  const label = DRAFT_MODE_LABELS.compare;
  return `---
title: ${label}
---

<h1>${escHtml(label)}</h1>

<div class="mm-filterbar-slot" id="filterbar-slot" data-mode="compare">${modeSwitchHtml({mode: "compare", hrefs: ROOT_MODE_HREFS})}</div>

${compareCells({rel: "./", fixedId: null, domainIds, manifest})}`;
}

// ---- measure-pages helpers (R23, AC-RD-53) -----------------------------------------------------------------------------
export const PAGE_TARGET_BYTES = 600_000; // internal target per page type, gzipped
export const PAGE_LIMIT_BYTES = 1_500_000; // ADR-023 decision 6, hard limit
export const HISTORY_TARGET_BYTES = 5_000_000; // one history or series interaction, gzipped
export const CSS_TARGET_BYTES = 20_000;
export const CLS_TARGET = 0.1;

const READER_PATH_RE = /^\/_npm\/(apache-arrow|parquet-wasm|flatbuffers|tslib)@|^\/_file\/data\/series\//;
export const isReaderPath = (pathname) => READER_PATH_RE.test(pathname);

// responses: [{url, body: Buffer, status?}]. Counts each URL once. Kind comes from the path: html, css, js (incl. wasm), data
// (/_file/data/), other. gzip is computed locally (level 9, as measure-landing does), not read from the wire.
export function firstLoadSizes(responses) {
  const seen = new Set();
  const out = {files: 0, raw: 0, gzip: 0, css: 0, reader: 0, own: 0, byKind: {html: 0, css: 0, js: 0, data: 0, other: 0}};
  for (const r of responses) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    const {pathname} = new URL(r.url);
    const kind = pathname.startsWith("/_file/data/") ? "data" : /\.css$/.test(pathname) ? "css" : /\.(m?js|wasm)$/.test(pathname) ? "js" : /(\.html$|\/$|^\/[^.]*$)/.test(pathname) ? "html" : "other";
    const gz = gzipBytes(r.body);
    out.files += 1;
    out.raw += r.body.length;
    out.gzip += gz;
    out.byKind[kind] += gz;
    // AC-RD-53 (amended 2026-11-09): the Parquet reader (parquet-wasm, Arrow and their deps) and a series file are one interaction.
    if (isReaderPath(pathname)) out.reader += gz;
    else out.own += gz;
    if (kind === "css") out.css += gz;
  }
  return out;
}

// measured: {pages: {<name>: {gzip, css, cls, own?, reader?}}, history: {gzip}|null, buildSeconds, distBytes}. Returns rows
// {id, label, value, limit, unit, status: PASS|FAIL|N/A, hard}. hard rows are the only ones that make the script exit non-zero.
export function evaluateTargets(measured) {
  const rows = [];
  const row = (id, label, value, limit, unit, hard = false) => {
    const status = value === null || value === undefined ? "N/A" : value <= limit ? "PASS" : "FAIL";
    rows.push({id, label, value: value ?? null, limit, unit, status, hard});
  };
  for (const [name, p] of Object.entries(measured.pages)) {
    if (/explorer/.test(name)) {
      // PG-SERIES: page-own files vs the reader plus series file (one series interaction, 5 MB).
      const own = p.own ?? p.gzip;
      row(`first-load:${name}`, `${name} page-own files (target)`, own, PAGE_TARGET_BYTES, "B gz");
      row(`limit:${name}`, `${name} page-own files (hard limit)`, own, PAGE_LIMIT_BYTES, "B gz", true);
      row(`reader:${name}`, `${name} reader plus series file`, p.reader ?? 0, HISTORY_TARGET_BYTES, "B gz", true);
    } else {
      row(`first-load:${name}`, `${name} first load (target)`, p.gzip, PAGE_TARGET_BYTES, "B gz");
      row(`limit:${name}`, `${name} first load (hard limit)`, p.gzip, PAGE_LIMIT_BYTES, "B gz", true);
    }
    row(`css:${name}`, `${name} CSS`, p.css, CSS_TARGET_BYTES, "B gz");
    row(`cls:${name}`, `${name} CLS`, p.cls ?? null, CLS_TARGET, "");
  }
  row("history", "one history interaction (country page)", measured.history ? measured.history.gzip : null, HISTORY_TARGET_BYTES, "B gz");
  // V27 / AC-V2-40: the heaviest first interaction per mode page (Country, Compare), gzipped; null when the page offers none (N/A, never a PASS).
  for (const [name, i] of Object.entries(measured.interactions ?? {})) row(`interaction:${name}`, `heaviest interaction (${name} page)`, i ? i.gzip : null, HISTORY_TARGET_BYTES, "B gz", true);
  return rows;
}

export const hardBreach = (rows) => rows.some((r) => r.hard && r.status === "FAIL");

export function formatReport(rows, meta = {}) {
  const lines = [];
  if (meta.buildId) lines.push(`build_id: ${meta.buildId}`);
  if (meta.buildSeconds !== undefined && meta.buildSeconds !== null) lines.push(`build time: ${Number(meta.buildSeconds).toFixed(1)} s`);
  if (meta.distBytes !== undefined) lines.push(`dist size: ${meta.distBytes} B raw`);
  for (const r of rows) {
    const v = r.value === null ? "n/a" : r.unit ? `${r.value} ${r.unit}` : String(Number(r.value.toFixed(4)));
    const l = r.unit ? `${r.limit} ${r.unit}` : String(r.limit);
    lines.push(`${r.status.padEnd(4)} ${r.label}: ${v} (limit ${l})${r.hard ? " [hard]" : ""}`);
  }
  return lines.join("\n");
}
