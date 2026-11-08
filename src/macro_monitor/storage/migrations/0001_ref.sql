-- Migration 0001: schema `ref` (DDL spec section 2, plan T11).
-- Forward-only: never edit this file once applied; the runner rejects a changed checksum.
-- Not here by design: roles and grants (T16), ref.config_history and its triggers (T12),
-- ops.drift_event (T14; referenced lazily below), the WLD seed (sync-config).
CREATE SCHEMA IF NOT EXISTS ref;

CREATE TABLE ref.source (
  source_id        text PRIMARY KEY,
  provider         text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('sdmx','rest','bulk','web','manual')),
  archive_mode     text NOT NULL CHECK (archive_mode IN ('public','private','hash_only')),
  publish_site     text NOT NULL CHECK (publish_site IN ('public','withheld')),
  licence_id       text NOT NULL,
  attribution      text NOT NULL,
  config_sha256    text NOT NULL,
  enabled          boolean NOT NULL
);

CREATE TABLE ref.series_group (
  source_id        text NOT NULL REFERENCES ref.source,
  group_id         text NOT NULL,
  reestimating     boolean NOT NULL DEFAULT false,
  compare_mode     text NOT NULL DEFAULT 'published_decimals' CHECK (compare_mode IN ('published_decimals','fixed_decimals')),
  fixed_decimals   smallint,
  rel_epsilon      numeric NOT NULL DEFAULT 1e-9,
  materiality_abs  numeric NOT NULL DEFAULT 0,
  materiality_rel  numeric NOT NULL DEFAULT 0,
  snapshot_mode    text NOT NULL DEFAULT 'none' CHECK (snapshot_mode IN ('none','diff_above_tol')),
  max_revised_rows integer,
  edition_ordered  boolean NOT NULL DEFAULT false,
  config_sha256    text NOT NULL,
  PRIMARY KEY (source_id, group_id),
  CHECK (NOT (edition_ordered AND reestimating)),
  CHECK (snapshot_mode = 'none' OR reestimating),
  CHECK (compare_mode <> 'fixed_decimals' OR fixed_decimals IS NOT NULL)
);

CREATE TABLE ref.entity (
  entity_id   text PRIMARY KEY,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('country','aggregate')),
  is_ranked   boolean NOT NULL,
  is_global   boolean NOT NULL DEFAULT false,
  CHECK (kind = 'country' OR NOT is_ranked),
  CHECK (NOT is_global OR kind = 'aggregate')
);

CREATE TABLE ref.entity_group_member (
  group_id   text NOT NULL,
  entity_id  text NOT NULL REFERENCES ref.entity,
  valid_from date NOT NULL,
  valid_to   date,
  PRIMARY KEY (group_id, entity_id, valid_from)
);

CREATE TABLE ref.unit (
  unit_code   text PRIMARY KEY,
  dimension   text NOT NULL,
  description text NOT NULL
);

CREATE TABLE ref.domain (
  domain_id              text PRIMARY KEY,
  name                   text NOT NULL,
  is_ranked              boolean NOT NULL,
  min_coverage_for_rank  numeric NOT NULL DEFAULT 0.5 CHECK (min_coverage_for_rank BETWEEN 0 AND 1),
  notice                 text
);

CREATE TABLE ref.indicator (
  indicator_id    text PRIMARY KEY,
  name            text NOT NULL,
  kind            text NOT NULL DEFAULT 'indicator' CHECK (kind IN ('indicator','input')),
  is_support      boolean GENERATED ALWAYS AS (kind = 'input') STORED,
  scope           text NOT NULL DEFAULT 'country' CHECK (scope IN ('country','global')),
  tier            text NOT NULL CHECK (tier IN ('M','Q','A')),
  priority        text NOT NULL CHECK (priority IN ('core','ext','opt','dropped')),
  currency_basis  text NOT NULL CHECK (currency_basis IN ('B1','B2','B3','NA')),
  staleness_class text NOT NULL CHECK (staleness_class IN
                  ('MKT45','SURV75','ACT120','Q270','A730','TRI1460','EVENT')),
  transform_id    text NOT NULL,
  sa_required     boolean NOT NULL DEFAULT false,
  alert_method    text NOT NULL CHECK (alert_method IN ('z','robust_z','percentile','fixed_only','none')),
  adverse_dir     smallint NOT NULL CHECK (adverse_dir IN (-1,0,1)),
  good_dir        smallint NOT NULL CHECK (good_dir IN (-1,0,1)),
  display_dir     smallint CHECK (display_dir IN (-1,0,1)),
  rank_mode       text NOT NULL CHECK (rank_mode IN ('monotone_good','target_distance','descriptive_only')),
  max_ref_spread_days integer CHECK (max_ref_spread_days >= 0),
  stationarity_class text NOT NULL CHECK (stationarity_class IN ('stationary','trending_level','rate_of_change')),
  release_lag_aware boolean NOT NULL,
  alert_override  jsonb,
  params          jsonb NOT NULL DEFAULT '{}',
  is_comparison   boolean NOT NULL DEFAULT false,
  concept_id      text,
  concept_priority smallint,
  CONSTRAINT rank_mode_dir CHECK (
    (rank_mode = 'monotone_good' AND good_dir <> 0) OR (rank_mode IN ('target_distance','descriptive_only') AND good_dir = 0)),
  CONSTRAINT input_not_ranked CHECK (kind = 'indicator' OR (rank_mode = 'descriptive_only' AND alert_method = 'none' AND NOT is_comparison)),
  CONSTRAINT global_not_ranked CHECK (scope = 'country' OR rank_mode = 'descriptive_only')
);

CREATE TABLE ref.indicator_target (
  indicator_id text NOT NULL REFERENCES ref.indicator,
  entity_id    text NOT NULL REFERENCES ref.entity,
  target_value numeric NOT NULL,
  band_low     numeric, band_high numeric,
  source_note  text NOT NULL,
  valid_from   date NOT NULL, valid_to date,
  PRIMARY KEY (indicator_id, entity_id, valid_from)
);

CREATE TABLE ref.indicator_input (
  indicator_id text NOT NULL REFERENCES ref.indicator,
  input_id     text NOT NULL REFERENCES ref.indicator,
  usage        text NOT NULL,
  currency_match text NOT NULL CHECK (currency_match IN ('numerator','lcu','usd')),
  annualised_policy text NOT NULL DEFAULT 'fail' CHECK (annualised_policy = 'fail'),
  PRIMARY KEY (indicator_id, input_id, usage)
);

CREATE TABLE ref.indicator_domain (
  indicator_id text NOT NULL REFERENCES ref.indicator,
  domain_id    text NOT NULL REFERENCES ref.domain,
  is_ranked    boolean NOT NULL,
  PRIMARY KEY (indicator_id, domain_id)
);

CREATE TABLE ref.global_translation (
  indicator_id   text NOT NULL REFERENCES ref.indicator,
  entity_id      text NOT NULL REFERENCES ref.entity,
  method         text NOT NULL CHECK (method IN ('same_value','weighted_by_input','excluded')),
  weight_input_id text REFERENCES ref.indicator,
  rationale      text NOT NULL,
  valid_from     date NOT NULL DEFAULT '1991-01-01', valid_to date,
  PRIMARY KEY (indicator_id, entity_id, valid_from),
  CHECK (method <> 'weighted_by_input' OR weight_input_id IS NOT NULL)
);

CREATE TABLE ref.series (
  series_id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id            text NOT NULL REFERENCES ref.source,
  group_id             text NOT NULL,
  dataset_id           text NOT NULL,
  series_key           text NOT NULL,
  version              smallint NOT NULL DEFAULT 1,
  supersedes_series_id integer REFERENCES ref.series,
  entity_id            text NOT NULL REFERENCES ref.entity,
  title                text NOT NULL,
  frequency            text NOT NULL CHECK (frequency IN ('D','M','Q','A')),
  unit_code            text NOT NULL REFERENCES ref.unit,
  unit_mult            smallint NOT NULL DEFAULT 0,
  base_period          text,
  price_basis          text NOT NULL CHECK (price_basis IN ('NOM','REAL','IDX','RATIO','NA')),
  currency_code        text,
  seasonal_adjustment  text NOT NULL CHECK (seasonal_adjustment IN ('SA','NSA','SCA','CA','NA')),
  calendar_basis       text NOT NULL DEFAULT 'CAL' CHECK (calendar_basis IN ('CAL','FISCAL','MKTYR')),
  flow_basis           text NOT NULL DEFAULT 'NA' CHECK (flow_basis IN ('PERIOD_FLOW','ANNUALISED_RATE','STOCK','NA')),
  composition          text NOT NULL DEFAULT 'NA' CHECK (composition IN ('FIXED','CHANGING','NA')),
  published_decimals   smallint,
  definition_note      text,
  is_active            boolean NOT NULL DEFAULT true,
  first_seen_at        timestamptz NOT NULL,
  FOREIGN KEY (source_id, group_id) REFERENCES ref.series_group,
  UNIQUE (source_id, dataset_id, series_key, version)
);

CREATE TABLE ref.series_map (
  indicator_id text NOT NULL REFERENCES ref.indicator,
  entity_id    text NOT NULL REFERENCES ref.entity,
  series_id    integer NOT NULL REFERENCES ref.series,
  role         text NOT NULL CHECK (role IN ('headline','fallback','comparison')),
  valid_from   date NOT NULL DEFAULT '1991-01-01',
  valid_to     date,
  splice_note  text,
  rationale    text NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (indicator_id, entity_id, series_id, role, valid_from)
);

CREATE TABLE ref.inheritance_rule (
  indicator_id text NOT NULL, entity_id text NOT NULL, source_entity_id text NOT NULL,
  valid_from date NOT NULL, valid_to date,
  PRIMARY KEY (indicator_id, entity_id, valid_from)
);

-- One headline per (indicator, entity) in any validity window (T-DDL-4).
-- Flag `mm.headline_exclusion` (session setting, read once by this migration):
--   'gist' (default)  EXCLUDE USING gist; needs the btree_gist extension (CREATE EXTENSION).
--   'loader'          fallback when btree_gist is unavailable on the host (BB2, AC-OPS-7): no constraint is
--                     created and the loader/sync-config must enforce the rule (spec T-DDL-4 "or loader test").
-- Example: PGOPTIONS="-c mm.headline_exclusion=loader" when running the migration.
DO $mm$
DECLARE
  mode text := coalesce(nullif(current_setting('mm.headline_exclusion', true), ''), 'gist');
BEGIN
  IF mode = 'gist' THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    ALTER TABLE ref.series_map ADD CONSTRAINT series_map_one_headline
      EXCLUDE USING gist (indicator_id WITH =, entity_id WITH =, daterange(valid_from, valid_to) WITH &&)
      WHERE (role = 'headline');
  ELSIF mode = 'loader' THEN
    RAISE NOTICE 'mm.headline_exclusion=loader: one-headline rule is NOT enforced by the database';
  ELSE
    RAISE EXCEPTION 'mm.headline_exclusion must be gist or loader, got %', mode;
  END IF;
END
$mm$;

-- Unit seed (dimension: ratio | index | currency | count | other).
INSERT INTO ref.unit (unit_code, dimension, description) VALUES
  ('PCT', 'ratio', 'Percent'),
  ('PCT_GDP', 'ratio', 'Percent of GDP'),
  ('IDX', 'index', 'Index number (base period in ref.series.base_period)'),
  ('USD', 'currency', 'US dollars'),
  ('EUR', 'currency', 'Euro'),
  ('LCU', 'currency', 'Local currency units'),
  ('INTL_USD_PPP', 'currency', 'International dollars at purchasing power parity'),
  ('MONTHS', 'count', 'Months'),
  ('BALANCE', 'other', 'Balance of opinion (net percentage points)');

-- indicator_domain rules (spec s2 note): no input indicator; is_ranked implies a ranked domain and a ranked rank_mode.
CREATE FUNCTION ref.fn_check_indicator_domain() RETURNS trigger LANGUAGE plpgsql AS $mm$
DECLARE
  ind ref.indicator%ROWTYPE;
  dom_ranked boolean;
BEGIN
  SELECT * INTO ind FROM ref.indicator WHERE indicator_id = NEW.indicator_id;
  IF ind.kind = 'input' THEN
    RAISE EXCEPTION 'indicator % is an input (support) indicator and cannot have a domain row', NEW.indicator_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.is_ranked THEN
    SELECT is_ranked INTO dom_ranked FROM ref.domain WHERE domain_id = NEW.domain_id;
    IF NOT coalesce(dom_ranked, false) OR ind.rank_mode = 'descriptive_only' THEN
      RAISE EXCEPTION 'indicator_domain (%, %): is_ranked needs a ranked domain and rank_mode <> descriptive_only',
        NEW.indicator_id, NEW.domain_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$mm$;
CREATE TRIGGER indicator_domain_rules BEFORE INSERT OR UPDATE ON ref.indicator_domain
  FOR EACH ROW EXECUTE FUNCTION ref.fn_check_indicator_domain();

-- indicator_input.input_id and global_translation.weight_input_id must name input indicators.
CREATE FUNCTION ref.fn_check_input_kind() RETURNS trigger LANGUAGE plpgsql AS $mm$
DECLARE
  ref_id text;
BEGIN
  IF TG_TABLE_NAME = 'indicator_input' THEN
    ref_id := NEW.input_id;
  ELSE
    ref_id := NEW.weight_input_id;
  END IF;
  IF ref_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ref.indicator WHERE indicator_id = ref_id AND kind = 'input') THEN
    RAISE EXCEPTION '% is not an input (support) indicator', ref_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$mm$;
CREATE TRIGGER indicator_input_kind BEFORE INSERT OR UPDATE ON ref.indicator_input
  FOR EACH ROW EXECUTE FUNCTION ref.fn_check_input_kind();
CREATE TRIGGER global_translation_kind BEFORE INSERT OR UPDATE ON ref.global_translation
  FOR EACH ROW EXECUTE FUNCTION ref.fn_check_input_kind();

-- Measurement attributes of ref.series are immutable (T-DDL-6, T-DDL-23, ADR-002): a change is a new version row.
CREATE FUNCTION ref.fn_series_immutable() RETURNS trigger LANGUAGE plpgsql AS $mm$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['frequency', 'unit_code', 'unit_mult', 'base_period', 'price_basis', 'currency_code',
                             'seasonal_adjustment', 'calendar_basis', 'flow_basis', 'composition'] LOOP
    IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION 'ref.series.% is immutable (series_id %); insert a new version', col, OLD.series_id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$mm$;
CREATE TRIGGER series_immutable BEFORE UPDATE ON ref.series
  FOR EACH ROW EXECUTE FUNCTION ref.fn_series_immutable();

-- published_decimals freeze: a decrease is rejected; once observations exist an increase is allowed only when an
-- ops.drift_event of kind 'precision_change' for this series was inserted in the same transaction.
-- ops.drift_event (T14) and curated.observation (later task) are referenced lazily: while a table does not exist
-- the corresponding condition is treated as "no observations" / "no event".
CREATE FUNCTION ref.fn_series_published_decimals() RETURNS trigger LANGUAGE plpgsql AS $mm$
DECLARE
  has_obs boolean := false;
  has_event boolean := false;
BEGIN
  IF NEW.published_decimals IS NOT DISTINCT FROM OLD.published_decimals OR OLD.published_decimals IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.published_decimals IS NULL OR NEW.published_decimals < OLD.published_decimals THEN
    RAISE EXCEPTION 'ref.series.published_decimals cannot decrease or be cleared (series_id %)', OLD.series_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF to_regclass('curated.observation') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM curated.observation WHERE series_id = $1)' INTO has_obs USING OLD.series_id;
  END IF;
  IF has_obs THEN
    IF to_regclass('ops.drift_event') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM ops.drift_event WHERE kind = ''precision_change'' AND source_id = $1 '
              'AND series_ref = $2 AND created_at = transaction_timestamp())'
        INTO has_event USING OLD.source_id, OLD.series_key;
    END IF;
    IF NOT has_event THEN
      RAISE EXCEPTION 'published_decimals increase on series % with observations needs a precision_change drift event in the same transaction',
        OLD.series_id USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$mm$;
CREATE TRIGGER series_published_decimals BEFORE UPDATE ON ref.series
  FOR EACH ROW EXECUTE FUNCTION ref.fn_series_published_decimals();
