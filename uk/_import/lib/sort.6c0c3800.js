// Stable sort by a stored field: nulls last (both directions), ties by name (AC-RD-22). No rank is computed or shown.
// rows: objects; field: key (numbers compare numerically, ISO date strings lexically); dir: "asc" | "desc".
export function sortRows(rows, field, {dir = "asc", nameKey = "name"} = {}) {
  const desc = dir === "desc";
  const isNull = (v) => v == null || (typeof v === "number" && Number.isNaN(v));
  const nameOf = (r) => String(r?.[nameKey] ?? "");
  return rows
    .map((row, idx) => ({row, idx}))
    .sort((a, b) => {
      const x = a.row?.[field];
      const y = b.row?.[field];
      const nx = isNull(x);
      const ny = isNull(y);
      if (nx !== ny) return nx ? 1 : -1;
      if (!nx) {
        const c = x < y ? -1 : x > y ? 1 : 0;
        if (c !== 0) return desc ? -c : c;
      }
      const t = nameOf(a.row).localeCompare(nameOf(b.row), "en");
      if (t !== 0) return t;
      return a.idx < b.idx ? -1 : 1;
    })
    .map((e) => e.row);
}

// aria-sort value for a column header given the active sort state {field, dir}.
export function ariaSort(state, field) {
  if (!state || state.field !== field) return "none";
  return state.dir === "desc" ? "descending" : "ascending";
}
