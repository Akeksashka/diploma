-- Migration 0003: schemas `ingest` and `staging` (DDL spec sections 3 and 4, plan T13).
-- Forward-only: never edit this file once applied; the runner rejects a changed checksum.
-- Not here by design: roles and grants (T16; TRUNCATE is granted to nobody), ops.* tables (T14).
-- ingest.raw_series_status.event_id stays a plain bigint until ops.drift_event exists (T14).
CREATE SCHEMA IF NOT EXISTS ingest;
CREATE SCHEMA IF NOT EXISTS staging;

CREATE TABLE ingest.run (
  run_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gh_run_id     bigint,                      -- GitHub run id (NULL when local)
  gh_run_attempt smallint,
  workflow      text NOT NULL,
  trigger       text NOT NULL,               -- schedule | dispatch | push | local
  mode          text NOT NULL,               -- refresh | catchup | manual | preflight
  git_sha       text NOT NULL,               -- also the config version used by this run (rebuild input, B12)
  code_version  text NOT NULL,
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz,
  status        text NOT NULL CHECK (status IN ('running','ok','partial','failed'))
);   -- UPDATE (status, finished_at) by mm_ingest only

CREATE TABLE ingest.request_state (          -- survives ephemeral runners; a cache of fetch validators and of manifest/load pointers
  source_id     text NOT NULL REFERENCES ref.source,
  request_key   text NOT NULL,               -- canonical hash of method + URL + sorted params + body
  last_url      text NOT NULL,
  etag          text,
  last_modified text,
  update_marker text,                        -- e.g. Eurostat 'updated', OECD UpdatedAfter watermark
  last_sha256   text,                        -- sha256 of the LATEST ingest.raw_object of this request_key (fetch side; advances at manifest commit)
  last_loaded_sha256 text,                   -- fix 2: sha256 of the latest object of this request_key whose raw_load outcome is 'loaded'; advances ONLY in the load transaction
  last_loaded_raw_id bigint,                 -- same, as raw_id
  last_status   text,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  requests_this_hour integer, requests_this_day integer, counters_reset_at timestamptz,  -- budgets
  robots_sha256 text, robots_checked_at timestamptz,
  PRIMARY KEY (source_id, request_key)
);
-- Source of truth for load status is ingest.raw_load / v_raw_unloaded. The validators (etag, last_modified, update_marker) stored here
-- are those of the latest FETCHED object. Because a failed or held load leaves objects unloaded, the change-detection ladder never
-- decides "nothing to do" from last_sha256 alone: plan also selects every group with a non-empty v_raw_unloaded queue (ingestion spec section 6).

CREATE TABLE ingest.raw_blob (               -- stored bytes, deduplicated by content (A1)
  sha256          text PRIMARY KEY,           -- of uncompressed bytes
  byte_count      bigint NOT NULL,
  storage_backend text NOT NULL CHECK (storage_backend IN ('release_public','release_private','local_dir','none')),
                                              -- round 5: 'release_private' is INACTIVE (no private repository); 'none' = archive_mode hash_only (no bytes anywhere)
                                              -- Phase 2 amendment 2026-10-27 (plan OQ-04): 'local_dir' = the local-directory raw store of tests and development (ingestion spec section 4a);
                                              -- it never occurs in the production database (the production workflows set MM_ENV=production and the CLI refuses any other store, workflows spec AC-WF-16)
  storage_ref     text,                       -- release tag + asset name (+ member path inside archives); path relative to the store root for 'local_dir'; NULL when 'none'
  first_stored_at timestamptz NOT NULL
);

CREATE TABLE ingest.raw_object (             -- manifest: one row per observed CHANGE against the LATEST object of the request_key (A1)
  raw_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          bigint NOT NULL REFERENCES ingest.run,
  source_id       text NOT NULL REFERENCES ref.source,
  group_id        text NOT NULL,              -- series group (ordering and policy scope, fix 4)
  request_key     text NOT NULL,
  prev_raw_id     bigint REFERENCES ingest.raw_object,   -- latest object of this request_key when this row was written; NULL for the first
  request_url     text NOT NULL,              -- full URL as sent; credentials redacted/never in URL
  request_params  jsonb NOT NULL,
  http_status     smallint NOT NULL,
  etag            text, last_modified text,
  content_type    text,
  fetched_at      timestamptz NOT NULL,       -- becomes known_at of observations it introduces; runner clock corrected by the measured database-clock offset (BB25)
  sha256          text NOT NULL REFERENCES ingest.raw_blob,
  fetch_mode      text NOT NULL CHECK (fetch_mode IN ('full','incremental')),   -- fix 8
  fetch_scope     text NOT NULL CHECK (fetch_scope IN ('complete','partial')),  -- complete = full history for the requested series set
  manual          boolean NOT NULL DEFAULT false,
  edition_label   text,                       -- e.g. WEO-2026-10
  edition_date    date,                       -- round 5 (PROPOSED P22): publication date of the edition (sidecar); NOT NULL for objects of edition_ordered groups (loader/config check); drives the edition-order rule and the "latest edition" determination
  import_label    text CHECK (import_label IS NULL OR import_label = 'archive_import'),   -- round 5 (PROPOSED P22): sidecar label; rows load as load_kind 'import'
  robots_decision text, robots_checked_at timestamptz,
  parser_id       text NOT NULL,              -- module@version
  CONSTRAINT incremental_is_partial CHECK (fetch_mode = 'full' OR fetch_scope = 'partial'),   -- tombstones only from complete full-history fetches
  CONSTRAINT import_is_manual CHECK (import_label IS NULL OR manual),
  UNIQUE (source_id, request_key, fetched_at) -- NOT unique on sha256: A -> B -> A produces three rows and two blobs
);
CREATE INDEX raw_object_latest ON ingest.raw_object (source_id, request_key, fetched_at DESC);
CREATE INDEX raw_object_group ON ingest.raw_object (source_id, group_id, fetched_at, raw_id);

CREATE TABLE ingest.raw_snapshot (           -- fix 5: normalised full-vintage snapshot (Parquet) of an object of a snapshot_mode = 'diff_above_tol' group
  raw_id        bigint PRIMARY KEY REFERENCES ingest.raw_object,
  sha256        text NOT NULL,                -- of the Parquet bytes
  storage_ref   text NOT NULL,                -- asset in the same raw release as the object
  byte_count    bigint NOT NULL,
  row_count     bigint NOT NULL,
  parser_id     text NOT NULL                 -- the snapshot is a pure function of (raw bytes, parser_id, series_filter)
);

CREATE TABLE ingest.raw_load (               -- append-only load status; absence of a row = unloaded (A2, fix 2)
  raw_id          bigint PRIMARY KEY REFERENCES ingest.raw_object,
  outcome         text NOT NULL CHECK (outcome IN ('loaded','skipped_out_of_order','skipped_by_decision','rejected')),
  load_run_id     bigint NOT NULL REFERENCES ingest.run,
  loaded_at       timestamptz NOT NULL,         -- round 5: the same t_load = clock_timestamp() read after the load lock was acquired (I-CUR-9) as on the observation rows of this load
  rows_inserted   integer NOT NULL DEFAULT 0,
  rows_below_tol  integer NOT NULL DEFAULT 0,   -- fix 5: revised keys not stored because below tolerance (snapshot_mode = 'diff_above_tol')
  rows_tombstoned integer NOT NULL DEFAULT 0,
  detail          jsonb NOT NULL DEFAULT '{}'   -- applied comparison rule, revision_class counts, MISS row count, out-of-order reason (for example 'older_edition'), 'bytes_unavailable' (hash_only), decision id, for WEO objects the parsed estimates_start_after per entity; round 6: the revision check family chosen for the object (REV-01, REV-06 or REV-07) and its counts
);

CREATE TABLE ingest.raw_series_status (      -- append-only; series of a loaded object deferred by a drift event, later released (A2)
  raw_id          bigint NOT NULL REFERENCES ingest.raw_object,
  series_ref      text NOT NULL,              -- dataset_id + '|' + series_key
  status          text NOT NULL CHECK (status IN ('deferred','loaded','rejected','skipped_out_of_order')),   -- round 4: per-series out-of-order skip
  event_id        bigint,                     -- ops.drift_event that caused the deferral / decided it
  run_id          bigint NOT NULL REFERENCES ingest.run,
  recorded_at     timestamptz NOT NULL,
  PRIMARY KEY (raw_id, series_ref, status)
);
-- pending deferral = a 'deferred' row with no 'loaded' or 'rejected' row for the same (raw_id, series_ref).

CREATE VIEW ingest.v_raw_unloaded AS         -- the loader's work queue
  SELECT o.* FROM ingest.raw_object o LEFT JOIN ingest.raw_load l USING (raw_id) WHERE l.raw_id IS NULL;
CREATE VIEW ingest.v_series_deferred AS
  SELECT d.raw_id, d.series_ref, d.event_id FROM ingest.raw_series_status d
  WHERE d.status = 'deferred' AND NOT EXISTS (SELECT 1 FROM ingest.raw_series_status r
        WHERE r.raw_id = d.raw_id AND r.series_ref = d.series_ref AND r.status IN ('loaded','rejected'));

CREATE TABLE ingest.fetch_attempt (
  attempt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES ingest.run,
  source_id text NOT NULL, request_key text NOT NULL,
  attempted_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('new','unchanged','not_modified','skipped_robots','blocked','rate_limited','error')),
  http_status smallint, duration_ms integer, bytes bigint,
  raw_id bigint REFERENCES ingest.raw_object,   -- the object (new, or the latest existing one when unchanged)
  error_class text, error_detail text
);

CREATE TABLE staging.observation_load (
  run_id          bigint NOT NULL,       -- run that staged the rows (fetch leg); never shared between runs
  raw_id          bigint NOT NULL,
  series_ref      text NOT NULL,        -- dataset_id + '|' + series_key (resolved to series_id at validate)
  ref_period_start date NOT NULL,
  ref_period_end   date NOT NULL,
  value           numeric,
  value_status    text NOT NULL,         -- OBS | EST | PROV | PROJ | MISS (parsers never stage DEL); MISS has value NULL and the marker in source_flags
  source_release_at timestamptz,
  vintage_label   text,
  source_flags    text,
  row_hash        text NOT NULL,
  staged_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staging_obs_raw ON staging.observation_load (raw_id);
CREATE TABLE staging.series_meta_load (  -- one row per series seen in a raw object, with its published metadata
  run_id bigint NOT NULL, raw_id bigint NOT NULL, series_ref text NOT NULL,
  entity_code text, frequency text, unit_code text, unit_mult smallint, base_period text,
  price_basis text, currency_code text, seasonal_adjustment text, calendar_basis text, flow_basis text, title text, published_decimals smallint
);
CREATE TABLE staging.rejected (
  run_id bigint NOT NULL, raw_id bigint NOT NULL, series_ref text, ref_period text, raw_value text,
  reason_code text NOT NULL, detail text, rejected_at timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------------------
-- Guards (I-ING-1, I-ING-2, I-ING-3, I-ING-6, S-2)
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION ingest.fn_append_only() RETURNS trigger LANGUAGE plpgsql AS $mm$
BEGIN
  RAISE EXCEPTION '%.% is append-only (I-ING-1): % refused', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$mm$;

CREATE FUNCTION ingest.fn_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $mm$
BEGIN
  RAISE EXCEPTION 'TRUNCATE of %.% is not allowed (S-2)', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$mm$;

CREATE TRIGGER raw_blob_append_only BEFORE UPDATE OR DELETE ON ingest.raw_blob
  FOR EACH ROW EXECUTE FUNCTION ingest.fn_append_only();
CREATE TRIGGER raw_object_append_only BEFORE UPDATE OR DELETE ON ingest.raw_object
  FOR EACH ROW EXECUTE FUNCTION ingest.fn_append_only();
CREATE TRIGGER raw_snapshot_append_only BEFORE UPDATE OR DELETE ON ingest.raw_snapshot
  FOR EACH ROW EXECUTE FUNCTION ingest.fn_append_only();
CREATE TRIGGER raw_load_append_only BEFORE UPDATE OR DELETE ON ingest.raw_load
  FOR EACH ROW EXECUTE FUNCTION ingest.fn_append_only();
CREATE TRIGGER raw_series_status_append_only BEFORE UPDATE OR DELETE ON ingest.raw_series_status
  FOR EACH ROW EXECUTE FUNCTION ingest.fn_append_only();
CREATE TRIGGER fetch_attempt_append_only BEFORE UPDATE OR DELETE ON ingest.fetch_attempt
  FOR EACH ROW EXECUTE FUNCTION ingest.fn_append_only();

-- ingest.run: only status and finished_at may change; rows are never deleted.
CREATE FUNCTION ingest.fn_run_guard() RETURNS trigger LANGUAGE plpgsql AS $mm$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ingest.run rows are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'finished_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'finished_at') THEN
    RAISE EXCEPTION 'ingest.run: only status and finished_at may be updated (run_id %)', OLD.run_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$mm$;
CREATE TRIGGER run_guard BEFORE UPDATE OR DELETE ON ingest.run
  FOR EACH ROW EXECUTE FUNCTION ingest.fn_run_guard();

-- No TRUNCATE path on any ingest table or staging table (S-2).
CREATE TRIGGER run_no_truncate BEFORE TRUNCATE ON ingest.run
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER request_state_no_truncate BEFORE TRUNCATE ON ingest.request_state
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER raw_blob_no_truncate BEFORE TRUNCATE ON ingest.raw_blob
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER raw_object_no_truncate BEFORE TRUNCATE ON ingest.raw_object
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER raw_snapshot_no_truncate BEFORE TRUNCATE ON ingest.raw_snapshot
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER raw_load_no_truncate BEFORE TRUNCATE ON ingest.raw_load
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER raw_series_status_no_truncate BEFORE TRUNCATE ON ingest.raw_series_status
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER fetch_attempt_no_truncate BEFORE TRUNCATE ON ingest.fetch_attempt
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER observation_load_no_truncate BEFORE TRUNCATE ON staging.observation_load
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER series_meta_load_no_truncate BEFORE TRUNCATE ON staging.series_meta_load
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();
CREATE TRIGGER rejected_no_truncate BEFORE TRUNCATE ON staging.rejected
  FOR EACH STATEMENT EXECUTE FUNCTION ingest.fn_no_truncate();

-- I-ING-2 / I-ING-3: the manifest is a chain per (source_id, request_key). prev_raw_id must be the latest
-- object (by fetched_at, raw_id) of the key, fetched_at must advance, and the sha256 must differ from the
-- latest object's. Equality with an older object is irrelevant (A -> B -> A is three rows). Exception: the
-- latest object belongs to a hash_only source and was rejected as bytes_unavailable; then an identical
-- sha256 is accepted (once: the new row becomes the latest). The per-key advisory lock serialises
-- concurrent inserts for the same key.
CREATE FUNCTION ingest.fn_raw_object_chain() RETURNS trigger LANGUAGE plpgsql AS $mm$
DECLARE
  last_id      bigint;
  last_sha     text;
  last_fetched timestamptz;
  mode         text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ingest.raw_object|' || NEW.source_id || '|' || NEW.request_key, 0));
  SELECT o.raw_id, o.sha256, o.fetched_at INTO last_id, last_sha, last_fetched
    FROM ingest.raw_object o
   WHERE o.source_id = NEW.source_id AND o.request_key = NEW.request_key
   ORDER BY o.fetched_at DESC, o.raw_id DESC LIMIT 1;
  IF NEW.prev_raw_id IS DISTINCT FROM last_id THEN
    RAISE EXCEPTION 'raw_object.prev_raw_id must be the latest object of the request key (I-ING-3): expected %, got %',
      last_id, NEW.prev_raw_id USING ERRCODE = 'check_violation';
  END IF;
  IF last_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.fetched_at <= last_fetched THEN
    RAISE EXCEPTION 'raw_object.fetched_at must be later than that of the latest object of the request key (I-ING-3)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sha256 = last_sha THEN
    SELECT s.archive_mode INTO mode FROM ref.source s WHERE s.source_id = NEW.source_id;
    IF mode = 'hash_only' AND EXISTS (
         SELECT 1 FROM ingest.raw_load l
          WHERE l.raw_id = last_id AND l.outcome = 'rejected' AND l.detail ->> 'reason' = 'bytes_unavailable') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'raw_object.sha256 equals that of the latest object of the request key (I-ING-2)'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END
$mm$;
CREATE TRIGGER raw_object_chain BEFORE INSERT ON ingest.raw_object
  FOR EACH ROW EXECUTE FUNCTION ingest.fn_raw_object_chain();

-- I-ING-6: request_state.last_loaded_* may change only to the object of a 'loaded' raw_load row written in
-- the same transaction (xmin = current transaction id) for the same (source_id, request_key) and sha256.
CREATE FUNCTION ingest.fn_request_state_loaded() RETURNS trigger LANGUAGE plpgsql AS $mm$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.last_loaded_sha256 IS NOT DISTINCT FROM OLD.last_loaded_sha256
     AND NEW.last_loaded_raw_id IS NOT DISTINCT FROM OLD.last_loaded_raw_id THEN
    RETURN NEW;
  END IF;
  IF NEW.last_loaded_sha256 IS NULL AND NEW.last_loaded_raw_id IS NULL THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'request_state.last_loaded_* cannot be cleared (I-ING-6)' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
       SELECT 1
         FROM ingest.raw_load l
         JOIN ingest.raw_object o USING (raw_id)
        WHERE l.raw_id = NEW.last_loaded_raw_id
          AND l.outcome = 'loaded'
          AND o.source_id = NEW.source_id AND o.request_key = NEW.request_key
          AND o.sha256 = NEW.last_loaded_sha256
          AND l.xmin::text::bigint = pg_current_xact_id()::text::bigint % 4294967296) THEN
    RAISE EXCEPTION 'request_state.last_loaded_* may change only with a raw_load row of outcome loaded in the same transaction (I-ING-6)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$mm$;
CREATE TRIGGER request_state_loaded BEFORE INSERT OR UPDATE ON ingest.request_state
  FOR EACH ROW EXECUTE FUNCTION ingest.fn_request_state_loaded();

CREATE INDEX staging_meta_raw ON staging.series_meta_load (raw_id);
CREATE INDEX staging_rejected_raw ON staging.rejected (raw_id);
