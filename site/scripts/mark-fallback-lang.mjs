// V44 (AC-V2-106, WCAG 3.1.2): post-build step for the Ukrainian tree. Every UI string of the site is rendered by the page scripts from copy.js, and in a
// production build an entry that is not `reviewed` renders its English text. So that this English text is not announced as Ukrainian, the page regions that
// hold it (header, main, footer, noscript) get lang="en" on the built HTML while <html> stays lang="uk" (V43).
// This is valid only while no Ukrainian UI entry and no Ukrainian name is `reviewed`: a reviewed entry would then be wrongly marked English. The step therefore
// refuses to run when one exists; the wiring must then become per-element (render-time wrapper, i18n.js renderHtml) before the first entry is reviewed.
// Usage: node scripts/mark-fallback-lang.mjs <uk-tree-dir>. Idempotent; fails loudly on a page without the regions.
import {readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {htmlFiles} from "./set-html-lang.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const REGIONS = [/<(header)(\s[^>]*)?>/i, /<(main)(\s[^>]*)?>/i, /<(footer)(\s[^>]*)?>/i];
const NOSCRIPT = /<(noscript)(\s[^>]*)?>/gi;

export function reviewedEntries(dir = join(here, "..", "src", "i18n")) {
  const found = [];
  for (const [file, doc] of [["uk.json", readJson(join(dir, "uk.json"))], ["names.uk.json", readJson(join(dir, "names.uk.json"))]]) {
    const tables = file === "uk.json" ? {ui: doc} : doc;
    for (const [section, table] of Object.entries(tables)) for (const [k, e] of Object.entries(table)) if (e?.status === "reviewed") found.push(`${file}:${section}:${k}`);
  }
  return found;
}

const setLang = (tag, name, attrs) => `<${name} lang="en"${(attrs ?? "").replace(/\s+lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "")}>`;

export function markFallbackLang(source, name = "(input)") {
  let out = source;
  for (const re of REGIONS) {
    if (!re.test(out)) throw new Error(`${name}: no <${re.source.slice(2, re.source.indexOf(")"))}> region`);
    out = out.replace(re, (m, tag, attrs) => setLang(m, tag, attrs));
  }
  return out.replace(NOSCRIPT, (m, tag, attrs) => setLang(m, tag, attrs));
}

export function markTree(dir, {reviewed = reviewedEntries()} = {}) {
  if (reviewed.length > 0) throw new Error(`${reviewed.length} Ukrainian entries are reviewed (first: ${reviewed[0]}): marking whole regions lang="en" would mislabel them; make the fallback per-element first`);
  const files = htmlFiles(dir);
  if (files.length === 0) throw new Error(`${dir}: no HTML files found`);
  for (const f of files) {
    const before = readFileSync(f, "utf8");
    const after = markFallbackLang(before, f);
    if (after !== before) writeFileSync(f, after);
  }
  return files.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: node scripts/mark-fallback-lang.mjs <uk-tree-dir>");
    process.exit(2);
  }
  try {
    console.log(`mark-fallback-lang: ${dir} (${markTree(dir)} files)`);
  } catch (e) {
    console.error(`mark-fallback-lang: ${e.message}`);
    process.exit(1);
  }
}
