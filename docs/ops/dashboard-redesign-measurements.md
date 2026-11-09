# Dashboard redesign measurements

## Layout reservations 2026-11-09

Source: Playwright (Chromium, 16 px root) against `site/dist` built from the fixture export (build_id 2026-11-01T04:30Z-r1), fixed clock 2026-11-04T12:00Z (fresh, no stale banner). Fixture only, not the real export. Reproduced by `home.smoke.mjs` ("layout: CLS ..." and "layout: natural height equals the reservation ...") and, for per-element sources, a `layout-shift` PerformanceObserver (`entry.sources`).

Natural versus reserved (re-measured 2026-11-09 with `min-height: 0` applied to the element while measuring; the earlier table compared a height with its own min-height and proved nothing):

| Element | Natural | Reserved |
|---|---|---|
| Filter block (label, input, status line on its own row), each of 2, at 360, 400, 420, 700, 768, 1280 | about 55-56 px | `min-height: 3.5rem` (56 px) |
| Home shell (the content after it must sit where it does with no reservation), freshness line wrapping to 2 lines at 400 px and below | 40.8 px | 2.55rem (40.8 px) below 26rem (416 px) |
| Home shell, freshness line on one line (measured one line from 410 px; 420, 700, 768, 1280 tested) | 20.4 px | 1.275rem (20.4 px) from 26rem |

Tested at 360, 400, 420, 700, 768 and 1280 px on `/` and `/domains` (filters on `/` only), each within 1 px. The shell reservation is asserted as 40.8 px below 416 px and 20.4 px from 416 px. Wrap threshold of the fixture line (`Data cut-off: 2026-11-01 (build 2026-11-01T04:30Z-r1).`): two lines at 400 px, one line at 410 px (probed 320-700 px).

Corrections found by the natural-height test: (1) the shell reservation of 2.25rem (36 px) from 40rem over-reserved by 15.6 px, because the 1 rem margin under the freshness line collapses into the next block's margin; it is now 1.275rem from 26rem. (2) From about 900 px the status line shared a row with label and input (the global `p` max-width of 640 px kept it from wrapping), so the natural block was 29.5 px against 56 px reserved; `.mm-filter-status` now has `max-width: none` and always takes its own row. The earlier "56 px at 768 and 1280" and "36 px shell" values were reservation values, not content heights.

CLS and shift sources (measured before the two corrections above; not re-measured, only the CLS <= 0.1 assertion of `home.smoke.mjs` at 360 and 1280 px is re-run and passes):

| Page | Width | CLS before | CLS after | Remaining sources (after) |
|---|---|---|---|---|
| / | 360 | 0.0277 (0.0249 + 0.0028) | 0.0081 | indicators section 30->18 (details), caveat, shell moving |
| / | 768 | 0.0108 | 0.0108 | indicators section 172->160, caveat |
| / | 1280 | 0.0067 | 0.0067 | indicators section 172->160, caveat |
| /domains | 360 | 0.0059 | 0.0041 | domain list moved by shell |
| /domains | 768 | 0.0030 | 0.0030 | domain list |
| /domains | 1280 | 0.0013 | 0.0013 | domain list |

Before-sources at 360 on "/": countries section 347->372 (filter mount), indicators section 35->0. All measured values are well under the 0.1 limit.

Changes: `.mm-filter` is a flex row (label and input on one line; the input shrinks, `flex: 1 1 6rem`; the status line takes its own row), so no taller wrapped height exists at 360 px. Reservations are removed with `@media (scripting: none)`, so without JavaScript the empty slots take no space (AC-RD-05: lists remain, no input).

Accepted: a stale banner (manifest `known_cutoff` older than 45 days) is not reserved; it shifts the page once. It is rare and the shift is deliberate (the banner is an alert).

## R22 accessibility sweep 2026-11-09

Scope: AC-UX-1..9 on home, country, indicator, series (explorer), domains, domain and revisions (AC-RD-05, 40 grayscale, 54). Chromium (Playwright 1.64.1) emulation only. Default fixture build_id `2026-11-01T04:30Z-r1`; sparse fixture build_id `synthetic-sparse-fixture`. Each smoke file ran only against the fixture it is written for.

Results
- `npm run check:contrast`: 68 pair checks passed. No new colour token or hard-coded colour came with the redesign classes (`.mm-home*`, `.mm-filter*`, `.mm-point-reader`, `.mm-static-tip`, country and indicator tables use existing tokens), so `scripts/contrast-pairs.mjs` needed no new pair.
- `npm test`: 387 tests, 386 pass, 1 skipped (pre-existing), 0 fail (count taken 2026-11-09 at the R22 sweep; later gate-F changes raised it, see R23 below for the current count). `npm run check:imports`: 6 files match the lock.
- Full `npm run smoke` on the default fixture: 266 tests, 234 pass, 0 fail, 32 skipped (the sparse-only tests); count taken at the R22 sweep, 2026-11-09, before gate-F additions.
- Sparse fixture: `country.smoke.mjs` + `indicator.smoke.mjs` 46 tests, 45 pass, 0 fail, 1 skipped (C-IND-7, "this export has no series file"). The new R22 block in `ux.smoke.mjs` also ran there (8 tests, 8 pass) plus the all-pages test (SY countries and indicators).
- dist was rebuilt from the default export at the end (build_id `2026-11-01T04:30Z-r1`).

Defects found and fixed
1. Print (AC-UX-9): the home filter (`.mm-filter`, an input and a status line) printed. First attempt (adding it to the print hide list) lost the cascade because `.mm-filter { display: flex }` is declared later in the file; fixed with `@media print { .mm-filter { display: none; } }` after that rule in `site/src/style.css`. Found by extending the print test's "controls hidden" selector (now also `input`, `.mm-filter`, `fieldset.mm-point-reader`, history and Go buttons). A unit test (`tests/ux-static.test.mjs`) pins the rule order.
2. No other defect found in contrast, keyboard/focus, 320-1920 layout, 1.4.12 text spacing, reduced motion, forced colours or CLS for the new page types.

Coverage added (`site/tests/smoke/ux.smoke.mjs`, describe "R22 AC-RD-54"; runs on either fixture, picking pages from the built home)
- Home with the filter in use (no match), light and dark: text contrast, status sentence, input focus ring (2 px outline), typed text of the input against its own fill.
- Indicator with the Read-a-value reader focused and the static tip drawn, light and dark: tip text 4.5:1 on the tip box (or the page when the box is transparent), bar edges and the 4 px focus ring 3:1 on the page, ring present as a non-colour cue.
- Country with a history chart opened, light and dark: profile dots and history marks 3:1 on the page, text contrast.
- AC-RD-05: JavaScript disabled, home has one h1, the no-JS notice, both link lists, no input, no reserved filter slot.
- AC-RD-40 grayscale on the new charts: structural cues (role=img with a label, written axis ticks, hollow dots, 4 px ring). Adjacent bin fill luminance ratios are logged only (light 1.45, 1.39, 2.11, 2.49; dark 2.01, 1.71, 1.90, 1.60): bin tone alone is weak, so the bins are never the only cue (table glyph and word, axis position).
- Every country and indicator page of the build (up to 12 each): text contrast both schemes, no page scroll at 320 and 1920, no bare `n/a`.
- Existing print/responsive/keyboard/theme tests already list home, domains, domain, indicator, country, explorer and revisions.

Not verified; manual items still needed
- Screen reader (VoiceOver, NVDA, JAWS) behaviour: live regions of the filter status and the reader `<output>`, figure labels, table navigation.
- Firefox and Safari (focus ring, `::details-content` in print, `scripting: none`, form-control dark styling).
- Real print and real PDF review on paper or a PDF viewer; Chromium `page.pdf` and print emulation only.
- Forced colours and prefers-contrast on real Windows high-contrast; only Chromium emulation ran.
- Grayscale tone of bin fills is a diagnostic, not an assertion; no human review of the grayscale or deuteranopia screenshots in `site/test-artifacts/` yet.
- Real 44-entity export (R24): all of the above ran on the two fixtures only.

## R23 weight and build measurement 2026-11-09 (updated after gate F)

FIXTURE-ONLY. Both exports are small: they understate a real 44-entity payload, and nothing here is extrapolated. AC-RD-53 stays partly unmet until R24 (real export). Targets are recorded, not tuned; no product code changed.

Method: `npm run measure:pages` (`site/scripts/measure-pages.mjs`, `--time-build` runs `npm run build`, `--sample=N` measures only the first N country and indicator pages). Chromium (Playwright 1.64.1), local static server, fresh browser context per page, waited for network idle plus 600 ms, response bodies awaited before sizing. First load = every response actually made (HTML, CSS, JS incl. wasm, data), each URL once, gzip level 9 computed locally with zlib (the server sends no encoding, so this is not wire bytes under a real CDN). Country and indicator rows are the MAXIMUM over every such page of the build (worst page named); CSS and CLS are also maxima. History interaction = new files requested after clicking the first "Show history" button on a country page, until the panel is loaded. Build time = wall clock of `npm run build` on this machine, one run, not CI.

AC-RD-53 split (user-approved amendment 2026-11-09, spec text being written by the architect): on PG-SERIES the Parquet reader (parquet-wasm, Arrow and their deps flatbuffers and tslib) plus the series file loaded for the initial selection count as the one series interaction (at most 5 MB gz). The rest of the first load (page-own files: HTML, CSS, JS, meta, manifest) is held to the 600 KB target and the 1.5 MB hard limit. The script reports both numbers for the explorer. `measure:explorer` (`node scripts/measure-explorer.mjs`) and `measure:pages` now agree: reader 1,822,000 B gz on the default fixture in both (5 lib files 1,818,762 plus M09 series file 3,238). Exit 1 only on a hard breach (page-own above 1.5 MB, reader plus series above 5 MB, or any other page above 1.5 MB); exit 2 for no browser or no dist.

Default fixture, build_id `2026-11-01T04:30Z-r1` (8 country pages, 7 indicator pages, all measured)

| Page type (worst page) | First load gz (B) | Target 600 KB | Hard 1.5 MB | max CLS | CSS gz |
|---|---|---|---|---|---|
| home | 52,972 | PASS | PASS | 0.0065 | 11,430 |
| country (worst: POL) | 341,648 | PASS | PASS | 0.0034 | 11,430 |
| indicator (worst: M09) | 350,158 | PASS | PASS | 0 | 11,430 |
| series / explorer, page-own files | 267,222 | PASS | PASS | 0.0069 | 11,430 |
| series / explorer, reader plus series file | 1,822,000 | limit 5 MB: PASS | | | |
| domains | 49,112 | PASS | PASS | 0.0013 | 11,430 |
| revisions | 334,325 | PASS | PASS | 0.0198 | 11,430 |

- One history interaction (DEU, labour-M09, 2 new files, 5,264,728 B raw): 1,753,536 B gz, target 5 MB: PASS (nearly all the reader wasm).
- The explorer's undivided first load is still 2,089,222 B gz (the old FAIL figure); under the amended AC it is the sum of the two rows above.
- All CLS under 0.1, CSS 11,430 B gz under 20,000: PASS. dist size 6,820,132 B raw. Build time 6.0 s from the earlier run (not repeated).
- CR-4 not triggered: the maximum country page (341,648 B gz) and indicator page (350,158 B gz) are under 600 KB, over all pages of this fixture.

Sparse fixture, build_id `synthetic-sparse-fixture` (44 country pages, 5 indicator pages, all measured)

| Page type (worst page) | First load gz (B) | Target 600 KB | Hard 1.5 MB | max CLS | CSS gz |
|---|---|---|---|---|---|
| home | 52,730 | PASS | PASS | 0.0119 | 11,430 |
| country (worst: SYA1) | 273,072 | PASS | PASS | 0.0034 | 11,430 |
| indicator (worst: T01) | 281,554 | PASS | PASS | 0 | 11,430 |
| series / explorer, page-own files | 265,948 | PASS | PASS | 0.0033 | 11,430 |
| series / explorer, reader plus series file | 0 (no series file, no reader loaded) | limit 5 MB: PASS | | | |
| domains | 48,731 | PASS | PASS | 0.0010 | 11,430 |
| revisions | 263,947 | PASS | PASS | 0.0074 | 11,430 |

- History interaction: not measured (no country page offers a history button; no series file). CR-4 not triggered here either (max country 273,072, max indicator 281,554 B gz).
- Build time and dist size 1,894,462 B raw from the earlier run.

Counts at 2026-11-09 after gate F: `npm test` 397 tests, 396 pass, 1 skipped, 0 fail; default `npm run smoke` 278 tests, 246 pass, 0 fail, 32 skipped (the sparse-only tests).

Not verified / open
- Real 44-entity export (R24): PG-COUNTRY, PG-INDICATOR and history weights; the "about 125 additional pages" build time; CI build time (local machine only, single runs); the export spec section 8 site-size budgets were not compared.
- Wire (HTTP encoding) size under GitHub Pages: not measured; gzip is computed locally.
- Run-to-run variance: a few bytes (HTML differs by a few B between runs; for example country POL was 341,639 B in the first run and 341,648 B now).
