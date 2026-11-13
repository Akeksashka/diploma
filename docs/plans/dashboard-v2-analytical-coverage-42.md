---
status: proposed   # Written 2026-11-13 (analysis note for the dashboard v2 plan). Not approved; only the user approves.
topic: dashboard-v2-analytical coverage of all 42 panel countries
reads:
  - config/entities.yaml
  - config/sources.yaml
  - config/indicators.yaml
  - config/series_map/*.yaml
  - docs/ops/dashboard-ux-baseline.md (section e)
  - docs/plans/dashboard-v2-analytical-implementation-plan.md (G-REAL, G-WEO, V30)
  - docs/plans/macro-monitor-v1-implementation-plan.md (T52-T63)
  - docs/specs/dashboard-v2-analytical-spec.md (A2.3 Home)
---

# Dashboard v2: coverage of all 42 panel countries

All counts below come from the config files only (counted on 2026-11-13 with a read-only script over `config/series_map/*.yaml`, headline rows, `kind: country` entities). A mapped pair is not a loaded pair: everything here is "configured", and whether data exists is [UNVERIFIED] until a real load and export are measured (V30). Key format and codes of most maps are themselves marked [UNVERIFIED] in their headers.

## 0. Why the current export is thin

- The measured real export (baseline (e)) was a Eurostat-only run. Only M09 had any percentile, for 3 entities, even though `eurostat_labour` maps 28 countries. So the run loaded a small slice, not the full configured map [inference from baseline (e) plus the map; confirm with the run's manifest].
- The 42-country structure (45 entities, 80 indicators, 11 domains) is already in `meta/*`. What is missing is data, not structure.
- Panel split (entities.yaml): EU27 = 27 countries; non-EU = 15: ARG, AUS, BRA, CAN, CHN, GBR, IDN, IND, JPN, KOR, MEX, SAU, TUR, USA, ZAF.

## 1. Coverage matrix (configured, headline pairs, countries of 42)

| Source / group | Source enabled | Freq | Indicators (domain): countries mapped | Country scope of the map | Structural limit |
|---|---|---|---|---|---|
| eurostat_labour | yes | M | M09 (labour): 28 | EU27 + TUR | Eurostat scope: EU/EEA/candidates |
| eurostat_sts | yes | M | M01, M02 (growth): 28 each | EU27 + TUR | same |
| eurostat_hicp | yes | M | M06, M07 (prices), G01 (prices, agri): 28 each | EU27 + TUR | same |
| eurostat_gov_debt | yes | Q | Q08 (fiscal): 27 | EU27 | same |
| eurostat_gdp_q | yes | Q | X01 (input, no domain): 27 | EU27 | same |
| ecb_yields | yes | M | M18 (fin): 1 (DEU) + EA | seed | ECB IRS: EU members only |
| worldbank_annual | yes | A | A01 (structural), A11, A14, A22 (social), M14 (external): 42 each | all 42 | none for the map; values per country [UNVERIFIED] (A14 Gini is sparse by year) |
| worldbank_support | yes | A | X01, X02 (inputs, no domain): 42 | all 42 | none |
| imf_weo_files (manual) | yes | A | A03 (no domain): 42; A04, A05 (fiscal): 42; A02 (growth): 25 | all 42; A02 only 25 (17 known gaps) | WEO publishes no gap for 17 |
| bis_cbpol | yes | M | M17 (fin): 2 (JPN, USA) | seed | BIS has no BGR series (known gap) |
| bis_credit_gap | yes | Q | Q06 (fin): 2 (DEU, USA) | seed | map header: 32 of 42 exist; 10 EU members gap |
| oecd_kei | yes (source) | M | M04 (growth), M18 (fin): 2 (JPN, USA) | seed | OECD members + some partners [UNVERIFIED] |
| oecd_prices | yes (source) | M | M06 (prices): 1 (BRA) | seed | same |
| oecd_cli | yes (source) | M | M05 (growth): 2 (JPN, USA) | seed | same |
| ec_bcs_monthly | yes | M | M03, M04 (growth): 2 (DEU, FRA) + EU27, EA | seed | EC survey scope: EU (+ candidates) |
| dbnomics_ameco_gap | no | A | A02c (comparison, not exported): 3 | seed | not exported (AC-SYS-6) |
| faostat_sofi | no | A | G12 (agri, unranked): 3 | seed | |
| fao_ffpi, fao_csdb(_manual), pinksheet_* | mixed | M/A | G02, G03, M24 (global): WLD only | world | global scope by design |

Notes: "Source enabled" is `sources[].enabled`; the T57 note says the OECD source was parked as disabled in the plan, while `sources.yaml` line 353 now reads `enabled: true` [check before running]. Indicators with no domain (A03, X01, X02, A02b/c) do not reach a domain scorecard, so they never feed C2/C4/C6 or a percentile.

Configured countries per exported (domain) indicator: 42 for A01, A04, A05, A11, A14, A22, M14; 28 for M01, M02, M06 (29 incl. BRA via OECD), M07, M09, G01; 27 for Q08; 25 for A02; 4 or fewer for M03, M04, M05, M17, M18, Q06, G12. Every other catalog indicator has 0 mapped countries.

## 2. Structural gaps and fillers

| Countries | Missing from | Filler that exists in config | Filler not yet configured |
|---|---|---|---|
| 14 non-EU excl. TUR (ARG AUS BRA CAN CHN GBR IDN IND JPN KOR MEX SAU USA ZAF) | all Eurostat groups (M01 M02 M06 M07 M09 G01) | none for M09/M01/M02/M07; OECD seed only (M06 BRA) | OECD KEI/prices/labour for the OECD members AUS CAN GBR JPN KOR MEX USA, partner coverage for BRA CHN IDN IND ZAF ARG SAU [UNVERIFIED]; WEO LUR / PCPIPCH (annual, unmapped) |
| TUR | Q08, X01 (Eurostat quarterly) | WEO A05, WB X01 | |
| 15 non-EU | ECB M18, EC surveys M03/M04 | OECD KEI M18/M04 (seed) | OECD widening |
| 17 WEO-gap countries | A02 | none (AMECO gap is comparison only) | none: known gap by design |
| 10 EU members | BIS Q06 | none | known gap (map header) |

Consequence: for the Home default indicator M09, at most 28 countries are reachable from the configured sources. A monthly M09 for the other 14 needs OECD widening (realistic for 7 OECD members; partners [UNVERIFIED]). An annual LUR from WEO would be a frequency change to M09 or a new indicator: a design decision (ADR, user approval), not a mapping fix.

## 3. Pipeline steps to load and export each source for all 42

Gating per CLAUDE.md: loading to `neondb` (production, ADR-008), running the pipeline, dispatching a workflow, pushing, or running network probes each need the user's explicit request in that session. Series-map widening is a config change under an approved plan (phase 4) and needs the reviewed seeding CSV the plan says only the user supplies (T52). Mapping choices that change one-headline-per-pair or frequency need an ADR (phase 2) first.

| # | Step | Exists in plans | Gap | Who requests |
|---|---|---|---|---|
| S1 | World Bank (worldbank_annual, worldbank_support): fetch + load + export for 42 | T55 done; map already 42 | only a real run is missing; local raw exists in `data/raw/worldbank` | user: pipeline run on neondb (or a dev branch) and an export (R24 route a/b) |
| S2 | WEO: `ingest-manual --group imf_weo_files` on the file in `manual_inbox/imf_weo_manual/2026-10/` | T59 done (CLI); `weo_v1.py` exists but T60 is `[ ] todo` (BB7/BB23 record, fixture, WEO-01 fail-closed); T61 (A02 boundary, PROJ handling) todo | T60/T61 must close first | user: implement T60/T61 (plan approved), then ingestion (G-WEO) |
| S3 | WEO six unmapped variables (LUR, PCPIPCH, BCA_NGDPD, GGXONLB_NGDP, PPPPC, NGDP_D) | listed in the map header and V30 as "decision needed" | no ADR or plan task decides it; A03 has no domain, so even mapped A03 rows never rank | user decision; if a mapping changes ADR-009 roles or adds indicators, architect ADR first |
| S4 | Eurostat full map load (28 countries, M01 M02 M06 M07 M09 G01 Q08 X01) | T53 partial; keys [UNVERIFIED] except M09 | M12, Q01, Q05, M18 unmapped; M01 code `PROD` returned an empty cube (map note) | user: run; T53 completion |
| S5 | OECD widening (KEI, prices, CLI, plus a labour dataflow for M09) to the OECD members and partners | T57 partial, seed only | no task maps M09 from OECD; layouts [UNVERIFIED] | user: T52 CSV; plan task; network probe on request |
| S6 | BIS widening (M17 to ~41, Q06 to 32) | T54 partial, seed only; DG-01 open | full country sets not configured | as S5 |
| S7 | Coverage reconciliation: every core pair mapped or `known_gap` | T63 todo | depends on T53-T60, T62 | phase 4 task |
| S8 | Real export + measurement | V30 GATED (G-REAL, G-WEO); redesign R24 not done | none beyond gating | user |

## 4. Minimal source sets

Target: every one of the 42 countries has at least N exported (domain) indicators.

| Set | Countries with >= N | N reached for all 42 | Realism |
|---|---|---|---|
| {Eurostat} (today) | 28 | 0 for 14 countries | today's state; 14 countries empty |
| {World Bank} | 42 | N = 5 (A01, A11, A14, A22, M14), annual | most realistic: connector done, map at 42, enabled; needs only a run |
| {World Bank, WEO} | 42 | N = 7 (+ A04, A05), plus A02 for 25, A03 for C3 only | realistic after T60/T61 and a user-requested ingest |
| {World Bank, WEO, Eurostat} | 42 | N = 7 for all; 28 countries also get monthly M01 M02 M06 M07 M09 G01 | realistic; recommended phase-2 target |
| + OECD widened | 35 for monthly M09/M06 [UNVERIFIED for partners] | still not 42 for monthly | months of mapping work; partners uncertain |

M09 on Home cannot reach 42 with any configured or near-term source. Two options, both the user's (G-HOME-CONST): (a) keep `HOME_DEFAULT_INDICATOR = M09` and accept 28 (or ~35) countries with the hidden-rows disclosure naming the 14; (b) default to an indicator configured for 42 (A05 or A01; annual, so C1 is a yearly line). Recommendation: (b) for the C6 map and C2 panel if the user wants a full map on landing; (a) otherwise. KPI strip DRAFT ids (M09, M10, M11, P01, A01, M18): only A01 is configured for 42; M10 and M11 have no map, and P01 is not in `config/indicators.yaml` (fixture-only id).

## 5. Recommended ACs and tasks for the dashboard plan (proposed, IDs from V66)

ACs (proposed, prefix AC-V2-COV-):
- AC-V2-COV-1: a synthetic fixture holds 45 entities (42 countries + EU27, EA, WLD) with the configured coverage pattern of section 1 (42/28/27/25 countries per indicator), labelled synthetic.
- AC-V2-COV-2: each Home panel (P-A C2, P-B C1, P-C C6, P-D C4) and the KPI strip renders on that fixture; countries without a value appear only in the hidden-rows disclosure with reason `no_data`, and the count drawn + hidden = 42.
- AC-V2-COV-3: a coverage report (script output under `docs/ops/`) lists per exported indicator the countries with a value, per Home panel the drawn count, and the countries with fewer than N indicators; it is run on the fixture and, once G-REAL clears, on the real export.
- AC-V2-COV-4: no chart shows PROJ rows (re-asserts AC-V2-50/78) on a fixture that includes WEO-like PROJ years.

Tasks:
- V66 Fixture extended to 42 countries (S, phase 1, todo): extend the V7 fixture; depends on V7. No gate.
- V67 Per-panel Home smoke on the 42-entity fixture (S, phase 1, todo): AC-V2-COV-2; depends on V58, V66.
- V68 Coverage report script and record (S, phase 1 on fixture; real part GATED G-REAL): AC-V2-COV-3; writes `site/scripts/` and `docs/ops/dashboard-v2-coverage.md`.
- V69 Home default decision record (S, GATED G-HOME-CONST): the user picks option (a) or (b) of section 4; the constant changes in V56 only.
- V70 Real 42-country coverage check (S, GATED G-REAL, G-WEO): folds into V30; requires S1, S2 and S8 run on the user's request; S3, S5, S6 are pipeline-plan work outside this plan (EXPORT-SIDE).

Pipeline-side items that this plan does not own (route to the v1 plan or a new plan, phase 3): T60, T61, S3 decision, T53 completion, OECD M09 mapping, T63.
