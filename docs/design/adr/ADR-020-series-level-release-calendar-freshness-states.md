---
status: approved   # approved by the user on 2026-11-04 (stated in session: "approve all"); amendments are merged into the base specs by a later Phase 2 step
---
# ADR-020: Feed freshness is evaluated per series from the release calendar, with states current / awaiting_release / late / stale and a frequency-based grace period (amends the Freshness bullet of ADR-007)

Date: 2026-11-04 (Phase 2 amendment batch; revised the same day with the user's answers). Facts are about this repository, read on 2026-11-04: `docs/design/adr/ADR-007-validation-monitoring-and-alerting.md`, `docs/specs/validation-monitoring-spec.md` (FRESH-01, section 2, AC-VAL-4), `docs/specs/ddl-neon-schema.md` (section 7), `src/macro_monitor/monitoring/freshness.py`, `src/macro_monitor/storage/migrations/0004_ops.sql` and `0009_ops_views.sql`, `config/release_calendar.yaml`, `tests/unit/test_monitoring_freshness.py`. No external source is used. The code was read, not executed; statements about its behaviour are inferences from reading and are marked.

## Context
- ADR-007 and the validation spec define feed health as per series group with states `fresh | late | stale | broken`, evaluated against an expected latest period from frequency, typical lag and tolerance. Ranking staleness (D14) is a separate notion and stays separate.
- Implemented today (T64): `ops.freshness_state` stores one row per source group and evaluation (primary key `source_group, series_group, evaluated_at`), no `run_id`, no `series_id`, no append-only trigger (insert-only only by privilege: `mm_ingest` has SELECT and INSERT). `monitoring/freshness.py` computes a state per series internally, then keeps only the group verdict. View `ops.v_freshness_latest` takes the newest row per group.
- The existing stale rule is "two or more periods behind, or no new period for more than twice the typical lag beyond tolerance" (spec section 2). It has no grace period tied to the expected release date, and its second clause grows with the lag (a series with a 300-day lag may be a year overdue before it is `stale`). The state name `fresh` is also used for "the source is simply not due yet", which hides the useful fact that a release is expected and pending.
- Inference from reading `freshness.py` and `read_series_inputs`: for a group with `release_months` (IMF WEO) the code compares `latest_period_end`, the maximum `ref_period_end` of non-projection observations (a reference year end such as 2025-12-31), with the end of an EDITION MONTH (such as the previous edition's 2026-04-30). The unit tests pass because they feed edition-month dates as `latest_period_end`. With real data, once the 45-day tolerance after a release has passed, a group whose latest edition IS loaded is reported `late` (April edition) or `stale` (October edition: 2025-12-31 is before 2026-04-30). A second inference: the latest period is read from all versions in `curated.observation`, so a key later tombstoned (`DEL`) still counts as the latest period.
- The user asked for per-series, release-calendar-driven states `current / awaiting_release / late / stale`, `stale` only after the expected release date plus a frequency-based grace period, append-only, one row per run and series, and a view for the current state.

## Options considered
1. Keep group-level rows and only rename states. Cheap, but the monitor cannot say which series is overdue, and the per-series information computed today is thrown away.
2. New table `ops.series_freshness` and leave `ops.freshness_state` as the group roll-up. Two tables with overlapping meaning; the user asked for `ops.freshness_state` itself to be per series.
3. Evolve `ops.freshness_state` in place by a forward-only migration: new columns, a new primary key, new state values for series rows, legacy group rows kept untouched, append-only triggers, group roll-up moved into the view. Chosen.
4. Event table of state transitions only. Smaller, but "one row per run and series" is what lets a reader see a series that has been `late` for three runs, and transitions are derivable from it.

## Decision
Option 3.
1. States (per series, per run): `current` (the next expected period is not due yet), `awaiting_release` (due, within the group's `tolerance_days` of the expected release date), `late` (beyond tolerance, within the grace period), `stale` (beyond the grace period). The expected release date is the release date of the FIRST period the store does not have; overdue days are counted from it. `stale` therefore needs "expected release date plus grace", as the user specified.
2. USER DECISION (2026-11-04): the grace period is a global table by frequency in `config/release_calendar.yaml` (key `grace_defaults`): M 45, Q 60, A 180, named editions (WEO) 90 days, counted from the expected release date. Per-source slowness is handled by `typical_lag_days` (and `tolerance_days`), not by a wider grace; v1 therefore has no per-group `grace_days` override. A validation rule requires `tolerance_days <= grace_days`.
3. Named-edition groups (`release_months`, IMF WEO) are evaluated on the EDITION: the comparison key is the `edition_date` of the latest loaded object of the group against the first release month after it, never a reference period.
4. USER DECISION (2026-11-04): `fetch_broken` (two consecutive error or blocked fetch outcomes, as today) is a separate boolean column, not a fifth series state; the group roll-up in the view keeps the state `broken` for a core series with a broken fetch, so ADR-007 behaviour for `broken` is preserved.
5. `ops.freshness_state` is append-only with one row per `(run_id, series_id)`; legacy group rows are kept untouched (`series_id` NULL). `ops.v_freshness_latest` becomes the group roll-up of the newest run (same first six columns, so the export contract keeps its columns); a new view `ops.v_freshness_series_latest` (not granted to `mm_reader`) gives the per-series rows.
6. USER DECISION (2026-11-04): severity. A `stale` core series is an `error`; a `stale` non-core series is a `warn`; `late` is `warn`; `fetch_broken` on a core series stays `error`; `awaiting_release` and `current` raise nothing; `known_stale` series are `info`. An `error` blocks no pipeline step.
7. `release_lag_aware` is not an input of freshness and freshness is not an input of ranking staleness. Both read the same `typical_lag_days` and `tolerance_days` of the calendar entry, so one calendar is the single source of lag facts.
8. USER DECISION (2026-11-04): the calendar numbers stay duplicated in `sources.yaml` (`freshness:`) and `release_calendar.yaml` for v1, guarded by an equality test (source-config rule 34). Making `release_calendar.yaml` the single source is a recorded follow-up (FU-1 of the amendment spec), not part of v1.
9. USER DECISION (2026-11-04): daily and weekly series are out of scope for v1; the calendar loader rejects frequency `D` and `W` (FU-2).
10. USER DECISION (2026-11-04): the corrective migration of `ingest.v_series_deferred` is accepted: `skipped_out_of_order` becomes a terminal status, so a deferral that ended with it leaves the release queue (amendment spec section 8, forward-only migration 0011).
11. Details, SQL, acceptance criteria and the deltas to the implemented module are in `docs/specs/freshness-state-amendment.md`. Migration numbers there (0011, 0012) are the next free at the time of writing; the runner requires contiguous versions, so the numbers are assigned at implementation.

## Consequences
- Pro: the monitor and the issue text can name the overdue series; a pending release is no longer reported as `fresh` or as a problem; the inferred WEO defect cannot occur; the stale rule is independent of the lag magnitude.
- Pro: group-level consumers keep working: the export reads the same six columns of `ops.v_freshness_latest`; the state vocabulary of `status.json` changes (`fresh` becomes `current`, new `awaiting_release`), which is a breaking change of an enum. The directory `site/` does not exist in the repository at the time of writing, so no front-end consumer exists yet.
- Pro: a stale core series is now louder (`error`) than a stale non-core series, without blocking anything.
- Con: more rows (about one per series per run: about 3,500 per run, order of 40,000 per year at one run per month [analyst estimate, unmeasured], well inside the DB-02 budget). Adding an identity column rewrites the (probably empty) table once [PostgreSQL ALTER TABLE notes, https://www.postgresql.org/docs/current/sql-altertable.html, accessed 2026-11-04].
- Con: with fixed grace by frequency, a slow source must be tuned through `typical_lag_days`, which also feeds `release_lag_aware` ranking staleness; this coupling is accepted by the user's decision.
- Con: the duplicated calendar numbers remain until FU-1.
- Con: the ADR-007 text (`fresh | late | stale | broken`) and the validation spec section 2 are out of date once this is approved; this ADR amends only that sentence, as ADR-017 did for REV-01. ADR-007 stays `approved` and unchanged.
- Reversal: the legacy columns and rows remain, so a return to group rows needs only code.

## Open questions for the user
1. `awaiting_release` counts with `current` as healthy in the roll-up and opens no issue: confirm (amendment spec question 4).
2. Location and shape of `known_stale` (a list inside the calendar entry): confirm or name another file (question 5).
3. Confirm the interpretation "no per-group `grace_days` override at all" of the grace decision (amendment spec section 10).

Closed on 2026-11-04: grace values, core-stale severity, `fetch_broken` as flag, `v_series_deferred` correction, equality test now / single source later, daily and weekly out of scope.
