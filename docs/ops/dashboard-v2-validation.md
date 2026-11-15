# Dashboard v2: manual validation checklist (V28)

For the user. Not an acceptance gate. One run per journey, on a clean browser profile (no extensions, empty storage), at a desktop width and at 320 px, once per language tree when the Ukrainian tree is published (`/` and `/uk/`). Record date, browser, language and result next to each line.

## Journey 1: "What does the data say about country X"
1. Open the site root. Find Country in the header, choose a country in the picker, press Go. Expect the country page with a stated period and no verdict wording.
2. Open a domain card; expand an indicator. Expect a stored value with unit, reference period and a stale/estimate state where it applies.
3. Check a country with sparse data. Expect hidden rows listed with a reason, not blanks.
4. Reload with JavaScript disabled. Expect the notice and static links, no broken page.

## Journey 2: "How do countries compare on Y"
1. Open Compare, choose an indicator, then a group. Expect the ranked bar and the caveat sentence once.
2. Change the period. Expect rows from other periods hidden or marked, with the period printed.
3. Choose indicators with different units. Expect the blocked message naming the stored differing fields, not a combined chart.
4. Copy the URL and open it in a new window. Expect the same state.

## Both journeys
- Keyboard only: reach every control, no trap, visible focus.
- Home default Indicator is A05 (DRAFT). With nothing chosen, Home opens on A05's domain; when A05 has no rows the cards show their own no-data state.
- Strings: every DRAFT string you see is listed in `dashboard-v2-uk-string-review.md`; mark anything that reads as a judgement.
- Ukrainian tree: entries not `reviewed` appear in English inside `lang="en"` (plan default).
