// V18 to V21 (spec 4, 1.1): the selection helpers shared by the Compare charts C1 to C4. Pure; stored fields only. Nothing here computes a value: it picks
// the stored frequency, the stored series row of an (indicator, entity, frequency), the stored scorecard cell of an (entity, indicator) and the stored points of a series.
// `html` is not used; this module imports local modules only.
import {comparisonSet} from "./filter-model.js";
import {sortRows} from "./sort.js";

export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The frequency a chart draws: the Frequency control when the indicator's stored frequency_set holds it, else the first stored frequency. No resampling.
export function chosenFrequency(indicator, f = null) {
  const set = indicator?.frequency_set ?? [];
  return f && set.includes(f) ? f : (set[0] ?? null);
}

// The stored meta/series.json row of (indicator, entity) with the chosen frequency; an entity with one series of another frequency has none here.
export function seriesMetaFor(series = [], indicatorId, entityId, frequency) {
  return series.find((s) => s.indicator_id === indicatorId && s.entity_id === entityId && (frequency === null || s.frequency === frequency)) ?? null;
}

// Map entity_id -> stored scorecard cell of the indicator. The scorecards of the indicator's stored domain_ids are read in that order; the first cell found wins.
export function cellIndex(scorecards = {}, indicator = null) {
  const out = new Map();
  for (const d of indicator?.domain_ids ?? []) {
    for (const e of scorecards[d]?.entities ?? []) {
      const cell = (e.indicators ?? []).find((c) => c.indicator_id === indicator.indicator_id);
      if (cell && !out.has(e.entity_id)) out.set(e.entity_id, cell);
    }
  }
  return out;
}

// The scorecard (and its stored alignment entry) that states the indicator's reference period: the first of the indicator's domains that holds the indicator.
export function alignmentOf(scorecards = {}, indicator = null) {
  for (const d of indicator?.domain_ids ?? []) {
    const a = (scorecards[d]?.alignment ?? []).find((x) => x.indicator_id === indicator.indicator_id);
    if (a) return {domainId: d, alignment: a, ranked: scorecards[d]?.ranked === true};
  }
  return {domainId: indicator?.domain_ids?.[0] ?? null, alignment: null, ranked: false};
}

// Normalised series rows -> Map entity_id -> rows of the entity's series (by stored series_id when the file holds it, else by stored frequency), date-sorted.
export function rowsByEntity(rows = [], series = [], indicatorId, frequency) {
  const wanted = new Map();
  for (const s of series) if (s.indicator_id === indicatorId && (frequency === null || s.frequency === frequency)) wanted.set(s.entity_id, s);
  const out = new Map();
  for (const r of rows) {
    const meta = wanted.get(r.entity);
    if (!meta) continue;
    if (typeof meta.series_id === "number" && typeof r.seriesId === "number" ? r.seriesId !== meta.series_id : r.frequency !== meta.frequency) continue;
    if (!out.has(r.entity)) out.set(r.entity, []);
    out.get(r.entity).push(r);
  }
  for (const [k, v] of out) out.set(k, sortRows(v, "end", {nameKey: "entity"}));
  return out;
}

// The countries and aggregates a chart may draw: comparisonSet (Group limits the countries; aggregates are always the reference list). Global entities are never offered.
export function entitySet({entities = [], groups = [], groupId = null, focusIds = []} = {}) {
  const set = comparisonSet({entities, groups, groupId, focusIds});
  return {countries: [...set.countries, ...set.outside], references: set.references};
}

// The distinct stored value_status codes of a list of points, for the caption legend.
export const statusesOf = (points) => [...new Set(points.map((p) => p.status).filter((s) => s === "EST" || s === "PROV"))];

// Smallest and largest stored value of a list, picked by order (sort.js), never by arithmetic; null when the list has no finite value.
export function valueExtent(values = []) {
  const nums = sortRows(values.filter(isNum).map((v) => ({v})), "v").map((o) => o.v);
  return nums.length === 0 ? null : {min: nums[0], max: nums.at(-1)};
}
