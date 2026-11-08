# Dashboard UX baseline and Framework probes (plan task T99)

Written 2026-11-04 for `docs/plans/dashboard-ux-implementation-plan.md` T99. Inputs: ADR-025, `docs/design/briefs/dashboard-ux-brief.md`, ADR-023/024, `docs/ops/spike-results.md`. Framework `@observablehq/framework` 1.13.4, Node 20.18.1 (installed in `site/node_modules`). Probe scripts and builds are in the scratchpad, not committed. Labels: **verified** = observed in this session by the method given; **unverified** = not observed.

## Summary

| Item | Result |
|---|---|
| (a) Landing sizes | Verified. Scorecard landing set 31,960 B gz (fixture) and 32,406 B gz (real export); heaviest page is the explorer at about 287 KB gz. All far below the 600 KB internal target and the 1.5 MB limit. |
| (b) `style` option | Verified. Takes a project CSS file; theme variables listed below. No contradiction with ADR-025 decision 1. |
| (c) Static font copy | Verified, with a **blocker for ADR-025 decision 5 as written** (see below). The file is copied untouched, but only via `FileAttachment`, under a hashed name, and a CSS `url()` to it fails the build. |
| (d) No-JS rendering | Verified. Table cells, the freshness/status line and all JS-cell output are NOT in the built HTML. Only static Markdown renders (title, h1, the landing caveat paragraph, links, footer). Framework emits no `<noscript>`. |
| (e) Real export density | Verified. See table. The current real export is Eurostat-only: only 3 of the 42 countries have a percentile, in one domain. |

## (a) Real gzip -9 landing sizes

Method (verified): `EXPORT_DIR=<export> npm run build` in `site/` (fixture export from `tests/fixtures/site_spike/make_export.py`; real export from the scratch root `data/export/data`, which contains `manifest.json`), then `node scripts/measure-landing.mjs <dist copy> <page>` for every built HTML page. The script gzips (-9) the HTML, its `./` references, registered data files and static imports, recursively; dynamic `import()` is not followed, `.parquet` files are excluded. This is a local proxy and not what GitHub Pages sends (ADR-023 C2 still unverified).

| Page | Fixture (gz bytes) | Real export (gz bytes) |
|---|---|---|
| `index.html` (landing) | 31,960 (13 files) | 32,406 (13 files) |
| `status.html` | 35,969 (14) | 35,777 (14) |
| `revisions.html` | 115,501 (24) | 49,009 (20) |
| `explorer.html` | 284,243 (55) | 287,111 (55) |
| `domain/<d>.html` | 213,212 to 213,808 (51), 5 domains | 216,557 (global) to 220,569 (agri) (51), 11 domains |
| `peers/<d>.html` | 216,419 to 217,015 (52), 5 domains | 219,767 (global) to 223,782 (agri) (52), 11 domains |

Notes. The landing page is the index (domain list); the per-domain scorecard pages are about 220 KB gz, so even a landing heatmap that inlined all 11 domain scorecards on one page stays well under 600 KB on today's evidence (the estimate is unverified: the per-domain scorecard JSON sizes were not summed). The current CSS is Framework's theme only: `theme-air,near-midnight` 25,783 B raw (gz not separately measured).

## (b) `style` option and theme variables

Verified from `site/node_modules/@observablehq/framework/dist/config.js` (line 77: `style` is `null`, a path string, or falls back to `theme`), `dist/markdown.js` (lines 197, 203), `dist/build.js` (line 163, `bundleStyles({path})` with esbuild) and by a probe build (`observablehq.config.js` with `style: "style.css"`, `globalStylesheets: []`).

- A project CSS file given as `style: "style.css"` (path relative to `root`) is bundled by esbuild and emitted as `dist/_import/style.<hash>.css`. It replaces the theme: Framework base styles come only if the file imports them.
- Without `globalStylesheets: []` the page still gets a Google Fonts `<link>` (verified in the probe HTML); with `globalStylesheets: []` there is none. The existing config already sets it.
- Framework stylesheets can be imported from the project CSS and the probe built with no off-origin URL and no `googleapis` string in the output:
  ```
  @import url("observablehq:default.css");
  @import url("observablehq:theme-air.css") (prefers-color-scheme: light);
  @import url("observablehq:theme-near-midnight.css") (prefers-color-scheme: dark);
  ```
  This reproduces the current default (`air` light, `near-midnight` dark by `prefers-color-scheme`) and the output had the same four dark and three light media blocks, one `@media print`, `color-scheme` set per scheme. Project tokens (`--mm-*`) placed after the imports land in the same file.
- Theme variable names declared by `abstract-light.css` and `abstract-dark.css`: `--theme-background`, `--theme-background-alt`, `--theme-background-b` (light) / `--theme-background-a` (dark), `--theme-foreground-alt`, `--theme-foreground-muted`, `--theme-foreground-faint`, `--theme-foreground-fainter`, `--theme-foreground-faintest`; set per theme file: `--theme-foreground`, `--theme-foreground-focus`, plus `--theme-background-a` (light) / `--theme-background-b` (dark). Accents from `global.css`: `--theme-blue`, `--theme-green`, `--theme-red`, `--theme-yellow`. Other Framework names used in the built CSS: `--sans-serif`, `--serif`, `--monospace`, `--monospace-font`, `--font-small`, `--font-big`, `--observablehq-max-width`, `--observablehq-header-height`, `--plot-background`.
- Coupling note for T101/T103 (inference, unverified): `--theme-background-a`/`-b` are defined in only one of the two schemes' files, so tokens should reference `--theme-background` and `--theme-foreground*`, which exist in both.

ADR-025 decision 1 (one global stylesheet `site/src/style.css`, tokens, dark override) is feasible with either `style: "style.css"` plus the three imports above, or by keeping the theme and loading the sheet another way (not probed).

## (c) Static file copy (`.woff2`)

Verified by probe (4 KB random bytes named `fonts/test.woff2` under `src/fonts/`, sha-256 prefix compared):

- Not referenced from code: not copied (a plain `<a href="./fonts/test.woff2">` in Markdown did not copy it; same for a `.txt`).
- `FileAttachment("fonts/test.woff2")` copies it byte-identical (hash equal) to `dist/_file/fonts/test.<hash8>.woff2`. The name carries a content hash, so a static stylesheet cannot name it.
- `@font-face { src: url("./fonts/test.woff2") }` in the project CSS fails the build: `No loader is configured for ".woff2" files`. `url("/fonts/test.woff2")` fails too (`Could not resolve`). Build exits non-zero.
- Not probed: a `data:` URI font in CSS (about 120 KB base64 would break the 20 KB gz CSS target in AC-UX-12), and a JS-injected `@font-face` using the `FileAttachment(...).url()` result (works in principle; needs JavaScript, so no-JS readers get the fallback, and a preload tag with a fixed name is not possible).

**Blocker (font only).** ADR-025 decision 5 / AC-UX-11 ("committed under `site/src/fonts/`", `font-display: swap`, "one preload", file served same-origin) cannot be implemented as written with a static `@font-face` and a stable preload URL in Framework 1.13.4. The ADR itself makes a font optional and allows the system font stack (decision 5(a)) as a complete answer, so the rest of the plan is not blocked. Per the plan, no workaround was applied and no ADR was edited; the user should choose between 5(a) (system fonts) and an ADR-025 update that names the mechanism (JS-injected `@font-face`, or a build step that copies the file to a fixed name). Tasks that ship a font should wait for that decision.

## (d) Rendering without JavaScript

Verified by inspecting the built HTML of the real-export build (`dist/index.html`, `domain/labour.html`, `peers/labour.html`, `explorer.html`, `revisions.html`, `status.html`) and the probe:

- Zero `<table` in any built page; zero `<noscript>`.
- Each JS cell is emitted as an empty placeholder (`<div class="observablehq observablehq--block"><!--:hash:--></div>`); its content is created in the browser. This covers the status/freshness block (`statusBlock`), heatmaps, detail tables, attribution and the domain list on the landing page.
- Static Markdown does render: headings, the links, the footer, and the landing page's `<p class="mm-caveat" id="caveat">`. Domain pages have no static caveat.
- A probe confirmed the same for a hand-written `<table>` in Markdown (rendered) versus a table built in a JS cell (not rendered; its source text appears only inside the page script).

So the plan's T-risk (line 103) is real: a static, pre-JS caveat is possible only as Markdown/HTML text in the page source, and cells and the freshness line cannot be server-rendered. Whatever no-JS text ADR-025 decision 10 requires has to be a static element in the page source (Framework adds none). This does not contradict ADR-025, which already specifies a no-JS notice; AC-UX-8 should test the static element, not the cells.

## (e) Real export density

Verified by reading `meta/*.json` and `scorecard/*.json` of the real export (scratch root `data/export/data`) with a Python script.

| Measure | Value |
|---|---|
| Entities | 45 (42 countries, all ranked; 3 aggregates) |
| Rows per domain scorecard | 44 (42 countries + 2 aggregates) for 10 domains; `global` has 1 |
| Longest country/entity name | "European Union (27)" (19 chars); next "United Kingdom" (14), "United States" (13), "Saudi Arabia" (12) |
| Indicators | 80 defined; 73 domain slots, 72 distinct (one indicator is in two domains) |
| Longest indicator header | G12 "Prevalence of undernourishment and food insecurity (FAO, 3-year averages)" (73 chars); next Q06 (70), A13 (68), A03 (66) |
| Indicator name length | median 38.5 chars; 57 of 80 are longer than 30 chars |

Indicators per domain: agri 14, fin 8, external 8, growth 9, structural 7, social 7, fiscal 5, prices 5, environment 4, labour 4, global 2. Only agri (unranked) and global (unranked, informational) are not ranked.

Data coverage caveat: in this export (Eurostat-only run) only `labour` has any percentile, for 3 entities (M09); all other domain scorecards are empty. The density figures above (structure and names) are real; fill-rate and value density are not representative of a full export.

Consequences for later tasks (inference, unverified until rendered): a 14-column agri matrix with names averaging about 38 characters needs abbreviated or rotated/wrapped column headers with the full name in `title` and the detail table; 44 rows is tall enough that a sticky header and first column are needed.

## Blockers and conflicts with ADR-025

1. Font mechanism (section c): ADR-025 decision 5 as written is not implementable in Framework 1.13.4. Fallback 5(a) is unaffected. Needs a user decision or an ADR update; nothing was worked around.
2. No other contradiction found. Items (a), (b), (d), (e) are consistent with ADR-025.

## New wording pending confirmation

Added by T104 (global shell) in `site/src/lib/copy.js`; the user has not confirmed these strings yet.

- Skip link text: "Skip to main content" (`SKIP_LINK_TEXT`).
- Accessible name of the header navigation: "Main navigation" (`NAV_LABEL`, an `aria-label`, not visible).
- Generated page headings (static h1 of the domain and peer pages): "Domain scorecard: <domain name>" and "Peer comparison: <domain name>" (built in `site/scripts/lib.mjs`; the domain pages had no h1 before). The title part reuses the existing page titles.

Added by T105 (state blocks) in `site/src/lib/copy.js` as `DRAFT_*` constants. They render so that the states work, but the user has not confirmed them (gate G2); text can change without touching the code that uses it. `%` marks the part that is filled in by the page.

- Loading: "Loading % ..." (`DRAFT_LOADING`), with what is loading: "the dashboard data", "the series of this indicator", "the revision history of this indicator".
- Error title, file could not be fetched: "Could not load %." (`DRAFT_ERROR_TITLE`).
- Error title, file failed the format check: "The data of % did not pass the format check, so it is not used." (`DRAFT_ERROR_INVALID`).
- Error title, unknown manifest major: "This page cannot read %: its data version is not supported by this front-end." (`DRAFT_ERROR_VERSION`; the version number is deliberately not shown).
- Region names (`DRAFT_REGIONS`): "the data manifest", "the descriptions of countries, indicators and series", "the scorecard of this domain", "the list of domains", "the current alerts", "the list of recent revisions", "the data status", "the series file of this indicator", "the revision file of this indicator".
- Consequence lines (`DRAFT_CONSEQUENCE`): "The list of domains is not shown." (landing); "The tables and charts on this page are not shown." (domain and peer pages); "The chart and tables on this page are not shown." (explorer); "The revision lists on this page are not shown." (revisions); "The status tables on this page are not shown." (status).
- Sub-region consequence (one failed series or revision file): "The rest of this page is still shown. Choose another indicator to try again." (`DRAFT_SUBREGION_CONSEQUENCE`). For the explorer's missing-entry case the confirmed sentence "No series file for this indicator in this export." is shown in front of it.
- Next steps after the CONFIRMED empty texts: "Choose another group or another indicator." (`DRAFT_NEXT_GROUP`, after the confirmed empty-group text) and "Choose at least one country, or another indicator or range." (`DRAFT_NEXT_SERIES`, after the confirmed no-series text).
- No-JS notice: "This dashboard needs JavaScript to show its tables and charts. Enable JavaScript and reload the page." (`DRAFT_NOSCRIPT`). The brief also asks for a link to the data status text; it is omitted because that text is itself rendered by JavaScript, so a link would lead to an empty page.

Unchanged (confirmed): the stale banner, both wordings; the freshness line; the empty-group and no-series sentences; all other strings. The explorer and revisions views no longer print the raw `error` string of `loadSeries` / `loadRevisions` (it held the file path and the reader message); the string is still returned for the unit tests but is never rendered.

## No-JavaScript result (T105, verified)

Framework renders every cell in the browser (see section d), so no static caveat, freshness line or table exists before JavaScript for the five pages. Static content that does exist: the h1, the landing caveat paragraph, the links, the footer, and now the `<noscript>` notice, which is in the `header` option markup (`headerHtml` in `site/src/lib/shell.js`) and therefore in the built HTML of every page (verified by a browser smoke test with JavaScript disabled on six pages: one `.mm-noscript` notice, zero tables). A static freshness line or caveat before JavaScript is impossible with Framework 1.13.4 for the generated pages; this is the recorded limit. Loading and error blocks are created by JavaScript and so are not visible without it; the noscript notice is the only no-JS explanation.

Unchanged and reused: freshness line, stale banner (both wordings), caveat, footer text, "Sources", page names of the `pages` nav.

## Wording confirmed by the user 2026-11-04 (stated in session: "confirm")

All strings under "New wording pending confirmation" (T104 skip link, nav label and generated headings; T105 loading, error, region, consequence, next-step and no-JS sentences) are confirmed as written. They stay in `site/src/lib/copy.js`; the `DRAFT_` prefix on the T105 constants is historical and can be dropped in a later task without a wording change. The ADR-026 legend sentence and direction labels, and the other brief section 11 strings, are still pending the Stage 1 review.

## Stage 1: state vocabulary and V1 domain heatmap (T108-T113, 2026-11-05)

Gate G2 (user, in session 2026-11-05): the brief section 11 wording is approved: legend bin labels, state codes (`stale`, `lagging`, `unaligned`, `n/a`, `np`), the `ahead` tag, "Skip to values table", "Values and reference periods". Gate G3 stays open: the user reviews the build before T111 is merged.

What is on `domain/<id>` now: heatmap table (countries x indicators, leading "mean percentile of the domain's indicators" column, n/N, position), legend, alignment table, detail table in a closed `<details>`. Preview: see the command in the T113 report (build with `EXPORT_DIR`, then `npx observable preview` or serve `dist`).

Wording status in `site/src/lib/copy.js`:
- Approved (G2): `BIN_LABELS` (the brief gives the first and last label; "second fifth of the panel", "middle fifth of the panel" and "fourth fifth of the panel" are the implementation's, same pattern, to confirm), `STATE_CODES`, `AHEAD_TAG`, `AHEAD_NAME` ("ranked at its latest value, ahead of the common period"), `SKIP_TO_TABLE`, `DETAILS_SUMMARY`.
- ADR-026 (user decisions Q1 and Q2, 2026-11-04; ships at this review): `ORIENTATION_NOTE` ("Higher percentile means a more favourable position by each indicator's stated direction.") and `DIRECTION_LABELS` ("higher is better", "lower is better", "closer to target is better" with " (target <stored value> <unit>)" only when stored, "descriptive, not ranked").
- Existing confirmed strings reused as the codes and names of cells: `FLAG_*`, `NO_RANK_STALE`, `NO_POSITION_LOW_COVERAGE`, `AGGREGATE_NOT_RANKED`, `notRankedCell`, `DESCRIPTIVE_CELL`; and the pre-existing literals "Country", "Indicators available (n/N)", "Position" (now `COUNTRY_HEADER`, `COVERAGE_HEADER`, `POSITION_HEADER`), "stale: no rank" (`STALE_NAME`), "alert level: " and the estimate mark "e" (brief section 5).
- NEW, not confirmed (`DRAFT_` constants): legend title "Legend", "Percentile bins", "Cell marks"; scroll hint "Scroll sideways to see more indicators."; heatmap caption "<domain>: <label>, and the percentile of each indicator, by country" and the informational form "<domain>: latest value of each indicator, by country (informational, unranked)"; the fact labels "Latest value", "Reference period", "Reference offset (days)", "Source release", "Age (days)", "Staleness limit (days)", "Flags" (also the new detail-table headers).
- Design additions for review: one state not in the brief table, `plain` (a value is shown without percentile: unranked domain or information-only scope); the facts of a focused cell appear in one sticky panel under the table instead of a floating popover (no positioning arithmetic, no clipping inside the scroll container, no layout shift); column headers are clamped to four lines with the full name in `title` (no abbreviation list); one tab stop per cell with a value.

Measured on the fixture build (7 countries, 1 aggregate; not a real export): landing set 43,148 B gz, CSS 8,661 B gz, domain page weight not re-measured. Real-export density (42 rows, up to 14 columns for agri) is not tested; re-check at T114 / T133.

## Stage 3: V2 peer comparison (T117-T119, 2026-11-05)

What is on `peers/<id>` now: radio group for the peer group, sort select, the standing caveat and filter note, the indicator, the stored spread, the ADR-026 orientation note with the indicator's stored direction, a dot plot (figure with aria-label), then the values table (caption, `th scope`, reference offset column) that turns into cards under 40 rem. The country in focus is kept in `#c=<entity_id>`.

Wording: confirmed and unchanged are the caveat, filter note, group and sort labels, percentile column, spread sentence, `ORIENTATION_NOTE`, direction labels, "Skip to values table" and the fact labels. NEW, not confirmed (`DRAFT_PEER_*` in `copy.js`): "Direction of this indicator: <direction>." ; "Dot plot of the percentile vs all ranked countries for <indicator>, <n> countries. The table below lists the same values." ; "<indicator>: latest value and stored percentile, by country" (caption) ; "Filled dot: value observed for this country. Hollow dot: estimated or inherited value. The ring marks the country in focus." ; "The grey lines mark 0.25, 0.5 and 0.75 on the scale." ; "A country without a stored percentile (lagging, unaligned, stale or not ranked) is listed in the table only." ; "Select a country name to highlight it in the chart and the table; select it again to clear." The column heading "Reference offset (days)" is the Stage 1 DRAFT fact label.

Design notes for review: hollow = estimate or inherited (own choice; lagging and unaligned are not drawn); the radios are 24 px; country cell is a row header holding a button; cards show all six facts; the chart keeps a 36 rem minimum width and scrolls inside its figure on phones. No arithmetic in the browser (Plot `y.step`, constant guides). Chart click is not a focus control (table buttons only). Figure wrapper is local until T120.

Measured: fixture only (7 countries, 1 aggregate); `npm test` 164 pass, smoke 106 pass, 0 skipped. Not run: Firefox, Safari, screen reader, real export.

## Stage 4: V3 explorer (T120-T125, 2026-11-05)

What is on `explorer` now: a left rail "Selection" (indicator, transform, years, rebase, base period, free y-axis, countries with "Select group" buttons) beside the chart on wide screens (64 rem and up); on compact screens the same controls sit in a closed `<details>` "Selection" above the chart. Chart: one line per country (up to 5), distinct hue plus dash plus marker, direct end label with the stored latest value and unit, no legend, year ticks, y-axis label with the unit, hollow marker for estimate/provisional, ring for a stored revised-data-history value, thin hairline at the latest observation, alert diamond/triangle kept, index-100 and base-period rules when rebased. Above 5 series: one chart per country (shared y-axis by default, "Free y-axis" for separate scales; the page states which). Under the chart: "View as table" (latest 24 periods per series, equal to the plotted points, link to the data file), the current-alerts list and the caption table. The figure has a generated aria-label (indicator, y-axis, each country with range and stored latest value).

Wording: APPROVED (brief section 11, confirmed by the user 2026-11-05): "View as table", "Selection". NEW, not confirmed (`DRAFT_*` in `copy.js`): "Select group: <group>" ; "Free y-axis (used when more than 5 countries are selected)" ; "Each line is one country's stored values over time; the label at the end of a line gives the country and its latest stored value with the unit. Gaps in a line are periods without a stored value." ; "A hollow marker is an estimated or provisional value. A ring around a point is a value that was revised after this system first stored it. A thin vertical line marks the latest observation of a series. A diamond marks an alert and a triangle a watch from the latest analysis run only; the list below the chart gives the level and z for each." ; "The grey lines mark the index value 100 and the base period." ; "More than 5 countries are selected, so each country has its own chart." ; "All charts share one y-axis scale, so the levels of the countries can be compared." / "Each chart has its own y-axis scale: the shape of a series is easy to see, but levels cannot be compared between charts." ; figure label "Line chart of <title>, y-axis <label>. <country>, <from> to <to>, latest stored value <value unit>; ... The table under the chart lists the plotted points." ; table caption "<title>: plotted values, latest 24 periods of each series", headers "Value", "Status" ; "Download the data file of this indicator". Unchanged and confirmed: title form, rebase note, control labels, not-shown reasons, alerts heading, caption table.

Design notes for review: hue tokens `--mm-series-1..5` (`#0072b2 #c24d00 #00795a #a8327d #7a6200` light; `#56b4e9 #f58a4a #3ccf9e #e68bc2 #e3c74a` dark); hue follows click order of the country checkboxes; end-label text is the text colour (hues are 3:1 only); no label collision solver; on phones the chart keeps a 36 rem minimum width and scrolls inside its figure (end labels sit at the right edge); small multiples use one colour; "ring" = stored `load_kind = revision`.

Test data: the fixture export has 3 countries in M09. `site/tests/fixtures/explorer-m09-7countries.parquet` (7 countries, one EST, one revision row, one missing month) is served by the Playwright tests in place of the series file; it was written with the producer code of `tests/fixtures/site_spike/make_export.py` (series rows only).

Measured: `npm test` 181 pass; `check:contrast` 76 pair checks; smoke 114 pass, 0 skipped; CSS 9,440 B gz; landing set 44,989 B gz. Not run: Firefox, Safari, screen reader, real export (44 entities), print.


## Final re-check (T133, 2026-11-05)

Every number below is: fixture, not evidence for the real export. No real export exists (G0 fallback). Measured on a fresh `observable build` of a plain copy of the scratchpad `export-rf` fixture export (`EXPORT_DIR`; 7 countries, 1 aggregate, 5 domains). Re-run T133 and T114 on the first real export (45 entities, 11 domains) before the stage closes.

| Gate | Limit | Fixture result | Verdict (fixture) |
|---|---|---|---|
| CSS (AC-UX-12) | at most 20,000 B gz | 10,350 B gz (49,105 B raw), 1 file | within |
| Landing set, `measure-landing.mjs` (gzip -9) | 600,000 B target, 1,500,000 B limit | 46,427 B gz, 15 files | within both |
| Landing set, all-domains variant (`--all-domains`: plus every domain scorecard JSON, 5 files, 4,018 B gz) | same | 50,445 B gz, 20 files | within both |
| CLS on V1-V5 (smoke `AC-UX-12` tests, headless Chrome) | at most 0.1 | pass (V1 landing, V1 domain, V2, V3, V4, V5; also period choice on V4) | within |
| One interaction (`interactionBudget`) | at most 5,000,000 B gz | first interaction 1,822,000 B gz (Parquet reader libraries 1,818,762 B gz, largest data file 3,238 B gz); later interactions 3,238 B gz | within |
| AC-UX-11 dist scan (smoke test: no URL outside allowed namespaces, no remote `@import`, no `@font-face`, no font file) | none | pass | within |
| `npm-imports.lock` | unchanged | sha256 identical before and after the build | unchanged |
| `package.json` dependencies | framework, plot, d3, playwright only | `@observablehq/framework` 1.13.4, `@observablehq/plot` 0.6.18, `d3` 7.9.2; dev `playwright` 1.64.1; `package.json` and `package-lock.json` sha256 identical before and after | no new dependency (`site/` is untracked, so no git diff exists) |
| ADR-024 licence listing | no entry under A1 | no dependency change, so no new entry | none needed |

Tests run: `npm test` 188 pass, 0 fail; `check:contrast` 76 pair checks pass; `check:imports` 6 files match; `npm run smoke` (`MM_SMOKE_CHANNEL=chrome`, `MM_SMOKE_REQUIRE_BROWSER=1`, `MM_EXPECT_BUILD_ID=2026-11-01T04:30Z-r1`) 167 pass, 0 fail, 0 skipped.

T114 numbers (T114 stays todo and conditional; not marked done, T115 not built): all-domains landing set 50,445 B gz on the fixture, 8.4% of the 600 KB internal target. By the Q5 rule (drop the heatmap if over 600 KB) it would stay. The fixture has 5 domains and 7 countries; a real export has 11 domains and 44 rows per page, and the labour scorecard alone is 20,830 B raw, so a real figure must be measured, not extrapolated. The `--all-domains` flag in `site/scripts/measure-landing.mjs` is the only code change (the flag T114 lists; no script test yet).


## Results: close-out record (T135, 2026-11-05)

Status of the record: written; open items remain (T134 pending, so T135 is not marked done). Verified on 2026-11-05: `npm test` in `site/` gave 188 pass, 0 fail, 0 skipped. Test names below were checked by grep in `site/tests` (describe/test titles in `tests/smoke/ux.smoke.mjs`, `tests/smoke/browser.smoke.mjs`, `tests/smoke/static.smoke.mjs` and the `*.test.mjs` files). The smoke numbers (167 pass, 0 skipped) are taken from the T133 note, not re-run here. Every weight, size and CLS number is fixture-only (7 countries, 1 aggregate, 5 domains; no real export exists, G0 fallback). All browser evidence is Chromium (channel chrome) emulation only; no Firefox, Safari, real device or screen reader has been run.

### AC-UX-1..14

| AC | Verdict | Evidence | Limits |
|---|---|---|---|
| AC-UX-1 Contrast | met | `scripts/check-contrast.mjs` over the one pair table `scripts/contrast-pairs.mjs`: 76 pair checks pass (T133); `tests/contrast.test.mjs`; Playwright sampling of computed colours in both schemes (the `AC-UX-3` describes in `ux.smoke.mjs`, same function) | Tokens and rendered fixture pages only; no `prefers-contrast: more` test; contrast is not tested in forced colours |
| AC-UX-2 Non-colour distinguishability | met | `T113 AC-UX-2: states are told apart without colour` (V1 heatmap, five domains, unique signature, distinct grayscale image hashes); `T129 AC-UX-2: V5 feed chips and V4 class marks ...`; `tests/states.test.mjs` (7, exhaustive) | Deuteranopia screenshot is a review artifact only (by design); state `plain` was added by the implementation (not in the brief table) |
| AC-UX-3 Themes | met | `AC-UX-3` describes in `ux.smoke.mjs` (computed tokens equal `style.css` per scheme; every visible text colour on its background, six routes, light and dark); `T125 ... explorer chart (AC-UX-3 ...)`; static scan in `tests/ux-static.test.mjs` and `tests/ux-style-scan.test.mjs` | Chromium only; the "more intense = higher percentile" encoding is covered by the token tests, not by a reviewer |
| AC-UX-4 Keyboard and focus | met | `AC-UX-4` describes in `ux.smoke.mjs` (Tab traversal with no trap on V1-V5, skip link first, outline at least 2 px and 3:1, focus not under sticky/fixed element, targets at least 24 px with the 2.5.8 inline exception) | Chromium only; no screen reader or Safari keyboard behaviour (Safari needs Option+Tab for links) |
| AC-UX-5 Semantics | partly | `T113 AC-UX-5 and AC-UX-15: table semantics, legend, orientation` (caption, scope, no empty cell, sortable buttons with aria-sort, five domains); `T125 ... figure label, hollow and ring marks ... (AC-UX-5)`; `View as table equals the plotted points and the stored values (AC-UX-5)` (V3); `T129 V4 step chart (AC-UX-5)`; V2 figure label and table in the T117-T119 tests | Checked in the DOM only; whether a screen reader reads it correctly is AC-UX-14 (pending); the V2 and V3 charts outside the cases above and the V4 table sorting were not each asserted separately [UNVERIFIED coverage of every page]; V4 and V5 wording is DRAFT |
| AC-UX-6 Responsive | met | `AC-UX-6` describes in `ux.smoke.mjs` (320/390/768/1280/1920, no page-level horizontal scroll); `T132 AC-UX-6` (20 tests, V1-V5 plus V4 step chart and removal, default and 1.4.12 text spacing: no clipped text, no overlapping controls) | Fixture data (7 countries); the 42-45 country real export and its long labels are not tested (T99 e); not tested for other domains than agri or other peers than fin in T132; Chromium emulation, no real devices; the clipped-text check is a heuristic with stated exclusions |
| AC-UX-7 Visual review | partly | `AC-UX-7` test in `ux.smoke.mjs`: light, dark and print PNGs for six routes (18 files) plus `t132-*`, `explorer-*` and print PDFs in git-ignored `site/test-artifacts/` | The CI artifact upload is NOT added (B5: no verified `actions/upload-artifact` SHA, OP-07), so a reviewer can only see them locally; no human has reviewed them; no pixel diff (by design) |
| AC-UX-8 States | met | `AC-UX-8 error states (route interception)`, `AC-UX-8 loading state (route interception)`, `AC-UX-8 no-JS notice and reduced motion` in `browser.smoke.mjs`; `T129 AC-UX-8: the error blocks of V4 and V5 ...`; `tests/state-blocks.test.mjs`; stale banner tests in `tests/shell.test.mjs` | The T105 wording was confirmed by the user 2026-11-04 (the `DRAFT_` prefix is historical). Not covered: a missing `meta` file other than entities, alerts and recent-revisions is covered by unit tests only; the revisions loading container has no browser test |
| AC-UX-9 Print and preferences | partly | Print: `T130 AC-UX-9: print stylesheet` (controls hidden, details content shown, freshness line, caveat, Sources, URL, no clipped table, `page.pdf()` gives `%PDF` for six routes). Motion and forced colours: `T131 AC-UX-9: reduced motion and forced colours` (11 tests) | Partial: only Chromium emulation; real PDFs not read by a human; the real browser Print dialog (beforeprint path), Firefox and Safari print and Windows High Contrast are not checked (T134 sections 5-6); under forced colours the V2 dot plot and V3 series hues are not remapped (end labels carry identity), so the signature check covers V1, V4 and V5 only; `prefers-contrast: more` has no test; wide real-export heatmap at A4 unchecked |
| AC-UX-10 D6 and fidelity | met | `AC-UX-10` tests in `tests/ux-static.test.mjs` (8 computation rules and 3 banned-word rules over all `src/lib` modules, seeded negatives); `T113 AC-UX-10` (every ranked cell and domain figure and its bin equal the built scorecard JSON); no overall column and no default composite order on the landing (the landing heatmap is not built, T115) | The scan does not cover `scripts/lib.mjs` templates or JS blocks inside page `.md`; the allow-list has 19 entries, and four revisions-page counts are marked [REVIEW] for the user; the V4 bar length is the one declared display scale |
| AC-UX-11 No off-origin, font | met | Two `AC-UX-11` tests in `static.smoke.mjs` (dist scan: no URL outside allowed namespaces, no remote `@import`, no `@font-face`, no font file); `tests/ux-static.test.mjs` | No font ships (system stack), so `OFL.txt` and an ADR-024 licence entry are not applicable; `package.json`, lockfile and `npm-imports.lock` hashes unchanged (T133) |
| AC-UX-12 Weight and stability | partly (fixture only) | `AC-UX-12` tests (four, incl. CLS) in `ux.smoke.mjs` / `static.smoke.mjs`; T133 table above: CSS 10,350 B gz (limit 20,000); landing set 46,427 B gz (all-domains variant 50,445 B gz; target 600,000, limit 1,500,000); CLS at most 0.1 on V1-V5; first interaction 1,822,000 B gz (limit 5,000,000) | FIXTURE-ONLY, not evidence for the real export (45 entities, 11 domains). No font to measure. The landing country x domain heatmap (T115) is not built, so the "landing set including all domain scorecards" condition is measured only through the `--all-domains` variant (T114 not done) |
| AC-UX-13 Copy | partly | `tests/copy.test.mjs` pins fixed and confirmed strings verbatim (caveat, vintage text, `EARLIEST_LABEL` "earliest stored version", ORIENTATION_NOTE, direction labels) and the DRAFT list; no "first release" / "first stored release" in `src` (grep, T127; also a test in the T129 set); banned-word rules in `tests/ux-static.test.mjs` | 33 of the 43 `DRAFT_*` constants are new wording not yet confirmed (list below); AC-UX-13 requires confirmed strings |
| AC-UX-14 Manual record | pending user | Template `docs/ops/dashboard-ux-manual-check.md` is empty; every Pass/Fail and Notes cell is empty | No claim is made. No VoiceOver pass, no Firefox or Safari check, no real Print dialog, no Windows High Contrast, no browser versions recorded. Required by T94 BB16 |

Summary: met = AC-UX-1, 2, 3, 4, 6, 8, 10, 11 (8); partly = AC-UX-5, 7, 9, 12, 13 (5); not met = none (0); pending user = AC-UX-14 (1). "Met" means met on the fixture export, in Chromium, by automated tests, as ADR-025 defines these criteria; it does not cover the real export or other browsers.

### Open items

1. T111 (V1 domain page uses the heatmap): built, awaiting G3 review by the user; not merged, not committed. T112 and T113 ride on it. Review items: palette, legend, state signatures, header abbreviations, middle bin labels ("second/middle/fourth fifth of the panel", the implementation's own), state `plain`.
2. T114, T115, T116 (landing country x domain heatmap): G4 opt-in, conditional; T114 not run as a task (only the `--all-domains` measure flag exists, with no script test), T115 and T116 not built. Fixture figure 50,445 B gz is not a decision basis; measure on the real export.
3. DRAFT wording awaiting final confirmation. `site/src/lib/copy.js` holds 43 `DRAFT_*` exports. Confirmed by the user 2026-11-04 (prefix historical, can be dropped without a wording change): DRAFT_LOADING, DRAFT_ERROR_TITLE, DRAFT_ERROR_VERSION, DRAFT_ERROR_INVALID, DRAFT_CONSEQUENCE, DRAFT_SUBREGION_CONSEQUENCE, DRAFT_NOSCRIPT, DRAFT_NEXT_GROUP, DRAFT_NEXT_SERIES, DRAFT_REGIONS (10). NOT confirmed (33), by view:
   - V2: DRAFT_PEER_DIRECTION, DRAFT_PEER_FIGURE_LABEL, DRAFT_PEER_TABLE_CAPTION, DRAFT_PEER_MARKS, DRAFT_PEER_GUIDES, DRAFT_PEER_NOT_DRAWN, DRAFT_PEER_FOCUS_HINT.
   - V1: DRAFT_LEGEND_TITLE, DRAFT_LEGEND_BINS, DRAFT_LEGEND_STATES, DRAFT_SCROLL_HINT, DRAFT_HEATMAP_CAPTION, DRAFT_HEATMAP_CAPTION_INFO, DRAFT_FACT_LABELS (also headers of V2 offset column and V1 detail table).
   - V3: DRAFT_SELECT_GROUP, DRAFT_FREE_Y_LABEL, DRAFT_CHART_SHOWS, DRAFT_CHART_MARKS, DRAFT_REBASE_MARKS, DRAFT_FACET_STATEMENT, DRAFT_Y_MODE, DRAFT_SERIES_LABEL_PART, DRAFT_EXPLORER_FIGURE_LABEL, DRAFT_TABLE_CAPTION, DRAFT_TABLE_HEADERS, DRAFT_DOWNLOAD.
   - V4: DRAFT_BAR_LABEL, DRAFT_STEP_CHOOSE_PERIOD, DRAFT_STEP_NOTE, DRAFT_STEP_REMOVED, DRAFT_STEP_FIGURE_LABEL, DRAFT_STEP_FIGURE_PART, DRAFT_STEP_SKIP.
4. B1 percentile orientation: ADR-026 is `status: approved` (user, 2026-11-04). It amends ADR-025 with the orientation note and per-indicator direction labels, so no further ADR is needed for the wording itself. The wording shipped by T109/T111 (`ORIENTATION_NOTE`, `DIRECTION_LABELS`) is visible to the user only at the G3 review (item 1).
5. Real-pipeline revision percentage rounding: `src/macro_monitor/publish/revisions.py` exports full-precision floats; only the fixture producer rounds (abs 0.01, pct 0.1). The browser does not round (A3). DECISION NEEDED from the user: producer rounding, or an ADR on the display rule. Until then the real V4 may show long decimals.
6. V3/V2 forced-colors gap: series hues and dot-plot colours are not remapped under forced colours; identity is carried by end labels and row labels, not asserted by a forced-colors test (T131). Manual check in T134 section 6 is the only coverage.
7. Firefox and Safari: not run at all (ADR-023 C5, BB16 in T94); part of AC-UX-14 / T134. Also real devices and a real Print dialog.
8. Real export re-run (G0): T114 and T133 numbers, the 42-45 country heatmap width, V3 label collisions and 44-country performance, long header labels (T99 e) are unverified until the first real export exists.
9. B5 / OP-07: no verified commit SHA for `actions/upload-artifact` (the same gap exists for `setup-node` and `cache`); CI upload of screenshots not added (TODO comments in `ux-support.mjs`, `ux.smoke.mjs`, `scripts/ci/site-smoke.sh`). Blocks the CI half of AC-UX-7.
10. Observable build warning "Warning: 14 broken links" (exit 0) for the `#observablehq-main` skip link of the T104 header; not changed. Needs a decision: accept (the anchor exists at runtime) or change the link target.
11. T134 (manual checks) pending the user's record; T126, T127, T129, T130, T131, T133 stay `[~]` for the reasons in their notes (DRAFT wording, Chromium only, fixture only). Other items from the notes: the four revisions-page counts marked [REVIEW] (T106); the fixture M10 name does not match the real M10 (fixture-only).

### PROPOSED note text for T88-T94 of the v1 plan (proposal only; not applied; the v1 plan is not edited by T135)

> Note (proposed, date of application to be set by the user): superseded in part by the dashboard UX plan (`docs/plans/dashboard-ux-implementation-plan.md`, ADR-025, ADR-026). Views V1-V5 were restyled and extended there (design tokens in `site/src/style.css`, heatmap on V1 domain pages, dot plot restyle on V2, chart marks and small multiples on V3, revision marks and step chart on V4, status chips on V5, print and preference styles, no-JS and error blocks). The behaviour specified by this task is unchanged: no number is computed in the browser (D6), the stored fields drive every channel. The partial status of this task stands: Firefox and Safari checks (BB16, T94) and the CI action SHA for artifacts and `setup-node`/`cache` (OP-07) are still open and are tracked in `docs/ops/dashboard-ux-baseline.md` (results section, items 7 and 9) and in `docs/ops/dashboard-ux-manual-check.md` (pending the user's record). Acceptance of the UX criteria AC-UX-1..14 is recorded in the same results section; AC-UX-14 is pending the user.
