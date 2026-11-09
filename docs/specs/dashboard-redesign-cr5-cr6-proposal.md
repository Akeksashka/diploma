---
status: approved   # written 2026-11-08 on delegation; the user approved raising CR-5 and CR-6, not an export-spec change. Approved by the user on 2026-11-08 (stated in session: "approved"). The export-spec, analytics-spec and DDL-spec edits it lists in section 6 are still to be made, as a separate step.
inputs:
  - docs/specs/dashboard-redesign-spec.md            # section 5.2, C-IND-5, section 9 (CR-5, CR-6), AC-RD-42, AC-RD-50
  - docs/specs/dashboard-export-spec.md              # sections 1, 3, 4, 5, 6, 10, 11
  - docs/specs/analytics-and-r-contract-spec.md      # section 3 (transform registry)
  - docs/specs/ddl-neon-schema.md                    # ref.unit, ref.series.unit_mult, roles
  - docs/ops/dashboard-redesign-decisions.md         # item 5a (4, 5) and 5b (1)
  - docs/design/adr/ADR-010-interactive-dashboard.md
  - docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md
---
# Proposal: export change requests CR-5 (scale in `unit_label`) and CR-6 (unit of `transformed_value`)

Date: 2026-11-08. Labels: [REPO] read in this repository on 2026-11-08 (path and line given); [UNVERIFIED] not checked. Template: `docs/_templates/design.md`, headings adapted to a change request. This document edits no spec and no ADR. Section 6 lists the exact edits that would follow approval.

## 1. Goals / non-goals
Goals:
- G1 (CR-5): every value the dashboard shows has a unit text that states the scale (thousand, million, billion) and, for an index, the base period. The text comes from a stored field.
- G2 (CR-6): `transformed_value` (scorecards) and the transformed columns of the series files (`value_default_tf`, `value_yoy`) have a stored unit text. AC-RD-42 can then be met on C-IND-5, on the PG-SERIES "Default" transform and on the PG-COUNTRY history panel.
- G3: the browser still computes nothing (D6, ADR-010 decision 1). It only picks which stored text to show.

Non-goals:
- No rescaling of values. `value` stays "as published, in `unit_code` x 10^`unit_mult`" (export spec section 6).
- No new transform, and no change to how a transform value is computed.
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
- Answer to CR-5 as stated ("confirm that `unit_label` states the scale"): **no**. A field change is needed.

### 2.2 CR-6: `transformed_value` has no unit
- The scorecard row carries `transformed_value` and `transform_id` but no unit [REPO export spec section 5 example, line 97].
- The unit depends on the transform. For some transforms it is fixed: `YOY` gives percent, `SUM12_PCT_GDP` gives percent of GDP, `RESERVE_COVER` gives months. For others it is the unit of the input series: `LEVEL`, `DIFF12` ("in the series' own unit") [REPO `src/macro_monitor/analytics/transforms.py` lines 91-121; analytics spec section 3, line 40].
- The dashboard therefore shows the transform label without a unit. In C-IND-5, AC-RD-42 is met only by exemption. The explorer names the transform in place of a unit (`explorer.js` line 231). The decisions record gates its items 5a.4 and 5a.5 on CR-6 [REPO `docs/ops/dashboard-redesign-decisions.md` lines 261-268].

## 3. Options considered

| Option | What | For | Against | Verdict |
|---|---|---|---|---|
| A | Per scorecard row: stored `transformed_unit_label` resolved in analytics, plus a new DDL column on `analytics.indicator_snapshot` | Exact per entity; copies a stored column (round-6 rule) | Needs a DDL migration and an analytics change; does not cover the series files | Partly adopted (the row field), without the DDL column |
| B | Indicator-level map `transform_units` in `meta/indicators.json`, built from the transform registry; the browser picks the text | Small (about 80 indicators); covers the series files | Needs one more "which stored text" choice in the browser | Adopted for the series files |
| C | The browser maps `transform_id` to a unit in `copy.js` | No export change | Copies analytics knowledge into JS, so it can drift; "no field is invented" (redesign spec header) | Rejected |
| D | Resolve a unit per series in `meta/series.json` (`default_tf_unit_label`) | No choice left to the browser | About 3,500 rows x about 40 bytes, close to the 1 MB meta budget (export spec section 4) | Rejected for now |

Recommendation: add **B + the row field of A**, filled at export time from the shared registry (Section 4). No `analytics.indicator_snapshot` column is needed, because the export already runs the shared transform code (export spec section 6, `value_default_tf`). The export only puts metadata together; it computes no value. Whether that counts as "computing meaning" under export principle 3 is open question Q1.

## 4. Data model: proposed fields (exact names and meaning)

### 4.1 Source of truth (outside the export)
- `ref.unit` gets three new columns (DDL spec, forward-only migration):
  - `label text NOT NULL`: short reader-facing text, for example "%", "% of GDP", "EUR", "national currency", "index", "months", "percentage points";
  - `embedded_mult smallint NOT NULL DEFAULT 0`: the power of ten the code itself implies (6 for `CP_MNAC`, `MIO_EUR`);
  - `embedded_base boolean NOT NULL DEFAULT false`: true when the code fixes the index base (`I21`, `I25`).
  - A new view `ref.v_unit_public(unit_code, dimension, label, embedded_mult, embedded_base)` is granted to `mm_reader` and added to export principle 2. `description` stays internal.
- New `ref.unit` code `PP` ("percentage points", dimension `ratio`), needed by `YOY_PCT_POINT_CHANGE` and `SPREAD_VS_REF` [UNVERIFIED whether a code with this meaning is already seeded; `PURE_NUMB` appears in `config/series_map/ecb_yields.yaml`, but no seed for it was found in the migrations read].
- The transform registry (analytics spec section 3; `TransformSpec` in `analytics/transforms.py`) gets `result_unit`. It is either a `ref.unit` code or the token `INPUT` (same unit, scale and base as the input series). Proposed values, for the user to confirm (Q3):

| Transform | `result_unit` |
|---|---|
| `LEVEL`, `DIFF12`, `DEV_FROM_AVG` | `INPUT` |
| `YOY`, `M3M3_ANN`, `QOQ_ANN`, `GLOBAL_LCU_YOY`, `REAL_RATE` | `PCT` |
| `YOY_PCT_POINT_CHANGE`, `SPREAD_VS_REF` | `PP` |
| `SUM12_PCT_GDP` | `PCT_GDP` |
| `RESERVE_COVER` | `MONTHS` |

(`DEV_FROM_AVG` is named in the analytics spec but is not in the code registry [REPO `transforms.py` lines 235-252]; Q4.)

### 4.2 Unit text rule (one pure Python function in `publish/`, pinned by golden tests)
`unit_text(label, dimension, embedded_mult, embedded_base, unit_mult, base_period) -> str`:
1. Start with `label`.
2. If `unit_mult` is not 0, add " (<scale>)". Scale words: 3 "thousands", 6 "millions", 9 "billions", 12 "trillions"; any other value "x 10^<unit_mult>". Example: "EUR (millions)".
3. If `dimension = 'index'`, `embedded_base` is false and `base_period` is not null, add ", <base_period> = 100". Example: "index, 2015 = 100".
4. A series with `embedded_mult != 0` and `unit_mult != 0` is a double scale. It is an EXP-03 failure, not a text case.
The strings are DRAFT (ADR-025 decision 11) and need the user's confirmation (Q5).

### 4.3 CR-5 export fields
| File | Field | Type | Meaning / invariant |
|---|---|---|---|
| `meta/series.json` | `unit_label` (new) | string, not null | `unit_text(...)` of the series (Section 4.2). The unit of `value` in `series/*` and `revisions/*`, scale and base included |
| `meta/series.json` | `unit_scale` (new) | int, not null | The power of ten of `value` relative to `label`: `embedded_mult + unit_mult`, where at least one of the two is 0. Machine-readable; the dashboard does not rescale |
| `meta/indicators.json` | `unit_label` (REDEFINED) | string or null | The common `meta/series.json.unit_label` of the indicator's exported series when all are equal; `null` when they differ or when the indicator has no exported series. No longer a list of codes |
| `meta/indicators.json` | `unit_label_varies` (new) | bool, not null | true exactly when the exported series have more than one distinct `unit_label`. When true, indicator-level views take the unit per row from `meta/series.json.unit_label` (by the row's `series_id`) |

### 4.4 CR-6 export fields
| File | Field | Type | Meaning / invariant |
|---|---|---|---|
| `meta/indicators.json` | `transform_units` (new) | object, not null | One key per transform id in `transform_options[]`, in `default_transform` and in the scorecard `transform_id` of the indicator. Each value is `{"unit_code": string or null, "unit_label": string or null, "same_as_series": bool}`. `same_as_series = true` exactly when `result_unit = INPUT`; then `unit_code` and `unit_label` are null and the unit is the series' `unit_label`. Otherwise both are non-null: `unit_label = unit_text(label of result_unit, ..., unit_mult = 0, base_period = null)` |
| `scorecard/<domain_id>.json`, entity indicator row | `transformed_unit_label` (new) | string or null | null exactly when `transformed_value` is null (this includes withheld placeholders). Otherwise it is `transform_units[transform_id].unit_label`, or, when `same_as_series`, the `meta/series.json.unit_label` of the row's `series_id` |
| `series/<indicator_id>.parquet` | (no new column) | | Section 6 states that the unit of `value_default_tf` is `transform_units[default_transform]` of the indicator, and that `value_yoy` is in `PCT` ("%", `same_as_series = false`). The `YOY` key is always present in `transform_units` when `value_yoy` has any value |

Illustrative (not normative) `meta/indicators.json` fragment:
```json
{ "indicator_id": "P01", "unit_label": "index, 2015 = 100", "unit_label_varies": false,
  "default_transform": "M3M3_ANN", "transform_options": ["LEVEL", "M3M3_ANN", "YOY"],
  "transform_units": { "LEVEL": {"unit_code": null, "unit_label": null, "same_as_series": true},
                       "M3M3_ANN": {"unit_code": "PCT", "unit_label": "%", "same_as_series": false},
                       "YOY": {"unit_code": "PCT", "unit_label": "%", "same_as_series": false} } }
```

### 4.5 Versioning and size
- The new keys are additive. `unit_label` changes meaning (from codes to text) but keeps its type. Proposed: a minor bump `schema_version` "1.0" to "1.1" (export spec section 3: adding fields is a minor bump; the front-end refuses only an unknown major). The JSON Schemas (`additionalProperties: false`, `schema_version` const "1.0") are updated with the change. Whether the redefinition should be a major bump is Q2.
- Size estimate (analyst estimate, unmeasured):
  - `meta/series.json`: about 3,500 series x about 40 bytes, about +140 KB. This approaches the "below 1 MB" estimate of export spec section 4; to be measured.
  - `meta/indicators.json`: about +15 KB.
  - Scorecards: about +30 bytes per row.

## 5. Validation and acceptance (proposed export-spec additions)
- EXP-03 extension:
  - every exported series has a non-null `unit_label`;
  - no series has `embedded_mult != 0` and `unit_mult != 0`;
  - `unit_scale = embedded_mult + unit_mult`.
- EXP-05 extension:
  - every scorecard row has `transformed_unit_label` null exactly when `transformed_value` is null;
  - its text equals the rule of Section 4.4;
  - every `transform_id` and `default_transform` is a key of `transform_units`.
- AC-EXP-16 (CR-5), fixture:
  - a series with `unit_code = EUR` and `unit_mult = 6` exports `unit_label = "EUR (millions)"` and `unit_scale = 6`;
  - a `MIO_EUR` series exports a label with "millions" exactly once and `unit_scale = 6`;
  - an `IDX` series with `base_period = 2015` exports "index, 2015 = 100";
  - an `I21` series has no appended base;
  - an indicator with LCU series of two countries and EUR series of others has `unit_label = null` and `unit_label_varies = true`;
  - a fixture series with `MIO_EUR` and `unit_mult = 3` fails EXP-03 (negative control).
- AC-EXP-17 (CR-6), fixture:
  - a `YOY` indicator row has `transformed_unit_label = "%"`;
  - a `SUM12_PCT_GDP` row (M13) has "% of GDP";
  - a `RESERVE_COVER` row has "months";
  - a `LEVEL` row equals its series `unit_label`;
  - a withheld placeholder has null;
  - `transform_units` covers `transform_options[]` and `default_transform` of every indicator;
  - a static check confirms that the export reads `result_unit` from the shared registry and holds no unit table of its own.

## 6. Impact on the dashboard redesign spec (to be applied after approval; not applied here)
- Section 5.2:
  - The series-level unit text "values in <unit_code> x 10^<unit_mult>" is replaced by `meta/series.json.unit_label`.
  - Indicator-level views use `meta/indicators.json.unit_label`, or the per-row series `unit_label` when `unit_label_varies` is true.
  - The bullet "`transformed_value` is shown only with its transform label ... CR-5" is replaced by: "`transformed_value` carries `transformed_unit_label`; the PG-SERIES Default and YoY columns carry the unit from `transform_units` (the series `unit_label` when `same_as_series`)".
- C-IND-5: "unit pending CR-6" becomes "unit from `transformed_unit_label`".
- Section 9: CR-5 and CR-6 are marked "approved, export spec section ..." once approved.
- AC-RD-42 (impact): today it cannot be met on three surfaces: the C-IND-5 transformed column, the PG-SERIES Default transform and any `unit_mult != 0` value shown by indicator-level `unit_label`. After CR-5 and CR-6 it can be met without exemptions. Proposed revised wording: "No numeric value is rendered without a unit text in the cell, header, axis, label or tip, taken from `unit_label`, `transformed_unit_label` or `transform_units` as in section 5.2. A value whose `unit_scale` is not 0 shows the scale in its unit text. Percentiles carry the percentile label. The DOM check includes the transformed-value column and every transform of PG-SERIES." Plus a unit-test fixture with `unit_mult = 6` and with `M3M3_ANN`.
- AC-RD-50: "the single added lookup is the presence check of AC-RD-41" becomes "the added lookups are the presence check of AC-RD-41 and the unit text selection of section 5.2 (`transform_units`, `series_id` to `unit_label`); neither computes".
- Decisions record items 5a.4 (default transform on PG-SERIES) and 5a.5 (history in the scorecard transform) are unblocked. Each still needs its own spec change.
- AC-RD-56 holds: the export changes only after this CR is approved.

## 7. Is an ADR required?
**Recommendation: no.**
- The change adds metadata fields within the existing architecture: Python assembles, the export writes, the browser selects (ADR-010 decision 1, D6).
- No approved ADR decision is changed, and no component is added.
- It does require approved edits to three specs:
  - export spec: principle 2 (new readable view), sections 3-6, 10 and 11;
  - analytics spec section 3 (`result_unit` per transform);
  - DDL spec (`ref.unit` columns, `ref.v_unit_public`, the `mm_reader` grant, `PP` seed).
- Implementation is one forward-only migration.

An ADR would be needed only if the user chooses either of these:
- per-row units stored in `analytics.indicator_snapshot` (an analytics output contract change); or
- a major `schema_version` bump (front-end compatibility policy).

## 8. Open questions for the user
- Q1: Is filling `transformed_unit_label` and `transform_units` at export time acceptable under export principle 3 ("the export neither computes nor filters meaning")? The alternative is a stored column in `analytics.indicator_snapshot` (option A in full, with a DDL column).
- Q2: Redefining `unit_label` from codes to text: is a minor bump (1.1) acceptable, or should a new field name be used (for example `unit_text`) and `unit_label` be left unchanged?
- Q3: The `result_unit` table of Section 4.1. In particular: is `REAL_RATE` in percent or in percentage points? Is `SPREAD_VS_REF` in percentage points or in basis points? Should the annualised transforms have a distinct label ("% annualised")?
- Q4: `DEV_FROM_AVG` is in the analytics spec but not in the code registry: drop it from the spec, or register it with `INPUT`?
- Q5: The DRAFT label strings (`ref.unit.label` seeds, scale words, the "(millions)" form) need the user's confirmation.
- Q6: Is `PURE_NUMB` (ECB yields) seeded in `ref.unit`, and what label should it get? [UNVERIFIED]
- Q7: The 1 MB `meta/*` estimate: measure `meta/series.json` with the new fields on the real export before approval, or accept the rejected option D later if needed?
