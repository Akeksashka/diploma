---
status: approved   # approved by the user on 2026-11-04 (stated in session: "aprove all")
---
# ADR-024: Approve @observablehq/framework as a build-time npm tool of `site/`, alongside Playwright, with dependency-handling rules (extends ADR-016)

Date: 2026-11-04. Depends on ADR-023 (toolkit choice, proposed). Facts from ADR-016, ADR-006, ADR-010 and `docs/ops/spike-results.md` (T87), read 2026-11-04. Labels as in ADR-023.

Why a new ADR: ADR-016 is `approved`; it amended ADR-004 by a new ADR, not by editing it. Following that, ADR-016 stays unchanged. Its decision 3 ("This approval does not choose the dashboard toolkit") is completed by this ADR once approved; ADR-016 decision 3 (Playwright) is unchanged.

## Context
- ADR-016 approves exactly one site npm tool: Playwright (`devDependency` of `site/`, Chromium only, locked by `site/package-lock.json`). Anything else needs a new ADR.
- The T87 spike installed `@observablehq/framework` 1.13.4 (one direct entry in `site/package.json`; 335 packages in the lockfile, 259 installed on the spike machine; 7 `npm audit` findings: 3 low, 4 moderate) only because the spike task allowed `npm install`. It is not approved. If A1 is chosen (ADR-023) the approval must be recorded.
- Node is a build-time tool for `site/` only, on the Actions runner (ADR-006, ADR-010 decision 4).

## Options considered
1. Approve only the Framework (and what it pulls in). Leaves Plot/d3/Arrow/parquet-wasm approval implicit.
2. Approve the Framework as the tool and name the browser libraries the site imports as part of the same approval, with the handling rules below (chosen).
3. Do not approve; fall back to A2/A3. Rejected by the user decision "Accept A1".

## Decision
1. Approved site npm tools (build/test time only, `devDependencies` of `site/`, exact versions in `site/package.json`, locked by `site/package-lock.json`):
   - `@observablehq/framework` 1.13.4 (static site generator, brings esbuild, rollup, jsdom and others as transitive dependencies).
   - `playwright` (as already approved in ADR-016; version pinned at implementation).
   - Browser libraries the pages import and that ship self-hosted in `dist/_npm`: Observable Plot 0.6.18, d3 7.9.2, apache-arrow 21.2.0, parquet-wasm 0.9.0 and their transitive packages (listed in `docs/ops/spike-results.md`). Under ADR-023 decision 5 (P1) these become direct exact-pinned dependencies; under P2 they are controlled by `site/npm-imports.lock`. DuckDB-Wasm is NOT approved here; it needs an ADR if C6 of ADR-023 selects it.
   Nothing else may be added to `site/package.json` without a new ADR (same rule as ADR-016 for Python plugins). Direct dependencies only count here; transitive ones are governed by rules 2 to 6.
2. Pinning and install: exact versions only (`save-exact`, already in `site/.npmrc`); CI uses `npm ci` (never `npm install`); `site/package-lock.json` is committed and reviewed; a lockfile change without a `package.json` change or a Dependabot PR is a review flag. CI runs `npm ci --ignore-scripts` unless a package in the tree needs an install script; the exceptions (for example esbuild's platform binary or Playwright browser download) are listed in `site/README` or the PR that introduces them. [UNVERIFIED: which packages in the 335 need install scripts; checked at implementation.]
3. Licences: before the first deploy, a licence listing of `dist/_npm` and of the shipped libraries is produced and checked as permissive; Framework is described as ISC-licensed [UNVERIFIED here, from memory; check `package.json`/`LICENSE` of the pinned version at implementation]. Playwright: Apache-2.0 (ADR-016). No copyleft code may ship in `dist/` without a user decision.
4. Where it runs: only the `site` job and the `export-and-site` CI job on GitHub-hosted runners, with no database secret (ADR-010 decision 5). Never on the user's Mac for production builds; local use is for development only. The Node version is pinned (ADR-023 decision 8).
5. Network at build time: allowed for the registry (`npm ci`), the Playwright browser download, and, until ADR-023 P1 is in place, jsDelivr for Framework's `npm:` imports. No network at pipeline run time of the data stages. The deployed site makes no off-origin request (AC-DASH-1) and loads no Google Fonts (`globalStylesheets: []`).
6. Vulnerability and update handling: as ADR-023 decision 7 (audit in CI; fail on high/critical in shipped packages; triage others; no `audit fix --force`; exceptions file with review date). Dependabot npm ecosystem for `/site`, weekly, grouped, with no auto-merge; every bump must pass the site build, unit and Playwright tests. Framework minor or major upgrades are separate PRs that re-run C3 of ADR-023 (real export render).
7. Enforcement (acceptance criteria):
   - AC-NPM-1: a unit test reads `site/package.json` and fails if a dependency or devDependency is outside the approved list of this ADR and ADR-016 (exact pins, no ranges, no `^`/`~`).
   - AC-NPM-2: CI fails if `npm ci` modifies the lockfile or if `package.json` and the lockfile disagree.
   - AC-NPM-3: the existing built-site off-origin scan stays and fails on any URL other than the allowed W3C namespace URIs and comment text.
   - AC-NPM-4: `npm audit` output is part of the build summary; the failure rule of ADR-023 decision 7 is tested with a stubbed audit report.
   - AC-NPM-5: the Dependabot config contains the npm entry for `/site`.
8. Playwright browser binaries: unchanged from ADR-016 (Chromium only, CLI install in CI, cache the browser directory, fallback in OQ-18/BB30).

## Consequences
- Positive: the spike's installed tooling becomes an approved, bounded and testable dependency set; supply-chain controls are written down; Playwright approval is unchanged.
- Negative: roughly 335 transitive packages at build time to monitor; Dependabot noise on `/site`; install-script and licence checks add one-time work at T88; `npm audit` will keep reporting findings in a large tree, so the triage rule matters.
- ADR-016 stays `approved` with its text unchanged; this ADR extends its list of site tools. ADR-006 (Node is build-time only) is unchanged.
- Open and not decided here: DuckDB-Wasm (ADR-023 C6), Playwright version pin, the exact Node version, licence listing of the final tree.

## Sources (accessed 2026-11-04)
- `docs/ops/spike-results.md` (T87): package counts, audit counts, resolved versions.
- Playwright CI install and licence: as cited in ADR-016 (https://playwright.dev/docs/browsers, [SEARCH], 2026-10-25).
