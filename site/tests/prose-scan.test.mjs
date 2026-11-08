// R5 (AC-RD-62, static part): data-only prose scan. Spec 1.6 (user instruction 2026-11-06): pages carry data, not explanation.
// The closed allow-list below is the list of spec section 1.6 and nothing else; each entry is a copy.js export of at most 160
// characters, except where the spec itself names a longer fixed text (see SPEC_LONG). Any other multi-sentence or over-length
// string in the scanned scope fails. Scope: the redesign section of copy.js (from the "Redesign R" marker on) and the string
// literals of the redesign modules. The legacy copy.js strings that belong to the withdrawn Guide/Status pages and old
// explanatory blocks are outside this scope until the tasks that remove them (plan R-series); they are not endorsed.
// Seeded negatives prove each rule fails.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
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
  pointReader: "DRAFT_POINT_READER_LEGEND" // amendment 3.1 (R16): the "Read a value" control label
};
// Spec 1.6 entries with no copy.js export yet: the C-IND-2 reference-period line, "Choose up to 5 countries to compare.",
// and the stale-banner wording. They are allowed by name once added; any other new name is not.
const PENDING = ["DRAFT_CHOOSE_COUNTRIES_HINT", "STALE_BANNER", "STALE_BANNER_UNREADABLE"];
// Per-value missing-data sentences (spec 5.1): one short sentence each, selected by stored fields.
const MISSING_SENTENCES = ["DRAFT_NOT_PUBLISHED_SENTENCE", "DRAFT_NA_DEFINED_SENTENCE", "DRAFT_G_STR1_NO_SERIES", "DRAFT_NA_NO_RANKED_SENTENCE"];
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
