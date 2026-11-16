// L19 (layout amendment 4.10, AC-DB-27, AC-DB-26; ADR-034 decision 7): small multiples of the "Over time" card when no Country is selected. Pure model; the
// block is built in series-card.js. One facet per entity of the comparison set (countries; the stored aggregates are the separate reference rows and are not
// faceted), shared y-axis and unit, entity-name title with the latest stored value as label (explorer-view.js chart(), facets form), at most
// FACET_PAGE facets before "Show more", which adds the next FACET_PAGE (no count is printed). Order: the C-RANK sort (rank-model.js buildComparison;
// countries with a value first in the chosen order, those without last by name). Data: the rows of series/<indicator_id>.parquet after "Load history"
// (phase A has no `recent` arrays, AC-DB-26). Period clips the x-domain (not a row filter here); Frequency keeps the stored `frequency`.
// D6: nothing is computed. An entity with no stored value in the file is not dropped: it is listed with the empty-card sentence.
import {buildModel} from "./explorer.8bfe86f4.js";
import {comparisonSet, indicatorsOfFrequency, seriesOfFrequency, splitByCoverage} from "./filter-model.08517389.js";
import {buildComparison, DEFAULT_RANK_SORT} from "./rank-model.390651f3.js";
import {sortRows} from "./sort.6c0c3800.js";

export const FACET_PAGE = 12;

// Ids of the entities in facet order. `rank` ({indicator, domainId, domains, scorecard, series, sort}) is optional: without a scorecard (still loading or
// failed) the order is A to Z by name, which is also the C-RANK default. Period is not passed on: facets are not hidden by it.
export function facetOrder({entities = [], groups = [], state = {}, rank = null} = {}) {
  const set = comparisonSet({entities, groups, groupId: state.g ?? null, focusIds: state.c ?? []});
  const byName = sortRows(set.countries.map((e) => ({id: e.entity_id, name: e.name ?? e.entity_id})), "name").map((r) => r.id);
  if (!rank?.scorecard || !rank.indicator) return byName;
  try {
    const m = buildComparison({indicator: rank.indicator, domainId: rank.domainId, domains: rank.domains ?? [], scorecard: rank.scorecard, entities, groups, series: rank.series ?? [], state: {...state, from: null, to: null, c: []}, sort: rank.sort ?? DEFAULT_RANK_SORT});
    const ids = m.countries.map((r) => r.entityId);
    return ids.length === byName.length ? ids : byName;
  } catch {
    return byName;
  }
}

// The facet model for the first `count` entities of `order`. `rows`: all loaded rows of the indicator.
// Returns {model, visible, noData, more}: model = buildModel() result with the faceted form forced and series in `order`; noData = visible entities
// the file holds no row for (they keep a place in the list with the empty-card sentence); more = entities remain beyond `count`.
export function multiplesModel(ectx, indicatorId, rows, state, order, count = FACET_PAGE) {
  const visible = order.slice(0, count);
  const narrowed = seriesOfFrequency(rows, state?.f ?? null);
  const model = buildModel(ectx, indicatorId, narrowed, {entities: visible, transform: "value", from: state?.from ?? "", to: state?.to ?? "", rebase: false});
  const rank = new Map(visible.map((id, i) => [id, i]));
  const series = [...model.series].sort((a, b) => rank.get(a.entity) - rank.get(b.entity)).map((s) => ({...s, order: 0}));
  const have = new Set(narrowed.map((r) => r.entity));
  const noData = visible.filter((id) => !have.has(id));
  return {model: {...model, series, facets: true}, visible, noData, more: order.length > visible.length};
}

// ---- V12 (L1, spec 3; AC-V2-14..18): the domain small multiples of the COUNTRY page. One panel per (indicator, stored series of this country), in the stored
// order of the domain's indicator_ids; the Frequency control keeps only the series of that stored frequency (no resampling) and an indicator with several stored
// frequencies gets one panel per frequency. Pure: the series files are read by the view. `domain` is a country-model domain ({ordered, rows}; `ordered` = stored indicator_ids order); `series` the stored
// meta/series.json rows. Returns {items, none}: items = [{key, row, meta}], none = the rows of indicators the pair has no series for (hidden, no_data).
export function l1Items({domain, indicators = [], series = [], entityId, frequency = null} = {}) {
  const rows = domain?.ordered ?? domain?.rows ?? [];
  const ids = new Set(rows.map((r) => r.indicatorId));
  const kept = frequency ? new Set(indicatorsOfFrequency(indicators.filter((i) => ids.has(i.indicator_id)), frequency).map((i) => i.indicator_id)) : ids;
  const items = [];
  const none = [];
  for (const row of rows) {
    if (!kept.has(row.indicatorId)) continue;
    const metas = series.filter((s) => s.indicator_id === row.indicatorId && s.entity_id === entityId && (!frequency || s.frequency === frequency));
    if (metas.length === 0) none.push(row);
    else for (const meta of metas) items.push({key: `${row.indicatorId}-${meta.series_id}`, row, meta});
  }
  return {items, none};
}

// The stored staleness of one panel: the scorecard cell's is_stale, for the cell's own series (a cell that names no series applies to every panel of the indicator).
export const l1Stale = (item) => item.row?.cell?.is_stale === true && (item.row.cell.series_id === undefined || item.row.cell.series_id === null || item.row.cell.series_id === item.meta?.series_id);

// The one selection of the L1 card (ADR-036 Amendment 1): `none` rows and panels whose series file holds no stored value are hidden with reason no_data;
// `built` = [{item, facet}] with facet = series-chart.js seriesFacet(). Time-series panels never hide a stale series (AC-V2-82).
export function l1Split({none = [], built = []} = {}) {
  const entries = [...none.map((row) => ({row, hasSeries: false})), ...built.map(({item, facet}) => ({row: item.row, facet, hasSeries: true}))];
  const {drawn, hidden} = splitByCoverage(entries, {requireValue: true, hasSeries: (e) => e.hasSeries, hasValue: (e) => e.facet?.hasValue === true});
  return {drawn: drawn.map((e) => e.facet), hidden};
}

// "Show more" (spec L1: at most FACET_PAGE panels, then the next block): the keys of the panels shown are a list, so a block is the next FACET_PAGE items not shown yet
// (list selection only; no count is kept or printed). Keys of panels that no longer exist (a Frequency change) are dropped; an empty list starts again at the first block.
export function l1Reveal(items = [], shown = [], more = false) {
  const keys = new Set(items.map((it) => it.key));
  const kept = shown.filter((k) => keys.has(k));
  if (kept.length > 0 && !more) return kept;
  return [...kept, ...items.filter((it) => !kept.includes(it.key)).slice(0, FACET_PAGE).map((it) => it.key)];
}
