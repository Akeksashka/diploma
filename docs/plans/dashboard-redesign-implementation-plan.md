---
status: approved   # draft | proposed | approved. Approved by the user on 2026-11-06 (stated in session: "approved, go on").
inputs:
  - CLAUDE.md
  - docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md
  - docs/specs/dashboard-redesign-spec.md
  - docs/design/adr/ADR-010-interactive-dashboard.md
  - docs/design/adr/ADR-023-dashboard-toolkit-observable-framework.md
  - docs/design/adr/ADR-024-observable-framework-as-site-build-tool.md
  - docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md
  - docs/design/adr/ADR-026-percentile-orientation-legend-and-dashboard-display-rules.md
  - docs/plans/dashboard-ux-implementation-plan.md   # style reference only; not edited
---
# Dashboard redesign implementation plan (ADR-030, dashboard-redesign-spec)

Written 2026-11-06 by the planner. Nothing here is approved; the user approves. Task IDs are R1 onward (the UX plan used T99-T135). Order follows the spec's "order of work": sparse fixture and states (A), PG-COUNTRY (B), PG-INDICATOR and removal of `peers/*` (C), PG-SERIES with hover tip (D), PG-HOME / PG-DOMAINS / navigation / removal of `status` (E), accessibility sweep and weight measurement (F), user validation (G).

## 1. Scope and conventions

- Write locations (phase 4): only `site/` (src, scripts, tests, fixtures) plus `docs/ops/` for measurement and validation records. No task touches `src/`, `docs/design/`, `docs/specs/`, the export, or any ADR. AC-RD-56 is checked in every review.
- No new npm dependency (AC-RD-52). No new export file read. Browser evidence is Chromium emulation.
- Model split (CLAUDE.md): each task is implemented by `data-engineer` on Sonnet (`model: sonnet`). Each task GROUP ends with a "Review gate": a separate read-only Opus subagent (`model: opus`) checks the group against ADR-030, ADR-010/023/024/025/026, the spec and this plan. The orchestrator re-runs the commands of section 6 itself and does not trust the subagent's report.
- Sizes: S under 2 h, M under half a day. A larger task is split before starting.
- New strings are DRAFT in `copy.js` until the user confirms them (section 2, section 3). Confirmed strings are reused verbatim.
- Task fields: Goal, Files (all under `site/` unless stated), AC-RD, Verify, Depends, Risks. "Unit" = `node:test` in `site/tests`; "Smoke" = Playwright harness in `site/tests/smoke`.

## 2. Blockers, gates and carried open items (the user resolves; this plan decides none of them)

| ID | Item | What is open | Blocks | Needed from |
|---|---|---|---|---|
| G-Q3 | Q3: the user's list of unclear names | The list is not provided. Display names come from `meta/*`; a fix, if any, is in indicator configuration or CR-7 (`short_name`), neither in this plan. | R26 (wording review of the built pages) and the decision whether to request CR-7. Does not block R1-R25. | User: the list |
| G-Q4 | Q4: measure defined-but-empty vs undefined pairs | Count, on a real export, the (indicator, entity) pairs present in `meta/series.json` with a null value vs absent from it. **No real 44-entity export has been measured and none is known to exist (spec close-out items 7, 8). If none exists this gate stays open; R3's two sentences are tested on the synthetic sparse fixture only.** The plan does not infer the result. | CR-3 decision; R24. Not R3's fixture work | User: provide or build a real export; name the file or branch |
| G-STALE | Stale-banner field name `known_cutoff` | `site/src/lib/stale.js` (lines 16-17) prints the literal text "known_cutoff" in the banner and `shell.js` reads `manifest.known_cutoff`. The plan has not checked that this is the field name in `docs/specs/dashboard-export-spec.md`, nor whether the banner may show a field name to readers. The user decides. If the export name differs, that is an export-spec matter, not a site task. | R20. Existing behaviour stays untouched until resolved | User |
| G-STR1 | "No series is defined for this country and indicator." (spec 5.1) | Risky: it asserts a fact about the source, but the test (pair absent from `meta/series.json`) only shows "not in this export's series list". | R3 adds it as a DRAFT named constant | User |
| G-STR2 | "Data cut-off" (spec 5.3, section 7) vs the existing confirmed "Data as of" (`shell.js`) | Two labels for one field; changing a confirmed string conflicts with ADR-025 decision 11. | R20 keeps "Data as of" until decided | User |
| G-STR3 | "Compare with other countries" (history link, to PG-SERIES) vs "Compare countries" (to PG-INDICATOR) | Near-duplicate labels for different targets. | R7, R10 use both as DRAFT constants | User |
| G-STR4 | "Look at one series over time" (home link) vs the nav label "Time series" | Two names for PG-SERIES. | R18, R19 use DRAFT constants | User |
| G-STR | All other spec section 7 strings | DRAFT until confirmed (ADR-025 decision 11). | Release only; builds proceed with DRAFT marking | User |
| G-NAV | Generating about 44 country and about 80 indicator pages | The site has one static `.md` per domain (`site/src/domain/*.md`) and `site/observablehq.config.js`. Whether Framework 1.13.4 can emit parameterized pages (or needs generation in `prepare-data`) is UNVERIFIED. R2 probes it. If it needs an ADR-024 change or committed generated files, stop and report. | R6 onward | R2 result, then user if an ADR is needed |
| G-TIP | Plot tip on 0.6.18 | UNVERIFIED (spec C-SER-4). R15 probes first. If the tip is unusable or not keyboard accessible, the fallback needs a design decision (not made here). | R16 | R15 result |
| G-CR | Change requests | Section 4. | n/a | User |
| G-AC60 | AC-RD-60: the user's confirmation of J1-J3 and Q1-Q12 before plan approval | Only Q3 and Q4 are carried as open in the approval note; the documents read do not show per-question confirmation of the others. Any answer the user does not confirm is open. | Plan approval | User |

### 2.1 Gate status (2026-11-09; recorded with the user's approval of 2026-11-09)
The table above is the original gate list and is kept unchanged. Current status:

| ID | Status 2026-11-09 | Notes |
|---|---|---|
| G-STR1 to G-STR4 | Resolved | By the approved decisions record (`docs/ops/dashboard-redesign-decisions.md`, 2026-11-07). G-STR2 applied in R20: the freshness label is "Data cut-off". |
| G-STR | Partly resolved | 121 `DRAFT_` constants in `copy.js`: 20 confirmed, 3 likely (`HOME_FILTER_COUNT`, `HOME_FILTER_NONE`, `HOME_DOMAINS_TITLE`), the rest still DRAFT. The home filter wording was confirmed when the spec was re-approved (2026-11-09). The remaining strings go through R26; the rename of the confirmed constants is proposed as R27. |
| G-TIP | Resolved | R15: the Plot 0.6.18 tip is pointer-only. Approved fallback: the point-reader amendment (`docs/specs/dashboard-redesign-point-reader-amendment.md`), built in R16. |
| G-STALE | Resolved | ADR-031 is the source. R20 applies the ADR-031 banner strings; the banner shows no field name. An ADR-025 amendment written by an implementation agent was reverted; ADR-031 remains the source. |
| G-Q3 | Open | The list has not been provided. Blocks R26. |
| G-Q4 | Open | No real 44-entity export exists locally. Blocks R24 and the CR-3 decision. |
| G-NAV | Not re-stated here | R2 done (2026-11-07 or earlier); not re-checked in this entry. |
| G-CR | See section 4 status | |
| G-AC60 | Not re-stated here | No new evidence in this entry. |

## 3. String and copy rules
Strings in spec section 7 go into `site/src/lib/copy.js` with a DRAFT marker and a unit test (AC-RD-55) that lists them. The strings of G-STR1 to G-STR4 are separate named constants so one edit resolves each. "first release" and "first stored release" must appear nowhere. Withdrawn strings ("Guide", "Data status", the projections sentence, the one-unit sentence) must be absent.

## 4. Change requests: need separate user approval (not tasks)
CR-1 sparkline data; CR-2 projections (blocked by ADR-011); CR-3 `missing_reason` (decided after G-Q4); CR-4 per-entity profile files (raised only if R23/R24 measure PG-COUNTRY over the AC-RD-53 target; AC-RD-53 depends on it conditionally); CR-5 `unit_label` scale (R7 and R14 show `unit_label` as stored; AC-RD-42 may be only partly met until answered); CR-6 unit for `transformed_value` (R9 and R10 show the transform label only); CR-7 `short_name`; CR-8 per-indicator rank position; CR-9 domain display order (R6 uses `meta/domains.json` order, sorted by id, until the user chooses); CR-10 CSV download (not built; C-IND-7 links Parquet only). No task edits the export or the export spec.

Status 2026-11-09:
- CR-5 and CR-6: the proposal `docs/specs/dashboard-redesign-cr5-cr6-proposal.md` is approved to be raised. The user approved its answers Q1-Q7:
  - Q1: fill at export time from the shared registry.
  - Q2: new field `unit_text`; `unit_label` stays codes.
  - Q3: `REAL_RATE` in %; `SPREAD_VS_REF` in percentage points (`PP`); annualised transforms labelled "% annualised".
  - Q4: drop `DEV_FROM_AVG` from the analytics spec.
  - Q5: the label strings are batched into R26.
  - Q6: confirm that `PURE_NUMB` loads, then seed it.
  - Q7: measure the `meta/*` size on the R24 export first.
- Order: CR-6, then CR-5, in one forward-only migration. The migration is applied to neondb only when the user explicitly asks, and never to postgres. The spec edits come from the architect; implementation is proposed as R28.
- CR-3, CR-4: open; they wait on G-Q4 and R24.
- CR-9: open. R17 sorts by `domain_id`.

## 5. Task list

### Group A - Foundations: sparse fixture, states, shared modules

### R1: Pin existing hash names and layout facts (S)  [x] done
- Goal: record the existing hash parameter names of explorer and peers pages (spec 1.5 marks reconciliation [UNVERIFIED]), the fixture location, and the existing helper module names, so later tasks reuse them.
- Files: `site/tests/hash-baseline.test.mjs` (new; pins current behaviour).
- AC-RD: 34 (precondition).
- Verify: `npm test`.
- Depends on: none.
- Risks: existing names differ from `#i=&c=&g=`; R4 then maps old to new. Report; do not change the spec syntax.

### R2: Probe dynamic page generation (S)  [x] done
- Goal: settle G-NAV: show on the fixture that one template yields one page per non-global entity and per indicator under Framework 1.13.4.
- Files: `site/observablehq.config.js`, stub `site/src/country/[entity].md` and `site/src/indicator/[indicator].md` (final form set by the probe), `site/scripts/prepare-data.mjs` only if the probe needs it.
- AC-RD: 01 (partial).
- Verify: `npm run build`; `dist/` has one stub per fixture entity (not `WLD`) and per indicator.
- Depends on: R1.
- Risks: an approach that contradicts ADR-024 (for example committed data files) is a blocker; stop and report.

### R3: Sparse fixture and missing-data state mapping (M)  [x] done
- Goal: create the sparse fixture (44 entities; one domain with 3 percentiles; others empty; a defined-but-empty pair and an undefined pair; an indicator in two domains; estimate, inherited, stale, unaligned, aggregate, non-ranked domain, `n_available = 0`). Implement the pure mapping of stored fields to (code, signature, sentence) per spec 5.1, using only presence in `meta/series.json` for the two `n/a` rows.
- Files: `site/tests/fixtures/sparse_export/**` (new), `site/src/lib/missing.js`, `site/src/lib/copy.js` (DRAFT strings, G-STR1 constant), `site/tests/missing.test.mjs`, `site/tests/fixtures.test.mjs` (fixture sanity; the two-domain indicator has equal stored percentiles in both scorecards).
- AC-RD: 24, 40 (unit part), 41, 50, 55 (partial).
- Verify: `npm test`; a table test covers every row of spec 5.1; a test fails if `n/a` has no sentence.
- Depends on: R1.
- Risks: the fixture is synthetic and must not be described as a measurement (G-Q4). The mapping reads no field beyond those in the spec.

### R4: Shared pure helpers: hash, period label, unit text, sort (M)  [x] done
- Goal: hash parse/serialize (`#i`, `#c`, `#g`; invalid falls back with a note flag); period label from `ref_period_end` and `frequency` (M, Q, A examples pinned in tests); unit text selection (5.2, including `unit_mult` text and rebase text); stable sort by stored field, nulls last, ties by name.
- Files: `site/src/lib/hash.js`, `period.js`, `units.js`, `sort.js`; `site/tests/hash.test.mjs`, `period.test.mjs`, `units.test.mjs`, `sort.test.mjs`.
- AC-RD: 22 (unit), 34 (unit), 42 (unit), 43.
- Verify: `npm test`. The pinned period formats are reported to the user for confirmation (spec 5.3).
- Depends on: R1.
- Risks: format choice is presentational; keep as constants. No value is computed.

### R5: Extend static scans to the new modules (S)  [x] done
- Goal: add new modules to the AC-UX-10/11 scans (no mean, rank, percentile computation, entity count, composite; no off-origin string); add the AC-RD-62 data-only prose scan (closed allow-list of spec 1.6, strings of at most 160 characters) and the unit-presence scan (AC-RD-42), each with a seeded negative.
- Files: `site/tests/ux-style-scan.test.mjs`, `site/tests/ux-static.test.mjs`, `site/tests/prose-scan.test.mjs` (new).
- AC-RD: 42 (scan), 50, 51 (static part), 52, 62 (scan).
- Verify: `npm test`; `npm run check:imports`; seeded negatives fail.
- Depends on: R3, R4.
- Risks: the allow-list comes from the spec only; unlisted text fails.

**Review gate A** (Opus, read-only): R1-R5 against spec 1.1, 1.6, 5.1-5.3 and ADR-026; no export or ADR diff.

### Group B - PG-COUNTRY

### R6: Country page generation and row model (M)  [x] done
- Goal: pages `country/<entity_id>` for every non-global entity (h1 = name, group memberships, kind, breadcrumb, caveat then orientation line, shell); pure row-model builder from scorecards and meta (per domain: figure-line fields; rows with a value, then rows without).
- Files: `site/src/country/[entity].md` (or the R2 form), `site/src/lib/country-model.js`, `site/tests/country-model.test.mjs`, `site/observablehq.config.js`.
- AC-RD: 01 (partial), 10, 11 (unit), 12 (model), 15 (model).
- Verify: `npm test`; `npm run build` lists the expected pages and none for `WLD`.
- Depends on: R2, R3, R4.
- Risks: reading every scorecard (spec section 3 rule 2); payload measured in R23/R24.

### R7: Country page rendering: sections, table, profile chart (M)  [x] done
- Goal: render C-CTRY-1 to C-CTRY-5: domain figure line; dot strip with bin bands (hollow mark for estimate or inherited, `role="img"` with generated label, table beneath); indicator table with unit, period, percentile chip, source and state sentence; second row group without a value; filter "all / only with a value" (filter only, no hidden count); country switcher; links to PG-INDICATOR, PG-DOMAIN and PG-SERIES with `#i=`/`#c=`.
- Files: `site/src/lib/country-view.js`, `site/src/lib/profile-chart.js`, `site/src/style.css`, `site/src/country/[entity].md`, `site/tests/smoke/country.smoke.mjs`.
- AC-RD: 10, 11, 12, 13, 15, 40 (smoke on sparse fixture), 42, 45, 54 (country part), 62.
- Verify: `npm test`; `npm run smoke`; grayscale check reuses the AC-UX-2 helpers.
- Depends on: R6, R5.
- Risks: table at 320 px with sticky header; G-STR3 labels stay DRAFT.

### R8: Country "About this value" and "Show history" (M)  [x] done
- Goal: `<details>` field list per spec 5.5 (keyboard-operable, stored data only); lazy history: no fetch until activation, then exactly one `series/<indicator_id>.parquet`, entity-only line chart with unit on the axis; inline error block on failure; Parquet reader loaded on first activation only.
- Files: `site/src/lib/about-value.js`, `site/src/lib/history.js`, `site/tests/about-value.test.mjs`, `site/tests/smoke/country-history.smoke.mjs`, `site/src/style.css`.
- AC-RD: 14, 42, 46, 51, 54.
- Verify: `npm test`; `npm run smoke` with route interception (failure case and request list).
- Depends on: R7.
- Risks: the existing explorer Parquet loader may need factoring out; its behaviour stays unchanged.

**Review gate B** (Opus, read-only): R6-R8 against C-CTRY-1..5, 5.1, 5.5, AC-RD-10..15, 40, 46; no computed figure, no figure combining domains.

### Group C - PG-INDICATOR and removal of `peers/*`

### R9: Indicator page generation and row model (M)  [x] done
- Goal: pages `indicator/<indicator_id>` for every indicator; header (name, id secondary, domain links, unit label, frequency set, direction label, `notes[]`, transform label from `transform_options[]` else the stored `transform_id`); row model with every entity of the scorecard; first-domain rule for an indicator in two domains (AC-RD-24).
- Files: `site/src/indicator/[indicator].md` (or the R2 form), `site/src/lib/indicator-model.js`, `site/tests/indicator-model.test.mjs`, `site/observablehq.config.js`.
- AC-RD: 01 (partial), 20 (model), 21, 24, 25 (header part).
- Verify: `npm test`; build lists one page per indicator; two-domain fixture test.
- Depends on: R2, R3, R4.
- Risks: `transformed_value` has no unit (CR-6); only the transform label is shown.

### R10: Indicator page rendering: controls, table, value chart, dot plot (M)  [x] done
- Goal: C-IND-1..7: peer-group filter/sort (existing V2 behaviour and filter note verbatim); sort select (Country, Value, Percentile, Reference period) with `aria-sort`; reference-period line; value bars with percentile-bin fill and axis title (name and unit); existing V2 dot plot; all-country table (cards under 40 rem); "Open as time series" (focus country, else first five alphabetical, never by percentile); Parquet download link; indicator switcher. Hover tip is added in R16, not here.
- Files: `site/src/lib/indicator-view.js`, `site/src/lib/value-chart.js`, existing peers modules reused, `site/src/style.css`, `site/tests/smoke/indicator.smoke.mjs`.
- AC-RD: 20, 21, 22 (smoke), 23, 25, 40, 42, 45, 54 (indicator part), 62.
- Verify: `npm test`; `npm run smoke`.
- Depends on: R9, R8 (shared About-value), R5.
- Risks: bar chart without tip until R16; the table is the complete route meanwhile.

### R11: Cross-links from existing pages (S)  [x] done
- Goal: PG-DOMAIN row headers link to PG-COUNTRY and column headers to PG-INDICATOR (and replace any link to `peers/`); PG-REVISIONS names link likewise; PG-REVISIONS otherwise unchanged.
- Files: `site/src/lib/heatmap.js` (or equivalent), `site/src/domain/*.md`, `site/src/revisions.md`, `site/src/lib/revisions.js`, `site/tests/heatmap.test.mjs`, `site/tests/revisions.test.mjs`.
- AC-RD: 04.
- Verify: `npm test`; `npm run smoke` link checks.
- Depends on: R7, R10.
- Risks: header width and accessible names; never truncate without the full name.

### R12: Remove `peers/*` (S)  [x] done
- Goal: delete the 11 `site/src/peers/*.md` pages and their navigation links; keep helpers still used by PG-INDICATOR; retarget `peers.test.mjs` and smoke tests.
- Files: `site/src/peers/*.md` (delete), peers modules in `site/src/lib/`, `site/tests/peers.test.mjs`, `site/tests/smoke/*.smoke.mjs`, `site/observablehq.config.js`.
- AC-RD: 01, 02 (partial), 04.
- Verify: `npm test`; `npm run build`: no `dist/peers/`, no link to `peers/`.
- Depends on: R10, R11.
- Risks: a leftover internal link breaks AC-RD-02.

**Review gate C** (Opus, read-only): R9-R12 against C-IND-1..7, 4.3, AC-RD-20..25, ADR-010 decision 10, ADR-026; `peers/*` is gone; no export diff.
- Result: PASS (Opus, 2026-11-07); findings 2,4,5 fixed; heatmap-link and ranking-line decided in the decisions record.

### Group D - PG-SERIES

### R13: Series defaults, hash and names (S)  [x] done
- Goal: indicator and countries from `#i`/`#c`; default first indicator of first domain with no country and the hint "Choose up to 5 countries to compare."; invalid hash falls back with a visible note; picker shows names and unit; overlay cap 5, small multiples above (existing).
- Files: `site/src/explorer.md`, `site/src/lib/explorer*.js`, `site/tests/explorer.test.mjs`, `site/tests/smoke/series.smoke.mjs`.
- AC-RD: 04 (apply hash), 31, 32 (partial), 34.
- Verify: `npm test`; `npm run smoke`.
- Depends on: R4, R10.
- Risks: earlier smoke tests may rely on the current default preselection; update the tests to the spec, not the other way.

### R14: "About these series" table and units (S)  [x] done
- Goal: C-SER-6 table (source link, attribution, frequency, unit, seasonal adjustment, price basis, last period, its `known_at`, re-estimated marker); unit in title, axis, end labels and "View as table" headers; rebased series use the index unit text; estimate marker from `value_status`.
- Files: `site/src/explorer.md`, `site/src/lib/series-meta.js`, `site/tests/series-meta.test.mjs`, `site/tests/smoke/series.smoke.mjs`.
- AC-RD: 32, 33, 42, 44, 45 (PG-SERIES).
- Verify: `npm test`; `npm run smoke`.
- Depends on: R13.
- Risks: scale in `unit_label` unconfirmed (CR-5).

### R15: Probe Plot tip on 0.6.18 (S)  [x] done
- Result: Plot 0.6.18 tip is pointer-only, not keyboard accessible; probe in scratchpad; decision in docs/ops/dashboard-redesign-decisions.md item 1; approved amendment docs/specs/dashboard-redesign-point-reader-amendment.md.
- Goal: settle G-TIP: in Chromium on the built site, verify Plot's tip mark with pointer hover and keyboard focus on a line chart and a bar chart, inside the `role="img"` wrapper. Findings labelled verified or unverified.
- Files: throwaway probe in the scratchpad; nothing committed.
- AC-RD: 30 (precondition).
- Verify: written findings in the task report.
- Depends on: R13.
- Risks: if the tip cannot be used or reached by keyboard, stop; a design decision is needed.

### R16: Hover/focus tip on PG-SERIES and PG-INDICATOR (M)  [x] done (2026-11-09)
- Result: hover tip plus the "Read a value" point reader (point-reader amendment). Escape also dismisses the static highlight tip.
- Goal: C-SER-4 tip (country, period label, value with unit, `value_status` mark, `known_at`; no computed number) and the minimal tip on the PG-INDICATOR value chart; tables stay the complete route.
- Files: `site/src/lib/series-chart.js`, `site/src/lib/value-chart.js`, `site/src/style.css`, `site/tests/tip-text.test.mjs`, `site/tests/smoke/series.smoke.mjs`, `site/tests/smoke/indicator.smoke.mjs`.
- AC-RD: 30, 32, 42, 50.
- Verify: `npm test`; `npm run smoke`; static scan that tip strings contain no computation.
- Depends on: R15, R14, R10.
- Risks: pointer-only behaviour (WCAG 2.5.7); Firefox and Safari untested.

**Review gate D** (Opus, read-only): R13-R16 against C-SER-1..8, 5.6, AC-RD-30..34.
- Result: PASSED WITH FIXES (Opus); the fixes are applied and the orchestrator re-ran the tests (recorded 2026-11-09; commits c905649, 5d2ea39).

### Group E - PG-HOME, PG-DOMAINS, navigation, removal of `status`

### R17: PG-DOMAINS page (S)  [x] done (2026-11-09)
- Result: PG-DOMAINS built and sorted by `domain_id`. CR-9 (domain display order) is still open.
- Goal: build-time list of domains (name, `notices[]`, link to PG-DOMAIN); no table.
- Files: `site/src/domains.md`, `site/src/lib/domains-list.js`, `site/tests/domains-list.test.mjs`.
- AC-RD: 01, 05.
- Verify: `npm test`; `npm run build`.
- Depends on: R2.
- Risks: none identified.

### R18: PG-HOME rewrite (M)  [x] done (2026-11-09)
- Result: PG-HOME built. The home filter wording was confirmed when the spec was re-approved on 2026-11-09.
- Goal: static country list (countries alphabetical, aggregates under a subheading) and static indicator list grouped by domain in `<details>`, each with a labelled text filter (progressive enhancement); links to PG-SERIES, PG-DOMAINS, PG-REVISIONS; title, caveat, shell only; no heatmap, overall figure or status block.
- Files: `site/src/index.md`, `site/src/lib/home-lists.js`, `site/src/style.css`, `site/tests/home-lists.test.mjs`, `site/tests/smoke/home.smoke.mjs`.
- AC-RD: 02, 03, 05, 62.
- Verify: `npm test`; `npm run smoke`; built HTML contains the full lists without JS.
- Depends on: R6, R9, R17.
- Risks: link text for PG-SERIES is G-STR4 (DRAFT constant).

### R19: Navigation and removal of `status` (S)  [x] done (2026-11-09)
- Result: the navigation is Home / Time series / Domains / Revisions. The status, guide and peers pages are gone. `peers.js` and `peers-view.js` remain because other modules still use them.
- Goal: header navigation Home, Time series, Domains, Revisions; delete `site/src/status.md` and its module and tests; remove every link to status; no guide page.
- Files: `site/observablehq.config.js`, `site/src/status.md` (delete), status module in `site/src/lib/` (delete if unused elsewhere), `site/tests/status.test.mjs` (delete or retarget), `site/tests/shell.test.mjs`, smoke tests.
- AC-RD: 01, 02, 62.
- Verify: `npm test`; `npm run build`: no `dist/status`, no `dist/guide`, no link to either.
- Depends on: R18, R12.
- Risks: the stale banner and freshness line still read the manifest; wording unchanged here (G-STALE, G-STR2). If the current banner contains a link to status, report it before removing.

### R20: Freshness label and stale banner (S)  [x] done (2026-11-09)
- Result: the freshness label is "Data cut-off". The stale banner uses the ADR-031 strings and shows no field name.
- Goal: apply only the user's decisions on G-STALE and G-STR2. Not started until both are answered.
- Files: `site/src/lib/shell.js`, `site/src/lib/stale.js`, `site/src/lib/copy.js`, `site/tests/shell.test.mjs`, `site/tests/copy.test.mjs`.
- AC-RD: 55, 62.
- Verify: `npm test`.
- Depends on: G-STALE, G-STR2, R19.
- Risks: changes a confirmed string.

### R21: Page-set, link-integrity, copy and request tests (S)  [x] done (2026-11-09)
- Result: the build-pages, copy and requests tests are in place. CI runs them with `MM_REQUIRE_DIST=1`.
- Goal: build test over `dist/`: exact page set (AC-RD-01), every link resolves, every entity and indicator linked from home, no unreachable page (AC-RD-02); copy test: spec section 7 strings present and DRAFT-marked, withdrawn strings absent, confirmed strings unchanged; per page request list against manifest `files[]` (AC-RD-51).
- Files: `site/tests/build-pages.test.mjs`, `site/tests/copy.test.mjs`, `site/tests/smoke/requests.smoke.mjs`.
- AC-RD: 01, 02, 05, 51, 52, 55, 62.
- Verify: `npm run build && npm test && npm run smoke && npm run check:imports`.
- Depends on: R19.
- Risks: build time with about 125 more pages (measured in R23).

**Review gate E** (Opus, read-only): R17-R21 against spec sections 2, 4.1, 4.5, AC-RD-01..05, 55, 62; no Guide or Status artefact.
- Result: PASSED WITH FIXES (Opus); the fixes are applied and the orchestrator re-ran the tests (recorded 2026-11-09). The fixes:
  - `prepare-data` copies only files listed in the manifest, requires a sha256 for each, and follows no symlinks.
  - The layout reservations were measured and corrected: the home shell reserves 40.8px below 416px and 20.4px otherwise; the filter slot reserves 56px.

### Group F - Accessibility sweep and weight

### R22: AC-UX-1..9 on all new page types (M)  [x] done (2026-11-09)
- Result: the sweep ran and one print defect was fixed. Still to be checked by hand: screen reader, Firefox, Safari, real print dialog, Windows high-contrast.
- Goal: run contrast, non-colour, theme, keyboard/focus, semantics, responsive 320-1920, states, print and preference checks on home, country, indicator, series, domains; fix defects within `site/`.
- Files: `site/scripts/contrast-pairs.mjs`, `site/tests/smoke/ux.smoke.mjs`, `site/tests/smoke/ux-support.mjs`, `site/src/style.css`.
- AC-RD: 05, 40 (grayscale), 54.
- Verify: `npm run check:contrast`; `npm run smoke`.
- Depends on: R21.
- Risks: Chromium emulation only; screen reader, Firefox, Safari and real print are manual.

### R23: Weight and build measurement on the fixtures (M)  [x] done (2026-11-09)
- Result: `npm run measure:pages` is in place. The numbers are from the fixtures only.
  - AC-RD-53 stays partly unmet until R24.
  - PG-SERIES first load, split as in the AC-RD-53 amendment approved 2026-11-09: own files 267 KB gz; reader plus series 1.82 MB gz against the 5 MB limit.
- Goal: new measure script reporting gzip first-load per page type (home, a country before history, an indicator), CSS size, one history interaction, CLS, build time and total site size; run on the fixture and the sparse fixture; record in `docs/ops/dashboard-redesign-measurements.md`.
- Files: `site/scripts/measure-pages.mjs` (new), `site/package.json` (script `measure:pages`; no dependency), `site/tests/scripts.test.mjs`, `docs/ops/dashboard-redesign-measurements.md`.
- AC-RD: 53 (fixture part).
- Verify: `npm run measure:pages`; targets: 600 KB gz per page type (hard limit 1.5 MB), interaction at most 5 MB gz, CSS at most 20 KB gz, CLS at most 0.1. Record, do not tune silently.
- Depends on: R22.
- Risks: the sparse fixture understates real payloads.

### R24: Real-export measurement and Q4 count (M)  [ ] not done (gated)
- Status 2026-11-09: NOT DONE.
  - No real 44-entity export exists locally. docker, psql, pg_restore and uv are not installed on this machine.
  - Two routes, both the user's choice:
    - (a) restore the public dump into a local Postgres (ADR-015), then run `macro-monitor export`;
    - (b) a read-only export from neondb, only when the user explicitly asks.
  - Still open: G-Q4, CR-3, CR-4, and the `.wasm` compression question (ADR-023 C2). The `.wasm` question needs a Pages deploy workflow, and the base path "/" is a risk there.
- Goal: run R23 and the G-Q4 count on a real 44-entity export. If none exists, report "not done"; AC-RD-53 stays partly unmet; nothing is extrapolated.
- Files: `docs/ops/dashboard-redesign-measurements.md`.
- AC-RD: 53 (real part).
- Verify: numbers with the export identity (build id, date).
- Depends on: R23, G-Q4.
- Risks: if PG-COUNTRY exceeds the target, CR-4 is raised for the user's approval; this plan does not build it.

**Review gate F** (Opus, read-only): R22-R24 results against AC-RD-53/54; no extrapolated numbers.
- Result: PASSED WITH FIXES (Opus) for R22-R23; the fixes are applied and the orchestrator re-ran the tests (recorded 2026-11-09). The fixes:
  - an amendment to the explorer weight in the spec;
  - the measurement takes the maximum over all country and indicator pages.
- R24 is not done, so gate F does not cover it.

### Group G - User validation (pending the user)

### R25: Validation tasks T-J1, T-J1b, T-J2, T-J3, T-H4 (manual)  [ ] todo
- Status 2026-11-09: pending the user. The checklist is spec section 8. Serve `dist` with `serve()` from `site/tests/smoke/support.mjs`.
- Goal: user or named reviewers run spec section 8 on a clean browser against the built site; results recorded.
- Files: `docs/ops/dashboard-redesign-validation.md`.
- AC-RD: 61.
- Verify: manual; not an acceptance gate for the build.
- Depends on: R22 (R24 preferred).
- Risks: number of participants is the user's choice (Q1). Not automatable.

### R26: Wording review of built pages (S)  [ ] todo (gated)
- Status 2026-11-09: gated by G-Q3 (no list yet) and by the DRAFT strings. `copy.js` has 121 `DRAFT_` constants: 20 confirmed, 3 likely (`HOME_FILTER_COUNT`, `HOME_FILTER_NONE`, `HOME_DOMAINS_TITLE`). The CR-5/CR-6 unit label strings (Q5) are also reviewed in R26.
- Goal: with the user, review names (G-Q3) and DRAFT strings (G-STR*) on built pages; apply only the changes the user dictates; list any that need a CR.
- Files: `site/src/lib/copy.js`, `site/tests/copy.test.mjs`.
- AC-RD: 55.
- Verify: `npm test`.
- Depends on: G-Q3, G-STR*, R22.
- Risks: a name fix needing configuration or CR-7 is outside this plan.

### Group H - Follow-up tasks (PROPOSED 2026-11-09; not approved; the user approves each)

### R27: One-pass rename of confirmed `DRAFT_` constants (S)  [ ] PROPOSED
- Goal: in a single change, drop the `DRAFT_` prefix from the constants the user has confirmed: the 20 confirmed ones, plus the 3 likely ones (`HOME_FILTER_COUNT`, `HOME_FILTER_NONE`, `HOME_DOMAINS_TITLE`) only after the user confirms each. Update every importer and every test that names them. String values stay byte-for-byte unchanged. The other DRAFT constants keep their prefix.
- Files: `site/src/lib/copy.js`; the `site/src/lib/*.js` modules that import the renamed constants (today about 30 files reference `DRAFT_`, for example `home-lists.js`, `indicator-view.js`, `explorer-view.js`, `shell.js`); `site/observablehq.config.js`; `site/scripts/lib.mjs`; the tests that reference them (`site/tests/copy.test.mjs`, `prose-scan.test.mjs`, `state-blocks.test.mjs`, `country-view.test.mjs`, `home-lists.test.mjs`, `domains-list.test.mjs`, `missing.test.mjs`, `about-value.test.mjs`, `country-model.test.mjs`, `indicator-view.test.mjs`, `site/tests/smoke/home.smoke.mjs`).
- AC-RD: 55.
- Verify: `npm test`; `npm run check:imports`; `npm run build`; `npm run smoke`. The copy test asserts that the renamed constants are no longer DRAFT-marked, that their values are unchanged, and that every other constant is still DRAFT-marked. `git diff` shows no change in string values.
- Depends on: the user's list of the 23 constants (the 3 likely ones confirmed explicitly); R21.
- Risks:
  - The copy test checks DRAFT marking. It must change to the confirmed set in the same commit, or it fails, or worse, passes for the wrong reason.
  - A missed importer breaks the build. `check:imports` and the build catch this.
  - Doing the rename at the same time as R26 could mix renames with wording changes. Keep them in separate commits.

### R28: CR-6 then CR-5 implementation (M, to be split) [ ] PROPOSED (blocked)
- Goal: implement the approved CR-5/CR-6 answers in this order: CR-6, then CR-5.
  - CR-6: add `result_unit` to the transform registry: `REAL_RATE` `PCT`, `SPREAD_VS_REF` `PP`, annualised transforms "% annualised" (Q3). Remove `DEV_FROM_AVG` from the analytics spec (an architect edit, Q4). Fill the transform unit fields at export time from the shared registry (Q1).
  - CR-5: add the `unit_text` export fields; `unit_label` stays codes (Q2).
  - Both: one forward-only migration (the `ref.unit` columns, the public unit view and grant, the `PP` seed, and the `PURE_NUMB` seed once a load confirms it, Q6).
  - Then: the site reads the new fields in `units.js` and the views.
- Files (indicative; the approved spec edits decide): `src/macro_monitor/analytics/transforms.py`, `src/macro_monitor/publish/meta.py` (and the scorecard writer), `src/macro_monitor/storage/migrations/<next>_*.sql` (new), the export JSON Schemas, `tests/unit/`, `tests/fixtures/`, `tests/integration/` (`db`), and on the site `site/src/lib/units.js`, the views that show units, `site/tests/units.test.mjs`, and the fixtures under `site/tests/fixtures/`.
- AC-RD: 42, 50 (as amended by the architect); the new export ACs (AC-EXP-16/17 or as renamed).
- Verify: `ruff check`, `ruff format --check`, `mypy --strict src`, `pytest` (unit), `pytest -m db` on a throwaway database on the configured Neon branch (never neondb, never postgres), plus the site checks in section 6. The migration goes to neondb only when the user explicitly asks.
- Depends on: the architect's edits to the export, analytics and DDL specs, approved by the user. Also R24 (Q7: measure the `meta/*` size on the real export first).
- Risks and blockers (flagged, not resolved here):
  - BLOCKER: the proposal's field names (section 4.3/4.4: `unit_label` redefined, `transformed_unit_label`, `transform_units.unit_label`) differ from the approved Q2 answer (new field `unit_text`, `unit_label` unchanged). The architect must restate the field names before this task can be specified.
  - BLOCKER: it is not stated whether "% annualised" is a new `ref.unit` code or only a label on `PCT`. Design decides.
  - BLOCKER: this task writes outside the plan's scope (section 1: `site/` and `docs/ops/` only). The user must approve the scope extension.
  - The size of `meta/series.json` against the 1 MB estimate is unmeasured (Q7).
  - Before starting, split this into at least: registry and migration; export fields; site consumption.

### R29: Explorer measurement follow-up (S)  [ ] PROPOSED (conditional)
- Goal: only if the R24 real-export numbers show PG-SERIES or the explorer over the amended AC-RD-53 targets, re-measure and report. If R24 shows no excess, close it with no work. It tunes nothing silently.
- Files: `docs/ops/dashboard-redesign-measurements.md`; `site/scripts/measure-pages.mjs` only if the measurement needs a fix.
- AC-RD: 53.
- Verify: `npm run measure:pages` on the real export, with the export identity recorded.
- Depends on: R24.
- Risks: the Pages deploy design for ADR-023 C2 (`.wasm` compression, base path "/") is a separate design item for the architect, not part of R29.

## 6. Test and review checklist
ruff and mypy do not apply to `site/` changes (no Python file is touched). The orchestrator re-runs these itself in `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/site/`:
1. `npm test` (`node --test tests/*.test.mjs`)
2. `npm run check:imports`
3. `npm run check:contrast`
4. `npm run build` (`prepare-data` then `observable build`)
5. `npm run smoke` (`node --test tests/smoke/*.smoke.mjs`)
6. `npm run measure:landing`, and after R23 `npm run measure:pages`
7. `git diff --stat`: no change in `src/`, `docs/design/`, `docs/specs/` or export schemas (AC-RD-56); no new entry in `site/package.json` dependencies (AC-RD-52).
Opus review per group: check against ADR-030, ADR-010, ADR-023 to 026, the spec and this plan; data-only rule (no prose beyond spec 1.6); D6 (no computation in the browser); no Guide, Status or peers remnants; DRAFT strings marked.

## 7. Manual items outside automation
Screen reader, Firefox, Safari, real print dialog (AC-UX-14), validation tasks R25.

## 8. Risks and unknowns
- Plot tip behaviour on 0.6.18 is unverified (R15).
- Generating about 125 pages under Framework 1.13.4 is unverified (R2); build time unknown.
- No real 44-entity export has been measured (the baseline notes 3 of 42 countries with a percentile in the real export); the PG-COUNTRY payload from reading all scorecards is unknown (R24, CR-4).
- The sparse fixture is synthetic; passing it does not prove real-data behaviour.
- `unit_label` may not state the scale (CR-5) and `transformed_value` has no unit (CR-6); AC-RD-42 may be partly met until answered.
- Browser evidence is Chromium emulation only.
- Stale-banner field name and the risky strings are unresolved (section 2).
- AC-RD-60 (the user's confirmation of Q1-Q12) is not evidenced in the documents read beyond Q3 and Q4 being carried as open.

## Progress log (2026-11-07)
- Decisions record (docs/ops/dashboard-redesign-decisions.md) approved by the user.
- ADR-031 and the point-reader amendment approved.
- ADR-032 and ADR-033 proposed (licence read pending).
- Gates G-STR1-4 and G-TIP resolved by the decisions record.
- G-Q3, G-Q4 and G-STALE-implementation still open; ADR-031 approved so R20 may proceed.

## Progress log (2026-11-09)
Recorded with the user's approval of 2026-11-09 ("approved as opus recommended"). The orchestrator verified the results by re-running the tests. Commits c905649 and 5d2ea39 on branch `redesign/checkpoint-2026-11-08`, base ff22317.
- Done: R16, R17, R18, R19, R20, R21, R22, R23. Details are under each task.
- Review gates D (R13-R16), E (R17-R21) and F (R22-R23) passed with fixes; the fixes are applied.
- R24 is not done: there is no real export locally, and no tooling to build one. The routes are listed under R24. R25 waits on the user. R26 is gated by G-Q3 and the DRAFT strings.
- The spec `docs/specs/dashboard-redesign-spec.md` was re-approved by the user on 2026-11-09. The re-approval includes the home filter wording and the AC-RD-53 amendment (the PG-SERIES first-load split).
- An ADR-025 amendment written by an implementation agent was reverted; ADR-031 is the source.
- The CR-5/CR-6 proposal is approved to be raised, with answers Q1-Q7 (section 4 status).
- Gates: G-STR1-4, G-TIP and G-STALE are resolved. G-STR is partly resolved. G-Q3 and G-Q4 are open (section 2.1).
- Git: deny rules or a hook for state-changing git commands are recommended. The user edits `.claude/settings.json`, not an agent.
- New PROPOSED tasks R27, R28 and R29 (Group H) are waiting for the user's approval. R28 is blocked (see its risks).
