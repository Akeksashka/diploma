---
status: approved   # proposed | approved | superseded. Written 2026-11-10 by the architect for planner blocker B-CNT. Approved by the user on 2026-11-10 (stated in session: "approve all, go on"), covering count plus list, the wording, and Period hiding rows on the ranked comparison card and the indicator table only.
---
# ADR-036: Hidden-rows disclosure for the Period filter (a counted, listed disclosure as the one D6 exception) (amends ADR-034 A1 item 1, layout amendment 2.2/6/7/8, redesign spec 1.1/1.6, AC-RD-50)

Date: 2026-11-10. Labels: [REPO] read in this repository this session (2026-11-10); [USER] stated by the user; [UNVERIFIED] not checked. No web source was fetched for this ADR; the WCAG reference below is cited from the published standard and was not re-read this session.

## Context
- [USER] ADR-034 Q3 answer (2026-11-10): the Period filter hides scorecard rows whose latest `ref_period_end` is outside `from`..`to`; hidden rows are "never silently dropped" and the card says "N rows hidden by the period filter" (`docs/design/adr/ADR-034-analytics-dashboard-layout-filter-bar-and-cards.md` line 100). The user's instruction for this blocker: choose the option best for a user who wants to check the data, i.e. transparency about what the filter hides.
- [REPO] D6 (`docs/specs/dashboard-redesign-spec.md` line 25, section 1.1): the browser never computes a rank, percentile, mean, position, n/N, count of entities or overall status. AC-RD-50 (line 271) enforces it by static scan; AC-DB-22 (`docs/specs/dashboard-layout-amendment.md` line 163) extends the scan to the new cards. ADR-010 decision 7 and ADR-025 Context (line 12) give the purpose: every quantity with analytic meaning (ranks, percentiles, `n_available`, alignment) is computed once in the tested pipeline from published values and stored, so the site cannot disagree with the pipeline and cannot re-derive meaning (or leak withheld data) by recomputation.
- [REPO] Planner blocker B-CNT (`docs/plans/dashboard-layout-implementation-plan.md` line 43): N is computed in the browser; D6/AC-RD-50/AC-DB-22 forbid it; the sentence was absent from amendment sections 6 and 7 at planning time, so AC-DB-34/AC-RD-62 would fail.
- [REPO] Current state: ADR-034 amendment A1 item 1 (line 109) and amendment 2.2 (line 39), 6 (line 139), 7 (line 142), AC-DB-22 (line 163) and AC-DB-36 (line 178) already carry an exception text, each marked "pending user confirmation". Code already follows it: `site/src/lib/filter-model.js` `splitByPeriod` (returns `kept` and `hidden` lists, a row without a date is never hidden) and `countPeriodHiddenRows` (= `rows.length - splitByPeriod(...).kept.length`); `site/src/lib/copy.js` line 391 `DRAFT_HIDDEN_ROWS(n)`; the scan `site/tests/ux-static.test.mjs` line 81 and lines 353-369 whitelist exactly that subtraction with seeded negatives; `site/tests/prose-scan.test.mjs` line 32 lists `DRAFT_HIDDEN_ROWS`. No view renders the sentence yet (no caller of `countPeriodHiddenRows` or `DRAFT_HIDDEN_ROWS` under `site/src`).
- [REPO] Defect found: `DRAFT_HIDDEN_ROWS(1)` returns "1 rows hidden by the period filter", and `site/tests/copy.test.mjs` line 144 asserts that text.
- [REPO] Gap found (not resolved here, see Consequences): amendment 2.4 (lines 51-52) lists Period on PG-HOME as acting on "time cards" and on PG-COUNTRY on "history panels, sparklines", while 2.2 (line 38) and AC-DB-03 (line 148) say Period hides scorecard rows. Which cards hide rows (C-RANK rows, C-TABLE rows, C-HEAT cells, C-KPI tiles) is therefore not stated consistently.

## Options considered
1. (a) Count only: the sentence "N rows hidden by the period filter", N from one whitelisted browser function (the text pending in ADR-034 A1 item 1). Meets the user's wording. Weakness for checking: the user learns how many rows are gone but not which, so they cannot verify the filter did what they meant, and N alone reads like a statistic ("3 countries are stale") with nothing to check it against.
2. (b) List only, no number: a disclosure "Rows hidden by the period filter" listing each hidden row. Strictly inside D6 (listing stored rows is selection). Best for checking, but drops the number the user asked for in Q3, and the user would count the list by hand.
3. (c) Count at export time. Rejected: `from`/`to` are chosen at run time in the browser; the export would have to store a count for every year pair x card x domain x group (and Group/Country/Frequency also change the card's row set), which is large, still a count, and needs an export change request for a view-state quantity. It also moves no meaning into the pipeline: the export would compute the same subtraction.
4. (d) Do not hide; keep out-of-range rows visible but marked "outside the selected period". Most transparent of all, needs no count, but reverses the user's explicit Q3 answer ("hides rows"). Rejected; can be raised again by the user.
5. (e) Count plus list (chosen): the sentence with N is the `<summary>` of a disclosure whose body lists exactly the rows that N counts (row name and its stored reference period). N and the list come from one `splitByPeriod` call, so N is always equal to the length of a list the user can open and check.

## Decision
1. Option (e). On every card that applies the Period row filter, when at least one loaded row is hidden, the card shows, directly under its title and before its body, a `<details class="mm-hidden-rows">` whose `<summary>` is the hidden-rows sentence and whose body is a list of the hidden rows. When N = 0 nothing is rendered (no empty element).
2. Exception wording (to be placed in redesign spec 1.1 after the D6 sentence, and referenced from AC-RD-50, AC-DB-22, AC-DB-36):
   > Exception (ADR-036): the browser may count the scorecard rows that the user's own Period filter removed from one card's loaded rows, only through the single function `countPeriodHiddenRows` in `site/src/lib/filter-model.js`, and may print that number only in the hidden-rows sentence of that card. The number describes the view, not the data: it has no denominator, share, percentage or total; it is never compared or combined across cards, entities, indicators or domains; it is never stored, written to the hash, or used to sort, select, colour or rank; and it is always shown with the list of the rows it counts. No other browser-side count of entities, rows or states exists.
3. Why this is compatible with D6's purpose: D6 keeps analytic meaning (ranks, percentiles, coverage n/N, aggregates, status) in the tested, versioned pipeline over published values. N carries no such meaning: it is the size of the difference between two row sets the browser already holds, caused by a range the user typed; it is a fact about the screen. It cannot disagree with a stored figure (there is none to disagree with) and cannot leak data (it counts rows already published and loaded). The residual risk, that N is read as a statistic about the data (for example how many countries report late), is controlled by the rules in item 2 (no denominator, no comparison, per card only) and by always showing the list, which turns the number into an index of visible, checkable items.
4. Invariants (testable):
   - I1 [amended 2026-11-13, see Amendment 1: the count function is `countHiddenRowsByReason`, which replaces `countPeriodHiddenRows`] One source: per card render, `splitByPeriod(rows, from, to)` is called once; the list renders its `hidden` array; N = `countPeriodHiddenRows(rows, from, to)` with the same arguments; N === `hidden.length` for every input (unit test). The implementation may keep the current body (rows before minus rows after).
   - I2 Inputs: the card's loaded rows after Group, Country, Domain, Indicator and Frequency filters, and `from`/`to`; nothing else. A row without a `ref_period_end` is never hidden and never counted (existing `splitByPeriod` rule).
   - I3 Visibility is decided only by `DRAFT_HIDDEN_ROWS(N) !== ""`; the view module never reads `.length` (or any other count) of the hidden list.
   - I4 [amended 2026-11-13, see Amendment 1: the list body is widened to row label, reason category, stored period or "not stated", and the stored reason sentence] The list shows stored fields only: the row's display name as on the card (entity name on C-RANK, indicator name on C-TABLE), as a link with the carried hash (`data-carry`), and the stored reference period formatted as RD 5.3. Order: by name A to Z (`sort.js`, ties by id). No value, percentile, bin colour or state chip (the user follows the link to see the row).
   - I5 Accessibility: the `<details>` sits inside a wrapper with `role="status"` so the changed sentence is announced after a filter change (WCAG 2.2 SC 4.1.3 Status Messages); the summary is keyboard-operable (native). Screen-reader behaviour of a status region containing a closed `<details>` is [UNVERIFIED] and is checked in the manual pass of AC-DB-33.
   - I6 Print: the summary sentence prints; the list prints only if the user opened it (no new print rule).
   - I7 Default Period ("All", no range): N = 0, nothing rendered.
5. Strings (DRAFT until the user confirms them, ADR-025 decision 11; `site/src/lib/copy.js`), each at most 160 characters with a 60-character name:
   - `DRAFT_HIDDEN_ROWS(n)`: n = 0 -> "" (no sentence); n = 1 -> "1 row hidden by the period filter"; n > 1 -> "<n> rows hidden by the period filter". (Fixes the "1 rows" defect.)
   - `DRAFT_HIDDEN_ROW_ITEM(name, period)`: "<name>: latest value <period>" (for example "Germany: latest value 2019 Q4").
6. [Entry name amended 2026-11-13, see Amendment 1: the one entry is `countHiddenRowsByReason`.] Static scan: the whitelist stays exactly one entry for counts in browser code, `countPeriodHiddenRows` in `lib/filter-model.js` (plus the existing calendar-arithmetic entry for presets, which is not a count). Added seeded negative: `hidden.length` (or `.length` of any filtered list) in a view module fails the AC-RD-50/AC-DB-22 scan.

## Consequences
- Positive: the user can see how many rows the filter hid and exactly which ones, with their latest period, and reach each with one click; the number is checkable against the list; D6 keeps its meaning with one narrow, tested, named exception; no export change; the code already in `filter-model.js` and the scan entry are reused unchanged.
- Negative: one more element per filtered card (a disclosure and a short list; at most the card's row count, 44 entities or about 10 indicators); one more DRAFT string; one more view-module rule (I3) in the scan.
- Risks: a reader may still treat N as a statistic; mitigated by I4 and the exception rules, not eliminated. Status-region announcement of the sentence is [UNVERIFIED] until the screen-reader pass.
- Not resolved here (needs the user or a follow-up amendment, reported, not worked around): which cards apply the Period row filter. Amendment 2.4 (lines 51-52) says "time cards" / "history panels, sparklines" while 2.2 (line 38) and AC-DB-03 (line 148) say scorecard rows are hidden. This ADR applies to whichever cards the user confirms hide rows; for C-HEAT a hidden scorecard row is a cell, not a row, and the sentence would then need different wording ("cells"), which is not proposed here. Recommendation: Period hides rows on C-RANK (PG-HOME) and C-TABLE (PG-COUNTRY, PG-HOME) only; C-HEAT and C-KPI are not row-filtered by Period.
- Supersedes: the text of ADR-034 A1 item 1 and its echoes (pending user confirmation) are replaced by this ADR on approval; ADR-034 Q3 answer is kept.

## Follow-up edits after approval (not made here; approved documents are not edited by the architect)
ADR-034 (`docs/design/adr/ADR-034-analytics-dashboard-layout-filter-bar-and-cards.md`):
- line 2 front matter: A1 item 1 -> "superseded by ADR-036 (count plus list)".
- line 12 "with the single exception of amendment A1 item 1 (hidden-row count)" -> "... of ADR-036".
- line 25 decision 3, last sentence -> "The hidden-rows disclosure (count plus list) is the one D6 exception (ADR-036)."
- line 60 supersedes table, spec row: "the hidden-row sentence" -> "the hidden-rows sentence and list item (ADR-036)".
- line 77 consequences: "one browser-side count" -> add "always shown with the list it counts (ADR-036)".
- line 78 risks: "(rows hidden, with the count shown)" -> "(rows hidden, with the count and the list shown)".
- line 109 A1 item 1: replace with a pointer to ADR-036.

Layout amendment (`docs/specs/dashboard-layout-amendment.md`):
- line 38 (2.2): "and the card says how many are hidden" -> "and the card shows the hidden-rows disclosure (ADR-036)".
- line 39 (2.2): replace the bullet with ADR-036 decisions 1, 2 and 4 (I1-I7), by reference.
- lines 51-52 and 56 (2.4): state which cards Period row-filters (user decision; recommendation in Consequences).
- line 139 (section 6): replace "the hidden-row sentence ... pending user confirmation)" with "the hidden-rows sentence `DRAFT_HIDDEN_ROWS` (singular and plural forms) and the list item `DRAFT_HIDDEN_ROW_ITEM` (ADR-036; the one count sentence)".
- line 142 (section 7): replace the hidden-row string with "1 row hidden by the period filter", "<n> rows hidden by the period filter", "<name>: latest value <period>" (ADR-036).
- line 163 (AC-DB-22): "AC-DB-36; pending user confirmation of ADR-034 A1 item 1" -> "AC-DB-36, ADR-036".
- line 178 (AC-DB-36), new text: "Hidden-rows disclosure (ADR-036): `countPeriodHiddenRows` is the single whitelisted browser-side count (inputs: the card's loaded rows and `from`/`to` only); for every unit-test input N equals `splitByPeriod(...).hidden.length`; N = 0 renders no element; N = 1 renders '1 row hidden by the period filter', N > 1 the plural; the disclosure lists exactly the hidden rows (name link with carried hash, stored reference period, A to Z) and nothing else; no percentage, share or total in any output; the view module reads no `.length` of the hidden list; the AC-RD-50/AC-DB-22 scans whitelist exactly this function and fail on any other count (seeded negatives incl. `hidden.length` in a view module); the summary is inside a `role=\"status\"` wrapper. (unit, static scan, smoke)".
- line 192 (section 10, static scans row): add "no `.length` of a filtered list in view modules (36)".

Redesign spec (`docs/specs/dashboard-redesign-spec.md`):
- line 25 (1.1 D6): append the exception wording of Decision item 2.
- line 35 (1.6 closed list): add "the hidden-rows sentence and its list item (ADR-036)".
- line 271 (AC-RD-50): append "except the one function named by ADR-036".
- line 285 (AC-RD-62): no text change needed once line 35 lists the strings.
- Change log (line 299): entry for ADR-036.

Other documents:
- `docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md` line 12 (constraints): optional note "one view-state count, ADR-036". ADR-026 and ADR-030: no change (no count and no allow-list text there).
- `docs/plans/dashboard-layout-implementation-plan.md` line 43 (B-CNT) and line 49 (B-STR): for the planner to mark resolved by ADR-036 and to add the view task (disclosure, I3 scan rule, copy fix).
- Implementation (phase 4, after approval): `site/src/lib/copy.js` line 391 (singular form, new `DRAFT_HIDDEN_ROW_ITEM`), `site/tests/copy.test.mjs` line 144 (expected "1 row ..."), `site/tests/prose-scan.test.mjs` line 32 (add `DRAFT_HIDDEN_ROW_ITEM`), `site/tests/filter-model.test.mjs` lines 119-129 (I1 property), `site/tests/ux-static.test.mjs` lines 353-369 (seeded `hidden.length` negative for view modules).

## Open questions for the user
- Q1 Confirm option (e) (count plus list), or prefer (a) count only, (b) list only, or (d) keep rows visible and marked.
- Q2 Confirm the wording: "1 row hidden by the period filter" / "<n> rows hidden by the period filter" and "<name>: latest value <period>".
- Q3 Which cards does Period row-filter (recommendation: C-RANK and C-TABLE only)?

## Amendment 1 (2026-11-13): count by reason, widened list (decided by the user 2026-11-13, confirmed in chat)

Status of this section: recorded from the user's decision of 2026-11-13 (confirmed in chat); the front-matter status of this ADR is unchanged by this edit. Origin: ADR-037 A1.4 and A1.9 item 1; companion spec `docs/specs/dashboard-v2-analytical-spec.md` A1.4.
1. Function: `countHiddenRowsByReason(hidden)` in `site/src/lib/filter-model.js` takes over the single whitelist slot of `countPeriodHiddenRows` (decision 6, I1). The whitelist stays exactly one count entry. The Period-filter case is the reason category `other_period`.
2. It remains the one count exception to the no-computation rule (ADR-010 D6, exception wording of decision 2): it only tallies stored rows of the hidden array by stored reason. No rank, percentile, mean, share or total over entities. The exception rules of decision 2 (no denominator, never compared across cards, never stored or hashed) apply unchanged to every category count.
3. List body (I4 widened): row label, reason category label, stored reference period of the row's latest value (or the stored "not stated" marker), and the stored reason sentence. Still stored fields only; no value, percentile, bin colour or state chip. Order as in ADR-037 A1.4.
4. Invariants I1 to I7 otherwise stand; I1 reads "N = `total` of `countHiddenRowsByReason` on the same hidden array that renders the list". The sentence template and categories are in ADR-037 A1.4 (DRAFT strings; the user confirms wording).
5. Supersession: the name `countPeriodHiddenRows` in I1, decision 2 wording and decision 6 is replaced by `countHiddenRowsByReason`; `DRAFT_HIDDEN_ROWS` (decision 5) is superseded by the sentence of ADR-037 A1.4 on the cards ADR-037 governs.

## Sources
- [REPO] read 2026-11-10: `CLAUDE.md`; `docs/plans/dashboard-layout-implementation-plan.md` (lines 38-52); `docs/design/adr/ADR-034-analytics-dashboard-layout-filter-bar-and-cards.md`; `docs/specs/dashboard-layout-amendment.md` (sections 2, 6, 7, 8, 10); `docs/specs/dashboard-redesign-spec.md` (lines 25, 35, 271, 285); `docs/design/adr/ADR-010-interactive-dashboard.md` (decision 7, line 45); `docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md` (line 12); `site/src/lib/filter-model.js` (lines 1-3, 86-109); `site/src/lib/copy.js` (lines 372-391); `site/tests/ux-static.test.mjs` (lines 81, 353-369); `site/tests/copy.test.mjs` (lines 144, 335-336); `site/tests/filter-model.test.mjs` (lines 105-129); `site/tests/prose-scan.test.mjs` (line 32).
- W3C, Web Content Accessibility Guidelines (WCAG) 2.2, Success Criterion 4.1.3 Status Messages, https://www.w3.org/TR/WCAG22/#status-messages (cited from the standard; not fetched this session).
- [USER] ADR-034 Q3 answer (2026-11-10); task instruction for B-CNT (2026-11-10): choose the option best for a user who wants to check the data.
