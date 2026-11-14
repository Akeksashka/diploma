// R5 (AC-RD-62, static part): data-only prose scan. Spec 1.6 (user instruction 2026-11-06): pages carry data, not explanation.
// The closed allow-list below is the list of spec section 1.6 and nothing else; each entry is a copy.js export of at most 160
// characters, except where the spec itself names a longer fixed text (see SPEC_LONG). Any other multi-sentence or over-length
// string in the scanned scope fails. Scope: the redesign section of copy.js (from the "Redesign R" marker on) and the string
// literals of the redesign modules. The legacy copy.js strings that belong to the withdrawn Guide/Status pages and old
// explanatory blocks are outside this scope until the tasks that remove them (plan R-series); they are not endorsed.
// Seeded negatives prove each rule fails.
import test from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import * as copy from "../src/lib/copy.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const MAX = 160;

// Spec 1.6: the closed list of fixed sentences allowed on data pages beyond names, labels and per-value markers.
// Names that do not exist in copy.js yet are listed in PENDING (added by R-tasks) and are checked once they exist.
const ALLOW = {
  caveat: "CAVEAT", // one standing-caveat line
  orientation: "ORIENTATION_NOTE", // one orientation-note line, pages that show percentiles
  filterNote: "FILTER_NOTE", // C-IND-1
  vintageText: "VINTAGE_TEXT", // PG-REVISIONS
  smallMultiples: "DRAFT_FACET_STATEMENT", // C-SER-2 small-multiples reason
  pointReader: "POINT_READER_LEGEND" // amendment 3.1 (R16): the "Read a value" control label
};
// Spec 1.6 entries with no copy.js export yet: the C-IND-2 reference-period line, "Choose up to 5 countries to compare.",
// and the stale-banner wording. They are allowed by name once added; any other new name is not.
// Layout amendment section 6 (L3): control labels and options, chip summary pattern, print filters line, placeholder, empty-card and
// sparkline sentences, "Reference rows", "Browse", the hidden-row sentence, the home h1 and the four band titles.
const LAYOUT_SECTION6 = ["DRAFT_FILTER_LABELS", "DRAFT_FILTER_ALL", "DRAFT_FREQUENCY_NAMES", "DRAFT_PERIOD_PRESETS", "DRAFT_BAND_TITLES", "DRAFT_GROUP_BROWSE", "DRAFT_GROUP_REFERENCE_ROWS", "DRAFT_LOAD_HISTORY", "DRAFT_SHOW_MORE", "DRAFT_CHART_MODES", "DRAFT_CHOOSE_COUNTRY_PLACEHOLDER", "DRAFT_EMPTY_CARD", "DRAFT_SPARKLINE_TOO_FEW", "DRAFT_HOME_H1", "DRAFT_FILTER_CHIP_SUMMARY", "DRAFT_PERIOD_VALUE", "DRAFT_PRINT_FILTERS", "DRAFT_HIDDEN_ROWS", "DRAFT_HIDDEN_ROW_ITEM", "DRAFT_RANK_SORT_LABELS", "DRAFT_RANK_COLUMNS", "DRAFT_COUNTRY_LIMIT", "DRAFT_COUNTRY_SELECTED", "DRAFT_COUNTRY_CHIP_HELP", "DRAFT_PERIOD_INVALID", "DRAFT_PERIOD_UNAVAILABLE_CONSEQUENCE", "DRAFT_PERIOD_REGION"];
const PENDING = ["DRAFT_CHOOSE_COUNTRIES_HINT", "STALE_BANNER", "STALE_BANNER_UNREADABLE", ...LAYOUT_SECTION6];
// Per-value missing-data sentences (spec 5.1): one short sentence each, selected by stored fields.
const MISSING_SENTENCES = ["DRAFT_NOT_PUBLISHED_SENTENCE", "DRAFT_NA_DEFINED_SENTENCE", "G_STR1_NO_SERIES", "DRAFT_NA_NO_RANKED_SENTENCE"];
// The spec's own longer fixed texts (VINTAGE_TEXT is 300+ characters in the confirmed wording; see report).
const SPEC_LONG = new Set(["VINTAGE_TEXT"]);

const sentences = (s) => s.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean).length;

// Findings for a map {exportName: string}: over-length or multi-sentence strings not in the allow-list.
export function proseFindings(entries, allowed) {
  const out = [];
  for (const [name, text] of Object.entries(entries)) {
    if (typeof text !== "string") continue;
    const ok = allowed.has(name);
    if (!ok && (text.length > MAX || sentences(text) > 1)) out.push(`${name}: unlisted prose (${text.length} chars, ${sentences(text)} sentences)`);
    if (ok && !SPEC_LONG.has(name) && text.length > MAX) out.push(`${name}: allow-listed string over ${MAX} characters`);
  }
  return out;
}

// copy.js exports from the redesign marker on (source order), as {name: value}.
function redesignExports() {
  const text = readFileSync(join(src, "lib", "copy.js"), "utf8");
  const i = text.indexOf("// --- Redesign R");
  assert.ok(i >= 0, "redesign marker not found in copy.js");
  const names = [...text.slice(i).matchAll(/^export const (\w+)\s*=/gm)].map((m) => m[1]);
  return Object.fromEntries(names.map((n) => [n, copy[n]]));
}

// String literals (single or double quoted, and static template text) of a module, comments removed.
function literals(code) {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...noComments.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}
const literalFindings = (name, code) => literals(code).flatMap((l) => (l.length > MAX || sentences(l) > 1 ? [`${name}: "${l.slice(0, 40)}..." (${l.length} chars, ${sentences(l)} sentences)`] : []));

const allowedNames = new Set([...Object.values(ALLOW), ...PENDING, ...MISSING_SENTENCES]);

test("AC-RD-62: the allow-list entries that exist in copy.js are strings of at most 160 characters (VINTAGE_TEXT is the spec's own longer text)", () => {
  for (const name of Object.values(ALLOW)) assert.equal(typeof copy[name], "string", `${name} is not a copy.js string`);
  assert.deepEqual(proseFindings(Object.fromEntries([...Object.values(ALLOW), ...PENDING, ...MISSING_SENTENCES].filter((n) => n in copy).map((n) => [n, copy[n]])), allowedNames), []);
  assert.ok(copy.VINTAGE_TEXT.length > MAX, "VINTAGE_TEXT is longer than 160: report the spec conflict, do not shorten it");
});

test("AC-RD-62: the redesign section of copy.js has no unlisted prose", () => {
  const entries = redesignExports();
  assert.ok(Object.keys(entries).length >= 4);
  assert.deepEqual(proseFindings(entries, allowedNames), []);
});

test("V6 (AC-RD-62): the v2 strings, including the template outputs, are single short sentences or labels", () => {
  const flat = {
    ...Object.fromEntries(["DRAFT_NOT_STATED", "DRAFT_NO_ALIGNED", "DRAFT_MARKED_SEASONAL", "DRAFT_MODE_SWITCH_LABEL", "DRAFT_SHOW_PERCENTILE", "DRAFT_SHOW_STALE", "DRAFT_INCLUDE_OTHER_PERIODS", "DRAFT_CONTEXT_LINES", "DRAFT_STALE_CODE"].map((n) => [n, copy[n]])),
    ...Object.fromEntries(["DRAFT_CAPTION_LABELS", "DRAFT_CAPTION_SEASONAL", "DRAFT_CAPTION_LEGEND", "DRAFT_HIDDEN_REASON_LABELS", "DRAFT_BLOCKED_FIELD_LABELS", "DRAFT_MODE_LABELS", "DRAFT_PICKER_LABELS"].flatMap((n) => Object.entries(copy[n]).map(([k, v]) => [`${n}.${k}`, v]))),
    HIDDEN_SUMMARY: copy.DRAFT_HIDDEN_SUMMARY({total: 8, no_data: 4, stale: 2, other_period: 1, other: 1}),
    HIDDEN_ITEM: copy.DRAFT_HIDDEN_LIST_ITEM("Germany", "Stale", "2023", "stale: no rank"),
    BLOCKED: copy.DRAFT_BLOCKED_MESSAGE(["unit code", "price basis", "base period"]),
    REBASE: copy.DRAFT_REBASE_STATEMENT("2015"),
    VINTAGE: copy.DRAFT_CAPTION_VINTAGE("2026-11-03")
  };
  assert.ok(Object.keys(flat).length > 30);
  assert.deepEqual(proseFindings(flat, new Set()), []);
});

test("AC-RD-62: the redesign modules carry no prose strings (data and labels only)", () => {
  const hits = ["hash", "period", "units", "sort", "missing", "profile-chart", "value-chart"].flatMap((n) => literalFindings(`lib/${n}.js`, readFileSync(join(src, "lib", `${n}.js`), "utf8")));
  assert.deepEqual(hits, []);
});

test("AC-RD-62: seeded unlisted prose fails (long string, two sentences, and an unlisted name)", () => {
  const long = "A".repeat(MAX + 1);
  assert.equal(proseFindings({DRAFT_EXTRA_ABOUT: long}, allowedNames).length, 1);
  assert.equal(proseFindings({DRAFT_EXTRA_ABOUT: "This explains the chart. It also explains the page."}, allowedNames).length, 1);
  assert.equal(proseFindings({DRAFT_EXTRA_ABOUT: "Short label"}, allowedNames).length, 0);
  assert.equal(proseFindings({CAVEAT: long}, allowedNames).length, 1, "an allow-listed string over 160 characters fails");
  assert.equal(proseFindings({VINTAGE_TEXT: long}, allowedNames).length, 0, "the spec's own longer text is the only exception");
  assert.equal(literalFindings("lib/units.js", `export const note = "Rank is shown. It is computed elsewhere.";`).length, 1);
  assert.equal(literalFindings("lib/sort.js", `export const x = "${long}";`).length, 1);
  assert.equal(literalFindings("lib/sort.js", `export const x = "values in " + u; // One. Two sentences in a comment`).length, 0);
});

// L26 (AC-DB-32): the layout modules L1-L24 carry data and labels only. Every string literal of each module is checked with the
// same length and sentence rules; a module on the exception list below carries a documented, reported finding. The list of
// modules is explicit (so a rename fails) and the directory walk below catches any other module added later.
const LAYOUT_MODULES = ["compare-page", "blocked", "compare-controls", "compare-data", "hatch", "multi-line", "home-constants", "home-config", "bar-list", "choropleth", "choropleth-model", "scatter", "time-heatmap", "bar-chart", "caption", "caption-view", "carry", "compat", "country-page", "domain-page", "explorer-filters", "facts-card", "filter-bar-options", "filter-bar", "filter-chip", "filter-country", "filter-model", "filter-period", "filter-proof", "filter-store", "heatmap-card", "hidden-rows", "home-dashboard", "kpi-model", "kpi-view", "l1-card", "mode-switch", "peer-strip", "picker", "country-list", "rank-model", "rank-view", "series-card", "series-chart", "small-multiples", "table-card"];
const allLibModules = () => readdirSync(join(src, "lib")).filter((n) => n.endsWith(".js") && n !== "copy.js").map((n) => n.slice(0, -3));
// Modules whose literals are not yet clean (none expected). Each is a reported finding with file and reason, never silent.
const PROSE_EXCEPTIONS = {};
// Markup literals (html`...`) are judged by their visible text: `${...}` expressions and tags are removed, the rest is the prose
// a reader could see (attribute values are not text). Plain literals are judged whole, as in literalFindings.
const stripExpressions = (t) => { let out = ""; let depth = 0; for (let i = 0; i < t.length; i += 1) { if (depth === 0 && t[i] === "$" && t[i + 1] === "{") { depth = 1; i += 1; } else if (depth > 0) { if (t[i] === "{") depth += 1; else if (t[i] === "}") depth -= 1; } else out += t[i]; } return out; };
const visibleText = (l) => stripExpressions(l).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const layoutLiteralFindings = (name, code) => literals(code).flatMap((l) => {
  const t = /</.test(l) ? visibleText(l) : l;
  return t.length > MAX || sentences(t) > 1 ? [`${name}: "${t.slice(0, 40)}..." (${t.length} chars, ${sentences(t)} sentences)`] : [];
});

test("AC-DB-32 (L26): every layout module exists, and its string literals are labels or single short sentences", () => {
  const onDisk = allLibModules();
  for (const m of LAYOUT_MODULES) assert.ok(onDisk.includes(m), `${m} is missing (the scan would pass vacuously)`);
  const hits = LAYOUT_MODULES.flatMap((n) => (n in PROSE_EXCEPTIONS ? [] : layoutLiteralFindings(`lib/${n}.js`, readFileSync(join(src, "lib", `${n}.js`), "utf8"))));
  assert.deepEqual(hits, []);
});

test("AC-DB-32 (L26): the directory walk finds no module that is neither on the layout list nor an older module checked elsewhere", () => {
  const older = new Set(readdirSync(join(src, "lib")).filter((n) => n.endsWith(".js")).map((n) => n.slice(0, -3)).filter((n) => !LAYOUT_MODULES.includes(n)));
  // Modules outside the L26 list are the R/T-series ones; any module added after L26 must be appended to LAYOUT_MODULES, so the
  // older set is pinned by name: a new unlisted module fails here instead of passing unscanned.
  const PINNED_OLDER = ["about-value", "attribution", "bins", "copy", "country-model", "country-view", "domains-list", "explorer-view", "explorer", "figure", "glyphs", "hash", "heatmap-view", "heatmap", "history", "home-lists", "indicator-model", "indicator-view", "legend", "manifest", "meta", "missing", "peers-view", "peers", "period", "point-reader", "profile-chart", "rebase", "revisions-view", "revisions", "scorecard-view", "scorecard", "series-meta", "shell", "sort", "stale", "state-blocks", "states", "tip", "tokens", "units", "value-chart"];
  assert.deepEqual([...older].filter((n) => !PINNED_OLDER.includes(n)), [], "an unlisted new module: add it to LAYOUT_MODULES so its literals are scanned");
  assert.deepEqual(PINNED_OLDER.filter((n) => !older.has(n)), [], "a pinned older module no longer exists");
});

test("AC-DB-32 (L26): the section 6 allow-list is closed: every listed name exists, is a string, function or frozen map, and no unlisted layout export is long prose", () => {
  for (const n of LAYOUT_SECTION6) assert.ok(n in copy, `${n} is not exported by copy.js`);
  const layoutExports = Object.fromEntries(Object.entries(copy).filter(([k]) => LAYOUT_SECTION6.includes(k) || /^DRAFT_(BROWSE_SUMMARY|BAND_TABLE|BAND_REVISIONS|CHART_TYPE_LEGEND|KPI_ERROR_CONSEQUENCE)$/.test(k)));
  const flat = {};
  for (const [k, v] of Object.entries(layoutExports)) {
    if (typeof v === "string") flat[k] = v;
    else if (typeof v === "object") for (const [kk, vv] of Object.entries(v)) flat[`${k}.${kk}`] = vv;
  }
  const allowed = new Set([...Object.keys(flat)]);
  assert.deepEqual(proseFindings(flat, allowed), [], "allow-listed layout strings are at most 160 characters");
  // the extra layout names are not in the allow-list: they must pass the plain rule (one short sentence)
  for (const k of ["DRAFT_BROWSE_SUMMARY", "DRAFT_BAND_TABLE", "DRAFT_BAND_REVISIONS", "DRAFT_CHART_TYPE_LEGEND", "DRAFT_KPI_ERROR_CONSEQUENCE"]) assert.deepEqual(proseFindings({[k]: copy[k]}, new Set()), [], k);
});

test("AC-DB-32 (L26): seeded prose in a layout module, a two-sentence card caption and an unlisted long export all fail", () => {
  const long = "B".repeat(MAX + 1);
  assert.equal(literalFindings("lib/rank-view.js", 'const caption = "Countries are ranked by value. Higher is shown first.";').length, 1);
  assert.equal(literalFindings("lib/table-card.js", "const t = `" + long + "`;").length, 1);
  assert.equal(layoutLiteralFindings("lib/kpi-view.js", "html`<p class=\"mm-x\">This tile explains what the indicator measures.</p> <p>It also says why. ${name}</p>`").length, 1, "two sentences of visible text inside markup fail");
  assert.equal(layoutLiteralFindings("lib/kpi-view.js", "html`<div class=\"" + long + "\"><span>${a}</span> Latest value</div>`").length, 0, "attributes, tags and expressions are not visible prose");
  assert.equal(layoutLiteralFindings("lib/kpi-view.js", "html`<p>" + long + "</p>`").length, 1);
  assert.equal(literalFindings("lib/kpi-view.js", 'const x = "Latest value. Compared with peers.";').length, 1);
  assert.equal(literalFindings("lib/kpi-view.js", 'const x = "Latest value";').length, 0);
  assert.equal(proseFindings({DRAFT_LAYOUT_EXPLAINER: "Cards show values. Bands group cards."}, allowedNames).length, 1);
  assert.equal(proseFindings({DRAFT_LAYOUT_EXPLAINER: long}, allowedNames).length, 1);
  assert.equal(proseFindings({"DRAFT_HIDDEN_ROWS": long}, allowedNames).length, 1, "an allow-listed layout name over 160 characters fails");
});
