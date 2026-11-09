import {STALE_BANNER, STALE_BANNER_UNREADABLE} from "./copy.js";

// AC-DASH-7: the stale banner is evaluated in the browser on the manifest `known_cutoff`
// (data and analysis time), not on `generated_at` (build time).
export const STALE_DAYS = 45;
const DAY_MS = 86400000;

// The one date formatter for the freshness line and the stale banner: the UTC calendar date (YYYY-MM-DD) of a stored timestamp.
// A string that does not parse is returned as stored; a non-string gives null.
// A date-time without a zone ("YYYY-MM-DD HH:MM[:SS]" or with "T") is read as UTC, so the result does not depend on the browser's timezone
// (Date.parse would read it as local time). staleness() uses the same parser.
const ZONELESS = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;
function parseStored(v) {
  if (typeof v !== "string") return NaN;
  const m = ZONELESS.exec(v);
  return Date.parse(m ? `${m[1]}T${m[2]}Z` : v);
}
export function utcDate(v) {
  if (typeof v !== "string") return null;
  const t = parseStored(v);
  return Number.isNaN(t) ? v : new Date(t).toISOString().slice(0, 10);
}

// `now` is a Date or epoch ms. A missing or unreadable cutoff counts as stale (fail loud).
export function staleness(knownCutoff, now, limitDays = STALE_DAYS) {
  const t = parseStored(knownCutoff);
  if (Number.isNaN(t)) return {stale: true, ageDays: null, knownCutoff: knownCutoff ?? null, limitDays, reason: "unreadable"};
  const ageDays = (+now - t) / DAY_MS;
  return {stale: ageDays > limitDays, ageDays, knownCutoff, limitDays, reason: ageDays > limitDays ? "old" : "fresh"};
}

export function bannerMessage(st) {
  if (!st.stale) return null;
  if (st.reason === "unreadable") return STALE_BANNER_UNREADABLE;
  return STALE_BANNER(utcDate(st.knownCutoff), Math.floor(st.ageDays), st.limitDays);
}
