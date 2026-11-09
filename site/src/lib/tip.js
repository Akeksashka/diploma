// Redesign R16 (spec 5.6, AC-RD-30, 30a): the ONE text source of the pointer tip, the "Read a value" output and the "View as table"
// value cell. Stored fields only, joined as text; no difference, change, rank or other arithmetic belongs here (static scan in
// tests/tip-text.test.mjs). Imports local modules only.
import {TIP_KNOWN_AT, TIP_STATUS, DRAFT_UNIT_MISSING_SENTENCE} from "./copy.js";
import {periodLabel} from "./period.js";
import {markedValue} from "./series-meta.js";

const isoDay = (ms) => (ms === null || ms === undefined ? "n/a" : new Date(ms).toISOString().slice(0, 10));

// The value as the table cell shows it: the stored (or display-only rebased) text with the estimate mark. The unit follows it.
export const pointValueText = (point) => markedValue(point.text, point.status);

// A value with its unit. A missing unit is a defect (AC-RD-42): the value is kept (AC-RD-30, same values as the table) and the
// stated defect sentence follows it; nothing throws (a throw inside a Plot title would crash the block).
export function valueWithUnit(valueText, unit) {
  if (unit === null || unit === undefined || unit === "") return `${valueText} ${DRAFT_UNIT_MISSING_SENTENCE}`;
  return `${valueText} ${unit}`;
}

// PG-SERIES: [country, period label, value with unit, status line (only EST and PROV), known_at line].
// point: {name, ms, text, status, knownAt}; series: {name, frequency, unit}.
export function seriesTipLines(point, series) {
  const status = TIP_STATUS[point.status] ?? null;
  return [
    series.name,
    periodLabel(isoDay(point.ms), series.frequency) ?? isoDay(point.ms),
    valueWithUnit(pointValueText(point), series.unit),
    ...(status === null ? [] : [status]),
    TIP_KNOWN_AT(isoDay(point.knownAt))
  ];
}

// PG-INDICATOR bar chart: [country, value with unit, period label]. row: {label, valueText, unit, periodText, estimate}.
export const valueTipLines = (row) => [row.label, valueWithUnit(row.estimate ? markedValue(row.valueText, "EST") : row.valueText, row.unit), row.periodText ?? "n/a"];

export const tipText = (lines) => lines.join("\n"); // Plot title (one line per row)
export const readerText = (lines) => lines.join("; "); // the <output>
