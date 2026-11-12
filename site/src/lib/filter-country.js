// L8 (layout amendment 2.1, 2.5): the Country chip. <details><summary> (summary shows the value), a text filter, a checkbox list of countries
// (alphabetical by stored name) then a sub-list headed "Aggregates"; global entities are never offered; restricted to the Group's members when g
// is set (a selected id outside the Group stays listed so it can be cleared); up to MAX_COUNTRIES selected, the next one is refused with a visible
// message. Writes c only. Pure model functions come first; the DOM builder follows.
import {DRAFT_COUNTRY_CHIP_HELP, DRAFT_COUNTRY_LIMIT, DRAFT_COUNTRY_SELECTED, DRAFT_FILTER_ALL, DRAFT_FILTER_CHIP_SUMMARY, DRAFT_FILTER_LABELS as L, DRAFT_HOME_FILTER_NONE, HOME_AGGREGATES_HEADING, HOME_FILTER_LABEL} from "./copy.js";
import {countryOptions} from "./filter-model.js";
import {wireChip} from "./filter-chip.js";
import {sortRows} from "./sort.js";

export const MAX_COUNTRIES = 5;
const nameOf = (e) => e.name ?? e.entity_id;

// {countries, aggregates}: each sorted by stored name; selected ids that the Group excludes are added to their kind's list.
export function countryChipLists({entities = [], groups = [], groupId = null, selected = []} = {}) {
  const {countries, aggregates} = countryOptions({entities, groups, groupId});
  const have = new Set([...countries, ...aggregates].map((e) => e.entity_id));
  const extra = selected.map((id) => entities.find((e) => e.entity_id === id)).filter((e) => e && !e.is_global && !have.has(e.entity_id));
  return {
    countries: sortRows([...countries, ...extra.filter((e) => e.kind !== "aggregate")], "name"),
    aggregates: sortRows([...aggregates, ...extra.filter((e) => e.kind === "aggregate")], "name")
  };
}

// Summary value: "All countries" when none is selected, the name when one, "n selected" otherwise.
export function countrySummaryValue(selected, entities) {
  if (!selected.length) return DRAFT_FILTER_ALL.countries;
  if (selected.length === 1) return nameOf(entities.find((e) => e.entity_id === selected[0]) ?? {entity_id: selected[0]});
  return DRAFT_COUNTRY_SELECTED(selected.length);
}

// Toggle one id. Returns {c} to write, or {refused: true} when it would be the sixth.
export function toggleCountry(selected, id, checked, max = MAX_COUNTRIES) {
  const has = selected.includes(id);
  if (!checked) return {c: selected.filter((x) => x !== id)};
  if (has) return {c: [...selected]};
  if (selected.length >= max) return {refused: true};
  return {c: [...selected, id]};
}

export const matchesText = (e, q) => !q.trim() || nameOf(e).toLowerCase().includes(q.trim().toLowerCase());

export function mountCountryChip(html, {store, data}) {
  const item = (e) => html`<li class="mm-chip-item" data-entity="${e.entity_id}"><label><input type="checkbox" value="${e.entity_id}" data-country-box> ${nameOf(e)}</label></li>`;
  const text = html`<input type="text" id="filter-country-text" autocomplete="off">`;
  const msg = html`<p class="mm-chip-msg" id="filter-country-msg" role="status"></p>`;
  const none = html`<p class="mm-chip-none" id="filter-country-none" hidden>${DRAFT_HOME_FILTER_NONE}</p>`;
  const listC = html`<ul class="mm-chip-list" id="filter-country-countries"></ul>`;
  const head = html`<p class="mm-chip-sub" id="filter-country-aggregates-head">${HOME_AGGREGATES_HEADING}</p>`;
  const listA = html`<ul class="mm-chip-list" id="filter-country-aggregates" aria-labelledby="filter-country-aggregates-head"></ul>`;
  const summary = html`<summary id="filter-country-summary"></summary>`;
  const chip = html`<details class="mm-chip" id="filter-country" data-filter-control="country">${summary}<div class="mm-chip-body"><label class="mm-chip-field">${HOME_FILTER_LABEL.countries} ${text}</label><p class="mm-chip-help">${DRAFT_COUNTRY_CHIP_HELP}</p>${msg}${none}${listC}${head}${listA}</div></details>`;

  const applyText = () => {
    const q = text.value;
    for (const li of chip.querySelectorAll("li[data-entity]")) {
      const e = data.entities.find((x) => x.entity_id === li.dataset.entity);
      li.hidden = !matchesText(e, q);
    }
    const shown = chip.querySelectorAll("li[data-entity]:not([hidden])").length;
    head.hidden = listA.querySelectorAll("li:not([hidden])").length === 0;
    none.hidden = shown > 0;
  };
  let built = null;
  const sync = (state) => {
    const lists = countryChipLists({entities: data.entities, groups: data.groups, groupId: state.g, selected: state.c});
    // Rebuild the lists only when the offered ids change (Group change); a plain toggle keeps the DOM so keyboard focus stays on the box.
    const key = [...lists.countries, ...lists.aggregates].map((e) => e.entity_id).join("|");
    if (key !== built) {
      built = key;
      listC.replaceChildren(...lists.countries.map(item));
      listA.replaceChildren(...lists.aggregates.map(item));
    }
    for (const box of chip.querySelectorAll("[data-country-box]")) box.checked = state.c.includes(box.value);
    summary.textContent = DRAFT_FILTER_CHIP_SUMMARY(L.country, countrySummaryValue(state.c, data.entities));
    msg.textContent = "";
    applyText();
  };
  sync(store.get());
  store.subscribe(sync);
  text.addEventListener("input", applyText);
  chip.addEventListener("change", (e) => {
    const box = e.target;
    if (!box?.matches?.("[data-country-box]")) return;
    const r = toggleCountry(store.get().c, box.value, box.checked);
    if (r.refused) {
      box.checked = false;
      msg.textContent = DRAFT_COUNTRY_LIMIT(MAX_COUNTRIES);
      return;
    }
    msg.textContent = "";
    store.set({c: r.c});
  });
  wireChip(chip);
  return chip;
}
