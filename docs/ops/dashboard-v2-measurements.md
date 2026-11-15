# Dashboard v2 measurements (V27)

Fixture only; the real export is not used here (G-REAL). Fixture numbers understate a real export; nothing is extrapolated.

## Run 2026-11-14 (V27)
Re-run after Opus review fixes (settle until the response count is stable, closed `<details>` only, failed clicks not counted): same results; Country 7 clicks measured, heaviest 19,688 B gz; home 372,099, country 389,907, compare 383,372, indicator 470,752 B gz (others unchanged within 3 B).
- Fixture: `site/tests/fixtures/v2_export`, `build_id` synthetic-v2-fixture. Build: `EXPORT_DIR=site/tests/fixtures/v2_export npm run build`, 7 s wall (one tree). `dist` 4,469,565 B raw.
- Command: `node scripts/measure-pages.mjs --build-seconds=7` (Node v26.13.1; `.nvmrc` says 20.18.1, so re-run on 20 before sign-off). Chromium via Playwright, gzip level 9 computed locally.
- Script change: new `compare` page type, and per-page heaviest interaction (Country: every country page, clicks on `details.mm-l1 > summary`, `data-action="more"`, `data-action="expand"`, `data-history`; Compare: `data-action="more"`, `data-action="expand"`, `data-history`). Row `interaction:<page>` has the 5,000,000 B gz limit and is hard (AC-V2-40). A page with no matching control prints N/A, never zero.

| Page type | First load B gz (limit 600,000 / hard 1,500,000) | CSS B gz (limit 20,000) | CLS (limit 0.1) | Worst page |
|---|---|---|---|---|
| home | 372,008 | 14,476 | 0.0014 | / |
| country (44) | 389,910 | 14,476 | 0.0198 | DNK |
| compare | 383,375 | 14,476 | 0.0130 | compare |
| indicator (15) | 470,753 | 14,476 | 0 | A05 |
| series (explorer) | 310,114 page-own; reader plus series file 5,402 | 14,476 | 0.0092 | explorer |
| domains | 59,425 | 14,476 | 0.0038 | domains |
| revisions | 281,319 | 14,476 | 0.0020 | revisions |

Interactions (limit 5,000,000 B gz, hard):
- Country: 6 clicks measured on AUT; heaviest 19,688 B gz (`details.mm-l1 > summary`, third match); all clicks together 19,688 B gz. The history interaction (fiscal-A04 on AUS) added 0 files: the fixture series file was already loaded on first load.
- Compare: not measured. No control on `/compare` matched the selectors (N/A). The Compare mode's own interactions need a selector from the page owner (open item).

All measured targets PASS (hard limits included); the Compare interaction is N/A. Result is for the fixture only.

## Run 2026-11-15 (V60: Home and map weight)
Recorded, not tuned. Fixture `site/tests/fixtures/v2_export`, `build_id` synthetic-v2-fixture, `EXPORT_DIR=site/tests/fixtures/v2_export npm run build` (8 s wall, one tree), `dist` 4,492,136 B raw. Command: `node scripts/measure-pages.mjs --build-seconds=8` (Node v26.13.1; `.nvmrc` says 20.18.1, so re-run on 20 before sign-off). Chromium via Playwright, gzip level 9 computed locally. Branch state: V57 KPI strip, V58 four panels, V59 layout on top of V56.
- Script change: `measure-pages.mjs` splits the Home first load by path into landing and deferred (`homeParts` in `scripts/lib.mjs`): deferred = series files, the Parquet reader and the map shapes with their join table (read by the panels after the `load` event, checked by the Home smoke); landing = everything else (HTML, CSS, JS, meta, the scorecards of the KPI strip and of the default Indicator). It also records the map geometry asset alone and the heaviest Home interaction (choosing up to 4 other Indicators in the Home control, bytes added each time).

| Home measure | Value | Limit | Status |
|---|---|---|---|
| First load, all requests (the old row) | 520,882 B gz | 600,000 target / 1,500,000 hard | PASS (was 372,008 B before the panels) |
| Landing, before the deferred load | 433,747 B gz in 126 files | 600,000 target / 1,500,000 hard (AC-RD-53) | PASS |
| Deferred load (series file, map shapes, join) | 87,135 B gz in 3 files | 5,000,000 (AC-V2-40) | PASS |
| Map geometry asset alone | 75,223 B gz | 100,000 budget (OQ-19, proposed) | PASS |
| Heaviest Home interaction | 7,274 B gz (Indicator M11; 4 tried, 23,737 B gz together) | 5,000,000 (AC-V2-40) | PASS |
| CSS | 14,791 B gz | 20,000 | PASS (+315 B for the Home rules) |
| CLS | 0.0014 | 0.1 | PASS |

Reading the numbers: the landing grew by about 62 KB gz over the earlier Home (372 KB) because the Home page now imports the Compare chart modules and Plot-based bodies; the scorecards of the KPI strip add the labour, prices, agri and fiscal files. The fixture series are JSON, so the Parquet reader (parquet-wasm, Arrow) does not appear in the deferred figure (reader and series 11,354 B gz are the series file and shapes only); on a real export the deferred load includes the reader and a Parquet series file. The geometry measured here is the repository's `site/src/geo/europe-countries.geojson` (the same file in every export). Fixture numbers understate a real export (G-REAL); a landing breach on the real export is the user's decision (for example drop the KPI strip scorecards or the geometry from landing), not a silent change.

Other types in the same run: country (44) worst DNK 390,574, compare 384,690, indicator (15) worst A05 472,070, series (explorer) 316,151 page-own, domains 60,013, revisions 281,932 B gz; Country heaviest interaction 19,688 B gz; Compare interaction N/A (no matching control).

Findings while measuring: C2 drew its value labels with a per-row `dx` and `textAnchor` function, which Plot 0.6.18 treats as constants (`translate(NaN, ...)` console errors on every indicator page with a drawn bar chart, A05 included). Fixed in `bar-list.js` (one constant-offset label mark; the label of a bar below zero sits right of the zero rule).

## Not covered here
- Home four-panel layout and map weight: see the 2026-11-15 run above (fixture only).
- Second language tree weight and build time (V65); `build:all` was not re-timed in this run.
- Real export (V30, gated on G-REAL, G-WEO). Note: decisions file records real-export first loads over the 1.5 MB hard limit for CZE (country) and M07 (indicator) on `/private/tmp/mm-export`; the fixture does not show that.
- The CLS estimate for `--fbar-mode` (decisions file, mode-switch reserve): fixture CLS stays at or below 0.0198 on every page type.

## V65 sweep over both trees (2026-11-15, merged branch, fixture only)
- Build: `EXPORT_DIR=site/tests/fixtures/v2_export npm run build:all`, 17 s wall for both trees plus merge. `dist` 4,996 KB, `dist-uk` 5,052 KB, merged `dist-site` 10,048 KB (`du -sk`). English `<html lang="en">`, Ukrainian `<html lang="uk">` (checked on `dist-site/index.html` and `dist-site/uk/index.html`). `dist-uk/i18n-report.json` is written.
- `measure-pages.mjs` run on the merged `dist-site` (English paths at `/`): home first load 541,388 B gz, country 411,109, compare 405,223, indicator 492,608, domains 80,587, revisions 302,491; all under the 600,000 target. Home landing 454,253 B gz in 129 files, deferred load 87,135 B gz in 3 files; map geometry 75,223 B gz (budget 100 KB); heaviest Home interaction 7,274 B gz; heaviest Country interaction 19,688 B gz; Compare interaction N/A (no control matched). The Ukrainian tree was not measured separately (its pages are the same code with English text), so no per-tree weight number is claimed.
- Not run: browser smoke for both trees (the i18n session reported `browser.smoke.mjs` failures that are also on clean HEAD; not compared to a baseline); Node 20.18.1 (not installed); real export (G-REAL).

## V30 real-export run (2026-11-15; the user said "run it")
- Export: the existing `/private/tmp/mm-export/data`, `build_id` 2026-11-13T16:00Z-r100, `analysis_run_id` 11 (Eurostat-only; no WEO, no new ingest, no new export, no database access in this run). 45 entities, 42 `kind=country`. Groups in `meta/groups.json`: advanced, emerging, euro_area, g7, non_euro_eu. **G20 and EU27 are not present** (OQ-14: P1b stays without them). Geometry join: 29 joined, 13 outside the map extent, 3 markers; every `kind=country` entity has a join row or `outside_extent`.
- Build: `npm run build` 12 s (one tree). Measured with `measure-pages.mjs --sample=8` (8 country and 8 indicator pages, every other page type once); Node v26.13.1.

| Page type | First load, all responses, B gz | of which page-own | Parquet reader plus series files (loaded after `load`) |
|---|---|---|---|
| home | 610,640 (target 600,000: FAIL; hard 1,500,000: PASS) | 542,176 | 68,464 |
| country (worst of 8: BEL) | 2,362,830 (hard FAIL as the script counts it) | 405,028 on the first page sampled (AUS) | 68,464 on that page |
| compare | 508,098 | n/a | n/a |
| indicator (worst of 8: A01) | 2,368,735 (hard FAIL as the script counts it) | 515,674 | 1,853,061 |
| domains / revisions | 80,951 / 375,286 | | |

- Interactions (limit 5,000,000 B gz, hard): Country history interaction 1,773,451 B gz (ARG, social-A14, 2 files, 5,374,525 B raw): PASS. Home heaviest interaction 1,894,756 B gz (indicator G01): PASS. Compare: N/A. Home landing 466,395 B gz in 129 files, deferred 144,245 B gz in 6 files, map geometry 75,223 B gz (budget 100 KB).
- Reading: the first-load FAIL on country and indicator pages comes from the Parquet reader (Arrow plus parquet-wasm, about 1.85 MB gz on the indicator page A01), which those pages start after `load` without a user action (decisions F10). `measure-pages.mjs` adds it to the first load for these two page types, but only splits it out for the explorer (AC-RD-53 amendment 2026-11-09). Page-own weight on the indicator page is 515,674 B gz and on the sampled country page 405,028 B gz (the 8-page worst BEL is not split out here). The script's accounting for country and indicator was NOT changed in this run (no silent tuning); counting the reader against the 5 MB interaction rule, as F10 says, would make them PASS (about 1.85 MB against 5 MB). That is a rule change for the user (see decisions).
- Not covered: WEO charts (C3 with A03 vs A05, C4 annual, C6 for A02-A05): not populated, G-WEO not requested. `--sample=8` is not every page: a full run was not made. Fixture and this export were not measured on Node 20.
