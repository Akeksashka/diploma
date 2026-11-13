// L7 (layout amendment 2.1, 2.4, 2.5): the filter bar. A <form role="group" aria-label="Filters"> with labelled native controls:
// Group, Domain, Indicator, Frequency selects, the Country chip (L8; home and series pages only) and the Period chip (L9), and a Reset button. Controls that do nothing on
// the page type are not rendered (controlsFor). The bar reads and writes only the filter store; it keeps the selects in step with it.
import {DRAFT_FILTER_LABELS as L, DRAFT_INDICATOR_SWITCHER_GO} from "./copy.js";
import {mountCountryChip} from "./filter-country.js";
import {mountPeriodChip} from "./filter-period.js";
import {controlsFor, domainOptions, frequencySelectOptions, groupOptions, indicatorOptionGroups, patchWithIndicatorRule, summaryParts} from "./filter-bar-options.js";
import {DRAFT_PRINT_FILTERS} from "./copy.js";
import {mountModeSwitch} from "./mode-switch.js";

const RENDERED = ["group", "country", "domain", "indicator", "period", "frequency"]; // all controls of the matrix
const MULTI_COUNTRY_PAGES = ["home", "series"]; // amendment 2.4: the Country multi-select is on these pages only
const WIDE = "(min-width: 40rem)"; // below it the bar is compact (amendment 2.5)

// page: "home" | "country" | "indicator" | "series" | "domain". data: {groups, domains, indicators, entities, manifest} (meta/*.json lists and the manifest).
// leading (L22): an optional node placed first in the bar (the PG-COUNTRY switcher with its Go button; it navigates, it is not filter state).
// only (L21): an optional subset of the page's controls to render (PG-SERIES shows Domain, Frequency and Period; its Country and Indicator stay in
// the rail). Reset then clears only the filters rendered, and the compact chips and print line list only those.
// mode (V8): optional {mode, hrefs, set}: the Country / Compare switch, placed first in the form (above the controls, always visible). It navigates (real links,
// carry.js keeps the keys that stay meaningful); it is not filter state.
export function mountFilterBar(html, {page, store, data, leading = null, only = null, mode = null}) {
  const want = controlsFor(page).filter((c) => RENDERED.includes(c) && (c !== "country" || MULTI_COUNTRY_PAGES.includes(page)) && (!only || only.includes(c)));
  const opt = (o) => html`<option value="${o.value}">${o.label}</option>`;
  const selects = {};
  const field = (key, label, options) => {
    const el = html`<label class="mm-filterbar-field">${label} <select id="filter-${key}" data-filter-control="${key}">${options}</select></label>`;
    selects[key] = el.querySelector("select");
    return el;
  };
  const indicatorBody = (state) => {
    const {empty, groups} = indicatorOptionGroups({indicators: data.indicators, domains: data.domains, domainId: state.d, frequency: state.f});
    return [opt(empty), ...groups.map((g) => (g.label ? html`<optgroup label="${g.label}">${g.options.map(opt)}</optgroup>` : g.options.map(opt)))];
  };
  // PG-INDICATOR (amendment 2.4, L23): the Indicator control is a switcher that navigates. Choosing an option never navigates (WCAG 3.2.2); the
  // explicit Go button, or Enter on the select, does. It is not a store control (no data-filter-control), so `i` is never written on this page.
  const indicatorSwitcher = () => {
    const {groups} = indicatorOptionGroups({indicators: data.indicators, domains: data.domains});
    const el = html`<span class="mm-filterbar-field mm-filterbar-switcher"><label>${L.indicator} <select id="filter-indicator">${groups.map((g) => (g.label ? html`<optgroup label="${g.label}">${g.options.map(opt)}</optgroup>` : g.options.map(opt)))}</select></label> <button type="button" id="indicator-switcher-go" class="mm-country-go">${DRAFT_INDICATOR_SWITCHER_GO}</button></span>`;
    const select = el.querySelector("select");
    select.value = data.currentIndicator ?? "";
    const go = () => {
      if (select.value) globalThis.location.assign(`./${select.value}${globalThis.location.hash}`);
    };
    el.querySelector("button").addEventListener("click", go);
    select.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      go();
    });
    return el;
  };
  const s0 = store.get();
  const builders = {
    group: () => field("group", L.group, groupOptions(data.groups).map(opt)),
    country: () => mountCountryChip(html, {store, data: {entities: data.entities ?? [], groups: data.groups ?? []}}),
    domain: () => field("domain", L.domain, domainOptions(data.domains).map(opt)),
    indicator: () => (page === "indicator" ? indicatorSwitcher() : field("indicator", L.indicator, indicatorBody(s0))),
    period: () => mountPeriodChip(html, {store, manifest: data.manifest}),
    frequency: () => field("frequency", L.frequency, frequencySelectOptions(data.indicators).map(opt))
  };
  const fields = [...(leading ? [leading] : []), ...want.map((c) => builders[c]())]; // matrix order
  const reset = html`<button type="button" class="mm-filterbar-reset" id="filter-reset">${L.reset}</button>`;
  // Compact mode (below 40 rem): the "Filters" <details> holds every control and opens as a panel over the page; the active filters show as chips on
  // one row. From 40 rem the <details> is kept open and its summary is hidden, so the controls are always visible.
  const chips = html`<p class="mm-filterbar-chips" id="filterbar-chips"></p>`;
  const more = html`<details class="mm-filterbar-more" id="filterbar-more"><summary id="filterbar-more-summary">${L.filters}</summary><div class="mm-filterbar-controls">${fields}${reset}</div></details>`;
  const form = html`<form role="group" aria-label="${L.filters}" class="mm-filterbar" id="filterbar" data-page="${page}">${mode ? mountModeSwitch(html, mode) : ""}${more}${chips}</form>`;
  form.addEventListener("submit", (e) => e.preventDefault());
  const doc = form.ownerDocument;
  const win = doc.defaultView;
  const wide = win?.matchMedia ? win.matchMedia(WIDE) : {matches: true, addEventListener() {}};
  const fit = () => {
    more.open = wide.matches;
  };
  fit();
  wide.addEventListener("change", fit);
  more.addEventListener("toggle", () => {
    if (wide.matches && !more.open) more.open = true; // always open from 40 rem
  });
  more.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !more.open || e.defaultPrevented || wide.matches) return; // a chip inside handles (and marks) its own Escape
    e.preventDefault();
    more.open = false;
    more.querySelector("summary").focus();
  });
  const outside = (e) => {
    if (!wide.matches && more.open && !more.contains(e.target)) more.open = false;
  };
  doc.addEventListener("pointerdown", outside);
  doc.addEventListener("focusin", outside);

  // Compact chips and the print line both come from the active filters (summaryParts); the print line fills the slot the shell renders under the freshness line.
  const printLine = () => doc.getElementById("print-filters");
  const paint = (state) => {
    const parts = summaryParts(state, page, only ? {...data, controls: want} : data);
    chips.replaceChildren(...parts.map((t) => html`<span class="mm-filterbar-chip">${t}</span>`));
    const slot = printLine();
    if (slot) slot.textContent = DRAFT_PRINT_FILTERS(parts);
    return slot !== null;
  };
  if (!paint(store.get()) && win?.MutationObserver) {
    const watch = new win.MutationObserver(() => {
      if (paint(store.get())) watch.disconnect(); // the freshness line (and its slot) rendered after the bar
    });
    watch.observe(doc.body, {childList: true, subtree: true});
  }
  store.subscribe(paint);

  // The slot that reserves the bar's height at first paint (static HTML) reports its real height, so scroll offsets equal it (WCAG 2.4.11).
  const slot = doc.getElementById("filterbar-slot");
  if (slot && win?.ResizeObserver) {
    const publish = () => doc.documentElement.style.setProperty("--fbar-h", `${slot.getBoundingClientRect().height}px`);
    new win.ResizeObserver(publish).observe(slot);
    publish();
  }

  // Rebuild the Indicator options (they depend on d and f), then set every select to the state. A value the select does not offer shows "All".
  const sync = (state) => {
    if (selects.indicator) selects.indicator.replaceChildren(...indicatorBody(state));
    const show = {group: state.g, domain: state.d, indicator: state.i, frequency: state.f};
    for (const [key, el] of Object.entries(selects)) {
      el.value = show[key] ?? "";
      if (el.value !== (show[key] ?? "")) el.value = "";
    }
  };
  sync(s0);
  store.subscribe(sync);

  const patchOf = {group: (v) => ({g: v || null}), domain: (v) => ({d: v || null}), indicator: (v) => ({i: v || null}), frequency: (v) => ({f: v || null})};
  form.addEventListener("change", (e) => {
    const key = e.target?.dataset?.filterControl;
    if (!key || !patchOf[key]) return;
    store.set(patchWithIndicatorRule(store.get(), patchOf[key](e.target.value), data));
  });
  const resetPatch = {group: {g: null}, domain: {d: null}, indicator: {i: null}, frequency: {f: null}, period: {from: null, to: null}};
  reset.addEventListener("click", () => (only ? store.set(Object.assign({}, ...want.map((c) => resetPatch[c] ?? {}))) : store.reset()));
  return form;
}
