-- Migration 0006: roles and grants (DDL spec section 8, normative; T-DDL-10; ADR-008, ADR-012).
-- Forward-only: never edit this file once applied. NO passwords here (OP-02): logins get their secret out of band.
--
-- Role names. Production uses the five spec names. The test harness (tests/conftest.py) creates per-database
-- copies "<role>_<tag>" in a database named "mm_test_<tag>"; the suffix is derived from the database name so the
-- same file serves both. Missing roles are created as LOGIN roles without a password (needs CREATEROLE; if the
-- migrating role lacks it the operator creates the roles first, plan risk BB2).
--
-- Objects of schemas that do not exist yet (analytics, analytics_r: T34; pubdump: later task) get no grants here.
-- OBLIGATION (T34 and the pubdump/ref-view migrations): each must carry its own section-8 grants in the same
-- migration that creates the objects; tests/integration/test_privileges.py fails on any object absent from
-- tests/fixtures/privileges/expected_matrix.csv, and lists the fixture rows still "not yet created".
-- No ALTER DEFAULT PRIVILEGES (section 8: defaults must not widen the matrix).
DO $mm$
DECLARE
  sfx   text := CASE WHEN current_database() ~ '^mm_test_[0-9a-f]+$' THEN '_' || substr(current_database(), 9) ELSE '' END;
  base  text;
  names jsonb := '{}';
  tpl   text;
  tbls  text[];
  t     text;
  stmt  text;
  sch   text;
  rls   text;
BEGIN
  FOREACH base IN ARRAY ARRAY['mm_owner','mm_ingest','mm_analytics','mm_r','mm_reader'] LOOP
    names := names || jsonb_build_object(base, base || sfx);
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = base || sfx) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', base || sfx);
    END IF;
  END LOOP;

  -- Schema USAGE (schemas that do not exist yet are skipped, see obligation above).
  FOR sch, rls IN SELECT * FROM (VALUES
      ('ref',      '{ing},{ana},{r},{rd}'),
      ('ingest',   '{ing}'),
      ('staging',  '{ing}'),
      ('curated',  '{ing},{ana},{r},{rd}'),
      ('ops',      '{ing},{ana},{rd}'),
      ('pubdump',  '{ing}'),
      ('analytics','{ana},{r},{rd}'),
      ('analytics_r','{r}')) v(s, r)
  LOOP
    CONTINUE WHEN to_regnamespace(sch) IS NULL;
    stmt := format('GRANT USAGE ON SCHEMA %I TO %s', sch, rls);
    stmt := replace(replace(replace(replace(stmt, '{ing}', quote_ident(names->>'mm_ingest')),
              '{ana}', quote_ident(names->>'mm_analytics')), '{r}', quote_ident(names->>'mm_r')),
              '{rd}', quote_ident(names->>'mm_reader'));
    EXECUTE stmt;
  END LOOP;

  -- Table, view, sequence and function grants: (template, objects). '@' stands for each object name.
  FOR tpl, tbls IN SELECT * FROM (VALUES
    -- ref configuration tables
    ('GRANT SELECT, INSERT, UPDATE ON ref.@ TO {ing}',
      ARRAY['source','series_group','entity','entity_group_member','unit','domain','indicator','indicator_domain',
            'indicator_input','indicator_target','series_map','inheritance_rule','global_translation']),
    ('GRANT SELECT ON ref.@ TO {ana}, {r}',
      ARRAY['source','series_group','entity','entity_group_member','unit','domain','indicator','indicator_domain',
            'indicator_input','indicator_target','series_map','inheritance_rule','global_translation',
            'config_history','series']),
    ('GRANT SELECT ON ref.@ TO {rd}', ARRAY['entity','entity_group_member','domain','indicator_domain']),
    ('GRANT SELECT (indicator_id, name, kind, is_support, scope, tier, priority, currency_basis, staleness_class, transform_id, sa_required, alert_method, adverse_dir, good_dir, display_dir, rank_mode, max_ref_spread_days, stationarity_class, release_lag_aware, is_comparison, concept_id, concept_priority) ON ref.indicator TO {rd}',
      ARRAY['']),
    ('GRANT SELECT ON ref.config_history TO {ing}', ARRAY['']),
    ('GRANT SELECT, INSERT ON ref.series TO {ing}', ARRAY['']),
    ('GRANT UPDATE (is_active, published_decimals) ON ref.series TO {ing}', ARRAY['']),
    ('REVOKE ALL ON FUNCTION ref.fn_config_asof(text, timestamptz) FROM PUBLIC', ARRAY['']),
    ('GRANT EXECUTE ON FUNCTION ref.fn_config_asof(text, timestamptz) TO {ing}, {ana}, {r}', ARRAY['']),
    -- ingest
    ('GRANT SELECT, INSERT ON ingest.@ TO {ing}',
      ARRAY['run','request_state','raw_blob','raw_object','raw_snapshot','raw_load','raw_series_status','fetch_attempt']),
    ('GRANT SELECT ON ingest.@ TO {ing}', ARRAY['v_raw_unloaded','v_series_deferred']),
    ('GRANT UPDATE (status, finished_at) ON ingest.run TO {ing}', ARRAY['']),
    ('GRANT UPDATE ON ingest.request_state TO {ing}', ARRAY['']),
    ('GRANT SELECT ON ingest.run TO {ana}', ARRAY['']),
    -- staging: no UPDATE, no TRUNCATE
    ('GRANT SELECT, INSERT, DELETE ON staging.@ TO {ing}', ARRAY['observation_load','series_meta_load','rejected']),
    -- curated
    ('GRANT SELECT, INSERT ON curated.observation TO {ing}', ARRAY['']),
    ('GRANT SELECT ON curated.observation TO {ana}', ARRAY['']),
    ('GRANT SELECT ON curated.@ TO {ing}, {ana}, {r}',
      ARRAY['v_observation_latest','v_series_obs','v_headline_obs','v_headline_obs_observed','v_comparison_obs']),
    ('GRANT SELECT ON curated.@ TO {ing}, {ana}, {r}, {rd}',
      ARRAY['v_headline_obs_published','v_revision_history','v_input_obs_published']),
    ('GRANT SELECT ON curated.v_observation_public TO {ing}', ARRAY['']),
    ('REVOKE ALL ON FUNCTION curated.fn_observation_asof(timestamptz, timestamptz) FROM PUBLIC', ARRAY['']),
    -- ops
    ('GRANT SELECT, INSERT ON ops.@ TO {ing}',
      ARRAY['validation_result','freshness_state','run_summary','export_status','drift_event','drift_decision','quality_override']),
    ('GRANT UPDATE ON ops.run_summary TO {ing}', ARRAY['']),
    ('GRANT UPDATE (status, decided_by, decided_on, note) ON ops.drift_event TO {ing}', ARRAY['']),
    ('GRANT SELECT ON ops.@ TO {ana}',
      ARRAY['validation_result','freshness_state','run_summary','export_status','drift_event','drift_decision','quality_override']),
    ('GRANT SELECT ON ops.schema_migration TO {ing}', ARRAY['']),
    -- identity sequences of the tables mm_ingest inserts into (never USAGE for anyone else here)
    ('GRANT USAGE ON SEQUENCE ref.series_series_id_seq, ingest.run_run_id_seq, ingest.raw_object_raw_id_seq, ingest.fetch_attempt_attempt_id_seq, curated.observation_obs_id_seq, ops.drift_event_event_id_seq, ops.drift_decision_decision_id_seq, ops.quality_override_override_id_seq, ops.export_status_export_id_seq TO {ing}', ARRAY[''])
  ) v(t, o)
  LOOP
    FOREACH t IN ARRAY tbls LOOP
      stmt := replace(tpl, '@', t);
      stmt := replace(replace(replace(replace(stmt, '{ing}', quote_ident(names->>'mm_ingest')),
                '{ana}', quote_ident(names->>'mm_analytics')), '{r}', quote_ident(names->>'mm_r')),
                '{rd}', quote_ident(names->>'mm_reader'));
      EXECUTE stmt;
    END LOOP;
  END LOOP;

  -- Functions are executable by PUBLIC by default: close that for every function of the application schemas
  -- (trigger functions need no EXECUTE privilege to fire); fn_config_asof / fn_observation_asof were re-granted above
  -- or below. The owner keeps EXECUTE.
  FOR stmt IN SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', p.oid::regprocedure)
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname IN ('ref','ingest','staging','curated','ops')
  LOOP
    EXECUTE stmt;
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION curated.fn_observation_asof(timestamptz, timestamptz) TO %I, %I, %I',
                 names->>'mm_ingest', names->>'mm_analytics', names->>'mm_r');
END
$mm$;
