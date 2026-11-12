// L6 proof card (ADR-034 risk "reactive wiring through Generators"): a text list of the comparison set (L5 comparisonSet) for the current
// Group and Country filters. Names are stored fields; the heading is the Group name or the "All countries" label. Kept small on purpose:
// it is replaced by the real cards from L11 on.
import {DRAFT_FILTER_ALL} from "./copy.js";
import {comparisonSet} from "./filter-model.js";

export function proofCard(html, {entities, groups, state, renders = 0}) {
  const set = comparisonSet({entities, groups, groupId: state.g, focusIds: state.c});
  const title = state.g ? (groups.find((g) => g.group_id === state.g)?.name ?? state.g) : DRAFT_FILTER_ALL.countries;
  const item = (e) => html`<li data-entity="${e.entity_id}">${e.name ?? e.entity_id}</li>`;
  return html`<div class="mm-grid"><section class="mm-card mm-card--span-4" id="filter-proof" data-renders="${renders}" aria-labelledby="filter-proof-title"><h3 id="filter-proof-title">${title}</h3><ul id="filter-proof-countries">${set.countries.map(item)}</ul><ul id="filter-proof-focus">${set.outside.map(item)}</ul><ul id="filter-proof-references">${set.references.map(item)}</ul></section></div>`;
}
