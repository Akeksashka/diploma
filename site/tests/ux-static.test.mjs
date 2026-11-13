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
  // Plain index arithmetic (positions in a list or string, never a value).
  {file: "lib/point-reader.js", rule: "subtraction", contains: "entry.texts.length - 1", clause: "index of the last plotted point of a list; an index, not a statistic"},
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
  // Layout L5 (filter view-model): calendar arithmetic and the one named count.
  {file: "lib/filter-period.js", rule: "subtraction", contains: "bounds.to - bounds.from + 1", clause: "L9: the number of calendar years the Period selects list, from the stored bounds; a count of options, not a data value"},
  {file: "lib/filter-period.js", rule: "addition", contains: "bounds.to - bounds.from + 1", clause: "L9: the number of calendar years the Period selects list, from the stored bounds; a count of options, not a data value"},
  {file: "lib/filter-model.js", rule: "subtraction", contains: "bounds.to - (n - 1)", clause: "amendment 2.2 preset arithmetic: 'Last 10 years' = known_cutoff year minus 9; calendar years, not data values"},
  {file: "lib/filter-model.js", rule: "compound assignment or increment", contains: "counts.total += 1", clause: "AC-DB-36 / ADR-036 Amendment 1: countHiddenRowsByReason, a tally of the stored reasons of ONE hidden array; the single whitelisted browser-side count (ADR-037 A1.4)"},
  // Layout L19 / L20 (series card): paging and tick selection by position, and facet ordering; never a value.
  {file: "lib/series-card.js", rule: "compound assignment or increment", contains: "facetCount += FACET_PAGE", clause: "L19 amendment 4.10: 'Show more' adds the next block of facets; a count of facets drawn, not a data value"},
  {file: "lib/small-multiples.js", rule: "subtraction", contains: "rank.get(a.entity) - rank.get(b.entity)", clause: ORDERING + " (position in the C-RANK order of the comparison set)"},
  {file: "lib/bar-chart.js", rule: "multiply, divide, modulo, power", contains: "labels.length / max", clause: "L20: spacing of at most 10 labelled x ticks by position in the list; every bar is still drawn, no value is computed"},
  {file: "lib/bar-chart.js", rule: "Math function", contains: "Math.ceil(labels.length / max)", clause: "L20: spacing of at most 10 labelled x ticks by position in the list; no value is computed"},
  {file: "lib/bar-chart.js", rule: "multiply, divide, modulo, power", contains: "i % step === 0", clause: "L20: every step-th period label is a tick; a position test, not a statistic"},
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

// ------------------------------------------------------------------------------------------ R5 (AC-RD-50, 51, 52)
// The redesign modules (spec 1.1, 5.1-5.3; plan R2-R4) are scanned by name, so removing one from src/lib or from the scan fails.
const NEW_LIB = ["hash", "period", "units", "sort", "missing", "copy", "country-view", "profile-chart", "indicator-view", "value-chart"].map((n) => `lib/${n}.js`);
const IMPORT_ONLY_LIB = ["lib/filter-model.js"]; // L5: allow-listed for its two entries only (AC-DB-36); import-checked here
const BASELINE_DEPS = {"@observablehq/framework": "1.13.4", "@observablehq/plot": "0.6.18", d3: "7.9.2"};
const BASELINE_DEV = {playwright: "1.64.1"};

// Import specifiers of a module (static `import ... from "x"`, `export ... from "x"`, `import("x")`).
const importSpecifiers = (code) => [...code.matchAll(/(?:(?:^|[}\s*])from\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]);
const nonRelativeImports = (code) => importSpecifiers(code).filter((s) => !/^\.{1,2}\//.test(s));

test("AC-RD-50: each redesign module is scanned, computes nothing, and needs no allow-list entry", () => {
  const {hits} = moduleHits(src);
  for (const m of NEW_LIB) {
    assert.ok(m in hits, `${m} is not scanned`);
    assert.deepEqual(hits[m], [], `${m} computes something: ${JSON.stringify(hits[m])}`);
    assert.ok(!ALLOW.some((a) => a.file === m), `${m} must not be allow-listed`);
  }
  const words = NEW_LIB.flatMap((m) => computeHits(readFileSync(join(src, m), "utf8")).filter((h) => h.rule in BANNED_WORDS));
  assert.deepEqual(words, []);
});

test("AC-RD-50: a seeded computation or judgement word in a redesign module fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-rd50-"));
  try {
    mkdirSync(join(dir, "lib"));
    for (const m of NEW_LIB) writeFileSync(join(dir, m), "export const f = (xs) => xs.length / 2; // " + m + "\n");
    const {hits} = moduleHits(dir);
    for (const m of NEW_LIB) assert.ok(hits[m].some((h) => h.rule === "multiply, divide, modulo, power"), m);
    for (const m of NEW_LIB) {
      assert.deepEqual(applyAllowList({[m]: hits[m]}, ALLOW).violations.length, 1, `${m} not reported as a violation`);
      assert.ok(computeHits("export const t = 'a good result';").some((h) => h.rule === "judgement word"));
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("AC-RD-51 (static part): no off-origin URL, remote @import or font in the redesign modules or pages", () => {
  const files = listFiles(src, (n) => /\.(js|md)$/.test(n));
  const hits = files.flatMap((f) => distFindings(f, readFileSync(f, "utf8")).map((x) => `${rel(src, f)}: ${x}`));
  assert.deepEqual(hits, []);
  for (const m of NEW_LIB) assert.ok(files.some((f) => rel(src, f) === m), `${m} is not scanned`);
});

test("AC-RD-51 (static part): a seeded off-origin string or remote @import fails", () => {
  assert.ok(distFindings("lib/hash.js", 'export const u = "' + 'https://cdn.example.org/x.js";').length > 0);
  assert.ok(distFindings("lib/units.js", 'fetch("' + '//api.example.org/v1")').length > 0);
  assert.ok(distFindings("lib/copy.js", "@import url(" + "https://fonts.googleapis.com/css);").length > 0);
});

test("AC-RD-52: no new npm dependency, and the redesign modules import only relative files", () => {
  const pkg = JSON.parse(readFileSync(join(site, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies, BASELINE_DEPS);
  assert.deepEqual(pkg.devDependencies, BASELINE_DEV);
  for (const m of [...NEW_LIB, ...IMPORT_ONLY_LIB]) assert.deepEqual(nonRelativeImports(readFileSync(join(src, m), "utf8")), [], `${m} imports a package`);
});

test("AC-RD-52: a seeded package import fails", () => {
  for (const code of ['import {mean} from "d3";', 'import * as P from "@observablehq/plot";', 'const m = await import("lodash");', 'export {x} from "d3-array";']) {
    assert.ok(nonRelativeImports(code).length > 0, code);
  }
  assert.deepEqual(nonRelativeImports('import {PERCENTILE_LABEL} from "./units.js"; export * from "../lib/x.js";'), []);
});

// ------------------------------------------------------------------------------------------ R5 (AC-RD-42)
// Unit presence in render modules: a module under src/lib that renders a value (reads `.value` / `transformed_value` or calls a
// value formatter) must reference a unit source: units.js, a stored unit field or the percentile label. A renderer that shows a
// number and names no unit source is a defect. This is a presence check on the module; the DOM check on pages is in the smoke tests.
const VALUE_USE = /\.(?:value|transformed_value)\b|formatValue|fmtValue/;
const UNIT_SOURCE = /unitText|indicatorUnit|seriesUnit|rebaseUnit|multText|unit_label|unit_code|\.unit\b|\bunit:|PERCENTILE_LABEL|PERCENTILE_COLUMN_LABEL|REBASED_UNIT/;
const isRenderer = (name) => /-view\.js$|chart\.js$/.test(name);
const unitFindings = (name, code) => {
  const c = stripNoise(code);
  const text = code.replace(/\/\/.*$/gm, "");
  return isRenderer(name) && VALUE_USE.test(c) && !UNIT_SOURCE.test(text) ? [`${name}: renders a value, names no unit source`] : [];
};

test("AC-RD-42: every render module that shows a value references a unit source", () => {
  const files = listFiles(join(src, "lib"), (n) => isRenderer(n));
  assert.ok(files.length >= 5, `found only ${files.length} render modules`);
  assert.deepEqual(files.flatMap((f) => unitFindings(f, readFileSync(f, "utf8"))), []);
});

test("AC-RD-42: a seeded renderer that shows a value without a unit fails, and the unit helpers are exposed", () => {
  assert.equal(unitFindings("lib/country-view.js", "export const cell = (r) => html`<td>${r.value}</td>`;").length, 1);
  assert.equal(unitFindings("lib/profile-chart.js", "const y = (r) => formatValue(r);").length, 1);
  assert.deepEqual(unitFindings("lib/country-view.js", 'import {unitText} from "./units.js"; const c = (r) => `${r.value} ${unitText(r).unit}`;'), []);
  assert.equal(unitFindings("lib/country-view.js", "// the unit is shown\nconst c = (r) => `${r.value} per unit of time`;").length, 1, "the bare word unit in prose or a string is not a unit source");
  assert.deepEqual(unitFindings("lib/units.js", "const v = r.value;"), [], "units.js is a helper, not a renderer");
  const units = readFileSync(join(src, "lib", "units.js"), "utf8");
  for (const fn of ["indicatorUnit", "seriesUnit", "rebaseUnit", "unitText", "multText", "PERCENTILE_LABEL"]) assert.ok(units.includes(`export ${fn === "PERCENTILE_LABEL" ? "const" : "function"} ${fn}`), fn);
});

// R22 AC-UX-9: a control that is shown with display: flex outside print must be hidden by a print rule that comes AFTER that rule
// (the first R22 sweep found the home filter printing because the hiding rule sat earlier in the file and lost the cascade).
test("R22: the print rule hiding .mm-filter comes after its screen display rule", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "style.css"), "utf8");
  const screenAt = css.indexOf(".mm-filter { margin:");
  const printAt = css.indexOf("@media print { .mm-filter { display: none; } }");
  assert.ok(screenAt > 0 && printAt > screenAt, `screen rule at ${screenAt}, print rule at ${printAt}`);
});

// No rule after the print hide may set display on the .mm-filter element itself (a later screen rule would beat the print rule).
// Rules are read flat (innermost braces); `display: none` after the print block is harmless.
test("R22: no rule after the print hide re-shows .mm-filter", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "style.css"), "utf8");
  const marker = "@media print { .mm-filter { display: none; } }";
  const after = css.slice(css.indexOf(marker) + marker.length).replace(/\/\*[\s\S]*?\*\//g, "");
  const offenders = [];
  for (const [, selector, body] of after.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const targetsFilter = selector.split(",").some((part) => {
      const last = part.trim().split(/\s*[\s>+~]\s*/).pop() ?? "";
      return /(^|[^\w-])\.mm-filter(?![\w-])/.test(last) || /^\.mm-filter(?![\w-])/.test(last);
    });
    const display = /(?:^|;)\s*display\s*:\s*([^;]+)/.exec(body);
    if (targetsFilter && display && display[1].trim() !== "none") offenders.push(`${selector.trim()} { display: ${display[1].trim()} }`);
  }
  assert.deepEqual(offenders, []);
});

// ------------------------------------------------------------------------------------------ L5 (AC-DB-22, AC-DB-36)
test("AC-DB-36: filter-model.js has exactly two allow-listed hits (preset arithmetic and countHiddenRowsByReason); any other count fails", () => {
  const {hits} = moduleHits(src);
  const mine = hits["lib/filter-model.js"];
  assert.ok(mine, "filter-model.js is scanned");
  assert.deepEqual(applyAllowList({"lib/filter-model.js": mine}, ALLOW).violations, []);
  assert.equal(mine.length, 2, JSON.stringify(mine));
  const seeded = [
    "export const countRows = (rows) => rows.length - other.length;",
    "export function tallyByReason(h) { const c = {}; for (const x of h) c[x.reason] += 1; return c; }",
    "export function nCountries(es) { let n = 0; for (const e of es) n += 1; return n; }",
    "export const total = (xs) => xs.reduce((s, x) => s + x, 0);"
  ];
  for (const code of seeded) {
    const h = computeHits(code);
    assert.ok(h.length > 0, code);
    assert.ok(applyAllowList({"lib/filter-model.js": h}, ALLOW).violations.length > 0, `not reported: ${code}`);
  }
});

// ------------------------------------------------------------------------------------------ L26 (AC-DB-22, 30, 32, 34, 35)
// Layout modules L1-L24. The scans below walk the directory (a new module is scanned without being listed); this list only
// proves that these modules exist and are covered, so deleting or renaming one cannot make a scan pass vacuously.
const LAYOUT_LIB = ["bar-chart", "carry", "country-page", "domain-page", "explorer-filters", "facts-card", "filter-bar-options", "filter-bar", "filter-chip", "filter-country", "filter-model", "filter-period", "filter-proof", "filter-store", "heatmap-card", "home-dashboard", "kpi-model", "kpi-view", "rank-model", "rank-view", "series-card", "small-multiples", "table-card"].map((n) => `lib/${n}.js`);
const libFiles = () => listFiles(join(src, "lib"), (n) => n.endsWith(".js"));
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");

// Rule 1: no Total / sum / average label in any string, template text or page (word match, comments excluded).
const LABEL_RE = /\b(?:grand\s+total|totals?|sums?|averages?|avg|overall|aggregate\s+row)\b/i;
// The one `total` the spec names: the `total` field of the countHiddenRowsByReason result (ADR-036 Amendment 1; a tally of ONE hidden array, shown only as the
// "{N} rows hidden" count). Only the exact reads of that result and its initialiser are exempt; any other word "total" still fails.
const HIDDEN_TOTAL_FIELD = /(?:\bcounts\??|\.counts|countHiddenRowsByReason\([^)]*\))\??\.total\b|\{total: 0\b/g;
const labelFindings = (name, text) => stripComments(text).split("\n").flatMap((l, k) => (LABEL_RE.test(l.replace(HIDDEN_TOTAL_FIELD, "")) ? [`${name}:${k + 1}: total/average label: ${l.trim().slice(0, 80)}`] : []));

// Rule 2: a helper DEFINED with a total / sum / average / count name (function, const, let, var), and the entity-count reads.
const HELPER_DEF = /\b(?:function|const|let|var)\s+((?:total|sum|avg|average|mean|tally|count|n)(?:[A-Z_]\w*)?|\w*(?:Total|Sum|Average|Mean|Count|Tally)s?)\s*(?=[=(;])/g;
const WHITELISTED_COUNT = {file: "lib/filter-model.js", name: "countHiddenRowsByReason"}; // ADR-036 Amendment 1, AC-DB-36: the single named exception
const helperFindings = (file, code) => [...stripNoise(code).matchAll(HELPER_DEF)].filter((m) => m[1] !== "n" && !(file === WHITELISTED_COUNT.file && m[1] === WHITELISTED_COUNT.name)).map((m) => `${file}: helper ${m[1]}`);
// `.length` / `.size` read whose value is used (passed on, returned, stored, put in a label) rather than compared or tested.
const COMPARED = /[\w$.?()[\]!]*?\.(?:length|size)\s*(?:===?|!==?|>=?|<=?|<|>)\s*[\w.]+/g;
const TESTED = /!+[\w$.?()[\]]*?\.(?:length|size)\b|(?:\b(?:if|while)\s*\(\s*|[&|]{2}\s*)[\w$.?()[\]]*?\.(?:length|size)\b(?=\s*(?:\)|\?|&&|\|\|))|[\w$.?()[\]]*?\.(?:length|size)\s*(?=\?|&&|\|\|)/g;
const countReads = (code) => stripNoise(code).split("\n").flatMap((l, k) => {
  const r = l.replace(COMPARED, "").replace(TESTED, "");
  return /\.(?:length|size)\b/.test(r) ? [{rule: "length or size read that feeds output", line: k + 1, text: l.trim()}] : [];
});
const HIDDEN_LENGTH = /\bhidden\w*\s*(?:\?\.|\.)\s*(?:length|size)\b/;
const hiddenLengthHits = (file, code) => (file === "lib/filter-model.js" ? [] : stripNoise(code).split("\n").flatMap((l, k) => (HIDDEN_LENGTH.test(l) ? [`${file}:${k + 1}: reads .length of a hidden list`] : [])));

// Entity-count allow-list. Every entry names why it is not a count of entities shown to the reader as a statistic.
// Entries marked [pre-L] predate the layout tasks (R-series, T-series) and are reported to the user in the L26 section of
// docs/ops/dashboard-layout-measurements.md; they are listed so that a NEW count fails, not to endorse them.
const COUNT_ALLOW = [
  {file: "lib/filter-country.js", contains: "DRAFT_COUNTRY_SELECTED(selected.length)", clause: "L10 chip summary: how many countries the reader has picked (at most 5, own selection), not a count of data entities [report]"},
  {file: "lib/filter-country.js", contains: "querySelectorAll(", clause: "L10: visible-item test for the text filter heading; compared to zero on the next line, never shown"},
  {file: "lib/bar-chart.js", contains: "Math.ceil(labels.length / max)", clause: "L20: tick spacing by position; see the AC-UX-10 entry"},
  {file: "lib/series-card.js", contains: "model.series.length", clause: "L19/L20: series drawn decides Lines/Bars availability (RD C-SER); an input of a mode rule, not displayed"},
  {file: "lib/series-card.js", contains: "selected: built.visible.length", clause: "L19/L20: passes the number of facets drawn to the mode rule; not displayed"},
  {file: "lib/series-card.js", contains: "selected: plan.entities.length", clause: "L19/L20: passes the number of series drawn to the mode rule; not displayed"},
  {file: "lib/explorer-view.js", contains: ".size", clause: "[pre-L] T-series: number of distinct years of a plotted series chooses axis tick format; not displayed"},
  {file: "lib/heatmap-view.js", contains: "].length", clause: "[pre-L] colspan of the group row (columns of the table); a layout number, not displayed as a count"},
  {file: "lib/home-dashboard.js", contains: "emitted.length", clause: "test hook data-renders (render counter); not user-visible text"},
  {file: "lib/home-lists.js", contains: "c.aggregates.length", clause: "[pre-L] R17: presence of the Aggregates sub-list; tested, not displayed"},
  {file: "lib/home-lists.js", contains: "hrefs.size", clause: "[pre-L] R17: HOME_FILTER_COUNT `n shown` of the home link filter (links, not entities) [report]"},
  {file: "lib/indicator-view.js", contains: "dots.length", clause: "[pre-L] R10: country count in the dot-plot aria-label (DRAFT_PEER_FIGURE_LABEL) [report]"},
  {file: "lib/value-chart.js", contains: "rows.length", clause: "[pre-L] R10: country count in the bar-chart aria-label (DRAFT_VALUE_FIGURE_LABEL) [report]"},
  {file: "lib/peers-view.js", contains: "st.rows.filter(", clause: "[pre-L] R11: n of the ranked dot plot (peer chart) [report]"},
  {file: "lib/point-reader.js", contains: "entry.texts.length", clause: "index of the last plotted point; see the AC-UX-10 entry"},
  {file: "lib/revisions.js", contains: ".length", clause: "[pre-L] T96-T99: counts of listed revision rows and versions (ACCEPTED 2026-11-04, see the AC-UX-10 entries)"},
  {file: "lib/revisions-view.js", contains: "rv.rows.length", clause: "[pre-L] T96-T99: emptiness test of the listed rows (ACCEPTED 2026-11-04)"},
  {file: "lib/scorecard.js", contains: "staleCount", clause: "[pre-L] T-series scorecard: stale indicators of one entity, a flag count in the summary line [report]"},
  {file: "lib/explorer.js", contains: "rs[rs.length - 1]", clause: "last element of a date-sorted list; an index (see the AC-UX-10 entry)"}
];
const HELPER_ALLOW = [
  {file: "lib/scorecard.js", name: "staleCount", clause: "[pre-L] counts the stale indicators of one entity [report]"},
  {file: "lib/series-card.js", name: "facetCount", clause: "L19: facets drawn so far (AC-UX-10 entry); a paging cursor, not a statistic"},
  {file: "lib/heatmap.js", name: "meanState", clause: "[pre-L] state of the STORED domain mean percentile column (summary.meanPercentile); nothing is averaged in the browser"},
  {file: "lib/heatmap.js", name: "meanBin", clause: "[pre-L] bin of the STORED domain mean percentile column; nothing is averaged in the browser"},
  {file: "lib/scorecard.js", name: "mean", clause: "[pre-L] the stored percentile_rank of the entity (domain figure); nothing is averaged in the browser"},
  {file: "lib/scorecard.js", name: "meanText", clause: "[pre-L] formatted stored percentile_rank of the entity; nothing is averaged in the browser"},
];

function layoutScan(root) {
  const files = listFiles(join(root, "lib"), (n) => n.endsWith(".js"));
  const labels = [];
  const reads = {};
  const helpers = [];
  const hidden = [];
  for (const f of files) {
    const code = readFileSync(f, "utf8");
    const file = rel(root, f);
    labels.push(...labelFindings(file, code));
    reads[file] = countReads(code);
    helpers.push(...helperFindings(file, code));
    hidden.push(...hiddenLengthHits(file, code));
  }
  for (const f of listFiles(root, (n) => n.endsWith(".md"))) labels.push(...labelFindings(rel(root, f), readFileSync(f, "utf8")));
  return {files, labels, reads, helpers, hidden};
}
const countViolations = (reads, allow) => {
  const used = new Set();
  const violations = [];
  for (const [file, hits] of Object.entries(reads)) {
    for (const h of hits) {
      const i = allow.findIndex((a) => a.file === file && h.text.includes(a.contains));
      if (i >= 0) used.add(i);
      else violations.push(`${file}:${h.line}: ${h.rule}: ${h.text.slice(0, 100)}`);
    }
  }
  return {violations, unused: allow.filter((_, i) => !used.has(i)).map((a) => `${a.file}: ${a.contains}`)};
};
const helperViolations = (helpers, allow) => helpers.filter((h) => !allow.some((a) => h === `${a.file}: helper ${a.name}`));

test("AC-DB-22 (L26): every layout module exists and is in the scanned directory walk", () => {
  const scanned = libFiles().map((f) => rel(src, f));
  for (const m of LAYOUT_LIB) assert.ok(scanned.includes(m), `${m} is missing from src/lib (scan would pass vacuously)`);
  assert.equal(scanned.length, readdirSync(join(src, "lib")).filter((n) => n.endsWith(".js")).length, "the walk covers every module on disk");
});

test("AC-DB-22 (L26): no Total / average / sum label and no total/sum/average/count helper in any module or page", () => {
  const r = layoutScan(src);
  assert.deepEqual(r.labels, []);
  assert.deepEqual(helperViolations(r.helpers, HELPER_ALLOW), []);
  assert.deepEqual(r.helpers.filter((h) => h.endsWith("countHiddenRowsByReason")), [], "the whitelisted function is skipped only in filter-model.js");
  for (const a of HELPER_ALLOW) assert.ok(r.helpers.includes(`${a.file}: helper ${a.name}`), `stale helper exception ${a.file} ${a.name}`);
});

test("AC-DB-22 (L26): countHiddenRowsByReason is defined once, in filter-model.js, and no module computes a second entity count", () => {
  const defs = libFiles().filter((f) => /\b(?:function|const)\s+countHiddenRowsByReason\b/.test(stripNoise(readFileSync(f, "utf8")))).map((f) => rel(src, f));
  assert.deepEqual(defs, ["lib/filter-model.js"]);
  const r = layoutScan(src);
  const {violations, unused} = countViolations(r.reads, COUNT_ALLOW);
  assert.deepEqual(violations, []);
  assert.deepEqual(unused, [], "count allow-list entries that match nothing must be removed");
  for (const a of COUNT_ALLOW) assert.ok(a.clause.length > 20, `exception without a clause: ${a.file} ${a.contains}`);
  assert.deepEqual(r.hidden, [], "no view module reads .length of a hidden list (ADR-036 I5)");
});

test("AC-DB-22 (L26): seeded totals, averages, counts and hidden-list lengths each fail", () => {
  for (const s of ['const row = {name: "Total", value: 1};', "html`<tr><th>Average</th></tr>`", 'const t = "Sum of values";', "<th>Overall</th>", 'const l = "Grand total";', "const t = 'Totals';"]) assert.equal(labelFindings("lib/x.js", s).length, 1, s);
  for (const s of ["const n = counts.total;", "const c = {total: 0, no_data: 0};", "const k = countHiddenRowsByReason(split.hidden).total;"]) assert.deepEqual(labelFindings("lib/x.js", s), [], `the hidden-count total field is exempt: ${s}`);
  for (const s of ["const n = rows.total;", "const n = stats.total + 1;", 'const l = "counts total";']) assert.equal(labelFindings("lib/x.js", s).length, 1, s);
  for (const s of ["// a total row is never drawn", "const label = 'Aggregates';", "const all = 'Browse';"]) assert.deepEqual(labelFindings("lib/x.js", s), [], s);
  for (const s of ["const total = (xs) => 0;", "function sumOf(xs) { return 0; }", "const meanOf = (xs) => 0;", "let rowCount = 0;", "const nCountries = (es) => es.length;", "function count(xs) {}", "const countRows = (r) => 0;"]) {
    assert.equal(helperFindings("lib/x.js", s).length, 1, s);
  }
  assert.equal(helperFindings("lib/rank-view.js", "const countHiddenRowsByReason = () => 0;").length, 1, "the exception is bound to filter-model.js");
  assert.deepEqual(helperFindings("lib/filter-model.js", "export function countHiddenRowsByReason(r) {}"), []);
  assert.deepEqual(helperFindings("lib/x.js", "const country = 1; const counter = 2; const countryGroups = () => []; const n = 3;"), []);
  for (const s of ["const nEntities = entities.length;", "return rows.length;", "const label = `${rows.length} rows`;", "const s = DRAFT_X(ids.length);", "root.dataset.n = String(set.size);", "const k = {count: xs.length};"]) {
    assert.equal(countReads(s).length, 1, s);
    assert.equal(countViolations({"lib/rank-view.js": countReads(s)}, COUNT_ALLOW).violations.length, 1, `not reported: ${s}`);
  }
  for (const s of ["if (!rows.length) return;", "const empty = rows.length === 0;", "const ok = rows.length > 0 && x;", "const t = rows.length ? 1 : 2;", "if (a.length) { go(); }", "const e = !rows.length;"]) assert.deepEqual(countReads(s), [], s);
  for (const s of ["const n = hidden.length;", "if (split.hidden.length > 0) go();", "const k = hiddenRows?.size;"]) assert.equal(hiddenLengthHits("lib/rank-view.js", s).length, 1, s);
  assert.deepEqual(hiddenLengthHits("lib/filter-model.js", "const n = hidden.length;"), [], "only filter-model.js may read it");
  assert.equal(countViolations({"lib/filter-model.js": countReads("return rows.length - splitByPeriod(rows, from, to, opts).kept.length;")}, COUNT_ALLOW).violations.length, 1, "the retired countPeriodHiddenRows line is no longer whitelisted");
  assert.equal(countViolations({"lib/filter-model.js": countReads("return a.length - b.length;")}, COUNT_ALLOW).violations.length, 1, "any other line in filter-model.js fails");
});

test("AC-DB-22 (L26): the scans fail on a seeded violation in a directory walk of a copy of src/lib", () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-l26-"));
  try {
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib", "new-view.js"), 'export const f = (rows) => ({label: "Total", n: rows.length, mean: sumOf(rows)});\nconst hidden = [];\nexport const g = () => hidden.length;\nfunction sumOf(xs) { return 0; }\n');
    writeFileSync(join(dir, "page.md"), "# Page\n\n| Average |\n");
    const r = layoutScan(dir);
    assert.ok(r.labels.length >= 2 && r.helpers.length === 1 && r.hidden.length === 1);
    assert.equal(countViolations(r.reads, COUNT_ALLOW).violations.length, 2);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("AC-DB-22 (L26): every layout module computes nothing outside the AC-UX-10 allow-list and has no banned word", () => {
  const {hits} = moduleHits(src);
  for (const m of LAYOUT_LIB) {
    assert.ok(m in hits, `${m} is not scanned`);
    const mine = applyAllowList({[m]: hits[m]}, ALLOW).violations;
    assert.deepEqual(mine, [], m);
    assert.deepEqual(hits[m].filter((h) => h.rule in BANNED_WORDS), [], m);
  }
});

test("AC-DB-30 (L26): no new dependency, layout modules import only relative files, nothing in package.json adds a runtime script source", () => {
  const pkg = JSON.parse(readFileSync(join(site, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies, BASELINE_DEPS);
  assert.deepEqual(pkg.devDependencies, BASELINE_DEV);
  assert.equal(pkg.optionalDependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  for (const f of libFiles()) assert.deepEqual(nonRelativeImports(readFileSync(f, "utf8")), [], `${rel(src, f)} imports a package`);
  for (const f of listFiles(src, (n) => n.endsWith(".md"))) {
    const code = readFileSync(f, "utf8");
    const bad = nonRelativeImports(code).filter((s) => !/^npm:|^observablehq:|^@observablehq\//.test(s));
    assert.deepEqual(bad, [], `${rel(src, f)} imports an unregistered package`);
  }
  assert.deepEqual(nonRelativeImports('import {x} from "lodash"; import("d3-array"); export {y} from "https://cdn.example.org/a.js";').sort(), ["d3-array", "https://cdn.example.org/a.js", "lodash"]);
});

test("AC-DB-30 (L26): the built-output scan fails on an off-origin URL, a remote import, a font file and a font-face in a synthetic dist", () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-l26-dist-"));
  const scanDist = (root) => {
    const hits = [];
    for (const f of listFiles(root, () => true)) {
      const name = rel(root, f);
      if (FONT_FILE(name)) hits.push(`${name}: font file`);
      if (name.startsWith("_file/") || /\.(parquet|wasm|png|ico)$/.test(name)) continue; // same exemptions as tests/smoke/static.smoke.mjs
      for (const x of distFindings(name, readFileSync(f, "utf8"))) hits.push(`${name}: ${x}`);
    }
    return hits;
  };
  try {
    mkdirSync(join(dir, "_file", "data"), {recursive: true});
    mkdirSync(join(dir, "country"), {recursive: true});
    writeFileSync(join(dir, "index.html"), '<a href="./country/DEU">x</a><svg xmlns="http://www.w3.org/2000/svg"></svg>');
    writeFileSync(join(dir, "style.css"), "a{color:var(--mm-fg)}");
    writeFileSync(join(dir, "_file", "data", "m.json"), '{"source_url":"https://data.example.org/x"}'); // attribution text in data is exempt
    assert.deepEqual(scanDist(dir), []);
    writeFileSync(join(dir, "country", "DEU.html"), '<img src="' + 'https://cdn.example.org/a.png">');
    writeFileSync(join(dir, "app.js"), 'fetch("' + '//api.example.org/v1")');
    writeFileSync(join(dir, "style.css"), "@import url(" + "https://fonts.googleapis.com/css);\n@font-" + "face{font-family:X}");
    writeFileSync(join(dir, "Inter.woff2"), "x");
    const hits = scanDist(dir);
    for (const needle of ["country/DEU.html: URL", "app.js: URL", "style.css: remote @import", "style.css: @font-face", "Inter.woff2: font file"]) assert.ok(hits.some((h) => h.startsWith(needle)), `not flagged: ${needle}\n${hits.join("\n")}`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("AC-DB-30 (L26): src/lib modules and pages carry no off-origin URL (every module, by directory walk)", () => {
  const hits = [...libFiles(), ...listFiles(src, (n) => n.endsWith(".md"))].flatMap((f) => distFindings(f, readFileSync(f, "utf8")).map((x) => `${rel(src, f)}: ${x}`));
  assert.deepEqual(hits, []);
});

test("AC-DB-22 (L26): every layout module and page is in the colour and inline-style scan file set and carries no literal", () => {
  const files = listFiles(src, (n) => /\.(js|md)$/.test(n)).map((f) => rel(src, f));
  for (const m of LAYOUT_LIB) {
    assert.ok(files.includes(m), `${m} is not colour-scanned`);
    assert.deepEqual(scan(readFileSync(join(src, m), "utf8")), [], m);
  }
  assert.ok(scan(`export const c = "${"steel" + "blue"}"; // layout`).includes("named colour"));
});

// ------------------------------------------------------------------------------------------ V6 (dashboard v2: AC-V2-44, 50, 90, 91; AC-RD-50, 62; A1.1)
// Modules that existed before the v2 plan. Every other module in src/lib is a v2 module (chart, caption, compatibility, hidden rows, mode, picker ...) and is
// scanned strictly: it computes nothing, has no allow-list entry, and uses none of the statistics below. A new v2 module is covered without being listed.
const PRE_V2 = new Set(["about-value", "attribution", "bar-chart", "bins", "carry", "copy", "country-model", "country-page", "country-view", "domain-page", "domains-list", "explorer-filters", "explorer-view", "explorer", "facts-card", "figure", "filter-bar-options", "filter-bar", "filter-chip", "filter-country", "filter-model", "filter-period", "filter-proof", "filter-store", "glyphs", "hash", "heatmap-card", "heatmap-view", "heatmap", "history", "home-dashboard", "home-lists", "indicator-model", "indicator-view", "kpi-model", "kpi-view", "legend", "manifest", "meta", "missing", "peers-view", "peers", "period", "point-reader", "profile-chart", "rank-model", "rank-view", "rebase", "revisions-view", "revisions", "scorecard-view", "scorecard", "series-card", "series-meta", "shell", "small-multiples", "sort", "stale", "state-blocks", "states", "table-card", "tip", "tokens", "units", "value-chart"]);
const V2_NAMED = ["compare-page", "blocked", "compare-controls", "compare-data", "hatch", "multi-line", "bar-list", "choropleth", "choropleth-model", "scatter", "time-heatmap", "caption", "caption-view", "compat", "hidden-rows", "l1-card", "mode-switch", "peer-strip", "picker", "country-list", "series-chart"]; // the v2 modules that exist now; the scans below fail if one disappears
const v2Modules = (root = src) => readdirSync(join(root, "lib")).filter((n) => n.endsWith(".js")).map((n) => n.slice(0, -3)).filter((n) => !PRE_V2.has(n));

// A statistic by name or by d3: mean, median, quantile, sum, regression, correlation (AC-V2-44, AC-V2-50). Judged on code without strings and comments.
const V2_STATS = /\bd3\s*\.\s*(?:mean|median|quantile|quantileSorted|sum|cumsum|deviation|variance|rank|least|bin|group|rollup|regress\w*|correlat\w*)\b|(?<![\w$])(?:regress|correlat|quantile|median|percentileOf|zscore)\w*\s*\(/;
const v2StatFindings = (file, code) => stripNoise(code).split("\n").flatMap((l, k) => (V2_STATS.test(l) ? [`${file}:${k + 1}: statistic`] : []));
// Math used to compute a rank or a percent (AC-RD-50): any Math call, or a `* 100` / `/ 100` percent form, in a v2 module.
const V2_MATH = /\bMath\s*\.\s*\w+|[\w)\]]\s*[*/]\s*100\b/;
const v2MathFindings = (file, code) => stripNoise(code).split("\n").flatMap((l, k) => (V2_MATH.test(l) ? [`${file}:${k + 1}: Math or percent form`] : []));

test("V6 (AC-RD-50, AC-V2-44, 50): every v2 module computes nothing, has no allow-list entry and no statistic, regression, correlation or Math rank/percent", () => {
  const mods = v2Modules();
  for (const m of V2_NAMED) assert.ok(mods.includes(m), `${m} is not scanned as a v2 module`);
  const {hits} = moduleHits(src);
  for (const m of mods) {
    const f = `lib/${m}.js`;
    assert.deepEqual(hits[f], [], `${f} computes something: ${JSON.stringify(hits[f])}`);
    assert.ok(!ALLOW.some((a) => a.file === f), `${f} must not be allow-listed`);
    const code = readFileSync(join(src, f), "utf8");
    assert.deepEqual([...v2StatFindings(f, code), ...v2MathFindings(f, code)], []);
  }
});

test("V6 seeded negatives: statistic, regression, correlation, Math rank and a percent form each fail in a v2 module", () => {
  for (const s of ["const m = d3.mean(xs);", "const t = d3.sum(xs);", "const q = d3.quantile(xs, 0.5);", "const r = d3.regressionLinear();", "const c = correlation(a, b);", "const k = regress(xs);", "const md = median(xs);", "import {rank} from 'x'; d3.rank(xs);"]) assert.equal(v2StatFindings("lib/new-chart.js", s).length, 1, s);
  for (const s of ["const r = Math.round(x);", "const p = (a / b) * 100;", "const p = a / 100;", "const m = Math.max(...v);"]) assert.equal(v2MathFindings("lib/new-chart.js", s).length, 1, s);
  for (const s of ["const label = 'mean percentile';", "// d3.mean is not used", "const stored = row.value;"]) assert.deepEqual([...v2StatFindings("lib/new-chart.js", s), ...v2MathFindings("lib/new-chart.js", s)], [], s);
  const dir = mkdtempSync(join(tmpdir(), "mm-v6-"));
  try {
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib", "c9-new-chart.js"), "export const f = (xs) => d3.mean(xs);\n");
    assert.deepEqual(v2Modules(dir), ["c9-new-chart"], "a module not in the pre-v2 set is scanned strictly without being listed");
    assert.ok(v2StatFindings("lib/c9-new-chart.js", readFileSync(join(dir, "lib", "c9-new-chart.js"), "utf8")).length > 0);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("V6: the pre-v2 set names only modules that still exist (a rename cannot make a module escape the strict scan)", () => {
  const onDisk = new Set(readdirSync(join(src, "lib")).filter((n) => n.endsWith(".js")).map((n) => n.slice(0, -3)));
  assert.deepEqual([...PRE_V2].filter((n) => !onDisk.has(n)), []);
});

// No module reads `projection/` unless it is an L2 or C1 module (ADR-037 decision 3; plan V6). Phase 1: none is allowed, so any read fails (vacuous while nothing reads it).
const PROJECTION_READERS = []; // L2 and C1 modules are added here by their tasks, with the task id
const projectionFindings = (file, text) => (PROJECTION_READERS.includes(file) ? [] : stripComments(text).split("\n").flatMap((l, k) => (/projection\//.test(l) ? [`${file}:${k + 1}: reads projection/`] : [])));

test("V6: no module or page reads projection/ outside the L2 and C1 modules (none is listed in phase 1)", () => {
  const files = listFiles(src, (n) => /\.(js|md)$/.test(n));
  assert.ok(files.length >= 25);
  assert.deepEqual(files.flatMap((f) => projectionFindings(rel(src, f), readFileSync(f, "utf8"))), []);
  assert.deepEqual(PROJECTION_READERS, [], "phase 1: no projection reader is allowed (ADR-032 is not built)");
});

test("V6 seeded negatives: a projection/ read fails, also in a page and with a template path; a comment does not", () => {
  for (const s of ['fetch("data/projection/M09.json")', "const u = `${base}/projection/${id}.json`;", "import(\"./projection/x.js\")"]) assert.equal(projectionFindings("lib/new-chart.js", s).length, 1, s);
  assert.equal(projectionFindings("indicator/M09.md", 'FileAttachment("projection/M09.json")').length, 1);
  assert.deepEqual(projectionFindings("lib/new-chart.js", "// projection/ is not read here"), []);
  assert.deepEqual(projectionFindings("lib/new-chart.js", "const p = projections;"), []);
});

// AC-V2-91: no chart or compatibility module tests unit_label or unit_text by regex or substring (the title shows unit_label verbatim; compat compares unit_code etc.).
// Judged on code without strings and comments: the field followed by a string/regex method on the same line, or a regex method whose argument is the field.
const UNIT_FIELD = "(?:unit_label|unit_text\\w*|unitLabel|unitText\\w*)";
const UNIT_METHOD = "(?:match|matchAll|test|exec|includes|startsWith|endsWith|indexOf|lastIndexOf|search|replace|replaceAll|split|slice|substring|substr|toLowerCase|toUpperCase)";
const UNIT_PARSE = new RegExp(`\\b${UNIT_FIELD}\\b[^;\\n]*?(?:\\?\\.|\\.)\\s*${UNIT_METHOD}\\s*\\(|\\.\\s*${UNIT_METHOD}\\s*\\([^;\\n]*\\b${UNIT_FIELD}\\b|\\b(?:const|let)\\s+(?:label|\\w+)\\s*=\\s*[^;\\n]*\\b${UNIT_FIELD}\\b[^;\\n]*\\.\\s*${UNIT_METHOD}\\s*\\(`);
// Known pre-v2 finding (reported, not endorsed): the C-RANK mixed-unit rule reads `unit_label` for ", " until CR-5 (`unit_text_varies`) is exported (rank-model.js hasSingleUnit,
// layout amendment 4.7). It is the only exception; a new v2 module cannot use it, and the user decides whether C-RANK is reworked under AC-V2-91.
const UNIT_PARSE_PRE_V2 = [{file: "lib/rank-model.js", contains: "label.includes(", clause: "pre-v2 C-RANK mixed-unit rule (amendment 4.7) until CR-5 exports unit_text_varies; reported to the user, not a v2 module"}];
const unitParseFindings = (file, code) => {
  const lines = stripNoise(code).split("\n");
  // a local alias of the field (`const label = indicator?.unit_label;`) stands for the field in the next ALIAS_WINDOW lines
  const ALIAS_WINDOW = 12;
  const aliasDef = new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=[^;\\n]*\\b${UNIT_FIELD}\\b`);
  const defs = lines.map((l) => aliasDef.exec(l)?.[1] ?? null);
  return lines.flatMap((l, k) => {
    const aliases = defs.slice(Math.max(0, k - ALIAS_WINDOW), k + 1).filter(Boolean);
    const re = aliases.length ? new RegExp(UNIT_PARSE.source.replaceAll(UNIT_FIELD, `(?:${UNIT_FIELD.slice(3, -1)}|${aliases.join("|")})`)) : UNIT_PARSE;
    return re.test(l) ? [{file, line: k + 1, text: l.trim()}] : [];
  });
};

test("V6 (AC-V2-91): no module tests unit_label or unit_text by regex or substring, apart from the one reported pre-v2 C-RANK line", () => {
  const hits = libFiles().flatMap((f) => unitParseFindings(rel(src, f), readFileSync(f, "utf8")));
  const open = hits.filter((h) => !UNIT_PARSE_PRE_V2.some((a) => a.file === h.file && h.text.includes(a.contains)));
  assert.deepEqual(open.map((h) => `${h.file}:${h.line}: ${h.text}`), []);
  assert.equal(hits.filter((h) => UNIT_PARSE_PRE_V2.some((a) => a.file === h.file)).length, UNIT_PARSE_PRE_V2.length, "the pre-v2 exception still matches (remove it when the line is gone)");
  for (const m of [...V2_NAMED, ...v2Modules()]) assert.deepEqual(unitParseFindings(`lib/${m}.js`, readFileSync(join(src, "lib", `${m}.js`), "utf8")), [], `${m} parses a unit text`);
});

test("V6 seeded negatives (AC-V2-91): substring, regex and split on unit_label or unit_text fail; verbatim use and unit_code tests do not", () => {
  for (const s of ["const multi = ind.unit_label.includes(', ');", "const ok = /index/i.test(ind.unit_label);", "const p = indicator?.unit_label?.split(',');", "const m = series.unit_text.match(/(\\d+)/);", "const t = unitLabel.toLowerCase().startsWith('i');", "const x = String(s.unit_label).replace('%', '');", "const label = ind.unit_label;\nconst multi = !label.includes(', ');", "if (label.startsWith('x') && ind.unit_label) {}".replace("label.startsWith('x') && ", "") + " const m = /a/.exec(ind.unit_label);"]) {
    assert.ok(unitParseFindings("lib/new-chart.js", s).length > 0, s);
  }
  for (const s of ["const t = `${name} (${ind.unit_label})`;", "const u = ind.unit_label ?? null;", "const same = a.unit_code === b.unit_code;", "const m = unitCode.includes('EUR');", "const label = present(i.unit_label) ? i.unit_label : null;"]) {
    assert.deepEqual(unitParseFindings("lib/new-chart.js", s), [], s);
  }
});

// A1.1: the hatch pattern is reserved for blank cells; stale rows use a dashed outline plus the text code, and stale series a square last-point marker. No v2 code or rule hatches "stale".
// Pre-v2 state signature of the heatmap/scorecard cells (ADR-025 state glyphs), listed so that a NEW use fails.
const HATCH_STALE_PRE_V2 = [{file: "lib/states.js", contains: 'stale: row(STATE_CODES.stale, "hatch-clock"'}];
// A hatch hit is a hatch/pattern line with a "stale" mention on the same line or within one line either side (a 3-line window), so a pattern fill
// split over two lines (`const fill = row.is_stale` then `? "url(#hatch)"`) is still caught. The listed pre-v2 line is exempt as hatch and as stale.
const HATCH_RE = /hatch|repeating-(?:linear|radial|conic)-gradient|<pattern\b|patternUnits/i;
const hatchStale = (file, code) => {
  const lines = stripComments(code).split("\n");
  const exempt = lines.map((l) => HATCH_STALE_PRE_V2.some((a) => a.file === file && l.includes(a.contains)));
  const stale = lines.map((l, k) => !exempt[k] && /stale/i.test(l));
  return lines.flatMap((l, k) => (!exempt[k] && HATCH_RE.test(l) && [k - 1, k, k + 1].some((j) => stale[j]) ? [`${file}:${k + 1}: hatch used with stale`] : []));
};
// Pre-v2 CSS rules for `data-state="stale"` cells of the heatmap, scorecard and KPI tiles (ADR-025 state glyphs). They predate A1.1 and are listed so that a NEW one fails.
const STALE_CSS_PRE_V2 = ['td[data-state="stale"] .mm-cell, .mm-key[data-state="stale"]', '.mm-tile-pct[data-state="stale"] .mm-cell'];
const staleCssFindings = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, sel, body]) => (/stale/i.test(sel) && /repeating-(?:linear|radial|conic)-gradient|hatch|url\(\s*#|pattern/i.test(body) && !STALE_CSS_PRE_V2.includes(sel.trim()) ? [`${sel.trim()}: hatch on stale`] : []));

test("V6 (A1.1): no v2 module and no new CSS rule uses the hatch pattern for stale", () => {
  const files = listFiles(src, (n) => /\.(js|md)$/.test(n));
  assert.deepEqual(files.flatMap((f) => hatchStale(rel(src, f), readFileSync(f, "utf8"))), []);
  assert.deepEqual(staleCssFindings(readFileSync(join(src, "style.css"), "utf8")), []);
  assert.ok(readFileSync(join(src, "lib", "states.js"), "utf8").includes(HATCH_STALE_PRE_V2[0].contains), "pre-v2 JS exception no longer matches");
  const legacy = readFileSync(join(src, "style.css"), "utf8");
  for (const sel of STALE_CSS_PRE_V2) assert.ok(legacy.includes(sel), `pre-v2 exception no longer matches: ${sel}`);
});

test("V6 seeded negatives (A1.1): hatch on stale fails in a module and in a new rule; blank-cell hatch passes", () => {
  assert.equal(hatchStale("lib/new-chart.js", 'const fill = row.is_stale ? "url(#hatch)" : null;').length, 1);
  assert.equal(hatchStale("lib/new-chart.js", "const stale = cell.stale && patternUnits;").length, 1);
  assert.equal(hatchStale("lib/new-chart.js", 'const fill = row.is_stale\n  ? "url(#hatch)"\n  : null;').length, 1, "two-line form: stale on the line above the hatch");
  assert.equal(hatchStale("lib/new-chart.js", 'const pat = "url(#hatch)";\nconst use = cell.stale ? pat : null;').length, 1, "two-line form: stale on the line below the hatch");
  assert.equal(hatchStale("lib/new-chart.js", 'const pat = "url(#hatch)";\nconst a = 1;\nconst b = 2;\nconst use = cell.stale ? 1 : null;').length, 0, "outside the 3-line window");
  assert.equal(hatchStale("lib/states.js", 'stale: row(STATE_CODES.stale, "hatch-clock", "clock"),').length, 0, "listed pre-v2 signature");
  assert.equal(hatchStale("lib/new-states.js", 'stale: row(STATE_CODES.stale, "hatch-clock", "clock"),').length, 1, "the exception is bound to states.js");
  assert.deepEqual(hatchStale("lib/new-chart.js", 'const fill = cell.blank ? "url(#hatch)" : null;'), []);
  assert.equal(staleCssFindings('.mm-c4 [data-stale="1"] { background: repeating-linear-gradient(45deg, #000 0 1px, #fff 1px 2px); }').length, 1);
  assert.equal(staleCssFindings('.mm-c4 td[data-stale="1"] { outline: 2px dashed currentColor; }').length, 0);
  assert.equal(staleCssFindings('.mm-c4 td[data-blank="1"] { background: repeating-linear-gradient(45deg, transparent 0 4px, currentColor 4px 5px); }').length, 0);
  assert.equal(staleCssFindings('.mm-tile-pct[data-state="stale"] .mm-cell { background: repeating-linear-gradient(135deg, transparent 0 5px, var(--mm-border) 5px 6px); }').length, 0, "listed pre-v2 rule");
});
