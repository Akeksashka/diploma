-- Migration 0004: ops tables (DDL spec section 7, plan T14) and the carry-over foreign keys.
-- Forward-only: never edit this file once applied; the runner rejects a changed checksum.
-- Not here by design: roles and grants (T16), the ops.v_* views (later tasks).
-- ops.schema_migration already exists (0000).
CREATE TABLE ops.validation_result (         -- no primary key by design (spec); lookup index only
  run_id bigint, check_id text,
  severity text CHECK (severity IN ('info','warn','error')),
  source_id text, subject text, passed boolean, metric numeric, threshold numeric, detail jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX validation_result_run_check ON ops.validation_result (run_id, check_id);

CREATE TABLE ops.drift_event (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint, source_id text, raw_id bigint,
  kind text CHECK (kind IN ('unit','base_period','seasonal_adjustment','frequency','flow_basis','classification','composition',
                            'dataset_moved','mass_revision','schema_drift','precision_change')),
  series_ref text, old jsonb, new jsonb,
  status text DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),   -- CACHE of the latest ops.drift_decision
  decided_by text, decided_on date, note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.drift_decision (            -- append-only decision history with valid and recorded time
  decision_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id     bigint NOT NULL REFERENCES ops.drift_event,
  decision     text NOT NULL CHECK (decision IN ('accepted','rejected','reopened')),
  effective_from timestamptz,
  decided_by   text NOT NULL, decided_on date NOT NULL, note text,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  git_sha      text
);
CREATE INDEX drift_decision_event ON ops.drift_decision (event_id, decision_id);

CREATE TABLE ops.quality_override (
  override_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id integer, ref_period_start date, known_at timestamptz,
  decision text CHECK (decision IN ('exclude','include')), reason text NOT NULL, decided_by text NOT NULL, decided_on date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  supersedes_override_id bigint REFERENCES ops.quality_override
);

CREATE TABLE ops.run_summary (
  run_id bigint PRIMARY KEY, neon_connect_ms integer, db_bytes bigint,
  groups jsonb NOT NULL,
  new_raw_objects integer, new_observations integer, revisions integer, alerts_opened integer, cu_hours_note text,
  runner_clock_offset_ms integer
);

CREATE TABLE ops.export_status (             -- insert-only
  export_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint NOT NULL, analysis_run_id bigint, recorded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('ok','partial','failed')), duration_ms integer, bytes_read bigint,
  file_counts jsonb NOT NULL DEFAULT '{}', detail jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE ops.freshness_state (
  source_group text, series_group text, evaluated_at timestamptz, expected_period_end date,
  latest_period_end date, state text CHECK (state IN ('fresh','late','stale','broken')),
  PRIMARY KEY (source_group, series_group, evaluated_at)
);

-- ---------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION ops.fn_append_only() RETURNS trigger LANGUAGE plpgsql AS $mm$
BEGIN
  RAISE EXCEPTION '%.% is insert-only: % refused', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$mm$;

CREATE TRIGGER drift_decision_append_only BEFORE UPDATE OR DELETE ON ops.drift_decision
  FOR EACH ROW EXECUTE FUNCTION ops.fn_append_only();
CREATE TRIGGER drift_decision_no_truncate BEFORE TRUNCATE ON ops.drift_decision
  FOR EACH STATEMENT EXECUTE FUNCTION ops.fn_append_only();
CREATE TRIGGER quality_override_append_only BEFORE UPDATE OR DELETE ON ops.quality_override
  FOR EACH ROW EXECUTE FUNCTION ops.fn_append_only();
CREATE TRIGGER quality_override_no_truncate BEFORE TRUNCATE ON ops.quality_override
  FOR EACH STATEMENT EXECUTE FUNCTION ops.fn_append_only();
CREATE TRIGGER export_status_append_only BEFORE UPDATE OR DELETE ON ops.export_status
  FOR EACH ROW EXECUTE FUNCTION ops.fn_append_only();
CREATE TRIGGER export_status_no_truncate BEFORE TRUNCATE ON ops.export_status
  FOR EACH STATEMENT EXECUTE FUNCTION ops.fn_append_only();
CREATE TRIGGER drift_event_no_delete BEFORE DELETE ON ops.drift_event
  FOR EACH ROW EXECUTE FUNCTION ops.fn_append_only();
CREATE TRIGGER drift_event_no_truncate BEFORE TRUNCATE ON ops.drift_event
  FOR EACH STATEMENT EXECUTE FUNCTION ops.fn_append_only();

-- drift_event: only (status, decided_by, decided_on, note) may change, and only together with a drift_decision
-- row of the same event inserted in this transaction (xmin check, as I-ING-6); status must equal the cache of
-- the latest decision of the event ('reopened' -> 'open').
CREATE FUNCTION ops.fn_drift_event_update() RETURNS trigger LANGUAGE plpgsql AS $mm$
DECLARE
  latest text;
BEGIN
  IF (NEW.event_id, NEW.run_id, NEW.source_id, NEW.raw_id, NEW.kind, NEW.series_ref, NEW.old, NEW.new, NEW.created_at)
     IS DISTINCT FROM
     (OLD.event_id, OLD.run_id, OLD.source_id, OLD.raw_id, OLD.kind, OLD.series_ref, OLD.old, OLD.new, OLD.created_at) THEN
    RAISE EXCEPTION 'ops.drift_event: only status, decided_by, decided_on and note may be updated'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT CASE d.decision WHEN 'reopened' THEN 'open' ELSE d.decision END INTO latest
    FROM ops.drift_decision d
   WHERE d.event_id = OLD.event_id
   ORDER BY d.decision_id DESC LIMIT 1;
  IF latest IS NULL
     OR NOT EXISTS (SELECT 1 FROM ops.drift_decision d
                     WHERE d.event_id = OLD.event_id
                       AND d.xmin::text::bigint = pg_current_xact_id()::text::bigint % 4294967296) THEN
    RAISE EXCEPTION 'ops.drift_event % may be updated only with an ops.drift_decision insert in the same transaction', OLD.event_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM latest THEN
    RAISE EXCEPTION 'ops.drift_event.status must equal the latest decision (%)', latest
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$mm$;
CREATE TRIGGER drift_event_update BEFORE UPDATE ON ops.drift_event
  FOR EACH ROW EXECUTE FUNCTION ops.fn_drift_event_update();

-- ---------------------------------------------------------------------------------------
-- Carry-over foreign keys (T12, T13). ADD FOREIGN KEY only scans; no row is touched.
-- ---------------------------------------------------------------------------------------
ALTER TABLE ref.config_history
  ADD CONSTRAINT config_history_run_id_fkey FOREIGN KEY (run_id) REFERENCES ingest.run;
ALTER TABLE ingest.raw_series_status
  ADD CONSTRAINT raw_series_status_event_id_fkey FOREIGN KEY (event_id) REFERENCES ops.drift_event;
-- T11 carry-over: the precision_change match in ref.fn_series_published_decimals (kind, source_id,
-- series_ref, created_at = transaction_timestamp()) uses columns that exist in ops.drift_event with
-- compatible types; created_at DEFAULT now() equals transaction_timestamp(). No function change needed.
