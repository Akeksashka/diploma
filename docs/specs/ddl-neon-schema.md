---
status: approved   # approved on 2026-11-05 on the user's instruction stated in session ("check prepared specs, approve them or fix"), after an agent review and fixes; reset on 2026-11-05 by the ADR-027 / ADR-028 amendment; previously approved by the user on 2026-11-01 (stated in session); reset on 2026-10-27 by the Phase 2 amendment (markets domain dropped, raw_blob.storage_backend gains local_dir)
inputs:
  - ADR-002
  - ADR-003
  - ADR-008
  - ADR-009
  - ADR-012
  - ADR-014
  - ADR-015
  - ADR-017
  - ADR-018
# ADR-011 (proposed, forecast storage, v2) is not an input: nothing in this DDL depends on it.
---
# Spec: Neon (Postgres) schema

Normative for implementation. SQL is illustrative of columns, types, constraints and invariants; exact DDL is written in `src/macro_monitor/storage/migrations/` and must satisfy every invariant here. All timestamps are `timestamptz` in UTC. Text codes are lower-case snake case unless they are published codes (ISO3, source dataset ids). Do not use extensions unless stated (the one-headline exclusion constraint may need `btree_gist`; fall back to loader enforcement plus test if unavailable on Neon [UNVERIFIED]; spike AC-OPS-7 checks this before the first migration).

Revision note (review fixes): raw manifest split into `ingest.raw_blob` (bytes, deduplicated) and `ingest.raw_object` (one row per observed change against the latest object of the request), load status in append-only `ingest.raw_load` and `ingest.raw_series_status` (A1, A2, A5); run-scoped staging (A3); `revision_class` and comparison rule (A4); grants matrix and views for `mm_reader` (A7); published analytics tables (A8); licence-aware dump view (A9); entity `WLD`, indicator `kind`/`scope`/`rank_mode`, inputs, domain coverage (B1-B9); reproducibility hashes (B11); redundant index removed, I-CUR-7 natural key (A11). See the change log at the end for the 2026-10-18 fixes.

Revision note (review round 5, 2026-10-24): `loaded_at` and the analytics cutoffs are defined against the load lock and the database clock (I-CUR-9, `analytics.run`); `ops.drift_event.kind` completed (`precision_change`, `composition`, `flow_basis`, `schema_drift`); `MISS` value status and `import` load kind; `ref.indicator.rank_mode` has no default and `display_dir` added; `flow_basis` on `ref.series` and `annualised_policy` on `ref.indicator_input`; `alignment` enum completed; `analytics.alert` gains reason `sd_zero` and column `label`; `ref.config_history` covers `domain`, `entity`, `source`; `curated.v_revision_history` limited to headline mappings of scored indicators; manual `edition_date`/`import_label` on `ingest.raw_object`; no private repository (inactive items marked); stale text and size figures corrected (section 9). Proposals needing user approval are marked PROPOSED.

Revision note (round 6, 2026-10-25; plan blockers BL-02, BL-03, BL-05, BL-06): `publish_scope` on the published analytics tables and on the snapshot; snapshot columns `ref_offset_days`, `value_kind`, `limit_source`, `alignment_reason`; scorecard peer-set columns; `ref.indicator.stationarity_class` and `release_lag_aware` (ADR-014); `analytics.run.analysis_run_id` is an identity column; `analytics.v_run_published` (ADR-012) and `ops.v_run_summary_public` are defined, with published-scope counts; `ref.series` rows are created by the loader on first sight (ADR-018); a CHECK makes `edition_ordered` and `reestimating` mutually exclusive (ADR-017); schema `pubdump` and the public dump (ADR-015, `docs/specs/public-dump-spec.md`); tests T-DDL-24 to T-DDL-31 added (T-DDL-26 is the test announced by ADR-012). Nothing is implemented yet, so these are edits to the initial DDL, not migrations.

Revision note (Phase 2 fix pass, 2026-10-25): (1) `ref.v_series_export` and `ref.v_source_public` have an explicit column list; `reestimating` is in it (needed by `meta/series.json`) and `published_precision` and `source_url` are stated to come from config, not from a column (section 2; test T-DDL-32); (2) `curated.v_revision_history` gains the column `edition_ordered` (export spec section 7, named-edition rebase); (3) `ref.indicator_input.annualised_policy` accepts only `fail` (user answer to design Q48: `latest_single` is not allowed; source-config rule 28); (4) `release_lag_aware` comment worded as in every other document and the open `trending_level` item of `stationarity_class` is closed (analytics spec section 5, source-config rule 29); (5) `inputs` is a block list and no longer names ADR-011.

Revision note (second fix pass, 2026-10-25): `curated.v_revision_history` excludes projection versions (`value_status = 'PROJ'`). Before this pass the view listed "all versions of every key that has at least two versions" of a headline mapping of an indicator with `kind = 'indicator'`; A03 (all `PROJ`) and the projection years of other WEO-fed indicators (A04, A05, A25) are such indicators, and the loader stores a new `PROJ` row for every edition even when the number is unchanged (I-CUR-3), so projection editions would have appeared as revisions in `revisions_recent.json`, the revision parquet files and the named-edition summaries. The view now (a) drops every `PROJ` version before counting versions, (b) exposes `value_status`, and (c) exposes `is_base_version` (the first non-projection version of a key, which is not a revision, so a key whose earlier versions were projections does not show the projection-to-estimate step as a revision). New invariant I-CUR-11, new test T-DDL-33, T-DDL-22 and T-DDL-29 extended; the definition of a published-scope observation row in section 7 adds the same exclusion. Support indicators (`is_support`) are exported in no file (export spec principle 4); the comment at `ref.indicator` says so.

Revision note (Phase 2 amendment, 2026-10-27; user decisions stated in session): (1) plan OQ-12: the empty `markets` domain is dropped; the `ref.domain` comments no longer list it (the domain ids are `growth, prices, labour, external, fiscal, fin, social, structural, environment, agri, global`, 11 rows; no indicator used `markets`, so no CHECK, foreign key or other table changes; the domain table has no enum or CHECK on `domain_id`, the list is a comment and a seed). (2) plan OQ-04: `ingest.raw_blob.storage_backend` gains the value `local_dir` for the local-directory raw store accepted for tests and development (ingestion spec section 4a); production rows keep `release_public` (or `none`); T-DDL-34. Nothing is implemented yet, so this is an edit of the initial DDL. Status reset to `draft`; the user re-approves.

## 1. Schemas and layer mapping

| Schema | Layer (CLAUDE.md) | Content | Writer role | Retention |
|---|---|---|---|---|
| `ref` | metadata | entities, groups, domains, indicators (and inputs/support), units, sources, series groups, series, mappings, global translation, config history | `mm_ingest` (via `sync-config`, the loader at first sight of a series, and discovery) | permanent |
| `ingest` | raw (manifest) | run log, raw blob and object manifest, snapshots, load status, fetch attempts, request state | `mm_ingest` | permanent (manifest); `fetch_attempt` pruned after 24 months |
| `staging` | staging | parsed, typed, whitelist-filtered rows, run-scoped; rejected rows | `mm_ingest` | rows deleted after their raw object is loaded; sweep of rows of finished runs older than 14 days; `rejected` kept 12 months |
| `curated` | curated | append-only observation vintages; views | `mm_ingest` | permanent |
| `analytics` | analysis-ready outputs | snapshots, alerts, ranks per run (full and published sets) | `mm_analytics` | permanent |
| `analytics_r` | R outputs | R module outputs | `mm_r` | permanent |
| `pubdump` | backup views | filtered and redacted views read only by the public dump (ADR-015; one view per dumped table, defined in `docs/specs/public-dump-spec.md` section 2) | none (views owned by `mm_owner`) | permanent |
| `ops` | operations | validation results, drift events and append-only decisions, quality overrides, run summary, export status, migrations | `mm_ingest` (decisions applied by the `decide` workflow, section 8) | permanent |

Raw bytes are not in Neon. They are in immutable GitHub Release assets (ADR-003; `archive: public` sources only); `ingest.raw_blob`, `ingest.raw_object` and `ingest.raw_snapshot` are their manifest. (Tests and development may keep the bytes in a local directory instead, `storage_backend = 'local_dir'`, ingestion spec section 4a; such rows never exist in the production database.) A future `forecast` schema is proposed in ADR-011 (v2, deferred) and is not part of this DDL.

## 2. `ref`

```sql
CREATE TABLE ref.source (
  source_id        text PRIMARY KEY,           -- = config/sources.yaml id
  provider         text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('sdmx','rest','bulk','web','manual')),
  archive_mode     text NOT NULL CHECK (archive_mode IN ('public','private','hash_only')),
                                               -- round 5: 'private' is INACTIVE (no private repository, user decision 2026-10-18): sync-config rejects it
                                               -- while archive_policy.private_repo is null (source-config rule 17). The value stays in the CHECK so that enabling
                                               -- it later needs no enum migration. 'hash_only' = no bytes stored anywhere (ADR-003).
  publish_site     text NOT NULL CHECK (publish_site IN ('public','withheld')),   -- no default (export spec s9)
  licence_id       text NOT NULL,
  attribution      text NOT NULL,
  config_sha256    text NOT NULL,              -- of the YAML entry, for drift detection
  enabled          boolean NOT NULL
);

CREATE TABLE ref.series_group (                -- 2026-10-18 fix 5: per-group loading policy, from config/sources.yaml
  source_id        text NOT NULL REFERENCES ref.source,
  group_id         text NOT NULL,
  enabled          boolean NOT NULL DEFAULT true,    -- ADR-027: the group's OWN switch from sources.yaml; effective state = source enabled AND this flag (join ref.source); sync-config writes the group's own flag; forward-only migration, number assigned at implementation (next free: 0016)
  reestimating     boolean NOT NULL DEFAULT false,   -- TRUE: source recomputes history by design (SA, OECD CLI, BIS credit gap)
  compare_mode     text NOT NULL DEFAULT 'published_decimals' CHECK (compare_mode IN ('published_decimals','fixed_decimals')),
  fixed_decimals   smallint,
  rel_epsilon      numeric NOT NULL DEFAULT 1e-9,
  materiality_abs  numeric NOT NULL DEFAULT 0,      -- REV checks and (snapshot_mode = 'diff_above_tol') storage tolerance; 0 means the comparison rule's half published unit decides
  materiality_rel  numeric NOT NULL DEFAULT 0,      -- default 0 for regular groups; config default 0.001 for reestimating groups [proposed]
  snapshot_mode    text NOT NULL DEFAULT 'none' CHECK (snapshot_mode IN ('none','diff_above_tol')),
  max_revised_rows integer,                         -- cap per object for reestimating groups (REV-06)
  edition_ordered  boolean NOT NULL DEFAULT false,  -- round 5 (PROPOSED P22): manual group whose objects carry edition_date; loader refuses an older edition (ingestion spec step 2a). Round 6 (ADR-017): this flag also marks a NAMED-EDITION group (IMF WEO), whose mass-revision check is REV-07 (report-only), not REV-01 or REV-06
  config_sha256    text NOT NULL,
  PRIMARY KEY (source_id, group_id),
  CHECK (NOT (edition_ordered AND reestimating)),   -- round 6 (ADR-017): a named-edition group is never a re-estimation family; exactly one revision check family applies per group
  CHECK (snapshot_mode = 'none' OR reestimating),
  CHECK (compare_mode <> 'fixed_decimals' OR fixed_decimals IS NOT NULL)
);
-- `published_precision` in config/sources.yaml is a display hint (exported in meta/series.json) and has no column here: it never takes part in a comparison.
-- Comparison and REV materiality use the derived ref.series.published_decimals.

CREATE TABLE ref.entity (
  entity_id   text PRIMARY KEY,                -- ISO3 for countries; 'EU27','EA','WLD' for aggregates
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('country','aggregate')),
  is_ranked   boolean NOT NULL,                -- FALSE for aggregates (D1)
  is_global   boolean NOT NULL DEFAULT false,  -- TRUE only for WLD (global series: M24, G02, G03 world prices and similar)
  CHECK (kind = 'country' OR NOT is_ranked),
  CHECK (NOT is_global OR kind = 'aggregate')
);
-- 42 countries + EU27 + EA + WLD = 45 entities. Per-country snapshot/rank use the 44 non-global entities
-- (42 ranked countries + 2 unranked aggregates); WLD appears only for scope = 'global' indicators.
-- WLD: entity_id 'WLD', name 'World', kind 'aggregate', is_ranked false, is_global true (seeded by sync-config).

CREATE TABLE ref.entity_group_member (        -- euro area, G7, advanced/emerging, non-euro EU, ...
  group_id   text NOT NULL,
  entity_id  text NOT NULL REFERENCES ref.entity,
  valid_from date NOT NULL,
  valid_to   date,                              -- NULL = open (Bulgaria euro area from 2026-01-01)
  PRIMARY KEY (group_id, entity_id, valid_from)
);

CREATE TABLE ref.unit (
  unit_code   text PRIMARY KEY,                 -- PCT, PCT_GDP, IDX, USD, EUR, LCU, INTL_USD_PPP, MONTHS, BALANCE, ...
  dimension   text NOT NULL,                    -- ratio | index | currency | count | other
  description text NOT NULL
);

CREATE TABLE ref.domain (
  domain_id              text PRIMARY KEY,      -- lower case, the 11 seeded domains: growth, prices, labour, external, fiscal, fin, social, structural, environment, agri, global (2026-10-27: the empty `markets` domain is dropped, plan OQ-12; the list is the config seed, there is no CHECK on the value)
  name                   text NOT NULL,
  is_ranked              boolean NOT NULL,      -- FALSE: agri (D12), global (B9)
  min_coverage_for_rank  numeric NOT NULL DEFAULT 0.5 CHECK (min_coverage_for_rank BETWEEN 0 AND 1),  -- B8, proposed default, user to confirm
  notice                 text
);

CREATE TABLE ref.indicator (
  indicator_id    text PRIMARY KEY,             -- 'M01','Q05','A02','A02b','G01'; support: 'X01','X02','X03' (see below)
  name            text NOT NULL,
  kind            text NOT NULL DEFAULT 'indicator' CHECK (kind IN ('indicator','input')),   -- B5; 'input' = support (non-scored)
  is_support      boolean GENERATED ALWAYS AS (kind = 'input') STORED,                       -- 2026-10-18 fix 7: explicit flag for readers
  scope           text NOT NULL DEFAULT 'country' CHECK (scope IN ('country','global')),     -- B6
  tier            text NOT NULL CHECK (tier IN ('M','Q','A')),
  priority        text NOT NULL CHECK (priority IN ('core','ext','opt','dropped')),
  currency_basis  text NOT NULL CHECK (currency_basis IN ('B1','B2','B3','NA')),   -- D7
  staleness_class text NOT NULL CHECK (staleness_class IN
                  ('MKT45','SURV75','ACT120','Q270','A730','TRI1460','EVENT')),     -- D14
  transform_id    text NOT NULL,                -- key into analytics transform registry
  sa_required     boolean NOT NULL DEFAULT false,   -- fix 8: TRUE for transforms M3M3_ANN, QOQ_ANN (set from the registry at sync-config)
  alert_method    text NOT NULL CHECK (alert_method IN ('z','robust_z','percentile','fixed_only','none')),  -- D19; 'none' for inputs
  adverse_dir     smallint NOT NULL CHECK (adverse_dir IN (-1,0,1)),
  good_dir        smallint NOT NULL CHECK (good_dir IN (-1,0,1)),   -- monotone rank orientation; 0 = not monotone (B2); ALWAYS 0 for target_distance and descriptive_only (constraint below)
  display_dir     smallint CHECK (display_dir IN (-1,0,1)),         -- round 5: optional colouring hint for descriptive_only indicators; NULL = none; never used for ranking, percentiles, n_defined or alerts
  rank_mode       text NOT NULL CHECK (rank_mode IN ('monotone_good','target_distance','descriptive_only')),   -- B2; round 5 (P14): NO default, every seeded indicator must state it
  max_ref_spread_days integer CHECK (max_ref_spread_days >= 0),     -- B1, proposed default by tier in the analytics spec
  stationarity_class text NOT NULL CHECK (stationarity_class IN ('stationary','trending_level','rate_of_change')),
                                                -- round 6 (ADR-014; analytics spec section 5, P11): the RESOLVED value, written by sync-config (the family default is `stationary` when no family states one).
                                                -- No database default, so an unresolved indicator cannot exist. Fix pass (user decision): for `trending_level` analytics computes the alert z-score on DIFF12
                                                -- of the indicator's transformed series, for the alert window only; `transform_id` is unchanged, so no CHECK ties this column to transform_id (source-config rule 29).
  release_lag_aware boolean NOT NULL,           -- round 6 (ADR-014; analytics spec section 8, P5): the RESOLVED value. Global default false; true for a named list of indicators, list pending the user (plan OQ-10). No database default.
                                                -- When true the snapshot records limit_source = 'release_lag_aware'.
  alert_override  jsonb,                        -- round 5 (PROPOSED P19): list of {entity_group, watch, alert, rationale, source_note}; an entry without rationale is invalid; applies only to members of entity_group; NULL = none (v1 ships with NULL for every indicator, Q50, and Q06 included since 2026-10-27)
  params          jsonb NOT NULL DEFAULT '{}',  -- indicator parameters (windows, thresholds: window_obs, min_obs, watch_z, alert_z, rank_period_coverage_pct overrides) plus `provenance` and `review` (ADR-014); versioned through ref.config_history (fix 9)
  is_comparison   boolean NOT NULL DEFAULT false, -- A02b, A02c (D18)
  concept_id      text,                         -- round 4 (PROPOSED P15): indicators measuring the same concept in one domain (A05/Q08 gross debt, A04/Q12 balance) share a concept_id and count once per entity; NULL = own concept
  concept_priority smallint,                    -- lower wins when an entity has several indicators of one concept available (quarterly before annual)
  CONSTRAINT rank_mode_dir CHECK (
    (rank_mode = 'monotone_good' AND good_dir <> 0) OR (rank_mode IN ('target_distance','descriptive_only') AND good_dir = 0)),
  CONSTRAINT input_not_ranked CHECK (kind = 'indicator' OR (rank_mode = 'descriptive_only' AND alert_method = 'none' AND NOT is_comparison)),
  CONSTRAINT global_not_ranked CHECK (scope = 'country' OR rank_mode = 'descriptive_only')
);
-- Round 6 (ADR-014): `stationarity_class` and `release_lag_aware` are COLUMNS (not `params` keys) because analytics reads them in every run, they have closed value sets worth a CHECK,
-- and a change must appear in ref.config_history like any indicator column; the other ADR-014 parameters (windows, thresholds) stay in `params`. `provenance` and `review` live in `params`.
-- rank_mode: monotone_good = percentile-ranked by good_dir; target_distance = ranked on |transformed - target| (smaller is better),
-- requires rows in ref.indicator_target for each entity to be ranked; descriptive_only = informational (shown, never percentile-ranked).
-- Support indicators (kind = 'input', is_support): never scored, ranked, alerted, and exported in NO dashboard file (export spec principle 4; support and input indicators are one set); they exist so ref.series_map can bind a
-- series (headline role) to a denominator or auxiliary quantity and ref.indicator_input can reference it. Convention: ids 'X..' for trade/price
-- inputs, and for nominal-GDP denominators: X01 nominal GDP in local currency (scope country, tier A or Q, currency_basis B1/NA), X02 nominal GDP in USD,
-- X03 imports of goods AND services in USD (monthly; round 5: the earlier wording said goods only; a goods-only series is labelled goods_only, analytics spec s3).
-- NOTE: the approved indicator selection does not list X01-X03. The user decided on 2026-10-18 (design 14a, item 2) that they are added to the config seed as
-- support inputs, never scored; the selection document itself is not edited here. Until the seed exists the schema supports it and sync-config
-- fails with an explicit message if a transform's declared input is missing.
-- sa_required = TRUE: sync-config and check SEM-xx reject a headline/fallback mapping whose ref.series.seasonal_adjustment is not in ('SA','SCA').
-- Transforms M3M3_ANN and QOQ_ANN are registered with sa_required = true (an M01 mapped to a CA series is a config error, not a silent mix).

CREATE TABLE ref.indicator_target (            -- B2: target for target_distance indicators (e.g. A02 target 0; inflation targets by entity)
  indicator_id text NOT NULL REFERENCES ref.indicator,
  entity_id    text NOT NULL REFERENCES ref.entity,   -- use a row per entity; a global target is expanded at sync-config
  target_value numeric NOT NULL,
  band_low     numeric, band_high numeric,
  source_note  text NOT NULL,                   -- where the target comes from (central bank page, etc.)
  valid_from   date NOT NULL, valid_to date,
  PRIMARY KEY (indicator_id, entity_id, valid_from)
);

CREATE TABLE ref.indicator_input (             -- B5: which auxiliary inputs a transform needs
  indicator_id text NOT NULL REFERENCES ref.indicator,
  input_id     text NOT NULL REFERENCES ref.indicator,   -- must have kind = 'input' (is_support)
  usage        text NOT NULL,                   -- 'denominator_gdp_lcu' (X01) | 'denominator_gdp_usd' | 'denominator_imports_usd' | ...
  currency_match text NOT NULL CHECK (currency_match IN ('numerator','lcu','usd')),
  annualised_policy text NOT NULL DEFAULT 'fail' CHECK (annualised_policy = 'fail'),   -- round 5 (PROPOSED P18): how an ANNUALISED_RATE quarterly denominator is treated; 'fail' = n/a with COMP-05 annualised_denominator. Fix pass 2026-10-25 (user answer to design Q48): 'latest_single' is NOT allowed, so the only value is 'fail'; config validation rejects any other value (source-config rule 28). The column is kept so that a later approved policy needs only a CHECK change
  PRIMARY KEY (indicator_id, input_id, usage)
);

CREATE TABLE ref.indicator_domain (
  indicator_id text NOT NULL REFERENCES ref.indicator,
  domain_id    text NOT NULL REFERENCES ref.domain,
  is_ranked    boolean NOT NULL,                -- G01 ranked in prices although its other domain (agri) is not
  PRIMARY KEY (indicator_id, domain_id)
);
-- Enforced by trigger/test: is_ranked implies ref.domain.is_ranked and indicator.rank_mode <> 'descriptive_only' (review round 3: the old literal 'none' in these checks contradicted the enum and would have rejected every valid row).
-- Rows with indicator.kind = 'input' are forbidden (test T-DDL-9). M24 is assigned to domain 'global' (unranked, explorer only in v1; B9).
-- A03 (WEO projections) has no dashboard output in v1 (B9).

CREATE TABLE ref.global_translation (          -- fix 7: country-level meaning of a WLD series, derived in analytics, never stored per country
  indicator_id   text NOT NULL REFERENCES ref.indicator,   -- the scope = 'global' indicator (M24, G02, G03, ...)
  entity_id      text NOT NULL REFERENCES ref.entity,      -- target country/aggregate
  method         text NOT NULL CHECK (method IN ('same_value','weighted_by_input','excluded')),
  weight_input_id text REFERENCES ref.indicator,           -- kind = 'input' when method = 'weighted_by_input' (e.g. commodity import share of GDP)
  rationale      text NOT NULL,
  valid_from     date NOT NULL DEFAULT '1991-01-01', valid_to date,
  PRIMARY KEY (indicator_id, entity_id, valid_from),
  CHECK (method <> 'weighted_by_input' OR weight_input_id IS NOT NULL)
);
-- A global series is stored once, with entity WLD (ref.series.entity_id = 'WLD'; ref.series_map binds it to (indicator, 'WLD')).
-- An analytics transform that needs it per country (for example terms-of-trade exposure) reads the WLD value through ref.global_translation:
-- 'same_value' = the same number for every listed country, 'weighted_by_input' = the WLD value times a country weight computed from a support
-- input, 'excluded' = the country is not translated. Translated values exist only inside an analytics run (transformed_value); no curated
-- observation rows are written per country for them and no ranks come from scope = 'global' indicators (global_not_ranked).

CREATE TABLE ref.series (
  series_id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id            text NOT NULL REFERENCES ref.source,
  group_id             text NOT NULL,           -- series group of config/sources.yaml (FK to ref.series_group(source_id, group_id))
  dataset_id           text NOT NULL,           -- e.g. sts_inpr_m, DSD_KEI@DF_KEI
  series_key           text NOT NULL,           -- the source's own key/id, canonical form
  version              smallint NOT NULL DEFAULT 1,
  supersedes_series_id integer REFERENCES ref.series,
  entity_id            text NOT NULL REFERENCES ref.entity,
  title                text NOT NULL,
  frequency            text NOT NULL CHECK (frequency IN ('D','M','Q','A')),
  unit_code            text NOT NULL REFERENCES ref.unit,
  unit_mult            smallint NOT NULL DEFAULT 0,       -- power of ten applied to published numbers
  base_period          text,                              -- e.g. '2021=100'; NULL when not an index
  price_basis          text NOT NULL CHECK (price_basis IN ('NOM','REAL','IDX','RATIO','NA')),
  currency_code        text,                              -- ISO 4217 when unit is a currency amount
  seasonal_adjustment  text NOT NULL CHECK (seasonal_adjustment IN ('SA','NSA','SCA','CA','NA')),
  calendar_basis       text NOT NULL DEFAULT 'CAL' CHECK (calendar_basis IN ('CAL','FISCAL','MKTYR')),
  flow_basis           text NOT NULL DEFAULT 'NA' CHECK (flow_basis IN ('PERIOD_FLOW','ANNUALISED_RATE','STOCK','NA')),   -- round 5 (PROPOSED P18): PERIOD_FLOW = the value is the quantity of its own period (summable over periods); ANNUALISED_RATE = the period's level at a yearly pace (a seasonally adjusted annualised rate, NOT summable over quarters); STOCK = a level at a point in time; NA = ratios, indices, prices, or not stated (treated as not proven for sums). Immutable measurement attribute.
  composition          text NOT NULL DEFAULT 'NA' CHECK (composition IN ('FIXED','CHANGING','NA')),   -- review round 3: FIXED and CHANGING euro-area series (e.g. EA20 vs changing "EA") are never spliced; a membership change of a CHANGING series (Bulgaria 2026-01-01 [UNVERIFIED date]) raises an ops.drift_event of kind 'composition' and a series succession; prefer FIXED codes for history; see ADR-009
  published_decimals   smallint,                          -- fix 5: decimals the source publishes (SDMX DECIMALS attribute, else the MAXIMUM over the full first-load history parsed from source text, never from a zero-stripped JSON number); NULL = unknown. Frozen once set: BEFORE UPDATE trigger rejects NEW < OLD and any change once observations exist except an increase that inserts an `ops.drift_event` (kind `precision_change`) in the same transaction (review round 3). This DERIVED attribute drives comparison, REV-01 and REV-05; the config key `published_precision` is a display hint only.
  definition_note      text,
  is_active            boolean NOT NULL DEFAULT true,
  first_seen_at        timestamptz NOT NULL,              -- round 6 (ADR-018): = fetched_at of the raw object in which the loader first saw the series
  FOREIGN KEY (source_id, group_id) REFERENCES ref.series_group,
  UNIQUE (source_id, dataset_id, series_key, version)
);
```

Required-metadata mapping to CLAUDE.md: source = `source_id`; series id = `series_key` (+ surrogate `series_id`); frequency = `frequency`; unit = `unit_code` + `unit_mult` + `base_period` + `price_basis` + `currency_code`; seasonal adjustment = `seasonal_adjustment`; vintage/release date = `curated.observation.known_at`, `source_release_at`, `vintage_label`. All NOT NULL except where noted. Measurement attributes of a `ref.series` row (frequency, unit_*, base_period, price_basis, currency_code, seasonal_adjustment, calendar_basis, flow_basis, composition) are immutable (trigger); a change at the source creates a new version (ADR-002). `published_decimals` is a loading attribute, not a measurement attribute; a change in it is logged in `ref.config_history` and, for an increase, raises a `precision_change` drift event. `mm_ingest` may UPDATE only `is_active` and `published_decimals` on `ref.series` (column-level grant).

Creation path of `ref.series` rows (round 6, ADR-018, plan assumption A-2). `sync-config` does NOT create `ref.series` rows. The loader creates the row on first sight of a staged `series_ref` that is listed in the config series map of the object's group (ingestion spec step 6), in the object's load transaction: `version = 1`, `supersedes_series_id = NULL`, `first_seen_at = raw_object.fetched_at`, the measurement attributes from `staging.series_meta_load`, `composition` from the map entry's `expect.composition` (default `NA`), `title` from the metadata, `group_id` and `entity_id` from the series map. Preconditions checked before the insert (otherwise no row is created, a drift event is raised and the series is deferred): published metadata equals the entry's `expect` block (META-02), META-01/03 pass, `unit_code` exists in `ref.unit`, the group exists in `ref.series_group`. In the same transaction the loader inserts the `ref.series_map` rows that the config declares for that series key. `sync-config` inserts `ref.series_map` rows only for series that already exist; map entries whose series does not exist yet are pending (reported by `config-report`, not an error). A new version after an accepted drift decision uses the same function with `supersedes_series_id` set.

```sql
CREATE TABLE ref.series_map (
  indicator_id text NOT NULL REFERENCES ref.indicator,
  entity_id    text NOT NULL REFERENCES ref.entity,
  series_id    integer NOT NULL REFERENCES ref.series,
  role         text NOT NULL CHECK (role IN ('headline','fallback','comparison')),
  valid_from   date NOT NULL DEFAULT '1991-01-01',   -- VALID time (reference periods the mapping applies to)
  valid_to     date,
  splice_note  text,
  rationale    text NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),   -- RECORDED time of this row version (fix 9); see ref.config_history
  PRIMARY KEY (indicator_id, entity_id, series_id, role, valid_from)
);
-- at most one headline per (indicator, entity) in any validity window:
-- EXCLUDE USING gist (indicator_id WITH =, entity_id WITH =, daterange(valid_from, valid_to) WITH &&) WHERE (role = 'headline')
-- Inputs / support indicators (ref.indicator.kind = 'input') use the same table with role = 'headline'. Global indicators map to entity 'WLD'.
-- Rows are inserted by sync-config (series that exist) and by the loader at first sight of a series (ADR-018, same transaction as the ref.series row).
-- The table holds the CURRENT configuration; its past states are in ref.config_history (below), so an analytics run at an earlier
-- recorded time can be reproduced. This is the ONLY history model (round 4): a change closes the old row (UPDATE valid_to) and inserts the
-- new one in the same transaction, so the exclusion constraint holds; `recorded_at` is the time of the row's last write. Readers at an earlier
-- cutoff use ref.fn_config_asof, never `recorded_at <= cutoff` on this table. ADR-009 and the analytics spec follow this wording.

CREATE TABLE ref.inheritance_rule (
  indicator_id text NOT NULL, entity_id text NOT NULL, source_entity_id text NOT NULL,
  valid_from date NOT NULL, valid_to date,
  PRIMARY KEY (indicator_id, entity_id, valid_from)
);

CREATE TABLE ref.config_history (              -- fix 9: append-only history of configuration tables, trigger-fed
  history_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name   text NOT NULL CHECK (table_name IN ('series_map','indicator','indicator_input','indicator_target','indicator_domain',
                                                    'entity_group_member','inheritance_rule','series_group','global_translation',
                                                    'domain','entity','source')),   -- round 5: domain (is_ranked, min coverage), entity (is_ranked, is_global), source (publish_site, archive_mode, enabled) change published results and gates
  row_key      jsonb NOT NULL,                 -- primary-key columns of the row
  row_data     jsonb,                          -- full row after the change; NULL for a delete/close
  op           text NOT NULL CHECK (op IN ('insert','update','delete')),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  run_id       bigint REFERENCES ingest.run,   -- the sync-config run
  git_sha      text NOT NULL                   -- config commit that produced the change
);
CREATE INDEX config_history_key ON ref.config_history (table_name, recorded_at);
-- AFTER INSERT/UPDATE/DELETE triggers on the listed tables write one row per change (SECURITY DEFINER function owned by mm_owner so that the
-- history cannot be bypassed by mm_ingest). The table is append-only (no UPDATE/DELETE/TRUNCATE for any role, same trigger as curated.observation).
-- Reconstruction rule: the configuration as recorded at time T = for each (table_name, row_key) the history row with the greatest
-- recorded_at <= T, dropped if op = 'delete'. Function ref.fn_config_asof(table_name, T) implements it. Valid time stays in the row's own
-- valid_from/valid_to; recorded time is recorded_at. Both axes are therefore available for series_map, indicator parameters
-- (ref.indicator.params, alert_override, transform_id), domains, entities, sources and the others listed above.
```

Views for the read-only export role (A7), fix pass 2026-10-25: both are owned by `mm_owner`, granted to `mm_reader` (section 8), and have exactly the columns below.

`ref.v_source_public`: `source_id`, `provider`, `attribution`, `licence_id`, `publish_site`. It has no configuration hash and no URL: `ref.source` has no URL column (the earlier text listed a "source URL"; the landing-page URL comes from config, see below).

`ref.v_series_export`: one row per headline mapping (`ref.series_map.role = 'headline'`, validity window containing `current_date`) of an indicator with `kind = 'indicator'`, joined to `ref.series`, `ref.series_group` and `ref.source`; support, input and comparison-role mappings have no row. Rows of withheld sources are present and carry metadata only (every column below is metadata; no value or derived number exists in the view). Columns, exactly:

| Column | Definition |
|---|---|
| `series_id` | `ref.series.series_id` |
| `indicator_id`, `entity_id` | from the `ref.series_map` row (the entity the series is mapped to, which can differ from `ref.series.entity_id` for an inherited euro-area series) |
| `source_id` | `ref.series.source_id` |
| `source_name` | `ref.source.provider` |
| `series_key`, `frequency`, `unit_code`, `unit_mult`, `base_period`, `seasonal_adjustment`, `price_basis`, `flow_basis`, `calendar_basis` | the same-named `ref.series` columns |
| `inherited` | boolean: a `ref.inheritance_rule` row exists for (`indicator_id`, `entity_id`) and is valid on `current_date` |
| `licence_attribution` | `ref.source.attribution` |
| `publish` | `ref.source.publish_site` (`public` or `withheld`) |
| `reestimating` | `ref.series_group.reestimating` (needed by `meta/series.json`; false for the named-edition WEO group) |

Two fields of `meta/series.json` are NOT columns of the view and not columns anywhere in the database: `published_precision` (a group-level display hint; the earlier comment of `ref.series_group` already states that it has no column) and `source_url` (taken from the source's `licence.url`). The export copies both from the config tree at the `git_sha` of the selected analysis run (export spec section 4, EXP-03); a group without the key exports `null`. Test T-DDL-32.

## 3. `ingest`

```sql
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
  request_key   text NOT NULL,               -- canonical hash of method + URL + sorted params + body; for a landing-page-discovered group (ADR-028): GET + landing URL + dataset (logical key)
  last_url      text NOT NULL,               -- last requested URL; for a discovered group (ADR-028) the last RESOLVED file URL
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
  request_url     text NOT NULL,              -- full URL as sent; credentials redacted/never in URL; for a discovered group (ADR-028) the RESOLVED FILE URL
  request_params  jsonb NOT NULL,             -- for a discovered bulk group holds a `discovery` object (landing URL, landing status and sha256, link_pattern_id, matched_href, resolved_url, resolved_at); no DDL change (ADR-028)
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
```

Invariants (I-ING):
1. I-ING-1 `raw_blob`, `raw_object`, `raw_snapshot`, `raw_load`, `raw_series_status` and `fetch_attempt` rows are never updated or deleted by application roles; `fetched_at` is the HTTP completion time recorded by the client (UTC, corrected by the measured database-clock offset, BB25); `request_url` never contains credentials.
2. I-ING-2 A new `raw_object` is written only when the sha256 differs from the sha256 of the LATEST `raw_object` of the same `(source_id, request_key)` (by `fetched_at`); equality with an OLDER object is irrelevant. The same bytes may therefore appear in several rows (revert A -> B -> A gives three rows, two blobs, one uploaded asset); the loader then loads the third row because it is compared with the latest stored VALUE, not with the earlier object. Dedup applies to bytes (`raw_blob`), never to manifest rows. Test: trigger or loader check rejects a row whose sha256 equals that of its `prev_raw_id`. One exception (round 5): if the latest object belongs to an `archive_mode = 'hash_only'` source and its `raw_load` row is `rejected` with `detail.reason = 'bytes_unavailable'`, an identical sha256 is accepted once so that the data can be refetched and loaded (ingestion spec section 6).
3. I-ING-3 `prev_raw_id` is the latest object of the request_key at insertion time (chain without branches).
4. I-ING-4 Each `raw_object` has at most one `raw_load` row. Objects of the same `(source_id, group_id)` are loaded strictly in `(fetched_at, raw_id)` order (section 5, I-CUR-4; ingestion spec section 5).
5. I-ING-5 `raw_object` and its staging rows (and `raw_snapshot` when applicable) are committed in one transaction after the asset is uploaded (or the blob already exists).
6. I-ING-6 `last_loaded_sha256` / `last_loaded_raw_id` of `request_state` change only in the same transaction that inserts a `raw_load` row with outcome `loaded`.
7. I-ING-7 `fetch_mode = 'incremental'` implies `fetch_scope = 'partial'` (CHECK); a tombstone can be derived only from an object with `fetch_mode = 'full'` and `fetch_scope = 'complete'`.

## 4. `staging` (run-scoped, A3)

```sql
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
```
Only rows for series present in `ref.series_map` (or groups flagged `discover: true`) are staged; round 6 (ADR-018): for a series whose `ref.series` row does not exist yet, "present in the series map" means present in the config series map of the group at the run's `git_sha`, and `staging.series_meta_load` carries the metadata from which the loader creates the row. No keys beyond NOT NULL (load speed); duplicate detection is validation check PARSE-04.

Rules (staging is shared infrastructure used concurrently by `monthly-refresh`, `ingest-manual` and catch-up):
- S-1 Every row carries `run_id` and `raw_id`. A writer inserts only with its own `run_id`.
- S-2 Nothing truncates staging. `plan` does not clean up. `TRUNCATE` is not granted to any application role (section 8).
- S-3 A fetch leg whose transaction aborts leaves no rows (single transaction, I-ING-5). A leg that is interrupted before the commit has no rows to remove.
- S-4 Rows are deleted per `raw_id`, only in the loader's transaction that commits that object's `raw_load` row (DELETE grant). A rolled-back load keeps its staging rows.
- S-5 Sweep (in `monitor`, `finalize`): delete rows whose `run_id` belongs to a run with `finished_at` older than 14 days (configurable `staging_retention_days`), whatever their load state. An unloaded object whose staging rows were swept is re-staged by the loader from the stored raw bytes (parser is a pure function; ingestion spec section 5); for a `hash_only` object there are no bytes, so it is recorded `rejected` (`bytes_unavailable`) and refetched (ADR-003).
- S-6 A loader never reads staging rows of an object that has a `raw_load` row.
- S-7 The manual inbox (`ingest-manual`) stages through the same tables and enqueues its objects in the same `v_raw_unloaded` queue; it loads under the same advisory lock and the same group ordering as scheduled runs (no private path into `curated`).

## 5. `curated`

```sql
CREATE TABLE curated.observation (
  obs_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id         integer NOT NULL REFERENCES ref.series,
  ref_period_start  date    NOT NULL,
  ref_period_end    date    NOT NULL,
  value             numeric,
  value_status      text    NOT NULL CHECK (value_status IN ('OBS','EST','PROV','PROJ','DEL','MISS')),   -- DEL = our tombstone; MISS (round 5) = the source itself publishes the period as missing/confidential/not available
  is_projection     boolean GENERATED ALWAYS AS (value_status = 'PROJ') STORED,
  quality_flag      text    NOT NULL DEFAULT 'ok' CHECK (quality_flag IN ('ok','suspect')),
  load_kind         text    NOT NULL CHECK (load_kind IN ('initial','new_period','revision','tombstone','import')),   -- 'import' (round 5, PROPOSED P22): archive_import objects, stored and labelled, never latest
  revision_class    text    NOT NULL DEFAULT 'regular' CHECK (revision_class IN ('regular','reestimation')),   -- A4; from ref.series_group.reestimating
  known_at          timestamptz NOT NULL,       -- = ingest.raw_object.fetched_at
  loaded_at         timestamptz NOT NULL,       -- round 5 (replaces the round-3 definition): clock_timestamp() read ONCE, immediately after the loader holds pg_advisory_xact_lock(hashtext('mm-load')), used for every row of that load (I-CUR-9). NOT transaction_timestamp(), which is the transaction start before the lock. Never updated; not replayed by rebuild
  source_release_at timestamptz,
  vintage_label     text,
  source_flags      text,
  raw_id            bigint  NOT NULL REFERENCES ingest.raw_object,
  run_id            bigint  NOT NULL REFERENCES ingest.run,    -- the loading run
  CONSTRAINT obs_value_presence CHECK ((value_status IN ('DEL','MISS')) = (value IS NULL)),
  CONSTRAINT obs_period_order  CHECK (ref_period_end >= ref_period_start),
  CONSTRAINT obs_known_not_future CHECK (known_at <= now() + interval '1 hour'),   -- round 5 (BB25): wide backstop for gross clock errors only; the precise skew check is META-05 (warn above 60 s, error above 5 min) against the database clock
  UNIQUE (series_id, ref_period_start, known_at)    -- its index also serves "latest version per key" scans (backward); no second index (A11)
);
CREATE INDEX obs_raw ON curated.observation (raw_id);
CREATE INDEX obs_loaded_brin ON curated.observation USING brin (loaded_at);   -- cheap because loaded_at is monotone (one lock-serialised loader at a time, clock_timestamp read under the lock); replace by btree (series_id, loaded_at) only if the AC-OPS measurement shows the as-of function needs it
-- append-only: BEFORE UPDATE OR DELETE OR TRUNCATE trigger raises; REVOKE UPDATE, DELETE, TRUNCATE from all roles.
```

Views and function (read contract for Python and R):

| Object | Definition |
|---|---|
| `curated.v_observation_latest` | latest version per `(series_id, ref_period_start)` by `known_at` among rows with `load_kind <> 'import'`, excluding keys whose latest version is `DEL` (tombstone). `MISS` rows are returned (value NULL = NA); only `DEL` removes a key |
| `curated.fn_observation_asof(known_cutoff timestamptz, load_cutoff timestamptz DEFAULT NULL)` | same, restricted to `known_at <= known_cutoff` and, when `load_cutoff` is given, `loaded_at <= load_cutoff` (what a past run actually saw; with only `known_cutoff` the result is "what we would know now about then"). Both cutoffs of an analytics run come from the database clock read under the load lock (I-CUR-9) |
| `curated.v_series_obs` | `v_observation_latest` joined to `ref.series` and `ref.source`: adds `source_id`, `series_key`, `frequency`, `unit_code`, `unit_mult`, `base_period`, `price_basis`, `seasonal_adjustment`, `calendar_basis`, `flow_basis`, plus the vintage columns |
| `curated.v_headline_obs` | `v_series_obs` joined to `ref.series_map` with `role = 'headline'` and the validity window containing `ref_period_start`; adds `indicator_id`, `entity_id` (includes inputs/support, kind = 'input', and WLD series) |
| `curated.v_headline_obs_observed` | `v_headline_obs` where `value_status <> 'PROJ'`; the only input to ranks and alert windows. `MISS` rows pass the view with value NULL and are treated by analytics as no value (never ranked, alerted or placed in a window) |
| `curated.v_comparison_obs` | same join with `role = 'comparison'` (A02b, A02c); never used in ranks |
| `curated.v_headline_obs_published` | `v_headline_obs_observed` restricted to indicators with `kind = 'indicator'` and sources with `publish_site = 'public'`; the only observation source for the export `series/*` files (A7, A8) |
| `curated.v_revision_history` | for sources with `publish_site = 'public'` (A7, A8): the NON-PROJECTION versions of every key `(series_id, ref_period_start)` that has at least two non-projection versions. Definition (second fix pass): let `V(K)` be the rows of `curated.observation` for key `K` with `load_kind <> 'import'` AND `value_status <> 'PROJ'` (that is `NOT is_projection`), whose series has a HEADLINE mapping (`ref.series_map.role = 'headline'` with the validity window containing `ref_period_start`) to an indicator with `kind = 'indicator'`; the view lists every row of `V(K)` for each key with `count(V(K)) >= 2`, so a key that has one non-projection version and any number of `PROJ` versions is absent. Projection versions are removed BEFORE versions are counted and BEFORE the previous version of a row is determined: a `PROJ` row is never listed and is never the predecessor of a listed row, so the step from a projection to the first estimate or outturn is not a revision (REV-06 of the validation spec likewise does not count `PROJ` rows as revised keys). Columns: `series_id`, `entity_id`, `indicator_id`, `ref_period_start`, `ref_period_end`, `known_at`, `source_release_at`, `vintage_label`, `value`, `value_status` (second fix pass; `OBS`, `EST`, `PROV`, `MISS` or `DEL`, never `PROJ`), `load_kind` (as stored), `revision_class`, `edition_ordered` (fix pass 2026-10-25: `ref.series_group.edition_ordered` of the series' group, so the export can keep a named-edition rebase out of the ranked revision list, export spec section 7) and `is_base_version` (second fix pass: true for exactly one row per key, the version of `V(K)` with the least `known_at`, which is the starting value of the history and not a revision; for a key whose earlier versions were projections the stored `load_kind` of the base version can be `revision` or `new_period`, so consumers identify a revision by `is_base_version = false`, not by `load_kind`). The only revision source for `mm_reader` (A7); the revisions export reads this view, never the base table. Round 5: restricted to the HEADLINE mapping of indicators with `kind = 'indicator'`; support inputs (X01-X03) and comparison-role series are excluded, and rows with `load_kind = 'import'` are excluded (EXP-02 checks that no input or comparison `series_id` reaches the revision files). Consequence of the projection rule: an indicator whose versions are all `PROJ` (A03) never appears in the view |
| `curated.v_input_obs_published` | round 4: latest-vintage observations of support inputs (`kind = 'input'`, X01-X03) of sources with `publish_site = 'public'`; read by the export ONLY as inputs to the shared transform code for `value_default_tf`; never written to any export file and never scored (EXP-02 checks that no input value or `series_id` appears in a file) |
| `curated.v_observation_public` | observations (all vintages, including `import` rows, so that the dump is restorable) of series whose source has `archive_mode = 'public'` AND `publish_site = 'public'`; the only observation source of the public database dump (A9); round 6: read through `pubdump.v_curated_observation` (public-dump-spec section 2) |

Invariants (I-CUR):
1. I-CUR-1 Append-only: no UPDATE, DELETE or TRUNCATE succeeds for any role, including `mm_ingest`.
2. I-CUR-2 Idempotent load: loading raw object X twice inserts zero rows the second time (the second attempt finds a `raw_load` row; and, independently, insert-on-change finds no difference).
3. I-CUR-3 Insert-on-change: a row is inserted for key K only if K has no row (rows with `load_kind = 'import'` are ignored), or the new `(value, value_status)` differs from the row with the greatest `known_at` for K according to the group's comparison rule. Values are normalised to the series' `published_decimals` (`d`; fallback: smaller scale of the two values only when `d` is NULL) and equal iff `|a-b| <= max(rel_epsilon * max(|a|,|b|), 0.5 * 10^-d)`, that is, a difference of exactly half a published unit is "equal" and a larger one is a revision; `value_status` compares exactly, and two rows with `value IS NULL` (`MISS`) are equal when their statuses are equal while a change between a value and `MISS` is a status change and is inserted. Additionally, for groups with `snapshot_mode = 'diff_above_tol'` a REVISION (key exists, value differs) is inserted only if `|a-b| > max(materiality_abs, materiality_rel * |a|)` where `a` is the latest STORED value (round 4: the floor is the comparison rule's half published unit, NOT a full unit, and for series whose `ref.unit.dimension` is `ratio` (rates, % of GDP, growth) the relative term is not applied and `materiality_abs` alone decides, default one half published unit; a full-unit floor would drop typical 0.1 pp revisions of one-decimal rates); smaller changes are counted in `raw_load.rows_below_tol`. REV-01/REV-06/REV-07 use the same definition of a material revision (round 5). Because the comparison is always against the latest stored value, sub-tolerance drift accumulates until it crosses the tolerance and is then stored. New periods, status changes and tombstones are never subject to the tolerance. Exception for projection series (rows with `value_status = 'PROJ'`): the comparison row is the latest row for K with the SAME `vintage_label`, so a new edition always gets its own row even if the number is unchanged (C1; ADR-002; this interim rule stays in v1, the forecast store of ADR-011 is v2). Such rows are projection editions, not revisions: they are excluded from `curated.v_revision_history` (I-CUR-11). Exception for `import` objects: every row is inserted (idempotence comes from the `raw_load` row).
4. I-CUR-4 (restated, A5/fix 4) Two clauses. (a) Per key `(series_id, ref_period_start)`, `known_at` is strictly increasing in `obs_id` order, and `known_at` of a row equals `fetched_at` of the object referenced by `raw_id`. (b) The loader loads objects of one `(source_id, group_id)` strictly in `(fetched_at, raw_id)` order: object X is eligible only if no other object of the same group with a smaller `(fetched_at, raw_id)` is without a `raw_load` row. An ineligible object is queued (no row, check ORD-02), never loaded early. Different groups are independent, so clause (a) is additionally protected by the out-of-order guard (round 4: per series, not per object): each series of X that already has an observation with `known_at > X.fetched_at` (loaded through another group or manual file; `import` rows excluded) gets a `raw_series_status` row `skipped_out_of_order` and is not loaded from X; the other series of X load normally. Only if every series of X is skipped is the object recorded `raw_load.outcome = 'skipped_out_of_order'`. A series released from deferral (`raw_series_status`) is loaded under a new series version, so its keys have no later rows. For `edition_ordered` groups an object with an older `edition_date` than the latest loaded edition is recorded `skipped_out_of_order` (`detail.reason = 'older_edition'`) unless it carries `import_label` (PROPOSED P22; ingestion spec step 2a).
5. I-CUR-5 `load_kind = 'initial'` iff the series had no observation row (ignoring `import` rows) before the transaction that inserted it; `'tombstone'` only when the raw object has `fetch_mode = 'full'` and `fetch_scope = 'complete'` and the key is absent while its latest version is not `DEL`. A key present in the object as `MISS` is not absent and is never tombstoned; `'import'` iff the object carries `import_label`.
6. I-CUR-6 Period bounds are consistent with `ref.series.frequency` (A: 1 Jan-31 Dec; Q: calendar quarter; M: calendar month; D: single day) unless `calendar_basis <> 'CAL'`, in which case bounds come from the source and are length-checked (A: 364-366 days).
7. I-CUR-7 Replay: truncating `curated.observation` (owner role, test database only) and replaying all `raw_object`s in `(fetched_at, raw_id)` order, honouring the recorded `ingest.raw_load` and `raw_series_status` outcomes (skipped and rejected objects stay skipped), with their recorded `parser_id` and the group config as recorded at the loading run (`ref.config_history` at `ingest.run.git_sha`/`recorded_at`), reproduces identical rows compared on the NATURAL key `(source_id, dataset_id, series_key, series version, ref_period_start, known_at, value, value_status, load_kind, revision_class)`; surrogate identity ids (`series_id`, `obs_id`, `raw_id`) are never compared (A11). Prerequisites are listed in ADR-002 and B12 (ADR-003). Not possible for `hash_only` sources.
8. I-CUR-8 Projection rows (`PROJ`) are never returned by `curated.v_headline_obs_observed`.
9. I-CUR-9 (round 5) Transaction time and cutoffs. (a) A loader transaction takes `pg_advisory_xact_lock(hashtext('mm-load'))` first, then reads `t_load := clock_timestamp()` once and writes `loaded_at = t_load` on every observation row and on its `raw_load` row; the lock is held until the commit. (b) An analytics run takes the same lock in one short transaction and reads `known_cutoff = load_cutoff = clock_timestamp()` from the database. Therefore every load that committed before the cutoff has `loaded_at <= load_cutoff`, and every load that commits after the analytics transaction released the lock has `loaded_at > load_cutoff`; no load can be both unseen by the run and counted in its reproduction. (c) `loaded_at` is non-decreasing in commit order, barring a backwards step of the database clock (BRIN index assumption). Test AC-ING-15 / T-DDL-20.
10. I-CUR-10 (round 5) Rows with `load_kind = 'import'` never appear in `v_observation_latest`, `fn_observation_asof`, any `v_headline_*` view, `v_revision_history`, or any analytics or export input.
11. I-CUR-11 (second fix pass) Projection versions are never revisions. `curated.v_revision_history` contains no row with `value_status = 'PROJ'`; a key's versions are counted and ordered among non-projection versions only; adding, removing or changing any number of `PROJ` rows of a key (for example a new WEO edition that stores its projections again) leaves every row of the view unchanged; each listed key has exactly one row with `is_base_version = true`. Test T-DDL-33.

## 6. `analytics` (Python) and `analytics_r` (R)

```sql
CREATE TABLE analytics.run (
  analysis_run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- round 6 (plan BL-03 item 4): generated by the database, never supplied by the writer; mm_analytics needs USAGE on the identity sequence (section 8)
  ingest_run_id bigint NOT NULL REFERENCES ingest.run,
  as_of_run_date date NOT NULL,
  known_cutoff timestamptz NOT NULL,  -- round 5: DATABASE clock_timestamp() read in the short transaction that holds the load lock (I-CUR-9), not the runner clock
  load_cutoff timestamptz NOT NULL,   -- = known_cutoff (same read); analytics read fn_observation_asof(known_cutoff, load_cutoff); what a past run saw is reproduced with exactly this pair
  code_version text NOT NULL,
  params jsonb NOT NULL,
  -- params MUST contain {"config_sha256": "<same value as the column>", ...all indicator/transform parameters actually used (rank_period_coverage_pct, max_lag_vs_rank_period, cov_min_entities, ...)}
  git_sha text NOT NULL,
  config_asof timestamptz NOT NULL,   -- fix 9: RECORDED-time cut for configuration (ref.config_history, ops.quality_override, ops.drift_decision); default = known_cutoff
  config_sha256 text NOT NULL,      -- hash of the config/ tree at git_sha (B11); also stored in params
  mapping_sha256 text NOT NULL,     -- hash of the canonical dump of ref.series_map + ref.indicator (+ target/input/domain/entity/source-flag/global_translation tables) as read by this run
  overrides_sha256 text NOT NULL);  -- hash of the ops.quality_override rows applied
-- analysis_run_id: the analytics step inserts the run row in the cutoff transaction without an id and reads the generated id back (RETURNING); every table below
-- carries it as a plain bigint without FK (kept as in the earlier design so that a failed run can be cleaned without cascading). The id is the order of insertion, not of the cutoffs.

-- Reproduction of an earlier run R: read observations with fn_observation_asof(R.known_cutoff, R.load_cutoff); read configuration with
-- ref.fn_config_asof(table, R.config_asof); apply overrides and drift decisions with recorded_at <= R.config_asof; use R.params. The
-- recomputed mapping_sha256 / overrides_sha256 must equal the stored values (otherwise the run is not reproducible and the tool says so).
-- The analytics spec (another document) consumes these columns; only the schema side is defined here.

CREATE VIEW analytics.v_run_published AS     -- ADR-012: the only run metadata readable by mm_reader; owned by mm_owner
  SELECT analysis_run_id, ingest_run_id, as_of_run_date, known_cutoff, load_cutoff, code_version, git_sha, config_sha256
  FROM analytics.run;
-- The column set is exactly these eight columns: params, mapping_sha256, overrides_sha256 and config_asof are NOT exposed (T-DDL-26).
-- Export run selection (ADR-012 decision 3): the row with the greatest analysis_run_id whose ingest_run_id equals the ingest_run_id supplied by the workflow.

CREATE TABLE analytics.indicator_snapshot (
  analysis_run_id bigint NOT NULL, indicator_id text NOT NULL, entity_id text NOT NULL,
  series_id integer, value numeric, ref_period_end date, known_at timestamptz, source_release_at timestamptz,
  age_days integer, stale_limit_days integer, is_stale boolean,
  limit_source text NOT NULL DEFAULT 'class' CHECK (limit_source IN ('class','release_lag_aware')),   -- round 6: which rule produced stale_limit_days (analytics spec section 8)
  inherited boolean NOT NULL DEFAULT false, transformed_value numeric, transform_id text,
  publish boolean NOT NULL,               -- source publish_site = 'public' (A8)
  publish_scope text NOT NULL CHECK (publish_scope IN ('ranked','info_only','excluded')),
                                          -- round 6 (export spec 1a), computed by analytics: 'excluded' when NOT publish (withheld pair); else 'info_only' when the entity is WLD, or the indicator is descriptive_only, or every domain of the indicator is unranked or descriptive; else 'ranked' (countries and aggregates alike; aggregates carry a NULL percentile because they are not candidates). Support indicators, inputs and comparison-role series are never snapshotted and so have no scope (fix pass, export spec 1a)
  alignment text NOT NULL DEFAULT 'aligned' CHECK (alignment IN ('aligned','ahead','lagging','unaligned','n/a')),   -- B1; round 5: aligned = ranked within lag and not later than rank_reference_period; ahead = ranked, later than it; lagging = more than max_lag behind (shown, unranked); unaligned = fiscal-year basis (shown, unranked); n/a = indicator not ranked or no usable value (analytics spec 4.3)
  alignment_reason text CHECK (alignment_reason IS NULL OR alignment_reason IN ('fiscal_year_basis')),   -- round 6: why an entity is `unaligned` (analytics spec 4.3, AC-AN-14)
  ref_offset_days integer,                 -- round 6: ref_period_end minus the indicator's rank_reference_period, in days (negative = behind); NULL for unranked indicators, for entities without a usable value, and in the published view for withheld pairs
  value_kind text NOT NULL DEFAULT 'observed' CHECK (value_kind IN ('observed','estimate')),   -- round 6 (analytics spec section 2, P7): 'estimate' for A02 (latest EST year of the latest WEO edition)
  deviation numeric,                       -- transformed value minus target (target_distance indicators only)
  PRIMARY KEY (analysis_run_id, indicator_id, entity_id),
  CONSTRAINT unaligned_has_reason CHECK ((alignment = 'unaligned') = (alignment_reason IS NOT NULL))
);
-- rows exist for scope = 'country' indicators x the 44 non-global entities, and for scope = 'global' indicators x WLD only.
-- Country-level use of a WLD series is derived inside the run through ref.global_translation and appears only as transformed_value of the
-- consuming country indicator, never as a stored per-country copy of the world series.
-- The snapshot value is the latest row WITH a value; a later MISS period neither supplies a value nor resets the age (analytics spec section 1).
-- Euro-area-inherited values (inherited = true) are snapshotted and flagged but are not rank candidates (Q7 decided 2026-10-27, analytics spec 4.2): they have no row in indicator_rank.

CREATE TABLE analytics.indicator_rank (        -- FULL set (internal): all entities with a usable value
  analysis_run_id bigint NOT NULL, indicator_id text NOT NULL, entity_id text NOT NULL,
  percentile numeric NOT NULL,           -- mid-rank percentile (W + 0.5 * T) / n, T includes the entity itself (analytics spec 4.3 step 4, PROPOSED P21)
  n_ranked smallint NOT NULL, PRIMARY KEY (analysis_run_id, indicator_id, entity_id)
);
CREATE TABLE analytics.indicator_alignment (   -- B1: one row per ranked indicator
  analysis_run_id bigint NOT NULL, indicator_id text NOT NULL,
  rank_reference_period date NOT NULL,   -- renamed from modal_ref_period_end to match the analytics spec 4.3 (review round 3); position (rank_period_coverage_pct * n + 99) // 100 in the descending list of latest ref_period_end (integer arithmetic, PROPOSED P21)
  reference_period_spread_days integer NOT NULL,   -- max-min ref_period_end among ranked (aligned and ahead) entities
  n_ranked smallint NOT NULL, n_unaligned smallint NOT NULL,   -- n_unaligned = entities with alignment in ('lagging','unaligned')
  max_ref_spread_days integer NOT NULL,
  PRIMARY KEY (analysis_run_id, indicator_id)
);
CREATE TABLE analytics.scorecard (             -- FULL set (internal)
  analysis_run_id bigint NOT NULL, domain_id text NOT NULL, entity_id text NOT NULL,
  n_available smallint NOT NULL, n_defined smallint NOT NULL,       -- coverage n/N (D16); only rank-oriented indicators count (B2)
  percentile_rank numeric,                  -- round 5: the MEAN PERCENTILE OF THE DOMAIN'S INDICATORS (mean of indicator percentiles; not a percentile of the domain and not uniformly distributed; column name kept); NULL when n_available = 0 (n/a)
  rank_position smallint, n_ranked_entities smallint,   -- NULL when n_available = 0 or low_coverage
  low_coverage boolean NOT NULL DEFAULT false,          -- n_available / n_defined < ref.domain.min_coverage_for_rank (B8)
  heterogeneous_peer_set boolean NOT NULL DEFAULT false,   -- round 6 (analytics spec 4.4, review round 3): max/min of n_ranked over the domain's ranked indicators > 1.5; a property of the domain in this run, identical on every row of (analysis_run_id, domain_id) (checked by T-DDL-24)
  peer_set_size_min smallint, peer_set_size_max smallint,  -- round 6: min and max of indicator_rank.n_ranked over the domain's ranked indicators (export field peer_set_size_by_indicator {min, max}); NULL when the domain has no ranked indicator with candidates
  PRIMARY KEY (analysis_run_id, domain_id, entity_id)
);
CREATE TABLE analytics.indicator_rank_published      (LIKE analytics.indicator_rank      INCLUDING ALL,
  publish_scope text NOT NULL CHECK (publish_scope = 'ranked'));
CREATE TABLE analytics.indicator_alignment_published (LIKE analytics.indicator_alignment INCLUDING ALL,
  publish_scope text NOT NULL CHECK (publish_scope = 'ranked'));
CREATE TABLE analytics.scorecard_published           (LIKE analytics.scorecard           INCLUDING ALL,
  publish_scope text NOT NULL CHECK (publish_scope IN ('ranked','info_only')));
-- *_published tables are computed by the same analytics code over the PUBLISHABLE set only (indicator x entity pairs whose headline
-- series belongs to a source with publish_site = 'public'). Their percentiles, ranks, n_ranked, n_available, spread, rank reference period,
-- peer-set sizes and heterogeneity flag are therefore functions of published values only; no value of a withheld source influences them. The export reads only these (A8).
-- Round 6: every row of the three published tables carries publish_scope (export spec section 1a), set by analytics with the rule documented on
-- indicator_snapshot.publish_scope; rank and alignment rows exist only for ranked indicators, so their scope is always 'ranked'; scorecard rows are 'ranked' for a ranked, eligible domain
-- and 'info_only' for unranked or descriptive domains and for WLD. The 'excluded' scope exists only on the snapshot (withheld pairs: placeholders without values).

CREATE TABLE analytics.alert (
  analysis_run_id bigint NOT NULL, indicator_id text NOT NULL, entity_id text NOT NULL, series_id integer NOT NULL,
  ref_period_end date NOT NULL, method text NOT NULL,
  window_obs smallint NOT NULL,             -- configured window length
  n_obs smallint NOT NULL,                  -- observations actually in the window; the window ENDS AT THE PREVIOUS observation and excludes the current one (B10)
  z numeric, level text NOT NULL CHECK (level IN ('none','watch','alert')),
  confidence text NOT NULL CHECK (confidence IN ('full','low','none')),
  reason text CHECK (reason IS NULL OR reason IN ('mad_zero','sd_zero','below_min_obs','stale','no_window')),
                                            -- 'mad_zero' (robust_z, MAD = 0) | 'sd_zero' (z, window sd = 0; level none, z NULL; round 5) | 'below_min_obs' | 'stale' | 'no_window' | NULL when evaluated normally (B10)
  label text CHECK (label IS NULL OR label IN ('persistent_shift')),   -- round 5: after 3 consecutive alerts on the same series; the level is unchanged and the window is not re-based
  override_rule text,                       -- the fixed override that fired, including its entity_group (PROPOSED P19); always NULL in v1 (no shipped override)
  publish boolean NOT NULL,                 -- A8: FALSE for series of withheld sources; such rows never reach alerts.json
  PRIMARY KEY (analysis_run_id, indicator_id, entity_id)
);
CREATE VIEW analytics.v_alert_published AS SELECT * FROM analytics.alert WHERE publish;
CREATE VIEW analytics.v_indicator_snapshot_published AS   -- value, transformed_value, deviation, ref_offset_days nulled where NOT publish
  SELECT analysis_run_id, indicator_id, entity_id, series_id, ref_period_end, known_at, source_release_at, age_days, stale_limit_days,
         limit_source, is_stale, inherited, transform_id, alignment, alignment_reason, value_kind, publish, publish_scope,
         CASE WHEN publish THEN value END AS value, CASE WHEN publish THEN transformed_value END AS transformed_value,
         CASE WHEN publish THEN deviation END AS deviation, CASE WHEN publish THEN ref_offset_days END AS ref_offset_days
  FROM analytics.indicator_snapshot;
-- analytics_r.* : free-form per module, but every table MUST contain
--   analysis_run_id bigint, module text, method text, package_versions jsonb, known_cutoff timestamptz, created_at timestamptz
```
Transformed full time series are not persisted (derivable); only snapshot, ranks, alignment, alerts and scorecards per run.

Round 6 note on "never derived by the export": every field that the export spec lists as coming from analytics (`ref_offset_days`, `value_kind`, `limit_source`, the fiscal-year reason, `heterogeneous_peer_set`, `peer_set_size_by_indicator`, `publish_scope`, `rank_reference_period`, `reference_period_spread_days`) has exactly one stored column above or in `indicator_alignment`; the export copies it (AC-EXP-11).

## 7. `ops`

```sql
CREATE TABLE ops.validation_result (run_id bigint, check_id text, severity text CHECK (severity IN ('info','warn','error')),
  source_id text, subject text, passed boolean, metric numeric, threshold numeric, detail jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE ops.drift_event (event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id bigint, source_id text, raw_id bigint,
  kind text CHECK (kind IN ('unit','base_period','seasonal_adjustment','frequency','flow_basis','classification','composition',
                            'dataset_moved','mass_revision','schema_drift','precision_change')),   -- round 5: 'schema' renamed 'schema_drift' (matches WEO-01 and the analytics spec); added 'precision_change' (ADR-002, PRECISION-01), 'composition' (euro-area membership/composition change, ADR-009) and 'flow_basis' (P18)
  series_ref text, old jsonb, new jsonb,
  status text DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),   -- denormalised CACHE of the latest ops.drift_decision
  decided_by text, decided_on date, note text,
  created_at timestamptz NOT NULL DEFAULT now());
-- UPDATE only on (status, decided_by, decided_on, note), column-level grant, and only by the decide step together with an INSERT into
-- ops.drift_decision in the same transaction (trigger checks it). The authoritative decision history is ops.drift_decision.
-- accepted => the loader re-attempts the blocked raw object / deferred series from stored raw bytes (no refetch); rejected => raw_load.outcome = 'rejected'
-- or raw_series_status 'rejected'.
-- Kinds and their raisers: unit, base_period, seasonal_adjustment, frequency, flow_basis, classification = META-02 (measurement attribute differs from
-- the stored series; series deferred, new version on acceptance); composition = euro-area membership/composition change of a CHANGING series (ADR-009);
-- dataset_moved = preflight structure check; mass_revision = REV-01, REV-06 cap, DB-05 (round 6: never REV-07, which is report-only, ADR-017); schema_drift = PARSE-01 structure change and WEO-01
-- (missing Estimates Start After); precision_change = PRECISION-01 (published_decimals increased). An older manual edition is NOT a drift event: it is
-- a terminal skipped_out_of_order outcome with check ORD-03 (a human resubmits it with import_label if wanted).
CREATE TABLE ops.drift_decision (            -- fix 9: append-only decision history with valid and recorded time
  decision_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id     bigint NOT NULL REFERENCES ops.drift_event,
  decision     text NOT NULL CHECK (decision IN ('accepted','rejected','reopened')),
  effective_from timestamptz,                -- valid time: from when the decision applies (NULL = from the event's raw object)
  decided_by   text NOT NULL, decided_on date NOT NULL, note text,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  git_sha      text                          -- config commit that implemented an accepted decision (mapping switch), if any
);
CREATE TABLE ops.quality_override (override_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id integer, ref_period_start date, known_at timestamptz,         -- target version of the observation (valid-time scope)
  decision text CHECK (decision IN ('exclude','include')), reason text NOT NULL, decided_by text NOT NULL, decided_on date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),                          -- fix 9: recorded time
  supersedes_override_id bigint REFERENCES ops.quality_override);          -- a later row for the same target supersedes; no UPDATE ever
-- Overrides applied by an analytics run = for each target the row with the greatest recorded_at <= analytics.run.config_asof.
CREATE TABLE ops.run_summary (run_id bigint PRIMARY KEY, neon_connect_ms integer, db_bytes bigint,
  groups jsonb NOT NULL,  -- per group load results (written by mm_ingest only)
  new_raw_objects integer, new_observations integer, revisions integer, alerts_opened integer, cu_hours_note text,
  runner_clock_offset_ms integer);   -- round 5 (BB25): measured runner-to-database clock offset applied to fetched_at
-- Round 6: the counters of ops.run_summary are INTERNAL totals over all sources (written by mm_ingest for the internal monitor). `alerts_opened` stays NULL here because
-- mm_ingest has no privilege on analytics.* (ADR-012). The public status uses ops.v_run_summary_public, which computes its own published-scope counts and never reads these four columns.
CREATE TABLE ops.export_status (             -- fix 6: export status is its own insert-only table, written by `record-export` under mm_ingest
  export_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint NOT NULL, analysis_run_id bigint, recorded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('ok','partial','failed')), duration_ms integer, bytes_read bigint, file_counts jsonb NOT NULL DEFAULT '{}',
  detail jsonb NOT NULL DEFAULT '{}');
CREATE TABLE ops.freshness_state (source_group text, series_group text, evaluated_at timestamptz, expected_period_end date,
  latest_period_end date, state text CHECK (state IN ('fresh','late','stale','broken')), PRIMARY KEY (source_group, series_group, evaluated_at));
CREATE TABLE ops.schema_migration (version int PRIMARY KEY, name text, checksum text, applied_at timestamptz);
```
Views for `mm_reader` (no raw error text, no `old`/`new` JSON, no `db_bytes`): `ops.v_freshness_latest`, `ops.v_run_summary_public`, `ops.v_validation_counts` (counts by severity and check family for the run, including COV-01 detail with `n_qualifying` or `not_yet_measurable`), `ops.v_open_drift` (event id, source_id, kind, status), `ops.v_manual_sources` (next expected manual download and date of last ingested manual file), `ops.v_backlog` (number of unloaded raw objects and age of the oldest), `ops.v_export_status_latest`.

`ops.v_run_summary_public` (round 6, ADR-012 decision 2; owned by `mm_owner`; the only run counters readable by `mm_reader`). One row per `ingest.run`. Columns, exactly:

| Column | Definition |
|---|---|
| `ingest_run_id` | `ingest.run.run_id` |
| `workflow`, `mode`, `status`, `started_at`, `finished_at` | the same-named columns of `ingest.run` |
| `new_raw_objects` | number of `ingest.raw_object` rows with `run_id` = the run whose source has `publish_site = 'public'` |
| `new_observations` | number of PUBLISHED-SCOPE observation rows loaded by the run (`curated.observation.run_id` = the run, `load_kind IN ('initial','new_period')`) |
| `revisions` | number of published-scope observation rows loaded by the run with `load_kind IN ('revision','tombstone')` |
| `alerts_opened` | number of rows of `analytics.alert` with `publish` and `level IN ('watch','alert')` in the analysis run selected for this ingest run (the greatest `analysis_run_id` with `ingest_run_id` = the run); NULL when no analysis run exists. The name is kept for compatibility: it counts published watch or alert rows of the run, not alerts newly opened against the previous run |
"Published-scope observation row" = a row of `curated.observation` with `load_kind <> 'import'` and (second fix pass) `value_status <> 'PROJ'` whose series has a headline mapping valid at `ref_period_start` to an indicator with `kind = 'indicator'` and whose source has `publish_site = 'public'` (the same restriction as `curated.v_revision_history`; projections have no dashboard output in v1 and a stored projection edition is not a revision, so `new_observations` and `revisions` do not count `PROJ` rows). The view finds rows through `ingest.raw_load.load_run_id` and the `obs_raw` index, not by scanning `curated.observation`. It exposes no `db_bytes`, no connection timings, no `groups` JSON. A change of any value of a withheld source changes no column of the view (T-DDL-29).

## 8. Roles and privileges (A7, normative)

Role-per-purpose (ADR-008). `mm_owner` runs DDL only (`migrate`). Application roles never own objects. The pipeline step that holds a role is the only place its secret is exposed. The same matrix is summarised per role in ADR-008 (non-normative since ADR-012); this section is the normative cell-by-cell version and the source of the expected-matrix fixture of T-DDL-10.

| Object | `mm_owner` | `mm_ingest` | `mm_analytics` | `mm_r` | `mm_reader` |
|---|---|---|---|---|---|
| `ref.*` configuration tables (source, series_group, entity, entity_group_member, unit, domain, indicator, indicator_domain, indicator_input, indicator_target, series_map, inheritance_rule, global_translation) | DDL | SELECT, INSERT, UPDATE (written by `sync-config` in `plan`, and by the loader for `series_map` rows at first sight of a series; no DELETE: rows are closed with `valid_to`/`enabled = false`) | SELECT | SELECT | SELECT on entity, entity_group_member, domain, indicator (without `params`/`alert_override`), indicator_domain; `ref.v_source_public` |
| `ref.config_history` | DDL (and trigger function owner) | SELECT; INSERT only through the trigger function | SELECT | SELECT | none |
| `ref.series` | DDL | SELECT, INSERT (sync-config never; the loader at first sight, ADR-018), UPDATE(`is_active`,`published_decimals`) | SELECT | SELECT | via `ref.v_series_export` |
| `ingest.run` | DDL | SELECT, INSERT, UPDATE(`status`,`finished_at`) | SELECT | none | none |
| `ingest.request_state` | DDL | SELECT, INSERT, UPDATE | none | none | none |
| `ingest.raw_blob`, `raw_object`, `raw_snapshot`, `raw_load`, `raw_series_status`, `fetch_attempt` | DDL | SELECT, INSERT | none | none | none |
| `staging.*` | DDL | SELECT, INSERT, DELETE (no UPDATE, no TRUNCATE) | none | none | none |
| `curated.observation` | DDL | SELECT, INSERT (no UPDATE/DELETE/TRUNCATE) | SELECT | none | none |
| `curated.v_*` (latest, series_obs, headline, headline_observed, comparison) and `fn_observation_asof` | DDL | SELECT | SELECT | SELECT | none |
| `curated.v_headline_obs_published`, `curated.v_revision_history`, `curated.v_input_obs_published` | DDL | SELECT | SELECT | SELECT | SELECT |
| `curated.v_observation_public` | DDL | SELECT (public dump) | none | none | none |
| `pubdump.v_*` (round 6, ADR-015) | DDL | SELECT (public dump; the only objects the dump reads) | none | none | none |
| `analytics.run`, internal tables (`indicator_snapshot`, `indicator_rank`, `indicator_alignment`, `scorecard`, `alert`) | DDL | none | SELECT, INSERT | SELECT | none |
| `analytics.v_run_published` (ADR-012) | DDL | none | SELECT | SELECT | SELECT |
| `analytics.*_published` tables, `v_alert_published`, `v_indicator_snapshot_published` | DDL | none | SELECT, INSERT | SELECT | SELECT |
| `analytics_r.*` | DDL | none | none | SELECT, INSERT | none |
| `ops.validation_result`, `ops.freshness_state` | DDL | SELECT, INSERT | SELECT | none | via `ops.v_*` |
| `ops.run_summary` | DDL | SELECT, INSERT, UPDATE | SELECT | none | via `ops.v_run_summary_public` (the view does not read this table) |
| `ops.export_status` | DDL | SELECT, INSERT | SELECT | none | via `ops.v_export_status_latest` |
| `ops.drift_event` | DDL | SELECT, INSERT, UPDATE(`status`,`decided_by`,`decided_on`,`note`) | SELECT | none | via `ops.v_open_drift` |
| `ops.drift_decision` | DDL | SELECT, INSERT | SELECT | none | none |
| `ops.quality_override` | DDL | SELECT, INSERT | SELECT | none | none |
| `ops.schema_migration` | DDL | SELECT | none | none | none |
| identity sequences (`analytics.run_analysis_run_id_seq` and the sequences of the other generated ids) | DDL | USAGE on the sequences of its own tables | USAGE on `analytics.run_analysis_run_id_seq` | none | none |

Notes:
- `mm_reader` has no INSERT/UPDATE/DELETE anywhere and no SELECT on any base table that holds unpublished data. The export result is returned by the `export` step as `export-status.json` inside the workflow artifact; the `finalize` step runs `macro-monitor record-export --status-file export-status.json` under `mm_ingest`, which INSERTs one row into `ops.export_status` (no longer merged into `ops.run_summary.groups`, which only the loader writes). `mm_reader` is never used to write, and the `site` job never holds a database secret. The revisions export reads `curated.v_revision_history` (SELECT granted), never `curated.observation`.
- Why no `mm_export` role: a separate writing role would add a sixth secret for one INSERT; `record-export` under `mm_ingest` into a dedicated insert-only table gives the same isolation with no new role. If the user prefers it, a role with INSERT on `ops.export_status` only can replace it without schema change.
- `mm_ingest` needs the privileges in its column because: `UPDATE` on `ingest.run`/`request_state`/`run_summary`/`drift_event` (state tables, column-restricted where it is a decision table), `DELETE` on `staging.*` (per-raw_id cleanup, S-4/S-5), INSERT/UPDATE on `ref.*` (`sync-config`, discovery, first-sight series creation). It has no TRUNCATE anywhere and cannot UPDATE or DELETE `curated.observation`, any `ingest.raw_*` or any history table. ADR-012: it has no privilege on any `analytics.*` or `analytics_r.*` object.
- `mm_reader` can read only published data: it has no privilege on internal analytics tables or on unfiltered observation views (A8). ADR-012: it reads run metadata only through `analytics.v_run_published` and `ops.v_run_summary_public`; it has no privilege on `analytics.run`, `ingest.run` or `ops.run_summary`.
- Who applies decisions: `drift_event` decisions and `quality_override` rows are applied by the dispatch-only `decide` workflow (workflows spec section 11) under `mm_ingest`; the workflow records `github.actor` as `decided_by` and takes workflow inputs through environment variables, not string interpolation. The database cannot tell this workflow from the loader (same role); the separation is by workflow design and by the column-level UPDATE grant. This residual limitation is accepted.
- Identity sequences need USAGE for inserting roles; `ALTER DEFAULT PRIVILEGES` must not widen the matrix. `mm_ingest` may not create objects.
- `mm_r` has no privilege on `curated.observation`, `ingest.*`, `staging.*` or `ops.*`.
- Advisory-lock functions (`pg_advisory_xact_lock`) are executable by every role by default; the `mm_analytics` cutoff transaction (I-CUR-9) therefore needs no extra grant. T-DDL-10 asserts that it works under `mm_analytics`.
- Round 6: the views of `pubdump` and `analytics.v_run_published` / `ops.v_run_summary_public` run with their owner's rights (standard PostgreSQL view behaviour; they must not be declared `security_invoker` [general PostgreSQL behaviour, UNVERIFIED on Neon]); a test asserts that `mm_reader` cannot read the base tables they read (T-DDL-26, T-DDL-29). The same holds for `ref.v_series_export` and `ref.v_source_public` (fix pass, T-DDL-32).

## 9. Size and performance expectations (analyst estimates, unmeasured)
- Base case (insert-on-change, regular revisions): `curated.observation` about 0.5 M rows initially, about 20 k rows/month later. Row size (round 4, corrected; round 5, propagated to every document): the heap tuple carries 23 bytes of header, 8+4+8+numeric+8x3 timestamps/ids and four repeated short text columns (`value_status`, `quality_flag`, `load_kind`, `revision_class`), so about 130-150 bytes, plus the primary key, the unique key and `obs_raw` indexes, about 220-300 bytes per row [analyst estimate, unmeasured; the earlier 150-200 was low]. That gives about 110-150 MB at start and about 60-70 MB/year, and every figure below that multiplies rows by bytes uses the same 220-300 range (about 270 bytes as the central value). Reduce with `smallint` codes or enum types for the four status columns if AC-OPS-9 measures more.
- Re-estimating families, previous estimate (exact insert-on-change): OECD CLI (M05) about 45 entities x 420 months = about 19 k keys revised monthly = about 227 k rows/year; BIS credit gap (Q06) about 40 x 140 = about 5.6 k keys revised quarterly = about 22 k rows/year; source-SA monthly series revised over 3 years (about 1,500 series x 36 months = about 54 k rows/month) = about 650 k rows/year; total with base about 1.1 M rows/year = about 240-330 MB/year (round 5: was 165-220 MB at the old row size).
- Worst case (added 2026-10-18): the previous SA figure assumes only 3 years are revised. If the SA monthly set is about 1,300 series x 400 observations (about 33 years) and the source re-estimates the whole history at each release, with exact (published-precision) comparison most keys change: about 520 k rows/month = about 6.2 M rows/year = about 1.7 GB/year (1.4-1.9 GB at 220-300 bytes; round 5, was 0.9-1.25 GB at the old row size). The 1 GB limit would be exceeded in the first year, in about seven months at this rate. Eurostat SA, OECD CLI and BIS gap (one-sided HP filter) behave like this by construction [analyst reasoning, not measured]. Exact insert-on-change is therefore NOT viable for such groups, and the earlier statement that guards DB-02/DB-05 contain the problem was too weak: they detect it only after the storage is consumed.
- Mitigation (decided, ADR-002): groups with `reestimating: true` and `snapshot_mode: diff_above_tol` (default for all SA/model-estimated groups) store the full vintage as a Parquet snapshot in the raw release (`ingest.raw_snapshot`, outside Neon, immutable, free) and load into Neon only the keys whose value moved by more than the tolerance (`materiality_abs`/`materiality_rel`; proposed default relative 0.001 of the stored value, with an absolute floor of half a unit of the last published digit, the comparison rule; round 5: was "never below one unit", which contradicted I-CUR-3) plus all new periods. If 5-15 % of keys cross the tolerance per release (assumed, unmeasured), the SA worst case becomes about 26-78 k rows/month = about 0.3-0.9 M rows/year = about 80-250 MB/year at about 270 bytes per row (round 5: was 50-190 MB); CLI and BIS gap shrink similarly. Spike AC-OPS-8: measure the share of keys above tolerance on the first three real releases of each reestimating group before enabling more than the core set, and set the tolerance from the measurement.
- Honest trade-off: Neon no longer holds every re-estimated vintage of those series. `fn_observation_asof` returns the last stored (above-tolerance) value, which can differ from the value the source published at the as-of time by less than the tolerance (accumulated drift is bounded because comparison is against the latest stored value). Exact reconstruction of any vintage needs the Parquet snapshots, which Python/R can read outside the database; the dashboard and alert windows use Neon values. Revision statistics for these groups understate small revisions and must be labelled so. Groups with `reestimating: false` keep exact vintage history (this includes the named-edition WEO group, ADR-017: every edition's revisions are stored exactly).
- Guards: DB-02 warns above 700 MB and errors above 900 MB and also warns when the linear extrapolation of the last 6 months' growth reaches 900 MB within 12 months; DB-05 limits rows inserted per raw object (`max_insert_rows_per_load`, default 100,000, per group override); reestimating groups carry `max_revised_rows` (REV-06). Further mitigations if the projection still trips: disable ext/opt re-estimating families (M05 is `ext`), or a retention ADR (latest vintage plus yearly snapshots); open question Q18 in the design doc.
- `staging`: peak below 200 MB with whitelist filtering; rows are deleted after load and swept after 14 days (S-4, S-5). Review round 3: DELETE does not shrink a table, so the staging peak stays resident in the 1 GB budget until a rewrite; plan the budget as curated + staging peak + the tables below. Whether Neon's 6 h change history counts against the 1 GB is [UNVERIFIED].
- Other growth, previously not budgeted (review round 3): `ingest.fetch_attempt`, `ingest.raw_load.detail`, `ops.validation_result`, per-run `analytics.*`. Proposed default retention (user to confirm): keep row-level detail 24 months, aggregate older rows into monthly summary tables; NEVER delete `ingest.raw_object`, `ingest.raw_load` or `ingest.raw_blob` rows (only compact/null the `detail` column). Spike AC-OPS-9 (defined in the design document section 11): after three real runs record staging peak and per-table growth and add the measured steady state to DB-02.
- Neon Free limit 1 GB per project (https://neon.com/docs/introduction/plans, accessed 2026-10-17).
- `v_observation_latest` over 0.5-1 M rows must return one series history in under 200 ms warm; if measurement disagrees, replace with a maintained `curated.latest_cache` table updated by the loader in the same transaction (derived, rebuildable, not a source of truth).

## 10. Acceptance tests for this spec
- T-DDL-1: all invariants I-ING-1..7 and I-CUR-1..11 have a test against a Postgres service container.
- T-DDL-2: `UPDATE`/`DELETE` on `curated.observation` as `mm_ingest` fails.
- T-DDL-3: inserting a series without unit, frequency, seasonal adjustment or source fails (NOT NULL/CHECK).
- T-DDL-4: two headline mappings for the same (indicator, entity, window) fail (constraint or loader test).
- T-DDL-5: migrations apply to an empty database; a changed checksum of an applied file is rejected.
- T-DDL-6: updating a measurement attribute of `ref.series` (including `flow_basis`) fails; a new version row succeeds.
- T-DDL-7 (A1): inserting three `raw_object` rows for one request_key with sha256 A, B, A (distinct `fetched_at`) succeeds and creates two `raw_blob` rows; inserting a row whose sha256 equals that of its `prev_raw_id` is rejected (except the `hash_only` / `bytes_unavailable` case of I-ING-2, which succeeds once); a duplicate `(source_id, request_key, fetched_at)` is rejected; a row with `fetch_mode = 'incremental'` and `fetch_scope = 'complete'` is rejected; a row with `import_label` and `manual = false` is rejected.
- T-DDL-8 (A2): `ingest.v_raw_unloaded` lists exactly the objects without a `raw_load` row; a second `raw_load` row for the same `raw_id` fails; UPDATE/DELETE on `raw_load`, `raw_series_status` and `raw_object` fail for `mm_ingest`; `ingest.v_series_deferred` lists a deferred series until a `loaded` or `rejected` status row exists; `request_state.last_loaded_sha256` changes only with a `loaded` row (I-ING-6).
- T-DDL-9 (B2, B5, B6; revised in round 5 and in the fix pass): `rank_mode`/`good_dir` check rejects (`monotone_good`, 0) and (`descriptive_only`, 1) and (`target_distance`, 1); inserting an indicator without `rank_mode` fails (no default); `display_dir` 1 with `descriptive_only` and `good_dir` 0 is accepted and `display_dir` 2 is rejected; an `input` indicator with a domain row, a rank mode other than `descriptive_only` or an alert method other than `none` is rejected; `is_support` is true exactly for `kind = 'input'`; `is_global` entity must be an aggregate and unranked; `WLD` exists after `sync-config`; a `ref.global_translation` row with `weighted_by_input` and no weight input is rejected; `ref.indicator_input.annualised_policy` equal to `latest_single` (or any value other than `fail`) is rejected and the default `fail` is accepted.
- T-DDL-10 (A7; extended in round 6 for ADR-012, ADR-015): role-privilege test. A parametrised test reads `has_table_privilege`/`has_column_privilege` for every (role, object) cell of the section 8 matrix against a checked-in expected matrix and fails on any difference. The expected matrix is derived from this section only, not from the ADR-008 summary. Explicit negatives: `mm_reader` cannot INSERT/UPDATE/DELETE on any object; `mm_reader` cannot SELECT `curated.observation`, `analytics.scorecard`, `analytics.alert`, `analytics.run`, `ingest.run`, `ops.run_summary`, `ref.config_history` or `ingest.*`; `mm_ingest` cannot SELECT `analytics.run` or any other `analytics.*` / `analytics_r.*` object; `mm_reader` can SELECT `curated.v_revision_history`, `analytics.v_run_published` and `ops.v_run_summary_public`; `mm_ingest` cannot UPDATE `curated.observation` and has no TRUNCATE on `staging.*`; `mm_ingest` can INSERT `ops.export_status`; `mm_ingest` can SELECT every `pubdump.v_*` view and no other role can; `mm_analytics` cannot write outside `analytics` and has USAGE on `analytics.run_analysis_run_id_seq`; `mm_r` cannot write outside `analytics_r`; `mm_analytics` can execute `pg_advisory_xact_lock`.
- T-DDL-11 (A9; revised in round 5 and round 6): with a fixture source of `archive_mode = 'hash_only'` and another of `publish_site = 'withheld'`, `curated.v_observation_public` returns none of their rows and the decompressed CSV files of the public dump contain none of their distinctive values (byte search; full test AC-DUMP-2 of `docs/specs/public-dump-spec.md`); a dump with only public/public sources equals the full dump; inserting a source with `archive_mode = 'private'` through `sync-config` is rejected while no private repository is configured (the CHECK itself still allows the value).
- T-DDL-12 (A8): `mm_reader` can SELECT `analytics.scorecard_published` and cannot SELECT `analytics.scorecard`.
- T-DDL-13 (A4): a revised-only-by-float-noise value (for example 2.1 versus 2.1000000001, or 2.10 versus 2.1) inserts no row; a change at the first published decimal inserts a revision; a PROJ value with a new `vintage_label` and the same number inserts a row; with `published_decimals = 1`, 2.14 versus 2.1 inserts no row and 2.16 versus 2.1 does; with `published_decimals = 2`, a difference of exactly 0.005 inserts no row and 0.01 does.
- T-DDL-14 (B12): every distinct `parser_id` in `ingest.raw_object` resolves in the parser registry (shared with the registry test of the ingestion spec).
- T-DDL-15 (fix 5): for a group with `snapshot_mode = 'diff_above_tol'`, a release revising 100 % of keys by less than the tolerance inserts zero revision rows, `raw_load.rows_below_tol` equals the revised key count, a `raw_snapshot` row exists; repeated sub-tolerance drifts accumulate and the row is inserted when the cumulative difference from the stored value crosses the tolerance; a `new_period` key is inserted regardless of tolerance.
- T-DDL-16 (fix 9): after changing `series_map` and `indicator.params` in two successive `sync-config` runs, `ref.fn_config_asof` for a time between them returns the first state; `ref.config_history` rejects UPDATE/DELETE; `ops.quality_override` and `ops.drift_decision` rows are never updated, and a later override for the same target supersedes the earlier one only for runs with `config_asof` after its `recorded_at`; changing `ref.source.publish_site`, `ref.entity.is_ranked` and `ref.domain.is_ranked` each writes a `config_history` row (round 5).
- T-DDL-17 (fix 4): objects O1 < O2 of one group: loading O2 while O1 is unloaded is refused (no row); an object whose series has a later `known_at` is recorded `skipped_out_of_order`.
- T-DDL-18 (fix 8): `sync-config` rejects a headline mapping of an indicator with `sa_required` to a series whose `seasonal_adjustment` is `CA` or `NSA`.
- T-DDL-19 (round 5, `MISS`): inserting `value_status = 'MISS'` with a non-NULL value, or `OBS` with a NULL value, fails `obs_value_presence`; `MISS` with NULL value succeeds; `v_observation_latest` returns a `MISS` row with NULL value and omits a key whose latest version is `DEL`; a value followed by `MISS` followed by the same value yields three rows.
- T-DDL-20 (round 5, I-CUR-9): two sessions: loader session takes the lock, reads `t_load`, inserts and waits; analytics session requests its cutoffs and blocks; after the loader commits, the analytics cutoff is `>= t_load` and `fn_observation_asof(c, c)` includes the loader's rows; a load that begins after the cutoff has `loaded_at > c`; a test with `transaction_timestamp()` used instead would fail the first assertion (regression guard).
- T-DDL-21 (round 5): `ops.drift_event` accepts each kind of the CHECK list (`precision_change`, `composition`, `flow_basis`, `schema_drift` among them) and rejects the retired literal `schema`.
- T-DDL-22 (round 5, `import` and revision view; extended in the fix pass and in the second fix pass): a `load_kind = 'import'` row is absent from `v_observation_latest`, `fn_observation_asof`, `v_headline_obs_observed` and `v_revision_history` but present in `v_observation_public`; `v_revision_history` contains no row of an `X01` input series or of a `comparison`-role mapping; `v_revision_history` has the column `edition_ordered`, true for the revision rows of a fixture series whose group is `edition_ordered` and false for every other row; its column set is exactly the list of section 5 (including `value_status` and `is_base_version`); the projection rule is tested by T-DDL-33.
- T-DDL-23 (round 5, flow basis): `ref.series.flow_basis` outside the four values is rejected; changing it on an existing series fails (immutable), a new version succeeds.
- T-DDL-24 (round 6, `publish_scope` and snapshot columns): inserting a row into `indicator_rank_published`, `indicator_alignment_published` or `scorecard_published` without `publish_scope` fails; `indicator_rank_published` and `indicator_alignment_published` reject any scope other than `ranked`, and `scorecard_published` rejects `excluded`; `indicator_snapshot` rejects `alignment = 'unaligned'` without `alignment_reason`, and a reason on any other alignment; `value_kind` outside (`observed`, `estimate`) and `limit_source` outside (`class`, `release_lag_aware`) are rejected; `v_indicator_snapshot_published` has exactly the columns of the view definition, returns `publish_scope = 'excluded'` and NULL `value`, `transformed_value`, `deviation`, `ref_offset_days` for a withheld pair, and passes `value_kind` and `alignment_reason` unchanged; on a fixture run all rows of one `(analysis_run_id, domain_id)` in `scorecard` and `scorecard_published` carry identical `heterogeneous_peer_set`, `peer_set_size_min` and `peer_set_size_max`.
- T-DDL-25 (round 6, `ref.series` creation, ADR-018): a fixture object with a mapped, previously unseen series creates exactly one `ref.series` row (version 1, `first_seen_at` = the object's `fetched_at`, metadata equal to `staging.series_meta_load`) and the declared `ref.series_map` rows in the same transaction; a second load creates none; metadata that differs from `expect` creates no row, raises a drift event and defers the series; an unknown `unit_code` creates no row; a series not in the series map is never created; `sync-config` run before the first load reports the map entry as pending and inserts no `ref.series_map` row; `mm_ingest` can INSERT `ref.series` but cannot UPDATE a measurement attribute.
- T-DDL-26 (round 6, ADR-012): `analytics.v_run_published` has exactly the columns `analysis_run_id, ingest_run_id, as_of_run_date, known_cutoff, load_cutoff, code_version, git_sha, config_sha256`; `mm_reader` can SELECT the view, cannot select `params` (or any column that is not in the view) and cannot SELECT `analytics.run`, `ingest.run` or `ops.run_summary`; `mm_ingest` and `mm_reader` cannot SELECT `analytics.run`; `ops.v_run_summary_public` has exactly the columns of section 7; the export run-selection query (greatest `analysis_run_id` for a given `ingest_run_id`) returns no row when no analysis run exists for that ingest run.
- T-DDL-27 (round 6, ADR-014 columns): inserting an indicator without `stationarity_class` or without `release_lag_aware` fails (no default); a `stationarity_class` outside the three values is rejected; changing either column writes a `ref.config_history` row (table `indicator`).
- T-DDL-28 (round 6, run id generator): two `analytics.run` inserts by `mm_analytics` without an id get distinct, increasing `analysis_run_id`; supplying an explicit id is rejected (`GENERATED ALWAYS`); `mm_ingest` cannot insert into `analytics.run`; `mm_analytics` can read the generated id back with `RETURNING`.
- T-DDL-29 (round 6, `ops.v_run_summary_public`; extended in the second fix pass): fixture with one `public` and one `withheld` source, both loading new periods and revisions and both producing alerts in one run: `new_raw_objects`, `new_observations`, `revisions` and `alerts_opened` count only the public source; changing every value of the withheld source (and re-running analytics) changes no column of the view row; `alerts_opened` is NULL for an ingest run without an analysis run; imports, input-indicator rows and comparison-role rows are not counted; `PROJ` rows (a new projection edition stored for a headline mapping of a scored indicator, loaded as `initial`, `new_period` or `revision`) are not counted in `new_observations` or `revisions`; `mm_reader` cannot read `db_bytes`.
- T-DDL-30 (round 6, ADR-017): inserting a `ref.series_group` with `edition_ordered` and `reestimating` both true fails; a group with `edition_ordered` true and `reestimating` false is accepted.
- T-DDL-31 (round 6, ADR-015): the set of tables in the schemas `ref`, `ingest`, `staging`, `curated`, `analytics`, `analytics_r`, `ops` equals the union of the dump targets and the explicit dump exclusions of `docs/specs/public-dump-spec.md` section 2 (AC-DUMP-6); the privilege rows for `pubdump.v_*` are in the expected matrix.
- T-DDL-32 (fix pass, export views): `ref.v_series_export` has exactly the columns listed in section 2 (`series_id, indicator_id, entity_id, source_id, source_name, series_key, frequency, unit_code, unit_mult, base_period, seasonal_adjustment, price_basis, flow_basis, calendar_basis, inherited, licence_attribution, publish, reestimating`) and no column named `published_precision` or `source_url`; on a fixture with a public source, a withheld source, a support-input mapping and a comparison-role mapping the view has a row for each headline mapping of a `kind = 'indicator'` indicator including the withheld source (with `publish = 'withheld'`, metadata only) and no row for the input or the comparison mapping; `reestimating` is true for a `reestimating` group and false for the named-edition WEO group; `inherited` is true exactly for (indicator, entity) pairs with a valid `ref.inheritance_rule`; `ref.v_source_public` has exactly `source_id, provider, attribution, licence_id, publish_site`; `mm_reader` can SELECT both views and cannot SELECT `ref.series`, `ref.series_group` or `ref.source`.
- T-DDL-33 (second fix pass; I-CUR-11, projections are not revisions): fixture with a public named-edition group (`edition_ordered`) and four headline mappings of indicators with `kind = 'indicator'`, loaded through the loader path (or inserted as `mm_ingest`, the only role that can insert observations; no role can delete or update them): (S1) an A03-like series with only `PROJ` rows over three editions (`vintage_label` WEO-2026-04, WEO-2026-10, WEO-2027-04) whose numbers differ; (S2) an A05-like series with a history year Y1 stored as `OBS` and revised once (two non-projection versions) and projection years Y2, Y3 stored as `PROJ` for each of the three editions with changing numbers; (S3) a key K stored as `PROJ` (edition 1), `EST` (edition 2) and `EST` with a changed value (edition 3); (S4) a key stored as `PROJ` (edition 1) and `EST` (edition 2) only. Assertions, as `mm_reader` unless stated: (a) `v_revision_history` has no row with `value_status = 'PROJ'`; (b) S1 contributes no row (the indicator never appears); (c) S2: Y1 has exactly its two versions, Y2 and Y3 have no row; (d) S3: K has exactly two rows, the edition-2 row has `is_base_version = true` (whatever its stored `load_kind`) and the edition-3 row has `is_base_version = false`, and the edition-1 `PROJ` row is absent and is not the predecessor of anything; (e) S4: no row (one non-projection version); (f) every key listed has exactly one row with `is_base_version = true`, the one with the least `known_at`; (g) perturbation (I-CUR-11): a second fixture database built identically except that it contains no `PROJ` row at all returns exactly the same rows from the view (same keys, `known_at`, values, `is_base_version`), and inserting one more projection edition for S1, S2 and S3 as `mm_ingest` into the first database leaves its output unchanged; (h) `edition_ordered` is true for the rows of S2 and S3 and false for a regular group's rows; (i) the view's column set equals section 5 exactly; (j) a withheld-source copy of S2 yields no row; (k) the row count of the view equals an independently written query over `curated.observation` (run on a connection with table-owner rights in the test database) that applies the definition of section 5. Negative control: a deliberately wrong view definition that omits `value_status <> 'PROJ'` fails (a), (b) and (g).
- T-DDL-34 (Phase 2 amendment, 2026-10-27; plan OQ-04 and OQ-12): (a) `ingest.raw_blob.storage_backend` accepts `release_public`, `local_dir` and `none` (and still the inactive `release_private`) and rejects any other literal; a `local_dir` blob with a NULL `storage_ref` is accepted by the table (the loader requires the relative path, ingestion spec section 4a); (b) after `sync-config` of the real configuration `ref.domain` has exactly the 11 rows `growth, prices, labour, external, fiscal, fin, social, structural, environment, agri, global`, no row `markets`, and `is_ranked = false` exactly for `agri` and `global`; (c) a `ref.indicator_domain` row that names the domain `markets` fails the foreign key.
- T-DDL-35 (ADR-027; `db`): inserting a `ref.series_group` row without `enabled` yields `true`; inserting NULL is rejected.

## Change log (ADR-027 and ADR-028, 2026-11-05; both approved by the user on 2026-11-05, stated in session)
- Status `draft`, then re-approved the same day on the user's instruction stated in session ("check prepared specs, approve them or fix"). `ref.series_group.enabled boolean NOT NULL DEFAULT true` (migration number assigned at implementation; next free 0016). Comment-only wording for discovery: `request_key`, `request_url`, `request_params.discovery`, `request_state.last_url`. No other DDL change.

## Change log (Phase 2 amendment, 2026-10-27; user decisions stated in session)
- Status `draft` (reset from `approved`); the user re-approves.
- `ref.domain`: the empty `markets` domain is removed from the comments (11 domains); no indicator, CHECK, foreign key or count depended on it. T-DDL-34(b), (c).
- `ingest.raw_blob.storage_backend`: new value `local_dir` for the local-directory raw store of tests and development (plan OQ-04; ingestion spec section 4a); it never occurs in production; T-DDL-34(a).
- Comments only: `ref.indicator.alert_override` and `analytics.alert.override_rule` state that v1 ships no override (Q50, Q06 since 2026-10-27); `analytics.indicator_snapshot` states that euro-area-inherited values are flagged and are not rank candidates (Q7 decided).

## Change log (second fix pass, 2026-10-25)
- Status stays `draft`.
- Section 5: `curated.v_revision_history` excludes `PROJ` versions before counting versions and before determining predecessors; new columns `value_status` and `is_base_version`; I-CUR-3 notes that projection editions are not revisions; new invariant I-CUR-11; T-DDL-1 now covers I-CUR-1..11.
- Section 7: the definition of a published-scope observation row adds `value_status <> 'PROJ'` (counts of `ops.v_run_summary_public`); T-DDL-29 extended.
- Section 2: comment at `ref.indicator` says that support indicators are exported in no dashboard file (export spec principle 4).
- Section 10: T-DDL-22 extended, T-DDL-33 added.

## Change log (Phase 2 fix pass, 2026-10-25)
- Status `draft`; `inputs` block list without ADR-011.
- Section 2: columns of `ref.v_series_export` (including `reestimating`) and `ref.v_source_public` defined; `published_precision` and `source_url` stated to come from config (no column); T-DDL-32 added.
- Section 5: `curated.v_revision_history` gains `edition_ordered` (export spec section 7, user decision on named-edition rebases); T-DDL-22 extended.
- `ref.indicator_input.annualised_policy` CHECK is `= 'fail'` (user answer to Q48); T-DDL-9 revised.
- `release_lag_aware` comment worded as in all documents; the `trending_level` open item closed (comment on `stationarity_class`); `indicator_snapshot.publish_scope` comment says that support, input and comparison series have no scope.
- Section 9: AC-OPS-9 points to its definition in the design document (section 11).

## Change log (round 6, 2026-10-25)
- BL-03: `publish_scope` on `indicator_rank_published`, `indicator_alignment_published`, `scorecard_published` and `indicator_snapshot` (and the published snapshot view); `indicator_snapshot.ref_offset_days`, `value_kind`, `limit_source`, `alignment_reason`; `scorecard.heterogeneous_peer_set`, `peer_set_size_min`, `peer_set_size_max`; `ref.indicator.stationarity_class` and `release_lag_aware` as columns (ADR-014); `analytics.run.analysis_run_id` identity; `ops.v_run_summary_public` columns and published-scope counts defined; creation path of `ref.series` rows by the loader (ADR-018) and the matching grants and staging comment.
- BL-02: ADR-012 objects (`analytics.v_run_published`, matrix rows, negatives) written into the DDL; T-DDL-10 extended, T-DDL-26 added; the other new tests are T-DDL-24, 25, 27-31.
- BL-05 (ADR-017): CHECK `NOT (edition_ordered AND reestimating)` on `ref.series_group`; `raw_load.detail` records the revision check family; REV-07 never raises `mass_revision`; T-DDL-30.
- BL-06 (ADR-015): schema `pubdump` and the privilege row; `v_observation_public` is read through `pubdump.v_curated_observation`; T-DDL-11 points to the dump spec; T-DDL-31.
- Forecasting is v2: the earlier "ADR-011 not implemented" remarks now say v2; the interim `PROJ` rule of I-CUR-3 stays in v1.
- Not decided here (status after the fix pass): the transform used for the alert window of `trending_level` indicators is RESOLVED (analytics spec section 5, source-config rule 29); which indicators are `release_lag_aware = true` is still open (parameters spec section 7, item 7; plan OQ-10).

## Change log (round 5, 2026-10-24)
- Bugs: `loaded_at` redefined (clock read after the load lock; analytics cutoffs from the database clock under the same lock; I-CUR-9, T-DDL-20); `obs_known_not_future` widened to a one-hour backstop with META-05 as the precise check (BB25); `ops.drift_event.kind` completed and renamed (`schema_drift`, `precision_change`, `composition`, `flow_basis`); `ref.indicator.rank_mode` has no default; `alignment` enum has `ahead` and `lagging`; `analytics.alert.reason` has `sd_zero` and new column `label`; `ref.config_history` covers `domain`, `entity`, `source`; `curated.v_revision_history` restricted to headline mappings of scored indicators.
- Added (PROPOSED, need user approval): `MISS` value status (design Q52); `load_kind = 'import'`, `raw_object.edition_date`/`import_label`, `series_group.edition_ordered` (P22, Q47); `ref.series.flow_basis` and `indicator_input.annualised_policy` (P18, Q48); `display_dir` (Q52); per-entity-group `alert_override` shape (P19, Q50).
- Private repository: `archive_mode = 'private'` and `storage_backend = 'release_private'` marked inactive; `hash_only` handling in S-5 and I-ING-2; T-DDL-11 fixture uses `hash_only` (design Q46).
- Stale text: "modal window" removed from the published-tables comment; tolerance floor stated as half a unit; row size and all derived figures rescaled (worst case about 1.7 GB/year, snapshot case 80-250 MB/year); X03 is imports of goods and services; the former load-state table name `raw_load_state` no longer appears (the load-state table is `ingest.raw_load`).

## Change log (round 4, 2026-10-24)
- Restored `analytics.run` columns `code_version`, `params` and `indicator_alignment.reference_period_spread_days`, which a SQL comment had swallowed. Single history model for `series_map` (current state plus `config_history`). `raw_series_status` gains `skipped_out_of_order` (per-series out-of-order rule, I-CUR-4). Materiality floor is half a unit, rate units use `materiality_abs` only. Row size estimate corrected to 220-300 bytes. `ref.indicator.concept_id`/`concept_priority` (P15). View `curated.v_input_obs_published` and its grants.

## Change log (2026-10-18 review fixes)
- Fix 1: confirmed and made explicit that dedup is on bytes (`raw_blob`) and never on manifest rows; I-ING-2 states that equality with an older object is irrelevant; manifest row written against the latest object only.
- Fix 2: `request_state.last_loaded_sha256`/`last_loaded_raw_id` added (advance only in the load transaction, I-ING-6); `ingest.raw_load` is the load status table (no separate state table exists); plan selects groups with a non-empty unloaded queue.
- Fix 3: S-4 clarified (delete per raw_id only in the commit of that object's load), S-7 manual inbox uses the same queue, lock and ordering.
- Fix 4: `raw_object.group_id`; I-ING-4 and I-CUR-4 restated precisely (per-key monotone `known_at`; per-group strict `(fetched_at, raw_id)` load order; out-of-order guard for cross-group cases); T-DDL-17.
- Fix 5: `ref.series_group` (`reestimating`, `compare_mode`, materiality, `snapshot_mode`, `max_revised_rows`), `ref.series.published_decimals`/`group_id`, `ingest.raw_snapshot`, `raw_load.rows_below_tol`; I-CUR-3 rewritten; section 9 worst case (1,300 x 400) with consequence and mitigation; T-DDL-13/15; spike AC-OPS-8.
- Fix 6: grant matrix completed (new objects, `ref.series` columns, `ops.export_status` insert-only table instead of merging export status into `run_summary.groups`, `curated.v_revision_history` for `mm_reader`, justification of every `mm_ingest` privilege); T-DDL-10 extended.
- Fix 7: entity `WLD` documented and `is_global`; `ref.global_translation`; `ref.indicator.is_support` and support-indicator convention; note that X01 (nominal GDP LCU) must be added by the config seed and needs user approval.
- Fix 8: `sa_required` rule (T-DDL-18); redundant index already removed (kept removed, comment); I-CUR-7 compares natural key only; `fetch_mode` and `incremental_is_partial` CHECK, I-ING-7; workflow inputs via env noted.
- Fix 9: `ref.config_history` (append-only, trigger-fed, `fn_config_asof`), `recorded_at` on `series_map`, `ref.indicator.params`, `ops.drift_decision`, `ops.quality_override.recorded_at`/`supersedes_override_id`, `analytics.run.config_asof` and `config_sha256` inside `params`; T-DDL-16.
- Fix 7 follow-up (2026-10-18, review round 3): `curated.observation.loaded_at`, `fn_observation_asof(known_cutoff, load_cutoff)`, `analytics.run.load_cutoff`; frozen increase-only `published_decimals`; fixed `rank_mode = 'none'` literals to `descriptive_only`; `rank_reference_period` column name; composition rule; size budget for ingest/ops growth and retention (AC-OPS-9).
