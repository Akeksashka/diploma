---
status: approved   # written 2026-11-08 on delegation; the user approved raising CR-5 and CR-6, not an export-spec change. Approved by the user on 2026-11-08 (stated in session: "approved"). The export-spec, analytics-spec and DDL-spec edits it lists in section 6 are still to be made, as a separate step. 2026-11-09: open questions answered by the user ("approved as opus recommended"); sections 4, 5, 6a and 8 restated accordingly — proposed, pending user approval.
inputs:
  - docs/specs/dashboard-redesign-spec.md            # section 5.2, C-IND-5, section 9 (CR-5, CR-6), AC-RD-42, AC-RD-50
  - docs/specs/dashboard-export-spec.md              # sections 1, 3, 4, 5, 6, 10, 11
  - docs/specs/analytics-and-r-contract-spec.md      # section 3 (transform registry)
  - docs/specs/ddl-neon-schema.md                    # ref.unit, ref.series.unit_mult, roles
  - docs/ops/dashboard-redesign-decisions.md         # item 5a (4, 5) and 5b (1)
  - docs/design/adr/ADR-010-interactive-dashboard.md
  - docs/design/adr/ADR-022-restore-clears-migration-seeded-tables-before-copy.md
  - docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md
---
# Proposal: export change requests CR-5 (scale in the unit text) and CR-6 (unit of `transformed_value`)

Date: 2026-11-08, restated 2026-11-09 after the user's answers (section 8). Labels: [REPO] read in this repository (path and line given); [UNVERIFIED] not checked. Template: `docs/_templates/design.md`, headings adapted to a change request. This document edits no spec and no ADR. Section 6a gives the exact edits to the three specs; they are PROPOSED and need the user's approval before they are copied into those specs.

## 1. Goals / non-goals
Goals:
- G1 (CR-5): every value the dashboard shows has a unit text that states the scale (thousand, million, billion) and, for an index, the base period. The text comes from a stored field.
- G2 (CR-6): `transformed_value` (scorecards) and the transformed columns of the series files (`value_default_tf`, `value_yoy`) have a stored unit text. AC-RD-42 can then be met on C-IND-5, on the PG-SERIES "Default" transform and on the PG-COUNTRY history panel.
- G3: the browser still computes nothing (D6, ADR-010 decision 1). It only picks which stored text to show.

Non-goals:
- No rescaling of values. `value` stays "as published, in `unit_code` x 10^`unit_mult`" (export spec section 6).
- No new transform, and no change to how a transform value is computed.
- No change to `unit_label` (it keeps its current meaning: raw unit codes; Q2).
- No change to `copy.js` or to dashboard code in this step.

## 2. Findings (why each CR is needed)

### 2.1 CR-5: `unit_label` does not state the scale today
- The export spec defines `unit_label` only by name (section 4, `meta/indicators.json` row). It gives no meaning [REPO `docs/specs/dashboard-export-spec.md` line 82].
- The code fills it with the sorted distinct `unit_code` values of the indicator's series, joined with ", ". The comment there says: "ref.unit.description is not readable by mm_reader: the unit codes are shown" [REPO `src/macro_monitor/publish/meta.py` lines 277-278]. So today `unit_label`:
  - is a code (for example `PC_ACT`), not a reader-facing text;
  - can be a list (for example `CP_MNAC, LCU`) when the series of one indicator differ;
  - never includes `unit_mult`, so a value published in millions through `UNIT_MULT = 6` is labelled without its scale.
- The scale is carried in two different places:
  - in `ref.series.unit_mult`, set from SDMX `UNIT_MULT` [REPO `src/macro_monitor/ingestion/parsers/sdmxcsv_v1.py` line 170]; the other parsers set 0;
  - inside the unit code itself, for example `CP_MNAC` "Current prices, million units of national currency (Eurostat)" and `MIO_EUR` "Million euro (Eurostat)" [REPO migrations `0015_unit_seed_t62_gdp_levels.sql` lines 6-7, `0013_unit_seed_eurostat_t53.sql` line 9].
  - Nothing prevents both at once (a double scale) [UNVERIFIED: no check found for this in the loader or EXP-03].
- The index base is either in the code (`I21`, `I25`) or in `ref.series.base_period` (`IDX`, "base period in ref.series.base_period") [REPO `0001_ref.sql` line 213, `0013` lines 6-7].
- Answer to CR-5 as stated ("confirm that `unit_label` states the scale"): **no**. A new field is needed (`unit_text`, Q2).

### 2.2 CR-6: `transformed_value` has no unit
- The scorecard row carries `transformed_value` and `transform_id` but no unit [REPO export spec section 5 example, line 97].
- The unit depends on the transform. For some transforms it is fixed: `YOY` gives percent, `SUM12_PCT_GDP` gives percent of GDP, `RESERVE_COVER` gives months. For others it is the unit of the input series: `LEVEL`, `DIFF12` ("in the series' own unit") [REPO `src/macro_monitor/analytics/transforms.py` lines 91-121; analytics spec section 3, line 40].
- The dashboard therefore shows the transform label without a unit. In C-IND-5, AC-RD-42 is met only by exemption. The explorer names the transform in place of a unit (`explorer.js` line 231). The decisions record gates its items 5a.4 and 5a.5 on CR-6 [REPO `docs/ops/dashboard-redesign-decisions.md` lines 261-268].

## 3. Options considered

| Option | What | For | Against | Verdict |
|---|---|---|---|---|
| A | Per scorecard row: stored `transformed_unit_text` resolved in analytics, plus a new DDL column on `analytics.indicator_snapshot` | Exact per entity; copies a stored column (round-6 rule) | Needs a DDL migration and an analytics change; does not cover the series files | Partly adopted (the row field), without the DDL column (Q1) |
| B | Indicator-level map `transform_units` in `meta/indicators.json`, built from the transform registry; the browser picks the text | Small (about 80 indicators); covers the series files | Needs one more "which stored text" choice in the browser | Adopted for the series files |
| C | The browser maps `transform_id` to a unit in `copy.js` | No export change | Copies analytics knowledge into JS, so it can drift; "no field is invented" (redesign spec header) | Rejected |
| D | Resolve a unit per series in `meta/series.json` (`default_tf_unit_text`) | No choice left to the browser | About 3,500 rows x about 40 bytes, close to the 1 MB meta budget (export spec section 4) | Rejected for now |

Decision (user, 2026-11-09, Q1): **B + the row field of A**, filled at export time from the shared transform registry (section 4). No `analytics.indicator_snapshot` column, no ADR. The export already runs the shared transform code (export spec section 6, `value_default_tf`); it only puts metadata together and computes no value.

## 4. Data model: proposed fields (exact names and meaning)

### 4.1 Source of truth (outside the export)
- `ref.unit` gets three new columns (DDL spec, one forward-only migration, section 6a.3):
  - `label text NOT NULL`: short reader-facing text, for example "%", "% of GDP", "EUR", "national currency", "index", "months", "percentage points";
  - `embedded_mult smallint NOT NULL DEFAULT 0`: the power of ten the code itself implies (6 for `CP_MNAC`, `MIO_EUR`);
  - `embedded_base boolean NOT NULL DEFAULT false`: true when the code fixes the index base (`I21`, `I25`).
  - A new view `ref.v_unit_public(unit_code, dimension, label, embedded_mult, embedded_base)` is granted to `mm_reader` and added to export principle 2. `description` stays internal.
- New `ref.unit` code `PP` (label "percentage points", dimension `ratio`), needed by `YOY_PCT_POINT_CHANGE` and `SPREAD_VS_REF` [UNVERIFIED whether a code with this meaning is already seeded; the migration seeds it with `ON CONFLICT DO NOTHING` semantics checked first, section 6a.3].
- `PURE_NUMB` (in `config/series_map/ecb_yields.yaml`): first confirm that it loads (that is, that it is a valid `ref.unit` code today); if it is not seeded, seed it in the same migration, with label "%" if the ECB yields are in percent [UNVERIFIED] (Q6).
- The transform registry (analytics spec section 3; `TransformSpec` in `analytics/transforms.py`) gets `result_unit`. It is either a `ref.unit` code or the token `INPUT` (same unit, scale and base as the input series). Values (user, 2026-11-09, Q3; `DEV_FROM_AVG` dropped, Q4):

| Transform | `result_unit` | label |
|---|---|---|
| `LEVEL`, `DIFF12` | `INPUT` | the series' `unit_text` |
| `YOY`, `GLOBAL_LCU_YOY`, `REAL_RATE` | `PCT` | "%" |
| `M3M3_ANN`, `QOQ_ANN` | `PCT` or a new code, OPEN (OQ-A) | "% annualised" |
| `YOY_PCT_POINT_CHANGE`, `SPREAD_VS_REF` | `PP` | "percentage points" |
| `SUM12_PCT_GDP` | `PCT_GDP` | "% of GDP" |
| `RESERVE_COVER` | `MONTHS` | "months" |

- OQ-A (open design question for the user, not decided here): the user wants the annualised transforms labelled "% annualised". Either (a) a new `ref.unit` code (for example `PCT_ANN`, label "% annualised", dimension `ratio`) seeded in the same migration, so the label stays a pure lookup of `result_unit`; or (b) `result_unit = PCT` plus a per-transform `result_label` override in `TransformSpec`, so `ref.unit` keeps one percent code. (a) keeps the rule "the label comes from `ref.unit`" with no exception; (b) avoids a unit code that differs from `PCT` only in wording. Sections 4.4, 5 and 6a are written so that either answer fits: they refer to "the label of the transform's result unit".

### 4.2 Unit text rule (one pure Python function in `publish/`, pinned by golden tests)
`unit_text(label, dimension, embedded_mult, embedded_base, unit_mult, base_period) -> str`:
1. Start with `label`.
2. If `unit_mult` is not 0, add " (<scale>)". Scale words: 3 "thousands", 6 "millions", 9 "billions", 12 "trillions"; any other value "x 10^<unit_mult>". Example: "EUR (millions)".
3. If `dimension = 'index'`, `embedded_base` is false and `base_period` is not null, add ", <base_period> = 100". Example: "index, 2015 = 100".
4. A series with `embedded_mult != 0` and `unit_mult != 0` is a double scale. It is an EXP-03 failure, not a text case.
The strings (the `ref.unit.label` seeds, scale words, the "(millions)" form, "% annualised") are DRAFT (ADR-025 decision 11) and are batched into the R26 wording pass (Q5).

### 4.3 CR-5 export fields
| File | Field | Type | Meaning / invariant |
|---|---|---|---|
| `meta/series.json` | `unit_text` (new) | string, not null | `unit_text(...)` of the series (section 4.2). The unit of `value` in `series/*` and `revisions/*`, scale and base included |
| `meta/series.json` | `unit_scale` (new) | int, not null | The power of ten of `value` relative to `label`: `embedded_mult + unit_mult`, where at least one of the two is 0. Machine-readable; the dashboard does not rescale |
| `meta/indicators.json` | `unit_label` (UNCHANGED) | string | Meaning unchanged: the sorted distinct `unit_code` values of the indicator's series, joined with ", ". Not reader-facing; the dashboard uses `unit_text` |
| `meta/indicators.json` | `unit_text` (new) | string or null | The common `meta/series.json.unit_text` of the indicator's exported series when all are equal; `null` when they differ or when the indicator has no exported series |
| `meta/indicators.json` | `unit_text_varies` (new) | bool, not null | true exactly when the exported series have more than one distinct `unit_text`. When true, indicator-level views take the unit per row from `meta/series.json.unit_text` (by the row's `series_id`) |

### 4.4 CR-6 export fields
| File | Field | Type | Meaning / invariant |
|---|---|---|---|
| `meta/indicators.json` | `transform_units` (new) | object, not null | One key per transform id in `transform_options[]`, in `default_transform` and in the scorecard `transform_id` of the indicator. Each value is `{"unit_code": string or null, "unit_text": string or null, "same_as_series": bool}`. `same_as_series = true` exactly when `result_unit = INPUT`; then `unit_code` and `unit_text` are null and the unit is the series' `unit_text`. Otherwise both are non-null: `unit_text = unit_text(label of the result unit, ..., unit_mult = 0, base_period = null)` |
| `scorecard/<domain_id>.json`, entity indicator row | `transformed_unit_text` (new) | string or null | null exactly when `transformed_value` is null (this includes withheld placeholders). Otherwise it is `transform_units[transform_id].unit_text`, or, when `same_as_series`, the `meta/series.json.unit_text` of the row's `series_id` |
| `series/<indicator_id>.parquet` | (no new column) | | Section 6 states that the unit of `value_default_tf` is `transform_units[default_transform]` of the indicator, and that `value_yoy` is in `PCT` ("%", `same_as_series = false`). The `YOY` key is always present in `transform_units` when `value_yoy` has any value |

Illustrative (not normative) `meta/indicators.json` fragment (label strings DRAFT; `M3M3_ANN` depends on OQ-A):
```json
{ "indicator_id": "P01", "unit_label": "IDX", "unit_text": "index, 2015 = 100", "unit_text_varies": false,
  "default_transform": "M3M3_ANN", "transform_options": ["LEVEL", "M3M3_ANN", "YOY"],
  "transform_units": { "LEVEL": {"unit_code": null, "unit_text": null, "same_as_series": true},
                       "M3M3_ANN": {"unit_code": "PCT", "unit_text": "% annualised", "same_as_series": false},
                       "YOY": {"unit_code": "PCT", "unit_text": "%", "same_as_series": false} } }
```

### 4.5 Versioning and size
- All new keys are additive and `unit_label` keeps its meaning, so the change is a minor bump: `schema_version` "1.0" to "1.1" (export spec section 3: adding fields is a minor bump; the front-end refuses only an unknown major). The JSON Schemas (`additionalProperties: false`, `schema_version` const "1.0") are updated with the change. No ADR (Q2).
- Size estimate (analyst estimate, unmeasured):
  - `meta/series.json`: about 3,500 series x about 40 bytes, about +140 KB. This approaches the "below 1 MB" estimate of export spec section 4.
  - `meta/indicators.json`: about +15 KB.
  - Scorecards: about +30 bytes per row.
- Open check (Q7): measure `meta/*` size on the R24 export before the export-schema change is finalised.

## 5. Validation and acceptance (proposed export-spec additions)
- EXP-03 extension:
  - every exported series has a non-null `unit_text`;
  - no series has `embedded_mult != 0` and `unit_mult != 0`;
  - `unit_scale = embedded_mult + unit_mult`.
- EXP-05 extension:
  - every scorecard row has `transformed_unit_text` null exactly when `transformed_value` is null;
  - its text equals the rule of section 4.4;
  - every `transform_id` and `default_transform` is a key of `transform_units`.
- AC-EXP-16 (CR-5), fixture:
  - a series with `unit_code = EUR` and `unit_mult = 6` exports `unit_text = "EUR (millions)"` and `unit_scale = 6`;
  - a `MIO_EUR` series exports a text with "millions" exactly once and `unit_scale = 6`;
  - an `IDX` series with `base_period = 2015` exports "index, 2015 = 100";
  - an `I21` series has no appended base;
  - an indicator with LCU series of two countries and EUR series of others has `unit_text = null` and `unit_text_varies = true`;
  - `unit_label` of every indicator equals its value under schema 1.0 (regression);
  - a fixture series with `MIO_EUR` and `unit_mult = 3` fails EXP-03 (negative control).
- AC-EXP-17 (CR-6), fixture:
  - a `YOY` indicator row has `transformed_unit_text = "%"`;
  - a `SUM12_PCT_GDP` row (M13) has "% of GDP";
  - a `RESERVE_COVER` row has "months";
  - a `SPREAD_VS_REF` row has "percentage points";
  - a `LEVEL` row equals its series `unit_text`;
  - a withheld placeholder has null;
  - `transform_units` covers `transform_options[]` and `default_transform` of every indicator;
  - a static check confirms that the export reads `result_unit` from the shared registry and holds no unit table of its own.

## 6. Impact on the dashboard redesign spec (to be applied after approval; not applied here)
- Section 5.2:
  - The series-level unit text "values in <unit_code> x 10^<unit_mult>" is replaced by `meta/series.json.unit_text`.
  - Indicator-level views use `meta/indicators.json.unit_text`, or the per-row series `unit_text` when `unit_text_varies` is true.
  - The bullet "`transformed_value` is shown only with its transform label ... CR-5" is replaced by: "`transformed_value` carries `transformed_unit_text`; the PG-SERIES Default and YoY columns carry the unit from `transform_units` (the series `unit_text` when `same_as_series`)".
- C-IND-5: "unit pending CR-6" becomes "unit from `transformed_unit_text`".
- Section 9: CR-5 and CR-6 are marked "approved, export spec section ..." once approved.
- AC-RD-42 (impact): today it cannot be met on three surfaces: the C-IND-5 transformed column, the PG-SERIES Default transform and any `unit_mult != 0` value shown by the indicator-level unit. After CR-5 and CR-6 it can be met without exemptions. Proposed revised wording: "No numeric value is rendered without a unit text in the cell, header, axis, label or tip, taken from `unit_text`, `transformed_unit_text` or `transform_units` as in section 5.2. A value whose `unit_scale` is not 0 shows the scale in its unit text. Percentiles carry the percentile label. The DOM check includes the transformed-value column and every transform of PG-SERIES." Plus a unit-test fixture with `unit_mult = 6` and with `M3M3_ANN`.
- AC-RD-50: "the single added lookup is the presence check of AC-RD-41" becomes "the added lookups are the presence check of AC-RD-41 and the unit text selection of section 5.2 (`transform_units`, `series_id` to `unit_text`); neither computes".
- Decisions record items 5a.4 (default transform on PG-SERIES) and 5a.5 (history in the scorecard transform) are unblocked. Each still needs its own spec change.
- AC-RD-56 holds: the export changes only after this CR is approved.

## 6a. Exact edits to the three specs (PROPOSED, 2026-11-09, pending user approval)
Not yet copied into the target specs. Each target spec, when edited, gets the change-log line: "## Change log (CR-5/CR-6, 2026-11-09) — proposed — pending user approval", followed by the hunks below. No `status:` is changed by these edits. Order: CR-6 first, then CR-5.

### 6a.1 `docs/specs/analytics-and-r-contract-spec.md`, section 3 (line 39 onwards)
- CR-6: add to the registry contract: "Every `TransformSpec` has `result_unit`: a `ref.unit` code or the token `INPUT` (the result has the unit, scale and base of the input series). The values are the table of CR-5/CR-6 proposal section 4.1. The export reads `result_unit` from this registry and keeps no unit table of its own."
- CR-6: add a test to section 6: "every registered transform has a `result_unit`; every non-`INPUT` value is a seeded `ref.unit` code (checked against the migration seeds)".
- Q4: remove `DEV_FROM_AVG` from section 3 (not in the code registry, `transforms.py` lines 235-252).
- OQ-A: until the user decides, `M3M3_ANN` and `QOQ_ANN` read "`PCT` (label pending OQ-A)".

### 6a.2 `docs/specs/dashboard-export-spec.md`
- CR-6, section 4, `meta/indicators.json` row (line 82): add `transform_units` (definition of proposal section 4.4).
- CR-6, section 5 (scorecard row, example at line 97): add `transformed_unit_text` (section 4.4).
- CR-6, section 6 (series files, after the `value_default_tf` row, line 137): add the no-new-column note of section 4.4.
- CR-5, principle 2 (line 31): add `ref.v_unit_public` to the list of objects `mm_reader` reads.
- CR-5, section 4: `meta/series.json` row (line 83): add `unit_text`, `unit_scale`; `meta/indicators.json` row: add `unit_text`, `unit_text_varies`, and give `unit_label` its current meaning in words (sorted distinct `unit_code` values joined with ", "; unchanged). Line 86 (provenance): `unit_text` and `unit_scale` come from `ref.v_series_export` joined to `ref.v_unit_public`, built by the `unit_text` rule (section 4.2).
- Section 3 (line 74): "Schema 1.1 adds `unit_text`, `unit_scale`, `unit_text_varies`, `transform_units`, `transformed_unit_text` (minor bump)." Examples at lines 64 and 171 become "1.1".
- Section 8: note the `meta/*` size open check (Q7).
- Section 10: EXP-03 and EXP-05 extensions of proposal section 5.
- Section 11: AC-EXP-16, AC-EXP-17 of proposal section 5.

### 6a.3 `docs/specs/ddl-neon-schema.md`
- CR-6, section 2: seed `PP` (dimension `ratio`, description "percentage points"); if OQ-A answer (a), also `PCT_ANN`.
- CR-5, section 2, `CREATE TABLE ref.unit` (lines 107-111): add `label text NOT NULL`, `embedded_mult smallint NOT NULL DEFAULT 0`, `embedded_base boolean NOT NULL DEFAULT false`, and a check `embedded_mult BETWEEN -3 AND 15` [bounds proposed].
- CR-5, section 2: new view `ref.v_unit_public AS SELECT unit_code, dimension, label, embedded_mult, embedded_base FROM ref.unit`.
- CR-5, section 8 (roles): `GRANT SELECT ON ref.v_unit_public TO mm_reader`; no grant on `ref.unit` itself.
- Section 10: tests: every `ref.unit` row has a non-empty `label`; `mm_reader` can read `ref.v_unit_public` and not `ref.unit.description`.
- One forward-only migration (described, not written; next free number):
  1. `ALTER TABLE ref.unit ADD COLUMN label text` (nullable first), add `embedded_mult`, `embedded_base` with their defaults.
  2. Backfill `label`, `embedded_mult`, `embedded_base` for every seeded code by `UPDATE ... WHERE unit_code = ...`. This is a reference table, not a curated, raw-manifest or history table, so the "never UPDATE" rule does not apply; state that in the migration header [to be confirmed by the user].
  3. Fail the migration if any row still has a null `label`; then `ALTER COLUMN label SET NOT NULL` (no permanent default, so a new code cannot be seeded without a label).
  4. Seed `PP` (and `PURE_NUMB` if it is not seeded, Q6; `PCT_ANN` if OQ-A (a)) with all columns.
  5. Create `ref.v_unit_public` and its grant.
- ADR-022 interaction: `ref.unit` is migration-seeded and is cleared with plain `DELETE` in restore step 3 before `\copy` [REPO ADR-022 lines 11-16]. After this migration, a dump made before it has no `label` column: a restore of an older dump into a migrated schema would fail the `NOT NULL`. The public-dump spec's `\copy` column list for `ref.unit` must include the three new columns, and restore of a pre-migration dump needs either the migration's backfill re-run or a restore into the matching schema version. To be stated in the DDL change-log and checked against `docs/specs/public-dump-spec.md` section 6 [not read for this proposal].
- Migrations apply to `neondb` only on the user's explicit ask; never to `postgres`.

## 7. Is an ADR required?
**No** (user, 2026-11-09).
- The change adds metadata fields within the existing architecture: Python assembles, the export writes, the browser selects (ADR-010 decision 1, D6).
- No approved ADR decision is changed, and no component is added. The ADR-022 restore procedure is unchanged in kind; its column list grows (section 6a.3).
- It does require approved edits to three specs (section 6a). Implementation is one forward-only migration.
- An ADR would be needed only for per-row units stored in `analytics.indicator_snapshot` or a major `schema_version` bump; both were declined.

Plan scope note: implementing this (task R28) writes to `src/`, migrations and the export JSON Schemas. Section 1 of `docs/plans/dashboard-redesign-implementation-plan.md` does not allow those paths, so the plan scope needs the user's approval before R28 starts.

## 8. Open questions for the user (answered 2026-11-09, "approved as opus recommended")
- Q1: ANSWERED. The export fills `transformed_unit_text` and `transform_units` at export time from the shared transform registry. No stored snapshot column, no ADR.
- Q2: ANSWERED. New field `unit_text` (human text including the scale); `unit_label` keeps its meaning (raw codes). Minor bump (1.1) for the new fields only.
- Q3: ANSWERED. `REAL_RATE` in "%"; `SPREAD_VS_REF` in "percentage points" (code `PP`); annualised transforms "% annualised". Still open as OQ-A: new `ref.unit` code or a label on `PCT` (section 4.1).
- Q4: ANSWERED. Drop `DEV_FROM_AVG` from the analytics spec.
- Q5: ANSWERED. Label strings are DRAFT and batched into the R26 wording pass.
- Q6: ANSWERED. Confirm that `PURE_NUMB` loads; if not seeded, seed it in the same migration; label "%" if the yields are in percent [UNVERIFIED].
- Q7: OPEN CHECK. Measure `meta/*` size on the R24 export before the export-schema change is finalised.
- OQ-A: OPEN (section 4.1).
- OQ-B: OPEN. Confirm that backfilling `ref.unit` with `UPDATE` in the migration is acceptable (section 6a.3 step 2).

## Change log (2026-11-09) — proposed — pending user approval
- User answers Q1-Q7 recorded (section 8). Q2 overrides the earlier sections 4.3/4.4: `unit_label` is no longer redefined; the new fields are `unit_text`, `unit_text_varies`, `transform_units.unit_text`, `transformed_unit_text`.
- Section 4.1: `DEV_FROM_AVG` dropped; `REAL_RATE` PCT; OQ-A opened for "% annualised"; `PURE_NUMB` handling.
- Section 6a added with the exact edits to the three specs; not yet applied to those files. Section 7: plan scope note for R28.
