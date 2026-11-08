---
status: approved   # approved by the user on 2026-10-25 (stated in session) after read-only review
---
# ADR-017: Named-edition groups (IMF WEO) are not a re-estimation family; their mass-revision check reports and never blocks (amends the REV-01 scope of ADR-007)

Date: 2026-10-25 (Phase 2 amendment batch). Facts from the design (section 14, Q37 and section 14b), the validation spec (REV-01, REV-06, interplay paragraph), the source-config spec (WEO example, rules 10 and 18), the DDL spec (`ref.series_group`) and the v1 plan (BL-05), read 2026-10-25.

## Context
- The user decided (Q37, recorded 2026-10-24 and restated 2026-10-25): IMF WEO is handled as NAMED EDITIONS (`vintage_label` per edition), not as a re-estimation family.
- Documents disagree (plan BL-05): design 14b says named editions; the source-config WEO example and the REV-06 row of the validation spec say `reestimating: true`, `snapshot_mode: none`, because "every edition revises history and rebases (PPP benchmarks) can move most keys".
- With `reestimating: false`, REV-01 applies: more than 20 % of existing keys materially revised blocks the object (`drift_event(mass_revision)`, object stays unloaded). A WEO edition that rebases history would then be blocked by the generic rule, contrary to the intent that every edition is stored.
- The WEO group is already marked `edition_ordered: true` (manual group whose objects carry `edition_date`, ADR-005/P22), and the PROJ rows are compared by `vintage_label` so a new edition always adds its own rows.

## Options considered
1. Keep `reestimating: true` for WEO. Contradicts the user's decision; it also stores WEO revisions with `revision_class = 'reestimation'`, hiding them from the "regular" revision view.
2. `reestimating: false` and leave REV-01 as is. A rebased edition is blocked and a human must decide each time.
3. `reestimating: false`, and a distinct check REV-07 for `edition_ordered` groups that counts the same material revisions but is report-only. REV-01 does not apply to those groups.
4. A new group key `mass_revision_action: block | report`. More general, but a new config key and a new DDL column for a single group.

## Decision
Option 3.
1. WEO group configuration: `reestimating: false`, `snapshot_mode: none`, `edition_ordered: true`; no `max_revised_rows`.
2. The class of a raw object is chosen once, by group: `reestimating` -> REV-06; `edition_ordered` -> REV-07; otherwise REV-01. `reestimating` and `edition_ordered` are mutually exclusive: config validation rule 27 and a DDL CHECK on `ref.series_group` reject a group with both.
3. REV-07 counts material revisions with the same materiality definition as REV-01 (DDL I-CUR-3), records count and share in `raw_load.detail` and in `ops.validation_result`, and has severity `info` below 20 % and `warn` at or above. It never raises a `mass_revision` drift event and never blocks the object. Revisions are stored with `revision_class = 'regular'`.
4. REV-01 therefore cannot block a rebased edition. Other protections remain: PARSE and META checks, WEO-01 (missing `Estimates Start After`), SEM-03 (unit sanity), COMP-01/02, the edition-order rule ORD-03, and the storage guard DB-05 (`max_insert_rows_per_load`, default 100,000). A WEO edition for 45 entities and the mapped WEO variables is expected to be far below that cap even if every key is revised [analyst estimate, unmeasured]; if a future mapping makes a rebase approach the cap, the group sets its own `max_insert_rows_per_load` (a config change, not a design change).

## Consequences
- Pro: the user's Q37 decision is implemented without a new DDL column; edition revisions are visible in the regular revision view with their edition label; no human decision is needed for a rebase.
- Con: a corrupt WEO file with mass changes loads (with a `warn`) instead of being blocked by REV-01; mitigated by the checks listed in Decision 4 and by the revision history (nothing is overwritten, a bad edition is superseded by the next object). The new check and one DDL CHECK are added.
- ADR-007 stays `approved` and its text unchanged; this ADR amends only the scope sentence of REV-01 ("groups without the `reestimating` flag") to "groups with neither `reestimating` nor `edition_ordered`".
- Documents changed: validation spec (REV-01, REV-06, REV-07, interplay, AC-VAL-3, AC-VAL-14), source-config spec (WEO example, rule 27, AC-CFG-9), DDL spec (CHECK, T-DDL-30), ingestion spec (step 5, AC-ING-10), workflows spec (`load` row, AC-WF-12), design (Q37), parameters spec (section 9).
