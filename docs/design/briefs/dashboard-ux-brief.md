# Design brief: dashboard UI/UX (V1-V5) - visual language, states, accessibility, charts

Status: working brief for ADR-025 (proposed). It carries the detail; the decisions and acceptance criteria are in `docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md`. Nothing here is approved. Date: 2026-11-04.

Source labels: [DOC] read on the primary page this session; [SEARCH] search-summary only; [REPO] read in this repository this session; [CALC] hand calculation by the author (WCAG relative-luminance formula), to be re-checked by AC-UX-1; [UNVERIFIED] not checked. Access date for every URL: 2026-11-04.

User requirement (stated in session, 2026-11-04): "I want the final visualisation to be beautiful and informative for UI/UX", to be done after the Eurostat throwaway run. That run is not finished (fetch failed on the time-filter parameter, `docs/ops/spike-results.md`, last section [REPO]), so no real export exists yet. Every density figure below is a plan against the fixture and the spec, to be re-checked on the first real export (Stage 0 gate).

## 1. What exists today [REPO]
- Pages: `index.md` (domain list + caveat + status block), generated `domain/<id>.md` (V1), `peers/<id>.md` (V2), `explorer.md` (V3), `revisions.md` (V4), static `status.md` (V5). Renderers in `src/lib/*-view.js` take `html` and `Plot` as arguments and have no imports.
- Styling: each renderer injects its own `<style>` string with hard-coded light colours (`#ddd`, `#fef3c7`, `#b45309`, `steelblue`). No tokens, no dark theme, no print rules, no web font. `observablehq.config.js` has `globalStylesheets: []`, `sidebar: false`, `pager: false`, `search: false`.
- V1 today: summary table, a dot chart of the mean percentile, a long detail table (country x indicator in rows), an alignment table. There is no country-by-indicator matrix.
- Cell states in code (`scorecard.js`): `ranked`, `stale`, `unranked`, `descriptive`, `missing` ("n/a"), `not_published`; summary states `ranked`, `low_coverage`, `n/a`, `aggregate`, `unranked_domain`. Flags: stale, lagging, ahead, unaligned (fiscal-year basis), inherited, estimate, alert level. These are the states the visual language must cover; no new meaning is created.

## 2. Principles
1. Meaning comes from the export; the page only encodes it (D6). A colour, a bar length, a glyph or a sort order is a function of one stored field. The browser never computes a rank, percentile, mean, position, n/N, or an overall status (no composite across domains: U1, ADR-010 decision 9).
2. Numbers first, colour second. Every coloured cell also shows its stored number or a state word. Colour only helps scanning.
3. A state never relies on colour alone: each has a text code and a non-colour shape or pattern (section 5).
4. Calm and dense: the audience is an analyst scanning 42 countries; the look is closer to a printed statistical bulletin than a marketing page. No decoration that carries no data.
5. Static and cheap: no new JavaScript library, heatmap and status chips are HTML/CSS; Plot only for time series and dot plots.

## 3. Visual language

### 3.1 Tokens (CSS custom properties, one stylesheet)
One global stylesheet `site/src/style.css` replaces the per-renderer `<style>` strings (Framework `style` config option [UNVERIFIED: the Framework docs returned HTTP 429 this session; the option is known from memory and is checked in Stage 0]). Tokens are declared on `:root` for light and overridden in `@media (prefers-color-scheme: dark)`. Framework's own theme already follows `prefers-color-scheme` when both a light and a dark theme are active (default `[light, dark]`) and exposes `--theme-foreground*` variables and a `light`/`dark` body class [SEARCH: https://observablehq.com/framework/themes and https://observablehq.com/framework/css/color, summaries only]. Our `--mm-*` tokens sit beside them and do not depend on their exact names; the base page colours come from Framework's theme, our tokens define only the data encodings and components (this limits coupling; checked in Stage 0).

| Token group | Names (examples) | Notes |
|---|---|---|
| Surface and text | `--mm-bg`, `--mm-surface`, `--mm-text`, `--mm-text-muted`, `--mm-border` | text 4.5:1 on surface, muted text 4.5:1 too (no "faint" text for information) |
| Percentile scale | `--mm-pct-1` .. `--mm-pct-5` and `--mm-pct-1-ink` .. `--mm-pct-5-ink` | cell fill and the fixed ink colour per bin |
| Diverging (sign) | `--mm-div-neg`, `--mm-div-pos`, `--mm-div-mid` | revisions and deviation from target only |
| Alert | `--mm-alert-watch`, `--mm-alert-alert` (+ ink) | always paired with a shape and a word |
| Feed state | `--mm-feed-fresh/late/stale/broken` | always paired with an icon shape and a word |
| Focus | `--mm-focus` | 3:1 against both adjacent surfaces |
| Space and type | `--mm-space-1..6`, `--mm-radius`, `--mm-font`, `--mm-fs-*` | 4 px base grid |

Hex values are CANDIDATES only. They are fixed in Stage 0 and verified by AC-UX-1; none is claimed to pass until that test runs.

### 3.2 Percentile scale (sequential, not diverging)
Decision: a single-hue sequential scale, light = low percentile, dark (light theme) = high percentile. Reasons: (a) the standing caveat says percentiles are "relative position in the covered panel, not a judgement of structural quality", and a red-green or red-blue diverging ramp would read as good/bad; (b) a percentile is already a position on a bounded 0-1 scale, so "more ink = further up the panel" is the honest encoding; (c) sequential single-hue ramps survive colour-vision deficiency and greyscale printing better than diverging ramps. Whether a high percentile is "good" depends on `rank_mode` and `good_dir` of each indicator; I did not find in the spec whether the stored `percentile` is already oriented (see open question Q3), so the scale makes no good/bad claim.

Binning: 5 bins on the stored percentile with fixed edges 0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0 (constants; assigning a colour to a stored value is a display mapping). Five bins keep the legend readable and every bin text-safe. Cell text is the stored percentile as the existing view-model formats it today; no "x100" is introduced without the user's decision (Q4), because multiplying is arithmetic on a stored value and changes the confirmed wording of the column.

Candidate ramp (ColorBrewer "Blues" members [UNVERIFIED hex values, from memory: https://colorbrewer2.org]; light theme): `#deebf7`, `#9ecae1`, `#6baed6`, `#2171b5`, `#08306b`; ink: near-black on bins 1-3, white on bins 4-5. Hand check [CALC]: `#2171b5` with white text is about 5.1:1 and `#08306b` with white is higher; `#6baed6` with near-black `#111` is about 7.8:1. The ColorBrewer mid-dark step `#3182bd` was rejected: about 4.15:1 with white and about 4.5:1 with `#111`, i.e. no safe ink colour at body size. This is the reason ink is a fixed token per bin and not chosen by the browser.

Dark theme: intensity still means "higher percentile", so the ramp runs from dark (low) to light (high) on a dark surface; the ink flips per bin. Candidate hexes are set in Stage 0, not guessed here.

### 3.3 Diverging scale (where it is justified)
Used only where the sign is the information: revisions (`revision_abs`, `revision_pct`) and `deviation` from target. Blue-orange, never red-green. The sign is always printed ("+0.2", "-0.2", with a true minus U+2212 and an up/down triangle drawn as inline SVG), so colour is a second channel. The midpoint (zero) is neutral. A bar length for a revision is scaled to the largest absolute value among the rows shown; this is a display scale, not a statistic, and is labelled "bar length is relative to the largest revision shown".

### 3.4 Typography
Decision (recommended, Q1): one self-hosted family, Inter, variable weight, Latin subset WOFF2, plus `font-variant-numeric: tabular-nums` for all numbers; system-font stack as the fallback and as the whole solution if the user prefers zero font weight.
- Licence: Inter is under the SIL Open Font License 1.1 (Copyright The Inter Project Authors) [DOC: https://github.com/rsms/inter/blob/master/LICENSE.txt, 2026-11-04]. The OFL permits bundling and web embedding with the licence text kept and no sale of the font alone [UNVERIFIED here: the clause list; read the licence text at implementation]. The licence file is stored next to the font (`site/src/fonts/OFL.txt`) and recorded in the ADR-024 licence listing.
- Size cost: a Latin-only Inter variable WOFF2 is about 90 KB; the full variable file about 300-317 KB [SEARCH, third-party estimates: https://sift-35a.pages.dev/fonts/inter and https://cloudfour.com/thinks/font-subsetting-strategies-content-based-vs-alphabetical/; not measured]. At 90 KB the font is about 6% of the 1.5 MB landing limit and WOFF2 is already compressed, so it is not reduced by gzip. Landing today is about 32 KB gz without a font [REPO]. The font is measured in Stage 0 with `gzip -9` of the served bytes like every other file (AC-UX-12).
- No new npm dependency: the file is copied into `site/src/fonts/` (not `@fontsource/*`, which would be a new dependency needing an ADR under ADR-024 rule 1). Subsetting is done once by the user or at Stage 0 with a tool run outside the repo; the produced file is committed with its source URL, version and checksum noted in `site/src/fonts/README`. [UNVERIFIED: whether Framework's build copies a `.woff2` from `src/` untouched; checked in Stage 0.]
- Loading: `@font-face` with `font-display: swap`, one `preload` for the single file, a metric-compatible fallback (`size-adjust`) to avoid layout shift (AC-UX-12: CLS).
- No Google Fonts, no icon font, no CDN: icons are inline SVG symbols defined once.
- Scale: base 16 px; table text 14 px minimum (never below 12 px for any text); line height 1.5 for prose, 1.3 for tables; headings 28/22/18. Numbers right-aligned with tabular figures; units in a muted second line.

## 4. Information hierarchy and layout per view

Global shell: skip link; header with site title and the four navigation links (the existing `pages` list, shown as a horizontal nav, not Framework's sidebar); freshness line directly under the title: "Data as of <known_cutoff> (build <build_id>)" (existing wording), banner when stale (existing wording, `role="alert"`); standing caveat on V1 and V2 in a bordered note; footer with the existing footer text and the Sources block. Max content width 72 rem for prose; tables use the full width up to 90 rem; the page body never scrolls horizontally.

### V1 Scorecards
Levels of reading: (1) where do I stand: the heatmap; (2) why: values, reference periods and flags; (3) how trustworthy: alignment, stale, coverage.
- Landing (`index`): title, freshness line, caveat, and the country-by-domain heatmap: rows = 42 countries (aggregates EU27 and EA in a separate group below, labelled "aggregate (not ranked)"), columns = the ranked domains, cell = the stored domain figure (`percentile_rank`, label "mean percentile of the domain's indicators" in the table caption and the legend). Informational domains (agri, global) are not columns; they are listed as links under the matrix ("informational, unranked"). There is NO overall column, no row sum, no default sort by any combination of domains. Default row order is alphabetical by country name; a click on a column header sorts by that domain's stored `rank_position` (null positions last), which is ordering by a stored field. A low-coverage country keeps its mean percentile cell with the state mark (section 5).
- Cost: the landing heatmap needs every ranked domain's scorecard file (about 8-12 files, "about 200 KB per domain uncompressed, under 2 MB in total" [REPO: export spec section 5]). The AC-DASH-2 landing set is defined as manifest + meta + ONE domain scorecard + status (export spec section 8), so loading all domains is outside that definition. Estimate (not measured): under 2 MB raw is roughly 250-400 KB gz (JSON compresses well), which fits inside 1.5 MB; AC-UX-12 measures it on the real export and sets the rule: if the landing set including all domain scorecards exceeds 600 KB gz, the landing heatmap is replaced by the domain list plus per-domain heatmaps only (Q5).
- Domain page (`domain/<id>`): header (name, notices, caveat, peer-set note when present, the sentence that the country figure is the mean percentile of the domain's indicators and not the percentile of the domain), then the HEATMAP: rows = countries, columns = the domain's indicators (about 10), plus a leading separated column "mean percentile of the domain's indicators", then "n/N" (`n_available/n_defined`, existing meaning) and "position" (existing wording "no position (low coverage)" etc.). Column headers carry the indicator name with the unit and the transform as a second line; header cells are sticky. Cell: the stored percentile number on the bin colour; state cells per section 5. Focus or hover on a cell shows a popover with the stored value, unit, reference period, `ref_offset_days`, source release date, `age_days` and limit, flags; the same facts are present in the detail table (not tooltip-only, so touch and screen reader users have them). Under the heatmap: legend (5 bins plus the state glyphs), alignment table (existing), and the detail table inside a `<details>` element ("Values and reference periods") that stays in the DOM and is expanded when printing.
- Aggregates and WLD: aggregates never get a colour (percentile null); they show their value only.
- Informational domains (agri, global): the same matrix layout but with NO colour scale and no percentile column: cells show the value on the neutral surface, the header says "informational, unranked".

### V2 Peer comparison
Hierarchy: pick indicator, see the ordered panel, see how comparable it is. Layout: controls row (indicator select, peer group as a radio group of 6 labelled options, sort select; the existing confirmed labels), the spread sentence and the group-filter note directly above the chart (existing confirmed wording), then a dot plot (rank-ordered rows, x = stored percentile 0-1, fixed axis with constant guide lines at 0.25, 0.5 and 0.75 drawn in the neutral border colour and not labelled as quartiles or median in the data), then the table (existing columns plus a "reference offset" column in days). Dots are filled for ranked, hollow for "low coverage"-type and lagging/unaligned entities are NOT drawn (existing rule: chart draws only rows with a stored percentile) but stay in the table with their mark. The selected group only filters and sorts. Row labels are the country names (direct labelling, no legend). A country the user focuses (click or keyboard) is highlighted in the chart and the table, and the choice is kept in the URL hash (`#c=DEU`) so a view can be shared; no cookies or local storage.

### V3 Explorer
Chart first. Desktop: controls in a left rail (indicator, transform, countries, range, rebase), chart on the right, caption table under the chart. Mobile: controls collapse into a `<details>` "Selection" above the chart; the chart is full width. Country selection is a fieldset with a legend, search-free, grouped by the stored `meta/groups.json` groups with "select group" buttons that only toggle checkboxes. Chart rules in section 6. Title is the confirmed form "<indicator>: <transform>, rebased to 100 at <date>".

### V4 Revisions and vintages
Hierarchy: "is anything big happening" (recent list), "what did one edition do" (named editions, one line each), "history of one key" (vintage view). Layout: revised-data notice (confirmed wording) in a bordered note; the recent revisions table with a signed value, a sign glyph and a bar (section 3.3), the class mark (regular / re-estimation) as text plus a left border style (solid vs dashed); the named-edition lines in a separate block below, never inside the table (spec rule); the FIXED vintage text (export spec section 7) in a permanently visible note on the vintage view, not in a tooltip or a collapsed element; vintage view: a step chart of value against `known_at` for the chosen key (stepped line, one point per stored version, the earliest stored version drawn as a labelled hollow point), then the version table. A tombstone is a point drawn as an "x" with the word "removed".

### V5 Data status
Hierarchy: "is the feed current" first. A row per source group: name, state chip (icon + word: fresh, late, stale, broken), expected and latest period end as two dates and the stored gap shown as text, load result ("not exported" while null, confirmed wording), then the backlog block, validation counts, COV-01, drift, manual downloads, the monthly check text. Sorting by state severity (broken, stale, late, fresh) is an ordering of a stored enum. No overall traffic light is computed (that would be a derived status; Q6 asks whether the user wants one produced by the pipeline).

## 5. State vocabulary (distinguishable without colour)
Each state has: a stored cause, a short code (text, visible), a shape/pattern, and an accessible name. Colour is an extra. The mapping is exhaustive over the states in `scorecard.js` [REPO].

| State (data-state) | Cause | Visible content in the cell | Non-colour signature | Accessible name (aria/title) |
|---|---|---|---|---|
| ranked | percentile present | the stored number | solid fill from the bin | "<number>, <label>" with the confirmed label |
| stale | `is_stale` | value kept, text "stale" (cell text "no rank (stale)" in the table) | diagonal hatch over a neutral fill; corner clock glyph | "stale: no rank" + age and limit |
| lagging / unaligned | `alignment` | text "lagging" or "unaligned" | dotted border, no fill | "not ranked (lagging)" / "(unaligned)" (confirmed wording) |
| ahead | `alignment = ahead` | the number, small "ahead" tag | solid fill + tag | "ranked at its latest value, ahead of the common period" [NEW WORDING] |
| descriptive | `rank_mode = descriptive_only` | value, italic | no fill, italic, no bin | "descriptive, not ranked" (confirmed) |
| n/a | value null | "n/a" muted | empty cell, thin dash line | "n/a" (confirmed) |
| not published | withheld placeholder | "not published" | crossed-out box (diagonal line corner to corner) | "not published" (confirmed) |
| aggregate | EU27/EA | value only | row in a separate group, label | "aggregate (not ranked)" (confirmed) |
| inherited | `inherited` | flag "inherited from the euro area" | small "i" glyph + underline | as flag text (existing) |
| estimate | `value_kind = estimate` | flag "estimate" | hollow marker in charts, "e" suffix in tables | "estimate" (existing) |
| low coverage | `low_coverage` | mean percentile kept, "no position (low coverage)" | hollow ring glyph beside the figure | as text (existing) |
| alert level watch / alert | `alert_level` | flag "alert level: watch" / "alert level: alert" | triangle (watch), diamond (alert) glyph; same shapes as the explorer markers [REPO] | "alert level: watch" etc. |

Feed states (V5): fresh = check mark, late = clock, stale = hourglass-empty box, broken = cross in a square; each with the word. Chips have a 1 px border in addition to the fill.

Glyphs are inline SVG (not Unicode characters) so that font coverage cannot remove them, each with `aria-hidden="true"` next to the visible text word.

Legend: one legend block per page listing only the states present on that page; it is a real list of glyph + word.

## 6. Chart design rules (Plot)
1. Titles and subtitles state indicator, transform, unit, frequency (existing caption table kept). A unit appears on the axis label, not only in the caption.
2. Direct labelling: up to 5 series get an end-of-line label (country name) placed at the last point, with a halo in the surface colour; no legend. Above 5 series, switch to small multiples (facets by country, shared x, y shared by default with a "free y-axis" checkbox, because shared y shows level differences and free y shows shape; the page says which is active).
3. Colour for series: a categorical set of at most 5-6 hues that stay distinct for CVD, each also given a different line dash or end-marker shape so greyscale and CVD users can tell them apart; the same country keeps the same hue across a session where possible (hue is assigned by order of selection, not by data).
4. Vintage and uncertainty cues: values with `value_status` EST or PROV are drawn with hollow markers; a vertical hairline marks the latest observation; points whose `load_kind` is `revision` carry a small ring and the caption says "revised-data history" (D10); the caption always shows the vintage (`known_at`) of the last point. No confidence bands are drawn (the export has none).
5. Alerts: shapes as today (diamond alert, triangle watch) with the stored z in the focus/tooltip text; the list under the chart (existing) is the accessible alternative.
6. Rebase: the y-axis label reads "index, base period = 100"; a horizontal rule at 100 and a vertical rule at the base period; the unit text for the series changes (existing); the note about display-only scaling stays visible.
7. Axes: zero baseline is not forced for levels; for rebased index no clipping; time axis ticks by year; no dual axes; no 3-D, no area fills for levels, no pie charts.
8. Missing data: gaps in the line, never interpolation or zero-fill (D16); a hatched band over a long gap is optional and labelled.
9. Interaction: Plot tips are pointer-only, so every chart has (a) a `<figure>` with `role="img"` and an `aria-label` that states indicator, countries, range and the latest stored value of each series, and (b) a "View as table" disclosure showing the plotted points (latest 24 periods per series, with a link to download the Parquet file for all). The tooltips are an enhancement, not the only access.
10. Dot plot (V2) and heatmap (V1) are HTML/SVG written from stored fields; no brush or zoom in v1 (WCAG 2.5.7 would require a non-drag alternative).
11. Reduced motion: no transitions on data change; hover transitions only when `prefers-reduced-motion: no-preference`.

## 7. States: loading, empty, error
- Loading: containers reserve their final height (min-height from the layout), show a short text "Loading <what>..." with `aria-busy="true"`; no spinner animation under reduced motion; no skeleton shimmer. Parquet reader libraries load only on first series read (existing); the control stays usable and the status text says "Loading the reader (about 1.8 MB compressed)" the first time [NEW WORDING; the figure is the measured gz in `spike-results.md`, T91].
- No JavaScript: a `<noscript>` block says that the dashboard needs JavaScript and links to the data status text; the static caveat and the freshness line are server-rendered where Framework allows [UNVERIFIED: Framework renders cells client-side; checked in Stage 0].
- Empty: reuse the confirmed strings (e.g. "No countries of this group have a value for this indicator in this domain."). Empty states carry a short next step (change group or indicator) in plain text.
- Error: a file that cannot be fetched or fails the schema check renders one `role="alert"` block per failed region: what could not be loaded (the logical name, not the URL or raw error text), the consequence ("the table below is not shown"), and the tier fallback ("the scorecard needs only the small files; the explorer needs the series file"). Unknown manifest major keeps the current behaviour (page shows the error). Never partial numbers.
- Stale: the existing banner (45 days on `known_cutoff`), moved into the shell and shown on every page; its wording stays.

## 8. Accessibility (WCAG 2.2 AA target)
Facts: 1.4.11 Non-text Contrast needs 3:1 for UI components and graphical objects, with unrounded ratios [DOC: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html]; 1.4.1 forbids conveying information by hue alone (same page). WCAG 2.2 adds 2.4.11 Focus Not Obscured (Minimum, AA), 2.5.7 Dragging Movements (AA), 2.5.8 Target Size (Minimum, AA, 24 x 24 CSS px); 2.4.13 Focus Appearance is AAA; 4.1.1 Parsing is removed [DOC: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/]. 1.4.10 Reflow: 320 CSS px wide without two-dimensional scrolling, with an exception for data tables, and a table in its own scrollable container is a passing approach [DOC: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html]. 1.4.3 text contrast 4.5:1 (3:1 for large text) is from the WCAG text [UNVERIFIED: not fetched this session].
- Contrast targets: body and table text 4.5:1 in both themes; every bin ink on its fill 4.5:1; borders, glyphs, focus ring, chart lines and markers 3:1 against the adjacent surface; hatch and dotted borders 3:1.
- Focus: a 2 px outline plus 2 px offset in `--mm-focus`, visible on every control and on heatmap cells that take focus; sticky header and sticky first column use `scroll-padding` equal to their size so a focused cell is never hidden (2.4.11); the focus style aims at the AAA 2.4.13 geometry as a free bonus, not as a claim.
- Targets: controls at least 24 x 24 px (2.5.8), 44 px on coarse pointers; checkboxes in the country fieldset have a full-row label.
- Tables: every table has a `<caption>`; header cells use `<th scope="col|row">`; the heatmap IS a table (country = row header, indicator = column header), so a screen reader reads "Germany, Unemployment rate, 0.70"; sortable headers are `<button>` elements inside `<th>` with `aria-sort`; sticky positioning does not change reading order; no layout tables; row groups (`<tbody>` per group) for aggregates.
- Colour never alone: section 5; the legend is text.
- Keyboard: all controls reachable in DOM order; the cell popover opens on focus and closes with Escape; no keyboard trap; skip link first; heatmap cells are focusable only when they carry a popover (tabindex roving is out of scope in v1, so the table has one tab stop per interactive cell; the detail table gives the same facts without any cell focus, so skipping the matrix is possible via the skip link "Skip to values table").
- Screen readers: landmarks (header, nav, main, footer); one `h1` per page, ordered headings; live region only for the stale banner (`role="alert"`) and the error blocks; chart alternatives per section 6.9; abbreviations ("n/N", "EA") expanded in `title`/`aria-label` on first use.
- Language: `lang="en"`; the numbers use a fixed locale format (thousands separator as today) so a screen reader pronounces them consistently.
- Preferences: `prefers-color-scheme`, `prefers-reduced-motion`, `forced-colors` (state shapes and borders are kept; fills may be dropped and the numbers stay), `prefers-contrast: more` (thicker borders; optional).
- Text spacing (1.4.12): no fixed-height containers for text.

## 9. Responsive behaviour
Breakpoints (rem): compact < 40, medium 40-64, wide > 64. Compact: single column; the nav wraps; controls stack; heatmaps scroll horizontally inside their own container with a sticky country column and a visible "scroll for more indicators" hint (data tables are excepted from 1.4.10 [DOC above]); the V2 table becomes a list of cards (country, percentile, reference offset, mark) because three columns fit; the V3 selection is collapsed; charts use full width with a taller aspect ratio and end labels move into the legend-less facet titles. Medium: heatmap shows all columns with abbreviated column headers (full name in `title` and in the detail table). Wide: left-rail explorer.
Touch: hover content is also available on tap/focus; no function depends on hover.

## 10. Print
`@media print`: light tokens forced regardless of theme; navigation, controls, banner buttons hidden; `<details>` expanded; heatmaps scaled to the page width with `print-color-adjust: exact` for bin fills and patterns kept (the numbers and glyphs carry the meaning in greyscale); each page footer prints the freshness line (known_cutoff, build id), the caveat, the Sources block and the page URL; table rows do not break across pages; charts print as static SVG with direct labels. Test: AC-UX-9.

## 11. Microcopy rules
- One module `site/src/lib/copy.js` holds every user-facing string that has been fixed or confirmed; views import from it; a test asserts each fixed string verbatim.
- FIXED by the spec (never reworded): the standing caveat "Percentiles are relative position in the covered panel, not a judgement of structural quality"; the column label "percentile vs all ranked countries"; the domain figure label "mean percentile of the domain's indicators" and the sentence that it is not the percentile of the domain; the M18 note "local-currency yield spread (includes inflation/FX expectations), not sovereign credit risk"; the V4 text of export spec section 7 and the label "earliest stored version"; the words "first release" and "first stored release" never appear.
- CONFIRMED by the user on 2026-11-04 in `spike-results.md` (T89-T93 sections): all wording of V1 cells, V2 labels/notes/spread sentence/group labels/sort labels, V3 control labels/notes/titles/not-shown reasons, V4 notices/titles/filters/empty texts, V5 titles/notes. These stay as they are; the redesign changes layout, not these strings.
- NEW wording proposed by this brief (needs confirmation, section 13): legend labels for the five percentile bins ("lowest fifth of the panel" .. "highest fifth of the panel", derived from the fixed bin edges, no judgement words), state codes in cells ("stale", "lagging", "unaligned", "n/a", "np"), the "ahead" tag text, "View as table", "Skip to values table", "Selection", the loading and error sentences of section 7, the print footer, the heatmap caption.
- Style: sentence case, no exclamation marks, no words of judgement ("good", "bad", "strong", "weak", "healthy", "risky") next to a percentile or colour; no ranking verbs for unranked states; numbers with units; dates as ISO `YYYY-MM-DD` with periods as stored.

## 12. How the design respects the constraints
| Constraint | How |
|---|---|
| D6 (display only) | Every encoding maps one stored field; bins use fixed constants; sorting uses stored fields; no mean, sum, rank, "overall", min/max statistics except the display scale of a bar (labelled); static scan of new modules for arithmetic helpers and the banned words, as already done for V2-V4; AC-UX-10 compares rendered heatmap numbers with the scorecard JSON |
| No off-origin request | font file same-origin; no CSS `@import url(http...)`, no icon CDN, no analytics, no map tiles (no choropleth map in v1; a map would need boundary data, ~100 KB+ and a licence decision) ; AC-UX-11 extends AC-DASH-1 |
| 1.5 MB landing limit | no new JS library; CSS target <= 20 KB gz; font about 90 KB [SEARCH]; heatmap is HTML; internal target <= 600 KB gz for the landing set including all domain scorecards, hard limit stays 1.5 MB; AC-UX-12 |
| 5 MB per interaction | unchanged; no new data fetched by styling; "View as table" uses data already loaded |
| ADR-024 no new dependency | no `@fontsource`, no axe-core, no `@playwright/test`, no icon or colour library (the colour tables are written by hand); ADR needed before any of these |
| Public, non-commercial Pages | no tracking, no ads, no sign-up |

## 13. Open questions
See the ADR, section "Open questions for the user".

## 14. Staged implementation order (input for a later plan)
Stage 0 - foundation (gate: first real export available, or fixture density agreed). Tokens and `style.css` wired through Framework's `style` option; light/dark; typography decision applied (system stack or Inter file + licence + measurement); global shell (nav, skip link, freshness line, banner, footer, print base); `copy.js` with the fixed strings; contrast script; harness for AC-UX-1, -9 (partly), -11, -12. Remove the per-renderer `<style>` strings.
Stage 1 - state vocabulary and heatmap component (pure HTML table renderer, fixture-driven), used by the V1 domain page; legend; detail table in `<details>`; AC-UX-2, -4, -5, -10 for V1.
Stage 2 - landing heatmap (country x domain) after the AC-UX-12 weight check; fallback to the domain list.
Stage 3 - V2: dot plot restyle, radio group for groups, URL hash focus, mobile cards.
Stage 4 - V3: chart rules (direct labels, small multiples, vintage cues, rebase marks), figure alternatives and "View as table", left rail layout.
Stage 5 - V4 and V5: signed bars, class marks, step chart for vintages, status chips.
Stage 6 - print stylesheet, forced-colors/reduced-motion polish, responsive pass at 320 / 768 / 1280, cross-browser manual check (Firefox, Safari), screen-reader manual check, recorded in `docs/ops/`.
Each stage ends with: build, `npm test`, the smoke tests, `check:imports`, the landing measure; no stage changes the export contract.
