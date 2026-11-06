// Display-only rebase to 100 at a chosen period (AC-DASH-6; pure scaling, value / base * 100).
// `rows` are {period, value, ...}; the base is the value at `basePeriod`. The base must be a finite
// number greater than zero: with a missing, zero or negative base an index is meaningless, so every
// value is null (never zero, never a sign flip). The Python reference with the same rule is in
// tests/unit/test_rebase_golden.py; the checked-in golden file is tests/fixtures/site_spike/rebase_golden.json.
export function isRebasable(base) {
  return typeof base === "number" && Number.isFinite(base) && base > 0;
}

export function rebase(rows, basePeriod) {
  const base = rows.find((r) => r.period === basePeriod)?.value;
  if (!isRebasable(base)) return rows.map((r) => ({...r, value: null}));
  return rows.map((r) => ({...r, value: r.value == null ? null : (r.value / base) * 100}));
}
