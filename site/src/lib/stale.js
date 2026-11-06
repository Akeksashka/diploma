// AC-DASH-7: the stale banner is evaluated in the browser on the manifest `known_cutoff`
// (data and analysis time), not on `generated_at` (build time).
export const STALE_DAYS = 45;
const DAY_MS = 86400000;

// `now` is a Date or epoch ms. A missing or unreadable cutoff counts as stale (fail loud).
export function staleness(knownCutoff, now, limitDays = STALE_DAYS) {
  const t = typeof knownCutoff === "string" ? Date.parse(knownCutoff) : NaN;
  if (Number.isNaN(t)) return {stale: true, ageDays: null, knownCutoff: knownCutoff ?? null, limitDays, reason: "unreadable"};
  const ageDays = (+now - t) / DAY_MS;
  return {stale: ageDays > limitDays, ageDays, knownCutoff, limitDays, reason: ageDays > limitDays ? "old" : "fresh"};
}

export function bannerMessage(st) {
  if (!st.stale) return null;
  if (st.reason === "unreadable") return `Data freshness unknown: the build has no readable known_cutoff (${st.knownCutoff ?? "missing"}). Treat the data as out of date.`;
  return `Data may be out of date: the latest data cutoff (known_cutoff ${st.knownCutoff}) is ${Math.floor(st.ageDays)} days old, older than ${st.limitDays} days.`;
}
