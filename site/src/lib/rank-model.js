// L12 (layout amendment 4.7, AC-DB-22, AC-DB-23, AC-DB-36): pure row model of the ranked comparison card (C-RANK) of PG-HOME. It builds on the
// stored row model of PG-INDICATOR (indicator-model.js) and the comparison set of filter-model.js. D6: nothing is computed here. Rows are
// selected, ordered by a stored field and grouped; the bar axis is picked from two stored values by order, not by arithmetic.
// Rows: one per entity of the comparison set (countries, then the "Reference rows" group of stored aggregates), none dropped; a row without a
// value keeps its state code and sentence and comes last in its group. No top-N, no total, no average, no rank is built here.
import {DRAFT_HIDDEN_ROWS, DRAFT_HIDDEN_ROW_ITEM, DRAFT_INDICATOR_SORT_LABELS, DRAFT_RANK_SORT_LABELS} from "./copy.js";
import {comparisonSet, countHiddenRowsByReason, splitByCoverage} from "./filter-model.js";
import {indicatorModel} from "./indicator-model.js";
import {sortRows} from "./sort.js";
import {seriesUnit} from "./units.js";

// Sort select (amendment 4.7): Country (A to Z) default, Value, Percentile; stored fields, nulls last, ties by name (sort.js).
export const RANK_SORTS = Object.freeze({
  name: Object.freeze({field: "name", dir: "asc"}),
  value: Object.freeze({field: "value", dir: "desc"}),
  percentile: Object.freeze({field: "percentile", dir: "desc"}),
  // Reference period (latest first): offered on PG-INDICATOR only (L23; RD AC-RD-22 keeps four sorts there), not on the PG-HOME card.
  period: Object.freeze({field: "refPeriodEnd", dir: "desc"})
});
export const RANK_SORT_OPTIONS = Object.freeze(["name", "value", "percentile"].map((id) => ({id, label: DRAFT_RANK_SORT_LABELS[id]})));
export const INDICATOR_SORT_OPTIONS = Object.freeze(["name", "value", "percentile", "period"].map((id) => ({id, label: DRAFT_INDICATOR_SORT_LABELS[id]})));
export const DEFAULT_RANK_SORT = "name";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Mixed-unit rule (amendment 4.7): after CR-5 the stored `unit_text_varies` decides; until then `unit_label` holds a single unit code
// when it has no ", ". A missing label is not "one unit": no shared axis.
export function hasSingleUnit(indicator) {
  if (typeof indicator?.unit_text_varies === "boolean") return indicator.unit_text_varies === false;
  const label = indicator?.unit_label;
  return typeof label === "string" && label.trim() !== "" && !label.includes(", ");
}

// Axis domain of the shared bar axis: the stored values with the smallest and largest value picked by order (sort.js), widened to include 0
// by comparison (bars start at 0). No arithmetic.
export function axisDomain(values) {
  const nums = sortRows(values.filter(isNum).map((v) => ({v})), "v").map((o) => o.v);
  if (nums.length === 0) return null;
  const first = nums[0];
  const last = nums.at(-1);
  return [first < 0 ? first : 0, last > 0 ? last : 0];
}

// Rows of the card for one scorecard. Inputs: indicator (meta row), domainId (the scorecard's domain), domains, scorecard, entities, groups,
// series (meta/series.json list), state (the filter store state: g, c, from, to), sort (a key of RANK_SORTS).
export function buildComparison({indicator, domainId, domains = [], scorecard, entities = [], groups = [], series = [], state = {}, sort = DEFAULT_RANK_SORT}) {
  const set = comparisonSet({entities, groups, groupId: state.g ?? null, focusIds: state.c ?? []});
  const countryIds = [...set.countries, ...set.outside].map((e) => e.entity_id);
  const referenceIds = set.references.map((e) => e.entity_id);
  const stored = new Map((scorecard?.entities ?? []).map((e) => [e.entity_id, e]));
  // One scorecard entity per entity of the set; an entity the scorecard does not hold gets an empty one (its row then shows its state).
  const sc = {...scorecard, entities: [...countryIds, ...referenceIds].map((id) => stored.get(id) ?? {entity_id: id, indicators: []})};
  // The scorecard read is the one of the selected domain (an indicator in two domains reads the loaded one; AC-RD-24 keeps them equal).
  const im = indicatorModel({indicator: {...indicator, domain_ids: [domainId]}, domains, scorecards: {[domainId]: sc}, entities, series});
  const focus = new Set(state.c ?? []);
  const unitShared = hasSingleUnit(indicator);
  // With units that differ, a row shows its own stored series unit (unit_code); otherwise the indicator's unit_label.
  const marked = im.rows.map((r) => ({
    ...r,
    unit: unitShared ? r.unit : (seriesUnit(r.seriesMeta) ?? r.unit),
    inFocus: focus.has(r.entityId),
    fillBin: r.state?.key === "ranked" || r.state?.key === "ahead" ? r.bin : null
  }));
  // Period (ADR-036): one split per card render; N and the list come from the same arguments.
  const split = splitByCoverage(marked, {from: state.from ?? null, to: state.to ?? null, dateKey: "refPeriodEnd"});
  const kept = split.drawn;
  const hidden = split.hidden.map((h) => h.row);
  const hiddenSentence = DRAFT_HIDDEN_ROWS(countHiddenRowsByReason(split.hidden).total);
  const s = RANK_SORTS[sort] ?? RANK_SORTS[DEFAULT_RANK_SORT];
  const order = (rows) => [...sortRows(rows.filter((r) => r.hasValue), s.field, {dir: s.dir}), ...sortRows(rows.filter((r) => !r.hasValue), "name")];
  const inCountries = new Set(countryIds);
  const countries = order(kept.filter((r) => inCountries.has(r.entityId)));
  const references = order(kept.filter((r) => !inCountries.has(r.entityId)));
  const shown = [...countries, ...references];
  const withValue = shown.filter((r) => r.hasValue);
  const domain = unitShared ? axisDomain(withValue.map((r) => r.value)) : null;
  // Hidden rows: by name A to Z, ties by id (ADR-036 I4); stored period only.
  const hiddenRows = sortRows(sortRows(hidden, "entityId", {nameKey: "entityId"}), "name").map((r) => ({
    entityId: r.entityId,
    name: r.name,
    hasCountryPage: r.hasCountryPage,
    periodText: r.periodText ?? r.refPeriodEnd ?? "",
    text: DRAFT_HIDDEN_ROW_ITEM(r.name, r.periodText ?? r.refPeriodEnd ?? "")
  }));
  return {
    header: im.header,
    indicator,
    model: im,
    unit: im.header.unit,
    domainRanked: im.domainRanked,
    referenceLine: im.referenceLine,
    sort: s,
    sortId: RANK_SORTS[sort] ? sort : DEFAULT_RANK_SORT,
    countries,
    references,
    shown,
    hasReferences: references.length > 0,
    withValue,
    withoutValue: shown.filter((r) => !r.hasValue),
    // Bar form: a shared axis only for one unit; otherwise the percentile dot plus the value text (no axis).
    form: unitShared ? "bar" : "dot",
    domain,
    empty: shown.length === 0,
    hiddenSentence,
    hiddenRows
  };
}
