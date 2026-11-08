// Redesign R10 (spec C-IND-3, AC-RD-25, 45): the value chart of PG-INDICATOR. Horizontal bars, one per entity that has a stored
// `value`; x = that stored number; bars are filled by the percentile bin token of the stored percentile (neutral fill when the table
// shows none); the country in focus is outlined. The axis title is the indicator name and unit. Bar order is the order of the rows
// given (the sort select). Nothing is computed, ranked or aggregated here. `Plot` and `html` are passed in; imports are local only.
// R16: pointer tip (Plot tip, same words as the "Read a value" output, tip.js); `tipRow` draws one static tip while the reader has focus.
import {DRAFT_VALUE_AXIS_TITLE, DRAFT_VALUE_ESTIMATE_MARK, DRAFT_VALUE_FIGURE_LABEL} from "./copy.js";
import {chartFigure} from "./figure.js";
import {tipText, valueTipLines} from "./tip.js";
import {token} from "./tokens.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Rows drawn: those with a stored numeric value, in the given order. The label of a row is the country name; a name used twice gets
// its identifier appended so two bars never share a y position. `bin` only where the table shows a percentile (ranked or ahead).
export function valueRows(rows, focus = null) {
  const drawn = rows.filter((r) => r.hasValue && isNum(r.value));
  const names = drawn.map((r) => r.name);
  return drawn.map((r) => ({
    entityId: r.entityId,
    name: r.name,
    label: names.indexOf(r.name) !== names.lastIndexOf(r.name) ? `${r.name} (${r.entityId})` : r.name,
    value: r.value,
    valueText: r.valueText,
    periodText: r.periodText ?? r.refPeriodEnd ?? null,
    unit: r.unit,
    bin: r.state?.key === "ranked" || r.state?.key === "ahead" ? r.bin : null,
    estimate: r.estimate === true,
    inherited: r.inherited === true,
    focus: r.entityId === focus
  }));
}

export function valueChart(Plot, rows, {name, unit, tipRow = null}) {
  if (rows.length === 0) return null;
  const neutral = token("--mm-text-muted");
  const edge = token("--mm-text");
  const marked = rows.filter((r) => r.estimate || r.inherited);
  return Plot.plot({
    style: {fontSize: "14px", background: "transparent"},
    marginLeft: 150,
    marginRight: 36,
    marginBottom: 56,
    x: {grid: true, label: DRAFT_VALUE_AXIS_TITLE(name, unit), labelAnchor: "center"},
    y: {label: null, domain: rows.map((r) => r.label), step: 26},
    marks: [
      Plot.barX(rows, {x: "value", y: "label", fill: (r) => (r.bin === null ? neutral : token(`--mm-pct-${r.bin}`)), fillOpacity: (r) => (r.bin === null ? 0.45 : 1), stroke: edge, strokeWidth: 1}),
      Plot.ruleX([0], {stroke: edge}),
      Plot.text(marked, {x: "value", y: "label", text: () => DRAFT_VALUE_ESTIMATE_MARK, dx: 8, textAnchor: "start", fill: edge}),
      Plot.barX(rows.filter((r) => r.focus), {x: "value", y: "label", fill: "none", stroke: token("--mm-focus"), strokeWidth: 4}),
      Plot.tip(rows, Plot.pointerY({x: "value", y: "label", title: (r) => tipText(valueTipLines(r))})),
      ...(tipRow ? [Plot.tip(rows.filter((r) => r.entityId === tipRow), {x: "value", y: "label", title: (r) => tipText(valueTipLines(r)), className: "mm-static-tip"})] : [])
    ]
  });
}

// `<figure role="img">` with the generated label; "" when no entity has a stored value (the table lists them all).
export function valueFigure(html, Plot, rows, {name, unit, id = "value-figure", tipRow = null}) {
  const chart = valueChart(Plot, rows, {name, unit, tipRow});
  if (chart === null) return "";
  return chartFigure(html, {id, label: DRAFT_VALUE_FIGURE_LABEL(name, unit, rows.length), chart});
}
