// V44 (AC-V2-106, G-LANG-STR): the production gate. A Ukrainian entry renders only when `reviewed`; otherwise the English text renders inside an element with
// lang="en". MM_SHOW_PROPOSED (preview) renders `proposed` entries with a visible marker. All dictionaries below are synthetic: the tests never mark a real
// entry reviewed.
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {PROPOSED_MARK, makeI18n} from "../src/lib/i18n.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dicts = {
  en: {HELLO: {t: "Hello"}, GREET: {t: "Hello, {name}"}, ROWS_HIDDEN: {t: "x"}, "ROWS#one": {t: "{n} row"}, "ROWS#other": {t: "{n} rows"}, ONLY_EN: {t: "Only English"}},
  uk: {
    HELLO: {t: "Привіт", status: "proposed", reviewed_on: null},
    GREET: {t: "Привіт, {name}", status: "reviewed", reviewed_on: "2026-01-01"},
    "ROWS#one": {t: "{n} рядок", status: "reviewed", reviewed_on: "2026-01-01"},
    "ROWS#few": {t: "{n} рядки", status: "reviewed", reviewed_on: "2026-01-01"},
    "ROWS#many": {t: "{n} рядків", status: "reviewed", reviewed_on: "2026-01-01"},
    "ROWS#other": {t: "{n} рядка", status: "proposed", reviewed_on: null}
  }
};

test("English build renders the English dictionary, no wrapper", () => {
  const i = makeI18n({lang: "en", dicts});
  assert.equal(i.t("GREET", {name: "A"}), "Hello, A");
  assert.equal(i.renderHtml("HELLO"), "Hello");
  assert.equal(i.fallbacks().size, 0);
});

test("production Ukrainian build: a proposed entry renders English inside an element with lang=\"en\"; a reviewed one renders Ukrainian without wrapper", () => {
  const i = makeI18n({lang: "uk", showProposed: false, dicts});
  assert.equal(i.t("HELLO"), "Hello");
  assert.equal(i.renderHtml("HELLO"), '<span lang="en">Hello</span>');
  assert.equal(i.renderHtml("GREET", {name: "<b>"}), "Привіт, &lt;b&gt;");
  assert.equal(i.renderHtml("ONLY_EN"), '<span lang="en">Only English</span>', "a missing Ukrainian entry falls back too");
  assert.deepEqual([...i.fallbacks()].sort(), [["HELLO", "not_reviewed"], ["ONLY_EN", "missing"]]);
});

test("MM_SHOW_PROPOSED preview renders a proposed entry with a visible marker, still never a reviewed flag", () => {
  const i = makeI18n({lang: "uk", showProposed: true, dicts});
  assert.equal(i.t("HELLO"), `${PROPOSED_MARK}Привіт`);
  assert.equal(i.renderHtml("HELLO"), `${PROPOSED_MARK}Привіт`);
  assert.equal(i.resolve("HELLO").marked, true);
  assert.equal(i.resolve("GREET").marked, false);
});

test("plural templates use the CLDR category of the rendering language; a non-reviewed category falls back to the English form of the English category", () => {
  const prod = makeI18n({lang: "uk", dicts});
  assert.equal(prod.tp("ROWS", 1), "1 рядок");
  assert.equal(prod.tp("ROWS", 21), "21 рядок");
  assert.equal(prod.tp("ROWS", 22), "22 рядки");
  assert.equal(prod.tp("ROWS", 25), "25 рядків");
  assert.equal(prod.tp("ROWS", 1.5), "1.5 rows", "uk `other` is only proposed: English plural rule and text");
  const en = makeI18n({lang: "en", dicts});
  assert.equal(en.tp("ROWS", 1), "1 row");
  assert.equal(en.tp("ROWS", 0), "0 rows");
});

test("a template parameter that is not supplied is an error, not the text 'undefined'", () => {
  assert.throws(() => makeI18n({lang: "en", dicts}).t("GREET", {}), /needs parameter \{name\}/);
  assert.throws(() => makeI18n({lang: "en", dicts}).t("NOPE"), /unknown key/);
});

test("the shipped dictionaries in a production Ukrainian build render English for every entry (all are proposed)", async () => {
  const {dictionaries} = await import("../src/i18n/dictionaries.js");
  const i = makeI18n({lang: "uk", showProposed: false, dicts: dictionaries});
  for (const key of Object.keys(dictionaries.en).filter((k) => !k.includes("#"))) {
    const r = i.resolve(key);
    assert.equal(r.lang, "en", key);
    assert.equal(r.text, dictionaries.en[key].t, key);
  }
  assert.match(i.renderHtml("CAVEAT"), /^<span lang="en">Percentiles/);
});

// The Ukrainian judgement-word list is the user's to supply (G-LANG-STR). Drop it at tests/support/uk-judgement-words.json as a JSON array of words
// to enable this test; until then it is skipped on purpose and the Ukrainian text is not scanned for judgement words.
const listPath = join(root, "tests", "support", "uk-judgement-words.json");
test("Ukrainian judgement words: no Ukrainian dictionary text contains a word of the user's list", {skip: existsSync(listPath) ? false : "SKIPPED: the user has not supplied the Ukrainian judgement-word list (G-LANG-STR); add tests/support/uk-judgement-words.json to enable"}, () => {
  const words = JSON.parse(readFileSync(listPath, "utf8"));
  assert.ok(Array.isArray(words) && words.length > 0 && words.every((w) => typeof w === "string"), "the list must be a non-empty JSON array of strings");
  const uk = JSON.parse(readFileSync(join(root, "src", "i18n", "uk.json"), "utf8"));
  const hits = [];
  for (const [k, e] of Object.entries(uk)) for (const w of words) if (new RegExp(`(^|[^\\p{L}])${w}`, "iu").test(e.t)) hits.push(`${k}: ${w}`);
  assert.deepEqual(hits, []);
});
