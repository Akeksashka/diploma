// ADR-023 P2: compares dist/_npm (libraries Framework fetched from jsDelivr at build time and
// self-hosted) with the reviewed site/npm-imports.lock. `--update` rewrites the lock (reviewed PR only).
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {diffLock, formatLock, npmImportsManifest, parseLock} from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(join(here, "..", "dist"));
const lockPath = join(here, "..", "npm-imports.lock");
const actual = npmImportsManifest(dist);
if (process.argv.includes("--update")) {
  writeFileSync(lockPath, formatLock(actual));
  console.log(`check-npm-imports: wrote ${actual.length} entries to npm-imports.lock`);
  process.exit(0);
}
if (!existsSync(lockPath)) {
  console.error("check-npm-imports: site/npm-imports.lock is missing");
  process.exit(1);
}
const diffs = diffLock(parseLock(readFileSync(lockPath, "utf8")), actual);
if (diffs.length) {
  console.error(`check-npm-imports: dist/_npm differs from npm-imports.lock:\n${diffs.join("\n")}`);
  process.exit(1);
}
console.log(`check-npm-imports: ${actual.length} files match npm-imports.lock`);
