---
status: approved   # Written 2026-11-12 by the planner, updated 2026-11-13 for ADR-037 Amendments 1-2. Approved by the user 2026-11-13 (stated in chat; recorded at the user's request). Gated tasks (CR-dependent, real export, WEO, ADR-032, user reviews) stay gated. Decisions on the open questions are recorded in docs/plans/dashboard-v2-analytical-decisions.md.
inputs:
  - CLAUDE.md
  - docs/design/adr/ADR-037-dashboard-v2-analytical-redesign-country-and-compare-modes.md   # incl. Amendment 1 (A1.x) and Amendment 2 (A2.x), approved by the user 2026-11-13
  - docs/specs/dashboard-v2-analytical-spec.md   # incl. section 12 (Amendment 1) and section 13 (Amendment 2), approved by the user 2026-11-13
  - docs/design/adr/ADR-001-pipeline-orchestration-github-actions.md   # deploy layout only (V42)
  - docs/design/adr/ADR-010-interactive-dashboard.md
  - docs/design/adr/ADR-023-dashboard-toolkit-observable-framework.md
  - docs/design/adr/ADR-024-observable-framework-as-site-build-tool.md
  - docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md
  - docs/design/adr/ADR-026-percentile-orientation-legend-and-dashboard-display-rules.md
  - docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md
  - docs/design/adr/ADR-034-analytics-dashboard-layout-filter-bar-and-cards.md
  - docs/design/adr/ADR-036-hidden-rows-disclosure.md   # incl. Amendment 1 (2026-11-13)
  - docs/design/adr/ADR-032-dashboard-display-of-official-imf-weo-projections.md   # status proposed; read only to mark what is deferred; nothing depends on it
  - docs/specs/dashboard-export-spec.md
  - docs/plans/dashboard-redesign-implementation-plan.md   # style and task-ID reference only; not edited
---
# Dashboard v2 analytical implementation plan (ADR-037, dashboard-v2-analytical-spec)

Written 2026-11-12 by the planner; updated 2026-11-13 for Amendment 1 (A1.1 to A1.8, spec section 12) and Amendment 2 (A2.1 to A2.5, spec section 13), ADR-036 Amendment 1, all approved by the user 2026-11-13. Task IDs are V1 onward (the redesign plan used R1-R29). Existing IDs V1..V41 are kept; changed tasks are edited in place and say so; new tasks are V42 onward. Source of truth: ADR-037 and `docs/specs/dashboard-v2-analytical-spec.md`. This plan decides no design question; contradictions and gaps are in section 3 and are not worked around.

Change log of this update: OQ-1 to OQ-11 and OQ-13 resolved (section 3); C6 projection ranking renamed C7 (V41); V10 dropped; V2, V3, V4, V6, V8, V9, V12, V13, V14, V17, V18, V20, V21, V22, V23, V34, V35 edited; new tasks V42-V65 (Groups J-N) and the AC mapping extended (AC-V2-84..93, 100..131).

## 1. Scope, phasing and conventions

- Phasing follows spec section 10 and ADR-037 decision 9, and splits each phase by what the export contract allows:
  - Phase 1 (Groups A-F, plus J-N added by Amendment 2): everything YES or PARTIAL on today's export (`site/src/data` fixture contract; no export change, no WEO, no ADR-032). This ships first. Per the user's answer Q4 a release to readers waits for phase 2; phase 1 is merged and reviewed, not deployed (V42 changes the deploy layout but no task dispatches a workflow or pushes).
  - Phase 2 (Groups G, H): gated. G = work that needs only the WEO data being in the export (user-requested ingestion, ING-WEO, an ingestion step; nothing in the site changes shape). H = one task per export change request (CR-16, 17, 18, 19, 20); each is NOT started until the user approves that CR and the architect amends the export spec. Note the name clash: spec 13 A2.1 also calls the optional export-side Ukrainian names alternative "CR-22"; this plan refers to it as "CR-23 (uk names)" (V48) and to the WEO ingestion as "WEO ingestion" to keep them apart (reported as OQ-18).
  - Phase 3 (Group I): deferred placeholders for the ADR-032 projection layer and C7 (formerly C6, projection ranking). No task depends on ADR-032 and no phase 1 or 2 task reads `projection/*`.
- Write locations for phase 4: `site/` (src, scripts, tests, fixtures) and `docs/ops/` (measurement, validation and review-sheet records). V42 additionally touches `.github/workflows/` (and `scripts/ci/` only if a wrapper there already builds the site) for the two-tree deploy layout (ADR-001/ADR-010 workflow layout; no ADR is edited); that task needs the user's scope approval, is actionlint-checked, and never dispatches or pushes. Tasks in Group H that need export (`src/`, `tests/`, `config/`) work are marked EXPORT-SIDE and need their own plan and the user's scope approval (the redesign plan R28 precedent). No task edits `docs/design/`, `docs/specs/`, an ADR, or `CLAUDE.md`.
- No new npm dependency (AC-RD-52, ADR-023/024): Plot 0.6.18, d3 7.9.2 (d3-geo 3.1.2 inside it), Framework 1.13.4 only; no topojson or shapefile library. No Node/browser compute of rank, percentile, mean, median, quantile, regression, resampling, unit conversion, difference or growth (spec 1.1). Allowed: select, filter, sort by stored field, clip x-domain, join on identical keys, format (including `Intl`), and the one stored-row tally `countHiddenRowsByReason` (ADR-036 Amendment 1; ADR-037 A1.4). The display-only rebase to 100 stays in the code but its control is absent until `scale_hint = index` is exported (CR-18, A1.5).
- Model split (CLAUDE.md): every task is implemented by `data-engineer` with `model: sonnet`. Every group ends with a Review gate: a separate read-only subagent with `model: opus` checks the group against ADR-037 (incl. amendments), the spec (incl. sections 12 and 13), ADR-010/023/024/025/026/030/034/036 and this plan. The orchestrator then re-runs the commands of section 6 itself (ruff, mypy and the unit tests wherever Python is touched, and the site checks always) and does not trust the subagent's report. A task is not reported done before its group's gate has run.
- Sizes: S under 2 h, M under half a day. Larger work is split before starting.
- Task fields: Goal, Files (under `site/` unless stated), AC-V2 (and AC-RD where relevant), Verify, Depends, Risks. "Unit" = `node:test` in `site/tests`; "Smoke" = Playwright harness in `site/tests/smoke`.
- AC mapping caveat: the spec defines AC-V2-10..131 (with gaps); checks that this plan derives itself (a11y of each chart, no-JS, mode switch) are labelled "PLAN" and listed in section 5.
- New strings are DRAFT in `site/src/lib/copy.js` (ADR-025 decision 11), from V44 on in the dictionaries read by `copy.js`, with the AC-RD-55 unit test; the user confirms wording. "n/a" must never appear alone (AC-V2-83).
- Light theme only (A2.5): new components use tokens only; the existing dark block of `site/src/style.css` is neither removed nor extended (V62).

## 2. Gates carried (the user resolves; this plan decides none)

| ID | Item | Blocks |
|---|---|---|
| G-APPROVE | The user approves this plan (`status: approved`). | All of Group A onward |
| G-BLK-STALE | RESOLVED 2026-11-13 (A1.1): C4 hides stale rows by default, toggle `stl`. | nothing |
| G-BLK-COMBO | RESOLVED 2026-11-13 (A1.2): native `<select>`, combobox dropped. | nothing (V10 dropped) |
| G-BLK-HASH | RESOLVED 2026-11-13 (A1.3): `m` and `proj` removed, `p` is one period. | nothing |
| G-BLK-HIDDEN | RESOLVED 2026-11-13 (A1.4, ADR-036 Amendment 1): `countHiddenRowsByReason`. | nothing |
| G-REAL | No real 45-entity export exists locally (redesign plan R24 not done). | Real-export part of AC-V2-40/AC-RD-53/AC-V2-124; V30 |
| G-WEO | WEO ingestion and the six-variable mapping are separate steps the user requests explicitly; neither is a site task. | Group G |
| G-CR16..CR20 | Export CRs not approved; each needs user approval then an export-spec amendment. | V32-V36 respectively |
| G-CR5-CR6 | CR-5 and CR-6 are NOT approved (raised is not approved); each needs the user's separate approval; CR-5 recommended first. | V35 (CR-19 = CR-5 names); V61 (CR-6 part) |
| G-CR11 | CR-11 (stored previous observation/delta) is not approved. | V61 (with G-CR5-CR6 as the alternative) |
| G-CR23 | "CR-23 (uk names)": optional export-side Ukrainian name fields; NOT approved; not needed to ship. | V48 only |
| G-LANG-STR | Ukrainian strings, quarter-label forms (proposed en "Q1 2024", uk "1 кв. 2024"), the Ukrainian judgement-word list and every Ukrainian name need the user's confirmation; only the user or a reviewer the user names sets `reviewed`; agents never do. | Release; V44, V47 acceptance of any `reviewed` flag |
| G-HOME-CONST | Home constants (default indicator A05, KPI entity `EA`, KPI id list M09, M10, M11, P01, A01, M18, highlighted DEU, FRA, ITA, ESP, POL) are DRAFT; the user confirms. | Release; V56 |
| G-GEO-FILE | The actual Natural Earth Ukraine-POV file must be obtained (download only on the user's request, or the user places it) and opened. | V50 onward. RESOLVED 2026-11-13: file downloaded (sha256 6fcdaed26c8d551018fbd3b97185df863a4f15f489e602fceae1dee90d6a5ae8) to data/geo/naturalearth_10m_admin_0_countries_ukr/ (not git-ignored: move or ignore before any commit); preliminary Crimea point check passed (Simferopol, Kerch, Yalta, Bakhchysarai in UKR); user inspection (G-CRIMEA) is still required. |
| G-CRIMEA | Crimea is Ukraine is a hard requirement: AC-V2-119 test, plus the user inspects the prepared asset and `crimea_checked_by_user` (date) is recorded in `geo-source.json`. If the `ukr` variant does not draw Crimea as Ukraine, patching is the user's decision. | V52 acceptance; release |
| G-DEPLOY | Two-tree deploy workflow change (ADR-001/ADR-010 layout) needs the user's scope approval; no dispatch or push without an explicit request. | V42 workflow part |
| G-STR | New DRAFT strings need user confirmation before release. | Release only |
| G-032 | ADR-032 is `proposed`; licence text check by the user (Q8). | Group I only; nothing else may depend on it |

## 3. Open questions and blockers (design gaps found while planning; not resolved here)

Resolved by the user's approval of the amendments on 2026-11-13 (kept as lines so the IDs stay stable; each is closed and no longer blocks):

- OQ-1 RESOLVED (A1.1, spec 12 A1.1, AC-V2-84..86): C4 hides stale rows by default; toggle "Show stale rows" (`stl`, default 0) draws them with a dashed outline around the row's cells and the text code "stale" after the label; the hatch stays reserved for blank cells; L1, L2, C1 draw stale series with a square last-point marker and "stale" in the tip. `oth` does not apply to C4. Remaining unverified: that a scorecard row exists for every (entity, indicator) in C4; where it does not, the row is drawn (V21 test records this).
- OQ-2 RESOLVED (A1.2): native `<select>` with two `<optgroup>`s; no ARIA combobox, no datalist for the entity picker. V10 is dropped (nothing to build).
- OQ-3 RESOLVED (A1.3): `m` and `proj` are removed (mode comes from the route; nothing parses or writes `proj`); `p` is one reference period (`YYYY`, `YYYY-Qn`, `YYYY-MM`), not a range, not an alias of `from`/`to`; invalid or not in the stored common periods means absent. Keys added: `x, y, p, pc, ctx, oth, stl, rb`, appended in that order. Unverified: the order against the real `hash.js` (V2 reads the file).
- OQ-4 RESOLVED (A1.4, ADR-036 Amendment 1): single whitelisted count `countHiddenRowsByReason(hidden)` in `site/src/lib/filter-model.js`, output `{ total, no_data, stale, other_period, other }`; one selection function `splitByCoverage(rows, context)` per chart returns `{ drawn, hidden }`; summary template "{N} rows hidden: {X} no data, {Y} stale, {Z} other period" with ", {W} other" only when W > 0 and zero parts omitted; list body label, reason category, stored period or "not stated", stored reason sentence. Wording stays DRAFT for the user.
- OQ-5 RESOLVED (A1.5): no inference from `unit_label` or `unit_text` text; no interim marker; rebase is OFF until `scale_hint = index` (CR-18) is exported; units that differ use small multiples with independent scales.
- OQ-6 RESOLVED (A1.6): compared fields are `unit_code`, `unit_mult`, `price_basis`, `flow_basis` (when present), `base_period` (index series); `currency_basis` is indicator-level only and not compared at series level; a field absent from every series of a selection is skipped and reported; present for some and absent for others blocks the combination. `flow_basis` may be absent in a real export [UNVERIFIED].
- OQ-7 RESOLVED as to names (A1.6): CR-19 equals CR-5 (series `unit_text`, `unit_scale`; indicator `unit_text`, `unit_text_varies`; `unit_label` unchanged). Status: CR-5 and CR-6 are NOT approved; CR-5 recommended first. V35 stays gated on that approval.
- OQ-8 RESOLVED (A2.3): Home is a dense overview, see Group L. The old Home sentence of A1.7 is history.
- OQ-9 RESOLVED (A1.7): "Country" with no entity chosen opens a static country list page `/country` (AC-V2-92); built in V64.
- OQ-10 RESOLVED (A1.7, AC-V2-51 amended): C5 renders on no page unless `pc=1`, `domain/<id>` included; not a Home panel; it is a secondary block (placed after the primary charts, collapsed).
- OQ-11 RESOLVED (A1.7): AC-V2-40 (first interaction at most 5 MB gzipped) is measured on both the Country page and the Compare page, and (A2.3) Home after settle; the interaction measured per page is recorded by the measurement task. AC-RD-53 landing limits apply to Home and Country landing; PG-COMPARE landing is measured and recorded (no new limit).
- OQ-13 RESOLVED (A1.7, AC-V2-93): P1a jitter slot by `entity_id` ascending code-point order, fixed, never by value, never random.

Still open or new:

- OQ-12 K1 sparkline source in phase 1 (unchanged). Spec K1 allows a Parquet sparkline per domain (up to 14 files for `agri`) or none. Plan default: V11 builds the card without sparkline; V11b adds the Parquet sparkline only if V27 weight allows. Home KPI cards have no sparkline (A2.3).
- OQ-14 Peer groups (unchanged). G20 and EU27 presence in the real `meta/groups.json` is [UNVERIFIED]; affects P1b only (V33).
- OQ-15 Plot marks in 0.6.18 (unchanged). `cell`, `areaY`, `tip`, `pointer`, `selectLast`, `facet`, and now `Plot.geo` with a hatch pattern fill, are UNVERIFIED; V1 is the smoke probe (extended to `geo` and pattern fills). Whether the point reader is needed for the new charts is not stated (PLAN check only).
- OQ-16 Header test. AC-RD-01 and G-STR4 (header navigation exactly four pages) already differ from spec section 2 (Home, Country, Compare, Time series, Domains, Revisions); the language switch sits outside the `nav` landmark to avoid a fifth entry (A2.6 item 2). The plan updates the test to the spec (V8, V46), not around it; the architect/user should confirm the intended nav set.
- OQ-17 Shapefile conversion without a dependency. Natural Earth ships a shapefile only; the conversion to GeoJSON is a `site/scripts/` build step with no new npm dependency (A2.2, AC-V2-112). Whether a self-written `.shp`/`.dbf` reader in the script (or a one-off local conversion with an existing system tool, then committing only the GeoJSON asset and `geo-source.json`) is acceptable is a design/scope matter; V50 stops and reports if neither works without a dependency.
- OQ-18 Naming clash "CR-22". Spec 8 table lists CR-22 as WEO data ingestion; A2.1 reuses "CR-22" for optional export-side Ukrainian names. The planner distinguishes them as above; the architect should rename one.
- OQ-19 Weight of the map and the second tree. Geometry budget 100 KB gzipped is "proposed" and [UNVERIFIED] reachable at 1:50m (fallback 1:110m or GISCO 20M with markers); doubled `dist` size on Pages and the per-language build time are [UNVERIFIED] until measured (V60, V65).
- OQ-20 Alternate-language `<link rel="alternate" hreflang>` in `head` only "if Framework allows" [UNVERIFIED]; V46 reports what Framework 1.13.4 allows; the header link carries `hreflang` regardless.
- OQ-21 Country names via `Intl.DisplayNames`: ICU data of the pinned Node 20 build and the ISO3-to-ISO2 join are [UNVERIFIED] (V47 reports; entries are `proposed` either way).
- Not resolved by the amendments and still the user's: Ukrainian strings, quarter label forms, Home constants (G-LANG-STR, G-HOME-CONST); CR-11, CR-19 (via CR-5/CR-6) and CR-23 (uk names) not approved; real export unavailable (G-REAL); the K1 neutral delta stays absent until CR-6 or CR-11 is approved and exported (V61).

## 4. Task list

### Group A - Foundations (phase 1)

### V1: Plot mark smoke probe on 0.6.18 (S)  [x] done
- Goal: render on the fixture each mark the spec relies on (`lineY`, `areaY`, `barX`, `dot`, `text`, `cell`, `ruleX/ruleY`, `selectLast`, facets, `legend`) and, added 2026-11-13, `Plot.geo` with a geographic projection and an SVG hatch pattern fill (needed by C6) and `Intl.PluralRules("uk")` / `Intl.DisplayNames` availability on the pinned Node; record which work in Chromium; label verified or unverified. Settle OQ-15 for marks other than the tip (already settled by R15).
- Files: throwaway probe in the scratchpad; findings recorded in `docs/ops/dashboard-v2-decisions.md` (new).
- AC-V2: precondition for 14, 21, 46, 110, 111, 113.
- Verify: written findings; nothing in `site/src` changes.
- Depends on: G-APPROVE.
- Risks: a missing mark means a d3 replacement; stop and report if one needs a design decision.

### V2: Hash extension: `x`, `y`, `p`, `pc`, `ctx`, `oth`, `stl`, `rb`  [x] done   (edited 2026-11-13: A1.3)
- Goal: extend `site/src/lib/hash.js` parse/serialize with the keys `x, y, p, pc, ctx, oth, stl, rb`, appended in that order to the existing serialization order (read the file first and report any mismatch with the order assumed in A1.3); `p` accepts exactly `YYYY`, `YYYY-Qn` (n 1..4), `YYYY-MM`, one period, not a range, not an alias of `from`/`to`; a `p` that does not match, or is not in the stored common periods, is absent; unknown or invalid values fall back to defaults with `note` true; all-default state serializes to an empty hash; `m` and `proj` in a hash are ignored (not parsed, not written).
- Files: `site/src/lib/hash.js`, `site/src/lib/carry.js` (carry the new keys where meaningful), `site/tests/hash.test.mjs`, `site/tests/hash-baseline.test.mjs` (must still pass unchanged), `site/tests/carry.test.mjs`.
- AC-V2: 87; supports 37, 51, 85.
- Verify: `npm test`; round-trip test (every valid key parses and serializes unchanged); `m=compare` and `proj=1` ignored.
- Depends on: G-APPROVE.
- Risks: breaking existing pages that read `from`/`to` (hash-baseline test guards it).

### V3: Compatibility and basis module (S)  [x] done   (edited 2026-11-13: A1.6)
- Goal: pure function `checkCompatible(seriesList)` returning allowed/blocked/marked with stored-field reason: blocked on differing `unit_code`, `unit_mult`, `price_basis`, `flow_basis` (when present), `base_period` (index series); blocked on differing frequency; marked (not blocked) on mixed `seasonal_adjustment` (SA/NSA). `currency_basis` is not compared at series level. A field absent from every series of the selection is skipped and listed in the result; a field present for some and absent for others blocks. Never parses `unit_label` or `unit_text`.
- Files: `site/src/lib/compat.js` (new), `site/tests/compat.test.mjs`, a fixture extension in V7.
- AC-V2: 31, 41 (block part), 71, 76, 91 (no text parsing).
- Verify: `npm test`; fixture series with two unit codes block; SA/NSA mix marks; absent-for-some blocks; absent-for-all skipped and reported.
- Depends on: G-APPROVE (V7 for fixture data).
- Risks: no unit conversion is ever offered; the "single-basis subset" offer is selection only.

### V4: Hidden-rows model by reason (M)  [x] done   (edited 2026-11-13: A1.4, ADR-036 Amendment 1; gate removed)
- Goal: in `site/src/lib/filter-model.js`: `splitByCoverage(rows, context)` returning `{ drawn, hidden }` (building on `splitByPeriod`) and `countHiddenRowsByReason(hidden)` returning `{ total, no_data, stale, other_period, other }`, replacing `countPeriodHiddenRows` as the single whitelisted count. Each hidden row is in exactly one category by precedence `no_data`, `stale`, `other_period`, `other`; list ordered by that precedence then label A-Z; list body per row: label, reason category label, stored reference period of the row's latest value (or the stored "not stated" marker), and the stored reason sentence; the counts are computed from the same array that renders the list; nothing rendered at N = 0 (ADR-036 I7); `<details class="mm-hidden-rows">` inside a `role="status"` wrapper; summary template DRAFT in copy as given in A1.4 (zero parts omitted, `, {W} other` only when W > 0, singular "1 row hidden: 1 no data"; plural-category variants per language arrive in V45). Table alternatives still show every row (7.3).
- Files: `site/src/lib/filter-model.js`, `site/src/lib/hidden-rows.js` (new, rendering of the list only), `site/src/lib/copy.js`, `site/tests/filter-model.test.mjs`, `site/tests/hidden-rows.test.mjs`, `site/tests/ux-static.test.mjs` and `site/tests/prose-scan.test.mjs` (whitelist updated to the single name `countHiddenRowsByReason`; seeded negative `.length` of a filtered list in a view module still fails), `site/tests/copy.test.mjs`.
- AC-V2: 80 (amended), 81, 82 (amended, L1/L2/C1 never hide stale), 83, 88, 89, 90; ADR-036 I1..I7.
- Verify: `npm test`; property test (N equals list length and X + Y + Z + W = N for generated inputs); copy test for 0, 1 and mixed counts; no other count in browser code (scan).
- Depends on: V7.
- Risks: the D6 scan whitelist is by function name; the widening must not add a second counter. Existing `countPeriodHiddenRows` callers and tests are migrated, not duplicated.

### V5: Caption block module (S)  [x] done
- Goal: pure builder of the caption block from stored fields only: indicator name, unit text, frequency name, seasonal adjustment (SA/NSA/not applicable as stored), reference period or range, source names, "latest vintage as of <known_cutoff>"; stored "not stated" marker when a field is absent; EST/PROV legend codes. No prose beyond the closed allow-list.
- Files: `site/src/lib/caption.js` (new), `site/src/lib/units.js` (reuse), `site/tests/caption.test.mjs`, `site/tests/prose-scan.test.mjs`.
- AC-V2: 70, 72 (title uses `unit_label` verbatim), 75 (period label per frequency), 77, 79.
- Verify: `npm test`; every field present or the "not stated" marker.
- Depends on: G-APPROVE.
- Risks: unit text relies on `unit_label` until CR-19/CR-5; titles show it verbatim (spec 6.3), never parsed.

### V6: Copy strings and static-scan extension (S)  [x] done   (edited 2026-11-13)
- Goal: add the v2 strings as DRAFT constants (hidden-rows summary template and list labels per V4, "No aligned values for this selection", blocked messages, empty-card text, mode switch labels, picker labels, "Show percentile", "Show stale rows" (C4, `stl`), "Include rows from other reference periods", context-lines, "stale" text code, rebase statement "Index, <period> = 100, rebased for display; stored values unchanged." (kept for when CR-18 exists)); extend the AC-RD-50 scan with the new chart modules (no `d3.mean|median|quantile|sum|regress|correlat`, no `Math` compute of rank/percent), add the "no `projection/` read outside L2/C1 modules" scan (vacuous in phase 1; fails if any module reads `projection/`), add a scan that no chart or compatibility module tests `unit_label` or `unit_text` by regex or substring (AC-V2-91), a scan that the hatch pattern is not used for stale (A1.1), and seeded negatives.
- Files: `site/src/lib/copy.js`, `site/tests/copy.test.mjs`, `site/tests/prose-scan.test.mjs`, `site/tests/ux-static.test.mjs`, `site/tests/ux-style-scan.test.mjs`.
- AC-V2: 44, 50 (scan), 83, 90, 91; AC-RD-50, 55, 62.
- Verify: `npm test`; `npm run check:imports`; seeded negatives fail.
- Depends on: V4, G-APPROVE.
- Risks: the working tree shows uncommitted edits to `site/tests/ux-style-scan.test.mjs`; the implementer rebases on them, not over them.

### V7: v2 fixture extension (M)  [x] done
- Goal: extend the fixture(s) under `site/tests/fixtures/` (not `site/src/data` unless that is how the synthetic export is produced; the implementer reports where) with: two series of one indicator with different `unit_code`; SA and NSA mix; two monthly indicators with overlapping countries (C3 pair), one annual pair, one frequency mismatch pair; an index series with `base_period`; a series with `flow_basis` absent for some series; EST/PROV rows; MISS gaps; stale and unaligned scorecard rows (C4 `stl` cases); an indicator with more than one frequency; a series with a stored `value_yoy` (used only by V61 when ungated). The sparse fixture `site/tests/fixtures/sparse_export` stays valid for existing tests.
- Files: `site/tests/fixtures/**`, `site/tests/fixtures.test.mjs`.
- AC-V2: enables 12, 17, 31, 41, 42, 73, 81, 84, 85.
- Verify: `npm test`; fixtures remain labelled synthetic (never described as a measurement).
- Depends on: G-APPROVE.
- Risks: a fixture shape that differs from the real export (the real export is not available, G-REAL).

**Review gate A** (Opus, read-only): V1-V7 against spec 1.1, 1.4 (as replaced by A1.3), 6, 7 (as amended by A1.4) and ADR-036 Amendment 1 invariants; no change to `src/`, `docs/design/`, `docs/specs/`; no new dependency; the only browser-side count is `countHiddenRowsByReason`. Orchestrator re-runs section 6.

### Group B - Shell, modes, picker (phase 1)

### V8: Mode switch, navigation and PG-COMPARE page generation (M)  [x] done   (edited 2026-11-13: A1.3, A1.7)
- Goal: header Home, Country, Compare, Time series, Domains, Revisions; "Country" targets the static country list page `/country` (V64); mode switch (two tabs, `aria-current`) at the top of the filter bar, mode taken from the route (no `m` key), keeping `c`, `i`, `g`, `p` where meaningful; page `compare` generated (template or static) and `indicator/<id>` marked as Compare with the indicator fixed; `/country/<id>` as Country mode. Static fallback links remain in built HTML. The AC-RD-01 header test is updated to the spec's nav set (OQ-16).
- Files: `site/observablehq.config.js`, `site/src/compare.md`, `site/src/lib/mode-switch.js`, `site/src/lib/shell.js`, `site/src/country/[entity].md`, `site/src/indicator/[indicator].md`, `site/tests/mode-switch.test.mjs`, `site/tests/build-pages.test.mjs`, `site/tests/smoke/home.smoke.mjs`.
- AC-V2: PLAN (modes, spec 2), supports 61, 92.
- Verify: `npm test`; `npm run build` page set includes `compare` and `country`; no orphan page (AC-RD-02); no-JS: switch targets are real links.
- Depends on: V2, V64.
- Risks: OQ-16; breaking AC-RD-01/02 page set tests (update them to the new set, not around it).

### V9: Country picker, native select with optgroups (M)  [x] done   (edited 2026-11-13: A1.2)
- Goal: native `<select>` with `<optgroup label="Countries">` and `<optgroup label="Aggregates">` over `meta/entities.json`, plus a native Group `<select>` over `meta/groups.json`; selection writes `c` and, on a Country page, navigates to `/country/<entity_id>`; no hand-built ARIA combobox, no `aria-activedescendant`, no datalist; no request beyond `meta/entities.json` and `meta/groups.json`; static country link list stays in built HTML.
- Files: `site/src/lib/picker.js`, `site/src/lib/filter-country.js` (reuse), `site/tests/picker.test.mjs`, `site/tests/smoke/picker.smoke.mjs`, `site/tests/smoke/requests.smoke.mjs`.
- AC-V2: 60 (amended: native behaviour, keyboard only), 61, 62.
- Verify: `npm test`; `npm run smoke`; request list asserted; no-JS build contains the country links; static scan finds no combobox role.
- Depends on: V8.
- Risks: native select type-ahead with Ukrainian labels is manual (section 7).

### V10: DROPPED (A1.2)  [x] dropped, nothing to build
- Goal: the ARIA combobox is not built; the user decided on 2026-11-13 to use the native select (V9). The ID is kept so reviewers can diff; no gate, no dependency on it remains.
- Files: none. AC-V2: none. Verify: not applicable. Depends on: none. Risks: none.

**Review gate B** (Opus, read-only): V8, V9, V64 against spec 2, 5.1 (as replaced by A1.2), A1.7, ADR-037 decision 1, ADR-025 (no JS notice).

### Group C - Country mode (phase 1, today's export)

### V11: K1 latest-value cards (M)  [ ] todo
- Goal: per-domain band of cards from `scorecard/<domain>.json`: indicator name, value + unit, reference period, source, stale marker, EST/PROV hollow marker; indicators without a value go to the card's hidden-rows disclosure (V4); no delta, arrow or direction colour (the neutral delta is V61, gated); the card may print stored `value_yoy` labelled as stored only if the field is present. No sparkline in this task (OQ-12).
- Files: `site/src/lib/kpi-view.js` (reuse/extend), `site/src/lib/country-model.js`, `site/tests/kpi-card.test.mjs`, `site/tests/smoke/kpi.smoke.mjs`.
- AC-V2: 10, 11 (amended: no delta without a stored delta; fixture has no delta element, AC-V2-125 absence part is covered here and re-asserted in V61), 12, 13.
- Verify: `npm test`; `npm run smoke` (card count equals indicators with a value; the rest in the disclosure).
- Depends on: V4, V5, V7.
- Risks: staleness is a marker, not a hide reason in K1 per spec but K1 stale is hidden by default in A1.4 category terms where "staleness hides (K1)"; the implementer applies A1.4/A1.1 exactly as written ("C2, C3, P1 strip, K1" hide stale; `oth=1` includes other periods) and reports any contradiction with spec K1 text instead of choosing (see OQ list: reported in V11 notes if found).

### V11b: K1 Parquet sparkline (M)  [ ] todo (conditional on V27 weight result)
- Goal: d3 `line` in inline SVG (no Plot instance per card) from the last stored values of `series/<indicator>.parquet`, loaded on demand per domain; accessible name (unit, first and last stored value and period); y-range per card; latest point hollow when EST/PROV. Not used on Home KPI strip (A2.3).
- Files: `site/src/lib/sparkline.js`, `site/src/lib/kpi-view.js`, `site/tests/sparkline.test.mjs`.
- AC-V2: 10, 12, 40 (weight).
- Verify: `npm test`; `npm run measure:pages` shows the interaction at most 5 MB gz; otherwise stop and report (CR-16/CR-20 route belongs to the user).
- Depends on: V11, V27.
- Risks: up to 14 files for `agri`; the Parquet reader loads only on first activation.

### V12: L1 domain small multiples of lines (M)  [ ] todo   (edited 2026-11-13: stale marker, gate removed)
- Goal: one card per domain (first two expanded), facets in `meta/domains.json` `indicator_ids` order, at most 12 then "Show more"; each facet its own y axis in its own unit and its own caption; shared x domain (Period control `from`/`to`); gaps not bridged; EST/PROV hollow; a stale series is drawn with all stored points and a square marker on its last point, the tip printing "stale" and the stored period; zero rule only when crossed; table alternative; facets with no stored value go to the disclosure.
- Files: `site/src/lib/small-multiples.js` (reuse/extend), `site/src/lib/country-page.js`, `site/tests/l1-facets.test.mjs`, `site/tests/smoke/l1.smoke.mjs`.
- AC-V2: 14, 15, 16, 17, 18, 72, 75, 82, 86.
- Verify: `npm test`; `npm run smoke` (axis titles carry the unit; table lists the same rows; square marker on a stale fixture series); scan clean.
- Depends on: V1, V4, V5, V7.
- Risks: loads one Parquet per indicator (V27); several frequencies per indicator yield one facet per frequency.

### V13: L2 single-indicator country line, rebase control absent (M)  [ ] todo   (edited 2026-11-13: A1.5)
- Goal: long line for one indicator and country (expanded facet and PG-SERIES reuse): solid OBS, hollow EST/PROV, square last-point marker and "stale" in the tip for a stale series, zero rule when crossed, revisions link. Levels in native units. The display-only rebase (existing `rebase.js`, with the statement) stays in code but its control is rendered only when stored metadata holds `scale_hint = index`; today's export has no such field, so the control is absent for every series, including series with a non-null `base_period` and series whose `unit_label` reads "index". Selections whose units differ use small multiples, never dual axes. The projection layer control is absent.
- Files: `site/src/lib/series-chart.js`, `site/src/lib/rebase.js`, `site/tests/l2.test.mjs`, `site/tests/rebase.test.mjs`, `site/tests/smoke/series.smoke.mjs`.
- AC-V2: 19 (the absent-control part), 20, 73 (amended), 74, 86, 91; AC-RD-30..34 still hold (those that assume an active rebase are adjusted to the gate, not weakened elsewhere).
- Verify: `npm test` (unit test that rebase and projection controls are absent on the fixture index series; a test with a synthetic `scale_hint = index` shows the control and the statement); `npm run smoke`.
- Depends on: V5, V7.
- Risks: existing redesign tests (R-series) that expect rebase on index series must be reconciled with A1.5; if they contradict, report them rather than weakening.

### V14: P1a strip plot (M)  [ ] todo   (edited 2026-11-13: A1.7)
- Goal: all countries' stored latest values for one indicator on one axis, the chosen country highlighted, aggregates as reference ticks; only rows aligned to the printed reference period are drawn, others in the disclosure unless `oth=1`; no median/quartile; vertical slot by `entity_id` ascending code-point order, fixed, never by value, never random; table alternative.
- Files: `site/src/lib/peer-strip.js`, `site/src/lib/country-page.js`, `site/tests/peer-strip.test.mjs`, `site/tests/smoke/peer-strip.smoke.mjs`.
- AC-V2: 21, 80, 81, 93; PLAN: the printed reference period.
- Verify: `npm test` (two renders give the same y positions; reordering stored values does not change them); `npm run smoke`; scan clean.
- Depends on: V4, V5, V7.
- Risks: on the Eurostat-only export only a few countries appear (coverage, not a defect).

### V15: T1 latest-values table and percentile layer (M)  [ ] todo
- Goal: indicator table by domain (value + unit, period, state sentence, source); percentile column and bin chip only with `pc=1`; the ADR-026 orientation sentence is present if and only if the layer is visible; the "Show percentile" control writes `pc`.
- Files: `site/src/lib/table-card.js`, `site/src/lib/country-view.js`, `site/src/lib/legend.js`, `site/tests/table-card.test.mjs`, `site/tests/smoke/country.smoke.mjs`.
- AC-V2: 25, 26; ADR-037 decision 3.
- Verify: `npm test`; `npm run smoke` (absent by default, present with `pc=1`).
- Depends on: V2, V6.
- Risks: orientation sentence is a confirmed string; reuse verbatim.

### V16: Country page assembly and Country-mode checks (M)  [ ] todo
- Goal: compose K1, L1, L2, P1a, T1 on `/country/<id>`; controls shown only where they act (spec 5.3); static no-JS link lists and notice retained.
- Files: `site/src/country/[entity].md`, `site/src/lib/country-page.js`, `site/tests/smoke/country.smoke.mjs`, `site/tests/build-pages.test.mjs`.
- AC-V2: 40 (fixture), 61; AC-RD-01/02/05/53.
- Verify: `npm test`; `npm run build`; `npm run smoke`; JS-off built HTML has the links and notice.
- Depends on: V11-V15.
- Risks: PG-COUNTRY already reads every scorecard (CR-4 route is the user's call if V27 shows excess).

**Review gate C** (Opus, read-only): V11-V16 against spec 3, 5.3, 6, 7 (as amended) and ADR-037 decisions 2-5 and A1.1, A1.5; confirms no delta/arrow, no computed statistic, one unit per panel, projection and rebase controls absent, stale square marker; orchestrator re-runs section 6.

### Group D - Compare mode (phase 1, today's export)

### D-intro
All Group D tasks apply spec 6.2/6.3 as amended by A1.5, A1.6: an incompatible selection is blocked (V3) with the stored-field message; no resampling.

### V17: Compare controls and state (S)  [x] implemented (unit tests; smoke and build not run, gate D open)   (edited 2026-11-13)
- Goal: Indicator native select with domain optgroups and `unit_label` in option text; Direction/Domain; Countries chip (up to 5 highlighted); Group; Period (`from`/`to`; `p` where a single period is needed); Frequency limited to `frequency_set`; Show percentile; Include other reference periods (not on C4); Show stale rows (C4 only, `stl`); Context lines. Each chart shows only the controls that act on it (spec 5.3 as amended). No projection control and no `m`/`proj` keys.
- Files: `site/src/lib/compare-controls.js`, `site/src/lib/filter-model.js`, `site/tests/compare-controls.test.mjs`.
- AC-V2: PLAN (spec 5.2/5.3), 37 (control only), 85 (control).
- Verify: `npm test`; applicability matrix as a table test.
- Depends on: V2, V8, V9.
- Risks: controls leaking between pages.

### V18: C1 multi-country line (M)  [x] implemented (unit tests; smoke and build not run, gate D open)   (edited 2026-11-13)
- Goal: up to 5 coloured, directly labelled lines (`selectLast`), optional grey context lines (`ctx=1`, default off), aggregates dashed grey, one y axis, zero rule when crossed; blocked on incompatible unit/basis with the stored-field message; SA/NSA marked in tip and caption; stale series drawn with a square last-point marker and "stale" in the tip; Frequency control, no resampling; no rebase control before `scale_hint = index` exists (rebase code path covered by a synthetic test only); table alternative; countries with no value in the x-domain in the disclosure; no projection.
- Files: `site/src/lib/multi-line.js`, `site/src/lib/series-card.js` (reuse), `site/tests/multi-line.test.mjs`, `site/tests/smoke/c1.smoke.mjs`.
- AC-V2: 30, 31, 32, 33, 34, 71, 73, 75, 76, 82, 86.
- Verify: `npm test`; `npm run smoke`; scan clean.
- Depends on: V1, V3, V4, V5, V7, V17.
- Risks: cap of 5 coloured lines (ADR-025 decision 6) must hold; color never the only identity channel.

### V19: C2 ranked bar of the latest aligned period (M)  [x] implemented (unit tests; smoke and build not run, gate D open)
- Goal: horizontal bars, zero baseline, neutral fill, sort by stored `value` (default) / A-Z / percentile (percentile only with `pc=1`); only rows aligned to the printed `rank_reference_period` drawn; others in the disclosure or hollow with their period when `oth=1`; aggregates pinned as reference rows; no total or mean row; percentile column and bin chip only with `pc=1`; blocked on unit mismatch; empty-card message when only stale rows remain.
- Files: `site/src/lib/rank-model.js`, `site/src/lib/bar-chart.js`, `site/tests/rank-model.test.mjs`, `site/tests/smoke/rank.smoke.mjs`.
- AC-V2: 35, 36, 37, 38, 80, 81.
- Verify: `npm test`; `npm run smoke`.
- Depends on: V3, V4, V5, V15 (percentile control), V17.
- Risks: replaces the ADR-034 ranked card visually; existing rank tests are updated to the spec, not the other way.

### V20: C3 scatter of two indicators (M)  [x] implemented (unit tests; smoke and build not run, gate D open)   (edited 2026-11-13: A1.3)
- Goal: x and y selectors (`x`, `y`); join on identical (entity, period) from two series files; blocked when frequencies differ; period control writes `p` (one period: `YYYY`, `YYYY-Qn`, `YYYY-MM`) chosen from the stored common periods, invalid values fall back to the default; default period = latest with at least 5 stored points else latest common (threshold 5 per Q6); both axes titled with unit, no forced zero, zero rule when crossed; no regression, correlation, size or colour third variable; labels for highlighted countries only (cap 8); aggregates excluded by default; countries without both values in the disclosure with "no value for <indicator>"; table lists country, x, y with units and period.
- Files: `site/src/lib/scatter.js`, `site/tests/scatter.test.mjs`, `site/tests/smoke/c3.smoke.mjs`.
- AC-V2: 41, 42, 43, 44, 45, 87 (the `p` part).
- Verify: `npm test` (common-period join, frequency block, default-period rule, `p` validation); `npm run smoke`; scan finds no regression/correlation.
- Depends on: V2, V3, V4, V5, V7, V17.
- Risks: the Eurostat-only export may give few or no overlapping pairs (reported via the disclosure).

### V21: C4 heatmap country x period (M)  [x] implemented (unit tests; smoke and build not run, gate D open)   (edited 2026-11-13: A1.1; gate removed)
- Goal: rows sorted by latest stored value or A-Z; one frequency per chart; window cap (annual 35, quarterly 40, monthly 36); sequential single-hue scale for non-negative ranges, diverging with midpoint 0 when the displayed range crosses 0; domain = displayed min/max, stated in caption; blank cells hatched (never zero, never counted); text in cell when width permits; legend with min and max labels; numeric table alternative; no PROJ cell. Stale rows (stored `is_stale` for the (entity, indicator) in `scorecard/<domain>.json`; a row without a scorecard entry is not stale-flagged and is drawn) are hidden by default and listed in the disclosure with reason `stale`; with `stl=1` they are drawn with a dashed outline around the row's cells and the text code "stale" after the row label and leave the hidden array; the hatch is not used for stale; `oth` does not apply to C4.
- Files: `site/src/lib/heatmap-card.js`, `site/src/lib/heatmap-view.js` (reuse/extend, keeping the ADR-034 domain heatmap C5 separate), `site/tests/c4-heatmap.test.mjs`, `site/tests/smoke/c4.smoke.mjs`.
- AC-V2: 46, 47, 48, 49, 50, 84, 85; 82 (C4 hides only when `stl` is 0).
- Verify: `npm test` (scale-type selection, window caps, no PROJ in input, row selection with `stl` 0 and 1, hidden-array identity, row without scorecard entry drawn); `npm run smoke` (dashed outline present with `stl=1`); contrast/hatch check (AC-UX-1/4); scan: no hatch for stale.
- Depends on: V1, V4, V5, V7, V17.
- Risks: wide monthly heatmaps; colour is not the only channel for blanks or stale.

### V22: C5 and T2 gating on the percentile layer (S)  [x] implemented (unit tests; smoke and build not run, gate D open)   (edited 2026-11-13: A1.7, AC-V2-51 amended)
- Goal: keep the ADR-034 domain heatmap (C5, percentile bins) as a secondary block (after the primary charts, collapsed) that renders on no page unless `pc=1`, `domain/<id>` included; never on Home; T2 indicator table with sparkline kept, percentile column opt-in.
- Files: `site/src/lib/heatmap-card.js`, `site/src/lib/table-card.js`, `site/src/domain/*.md`, `site/tests/smoke/heatmap-card.smoke.mjs`, `site/tests/table-card.test.mjs`.
- AC-V2: 51 (amended); ADR-037 decision 3.
- Verify: `npm test`; `npm run smoke` (absent on `domain/<id>` without `pc=1`; present with it).
- Depends on: V15, V17.
- Risks: existing ADR-034 tests that expect C5 on `domain/<id>` by default are updated to the amended criterion.

### V23: PG-COMPARE / PG-INDICATOR assembly (M)  [x] implemented (unit tests; smoke and build not run, gate D open)   (edited 2026-11-13: Home moved to Group L)
- Goal: compose C1-C4 (plus C5/T2 per V22; C6 is inserted after C2 by V55) on `/compare` and `/indicator/<id>`; caption blocks, table alternatives, disclosures, no-JS notice and static link lists retained. Home is no longer handled here: the Home composition is Group L (V56-V59); this task only keeps `site/src/index.md` building while those land.
- Files: `site/src/compare.md`, `site/src/indicator/[indicator].md`, `site/src/lib/home-lists.js`, `site/tests/smoke/compare.smoke.mjs`, `site/tests/build-pages.test.mjs`.
- AC-V2: 70, 80; AC-RD-01/02/05.
- Verify: `npm test`; `npm run build`; `npm run smoke`.
- Depends on: V18-V22.
- Risks: AC-RD-01/02 page-set tests are updated to the new set.

**Review gate D** (Opus, read-only): V17-V23 against spec 4, 5, 6, 7 (as amended), ADR-037 decisions 2-5 and A1.1, A1.3, A1.4, ADR-026; confirms no regression/correlation, no rank or percentile computed in the browser, blocked states carry stored-field messages, no `n/a` alone; orchestrator re-runs section 6.

### Group E - Cross-cutting checks (phase 1)

### V24: Accessibility and no-JS sweep of the new charts (M)  [ ] todo
- Goal: every new chart has `role="img"` with generated label, a "View as table" alternative with the same rows (every row, including those in the disclosure), keyboard-reachable controls, no-JS notice and static link lists; contrast and target size for new marks (AC-UX-1/4/9); non-colour channels (hollow EST/PROV, hatch, dashed aggregates, dashed stale outline, square stale marker); print and reduced-motion preferences; PLAN: a keyboard route to point values for each chart (table, or the existing point reader, OQ-15). C6 and Home panels are covered by V54/V59 and re-run by V65.
- Files: `site/tests/smoke/ux.smoke.mjs`, `site/tests/smoke/ux-support.mjs`, `site/scripts/contrast-pairs.mjs`, `site/src/style.css`.
- AC-V2: 18, 34, 45, 60, 61; PLAN items above; AC-RD-54.
- Verify: `npm run check:contrast`; `npm run smoke`; JS-disabled Chromium context shows notice and links.
- Depends on: V16, V23.
- Risks: Chromium emulation only; screen reader, Firefox, Safari, real print and Windows high contrast are manual (section 7).

### V25: Static scans and copy test closure (S)  [ ] todo
- Goal: final pass that the scans from V6 cover every chart module added in V11-V23 (a module list test fails if a new chart file is not scanned), the prose scan covers all new strings, and the only count in browser code is `countHiddenRowsByReason`. The module list is extended by V65 for C6, Home, delta and i18n modules.
- Files: `site/tests/ux-static.test.mjs`, `site/tests/prose-scan.test.mjs`, `site/tests/copy.test.mjs`.
- AC-V2: 44, 50, 83, 90, 91; AC-RD-50, 55, 62.
- Verify: `npm test`; `npm run check:imports`; seeded negatives for each forbidden pattern.
- Depends on: V23.
- Risks: scan false positives on d3 imports that are not used for compute.

### V26: Page-set, link-integrity and request tests (S)  [ ] todo
- Goal: `dist/` page set (including `compare` and `country`) exact; every link resolves; every entity and indicator reachable from Home; per-page request list against manifest `files[]` (no file outside the export contract; no `projection/`, `peer_stats/`, `series_by_entity/` request in phase 1). Run for both language trees by V65.
- Files: `site/tests/build-pages.test.mjs`, `site/tests/smoke/requests.smoke.mjs`.
- AC-V2: 62, 92; AC-RD-01, 02, 51.
- Verify: `npm run build && npm test && npm run smoke`.
- Depends on: V23.
- Risks: build time grows with new pages (recorded in V27).

### V27: Weight, build and CLS measurement (AC-RD-53, AC-V2-40) (M)  [ ] todo
- Goal: extend `site/scripts/measure-pages.mjs` to cover PG-COMPARE and the Country-mode interactions (expand a domain, load L1, K1 sparkline if built); report gzip first-load per page type, CSS size, the heaviest interaction per page (Country and Compare, A1.7), CLS and build time on the fixture and the sparse fixture; record in `docs/ops/dashboard-v2-measurements.md` with identity of the fixture. Targets from the AC-RD-53 decisions already in use: 600 KB gz per page type (hard 1.5 MB), interaction at most 5 MB gz, CSS at most 20 KB gz, CLS at most 0.1. Record; do not tune silently. State that fixture numbers understate a real export (G-REAL); the real-export measurement remains open. Home and the map are measured by V60.
- Files: `site/scripts/measure-pages.mjs`, `site/tests/scripts.test.mjs`, `docs/ops/dashboard-v2-measurements.md`.
- AC-V2: 40 (fixture part); AC-RD-53.
- Verify: `npm run measure:landing`; `npm run measure:pages`.
- Depends on: V16, V23 (and V11b result).
- Risks: a breach triggers the user's decision on CR-20/CR-4, not a build.

### V28: Decisions and validation record (S)  [ ] todo
- Goal: write `docs/ops/dashboard-v2-decisions.md` (V1 findings, answers as the user gives them, DRAFT string list in both languages, Home constants) and a validation checklist for the user (manual): one run per journey "what does the data say about country X" and "how do countries compare on Y", on a clean browser, in both languages. Not an acceptance gate.
- Files: `docs/ops/dashboard-v2-decisions.md`, `docs/ops/dashboard-v2-validation.md`.
- AC-V2: PLAN.
- Verify: manual.
- Depends on: V24.
- Risks: depends on the user's time.

**Review gate E** (Opus, read-only): V24-V28 against AC-V2-40, 60-62, 70-83 and AC-RD-53/54/55; no extrapolated numbers; no extra dependency (`git diff` of `site/package.json`); no change outside `site/` and `docs/ops/` (V42 workflow change excepted and reviewed in gate J). Orchestrator re-runs section 6.

### Group J - Bilingual Ukrainian/English (phase 1, added 2026-11-13, A2.1; today's export, no CR)

Applies to every page of both trees. Default English at `/` (existing URLs unchanged); Ukrainian under `/uk/`; no redirect, no cookie, no storage, no language hash key. Never silent machine translation: a Ukrainian entry renders in production only when `reviewed`; otherwise the English text renders inside an element with `lang="en"`.

### V42: Per-language build and two-tree deploy layout (M)  [ ] todo   (G-DEPLOY for the workflow part)
- Goal: `MM_LANG` (`en` default, `uk`) drives `site/observablehq.config.js` (title, nav names, `base`, `output`); two output trees merged into one deploy tree (English at `/`, Ukrainian under `/uk/`); a single link helper so internal links respect `base`; build scripts `build:en`, `build:uk`, `build:all` in `site/package.json` scripts (no dependency change); the deploy workflow and any `scripts/ci/` wrapper build both trees and publish the merged tree (ADR-001/ADR-010 layout); actions stay pinned by SHA, minimal permissions, user-controlled values only through `env:`, `actionlint` clean. No dispatch, no push.
- Files: `site/observablehq.config.js`, `site/package.json` (scripts only), `site/scripts/merge-trees.mjs`, `site/tests/build-config.test.mjs`, `.github/workflows/*` (the existing site deploy workflow only), `scripts/ci/*` (only if the site build is wrapped there).
- AC-V2: 107 (English paths unchanged), supports 101, 103.
- Verify: `npm run build:all` produces both trees; path list of the English tree equals the pre-change list; `actionlint`; `npm test`.
- Depends on: G-APPROVE, G-DEPLOY (workflow part); V8 (page set).
- Risks: about 2x pages and build time (measured in V65); doubled `dist` size on Pages [UNVERIFIED]; the workflow change is outside `site/` and is flagged for review in gate J.

### V43: Post-build `<html lang>` step (S)  [ ] todo
- Goal: a script in `site/scripts/` (no new dependency) that, after each build, sets `lang="en"` / `lang="uk"` on the `<html>` element of every built HTML file in the corresponding tree (Framework 1.13.4 emits a bare `<html>`, verified in the design); fallback phrases in the other language carry their own `lang` attribute (added at render time by V44). Idempotent, fails loudly if a file has no `<html` tag.
- Files: `site/scripts/set-html-lang.mjs`, `site/package.json` (scripts only), `site/tests/html-lang.test.mjs`.
- AC-V2: 101 (`<html lang="en">` at `/`, `<html lang="uk">` under `/uk/`, checked on built HTML without JavaScript).
- Verify: `npm run build:all && npm test`; test reads every HTML file of both trees.
- Depends on: V42.
- Risks: HTML pages emitted by Framework with different `<html` formatting; the test uses the built output, not a mock.

### V44: Dictionaries, key parity, fallback and i18n report (M)  [ ] todo   (G-LANG-STR)
- Goal: `site/src/i18n/en.json` and `uk.json` (UI copy including every Amendment 1 DRAFT string, caption labels, frequency / seasonal adjustment / value status / state code labels, reason category labels, month and quarter patterns) and `site/src/i18n/names.uk.json` (sections `domains`, `indicators`, `entities`, `sources` keyed by stable id, sources by exact stored `source_name`); entry shape `{ "t", "status": "proposed|reviewed", "reviewed_on" }`; `copy.js` keeps its exported names and reads the dictionaries by `MM_LANG` (the English file equals today's confirmed strings verbatim); production build renders a Ukrainian entry only when `reviewed`, else English in a `lang="en"` element; `MM_SHOW_PROPOSED=1` preview build renders `proposed` entries with a visible marker; build writes `i18n-report.json` listing every fallback by kind and key and every export entity, indicator, domain and source lacking a reviewed Ukrainian name. Machine keys (entity ids, series ids, unit codes, hash periods) are never translated. Model-written Ukrainian drafts are `proposed` only; the agent never sets `reviewed`.
- Files: `site/src/i18n/{en,uk}.json`, `site/src/i18n/names.uk.json`, `site/src/lib/copy.js`, `site/src/lib/i18n.js`, `site/scripts/i18n-report.mjs`, `site/tests/i18n-parity.test.mjs`, `site/tests/i18n-fallback.test.mjs`, `site/tests/copy.test.mjs`.
- AC-V2: 100 (key parity incl. plural categories required per language; names tables contain no key unknown to the export meta, tested on the fixture), 102 (no raw key, no `undefined`, no placeholder pattern in either tree; every fallback in `i18n-report.json`), 106 (production build renders only `reviewed` Ukrainian text), 108 (report lists every missing reviewed name); AC-RD-55.
- Verify: `npm test`; `npm run build:all`; scan of `dist/uk` against the dictionaries.
- Depends on: V42, V6.
- Risks: ADR-025 decision 11: each Ukrainian string is a new string needing the user's confirmation; the judgement-word test needs a Ukrainian word list from the user (G-LANG-STR). A system-font-only site (no `@font-face`) covers Cyrillic.

### V45: Locale formatting, plural templates and collation (M)  [ ] todo
- Goal: number separators, month names, quarter labels (proposed en "Q1 2024", uk "1 кв. 2024"; the user confirms), counts and `{N} rows hidden` parts with `Intl.PluralRules(lang)` using CLDR categories (`one, few, many, other` for uk; `one, other` for en), A-Z ordering by `Intl.Collator(lang)` on the displayed label (a sort of a stored label, not a computation); stored decimals, rounding and units unchanged; hash period codes (`YYYY`, `YYYY-Qn`, `YYYY-MM`) are never localised.
- Files: `site/src/lib/format.js` (or existing formatter module), `site/src/lib/period-label.js`, `site/src/lib/hidden-rows.js`, `site/src/lib/filter-model.js` (sort by collator only), `site/tests/format-locale.test.mjs`, `site/tests/plural.test.mjs`.
- AC-V2: 104 (separators, month names, quarter labels, plurals for 0, 1, 2, 5, 11, 21, 22, 25 in uk and 0, 1, 2 in en; stored decimals unchanged), 109 (uk collator fixture with Ukrainian letters), 88 (per language).
- Verify: `npm test`; static scan still permits `Intl` as formatting only.
- Depends on: V44, V4.
- Risks: ICU data of the pinned Node 20 build [UNVERIFIED]; V1 records availability; a missing locale is reported, not worked around.

### V46: Language switch (S)  [ ] todo
- Goal: header link (`<a href lang hreflang>`, text "Українська" / "English" in its own language), outside the `nav` landmark, to the same path in the other language; works with JavaScript off (path swap built into the HTML, lands without hash); with JavaScript a small handler appends `location.hash`; present on every page including `404`; `<link rel="alternate" hreflang>` in `head` only if Framework 1.13.4 allows (OQ-20, reported); the nav test AC-RD-01/G-STR4 is updated for the unchanged nav set (OQ-16).
- Files: `site/src/lib/shell.js`, `site/src/lib/lang-switch.js`, `site/src/style.css` (tokens only), `site/tests/lang-switch.test.mjs`, `site/tests/smoke/lang.smoke.mjs`.
- AC-V2: 103 (present on every page, target exists, `hreflang` and `lang` set, works without JavaScript, hash kept when enabled), 107.
- Verify: `npm test`; `npm run smoke` once per tree; link target existence checked against the other tree's page list.
- Depends on: V42, V43, V44.
- Risks: pages that exist in one tree only.

### V47: Ukrainian names review sheet and entity name proposals (M)  [ ] todo   (G-LANG-STR)
- Goal: a script writing a review sheet under `docs/ops/` (id, English name, proposed Ukrainian, status) for domains, indicators (about 80), entities and sources; entity (country) name proposals from `Intl.DisplayNames` (region type, via an ISO3-to-ISO2 join) written as `proposed`, aggregates (EU27, EA and so on) left for hand entry; an import script that, from the sheet the user has edited, writes `names.uk.json` and sets `reviewed` with a date only for rows the user marked reviewed in the sheet. The agent never marks a row reviewed.
- Files: `site/scripts/names-review-sheet.mjs`, `site/scripts/names-import.mjs`, `site/tests/names-review.test.mjs`, `docs/ops/dashboard-v2-uk-names-review.md` (or `.csv`), `site/src/i18n/names.uk.json`.
- AC-V2: 100 (names keys known to export meta), 106, 108.
- Verify: `npm test`; round-trip: export sheet, simulated user edit in the test, import, status and date as specified; no row becomes reviewed without the sheet marking.
- Depends on: V44.
- Risks: OQ-21; the review is the user's time (G-LANG-STR).

### V48: "CR-23 (uk names)" export-side Ukrainian names  [ ] GATED (G-CR23), not a site task now
- Goal: only if the user approves the optional export-side alternative (`name_i18n` on `meta/domains.json`, `meta/indicators.json`, `meta/entities.json` and a source name map, generated from `name_uk` keys in `config/*.yaml` with a reviewed flag): the site prefers the export field over `names.uk.json`. Needs export-spec and config changes, its own plan and scope approval; nothing in V42-V47 depends on it.
- Files: none until approved.
- AC-V2: none new.
- Verify: not applicable until approved.
- Depends on: user approval of CR-23 (uk names), export-spec amendment.
- Risks: name clash with WEO ingestion ING-WEO (OQ-18).

### V49: Both-tree scans and per-tree smoke (S)  [ ] todo
- Goal: the data-only prose scan (AC-RD-62: same allow-list, 160-character limit per string, per language) and the AC-UX-11 scans (no off-origin request, no `@font-face`) run on both `dist` trees; existing English path list regression; Playwright smoke run once per tree (switch, `lang`, keyboard).
- Files: `site/tests/prose-scan.test.mjs`, `site/tests/ux-static.test.mjs`, `site/tests/smoke/ux.smoke.mjs`, `site/tests/smoke/lang.smoke.mjs`.
- AC-V2: 105, 107.
- Verify: `npm run build:all && npm test && npm run smoke`.
- Depends on: V44, V46.
- Risks: the Ukrainian judgement-word list comes from the user; until supplied, the test is marked as pending, not passing.

**Review gate J** (Opus, read-only): V42-V49 against ADR-037 A2.1, spec 13 A2.1, AC-V2-100..109, ADR-001/ADR-010 workflow layout, ADR-025 decision 11; confirms no export change, no runtime translation, no machine translation rendered in production, `reviewed` never set by an agent, the workflow change is actionlint-clean, pinned and minimal. Orchestrator re-runs section 6 on both trees and `actionlint`.

### Group K - C6 choropleth map (phase 1, added 2026-11-13, A2.2; today's export, no CR)

C6 is PARTIAL (Europe only, sparse on the Eurostat-only export, tiny-country markers); NEEDS nothing from the export. The map is placed on Compare (after C2) and on Home. The project is non-commercial (user-confirmed), relevant only if GISCO is ever considered; GISCO is used only if the user later asks, and its notice "© EuroGeographics for the administrative boundaries" would then be required.

### V50: Geometry preparation build step (shapefile to GeoJSON) (M)  [ ] todo   (G-GEO-FILE, OQ-17)
- Goal: a `site/scripts/` step with no new npm dependency that converts the Natural Earth admin-0 countries shapefile, Ukraine point-of-view variant (`ukr`; name inferred, existence and Crimea drawing not verified, so the script reports which file it read), to `site/src/geo/europe-countries.geojson`: clip to the Europe extent, drop overseas parts, round coordinates to 2 decimals; write `site/src/geo/geo-source.json` provenance (URL, version, access date, licence "public domain", fields `crimea_checked_by_user` null and its date null). Input file obtained only on the user's request (download into its own empty directory, treated as untrusted data) or placed by the user; the script takes paths as arguments. If conversion needs a dependency, stop and report (OQ-17).
- Files: `site/scripts/prepare-geo.mjs`, `site/src/geo/europe-countries.geojson`, `site/src/geo/geo-source.json`, `site/tests/prepare-geo.test.mjs` (small synthetic shapefile fixture).
- AC-V2: 112 (asset at most 100 KB gzipped, no new npm package via `check:imports`, provenance sidecar present).
- Verify: `npm test`; gzip size of the asset recorded; `npm run check:imports`; if over budget, report with the numbers (fallback 1:110m or GISCO 20M with markers is the user's decision).
- Depends on: G-APPROVE, G-GEO-FILE.
- Risks: reaching the 100 KB budget at 1:50m [UNVERIFIED]; the `ukr` file may not draw Crimea as Ukraine (V52); a self-written shapefile reader is non-trivial and may exceed M (split before starting if so).

### V51: Entity-to-geometry join table and join build tests (S)  [ ] todo
- Goal: `site/src/geo/entity_geo_join.json` rows `{entity_id, feature_id, marker, outside_extent}`; `feature_id` is the stable ISO 3166-1 alpha-3 field of the chosen source (which field is used is recorded; placeholder codes for some countries reported); `marker: true` at least for Malta, Luxembourg, Cyprus (final list set at asset preparation, static data); build tests fail when a `kind=country` entity of the export has neither a join row nor `outside_extent: true`, or when a join row's `feature_id` is absent from the asset; write `geo-join-report.json`. Aggregates have no row.
- Files: `site/src/geo/entity_geo_join.json`, `site/scripts/check-geo-join.mjs`, `site/tests/geo-join.test.mjs`.
- AC-V2: 115.
- Verify: `npm test` on the fixture and the sparse fixture; removing a join row or adding an unknown `feature_id` fails the test.
- Depends on: V50.
- Risks: placeholder codes (e.g. for some countries) in Natural Earth; panel countries outside the extent (USA, JPN, IND) must be flagged.

### V52: Crimea geometry test and release check (S)  [ ] todo   (G-CRIMEA)
- Goal: unit test AC-V2-119 on the prepared asset: the Ukraine feature contains reference points in Crimea (for example near Simferopol and one in Sevastopol; coordinates recorded in the test) and no separate Crimea or Sevastopol polygon, and no Russia polygon covering them, exists in the asset. If the test fails, stop and report; patching the geometry is the user's decision. The release check is a user step: the user inspects the prepared asset and `geo-source.json` records `crimea_checked_by_user` and the date; the agent never writes that value as set; a test asserts the field is set before a release build (`MM_RELEASE=1`).
- Files: `site/tests/geo-crimea.test.mjs`, `site/src/geo/geo-source.json` (field only, set by the user).
- AC-V2: 119.
- Verify: `npm test`; release-mode test fails while the field is null.
- Depends on: V50.
- Risks: this is a hard requirement; the Natural Earth default (de facto) does not draw Crimea as Ukraine, so the `ukr` file must be opened and checked.

### V53: C6 map module (M)  [ ] todo
- Goal: `Plot.geo`/`d3.geoAzimuthalEqualArea` rotated about [-10, -52], fit to the Europe extent, no zoom or pan; rows and period from `splitByCoverage` as C2 (printed `rank_reference_period`, `oth=1` draws other-period rows with a dashed outline and the period in the tip; `pc` does not affect colour); colour by stored value: sequential single hue when the shown range is at or above 0, diverging with midpoint 0 when it crosses 0, continuous scale over the stored min to max, declared in the caption, no classes, no clipping; legend gradient bar with min, max and unit; countries with geometry that are in the hidden array hatched (SVG pattern, never a zero colour); aggregates and outside-extent entities never drawn and listed in the disclosure under `other` with a stored-state sentence; tiny countries from the join `marker` drawn as fixed-size circles at the country position with the same scale; a row without geometry goes to the hidden array with reason `other`, not dropped; attribution "Natural Earth" in the card source note; no statistic in the module.
- Files: `site/src/lib/choropleth.js`, `site/src/lib/choropleth-model.js`, `site/tests/choropleth.test.mjs`, `site/tests/smoke/c6.smoke.mjs`.
- AC-V2: 110, 111, 113, 114, 116, 118.
- Verify: `npm test` (selection equals C2's; scale type; hatched set equals hidden-with-geometry set; markers present for each marker entity with a value); `npm run smoke` on the fixture and the sparse fixture; scan finds no quantile, mean or class-break.
- Depends on: V1, V4, V5, V19, V50, V51.
- Risks: pattern fill support in Plot 0.6.18 (V1); sparse on the Eurostat-only export.

### V54: C6 accessibility, table alternative, no-JS and weight (S)  [ ] todo
- Goal: SVG `role="img"` with an accessible name (title, unit, reference period); no per-country tab stops; table alternative with every stored row (entity, value, unit, period, state) reachable by a skip link; tips pointer-only; no-JS notice and the C2-style static link list; the geometry asset is loaded only on pages that render C6; contrast of the new tokens for light only (V62).
- Files: `site/src/lib/choropleth.js`, `site/src/style.css` (tokens only), `site/tests/choropleth-a11y.test.mjs`, `site/tests/smoke/ux.smoke.mjs`.
- AC-V2: 117, 112 (loaded only where rendered).
- Verify: `npm test`; `npm run smoke` (no tab stop per country; skip link works); JS-disabled context shows the notice.
- Depends on: V53.
- Risks: screen reader on the table alternative is manual (section 7).

### V55: Place C6 on Compare after C2 (S)  [ ] todo
- Goal: insert C6 after C2 in the `/compare` and `/indicator/<id>` composition with the shared Indicator, Group, Frequency, `oth` and `pc` state; no new control; Home placement is V58.
- Files: `site/src/compare.md`, `site/src/indicator/[indicator].md`, `site/tests/smoke/compare.smoke.mjs`, `site/tests/build-pages.test.mjs`.
- AC-V2: 110 (on Compare); PLAN: order C1, C2, C6, C3, C4.
- Verify: `npm test`; `npm run build`; `npm run smoke`.
- Depends on: V23, V53, V54.
- Risks: page weight of Compare (re-measured in V65).

**Review gate K** (Opus, read-only): V50-V55 against ADR-037 A2.2, spec 13 A2.2, AC-V2-110..119; confirms no new dependency, no topojson/shapefile library, no statistic in the C6 module, aggregates never drawn, hatch is not a zero colour, Crimea test passes on the actual asset and the user's inspection value is recorded by the user. Orchestrator re-runs section 6 and `npm run check:imports`.

### Group L - Home composition (phase 1, added 2026-11-13, A2.3; today's export, no CR)

Layout, top to bottom: header and filter bar; KPI strip; the four panels; the retained ADR-034 cards below, collapsed where heavy (nothing from ADR-034 is removed). C5 is not a Home panel. Constants are DRAFT (G-HOME-CONST).

### V56: Home constants and resolution (S)  [ ] todo   (G-HOME-CONST)
- Goal: one config module with `HOME_DEFAULT_INDICATOR = A05`, `HOME_KPI_ENTITY = EA` (if absent from `meta/entities.json`, the first aggregate), `HOME_KPI_IDS = [M09, M10, M11, P01, A01, M18]`, `HOME_HIGHLIGHT = [DEU, FRA, ITA, ESP, POL]` (cap 5); a missing id goes to a disclosure, never an error; all marked DRAFT; the user may change them.
- Files: `site/src/lib/home-config.js`, `site/tests/home-config.test.mjs`.
- AC-V2: 121.
- Verify: `npm test` (constants resolution against the fixture and the sparse fixture; missing id case).
- Depends on: V7.
- Risks: fixture ids are not the real ids (G-REAL).

### V57: Home KPI strip (S)  [ ] todo
- Goal: K1-style cards for the entity and ids of V56 (no sparkline on Home, no delta before V61), one row of up to 6 on wide, 3 per row on medium, 2 per row on compact; a card without a value goes to the strip's hidden-rows disclosure.
- Files: `site/src/lib/kpi-view.js`, `site/src/lib/home-page.js`, `site/tests/home-kpi.test.mjs`, `site/tests/smoke/home.smoke.mjs`.
- AC-V2: 120 (strip part), 121.
- Verify: `npm test`; `npm run smoke`.
- Depends on: V11, V56.
- Risks: the strip reads scorecards for several domains (counted in V60).

### V58: Home four panels and controls (M)  [ ] todo
- Goal: panels P-A C2 ranked bar, P-B C1 multi-country line (highlight from V56, cap 5), P-C C6 map, P-D C4 heatmap, all for the default indicator and the shared Period and Group state; controls exactly: indicator `<select>` (optgroup by domain, `i`), Group `<select>` (`g`), Period (`from`, `to`), country `<select>` (navigates to Country), mode links in the header; not on Home: C5, percentile toggle (`pc` off), `ctx`, `oth`, `stl`, C3 keys; panels' hidden-rows disclosures per A1.4; Parquet reader and series files for C1 and C4 start after the `load` event, not before; no-JS: notice and static link lists (panels absent); ADR-034 cards retained below, collapsed where heavy.
- Files: `site/src/index.md`, `site/src/lib/home-page.js`, `site/src/lib/home-lists.js`, `site/tests/home-panels.test.mjs`, `site/tests/smoke/home.smoke.mjs`, `site/tests/smoke/requests.smoke.mjs`.
- AC-V2: 120, 123, 124 (deferral part: no Parquet request before `load`).
- Verify: `npm test`; `npm run smoke` (panel order A, B, C, D; control list exact; no Parquet request before load; ADR-034 cards present).
- Depends on: V18, V19, V21, V53, V54, V56, V57.
- Risks: four charts on one page; landing weight (V60); percentile off means no `pc` control.

### V59: Home responsive layout (S)  [ ] todo
- Goal: wide: panels 2 x 2 in order A, B / C, D; medium: two columns only if each panel keeps its chart at least 320 CSS px wide, otherwise one column; compact (320 CSS px): panels stacked A, B, C, D, C4 scrolling inside its own container with a sticky country column, no page-level horizontal scroll (ADR-025 decision 7); tokens only.
- Files: `site/src/style.css`, `site/src/lib/home-page.js`, `site/tests/smoke/home.smoke.mjs`, `site/tests/smoke/ux-support.mjs`.
- AC-V2: 122, 120 (order at all widths).
- Verify: `npm run smoke` at 320, medium and wide viewports; no page-level horizontal scroll at 320.
- Depends on: V58.
- Risks: C4 on 320 px; Chromium emulation only.

### V60: Home and map weight measurement (S)  [ ] todo
- Goal: extend `site/scripts/measure-pages.mjs` to report Home landing (HTML, scorecard JSON for the default domain, geometry asset, KPI strip scorecards) against AC-RD-53 (600 KB gz target, 1.5 MB hard cap) and the deferred Parquet load plus the heaviest Home interaction against AC-V2-40 (5 MB gz), recorded separately in `docs/ops/dashboard-v2-measurements.md`; the geometry asset size is also recorded against the 100 KB budget. Record; do not tune silently; fixture numbers understate a real export (G-REAL).
- Files: `site/scripts/measure-pages.mjs`, `site/tests/scripts.test.mjs`, `docs/ops/dashboard-v2-measurements.md`.
- AC-V2: 124, 40 (Home covered), 112 (budget); AC-RD-53.
- Verify: `npm run measure:landing`; `npm run measure:pages`.
- Depends on: V58, V27.
- Risks: a landing breach is the user's decision (for example drop the KPI strip scorecards or the geometry from landing), not a silent change.

**Review gate L** (Opus, read-only): V56-V60 against ADR-037 A2.3, spec 13 A2.3, AC-V2-120..124 and AC-RD-53; confirms panel order, exact control list, C5 absent, no Parquet before load, ADR-034 cards still present, constants in one place and DRAFT. Orchestrator re-runs section 6.

### Group M - Neutral delta on K1 (added 2026-11-13, A2.4; GATED)

### V61: K1 neutral delta (S)  [ ] GATED (G-CR5-CR6 for `value_yoy` via CR-6, or G-CR11, and the field exported)
- Goal: a delta element on K1 cards only where a stored delta exists (CR-11 stored previous observation/delta, or the stored `value_yoy` column labelled "y/y (stored)" with the unit the export spec defines for it; if undefined, printed without a unit claim): direction word from the sign of the stored value ("up", "down", "no change"; Ukrainian strings DRAFT per V44) with an optional neutral-ink arrow glyph; no green, red, blue-orange or any colour mapped to direction, no good/bad wording, value printed with its sign; absent (not "n/a", not zero) when the stored field is null or the export does not provide it; no subtraction or division in the module. Not on Home before CR-11 (the scorecard row has no such field today).
- Files: `site/src/lib/kpi-delta.js`, `site/src/lib/kpi-view.js`, `site/tests/kpi-delta.test.mjs`, `site/tests/ux-style-scan.test.mjs`.
- AC-V2: 11 (amended), 125 (fixture with no stored delta: no card has a delta element; already true after V11), 126 (a test series with `value_yoy`: the delta is the stored number labelled "y/y (stored)", ink token equals the neutral text token; scan: no colour token other than text ink in the delta module).
- Verify: `npm test`; `npm run check:contrast`.
- Depends on: user approval of CR-6 (or CR-11) and an export that contains the field; V11, V7.
- Risks: unit contract of `value_yoy` is unapproved (CR-6); CR-5 recommended first is a different step.

### Group N - Theme (added 2026-11-13, A2.5)

### V62: Light-theme-only token scan and contrast tests (S)  [ ] todo
- Goal: static scan that new modules and CSS (language switch, KPI strip, C6, map legend, hatch, delta if built) use tokens only (no literal colour values); contrast tests for new tokens run for the light theme only, dark pairs are not asserted for new tokens; the existing dark block of `site/src/style.css` stays untouched (neither removed nor extended); a check on `git diff` that the dark block's lines are unchanged; print stays light.
- Files: `site/tests/ux-style-scan.test.mjs`, `site/scripts/contrast-pairs.mjs`, `site/tests/contrast.test.mjs`.
- AC-V2: 130, 131.
- Verify: `npm test`; `npm run check:contrast`; seeded negative (a literal colour in a new module) fails.
- Depends on: V46, V53 (and V57); runs again in V65.
- Risks: no claim is made that new components are correct in dark mode; the uncommitted edits in `site/tests/ux-style-scan.test.mjs` are rebased on, not overwritten.

**Review gate N** (Opus, read-only): V62 and the style parts of V46, V53, V57 against ADR-037 A2.5, ADR-025 (decision 8 reading: no new dark work), AC-V2-130/131; confirms the dark block diff is empty. Orchestrator re-runs section 6.

### V63: Country list page `/country` check  [ ] see V64
(Reserved ID, not used; V64 is the page. Kept blank to avoid renumbering confusion.)

### V64: Country list page (S)  [ ] todo   (A1.7)
- Goal: static page `/country` (built HTML, no JavaScript needed) listing every entity of `meta/entities.json`, countries first, aggregates in a labelled sub-list, each linking to `/country/<entity_id>`; the native picker (V9) on the page too; it is the target of the header "Country" entry.
- Files: `site/src/country/index.md`, `site/src/lib/country-list.js`, `site/tests/country-list.test.mjs`, `site/tests/smoke/country.smoke.mjs`, `site/tests/build-pages.test.mjs`.
- AC-V2: 92, 61.
- Verify: `npm test`; `npm run build`; built HTML lists every entity; each link resolves.
- Depends on: V7 (fixture entities); V9 for the picker part (the static list stands alone).
- Risks: page set test updated to the new set (AC-RD-02).

### V65: Amendment-2 closing sweep over both trees (M)  [ ] todo
- Goal: re-run and, where needed, extend V24 (accessibility and no-JS) over C6, Home panels, KPI strip and the language switch; V25 (module list test now includes C6, Home, delta and i18n modules); V26 (page set, link integrity, request lists) for both language trees; V27/V60 (weights and build time of the two-tree build; the second tree's `dist` size recorded, OQ-19); V62 token and contrast scans; V49 per-tree smoke. Record results in `docs/ops/dashboard-v2-measurements.md` and `docs/ops/dashboard-v2-decisions.md`.
- Files: `site/tests/**` (extensions only), `docs/ops/dashboard-v2-measurements.md`, `docs/ops/dashboard-v2-decisions.md`.
- AC-V2: 40, 101, 105, 107, 110..119, 120..124, 130, 131 (as re-confirmed).
- Verify: the whole of section 6 on both trees.
- Depends on: gates J, K, L, N; V64.
- Risks: build time and size of two trees [UNVERIFIED].

### Group F - Phase 1 closing

### V29: Phase 1 sign-off (S)  [ ] todo   (edited 2026-11-13: depends on the added groups)
- Goal: user-visible summary of what phase 1 renders on the fixture in both languages, what is empty on the Eurostat-only export (coverage: C2, C3, C4, C6, P1a), which DRAFT strings remain (including every Ukrainian string not `reviewed`), which Home constants are still DRAFT, which AC-V2 criteria are unmet or partly met (AC-V2-40 and 124 real-export part, AC-V2-119 user inspection pending if not yet recorded, AC-V2-125/126 gated), and what the release still needs. No code.
- Files: `docs/ops/dashboard-v2-decisions.md`.
- AC-V2: all phase 1 ACs listed with status.
- Verify: orchestrator re-runs section 6 and reports exact results.
- Depends on: Gate E, gates J, K, L, N, V65.
- Risks: none.

### Group G - Phase 2 data readiness (gated; the user requests each step)

### V30: Real-export measurement and WEO coverage check (M)  [ ] GATED (G-REAL, G-WEO)
- Goal: after the user has requested WEO ingestion (ING-WEO (spec 8 table)), the six-variable mapping decision, and a real export (redesign plan R24 route a or b, only on the user's explicit request), re-run V27 and V60 and record: which charts populate (C3 with A03 vs A05, C4 annual, C2 and C6 for A02-A05), payload sizes, the AC-V2-40 and 124 real-export part, whether G20 and EU27 exist in the real `meta/groups.json` (OQ-14), whether every `kind=country` entity has a join row (AC-V2-115 on the real export). If the user chose to map LUR, PCPIPCH, BCA_NGDPD, GGXONLB_NGDP, PPPPC, NGDP_D, new indicators are tested as data only; no site change expected.
- Files: `docs/ops/dashboard-v2-measurements.md`.
- AC-V2: 40 (real part), 124 (real part).
- Verify: numbers with the export identity (build id, date); nothing extrapolated.
- Depends on: V27, V60, G-WEO, G-REAL.
- Risks: ingestion and mapping are pipeline work outside this plan; WEO rows are annual with a per-country boundary between actual and projected, so `PROJ` rows must be absent from charts (AC-V2-50, 78) and the check includes that.

### Group H - Export-change-request tasks (each NOT started until the user approves that CR and the architect amends the export spec)

Common rule for V32-V36: the export side (Python `src/macro_monitor/publish/`, schemas, tests, `config/`) is EXPORT-SIDE work and needs its own plan and the user's scope approval; this plan lists only the site consumption and the contract test. Each task is optional and independent unless stated; phase 1 charts keep working without any of them.

### V32: CR-16 stored recent-values array in scorecard rows (S site side)  [ ] GATED (G-CR16)
- Goal: K1 and T2 sparklines read the stored array from the scorecard row, no Parquet load; fall back to V11b/no sparkline when the field is absent.
- Files: `site/src/lib/sparkline.js`, `site/src/lib/kpi-view.js`, `site/tests/sparkline.test.mjs`, fixture update.
- AC-V2: 10, 12, 40.
- Verify: `npm test`; `npm run measure:pages` shows the landing saving.
- Depends on: user approval of CR-16 and the export-spec amendment; V11/V11b.
- Risks: scorecard size growth (ADR-034 CR-1 weight budget).

### V33: CR-17 `peer_stats/<indicator_id>.json` and P1b band (M site side)  [ ] GATED (G-CR17)
- Goal: P1b (band p25-p75 and median from the stored file, country line over it); band drawn only where stored `n` is at least 5 (Q6); legend names the group (stored groups only, Q9; OQ-14) and the stored `n` at the latest period; no quantile in browser code.
- Files: `site/src/lib/peer-band.js`, `site/src/lib/country-page.js`, `site/tests/peer-band.test.mjs`, `site/tests/ux-static.test.mjs`, fixture `peer_stats`.
- AC-V2: 22, 23, 24.
- Verify: `npm test` (file schema, n threshold, scan); `npm run smoke`.
- Depends on: user approval of CR-17 and the export amendment; V14.
- Risks: the CR changes the export file set, so `manifest.files[]` and the request test (V26) are updated in this task.

### V34: CR-18 `scale_hint` (S)  [ ] GATED (G-CR18)   (edited 2026-11-13: A1.5)
- Goal: axis titles and form labels read `scale_hint` (`level|rate|index|change`) instead of `unit_label` text; the rebase control (V13, V18) appears only when `scale_hint = index` (this is the only marker; there is no interim); absent field keeps the phase 1 behaviour (rebase off).
- Files: `site/src/lib/units.js`, `site/src/lib/caption.js`, `site/src/lib/rebase.js`, `site/tests/units.test.mjs`, `site/tests/rebase.test.mjs`.
- AC-V2: 72, 73 (amended), 74, 91.
- Verify: `npm test`; `npm run smoke`.
- Depends on: user approval of CR-18 and the export that contains the field.
- Risks: none beyond fixture update.

### V35: CR-19 = CR-5 names, `unit_text` / `unit_text_varies` (S site side)  [ ] GATED (G-CR5-CR6)   (edited 2026-11-13: A1.6)
- Goal: unit text in K1/T1/C1/C3 axis and the blocking logic of V3 use series `unit_text`, `unit_scale` and indicator `unit_text`, `unit_text_varies` (the CR-5 names; `unit_label` stays codes); CR-5 is recommended first; CR-6 also defines the unit of `value_yoy`. Neither CR-5 nor CR-6 is approved.
- Files: `site/src/lib/units.js`, `site/src/lib/compat.js`, `site/tests/units.test.mjs`, `site/tests/compat.test.mjs`.
- AC-V2: 70, 71.
- Verify: `npm test`.
- Depends on: user approval of CR-5 (and CR-6 separately), the export-spec amendment, and the redesign plan R28 scope decision.
- Risks: overlaps redesign plan R28 (export side).

### V36: CR-20 per-entity series bundle (M site side)  [ ] CONDITIONAL (G-CR20)
- Goal: only if V27, V60 or V30 measure the Country-mode interaction over 5 MB gz, and the user approves CR-20: L1/K1 read `series_by_entity/<entity_id>.parquet`.
- Files: `site/src/lib/history.js`, `site/src/lib/small-multiples.js`, `site/tests/history.test.mjs`.
- AC-V2: 40.
- Verify: `npm run measure:pages` before and after.
- Depends on: measurement trigger, user approval of CR-20.
- Risks: a new export file set; closes with the redesign CR-4 question if still open.

**Review gate H** (Opus, read-only, run per approved CR): the site consumption against the amended export spec, schema, AC listed above, no browser-side statistic; orchestrator re-runs section 6 and the export-side checks of that CR's own plan (ruff, mypy, pytest).

### Group I - Phase 3 deferred (NOT TASKS; placeholders; nothing depends on them)

All of Group I is blocked until the user approves ADR-032 and confirms the IMF licence text (Q8, G-032). Nothing in Groups A-H or J-N may read `projection/*` or import a projection module.
- V40 (placeholder): L2/C1 projection layer (off by default, Level only, dashed + diamond + rule + edition label + attribution, rebase disabled while on). Needs CR-21 (`projection/<indicator_id>.json`, = ADR-032 decision 4b, schema 2.0 major bump), a hash key defined by ADR-032's own amendment (`proj` is removed until then), and a new plan.
- V41 (placeholder): C7 projection ranking (formerly C6; C6 is now the choropleth map, A2.2). Needs an additional ADR-032 amendment (decision 1 excludes ranking views) before it can even be planned.

## 5. Acceptance-criteria coverage

| AC-V2 | Task(s) |
|---|---|
| 10-13 | V11, V11b, V32 |
| 11 (amended: no delta without stored delta) | V11 (absence), V61 (gated) |
| 14-18 | V12 |
| 19, 20 | V13 (Group I for the layer itself) |
| 21 | V14 |
| 22-24 | V33 (gated) |
| 25, 26 | V15 |
| 30-34 | V18 |
| 35-38 | V19 |
| 37 | V15, V17, V19 |
| 40 | V27 (Country and Compare, fixture), V60 (Home, fixture), V65, V30 (real, gated), V36 (conditional) |
| 41-45 | V20 |
| 46-50 | V21 |
| 51 (amended: C5 only with `pc=1`) | V22 |
| 60 (amended: native select), 61, 62 | V9, V24, V26, V54 |
| 70-79 | V5, V3, V13, V18, V24 |
| 80-83 | V4, V19 |
| 80 (amended), 88, 89, 90 | V4, V6, V25 |
| 82 (amended) | V12, V13, V18, V21 |
| 84, 85 | V21 (with V2, V7, V17) |
| 86 | V12, V13, V18 |
| 87 | V2 (and V20 for `p`) |
| 91 | V3, V6, V13, V25, V34 |
| 92 | V64, V26 |
| 93 | V14 |
| 100 | V44, V47 |
| 101 | V43 (with V42), V65 |
| 102 | V44 |
| 103 | V46 |
| 104 | V45 |
| 105 | V49, V65 |
| 106 | V44, V47 |
| 107 | V42, V46, V49 |
| 108 | V44, V47 |
| 109 | V45 |
| 110 | V53, V55 |
| 111 | V53 |
| 112 | V50, V54, V60 |
| 113, 114, 116, 118 | V53 |
| 115 | V51 |
| 117 | V54 |
| 119 | V52 (user inspection recorded in `geo-source.json`) |
| 120 | V57, V58, V59 |
| 121 | V56, V57 |
| 122 | V59 |
| 123 | V58 |
| 124 | V58 (deferral), V60, V30 (real, gated) |
| 125 | V11 (absence now), V61 (gated) |
| 126 | V61 (gated on CR-6 or CR-11) |
| 130, 131 | V62 |
| PLAN items (no spec AC) | mode switch V8; controls matrix V17; no-JS notice and links, keyboard route per chart V24; C6/Home/both trees V65; Crimea user check V52 |

Spec ACs with no phase 1 task because they depend on gated work: AC-V2-22/23/24 (CR-17), AC-V2-19 beyond the absent control (Group I), AC-V2-125/126 beyond absence (V61: CR-6 or CR-11). The user-inspection half of AC-V2-119 is a user step. AC-V2-73 passes in phase 1 only in the form "rebase control absent".

## 6. Test and review checklist
ruff, mypy and pytest do not apply to `site/`-only tasks (no Python file is touched). EXPORT-SIDE tasks in Group H run `ruff check`, `ruff format --check`, `mypy --strict src` and `pytest` (unit) as well, each in its own plan; the orchestrator re-runs them itself. The orchestrator re-runs these itself in `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/site/` (both trees from Group J on: `MM_LANG=en` and `MM_LANG=uk`, or `build:all`):
1. `npm test`
2. `npm run check:imports`
3. `npm run check:contrast`
4. `npm run build` (and `build:all` from V42 on; `set-html-lang` after each build)
5. `npm run smoke` (once per tree from V46 on)
6. `npm run measure:landing` and `npm run measure:pages`
7. `actionlint` on the workflow file touched by V42
8. `git diff --stat`: no change in `src/`, `docs/design/`, `docs/specs/`, export schemas or `CLAUDE.md` (AC-RD-56); no new entry in `site/package.json` dependencies (AC-RD-52; the `scripts` block may change); the Group A-N diff touches only `site/` and `docs/ops/`, except the V42 workflow files; the dark block of `site/src/style.css` has no changed line (V62).
Opus review per group: check against ADR-037 incl. amendments, ADR-010, ADR-023-026, ADR-030, ADR-034, ADR-036 incl. Amendment 1, the spec incl. sections 12 and 13, and this plan; D6 (no computation in the browser, one stored-row tally only); data-only prose rule in both languages; no pie/donut/funnel, dual axis, composite score, regression or own forecast (ADR-037 decision 2); DRAFT strings marked and no Ukrainian entry set `reviewed` by an agent; no `projection/` read; no topojson or shapefile runtime library.

## 7. Manual items outside automation
Screen reader (including the status region with a closed `<details>`, ADR-036 I5, and the C6 table alternative), Firefox, Safari, real print dialog, Windows high contrast, native select type-ahead with Ukrainian labels, the user's Ukrainian string and name review (V44, V47), the user's inspection of the geometry asset for Crimea (V52), the user's confirmation of Home constants (V56), the user's validation runs in both languages (V28).

## 8. Risks and unknowns
- Eurostat-only coverage: C2, C3, C4, C6 and P1a will be sparse (3 of 42 countries had any ranked value in the baseline; the number with a plain value is unmeasured); the Home panels use M09, the only domain with ranked data; a release waits for phase 2 (Q4).
- The real export is not in the repository; all measurements are fixture-only until G-REAL.
- Plot 0.6.18 marks, pattern fills and keyboard access for new charts (V1, OQ-15).
- Up to 14 Parquet files per domain in Country mode (V27); Home loads Parquet for C1 and C4 after `load` (V58, V60); CR-20 only if measured too heavy.
- Geometry: Natural Earth default does not draw Crimea as Ukraine; the `ukr` file name and behaviour are unverified until opened (V50, V52); 100 KB budget unverified; conversion without a dependency (OQ-17).
- Two language trees: build time, `dist` size, workflow change (V42, V65, OQ-19); Ukrainian text exists only as `proposed` until the user reviews it, so production Ukrainian pages fall back to English until then.
- Open questions OQ-12, OQ-14..OQ-21 may change tasks V11b, V33, V1, V8, V46, V50, V47, V30.
- Uncommitted edits exist in `site/tests/ux-style-scan.test.mjs` and in docs (git status at planning time); the implementer must not overwrite them.
- Browser evidence is Chromium emulation only.

## Addendum 2026-11-13: coverage of all 42 countries (user requirement)
The user requires data for all 42 panel countries in the dashboard. The Home default indicator is A05 (decided by the user 2026-11-13; ADR-037 A2.3, AC-V2-121, AC-V2-132). Details and the source-by-country matrix: `docs/plans/dashboard-v2-analytical-coverage-42.md`. New tasks, IDs continue the plan; each follows the task template once started, and none is started before this plan's gates allow it.
- V66: dense synthetic fixture with all 42 countries plus aggregates, including A05 (extends V7). AC-V2-132 on the fixture.
- V67: per-panel Home smoke test: for each Home panel (C2, C1, C6, C4, KPI strip) drawn + hidden (with reason) = 42.
- V68: coverage report (countries with data per indicator), fixture part now; real-export part gated on G-REAL.
- V69: Home constants confirmation (G-HOME-CONST): KPI ids and highlighted countries; A05 is annual, so the KPI strip may include it only as proposed.
- V70: real coverage check, gated on G-REAL and ING-WEO; folded into V30.
Pipeline-side steps needed so that every country has data (ING-WEO, World Bank load, the six unmapped WEO variables decision, real export R24, T60, T61, T63) are not tasks of this plan: each needs the user's explicit request (CLAUDE.md) and belongs in the v1 plan or a new plan.
Geometry file obtained: see gate G-GEO-FILE.
