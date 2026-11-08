---
status: approved   # Approved by the user on 2026-11-07 (stated in session: "move as recommended"). Was: drafted 2026-11-07 by the macro-data-architect from docs/ops/dashboard-redesign-decisions.md (approved by the user 2026-11-07, item "G-STALE"). Not approved: the user approves this ADR.
---
# ADR-031: Stale banner wording without the database field name (amends ADR-025 decision 10)

Date: 2026-11-07. Amends ADR-025 decision 10 ("Stale banner unchanged in wording, moved to the shell on every page") and closes the open item "stale-banner field name" carried by ADR-030. Changes nothing else in ADR-010 decision 8 (the 45-day limit and the `known_cutoff` basis are unchanged). Labels: [REPO] read in this repository on 2026-11-07; [REC] stated in `docs/ops/dashboard-redesign-decisions.md`.

## Context
- ADR-010 decision 8 puts a banner on every page when the manifest field `known_cutoff` is older than 45 days, or unreadable. ADR-025 decision 10 fixed the banner "unchanged in wording". The user confirmed both wordings on 2026-11-04 (`docs/ops/dashboard-ux-baseline.md`, as cited in [REC]).
- The shipped strings (`site/src/lib/stale.js` lines 16-17 [REPO]) print the export field name to readers:
  - `Data may be out of date: the latest data cutoff (known_cutoff <date>) is <n> days old, older than <limit> days.`
  - `Data freshness unknown: the build has no readable known_cutoff (<value or "missing">). Treat the data as out of date.`
- `known_cutoff` is the correct field: it is named so in the export spec manifest example (`docs/specs/dashboard-export-spec.md`, section 3) and `shell.js` reads it [REC]. The banner has no link, so ADR-030 decision 3's "remove the link if there is one" needs no action [REC].
- The redesign relabels the page-level freshness line "Data cut-off" (record item G-STR2; a separate string confirmation by the user). A reader then sees two terms for one thing ("data cutoff (known_cutoff ...)" in the banner, "Data cut-off" in the freshness line), and one of them is a database column name. The audience is economics students and professors (ADR-030).
- Because ADR-025 decision 10 fixes the wording, changing it is a change to an approved ADR decision, not a string edit. Hence this ADR.

## Options considered
1. Keep the banner verbatim, including `known_cutoff`. No ADR work; keeps a field name in reader-facing text and two terms for one concept. Remains the behaviour until this ADR is approved.
2. Remove only the parenthesised field name and keep "latest data cutoff". Fixes the field name; leaves the spelling "cutoff" in the banner against "cut-off" in the freshness line.
3. Reword both sentences to use the freshness-line term "data cut-off", with no field name (chosen).
4. Link the banner to an explanation. Rejected: no explanatory page exists (ADR-030 decision 6; data-only rule) and ADR-030 decision 3 requires the banner to carry no link.

## Decision
1. The banner states the same concept under the same words as the freshness line: "data cut-off". It never prints a field or column name.
2. Replacement strings (both DRAFT until the user confirms them, ADR-025 decision 11):
   ```js
   export const DRAFT_STALE_BANNER = (date, days, limit) =>
     `Data may be out of date: the data cut-off (${date}) is ${days} days old, more than ${limit} days.`;
   export const DRAFT_STALE_BANNER_UNREADABLE =
     "Data freshness unknown: this build has no readable data cut-off. Treat the data as out of date.";
   ```
   `date` is the UTC date YYYY-MM-DD (formatting only, as for the freshness line). `days` is the whole number of elapsed days as today. `limit` is the existing 45-day constant. The unreadable variant no longer prints the raw value or "missing" (it was a field value, not reader information).
3. Behaviour is unchanged: trigger condition (`known_cutoff` older than the limit, or missing or unparseable), placement in the shell on every page, `role` and no link, 45-day limit, and the reading of `manifest.json.known_cutoff`.
4. Sequencing: until this ADR is approved and the user confirms the two strings, the shipped banner stays verbatim (task R20 applies only the freshness-line change after its own confirmation). The new strings should not ship before the freshness-line label "Data cut-off" is confirmed, so that the two terms agree; if the user rejects "Data cut-off", this ADR's strings use whatever label the user confirms instead.
5. Spec and test follow-ups (no new ADR): AC-UX-8 (simulated stale `known_cutoff` gives the specified banner) and AC-UX-13 / the copy test pin the new strings verbatim; add an assertion that no banner or freshness text contains the substring `known_cutoff`. Spec `dashboard-redesign-spec.md` section 1.6 lists "the stale-banner wording (if it contains no link)" in its closed allow-list; this remains true and needs no edit.

## Consequences
- Positive: one reader-facing term for the cut-off; no database vocabulary in the UI; the change is small, isolated to `copy.js` and the tests.
- Negative: the 2026-11-04 user-confirmed banner wording is replaced, so it needs a second confirmation; the unreadable case loses the raw value, which was occasionally useful for debugging (the value remains in `manifest.json` and in the browser console if the front end logs it; not specified here).
- Work created: replace two strings and their pinned test expectations; the banner unit tests in `site/tests/` that assert the old text change with them.
- Reversal: restore the two old strings (one-file change).

## Sources
- `docs/ops/dashboard-redesign-decisions.md` (G-STALE, G-STR2), `docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md` (decision 10, AC-UX-8), `docs/design/adr/ADR-030-dashboard-redesign-user-journeys.md` (decision 3, open items), `docs/design/adr/ADR-010-interactive-dashboard.md` (decision 8), `docs/specs/dashboard-export-spec.md` (section 3), `site/src/lib/stale.js` [REPO], read 2026-11-07. No web source used.
