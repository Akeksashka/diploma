---
status: approved   # approved by the user on 2026-11-04 (stated in session: "approve all"); amendments are merged into the base specs by a later Phase 2 step; section 2.7a added on 2026-11-05 from ADR-027 (decision 7), approved by the user that day
user_decisions_recorded: 2026-11-04   # answers to questions 1, 2, 3, 6, 7, 8 given by the user in session 2026-11-04 (section 10); questions 4, 5, 9 still open
amends:
  - docs/specs/validation-monitoring-spec.md   # FRESH-01 row, section 2, AC-VAL-4 (and the front-matter status of that spec)
  - docs/specs/ddl-neon-schema.md              # section 3 (ingest.v_series_deferred), section 7 (ops.freshness_state, views), section 10 (T-DDL-8)
  - docs/specs/source-config-schema.md         # section 5 (release_calendar.yaml), rules 34-37
  - docs/specs/dashboard-export-spec.md        # status.json groups[]
inputs:
  - ADR-007
  - ADR-012
  - ADR-014
  - ADR-017
  - ADR-020
  - docs/specs/validation-monitoring-spec.md
  - docs/specs/ddl-neon-schema.md
  - docs/specs/source-config-schema.md
  - docs/specs/analytics-and-r-contract-spec.md
  - docs/specs/release-lag-and-split-proposal.md
---
# Amendment: per-series release-calendar freshness (`ops.freshness_state`) and the `ingest.v_series_deferred` correction

Date: 2026-11-04 (revised the same day after the user's answers). Repository facts below were read on 2026-11-04 (file paths are the citations; no web source is used for them). PostgreSQL behaviour is cited with URL and access date 2026-11-04. Statements about what the code does are inferences from reading it (not executed) and are marked "inferred".

How to read this document. It is a self-contained proposal. The approved base documents are not edited by this document (section 11 lists the exact edits to apply, including the reset of their `status` to `draft`). Items marked USER DECISION were answered by the user on 2026-11-04 (session statement, not a file); items marked PROPOSAL are still choices for the user.

## 0. User decisions recorded (2026-11-04)

| # | Decision | Where it acts |
|---|---|---|
| UD-1 | Grace days accepted: M 45, Q 60, A 180, named editions (WEO) 90. Per-source slowness is handled by `typical_lag_days`, not by a wider grace | 2.3, rule 34 |
| UD-2 | A `stale` core series is severity `error`; a `stale` non-core series is `warn` | section 5, AC-FRESH-12 |
| UD-3 | `fetch_broken` stays a flag, not a fifth series state; the group roll-up state `broken` stays | 2.7, 2.8 |
| UD-4 | The `ingest.v_series_deferred` correction is accepted: `skipped_out_of_order` becomes terminal (new forward-only migration) | section 8, AC-FRESH-9 |
| UD-5 | Keep the equality test between `sources.yaml` `freshness:` blocks and `release_calendar.yaml` for v1; make `release_calendar.yaml` the single source later (follow-up FU-1, section 12) | section 3, rule 34 |
| UD-6 | Daily and weekly series (frequency `D`, `W`) are out of scope for v1 | 2.1, rule 34 |

## 1. Reality check: what exists, what the proposal changes

| Topic | Spec today | Code / migrations today (read 2026-11-04) | Delta of this amendment |
|---|---|---|---|
| Granularity | per series group (section 2: "Group state") | `ops.freshness_state` (0004): one row per `(source_group, series_group, evaluated_at)`; `freshness.py` computes a state per series then stores only the group verdict | one row per `(run_id, series_id)` |
| States | `fresh, late, stale, broken` | CHECK on those four values (0004) | series: `current, awaiting_release, late, stale`; `broken` becomes the flag `fetch_broken` and survives as a GROUP roll-up state |
| Stale rule | two or more periods behind, or no new period beyond `2 x typical_lag + tolerance` | `series_state()` implements exactly that | expected release date of the first missing period plus a grace period by frequency |
| Run link | none | no `run_id` | `run_id` (the `ingest.run` of the pipeline run whose `monitor` step evaluated) |
| Append-only | not stated for this table | no trigger; only INSERT is granted to `mm_ingest` (0006) | trigger `ops.fn_append_only()` like `export_status`, plus a unique `(run_id, series_id)` |
| Current-state view | `ops.v_freshness_latest` listed in DDL section 7 | 0009: newest row per group | same name and first six columns, now a roll-up of the newest run; per-series view added |
| Named editions (WEO) | `release_months` + tolerance (source-config section 5) | `CalendarEntry.release_months`; compares `latest_period_end` (a reference period end) with edition-month ends. Inferred effect: after the tolerance of every release the group is reported `late` or `stale` although its latest edition is loaded (section 2.4) | edition basis: `edition_date` of the latest loaded object |
| Explicit `dates:` | "override the lag rule" (format unspecified) | `CalendarEntry.from_mapping` raises `CalendarError` | format defined (section 2.5) |
| `known_stale` | "config entries `known_stale: true`" (location unspecified) | passed in by the caller as a mapping; no config key | location proposed (section 2.6) |
| Latest period | max `ref_period_end`, `MISS` counts | `read_series_inputs` takes the max over ALL versions in `curated.observation` excluding `PROJ` and `DEL` rows (inferred: a key whose latest version is a `DEL` tombstone still counts) | read the latest version of each key (`curated.v_observation_latest`), excluding `PROJ`; `MISS` still counts |
| `ingest.v_series_deferred` | DDL spec section 3 (view) | exists since 0003, identical to the spec | corrective redefinition (section 8, accepted) |

Not changed: ranking staleness (D14, validation spec section 3), `release_lag_aware` semantics, FRESH-02 (run-level 40 days), FRESH-03 (WEO reminder), COV-01, the dead-man ladder.

## 2. Definitions

Run date `T` is the UTC date of `evaluated_at`. All day counts are calendar days (no business-day or holiday adjustment; PROPOSAL, it keeps the table reproducible).

### 2.1 Inputs
Per series group the calendar entry of `config/release_calendar.yaml` (keys are group ids): `frequency` in `M | Q | A` with `typical_lag_days`, or `release_months` (named editions); `tolerance_days`; optional `dates`. There is no per-group `grace_days` in v1 (UD-1, section 2.3). USER DECISION UD-6: daily and weekly series are out of scope for v1; the calendar loader rejects frequency `D` and `W` (`CalendarError`, unchanged for `D`; `W` is rejected the same way). A later extension needs a business-day rule and its own amendment.

Per series: `latest_period_end` (max `ref_period_end` of the latest version of each key, excluding `PROJ`; a `MISS` row counts as published because the source published the period) or, for edition groups, the group's latest loaded `edition_date`.

### 2.2 Period basis (frequency groups)
1. `F` = the first reference period after `latest_period_end` (the oldest period the store does not have). If the series has no observation at all, the state is `stale` with `expected_release_on` NULL and `overdue_days` NULL (fail loud; a mapped series without data should not exist because the loader creates the series and its rows in one transaction).
2. `R` = expected release date of `F`: the `release_on` of a matching `dates` entry, else `end(F) + typical_lag_days`.
3. If `T < R`: `current`. Otherwise `overdue = T - R` (0 on the due day) and:
   - `awaiting_release` if `overdue <= tolerance_days`;
   - `late` if `tolerance_days < overdue <= grace_days`;
   - `stale` if `overdue > grace_days`.
`expected_period_end` (kept for the export and the history) = the end of the latest period with `end + typical_lag_days <= T` (or its `dates` equivalent), unchanged from today.

Why "first missing period": staleness is how long the oldest missing figure has been overdue. A series two periods behind is overdue by at least one period length, so the number of periods behind needs no separate clause.

### 2.3 Grace period (USER DECISION UD-1)
`grace_days` is measured from `R` (it is the TOTAL overdue time after which the state is `stale`, not an addition to the tolerance). The effective value is the default by frequency from `grace_defaults`; there is no per-group override in v1. A source that is habitually slow is described by a larger `typical_lag_days` (and, if needed, `tolerance_days`), never by a wider grace.

| Frequency | `grace_days` (accepted) | Basis |
|---|---|---|
| M | 45 | user decision 2026-11-04 (originally judgement J: one missed monthly cycle plus half a month) |
| Q | 60 | user decision 2026-11-04 |
| A | 180 | user decision 2026-11-04 |
| named editions (`release_months`) | 90 | user decision 2026-11-04; `late` starts the day after the FRESH-03 escalation (45 days after the first of the release month); `stale` after a further 45 |

Config rule (rule 34): effective `grace_days >= tolerance_days`. Because grace is fixed by frequency, a calendar entry with `tolerance_days` above the frequency's grace is an error (the entry would never be `late`). The calendar entries in the repository and in source-config section 5 satisfy it (Eurostat M 20/45, ECB M 20/45, World Bank A 120/180, WEO 45/90), and so does the Q entry used by the unit tests (lag 60, tolerance 15, grace 60).

### 2.4 Edition basis (groups with `release_months`, IMF WEO)
The comparison key is the edition, never a reference period (a WEO series ends at an estimate year; an edition month is a publication month; comparing them is the inferred defect of section 1).
1. `E_last` = the greatest `ingest.raw_object.edition_date` among objects of the group with an `ingest.raw_load` row of outcome `loaded`. No loaded edition: `stale`, `expected_release_on` NULL.
2. `R` = the first day of the earliest release month whose first day is strictly after `E_last`.
3. `T < R`: `current`; otherwise `overdue = T - R` and the same thresholds apply with `tolerance_days` (45) and `grace_days` (90).
All series of the group share the verdict (the delivery unit is one manual file; a series whose values did not change in an edition has no new row, so a per-series test would misreport it). The per-series rows are still written. Release months stay [UNVERIFIED] (source-config section 2): confirm against https://www.imf.org/en/Publications/WEO before use.

### 2.5 Explicit dates
`dates: [{period_end: <ISO date>, release_on: <ISO date>}, ...]` on a frequency entry. A listed `period_end` uses `release_on` as `R`; unlisted periods use the lag rule. Entries must lie on period ends of the entry's frequency and be unique (rule 35). Pink Sheet or FAO dates (source-config section 5) use this shape.

### 2.6 `known_stale` (location still open, question 5)
A series known to have ended (the OECD Japan CPI ending 2021-06 example of validation spec section 2) is listed in the group's calendar entry: `known_stale: [{series_ref: "<dataset>|<series_key>", note: "<reason>"}]` (rule 36). The state is computed normally and stored with `known_stale = true`; such series are excluded from the group roll-up vote and from `late` and `stale` issues, and reported as `info`. A `known_stale` series never produces the UD-2 `error`, even when core.

### 2.7 `fetch_broken` and the backlog (USER DECISION UD-3)
- `fetch_broken` is a boolean flag stored on the row; it is NOT a fifth series state. Definition: the last two `ingest.fetch_attempt` rows of the series' request key (the request key of the newest raw object that supplied one of its observations) are both `error` or `blocked`; the rule is unchanged from `read_series_inputs`. The series state is computed from the calendar only; the flag is independent of it.
- `group_unloaded` = number of rows of `ingest.v_raw_unloaded` for the series' group at evaluation time. It does not change the state; it lets the issue text say "source published, load blocked or held" (ORD-02, LOAD-01, REV-01) instead of "source late".

### 2.7a Disabled groups (ADR-027)
A group with `group_enabled = false` (source enabled AND group `enabled`, default true) is not evaluated: no `ops.freshness_state` rows for its series, no entry in the `ops.v_freshness_latest` roll-up (which reads the newest run), and no `late`, `stale` or `fetch_broken` issue or alert. The monitoring step filters calendar and series inputs by `group_enabled` before `record_freshness`. Its `release_calendar.yaml` entries remain (the equality test with the `freshness:` blocks still runs) but are skipped by the evaluation. Re-enabling restarts evaluation at the next run; the first run may legitimately report `late` or `stale`.

### 2.8 Group roll-up (view, not stored)
Over the rows of the newest run, voting rows = those with `known_stale = false`:
1. `broken` if any voting row with `is_core` has `fetch_broken`;
2. else `stale` if more than 20 % of voting rows are `stale` (the threshold of today's `STALE_SHARE_LIMIT`);
3. else `late` if `late` rows outnumber `current` plus `awaiting_release` rows;
4. else `awaiting_release` if `awaiting_release` rows outnumber `current` rows;
5. else `current` (also when there are no voting rows).
A group never appears `late` or `stale` merely because a release is pending (`awaiting_release`); this is the user-visible point of the new state. The roll-up is a display summary; issue severity is decided per series (section 5), not by the roll-up state.

## 3. Relationship to `release_calendar.yaml` and `release_lag_aware`

| Fact | Rule |
|---|---|
| Single source of lag facts (USER DECISION UD-5) | `typical_lag_days` and `tolerance_days` come from `release_calendar.yaml`. The group `freshness:` block of `sources.yaml` repeats the same numbers today (rule 7 requires it; the code reads the calendar file). For v1 rule 34 keeps and extends a config test that the two are equal, so they cannot diverge. Making `release_calendar.yaml` the only copy (dropping the `sources.yaml` block and changing source-config rule 7) is deferred to follow-up FU-1 (section 12) |
| `release_lag_aware` | Affects ranking staleness only: `stale_limit_days = max(class_limit, typical_lag_days + tolerance_days)` (analytics spec section 8). It never changes `ops.freshness_state`. Conversely the grace table is not an input of `stale_limit_days` |
| Dependency | An indicator with `release_lag_aware: true` needs, for each group that maps a headline series to it, a frequency entry (`frequency` + `typical_lag_days`) in the calendar; a `release_months` entry cannot define a lag. `sync-config` fails otherwise (rule 37). Today no indicator is on the list (plan OQ-10 open; proposal in `docs/specs/release-lag-and-split-proposal.md` section 2: A12 and A20) |
| Independence in practice | A series can be `current` (feed healthy) and `is_stale` in the snapshot (value older than the D14 limit), for example an A730 annual series with a 2-year lag when `release_lag_aware` is false. COV-01 reports exactly that; this amendment does not change it |
| FRESH-03 | The WEO download reminder (25th of the release month, escalation 45 days after the 1st) and the edition-basis states agree: `awaiting_release` ends and `late` begins on day 46 after the 1st of the release month |

## 4. Data model: migration 0012 (forward-only; illustrative SQL)

File name `NNNN_freshness_series.sql`, with `NNNN` = the next free version at implementation (0012 if 0011 below lands first; the runner requires contiguous versions from 0000, `storage/migrate.py`). Never edit 0004 or 0009.

```sql
-- 1. Replace the group primary key; add per-series columns (all nullable for legacy group rows)
ALTER TABLE ops.freshness_state DROP CONSTRAINT freshness_state_pkey;      -- default name from 0004; verify with \d at implementation
ALTER TABLE ops.freshness_state
  ADD COLUMN freshness_id        bigint GENERATED ALWAYS AS IDENTITY,       -- rewrites the table once (small, probably empty)
  ADD COLUMN run_id              bigint  REFERENCES ingest.run,
  ADD COLUMN series_id           integer REFERENCES ref.series,
  ADD COLUMN basis               text    CHECK (basis IN ('period','edition')),
  ADD COLUMN expected_release_on date,      -- R; NULL when no data
  ADD COLUMN overdue_days        integer CHECK (overdue_days >= 0),         -- NULL when state = 'current'
  ADD COLUMN tolerance_days      integer CHECK (tolerance_days >= 0),
  ADD COLUMN grace_days          integer CHECK (grace_days >= 0),           -- effective value from grace_defaults (UD-1)
  ADD COLUMN latest_edition_date date,      -- edition basis only
  ADD COLUMN fetch_broken        boolean,   -- flag, not a state (UD-3)
  ADD COLUMN is_core             boolean,
  ADD COLUMN known_stale         boolean,
  ADD COLUMN group_unloaded      integer;
ALTER TABLE ops.freshness_state ADD CONSTRAINT freshness_state_pk PRIMARY KEY (freshness_id);

-- 2. State vocabulary: legacy rows (series_id IS NULL) keep the old four words
ALTER TABLE ops.freshness_state DROP CONSTRAINT freshness_state_state_check;   -- default name; verify at implementation
ALTER TABLE ops.freshness_state ADD CONSTRAINT freshness_state_state_check CHECK (
     (series_id IS NULL     AND state IN ('fresh','late','stale','broken'))
  OR (series_id IS NOT NULL AND state IN ('current','awaiting_release','late','stale')));
ALTER TABLE ops.freshness_state ADD CONSTRAINT freshness_state_series_complete CHECK (
  series_id IS NULL OR (
        run_id IS NOT NULL AND basis IS NOT NULL AND tolerance_days IS NOT NULL AND grace_days IS NOT NULL
    AND fetch_broken IS NOT NULL AND is_core IS NOT NULL AND known_stale IS NOT NULL AND group_unloaded IS NOT NULL
    AND tolerance_days <= grace_days
    AND ((state = 'current') = (overdue_days IS NULL)          -- I-FRESH-3
         OR (state = 'stale' AND expected_release_on IS NULL))));   -- the "no data" exemption
CREATE UNIQUE INDEX freshness_state_run_series ON ops.freshness_state (run_id, series_id) WHERE series_id IS NOT NULL;
CREATE INDEX freshness_state_series_latest ON ops.freshness_state (series_id, freshness_id DESC) WHERE series_id IS NOT NULL;

-- 3. Append-only (same guard as export_status, 0004)
CREATE TRIGGER freshness_state_append_only BEFORE UPDATE OR DELETE ON ops.freshness_state
  FOR EACH ROW EXECUTE FUNCTION ops.fn_append_only();
CREATE TRIGGER freshness_state_no_truncate BEFORE TRUNCATE ON ops.freshness_state
  FOR EACH STATEMENT EXECUTE FUNCTION ops.fn_append_only();

-- 4. Per-series current state: rows of the newest evaluating run (written in ONE transaction per run, so the run is complete)
CREATE VIEW ops.v_freshness_series_latest AS
SELECT f.freshness_id, f.run_id, f.evaluated_at, f.source_group, f.series_group, f.series_id, f.basis, f.state,
       f.expected_period_end, f.latest_period_end, f.latest_edition_date, f.expected_release_on, f.overdue_days,
       f.tolerance_days, f.grace_days, f.fetch_broken, f.is_core, f.known_stale, f.group_unloaded
  FROM ops.freshness_state f
 WHERE f.series_id IS NOT NULL
   AND f.run_id = (SELECT x.run_id FROM ops.freshness_state x WHERE x.series_id IS NOT NULL
                    ORDER BY x.freshness_id DESC LIMIT 1);

-- 5. Group roll-up; same first six columns as 0009, extra columns appended (CREATE OR REPLACE keeps owner and grants)
CREATE OR REPLACE VIEW ops.v_freshness_latest AS
WITH s AS (SELECT * FROM ops.v_freshness_series_latest),
g AS (
  SELECT source_group, series_group,
         max(evaluated_at) AS evaluated_at, max(expected_period_end) AS expected_period_end,
         max(latest_period_end) AS latest_period_end, min(expected_release_on) AS expected_release_on,
         count(*) AS n_series,
         count(*) FILTER (WHERE NOT known_stale) AS n_voting,
         count(*) FILTER (WHERE NOT known_stale AND state = 'current')          AS n_current,
         count(*) FILTER (WHERE NOT known_stale AND state = 'awaiting_release') AS n_awaiting_release,
         count(*) FILTER (WHERE NOT known_stale AND state = 'late')             AS n_late,
         count(*) FILTER (WHERE NOT known_stale AND state = 'stale')            AS n_stale,
         coalesce(bool_or(fetch_broken AND is_core AND NOT known_stale), false) AS core_fetch_broken
    FROM s GROUP BY source_group, series_group)
SELECT source_group, series_group, evaluated_at, expected_period_end, latest_period_end,
       CASE WHEN core_fetch_broken                                  THEN 'broken'
            WHEN n_voting > 0 AND n_stale::numeric / n_voting > 0.20 THEN 'stale'
            WHEN n_late > n_current + n_awaiting_release            THEN 'late'
            WHEN n_awaiting_release > n_current                     THEN 'awaiting_release'
            ELSE 'current' END AS state,
       expected_release_on, n_series, n_voting, n_current, n_awaiting_release, n_late, n_stale
  FROM g;

-- 6. Grants (test-database suffix pattern of 0006/0009 applies)
GRANT SELECT ON ops.v_freshness_series_latest TO mm_ingest, mm_analytics;      -- NOT mm_reader
GRANT USAGE  ON SEQUENCE ops.freshness_state_freshness_id_seq TO mm_ingest;
-- mm_ingest keeps SELECT, INSERT on the table (0006 table-level grant covers the new columns); mm_reader keeps SELECT on ops.v_freshness_latest
```

Notes:
- `CREATE OR REPLACE VIEW` is allowed here because the new query keeps the same first six column names, order and types and only appends columns; ownership and grants are preserved [PostgreSQL CREATE VIEW, https://www.postgresql.org/docs/current/sql-createview.html, accessed 2026-11-04]. The state expression returns `text`, like the old `state` column.
- Adding an identity column rewrites the table and its indexes once; adding nullable columns without a default does not [PostgreSQL ALTER TABLE, https://www.postgresql.org/docs/current/sql-altertable.html, accessed 2026-11-04]. The table is expected to be empty or tiny (the monitor CLI wiring was not done at T64; production content [UNVERIFIED], not queried).
- The legacy primary key and CHECK constraint names are PostgreSQL defaults from 0004 and must be confirmed with `\d ops.freshness_state` when the migration is written; the migration must fail loudly, not guess, if they differ.
- Legacy group rows (`series_id IS NULL`) are never read by the new views and are never deleted (append-only).
- `mm_reader` sees only group-level rows (the same exposure as today: source id, group id, state and dates, no values). Per-series rows reveal which series exist, so they are not granted to the reader.
- Retention: about one row per series per run, order of 40,000 rows per year at one run a month and about 3,500 series [analyst estimate, unmeasured]; no pruning is specified (DB-02 watches the size).

### 4.1 Invariants
- I-FRESH-1: at most one row per `(run_id, series_id)`; rows are never updated or deleted.
- I-FRESH-2: all series rows of one monitor evaluation are inserted in one transaction, so `ops.v_freshness_series_latest` is never a partial run. A re-run of the same pipeline run (same `run_id`) inserts with `ON CONFLICT (run_id, series_id) WHERE series_id IS NOT NULL DO NOTHING`: the first evaluation of a run stands.
- I-FRESH-3: `state = 'current'` exactly when `overdue_days` is NULL, except `stale` with NULL `expected_release_on` (no data).
- I-FRESH-4: `tolerance_days <= grace_days` on every series row; state is a function of `(T, latest period or edition, calendar entry, tolerance, grace)` only, so any stored row can be recomputed from its own columns plus the calendar entry.
- I-FRESH-5 (UD-3): `fetch_broken` never changes the stored series `state`; the state column holds only the four calendar-derived values.

## 5. Monitoring contract changes (validation spec)

FRESH-01 (replaces the row of section 1): one `ops.validation_result` row per group per run (subject = group id; metric = number of `stale` plus `late` voting series; detail = the counts and at most 20 series ids, core series listed first), not one row per series (3,500 rows per run would swamp the table; per-series detail is in `ops.freshness_state`). The severity of the row is the highest severity among its voting series (USER DECISION UD-2 below).

| Condition (per voting series) | Severity | Action |
|---|---|---|
| `late` (core or non-core) | warn | issue `[freshness] <group>` listing series, `overdue_days`, `group_unloaded` |
| `stale`, series is core (`is_core`) | error (UD-2) | same issue, escalated text, core series named first |
| `stale`, series is non-core | warn (UD-2) | same issue, escalated text |
| `fetch_broken` on a core series | error (unchanged) | issue |
| only `awaiting_release` or `current` | none | closes the open issue |
| `known_stale` series (any state) | info | listed in the run summary only |

"Error" blocks nothing (as for the existing `fetch_broken` error); it is louder in the issue and the dead-man ladder summary. "Core" is the existing `is_core` flag stored on the row; no new definition is introduced.

Issue wording distinguishes "source late" (`group_unloaded = 0`) from "published but not loaded" (`group_unloaded > 0`).

## 6. Config changes (source-config schema)

Section 5 of the source-config schema becomes:

```yaml
grace_defaults: {M: 45, Q: 60, A: 180, edition: 90}      # USER DECISION UD-1; reserved key, not a group id; the only place grace is set
eurostat_labour:  {frequency: M, typical_lag_days: 45, tolerance_days: 20}
worldbank_annual: {frequency: A, typical_lag_days: 300, tolerance_days: 120}      # slowness lives in typical_lag_days, not in grace
imf_weo_files:    {release_months: [4, 10], tolerance_days: 45}                   # [UNVERIFIED release months]
bis_cbpol:        {frequency: M, typical_lag_days: 20, tolerance_days: 15,
                   dates: [{period_end: 2026-09-30, release_on: 2026-10-20}],
                   known_stale: [{series_ref: "dataset|JPN.key", note: "series ended 2021-06"}]}   # illustrative
```

New validation rules (numbers continue the list of the source-config schema, whose highest rule is 33):
34. Shape of a calendar entry: exactly one of (`frequency` in `M|Q|A` with `typical_lag_days` >= 0) or `release_months` (non-empty list of 1-12); `tolerance_days` >= 0 and <= the grace default of its frequency (or of `edition`); `frequency` `D` or `W` is an error ("out of scope for v1"); a per-entry `grace_days` key is an error (grace comes only from `grace_defaults`, UD-1); `grace_defaults` has exactly the keys `M, Q, A, edition` with positive integers; unknown keys are errors; the key `grace_defaults` is not a valid group id; every other key is the id of a configured group, and every enabled group has an entry; the numbers equal the group's `freshness:` block in `sources.yaml` (equality test kept for v1, UD-5; to be removed when FU-1 is implemented).
35. `dates`: only on frequency entries; `period_end` is a period end of the entry's frequency (month end, quarter end, year end); unique; `release_on` >= `period_end`.
36. `known_stale`: list of `{series_ref, note}` with non-empty `note`; `series_ref` must be a key of the group's series map; unknown refs are errors.
37. An indicator with `release_lag_aware: true` requires a frequency entry (not `release_months`) for every group that maps a headline series to it.

## 7. Delta for the implemented module (`monitoring/freshness.py`; no code here)
1. `State` literal and `series_state` implement section 2.2 (first missing period, release date, tolerance, grace); remove the `behind >= 2` and `2 x lag + tolerance` clauses.
2. `CalendarEntry` gains the effective `grace_days` (resolved from `grace_defaults`, no per-entry override) and `dates`; `from_mapping` stops raising on `dates`; frequencies other than `M|Q|A` raise `CalendarError`.
3. Edition entries use `E_last` and the first later release month (section 2.4); `read_series_inputs` supplies `latest_edition_date` from `ingest.raw_object` joined to `ingest.raw_load` (`outcome = 'loaded'`).
4. `read_series_inputs` reads the latest version per key (`curated.v_observation_latest`) excluding `PROJ`; adds `group_unloaded` and `basis`.
5. `record_freshness` writes one row per series in one transaction with `run_id`, using `ON CONFLICT ... DO NOTHING`; the group verdict is no longer computed in Python for storage (the view does it); a pure Python roll-up remains for the issue helper and must equal the view (AC-FRESH-8). The issue helper applies the per-series severity table of section 5 (UD-2).
6. The unit test table of `tests/unit/test_monitoring_freshness.py` is replaced by the cases of section 9 (its WEO rows feed edition-month dates as `latest_period_end` and would change meaning).

## 8. Migration 0011: `ingest.v_series_deferred` (forward-only correction; USER DECISION UD-4, accepted)

Finding. The view exists since migration 0003 and equals DDL spec section 3 (read 2026-11-04). It lists a deferred series until a `loaded` or `rejected` status row exists. The loader's release path (`storage/loader.py`, `_release_one`) can end a deferral with a third status, `skipped_out_of_order` (ORD-01: the series already has an observation with `known_at` at or after the object's `fetched_at`). That row is written, but the view still lists the series. Consequences (inferred from reading `release_deferred` and the test `tests/integration/test_decide_db.py::test_released_deferral_respects_out_of_order_rule`, which asserts "repeated drains stay idempotent"): every later `load --drain` selects the pair again, re-takes the load lock, may re-stage the object from stored raw bytes (`restage`, a read from the archive when the staging rows are gone) and returns the pending reason `skipped_out_of_order` again. The skip is terminal: `curated.observation` is insert-only, so a later `known_at` never disappears. The test `test_series_deferred_view` (`tests/integration/test_ddl_ingest.py`) currently pins the old behaviour (`{"s3","s4"}`).

Decision (accepted by the user 2026-11-04): treat `skipped_out_of_order` as a terminal status in the view.

```sql
-- NNNN_series_deferred_terminal.sql  (0011 if it is the next free version)
CREATE OR REPLACE VIEW ingest.v_series_deferred AS
SELECT d.raw_id, d.series_ref, d.event_id
  FROM ingest.raw_series_status d
 WHERE d.status = 'deferred'
   AND NOT EXISTS (SELECT 1 FROM ingest.raw_series_status r
                    WHERE r.raw_id = d.raw_id AND r.series_ref = d.series_ref
                      AND r.status IN ('loaded', 'rejected', 'skipped_out_of_order'));
```
- Same three columns, names, order and types, so `CREATE OR REPLACE VIEW` is valid and keeps owner and the existing grants (`mm_ingest` SELECT, 0006) [PostgreSQL CREATE VIEW, accessed 2026-11-04]. The view stays a plain owner-rights view (no `security_invoker`), as in 0003.
- Touches no table and no row; 0003 is not edited.
- Behaviour change: the first release attempt still reports `skipped_out_of_order` once (row written, ORD-01 warn once); the pair then leaves the queue. A main-path `skipped_out_of_order` row (series with no `deferred` row) was never listed and is unaffected. `storage/replay.py` reads the status table directly and is unaffected.
- DDL spec T-DDL-8 text changes from "until a `loaded` or `rejected` status row exists" to "until a `loaded`, `rejected` or `skipped_out_of_order` status row exists".

Acceptance: AC-FRESH-9, section 9.

## 9. Acceptance criteria

AC-FRESH-1 (replaces AC-VAL-4). The table below passes as a unit test of the pure function `(calendar entry, T, latest period or edition) -> (state, expected_release_on, overdue_days)`. Entries: M = lag 45, tolerance 20, grace 45; Q = lag 60, tolerance 15, grace 60; A = lag 300, tolerance 120, grace 180; WEO = `release_months [4,10]`, tolerance 45, grace 90 (grace values are the accepted defaults, UD-1). Dates were computed by hand on 2026-11-04 and are re-checked by the test.

| # | Entry | T | Latest (period end or edition date) | First missing / release `R` | overdue | State |
|---|---|---|---|---|---|---|
| 1 | M | 2026-11-04 | 2026-08-31 | 2026-09-30 / 2026-11-14 | - | current |
| 2 | M | 2026-11-14 | 2026-08-31 | 2026-09-30 / 2026-11-14 | 0 | awaiting_release |
| 3 | M | 2026-11-04 | 2026-07-31 | 2026-08-31 / 2026-10-15 | 20 | awaiting_release |
| 4 | M | 2026-11-05 | 2026-07-31 | 2026-08-31 / 2026-10-15 | 21 | late |
| 5 | M | 2026-11-29 | 2026-07-31 | 2026-08-31 / 2026-10-15 | 45 | late |
| 6 | M | 2026-11-30 | 2026-07-31 | 2026-08-31 / 2026-10-15 | 46 | stale |
| 7 | M, Aug 2026 stored as `MISS` | 2026-11-04 | 2026-08-31 (MISS) | as case 1 | - | current |
| 8 | Q | 2026-05-29 | 2025-12-31 | 2026-03-31 / 2026-05-30 | - | current |
| 9 | Q | 2026-05-30 | 2025-12-31 | 2026-03-31 / 2026-05-30 | 0 | awaiting_release |
| 10 | Q | 2026-06-14 | 2025-12-31 | same | 15 | awaiting_release |
| 11 | Q | 2026-06-15 | 2025-12-31 | same | 16 | late |
| 12 | Q | 2026-07-29 | 2025-12-31 | same | 60 | late |
| 13 | Q | 2026-07-30 | 2025-12-31 | same | 61 | stale |
| 14 | Q, run date on a quarter end | 2026-03-31 | 2025-09-30 | 2025-12-31 / 2026-03-01 | 30 | late |
| 15 | A | 2026-10-30 | 2025-12-31 | 2026-12-31 / 2027-10-27 | - | current |
| 16 | A | 2026-10-30 | 2024-12-31 | 2025-12-31 / 2026-10-27 | 3 | awaiting_release |
| 17 | A | 2027-03-15 | 2024-12-31 | same | 139 | late |
| 18 | A | 2027-04-25 | 2024-12-31 | same | 180 | late |
| 19 | A | 2027-04-26 | 2024-12-31 | same | 181 | stale |
| 20 | WEO | 2026-03-31 | edition 2025-10-14 | R = 2026-04-01 | - | current |
| 21 | WEO | 2026-04-10 | edition 2025-10-14 | 2026-04-01 | 9 | awaiting_release |
| 22 | WEO | 2026-05-16 | edition 2025-10-14 | 2026-04-01 | 45 | awaiting_release |
| 23 | WEO | 2026-05-17 | edition 2025-10-14 | 2026-04-01 | 46 | late |
| 24 | WEO | 2026-06-30 | edition 2025-10-14 | 2026-04-01 | 90 | late |
| 25 | WEO | 2026-07-01 | edition 2025-10-14 | 2026-04-01 | 91 | stale |
| 26 | WEO | 2026-11-20 | edition 2026-04-15 | 2026-10-01 | 50 | late |
| 27 | WEO | 2026-11-20 | edition 2026-10-14 | 2027-04-01 | - | current |
| 28 | WEO | 2027-06-01 | edition 2026-04-15 | 2026-10-01 | 243 | stale |
| 29 | M with `dates` {2026-09-30 -> 2026-11-20} | 2026-11-18 | 2026-08-31 | R = 2026-11-20 (lag rule would give 2026-11-14) | - | current |
| 30 | same as 29 | 2026-11-20 | 2026-08-31 | 2026-11-20 | 0 | awaiting_release |
| 31 | M, series with no observation | 2026-11-04 | none | R NULL | NULL | stale |

AC-FRESH-2 (regression of the two inferred defects of section 1). (a) A db test loads a WEO-like group whose observations end at 2025-12-31 and whose loaded object has `edition_date` 2026-04-15, and evaluates on 2026-05-20: the state is `current` (the first release month after the edition is October 2026); evaluated on 2026-11-20 with a second loaded object of `edition_date` 2026-10-14 the state is `current` (case 27). The previous implementation would report `late` and `stale` respectively (inferred). (b) A series whose newest key was later tombstoned (`DEL`) uses the previous live period as `latest_period_end`.

AC-FRESH-3 (append-only and uniqueness; T-DDL-35). As `mm_ingest`: INSERT of a series row succeeds; a second row for the same `(run_id, series_id)` fails with a unique violation; `UPDATE`, `DELETE` and `TRUNCATE` on `ops.freshness_state` fail with `restrict_violation`; a series row with state `fresh`, or with state `broken` (UD-3: not a series state), or with state `current` and `series_id` NULL, or with `tolerance_days` above `grace_days`, or with `current` and a non-NULL `overdue_days`, is rejected by the CHECKs; a legacy-shaped row (`series_id` NULL, state `fresh`) is still accepted by the CHECK (history).

AC-FRESH-4 (views; T-DDL-36). With rows of two runs inserted, `ops.v_freshness_series_latest` returns only the rows of the newer run; `ops.v_freshness_latest` returns one row per group with the six legacy columns first, and its `state` follows section 2.8 on a fixture table of at least 8 mixes (including: all current; one awaiting among current; late majority; 21 % stale; 20 % stale (not stale); core `fetch_broken` (group state `broken` while each series state remains calendar-derived); a `known_stale` series excluded from the vote; a group of only `known_stale` series -> current).

AC-FRESH-5 (privileges; T-DDL-37). `mm_reader` can SELECT `ops.v_freshness_latest` and cannot SELECT `ops.v_freshness_series_latest` or `ops.freshness_state`; `mm_ingest` can SELECT/INSERT the table and SELECT both views; `mm_analytics` can SELECT the table and the series view; the checked-in expected matrix (`tests/fixtures/privileges/expected_matrix.csv`) contains the new view and the new sequence and `test_privileges` passes.

AC-FRESH-6 (migration; T-DDL-38). 0012 applies on an empty database and on a database containing three legacy group rows (inserted with the 0004 shape before the migration): the legacy rows survive unchanged with `series_id` NULL and are invisible to both views; the checksum guard rejects an edited 0004 or 0009; the migration list stays contiguous.

AC-FRESH-7 (calendar rules). One negative per rule 34-37: effective tolerance above the grace default of its frequency; a per-entry `grace_days` key; `grace_defaults` missing a key or with a non-positive value; unknown calendar key; enabled group without entry; calendar and `sources.yaml` `freshness` block disagree; `dates` entry not on a period end; duplicate `dates`; `known_stale` with empty `note` or unknown `series_ref`; `release_lag_aware: true` on an indicator whose group has only a `release_months` entry; frequency `D`; frequency `W`. Positive: the shipped `config/release_calendar.yaml` validates after the `grace_defaults` key is added (implementation scope).

AC-FRESH-8 (roll-up equality). For every fixture of AC-FRESH-4 the Python roll-up used by the issue helper equals the state returned by the view.

AC-FRESH-9 (`v_series_deferred`; T-DDL-39; UD-4). Extends T-DDL-8 and `test_series_deferred_view`: after inserting `deferred` rows for four refs and `loaded`, `rejected`, `skipped_out_of_order` rows for three of them the view returns only the fourth; a loader test (`test_released_deferral_respects_out_of_order_rule`) shows that the second `load --drain` does not call `restage` and writes no further row, and that the first attempt still reports `skipped_out_of_order` once and emits ORD-01 once; the view still lists a deferral whose event is open or accepted-but-unreleased. The old expectation `{"s3","s4"}` of `test_series_deferred_view` is replaced.

AC-FRESH-10 (`release_lag_aware` independence). A fixture annual indicator with `release_lag_aware: true` and a 2-year lag has `limit_source = 'release_lag_aware'` in the snapshot while its freshness state is computed from the calendar and grace table only; flipping the flag changes no row of `ops.freshness_state`.

AC-FRESH-11 (monitor end to end, db). One `monitor` evaluation on a fixture of three groups (M, Q, WEO) writes one row per mapped series in one transaction with the run's `run_id`; re-running the evaluation for the same `run_id` adds no row; the FRESH-01 `validation_result` row per group carries counts and at most 20 ids; no issue is opened for `awaiting_release`; an issue naming "published but not loaded" is produced when the group has an unloaded object.

AC-FRESH-12 (severity; UD-2, UD-3). Fixture group with series: A core `stale`, B non-core `stale`, C core `late`, D core `stale` with `known_stale = true`, E core `current` with `fetch_broken`. Results: the FRESH-01 row of a group holding only B has severity `warn`; with A added it is `error` and A is listed first; a group holding only C is `warn`; D alone gives `info` and no issue; E gives the existing `fetch_broken` `error`, and its stored `state` is `current` (flag, not a state) while the group roll-up state is `broken`. An `error` blocks no pipeline step (the run exit code and the load step are unchanged).

## 10. Questions: status after the user's answers (2026-11-04)

| # | Original question | Status |
|---|---|---|
| 1 | Grace values | CLOSED, UD-1: M 45, Q 60, A 180, editions 90; slowness through `typical_lag_days` (consequence: no per-group `grace_days` override in v1, rule 34) |
| 2 | `stale` core series as `error` | CLOSED, UD-2: core `error`, non-core `warn` |
| 3 | `fetch_broken` as flag vs fifth state | CLOSED, UD-3: flag |
| 4 | `awaiting_release` counts as healthy in the roll-up and opens no issue | OPEN (not answered; the document keeps the proposal) |
| 5 | Location and shape of `known_stale` (list inside the calendar entry) | OPEN (not answered; the document keeps the proposal) |
| 6 | Duplicate calendar numbers in `sources.yaml` and `release_calendar.yaml` | CLOSED, UD-5: equality test for v1; single source later (FU-1) |
| 7 | Daily and weekly series out of scope | CLOSED, UD-6: out of scope for v1 |
| 8 | `v_series_deferred` change | CLOSED, UD-4: accepted |
| 9 | Migration numbers 0011, 0012 | OPEN as a formality: assigned at implementation as the next free versions (not a user decision) |

Interpretation to confirm (I made it, the user did not say it): UD-1 "per-source slowness via `typical_lag_days`, not wider grace" is applied as "no per-group `grace_days` override at all" (rule 34, section 6 example changed). If you want to keep an override key for exceptional cases, say so.

## 11. Edits to apply to the base documents when this is approved
(Not applied. The tools available in the session that revised this proposal could only create or overwrite whole files, and the four base specs are large (the DDL spec alone is about 800 lines); a whole-file rewrite risked corrupting approved text. The base documents are unchanged and still `status: approved`. Applying the edits resets each to `status: draft` with a revision note, as earlier amendments did. This list is the exact remaining work.)
- `docs/specs/validation-monitoring-spec.md`: front matter `status: draft` with a note; replace section 2 by sections 2 and 3 of this document; replace the FRESH-01 row by section 5 (including the UD-2 severity table); replace AC-VAL-4 by AC-FRESH-1; add AC-FRESH-2..12 as AC-VAL-16..; add a change-log entry; add ADR-020 to `inputs`.
- `docs/specs/ddl-neon-schema.md`: front matter `status: draft`; mark the `ops.freshness_state` block and the `ingest.v_series_deferred` block as "amended by migrations 0011/0012"; add sections 4 and 8 of this document as a new section 11; extend T-DDL-8; add T-DDL-35..39; add ADR-020 to `inputs`.
- `docs/specs/source-config-schema.md`: `status: draft`; replace section 5 by section 6 above; add rules 34-37 and AC-CFG-16 (= AC-FRESH-7).
- `docs/specs/dashboard-export-spec.md`: `status.json` `groups[]`: `state` in `current / awaiting_release / late / stale / broken`, new fields `expected_release_on`, `n_series`, `n_current`, `n_awaiting_release`, `n_late`, `n_stale` (copied from `ops.v_freshness_latest`); the enum change is a breaking change of the manifest contract (major `schema_version` bump per section 3 of that spec); no front end exists yet (`site/` is absent).
- `docs/specs/workflows-spec.md` (lines 53 and 61 contain the word "fresh") and the design document (feed-health text): check wording; not read in detail.
- ADR-007: unchanged; ADR-020 states the amendment.
- Implementation-phase items (data-engineer, after approval; not done here): add the `grace_defaults` key to `config/release_calendar.yaml`; rename nothing else in config.

## 12. Follow-ups (recorded, not part of v1)
- FU-1 (UD-5): make `config/release_calendar.yaml` the single source of `typical_lag_days` and `tolerance_days`: remove the group `freshness:` blocks from `sources.yaml`, change source-config rule 7, delete the equality test of rule 34. Needs its own ADR/amendment after v1.
- FU-2 (UD-6): daily and weekly series need a business-day/holiday rule for release dates, a grace table for `D` and `W`, and a loader change; out of scope until the user adds such series to the indicator list.
