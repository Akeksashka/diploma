// V57, V58, V59 (ADR-037 A2.3; AC-V2-120, 121, 122): the Home composition above the retained ADR-034 cards. Top to bottom: the control strip (exactly the Indicator select,
// the Group select, the Period pair, the Country select that navigates, and the mode links), the KPI strip, and the four panels in the order A C2 ranked bar, B C1 multi-country
// line, C C6 map, D C4 heatmap. The panels are the Compare bodies (compare-page.js) with the Home options: no per-card strip, no C5, and a normalised state in which the percentile
// toggle, `oth`, `stl`, `ctx`, `d`, `f`, `x`, `y`, `p` and `c` are off (a hash key of another page never changes a Home panel). The series files of C1 and C4 are read after the
// `load` event (comparePage), never before. A constant that names an id the export does not carry is listed in a disclosure, never thrown (home-config.js resolveHome).
// Display only: every number is a stored field formatted for print; nothing is computed here.
import {
  DRAFT_HOME_CONTROLS_LABEL, DRAFT_HOME_COUNTRY_LABEL, DRAFT_HOME_KPI_FOR, DRAFT_HOME_KPI_NO_VALUE, DRAFT_HOME_KPI_NOT_LOADED, DRAFT_HOME_KPI_TITLE, DRAFT_HOME_MISSING_ITEM, DRAFT_HOME_MISSING_SUMMARY,
  DRAFT_HOME_MODE_LABEL, DRAFT_HOME_PANELS_LABEL, DRAFT_HOME_PANEL_TITLES, DRAFT_MODE_LABELS, DRAFT_PICKER_LABELS as P, DRAFT_COUNTRY_SWITCHER_GO
} from "./copy.js";
import {comparePage} from "./compare-page.js";
import {compareControls} from "./compare-controls.js";
import {hiddenRowsDisclosure} from "./hidden-rows.js";
import {k1Card} from "./kpi-view.js";
import {periodLabel} from "./period.js";
import {pickerHref, pickerLists} from "./picker.js";
import {formatValue} from "./scorecard.js";
import {indicatorUnit} from "./units.js";

export const HOME_PANEL_ORDER = Object.freeze(["c2", "c1", "c6", "c4"]); // panels A, B, C, D
export const HOME_PANEL_LETTERS = Object.freeze({c2: "A", c1: "B", c6: "C", c4: "D"});
export const HOME_CONTROL_KEYS = Object.freeze(["indicator", "group", "period"]); // plus the Country select (it navigates) and the mode links; nothing else is on Home
export const HOME_STORE_KEYS = Object.freeze(["i", "g", "from", "to"]); // the hash keys a Home control writes

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// The state every Home panel reads: the Home default Indicator when none is chosen, and every key that is not a Home control forced off.
export function homeState(state = {}, resolved = {}) {
  return {...state, i: state.i ?? resolved.defaultIndicator ?? null, c: [], d: null, f: null, x: null, y: null, p: null, pc: false, oth: false, stl: false, ctx: false, rb: null};
}

// Domain ids whose scorecard the landing reads: the domain of every KPI indicator and of the default Indicator (the first of its domain_ids, as cellIndex reads first).
export function homeLandingDomains(resolved, indicators = []) {
  const byId = new Map(indicators.map((i) => [i.indicator_id, i]));
  const out = [];
  for (const id of [resolved.defaultIndicator, ...resolved.kpiIds]) {
    const d = byId.get(id)?.domain_ids?.[0];
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

// The KPI strip model: one card per resolved KPI id for the resolved entity, in the constant's order. A card with no stored value (or no scorecard) goes to `hidden`
// (reason no_data), the one array the strip's hidden-rows disclosure renders. `failed` is the set of domain ids whose scorecard could not be read.
export function homeKpiModel({resolved, entities = [], indicators = [], scorecards = {}, series = [], failed = new Set()} = {}) {
  const entity = entities.find((e) => e.entity_id === resolved?.kpiEntity) ?? null;
  const byId = new Map(indicators.map((i) => [i.indicator_id, i]));
  const cards = [];
  const hidden = [];
  for (const id of resolved?.kpiIds ?? []) {
    const ind = byId.get(id) ?? null;
    const domainId = ind?.domain_ids?.[0] ?? null;
    const row = entity ? scorecards[domainId]?.entities?.find((e) => e.entity_id === entity.entity_id) ?? null : null;
    const cell = row?.indicators?.find((c) => c.indicator_id === id) ?? null;
    const hasValue = cell !== null && cell.value !== null && cell.value !== undefined && cell.published !== false && cell.publish_scope !== "excluded";
    const s = entity ? series.find((x) => x.indicator_id === id && x.entity_id === entity.entity_id) ?? null : null;
    if (!hasValue) {
      hidden.push({reason: "no_data", row: {indicatorId: id, name: ind?.name ?? id, reasonSentence: failed.has(domainId) ? DRAFT_HOME_KPI_NOT_LOADED : DRAFT_HOME_KPI_NO_VALUE}});
      continue;
    }
    cards.push({
      indicatorId: id,
      name: ind?.name ?? id,
      valueText: formatValue(cell.value),
      unit: indicatorUnit(ind),
      refPeriodEnd: cell.ref_period_end ?? null,
      periodText: periodLabel(cell.ref_period_end, s?.frequency) ?? cell.ref_period_end ?? null,
      estimate: cell.value_kind === "estimate",
      inherited: cell.inherited === true,
      stale: cell.is_stale === true,
      sourceName: s?.source_name ?? null,
      sourceUrl: s?.source_url ?? null
    });
  }
  return {entity: entity ? {id: entity.entity_id, name: entity.name ?? entity.entity_id} : null, cards, hidden, missing: resolved?.missing ?? []};
}

// The disclosure of constants that name an id this export does not carry (never an error).
export function homeMissingDisclosure(html, missing = []) {
  if (missing.length === 0) return "";
  const text = (m) => DRAFT_HOME_MISSING_ITEM(m.constant ?? m, m.id ?? "");
  return html`<details class="mm-hidden-rows mm-home-missing" id="home-missing"><summary>${DRAFT_HOME_MISSING_SUMMARY}</summary><ul>${missing.map((m) => html`<li data-constant="${m.constant}" data-id="${m.id}">${text(m)}</li>`)}</ul></details>`;
}

// The strip: K1-style cards (no sparkline, no delta, no percentile), then the hidden-rows disclosure of cards without a value, then the missing-constant disclosure.
export function homeKpiStrip(html, model, {href = (id) => `./indicator/${id}`} = {}) {
  const note = model.entity ? html`<p class="mm-card-sub" data-field="kpi-entity">${DRAFT_HOME_KPI_FOR(model.entity.name)}</p>` : "";
  const disclosure = hiddenRowsDisclosure(html, model.hidden, {label: (r) => r.name, id: (r) => r.indicatorId, period: () => null, sentence: (r) => r.reasonSentence, href: (r) => href(r.indicatorId)});
  return html`<section class="mm-home-kpi" id="home-kpi" aria-labelledby="home-kpi-h"><h2 id="home-kpi-h">${DRAFT_HOME_KPI_TITLE}</h2>${note}<div class="mm-home-kpi-grid" role="list">${model.cards.map((c) => html`<div role="listitem" class="mm-home-kpi-item">${k1Card(html, c, {href})}</div>`)}</div><div role="status" data-slot="kpi-hidden">${disclosure}</div>${homeMissingDisclosure(html, model.missing)}</section>`;
}

// Mode links of the header (plain links; the Home page is neither Country nor Compare, so none is current). They keep the keys that stay meaningful (carry.js).
export function homeModeLinks(html, {hrefs = {country: "./country", compare: "./compare"}} = {}) {
  return html`<div class="mm-mode-switch mm-home-modes" role="group" aria-label="${DRAFT_HOME_MODE_LABEL}"><ul>${["country", "compare"].map((m) => html`<li><a href="${hrefs[m]}" data-carry="${m}">${DRAFT_MODE_LABELS[m]}</a></li>`)}</ul></div>`;
}

// The Country select of Home: native, limited by the Group, navigates only on the explicit Go button (or Enter), as the picker (WCAG 3.2.2). It writes no filter key.
export function homeCountrySelect(html, {entities = [], groups = [], store = null, win = globalThis} = {}) {
  const opt = (o) => html`<option value="${o.id}">${o.label}</option>`;
  const optionsOf = (groupId) => {
    const lists = pickerLists({entities, groups, groupId, currentId: null});
    return [html`<option value="">${P.placeholder}</option>`, html`<optgroup label="${P.countries}">${lists.countries.map(opt)}</optgroup>`, ...(lists.aggregates.length ? [html`<optgroup label="${P.aggregates}">${lists.aggregates.map(opt)}</optgroup>`] : [])];
  };
  const select = html`<select id="home-country" data-home-control="country">${optionsOf(store?.get().g ?? null)}</select>`;
  const root = html`<span class="mm-compare-field mm-home-country"><label>${DRAFT_HOME_COUNTRY_LABEL} ${select}</label> <button type="button" id="home-country-go" class="mm-country-go">${DRAFT_COUNTRY_SWITCHER_GO}</button></span>`;
  if (typeof root?.querySelector !== "function") return root;
  const go = () => {
    if (select.value) win.location.assign(pickerHref(`./country/${select.value}`, win.location.hash, select.value));
  };
  select.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go();
  });
  root.querySelector("button").addEventListener("click", go);
  store?.subscribe((s) => {
    const keep = select.value;
    select.replaceChildren(...optionsOf(s.g ?? null));
    select.value = keep;
    if (select.value !== keep) select.value = "";
  });
  return root;
}

// The control strip: Indicator (optgroup by domain, `i`), Group (`g`), Period (`from`, `to`) from compare-controls, then the Country select inside the same labelled group.
export function homeControls(html, {store, data, resolved, win = globalThis}) {
  const form = compareControls(html, "home", {store, data, keys: HOME_CONTROL_KEYS, label: DRAFT_HOME_CONTROLS_LABEL, effective: (s) => homeState(s, resolved)});
  const country = homeCountrySelect(html, {entities: data.entities, groups: data.groups, store, win});
  if (typeof form?.querySelector !== "function") return html`${form}${country}`; // no DOM (offline tests): the same controls, side by side
  form.insertBefore(country, form.querySelector('[data-slot="home-msg"]'));
  return form;
}

// The page. inputs: {entities, groups, domains, indicators, series, scorecards (mutable {domain_id: scorecard}), knownCutoff, bounds, manifest}; history: historySource(); opts:
// {store, resolved (resolveHome), loadScorecard (domain_id -> Promise, or null), links, geo (as comparePage)}. Returns the root node (a plain section list without `store`).
export function homePage(html, Plot, inputs, history = null, {store = null, resolved, loadScorecard = null, links = {}, geo = null, failedDomains = new Set()} = {}) {
  const failed = new Set(failedDomains);
  const asking = new Set();
  const domainOf = (indicator) => indicator?.domain_ids?.[0] ?? null;
  // True while the indicator's first domain scorecard is neither read nor failed; ensure() then asks the loader once.
  const pending = (indicator) => {
    const d = domainOf(indicator);
    if (!d || inputs.scorecards[d] || failed.has(d)) return false;
    return loadScorecard !== null;
  };
  const kpi = homeKpiStrip(html, homeKpiModel({resolved, entities: inputs.entities, indicators: inputs.indicators, scorecards: inputs.scorecards, series: inputs.series, failed}), {href: links.indicator});
  const normalize = (s) => homeState(s, resolved);
  const panels = comparePage(html, Plot, inputs, history, {store, cards: HOME_PANEL_ORDER, strips: false, secondary: false, normalize, pending, titles: DRAFT_HOME_PANEL_TITLES, rootClass: "mm-home-panels-grid", links, geo});
  const data = {indicators: inputs.indicators, domains: inputs.domains, groups: inputs.groups, entities: inputs.entities, bounds: inputs.bounds};
  const controls = store ? homeControls(html, {store, data, resolved}) : "";
  const root = html`<div class="mm-home-composition" id="home-composition" data-order="${HOME_PANEL_ORDER.join(",")}">
<div class="mm-home-header" data-slot="home-controls">${homeModeLinks(html)}${controls}</div>
${kpi}
<section class="mm-home-panels" id="home-panels" aria-label="${DRAFT_HOME_PANELS_LABEL}">${panels}</section></div>`;
  if (typeof root?.querySelector !== "function") return root;
  for (const c of HOME_PANEL_ORDER) root.querySelector(`[data-slot="${c}"]`)?.setAttribute("data-panel", HOME_PANEL_LETTERS[c]);
  function ensure(s) {
    const indicator = inputs.indicators.find((i) => i.indicator_id === homeState(s, resolved).i) ?? null;
    const d = domainOf(indicator);
    if (!d || inputs.scorecards[d] || failed.has(d) || asking.has(d) || loadScorecard === null) return;
    asking.add(d);
    Promise.resolve()
      .then(() => loadScorecard(d))
      .then((sc) => {
        inputs.scorecards[d] = sc;
      })
      .catch(() => failed.add(d))
      .finally(() => {
        asking.delete(d);
        panels.repaint?.();
      });
  }
  if (store) {
    ensure(store.get());
    store.subscribe(ensure);
  }
  return root;
}
