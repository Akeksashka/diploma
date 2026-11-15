// V44 (AC-V2-100, 102, 106, 108; G-LANG-STR): dictionary structure, key parity per language, plural categories, placeholders, the review gate (no `reviewed`
// flag may be set by an agent) and the names tables against the export meta of the fixture.
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync, readFileSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {PLURAL_CATEGORIES, placeholders} from "../src/lib/i18n.js";
import {buildReport, exportNameKeys} from "../scripts/i18n-report.mjs";
import {dictionariesSource} from "../scripts/prepare-i18n.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (n) => JSON.parse(readFileSync(join(root, "src", "i18n", n), "utf8"));
const en = read("en.json");
const uk = read("uk.json");
const names = read("names.uk.json");
const metaDir = join(root, "tests", "fixtures", "v2_export", "meta");
const split = (k) => (k.includes("#") ? k.split("#") : [k, null]);
const bases = (d) => new Set(Object.keys(d).map((k) => split(k)[0]));
const categories = (d, base) => Object.keys(d).filter((k) => split(k)[0] === base && k.includes("#")).map((k) => split(k)[1]);

test("English and Ukrainian dictionaries have the same keys (plural groups by base key)", () => {
  assert.deepEqual([...bases(uk)].sort(), [...bases(en)].sort());
});

test("plural groups carry every CLDR category required for the language, and only those", () => {
  for (const [lang, d] of [["en", en], ["uk", uk]]) {
    for (const base of bases(d)) {
      const cats = categories(d, base);
      if (cats.length === 0) continue;
      assert.deepEqual([...cats].sort(), [...PLURAL_CATEGORIES[lang]].sort(), `${lang}: ${base}`);
    }
  }
  // a base key that is plural in one language is plural in the other
  for (const base of bases(en)) assert.equal(categories(en, base).length > 0, categories(uk, base).length > 0, base);
});

test("every entry has the shape {t, status, reviewed_on}; English carries only {t}; Ukrainian placeholders equal the English ones per key", () => {
  for (const [k, e] of Object.entries(en)) {
    assert.deepEqual(Object.keys(e), ["t"], k);
    assert.equal(typeof e.t, "string", k);
  }
  for (const [k, e] of Object.entries(uk)) {
    assert.deepEqual(Object.keys(e).sort(), ["reviewed_on", "status", "t"], k);
    assert.equal(typeof e.t, "string", k);
    assert.ok(["proposed", "reviewed"].includes(e.status), `${k}: status ${e.status}`);
    const twin = en[k] ?? en[`${split(k)[0]}#other`];
    assert.ok(twin, `${k}: no English twin`);
    const need = placeholders(twin.t);
    // a plural entry may spell the number itself (en "1 row"): its placeholders must then be a subset of the English `other` form
    for (const p of placeholders(e.t)) assert.ok(placeholders(en[`${split(k)[0]}#other`]?.t ?? twin.t).includes(p), `${k}: unknown placeholder {${p}}`);
    if (!k.includes("#")) assert.deepEqual(placeholders(e.t).sort(), need.sort(), k);
  }
});

test("G-LANG-STR: no entry is `reviewed` (only the user, or a reviewer the user names, sets it), no reviewed_on date is set, and no Ukrainian entry is empty", () => {
  for (const [k, e] of Object.entries(uk)) {
    assert.equal(e.status, "proposed", `${k} must stay proposed`);
    assert.equal(e.reviewed_on, null, k);
    assert.notEqual(e.t.trim(), "", k);
  }
  for (const [section, table] of Object.entries(names)) for (const [id, e] of Object.entries(table)) assert.notEqual(e.status, "reviewed", `${section}.${id} must not be reviewed by an agent`);
});

test("the Ukrainian dictionary carries Cyrillic text and the quarter label form is not decided here", () => {
  const letters = Object.values(uk).filter((e) => /[А-Яа-яІіЇїЄєҐґ]/.test(e.t)).length;
  assert.ok(letters > Object.keys(uk).length * 0.9, `only ${letters} of ${Object.keys(uk).length} entries contain Cyrillic`);
});

test("names.uk.json has the four sections and no key unknown to the export meta (fixture)", () => {
  assert.deepEqual(Object.keys(names).sort(), ["domains", "entities", "indicators", "sources"]);
  const known = exportNameKeys(metaDir);
  for (const section of Object.keys(names)) {
    for (const id of Object.keys(names[section])) assert.ok(known[section].includes(id), `names.${section}.${id} is not in the export meta`);
  }
});

test("src/i18n/dictionaries.js is the generated copy of the JSON files (Framework cannot bundle JSON imports)", () => {
  assert.equal(readFileSync(join(root, "src", "i18n", "dictionaries.js"), "utf8"), dictionariesSource());
});

test("i18n-report lists every non-reviewed UI string and every export name lacking a reviewed Ukrainian name (AC-V2-108)", () => {
  const keys = exportNameKeys(metaDir);
  const r = buildReport({en, uk, names, keys});
  assert.equal(r.summary.ui_fallbacks, Object.keys(en).length, "every Ukrainian entry is proposed, so every UI string falls back");
  for (const section of Object.keys(keys)) {
    assert.ok(keys[section].length > 0, `fixture has ${section}`);
    assert.deepEqual(r.missing_names[section].map((m) => m.id).sort(), [...keys[section]].sort());
    assert.equal(r.fallbacks.filter((f) => f.kind === `name:${section}`).length, keys[section].length);
  }
  // a reviewed entry (synthetic, only in this test) is not listed
  const one = Object.keys(en)[0];
  const r2 = buildReport({en, uk: {...uk, [one]: {t: "x", status: "reviewed", reviewed_on: "2026-01-01"}}, names: {domains: {labour: {t: "Праця", status: "reviewed", reviewed_on: "2026-01-01"}}}, keys});
  assert.ok(!r2.fallbacks.some((f) => f.kind === "ui" && f.key === one));
  assert.ok(!r2.missing_names.domains.some((m) => m.id === "labour"));
});

// AC-V2-102: no raw dictionary key, no `undefined` and no {placeholder} in the visible text of either built tree (needs a build; MM_REQUIRE_DIST=1 forbids the skip).
const trees = [["en", join(root, "dist")], ["uk", join(root, "dist-uk")]];
const built = trees.every(([, d]) => existsSync(join(d, "index.html")));
if (process.env.MM_REQUIRE_DIST === "1" && !built) throw new Error("MM_REQUIRE_DIST=1 but dist or dist-uk is missing");
const htmlIn = (d, rel = "") => readdirSync(join(d, rel), {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? (e.name.startsWith("_") ? [] : htmlIn(d, join(rel, e.name))) : e.name.endsWith(".html") ? [join(d, rel, e.name)] : []));
test("AC-V2-102: no raw key, `undefined` or {placeholder} in the visible text of either built tree", {skip: built ? false : "no built trees (run npm run build:all with the fixture export)"}, () => {
  const rawKeys = Object.keys(en).filter((k) => /^[A-Z][A-Z0-9_]{5,}/.test(k)).map((k) => split(k)[0]);
  for (const [lang, d] of trees) {
    for (const f of htmlIn(d)) {
      const text = readFileSync(f, "utf8").replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
      assert.ok(!/\bundefined\b/.test(text), `${lang} ${f}: undefined`);
      assert.ok(!/\{\w+\}/.test(text), `${lang} ${f}: placeholder pattern`);
      for (const k of rawKeys) assert.ok(!new RegExp(`\\b${k}\\b`).test(text), `${lang} ${f}: raw key ${k}`);
    }
  }
});
