---
status: draft   # proposal for the user to answer; nothing here is decided (plan OQ-10, user instruction of 2026-10-27, stated in session)
inputs:
  - docs/specs/indicator-parameters-spec.md        # sections 4, 5, 7 items 5-7
  - docs/specs/analytics-and-r-contract-spec.md    # sections 4.1, 5, 8, P5, P15
  - docs/research/indicator-selection-g20-eu-cross-country.md   # catalog rows, D14 staleness table
  - docs/plans/macro-monitor-v1-implementation-plan.md          # OQ-10
---
# Proposal: `release_lag_aware` list, rows that define several measures, G11 versus A26, adverse directions

Status of this document: every value below is a PROPOSAL. The user did not decide plan OQ-10 (instruction of 2026-10-27, stated in session: "do NOT decide; produce a row-by-row proposal table for the user to answer"). Nothing in the parameters spec, the source-config schema, the DDL or the plan changes until you answer in the "Your answer" columns. Until then the existing text stands: the five multi-measure rows are single indicators with a note, G11 and A26 are both kept, and the `release_lag_aware` list is the draft list of the parameters spec section 7 item 7 (A12, A13, A14, A22, A26, G12), written `proposed`.

Sources: the approved selection `docs/research/indicator-selection-g20-eu-cross-country.md` (catalog rows and the D14 staleness table, read 2026-10-27; local file, no URL) and the specs named in `inputs`. Labels: R = stated by the selection; A = already written in a spec; J = my judgement, not research; [UNVERIFIED] = not checked against a source. No external web source was used.

## 1. What the options do (so the answers can be given without reading the specs)
- `release_lag_aware` (analytics spec section 8): when on for an indicator, `stale_limit_days = max(class_limit, typical_publication_lag_days + tolerance_days)`, lag and tolerance from `release_calendar.yaml`. It can only RAISE a limit. Class limits (D14): ACT120 120 days, Q270 270, A730 730 (24 months), TRI1460 1460 (4 years). Consequence used below: for a row whose class is TRI1460 the option has no effect unless lag plus tolerance exceeds 1460 days; for a row of class A730 it matters when the publication lag is about 2 years (the value for year Y, reference period end 31 December Y, arrives in about mid Y+2 and is already about 730 days old; analyst arithmetic).
- A split creates new indicator ids. The catalog already uses a letter suffix for sibling rows (A02b, A02c), so the proposed ids are `Q11b`, `A13b`, `A22b`. The approved selection (research, user-owned) has no such rows: any split needs the user to amend the selection in phase 1a first (CLAUDE.md gate), and a new source row needs no research only if the source already covers it (stated per row).
- Counts today: 80 active indicators = 29 monthly + 17 quarterly + 34 annual; 28 core. Core membership is not affected by any proposal below (Q11, A13, A22, G11, A26 are not core; A10 and A16 are core and stay one id each).

## 2. (a) `release_lag_aware`: which indicators
Rule used for the proposal (J): enable only where the selection states a publication lag long enough to make a value stale on arrival under its class, because the option changes the effect of approved D14 limits (analytics spec section 8, P5).

| Row | Class today | Evidence (selection) | PROPOSAL | Reason | Your answer |
|---|---|---|---|---|---|
| A12 Health expenditure % GDP | A730 | "Lag ~2 years" (R) | ON | Lag about equals the limit; many values would arrive stale (design R24) | |
| A20 GHG emissions | A730 | "Lag 1-2 years" (R), optional tier | ON | Upper end of the lag exceeds the limit; low cost, optional tier | |
| A13 Education | TRI1460 | PISA is 3-yearly; no lag stated | OFF | Class already 4 years; option would not change the limit. Borderline instead: a 3-year cycle plus about a year of publication lag is close to 1460 days [UNVERIFIED]; if that matters, change the class limit, not this flag | |
| A14 Inequality | TRI1460 | EU-SILC is annual (selection note in the parameters spec 5.3), no lag stated | OFF | No effect under TRI1460. If you decide EU-SILC series belong in A730 the question reopens | |
| A22 Poverty, participation | TRI1460 | "Survey-based irregular years" (R) | OFF | No effect under TRI1460; a country with no survey for four years is meant to be stale | |
| A26 Food share (USDA ERS) | TRI1460 | "years and frequency not stated on the page" (R) | OFF | No evidence of a lag; the class is itself unresolved (parameters spec 7 item 3) | |
| G12 Undernourishment (FAO) | TRI1460 | "lag ~1 year" (R) | OFF | One year is far inside 1460 days | |
| A11 Life expectancy | A730 | no lag stated | OFF | No evidence; COV-01 will show it if needed | |
| A19 Energy dependence | A730 | "Lag ~1 year" (R) | OFF | Inside the limit | |
| every other row | by class | none stated | OFF | Global default stays false | |

Effect of the proposal on the draft list: the draft list (A12, A13, A14, A22, A26, G12) shrinks to A12 and A20; four of the six draft members would have no effect anyway under TRI1460. Alternative the user may prefer: keep the draft list as written (harmless, no effect for the TRI1460 rows). Consequence for configuration if accepted: `release_lag_aware: true` on A12 and A20 only; AC-PAR-8 golden values and the AC-AN-12 fixture are unchanged in form; `limit_source = 'release_lag_aware'` can appear only for those two indicators.

## 3. (b) Rows that define more than one measure
Today each of these is one indicator with a note; the DDL, the rank modes and the staleness class are one value per indicator, so one row cannot carry opposite orientations (Q11) or two classes (A13).

| Row | Measures in the row (R) | Conflict | PROPOSAL | Ids and counts if accepted | Source cover [UNVERIFIED unless stated] | Your answer |
|---|---|---|---|---|---|---|
| Q11 | NPL ratio; Tier 1 capital | Opposite orientation: NPL lower is better, capital higher is better (analytics 4.1: one orientation per series) | SPLIT: `Q11` = NPL ratio, `Q11b` = Tier 1 capital ratio | quarterly 17 to 18; total +1 | Both are IMF FSIs (selection source column), so no new source family | |
| A10 | Population; working-age share; old-age dependency | Three measures; the second and third are mirror images of one age structure; population level is size information, not a score | KEEP as one id; headline = working-age share (already in the analytics monotone list); the other two are recorded as not onboarded in v1 | counts unchanged | UN WPP / WDI carry all three | |
| A13 | Tertiary attainment 25-34; PISA; schooling years | Different frequency and class: annual (A730) versus 3-yearly (TRI1460) | SPLIT in two: `A13` = tertiary attainment 25-34 (annual, A730), `A13b` = PISA (TRI1460); schooling years not onboarded in v1 | annual 34 to 35; total +1 | OECD covers both; UNESCO UIS for schooling years (not onboarded) | |
| A16 | Six WGI dimensions | Six measures of one composite family; splitting would add five annual rows and weight the Structural domain heavily | KEEP as one id; headline = Government effectiveness; the other five dimensions not onboarded in v1 (J: the headline choice is arbitrary, please confirm or name another) | counts unchanged | One World Bank file carries all six, so adding them later is cheap | |
| A22 | Poverty headcount; labour force participation | Different orientation (poverty lower is better; participation has no clear direction) and different sources and classes | SPLIT: `A22` = poverty headcount (TRI1460), `A22b` = labour force participation (annual, A730) | annual +1; total +1 | WB PIP and ILOSTAT; ILOSTAT terms are unconfirmed (design BB12), so `A22b` may start as a `known_gap` | |

Combined effect if all PROPOSAL rows in (b) are accepted: quarterly 18, annual 36 (before (c)), monthly 29; total 83; core 28 unchanged. Effects on documents if accepted: `indicators.yaml` and `series_map` seed gain Q11b, A13b, A22b; AC-PAR-1 golden table (80 plus X01-X03 becomes 83 plus X01-X03); AC-PAR-4 list (A13 leaves the TRI1460 set; A13b joins it; A22 stays); AC-PAR-5 and the analytics 4.1 `monotone_good` list gain the new members that are `monotone_good` (see section 5); design counts "about 80", the "29/17/34" statements and the selection's own counts section need the user's amendment.

## 4. (c) G11 versus A26
Facts (R): G11 "Same as A26 ... duplicate: keep one row in the data design; this ID is the agri-scorecard membership of A26". The parameters spec rows are identical in every parameter except the domain (A26 `social`, G11 `agri`), both `descriptive_only`, TRI1460, alert none.

| Question | PROPOSAL | Consequence | Your answer |
|---|---|---|---|
| Does G11 duplicate A26? | Yes, as the selection itself says | | |
| Resolution | MERGE: keep `A26` as the only indicator and attach it to both domains (`social` and `agri`) through `ref.indicator_domain` (the same mechanism G01 uses for `prices` and `agri`); retire the id G11 | annual 34 to 33 (or 36 to 35 after (b)); total 79 (or 82 after (b)); one series set instead of two identical exports; the `agri` domain keeps its membership because it is unranked and A26 is `descriptive_only` there | |
| Alternative | KEEP both ids and map both to the same series | Two identical indicators, two series files, double storage and double listing; not recommended | |

## 5. (d) Adverse direction per affected row
`alert.adverse` is +1 when a rise relative to own history is adverse, -1 when a fall is adverse, 0 when both tails are evaluated (parameters spec section 2). For rows whose alert method is `none` the value has no effect on any output today; it is still a required no-default field (rule 22). Column "Today" is the parameters spec value; every adverse direction is J.

| Row | Today | PROPOSAL adverse | Rank mode (PROPOSAL) | Alert method | Reason | Your answer |
|---|---|---|---|---|---|---|
| Q11 NPL ratio | +1 | +1 | M- | z | A rise in non-performing loans is adverse | |
| Q11b Tier 1 capital | (new) | -1 | M+ | z | A fall in capital is adverse | |
| A10 working-age share | 0 | -1 | M+ | none | A falling working-age share is the adverse tail; no alert is produced | |
| A13 tertiary attainment | 0 | -1 | M+ | none | A fall is adverse; no alert | |
| A13b PISA | (new) | -1 | M+ | none | A fall is adverse; no alert | |
| A16 Government effectiveness | 0 | -1 | M+ | none | A fall in the score is adverse; no alert | |
| A22 poverty headcount | 0 | +1 | M- | none | A rise is adverse; no alert | |
| A22b labour force participation | (new) | 0 | D | none | Direction is not clear-cut (age and gender composition) | |
| A12 health expenditure (list) | 0 | 0 | D | none | No better direction; unchanged | |
| A20 GHG emissions (list) | 0 | +1 | D | none | A rise is adverse; kept descriptive because the environment tier is optional (D8) | |
| A26 (merged, if (c) accepted) | 0 | 0 | D | none | Not a good/bad measure without income control (R) | |

Open inconsistency found while preparing this table (reported, not resolved here): in the parameters spec section 5.3 the A22 row has rank `M-` (monotone_good), but the count in section 5.5 (25 members) and the list in analytics spec section 4.1 do not contain A22, and the row's own note says K:U. AC-PAR-5 requires the table and the list to agree. Please answer: is A22 (poverty headcount) `monotone_good` with `good_dir = -1` (then the list and the count become 26) or `descriptive_only` (then the table row changes to `D`)? PROPOSAL: `monotone_good`, `good_dir = -1`, because a lower poverty headcount is unambiguously better, which matches the `M-` already in the table.

## 6. How to answer
Fill the "Your answer" column per row (accept, change, reject). After your answer the design phase will (1) update the parameters spec rows and counts, the source-config examples, the DDL comments that carry counts, the golden-table acceptance criteria (AC-PAR-1, AC-PAR-4, AC-PAR-5) and the plan's OQ-10, (2) list the spec files for re-approval. If you accept any split or the G11 merge, the selection document must be amended by you in phase 1a first; this proposal does not edit it.

## 7. Acceptance criteria (apply only after the user answers)
- AC-RLS-1 The answered rows are transcribed into `indicator-parameters-spec.md` sections 5 and 7 with the date of the answer and the words "stated in session"; this file is then marked as superseded for those rows.
- AC-RLS-2 After a split, `config-report` prints the new totals (for the all-accepted case of (b) 83 indicators plus X01-X03; 80 to 83 for the other combinations of (b); 79 to 82 when the G11 merge is accepted as well) and the golden table of AC-PAR-1 equals them.
- AC-RLS-3 After the G11 merge no active indicator has the id G11, A26 is in the domains `social` and `agri`, and `scorecard/agri.json` still lists A26 (descriptive, unranked).
- AC-RLS-4 The `release_lag_aware` list in `ref.indicator` equals the answered list; every other indicator resolves to false; AC-AN-12 still passes.
