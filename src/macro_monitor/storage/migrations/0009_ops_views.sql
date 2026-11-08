-- Migration 0009: ops views for mm_reader (DDL spec section 7, T-DDL-26/29; plan T35).
-- Forward-only: never edit this file once applied.
-- Owner-rights views: deliberately NOT security_invoker, so mm_reader reads them without any privilege on the
-- base tables (ADR-012; behaviour on Neon UNVERIFIED, covered by the db test). No raw error text, no old/new
-- JSON, no db_bytes, no connection timings, no groups JSON, no free-text detail in any view.

CREATE VIEW ops.v_freshness_latest AS
SELECT DISTINCT ON (f.source_group, f.series_group)
       f.source_group, f.series_group, f.evaluated_at, f.expected_period_end, f.latest_period_end, f.state
  FROM ops.freshness_state f
 ORDER BY f.source_group, f.series_group, f.evaluated_at DESC;

-- One row per ingest.run. Published-scope counts (spec section 7): observation rows are found through
-- ingest.raw_load.load_run_id and the obs_raw index (curated.observation.raw_id), never by scanning curated.observation.
CREATE VIEW ops.v_run_summary_public AS
SELECT r.run_id AS ingest_run_id,
       r.workflow, r.mode, r.status, r.started_at, r.finished_at,
       (SELECT count(*)::integer
          FROM ingest.raw_object ro
          JOIN ref.source so ON so.source_id = ro.source_id AND so.publish_site = 'public'
         WHERE ro.run_id = r.run_id) AS new_raw_objects,
       obs.new_observations,
       obs.revisions,
       al.alerts_opened
  FROM ingest.run r
 CROSS JOIN LATERAL (
   SELECT (count(*) FILTER (WHERE o.load_kind IN ('initial','new_period')))::integer AS new_observations,
          (count(*) FILTER (WHERE o.load_kind IN ('revision','tombstone')))::integer AS revisions
     FROM ingest.raw_load l
     JOIN ingest.raw_object ro ON ro.raw_id = l.raw_id
     JOIN ref.source so ON so.source_id = ro.source_id AND so.publish_site = 'public'
     JOIN curated.observation o ON o.raw_id = l.raw_id AND o.run_id = l.load_run_id
    WHERE l.load_run_id = r.run_id
      AND o.load_kind <> 'import'
      AND o.value_status <> 'PROJ'
      AND EXISTS (SELECT 1
                    FROM ref.series_map m
                    JOIN ref.indicator i ON i.indicator_id = m.indicator_id AND i.kind = 'indicator'
                   WHERE m.series_id = o.series_id AND m.role = 'headline'
                     AND o.ref_period_start >= m.valid_from
                     AND (m.valid_to IS NULL OR o.ref_period_start <= m.valid_to))
 ) obs
 LEFT JOIN LATERAL (
   SELECT (SELECT count(*)::integer
             FROM analytics.alert a
            WHERE a.analysis_run_id = ar.analysis_run_id AND a.publish AND a.level IN ('watch','alert')) AS alerts_opened
     FROM (SELECT max(x.analysis_run_id) AS analysis_run_id
             FROM analytics.run x WHERE x.ingest_run_id = r.run_id) ar
    WHERE ar.analysis_run_id IS NOT NULL
 ) al ON true;

-- Counts by check family (prefix of check_id) and severity for each run; COV-01 detail per indicator.
CREATE VIEW ops.v_validation_counts AS
SELECT v.run_id,
       split_part(v.check_id, '-', 1) AS check_family,
       v.check_id,
       v.severity,
       CASE WHEN v.check_id = 'COV-01' THEN v.subject END AS subject,
       count(*)::integer AS n_results,
       (count(*) FILTER (WHERE v.passed IS NOT TRUE))::integer AS n_failed,
       max((v.detail ->> 'n_qualifying')::integer) FILTER (WHERE v.check_id = 'COV-01') AS n_qualifying,
       bool_or(v.detail ->> 'state' = 'not_yet_measurable') FILTER (WHERE v.check_id = 'COV-01') AS not_yet_measurable
  FROM ops.validation_result v
 GROUP BY v.run_id, split_part(v.check_id, '-', 1), v.check_id, v.severity,
          CASE WHEN v.check_id = 'COV-01' THEN v.subject END;

CREATE VIEW ops.v_open_drift AS
SELECT d.event_id, d.source_id, d.kind, d.status
  FROM ops.drift_event d
 WHERE d.status = 'open';

-- Last ingested manual file per manual source. The next expected download date is configuration
-- (config/release_calendar.yaml), not a database column, so it is not exposed here.
CREATE VIEW ops.v_manual_sources AS
SELECT s.source_id,
       max(ro.edition_date) AS last_edition_date,
       max(ro.fetched_at) AS last_ingested_at
  FROM ref.source s
  LEFT JOIN ingest.raw_object ro ON ro.source_id = s.source_id AND ro.manual
  LEFT JOIN ingest.raw_load l ON l.raw_id = ro.raw_id AND l.outcome = 'loaded'
 WHERE s.kind = 'manual'
   AND (ro.raw_id IS NULL OR l.raw_id IS NOT NULL)
 GROUP BY s.source_id;

CREATE VIEW ops.v_backlog AS
SELECT count(*)::integer AS n_unloaded,
       now() - min(u.fetched_at) AS oldest_age
  FROM ingest.v_raw_unloaded u;

CREATE VIEW ops.v_export_status_latest AS
SELECT e.export_id, e.run_id, e.analysis_run_id, e.recorded_at, e.status, e.duration_ms, e.bytes_read, e.file_counts
  FROM ops.export_status e
 ORDER BY e.export_id DESC
 LIMIT 1;

DO $mm$
DECLARE
  sfx text := CASE WHEN current_database() ~ '^mm_test_[0-9a-f]+$' THEN '_' || substr(current_database(), 9) ELSE '' END;
BEGIN
  EXECUTE format('GRANT SELECT ON ops.v_freshness_latest, ops.v_run_summary_public, ops.v_validation_counts, ops.v_open_drift, ops.v_manual_sources, ops.v_backlog, ops.v_export_status_latest TO %I', 'mm_reader' || sfx);
END
$mm$;
