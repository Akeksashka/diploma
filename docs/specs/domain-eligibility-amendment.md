---
status: approved   # approved by the user on 2026-11-04 (stated in session: "approve all"); amendments are merged into the base specs by a later Phase 2 step
user_decisions_recorded: 2026-11-04   # answers to questions 1, 2, 4 given in session 2026-11-04 (section 0, section 8); questions 3 and 5 still open
amends:
  - docs/specs/analytics-and-r-contract-spec.md   # section 4.4, AC-AN-6, AC-AN-19, section 9 P8
  - docs/specs/source-config-schema.md            # section 3 (domains list, domain membership), rules 38-40, AC-CFG-17
  - docs/specs/ddl-neon-schema.md                 # section 2 (ref.domain, ref.indicator_domain), section 6 (scorecard tables), tests
  - docs/specs/dashboard-export-spec.md           # section 4 (meta/domains.json), section 5 (scorecard entity fields)
inputs:
  - ADR-019
  - ADR-014
  - docs/specs/analytics-and-r-contract-spec.md
  - docs/specs/source-config-schema.md
  - docs/specs/ddl-neon-schema.md
  - docs/specs/dashboard-export-spec.md
---
# Amendment: domain eligibility as configuration (`min_ranked_indicators`, `core_pillars`)

Date: 2026-11-04 (revised the same day after the user's answers). Repository facts were read on 2026-11-04 (file paths are the citations). PostgreSQL behaviour is cited with URL and access date 2026-11-04. Decision record: ADR-019 (proposed). The approved base documents are not edited here; section 9 lists the edits.

## 0. User decisions recorded (2026-11-04)

| # | Decision | Where it acts |
|---|---|---|
| UD-1 | No `core_pillars` are declared at launch. Defaults reproduce current behaviour (threshold 3, no pillar rule), so the existing golden files stay valid. The mechanism is built and tested with fixture configs only | section 2 (shipped config), AC-DOM-5, AC-CFG-17 |
| UD-2 | `low_coverage_reason` is kept (both scorecard tables, export, reason texts) | section 3, 4, AC-DOM-1, AC-DOM-9 |
| UD-3 | `min_coverage_for_rank` = 0.5 (B8) is confirmed; it is no longer a "proposed default" | section 4, ADR-019 consequences |

## 1. Reality check

| Topic | Spec today | Code / migrations today | Delta |
|---|---|---|---|
| Threshold "fewer than 3 ranked indicators" | `min_ranked_indicators` (default 3), analytics spec 4.4 and AC-AN-6 | constant `MIN_RANKED_INDICATORS = 3` in `analytics/scorecard.py`; `DomainDef.min_ranked_indicators` exists but `load_domain_context` never reads a value; no column in `ref.domain` (0001) | column `ref.domain.min_ranked_indicators`, read by analytics |
| `core_pillars` (P8) | analytics spec 4.4 and section 9: "optional ... `ref.domain.core_pillars`, default none"; AC-AN-19 clause | docstring of `scorecard.py`: "not implemented ... reported"; no column; `indicators.schema.json` accepts `core_pillars` (array of strings) on a domain; `sync.py` ignores it | column + membership tag + rule (none declared at launch, UD-1) |
| Pillar membership | not specified (what a pillar string refers to is undefined) | none | `ref.indicator_domain.pillar` |
| Why unranked | `low_coverage` boolean only | `analytics.scorecard.low_coverage` | `low_coverage_reason` (kept, UD-2) |
| Static eligibility | static config, applied before the snapshot is written (`demote_ineligible`, called in `analytics/run.py`) | implemented (T44) | unchanged, threshold from the column |

## 2. Config schema (source-config section 3)

Domain entry of `config/indicators.yaml` (two keys added; `core_pillars` already passes the JSON schema, `min_ranked_indicators` is new):

```yaml
domains:
  - {id: prices,  name: Prices and inflation, ranked: true, min_coverage_for_rank: 0.5, min_ranked_indicators: 3, core_pillars: []}
  - {id: labour,  name: Labour market, ranked: true, min_coverage_for_rank: 0.5,
     core_pillars: [employment, wages]}                        # ILLUSTRATIVE ONLY; v1 ships no pillars (UD-1, ADR-019 decision 4)
  - {id: agri,    name: Agri-food, ranked: false, notice: "informational, unranked"}
```
Domain membership in an indicator entry gets an optional `pillar`:
```yaml
    domains: [{id: labour, ranked: true, pillar: employment}]   # ILLUSTRATIVE
```
`entry_domain` in `indicators.schema.json` has `additionalProperties: false`, so `pillar` is added there; the domain definition gets `min_ranked_indicators` (integer, minimum 1).

Shipped configuration (USER DECISION UD-1): the checked-in `config/indicators.yaml` declares no `core_pillars` (absent or empty) on any domain and no `pillar` on any membership; `min_ranked_indicators` is absent (default 3) or 3. Adding pillars later is a separate user decision after a real run shows how many entities are unranked by share alone; it is a config-only change plus golden-file regeneration, not a code change.

Validation rules (numbers continue after rule 37 of `docs/specs/freshness-state-amendment.md`):
38. `min_ranked_indicators`: integer >= 1, optional, default 3, allowed on any domain (it has no effect on a domain with `ranked: false`). If a domain with `ranked: true` has fewer configured ranked members (`kind: indicator`, `rank.mode` not `descriptive_only`, membership `ranked: true`) than its `min_ranked_indicators`, `sync-config` and `config-report` print a WARNING naming the domain and the two numbers (the domain is descriptive; this is today's state of `prices`, analytics spec P13). It is not an error (question 3 still open).
39. `core_pillars`: list of unique strings matching `[a-z0-9_]+`, optional, default `[]`, only on a domain with `ranked: true`. Each listed pillar must be used as `pillar` by at least one ranked membership of that domain; otherwise no entity could cover it and the domain could never rank: error naming domain and pillar. A domain with pillars whose ranked members are fewer than the number of pillars is the same error.
40. `pillar` on a domain membership: string `[a-z0-9_]+`, only on a membership with `ranked: true`; a `pillar` that is not listed in the domain's `core_pillars` is allowed (a descriptive tag) and produces an info line in `config-report`. One pillar per membership.

AC-CFG-17 (config): the domains of the shipped `config/indicators.yaml` validate with `min_ranked_indicators` absent and `core_pillars` absent or empty, and a test asserts that NO shipped domain has a non-empty `core_pillars` and NO shipped membership has a `pillar` (UD-1); negatives, one each: `min_ranked_indicators: 0`; `core_pillars: [Bad Pillar]`; duplicate pillar; `core_pillars` on an `agri` domain; a pillar declared on the domain but used by no member; `pillar` on an unranked membership; `pillar: ""`; unknown key on a domain. A domain with `min_ranked_indicators: 4` and three ranked members validates with the rule-38 warning. After `sync-config`, `ref.domain` holds for all 11 domains `min_ranked_indicators = 3` and `core_pillars = '{}'`, and `ref.indicator_domain.pillar` is NULL for every row.

## 3. Migration NNNN_domain_eligibility.sql (forward-only; 0013 if 0011 and 0012 of the freshness amendment land first)

The runner needs contiguous versions (`storage/migrate.py`); the number is the next free at implementation. Never edit 0001 or 0008.

```sql
ALTER TABLE ref.domain
  ADD COLUMN min_ranked_indicators smallint NOT NULL DEFAULT 3 CHECK (min_ranked_indicators >= 1),
  ADD COLUMN core_pillars text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT domain_core_pillars_form   CHECK (array_to_string(core_pillars, ',') ~ '^([a-z0-9_]+(,[a-z0-9_]+)*)?$'),
  ADD CONSTRAINT domain_core_pillars_ranked CHECK (cardinality(core_pillars) = 0 OR is_ranked);

ALTER TABLE ref.indicator_domain
  ADD COLUMN pillar text,
  ADD CONSTRAINT indicator_domain_pillar_form   CHECK (pillar IS NULL OR pillar ~ '^[a-z0-9_]+$'),
  ADD CONSTRAINT indicator_domain_pillar_ranked CHECK (pillar IS NULL OR is_ranked);

-- the published table was created with LIKE ... INCLUDING ALL (0008); a later ALTER of analytics.scorecard does not follow, so both are altered
-- low_coverage_reason is kept (UD-2)
ALTER TABLE analytics.scorecard
  ADD COLUMN low_coverage_reason text CHECK (low_coverage_reason IN ('share','core_pillar','share_and_core_pillar')),
  ADD CONSTRAINT scorecard_reason_needs_flag CHECK (low_coverage_reason IS NULL OR low_coverage),
  ADD CONSTRAINT scorecard_flag_needs_reason CHECK (NOT low_coverage OR low_coverage_reason IS NOT NULL) NOT VALID;
ALTER TABLE analytics.scorecard_published
  ADD COLUMN low_coverage_reason text CHECK (low_coverage_reason IN ('share','core_pillar','share_and_core_pillar')),
  ADD CONSTRAINT scorecard_pub_reason_needs_flag CHECK (low_coverage_reason IS NULL OR low_coverage),
  ADD CONSTRAINT scorecard_pub_flag_needs_reason CHECK (NOT low_coverage OR low_coverage_reason IS NOT NULL) NOT VALID;
```
Notes:
- `ADD COLUMN` with a constant non-volatile `DEFAULT` does not rewrite the table: the default is stored in the catalog and returned for existing rows; a column without default is NULL for existing rows [PostgreSQL ALTER TABLE notes, https://www.postgresql.org/docs/current/sql-altertable.html, accessed 2026-11-04]. All 11 existing domain rows therefore read `3` and `'{}'`, which is today's behaviour.
- `NOT VALID` makes the check apply to new inserts and updates only; existing rows are not scanned (same source). It is used because the analytics tables are insert-only: pre-existing rows with `low_coverage = true` have a NULL reason and must not be touched. The constraints are never validated with `VALIDATE CONSTRAINT`.
- Privileges: no new grant. `mm_ingest` has table-level SELECT/INSERT/UPDATE on `ref.domain` and `ref.indicator_domain`; `mm_reader` has table-level SELECT on both and on `analytics.scorecard_published` (0006, 0008); table-level grants cover added columns. The privilege matrix fixture does not change.
- History: `ref.fn_config_history_feed` writes `to_jsonb(row)`, so changes to the new columns appear in `ref.config_history` (tables `domain`, `indicator_domain`) with no trigger change (0002).
- The cross-row rule of config rule 39 (a declared pillar has a ranked member) is enforced by `sync-config` and tested, not by a trigger (insert order of the two tables would make a trigger fragile).

## 4. Eligibility behaviour (normative, replaces the threshold text of analytics spec 4.4)

Per candidate set (full and published), per domain `d`:
1. `ranked_members(d)` = indicators with `kind = 'indicator'`, `rank_mode <> 'descriptive_only'` and a membership in `d` with `is_ranked`. Unchanged definition.
2. Domain eligible iff `ref.domain.is_ranked` AND `|ranked_members(d)| >= ref.domain.min_ranked_indicators`. An ineligible domain produces NO scorecard rows; indicators whose every ranked domain is ineligible get `publish_scope = 'info_only'` (`demote_ineligible`, unchanged).
3. For an entity `e` in an eligible domain: `share_low = n_available(e) / n_defined(e) < min_coverage_for_rank` (exact decimal comparison, unchanged; `min_coverage_for_rank` = 0.5, confirmed by the user, UD-3). `n_available`/`n_defined` keep the definitions of 4.4 including concept de-duplication.
4. `pillar_low` = `core_pillars(d)` is non-empty AND there is a declared pillar `p` such that no indicator with membership pillar `p` is available for `e` in this set. "Available" = the indicator has a percentile for `e` in the candidate set (the definition behind `n_available`). Concept de-duplication does not matter for this test: any available indicator of the pillar covers it. With the shipped config (UD-1) `core_pillars(d)` is empty for every domain, so `pillar_low` is always false and the golden outputs are unchanged.
5. `low_coverage = share_low OR pillar_low`; `low_coverage_reason` = `share`, `core_pillar` or `share_and_core_pillar` accordingly; NULL when `low_coverage` is false. With the shipped config the only value that can occur is `share`. `low_coverage` entities keep `percentile_rank` (the mean) and `n_available`/`n_defined`, have `rank_position` NULL, and are excluded from `n_ranked_entities` (unchanged effect).
6. Withheld pairs: in the published set an indicator whose entity value is withheld is not available, so `pillar_low` and `share_low` are computed from published pairs only, like `n_available` (AC-EXP-4(d) perturbation still holds).

Worked example (illustrative; fictional indicators; requires a fixture config because v1 ships no pillars). Domain `demo`: `min_coverage_for_rank 0.5`, `core_pillars [a, b]`; ranked members I1 (pillar a), I2 (a), I3 (b); `n_defined = 3`.

| Entity | Available | Share | Pillar a | Pillar b | `low_coverage` | Reason |
|---|---|---|---|---|---|---|
| E1 | I1, I2, I3 | 3/3 | yes | yes | false | - |
| E2 | I1, I2 | 2/3 (>= 0.5) | yes | no | true | `core_pillar` |
| E3 | I3 | 1/3 (< 0.5) | no | yes | true | `share_and_core_pillar` |
| E4 | I1 | 1/3 | yes | no | true | `share_and_core_pillar` |
| E5 | none | 0/3 | no | no | true | `share_and_core_pillar`; `percentile_rank` NULL |

With `core_pillars` empty (the v1 shipped state), E2 is not low coverage and E3, E4 and E5 have reason `share`.

## 5. Delta for the implementation (no code here)
- `analytics/scorecard.py`: `load_domain_context` reads `min_ranked_indicators`, `core_pillars` and the membership `pillar` (`DomainIndicator.pillar`); `eligible_domains` already compares with `d.min_ranked_indicators`; `build_scorecard` applies step 4-5 and sets the reason; the module constant stays only as the documented default; `write_scorecard` writes `low_coverage_reason` to both tables. The docstring sentence "core_pillars rule (P8) is not implemented" is removed.
- `registry/sync.py` `_sync_indicators`: upsert the two domain columns and `indicator_domain.pillar`.
- `registry/schemas/indicators.schema.json`: `min_ranked_indicators` on `domain`; `pillar` on `entry_domain`; rules 38-40 in the semantic validator.
- `config-report`: print per domain `min_ranked_indicators`, the count of configured ranked members, the pillars with their member counts, the rule-38 warning, and for domains with pillars the number of entities that would be `pillar_low` on the latest published set.
- Export: `meta/domains.json` gains `min_ranked_indicators` (int) and `core_pillars` (array of strings, empty when none); each scorecard entity row gains `low_coverage_reason` (string or null, copied from `scorecard_published`, never derived; present only when the row is `low_coverage`, otherwise null). Both are additive nullable/empty fields (minor contract bump). EXP-05 compares the field with the published table. The three reason codes map to fixed texts in the front end (design section 8a).
- Implementation-phase item: no change to `config/indicators.yaml` pillars (UD-1); only add `min_ranked_indicators` where explicitness is wanted (optional).

## 6. Acceptance criteria

- AC-DOM-1 (migration; T-DDL-40). The migration applies to a database that already holds the 11 seeded domains and a scorecard row with `low_coverage = true` and no reason: all domains read `min_ranked_indicators = 3`, `core_pillars = '{}'`; the pre-existing scorecard row survives; a new `scorecard` insert with `low_coverage = true` and NULL reason fails; with `low_coverage = false` and a reason fails; a reason outside the three values fails. The same four assertions on `scorecard_published`. A changed checksum of 0001 or 0008 is rejected by the runner.
- AC-DOM-2 (column checks; T-DDL-41). `min_ranked_indicators = 0`, `core_pillars = '{Bad Pillar}'`, `core_pillars = '{a}'` on a domain with `is_ranked = false`, `indicator_domain.pillar = 'x'` with `is_ranked = false`, and `pillar = 'Bad'` are each rejected; `core_pillars = '{}'` on an unranked domain is accepted.
- AC-DOM-3 (config; AC-CFG-17). As in section 2, including the no-shipped-pillars assertion (UD-1).
- AC-DOM-4 (history; T-DDL-42). After `sync-config` changes `min_ranked_indicators` of one domain and the `pillar` of one membership (fixture config), `ref.config_history` has a row for table `domain` and one for table `indicator_domain` with the new values; `ref.fn_config_asof` at a time before the change returns the old values.
- AC-DOM-5 (threshold from the column; analytics db test). A fixture domain with two ranked members: `min_ranked_indicators = 2` gives scorecard rows in both sets; `3` gives none, the members' snapshot rows have `publish_scope = 'info_only'`, and the domain is absent from `scorecard_published`; a domain with `ranked = false` and `min_ranked_indicators = 1` gives no rows. With the SHIPPED config (every domain at 3, no pillars, UD-1) the existing golden `published_set.json` is reproduced byte for byte (AC-AN-1 unchanged) and every scorecard row with `low_coverage = true` has reason `share`.
- AC-DOM-6 (pillar rule; AC-AN-19 clause 3 rewritten; fixture config with pillars). The worked example of section 4 as a database fixture: E1 not low coverage, E2 `core_pillar`, E3, E4 and E5 `share_and_core_pillar`; E2 has `rank_position` NULL and is not counted in `n_ranked_entities`; the same fixture with `core_pillars` empty gives E2 ranked and E3-E5 reason `share`; `peer_set_size_min/max` and `heterogeneous_peer_set` are unchanged by the pillar rule.
- AC-DOM-7 (published set; fixture config with pillars). In the fixture of AC-DOM-6 withhold I3's source for E1: in the full set E1 is `low_coverage = false`, in the published set E1 is `core_pillar`; changing the withheld values changes no published row (extends AC-AN-10 and AC-EXP-4(d)).
- AC-DOM-8 (AC-AN-19, unchanged parts). The A02 (25) and 42-country fixture still gives `heterogeneous_peer_set = true` (42/25 = 1.68) and 36/25 = 1.44 gives false; stored `peer_set_size_min/max` equal 25 and 42 on every row of the domain in both sets.
- AC-DOM-9 (export). `meta/domains.json` carries `min_ranked_indicators` and `core_pillars` for all 11 domains (`core_pillars` empty for all with the shipped config); a `low_coverage` entity exports its reason, any other entity exports null; EXP-05 fails when the exported reason differs from `scorecard_published`; a perturbation of `core_pillars` in the fixture config changes the exported reasons and nothing else.
- AC-DOM-10 (privileges). `mm_reader` can SELECT `low_coverage_reason` from `analytics.scorecard_published` and cannot SELECT `analytics.scorecard`; the expected privilege matrix is unchanged.

## 7. Replacement text for the analytics spec
- Section 4.4, first paragraph, first sentence: "A domain whose `ref.domain.min_ranked_indicators` (default 3, set in `config/indicators.yaml`, ADR-019) is larger than the number of its active ranked indicators (`kind = 'indicator'`, `rank_mode <> descriptive_only`, `indicator_domain.is_ranked`) is `descriptive_only`: ..." (rest unchanged).
- Section 4.4, Heterogeneous peer sets: replace "(PROPOSED P8, optional config) `min_coverage_for_rank` also requires ... (`ref.domain.core_pillars`, default none = rule off)" by: "`ref.domain.core_pillars` (ADR-019; default none = rule off; v1 declares none) adds a second cause of `low_coverage`: when the domain declares pillars, an entity is `low_coverage` if it has no available indicator for at least one declared pillar (pillar membership is `ref.indicator_domain.pillar`); the cause is stored in `low_coverage_reason`."
- AC-AN-6: "... any domain with fewer than its `min_ranked_indicators` ranked indicators produce no ranks ...".
- AC-AN-19: keep the 42/25 and 36/25 parts and the stored `peer_set_size_min/max` part; replace "with `core_pillars` declared and no pillar-covered indicator -> `low_coverage = true`" by "see AC-DOM-6 (database fixture)".
- Section 9, P8: "ADOPTED as proposed by ADR-019 (`status: proposed`); user decision 2026-11-04: v1 ships no pillars."
- B8 (`min_coverage_for_rank` 0.5): "confirmed by the user 2026-11-04" replaces "proposed default awaiting confirmation" wherever it appears.
- Section 4.4 Prices consequence and P13 are unchanged.

## 8. Questions: status after the user's answers (2026-11-04)

| # | Original question | Status |
|---|---|---|
| 1 | Which domains declare `core_pillars` at launch | CLOSED, UD-1: none; defaults reproduce current behaviour; golden files valid |
| 2 | Is `low_coverage_reason` wanted | CLOSED, UD-2: kept |
| 3 | Domain with fewer ranked members than its minimum: warning (proposed) or configuration error | OPEN (not answered; the warning stays, because `prices` is in that state by design until target tables exist, analytics P13, design Q45) |
| 4 | Confirm `min_coverage_for_rank` 0.5 (B8) | CLOSED, UD-3: confirmed |
| 5 | Migration number (assumed 0013) | OPEN as a formality: next free version at implementation |

## 9. Edits to apply to the base documents when this is approved
(Not applied. The tools available in the session that revised this proposal could only create or overwrite whole files; the base specs are large and a whole-file rewrite risked corrupting approved text. The base documents are unchanged and still `status: approved`. Applying them resets each to `status: draft` with a revision note. This list is the exact remaining work.)
- `docs/specs/analytics-and-r-contract-spec.md`: section 7 above (including the B8 confirmation and P8 wording); add ADR-019 to `inputs`.
- `docs/specs/source-config-schema.md`: section 3 domain list and membership examples; rules 38-40; AC-CFG-17; change log.
- `docs/specs/ddl-neon-schema.md`: `ref.domain` block (two columns, two CHECKs), `ref.indicator_domain` (column, two CHECKs), `analytics.scorecard` (column and constraints, both tables); section 11 (migrations) gets section 3 above; T-DDL-40..42; `inputs` gets ADR-019.
- `docs/specs/dashboard-export-spec.md`: `meta/domains.json` and scorecard entity fields of section 5 above; AC-EXP-16 = AC-DOM-9.
- `docs/plans/macro-monitor-v1-implementation-plan.md` (planner scope, not edited here): T42/T44 notes "needs migration/ADR" are answered by ADR-019.
