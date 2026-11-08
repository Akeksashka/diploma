// V4 vintage and revision view: view-model (pure). Reads revisions_recent.json and the per-indicator
// revision files (docs/specs/dashboard-export-spec.md section 7). D6: the browser shows stored fields
// only; revision_abs and revision_pct are displayed as exported and nothing here computes a rank, a
// percentile or a revision size. Ordering is the order of the export (or the stored known_at).
import {ALL_PERIODS, CHOOSE_INDICATOR_OPTION, CLASS_LABEL, EARLIEST_LABEL, KIND_LABELS, REESTIMATION_NOTE, REVISED_DATA_NOTICE, VINTAGE_TEXT} from "./copy.js";
import {listOf} from "./meta.js";
import {INTERACTION_LIMIT_BYTES, isoDate, isoMinute, nameOf as entityNameOf, num, toMs} from "./explorer.js";

export {EARLIEST_LABEL, VINTAGE_TEXT}; // FIXED vintage text (spec section 7) and its label: copy.js

export {CLASS_LABEL, REESTIMATION_NOTE, REVISED_DATA_NOTICE}; // wording confirmed at T92: copy.js
export const KIND_OPTIONS = Object.freeze(Object.entries(KIND_LABELS).map(([id, label]) => ({id, label})));
export const NO_CHOICE = "";

const text = (v) => (v === null || v === undefined ? null : String(v));
// Stored number as exported, no rounding and no arithmetic.
export const shown = (v) => (v === null || v === undefined ? "n/a" : String(v));
export const withThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pctText = (v) => (v === null ? "n/a" : `${v} %`);

function normalizeRecentRow(r) {
  return {
    indicatorId: String(r.indicator_id),
    entity: String(r.entity_id),
    seriesId: num(r.series_id),
    period: text(r.ref_period_start),
    knownAt: toMs(r.known_at),
    previous: num(r.previous_value),
    value: num(r.value),
    abs: num(r.revision_abs),
    pct: num(r.revision_pct),
    loadKind: text(r.load_kind),
    cls: text(r.revision_class)
  };
}

// revisions_recent.json -> {knownCutoff, revisions, editions}. Unknown major versions throw (listOf).
export function parseRecent(doc) {
  const revisions = listOf(doc, "revisions").map(normalizeRecentRow);
  const editions = listOf(doc, "edition_summaries").map((e) => ({
    sourceId: String(e.source_id),
    label: String(e.vintage_label),
    firstKnownAt: toMs(e.first_known_at),
    nSeries: num(e.n_series),
    nKeys: num(e.n_keys_revised),
    maxPct: num(e.max_abs_pct),
    medianPct: num(e.median_abs_pct),
    top: (e.top_revisions ?? []).map(normalizeRecentRow)
  }));
  return {knownCutoff: text(doc.known_cutoff), revisions, editions};
}

// Revision files named in the manifest. Only parquet is specified for them.
export function revisionFileEntries(manifest) {
  const out = new Map();
  for (const f of manifest.files ?? []) {
    const m = /^revisions\/([A-Za-z][A-Za-z0-9_]{0,40})\.parquet$/.exec(f.path ?? "");
    if (m) out.set(m[1], {indicatorId: m[1], path: f.path, format: f.format ?? "parquet", bytes: f.bytes ?? null});
  }
  return out;
}

export function revisionsContext({manifest, seriesMeta, entities, indicators}) {
  const indicatorById = new Map(indicators.map((i) => [i.indicator_id, i]));
  const files = new Map([...revisionFileEntries(manifest)].filter(([id]) => indicatorById.has(id)));
  return {
    files,
    indicatorById,
    entityName: new Map(entities.map((e) => [e.entity_id, e.name])),
    countryPages: new Set(entities.filter((e) => e.is_global !== true).map((e) => e.entity_id)), // R11: global entities have no country page
    indicatorPages: new Set(indicators.map((i) => i.indicator_id)), // one generated page per indicator of meta/indicators.json (prepare-data)
    seriesById: new Map(seriesMeta.map((s) => [s.series_id, s]))
  };
}

// Headline series of scored indicators only: meta/series.json lists exactly those (spec section 4).
const isHeadline = (ctx, seriesId, indicatorId) => ctx.seriesById.get(seriesId)?.indicator_id === indicatorId && ctx.indicatorById.has(indicatorId);

export const indicatorLabel = (ctx, id) => {
  const ind = ctx.indicatorById.get(id);
  return ind ? `${id} ${ind.name}` : id;
};

function recentRowView(ctx, r) {
  return {
    indicatorId: r.indicatorId,
    indicator: indicatorLabel(ctx, r.indicatorId),
    entity: r.entity,
    hasCountryPage: ctx.countryPages.has(r.entity),
    hasIndicatorPage: ctx.indicatorPages.has(r.indicatorId),
    name: entityNameOf(ctx, r.entity),
    period: r.period ?? "n/a",
    knownAt: isoMinute(r.knownAt),
    previous: shown(r.previous),
    value: r.loadKind === "tombstone" ? "removed" : shown(r.value),
    abs: shown(r.abs),
    absNum: r.abs ?? null, // stored number, for the sign and the bar scale of the view only
    pct: pctText(r.pct),
    pctNum: r.pct ?? null,
    loadKind: r.loadKind ?? "n/a",
    cls: r.cls ?? "n/a",
    clsLabel: CLASS_LABEL[r.cls] ?? r.cls ?? "n/a"
  };
}

export function editionView(ctx, e) {
  const indicatorIds = [...new Set(e.top.map((r) => r.indicatorId))].filter((id) => ctx.indicatorById.has(id)).sort();
  // Spec example: "WEO-2026-10: 8,123 keys revised in 25 series, largest change 41.7 %, median 0.9 %"
  return {
    sourceId: e.sourceId,
    label: e.label,
    firstKnownAt: isoMinute(e.firstKnownAt),
    line: `${e.label}: ${withThousands(e.nKeys ?? 0)} keys revised in ${withThousands(e.nSeries ?? 0)} series, largest change ${pctText(e.maxPct)}, median ${pctText(e.medianPct)}`,
    indicatorIds,
    top: e.top.filter((r) => isHeadline(ctx, r.seriesId, r.indicatorId)).map((r) => recentRowView(ctx, r))
  };
}

// state: {kind: "all" | "regular" | "reestimation"}. The list keeps the order of the export.
export function recentView(recent, ctx, state = {}) {
  const kind = KIND_OPTIONS.some((o) => o.id === state.kind) ? state.kind : "all";
  const headline = recent.revisions.filter((r) => isHeadline(ctx, r.seriesId, r.indicatorId));
  const rows = headline.filter((r) => kind === "all" || r.cls === kind);
  return {
    kind,
    rows: rows.map((r) => recentRowView(ctx, r)),
    nTotal: headline.length,
    nShown: rows.length,
    omitted: recent.revisions.length - headline.length,
    nReestimation: headline.filter((r) => r.cls === "reestimation").length,
    editions: recent.editions.map((e) => editionView(ctx, e)),
    knownCutoff: recent.knownCutoff
  };
}

// ---- per-indicator revision file -------------------------------------------------------------

function normalizeVersion(r) {
  return {
    entity: String(r.entity_id),
    seriesId: num(r.series_id),
    start: toMs(r.ref_period_start),
    end: toMs(r.ref_period_end),
    knownAt: toMs(r.known_at),
    releaseAt: toMs(r.source_release_at),
    label: text(r.vintage_label),
    value: num(r.value),
    status: text(r.value_status),
    loadKind: text(r.load_kind),
    base: r.is_base_version === true || r.is_base_version === 1,
    cls: text(r.revision_class),
    editionOrdered: r.edition_ordered === true || r.edition_ordered === 1,
    abs: num(r.revision_abs),
    pct: num(r.revision_pct)
  };
}

export function versionsFromTable(table) {
  const out = [];
  for (const r of table) {
    const v = normalizeVersion(r);
    if (v.start !== null && v.knownAt !== null) out.push(v);
  }
  return out;
}

// One interaction fetches the chosen indicator's revision file only; above the budget it is not fetched.
export async function loadRevisions(entry, attachment, limit = INTERACTION_LIMIT_BYTES) {
  if (!entry || !attachment) return {rows: [], error: null};
  if (typeof entry.bytes !== "number") return {rows: [], error: `The manifest gives no size for ${entry.path}; not fetched.`};
  if (entry.bytes > limit) return {rows: [], error: `${entry.path} is ${entry.bytes} bytes, above the ${limit} byte limit for one interaction; not fetched.`};
  if (entry.format !== "parquet") return {rows: [], error: `Unsupported revision file format: ${entry.format}`};
  try {
    return {rows: versionsFromTable(await attachment.parquet()), error: null};
  } catch (e) {
    return {rows: [], error: `Could not read ${entry.path}: ${e instanceof Error ? e.message : String(e)}`};
  }
}

export function indicatorChoices(ctx) {
  return [{id: NO_CHOICE, label: CHOOSE_INDICATOR_OPTION}, ...[...ctx.files.keys()].sort().map((id) => ({id, label: indicatorLabel(ctx, id)}))];
}

// Series with at least one stored version in the file, headline series only.
export function seriesChoices(ctx, indicatorId, rows) {
  const ids = [...new Set(rows.filter((r) => isHeadline(ctx, r.seriesId, indicatorId)).map((r) => r.seriesId))];
  const perEntity = new Map();
  for (const id of ids) {
    const e = ctx.seriesById.get(id).entity_id;
    perEntity.set(e, (perEntity.get(e) ?? 0) + 1);
  }
  return ids
    .map((id) => {
      const e = ctx.seriesById.get(id).entity_id;
      const base = entityNameOf(ctx, e);
      return {id: String(id), label: perEntity.get(e) > 1 ? `${base} (series ${id})` : base};
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Reference periods of the whole file (the series select can change without reloading the file).
export function periodChoices(rows) {
  const starts = [...new Set(rows.map((r) => r.start))].sort((a, b) => a - b);
  return [{id: "all", label: ALL_PERIODS}, ...starts.map((ms) => ({id: isoDate(ms), label: isoDate(ms)}))];
}

function versionView(v, i, n) {
  return {
    label: v.base ? EARLIEST_LABEL : `later version ${i + 1} of ${n}`,
    base: v.base,
    knownAt: isoMinute(v.knownAt),
    releaseAt: isoMinute(v.releaseAt),
    vintageLabel: v.label ?? "n/a",
    value: v.status === "DEL" ? "removed" : shown(v.value),
    status: v.status ?? "n/a",
    loadKind: v.loadKind ?? "n/a",
    revisedData: v.loadKind === "initial",
    abs: shown(v.abs),
    pct: pctText(v.pct),
    cls: v.cls ?? "n/a",
    clsLabel: CLASS_LABEL[v.cls] ?? v.cls ?? "n/a",
    edition: v.editionOrdered,
    knownMs: v.knownAt, // stored instant and value as plotted by the step chart; no arithmetic
    valueNum: v.status === "DEL" ? null : v.value,
    tombstone: v.status === "DEL" || v.loadKind === "tombstone"
  };
}

// state: {series: String(series_id), period: "all" | "YYYY-MM-DD"}
export function historyView(ctx, indicatorId, rows, state = {}) {
  const choices = seriesChoices(ctx, indicatorId, rows);
  const seriesId = choices.some((c) => c.id === String(state.series)) ? Number(state.series) : choices.length ? Number(choices[0].id) : null;
  if (seriesId === null) return {indicatorId, indicatorName: indicatorLabel(ctx, indicatorId), seriesId: null, caption: null, keys: [], nKeys: 0, nVersions: 0};
  const meta = ctx.seriesById.get(seriesId);
  const byKey = new Map();
  for (const r of rows) if (r.seriesId === seriesId) (byKey.get(r.start) ?? byKey.set(r.start, []).get(r.start)).push(r);
  const period = state.period && state.period !== "all" ? toMs(state.period) : null;
  const keys = [...byKey.keys()]
    .sort((a, b) => a - b)
    .filter((k) => period === null || k === period)
    .map((k) => {
      const vs = byKey.get(k).sort((a, b) => a.knownAt - b.knownAt);
      return {period: isoDate(k), periodEnd: isoDate(vs[0].end), versions: vs.map((v, i) => versionView(v, i, vs.length))};
    });
  return {
    indicatorId,
    indicatorName: indicatorLabel(ctx, indicatorId),
    seriesId,
    caption: {
      country: entityNameOf(ctx, meta.entity_id),
      seriesId,
      source: meta.source_name ?? "n/a",
      frequency: meta.frequency ?? "n/a",
      sa: meta.seasonal_adjustment ?? "n/a",
      unit: meta.unit_code ? `${meta.unit_code}${meta.unit_mult ? ` x 10^${meta.unit_mult}` : ""}` : "n/a"
    },
    keys,
    nKeys: keys.length,
    nVersions: keys.reduce((s, k) => s + k.versions.length, 0)
  };
}
