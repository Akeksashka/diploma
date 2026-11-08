-- Migration 0002: ref.config_history, its feeder triggers and ref.fn_config_asof (DDL spec section 2, plan T12).
-- Forward-only: never edit this file once applied; the runner rejects a changed checksum.
-- Not here by design: roles and grants (T16). The feeder function is SECURITY DEFINER and is owned by the
-- migrating role (mm_owner in production), so a role with only DML on ref.* cannot bypass the history.
-- run_id has no foreign key yet: ingest.run is created by a later migration (T13), which adds the constraint.
CREATE SCHEMA IF NOT EXISTS ref;

CREATE TABLE ref.config_history (
  history_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name   text NOT NULL CHECK (table_name IN ('series_map','indicator','indicator_input','indicator_target','indicator_domain',
                                                    'entity_group_member','inheritance_rule','series_group','global_translation',
                                                    'domain','entity','source')),
  row_key      jsonb NOT NULL,
  row_data     jsonb,
  op           text NOT NULL CHECK (op IN ('insert','update','delete')),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  run_id       bigint,
  git_sha      text NOT NULL
);
CREATE INDEX config_history_key ON ref.config_history (table_name, recorded_at);

-- Append-only guard: no UPDATE, DELETE or TRUNCATE for any role.
CREATE FUNCTION ref.fn_config_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $mm$
BEGIN
  RAISE EXCEPTION 'ref.config_history is append-only (% rejected)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$mm$;

CREATE TRIGGER config_history_no_update_delete BEFORE UPDATE OR DELETE ON ref.config_history
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_append_only();
CREATE TRIGGER config_history_no_truncate BEFORE TRUNCATE ON ref.config_history
  FOR EACH STATEMENT EXECUTE FUNCTION ref.fn_config_history_append_only();

-- Feeder: one history row per changed row. TG_ARGV carries the primary-key column names of the watched table.
-- The sync-config run sets the session settings mm.run_id (optional) and mm.git_sha (default 'unknown').
CREATE FUNCTION ref.fn_config_history_feed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $mm$
DECLARE
  v_row   jsonb;
  v_key   jsonb;
  v_run   bigint;
  v_sha   text;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NULL;
  END IF;
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  SELECT jsonb_object_agg(k, v_row -> k) INTO v_key FROM unnest(TG_ARGV) AS k;
  v_run := nullif(current_setting('mm.run_id', true), '')::bigint;
  v_sha := coalesce(nullif(current_setting('mm.git_sha', true), ''), 'unknown');
  INSERT INTO ref.config_history (table_name, row_key, row_data, op, run_id, git_sha)
  VALUES (TG_TABLE_NAME, v_key,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_row END,
          lower(TG_OP), v_run, v_sha);
  RETURN NULL;
END
$mm$;
REVOKE ALL ON FUNCTION ref.fn_config_history_feed() FROM PUBLIC;

CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.series_map
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('indicator_id','entity_id','series_id','role','valid_from');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.indicator
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('indicator_id');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.indicator_input
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('indicator_id','input_id','usage');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.indicator_target
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('indicator_id','entity_id','valid_from');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.indicator_domain
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('indicator_id','domain_id');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.entity_group_member
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('group_id','entity_id','valid_from');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.inheritance_rule
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('indicator_id','entity_id','valid_from');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.series_group
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('source_id','group_id');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.global_translation
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('indicator_id','entity_id','valid_from');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.domain
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('domain_id');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.entity
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('entity_id');
CREATE TRIGGER config_history_feed AFTER INSERT OR UPDATE OR DELETE ON ref.source
  FOR EACH ROW EXECUTE FUNCTION ref.fn_config_history_feed('source_id');

-- Reconstruction rule: per (table_name, row_key) the history row with the greatest recorded_at <= p_asof
-- (history_id breaks ties inside one transaction), dropped when op = 'delete'.
CREATE FUNCTION ref.fn_config_asof(p_table text, p_asof timestamptz)
RETURNS TABLE (row_key jsonb, row_data jsonb, recorded_at timestamptz, history_id bigint)
LANGUAGE sql STABLE AS $mm$
  SELECT l.row_key, l.row_data, l.recorded_at, l.history_id
  FROM (
    SELECT DISTINCT ON (h.row_key) h.row_key, h.row_data, h.op, h.recorded_at, h.history_id
    FROM ref.config_history h
    WHERE h.table_name = p_table AND h.recorded_at <= p_asof
    ORDER BY h.row_key, h.recorded_at DESC, h.history_id DESC
  ) l
  WHERE l.op <> 'delete'
$mm$;
