-- Migration 0019: owner-rights schema-version view for mm_reader (ADR-038, extends ADR-012).
-- Forward-only: never edit this file once applied.
-- Lets `export` run check DB-03 (version and checksums) as mm_reader without any privilege on
-- ops.schema_migration. Deliberately NOT security_invoker (same pattern as migration 0009). No applied_at.

CREATE VIEW ops.v_schema_version AS
SELECT version, name, checksum FROM ops.schema_migration;

DO $mm$
DECLARE
  sfx text := CASE WHEN current_database() ~ '^mm_test_[0-9a-f]+$' THEN '_' || substr(current_database(), 9) ELSE '' END;
BEGIN
  EXECUTE format('GRANT SELECT ON ops.v_schema_version TO %I', 'mm_reader' || sfx);
END
$mm$;
