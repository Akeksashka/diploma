// Display text for stored codes (unit codes, seasonal adjustment, value status, load kind, transform ids) and for time-axis tick labels.
// Ukrainian tree only: in the English tree every function returns the stored code unchanged, so English output is byte-identical to before.
// Display only: logic (compatibility checks, estimate marks, SA rules) keeps reading the stored codes; a code without a dictionary entry is shown as stored.
import {i18n} from "./i18n.js";
import {dictionaries} from "../i18n/dictionaries.js";

// group: unit | seasonal | status | load | transform. Dictionary key: CODE.<group>.<code>.
export function codeText(group, code) {
  if (code === null || code === undefined || i18n.lang !== "uk") return code;
  const key = `CODE.${group}.${code}`;
  return Object.hasOwn(dictionaries.uk, key) ? i18n.t(key) : code;
}

// A stored unit_label is one unit code or several joined by ", ".
export function unitLabelText(label) {
  if (typeof label !== "string" || i18n.lang !== "uk") return label;
  return label.split(", ").map((c) => codeText("unit", c)).join(", ");
}

// Plot `x` options for a UTC time axis: in the Ukrainian tree the month names come from Intl (Plot's default is English); the English tree keeps Plot's default.
// The format follows d3's multi-scale rule: year at January, month name at the first of a month, day of month otherwise.
export function xTickFormat() {
  if (i18n.lang !== "uk") return {};
  const month = new Intl.DateTimeFormat("uk", {month: "short", timeZone: "UTC"});
  return {
    tickFormat: (d) => {
      if (!(d instanceof Date)) return String(d);
      if (d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0) return d.toISOString().slice(11, 16);
      if (d.getUTCDate() !== 1) return String(d.getUTCDate());
      return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : month.format(d).replace(/\.$/, "");
    }
  };
}
