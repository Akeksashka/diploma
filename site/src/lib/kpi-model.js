// L14 (layout amendment 4.6, AC-DB-20, AC-DB-21): pure model of the C-KPI tiles. Stored fields only; nothing is computed (D6).
// Tiles exist only when the Country filter resolves to exactly one known entity. Selection (phase A, no `priority`, no tile_headline):
// the pinned Indicator (`i`) first when the selected Domain lists it, then the Domain's indicator_ids in stored order, Frequency applies, at
// most MAX_TILES tiles in total, the domain-figure tile of a ranked Domain included. No delta, arrow, rank or count.
import {binOf} from "./bins.js";
import {DRAFT_CHOOSE_COUNTRY_PLACEHOLDER, DRAFT_EMPTY_CARD} from "./copy.js";
import {figureLine} from "./country-model.js";
import {indicatorsOfFrequency} from "./filter-model.js";
import {serializeHash} from "./hash.js";
import {mapCellState, mapDomainSummaryState, seriesDefinedSet} from "./missing.js";
import {periodLabel} from "./period.js";
import {formatPercentile, formatValue} from "./scorecard.js";
import {indicatorUnit} from "./units.js";

export const MAX_TILES = 8; // all tiles of the row, the domain-figure tile included
export const MAX_INDICATOR_TILES_RANKED = 7; // a ranked Domain: the figure tile takes one place (no arithmetic in this module, D6)

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Indicator ids of the tile row, in display order (before the row lookups). The pinned Indicator (`i`) comes first even when the selected
// Domain does not list it (it is then a tile with no value in this Domain's scorecard, shown with its stored state). At most MAX_TILES tiles in
// total: a ranked Domain's domain-figure tile counts as one of them.
export function tileIndicatorIds({domain, indicators = [], pinnedId = null, frequency = null} = {}) {
  if (!domain) return [];
  const ids = domain.indicator_ids ?? [];
  const byId = new Map(indicators.map((i) => [i.indicator_id, i]));
  const pinned = pinnedId && (ids.includes(pinnedId) || byId.has(pinnedId)) ? pinnedId : null;
  const ordered = pinned ? [pinned, ...ids.filter((id) => id !== pinned)] : [...ids];
  // Without a Frequency every listed id stays (an id with no meta row still gets a tile with its state); with one, only stored frequency_set matches.
  const kept = new Set(frequency ? indicatorsOfFrequency(ordered.map((id) => byId.get(id)).filter(Boolean), frequency).map((i) => i.indicator_id) : ordered);
  return ordered.filter((id) => kept.has(id)).slice(0, domain.ranked === true ? MAX_INDICATOR_TILES_RANKED : MAX_TILES);
}

// Stored `published_precision` (config display hint: integer decimals) when present, else the common formatter.
const valueText = (v, precision) => (Number.isInteger(precision) && precision >= 0 && precision <= 20 && isNum(v) ? v.toFixed(precision) : formatValue(v));

function indicatorTile({cell, ind, entity, domain, seriesByPair, seriesDefined}) {
  const id = cell.indicator_id;
  const s = seriesByPair.get(`${id}|${entity.entity_id}`) ?? null;
  const state = mapCellState(cell, {entityId: entity.entity_id, entityKind: entity.kind, domainRanked: domain.ranked === true, seriesDefined});
  const hasValue = cell.value !== null && cell.value !== undefined && cell.published !== false && cell.publish_scope !== "excluded";
  const hasPercentile = hasValue && isNum(cell.percentile);
  return {
    type: "indicator",
    indicatorId: id,
    name: ind?.name ?? id,
    href: `./indicator/${id}`,
    seriesHref: `./explorer${serializeHash({i: id, c: [entity.entity_id]})}`,
    entityName: entity.name ?? entity.entity_id,
    hasValue,
    valueText: hasValue ? valueText(cell.value, s?.published_precision) : null,
    unit: indicatorUnit(ind),
    periodText: hasValue ? periodLabel(cell.ref_period_end, s?.frequency) ?? cell.ref_period_end ?? null : null,
    refOffsetDays: hasValue ? cell.ref_offset_days ?? null : null,
    offsetFlag: hasValue && isNum(cell.ref_offset_days) && cell.ref_offset_days !== 0,
    percentileText: hasPercentile ? formatPercentile(cell.percentile) : null,
    bin: hasPercentile ? binOf(cell.percentile) : null,
    estimate: hasValue && cell.value_kind === "estimate",
    inherited: hasValue && cell.inherited === true,
    state
  };
}

// input: {focusIds, pinnedId, entities, indicators, domain, scorecard, series, frequency}. Returns one of
//   {kind: "placeholder", text}                     (not exactly one known entity in focus)
//   {kind: "empty", text}                           (nothing to show: no tile ids after Frequency, or the entity has no row in the scorecard)
//   {kind: "tiles", entity, figure, tiles}
export function kpiModel({focusIds = [], pinnedId = null, entities = [], indicators = [], domain = null, scorecard = null, series = [], frequency = null} = {}) {
  const entity = focusIds.length === 1 ? entities.find((e) => e.entity_id === focusIds[0]) ?? null : null;
  if (!entity) return {kind: "placeholder", text: DRAFT_CHOOSE_COUNTRY_PLACEHOLDER};
  const row = scorecard?.entities?.find((e) => e.entity_id === entity.entity_id) ?? null;
  const ids = tileIndicatorIds({domain, indicators, pinnedId, frequency});
  if (!row || ids.length === 0) return {kind: "empty", text: DRAFT_EMPTY_CARD};
  const byId = new Map(indicators.map((i) => [i.indicator_id, i]));
  const cells = new Map((row.indicators ?? []).map((c) => [c.indicator_id, c]));
  const seriesByPair = new Map(series.map((s) => [`${s.indicator_id}|${s.entity_id}`, s]));
  const seriesDefined = seriesDefinedSet(series);
  const tiles = ids.map((id) => indicatorTile({cell: cells.get(id) ?? {indicator_id: id, value: null}, ind: byId.get(id), entity, domain, seriesByPair, seriesDefined}));
  let figure = null;
  if (domain?.ranked === true) {
    const state = mapDomainSummaryState(row, {entityId: entity.entity_id, entityKind: entity.kind, domainRanked: true, seriesDefined});
    figure = {type: "domain-figure", domainId: domain.domain_id, name: domain.name ?? domain.domain_id, ...figureLine(row, domain, state)};
  }
  return {kind: "tiles", entity: {id: entity.entity_id, name: entity.name ?? entity.entity_id, kind: entity.kind ?? null}, figure, tiles};
}
