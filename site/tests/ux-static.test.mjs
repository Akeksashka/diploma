// T106 static scans (ADR-025 / ADR-026): AC-UX-3 (colour literals), AC-UX-10 (no statistics computed in the browser),
// AC-UX-11 (built output: URLs, @import, fonts) and AC-UX-12 (size budgets) as functions, each with a seeded violation
// that must fail. The scans of the BUILT site run in tests/smoke/static.smoke.mjs, which needs dist/.
// The T102 inline-style/colour scan stays in ux-style-scan.test.mjs; this file reuses its rules (support/static-scan.mjs)
// and widens the file set to everything under src/ except style.css, plus observablehq.config.js.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {randomBytes} from "node:crypto";
import {CSS_LIMIT_BYTES, LANDING_LIMIT_BYTES, LANDING_TARGET_BYTES, gzipBytes, landingBudget, landingSet} from "../scripts/lib.mjs";
import {FONT_FILE, applyAllowList, computeHits, distFindings, listFiles, rel, scan, stripNoise, COMPUTE_RULES, BANNED_WORDS} from "./support/static-scan.mjs";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(site, "src");

// ------------------------------------------------------------------------------------------ AC-UX-3
// Every file under src/ (js, md, html, svg, css, json outside src/data) except style.css, and the site config.
function colourViolations(root, configFiles = []) {
  const files = [...listFiles(root, (n) => /\.(js|mjs|md|html|svg|css)$/.test(n) && n !== "style.css"), ...configFiles];
  return {files: files.length, hits: files.flatMap((f) => scan(readFileSync(f, "utf8")).map((r) => `${f}: ${r}`))};
}

test("AC-UX-3: no colour literal or inline style outside src/style.css (all of src/ and observablehq.config.js)", () => {
  const r = colourViolations(src, [join(site, "observablehq.config.js")]);
  assert.ok(r.files >= 25, `scanned only ${r.files} files`);
  assert.deepEqual(r.hits, []);
});

test("AC-UX-3: the scan fails on a seeded literal in a script, in a second stylesheet and in the config, but not in style.css", () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-ux3-"));
  try {
    const lit = "fill: #" + "b91c1c";
    mkdirSync(join(dir, "src", "lib"), {recursive: true});
    const root = join(dir, "src");
    writeFileSync(join(root, "style.css"), `a { color: ${"rg" + "b(1, 2, 3)"}; ${lit}; }`); // the one allowed home
    assert.deepEqual(colourViolations(root).hits, []);
    writeFileSync(join(root, "lib", "x.js"), `export const c = "${"steel" + "blue"}";`);
    writeFileSync(join(root, "print.css"), `a { ${lit} }`);
    writeFileSync(join(dir, "config.js"), `export default {head: "<p ${"style"}='x'>"};`);
    const r = colourViolations(root, [join(dir, "config.js")]);
    assert.equal(r.hits.length, 3, r.hits.join("\n"));
    assert.ok(r.hits.every((h) => !h.includes("style.css")));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ------------------------------------------------------------------------------------------ AC-UX-10
// D6 (ADR-010 decision 9, ADR-025 consequences "How the decisions respect the fixed rules" D6, ADR-026 decision 6): the
// browser never computes a rank, percentile, mean, position, n/N or composite. Every module in src/lib is scanned with
// the rules in support/static-scan.mjs (COMPUTE_RULES, BANNED_WORDS; each rule's comment says what it catches). Display
// formatting (template text, toFixed, toLocaleString, Intl, join, padStart), filtering, look-ups and default `.sort()` are
// not matched. Comparators, counters, date and index arithmetic ARE matched and therefore listed below.
//
// ALLOW-LIST. Each entry names the clause that permits it. Keep it minimal; an entry that matches nothing fails the test.
// Entries match on the file, the rule and the exact source text of the line, so a new line in the same file is still caught.
//
// Expected by the plan: the revision bar scale (ADR-025 consequences, D6: "the only display scale is a revision bar
// length relative to the largest value shown, labelled as such"). It is NOT here because no module computes it yet;
// the task that adds it appends exactly one entry, e.g.
//   {file: "lib/revisions-view.js", rule: "multiply, divide, modulo, power", contains: "<the bar width line>", clause: "ADR-025 D6 bar scale"}
const ORDERING = "ADR-025 decision 4 / brief 1.1: a sort order is a function of one stored field; comparators order, they do not rank";
const ALLOW = [
  // Ordering of stored values (comparators). Not a computation of a statistic.
  {file: "lib/explorer.js", rule: "subtraction", contains: ".sort((a, b) =>", clause: ORDERING},
  {file: "lib/explorer.js", rule: "subtraction", contains: "rs[rs.length - 1]", clause: "last element of a date-sorted list (latest stored point, ADR-025 decision 6 visible vintage of the last point); an index, not a statistic"},
  {file: "lib/revisions.js", rule: "subtraction", contains: ".sort((a, b) =>", clause: ORDERING},
  // The revision bar scale (T126): the only allowed display scale (ADR-025 D6, brief 3.3), labelled on the page by #bar-label.
  {file: "lib/revisions-view.js", rule: "multiply, divide, modulo, power", contains: "/ top) * 100", clause: "ADR-025 D6 / brief 3.3: bar length relative to the largest absolute revision_pct shown; a display scale, not a statistic, labelled on the page"},
  {file: "lib/scorecard.js", rule: "subtraction", contains: ".sort((a, b) =>", clause: ORDERING + " (stored rank_position, ADR-025 decision 4)"},
  {file: "lib/scorecard.js", rule: "subtraction", contains: "return pa - pb ||", clause: ORDERING + " (stored rank_position, ADR-025 decision 4)"},
  {file: "lib/peers.js", rule: "multiply, divide, modulo, power", contains: "return dir * (x - y)", clause: ORDERING + " (dir is +1/-1, the sort direction)"},
  {file: "lib/peers.js", rule: "subtraction", contains: "return dir * (x - y)", clause: ORDERING},
  // Display-only rebase to 100 (pure scaling, checked against Python).
  {file: "lib/rebase.js", rule: "multiply, divide, modulo, power", contains: "(r.value / base) * 100", clause: "export spec section 'Selectors served without further computation' (display-only rebase) and AC-DASH-6; ADR-025 decision 6 rebase rule. Not a statistic"},
  {file: "lib/explorer.js", rule: "Math function", contains: "Math.min(...sets", clause: "same rebase selector: earliest stored date when no common period exists (a date, not a statistic of values)"},
  // Age of the stored known_cutoff for the stale banner.
  {file: "lib/stale.js", rule: "subtraction", contains: "(+now - t) / DAY_MS", clause: "ADR-010 decision 8 / AC-DASH-7: banner when known_cutoff is older than 45 days"},
  {file: "lib/stale.js", rule: "multiply, divide, modulo, power", contains: "(+now - t) / DAY_MS", clause: "ADR-010 decision 8 / AC-DASH-7"},
  {file: "lib/stale.js", rule: "Math function", contains: "Math.floor(st.ageDays)", clause: "ADR-010 decision 8 / AC-DASH-7 (whole days in the banner text)"},
  // Counts of rows listed on the revisions page (list lengths, ordinals). No ADR clause grants these explicitly;
  // they predate T106 (T96-T99) and are listed for the user's review: ADR-025 decision 6 (vintage view) and brief V4.
  {file: "lib/revisions.js", rule: "subtraction", contains: "recent.revisions.length - headline.length", clause: "count of recent-list rows not shown ('n more'); brief V4 recent list; counts displayed rows only [ACCEPTED 2026-11-04]"},
  {file: "lib/revisions.js", rule: "addition", contains: "perEntity.get(e) ?? 0) + 1", clause: "count of series per country to disambiguate select labels; brief V4 vintage view [ACCEPTED 2026-11-04]"},
  {file: "lib/revisions.js", rule: "addition", contains: "later version ${i + 1} of ${n}", clause: "ordinal label of a listed version; brief V4 vintage view [ACCEPTED 2026-11-04]"},
  {file: "lib/revisions.js", rule: "addition", contains: "keys.reduce((s, k) => s + k.versions.length, 0)", clause: "count of version rows shown for the selected series; brief V4 vintage view [ACCEPTED 2026-11-04]"},
  {file: "lib/revisions.js", rule: "array reduction", contains: "keys.reduce((s, k) => s + k.versions.length, 0)", clause: "same count of listed version rows as the addition above [ACCEPTED 2026-11-04]"}
];

function moduleHits(root) {
  const out = {};
  const files = listFiles(join(root, "lib"), (n) => n.endsWith(".js"));
  for (const f of files) out[rel(root, f)] = computeHits(readFileSync(f, "utf8"));
  return {files, hits: out};
}

test("AC-UX-10: every src/lib module is scanned and nothing computes a statistic beyond the explicit allow-list", () => {
  const {files, hits} = moduleHits(src);
  const onDisk = readdirSync(join(src, "lib")).filter((n) => n.endsWith(".js"));
  assert.equal(files.length, onDisk.length);
  assert.ok(files.length >= 19, `scanned only ${files.length} modules`);
  const {violations, unused} = applyAllowList(hits, ALLOW);
  assert.deepEqual(violations, []);
  assert.deepEqual(unused, [], "allow-list entries that match nothing must be removed");
  for (const a of ALLOW) assert.ok(a.clause && a.clause.length > 20, `exception without a clause: ${a.file} ${a.contains}`);
});

test("AC-UX-10: no judgement word, removed baseline phrasing, adverse_dir or display_dir in any src/lib module or page", () => {
  const files = [...listFiles(src, (n) => /\.(js|md)$/.test(n))];
  const hits = files.flatMap((f) => computeHits(readFileSync(f, "utf8")).filter((h) => h.rule in BANNED_WORDS).map((h) => `${rel(src, f)}:${h.line}: ${h.rule}`));
  assert.deepEqual(hits, []);
});

const RULE_SEEDS = {
  "compound assignment or increment": ["let s = 0; for (const v of xs) s += v;", "i++;", "total /= n;"],
  "multiply, divide, modulo, power": ["const mean = total / n;", "const share = a * 100;", "const k = i % 5;", "const sq = x ** 2;"],
  "subtraction": ["const spread = hi - lo;", "const d = a[0] -b;"],
  "addition": ["const total = a + b;", "const n = 1 + count;"],
  "Math function": ["const m = Math.max(...xs);", "Math.round(x)"],
  "array reduction": ["xs.reduce((s, v) => s, 0)"],
  "d3 statistics": ["d3.mean(xs)", 'import {mean} from "d3";', 'import * as d from "d3-array";', "Plot.binX({y: 1}, {x: 'a'})", "Plot.groupY({x: 1}, {y: 'a'})"],
  "statistics-named function": ["const r = rank(xs);", "const m = mean(xs);", "function computeComposite(rows) {}", "const p = percentileOf(v);", "const z = weightedSum(v);", "x.median()", "const q = meanOfRows(r);"]
};
const WORD_SEEDS = {
  "judgement word": ["const note = 'a good result';", "// weak growth"],
  "removed baseline phrasing": ["const t = 'vs first " + "release';", "First stored " + "release"],
  "adverse_dir or display_dir": ["const d = e.adverse_dir;", "r.display_dir"]
};
// Display formatting, filtering, look-ups and ordering of stored values that must NOT be flagged.
const CLEAN = [
  "const t = `${a}: ${b.toFixed(1)} of ${n}`;",
  "const s = String(x).padStart(2, '0') + '%';",
  "const u = 'n/a - not published' + x;",
  "const re = /a-b\\/c*/g; const u = x.replace(re, '');",
  "return -1;",
  "const f = new Intl.NumberFormat('en').format(v);",
  "const ok = rows.filter((r) => r.percentile >= 0.2).map((r) => r.name).sort();",
  "const label = e.percentile_rank_label ?? 'n/a';",
  "// a - b, mean, rank(x), Math.max, 5 * 3 in a comment",
  "const j = [1, 2].join(', ') + ' x';",
  "const price = `${(x)}% of 10 - 2`;",
  "export const formatPercentile = (v) => v.toFixed(2);",
  "const url = '//cdn/x' + a;"
];

test("AC-UX-10: each rule is proven by a seeded violation, and formatting is not flagged", () => {
  assert.deepEqual(Object.keys(RULE_SEEDS).sort(), Object.keys(COMPUTE_RULES).sort(), "every computation rule needs seeds");
  assert.deepEqual(Object.keys(WORD_SEEDS).sort(), Object.keys(BANNED_WORDS).sort());
  for (const [rule, seeds] of Object.entries({...RULE_SEEDS, ...WORD_SEEDS})) {
    for (const s of seeds) assert.ok(computeHits(s).some((h) => h.rule === rule), `${rule} did not flag: ${s}`);
  }
  for (const c of CLEAN) assert.deepEqual(computeHits(c), [], `false positive: ${c}`);
});

test("AC-UX-10: the allow-list is exact (a different line in an allowed file, or a stale entry, fails)", () => {
  const allow = [{file: "lib/rebase.js", rule: "multiply, divide, modulo, power", contains: "(r.value / base) * 100", clause: "test entry for the exact-match check"}];
  const ok = {"lib/rebase.js": computeHits("const x = (r.value / base) * 100;")};
  assert.deepEqual(applyAllowList(ok, allow), {violations: [], unused: []});
  const other = {"lib/rebase.js": computeHits("const m = total / n;")};
  assert.equal(applyAllowList(other, allow).violations.length, 1);
  assert.equal(applyAllowList(other, allow).unused.length, 1);
  const otherFile = {"lib/peers.js": computeHits("const x = (r.value / base) * 100;")};
  assert.equal(applyAllowList(otherFile, allow).violations.length, 1);
  const otherRule = {"lib/rebase.js": computeHits("const x = Math.max(a);")};
  assert.equal(applyAllowList(otherRule, allow).violations.length, 1);
});

test("AC-UX-10: stripNoise keeps line numbers and removes strings, comments, regexes and template text only", () => {
  const code = ["const a = 'x - y'; // p / q", "const b = `t ${n + 1} u/v`; /* m * n */", "const r = /[/]a/g;"].join("\n");
  const out = stripNoise(code);
  assert.equal(out.split("\n").length, 3);
  assert.ok(out.includes("n + 1") && !out.includes("x - y") && !out.includes("p / q") && !out.includes("u/v") && !out.includes("m * n"));
});

// ------------------------------------------------------------------------------------------ AC-UX-11
test("AC-UX-11: URL, @import and font findings (seeded violations fail, namespaces pass)", () => {
  const dir = "http://www.w3.org/2000/svg";
  assert.deepEqual(distFindings("a.css", `a { background: url("data:image/svg+xml,<svg xmlns='${dir}'/>"); }`), []);
  assert.deepEqual(distFindings("a.js", `const ns = "${dir}"; const x = "http://www.w3.org/1999/xlink";`), []);
  assert.deepEqual(distFindings("a.js", "// https://www.jsdelivr.com/using-sri-with-dynamic-files"), []);
  assert.deepEqual(distFindings("a.html", '<a href="./x.html">x</a><a href="//">y</a>'), []);
  const bad = {
    "a.css": ["@import url(" + "https://fonts.googleapis.com/css2?family=Inter);", "@import '" + "//cdn.example.org/x.css';", "a { background: url(" + "https://cdn.example.org/i.png) }", "@font-" + "face { font-family: X }", "a { src: url(data:font/" + "woff2;base64,AAAA) }"],
    "a.html": ['<link rel="stylesheet" href="' + 'https://fonts.googleapis.com/css">', '<script src="' + '//cdn.example.org/a.js"></script>'],
    "a.js": ['fetch("' + 'https://api.example.org/x")', "http://www.w3.org/2000/svg.evil.example/x".replace("svg.evil", "svg2.evil")]
  };
  for (const [name, list] of Object.entries(bad)) for (const t of list) assert.ok(distFindings(name, t).length > 0, `not flagged: ${t}`);
  assert.ok(distFindings("a.css", "@import url(" + "https://x.example.org/a.css);").includes("remote @import"));
  assert.ok(distFindings("a.css", "@import \"./local.css\";").length === 0, "a local @import is not a remote one");
  for (const f of ["Inter.woff2", "a.WOFF", "x/y.ttf", "z.otf", "q.eot"]) assert.ok(FONT_FILE(f), f);
  for (const f of ["a.css", "woff2.txt", "font.json"]) assert.ok(!FONT_FILE(f), f);
});

// ------------------------------------------------------------------------------------------ AC-UX-12
test("AC-UX-12: landingBudget enforces 20 KB CSS gzip, the 600 KB target and the 1.5 MB limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-ux12-"));
  try {
    const page = (cssName) => `<!doctype html><link rel="stylesheet" href="./${cssName}"><script type="module" src="./a.js"></script>`;
    writeFileSync(join(dir, "index.html"), page("s.css"));
    writeFileSync(join(dir, "s.css"), "a{color:var(--x)}\n".repeat(50));
    writeFileSync(join(dir, "a.js"), "export const a = 1;\n");
    let b = landingBudget(landingSet(dir));
    assert.deepEqual([b.cssFiles, b.cssOk, b.targetOk, b.limitOk], [1, true, true, true]);
    writeFileSync(join(dir, "s.css"), randomBytes(CSS_LIMIT_BYTES).toString("base64")); // incompressible: far above 20 KB gz
    b = landingBudget(landingSet(dir));
    assert.ok(b.cssGzip > CSS_LIMIT_BYTES && !b.cssOk, `css ${b.cssGzip}`);
    assert.ok(b.targetOk && b.limitOk);
    writeFileSync(join(dir, "a.js"), "export const a = `" + randomBytes(LANDING_TARGET_BYTES).toString("base64") + "`;\n");
    writeFileSync(join(dir, "s.css"), "a{}");
    b = landingBudget(landingSet(dir));
    assert.ok(b.totalGzip > LANDING_TARGET_BYTES && !b.targetOk && b.limitOk, `total ${b.totalGzip}`);
    writeFileSync(join(dir, "a.js"), "export const a = `" + randomBytes(LANDING_LIMIT_BYTES).toString("base64") + "`;\n");
    b = landingBudget(landingSet(dir));
    assert.ok(!b.limitOk && !b.targetOk);
    writeFileSync(join(dir, "index.html"), "<!doctype html><p>no stylesheet</p>");
    assert.equal(landingBudget(landingSet(dir)).cssOk, false, "a page without any stylesheet fails the CSS check");
    assert.ok(gzipBytes(Buffer.from("x")) > 0);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
