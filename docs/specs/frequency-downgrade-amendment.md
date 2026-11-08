---
status: approved   # approved by the user on 2026-11-04 (stated in session: "approve all"); amendments are merged into the base specs by a later Phase 2 step
user_decisions_recorded: 2026-11-04   # answers to questions 1, 2 (surface decided, wording drafted for confirmation), 4 given in session 2026-11-04; questions 3 and 5 still open
amends:
  - docs/specs/source-config-schema.md    # section 4 (series_map entry), rules 41-43, AC-CFG-18, AC-CFG-5 wording
  - docs/specs/dashboard-export-spec.md   # section 4 (meta/series.json), section 6 (series files), EXP checks, AC-EXP-17
  - docs/specs/ddl-neon-schema.md         # section 2 (ref.series_map, ref.v_series_export), section 5 (curated views), T-DDL-32
  - docs/specs/analytics-and-r-contract-spec.md   # section 9 P17 (wording only)
inputs:
  - ADR-021
  - ADR-009
  - ADR-010
  - docs/specs/source-config-schema.md
  - docs/specs/dashboard-export-spec.md
  - docs/specs/ddl-neon-schema.md
  - docs/specs/analytics-and-r-contract-spec.md
---
# Amendment: `frequency_downgrade` as an explicit, mandatory fallback field, with a dashboard label

Date: 2026-11-04 (revised the same day after the user's answers). Repository facts were read on 2026-11-04 (file paths are the citations); PostgreSQL behaviour is cited with URL and access date 2026-11-04. Decision record: ADR-021 (proposed). The approved base documents are not edited here; section 9 lists the edits.

Reference note: the plan note "The `frequency_downgrade` label has no config key yet; it is only in the series-map rationale" is in task T55 (World Bank REST connector), `docs/plans/macro-monitor-v1-implementation-plan.md` line 592, not in T58.

## 0. User decisions recorded (2026-11-04)

| # | Decision | Where it acts |
|---|---|---|
| UD-1 | The M14 annual fallback is shown in the explorer only, with a clear "annual, not monthly" label. It is NOT shown in scorecard cells (the M14 cell stays `n/a` while there is no monthly headline). The metadata-only option and the scorecard-cell option are both rejected | section 5, AC-FD-5 |
| UD-2 | The exact label wording is to be proposed as a draft for the user's confirmation (section 5, DRAFT wording; not yet approved text) | section 5, AC-FD-9 |
| UD-3 | The two M14 pairs (DEU, FRA) are added to `config/known_gaps.yaml`; recorded as an implementation-phase item (this document does not edit `config/`) | section 7, item I-1, AC-FD-8 |

## 1. Reality check

| Topic | Spec / plan today | Repository today | Delta |
|---|---|---|---|
| The label | plan T55 goal "M14 annual fallback labelled `frequency_downgrade`"; analytics P17 "shown labelled `frequency_downgrade`" | only prose in `rationale` of the two M14 entries in `config/series_map/worldbank_annual.yaml` (DEU, FRA; `role: fallback`, `expect.frequency: A`; indicator M14 has `tier: M`, `transform: RESERVE_COVER`) | explicit key, stored, validated, exported |
| Validation | none | the series-map semantic validator knows `role` in `headline/fallback/comparison` and the SA rule 8 for headline and fallback; nothing about frequency | rules 41-43 |
| Storage | `ref.series_map` has `role` only (0001) | same | column `frequency_downgrade` |
| Analytics use of fallbacks | ADR-009: analytics read `headline` only; a fallback is used only where no headline exists | no analytics code reads `role = 'fallback'` (grep of `src/macro_monitor/analytics` finds the word only in an unrelated "annual denominator fallback" of `transforms_denominator.py`, a different concept; do not confuse) | invariant made explicit and tested |
| Export | only headline series: `ref.v_series_export` and `curated.v_headline_obs_published` select `role = 'headline'` | same | uncovered fallback pairs exported with the label (explorer only) |
| Coverage gate | AC-CFG-5: core pairs mapped or `known_gap`; plan T62: "M14 and cover remain n/a with `known_gap` until a route exists" | `registry/report.py` has a `fallback_only` list | a downgrade-only pair is not "mapped" |

## 2. Source-config amendment (section 4, series map)

New key on a series-map entry:

```yaml
  - dataset: FI.RES.TOTL.CD
    key: "FI.RES.TOTL.CD.DEU"
    entity: DEU
    indicator: M14
    role: fallback
    frequency_downgrade: true          # NEW, mandatory on role: fallback; boolean; no default
    valid_from: 1991-01-01
    rationale: "World Bank WDI total reserves incl. gold, current USD, annual. M14 annual fallback; never feeds cover or alerts."
    expect: {frequency: A, unit: USD, seasonal_adjustment: NA, price_basis: NA}
```
Rules (numbers continue after rule 40 of `docs/specs/domain-eligibility-amendment.md`; rule numbers 34-37 belong to the freshness amendment):
41. `frequency_downgrade` is REQUIRED on every entry with `role: fallback`. It must be a YAML boolean (`true`/`false`); strings, numbers and null are errors. There is no default, so omitting it is an error naming indicator, entity and key.
42. Consistency. Let `rank(D)=0, rank(M)=1, rank(Q)=2, rank(A)=3`. The entry must declare `expect.frequency` (error if absent for a fallback); the value must satisfy `frequency_downgrade == (rank(expect.frequency) > rank(indicator.tier))`, where `tier` is the indicator's `tier` (`M`, `Q` or `A`). `true` on a same-frequency or finer fallback is an error; `false` (or a missing key) on a coarser fallback is an error. Consequence: every M14 annual fallback must carry `frequency_downgrade: true`; the shipped entries need that edit (the data-engineer's scope; they fail rule 41 until edited).
43. `frequency_downgrade` on a `headline` or `comparison` entry is an error ("only valid on role: fallback"). This spec adds no new constraint on the frequency of headline entries.

AC-CFG-18 (config): the M14 DEU entry above validates; negatives, one each: key omitted; `false` on the annual M14 entry; `"yes"`; `true` on a monthly M14 fallback (`expect.frequency: M`); `true` on an annual fallback of a tier-A indicator; a fallback without `expect.frequency`; the key on a `headline` entry; the key on a `comparison` entry. The checked-in `config/series_map/worldbank_annual.yaml` passes the validator, and a test asserts that every `role: fallback` entry of every shipped series-map file carries the key.

AC-CFG-5 wording (extension): a pair (indicator, entity) whose only mapping is a `frequency_downgrade: true` fallback is NOT "mapped" for the coverage gate; it needs a `known_gap` entry with the reason (plan T62, T63; for the two M14 pairs, UD-3). `config-report` lists such pairs in a separate column `downgrade_only` (today's `fallback_only` column remains for same-frequency fallbacks).

## 3. Storage and views: migration NNNN_series_map_frequency_downgrade.sql (forward-only; 0014 if 0011-0013 land first)

The runner requires contiguous versions (`storage/migrate.py`); the number is assigned at implementation. Never edit 0001, 0005 or 0007.

```sql
ALTER TABLE ref.series_map
  ADD COLUMN frequency_downgrade boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT series_map_downgrade_is_fallback CHECK (NOT frequency_downgrade OR role = 'fallback');

-- ref.v_series_export: same 18 columns first, two appended; fallback rows for pairs with no current headline
CREATE OR REPLACE VIEW ref.v_series_export AS
SELECT se.series_id, m.indicator_id, m.entity_id, se.source_id, so.provider AS source_name, se.series_key,
       se.frequency, se.unit_code, se.unit_mult, se.base_period, se.seasonal_adjustment, se.price_basis,
       se.flow_basis, se.calendar_basis,
       EXISTS (SELECT 1 FROM ref.inheritance_rule r
                WHERE r.indicator_id = m.indicator_id AND r.entity_id = m.entity_id
                  AND r.valid_from <= current_date AND (r.valid_to IS NULL OR r.valid_to >= current_date)) AS inherited,
       so.attribution AS licence_attribution, so.publish_site AS publish, g.reestimating,
       m.role AS series_role, m.frequency_downgrade
  FROM ref.series_map m
  JOIN ref.indicator i ON i.indicator_id = m.indicator_id AND i.kind = 'indicator'
  JOIN ref.series se ON se.series_id = m.series_id
  JOIN ref.series_group g ON g.source_id = se.source_id AND g.group_id = se.group_id
  JOIN ref.source so ON so.source_id = se.source_id
 WHERE m.valid_from <= current_date AND (m.valid_to IS NULL OR m.valid_to >= current_date)
   AND (m.role = 'headline'
        OR (m.role = 'fallback'
            AND NOT EXISTS (SELECT 1 FROM ref.series_map h
                             WHERE h.indicator_id = m.indicator_id AND h.entity_id = m.entity_id AND h.role = 'headline'
                               AND h.valid_from <= current_date AND (h.valid_to IS NULL OR h.valid_to >= current_date))));

-- observations of those fallback series; same restrictions as curated.v_headline_obs_published (public source, kind = 'indicator', no PROJ)
CREATE VIEW curated.v_fallback_obs_published AS
SELECT v.*, m.indicator_id, m.entity_id, m.frequency_downgrade
  FROM curated.v_series_obs v
  JOIN ref.series_map m ON m.series_id = v.series_id AND m.role = 'fallback'
   AND v.ref_period_start >= m.valid_from AND (m.valid_to IS NULL OR v.ref_period_start <= m.valid_to)
  JOIN ref.indicator i ON i.indicator_id = m.indicator_id AND i.kind = 'indicator'
  JOIN ref.source src ON src.source_id = v.source_id AND src.publish_site = 'public'
 WHERE v.value_status <> 'PROJ'
   AND NOT EXISTS (SELECT 1 FROM ref.series_map h
                    WHERE h.indicator_id = m.indicator_id AND h.entity_id = m.entity_id AND h.role = 'headline'
                      AND h.valid_from <= current_date AND (h.valid_to IS NULL OR h.valid_to >= current_date));

GRANT SELECT ON curated.v_fallback_obs_published TO mm_reader;     -- with the mm_test_<tag> suffix pattern of 0007/0009
```
Notes:
- `ADD COLUMN ... NOT NULL DEFAULT false` is a constant non-volatile default and does not rewrite the table; the `CHECK` scans existing rows once, which all satisfy it (default false) [PostgreSQL ALTER TABLE, https://www.postgresql.org/docs/current/sql-altertable.html, accessed 2026-11-04].
- `CREATE OR REPLACE VIEW ref.v_series_export` is valid because the first 18 output columns keep their names, order and types and two are appended; owner and the `mm_reader` grant of 0007 are preserved [PostgreSQL CREATE VIEW, https://www.postgresql.org/docs/current/sql-createview.html, accessed 2026-11-04]. The new column is named `series_role` (not `role`) to avoid a reserved-looking name in client code.
- The view row-count rule: a fallback row appears only while the pair has no current headline mapping, so a pair never has two exported series; the day a headline mapping becomes valid the fallback leaves the export (history of the fallback series stays in `curated.observation`).
- `ref.series_map` is written by `sync-config` (existing series) and by the loader at first sight (ADR-018). Both must write the column from the entry; a change of the flag in config is an UPDATE of the row and appears in `ref.config_history` (the trigger stores `to_jsonb(row)`, 0002).
- Revision history (`curated.v_revision_history`) and published alerts/scorecards are NOT extended: they stay headline-only.
- Because the user chose the explorer as the only surface (UD-1), `curated.v_fallback_obs_published` and the series-file rows are required (the explorer needs values); the metadata-only variant is rejected.

## 4. Invariants
- I-FD-1: `frequency_downgrade` is true only on `role = 'fallback'` rows (CHECK).
- I-FD-2: analytics and every transform read `role = 'headline'` mappings only (ADR-009). A `frequency_downgrade` fallback is never promoted to a transform input, a rank, an alert, a scorecard cell or a `RESERVE_COVER` numerator, and there is no automatic switch from fallback to headline (a headline change is a reviewed config change, ADR-009).
- I-FD-3: the exported label is derived only from `frequency_downgrade` and the two frequencies; it is never taken from `rationale` prose.
- I-FD-4: a fallback series is exported only if its source is `publish_site = 'public'` and the pair has no current headline.
- I-FD-5 (UD-1): the fallback surface is the explorer (chart legend and series table) only. No scorecard cell, rank table, alert, revision view or export file other than `meta/series.json` and `series/<indicator_id>.parquet` carries a fallback value.

## 5. Dashboard-export amendment

`meta/series.json` (section 4): "one row per headline series" becomes "one row per headline series and per exported fallback series". Fields added to every row (additive; minor contract bump): `series_role` (`headline` or `fallback`), `frequency_downgrade` (bool), `frequency_downgrade_badge` (string or null), `frequency_downgrade_label` (string or null). The row for a fallback carries the series' own native metadata (`frequency` `A` for the M14 example).

### 5.1 Label wording (DRAFT for the user's confirmation, UD-2; not approved text)
The texts are produced by the export from a constant table of frequency words, never from the database, and are covered by a golden test. Two strings per fallback series, from fixed templates; `{S}` = the series' frequency word and `{I}` = the indicator's tier word, with `M` = monthly, `Q` = quarterly, `A` = annual (first letter capitalised where the string starts with it):

| Use | Template | M14 result (series `A`, indicator tier `M`) |
|---|---|---|
| Badge (short, next to the series name in the explorer legend and above the series table) | `{S}, not {I}` | **Annual, not monthly** |
| Label (tooltip on the badge and the note under the chart) | `{S} data, shown because no {I} series is available for this indicator. Not comparable with {I} series; not used for ranks, alerts or ratios.` | Annual data, shown because no monthly series is available for this indicator. Not comparable with monthly series; not used for ranks, alerts or ratios. |

Changes against the first draft: the internal term "frequency downgrade" is removed from user-visible text (it stays the config and column name); the badge states the fact "annual, not monthly" as requested. Placement rule: the badge is shown wherever the fallback series is plotted or tabulated in the explorer; the M14 scorecard cell is unchanged and shows `n/a`. If you prefer other words, replace the two templates; the golden test follows them.

Series files (section 6): `series/<indicator_id>.parquet` rows now come from `curated.v_headline_obs_published` UNION ALL `curated.v_fallback_obs_published`. Columns added: `series_role` (dictionary string, not null) and `frequency_downgrade` (bool, not null; false on headline rows). On fallback rows `value_default_tf` and `value_yoy` are always null (the export never computes a transform of a fallback: the selectors Default and YoY show no data for it, Level shows `value`), `frequency` is the native one (no resampling), `load_kind` and `known_at` as for headline rows. Sort key unchanged (`entity_id`, `ref_period_start`); a pair never has both roles (I-FD-4).

Unchanged by design (UD-1): scorecards (the M14 cell stays `n/a` while there is no monthly headline), `alerts.json`, `revisions/*`, `revisions_recent.json`, `meta/indicators.json`.

Validation (section 10): EXP-02 additionally fails when a fallback row has a non-null `value_default_tf` or `value_yoy`, when `frequency_downgrade` is true on a headline row, or when a pair has rows of both roles; EXP-03 requires badge and label for every row with `frequency_downgrade = true` and nulls otherwise; EXP-04 compares the row count of a series file with the sum of the two views; EXP-09 (withheld non-leak) extends to the fallback view.

Schema/contract: adding nullable/boolean columns to series files and fields to `meta/series.json` is a minor `schema_version` bump (additive, section 3 of the export spec).

## 6. Acceptance criteria

- AC-FD-1 (config): AC-CFG-18 and the AC-CFG-5 extension above.
- AC-FD-2 (migration and storage; T-DDL-43). The migration applies to a database with existing `ref.series_map` rows (all read `false`); inserting `frequency_downgrade = true` with `role = 'headline'` or `'comparison'` fails; `true` with `role = 'fallback'` succeeds; `has_table_privilege('mm_reader', 'ref.v_series_export', 'SELECT')` is still true after the replacement; the view has exactly the 18 old columns followed by `series_role, frequency_downgrade` (T-DDL-32 updated to 20 columns); a changed checksum of 0007 is rejected.
- AC-FD-3 (loader and sync). The first-sight path (ADR-018) creates the `ref.series_map` row of a fallback entry with the flag from the entry; `sync-config` run after the entry changes from `false` to `true` updates the row and writes a `ref.config_history` row (table `series_map`).
- AC-FD-4 (analytics invariant I-FD-2). Fixture: M14 DEU with only a World Bank annual fallback series holding data: the snapshot has no M14/DEU value (`n/a`), no alert, `RESERVE_COVER` is not computed, scorecards of all domains are identical with and without the fallback series loaded (perturbation). Adding a monthly headline mapping afterwards makes the pair a headline pair; the fallback series is no longer exported.
- AC-FD-5 (export, explorer only; UD-1). Fixture with a public fallback series (M14 DEU, annual) and a headline series for another pair of the same indicator: `meta/series.json` has the fallback row (`series_role = "fallback"`, `frequency_downgrade = true`, badge and label equal to the golden strings) and the headline row (`frequency_downgrade = false`, badge and label null); `series/M14.parquet` has both, the fallback rows with `frequency = 'A'` and null `value_default_tf`/`value_yoy`; a pair with both a headline and a fallback exports only the headline; the scorecard files (the M14 cell is `n/a` with no value), alerts and revision files contain nothing from the fallback; the exported row count equals the sum of the two views (EXP-04).
- AC-FD-6 (leak). A fallback series of a `withheld` source appears in no file; a byte search for its distinctive values finds nothing; perturbing its values changes no exported file (extends AC-EXP-4(d)).
- AC-FD-7 (privileges; T-DDL-10 matrix). `mm_reader` can SELECT `curated.v_fallback_obs_published` and `ref.v_series_export`, cannot SELECT `ref.series_map`; the checked-in expected matrix contains the new view; no other role gains a privilege.
- AC-FD-8 (coverage gate; UD-3). `config-report` lists the two M14 pairs (DEU, FRA) under `downgrade_only`; the AC-CFG-5 gate fails for them until `config/known_gaps.yaml` has an entry for each pair with a reason (suggested reason text: "no monthly official FX-reserves source resolved (analytics P17, plan T62); World Bank annual fallback shown in the explorer only, labelled annual, not monthly"); once the two entries exist the gate passes and `config-report` still lists the pairs under `downgrade_only`. The shipped `known_gaps.yaml` is changed by the data-engineer only after the user approves this amendment (implementation item I-1, section 7).
- AC-FD-9 (golden label). Badge and label for (`A`, `M`), (`Q`, `M`) and (`A`, `Q`) equal the templates of section 5.1 with the right words (for (`A`, `M`): "Annual, not monthly" and the M14 sentence above, once the user confirms the wording); an unknown frequency pair raises an export error (EXP-01), never a blank label.

## 7. Delta for the implementation (no code here)
- `registry/config.py` / series-map loader: key, rules 41-43, `config-report` column; `registry/sync.py` and the loader's first-sight function: write the column.
- `publish/`: the two query changes, the label constant table (badge and label), the new fields and columns, EXP-02/03/04/09 extensions, JSON Schemas and Parquet schema.
- `config/series_map/worldbank_annual.yaml`: add `frequency_downgrade: true` to both M14 entries (implementation scope after approval; the file is not edited here).
- Implementation-phase item I-1 (UD-3): add the two pairs `M14|DEU` and `M14|FRA` to `config/known_gaps.yaml`, in the file's existing entry format, with the reason text of AC-FD-8. Not done here: this agent does not write to `config/`.
- Tests: T-DDL-32 and the expected privilege matrix fixture are updated.

## 8. Questions: status after the user's answers (2026-11-04)

| # | Original question | Status |
|---|---|---|
| 1 | Surface: explorer only / metadata only / scorecard cell | CLOSED, UD-1: explorer only, clear "annual, not monthly" label, no scorecard cell |
| 2 | Label wording and badge text | DRAFT proposed in section 5.1 for the user's confirmation (UD-2); the wording is not approved until the user says so |
| 3 | Rule 42 derives the truth from the tier; a tier-A indicator with a monthly source would call a monthly fallback a non-downgrade | OPEN (not answered; the rule stays as written) |
| 4 | M14 pairs as `known_gap` | CLOSED, UD-3: yes; implementation-phase item I-1 |
| 5 | Migration number (assumed 0014) | OPEN as a formality: next free version at implementation |

## 9. Edits to apply to the base documents when this is approved
(Not applied. The tools available in the session that revised this proposal could only create or overwrite whole files; the base specs are large and a whole-file rewrite risked corrupting approved text. The base documents are unchanged and still `status: approved`. Applying them resets each to `status: draft` with a revision note. This list is the exact remaining work.)
- `docs/specs/source-config-schema.md`: section 4 key and example, rules 41-43, AC-CFG-18, AC-CFG-5 sentence, change log.
- `docs/specs/dashboard-export-spec.md`: `meta/series.json` fields (including badge and label) and sentence, series-file columns and sources, EXP-02/03/04/09 sentences, AC-EXP-17 (= AC-FD-5, AC-FD-6, AC-FD-9), `inputs` gets ADR-021.
- `docs/specs/ddl-neon-schema.md`: `ref.series_map` column and CHECK, `ref.v_series_export` columns (section 2), `curated.v_fallback_obs_published` (section 5), grant row in section 8, T-DDL-32 (20 columns), T-DDL-43; `inputs` gets ADR-021.
- `docs/specs/analytics-and-r-contract-spec.md`: section 9 P17 sentence "World Bank annual reserves are shown labelled `frequency_downgrade`" becomes "World Bank annual reserves are shown in the explorer only, labelled 'annual, not monthly' (ADR-021: field, label and surface); never in scorecard cells".
- ADR-009: unchanged; ADR-021 states the amendment.
