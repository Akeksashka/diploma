// Per-source attribution from meta/series.json (`source_id`, `source_name`, `licence_attribution`,
// `source_url`). Only rows with publish === "public" are listed; withheld sources never appear.
export function safeUrl(u) {
  if (typeof u !== "string") return null;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : null;
  } catch {
    return null;
  }
}

// indicatorIds: optional iterable limiting the list to the sources behind those indicators.
export function sourceAttributions(series, indicatorIds = null) {
  const keep = indicatorIds ? new Set(indicatorIds) : null;
  const bySource = new Map();
  for (const s of series) {
    if (s.publish !== "public") continue;
    if (keep && !keep.has(s.indicator_id)) continue;
    const id = String(s.source_id);
    const cur = bySource.get(id) ?? {sourceId: id, name: null, attribution: null, url: null};
    cur.name ??= s.source_name ?? id;
    cur.attribution ??= s.licence_attribution ?? null;
    cur.url ??= safeUrl(s.source_url);
    bySource.set(id, cur);
  }
  return [...bySource.values()].sort((a, b) => a.name.localeCompare(b.name) || a.sourceId.localeCompare(b.sourceId));
}
