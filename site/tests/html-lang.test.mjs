// V43 (AC-V2-101): <html lang> per tree. Unit cases on strings and temp trees; built-output cases run when the trees exist
// (MM_LANG_DIST / MM_LANG_DIST_UK override the folders; MM_REQUIRE_DIST=1 turns the skip into a failure).
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {htmlFiles, setLangInHtml, setTreeLang} from "../scripts/set-html-lang.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("a bare <html> gets the lang", () => {
  assert.equal(setLangInHtml("<!DOCTYPE html>\n<html>\n<head>", "uk"), '<!DOCTYPE html>\n<html lang="uk">\n<head>');
});
test("an existing lang is replaced and other attributes kept; second run changes nothing", () => {
  const once = setLangInHtml('<html class="x" lang="en" data-a="1"><body>', "uk");
  assert.equal(once, '<html lang="uk" class="x" data-a="1"><body>');
  assert.equal(setLangInHtml(once, "uk"), once);
});
test("no <html tag fails loudly", () => {
  assert.throws(() => setLangInHtml("<div></div>", "en", "x.html"), /x\.html: no <html> tag/);
});
test("an invalid language fails", () => {
  const d = mkdtempSync(join(tmpdir(), "mm-lang-"));
  writeFileSync(join(d, "a.html"), "<html></html>");
  assert.throws(() => setTreeLang(d, "de"), /MM_LANG/);
});
test("setTreeLang covers nested files, fails on a file without <html, and the English pass skips a merged uk/ tree", () => {
  const d = mkdtempSync(join(tmpdir(), "mm-lang-"));
  mkdirSync(join(d, "country"), {recursive: true});
  mkdirSync(join(d, "uk"), {recursive: true});
  writeFileSync(join(d, "index.html"), "<html></html>");
  writeFileSync(join(d, "country", "a.html"), "<html></html>");
  writeFileSync(join(d, "uk", "index.html"), '<html lang="uk"></html>');
  assert.equal(setTreeLang(d, "en"), 2);
  assert.match(readFileSync(join(d, "country", "a.html"), "utf8"), /<html lang="en">/);
  assert.match(readFileSync(join(d, "uk", "index.html"), "utf8"), /<html lang="uk">/);
  writeFileSync(join(d, "country", "bad.html"), "<p>x</p>");
  assert.throws(() => setTreeLang(d, "en"), /bad\.html/);
});

const enDir = resolve(process.env.MM_LANG_DIST ?? join(root, "dist"));
const ukDir = resolve(process.env.MM_LANG_DIST_UK ?? join(root, "dist-uk"));
const siteDir = resolve(process.env.MM_LANG_DIST_SITE ?? join(root, "dist-site"));
const requireDist = process.env.MM_REQUIRE_DIST === "1";
const builtEn = existsSync(join(enDir, "index.html"));
const builtUk = existsSync(join(ukDir, "index.html"));
const lang = (f) => /<html([^>]*)>/i.exec(readFileSync(f, "utf8"))?.[1].match(/\blang="([^"]*)"/)?.[1];

describe("built trees (needs npm run build:all)", () => {
  test("every English page has lang=en", {skip: builtEn || requireDist ? false : "no built English tree"}, () => {
    const files = htmlFiles(enDir, ["uk"]);
    assert.ok(files.length > 0);
    for (const f of files) assert.equal(lang(f), "en", f);
  });
  test("every Ukrainian page has lang=uk", {skip: builtUk || requireDist ? false : "no built Ukrainian tree"}, () => {
    const files = htmlFiles(ukDir);
    assert.ok(files.length > 0);
    for (const f of files) assert.equal(lang(f), "uk", f);
  });
  test("merged tree: uk/ pages have lang=uk and the rest lang=en", {skip: existsSync(join(siteDir, "uk", "index.html")) ? false : "no merged tree (dist-site)"}, () => {
    for (const f of htmlFiles(join(siteDir, "uk"))) assert.equal(lang(f), "uk", f);
    for (const f of htmlFiles(siteDir, ["uk"])) assert.equal(lang(f), "en", f);
  });
});
