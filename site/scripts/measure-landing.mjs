// Usage: node scripts/measure-landing.mjs [distDir] [page] [--all-domains]. Prints real gzip -9 sizes of everything
// fetched on first load of the landing page and fails above 1.5 MB (ADR-023 decision 6, AC-DASH-2) or when the CSS
// is above 20 KB gzip (AC-UX-12). The 600 KB internal target (ADR-025) is reported, and failing it also fails.
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipBytes, CSS_LIMIT_BYTES, LANDING_LIMIT_BYTES, LANDING_TARGET_BYTES, landingBudget, landingSet} from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const allDomains = args.includes("--all-domains");
const [distArg, pageArg] = args.filter((a) => a !== "--all-domains");
const dist = resolve(distArg ?? join(here, "..", "dist"));
const set = landingSet(dist, pageArg ?? "index.html");
// --all-domains (T114): add every domain scorecard file, as if the landing page loaded them all.
if (allDomains) {
  const dir = join("_file", "data", "scorecard");
  for (const f of readdirSync(join(dist, dir)).filter((n) => n.endsWith(".json")).sort()) {
    const path = `${dir}/${f}`;
    if (!set.some((e) => e.path === path)) set.push({path, bytes: readFileSync(join(dist, path)).length, gzip: gzipBytes(readFileSync(join(dist, path)))});
  }
}
for (const e of set) console.log(`${String(e.gzip).padStart(9)} gz ${String(e.bytes).padStart(9)} raw  ${e.path}`);
const b = landingBudget(set);
console.log(`landing set: ${set.length} files, ${b.totalGzip} bytes gzipped (internal target ${LANDING_TARGET_BYTES}: ${b.targetOk ? "within" : "OVER"}; hard limit ${LANDING_LIMIT_BYTES}: ${b.limitOk ? "within" : "OVER"})`);
console.log(`css: ${b.cssFiles} file(s), ${b.cssGzip} bytes gzipped (limit ${CSS_LIMIT_BYTES}: ${b.cssOk ? "within" : "OVER or missing"})`);
process.exit(b.limitOk && b.targetOk && b.cssOk ? 0 : 1);
