-- Migration 0008: analytics and analytics_r (DDL spec section 6, section 8; T-DDL-12/24/26/28, AC-R-3; plan T34; ADR-011, ADR-012).
-- Forward-only: never edit this file once applied. Grants are in this migration (0006 obligation); no ALTER DEFAULT PRIVILEGES.
-- analytics_r gets the schema only: R modules are optional and off by default (ADR-006), so no table exists in v1. Every future
-- analytics_r table must carry analysis_run_id, module, method, package_versions, known_cutoff, created_at (AC-R-3, checked by
-- tests/integration/test_ddl_analytics.py against the catalog) and its own SELECT, INSERT grant to mm_r in the migration that creates it.

CREATE SCHEMA analytics;
CREATE SCHEMA analytics_r;

CREATE TABLE analytics.run (
  analysis_run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ingest_run_id bigint NOT NULL REFERENCES ingest.run,
  as_of_run_date date NOT NULL,
  known_cutoff timestamptz NOT NULL,
  load_cutoff timestamptz NOT NULL,
  code_version text NOT NULL,
  params jsonb NOT NULL,
  git_sha text NOT NULL,
  config_asof timestamptz NOT NULL,
  config_sha256 text NOT NULL,
  mapping_sha256 text NOT NULL,
  overrides_sha256 text NOT NULL);

CREATE VIEW analytics.v_run_published AS
  SELECT analysis_run_id, ingest_run_id, as_of_run_date, known_cutoff, load_cutoff, code_version, git_sha, config_sha256
  FROM analytics.run;

CREATE TABLE analytics.indicator_snapshot (
  analysis_run_id bigint NOT NULL, indicator_id text NOT NULL, entity_id text NOT NULL,
  series_id integer, value numeric, ref_period_end date, known_at timestamptz, source_release_at timestamptz,
  age_days integer, stale_limit_days integer, is_stale boolean,
  limit_source text NOT NULL DEFAULT 'class' CHECK (limit_source IN ('class','release_lag_aware')),
  inherited boolean NOT NULL DEFAULT false, transformed_value numeric, transform_id text,
  publish boolean NOT NULL,
  publish_scope text NOT NULL CHECK (publish_scope IN ('ranked','info_only','excluded')),
  alignment text NOT NULL DEFAULT 'aligned' CHECK (alignment IN ('aligned','ahead','lagging','unaligned','n/a')),
  alignment_reason text CHECK (alignment_reason IS NULL OR alignment_reason IN ('fiscal_year_basis')),
  ref_offset_days integer,
  value_kind text NOT NULL DEFAULT 'observed' CHECK (value_kind IN ('observed','estimate')),
  deviation numeric,
  PRIMARY KEY (analysis_run_id, indicator_id, entity_id),
  CONSTRAINT unaligned_has_reason CHECK ((alignment = 'unaligned') = (alignment_reason IS NOT NULL))
);

CREATE TABLE analytics.indicator_rank (
  analysis_run_id bigint NOT NULL, indicator_id text NOT NULL, entity_id text NOT NULL,
  percentile numeric NOT NULL,
  n_ranked smallint NOT NULL, PRIMARY KEY (analysis_run_id, indicator_id, entity_id)
);
CREATE TABLE analytics.indicator_alignment (
  analysis_run_id bigint NOT NULL, indicator_id text NOT NULL,
  rank_reference_period date NOT NULL,
  reference_period_spread_days integer NOT NULL,
  n_ranked smallint NOT NULL, n_unaligned smallint NOT NULL,
  max_ref_spread_days integer NOT NULL,
  PRIMARY KEY (analysis_run_id, indicator_id)
);
CREATE TABLE analytics.scorecard (
  analysis_run_id bigint NOT NULL, domain_id text NOT NULL, entity_id text NOT NULL,
  n_available smallint NOT NULL, n_defined smallint NOT NULL,
  percentile_rank numeric,
  rank_position smallint, n_ranked_entities smallint,
  low_coverage boolean NOT NULL DEFAULT false,
  heterogeneous_peer_set boolean NOT NULL DEFAULT false,
  peer_set_size_min smallint, peer_set_size_max smallint,
  PRIMARY KEY (analysis_run_id, domain_id, entity_id)
);
CREATE TABLE analytics.indicator_rank_published      (LIKE analytics.indicator_rank      INCLUDING ALL,
  publish_scope text NOT NULL CHECK (publish_scope = 'ranked'));
CREATE TABLE analytics.indicator_alignment_published (LIKE analytics.indicator_alignment INCLUDING ALL,
  publish_scope text NOT NULL CHECK (publish_scope = 'ranked'));
CREATE TABLE analytics.scorecard_published           (LIKE analytics.scorecard           INCLUDING ALL,
  publish_scope text NOT NULL CHECK (publish_scope IN ('ranked','info_only')));

CREATE TABLE analytics.alert (
  analysis_run_id bigint NOT NULL, indicator_id text NOT NULL, entity_id text NOT NULL, series_id integer NOT NULL,
  ref_period_end date NOT NULL, method text NOT NULL,
  window_obs smallint NOT NULL,
  n_obs smallint NOT NULL,
  z numeric, level text NOT NULL CHECK (level IN ('none','watch','alert')),
  confidence text NOT NULL CHECK (confidence IN ('full','low','none')),
  reason text CHECK (reason IS NULL OR reason IN ('mad_zero','sd_zero','below_min_obs','stale','no_window')),
  label text CHECK (label IS NULL OR label IN ('persistent_shift')),
  override_rule text,
  publish boolean NOT NULL,
  PRIMARY KEY (analysis_run_id, indicator_id, entity_id)
);
CREATE VIEW analytics.v_alert_published AS SELECT * FROM analytics.alert WHERE publish;
CREATE VIEW analytics.v_indicator_snapshot_published AS
  SELECT analysis_run_id, indicator_id, entity_id, series_id, ref_period_end, known_at, source_release_at, age_days, stale_limit_days,
         limit_source, is_stale, inherited, transform_id, alignment, alignment_reason, value_kind, publish, publish_scope,
         CASE WHEN publish THEN value END AS value, CASE WHEN publish THEN transformed_value END AS transformed_value,
         CASE WHEN publish THEN deviation END AS deviation, CASE WHEN publish THEN ref_offset_days END AS ref_offset_days
  FROM analytics.indicator_snapshot;

-- Grants (section 8). Role names carry the test-database suffix as in 0006/0007.
DO $mm$
DECLARE
  sfx text := CASE WHEN current_database() ~ '^mm_test_[0-9a-f]+$' THEN '_' || substr(current_database(), 9) ELSE '' END;
  ana text := quote_ident('mm_analytics' || sfx);
  r   text := quote_ident('mm_r' || sfx);
  rd  text := quote_ident('mm_reader' || sfx);
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA analytics TO %s, %s, %s', ana, r, rd);
  EXECUTE format('GRANT USAGE ON SCHEMA analytics_r TO %s', r);
  EXECUTE format('GRANT SELECT, INSERT ON analytics.run, analytics.indicator_snapshot, analytics.indicator_rank, analytics.indicator_alignment, analytics.scorecard, analytics.alert, analytics.indicator_rank_published, analytics.indicator_alignment_published, analytics.scorecard_published TO %s', ana);
  EXECUTE format('GRANT SELECT ON analytics.run, analytics.indicator_snapshot, analytics.indicator_rank, analytics.indicator_alignment, analytics.scorecard, analytics.alert TO %s', r);
  EXECUTE format('GRANT SELECT ON analytics.indicator_rank_published, analytics.indicator_alignment_published, analytics.scorecard_published TO %s, %s', r, rd);
  EXECUTE format('GRANT SELECT ON analytics.v_run_published, analytics.v_alert_published, analytics.v_indicator_snapshot_published TO %s, %s, %s', ana, r, rd);
  EXECUTE format('GRANT USAGE ON SEQUENCE analytics.run_analysis_run_id_seq TO %s', ana);
END
$mm$;
