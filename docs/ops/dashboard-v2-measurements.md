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

## Not covered here
- Home four-panel layout and map weight (V60; V58, V53 are not built in this branch).
- Second language tree weight and build time (V65); `build:all` was not re-timed in this run.
- Real export (V30, gated on G-REAL, G-WEO). Note: decisions file records real-export first loads over the 1.5 MB hard limit for CZE (country) and M07 (indicator) on `/private/tmp/mm-export`; the fixture does not show that.
- The CLS estimate for `--fbar-mode` (decisions file, mode-switch reserve): fixture CLS stays at or below 0.0198 on every page type.
