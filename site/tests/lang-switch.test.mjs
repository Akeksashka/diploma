// V46 (AC-V2-103, 107): the language switch. Unit cases on the helper and the header, plus checks on the built trees (skipped without a build;
// MM_REQUIRE_DIST=1 forbids the skip): one switch per page, outside the nav landmark, lang/hreflang set, target page exists in the other tree.
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync, readFileSync, readdirSync} from "node:fs";
import {dirname, join, posix, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {langSwitchHtml, otherLang, treeHref} from "../src/lib/lang-switch.js";
import {headerHtml} from "../src/lib/shell.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = [{name: "Home", path: "/"}, {name: "Country", path: "/country"}];

test("treeHref writes a page-relative path that leaves or enters /uk/", () => {
  assert.equal(treeHref("/", "en", "uk"), "./uk/");
  assert.equal(treeHref("/index", "en", "uk"), "./uk/");
  assert.equal(treeHref("/country", "en", "uk"), "./uk/country");
  assert.equal(treeHref("/country/PL", "en", "uk"), "../uk/country/PL");
  assert.equal(treeHref("/", "uk", "en"), "../");
  assert.equal(treeHref("/country", "uk", "en"), "../country");
  assert.equal(treeHref("/country/PL", "uk", "en"), "../../country/PL");
  assert.equal(treeHref("/domain/labour/", "uk", "en"), "../../domain/labour");
  assert.equal(otherLang("en"), "uk");
  assert.equal(otherLang("uk"), "en");
});

test("the switch names the other language in its own language and carries lang, hreflang and the hash opt-in", () => {
  assert.match(langSwitchHtml({path: "/", lang: "en"}), />Українська<\/a>$/);
  assert.match(langSwitchHtml({path: "/", lang: "en"}), /lang="uk" hreflang="uk" data-carry>/);
  assert.match(langSwitchHtml({path: "/", lang: "uk"}), /lang="en" hreflang="en" data-carry>English<\/a>$/);
  assert.ok(!/ href="[^"]*#/.test(langSwitchHtml({path: "/country/PL", lang: "en"})), "no hash in the static HTML (works without JavaScript, lands without hash)");
});

test("the header holds the switch after the nav landmark, never inside it, and the nav keeps its pages", () => {
  for (const lang of ["en", "uk"]) {
    const h = headerHtml({title: "T", pages, path: "/country", lang});
    const nav = h.slice(h.indexOf("<nav"), h.indexOf("</nav>") + 6);
    assert.ok(!nav.includes("mm-lang") && !/hreflang/.test(nav));
    assert.equal((nav.match(/<li>/g) ?? []).length, pages.length);
    assert.ok(h.indexOf("</nav>") < h.indexOf("mm-lang"));
    assert.equal((h.match(/class="mm-lang"/g) ?? []).length, 1);
  }
});

test("a header built without a language is the English one", () => {
  assert.match(headerHtml({title: "T", pages, path: "/"}), /hreflang="uk"/);
});

const trees = {en: join(root, "dist"), uk: join(root, "dist-uk")};
const built = existsSync(join(trees.en, "index.html")) && existsSync(join(trees.uk, "index.html"));
if (process.env.MM_REQUIRE_DIST === "1" && !built) throw new Error("MM_REQUIRE_DIST=1 but dist or dist-uk is missing");
const htmlIn = (d, rel = "") => readdirSync(join(d, rel), {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? (e.name.startsWith("_") ? [] : htmlIn(d, join(rel, e.name))) : e.name.endsWith(".html") ? [join(rel, e.name)] : []));
const pageUrl = (lang, rel) => posix.join(lang === "uk" ? "/uk/" : "/", rel.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, ""));

test("AC-V2-103: every built page has one switch outside the nav, with lang and hreflang, and its target exists in the other tree", {skip: built ? false : "no built trees (run npm run build:all with the fixture export)"}, () => {
  for (const lang of ["en", "uk"]) {
    const other = otherLang(lang);
    const otherPages = new Set(htmlIn(trees[other]).map((r) => pageUrl(other, r)));
    for (const rel of htmlIn(trees[lang])) {
      const html = readFileSync(join(trees[lang], rel), "utf8");
      const m = [...html.matchAll(/<a class="mm-lang"[^>]*>/g)];
      assert.equal(m.length, 1, `${lang}/${rel}: one switch`);
      const tag = m[0][0];
      assert.ok(tag.includes(`lang="${other}"`) && tag.includes(`hreflang="${other}"`), `${lang}/${rel}: lang/hreflang`);
      const nav = html.slice(html.indexOf('<nav class="mm-nav"'), html.indexOf("</nav>"));
      assert.ok(!nav.includes("mm-lang"), `${lang}/${rel}: switch inside nav`);
      const href = /href="([^"]*)"/.exec(tag)[1];
      const from = pageUrl(lang, rel);
      const dir = from.endsWith("/") ? from : posix.dirname(from) + "/";
      const target = posix.normalize(posix.join(dir, href));
      assert.ok(otherPages.has(target) || otherPages.has(target.replace(/\/$/, "")), `${lang}/${rel}: target ${target} (from ${href}) does not exist in the ${other} tree`);
    }
  }
});

test("AC-V2-107: the English tree paths are unchanged (no page of the English tree lives under /uk/)", {skip: built ? false : "no built trees"}, () => {
  assert.ok(!htmlIn(trees.en).some((r) => r.startsWith("uk/")));
});
