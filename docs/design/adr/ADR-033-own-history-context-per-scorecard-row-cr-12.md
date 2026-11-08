---
status: proposed   # drafted 2026-11-07 from docs/ops/dashboard-redesign-decisions.md section 5b item 5 (CR-12: "ADR: likely yes"). Not approved: the user approves this ADR. A proposal for a phase-2 decision; not scheduled and not part of the redesign release.
---
# ADR-033: Own-history context per scorecard row (CR-12)

Date: 2026-11-07. Labels: [REPO] read in this repository; [REC] stated in `docs/ops/dashboard-redesign-decisions.md`; [UNVERIFIED] not checked. No web source is used.

## Context
- The record ranks "own-history context per row" as export change request CR-12: a measure of where the latest value stands within the country's own history over a stated window, computed by analytics, with an example readout "unemployment at its lowest in 10 years" [REC]. The cross-country percentile says where a country stands against peers; it does not say whether the value is unusual for the country itself.
- Alerts already compute z-scores against own history for alerted rows only (`alerts.json`). Whether analytics computes any own-history measure for all rows is [UNVERIFIED] (the record says the same; the analytics spec was not re-read for this ADR).
- The record says an ADR is likely needed because the measure adds an analytics definition with its own window and orientation rules, and the browser may not compute it (D6, ADR-010 decision 1) [REC].

## Options considered
1. Do nothing; rely on the cross-country percentile and the alert level. No work; leaves the single most common time-series readout missing.
2. Compute in the browser from `series/*.parquet`. Rejected: breaks D6 (no computation of meaning in the browser) and ADR-010 decision 1.
3. Reuse the alert z-score for every row. Rejected: a z-score assumes an approximately symmetric distribution; trending series (price levels) and short windows make it misleading; and the alert threshold logic would then conflate monitoring with context.
4. A new analytics measure: an empirical percentile of the latest value within a stated own-history window, exported beside the scorecard row (chosen as the proposal).

## Decision (proposed)
1. Measure. For each scorecard row with a numeric value, analytics computes `own_history_percentile` = the share of the country's own observations in the window, on the same transformed quantity as the row (the transform and unit of `transformed_value`), that are less than or equal to the latest value, using the latest vintage of each observation. The tie rule and the inclusion of the latest value in the window are fixed in the analytics spec amendment that follows approval [exact definition to be confirmed there].
2. Window. `own_history_window_years` is stored with the value; default 10 years, set per indicator through `config/indicator_defaults.yaml` and overrides (ADR-014). A minimum number of observations (`own_history_min_obs`) applies; below it the measure is null, not imputed (D16).
3. Orientation. The measure is neutral, like the cross-country percentile (ADR-025 decision 2, ADR-026): higher means a higher value than usual, not better. No good/bad colour.
4. Eligibility. Series with a clear seasonal pattern and no seasonal adjustment are excluded or compared only on a year-on-year transform [UNVERIFIED: which indicators qualify must be checked in the analytics spec amendment]. Aggregates, `WLD` and unranked informational rows follow the same publish scope rules as scorecards (export spec section 1a); withheld sources contribute nothing.
5. Export. Nullable fields `own_history_percentile`, `own_history_window_years` and `own_history_n_obs` on scorecard rows: a minor contract bump (nullable fields, export spec section 3). The export copies them; it computes nothing.
6. Display (a separate spec change, not in this ADR): the stored number and the window as data, for example "0.08 of own history, 10 years". Never merged with the cross-country percentile, never composited, no verbal judgement (data-only rule). A readout such as "lowest in 10 years" is a rendering of a stored minimum flag, which would be a further stored field and is not decided here.
7. Separation from alerts: the alert level and z-score logic (ADR-007, analytics spec) are unchanged; this measure never triggers alerts.

## Consequences
- Positive: an economist sees whether the latest value is unusual for the country, from data computed in the Python layer and reproducible from stored vintages; no browser computation.
- Negative: a new analytics definition to specify and test (window, ties, vintage choice, seasonality); scorecard size grows by three nullable fields per row (to be measured under AC-RD-53); more ways to misread a percentile if the display is careless.
- Work created (after approval): analytics-spec amendment with the exact definition and acceptance criteria; DDL columns on the snapshot or scorecard tables via a forward-only migration; indicator-defaults keys; export-spec minor bump; golden files; later a display spec for PG-COUNTRY and PG-INDICATOR.
- Reversal: stop exporting the fields; stored columns remain (append-only history).

## Open questions for the user
- Q1 Is a 10-year default window right for annual, quarterly and monthly series alike?
- Q2 Neutral percentile only, or also a stored "lowest/highest in window" flag?
- Q3 Priority: the record places this fifth among the export change requests, after CR-6, CR-10, CR-11 and CR-1.
