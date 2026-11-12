---
status: approved   # approved by the user on 2026-11-10 (stated in session: "approved")
inputs:
  - CLAUDE.md
  - docs/design/adr/ADR-034-analytics-dashboard-layout-filter-bar-and-cards.md   # approved 2026-11-10, incl. "User answers"
  - docs/specs/dashboard-layout-amendment.md                                     # approved 2026-11-10 (AC-DB-01..35)
  - docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md
  - docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md
  - docs/design/adr/ADR-026-percentile-orientation-legend-and-dashboard-display-rules.md
  - docs/design/adr/ADR-010-interactive-dashboard.md
  - docs/design/adr/ADR-023-dashboard-toolkit-observable-framework.md
  - docs/design/adr/ADR-024-observable-framework-as-site-build-tool.md
  - docs/specs/dashboard-redesign-spec.md
  - docs/specs/dashboard-export-spec.md
  - docs/plans/dashboard-redesign-implementation-plan.md   # style reference and record of R1-R23; not edited
---
# Dashboard layout implementation plan (ADR-034, dashboard-layout-amendment)

Written 2026-11-10 by the planner. Nothing here is approved; the user approves. Task IDs are L1 onward (the redesign plan used R1-R29). Two phases: phase A changes only `site/` (and `docs/ops/` records) and needs no export change; phase B needs export changes CR-1 and CR-2 and is NOT startable (section 5).

## 1. Scope and conventions
- Write locations, phase A: `site/` (src, scripts, tests, fixtures) and `docs/ops/` (measurement and review records). No phase A task touches `src/`, `config/`, `docs/design/`, `docs/specs/`, an ADR, or the export. AC-DB-35 is checked in every review (`git diff --stat`: nothing outside `site/` and `docs/ops/`).
- No new npm dependency (AC-DB-30, AC-RD-52). No off-origin request. Browser evidence is Chromium emulation.
- Model split (CLAUDE.md): every task is implemented by `data-engineer` on Sonnet (`model: sonnet`). Every task GROUP ends with a "Review gate": a separate read-only Opus subagent (`model: opus`) checks the group against ADR-034, the amendment, ADR-025/026/030, the redesign spec and this plan. The orchestrator re-runs the commands of section 7 itself and does not trust the subagent's report.
- Sizes: S under 2 h, M under half a day. A larger task is split before starting.
- Task fields: Goal, Files (under `site/` unless stated), AC-DB, Verify, Depends, Risks. "Unit" = `node:test` in `site/tests`; "Smoke" = Playwright harness in `site/tests/smoke`.
- New strings go to `site/src/lib/copy.js` as `DRAFT_` constants (amendment section 7; ADR-025 decision 11). The user confirmed the new labels in ADR-034 Q7, but the wording of the hidden-rows sentence and the home `h1` is still DRAFT/open (section 2). Confirmed strings are reused verbatim. The R27 rename of confirmed constants is a separate, still-proposed task of the redesign plan and is not done here.
- Tokens, classes and names are fixed by the amendment: `--mm-canvas`, `--mm-card`, `--mm-card-border`, `--mm-band-bg`, `--mm-band-ink`, `--mm-tile-number-size`; `.mm-grid`, `.mm-card`, `.mm-card--span-N` (N in 3, 4, 6, 8, 12), `.mm-band`. Not Framework's `.card`/`.grid`.

## 2. Already done and reused (do not redo)
From `docs/plans/dashboard-redesign-implementation-plan.md` (R1-R23 done; R24-R29 are not):
- Pages `country/<id>` (44 stub `.md` files incl. EA, EU27), `indicator/<id>` (about 80), `domain/<id>` (11), `domains`, `explorer` (PG-SERIES), `revisions`, `index` (link lists) exist. `peers/*` and `status` are gone. Navigation is Home / Time series / Domains / Revisions.
- Helpers exist in `site/src/lib/`: `hash.js` (`#i`, `#c`, `#g`), `period.js`, `units.js`, `sort.js`, `missing.js`/`states.js`, `copy.js`, `shell.js`, `stale.js`, `heatmap.js`, `heatmap-view.js`, `scorecard.js`, `scorecard-view.js`, `country-model.js`, `country-view.js`, `indicator-model.js`, `indicator-view.js`, `explorer-view.js`, `series-meta.js`, `tip.js`, `about-value.js`, `history.js`, `state-blocks.js` (`busyBlock`, `loadAll`), `home-lists.js`, `domains-list.js`. These are extended or wrapped, not rewritten. Whether each name above matches its current API is checked in L1.
- Test infrastructure exists: sparse fixture `site/tests/fixtures/sparse_export/**` (44 entities), `check:contrast`, `check:imports`, `measure:landing`, `measure:pages`, `smoke` with request recording (`requests.smoke.mjs`), prose scan, copy test, build-pages test, static scans (AC-RD-50 and others).
- Measured baseline (fixtures, 2026-11-09): CSS 11,430 B gz of the 20,000 B budget (`docs/ops/dashboard-redesign-measurements.md`). Headroom for ADR-034 layout: about 8.5 KB gz.
- Working tree caveat [REPO, git status at planning time]: `site/scripts/prepare-data.mjs`, `site/src/index.md`, `site/src/lib/indicator-model.js`, `site/tests/indicator-model.test.mjs`, `site/tests/unit/...` and several `src/` and `config/` files carry uncommitted changes that are not part of this plan. L1 records the baseline so later diffs are attributable.

## 3. Blockers, design gaps and open items (the user or architect resolves; this plan decides none of them)

| ID | Item | What is open | Blocks | Needed from |
|---|---|---|---|---|
| B-DOC | Doc sync | Amendment section 11 lists docs to update after approval (ADR-030, redesign spec incl. a status reset to draft "per its own amendment rule", ADR-025, ADR-026, export spec, brief, ops records). Not stated whether phase A may start before the sync, or whether the redesign spec reset to draft stops phase 4 (CLAUDE.md gating). | Start of L1 (user decision) | User, then architect |
| B-CNT | Hidden-row count vs D6 | RESOLVED by ADR-036 (approved 2026-11-10): one D6 exception, `countPeriodHiddenRows`; count plus collapsible list; wording confirmed; Period hides rows on C-RANK and C-TABLE only. | Nothing (resolved) | None |
| B-SCOPE | Scope vs Group + Country | RESOLVED (user confirmed 2026-11-10): the Country control is the chip with checkbox list, up to 5 selected, as in amendment 2.1 (Group select plus Country chip/list). | Nothing (L8 unblocked) | None |
| B-Q4 | ADR-034 Q4 | Front matter says Q4 = configured `headline` flag; the "User answers" text says "recommended and not yet answered". | Phase B tile selection only. Phase A uses `indicator_ids` order | User: confirm |
| B-CR2 | CR-2 not specified | Amendment section 9 contains only CR-1 and states "No other change request is made". The `headline` flag (`config/indicators.yaml` -> `meta/indicators.json`) has no spec text. The id CR-2 is also already used in the redesign spec for projections (blocked by ADR-011). The word "headline" already means the headline series (`role = 'headline'`, ADR-009; `v_headline_obs_published`). | All of phase B CR-2 work | Architect: restate with an unused id and a non-colliding field name |
| B-CR1 | CR-1 status | ADR user answer Q5 accepts CR-1 as phase B, but amendment section 9 says "NOT approved; needs an export-spec change". Approval of the export-spec edit is a separate step. | Phase B | Architect edits export spec; user approves |
| B-H1 | Home `h1` text | Amendment 4.1 says the title `h1` "Macro Monitor" is withdrawn and the `h1` is "the existing static `h1` of `index`", which today reads "Country scorecards" (`site/src/index.md`). That text no longer describes a dashboard. ADR-034 Q7 says the text is "still to be proposed". The plan keeps the current text as a DRAFT constant and does not propose wording (proposal is for the architect/user). | Final copy only; L9 builds with the current text | Architect proposes, user confirms |
| B-STR | DRAFT strings | Amendment section 7 strings are DRAFT in `copy.js` until confirmed (ADR-034 Q7 says "confirmed", the spec says DRAFT; the plan keeps the DRAFT marker so a later rename is one edit). The singular fix to `DRAFT_HIDDEN_ROWS(1)` ("1 row hidden by the period filter") and the new `DRAFT_HIDDEN_ROW_ITEM` are phase-4 items (`copy.js`, `copy.test.mjs`, `prose-scan.test.mjs`). | Release only | User |
| B-DEF | Default domain | Default view = first domain of `meta/domains.json`. In the real export that is `agri` ("Agri-food", `ranked: false`, notice "informational, unranked"), so the first screen would show a heatmap and ranked bars with no percentile bins. R17 of the redesign plan sorted domains by `domain_id` while CR-9 (display order) is open. Per ADR-034 Q2 the user chose the first domain; flagged so the user sees the consequence. | None (builds as specified); evaluated in L17 | User: keep or reorder (CR-9) |
| B-CSS | CSS budget | 20 KB gz kept (Q6). Measured only after L2-L14. If exceeded, the raise is the user's decision. | L24 | User |
| B-EXP | Real export | The export at the scratchpad path has 11 domains, 72 indicators, 43 entities (ADR-034 says 44; the difference is not explained), and only 12 `series/*.parquet` files were seen against "about 80" in the export spec and one `revisions/M09.parquet`. It is a local, non-committed measurement input. | L17 findings | User: confirm what it is expected to contain |

## 4. Task list, phase A (no export change)

### Group A - Surface, tokens, pure foundations

### L1: Baseline and API check (S)  [ ] todo
- Goal: record the starting point: `git status` of `site/`, test counts, CSS gz size, `measure:landing`/`measure:pages` output on the fixtures; confirm the actual exported names and signatures of the helpers listed in section 2 (hash, sort, heatmap-view, scorecard-view, state-blocks, home-lists) and write them into the task report so later tasks reuse them.
- Files: `docs/ops/dashboard-layout-measurements.md` (new, baseline section only).
- AC-DB: 30, 31 (baseline), 35.
- Verify: `npm test`, `npm run check:imports`, `npm run check:contrast`, `npm run build`, `npm run smoke`, `npm run measure:pages` all green or the pre-existing failures listed.
- Depends on: B-DOC answered; none else.
- Risks: pre-existing uncommitted changes make failures hard to attribute. Report them; do not fix other work here.

### L2: Surface tokens and card/band/grid CSS (M)  [ ] todo
- Goal: add the tokens of amendment section 3 for both themes, `.mm-grid` (12 / 6 / 1 columns at 64 rem / 40 rem / below), `.mm-card`, `.mm-card--span-N`, `.mm-band` (full-width band, `h2`, optional right link), card `h3` title and subtitle line, reserved min-heights per card type, forced-colors border, reduced motion. Apply canvas and card surface to the existing pages with no behaviour change (wrap only; the entity pages' content is untouched).
- Files: `site/src/style.css`, `site/scripts/contrast-pairs.mjs`, `site/tests/ux-style-scan.test.mjs`, `site/tests/smoke/ux.smoke.mjs`.
- AC-DB: 10, 11; AC-UX-1, 3, 12 extended.
- Verify: `npm run check:contrast` (text 4.5:1 on card and canvas, control borders 3:1, both themes); style scan: no hard-coded colour outside `style.css`; smoke at 320/390/768/1280/1920 px: no clipping, no horizontal page scroll; CSS gz recorded.
- Depends on: L1.
- Risks: candidate hex values may fail contrast; adjust within AC-UX-1, never lower the ratio. Canvas/card need not carry meaning (no new colour as state).

### L3: Copy constants and allow-list extension (S)  [x] done
- Result: 18 DRAFT_ constants for amendment sections 6/7 incl. DRAFT_HIDDEN_ROWS (0 gives no sentence, amendment A1); copy/prose tests extended; npm test green except one pre-existing fixture-data failure.
- Goal: add every string of amendment section 7 to `copy.js` as `DRAFT_` constants (each at most 160 characters), extend the AC-RD-62 allow-list with the amendment section 6 items (control labels, chip summary pattern, print filters line, placeholder, empty-card, sparkline sentence, "Reference rows", "Browse", four band titles), keep "Aggregates" and other confirmed strings unchanged. The hidden-rows sentence is covered by ADR-036 (B-CNT resolved); the singular fix to `DRAFT_HIDDEN_ROWS(1)` and the new `DRAFT_HIDDEN_ROW_ITEM` are phase-4 items. Home `h1` stays the current text (B-H1).
- Files: `site/src/lib/copy.js`, `site/tests/copy.test.mjs`, `site/tests/prose-scan.test.mjs`.
- AC-DB: 32, 34.
- Verify: `npm test`; a copy test lists the new constants as DRAFT and fails if a section 7 string is missing; the prose scan still has a seeded negative.
- Depends on: L1.
- Risks: a string outside the allow-list silently passes if the scan only checks known files; add the new modules to the scanned set in each later task.

### L4: Hash grammar extension (S)  [ ] todo
- Goal: extend `hash.js` for `d`, `f`, `from`, `to` per amendment 2.3: fixed serialization order `i, c, g, d, f, from, to`; `from`/`to` valid only as a pair with `from <= to` within bounds (from `manifest.history_start` and the year of `manifest.known_cutoff`); unknown/repeated key/malformed id ignored with the fallback-note flag; unused parameters pass through; one state gives one hash. Existing `i`, `c`, `g` behaviour unchanged (the redesign hash tests keep passing).
- Files: `site/src/lib/hash.js`, `site/tests/hash.test.mjs`, `site/tests/hash-baseline.test.mjs` (only if a pinned expectation must grow; report why).
- AC-DB: 02 (unit part); AC-RD-34 kept.
- Verify: `npm test` table tests: valid, partial-valid, malformed, `from > to` (both ignored), lone `from`, duplicate keys, pass-through of an unknown key, round trip.
- Depends on: L1.
- Risks: PG-SERIES rule "`g` ignored and not written, transform/rebase/free-axis not in hash" must still hold (test).

### L5: Filter view-model (pure) (M)  [x] done
- Result: filter-model.js plus tests/filter-model.test.mjs (AC-DB-03, 36); countPeriodHiddenRows is the one whitelisted count; aggregates always in a separate reference group.
- Goal: pure functions over stored fields only: comparison set from Group (`meta/groups.json`; "All countries" = `kind = country`) plus focus Countries and the "in focus outside the group" rule (amendment 2.2); Domain by `domain_ids`/`indicator_ids`; Indicator list narrowed by Domain and Frequency (`frequency_set[]`); series filter by stored `frequency` (no resampling); Period: clip a list of dated values to years `from`..`to` inclusive of `ref_period_end`, and hide scorecard rows whose latest `ref_period_end` year is outside the range (user answer Q3); preset arithmetic ("Last 10 years" = `to` year of `known_cutoff`, `from` = `to` - 9). The function that returns the hidden rows returns them as a list; the count comes only from `countPeriodHiddenRows`, the single D6 exception of ADR-036 (B-CNT resolved).
- Files: `site/src/lib/filter-model.js`, `site/tests/filter-model.test.mjs`, `site/tests/ux-static.test.mjs` (extend the AC-RD-50 scan to this module).
- AC-DB: 03; AC-RD-50.
- Verify: `npm test` with tables for each filter (including a mixed-frequency indicator and the in-focus-outside-group case); the scan finds no mean/sum/rank/percentile computation and no count of entities other than `countPeriodHiddenRows`, with a seeded negative.
- Depends on: L4.
- Risks: D6 boundary. Hiding rows is selection and is allowed; any count other than `countPeriodHiddenRows` is not (ADR-036, B-CNT resolved).

**Review gate A** (Opus, read-only): L1-L5 against ADR-034 decisions 1-3, amendment sections 2.2, 2.3, 3, AC-DB-02, 03, 10, 11, 32, 34; D6 scan; no diff outside `site/` and `docs/ops/`.

### Group B - Filter bar and the reactive proof

### L6: Filter store and reactive proof on one card (M)  [ ] todo
- Goal: a small store (state object, subscribe, set, reset) seeded from the hash on load (never written on load) and re-read on `hashchange`; written with `replaceState` after a user change only, only when the serialized hash differs, `history.length` unchanged. Prove the wiring to Framework 1.13.4 reactive cells (`Generators`/`view`) by driving ONE throwaway-but-kept minimal card (a text list of the comparison set from L5) on the home page behind the existing content. Report the verified or unverified result of ADR-034's risk "reactive wiring through `Generators`".
- Files: `site/src/lib/filter-store.js`, `site/src/index.md` (proof cell, removed or reused in L10), `site/tests/filter-store.test.mjs`, `site/tests/smoke/home.smoke.mjs`.
- AC-DB: 02 (smoke part).
- Verify: `npm test`; smoke: change a value programmatically, the card re-renders, hash updates once, `history.length` unchanged, back/forward and `hashchange` re-read; no write on load.
- Depends on: L4, L5.
- Risks: if the Framework cannot re-run cells from a non-Observable store without a new dependency, STOP and report (design decision needed; no workaround). All later cards depend on this.

### L7: Filter bar markup and native controls (M)  [ ] todo
- Goal: component `mountFilterBar(page, state)` per amendment 2.1/2.4: `<form role="group" aria-label="Filters">` with labelled native controls: Group `<select>`, Domain `<select>`, Indicator `<select>` grouped by domain with unit beside the name, Frequency `<select>`, Reset button; options from `meta/*` only. Applicability matrix: a control that does nothing on the page is not rendered (page type passed in). Country and Period chips are L8 and L9.
- Files: `site/src/lib/filter-bar.js`, `site/src/lib/filter-bar-options.js` (pure option builders), `site/src/style.css`, `site/tests/filter-bar-options.test.mjs`, `site/tests/smoke/filterbar.smoke.mjs`.
- AC-DB: 01 (partly), 03.
- Verify: `npm test`; smoke: controls per page type, accessible names equal the `copy.js` strings.
- Depends on: L2, L3, L6.
- Risks: option lists narrow each other (Domain + Frequency narrow Indicator); a selected indicator that falls out of the narrowed list must keep or clear predictably. Pin the rule in a test and report it (not specified in the amendment).

### L8: Country control (chip with list, aggregates subheading) (M)  [ ] todo
- Goal: `<details>/<summary>` chip, summary text shows the current value, text filter input, checkbox list of countries (alphabetical by stored name) then a sub-list headed "Aggregates" (existing confirmed string) for `kind = aggregate`, global entities excluded, up to 5 selected (the sixth is refused with a visible message), restricted to the Group's members when `g` is set; writes `c`. Escape closes the chip and returns focus to its summary; click/focus outside closes; no focus trap.
- Files: `site/src/lib/filter-bar.js` (or `filter-country.js`), `site/src/style.css`, `site/tests/filter-country.test.mjs`, `site/tests/smoke/filterbar.smoke.mjs`.
- AC-DB: 01, 04.
- Verify: `npm test`; smoke with keyboard only: Tab to the chip, open, filter by text, select, Escape.
- Depends on: L7. B-SCOPE is resolved (user confirmed the Country chip with checkbox list, up to 5; 2026-11-10), so L8 is unblocked.
- Risks: target size 24 x 24 CSS px for 44 rows; long list scrolls inside the chip.

### L9: Period control (chip with year selects and presets) (S)  [ ] todo
- Goal: chip with From and To year `<select>`s (years between `manifest.history_start` and the year of `known_cutoff`) and presets "All", "Last 10 years", "Last 5 years"; writes `from`/`to` only as a valid pair; summary text "Period: 2015 to 2025" pattern; same close/Escape behaviour as L8.
- Files: `site/src/lib/filter-bar.js` (or `filter-period.js`), `site/tests/filter-period.test.mjs`, `site/tests/smoke/filterbar.smoke.mjs`.
- AC-DB: 01, 02, 03, 04.
- Verify: `npm test`; smoke: select `from` after `to` is refused and nothing is written; preset sets the pair; Reset clears.
- Depends on: L7.
- Risks: bounds depend on manifest fields; if `history_start` is absent in a fixture, show the control disabled with the page's existing error pattern, do not invent a range.

### L10: Sticky, compact, print, carry links (M)  [ ] todo
- Goal: `position: sticky; top: 0`, bar height reserved at first paint (CLS at most 0.1), `scroll-padding-top` and `scroll-margin-top` equal to the bar height, sticky table/heatmap headers offset by it; below 40 rem summary chips plus one "Filters" `<details>`; print: bar hidden and one "Filters: label: value; ..." line (active filters only, "none" when default) under the freshness line; carry: links with `data-carry` (country names, indicator names, header navigation) get the current hash on click; links work without the hash when JavaScript is off.
- Files: `site/src/lib/filter-bar.js`, `site/src/lib/carry.js`, `site/src/lib/shell.js` (freshness line slot only), `site/src/style.css`, `site/tests/carry.test.mjs`, `site/tests/smoke/filterbar.smoke.mjs`, `site/tests/smoke/ux.smoke.mjs`.
- AC-DB: 04, 05, 06, 07.
- Verify: `npm test`; `npm run smoke` (focus never covered at 1280 and 320 px; print emulation; CLS); `npm run check:contrast`.
- Depends on: L8, L9.
- Risks: sticky bar plus sticky table headers plus the heatmap sticky column is the main focus-obscuring risk (WCAG 2.4.11); measure offsets, do not guess. `data-carry` needs adding to links built by existing views, which touches `country-view.js` and `indicator-view.js` only to add the attribute.

**Review gate B** (Opus, read-only): L6-L10 against amendment 2.1-2.5, AC-DB-01 to 07, ADR-034 decision 2; the reactive proof result is stated; keyboard and screen-reader semantics reviewed from the markup; no new dependency.

### Group C - Home dashboard

### L11: Home page skeleton and data loading (M)  [x] done
- Result: band skeleton, per-domain scorecard loader and Browse details in place; request list on `/` is manifest, `meta/*` and one scorecard; see `docs/ops/dashboard-layout-measurements.md` (L11).
- Goal: rewrite `site/src/index.md` into the band layout of amendment 4.1: static `h1` (current text, B-H1), no-JS notice, caveat, freshness line (shell), the bar, bands "Overview", "Compare", the selected Domain's name, "Indicators", "Over time", "Browse". Load only `manifest`, `status` (shell), `meta/*`, and the default domain's scorecard; a Domain change loads that domain's scorecard once (cached); defaults per 4.1 (Group "All countries", first domain of `meta/domains.json`, its first indicator). "Browse": the existing home lists (countries, indicators, text filters) and the C-HOME-4 links, inside a collapsed `<details>`, present in the built HTML. Each card slot is an empty `.mm-card` with reserved height and `aria-busy` until filled by L12-L16.
- Files: `site/src/index.md`, `site/src/lib/home-dashboard.js`, `site/src/lib/home-lists.js` (mount into Browse only), `site/tests/home-dashboard.test.mjs`, `site/tests/smoke/home.smoke.mjs`, `site/tests/smoke/requests.smoke.mjs`, `site/tests/build-pages.test.mjs`.
- AC-DB: 12, 13; AC-RD-01, 02, 03, 05 kept.
- Verify: `npm run build && npm test && npm run smoke`; the recorded request list for default load equals manifest, status, `meta/*` files and one scorecard; a Domain change adds only that scorecard; no `series/*` request; built `index` HTML holds `h1`, notice, caveat and the full link lists inside Browse.
- Depends on: L10.
- Risks: the home page now needs JS for its content (accepted in ADR-034); the orientation note placement (once, above the heatmap card) is wired in L13. An Indicator in two domains reads the first of its `domain_ids` (AC-RD-24).

### L12: Ranked comparison card, model (S) then view (M)  [ ] todo
- Goal (model, S): pure builder `rank-model.js`: one row per entity of the comparison set (countries, then a "Reference rows" group of stored `kind = aggregate` entities), sort Country A-Z (default) / Value / Percentile (stored fields, nulls last, ties by name, reusing `sort.js`), rows without a value last with state code and sentence, the mixed-unit rule (single unit code in `unit_label` now; `unit_text_varies` only if CR-5 is in the export), the in-focus row. No top-N, no Total, no average.
- Goal (view, M): the card per 4.7: header with sort `<select>`, scroll container with sticky header row, bar rows (fill = percentile bin token, neutral without a percentile, in-focus outlined, shared axis only when one unit, otherwise percentile dot plus value text and row unit), country links with `data-carry`, "About this value" `<details>`, "View as table" with the RD C-IND-5 columns, the RD 5.6 point reader. Facts card (span 4) beside it: stored `unit_label`, frequency set, direction label, reference-period line, `notes[]` verbatim. Period hiding applied (C-RANK; ADR-036): the card renders the hidden-rows disclosure (count from `countPeriodHiddenRows` plus a collapsible list of the hidden rows); B-CNT is resolved.
- Files: `site/src/lib/rank-model.js`, `site/src/lib/rank-view.js`, `site/src/lib/facts-card.js`, `site/src/style.css`, `site/tests/rank-model.test.mjs`, `site/tests/smoke/rank.smoke.mjs`.
- AC-DB: 22, 23, 03 (card part); AC-RD-22, 45, 54.
- Verify: `npm test` (fixture with a mixed-unit indicator: no bar axis; aggregates only in Reference rows; no Total/average label anywhere, static scan with seeded negative); `npm run smoke` on the 44-entity sparse fixture (none dropped, nulls last, keyboard, grayscale check).
- Depends on: L11.
- Risks: without CR-5 the single-unit test is textual on `unit_label`; bar axis from stored values only; 44 rows need the scroll container (AC-DB-11).

### L13: Heatmap card (M)  [ ] todo
- Goal: wrap `heatmap-view.js` in a card for the selected Domain and the comparison set: rows = countries then the aggregate group; columns = the Domain's indicators narrowed by Frequency; leading stored `percentile_rank` column with its label (RD C-CTRY-1 formatting; an unranked domain shows the existing not-ranked wording); sticky first column and header offset by the bar height; legend and the orientation note once on the page, directly above the card; max-height with own vertical scroll; horizontal scroll only inside the card; cell accessible description carries the state sentence. The heatmap card is not affected by the Period filter (ADR-036: Period hides rows on C-RANK and C-TABLE only), so L13 renders no hidden-rows disclosure. No overall column, no row aggregate, no composite.
- Files: `site/src/lib/heatmap-view.js` (parametrize, keep V1 behaviour for PG-DOMAIN), `site/src/lib/heatmap.js`, `site/src/style.css`, `site/tests/heatmap.test.mjs`, `site/tests/smoke/heatmap-card.smoke.mjs`.
- AC-DB: 24; AC-UX-10; AC-RD-54.
- Verify: `npm test`; `npm run smoke`: sampled cells equal stored scorecard values; Frequency removes columns not rows; PG-DOMAIN heatmap unchanged.
- Depends on: L11, L12 (shared comparison set).
- Risks: 44 rows by up to 13 columns; the sticky offsets (L10). Unranked domain (`agri`) shows no percentile bins; behaviour is the existing one.

### L14: KPI tiles (M)  [ ] todo
- Goal: tiles per 4.6 when the Country filter resolves to exactly one entity, else the placeholder card "Choose a country to see its key indicators.": indicator tiles (name link with carry, stored `value` formatted with `published_precision` and unit text, reference period and offset flag, percentile chip or state code with sentence, estimate/inherited mark, "Time series" link with `#i` and `#c`; no delta/arrow/rank/colour by direction) and the domain-figure tile for ranked domains (stored `percentile_rank` and label, "n_available of n_defined", position and `low_coverage` per RD C-CTRY-1, allowed two-number scale with both printed and no percent sign; aggregates: the "not ranked" wording). Selection: the `i` indicator first, then the Domain's `indicator_ids` order, at most 8, Frequency applies. Until phase B, `priority` is NOT used.
- Files: `site/src/lib/kpi-model.js`, `site/src/lib/kpi-view.js`, `site/src/style.css`, `site/tests/kpi-model.test.mjs`, `site/tests/smoke/kpi.smoke.mjs`.
- AC-DB: 20, 21; AC-RD-12.
- Verify: `npm test` (selection order, cap 8, no-value row shows state sentence, scan: no change/delta/arrow helpers); smoke on sampled tiles vs scorecard.
- Depends on: L11 (L12 not needed).
- Risks: two stored numbers drawn as a bar must not read as a percentage; both numbers printed (test). A `value` of an inherited row keeps its mark.

### L15: Empty, error and Period states per card (S)  [ ] todo
- Goal: card-level states of amendment section 5: busy block with reserved height, `role="alert"` inside the affected card only, empty card sentence "No values for this selection." with title kept and filter bar kept; apply to L12-L14; Period hiding on C-RANK and C-TABLE shows the ADR-036 hidden-rows disclosure (B-CNT resolved).
- Files: `site/src/lib/state-blocks.js`, `site/src/lib/rank-view.js`, `site/src/lib/heatmap-view.js`, `site/src/lib/kpi-view.js`, `site/tests/state-blocks.test.mjs`, `site/tests/smoke/states.smoke.mjs`.
- AC-DB: 03, 12; AC-RD-14.
- Verify: `npm test`; smoke with route interception: one failed scorecard breaks one card only; filter combination with no rows shows the empty sentence.
- Depends on: L12, L13, L14.
- Risks: a failed scorecard for a domain must not poison the cache for the next Domain change.

**Review gate C** (Opus, read-only): L11-L15 against amendment 4.1, 4.6-4.8, 5, AC-DB-12, 13, 20-24; D6 (no total, mean, count, rank computed); request list; no good/bad colour; the ADR-036 disclosure (count only via `countPeriodHiddenRows`, C-RANK and C-TABLE only).

### Group D - Real-export evaluation (first pass), tables, time series, Browse

### L16: Build and evaluate against the real export (M)  [ ] todo
- Goal: build the site against the real production export (scratchpad path below), measure and record. The export stays OUTSIDE the repository; the committed sparse fixture stays the test input and is not replaced or modified.
  1. `EXPORT_DIR=/private/tmp/claude-501/-Users-oleksandrdzuba-Claude-Personal-macro-monitor/cc4c2854-9434-4237-890a-899946c02ed7/scratchpad/export/data npm run build` in `site/` (`prepare-data.mjs` reads `EXPORT_DIR`; the task confirms the manifest lists every file and report any mismatch; does not edit the export).
  2. Run `npm run measure:pages` pointed at that build (extend `measure-pages.mjs` only if it cannot take a dist/export path; record the identity: manifest build id/date, file counts, entity/indicator/domain counts, total export bytes).
  3. Measure first load of the new home (default state) in gz against 600 KB target / 1.5 MB limit (AC-DB-31, AC-RD-53), the default scorecard size and each domain's scorecard size, `meta/*` size, CSS gz against 20 KB, CLS, one history interaction against 5 MB, build time and `dist` size.
  4. Behaviour checks on real data: default view opens on `agri` (B-DEF), switch Domain, pick one country, Group, Frequency, Period presets; the comparison card with 43 entities; heatmap with real states; a "Load history" for an indicator that has no `series/*.parquet` in this export (expected error state, not a crash); Period hiding on real `ref_period_end` spread (record how many rows each preset hides, as a measurement for the user, not as site output).
  5. Report differences between the sparse fixture and the real export that matter for phase A (units mixed in one indicator, missing aggregates, empty domains, long names).
- Files: `docs/ops/dashboard-layout-measurements.md` (real-export section), `site/scripts/measure-pages.mjs` (only if needed).
- AC-DB: 31, 12, 26; AC-RD-53 (real part; also feeds R24 of the redesign plan if the user accepts this export as the one meant there).
- Verify: numbers with export identity, and a pass/fail table against the budgets; nothing extrapolated; nothing tuned silently.
- Depends on: L15. Re-run in L27 after all cards exist.
- Risks: this export has no committed identity; if the files were not generated from a known build, say so. Do not add the export to git (`site/` must carry no data files, CLAUDE.md). Do not write to neondb or run the exporter; the export already exists.

### L17: Indicator table for the focus country (no Trend column) (M)  [ ] todo
- Goal: band "Indicators" (shown only when exactly one Country is in focus): the RD C-CTRY-3 table for the selected Domain's indicators (columns kept: unit, period, percentile chip, source, state sentence), Frequency and Period applied, "all / only with a value" control, rows without a value last. Reuse `country-view.js` table builder in a card. The Trend column is NOT rendered (phase A; AC-DB-26).
- Files: `site/src/lib/country-view.js` (export the table builder if not already), `site/src/lib/table-card.js`, `site/tests/table-card.test.mjs`, `site/tests/smoke/home.smoke.mjs`.
- AC-DB: 26 (Trend absent, no error), 03; AC-RD-12, 15.
- Verify: `npm test`; smoke on the sparse fixture; PG-COUNTRY output unchanged byte-for-byte for its own table (existing smoke).
- Depends on: L15.
- Risks: duplicating the country table logic instead of reusing it; reviewer checks.

### L18: Time-series card with "Load history" (M)  [ ] todo
- Goal: band "Over time": for 1-5 selected countries and the selected Indicator, the Plot line chart of RD C-SER-4 (tip, end labels with unit, point reader, table alternative) from `series/<indicator_id>.parquet`, loaded only by the explicit "Load history" button (one file per activation; Parquet reader loaded on first activation only); Period clips the x-domain; Frequency picks the series with that stored `frequency`; cap of 5 overlaid lines unchanged.
- Files: `site/src/lib/series-card.js` (reusing `series-chart.js`, `history.js`, `tip.js`), `site/src/style.css`, `site/tests/series-card.test.mjs`, `site/tests/smoke/series-card.smoke.mjs`.
- AC-DB: 12 (no `series/*` before the click), 03; AC-RD-14, 30, 32.
- Verify: `npm test`; smoke with request recording: zero `series/*` requests before the click, exactly one after; failure shows the alert inside the card only; one interaction at most 5 MB gz (recorded in L16/L27).
- Depends on: L15.
- Risks: reusing the explorer code without changing PG-SERIES behaviour; the Parquet reader weight (about 1.8 MB gz) is inside the 5 MB rule, outside the landing budget.

### L19: Small multiples, phase A (M)  [x] done
- Goal: with no Country selected, the same card shows one facet per entity of the comparison set (Plot facets, shared y-axis and unit, entity-name title, latest stored value as label), at most 12 facets, "Show more" adds the next 12 (no count printed), facets ordered by the C-RANK sort; data from the Parquet file after "Load history". Point reader reaches each facet's values. Without `recent` arrays this is the only source (AC-DB-26).
- Files: `site/src/lib/small-multiples.js`, `site/src/lib/series-card.js`, `site/tests/small-multiples.test.mjs`, `site/tests/smoke/series-card.smoke.mjs`.
- AC-DB: 27, 26; AC-UX-6 for 12 facets at 320 px.
- Verify: `npm test`; smoke on 44 entities: 12 facets, "Show more" adds the next block, shared axis, keyboard reader.
- Depends on: L18.
- Risks: 12 Plot instances cost render time; measured in L27. Entities without data in the file get a facet with the state sentence, not dropped.

### L20: Bars toggle for one series (S)  [x] done
- Goal: radio group "Lines" / "Bars" shown only when exactly one series is selected (card and PG-SERIES): `barY` of stored period values, estimate bars hollow outline, unit on axis; table alternative has identical rows in both views.
- Files: `site/src/lib/series-chart.js`, `site/src/lib/series-card.js`, `site/src/explorer.md`, `site/tests/series-chart.test.mjs`, `site/tests/smoke/series.smoke.mjs`.
- AC-DB: 28; AC-RD-30.
- Verify: `npm test`; smoke: toggle hidden with 2+ series, bars equal table values.
- Depends on: L18.
- Risks: the toggle on PG-SERIES must not change its hash grammar (chart type is not in the hash).

**Review gate D** (Opus, read-only): L16-L20 against amendment 4.9 (phase A), 4.10, AC-DB-12, 26-28, 31; check the L16 record has the export identity and no extrapolated figure; the committed fixture is unchanged; no data file added to the repository.

### Group E - Bar and cards on the other pages

### L21: PG-SERIES filter bar (M)  [ ] todo
- Goal: add Domain, Frequency, Period to the bar on the explorer page driving the same indicator picker, year range and series list; Group not shown; left rail controls (C-SER-1) stay; hash reading keeps `g` ignored.
- Files: `site/src/explorer.md`, `site/src/lib/explorer-view.js`, `site/tests/explorer.test.mjs`, `site/tests/smoke/series.smoke.mjs`.
- AC-DB: 01, 02, 03; AC-RD-31, 34.
- Verify: `npm test`; `npm run smoke`; existing explorer tests green or retargeted to the spec, not the other way.
- Depends on: L10, L20.
- Risks: two controls for the same thing (rail years vs Period chip) must stay in sync; one state only.

### L22: PG-COUNTRY arrangement (M)  [ ] todo
- Goal: per 4.2: header card (name `h1`, groups, kind, bar with Country switcher with explicit "Go" button, Domain, Period, Frequency), bands per domain in `meta/domains.json` order, domain-figure tile (span 4), dot strip (span 8), table card; `data-carry` links. No Trend column.
- Files: `site/src/country/*.md` (via the existing template/generation form), `site/src/lib/country-view.js`, `site/src/style.css`, `site/tests/country-view.test.mjs`, `site/tests/smoke/country.smoke.mjs`.
- AC-DB: 01, 11, 20 (tile part), 21; AC-RD-10..15.
- Verify: `npm test`; `npm run build` lists the same pages; smoke.
- Depends on: L14, L17.
- Risks: PG-COUNTRY first load may grow; measured in L27 (CR-4 is the redesign plan's remedy, not built here).

### L23: PG-INDICATOR arrangement (M)  [ ] todo
- Goal: per 4.3: header card, bands "Compare" (C-RANK card with value chart and the dot plot beside it) and "Table" (RD C-IND-5 with the Reference rows group); peer group and sort move into the bar (Group) and card header (sort); indicator switcher with "Go".
- Files: `site/src/indicator/*.md` (template form), `site/src/lib/indicator-view.js`, `site/tests/indicator-view.test.mjs`, `site/tests/smoke/indicator.smoke.mjs`.
- AC-DB: 01, 22, 23; AC-RD-20..25.
- Verify: `npm test`; `npm run smoke`.
- Depends on: L12, L10.
- Risks: the redesign's `peers` filter note must stay verbatim.

### L24: PG-DOMAIN, PG-DOMAINS, PG-REVISIONS surface (S)  [ ] todo
- Goal: PG-DOMAIN heatmap card under a band with the bar (Group, Frequency); PG-DOMAINS as a card grid (name, `notices[]`, link); PG-REVISIONS gets only canvas, band and card surface.
- Files: `site/src/domain/*.md`, `site/src/domains.md`, `site/src/revisions.md`, `site/src/lib/domains-list.js`, `site/tests/domains-list.test.mjs`, `site/tests/smoke/ux.smoke.mjs`.
- AC-DB: 01, 10, 11.
- Verify: `npm test`; `npm run smoke`; revisions content unchanged.
- Depends on: L13.
- Risks: none identified.

**Review gate E** (Opus, read-only): L21-L24 against amendment 2.4, 4.2-4.5 and the redesign spec sections they keep.

### Group F - Sweep and final measurement

### L25: Accessibility, print and responsive sweep (M)  [ ] todo
- Goal: AC-UX-1 to 9 and AC-RD-54 re-run on every changed page type; fix defects within `site/`; headings (one `h1`, bands `h2`, card titles `h3`, no skips); keyboard pass of bar chips and C-RANK; print filters line; 320 px no horizontal scroll; manual list for the user.
- Files: `site/scripts/contrast-pairs.mjs`, `site/tests/smoke/ux.smoke.mjs`, `site/tests/smoke/ux-support.mjs`, `site/src/style.css`, `docs/ops/dashboard-layout-measurements.md`.
- AC-DB: 04, 05, 06, 10, 11, 33.
- Verify: `npm run check:contrast`; `npm run smoke`; manual items listed, not claimed.
- Depends on: L24.
- Risks: Chromium emulation only; screen reader pass of the bar and C-RANK, Firefox, Safari and a real print dialog are manual and recorded in `docs/ops/` by the user (AC-DB-33).

### L26: Static scans, copy and constraints (S)  [ ] todo
- Goal: scans over all new modules: no total/average/sum helper or "Total" label, no count of entities (sole exception: `countPeriodHiddenRows`, ADR-036), no banned words, no hard-coded colour, no off-origin URL in `dist/`, no new dependency in `package.json`, allow-list prose scan with seeded negatives, every amendment section 7 string present and DRAFT.
- Files: `site/tests/ux-static.test.mjs`, `site/tests/ux-style-scan.test.mjs`, `site/tests/prose-scan.test.mjs`, `site/tests/copy.test.mjs`, `site/scripts/check-npm-imports.mjs` (only if the new modules need registering).
- AC-DB: 22, 30, 32, 34, 35.
- Verify: `npm test`; `npm run check:imports`; `npm run build`.
- Depends on: L24.
- Risks: scans that pass because a module is not listed; each new module is added in its own task, this task audits the list.

### L27: Final measurement (fixtures and real export) (S)  [ ] todo
- Goal: re-run L16 on the finished phase A build (sparse fixture and the real export): first-load of home (default and after a Domain change), PG-COUNTRY (worst page over the 44 entities), PG-INDICATOR, PG-SERIES, history interaction, CSS gz (decision for the user if over 20 KB, B-CSS), CLS, build time with all pages, request lists. Record in the measurements doc with identity. If a page exceeds a limit, report; do not tune silently.
- Files: `docs/ops/dashboard-layout-measurements.md`.
- AC-DB: 31, 12; AC-RD-53.
- Verify: numbers table vs budgets, export identity.
- Depends on: L25, L26.
- Risks: if the real export is replaced by a newer one, numbers are not comparable; record the identity.

**Review gate F** (Opus, read-only): L25-L27 against AC-DB-31, 33; no extrapolated numbers; open manual items listed. Phase A is then complete and reported to the user; phase B stays gated.

## 5. Phase B: gated, NOT startable (no tasks may begin)

Phase B changes `src/` (export code), `config/` and the export spec. Per CLAUDE.md these need an approved design first, and an export change outside the approved docs is forbidden (AC-DB-35). They are listed so the user can see the dependency chain; none is a task yet.

### 5.1 Design-doc updates required first (the architect writes them, the user approves; the planner and data-engineer do not)
Amendment section 11 lists the documents. Those needed before phase B, with the author and the gap I found:

| # | Document | Required change | By | Note |
|---|---|---|---|---|
| 1 | `docs/specs/dashboard-export-spec.md` | CR-1: section 5 scorecard row gains nullable `recent {n, end, v[]}` (at most 12, latest vintage as of `known_cutoff`, `value` column, null for missing period); section 3 minor schema bump; section 8 budget; EXP/AC entries and a golden-file test statement (section 11 item 5). CR-2: `headline` flag in section 4 `meta/indicators.json` | macro-data-architect | Item 5 in amendment section 11 covers only CR-1; CR-2 export text is missing (B-CR2) |
| 2 | `docs/specs/dashboard-layout-amendment.md` section 9 | Add CR-2 with an unused id and a field name that does not collide with `role = 'headline'` / "headline series" (B-CR2); mark CR-1 status after the user's approval (B-CR1) | macro-data-architect | Not in the amendment section 11 list |
| 3 | Registry/config schema docs: `docs/specs/indicator-parameters-spec.md` and `docs/design/adr/ADR-014-indicator-parameter-defaults-and-overrides.md` (field list, defaults, "no default" set) and, if the flag is stored, `docs/specs/ddl-neon-schema.md` | Define the config key in `config/indicators.yaml`, its default, validation, and whether it is stored in `ref.*` or read from config at export | macro-data-architect | NOT in amendment section 11; which doc holds the registry schema and whether a migration is needed is UNVERIFIED (I did not read them in full). A new/updated ADR is needed if it is a design decision |
| 4 | `docs/design/adr/ADR-030-...`, `docs/specs/dashboard-redesign-spec.md`, `ADR-025`, `ADR-026` | Items 1-4 of amendment section 11, status reset of the redesign spec per its rule | macro-data-architect | Needed before any change to hash/allow-list/strings is called done; B-DOC |
| 5 | `docs/design/briefs/dashboard-ux-brief.md`, `docs/ops/dashboard-ux-baseline.md` | Items 6 | macro-data-architect (`docs/ops` could also be data-engineer) | Not a blocker for code |
| 6 | `docs/ops/dashboard-redesign-decisions.md` | Item 7: CR-1 priority line; the user's answers to Q1-Q8 | macro-data-architect or the user | Record only |
| 7 | `docs/plans/` | Item 8: this file | planner (done by this document) | Not edited by the architect |

### 5.2 Phase B work, waiting (outline only)
| Ref | What | Files (indicative) | Waits for |
|---|---|---|---|
| PB-1 (CR-1 export) | Add `recent` to scorecard rows by slicing the published series; JSON Schema; golden file; unit tests; budget check. A `db` test only on a throwaway database on the configured Neon branch, never neondb or postgres | `src/macro_monitor/publish/scorecard.py` (uncommitted changes exist in the working tree; rebase on them), export JSON Schemas, `tests/unit/`, `tests/fixtures/golden/` | 5.1 rows 1-2 approved; B-CR1 |
| PB-2 (CR-2 config + export) | Add the headline flag to `config/indicators.yaml`, validate in `registry/sync.py`, emit in `meta/indicators.json` | `config/indicators.yaml` (uncommitted changes exist), `src/macro_monitor/registry/sync.py`, `publish/meta.py`, tests; a migration only if the design stores it, applied to neondb only on the user's explicit request | 5.1 rows 1-3 approved; B-Q4, B-CR2 |
| PB-3 (site) | Sparkline module (d3 `scaleLinear`/`line`, 96 x 24 px, latest dot, hollow estimate, break on null, shared text function for the accessible name, Period clip, "Too few values..." cell), Trend column in L17/L22/L23, sparkline in KPI tiles, small multiples from arrays (no Parquet), tile selection by the flag | `site/src/lib/sparkline.js`, views, tests, fixture with `recent` | PB-1, PB-2 |
| PB-4 (weight) | Record added scorecard bytes per domain against the estimate (about 37 KB per domain uncompressed, UNVERIFIED) and re-measure the home | `docs/ops/dashboard-layout-measurements.md` | PB-1, PB-3 |

If CR-1 is not approved or exceeds its weight budget, phase A stays as built (ADR-034 option 5c); nothing else changes.

## 6. Order summary
A (L1-L5 foundations) -> gate A -> B (L6-L10 filter bar, with the reactive proof first) -> gate B -> C (L11-L15 home cards) -> gate C -> D (L16 first real-export pass, L17-L20 table, series card, small multiples, bars) -> gate D -> E (L21-L24 other pages) -> gate E -> F (L25-L27 sweep, scans, final measurement) -> gate F -> phase B only after section 5.1 is done.

## 7. Test and review checklist
ruff and mypy do not apply to phase A (no Python file touched). The orchestrator re-runs these itself in `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/site/`:
1. `npm test`
2. `npm run check:imports`
3. `npm run check:contrast`
4. `npm run build` (fixture export; for L16/L27 also with `EXPORT_DIR` set to the real export path)
5. `npm run smoke`
6. `npm run measure:landing` and `npm run measure:pages`
7. `git diff --stat`: no change in `src/`, `config/`, `docs/design/`, `docs/specs/`, export schemas; no new `package.json` dependency; no data file under `site/` (AC-DB-30, 35).
Phase B tasks, when released, add `ruff check`, `ruff format --check`, `mypy --strict src`, `pytest` (unit) and `pytest -m db` on a throwaway database.
Opus review per group: ADR-034, amendment, ADR-025/026/030, redesign spec, this plan; D6 (no computation in the browser), data-only rule, no good/bad colour, DRAFT strings marked, state honest about anything unverified.

## 8. Manual items outside automation
Screen reader pass of the filter bar and C-RANK, Firefox and Safari visual check, real print dialog, Windows high-contrast (AC-DB-33). The user's validation of the new dashboard against J1-J3 (redesign plan R25) is still pending the user and is not changed here.

## 9. Risks and unknowns
- Reactive wiring of the filter store to Framework 1.13.4 cells is UNVERIFIED (L6 proves it first; failure stops the plan).
- Home content is blank without JS by design; only the notice and "Browse" lists exist in HTML.
- CSS headroom is about 8.5 KB gz on a 20 KB budget; measured only in L2 onwards.
- 44-row cards (heatmap, ranked bars) and 12 facets are untested at scale; sticky offsets are the main accessibility risk.
- The first domain by `meta/domains.json` is unranked in the real export (B-DEF).
- The real export differs from ADR-034's description (43 vs 44 entities, 12 series files) and has no recorded identity (B-EXP).
- Browser evidence is Chromium emulation only.

## 10. Summary
27 phase A tasks (L1-L27) in six groups with six Opus review gates; phase B (CR-1, CR-2) is listed as four gated outlines, not tasks. Nothing is approved.

Open questions for the user:
1. B-DOC: may phase A start before the architect's doc sync (amendment section 11), and does the redesign spec's "reset to draft" block phase 4?
2. B-CNT: resolved by ADR-036 (approved 2026-11-10).
3. B-SCOPE: resolved (user confirmed the Country chip with checkbox list, up to 5; 2026-11-10).
4. B-Q4 / B-CR2: confirm the configured `headline` flag, and ask the architect to restate it with a non-colliding id and field name, plus its registry-schema doc updates.
5. B-H1: home `h1` wording (the current "Country scorecards" no longer fits); who proposes it?
6. B-DEF: accept opening on `agri` (unranked) or reorder domains (CR-9)?
7. B-EXP: what should the scratchpad export contain (43 vs 44 entities, only 12 series files), and may it be used as the R24 real-export measurement of the redesign plan?
