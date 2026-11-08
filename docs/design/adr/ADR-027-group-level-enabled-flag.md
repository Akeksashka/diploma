---
status: approved   # approved by the user on 2026-11-05 (stated in session: "approved, go as recommended"); open questions Q1-Q6 per the recommendations stated in session
---
# ADR-027: A series group can be switched off by a group-level `enabled` key while its source stays enabled (amends the source-config schema; refines the `enabled` semantics of ADR-004 config)

Date: 2026-11-05 (Phase 2). Facts below are about this repository, read on 2026-11-05; no external source is used. Code was read, not executed; statements about behaviour are inferences from reading and are marked as such.

## Context
- `enabled` exists only on the source entry. The schema lists it among the source keys (`docs/specs/source-config-schema.md` section 1, line `enabled: true`; `src/macro_monitor/registry/schemas/sources.schema.json`, source object, property `enabled`). The group object has no such property, and unknown keys are errors (spec header "unknown keys are errors"; AC-CFG-1; the `group` definition in `sources.schema.json` sets `additionalProperties: false`).
- Every consumer reads the source-level switch only:
  - `plan` builds the fetch matrix from `_groups_of(cfg, enabled_only=True)`, which skips a group only when `cfg.sources.effective_enabled[source_id]` is false (`src/macro_monitor/cli.py`, `_groups_of`, `cmd_plan`). `fetch` refuses a group whose source is not enabled (`cmd_fetch`); `ingest-manual` uses the same helper (`cmd_ingest_manual`).
  - `effective_enabled` is a map from source id to bool (`src/macro_monitor/registry/config.py`, `SourcesConfig`, `load_sources`); `sync-config` writes it to `ref.source.enabled` (`src/macro_monitor/registry/sync.py`, `_sync_sources`). `ref.series_group` has no enabled column (`src/macro_monitor/storage/migrations/0001_ref.sql`).
- Situation that triggers this ADR. `config/sources.yaml` holds one source `eurostat` (enabled since 2026-11-05 after a one-request probe of `une_rt_m`) with four groups. Only `eurostat_labour` was probed live. `eurostat_sts`, `eurostat_hicp` and `eurostat_gov_debt` (added by T53) carry synthetic fixtures and keys, dimension order and category codes marked `[UNVERIFIED]`; the file comment says "there is no group-level switch, so these groups are in the fetch matrix: probe each one before the next scheduled fetch" (`config/sources.yaml`, comment above `eurostat_sts`). The next scheduled fetch would therefore request unprobed filters from a live API.
- Why the two obvious workarounds do not work:
  - Disabling the source `eurostat` also pauses `eurostat_labour`, the one live Eurostat group.
  - Moving the unprobed groups to a second source entry needs a different `id`, but the connector is bound to the id: `SOURCE_ID = "eurostat"` and `source_id = SOURCE_ID` in `src/macro_monitor/ingestion/connectors/sdmx.py`; `_connector()` in `src/macro_monitor/cli.py` dispatches on `sid == "eurostat"`. The shared rate limit (`rate_limit.min_interval_s: 2`, `max_concurrent: 1`, `config/sources.yaml`) is a per-source setting enforced by the one `HttpClient` per host (ADR-004, Decision, second bullet), so two source entries for one host would each assume the full budget and could together send twice the intended rate. Also `ref.series_group` is keyed by `(source_id, group_id)` and `ref.series` rows already created for group ids would not move (history and `config_sha256` keep the old source id).
- Related approved decisions that this ADR must not break: ADR-004 (connector registry, per-host rate limit, parsers filter to the series whitelist), ADR-013 (the `Connector` protocol is `plan`/`fetch`/`parse`; `plan` is a pure function of config and state), ADR-017 (the revision-check family is chosen by group flags; no new DDL column was added for a single group), ADR-020 (per-series freshness from the release calendar, group roll-up in `ops.v_freshness_latest`, calendar numbers duplicated in `sources.yaml` and `release_calendar.yaml` with an equality test, rule 34 of `docs/specs/freshness-state-amendment.md`).

## Options considered
1. Status quo: no group switch; operator comments the groups out of `sources.yaml` or keeps them live and probes before each scheduled run. Commenting out removes them from schema validation, from `config-report` and from `ref.series_group` bookkeeping, so the config can rot unvalidated; keeping them live puts unprobed requests in the matrix. Rejected.
2. Disable the whole `eurostat` source until all groups are probed. No code or schema change, but it pauses `eurostat_labour`, whose data is live and probed. Rejected as the standing answer (it remains available to the operator at any time and is unaffected by this ADR).
3. Split into a second source entry (for example `eurostat_pending`). Breaks `SOURCE_ID` in `sdmx.py` and the id dispatch in `cli.py`, duplicates the rate limit and licence/archive blocks, and renames the group's `(source_id, group_id)` key; reversing it later is a second rename. Rejected.
4. A group-level `enabled` key, default `true`, effective only when the source is enabled. Smallest change that keeps one source, one connector, one rate limit. Chosen.
5. A generic group `status: active | probe_pending | retired` enum. More expressive, but nobody has asked for three states and it invents lifecycle vocabulary; the existing `note` key carries the reason. Rejected for v1; extending the boolean to an enum later is a schema-version change, not a data migration.

## Decision
Option 4.
1. Key name and type. `enabled`, boolean, optional, on the group object only, same spelling as the source-level key. Default `true` when absent, so every existing group keeps its meaning and its `config_sha256` (the sha is computed over the group mapping as written, `group_row` in `sync.py`, inference from reading; a group that omits the key hashes as before).
2. Effective state. `group_enabled(source, group) = effective_source_enabled(source) AND group.enabled`. A source that is disabled (including the rule 1 forcing for `web` sources) disables all its groups regardless of the group key; `enabled: true` on a group never overrides a disabled source. `SourcesConfig` gains a derived map `effective_group_enabled[(source_id, group_id)]`; `effective_enabled` keeps its meaning.
3. Fetch matrix. `plan` includes a group in `fetch_matrix.include` only if `group_enabled`. `fetch <group>` on a group with `group_enabled = false` exits with a config error naming the group and the reason (group switch or source switch). `ingest-manual` applies the same predicate. Request planning stays a pure function (ADR-013): a connector is never called for a disabled group.
4. Load and rebuild are not blocked. Raw objects already in the archive stay loadable: `load` still drains `ingest.v_raw_unloaded` for a group disabled after it was fetched, and `rebuild`/re-parse are unaffected, because raw data is immutable and a switch is a fetch-scheduling decision, not a data-quality verdict. A group that was never enabled has no raw objects, so nothing loads.
5. Validation is unchanged for disabled groups. Schema, parser import (rule 6), `series_map` existence (rule 7), `expected_series_min` (rule 7), seasonal-adjustment rule 8, revision rules 9-10 and 27-33 and the calendar equality test (rule 34 of the freshness amendment) are all evaluated for a disabled group exactly as for an enabled one. A disabled group is parked, not deleted from the contract. `expected_series_min` stays mandatory; it is a COMP-01 floor that applies at load time only (`check_comp_01` in `validation/revision_checks.py`), so a disabled group never trips it.
6. Auth and `plan` checks. Rule 3 (auth env present at `plan`) stays at source level and is not narrowed by this ADR. A source that is enabled while every group is disabled produces a `plan` warning ("source enabled, no group enabled"), not an error.
7. Freshness and expected-series checks. A disabled group is not evaluated: no `ops.freshness_state` rows are written for its series in that run, it contributes nothing to the group roll-up `ops.v_freshness_latest` (which reads the newest run, ADR-020 decision 5), and it raises no `late`, `stale` or `fetch_broken` issue. The monitoring step filters its calendar and series inputs by `group_enabled` (the filter is applied where `record_freshness` receives its calendar, `monitoring/freshness.py`). Series loaded earlier from a group that is later disabled keep their history and simply stop being re-evaluated; the dashboard shows them as it shows any series, and their ranking staleness (a data-driven notion, ADR-020 decision 7) keeps aging from the last observation. Re-enabling restarts evaluation from the next run; the first run after re-enabling may legitimately report `late`/`stale` and that is correct.
8. Release calendar. `config/release_calendar.yaml` entries for disabled groups stay (they must, because the equality test with `sources.yaml` `freshness:` blocks still runs) but are not loaded into the freshness evaluation, which skips them. No new calendar key.
9. Coverage report. `config-report` (`registry/report.py`, AC-CFG-5) treats a series-map entry of a disabled group as not mapped and lists it in a separate `disabled` bucket beside `pending`; it is never counted as mapped. `launch_ready` is unchanged in definition (every core pair mapped or `known_gap`), so a core pair that only a disabled group can supply keeps `launch_ready` false until the group is enabled and its series seen, or the pair is declared `known_gap`. Output shows the counts per bucket so the reason is visible.
10. Storage. A forward-only migration adds `enabled boolean NOT NULL DEFAULT true` to `ref.series_group`; `sync-config` writes the group's OWN flag (not the source-conjoined value, which is derivable by joining `ref.source`). No UPDATE of curated, raw-manifest or history tables is involved. `sync-config` still creates the group row for a disabled group, so `(source_id, group_id)` and `ref.series_map` pending entries exist.
11. Documentation duty. A disabled group should carry `note` with the reason and the probe that re-enables it; the validator issues a warning (not an error) when `enabled: false` has no `note`.
12. Immediate use (separate config change, not part of this ADR's approval): after implementation, set `enabled: false` on `eurostat_sts`, `eurostat_hicp` and `eurostat_gov_debt` with a `note` naming the pending operator probe; enable each after its probe. The stale comment above `eurostat_sts` in `config/sources.yaml` is then rewritten.

## Consequences
- Pro: unprobed groups stay validated and visible in config and reports but are never fetched; `eurostat_labour` keeps running; one connector, one `SOURCE_ID`, one rate limit, no key rename.
- Pro: the same switch serves other staged rollouts (BIS, OECD, ECB groups currently kept off only by a source-level `enabled: false`; `config/sources.yaml` shows those sources disabled).
- Pro: no change to ADR-004, ADR-013, ADR-017 or ADR-020 decisions; ADR-020 decision 5 already defines the roll-up over the newest run, so absence from the run is the natural disabled behaviour.
- Con: two switches to reason about. The effective-state rule (source AND group) is stated once in decision 2 and tested in one place.
- Con: one forward-only migration and a schema, spec, registry and `plan`/`fetch`/monitoring change (listed below); an operator can forget a disabled group, hence the `note` warning and the `config-report` bucket.
- Con: a disabled group with earlier data ages silently in ranking staleness; accepted, the dashboard already shows per-series latest period.
- Risk (inference from reading): `load` can still ingest backlog for a disabled group (decision 4). If the user would rather block load too, that is a one-line predicate change, but it would strand already archived raw bytes; see open question 1.
- Reversal: remove the key and the column in a later forward migration; the default `true` means files without the key are unaffected, so rollback of the config is trivial.

## Required changes (listed, not made)
Spec `docs/specs/source-config-schema.md`:
- Section 1 example: add `enabled: true   # optional, default true` to the group; a validation rule (next free number after those used by `freshness-state-amendment.md`, which uses 34) stating decisions 1, 2, 5, 6 and 11; rules 1 and 3 text unchanged; AC-CFG-1 negative count extended to the new rule; new AC-CFG entry (tests below); change-log entry; status of the spec resets to `draft` for the user's re-approval.
- Section 4 or the coverage paragraph: the `disabled` bucket of `config-report` (decision 9) and AC-CFG-5 wording.

Schema `src/macro_monitor/registry/schemas/sources.schema.json`: add `"enabled": {"type": "boolean"}` to the `group` definition's properties (not to `required`).

Registry code (named for the implementer; not edited here):
- `src/macro_monitor/registry/config.py`: `SourcesConfig.effective_group_enabled`, the `enabled: false` without `note` warning, the "source enabled, no group enabled" warning.
- `src/macro_monitor/registry/sync.py`: `group_row` adds `enabled`; the upsert covers the new column.
- `src/macro_monitor/registry/report.py` and its caller: the `disabled` bucket (decision 9).

CLI `src/macro_monitor/cli.py`: `_groups_of(..., enabled_only=True)` uses the group predicate; `cmd_fetch` and `cmd_ingest_manual` error messages name which switch is off; `cmd_plan` unchanged otherwise. No change to `_connector()`, `SOURCE_ID`, or the rate limiter.

Monitoring `src/macro_monitor/monitoring/freshness.py` and its caller: skip disabled groups before `record_freshness` (decision 7); `docs/specs/freshness-state-amendment.md` gets one sentence (disabled groups are not evaluated).

DDL: new forward-only migration for `ref.series_group.enabled`; `docs/specs/ddl-neon-schema.md` updated; migration number assigned at implementation (0014 is the next free file in `src/macro_monitor/storage/migrations/` at the time of writing; the numbers 0011 and 0012 named in ADR-020 and its amendment are already taken by `0011_pubdump.sql` and `0012_g02_remove_agri_domain_link.sql`, which that amendment should be read against).

Config `config/sources.yaml`: decision 12, after implementation and the user's request; not part of approving this ADR.

## Tests to add
Unit (no network, no DB), `tests/unit/config/`:
- Schema: a group with `enabled: false` and with `enabled: true` validates; `enabled: "no"` fails; a source-level typo such as `enable:` on a group still fails as an unknown key.
- Effective state matrix: (source on, group on) true; (source on, group off) false; (source off, group on) false; (source off, group off) false; web source forced off by rule 1 disables its groups.
- A disabled group still fails each existing negative (missing `series_map` file, missing `expected_series_min`, `CA` seasonal adjustment under rule 8, `edition_ordered` with `reestimating`), proving validation is not skipped.
- Warnings: `enabled: false` without `note`; enabled source with no enabled group; neither is an error.
- `group_row` includes `enabled`; a group without the key has the same `config_sha256` as before the change (golden sha of the current `eurostat_labour` entry).

Unit, `tests/unit/test_cli.py`: `plan` output for a fixture config with `eurostat_labour` on and the three T53 groups off contains only `eurostat_labour` in `fetch_matrix.include` and the connector's `plan` is never called for the others; `fetch eurostat_sts` exits with the config error and a message naming the group switch; `ingest-manual` of a disabled manual group fails with the same predicate; `load` of a disabled group's pre-existing unloaded object still proceeds (decision 4; mark the expected behaviour so a later change is deliberate).

Unit, monitoring: `record_freshness` writes no row for a disabled group; the group is absent from the roll-up input; re-enabled group is evaluated in the next run; an enabled group's rows are unchanged (regression against `tests/unit/test_monitoring_freshness.py`).

Unit, report: disabled-group entries appear in the `disabled` bucket, not in `mapped`; `launch_ready` is false when a core pair is satisfied only by a disabled group.

Calendar: the rule 34 equality test still runs on a disabled group's `freshness:` versus `release_calendar.yaml`.

Integration (`db` marker): after `sync-config` of the fixture, `ref.series_group.enabled` is false for the disabled groups and true for the others; running `sync-config` twice is idempotent; re-enabling updates the row through the existing configuration-history path and `config_sha256` changes; no row of `ref.series_map` is deleted when a group is disabled.

Real-config test (unit): `config/sources.yaml` after decision 12 loads; the computed fetch matrix equals `{eurostat_labour, worldbank_annual}` plus whatever else the user has enabled at that time.

## Migration and backfill impact
- No backfill. The new column defaults to `true`; every existing `ref.series_group` row is valid without rewriting data; no observation, raw-manifest or history row changes.
- Existing config files without the key behave as before (default `true`, sha unchanged). The three T53 groups have not been fetched live (only `eurostat_labour` was probed), so [inference from `config/sources.yaml` comments, not verified against the database] there is no loaded data to hide or age.
- Disabling a group that already has data: history stays, freshness and the matrix stop for it (decision 7); nothing is deleted or tombstoned. Re-enabling needs no migration; the next `fetch` with `mode_default: full` refetches complete history (`fetch_scope: complete`).
- Rollout order: this ADR approved by the user; spec and schema amendment approved; migration and code implemented; only then `sources.yaml` edit (decision 12). Until then the three groups remain in the matrix and the operator's only safe action is the source-level switch.

## Open questions for the user
1. Should `load` also skip a disabled group (decision 4 says no, so archived raw bytes can still be loaded)? Blocking it is simpler to explain but strands objects fetched before a disable.
2. Should a core pair that only a disabled group supplies keep `launch_ready` false (decision 9), or should the operator be forced to declare it `known_gap` while the group is off?
3. Rule 3 (auth env) stays at source level; confirm that an enabled source with all groups disabled should still require its env var, or narrow it to "at least one enabled group".
4. Key name: `enabled` (consistent with the source level) versus a distinct name such as `fetch_enabled`. This ADR proposes `enabled`.
5. Should the dashboard `status.json` list disabled groups (for example a `disabled` flag) or leave them absent as proposed in decision 7?
6. Do you accept deferring the `status: active | probe_pending | retired` enum (option 5) to a later ADR if a third state is ever needed?

## Resolution of the open questions (user, 2026-11-05, stated in session: "approved, go as recommended")
1. `load` does not skip a disabled group (decision 4 stands).
2. A core pair that only a disabled group supplies keeps `launch_ready` false (decision 9 stands).
3. An enabled source with every group disabled does NOT require its auth env var. This narrows rule 3 to "at least one enabled group" and overrides the first sentence of decision 6 and "rules 1 and 3 text unchanged" under Required changes. The "source enabled, no group enabled" warning stands.
4. The key is `enabled`.
5. `status.json` omits disabled groups (decision 7 stands).
6. The `status` enum is deferred to a later ADR if a third state is ever needed.

Numbering note: the migration is the next free number at implementation (0016 on 2026-11-05, not the 0014 named under Required changes).

## Sources (accessed 2026-11-05)
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/docs/specs/source-config-schema.md` (section 1, validation rules 1-33, AC-CFG-1)
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/src/macro_monitor/registry/schemas/sources.schema.json`
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/src/macro_monitor/registry/config.py`, `sync.py`, `report.py`
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/src/macro_monitor/cli.py`
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/src/macro_monitor/ingestion/connectors/sdmx.py`
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/src/macro_monitor/monitoring/freshness.py`
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/src/macro_monitor/storage/migrations/0001_ref.sql`
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/config/sources.yaml`, `config/release_calendar.yaml`
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/docs/design/adr/ADR-004-ingestion-framework-and-connectors.md`, `ADR-013-connector-protocol-three-steps.md`, `ADR-017-named-edition-groups-and-mass-revision-check.md`, `ADR-020-series-level-release-calendar-freshness-states.md`
- `/Users/oleksandrdzuba/Claude/Personal/macro-monitor/docs/specs/freshness-state-amendment.md` (rule 34, UD-5)
