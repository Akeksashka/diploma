// V5 (spec 6.1, AC-V2-70, 72, 75, 77, 79): the caption block of a chart card, built from stored fields only. Pure; no DOM, no prose beyond
// the copy.js labels. A stored field that is absent prints the "not stated" marker, never an empty cell. Nothing is parsed from unit_label.
import {DRAFT_CAPTION_LABELS, DRAFT_CAPTION_LEGEND, DRAFT_CAPTION_SEASONAL, DRAFT_CAPTION_VINTAGE, DRAFT_FREQUENCY_NAMES, DRAFT_NOT_STATED, DRAFT_PERIOD_VALUE, DRAFT_TITLE_UNIT} from "./copy.11b4a285.js";
import {periodLabel} from "./period.354df927.js";
import {utcDate} from "./stale.ac9ba480.js";
import {unitText} from "./units.648eaacc.js";
import {codeText, unitLabelText, xTickFormat} from "./code-text.538effeb.js";

const present = (v) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");
// Distinct present values in A to Z order; `absent` is true when some entry had none.
const distinct = (values) => ({values: [...new Set(values.filter(present))].sort(), absent: values.some((v) => !present(v))});
const joined = ({values, absent}) => (values.length === 0 ? DRAFT_NOT_STATED : absent ? [...values, DRAFT_NOT_STATED].join(", ") : values.join(", "));

// Stored seasonal_adjustment: SA, NSA, or a stored not-applicable code; any other stored string is shown as stored.
const seasonalText = (code) => (code === "SA" || code === "NSA" ? DRAFT_CAPTION_SEASONAL[code] : /^n\/?a$/i.test(String(code).trim()) ? DRAFT_CAPTION_SEASONAL.NA : String(codeText("seasonal", code)));

// Title of a chart: the indicator name and the stored unit_label verbatim (AC-V2-72); no unit when none is stored.
export function captionTitle(indicator) {
  const name = present(indicator?.name) ? indicator.name : (indicator?.indicator_id ?? DRAFT_NOT_STATED);
  const {unit} = unitText({indicator});
  return unit ? `${name}${DRAFT_TITLE_UNIT(unit)}` : name;
}

// input: {indicator (meta/indicators row), series ([meta/series.json rows plotted]), range ({from, to}: stored ref_period_end ISO dates of the
// first and last plotted period; one date = one period), knownCutoff (manifest.known_cutoff), statuses (value_status codes present in the plot), scale (optional: the stored-extent colour scale text of a heatmap or map, AC-V2-46; no field when absent)}.
// Returns {fields: [{key, label, value}], legend: [{code, text}]}. Field order is fixed.
export function buildCaption({indicator = null, series = [], range = null, knownCutoff = null, statuses = [], scale = null} = {}) {
  const list = Array.isArray(series) ? series : [];
  const freq = distinct(list.map((s) => s?.frequency));
  const frequencyText = joined({values: freq.values.map((f) => DRAFT_FREQUENCY_NAMES[f] ?? f), absent: freq.absent});
  // Unit text: the indicator's stored unit_label, or, when the plotted series disagree or the indicator has none, each series' stored unit_code.
  const units = distinct(list.map((s) => unitText({series: s}).unit));
  const indicatorUnit = unitText({indicator}).unit;
  const unitValue = indicatorUnit ? indicatorUnit : joined(units);
  const notes = distinct(list.map((s) => unitText({series: s}).note)).values;
  const seasonal = distinct(list.map((s) => s?.seasonal_adjustment));
  const seasonalValue = joined({values: seasonal.values.map(seasonalText), absent: seasonal.absent});
  const f1 = freq.values.length === 1 ? freq.values[0] : null;
  const a = periodLabel(range?.from, f1);
  const b = periodLabel(range?.to ?? range?.from, f1);
  const periodValue = a && b ? (a === b ? a : DRAFT_PERIOD_VALUE(a, b)) : DRAFT_NOT_STATED;
  const sources = distinct(list.map((s) => s?.source_name));
  const cutoff = utcDate(knownCutoff);
  const L = DRAFT_CAPTION_LABELS;
  const fields = [
    {key: "indicator", label: L.indicator, value: present(indicator?.name) ? indicator.name : DRAFT_NOT_STATED},
    {key: "unit", label: L.unit, value: notes.length ? `${unitValue} (${notes.join(", ")})` : unitValue},
    {key: "frequency", label: L.frequency, value: frequencyText},
    {key: "seasonal", label: L.seasonal, value: seasonalValue},
    {key: "period", label: L.period, value: periodValue},
    ...(present(scale) ? [{key: "scale", label: L.scale, value: scale}] : []),
    {key: "source", label: L.source, value: joined(sources)},
    {key: "vintage", label: L.vintage, value: cutoff ? DRAFT_CAPTION_VINTAGE(cutoff) : DRAFT_NOT_STATED}
  ];
  const legend = [...new Set(statuses)].filter((c) => c in DRAFT_CAPTION_LEGEND).sort().map((code) => ({code, text: DRAFT_CAPTION_LEGEND[code]}));
  return {fields, legend};
}
