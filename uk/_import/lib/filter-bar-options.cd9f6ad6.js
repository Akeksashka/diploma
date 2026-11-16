// L7 (layout amendment 2.1, 2.4): pure builders for the filter bar. Options come from meta/* only; nothing is computed from data.
import {DRAFT_FILTER_ALL, DRAFT_FILTER_LABELS, DRAFT_FREQUENCY_NAMES, DRAFT_PERIOD_VALUE} from "./copy.11b4a285.js";
import {frequencyOptions, indicatorList} from "./filter-model.08517389.js";
import {codeText, unitLabelText, xTickFormat} from "./code-text.538effeb.js";

// Applicability by page type (amendment 2.4): a control that does nothing on a page is not rendered.
export const CONTROLS_BY_PAGE = Object.freeze({
  home: ["group", "country", "domain", "indicator", "period", "frequency"],
  country: ["country", "domain", "period", "frequency"],
  indicator: ["group", "country", "indicator"],
  series: ["country", "domain", "indicator", "period", "frequency"],
  domain: ["group", "frequency"]
});
export const controlsFor = (page) => CONTROLS_BY_PAGE[page] ?? [];

// Group select: "All countries" (empty value), then meta/groups.json in stored order.
export const groupOptions = (groups = []) => [
  {value: "", label: DRAFT_FILTER_ALL.countries},
  ...groups.map((g) => ({value: g.group_id, label: g.name ?? g.group_id}))
];

export const domainOptions = (domains = []) => [
  {value: "", label: DRAFT_FILTER_ALL.domains},
  ...domains.map((d) => ({value: d.domain_id, label: d.name ?? d.domain_id}))
];

export const frequencySelectOptions = (indicators = []) => [
  {value: "", label: DRAFT_FILTER_ALL.frequencies},
  ...frequencyOptions(indicators).map((f) => ({value: f, label: DRAFT_FREQUENCY_NAMES[f] ?? f}))
];

// "Name (unit)": the unit sits beside the name; no unit, name only.
export const indicatorLabel = (i) => (i.unit_label ? `${i.name ?? i.indicator_id} (${unitLabelText(i.unit_label)})` : (i.name ?? i.indicator_id));

// Indicator select: narrowed by Domain and Frequency, grouped by domain (meta/domains.json order). An indicator sits under the selected
// Domain when one is set, otherwise under the first of its domain_ids (AC-RD-24 rule); one with no known domain goes in a final flat group.
// Returns {empty, groups: [{label|null, options: [{value, label}]}]}; `empty` is the leading "All" option.
export function indicatorOptionGroups({indicators = [], domains = [], domainId = null, frequency = null} = {}) {
  const list = indicatorList({indicators, domains, domainId, frequency});
  const known = new Set(domains.map((d) => d.domain_id));
  const home = (i) => domainId ?? (i.domain_ids ?? []).find((x) => known.has(x)) ?? null;
  const groups = [];
  for (const d of domains) {
    const options = list.filter((i) => home(i) === d.domain_id).map((i) => ({value: i.indicator_id, label: indicatorLabel(i)}));
    if (options.length) groups.push({label: d.name ?? d.domain_id, options});
  }
  const rest = list.filter((i) => home(i) === null).map((i) => ({value: i.indicator_id, label: indicatorLabel(i)}));
  if (rest.length) groups.push({label: null, options: rest});
  return {empty: {value: "", label: DRAFT_FILTER_LABELS.all}, groups};
}

export const indicatorIdsOffered = (args) => indicatorOptionGroups(args).groups.flatMap((g) => g.options.map((o) => o.value));

// RULE (pinned in tests; the amendment does not specify it): when a user change of Domain or Frequency narrows the Indicator list and the
// selected indicator is no longer in it, the selection is CLEARED (i = null), never kept. Reason: a select cannot show a value it does not
// offer, and a kept hidden value would drive cards that no visible control explains. A change that leaves i in the list keeps it. The rule
// runs on user changes only; a hash read on load or on hashchange is shown as it is (the select then shows "All") and nothing is written.
// Returns the patch to give the store: the user's patch plus `i: null` when the rule fires.
export function patchWithIndicatorRule(state, patch, {indicators = [], domains = []} = {}) {
  const next = {...state, ...patch};
  if (!("d" in patch) && !("f" in patch)) return patch;
  if (!next.i) return patch;
  const offered = indicatorIdsOffered({indicators, domains, domainId: next.d, frequency: next.f});
  return offered.includes(next.i) ? patch : {...patch, i: null};
}

// L10 (amendment 2.5): the active filters as "<control label>: <value>" parts, in matrix order, for the compact chips and the print line. Default
// (unset) controls are left out; a control the page does not render is left out; an id with no name in meta shows the id.
// controls (L21): an explicit list of rendered controls, for a page that shows a subset of its matrix row.
export function summaryParts(state, page, {groups = [], entities = [], domains = [], indicators = [], controls = null} = {}) {
  const shown = new Set(controls ?? controlsFor(page));
  const L = DRAFT_FILTER_LABELS;
  const nameOf = (list, key, id) => list.find((x) => x[key] === id)?.name ?? id;
  const parts = [];
  if (shown.has("group") && state.g) parts.push(`${L.group}: ${nameOf(groups, "group_id", state.g)}`);
  if (shown.has("country") && page !== "country" && state.c?.length) parts.push(`${L.country}: ${state.c.map((id) => nameOf(entities, "entity_id", id)).join(", ")}`);
  if (shown.has("domain") && state.d) parts.push(`${L.domain}: ${nameOf(domains, "domain_id", state.d)}`);
  if (shown.has("indicator") && state.i) parts.push(`${L.indicator}: ${nameOf(indicators, "indicator_id", state.i)}`);
  if (shown.has("period") && state.from != null && state.to != null) parts.push(`${L.period}: ${DRAFT_PERIOD_VALUE(state.from, state.to)}`);
  if (shown.has("frequency") && state.f) parts.push(`${L.frequency}: ${DRAFT_FREQUENCY_NAMES[state.f] ?? state.f}`);
  return parts;
}
