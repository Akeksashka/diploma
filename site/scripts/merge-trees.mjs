// V42 (ADR-037 A2.1): merges the two language trees into one deploy tree: English at "/", Ukrainian under "/uk/".
// Usage: node scripts/merge-trees.mjs [en-dir=dist] [uk-dir=dist-uk] [out-dir=dist-site]. The inputs are not modified, so dist stays the pure English
// tree that the build-page tests and `macro-monitor check-site --site-dir site/dist` read. Idempotent (out-dir is replaced). Run after set-html-lang on both trees.
import {cpSync, existsSync, rmSync} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export function mergeTrees(enDir, ukDir, outDir) {
  if (!existsSync(join(enDir, "index.html"))) throw new Error(`${enDir}/index.html is missing: build the English tree first`);
  if (!existsSync(join(ukDir, "index.html"))) throw new Error(`${ukDir}/index.html is missing: build the Ukrainian tree first`);
  const paths = [enDir, ukDir].map((d) => resolve(d));
  const out = resolve(outDir);
  if (paths.includes(out)) throw new Error("out-dir must differ from both input trees");
  rmSync(out, {recursive: true, force: true});
  cpSync(enDir, out, {recursive: true});
  cpSync(ukDir, join(out, "uk"), {recursive: true});
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [en = "dist", uk = "dist-uk", out = "dist-site"] = process.argv.slice(2);
  try {
    console.log(`merge-trees: ${en} + ${uk} -> ${mergeTrees(en, uk, out)}`);
  } catch (e) {
    console.error(`merge-trees: ${e.message}`);
    process.exit(1);
  }
}
