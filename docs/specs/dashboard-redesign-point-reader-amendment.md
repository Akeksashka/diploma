---
status: approved   # Approved by the user on 2026-11-07 (stated in session: "move as recommended"). Was: drafted 2026-11-07 from docs/ops/dashboard-redesign-decisions.md (approved by the user 2026-11-07, item 1 G-TIP / R16). Not approved: the user approves this amendment.
amends:
  - docs/specs/dashboard-redesign-spec.md   # section 5.6, AC-RD-30, section 1.6 allow-list, section 6 traceability row "No hover values", section 7 strings
inputs:
  - docs/ops/dashboard-redesign-decisions.md
  - docs/specs/dashboard-redesign-spec.md
  - docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md
  - docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md
---
# Amendment: keyboard route for chart values ("Read a value" point reader) instead of "keyboard focus on a chart point"

Date: 2026-11-07. Same style as the earlier amendment files in this directory: a self-contained text; the approved base spec is not edited by this document; section 4 lists the exact edits to apply once the user approves. No ADR is needed: the change stays within ADR-030 decision 6 ("the 'View as table' disclosure remains the keyboard and screen-reader route") and ADR-025 decision 6 (every chart is a `<figure role="img">` with a table alternative, no drag-only interaction) [REC: `docs/ops/dashboard-redesign-decisions.md` item 1]. Labels: [REC] stated in that record; [UNVERIFIED] not checked by me this session.

## 1. Why the wording must change
- The base spec 5.6 and AC-RD-30 say a tip appears on "hover or keyboard focus on a chart point".
- Facts reported by the record [REC; not re-run by me]: the R15 probe (session scratchpad `r15-probe.mjs`) found that Observable Plot 0.6.18's `tip` mark is pointer-only (no focus or key listeners, no `tabindex` on marks). `chartFigure()` wraps every chart in `<figure role="img" aria-label=...>` (ADR-025 decision 6, AC-UX-5). Children of `role="img"` are presentational, so focusable descendants are an ARIA authoring error [UNVERIFIED here: the WAI-ARIA 1.2 `img` role definition, https://www.w3.org/TR/wai-aria-1.2/#img, was not re-read; access date for the claim 2026-11-07].
- Making points focusable was rejected in the record (breaks the `role="img"` contract; up to about 5 x 400 tab stops on a monthly series since 1991; depends on Plot's internal SVG). A roving single tab stop on the figure was rejected (changes the AC-UX-5 role rule, an ADR-025 matter).
- Therefore "keyboard focus on a chart point" cannot be met as written. The keyboard route is a native control outside the figure.

## 2. Replacement text

### 2.1 Section 5.6 (replaces the whole subsection)
> **5.6 Hover and keyboard.** Pointer hover on a chart point shows the tip of C-SER-4 (PG-SERIES) and a minimal tip (name, value, unit, period) on the PG-INDICATOR value chart. Keyboard and screen-reader users read the same values through the "Read a value" point reader, a form control placed directly after the chart and before "View as table", outside the `role="img"` figure. The tip, the reader output and the "View as table" row for the same point are produced from one text function and are identical in content. Tips are an aid, never the only access: every plotted value is also in a table (ADR-025 decision 6, AC-UX-5). No drag-only interaction (WCAG 2.5.7).

Point reader specification (normative):
1. Container: `<fieldset class="mm-point-reader" id="...">` with `<legend>Read a value</legend>`.
2. PG-SERIES: a `<label>Country <select>` listing the plotted series in legend order; a `<label>Reference period <input type="range" min="0" max="n-1" step="1">` over that series' plotted points, `aria-valuetext` = the period label; arrow keys step one period, Home and End go to the ends, a click on the track works without dragging; default = latest plotted point. In small multiples (more than 5 countries) the list holds every selected country.
3. PG-INDICATOR: one `<label>Country <select>` of the drawn bars in bar order. This select is the existing country-in-focus control (it sets the focus state, outlines the bar, highlights the table row, writes `#c=`): one concept, not two.
4. `<output aria-live="polite">` holds the text of the current choice (the tip lines joined with "; ").
5. While focus is inside the fieldset, the chart shows a static highlight of the selected point (ring plus a static tip; in small multiples inside that country's facet). The highlight is visual only; the figure's `aria-label` is unchanged.
6. The text of the tip, the reader output and the table row is the same `valueText` (stored value with unit and estimate mark, or the display-only rebased value with its unit under rebase). No difference, change, rank or other arithmetic in the tip or reader code.
7. Dismissal of the pointer tip (WCAG 1.4.13): Escape hides it; the next pointer move restores it [REC].

### 2.2 AC-RD-30 (replaces the criterion)
> AC-RD-30 Pointer hover on a chart point shows a tip with country name, period label, value with unit, status mark and `known_at`. For keyboard users, "Read a value" (a) is reachable by Tab, (b) changes its `<output>` text when the country or reference period is changed with the arrow, Home and End keys, (c) shows the static highlight while focused, and (d) yields text equal to the matching "View as table" row. The tip and reader text contain no computed number. Escape hides the pointer tip. The figure itself has no focusable descendant. (unit test of the text function, smoke, static scan)

Sub-tests (from the record, item 1.6):
- AC-RD-30a (unit, `tip-text`): line contents for OBS, EST and PROV; rebased value; a null unit must fail (AC-RD-42); tip `valueText` equals table `valueText`.
- AC-RD-30b (smoke): hover shows the tip; Tab reaches the reader; ArrowLeft changes the `<output>` to the previous period's text, equal to the matching table row; Escape hides the pointer tip.
- AC-RD-30c (static scan): no arithmetic in `tip.js` or `point-reader.js` (extends AC-RD-50); `figure[role=img]` contains no element with `tabindex`.

## 3. Consequential spec text
1. Section 1.6 closed allow-list: add the control label "Read a value" (a label, not prose). Without this AC-RD-62 would fail on the new legend [REC].
2. Section 6 traceability row "No hover values": "Tip on PG-SERIES and PG-INDICATOR; table alternative" becomes "Tip on PG-SERIES and PG-INDICATOR; point reader and table alternative"; where: section 5.6, AC-RD-30.
3. Section 7 new strings: add `DRAFT_POINT_READER_LEGEND = "Read a value"`; reuse `COUNTRY_HEADER` ("Country") and `DRAFT_FACT_LABELS.refPeriod` ("Reference period"); add `DRAFT_TIP_STATUS` (EST: "estimate", PROV: "provisional") and `DRAFT_TIP_KNOWN_AT = (date) => "Known at " + date`. All DRAFT until the user confirms them (ADR-025 decision 11).
4. Implementation shape (for the plan, not normative here): pure module `tip.js` (`seriesTipLines`, `valueTipLines`, `tipText`, `readerText`), view helper `point-reader.js`, one pointer tip mark per chart (`Plot.pointer`), re-render with a static `Plot.dot` and static `Plot.tip` on focus. Re-render cost for at most 5 series of about 400 points is measured in R23; whether a static `Plot.tip` with data and no pointer transform renders in Plot 0.6.18 is to be rechecked in R16 [REC; probe printed the tip group count].

## 4. Edits to apply to `docs/specs/dashboard-redesign-spec.md` after approval
Replace section 5.6 by 2.1; replace AC-RD-30 by 2.2 and add AC-RD-30a-c; apply items 3.1 to 3.3; add this file to `inputs`; add a change-log line. No other criterion changes. The base spec stays `approved` until the user approves this amendment; applying the edits resets it to `draft` for re-approval, as earlier amendments did.

## 5. Open points for the user
- Approve the point-reader approach and the replaced wording of 5.6 and AC-RD-30.
- Confirm the DRAFT strings of 3.3.
- Plot 0.6.18 behaviour (pointer-only tip; static `Plot.tip` rendering) is taken from the record and is rechecked in implementation task R16.
