// V43 (ADR-037 A2.1, AC-V2-101): sets lang on the <html> element of every built HTML file of one language tree. Framework 1.13.4 emits a bare <html>.
// Usage: node scripts/set-html-lang.mjs <tree-dir> <en|uk>. Idempotent; throws if a file has no <html tag. Run on each tree BEFORE merge-trees.
import {readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {LANGS, resolveLang} from "./lib/lang-config.mjs";

const HTML_TAG = /<html(\s[^>]*)?>/i;

export function setLangInHtml(source, lang, name = "(input)") {
  const m = HTML_TAG.exec(source);
  if (!m) throw new Error(`${name}: no <html> tag`);
  const attrs = (m[1] ?? "").replace(/\s+lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
  const tag = `<html lang="${lang}"${attrs}>`;
  return source.slice(0, m.index) + tag + source.slice(m.index + m[0].length);
}

// Every .html file under dir. For the default tree, a nested language tree directory (dist/uk after merge) is skipped, it belongs to its own language.
export function htmlFiles(dir, skipDirs = []) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!skipDirs.includes(r)) walk(join(d, e.name), r);
      } else if (e.isFile() && e.name.endsWith(".html")) out.push(join(d, e.name));
    }
  };
  walk(dir, "");
  return out.sort();
}

export function setTreeLang(dir, value) {
  const lang = resolveLang(value);
  const skip = LANGS.filter((l) => l !== lang && l !== "en"); // "uk" is nested under the English tree after merge
  const files = lang === "en" ? htmlFiles(dir, skip) : htmlFiles(dir);
  if (files.length === 0) throw new Error(`${dir}: no HTML files found`);
  for (const f of files) {
    const before = readFileSync(f, "utf8");
    const after = setLangInHtml(before, lang, f);
    if (after !== before) writeFileSync(f, after);
  }
  return files.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, lang] = process.argv.slice(2);
  if (!dir || !lang) {
    console.error("usage: node scripts/set-html-lang.mjs <tree-dir> <en|uk>");
    process.exit(2);
  }
  try {
    console.log(`set-html-lang: ${dir} lang=${lang} (${setTreeLang(dir, lang)} files)`);
  } catch (e) {
    console.error(`set-html-lang: ${e.message}`);
    process.exit(1);
  }
}
