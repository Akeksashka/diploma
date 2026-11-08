-- Migration 0016: group-level enabled flag (ADR-027, plan T137).
-- The column holds the group's OWN flag from sources.yaml (default true); the effective state is
-- ref.source.enabled AND ref.series_group.enabled, derivable by a join. Forward-only; no UPDATE
-- or DELETE of curated, raw-manifest or history tables.
ALTER TABLE ref.series_group ADD COLUMN enabled boolean NOT NULL DEFAULT true;
