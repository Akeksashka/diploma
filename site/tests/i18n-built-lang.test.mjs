// V44 (AC-V2-106, WCAG 3.1.2): the English fallback text of the production Ukrainian tree is marked lang="en" in the BUILT HTML (not only by renderHtml).
// Built cases need dist-uk (npm run build:uk); MM_REQUIRE_DIST=1 forbids the skip.
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {htmlFiles} from "../scripts/set-html-lang.mjs";
import {markFallbackLang, markTree, reviewedEntries} from "../scripts/mark-fallback-lang.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = '<html lang="uk"><body><header id="observablehq-header"><noscript>x</noscript></header><main id="observablehq-main" class="observablehq"></main><footer id="observablehq-footer"></footer></body></html>';

test("the fallback regions get lang=\"en\", <html> keeps lang=\"uk\", and a second run changes nothing", () => {
  const once = markFallbackLang(page);
  assert.match(once, /<html lang="uk">/);
  for (const t of ["header", "main", "footer", "noscript"]) assert.match(once, new RegExp(`<${t} lang="en"`), t);
  assert.match(once, /<main lang="en" id="observablehq-main" class="observablehq">/);
  assert.equal(markFallbackLang(once), once);
});

test("a page without a region fails loudly", () => {
  assert.throws(() => markFallbackLang("<html><body><main></main></body></html>", "p.html"), /header/);
});

test("with a reviewed Ukrainian entry the whole-region marking refuses to run", () => {
  const d = mkdtempSync(join(tmpdir(), "mm-fb-"));
  writeFileSync(join(d, "index.html"), page);
  assert.throws(() => markTree(d, {reviewed: ["uk.json:ui:CAVEAT"]}), /per-element/);
  assert.equal(markTree(d, {reviewed: []}), 1);
});

test("no entry is reviewed today, so whole-region marking is accurate", () => {
  assert.deepEqual(reviewedEntries(), []);
});

const dist = join(root, "dist-uk");
const built = existsSync(join(dist, "index.html"));
if (process.env.MM_REQUIRE_DIST === "1" && !built) throw new Error("MM_REQUIRE_DIST=1 but dist-uk is missing");
test("AC-V2-106: every page of the built Ukrainian tree has <html lang=\"uk\"> and its header, main, footer and noscript marked lang=\"en\"", {skip: built ? false : "no dist-uk (run npm run build:uk with the fixture export)"}, () => {
  const files = htmlFiles(dist);
  assert.ok(files.length > 10);
  for (const f of files) {
    const h = readFileSync(f, "utf8");
    assert.match(h, /<html lang="uk"/, f);
    for (const t of ["header", "main", "footer"]) assert.match(h, new RegExp(`<${t} lang="en"`), `${f}: ${t}`);
    for (const m of h.matchAll(/<noscript(\s[^>]*)?>/g)) assert.match(m[0], /lang="en"/, f);
    // no visible Cyrillic outside a lang="en" region: the only Ukrainian-language element would be the switch (its text is the other language, English, here)
    const visible = h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
    assert.ok(!/[А-Яа-яІіЇїЄє]/.test(visible.replace(/<[^>]*>/g, "")), `${f}: Cyrillic text in the built page although every entry is only proposed`);
  }
});
