-- Migration 0000: the migration record itself (DDL spec section 7, ops.schema_migration).
-- Forward-only: never edit this file once applied; the runner rejects a changed checksum.
-- The runner inserts the row for this version in the same transaction as this file.
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE ops.schema_migration (version int PRIMARY KEY, name text, checksum text, applied_at timestamptz);
