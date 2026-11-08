-- Migration 0012: remove the stale (G02, agri) domain link (docs/specs/g02-domain-move-amendment.md, Q-1).
-- G02 (scope: global) moved from domain agri to domain global in config/indicators.yaml; sync-config adds the new
-- link but never deletes a link (registry/sync.py: "kept; no DELETE"), so an existing database keeps (G02, agri)
-- and the export fails EXP-02 (global entity WLD in domain agri).
-- Touches only ref.indicator_domain (a config table, not curated, raw-manifest or history). The feeder trigger
-- config_history_feed (0002) appends one op='delete' row to ref.config_history; no history row is updated or deleted.
-- A no-op where the link does not exist (fresh databases).
SELECT set_config('mm.git_sha', 'migration-0012', true);
DELETE FROM ref.indicator_domain WHERE indicator_id = 'G02' AND domain_id = 'agri';
