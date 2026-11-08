# Brief for the design agent: visualisation and UI/UX review (G3 input)

Status: working brief, not approved, nothing here changes an ADR. Date: 2026-11-05. For `macro-data-architect` (Phase 2). Invoke with `/design dashboard visual review` after the user agrees to this brief.

## Goal
Review every visualisation and UI/UX element of the dashboard (V1-V5 plus the landing page) and propose changes so the charts are as informative as the Flourish line/bar/pie reference, within the constraints below. Output is a review document and, where a decision changes, a proposed ADR. Implementation is out of scope.

## Reference and its limit
User reference: https://flourish.studio/visualisations/line-bar-pie-charts/ (campaign link `25066059`).
- Fact [checked 2026-11-05]: that URL is a marketing page. Its static HTML holds no chart, so the chart's own titles, annotations, tooltips, legend and colours could not be inspected from it.
- What the page claims (marketing copy, treat as a feature checklist, not as a verified design): custom annotations and axis highlights, clickable legends, popups, filters and sliders, grid view, smooth transitions on data change, wide and long data, responsive embeds.
- Before judging "as informative as Flourish", the agent states which Flourish features it actually saw. If it cannot render the chart, it asks the user for a screenshot or the embed URL of the exact chart and marks every Flourish-derived claim `[UNVERIFIED]` until then. It may use WebSearch/WebFetch for Flourish's public docs and for visualisation guidance, and cites URL plus access date for each claim.

## Read first (source of truth)
- `docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md`, `ADR-026-percentile-orientation-legend-and-dashboard-display-rules.md`, `ADR-010`, `ADR-023`, `ADR-024`
- `docs/design/briefs/dashboard-ux-brief.md`, `docs/ops/dashboard-ux-baseline.md`
- `docs/plans/dashboard-ux-implementation-plan.md` (T111 and G3 review items: palette, legend, state signatures, header abbreviations, derived bin labels, DRAFT wording, the `plain` state)
- Code: `site/src/` (`index.md`, `explorer.md`, `revisions.md`, `status.md`, `domain/`, `peers/`, `lib/*-view.js`, `lib/heatmap*.js`, `style.css`) and `site/test-artifacts/` for screenshots

## Scope to review
1. V1 domain heatmap (the G3 build): palette, legend, state signatures, header clamping and abbreviations, cell detail on focus, sorting.
2. V2 peers, V3 explorer (line/time series), V4 revisions, V5 status, landing page.
3. Per chart, against the Flourish feature checklist: title and subtitle stating the finding, units and direction in plain words, annotations (release dates, revisions, stale or lagging periods), direct labels vs legend, hover/focus detail, filtering and country selection, small multiples or grid view, transitions, source and vintage line, empty and partial-data states, responsive layout, print.
4. For each gap: what it would add for the reader, cost (bundle size, complexity), and whether the constraints allow it.

## Hard constraints (a proposal that breaks one is rejected, or flagged as needing a new ADR)
- The browser displays stored ranks and percentiles; it never recomputes them (ADR-010 decision 1, D6). No composite or overall score, no row aggregate (U1).
- No off-origin requests, `globalStylesheets: []` (ADR-023 decision 4). No dependency beyond ADR-024's list; no Flourish embed, no third-party script. No axe-core (A5).
- Bundle-size rule (ADR-023 decision 6). Light/dark automatic, no toggle (A2). WCAG 2.2 AA, colour never the only carrier of meaning, `prefers-reduced-motion` honoured (animation must be optional and off under reduced motion).
- Approved wording in `site/src/lib/copy.js` is not changed without the user; new strings are listed as proposals for gate G2.
- Real export density is unknown (gate G0); numbers from the fixture (4 domains) are not evidence for the real export (about 8-12 domains).

## Deliverables (write only to `docs/design/`, `docs/design/adr/`, `docs/specs/`)
- `docs/design/dashboard-visual-review.md` from `docs/_templates/design.md`: a table per chart (finding, Flourish feature compared, evidence label, proposal, constraint check, effort S/M/L, priority), then a ranked list of at most 10 changes, and open questions for the user.
- A proposed ADR (status `proposed`) only for changes that alter an approved decision; never edit approved ADRs in place.
- Agents do not approve; the user approves. Do not proceed to planning.

## What the user decides after
G3 approve or change list; which proposals become plan tasks (via `/plan`); G4 (landing heatmap) with the review's evidence.
