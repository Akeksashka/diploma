---
status: approved   # draft | proposed | approved. Written 2026-11-07 by an Opus subagent on delegation from the orchestrator. Approved by the user on 2026-11-07 (stated in session: "all proposition are automatically approved"). Approval covers the proposals in this record; any ADR it names still has to be written and is approved separately.
date: 2026-11-07
inputs:
  - CLAUDE.md
  - docs/plans/dashboard-redesign-implementation-plan.md   # section 2 gates, section 4 change requests
  - docs/specs/dashboard-redesign-spec.md
  - docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md
  - docs/design/adr/ADR-010-interactive-dashboard.md
  - docs/design/adr/ADR-011-forecast-and-projection-storage.md
  - docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md
  - docs/design/adr/ADR-026-percentile-orientation-legend-and-dashboard-display-rules.md
  - docs/specs/dashboard-export-spec.md   # manifest example, principle 4
  - docs/ops/spike-results.md             # confirmed V2 wording (2026-11-04)
  - docs/ops/dashboard-ux-baseline.md     # confirmed shell wording
  - site/src/lib/{copy,hash,stale,shell,figure,value-chart,explorer,explorer-view,indicator-view,heatmap-view,peers}.js, site/src/explorer.md
  - R15 probe script (session scratchpad, r15-probe.mjs): Plot 0.6.18 tip is pointer-only
---
# Dashboard redesign: proposed decisions on the open gates (G-TIP/R16, Gate C, R13, G-STR*, G-STALE, G-Q3/G-Q4, analysis and forecast)

The user delegated these decisions to Opus with one goal: a dashboard that tells an economist something, with forecasts where the design allows them. Everything below is **proposed**. Nothing here edits an ADR, a spec, the plan or code. For each item: the decision, the reason, who must confirm it, whether an ADR is needed, and the exact `copy.js` strings. Strings marked DRAFT keep the plan's rule: DRAFT until the user confirms them (ADR-025 decision 11).

Summary table

| Item | Decision | Confirm | ADR? |
|---|---|---|---|
| 1 G-TIP / R16 | Plot pointer tip for the mouse. For the keyboard, a "Read a value" control outside the `role="img"` figure, fed by the same tip-text function, with a static highlight in the chart | User (spec 5.6 / AC-RD-30 wording) | No (ADR-030 decision 6 already makes the table the keyboard route). Spec amendment yes |
| 2a Heatmap indicator link | Keep a separate link; do not make the name a link | User (string) | No |
| 2b Ranking-period line | Reuse the confirmed `spreadText()` sentence. Delete `DRAFT_RANKING_PERIOD_LINE` | None (already confirmed); user notes it | No |
| 3 R13 hash | New note wording; separate "no values" note; `replaceState` write-back; reactive `hashchange` | User (strings, behaviour) | No |
| 4 G-STR1 | "This export lists no series for this country and indicator." | User | No |
| 4 G-STR2 | "Data cut-off" replaces "Data as of"; date shown as YYYY-MM-DD | User | No (approved spec 5.3 names it) |
| 4 G-STR3 | One label per target: "Compare countries" goes to PG-INDICATOR; "Time series" / "Open as time series" go to PG-SERIES. "Compare with other countries" is dropped | User | No |
| 4 G-STR4 | Home links reuse the nav labels: "Time series", "Domains", "Revisions" | User | No |
| 4 G-STALE | `known_cutoff` is the correct export field. Proposed: the banner shows "data cut-off" and no field name. Until approved, keep the banner verbatim | User | **Yes**: one-line amendment of ADR-025 decision 10 ("stale banner unchanged in wording") |
| 4 G-Q3 / G-Q4 | Still open: Q3 needs the user's list; Q4 needs a real export. Decision rules below | User | No |
| 5 Analysis | Five display additions from stored fields (spec change only); CR-6 first; three new CRs | User | No for display; possibly yes for CR-12 |
| 5 Forecast | Not allowed in this version. Outline of a future ADR given; **not approved** | User | **Yes**: new ADR plus lifting the v2 deferral |

---

## 1. R16 / G-TIP: keyboard-accessible tip fallback

### Facts
- The R15 probe (session scratchpad `r15-probe.mjs`, run by the orchestrator) found that Plot 0.6.18's `tip` is pointer-only. Plot attaches no focus or key listeners and sets no `tabindex` on marks.
- Every chart is wrapped by `chartFigure()` (`site/src/lib/figure.js`) in `<figure role="img" aria-label=...>`. ADR-025 decision 6 and AC-UX-5 require this. Under `role="img"` all children are presentational, so a screen reader announces nothing inside the figure, and focusable descendants are an ARIA authoring error.
- ADR-030 decision 6 says: hover tip via Plot's pointer/tip marks; "the 'View as table' disclosure remains the keyboard and screen-reader route". Spec 5.6 and AC-RD-30 add "or keyboard focus on a chart point".

### Options weighed
- A. Make each plotted point focusable (`tabindex=0` on SVG circles, added by post-processing Plot's output). **Rejected.**
  - It breaks the `role="img"` contract: the points are presentational, so focus would land on elements with no name.
  - It creates up to about 5 x 400 tab stops on a monthly series since 1991 (WCAG 2.4.3 burden).
  - It depends on Plot's internal SVG structure, which is fragile.
- B. Make the figure a single tab stop with arrow-key roving (`role="application"` or `group`). **Rejected.** It changes the AC-UX-5 role rule, and that is an ADR-025 change.
- C. Add a keyboard point reader *outside* the figure. It is a real form control, and it drives the same tip text plus a static highlight in the chart. **Chosen.** It is native HTML: no dependency, screen-reader readable, and no drag. It leaves `role="img"` intact. One pure function produces the text for both pointer and keyboard, so the two cannot drift.

### Decision: implementation shape (R16)
1. **One text source.** New pure module `site/src/lib/tip.js`:
   - `seriesTipLines(point, series)` returns `[countryName, periodLabel, valueWithUnit, statusLine?, knownAtLine]`.
   - `valueTipLines(row)` returns `[countryName, valueWithUnit, periodLabel]` for the PG-INDICATOR bar chart.
   - `tipText(lines)` = `lines.join("\n")`, used by Plot `title`. `readerText(lines)` = `lines.join("; ")`, used by the `<output>`.
   - `valueWithUnit` is the **same `valueText` the "View as table" row shows** for that point. So under display-only rebase it is the rebased value with `REBASED_UNIT`. Otherwise it is the stored value plus the 5.2 unit text and the estimate mark from `markedValue()`.
   - The period label comes from `period.js`. `known_at` is shown as YYYY-MM-DD.
   - No difference, change, rank or other arithmetic. The static scan of AC-RD-30/50 covers `tip.js`.
2. **Pointer tip.** One tip mark per chart, not one per series:
   - PG-SERIES: `Plot.tip(allPlottedPoints, Plot.pointer({x: "date", y: "value", fy, title: (p) => tipText(seriesTipLines(p, p.series))}))`. Use `pointer`, not `pointerX`, so that exactly one point (the nearest) is described when lines overlap.
   - PG-INDICATOR value chart: `Plot.tip(rows, Plot.pointerY({x: "value", y: "label", title: (r) => tipText(valueTipLines(r))}))`.
   - WCAG 1.4.13 (dismissible): a `keydown` Escape listener on the document adds class `mm-tip-hidden` to the figure, and CSS hides `g[aria-label="tip"]` under that class. The next `pointermove` on the figure removes the class.
3. **Keyboard point reader.** New view helper `pointReader(html, {id, series, onChange})` in `site/src/lib/point-reader.js`. It renders directly after the figure and before "View as table", outside the figure:
   - `<fieldset class="mm-point-reader" id="<id>"><legend>Read a value</legend>`
   - PG-SERIES: `<label>Country <select>` listing the plotted series in legend order. Then `<label>Reference period <input type="range" min=0 max=n-1 step=1>` over that series' plotted points. Its `aria-valuetext` is the period label. Arrow keys step through periods, Home/End jump to the ends, and a click on the track works without dragging (2.5.7). Default value: the latest plotted point.
   - PG-INDICATOR: one `<label>Country <select>` of the drawn bars, in bar order. This select **is** the existing focus control: choosing a country sets `state.focus`, outlines the bar, highlights the table row and writes `#c=` (see item 3). One concept, "country in focus", not two.
   - `<output id="<id>-output" aria-live="polite">` holds `readerText(...)` for the current choice.
4. **Static highlight.** While focus is inside the reader fieldset (`focusin` / `focusout`), the chart is re-rendered with two extra marks: `Plot.dot([selected], {r: 6, stroke: token("--mm-focus"), strokeWidth: 3, fill: "none"})` and a static `Plot.tip([selected], {x, y, fy, title})`. A static `Plot.tip` with data and no pointer transform renders its tips; the probe printed the tip group count (recheck in R16). Re-rendering at most 5 series of at most about 400 points per keystroke is cheap; R23 measures it. The figure's `aria-label` is unchanged. The reader is the accessible route; the highlight is visual only.
5. **Small multiples (more than 5 countries).** The reader lists every selected country. The highlight goes into that country's facet (`fy`).
6. **Tests.**
   - Unit `tip-text.test.mjs`: line contents for OBS/EST/PROV, rebased, null unit (must fail AC-RD-42), and equality of the tip and table `valueText`.
   - Smoke: hover shows the tip. Tab reaches the reader. ArrowLeft changes the `<output>` to the previous period's text. That text equals the matching "View as table" row. Escape hides the pointer tip.
   - Static scan: no arithmetic in `tip.js` or `point-reader.js`.
7. **Prose scan.** "Read a value" is a control label, not prose. It must be added to the spec 1.6 allow-list as a label.

### Who confirms / ADR
- User: approve the fallback and the spec amendment. Spec 5.6 and AC-RD-30 change "keyboard focus on a chart point" to "keyboard selection in the point reader below the chart". The rest of AC-RD-30 is unchanged.
- **ADR: no.** The approach stays within ADR-030 decision 6 and ADR-025 decision 6 (table route kept, `role="img"` kept, no dependency).

### `copy.js` strings (DRAFT)
```js
export const DRAFT_POINT_READER_LEGEND = "Read a value";
// labels reuse existing constants: COUNTRY_HEADER ("Country"), DRAFT_FACT_LABELS.refPeriod ("Reference period")
export const DRAFT_TIP_STATUS = Object.freeze({EST: "estimate", PROV: "provisional"}); // other value_status: no status line
export const DRAFT_TIP_KNOWN_AT = (date) => `Known at ${date}`;                     // same words as DRAFT_ABOUT_LABELS.knownAt
```

---

## 2. Gate C items

### 2a. Heatmap column header: indicator name as link, or a separate link?
- **Decision: keep the separate link** (current R11 implementation): visible text "Indicator page", accessible name "Indicator page: <name>".
- **Reason:**
  - In `heatmap-view.js` the indicator name sits inside the sort control (`head(c.indicatorId, ...)`). An `<a>` inside a `<button>` is invalid HTML (interactive content inside interactive content).
  - Turning the name into a link would remove the column's sort affordance, which ADR-026 decision 6 requires.
  - The accessible name starts with the visible text, so WCAG 2.5.3 (label in name) is met.
  - Row headers (countries) have no sort button, so there the name itself is the link (already built). The informational-domain header has no sort either; it still uses the separate link for one consistent pattern.
- **Watch item:** at real density (about 10 indicator columns) the repeated "Indicator page" adds header height. If R22 shows a 320 px problem, the fallback is a smaller visible text "Page". That only changes the string, and the accessible name is unchanged.
- **Confirm:** user (string). **ADR: no.**
- Strings (unchanged, DRAFT):
```js
export const DRAFT_HEATMAP_INDICATOR_LINK = "Indicator page";
export const DRAFT_HEATMAP_INDICATOR_LINK_LABEL = (name) => `Indicator page: ${name}`;
```

### 2b. `DRAFT_RANKING_PERIOD_LINE` vs the existing `spreadText()`
- **Decision: use the existing confirmed `spreadText()` sentence verbatim on PG-INDICATOR, and delete `DRAFT_RANKING_PERIOD_LINE`.** Keep `NO_RANKING_SPREAD` for the unranked case.
- **Reason:**
  - Spec section 7 says "the ranking-period line of C-IND-2 reuses the existing wording".
  - The existing wording is the V2 spread sentence the user confirmed on 2026-11-04 (`docs/ops/spike-results.md` line 205). The spec's quoted form ("Rankings compare ...; spread N days; common period P") is an unconfirmed paraphrase. ADR-010 decision 10 fixes the fields, not the words.
  - The confirmed sentence also prints the stored `max_ref_spread_days`, `n_ranked` and `n_unaligned`. For an economist these say how many countries the percentile is computed over and how many were excluded, which matters a great deal when only 3 countries are ranked.
- **Implementation note:** `spreadText` lives in `peers.js`, which R12 trims. Move the function unchanged to `indicator-model.js`, or to a small `spread.js`, before R12. Pin its output in a test against the confirmed sentence: "Reference-period spread of the ranked set: N days (limit M days); common reference period of the ranking D; countries ranked n; shown but not ranked because unaligned k."
- **Confirm:** none needed for the wording (already confirmed). The user should see that the spec's paraphrase is not used. **ADR: no.**
- Strings: no new string. Remove `DRAFT_RANKING_PERIOD_LINE` from `copy.js`. Optionally move the fixed parts of `spreadText` into `copy.js` as `SPREAD_HEAD = "Reference-period spread of the ranked set: "` etc., with the wording unchanged.

---

## 3. R13: invalid-hash note, write-back, `hashchange`

### Facts
- `parseHash()` (`hash.js`) drops only the invalid parts and keeps the valid ones. Example: `#i=M09&c=XXX` keeps `M09`.
- The current note "Part of the address was not valid, so the default selection is shown." is therefore wrong whenever valid parts survive.
- `selectedEntities()` silently records `dropped` when a valid country has no rows in the series file. That is a different situation: the id is valid, but this export has no values for it.
- Today the explorer reads `location.hash` once (`explorer.md` line 41). It never writes the hash and does not react to `hashchange`. PG-INDICATOR reacts to `hashchange` for focus only.

### Decision
1. **Note wording.** One note for unrecognised or malformed parts, and a second, separate note for valid countries with no rows. Both use `role="status"` and appear above the controls, as today.
2. **Write-back (PG-SERIES).**
   - After each *user* change of indicator or countries, call `history.replaceState(history.state, "", location.pathname + location.search + serializeHash({i, c}))`. Write only when the string differs.
   - `replaceState`, not `pushState`, so Back leaves the page instead of undoing each checkbox.
   - Order of `c`: the picker's display order, so the same selection always gives the same URL.
   - Nothing is written on initial load, so `/explorer` stays clean until the user acts.
   - The hash carries only `i` and `c`. This follows the closed syntax of spec 1.5. Transform, years, rebase and free y are **not** written. Adding them is a spec 1.5 change; it is offered as an option and not decided here.
   - Any notes are cleared at the first user change, because the URL is then clean.
3. **`hashchange` (PG-SERIES).**
   - Make the address reactive: `const pHash = Generators.observe((notify) => { const f = () => notify(location.hash); f(); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); });` and `initial = initialSelection(ctx, pHash)`.
   - `replaceState` does not fire `hashchange`, so there is no loop.
   - If the parsed state equals the current selection, nothing re-renders.
   - This covers a user editing the URL, a same-page link, and Back/Forward between pushed links.
4. **Indicator change keeps countries (behaviour change, recommended).**
   - Today `selectedEntities()` returns no country once the indicator differs from the hash indicator.
   - Proposed: keep the selected countries that have rows in the new file, and show the "no values" note for the rest.
   - Reason: J3 is "Germany and France on unemployment, then on CPI". Clearing the selection on every indicator switch is the main friction for that task.
5. **PG-INDICATOR.** Write `#c` (focus) and `#g` (peer group) with `replaceState` on change, and extend the existing `hashchange` handler to `g`. PG-COUNTRY keeps no hash state, because the path is the state.
6. **Cap.** No cap on `c` other than known entities. More than 5 countries give small multiples (spec C-SER-2), not an error.

### Who confirms / ADR
User (strings; item 4 behaviour). **ADR: no.** Spec 1.5 is respected; AC-RD-34 is met. Both notes must be added to the spec 1.6 allow-list, because AC-RD-34 requires a visible note but section 1.6 does not list one. That is a spec clarification for the user to approve.

### `copy.js` strings (DRAFT)
```js
export const DRAFT_HASH_FALLBACK_NOTE = "Part of this link was not recognised and was ignored.";
export const DRAFT_HASH_NO_ROWS_NOTE = (names) => `Not selected: this export has no values of this indicator for ${names.join(", ")}.`;
```

---

## 4. String gates, stale banner, Q3/Q4

### G-STR1: "No series is defined for this country and indicator."
- **Decision:** replace it with `"This export lists no series for this country and indicator."`
- **Reason:** the test is "pair absent from `meta/series.json`", so the only true statement is about this export's series list. "Is defined" invites the reader to conclude the source has no such series, which the site cannot know (for example, Eurostat-only loading today). The sentence keeps the meaning of ADR-030 decision 5 (presence check, no guess) and keeps the scope inside the data shown. The companion sentence `DRAFT_NA_DEFINED_SENTENCE` stays as it is: it is accurate and says "this export".
- **Confirm:** user. **ADR: no.** Spec 5.1 marks these sentences "DRAFT, to confirm", and ADR-030 decision 5's quoted wording only illustrates the two cases. Changing it is a wording confirmation, not a decision change.
```js
export const DRAFT_G_STR1_NO_SERIES = "This export lists no series for this country and indicator.";
```

### G-STR2: "Data as of" vs "Data cut-off"
- **Decision:** use "Data cut-off". Format the value as the UTC date YYYY-MM-DD (formatting only), and keep the build id.
- **Reason:**
  - The redesign puts a "Reference period" on every row. A page-level "Data as of 2026-11-01" next to it reads as the period the data refers to, which is the exact confusion the redesign removes. `known_cutoff` is the time up to which the system knew the data (the vintage cut-off), and "cut-off" says that.
  - The approved spec 5.3 names the label, and spec section 7 lists it.
  - Today the raw timestamp `2026-11-01T04:23:41Z` is printed. The time of day is noise for monthly data.
  - The build id stays because it is the citation handle for "which export did you use".
- **Implementation:** move the line from `shell.js` into `copy.js`.
- **Confirm:** user, because this changes a confirmed string. **ADR: no**, since the approved spec (under ADR-030) specifies the label. ADR-025 decision 11 needs only the user's confirmation for new or changed strings.
```js
export const FRESHNESS_LABEL = "Data cut-off"; // DRAFT until confirmed; replaces the confirmed "Data as of"
export const DRAFT_FRESHNESS_LINE = (date, buildId) => `${FRESHNESS_LABEL}: ${date ?? "unknown"} (build ${buildId ?? "unknown"}).`;
```

### G-STR3: "Compare with other countries" vs "Compare countries"
- **Decision:** one visible label per target.
  - To PG-INDICATOR (cross-section, latest values): `"Compare countries"`.
  - To PG-SERIES (over time): `"Time series"` in table rows. Its accessible name carries the row context, because the same visible text repeats on every row.
  - Page-level actions use `"Open as time series"`: C-IND-6 and the history panel's link.
  - "Compare with other countries" is dropped.
- **Reason:** both old labels say "compare countries" but open different views: one compares latest values across countries, the other compares over time. The economic dimension (cross-section vs time) should be in the label. Using the nav's own name "Time series" also resolves G-STR4.
- **Confirm:** user. **ADR: no.**
```js
export const DRAFT_COMPARE_COUNTRIES = "Compare countries";                                       // to PG-INDICATOR
export const DRAFT_COMPARE_COUNTRIES_LABEL = (indicatorName) => `Compare countries: ${indicatorName}`;
export const DRAFT_INDICATOR_SERIES_LINK = "Time series";                                        // row link to PG-SERIES
export const DRAFT_SERIES_LINK_LABEL = (indicatorName, countryName) => `Time series: ${indicatorName}, ${countryName}`;
export const DRAFT_OPEN_AS_SERIES = "Open as time series";                                       // page-level link to PG-SERIES
// remove DRAFT_COMPARE_WITH_OTHERS
```

### G-STR4: "Look at one series over time" vs nav "Time series"
- **Decision:** the home links (C-HOME-4) reuse the nav labels exactly: "Time series", "Domains", "Revisions". This also drops "Domain overviews".
- **Reason:** one name per page, everywhere. A student who learns "Time series" on the home page finds the same word in the header.
- **Confirm:** user. **ADR: no.**
```js
export const DRAFT_HOME_LINKS = Object.freeze({series: "Time series", domains: "Domains", revisions: "Revisions"}); // equal to the nav page names
```

### G-STALE: `known_cutoff` in the banner
- **Verified.** `known_cutoff` is the field name in `docs/specs/dashboard-export-spec.md` (manifest example, line 65, and round 4 note, line 70). `shell.js` reads the right field. The banner has no link (`stale.js`), which answers ADR-030 decision 3's "Confirm" item: there is nothing to remove.
- **Decision (proposed):** the banner should not show a database field name to readers. Reword it to use the G-STR2 label, so the banner and the freshness line use one term.
- **Who confirms / ADR: yes.** ADR-025 decision 10 states "Stale banner unchanged in wording", and the user confirmed both banner wordings (`docs/ops/dashboard-ux-baseline.md` line 114). Changing them changes an ADR decision, so a one-line amendment ADR (or an amendment note to ADR-025 decision 10, approved by the user) is required first.
- **Until then, R20 keeps the banner verbatim.** It applies only G-STR2 once confirmed.
```js
// Only after the ADR-025 decision 10 amendment is approved:
export const DRAFT_STALE_BANNER = (date, days, limit) => `Data may be out of date: the data cut-off (${date}) is ${days} days old, more than ${limit} days.`;
export const DRAFT_STALE_BANNER_UNREADABLE = "Data freshness unknown: this build has no readable data cut-off. Treat the data as out of date.";
```

### G-Q3: unclear names
- **Still open.** Only the user can provide the list.
- **Decidable now:**
  - The rules stay: names from `meta/*`, identifier secondary, never truncated without the full accessible name (ADR-030 decision 10).
  - R26 runs on built pages with the user.
  - A name fix goes to indicator configuration, not `copy.js`. CR-7 (`short_name`) is raised only if R22 shows long names breaking the 320 px layout.

### G-Q4: defined-but-empty vs undefined pairs
- **Still open.** No real 44-entity export exists on disk: only `site/tests/fixtures/sparse_export/` exists, and `data/` holds raw, staging and curated folders with no export. Nothing is inferred.
- **Decidable now (proposed decision rule, for the user to accept):**
  - On the first real export, count over the non-global domains' `indicator_ids` x non-global entities: (a) pairs with a value; (b) pairs absent from `meta/series.json`; (c) pairs present with a null value.
  - Record the counts in `docs/ops/dashboard-redesign-measurements.md` (R24).
  - **Raise CR-3** (`missing_reason`) if (c) is the majority of no-value rows in any domain shown to readers. In that case "a series is defined, but this export holds no value" would be the sentence on most rows and would not tell "source not loaded yet" from "source has no value", which is the distinction an economist needs to judge coverage.
  - Otherwise keep the two-way sentence (ADR-030 Q4 answer).
  - Q11 still holds: do not show the site to students or professors until a fuller export loads.

---

## 5. Economic relevance: analysis and forecast

### Principle
Everything below is either (a) a display of a field the export already stores, or (b) an export change request computed by analytics in Python (ADR-006, ADR-010 decision 1). Nothing is computed in the browser (D6): no medians, changes, averages, trend lines or extrapolations.

### 5a. Display additions from fields already stored (spec change only; user approval; no ADR)
Ranked by value to the reader:
1. **Show `n_ranked` with every percentile.** The scorecard row stores `n_ranked`.
   - Why: a percentile of 0.83 means very different things among 3 countries (today's real export) and among 42. Without n, the percentile overstates what is known. This is the cheapest and most honest improvement.
   - Where: PG-COUNTRY and PG-INDICATOR percentile cells, plus the C-CTRY-2 dot labels.
   - `export const DRAFT_PERCENTILE_N = (n) => \`of ${n} ranked\`;` (shown after the stored percentile, for example "0.83 of 3 ranked").
2. **Deviation from target** for `rank_mode = target_distance` indicators: a stored `deviation` column with sign glyph and text.
   - Why: "inflation 1.4 pp above target" is the economically meaningful readout for inflation and fiscal-rule indicators; the percentile of the distance hides the sign.
   - ADR-025 decision 2 already allows the diverging scale for deviation from target. The spec reads `deviation` in section 3 but shows no column, so this is a spec addition.
   - `export const DRAFT_DEVIATION_HEADER = "Deviation from target";` The unit is the indicator's `unit_label`, and the sign is always printed (ADR-025 decision 2).
3. **Alert level per row** (stored `alert_level`, `alert_confidence`) in the Flags column on PG-COUNTRY and PG-INDICATOR, using the existing glyph and `ALERT_LEVEL_PREFIX`.
   - Why: the alert is the system's own computed answer to "is this value unusual against the country's own history?". That is the monitoring signal the project exists for, and it complements the cross-country percentile.
   - No count of alerts per country or domain (D6).
4. **PG-SERIES default transform = "Indicator default"** (`value_default_tf`) when `transformChoices()` offers it; otherwise Level.
   - Why: for price indices, GDP levels and similar series, the level is rarely what is analysed; the configured default transform (often year-on-year) is.
   - Dependency: the unit of a transformed series must be known (CR-6 below), otherwise AC-RD-42 cannot be met. **Gate on CR-6.**
5. **"Show history" defaults to the same transform** as the scorecard's `transform_id` when it is not the level. This is gated on CR-6 too.

### 5b. Export change requests (user approval and an export-spec change; ADR only where marked)
Priority order:
1. **CR-6 (existing): unit of `transformed_value` and of each series transform.** **Top priority.** For many indicators the ranked quantity is the transform, yet it cannot be shown with a unit today. This blocks 5a items 4 and 5 and the full meaning of PG-INDICATOR. ADR: no.
2. **CR-10 (existing): CSV download.** H5 is "secondary-high" for this audience (ADR-030 Q9). ADR: no.
3. **New CR-11: previous observation per scorecard row.** Fields: `prev_value`, `prev_ref_period_end`, and an analytics-computed `change` in the transform's unit.
   - Why: "latest vs previous" is the standard economic readout (central-bank and statistics-office releases). D6 forbids computing it in the browser, so analytics must store it.
   - It would also allow the tip to show a change, but only after an ADR-030 decision 6 / spec C-SER-4 change ("the tip never shows a computed number"). ADR: no for the field; yes if the tip rule changes.
4. **CR-1 (existing): sparkline arrays.** Medium priority, because the trend direction on the country profile is informative; cost is scorecard size (measure under AC-RD-53). ADR: no.
5. **New CR-12: own-history context per row.** Percentile (or z-score) of the latest value within the country's own history over a stated window, computed by analytics. Example readout: "unemployment at its lowest in 10 years".
   - Alerts already compute z-scores for alerted rows only (`alerts.json`). Whether analytics computes this for all rows is [UNVERIFIED].
   - **ADR: likely yes**, because it adds an analytics measure with its own window and orientation rules. It needs a phase-2 decision.
6. **CR-8 (rank position): low priority.** Percentile plus `n_ranked` (5a item 1) covers it.

### 5c. Forecast / projection: not allowed in this version
- **Decision: no forecast, projection, nowcast or trend extrapolation on any page in this release.**
- **Reason.** Every applicable approved document excludes it:
  - ADR-010 decision 9: "Projections (A03) have no dashboard output in v1".
  - Export spec principle 4: `PROJ` is excluded from every file.
  - ADR-011: forecast storage is approved but "deferred to v2 by user decision 2026-10-25; approval does not schedule implementation".
  - ADR-030 decision 7 and Q5: not in the first redesigned version, and no projections sentence.
  - ADR-010 decision 1 / D6: a browser-side extrapolation would be computation of meaning in the browser.
- The withdrawn projections sentence stays withdrawn (spec section 7, AC-RD-44).

**Outline of a future ADR (PROPOSAL ONLY: not approved, not to be implemented, needs the user's decision):**
"ADR-0xx: Dashboard display of official benchmark projections".
- **Scope, step 1:** third-party official projections only (IMF WEO A03, already modelled as `PROJ` rows with `vintage_label` per edition). No own-model forecasts.
- **Preconditions:**
  - The user lifts the v2 deferral of ADR-011 and schedules the `forecast.*` store.
  - A licence/redistribution check of WEO projections for the public site (research phase; ADR-010 decision 7 gate).
  - Amendments of ADR-010 decision 9 and ADR-030 decision 7.
- **Export:** a major contract version bump, with a new file `projection/<indicator_id>.json`: producer, `edition_label`, `published_at`, target period, value, unit. Published-scope rules as for observations.
- **Display rules (data only, no prose):**
  - The projection is a separate mark: a dashed line after a vertical rule at the last observed period, plus a hollow distinct marker. It is labelled with producer and edition as data (for example "IMF WEO 2026-10"), not with a sentence.
  - It is never mixed into percentiles, ranks, alerts or the value chart.
  - The tip and table carry the edition and `published_at`.
  - It is on PG-SERIES only at first.
- **Step 2 (later ADR):** own-model nowcasts, only once forecast evaluation (ADR-011 `forecast.evaluation`, `first_stored_release` label) can show a track record next to them.
- **Who: the user. ADR: yes (new), plus amendments of ADR-010 and ADR-030.**

---

## What stays open after this record
- G-Q3 (the user's name list) and G-Q4 (a real export) are still open; the decision rules are proposed above.
- G-STALE wording needs an ADR-025 decision 10 amendment; until then the banner stays verbatim.
- G-AC60 (per-question confirmation of Q1-Q12) is not addressed here.
- Spec clarifications to approve:
  - 5.6 / AC-RD-30 (point reader instead of "focus on a point");
  - 1.6 allow-list (the two hash notes, the reader label);
  - 1.5 (optional: transform and range in the hash);
  - the column additions of 5a.
- Every DRAFT string above needs the user's confirmation before release (ADR-025 decision 11).
