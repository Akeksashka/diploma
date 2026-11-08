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
