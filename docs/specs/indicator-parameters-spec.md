---
status: approved   # approved by the user on 2026-11-01 (stated in session); reset from approved on 2026-10-27 by the Phase 2 amendment (Q06 closed, OQ-10 proposal pointer)
inputs:
  - ADR-014
  - ADR-017
  - docs/research/indicator-selection-g20-eu-cross-country.md   # D6, D9, D12, D14, D16, D19, catalog
  - docs/specs/analytics-and-r-contract-spec.md                 # sections 4.1, 5, P1-P22
  - docs/specs/source-config-schema.md                          # section 3 and 3a
  - docs/specs/ddl-neon-schema.md                               # ref.indicator
  - docs/specs/release-lag-and-split-proposal.md                # OQ-10 proposal (draft; nothing decided)
---
# Spec: indicator parameters (defaults, families, overrides) and the draft parameter table

Sources for the facts below: the approved indicator selection `docs/research/indicator-selection-g20-eu-cross-country.md` (read 2026-10-24; local file, no URL) and the design specs named in `inputs`. Labels: R = stated by the approved research; A = already written in the analytics or source-config spec (itself a proposal or recorded answer, see the decision list); J = my analyst judgement, not research; U = needs a user decision. No external web source was used in this document.

Round 6 (2026-10-25): the DDL spec now stores the two ADR-014 fields as columns of `ref.indicator` (`stationarity_class`, `release_lag_aware`; DDL spec section 2, T-DDL-27); the WEO inconsistency of section 9 is resolved by the user's Q37 decision (ADR-017). Nothing else in this document changed; all parameter rows stay `proposed`.

Fix pass (2026-10-25): the `trending_level` inconsistency of section 9 is resolved by the user's decision to follow the analytics spec section 5 and this section 9 (source-config rule 29 changed accordingly); `release_lag_aware` is worded identically in every document (section 3 and section 7 item 7); source-config section 3 and 3a now list the ADR-014 keys, so rule 23 ("unknown keys are errors") is consistent with that schema; the `|z|` cell of section 3 is escaped; AC-PAR-9 covers the negatives of rules 22-26.

Second fix pass (2026-10-25): the A05 example of source-config section 3 no longer carries a fixed `euro_area` override, so it agrees with the user's answer to design Q50 (2026-10-24: z-score only for now; no fixed per-group overrides until the user supplies groups, thresholds and rationales). The open marking of Q50 is removed from the A05 row and from section 9. What stayed open at that time was the separate item 8 of section 7 (the BIS gap thresholds of Q06), because the text of Q50 does not name them; CLOSED on 2026-10-27 (next paragraph). New AC-PAR-10.

Phase 2 amendment (2026-10-27; user decisions stated in session, applied by the design phase; the user re-approves this file):
- Q06 / plan OQ-15: the user decided that the BIS-gap alert thresholds are z-score only (Q50 extended to Q06). The statement "fixed 2/10 pp alert overrides remain" is removed from this spec (Q06 row, section 7 item 8, section 9) and from the analytics spec section 4.1 and the design. Item 8 is closed. New AC-PAR-11.
- Plan OQ-10 is NOT decided. The rows that define several measures (Q11, A10, A13, A16, A22), G11 versus A26, the `release_lag_aware` list and the adverse directions of the affected rows are put to the user as a row-by-row PROPOSAL in `docs/specs/release-lag-and-split-proposal.md` (status draft). Sections 5 and 7 below are unchanged by it until the user answers; the draft list of section 7 item 7 and the single-row treatment of Q11, A10, A13, A16, A22 stand meanwhile.
- Found while preparing the proposal and left for the user (section 9, last bullet): the A22 row shows `M-` but the count in section 5.5 and the analytics list in section 4.1 do not include A22.

## 1. Purpose and scope
Defines how the parameters of each indicator in `ref.indicator` are produced (ADR-014), the family defaults, and a draft value table for the 80 active indicators of the selection (counts section "Counts" of the selection: 29 monthly, 17 quarterly, 34 annual including A02b/A02c and G07-G15 without G13) plus the support inputs X01-X03. It does not change the DDL columns beyond the two additions that the DDL spec round 6 makes (`stationarity_class`, `release_lag_aware`, both NOT NULL without a database default; the resolved value is written by `sync-config`; `provenance` and `review` stay in `params`). It does not decide anything that belongs to the user: it proposes.

## 2. Resolution model
Order, lowest to highest: `global` defaults, `families.<id>` defaults, the indicator entry in `config/indicators.yaml`, then `alert.override` (per entity group, P19) and entity attributes. `sync-config` writes the resolved values to `ref.indicator` and `params.provenance`/`params.review`. The keys that an indicator entry may carry for this purpose (`family`, `stationarity_class`, `release_lag_aware`, `review`) and the layout of `config/indicator_defaults.yaml` are also listed in the source-config schema (sections 3 and 3a, rule 29), so that the schema's "unknown keys are errors" and this spec agree; where the two differ in meaning, this section and section 8 are normative for the defaults and rules 22-26.

```yaml
# config/indicator_defaults.yaml (illustrative shape, not the final file)
global:
  alert: {alert_z: 2.0, watch_z: 1.5, window_obs: {M: 240, Q: 80, A: 20}, min_obs: {M: 60, Q: 20, A: 10}}   # D19; watch_z 1.5 and min_obs: recorded as accepted in design 14b (Q6), see decision list
  max_ref_spread_days: {M: 92, Q: 190, A: 366}          # P2
  release_lag_aware: false
  stationarity_class: stationary
families:
  market_rate: {staleness_class: MKT45, alert: {method: z}, stationarity_class: trending_level}
  # ... one entry per family of section 4
# config/indicators.yaml entry (only what differs from the family, plus the no-default fields)
- {id: M18, family: market_rate, tier: M, ..., alert: {method: robust_z, adverse: +1}, rank: {mode: descriptive_only, good_dir: 0}, stationarity_class: stationary}
```
Fields with no default at any layer: `kind`, `scope`, `tier`, `priority`, `currency_basis`, `transform`, `rank.mode`, `rank.good_dir`, `alert.adverse`, `domains` (and the target for `target_distance`). Sign conventions: `alert.adverse` = +1 when a rise relative to the own history is adverse, -1 when a fall is adverse, 0 when both tails are evaluated (analytics spec section 5); `good_dir` = +1 higher is better, -1 lower is better, 0 none (DDL `rank_mode_dir` check).

## 3. Global defaults (all from the specs; none new)
| Parameter | Value | Basis |
|---|---|---|
| alert level / watch level | \|z\| >= 2.0 / 1.5 | R: D19 (2.0); 1.5 pending in the selection, recorded as accepted in design 14b (Q6) |
| window (observations) | 240 M / 80 Q / 20 A | R: D19 |
| minimum observations for any alert | 60 M / 20 Q / 10 A | A: selection short-series proposal; accepted per design 14b (Q6) |
| max reference-period lag vs rank period | 92 / 190 / 366 days (M/Q/A) | A: P2; accepted per design 14b (Q29) |
| `rank_period_coverage_pct`, `min_coverage_for_rank`, `cov_min_entities` | 70, 0.5, 10 | A: P2, P20 |
| `hi_inflation_threshold`, `max_denominator_age_days` | 0.25, 120 | A: P10 |
| `release_lag_aware` | global default false; on for a named list, list pending the user (OQ-10, section 7 item 7; row-by-row proposal in `release-lag-and-split-proposal.md` section 2) | A: P5; design 14b Q31 (the user switched the option on; the list is not yet given) |

## 4. Families (defaults)
| Family | Staleness | Alert method | Stationarity | Meaning | Basis |
|---|---|---|---|---|---|
| `activity_yoy` | ACT120 | z | rate_of_change | monthly activity, labour or money growth rates | S:R A:J |
| `price_rate` | ACT120 | robust_z | rate_of_change | consumer or producer price inflation rates | S:R A:R (D19: inflation skewed) |
| `survey_balance` | SURV75 | z | stationary | confidence balances | S:R A:R (selection M03: own-history z) |
| `market_rate` | MKT45 | z | trending_level | monthly market data: rates, FX, yields, commodity prices | S:R (D14) A:J |
| `labour_rate_level` | ACT120 | z | trending_level | unemployment-type rate levels | S:R A:J T:A (analytics section 5 lists unemployment level) |
| `external_ratio` | ACT120 (M) / Q270 (Q) | z | trending_level | balances, reserves and debt ratios | S:R (by frequency) |
| `quarterly_growth` | Q270 | z | rate_of_change | quarterly growth and volume series | S:R |
| `quarterly_ratio` | Q270 | z | trending_level | debt, balance and soundness ratios | S:R T:A for debt ratios |
| `annual_alerted` | A730 | z | stationary | annual fiscal and cycle indicators that stay in the early-warning scope | S:R A:J |
| `annual_structural` | A730 | none | stationary | slow-moving structural, demographic, environmental and agri annual series | S:R A:J (not U2 early warning) |
| `triennial_survey` | TRI1460 | none | stationary | survey-based or three-year-average series | S:R (D14 names PISA, poverty and inequality surveys, FAO 3-year averages) |
| `weo_projection` | A730 | none | stationary | WEO projection series (A03) | S:J, A:A (P6: not alerted) |
| `comparison_series` | A730 | none | stationary | A02b, A02c (D18) | S:J |
| `support_input` | by input | none | stationary | X01-X03 | A (source-config, kind input) |

## 5. Draft per-indicator table
Columns: `Fam` family; `Stale` staleness class; `Alert` method (`z`, `rz` robust z, `none`); `Adv` alert.adverse; `Rank` rank mode and good_dir (`M+`/`M-` = monotone_good with good_dir +1/-1, `T` = target_distance (target 0 for A02), `D` = descriptive_only with good_dir 0, `D+` = descriptive_only with display_dir +1); `Stat` stationarity (`stat`, `trend` = trending_level, `roc` = rate_of_change); `Domain` as in the selection scorecard table (`-` = in no approved scorecard domain; `glob` = the informational `global` panel, P6); `Basis` letters per field: S staleness, A alert method, D adverse direction, K rank, T stationarity, each with R/A/J/U. Every Adv value is J (the research never lists adverse directions) unless noted; every K value marked A is a proposal in the analytics spec (P1, P12-P14) whose recorded answer is in the decision list.

### 5.1 Monthly (29)
| ID | Fam | Stale | Alert | Adv | Rank | Stat | Domain | Basis and notes |
|---|---|---|---|---|---|---|---|---|
| M01 | activity_yoy | ACT120 | z | -1 | M+ | roc | growth | S:R K:A |
| M02 | activity_yoy | ACT120 | z | -1 | M+ | roc | growth | S:R K:A |
| M03 | survey_balance | SURV75 | z | -1 | D+ | stat | growth | S:R A:R K:A (P12) |
| M04 | survey_balance | SURV75 | z | -1 | D+ | stat | growth | S:R A:R K:A (P12) |
| M05 | activity_yoy | ACT120 | z | -1 | D+ | stat | growth | S:J (CLI is not a survey; lag 1-2 months per selection) K:A (P12) T:J |
| M06 | price_rate | ACT120 | rz | +1 | D | roc | prices | S:R A:R K:A (P13) D:J (deflation is also adverse; use 0 if you prefer both tails: U) |
| M07 | price_rate | ACT120 | rz | +1 | D | roc | prices | as M06 |
| M08 | price_rate | ACT120 | rz | +1 | D | roc | prices | as M06 (ext) |
| M09 | labour_rate_level | ACT120 | z | +1 | M- | trend | labour | S:R K:A T:A |
| M10 | labour_rate_level | ACT120 | z | +1 | M- | trend | labour | S:R K:A (ext) |
| M11 | activity_yoy | ACT120 | z | -1 | M+ | roc | labour | S:R K:A (opt) |
| M12 | activity_yoy | ACT120 | z | 0 | D | roc | external | S:R (trade is listed under monthly activity) K:A (P14) |
| M13 | external_ratio | ACT120 | z | -1 | D | trend | external | K:A (P14); needs X01 (analytics section 3) |
| M14 | external_ratio | ACT120 | z | -1 | D | trend | external | S:J K:U (is the cover ratio ranked? analytics P14 lists the level as descriptive); no monthly source researched, n/a at launch (design section 5) |
| M15 | external_ratio | ACT120 | rz | 0 | D | stat | external | S:U (REER is derived from FX and CPI: market class 45 days or activity class 120 days; D14 does not say) A:J K:A |
| M16 | market_rate | MKT45 | rz | +1 | D | roc | external | S:R A:R D:J (LCU per USD rising = depreciation) K:A; domain follows Q20/Q30 option (a), recorded in design 14b |
| M17 | market_rate | MKT45 | z | 0 | D | trend | fin | S:R K:A; alerts mostly `sd_zero` for long-constant rates |
| M18 | market_rate | MKT45 | rz | +1 | D | stat | fin | S:R A:R K:A (P16) T:J |
| M19 | market_rate | MKT45 | z | 0 | D | trend | fin | S:R K:A (P14) |
| M21 | price_rate | ACT120 | rz | +1 | D | roc | fin | S:R A:R (credit growth skewed) K:A (P14) |
| M22 | activity_yoy | ACT120 | z | 0 | D | roc | - | opt; no scorecard domain in the selection; K:J |
| M24 | market_rate | MKT45 | rz | +1 | D | roc | glob | S:R (commodity prices) A:R K:A (P6); scope global (WLD) |
| M27 | activity_yoy | ACT120 | z | -1 | D | roc | environment | opt; K:U (environment tier is optional, D8; no rank mode proposed in the specs) |
| G01 | price_rate | ACT120 | rz | +1 | D | roc | prices, agri | S:R A:R K:A (P13) |
| G02 | market_rate | MKT45 | rz | +1 | D | roc | agri | S:R A:R K:A (D12 domain unranked); scope global (WLD) |
| G03 | activity_yoy | ACT120 | z | -1 | D | stat | agri | S:U (monthly estimates of marketing-year balances, calendar_basis MKTYR) A:J; scope: world plus selected countries (U) |
| G04 | activity_yoy | ACT120 | z | -1 | D | stat | agri | S:R K:A (D12) |
| G05 | market_rate | Q270 | rz | 0 | D | stat | agri | S:U (monthly values, released quarterly per the selection; 120 days would be stale on arrival) opt |
| G06 | activity_yoy | ACT120 | z | 0 | D | stat | agri | S:U (observed weather, lag unknown) opt |

### 5.2 Quarterly (17)
| ID | Fam | Stale | Alert | Adv | Rank | Stat | Domain | Basis and notes |
|---|---|---|---|---|---|---|---|---|
| Q01 | quarterly_growth | Q270 | z | -1 | M+ | roc | growth | S:R K:A |
| Q02 | quarterly_growth | Q270 | z | -1 | M+ | roc | growth | S:R (Q/A series; annual-only countries are then stale after 270 days: U) K:A |
| Q03 | quarterly_growth | Q270 | z | -1 | M+ | roc | labour | S:R K:A |
| Q04 | quarterly_growth | Q270 | z | 0 | D | roc | growth | K:U (contributions to growth have no single better direction; not in any analytics list) |
| Q05 | quarterly_ratio | Q270 | z | -1 | D | trend | external | S:R K:A (a balance can be good or bad, analytics 4.1) |
| Q06 | quarterly_ratio | Q270 | z | +1 | D | stat | fin | S:R K:A (P14); alert thresholds are z-score only, no fixed override (user decision 2026-10-27, stated in session; extends the Q50 answer to the BIS gap; closes plan OQ-15) |
| Q07 | quarterly_growth | Q270 | z | +1 | D | roc | fin | S:R K:A (P14) A:J (house prices are not in the D19 skewed list) |
| Q08 | quarterly_ratio | Q270 | z | +1 | M- | trend | fiscal | S:R K:A (P15 concept with A05) |
| Q09 | quarterly_ratio | Q270 | z | -1 | D | trend | external | K:U (NIIP is valuation-driven; not in any analytics list; D proposed as the cautious class) |
| Q10 | quarterly_ratio | Q270 | z | +1 | M- | trend | external | K:A |
| Q11 | quarterly_ratio | Q270 | z | +1 | M- | trend | fin | K:A with U: the selection defines NPL ratio AND Tier 1 capital in one row; one orientation per series (analytics 4.1), so the row must be split or one measure chosen (OQ-10; proposal in `release-lag-and-split-proposal.md` section 3) |
| Q12 | quarterly_ratio | Q270 | z | -1 | M+ | stat | fiscal | S:R K:A (P15 with A04) |
| Q13 | quarterly_ratio | Q270 | z | +1 | M- | trend | fin | S:R K:A (opt) |
| Q14 | quarterly_growth | Q270 | z | 0 | D | stat | - | Lic V, may be dropped (selection); no domain; K:J |
| Q15 | quarterly_growth | Q270 | z | -1 | M+ | roc | structural | S:R (Q/A) K:A |
| Q16 | quarterly_growth | Q270 | z | +1 | D | roc | - | opt; K:U (no domain in the selection) |
| Q17 | quarterly_growth | Q270 | z | -1 | D | roc | agri | opt; K:A (D12) |

### 5.3 Annual (34)
| ID | Fam | Stale | Alert | Adv | Rank | Stat | Domain | Basis and notes |
|---|---|---|---|---|---|---|---|---|
| A01 | annual_structural | A730 | none | 0 | M+ | stat | structural | S:R A:J K:A; core |
| A02 | annual_alerted | A730 | z | 0 | T (target 0) | stat | growth | K:A (analytics 4.1); alerts only on labelled estimates, P7; IMF only, 25 of 42 (D22) |
| A02b | comparison_series | A730 | none | 0 | D | stat | - | comparison (D18); never ranked |
| A02c | comparison_series | A730 | none | 0 | D | stat | - | comparison (D18) |
| A03 | weo_projection | A730 | none | 0 | D | stat | - | PROJ; P6 |
| A04 | annual_alerted | A730 | z | -1 | M+ | stat | fiscal | K:A (P15 with Q12) |
| A05 | annual_alerted | A730 | z | +1 | M- | trend | fiscal | K:A; no fixed 60/90 override: z-score only (design 14b/section 14 Q50, answered 2026-10-24); the source-config section 3 example was corrected to match in the second fix pass |
| A07 | annual_structural | A730 | none | 0 | M+ | stat | structural | K:A with doubt (investment share has no clear better direction): U |
| A08 | annual_structural | A730 | none | 0 | D | stat | - | opt; no domain |
| A09 | annual_structural | A730 | none | 0 | M+ | roc | structural | K:A |
| A10 | annual_structural | A730 | none | 0 | M+ | stat | social | K:A (working-age share); the row defines three measures (population, working-age share, old-age dependency): headline measure U (OQ-10; proposal in `release-lag-and-split-proposal.md` section 3) |
| A11 | annual_structural | A730 | none | 0 | M+ | stat | social | K:A |
| A12 | annual_structural | A730 | none | 0 | D | stat | social | K:U (no direction; not in any analytics list); candidate for `release_lag_aware` |
| A13 | triennial_survey | TRI1460 | none | 0 | M+ | stat | social | S:R (PISA) K:A; several measures in one row (tertiary share, PISA, schooling): headline U (OQ-10; proposal in `release-lag-and-split-proposal.md` section 3) |
| A14 | triennial_survey | TRI1460 | none | 0 | M- | stat | social | S:R (inequality surveys) with doubt (EU-SILC is annual): U; K:A; core |
| A15 | annual_structural | A730 | none | 0 | D | stat | - | opt; no domain |
| A16 | annual_structural | A730 | none | 0 | M+ | stat | structural | K:A; core; six dimensions in one row (headline or average: U; OQ-10) |
| A18 | annual_structural | A730 | none | 0 | D | stat | structural | opt |
| A19 | annual_structural | A730 | none | 0 | D | stat | environment | opt tier (D8); K:U |
| A20 | annual_structural | A730 | none | 0 | D | stat | environment | opt tier; K:U |
| A21 | annual_structural | A730 | none | 0 | D | stat | environment | opt tier; K:U |
| A22 | triennial_survey | TRI1460 | none | 0 | M- | stat | social | S:R (poverty surveys) K:U (poverty headcount and labour-force participation are two measures in one row; orientation differs); this row shows `M-` but the count in 5.5 and the analytics list 4.1 do not contain A22 (section 9, last bullet) |
| A23 | annual_structural | A730 | none | 0 | D | stat | structural | opt |
| A24 | annual_alerted | A730 | z | -1 | M+ | stat | fiscal | K:A; opt |
| A25 | annual_alerted | A730 | rz | +1 | D | roc | prices | A:R K:A (P13) |
| A26 | triennial_survey | TRI1460 | none | 0 | D | stat | social | S:U (years and frequency not stated on the source page per the selection) K:R (selection: not a "good/bad" ranking without income control) |
| G07 | annual_structural | A730 | none | 0 | D | roc | agri | ext |
| G08 | annual_structural | A730 | none | 0 | D | stat | agri | ext |
| G09 | annual_structural | A730 | none | 0 | D | stat | agri | ext |
| G10 | annual_structural | A730 | none | 0 | D | stat | agri | ext; calendar_basis MKTYR |
| G11 | triennial_survey | TRI1460 | none | 0 | D | stat | agri | duplicate of A26 (selection says keep one row): U whether to merge (OQ-10; proposal in `release-lag-and-split-proposal.md` section 4) |
| G12 | triennial_survey | TRI1460 | none | 0 | D | stat | agri | S:R (FAO 3-year averages) |
| G14 | annual_structural | A730 | none | 0 | D | stat | agri | projections (PROJ), opt |
| G15 | annual_structural | A730 | none | 0 | D | stat | agri | opt |

### 5.4 Support inputs (not in the approved selection; user decision 2026-10-18 recorded in design 14a to add them to the config seed; their sources are unresearched)
| ID | Fam | Stale | Alert | Rank | Note |
|---|---|---|---|---|---|
| X01 | support_input | Q270 | none | D | nominal GDP, LCU; `flow_basis` PERIOD_FLOW required (P18) |
| X02 | support_input | A730 | none | D | nominal GDP, USD |
| X03 | support_input | ACT120 | none | D | imports of goods and services, USD, monthly |

### 5.5 Summary counts of the draft (my arithmetic from the tables above)
`monotone_good` 25 (M01, M02, M09, M10, M11, Q01, Q02, Q03, Q08, Q10, Q11, Q12, Q13, Q15, A01, A04, A05, A07, A09, A10, A11, A13, A14, A16, A24; identical to the proposed members listed in analytics spec section 4.1); `target_distance` 1 (A02); `descriptive_only` 54. Alert method `none`: A01, A02b, A02c, A03, A07-A23 except where listed above, A26, G07-G15 (all A and G annual rows except A02, A04, A05, A24, A25) - 28 rows. Re-count on 2026-10-27 (Phase 2 amendment): the tables above mark 26 rows `M+`/`M-`, the 25 listed plus A22 (row `M-`); the listed 25, the analytics list and AC-PAR-5 agree with each other but not with the A22 row (section 9, last bullet; the proposal asks the user which is right). The counts of 25 / 1 / 54 are left as written until the user answers.

## 6. What the research supports and what it does not
Supported (R): staleness class for every row whose data type D14 names (market data, surveys, monthly activity/prices/labour, quarterly, annual, triennial/irregular); the alert level, window and the robust-z list (inflation, spreads, FX, credit growth, food and fertilizer prices); agri-food unranked (D12); A02 from the IMF only (D18, D22).
Not supported, proposed by me (J): every adverse direction; alert `none` for structural annual series (early-warning tier U2 versus long-run tier U3 is the argument, not a research statement); the family of borderline rows.
Not decided anywhere (U): see section 7.

## 7. Parameter decisions for the user (also in the consolidated decision list)
1. Adverse directions (J) for all rows: accept the table or give changes. Particular doubt: M06-M08, G01, A25 (+1 or both tails), M13, M16 (depreciation = +1). For the rows touched by items 5-7 the proposal is in `release-lag-and-split-proposal.md` section 5.
2. Alert scope: `none` for structural annual series (A01, A07-A23, A26, G07-G15) accepted? Or alerts z on all rows as D19 literally reads?
3. Borderline staleness: M15 REER (MKT45 or ACT120), G03, G05, G06, A14, A26, Q02.
4. Rank mode of unclassified rows: Q04, Q09, Q16, A12, M14 (cover ranked?), M27, A19-A21, A07; all proposed `descriptive_only` except A07 (analytics list says `monotone_good`).
5. Rows that define more than one measure (Q11, A10, A13, A16, A22): split into separate indicators or fix one headline measure. NOT DECIDED (plan OQ-10): row-by-row proposal with consequences for ids and counts in `release-lag-and-split-proposal.md` section 3; the single-row treatment stands until the user answers.
6. G11 as a duplicate of A26: merge? NOT DECIDED (OQ-10): proposal in `release-lag-and-split-proposal.md` section 4.
7. `release_lag_aware`: on for a named list, list pending the user (plan OQ-10); global default false. Draft list (J): A12, A13, A14, A22, A26, G12 (long publication lags per the selection: A12 about 2 years). Design 14b records Q31 as answered "switched on" and gives no list. NOT DECIDED: the proposal in `release-lag-and-split-proposal.md` section 2 differs from this draft list (A12 and A20 only; four of the six draft members are in class TRI1460, where the option has no effect); the draft list stands, written `proposed`, until the user answers.
8. CLOSED on 2026-10-27 (user decision stated in session; plan OQ-15): the BIS-gap thresholds of Q06 are z-score only. The earlier open point was the analytics spec 4.1 statement "fixed 2/10 pp alert overrides remain" versus the Q50 answer "z-score only"; the user settled it as z-score only, so Q06 resolves to `alert.method = z`, `alert.adverse = +1`, `stationarity_class = stationary` and no override, and the statement is removed from this spec, the analytics spec section 4.1 and the design (AC-PAR-11).
9. Confirmation status: confirm by family, by domain, or all at once; may the first production run start with `proposed` rows? (Plan BL-12 records that the user confirmed the parameters on 2026-10-27, stated in session; the `review.status` values are written when `config/indicators.yaml` is built.)

## 8. Validation rules (to be added to the config validation, numbering continues from source-config rules 1-21; source-config rules 27-29 were added later, so this spec's rules keep the numbers 22-26)
- Rule 22: every active indicator resolves every field of section 2; the no-default fields must be written in the entry (error otherwise, even if the family has an opinion).
- Rule 23: `family` exists; an entry may override only the defaulted fields of ADR-014 decision 2; unknown keys are errors (the key list is the one in source-config section 3 and 3a).
- Rule 24: `params.review.status` is `proposed` or `confirmed`; `config-report` prints the counts and the list of `proposed` rows; a `confirmed` row requires `by` and `on`.
- Rule 25: an indicator in a domain with `ranked = false` may have `rank.mode = descriptive_only` only (consistency with D12/B3/B9 at seeding).
- Rule 26: `alert.method = none` for kind input, comparison and `weo_projection`; the DDL `input_not_ranked` check still applies.

## 9. Known inconsistencies in the existing specs touched by this table
- RESOLVED in the fix pass (2026-10-25, user decision to follow the analytics spec section 5 and this section): the former source-config statement on `stationarity_class: trending_level` ("requires `transform` in {DIFF12, YOY_PCT_POINT_CHANGE} for alerting, or an `alert_override`", source-config change log, review round 3) disagreed with analytics spec section 5 ("for `trending_level` indicators z is computed on DIFF12"). Reading adopted: analytics applies DIFF12 to the indicator's transformed series for the alert window only, the indicator's `transform` is unchanged, and fixed `alert.override` thresholds still evaluate on the level. Source-config rule 29 now says so; the DDL stores the class without tying it to `transform_id`; analytics section 5 and AC-AN-16 to 18 already read this way.
- RESOLVED in the second fix pass (2026-10-25): source-config section 3 example A05 carried a `euro_area` fixed override (60 and 90 per cent of GDP) while the recorded answer to Q50 is "z-score only for now" (design section 14, Q50: "accepted: z-score only for now; no fixed per-group overrides until the user supplies groups, thresholds and rationales"). The example now has `alert.method: z` and `override: null`; source-config rule 20 states that v1 ships with no override entries and AC-CFG-12 checks it. The analytics AC-AN-23 keeps a euro-area override only as a fixture of the mechanism; it is not a shipped configuration.
- RESOLVED on 2026-10-27 (user decision stated in session; plan OQ-15): the separate Q06 question that the second fix pass left as item 8 of section 7. The BIS-gap thresholds are z-score only; "fixed 2/10 pp alert overrides remain" is removed from the analytics spec section 4.1 and the design; AC-AN-23 stays a fixture of the override mechanism (its euro-area override is not a shipped configuration).
- RESOLVED in round 6: the source-config section 2 WEO example said `reestimating: true` while the recorded answer to Q37 is "named editions (vintage_label only), not a re-estimation family". The example now says `reestimating: false`, `edition_ordered: true` (ADR-017, source-config rule 27); the WEO row that these parameter tables need is therefore `weo_projection` for A03 and the A02 estimate rule of analytics section 2, with no re-estimation behaviour.
- OPEN (found 2026-10-27 while preparing the OQ-10 proposal; not decided here): the A22 row of section 5.3 has rank `M-` (monotone_good, `good_dir = -1`), but the summary count of section 5.5 (25 `monotone_good`) and the proposed members in analytics spec section 4.1 do not include A22, and AC-PAR-5 requires the table and that list to agree. The user decides whether A22 is `monotone_good` (the list and the count become 26) or `descriptive_only` (the row changes to `D`); the proposal in `release-lag-and-split-proposal.md` section 5 proposes `monotone_good`.

## 10. Acceptance criteria
- AC-PAR-1 `config-report` on the real `config/` prints a resolved table equal to the checked-in golden table: 80 indicators plus X01-X03, no null field.
- AC-PAR-2 Removing `rank.mode` from an entry fails `sync-config` even when its family has an opinion on other fields.
- AC-PAR-3 Precedence: a fixture with a global value, a family value and an indicator value resolves to the indicator value; removing the indicator value resolves to the family value; provenance names the layer.
- AC-PAR-4 Every row marked S:R in section 5 has the staleness class that D14 gives for its data type (golden check against the D14 table: M16, M17, M18, M19, M24, G02 = MKT45; M03, M04 = SURV75; Q-rows = Q270; annual rows = A730; A13, A14, A22, G12 = TRI1460).
- AC-PAR-5 The set of `monotone_good` indicators equals the list in analytics spec section 4.1 after the user's confirmation of the table (a change to one requires a change to the other in the same PR).
- AC-PAR-6 A02b, A02c, A03 and all inputs have `alert.method = none` and `rank.mode = descriptive_only`; `A02` is the only `target_distance` indicator until target metadata exists (P13).
- AC-PAR-7 `config-report` shows the count of `proposed` entries; a CI gate fails the production-run workflow if any core indicator is `proposed`, unless the user has recorded in the decision list that this is accepted.
- AC-PAR-8 (round 6) After `sync-config`, `ref.indicator.stationarity_class` and `release_lag_aware` equal the resolved values of the golden table for every indicator, and `params.provenance` names the layer of each (DDL spec T-DDL-27).
- AC-PAR-9 (fix pass) Negatives for rules 22-26, one failing fixture per rule in `tests/unit/config/`, each failing with a message that names the rule: rule 22 an entry that omits a no-default field (for example `alert.adverse`); rule 23 an unknown `family`, and an unknown key in an entry; rule 24 `review.status: maybe`, and `confirmed` without `by` and `on`; rule 25 a `monotone_good` indicator whose only domain has `ranked: false`; rule 26 an input, a comparison-role indicator and a `weo_projection` indicator with `alert.method: z`. This is the AC that covers the negatives of rules 22-26; AC-CFG-1 of the source-config spec covers rules 1-21 and 27-29.
- AC-PAR-10 (second fix pass, Q50) In the golden resolved table no indicator has a non-empty `alert.override`; A05 resolves to `alert.method = z`, `alert.adverse = +1`, `stationarity_class = trending_level` and no override (the check that the shipped config has no override entry is AC-CFG-12 of the source-config spec).
- AC-PAR-11 (Phase 2 amendment, 2026-10-27, Q06 closed) In the golden resolved table Q06 resolves to `alert.method = z`, `alert.adverse = +1`, `stationarity_class = stationary`, `rank.mode = descriptive_only` and an empty `alert.override`; no document or fixture other than the AC-AN-23 override-mechanism fixture contains a fixed pp threshold for Q06 (a repository text search for "2/10 pp" in `docs/specs`, `docs/design` and `config/` finds nothing outside change logs and this criterion).
