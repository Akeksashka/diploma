// Heatmap view-model (T110, T112): countries x columns, built from a domainView() result. Display only (D6): every bin,
// state and sort order is a function of one stored field. Bins compare the stored percentile with constant edges (bins.js);
// sorting orders by the stored percentile or the stored rank_position, never by anything computed here.
import {BinError, binLabel, binOf} from "./bins.04d14116.js";
import {comparisonSet, indicatorsOfFrequency} from "./filter-model.08517389.js";
import {cellState, summaryState} from "./states.465c23b4.js";
import {domainView} from "./scorecard.7832fb4d.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Order in which states and marks are listed in the legend.
export const LEGEND_ORDER = Object.freeze(["ahead", "stale", "lagging", "unaligned", "inherited", "descriptive", "na", "not_published", "aggregate", "low_coverage", "estimate", "alert_watch", "alert_alert"]);

// A bin only for a state that shows a stored percentile, never for an aggregate or an informational domain.
function binFor(percentile, colourable) {
  if (!colourable || !isNum(percentile)) return {bin: null, invalid: false};
  try {
    return {bin: binOf(percentile), invalid: false};
  } catch (e) {
    if (e instanceof BinError) return {bin: null, invalid: true};
    throw e;
  }
}

// `view`: domainView() result (rows, columns, ranked, name, label).
export function heatmapModel(view) {
  const informational = view.ranked === false;
  const present = new Set();
  const note = (state) => {
    present.add(state.key);
    for (const d of state.decorations ?? []) present.add(d.key);
  };
  const rows = view.rows.map((r) => {
    const aggregate = r.aggregate === true;
    const meanState = summaryState(r.summary);
    const meanBin = binFor(r.summary.meanPercentile, !informational && !aggregate && (meanState.key === "ranked" || meanState.key === "low_coverage"));
    note(meanState);
    const cells = r.cells.map((c, k) => {
      if (c === null) return null;
      let state = cellState(c);
      let b = binFor(c.percentile, !informational && !aggregate && (state.key === "ranked" || state.key === "ahead"));
      if (b.invalid) state = {...cellState({...c, status: "missing"}), invalid: true};
      note(state);
      return {cell: c, column: view.columns[k], state, bin: b.bin, binLabel: binLabel(b.bin), invalid: b.invalid};
    });
    return {entityId: r.entityId, name: r.name, aggregate, summary: r.summary, mean: {state: meanState, bin: meanBin.bin, binLabel: binLabel(meanBin.bin), invalid: meanBin.invalid}, cells};
  });
  return {
    informational,
    name: view.name,
    label: view.label,
    columns: view.columns,
    rows,
    hasBins: rows.some((r) => r.cells.some((c) => c !== null && c.bin !== null) || r.mean.bin !== null),
    states: LEGEND_ORDER.filter((k) => present.has(k))
  };
}

// ----------------------------------------------------------------------------------------------- home card (L13)
// The domainView() of the home heatmap card: rows = the comparison set (Group intersect scope: countries, the focus Country outside the
// Group, then the stored aggregates; none dropped: an entity the scorecard does not hold gets an empty stored-shape entity and shows n/a),
// columns = the Domain's indicators narrowed by Frequency (stored `frequency_set[]`; no row is removed by it). Period is not applied
// (ADR-036: it hides rows on C-RANK and C-TABLE only). Nothing is computed: rows are selected, never merged or summed.
export function cardView(scorecard, {entities = [], groups = [], indicators = [], domains = [], state = {}} = {}) {
  const set = comparisonSet({entities, groups, groupId: state.g ?? null, focusIds: state.c ?? []});
  const ids = [...set.countries, ...set.outside, ...set.references].map((e) => e.entity_id);
  const held = new Set(scorecard.entities.map((e) => e.entity_id));
  const empty = (id) => ({entity_id: id, percentile_rank: null, percentile_rank_label: scorecard.percentile_rank_label, rank_position: null, n_available: null, n_defined: null, indicators: []}); // no counts are invented: the coverage cell prints n/a
  const full = {...scorecard, entities: [...scorecard.entities, ...ids.filter((id) => !held.has(id)).map(empty)]};
  const view = domainView(full, {entities, indicators, domains});
  const inSet = new Set(ids);
  const offered = state.f ? new Set(indicatorsOfFrequency(indicators, state.f).map((i) => i.indicator_id)) : null;
  const keep = view.columns.map((c) => offered === null || offered.has(c.indicatorId));
  const pick = (list) => list.filter((_, k) => keep[k]);
  return {...view, columns: pick(view.columns), rows: view.rows.filter((r) => inSet.has(r.entityId)).map((r) => ({...r, cells: pick(r.cells)}))};
}

// ----------------------------------------------------------------------------------------------- sorting (T112)
// ADR-026 decision 7 and user decision Q3: default alphabetical (the order of model.rows); a clicked indicator column orders
// by its stored percentile, most favourable first, then reversed; the domain-figure column orders by the stored rank_position
// (1 first), nulls last as on the landing; the country column orders by name. Missing values are last in both directions.
export const SORT_START = Object.freeze({name: "asc", mean: "asc", indicator: "desc"});
const kindOf = (key) => (key === "name" || key === "mean" ? key : "indicator");

export const nextSort = (current, key) => (current?.key === key ? {key, dir: current.dir === "asc" ? "desc" : "asc"} : {key, dir: SORT_START[kindOf(key)]});

const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (x, y) => x.name.localeCompare(y.name) || x.entityId.localeCompare(y.entityId);

function sortKeyOf(model, key) {
  if (key === "mean") return (r) => r.summary.rankPosition;
  const k = model.columns.findIndex((c) => c.indicatorId === key);
  if (k === -1) throw new Error(`unknown sort key: ${key}`);
  return (r) => (r.cells[k] !== null && r.cells[k].bin !== null ? r.cells[k].cell.percentile : null);
}

// Returns the country rows in the requested order (a new array). Aggregates are not included: they stay in their own group.
export function sortRows(model, sort) {
  const rows = model.rows.filter((r) => !r.aggregate);
  const fixed = [...rows].sort(byName);
  if (!sort || sort.key === "name") return sort?.dir === "desc" ? [...fixed].reverse() : fixed;
  const get = sortKeyOf(model, sort.key);
  return fixed.sort((x, y) => {
    const a = get(x);
    const b = get(y);
    const missing = !isNum(a) || !isNum(b);
    if (missing) return isNum(a) ? -1 : isNum(b) ? 1 : byName(x, y);
    const c = order(a, b);
    return (sort.dir === "desc" ? -c : c) || byName(x, y);
  });
}
