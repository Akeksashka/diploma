---
status: approved   # approved by the user on 2026-11-04 (stated in session: "approved"); decisions Q1-Q5 per the recommendations stated in session
---
# ADR-026: Percentile orientation stated in the legend, per-indicator direction labels, bin edges, domain-page sorting, and no overall freshness field (amends ADR-025)

Amended by ADR-034 and docs/specs/dashboard-layout-amendment.md (2026-11-10).

Date: 2026-11-04. Amends ADR-025 decisions 2 (percentile encoding), 4 (heatmaps), 11 (microcopy) and AC-UX-3, AC-UX-10, AC-UX-13; answers ADR-025 open questions Q3 and Q6. Changes no other ADR and no export spec. User decision stated in session on 2026-11-04 ("move as recommended"): keep the neutral single-hue percentile scale and the standing caveat, and state in the legend that a higher percentile means a more favourable position by each indicator's stated direction. Labels: [REPO] read in this repository this session; [UNVERIFIED] not checked. No external source is used; every claim below is from repository files read on 2026-11-04.

## Context
- ADR-025 chose a neutral scale partly because "a percentile has no good/bad meaning" and listed the orientation as open (Q3, brief section 3.2). The repository answers Q3:
  - `docs/specs/analytics-and-r-contract-spec.md` line 67 [REPO]: for `monotone_good`, "percentile-ranked with a fixed orientation ... Higher percentile = better".
  - Same spec line 68 [REPO]: `target_distance` ranks on distance to the target, "smaller is better", `good_dir` is 0.
  - Same spec line 69 [REPO]: `descriptive_only` is "never percentile-ranked", has no percentile, is not counted in `n_available` or `n_defined`; `good_dir` is always 0; `display_dir` is an optional colour hint "never used for ranking, percentiles, `n_defined` or alerts".
  - `src/macro_monitor/analytics/scoring.py` [REPO]: `percentile = (W + 0.5 T) / n`, W = entities with a larger "badness" key; badness is `-value` for `good_dir = +1`, `value` for `good_dir = -1`, and distance to target for `target_distance`. So 1.0 is the most favourable position and 0.0 the least, per indicator.
  - `docs/specs/dashboard-export-spec.md` line 105 [REPO]: the domain figure `percentile_rank` is the mean of the entity's indicator percentiles in the domain. Because each term is oriented, the mean is oriented too; it is still not a percentile of the domain.
- Therefore the stored percentile is oriented, and ADR-025's premise "no good/bad meaning" is partly inaccurate. What remains true: the percentile is a position in the covered panel (a relative rank), not an absolute assessment; "favourable" is defined only by the one-sided direction configured per indicator (`good_dir`, target), which is a configuration choice and not a structural-quality judgement; the standing caveat says exactly that.
- Stored fields available to the browser, with no recomputation [REPO]:
  - `meta/indicators.json` (`src/macro_monitor/publish/schemas/meta-indicators.schema.json`, `meta.py` lines 269-292): `rank_mode` (`monotone_good`, `target_distance`, `descriptive_only`), `good_dir` (-1, 0, +1), `adverse_dir` (-1, 0, +1), `display_dir` (-1, 0, +1, null), `target` ({`value` or null, `source_note`} for `target_distance`, else null), `unit_label`. All are required keys.
  - `scorecard/<domain>.json` entity indicator rows (`scorecard.schema.json`): `rank_mode`, `percentile` (null for descriptive), `percentile_label`, `deviation`, `publish_scope`. They carry NO `good_dir`. The domain-level `percentile_rank_label` is stored.
  - `adverse_dir` is the ALERT direction (+1 when a rise against the series' own history is adverse; `docs/specs/indicator-parameters-spec.md` line 46 [REPO]); it is a different concept from the rank orientation and can differ from `good_dir` (for example an indicator with alert `none` and adverse proposed -1 in `docs/specs/release-lag-and-split-proposal.md` [REPO]). It must not be used to label percentile orientation.
- Current code and wording [REPO]: `site/src/lib/scorecard.js` holds `CAVEAT` and `PERCENTILE_COLUMN_LABEL` ("percentile vs all ranked countries"); both are fixed by the export spec section 5 (line 266). `sortSummaries` sorts by stored `rank_position` then name. Bin edges and landing sort are in ADR-025 decision 4 and brief section 3.2 (edges 0.2, 0.4, 0.6, 0.8).

## Options considered
1. Orientation wording.
   a. No statement (ADR-025 as approved). Rejected by the user: a reader cannot tell what a dark cell means for, say, unemployment.
   b. One fixed legend sentence, plus per-indicator direction labels from stored fields (chosen).
   c. A good/bad judgement label per bin ("weak" ... "strong"). Rejected: contradicts the standing caveat and the confirmed bin labels.
2. Colour scale.
   a. Keep single-hue sequential, dark = higher percentile (chosen).
   b. Diverging around 0.5. Rejected: the midpoint of a percentile is the panel median, not a "neutral" or "acceptable" level, so a diverging ramp would imply a threshold between good and bad that the data does not define; it also encodes the domain mean (not uniformly distributed, export spec line 105) badly; worse for colour-vision deficiency and greyscale print (ADR-025 option 4).
   c. Single hue per orientation or inverted ramps for lower-is-better indicators. Rejected: because the stored percentile is already oriented, a ramp inversion would double-apply orientation and make columns incomparable.
3. Direction source.
   a. Browser derives direction from `adverse_dir`. Rejected: wrong concept (alert tail).
   b. Browser reads `good_dir`, `rank_mode`, `target` from `meta/indicators.json` by `indicator_id` (chosen): a lookup of stored fields, no arithmetic.
   c. Add `good_dir` to scorecard rows. Not needed; would be an export-spec change and is not made here.
4. Overall freshness. a. Export an overall state so V5 shows one light. b. Keep per-group states (chosen; the browser must not derive an overall status, D6).
5. Bin edges. a. Upper-inclusive. b. Lower-inclusive with 1.0 in the top bin (chosen): matches "lowest fifth ... highest fifth", gives 0.2/0.4/0.6/0.8 to the higher bin, and a percentile of exactly 1.0 cannot fall outside.
6. Domain-page sorting. a. Default by the domain figure or `rank_position`. b. Alphabetical by default, then by the clicked column's stored percentile (chosen). A default by the domain figure would act as a ranking of countries by one aggregate; alphabetical makes no claim.

## Decision
1. Orientation is stated, the scale is unchanged. The stored percentile is documented as oriented (higher = more favourable by the indicator's stated direction). The percentile scale stays sequential single-hue in 5 bins with the ADR-025 tokens and ink; the dark theme keeps "more intense = higher percentile". Diverging stays limited to revisions and `deviation`. ADR-025 decision 2's sentence "No good/bad colouring of a percentile" stays true: colour encodes position only; the favourable direction is stated in words.
2. Fixed legend wording (proposed, sentence case, one sentence, to be confirmed by the user; stored in `site/src/lib/copy.js` as `ORIENTATION_NOTE`):
   `Higher percentile means a more favourable position by each indicator's stated direction.`
   Where it appears, always the same string, never paraphrased:
   - V1 landing heatmap legend and V1 domain-page legend, in the legend block directly above the five bin labels (the bin labels "lowest fifth of the panel" ... "highest fifth of the panel" are unchanged and carry no judgement words).
   - V1 domain table: the leading "mean percentile of the domain's indicators" column header carries it as its description (`title` and a visually hidden text referenced by `aria-describedby`, so keyboard and touch users get it; not tooltip-only), and it is also printed in the legend.
   - V2: in the legend line under the controls and as the description of the "percentile vs all ranked countries" column header (same mechanism). The column label itself is unchanged (export spec line 266).
   - Print: part of the repeated legend (ADR-025 decision 9).
   - V3, V4, V5: not shown (no percentile).
3. Coexistence with the standing caveat. The caveat string is unchanged, verbatim, shown on V1 and V2 in its existing bordered note. Order on the page: caveat note, then legend (orientation note plus bins). The two statements do not conflict and are not merged: the legend says which direction "higher" points per indicator; the caveat says the percentile is a relative position in the covered panel and not a judgement of structural quality. "Favourable" is used only in the legend sentence and in direction labels (item 4), never in a cell, bin label or caveat. If the user prefers a bridging clause, the alternative wording is a second option in Q1 below; it is not adopted by default so that the caveat remains verbatim.
4. Direction per indicator, from stored fields only. Each indicator column header (V1 domain page) and each indicator option description (V2) shows a short direction label, a pure mapping of `meta/indicators.json` fields joined on `indicator_id`:

   | Stored fields | Direction label (proposed, fixed) | Percentile cell |
   |---|---|---|
   | `rank_mode = monotone_good`, `good_dir = +1` | `higher is better` | bin colour and number |
   | `rank_mode = monotone_good`, `good_dir = -1` | `lower is better` | bin colour and number |
   | `rank_mode = target_distance` | `closer to target is better` (if `target.value` is not null: `closer to target is better (target <stored value> <unit_label>)`) | bin colour and number |
   | `rank_mode = descriptive_only` | `descriptive, not ranked` (existing confirmed wording) | no bin, no percentile, value on the neutral surface |

   - `adverse_dir` is not displayed as orientation. `display_dir` (optional, null allowed) is not used for any percentile label and is not shown in v1 of this change (it is a descriptive colour hint; use would need its own decision).
   - The label is the same word in the heatmap header, the detail-table header, and the accessible name of the cell group (the popover and the screen-reader reading include it). A `monotone_good` row with `good_dir = 0` cannot occur (rejected at seeding, analytics spec line 71 [REPO]); if the browser nevertheless meets one it prints no direction label and the schema/state test fails the build.
   - Field gap assessment. No field is missing for the three labelled cases: `rank_mode`, `good_dir`, `target` are required keys in the schema. Two caveats to flag, not to fix: (i) scorecard rows do not carry `good_dir`, so the page must load `meta/indicators.json` for the direction label (the site already loads indicator metadata for names and units [UNVERIFIED: confirm the V1 domain page loads it]); (ii) `meta/indicators.json` exports a single `target.value` (`targets_by_indicator`, `meta.py` line 146 [REPO]) although the analytics spec allows a band (distance to the nearest edge) and per-entity targets (`ref.indicator_target` has `entity_id`, `band_low`, `band_high`; `scoring.py` lines 156-157 [REPO]). The label therefore omits the number when it is null and never claims a single target for a banded indicator; if the user wants the band or the per-entity target shown, that is an export-spec change (additive `meta/indicators.json` fields) to be decided separately, and is not made here.
5. Domain figure and aggregates. The legend sentence applies to the domain figure because it is the mean of oriented percentiles; the V1 domain-page description sentence (brief section 4) stays: the figure is the mean percentile of the domain's indicators and not the percentile of the domain. Aggregates (percentile null) and low-coverage states are unchanged.
6. Bin edges are constants 0.2, 0.4, 0.6, 0.8, lower-inclusive: a stored value `p` falls in bin 1 for `0 <= p < 0.2`, bin 2 for `0.2 <= p < 0.4`, bin 3 for `0.4 <= p < 0.6`, bin 4 for `0.6 <= p < 0.8`, bin 5 for `0.8 <= p <= 1.0`. Values exactly 1.0 are in bin 5. A null percentile has no bin. Values outside [0, 1] are an export-contract violation and are shown as the unbinned "n/a"-style error cell, never clamped silently (test in AC-UX-15).
7. Domain-page sorting. Default row order is alphabetical by country name (`localeCompare`, then `entity_id`), not by `percentile_rank` or `rank_position`. A click on an indicator column header sorts by that column's stored `percentile` descending (most favourable first; second click ascending), null last, ties by name; the leading domain-figure column sorts by its stored `percentile_rank` in the same way. `aria-sort` reflects the state. Aggregates stay in their separate group and are not sorted into the countries. The landing heatmap behaviour of ADR-025 decision 4 is unchanged (alphabetical default, column sort by stored `rank_position`, null last); the difference between the two columns is intentional: on the landing the domain column is ranked by position (low-coverage entities have null position and sort last), on the domain page the user asked for the stored percentile of the clicked column (see Q3).
8. No new overall-freshness field. The export gets no overall freshness state; V5 keeps the per-group `state` list (`status.schema.json` `groups[].state` [REPO]). ADR-025 Q6 is answered "per-group". The stale banner logic of ADR-025 decision 10 is unchanged.
9. No change to code, export schemas, specs, other ADRs, `CLAUDE.md`.

## Consequences
- Positive: the user can read what a dark cell means for each indicator; wording is a one-to-one function of stored fields, so D6 holds; the caveat remains verbatim; no scale or token change, no dependency, no data fetch beyond the metadata file the site already uses [UNVERIFIED].
- Negative: the word "favourable" appears next to percentiles, so the ADR-025 "no judgement words next to percentiles" test needs a precise allow-list instead of a blanket ban; a reader may still over-read "favourable" as a quality verdict (mitigated by the caveat directly above the legend and by the sequential neutral colour); a label for banded or per-entity targets is limited by the single exported target value.
- Effect on acceptance criteria (ADR-025):
  - AC-UX-3 unchanged ("more intense = higher percentile" in both themes), and now documented as also meaning "more favourable".
  - AC-UX-10 extended: the direction label of each sampled indicator equals the mapping in decision 4 computed from `meta/indicators.json`; the static scan finds no use of `adverse_dir` or `display_dir` in the percentile or direction modules; bins for sampled cells follow decision 6 including the values 0, 0.2, 0.4, 0.6, 0.8, 0.9999 and 1.0 (1.0 in bin 5); sort order test: default alphabetical, clicked column order equals the stored percentile order with nulls last.
  - AC-UX-13 revised: the judgement-word ban applies to cells, bin labels, the caveat and the domain-figure label; it is lifted ONLY for the exact `ORIENTATION_NOTE` string and the four direction labels of decision 4, which are asserted verbatim and must appear on V1 landing (if shipped), V1 domain pages and V2; the caveat, "percentile vs all ranked countries", the domain-figure label, "descriptive, not ranked" are still asserted verbatim; "first release" and "first stored release" still absent.
  - New AC-UX-15 (orientation and direction): for each of the four stored-field cases a fixture indicator renders the specified label in the column header and in the cell's accessible name; a descriptive indicator renders no bin and no percentile; the legend contains the orientation note exactly once per page and in print emulation; the caveat precedes the legend in DOM order; a value outside [0, 1] produces the error cell.
  - AC-UX-5 unchanged (header `th scope`, `aria-describedby` target exists and is non-empty).
- Wording the user must confirm (all in `copy.js`, ADR-025 decision 11 and Q10): the orientation note; the four direction labels (`higher is better`, `lower is better`, `closer to target is better` with the optional target suffix, and the existing `descriptive, not ranked`); where the note is attached (legend, domain-figure header, V2 percentile column header). Nothing ships until confirmed.
- Reversal: the note and labels are strings in one module and the scale is a token set, so reversing to ADR-025 wording is a copy change plus test updates; the sort and bin rules are small constants.

## Open questions for the user
- Q1 Wording: approve `Higher percentile means a more favourable position by each indicator's stated direction.`? Alternative with a bridging clause (keeps the caveat verbatim but ties them): `Higher percentile means a more favourable position by each indicator's stated direction, within the covered panel.` Which one?
- Q2 Direction labels: approve `higher is better`, `lower is better`, `closer to target is better` (with the target value when stored)? Or omit the target value in v1?
- Q3 Domain-page sorting: should the leading domain-figure column sort by stored `percentile_rank` (as decided here, low-coverage entities interleave with ranked ones) or by stored `rank_position` with null last (as on the landing, low-coverage entities last)?
- Q4 Targets: should the band or per-entity target be exported and shown? That is an export-spec change (additive `meta/indicators.json` fields) and needs its own decision; not made here.
- Q5 `display_dir`: leave it unused in the dashboard (decided here), or show its hint for descriptive indicators in a later change?

## Sources (all [REPO], read 2026-11-04)
- `docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md`, `docs/design/briefs/dashboard-ux-brief.md` (sections 3.2, 4)
- `docs/specs/analytics-and-r-contract-spec.md` (lines 67-71, 146), `docs/specs/dashboard-export-spec.md` (lines 101-109, 266), `docs/specs/indicator-parameters-spec.md` (line 46), `docs/specs/release-lag-and-split-proposal.md` (line 61)
- `src/macro_monitor/analytics/scoring.py`, `src/macro_monitor/publish/meta.py`, `src/macro_monitor/publish/schemas/meta-indicators.schema.json`, `scorecard.schema.json`, `status.schema.json`
- `site/src/lib/scorecard.js`, `site/src/index.md`

## User decisions recorded 2026-11-04 (stated in session)
- Q1: the main legend wording is approved; the "within the covered panel" variant is not used.
- Q2: the direction labels are approved; the target value is shown only when stored.
- Q3: the domain-figure column on the domain page sorts by `rank_position`, nulls last, as the landing does.
- Q4: band and per-entity target export is deferred to a separate spec change.
- Q5: `display_dir` stays unused in the dashboard for v1.
- The new copy strings still ship only after the user confirms them at the Stage 1 review.
