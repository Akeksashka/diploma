---
status: approved   # approved by the user on 2026-11-04 (stated in session: "approved"); Q-1 to Q-3 per the recommendations stated in session; merging the text edits into the approved specs is a separate Phase 2 step
amends:
  - config/indicators.yaml                        # G02 domain membership (implementation scope, after approval)
  - docs/specs/indicator-parameters-spec.md       # section 5 row G02
  - docs/specs/analytics-and-r-contract-spec.md   # section 9 P6 (wording only)
  - docs/specs/ddl-neon-schema.md                 # comment on ref.indicator_domain (wording only)
  - docs/specs/source-config-schema.md            # one new validation rule
  - docs/research/indicator-selection-g20-eu-cross-country.md   # erratum only, see section 3
inputs:
  - docs/ops/spike-results.md                     # finding, section "Real Eurostat slice", line 366
  - docs/design/adr/ADR-019-domain-eligibility-columns-min-ranked-and-core-pillars.md
  - docs/specs/dashboard-export-spec.md
  - docs/specs/domain-eligibility-amendment.md
---
# Amendment: indicator G02 moves from domain `agri` to domain `global`

Date: 2026-11-04. Repository facts were read on 2026-11-04 (file paths and line numbers are the citations; line numbers are as of this date). No ADR is proposed: this is a placement correction of one catalog row inside the existing 11-domain model, not an architecture decision (ADR-019 and the D12/B9 rules are untouched). If the user wants a decision record anyway, the text of section 1 is enough for one.

## 0. User decision recorded
UD-1 (session 2026-11-04): "Yes, move G02" (domain `agri` to `global`). The user also asked for the amendment to be drafted first and then applied. Questions Q-1 and Q-2 below are NOT answered yet.

## 1. Problem and rule
- `config/indicators.yaml:376-390`: G02 has `scope: global` (line 379) and `domains: [{id: agri, ranked: false}]` (line 389).
- Export rule: a `WLD` row may appear only in the `global` domain (`docs/specs/dashboard-export-spec.md:44`, `:110`, AC-EXP-7 at `:227`; implemented in `src/macro_monitor/publish/scorecard.py:157` and `publish/checks.py:241`). A real G02 WLD snapshot row therefore fails the export with `EXP-02: global entity ['WLD'] in domain agri`; observed on a real slice, `docs/ops/spike-results.md:366`.
- Approved research placed G02 in the Agriculture domain (D12), `docs/research/indicator-selection-g20-eu-cross-country.md:262`, while the same document calls G02 a "country-invariant or global-factor signal" (`:264`) and `docs/specs/ddl-neon-schema.md:90`, `:199` already name G02 as a WLD (global) series. The config followed the research table, not the scope.

Rule after this amendment: every indicator with `scope: global` belongs to the `global` domain only (new validation rule, section 2). The move changes G02's display location only: G02 stays `descriptive_only`, `ranked: false`, unchanged parameters.

## 2. Exact edits (all are applied only after approval; none are applied by this document)

| # | File:line (2026-11-04) | Now | After | Scope |
|---|---|---|---|---|
| E1 | `config/indicators.yaml:389` | `domains: [{id: agri, ranked: false}]` | `domains: [{id: global, ranked: false}]` | data-engineer |
| E2 | `tests/fixtures/golden/resolved_indicators.csv:26` | `...,descriptive_only,0,agri:U,0,proposed` | `...,descriptive_only,0,global:U,0,proposed` (same row, only the domain cell) | data-engineer |
| E3 | `docs/specs/indicator-parameters-spec.md:107` | domain column `agri`; note `S:R A:R K:A (D12 domain unranked); scope global (WLD)` | domain column `global`; note `S:R A:R K:A (B9 domain unranked); scope global (WLD)` | spec edit, status back to draft |
| E4 | `docs/specs/analytics-and-r-contract-spec.md:205` (P6) | "M24 (commodity prices; global by nature) belongs to a `global` (WLD) panel" | "M24 and G02 (commodity prices; global by nature) belong to the `global` (WLD) panel" | wording |
| E5 | `docs/specs/ddl-neon-schema.md:195` | "M24 is assigned to domain 'global' (unranked, explorer only in v1; B9)" | "M24 and G02 are assigned to domain 'global' ..." | wording |
| E6 | `docs/specs/source-config-schema.md`, after rule 13 (line 134); number = next free at merge (44 on 2026-11-04, after the 41-43 of `frequency-downgrade-amendment.md`) | none | "Every indicator with `scope: global` has exactly one domain membership, and it is `global`; every other indicator has no membership in `global`. Error names indicator and domain." | new rule |
| E7 | tests (new, implementation) | none | unit test of E6 on the shipped file plus negatives (G02 in `agri`; a country-scope indicator in `global`); `tests/unit/config/test_indicator_catalog.py` gets one assertion that the `global` domain members are exactly {M24, G02} | data-engineer |
| E8 | `docs/research/indicator-selection-g20-eu-cross-country.md:262` and `:264` | G02 listed in the Agriculture row; the note says G02 feeds the global view | NOT edited (approved research; erratum below) | see section 3 |

No change is needed (checked, 2026-11-04) in: `docs/specs/dashboard-export-spec.md` (`:42`, `:81`, `:110`, `:227` state the rule, not membership), `docs/specs/analytics-and-r-contract-spec.md:147` and `:149` (AC-AN-6, AC-AN-8 are domain-independent), `docs/specs/source-config-schema.md:235-237` (domain list), `docs/design/macro-monitor-platform-design.md:261`, `:533` (G02 named without a domain; `:247`, `:323`, `:338` say "Agri-food and Global are unranked", still true), `docs/plans/macro-monitor-v1-implementation-plan.md:615` (G02 only as a Pink Sheet/FAO target), `tests/unit/config/test_indicator_catalog.py:146` (staleness class), `tests/integration/test_sync_config_db.py:88` (checks unranked domains, not membership), `src/macro_monitor/registry/indicators.py:43-48` (domain ids; no per-indicator list). Research `docs/research/indicator-selection-g20-eu-forecasting-amendment.md:167` ("G02-G15 KEEP unchanged") does not mention a domain.

## 3. Research erratum (no in-place edit)
`indicator-selection-g20-eu-cross-country.md:262` is approved and not edited. This document is the erratum: "G02 is a global (WLD) indicator and is shown in the Global domain; the Agriculture row no longer lists it (user decision 2026-11-04)". Line 264 already describes G02 as a global-factor signal, so no contradiction remains in the prose. The table at `:258` still lists a dropped `Markets` domain; that older discrepancy is outside this amendment.

## 4. Knock-on effects
| Topic | Result |
|---|---|
| Domain membership counts (from `config/indicators.yaml`, 2026-11-04) | `agri`: 15 memberships (G01 through G12 less G13, Q17, G14, G15; G01 also in `prices`) becomes 14. `global`: 1 (M24) becomes 2 (M24, G02). The research table at `:262` lists the same 15 ids. The pending G11 merge into A26 (`release-lag-and-split-proposal.md`) is independent of this move. |
| Domain eligibility (ADR-019, `domain-eligibility-amendment.md` section 2) | None. Both domains are `ranked: false`; eligibility requires `is_ranked` AND `min_ranked_indicators` ranked members, so neither is eligible before or after (`agri`: 14 or 15 descriptive members; `global`: 0 ranked members). `core_pillars` are not declared at launch (UD-1 of that amendment) and are only allowed on ranked domains (rule 39). `agri` does not become empty. |
| Scorecard / domain coverage (n/N, `n_defined`) | None expected: AC-AN-8 (`analytics-and-r-contract-spec.md:149`) says global indicators write snapshot rows for `WLD` only and none to rank or scorecard tables, so G02 was never in a per-country `n_defined`. The dashboard's `global` domain file gains one `WLD` indicator row (G02) and `indicator_ids[]` of `meta/domains.json` changes for both domains. [UNVERIFIED in code: confirm in `analytics/scorecard.py` that scope-global indicators are excluded from `n_defined`; the grep of 2026-11-04 found no `scope` filter in that file, so the exclusion may be implemented upstream.] |
| Plan T63 (`docs/plans/macro-monitor-v1-implementation-plan.md:655-661`) | None. T63 gates core pairs only; G02 is `priority: ext` (`config/indicators.yaml:381`), so its pair (G02, WLD) is outside the "28 core" claim. Plan task for the move: none needed beyond E1, E2, E7 (a line in T33 or T32 if the planner wants a task id). |
| Existing databases (`neondb`, the throwaway slice DBs) | NOT handled by E1. `sync-config` never removes a domain link: `src/macro_monitor/registry/sync.py:578-583` reports `indicator_domain G02/agri is not in config (kept; no DELETE)`; the spike hit this (`spike-results.md:366`). In any database where G02/agri exists, the stale link remains and the export keeps failing EXP-02. See Q-1. |
| History | `ref.config_history` records config changes through its trigger (`ddl-neon-schema.md` table list at `:277` includes `indicator_domain`; trigger behaviour on DELETE is [UNVERIFIED], check migration 0002 before choosing the Q-1 route). Past analytics runs and exports are not rewritten. |
| Site / UX | The `global` domain page shows two indicators; the `agri` page one fewer. `site/` code takes both from `meta/domains.json`; [UNVERIFIED] that no hard-coded list exists (not searched beyond `tests/unit/test_site_spike.py` fixtures, which use synthetic data). |

## 5. Acceptance criteria
- AC-G02-1 (config): the shipped `config/indicators.yaml` validates; G02 has exactly the membership `global` (`ranked: false`); the `global` domain members are exactly M24 and G02; the golden `resolved_indicators.csv` row 26 shows `global:U`.
- AC-G02-2 (rule E6): negatives fail with indicator and domain named: G02 in `agri`; G02 in `agri` and `global`; a `scope: country` indicator in `global`; a `scope: global` indicator with no `global` membership.
- AC-G02-3 (sync, per Q-1): after `sync-config` on a database that previously held G02/agri, `ref.indicator_domain` has no (G02, agri) row [route-specific: migration or sync change], a `ref.config_history` entry exists if the chosen route is a delete, and `config-report` shows no orphan for it.
- AC-G02-4 (export): a fixture with a G02 `WLD` snapshot row exports without EXP-02 failure; `WLD` appears in `scorecard/global.json` and in no other scorecard file; `meta/domains.json` lists G02 under `global` only.
- AC-G02-5: the full test suite passes with the golden file regenerated only in the one cell.

## 6. Decisions the user must make beyond the move
- Q-1 (blocking for any existing database, including production `neondb` if G02/agri exists there): how the stale (G02, agri) link is removed. Options: (a) a forward-only data migration `DELETE FROM ref.indicator_domain WHERE indicator_id = 'G02' AND domain_id = 'agri'` (smallest; `indicator_domain` is a config table, not a curated, raw-manifest or history table, but the rule "never UPDATE or DELETE ... history" must be checked against the `config_history` trigger first; applying to `neondb` only when you ask for that step); (b) change `sync-config` to delete links absent from config, recording each in `ref.config_history` (general fix, larger change, needs a DDL/source-config spec edit and its own review; recommended if more catalog moves are expected); (c) leave existing databases as they are and rebuild throwaway databases only (works only if `neondb` has no G02 data yet; not verified here). Recommendation: (a) now, (b) later if wanted.
- Q-2: approve the new validation rule E6 (every `scope: global` indicator lives in `global` only). Without it the same defect can recur on the next global indicator (for example G03 world rows, `ddl-neon-schema.md:90`, though G03 is `scope: country` in config).
- Q-3 (minor): whether the research erratum of section 3 is enough or you want the approved research file revised (resets its status to draft).

## 7. User decisions recorded 2026-11-04 (stated in session: "approved")
- Q-1: remove the stale (G02, agri) link by a forward-only data migration (CLAUDE.md: forward-only; never edit an applied migration). Applying it to `neondb` still requires the user's explicit request for that step.
- Q-2: rule E6 (every `scope: global` indicator lives in `global` only) is approved.
- Q-3: the section 3 research erratum is enough; the approved research file is not revised.
