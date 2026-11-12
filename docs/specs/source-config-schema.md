---
status: approved   # approved on 2026-11-05 on the user's instruction stated in session ("check prepared specs, approve them or fix"), after an agent review and fixes; reset on 2026-11-05 for ADR-027 rule 45 and ADR-028 rule 44; previously approved by the user on 2026-11-01 (stated in session); earlier reset on 2026-10-27 (this amendment: markets domain dropped, Q06 z-score only)
inputs:
  - ADR-004
  - ADR-005
  - ADR-009
  - ADR-014
  - ADR-017
  - ADR-018
  - ADR-027
  - ADR-028
  - docs/research/data-sources-g20-eu-cross-country.md
---
# Spec: configuration files (source registry, indicators, series map)

Revision note (review fixes): `publish_site` added (A8, A9); group `revision` block with comparison tolerance and re-estimation handling (A4); WEO reminders moved after the expected releases (A10); M01 example corrected to `SCA` and new validation rules 8-14 (A11); `WLD` entity, indicator `kind`/`scope`/`rank`/`max_ref_spread_days`, inputs and targets, domain coverage threshold (B1-B9); series-map seeding coverage report (D).

Revision note (review round 5, 2026-10-24): `revision.compare` value `published_decimals` (was `scale_min`); `rank: none` replaced by `descriptive_only` (rule 12, X01 example); reminder `remind_on` day 25 on the preflight day (rule 11); manual sidecar `edition_date` and `import_label`, group key `edition_ordered` (rule 18); `archive: private` rejected while no private repository is configured (rules 5 and 17); group keys `missing_markers` and `job_timeout_min`; per-entity-group alert overrides with rationale (rule 20, PROPOSED P19); flow-basis requirement for denominators (rule 21, PROPOSED P18); `published_precision` (config display hint) versus `published_decimals` (derived series attribute) stated.

Revision note (round 6, 2026-10-25): the WEO example is a NAMED-EDITION group (`reestimating: false`, `edition_ordered: true`; user decision on design Q37, ADR-017), not a re-estimation family; new rule 27 (a group cannot be both); the round-3 keys `vintage_resolution` / `release_cadence_note` are NOT part of v1 (they belong to the forecast storage of ADR-011, v2, and are rejected as unknown keys); `expect.composition` is the source of `ref.series.composition` at first sight of a series (ADR-018); series-map entries whose series row does not exist yet are pending, not an error.

Revision note (Phase 2 fix pass, 2026-10-25): (1) rules 4 and 7 now say which source kinds they apply to, and the WEO manual example is complete (it carries `expected_series_min`; a manual source has no `rate_limit`, `http`, `change_detection`); (2) `config/indicator_defaults.yaml` (ADR-014) is in the file table and section 3a, and the indicator entry gains the keys `family`, `stationarity_class`, `release_lag_aware` and `review` (rule 29, AC-CFG-11); the normative detail of defaults, resolution order and rules 22-26 stays in the indicator-parameters spec; (3) the former open item on `stationarity_class: trending_level` is resolved by the user's decision to follow the analytics spec section 5 and the indicator-parameters spec section 9 (rule 29): the class does not constrain `transform`; (4) `annualised_policy: latest_single` is not allowed (user answer to design Q48): rule 21 no longer offers it as an exception, new rule 28 and AC-CFG-10 reject it.

Revision note (second fix pass, 2026-10-25): (1) the A05 example of section 3 no longer carries a `euro_area` fixed override: it contradicted the user's answer to design Q50 (2026-10-24: "z-score only for now; no fixed per-group overrides until the user supplies groups, thresholds and rationales"); the example now has `method: z` and `override: null`, and rule 20 states that v1 ships with no override entries; (2) the comment on `is_support` says that support indicators are not exported at all (export spec principle 4); no key or rule changed.

Revision note (Phase 2 amendment, 2026-10-27; PROPOSED, needs the user's re-approval): (1) DG-01: the group `revision:` block gains `materiality_abs`, `materiality_rel` and `snapshot_mode` (section 1 example, section 1a re-estimating example, rules 30-32, AC-CFG-13); the keys already existed in the DDL (`ref.series_group`), ADR-017 and design Q33, but had no config name, so a re-estimating group could not be configured; no decision of ADR-017, the DDL or Q33 is changed. (2) DG-02: `is_support` is removed from the M06 example; it is derived from `kind`, and authoring it is an unknown-key error (rule 33, AC-CFG-14); this is the PROPOSED resolution of plan OQ-14, marked for user confirmation; OQ-14 is not closed.

Revision note (Phase 2 amendment, second part, 2026-10-27; user decisions stated in session): (1) plan OQ-12: the empty `markets` domain is dropped; rule 13 and the domain list of section 3 no longer name it, and a domain id `markets` is an unknown domain (AC-CFG-15); no indicator in this schema uses it. (2) plan OQ-15 / Q06: the BIS credit-to-GDP gap alert thresholds are z-score only, so no override exists for Q06 either; rule 20 and AC-CFG-12 say so (the CI check already forbids any shipped override). The status is `draft` again for both parts; the user re-approves.

Files (all under `config/`, validated by JSON-Schema derived from the tables below on every CI run and at `plan`; unknown keys are errors; for the indicator files the keys of section 3 and 3a are the complete list and the indicator-parameters spec sections 2, 4 and 8 give their normative meaning, defaults and rules 22-26):

| File | Purpose | Loaded into |
|---|---|---|
| `config/sources.yaml` | registry of sources and their request groups (exists as an empty stub; schema below replaces the commented sketch) | `ref.source`, connector plans |
| `config/indicators.yaml` | indicator catalog transcribed from the approved selection (ID, tier, priority, currency basis, staleness class, transform, alert method, rank mode, domains) plus auxiliary inputs (`kind: input`), domain settings and the optional per-indicator keys of ADR-014 (`family`, `stationarity_class`, `release_lag_aware`, `review`) | `ref.indicator`, `ref.indicator_domain`, `ref.domain`, `ref.indicator_input`, `ref.indicator_target` |
| `config/indicator_defaults.yaml` | layered parameter defaults of ADR-014: section `global` and section `families` (section 3a; draft families in the indicator-parameters spec section 4). Not loaded as such: `sync-config` resolves it with the indicator entries and writes the RESOLVED values into `ref.indicator` (columns `stationarity_class`, `release_lag_aware`, and the others) and the provenance into `ref.indicator.params` | `ref.indicator` (resolved values only) |
| `config/entities.yaml` | 42 countries, EU27, EA and WLD aggregates (45 entities), group memberships with validity dates | `ref.entity`, `ref.entity_group_member` |
| `config/series_map/<source_group>.yaml` | series keys per source group, mapping to indicator, entity, role | the whitelist of the parsers (`series_filter`); `ref.series` rows are created by the loader on first sight (ADR-018), `ref.series_map` and `ref.inheritance_rule` by `sync-config` (existing series) and by the loader (first sight) |
| `config/release_calendar.yaml` | typical lags, tolerance, explicit dates per source group | freshness evaluation |
| `config/dashboard.yaml` | (ADR-034 amendment A1, CR-15, 2026-11-10, pending user confirmation) dashboard display settings; one key `default_domain` (rule 47; recommended value `growth`); validated by `src/macro_monitor/registry/schemas/dashboard.schema.json` (`additionalProperties: false`); optional file | not loaded into the database (no table, no migration); read by the `export` stage from the config tree at the run's `git_sha` into the top-level `default_domain` of `meta/domains.json` (export spec section 4) |

`macro-monitor sync-config` loads them idempotently; a changed `sources.yaml` entry changes `ref.source.config_sha256`. Secrets never appear in these files: only env var names. The git sha of the checkout and the sha256 of the `config/` tree are recorded per run (`ingest.run.git_sha`, `analytics.run.config_sha256`) and are inputs to reproduction (B11, B12).

Naming of the two precision notions (round 5). `published_precision` is a group-level CONFIG key: a display hint (integer decimals or null) that is exported in `meta/series.json` and never rounds or compares stored values. `published_decimals` is the DERIVED series attribute (`ref.series.published_decimals`: the source's DECIMALS attribute or the maximum decimals over the full first-load history; frozen, increase-only) that the loader, REV-01 and REV-05 use for comparison and materiality. The two are independent.

## 1. `sources.yaml` entry

```yaml
archive_policy:                       # top level, once per file (round 5)
  private_repo: null                  # owner/name of a private repository for `archive: private`; null = none exists (user decision 2026-10-18). Rule 17.

sources:
  - id: eurostat                      # [a-z0-9_]+ ; primary key (ref.source.source_id)
    name: Eurostat dissemination API
    provider: Eurostat
    kind: sdmx                        # sdmx | rest | bulk | web | manual
    enabled: true
    wave: 1                           # rollout wave (1 keyless documented API/bulk; 2 national/keyed APIs; 3 web)
    base_url: https://ec.europa.eu/eurostat/api/dissemination/
    auth: {type: none}                # none | api_key {env: FRED_API_KEY, in: header|query, name: ...} | token {env: ...}
    http:
      user_agent_template: "macro-monitor/{version} (+{repo_url}; non-commercial research)"
      timeout_s: 120
      retries: {max: 4, backoff_s: 2, backoff_factor: 2, jitter: true, on: [429, 500, 502, 503, 504, timeout]}
    rate_limit:
      max_concurrent: 1
      min_interval_s: 2
      budget_per_hour: null           # OECD: 8 (stricter reading of 20/h, ADR-004)
      budget_per_day: null            # UN Comtrade: 500 calls/day
      source_note: "Fair-use thresholds, no numbers (docs ...); <500k cells direct, async above"
    licence:
      id: eurostat-reuse
      url: https://ec.europa.eu/eurostat/web/main/help/copyright-notice
      checked_on: 2026-10-17
      non_commercial_ok: true
      attribution: "Source: Eurostat"
      redistribution_of_raw: allowed   # allowed | unclear | forbidden  -> constrains archive and publish_site
    archive: public                   # public | hash_only | private (reserved: rejected while archive_policy.private_repo is null, rule 17) (ADR-003); also gates the public dump and public raw releases. hash_only = no bytes stored (manifest, hash, URL, timestamp only; no replay, no dump)
    publish_site: public              # public | withheld ; NO default ; drives export, published analytics sets and the public dump (A8, A9)
    automated_access: allowed         # allowed | manual_only | unknown ; manual_only forces kind: manual (IMF, D23)
    terms_review:                     # REQUIRED when kind = web; recommended otherwise
      decision: permitted             # permitted | forbidden | unclear
      reviewed_on: 2026-10-17
      url: https://ec.europa.eu/eurostat/web/main/help/copyright-notice
      clause: "quoted text"
    robots_review:                    # REQUIRED when kind = web
      robots_url: https://ec.europa.eu/robots.txt
      decision: not_applicable_documented_api   # permitted | disallowed | not_applicable_documented_api
      reviewed_on: 2026-10-17
    change_detection: [update_marker, content_hash]   # ordered ladder; any of http_validators | update_marker | content_hash ; automated kinds only (rule 4)
    groups:
      - id: eurostat_sts                # series group = unit of scheduling, validation and freshness
        enabled: true                   # optional, default true (ADR-027, rule 45); effective state = source enabled AND group enabled; a parked group sets false and carries a note
        description: Short-term business statistics (IP, retail)
        request_template:
          path: statistics/1.0/data/{dataset}
          params: {format: JSON, "c[TIME_PERIOD]": "ge:1991", geo: "{entities}"}
          datasets: [sts_inpr_m, sts_trtu_m]
          fixed_filters: {sts_inpr_m: {indic_bt: PROD, nace_r2: B-D, s_adj: SCA, unit: I21},
                          sts_trtu_m: {indic_bt: VOL_SLS, nace_r2: G47, s_adj: SCA, unit: I21}}   # SCA = seasonally and calendar adjusted (was CA, which cannot feed M3M3_ANN, rule 8)
        format: jsonstat
        parser: macro_monitor.ingestion.parsers.jsonstat:parse     # module:function, versioned; every released version stays importable (B12)
        missing_markers: [":"]            # explicit source markers for a missing/confidential/not-available value -> value_status MISS with the marker in source_flags (PARSE-03, round 5); any other non-numeric text is a rejected row
        fetch_scope: complete             # complete | partial  (tombstones only on complete)
        mode_default: full                # full | incremental ; incremental needs a documented watermark and forces fetch_scope: partial
        full_refresh_every: 3             # months, when mode_default = incremental
        series_map: config/series_map/eurostat_sts.yaml
        expected_series_min: 50           # COMP-01 floor (required for every group of every kind, rule 7)
        freshness: {frequency: M, typical_lag_days: 50, tolerance_days: 20}
        job_timeout_min: 120              # fetch job timeout for this group's matrix leg (default 120, bounds 10-355; OECD groups 300, BB28)
        reestimating: false               # bool, default false ; true marks SA/model-revised groups whose history is re-estimated (DDL ref.series_group flag); never true together with edition_ordered (rule 27)
        published_precision: null         # int decimals or null (= as published) ; DISPLAY HINT exported in meta/series.json, never rounds or compares stored values (comparison uses the derived published_decimals)
        revision:                         # A4; all keys optional, defaults shown
          compare: published_decimals     # published_decimals (compare at the series' derived published_decimals, half a unit) | fixed_decimals  (round 5: was `scale_min`)
          decimals: null                  # required when compare = fixed_decimals
          rel_epsilon: 1.0e-9             # relative tolerance for float noise
          max_revised_rows: null          # required when the group has `reestimating: true` (cap per raw object, blocks above)
          materiality_abs: 0              # DG-01, rule 30: number >= 0 ; 0 = the comparison rule's half published unit decides ; DDL materiality_abs
          materiality_rel: 0              # DG-01, rule 30: number in [0, 1] ; default 0 here (regular group), 0.001 when reestimating: true (design Q33) ; DDL materiality_rel
          snapshot_mode: none             # DG-01, rule 31: none | diff_above_tol ; default none here, diff_above_tol when reestimating: true (design Q33) ; DDL snapshot_mode
        max_insert_rows_per_load: 100000  # DB-05 guard
        on_failure: alert                 # alert | alert_and_block_dependents
```

Validation rules (config tests):
1. `kind: web` requires `terms_review.decision = permitted`, `terms_review.reviewed_on` within 365 days of the run date, and `robots_review.decision = permitted`; otherwise `enabled` is forced to false and `plan` reports `skipped_review` (ADR-005).
2. `automated_access: manual_only` requires `kind: manual`.
3. `auth.type` other than `none` requires an `env` name that is documented in `.env.example`; `plan` fails if the variable is absent while `enabled: true` and the source has at least one enabled group (ADR-027, resolved Q3; rule 45).
4. Applies to the AUTOMATED source kinds `sdmx`, `rest`, `bulk` and `web`: `rate_limit` must define `min_interval_s` or a budget; `web` defaults: `min_interval_s: 5`, `max_concurrent: 1`, `max_requests_per_run: 100`. It does NOT apply to `kind: manual` (a human downloads the file; the loader makes no request): a manual source must not carry `rate_limit`, `http`, `change_detection`, `base_url` or `auth` (an error, because nothing would use them), and `terms_review` is recommended but not required for it (rule 1 requires it for `web` only).
5. `archive: public` is rejected if `licence.redistribution_of_raw` is `forbidden`; `unclear` requires an explicit `archive` value set by the user (no default). Round 5 (needs user confirmation, design Q46): for `unclear` the allowed explicit values are `hash_only` (proposed; bytes not stored, so no byte-level reproducibility and no dump) or `public` together with a recorded user decision (`licence.user_decision: {by, on, rationale}`); `private` is not allowed (rule 17). `publish_site` rules are in rule 15.
6. `parser` must resolve to an importable callable with a `PARSER_VERSION` attribute.
7. Applies to EVERY group of EVERY source kind, `manual` included: the group has `freshness`, `series_map` (file exists) and `expected_series_min` (the COMP-01 floor; for a manual group it is the number of mapped series expected in a complete file and is set from the first real file, so the WEO example carries a placeholder).
8. (A11a) Seasonal-adjustment rule: for every indicator whose transform is flagged `requires_sa` in the transform registry (`M3M3_ANN`, `QOQ_ANN`, and any later MoM/QoQ transform), every `headline` or `fallback` series-map entry must declare `expect.seasonal_adjustment` in (`SA`, `SCA`). `CA` (calendar adjusted only), `NSA` and `NA` fail with a message naming the indicator, entity and series key. NSA series may only serve transforms that are not `requires_sa` (for example YoY). In particular the Eurostat `s_adj: CA` filter cannot feed M01 with a 3m/3m transform; the example uses `SCA`. If only a CA series exists for an (indicator, entity) pair, the pair must be flagged `known_gap` (or the indicator given a YoY transform for that entity), not mapped silently.
9. (A11d) `mode_default: incremental` requires `fetch_scope: partial` (an incremental fetch never proves absence; tombstones are written only for `complete` objects). `complete` with `incremental` is a config error.
10. `revision.compare: fixed_decimals` requires `decimals`; the values of `revision.compare` are `published_decimals` and `fixed_decimals` only (`scale_min` no longer exists); a group with `reestimating: true` requires `revision.max_revised_rows` and is allowed only for groups listed in the re-estimation register of the design (the register is the group list in this file; each such group needs a `note` naming the family, for example "BIS credit-to-GDP gap, quarterly recompute"). `reestimating` is the single group flag (stored in the DDL; drives `revision_class`, REV-06 and the export field); the old key `revision.reestimation` no longer exists. Round 6: the IMF WEO group is NOT in the re-estimation register (design Q37, ADR-017); it is a named-edition group (rule 27).
11. Reminder dates (A10, rewritten in round 5): each `reminders[]` entry of a manual source must fall in a month listed in that source's `freshness.release_months`, and satisfy `expected_window.to_day < remind_on.day <= 25`, where 25 is the day of the month on which the `preflight` workflow runs (cron `41 5 25 * *`; constant `PREFLIGHT_DAY`). The reminder is evaluated by the first preflight run on or after `remind_on`, so a reminder on day 25 fires on the 25th, and a `remind_on` day above 25 is rejected because it could never fire in its month (the earlier example with day 26 was such a case). Windows and reminder days are configuration, not hard-coded, and must be confirmed against the provider's release calendar when the source is implemented.
12. Indicators (section 3): `rank` and direction consistency as in `ref.indicator` checks (`monotone_good` needs `good_dir` of +1/-1; `target_distance` needs targets for every entity to be ranked or the entity is n/a; `descriptive_only` has `good_dir: 0`, with an optional `display_dir` of -1/0/+1 used only for colouring and never for ranking); there is NO default `rank.mode` (P14): an active indicator without it is rejected; `kind: input` indicators have no domains, `rank.mode: descriptive_only`, `alert.method: none`; every indicator whose transform lists `inputs` in the registry has matching `inputs:` entries pointing to `kind: input` indicators; `scope: global` indicators map only to entity `WLD`.
13. Domains: `agri` and `global` carry `ranked: false` (D12, B9; the proposed default B3 for the former `markets` domain is withdrawn: that domain is dropped, user decision 2026-10-27, stated in session, plan OQ-12); `min_coverage_for_rank` in [0, 1]. The domain ids are exactly those of the domain list in `indicators.yaml` (section 3); a domain id that is not in that list, in particular `markets`, referenced by an indicator or written in the list is a validation error (unknown domain; AC-CFG-15).
14. Any file that defines `ref.entity` must contain exactly one `WLD` (aggregate, `is_global`), `EU27` and `EA`, and 42 countries.
15. `publish_site` (A8, A9) is mandatory for every source entry, has no default, and takes `public` or `withheld`. `public` is rejected when `licence.redistribution_of_raw` is `forbidden`; `unclear` requires an explicit user value for both `archive` and `publish_site`. `publish_site: public` with `archive` of `hash_only` is allowed (derived numbers may be published while raw bytes are not), but the public dump and public raw releases use BOTH fields (ADR-003): a row is publicly dumped only when `archive = public` AND `publish_site = public`. Any release or dump of a source with `unclear` licence is gated by these same fields; there is no other path.
16. `published_precision` is null or an integer in [0, 12] and is a display hint only (see the naming note above); `reestimating` is boolean; both are group-level only.
17. (round 5) `archive: private` is rejected while `archive_policy.private_repo` is null (no private repository exists, user decision 2026-10-18). Enabling it needs: the repository created by the user, `archive_policy.private_repo` set, the secret `RAW_PRIVATE_TOKEN` added, and an approved update of ADR-003. Config validation (not documentation) is what keeps `private` unavailable.
18. (round 5, PROPOSED P22) A group with `edition_ordered: true` (manual WEO group; a NAMED-EDITION group, ADR-017) requires its inbox sidecars to carry `edition_label` and `edition_date` (ISO date of publication of the edition), may carry `import_label` with the single allowed value `archive_import`, and is subject to the loader's edition-order rule (ADR-005, ingestion spec section 5 step 2a). Sidecars missing `edition_date` are rejected by `ingest-manual`.
19. (round 5) `missing_markers` is a list of non-empty strings, group-level; `job_timeout_min` is an integer in [10, 355] (default 120; groups behind a slow budget such as OECD set 300).
20. (round 5, PROPOSED P19; Q50 answered in the second fix pass; Q06 added 2026-10-27) `alert.override` is a list of entries `{entity_group, watch, alert, rationale, source_note}` where `entity_group` is a `group_id` of `ref.entity_group_member` (for example `advanced`, `emerging`, `euro_area`) and `rationale` is mandatory and non-empty. An override applies only to entities that are members of its group on the run date; for entities with no matching entry with a rationale there is no fixed override and only the z-score rule applies. A single fixed threshold for all entities is rejected. User answer to design Q50 (2026-10-24): z-score only for now; no fixed per-group overrides until the user supplies groups, thresholds and rationales. User decision of 2026-10-27 (stated in session; plan OQ-15): the same for the BIS credit-to-GDP gap Q06 (z-score only; the earlier "fixed 2/10 pp overrides" no longer exist). Therefore `config/indicators.yaml` as shipped in v1 contains NO `alert.override` entry for any indicator (not the debt/GDP 60 % and 90 % lines of A05, not the reserve-cover 3-month line, not a Q06 threshold); the key and this rule exist so that the user's later answer needs no schema change. The mechanism is tested with fixture configs only (analytics spec AC-AN-23), never with a shipped entry.
21. (round 5, PROPOSED P18) Every `kind: input` indicator that is a GDP denominator declares `requires_flow_basis: PERIOD_FLOW`; a `headline` mapping of such an indicator to a series whose `flow_basis` (series metadata, `expect.flow_basis` in the series map) is `ANNUALISED_RATE` or `STOCK` is a config warning (the transform will fail closed at run time, COMP-05 `annualised_denominator`). Fix pass 2026-10-25: the earlier exception "unless `inputs[].annualised_policy: latest_single` is set" is withdrawn (rule 28); the warning has no exception.
27. (round 6, ADR-017; numbers 22-26 are used by the indicator-parameters spec, section 8) `edition_ordered: true` and `reestimating: true` are mutually exclusive on one group (config error, mirrored by the DDL CHECK on `ref.series_group`). A named-edition group sets no `revision.max_revised_rows` and no `snapshot_mode` other than `none`. The revision check family of a group is therefore unambiguous: `reestimating` -> REV-06, `edition_ordered` -> REV-07 (report only), otherwise REV-01.
28. (fix pass 2026-10-25, user answer to design Q48) `inputs[].annualised_policy` is optional and takes only the value `fail` (the default). Any other value, in particular `latest_single`, is a config error: using a single latest annualised quarterly value as a denominator is not allowed, so a quarterly denominator with `flow_basis: ANNUALISED_RATE` always fails closed at run time (COMP-05 `annualised_denominator`). The DDL CHECK on `ref.indicator_input.annualised_policy` allows the same single value. Test AC-CFG-10.
29. (fix pass 2026-10-25, ADR-014) Indicator keys of ADR-014 in `indicators.yaml`: `family` (optional; must be a key of `families` in `config/indicator_defaults.yaml`), `stationarity_class` (optional; `stationary` | `trending_level` | `rate_of_change`), `release_lag_aware` (optional boolean), `review` (`{status: proposed | confirmed, by, on}`; `confirmed` requires `by` and `on`; absent means `proposed`). A key written in the entry overrides the family and global defaults (indicator-parameters spec section 2); an unknown key, an unknown family or an out-of-set value is an error. `provenance` is written by `sync-config` into `ref.indicator.params` and is not an authored key. Class `trending_level` does NOT constrain `transform`: it only tells analytics to compute the alert z-score on DIFF12 of the indicator's transformed series, for the alert window only (analytics spec section 5), with the indicator's `transform` unchanged; fixed `alert.override` thresholds still evaluate on the level. No config rule requires `transform` in {`DIFF12`, `YOY_PCT_POINT_CHANGE`} (this resolves the former open item; user decision to follow analytics spec section 5 and indicator-parameters spec section 9). The global default of `release_lag_aware` is `false`; it is `true` for a named list of indicators whose list is pending the user (plan OQ-10; row-by-row proposal in `docs/specs/release-lag-and-split-proposal.md`, not decided).
30. (Phase 2 amendment 2026-10-27, DG-01) Materiality keys of the group `revision:` block. `revision.materiality_abs`: number (YAML integer or decimal), `>= 0`, optional, default `0`; `revision.materiality_rel`: number in `[0, 1]`, optional, default `0` for a group with `reestimating: false` or omitted and `0.001` for a group with `reestimating: true` (design Q33, accepted by the user 2026-10-24; DDL comment "config default 0.001 for reestimating groups [proposed]"). Values are read from the YAML text as exact decimals (not binary floats) and stored in `ref.series_group.materiality_abs` and `materiality_rel` (`numeric`). Both are group-level only, apply to every series of the group, and may be set on any group of an automated source kind and on a `edition_ordered` group (the REV-07 count uses the same definition); a manual non-edition group may set them too. Semantics (unchanged from DDL I-CUR-3 and ingestion spec section 5 steps 5 and 7): a revised key is a MATERIAL revision for REV-01, REV-06 and REV-07 only if it is a revision under the comparison rule (`|a-b| > max(rel_epsilon * max(|a|,|b|), 0.5 * 10^-d)`, `d` = derived `published_decimals`) AND `|a-b| > max(materiality_abs, materiality_rel * |a|)`; for a series whose `ref.unit.dimension` is `ratio` the relative term is not applied and `materiality_abs` alone decides; with `materiality_abs: 0` the comparison rule's half published unit therefore decides. In a group whose effective `snapshot_mode` is `diff_above_tol` the same quantity is also the STORAGE tolerance (a revision at or below it is counted in `raw_load.rows_below_tol` and not stored); in a group with `snapshot_mode: none` the keys only change what the REV checks count and never suppress storage. `materiality_abs` is expressed in the unit of each series, so a non-zero value on a group whose series map spans more than one `expect.unit` is a `sync-config` warning (use `0`, or split the group).
31. (Phase 2 amendment 2026-10-27, DG-01) `revision.snapshot_mode`: enum `none` | `diff_above_tol`, optional. Effective default: `diff_above_tol` when the group has `reestimating: true` and the key is absent (design Q33, accepted by the user 2026-10-24: re-estimating groups store only revisions above the tolerance and keep the full vintage in the Parquet snapshot; ADR-002 fix 5), otherwise `none`. An author may write `snapshot_mode: none` on a re-estimating group to opt out (storage then follows the comparison rule only; REV-06 still uses the materiality of rule 30). `diff_above_tol` requires `reestimating: true` (mirrors the DDL CHECK `snapshot_mode = 'none' OR reestimating`); `diff_above_tol` together with `edition_ordered: true` is an error under rule 27 (the IMF WEO group stays at `none`, ADR-017 decision 1; the key may be omitted). Stored in `ref.series_group.snapshot_mode`. The DDL column default (`none`) applies only to rows inserted outside `sync-config`; `sync-config` always writes the RESOLVED value, so the config default of this rule and the column default never disagree on a loaded row.
32. (Phase 2 amendment 2026-10-27, DG-01) Placement and mapping. `materiality_abs`, `materiality_rel` and `snapshot_mode` are keys of the `revision:` block, beside `compare`, `decimals`, `rel_epsilon` and `max_revised_rows`; the same names written directly on the group (outside `revision:`), or any other spelling, are unknown-key errors. The complete mapping of the group's revision policy to the DDL and to the loader's `RevisionPolicy` (ingestion spec section 3) is:

| Config key (group) | DDL column `ref.series_group` | `RevisionPolicy` field | Default |
|---|---|---|---|
| `reestimating` | `reestimating` | `reestimating` | `false` |
| `edition_ordered` | `edition_ordered` | `edition_ordered` | `false` |
| `revision.compare` | `compare_mode` | `compare` | `published_decimals` |
| `revision.decimals` | `fixed_decimals` | `decimals` | null |
| `revision.rel_epsilon` | `rel_epsilon` | `rel_epsilon` | `1e-9` |
| `revision.max_revised_rows` | `max_revised_rows` | `max_revised_rows` | null (required when `reestimating`) |
| `revision.materiality_abs` | `materiality_abs` | `materiality_abs` | `0` |
| `revision.materiality_rel` | `materiality_rel` | `materiality_rel` | `0`; `0.001` when `reestimating` |
| `revision.snapshot_mode` | `snapshot_mode` | `snapshot_mode` | `none`; `diff_above_tol` when `reestimating` |

   A change to any of these keys changes the group's `config_sha256` and is written by `sync-config` as an update of the group row through the configuration-history path of the DDL spec; it never rewrites stored observations. The tolerance values for the first re-estimating groups are provisional: design Q33 and AC-OPS-8 require measuring the share of revised keys on the first three releases of each re-estimating group and setting the group's tolerance from the measurement before more than the core set is enabled.
33. (Phase 2 amendment 2026-10-27, DG-02) `is_support` is DERIVED and never authored. `ref.indicator.is_support` is a generated column equal to `kind = 'input'` (DDL spec; analytics spec section 2). An indicator entry that contains the key `is_support` (with any value, including the derived one) fails validation as an unknown key, with a message that names the indicator and says "derived from kind". The key is not part of the indicator schema of section 3. PROPOSED resolution of plan OQ-14 (DG-02), among the three options the plan lists (accept and ignore; accept only if equal to the derived value; reject): reject. It is marked FOR USER CONFIRMATION; OQ-14 is NOT closed by this spec, and if the user chooses another option this rule and AC-CFG-14 are changed, nothing else.

44. (ADR-028, implemented in `registry/config.py` `discover_issues` and `sources.schema.json`; rules 34-43 live in the amendments) `request_template.discover` on a bulk group. A `kind: bulk` group has exactly one of `path` or `discover`, and `discover` needs a non-empty `datasets` list (the logical file name, also the series_map dataset key). `plan` (not the validator) refuses a discovered group with more than one dataset or with `expect_matches` other than 1, because one file per dataset is fetched (`ConnectorConfigError`). `discover` is rejected on `web`, `manual`, `sdmx` and `rest` sources. `discover` keys: `landing_url` (required, scheme `https`); `link_pattern` (required, compiles, anchored `^...$`, starts `^https://` followed by a literal host with no wildcard, and ends `$` not escaped); `expect_matches` (positive integer, default 1; booleans and 0 rejected); `allowed_hosts` (required, non-empty list of bare host names with no scheme or path, containing the host of `landing_url` and the host of the source `base_url`). Unknown keys are rejected. Runtime invariant: when discovery yields anything other than exactly `expect_matches` distinct matches, a host outside `allowed_hosts` (a redirect included), a landing response that is not HTML 200, or a resolved file of the wrong format, `fetch` fails closed with `discovery_failed` and NEVER falls back to the last known URL (`request_state.last_url`) or to a date-token URL. `request_key` is over the logical key (GET, landing_url, dataset), so URL rotation does not start a new chain. Negatives: AC-CFG-19.
45. (ADR-027) Optional group-level `enabled` (boolean, default true; group object only, same spelling as the source-level key). Effective state is `effective_source_enabled AND group.enabled`; `enabled: true` on a group never overrides a disabled source (including the rule 1 forcing for `web`). Validation is unchanged for disabled groups: schema, parser import (rule 6), series_map and `expected_series_min` (rule 7), rules 8-10, 27-33 and the calendar equality test are all evaluated as for an enabled group; `expected_series_min` stays mandatory. A group with `enabled: false` and no `note` produces a warning, not an error. An enabled source with no enabled group produces a `plan` warning ("source enabled, no group enabled"), not an error. Rule 3 (auth env present at `plan`) applies only to an enabled source with at least one enabled group (ADR-027, resolved Q3), so a source with every group parked needs no env var. A group omitting the key keeps its `config_sha256`; the sha is computed over the group mapping as written, so writing the key, `enabled: true` included, changes it. `sync-config` stores the group's OWN flag in `ref.series_group.enabled` (forward-only migration, `NOT NULL DEFAULT true`). Tests: AC-CFG-20.
46. (ADR-034 amendment A1 item 2, CR-14, phase B, 2026-11-10, pending user confirmation) `tile_headline`: optional boolean on an `indicators.yaml` indicator entry only (default `false`); it is added to the section 3 key list (the complete list that indicator-parameters rule 23 refers to) and to `src/macro_monitor/registry/schemas/indicators.schema.json` (`additionalProperties: false` kept). It is NOT allowed in `config/indicator_defaults.yaml` (neither `global` nor a family: it is a display flag, not an ADR-014 resolved parameter, indicator-parameters spec section 8), not on a `kind: input` entry, and not in the `domains` list. A non-boolean value is an error. `sync-config` does not load it into the database (no `ref.indicator` column, no migration); the export reads it at the run's `git_sha` into `meta/indicators.json` (export spec section 4). Tests: AC-CFG-21.
47. (ADR-034 amendment A1 item 4, CR-15, phase A, 2026-11-10, pending user confirmation) `config/dashboard.yaml` holds only `default_domain` (string; unknown keys are errors, `dashboard.schema.json`). When present it must be a known domain id of the `domains` list of `indicators.yaml` (the ids checked by rule 13 / `KNOWN_DOMAIN_IDS`) with `ranked: true`; an unknown id (for example the dropped `markets`) or an unranked domain (`agri`, `global`) is an error at CI and `plan`. Recommended value `growth`. The file is optional; when absent the export writes `default_domain = null` and the site falls back to the first ranked domain in stored order (export spec section 4). Tests: AC-CFG-22.

### 1a. Re-estimating group example (DG-01; illustrative)

A re-estimating group (seasonally adjusted Eurostat series, the BIS credit-to-GDP gap, the OECD CLI are the families named in the DDL and design Q33; no group id, dataset or number below is researched: ids, `expected_series_min` and `max_revised_rows` are PLACEHOLDERS to be set at implementation and from the AC-OPS-8 measurement). Only the keys that differ from section 1 are shown in full; every other group key of section 1 applies.

```yaml
      - id: bis_credit_gap              # PLACEHOLDER id
        description: BIS credit-to-GDP gap (history recomputed on each release)
        note: "BIS credit-to-GDP gap, quarterly recompute"     # rule 10: the re-estimation family
        format: csv
        parser: macro_monitor.ingestion.parsers.bis:parse
        fetch_scope: complete
        series_map: config/series_map/bis_credit_gap.yaml
        expected_series_min: 40         # PLACEHOLDER (COMP-01 floor, rule 7)
        freshness: {frequency: Q, typical_lag_days: 120, tolerance_days: 30}   # PLACEHOLDER
        reestimating: true              # DDL reestimating; revision_class = 'reestimation'; REV-06 replaces REV-01
        revision:
          max_revised_rows: 5000        # PLACEHOLDER; required (rule 10); REV-06 blocks the object above it
          materiality_rel: 0.001        # optional; this IS the default for reestimating: true (rule 30), written here for readability
          materiality_abs: 0            # optional; default 0 = half published unit decides
          snapshot_mode: diff_above_tol # optional; this IS the default for reestimating: true (rule 31); `none` would opt out
```

A minimal valid re-estimating group omits `materiality_abs`, `materiality_rel` and `snapshot_mode` and carries only `reestimating: true` with `revision.max_revised_rows`; the effective values are then `0`, `0.001` and `diff_above_tol`. The IMF WEO group of section 2 sets none of the three keys (effective `0`, `0`, `none`).

### 1b. Bulk group with landing-page discovery (ADR-028, rule 44; illustrative, patterns [UNVERIFIED] until an operator probe)

```yaml
groups:
  - id: pinksheet_monthly
    enabled: false                      # parked until the probe and the licence decision (rule 45); needs a `note`
    note: "Enable after the operator probe of the landing page; licence decision pending."
    request_template:                   # exactly one of `path` or `discover` on a bulk group (rule 44)
      discover:
        landing_url: https://www.worldbank.org/en/research/commodity-markets
        link_pattern: '^https://thedocs\.worldbank\.org/en/doc/[0-9a-f]{32}-[0-9]+/related/CMO-Historical-Data-Monthly\.xlsx$'
        expect_matches: 1               # positive integer, default 1
        allowed_hosts: [www.worldbank.org, thedocs.worldbank.org]   # bare hostnames; must include landing_url and base_url hosts
      datasets: [CMO-Historical-Data-Monthly]
```

## 2. Manual source example (IMF WEO, D23)

```yaml
  - id: imf_weo_manual
    name: IMF World Economic Outlook (manual download)
    provider: IMF
    kind: manual                                # manual source: no http, rate_limit, change_detection, base_url or auth (rule 4)
    automated_access: manual_only
    enabled: true
    licence: {id: imf-terms, url: https://www.imf.org/en/About/copyright-and-terms, checked_on: 2026-10-17,
              non_commercial_ok: true, attribution: "Source: International Monetary Fund, World Economic Outlook",
              redistribution_of_raw: allowed}   # statistical data may be copied and distributed with attribution (data-sources F2); confirm
    archive: public
    publish_site: public                        # user to confirm (design Q1/Q4)
    terms_review: {decision: permitted, reviewed_on: 2026-10-17, url: https://www.imf.org/en/About/copyright-and-terms,
                   clause: "[to be quoted from the page at implementation]"}   # recommended for manual sources, not required (rule 4)
    inbox: {path: manual_inbox/imf_weo_manual,
            sidecar_required: [source_url, downloaded_on, downloaded_by, edition_label, edition_date],   # edition_date = publication date of the edition (round 5)
            sidecar_optional: [licence_note, import_label]}                                             # import_label: archive_import (only allowed value; rule 18)
    # Reminders fire AFTER the expected release window and ON a preflight day (A10, rule 11; round 5).
    # Preflight runs only on the 25th, so remind_on.day is 25 and the expected window ends on the 24th.
    # WEO editions are believed to appear around mid-April and mid-October [UNVERIFIED]; at implementation confirm the
    # months and typical days against the IMF calendar page https://www.imf.org/en/Publications/WEO and edit this block.
    reminders:
      - {expected_window: {month: 4,  from_day: 10, to_day: 24}, remind_on: {month: 4,  day: 25},
         text: "April WEO should be out by now [UNVERIFIED window]: download it"}
      - {expected_window: {month: 10, from_day: 10, to_day: 24}, remind_on: {month: 10, day: 25},
         text: "October WEO should be out by now [UNVERIFIED window]: download it"}
    groups:
      - id: imf_weo_files
        format: csv_or_xlsx             # fixed when the first real file is available (open question Q2)
        parser: macro_monitor.ingestion.parsers.weo:parse
        fetch_scope: complete
        edition_ordered: true           # round 5 (PROPOSED P22): an object with an older edition_date than the latest loaded edition is refused unless import_label is archive_import. Round 6: this marks the group as NAMED EDITIONS (design Q37, ADR-017)
        reestimating: false             # round 6 (user decision on Q37): WEO is handled as named editions (vintage_label per edition), NOT as a re-estimation family; REV-01 does not apply to this group, REV-07 reports
        series_map: config/series_map/imf_weo.yaml
        expected_series_min: 100        # COMP-01 floor (rule 7); PLACEHOLDER, set from the first real file (design BB7/R6); not a researched figure
        freshness: {frequency: A, release_months: [4, 10], tolerance_days: 45}   # [UNVERIFIED release months]
        published_precision: null
        # no `revision:` block: no max_revised_rows and snapshot_mode none (rule 27, ADR-017 decision 1); materiality keys omitted = 0 / 0 (rule 30)
        note: "IMF WEO: semi-annual named editions; each edition may revise and rebase history; revisions are loaded and labelled by edition, never blocked by the mass-revision rule (REV-07, report only)"
```

## 3. `indicators.yaml` entry

```yaml
domains:                           # the complete domain list of the config (rule 13); the former `markets` domain is dropped (2026-10-27, plan OQ-12). Remaining ids as in the DDL: growth, prices, labour, external, fiscal, fin, social, structural, environment, agri, global
  - {id: prices,  name: Prices and inflation, ranked: true,  min_coverage_for_rank: 0.5}   # B8 proposed default, user to confirm
  - {id: agri,    name: Agri-food,            ranked: false, notice: "informational, unranked"}   # D12
  - {id: global,  name: Global series,        ranked: false, notice: "global informational series"}   # B9

indicators:
  - id: M06
    name: Headline CPI / HICP inflation
    kind: indicator                # indicator | input (B5)
    scope: country                 # country | global (B6)
    tier: M
    priority: core                 # core | ext | opt | dropped
    currency_basis: B1             # D7
    family: price_rate             # ADR-014, rule 29: optional key of config/indicator_defaults.yaml `families`
    staleness_class: ACT120        # MKT45 | SURV75 | ACT120 | Q270 | A730 | TRI1460 | EVENT (D14); may come from the family
    stationarity_class: rate_of_change   # optional: stationary | trending_level | rate_of_change ; resolved from family/global when absent (rule 29)
    release_lag_aware: false       # optional boolean ; global default false (rule 29)
    review: {status: proposed}     # ADR-014 decision 5: proposed | confirmed ; confirmed needs by and on ; no agent sets confirmed
    transform: YOY                 # key into transform registry (analytics spec)
    alert: {method: robust_z, adverse: +1, override: null}     # D9, D19 (inflation skewed -> robust)
    rank:                          # B2; proposed defaults, user to confirm (open question 19); NO default mode (P14)
      mode: descriptive_only       # monotone_good | target_distance | descriptive_only ; mandatory
      good_dir: 0                  # 0 for descriptive_only and target_distance
      display_dir: null            # optional -1/+1 for colouring only (never used for ranking)
      targets: null                # for target_distance: {value: 0.0, source_note: ...} or {by_entity: config/targets/inflation.yaml}
    max_ref_spread_days: 92        # B1 proposed default by tier (M 92, Q 190, A 366), user to confirm
    domains: [{id: prices, ranked: true}]
    notes: null                    # exported to the dashboard (for example the M18 wording, B4)
    is_comparison: false
    tile_headline: true            # optional boolean display flag, default false (rule 46; CR-14, ADR-034 amendment A1, pending user confirmation); indicator entry only; illustrative value
    # `is_support` is NOT an authored key (rule 33, DG-02): ref.indicator.is_support is generated from `kind` (true exactly for kind: input). Writing it here is an unknown-key error. Support indicators are never exported in any file, scored or not (export spec principle 4); only their values feed transforms

  - id: A05
    name: Gross government debt, % of GDP
    kind: indicator
    scope: country
    tier: A
    priority: core
    currency_basis: B1
    staleness_class: A730
    stationarity_class: trending_level   # alert z on DIFF12 of the transformed series (rule 29); `transform: LEVEL` is unchanged
    transform: LEVEL
    alert:                         # Q50 (answered by the user 2026-10-24): z-score only for now; NO fixed override is configured in v1
      method: z
      adverse: +1
      override: null               # fixed thresholds per entity group exist only after the user supplies groups, thresholds and rationales (rule 20); the 60 % and 90 % of GDP debt lines are therefore NOT configured
    rank: {mode: monotone_good, good_dir: -1, display_dir: null}
    domains: [{id: fiscal, ranked: true}]

  - id: M13
    name: Goods trade balance, 12-month sum as % of GDP
    kind: indicator
    scope: country
    tier: M
    priority: core
    currency_basis: B1
    family: external_ratio
    staleness_class: ACT120
    transform: SUM12_PCT_GDP
    alert: {method: z, adverse: -1}
    rank: {mode: descriptive_only, good_dir: 0}
    inputs:                        # rule 12: one entry per input of the transform; rule 28: annualised_policy only `fail`
      - {id: X01, usage: denominator_gdp_lcu, currency_match: numerator, annualised_policy: fail, max_denominator_age_days: 120}
    domains: [{id: external, ranked: false}]

  - id: X01
    name: Nominal GDP, local currency units (input)
    kind: input                    # never ranked, never in scorecards or the export indicator list
    scope: country
    tier: Q
    priority: core
    currency_basis: NA
    staleness_class: Q270
    transform: LEVEL
    alert: {method: none}
    rank: {mode: descriptive_only, good_dir: 0}     # round 5: was `mode: none`, which is not an enum value
    requires_flow_basis: PERIOD_FLOW                # P18, rule 21: a quarterly seasonally adjusted annualised rate (SAAR) must not be summed
    domains: []
```
Dropped indicators (M20, M25, M26, A06, A17, G13, PMI part of M03) are listed with `priority: dropped` and are never planned.

Auxiliary inputs (B5), proposed list; their sources are not yet researched (required research follow-up, design section 14 Q22). Source suggestions below are [UNVERIFIED] background knowledge:

| Input | Content | Frequency | Needed by (transform) | Source idea [UNVERIFIED] |
|---|---|---|---|---|
| X01 | Nominal GDP, LCU; `flow_basis` must be `PERIOD_FLOW` for a quarterly series (not a seasonally adjusted annualised rate) | Q and A | `SUM12_PCT_GDP` (for example M13 goods trade balance, 12-month sum as % of GDP, and any flow indicator in LCU), `PCT_GDP` conversions | Eurostat `namq_10_gdp`, OECD QNA, World Bank WDI annual |
| X02 | Nominal GDP, USD (same flow-basis rule) | A (Q where available) | USD-denominated stocks as % of GDP (for example reserves/GDP when reserves are in USD) | WDI `NY.GDP.MKTP.CD` |
| X03 | Imports of goods AND services, USD, monthly (annual fallback); goods-only is labelled `goods_only` (round 5: the earlier table said goods only) | M (A) | reserve cover in months of imports (`RESERVE_COVER`) | national, Eurostat/Comtrade, WDI annual |
Further inputs are added by the same mechanism. Frequency-alignment and currency rules are in the analytics spec section 3.

### 3a. `indicator_defaults.yaml` (ADR-014)

```yaml
global:                              # lowest layer; every key optional here, a field with no default at any layer is a sync-config error (indicator-parameters spec section 2)
  alert: {alert_z: 2.0, watch_z: 1.5, window_obs: {M: 240, Q: 80, A: 20}, min_obs: {M: 60, Q: 20, A: 10}}
  max_ref_spread_days: {M: 92, Q: 190, A: 366}
  release_lag_aware: false           # global default; true only for a named list of indicators, list pending the user (plan OQ-10)
  stationarity_class: stationary
families:                            # named data-type archetypes (draft list: indicator-parameters spec section 4)
  market_rate: {staleness_class: MKT45, alert: {method: z}, stationarity_class: trending_level}
```
Resolution order, lowest to highest: `global`, `families.<id>`, the indicator entry, `alert.override` (P19) and entity attributes (ADR-014 decision 1). Fields with no default at any layer (`kind`, `scope`, `tier`, `priority`, `currency_basis`, `transform`, `rank.mode`, `rank.good_dir`, `alert.adverse`, `domains`, the target of a `target_distance` indicator) must be written in the indicator entry (indicator-parameters spec rule 22). Lists and objects are replaced, not merged; `alert.override` is never inherited. `sync-config` rejects an unknown family and an unknown key (rules 23, 29).

## 4. `series_map/<group>.yaml` entry

```yaml
series:
  - dataset: sts_inpr_m
    key: "M.PROD.B-D.SCA.I21.DE"         # canonical source key (seasonally and calendar adjusted; NOT the CA key, rule 8)
    entity: DEU
    indicator: M01
    role: headline                        # headline | fallback | comparison
    valid_from: 1991-01-01
    rationale: "Eurostat harmonised IP index, seasonally and calendar adjusted; EU27 member (data-sources F5 M01)"
    expect: {frequency: M, unit: IDX, base_period: "2021=100", seasonal_adjustment: SCA, price_basis: IDX}   # drift check against published metadata; optional flow_basis: PERIOD_FLOW | ANNUALISED_RATE | STOCK (P18); optional composition: FIXED | CHANGING (euro-area series; default NA; becomes ref.series.composition at first sight, ADR-018)
```
`expect` is compared with the metadata read from the raw object; any difference raises `ops.drift_event` (no silent update). The initial files are generated by a seeding script from data-sources research F5/F13 and reviewed once (plan task). Rule 8 is applied to these entries; an entry with `seasonal_adjustment: CA` for M01 fails validation, or must be recorded as `known_gap`/YoY-only. Round 6 (ADR-018): a map entry whose series has not been seen yet is PENDING: it is the whitelist of the parser, the loader creates the `ref.series` row and the `ref.series_map` row on first sight, and `config-report` lists pending entries separately from mapped ones.

Seeding coverage report (D): `macro-monitor config-report` lists, for every (indicator, entity) pair that the research expects, whether a headline mapping exists, and per indicator the mapped share of the 42 countries, the number of unmapped pairs, and the pairs mapped only by `fallback`. Expected coverage notes from the research (core inflation M07 missing for 14 non-EU countries, Q08 non-EU, M18 for three countries, A02 25 of 42) are encoded as `known_gap` entries so that the report separates known gaps from missing work. The size of the work is about 3,500 series [analyst estimate; no `series_map` file exists yet]. A series-map entry of a disabled group (rule 45; ADR-027 decision 9) is not mapped: it is listed in a separate `disabled` bucket beside `pending` and never counted as mapped, and the report shows the count per bucket. `launch_ready` keeps its definition (every core pair mapped or `known_gap`), so a core pair that only a disabled group can supply keeps it false until the group is enabled and its series seen, or the pair is declared `known_gap`.

## 5. `release_calendar.yaml`

```yaml
eurostat_sts: {frequency: M, typical_lag_days: 50, tolerance_days: 20}
bis_cbpol:    {frequency: M, typical_lag_days: 20, tolerance_days: 15}
imf_weo_files: {release_months: [4, 10], tolerance_days: 45}   # [UNVERIFIED release months; confirm against https://www.imf.org/en/Publications/WEO at implementation]
```
Explicit dates (e.g. Pink Sheet next release 2026-11-03; FAO cereal brief dates, data-sources research F11) may be listed under `dates:`; when present they override the lag rule for "expected latest period".

## 6. Acceptance criteria
- AC-CFG-1: `config/` validates against the schema in CI; invalid examples in `tests/unit/config/` each fail with a specific message (including one negative per validation rule 1-21, 27-33, 44 and 45 of this spec). The negatives for rules 22-26 (the rules of the indicator-parameters spec, section 8) are covered by AC-PAR-9 of that spec, not here.
- AC-CFG-2: every `groups[].parser` resolves; every `series_map` file exists; every indicator referenced by a map exists and is not `dropped`.
- AC-CFG-3: no secret value appears in any file under `config/` (secret scan in CI); every `env` name appears in `.env.example`.
- AC-CFG-4: a `web` source without a current `terms_review` is never fetched (test with a mock transport that fails on any request).
- AC-CFG-5 (D): `config-report` runs in CI on the real `config/` and its output is stored as a build summary; a PR that lowers the mapped share of a core indicator below the previous report without a `known_gap` entry fails; before the first production run the report shows 100 % of core (indicator, entity) pairs either mapped or listed as `known_gap`. Round 6: pending map entries (series not seen yet) are not counted as mapped. ADR-027: entries of a disabled group are listed in the `disabled` bucket and are not counted as mapped either.
- AC-CFG-6 (A11a): a series map entry for M01 with `seasonal_adjustment: CA` fails rule 8 when M01's transform requires SA; the same entry with `SCA` passes.
- AC-CFG-7: a source entry without `publish_site` fails; `publish_site: public` with `redistribution_of_raw: forbidden` fails; a group with `reestimating: true` and no `revision.max_revised_rows` fails; a reminder before the end of its `expected_window` fails.
- AC-CFG-8 (round 5): `archive: private` with `archive_policy.private_repo: null` fails (rule 17); a reminder with `remind_on.day = 26` fails and day 25 with `to_day = 24` passes (rule 11); `revision.compare: scale_min` fails (rule 10); an indicator without `rank.mode`, or an input with `rank.mode: none`, fails (rule 12); an `edition_ordered` group whose sidecar lacks `edition_date`, or has `import_label` other than `archive_import`, fails (rule 18); an override list entry without `rationale` fails (rule 20); `job_timeout_min: 400` fails (rule 19).
- AC-CFG-9 (round 6, ADR-017, ADR-018; completed in the fix pass): the WEO example of section 2 validates as a whole (a manual source with `expected_series_min`, no `rate_limit`/`http`/`change_detection`; `reestimating: false`, `edition_ordered: true`, no `max_revised_rows`); the same group with `reestimating: true` added fails rule 27; a group key `vintage_resolution` or `release_cadence_note` fails as an unknown key; a series-map entry for a series that has no `ref.series` row yet validates and is reported as pending; the same manual source with a `rate_limit` or `change_detection` block fails rule 4, and an automated source without `rate_limit` fails rule 4; a group of any kind without `expected_series_min` fails rule 7.
- AC-CFG-10 (fix pass, Q48; rules 21 and 28): an indicator entry with `inputs[].annualised_policy: latest_single` (or any value other than `fail`) fails with a message naming rule 28; the same entry with `fail` or with the key absent passes; a `headline` mapping of an X01 input to a series with `expect.flow_basis: ANNUALISED_RATE` produces the rule 21 warning and no exception path exists.
- AC-CFG-11 (fix pass, ADR-014; rule 29): `indicators.yaml` entries with `family`, `stationarity_class`, `release_lag_aware` and `review` validate; an unknown family, `stationarity_class: random`, `release_lag_aware: "yes"`, a `review.status: confirmed` without `by` and `on`, and an unknown key each fail; an indicator with `stationarity_class: trending_level` and `transform: LEVEL` validates (no constraint on `transform`); `config/indicator_defaults.yaml` validates against section 3a and a family key unknown to the schema fails.
- AC-CFG-12 (second fix pass, Q50; rule 20; extended 2026-10-27 for Q06): a CI check over the checked-in `config/indicators.yaml` fails when any indicator has a non-empty `alert.override` unless that indicator carries `review.status: confirmed` (the user's confirmation that supplies the groups, thresholds and rationales); at v1 launch no indicator has an override, and in particular Q06 resolves to `alert.method: z` with no override (the 2026-10-27 decision; the golden table check is AC-PAR-11). The A05 example of section 3 validates with `alert.method: z` and `override: null`. In the schema test, a fixture config with an override entry that has a rationale still validates (the mechanism stays available for the user's later answer) and one without a rationale fails rule 20.
- AC-CFG-13 (Phase 2 amendment, DG-01; rules 30-32): (a) the section 1a group validates and, after `sync-config`, `ref.series_group` holds `reestimating = true`, `materiality_abs = 0`, `materiality_rel = 0.001`, `snapshot_mode = 'diff_above_tol'`, `max_revised_rows = 5000`; (b) the same group with `materiality_*` and `snapshot_mode` omitted resolves to the same stored values; (c) the same group with `snapshot_mode: none` stores `none` and `materiality_rel` stays `0.001`; (d) the section 1 `eurostat_sts` group, and the WEO group of section 2 (no `revision:` block), resolve to `materiality_abs = 0`, `materiality_rel = 0`, `snapshot_mode = 'none'`; (e) each of these fails with a message naming the rule: `snapshot_mode: diff_above_tol` on a group with `reestimating: false` (rule 31); `snapshot_mode: diff_above_tol` on an `edition_ordered` group (rules 27, 31); `snapshot_mode: sometimes` (rule 31); `materiality_abs: -1` and `materiality_rel: 1.5` (rule 30); `materiality_abs` or `materiality_rel` written directly on the group, outside `revision:` (rule 32, unknown key); (f) a non-zero `materiality_abs` on a group whose series map declares two different `expect.unit` values gives the rule 30 warning and no error; (g) the stored values equal the YAML decimal text exactly (`0.001` is stored as `0.001`, not as a binary float expansion); (h) a PR that changes one of the keys changes the group's `config_sha256`.
- AC-CFG-14 (Phase 2 amendment, DG-02; rule 33; PROPOSED, depends on the user's confirmation of OQ-14): the M06 example of section 3 validates; the same entry with `is_support: false` fails as an unknown key with a message naming M06 and "derived from kind"; the same with `is_support: true` fails identically; after `sync-config` of a valid file, `ref.indicator.is_support` is true exactly for the `kind: input` rows (DDL generated column).
- AC-CFG-15 (Phase 2 amendment, second part, 2026-10-27; rule 13; plan OQ-12): the domain list of section 3 validates; the same list with `{id: markets, ...}` added, or an indicator entry with `domains: [{id: markets, ranked: false}]`, fails with a message naming rule 13 ("unknown domain"); after `sync-config` of the real config `ref.domain` holds exactly the 11 domains growth, prices, labour, external, fiscal, fin, social, structural, environment, agri, global, and `agri` and `global` are the only rows with `is_ranked = false`.

- AC-CFG-19 (ADR-028, rule 44): a bulk group with a valid `discover` block (section 1b) validates. Each of these fails validation with a specific message, from rule 44 or from the JSON schema (which catches missing required keys, unknown keys, and wrongly typed or out-of-range values first): both `path` and `discover` on one bulk group; neither; `discover` without non-empty `datasets`; `discover` on a `web`, `manual`, `sdmx` or `rest` source; `link_pattern` not compiling, not starting `^` or not ending `$` (an escaped `\$` does not count), starting `^http://`, or with a non-literal host (`^https://.*`); `landing_url` with `http://`; `allowed_hosts` empty, containing a scheme or path, lacking the `landing_url` host, or lacking the `base_url` host; `expect_matches` 0, -1, 1.5 or `true`. `plan` refuses `expect_matches: 2` and two datasets on a discovered group. Invariant (fixture connector with a landing page of zero matches, two distinct matches, and a match outside `allowed_hosts`): resolution fails with `discovery_failed`, the connector NEVER falls back to the last known URL or a date-token URL, and no raw object is stored for that run.
- AC-CFG-20 (ADR-027, rule 45): (a) a group without `enabled` keeps the pre-change `config_sha256`; it and a group with `enabled: true` have effective state equal to the source state; (b) `enabled: false` on a group of an enabled source: `plan` omits it from `fetch_matrix.include`, and `fetch <group>` exits with a config error naming the group switch; (c) `enabled: true` on a group of a disabled source (including a `web` source forced off by rule 1) stays disabled and the error names the source switch; (d) a disabled group with a missing parser, series_map file or `freshness` still fails validation as an enabled group would; (e) `enabled: false` without `note` gives a warning, not an error, and with `note` no warning; (f) an enabled source with all groups disabled gives the "source enabled, no group enabled" warning only; (g) rule 3: an enabled source with absent auth env fails `plan` when at least one group is enabled, and does not fail when every group is disabled; (h) a non-boolean `enabled` fails schema validation; (i) after `sync-config`, `ref.series_group.enabled` holds the group's own flag; (j) `config-report` lists a disabled group's entries in the `disabled` bucket, not as mapped, and `launch_ready` is false when a core pair is supplied only by a disabled group.
- AC-CFG-21 (rule 46, CR-14, ADR-034 amendment A1, 2026-11-10, pending user confirmation): negative fixtures in `tests/unit/config/`, each failing validation with a message that names rule 46: (a) `tile_headline: "yes"` (non-boolean) on an indicator entry; (b) `tile_headline` under `global` of `indicator_defaults.yaml`; (c) `tile_headline` under a family of `indicator_defaults.yaml`; (d) `tile_headline` on a `kind: input` entry; (e) `tile_headline` on a `domains` list entry. Positive: an entry with `tile_headline: true` and one without the key both validate, and `sync-config` writes no column for it.
- AC-CFG-22 (rule 47, CR-15, ADR-034 amendment A1, 2026-11-10, pending user confirmation): negative fixtures, each failing at validation with a message that names rule 47: (a) `default_domain: markets` (unknown, dropped domain); (b) `default_domain: agri` (known, unranked); (c) `default_domain: global` (known, unranked); (d) an extra key beside `default_domain` in `config/dashboard.yaml`; (e) a non-string value. Positive: `default_domain: growth` validates; an absent `config/dashboard.yaml` validates.

## Change log (ADR-034 amendment A1, 2026-11-10) — pending user confirmation
- File table: `config/dashboard.yaml` row (CR-15). Section 3: optional key `tile_headline` in the indicator entry example (CR-14). Rules 46 (`tile_headline`) and 47 (`default_domain`); AC-CFG-21 and AC-CFG-22. No database change. Status unchanged.

## Change log (ADR-027 and ADR-028, 2026-11-05; both approved by the user on 2026-11-05, stated in session)
- Status set to `draft`, then re-approved the same day on the user's instruction stated in session ("check prepared specs, approve them or fix"), after an agent review and fixes.
- Rule 44 (ADR-028, already implemented): `request_template.discover` for bulk groups; section 1b example; AC-CFG-19.
- Rule 45 (ADR-027): optional group-level `enabled`; the section 1 group example gains the key; AC-CFG-20; rule 3 narrowed to sources with at least one enabled group (resolved Q3); `config-report` `disabled` bucket and AC-CFG-5 wording; AC-CFG-1 negative count extended to rules 44 and 45.
- Numbering: AC-CFG-16, 17 and 18 are claimed by the freshness, domain-eligibility and frequency-downgrade amendments, so the new criteria are AC-CFG-19 and AC-CFG-20.
## Change log (Phase 2 amendment, second part, 2026-10-27; user decisions stated in session)
- Status stays `draft`; the user re-approves.
- Rule 13 and the domain list of section 3: the `markets` domain is dropped (plan OQ-12); AC-CFG-15 added (11 domains; unknown domain id fails).
- Rule 20, AC-CFG-12 and the rule 29 note: Q06 is z-score only, no override (plan OQ-15 closed); the OQ-10 list is pointed to the proposal file, not decided.

## Change log (Phase 2 amendment, 2026-10-27; status reset to `draft`, the user re-approves)
- DG-01 (design gap, found by the planner): the group schema had no keys for `snapshot_mode`, `materiality_abs` and `materiality_rel`, although `ref.series_group` (DDL), ADR-017 and design Q33 use them and unknown keys are errors, so re-estimating groups (Eurostat seasonally adjusted, BIS gap, OECD CLI) could not be configured. Added to the `revision:` block: the three keys with type, range, defaults, applicability and DDL mapping (rules 30-32, mapping table), the example of section 1a, the defaults shown in the section 1 example, a comment in the WEO example, AC-CFG-13, and AC-CFG-1 now covers rules 27-33. No decision of ADR-017, the DDL or Q33 is changed: defaults 0 / 0 / `none` for regular groups and 0 / 0.001 / `diff_above_tol` for `reestimating: true` are the values of Q33 and the DDL comment; WEO stays at `none` (ADR-017 decision 1; rule 27). Placement inside `revision:` (beside `rel_epsilon` and `max_revised_rows`) is a drafting choice of this amendment, not a prior decision; it is stated in rule 32 for the user to confirm.
- DG-02 (inconsistency): `is_support` was shown as an authored key in the M06 example although it is derived from `kind`. Removed from the example; the section 3 schema now states it is derived and that authoring it is an error (rule 33, AC-CFG-14). PROPOSED resolution of plan OQ-14, FOR USER CONFIRMATION; OQ-14 is not closed.
- Not changed: every other rule, example and acceptance criterion; the older change logs below are history.

## Change log (second fix pass, 2026-10-25)
- Section 3: the A05 example is consistent with the user's answer to design Q50 (z-score only, no fixed override): `method: z`, `override: null`, comment names Q50; the `euro_area` 60 % / 90 % entry is removed. The comment on `is_support` is corrected (support indicators are not exported at all; the flag is derived from `kind`).
- Rule 20 states that v1 ships with no override entries and that the mechanism is tested with fixture configs only. New AC-CFG-12.
- Status stays `draft`.

## Change log (Phase 2 fix pass, 2026-10-25)
- Status reset to `draft`; front-matter `inputs` is a block list and now includes ADR-014.
- Rules 4 and 7 state their source kinds; WEO manual example completed (`expected_series_min` placeholder, `terms_review`); AC-CFG-9 extended accordingly.
- `config/indicator_defaults.yaml` added to the file table and section 3a; indicator keys `family`, `stationarity_class`, `release_lag_aware`, `review` added to section 3 with rule 29 and AC-CFG-11; AC-CFG-1 states that rules 22-26 negatives are AC-PAR-9 of the indicator-parameters spec.
- The round-3 sentence that tied `trending_level` to the `transform` is replaced by rule 29 (class does not constrain `transform`; analytics applies DIFF12 for the alert window).
- Rule 21 loses the `latest_single` exception; new rule 28 and AC-CFG-10 reject `annualised_policy: latest_single`. Example M13 added to section 3 to show `inputs`.

## Change log (round 6, 2026-10-25)
- Reverses the round-2 entry below: the WEO example group is `reestimating: false`, `edition_ordered: true` (design Q37 answered by the user: named editions); rule 27 added; rule 10 and rule 18 reference it; AC-CFG-9.
- The round-3 "per source group `vintage_resolution` / `release_cadence_note`" additions are withdrawn from v1 (forecast-store vocabulary, ADR-011, v2); the dashboard V4 shows fixed text instead (export spec section 7).
- Series-map entries are the parser whitelist; `ref.series` rows are created by the loader at first sight (ADR-018); `expect.composition` added; the "Loaded into" column of the file table corrected.

## Change log (2026-10-18 review fixes)
- T2-3: WEO reminders are now configurable (`expected_window` plus `remind_on`); months and days are [UNVERIFIED] placeholders and must be confirmed against the IMF calendar page at implementation; rule 11 rewritten accordingly. The hard-coded 25 April / 25 October dates are removed.
- T2-5: `publish_site` is a numbered validation rule (15) with the dump/raw-release gating consequence; group fields `reestimating` (bool) and `published_precision` (decimals) added with rules 10 and 16; rule 8 extended (CA-only pairs become `known_gap` or YoY-only); M01 example shown with `SCA` and an explicit warning against the CA key; `is_support` indicator flag added (T2-4); AC-CFG-7 added; AC-CFG-1 covers rules 1-16.
- The WEO example group now carries `reestimating: true` with a re-estimation `note` (decision for user: confirm WEO belongs in the re-estimation register). SUPERSEDED in round 6.

## Review round 3 additions (2026-10-18)
- Section 2 (WEO manual source): `parser.expect.estimates_start_after: required`; years <= the attribute are `EST`, later years `PROJ`; absence is a `schema_drift` event and A02 is n/a [UNVERIFIED for the manual file; confirm on the first real file].
- Section 3 new optional keys: `stationarity_class` (`stationary` default | `trending_level` | `rate_of_change`); `inputs[].max_denominator_age_days` (default 120); global `hi_inflation_threshold` (default 0.25, bounds 0-1); `calendar_basis`; entity-level `regime_start` (date) and `fx_regime_flag` (`managed` | `multiple`); domain-level `core_pillars` (default none). (Round 6: the per-source-group keys `vintage_resolution` / `release_cadence_note` listed here originally are withdrawn from v1, see the round 6 change log.) The round-3 sentence "Rule: `stationarity_class: trending_level` requires `transform` in {DIFF12, YOY_PCT_POINT_CHANGE} for alerting, or an `alert_override`" is SUPERSEDED by rule 29 (fix pass 2026-10-25): the class does not constrain `transform`.
- Section 6 acceptance: unknown enum values rejected; threshold bounds checked; `published_decimals` is not configurable downward (ingestion spec AC-ING-16).
- Euro-area series declare `composition` (FIXED | CHANGING); a CHANGING series is never spliced with a FIXED one (ADR-009, DDL spec).

## Change log (review round 5, 2026-10-24)
- Bugs/stale text: `revision.compare` value `scale_min` replaced by `published_decimals` (example and rule 10); `rank: none` replaced by `rank.mode: descriptive_only` (rule 12, X01 example); the WEO example reminder day 26 (which could never fire because preflight runs on the 25th) is now day 25 with the expected window ending on the 24th; rule 11 rewritten (`to_day < remind_on.day <= 25`, evaluated by the first preflight on or after `remind_on`).
- Private repository: `archive_policy.private_repo`, `archive: private` rejected (rule 17), `hash_only` defined, rule 5 and 15 reconciled (PROPOSED, design Q46).
- New: `missing_markers` (explicit missing values, `MISS`); `job_timeout_min` (BB28); manual sidecar `edition_date`, optional `import_label`, group key `edition_ordered` (rule 18, PROPOSED P22, Q47); `display_dir`; `published_precision` versus `published_decimals` naming note; per-entity-group alert overrides with rationale (rule 20, PROPOSED P19, Q50); flow-basis requirement for GDP denominators (rule 21, PROPOSED P18, Q48); X03 = imports of goods and services; AC-CFG-8; AC-CFG-1 now covers rules 1-21.
