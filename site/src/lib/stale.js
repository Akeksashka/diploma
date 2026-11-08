import {STALE_BANNER, STALE_BANNER_UNREADABLE} from "./copy.js";

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
  if (st.reason === "unreadable") return STALE_BANNER_UNREADABLE;
  return STALE_BANNER(new Date(Date.parse(st.knownCutoff)).toISOString().slice(0, 10), Math.floor(st.ageDays), st.limitDays);
}
