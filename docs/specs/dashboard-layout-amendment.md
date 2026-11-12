---
status: approved   # approved by the user on 2026-11-10 (stated in session: "yes"), with the answers to ADR-034 Q1-Q8 recorded in the ADR, including Q4 = configured headline flag `tile_headline` (CR-14; renamed from "CR-2" by ADR-034 amendment A1, pending user confirmation)
inputs:
  - docs/design/adr/ADR-034-analytics-dashboard-layout-filter-bar-and-cards.md
  - docs/design/adr/ADR-036-hidden-rows-disclosure.md   # approved by the user 2026-11-10; folded into 2.2, 2.4, 6, 7, AC-DB-03, AC-DB-22, AC-DB-36, section 10
  - docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md
  - docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md
  - docs/design/adr/ADR-026-percentile-orientation-legend-and-dashboard-display-rules.md
  - docs/design/adr/ADR-010-interactive-dashboard.md
  - docs/design/adr/ADR-023-dashboard-toolkit-observable-framework.md
  - docs/design/adr/ADR-024-observable-framework-as-site-build-tool.md
  - docs/specs/dashboard-redesign-spec.md
  - docs/specs/dashboard-export-spec.md
  - docs/ops/dashboard-redesign-decisions.md   # CR-1 line only
---
# Spec amendment: analytics-dashboard layout (filter bar, KPI tiles, comparison cards, heatmap, sparklines, bands, card surface)

Date: 2026-11-09. Labels as in ADR-034 ([REPO], [USER], [UNVERIFIED]). Section numbers "RD x" refer to `docs/specs/dashboard-redesign-spec.md`. This amendment reads only the files of `docs/specs/dashboard-export-spec.md`; it changes no export file except by the change requests of section 9 (CR-15 and CR-14, and CR-1 in phase B), each only after the user approves its export-spec edit.

## 1. Scope and precedence
1. What is amended: RD 4.1 (home) is replaced by section 4.1 below; RD 1.5 (hash grammar) is extended by section 2.3; RD 1.6 (allow-list) is extended by section 6; RD 4.2-4.4 keep their components, arranged as in section 4; RD section 7 gains the strings of section 7; RD AC-RD-53 is re-measured for the new home page.
2. What is kept unchanged: RD 1.1-1.4, 5.1-5.6, 6, 8, 9 (CR-2 to CR-10), 11, and every acceptance criterion of RD section 10 not named here. In particular D6 (RD 1.1, AC-RD-50), data-only (RD 1.6, AC-RD-62), missing-data sentences (RD 5.1), units (5.2), reference dates (5.3), point reader and tips (5.6), no new npm dependency (AC-RD-52), no off-origin request (AC-RD-51).
3. If this amendment and RD conflict on a point not listed in 1.1, RD wins and the conflict is reported.

## 2. Filter bar (component C-FB)

### 2.1 Controls (all native; no new dependency)
| Control | Label (DRAFT) | Widget | Hash | Source of options |
|---|---|---|---|---|
| Group | "Group" | `<select>`: "All countries" (default), then `meta/groups.json` groups, in stored order | `g` | `meta/groups.json`; "All countries" = entities with `kind = country` |
| Country | "Country" | multi-select chip: `<details>` with a text filter and a checkbox list (countries, then a sub-list "Aggregates"); up to 5 selected; default "All countries" = none selected; multi-select on PG-HOME and PG-SERIES only (ADR-034 A1 item 3, pending user confirmation) | `c` | `meta/entities.json` (not `is_global`); restricted to the Group's members when `g` is set |
| Domain | "Domain" | `<select>`: "All domains" (default), then domains in `meta/domains.json` order | `d` | `meta/domains.json` |
| Indicator | "Indicator" | `<select>` grouped by domain (names, unit beside the name), narrowed by Domain and Frequency | `i` | `meta/indicators.json` |
| Period | "Period" | chip: `<details>` with two year `<select>`s (From, To) and presets "All", "Last 10 years", "Last 5 years" | `from`, `to` | years between `manifest.history_start` and the year of `manifest.known_cutoff` |
| Frequency | "Frequency" | `<select>`: "All frequencies" (default), then D, M, Q, A as "Daily", "Monthly", "Quarterly", "Annual" for values present in `frequency_set[]` | `f` | `meta/indicators.json` `frequency_set[]` |
| Reset | "Reset filters" | button | clears all | |

### 2.2 Semantics (filters only filter, select and clip; D6)
- Group and Country select entities. Domain selects by `domain_ids`/`indicator_ids`. Indicator selects one indicator. Frequency keeps indicators whose `frequency_set[]` contains the value, and series whose stored `frequency` equals it; no resampling. Period clips the x-domain of time-based cards and sparklines to `from`..`to` (inclusive years of `ref_period_end`); it never changes or recomputes a snapshot value. On the cards that Period row-filters, and only on them, C-RANK (PG-HOME) and C-TABLE (PG-HOME, PG-COUNTRY), scorecard rows whose latest `ref_period_end` year is outside `from`..`to` are hidden, and the card shows the hidden-rows disclosure (ADR-036; user answer to ADR-034 Q3, 2026-11-10). No other card hides rows by Period: C-HEAT and C-KPI are not row-filtered by Period, and history panels, sparklines, small multiples and time-series charts are clipped as a range only (ADR-036, user decision 2026-11-10).
- Hidden-rows disclosure (the one D6 exception; ADR-036 decisions 1, 2 and 4, approved by the user 2026-11-10, normative by reference): when N > 0 the card shows, directly under its title and before its body, a `<details class="mm-hidden-rows">` inside a `role="status"` wrapper; its `<summary>` is the hidden-rows sentence `DRAFT_HIDDEN_ROWS(N)` (section 7) and its body lists exactly the hidden rows, one `DRAFT_HIDDEN_ROW_ITEM(name, period)` each (display name as on the card, entity name on C-RANK and indicator name on C-TABLE, as a link with the carried hash `data-carry`; stored reference period formatted as RD 5.3; order by name A to Z, ties by id, via `sort.js`; no value, percentile, bin colour or state chip). N = 0 renders no element (default Period "All" gives N = 0). N comes only from `countPeriodHiddenRows(rows, from, to)` in `site/src/lib/filter-model.js`; the list is the `hidden` array of one `splitByPeriod(rows, from, to)` call with the same arguments, so N equals the list length; inputs are the card's loaded rows after Group, Country, Domain, Indicator and Frequency filters plus `from`/`to`, nothing else; a row without `ref_period_end` is never hidden and never counted; the view decides visibility only by `DRAFT_HIDDEN_ROWS(N) !== ""` and reads no `.length` of the hidden list (ADR-036 invariants I1-I7). The summary prints; the list prints only when opened. The exception wording of ADR-036 decision 2 is in RD 1.1; no other browser-side count of entities, rows or states exists (AC-DB-22, AC-DB-36).
- Group `<select>` is kept (comparison set, default "All countries"); there is no single "Scope" control (ADR-034 A1 item 3).
- Presets: "Last 10 years" = `to` = year of `known_cutoff`, `from` = `to` - 9. This is calendar arithmetic on a stored date, not on data.
- A selection that leaves a card empty shows that card's empty state (section 5.4), never a blank.
- Group and Country combine as intersection: Country ids outside the Group's members stay selected as the focus but the Group still defines the comparison set; a Country outside the Group is shown in the comparison card as the "in focus" row (outlined), as RD C-IND-3 does today.

### 2.3 Hash grammar (extends RD 1.5; same parsing rules: valid parts kept, unknown or repeated key or malformed id ignored with the fallback note)
`#i=<indicator_id>&c=<entity_id>[,...]&g=<group_id>&d=<domain_id>&f=<D|M|Q|A>&from=<YYYY>&to=<YYYY>`. `from` and `to` are valid only as a pair with `from <= to` and within the bounds of 2.1, otherwise both are ignored with the fallback note. Written with `replaceState` after a user change only, never on load, only when the serialized hash differs (RD 1.5 rules); the serialized order is fixed as above so one state gives one hash. Pass-through: a page ignores (does not drop) parameters it does not use, and the bar rewrites cross-page links of class `data-carry` (country names, indicator names, header navigation) on click so that the current hash follows the user (links work without the hash when JavaScript is off). PG-SERIES keeps its rule that `g` is ignored and not written, and that transform, rebase and free-axis are not in the hash (RD 1.5).

### 2.4 Applicability by page (a control that does nothing on a page is not rendered)
| Page | Group | Country | Domain | Indicator | Period | Frequency |
|---|---|---|---|---|---|---|
| PG-HOME (dashboard) | filters peer set | focus (tiles) / series list | selects heatmap and tiles | selects comparison card | hides rows on C-RANK and C-TABLE (ADR-036); clips the x-domain of C-SERIES, small multiples and sparklines | indicator list, heatmap columns |
| PG-COUNTRY | not shown | switcher (navigates; replaces `DRAFT_COUNTRY_SWITCHER_*` control) | shows only that domain's sections | not shown | hides rows on the indicator table (C-TABLE, ADR-036); clips history panels and sparklines | filters table rows by series `frequency` |
| PG-INDICATOR | peer group (RD C-IND-1) | focus (RD point reader) | not shown | switcher (navigates) | not shown | not shown |
| PG-SERIES | not shown (RD 1.5) | multi-select, up to 5 | narrows indicator list | selects series | x-domain (RD years) | narrows indicator list and series |
| PG-DOMAIN | peer set | not shown | fixed by path, not shown | not shown | not shown | heatmap columns |
Country is a multi-select (up to 5) on PG-HOME and PG-SERIES only; on PG-COUNTRY and PG-INDICATOR it is a single-entity switcher or focus (ADR-034 A1 item 3, pending user confirmation). Where Period hides scorecard rows (C-RANK on PG-HOME; C-TABLE on PG-HOME and PG-COUNTRY), the hiding card shows the hidden-rows disclosure of 2.2 (ADR-036).
Navigating switchers (PG-COUNTRY, PG-INDICATOR) keep RD's explicit "Go" button behaviour (WCAG 3.2.2).

### 2.5 Behaviour and accessibility
- Markup: `<form role="group" aria-label="Filters">` (no `role="search"`: nothing is searched); labelled controls; chips are `<details>/<summary>` whose summary text shows the current value ("Period: 2015 to 2025"); Escape closes an open chip and returns focus to its summary; a click or focus outside closes it; no focus trap; no drag-only interaction (WCAG 2.5.7); targets at least 24 x 24 CSS px (2.5.8).
- Sticky: `position: sticky; top: 0`, bar height reserved at first paint (CLS at most 0.1); `scroll-padding-top` and `scroll-margin-top` equal the bar height so a focused element is never covered (WCAG 2.4.11, AC-UX-4). Sticky table headers and the heatmap's sticky column offset by the bar height.
- Compact (below 40 rem): the bar shows the summary chips on one row and the controls inside one "Filters" `<details>`; it is sticky as a one-row bar only.
- Reduced motion: no transition. Forced colors: chips keep a border.
- Print: the bar is hidden; one line "Filters: <control label>: <value>; ..." (active filters only; "none" when all are default) is printed under the freshness line (extends ADR-025 decision 9).
- Static HTML without JavaScript: the bar is not in the build output; the no-JS notice is (RD AC-RD-05).

## 3. Card surface and layout tokens (extends ADR-025 decision 1, `site/src/style.css`)
- New tokens (candidate hex values, proven only by AC-UX-1): `--mm-canvas` (light grey page background; light #eef1f5, dark #0b0f14), `--mm-card` (white; dark #131920), `--mm-card-border` (decorative edge, 1 px), `--mm-band-bg`, `--mm-band-ink` (section band; neutral, not a state or percentile colour), `--mm-tile-number-size` (2rem, tabular figures). Body text on card and on canvas at least 4.5:1; control borders keep `--mm-border` at least 3:1. The percentile and state tokens are unchanged (no new use of colour as meaning).
- Classes: `.mm-grid` (12 columns at 64 rem and above, 6 at 40 rem, 1 below; gap `--mm-space-4`), `.mm-card` (white surface, `--mm-radius`, padding `--mm-space-4`), `.mm-card--span-N` for N in {3, 4, 6, 8, 12}, `.mm-band` (full-width band with the section name as a real `h2`, optional right-aligned link). A card has a `h3` title (name only), optional subtitle line (unit, reference period, source: stored fields), body. Cards never nest. Card min-heights are reserved per card type to hold CLS.
- Cards and bands are layout only: they add no text beyond names and stored values (RD 1.6).
- Weight: CSS at most 20 KB gzipped (AC-UX-12). The measured value is recorded; if exceeded, the raise is the user's decision (ADR-034 Q6).

## 4. Pages and cards

### 4.1 PG-HOME as the dashboard (replaces RD 4.1)
Order, each section a band:
- C-HOME-1 (kept): title `h1` "Macro Monitor" is withdrawn; the page `h1` is the static `h1` of `index` with the text "Macro dashboard" (DRAFT, section 7; ADR-034 A1 item 5, pending user confirmation). Standing caveat (one line) and freshness line (shell) at the top; the orientation note (one line) once, directly above the heatmap card, because percentiles are shown there.
- C-FB: the filter bar of section 2 (sticky, directly under the header block).
- Band "Overview": C-KPI tiles (4.6), when the Country filter resolves to exactly one entity; otherwise one placeholder card holding the sentence "Choose a country to see its key indicators." (section 7).
- Band "Compare": C-RANK (4.7) for the selected Indicator, span 8; beside it, a facts card (span 4) with the indicator's stored `unit_label`, frequency set, direction label (ADR-026 decision 4), the stored reference-period line (RD C-IND-2) and `notes[]` verbatim.
- Band for the selected Domain (title = domain name from `meta/domains.json`): C-HEAT (4.8) full width.
- Band "Indicators": C-TABLE (4.9): table of the selected Domain's indicators for the focus country, with Trend column (phase B). Shown when one Country is in focus; otherwise omitted.
- Band "Over time": C-SERIES (4.10): the Country selection (up to 5) on one chart, or small multiples for the comparison set (4.10).
- Band "Browse": a collapsed `<details>` with RD C-HOME-2 (countries) and C-HOME-3 (indicators) exactly as built (static links, text filters), and RD C-HOME-4 links. Present in the built HTML (AC-RD-02, AC-RD-05).
- C-HOME-5 remains withdrawn.
- Defaults (no hash): Group "All countries", Domain = the top-level `default_domain` of `meta/domains.json` (CR-15, section 9; recommended value `growth`; ADR-034 A1 item 4, pending user confirmation), falling back, when the field is absent or names an unknown or unranked domain, to the first domain with `ranked = true` in stored order (stored order is `domain_id` alphabetical; its first entry, `agri`, is unranked and is never the default), Indicator = first of that domain's `indicator_ids`, Country empty, Period "All", Frequency "All". Data loaded on first load: `manifest`, `status` (shell), `meta/*`, `scorecard/<default domain>.json` only. A change of Domain loads that domain's scorecard (cached after load); an Indicator in two domains reads the first of its `domain_ids` (AC-RD-24 rule). History (Parquet) loads only on the explicit "Load history" action of C-SERIES (one file per activation, RD AC-RD-14) unless CR-1 phase B supplies the arrays.

### 4.2 PG-COUNTRY arrangement
Bands per domain (domain name, link to PG-DOMAIN) in `meta/domains.json` order. Each band: left card (span 4) the domain figure line (RD C-CTRY-1) as a KPI-style tile (4.6, domain-figure type); right card (span 8) the dot strip (RD C-CTRY-2); below, full-width card with the indicator table (RD C-CTRY-3, C-CTRY-4) with Trend column in phase B. Header card: entity name `h1`, group memberships, kind, the filter bar (section 2.4). Caveat and orientation lines at the top (RD C-CTRY-6). "Show: all / only indicators with a value" (RD 4.2) stays as a control of the table card.

### 4.3 PG-INDICATOR arrangement
Header card: `h1`, domain links, unit, frequency set, direction, notes (RD 4.3 header). Bands: "Compare" (value chart RD C-IND-3 in the card of C-RANK, percentile dot plot RD C-IND-4 beside it), "Table" (RD C-IND-5 with Trend column in phase B and the reference-row group of 4.7). Controls of RD C-IND-1 (peer group, sort) move into the filter bar (Group) and the C-RANK card header (sort).

### 4.4 PG-SERIES
Controls of RD C-SER-1 stay in the left rail on wide screens; Group is not shown; Domain, Frequency and Period are added to the bar and drive the same indicator picker, years and series list. RD C-SER-4, C-SER-5, C-SER-6, C-SER-7 unchanged. Addition: a chart-type toggle "Lines" / "Bars" (radio group) that applies when exactly one series is selected: "Bars" draws one bar per stored period (`barY`, stored `value`, estimate bars hollow outline, unit on the axis); with more than one series the toggle is hidden. The point reader and table alternative apply to both chart types unchanged.

### 4.5 PG-DOMAIN and PG-DOMAINS, PG-REVISIONS
PG-DOMAIN: the V1 heatmap (C-HEAT) inside a card under a band, filter bar per 2.4. PG-DOMAINS: list of domains as a card grid (name, `notices[]`, link). PG-REVISIONS: only the canvas, band and card surface; content unchanged.

### 4.6 C-KPI tiles (card span 3; two per row from 40 rem, one below)
- Indicator tile: title = indicator name (link to PG-INDICATOR with the carried hash); big number = stored `value` formatted (`published_precision` hint) with its unit text beside it (RD 5.2); subtitle line = reference period (RD 5.3) and, when `ref_offset_days` is not 0 or null, the offset flag; percentile chip = ADR-026 bin token with the stored number, or the state code with its sentence (RD 5.1); estimate or inherited mark (RD 5.4); the Trend sparkline in phase B; a link "Time series" (RD `DRAFT_SERIES_LINK_LABEL`) to PG-SERIES with `#i` and `#c`. No delta, arrow, rank, or good/bad colour. A tile for a row without a value shows the state code and sentence instead of the number.
- Domain-figure tile (ranked domains only): title = domain name; big number = stored `percentile_rank` as stored (RD C-CTRY-1 formatting) with the stored `percentile_rank_label` as subtitle; line "n_available of n_defined" as stored; position as stored unless `low_coverage` (RD rule). A small bar of `n_available` against `n_defined` is allowed as a display scale of two stored numbers with both printed; it is not a percentage and no percent sign is printed. Aggregates: the "not ranked" wording.
- Selection: if `i` is set, that indicator's tile first; then the Domain's indicators in `indicator_ids` order; at most 8 tiles; Frequency filter applies. Tiles are selected by the configured flag `tile_headline` (CR-14, section 9; `config/indicators.yaml` -> `meta/indicators.json`, config-only, no `ref.indicator` column; ADR-034 A1 item 2, pending user confirmation), not by `priority`: `priority` is the DDL class (`core|ext|opt|dropped`) and has no display meaning. Until CR-14 is exported (phase A), order is `indicator_ids` order.
- The tile row never shows a count of tiles or entities and no tile combines domains (U1).

### 4.7 C-RANK ranked country comparison card
- Header: title = indicator name; unit text subtitle; a sort `<select>` "Country (A to Z)" (default), "Value", "Percentile" (RD C-IND-1 sort rules: stored fields, nulls last, ties by name; `aria-sort`/accessible state on the select's output text), and the chart-form switch is automatic (below).
- Body: scroll container (max-height set by CSS; sticky header row). One row per entity in the comparison set (Group intersect scope) in two groups: countries, then a "Reference rows" group containing stored aggregate entities (`kind = aggregate`, for example EU27 and EA) in the sort order, styled apart (a top border and a label), and never summed or averaged with anything. Rows without a value come last with their state code and sentence (RD 5.1) and are never dropped (RD C-IND-5 rule).
- Row: country name (link to PG-COUNTRY, carry), horizontal bar (see below), stored value with unit, reference period and offset flag, percentile chip (stored number or state), estimate mark, "About this value" `<details>` (RD 5.5).
- Bar form: bar length = stored `value` on one shared axis only when all rows share one unit: after CR-5, `unit_text_varies = false`; until CR-5, `unit_label` contains a single unit code (no ", "). When units differ, the bar axis is not drawn and each row shows the percentile dot (RD C-IND-4 form) plus the value as text with its row unit. Bars fill with the percentile bin token (neutral without a percentile); country in focus outlined.
- No top-N cut and no "best/worst" label: the full list scrolls. No Total row, no average row.
- Tip and keyboard: the RD 5.6 point reader (Country select) applies; a hover tip shows name, value, unit, period.
- Table alternative: "View as table" (RD C-IND-5 columns) inside the card.

### 4.8 C-HEAT heatmap card
The V1 heatmap (HTML table, ADR-025 decision 4, built as `heatmap-view.js`) for the selected Domain and the comparison set: rows = entities (countries, then the aggregate group), columns = the Domain's indicators narrowed by Frequency; leading column = stored `percentile_rank` with its label (RD C-CTRY-1 formatting); sticky first column and header (offset by the filter bar); legend of the five bins and the orientation note once; column header = indicator name (link, carry) with direction label (ADR-026 decision 4); row header = entity name (link, carry); cell = bin token, stored number or state code, signature (ADR-025 decision 3), and the state sentence as the cell's accessible description. No overall column, no row aggregate, no cross-domain composite. Horizontal scroll only inside the card (AC-UX-6). With 44 rows the card has a max-height with its own vertical scroll.

### 4.9 C-TABLE indicator table with sparklines
The RD C-CTRY-3 table (columns kept) plus a Trend column after Latest value:
- Sparkline: inline SVG, width 96 CSS px, height 24 CSS px, drawn with d3 `scaleLinear` and `line` from the stored `recent` array (CR-1, section 9); y-extent per row from the stored values drawn (display scaling); polyline, a filled dot on the latest value (hollow when `value_kind = estimate`), no area fill, no colour by direction, stroke token `--mm-series-1`; `null` entries break the line (no interpolation, D16).
- Period filter clips the drawn values to the years in range; if fewer than 2 values remain the cell shows an en dash and the sentence "Too few values in the selected period." (section 7).
- Accessible name (`role="img"`, `aria-label` from one text function shared with the table alternative): "<indicator>, <unit>: <first drawn value> in <first period> to <last drawn value> in <last period>" (stored values only; no word like rising or falling).
- Phase A (no CR-1): the column is not rendered; nothing else changes.

### 4.10 C-SERIES time-series card
- Country selection of up to 5 and the selected Indicator: the Plot line chart of RD C-SER-4 (tip, end labels with unit, point reader, table alternative), data from the series Parquet file loaded by the explicit "Load history" button (RD AC-RD-14 behaviour; the Parquet reader counts as the one interaction, at most 5 MB).
- No Country selected: small multiples for the comparison set, one facet per entity, shared y-axis and unit, drawn from `recent` arrays (phase B, no Parquet) or, in phase A, after "Load history". At most 12 facets are drawn; a "Show more" button adds the next 12 (no count printed). Facets are sorted by the C-RANK sort. Each facet has the entity name as title and the latest stored value as a label; hover tip and point reader per RD 5.6.
- Bars toggle as 4.4.
- The cap of 5 overlaid lines is unchanged (ADR-025 decision 6).

## 5. States
1. Loading: card-level busy blocks with reserved height, `aria-busy`, text (existing `busyBlock`), no shimmer.
2. Error: a failed file shows the existing `role="alert"` region inside the affected card only; other cards stay (extends RD AC-RD-14 behaviour; ADR-025 decision 10 wording unchanged).
3. No-JS: notice only (the Framework renders cells in the browser); the "Browse" section links are in the HTML.
4. Empty card (a filter combination with no rows): the card keeps its title and shows the sentence "No values for this selection." (section 7); the filter bar stays; no number is invented.
5. Stale banner and freshness line: unchanged (shell).

## 6. Allow-list extension (RD 1.6)
Added to the closed list of fixed text on data pages, each a `copy.js` entry of at most 160 characters: the filter-bar control labels and options of section 2.1, the chip summary pattern, the print filters line of 2.5, the placeholder sentence "Choose a country to see its key indicators.", the empty-card sentence, the sparkline sentence "Too few values in the selected period.", the group labels "Reference rows" and "Browse", the hidden-rows sentence `DRAFT_HIDDEN_ROWS` (singular and plural forms) and the list item `DRAFT_HIDDEN_ROW_ITEM` (ADR-036; the one count sentence, 2.2), the home `h1` "Macro dashboard" (DRAFT; pending user confirmation), and the band titles of 4.1 ("Overview", "Compare", "Indicators", "Over time"). Card titles are indicator, domain or entity names. No other prose is added; the facts card of 4.1 carries stored fields and `notes[]` verbatim only.

## 7. New strings (all DRAFT until the user confirms them, ADR-025 decision 11; in `site/src/lib/copy.js`)
"Filters", "Group", "Country", "Domain", "Indicator", "Period", "Frequency", "All countries", "All domains", "All frequencies", "Daily", "Monthly", "Quarterly", "Annual", "From", "To", "All", "Last 10 years", "Last 5 years", "Reset filters", "Aggregates" (exists, confirmed), "Overview", "Compare", "Indicators", "Over time", "Browse", "Reference rows", "Load history", "Show more", "Lines", "Bars", "Choose a country to see its key indicators.", "No values for this selection.", "Too few values in the selected period.", the hidden-rows sentence `DRAFT_HIDDEN_ROWS(n)`: n = 0 -> "" (no sentence), n = 1 -> "1 row hidden by the period filter", n > 1 -> "<n> rows hidden by the period filter", and the list item `DRAFT_HIDDEN_ROW_ITEM(name, period)`: "<name>: latest value <period>" (for example "Germany: latest value 2019 Q4") (ADR-036 decision 5; wording confirmed by the user 2026-11-10), "Macro dashboard" (home `h1`; pending user confirmation). Existing confirmed strings (caveat, orientation note, "Choose a country", "Data cut-off", state codes and sentences, "Time series: <indicator>, <country>") are reused verbatim. The `h1` text of the home page: "Macro dashboard" (DRAFT, ADR-034 A1 item 5, pending user confirmation).

## 8. Acceptance criteria (new, prefix AC-DB; test layers as RD section 11)
Filter bar
- AC-DB-01 The bar renders the controls of 2.4 for each page type and no others; labels are the `copy.js` strings; every control has an accessible name. (smoke)
- AC-DB-02 Hash: parsing, serialization order and the `from`/`to` pair rule of 2.3 are as specified; valid parts kept, rest ignored with the fallback note; `replaceState` after a user change only, never on load, `history.length` unchanged; `hashchange` re-reads; an unused parameter is passed through; `from > to` ignores both. (unit and smoke, extends AC-RD-34)
- AC-DB-03 Filtering is stored-field only: Group by `meta/groups.json`/`kind`, Domain by `domain_ids`, Frequency by `frequency_set[]` and series `frequency`, Period clips time-based cards and hides scorecard rows whose latest `ref_period_end` is outside the range on C-RANK and C-TABLE only (no other card hides rows by Period; ADR-036), and never changes a snapshot value (ADR-034 Q3); no resampling. (unit: view-model builders; static scan AC-RD-50 extended to new modules)
- AC-DB-04 Keyboard: every control reachable by Tab; Escape closes a chip and returns focus to its summary; focus is not trapped; a focused element is never covered by the sticky bar or sticky headers (2.4.11); targets at least 24 x 24 CSS px. (smoke, extends AC-UX-4)
- AC-DB-05 Sticky and compact: the bar is sticky at 1280 px and collapses to chips plus a "Filters" disclosure below 40 rem; no horizontal page scroll at 320 px; CLS at most 0.1. (smoke, extends AC-UX-6, AC-UX-12)
- AC-DB-06 Print: the bar is absent and one filters line with the active filters is present; defaults print "none". (smoke, extends AC-UX-9)
- AC-DB-07 Carry: clicking a country or indicator link carries the current hash; with JavaScript off the links work without it. (smoke, static test)

Cards and layout
- AC-DB-10 Surface: canvas, card, band and chip tokens exist for both themes and pass AC-UX-1 (text 4.5:1, control borders 3:1); no hard-coded colour outside `style.css` (AC-UX-3); each band is an `h2`, each card title an `h3`, one `h1`, heading order valid. (contrast script, static scan, smoke)
- AC-DB-11 Grid: 12/6/1 columns at 64/40/below 40 rem; no card clipped or overlapped at 320, 390, 768, 1280, 1920 px; cards do not nest. (smoke)
- AC-DB-12 PG-HOME default load fetches only `manifest`, `status`, `meta/*` and the default domain's scorecard (a recorded request list equals this list); a Domain change fetches only that domain's scorecard; no `series/*` request before "Load history" (phase A) or ever on the dashboard (phase B arrays). (smoke with request recording, extends AC-RD-51)
- AC-DB-13 Static content: the built `index` HTML contains the `h1`, the no-JS notice, the caveat, and the full country and indicator link lists inside "Browse"; no band or card of 4.1 is required to exist without JavaScript. (static test, extends AC-RD-05)

KPI, comparison, heatmap, table
- AC-DB-20 KPI tiles: value, unit, reference period, offset, percentile or state, estimate mark equal the stored scorecard row for sampled tiles; a row without a value shows the state code and its sentence; no tile shows a delta, arrow, rank or count; tiles appear only for exactly one Country; tile order follows 4.6. (unit and smoke)
- AC-DB-21 Domain-figure tile: the stored label, `percentile_rank`, "n_available of n_defined", position and `low_coverage` rule equal RD C-CTRY-1; the `ranked = false` domain shows no percentile; no figure combines domains. (smoke, extends AC-RD-12)
- AC-DB-22 C-RANK: one row per entity of the comparison set, none dropped; entities without a value last with state code and sentence; stored aggregate entities only in the "Reference rows" group; no Total or average row exists anywhere (static scan for those labels and for sum/mean/count helpers; the named hidden-row count function of 2.2 is the only allowed browser-side count and is the scan's single whitelisted entry, AC-DB-36, ADR-036); no top-N cut; sort options per RD AC-RD-22. (unit and smoke)
- AC-DB-23 C-RANK bars: the shared axis is drawn only when the units are the same (fixture with a mixed-unit indicator: no bar axis, per-row units shown); bar lengths are proportional to the stored value; fill equals the stored bin token. (unit and smoke)
- AC-DB-24 C-HEAT: cell number, bin and state equal the stored scorecard for sampled cells; no overall column, no row aggregate, no composite order; Frequency removes columns without deleting rows; sticky first column and header; legend and orientation note once. (smoke, extends AC-UX-10)
- AC-DB-25 Sparkline (phase B): drawn from the stored `recent` array only; `null` breaks the line; latest dot hollow for estimates; no colour by direction; accessible name equals the shared text function and contains no word of direction; fewer than 2 values in the Period shows the dash and sentence. (unit and smoke)
- AC-DB-26 Phase A: with no `recent` field in the export, the Trend column and sparkline-based small multiples are absent, "Load history" provides the facets, and no error occurs. (smoke on the current fixture)
- AC-DB-27 Small multiples: at most 12 facets before "Show more"; shared y-axis unit; each facet has an entity-name title; the point reader reaches every facet's values; the cap of 5 overlaid lines is unchanged. (smoke)
- AC-DB-28 Bars toggle: appears only with exactly one selected series; bars equal the stored period values; the table alternative has the same rows as the line view. (smoke)

Constraints
- AC-DB-30 No new npm dependency; no off-origin request; `dist/` has no URL outside the allowed namespaces (AC-RD-51, AC-RD-52, AC-NPM-3 re-run). (static scan, unit)
- AC-DB-31 Weight: first-load transfer of PG-HOME (default state) at most 600 KB gzipped target, always under 1.5 MB; one history interaction at most 5 MB; CSS at most 20 KB gzipped; measured on the sparse fixture and, when it exists, the 44-entity real export; with CR-1 the added scorecard bytes are recorded per domain (estimate: about 12 values x about 7 bytes x 44 x about 10 indicators = about 37 KB per domain uncompressed, [UNVERIFIED], analyst estimate). (measure script, extends AC-RD-53)
- AC-DB-32 Data-only: the prose scan (AC-RD-62) passes with the allow-list of section 6; no explanatory paragraph exists on any new card or band. (static scan)
- AC-DB-33 Accessibility on every changed page type: AC-UX-1 to AC-UX-9 and AC-RD-54 re-run (contrast, non-colour state signatures, themes, keyboard, semantics, responsive, states, print and preferences). Screen-reader pass of the filter bar and C-RANK recorded in `docs/ops/` (manual, extends AC-UX-14). (smoke, manual)
- AC-DB-34 Copy: every string of section 7 is in `copy.js`, DRAFT until confirmed; confirmed strings unchanged. (unit)
- AC-DB-35 Export unchanged except CR-15 (`default_domain`, phase A) and CR-14 (`tile_headline`), each only after its export-spec edit is approved; CR-1 stays phase B and is not exported before the user approves its export-spec edit (review check). (review)
- AC-DB-36 Hidden-rows disclosure (ADR-036): `countPeriodHiddenRows` is the single whitelisted browser-side count (inputs: the card's loaded rows and `from`/`to` only); for every unit-test input N equals `splitByPeriod(...).hidden.length`; N = 0 renders no element; N = 1 renders "1 row hidden by the period filter", N > 1 the plural; the disclosure lists exactly the hidden rows (name link with carried hash, stored reference period, A to Z) and nothing else; no percentage, share or total in any output; the view module reads no `.length` of the hidden list; the AC-RD-50/AC-DB-22 scans whitelist exactly this function and fail on any other count (seeded negatives incl. `hidden.length` in a view module); the summary is inside a `role="status"` wrapper. (unit, static scan, smoke)

## 9. Export change request
| ID | Needed by | Request | Status |
|---|---|---|---|
| CR-1 (existing, restated) | C-TABLE, C-KPI sparkline, small multiples (phase B) | Each scorecard entity-indicator row gains a nullable field `recent`: `{ "n": <int, at most 12>, "end": "<ref_period_end of the last element>", "v": [<float or null>, ...] }`, the last at most 12 stored periods of the row's headline series at its native frequency, oldest first, latest vintage as of `known_cutoff`, `value` column (not a transform), `null` for a missing period (no interpolation, no imputation, D16); absent rows (withheld placeholders, inherited-excluded rows keep their values as `value` does) follow the row's `published` flag; taken by slicing the published series, not computed. Minor schema bump (nullable field, export spec section 3). Slicing a published view is selection, not meaning, so export principle 3 holds | Accepted by the user as phase B (ADR-034 Q5); gated on the document sync of section 11 and on the user's approval of the export-spec edit; not exported before then. Needs a DDL-free export test (golden file). Size estimate in AC-DB-31 is unmeasured |
| CR-14 (new; ADR-034 A1 item 2) | C-KPI tile selection (4.6) | Config-only boolean `tile_headline` per indicator in `config/indicators.yaml`, exported to `meta/indicators.json`; no `ref.indicator` column, no migration; registry schema (`indicators.schema.json`, `additionalProperties: false`) gains the field. Named CR-14 because CR-2 is the projections request of RD and "headline" means the headline series (ADR-009) | Proposed, pending user confirmation (ADR-034 Q4 is a recommendation); needs an export-spec edit approved by the user; phase-4 work |
| CR-15 (new; ADR-034 A1 item 4) | PG-HOME default Domain (4.1) | New `config/dashboard.yaml` with top-level `default_domain` (recommended `growth`; must name a ranked domain), validated by a new JSON schema `src/macro_monitor/registry/schemas/dashboard.schema.json`, exported as top-level `default_domain` of `meta/domains.json` | Proposed, pending user confirmation; phase A; needs an export-spec edit approved by the user; phase-4 work |
CR-14 (`tile_headline`) and CR-15 (`default_domain`) are the phase A export changes and CR-1 is phase B (rows above); no other change request is made. CR-5 and CR-6 (proposed 2026-11-09) improve the unit test of AC-DB-23 and the units of KPI tiles if approved and are not a precondition. CR-11 (previous observation, change) is not used: deltas and arrows are not built.

## 10. Test plan additions
| Layer | What | Fixtures |
|---|---|---|
| Unit (`node:test`) | hash grammar and serialization (AC-DB-02); filter view-models for Group, Domain, Frequency, Period (03); hidden-rows count equals the hidden-list length, singular and plural sentence, list item (36); tile selection and order (20); comparison-set builder with reference rows and mixed-unit rule (22, 23); sparkline path/text function (25); tip/reader text reused | tables of stored-field combinations; a mixed-unit indicator; a frequency-mixed indicator |
| Static scans | no Total/average/sum helper, no count of entities, no banned words in new modules (03, 22, 32); no `.length` of a filtered list in view modules (36); no hard-coded colour (10); no new dependency (30) | seeded negatives |
| Build | `index` HTML content and link lists (13); CSS size (31) | existing fixture export |
| Smoke (Playwright, Chromium) | filter bar behaviour, sticky and focus (01, 04, 05, 07); cards and states (11, 20-28); request recording (12); print (06) | sparse fixture (44 entities), full 44-entity export when it exists, a fixture with `recent` arrays (phase B) |
| Manual | screen reader pass, Firefox and Safari visual check, real Print dialog | none |
Order of work for the planner (not a plan): tokens and card/band layout on the current pages (no behaviour change); filter store and bar with hash grammar on PG-HOME and PG-SERIES; C-RANK and C-HEAT cards on the home page; KPI tiles; filter bar on the entity pages; small multiples and bars toggle (phase A); CR-1 decision, then Trend column and arrays (phase B); weight measurement on the real export. Prove the reactive wiring of one card to the filter store before building the rest (ADR-034 risk).

## 11. Documents that would need updating if ADR-034 and this spec are approved (not edited here)
1. `docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md`: status line note "amended by ADR-034"; decision 2, the "no table, chart or heatmap on the home page" and landing-heatmap lines in decision 3, decision 11.
2. `docs/specs/dashboard-redesign-spec.md`: front-matter inputs and status reset to draft per its own amendment rule; RD 1.5 (grammar), 1.6 (allow-list), section 2 (PG-HOME row), 4.1 (replace), 4.2-4.4 (arrangement note), section 7 (strings), AC-RD-01/03/05/53 wording; change log entry.
3. `docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md`: decision 4 (landing heatmap), decision 7 (grid), token list in decision 1, AC-UX-12 page list.
4. `docs/design/adr/ADR-026-percentile-orientation-legend-and-dashboard-display-rules.md`: placement of the orientation note on the dashboard (one occurrence per page).
5. `docs/specs/dashboard-export-spec.md`: section 5 scorecard row and section 3 minor bump, section 4 (`meta/indicators.json` field `tile_headline`, CR-14; `meta/domains.json` top-level `default_domain`, CR-15) and, for phase B, section 5 scorecard row `recent` and section 3 minor bump, section 8 budget and EXP/AC entries (CR-1). Each edit is approved by the user before the export changes.
6. `docs/design/briefs/dashboard-ux-brief.md` (sections 4, 11, 14) and `docs/ops/dashboard-ux-baseline.md` (re-baseline after the 44-entity export loads).
7. `docs/ops/dashboard-redesign-decisions.md`: CR-1 priority line and record of the user's answers to ADR-034 Q1-Q8.
8. `docs/plans/` dashboard plan(s): new tasks after the planner phase; none edited by the architect.
9. `CLAUDE.md` repository map entry for `site/` needs no change.

## 11a. Document sync gate for phase A (ADR-034 A1 item 6, pending user confirmation)
Phase A (tokens, filter bar, home cards on the existing export, plus CR-15) may start once `docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md`, `docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md`, `docs/design/adr/ADR-026-percentile-orientation-legend-and-dashboard-display-rules.md`, `docs/specs/dashboard-redesign-spec.md` and `docs/specs/dashboard-export-spec.md` each carry an "Amended by ADR-034" note pointing at ADR-034 and this amendment. The full content edits of section 11 follow in the task that builds the affected part. The redesign spec is NOT reset to `draft` by this amendment; resetting it is the user's decision.

## 12. ADRs referenced
ADR-034 (this amendment), ADR-036 (hidden-rows disclosure), ADR-030, ADR-025, ADR-026, ADR-010, ADR-023, ADR-024, ADR-033 (own-history context, not used here), ADR-011 (forecast store, not used).
