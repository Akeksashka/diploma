---
status: approved   # approved by the user on 2026-11-04 (stated in session: "Approve plan")
inputs:
  - CLAUDE.md
  - docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md
  - docs/design/briefs/dashboard-ux-brief.md
  - docs/design/adr/ADR-010-interactive-dashboard.md
  - docs/design/adr/ADR-023 (decisions 4 and 6), ADR-024 (dependency list)
  - docs/specs/dashboard-export-spec.md
  - docs/specs/analytics-and-r-contract-spec.md
  - docs/ops/spike-results.md
  - docs/plans/macro-monitor-v1-implementation-plan.md (read only; T88-T94 are the tasks extended)
---
# Dashboard UI/UX implementation plan (ADR-025)

Written 2026-11-04 by the planner from ADR-025 (approved by the user on 2026-11-04) and its brief. Nothing here is approved; the user approves. The v1 plan is not edited: the tasks below are numbered T99 onward and EXTEND the partial site tasks T88-T94 (see the table in section 1). No export contract, ADR, spec or `CLAUDE.md` change is part of this plan; anything that needs one is a blocker in section 3.

## 1. Scope, conventions, how this plan extends v1

- Write locations (CLAUDE.md, phase 4): `site/`, `tests/`, `docs/ops/`, `scripts/ci/`, `.github/workflows/`. No task touches `src/` (the Eurostat fix is a separate in-progress change, gate G0).
- No new dependency (ADR-025 decision 13, ADR-024 rule 1): no axe-core, no `@playwright/test`, no font or icon package, no colour library. Tests use `node:test` plus the Playwright library as in T94. Every task ends with: `npm test`, `npm run smoke` (where a browser task), `npm run check:imports`, landing measure; ruff/mypy only if a Python test file is touched.
- Sizes: S under 2 h, M under half a day.
- Every task keeps the confirmed wording of T89-T93 verbatim (ADR-025 decision 11). New strings (brief section 11) ship only after Q10 confirmation (gate G2).

| ADR-025 stage | Tasks | Extends v1 task |
|---|---|---|
| 0 foundation | T99-T107 | T88 (shell, stale banner, landing measure), T94 (harness) |
| 1 state vocabulary, V1 domain heatmap | T108-T113 | T89 |
| 2 landing heatmap (conditional) | T114-T116 | T88, T89 |
| 3 V2 | T117-T119 | T90 |
| 4 V3 | T120-T125 | T91 |
| 5 V4, V5 | T126-T129 | T92, T93 |
| 6 print, polish, cross-browser, screen reader | T130-T135 | T94 (Firefox/Safari manual, BB16) |

### Gates
- G0 (before Stage 0): the Eurostat `TIME_PERIOD` fetch fix lands and a real export (or a larger recorded export) exists, so tokens, column header lengths and density are tuned to real data. Fallback chosen by the user: start Stage 0 on the fixture; then T114 and T133 are re-run on the first real export before the stage closes.
- G1 (before T108): none beyond Stage 0 done.
- G2 (before any task that ships a new string): the user confirms the new wording of brief section 11 (Q10).
- G3 (before T111 is merged): user reviews the Stage 1 build directly (Q9 default: no Figma). Review items: palette, legend, state signatures, header abbreviations.
- G4 (before T115): the user opts in to the landing heatmap after T114 (default: stays a domain list).

### Assumptions (user defaults, pending explicit confirmation)
A1 System font stack first; Inter only later if needed (no font task is scheduled; see "Deferred"). A2 Automatic light/dark only, no toggle. A3 Show the stored percentile as exported, no x100. A4 Domain-list landing; heatmaps on domain pages only; Stage 2 conditional. A5 No axe-core, no `@playwright/test` beyond ADR-024. A6 Stage 1 reviewed directly, no Figma mock-ups. A7 Target WCAG 2.2 AA; screen-reader and Firefox/Safari checks done by the user. A8 Eurostat fix lands before Stage 0 (fallback: fixture). Plan-level assumptions that are not the user's: A9 bin edges are lower-inclusive (a value of exactly 0.2 falls in bin 2; 1.0 in bin 5), see blocker M1; A10 contrast, state and scan scripts live in `site/scripts/` and `site/tests/`; A11 the manual-check record is `docs/ops/dashboard-ux-manual-check.md`.

## 2. Task list

### Stage 0 - foundation

### T99: Baseline measures and Framework probes (S)  [x] done
- Goal: record today's numbers and settle the ADR-025 [UNVERIFIED] items before any styling work.
- Files: `docs/ops/dashboard-ux-baseline.md` (new), throwaway probe scripts in the scratchpad (not committed).
- Depends on: G0.
- Acceptance criteria: record (a) real `gzip -9` landing sizes per page (T88 measure), (b) whether Framework's `style` option takes a project CSS file and its theme variable names, (c) whether Framework copies a `.woff2` or other static file from `src/` untouched (only if a font is ever needed), (d) whether cells render without JavaScript (server-rendered caveat and freshness line), (e) on a real export: longest country name, longest indicator header, indicators per domain, row count. Each finding labelled verified/unverified. A finding that contradicts ADR-025 (for example `style` option unusable) is reported as a blocker, not worked around.
- Tests: none (documentation); probe outputs summarised.
- Risks: Framework docs returned HTTP 429 in the design session; verify from the installed package source in `site/node_modules` instead.
- Note (2026-11-04): result in `docs/ops/dashboard-ux-baseline.md`. Landing 31,960 B gz (fixture) and 32,406 B gz (real); real export 45 entities (44 rows per domain page), 80 indicators, 11 domains, longest country 19 chars, longest header 73 chars. `style` option works. Cells and the freshness line are not rendered without JS. BLOCKER for the font only: Framework 1.13.4 cannot reference a copied .woff2 from static CSS (url() fails the build; FileAttachment copy is hash-named), so ADR-025 decision 5 needs a user decision (system fonts 5(a) or an ADR update) before any font task.

### T100: Contrast library and script (M)  [x] done
- Goal: AC-UX-1 core: pure-Node WCAG relative-luminance and contrast function, token parser for light and dark blocks, pair checker.
- Files: `site/scripts/lib/contrast.mjs`, `site/scripts/check-contrast.mjs`, `site/tests/contrast.test.mjs`, `site/package.json` (script `check:contrast`).
- Depends on: T99.
- Acceptance criteria: AC-UX-1 static half: unrounded ratios; text/surface at least 4.5, bin ink on fill at least 4.5, borders/glyphs/focus/chart colours at least 3 against adjacent surface; exit code non-zero on any pair below limit; a declared pair table lives in one file so a new token without a declared pair fails (no silent token).
- Tests: JS unit with known WCAG reference pairs (black/white 21:1, #767676 on white about 4.54, a 4.499 case must fail, no rounding up), parser tests with synthetic CSS, a failing-pair fixture exits non-zero.
- Risks: parsing `@media (prefers-color-scheme: dark)` with a hand-written parser; keep tokens flat hex only (no `color-mix`, `rgb()` functions) and fail loudly on anything else.
- Note (2026-11-04): done. Added `site/scripts/lib/contrast.mjs`, `site/scripts/contrast-pairs.mjs` (the one pair table, 33 declared pairs per theme, plus non-colour prefixes), `site/scripts/check-contrast.mjs` (`--css`/`--pairs` options for fixtures), `site/tests/contrast.test.mjs` (8 tests, synthetic CSS in `site/tests/fixtures/contrast/`), `check:contrast` script. `npm test` 94 pass, 0 fail. `npm run check:contrast` exits 1 with a clear message while `site/src/style.css` is absent (T101 creates it); T101 must add the real-token test and may adjust token names in the pair table. Only `:root` and `@media (prefers-color-scheme: dark)` forms are parsed (no `data-theme`, brief has no toggle).

### T101: Tokens, `style.css`, theme wiring, system font stack (M)  [x] done
- Goal: one global stylesheet with `--mm-*` tokens, light default, dark override, system font stack, wired through Framework.
- Files: `site/src/style.css`, `site/observablehq.config.js` (`style` option; `globalStylesheets: []` kept), `site/tests/contrast.test.mjs` (repository tokens case).
- Depends on: T99, T100.
- Acceptance criteria: AC-UX-1 on real tokens, both themes (candidate hex values from the brief are changed until every declared pair passes; the dark ramp is set here); AC-UX-3 "more intense = higher percentile" in both themes (test compares bin luminance order); AC-UX-11 no font file and no remote `@font-face`/`@import`; `--mm-font` is a system stack; no change to existing behaviour of the five pages (T89-T93 tests still pass); dist has no new off-origin URL.
- Tests: `npm run check:contrast`; JS unit asserting token names in brief section 3.1 exist; built-page check that the stylesheet is served same-origin.
- Risks: coupling to Framework theme variable names (T99 result); Framework base colours not matching tokens in dark mode.
- Note (2026-11-04): done. Added `site/src/style.css` (flat-hex `--mm-*` tokens, light default, dark override, system `--mm-font`, local `observablehq:` imports only, no font file), `style: "style.css"` in `site/observablehq.config.js` (`globalStylesheets: []` kept). Alert ink names confirmed as `--mm-alert-watch-ink` / `--mm-alert-alert-ink` (pair table unchanged). 24 pairs x 2 themes = 48 checks pass; candidate light hexes from the brief passed unchanged except muted/border/alert/feed values chosen here; dark ramp set (`#16304d`..`#d3e6f6`). Added 5 tests to `contrast.test.mjs` (real tokens, brief 3.1 names, AC-UX-3 luminance order both themes, no remote/font-file, built-dist same-origin). `npm test` 99 pass, 0 fail; smoke 25 pass with `MM_SMOKE_CHANNEL=chrome` and `MM_EXPECT_BUILD_ID` set from the built manifest (without it the existing AC-SYS-10 test fails by design). Built `dist` has no new off-origin URL (only the SVG namespace string inside Framework data: URIs). Landing/page styles are still inline per-renderer (T102).

### T102: Remove per-renderer inline styles (M)  [x] done
- Goal: move the `<style>` strings of `scorecard-view.js`, `peers-view.js`, `explorer-view.js`, `revisions-view.js`, `status-view.js` into `style.css` using tokens, without changing structure or wording.
- Files: `site/src/lib/*-view.js`, `site/src/style.css`, `site/tests/*.test.mjs`.
- Depends on: T101.
- Acceptance criteria: no `<style>` string and no colour literal (`#...`, `steelblue`, named colour) in any `src/lib/*.js` or page `.md`; existing 86 JS tests and 25 smoke tests pass unchanged; the five pages look equivalent in light theme.
- Tests: JS unit; smoke; the static scan in T106 (written there, run here once).
- Risks: class-name collisions between views; Plot's own inline colours (dots use `steelblue`) must use a token passed as an argument.
- Note (2026-11-04): done. All `<style>` strings (scorecard, peers, explorer, revisions, status views and `shell.js`) moved to `site/src/style.css` using `--mm-*` tokens; new tokens `--mm-warn-bg/-border/-ink/-tint` (light and dark) added to `contrast-pairs.mjs` (56 pair checks pass, both themes). Chart colours come from `src/lib/tokens.js` (reads `--mm-*` at runtime). `scripts/lib/contrast.mjs` guard narrowed to reject `--mm-` declarations (not `var(--mm-x)` uses) outside `:root`; 1 test added. New `tests/ux-style-scan.test.mjs` (no `<style>`/style attribute/colour literal in `src/lib/*.js` and page `.md`; seeded-violation test). `npm test` 102 pass, 0 fail; smoke 25 pass, 0 skipped (`MM_SMOKE_CHANNEL=chrome`, `MM_EXPECT_BUILD_ID` from built manifest). Light screenshots: same page heights; table rules use `--mm-border` (darker than before), dots `--mm-pct-4`, muted text via token. Dark caveat boxes now readable. The T106 scan overlaps with this file and can reuse it.

### T103: `copy.js` fixed-string module (M)  [x] done
- Goal: one module for every fixed or confirmed string; views import from it; no wording change.
- Files: `site/src/lib/copy.js`, `site/src/lib/*-view.js`, `site/src/lib/{scorecard,peers,explorer,revisions,status}.js` (only string imports), `site/tests/copy.test.mjs`.
- Depends on: T102.
- Acceptance criteria: AC-UX-13: caveat, "percentile vs all ranked countries", "mean percentile of the domain's indicators" and the not-the-percentile-of-the-domain sentence, M18 note wording rule, V4 fixed text equal to export spec section 7 (reuse the existing spec-file comparison), "earliest stored version"; "first release" and "first stored release" absent from `site/src` and `dist`; judgement words ("good", "bad", "strong", "weak", "healthy", "risky") absent from strings that render next to a percentile; the T89-T93 confirmed strings unchanged (snapshot of rendered text before and after).
- Tests: JS unit with verbatim assertions; before/after rendered-text snapshot from the fixture build.
- Risks: strings built from parts (n/N, dates) must stay in views; only fixed text moves.
- Note (2026-11-04): done after the main session fixed the follow-up below (two glob lines in tests/unit/test_site_spike.py now also read copy*.js; Python unit tests 926 passed, 2 skipped). Done: `site/src/lib/copy.js` (no imports; 77 exports incl. caveat, column and domain labels, not-the-percentile sentence, peer-set note head/tail, all cell/flag texts, V2 filter note and labels, V3 rebase/not-shown texts, V4 vintage text/`earliest stored version`/notices, V5 notes); scorecard, peers, explorer, revisions, status libs and the five `*-view.js` import from it and re-export the old names (no wording change; parts-built strings stay in views). ADR-026 legend/direction strings and other unconfirmed brief section 11 strings NOT added (G2). New `tests/copy.test.mjs` (verbatim table, V4 text vs spec section 7, forbidden phrases built at runtime absent from src and dist, judgement words, every export used). Before/after rendered-text snapshot (`tests/snapshot-rendered.mjs`, Playwright on the fixture build, 15 page states): 0 differ (before run twice, identical). `npm test` 109 pass, 0 fail; `check:contrast` 56 pass; smoke 25 pass, 0 skipped (`MM_SMOKE_CHANNEL=chrome`, `MM_EXPECT_BUILD_ID` from the built manifest). Remaining: `tests/unit/test_site_spike.py` line 335-340 reads only `dist/_import/lib/revisions*.js` for the V4 text and now fails because the text lives in `copy.js`; one-line fix (also glob `copy*.js`) is in `tests/unit/`, which this task was told not to touch. Mark [x] after that fix.

### T104: Global shell (S)  [x] done
- Goal: skip link, header with the `pages` nav, freshness line, stale banner on every page, caveat note, footer and Sources, landmarks, focus ring and target sizes.
- Files: `site/src/lib/shell.js`, `site/src/style.css`, `site/src/*.md`, `site/scripts/lib.mjs` (generated page sources), `site/tests/shell.test.mjs`.
- Depends on: T102, T103.
- Acceptance criteria: AC-DASH-7 unchanged (banner on `known_cutoff` older than 45 days, wording unchanged, `role="alert"`, now on every page); freshness line wording unchanged; one `h1` per page; header/nav/main/footer landmarks; skip link first in DOM order; focus ring 2 px with offset, 3:1 (AC-UX-1 pair declared); `scroll-padding` for sticky elements (2.4.11); controls at least 24 x 24 CSS px (AC-UX-4 part, asserted in T107).
- Tests: JS unit on shell output; smoke page loads.
- Risks: Framework's own sidebar/pager toggles stay off (`sidebar: false`); header must not duplicate Framework chrome.
- Note (2026-11-04): done. Static header through Framework's `header` option (`headerHtml` in `site/src/lib/shell.js`): skip link first in DOM, site title, `pages` nav with `aria-current`; `sidebar`, `pager` and `toc` off. Framework's fixed header bar is restyled to a static block in `style.css`. Generated domain and peer pages had no h1; they now get one static h1 (`lib.mjs`, `prepare-data.mjs` passes the domain name). Stale banner and freshness line already ran on every page (statusBlock), now unit-tested incl. the 45-day boundary. Focus ring 2 px / offset 2 px, 24 px control minimums and `scroll-padding` in `style.css`; the focus pair was already declared, comment added. New copy: `SKIP_LINK_TEXT`, `NAV_LABEL` (listed in `docs/ops/dashboard-ux-baseline.md`). Results: `npm test` 117 pass; `check:contrast` 56 pair checks pass; smoke 26 pass (25 existing plus one new static shell test over every built page), 0 skipped, Chrome channel. Left for T107: the 24 px assertion in a browser, keyboard order and focus-visible checks, and the print rules.

### T105: Loading, empty, error and no-JS blocks (M)  [x] done
- Goal: shared state blocks per ADR-025 decision 10.
- Files: `site/src/lib/state-blocks.js`, `site/src/lib/*-view.js` (use them), `site/src/style.css`, `site/tests/state-blocks.test.mjs`, `site/tests/smoke/browser.smoke.mjs` (new cases).
- Depends on: T103, T104; G2 for the new loading and error sentences (until confirmed, ship the existing wording or a placeholder marked draft in copy.js and not merged).
- Acceptance criteria: AC-UX-8: missing file, schema-invalid file, unknown manifest major and stale `known_cutoff` each produce the specified `role="alert"` block or banner, naming the logical region and consequence, no URL, no raw error text, no partial numbers; empty-group and no-series texts are the confirmed strings plus a next step; loading containers reserve height and set `aria-busy`; `<noscript>` notice present; no animation under reduced motion.
- Tests: Playwright route interception for each failure; JS unit for the blocks.
- Risks: Framework renders cells in the browser, so a pre-JS static caveat may be impossible (T99 d); then the noscript text is the only no-JS content and this is recorded.
- Note (2026-11-04): partial; the code is done, the new sentences are DRAFT and wait for the user's confirmation (G2, Q10), so this must not merge as final wording. `site/src/lib/state-blocks.js` (errorBlock, failureBlocks, busyBlock/setBusy, emptyBlock, loadAll/settle, noscriptHtml) and `pageHead` in `shell.js` are used by the five pages (index.md, status.md, generated domain, peers, explorer, revisions pages in `scripts/lib.mjs`) and by the peers, explorer and revisions views. A failed file no longer throws into Framework: each region gives one `role="alert"` block (logical region name, consequence, data-kind missing/invalid/version; no URL, raw text or number) and no table or chart of that region. `ManifestError` carries a `kind`. Empty-group and no-series keep the confirmed text plus a next step. Loading containers reserve height (`.mm-loading`, 12 rem; 6 rem for the series and revision containers) with `aria-busy`; no animation anywhere, plus a reduced-motion guard. `<noscript>` is static markup in the header (the only no-JS content; recorded in `docs/ops/dashboard-ux-baseline.md`, with the DRAFT list under 'New wording pending confirmation'). No new colour tokens, so `contrast-pairs.mjs` is unchanged. Test edits outside the new files: `copy.test.mjs` (DRAFT pin), `shell.test.mjs` (pageHead instead of the old statusBlock call string), `revisions.test.mjs` ("boom" no longer rendered). Results: `npm test` 127 pass, 0 fail (117 before); `check:contrast` 56 pair checks pass; `check:imports` ok; smoke against a fresh `observable build` of a copy of the fixture export (EXPORT_DIR in the scratchpad), `MM_SMOKE_CHANNEL=chrome`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`: 38 pass, 0 fail, 0 skipped (26 before, 12 new); landing set 40,671 B gz; ruff, ruff format, `mypy --strict src` clean; Python unit tests 926 passed, 2 skipped (network). Not covered: the revisions page loading container has no browser test (the explorer one does); a missing `meta` file other than entities, alerts or recent-revisions is covered by unit tests only; Firefox and Safari not run. Observation: the build now prints 'Warning: 14 broken links' for the `#observablehq-main` skip link of the T104 header (exit 0); not caused by T105 and not changed here.

### T106: Static scans and budgets (S)  [x] done
- Goal: automated source scans and size gates that later tasks rely on.
- Files: `site/tests/ux-static.test.mjs`, `site/tests/smoke/static.smoke.mjs`, `site/scripts/measure-landing.mjs` (CSS and total reporting).
- Depends on: T102.
- Acceptance criteria: AC-UX-3 scan (no colour literal outside `style.css`); AC-UX-11 (dist scan including CSS: no URL outside allowed namespaces, no `@import` of a remote stylesheet, no font file shipped under A1); AC-UX-10 scan extended to every new module (no arithmetic helper, no mean/rank/percentile/composite computation, no banned words; allowed exception list is explicit and contains only the revision bar scale); AC-UX-12 CSS at most 20 KB gz and landing set recorded against the 600 KB internal target and the 1.5 MB limit.
- Tests: the scans are the tests; a seeded violation per scan proves each fails.
- Risks: a scan that allows too much; each exception needs a comment naming its ADR clause.
- Note (2026-11-04): done. New `site/tests/ux-static.test.mjs` (9 tests) and shared rules in `site/tests/support/static-scan.mjs` (not a `*.test.mjs`, so not run alone); `ux-style-scan.test.mjs` now imports the T102 rules from it (2 tests, unchanged behaviour). AC-UX-3 scans every js/mjs/md/html/svg/css file under `src/` except `style.css`, plus `observablehq.config.js`. AC-UX-10 scans all 19 `src/lib` modules with 8 computation rules (compound assignment, `* / % **`, subtraction, addition, `Math.*`, `.reduce`, d3 and Plot transforms, statistics-named functions) plus 3 banned-word rules over lib and pages; formatting, filtering and default sorts are not matched (seeded negatives). AC-UX-11 (`distFindings`) and AC-UX-12 (`landingBudget` in `scripts/lib.mjs`) have seeded failures; the dist runs are two new tests in `tests/smoke/static.smoke.mjs`. `measure-landing.mjs` now prints CSS and total sizes against 20 KB, 600 KB and 1.5 MB and fails on any. Each rule has a seeded violation, and the allow-list is exact (file, rule, source text) and fails when an entry matches nothing. IMPORTANT: the allow-list holds 19 entries, not only the revision bar scale (which does not exist yet; its entry is to be added by the task that builds it). Pre-existing code that the scan flags and that is allowed with a clause: sort comparators (explorer, revisions, scorecard, peers), `rebase.js` (export spec selectors, AC-DASH-6), `Math.min` in explorer, `stale.js` age arithmetic (ADR-010 decision 8), the name `meanChart` (draws the stored domain figure). Four counts on the revisions page (omitted rows, series per country, version ordinal, version total) have no explicit ADR clause and are marked [REVIEW] for the user. Results: `npm test` 136 pass, 0 fail (127 before); `check:contrast` 56 pair checks; `check:imports` 6 files match; fresh `observable build` of the T105 fixture export copy; smoke (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`) 40 pass, 0 fail, 0 skipped; measured CSS 7,455 B gz (limit 20,000); index landing set 40,668 B gz; largest landing set over all pages 293,396 B gz (target 600,000, limit 1,500,000); no URL outside the SVG, XHTML, xlink, XML and xmlns namespaces and one jsdelivr comment string; no font file. ruff, ruff format, `mypy --strict src` clean; Python unit tests 926 passed, 2 skipped (network). Not covered: `scripts/lib.mjs` page-source templates and JS blocks inside page `.md` are not computation-scanned (not checked).

### T107: Playwright UX harness and review artifacts (M)  [~] partial (CI artifact upload awaits OP-07 SHA, blocker B5)
- Goal: reusable helpers for theme, viewport, forced-colors, print, reduced-motion emulation, computed-colour sampling, tab traversal, CLS, and screenshot output.
- Files: `site/tests/smoke/ux-support.mjs`, `site/tests/smoke/ux.smoke.mjs`, `scripts/ci/site-smoke.sh`, `.github/workflows/ci.yml` (artifact step), `tests/unit/test_site_ci.py`.
- Depends on: T100, T101, T104.
- Acceptance criteria: AC-UX-3 sampling in both `colorScheme` emulations reusing `contrast.mjs`; AC-UX-4 generic checks (tab traversal without trap, skip link works, focus indicator width at least 2 px and 3:1, focused box not under the sticky header, targets at least 24 x 24); AC-UX-6 helper for 320/390/768/1280/1920 (no page-level horizontal scroll); AC-UX-12 CLS via PerformanceObserver at most 0.1; AC-UX-7 screenshots (light, dark, print) written to a directory and uploaded as a CI artifact; helper runs against all five pages already.
- Tests: the smoke itself; `actionlint` clean on `ci.yml`; unit test that the workflow still pins actions by SHA.
- Risks: `actions/upload-artifact` needs a verified commit SHA (OP-07 open for the user; blocker B5); until then write screenshots to a git-ignored directory and skip the upload step. CLS in headless Chromium may differ from real browsers.
- Note (2026-11-04): partial; everything except the CI artifact upload is done. New `site/tests/smoke/ux-support.mjs` (theme/viewport/forced-colors/print/reduced-motion emulation, computed-colour sampling through `contrast.mjs`, tab traversal, CLS observer, screenshot writer) and `ux.smoke.mjs` (49 tests over six routes: V1 landing, V1 domain, V2, V3, V4, V5): AC-UX-3 (12: computed tokens equal `style.css` per scheme, plus every visible text element's computed colour on its opaque background at 4.5, or 3 for large text), AC-UX-4 (18: Tab traversal with no trap and every focusable reached, skip link is the first stop and navigates to main, focus outline at least 2 px and 3:1, focused box not under a fixed or sticky element and inside the viewport, targets at least 24 x 24 with the 2.5.8 inline-link exception), AC-UX-6 (6: 320/390/768/1280/1920, no page-level horizontal scroll), AC-UX-12 (6: CLS at most 0.1), AC-UX-7 (7: light, dark and print PNGs per route, 18 files, in git-ignored `site/test-artifacts/`; plus a forced-colors and reduced-motion emulation check). `scripts/ci/site-smoke.sh` and the `ci.yml` site job already run `npm run smoke`, so they run the new file; `ci.yml` unchanged. B5: the upload-artifact step is NOT added and no SHA was invented; the upload awaits an OP-07 SHA (TODO comments in `ux-support.mjs`, `ux.smoke.mjs`, `site-smoke.sh`). Real defects found and fixed (small, `style.css` only): at 320/390/768 px five pages scrolled horizontally because wide tables were not in a scroll container (tables now `display: block; overflow-x: auto; max-width: 100%`), and the V5 status `dl` overflowed at 320 px from an unbreakable run id (`minmax(0, 1fr)` and `overflow-wrap: anywhere`). Harness fix: computed colours come back as `oklch()`/`color()` in this Chrome, so they are normalised to sRGB through a canvas (out-of-gamut link colour is gamut-clipped). Results: `npm test` 136 pass; `check:contrast` 56 pair checks; `check:imports` 6 files; fresh `observable build` of the T105 fixture export copy; smoke (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`) 89 pass (40 existing + 49 new), 0 fail, 0 skipped; CSS 7,481 B gz; `actionlint` clean; ruff, ruff format, `mypy --strict src` clean; Python unit tests 926 passed, 2 skipped (network); `test_site_ci.py` 3 pass. Not covered: text-spacing override (1.4.12) and clipped-text/overlap checks of AC-UX-6, screenshots are not pixel-diffed (by design), the AC-UX-12 weight half is `measure-landing.mjs` (T106). Domains other than labour and peers other than labour are not in the UX run. CLS in headless Chrome may differ from real browsers.

### Stage 1 - state vocabulary and V1 domain heatmap

### T108: State vocabulary module and glyph sprite (M)  [x] done
- Goal: one function from stored cell and summary fields to `{code, signature, accessibleName}` for every state in `scorecard.js`, plus inline SVG glyphs defined once.
- Files: `site/src/lib/states.js`, `site/src/lib/glyphs.js`, `site/src/style.css` (hatch, dotted border, crossed box, ring, triangle, diamond), `site/src/lib/copy.js`, `site/tests/states.test.mjs`.
- Depends on: T103, T101; G2 (state codes and "ahead" tag are new wording).
- Acceptance criteria: AC-UX-2 DOM half: for every row of the brief section 5 table (ranked, stale, lagging, unaligned, ahead, descriptive, n/a, not published, aggregate, inherited, estimate, low coverage, alert watch/alert; feed states are T128) a fixture cell has a unique pair (visible text code, `data-signature`); glyphs are inline SVG with `aria-hidden="true"` beside a visible word; accessible names use the confirmed wording where one exists; a state not in the table throws in tests (exhaustive).
- Tests: JS unit exhaustive over the view-model's state enum (fails if `scorecard.js` gains a state without a mapping).
- Risks: "ahead" and the state codes are unconfirmed wording; the mapping must not claim "ranked" for lagging/unaligned (AC-DASH-9).
- Note (2026-11-05): done. New `site/src/lib/states.js` (`cellState`, `summaryState`, `STATES`, `DECORATIONS`: one row per brief section 5 state, unique code + signature, lagging/unaligned never map to ranked, a status without a mapping throws), `site/src/lib/glyphs.js` (sprite of 7 inline SVG symbols defined once, `glyph()` aria-hidden), `scorecard.js` exports `CELL_STATUSES`/`SUMMARY_STATUSES` and the cell now carries stored fields (percentile when shown, alignment, alert level, ref offset, release, age, limit), `copy.js` additions (G2 approved 2026-11-05: `STATE_CODES`, `AHEAD_TAG`, `AHEAD_NAME`, `SKIP_TO_TABLE`, `DETAILS_SUMMARY`), `copy.test.mjs` pins them and the DRAFT list, `tests/states.test.mjs` (7 tests, exhaustive incl. a scan of `scorecard.js` status literals). Added one state not in the brief table, `plain` (value shown, no percentile, no other explanation: unranked domain, information-only), flagged for review.

### T109: Percentile bins and legend (S)  [x] done
- Goal: display mapping of a stored percentile to one of five bins and a text legend listing only states present on the page.
- Files: `site/src/lib/bins.js`, `site/src/lib/legend.js`, `site/src/lib/copy.js`, `site/src/style.css`, `site/tests/bins.test.mjs`.
- Depends on: T101, T108; G2 (bin labels); blocker M1 (edge inclusivity).
- Acceptance criteria: edges are constants 0.2/0.4/0.6/0.8 (A9); null percentile gets no bin; bins computed from the stored number only (AC-UX-10); legend is a real list (glyph + word) and bin labels carry no judgement words ("lowest fifth of the panel" ... "highest fifth of the panel").
- Tests: JS unit on boundary values 0, 0.1999, 0.2, 0.5, 0.8, 1.0 and null; static scan from T106 covers the module.
- Risks: a bin mapping is arithmetic-adjacent; keep it to comparisons against constants, no division.
- Note (2026-11-05): done. `bins.js` (`binOf`: constants 0.2/0.4/0.6/0.8, lower-inclusive, null has no bin, outside [0,1] throws `BinError`, no arithmetic; blocker M1 settled by ADR-026 decision 6), `legend.js` (orientation note once, 5 bins as `<ol>`, only the marks present as `<ul>`, glyph + word), `style.css` bins/marks/legend, `tests/bins.test.mjs` (4 tests: 0, 0.1999, 0.2, 0.5, 0.8, 0.9999, 1.0, null, invalid). The middle three bin labels ("second/middle/fourth fifth of the panel") are mine, the brief fixes only the first and last: flagged for review. ORIENTATION_NOTE and the four direction labels are in `copy.js` per ADR-026 (user decisions Q1/Q2 recorded 2026-11-04) and ship with G3.

### T110: Heatmap table renderer (M)  [x] done
- Goal: pure HTML table renderer (countries x columns) fed by a view-model, fixture-driven, reusable by T115.
- Files: `site/src/lib/heatmap.js`, `site/src/lib/heatmap-view.js`, `site/src/style.css`, `site/tests/heatmap.test.mjs`.
- Depends on: T108, T109.
- Acceptance criteria: AC-UX-5 part: caption, `th scope` for rows and columns, every cell has text content, `<tbody>` per group (countries; aggregates labelled "aggregate (not ranked)" with no colour), sticky header and first column, container with its own horizontal scroll and a visible scroll hint, informational variant with no colour scale and header "informational, unranked"; tokens only.
- Tests: JS render tests on the fixture (domains labour, prices, agri, global); DOM assertions, no browser needed.
- Risks: width of column headers on a real export (T99 e) may force abbreviated headers; full name in `title` and the detail table.
- Note (2026-11-05): done. `heatmap.js` (view-model: bins, states, legend states, sort), `heatmap-view.js` (caption, `th scope`, `<tbody>` per group, aggregate group with no colour, sticky header and first column inside its own scroll container with a visible hint, informational variant with no colour and "informational, unranked" in the corner header), `style.css`, `tests/heatmap.test.mjs` (11 tests, fixture domains labour, prices, agri, global). Finding: htl wraps a template that starts with a table cell in its own row, so every th/td is its own single-root template (comment in code). Another finding: visually-hidden absolutely positioned text escaped the scroll container and widened the page at 320 px; the container is now `position: relative`. New DRAFT wording (caption, scroll hint, legend titles, fact labels) is listed in the baseline doc.

### T111: V1 domain page uses the heatmap (M)  [~] built, awaiting G3 review (not merged, not committed)
- Goal: replace the summary and dot chart presentation on `domain/<id>` with the heatmap, leading "mean percentile of the domain's indicators" column, n/N, position; keep notices, caveat, peer-set note and alignment table.
- Files: `site/src/lib/scorecard.js` (view-model additions only, no computation), `site/src/lib/scorecard-view.js`, `site/scripts/lib.mjs` (`domainPageSource()`), `site/tests/scorecard.test.mjs`.
- Depends on: T110, T104, T105; G3 before merge.
- Acceptance criteria: AC-DASH-4 all cases unchanged (stale with flag and no rank, n/a at zero availability, agri/global unranked, descriptive without percentile, low coverage shows mean percentile and n/N without position, inherited shows flag and no percentile); AC-DASH-9 marks unchanged; displayed numbers in the stored formatting (A3); label and not-the-percentile-of-the-domain sentence present; AC-UX-10 numbers and bins of sampled cells equal the published scorecard JSON.
- Tests: JS unit; smoke AC-DASH-3 ten sampled pairs still pass.
- Risks: page weight: the detail table moves into T112 and must not be duplicated in the DOM twice.
- Note (2026-11-05): built, awaiting G3 review. `domainBlock(html, view)` now renders notices, caveat, peer-set note, the label sentence, skip link, heatmap (domain figure column, n/N, position, one column per indicator with unit and direction label), legend, alignment table, detail table. Dot plot, summary table and `meanChart` removed (their two allow-list entries removed). `scorecard.js`: view-model additions only (`columns`, `rows`, `directionOf`, stored fields on the cell, `rankPosition`, `aggregate`). `domainPageSource` no longer imports Plot. Default order alphabetical (ADR-026 decision 7). Existing smoke tests were adapted (ready selector `#domain-heatmap tbody tr`, detail table opened before reading, unranked-domain checks on the heatmap and detail table). G3 review items: palette, legend, state signatures, header abbreviations (headers are clamped to 4 lines by CSS with the full name in `title`, no abbreviation list exists), the three derived bin labels, the new DRAFT wording, the one extra state `plain`.

### T112: Cell detail, detail table in `<details>`, sorting (M)  [x] done (rides on T111 review)
- Goal: facts on focus (stored value, unit, reference period, `ref_offset_days`, release date, `age_days` and limit, flags), detail table kept in `<details>`, skip link to it, sortable headers.
- Files: `site/src/lib/heatmap-view.js`, `site/src/lib/scorecard-view.js`, `site/src/style.css`, `site/tests/heatmap.test.mjs`.
- Depends on: T111; G2 (strings "Skip to values table", "Values and reference periods").
- Acceptance criteria: AC-UX-5 (sortable headers are `<button>` with `aria-sort`); facts shown are also present in the detail table (never tooltip-only); popover opens on focus and closes with Escape, no trap (AC-UX-4); sorting orders by a stored field only (stored percentile of the clicked column; default order alphabetical by country name, assumption A12 below); detail table stays in DOM.
- Tests: JS unit on sort order including null last; Playwright keyboard test.
- Risks: A12 (default order and sort fields on the domain page are not stated in the brief; confirm, blocker M2); roving tabindex is out of scope in v1 so the number of tab stops must stay low.
- Note (2026-11-05): done. Facts of a focused or hovered cell (stored value and unit, reference period, reference offset, source release date, age and limit, flags) show in ONE sticky panel with reserved height (`#domain-heatmap-facts`, aria-hidden; screen readers get the full cell name through the button's aria-label), not a floating popover; Escape hides it without moving focus; Tab is never trapped. The same facts are three new columns of the detail table (reference offset, source release, age), kept in a closed `<details>` that stays in the DOM; "Skip to values table" opens it and focuses its summary. Sortable headers are `<button>` in `th` with `aria-sort`: indicator columns by stored percentile (desc, then asc), the domain figure column by stored `rank_position` (user decision Q3 of ADR-026, nulls last), country by name, aggregates never sorted in. A12/M2 are settled by ADR-026 decisions 7 and Q3. Deviation: one tab stop per cell with a value (about 10 x 42 on a real export) as the brief accepts; the skip link bypasses it.

### T113: Stage 1 browser tests and user review (M)  [x] done (user review G3 pending)
- Goal: automated checks for V1 and the review handoff.
- Files: `site/tests/smoke/ux.smoke.mjs`, `docs/ops/dashboard-ux-baseline.md` (stage 1 section).
- Depends on: T107, T111, T112.
- Acceptance criteria: AC-UX-2 browser half (all states rendered under `grayscale(1)`, pairwise-distinct DOM signatures and distinct screenshot hashes; deuteranopia-filter screenshot saved as artifact only); AC-UX-3, -4, -5, -6 on V1 pages; AC-UX-12 CLS and sizes; screenshots light/dark for review (G3).
- Tests: Playwright smoke.
- Risks: screenshot-hash distinctness is sensitive to antialiasing; compare signatures first and hashes within one run only.
- Note (2026-11-05): done. `ux.smoke.mjs` gained 13 tests: AC-UX-2 (grayscale: one signature per state across labour, prices, agri, global, fin and distinct cell-image hashes within one run; deuteranopia screenshot saved as an artifact only), AC-UX-5/15 on five domains (caption, scope, no empty cell, sticky, own scroll container with hint, aria-describedby target, legend once, caveat before legend, details closed and in the DOM), AC-UX-10 (every ranked cell and domain figure and its bin equal the built scorecard JSON), sorting, facts on focus, Escape, skip link and 320 px scroll. The existing AC-UX-3/4/6/12 tests run on the domain page unchanged and pass. Results: `npm test` 158 pass, 0 fail; `check:contrast` 56 pair checks; `check:imports` 6 files; fresh `observable build` of a copy of the fixture export (`EXPORT_DIR`), smoke (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`) 102 pass, 0 fail, 0 skipped; landing set 43,148 B gz, CSS 8,661 B gz. No Python file changed, so ruff/mypy were not run; `uv` was not on PATH, so the Python site tests (`test_site_spike.py`, `test_site_ci.py`) were not run. Not covered: the 42-country real export (fixture has 7 countries and 1 aggregate), Firefox/Safari, a screen reader, print, forced colors on the heatmap, and the 24 px target test is the existing one. Gate G3: nothing committed or merged.

### Stage 2 - landing heatmap (conditional)

### T114: Landing weight check (S)  [ ] todo
- Goal: measure, not build: gzip size of the landing set if every ranked domain scorecard were loaded.
- Files: `site/scripts/measure-landing.mjs` (flag for the all-domains variant), `docs/ops/dashboard-ux-baseline.md`.
- Depends on: T113; real export preferred (G0 fallback applies).
- Acceptance criteria: AC-UX-12: real `gzip -9` total with all domain scorecards, CSS and shell; recorded against 600 KB internal target and 1.5 MB hard limit; recommendation stated; if over 600 KB the landing heatmap is dropped (Q5 rule).
- Tests: script test on the fixture.
- Risks: fixture has 4 domains; a real export has about 8-12.

### T115: Landing country x domain heatmap  [ ] conditional on T114 and G4
- Goal: heatmap on `index` using the stored domain figure; domain list kept as fallback.
- Files: `site/src/index.md`, `site/src/lib/landing-view.js`, `site/scripts/lib.mjs` (`landingSet`), `site/tests/landing.test.mjs`.
- Depends on: T114, G4, T110.
- Acceptance criteria: no overall column, no row aggregate, no composite sort (U1); default order alphabetical, column sort by stored `rank_position` with null last; informational domains listed as links beneath; low-coverage country keeps mean percentile with its mark; AC-UX-10, AC-UX-12.
- Tests: JS unit; static scan for "overall"/"total"/"composite".
- Risks: AC-DASH-2 landing set is defined as one domain scorecard (export spec section 8); the larger set is a deliberate deviation requiring the user's G4 decision on record.

### T116: Landing heatmap tests (S)  [ ] conditional
- Goal: browser tests for T115.
- Files: `site/tests/smoke/ux.smoke.mjs`.
- Depends on: T115.
- Acceptance criteria: AC-UX-4, -5, -6 (heatmap scrolls inside its container at 320 px), -10 (cell numbers equal scorecard JSON), -12.
- Tests: Playwright.
- Risks: as T113.

### Stage 3 - V2 peer comparison

### T117: V2 dot plot restyle (M)  [x] done
- Goal: dot plot with tokens, filled/hollow marks, constant guide lines at 0.25/0.5/0.75 (neutral, unlabelled as quartiles or median), country row labels, no legend.
- Files: `site/src/lib/peers-view.js`, `site/src/style.css`, `site/tests/peers.test.mjs`.
- Depends on: T109, T108.
- Acceptance criteria: AC-DASH-9 and the confirmed V2 wording unchanged; chart draws only rows with a stored percentile; lagging and unaligned stay in the table with their mark; guide lines carry no statistic words; figure wrapper from T120 (or a local `<figure role="img">` with a stored-field label until T120).
- Tests: JS unit; static scan.
- Risks: dependence on T120 for the table alternative; do T120 first if the user prefers one wrapper.
- Note (2026-11-05): done. `peers-view.js`: dot plot is r = 8 dots, row step 34 px, 14 px text, constant neutral guide lines at 0.25/0.5/0.75 (`GUIDES`, token `--mm-border`, no statistic word), ticks 0..1, one-colour (`--mm-pct-4`) filled dots, hollow for estimate or inherited (stored `value_kind`, `inherited`), country row label "<name>: <stored value unit>", ring in `--mm-focus` for the focused country, no legend. Chart draws only rows with a stored percentile; lagging, unaligned, stale and aggregates stay in the table. ADR-026 orientation note and the stored direction label (`directionOf`) sit above the chart. Local `<figure role="img" aria-label>` (T120 not done) then the table alternative with caption, `th scope`, "Skip to values table" link. No arithmetic added (Plot `y.step`). New DRAFT strings in `copy.js` (listed in the baseline doc). `npm test` 164 pass; `check:contrast` 56; `check:imports` ok; smoke (fresh build of the fixture copy, `MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`) 106 pass, 0 fail, 0 skipped. Not verified: real 42-country density, Firefox/Safari, screen reader, hollow marks in the browser (fixture has no estimate).


### T118: V2 controls and URL-hash focus (M)  [x] done
- Goal: peer group as a radio group, sort select, country focus (click or keyboard) kept in `#c=<id>`.
- Files: `site/src/lib/peers-view.js`, `site/src/lib/peers.js` (hash parsing only), `site/tests/peers.test.mjs`, `site/tests/smoke/browser.smoke.mjs`.
- Depends on: T117.
- Acceptance criteria: the six group labels and sort labels unchanged; group only filters and sorts (AC-DASH-9, stored percentile of a row identical with and without the filter); no cookie or `localStorage`; invalid hash ignored; highlight in chart and table; fieldset with legend; targets at least 24 px.
- Tests: JS unit on hash parse; Playwright interaction.
- Risks: radios replace selects, a small change to the T90 interaction tests.
- Note (2026-11-05): done. Peer group is a `fieldset` with legend "Peer group (filter)" and one radio per group (labels unchanged, radios 24 px); sort select unchanged. `radioGroup` in `peers-view.js` exposes `value` so `Generators.input` works; the page template is in `scripts/lib.mjs` (`src/peers/*.md` are generated). Focus: country name buttons (keyboard and click, `aria-pressed`) set or clear `#c=<id>`; `focusFromHash` in `peers.js` accepts only known ids, anything else is ignored; no cookie or storage. Highlight in table row and chart ring. Tests: 6 unit tests, 2 Playwright (browser.smoke), the T90 filter test moved from select to radios, `ux-support.mjs` `focusables` counts a radio group as one Tab stop. Results as T117.


### T119: V2 responsive cards and tests (S)  [x] done
- Goal: compact layout cards (country, percentile, reference offset, mark) and the "reference offset" column on wide screens.
- Files: `site/src/lib/peers-view.js`, `site/src/style.css`, `site/tests/smoke/ux.smoke.mjs`.
- Depends on: T118; G2 if the column heading is new.
- Acceptance criteria: AC-UX-6 at 320/390/768/1280/1920; AC-UX-4, -5 (table caption, `th scope`); stored `ref_offset_days` shown as exported.
- Tests: Playwright.
- Risks: the table-to-cards switch must keep the same facts and reading order.
- Note (2026-11-05): done. New column "Reference offset (days)" (`DRAFT_FACT_LABELS.refOffset`, stored `ref_offset_days`, "n/a" when absent). Up to 40 rem the table becomes cards (CSS only: same cells and order, labels from `data-label`; explicit ARIA roles keep table semantics when `display` is changed). Narrow cards show all six facts, not only four, to keep the same facts as the table. Chart scrolls inside its figure under 36 rem instead of shrinking. Playwright in `ux.smoke.mjs`: offset equals scorecard JSON, same cells in same order at 320/390 and 1280, no horizontal scroll; the generic AC-UX-4/5/6/12 runs on V2 pass. Results as T117.


### Stage 4 - V3 explorer

### T120: Chart figure wrapper and "View as table" (M)  [x] done
- Goal: shared `<figure role="img">` with a generated `aria-label` from stored fields and a disclosure table of the plotted points (latest 24 periods per series, download link to the file).
- Files: `site/src/lib/figure.js`, `site/src/lib/explorer-view.js`, `site/src/style.css`, `site/tests/figure.test.mjs`.
- Depends on: T103, T104.
- Acceptance criteria: AC-UX-5: label names indicator, countries, range and the stored latest value of each series; table matches the plotted points; no extra data fetch (uses loaded data); tooltips never the only access; no drag-only interaction (2.5.7).
- Tests: JS unit on label generation and table/point equality; static scan (no computation in the label).
- Risks: "latest 24 periods" is a display slice, not a statistic; keep it a slice.
- Note (2026-11-05): done. `site/src/lib/figure.js`: `chartFigure` (figure role=img, generated aria-label; generalises the Stage 3 V2 figure, `peers-view.js` now uses it, markup unchanged), `seriesFigureLabel` (indicator, y-axis unit, each country with its range and stored latest value and unit), `latestPoints` (slice of the last 24 plotted points per series, no arithmetic) and `viewAsTable` (closed `<details>` with approved summary "View as table", caption, `th scope`, download link to the loaded file; the link address is resolved in the page with `FileAttachment(...).url()`, no extra fetch). Table = plotted points (unit test and Playwright). `tests/figure.test.mjs` (5). `npm test` 181 pass, 0 fail; `check:contrast` 76 pair checks; `check:imports` ok; fresh build of the fixture export copy, smoke (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`) 114 pass, 0 fail, 0 skipped; CSS 9,440 B gz, landing set 44,989 B gz.


### T121: V3 series styling and vintage cues (M)  [x] done
- Goal: direct end labels for up to 5 series, categorical set of 5-6 hues with dash/marker pairing, hollow markers for EST/PROV, latest-observation hairline, revised-data-history rings, vintage `known_at` in the caption.
- Files: `site/src/lib/explorer-view.js`, `site/src/style.css`, `site/tests/explorer.test.mjs`.
- Depends on: T120, T101 (chart colours declared in the contrast pairs).
- Acceptance criteria: AC-DASH-5 caption table kept; chart colours at least 3:1 (AC-UX-1); hue by selection order, not by data; no confidence bands, no interpolation; alert shapes unchanged (diamond, triangle).
- Tests: JS unit on the style assignment; contrast check for chart colours.
- Risks: label collisions at line ends (halo helps, no collision solver in v1).
- Note (2026-11-05): done. Five series hue tokens `--mm-series-1..5` (light and dark, 10 new contrast pairs vs page and surface, all at least 3:1), each paired with a dash and a marker (circle, square, star, cross, wye; diamond/triangle stay for alerts). Hue by selection order (`checkBoxes.value` is in click order; model `order`), not by data. Per series: line, end label "<country>: <stored latest value> <unit>" with halo, latest-observation hairline, hollow marker for EST/PROV, ring for `load_kind = revision` (revised-data history), markers at every point of non-monthly series. No legend, no bands, no interpolation. Captions table with vintage kept. Not verified: label collisions when line ends are close (no solver, halo only); the ring means a stored `revision` load, not a complete revision history.


### T122: V3 small multiples above 5 series (M)  [x] done
- Goal: facets by country when more than 5 series are selected; "free y-axis" checkbox with a visible statement of which is active.
- Files: `site/src/lib/explorer-view.js`, `site/tests/explorer.test.mjs`.
- Depends on: T121; G2 (checkbox label and statement are new).
- Acceptance criteria: shared y by default; the active mode is written on the page; every facet has a title; one interaction still at most 5 MB gz (no extra fetch); gaps stay gaps (D16).
- Tests: JS unit on the switch rule (count above 5); Playwright selects 6 countries.
- Risks: Plot facet performance with 44 entities.
- Note (2026-11-05): done. Above 5 shown series (`FACET_ABOVE`, `model.facets`): shared y = one Plot with `fy` facets (native shared scale, no extent code); free y (checkbox "Free y-axis (used when more than 5 countries are selected)", DRAFT) = one plot per country. Every facet has a title with the stored latest value; the page writes which y mode is active (`#y-mode`). No extra fetch; gaps stay gaps. Playwright selects 7 countries (recorded 7-country M09 file, see T125). Not verified: 44-country performance and height.


### T123: V3 rebase marks, axes, gaps (S)  [x] done
- Goal: index-100 rule and base-period rule, axis label "index, base period = 100", unit on the axis, year ticks, gaps never filled.
- Files: `site/src/lib/explorer-view.js`, `site/tests/explorer.test.mjs`.
- Depends on: T121.
- Acceptance criteria: AC-DASH-6 unchanged (rebase equals the Python reference within 1e-9; no change to `rebase.js`); title in the confirmed form "<indicator>: <transform>, rebased to 100 at <date>"; display-only scaling note stays visible; no dual axes, areas or 3-D.
- Tests: existing golden test plus JS render assertions.
- Risks: axis label wording is partly new (G2).
- Note (2026-11-05): done. Index-100 rule and base-period rule when rebased, y-axis label with the unit (existing "Index (base period = 100)" for rebased), year ticks (every year for 3 to 12 years, about ten above, Plot default for short ranges), null points kept so gaps are not filled. `rebase.js` untouched; golden test unchanged and passing. Title and display-only note unchanged. New sentence "The grey lines mark the index value 100 and the base period." is DRAFT.


### T124: V3 layout and selection controls (M)  [x] done
- Goal: left rail on wide, `<details>` "Selection" on compact, country fieldset grouped by `meta/groups.json` with "select group" buttons that only toggle checkboxes.
- Files: `site/src/lib/explorer-view.js`, `site/src/style.css`, `site/tests/explorer.test.mjs`.
- Depends on: T120, T105; G2 ("Selection", "select group").
- Acceptance criteria: all control labels unchanged; fieldset with legend, full-row labels, targets at least 24 px (44 px coarse pointer); loading and error blocks from T105 used (one failed series file does not blank the page); NSA rule (AC-DASH-4) unchanged.
- Tests: JS unit; Playwright keyboard traversal.
- Risks: layout shift when the series file loads (CLS).
- Note (2026-11-05): done. `explorerLayout`: left rail from 64 rem (grid), `<details>` "Selection" open from 40 rem and closed below (follows a window change); country fieldset with "Select group: <group>" buttons from `meta/groups.json` on the known cutoff (only toggle checkboxes; all on, or all off if all were on); controls 24 px, 44 px for coarse pointer; T105 loading/error blocks unchanged. Page template (`scripts/lib.mjs`) loads groups, chart goes into `layout.main`. Existing `focusables` helper now ignores content of a closed `<details>`. "Select group" is a DRAFT (the brief section 11 list names "Selection" and "View as table" only). Not verified: CLS with a real, larger file; screen reader.


### T125: V3 browser tests (S)  [x] done
- Goal: end-to-end UX checks for V3.
- Files: `site/tests/smoke/ux.smoke.mjs`.
- Depends on: T121-T124.
- Acceptance criteria: AC-UX-3, -4, -5 (figure label and table equality in the browser), -6, -12 (CLS, one-interaction size unchanged); screenshots saved.
- Tests: Playwright.
- Risks: Wasm load time in CI.
- Note (2026-11-05): done. `ux.smoke.mjs` +8 tests (figure label, hollow/ring/end labels/no legend/gap, table equals points and end labels, facets and free y with no data fetch, select group and hue order, rail vs collapsed Selection at 320-1920 px with 24 px targets, keyboard, rebase marks, CLS at most 0.1); screenshots `explorer-*.png` in `site/test-artifacts/`. The fixture export has 3 countries in M09, so the tests serve a recorded 7-country M09 file (`site/tests/fixtures/explorer-m09-7countries.parquet`, built with `tests/fixtures/site_spike/make_export.py` producer code; DEU last month EST, FRA 2024-06 a revision row, ITA 2024-03 MISS). `npm test` 181 pass, 0 fail; `check:contrast` 76 pair checks; `check:imports` ok; fresh build of the fixture export copy, smoke (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`) 114 pass, 0 fail, 0 skipped; CSS 9,440 B gz, landing set 44,989 B gz.


### Stage 5 - V4 and V5

### T126: V4 revisions table and notice (M)  [~] partial
- Goal: signed value with true minus U+2212, sign triangle, bar length relative to the largest value shown (labelled), class mark as text plus solid/dashed left border, named editions in a separate block.
- Files: `site/src/lib/revisions-view.js`, `site/src/style.css`, `site/tests/revisions.test.mjs`.
- Depends on: T108, T103; G2 (bar-length label, class mark text if new).
- Acceptance criteria: AC-EXP-12 site side and AC-EXP-13(g) unchanged; stored `revision_abs`/`revision_pct` as exported; diverging blue-orange scale only here and for target deviation (AC-UX-1 pairs); the bar scale is the only allowed computation (listed exception in the T106 scan); sign never colour-only (AC-UX-2).
- Tests: JS unit; static scan with the explicit exception.
- Risks: bar length is the one derived display value; it must stay labelled.
- Note (2026-11-05): partial; code and unit tests done, browser smoke not run, bar label is DRAFT. `revisions-view.js`: the Revision (abs) and Revision (%) cells print the stored text with `+` or a true minus U+2212, an inline-SVG triangle (`glyphSprite` once in `ordinaryBlock`; down = rotated by CSS) and `data-sign`; zero has no sign or triangle, null stays "n/a". The % cell has an SVG bar (`data-bar`, width attribute, no style attribute), length = |revision_pct| / largest |revision_pct| of the rows shown (`barScale`, `barPercent`; no Math function), labelled by `#bar-label`. Class mark unchanged text (regular / re-estimation, confirmed) plus a left border on the first cell (solid vs dashed), CSS only. Named editions block and notice unchanged. `revisions.js`: view rows also carry the stored numbers `absNum`/`pctNum` (no recomputation; `abs`/`pct` strings unchanged). `copy.js`: new `DRAFT_BAR_LABEL` ("Bar length (revision %) is relative to the largest revision shown."; the brief quotes "bar length is relative to the largest revision shown", the "(revision %)" part is mine) - needs G2 confirmation; pinned in `copy.test.mjs`. `style.css`: separate V4 block at the end (tokens only; forced-colors fallback). `ux-static.test.mjs`: one ALLOW entry for the bar division line (`/ top) * 100`). 2 tests added to `revisions.test.mjs`. Results: `npm test` 185 tests, 184 pass, 1 fail: the AC-UX-10 scan flags `lib/status.js:69` (`a.feed.rank - b.feed.rank` sort comparator, V5/T128 code owned by another agent; it needs an ORDERING allow entry or a rewrite there); no failure in revisions, copy, contrast or style-scan tests. `check:contrast` 76 pair checks pass; `check:imports` 6 files match. Not covered: `npm run smoke` (not run: other agents were editing status-view and the smoke file at the same time); no visual check of the bar in light/dark/print; bar scales by revision_pct only, so rows with a null pct have no bar.

### T127: V4 vintage step chart (M)  [~] partial (browser render of the step chart not verified)
- Goal: stepped value-vs-`known_at` chart, earliest stored version as a labelled hollow point, tombstone as "x" with the word "removed", FIXED vintage text permanently visible, version table.
- Files: `site/src/lib/revisions-view.js`, `site/tests/revisions.test.mjs`.
- Depends on: T120, T126.
- Acceptance criteria: FIXED text equals export spec section 7 (existing JS test); "first release"/"first stored release" absent; figure wrapper with generated label and table equals plotted points; one file per interaction at most 5 MB.
- Tests: JS unit; Playwright keyboard/visual.
- Risks: step chart with a three-version key and a tombstone is the edge case; keep it in the fixture.
- Note (2026-11-05): partial; code and unit tests done, wording DRAFT, step chart render not checked in a browser. `revisions-view.js`: `stepPoints` (one point per stored version of the single chosen period, stored known_at order, same list as the version table), `stepChart` (step-after line through valued versions, earliest stored version = hollow point labelled with `EARLIEST_LABEL`, tombstone = dashed rule plus text "x removed", no value plotted), `stepBlock` inside `historyBlock` (shown only when exactly one reference period is chosen, else DRAFT_STEP_CHOOSE_PERIOD; figure wrapper with generated aria label listing every point, skip link to the table, note). The FIXED `VINTAGE_TEXT` paragraph sits outside the body, so it is visible in every state (existing test equals export spec section 7). "first release"/"first stored release" absent from `src` (grep). No new file is fetched: the chart reads the same revision file as the table, so the per-interaction size is unchanged. `style.css` already has the `.mm-step` rules (tokens only; `--mm-pct-4`, `--mm-text`, `--mm-bg`). New DRAFT strings, pinned in `copy.test.mjs` and in its DRAFT list, needing G2 confirmation: `DRAFT_STEP_CHOOSE_PERIOD`, `DRAFT_STEP_NOTE`, `DRAFT_STEP_REMOVED` ("removed"), `DRAFT_STEP_FIGURE_LABEL`, `DRAFT_STEP_FIGURE_PART`, `DRAFT_STEP_SKIP`; not added to `docs/ops/dashboard-ux-baseline.md`. Results: `npm test` 187 pass, 0 fail; `check:contrast` 76 pair checks; `check:imports` 6 files; fresh `observable build` of a copy of the T105 fixture export, smoke (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`) 114 pass, 0 fail, 0 skipped. Not covered: no smoke test selects a period on the revisions page, so the rendered step chart (hollow point, cross) is unverified in a browser; an ad-hoc Playwright check was blocked by the sandbox. T129 (`ux.smoke.mjs`, not editable here) should add keyboard/visual checks. Tombstone with a three-version key is covered by unit tests with a fake Plot only; whether the fixture export contains such a key was not checked.

### T128: V5 status chips and layout (S)  [x] done
- Goal: feed-state chips (fresh check, late clock, stale hourglass, broken cross) with word and 1 px border; sort by stored state severity; layout per brief.
- Files: `site/src/lib/status-view.js`, `site/src/lib/states.js` (feed states), `site/src/style.css`, `site/tests/status.test.mjs`.
- Depends on: T108; G2 if chip words are new.
- Acceptance criteria: V5 wording and known gaps ("not exported" for `load_result`) unchanged; whitelisted fields only, no raw error text; no overall traffic light (D6, blocker B2); feed states pairwise distinct in grayscale (AC-UX-2).
- Tests: JS unit; extend T108 exhaustive test to feed states.
- Risks: severity order is an ordering of a stored enum; unknown enum values keep their fixed wording.
- Note (2026-11-05): done. `states.js`: `FEED_STATES` (broken, stale, late, unknown, fresh; word from the existing `STATE_LABELS`, so no new wording and no G2 item; unique word, glyph and signature; `rank` = severity order of the stored enum), `feedState()` (unknown values, including `constructor`/`__proto__`, keep the fixed "unrecognised state"), `FEED_GLYPH_NAMES`. `status.js`: groups sorted by stored severity, exported order kept within a state (comparator without subtraction, to satisfy the AC-UX-10 scan). `status-view.js`: chip = decorative inline SVG (check, clock, hourglass, cross, dash; local sprite `mm-fg-*` because `glyphs.js` is outside this task's file list) + visible word + 1 px border (solid, dashed, dotted, hatch+bold, double) in `--mm-feed-*` (already contrast-checked); table, notes and "not exported" load column unchanged; no overall indicator. `style.css`: separate V5 block appended at the end. Tests: `status.test.mjs` (+1: order, chips, aria-hidden glyphs, no overall state; one index updated for the new order), `states.test.mjs` (+1: exhaustive over the stored enum, pairwise distinct, unknown). `npm test` 185 pass, 0 fail; `check:contrast` 76 pair checks; `check:imports` 6 files. Not run: smoke (T129 owns the browser checks); grayscale distinctness is by construction (glyph, border pattern, word), not measured. Layout is the existing table with the chip in the State column; the brief's V5 layout was not located, so no further restructuring was done.

### T129: V4 and V5 browser tests (S)  [~] partial (see Note)
- Goal: UX checks for the two views.
- Files: `site/tests/smoke/ux.smoke.mjs`.
- Depends on: T126-T128.
- Acceptance criteria: AC-UX-2 (feed and class marks), -3, -4, -5, -6, -8 (error blocks on these views), -12.
- Tests: Playwright.
- Risks: none specific.
- Note (2026-11-05): tests done and green; marked partial because the V4 and V5 wording they exercise is still DRAFT (G2) and for the gaps below. `ux.smoke.mjs` gained 15 tests (114 to 129 in the smoke run). AC-UX-2: V5 feed chips (one chip per group, aria-hidden glyph, state word as the only accessible text, unique signature/word/glyph/border pattern per state, distinct grayscale images) and V4 class marks (class word, flag mark, dashed edge for re-estimation vs solid for regular, written signs, aria-hidden triangles). V4 step chart (T127; listed under AC-UX-5 in the test names): three-version key with hollow earliest point, tombstone key as a dashed rule plus "removed" with no value point (the fixture export already holds one, FRA M09 2026-06; no fixture was edited and the scratchpad copy is a plain `cp -R`), keyboard skip link to the version table. The test for the forbidden "first release" naming builds its regex with a `e` escape, so the static scans (T106, copy tests) do not flag the test file. AC-UX-3 (V4 with chart and V5 chips, light and dark: border/glyph 3:1, word 4.5:1, text-contrast scan), AC-UX-4 (V4 with chart: Tab traversal, no trap, focus ring, targets), AC-UX-6 (V4 with chart at 320/390/768/1280/1920; V5 chips do not wrap or clip at 320 px), AC-UX-8 (V4 revision-file failure and V5 status failure, light and dark: `role="alert"`, 1 px border, readable text, no overflow at 320 px, no focus trap), AC-UX-12 (CLS at most 0.1 when a period is chosen and the chart appears). Results: `npm test` 187 pass, 0 fail; fresh `observable build` of a copy of `tests/fixtures/export` in the scratchpad (`EXPORT_DIR`), smoke (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`): 129 pass, 0 fail, 0 skipped; no `src/` change was needed; `check:contrast` 76 pair checks pass; `check:imports` 6 files match. Not covered: AC-UX-4 keyboard/target checks on V5 beyond the existing page-level run (T107), AC-UX-12 on V5, Firefox and Safari, screen reader, print (T130), forced colors on chips and step chart, the 42-country real export (fixture has 7 countries), CLS with real data.

### Stage 6 - print, polish, cross-browser, screen reader

### T130: Print stylesheet (M)  [~] partial (see Note)
- Goal: `@media print` per ADR-025 decision 9.
- Files: `site/src/style.css`, `site/tests/smoke/ux.smoke.mjs`.
- Depends on: Stages 1-5.
- Acceptance criteria: AC-UX-9 print: light tokens forced, controls hidden, `<details>` expanded, fills and patterns kept (`print-color-adjust: exact`), freshness line, caveat, Sources and page URL present, rows not broken across pages, no table clipped, `page.pdf()` succeeds on all five views; print screenshots saved (AC-UX-7).
- Tests: Playwright print emulation and PDF.
- Risks: wide heatmap at page width may be unreadable; check numbers stay at least 8 pt equivalent.
- Note (2026-11-05): done in code and tests; marked partial because only Chromium (channel chrome) was exercised and real PDFs were not read by a human. `style.css`: `@media print` block plus print-only `.mm-print-url`; the dark token block is now `@media screen and (prefers-color-scheme: dark)` and the dark Framework theme import is `screen and (...)` (light import also `, print`), so print keeps light tokens under a dark scheme; `scripts/lib/contrast.mjs` DARK_MEDIA accepts the `screen and` form (+1 assertion in `contrast.test.mjs`). Controls hidden (nav, skip link, selects, radio groups, group buttons, explorer selection rail, sticky facts panel); tables forced to `display: table`, 100% width, wrapping cells, no scrollers, sticky cells static; `tr` break-inside avoid, header row repeats; fills kept via `print-color-adjust: exact`; text 9 to 10.5 pt. Framework's `default.css` hides the footer in print with `!important`, overridden. `observablehq.config.js` footer (config file, not in the task file list, needed for the page URL): print-only "Page URL" filled by a small inline script that also opens closed `<details>` on `beforeprint` and restores them on `afterprint` (justification: CSS `::details-content` is not supported by every browser; the CSS path is the fallback, the script the second path; both tested, the CSS path in emulation, the handler by dispatching the events). Smoke: 7 new tests (five views plus landing, V1 domain, handler), run at 704 px (A4 minus 12 mm margins) under dark scheme + print: light `--mm-bg`, exact colour adjust, no visible controls, closed details content visible, freshness line, caveat, Sources, URL, no clipped table/figure, no document overflow, `tr` break-inside avoid, no text below 8 pt (HTML), `page.pdf()` A4 starts `%PDF` for all six routes; PDFs and `*-print.png`, `*-print-dark-scheme.png` in git-ignored `site/test-artifacts/`. Results: `npm test` 187 pass; `check:contrast` 76; `check:imports` 6; fresh build of a copy of the fixture export, smoke 136 pass, 0 fail, 0 skipped. Gaps: chart (SVG) text measured 13-14 px (9.8-10.5 pt), fine; narrow columns break words mid-word (`overflow-wrap: anywhere`, e.g. "Germa/ny" in the detail table), cosmetic; selected control values (indicator, peer group) are not printed because controls are hidden; the 42-country real export heatmap width at 704 px is unchecked; Firefox/Safari print and real browser Print dialog (beforeprint path) not checked; the T126/T127 wording is still DRAFT.

### T131: Forced-colors, reduced-motion, preference polish (S)  [~] partial (see Note)
- Goal: honour `forced-colors`, `prefers-reduced-motion`, optional `prefers-contrast: more`.
- Files: `site/src/style.css`, `site/tests/smoke/ux.smoke.mjs`.
- Depends on: T130.
- Acceptance criteria: AC-UX-9: under `reducedMotion: reduce` no transition runs; under `forcedColors: active` state signatures (text code, border, glyph) remain on every state fixture; numbers remain in heatmap cells.
- Tests: Playwright emulation.
- Risks: Chromium forced-colors emulation differs from Windows high contrast (manual check).
- Note (2026-11-05): tests done and green; marked partial for the manual and uncovered items below. `style.css`: a global `prefers-reduced-motion: reduce` rule (no animation, transition or smooth scroll on any element or pseudo-element; the T105 `.mm-state` rule stays); a `forced-colors: active` rule that maps the V4 step chart's attribute-set SVG stroke and fill to `CanvasText` (Plot's colours are attributes, which forced colours does not remap; hollow ring and `none` paints are excluded); `prefers-contrast: more` (cheap form: state borders of cells, keys, state blocks and feed chips take the text colour; no token is redefined because `check-contrast` rejects tokens under that query). `ux.smoke.mjs` gained 11 tests (T131 describe): reduced motion on all six pages (computed duration of every element and `::before/::after`, also after Tab and hover); forced colours before/after comparison of text code, four border styles and widths, and visible glyphs for V1 heatmap cells (all ten states over the five domains, numbers present in ranked cells), V5 chips (fresh, late, stale, broken), V4 class cells (regular, reestimation) with dashed/solid edge, flag mark and written signs; V4 step chart marks (Germany: hollow ring, filled points, value line; France: dashed removal rule, "removed" label) stay drawn, labels unchanged, paint not equal to the canvas colour. Results: fresh `observable build` of a copy of the fixture export (scratchpad `export-t131`; `tests/fixtures/export` holds only the generator, so the copy is of the previously generated fixture export from the T130 run, a plain `cp -R`; EXPORT_DIR), smoke (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`): 147 pass, 0 fail, 0 skipped (11 of them new in T131); `npm test` 187 pass; `check:contrast` 76 pair checks pass; `check:imports` 6 files match. Not covered: Windows High Contrast and Chromium's emulation differ (system colour mapping, SVG handling, backplates): manual check for T134; forced colours on V2 dot plot and V3 chart (their series hues are not remapped; end labels carry identity); `prefers-contrast: more` has no test; Firefox and Safari; no Python or `src/` change.

### T132: Full responsive and text-spacing pass (M)  [x] done
- Goal: all views at the five widths, text-spacing override, long names.
- Files: `site/src/style.css`, `site/tests/smoke/ux.smoke.mjs`.
- Depends on: T131.
- Acceptance criteria: AC-UX-6: no page-level horizontal scroll at 320/390/768/1280/1920 (scrolling only inside table containers), no clipped text or overlapping controls, 1.4.12 text-spacing override gives no clipped text, screenshots saved.
- Tests: Playwright matrix.
- Risks: real-export long labels (T99 e) may need abbreviation rules.
- Note (2026-11-05): done. `ux.smoke.mjs` T132 describe (20 tests; 147 to 167 in the smoke run): for V1 landing, V1 domain (agri), V2 (fin), V3, V4, V5 plus V4 with the step chart drawn (Germany, three versions) and with the removal rule (France), each at 320/390/768/1280/1920 with default spacing and with the WCAG 1.4.12 override (line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraph spacing 2em, injected as `!important` CSS): no page-level horizontal scroll (`horizontalOverflow`), no clipped text (overflow hidden/clip or ellipsis boxes whose content is wider or taller, clipping ancestors that hide part of a text element, SVG text outside its svg viewport; scrolling table containers and visually hidden text are excluded by design), no overlapping controls (links, buttons, selects, inputs, summaries; boxes cut to scroll containers, per line box for wrapped links). 100 screenshots (`t132-*`) in git-ignored `site/test-artifacts/`. Review found the describe complete against AC-UX-6; no gap needed filling and no further `style.css` change was needed in this pass beyond the earlier edits. Results: fresh `observable build` of a plain copy of the scratchpad `export-rf` fixture export (`EXPORT_DIR`), smoke (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`) 167 pass, 0 fail, 0 skipped (the T129 AC-UX-8 timeout did not recur); `npm test` 188 pass; `check:contrast` 76 pair checks pass; `check:imports` 6 files match; no `src/` or Python change. Not covered: other domains and peers pages than agri and fin; the 42-country real export and its long labels (T99 e; fixture has 7 countries, so abbreviation rules remain unverified); pages are not tested with the text-spacing override in print or forced colours; Firefox and Safari; real devices (Chromium emulation only); screenshots are not pixel-diffed.

### T133: Final weight, stability and dependency re-check (S)  [~] partial (numbers on the fixture only; re-run on the first real export)
- Goal: close the numeric gates on the real export if available.
- Files: `docs/ops/dashboard-ux-baseline.md` (final section), `site/scripts/measure-landing.mjs`.
- Depends on: T132; real export (G0 fallback: re-run when it exists).
- Acceptance criteria: AC-UX-12 (CSS at most 20 KB gz, landing set at most 600 KB internal / 1.5 MB hard, CLS at most 0.1 V1-V5, one interaction at most 5 MB gz); AC-UX-11 final dist scan; `npm-imports.lock` unchanged; no new dependency in `package.json` or the lockfile (diff checked); ADR-024 licence listing needs no entry under A1.
- Tests: scripts and smoke.
- Risks: numbers on the fixture are not evidence for the real export; labelled accordingly if no real export.
- Note (2026-11-05): partial: all gates pass on the fixture (`export-rf` copy, fresh build), none is evidence for the real export (G0 fallback; re-run on the first real export). CSS 10,350 B gz; landing set 46,427 B gz, all-domains variant 50,445 B gz (600 KB target and 1.5 MB limit both met); CLS at most 0.1 on V1-V5 (smoke); first interaction 1,822,000 B gz (at most 5 MB); AC-UX-11 dist scan passes; `npm-imports.lock`, `package.json` and `package-lock.json` sha256 unchanged, dependencies still framework, plot, d3, playwright; no ADR-024 licence entry needed. `npm test` 188 pass, `check:contrast` 76, `check:imports` 6 files, smoke 167 pass, 0 skipped. Added flag `--all-domains` to `site/scripts/measure-landing.mjs` (the T114 flag; T114 stays todo, T115 not built); no script test for it. Full table: `docs/ops/dashboard-ux-baseline.md` section "Final re-check (T133)".

### T134: Manual accessibility and browser checks (user) (S)  [~] template ready, waits for the user's record
- Goal: AC-UX-14, done by the user (A7).
- Files: `docs/ops/dashboard-ux-manual-check.md` (template with fields, filled by the user).
- Depends on: T132.
- Acceptance criteria: one VoiceOver (Safari) pass over the V1 domain page, V3 and V4; Firefox and Safari visual check (ADR-023 C5; closes BB16 in T94); browser and OS versions and findings recorded. Findings become new tasks, not silent fixes.
- Tests: manual; planner provides the checklist (heading order, table reading "Germany, Unemployment rate, 0.70", sortable header announcements, chart label and table, banner announced once).
- Risks: depends on the user's time; plan closes only after this or an explicit waiver by the user.
- Note (2026-11-05): template ready at `docs/ops/dashboard-ux-manual-check.md` (environment, local start, VoiceOver V1 domain/V3/V4 plus stale banner, Firefox and Safari visual V1-V5 at desktop and phone, real print dialog, Windows High Contrast, reduced motion, findings table); all result cells empty. Waits for the user's record; no check has been run and none is claimed.

- Review fixes (2026-11-05, from a manual Chrome review; not a separate task): (1) heatmap cells printed value and word with no gap because the unclassed wrapper span (htl fragment span, also the aria-hidden span) was the flex item, so the `.mm-cell` column gap did not apply; `style.css` rule is now `.mm-cell span:not([class]) { display: contents; }`, text unchanged, measured gap 4 px in Chrome. (2) Revision size text: the fixture producer `tests/fixtures/site_spike/make_export.py` now rounds `abs_change` to 0.01 and `pct` to 0.1 before building the tables; the REAL producer `src/macro_monitor/publish/revisions.py` (lines 110, 153-154, 167-168: `d / abs(prev) * 100` stored as float64, no rounding) is unchanged and will still export full-precision floats: REPORTED, needs a decision (producer rounding or an ADR on the display rule); the browser does not round (A3). (3) `revisions-view.js` summary line now singular/plural ("1 reference period", "1 stored version"); test added in `revisions.test.mjs`. (4) The fixture gave M10 "Employment rate" the `good_dir`/`adverse_dir` of M09 (lower is better); fixture now sets higher is better for M10. Real config unaffected: `config/indicators.yaml` M10 is "Youth unemployment (<25)" with `good_dir: -1` (line 164), so the fixture name does not match the real M10 (fixture-only naming, not changed).

### T135: Close-out record (S)  [~] record written, open items remain
- Goal: record what was met and what was not, per AC-UX-1..14, and propose v1 plan note text.
- Files: `docs/ops/dashboard-ux-baseline.md` (results section), `docs/ops/spike-results.md` NOT edited; a proposed note text for T88-T94 is placed in the results section for the user.
- Depends on: T133, T134.
- Acceptance criteria: a table of AC-UX-1..14 with met / partly / not met and the evidence (test name or record); open items listed; no claim for AC-UX-14 without the user's record; no edit to the approved v1 plan.
- Tests: none.
- Risks: partial results must say partial.
- Note (2026-11-05): record written, open items remain; not [x] because T134 is pending. Results section added to `docs/ops/dashboard-ux-baseline.md` ("Results: close-out record (T135)"): AC-UX-1..14 table (met 8, partly 5, not met 0, pending user 1; AC-UX-14 pending the user's record), 11 open items, and the proposed T88-T94 note text for the user to apply (v1 plan not edited). `npm test` 188 pass confirmed 2026-11-05; test names checked by grep. Weight and CLS numbers are fixture-only.

## 3. Blockers and open questions for the user

- B1 / Q3 percentile orientation (design gap; ADR-025 assumed unclear). FINDING, read-only: the stored percentile IS oriented. `docs/specs/analytics-and-r-contract-spec.md` (rank modes, line 67): for `monotone_good`, "Higher percentile = better"; `src/macro_monitor/analytics/scoring.py` computes `(W + 0.5 T)/n` with W the number of entities that are WORSE (larger badness; `-value` for `good_dir = +1`, `value` for `-1`), and for `target_distance` badness is the distance to target, so a higher percentile means closer to target. `descriptive_only` has no percentile. The domain figure is the mean of these oriented percentiles (`scorecard.py`). So a high percentile means a more favourable position for ranked indicators; it is not a "plain rank of the transformed value". Consequence: ADR-025's reasoning for a neutral scale ("no good/bad meaning") is partly inaccurate. The plan implements the approved ADR (neutral sequential scale, no judgement words). USER DECISION needed: keep the neutral scale and the caveat as is, or amend ADR-025 and the legend text to state that higher means a more favourable position. Not resolved by the planner. Affects T101, T109, T111.
- B2 / Q6 overall freshness state: the pipeline does not export one, and D6 forbids the browser deriving it. Adding it is an export-spec and `status.json` schema change (design phase, ADR/spec first). The plan assumes NO overall indicator (T128 shows the per-group list). If the user wants one, a design change must be approved before a new V5 task.
- B3 / Q10 new wording (G2): bin labels, state codes, "ahead" tag, "View as table", "Skip to values table", "Selection", "select group", free-y statement, loading/error sentences, print footer, heatmap caption. T105, T108, T109, T112, T119, T122-T124, T126, T128 cannot ship these until the user confirms; until then they use placeholders marked draft or hold.
- B4 / G0 Eurostat fix: in progress and outside this plan; Stage 0 should start after it, or on the fixture with T114 and T133 re-run on the first real export.
- B5 CI artifact upload: `actions/upload-artifact` needs a verified commit SHA (OP-07, same gap as `setup-node`/`cache` in T94). Until the user supplies or approves it, screenshots are written locally and the CI upload step is not added (T107).
- M1 minor design gap: bin edge inclusivity is not stated (value exactly 0.2/0.4/0.6/0.8 or 1.0). Plan assumes lower-inclusive, top bin includes 1.0 (A9). Confirm.
- M2 minor design gap: the brief gives sorting only for the landing heatmap. The domain heatmap is required to have sortable headers by AC-UX-5 wording, but the default order and the sort field are not specified. Plan assumes alphabetical default and sorting by the stored percentile of the clicked column (A12). Confirm.
- M3 [UNVERIFIED] Framework items (T99): `style` option, theme variable names, static-file copy, no-JS rendering. If any contradicts ADR-025, stop and report; an ADR update is needed first.
- M4 AC-UX-12's landing set (all domain scorecards) differs from the AC-DASH-2 definition (one domain scorecard, export spec section 8); only relevant if G4 opts in, then record the deviation as a user decision.

## Deferred (not scheduled)
- Inter font (Q1 default is system stack): a later small task set (subset file, `OFL.txt`, checksum note, `font-display: swap`, size-adjusted fallback, ADR-024 licence entry, AC-UX-11/12 measures) only if the user asks after seeing the system-stack build.
- Manual theme toggle (Q2), x100 percentile display (Q4), axe-core and `@playwright/test` pixel baselines (Q8, each needs its own ADR), Figma mock-ups (Q9).

## Summary of risks
Highest: B1 (colour semantics may mislead if the orientation is not stated), real-export density unknown until G0, Framework unverified items (T99), landing weight if G4 opts in, thin manual accessibility coverage without axe-core (T134 matters), dark-theme contrast tuning doubling review.

## User decisions recorded 2026-11-04 (stated in session: "move as recommended")

- B1 percentile orientation: keep the neutral colour scale and the standing caveat; amend ADR-025 by a new ADR so the legend states that a higher percentile means a more favourable position by each indicator's stated direction. Stage 1 legend and copy tasks wait for that ADR to be approved.
- B2 overall freshness state: no new export field; V5 stays a per-group list.
- M1 bin edges: lower-inclusive, with 1.0 in the top bin.
- M2 domain-page sorting: alphabetical by default; sorting by the clicked column's stored percentile.
- B3 new wording: to be confirmed by the user when the Stage 1 build is reviewed.
- Plan approved by the user on 2026-11-04 (stated in session: "Approve plan").
- On 2026-11-05 the user accepted the DRAFT wording of T126/T127 (DRAFT_BAR_LABEL, DRAFT_STEP_*) "for now" as it stands; the strings stay marked DRAFT in code.
