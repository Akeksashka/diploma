---
status: approved   # approved by the user on 2026-11-04 (stated in session: "approve all"); amendments are merged into the base specs by a later Phase 2 step
---
# ADR-021: A fallback mapping to a coarser frequency carries an explicit, mandatory `frequency_downgrade` field and is labelled on the dashboard (amends the fallback clause of ADR-009)

Date: 2026-11-04 (Phase 2 amendment batch; revised the same day with the user's answers). Facts are about this repository, read on 2026-11-04: `docs/plans/macro-monitor-v1-implementation-plan.md` (T55, lines 586-592, and T62), `docs/design/adr/ADR-009-series-mapping-and-authoritative-source.md`, `docs/specs/analytics-and-r-contract-spec.md` (P17), `docs/specs/source-config-schema.md` (section 4), `docs/specs/dashboard-export-spec.md` (sections 4 and 6), `config/series_map/worldbank_annual.yaml`, `config/indicators.yaml` (M14), `src/macro_monitor/storage/migrations/0001_ref.sql`, `0005_curated.sql`, `0007_ref_export_views.sql`. No external source is used.

Note on the task reference: the plan note about the `frequency_downgrade` label is in T55 (World Bank REST connector), not in T58 (bulk-file connectors), which does not mention it.

## Context
- M14 (official FX reserves, tier M, `RESERVE_COVER`) has no resolved monthly source (analytics spec P17, plan T62). The World Bank annual series (`FI.RES.TOTL.CD`) is mapped as `role: fallback` for DEU and FRA. P17 says such annual reserves are "shown labelled `frequency_downgrade`"; T55 says the same and adds "M14 annual never feeds cover or alerts".
- The label exists only as words in the `rationale` text of the series map. T55's note states it: "The `frequency_downgrade` label has no config key yet". Nothing validates the prose, nothing stores it, and nothing exports it. `ref.series_map` has `role in (headline, fallback, comparison)` and no frequency information; `ref.v_series_export` and `curated.v_headline_obs_published` select `role = 'headline'` only, so a fallback series appears in no exported file today.
- A silent downgrade is a data-quality hazard: an annual level next to monthly peers invites a comparison the data do not support. The risk is not specific to M14 (plan T55 also lists an A01 fallback); the same situation will arise whenever a tier-M or tier-Q indicator is fed from an annual source.
- Constraints: ADR-009 (analytics read `headline` only; a fallback is used only where no headline exists and never fills a gap inside a headline period); schema changes by forward-only migration; unknown config keys are errors; the export contract is the only interface to the dashboard and carries meaning rather than recomputing it.

## Options considered
1. Leave it in `rationale`. No work; the label cannot be tested or shown.
2. A convention (rationale must contain the words "frequency downgrade") checked by regular expression. Fragile, and prose is not data.
3. An explicit key `frequency_downgrade` on fallback series-map entries, mandatory, validated for consistency against the indicator tier and the declared source frequency, stored in a column, exported, and rendered as a label. Chosen.
4. Derive the flag everywhere from `ref.series.frequency` versus `ref.indicator.tier`, with no stored field. No config noise, but the intent is implicit, a reviewer cannot see a deliberate downgrade, and there is no place to attach the exported label. The derivation is used instead as the CONSISTENCY check of option 3.

## Decision
Option 3.
1. Series-map key `frequency_downgrade` (YAML boolean, no default) is REQUIRED on every entry with `role: fallback` and is an error on `headline` and `comparison` entries. Its value must equal the derived truth: `true` if and only if the entry's `expect.frequency` is coarser than the indicator's `tier` (order D < M < Q < A). Therefore any M14 annual fallback must carry `frequency_downgrade: true`; an annual fallback for a monthly indicator that says `false`, or omits the key, fails validation.
2. Stored in `ref.series_map.frequency_downgrade boolean NOT NULL DEFAULT false` with `CHECK (NOT frequency_downgrade OR role = 'fallback')` (migration 0014 of the amendment spec). The loader writes it with the other series-map columns at first sight; `sync-config` writes it for existing series.
3. A frequency-downgrade fallback never feeds a transform, a rank, an alert or a scorecard cell. This restates ADR-009 (analytics read `headline` only) and makes it testable. A pair covered only by such a fallback is NOT counted as mapped for AC-CFG-5 and needs a `known_gap` entry (plan T62, T63).
4. USER DECISION (2026-11-04): the surface is the explorer only. The series file and `meta/series.json` expose fallback series for pairs that have no current headline, with `series_role`, `frequency_downgrade` and fixed texts (a short badge and a longer label) produced by the export from a constant (never by the database). The user-visible meaning is "annual, not monthly". The scorecard cell of M14 stays `n/a`; alerts and revision files do not change. `value_default_tf` and `value_yoy` are null on fallback rows. The metadata-only variant and the scorecard-cell variant are rejected.
5. DRAFT wording, for the user's confirmation (not approved text): badge "Annual, not monthly"; label "Annual data, shown because no monthly series is available for this indicator. Not comparable with monthly series; not used for ranks, alerts or ratios." Templates and golden-test rule: amendment spec section 5.1.
6. USER DECISION (2026-11-04): the two M14 pairs (DEU, FRA) are listed in `config/known_gaps.yaml`. This is an implementation-phase item (the data-engineer, after approval); the design phase does not edit `config/`.
7. Specified in `docs/specs/frequency-downgrade-amendment.md`: config rules 41-43, migration 0014, the two view changes, the export fields and the acceptance criteria.

## Consequences
- Pro: the downgrade is data, validated against two other facts (tier, expected frequency), visible in review and in the export; the prose in `rationale` can no longer be the only record.
- Pro: closes the T55 note and the P17 statement "shown labelled" with a concrete surface. The mixed-frequency comparison risk is bounded: the annual value never enters a cell, rank, alert or ratio.
- Con: one column on `ref.series_map`, one new published view (`curated.v_fallback_obs_published`), one replaced view (`ref.v_series_export` gets two appended columns and fallback rows for uncovered pairs), and an export change; the existing two M14 entries in `config/series_map/worldbank_annual.yaml` must be edited to add `frequency_downgrade: true` (they fail the new rule until then; that file is implementation scope).
- Con: exporting fallback values is new surface for the withheld/public rules. The new view applies the same `publish_site = 'public'` and `kind = 'indicator'` restrictions as the headline view, and EXP-09 is extended.
- A user looking at the M14 scorecard sees `n/a` and must open the explorer to see the annual value; accepted by the user's decision.
- ADR-009 stays `approved` and unchanged; this ADR amends only its fallback clause (the analytics and display consequences).

## Open questions for the user
1. Confirm or replace the draft wording of decision 5.
2. Rule 42 derives the truth from the indicator's `tier`. For a tier-A indicator with a monthly source the rule would call a monthly fallback a non-downgrade: accept? (amendment spec question 3)

Closed on 2026-11-04: surface (explorer only), M14 pairs as known gaps.
