// Redesign R6 (spec 4.2, C-CTRY-1/3/4/5, section 3): pure row model of one country page from the stored scorecards and meta files.
// D6: nothing is computed here; every figure is a stored field, formatted only. States come from missing.js (spec 5.1).
// Domains are in `meta/domains.json` order (CR-9 pending); a domain whose scorecard holds no row for the entity is omitted
// (the global domain holds WLD only). Rows with a value come first (order of `indicator_ids`), then rows without a value.
import {binOf} from "./bins.js";
import {DRAFT_COUNTRY_GROUPS_LABEL, DRAFT_COUNTRY_KIND_LABEL, DRAFT_COUNTRY_NO_GROUPS, DRAFT_CRUMB_COUNTRIES, DRAFT_CRUMB_HOME, DRAFT_CRUMB_LABEL, DRAFT_WITHOUT_VALUE_GROUP, DRAFT_FIGURE_COVERAGE, DRAFT_FIGURE_POSITION} from "./copy.js";
import {splitByCoverage} from "./filter-model.js";
import {mapCellState, mapDomainSummaryState, seriesDefinedSet} from "./missing.js";
import {periodLabel} from "./period.js";
import {directionOf, formatPercentile, formatValue} from "./scorecard.js";
import {groupLabel} from "./peers.js";
import {indicatorUnit} from "./units.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Static header facts: name, kind, group memberships as text (stored `group_ids`, display names of copy.js GROUP_LABELS).
export function countryHeader(entity, groups = []) {
  const byId = new Map(groups.map((g) => [g.group_id, g]));
  const memberships = (entity.group_ids ?? []).map((id) => ({id, label: groupLabel(byId.get(id) ?? {group_id: id})}));
  return {entityId: entity.entity_id, name: entity.name ?? entity.entity_id, kind: entity.kind ?? null, memberships, noGroupsText: DRAFT_COUNTRY_NO_GROUPS, labels: {crumb: DRAFT_CRUMB_LABEL, home: DRAFT_CRUMB_HOME, countries: DRAFT_CRUMB_COUNTRIES, kind: DRAFT_COUNTRY_KIND_LABEL, groups: DRAFT_COUNTRY_GROUPS_LABEL}};
}

export function figureLine(row, domain, state) {
  if (domain.ranked !== true) return {state, label: null, percentileRank: null, percentileText: null, coverageText: null, positionText: null};
  const lowCoverage = row.low_coverage === true;
  const hasPosition = !lowCoverage && isNum(row.rank_position) && isNum(row.n_ranked_entities);
  return {
    state,
    label: row.percentile_rank_label ?? domain.percentile_rank_label ?? null,
    percentileRank: isNum(row.percentile_rank) ? row.percentile_rank : null,
    percentileText: formatPercentile(row.percentile_rank),
    coverageText: isNum(row.n_available) && isNum(row.n_defined) ? DRAFT_FIGURE_COVERAGE(row.n_available, row.n_defined) : null,
    nAvailable: row.n_available ?? null,
    nDefined: row.n_defined ?? null,
    positionText: hasPosition ? DRAFT_FIGURE_POSITION(row.rank_position, row.n_ranked_entities) : null,
    rankPosition: hasPosition ? row.rank_position : null,
    nRankedEntities: hasPosition ? row.n_ranked_entities : null,
    lowCoverage
  };
}

// input: {entity, entities?, domains, scorecards: {domain_id: scorecard}, indicators, series, groups}
export function countryModel({entity, domains, scorecards, indicators, series, groups = []}) {
  const indById = new Map(indicators.map((i) => [i.indicator_id, i]));
  const seriesDefined = seriesDefinedSet(series);
  const seriesByPair = new Map(series.map((s) => [`${s.indicator_id}|${s.entity_id}`, s]));
  const out = [];
  for (const domain of domains) {
    const sc = scorecards[domain.domain_id];
    const row = sc?.entities?.find((e) => e.entity_id === entity.entity_id);
    if (!row) continue;
    const ranked = domain.ranked === true;
    const ctx = {entityId: entity.entity_id, entityKind: entity.kind, domainRanked: ranked, seriesDefined};
    const cells = new Map((row.indicators ?? []).map((c) => [c.indicator_id, c]));
    const rows = (domain.indicator_ids ?? []).map((id) => {
      const cell = cells.get(id) ?? {indicator_id: id, value: null};
      const ind = indById.get(id);
      const s = seriesByPair.get(`${id}|${entity.entity_id}`) ?? null;
      const state = mapCellState(cell, ctx);
      const hasValue = cell.value !== null && cell.value !== undefined && cell.published !== false && cell.publish_scope !== "excluded";
      const hasPercentile = isNum(cell.percentile);
      const dir = directionOf(ind);
      return {
        indicatorId: id,
        name: ind?.name ?? id,
        directionText: dir ? dir.text : null,
        hasValue,
        value: hasValue ? cell.value : null,
        valueText: hasValue ? formatValue(cell.value) : null,
        unit: indicatorUnit(ind),
        refPeriodEnd: hasValue ? cell.ref_period_end ?? null : null,
        periodText: hasValue ? periodLabel(cell.ref_period_end, s?.frequency) : null,
        refOffsetDays: hasValue ? cell.ref_offset_days ?? null : null,
        offsetFlag: hasValue && isNum(cell.ref_offset_days) && cell.ref_offset_days !== 0,
        alignment: cell.alignment ?? null,
        percentile: hasPercentile ? cell.percentile : null,
        percentileText: hasPercentile ? formatPercentile(cell.percentile) : null,
        bin: hasPercentile ? binOf(cell.percentile) : null,
        estimate: hasValue && cell.value_kind === "estimate",
        inherited: hasValue && cell.inherited === true,
        state,
        sourceName: s?.source_name ?? null,
        sourceUrl: s?.source_url ?? null,
        seriesId: s?.series_id ?? null,
        seriesMeta: s,
        cell
      };
    });
    const withValue = rows.filter((r) => r.hasValue);
    const withoutValue = rows.filter((r) => !r.hasValue);
    out.push({
      domainId: domain.domain_id,
      name: domain.name ?? domain.domain_id,
      ranked,
      notices: [...(domain.notices ?? [])],
      figure: ranked ? figureLine(row, domain, mapDomainSummaryState(row, ctx)) : null,
      rows: [...withValue, ...withoutValue],
      ordered: rows, // the rows in the stored `indicator_ids` order of the domain (L1 follows it, whatever the value state)
      withValue,
      withoutValue
    });
  }
  const anyPercentile = out.some((d) => d.rows.some((r) => r.percentile !== null));
  return {header: countryHeader(entity, groups), withoutValueHeading: DRAFT_WITHOUT_VALUE_GROUP, domains: out, showsPercentiles: anyPercentile};
}

// V11 (K1, spec 3, A1.1 as decided in E-3): the latest-value cards of one domain band. A card is drawn for each indicator with a stored value; a stale card is
// still drawn (it carries the stale marker and its stored period: K1 is a series-currency view, so staleness is never a hide reason here); an indicator with
// no stored value is in `hidden` (reason no_data), the one array that the card's hidden-rows disclosure renders. Period and Frequency do not apply to K1.
// No delta, arrow or direction is built here: the scorecard row stores none (A2.4; the neutral delta needs CR-6 or CR-11).
export function k1Model(domain) {
  const {drawn, hidden} = splitByCoverage(domain?.rows ?? [], {requireValue: true, hasValue: (r) => r.hasValue});
  return {cards: drawn.map((r) => ({...r, stale: r.cell?.is_stale === true})), hidden};
}
