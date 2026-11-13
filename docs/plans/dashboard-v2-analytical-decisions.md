---
status: proposed
date: 2026-11-13
author: Opus (decision-maker under the user's delegation of 2026-11-13)
applies_to: docs/plans/dashboard-v2-analytical-implementation-plan.md (approved 2026-11-13)
related: docs/specs/dashboard-v2-analytical-spec.md, ADR-036, ADR-037, docs/plans/dashboard-v2-analytical-coverage-42.md (data coverage, separate)
---

# Dashboard v2: decisions on the plan's open questions

The user delegated: "Opus decides how we proceed on the recommendations, so the dashboard looks like the references and contains information for all 42 countries". This file records those decisions. The user may override any of them. Nothing here approves a CR, an ADR amendment or a document, and nothing marks a Ukrainian string or name `reviewed`; those gates stay with the user. Data coverage for the 42 countries is out of scope here (see the coverage-42 plan).

Where a decision needs a design-document change, it is listed under "Architect errata requested". Each erratum is a small, `proposed` edit to the ADR or spec, and the user approves it before the task that depends on it starts (CLAUDE.md gating).

## 1. Decisions

### D-1 (OQ-16) Header navigation set
- Decision: the header `nav` holds the six pages of spec section 2: Home, Country, Compare, Time series, Domains, Revisions. AC-RD-01 and the G-STR4 "exactly four pages" test are updated to these six. The tests are not kept at four and are not worked around. The language switch stays outside the `nav` landmark (A2.6 item 2), so the language link is never counted as a page.
- Rationale: the approved v2 spec is newer than AC-RD-01 and is the source of truth. ADR-037 A2.6 item 2 already names the conflict and leaves it to the plan.
- Tasks: V8 (test change), V26 (page-set and link-integrity tests), V46 (switch placement), V65.
- Architect erratum E-1: one line in ADR-037 Amendment 2 (A2.6 item 2) recording that AC-RD-01/G-STR4 now read "six pages per spec section 2".

### D-2 (OQ-17) Shapefile to GeoJSON without a new dependency
- Facts checked 2026-11-13 on this machine: there is no `ogr2ogr`, no `mapshaper` and no Python `pyshp`. A system-tool route is therefore not available without installing something.
- Decision: a one-off, reproducible conversion whose output is committed as a static asset with provenance. It is not a step of the site build.
  - `site/scripts/prepare-geo.mjs` is plain Node, with no npm package. It has a minimal self-written reader for exactly what Natural Earth admin-0 needs: `.shp` shape type 5 (Polygon, multi-part rings) and `.dbf` dBase III fixed-width fields, reading only the ISO and name fields it needs. It clips to the Europe extent, drops overseas parts, rounds coordinates to 2 decimals and removes consecutive duplicate points after rounding. It takes input and output paths as arguments.
  - The data-engineer runs it once, locally, on the file that the user placed (or downloaded at the user's request) in its own empty directory, treated as untrusted. The commit contains only `site/src/geo/europe-countries.geojson` and `site/src/geo/geo-source.json`. `geo-source.json` holds: source URL, Natural Earth version, access date, licence "public domain", the input file name and its SHA-256, the script path and its git commit, the rounding and clip parameters, and `crimea_checked_by_user: null` with its date null.
  - `npm run build` reads only the committed GeoJSON, so CI never needs the shapefile. `site/tests/prepare-geo.test.mjs` tests the reader on a small synthetic shapefile, which keeps the conversion reproducible and reviewable.
  - Shortcut [UNVERIFIED]: the Natural Earth vector repository may also publish GeoJSON forms. If a GeoJSON form of the Ukraine point-of-view (`ukr`) variant exists from the official source, the script accepts it as input and skips the shp/dbf reader. The provenance fields stay the same.
  - Budget fallback order: 1:50m rounded. If it is over 100 KB gzipped, use 1:110m `ukr` and record both numbers. GISCO is not used (its terms are not confirmed). Patching geometry for Crimea remains the user's decision (G-CRIMEA).
- Rationale: this needs no new dependency, so ADR-023/024 and CLAUDE.md are untouched (no npm package, no secrets, raw input not committed). The asset is static, and provenance is stored with it, in the same spirit as the immutable raw data rule. A build step would add an input to CI that the repository must not contain.
- Tasks: V50 (split it if the reader exceeds M: V50a reader plus tests, V50b clip/round/provenance), V51, V52, V54, V60. Gate G-GEO-FILE: ask the user now to place the `ukr` admin-0 file, so V50 is not on the critical path.

### D-3 (OQ-18) Two meanings of "CR-22"
- Decision: neither meaning keeps the bare label "CR-22".
  - WEO data ingestion (spec section 8 table) becomes **ING-WEO** ("WEO ingestion"). It is an ingestion step, not an export change request, so it leaves the CR series.
  - Optional export-side Ukrainian names (A2.1) become **CR-23 (uk names)**. CR-23 is unused in the spec (checked 2026-11-13).
- Rationale: an ingestion step is not an export CR, so taking it out of the CR numbering removes the category error as well as the clash.
- Tasks: V30 and Group G wording (ING-WEO), V48 and gate G-CR23 (renamed G-CR23).
- Architect erratum E-2: rename in the spec (section 8 table, A2.1) and in the plan's gates table. Status stays NOT approved for both.

### D-4 (OQ-19) Map and second-tree weight
- Decision: the 100 KB gzipped geometry budget is accepted as the development target. It is measured once in V50 (asset size) and again in V60 (Home after settle, Compare with C6). The two-tree `dist` is acceptable while the Pages artifact stays well under the GitHub Pages published-site limit (1 GB, per GitHub Pages documentation; re-check the link when V65 records it) and the per-language build adds no more than 2x the current single-tree build time. V65 records the actual `dist` size, build time per tree and the comparison. Above either bound, V65 stops and reports (no silent trimming).
- Tasks: V50, V60, V65, V42.

### D-5 (OQ-20) `hreflang` alternate links in `head`
- Decision: V46 first checks whether Framework 1.13.4's `head` config option can produce per-page output (a function of the page path) [UNVERIFIED]. If it can, emit `<link rel="alternate" hreflang="uk|en|x-default">` there. If it cannot, add the alternate links in the same post-build HTML step as V43 (`<html lang>`), which is already the approved mechanism for per-tree HTML edits. Neither path adds a dependency. The header link carries `hreflang` either way.
- Tasks: V46, V43 (if the fallback is used), V49 (scan both trees for the links).

### D-6 (OQ-21) Country names via `Intl.DisplayNames`
- Decision: country names are proposed from `Intl.DisplayNames(['uk'], {type: 'region'})` keyed by ISO2. The ISO3-to-ISO2 join is a committed static table in `site/src/lib/` covering exactly the entities in `meta/entities.json`. It is not computed and has no dependency. V47 adds a unit test that runs on the pinned Node 20 and asserts that each of the 42 ranked countries gets a non-empty name differing from the English one. Any miss is listed in the review sheet with an empty proposal. Aggregates (EA, WLD, EU27 and so on) are hand-proposed, not taken from Intl. Every entry is `proposed`, and only the user sets `reviewed`.
- When verified: in V47, on the CI Node version (the same pin as the build). The result goes into the V47 i18n report.
- Tasks: V47, V44.

### D-7 (V11 stale contradiction: spec K1 vs ADR-037 A1.4/decision-4 reading)
- Finding: spec section 3 K1 says "staleness is a marker, not a reason to hide, because K1 is a series-currency view". ADR-037 (line ~98) says "C2, C3, P1 strip, K1 unchanged (hidden by default ...)", and its A1.4 list (line ~114) includes K1 among charts "where staleness hides". The word "unchanged" shows that the ADR meant to keep K1's existing spec behaviour, and that behaviour is "marker, not hidden". Listing K1 under hiding is therefore an erratum.
- Decision: K1 cards, and the Home KPI strip that reuses them, draw stale cards with the stale marker and the period. The `stale` hide category never applies to K1. Cards without a value still go to the disclosure (`no_data`). `oth` does not apply to K1.
- Rationale: this follows the spec's explicit component rule and the ADR's own "unchanged". It also serves the 42-country goal, because hiding stale cards would empty KPI rows for countries with lagging releases.
- Tasks: V11, V57, Review gate C (check this item explicitly).
- Architect erratum E-3: drop K1 from the ADR-037 decision-4 reading and the A1.4 "where staleness hides" list. V11 starts after the user approves E-3. If E-3 is declined, V11 follows the ADR text as written.

### D-8 (OQ-12) K1 sparkline
- Decision: the plan default stands. V11 ships without a sparkline. V11b is not scheduled until V27 and V60 have measured, and it runs only if the Country interaction stays at or below 5 MB gzipped with the extra Parquet loads. The preferred long-term route is CR-16 (stored recent-values array), whose approval belongs to the user; I recommend it to the user once the coverage plan settles. The Home KPI strip never has a sparkline (A2.3).
- Tasks: V11, V11b, V27, V32.

### D-9 (OQ-14) Peer groups G20 and EU27
- Decision: there is no phase-1 effect. The fixture `meta/groups.json` has `euro_area, g7, advanced, emerging, non_euro_eu` (read 2026-11-13), with no G20 and no EU27. The Group control and the P1b legend list only groups present in `meta/groups.json`, and no group is hard-coded. Presence in the real export is verified in V30 by reading the real `meta/groups.json`. If they are missing and wanted, they become an export request for the user to decide.
- Tasks: V17 (control lists stored groups only), V33, V30.

### D-10 (OQ-15) Plot 0.6.18 marks
- Decision: V1 runs first and decides. These fallbacks are pre-approved for development so that a failed probe does not block. Each fallback is recorded in V1's notes and re-checked at the Opus review of V1.
  - `cell` fails: use `rect`/`barX` with band scales for C4.
  - `areaY` fails: use `lineY` only (no band in phase 1 anyway).
  - `tip`/`pointer` fail: no hover. The "View as table" alternative carries the values (it is required anyway).
  - `selectLast` fails: pre-select the last stored row in the model (a select, not a computation).
  - `facet` fails: one Plot per panel (small multiples by loop).
  - `Plot.geo` fails: draw inline SVG paths with `d3.geoPath` (d3 is already a Framework-bundled import, so nothing new; confirm with `check:imports`).
  - SVG pattern fill fails: inject a `<defs><pattern>` into the returned SVG and reference it by `fill="url(#...)"`.
  - The point reader is not required for the new charts. The table alternative covers keyboard access (V24 confirms).
- Tasks: V1, V12, V18, V21, V53, V24.

### D-11 Quarter label forms
- Decision: en "Q1 2024" and uk "1 кв. 2024" are accepted for development and tests. They stay `proposed` in the dictionaries. The user reviews them before release (G-LANG-STR), and a change later is one dictionary edit plus snapshot updates.
- Tasks: V44, V45.

### D-12 Home constants (G-HOME-CONST; proposed, the user confirms)
Values checked against `config/indicators.yaml` and `site/src/data/meta/*.json` on 2026-11-13:

| Constant | Proposed value | Check |
|---|---|---|
| `HOME_DEFAULT_INDICATOR` | `A05` Gross government debt, % of GDP (annual, domain `fiscal`) | decided by the user 2026-11-13 (changed from M09): configured for all 42 countries (World Bank/WEO); must be added to the fixture (V7/V66); M09 stays selectable in Compare |
| `HOME_KPI_ENTITY` | `EA` | fixture aggregate present; fallback first aggregate |
| `HOME_KPI_IDS` | `M09, M10, M11, P01, A01, M18` | all six in the fixture `meta/indicators.json`, and M09, M10, M11, M18, A01 in `config/indicators.yaml` with the same ids. `B01` is excluded (global domain, not meaningful for EA). |
| `HOME_HIGHLIGHT` | `DEU, FRA, ITA, ESP, POL` | DEU, FRA, ITA, POL are in the fixture. ESP is not, so on the fixture it resolves to the disclosure, which exercises the missing-id path (AC-V2-121). |

- Note: the fixture ids equal the config ids, so the plan's V56 risk "fixture ids are not the real ids" is smaller than stated. Real coverage is the coverage-42 plan's concern.
- Tasks: V56, V57, V58.

### D-13 Other open points found
- O-1 Fixture density, for the "looks like the references" goal: V7 adds, alongside the plan's cases, a dense synthetic variant listing the 42 ranked entity ids (the list the coverage-42 plan fixes). It has values for the Home and Compare indicators, so the ranked bar, map and heatmap show a realistic number of rows on the fixture. It is labelled synthetic, as is the rest of the fixture, and it lives under `site/tests/fixtures/` only (no production data, no ingestion). Tasks: V7, V19, V21, V53, V58.
- O-2 G-DEPLOY: V42's build part (two trees in `dist/`) proceeds. The workflow part waits for the user's scope approval. There is no dispatch and no push.
- O-3 CR-5 and CR-6 stay NOT approved. I repeat the plan's recommendation that the user consider CR-5 first (unit text for C1/C3 axes). V35 and V61 stay gated.
- O-4 Theme: light only (A2.6 item 3, resolved by the user). V62 is a scan and contrast task, so it can run at any time after its dependencies. The existing light tokens already give the light look.

## 2. Execution order: first 10 `/implement` tasks

Goal: show the reference look (KPI strip, ranked bar, line, heatmap, map, uk/en, light theme) on the fixture as early as the dependency graph allows. Each task runs as `data-engineer` with `model: sonnet`. A read-only Opus review (`model: opus`) runs after each task before it is reported done. The orchestrator re-runs `npm test`, `npm run smoke` and (when Python is touched) ruff, mypy and the unit tests itself.

| # | Task | Why now |
|---|---|---|
| 1 | V1 Plot smoke probe (incl. `geo`, pattern) | Fixes D-10 fallbacks before any chart is built |
| 2 | V7 fixture extension + dense 42-entity variant (O-1) | Every chart and test reads it |
| 3 | V4 hidden-rows model | Needed by every chart |
| 4 | V5 caption block | Needed by every chart (S; can share a session with 5 and 6) |
| 5 | V2 hash extension | Unblocks V8/V17 |
| 6 | V3 compatibility module | Unblocks C1/C2 |
| 7 | V64 country list page | V8 depends on it (S) |
| 8 | V8 mode switch, six-item nav (D-1), PG-COMPARE | First visible new shell |
| 9 | V9 country picker | Unblocks V17 |
| 10 | V17 Compare controls | Unblocks all Compare charts |

Next, in order: V15, V19 (ranked bar), V18 (line), V21 (heatmap), V11 (K1, after E-3), V56, V57 (KPI strip), V42, V44, V43, V46 (uk/en visible), V50 to V53 (map, when the geometry file is placed), V58 (Home four panels), V62 (light-theme scan), then the remaining groups per the plan. Ask the user now, in parallel, for the G-GEO-FILE placement and the E-1 to E-3 errata approval, so neither blocks the sequence.

## 3. Architect errata requested (proposed; the user approves)
- E-1: ADR-037 A2.6 item 2, nav set = six pages of spec section 2 (D-1).
- E-2: rename WEO ingestion to ING-WEO and Ukrainian names to CR-23 in the spec and the plan's gates (D-3).
- E-3: remove K1 from the "staleness hides" list in ADR-037 (decision-4 reading and the A1.4 category list) (D-7).
