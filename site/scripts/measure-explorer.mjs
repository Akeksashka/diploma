// Usage: node scripts/measure-explorer.mjs [distDir]. Prints the bytes of the first explorer interaction
// (Parquet reader libraries + the largest series file) and fails when the gzip -9 size is above 5 MB.
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {INTERACTION_LIMIT_BYTES, interactionBudget} from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const b = interactionBudget(resolve(process.argv[2] ?? join(here, "..", "dist")));
console.log(`reader libraries: ${b.libs.files} files, ${b.libs.gzip} gz, ${b.libs.raw} raw`);
console.log(`largest series file: ${b.largest.path}, ${b.largest.gzip} gz, ${b.largest.raw} raw`);
console.log(`first interaction: ${b.firstInteraction.gzip} gz, ${b.firstInteraction.raw} raw; later interaction: ${b.laterInteraction.gzip} gz, ${b.laterInteraction.raw} raw (limit ${INTERACTION_LIMIT_BYTES})`);
process.exit(b.firstInteraction.gzip > INTERACTION_LIMIT_BYTES ? 1 : 0);
