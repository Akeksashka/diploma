---
status: approved   # approved by the user on 2026-10-27 (stated in session)
---
# ADR-018: `ref.series` rows (and their series-map bindings) are created by the loader on first sight

Date: 2026-10-25 (Phase 2 amendment batch). Repository facts from ADR-002, ADR-009, `docs/specs/ddl-neon-schema.md` sections 2 and 8, `docs/specs/ingestion-interfaces-spec.md` section 5 and the source-config spec section 4, read 2026-10-25 (plan BL-03 item 6, assumption A-2).

## Context
- `ref.series` needs published metadata (frequency, unit, seasonal adjustment, base period, price basis, flow basis, title) and `ref.series_map.series_id` is NOT NULL, so a mapping cannot exist before its series row.
- The series-map YAML (`config/series_map/<group>.yaml`) carries the series key, the entity, the indicator, the role and an `expect` block, but not the full published metadata (title, unit multiplier, published decimals); `sync-config` is therefore unable to create a complete row from config alone.
- The DDL grants `mm_ingest` INSERT on `ref.series` and the loader already resolves `series_ref` to `ref.series` (ingestion spec step 6) and compares `staging.series_meta_load` with stored attributes, but no document says what happens when no row exists. `sync-config` and the loader are the only two writers.

## Options considered
1. `sync-config` creates series rows from the `expect` block. The block is incomplete by design and would duplicate metadata that the source publishes; a wrong `expect` would create a wrong immutable row.
2. A separate `discover` command creates rows from a metadata-only parse (`discover: true` groups), reviewed before use. Safe but one more manual step per group and a second code path to the same table.
3. The loader creates the row on first sight from `staging.series_meta_load` (the published metadata), after checking it against `expect`, and creates the declared mapping in the same transaction.

## Decision
Option 3 (user decision 2026-10-25, plan assumption A-2).
1. First sight: in loader step 6, a staged `series_ref` that has no `ref.series` row and appears in the config series map of the object's group is created in the object's load transaction with `version = 1`, `supersedes_series_id = NULL`, `first_seen_at = raw_object.fetched_at`, the measurement attributes from `series_meta_load`, and `composition` from the map entry's `expect.composition` (default `NA`). A series that is not in the series map is never created (the parser filter already excludes it; `discover: true` groups still only report).
2. Check before create: the published metadata must equal the map entry's `expect` block (META-02) and satisfy META-01/03; the unit must exist in `ref.unit`; the group must exist in `ref.series_group`. On any failure no row is created, a `drift_event` is raised and the series is deferred as in step 6 (no partial row).
3. Binding: in the same transaction the loader inserts the `ref.series_map` rows that the config declares for this series key (role, validity window, rationale), so the one-headline exclusion constraint and `ref.config_history` apply as for any mapping. `sync-config` inserts map rows only for series that already exist; for the others it records them as pending (not an error) and reports them in `config-report`.
4. New versions after an accepted drift decision use the same creation function with `supersedes_series_id` set; the mapping switch remains a reviewed config commit (ADR-002, ADR-009).
5. Privileges: no change (`mm_ingest` has INSERT on `ref.series` and `ref.series_map`; UPDATE only on `is_active` and `published_decimals` of `ref.series`).

## Consequences
- Pro: no hand-maintained metadata for about 3,500 series; the row always reflects what the source published; one writer path; the `expect` check keeps a silent wrong mapping out.
- Con: the first load of a new series fixes its immutable measurement attributes, so a wrong mapping is corrected by a new version, not an edit; the loader does a little config work (series-map lookup at the object's `git_sha`); `config-report` must show pending mappings so that coverage statistics do not count them as mapped.
- Amends ADR-009: the ADR-009 sentence "Mapping rows live in `config/series_map/<source_group>.yaml` and are loaded by `macro-monitor sync-config`" no longer holds without qualification. After this ADR, `sync-config` loads a mapping row only for a series that already exists; for a series not seen yet the entry is the parser whitelist and a pending item, and the loader inserts the `ref.series` and `ref.series_map` rows at first sight (Decision 3). The rest of that ADR-009 bullet (changes go through a reviewed commit; a re-estimated source series triggers a drift event and does not move the headline mapping) is unchanged. ADR-009 itself is not edited.
- Tests: T-DDL-25 and AC-ING-21 (specs).
- Reversal: adding a `discover`-and-review step later does not change the schema.
