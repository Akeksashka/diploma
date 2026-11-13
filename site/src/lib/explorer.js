// V3 time-series explorer: view-model (pure; no imports except the display-only rebase).
// Reads the per-indicator series file rows (docs/specs/dashboard-export-spec.md section 6), applies the
// selectors (country, transform, date range, rebase) and returns what to draw. D6: nothing here
// computes a rank, a percentile or a transform; Level / Default / YoY are the stored columns, and the
// only arithmetic is the display-only rebase (rebase.js). Alert markers come from the stored alerts.json.
import {OTHER_INDICATORS_GROUP, DRAFT_UNIT_MISSING_SENTENCE, NOT_SHOWN_NO_BASE, NOT_SHOWN_NO_VALUES, NOT_SHOWN_TRANSFORM, NO_SERIES_FILE, REBASED_UNIT, REBASED_Y_LABEL, TRANSFORM_LABELS} from "./copy.js";
import {parseHash, serializeHash} from "./hash.js";
import {groupLabel, groupMembers} from "./peers.js";
import {indicatorUnit, rebaseUnit} from "./units.js";
import {isLevelDefault, shortUnit} from "./series-meta.js";
import {transformLabel} from "./indicator-model.js";
import {isRebasable, rebase, rebaseOffered} from "./rebase.js";

export const INTERACTION_LIMIT_BYTES = 5_000_000; // spec section 8: data fetched by one interaction
export const SA_OK = Object.freeze(["SA", "SCA"]); // analytics/transforms.py SA_OK
// Transform ids that need a seasonally adjusted series (analytics spec section 3: never MoM/QoQ on NSA).
const SA_ONLY = /^(MOM|QOQ|M3M3)/;
export const TRANSFORM_COLUMNS = TRANSFORM_LABELS; // fixed labels: copy.js
export const FACET_ABOVE = 5; // more series than this: one chart per country (brief section 6, rule 2)

export class ExplorerError extends Error {}

export const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// date32 / timestamp values arrive from Arrow as milliseconds (number), from a JSON file as ISO strings.
export function toMs(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
    return Number.isNaN(t) ? null : t;
  }
  return num(v);
}

export const isoDate = (ms) => (ms === null || ms === undefined ? "n/a" : new Date(ms).toISOString().slice(0, 10));
export const isoMinute = (ms) => (ms === null || ms === undefined ? "n/a" : `${new Date(ms).toISOString().slice(0, 16)}Z`);

function normalizeRow(r) {
  return {
    entity: String(r.entity_id),
    seriesId: num(r.series_id),
    end: toMs(r.ref_period_end),
    frequency: r.frequency == null ? null : String(r.frequency),
    value: num(r.value),
    value_default_tf: num(r.value_default_tf),
    value_yoy: num(r.value_yoy),
    status: r.value_status == null ? null : String(r.value_status),
    knownAt: toMs(r.known_at),
    loadKind: r.load_kind == null ? null : String(r.load_kind)
  };
}

// Arrow table (iterable of row proxies) -> plain rows. Rows without a period end are dropped.
export function rowsFromTable(table) {
  const out = [];
  for (const r of table) {
    const n = normalizeRow(r);
    if (n.end !== null) out.push(n);
  }
  return out;
}

// JSON fallback (manifest format "json"): a bare array of row objects or {rows: [...]} with the Parquet column names.
// The spec fixes no JSON layout for series files; this is the assumption (recorded in docs/ops/spike-results.md).
// Also accepted (the synthetic v2 fixture): {columns: [names], rows: [[values]]}, each row an array in the order of `columns`.
export function rowsFromJson(doc) {
  const list = Array.isArray(doc) ? doc : doc?.rows;
  if (!Array.isArray(list)) throw new ExplorerError("series JSON file has no rows list");
  const names = Array.isArray(doc?.columns) ? doc.columns : null;
  return rowsFromTable(names ? list.map((r) => (Array.isArray(r) ? Object.fromEntries(names.map((c, k) => [c, r[k]])) : r)) : list);
}

export function seriesFileEntries(manifest) {
  const out = new Map();
  for (const f of manifest.files ?? []) {
    const m = /^series\/([A-Za-z][A-Za-z0-9_]{0,40})\.(parquet|json)$/.exec(f.path ?? "");
    if (m) out.set(m[1], {indicatorId: m[1], path: f.path, format: f.format ?? m[2], bytes: f.bytes ?? null, rows: f.rows ?? null});
  }
  return out;
}

// One interaction fetches the chosen indicator's file only. A file above the budget is not fetched.
export async function loadSeries(entry, attachment, limit = INTERACTION_LIMIT_BYTES) {
  if (!entry || !attachment) return {rows: [], error: NO_SERIES_FILE};
  if (typeof entry.bytes !== "number") return {rows: [], error: `The manifest gives no size for ${entry.path}; not fetched.`};
  if (entry.bytes > limit) return {rows: [], error: `${entry.path} is ${entry.bytes} bytes, above the ${limit} byte limit for one interaction; not fetched.`};
  try {
    if (entry.format === "parquet") return {rows: rowsFromTable(await attachment.parquet()), error: null};
    if (entry.format === "json") return {rows: rowsFromJson(await attachment.json()), error: null};
    return {rows: [], error: `Unsupported series file format: ${entry.format}`};
  } catch (e) {
    return {rows: [], error: `Could not read ${entry.path}: ${e instanceof Error ? e.message : String(e)}`};
  }
}

export function explorerContext({manifest, seriesMeta, entities, indicators, alerts, groups = [], knownCutoff = null, domains = []}) {
  const files = seriesFileEntries(manifest);
  const indicatorList = indicators.filter((i) => files.has(i.indicator_id));
  return {
    files,
    indicators: indicatorList,
    indicatorById: new Map(indicators.map((i) => [i.indicator_id, i])),
    entityName: new Map(entities.map((e) => [e.entity_id, e.name])),
    seriesById: new Map(seriesMeta.map((s) => [s.series_id, s])),
    alerts,
    groups,
    domains,
    knownCutoff
  };
}

// Picker entry (C-SER-1): the name with the stored unit beside it, never the identifier alone.
const choiceOf = (i) => {
  const unit = indicatorUnit(i);
  return {id: i.indicator_id, label: unit ? `${i.name} (${unit})` : i.name};
};
export const indicatorChoices = (ctx) => ctx.indicators.map(choiceOf);

// Picker groups: one per domain in meta/domains.json order; an indicator sits in the first domain that lists it (once).
// Indicators with a series file that no domain lists go last. Empty groups are dropped. No domains: one group without a label.
export function indicatorGroups(ctx) {
  const byId = new Map(ctx.indicators.map((i) => [i.indicator_id, i]));
  const used = new Set();
  const out = [];
  for (const d of ctx.domains ?? []) {
    const options = [];
    for (const id of d.indicator_ids ?? []) {
      if (!byId.has(id) || used.has(id)) continue;
      used.add(id);
      options.push(choiceOf(byId.get(id)));
    }
    if (options.length) out.push({id: d.domain_id, label: d.name ?? d.domain_id, options});
  }
  const rest = ctx.indicators.filter((i) => !used.has(i.indicator_id)).map(choiceOf);
  if (rest.length) out.push({id: out.length ? "other" : "all", label: out.length ? OTHER_INDICATORS_GROUP : null, options: rest});
  return out;
}

// C-SER-2: the first indicator of the first domain.
export const firstIndicatorId = (ctx) => indicatorGroups(ctx)[0]?.options[0]?.id ?? null;

// The state read from the address (#i, #c): a valid indicator (one with a series file) and valid countries, else the default
// (first indicator, no country). `note` is true when any part was invalid and fell back. Never throws.
export function initialSelection(ctx, hash) {
  const h = parseHash(hash, {indicators: new Set(ctx.indicators.map((i) => i.indicator_id)), entities: new Set(ctx.entityName.keys())});
  return {indicator: h.i ?? firstIndicatorId(ctx), entities: h.c, note: h.note};
}

// Countries to check for `indicatorId` (R13 follow-up): the wanted countries (from the address, or the current selection when the
// indicator changes) that have rows in its series file, in the wanted order. `missing` lists the valid ids with no rows in this
// export (shown as a separate note); `dropped` is true when there are any.
export function selectedEntities(initial, indicatorId, choices) {
  const present = new Set(choices.map((c) => c.id));
  const entities = initial.entities.filter((id) => present.has(id));
  const missing = initial.entities.filter((id) => !present.has(id));
  return {entities, missing, dropped: missing.length > 0};
}

// The address that describes a selection: #i=<indicator>&c=<countries in picker order>. Only i and c are written (spec 1.5).
export function selectionHash(indicatorId, entities, order) {
  return serializeHash({i: indicatorId, c: order.filter((id) => entities.includes(id))});
}

// replaceState (not pushState, so Back leaves the page) and only when the address would change. replaceState fires no hashchange.
export function replaceHash(loc, hist, hash) {
  if (loc.hash === hash) return false;
  hist.replaceState(hist.state, "", `${loc.pathname}${loc.search}${hash}`);
  return true;
}
export const nameOf = (ctx, entity) => ctx.entityName.get(entity) ?? entity;

// The default transform needs a seasonally adjusted series when its id is MoM/QoQ-like (NSA: not offered).
export function transformAllowed(column, defaultTransform, sa) {
  if (column !== "value_default_tf") return true;
  if (!defaultTransform) return false;
  return !(SA_ONLY.test(defaultTransform) && !SA_OK.includes(sa));
}

function saOf(ctx, row) {
  return ctx.seriesById.get(row.seriesId)?.seasonal_adjustment ?? null;
}

// Options of the transform select for one indicator's rows: a column is offered only if some series may
// use it (NSA rule) and it has a value; Level is always offered when it has values.
export function transformChoices(ctx, indicatorId, rows) {
  const ind = ctx.indicatorById.get(indicatorId);
  const out = [];
  for (const [col, label] of Object.entries(TRANSFORM_COLUMNS)) {
    const usable = rows.some((r) => r[col] !== null && transformAllowed(col, ind?.default_transform, saOf(ctx, r)));
    if (!usable) continue;
    out.push({id: col, label: col === "value_default_tf" ? `${label} (${ind?.default_transform})` : label});
  }
  return out;
}

export function entityChoices(ctx, rows) {
  return [...new Set(rows.map((r) => r.entity))].map((id) => ({id, label: nameOf(ctx, id)})).sort((a, b) => a.label.localeCompare(b.label));
}

// Groups of meta/groups.json for the "select group" buttons: members on the known cutoff that have rows in this file.
export function groupChoices(ctx, choices) {
  const present = new Set(choices.map((c) => c.id));
  return ctx.groups
    .map((g) => ({id: g.group_id, label: groupLabel(g), members: [...groupMembers(g, ctx.knownCutoff)].filter((id) => present.has(id)).sort()}))
    .filter((g) => g.members.length > 0);
}

export const yearOf = (ms) => new Date(ms).getUTCFullYear();
export const yearsOf = (rows) => [...new Set(rows.map((r) => yearOf(r.end)))].sort((a, b) => a - b);
export const periodsOf = (rows) => [...new Set(rows.map((r) => r.end))].sort((a, b) => a - b).map((ms) => ({id: isoDate(ms), label: isoDate(ms)}));

// Default base period (spec 6.4): the earliest period at which EVERY shown series has a rebasable value. If the series share none (or one has none), there is no base and no
// rebase: null, never a period that only some series have.
export function autoBase(seriesList) {
  if (seriesList.length === 0) return null;
  const sets = seriesList.map((s) => new Set(s.points.filter((p) => isRebasable(p.value)).map((p) => p.ms)));
  const common = [...sets[0]].filter((ms) => sets.every((x) => x.has(ms))).sort((a, b) => a - b);
  return common.length > 0 ? common[0] : null;
}

function unitText(ctx, ind, meta, column, rebaseBase) {
  if (rebaseBase != null) return rebaseUnit(rebaseBase) ?? REBASED_UNIT;
  if (column === "value_yoy") return "% change on the same period a year earlier";
  const label = ind?.unit_label ?? null;
  // CR-6: transformed_value has no stored unit, so the default transform is named, never given the level's unit_label.
  if (column === "value_default_tf" && !isLevelDefault(ind)) return `indicator default transform ${transformLabel(ind, null)}`;
  if (meta?.unit_code) return `${meta.unit_code}${meta.unit_mult ? ` x 10^${meta.unit_mult}` : ""}${label ? ` (${label})` : ""}`;
  return label;
}

// Title and axis unit when the indicator stores none: the units of the drawn series (the same source as end labels and table),
// joined when they differ; the stated defect only when no series has one either.
function distinctText(units) {
  const have = [...new Set(units.filter((u) => u && u !== DRAFT_UNIT_MISSING_SENTENCE))];
  return have.length > 0 ? have.join("; ") : DRAFT_UNIT_MISSING_SENTENCE;
}

// Display text of a stored value: the stored number without float noise; a rebased (derived) value to one decimal.
export function valueText(v, rebased = false) {
  if (v === null || v === undefined) return "n/a";
  return rebased ? v.toFixed(1) : String(Number(v.toPrecision(10)));
}


// state: {entities: string[], transform: column, from, to (years or ""), rebase: boolean, base: "auto" | "YYYY-MM-DD"}
export function buildModel(ctx, indicatorId, rows, state) {
  const ind = ctx.indicatorById.get(indicatorId);
  const column = Object.hasOwn(TRANSFORM_COLUMNS, state.transform) ? state.transform : "value";
  const from = state.from === "" || state.from == null ? -Infinity : Number(state.from);
  const to = state.to === "" || state.to == null ? Infinity : Number(state.to);
  const chosen = new Set(state.entities ?? []);
  const byEntity = new Map();
  for (const r of rows) if (chosen.has(r.entity)) (byEntity.get(r.entity) ?? byEntity.set(r.entity, []).get(r.entity)).push(r);
  const notShown = [];
  let series = [];
  for (const entity of [...byEntity.keys()].sort((a, b) => nameOf(ctx, a).localeCompare(nameOf(ctx, b)))) {
    const rs = byEntity.get(entity).sort((a, b) => a.end - b.end);
    const last = rs[rs.length - 1];
    const meta = ctx.seriesById.get(last.seriesId) ?? null;
    const sa = meta?.seasonal_adjustment ?? null;
    const allowed = transformAllowed(column, ind?.default_transform, sa);
    const inRange = rs.filter((r) => yearOf(r.end) >= from && yearOf(r.end) <= to);
    const points = inRange.map((r) => ({ms: r.end, date: new Date(r.end), value: allowed ? r[column] : null, row: r}));
    const s = {entity, name: nameOf(ctx, entity), meta, sa, frequency: last.frequency, points};
    if (!allowed) notShown.push({entity, name: s.name, reason: NOT_SHOWN_TRANSFORM});
    else if (!points.some((p) => p.value !== null)) notShown.push({entity, name: s.name, reason: NOT_SHOWN_NO_VALUES});
    else series.push(s);
  }
  // Hue follows the order in which the countries were selected (the order of state.entities), never the data.
  const selected = (state.entities ?? []).filter((e) => series.some((s) => s.entity === e));
  series = series.map((s) => ({...s, order: selected.indexOf(s.entity)}));
  let baseMs = null;
  // A1.5: the display-only rebase runs only for an indicator the stored metadata marks as an index (scale_hint = index); otherwise the state is ignored.
  const picked = state.base && state.base !== "auto" ? toMs(state.base) : null;
  const autoMs = Boolean(state.rebase) && rebaseOffered(ind) && picked === null ? autoBase(series) : null;
  // No period common to every series and none chosen: no rebase, levels as stored (spec 6.4).
  const wantRebase = Boolean(state.rebase) && rebaseOffered(ind) && (picked !== null || autoMs !== null);
  if (wantRebase) {
    baseMs = picked ?? autoMs;
    const kept = [];
    for (const s of series) {
      const rebased = baseMs === null ? s.points.map((p) => ({...p, value: null})) : rebase(s.points.map((p) => ({...p, period: p.ms})), baseMs);
      if (!rebased.some((p) => p.value !== null)) {
        notShown.push({entity: s.entity, name: s.name, reason: NOT_SHOWN_NO_BASE});
        continue;
      }
      kept.push({...s, points: rebased});
    }
    series = kept;
  }
  const rebased = wantRebase;
  const rebaseBase = rebased && baseMs !== null ? isoDate(baseMs) : null;
  // Each series keeps its null points: a missing period stays a gap in the line (D16); nothing is filled or interpolated.
  series = series.map((s) => {
    const lines = s.points.map((p) => ({entity: s.entity, name: s.name, frequency: s.frequency, ms: p.ms, date: p.date, value: p.value, status: p.row.status, knownAt: p.row.knownAt, loadKind: p.row.loadKind, text: p.value === null ? null : valueText(p.value, rebased)}));
    const lastPt = lines.filter((p) => p.value !== null).at(-1) ?? null;
    return {...s, lines, unit: shortUnit({indicator: ind, series: s.meta, column, rebaseBase}), latest: lastPt};
  });
  const plotted = series.flatMap((s) => s.lines.filter((p) => p.value !== null));
  const markers = [];
  const unplacedAlerts = [];
  const shown = new Set(series.map((s) => s.entity));
  for (const a of ctx.alerts) {
    if (a.indicator_id !== indicatorId || !shown.has(a.entity_id)) continue;
    const ms = toMs(a.ref_period_end);
    const hit = plotted.find((p) => p.entity === a.entity_id && p.ms === ms);
    const m = {entity: a.entity_id, name: nameOf(ctx, a.entity_id), level: a.level, z: a.z, confidence: a.confidence, ref: isoDate(ms)};
    if (hit) markers.push({...m, date: hit.date, value: hit.value});
    else unplacedAlerts.push(m);
  }
  const captions = series.map((s) => {
    const lastPt = [...s.points].reverse().find((p) => p.value !== null);
    return {
      entity: s.entity,
      name: s.name,
      unit: unitText(ctx, ind, s.meta, column, rebaseBase) ?? DRAFT_UNIT_MISSING_SENTENCE,
      frequency: s.frequency ?? s.meta?.frequency ?? "n/a",
      sa: s.sa ?? "n/a",
      basePeriod: s.meta?.base_period ?? "n/a",
      source: s.meta?.source_name ?? "n/a",
      refDate: isoDate(lastPt?.ms ?? null),
      vintage: isoMinute(lastPt?.row.knownAt ?? null)
    };
  });
  return {
    indicatorId,
    indicatorName: ind?.name ?? indicatorId,
    column,
    transformLabel: TRANSFORM_COLUMNS[column],
    rebase: wantRebase,
    baseDate: baseMs === null ? null : isoDate(baseMs),
    baseMs,
    facets: series.length > FACET_ABOVE,
    yLabel: wantRebase ? (rebaseBase ? rebaseUnit(rebaseBase) : REBASED_Y_LABEL) : unitText(ctx, ind, null, column, null) ?? distinctText(captions.map((c) => c.unit)),
    titleUnit: wantRebase ? (rebaseBase ? rebaseUnit(rebaseBase) : REBASED_Y_LABEL) : shortUnit({indicator: ind, series: null, column, rebaseBase: null}) ?? distinctText(series.map((s) => s.unit)),
    series,
    plotted,
    markers,
    unplacedAlerts,
    notShown,
    captions
  };
}
