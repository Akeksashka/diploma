---
status: approved   # drafted 2026-11-09; approved by the user on 2026-11-09 (stated in session: "yes to all", to the offer "yes to all, as recommended": Q-1 P1-A, Q-2 migration 0018, Q-3 P2-A, Q-4 is_comparison on A02b/A02c, Q-5 country-scope-must-not-map-to-WLD rule, Q-6 G03 no longer per country). Q-7 ("no domain, no page" as standing rule) was not asked separately; it is implied by P2-A. Applying migration 0018 to neondb is covered by the user's earlier "yes to all" for pipeline steps on neondb.
amends:
  - config/indicators.yaml                        # G03 scope and domain (problem 1, implementation scope after approval)
  - docs/specs/indicator-parameters-spec.md       # row G03 (line 108)
  - docs/specs/ddl-neon-schema.md                 # wording (lines 91, 206) and the meta/indicators publication rule
  - docs/specs/dashboard-export-spec.md           # section 4 row meta/indicators.json (line 82), section 6 (line 130), EXP-02 (checks), AC-EXP
  - docs/specs/dashboard-redesign-spec.md         # section 2 row PG-INDICATOR (line 41), AC-RD-01 (line 224)
  - docs/specs/source-config-schema.md            # no new rule proposed (see 3.5)
inputs:
  - docs/specs/g02-domain-move-amendment.md       # precedent (approved 2026-11-04)
  - src/macro_monitor/storage/migrations/0012_g02_remove_agri_domain_link.sql
  - docs/specs/dashboard-export-spec.md
  - docs/specs/dashboard-redesign-spec.md
  - config/indicators.yaml
---
# Amendment: two real-data findings of the first real export (2026-11-09)

Date: 2026-11-09. Facts below were read on 2026-11-09 from the files cited (path and line are the citation; lines are as of this date). No ADR is proposed: problem 1 is a placement correction inside the existing model, same class as the G02 amendment; problem 2 is a publication-set rule of the export, inside ADR-030/ADR-010 (no component is added). If the user wants an ADR for problem 2 (it changes what the public dashboard lists), the text of section 4 is enough for one.

## 1. Observed problems

### P1. EXP-02 fails: `series/G03.parquet: global entity WLD in a per-country file`
- `config/indicators.yaml:392-407`: G03 "Stocks-to-use ratio (wheat, coarse grains, rice, oilseeds)" has `scope: country` (line 395), `domains: [{id: agri, ranked: false}]` (line 405), `rank: descriptive_only` (line 404), `priority: ext`.
- `config/series_map/fao_csdb.yaml:5-13` (and the fallback copy `config/series_map/fao_csdb_manual.yaml:6-14`): the only mapped series is `"World cereals stocks-to-use ratio (%)"`, `entity: WLD`, `indicator: G03`, `role: headline`. The file header (lines 2-4) says per-country ratios exist only in AMIS and "the 42 country pairs stay unmapped (known-gap decision for T63)". `config/sources.yaml:541` describes the group as "world stocks-to-use (G03)".
- Check that fails: `src/macro_monitor/publish/checks.py:218-221`: for a `scope == "country"` indicator, any `is_global` entity in the parquet is a failure. The rule behind it: `docs/specs/dashboard-export-spec.md:130` ("Global indicators have entity `WLD`") and `:44` (`WLD` only in the `global` domain).
- Config already contradicts itself: `docs/specs/ddl-neon-schema.md:91` lists "G03 world prices" among the `is_global` WLD series and `:206` lists G03 among the `scope = 'global'` indicators; `docs/specs/indicator-parameters-spec.md:108` says "scope: world plus selected countries (U)" (the countries part has no data). `docs/specs/g02-domain-move-amendment.md:68` flagged this exact risk for G03.
- Note on the name: the DDL comment at `ddl-neon-schema.md:91` ("world prices") is loose; G03 is a quantity ratio, not a price. Not material.

### P2. Eight indicators with `domains: []` have no page and no scorecard
- `config/indicators.yaml`, `domains: []` at lines 329 (M22), 658 (Q14), 687 (Q16), 748 (A02b), 763 (A02c), 778 (A03), 837 (A08), 943 (A15). All are `priority: opt`, except A03 (`priority: core`, line 771), all `rank: descriptive_only`. Parameter-spec rows: `docs/specs/indicator-parameters-spec.md:103` (M22, "no scorecard domain in the selection"), `:129` (Q14, "may be dropped; no domain"), `:131` (Q16), `:139-140` (A02b, A02c "comparison (D18)"), `:141` (A03 "PROJ"), `:145` (A08 "no domain"), `:152` (A15 "no domain"). DDL `ddl-neon-schema.md:203`: "A03 (WEO projections) has no dashboard output in v1 (B9)".
- The export publishes them anyway: `src/macro_monitor/publish/meta.py:238-243` selects `kind = 'indicator' AND NOT is_comparison` with no domain condition and writes `domain_ids: dom_of.get(iid, [])` (line 274), so `meta/indicators.json` has entries with `domain_ids: []`. A02b and A02c are in the export because `is_comparison` is NOT set on them in `config/indicators.yaml` (only a comment says so: `config/series_map/dbnomics_ameco_gap.yaml:3-5`; no `is_comparison` key exists in `config/`). Evidence in the local export: `site/src/data/meta/indicators.json` lines 71 (A02b), 98 (A02c), 123 (A03).
- This contradicts the export spec as written: `docs/specs/dashboard-export-spec.md:44` says comparison-role series (A02b, A02c) are not rows of the published tables and have no `publish_scope`; `:262` and `:292` say revision files exclude comparison series and projections.
- Page rule that cannot be met: `docs/specs/dashboard-redesign-spec.md:41` (PG-INDICATOR "one per entry of `meta/indicators.json` (about 80)"), `:66` (the page reads `scorecard/<first domain_id>.json`), `:224` AC-RD-01 ("one PG-INDICATOR per indicator in `meta/indicators.json`"), `:227` AC-RD-04 (revision rows link to PG-INDICATOR). With `domain_ids = []` there is no scorecard to read.
- Current stopgap: `site/scripts/prepare-data.mjs:101-104` skips an indicator without `domain_ids` and warns. The build therefore violates AC-RD-01 as written; home list C-HOME-3 (`dashboard-redesign-spec.md:83`, grouped by domain name) cannot place them either.
- Additional fact: A03 is projection-only (`family: weo_projection`, `config/indicators.yaml:773`); projections are excluded from series and revision files (`dashboard-export-spec.md:262`, `src/macro_monitor/publish/checks.py:211-212`), so a page for A03 would show no value at all.

## 2. How global-scope indicators are handled today (basis for P1)
| Topic | Fact (file) |
|---|---|
| Config rule | `scope: global` indicator must be `descriptive_only` (rule 12, `src/macro_monitor/registry/indicators.py:282-283`), maps only to `WLD` (`src/macro_monitor/registry/sync.py:229-230`), and belongs to domain `global` only (rule 44, `registry/indicators.py:291-306`). DB: `global_not_ranked` check (`src/macro_monitor/storage/migrations/0001_ref.sql:99`). |
| Shipped global indicators | M24 (`config/indicators.yaml:332-346`, `scope: global` at 335, `domains: [{id: global, ranked: false}]` at 345) and G02 (`:376-390`, scope at 379, domain at 389). No other. |
| Analytics | Global indicators write snapshot rows for `WLD` only and none in rank or scorecard tables (AC-AN-8, `docs/specs/analytics-and-r-contract-spec.md:160`; `src/macro_monitor/analytics/snapshot.py:18`). A `scope: country` indicator gets 44 per-country snapshot rows, so G03 today produces 44 rows of which 43 or all country rows are without value (expected; not measured here). |
| Export | `series/<id>.parquet` for a global indicator carries `WLD` (`dashboard-export-spec.md:130`); `scorecard/global.json` is the only scorecard file that may contain `WLD` (`:44`, `publish/checks.py:238-241`); the per-country check applies only to `scope == "country"` (`checks.py:218`). `meta/indicators.json` carries `scope` (`publish/meta.py:275`). |
| Display | A global indicator appears on PG-DOMAIN `global` and on its PG-INDICATOR page (domain list = `[global]`). The redesign spec PG-INDICATOR and PG-DOMAIN rows do not special-case `scope` (`dashboard-redesign-spec.md:41`, `:66`). How the PG-INDICATOR page lays out a one-entity scorecard (WLD only) is [UNVERIFIED]: the layout code was not read; test needed (AC-RW-3). |
| `ref.global_translation` | Table `ddl-neon-schema.md:205-219`: country-level meaning of a WLD series (`same_value`, `weighted_by_input`, `excluded`) used inside an analytics run only (`transformed_value`), "no curated observation rows are written per country for them and no ranks". Config table, history-tracked (`0002_config_history.sql:11,77`), exported in the public dump (`0011_pubdump.sql:143-152`). No file under `config/` seeds it (grep of `global_translation` over `config/`: no match), and nothing in `src/` reads it in an analytics transform (matches are only DDL, grants, history and dump). Conclusion: it is irrelevant to the export fix; G03 needs no row in it. It would matter only if a later transform wants a per-country exposure to world stocks. |

## 3. Problem 1: options and recommendation

### 3.1 Options
| Option | What | For | Against |
|---|---|---|---|
| P1-A (recommended) | Mirror G02: G03 becomes `scope: global`, domain `global` only (`ranked: false`). | Matches the data that exists (one WLD series); matches DDL comments (`ddl-neon-schema.md:91,206`); rule 44 already enforces the domain; analytics and export need no code change (AC-AN-8, `checks.py:218`); same shape as the approved G02 move. | G03 leaves the Agriculture domain page (agri loses one member; the Global page gains one). The "world plus selected countries" intent (`indicator-parameters-spec.md:108`) is dropped from G03; a later per-country AMIS ratio would need a new indicator id (see P1-B). |
| P1-B | Keep G03 `scope: country` for a future per-country AMIS ratio; add a new `scope: global` indicator (for example `G03W`) for the world ratio; re-point `fao_csdb.yaml`/`fao_csdb_manual.yaml` to it. | Keeps a placeholder for a source that does not exist today (research F11: per-country ratios only in AMIS, `fao_csdb.yaml:3`). | New id and catalog row in an approved research set; two rows to explain; the empty country-scope G03 stays on the site with no values (the redesign spec requires sparse states); speculative. Rejected for now: add it when an AMIS source is actually approved. |
| P1-C | Relax EXP-02 so WLD may appear in a country-scope file. | One line. | Breaks the rule `dashboard-export-spec.md:44,130`, AC-EXP-7, and the G02 precedent (Q-2 rule E6 intent). Rejected. |
| P1-D | Disable group `fao_csdb` (no G03 data). | No config edit. | Loses the only real G03 data; the check would pass only by deleting data. Rejected. |

### 3.2 Recommendation: P1-A. Exact edits (applied only after approval)
| # | File:line (2026-11-09) | Now | After | Scope |
|---|---|---|---|---|
| F1 | `config/indicators.yaml:395` | `scope: country` | `scope: global` | data-engineer |
| F2 | `config/indicators.yaml:405` | `domains: [{id: agri, ranked: false}]` | `domains: [{id: global, ranked: false}]` | data-engineer |
| F3 | `config/indicators.yaml:407` notes | `"calendar_basis MKTYR; staleness borderline (spec section 7 item 3)"` | append `; scope global (WLD)` | data-engineer |
| F4 | `tests/fixtures/golden/resolved_indicators.csv:27` | `G03,indicator,country,...,agri:U,0,proposed` | `G03,indicator,global,...,global:U,0,proposed` (scope cell and domain cell only; confirm the scope column position against the header when regenerating) | data-engineer |
| F5 | new migration `src/macro_monitor/storage/migrations/0018_g03_remove_agri_domain_link.sql` (next free number; 0017 is the latest, glob of 2026-11-09) | none | `SELECT set_config('mm.git_sha', 'migration-0018', true); DELETE FROM ref.indicator_domain WHERE indicator_id = 'G03' AND domain_id = 'agri';` exactly as 0012 does for G02 (`0012_g02_remove_agri_domain_link.sql:8-9`); header comment copied from 0012 (config table only; feeder trigger `config_history_feed` appends an `op='delete'` row; no history row is changed; no-op on fresh databases). Reason it is needed: `sync-config` never deletes a link (`src/macro_monitor/registry/sync.py:578-583` per the G02 amendment, `g02-domain-move-amendment.md:55`). | data-engineer; applying to `neondb` only on the user's explicit request (CLAUDE.md) |
| F6 | `ref.indicator.scope` in existing databases | `country` | `global` | No migration: `sync-config` writes `scope` in its indicator upsert (`registry/sync.py:396`); [UNVERIFIED] that the upsert updates the column on conflict, check before closing; if it does not, add `UPDATE ref.indicator SET scope = 'global' WHERE indicator_id = 'G03'` to migration 0018 (a config table; allowed by the same reasoning as 0012). |
| F7 | `docs/specs/indicator-parameters-spec.md:108` | domain `agri`; note "S:U (...) A:J; scope: world plus selected countries (U)" | domain `glob`; note "S:U (monthly estimates of marketing-year balances, calendar_basis MKTYR) A:J; scope global (WLD): world cereals only, per-country ratios not available (AMIS only)" | spec edit, status back to draft |
| F8 | `docs/specs/ddl-neon-schema.md:91` | "(global series: M24, G02, G03 world prices and similar)" | "(global series: M24, G02, G03 and similar)" | wording |
| F9 | `docs/specs/analytics-and-r-contract-spec.md:205` (P6) and `ddl-neon-schema.md:202` (as amended by G02 E4/E5) | "M24 and G02 ... global" | "M24, G02 and G03 ... global" | wording |
| F10 | `config/series_map/fao_csdb.yaml:3-4` and `fao_csdb_manual.yaml:4-5` comment | "G03 is a scope: country indicator, so the 42 country pairs stay unmapped" | "G03 is a scope: global indicator (WLD only)" | comment only |
| F11 | tests | none | (a) catalog test: `global` domain members are exactly {M24, G02, G03} (replaces the {M24, G02} assertion added by G02 E7 in `tests/unit/config/test_indicator_catalog.py`); (b) G03-specific config test; (c) export test AC-RW-1. | data-engineer |

### 3.3 Knock-on effects
- Rule 44 (`registry/indicators.py:291-306`) is satisfied after F1/F2 and would have rejected the mixed state; no new validation rule.
- Domain counts: `agri` loses G03; `global` becomes {M24, G02, G03}. Both unranked (`config/indicators.yaml:345,389`), so domain eligibility (ADR-019) is unchanged; the `agri` page does not become empty. Exact `agri` member count after both moves: [UNVERIFIED], derive from the file when implementing.
- Series mapping: 42 unmapped country pairs for G03 disappear as a known gap (`fao_csdb.yaml:3-4`); T63's "known-gap" note for G03 (plan `docs/plans/macro-monitor-v1-implementation-plan.md`, T63 area) is closed by this change. Planner to confirm.
- Existing analytics results: past `analytics.indicator_snapshot` rows for G03 per country are history and are not rewritten (CLAUDE.md: never UPDATE/DELETE history). New runs write WLD only (AC-AN-8).
- `ref.global_translation`: nothing to do (section 2).

### 3.4 Acceptance criteria (problem 1)
- AC-RW-1 (export): a fixture with a `G03` parquet containing `WLD` passes EXP-02; `scorecard/global.json` is the only scorecard file listing `WLD`; `meta/domains.json` lists G03 under `global` only; `meta/indicators.json` G03 has `scope = "global"` and `domain_ids = ["global"]`.
- AC-RW-2 (config): shipped `config/indicators.yaml` validates; the `global` members are exactly M24, G02, G03; negatives from the G02 amendment (AC-G02-2) still fail, plus G03 in `agri` and `global` fails rule 44.
- AC-RW-3 (site): the PG-INDICATOR page for a `scope: global` indicator builds and shows its single WLD row and its value history without an error or an empty table (smoke test with G02 or G03 fixture). [UNVERIFIED today.]
- AC-RW-4 (database): after `sync-config` and migration 0018 on a database that previously had (G03, agri) and scope `country`: no (G03, agri) row, `ref.indicator.scope = 'global'`, one `ref.config_history` delete entry, `config-report` shows no orphan.

### 3.5 What is not proposed
No second validation rule (rule 44 covers the domain side). A new rule that a `scope: country` indicator must not map to `WLD` is worth considering: the shipped state mapped G03 (country) to WLD without any config error (`sync.py:229-230` checks only the global side). That would have caught P1 at `validate-config`. Marked as optional question Q-4; not part of the minimal fix.

## 4. Problem 2: options and recommendation

### 4.1 Options
| Option | What | For | Against |
|---|---|---|---|
| P2-A (recommended) | Publication set rule: an indicator is exported to `meta/indicators.json`, `meta/series.json`, `series/*`, `revisions/*` only if `kind = 'indicator'` AND NOT `is_comparison` AND it has at least one domain membership. The 8 indicators stay in Postgres and in the public dump, and are simply not on the dashboard. | One rule; AC-RD-01 stays true with no exception list; no page without a scorecard; consistent with the existing principle that unscored indicators are not shown (A02b/A02c comparison and A03 projections are already declared "no dashboard output": `ddl-neon-schema.md:203`, `dashboard-export-spec.md:44,262`); removes dead files (A03 has nothing publishable); smaller export. Matches the config intent of "no scorecard domain in the selection" (`config/indicators.yaml:330`). | The 5 optional indicators with real value (M22, Q14, Q16, A08, A15) are not visible at all until given a domain. A02c data currently visible in `meta/series.json` (lines 6456 ff.) disappears from the dashboard. |
| P2-B | Build a minimal PG-INDICATOR for them: no scorecard, a time-series view from `series/<id>.parquet` only (latest value per country from the series file, link to PG-SERIES). | Data stays visible. | New page variant: a second source of truth for "latest value per entity" (the page must compute it from series, against the "export computes nothing / page does not compute" principle: `dashboard-redesign-spec.md:162`, `dashboard-export-spec.md` scorecard header), new ACs, new states; A03 would still be empty; A02b/A02c comparison series would be shown as ordinary indicators, contradicting `dashboard-export-spec.md:44`. Largest change for the least-used indicators. |
| P2-C | Assign domains (user decision per indicator): for example M22 to `fin`, Q16 to `labour`/`prices`, A08 to `fiscal`/`structural`, A15 to `structural`, Q14 to `prices`. | Gives them a scorecard and a page. | Overrides the approved selection ("no scorecard domain in the selection", `config/indicators.yaml:330`; research D12/B9 domain table); a catalog decision that belongs to the user, not to this amendment; A02b/A02c/A03 cannot be given a domain meaningfully (comparison, projection). The domain ids above are examples of the 11-domain model [UNVERIFIED against `config/` domain list]; no recommendation. |
| P2-D | Keep the current stopgap (build skips, warns). | Zero spec change. | Leaves AC-RD-01 false and files published for nothing; revision rows for such an indicator (if any) would link to a missing page. Rejected. |

### 4.2 Recommendation: P2-A, plus P2-C available per indicator later
P2-A is the rule; the user may still promote any of the five optional indicators by giving it a domain (a catalog change, not an export change). For the comparison pair, also set `is_comparison: true` on A02b and A02c so the config states what the spec already says (`dbnomics_ameco_gap.yaml:3-5` says the flag was left unset because role `comparison` would fail rule 12; with P2-A the flag is no longer needed to keep them out, so this part is optional, Q-3).

### 4.3 Exact edits (applied only after approval)
| # | File:line | Now | After |
|---|---|---|---|
| H1 | `src/macro_monitor/publish/meta.py:238-243` and the same filters in `publish/series.py:113`, `publish/scorecard.py:89,263`, and `ref.allowed` at `publish/checks.py:184` | `kind = 'indicator' AND NOT is_comparison` | add `AND EXISTS (SELECT 1 FROM ref.indicator_domain d WHERE d.indicator_id = ref.indicator.indicator_id)`; one shared definition (a view or one helper) so the five places cannot drift. `revisions.py` must use the same set [UNVERIFIED: its filter at line ~225 was not read in detail]. | data-engineer |
| H2 | `docs/specs/dashboard-export-spec.md:82` (end of the `meta/indicators.json` row, after "Only indicators with `kind = 'indicator'`: ...") | "Only indicators with `kind = 'indicator'`: no input and no support indicator (...)." | append: "Published indicators only: `kind = 'indicator'`, not a comparison series, and a member of at least one domain (`domain_ids[]` is never empty). An indicator with no domain membership (the catalog entries with `domains: []`) has no scorecard and is absent from `meta/indicators.json`, `meta/series.json`, `series/*`, `revisions/*` and every other export file; its data remain in the database and the public dump. (2026-11-09 amendment `export-real-data-amendment.md`.)" |
| H3 | `docs/specs/dashboard-export-spec.md:44` | "Support indicators ... and comparison-role series (A02b, A02c) have NO `publish_scope` value ..." | append: "The same holds for every indicator without a domain membership (A03, M22, Q14, Q16, A08, A15 at 2026-11-09)." |
| H4 | `docs/specs/dashboard-export-spec.md:130` (section 6 first paragraph) | "one row per ... Global indicators have entity `WLD`." | append: "Files exist only for published indicators (section 4, `meta/indicators.json`)." and the same sentence in section 7 for `revisions/<indicator_id>.parquet` |
| H5 | `docs/specs/dashboard-export-spec.md` section 10, EXP-02 | EXP-02 text (line 217-221 area) | add: "every `domain_ids[]` of `meta/indicators.json` is non-empty; the set of ids in `meta/indicators.json` equals the set of `series/*.parquet` file stems that exist (an indicator without observations has none)." The equality direction must allow an indicator with a domain but no values (no parquet), so state it as "no parquet stem outside the list". |
| H6 | `docs/specs/dashboard-export-spec.md` section 11 | AC-EXP list | add AC-EXP-15: "a fixture with an indicator that has `domains: []` and observations: absent from `meta/indicators.json`, `meta/series.json`, `series/`, `revisions/`, `meta/domains.json` `indicator_ids[]`; export passes EXP-02; the number of `series/*.parquet` files equals the number of `meta/indicators.json` entries that have observations." |
| H7 | `docs/specs/dashboard-redesign-spec.md:41` (PG-INDICATOR row, "Pages" cell) | "one per entry of `meta/indicators.json` (about 80)" | "one per entry of `meta/indicators.json` (about 72: every entry has at least one domain, export spec section 4)". The count is an estimate: 80 less the 8 indicators with `domains: []` at 2026-11-09 [UNVERIFIED, recount at export time]. |
| H8 | `docs/specs/dashboard-redesign-spec.md:224` (AC-RD-01) | "one PG-INDICATOR per indicator in `meta/indicators.json`" | unchanged wording, plus: "(every entry has a non-empty `domain_ids`; the build fails if one has none)". |
| H9 | `site/scripts/prepare-data.mjs:101-104` | skips and warns | replace the skip by a hard error (`prepare-data: indicator X has no domain_ids`); the warn-and-skip block is removed. Implementation scope, after approval. |
| H10 | `docs/specs/dashboard-redesign-spec.md` AC-RD-04 (line 227) | unchanged | no edit: revision rows exist only for published indicators, so every link resolves. Add a test: every `indicator_id` in `revisions_recent.json` is in `meta/indicators.json`. |
| H11 | tests | none | export fixture test AC-EXP-15; `site` build test: all indicators of the real-shaped fixture have pages and none is skipped; a fixture with a domainless entry fails the build. |

### 4.4 Knock-on effects
- `meta/series.json` loses the series of the 8 indicators (the A02c series at `site/src/data/meta/series.json:6456 ff.` among them); size budget (section 8) only improves.
- `meta/domains.json` `indicator_ids[]` is unaffected (domainless indicators were never in it: `publish/meta.py:247-253` builds it from `ref.indicator_domain`).
- Home list C-HOME-3 (`dashboard-redesign-spec.md:83`) is unchanged: it is grouped by domain; every remaining indicator is in a group.
- Analytics still runs on the 5 optional indicators and snapshots them (`analytics/snapshot.py:296`, `analytics/run.py:286` exclude only comparison and dropped); only the export drops them. Whether analytics should skip domainless indicators is out of scope.
- `config/indicators.yaml` stays as is (no edit needed for P2-A); the catalog notes already say "no scorecard domain".

### 4.5 Acceptance criteria (problem 2)
- AC-RW-5: in the real-shaped export, no entry of `meta/indicators.json` has an empty `domain_ids`; none of A02b, A02c, A03, A08, A15, M22, Q14, Q16 appears in any file under `data/` unless it has been given a domain.
- AC-RW-6: AC-RD-01 passes on the real export with no skipped indicator and no build warning about `domain_ids`.
- AC-RW-7: giving one of the optional indicators a domain in a test config makes it appear in `meta/indicators.json`, `series/`, and as a page, with no code change (the rule is data-driven).

## 5. Order of work (not a plan)
1. User approves this amendment and answers section 7.
2. Spec text edits (F7-F9, H2-H8) by the architect (status of each edited spec back to draft until re-approved).
3. data-engineer: F1-F6, F10, F11, H1, H9, H11; review on Opus per CLAUDE.md; re-run ruff, mypy, unit tests.
4. Migration 0018 on `neondb` only on the user's explicit request.

## 6. Verification limits
Not run: the export, the site build, any database. Unverified items are marked inline: the sync upsert behaviour for `scope` (F6), the PG-INDICATOR layout for a WLD-only scorecard (AC-RW-3), the exact `agri` member count, the `revisions.py` filter (H1), domain candidates in P2-C, the exact indicator count (about 72).

## 7. Open questions for the user
- Q-1 (P1, blocking): approve P1-A (G03 becomes a global indicator in domain `global`, as G02 did)? Or prefer P1-B (new world-only indicator, keep country G03)?
- Q-2 (P1, blocking for existing databases): approve a forward-only migration 0018 that deletes the stale (G03, agri) link (and, if F6 shows it is needed, updates `ref.indicator.scope`), same method as 0012? Applying it to `neondb` happens only when you ask for that step.
- Q-3 (P2, blocking): approve P2-A (indicators without a domain are not exported at all), or choose P2-B (minimal page) or P2-C (you assign domains)? If P2-C: which domain for each of M22, Q14, Q16, A08, A15?
- Q-4 (P2, minor): set `is_comparison: true` on A02b and A02c in `config/indicators.yaml` so the config states what the export spec says? (Check rule 12 effects first; `dbnomics_ameco_gap.yaml:3-5` records that role `comparison` was avoided.)
- Q-5 (P1, minor): add a validation rule that a `scope: country` indicator must not map to entity `WLD` (it would have caught P1 at `validate-config`)? Section 3.5.
- Q-6 (P1, minor): is losing the "selected countries" intent of G03 (`indicator-parameters-spec.md:108`) acceptable, to be reintroduced as a new indicator if an AMIS source is ever approved?
- Q-7 (P2, minor): should the dashboard show the five optional indicators in a later release via a lightweight page (P2-B), or is "no domain, no page" the standing rule?
