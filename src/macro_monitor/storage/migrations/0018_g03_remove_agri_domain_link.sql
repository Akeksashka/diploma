-- Migration 0018: remove the stale (G03, agri) domain link (docs/specs/export-real-data-amendment.md, P1-A, Q-2).
-- G03 became scope: global (WLD only) and moved from domain agri to domain global in config/indicators.yaml;
-- sync-config adds the new link but never deletes a link (registry/sync.py: "kept; no DELETE"), so an existing
-- database keeps (G03, agri) and the export fails EXP-02 (global entity WLD in domain agri).
-- ref.indicator.scope needs no statement: the sync-config upsert (_upsert, DO UPDATE on every non-key column
-- that differs) updates scope.
-- Touches only ref.indicator_domain (a config table, not curated, raw-manifest or history). The feeder trigger
-- config_history_feed (0002) appends one op='delete' row to ref.config_history; no history row is updated or deleted.
-- A no-op where the link does not exist (fresh databases).
SELECT set_config('mm.git_sha', 'migration-0018', true);
DELETE FROM ref.indicator_domain WHERE indicator_id = 'G03' AND domain_id = 'agri';
