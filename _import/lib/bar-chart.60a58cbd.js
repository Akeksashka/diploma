// L20 (layout amendment 4.4, 4.10; AC-DB-28; RD AC-RD-30): the "Lines" / "Bars" chart type of a single selected series. "Bars" draws one bar per stored
// period (barY of the stored `value`; an estimate or provisional bar is a hollow outline; the unit is the y-axis label). The point reader and the
// table alternative read the same points as the line view (explorer-view.js tableRowsOf), so both views list identical rows. Display only (D6):
// no value is computed, filled or interpolated; a missing period is simply not drawn. The chart type is never written to the address (PG-SERIES hash grammar).
import {DRAFT_CHART_MODES, DRAFT_CHART_TYPE_LEGEND} from "./copy.11b4a285.js";
import {isoDate} from "./explorer.8bfe86f4.js";
import {radioGroup} from "./peers-view.3517c99f.js";
import {seriesTipLines, tipText} from "./tip.5281e05d.js";
import {token} from "./tokens.0779967f.js";

export const CHART_MODE_OPTIONS = Object.freeze([{id: "lines", label: DRAFT_CHART_MODES.lines}, {id: "bars", label: DRAFT_CHART_MODES.bars}]);
export const MAX_BAR_TICKS = 10;

// The toggle applies only when exactly one series is selected (selection count, not the number that happen to have data).
export const barsAvailable = (selectedCount) => selectedCount === 1;
export const modeFor = (selectedCount, mode) => (barsAvailable(selectedCount) && mode === "bars" ? "bars" : "lines");

// The bars: the stored points of the one series that have a value, in date order (the same points as the table alternative).
export function barPoints(model) {
  const s = model.series[0];
  if (!s) return [];
  return s.lines.filter((p) => p.value !== null).map((p) => ({label: isoDate(p.ms), value: p.value, estimate: p.status === "EST" || p.status === "PROV", point: p, series: s}));
}

// At most MAX_BAR_TICKS labelled periods, evenly spaced by position (every bar is still drawn and listed in the table).
export function barTicks(labels, max = MAX_BAR_TICKS) {
  if (labels.length <= max) return labels;
  const step = Math.ceil(labels.length / max);
  return labels.filter((_, i) => i % step === 0);
}

const BASE_PLOT = {style: {fontSize: "13px", background: "transparent"}};

// `highlight` = {entity, ms} of the point chosen in "Read a value" (visual only), as in the line view. Returns null when nothing is drawn.
export function barChart(Plot, model, {highlight = null} = {}) {
  const bars = barPoints(model);
  if (bars.length === 0) return null;
  const s = model.series[0];
  const color = token("--mm-series-1");
  const bg = token("--mm-bg");
  const focus = token("--mm-focus");
  const labels = bars.map((b) => b.label);
  const title = (b) => tipText(seriesTipLines(b.point, s));
  const solid = bars.filter((b) => !b.estimate);
  const hollow = bars.filter((b) => b.estimate);
  const at = highlight && highlight.entity === s.entity ? bars.find((b) => b.point.ms === highlight.ms) : null;
  const marks = [
    Plot.ruleY([0], {stroke: token("--mm-border")}),
    Plot.barY(solid, {x: "label", y: "value", fill: color, stroke: color, strokeWidth: 1}),
    Plot.barY(hollow, {x: "label", y: "value", fill: bg, stroke: color, strokeWidth: 2}),
    ...(at ? [Plot.barY([at], {x: "label", y: "value", fill: "none", stroke: focus, strokeWidth: 3}), Plot.tip([at], {x: "label", y: "value", title, className: "mm-static-tip"})] : []),
    Plot.tip(bars, Plot.pointerX({x: "label", y: "value", title}))
  ];
  return Plot.plot({...BASE_PLOT, width: 960, height: 400, marginLeft: 64, marginBottom: 40, x: {label: null, type: "band", ticks: barTicks(labels), tickRotate: labels.length > 6 ? -40 : 0}, y: {grid: true, label: model.yLabel ?? s.unit}, marks});
}

// Radio group "Lines" / "Bars" (a fieldset with a legend; `.value` is the checked id; a bubbling "input" event on change).
export function chartModeToggle(html, {id, value = "lines", onChange = null}) {
  const el = radioGroup(html, {id, legend: DRAFT_CHART_TYPE_LEGEND, options: CHART_MODE_OPTIONS, value});
  el.addEventListener?.("change", () => onChange?.(el.value));
  return el;
}

