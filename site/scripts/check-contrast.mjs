// AC-UX-1 static half. Usage: node scripts/check-contrast.mjs [--css <file>] [--pairs <module>]
// Defaults: src/style.css and scripts/contrast-pairs.mjs. Exit 1 on any failing pair, undeclared token or parse error.
import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {checkPairs, resolveThemes} from "./lib/contrast.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? resolve(args[i + 1]) : fallback;
};
const cssPath = opt("--css", join(here, "..", "src", "style.css"));
const pairsPath = opt("--pairs", join(here, "contrast-pairs.mjs"));

if (!existsSync(cssPath)) {
  console.error(`check-contrast: ${cssPath} does not exist yet (created in T101); nothing to check`);
  process.exit(1);
}
const {PAIRS, NON_COLOUR_PREFIXES} = await import(pathToFileURL(pairsPath).href);
let report;
try {
  const themes = resolveThemes(readFileSync(cssPath, "utf8"), NON_COLOUR_PREFIXES);
  report = checkPairs(themes, PAIRS);
} catch (e) {
  console.error(`check-contrast: ${e.message}`);
  process.exit(1);
}
const failed = report.results.filter((r) => !r.ok);
for (const r of report.results) {
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.theme} ${r.fg} on ${r.bg}: ${r.ratio.toFixed(3)} (min ${r.min}, ${r.kind})`);
}
for (const e of report.errors) console.error(`ERROR ${e}`);
if (failed.length || report.errors.length) {
  console.error(`check-contrast: ${failed.length} pair(s) below limit, ${report.errors.length} structural error(s)`);
  process.exit(1);
}
console.log(`check-contrast: ${report.results.length} pair checks passed`);
