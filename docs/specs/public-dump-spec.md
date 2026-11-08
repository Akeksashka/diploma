---
status: approved   # approved by the user on 2026-10-27 (stated in session); amendment of 2026-11-04 (section 6 step 3, AC-DUMP-4) is under ADR-022 (approved 2026-11-04)
inputs: [ADR-015, ADR-003, ADR-008, ADR-012, ADR-002, docs/specs/ddl-neon-schema.md, docs/specs/workflows-spec.md, docs/specs/source-config-schema.md]
---
# Spec: public database dump and restore (per-view gzipped CSV, schema SQL, hashed manifest)

Implements ADR-015 (which amends ADR-003 recovery points (b) and (c)). Facts come from this repository's documents (read 2026-10-25); size figures are analyst estimates, unmeasured. External behaviours that were not verified are marked [UNVERIFIED].

## 1. Scope and partition rule
- One dump profile exists: `public` (`macro-monitor backup --profile public`; any other profile is rejected, AC-WF-10). It runs in `finalize` once per month in refresh mode under role `mm_ingest` (workflows spec section 2).
- Partition `P-public`: a source belongs to it exactly when `ref.source.archive_mode = 'public'` AND `ref.source.publish_site = 'public'` (unchanged, ADR-003). Observations, revisions and value-bearing decision columns of other sources are never in the dump; their metadata, hashes and manifest rows are.
- The dump reads only objects of the schema `pubdump` (section 2). It never reads a base table directly.

## 2. The `pubdump` views
Schema `pubdump`, views owned by `mm_owner`, `SELECT` granted to `mm_ingest` only (privilege matrix, DDL spec section 8). Each view has an explicit column list that equals the non-generated columns of its target table, in table order, and an ORDER BY key used by the writer. `pubdump.v_p_public_source (source_id)` implements the predicate once; the other views join to it.

| View | Target table (restore) | Rows | Redaction | Order key |
|---|---|---|---|---|
| `v_schema_migration` | `ops.schema_migration` | all | none | `version` |
| `v_ref_unit`, `v_ref_domain`, `v_ref_entity`, `v_ref_source`, `v_ref_series_group`, `v_ref_entity_group_member`, `v_ref_indicator`, `v_ref_indicator_domain`, `v_ref_indicator_input`, `v_ref_indicator_target`, `v_ref_global_translation`, `v_ref_inheritance_rule` | the same-named `ref.*` tables | all | none (configuration, no observation values); `ref.indicator.is_support` is generated and omitted | primary key |
| `v_ref_series` | `ref.series` | all (also series of restricted sources: metadata only) | none | `series_id` |
| `v_ref_series_map` | `ref.series_map` | all | none | primary key |
| `v_ingest_run` | `ingest.run` | all | none | `run_id` |
| `v_ref_config_history` | `ref.config_history` | all | none | `history_id` |
| `v_ingest_raw_blob`, `v_ingest_raw_object`, `v_ingest_raw_snapshot`, `v_ingest_raw_series_status` | `ingest.*` of the same name | all (URLs, hashes, timestamps; no bytes exist in Neon) | none | primary key (`raw_id`, or `sha256`) |
| `v_ingest_raw_load` | `ingest.raw_load` | all | `detail` replaced by `'{}'` when the object's source is not in `P-public` (carries values and counts) | `raw_id` |
| `v_curated_observation` | `curated.observation` | `SELECT` of `curated.v_observation_public` (all vintages incl. `import`, `P-public` only); `is_projection` is generated and omitted | none | `obs_id` |
| `v_ops_drift_event` | `ops.drift_event` | all | `old`, `new`, `note` set to NULL when the source is not in `P-public` | `event_id` |
| `v_ops_drift_decision` | `ops.drift_decision` | all | `note` set to NULL when the event's source is not in `P-public` | `decision_id` |
| `v_ops_quality_override` | `ops.quality_override` | all | `reason` set to the literal `[redacted]` when the series' source is not in `P-public` (column is NOT NULL) | `override_id` |

Explicitly excluded (a completeness test, AC-DUMP-6, requires every table of every non-system schema to be in the table above or in this list): `ingest.request_state` (cache), `ingest.fetch_attempt` (operational, pruned), `staging.*`, `analytics.*` and `analytics_r.*` (ADR-015 decision 5: `mm_ingest` cannot read them, ADR-012), `ops.validation_result`, `ops.run_summary`, `ops.export_status`, `ops.freshness_state` (operational, recomputed by `monitor`).

## 3. Files and format
- Encoding: UTF-8. CSV as produced by PostgreSQL `COPY ... TO STDOUT WITH (FORMAT csv, HEADER true)` with the default quote (`"`), escape (`"`) and NULL representation (an unquoted empty field is NULL; an empty string is written `""`). Session settings fixed by the writer: `TIME ZONE 'UTC'`, `DateStyle 'ISO, YMD'`, `IntervalStyle 'iso_8601'`, `client_encoding 'UTF8'`. `numeric` is written as exact text (trailing zeros preserved), `jsonb` as its text form, `timestamptz` as ISO 8601 with offset `+00`.
- One gzip file per view: `data/<schema>.<table>.csv.gz`. When a view has more than `max_rows_per_part` rows (default 1,000,000) it is written as `data/<schema>.<table>.part-0001.csv.gz`, `part-0002...` at row boundaries in order-key order; each part has its own header line.
- Determinism: rows ordered by the view's order key; gzip level 9, header mtime 0, no embedded file name. `sha256_csv` (hash of the uncompressed bytes) is the stable identity of a file; `sha256_gz` verifies transport.
- `schema.sql`: the byte-exact concatenation, in version order, of the applied migration files (`src/macro_monitor/storage/migrations/`) up to `schema_version`, each preceded by a comment line `-- migration <version> <name> sha256 <hex>`. It includes role creation (without passwords) and grants, so it restores a complete empty database. `ops.schema_migration` rows are restored from data (view `v_schema_migration`), not written by `schema.sql`.
- `manifest.json` (UTF-8, sorted keys), fields:

| Field | Meaning |
|---|---|
| `format_version` | `"1.0"`; major bump on a breaking change; restore refuses an unknown major |
| `dump_id` | release tag, `db-dump-public-<YYYY-MM>` (suffix `-r<ingest_run_id>` if that tag exists) |
| `created_at` | UTC wall clock (the only non-deterministic field) |
| `ingest_run_id`, `git_sha`, `code_version` | provenance |
| `snapshot` | `{ "isolation": "repeatable read", "database_clock": <clock_timestamp() read at snapshot start>, "max_loaded_at": <max curated loaded_at in the dump> }` |
| `partition` | `"P-public"` |
| `schema` | `{ "path": "schema.sql", "sha256": ..., "bytes": ..., "schema_version": N, "migrations": [{"version","name","sha256"}] }` |
| `files[]` | `{ "view", "target_table", "path", "part", "columns": [...], "order_key": [...], "rows", "bytes_gz", "sha256_gz", "bytes_csv", "sha256_csv" }` |
| `load_order[]` | target tables in the order they must be loaded (parents first) |
| `sequences[]` | `{ "sequence", "table", "column" }` identity sequences to reset after load |
| `trigger_tables[]` | tables on which user triggers are disabled during load |
| `sources` | `{ "included": [source_id...], "excluded": [{"source_id","reason": "archive_mode"\|"publish_site"}] }` (ids and reasons only) |
| `totals` | `{ "files", "rows", "bytes_gz" }` |

Invariants: every file in the release (except `manifest.json`) is listed with matching hashes; `load_order` covers every `target_table`; `columns` equals the CSV header of the file; `sources.excluded` ids appear in no `curated.observation` file row (checked by the self-check, section 5).

## 4. Release
Release `db-dump-public-<YYYY-MM>`, published through the same draft-then-publish path as raw releases (immutable, ADR-003). Assets: `manifest.json`, `schema.sql`, the `data/*.csv.gz` files. Expected asset count about 25-40, far below the 900-asset continuation threshold of ADR-003. The largest file is `curated.observation`: 0.5-1.1 M rows in year 1 at roughly 120 bytes of CSV each, compressing to roughly 15-35 MB [analyst estimate, unmeasured]. A single release asset must stay below GitHub's per-file limit (2 GiB [UNVERIFIED]); `max_rows_per_part` keeps each part far below it. No dump asset is published unless the self-check (section 5) passes; a failure leaves no published release and opens a `pipeline` issue.

## 5. Output self-check (before publication)
The writer re-reads its own output (not the database) and fails with a non-zero exit when any of these is false:
1. All hashes and row counts equal the manifest.
2. Every `series_id` in the `curated.observation` files belongs to a `P-public` source according to the `ref.series` and `ref.source` files of the same dump.
3. In the `ingest.raw_load` file every row of a non-`P-public` source has `detail = {}`; in `ops.drift_event` every such row has NULL `old`, `new`, `note`; in `ops.quality_override` every such row has `reason = [redacted]`.
4. The CSV header of each file equals the manifest `columns`.

## 6. Restore procedure
Prerequisites: `psql`, `gzip`, `sha256sum`, an empty database, a role that owns the objects (`mm_owner`; the restore of production into Neon is a disaster-recovery step run by the project owner) and permission to create roles if `schema.sql` creates them (superuser in a service container). Steps (each is a shell/psql command; `macro-monitor restore-test` runs exactly these, nothing more):
1. Download all assets of the release into a new empty directory `D`. Verify `sha256sum` of every file against `manifest.json`; verify the manifest of `schema.sql` (hash).
2. `psql -v ON_ERROR_STOP=1 -d <db> -f D/schema.sql`.
3. For each table in `load_order`: `ALTER TABLE <t> DISABLE TRIGGER USER;` (append-only guards and `ref.config_history` feeders must not fire; this needs table ownership, not superuser), then **[AMENDMENT, ADR-022, approved 2026-11-04]** if `SELECT count(*) FROM <t>` is greater than zero (the table was seeded by a migration, today only `ref.unit`: `0001_ref.sql`, `0010_unit_seed_pc_act.sql`) run `DELETE FROM <t>;` (plain `DELETE`, not `TRUNCATE`; foreign keys stay enforced because dependants come later in `load_order` and are still empty; if `<t>` is `ref.config_history` or `ops.schema_migration` abort instead of deleting), then for each file of the table in part order `gzip -dc D/<file> | psql -v ON_ERROR_STOP=1 -d <db> -c "\copy <t> (<manifest columns>) FROM STDIN WITH (FORMAT csv, HEADER true)"`, then `ALTER TABLE <t> ENABLE TRIGGER USER;`. Stored generated columns are not in the column list. Foreign keys remain enforced (parents are loaded first).
4. For each entry of `sequences[]`: `SELECT setval('<sequence>', COALESCE((SELECT max(<column>) FROM <table>), 0) + 1, false);`.
5. Verify: `SELECT count(*)` of each table equals the sum of `rows` of its files (this also proves that migration-seeded rows were replaced by the dump's rows); `ops.schema_migration` versions and checksums equal `manifest.schema.migrations`.
6. Roles get their passwords out of band; no secret is in the dump.
Restoring is complete for the partition `P-public`: restricted sources have metadata, manifest rows and decision ids only (ADR-003), and `analytics.*` are empty (ADR-015). The invariant suite (`db_invariants`) is meant to be run after step 5 and covers `P-public` sources only.

## 7. Acceptance criteria and tests
- AC-DUMP-1 (format and manifest; `db`): the manifest validates against `public-dump-manifest.schema.json`; every file's hashes match; each CSV header equals `columns`; a fixture with awkward values (commas, quotes, embedded newlines, non-ASCII text, `jsonb` containing quotes, `numeric` `2.10`, an empty string versus NULL, timestamps near a DST change) restores to equal values (NULL and empty string stay distinct; `2.10` stays `2.10`).
- AC-DUMP-2 (gate, extends AC-BKP-GATE of ADR-003; `db`): the four-source fixture of ADR-003 (`public/public`, `public/withheld`, `hash_only/public`, `hash_only/withheld`, each with distinctive observation values, a revision, a drift event with distinctive `old/new`, a quality override with a distinctive reason, a `raw_load.detail` with a distinctive count): a byte search over every decompressed CSV and over `schema.sql` and `manifest.json` finds none of the distinctive values of the three non-`P-public` sources; the `P-public` values are present; `sources.excluded` lists exactly the three ids. The part of the ADR-003 AC-BKP-GATE fixture that asks for an alert with a distinctive z-score is intentionally dropped here: `analytics.*` is excluded from the dump (section 2; ADR-015 decision 5, ADR-012), so no table of the dump can carry a z-score and there is nothing to search for.
- AC-DUMP-3 (self-check fails closed; `db`): with a deliberately broken view (stub returning one observation of a withheld source, or an unredacted `detail`) the writer exits non-zero, no release asset set is produced and the test sees no published release (mock release API).
- AC-DUMP-4 (psql-only restore; `db_invariants`): a shell test restores a fixture dump into an empty Postgres container using only `psql`, `gzip` and `sha256sum` (no Python); row counts equal the manifest; foreign-key and CHECK constraints are intact (an orphan-row query returns none; `ALTER TABLE ... VALIDATE CONSTRAINT` succeeds); identity sequences are reset (the next INSERT gets an id above the maximum); user triggers are enabled again (an UPDATE of `curated.observation` fails); `ref.config_history` row count equals the manifest (the feeders did not add rows). **[AMENDMENT, ADR-022, approved 2026-11-04]** The restore does not fail on migration-seeded rows (`ref.unit`), and a `db` test pins that the set of non-empty tables after applying `schema.sql` to an empty database equals `{ref.unit}`.
- AC-DUMP-5 (round trip; `db_invariants`): running the same writer on the restored database gives identical `sha256_csv` for every file of `P-public` tables (the restored database contains no observation of restricted sources, so the filtered output is the same).
- AC-DUMP-6 (completeness; `db`): every table in the schemas `ref`, `ingest`, `staging`, `curated`, `analytics`, `analytics_r`, `ops` is either the target of a `pubdump` view or in the explicit exclusion list of section 2; each view's column list equals the non-generated columns of its table. A migration that adds a column or a table fails this test until the dump is updated.
- AC-DUMP-7 (privileges; `db`): `mm_ingest` can SELECT every `pubdump` view; `mm_reader`, `mm_analytics` and `mm_r` cannot; no role can INSERT/UPDATE/DELETE a `pubdump` view; the T-DDL-10 expected matrix contains the `pubdump.*` rows.
- AC-DUMP-8 (determinism and parts; `db`): two runs against the same snapshot give identical `sha256_csv` and an identical manifest except `created_at`; with `max_rows_per_part = 3` a fixture table splits into parts in order-key order and restores to the same rows.
- AC-DUMP-9 (schema file; `db`): `schema.sql` equals the concatenation of the migration files with the header lines; it applies to an empty database; a changed checksum in `ops.schema_migration` data versus `manifest.schema.migrations` makes the restore fail at step 5.
- AC-DUMP-10 (release; `unit` with a mock release API, `network` operator-run): assets are exactly the files of the manifest plus the manifest; the tag follows the naming rule including the suffix case; immutability of the published release is checked once by the operator (AC-OPS-5).
- `restore-test.yml` (quarterly) runs AC-DUMP-4 and AC-DUMP-5 on the latest published dump, then the invariant suite and the sample `rebuild` comparison of the workflows spec; a failure opens a `restore-test failed` issue.

## 8. Open points (not decided here)
- Whether the dump should also carry the published analytics tables through a second `mm_reader` leg (ADR-015 Consequences).
- Whether `hash_only` sources with `publish_site = public` join the dump (design Q46 option, not taken up).
- Behaviour of `COPY` into `GENERATED ALWAYS` identity columns on the Postgres major version used by Neon [UNVERIFIED]; AC-DUMP-4 on the CI container is the test, and a spike on a Neon dev branch (AC-OPS-7 family) confirms it for the production target.

## Change log (Phase 2 fix pass, 2026-10-25)
- Status `draft`. AC-DUMP-2: states that the "alert with a distinctive z-score" part of the ADR-003 AC-BKP-GATE fixture is intentionally dropped because `analytics.*` is excluded from the dump. Nothing else changed.

## Change log (2026-11-04) - ADR-022 approved 2026-11-04
- Section 6 step 3: migration-seeded tables (non-empty after step 2; today `ref.unit`) are cleared with plain `DELETE` after `DISABLE TRIGGER USER` and before `\copy`. Section 6 step 5 and section 7 AC-DUMP-4: one clarifying clause each. Nothing else changed. Full rule and rationale: `docs/design/adr/ADR-022-restore-clears-migration-seeded-tables-before-copy.md` (status `approved`, user, 2026-11-04).
