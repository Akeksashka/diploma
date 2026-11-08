---
status: approved   # approved by the user on 2026-10-27 (stated in session)
inputs:
  - CLAUDE.md
  - docs/design/macro-monitor-platform-design.md
  - docs/design/adr/ADR-001-pipeline-orchestration-github-actions.md
  - docs/design/adr/ADR-002-bitemporal-append-only-observation-store.md
  - docs/design/adr/ADR-003-raw-archive-github-immutable-releases.md
  - docs/design/adr/ADR-004-ingestion-framework-and-connectors.md
  - docs/design/adr/ADR-005-web-collection-policy-and-manual-inbox.md
  - docs/design/adr/ADR-006-python-r-division-of-responsibility.md
  - docs/design/adr/ADR-007-validation-monitoring-and-alerting.md
  - docs/design/adr/ADR-008-neon-operating-model.md
  - docs/design/adr/ADR-009-series-mapping-and-authoritative-source.md
  - docs/design/adr/ADR-010-interactive-dashboard.md
  - docs/design/adr/ADR-012-privilege-matrix-authority-and-run-metadata-view.md
  - docs/design/adr/ADR-013-connector-protocol-three-steps.md
  - docs/design/adr/ADR-014-indicator-parameter-defaults-and-overrides.md
  - docs/design/adr/ADR-015-public-dump-format-csv-views-and-psql-restore.md
  - docs/design/adr/ADR-016-dependency-approvals-and-pandas-in-validation.md
  - docs/design/adr/ADR-017-named-edition-groups-and-mass-revision-check.md
  - docs/design/adr/ADR-018-series-rows-created-by-the-loader-on-first-sight.md
  - docs/specs/ddl-neon-schema.md
  - docs/specs/ingestion-interfaces-spec.md
  - docs/specs/source-config-schema.md
  - docs/specs/workflows-spec.md
  - docs/specs/validation-monitoring-spec.md
  - docs/specs/analytics-and-r-contract-spec.md
  - docs/specs/dashboard-export-spec.md
  - docs/specs/indicator-parameters-spec.md
  - docs/specs/public-dump-spec.md
---
# Macro Monitor v1 implementation plan

Regenerated 2026-10-27 by the planner from the fully approved design (design, ADR-001..010 and ADR-012..018, all nine specs). Nothing here is approved; the user approves. ADR-011 (forecast and projection storage) is NOT an input and is not approved; forecasting is v2 (section "Deferred to v2"). No task creates, reads or depends on a forecast table.

## 0. Scope, conventions, how to read this plan

**What v1 is.** Monthly refresh of the approved indicator set for 42 countries plus EU27, EA, WLD (45 entities): raw archive (GitHub immutable releases; `data/raw` locally), Neon bitemporal observation store, validation and monitoring, analytics (mid-rank percentiles, scorecards, alerts; full and published sets), JSON/Parquet export, static dashboard V1-V5 on GitHub Pages, seven workflows, the public database dump (per-view gzipped CSV, `schema.sql`, hashed manifest, restored with `psql`/`\copy`, `analytics.*` excluded) and runbooks. R is plumbing only (no R module is specified; ADR-006).

**Write locations (CLAUDE.md phase 4):** `src/`, `tests/`, `config/`, `scripts/`, `.github/workflows/`, `manual_inbox/`, `ops/`, `site/`, `docs/ops/`, and root `pyproject.toml`, lockfile, `.python-version`, `.env.example`. Anything else (see BL-09) is a user action.

**Task fields.** Goal, Files, Depends on, Acceptance criteria (AC and T-DDL ids refer to the specs), Tests (marker), Risks. Size tag: (S) under 2 h, (M) about half a day, (L) may exceed half a day and is split as named when started.

**Markers (CLAUDE.md, ADR-016).** `unit` = no network, no DB (enforced by `pytest-socket`). `db` = needs Postgres (`MM_TEST_DATABASE_URL`; service container in CI; `pytest-timeout` bounds two-session lock tests). `db_invariants` = restore-test suite. `network` = live probe, never on PRs, only when the user asks; a `network` item is operator-run and the task is complete without it unless stated.

**Cross-cutting rules every task inherits.** Type hints and `mypy --strict src`; `ruff check`/`ruff format`; schema changes are new forward-only migrations (never edit an applied one); **every migration that adds a table or view also (a) extends the expected privilege matrix fixture (T-DDL-10) and (b) adds its `pubdump` view or its line in the explicit exclusion list once T68 exists (AC-DUMP-6, T-DDL-31)**; no UPDATE/DELETE/TRUNCATE on curated, raw-manifest or history tables; no secrets in repo, env var names in `.env.example`; workflows pin actions by SHA, minimal `permissions`, user-controlled text only via `env:`; `pandas`/`pandera`/`statsmodels` imported only in `analytics/` and `validation/` (AC-DEP-1); property-style tests use seeded standard-library randomness (`hypothesis` is not approved); implementation never changes a design decision (a needed change is a new or updated ADR, approved first).

**Slice choice (design 14c item 6, decided by the user).** Eurostat monthly unemployment M09 (dataset `une_rt_m`, filter values [UNVERIFIED] until fixture capture in T22) for a handful of EU countries goes raw -> staging -> curated -> validation first (T05-T31); everything else widens afterwards.

**Local raw store assumption (A-1).** The design names GitHub releases as the production raw archive and `data/` as a local mirror (CLAUDE.md). The plan introduces a `RawStore` protocol with a local-directory backend (tests, development) and the GitHub backend (T45). An implementation seam, not a design change; still to be confirmed (OQ-04).

## 1. Blockers, design gaps and open questions (reported, not resolved)

Resolved since the previous plan and therefore dropped: BL-01, BL-02, BL-03, BL-04, BL-05, BL-06, BL-11 (forecast coupling, ADR status lines, DDL gaps, V4 vintage text, WEO flags, dump format, extra dependencies). Their effect is built into the tasks below.

### Blockers the user must resolve

- **BL-07 Support-series research (RESOLVED 2026-11-04).** `docs/research/data-sources-support-series-reserves-targets.md` (X01-X03, monthly reserves M14, inflation targets) is `status: approved` (user, 2026-10-27, stated in session). T62 and the production mapping of M13, M14, RESERVE_COVER are no longer gated by it.
- **BL-08 No WEO file; user-only.** Format of the IMF WEO manual file and presence of `NGAP_NPGDP` and `Estimates Start After` are unverified (BB7, BB23). Only the user can download the October 2026 edition (OP-05). Blocks T60, T61 data side, A02/A03 coverage.
- **BL-09 Write-location gaps.** (a) `.github/dependabot.yml` (workflows spec section 1) is outside `.github/workflows/`; (b) `.gitignore` entries (`.venv`, `site/node_modules`, `site/dist`) are not in the root-file list; (c) `config/indicator_defaults.yaml` (ADR-014) is not named in the CLAUDE.md repository map (the `config/` directory itself is a write location). The user updates CLAUDE.md or accepts an exception for each. Affects T03 (a, b) and T09 (c, partial); nothing else waits.
- **BL-10 Dashboard toolkit and ADR-010 update.** ADR-010 requires the AC-DASH-0 spike outcome to be recorded in an update of that ADR "not by the implementer alone". Blocks T88-T93 until the user approves the update (OP-10). Playwright is approved as the test tool (ADR-016), so T94 is not blocked on tool choice, only on a toolkit.
- **BL-12 All indicator parameters are `proposed`.** ADR-014: no agent sets `confirmed`. AC-PAR-7 makes a CI gate fail the production-run workflow while any core indicator is `proposed`, unless the user records acceptance (OP-13). This blocks the first production run (T98), not development. Open items inside it are OQ-10, OQ-12 and OQ-15. **User confirmed the indicator parameters on 2026-10-27 (stated in session).** To be recorded as `params.review.status: confirmed` with `by` and `on` in `config/indicators.yaml` when the file is built (T09), as the user's data, never invented by an agent; OP-13 acceptance is satisfied for the values as they stand in `indicator-parameters-spec.md`. OQ-10, OQ-12 and OQ-15 are unaffected and still need your answers.

### Design gaps found while planning (approved documents incomplete; reported, not worked around)

- **DG-01 Group config keys for `snapshot_mode` and materiality do not exist.** The DDL `ref.series_group` has `snapshot_mode`, `materiality_abs`, `materiality_rel`, `compare_mode`/`fixed_decimals`; ADR-017, source-config rules 10 and 27 and design Q33 use `snapshot_mode` and a materiality default of 0.001 for re-estimating groups. But the group schema of source-config section 1 lists only `reestimating`, `published_precision` and a `revision:` block with `compare`, `decimals`, `rel_epsilon`, `max_revised_rows`; the keys for `snapshot_mode`, `materiality_abs` and `materiality_rel` are not defined (names, placement, defaults). Unknown keys are errors (AC-CFG-1), so re-estimating and WEO groups cannot be configured as designed. Partial block: T46 (config part), T53/T54/T57 (SA, BIS gap, OECD CLI groups), T60 (WEO `snapshot_mode: none` is the default and can be omitted). The loader and DB logic are not blocked. Needs a source-config spec amendment by the design phase.
- **DG-02 `is_support` as an authored key.** The M06 example of source-config section 3 shows `is_support: false` as a key of an indicator entry, while the same example comments that it is derived from `kind` (DDL generated column) and rule 29 plus AC-CFG-11 say unknown keys are errors. T09 isolates this in one schema line and holds its negative test until the user chooses (accept-and-ignore, accept-only-if-equal-to-derived, or reject). Listed as OQ-14.
- **DG-03 Text still marked proposed or stale in approved documents (bookkeeping only; plan follows front matter and design 14b/14c).** Design section 15 lists ADR-018 as `proposed` while the file is `approved`; analytics spec section 9 and several P-items still read "PROPOSED AMENDMENT" although design 14b records Q44/Q45 and P1-P6 as approved. No task depends on the wording.

### Open questions and operator decisions

- **OQ-04** Is the local-directory `RawStore` backend (A-1) acceptable? (A-2, first-sight series creation, is now ADR-018 and decided.)
- **OQ-08 / OP-11** Postgres major version of Neon, for the CI service container and the `restore-test` container; Docker availability locally.
- **OQ-10** Indicator parameter details: rows defining several measures (Q11, A10, A13, A16, A22; kept as single indicators with a note meanwhile), G11 versus A26, adverse directions, borderline staleness classes, and **the named list for `release_lag_aware`** (global default false; draft list A12, A13, A14, A22, A26, G12 in the parameters spec section 7 item 7). The plan writes the draft list as `proposed`. **User decision 2026-11-04 (stated in session): adopt the draft list as `proposed`; revisit after the first real run.**
- **OQ-11** Q7: euro-area-inherited values in percentile ranks. Plan implements the documented default (excluded, flagged).
- **OQ-12** The `markets` domain is empty after Q30(a) (M16 moved to External): keep as an empty informational domain or drop. Plan keeps the domain row, unranked, until decided. **User decision 2026-11-04 (stated in session): drop the `markets` domain from v1.** Where specs, config or DDL still carry a `markets` domain row, removing it is a Phase 2 amendment first.
- **OQ-13** Whether the public dump also carries the published analytics tables through a second `mm_reader` leg (ADR-015, design R37, dump spec section 8). Plan: not built.
- **OQ-14** `is_support` authored key (DG-02).
- **OQ-15** Q06 BIS-gap thresholds: analytics spec 4.1 says "fixed 2/10 pp alert overrides remain"; the user's Q50 answer (z-score only) and AC-CFG-12 say v1 ships no override. Plan configures Q06 as z-score only (no override) and flags it. **User decision 2026-11-04 (stated in session): z-score only, no override; closed.** The stale analytics-spec 4.1 wording about the 2/10 pp overrides is to be corrected in a Phase 2 amendment.
- **OQ-16** `hypothesis` is not approved (ADR-016); plan uses seeded stdlib randomness. Confirm, or approve a library by ADR.
- **OQ-17** BB29 spike: does `COPY ... FROM STDIN` into `GENERATED ALWAYS` identity columns work on Neon's Postgres version (AC-DUMP-4 on the CI container, then once on a Neon dev branch; T95). Fallback in the design: `OVERRIDING SYSTEM VALUE` inserts or `GENERATED BY DEFAULT` by a new ADR.
- **OQ-18** BB30 spike: does the Playwright browser download work and fit the time in the `export-and-site` job (T94). Fallback: cache the browser directory, Chromium only, JS unit tests alone until fixed.

## 2. Operator (user) prerequisites, not agent tasks

Agents never create cloud resources, push, approve or change settings.

| ID | Action | Needed by |
|---|---|---|
| OP-01 | Enable "immutable releases" before the first raw release; set Pages source to GitHub Actions | T45 live check, T75, T87 |
| OP-02 | Create the Neon project and a dev branch; run the spike script (T95); then set role passwords and store `NEON_URL_*` secrets | T16 on Neon, T73+ |
| OP-03 | Add Actions secrets per workflows spec section 2 (`WORKFLOW_ENABLE_TOKEN` optional) | T73-T79 |
| OP-04 | Authorise network use for fixture capture and probes (`MM_ALLOW_NETWORK=1`) | T22, T23, T77 |
| OP-05 | Download the October 2026 WEO file from https://data.imf.org/datasets/WEO into `manual_inbox/imf_weo_manual/2026-10/` with sidecar (`edition_label`, `edition_date`, `source_url`, `downloaded_on`, `downloaded_by`) | T60, T61 |
| OP-06 | Approve (or amend) `docs/research/data-sources-support-series-reserves-targets.md` | T62 |
| OP-07 | Supply or verify full-length commit SHAs of every third-party action (agents cannot verify offline) | T03, T73+ |
| OP-08 | Add `.github/dependabot.yml` and `.gitignore` entries, or accept an exception; update the CLAUDE.md map for `config/indicator_defaults.yaml` (BL-09) | T03, T09 |
| OP-09 | If `main` is protected, add a ruleset bypass for the Actions app on `ops/**` (BB26) | T75 |
| OP-10 | Approve the ADR-010 update after the site spike and choose the toolkit | T88+ |
| OP-11 | Confirm Neon's Postgres major version for the CI container | T02, T79 |
| OP-12 | Monthly human check (day 2), AC-OPS-4 checks on days 7/55/65/125, manual WEO downloads | T98 |
| OP-13 | Confirm indicator parameters by family/domain, or record that a first run may start with `proposed` rows | T98 |
| OP-14 | Run the BB29 COPY spike once on a Neon dev branch | T95 |

## 3. Milestones

| M | Name | Exit criterion | Tasks |
|---|---|---|---|
| M0 | Foundations | Tooling, test harness, CI v0, dependency spikes recorded | T01-T04 |
| M1 | Thin slice: Eurostat M09, raw -> staging -> curated -> validation | AC-SYS-2/3/4 on fixtures, offline, Postgres container; first-sight series creation works | T05-T31 |
| M2 | Analytics core | Snapshot, ranks, scorecards, alerts, published set; AC-AN-* on fixtures | T32-T44 |
| M3 | Widening ingestion, loader hardening, monitoring | All wave-1 groups, manual WEO load as named editions; coverage gate | T45-T67 |
| M4 | Public dump, workflows and operations | Seven workflows lint-clean and tested; dump written, self-checked, restored with `psql` | T68-T81 |
| M5 | Export and dashboard | EXP-01..10 and AC-EXP-1..14 pass, V1-V5 render from fixtures | T82-T94 |
| M6 | Launch readiness | Spikes recorded, first-run checklist | T95-T98 |

Total: 7 milestones, 98 tasks.

## Task list

## M0 Foundations

### T01: Repository tooling scaffold (S)  [x] done
- Goal: Python 3.12 project with uv lock, ruff, mypy strict, pytest with strict markers, package skeleton for every module in design section 9, approved dependencies declared, import-boundary test.
- Files: `pyproject.toml`, lockfile, `.python-version`, `.env.example` (add names only; never read `.env`), `src/macro_monitor/{cli,settings}.py`, empty packages `registry/ analytics/ publish/` next to the existing `ingestion/ models/ monitoring/ storage/ validation/`, `tests/{unit,integration,fixtures}/`, `tests/conftest.py`, `tests/unit/test_import_boundary.py`.
- Depends on: none.
- Acceptance criteria: `uv sync`, `ruff check`, `ruff format --check`, `mypy --strict src`, `pytest` pass on the skeleton; markers `unit db db_invariants network` registered with `--strict-markers`; `pytest-socket` blocks sockets for `unit`; `pytest-timeout` configured; `network` tests skip unless `-m network` and `MM_ALLOW_NETWORK=1`; console script `macro-monitor` exists; AC-DEP-1 (`ast` walk: `pandas`/`pandera`/`statsmodels` only in `analytics/`, `pandas`/`pandera` also in `validation/`; allowed packages listed in one place; negative case with a synthetic module).
- Tests: `unit`.
- Risks: uv fails on first CI run (BB17; fallback `pip-tools`, CLAUDE.md). Dependencies other than the ADR-004/ADR-016 lists need a new ADR (no `pytest-cov`, `xdist`, `hypothesis`, `asyncio`).

### T02: Postgres test harness (S)  [x] done
- Goal: reusable `db` fixtures against a real Postgres.
- Files: `tests/conftest.py` (db fixtures), `scripts/dev/pg-up.sh`, `scripts/dev/pg-down.sh`, `docs/ops/local-development.md`.
- Depends on: T01; OP-11 (OQ-08) for the version.
- Acceptance criteria: `pytest -m db` creates a throwaway database from `MM_TEST_DATABASE_URL` (superuser DSN) and drops it afterwards; without the variable db tests skip with a clear message; roles are created per test database; a helper opens two concurrent sessions with a timeout.
- Tests: `db` (fixture self-test).
- Risks: version differs from Neon (BB19); Docker unavailable locally.

### T03: CI v0 workflow (S)  [x] done
- Goal: PR gate for lint, types, unit, db, workflow lint.
- Files: `.github/workflows/ci.yml`, `scripts/ci/{lint.sh,unit.sh,db.sh,actionlint.sh}`; `.github/dependabot.yml` and `.gitignore` entries only after BL-09.
- Depends on: T01, T02; OP-07; OP-08 (BL-09 partial: the Dependabot file and `.gitignore` wait, the workflow does not).
- Acceptance criteria: AC-WF-1 (`actionlint` clean); `permissions: contents: read`; no secrets; `network` excluded; Postgres service container for `db`; every `uses:` pinned to a 40-char SHA.
- Tests: `unit` (scan of workflow files for unpinned actions and `${{ inputs.* }}` in `run:`); actionlint in CI.
- Risks: SHAs unverifiable offline; actionlint binary provenance (pin version and checksum).

### T04: Dependency compatibility spikes (S)  [x] done
- Goal: record facts for BB13 (pandas 3 + pandera 0.34.x + pyarrow, and pandera on staged-row frames), BB27 (sdmx1 reading SDMX-ML from `BytesIO`), BB17 (lock tool), `jsonschema` draft support.
- Files: `tests/unit/test_compat_*.py`, `tests/fixtures/sdmx/` (tiny synthetic SDMX-ML labelled synthetic), `docs/ops/spike-results.md`.
- Depends on: T01.
- Acceptance criteria: each BB has a recorded pass/fail with versions; on failure the fallback named in ADR-016 / design register is listed for the user (pin older pandas; replace pandera by hand-written checks; small direct XML parser); the AC-DEP-1 boundary rule is not reopened.
- Tests: `unit`.
- Risks: a failure forces a user/ADR decision, not an implementer decision.

## M1 Thin slice: Eurostat M09 end to end

### T05: Domain types and enums (S)  [x] done
- Goal: frozen dataclasses and enums of ingestion spec section 1 (`RequestSpec`, `FetchResult`, `ParsedSeriesMeta` incl. `flow_basis`, `ParsedObservation`, `RevisionPolicy` incl. `edition_ordered`) and the DDL CHECK lists (value status incl. `MISS`, load kind incl. `import`, outcomes, drift kinds incl. `schema_drift`/`precision_change`/`composition`/`flow_basis`).
- Files: `src/macro_monitor/models/{types,enums}.py`.
- Depends on: T01.
- Acceptance criteria: `RequestSpec` rejects `incremental` + `complete`; `ParsedObservation.value` is `Decimal | None`, None iff status in (DEL, MISS); `RevisionPolicy` rejects `edition_ordered` together with `reestimating` and `snapshot_mode != none` without `reestimating`; enums mirror the SQL CHECK lists (cross-check added in T15).
- Tests: `unit`.
- Risks: Python/SQL enum drift.

### T06: Period arithmetic (S)  [x] done
- Goal: `models.periods`: `2026-09`, `2026-Q3`, `2026`, `2026-09-30` to (start, end) for A/Q/M/D; bound checks per I-CUR-6.
- Files: `src/macro_monitor/models/periods.py`.
- Depends on: T05.
- Acceptance criteria: leap years, quarter ends, 364-366-day non-calendar annual rule; fiscal/marketing bases only from metadata, never guessed.
- Tests: `unit` (table tests; seeded stdlib random round trip).
- Risks: low.

### T07: sources.yaml schema, loader and config rules (M)  [x] done
- Goal: JSON-Schema (`jsonschema`) and loader for `config/sources.yaml` incl. `archive_policy`, manual-source shape, WEO example; rules 1-7, 9, 10, 15-19, 27, 28.
- Files: `src/macro_monitor/registry/{config.py,schemas/sources.schema.json}`, `config/sources.yaml` (the existing stub gains `archive_policy`), `tests/unit/config/`.
- Depends on: T01, T05.
- Acceptance criteria: AC-CFG-1 (one negative test per implemented rule), AC-CFG-3 (secret scan; env names in `.env.example`), AC-CFG-7, AC-CFG-8 (private repo, `scale_min`, `job_timeout_min: 400`, day-26 reminder), AC-CFG-9 (WEO example validates as a whole; both flags rejected by rule 27; `vintage_resolution`/`release_cadence_note` rejected as unknown; manual source with `rate_limit` rejected by rule 4; group without `expected_series_min` rejected by rule 7), AC-CFG-10 for the `annualised_policy` schema side; unknown keys are errors.
- Tests: `unit`.
- Risks: DG-01 (no config keys for `snapshot_mode`/materiality; this task implements only the keys the spec defines and does not invent names). Rules 8, 11 (sidecar), 12-14, 18 land in T08, T09, T18, T59.

### T08: entities.yaml and entity rules (S)  [x] done
- Goal: 42 countries, EU27, EA, WLD with group memberships and validity dates (euro area incl. Bulgaria from 2026-01-01, G7, advanced/emerging, non-euro EU).
- Files: `config/entities.yaml`, `src/macro_monitor/registry/entities.py`, tests.
- Depends on: T07.
- Acceptance criteria: rule 14 (exactly one WLD, EU27, EA, 42 countries; 45 entities); `WLD` is aggregate, `is_global`, unranked; list transcribed from the approved selection and cited in a header comment.
- Tests: `unit`.
- Risks: euro-area dates ([UNVERIFIED] Bulgaria) need a reader check against the selection document.

### T09: Indicator config schema and ADR-014 resolution engine (M)  [x] done
- Goal: layered resolution (global -> family -> indicator), provenance, review status; rules 12, 13, 20-26, 29; seed `labour`/M09 only.
- Files: `src/macro_monitor/registry/{indicators.py,schemas/indicators.schema.json}`, `config/indicator_defaults.yaml`, `config/indicators.yaml`, tests.
- Depends on: T07; BL-09(c) (file location, partial); DG-02/OQ-14 (one schema line).
- Acceptance criteria: AC-PAR-2 (missing `rank.mode` fails even if the family has an opinion), AC-PAR-3 (precedence and provenance), AC-PAR-9 (one failing fixture per rule 22-26), AC-CFG-11 (family, `stationarity_class`, `release_lag_aware`, `review`; `trending_level` with `transform: LEVEL` validates; unknown family/key/value fail), AC-CFG-12 (checked-in `indicators.yaml` has no non-empty `alert.override` unless `review.status: confirmed`; fixture with rationale validates, without fails), AC-CFG-10 (`annualised_policy: latest_single` fails naming rule 28), AC-CFG-8 (override without rationale), `release_lag_aware` global default false.
- Tests: `unit`.
- Risks: `is_support` negative test is held pending OQ-14.

### T10: Migration runner (S)  [x] done
- Goal: forward-only SQL migration runner with checksum record and migrate lock.
- Files: `src/macro_monitor/storage/{db.py,migrate.py}`, `src/macro_monitor/storage/migrations/0000_schema_migration.sql`.
- Depends on: T01, T02.
- Acceptance criteria: T-DDL-5 (applies on empty DB; changed checksum of an applied file rejected); `pg_advisory_lock(hashtext('mm-migrate'))`; refuses to run while an `ingest.run` is `running` and younger than 6 h; schema-version check helper for DB-03; exit code 40 on mismatch.
- Tests: `db`.
- Risks: owner-role-only; advisory locks through Neon's pooler (BB20): direct endpoint.

### T11: Migration `ref` schema (M)  [x] done
- Goal: all `ref.*` tables with the round-6 columns, CHECKs, immutability and freeze triggers, one-headline exclusion, unit seed.
- Files: `migrations/0001_ref.sql`, `tests/integration/test_ddl_ref.py`.
- Depends on: T10.
- Acceptance criteria: T-DDL-3, 4, 6, 9 (incl. `annualised_policy` accepts only `fail`, `rank_mode` without default), 23, 27 (`stationarity_class` and `release_lag_aware` columns, no default, change writes `config_history` once T12 exists), 30 (`NOT (edition_ordered AND reestimating)`, `snapshot_mode = 'none' OR reestimating`); `published_decimals` BEFORE UPDATE trigger (decrease rejected; increase only with a `precision_change` event, lazy reference to `ops.drift_event` from T14).
- Tests: `db`.
- Risks: `btree_gist` on Neon (BB2, AC-OPS-7): keep the loader-enforcement fallback behind a documented flag.

### T12: Migration `ref.config_history` (S)  [x] done
- Goal: append-only history from SECURITY DEFINER triggers on `series_map`, `inheritance_rule`, `indicator`, `domain`, `entity`, `source` etc.; `ref.fn_config_asof`.
- Files: `migrations/0002_config_history.sql`, tests.
- Depends on: T11.
- Acceptance criteria: T-DDL-16 (as-of reading returns the first state between two syncs; UPDATE/DELETE rejected; `publish_site`, `is_ranked` changes each write a row); T-DDL-27 history clause.
- Tests: `db`.
- Risks: SECURITY DEFINER on Neon (AC-OPS-7).

### T13: Migration `ingest` and `staging` (M)  [x] done
- Goal: `run`, `request_state`, `raw_blob`, `raw_object` (incl. `edition_date`, `import_label`), `raw_snapshot`, `raw_load`, `raw_series_status`, `fetch_attempt`, views `v_raw_unloaded`/`v_series_deferred`, run-scoped staging tables and `series_meta_load`.
- Files: `migrations/0003_ingest_staging.sql`, tests.
- Depends on: T11.
- Acceptance criteria: T-DDL-7 (A -> B -> A gives three objects, two blobs; equal-to-prev rejected except `hash_only`/`bytes_unavailable`; duplicate key; incremental+complete; `import_label` without `manual`), T-DDL-8, I-ING-1..7; append-only triggers; no TRUNCATE path; `request_state.last_loaded_*` change only with a `loaded` row.
- Tests: `db`.
- Risks: I-ING-2 trigger compares with `prev_raw_id`; concurrent inserts per request key.
- T12 carry-over (assigned to T14, migration 0004): `ref.config_history.run_id` is a plain bigint with no FK (ingest.run did not exist at 0002); add `FOREIGN KEY (run_id) REFERENCES ingest.run` in a forward migration (0003 or later). Also: the history trigger reads session settings `mm.git_sha` and `mm.run_id` (defaults `'unknown'` / NULL); T18 sync-config must set both, and decided: keep this convention. `recorded_at` is the transaction start, so callers of `fn_config_asof` must commit between changes they need to tell apart. Mention both in the DDL spec at the next spec revision.

### T14: Migration `ops` tables (S)  [x] done
- Goal: `validation_result`, `drift_event` (kind list, decision-cache trigger), `drift_decision`, `quality_override`, `run_summary`, `export_status`, `freshness_state`.
- Files: `migrations/0004_ops.sql`, tests.
- Depends on: T13.
- Acceptance criteria: T-DDL-21 (all kinds accepted; retired `schema` rejected); `drift_event` UPDATE only with a same-transaction `drift_decision` INSERT; decision and override tables insert-only.
- Tests: `db`.
- Risks: `validation_result` has no PK in the DDL; none added (index on `(run_id, check_id)` only).
- T13 carry-over: `ingest.raw_series_status.event_id` is a plain bigint (ops.drift_event did not exist); add its FK in 0004. The I-ING-6 same-transaction check uses `xmin`, so the loader (T26/T27) must write the `loaded` row in the top-level transaction, not a SAVEPOINT. The chain trigger rejects a `fetched_at` not later than the latest object of the key, so a manual import never goes back in time. Decided (orchestrator, within I-ING-3): `fetched_at` is when the bytes were obtained, never the file's date; T59 stamps imports with the actual import time and carries the file's date in `edition_date`.
- T11 carry-over: confirm the `precision_change` match used by the `ref.series` `published_decimals` trigger in `0001_ref.sql` (`kind`, `source_id`, `series_ref = series_key`, `created_at = transaction_timestamp()`) against `ops.drift_event`; if the columns differ, fix with a new forward migration, never by editing 0001.

### T15: Migration `curated` (M)  [x] done
- Goal: `curated.observation` with all constraints, append-only trigger, views and `fn_observation_asof`, including the second-fix-pass `v_revision_history`.
- Files: `migrations/0005_curated.sql`, tests.
- Depends on: T13, T11.
- Acceptance criteria: T-DDL-1 (I-CUR-1..11), T-DDL-2, T-DDL-19 (`MISS`), T-DDL-22 (views exclude `import`; `v_revision_history` column set exactly as DDL section 5 incl. `value_status`, `is_base_version`, `edition_ordered`; no input or comparison rows), T-DDL-33 (full PROJ fixture S1-S4 inserted as `mm_ingest`; perturbation and negative control), `obs_known_not_future` one-hour backstop; views `v_observation_latest`, `v_series_obs`, `v_headline_obs`, `v_headline_obs_observed`, `v_comparison_obs`, `v_headline_obs_published`, `v_revision_history` (excludes `PROJ`, I-CUR-11), `v_input_obs_published`, `v_observation_public`; Python enums cross-checked against SQL CHECK lists (closes the T05 risk).
- Tests: `db`.
- Risks: view performance (one series history under 200 ms warm; measured in T96); the revision view definition is intricate, so the independent-query check of T-DDL-33(k) is mandatory.
- T15 scope split (orchestrator): schema, views and T-DDL-1/2/19/22/33 content checks are done. Loader behaviour I-CUR-2, 3, 5, 7, 9 and T-DDL-20 are verified in T26-T28; the `mm_ingest` insert and `mm_reader` read sides of T-DDL-33 are verified in T16 (privilege matrix). Python-vs-SQL enum cross-check for the `ops` enums (DriftKind, DriftStatus, DriftDecision) is added in T16 now that 0004 exists. `curated.fn_observation_guard` (BEFORE INSERT, not a spec object) enforces I-CUR-4(a) (known_at = raw fetched_at, strictly increasing per key, imports ignored) and I-CUR-6 period bounds; the loader must satisfy it and skip out-of-order series as `skipped_out_of_order` (ORD-02) instead of inserting. `v_input_obs_published` is built from `v_headline_obs_observed` (PROJ excluded), mirroring `v_headline_obs_published`.

### T16: Roles, grants and privilege-matrix test (M)  [x] done
- Goal: five roles (no passwords in SQL), column-level grants, expected-matrix fixture derived from DDL section 8 only, T-DDL-10.
- Files: `migrations/0006_roles_grants.sql`, `tests/fixtures/privileges/expected_matrix.csv`, `tests/integration/test_privileges.py`.
- Depends on: T11-T15.
- Acceptance criteria: every (role, object) cell equals the fixture via `has_table_privilege`/`has_column_privilege`; explicit negatives of T-DDL-10 (mm_reader cannot SELECT `curated.observation`, `analytics.run`, `ingest.run`, `ops.run_summary`, `ref.config_history`; mm_ingest cannot SELECT any `analytics.*`/`analytics_r.*`; no TRUNCATE on `staging.*`; mm_ingest INSERT `ops.export_status`); `pg_advisory_xact_lock` executable by `mm_analytics`; CI fails on any DB object absent from the fixture.
- Tests: `db`.
- Risks: role creation by SQL on Neon unverified (BB2); operator creates roles in the console if the spike fails; passwords always out of band (OP-02).

### T17: Export-facing `ref` views (S)  [x] done
- Goal: `ref.v_series_export` and `ref.v_source_public` with explicit column lists, owner-rights views.
- Files: `migrations/0007_ref_export_views.sql`, matrix fixture, tests.
- Depends on: T11, T16.
- Acceptance criteria: T-DDL-32 (exact columns incl. `reestimating`; no `published_precision`/`source_url` column; withheld source row with `publish = 'withheld'`; no row for input or comparison mapping; `inherited` exactly for valid inheritance rules; `mm_reader` can SELECT both views and not `ref.series`, `ref.series_group`, `ref.source`).
- Tests: `db`.
- Risks: owner-rights views must not be `security_invoker` (UNVERIFIED on Neon).

### T18: sync-config (M)  [x] done
- Goal: idempotent load of config into `ref.*` with run row, SA rule, group flags, closing rows by `valid_to`/`enabled`, resolved ADR-014 values and provenance written to `ref.indicator`.
- Files: `src/macro_monitor/registry/sync.py`, tests (CLI hook in T30).
- Depends on: T08, T09, T12, T16, T07.
- Acceptance criteria: AC-CFG-6, T-DDL-18 (rule 8: `sa_required` mapping to CA/NSA rejected), AC-ING-14 (`M3M3_ANN`/`QOQ_ANN` need SA/SCA), AC-ING-13 (incremental+complete rejected), rules 12/14 against the DB; `ref.source.config_sha256`; WLD seeded; second run writes no `config_history` rows; `archive: private` rejected while `private_repo` is null; **sync-config never creates `ref.series` rows and records map entries of unseen series as pending, inserting no `ref.series_map` row for them** (T-DDL-25 clause; ADR-018); AC-PAR-8 (resolved `stationarity_class`/`release_lag_aware` equal the golden values).
- Tests: `db`, `unit`.
- Risks: pending-versus-mapped accounting must reach `config-report` (T33).

### T19: HttpClient and rate limiting (M)  [x] done
- Goal: shared httpx client per ingestion spec section 3.
- Files: `src/macro_monitor/ingestion/{http.py,ratelimit.py}`, tests.
- Depends on: T05.
- Acceptance criteria: AC-ING-3 (challenge signature gives `blocked`, no retry), AC-ING-6 (fake clock: 5 requests at `min_interval_s=2` take at least 8 s; hour budget defers), User-Agent template, Retry-After, 10-minute wait cap, redirect to unlisted host an error, secret redaction, TLS always on, clock-offset stamping function (BB25, `fetched_at = runner_now + offset`).
- Tests: `unit` (httpx MockTransport; fake clock).
- Risks: low.

### T20: RobotsGate and persisted budgets (S)  [x] done
- Goal: robots check (log-only for documented APIs, fail-closed for web), `request_state` counters.
- Files: `src/macro_monitor/ingestion/{robots.py,state.py}`, tests.
- Depends on: T19, T13.
- Acceptance criteria: disallowed/unreadable robots skips a web source (404 = no restriction); decision stored on the object; budgets persist across runs; AC-CFG-4 (a transport that fails on any request proves a web source without review is never fetched).
- Tests: `unit`, `db`.
- Risks: robots cache 24 h in `request_state`.

### T21: Raw store, manifest writer, change detection (L, split: store / manifest / ladder)  [x] done
- Goal: `RawStore` protocol with local backend (A-1), zstd and sha256, `raw_blob`/`raw_object` writers, change-detection ladder against the LATEST object.
- Files: `src/macro_monitor/ingestion/archive.py`, `src/macro_monitor/storage/manifest.py`, tests.
- Depends on: T13, T05; OQ-04.
- Acceptance criteria: AC-ING-2 (304 or identical body gives `fetch_attempt`, no `raw_object`); revert A -> B -> A gives three objects, two blobs, one asset; asset decompresses to exactly the received bytes; `hash_only` blob has `storage_backend = 'none'`; fetch-side `request_state` pointers advance only after the manifest commit; interface carries `release_tag`/`asset`.
- Tests: `unit`, `db`.
- Risks: GitHub backend arrives in T45.

### T22: Parser registry and Eurostat JSON-stat parser v1 with fixtures (M)  [x] done
- Goal: `parser_id = module@version` registry with frozen versions; JSON-stat parser using text-preserving `Decimal` parsing; recorded-bytes fixtures with golden output.
- Files: `src/macro_monitor/ingestion/{registry.py,parsers/jsonstat_v1.py}`, `tests/fixtures/raw/eurostat/` (bytes plus sidecar: URL, date, sha256, licence), golden files.
- Depends on: T05, T06; OP-04 (operator-run capture; fallback: hand-built fixture labelled synthetic).
- Acceptance criteria: AC-ING-1 (parse twice identical), AC-ING-11 (every fixture `parser_id` resolves; removing a released version fails), AC-ING-17 parse side (`:` declared marker gives `MISS`; undeclared `n/a` is a rejected row), T-DDL-14 registry clause, `published_decimals` derived as the maximum scale seen in source text, series filter honoured.
- Tests: `unit`; `network` (fixture capture, operator-run).
- Risks: JSON-stat numbers lose trailing zeros (parse from text); Eurostat filters [UNVERIFIED] until capture.

### T23: Eurostat connector, slice config and series map (M)  [x] done
- Goal: three-step `Connector` (plan/fetch/parse, ADR-013) for Eurostat JSON-stat; first `sources.yaml` entry and group `eurostat_labour`; M09 map for the fixture countries with `expect` blocks.
- Files: `src/macro_monitor/ingestion/connectors/sdmx.py`, `config/sources.yaml`, `config/series_map/eurostat_labour.yaml`, `config/release_calendar.yaml`, tests.
- Depends on: T07, T19, T20, T22, T09.
- Acceptance criteria: AC-ING-20 (exactly `source_id, plan, fetch, parse`; non-discovery fixtures return non-empty `metas` and `observations`; discovery fixture yields metas only); request carries `c[TIME_PERIOD]=ge:1991` and a country list; `fetch` returns bytes untouched; `updated` probe; `publish_site`/`archive` explicit, licence recorded; AC-CFG-2.
- Tests: `unit`; `network` (tiny live probe, operator-run).
- Risks: async Eurostat responses arrive in T53.

### T24: Validation framework with RAW, PARSE, META, SEM checks (M)  [x] done
- Goal: check registry, severity policy, `ops.validation_result` writer, pandera contracts (pandas only in `validation/contracts.py`).
- Files: `src/macro_monitor/validation/{contracts.py,checks.py,quarantine.py}`, tests.
- Depends on: T14, T22, T04.
- Acceptance criteria: RAW-01..07, PARSE-01..05, META-01..05 (META-05 against DB clock: warn 60 s, error 5 min), SEM-01..04 each with pass and fail fixture (AC-VAL-1); `error` leaves no partial load (AC-VAL-6); rejected rows to `staging.rejected`; `suspect` rows flagged; AC-VAL-13 (MISS in PARSE-03/05; ORD-03 and BKP-02 parts land later); frames created only in `contracts.py` and not returned to callers (AC-DEP-1).
- Tests: `unit`, `db`.
- Risks: BB13 outcome (T04). Thresholds recorded per run.

### T25: fetch command (M)  [x] done
- Goal: group fetch: request, archive, parse with series filter, manifest + staging in one transaction, `fetch_attempt`, run row.
- Files: `src/macro_monitor/ingestion/fetch.py`, tests.
- Depends on: T18, T21, T23, T24.
- Acceptance criteria: I-ING-5 (kill between upload and commit leaves no orphan; AC-ING-5(b)); run-scoped staging (`run_id`, `raw_id` on every row); validators advance after commit; unchanged fetch writes only `fetch_attempt`; per-group isolation.
- Tests: `db`, `unit`.
- Risks: crash windows between archive store and manifest commit.

### T26: Loader A, queue, lock, order, idempotence (M)  [x] done
- Goal: drain `ingest.v_raw_unloaded` per group in `(fetched_at, raw_id)` order under `mm-load`; `loaded_at = clock_timestamp()` after the lock; `raw_load` row; staging deletion; load-side `request_state`.
- Files: `src/macro_monitor/storage/loader.py`, tests.
- Depends on: T25, T15, T16, T24.
- Acceptance criteria: AC-ING-5(a)(c)(d), AC-ING-7, AC-ING-8 (hold successors, ORD-02, `--raw-id` refusal), AC-ING-9 (concurrent refresh and manual staging), T-DDL-17, T-DDL-20 and AC-ING-15 scenarios A and B (loader side), `lock_timeout` 10 min leaves the object queued, drain twice leaves identical state.
- Tests: `db` (two-session tests with `pytest-timeout`).
- Risks: advisory locks via pooler (BB20): direct endpoint; re-staging needs the registry (T22).
- T26 note (orchestrator): AC-ING-9 is covered only as "other run staging untouched + equals sequential"; a truly concurrent two-session refresh-vs-manual-staging test moves to T27 (needs real staging writers). The insert seam is `loader.insert_observations(LoadContext) -> LoadCounts`, currently raises NotImplementedError; T27 fills it.

### T27: Loader B, insert-on-change, first-sight series creation (M)  [x] done
- Goal: comparison at `published_decimals` (half unit, `rel_epsilon`), load-kind rules, `published_decimals` derivation/freeze/`precision_change`, **first-sight creation of `ref.series` and the declared `ref.series_map` rows (ADR-018) with the `expect` check**.
- Files: `src/macro_monitor/storage/{loader.py,compare.py,series_create.py}`, tests.
- Depends on: T26, T18 (pending map entries).
- Acceptance criteria: T-DDL-13 (float noise, 2.10 vs 2.1, exactly 0.005 not stored, 0.01 stored, PROJ new label same number stored), AC-ING-16, AC-ING-4 steps 1-3, I-CUR-2/3/5; **AC-ING-21 and T-DDL-25** (one `ref.series` row version 1 with `first_seen_at = fetched_at`, map rows in the same transaction; rollback leaves no row; second drain creates none; metadata differing from `expect`, unknown `unit_code`, or a missing group creates no row, raises a drift event and defers the series while others load; an unmapped staged series is never created; the map is read at the run's `git_sha`); every row has source, series key, frequency, unit, SA, `known_at`, `raw_id` (AC-SYS-2); metadata differences recorded through the drift hook (full handling T49).
- Tests: `db`, `unit` (comparison function).
- Risks: `Decimal` scale handling; loader reads config at a git sha (CI checkout depth, see T51).
- T11 carry-over: if `0001_ref.sql` was applied with `mm.headline_exclusion=loader` (no `btree_gist`), the loader must enforce the one-headline rule and carry a test for it.
- T27 note (orchestrator): Eurostat unit `PC_ACT` seeded by forward migration 0010 (orchestrator decision; reversible if the user prefers an ADR-backed Eurostat-to-ref.unit mapping). `series_create.headline_conflicts` enforces the one-headline rule when `btree_gist` is absent. With the gist constraint present, `create_series` drops a conflicting map row via `ON CONFLICT DO NOTHING` silently: T49/sync-config should surface it. AC-SYS-2 has no single all-fields-non-null test (schema NOT NULLs enforce it). Seam for T28: `loader.make_insert(provider)`; MISS-from-absence, tombstones (full+complete only, COMP-03 5 % guard), PROJ rule per vintage_label, revert and replay harness are T28.

### T28: Loader C, MISS, tombstones, PROJ rule, revert, replay harness (M)  [x] done
- Goal: `MISS` rows, tombstones only from `full`+`complete` objects (COMP-03 guard 5 %), PROJ same-`vintage_label` comparison, A -> B -> A, test-only replay.
- Files: `src/macro_monitor/storage/{loader.py,replay.py}`, tests.
- Depends on: T27.
- Acceptance criteria: AC-ING-4 (full scenario incl. step 5; `fn_observation_asof` before/between/after), AC-ING-13 data side, AC-ING-17 DB side, T-DDL-19, I-CUR-7 replay equals natural-key rows, property tests with seeded stdlib randomness (random vintage sequences give the same final state regardless of batching; as-of reproduces each earlier state).
- Tests: `db`, `unit`.
- Risks: replay depends on recorded outcomes (`raw_load`, `raw_series_status`).
- T28 note (data-engineer): code and db tests are written (`loader._tombstone`, `loader._latest_by_label`, `storage/replay.py`, `tests/integration/test_loader_replay.py`); lint, format, mypy and unit tests pass. The db tests were NOT run (no `MM_TEST_DATABASE_URL`, no Docker/Postgres in this session), so the status stays `todo` until they pass. Implementer choices: tombstones only for series present in the object; COMP-03 aborts tombstones per series (error result) but keeps the object's inserts; replay honours recorded `raw_load`/`raw_series_status` and takes a `restage` callable.

### T29: REV, COMP and DB checks for ordinary groups (S)  [x] done
- Goal: REV-01..05, COMP-01..04, DB-04, DB-05 (REV-06 in T46, REV-07 in T48).
- Files: `src/macro_monitor/validation/checks.py`, tests.
- Depends on: T24, T27.
- Acceptance criteria: AC-VAL-3 first clause (25 % material revisions in a group with neither flag blocks the object; stays in `v_raw_unloaded`; `drift_event(mass_revision)`), AC-VAL-7 (REV-05 noise count; DB-05 cap), AC-VAL-12 (half-unit materiality; ratio units use `materiality_abs` only); the check family is chosen once per object by group flags and stored in `raw_load.detail`.
- Tests: `unit`, `db`.
- Risks: needs correct `published_decimals` (ADR-007 consequence).
- T29 note (orchestrator): registry now has 35 checks (RAW 7, PARSE 5, META 5, SEM 4, ORD 3, REV 1-5, COMP 1-4, DB-04, DB-05); REV-06/07 plug into `OrdinaryChecks._family_results` (T46/T48); until then flagged groups never block. COMP-05 not here. Loader wiring (for T30 `load` command): `chk = make_ordinary_checks(run_id, base_insert, ...); loader.drain(conn, run_id=run_id, insert=chk.insert, validate=chk.validate, post_checks=chk.post_checks)`; one instance per drain.

### T30: CLI skeleton and minimal `plan` (S)  [x] done
- Goal: `macro-monitor` commands `sync-config`, `migrate`, `plan`, `fetch`, `load`, `config-report` (stub); exit codes 0/10/20/30/40; allow-list validation of every argument.
- Files: `src/macro_monitor/{cli.py,settings.py}`, tests.
- Depends on: T18, T25, T26, T10.
- Acceptance criteria: `plan` selects fetch groups plus every group with a non-empty unloaded queue; matrix JSON includes `job_timeout_min`; inputs read from env and validated (`^[a-z0-9_,]*$` for groups); config error exits 20.
- Tests: `unit`, `db`.
- Risks: the `plan` draft-release step is stubbed until T45.
- T30 note (implementer): commands `sync-config|migrate|plan|fetch|load|config-report`; `analyze` not wired. DSN from `DATABASE_URL`; inputs via `--mode/--group/--groups/--raw-id` or env `MM_MODE/MM_GROUPS/MM_RAW_ID`, all allow-listed; argparse errors exit 20. Spec gaps and choices: (1) "due" and the catchup rule ("fetch did not succeed this month") are not definable from the schema (`ingest.fetch_attempt` has no group id), so `refresh` and `catchup` both select every enabled group, `manual`/`preflight` select none; load groups = fetch groups plus distinct groups of `ingest.v_raw_unloaded`. (2) `plan` prints one JSON object: `run_id`, `mode`, `release_tag` (null unless `release_public`), `fetch_matrix` as `{"include":[{"group","job_timeout_min"}]}` (default 120), `load_groups` as a comma string; an empty `include` is invalid for GitHub `fromJSON` matrices, so T51 must guard it. (3) Draft release not opened (T45); `release_public` store is still refused by `raw_store_from_env`, so production `plan` exits 20 until T45. (4) `plan`, `fetch` and `load` each open their own `ingest.run` row (`fetch_groups` closes its run, so legs cannot share the plan run). (5) `load`: `--drain` or no `--groups` drains the whole queue, `--groups` restricts; a refused or blocked object gives exit 10. (6) `fetch` supports only the `eurostat` connector; parser id is derived as `<module>@PARSER_VERSION`. (7) `config-report` is an offline stub (all map entries counted as mapped). DB tests (`tests/integration/test_cli_db.py`) were written but SKIPPED here: no MM_TEST_DATABASE_URL and no Docker in the session; they must be run once before relying on them.

### T31: Slice end-to-end test (M1 exit)  [x] done
- Goal: offline fetch -> raw -> staging -> curated -> validation across two fixture releases, run twice, starting from an empty database (so series rows come from first-sight creation).
- Files: `tests/integration/test_slice_e2e.py`, `tests/fixtures/raw/eurostat/` (second release), `docs/ops/local-development.md`.
- Depends on: T26-T30.
- Acceptance criteria: AC-SYS-2, AC-SYS-3 (second pipeline run: zero new `raw_object`, zero new observations), AC-SYS-4 (one revised key gives exactly one new row, earlier rows untouched, as-of before/after correct), validation results stored, no network, T-DDL-1 complete for M1 objects.
- Tests: `db`.
- Risks: fixture realism; this is the review gate before widening.
- T31 note (data-engineer): `test_slice_e2e.py` passed against Neon (1 passed, 54 s). Second release `une_rt_m_synthetic_r2.json` revises DE 2026-07 (3.2 to 3.3). Fetch uses `fetch_groups` with a mock transport (the `fetch` CLI has no transport seam); migrate/sync-config/load go through the CLI. Fixtures are synthetic (OP-04 capture still open).

## M2 Analytics core

### T32: Full indicator catalog and parameters (L, split by tier M / Q / A / G / X)  [x] done
- Goal: all 80 indicators plus X01-X03 and the 12 domains transcribed from the approved selection with the parameters-spec draft table; every row `review.status: proposed`; draft `release_lag_aware` list (A12, A13, A14, A22, A26, G12); Q06 as z-score only (OQ-15).
- Files: `config/indicators.yaml`, `config/indicator_defaults.yaml`, `config/targets/` (A02 target 0 only), `tests/fixtures/golden/resolved_indicators.csv`.
- Depends on: T09; BL-12 (all `proposed`), OQ-10, OQ-12, OQ-15.
- Acceptance criteria: AC-PAR-1 (golden resolved table, 80 indicators plus X01-X03, no null field), AC-PAR-4 (staleness classes of S:R rows equal D14), AC-PAR-5 (`monotone_good` set equals analytics 4.1), AC-PAR-6 (A02b, A02c, A03, inputs: `alert.method: none` and `descriptive_only`; A02 the only `target_distance`), AC-PAR-10 (no override; A05 resolves `z`, `+1`, `trending_level`), AC-CFG-12; recorded answers applied (Q50 none; Q30(a) M16 in External; M06/M07/M08/G01/A25 `descriptive_only`; Prices therefore descriptive).
- Tests: `unit`.
- Risks: multi-measure rows (Q11, A10, A13, A16, A22) kept single with a note; G11/A26 duplicate left as drafted.

### T33: config-report and coverage gate (S)  [x] done
- Goal: `macro-monitor config-report`: mapped share per indicator, **pending entries reported separately**, unmapped pairs, fallback-only pairs, `known_gap` entries, count and list of `proposed` indicators.
- Files: `src/macro_monitor/registry/report.py`, CLI wiring, tests.
- Depends on: T18, T32.
- Acceptance criteria: AC-CFG-5 (build summary; a change lowering a core indicator's mapped share without `known_gap` fails; pending entries not counted as mapped), AC-PAR-7 gate flag usable by the production workflow, AC-PAR-8 golden check.
- Tests: `unit`, `db`.
- Risks: before M3 most pairs are unmapped; warn-only until T63.

### T34: Migration `analytics`, `analytics_r`, published tables and run view (M)  [x] done
- Goal: `analytics.run` (identity `analysis_run_id`), snapshot with `publish_scope`, `limit_source`, `alignment_reason`, `ref_offset_days`, `value_kind`, rank, alignment, scorecard with peer-set columns, the three `*_published` tables with `publish_scope`, `alert`, `v_alert_published`, `v_indicator_snapshot_published`, `v_run_published` (exactly eight columns), `analytics_r` rules.
- Files: `migrations/0008_analytics.sql`, matrix fixture, tests.
- Depends on: T15, T16.
- Acceptance criteria: T-DDL-12, T-DDL-24 (scope CHECKs, `unaligned_has_reason`, published snapshot view columns and nulls), T-DDL-26 (`v_run_published` columns; `mm_reader` cannot select `params`, `analytics.run`, `ingest.run`, `ops.run_summary`; run-selection query returns no row without an analysis run), T-DDL-28 (distinct increasing ids; explicit id rejected; `mm_ingest` cannot insert; USAGE on the sequence), AC-R-3 (mandatory `analytics_r` columns).
- Tests: `db`.
- Risks: none of the earlier DDL gaps remain; any new need is a design change.

### T35: Migration `ops` public views (S)  [x] done
- Goal: `ops.v_freshness_latest`, `v_run_summary_public` (exact columns, published-scope counts, PROJ excluded), `v_validation_counts`, `v_open_drift`, `v_manual_sources`, `v_backlog`, `v_export_status_latest`.
- Files: `migrations/0009_ops_views.sql`, matrix fixture, tests.
- Depends on: T14, T34, T16.
- Acceptance criteria: T-DDL-29 (withheld source changes no column; `alerts_opened` NULL without an analysis run; imports, inputs, comparison rows and `PROJ` rows not counted; `mm_reader` cannot read `db_bytes`); view finds rows through `raw_load.load_run_id` and `obs_raw`.
- Tests: `db`.
- Risks: owner-rights views (UNVERIFIED on Neon).
- T35 note (orchestrator): owner-rights views verified on Neon. Spec gaps reported, not resolved: (1) `v_manual_sources` cannot show "next expected manual download" (lives in config/release_calendar.yaml, no DB table); (2) exact column sets of v_freshness_latest, v_validation_counts, v_backlog, v_export_status_latest were chosen by the implementer (spec silent), incl. assumed detail keys `n_qualifying`, `state` for COV-01; needs spec confirmation before T64/T86.

### T36: Cutoff transaction and analysis run record (S)  [x] done
- Goal: short transaction taking the load lock and reading `known_cutoff = load_cutoff = clock_timestamp()`; run row via `RETURNING analysis_run_id` with `git_sha`, `config_sha256`, `mapping_sha256`, `overrides_sha256`, `config_asof`.
- Files: `src/macro_monitor/analytics/runctx.py`, tests.
- Depends on: T34, T26.
- Acceptance criteria: AC-ING-15 / T-DDL-20 under `mm_analytics` (waits for a straddling load; runner clock skew +-10 min changes nothing; `transaction_timestamp()` regression guard); mismatched hashes on reproduction are reported.
- Tests: `db`.
- Risks: direct endpoint on Neon; `lock_timeout` failure fails the run by design.
- T36 note (orchestrator): `start_run` takes `ingest_run_id` as an explicit caller input (spec silent on which run). The runner-clock-skew test is weak (code never reads the runner clock). T-DDL-28 explicit-id rejection and mm_ingest insert denial are covered in test_ddl_analytics.py (T34).

### T37: Analytics scenario fixture builder (S)  [x] done
- Goal: builder seeding synthetic multi-entity, multi-vintage databases (ties, stale, lagging, withheld source, MISS, PROJ, import, fiscal-year entity, WEO editions).
- Files: `tests/fixtures/analytics/builder.py`, scenarios.
- Depends on: T32, T34.
- Acceptance criteria: reproduces the spec's worked examples (percentiles 0.875/0.5/0.5/0.125; n=10, pct=70 gives position 7; n=20, pct=55 gives 11); deterministic.
- Tests: `unit`, `db`.
- Risks: shared fixtures hide bugs; tests assert numbers from the specs, not from the builder.

### T38: Transform registry (M)  [x] done
- Goal: `LEVEL`, `YOY`, `YOY_PCT_POINT_CHANGE`, `DIFF12`, `M3M3_ANN`, `QOQ_ANN` (requires SA), `REAL_RATE` ("ex-post real policy rate" note), `SPREAD_VS_REF` with `spread_reference` DEU/USA, M18 labels.
- Files: `src/macro_monitor/analytics/transforms.py`, tests.
- Depends on: T05, T06.
- Acceptance criteria: never MoM/QoQ on NSA; `MISS` input gives an absent period, never zero; `requires_sa` flag consumed by rule 8; AC-AN-11 (M18 label); AC-AN-20 spread parts (M18 mapping without `spread_reference` rejected; DEU/USA no spread); `GLOBAL_LCU_YOY` specified but disabled.
- Tests: `unit`.
- Risks: pure functions are shared with the export (`value_default_tf`, T84); signatures take plain types so they are usable by `publish/` without pandas (AC-DEP-1).

### T39: Denominator transforms with fail-closed guards (M)  [x] done
- Goal: `SUM12_PCT_GDP`, `RESERVE_COVER`, USD stock % GDP; flow-basis guard (no exception), denominator age, inflation/FX guard, single-currency rule, COMP-05 reason codes.
- Files: `src/macro_monitor/analytics/transforms_denominator.py`, tests.
- Depends on: T38.
- Acceptance criteria: AC-AN-7, AC-AN-13, AC-AN-21 (SAAR denominator gives n/a with `annualised_denominator`, not a number four times too small; no `latest_single` path exists), AC-AN-20 (`goods_only` cover gets no 3-month override), AC-VAL-11, support inputs never in snapshots/ranks.
- Tests: `unit`.
- Risks: real mappings blocked by BL-07; logic verified on fixtures only.

### T40: Snapshot and staleness with stored export fields (M)  [x] done
- Goal: per (indicator, entity) snapshot (latest value with a value, age, D14 limit, `limit_source`, `is_stale`, `inherited`, `publish`, `publish_scope`, `value_kind`), MISS/PROJ/import handling, WLD-only global indicators, `release_lag_aware` option.
- Files: `src/macro_monitor/analytics/{snapshot.py,staleness.py}`, tests.
- Depends on: T36, T37, T38, T15.
- Acceptance criteria: AC-AN-22 (MISS neither supplies a value nor resets age), AC-AN-8 (44 entities per country-scope indicator; globals only WLD), AC-AN-12 (limit not stale, limit+1 stale; `release_lag_aware` gives `limit_source = 'release_lag_aware'`), AC-AN-24, AC-SYS-8, AC-AN-25 `publish_scope` clause (withheld -> `excluded`; WLD/descriptive/unranked domain -> `info_only`; else `ranked`).
- Tests: `unit`, `db`.
- Risks: euro-area inheritance (OQ-11): default excluded and flagged.
- T40 note (orchestrator): `transformed_value` computed for single-series transforms only; REAL_RATE/SPREAD_VS_REF/denominator transforms are NULL and must be wired by T44. WEO manifest-based edition resolution and the `Estimates Start After` cross-check (WEO-01) not implemented (T44/T60). `ref.series_map`/`inheritance_rule` read as current rows at run date, not via `fn_config_asof`, so reproduction from an older `config_asof` is not yet exact for mapping changes (check at T44 determinism). Interface: `snapshot.compute_snapshot/write_snapshot/build_rows`; T41 completes alignment fields via `dataclasses.replace` BEFORE `write_snapshot` (table is insert-only).

### T41: Ranking and alignment (M)  [x] done
- Goal: candidates, `rank_reference_period` by integer arithmetic, alignment states, `ref_offset_days`, `alignment_reason = fiscal_year_basis`, mid-rank percentile, `monotone_good`/`target_distance`/`descriptive_only`; one code path for full and published sets.
- Files: `src/macro_monitor/analytics/{alignment.py,scoring.py}`, tests.
- Depends on: T40.
- Acceptance criteria: AC-AN-2 percentile parts, AC-AN-4 (n=10 gives position 7; n=20, pct=55 gives 11; fraction 0.55 rejected), AC-AN-5, AC-AN-14, `reference_period_spread_days` over `aligned`+`ahead`; `ref_offset_days` stored; stale, lagging, inherited excluded.
- Tests: `unit`, `db`.
- Risks: tie equality on stored decimals, not floats.
- T41 note (orchestrator): implementer choices needing spec confirmation: (1) spec parameter `max_lag_vs_rank_period` is stored as `ref.indicator.max_ref_spread_days` (NULL falls back to M 92 / Q 190 / A 366); coverage pct from `params.rank_period_coverage_pct`, default 70; (2) a stale or inherited entity with a usable value gets `ref_offset_days` and is `lagging` beyond max lag, else `n/a`, never ranked (affects `n_unaligned`); (3) target band: distance 0 inside, nearest-edge distance outside; (4) entities whose `transformed_value` is NULL (REAL_RATE, SPREAD_VS_REF, denominator transforms) are `n/a` until T44 wires them. Call order: compute_snapshot, rank_run, write_snapshot(res.rows), write_ranking.

### T42: Scorecards and domains (M)  [x] done
- Goal: `n_defined`/`n_available`, domain eligibility (fewer than 3 ranked is descriptive), concept de-duplication, `low_coverage`, competition rank, **peer-set size and heterogeneity columns**, mean-percentile label.
- Files: `src/macro_monitor/analytics/scorecard.py`, tests.
- Depends on: T41.
- Acceptance criteria: AC-AN-6, AC-AN-9, AC-AN-19 (42/25 -> true; 36/25 -> false; stored min/max equal 25/42 on every row of the domain, both sets), AC-AN-20 (A05/Q08 count once), AC-SYS-7; no composite across domains (D6); T-DDL-24 clause on identical peer-set values per domain.
- Tests: `unit`, `db`.
- Risks: Prices is `descriptive_only` under P13, so few domains rank at first.
- T42 note (orchestrator): needs spec/user confirmation: (1) `core_pillars` (P8, AC-AN-19 clause) NOT implemented: `ref.domain` has no such column; needs migration or ADR; (2) `min_ranked_indicators` is a constant 3 (no `ref.domain` column); (3) domain eligibility is static config (count of configured ranked indicators), so T44 must call `scorecard.demote_ineligible(res.rows, elig, members)` BEFORE `write_snapshot`; (4) `n_ranked_entities` is the domain count on every row incl. low_coverage rows; (5) AC-AN-19 db test uses 3/4 values (25/42 covered in unit test only). T44 call order: compute_snapshot, rank_run, scorecards, demote_ineligible, write_snapshot, write_ranking, write_scorecard.

### T43: Alerts (M)  [x] done
- Goal: windows ending at the previous observation; `z`/`robust_z`/`fixed_only`; minimum observations and confidence; `trending_level` z on DIFF12 with `transform_id` unchanged; `n_eff`; `regime_start`; `persistent_shift` label; reasons; `publish=false` for withheld.
- Files: `src/macro_monitor/analytics/alerts.py`, tests.
- Depends on: T38, T40.
- Acceptance criteria: AC-AN-2 alert parts (239/240 boundary, MAD=0, sd=0, spike larger when excluded), AC-AN-16..18 (the `trending_level` fixture uses `transform: LEVEL`), AC-AN-23 (override mechanism on fixture configs only; none shipped; no override without rationale), AC-AN-10 alert part, MISS absent from the window.
- Tests: `unit`.
- Risks: `percentile` method exists in the enum but is undefined in the spec; implemented only if an indicator uses it (none in the draft); OQ-15.
- T43 note (orchestrator): implementer choices needing spec confirmation: (1) sd is sample (n-1); (2) `regime_start` is a caller-supplied parameter (no DDL column or config exists); (3) n_eff rule implemented for M and Q only (window + current must span >= 5 years); (4) `persistent_shift` is stateless (re-scores the current and two prior observations; reads no earlier alert rows); (5) fixed overrides skipped for stale, below_min_obs, no_window; (6) `percentile` method raises AlertConfigError. T44 must pass `transformed` for REAL_RATE, SPREAD_VS_REF and denominator transforms.

### T44: `analyze` command, published set, determinism (M)  [x] done
- Goal: orchestrate T36-T43, write full and published tables with `publish_scope`, record the run.
- Files: `src/macro_monitor/analytics/run.py`, CLI wiring, golden files `tests/fixtures/analytics/golden/`.
- Depends on: T39, T41, T42, T43, T34.
- Acceptance criteria: AC-AN-1 (byte-identical for same cutoffs/sha/config over natural keys; `analysis_run_id` excluded), AC-AN-10 perturbation (published tables identical when withheld values change), AC-AN-25 (published tables carry the same scope for the same pairs), AC-AN-3 (backtest helper refuses `initial`/`import` as real-time), AC-SYS-6/7/8/11 on fixtures.
- Tests: `db`, `unit`.
- Risks: pandas 3 behaviour (BB13); runtime on 0.5 M rows.
- T44 note: golden `tests/fixtures/analytics/golden/published_set.json` (regenerate with MM_UPDATE_GOLDEN=1). Open spec items carried from T40-T43: WEO edition resolution and `Estimates Start After` cross-check (WEO-01) not implemented (T60); `core_pillars` (P8) needs migration/ADR; `ref.series_map` read at run date not via `fn_config_asof`. Withheld perturbation changes snapshot values but not rank order (monotone map), so the test compares `indicator_snapshot`.

## M3 Widening ingestion, loader hardening, monitoring

### T45: GitHub release archive backend (L, split: draft/publish, assets/bundling, limits)  [~] partial (backend and mock tests done; wiring pending)
- Goal: `RawStore` backend on GitHub releases: draft per run, assets, publish, orphan drafts, continuation release at 900 assets, bundling under 256 KB, 600 uploads/hour, blob reuse only from published releases, `manifest.jsonl`.
- Files: `src/macro_monitor/storage/release_archive.py`, tests with a mock GitHub API.
- Depends on: T21, T19; OP-01 for live runs.
- Acceptance criteria: ADR-003 behaviours; `plan` opens the draft, `finalize` publishes (T75); request count into `ops.run_summary`; draft-asset download (BB18) tested against the mock with a documented fallback; AC-OPS-5 operator-run `network` test (publish then fail to modify an asset).
- Tests: `unit` (mock API); `network` (operator-run).
- Risks: BB6/BB18/BB22; the first run uploads hundreds of blobs against 1,000 requests/hour.
- T45 note (2026-11-04): `storage/release_archive.py` (`ReleaseArchiveStore`, `release_store_from_env`), 18 unit tests with a mock API pass; AC-OPS-5 `network` test written, not run. All endpoint behaviour UNVERIFIED (mock only; BB18 open). Not done (shared modules): `ingestion/archive.py::raw_store_from_env` still raises for `release_public`; `record_fetch` must call `blob_reusable` and `add_manifest_line`; `plan`/`finalize` must call `open()`/`finalize()` and write `stats()` to `ops.run_summary` (T75); total request cap (1,000/h) not enforced, only uploads (600/h). Uses own httpx client, not `HttpClient` (GET-only).
- T45 wiring (2026-11-04): `raw_store_from_env` builds `ReleaseArchiveStore` for `release_public` (run id from arg or `GITHUB_RUN_ID`); `record_fetch` re-`put`s when `blob_reusable` is false; `fetch.py` and `connectors/manual.py` call `collect_manifest_line`; 6 unit tests, 9 db tests pass. **BLOCKER (needs ADR + forward-only migration, user decision):** ADR-003 says a draft-release blob is re-uploaded and recorded as a new append-only row, but `ingest.raw_blob.sha256` is the PRIMARY KEY (0003), referenced by an FK from `raw_object`, with append-only triggers; the insert is `ON CONFLICT DO NOTHING`, so the DB keeps the stale draft `storage_ref`. Options: composite key or a separate `raw_blob_location` table with `get_blob` returning the latest. Must be decided before T75 relies on the rule. CLI does not yet pass `run_id`; plan/finalize are T75.

### T46: Re-estimating groups: snapshots and REV-06 (M)  [x] done
- Goal: `reestimating`, `snapshot_mode: diff_above_tol`, deterministic Parquet snapshot per object, `raw_snapshot`, tolerance rule, `revision_class = 'reestimation'`, REV-06 cap.
- Files: `src/macro_monitor/storage/{snapshot.py,loader.py}`, `validation/checks.py`, tests.
- Depends on: T28, T29, T21; DG-01 (config key names for `snapshot_mode`/materiality; DB and loader logic are not blocked, tests use DB-level group rows).
- Acceptance criteria: T-DDL-15, AC-ING-10 re-estimation clauses, AC-VAL-3 (reestimating group loads with `reestimation` label; above cap blocked), AC-WF-12 first clause (REV-01 not raised, REV-06 reported), I-CUR-7 for snapshot groups.
- Tests: `db`, `unit`.
- Risks: as-of returns the last stored value (documented trade-off); AC-OPS-8 measured in T96.
- Note: loader already had `reestimation` class and BELOW_TOL/`rows_below_tol` (T28); T46 added `storage/snapshot.py` (deterministic pyarrow Parquet, `record_snapshot` -> `ingest.raw_snapshot`), `check_rev_06` (registered, cap from `ref.series_group.max_revised_rows`, blocks with `mass_revision` drift, accepted event releases) wired in `_family_results`; 36 -> 37 checks. 3 new db tests + the 10 existing in test_revision_checks_db.py passed. Not done: calling `record_snapshot` from the fetch leg (needs parsed rows at fetch; T-later connector wiring). Tolerance for ratio units uses `materiality_abs` only. Follow-up: fetch leg now calls `record_snapshot` inside the `stage` callback (same transaction as the raw row) from the parsed observations when `GroupConfig.snapshot_mode == 'diff_above_tol'` (new field, default from `reestimating`/`revision.snapshot_mode` as in `registry.sync.group_row`); 2 unit tests + 1 db test.

### T47: Ordering rules: edition order, out-of-order, imports (M)  [x] done
- Goal: loader step 2a (edition order, ORD-03), step 3 (per-series out-of-order, ORD-01), `import` rows.
- Files: `src/macro_monitor/storage/loader.py`, tests.
- Depends on: T28, T29.
- Acceptance criteria: AC-ING-8 (series with later `known_at` skipped, others load), AC-ING-18 (E2 then E1: E1 `skipped_out_of_order` / `older_edition`, E3 not blocked; `archive_import` loads as `import`, same `edition_date` allowed), T-DDL-17, T-DDL-22 import clauses, I-CUR-10, AC-VAL-13 ORD-03 clause.
- Tests: `db`.
- Risks: terminal skip must not block successors.
- Note: loader already implemented ORD-01/ORD-03/import (T26-T29); T47 added a real-insert db test (E2, E1 skipped, E3 loads, archive_import with same edition_date loads as import). Only the 3 edition/out-of-order db tests were run (pass); I-CUR-10/T-DDL-22 rely on existing DDL/insert tests, not rerun.

### T48: REV-07 report-only check for named-edition groups (S)  [x] done
- Goal: ADR-017 check family: material revisions as share of keys, info under 20 %, warn at or above, never blocks, no `mass_revision` event, stored in `raw_load.detail` and `validation_result`.
- Files: `src/macro_monitor/validation/checks.py`, `storage/loader.py`, tests.
- Depends on: T29, T47.
- Acceptance criteria: AC-VAL-14 (100 % revised edition loads, `revision_class = 'regular'`, REV-07 warn; 10 % gives info; PROJ rows under the new `vintage_label` not counted; same fixture without flags blocked by REV-01; both flags rejected; DB-05 cap still blocks), AC-WF-12 second clause, AC-ING-10 named-edition clause, AC-SYS-17 loader side.
- Tests: `db`, `unit`.
- Risks: severity split is a proposed default.
- Note: `check_rev_07` registered in CHECKS (36 checks) and wired in `OrdinaryChecks._family_results`; loader.py needed no change (revision_class already regular, family/counts already in raw_load.detail; REV-07 evaluated=true). 3 db tests passed (100 % rebase loads and warns, 10 % info with PROJ not counted, DB-05 cap blocks). AC-VAL-14 'same fixture without flags blocked by REV-01' is covered by the existing T29 test; 'both flags rejected' is config/DDL CHECK (not re-tested here). The issue-on-warn is T-later (monitoring).

### T49: Drift events, deferral, `decide` CLI, reload from stored raw (M)  [x] done
- Goal: META-02 drift kinds, `raw_series_status` deferral, `macro-monitor decide` (drift accept/reject, skip object, quality override), loader releases deferrals after acceptance under a new series version created by the same function as first sight.
- Files: `src/macro_monitor/storage/{loader.py,decide.py}`, tests.
- Depends on: T27, T28, T14.
- Acceptance criteria: AC-ING-12, AC-VAL-2, PRECISION-01 and `composition` event, decisions insert-only with `recorded_at`, `decided_by`; ADR-018 clause 4 (new version with `supersedes_series_id`).
- Tests: `db`.
- Risks: acceptance needs a reviewed config commit first (human step).
- T49 note (data-engineer): `storage/decide.py` (decide_drift, skip_object, quality_override), `loader.release_deferred` (called by `drain(maps=...)`), `create_series(version, supersedes_series_id)`, CLI `decide`. Production `RestageFn` (re-parse archived bytes) does not exist yet: without it accepted deferrals stay pending (`restage_unavailable`); to be supplied with T51. db: tests/integration/test_decide_db.py, 8 passed.

### T50: `hash_only` handling (S)  [x] done
- Goal: no bytes stored, retry only from staging within 14 days, `rejected`/`bytes_unavailable`, one-time hash exception.
- Files: `ingestion/archive.py`, `storage/loader.py`, tests.
- Depends on: T21, T26.
- Acceptance criteria: AC-ING-19, T-DDL-7 exception, BKP-02 input lists `hash_only` sources.
- Tests: `db`.
- Risks: accepted loss of replay and backup (Q46 answered).

### T51: `rebuild` and replay (M)  [x] done
- Goal: replay raw into an empty DB with recorded `parser_id`, config at the recorded `git_sha`, recorded outcomes and decisions; "approximate" mode labelled; first-sight series recreation after `sync-config`.
- Files: `src/macro_monitor/storage/rebuild.py`, tests.
- Depends on: T28, T46, T47, T49, T21.
- Acceptance criteria: AC-SYS-5 on archived sources (natural-key equality, I-CUR-7), T-DDL-14 (every manifest `parser_id` resolves), AC-ING-21 rebuild clause, missing prerequisite reported.
- Tests: `db`.
- Risks: needs git history of `config/` at each sha.
- T51 note (data-engineer): `storage/rebuild.py` (`make_restage` production RestageFn, `ConfigAtSha`, `check_prerequisites`, `rebuild`), CLI `rebuild --mode exact|approximate`; `load` and `decide` now pass the production restage. Exact mode refuses when a recorded git_sha is not in local history; approximate reads the working tree and is labelled. `release_deferred` now applies ORD-01 (status `skipped_out_of_order`, still listed by `ingest.v_series_deferred`, which only excludes loaded/rejected). Limits: released deferrals replay with their object, superseding versions and snapshots are not rebuilt. db: tests/integration/test_rebuild_db.py 2 passed, test_decide_db.py 9 passed.

### T52: Series-map seeding tool (M)  [~] partial (tool and known gaps done; reviewed input CSV not supplied)
- Goal: `scripts/seed_series_map.py` converting a reviewed CSV (indicator, entity, source, dataset, key, role, expect, rationale) into `config/series_map/<group>.yaml` and `known_gap` entries.
- Files: `scripts/seed_series_map.py`, `config/series_map/`, `config/known_gaps.yaml`, tests.
- Depends on: T18, T33.
- Acceptance criteria: output validates against rules 8 and 12 and carries `expect` incl. `flow_basis`/`composition` where relevant; known gaps encoded (M07 for 14 non-EU, Q08 non-EU, M18 for ARG/SAU/TUR, A02 25 of 42); idempotent.
- Tests: `unit`.
- Risks: about 3,500 series; review effort, not code; CA-only pairs must be `known_gap` or YoY-only.

### T53: Eurostat full coverage (L, split per dataset group)  [~] partial (connector rules and groups M01, M02, M06, M07, G01, Q08 done offline; M12, Q01, Q05, M18, X01 not mapped; fixtures synthetic, keys [UNVERIFIED])
- Goal: async polling (15 min), 413/size rules, `prc_hicp_minr`, dataset-code drift, all Eurostat-fed groups (M01, M02, M06, M07, G01, M12, M18 where used, Q01, Q05, Q08, X01 where researched), SA groups `reestimating`.
- Files: `ingestion/connectors/sdmx.py`, `config/sources.yaml`, `config/series_map/eurostat_*.yaml`, fixtures.
- Depends on: T23, T46, T52; DG-01 for the SA group policy keys.
- Acceptance criteria: golden parse per group, freshness config, `expected_series_min`; request cells below 500k; COMP-02 baseline; AC-CFG-2; M01 uses `SCA`.
- Tests: `unit`; `network` (operator-run probes).
- Risks: HICP base 2025=100; classification changes.
- Note (done 2026-11-05, partial): `connectors/sdmx.py`: request sizing at `plan` (estimated cells below 500,000, a separate error at 5,000,000; list-valued filters repeated in the query; `c[` params rejected), async polling (15 s doubling to 120 s, 15 min ceiling, same `HttpClient` and host policy, result keyed by the original request), HTTP 413 never retried, 404 and body `extension.id` mismatch logged or errored as dataset-code drift, `RETIRED_DATASETS` (`prc_hicp_manr` -> `prc_hicp_minr`). Groups `eurostat_sts` (M01, M02, both `SCA`, `reestimating: true` with `note` and `revision.max_revised_rows` PLACEHOLDER 5000; defaults of rules 30-31 apply), `eurostat_hicp` (`prc_hicp_minr`, unit I25 = 2025=100), `eurostat_gov_debt` (Q08) with proposed series maps (generated: `scripts/eurostat_proposal_csv.py` then `seed_series_map.py`; 56 + 84 + 27 entries), release-calendar entries equal to `freshness`. SYNTHETIC fixtures and golden parses, COMP-01/COMP-02 baseline test, `network` probe (skipped without `MM_ALLOW_NETWORK=1`): `tests/unit/test_ingestion_eurostat_t53.py`. [UNVERIFIED]: dimension order and category codes, quarterly `sinceTimePeriod=1991-Q1`, the async status body shape, freshness lags.
- Left / open: (1) M12 not mapped: "exports and imports" has one headline per pair and no comparison role (rule 12), design decision needed. (2) Q01 not mapped: indicator transform is YOY but the researched unit `CLV_PCH_PRE` is a growth rate, not a level. (3) Q05 (`bop_c6_q` is in euro millions, indicator is % of GDP), M18 (ECB IRS group exists) and X01 (T62) not mapped. (4) `eurostat_labour` left `reestimating: false` (live group; design Q18 register decision pending). (5) `ref.unit` lacks I21, I25, PC_GDP, MIO_EUR: first-sight creation needs a seed migration or an ADR-backed mapping (precedent migration 0010), not added here to avoid clashing migration numbers. (6) The parser gives `base_period` None and `price_basis` NA, so `expect` omits `base_period`. (7) CLOSED 2026-11-06 by ADR-027 and migrations 0016-0017 (0017 not applied): the group-level `enabled` switch now exists and the three unprobed groups are parked. Original wording: the source is enabled and there is no group-level switch, so the three new unprobed groups are in the fetch matrix; probe each before the next fetch. (8) Stale unit-test expectations (16 tests in test_config_report, test_sync_config, test_ingestion_sdmx, test_ingestion_worldbank that hardcoded 3 labour countries or the old single-indicator World Bank map) updated to the intentionally expanded `eurostat_labour.yaml` (28 countries) and `worldbank_annual.yaml` (5 indicators x 42 countries); config not touched. Final offline results: ruff check clean, ruff format clean (211 files), mypy --strict src clean (81 files), pytest tests/unit 974 passed, 3 skipped (network-marked), 0 failed. Update 2026-11-05: item (5) closed by seed migration `0013_unit_seed_eurostat_t53.sql` (I21, I25, PC_GDP, MIO_EUR; not applied to any database); item (7) stays open because the source schema has no group-level `enabled` and a split into a second source would break the hard-coded `eurostat` source id (sdmx connector, cli) and the shared rate limit, so a design/ADR decision is needed.
- Note (2026-11-06): operator probe OP-04 ran for the parked T53 groups (geo=DE, one request per dataset); results, corrections and open items are in `docs/ops/spike-results.md`, section "Operator probes OP-04 for five parked groups (2026-11-06)".
- Note (2026-11-06, fetch-path follow-up): closed in code and unit tests: async polling reports the final data URL as `resolved_url` (robots gate and manifest) and bounds the whole poll sequence, retry waits included, to 900 s; conditional headers follow the `change_detection` ladder (`archive.conditional_headers`); `estimate_cells` rejects list-valued freq/sinceTimePeriod and ends at max(2035, current year); still open: a delivered cube at or above 500,000 cells only logs a warning (ADR-004 says stay below, it does not require failing), and the live-probe items above.
- Note (2026-11-06, Opus-review round 3): closed: the X02 rationale in `worldbank_support` now says DEU was probed (NY.GDP.MKTP.CD) and the other countries stay [UNVERIFIED]; archive stores `error_class` of failed fetches; the async-poll 900 s bound now has a test that fails without it.

### T54: BIS bulk connector (M)  [~] partial (connector, parser and seed groups M17 and Q06 only; M15, M16, Q07, Q13 and full country sets not configured; fixtures synthetic, URL and layout [UNVERIFIED]; DG-01 open)
- Goal: bulk CSV/zip for M15, M16, M17, Q06, Q07, Q13; Q06 `reestimating` with snapshot.
- Files: `ingestion/connectors/bulk.py`, `parsers/bis_v1.py`, config, fixtures.
- Depends on: T46, T52; DG-01.
- Acceptance criteria: golden parse; file-date change detection; Q06 loads as `reestimation` revisions; gaps (Q06 32 of 42, Bulgaria policy rate) as `known_gap`.
- Tests: `unit`; `network` (operator-run).
- Risks: reclassification becomes drift events; Q06 thresholds OQ-15.
- Note (done 2026-11-04, partial): `connectors/bulk.py` (`BulkConnector`, file-date `update_marker`), `parsers/bis_v1.py` (`bis_v1@1`, registered), source `bis` (disabled) with groups `bis_cbpol` (M17) and `bis_credit_gap` (Q06, `reestimating` with `revision.snapshot_mode`/`materiality_*`: the loader accepts them in the `revision:` block, but DG-01 stays open until the spec names the keys), SYNTHETIC zips incl. a revised r2 [UNVERIFIED URL, layout, columns]. Seed maps hold two countries; M15, M16, Q07, Q13 groups and full Q06/M17 country sets are not configured (no reviewed T52 CSV). `known_gap` Q06 (10 EU members) and M17/BGR exist in `known_gaps.yaml`. Tests: `tests/unit/test_ingestion_bis.py`; `network` probe not written. Integration `test_sync_config_db.py` has 2 count assertions (3 and 2 pending) that fail with the additive shipped sources (eurostat+worldbank+ecb+bis), as flagged in T56.

### T55: World Bank REST connector (S)  [x] done
- Goal: paged REST for annual indicators (A01 fallback, M14 annual fallback labelled `frequency_downgrade`, A10, A11, A14, A16, A22).
- Files: `ingestion/connectors/rest.py`, `parsers/worldbank_v1.py`, config, fixtures.
- Depends on: T52, T19.
- Acceptance criteria: pagination until exhausted, 1 request/s, `..` as declared missing marker, `lastupdated` marker.
- Tests: `unit`; `network` (operator-run).
- Risks: WGI starts 1996; M14 annual never feeds cover or alerts.
- Note (done 2026-11-03): `connectors/rest.py`, `parsers/worldbank_v1.py` (`worldbank_v1@1`), source `worldbank` (disabled, `min_interval_s: 1`), seed map M14 DEU/FRA, SYNTHETIC two-page fixture [UNVERIFIED query syntax, per_page ceiling, page-meta keys]; `fetch_all` pages until `page >= pages`. `network` probe test not written (operator-run, no capture). The `frequency_downgrade` label has no config key yet; it is only in the series-map rationale.

### T56: ECB connector (S)  [x] done
- Note (2026-11-03): `connectors/ecb.py`, parser `ecb_csv_v1@1`, group `ecb_yields` (disabled, synthetic fixture, URL/keys/OBS_STATUS [UNVERIFIED]); network probe not written (operator-run, still open); 6+ config tests hardcoding a single shipped source fail after additive sources (see report).
- Goal: euro-area yields (M18) and reference rates where used.
- Files: `ingestion/connectors/sdmx.py` or `rest.py`, config, fixtures.
- Depends on: T52, T19.
- Acceptance criteria: 503 retried with backoff; `FIXED` vs `CHANGING` composition declared in `expect` and never spliced; golden parse.
- Tests: `unit`; `network` (operator-run).
- Risks: composition rule enforced in config.

### T57: OECD connector (L, split per dataflow)  [~] partial (connector, parser, budget, seed groups kei/prices/cli done offline; source disabled; fixtures synthetic, all layout [UNVERIFIED])
- Goal: whole-dataflow downloads from 1991, no wildcards, no `lastNObservations`, budget 8/hour persisted, `job_timeout_min: 300`; KEI/prices and CLI (M05 `reestimating`).
- Files: `ingestion/connectors/sdmx.py`, `parsers/sdmxcsv_v1.py`, config, fixtures.
- Depends on: T46, T52, T20; DG-01.
- Acceptance criteria: budget respected on a fake clock; remaining requests deferred to catch-up (AC-WF-13 logic); bot challenge gives `blocked` and manual fallback; golden parse of a trimmed KEI fixture.
- Tests: `unit`; `network` (operator-run, at most 1 request).
- Risks: runner IP blocked (BB8); 60 vs 20/hour (BB9); 35 MB responses.
- Note (done 2026-11-05, partial): `OecdConnector` in `connectors/sdmx.py` (wired in `cli._connector`): `plan` makes one whole-dataflow request per dataset (`data/{dataset}/`, `startPeriod=1991-01`, rejects a key segment, wildcards, `lastNObservations`, `UpdatedAfter`, `endPeriod`, a start after 1991); `fetch` uses the shared `HttpClient`, whose persisted hour budget (`rate_limit.budget_per_hour: 8`) gives `rate_limited` (not counted) when used up; a bot challenge gives `blocked`, is never retried and logs the manual fallback (`manual_inbox/oecd/<YYYY-MM>/`, ADR-005); `fetch_budgeted` stops at the first `rate_limited` or `blocked` and returns the remaining requests as `deferred`. Parser `parsers/sdmxcsv_v1.py` (`sdmxcsv_v1@1`, registered). Source `oecd` is `enabled: false` with groups `oecd_kei` (M04, M18 seed USA/JPN), `oecd_prices` (M06 seed ARG/BRA), `oecd_cli` (M05, `reestimating: true`, `revision.max_revised_rows` PLACEHOLDER only, other revision keys at the rule 30-31 defaults), all `job_timeout_min: 300`; series maps `oecd_*.yaml`, release-calendar entries. Licence `unclear` with PROPOSED `archive: hash_only`, `publish_site: withheld` (user to confirm). No new `ref.unit` rows (parser maps IX/PA/PC/PT_B1GQ to IDX/PCT/PCT_GDP), so no migration. Tests: `tests/unit/test_ingestion_oecd.py` (golden parse of the synthetic trimmed KEI fixture `tests/fixtures/raw/oecd/kei_synthetic.csv`; 8-per-hour budget on a fake clock incl. persistence across clients and next-hour catch-up of the 2 deferred; blocked; `network` probe of one request, skipped without `MM_ALLOW_NETWORK=1`). [UNVERIFIED]: `format=csvfile`, column and dimension order, code lists, the `oecd_cli` and `oecd_prices` series keys, `DF_CLI` dataflow id, freshness lags.
- Note (2026-11-06, Opus-review follow-up; `sdmxcsv_v1@1` edited in place because it is unreleased: `oecd` is `enabled: false` and no data is loaded): the parser now fails closed instead of coercing. Unknown `OBS_STATUS` or `ADJUSTMENT`, a non-integer `UNIT_MULT` or an unknown `FREQ` reject the row (PARSE-03; PARSE-02 for `FREQ`; an unknown `FREQ` or `ADJUSTMENT` on a discovery-only series is PARSE-01); a short row is a PARSE-01 `ParseError`; a duplicate (series, period) is PARSE-04; a declared missing marker wins over the non-finite check (NaN with status M gives MISS), and status M with a numeric value is rejected; the source `DECIMALS` column sets `published_decimals` when it is a non-negative integer. PA and PC both map to PCT: a known simplification pending the unit vocabulary (comment in the parser). Golden outputs unchanged; new fixture-free tests in `tests/unit/test_ingestion_oecd.py`. Still open (handled elsewhere): the fetch path and the catch-up gaps.
- Left / open: (1) catch-up SELECTION is not wired: `plan --mode catchup` has no read of this run's `rate_limited` attempts, so a catch-up run re-plans the whole group (the budget still caps it); needs the plan/workflow tasks to pass the deferred set. (2) No manual OECD source or sidecar group exists; the fallback is a log message and the existing manual-inbox convention. (3) No operator probe was run; the source stays disabled. (4) M03/M12/Q01/Q05/M02 OECD series are not mapped (no reviewed T52 CSV; Q01 unit and M12 comparison role issues as in T53). (5) `ref.unit` has no mapping for other OECD unit codes (passed through unchanged). (6) Config tests with hardcoded source and group lists were extended (`test_sources_config.py`, `test_sync_config.py`).
- Note (2026-11-06, fetch-path follow-up): closed in code and unit tests: stop-and-defer in `fetch_group` (blocked skips the rest; rate_limited defers the rest with `rate_limited`/`deferred` attempts and the group is not ok, exit 10), catch-up ordering (`order_for_catchup`, deferred and never-attempted first, then least recently attempted), atomic hour/day budget acquire (`BudgetStore.try_acquire`), explicit `error_class` redirect_refused, 413 never retried, 256 MiB body cap; still open: the Postgres `try_acquire` SQL and the attempt-history query are only covered by a db test not yet run (needs MM_TEST_DATABASE_URL), catch-up still re-fetches requests that already succeeded this month, and the real-source probe items above.
- Note (2026-11-06, Opus-review round 3): closed: an unknown `OBS_STATUS` is parsed as OBS with the raw flag in `source_flags` (as in the ECB, BIS and FAOSTAT parsers), `DECIMALS` accepts ASCII digits only, one short row failing the dataflow is recorded as by design, the fetch summary prints the deferred and skipped request keys, and the 900 s poll bound plus a real-table `load_attempt_history` test and a two-thread `try_acquire` race test were added (the last two are `db` tests, written but not run without a database). Intentionally left: the exit-10 mapping for budget deferrals, the catch-up matrix selection, `change_detection` in the worldbank/bulk connectors (decision pending), and the concurrency and history `db` tests still need a run against a database.

### T58: Bulk-file connectors (L, split per file)  [~] partial (all four files and AMECO done offline; sources disabled; fixtures synthetic, all layouts and URLs [UNVERIFIED]; no network probe; seed series only)
- Goal: Pink Sheet XLSX (M24, G02), FAO files (G02, G03, G12), EC survey ZIPs (M03, M04), AMECO via DBnomics REST only for A02c.
- Files: `ingestion/connectors/bulk.py`, `parsers/{xlsx_rows,pinksheet,fao_ffpi,fao_csdb,fao_stat,ecsurvey,ameco}_v1.py` (the single `fao_v1` became `fao_ffpi_v1`, `fao_csdb_v1`, `fao_stat_v1`), config, fixtures.
- Depends on: T52, T21.
- Acceptance criteria: one frozen parser version per file layout; layout assertions fail closed; FAO cereal brief: our copy is the only vintage; golden tests; `publish_site`/`archive` explicit.
- Tests: `unit`; `network` (operator-run).
- Risks: layout drift; DBnomics client is AGPL (direct REST only).
- Note (done 2026-11-05, partial): `connectors/bulk.py`: `BulkConnector(source_id)` now serves BIS plus `worldbank_pinksheet`, `fao`, `faostat`, `ec_surveys` (`BULK_SOURCES`; XLSX gets `update_marker` from `Last-Modified` only), and new `DbnomicsConnector` (direct httpx REST to `v22/series/AMECO/AVGDGP`, no AGPL client; `limit` required, no paging: a truncated page is `PARSE-01`). Frozen parsers (all registered, all layout assertions fail closed with PARSE-01): `pinksheet_v1`, `fao_ffpi_v1`, `fao_csdb_v1`, `fao_stat_v1`, `ecsurvey_v1`, `ameco_v1` (one module per file layout, so `fao_v1.py` of the Files line is split in three), shared guarded reader `xlsx_rows.py` (openpyxl, already approved in ADR-004; no new dependency). Sources (all `enabled: false`, no group-level key) with groups `pinksheet_monthly` (M24 Brent headline, G02 food price index fallback), `fao_ffpi` (G02 headline), `fao_csdb` (G03 world, marketing year 1 Jul-30 Jun, `calendar_basis MKTYR`, `archive: public` because our copy is the only vintage), `faostat_sofi` (G12, 3-year averages stored at the centre year, flag in `source_flags`; own source `faostat` because the host differs), `ec_bcs_monthly` (M03 industry confidence, M04 consumer confidence), `dbnomics_ameco_gap` (A02c, `role: headline` of its own indicator); series maps, release-calendar entries. Licence `unclear` (PROPOSED `archive: hash_only`, `publish_site: withheld`, user to confirm): Pink Sheet, EC surveys, DBnomics; FAO `allowed` (CC BY 4.0 + FAO terms), `public`/`public`, user to confirm. Migration `0014_unit_seed_t58_bulk_files.sql` (USD_BBL, USD_MT, USD_MMBTU, PCT_POT_GDP; not applied). Tests: `tests/unit/test_ingestion_bulk_t58.py` (golden parse per file on the synthetic fixtures built by `scripts/make_t58_fixtures.py`, layout drift per parser, plan/fetch, config policy); expectations of `test_sources_config.py` and `test_sync_config.py` extended. [UNVERIFIED]: every URL (Pink Sheet carries a rotating hash segment, set to `PROBE_REQUIRED_HASH`), sheet/column/member names, unit spellings, flag letters, DBnomics response shape and series codes, freshness lags.
- Left / open: (1) No `network` operator probe exists for any T58 source; all five stay disabled. (2) One headline per (indicator, entity) (ADR-009): M24 and G02 are composites (Brent, gas, food index; agricultural and fertilizer prices); only one series each is mapped, the rest of the Pink Sheet columns are parsed if listed but not mapped; design decision needed. (3) G03 is `scope: country` but the free source is world-only: mapped to WLD; the 42 country pairs need `known_gap` entries (T63) or an indicator-scope decision. (4) [STALE: resolved by ADR-028 discovery (T64)] The cereal-brief file name changes monthly (`csdb-data-2026-10.xlsx`); `{dataset}` is a fixed placeholder month, a stable-URL or date-token mechanism needs a design decision. (5) `is_comparison` is not set on A02c in `indicators.yaml`, so `role: comparison` is not possible; A02c uses `headline`; AMECO forecast years cannot be told from outturn in the DBnomics response (all `OBS`). (6) M03 maps the EC industry confidence balance (the ESI is an index); confirm. (7) A 3-year average at its centre year and `<2.5` censored SOFI values (rejected rows, not loaded) are conventions to confirm. (8) Series maps hold seed sets only (no reviewed T52 CSV); M24 full commodity set, 42-country G12/M03/M04/A02c coverage not configured.
- Note (2026-11-06, Opus-review follow-ups): parsers are unreleased (all five sources `enabled: false`, no data ever loaded), so they were fixed in place. Total uncompressed cap lowered 512 MiB -> 64 MiB (`xlsx_rows`, `ecsurvey_v1`), FAOSTAT member cap 4 GiB -> 256 MiB, zip member cap 100, zip errors (encrypted, unsupported compression, zlib, EOF) map to `PARSE-01`, `fao_stat_v1` closes its ZipFile; AMECO also requires `len(docs) == num_found`, rejects duplicate `series_code` and parses floats as `Decimal`; tests in `tests/unit/test_bulk_safety_t58.py`. A formula cell without a cached value is still skipped as blank (documented by a test). Open user decisions: AMECO forecast/outturn cut-off (A02c must stay out of snapshots/alerts until decided; all values are `OBS`), `reestimating` for AMECO and EC surveys, the G12 `<2.5` marker, G03 definition/`known_gap`, FAOSTAT flag `F` meaning [UNVERIFIED].
- Note (2026-11-06, Opus-review round 3): closed: a duplicate `series_code` of an unmapped AMECO series now raises PARSE-01, the Decimal-to-`published_decimals` behaviour (1.50 gives 2) is pinned by a test, `is_xlsx` returns False for every zip-level failure, zlib/EOF branches of the FAOSTAT and EC survey parsers are tested (ZipFile.open/read monkeypatched; a real corrupt deflate stream is not deterministic), and the FAOSTAT text wrapper is closed explicitly.

### T59: Manual connector, inbox, sidecars, `ingest-manual` CLI (M)  [x] done
- Goal: `manual_inbox/<source_id>/<YYYY-MM>/` ingest with `.meta.yaml`, `edition_label`/`edition_date`, `import_label`, reminder rules.
- Files: `ingestion/connectors/manual.py`, `registry/config.py` (rules 11, 18), `manual_inbox/.gitkeep`, tests.
- Depends on: T47, T21, T07.
- Acceptance criteria: AC-CFG-8 (day 26 rejected, day 25 with `to_day=24` passes, sidecar without `edition_date` rejected, `import_label` other than `archive_import` rejected), same queue and lock as scheduled loads, path allow-list, manual source carries no `rate_limit`/`http`/`change_detection`.
- Tests: `unit`, `db`.
- Risks: committed files stay in git history.
- Done note: unit + 2 db tests pass; rule 11 and the manual rule 4 were already in config.py (T07), rule 18 added; `ingest-manual --group G [--path P]` imports then drains the group; the real WEO parser is T60 (db test uses a stub parse); a manual source with several groups would share one inbox (no group key in the sidecar spec).

### T60: WEO parser and named-edition group config (M)  [ ] todo
- Goal: parse the first real WEO file; `Estimates Start After` gives EST/PROJ; WEO-01 fail-closed; group `imf_weo_files` with `reestimating: false`, `edition_ordered: true`.
- Files: `ingestion/parsers/weo_v1.py`, `config/sources.yaml` (`imf_weo_manual`), `config/series_map/imf_weo.yaml`, fixture trimmed from the real file.
- Depends on: T59, T48; BL-08, OP-05.
- Acceptance criteria: BB7/BB23 recorded in `docs/ops/spike-results.md`; fixture without the attribute gives A02 n/a plus a `schema_drift` event (WEO-01); AC-CFG-9 on the real config; `expected_series_min` set from the real file; revisions of a rebasing edition loaded, never blocked (AC-VAL-14 on the real-file fixture).
- Tests: `unit`, `db`.
- Risks: if `NGAP_NPGDP` is absent A02 cannot be fed: user decision on D22/D23.

### T61: A02 estimate boundary and A03 handling in analytics (S)  [ ] todo
- Goal: latest WEO edition from `raw_object`, last EST year = earliest PROJ year of the latest label minus one, `value_kind = 'estimate'`; A03 descriptive only.
- Files: `analytics/snapshot.py`, tests.
- Depends on: T40, T60.
- Acceptance criteria: AC-AN-15 including the two-edition fixture and "committing WEO-2026-04 after WEO-2026-10 does not change the latest edition"; AC-SYS-6 (A02b/A02c never in ranks or export); `value_kind` stored.
- Tests: `db`.
- Risks: depends on edition-order enforcement (T47).

### T62: Support series X01-X03 and M14 monthly reserves mapping (L)  [~] partial
- Goal: sources and series maps for X01, X02, X03 and a monthly reserves route.
- Files: connectors/config per the approved research.
- Depends on: T52, T39; BL-07, OP-06.
- Acceptance criteria: each X01 series carries `flow_basis` (`PERIOD_FLOW` required for quarterly sums); COMP-05 reasons exercised on real fixtures; M14 and cover remain n/a with `known_gap` until a route exists.
- Tests: `unit`; `network` (operator-run).
- Risks: blocked until research is approved; scope unknown.
- Note 2026-11-05: Done offline: series maps `worldbank_support` (X01 annual fallback, X02; 84 series) and `eurostat_gdp_q` (X01 headline, 27 series), all `flow_basis: PERIOD_FLOW`; seed migration 0015 (not applied); M14 and X03 `known_gap` entries, RESERVE_COVER stays n/a; COMP-05 reasons tested in `tests/unit/test_support_series_t62.py` on synthetic values (no recorded GDP fixtures exist before the operator probe). Open: both groups sit in already-enabled sources (`worldbank`, `eurostat`) and the schema has no group-level switch, so they enter the fetch matrix unprobed (same as T53 item 7: needs an ADR/decision); X03 and the monthly reserves route not mapped; `network` probe pending (operator-run). Unit: 1064 passed, 4 skipped.
- Note (2026-11-06): operator probe OP-04 ran for `eurostat_gdp_q` and `worldbank_support` (geo=DE / DEU, one request per dataset or indicator); see `docs/ops/spike-results.md`, section "Operator probes OP-04 for five parked groups (2026-11-06)".
- Note (2026-11-06, Opus-review follow-up): the group-level switch now exists (ADR-027) and both groups stay parked; the DE/DEU probe was done 2026-11-06 (other geos unverified). When the ADR-021 `frequency_downgrade` key is implemented it must be added to the 42 X01 WDI fallbacks (`worldbank_support`). Conflict raised for design: AC-AN-7 versus ADR-009/ADR-021 I-FD-2. Latent issues before M13 is mapped: a null `currency_code` on the national-currency X01 series and the unit scale being ignored (CP_MNAC is million national currency; the parser leaves `unit_mult` at 0). Tests now include a fixture-chained COMP-05 case from the recorded DE bytes, a strict known-gap coverage check (M14/X03 42 entities each, X01 15 non-EU) and a parsed check that migration 0015 seeds CP_MNAC with ON CONFLICT DO NOTHING. For an `at` far past 2026-Q3 the default guard returns `denominator_age`; `missing_or_stale` appears only with a looser `max_denominator_age_days`.

### T63: Coverage reconciliation gate (S)  [ ] todo
- Goal: every core (indicator, entity) pair mapped or `known_gap`; make the AC-CFG-5 gate blocking.
- Files: `config/known_gaps.yaml`, CI config, `docs/ops/coverage-notes.md`.
- Depends on: T53-T58, T60, T62, T33.
- Acceptance criteria: AC-CFG-5 reads 100 % of core pairs mapped or `known_gap` (pending entries not counted); "28 core" claim restated with measured coverage.
- Tests: `unit`.
- Risks: review of about 3,500 series.
- Note (2026-11-05): G03's 42 country pairs need `known_gap` entries, because the free FAO source is world-aggregate only (T58 note, open item 3).

### T64: Monitoring: freshness, run summary, heartbeat writer (M)  [x] done
- Goal: release-aware freshness states, `ops.freshness_state`, `ops.run_summary` (incl. `runner_clock_offset_ms`), heartbeat JSON.
- Files: `monitoring/{freshness.py,run_summary.py}`, heartbeat writer, tests.
- Depends on: T29, T14, T32.
- Acceptance criteria: AC-VAL-4 (12-case table incl. quarter ends and WEO months), FRESH-01/02, group state rules, `known_stale`, MISS counts as published for feed health, no data values in heartbeat.
- Tests: `unit`, `db`.
- Risks: depends on `release_calendar.yaml` quality.
- T64 note: unit (22 freshness/heartbeat) and 3 db tests pass on Neon. Not done: explicit `dates:` calendar entries (format unspecified, raises CalendarError); CLI wiring (functions exposed). `known_stale` is passed in by the caller.

### T65: GitHub Issues helper (S)  [x] done
- Goal: open/comment/close by title key, cap 20 new per run with `[summary]`, labels, `if: failure()` helper.
- Files: `monitoring/issues.py`, tests.
- Depends on: T19, T29.
- Acceptance criteria: AC-VAL-5; no secrets or values in bodies; at most 20 ids listed.
- Tests: `unit`.
- Risks: `GITHUB_TOKEN` 1,000 requests/hour.
- T65 note (done 2026-11-04): `monitoring/issues.py` (`GitHubIssues`, `sync_issues`, workflow-failure helpers), 6 unit tests with `httpx.MockTransport`; ruff, mypy --strict, pytest pass. Not done: retry/backoff and rate-limit handling; pagination beyond 100 open issues untested; GitHub endpoints and `state_reason` UNVERIFIED against a live API; nothing calls the module yet.

### T66: Monitoring: DB budget, backlog, order checks, FRESH-03 (S)  [x] done
- Goal: DB-01..03, DB-02 projection, LOAD-01, ORD-01..03 reporting, FRESH-03 reminders.
- Files: `monitoring/{db_budget.py,backlog.py}`, tests.
- Depends on: T47, T64, T65.
- Acceptance criteria: AC-VAL-7 (sizes 600..800 MB trigger projection warning), AC-VAL-8 (backlog 0.5 d, 2 d, 41 d), AC-VAL-10 (no issue on 24 October, issue on 25 October, escalation after 45 days; April likewise).
- Tests: `unit`, `db`.
- Risks: 12-month projection from 6 samples is noisy.
- T66 note (done 2026-11-04): `monitoring/db_budget.py` (DB-01..03), `monitoring/backlog.py` (LOAD-01, ORD-01..03, FRESH-03); 13 unit and 6 db tests pass on Neon. Judgement calls (spec silent): MB = 1024*1024 bytes; DB-02 projection needs >=3 monthly samples, least-squares line over last 6, evaluated 12 months out; DB-02 history read from `ops.validation_result` (`check_id='DB-02'`, `subject='size'`); FRESH-03 evaluates only the current year's occurrence; "edition present" = manual `raw_object` with `edition_date` on/after the first of the release month. Not done: CLI/workflow wiring and `sync_issues` call; `reminders_from_config` untested on the real `config/sources.yaml`.

### T67: Monitoring: COV-01, MON-NMAR, BKP-02 (S)  [x] done
- Goal: stale-on-arrival diagnostic excluding `initial` loads, `cov_min_entities` 10, `not_yet_measurable`; missing-not-at-random report; list of unbacked sources.
- Files: `monitoring/coverage.py`, tests.
- Depends on: T64, T50.
- Acceptance criteria: AC-VAL-9 (a)-(d), AC-AN-24 monitoring side, BKP-02 lists `hash_only` and withheld sources, MON-NMAR never changes ranks, BKP-01 not evaluated.
- Tests: `unit`, `db`.
- Risks: annual indicators take years to become measurable.
- T67 note (done 2026-11-04): `monitoring/coverage.py` (`cov_evaluate`/`record_cov01`, `nmar_evaluate`/`record_nmar`, `record_bkp02`); unit tests plus 4 db tests pass on Neon. Not done: MON-NMAR "lagging" (no definition in spec), `release_lag_aware` limits passed as `limit_overrides` (OQ-10), CLI/workflow wiring, status view unchanged. 20 pp NMAR threshold is `proposed`.

## M4 Public dump, workflows and operations

### T68: `pubdump` schema, views and completeness test (M)  [x] done
- Goal: `pubdump.v_p_public_source` and one view per dump target with explicit column lists and order keys, redactions (`raw_load.detail`, `drift_event` old/new/note, `drift_decision.note`, `quality_override.reason`), explicit exclusion list.
- Files: `migrations/0010_pubdump.sql`, matrix fixture, `tests/integration/test_pubdump_views.py`.
- Depends on: T15, T16, T35.
- Acceptance criteria: AC-DUMP-6 (every table of the seven schemas is a view target or in the exclusion list; view columns equal the non-generated table columns), AC-DUMP-7 and T-DDL-10 rows (only `mm_ingest` can SELECT `pubdump.v_*`; nobody can write), T-DDL-31, T-DDL-11 view clause (`v_observation_public` returns none of the `hash_only`/withheld fixture rows); from this task on every table-adding migration must keep AC-DUMP-6 green.
- Tests: `db`.
- Risks: owner-rights views on Neon (UNVERIFIED); later migrations break the test by design until updated.
- T68 note (done 2026-11-04): migration is `0011_pubdump.sql` (0010 was taken by `0010_unit_seed_pc_act.sql`); 26 target views plus `v_p_public_source`, each with a COMMENT carrying target and order key for T69. `test_privileges.py` `NOT_YET_CREATED` narrowed to `analytics_r.*`; `expected_matrix.csv` unchanged. 12 db tests pass on Neon (unpooled host; the pooled endpoint rejects the `statement_timeout` startup parameter in conftest). Owner-rights read-through is only indirectly exercised (`mm_ingest` already has base-table SELECT). Writer order key and manifest are T69.

### T69: Dump writer: CSV, schema.sql, manifest, parts (M)  [x] done
- Goal: `macro-monitor backup --profile public`: one `REPEATABLE READ READ ONLY` transaction, per-view gzipped CSV (`COPY ... CSV HEADER`, fixed session settings, gzip level 9, mtime 0), `schema.sql` as byte-exact migration concatenation, `manifest.json` (hashes, row counts, `load_order`, `sequences`, `trigger_tables`, `sources`), parts at `max_rows_per_part`.
- Files: `src/macro_monitor/storage/dump.py`, `src/macro_monitor/storage/schemas/public-dump-manifest.schema.json`, tests.
- Depends on: T68, T10.
- Acceptance criteria: AC-DUMP-1 (awkward values round-trip: NULL vs empty string, `2.10`, embedded newlines, jsonb quotes, DST timestamps), AC-DUMP-8 (identical `sha256_csv` across runs; parts in order-key order), AC-DUMP-9 (`schema.sql` equals the migration concatenation; applies to an empty DB; checksum mismatch fails restore step 5); any profile other than `public` rejected (AC-WF-10 clause).
- Tests: `db`.
- Risks: dump timing and size on Neon; BB19 narrowed to the `psql` client version.
- T69 note (done 2026-11-04): `storage/dump.py`, `storage/schemas/public-dump-manifest.schema.json`, `backup --profile public` in `cli.py` (other profiles rejected, exit 20); 7 db tests pass on Neon (AC-DUMP-1, -8, -9, profile clause). The checksum-mismatch test covers the writer side only (a modified applied migration raises `MigrationMismatch` at dump time); the restore-step-5 checksum failure belongs to T71. NULL vs empty string is tested on `ref.series.base_period` (`ref.unit.description` is NOT NULL). Dump size/time on production volumes and other Postgres versions UNVERIFIED.

### T70: Dump self-check and licence filter (M)  [x] done
- Goal: BKP-03 output self-check re-reading the written files; fail closed with no release.
- Files: `src/macro_monitor/storage/dump_check.py`, tests.
- Depends on: T69.
- Acceptance criteria: AC-DUMP-2 (byte search of decompressed CSV, `schema.sql`, manifest for distinctive values of `hash_only` and withheld fixture sources finds nothing; redacted columns empty), AC-DUMP-3 (broken view or unredacted `detail` exits non-zero and no release), AC-VAL-15, AC-WF-10 (`hash_only` fixture valid and absent from the dump; `private` with null repo invalid; no workflow references `RAW_PRIVATE_TOKEN`), AC-SYS-12, T-DDL-11.
- Tests: `db`.
- Risks: this is the main licence gate for the dump (R34).
- T70 note (done 2026-11-04, verified by orchestrator): `storage/dump_check.py` (`check_dump`, `assert_dump_ok`, `discard_dump`; re-reads written files only), `cmd_backup` runs it after `write_dump`, discards output, marks the run `failed`, exits 30 (BKP-03). 9 db tests (Neon) and 751 unit tests pass; ruff, mypy --strict clean. Not done: AC-DUMP-3 mock-release-API assertion and the `pipeline` issue (publisher is T72; it must call `assert_dump_ok`); runtime on production volumes unmeasured. Judgement calls: NULL and empty string are indistinguishable in csv so redaction checks accept either; `drift_decision.note` also checked; unknown `raw_id` treated as restricted.

### T71: Restore procedure and round trip (M)  [~] partial (code written; blocked by spec defect on seeded `ref.unit` rows)
- Goal: `macro-monitor restore-test` running exactly the dump spec section 6 steps with `psql`, `gzip`, `sha256sum` only: verify hashes, apply `schema.sql`, disable user triggers per table, `\copy` in `load_order`, reset sequences, verify counts and migration checksums, re-run the writer and compare.
- Files: `src/macro_monitor/storage/restore.py`, `scripts/ci/restore.sh`, `tests/integration/test_restore_invariants.py`.
- Depends on: T69, T70, T51; OQ-08/OP-11; OQ-17 (BB29).
- Acceptance criteria: AC-DUMP-4 (restore into an empty container with `psql` only; counts equal; `GENERATED ALWAYS` identity columns load via `\copy`), AC-DUMP-5 (`db_invariants`: same `sha256_csv` after re-dump), AC-WF-14 (job without `pg_restore`/`pg_dump` on the path succeeds; a changed manifest hash fails before any SQL runs), invariant suite after step 5 for `P-public` sources only, no `analytics.*` content restored.
- Tests: `db_invariants`, `db`.
- Risks: BB29 fallback needs a new ADR; BB19 psql client version.
- T71 note (2026-11-04): `storage/restore.py`, `scripts/ci/restore.sh`, `restore-test` CLI hook, 13 db tests in `tests/integration/test_restore_invariants.py`; psql 18.6 (libpq via brew). BLOCKER, reported not worked around: migration `0001_ref.sql` (and `0010`) seed `ref.unit`, so step 2 (`schema.sql`) creates rows that step 3 `\copy ref.unit` then duplicates (`unit_pkey`); every real dump fails. Needs an ADR/spec decision: (a) step 3 clears seeded tables first (plain DELETE, TRUNCATE fails on the FK), (b) writer excludes migration-seeded rows from `v_ref_unit`, or (c) seeds `ON CONFLICT DO NOTHING` plus tolerant `\copy`. With a temporary DELETE workaround 12 of 13 tests passed: BB29 holds on Neon (identity columns load via `\copy`), counts and constraints OK, AC-DUMP-5 identical `sha256_csv`, hash tampering fails before SQL. As committed the db suite does not pass. Not done: restore.sh run, production volumes, T79 parts.

### T72: Dump release publication (S)  [x] done
- Goal: publish `db-dump-public-<YYYY-MM>` (suffix `-r<run_id>` if the tag exists) through the draft-then-publish path, only after the self-check.
- Files: `src/macro_monitor/storage/release_archive.py` (extension), tests.
- Depends on: T70, T45.
- Acceptance criteria: AC-DUMP-10 (assets exactly the manifest files plus the manifest; tag rule incl. suffix; mock API; operator-run immutability check via AC-OPS-5), BKP-03 failure publishes nothing and opens a `pipeline` issue.
- Tests: `unit` (mock API); `network` (operator-run).
- Risks: asset count about 25-40 against the 900-asset limit.
- T72 note (done 2026-11-04, verified by orchestrator): `ReleaseArchiveStore.publish_dump` and `publish_dump_or_alert` in `storage/release_archive.py`; `assert_dump_ok` runs before any API call, draft-then-publish, asset set must equal manifest files + `manifest.json`, suffix `-r<run_id>` when the tag exists (publisher rewrites manifest `dump_id` to the tag), draft deleted on failure, `[pipeline]` issue on self-check failure. 9 mock-API unit tests pass. Not done: AC-OPS-5 network test for the dump (operator-run); nothing calls it yet (T75 wiring needs `GITHUB_TOKEN`, repo, run id/url). UNVERIFIED (mock only): git-ref 404 semantics, draft DELETE, single-shot upload of 15-35 MB files, asset names with `.`. Asset names map `/` to `__` (`upload_name`); T71 restore must map them back.

### T73: migrate.yml (S)  [x] done
- Goal: dispatch-only migration workflow under the owner role.
- Files: `.github/workflows/migrate.yml`.
- Depends on: T10, T03; OP-02, OP-07.
- Acceptance criteria: input via `env`, validated; takes the migrate lock; fails on checksum mismatch; prints versions; actionlint clean; only `NEON_URL_MM_OWNER`.
- Tests: `unit` (workflow scan); actionlint.
- Risks: secret exposure limited to the step.
- T73 note (done 2026-11-04, verified by orchestrator): `.github/workflows/migrate.yml` + `scripts/ci/migrate.sh`; actionlint clean, 11 workflow-security unit tests pass. The `migrate` CLI has no target option, so `target_version` accepts `latest` or the highest file version only (partial migration would need a spec/ADR change). Not run on Neon or dispatched (OP-02, OP-07 open).

### T74: monthly-refresh.yml: plan, fetch matrix, load and analyze (L)  [~] partial (workflow and tests done; CLI gaps block a real run)
- Goal: triggers (`23 4 1 * *`, `23 4 4 * *`, dispatch with `dry_run`), concurrency group, `plan`, `fetch` matrix (max-parallel 4, per-leg timeout from `job_timeout_min`), `load` + `analyze` (analytics step uses `NEON_URL_MM_ANALYTICS`), optional `r-analysis` gate.
- Files: `.github/workflows/monthly-refresh.yml`, `scripts/ci/*.sh`.
- Depends on: T30, T44, T45, T73; OP-02, OP-03.
- Acceptance criteria: AC-WF-2 (dry run changes nothing), AC-WF-3 (forced failing leg; catch-up retries only that group and loads backlog from stored raw), AC-WF-11, AC-WF-13 (OECD leg 300 min, others 120), each step sees only its own secret, `ubuntu-24.04` pinned, AC-OPS-1.
- Tests: `unit` (workflow scans); `db` (dry-run CLI path); operator-run dispatch.
- Risks: scheduled runs can be dropped; first-run request budget (BB22).
- T74 note (2026-11-04): `.github/workflows/monthly-refresh.yml` + `scripts/ci/monthly_refresh.sh` (plan, fetch, load, analyze); jobs `plan`, `fetch` (matrix, max-parallel 4, `timeout-minutes: matrix.job_timeout_min`), `load` (drain, then `analyze` under `NEON_URL_MM_ANALYTICS`), `r-analysis` gate (placeholder step, no R modules yet). actionlint clean; unit workflow scan + script tests; one `db` test of the dry-run plan path. CLI gaps: no `fetch`/`load` `--dry-run` (a dry run therefore only plans: matrix and load groups are emptied, `sync-config` skipped); `plan` ignores catch-up semantics (returns all enabled groups, no failed/skipped-this-month filter) and does not open the draft raw release (T45 TODO); no raw-release publish command (T75); `fetch` has a connector only for eurostat; `load --drain` ignores `--groups`; wave-2 API-key secrets not wired; `sources.yaml` has eurostat `enabled: false` so the matrix is empty until OP-04. Not dispatched.

### T75: monthly-refresh.yml: finalize and site job (M)  [ ] todo
- Goal: publish release, `monitor`, `export`, `record-export`, heartbeat, monthly public dump (T69-T72), optional (a0) enable call; `site` job deploying the artifact.
- Files: `.github/workflows/monthly-refresh.yml`, `scripts/ci/`.
- Depends on: T74, T64-T67, T72, T86 (export), T88 (site); OP-01, OP-09.
- Acceptance criteria: AC-WF-8 (only the (a0) step holds `WORKFLOW_ENABLE_TOKEN`, non-fatal), AC-WF-9 (export sees only the reader URL, record-export only the ingest URL, site none), heartbeat push failure warns only (BB26), previous site stays on export failure (AC-EXP-2), backup step runs `--profile public` only and publishes only after BKP-03, AC-OPS-2.
- Tests: `unit` (env-block lint); operator-run.
- Risks: BB1, BB11.

### T76: ingest-manual.yml (S)  [~] partial (workflow and tests done; CLI gaps block dispatch)
- Goal: push to `manual_inbox/**` and dispatch ingest.
- Files: `.github/workflows/ingest-manual.yml`.
- Depends on: T59, T45, T73.
- Acceptance criteria: AC-WF-4 (concurrent with refresh leaves a consistent database, staging intact), AC-WF-7 for the `path` input, commit comment with row counts, ORD-03 applied by the loader.
- Tests: `unit`; `db` (concurrency scenario is AC-ING-9 in T26).
- Risks: heartbeat commits must not retrigger (path filter).
- T76 note (2026-11-04, verified by orchestrator): `.github/workflows/ingest-manual.yml`, `scripts/ci/ingest_manual.sh` (plan/run/summary), 10 unit tests; actionlint, ruff, mypy clean, 805 unit tests pass. `path` input via env and validated (regex equals `settings.INBOX_PATH_PATTERN`), only `NEON_URL_MM_INGEST`. Spec/CLI gaps, reported not worked around: (1) `ingest-manual` prints no `LoadCounts`, so the commit comment shows object counts, not row counts; (2) no CLI step publishes the release (drafts wait for the next `finalize`); (3) `sync-config` not run first, need unverified. Also: group resolution from changed path is new logic (spec silent); no manual source is enabled until T60, so a push to the inbox fails with exit 2. Shell paths (`plan` group resolution, push diff, `run`) never executed; shellcheck not installed. Not dispatched.

### T77: preflight.yml and network probes (M)  [ ] todo
- Goal: `41 5 25 * *` probes, dataset-code drift, terms/robots age (warn at 330 days), WEO reminders.
- Files: `.github/workflows/preflight.yml`, `tests/integration/test_probes.py` (`network`).
- Depends on: T53, T59, T65; OP-04.
- Acceptance criteria: at most 1 OECD request; reminders fire at the first preflight on or after `remind_on`; writes no raw object and does not touch `request_state`; `source-drift` issues.
- Tests: `network` (operator-run), `unit` (reminder logic).
- Risks: probes hit live services only when the user asks.

### T78: decide.yml (S)  [x] done
- Goal: dispatch-only human decisions, then `load --drain`.
- Files: `.github/workflows/decide.yml`.
- Depends on: T49, T73.
- Acceptance criteria: inputs only via `env` and validated (AC-WF-7 injection test: `x; echo INJECTED` executes nothing); `decided_by = github.actor`; column-restricted UPDATE.
- Tests: `unit`.
- Risks: same role as the loader (accepted).
- T78 note (done 2026-11-04, verified by orchestrator): `.github/workflows/decide.yml` + `scripts/ci/decide.sh`; inputs only via `env:` with allow-list validation, `decided_by = github.actor`, only `NEON_URL_MM_INGEST`; actionlint clean, 26 tests incl. AC-WF-7 injection. Added a `raw_id` input (needed by `skip_object`; spec list silent). Not run on Neon or dispatched; column-restricted UPDATE is T49's layer. OP-02, OP-03, OP-07 open.

### T79: restore-test.yml (S)  [ ] todo
- Goal: quarterly (`17 6 15 1,4,7,10 *`) restore of the latest public dump into a Postgres service container, invariants, sample rebuild comparison.
- Files: `.github/workflows/restore-test.yml`.
- Depends on: T71, T51; OP-11.
- Acceptance criteria: AC-OPS-3 on the first dump; AC-WF-14; natural-key comparison for public/public sources; no Neon owner secret; failure opens a `restore-test failed` issue.
- Tests: `db_invariants`.
- Risks: BB19, BB29.

### T80: ci.yml completion and workflow lint scans (M)  [ ] todo
- Goal: all CI jobs (lint-type, unit, db, config + config-report, workflow-lint with dispatch-input and env-secret scans, export-and-site, r when changed).
- Files: `.github/workflows/ci.yml`, `scripts/ci/scan_dispatch_inputs.py`, tests.
- Depends on: T03, T33, T73-T79, T86.
- Acceptance criteria: AC-WF-7 (fails on `${{ inputs.* }}`/`github.event.inputs.*` in `run:` or `script:`), AC-WF-9 lint, SEC-01 secret scan, AC-WF-5 (dummy-secret log grep), AC-CFG-12 and AC-PAR-7 report wired into CI.
- Tests: `unit`.
- Risks: false positives on trusted contexts.

### T81: Operator runbooks (S)  [ ] todo
- Goal: `docs/ops/monthly-check.md` (five checks), manual WEO download, decide workflow, dump restore, spike procedures, recovery from a disabled schedule.
- Files: `docs/ops/{monthly-check.md,manual-weo.md,decisions.md,restore.md,recovery.md}`.
- Depends on: T59, T71, T75, T78.
- Acceptance criteria: monthly check lists the five checks of workflows spec section 9; AC-WF-8 (check in repo docs); no secrets.
- Tests: link check in `unit`.
- Risks: WEO release months stay [UNVERIFIED].

## M5 Export and dashboard

### T82: Export framework (M)  [x] done
- Goal: one read-only `mm_reader` session, run selection through `analytics.v_run_published`, deterministic writers, manifest, JSON Schemas.
- Files: `src/macro_monitor/publish/{export.py,manifest.py,schemas/}`, tests.
- Depends on: T34, T44, T16, T17.
- Acceptance criteria: AC-EXP-9 (runs 5, 6 for ingest run 10 and 7 for run 11: supplied 10 gives `analysis_run_id` 6 with matching cutoff and code version; supplied 12 fails EXP-10 and deploys nothing), AC-EXP-5 (one session; duration and bytes in `export-status.json`), EXP-10, sorted keys, fixed Parquet settings (pyarrow only, no pandas), EXP-08 determinism.
- Tests: `db`, `unit`.
- Risks: none of the earlier run-metadata gaps remain.
- Note (T82): unit 20 passed, db 3 passed (AC-EXP-9 incl. supplied 12, AC-EXP-5, EXP-08, reader privileges); ruff and mypy --strict clean for publish/. Not covered (T86): EXP-02..07, size budgets, record-export. Parquet `created_by` is pyarrow's fixed string. `bytes_read` is the text size of returned values. Repo-wide `mypy --strict src` fails only in another task's ingestion/parsers/bis_v1.py.

### T83: Meta, scorecard, alerts, status JSON (M)  [~] partial
- Goal: `meta/*` (series metadata from `ref.v_series_export` plus config-sourced `published_precision`/`source_url` at the run's `git_sha`), `scorecard/<domain>.json`, `alerts.json`, `status.json` copying stored published-scope fields.
- Files: `publish/{meta.py,scorecard.py,status.py}`, tests, `tests/fixtures/export/`.
- Depends on: T82, T42, T43, T35, T64.
- Acceptance criteria: AC-EXP-6 (no `modal_ref_period_end`; `lagging`/`unaligned` percentile null; label beside every `percentile_rank`), AC-EXP-7 (WLD only in `global`; support indicator X01 absent from every file incl. `meta/*`, no `is_support` key, `value_default_tf` still computed), AC-EXP-10 (`status.json.last_run` equals `v_run_summary_public`), AC-EXP-11 (stored fields passed through; static check that they are never assigned from other fields), AC-EXP-12 file side (no `vintage_resolution`/`release_cadence_note`), EXP-03 git-sha check.
- Tests: `db`, `unit`.
- Risks: the export must not derive fields the DDL stores.
- Note (T83): unit 18 passed (`tests/unit/test_publish_t83.py`), db 2 passed (`tests/integration/test_publish_meta_scorecard_db.py`: one test with builder scenario + `analyze`, then export under `mm_reader`; one for `alerts_opened` null); T82 db tests still 3 passed; repo-wide unit 873 passed, 2 skipped (network); ruff check, ruff format --check and `mypy --strict src` clean. Met: AC-EXP-6, 7 (file side of T83 files), 10, 11 (incl. static check), 12 (file side), EXP-03 git-sha check (`ConfigTree.verify`, `git show` at the run's sha, no working-tree fallback), EXP-08 for these files. Partial because: (1) the `value_default_tf` clause of AC-EXP-7 belongs to `series/*` (T84); (2) `status.json.groups[].load_result` is always null: no `mm_reader` view exposes per-group load results (`ops.run_summary.groups` is unreadable), spec gap; (3) COV-01 in `status.json` carries state, `n_qualifying`, `n_results`, `n_failed` only: `ops.v_validation_counts` has no stale-on-arrival share; (4) `ops.v_backlog` is one aggregate row, so backlog is a top-level block, not per group, and its age is exported in whole days because the view uses `now()` (EXP-08). Choices (accepted by the user after T83; kept in T84): `ref.v_series_export` has no group column, so `published_precision` is found through the series-map files of `config/sources.yaml` at the same sha, keyed by `(source_id, series_key)`; `iso3` = entity id for countries (no column); group `name` = group id (not stored anywhere); `unit_label` = unit codes (`ref.unit` unreadable by `mm_reader`); `transform_options` fixed `[level, default, yoy]`; `staleness_limit_days` = class limit; `notes[]` holds only the fixed M18 wording (config `notes` are internal and not copied); comparison indicators (`is_comparison`) are left out of `meta/*`; entities without a scorecard row (informational domains, WLD) still appear with null counts; `status.json` and `alerts.json` top-level shapes and `schedule_check.generated_at` (passed in, equals the manifest `generated_at`) are the implementer's. CLI wiring of the producers is T86.

### T84: Series files (M)  [~] partial
- Goal: `series/<indicator>.parquet` incl. `value_default_tf` through the shared transform code and `v_input_obs_published`.
- Files: `publish/series.py`, tests.
- Depends on: T82, T38, T39, T15.
- Acceptance criteria: AC-EXP-3 series-file clause, AC-EXP-8 (`MISS` as null with `value_status`, import rows absent), no `PROJ` rows (EXP-02), EXP-04 row counts, `1991-01-01` start.
- Tests: `db`, `unit`.
- Risks: size (first load about 3-6 MB estimated).
- Note (T84): `publish/series.py` (`series_producer`; `snapshot.SINGLE_TRANSFORMS` is the public alias of the shared single-series transform table). Met: AC-EXP-3 series clause, AC-EXP-8, EXP-02 (no PROJ, import, input, comparison or withheld rows), EXP-04 row counts (manifest `rows` = file rows), `1991-01-01` start (transforms computed on the full history first), EXP-08 (two exports byte-identical), `value_default_tf` and `value_yoy` through `analytics.transforms`. Partial because the multi-input transforms (`REAL_RATE`, `SPREAD_VS_REF`, `SUM12_PCT_GDP`, `RESERVE_COVER`; M13, M14, M18, G04) export `value_default_tf = null`: `mm_reader` cannot read what `run.derive_series` needs (series `currency_code`, `ref.indicator_input`, indicator `params`; `v_series_export`/`v_headline_obs_published` carry no currency; `spread_reference`, `cpi_indicator_id`, `fx_regime_flag`, `lcu_currency` are analyze options, not database state), so the `value_default_tf` clause of AC-EXP-7 for M13 stays open (design gap: needs a view/column exposure or an ADR). Also: the published views are latest-vintage, not as-of, so the producer fails closed (EXP-10) if any row is newer than the run's `known_cutoff`/`load_cutoff`; `ops.quality_override` is unreadable, so `suspect`-flag overrides are not applied as in analytics. Tests: unit 3 (`tests/unit/test_publish_t84.py`), db 2 (`tests/integration/test_publish_series_db.py`; with T82/T83 db files 7 passed). Repo-wide unit 876 passed, 2 skipped (network); ruff check, ruff format --check, `mypy --strict src` clean. CLI wiring done in T86.

### T85: Revision files, recent list and edition summaries (M)  [~] partial
- Goal: `revisions/<indicator>.parquet` from `v_revision_history` (columns incl. `is_base_version`, `edition_ordered`, `revision_abs/pct`), `revisions_recent.json` with `revisions[]` (ordinary groups, cap 2,000) and `edition_summaries[]`.
- Files: `publish/revisions.py`, tests.
- Depends on: T82, T15.
- Acceptance criteria: AC-EXP-3 revision clauses, AC-EXP-13 (a)-(h) (5,000-key WEO rebase absent from `revisions[]`, one summary with `n_series = 25`, `n_keys_revised = 5000`, top 10; PROJ rows never counted; withheld edition gives no summary), AC-EXP-14 (A03 has no revision file; A05 file has no `PROJ` row; key K base version; negative control with a view that includes `PROJ` fails EXP-02/EXP-04), no input/comparison series in revision files.
- Tests: `db`, `unit`.
- Risks: edition identity when `vintage_label` is null (UTC date of `known_at`).
- Note (T85): `publish/revisions.py` (`revisions_producer`), schema `schemas/revisions-recent.schema.json`. Met: AC-EXP-3 revision clauses, AC-EXP-13 (a)-(f), (h) (unit scale test: 5,000 keys / 25 series gives one summary, `n_keys_revised` 5000, top 10; 3,000 ordinary rows cut at 2,000; db fixture with PROJ years in every edition, withheld edition with no summary and no value in any byte), AC-EXP-14 (a)-(d), no input/comparison/withheld/PROJ rows, EXP-08 (two exports byte-identical). Edition identity with null `vintage_label` = UTC date of `known_at` (also written as the summary's `vintage_label`). Choices: `v_revision_history` has no size columns, so `revision_abs`/`revision_pct` (pct = change / abs(previous) * 100, null if previous is 0 or either side NA) and `previous_value` are computed in the export; versions with `known_at` after the run's `known_cutoff` are dropped and the base version/two-version rule re-evaluated on the rest; "last 12 months" = 365 days before `known_cutoff`; edition `source_id` from `ref.v_series_export` by `series_id` (current-date mapping filter; a series missing there fails closed). Partial because: AC-EXP-13(g) (V4 smoke test) is T88. AC-EXP-14(e) (negative control) and AC-EXP-14(f) were closed in T86 (see the T86 note). Tests: unit 5 (`tests/unit/test_publish_t85.py`), db 2 (`tests/integration/test_publish_revisions_db.py`); with T82-T84 db files 9 passed. Repo-wide unit 881 passed, 2 skipped (network); ruff check, ruff format --check, `mypy --strict src` clean. CLI wiring done in T86.

### T86: Export checks, budgets, record-export, leak test (M)  [~] partial
- Goal: EXP-01..10, budgets (5/20 MB file, 100/250 MB data, 300 MB site), `export-status.json`, `record-export` CLI.
- Files: `publish/checks.py`, CLI wiring, tests.
- Depends on: T83, T84, T85, T14.
- Acceptance criteria: AC-EXP-1 (EXP-01..10 on the fixture DB, golden manifest), AC-EXP-2 (forced failure leaves the previous site), AC-EXP-4 (byte search over all files; perturbation of every withheld value leaves all files byte-identical), AC-EXP-5, AC-SYS-11, AC-SYS-14, EXP-07.
- Tests: `db`, `unit`.
- Risks: the leak test is the licence-compliance gate.
- Note (T86): `publish/checks.py` (EXP-01..07, 09, 10 and the size budgets as a `Checker` for `run_export`; EXP-08 is the optional second producer pass `verify_determinism`), `publish/record.py` (`record-export`), `Finding`/`CheckReport`/`Checker` and the `checker`/`verify_determinism` parameters in `publish/export.py`, CLI commands `export` (all six producers, config read at the run's `git_sha`, checker and determinism pass on), `record-export --status-file` and `check-site --site-dir` (300 MB site budget; the `site` job calls it in T88), `test_database_b` fixture in `tests/conftest.py`, golden manifest `tests/fixtures/export/golden_manifest_t86.json` (regenerate with `MM_UPDATE_GOLDEN=1`). Met: AC-EXP-1 (EXP-01..10 all `pass` on the fixture DB; golden manifest paths, formats and rows match), AC-EXP-2 (failed check or EXP-08 or budget breach: no `data/`, `export-status.json` status `failed` with the findings, a build in another directory untouched; the workflow-side "previous site stays" and the `pipeline` issue belong to the workflow task), AC-EXP-4 (a) byte and decoded-Parquet search for withheld raw values and for the withheld snapshot value, transformed value, deviation, z and percentile at several precisions (tokens of at least 5 characters), (b), (c) (public U2 percentiles equal the mid-ranks of 3 public pairs, `n_ranked` 3), (d) perturbation over two databases with every withheld value changed: all files byte-identical, `manifest.json` and `revisions_recent.json` compared without `known_cutoff` (database clock, the only value that differs between two databases), (e) `mm_reader` denied on `analytics.indicator_snapshot/scorecard/indicator_rank/alert/run`, (f) no `old`/`new`/`detail` key in `status.json`; AC-SYS-11; AC-EXP-5 and AC-SYS-14 (one session; duration and bytes read in `export-status.json`; `record-export` under `mm_ingest` inserts one `ops.export_status` row; `mm_reader` INSERT denied; a reader DSN cannot record; the export itself writes 0 rows); EXP-07 (scanner for connection URLs, bearer, GitHub, AWS and private-key patterns and credential assignments, over JSON bytes and decoded Parquet strings; reports the pattern name, never the match; `record-export` refuses a status file that matches); budgets 5/20 MB per file, `series/*` 40 MB and `revisions/*` 20 MB warn, `data/` 100/250 MB, site 300 MB (MB = 1,000,000 bytes; unit tests with synthetic sizes). Closed from T85: AC-EXP-14(e) (negative control: `curated.v_revision_history` replaced by a view that includes `PROJ` fails EXP-02 and EXP-04; the EXP-04 reference counts repeat the `PROJ` and comparison exclusions on purpose) and AC-EXP-14(f) (`status.json.last_run.revisions` equals the count of public non-`PROJ` revision rows of the scenario, 13, against 21 with `PROJ`; the builder writes no `ingest.raw_load` rows, so the test inserts them). Tests: unit 20 (`tests/unit/test_publish_t86.py`), db 1 (`tests/integration/test_publish_checks_db.py`, two throwaway databases, about 6 minutes on Neon, `timeout(1800)`); with the T82-T85 db files 10 passed (825 s). Repo-wide unit 901 passed, 2 skipped (network); ruff check, ruff format --check, `mypy --strict src` clean. No workflow file changed (actionlint not run). Partial because: (1) AC-EXP-1 "golden manifest" covers paths, formats and row counts, not hashes (Parquet bytes depend on the pinned pyarrow); (2) EXP-05 compares the scorecard, alignment, peer-set and alert fields with the published-scope rows, but not `alert_confidence`/`level` of scorecard cells beyond what is stored in `percentile`/`n_ranked`/alerts.json; (3) EXP-02 "no support-input value in any file" is checked by series ids and indicator ids, and by the byte search of the fixtures only for the leak test, not by value in production; (4) whole-site 300 MB budget exists as `check-site` but is not yet called by a workflow (T88/T89); (5) the open gaps below are unchanged and not worked around: `mm_reader` cannot read `ref.unit`, `ops.quality_override`, `ref.indicator_input`; multi-input `value_default_tf` stays null; `status.json` `groups[].load_result`, COV-01 stale-on-arrival share and per-group backlog.

### T87: Site toolkit spike AC-DASH-0 (M)  [~] partial
- Goal: from fixture exports build a scorecard page and an explorer page in Actions and deploy to Pages; measure gzip and `Accept-Ranges`; record the outcome for an ADR-010 update.
- Files: `site/` (spike), `docs/ops/spike-results.md`.
- Depends on: T86 (fixture exports), OP-01.
- Acceptance criteria: preferred toolkit first; on failure ADR-010 fallback order; result written for the user; no further site work before OP-10.
- Tests: `unit` (build check on fixtures).
- Risks: BB10, BB11.
- Note (T87): A1 (Observable Framework 1.13.4 + Plot 0.6.18, parquet-wasm 0.9.0) builds a scorecard page and an explorer page from a synthetic fixture export (`tests/fixtures/site_spike/make_export.py`; no recorded export tree exists and the `export` CLI needs a database) and both render in headless Chrome; Parquet read in the browser works on the fixture. `site/` has pinned `package.json`/`package-lock.json`, git-ignored `node_modules`, `dist`, `src/data`. Unit build check `tests/unit/test_site_spike.py` (4 tests; the build test skips without node, `site/node_modules` or the Observable import cache). Findings: build fetches npm imports from jsDelivr once; default theme loads Google Fonts (disabled via `globalStylesheets: []`); ADR-016 does not yet approve the Framework. Partial because Pages deployment, gzip and `Accept-Ranges` measurement, Playwright/Chromium and a run on a real export are [UNVERIFIED] (need OP-01 and a push); A2/A3 not tried. Results and manual steps: `docs/ops/spike-results.md` (section T87). ADR-010 not edited; decision is OP-10/BL-10. ruff, ruff format --check, mypy --strict src clean; unit 905 passed, 2 skipped.

### T88: Site shell, data loading, stale banner (M)  [~] partial
- Goal: layout, manifest loader (refuses unknown major), per-source attribution, stale banner on `known_cutoff` older than 45 days, no off-origin calls.
- Files: `site/`.
- Depends on: T87; BL-10, OP-10.
- Acceptance criteria: AC-DASH-7 (banner on `known_cutoff`), AC-DASH-1 first part, landing view at most 1.5 MB gzipped (AC-DASH-2 part).
- Tests: JS unit; smoke in T94.
- Risks: toolkit decision.
- Note (T88): `site/src/lib/` (`manifest.js` refuses an unknown major, `stale.js` 45 days on `known_cutoff`, unreadable cutoff counts as stale, `attribution.js`, `shell.js`), pages `index.md`/`explorer.md` use them; `globalStylesheets: []` kept; `site/.nvmrc` 20.18.1; `docs/ops/spike-results.md` (section "Site shell"), `docs/ops/site-dependency-exceptions.md`. Met: AC-DASH-7 (banner logic, JS unit boundary tests; not run in a browser with a stale fixture), AC-DASH-1 first part (manifest refusal in loader and `prepare-data`; no off-origin URLs in `dist/`; headless Chrome renders both pages without error on the synthetic fixture), landing view 218,281 bytes with real `gzip -9` over 49 files (limit 1,500,000; `site/scripts/measure-landing.mjs`). P1 (ADR-023): Plot 0.6.18 and d3 7.9.2 are exact-pinned direct deps and bundle from `node_modules`; P1 cannot cover Framework's default imports (htl, isoformat, Arrow, parquet-wasm, flatbuffers, tslib stay jsDelivr-fetched), so P2 is added for `dist/_npm`: `site/npm-imports.lock` (7 entries) plus `scripts/check-npm-imports.mjs`. Framework licence: ISC (package metadata). npm audit: 3 low, 4 moderate, 0 high/critical, all build-only, ids recorded, no exception needed, `audit fix` not run (`scripts/audit-gate.mjs` tested with a stubbed report). Tests: JS 14 passed (`node --test`), unit file `tests/unit/test_site_spike.py` 6 passed (build test ran, not skipped); repo-wide unit 907 passed, 2 deselected (network); ruff check, ruff format --check, `mypy --strict src` clean. Partial because: (1) the CI `site` job that runs `npm ci`, `npm test`, the build, `measure-landing`, `check-npm-imports`, `audit-gate` and `check-site` is not written (workflow files out of this task's write scope; C1, C7 wiring open; actionlint not run); (2) `.github/dependabot.yml` npm entry for `/site` (AC-NPM-5) not added (outside allowed paths); (3) Node pin is 20.18.1, the only version installed; Node 20 is believed end-of-life since April 2026 [UNVERIFIED], move the pin to a current LTS by PR; (4) landing size measured on the synthetic fixture, not a real export (C3) and not with Pages compression (C2); (5) lock hash stability on a clean CI runner and `npm ci --ignore-scripts`/licence listing of the shipped tree not checked; (6) no AC-NPM-3 Playwright assertion (T94).

### T89: V1 country scorecards (M)  [~] partial
- Goal: per-domain scorecard views from `scorecard/<domain>.json`.
- Files: `site/`.
- Depends on: T88, T83.
- Acceptance criteria: AC-DASH-4 (stale with flag and no rank; n/a at zero availability; agri/markets/global unranked; descriptive indicators without percentile; low-coverage domain shows mean percentile and n/N without position), "mean percentile of the domain's indicators" label, standing caveat, heterogeneous-peer-set note.
- Tests: JS unit; smoke.
- Risks: the browser never recomputes ranks (D6).
- Note (T89): wording choices and the domain-list landing CONFIRMED by the user on 2026-11-04 (recorded in `docs/ops/spike-results.md`). `site/src/lib/scorecard.js` (view-model, display only, D6), `scorecard-view.js`, `meta.js`; pages `site/src/index.md` (domain list, caveat) and generated `site/src/domain/<id>.md` (`prepare-data` writes them from `domainPageSource()`; git-ignored); `scripts/lib.mjs` `landingSet` now follows `../` references. Fixture generator `tests/fixtures/site_spike/make_export.py` rewritten to the real file shapes (`{schema_version, <key>}` meta wrappers, `meta/domains.json`, full manifest and scorecard fields) with 4 domains: labour (stale, zero availability, low coverage, lagging, descriptive, aggregate, heterogeneous peer set), prices (inherited, target_distance), agri and global (unranked). Met: AC-DASH-4 on the fixture (stale with flag and no rank; n/a at zero availability; agri/global unranked; descriptive without percentile; low coverage shows mean and n/N without position), label and standing caveat on every domain page and the landing page, heterogeneous-peer-set note; headless Chrome renders labour, agri and prices without error. Landing sizes (real gzip -9): `index.html` 31,495 bytes, `domain/labour.html` 212,834, `explorer.html` 289,639 (limit 1,500,000); `check-npm-imports` 7 files match, `npm-imports.lock` unchanged; no new dependencies, no off-origin URL in `dist/`. Tests: JS 32 passed (`node --test`, 0 skipped), `tests/unit/test_site_spike.py` 8 passed (build test ran, not skipped; 2 new: fixture matches the published JSON schemas, fixture covers the AC-DASH-4 cases); repo-wide unit 909 passed, 2 skipped (network); ruff check, ruff format --check, `mypy --strict src` clean. Partial because: (1) spec gaps, not worked around: the spec fixes no wording for the heterogeneous-peer-set note, the stale/descriptive/unranked cell texts, and "n/N" and "position" are read as `n_available/n_defined` and `rank_position of n_ranked_entities` (chosen wording recorded in `docs/ops/spike-results.md`); the spec lists the landing view set as "manifest + meta + one domain scorecard + status", while Framework needs a static page per domain, so the landing page lists domains and each domain page carries its scorecard (both measured); (2) not built: `peer_group_percentile`, the CI `site` job and Dependabot entry (separate step), a browser test in CI (T94); (3) the render check in Chrome was manual, not automated; the automated built-page check asserts the pages, data files, sizes, P2 lock and no off-origin URLs; (4) the export CLI output was not used (needs a database), the fixture is hand-written.

### T90: V2 peer comparison (S)  [~] partial
- Goal: indicator table/chart with peer-group filter (filter only), `reference_period_spread_days`, `lagging`/`unaligned` marks.
- Files: `site/`.
- Depends on: T89.
- Acceptance criteria: AC-DASH-9, "percentile vs all ranked countries" label, M18 wording for non-euro countries.
- Tests: JS unit; smoke.
- Risks: optional `peer_group_percentile` not built.
- Note (T90): `site/src/lib/peers.js` (view-model: filter, sort, stored spread, marks), `peers-view.js`, generated pages `site/src/peers/<domain>.md` (`peersPageSource()` in `scripts/lib.mjs`, written by `prepare-data`, git-ignored; linked from the V1 domain page); controls are plain selects read with `Generators.input` (no Inputs import). Met: AC-DASH-9 on the fixture (`reference_period_spread_days` with the stored common reference period, limit and n shown; lagging and unaligned entities shown with value, marked, percentile null), the exact label "percentile vs all ranked countries", the standing caveat, the M18 non-euro wording (exported `notes[]` verbatim plus a per-row mark for countries outside `euro_area`), the group filter filters and sorts only (the rendered stored percentile of a row is identical with and without the filter; `peer_group_percentile` not built; static guard against arithmetic). Fixture generator: `meta/groups.json`, entities JPN/IND/POL, lagging USA, unaligned fiscal-year IND, domain `fin` with M18; T89 fixture had a percentile on a lagging entity, now null per AC-EXP-6. Landing (real gzip -9): `peers/labour.html` 216,622 bytes, `peers/fin.html` 216,099, `domain/labour.html` 213,417, `index.html` 31,617 (limit 1,500,000); `check-npm-imports` 7 files match, `npm-imports.lock` unchanged; no new dependency, no off-origin URL. Tests: JS 45 passed (`node --test`, 0 skipped; 13 new in `site/tests/peers.test.mjs`), `tests/unit/test_site_spike.py` 9 passed (build test ran, not skipped; 1 new fixture test, build test extended to the peers pages and their size); repo-wide unit 910 passed, 2 deselected (network); ruff check, ruff format --check, `mypy --strict src` clean. Partial because: (1) the select-change re-render was not exercised in a browser (headless Chrome `--dump-dom` shows the initial state of `peers/labour` and `peers/fin` without errors; interaction needs T94 Playwright); (2) new wording needs user confirmation (group labels, sort labels, filter note, row mark "non-euro: see the note above", spread sentence, empty-group text; listed in `docs/ops/spike-results.md`); (3) spec gaps recorded there (no V2 layout in the spec; group ids `euro_area`/`non_euro_eu` differ from the proposed `peer_group_percentile` keys `ea`/`eu_non_ea`; non-euro wording is per indicator in the export, the per-row mark is derived); (4) CI `site` job and Dependabot entry remain a separate step; fixture is hand-written, not real export output. User confirmation (2026-11-04): the user confirmed the V2 wording choices listed in `docs/ops/spike-results.md` (section "V2 peer comparison (T90)": group labels, sort labels, filter note, row mark, spread sentence, empty-group text), so partial reason (2) is closed; reasons (1), (3) and (4) remain.

### T91: V3 time-series explorer and rebase (M)  [~] partial
- Goal: selectors over per-indicator Parquet (DuckDB-Wasm or JSON fallback via manifest `format`), display-only rebase, markers for current alerts only.
- Files: `site/`.
- Depends on: T88, T84.
- Acceptance criteria: AC-DASH-6 (rebase equals Python reference within 1e-9), AC-DASH-5, NSA series offers no MoM/QoQ, one interaction fetches at most 5 MB.
- Tests: JS unit; smoke.
- Risks: Wasm memory on mobile (desktop-first).
- Note (T91): `site/src/lib/explorer.js` (view-model), `explorer-view.js`, `rebase.js`; `src/explorer.md` is generated by `prepare-data` (`explorerPageSource()` in `scripts/lib.mjs`, git-ignored) with one lazy `FileAttachment` per manifest `series/*.parquet|json` file, called in the page; `scripts/measure-explorer.mjs`. Selectors indicator, countries, transform (Level / Indicator default / Year-on-year), year range, display-only rebase with base period; markers from `alerts.json` only; NSA series offer no MoM/QoQ default; `loadSeries` refuses a file above 5,000,000 bytes. C6 recommendation recorded in `docs/ops/spike-results.md` (section "V3 time-series explorer and rebase (T91)") for the user: keep Arrow + parquet-wasm, DuckDB-Wasm not added. Met: AC-DASH-6 (JS rebase equals the Python `Decimal` reference within 1e-9 on `tests/fixtures/site_spike/rebase_golden.json`, 20 cases, 349 numbers compared; `tests/unit/test_rebase_golden.py` fails if the file drifts), AC-DASH-5 (caption table per plotted series), AC-DASH-4 NSA rule, current-alert markers. Fixture series files now use the real `build_table` / `parquet_bytes` writer (dictionary columns, 3 row groups), plus P01 (NSA, default M3M3_ANN) and 3 alerts. Measured (real gzip -9): `index.html` 31,665 bytes, `domain/labour.html` 213,515, `peers/labour.html` 216,725, `explorer.html` first load 290,418 (limit 1,500,000); reader libraries 1,818,762 gz / 5,536,481 raw (wasm 5,254,537 raw), loaded lazily once; one series file 3,238 gz on the fixture and 712,644 bytes for a 44 x 420 realistic file (limit 5,000,000 per interaction). `check-npm-imports`: lock updated from 7 to 6 entries (`isoformat` no longer imported because the page no longer uses `Inputs`; other hashes unchanged); no new dependency, no off-origin URL. Headless Chrome (DevTools protocol, throwaway script): explorer renders on the fixture and on the realistic file; changing indicator, transform, rebase and countries re-rendered, selecting an indicator fetched exactly its one parquet file, no errors, no off-origin request. Tests: JS 60 passed (`node --test`, 0 skipped; 14 new in `site/tests/explorer.test.mjs`, 1 new in `scripts.test.mjs`), `tests/unit/test_site_spike.py` 10 passed (build test ran, not skipped), `tests/unit/test_rebase_golden.py` 3 passed, repo-wide unit 914 passed, 2 deselected (network); ruff check, ruff format --check, `mypy --strict src` clean. Partial because: (1) the Playwright smoke is T94 (interaction was only exercised ad hoc in headless Chrome; Firefox, Safari, mobile and memory not tested); (2) the user must decide C6, the new wording and the spec gaps listed in `docs/ops/spike-results.md` (no Python rebase in `src/`, rebase of a zero or negative base, JSON series layout, per-transform unit, raw wasm 5.5 MB against the 5 MB wording if Pages does not gzip); (3) the CI `site` job and Dependabot entry remain a separate step; fixture values are synthetic, not real export output. User decisions (2026-11-04, stated in session): C6 ACCEPTED (keep Arrow + parquet-wasm, DuckDB-Wasm not added); the 5 MB per-interaction limit is counted on the GZIPPED size for now; the T91 wording and the listed spec gaps are CONFIRMED/ACCEPTED (recorded in `docs/ops/spike-results.md`), so partial reason (2) is closed; reasons (1) and (3) remain.

### T92: V4 vintage and revision view (M)  [~] partial
- Goal: `revisions_recent.json` landing with ordinary list then one line per edition, per-indicator revision files, `reestimation` vs `regular` filter, vintage history for a chosen series, FIXED vintage text, "earliest stored version" label, revised-data notice.
- Files: `site/`.
- Depends on: T88, T85.
- Acceptance criteria: AC-EXP-12 site side (fixed text present; neither "first release" nor "first stored release" anywhere), AC-EXP-13(g) (edition line below a non-empty ordinary list), re-estimation revisions distinguishable, headline series of scored indicators only.
- Tests: JS unit; smoke.
- Risks: none from the former BL-04.
- Note (T92): `site/src/lib/revisions.js` (view-model), `revisions-view.js`; `src/revisions.md` is generated by `prepare-data` (`revisionsPageSource()` in `scripts/lib.mjs`, git-ignored) with one lazy `FileAttachment` per manifest `revisions/*.parquet`, called in the page. Landing = `revisions_recent.json`: ordinary list first (export order), then one line per edition ("WEO-2026-10: 12 keys revised in 2 series, largest change 41.7 %, median 5.5 %"); class filter all / regular / re-estimation with re-estimation rows marked; vintage history per series (indicator select starts empty, so no revision file or Wasm is read until chosen; series and reference-period selects; one file per interaction, refused above 5,000,000 bytes); FIXED vintage text exactly as spec section 7 (a JS test compares it to the spec file); base version labelled "earliest stored version"; revised-data notice; headline series of published indicators only (stray rows omitted and counted); stored `revision_abs`/`revision_pct` shown as exported (D6). Fixture generator writes `revisions/M09|M10|P01.parquet` and `revisions_recent.json` with the REAL producer code (regular and re-estimation revisions, a tombstone, a three-version key, one WEO-style edition rebasing 12 keys of 2 series). Met: AC-EXP-12 site side (fixed text present in the built page modules; neither "first release" nor "first stored release" in `site/` source or `dist/`, scanned by `site/tests/revisions.test.mjs` and the Python build test), AC-EXP-13(g) on the fixture (edition line below a non-empty ordinary list; JS render test and headless Chrome), re-estimation distinguishable, headline-only. Measured (real gzip -9): `revisions.html` first load 115,456 bytes in 24 files (limit 1,500,000); `index.html` 31,909, `domain/labour.html` 213,767, `peers/labour.html` 216,974, `explorer.html` 284,201 (`landingSet` no longer counts registered Parquet files, which are read lazily; `interactionBudget` now also covers `revisions/`); `check-npm-imports` 6 files match, `npm-imports.lock` NOT changed; no new dependency, no off-origin URL. Headless Chrome (DevTools protocol, throwaway script): renders, filter gives 10 re-estimation / 8 regular rows of 18, choosing M09 fetched exactly its one parquet file, no errors, no off-origin request. Tests: JS 77 passed (`node --test`, 0 skipped; 16 new in `site/tests/revisions.test.mjs`, 1 new in `scripts.test.mjs`), `tests/unit/test_site_spike.py` 11 passed (build test ran, not skipped; 1 new fixture test, build test extended), repo-wide unit 915 passed, 2 skipped (network); ruff check, ruff format --check, `mypy --strict src` clean. Partial because: (1) the Playwright smoke is T94 (select interaction exercised only ad hoc in headless Chrome; Firefox, Safari, mobile not tested); (2) new wording needs the user's confirmation and spec gaps are open (edition summary lists no indicators so links cover `top_revisions` only; links are file downloads, not in-page navigation; where the class filter applies; "earliest stored version" on a base that follows projections; no `ref_period_end` in `revisions_recent.json`), all in `docs/ops/spike-results.md` section "V4 vintage and revision view (T92)"; (3) the CI `site` job and Dependabot entry remain a separate step; fixture values are synthetic, not real export output. User confirmation (2026-11-04): the user confirmed the V4 wording choices and accepted the V4 spec gaps listed in `docs/ops/spike-results.md` (section "V4 vintage and revision view (T92)"), so partial reason (2) is closed; reasons (1) and (3) remain.

### T93: V5 data freshness and status (S)  [~] partial
- Goal: last run, group states, backlog, validation counts incl. COV-01 "not yet measurable", open drift events, next manual download, active alert count, monthly check text.
- Files: `site/`.
- Depends on: T88, T83.
- Acceptance criteria: renders from `status.json`; counts equal published-scope view values; no values for withheld groups; no raw error text.
- Tests: JS unit; smoke.
- Risks: low.
- Note (T93): `site/src/lib/status.js` (view-model, whitelisted fields, fixed wording for unknown enum or code values), `status-view.js`, static page `site/src/status.md` (`FileAttachment("data/status.json")` in the page, no variable named `view`), linked from the landing page and added to `pages`. Shows last run, active alerts (`last_run.alerts_opened`, null = "no analysis run"), group states, backlog, validation counts, COV-01 (including "not yet measurable"), open drift events, next manual download, monthly check text; counts as exported, stray or error-like fields never rendered (JS test). Known export gaps shown, not worked around: `load_result` always null ("not exported"), COV-01 without a stale-on-arrival share, one aggregate backlog. Fixture generator writes a schema-valid `status.json` (4 groups incl. a withheld-named one, null `load_result`, COV-01 both states, 2 drift kinds, manual source with and without window); the error-text-like fields are injected in the JS tests because the schema forbids extra fields. Measured (real gzip -9): `status.html` 35,969 bytes in 14 files (limit 1,500,000), `index.html` 31,951, `revisions.html` 115,503, `explorer.html` 284,244; `check-npm-imports` 6 files match, `npm-imports.lock` NOT changed; no new dependency, no off-origin URL. Tests: JS 86 passed (`node --test`, 0 skipped; 9 new in `site/tests/status.test.mjs`), `tests/unit/test_site_spike.py` 12 passed (build test ran, not skipped; 1 new fixture test, build test extended to `status.html`), repo-wide unit 916 passed, 2 skipped (network); ruff check, ruff format --check, `mypy --strict src` clean. Partial because: (1) new wording and the spec gaps are listed in `docs/ops/spike-results.md` section "V5 data freshness and status (T93)" and await the user's confirmation; (2) no browser run of `status.html` (Playwright smoke is T94); (3) the CI `site` job and Dependabot entry remain a separate step; (4) the status producer was not run (needs a database), fixture is hand-written in the producer's shape.
- Note (T93, 2026-11-04): the user CONFIRMED the V5 wording and ACCEPTED the V5 spec gaps as listed (stated in session; recorded in `docs/ops/spike-results.md`, section T93). Partial item (1) is closed; (2) is closed by T94 (browser run of `status.html`); (3) is closed by T94 except the `setup-node` pin (OP-07).

### T94: Playwright smoke, golden numbers, size tests (M)  [~] partial
- Goal: CI Chromium smoke of V1-V5 on `tests/fixtures/export/`, golden numbers, size measurement.
- Files: `site/tests/`, `site/package.json` (Playwright devDependency, `site/package-lock.json`), `scripts/ci/site-smoke.sh`, CI job `export-and-site`.
- Depends on: T89-T93, T80; OQ-18 (BB30).
- Acceptance criteria: AC-DASH-1 (V1-V5 render; no off-origin request), AC-DASH-2 (sizes within budgets), AC-DASH-3 (ten sampled pairs equal published tables), AC-DASH-4, AC-DASH-8 (site holds no DB credential, EXP-07), AC-SYS-10 (build id matches run) on fixtures.
- Tests: browser smoke (CI, no network); Playwright installed with its CLI only at CI time.
- Risks: browser download time (BB30); Firefox/Safari manual only (BB16).
- Note (T94): `playwright` 1.64.1 exact devDependency (the package ADR-024 names; `node:test` plus the library, no second runner), `package-lock.json` updated, `npm-imports.lock` unchanged, no browser downloaded (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). `site/tests/smoke/{support,static.smoke,browser.smoke}.mjs`, `scripts/ci/site-smoke.sh` (Playwright CLI `install --with-deps --only-shell chromium`, then `npm run smoke` with `MM_SMOKE_REQUIRE_BROWSER=1`), `site` job in `.github/workflows/ci.yml`, npm entry for `/site` in `.github/dependabot.yml` (weekly, grouped, no auto-merge; AC-NPM-5), `tests/unit/test_site_ci.py` (3). Covered on the fixture: AC-DASH-1 (11 page loads, no error, no off-origin request), AC-DASH-2 (all pages <= 1.5 MB gzip, interaction <= 5 MB, site <= 300 MB, landing also measured in the browser), AC-DASH-3 (ten sampled pairs equal the published scorecard JSON), AC-DASH-4 (stale, unranked, NSA transform), V2 filter and sort, V3 one-file fetch and rebase, V4 class filter and indicator choice, V5, stale banner on a stale manifest, AC-DASH-8 file scan, AC-SYS-10 build id. Details, decisions and gaps: `docs/ops/spike-results.md` section T94. Real results: smoke 25 passed, 0 failed, 0 skipped (5 static + 20 browser) with system Google Chrome (`MM_SMOKE_CHANNEL=chrome`) and also with a Chromium headless shell already in the local Playwright cache (not downloaded by this task); with `PLAYWRIGHT_BROWSERS_PATH=/nonexistent` the 20 browser tests SKIP with the reason and fail under `MM_SMOKE_REQUIRE_BROWSER=1`. JS unit 86 passed (`npm test`), repo unit 919 passed, 2 deselected (network); ruff check, ruff format --check, `mypy --strict src` clean; actionlint 0 findings on `ci.yml`; clean-copy `npm ci --ignore-scripts` + build + `check:imports` + audit gate (0 high/critical) + smoke passed. Partial because: (1) `actions/setup-node` and `actions/cache` have no verified SHA (OP-07 for the user): the job checks the runner's Node major against `.nvmrc` instead and does not cache the browser directory; (2) the CI job has never run, so BB30/OQ-18 (browser download time) and `--with-deps` are unverified; (3) golden numbers are against the published scorecard JSON of the fixture, not `analytics.*_published` (needs T80's database fixture); (4) stale case is a rewritten manifest, not a separate stale export; (5) AC-SYS-10 and AC-DASH-8 "no Neon connection" are only checkable after the first deploy; (6) Firefox and Safari manual (BB16).

## M6 Launch readiness

### T95: Neon spike scripts and results (S)  [ ] todo
- Goal: scripts for AC-OPS-7 (`btree_gist`, `CREATE ROLE`, column grants, SECURITY DEFINER, advisory locks through the pooler) and AC-OPS-2 (connect time) plus BB29 (`\copy` into a `GENERATED ALWAYS` identity column), run by the operator on a dev branch.
- Files: `scripts/ops/neon_spike.py`, `docs/ops/spike-results.md`.
- Depends on: T16, T71; OP-02, OP-14.
- Acceptance criteria: each check prints pass/fail; a failure names the documented fallback and states that the ADR (ADR-008 or ADR-015) must be updated by the user before implementation continues; no credentials in output.
- Tests: `unit` (argument handling); operator-run.
- Risks: outcome may change T11, T16 or T71.

### T96: Measurement hooks for AC-OPS-6/8/9 and query timing (S)  [ ] todo
- Goal: reports for the CU-hour proxy, share of keys above tolerance per re-estimating group, staging peak (before/after sweep), per-table growth, `curated.observation` bytes per row, `v_observation_latest` timing.
- Files: `monitoring/run_summary.py`, `scripts/ops/`, `docs/ops/spike-results.md`.
- Depends on: T46, T64.
- Acceptance criteria: AC-OPS-6 (measured or labelled proxy), AC-OPS-8 inputs after three releases, AC-OPS-9 (a)-(c) recorded for three consecutive runs with pass/fail thresholds (staging peak 200 MB, 300 bytes per row), AC-WF-6 durations.
- Tests: `unit`, `db`.
- Risks: BB3, BB21, BB24.

### T97: R plumbing only (S)  [ ] todo
- Goal: `r-analysis` job gated by `ENABLE_R`, `continue-on-error`, `analytics_r` contract tests; no R module.
- Files: `.github/workflows/monthly-refresh.yml` (job), `src/macro_monitor/r/DESCRIPTION`, `tests/r/` placeholder, `tests/integration/test_analytics_r.py`.
- Depends on: T34, T74.
- Acceptance criteria: AC-R-2, AC-R-3, AC-R-4; skipped by default.
- Tests: `db`.
- Risks: `renv.lock` and testthat content wait for a module spec (ADR-006).

### T98: First-production-run checklist and AC-OPS-4 tracker (S)  [ ] todo
- Goal: checklist of operator prerequisites and gates before the first scheduled run; record of the time-boxed checks.
- Files: `docs/ops/first-run-checklist.md`, `docs/ops/ac-ops-4.md`.
- Depends on: T63, T75, T81, T95, T96; OP-01..OP-14; BL-12.
- Acceptance criteria: covers immutable releases (AC-OPS-5), roles and secrets, WEO file present, AC-PAR-7 outcome recorded, config-report coverage 100 %, first dump and restore-test plan (AC-OPS-3), BB29/BB30 results, and the days 7/55/65/125 checks with a place to record results.
- Tests: none (documentation).
- Risks: the 60-day behaviour (BB1, BB26) is learned only by running.

## M7 Additions after the slice (ADR-027, ADR-028)

Task ids T64 and T65 were already taken in this plan, and T99-T135 belong to the dashboard plan; these tasks therefore use T136 and T137. The ADR-028 code and test files carry the working label "t64" in their names (`tests/unit/test_discovery_t64.py`); that label means T136.

### T136: Landing-page discovery for bulk files (ADR-028)  [~] partial (code, config and unit tests done; open items below)
- Goal: replace the T58 placeholders (Pink Sheet `PROBE_REQUIRED_HASH`, FAO month) with landing-page discovery of the file URL under a fail-closed assertion, plus a manual-inbox fallback. The logical dataset identifies the request, so the `request_key` chain survives URL rotation.
- Files: `src/macro_monitor/ingestion/discovery.py` (new), `ingestion/connectors/bulk.py`, `registry/config.py` (rule 44), `registry/schemas/sources.schema.json` (`discover` block), `config/sources.yaml` (manual sources `worldbank_pinksheet_manual` and `fao_manual`), `docs/ops/discovery-failed.md`, `tests/unit/test_discovery_t64.py`.
- Depends on: T58, T59, ADR-028 (approved by the user on 2026-11-05, stated in session).
- Acceptance criteria: per ADR-028. Exactly `expect_matches` distinct links, host and scheme allow-list, no fallback to the last URL. `discovery_failed` is recorded and the group is skipped. `plan` stays pure and offline. The manifest records the resolved URL and the discovery object.
- Tests: `unit` done (2026-11-05); `db` and `network` open (see below).
- Risks: landing-page redesign (detected as zero matches; the manual route covers it); `sfvrsn` volatility [UNVERIFIED]; cross-host fetch; the cereal brief is a single-copy vintage.
- Note (implemented 2026-11-05): code, config and tests done. Unit suite: 1088 passed, 4 skipped. Review fixes 2026-11-06: migration 0016 re-creates `pubdump.v_ref_series_group` with `enabled` last, `groups_block` omits disabled groups, `record_freshness(group_enabled=)` is required, the DB flip test and the rule 8 disabled-group test (needs an SA-requiring transform) are written; db tests still not run (`MM_TEST_DATABASE_URL` unset).
- Left / open: (1) code deviates from ADR-028 decision 3 and the approved ingestion spec on one point beyond item 6: the landing and file hosts of the Pink Sheet share one throttle instead of one per host (more conservative; fix or amend the ADR); (2) DONE 2026-11-05 but NOT RUN: `tests/integration/test_discovery_manifest_db.py` (manifest row, `request_key`, `prev_raw_id` chain, `request_params.discovery`, `last_url`) is written; `MM_TEST_DATABASE_URL` is not set in this environment, so it was skipped; (3) operator `network` probe and confirmation of which month the Pink Sheet file contains (ADR-028 Q5); (4) FAO release dates cannot be encoded in `release_calendar.yaml` until the freshness amendment rule 35 is built; (5) DONE 2026-11-05: `monitoring/discovery_alerts.py` gives one finding per source per UTC month (key `[discovery_failed] <source> <YYYY-MM>`; `sync_issues` opens once and comments on repeats); no caller wires it into a workflow yet (no workflow task in scope); unit tests `tests/unit/test_discovery_alerts.py`; (6) DONE 2026-11-05: `fetch._robots_for_resolved` also evaluates the resolved file URL (log-only for bulk, Disallow flagged for escalation, both decisions in `request_params.discovery`, file decision stored on the raw object); unit test added; (7) licence decision for Pink Sheet and FAO (user).
- Note (review follow-ups 2026-11-06): a file request refused on a redirect off the allow-list, an href that does not parse, any unexpected error in link resolution and a landing page over 2 MiB now raise `discovery_failed`; rule 44 now rejects top-level `|`, requires a literal escaped host in the allow-list, uses ASCII `fullmatch` and handles an escaped `\$` correctly, with the AC-CFG-19 negatives, URL-trick, rotation and unit-level AC-ING-23 tests added; open: the shared throttle for `www.worldbank.org` and `thedocs.worldbank.org` is stricter than ADR-028 D3(g) and must be recorded in the ADR/spec, the redirect allow-list is source-wide not per group, the freshness decision for the manual fallback groups is pending, and the manual-map identity trick needs `source_id` in the `sync.py:229` key.
- Note (2026-11-06, Opus-review round 3): closed: the landing GET has its own streaming byte cap (`max_body_bytes`, 2 MiB) so an oversized page is refused while streaming (tested with a 3 MiB stream), `docs/ops/discovery-failed.md` lists the oversized-landing and refused-redirect failure modes, and the AC-ING-23 unit test no longer claims the `prev_raw_id` chain (that stays with `tests/integration/test_discovery_manifest_db.py`).

### T137: Group-level `enabled` flag (ADR-027)  [x] done 2026-11-05 (db tests written, not run)
- Goal: add an optional group-level `enabled` (default true). Effective state = source AND group. Unprobed groups stay validated but out of the fetch matrix while the source stays enabled.
- Files: `registry/schemas/sources.schema.json`; `registry/config.py` (rule 45, warnings, effective-state helper, `check_env_present` narrowed per resolved Q3); `registry/report.py` (`disabled` bucket); `registry/sync.py` (`group_row` and upsert); `ingestion/registry` and `cli.py` (`plan`, `fetch`, `ingest-manual`); `monitoring/freshness.py` and `monitoring/coverage.py`; `publish/status`; storage migration (next free number, 0016 or later, not applied) adding `ref.series_group.enabled boolean NOT NULL DEFAULT true`; `config/sources.yaml`: `enabled: false` plus a `note` on `eurostat_sts`, `eurostat_hicp`, `eurostat_gov_debt`, `eurostat_gdp_q`, `worldbank_support` (not `eurostat_labour`), and the stale comment above `eurostat_sts` rewritten.
- Depends on: ADR-027 (approved by the user on 2026-11-05, stated in session); the spec update (`source-config-schema.md`, `ddl-neon-schema.md`, ingestion and monitoring specs).
- Acceptance criteria (ADR-027; AC-CFG-20, AC-ING-23, T-DDL-35): default true, and a group without the key keeps its `config_sha256`; a disabled source disables its groups; the `plan` matrix excludes disabled groups and the connector's `plan` is never called for them; `fetch` and `ingest-manual` on a disabled group exit with a config error naming the switch that is off; `load` and `rebuild` of already archived raw still work; validation rules still apply to disabled groups; warnings (not errors) for `enabled: false` without `note` and for an enabled source with no enabled group; no freshness rows, roll-up entries or issues for disabled groups; the calendar equality test still runs; `config-report` has a `disabled` bucket not counted as mapped and `launch_ready` keeps its definition; `ref.series_group.enabled` stores the group's own flag and no `ref.series_map` row is deleted.
- Tests: `unit` (schema, effective-state matrix, negatives still failing for a disabled group, warnings, `group_row` golden sha for `eurostat_labour`, CLI plan/fetch/ingest-manual/load, monitoring no rows and re-enable, report `disabled` bucket, real-config matrix); `db` (after `sync-config` the flag is false for the disabled groups; double sync idempotent; re-enable goes through the config-history path; no `ref.series_map` row deleted).
- Risks: `load` still ingests backlog for a disabled group (ADR-027 Q1); a core pair supplied only by a disabled group keeps `launch_ready` false (Q2); rule 3 (auth env) applies only with at least one enabled group (resolved Q3); operators can forget a disabled group (hence the `note` warning and the `disabled` bucket); a disabled group with earlier data ages silently in ranking staleness. Until this ships, unprobed groups stay in the fetch matrix and the only safe action is the source-level switch.

- Note (implemented 2026-11-05): schema key, `effective_group_enabled` and `group_off_reason`, two warnings (surfaced on stderr by `plan`), rule 3 narrowed, `group_row` and migration `0016_series_group_enabled.sql` (NOT applied), `_groups_of`/`fetch`/`ingest-manual` (exit 20 naming the switch), `report.py` `disabled` bucket, `record_freshness(group_enabled=...)`, five groups parked in `config/sources.yaml`. Unit suite 1113 passed, 4 skipped. Left: `tests/integration/test_group_enabled_db.py` not run (`MM_TEST_DATABASE_URL` unset; the re-enable history-path check is not written); no production caller of `record_freshness` exists yet, so the caller must pass `SourcesConfig.effective_group_enabled`; `pubdump.v_ref_series_group` (migration 0011) does not list the new column; `publish/status` omits disabled groups only once it reads the flag (no change made); spec/design text not touched.

- Note (correction 2026-11-06, orchestrator): a read-only check of `ops.schema_migration` on `neondb` showed 0000-0016 already applied (not by this task's agents). A review fix had edited 0016 in place to add the dump-view change, giving a checksum MISMATCH against the applied row; 0016 was restored byte for byte (checksum OK again) and the view change moved to the new forward-only `0017_pubdump_series_group_enabled.sql` (NOT applied; applying it needs an explicit user request). Until 0017 is applied, `pubdump.v_ref_series_group` on `neondb` lacks `enabled` and the AC-DUMP-6 db test would fail there.

## Traceability (spec test ids to tasks)

- T-DDL: 1 T10-T16, T31; 2 T15/T16; 3, 4, 6, 9, 23, 27, 30 T11; 5 T10; 7, 8 T13; 10 T16 (extended T17, T34, T35, T68); 11 T68/T70; 12, 24, 26, 28 T34; 13 T27; 14 T22/T51; 15 T46; 16 T12; 17 T26/T47; 18 T18; 19 T15/T28; 20 T36; 21 T14; 22, 33 T15; 25 T27; 29 T35; 31 T68; 32 T17.
- AC-EXP-1..14: 1, 2, 4, 5 T86; 3 T84/T85; 6, 7, 10, 11, 12 T83 (+T92); 8 T84; 9 T82; 13, 14 T85.
- AC-DUMP-1..10: 1, 8, 9 T69; 2, 3 T70; 4, 5 T71; 6, 7 T68; 10 T72.
- AC-ING: 1, 11, 17 T22; 2 T21; 3, 6 T19; 4, 13, 16, 21 T27/T28; 5, 7, 8, 9, 15 T26 (+T36, T47); 10 T46/T48; 12 T49; 14 T18; 18 T47; 19 T50; 20 T23; AC-DEP-1 T01.
- AC-CFG: 1-4, 7-10 T07; 5 T33/T63; 6 T18; 9 T07/T60; 11, 12 T09; AC-PAR: 1, 4-8, 10 T32/T33; 2, 3, 9 T09.
- AC-WF: 1 T03; 2, 3, 11, 13 T74; 4 T76; 5, 7 T80; 8, 9 T75; 10 T70; 12 T46/T48; 14 T71/T79. AC-OPS: 1 T74; 2 T75/T95; 3 T79; 4 T98; 5 T45; 6, 8, 9 T96; 7 T95.

## Changes versus the previous plan (2026-10-24)

Dropped blockers BL-01..06, BL-11; kept BL-07..10 and BL-12; added DG-01..03 and OQ-13..18. New or changed work: WEO as a named-edition group with REV-07 (T48, T60); first-sight series creation by the loader (T27, T18 pending entries, T33 pending report); DDL gaps built in (T11, T17, T34, T35); the public dump as five tasks (T68-T72, `psql` restore) replacing the old `pg_dump` task; dependency boundary test and approved plugins (T01); revision view excludes `PROJ` and edition summaries (T15, T85); `latest_single` rejected (T07, T09, T39); `indicator_defaults.yaml` and rule 29 (T09); first slice confirmed as Eurostat M09; operator items OP-14, OQ-17, OQ-18 added.

## Deferred to v2

Out of scope; no v1 task creates, reads or depends on any of it.
- ADR-011 (forecast and projection storage; `proposed`, gated, v2): forecast schema and evaluation views, retirement of the interim `PROJ` and `import` rules in `curated.observation`.
- Forecasting and nowcasting, benchmark forecast editions, probability alerts, the model layer, forecast dashboard pages; analytics spec section 10 (deferred, no hooks built); the forecasting amendment and FT/N/B research with follow-ups R1-R9.
- Not scheduled for other reasons: wave 2 sources (keyed national APIs, ILOSTAT, Comtrade, FRED), wave 3 web scrapers (design Q5), R analysis modules, per-country translation of global series (Q23), calendarisation, peer-group percentiles (P9 optional), a second dump leg for published analytics tables (OQ-13).
