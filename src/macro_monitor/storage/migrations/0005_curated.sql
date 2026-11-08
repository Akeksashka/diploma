-- Migration 0005: schema `curated` (DDL spec section 5, plan T15).
-- Forward-only: never edit this file once applied; the runner rejects a changed checksum.
-- Not here by design: roles and grants (T16; REVOKE UPDATE/DELETE/TRUNCATE is a grant matter, the
-- trigger below binds every role including the owner), ops.* tables (T14).
-- Beyond the literal spec text: the guard trigger enforces I-CUR-4(a) (known_at equals the raw
-- object's fetched_at and strictly increases per key) and I-CUR-6 (period bounds vs frequency).
CREATE SCHEMA IF NOT EXISTS curated;

CREATE TABLE curated.observation (
  obs_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id         integer NOT NULL REFERENCES ref.series,
  ref_period_start  date    NOT NULL,
  ref_period_end    date    NOT NULL,
  value             numeric,
  value_status      text    NOT NULL CHECK (value_status IN ('OBS','EST','PROV','PROJ','DEL','MISS')),   -- DEL = our tombstone; MISS = the source publishes the period as missing
  is_projection     boolean GENERATED ALWAYS AS (value_status = 'PROJ') STORED,
  quality_flag      text    NOT NULL DEFAULT 'ok' CHECK (quality_flag IN ('ok','suspect')),
  load_kind         text    NOT NULL CHECK (load_kind IN ('initial','new_period','revision','tombstone','import')),
  revision_class    text    NOT NULL DEFAULT 'regular' CHECK (revision_class IN ('regular','reestimation')),
  known_at          timestamptz NOT NULL,       -- = ingest.raw_object.fetched_at
  loaded_at         timestamptz NOT NULL,       -- clock_timestamp() read once under the load lock (I-CUR-9); never updated
  source_release_at timestamptz,
  vintage_label     text,
  source_flags      text,
  raw_id            bigint  NOT NULL REFERENCES ingest.raw_object,
  run_id            bigint  NOT NULL REFERENCES ingest.run,
  CONSTRAINT obs_value_presence CHECK ((value_status IN ('DEL','MISS')) = (value IS NULL)),
  CONSTRAINT obs_period_order  CHECK (ref_period_end >= ref_period_start),
  CONSTRAINT obs_known_not_future CHECK (known_at <= now() + interval '1 hour'),   -- backstop for gross clock errors only (BB25)
  UNIQUE (series_id, ref_period_start, known_at)
);
CREATE INDEX obs_raw ON curated.observation (raw_id);
CREATE INDEX obs_loaded_brin ON curated.observation USING brin (loaded_at);

-- ---------------------------------------------------------------------------------------
-- Guards: append-only (I-CUR-1), known_at / ordering (I-CUR-4a), period bounds (I-CUR-6)
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION curated.fn_observation_append_only() RETURNS trigger LANGUAGE plpgsql AS $mm$
BEGIN
  RAISE EXCEPTION 'curated.observation is append-only (I-CUR-1): % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$mm$;

CREATE TRIGGER observation_append_only BEFORE UPDATE OR DELETE ON curated.observation
  FOR EACH ROW EXECUTE FUNCTION curated.fn_observation_append_only();
CREATE TRIGGER observation_no_truncate BEFORE TRUNCATE ON curated.observation
  FOR EACH STATEMENT EXECUTE FUNCTION curated.fn_observation_append_only();

CREATE FUNCTION curated.fn_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $mm$
DECLARE
  fetched timestamptz;
  freq    text;
  basis   text;
  s       date := NEW.ref_period_start;
  e       date := NEW.ref_period_end;
  ok      boolean;
BEGIN
  SELECT fetched_at INTO fetched FROM ingest.raw_object WHERE raw_id = NEW.raw_id;
  IF fetched IS DISTINCT FROM NEW.known_at THEN
    RAISE EXCEPTION 'known_at % differs from fetched_at % of raw object % (I-CUR-4a)',
      NEW.known_at, fetched, NEW.raw_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.load_kind <> 'import' AND EXISTS (
       SELECT 1 FROM curated.observation o
       WHERE o.series_id = NEW.series_id AND o.ref_period_start = NEW.ref_period_start
         AND o.load_kind <> 'import' AND o.known_at >= NEW.known_at) THEN
    RAISE EXCEPTION 'known_at must increase per key (series %, period %) (I-CUR-4a)',
      NEW.series_id, NEW.ref_period_start USING ERRCODE = 'check_violation';
  END IF;
  SELECT frequency, calendar_basis INTO freq, basis FROM ref.series WHERE series_id = NEW.series_id;
  IF basis = 'CAL' THEN
    ok := CASE freq
      WHEN 'D' THEN e = s
      WHEN 'M' THEN s = date_trunc('month', s)::date AND e = (s + interval '1 month')::date - 1
      WHEN 'Q' THEN s = date_trunc('quarter', s)::date AND e = (s + interval '3 months')::date - 1
      WHEN 'A' THEN s = date_trunc('year', s)::date AND e = (s + interval '1 year')::date - 1
    END;
  ELSIF freq = 'A' THEN
    ok := (e - s + 1) BETWEEN 364 AND 366;
  ELSE
    ok := true;
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'period % .. % does not fit frequency % / basis % (I-CUR-6)', s, e, freq, basis
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$mm$;

CREATE TRIGGER observation_guard BEFORE INSERT ON curated.observation
  FOR EACH ROW EXECUTE FUNCTION curated.fn_observation_guard();

-- ---------------------------------------------------------------------------------------
-- Read contract
-- ---------------------------------------------------------------------------------------
CREATE VIEW curated.v_observation_latest AS
SELECT l.* FROM (
  SELECT DISTINCT ON (o.series_id, o.ref_period_start) o.*
  FROM curated.observation o
  WHERE o.load_kind <> 'import'
  ORDER BY o.series_id, o.ref_period_start, o.known_at DESC
) l
WHERE l.value_status <> 'DEL';

CREATE FUNCTION curated.fn_observation_asof(
  known_cutoff timestamptz, load_cutoff timestamptz DEFAULT NULL
) RETURNS SETOF curated.observation LANGUAGE sql STABLE AS $mm$
  SELECT l.* FROM (
    SELECT DISTINCT ON (o.series_id, o.ref_period_start) o.*
    FROM curated.observation o
    WHERE o.load_kind <> 'import'
      AND o.known_at <= known_cutoff
      AND (load_cutoff IS NULL OR o.loaded_at <= load_cutoff)
    ORDER BY o.series_id, o.ref_period_start, o.known_at DESC
  ) l
  WHERE l.value_status <> 'DEL'
$mm$;

CREATE VIEW curated.v_series_obs AS
SELECT l.*, s.source_id, s.series_key, s.frequency, s.unit_code, s.unit_mult, s.base_period,
       s.price_basis, s.seasonal_adjustment, s.calendar_basis, s.flow_basis
FROM curated.v_observation_latest l
JOIN ref.series s ON s.series_id = l.series_id
JOIN ref.source src ON src.source_id = s.source_id;

CREATE VIEW curated.v_headline_obs AS
SELECT v.*, m.indicator_id, m.entity_id
FROM curated.v_series_obs v
JOIN ref.series_map m ON m.series_id = v.series_id AND m.role = 'headline'
 AND v.ref_period_start >= m.valid_from AND (m.valid_to IS NULL OR v.ref_period_start <= m.valid_to);

CREATE VIEW curated.v_headline_obs_observed AS
SELECT * FROM curated.v_headline_obs WHERE value_status <> 'PROJ';

CREATE VIEW curated.v_comparison_obs AS
SELECT v.*, m.indicator_id, m.entity_id
FROM curated.v_series_obs v
JOIN ref.series_map m ON m.series_id = v.series_id AND m.role = 'comparison'
 AND v.ref_period_start >= m.valid_from AND (m.valid_to IS NULL OR v.ref_period_start <= m.valid_to);

CREATE VIEW curated.v_headline_obs_published AS
SELECT h.* FROM curated.v_headline_obs_observed h
JOIN ref.indicator i ON i.indicator_id = h.indicator_id AND i.kind = 'indicator'
JOIN ref.source src ON src.source_id = h.source_id AND src.publish_site = 'public';

CREATE VIEW curated.v_input_obs_published AS
SELECT h.* FROM curated.v_headline_obs_observed h
JOIN ref.indicator i ON i.indicator_id = h.indicator_id AND i.kind = 'input'
JOIN ref.source src ON src.source_id = h.source_id AND src.publish_site = 'public';

-- I-CUR-11: projection versions are removed BEFORE counting and ordering versions.
CREATE VIEW curated.v_revision_history AS
WITH v AS (
  SELECT o.series_id, m.entity_id, m.indicator_id, o.ref_period_start, o.ref_period_end,
         o.known_at, o.source_release_at, o.vintage_label, o.value, o.value_status,
         o.load_kind, o.revision_class, g.edition_ordered
  FROM curated.observation o
  JOIN ref.series s ON s.series_id = o.series_id
  JOIN ref.source src ON src.source_id = s.source_id AND src.publish_site = 'public'
  JOIN ref.series_group g ON g.source_id = s.source_id AND g.group_id = s.group_id
  JOIN ref.series_map m ON m.series_id = o.series_id AND m.role = 'headline'
   AND o.ref_period_start >= m.valid_from AND (m.valid_to IS NULL OR o.ref_period_start <= m.valid_to)
  JOIN ref.indicator i ON i.indicator_id = m.indicator_id AND i.kind = 'indicator'
  WHERE o.load_kind <> 'import' AND NOT o.is_projection
), c AS (
  SELECT v.*,
         count(*)     OVER w AS n_versions,
         row_number() OVER (w ORDER BY v.known_at) AS rn
  FROM v
  WINDOW w AS (PARTITION BY v.series_id, v.indicator_id, v.entity_id, v.ref_period_start)
)
SELECT series_id, entity_id, indicator_id, ref_period_start, ref_period_end, known_at,
       source_release_at, vintage_label, value, value_status, load_kind, revision_class,
       edition_ordered, (rn = 1) AS is_base_version
FROM c WHERE n_versions >= 2;

CREATE VIEW curated.v_observation_public AS
SELECT o.* FROM curated.observation o
JOIN ref.series s ON s.series_id = o.series_id
JOIN ref.source src ON src.source_id = s.source_id
 AND src.archive_mode = 'public' AND src.publish_site = 'public';
