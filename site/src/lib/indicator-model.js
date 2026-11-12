// Redesign R9 (spec 4.3, C-IND-2, C-IND-5, section 3, AC-RD-20/21/24/25): pure row model of one indicator page from the stored
// scorecard of the indicator's FIRST domain and meta files. D6: nothing is computed here; every figure is a stored field,
// formatted only. States come from missing.js (spec 5.1). Rows: every entity of the scorecard, none dropped; default order
// Country A-Z (sort.js); rows with a value first, then rows without (second group, reason sentence in `state`).
import {binOf} from "./bins.js";
import {DRAFT_CRUMB_HOME, DRAFT_CRUMB_INDICATORS, DRAFT_CRUMB_LABEL, DRAFT_INDICATOR_COLUMNS, DRAFT_INDICATOR_FACT_LABELS, DRAFT_INDICATOR_TABLE_CAPTION, DRAFT_WITHOUT_VALUE_GROUP} from "./copy.js";
import {mapCellState, seriesDefinedSet} from "./missing.js";
import {periodLabel} from "./period.js";
import {directionOf, formatPercentile, formatValue} from "./scorecard.js";
import {sortRows} from "./sort.js";
import {indicatorUnit} from "./units.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const LEVEL = "LEVEL";

// The scorecard that supplies the page: the first of the indicator's `domain_ids` (spec section 3, AC-RD-24).
export function firstDomainId(indicator) {
  const id = indicator?.domain_ids?.[0];
  if (typeof id !== "string" || id === "") throw new Error(`indicator ${indicator?.indicator_id} has no domain_ids`);
  return id;
}

// Export spec section 4: every published indicator has at least one domain; an entry without one is a build error (AC-RD-01).
export function indicatorsWithoutDomain(indicators) {
  return indicators.filter((e) => !Array.isArray(e?.domain_ids) || e.domain_ids.length === 0).map((e) => e?.indicator_id);
}

// Transform label (spec 4.3): from `transform_options[]` when the matching entry carries a label (an object with `label` or
// `name`); otherwise the stored transform_id itself. No name is invented.
export function transformLabel(indicator, transformId) {
  const id = transformId ?? indicator?.default_transform ?? null;
  if (id === null) return null;
  const opt = (indicator?.transform_options ?? []).find((o) => o === id || o?.id === id || o?.transform_id === id);
  const label = typeof opt === "object" && opt !== null ? opt.label ?? opt.name : null;
  return typeof label === "string" && label.trim() !== "" ? label : id;
}

// First stored transform_id of this indicator's cells in a scorecard (null when no cell carries one).
export function storedTransformId(scorecard, indicatorId) {
  for (const e of scorecard?.entities ?? []) {
    const c = (e.indicators ?? []).find((x) => x.indicator_id === indicatorId);
    if (c && typeof c.transform_id === "string") return c.transform_id;
  }
  return null;
}

// Static header facts (spec 4.3): all stored, none computed. `domains`: meta/domains.json list.
export function indicatorHeader(indicator, domains = [], transformId = null) {
  const byId = new Map(domains.map((d) => [d.domain_id, d]));
  const dir = directionOf(indicator);
  return {
    indicatorId: indicator.indicator_id,
    name: indicator.name ?? indicator.indicator_id,
    domains: (indicator.domain_ids ?? []).map((id) => ({id, name: byId.get(id)?.name ?? id})),
    unit: indicatorUnit(indicator),
    frequencies: [...(indicator.frequency_set ?? [])],
    directionText: dir ? dir.text : null,
    notes: [...(indicator.notes ?? [])],
    transformId: transformId ?? indicator.default_transform ?? null,
    transformLabel: transformLabel(indicator, transformId),
    labels: {crumb: DRAFT_CRUMB_LABEL, home: DRAFT_CRUMB_HOME, indicators: DRAFT_CRUMB_INDICATORS, facts: DRAFT_INDICATOR_FACT_LABELS}
  };
}

// AC-RD-24: for an indicator in several domains, entities whose stored percentile differs between the first domain's scorecard
// and another's. Returns [] when consistent. scorecards: {domain_id: scorecard}.
export function storedPercentileDifferences(indicator, scorecards) {
  const ids = indicator.domain_ids ?? [];
  const pctOf = (sc) => new Map((sc?.entities ?? []).map((e) => [e.entity_id, (e.indicators ?? []).find((c) => c.indicator_id === indicator.indicator_id)?.percentile ?? null]));
  const first = pctOf(scorecards[ids[0]]);
  const out = [];
  for (const other of ids.slice(1)) {
    for (const [entityId, p] of pctOf(scorecards[other])) {
      if (first.has(entityId) && first.get(entityId) !== p) out.push({indicatorId: indicator.indicator_id, entityId, domains: [ids[0], other], percentiles: [first.get(entityId), p]});
    }
  }
  return out;
}

// Reference-period line inputs (C-IND-2), as stored in the domain-level `alignment[]` entry of this indicator.
function referenceLine(scorecard, indicatorId) {
  const a = (scorecard.alignment ?? []).find((x) => x.indicator_id === indicatorId) ?? null;
  const spread = a?.reference_period_spread_days ?? null;
  const common = a?.rank_reference_period ?? null;
  return {
    spreadDays: spread,
    commonPeriod: common,
    ranked: spread !== null || common !== null,
    nRanked: a?.n_ranked ?? null,
    nUnaligned: a?.n_unaligned ?? null,
    maxRefSpreadDays: a?.max_ref_spread_days ?? null,
    heterogeneousPeerSet: scorecard.heterogeneous_peer_set ?? null,
    peerSetSizeByIndicator: scorecard.peer_set_size_by_indicator ?? null
  };
}

// input: {indicator, domains, scorecards: {domain_id: scorecard} (at least the first domain), entities, series, groups?}
export function indicatorModel({indicator, domains, scorecards, entities, series}) {
  const domainId = firstDomainId(indicator);
  const sc = scorecards[domainId];
  if (!sc) throw new Error(`scorecard of domain ${domainId} is missing`);
  const domain = domains.find((d) => d.domain_id === domainId);
  const ranked = domain ? domain.ranked === true : sc.ranked === true;
  const entById = new Map(entities.map((e) => [e.entity_id, e]));
  const seriesDefined = seriesDefinedSet(series);
  const seriesByPair = new Map(series.map((s) => [`${s.indicator_id}|${s.entity_id}`, s]));
  const rows = (sc.entities ?? []).map((row) => {
    const ent = entById.get(row.entity_id) ?? {entity_id: row.entity_id};
    const cell = (row.indicators ?? []).find((c) => c.indicator_id === indicator.indicator_id) ?? {indicator_id: indicator.indicator_id, value: null};
    const s = seriesByPair.get(`${indicator.indicator_id}|${row.entity_id}`) ?? null;
    const state = mapCellState(cell, {entityId: row.entity_id, entityKind: ent.kind, domainRanked: ranked, seriesDefined});
    const hasValue = cell.value !== null && cell.value !== undefined && cell.published !== false && cell.publish_scope !== "excluded";
    const hasPercentile = isNum(cell.percentile);
    const transformId = typeof cell.transform_id === "string" ? cell.transform_id : null;
    const showsTransformed = hasValue && transformId !== null && transformId !== LEVEL && cell.transformed_value !== null && cell.transformed_value !== undefined;
    return {
      entityId: row.entity_id,
      name: ent.name ?? row.entity_id,
      kind: ent.kind ?? null,
      hasCountryPage: entById.has(row.entity_id) && ent.is_global !== true,
      groupIds: [...(ent.group_ids ?? [])],
      hasValue,
      value: hasValue ? cell.value : null,
      valueText: hasValue ? formatValue(cell.value) : null,
      unit: indicatorUnit(indicator),
      refPeriodEnd: hasValue ? cell.ref_period_end ?? null : null,
      periodText: hasValue ? periodLabel(cell.ref_period_end, s?.frequency) : null,
      refOffsetDays: hasValue ? cell.ref_offset_days ?? null : null,
      offsetFlag: hasValue && isNum(cell.ref_offset_days) && cell.ref_offset_days !== 0,
      alignment: cell.alignment ?? null,
      transformId,
      transformLabel: transformId === null ? null : transformLabel(indicator, transformId),
      // CR-6: transformed_value has no stored unit; the row carries the number and its transform label only.
      transformedValue: showsTransformed ? cell.transformed_value : null,
      transformedText: showsTransformed ? formatValue(cell.transformed_value) : null,
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
  const ordered = sortRows(rows, "name");
  const withValue = ordered.filter((r) => r.hasValue);
  const withoutValue = ordered.filter((r) => !r.hasValue);
  const header = indicatorHeader(indicator, domains, storedTransformId(sc, indicator.indicator_id));
  return {
    header,
    domainId,
    domainRanked: ranked,
    referenceLine: referenceLine(sc, indicator.indicator_id),
    withoutValueHeading: DRAFT_WITHOUT_VALUE_GROUP,
    labels: {columns: DRAFT_INDICATOR_COLUMNS, caption: DRAFT_INDICATOR_TABLE_CAPTION(header.name)},
    rows: [...withValue, ...withoutValue],
    withValue,
    withoutValue,
    showsPercentiles: rows.some((r) => r.percentile !== null)
  };
}
