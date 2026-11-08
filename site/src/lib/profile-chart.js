// Redesign R7 (spec C-CTRY-2): the profile chart of one domain of one country. A dot strip: one dot per indicator that has a
// stored `percentile`, x = that stored number, y = the indicator name; the five bin bands and their edges come from bins.js
// (ADR-026 decision 6). Hollow dot = estimate or inherited. Stored percentiles only; there is no axis for an average.
// Nothing is computed here: rows are filtered, never derived. `Plot` and `html` are passed in; imports are local only.
import {BIN_EDGES} from "./bins.js";
import {DRAFT_PROFILE_DOT_LABEL, DRAFT_PROFILE_FIGURE_LABEL, PERCENTILE_COLUMN_LABEL} from "./copy.js";
import {chartFigure} from "./figure.js";
import {token} from "./tokens.js";

// The five bands as constant [from, to, bin] triples (the same edges as BIN_EDGES; asserted equal in the unit test).
export const BANDS = Object.freeze([
  Object.freeze({x1: 0, x2: 0.2, bin: 1}),
  Object.freeze({x1: 0.2, x2: 0.4, bin: 2}),
  Object.freeze({x1: 0.4, x2: 0.6, bin: 3}),
  Object.freeze({x1: 0.6, x2: 0.8, bin: 4}),
  Object.freeze({x1: 0.8, x2: 1, bin: 5})
]);
export const PROFILE_TICKS = Object.freeze([0, 0.2, 0.4, 0.6, 0.8, 1]);

// Plotted entries of one domain section of countryModel(): rows whose table cell shows a percentile number (state ranked or ahead;
// a stale, lagging, unaligned or inherited cell keeps its stored percentile out of the chart, as the table shows none), in table order.
// A name used twice gets its identifier appended so that two dots never share a y position.
export function profileRows(domain) {
  const withPercentile = domain.rows.filter((r) => r.percentile !== null && (r.state?.key === "ranked" || r.state?.key === "ahead"));
  const names = withPercentile.map((r) => r.name);
  return withPercentile.map((r) => ({
    indicatorId: r.indicatorId,
    name: r.name,
    label: names.indexOf(r.name) !== names.lastIndexOf(r.name) ? `${r.name} (${r.indicatorId})` : r.name,
    percentile: r.percentile,
    percentileText: r.percentileText,
    bin: r.bin,
    hollow: r.estimate || r.inherited
  }));
}

export function profileChart(Plot, rows) {
  if (rows.length === 0) return null;
  const ink = token("--mm-pct-4");
  const guide = token("--mm-border");
  return Plot.plot({
    style: {fontSize: "14px", background: "transparent"},
    marginLeft: 230,
    marginRight: 24,
    marginBottom: 46,
    x: {domain: [0, 1], ticks: [...PROFILE_TICKS], tickFormat: ".1f", label: PERCENTILE_COLUMN_LABEL, labelAnchor: "center"},
    y: {label: null, domain: rows.map((r) => r.label), step: 30},
    marks: [
      Plot.rectX([...BANDS], {x1: "x1", x2: "x2", fill: (b) => token(`--mm-pct-${b.bin}`), fillOpacity: 0.4}),
      Plot.ruleX([...BIN_EDGES], {stroke: guide, strokeWidth: 1}),
      Plot.dot(rows, {x: "percentile", y: "label", r: 7, stroke: ink, strokeWidth: 2.5, fill: (r) => (r.hollow ? "none" : ink), title: (r) => DRAFT_PROFILE_DOT_LABEL(r.name, r.percentileText)})
    ]
  });
}

// `<figure role="img">` with the generated label; null when no indicator has a stored percentile (the table lists them all).
export function profileFigure(html, Plot, domain, countryName) {
  const rows = profileRows(domain);
  const chart = profileChart(Plot, rows);
  if (chart === null) return "";
  return chartFigure(html, {id: `profile-${domain.domainId}`, label: DRAFT_PROFILE_FIGURE_LABEL(countryName, domain.name), chart});
}
