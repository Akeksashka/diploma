# Dashboard UX manual accessibility and browser checks (plan task T134, AC-UX-14)

Template prepared 2026-11-05. **Not filled in: every Pass/Fail and Notes cell is empty on purpose.** The user (A7) performs the checks and records results. Sources: ADR-025 (AC-UX-14), ADR-026, ADR-023 C5, `docs/plans/dashboard-ux-implementation-plan.md` T107, T130-T134. Findings become new plan tasks, not silent fixes. T135 may not claim AC-UX-14 without this record (or an explicit user waiver).

Mark each row `P` (pass), `F` (fail) or `N/A`; put the finding id (F1, F2, ...) in Notes for every `F`.

## 1. Environment

| Field | Value |
|---|---|
| Date | |
| Tester | |
| Build id (`MM_EXPECT_BUILD_ID`, page footer or `manifest.json`) | |
| Data used (fixture or real export) | |
| macOS version | |
| Safari version | |
| VoiceOver (macOS) settings (voice, verbosity) | |
| Firefox version, OS | |
| Windows version, browser and version (High Contrast) | |
| Real devices (model, OS, browser) | |

## 2. Start the site locally

Setup is in `docs/ops/local-development.md`; the site itself needs Node 20 and `npm ci` in `site/`.

```
cd site
npm ci
EXPORT_DIR=<export dir that holds manifest.json> npm run dev      # preview at the printed http://127.0.0.1:3000
# or a static build (closer to production, needed for print):
EXPORT_DIR=<export dir that holds manifest.json> npm run build    # then serve site/dist with any static server
```

`EXPORT_DIR` is the directory containing `manifest.json`, not its parent (a fixture export comes from `tests/fixtures/site_spike/make_export.py`; the real export is under `data/export/data` if one exists). Pages: V1 `/` and `/domain/<id>` (agri, fin, global, labour, prices), V2 `/peers/<id>`, V3 `/explorer`, V4 `/revisions`, V5 `/status`. To test the stale banner, use a COPY of the export with an old `known_cutoff` (more than 45 days before today) in `manifest.json`; never edit the original.

## 3. VoiceOver pass (Safari, macOS; start with Cmd+F5)

Use the rotor (VO+U: Headings, Landmarks, Tables, Form controls) and VO+Right to read in order. Expected wording is the intent, not exact punctuation; record what was actually announced when it differs.

### 3a. V1 domain page (`/domain/labour`, then one more domain)

| # | Step | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Page load, then VO+U Landmarks | Banner/header, navigation, main and footer landmarks present; skip link is first stop and moves focus into main | | |
| 2 | Rotor Headings | One h1 (page title), then h2s in logical order, no skipped level (no h1 to h3 jump) | | |
| 3 | Rotor Tables, enter the heatmap table | Table has an accessible name; announced with row and column counts | | |
| 4 | Move to the Germany row, Unemployment rate column | Cell read as "Germany, Unemployment rate, 0.70" (country, indicator, value), plus its state word where the cell has one; the visible value and word are not read twice | | |
| 5 | Move to a cell in a non-ranked state (missing, stale or similar) | State is announced in words; colour is not the only carrier | | |
| 6 | Header cells (if sortable) | Header announced with its sort state ("ascending", "descending" or "not sorted") and as a button; activating it with VO+Space changes the announcement | | |
| 7 | Legend | Legend and the percentile orientation statement (ADR-026) are read in words | | |
| 8 | Leave table with VO+Right until the end | Sources and caveat text is reachable; no unlabelled "group" or "image" stops | | |

### 3b. V3 explorer (`/explorer`)

| # | Step | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Rotor Headings and Form controls | Heading order logical; every select, radio group and button has a name; the peer group is a group with legend "Peer group" | | |
| 2 | Change a country or indicator selection with the keyboard | Selection change is announced or the new state is discoverable without losing focus; focus stays on the control | | |
| 3 | Reach the chart | Figure announced with its label (title or summary of what is drawn), not as unnamed "image" | | |
| 4 | Move on to the table after the chart | Data table with the same values is present and readable; chart label and table agree on series and period | | |
| 5 | Hover-only content | Facts shown on hover are also available on focus or in the table | | |

### 3c. V4 revisions (`/revisions`)

| # | Step | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Rotor Headings | Logical order, no skipped level | | |
| 2 | Table cells for a revised value | Value, class (regular, reestimation) and sign are announced in words; flag mark has a text equivalent | | |
| 3 | Sortable headers | Announced with sort state, as in 3a step 6 | | |
| 4 | Open the step chart for Germany (three versions) | Chart label is read; it equals the table content for the same series (versions, values, hollow/filled point meaning stated in words) | | |
| 5 | Open France (removal rule) | The "removed" label is announced in the label or table, not only drawn | | |
| 6 | Summary line | Singular/plural correct ("1 reference period", "1 stored version") | | |

### 3d. Stale banner (any page, with the old-cutoff copy from section 2)

| # | Step | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Load the page with VO running | Banner (`role="alert"`) text "Data may be out of date ..." is announced once on load | | |
| 2 | Navigate to another page and back | Announced once per page load, not repeated while reading or on focus changes | | |
| 3 | Read the page top to bottom | The banner is not duplicated in the reading order | | |
| 4 | Fresh data (original export) | No banner, no announcement | | |

## 4. Firefox and Safari visual check (ADR-023 C5; closes BB16 in T94)

Each cell: P/F. Look for broken layout, clipped or overlapping text, missing glyphs or state markers, wrong colours, console errors, unreadable focus ring, horizontal page scroll (only table containers may scroll). Desktop width about 1280; phone width 390 (real device or responsive mode), both light and dark scheme.

| View | Firefox desktop | Firefox phone | Safari desktop | Safari phone | Notes |
|---|---|---|---|---|---|
| V1 landing `/` and domain `/domain/labour` | | | | | |
| V2 `/peers/labour` | | | | | |
| V3 `/explorer` | | | | | |
| V4 `/revisions` | | | | | |
| V5 `/status` | | | | | |

| Extra | Result | Notes |
|---|---|---|
| Dark scheme (OS setting) on all five views, Firefox | | |
| Dark scheme on all five views, Safari | | |
| Keyboard Tab traversal, focus ring visible, nothing under the sticky header (Firefox and Safari) | | |
| Real phone, tap targets and table scroll (iOS Safari and/or Android) | | |

## 5. Print check (T130; real dialog, not emulation)

Open each view, Cmd/Ctrl+P, A4, default margins. Check the preview and, once, the saved PDF. Do it in Chrome, Firefox and Safari; also once with the OS in dark scheme.

| View | Chrome | Firefox | Safari | Notes (light colours kept, controls hidden, closed details opened, "Page URL" and freshness line present, no clipped table, header row repeats, text legible) |
|---|---|---|---|---|
| V1 domain | | | | |
| V2 | | | | |
| V3 | | | | |
| V4 | | | | |
| V5 | | | | |

| Extra | Result | Notes |
|---|---|---|
| Text-spacing override (WCAG 1.4.12 bookmarklet or user stylesheet) then print: no clipped text | | |
| Fills and state markers visible with "Background graphics" off | | |

## 6. Windows High Contrast / forced colors (T131; Chromium emulation is not equivalent)

Windows: Settings, Accessibility, Contrast themes (try Aquatic and Night sky, plus one light theme). Edge and Firefox. Check each view.

| View | Edge | Firefox | Notes (text readable, borders and focus ring visible, cell states distinguishable by glyph/border/word, chart marks drawn, no invisible controls) |
|---|---|---|---|
| V1 domain heatmap | | | |
| V2 dot plot (series hues are not remapped; end labels carry identity) | | | |
| V3 chart (same) | | | |
| V4 table and step chart (hollow ring, filled points, removal rule, "removed" label) | | | |
| V5 feed chips (fresh, late, stale, broken) | | | |

## 7. prefers-reduced-motion

Enable "Reduce motion" (macOS: Accessibility, Display; Windows: Animation effects off), reload.

| Check | Chrome | Firefox | Safari | Notes |
|---|---|---|---|---|
| No animation, transition or smooth scroll anywhere (tabs, hover, skip link, loading state) | | | | |
| Toggle off again: page still works, nothing stuck | | | | |

## 8. Findings

Every failure gets a row. The planner turns each into a new task; do not fix in place.

| Id | View / section | Browser, OS | What happened | Expected | Severity (blocks / should fix / minor) | New task id |
|---|---|---|---|---|---|---|
| F1 | | | | | | |
| F2 | | | | | | |
| F3 | | | | | | |

## 9. Sign-off

| Field | Value |
|---|---|
| Sections completed (3-7) | |
| Sections waived by the user (state which and why) | |
| Overall result (user) | |
| Date | |
