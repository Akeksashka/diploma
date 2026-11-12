// L21 (layout amendment 2.4, redesign spec C-SER-1): the filter bar on PG-SERIES drives the rail's own controls through the one filter store.
// Domain and Frequency narrow the indicator picker and the series list; Period is the year range of the rail's From/To selects.
// Pure builders plus a few small DOM helpers; nothing is computed from data beyond stored fields (AC-DB-03), no resampling.
import {indicatorList} from "./filter-model.js";
import {indicatorGroups, yearsOf} from "./explorer.js";

// The picker groups (indicatorGroups) restricted to indicators that match Domain `d` and Frequency `f` (stored domain_ids / frequency_set).
export function narrowedGroups(ctx, {d = null, f = null} = {}) {
  if (!d && !f) return indicatorGroups(ctx);
  const keep = new Set(indicatorList({indicators: ctx.indicators, domains: ctx.domains ?? [], domainId: d, frequency: f}).map((i) => i.indicator_id));
  return indicatorGroups(ctx)
    .map((g) => ({...g, options: g.options.filter((o) => keep.has(o.id))}))
    .filter((g) => g.options.length > 0);
}

export const offeredIds = (groups) => groups.flatMap((g) => g.options.map((o) => o.id));

// The picker's groups on load and after a change: narrowed by Domain and Frequency; an empty narrowed list keeps the full picker (no empty picker).
export function pickerGroups(ctx, state) {
  const g = narrowedGroups(ctx, state);
  return g.length ? g : indicatorGroups(ctx);
}

// The indicator the picker starts on. `wanted` (from the address, or the default) is kept when the narrowed list offers it; otherwise the first
// offered one. `fell` (the fallback note) is true only when the address itself named `wanted` (`fromAddress`): a default that the Domain does not
// offer is replaced silently. An empty narrowed list keeps `wanted` (no empty picker).
export function resolveIndicator(ctx, wanted, state, fromAddress = true) {
  const ids = offeredIds(narrowedGroups(ctx, state));
  if (!ids.length || ids.includes(wanted)) return {indicator: wanted, fell: false};
  return {indicator: ids[0], fell: fromAddress};
}

// Series list: only rows whose stored frequency equals `f` (no resampling).
export const rowsOfFrequency = (rows, f) => (f ? rows.filter((r) => r.frequency === f) : rows);

// Years for buildModel from the store state: "" is the open end.
export const modelPeriod = (state) => ({from: state.from ?? "", to: state.to ?? ""});

// What the rail's From/To selects show for a store state ("" is first / last).
export const railValues = (state) => ({from: state.from != null ? String(state.from) : "", to: state.to != null ? String(state.to) : ""});

// A rail choice becomes a stored pair. Both open: null/null. One open: the other end is the first / last year of `rows`. from > to or no
// rows for an open end: {ok: false} (nothing is written; the rail shows the stored value again).
export function railPatch(fromValue, toValue, rows) {
  if (fromValue === "" && toValue === "") return {ok: true, from: null, to: null};
  const years = yearsOf(rows);
  const from = fromValue === "" ? years[0] : Number(fromValue);
  const to = toValue === "" ? years.at(-1) : Number(toValue);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return {ok: false};
  return {ok: true, from, to};
}

// A generator over the store that yields `pick(state)` and then only when its JSON changes (a change of i or c does not re-run a cell that
// reads only the period). `Generators` is the Framework global (passed in).
export function storeWatch(Generators, store, pick) {
  return Generators.observe((notify) => {
    let last = JSON.stringify(pick(store.get()));
    notify(pick(store.get()));
    return store.subscribe((state) => {
      const v = pick(state);
      const k = JSON.stringify(v);
      if (k === last) return;
      last = k;
      notify(v);
    });
  });
}

// Show a store year in a rail select even when the loaded file has no row in that year (the option is added, never a silent blank).
export function showRailYear(select, value) {
  if (value !== "" && ![...select.options].some((o) => o.value === value)) {
    const o = select.ownerDocument.createElement("option");
    o.value = value;
    o.textContent = value;
    const at = [...select.options].findIndex((x) => x.value !== "" && Number(x.value) > Number(value));
    select.insertBefore(o, at < 0 ? null : select.options[at]);
  }
  select.value = value;
}

// Wire the rail's From / To selects to the store: show the stored pair, write a valid choice, restore the stored value on a refused one.
// Returns the detach function.
export function wireRailPeriod(box, store, rows) {
  const fromSel = box.from.querySelector("select");
  const toSel = box.to.querySelector("select");
  const show = (state) => {
    const v = railValues(state);
    showRailYear(fromSel, v.from);
    showRailYear(toSel, v.to);
  };
  show(store.get());
  const onChange = () => {
    const r = railPatch(fromSel.value, toSel.value, rows);
    if (r.ok) store.set({from: r.from, to: r.to});
    else show(store.get());
  };
  fromSel.addEventListener("change", onChange);
  toSel.addEventListener("change", onChange);
  const off = store.subscribe(show);
  return () => {
    off();
    fromSel.removeEventListener("change", onChange);
    toSel.removeEventListener("change", onChange);
  };
}

// Rebuild the picker's options when Domain or Frequency changed. The selected indicator stays when still offered; otherwise the first offered
// one is chosen and an "input" event tells the page (the page then writes i). An empty narrowed list leaves the picker as it is.
export function updatePicker(html, select, ctx, state) {
  const groups = narrowedGroups(ctx, state);
  const ids = offeredIds(groups);
  if (!ids.length) return false;
  const opt = (o) => html`<option value="${o.id}">${o.label}</option>`;
  const before = select.value;
  select.replaceChildren(...groups.map((g) => (g.label ? html`<optgroup label="${g.label}">${g.options.map(opt)}</optgroup>` : g.options.map(opt))).flat());
  select.value = ids.includes(before) ? before : ids[0];
  if (select.value !== before) select.dispatchEvent(new select.ownerDocument.defaultView.Event("input", {bubbles: true}));
  return true;
}
