// V17 (spec 5.2, 5.3 as amended by A1.1, A1.3; ADR-037 decision 7): the controls of the Compare charts. Each chart card shows ONLY the controls that act on it
// (the applicability matrix below, pinned by a table test). Native controls only (selects, checkboxes) plus the existing Country chip on C1; every control writes
// the filter store (one hash key each: i, d, c, g, from + to, f, x, y, p, pc, oth, stl, ctx). There is no projection control and no `m`/`proj` key (A1.3), and no
// rebase control: rb is not offered before the stored marker scale_hint = index exists (A1.5). Display only: nothing is computed here; options come from meta/*.
import {DRAFT_COMPARE_CARD_TITLES, DRAFT_COMPARE_CONTROLS_LABEL, DRAFT_COMPARE_CONTROL_LABELS as C, DRAFT_CONTEXT_LINES, DRAFT_FILTER_ALL, DRAFT_FILTER_LABELS as L, DRAFT_FREQUENCY_NAMES, DRAFT_INCLUDE_OTHER_PERIODS, DRAFT_PERIOD_INVALID, DRAFT_SHOW_PERCENTILE, DRAFT_SHOW_STALE} from "./copy.11b4a285.js";
import {domainOptions, groupOptions, indicatorOptionGroups} from "./filter-bar-options.cd9f6ad6.js";
import {mountCountryChip} from "./filter-country.5212c4ca.js";
import {periodYears, validatePair} from "./filter-period.86b66c90.js";

export const COMPARE_CHARTS = Object.freeze(["c1", "c2", "c3", "c4"]); // the charts that have a control strip; C5, T2 and C6 render no strip

// Applicability matrix (spec 5.3 with A1.1: C4 gains stl; `oth` is not on C4). It lists exactly the strips the Compare page renders: C1 to C4. T2 renders always (spec 4) and C5 only while pc is on,
// both without a strip of their own: they read Group and pc from the strips above (the C2 pc switch, the Group select) and C5 reads Domain from the C4 strip. C6 has no strip either.
export const COMPARE_CONTROLS = Object.freeze({
  c1: Object.freeze(["indicator", "countries", "group", "period", "frequency", "ctx"]),
  c2: Object.freeze(["indicator", "group", "frequency", "pc", "oth"]),
  c3: Object.freeze(["x", "y", "group", "frequency", "p"]),
  c4: Object.freeze(["indicator", "domain", "group", "frequency", "period", "stl"])
});

// The hash keys each control writes.
export const CONTROL_KEYS = Object.freeze({indicator: ["i"], domain: ["d"], countries: ["c"], group: ["g"], period: ["from", "to"], frequency: ["f"], x: ["x"], y: ["y"], p: ["p"], pc: ["pc"], oth: ["oth"], stl: ["stl"], ctx: ["ctx"]});

const FLAGS = Object.freeze({pc: DRAFT_SHOW_PERCENTILE, oth: DRAFT_INCLUDE_OTHER_PERIODS, stl: DRAFT_SHOW_STALE, ctx: DRAFT_CONTEXT_LINES});

// The controls of one chart. A page that fixes the indicator (PG-INDICATOR) has no Indicator control and no Direction/Domain list on its charts.
export function compareControlKeys(chart, {fixedIndicator = false} = {}) {
  const keys = COMPARE_CONTROLS[chart] ?? [];
  return fixedIndicator ? keys.filter((k) => k !== "indicator" && !(k === "domain" && chart === "c4")) : [...keys];
}

// Frequency options: only frequencies in the stored frequency_set of the indicator(s) the chart reads (C3: both). A chart with no indicator offers every stored frequency.
export function frequencyChoices(indicators = [], ids = []) {
  const chosen = ids.map((id) => indicators.find((i) => i.indicator_id === id)).filter(Boolean);
  const lists = chosen.length === 0 ? indicators.map((i) => i.frequency_set ?? []) : chosen.map((i) => i.frequency_set ?? []);
  const common = ["D", "M", "Q", "A"].filter((f) => lists.length > 0 && (chosen.length === 0 ? lists.some((l) => l.includes(f)) : lists.every((l) => l.includes(f))));
  return common.map((f) => ({value: f, label: DRAFT_FREQUENCY_NAMES[f] ?? f}));
}

const indicatorOptions = (indicators, domains, domainId, empty) => {
  const {groups} = indicatorOptionGroups({indicators, domains, domainId});
  return {empty: {value: "", label: empty}, groups};
};

// One descriptor per control: {key, id, kind: "select"|"checkbox"|"chip", label, value, options|groups}. `periods` are the stored common periods of C3 ([{value, label}]).
export function compareControlModel(chart, {state = {}, indicators = [], domains = [], groups = [], bounds = null, periods = [], fixedIndicator = false, keys = null} = {}) {
  const idOf = (k) => `${chart}-ctl-${k}`;
  const ids = chart === "c3" ? [state.x, state.y].filter(Boolean) : [state.i].filter(Boolean);
  return (keys ?? compareControlKeys(chart, {fixedIndicator})).map((key) => {
    const base = {key, id: idOf(key)};
    if (key in FLAGS) return {...base, kind: "checkbox", label: FLAGS[key], value: state[key] === true};
    if (key === "group") return {...base, kind: "select", label: L.group, value: state.g ?? "", options: groupOptions(groups)};
    if (key === "domain") return {...base, kind: "select", label: C.domain, value: state.d ?? "", options: domainOptions(domains)};
    if (key === "frequency") return {...base, kind: "select", label: L.frequency, value: state.f ?? "", options: [{value: "", label: DRAFT_FILTER_ALL.frequencies}, ...frequencyChoices(indicators, ids)]};
    if (key === "indicator") return {...base, kind: "select", label: L.indicator, value: state.i ?? "", ...indicatorOptions(indicators, domains, state.d ?? null, C.choose)};
    if (key === "x" || key === "y") return {...base, kind: "select", label: C[key], value: state[key] ?? "", ...indicatorOptions(indicators, domains, null, C.choose)};
    if (key === "p") return {...base, kind: "select", label: C.p, value: state.p ?? "", options: [{value: "", label: C.latest}, ...periods]};
    if (key === "period") {
      const years = periodYears(bounds).map((y) => ({value: String(y), label: String(y)}));
      return {...base, kind: "period", label: L.period, from: {id: idOf("from"), label: L.from, value: state.from == null ? "" : String(state.from), options: [{value: "", label: L.all}, ...years]}, to: {id: idOf("to"), label: L.to, value: state.to == null ? "" : String(state.to), options: [{value: "", label: L.all}, ...years]}};
    }
    return {...base, kind: "chip", label: C.countries};
  });
}

// The store patch of a user change of one control. Flags 0|1; selects the stored id or null; the Period is a pair (from <= to, inside the bounds): both All clears it,
// one All waits for the other (nothing written), an invalid pair is refused with the stated message. Frequency, Domain and Indicator keep the same Indicator rule as the filter bar.
export function compareControlPatch(key, raw, {state = {}, bounds = null, other = null} = {}) {
  if (key in FLAGS) return {patch: {[key]: raw === true || raw === "1" || raw === 1}};
  if (key === "period") {
    const {from, to} = raw ?? {};
    if ((from ?? "") === "" && (to ?? "") === "") return {patch: {from: null, to: null}};
    if ((from ?? "") === "" || (to ?? "") === "") return {wait: true};
    const pair = validatePair(from, to, bounds);
    return pair.ok ? {patch: {from: pair.from, to: pair.to}} : {refused: DRAFT_PERIOD_INVALID};
  }
  const value = raw === "" || raw == null ? null : String(raw);
  const map = {indicator: "i", domain: "d", group: "g", frequency: "f", x: "x", y: "y", p: "p"};
  if (!(key in map)) return {};
  const patch = {[map[key]]: value};
  // A Domain or Frequency that no longer offers the chosen Indicator clears it (the filter bar's rule): a select cannot show a value it does not offer.
  if ((key === "domain" || key === "frequency") && state.i && other?.offered && !other.offered.includes(state.i)) patch.i = null;
  return {patch};
}

// Builds the control strip of one chart card. `store` is the page's filter store; `data` = {indicators, domains, groups, entities, manifest, bounds, periods?: () => [...]}.
// The strip re-reads the store on every change so the selects show the state; it never navigates.
// V58 (Home): `keys` replaces the applicability list, `label` the group's accessible name and `effective(state)` the state the selects show (Home shows its default Indicator).
export function compareControls(html, chart, {store, data, fixedIndicator = false, keys = null, label = null, effective = (s) => s}) {
  const model = () => compareControlModel(chart, {keys, state: effective(store.get()), indicators: data.indicators, domains: data.domains, groups: data.groups, bounds: data.bounds ?? null, periods: data.periods?.() ?? [], fixedIndicator});
  const opt = (o) => html`<option value="${o.value}">${o.label}</option>`;
  const optionNodes = (d) => (d.groups ? [opt(d.empty), ...d.groups.map((g) => (g.label ? html`<optgroup label="${g.label}">${g.options.map(opt)}</optgroup>` : g.options.map(opt)))] : d.options.map(opt));
  const field = (d) => {
    if (d.kind === "checkbox") return html`<label class="mm-compare-field mm-compare-flag"><input type="checkbox" id="${d.id}" data-compare-control="${d.key}" checked=${d.value}> ${d.label}</label>`;
    if (d.kind === "chip") return html`<span class="mm-compare-field" data-compare-control="${d.key}" data-slot="${d.id}"></span>`;
    if (d.kind === "period") {
      return html`<span class="mm-compare-field mm-compare-period"><label>${d.from.label} <select id="${d.from.id}" data-compare-control="period" data-part="from">${d.from.options.map(opt)}</select></label> <label>${d.to.label} <select id="${d.to.id}" data-compare-control="period" data-part="to">${d.to.options.map(opt)}</select></label></span>`;
    }
    return html`<label class="mm-compare-field">${d.label} <select id="${d.id}" data-compare-control="${d.key}">${optionNodes(d)}</select></label>`;
  };
  const m0 = model();
  const msg = html`<p class="mm-chip-msg" role="status" data-slot="${chart}-msg"></p>`;
  const form = html`<form class="mm-compare-controls" role="group" aria-label="${label ?? DRAFT_COMPARE_CONTROLS_LABEL(DRAFT_COMPARE_CARD_TITLES[chart])}" data-chart-controls="${chart}">${m0.map(field)}${msg}</form>`;
  if (typeof form?.addEventListener !== "function") return form;
  form.addEventListener("submit", (e) => e.preventDefault());
  const chipSlot = form.querySelector('[data-compare-control="countries"]');
  if (chipSlot) chipSlot.replaceChildren(mountCountryChip(html, {store, data: {entities: data.entities ?? [], groups: data.groups ?? []}}));
  const sync = (state) => {
    for (const d of model()) {
      if (d.kind === "checkbox") {
        const el = form.querySelector(`#${d.id}`);
        if (el) el.checked = d.value;
      } else if (d.kind === "select") {
        const el = form.querySelector(`#${d.id}`);
        if (!el) continue;
        if (d.key === "frequency" || d.key === "indicator" || d.key === "x" || d.key === "y" || d.key === "p") el.replaceChildren(...optionNodes(d));
        el.value = d.value;
        if (el.value !== d.value) el.value = "";
      } else if (d.kind === "period") {
        for (const part of [d.from, d.to]) {
          const el = form.querySelector(`#${part.id}`);
          if (el) el.value = part.value;
        }
      }
    }
    msg.textContent = "";
    return state;
  };
  sync(store.get());
  store.subscribe(sync);
  form.refresh = () => sync(store.get()); // after a series file has been read the C3 periods exist
  form.addEventListener("change", (e) => {
    const key = e.target?.dataset?.compareControl;
    if (!key || key === "countries") return;
    const state = store.get();
    let raw = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (key === "period") raw = {from: form.querySelector(`#${chart}-ctl-from`).value, to: form.querySelector(`#${chart}-ctl-to`).value};
    const next = {...state, ...(key === "domain" ? {d: raw || null} : key === "frequency" ? {f: raw || null} : {})};
    const offered = key === "domain" || key === "frequency" ? indicatorOptionGroups({indicators: data.indicators, domains: data.domains, domainId: next.d, frequency: next.f}).groups.flatMap((g) => g.options.map((o) => o.value)) : null;
    const res = compareControlPatch(key, raw, {state, bounds: data.bounds ?? null, other: offered ? {offered} : null});
    if (res.refused) {
      msg.textContent = res.refused;
      sync(state);
      return;
    }
    if (res.patch) store.set(res.patch);
  });
  return form;
}

// The "Show percentile" switch of a page that has no chart strip with it (PG-DOMAIN): one native checkbox that writes `pc` and follows the store (ADR-037 decision 3).
export function pcSwitch(html, store, {id = "pc-toggle"} = {}) {
  const root = html`<label class="mm-compare-field mm-compare-flag"><input type="checkbox" id="${id}" data-compare-control="pc" checked=${store.get().pc === true}> ${DRAFT_SHOW_PERCENTILE}</label>`;
  if (typeof root?.querySelector !== "function") return root;
  const input = root.querySelector("input");
  input.addEventListener("change", () => store.set({pc: input.checked}));
  store.subscribe((s) => {
    input.checked = s.pc === true;
  });
  return root;
}
