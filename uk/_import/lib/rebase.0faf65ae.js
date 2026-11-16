// Display-only rebase to 100 at a chosen period (AC-DASH-6; pure scaling, value / base * 100).
// `rows` are {period, value, ...}; the base is the value at `basePeriod`. The base must be a finite
// number greater than zero: with a missing, zero or negative base an index is meaningless, so every
// value is null (never zero, never a sign flip). The Python reference with the same rule is in
// tests/unit/test_rebase_golden.py; the checked-in golden file is tests/fixtures/site_spike/rebase_golden.json.
// A1.5 (ADR-037, spec 6.4 as replaced): the rebase control is offered only when stored metadata marks the indicator as an index: `scale_hint === "index"`
// (CR-18). Today's export has no such field, so the answer is false for every indicator, including one whose series carries a base_period and one whose
// unit_label reads "index" (neither identifies an index; a wrong rebase draws a false chart). The text of unit_label or unit_text is never read.
export const rebaseOffered = (indicator) => indicator?.scale_hint === "index";

export function isRebasable(base) {
  return typeof base === "number" && Number.isFinite(base) && base > 0;
}

export function rebase(rows, basePeriod) {
  const base = rows.find((r) => r.period === basePeriod)?.value;
  if (!isRebasable(base)) return rows.map((r) => ({...r, value: null}));
  return rows.map((r) => ({...r, value: r.value == null ? null : (r.value / base) * 100}));
}
