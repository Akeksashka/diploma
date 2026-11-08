---
status: approved   # approved by the user on 2026-10-24 (stated in session)
---
# ADR-014: Indicator parameters by layered defaults and explicit overrides, with no default for rank mode, directions and domains

Date: 2026-10-24 (Phase 2 rework after the planning pass). Facts about the research come from `docs/research/indicator-selection-g20-eu-cross-country.md` (approved; read 2026-10-24; decisions D6, D9, D12, D14, D19 and the catalog) and from the specs named below; nothing external was used.

## Context
- The planning pass found that per-indicator parameters are missing for most of the 80 active indicators: staleness class, alert method, adverse direction, rank mode and direction, stationarity class. The DDL requires them (`ref.indicator` NOT NULL columns), the source-config schema shows two worked examples (M06, A05) and one input (X01), and the analytics spec classifies only some indicators (section 4.1) and states in P14 that there is no default rank mode.
- What the approved research settles: the staleness limit by data type (D14: market data 45 days, surveys 75, monthly activity/prices/labour 120, quarterly 270, annual 730, triennial or irregular 4 years); the alert level and window (D19: |z| >= 2.0, 240 monthly / 80 quarterly / 20 annual observations), the use of robust z for inflation, spreads, FX, credit growth and food/fertilizer prices, and the existence of fixed overrides; D12 (agri-food unranked). What it does not settle: the adverse direction of each indicator ("defined per indicator" in D9/D19 but never listed), the rank mode and orientation of each indicator, the stationarity class, and the data type of borderline indicators (for example M15 REER, M14 reserves, G03-G06).
- Writing about 80 x 12 values by hand invites copy errors, and values that are the same by data type should be written once. At the same time, some values must never be inherited silently: a wrong default rank mode changes published ranks (P14).

## Options considered
1. Fully explicit: every field written in every `indicators.yaml` entry. No hidden behaviour, but long, repetitive, and a reviewer cannot tell a considered value from a copy.
2. A single set of global defaults. Cannot express that a survey balance and a policy rate have different staleness classes and alert methods; the exceptions would dominate.
3. Layered defaults: global defaults, then a small number of named families (data-type archetypes) that carry the D14/D19 defaults, then per-indicator overrides, with an explicit list of fields that have no default at any layer; every resolved value records where it came from, and each indicator carries a review status.

## Decision
Option 3.
1. Layers and precedence, lowest to highest: global defaults (`config/indicator_defaults.yaml`, section `global`), family defaults (same file, section `families`), indicator entry (`config/indicators.yaml`, optional `family:` key and any field written explicitly), per-entity-group alert overrides (`alert.override`, existing key, P19) and entity attributes (`ref.entity`: `regime_start`, `fx_regime_flag`). A value written in a higher layer replaces the lower one; lists and objects are replaced, not merged, except `alert.override` which is a list and is never inherited.
2. Fields that HAVE defaults (through the family): `staleness_class`, `alert.method`, `stationarity_class`, `max_ref_spread_days` (by tier), `release_lag_aware` (false), alert window and minimum observations (by tier), `watch_z`/`alert_z`.
3. Fields with NO default at any layer (a missing value is a `sync-config` error): `kind`, `scope`, `tier`, `priority`, `currency_basis`, `transform`, `rank.mode` (P14), `rank.good_dir`, `alert.adverse`, `domains`, and for `target_distance` the target source. Reason: they are either transcribed from the approved selection or are methodology choices that change published results (ranks, alert direction).
4. Provenance: `sync-config` writes the resolved values into `ref.indicator` (so the database never holds an unresolved indicator) and records, in `ref.indicator.params`, the key `provenance` (field name to `global | family:<id> | indicator`) and the key `review` (`{status: proposed | confirmed, by, on}`). Changes are mirrored into `ref.config_history` as for any indicator column (DDL spec).
5. Review status: every parameter set that I draft is `proposed`. `config-report` prints the resolved table with the provenance and counts of `proposed` and `confirmed` entries. Whether the first production run may start while some are `proposed` is a user decision (decision list). The user can confirm by family, by domain or in bulk; no agent sets `confirmed`.
6. The draft families, defaults and the per-indicator table are in `docs/specs/indicator-parameters-spec.md`. Values marked as research-supported cite the selection document; values marked as proposals or as needing a user decision are not facts and are not authoritative until confirmed.

## Consequences
- Pro: the D14/D19 defaults are written once and cannot drift per indicator; a reviewer reads only overrides and the no-default fields; the "no default rank mode" principle of P14 is structural; the structure leaves the DDL columns unchanged (no new column except those listed in the DDL change log).
- Con: one more config file and a resolution step to test; sync-config must reject unknown families and unknown override fields; the provenance JSON adds a few hundred bytes per indicator.
- Risk: a family default can be wrong for one member and go unnoticed. Mitigation: the golden table (AC-PAR-1) lists all 80 resolved rows, and the `proposed` count is visible.
- The reading of the source-config rule on `stationarity_class: trending_level` is decided after this ADR was approved (user decision of the 2026-10-25 fix pass): for `trending_level` indicators the alert z-score is computed on DIFF12 of the indicator's transformed series for the alert window only, the indicator's `transform` is unchanged, and no config rule ties the class to `transform` (analytics spec section 5; indicator-parameters spec section 9; source-config rule 29). See the bookkeeping note below.
- Reversal: families can be flattened into explicit entries mechanically (the resolved table is the flat form).

## Bookkeeping note, 2026-10-25 (second fix pass; no decision text changed)
The Consequences bullet on `trending_level` previously read: "The reading of the source-config rule on `stationarity_class: trending_level` (requires transform DIFF12 or an override) versus the analytics spec (z computed on DIFF12 for `trending_level`) is not decided here; see the parameters spec section 9." It became stale when the user decided the reading on 2026-10-25 (design section 14c, item 8). Only that bullet was corrected; the Context, Options and Decision are unchanged and the status stays `approved`. The first fix-pass note in the design (14c item 2) had said that ADR-014 had no such mismatch; that statement was wrong and is corrected there.
