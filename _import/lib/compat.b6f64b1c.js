// V3 (AC-V2 31, 41, 71, 76, 91): can a selection of series be shown together on one scale?
// Pure; compares stored fields only. Never parses unit_label or unit_text; no unit conversion is offered.
// A field is "absent" for a series when the key is missing, undefined or null.
// currency_basis is not compared at series level.

export const BLOCKING_FIELDS = ["unit_code", "unit_mult", "price_basis", "flow_basis", "base_period", "frequency"];
export const MARKING_FIELDS = ["seasonal_adjustment"];

const absent = (v) => v === undefined || v === null;

function compareField(list, field) {
  const present = list.filter((s) => !absent(s[field]));
  if (present.length === 0) return {state: "skipped"};
  const values = [...new Set(present.map((s) => String(s[field])))].sort();
  if (present.length < list.length) return {state: "differs", partial: true, values};
  return values.length > 1 ? {state: "differs", partial: false, values} : {state: "same"};
}

export function checkCompatible(seriesList) {
  const list = Array.isArray(seriesList) ? seriesList.filter((s) => s && typeof s === "object") : [];
  const blocked = [];
  const marked = [];
  const skipped = [];
  if (list.length >= 2) {
    for (const field of BLOCKING_FIELDS) {
      const r = compareField(list, field);
      if (r.state === "skipped") skipped.push(field);
      else if (r.state === "differs") blocked.push({field, values: r.values, absent_for_some: r.partial});
    }
    for (const field of MARKING_FIELDS) {
      const r = compareField(list, field);
      if (r.state === "skipped") skipped.push(field);
      else if (r.state === "differs") marked.push({field, values: r.values, absent_for_some: r.partial});
    }
  }
  const status = blocked.length ? "blocked" : marked.length ? "marked" : "allowed";
  return {status, blocked, marked, skipped};
}
