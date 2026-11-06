// Usage: node scripts/audit-gate.mjs <audit.json> [distDir]. Prints the audit summary for the build
// summary and fails on high/critical findings in packages that ship in dist/ (ADR-023 decision 7).
import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {auditGate, shippedPackages} from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const dist = resolve(process.argv[3] ?? join(here, "..", "dist"));
const r = auditGate(report, shippedPackages(dist));
console.log(`npm audit counts: ${JSON.stringify(r.counts)}`);
if (r.buildOnlyHigh.length) console.log(`high/critical in build-only tooling (list in the PR with reachability): ${r.buildOnlyHigh.join(", ")}`);
if (r.fail) {
  console.error(`high/critical in shipped packages: ${r.shippedHigh.join(", ")}`);
  process.exit(1);
}
