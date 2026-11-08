-- Migration 0011: schema pubdump, the public dump views (ADR-015, docs/specs/public-dump-spec.md section 2; plan T68).
-- Forward-only: never edit this file once applied. (0010 was taken by the unit seed; this is the next free number.)
-- One view per dumped table, owned by the migrating owner role (owner-rights views, deliberately NOT security_invoker;
-- behaviour on Neon UNVERIFIED, covered by the db test). Each view lists exactly the non-generated columns of its
-- table in table order; the writer orders rows by the key recorded in the view comment ("order_key: a, b").
-- Redactions apply to rows of sources outside P-public (archive_mode = 'public' AND publish_site = 'public').
-- Tables deliberately NOT dumped (spec section 2): ingest.request_state, ingest.fetch_attempt, staging.*, analytics.*,
-- analytics_r.*, ops.validation_result, ops.run_summary, ops.export_status, ops.freshness_state.
-- OBLIGATION: every later migration that adds a table or column must update the views here (new migration) or the
-- exclusion list in tests/integration/test_pubdump_views.py (AC-DUMP-6).

CREATE SCHEMA pubdump;

CREATE VIEW pubdump.v_p_public_source AS
SELECT s.source_id FROM ref.source s WHERE s.archive_mode = 'public' AND s.publish_site = 'public';
COMMENT ON VIEW pubdump.v_p_public_source IS 'partition P-public; order_key: source_id';

CREATE VIEW pubdump.v_schema_migration AS
SELECT x.version,
       x.name,
       x.checksum,
       x.applied_at
  FROM ops.schema_migration x;
COMMENT ON VIEW pubdump.v_schema_migration IS 'target: ops.schema_migration; order_key: version';

CREATE VIEW pubdump.v_ref_unit AS
SELECT x.unit_code,
       x.dimension,
       x.description
  FROM ref.unit x;
COMMENT ON VIEW pubdump.v_ref_unit IS 'target: ref.unit; order_key: unit_code';

CREATE VIEW pubdump.v_ref_domain AS
SELECT x.domain_id,
       x.name,
       x.is_ranked,
       x.min_coverage_for_rank,
       x.notice
  FROM ref.domain x;
COMMENT ON VIEW pubdump.v_ref_domain IS 'target: ref.domain; order_key: domain_id';

CREATE VIEW pubdump.v_ref_entity AS
SELECT x.entity_id,
       x.name,
       x.kind,
       x.is_ranked,
       x.is_global
  FROM ref.entity x;
COMMENT ON VIEW pubdump.v_ref_entity IS 'target: ref.entity; order_key: entity_id';

CREATE VIEW pubdump.v_ref_source AS
SELECT x.source_id,
       x.provider,
       x.kind,
       x.archive_mode,
       x.publish_site,
       x.licence_id,
       x.attribution,
       x.config_sha256,
       x.enabled
  FROM ref.source x;
COMMENT ON VIEW pubdump.v_ref_source IS 'target: ref.source; order_key: source_id';

CREATE VIEW pubdump.v_ref_series_group AS
SELECT x.source_id,
       x.group_id,
       x.reestimating,
       x.compare_mode,
       x.fixed_decimals,
       x.rel_epsilon,
       x.materiality_abs,
       x.materiality_rel,
       x.snapshot_mode,
       x.max_revised_rows,
       x.edition_ordered,
       x.config_sha256
  FROM ref.series_group x;
COMMENT ON VIEW pubdump.v_ref_series_group IS 'target: ref.series_group; order_key: source_id, group_id';

CREATE VIEW pubdump.v_ref_entity_group_member AS
SELECT x.group_id,
       x.entity_id,
       x.valid_from,
       x.valid_to
  FROM ref.entity_group_member x;
COMMENT ON VIEW pubdump.v_ref_entity_group_member IS 'target: ref.entity_group_member; order_key: group_id, entity_id, valid_from';

CREATE VIEW pubdump.v_ref_indicator AS
SELECT x.indicator_id,
       x.name,
       x.kind,
       x.scope,
       x.tier,
       x.priority,
       x.currency_basis,
       x.staleness_class,
       x.transform_id,
       x.sa_required,
       x.alert_method,
       x.adverse_dir,
       x.good_dir,
       x.display_dir,
       x.rank_mode,
       x.max_ref_spread_days,
       x.stationarity_class,
       x.release_lag_aware,
       x.alert_override,
       x.params,
       x.is_comparison,
       x.concept_id,
       x.concept_priority
  FROM ref.indicator x;
COMMENT ON VIEW pubdump.v_ref_indicator IS 'target: ref.indicator; order_key: indicator_id';

CREATE VIEW pubdump.v_ref_indicator_domain AS
SELECT x.indicator_id,
       x.domain_id,
       x.is_ranked
  FROM ref.indicator_domain x;
COMMENT ON VIEW pubdump.v_ref_indicator_domain IS 'target: ref.indicator_domain; order_key: indicator_id, domain_id';

CREATE VIEW pubdump.v_ref_indicator_input AS
SELECT x.indicator_id,
       x.input_id,
       x.usage,
       x.currency_match,
       x.annualised_policy
  FROM ref.indicator_input x;
COMMENT ON VIEW pubdump.v_ref_indicator_input IS 'target: ref.indicator_input; order_key: indicator_id, input_id, usage';

CREATE VIEW pubdump.v_ref_indicator_target AS
SELECT x.indicator_id,
       x.entity_id,
       x.target_value,
       x.band_low,
       x.band_high,
       x.source_note,
       x.valid_from,
       x.valid_to
  FROM ref.indicator_target x;
COMMENT ON VIEW pubdump.v_ref_indicator_target IS 'target: ref.indicator_target; order_key: indicator_id, entity_id, valid_from';

CREATE VIEW pubdump.v_ref_global_translation AS
SELECT x.indicator_id,
       x.entity_id,
       x.method,
       x.weight_input_id,
       x.rationale,
       x.valid_from,
       x.valid_to
  FROM ref.global_translation x;
COMMENT ON VIEW pubdump.v_ref_global_translation IS 'target: ref.global_translation; order_key: indicator_id, entity_id, valid_from';

CREATE VIEW pubdump.v_ref_inheritance_rule AS
SELECT x.indicator_id,
       x.entity_id,
       x.source_entity_id,
       x.valid_from,
       x.valid_to
  FROM ref.inheritance_rule x;
COMMENT ON VIEW pubdump.v_ref_inheritance_rule IS 'target: ref.inheritance_rule; order_key: indicator_id, entity_id, valid_from';

CREATE VIEW pubdump.v_ref_series AS
SELECT x.series_id,
       x.source_id,
       x.group_id,
       x.dataset_id,
       x.series_key,
       x.version,
       x.supersedes_series_id,
       x.entity_id,
       x.title,
       x.frequency,
       x.unit_code,
       x.unit_mult,
       x.base_period,
       x.price_basis,
       x.currency_code,
       x.seasonal_adjustment,
       x.calendar_basis,
       x.flow_basis,
       x.composition,
       x.published_decimals,
       x.definition_note,
       x.is_active,
       x.first_seen_at
  FROM ref.series x;
COMMENT ON VIEW pubdump.v_ref_series IS 'target: ref.series; order_key: series_id';

CREATE VIEW pubdump.v_ref_series_map AS
SELECT x.indicator_id,
       x.entity_id,
       x.series_id,
       x.role,
       x.valid_from,
       x.valid_to,
       x.splice_note,
       x.rationale,
       x.recorded_at
  FROM ref.series_map x;
COMMENT ON VIEW pubdump.v_ref_series_map IS 'target: ref.series_map; order_key: indicator_id, entity_id, series_id, role, valid_from';

CREATE VIEW pubdump.v_ingest_run AS
SELECT x.run_id,
       x.gh_run_id,
       x.gh_run_attempt,
       x.workflow,
       x.trigger,
       x.mode,
       x.git_sha,
       x.code_version,
       x.started_at,
       x.finished_at,
       x.status
  FROM ingest.run x;
COMMENT ON VIEW pubdump.v_ingest_run IS 'target: ingest.run; order_key: run_id';

CREATE VIEW pubdump.v_ref_config_history AS
SELECT x.history_id,
       x.table_name,
       x.row_key,
       x.row_data,
       x.op,
       x.recorded_at,
       x.run_id,
       x.git_sha
  FROM ref.config_history x;
COMMENT ON VIEW pubdump.v_ref_config_history IS 'target: ref.config_history; order_key: history_id';

CREATE VIEW pubdump.v_ingest_raw_blob AS
SELECT x.sha256,
       x.byte_count,
       x.storage_backend,
       x.storage_ref,
       x.first_stored_at
  FROM ingest.raw_blob x;
COMMENT ON VIEW pubdump.v_ingest_raw_blob IS 'target: ingest.raw_blob; order_key: sha256';

CREATE VIEW pubdump.v_ingest_raw_object AS
SELECT x.raw_id,
       x.run_id,
       x.source_id,
       x.group_id,
       x.request_key,
       x.prev_raw_id,
       x.request_url,
       x.request_params,
       x.http_status,
       x.etag,
       x.last_modified,
       x.content_type,
       x.fetched_at,
       x.sha256,
       x.fetch_mode,
       x.fetch_scope,
       x.manual,
       x.edition_label,
       x.edition_date,
       x.import_label,
       x.robots_decision,
       x.robots_checked_at,
       x.parser_id
  FROM ingest.raw_object x;
COMMENT ON VIEW pubdump.v_ingest_raw_object IS 'target: ingest.raw_object; order_key: raw_id';

CREATE VIEW pubdump.v_ingest_raw_snapshot AS
SELECT x.raw_id,
       x.sha256,
       x.storage_ref,
       x.byte_count,
       x.row_count,
       x.parser_id
  FROM ingest.raw_snapshot x;
COMMENT ON VIEW pubdump.v_ingest_raw_snapshot IS 'target: ingest.raw_snapshot; order_key: raw_id';

CREATE VIEW pubdump.v_ingest_raw_series_status AS
SELECT x.raw_id,
       x.series_ref,
       x.status,
       x.event_id,
       x.run_id,
       x.recorded_at
  FROM ingest.raw_series_status x;
COMMENT ON VIEW pubdump.v_ingest_raw_series_status IS 'target: ingest.raw_series_status; order_key: raw_id, series_ref, status';

CREATE VIEW pubdump.v_ingest_raw_load AS
SELECT x.raw_id,
       x.outcome,
       x.load_run_id,
       x.loaded_at,
       x.rows_inserted,
       x.rows_below_tol,
       x.rows_tombstoned,
       CASE WHEN ro.source_id IN (SELECT source_id FROM pubdump.v_p_public_source) THEN x.detail ELSE '{}'::jsonb END AS detail
  FROM ingest.raw_load x
  LEFT JOIN ingest.raw_object ro ON ro.raw_id = x.raw_id;
COMMENT ON VIEW pubdump.v_ingest_raw_load IS 'target: ingest.raw_load; order_key: raw_id';

CREATE VIEW pubdump.v_curated_observation AS
SELECT x.obs_id,
       x.series_id,
       x.ref_period_start,
       x.ref_period_end,
       x.value,
       x.value_status,
       x.quality_flag,
       x.load_kind,
       x.revision_class,
       x.known_at,
       x.loaded_at,
       x.source_release_at,
       x.vintage_label,
       x.source_flags,
       x.raw_id,
       x.run_id
  FROM curated.v_observation_public x;
COMMENT ON VIEW pubdump.v_curated_observation IS 'target: curated.observation; order_key: obs_id';

CREATE VIEW pubdump.v_ops_drift_event AS
SELECT x.event_id,
       x.run_id,
       x.source_id,
       x.raw_id,
       x.kind,
       x.series_ref,
       CASE WHEN x.source_id IN (SELECT source_id FROM pubdump.v_p_public_source) THEN x.old ELSE NULL END AS old,
       CASE WHEN x.source_id IN (SELECT source_id FROM pubdump.v_p_public_source) THEN x.new ELSE NULL END AS new,
       x.status,
       x.decided_by,
       x.decided_on,
       CASE WHEN x.source_id IN (SELECT source_id FROM pubdump.v_p_public_source) THEN x.note ELSE NULL END AS note,
       x.created_at
  FROM ops.drift_event x;
COMMENT ON VIEW pubdump.v_ops_drift_event IS 'target: ops.drift_event; order_key: event_id';

CREATE VIEW pubdump.v_ops_drift_decision AS
SELECT x.decision_id,
       x.event_id,
       x.decision,
       x.effective_from,
       x.decided_by,
       x.decided_on,
       CASE WHEN ev.source_id IN (SELECT source_id FROM pubdump.v_p_public_source) THEN x.note ELSE NULL END AS note,
       x.recorded_at,
       x.git_sha
  FROM ops.drift_decision x
  JOIN ops.drift_event ev ON ev.event_id = x.event_id;
COMMENT ON VIEW pubdump.v_ops_drift_decision IS 'target: ops.drift_decision; order_key: decision_id';

CREATE VIEW pubdump.v_ops_quality_override AS
SELECT x.override_id,
       x.series_id,
       x.ref_period_start,
       x.known_at,
       x.decision,
       CASE WHEN sr.source_id IN (SELECT source_id FROM pubdump.v_p_public_source) THEN x.reason ELSE '[redacted]' END AS reason,
       x.decided_by,
       x.decided_on,
       x.recorded_at,
       x.supersedes_override_id
  FROM ops.quality_override x
  LEFT JOIN ref.series sr ON sr.series_id = x.series_id;
COMMENT ON VIEW pubdump.v_ops_quality_override IS 'target: ops.quality_override; order_key: override_id';

-- Section-8 grants: mm_ingest reads the views, nobody writes (views get no other privilege). Role names carry the
-- throwaway-database suffix in tests, as in migration 0006.
DO $mm$
DECLARE
  sfx text := CASE WHEN current_database() ~ '^mm_test_[0-9a-f]+$' THEN '_' || substr(current_database(), 9) ELSE '' END;
  v   text;
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA pubdump TO %I', 'mm_ingest' || sfx);
  FOR v IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'pubdump' AND c.relkind = 'v'
  LOOP
    EXECUTE format('GRANT SELECT ON pubdump.%I TO %I', v, 'mm_ingest' || sfx);
  END LOOP;
END
$mm$;
