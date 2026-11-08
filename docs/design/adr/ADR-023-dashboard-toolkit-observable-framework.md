---
status: approved   # approved by the user on 2026-11-04 (stated in session: "aprove all")
---
# ADR-023: Dashboard toolkit is A1, Observable Framework 1.13.4 with Observable Plot 0.6.18, under explicit conditions (completes decision 3 of ADR-010)

Date: 2026-11-04. User decision stated in session on 2026-11-04: "Accept A1". Evidence: `docs/ops/spike-results.md`, section "Site toolkit spike AC-DASH-0 (plan task T87)", run 2026-11-04 (read 2026-11-04). External facts carry a source and access date 2026-11-04. Labels: [DOC] read on the primary page; [SEARCH] search-result summary only; [SPIKE] measured in the T87 spike; [UNVERIFIED] not checked.

Why a new ADR and not an edit of ADR-010: ADR-010 is `approved`. Precedent is ADR-016, which amended ADR-004 without editing it ("ADR-004 stays approved and its text unchanged"). ADR-010 decision 3 reserved this choice for "an update of this ADR (not by the implementer alone)"; this ADR is that update, and ADR-010 decision 3 reads as completed by it once the user approves this ADR. ADR-010 itself is left unchanged by this ADR; if the user prefers an in-place pointer line or a text edit in ADR-010, that is a separate, small step (open question 1).

## Context
- ADR-010 decision 3 named A1 (Observable Framework + Plot) as the preferred candidate and gated the choice on spike AC-DASH-0: a scorecard page and an explorer page built from fixture exports and deployed to Pages from Actions. Fallbacks, in order: A2 Quarto, A3 hand-written HTML/ES modules.
- The T87 spike [SPIKE] built both pages locally with Framework 1.13.4 and Plot 0.6.18, rendered them in headless Google Chrome without errors, and read a Parquet series file in the browser (parquet-wasm 0.9.0, apache-arrow 21.2.0, self-hosted in `dist/_npm`). The deployment half of AC-DASH-0 was not done. A2 and A3 were not tried.
- The user has accepted A1 on this evidence, knowing the limits below.

## Evidence and its limits (stated as they are)
What was shown:
| Item | Result [SPIKE] |
|---|---|
| Build | `npm run build` from a fixture export: 2 pages, `dist/` about 6.2 MB uncompressed (JS libraries, parquet-wasm, Arrow, data) |
| Render | Headless Chrome `--dump-dom` of both pages served by a local static server: table, chart, 4 checkboxes, selects, Plot SVG with series paths, no error element |
| Parquet | 4.6 KB zstd file read via `FileAttachment().parquet()` |
| Off-origin URLs | none after `globalStylesheets: []`; before that `fonts.googleapis.com` and `fonts.gstatic.com` |
| Size proxy | whole `dist/` about 1.96 MB as the sum of per-file `gzip -c`; per page JS imports reported by Framework: 593 kB (scorecard), 877 kB (explorer), uncompressed |
| Dependency tree | 335 packages in `package-lock.json` (80 optional platform binaries); `npm audit`: 7 findings (3 low, 4 moderate) |

What was NOT shown (carried forward as conditions, section "Conditions"):
1. The fixture is synthetic: 3 entities, 1 indicator (M09), 36 months, hand-written numbers, not the output of the `export` CLI (which needs a database). Parquet writer settings of a real export (zstd, v2, dictionary encoding, `date32`, `timestamp[us, UTC]`) were exercised only through a small file written by the pinned pyarrow.
2. No Actions build and no Pages deployment (no workflow was written; `actionlint` not run). Whether Pages serves gzip or brotli for `.json`, `.js`, `.wasm`, `.parquet`, and whether it sends `Accept-Ranges: bytes`, is [UNVERIFIED]. The local `gzip -c` figures do not show what Pages sends.
3. Only the locally installed Chrome was used. Playwright/Chromium, Firefox and Safari were not run.
4. DuckDB-Wasm was not used; the spike read Parquet with Arrow + parquet-wasm. The ADR-010 premise that the explorer may use DuckDB-Wasm is untested; the choice of reader for T91 is open (condition C6).
5. Landing-view weight against the AC-DASH-2 limit (1.5 MB gzipped) is plausible but not measured on a real landing set.

## Options considered
1. Accept A1 now, with the unverified items as explicit conditions that gate specific later tasks (chosen; user decision).
2. Keep ADR-010 decision 3 open until the Pages deployment and a real-export run are done. Safest, but blocks T88-T93 (plan BL-10, OP-10) on steps that need a push and the user's Pages settings (OP-01); the user chose not to wait.
3. Switch to A2 (Quarto) or A3 now. A1 did not fail; A2/A3 behaviour is unknown. They remain the fallbacks if a condition fails (below).

## Decision
1. Toolkit = A1: `@observablehq/framework` 1.13.4 (exact pin, `site/package.json` with `save-exact`) and Observable Plot 0.6.18, as resolved by Framework 1.13.4. This closes ADR-010 decision 3, AC-DASH-0 as a toolkit choice, plan BL-10 and OP-10 (when the user approves this ADR). The export contract is unchanged (ADR-010 decision 1 and 2).
2. AC-DASH-0 stays "partly met": the toolkit choice is closed, the deployment measurements are not. They are conditions, not assumptions (below). `docs/ops/spike-results.md` remains the evidence record.
3. Fallback rule: if condition C1 or C2 fails in a way that cannot be fixed within the A1 setup (for example Pages cannot serve the built site, or the real export cannot be read by the browser readers in C3 and C6), the ADR-010 fallback order applies (A2, then A3) and a new ADR records it. The JSON tier (T1) is independent of the Parquet reader, and the manifest `format` field allows a Parquet-to-JSON switch for series (design risk R20).
4. Google Fonts: the Framework default theme loads fonts from `fonts.googleapis.com`/`fonts.gstatic.com`, which breaks AC-DASH-1 (no request leaves the origin) and leaks visitor IPs to a third party. Rule: `site/observablehq.config.js` keeps `globalStylesheets: []` (system fonts). Any future web font is self-hosted under `site/src/` with its licence recorded. The built-site off-origin scan (the existing unit build check, later the Playwright network assertion in T94) is the enforcing test and must stay in CI.
5. Build-time third-party fetch (the jsDelivr gap). Facts: Framework downloads `npm:` imports from jsDelivr during build, caches them in `.observablehq/cache/_npm` under the source root, and self-hosts them in `dist/_npm`; the deployed site does not call jsDelivr [SPIKE; consistent with https://observablehq.com/framework/imports and forum guidance, accessed 2026-11-04, [SEARCH]]. The resolved versions (Plot 0.6.18, apache-arrow 21.2.0, parquet-wasm 0.9.0, flatbuffers 25.9.23, tslib 2.9.1, htl 1.0.0, isoformat 0.2.1, d3 7.9.2 and 30 d3 modules; full list in the spike results) come from Framework's own resolution, not from `package-lock.json`, so a CI rebuild may pick other versions or content. Rule, in order of preference:
   - P1 (preferred): make the libraries the site actually imports ordinary exact-pinned npm dependencies of `site/` (Plot, d3, apache-arrow, parquet-wasm and the others the pages import) and import them by bare specifier from `node_modules`. Framework supports `node_modules` imports, cached under `.observablehq/cache/_node` [SEARCH, same sources; whether the default-available `Plot`, `d3`, `FileAttachment().parquet()` can be redirected to node_modules versions without code changes is [UNVERIFIED] and is the first thing T88 checks]. Then `package-lock.json` (with integrity hashes) covers them, and `npm ci` is the single supply-chain gate.
   - P2 (if P1 cannot cover the implicit imports): after the build, a CI step lists `dist/_npm` and compares package@version and sha256 of each file against a committed `site/npm-imports.lock` file (a plain text manifest generated once and reviewed in a PR). A mismatch fails the build. Updating it is a reviewed change. No network allowed after the build step; the `site` job has no database secret (ADR-010 decision 5).
   - Not chosen: committing the whole `.observablehq/cache` directory (large, unreviewable diffs, binary history; ADR-010 avoids binary history bloat), and caching it with `actions/cache` as the only control (a cache is not an integrity control).
   Choice between P1 and P2 is made in T88 by what P1's check shows; both satisfy this ADR. The rule that stays either way: the deployed site contains only self-hosted code, and the set of third-party code in `dist/` is reproducible from files in git.
6. Bundle-size rule. The limit is the AC-DASH-2 landing limit: at most 1.5 MB gzipped for the landing view (everything fetched on first load of V1, including JS imports and any wasm). Per-page JS imports in the spike (593 kB and 877 kB uncompressed) are a proxy only. Rules: T88 measures the landing set on the fixture export from the built site with real `gzip -9` per fetched file and records it in the build summary; T94 asserts it in CI using the Playwright response sizes (with the caveat that sizes on Pages depend on its compression, condition C2); wasm and parquet-wasm load only on the explorer (V3), not on the landing view; if the landing set exceeds 1.5 MB gz, the first action is to remove imports from V1 (for example avoid loading Arrow/parquet-wasm there), not to raise the limit. The limit is changed only by a new ADR.
7. npm audit handling. 7 findings (3 low, 4 moderate) were reported in the build tree on 2026-11-04 [SPIKE]; they were not assessed for relevance, and `npm audit fix` was not run. Rule:
   - `npm audit` runs in CI for `site/` and its output is a build summary item, not a silent step.
   - High or critical findings in any package whose code ships in `dist/` (the self-hosted libraries) fail the build until fixed or a documented exception is approved by the user.
   - High or critical findings in build-only tooling (rollup, esbuild, jsdom, etc.) do not fail the build automatically but must be listed in the monthly check or the PR that updates dependencies, with the reachability judgment (build-time only, no untrusted input). The site job processes only repo files and our own export, which narrows exposure.
   - Low and moderate findings: triaged when Dependabot raises an update (npm ecosystem for `/site`, added to `.github/dependabot.yml` at implementation if absent), not blocking.
   - `npm audit fix --force` is never run automatically; fixes are made by bumping exact pins in a PR, rebuilding, and re-running the site tests. Exceptions are recorded in `docs/ops/site-dependency-exceptions.md` with date, advisory id, reason and review date.
   - The first action under this rule is to run `npm audit` on `site/` and record the 7 findings' advisory ids and whether each is in a shipped package (a T88 sub-step; the spike did not assess relevance).
8. Node pin. `site/package.json` `engines` is `>=20.18.1 <21`; Framework 1.13.4 declares `node >=18` [SPIKE]. A single Node version is pinned for CI and local use (`site/.node-version` or `actions/setup-node` with an exact version), set in T88. [UNVERIFIED]: whether the Node 20 line is still in Node's support schedule when the pipeline goes live; check at T88 and move the pin by PR, not silently.

## Conditions (carried forward; each has an owner task and a gate)
| # | Condition | Gate | Owner |
|---|---|---|---|
| C1 | Build `site/` in Actions with SHA-pinned actions and deploy to Pages (`configure-pages`, `upload-pages-artifact`, `deploy-pages` or equivalent, minimal `permissions`, `actionlint` clean). Requires OP-01 (Pages source = GitHub Actions) and a push, both the user's | before the first production deploy; before T88 is marked met for deployment | T75/T88 with user |
| C2 | Measure on the deployed Pages URL: `content-encoding` for `.json`, `.js`, `.wasm`, `.parquet`; `accept-ranges`; a `Range: bytes=0-99` request returns 206 or 200 (commands in the spike results, step 5). Record results in `docs/ops/spike-results.md` and the design/export spec size assumptions are updated if compression is absent | before AC-DASH-2 is declared met | T88 or the first deploy |
| C3 | Re-run the build and render check on a real `export` output (not the synthetic fixture), including the real Parquet writer settings, and the full size budgets of the export spec | before T89-T92 are marked met | T88 (first), T94 |
| C4 | Playwright/Chromium smoke of V1-V5 in CI (ADR-016 approves Playwright; OQ-18/BB30 covers download time) | T94 | T94 |
| C5 | Firefox and Safari: manual check once on the deployed site, recorded; still [UNVERIFIED] for automation (BB16) | before launch readiness (M6) | user + T94 |
| C6 | Decide the series reader for V3: Arrow + parquet-wasm (the spike's path) or DuckDB-Wasm, by measured memory, range-request behaviour (depends on C2) and landing weight; the JSON tier remains the fallback via manifest `format` | T91 | T91 |
| C7 | P1/P2 of decision 5 implemented and the audit rule of decision 7 wired into CI | T88 | T88 |

## Consequences
- Positive: T88-T93 can start once this ADR is approved; the toolkit is static, needs no server, and matches the T1/T2 data tiers; Google Fonts and CDN calls are excluded from the deployed site; the user decision is recorded with its evidence.
- Negative: a large transitive npm tree (335 packages in the lockfile) enters the supply chain at build time; build needs network once for the jsDelivr imports unless P1 removes that; AC-DASH-0 is closed for the toolkit but open for deployment, so there is a risk of rework if C1-C3 fail (bounded: the export contract is toolkit-independent and A2/A3 stay as fallbacks); Framework is a Node tool, adding Node to the `site` job (already accepted in ADR-006 and ADR-010 decision 4).
- Risks: R20 / BB10 reduced but not closed (Parquet readers on real data, Pages compression and range support, DuckDB-Wasm untested); Framework version drift (exact pin, upgrades by PR with the site tests); Framework docs were unreadable in the ADR-010 round (HTTP 429), so claims about its behaviour here rest on the spike plus [SEARCH] summaries.
- Docs affected after approval (not edited here): plan BL-10 and OP-10 (mark closed), T87 note (toolkit decision recorded), design doc AC-DASH-0 and R20/BB10 wording, `docs/ops/spike-results.md` (append condition results as they are measured). Dependency approval for the Framework is ADR-024.
- Reversal: choosing A2/A3 later needs a new ADR; the pipeline and export spec do not change.

## Sources (accessed 2026-11-04)
- Spike evidence: `docs/ops/spike-results.md`, T87 section.
- Framework imports and cache behaviour: https://observablehq.com/framework/imports [SEARCH summary; not read in full this session].
- Offline/cache forum thread: https://talk.observablehq.com/t/need-help-with-running-observable-framework-1-8-in-offline-environment-fetch-failed-error/9369 [SEARCH; community guidance on Framework 1.8, older than 1.13.4].
- GitHub Pages limits (unchanged from ADR-010): https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits [DOC in ADR-010, 2026-10-17].
