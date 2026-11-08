# Site dependency exceptions and audit triage (ADR-023 decision 7, ADR-024 decision 6)

Scope: `site/package-lock.json`. Exceptions need the user's approval and a review date. `npm audit fix` is never run.

## Exceptions

None. No high or critical finding exists, so no exception is needed.

## Triage record (first action of ADR-023 decision 7), npm audit run 2026-11-04 on the T88 tree

Counts: 3 low, 4 moderate, 0 high, 0 critical (7 total). Registry: npm 10.8.2, Node 20.18.1.
"Shipped" = the package's code is in `site/dist` (checked from `dist/_node` and `dist/_npm` after the T88 build: only Plot, d3 and its modules, htl, isoformat, apache-arrow, flatbuffers, tslib, parquet-wasm). All seven are build-time tooling, none ships.

| Package | Severity | Advisory | Title | Shipped | Reachability |
|---|---|---|---|---|---|
| deepmerge (via `@rollup/plugin-node-resolve`) | low | GHSA-gcqx-w48m-w2h4 (npm id 1243505) | mergeObject() allows prototype poisoning | no | build only; merges rollup plugin options we control |
| esbuild 0.27.3 - 0.28.0 | low | GHSA-g7r4-m6w7-qqqr (1120680) | arbitrary file read when running the dev server on Windows | no | affects the dev server on Windows; CI builds on Linux and does not run the dev server |
| glob 9.0.0 - 14.0.1 | moderate | GHSA-3g3m-2fjr-6pw4 (1244013) | AbortSignal cancellation bypass allows post-timeout filesystem traversal | no | build only; globs repo paths, no untrusted input, no abort signal used |
| minimatch < 11.0.1 | moderate | GHSA-g3hv-75wg-m249 (1244012) | DoS via globparts amplification | no | build only; patterns come from Framework and our config |
| `@rollup/plugin-commonjs`, `@rollup/plugin-node-resolve`, `@observablehq/framework` | moderate / low / moderate | (inherit the above via glob, deepmerge, esbuild) | no own advisory | no | the "fix" npm offers is Framework 1.10.1, a downgrade flagged as semver-major; not applied |

Next review: with the first Dependabot PR for `/site` or the first monthly check, whichever is earlier. The CI gate is `site/scripts/audit-gate.mjs` (fails on high/critical in shipped packages; tested with a stubbed report in `site/tests/scripts.test.mjs`). Advisory ids above are as printed by `npm audit --json`; the advisory pages were not opened.
