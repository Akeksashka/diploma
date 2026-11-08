---
status: approved   # proposed | approved | superseded
---
# ADR-009: Separate "published series" from "indicator"; one headline series per (indicator, entity); comparison series stay separate

Revision note (review fixes): auxiliary input indicators and the global entity `WLD` use the same mapping mechanism (B5, B6); mapping is configuration whose hash is stored with each analytics run (B11); entity count corrected to 45. Second round (2026-10-18): mapping history is effective-dated (`valid_from` + `recorded_at`); link to `rank_mode`; support indicators. Round 5 (2026-10-24): euro-area membership change is a drift event of kind `composition`; X03 is imports of goods and services.

## Context
- Several sources publish the same concept (CPI, GDP, unemployment by Eurostat, OECD, IMF); which is authoritative and how the source is recorded per observation is an open design question (data-sources research, open question 11).
- D18: the IMF output gap is the single headline series for A02 rankings; OECD (A02b) and EC (A02c) estimates are separate comparison series never mixed in one ranking. D22: A02 ranks 25 of 42 countries; D16: coverage n/N, no imputation. D3: gaps are n/a.
- Coverage is heterogeneous: e.g. goods trade for EU members comes from Eurostat from 2002 and from OECD before that (data-sources research F5, F13); EU members' retail volume from Eurostat for some, OECD for others; Bulgaria, Cyprus, Malta, Romania are not in OECD KEI. Splicing sources would mix definitions.
- U5 routing rule: use an aggregator only if the original source has no programmatic access and the mirror is current; today only AMECO via DBnomics qualifies.
- Euro-area members inherit the ECB policy rate, the euro exchange rate and partly reserves; Bulgaria joined 1 January 2026 (data-sources research F1, open question 13).
- Re-estimations change a series' meaning (HICP classification change; PWT/WGI/SOFI/BIS reclassification) (ADR-002).
- Some transforms need denominators (nominal GDP, imports) that are not scorecard indicators, and some selected series are global (commodity prices), not per country.
- Non-monotone indicators (inflation, current account, policy rate, REER, exchange rate, output gap) have no "better" direction, so what a mapping feeds into a ranking depends on the indicator's rank mode.

## Options considered
1. Attach `indicator_id` directly to each series row and take the "best" per country at query time.
2. Explicit mapping table `ref.series_map(indicator_id, entity_id, series_id, role, priority, valid_from, valid_to, recorded_at)` maintained as reviewed config; analytics read only `role = 'headline'`.
3. Automatically splice several sources into a synthetic long series.

## Decision
Option 2.
- `ref.series` describes exactly what a source publishes (immutable measurement attributes). It carries no indicator.
- `ref.series_map` assigns series to indicators with `role` in `headline | fallback | comparison`. Invariant: at most one `headline` per `(indicator_id, entity_id, valid_from..valid_to)` (exclusion constraint). `fallback` is used only when no headline series exists for that country and indicator, and a fallback never fills a gap inside a ranked period of a headline series. `comparison` is used only by comparison views (A02b, A02c) and is excluded from rankings by construction (D18).
- Indicator kinds (B5): `ref.indicator.kind` is `indicator` (scorecard and explorer indicators) or `input` (auxiliary denominators; support indicators with `is_support`, such as X01 nominal GDP, and X03 imports of goods and services in USD, round 5). Inputs are mapped through `ref.series_map` exactly like indicators but are never ranked, never in scorecards and never in the export indicator list; `ref.indicator_input` declares which transform needs which input and the currency-matching rule. A transform whose support input is missing, stale, in a different currency or of the wrong flow basis (annualised rate used as a period flow, analytics spec P18) fails closed (n/a). The frequency-alignment rule is in the analytics spec.
- Global series (B6): the entity `WLD` (kind `aggregate`, `is_global`, not ranked) carries global series such as commodity prices (M24); `ref.indicator.scope = 'global'` indicators map only to `WLD`. Per-country translation of global series is an analytics transform using M16 (`GLOBAL_LCU_YOY`), specified but deferred in v1 and never stored.
- Link to ranking: each indicator has a `rank_mode` (`monotone_good`, `target_distance`, `descriptive_only`; analytics spec section 4.1, PROPOSED classification, with `good_dir = 0` only for the last two). A headline mapping feeds a percentile rank only for the first two modes; for `descriptive_only` indicators the mapping serves display and alerts. The mapping never encodes direction or rank mode; they belong to the indicator.
- Mapping history (second round): `ref.series_map` (and `ref.inheritance_rule`) hold the current configuration with business validity `valid_from`/`valid_to`; a change closes the old row (`valid_to`) and inserts the new one in one transaction (so the one-headline exclusion constraint holds), and every change is mirrored by trigger into the append-only `ref.config_history` (round 4: single history model, as in the DDL spec). Analytics read the mapping as recorded at the run's `config_asof` through `ref.fn_config_asof`. Indicator parameters (including `rank_mode`, targets) remain git-versioned configuration reproduced through `config_sha256` in `analytics.run.params` (B11).
- No splicing: when a source's history is shorter than 1991 (e.g. Eurostat trade from 2002), an older-period series from another source may be mapped as `headline` for the earlier validity window (`valid_to` set) only if a reviewer records that definitions are consistent (`splice_note`); otherwise the earlier period stays empty. Default: no splice.
- Mapping rows live in `config/series_map/<source_group>.yaml` and are loaded by `macro-monitor sync-config`; changes go through a reviewed commit. A re-estimated source series (ADR-002 succession) triggers an `ops.drift_event` and does not move the headline mapping automatically.
- Euro-area composition rule (review round 3, finding 8). Euro-area aggregate series come in two compositions (`ref.series.composition`: `CHANGING` = EA with the membership of each date, `FIXED` = a fixed membership such as EA20; DDL spec). A `CHANGING` and a `FIXED` series for the same concept are different series (different `series_id`), never spliced or mixed in one headline history. A membership change (for example Bulgaria joining on 1 January 2026) changes the meaning of the `CHANGING` series from the effective date: the pipeline records a succession link (ADR-002) and raises an `ops.drift_event` of kind `composition` (round 5: the kind exists in the DDL check), and it does not rewrite history. The headline mapping for the EA aggregate switches from one composition to another only by a reviewed config change (new `ref.series_map` row with `valid_from`, old row superseded), never automatically.
- Euro-area inheritance (unchanged) is expressed in `ref.inheritance_rule(indicator_id, entity_id, source_entity_id, valid_from, valid_to)`; snapshot rows for inheriting members carry `inherited = true`. How inherited values enter ranks is a user decision (design doc, Q7); default until decided: shown, flagged, excluded from percentile ranks. The fallback rules above are unchanged.
- Source authority per indicator is recorded in the mapping (and its rationale), not hard-coded; the `source_id` of every observation is reachable via `series_id`.

## Consequences
- Adding a country-indicator needs a mapping line; coverage n/N is computed from mappings and fresh values, so "defined but unmapped" counts in N and not in n (D16); `descriptive_only` indicators are in neither.
- Review burden: the initial mapping (about 80 indicators x up to 45 entities, about 3,500 series; none exists yet) is generated from the research tables (F5, F13) by a seeding script and reviewed once; this is a planning task, with a coverage report (`config-report`, AC-CFG-5) making the gap visible. The sources for the support series (X01-X03 and others) still need a research follow-up.
- Cross-source consistency problems surface as explicit mapping decisions rather than hidden query logic.
- Per-vintage mapping history makes earlier mapping states reconstructable; config-versioned parameters need the git sha for full reproduction.

## Change log (2026-10-18 review fixes)
- Mapping history (`valid_from` + `recorded_at`, supersede not update); `rank_mode` link; support indicators fail closed; WLD translation never stored; euro-area inheritance and fallback rules restated unchanged.
- 2026-10-18, review round 3: added the euro-area composition rule (CHANGING vs FIXED are different series; membership change = succession plus drift event; headline switch only by reviewed config).
- Round 5 (2026-10-24): drift kind named `composition` (now allowed by the DDL check); X03 defined as imports of goods AND services; flow-basis guard for denominators (P18) mentioned.
