// V9 (ADR-037 A1.2, spec 5.1 as replaced): the entity picker. Native <select> only: one entity select with <optgroup label="Countries"> and
// <optgroup label="Aggregates"> over meta/entities.json, one Group <select> over meta/groups.json, and an explicit Go button. No hand-built ARIA
// combobox, no aria-activedescendant, no <datalist>: arrow keys, type-ahead and Enter are the browser's own (AC-V2-60). Choosing an option writes `c` to the
// filter store (when the page has one) and never navigates (WCAG 3.2.2, as the L22 switcher); the Go button, or Enter on the entity select, opens
// /country/<entity_id> and carries the Country keys (carry.js). The Group select limits the list and writes `g`. The picker reads only the two meta
// lists it is given: it adds no request. Global entities have no country page and are never offered. Display only; nothing is computed.
import {DRAFT_COUNTRY_SWITCHER_GO, DRAFT_PICKER_LABELS as P} from "./copy.js";
import {carryHrefFor} from "./carry.js";
import {groupOptions} from "./filter-bar-options.js";
import {countryOptions} from "./filter-model.js";
import {sortRows} from "./sort.js";

const labelOf = (e) => e.name ?? e.entity_id;

// {countries, aggregates}: [{id, label}] each A to Z by stored name (ties by id). The Group limits the countries to its current members; aggregates are
// always the reference list; the current entity stays listed when the Group excludes it, so the select can show it.
export function pickerLists({entities = [], groups = [], groupId = null, currentId = null} = {}) {
  const {countries, aggregates} = countryOptions({entities, groups, groupId});
  const have = new Set([...countries, ...aggregates].map((e) => e.entity_id));
  const extra = entities.filter((e) => e.entity_id === currentId && !e.is_global && !have.has(e.entity_id));
  const row = (e) => ({id: e.entity_id, label: labelOf(e), name: labelOf(e)});
  const sorted = (list) => sortRows(list.map(row), "name").map(({id, label}) => ({id, label}));
  return {
    countries: sorted([...countries, ...extra.filter((e) => e.kind !== "aggregate")]),
    aggregates: sorted([...aggregates, ...extra.filter((e) => e.kind === "aggregate")])
  };
}

// Where Go leads: `href` (page-relative, e.g. "../country/DEU") with the Country keys of the current hash and c forced to the chosen entity.
export const pickerHref = (href, hash, entityId) => carryHrefFor(href, hash, "country", {c: entityId});

// hrefFor(entityId) -> page-relative link to the country page ("./country/<id>" from a root page, "../country/<id>" from a country page).
// store (optional): the page's filter store; without one the picker only navigates. Returns a DocumentFragment-like htl node.
export function countryPicker(html, {entities = [], groups = [], currentId = null, store = null, hrefFor, win = globalThis}) {
  const opt = (o, selected = false) => html`<option value="${o.value ?? o.id}" selected=${selected}>${o.label}</option>`;
  const groupSelect = html`<select id="picker-group">${groupOptions(groups).map((o) => opt(o))}</select>`;
  const entitySelect = html`<select id="country-switcher"></select>`;
  const fill = (groupId, keep) => {
    const lists = pickerLists({entities, groups, groupId, currentId: keep});
    entitySelect.replaceChildren(
      html`<option value="">${P.placeholder}</option>`,
      html`<optgroup label="${P.countries}">${lists.countries.map((o) => opt(o))}</optgroup>`,
      ...(lists.aggregates.length ? [html`<optgroup label="${P.aggregates}">${lists.aggregates.map((o) => opt(o))}</optgroup>`] : [])
    );
    const offered = [...entitySelect.options].some((o) => o.value === keep);
    entitySelect.value = keep && offered ? keep : "";
  };
  const g0 = store?.get().g ?? null;
  groupSelect.value = g0 ?? "";
  if (groupSelect.value !== (g0 ?? "")) groupSelect.value = "";
  fill(groupSelect.value || null, currentId);
  const root = html`<span class="mm-picker"><label class="mm-filterbar-field">${P.group} ${groupSelect}</label> <label class="mm-filterbar-field mm-country-switch">${P.country} ${entitySelect}</label> <button type="button" id="country-switcher-go" class="mm-country-go">${DRAFT_COUNTRY_SWITCHER_GO}</button></span>`;
  const go = () => {
    if (entitySelect.value) win.location.assign(pickerHref(hrefFor(entitySelect.value), win.location.hash, entitySelect.value));
  };
  groupSelect.addEventListener("change", () => {
    fill(groupSelect.value || null, entitySelect.value || currentId);
    store?.set({g: groupSelect.value || null});
  });
  entitySelect.addEventListener("change", () => {
    if (entitySelect.value) store?.set({c: [entitySelect.value]});
  });
  entitySelect.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go();
  });
  root.querySelector("button").addEventListener("click", go);
  return root;
}
