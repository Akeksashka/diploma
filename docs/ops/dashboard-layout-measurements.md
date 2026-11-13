# Dashboard layout measurements (ADR-034, plan `docs/plans/dashboard-layout-implementation-plan.md`)

## Baseline (task L1), 2026-11-10

Recorded by the data-engineer at the start of L1/L2/L4, after L3 and L5 were done. Fixture exports only; no real export was used. Node v20.18.1, HEAD 035d9af, branch redesign/checkpoint-2026-11-08.

### Working tree of `site/` at the start (git status, `site/` only)
Modified (uncommitted, not part of L1/L2/L4 unless noted): `scripts/contrast-pairs.mjs` (L2 pairs, half-started), `scripts/prepare-data.mjs`, `src/lib/copy.js` (L3), `src/lib/hash.js` (L4 already extended at task start), `src/lib/indicator-model.js`, `src/style.css` (L2 tokens and classes already present), `tests/copy.test.mjs`, `tests/hash.test.mjs` (L4 tests already present), `tests/indicator-model.test.mjs`, `tests/prose-scan.test.mjs`, `tests/ux-static.test.mjs`. Untracked: `src/lib/filter-model.js`, `tests/filter-model.test.mjs` (L5). `src/index.md` was clean.
Test state at the start: `npm test` had one failure (contrast "repository tokens": `--mm-card-border` had no declared pair).

### Build inputs
Two fixture exports exist; the plan names only the first.
- `site/tests/fixtures/sparse_export` (synthetic, build_id `synthetic-sparse-fixture`, 44 entities). Used by CI for `measure:*`; the unit tests read it directly.
- `tests/fixtures/site_spike/make_export.py <dir>` (build_id `2026-11-01T04:30Z-r1`, 7 countries + EA). The smoke suite (`ux.smoke.mjs`, `home.smoke.mjs` and others) asserts on this export (M09, labour, DEU ...); on the sparse export 15 smoke tests fail because the committed `src/index.md` is generated from the first fixture. Smoke was run against this one.
- `npm run build` runs `prepare-data.mjs`, which REWRITES the tracked file `site/src/index.md` from the export in use (the other generated pages are git-ignored). After building from the sparse export `src/index.md` must be restored to HEAD (done here; verified clean with git status).

### Test counts (before my edits, then after L2 and L4)
| Command | Start | End of this run |
|---|---|---|
| `npm test` | 420 tests, 1 fail (contrast), 1 skipped | 424 tests, 423 pass, 0 fail, 1 skipped |
| `npm run check:contrast` | fail (undeclared token) | 102 pair checks passed |
| `npm run check:imports` | pass (6 files match lock) | pass |
| `npm run build` | pass (both exports) | pass |
| `npm run smoke` (site_spike export) | not run | 279 tests, 247 pass, 0 fail, 32 skipped (all skips: "needs the synthetic sparse fixture export", i.e. they run only on the sparse build) |

### CSS size
- `site/src/style.css`: HEAD 9,805 B gz (plain gzip of the source); working tree after L2: 10,502 B gz (+697 B).
- Built CSS (`measure:landing`, minified, hashed): 11,836 B gz of the 20,000 B budget. The redesign record of 2026-11-09 said 11,430 B gz; the difference is the L2 layout block and the earlier uncommitted tokens. Headroom: about 8.2 KB gz.

### measure outputs (before any card exists; home still the old link-list page)
Sparse export (`synthetic-sparse-fixture`, dist 1,900,117 B raw): home first load 53,784 B gz; country worst SYA2.html 274,735 B gz; indicator worst T01.html 283,217 B gz; explorer page-own files 267,616 B gz; domains 49,788 B gz; revisions 265,619 B gz; home CLS 0.0119, country 0.0174, indicator 0, explorer 0.0033, domains 0.001, revisions 0.0074; all PASS. History interaction not measured (no series files in this fixture).
Spike export (`2026-11-01T04:30Z-r1`, dist 6,825,787 B raw): home first load 54,027 B gz; country worst POL.html 343,304 B gz; indicator worst M09.html 351,823 B gz; explorer 2,090,886 B gz (page-own files); domains 50,169 B gz; revisions 335,998 B gz; one history interaction (labour-M09 on DEU.html) 1,753,536 B gz of 5,000,000; no FAIL.
Both are fixtures, not a real export (AC-RD-53 real part stays with L16).

### Exported API names (actual, for later tasks)
The plan's section 2 names match, with these exact exports:
- `hash.js`: `emptyHashState()`, `parseHash(hash, known = {}, {maxEntities = Infinity} = {})`, `serializeHash(state = {})`. `known` may carry Sets `indicators`, `entities`, `groups`, `domains` and `bounds: {from, to}` (years).
- `sort.js`: `sortRows(rows, field, {dir = "asc", nameKey = "name"} = {})`, `ariaSort(state, field)` (state `{field, dir}`). `heatmap.js` has its own `sortRows(model, sort)`, `nextSort`, `SORT_START`, so the two `sortRows` differ; import by path.
- `heatmap-view.js`: `countryHref(entityId)`, `indicatorPageHref(indicatorId)`, `heatmapTable(html, model, {idPrefix, sortState})`, `factsView(html, row, col, entry)`, `heatmapFigure(html, model, {idPrefix})`. Model builder is in `heatmap.js`: `heatmapModel(view)`, `LEGEND_ORDER`.
- `scorecard-view.js`: `detailTable(html, view)`, `alignmentTable(html, view)`, `domainBlock(html, view)`. View model builders live in `scorecard.js`: `validateScorecard`, `formatPercentile`, `formatValue`, `directionOf`, `indicatorCell`, `entitySummary`, `sortSummaries`, `domainView(sc, {entities, indicators, domains})`.
- `state-blocks.js`: `failureKind`, `settle`, `loadAll(specs, derive = null, deriveRegion = null)`, `errorTitle`, `errorBlock`, `failureBlocks`, `busyBlock(html, what, {id, visible})`, `setBusy(el, on)`, `emptyBlock(html, {id, text, next})`, `noscriptHtml`.
- `home-lists.js`: `countryGroups(entities)`, `indicatorGroups(indicators, domains)`, `homeListsHtml({entities, indicators, domains})`, `matches`, `applyFilter(section, query)`, `mountFilters(doc)`.
- `filter-model.js` (L5): `yearOf`, `periodBounds`, `presetRange`, `comparisonSet`, `countryOptions`, `indicatorsOfDomain`, `indicatorsOfFrequency`, `indicatorList`, `frequencyOptions`, `seriesOfFrequency`, `clipToPeriod`, `splitByPeriod`, `countPeriodHiddenRows`.

## L2 (tokens, grid, card, band), 2026-11-10
- Tokens added for both themes: `--mm-canvas` (light #f2f4f7, dark #0b0f14), `--mm-card` (#ffffff, #131920), `--mm-card-border` (#858d97, #66707c), `--mm-band-bg` (#dde3ea, #1b232d), `--mm-band-ink` (#1a1d21, #e8ebef), `--mm-tile-number-size` 2rem (length; `--mm-tile-` registered as non-colour prefix).
- Contrast pairs declared (all pass): text and muted text on canvas and card, band ink on band, `--mm-border`, `--mm-focus` and the five series hues on card/canvas/band, `--mm-card-border` on card and canvas at 3:1.
- Adjustments to meet the limits (ratios were never lowered): the candidate canvas #eef1f5 gave `--mm-border` on canvas 2.964:1 (limit 3), so the canvas was lightened to #f2f4f7 (3.047:1). The card edge was first declared as a decorative pair at 1.1:1, but `contrast.test.mjs` ("pair table is well formed") only allows 3 and 4.5, so the edge is held to 3:1 on card and canvas; this makes the edge darker than a typical decorative border (amendment 3 calls it "decorative").
- CSS: `.mm-grid` (12/6/1 columns at 64 rem and 40 rem), `.mm-card`, `.mm-card--span-3|4|6|8|12`, `.mm-card--tile|rank|heat|table|series` min-heights (first estimates; L27 measures), `.mm-band` with `h2` and optional link, card `h3` and `.mm-card-sub`, `.mm-tile-number`, forced-colors border, print, reduced motion (the existing global rule already disables transitions; none is added). Canvas background on `body` (print keeps the white page).
- Tests: `ux-style-scan.test.mjs` (tokens in both themes, breakpoints, spans, forced-colors, no colour literal or transition in the block, seeded negative); `ux.smoke.mjs` ("L2 ... .mm-grid columns", injects a probe grid on /domains: 1/1/6/12/12 columns at 320/390/768/1280/1920, no overlap, clip or page scroll, band `h2`, no nesting, forced-colors border).
- Not done: existing pages are not wrapped in `.mm-card` (the plan says "wrap only"; the home page is rebuilt in L11 and the entity pages in L22-L24, and wrapping generated pages now would be rewritten there). Only the canvas background reaches the existing pages. Reported to the orchestrator.

## L6 and L7 (filter store, reactive proof, filter bar), 2026-11-10

### L6 verdict: VERIFIED (no new dependency)
- `createFilterStore` (`src/lib/filter-store.js`) drives Framework 1.13.4 reactive cells through `filterGenerator(Generators, store)`, a `Generators.observe` generator (yields the state, then every change; its dispose detaches the `hashchange` listener and the subscription). A cell that mentions `filters` re-runs on each change. The generator is generated into the home page by `homePageSource` in `scripts/lib.mjs`, so it survives `npm run build` (index.md is rewritten from that generator).
- Proven in a real browser (`tests/smoke/filterbar.smoke.mjs`, site_spike export): a select change re-renders the proof card (`#filter-proof`, `data-renders` increments), the hash is written once with `replaceState`, `history.length` is unchanged, setting the same value renders and writes nothing, a `hashchange` and Back/Forward re-read state and the select without any write, no hash write on load (with or without a hash), Reset clears the hash.
- Proof card (`src/lib/filter-proof.js`) is throwaway-but-kept; remove or reuse in L10/L11.

### Pinned rule: a selected indicator that falls out of a narrowed list
When a user change of Domain or Frequency narrows the Indicator list and the selected indicator is no longer offered, the selection is CLEARED (`i = null`). Reason: a select cannot show a value it does not offer, and a hidden kept value would drive cards no visible control explains. A change that leaves it in the list keeps it. The rule applies to user changes only (`patchWithIndicatorRule`); a hash read on load or `hashchange` is shown as is (select shows "All") and writes nothing. Pinned in `tests/filter-bar-options.test.mjs` and the smoke. Not specified in the amendment; needs user confirmation.

### Results
See the final report of the run; `filterbar.smoke.mjs` has 6 tests (3 L6, 3 L7). Only the home page mounts the bar so far; per-page-type controls are checked by importing the built module into the page with a stand-in `html` tag. Country and Period controls are L8/L9.

## L8 and L9 (Country chip, Period chip), 2026-11-10

### What was built
- `src/lib/filter-chip.js` (shared: Escape closes and returns focus to the summary; pointer press or focus outside closes; no trap), `filter-country.js` (chip, checkbox list, text filter, Aggregates sub-list, cap 5, refusal message), `filter-period.js` (From/To year selects, presets, refusal, disabled state). `filter-bar.js` mounts them in the matrix order; Country only on `home` and `series` pages. Strings are `DRAFT_` constants in `copy.js` (pinned in `copy.test.mjs`, listed in `prose-scan.test.mjs`). The home page cell now also loads `manifest.json` (already requested by the shell) for the Period bounds and passes `bounds` to the store so a hash pair outside the bounds is ignored with the note.
- Pinned rule from L7 (selected indicator that falls out of a narrowed list is cleared): still holds (`filter-bar-options.test.mjs` and the smoke test "a selected indicator that falls out ... (pinned rule)" pass).

### Results (site_spike export built in the session scratchpad, history_start 2023-01-01, known_cutoff 2026-11-01)
| Command | Result |
|---|---|
| `npm test` | 453 tests, 452 pass, 0 fail, 1 skipped (pre-existing skip) |
| `npm run check:imports` | pass (6 files match lock) |
| `npm run check:contrast` | 102 pair checks passed |
| `npm run build` | pass; "24 broken links (162 validated)" warning (framework link check; not investigated, no link was added) |
| `filterbar.smoke.mjs` | 12 tests, 12 pass (6 earlier, 6 new: 3 Country, 3 Period) |
| `npm run smoke` (full, MM_SMOKE_REQUIRE_BROWSER=1) | 291 tests, 257 pass, 2 fail, 32 skipped (same skips: "needs the synthetic sparse fixture export") |

Failing smoke tests (both started before L8, caused by L6/L7, not by the chips):
- `home.smoke.mjs` "layout: CLS <= 0.1 on / at 360px and each mounted filter block equals its reserved slot height (1px)": CLS 0.118 at 360 px with Country and Period temporarily removed (rebuilt and measured), 0.186 with the chips. The filter bar is mounted late and reserves only 4.5 rem; measured bar height is about 400 px at 320 px, 360 at 360 px, 321 at 390 px. L10 owns "bar height reserved at first paint" and the compact one-row mode; not fixed here.
- `requests.smoke.mjs` "PG-HOME and PG-DOMAINS read no data file but the manifest": PG-HOME now also reads `meta/{domains,entities,groups,indicators}.json` for the bar (since L6/L7). The expected list in that test (AC-RD-51) needs updating by whoever owns the spec; L8/L9 added no request.

Fixed in this run (caused by the chips): checkbox inputs measured 16 x 16 and failed "targets are at least 24 x 24" (now 1.5 rem); the print test counted the bar's closed chips as unseen content, the bar is hidden in print by design, so the test now skips `details` inside `.mm-filterbar`.

## L10 (sticky, compact, print, carry), 2026-11-10

### Measured (site_spike export, smoke `L10 measure` lines)
- Sticky bar: `position: sticky; top: 0` at 1280 px, height 83.19 px (reserve 83.2 = 5.2 rem); at 320 px compact mode (summary chips + one "Filters" disclosure) height 49.59 px (reserve 3.1 rem). `scroll-padding-top`, `scroll-margin-top` and the sticky table-header `top` all equal `--fbar-h` (reserve at first paint, then the real slot height); measured equal to the bar height at both widths.
- Reserves by breakpoint (`--fbar-reserve`, rem): >=80: 5.2; 73-80: 7.95; 53-73: 9.3; 46-53: 12; 40-46: 13.4; <40: 3.1 (compact). This replaces the single 4.5 rem reserve that gave CLS 0.186 at 360 px (earlier note: bar was ~360 px tall when wrapped; below 40 rem it is now one compact row).
- Focus not obscured (WCAG 2.4.11), Tab through the page: 1280 px: 389 stops, 293 outside the bar, smallest gap between bar bottom and a focused element 13.0 px; 320 px: 387 stops, 359 outside the bar, smallest gap 13.0 px (no stop under the bar).

### Results
| Command | Result |
|---|---|
| `npm test` | 462 tests, 461 pass, 0 fail, 1 skipped (pre-existing) |
| `npm run check:imports` | pass (6 files match lock) |
| `npm run check:contrast` | 102 pair checks passed |
| `npm run build` | pass; "24 broken links (162 validated)" warning, see below |
| `npm run smoke` (full, MM_SMOKE_REQUIRE_BROWSER=1) | 301 tests, 268 pass, 1 fail, 32 skipped (same skips: "needs the synthetic sparse fixture export") |

Failing smoke test: `ux.smoke.mjs` "PG-COUNTRY: with the 1.4.12 text-spacing override at 320/390/768/1280/1920 ..." (parent T132 AC-UX-6): `waitForSelector('.mm-country-domain table tbody tr')` timed out at 20 s. Re-run alone: passes. Treated as a load-related timeout in the full run; not reproduced. The earlier CLS test (home 360 px) and the PG-HOME request test now pass.

### "24 broken links (162 validated)"
The 24 entries are all of the form `/x -> /x#observablehq-main`: the shell's skip link (`<a class="mm-skip" href="#observablehq-main">`, `shell.js`, unchanged by L10) on the 24 pages that are built from dynamic paths/loaders; the target id exists in every built page. It was already present before L8 (earlier note) and L10 adds no static link (carry rewrites hrefs at click time only). Not caused by L10; not fixed. Likely a Framework link-check artifact for that skip link.

### requests.smoke.mjs
PG-HOME expectation changed to manifest + `meta/{entities,groups,domains,indicators}.json`, which is a subset of amendment AC-DB-12 (manifest, status, meta/*, default-domain scorecard); status and scorecard arrive with L11 and the test must be extended then.

## L14 (KPI tiles), 2026-11-11

Review of the code left by the previous run against the plan Goal: selection (pinned `i` first, then `indicator_ids` order, cap 8, Frequency via stored `frequency_set`), placeholder card for anything but exactly one known entity, domain-figure tile for ranked domains only (two stored numbers printed as text, no percent sign; aggregates show "not ranked"), no priority, no delta/arrow/rank helpers were already in place. One gap fixed: the tile value did not use `published_precision`; it now uses the stored per-series hint (integer decimals) from `meta/series.json` when present, else the common `formatValue`. A unit test and the smoke assertion were added for it.

### Results
| Command | Result |
|---|---|
| `npm test` (site_spike export in `src/data`) | 490 tests, 489 pass, 0 fail, 1 skipped (pre-existing) |
| `npm test` (sparse export in `src/data`) | 1 fail: `heatmap.test.mjs` "fixture domains" reads `src/data/scorecard/labour.json`, which the sparse export does not have (environment, same cause as the note in Build inputs; not an L14 change) |
| `npm run check:imports` | pass (6 files match lock) |
| `npm run check:contrast` | 102 pair checks passed |
| `npm run build` (site_spike export) | pass; "24 broken links (162 validated)" (skip-link artifact, see L10) |
| `kpi.smoke.mjs`, MM_SMOKE_REQUIRE_BROWSER=1, site_spike export | 10 tests, 10 pass, 0 fail, 0 skipped |
| `kpi.smoke.mjs`, sparse export | 10 tests, 1 pass, 8 fail, 1 skipped: the smoke is written for the spike export (labour, DEU), as the file header says; not a sparse-fixture test |
| `npm run build` (sparse export) | pass; "56 broken links (387 validated)" |

### CSS size
`site/src/style.css`: 12,855 B gz (plain gzip of the source). Built CSS (`measure:landing`, spike export): 13,370 B gz of the 20,000 B budget. Landing set 324,547 B gz.

Not run: full `npm run smoke` (only `kpi.smoke.mjs` for this task).

## L12 (ranked comparison card and Facts card), 2026-11-11

### Results (all measured in this run)
| Command | Result |
|---|---|
| `npm test` | 490 tests, 489 pass, 0 fail, 1 skipped (pre-existing) |
| `npm run check:contrast` | 102 pair checks passed |
| `npm run check:imports` | pass (6 files match lock) on the site_spike build; on the sparse build it reports the Parquet reader files "in lock but not built" (the sparse export has no `series/*.parquet`, so no page imports the reader); not an L12 effect |
| `npm run build` | pass; sparse export: 56 pages, "56 broken links (387 validated)"; site_spike export: 24 pages, "24 broken links (162 validated)" (skip-link artifact, see L10 note) |
| `rank.smoke.mjs` (MM_SMOKE_REQUIRE_BROWSER=1) | 10 tests, 10 pass on the sparse (44-entity) build and on the site_spike build |
| `npm run smoke` full, sparse build | 323 tests, 254 pass, 62 fail, 7 skipped (before the fixes below); most failures are the known spike-only expectations (M09, labour, DEU) |
| `npm run smoke` full, site_spike build, before fixes | 323 tests, 283 pass, 8 fail, 32 skipped |

### Changes made in this run
- `tests/smoke/home.smoke.mjs`: the link-integrity test ignores tables/svg inside `.mm-card`; the L11 slot test no longer requires the compare and facts slots to be busy (L12 fills them).
- `src/style.css` (L12 block): links in the rank card are 24 px high (WCAG 2.5.8; "V1 landing targets" had failed with 17 px links); print rules so the rank tables fit the page (the print test had failed with "document overflows by 227px").
- After these: `ux.smoke.mjs` 141 pass, 1 fail; `browser.smoke.mjs` 32 pass, 2 fail; `filterbar.smoke.mjs` 19 pass, 2 fail (site_spike build).

### Still failing (site_spike build), not fixed
- `home.smoke.mjs` L11 slot test: the span-12 Overview slot is `aria-busy="false"` (filled by L14, not L12).
- `browser.smoke.mjs` "missing file: the manifest" and "unknown manifest major": "no container left busy after the failure", 5 busy slots (L11 slots stay busy without a manifest; L15 owns card states).
- `filterbar.smoke.mjs` L6 programmatic change (waitForFunction timeout on `data-renders` after a hashchange to an unknown group) and L8 keyboard-only Country chip test; not investigated for cause.
- `ux.smoke.mjs` "V1 landing: tab traversal": "Tab reached 35 of 40 focusable elements"; the card adds focusable elements (scroll region `tabindex=0`, point reader, details); cause not isolated.
- Not measured: CSS gz, home first load, CLS, grayscale numeric check (the rank smoke asserts behaviour, not numbers).

## L13 (heatmap card), 2026-11-11

Domain band of PG-HOME: `heatmap-card.js` mounts into `dash.slots.domain`; the legend and the orientation note go into the new `dash.legend` element directly above the card (sibling in the band, not inside the card). `heatmap-view.js` takes options (`hrefs`, `carry`, `orientation`); the defaults are the PG-DOMAIN behaviour (unchanged; the existing heatmap tests pass). `heatmap.js` gets `cardView()` (comparison set rows, none dropped; Frequency narrows columns by stored `frequency_set[]`; Period not applied, no hidden-rows disclosure). Generated page source `scripts/lib.mjs` (and `src/index.md`) mounts the card.

### Results (all measured in this run)
| Command | Result |
|---|---|
| `npm test` (site_spike export in `src/data`) | 493 tests, 492 pass, 0 fail, 1 skipped (pre-existing); 3 new tests in `heatmap.test.mjs`, 1 assertion of `home-lists.test.mjs` updated (it banned the word "heatmap" in the home page source) |
| `npm run check:imports` | pass (6 files match lock, site_spike build) |
| `npm run check:contrast` | 102 pair checks passed |
| `npm run build` | pass; site_spike: "24 broken links (162 validated)" (skip-link artifact, see L10); sparse: "56 broken links (387 validated)" |
| `heatmap-card.smoke.mjs`, MM_SMOKE_REQUIRE_BROWSER=1, sparse export (EXPORT_DIR=tests/fixtures/sparse_export, 44 entities) | 8 tests, 8 pass, 0 fail, 0 skipped |
| `heatmap-card.smoke.mjs`, site_spike export | 8 tests, 8 pass, 0 fail, 0 skipped |
| `rank.smoke.mjs` + `kpi.smoke.mjs` + `heatmap-card.smoke.mjs`, site_spike | 28 tests, 28 pass |
| `home.smoke.mjs` + `static.smoke.mjs`, site_spike | 31 tests, 30 pass, 1 fail: AC-SYS-10 needs `MM_EXPECT_BUILD_ID` or `EXPORT_DIR` (environment) |
| `npm test` with the sparse export in `src/data` | 1 fail: `heatmap.test.mjs` "fixture domains" reads `scorecard/labour.json` (known, see L14) |

`src/data` held the 9-entity site_spike export, not the sparse one. The sparse run swapped `src/data`, `src/domain` and `src/index.md` through `EXPORT_DIR` and they were restored from copies afterwards (identical by diff). Another agent also rebuilds `dist/` in the same tree, so `dist/` may have changed between my runs; each smoke result above was taken right after the build of the stated export.

CSS: `src/style.css` 13,142 B gz (plain gzip of the source; was 12,855 B after L14).

Not measured: CLS and grayscale numbers of the card, `npm run smoke` in full, `ux.smoke.mjs`, `browser.smoke.mjs`, `filterbar.smoke.mjs` (owned by the triage agent), a screen-reader pass.
Weak spot: the Period smoke uses `#from=1990&to=1990`; if the build's manifest bounds do not contain 1990 the hash is ignored by the store (the assertion then holds trivially). The unit test of `cardView` shows Period is not a parameter.

## L15 (empty, error and Period states per card), 2026-11-11

Changes: `home-dashboard.js` gets `buildSkeleton()` (shared) and `mountHomeFailure()`: when any meta file or the manifest fails, the home page builds the same bands and every card slot shows one `role="alert"` block (region of the failure, existing consequence string, no URL or number) and is not busy; the filter bar is not built. `emit()` isolates a throwing card so the other cards still render. `rank-view.js` and `heatmap-card.js` catch a scorecard that loaded but has the wrong shape and show their own invalid-data alert. `kpi-view.js`: the note gets `id="kpi-empty"`/`kpi-placeholder`. Generator `scripts/lib.mjs` (`md` is null unless every meta file loaded; mounts the failure view); `src/index.md` regenerated by `prepare-data` from it. No new copy string (reused `DRAFT_CONSEQUENCE.scorecard`, `DRAFT_EMPTY_CARD`, the L12-L14 consequence strings). Already in place from L12-L14 and only verified: busy block with `min-height: 12rem`, empty-card sentence on rank, heatmap and KPI, the ADR-036 disclosure on the rank card (count only through `countPeriodHiddenRows` in `rank-model.js`; view reads only the sentence), scorecard loader that does not cache a failure.

### Results (all measured in this run, site_spike export, private dist copy via MM_SMOKE_DIST, MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1)
| Command | Result |
|---|---|
| `npm test` | 499 tests, 498 pass, 0 fail, 1 skipped (pre-existing) |
| `tests/state-blocks.test.mjs` | 15 tests, 15 pass (7 new: failure view, throwing card, loader retry, busy height, empty sentence, disclosure scan) |
| `npm run check:imports` | pass (6 files match lock) |
| `npm run check:contrast` | 102 pair checks passed |
| `npm run build` | pass; "24 broken links (162 validated)" (skip-link artifact, see L10) |
| `states.smoke.mjs` | 7 tests, 7 pass, 0 skipped |
| `browser.smoke.mjs` | 34 tests, 34 pass (the two known failures, "missing file: the manifest itself" and "unknown manifest major", now pass) |
| `npm run smoke` full | 338 tests, 306 pass, 0 fail, 32 skipped (30 "needs the synthetic sparse fixture export", 2 same reason, none of these ran) |

CSS: `src/style.css` unchanged by this task (no CSS edit).

### Notes
- One failed scorecard puts one alert in each card that reads it (rank, heatmap, and the KPI card when one Country is chosen); the facts card, filter bar and Browse stay. This is the reading of amendment 5 item 2 used: "the affected card only" per card, not one alert for the whole file.
- The Indicators and Over time slots are still empty placeholders (L16 and later) and stay `aria-busy="true"` on a working page; the smoke asserts no busy state only for the L12-L14 cards.
- Not measured: screen-reader behaviour of the status region (ADR-036 I5, UNVERIFIED), the sparse-export run of the full smoke.

## L17 (indicator table for the focus country, no Trend column), 2026-11-11

Changes: new `site/src/lib/table-card.js` (`tableModel`, `hiddenRowsBlock`, `mountTableCard`, `HOME_TABLE_HREFS`) mounted in the `indicators` slot only. The band is shown only when exactly one known Country is in focus (otherwise `#band-indicators` gets `hidden`, the slot is not busy). The table is the existing `domainTable()` of `country-view.js` (one builder, not a copy) for the selected Domain's `indicator_ids` narrowed by Frequency (stored `frequency_set`), fed by `countryModel()`; the "all / only with a value" control is the existing `countryFilter()`/`applyFilter()`; rows without a value last. Period row-filters this card (ADR-036): valued rows whose latest `ref_period_end` year is outside from..to are hidden and listed in a `details` disclosure; the only count is `countPeriodHiddenRows` (rows without a date are never hidden). No Trend column and no sparkline (AC-DB-26; nothing reads `recent`). `country-view.js`: `domainTable()` gets an optional last parameter `hrefs` (default `COUNTRY_TABLE_HREFS` = the country page's own links), so PG-COUNTRY markup is unchanged; the home passes site-root links. Generator `scripts/lib.mjs` and `src/index.md` each get one import and one mount cell. No new copy string (reused `DRAFT_EMPTY_CARD`, `DRAFT_HIDDEN_ROWS`, `DRAFT_HIDDEN_ROW_ITEM`, `DRAFT_SUBREGION_CONSEQUENCE`, country-table strings). CSS: one appended `L17` block in `style.css`.

### Results (private dist copy of the working tree, site_spike export in `src/data`, via MM_SMOKE_DIST; no MM_EXPECT_BUILD_ID)
| Command | Result |
|---|---|
| `npm test` | 511 tests, 510 pass, 0 fail, 1 skipped (pre-existing) |
| `tests/table-card.test.mjs` | 6 tests, 6 pass |
| `home.smoke.mjs` | 22 tests, 22 pass (new: L17 band test; L11 slot test treats `mm-card--table` as filled) |
| `states.smoke.mjs` | 7 tests, 7 pass (the L15 "one failed scorecard" test now expects the Indicators card alert `#table-error`: 4 alerts, was 3) |
| `npm run smoke` full | 343 tests, 305 pass, 6 fail, 32 skipped; the 6 failures were 4 in the L18 time-series card (L18 mid-edit), 1 states test fixed above, 1 `AC-SYS-10` build_id (needs MM_EXPECT_BUILD_ID, environment) |

CSS: `src/style.css` 13,408 B gz (plain gzip of the source; was 13,142 B after L13).

### Notes
- Home links in the table are page-relative to the site root (`./indicator/<id>`, `./explorer#i=..&c=..`) with `data-carry`.
- Weak spot: the smoke chooses the Period `from = to = history_start year`; it assumes no valued row of the chosen country ends in that year.
- Not measured: CLS and weight of the table card, 320 px layout, print, screen-reader behaviour of the status region (UNVERIFIED).

## L18 (time-series card with "Load history"), 2026-11-11

`site/src/lib/series-card.js` mounts into `dash.slots.overTime` (class `mm-card--series`). For 1-5 Countries and the effective Indicator it draws the PG-SERIES line chart (`explorer-view.js` `chart()`: tip, end labels with stored value and unit, "Read a value" point reader, "View as table") from the indicator's `series/<id>.parquet`. The file is requested only by the "Load history" button (one file per activation; loaded rows cached per indicator, a failure is not cached and the button is offered again). Period clips by year through `buildModel` from/to; Frequency keeps rows whose stored `frequency` equals it (`seriesOfFrequency`). No Country: the existing placeholder sentence (L19 replaces this branch with small multiples). Generated home page: one literal lazy `FileAttachment` per manifest series file (`homePageSource` gets an optional `manifest`; `prepare-data` passes it). PG-SERIES behaviour is unchanged: `explorer-view.js` only exports `figureAndReader` and gives it an optional `ids` argument whose default is the old ids. There is no `series-chart.js` in the repository; the chart code is `explorer-view.js` (reported to the orchestrator).

### Results (all measured in this run, site_spike export copied to a private dir for `prepare-data`, private dist copy via MM_SMOKE_DIST, MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1)
| Command | Result |
|---|---|
| `npm test` | 511 tests, 510 pass, 0 fail, 1 skipped (pre-existing); 6 new in `tests/series-card.test.mjs` |
| `series-card.smoke.mjs` (MM_SMOKE_REQUIRE_BROWSER=1) | 4 tests, 4 pass, 0 skipped: zero `series/*` requests and no `.wasm` before the click; exactly one `series/M09.*.parquet` after; a Period change after the load adds no request; failed file (route abort) gives one `role="alert"` inside the card, none outside it, and the button stays; Frequency D gives the empty-card sentence |
| `npm run smoke` full (rerun 2026-11-11 on a fresh private copy, MM_SMOKE_REQUIRE_BROWSER=1, MM_EXPECT_BUILD_ID set) | 343 tests, 311 pass, 0 fail, 32 skipped (skip reason not re-checked in this rerun; the earlier run attributed 30+2 to the sparse fixture export) |
| `npm run check:imports` | pass (6 files match lock) |
| `npm run check:contrast` | 102 pair checks passed |

### Failures seen in the full smoke
- `home.smoke.mjs` L11 slot test: the Over time slot is now filled (`aria-busy="false"`); fixed by adding `mm-card--series` to the "filled" predicate (one-token edit).
- `states.smoke.mjs` "one failed scorecard ... alert ... nowhere else": 4 alerts instead of 3. The extra one is `#table-error` in the Indicators slot (L17 table card, not this task); the series card shows no alert unless its own file fails. Not seen in the rerun after L17 updated that test (0 failures).

### Interaction weight (one activation, gz level 9 of the built files)
Series file 3.2 KB (M09, P01 fixtures) + Parquet reader files (`parquet_wasm_bg.wasm` 1,659,824 B plus apache-arrow, parquet-wasm JS, flatbuffers, tslib: 1,728,205 B for all files of those four `_npm` packages) = about 1.73 MB of the 5 MB rule. Real series files are larger; the fixture figure is not a production measurement. Landing weight unchanged by the reader: NOT MEASURED. The earlier run only showed by smoke that no `.wasm` or `series/*` request happens before the click; no before/after `measure:landing` comparison on a build that contains series files was made. Re-run 2026-11-12 on the sparse export (no `series/*.parquet`, so the reader is not even built): `measure:landing` lists 103 files, 351,297 B gz, none of them parquet, wasm or arrow; that says nothing about a build with the reader present.

### CSS size
`src/style.css`: 13,296 B gz (plain gzip of the source), +8 lines in an `L18` block.

Not asserted in the browser smoke: Period clipping of the x-domain and the 5-line cap (covered by unit tests `tests/series-card.test.mjs` only; the smoke checks that a Period change adds no request).

Not measured: CLS of the card after the load, screen-reader behaviour, a run on the sparse export (no series files there, the card shows the empty-card sentence), 5-line overlay at 320 px.

## L16 (build and evaluate against the real export), 2026-11-11

### Identity of what was measured
- Export (outside the repository, not committed): `.../cc4c2854-9434-4237-890a-899946c02ed7/scratchpad/export/data`. Manifest: `build_id` 2026-11-09T23:59Z-r92, `generated_at` 2026-11-09T23:59:55Z, `known_cutoff` 2026-11-09T23:59:48Z, `schema_version` 1.0, `code_version` 0.1.0, `ingest_run_id` 92, `analysis_run_id` 9, `history_start` 1991-01-01. It has no committed identity; it is an unrecorded local export (plan risk).
- Manifest check: 32 files listed, `totals` 32 files / 5,382,686 B. All 32 exist and match size and sha256; the only file on disk and not listed is `manifest.json` itself (5,389,403 B on disk in total). No mismatch.
- Contents: 11 domains, 72 indicators, 305 series (`meta/series.json`), 45 entities in `meta/entities.json` (42 country, 3 aggregate EA, EU27, WLD), 5 groups, 11 scorecards of 44 entity rows each, 12 `series/*.parquet` (A01, A14, A22, G01, G03, M02, M06, M07, M09, M17, Q06, Q08), 1 `revisions/M09.parquet`, `alerts.json`, `revisions_recent.json`, `status.json`.
- Site: a snapshot copy of the working tree of `site/` (L1-L15 plus whatever L17/L18 had on disk at 2026-11-11), built privately in the session scratchpad so the shared `site/src/data`, `site/src/index.md` and `site/dist` were not touched. `EXPORT_DIR` = the path above. `measure-pages.mjs` takes a dist path argument and `--time-build`; it was not edited.
- Build: pass, 131 HTML pages (11 domain, 44 country, 72 indicator, home, domains, explorer, revisions), "prepare-data ... 33 files" (32 + manifest). Build time 5.1 s (`--time-build`; a first uncached run took 8.4 s wall). dist 13,868,918 B raw.

### Pass/fail against budgets (`node scripts/measure-pages.mjs --time-build`, Chromium, gzip level 9; all figures measured)
| Measure | Value | Budget | Result |
|---|---|---|---|
| Home first load (default state) | 344,447 B gz | 600,000 target / 1,500,000 hard | PASS |
| Country page, worst of 44 (CZE) | 390,995 B gz | 600,000 / 1,500,000 | PASS |
| Indicator page, worst of 72 (G01) | 367,887 B gz | 600,000 / 1,500,000 | PASS |
| Explorer page-own files | 281,293 B gz | 600,000 / 1,500,000 | PASS |
| Explorer reader plus series file (total 2,239,090 B gz) | 1,957,797 B gz | 5,000,000 | PASS |
| Domains page | 54,044 B gz | 600,000 / 1,500,000 | PASS |
| Revisions page | 346,815 B gz | 600,000 / 1,500,000 | PASS |
| One history interaction (ARG, social-A14: parquet-wasm 1,750,298 B gz plus series file) | 1,773,451 B gz (5,374,525 B raw), 2 new files | 5,000,000 | PASS |
| CSS | 13,490 B gz | 20,000 | PASS |
| CLS home / country / indicator / explorer / domains / revisions | 0.0008 / 0.0034 (max over 44) / 0.0165 (max over 72) / 0.0089 / 0.0023 / 0.0198 | 0.1 | PASS |
| Build time | 5.1 s | no budget in the plan | recorded |

AC-RD-53 real part: all page types are under the 600 KB target on this export. The home figure is for the page as built in the snapshot (the Indicators and Over time slots were still empty placeholders: see below), so it is not final.

### Data sizes (gz level 9 computed on the export files)
- `meta/*` total 10,224 B gz (series 5,000, indicators 3,174, entities 910, domains 596, groups 544); manifest 2,059; status 645.
- Scorecards, raw / gz: agri 536,305 / 5,421; growth 374,728 / 5,124; social 297,975 / 4,875; structural 296,176 / 4,458; prices 218,331 / 4,231; fin 334,564 / 3,496; fiscal 214,480 / 3,193; external 334,832 / 3,100; labour 174,454 / 2,839; environment 174,371 / 1,980; global 4,065 / 747.
- Default home view in a recorded browser run: 100 responses; the file list showed manifest, `meta/{entities,indicators,domains,groups,series}`, `scorecard/environment`, zero `series/*`; one extra manifest and one extra `meta/series` request are repeats (so a raw sum of all responses, 351,398 B gz, is higher than the 344,447 B gz of `measure-pages`). After a Domain change to labour: exactly one new request, `scorecard/labour` (2,838 B gz); switching back to a loaded domain: no new scorecard request. No page or console error in these runs. Loaded modules on home include all of d3 and the Plot bundle (72,279 B gz), history/explorer/peers modules (transitive imports); noted, not changed.

### Behaviour on the real export (probe in Chromium over the built snapshot; clock fixed 2026-11-11)
- Default view does NOT open on `agri`: it opens on `environment` (heading "Environment", hash empty). `defaultDomainId()` in `home-dashboard.js` returns the first domain with `ranked === true`, not `domains[0]` (agri, `ranked: false`). B-DEF predicted agri; the code (or a decision after the plan) differs. Flagged, not changed.
- The default `environment` first indicator (A19 "Energy import dependence; ...") has no stored value: the rank card shows 44 rows, 0 with a value, all "na" with state sentences; the facts card repeats that name. In this export 12 indicators have a `series/*.parquet` (A01, A14, A22, G01, G03, M02, M06, M07, M09, M17, Q06, Q08) but only 11 have a scorecard value for any entity (value rows: G01 28, M17 2, Q06 2, Q08 27, M02 28, M09 28, M06 28, M07 28, A14 41, A22 42, A01 42); G03 has a series file and 0 scorecard value rows. The other 61 of 72 indicators (61 of 73 indicator-domain pairs) render all-na.
- The "Indicators" and "Over time" slots are `aria-busy="true"` and empty in this snapshot (L17/L18 not in the tree at that time); there is no history control on the home page yet, so a home "Load history" could not be tested.
- Domain switch (all 11 domains loaded one by one): no errors, no alerts, 44 rank rows each, zero `series/*` requests in each. Value rows per default indicator: structural 42, labour 28, agri 28, fin 2, others 0.
- Group `advanced`: 31 rank rows. Frequency A (labour) and M (prices): no error; rank rows 44 (labour value rows 28; prices first indicator 0). Country `#c=DEU` on labour: no error (KPI tiles card present).
- Period presets (bounds 1991 to 2026; Last 10 years = 2017 to 2026, Last 5 years = 2022 to 2026) over every indicator with values (disclosure "N rows hidden by the period filter"): Last 10 years hides 0 rows for all 12 pairs; Last 5 years hides 0 except social-A14, which hides 6 of 41 value rows. A custom 2020 to 2024 range on labour M09 hides all 28 value rows (the remaining 16 rows are no-value rows). A preset or custom range on indicators with no values hides 0.
- "Load history": on the country page (DEU) 11 history buttons exist (one per indicator with a scorecard value on that page; not reconciled against the 12 series files, G03 has a file and no value). No button is offered for an indicator without a file, so the expected "error state for an indicator without a file" cannot be triggered from the UI. Clicking one with a file loads the parquet-wasm and the series file with no alert or error. The error-state path for a missing file was therefore not exercised on real data.

### Differences between the sparse fixture and the real export that matter for phase A
- Counts: 45 meta entities (42 country, 3 aggregate) and 44 scorecard rows per domain (plan said 43, ADR-034 said 44); rank card shows 44 rows.
- Mixed units in one indicator: M06 has series units `I25` and `IDX` (indicator `unit_label` "I25, IDX"); G01 belongs to two domains (agri and prices).
- Missing values: 57 of 72 indicators have no `unit_label` (null); 61 of 72 indicators have no scorecard value for any entity, so most domains show all-na cards and the default view lands on one.
- Unranked domains: `agri` and `global` have `ranked: false`; `global` has 3 indicators and only 4,065 B scorecard.
- Aggregates: EA, EU27, WLD are present in meta; the scorecard rows include 44 entities (the domains' aggregate state count was 4 in rank views).
- Long names: longest indicator name 73 characters ("Prevalence of undernourishment and food insecurity (FAO, 3-year averages)"); several names are multi-indicator lists (A19 "Energy import dependence; energy intensity; electr..."); longest entity "European Union (27)".

### Not measured / limits
- The sparse fixture build was not re-run here. No screen-reader pass. No test suite was run in this task (measurement only).
- The snapshot includes unfinished L17/L18 work; numbers for the home must be re-taken at L27.

## L19 (small multiples) and L20 (Lines / Bars toggle), 2026-11-11

### What was built
- L19: `site/src/lib/small-multiples.js` (pure: `facetOrder`, `multiplesModel`, `FACET_PAGE` 12) and `series-card.js` (`multiplesBlock`, plan kind `multiples` when no Country is selected). The same "Load history" button and one `series/<id>.parquet` per activation; then one Plot facet chart (shared y-axis, entity-name facet title, `chart()` facets form), reader and table alternative of the card. At most 12 facets, "Show more" adds the next 12 from the loaded rows (no request, no count printed). Order = C-RANK sort (follows `#rank-sort` when present, otherwise A to Z by name). Aggregates are not faceted (they are the reference rows). An entity with no row in the file is listed under the chart with the empty-card sentence, not dropped; so fewer than 12 drawn facets can sit beside entities listed as no-data. The earlier placeholder sentence is no longer in the card (review 9a).
- L20: `site/src/lib/bar-chart.js` (`barChart`, `chartModeToggle`, `barsAvailable`, `modeFor`): radio group "Lines" / "Bars" shown only when exactly one series is selected (card with one Country, PG-SERIES with one checked Country); `barY` of the stored points, estimate/provisional bars hollow outline, unit as y label; point reader and table use the same points as the line view. The chart type is not in the hash (`hash.js` untouched; PG-SERIES grammar unchanged). `explorer-view.js` `chart()`/`explorerBlock()` take optional `mode`, `toggle`, `selected`; the generated explorer page source is in `scripts/lib.mjs` (`src/explorer.md` is git-ignored output).
- `tests/ux-static.test.mjs`: five allow-list entries (facet paging `+=`, comparator by position, tick spacing by position) with clauses; new copy constants `DRAFT_SHOW_MORE`, `DRAFT_CHART_MODES`, `DRAFT_CHART_TYPE_LEGEND` ("Chart type", not in the amendment string list: pending confirmation).

### Results (measured in this run; private build of a copy of `site/` over the committed sparse fixture export copy; private dist via MM_SMOKE_DIST)
| Command | Result |
|---|---|
| `npm test` (in `site/`) | 526 tests, 523 pass, 2 fail, 1 skipped; both failures are in domain-page tests (`sparse fixture: every domain linked...`, `domains list: ...`), files of a concurrent task, not touched here |
| `series-card.smoke.mjs` + `series.smoke.mjs` (MM_SMOKE_REQUIRE_BROWSER=1) | first run 24 tests (8 card incl. 4 new L19/L20, 16 series), 24 pass, 0 skipped; then 2 L20 tests added to `series.smoke.mjs`, rerun of that file: 18 tests, 18 pass, 0 fail, 0 skipped |
| `src/style.css` | 13,500 B gz (plain gzip of the source), no CSS added by L19/L20 |

### Not measured
- 12 facets at 320 px (AC-UX-6), render time of 12 Plot instances (one faceted Plot is used, not 12), CLS after the load, screen-reader behaviour of the toggle and the facet chart, keyboard reaching every facet value (the smoke focuses the reader only; unit test covers the reader entries), the 5-line overlay at 320 px.
- The sparse fixture has few countries with data for M09/P01, so "12 facets then Show more" was tested in unit tests only (30 synthetic entities), not in the browser; on the real export (12 series files) not run.
- Bars with estimate outline in the browser (unit-tested with the stand-in Plot only); a bar chart with more than 10 periods (tick thinning is unit-tested).

## L22 (PG-COUNTRY arrangement), 2026-11-11

### What was built
- `site/src/lib/country-page.js` (new): header card (generated page: `h1`, kind, groups), the filter bar slot (Country switcher with explicit Go leads the bar; Domain, Period, Frequency from the filter store), one band per domain in `meta/domains.json` order with domain-figure tile (span 4, `domainFigureCard`), dot strip (span 8, `profileFigure`, only for ranked domains) and a full-width table card per domain (RD C-CTRY-3 table, no Trend column, one "Show all / only with a value" control per card). Links carry the filter hash (`data-carry`). Domain narrows to one band; Frequency narrows rows by stored `frequency_set`; Period hides valued rows outside the range and lists them in the ADR-036 disclosure.
- `site/src/lib/filter-country.js` (new), `country-view.js` (page assembly moved out; table builder kept), `scripts/lib.mjs` (generated country page source; `src/country/*.md` is git-ignored output), `tests/country-view.test.mjs`, `tests/filter-country.test.mjs`, `tests/smoke/country.smoke.mjs` (retargeted: `.mm-figure-line` became the `[data-tile="domain-figure"]` tile; the filter radio group is per card, `country-filter-<domain>`).
- `site/src/lib/table-card.js` (review findings): hidden-rows list ordered by name A to Z, ties by id, through `sort.js` (as `rank-model.js`); the disclosure is now directly under the card title, before the Show-all control (also on the country page); two new tests in `tests/table-card.test.mjs`.

### Results (this run; private copy of `site/` in the session scratchpad over the committed sparse fixture export, EXPORT_DIR; the repo `src/data` and `dist` were not touched)
| Command | Result |
|---|---|
| `npm test` in `site/` | 526 tests, 511 pass, 14 fail, 1 skipped; failures are in `copy.test.mjs`, `indicator-view.test.mjs`, `peers.test.mjs`, `small-multiples.test.mjs`, `ux-static.test.mjs` (indicator-view.js, bar-chart.js, series-card.js, small-multiples.js), files of other tasks; none names a module of L22 |
| `npm run build` (scratchpad copy) | succeeded; 44 country pages generated, same set as the export entities (41 SY, 3 SYA) |
| `country.smoke.mjs` (MM_SMOKE_REQUIRE_BROWSER=1) | 19 tests, 19 pass, 0 fail, 0 skipped (before retargeting: 16 pass, 3 fail on the old selectors) |

### Not measured
- First-load weight and time of PG-COUNTRY with the filter bar, tiles and per-domain cards (L27; CR-4 is the redesign plan's remedy, not built here), on the real export.
- 320 px layout of the bar plus the bands, print of the page, keyboard order across bar, tile and table, screen-reader announcement of the hidden-rows disclosure (all L25 / manual).
- Real export: not run; fixture only. Firefox and Safari not run.

## L21 (PG-SERIES filter bar), 2026-11-11

### What was built
- `site/src/lib/explorer-filters.js` (new): `narrowedGroups`, `resolveIndicator`, `rowsOfFrequency`, `railPatch`, `wireRailPeriod`, `updatePicker`, `storeWatch`. `filter-bar.js` got an `only` option (render a subset of the page's controls; Reset then clears only those; chips and print line list only those); `summaryParts` got an optional `controls` list.
- The generated explorer page (`scripts/lib.mjs`, `src/explorer.md` is output) now holds the filter store as its one state: `#i`, `#c`, `#d`, `#f`, `#from`, `#to`; `#g` is parsed and kept in the address but nothing reads it and Group is not rendered. The bar shows Domain, Period, Frequency. Domain and Frequency narrow the rail's indicator picker (stored `domain_ids`, `frequency_set`); Frequency also keeps only rows whose stored `frequency` matches (series list and year choices follow); the rail's From/To years and the Period chip read and write the same `from`/`to` pair. Address writes go through the store (`replaceState`, user changes only, other parts kept); `hashchange` is read by the store and by the page as before. Grammar (`hash.js`) untouched.
- Rail controls (picker, countries, transform, years, rebase, free y) are unchanged.

### Choices not given by the spec (need user confirmation)
- Matrix 2.4 lists Country and Indicator on PG-SERIES; the task limited the bar to Domain, Frequency, Period, so AC-DB-01 ("the controls of 2.4 and no others") is met only for those three; Country and Indicator stay in the rail (C-SER-1).
- A picker has no "All" option. When Domain or Frequency removes the selected indicator, the picker moves to the first offered one (the pinned L7 rule clears `i`; here that means "default"), and the page then writes `i`. A hash indicator not offered by the hash's own Domain/Frequency falls back the same way, with the fallback note and no write.
- When Domain and Frequency together match no indicator the picker is left as it is (no empty state text exists in the amendment or the copy list).
- Rail year choices that make a one-sided range ("first" or "last" with the other end set) are stored as a full pair using the first / last year of the loaded rows. A refused choice (from > to) restores the stored value silently (the Period chip shows a message for the same case; the rail does not).
- The Country list is not capped at 5 on this page (the rail allows more and facets above 5; amendment 2.4 says up to 5). Not changed.
- Reset in the bar clears Domain, Frequency, Period only; it keeps indicator and countries.

### Results
See the final report of the run for command output. `tests/explorer-filters.test.mjs` (8 unit tests) and 5 smoke tests in `tests/smoke/series.smoke.mjs`. No existing test was retargeted.

### Not measured
- Layout of the sticky bar with the rail (rail is not sticky now; sticky offsets of the rail and focus-not-obscured by the bar, 2.4.11, 24 px targets) on the explorer page; CLS of the slot on `/explorer` (reserve CSS is shared with home, not measured here); compact mode (below 40 rem) of the bar on this page; print line.
- Real export (many series, several frequencies): the fixture used has only monthly indicators and two domains with series files, so a Frequency change that empties the series list, and a frequency-mixed indicator, were tested in unit tests only.
- The interaction budget (5 MB per interaction) was not re-measured: a Domain or Frequency change fetches nothing, an indicator change fetches the one file as before.
- Screen-reader behaviour of the picker being rebuilt under the user, and keyboard focus after the rail is rebuilt by a Frequency change.
- The rail rebuild on a Frequency change drops selected countries that have no row in that frequency and, as an indicator change does today, writes the reduced list.

## L23 (PG-INDICATOR arrangement), 2026-11-11

### What was built
- `site/scripts/lib.mjs` (`indicatorPageSource`, writes the git-ignored `src/indicator/*.md`): header card (`#indicator-header`: `h1`, facts, notes), the filter-bar slot, then `indicatorBlock`. The page builds a store (`maxEntities: 1`; `c` is the country in focus) and mounts the bar with page type `indicator` (Group `#filter-group`, indicator switcher `#filter-indicator` with explicit `#indicator-switcher-go`).
- `site/src/lib/indicator-view.js`: band "Compare" = the C-RANK card (`mountRankCard`, sort `#rank-sort` in the card header, `INDICATOR_SORT_OPTIONS`, reader, "Reference rows" group) with the percentile dot plot card beside it (span 4, only for a ranked domain; otherwise the rank card is span 12); band "Table" = the RD C-IND-5 table card, which follows the card sort and the Group from the bar. The `peers` filter note (`#filter-note`) is unchanged and verbatim.
- Smoke `site/tests/smoke/indicator.smoke.mjs` retargeted at the new markup (Group select, `#rank-sort`, C-RANK bars as `.mm-rank-bar-wrap`, `#filter-indicator` + Go, reader `#rank-reader-*`). The old hover-tip and static-tip tests of the removed `#value-figure` were dropped; the bar tip is now a `title` attribute and the rank card's own reader is covered in `rank.smoke.mjs`. This is a retarget of the test to the spec, as the plan requires.
- `site/tests/heatmap.test.mjs` (L13 card view, used by L24): an entity missing from the scorecard gets no invented counts (`n_available`/`n_defined` null, coverage cell prints "n/a", no "0/0").

### Results (private copy of `site/` under the session scratchpad, built over the committed sparse fixture export with `EXPORT_DIR`; private dist via `MM_SMOKE_DIST`; the repository `site/src/data`, generated pages and `dist` were not touched)
| Command | Result |
|---|---|
| `npm test` (in `site/`) | 539 tests, 538 pass, 0 fail, 1 skipped |
| `observable build` of the copy | 5 indicator pages, 3 domain pages built, no errors |
| `indicator.smoke.mjs`, MM_SMOKE_REQUIRE_BROWSER=1 | 26 tests, 25 pass, 0 fail, 1 skipped (C-IND-7: the sparse export has no series file) |

### Not measured
- Real export (72 indicators, 44 entities): not run; no screen-reader pass; no 320/390/768/1920 px clipping check of the two bands beyond the existing 320 and 1280 px tests; render time and CSS size not re-measured (L27).
- The `ux.smoke.mjs` indicator tests (focus order, contrast, targets) need the real-export shape (domain `labour`) and were not run for the indicator page here.

## L24 (PG-DOMAIN, PG-DOMAINS, PG-REVISIONS surface), 2026-11-11

### What was built
- PG-DOMAIN: `site/src/lib/domain-page.js` (`domainPage`): band `#band-domain` (h2 = domain name, link "All domains") over one card `#domain-card` holding the V1 heatmap block; filter bar with Group and Frequency only (`#filter-group`, `#filter-frequency`); rows and columns are selected from the stored scorecard by `cardView` (`heatmap.js`), nothing computed. The generator is `domainPageSource` in `site/scripts/lib.mjs`.
- PG-DOMAINS: `domainsListHtml` (`site/src/lib/domains-list.js`) returns one band (h2) with a card grid, one `li.mm-card` per domain (name as `h3` link, stored `notices[]` or the informational notice); no table, no filter bar.
- PG-REVISIONS: the generated page is wrapped in a band and one card (`#band-revisions`, `#revisions-card`); the cells inside are unchanged.
- Generated pages checked for consistency: after `prepare-data` in the scratch copy all 3 domain pages use `domainPage` and all 5 indicator pages carry `#indicator-header` (no page left on the old form). The pages in the repository `site/src/` are stale git-ignored output from before these edits and are regenerated by `npm run build`.

### Results
| Command | Result |
|---|---|
| `npm test` | see L23 table (539 tests, 538 pass, 0 fail, 1 skipped) |
| Browser dump of `/domain/fin#g=synthetic_a&f=Q`, `/domains`, `/revisions` on the scratch build | no page or console errors; bar shows Group and Frequency only; print line "Filters: Group: synthetic_a; Frequency: Quarterly" |
| `ux.smoke.mjs` + `heatmap-card.smoke.mjs` + `static.smoke.mjs` on the sparse build | not green: `ux.smoke.mjs` hard-codes `/domain/labour`, which the sparse fixture does not have (its domains are agri, fin, growth), so every V1-domain/page-matrix test times out there; not a regression of L24 and not fixed here. Total pass/fail of that run not recorded (stopped waiting). |

### Not measured
- `ux.smoke.mjs` (contrast, focus order, targets, 320-1920 px grid clipping AC-DB-11) and the domain/domains/revisions band against a real export; the 12/6/1 column grid and no-clipping check of the domains card grid; contrast of the new card tokens on these pages (`npm run check:contrast` not run); revisions content was checked only by element ids (unchanged), not pixel-compared.

## L11 (home band skeleton, scorecard loading policy), section added 2026-11-12

Only what was re-run on 2026-11-12 (private scratchpad copy of `site/`, `EXPORT_DIR` pointing at a copy of the committed sparse fixture; and a second private copy built over an export generated from `tests/fixtures/site_spike/make_export.py`; the repo `src/data`, generated pages and `dist` were not touched).

| Check | Result |
|---|---|
| `npm test` (in `site/`) | 544 tests, 543 pass, 0 fail, 1 skipped |
| `observable build` of both copies | built, no build error printed |
| `requests.smoke.mjs` test 1 (PG-HOME default load), sparse build and spike build | pass; requests are now recorded as a list: manifest.json, meta/entities, groups, domains, indicators, series, and `scorecard/<default domain>.json`, each exactly once; no `series/*`, no `.parquet` |
| `requests.smoke.mjs` test 2 (Domain change) | pass on both builds: only the chosen domain's scorecard is added, once; switching back adds nothing |

Fixed in this pass: the home page used to request `meta/series.json` and `manifest.json` twice (two `loadAll` calls). The page now loads the manifest once (the `boot` call) and `meta/series.json` once (in the `meta` call); the rank card reads it from there. A failed manifest or meta file still means no data card (amendment 5); both failure lists feed the failed-card alert.

Not re-verified: layout, CLS and timing of the skeleton (no browser measurement of these was made in this pass).

## Cleanup pass, 2026-11-12

### Done (all with unit tests unless noted)
- Home page fetches each file once (see L11). Smoke records requests as a list.
- `effectiveSelection`: with no Indicator chosen, the fallback is the first indicator the bar offers under the Domain and Frequency (null when none). Test in `tests/home-dashboard.test.mjs`.
- `states.smoke.mjs`: busy check now covers the `indicators` and `overTime` slots.
- Rank card: the Period hidden-rows disclosure sits directly under the card title (ADR-036, amendment 2.2); `tests/rank-model.test.mjs`.
- PG-SERIES: `g` is ignored and never written (amendment 2.3). `createFilterStore` has an `ignore` option; the page passes `["g"]`. The two tests that pinned pass-through were retargeted. Ignoring `g` sets no fallback note.
- PG-SERIES picker is narrowed on load (`pickerGroups`), and the fallback note is shown only when the address itself named an indicator that Domain/Frequency do not offer; a default replaced because of Domain is silent.
- PG-DOMAIN heatmap: the page clears `c` before `cardView`, so a carried Country neither marks nor adds rows.
- KPI tiles: at most 8 tiles in all, the domain-figure tile included (7 indicator tiles on a ranked Domain, 8 on an unranked one); the pinned `i` tile comes first even when the Domain does not list it (known indicators only).
- `filterbar.smoke.mjs` (item 7): causes were in test code. Reset test and carry test used ids that exist only in the spike export (`euro_area`, `/country/DEU`, `#d=labour`); now taken from the built fixture. Keyboard-only Country chip test typed a 3-letter prefix that all fixture names share; it now types the whole name. Controls-per-page-type: on the indicator page the Indicator control is the switcher (no `data-filter-control`, by design in `filter-bar.js`), the test expected it as a store control. The carry test also failed on the spike build because the sticky table header intercepts a pointer click on the first indicator link; it now activates the link with the keyboard. After the edits `filterbar.smoke.mjs`: 21 tests, 21 pass on the sparse build and 21 pass on the spike build. The sticky header covering the first link of the country table under a pointer click is a possible real issue (not fixed, not investigated further).
- `requests.smoke.mjs` PG-DOMAIN expectation now lists `meta/groups.json` (the bar has a Group control).

### Deviation for the architect (user decision, this session)
PG-SERIES keeps Country and Indicator in the rail; the filter bar there has Domain, Frequency and Period only. This deviates from amendment 2.4 / AC-DB-01 (which lists Country and Indicator as bar controls on that page). Implemented as decided; needs the amendment text updated.

### New strings, still DRAFT, awaiting confirmation
- `DRAFT_BAND_TABLE` = "Table" (L23 band title)
- `DRAFT_CHART_TYPE_LEGEND` = "Chart type" (L20 legend of Lines / Bars)
- `DRAFT_BAND_REVISIONS` = "Revisions" (PG-REVISIONS band h2, was a literal in `scripts/lib.mjs`), `DRAFT_CARD_REVISIONS` = "Revisions and vintages" (new h3 for the card, added for the card-title rule), `DRAFT_DOMAINS_BAND` and `DRAFT_ALL_DOMAINS_LINK` = "All domains" (PG-DOMAINS h2 and the PG-DOMAIN link; no longer `DRAFT_FILTER_ALL.domains`)

### Open review findings, not fixed
- PG-INDICATOR `maxEntities`.
- Rebase in Bars mode.
- Frequency basis on PG-COUNTRY.
- The revisions card has the V1 `h2` sections inside the new `h3` card (heading order inside the card unchanged).

### Smoke state after this pass (not green, not caused by the items above as far as checked)
- Spike build, full `smoke`: 353 tests, 306 pass, 14 fail, 33 skipped (before the last filterbar edit, which fixed 1 of the 14). Failing tests: PG-INDICATOR group filter (`#indicator-group input[value="euro_area"]` not found), T118 group fieldset, three `series-card`/AC-RD-14 history tests, PG-INDICATOR and PG-COUNTRY tab-traversal tests, `/domain/prices` aggregates row-group count (2 !== 1), a figure aria/guides test, PG-COUNTRY spacing at 320..1920 px (two tests), and two country-history contrast tests. These were not compared against a baseline run and were not diagnosed.
- Sparse build: `states.smoke.mjs` "empty rank card under Period" fails because 4 of 44 rows are hidden but rows without a date are never hidden, so the card is not empty (fixture-dependent); `requests.smoke.mjs` PG-SERIES (no series file in the sparse export) and PG-REVISIONS (no revisions file) fail for the same reason. The R13/R14, kpi and several V1 tests are written for the spike export.

## L26 static scans, copy and constraints

Tests only (`site/tests/ux-static.test.mjs`, `ux-style-scan.test.mjs`, `prose-scan.test.mjs`, `copy.test.mjs`); no `src/` change, no build, no `prepare-data`. `check-npm-imports.mjs` needs no change: it compares `dist/_npm` with the lock and no layout module imports a package.
- Scans added: total/average/sum label (strings, templates, pages); helper definitions named total/sum/average/mean/count with `countPeriodHiddenRows` whitelisted only in `filter-model.js`; `.length`/`.size` reads that feed output, with an allow-list (clause per entry, stale entries fail); `hidden*.length` outside `filter-model.js`; layout modules named and walked by directory; colour literals only as custom-property values in `style.css`; no new dependency and relative-only imports in all lib modules; synthetic-`dist` scan (off-origin URL, remote import, `@font-face`, font file); prose scan of layout module literals by visible text, with pinned older modules; amendment section 7 strings parsed from the amendment and matched to `DRAFT_` exports. Each has seeded negatives.
- Existing entity-count reads found (not L-task code, not fixed, allow-listed with `[pre-L]`/`[report]` for the user): `DRAFT_COUNTRY_SELECTED(selected.length)` in `filter-country.js:28` (L10 chip, count of the reader's own picks); country counts in the aria-labels `indicator-view.js:133` (`dots.length`) and `value-chart.js:60` (`rows.length`); `peers-view.js:65` (n of ranked rows); `scorecard.js:152` (`staleCount`); `home-lists.js:88` (`hrefs.size`, home link filter count). AC-DB-22 reads "no other browser-side count of entities, rows or states"; decision for the user whether these stay.

## L25 (accessibility, print and responsive sweep), 2026-11-12

Method: private copy of `site/` in the session scratchpad, built with `EXPORT_DIR` over an export generated by `tests/fixtures/site_spike/make_export.py` (the "spike build"); private dist via `MM_SMOKE_DIST`. The repository `src/data`, generated pages and `dist` were not touched. No baseline run was made: each failure was reproduced with a probe on the built page and diagnosed from the DOM and the CSS. The first full smoke on the L1-L24 tree gave 353 tests, 307 pass, 13 fail (the 14th, listed in the cleanup section, had been fixed by the last filterbar edit).

### The 14 failures from the cleanup section

| Failure | Diagnosis | Class | Fix |
|---|---|---|---|
| PG-INDICATOR group filter (`#indicator-group input[value=...]` not found) | L23 moved Group to the filter bar (`select#filter-group`) and the sort to the C-RANK header (`#rank-sort`), as amendment 4.3 says. `browser.smoke.mjs` still drove the V2 radio fieldset and `#indicator-sort`. `indicator.smoke.mjs` already covers the new controls. | stale test | `browser.smoke.mjs` retargeted to `#filter-group` and `#rank-sort` |
| T118 group fieldset | Same cause (there is no `fieldset#indicator-group` any more). The spike export's `groups.json` has `name` equal to `group_id`, so the old known-label list also cannot hold. | stale test, fixture | test rewritten: labelled select "Group", first option "All countries", option count = stored groups + 1, 24 px height, stored percentile unchanged by the filter |
| PG-COUNTRY AC-RD-14 history (3 tests: nothing fetched until activation, failed fetch, AC-RD-51) | Pointer click on "Show history" intercepted by `<th>Indicator</th>` of the sticky thead. | REAL DEFECT (below) | CSS |
| PG-INDICATOR and PG-COUNTRY tab traversal ("covered by th") | Same cause: focused links in the first rows are covered by the sticky header (WCAG 2.4.11, AC-DB-04). Same defect as the carry test noted in the cleanup section. | REAL DEFECT | CSS |
| Two country-history contrast tests (light, dark) | Same click interception on "Show history". | REAL DEFECT | CSS |
| `/domain/prices` aggregate row groups (2 !== 1) | The test expects an aggregates `tbody` only where the scorecard file has an aggregate row. Since L21 the heatmap rows are the comparison set (amendment 4.8: countries, then the aggregate group), so `EA` is listed on every ranked domain (here as a row without a value). | stale test | expectation is 2 row groups on every ranked domain |
| PG-INDICATOR figure aria/guides test (`ux.smoke.mjs`) | Same stale controls as the first row (`#indicator-group`, `#indicator-sort`). | stale test | retargeted to `#filter-group`, `#rank-sort` |
| PG-COUNTRY spacing 320..1920 px, default and 1.4.12 override (2 tests) | The layout probe reports the PG-COUNTRY table `caption` as clipped text ("content 221 wider than box 17"). The caption is visually hidden on purpose (L22: it repeats the card title; 1 px box, `clip-path: inset(50%)`). The probe exempted `.mm-visually-hidden` only. | stale test (probe) | probe skips an absolutely positioned element with `clip-path: inset(50%)` |

Real defect (sticky table header): `style.css` (L7/L10) had `.mm-country .mm-country-table thead th, .mm-indicator .mm-indicator-table thead th { top: var(--fbar-h) }`, written when the tables were in the page flow. Since L22/L23 both tables sit in their own scroll container (`.mm-ctry-scroll`, `.mm-ind-scroll`, max-height, overflow auto), so `top` is relative to the container, not the page. With `top` equal to the bar height the header sat below the container top and covered the first rows, including their links and buttons. Fixed: the rule is removed (the header sticks at `top: 0` of its container, as the heatmap and rank tables already do) and both containers get `scroll-padding-top: 3.5rem` so a focused cell stays clear of the header. After the fix the three history tests, the two traversal tests, the two history-contrast tests and the carry test's click all pass without code changes in the tests.

### Found by the sweep (not on the list)

- Heading order on PG-SERIES (`/explorer`): the page had an `h1` followed by the card title `h3` and no `h2` band (a skipped level). Fixed in `explorer-view.js`: a visually hidden `h2` with the existing band string `DRAFT_BAND_TITLES.overTime` before the card title. No visible change. Spec gap for the architect: amendment 4.4 names no band for PG-SERIES; a visible band may be wanted.
- The home `h1` in the build reads "Country scorecards", not the DRAFT "Macro dashboard" of the amendment string list (pending the user's confirmation; not changed here).

### New smoke tests (`tests/smoke/ux.smoke.mjs`, "L25" describes)

- Headings (AC-DB-10), 9 page types x 320 and 1280 px: one visible `h1`, no skipped level, every `.mm-band` has an `h2` and no other level, no card title other than `h3`.
- Print (AC-DB-06) on all 7 page types: no filter bar, and "Filters: none" on pages that have the bar (none on PG-DOMAINS and PG-REVISIONS, which have no bar).
- 320 and 390 px with a filter in the address (home, country, indicator, domain): no page-level horizontal scroll, no overlapping card pair.
- Keyboard pass of C-RANK on PG-HOME and PG-INDICATOR at 320 and 1280 px: the sort select changes by typing an option's first letter and keeps focus after the card redraws; every Tab stop inside the card has a visible focus indicator, is not covered by the bar or the sticky header, and is at least 24 x 24 px (inline links exempt, as in the existing target test). The bar chips' keyboard behaviour (open, Escape returns focus, outside focus closes) stays covered by `filterbar.smoke.mjs` L8/L9/L10.

### Results

| Check | Result |
|---|---|
| `npm run check:contrast` | 102 pair checks passed |
| `npm run check:imports` | 6 files match the lock |
| `npm test` (in `site/`) | 564 tests, 562 pass, 1 fail, 1 skipped. The failure is `tests/ux-style-scan.test.mjs` line 81 (owned by L26), which pins the removed rule `thead th { top: var(--fbar-h, 0px); }`; it must be changed to the new CSS (the rule is the defect above) |
| Full `smoke`, spike build, after the fixes | 386 tests, 353 pass, 0 fail, 33 skipped (all 33 need the synthetic sparse fixture export or a value chart this export lacks) |
| Sparse fixture build | not re-run in this task |

### NOT done (manual, AC-DB-33; Chromium emulation only so far)

- Screen reader pass of the filter bar and of C-RANK (including the point reader and the hidden-rows disclosure): NOT done.
- Firefox visual and keyboard check: NOT done.
- Safari (macOS and iOS) visual and keyboard check: NOT done.
- A real print dialog (paper size, page breaks, the filters line on paper): NOT done; only `emulateMedia("print")` and PDF generation in the existing T130 test.
- Windows high-contrast mode on real Windows: NOT done (only `forced-colors` emulation).
- Browser zoom to 200 and 400 percent and a real small phone: NOT done (only viewport emulation at 320, 390, 768, 1280, 1920).
