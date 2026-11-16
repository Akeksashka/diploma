import {i18n} from "./i18n.js";
import {codeText, unitLabelText} from "./code-text.js";
// Unit text selection (spec 5.2). Stored text only; nothing is rescaled or computed.
export const PERCENTILE_LABEL = i18n.t("PERCENTILE_COLUMN_LABEL"); // unitless column label (spec 5.2)

const present = (s) => typeof s === "string" && s.trim() !== "";

// Indicator-level views: meta/indicators.json `unit_label`, or null (a null is a defect, AC-RD-42).
export function indicatorUnit(indicator) {
  return present(indicator?.unit_label) ? unitLabelText(indicator.unit_label) : null;
}

// Series-level views: `unit_code`, plus "values in <unit_code> x 10^<unit_mult>" only when unit_mult is not 0.
export function multText(series) {
  const m = series?.unit_mult;
  if (!present(series?.unit_code) || typeof m !== "number" || !Number.isFinite(m) || m === 0) return null;
  return i18n.t("X_UNIT_MULT", {unit: codeText("unit", series.unit_code), mult: m});
}
export function seriesUnit(series) {
  return present(series?.unit_code) ? codeText("unit", series.unit_code) : null;
}

// Display-only rebase replaces the unit (spec 5.2).
export function rebaseUnit(basePeriod) {
  return present(basePeriod) ? i18n.t("X_UNIT_REBASE", {base: basePeriod}) : null;
}

// {unit, note}: unit text to show next to a value (null = defect) and optional unit_mult note.
// opts: {indicator, series, rebaseBase}. rebaseBase wins; then series (if given); else indicator.
export function unitText({indicator, series, rebaseBase} = {}) {
  if (rebaseBase != null) return {unit: rebaseUnit(rebaseBase), note: null};
  if (series) return {unit: seriesUnit(series), note: multText(series)};
  return {unit: indicatorUnit(indicator), note: null};
}
