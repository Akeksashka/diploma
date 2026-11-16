// Reference-period label from `ref_period_end` (ISO date) and `frequency` (spec 5.3). Presentation only; no value changes.
// PINNED FORMATS (constants; confirmation by the user pending, spec 5.3):
export const PERIOD_FORMATS = {
  M: {example: "2026-08", pattern: "YYYY-MM"},
  Q: {example: "2026 Q3", pattern: "YYYY Qn"},
  A: {example: "2025", pattern: "YYYY"},
  D: {example: "2026-08-31", pattern: "YYYY-MM-DD"}
};
const QUARTER = {1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4, 11: 4, 12: 4};
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

// Returns null for a missing/invalid date or unknown frequency (caller shows its missing-data state).
export function periodLabel(refPeriodEnd, frequency) {
  if (typeof refPeriodEnd !== "string") return null;
  const m = ISO.exec(refPeriodEnd);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  if (month < 1 || month > 12) return null;
  switch (frequency) {
    case "M": return `${y}-${mo}`;
    case "Q": return `${y} Q${QUARTER[month]}`;
    case "A": return y;
    case "D": return `${y}-${mo}-${d}`;
    default: return null;
  }
}
