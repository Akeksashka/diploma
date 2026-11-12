// T102 static scan: no inline <style> and no colour literal in src/lib/*.js or the page .md files.
// The rules live in tests/support/static-scan.mjs (shared with ux-static.test.mjs, T106, which widens the file set).
// Patterns are assembled from parts so the support file does not match its own scan (and it is not scanned).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {listFiles, scan} from "./support/static-scan.mjs";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("src/lib/*.js and page .md carry no inline style or colour literal", () => {
  const hits = [];
  for (const f of listFiles(src, (n) => /\.(js|md)$/.test(n))) for (const rule of scan(readFileSync(f, "utf8"))) hits.push(`${f}: ${rule}`);
  assert.deepEqual(hits, []);
});

test("the scan flags each seeded violation", () => {
  const seeded = {
    "style element": "<" + "style>a{}</" + "style>",
    "style attribute": '<p style' + '="x">',
    "hex colour": "fill: " + "#" + "b91c1c",
    "functional colour": "x: rg" + "b(1,2,3)",
    "named colour": 'fill: "steel' + 'blue"'
  };
  for (const [rule, text] of Object.entries(seeded)) assert.ok(scan(text).includes(rule), rule);
  assert.deepEqual(scan("var(--mm-pct-4) currentColor"), []);
});

// R5 (AC-RD-50, AC-RD-62 support): the redesign modules are named here so that dropping one from the scan file set fails.
const NEW_MODULES = ["hash", "period", "units", "sort", "missing", "copy", "country-view", "profile-chart", "indicator-view", "value-chart"].map((n) => `lib/${n}.js`);

test("R5: the redesign modules are in the colour/inline-style file set and carry no literal", () => {
  const files = listFiles(src, (n) => /\.(js|md)$/.test(n)).map((f) => f.slice(src.length + 1));
  for (const m of NEW_MODULES) assert.ok(files.includes(m), `${m} is not scanned`);
  for (const m of NEW_MODULES) assert.deepEqual(scan(readFileSync(join(src, m), "utf8")), [], m);
});

test("R5: a seeded literal in a redesign module is flagged", () => {
  for (const m of NEW_MODULES) assert.ok(scan(`export const x = "${"steel" + "blue"}"; // ${m}`).includes("named colour"), m);
});

// L2 (ADR-034, amendment section 3): the layout surface in style.css.
const css = () => readFileSync(join(src, "style.css"), "utf8");
const l2Block = () => css().slice(css().indexOf("/* L2 (ADR-034"));

test("L2: tokens exist for both themes", () => {
  const c = css();
  const dark = c.slice(c.indexOf("prefers-color-scheme: dark"));
  for (const t of ["--mm-canvas", "--mm-card", "--mm-card-border", "--mm-band-bg", "--mm-band-ink"]) {
    assert.match(c, new RegExp(`${t}:`), `${t} light`);
    assert.match(dark, new RegExp(`${t}:`), `${t} dark`);
  }
  assert.match(c, /--mm-tile-number-size: 2rem;/);
});
test("L2: grid breakpoints 12 / 6 / 1 columns at 64 rem / 40 rem, span classes, band, forced colours, no nesting rule needed", () => {
  const b = l2Block();
  assert.match(b, /\.mm-grid \{[^}]*repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(b, /max-width: 63\.99rem\) \{\s*\.mm-grid \{[^}]*repeat\(6,/);
  assert.match(b, /max-width: 39\.99rem\) \{\s*\.mm-grid \{[^}]*minmax\(0, 1fr\);/);
  for (const n of [3, 4, 6, 8, 12]) assert.match(b, new RegExp(`\\.mm-card--span-${n} \\{ grid-column: span ${n}; \\}`));
  assert.match(b, /\.mm-band h2/);
  assert.match(b, /forced-colors: active\) \{[^}]*\.mm-card[^}]*border: 1px solid CanvasText/);
});
test("L2: no colour literal and no transition or animation in the layout block (colours come from tokens)", () => {
  const b = l2Block().replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual(scan(b), []);
  assert.doesNotMatch(b, /transition|animation/);
});
test("L2: a seeded hex colour in the layout block is flagged", () => {
  assert.ok(scan(`${l2Block()}\n.mm-card { background: ${"#"}fff; }`).length > 0);
});

test("L10 filter bar CSS: sticky slot, reserve per breakpoint, offsets equal the bar height, compact below 40rem, print line, forced colors", () => {
  const css = readFileSync(join(src, "style.css"), "utf8");
  assert.match(css, /\.mm-filterbar-slot \{[^}]*position: sticky; top: 0;[^}]*min-height: var\(--fbar-reserve/);
  for (const w of ["79.99", "72.99", "52.99", "45.99", "39.99"]) assert.ok(css.includes(`@media (max-width: ${w}rem) { :root:has(#filterbar-slot) { --fbar-reserve:`), `reserve at ${w}rem`);
  assert.match(css, /:root:has\(#filterbar-slot\) \{ scroll-padding-top: var\(--fbar-h\); \}/);
  assert.match(css, /scroll-margin-top: var\(--fbar-h\)/);
  assert.match(css, /thead th \{ top: var\(--fbar-h, 0px\); \}/);
  assert.match(css, /@media print \{ \.mm-filterbar-slot, \.mm-filterbar \{ display: none; \} \.mm-print-filters \{ display: block;/);
  assert.match(css, /@media \(forced-colors: active\) \{ \.mm-filterbar, \.mm-filterbar-chip/);
  assert.match(css, /@media \(scripting: none\) \{ :root:has\(#filterbar-slot\) \{ --fbar-reserve: 0px;/);
});

// L26 (AC-DB-22 colour part, AC-UX-3): the layout modules are named so that removing one from the scan set fails, and style.css
// may hold a colour literal only as the value of a custom property (a token), never in a normal declaration.
const LAYOUT_MODULES = ["bar-chart", "carry", "country-page", "domain-page", "explorer-filters", "facts-card", "filter-bar-options", "filter-bar", "filter-chip", "filter-country", "filter-model", "filter-period", "filter-proof", "filter-store", "heatmap-card", "home-dashboard", "kpi-model", "kpi-view", "rank-model", "rank-view", "series-card", "small-multiples", "table-card"].map((n) => `lib/${n}.js`);

test("L26: the layout modules are in the colour/inline-style file set and carry no literal", () => {
  const files = listFiles(src, (n) => /\.(js|md)$/.test(n)).map((f) => f.slice(src.length + 1));
  for (const m of LAYOUT_MODULES) assert.ok(files.includes(m), `${m} is not scanned`);
  for (const m of LAYOUT_MODULES) assert.deepEqual(scan(readFileSync(join(src, m), "utf8")), [], m);
  for (const m of LAYOUT_MODULES) assert.ok(scan(`export const x = "${"steel" + "blue"}"; // ${m}`).includes("named colour"), m);
  for (const f of files) if (/^lib\//.test(f)) assert.deepEqual(scan(readFileSync(join(src, f), "utf8")), [], `${f} (directory walk)`);
});

// Declarations of style.css that are not custom-property definitions and hold a colour literal.
function cssLiteralOutsideTokens(text) {
  const out = [];
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const decl of body.split(";")) {
      const d = decl.trim();
      if (!d || /^--[\w-]+\s*:/.test(d)) continue;
      const rules = scan(d);
      if (rules.length) out.push(`${sel.trim().slice(0, 40)} { ${d.slice(0, 60)} }: ${rules.join(", ")}`);
    }
  }
  return out;
}

test("L26: style.css holds colour literals only as token values (custom properties)", () => {
  const text = readFileSync(join(src, "style.css"), "utf8");
  assert.deepEqual(cssLiteralOutsideTokens(text), []);
  assert.ok(/--mm-card:\s*#|--mm-card:\s*(?:rgb|hsl|oklch|var)/.test(text) || /--mm-card:/.test(text), "the card token exists");
});

test("L26: a seeded literal in a normal declaration of a stylesheet fails, a token definition does not", () => {
  assert.deepEqual(cssLiteralOutsideTokens(":root { --mm-x: " + "#" + "fff; }"), []);
  assert.equal(cssLiteralOutsideTokens(".mm-card { background: " + "#" + "fff; }").length, 1);
  assert.equal(cssLiteralOutsideTokens(".mm-card { border: 1px solid " + "rg" + "b(0,0,0); }").length, 1);
  assert.equal(cssLiteralOutsideTokens("@media print { .mm-band { color: " + "navy" + "; } }").length, 1);
  assert.deepEqual(cssLiteralOutsideTokens(".mm-card { background: var(--mm-card); border: 1px solid CanvasText; }"), []);
});
