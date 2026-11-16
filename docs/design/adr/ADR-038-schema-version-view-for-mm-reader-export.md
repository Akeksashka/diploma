---
status: approved   # approved by the user 2026-11-16
---
# ADR-038: Owner-rights schema-version view so `export` can run DB-03 as `mm_reader`

Date: 2026-11-16. Extends ADR-012 (role matrix authority and run-metadata views); changes no approved decision. Labels: [REPO] read in this repository on 2026-11-16.

## Context
- `macro-monitor export` (`src/macro_monitor/cli.py`, `cmd_export`) uses one read-only `mm_reader` session (`docs/specs/dashboard-export-spec.md` section 1; ADR-008, ADR-012) [REPO]. It first calls `check_schema_version(conn)` (`src/macro_monitor/storage/migrate.py`, check DB-03), which reads `ops.schema_migration` through `applied()` [REPO].
- The normative privilege matrix gives `mm_reader` no access to that table: `tests/fixtures/privileges/expected_matrix.csv` row `ops.schema_migration,table,OWNER,S,-,-,-`; DDL spec `docs/specs/ddl-neon-schema.md` section 8 (line 778); migration 0006 [REPO].
- Result: the `publish-site` workflow (`scripts/ci/publish_site.sh export`, secret `NEON_URL_MM_READER`) fails with InsufficientPrivilege (run 43812120054). Every other object the export reads is granted to `mm_reader` [REPO, as reported].
- DB-03 is defined as "schema version equals code expectation; mismatch is an error and stops" (`docs/specs/validation-monitoring-spec.md` line 70). `docs/specs/workflows-spec.md` line 60 says "pipeline jobs check the schema version at start (DB-03)". Neither exempts a job or a role. `migrate.py` DB-03 also verifies every applied checksum, not just the number [REPO].
- Decision input from the user: change the code, not the privilege matrix.

## Options considered
1. Owner-rights view `ops.v_schema_version(version, name, checksum)` over `ops.schema_migration`, granted `SELECT` to `mm_reader` only; `export` runs the unchanged DB-03 logic against the view. Same pattern as the `ops.v_*` views of migration 0009 (not `security_invoker`; ADR-012). New forward-only migration. Chosen.
2. `export` skips DB-03 and relies on the stored analysis run or `ops.v_export_status_latest`. Rejected: neither records the schema version, so a code/schema mismatch would go undetected at the one stage that builds the public artefacts; it also creates a documented exception to DB-03 and workflows-spec line 60 that needs a spec change.
3. Grant `mm_reader` SELECT on `ops.schema_migration`. Rejected by the user (matrix unchanged).
4. Expose only the max version number. Rejected: DB-03 checks checksums of applied files; a version-only view would silently weaken the check for `export`. Checksums are SHA-256 of files already public in the repository, so exposing them adds no secret. `applied_at` is not exposed (not needed).

## Decision
1. Add migration `0019_ops_schema_version_view.sql` (next free number after 0018 [REPO]):
   ```sql
   CREATE VIEW ops.v_schema_version AS
   SELECT version, name, checksum FROM ops.schema_migration;
   -- GRANT SELECT TO mm_reader (test-suffix DO block as in 0009)
   ```
   Owner-rights (no `security_invoker`), no other grant. Granting uses the same `mm_test_` role-suffix `DO` block as migration 0009.
2. `migrate.py`: `applied()` and `check_schema_version()` take a keyword `relation` (default `ops.schema_migration`). `cmd_export` calls `check_schema_version(conn, relation="ops.v_schema_version")`. Check logic, exit code 40 and the DB-03 result semantics are unchanged. All other commands keep the table (their roles can read it). The relation name is a fixed internal constant, never user input.
3. Privilege matrix: add row `ops.v_schema_version,view,OWNER,?,?,-,S` after the `ops.v_backlog` row (same shape as the other `ops.v_*` rows); the `ops.schema_migration` row is unchanged.
4. Spec follow-up (no new ADR): DDL spec section 8 gets the view row; the export spec section 1 notes that DB-03 runs through this view.

## Consequences
- Positive: DB-03 keeps its full strength (version and checksums) for `export`; the privilege model changes by one read-only view; no change to `mm_reader` rights on any table.
- Negative: one more migration and view; `export` can only run after 0019 is applied, so the deploy order is migrate first, then `publish-site`. Until then `export` fails (as now) with a clearer cause (missing view), not a wrong result.
- Tests that change: `tests/integration/test_privileges.py` and `expected_matrix.csv` (new row; table row unchanged; assert `mm_reader` can SELECT the view and still cannot SELECT `ops.schema_migration`); `tests/integration/test_migrate.py` (DB-03 via the view: ok, version mismatch, changed checksum); `tests/integration/test_pubdump_views.py` only if it enumerates all `ops` objects; migration-count or expected-version assertions in unit tests (`tests/unit/test_storage_migrate.py`) if hard-coded. A unit test that `cmd_export` passes the view relation.
- Production: no change to existing grants. Applying 0019 to `neondb` is a separate step that happens only when the user explicitly asks for it (CLAUDE.md, ADR-008); never to `postgres`.
- Reversal: a later forward-only migration drops the view; `export` returns to the table only if the matrix is changed by a new ADR.

## Sources
- `src/macro_monitor/cli.py`, `src/macro_monitor/storage/migrate.py`, `src/macro_monitor/storage/migrations/0000`, `0006`, `0009`, `tests/fixtures/privileges/expected_matrix.csv`, `docs/specs/validation-monitoring-spec.md` (line 70), `docs/specs/workflows-spec.md` (line 60), `docs/specs/ddl-neon-schema.md` (section 8), `docs/specs/dashboard-export-spec.md` (section 1), ADR-008, ADR-012, read 2026-11-16. No web source used.
