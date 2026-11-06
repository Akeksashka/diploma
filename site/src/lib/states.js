// State vocabulary of the heatmap (brief section 5, ADR-025 decision 3, T108): one function from the stored cell or summary
// fields of scorecard.js to {key, code, signature, glyph, accessibleName}. Every state has a visible text code or a word, and a
// non-colour signature; colour is a third channel. A status that scorecard.js can assign and this module does not map throws.
// Wording comes from copy.js; nothing is computed.
import {AGGREGATE_NOT_RANKED, AHEAD_NAME, AHEAD_TAG, ALERT_LEVEL_PREFIX, DESCRIPTIVE_CELL, ESTIMATE_MARK, FLAG_ESTIMATE, FLAG_INHERITED, FLAG_LOW_COVERAGE, NO_POSITION_LOW_COVERAGE, NOT_PUBLISHED, NA, PERCENTILE_COLUMN_LABEL, STALE_NAME, STATE_CODES, STATE_LABELS, UNKNOWN_STATE, notRankedCell} from "./copy.js";

export class StateError extends Error {
  constructor(message) {
    super(message);
    this.name = "StateError";
  }
}

// One row per state of the brief section 5 table. `code`: visible text (null when the stored number or value is the content).
// `signature`: the non-colour pattern, a CSS hook (data-signature) and a test key. `glyph`: an inline SVG name or null.
const row = (code, signature, glyph = null) => Object.freeze({code, signature, glyph});
export const STATES = Object.freeze({
  ranked: row(null, "solid"),
  ahead: row(AHEAD_TAG, "solid-tag"),
  stale: row(STATE_CODES.stale, "hatch-clock", "clock"),
  lagging: row(STATE_CODES.lagging, "dotted-lagging"),
  unaligned: row(STATE_CODES.unaligned, "dotted-unaligned"),
  descriptive: row(null, "italic"),
  na: row(STATE_CODES.na, "dash", "dash"),
  not_published: row(STATE_CODES.not_published, "crossed", "crossed"),
  aggregate: row(AGGREGATE_NOT_RANKED, "group-label"),
  inherited: row(FLAG_INHERITED, "glyph-i-underline", "info"),
  low_coverage: row(FLAG_LOW_COVERAGE, "ring", "ring"),
  // Not in the brief table: a value is shown but no percentile is, and no other state explains why (unranked domain,
  // information-only scope, or a missing percentile). The value is printed on the neutral surface, as in an informational domain.
  plain: row(null, "plain")
});

// Marks that can sit beside the figure of a state (brief section 5: estimate, alert watch / alert).
export const DECORATIONS = Object.freeze({
  estimate: Object.freeze({code: ESTIMATE_MARK, signature: "e-suffix", glyph: null, name: FLAG_ESTIMATE}),
  alert_watch: Object.freeze({code: `${ALERT_LEVEL_PREFIX}watch`, signature: "triangle", glyph: "triangle", name: `${ALERT_LEVEL_PREFIX}watch`}),
  alert_alert: Object.freeze({code: `${ALERT_LEVEL_PREFIX}alert`, signature: "diamond", glyph: "diamond", name: `${ALERT_LEVEL_PREFIX}alert`})
});

// Primary state of an indicator cell of scorecard.js (see CELL_STATUSES). A cell that is not ranked can never map to
// "ranked" (AC-DASH-9): lagging and unaligned win over a percentile.
function cellKey(c) {
  switch (c.status) {
    case "not_published":
      return "not_published";
    case "missing":
      return "na";
    case "stale":
      return "stale";
    case "descriptive":
      return "descriptive";
    case "unranked":
    case "ranked": {
      if (c.alignment === "lagging") return "lagging";
      if (c.alignment === "unaligned") return "unaligned";
      if (c.status === "unranked") return c.inherited ? "inherited" : "plain";
      return c.alignment === "ahead" ? "ahead" : "ranked";
    }
    default:
      throw new StateError(`no state for cell status ${JSON.stringify(c.status)}`);
  }
}

const nameOf = (key, c) => {
  switch (key) {
    case "ranked":
      return `${c.percentileText}, ${PERCENTILE_COLUMN_LABEL}`;
    case "ahead":
      return `${c.percentileText}, ${PERCENTILE_COLUMN_LABEL}; ${AHEAD_NAME}`;
    case "stale":
      return c.staleDetail ? `${STALE_NAME} (${c.staleDetail})` : STALE_NAME;
    case "lagging":
    case "unaligned":
      return notRankedCell(key);
    case "descriptive":
      return DESCRIPTIVE_CELL;
    case "na":
      return NA;
    case "not_published":
      return NOT_PUBLISHED;
    case "inherited":
      return FLAG_INHERITED;
    default:
      return `${c.valueText}, ${c.percentileText}`;
  }
};

// Marks beside the figure: only on states that show a value.
const hasValue = (key) => key !== "na" && key !== "not_published";

export function cellState(c) {
  const key = cellKey(c);
  const decorations = [];
  if (hasValue(key) && c.estimate === true) decorations.push("estimate");
  if (hasValue(key) && c.alertLevel === "watch") decorations.push("alert_watch");
  if (hasValue(key) && c.alertLevel === "alert") decorations.push("alert_alert");
  const base = STATES[key];
  const parts = decorations.map((d) => DECORATIONS[d]);
  return {
    key,
    code: base.code,
    glyph: base.glyph,
    decorations: decorations.map((d, i) => ({key: d, ...parts[i]})),
    signature: [base.signature, ...parts.map((p) => p.signature)].join("+"),
    accessibleName: [nameOf(key, c), ...parts.map((p) => p.name)].join(", ")
  };
}

// Primary state of the domain-figure cell of a row (see SUMMARY_STATUSES).
export function summaryState(s) {
  switch (s.status) {
    case "ranked":
      return {decorations: [], key: "ranked", ...STATES.ranked, accessibleName: `${s.meanText}`};
    case "low_coverage":
      return {decorations: [], key: "low_coverage", ...STATES.low_coverage, accessibleName: `${s.meanText}, ${NO_POSITION_LOW_COVERAGE}`};
    case "n/a":
      return {decorations: [], key: "na", ...STATES.na, accessibleName: NA};
    case "aggregate":
      return {decorations: [], key: "aggregate", ...STATES.aggregate, accessibleName: AGGREGATE_NOT_RANKED};
    case "unranked_domain":
      return {decorations: [], key: "plain", ...STATES.plain, accessibleName: s.meanText};
    default:
      throw new StateError(`no state for summary status ${JSON.stringify(s.status)}`);
  }
}

// Feed states of the V5 status view (T128): the stored enum of `groups[].state`. Word = the existing STATE_LABELS wording (no new
// text). `signature`: glyph plus border pattern of the chip, unique per state, so the four differ without colour. `rank` orders
// the list from the most to the least severe; it only orders the stored enum, nothing is derived from it. An unrecognised value
// keeps the fixed UNKNOWN_STATE wording and sorts after the known problem states, before fresh.
const feed = (key, glyph, signature, rank) => Object.freeze({key, code: STATE_LABELS[key] ?? UNKNOWN_STATE, glyph, signature, rank});
export const FEED_STATES = Object.freeze({
  broken: feed("broken", "cross", "cross-solid-heavy", 0),
  stale: feed("stale", "hourglass", "hourglass-dotted", 1),
  late: feed("late", "clock", "clock-dashed", 2),
  unknown: feed("unknown", "dash", "dash-double", 3),
  fresh: feed("fresh", "check", "check-solid", 4)
});
export const FEED_GLYPH_NAMES = Object.freeze(["check", "clock", "hourglass", "cross", "dash"]);

export function feedState(value) {
  const k = typeof value === "string" && Object.hasOwn(STATE_LABELS, value) ? value : "unknown";
  return {...FEED_STATES[k], accessibleName: FEED_STATES[k].code};
}
