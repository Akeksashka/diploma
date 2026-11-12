// L19 (layout amendment 4.10, AC-DB-27, AC-DB-26; ADR-034 decision 7): small multiples of the "Over time" card when no Country is selected. Pure model; the
// block is built in series-card.js. One facet per entity of the comparison set (countries; the stored aggregates are the separate reference rows and are not
// faceted), shared y-axis and unit, entity-name title with the latest stored value as label (explorer-view.js chart(), facets form), at most
// FACET_PAGE facets before "Show more", which adds the next FACET_PAGE (no count is printed). Order: the C-RANK sort (rank-model.js buildComparison;
// countries with a value first in the chosen order, those without last by name). Data: the rows of series/<indicator_id>.parquet after "Load history"
// (phase A has no `recent` arrays, AC-DB-26). Period clips the x-domain (not a row filter here); Frequency keeps the stored `frequency`.
// D6: nothing is computed. An entity with no stored value in the file is not dropped: it is listed with the empty-card sentence.
import {buildModel} from "./explorer.js";
import {comparisonSet, seriesOfFrequency} from "./filter-model.js";
import {buildComparison, DEFAULT_RANK_SORT} from "./rank-model.js";
import {sortRows} from "./sort.js";

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
