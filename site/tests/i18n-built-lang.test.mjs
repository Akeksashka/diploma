// V44 (AC-V2-106, WCAG 3.1.2): the English fallback text of the production Ukrainian tree is marked lang="en" in the BUILT HTML (not only by renderHtml).
// Built cases need dist-uk (npm run build:uk); MM_REQUIRE_DIST=1 forbids the skip.
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {htmlFiles} from "../scripts/set-html-lang.mjs";
import {markFallbackLang, markTree, reviewedEntries, unreviewedUi} from "../scripts/mark-fallback-lang.mjs";

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

test("whole-region marking: none reviewed marks, all reviewed skips, a mix refuses", () => {
  const d = mkdtempSync(join(tmpdir(), "mm-fb-"));
  writeFileSync(join(d, "index.html"), page);
  assert.throws(() => markTree(d, {reviewed: ["uk.json:ui:CAVEAT"], unreviewed: 3}), /per-element/);
  assert.equal(markTree(d, {reviewed: ["uk.json:ui:CAVEAT"], unreviewed: 0}), 0); // nothing marked
  assert.doesNotMatch(readFileSync(join(d, "index.html"), "utf8"), /lang="en"/);
  assert.equal(markTree(d, {reviewed: [], unreviewed: 5}), 1);
  assert.match(readFileSync(join(d, "index.html"), "utf8"), /<main lang="en"/);
});

test("today every UI entry is reviewed (user acceptance 2026-11-15), so the built tree is not region-marked", () => {
  assert.ok(reviewedEntries().some((r) => r.startsWith("uk.json:")));
  assert.equal(unreviewedUi(), 0);
});

const dist = join(root, "dist-uk");
const built = existsSync(join(dist, "index.html"));
if (process.env.MM_REQUIRE_DIST === "1" && !built) throw new Error("MM_REQUIRE_DIST=1 but dist-uk is missing");
test("AC-V2-106: every page of the built Ukrainian tree has <html lang=\"uk\"> and, with every UI entry reviewed, no region is marked lang=\"en\"", {skip: built ? false : "no dist-uk (run npm run build:uk with the fixture export)"}, () => {
  const files = htmlFiles(dist);
  assert.ok(files.length > 10);
  for (const f of files) {
    const h = readFileSync(f, "utf8");
    assert.match(h, /<html lang="uk"/, f);
    for (const t of ["header", "main", "footer"]) assert.doesNotMatch(h, new RegExp(`<${t} lang="en"`), `${f}: ${t}`);
  }
});
// Known gap (decisions V44): domain, indicator and source names have no Ukrainian text and render English inside Ukrainian regions without a lang="en" wrapper.
