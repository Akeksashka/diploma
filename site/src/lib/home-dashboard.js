// L11 (layout amendment 4.1, 5): PG-HOME as a dashboard of bands. This module builds the band skeleton with empty card slots and owns the
// data loading policy; the cards themselves are filled by later tasks (L12 compare, L13 heatmap, L14 KPI, L15 indicators table, L16 over time).
//
// Slot API (the contract for L12-L16):
//   const dash = mountHomeDashboard(html, {store, data, loadScorecard});
//   dash.slots.{overview, compare, facts, domain, indicators, overTime}   the empty `.mm-card` elements (aria-busy="true" until filled)
//   dash.legend                   the element directly above the Domain card (L13: the heatmap legend and orientation note, once on the page)
//   dash.onChange(fn) -> off     fn(ctx) runs now and on every filter change or scorecard result; ctx =
//                                {state, domainId, domain, indicatorId, scorecard|null, error|null, loading}
//   dash.fill(slot, ...nodes)    replaces the slot content and sets aria-busy="false"; dash.busy(slot) sets it back.
//   dash.onDomainScorecard(id)   the per-domain loader (below), also usable by a card.
// Nothing here computes a number. Defaults are effective values: they are never written to the hash (filter-store rule).
import {DRAFT_BAND_TITLES as B, DRAFT_CONSEQUENCE, DRAFT_FILTER_LABELS, DRAFT_REGIONS} from "./copy.js";
import {errorBlock} from "./state-blocks.js";
import {indicatorList} from "./filter-model.js";
import {firstDomainId} from "./indicator-model.js";
import {HOME_DEFAULT_INDICATOR} from "./home-config.js";

export const SLOT_NAMES = Object.freeze(["overview", "compare", "facts", "domain", "indicators", "overTime"]);

// Default Domain (amendment 4.1): `default_domain` of meta/domains.json when it names a known ranked domain, else the first ranked domain in
// stored order, else the first domain. `domains` is the list; `declared` the optional top-level default_domain field.
export function defaultDomainId(domains = [], declared = null) {
  const d = domains.find((x) => x.domain_id === declared && x.ranked !== false);
  return (d ?? domains.find((x) => x.ranked === true) ?? domains[0])?.domain_id ?? null;
}

// Effective filter values: the stored hash state, else the defaults.
export function effectiveSelection(state, {domains = [], indicators = [], declaredDomain = null} = {}) {
  const byId = (id) => indicators.find((i) => i.indicator_id === id);
  let domainId = state.d && domains.some((d) => d.domain_id === state.d) ? state.d : null;
  // V56: with no Indicator and no Domain chosen, the Home default Indicator (A05, DRAFT) sets the Domain when the catalogue has it and its first
  // domain is a known one (rows are not needed); with a Frequency also chosen only the Domain is taken, the Indicator stays the first one offered.
  // This takes precedence over the declared default_domain (reported to the user, G-HOME-CONST). Otherwise the previous default stands.
  const homeDefault = !state.i && !state.d ? byId(HOME_DEFAULT_INDICATOR) : null;
  const homeOk = homeDefault?.domain_ids?.length && domains.some((d) => d.domain_id === firstDomainId(homeDefault));
  const chosen = state.i ? byId(state.i) : !state.f && homeOk ? homeDefault : null;
  if (!domainId && homeOk && !state.i) domainId = firstDomainId(homeDefault);
  if (!domainId && chosen?.domain_ids?.length) domainId = firstDomainId(chosen); // AC-RD-24: the first of domain_ids
  domainId ??= defaultDomainId(domains, declaredDomain);
  const domain = domains.find((d) => d.domain_id === domainId) ?? null;
  // No Indicator chosen: the first one the bar's Indicator list offers under the current Domain and Frequency (a Frequency with none offered gives null).
  const offered = state.f ? (indicatorList({indicators, domains, domainId, frequency: state.f})[0]?.indicator_id ?? null) : (domain?.indicator_ids?.[0] ?? null);
  const indicatorId = chosen ? chosen.indicator_id : offered;
  return {domainId, domain, indicatorId};
}

// Per-domain scorecard loader. `loaders` maps domain_id -> () => Promise (literal FileAttachment paths live in the generated page).
// A successful load is cached (one request per domain); a failed load is not cached, so a later request retries. Concurrent calls share one promise.
export function createScorecardLoader(loaders) {
  const done = new Map();
  const pending = new Map();
  return function onDomainScorecard(domainId) {
    if (done.has(domainId)) return Promise.resolve(done.get(domainId));
    if (pending.has(domainId)) return pending.get(domainId);
    const load = loaders[domainId];
    if (typeof load !== "function") return Promise.reject(new Error(`no scorecard file for domain ${domainId}`));
    const p = Promise.resolve()
      .then(load)
      .then((sc) => {
        done.set(domainId, sc);
        return sc;
      })
      .finally(() => pending.delete(domainId));
    pending.set(domainId, p);
    return p;
  };
}

const bandIds = {overview: "band-overview", compare: "band-compare", domain: "band-domain", indicators: "band-indicators", overTime: "band-over-time"};

// The band skeleton: five bands, six empty card slots, the legend element above the Domain card. Shared by the live dashboard and the
// failure view, so a page without data has the same structure and every card slot can show its own state.
function buildSkeleton(html, doc) {
  const slotEl = (name, span, extra = "") => {
    const el = doc.createElement("div");
    el.className = `mm-card mm-card--slot mm-card--span-${span}${extra}`;
    el.dataset.slot = name;
    el.setAttribute("aria-busy", "true");
    return el;
  };
  const slots = {
    overview: slotEl("overview", 12),
    compare: slotEl("compare", 8),
    facts: slotEl("facts", 4),
    domain: slotEl("domain", 12),
    indicators: slotEl("indicators", 12),
    overTime: slotEl("overTime", 12)
  };
  const h2 = (id, text) => html`<h2 id="${id}-heading">${text}</h2>`;
  const domainHeading = h2(bandIds.domain, "");
  const legend = doc.createElement("div");
  legend.className = "mm-dlegend";
  const band = (key, heading, ...cards) =>
    html`<section class="mm-dband" id="${bandIds[key]}" aria-labelledby="${bandIds[key]}-heading"><div class="mm-band">${heading}</div>${key === "domain" ? legend : ""}<div class="mm-grid">${cards}</div></section>`;
  const root = html`<div class="mm-dashboard" id="dashboard">${[
    band("overview", h2(bandIds.overview, B.overview), slots.overview),
    band("compare", h2(bandIds.compare, B.compare), slots.compare, slots.facts),
    band("domain", domainHeading, slots.domain),
    band("indicators", h2(bandIds.indicators, B.indicators), slots.indicators),
    band("overTime", h2(bandIds.overTime, B.overTime), slots.overTime)
  ]}</div>`;
  return {root, slots, domainHeading, legend};
}

// L15 (amendment 5, item 2): the page has no usable meta files, so no card can be built. Each card slot that exists on the live dashboard
// shows the one alert of the failed region inside itself and nothing is left busy; no table, chart or number appears. `failures` is the
// failure list of loadAll() ({key, region, kind}); the first one names the region. Returns the dashboard root.
export function mountHomeFailure(html, {failures = [], doc = globalThis.document} = {}) {
  const {root, slots, domainHeading} = buildSkeleton(html, doc);
  const f = failures[0] ?? {region: DRAFT_REGIONS.meta, kind: "missing"};
  domainHeading.textContent = DRAFT_FILTER_LABELS.domain;
  root.dataset.state = "failed";
  for (const [name, slot] of Object.entries(slots)) {
    slot.replaceChildren(errorBlock(html, {region: f.region, kind: f.kind, consequence: DRAFT_CONSEQUENCE.scorecard, id: `mm-error-card-${name}`}));
    slot.setAttribute("aria-busy", "false");
  }
  return root;
}

// html: htl tag. data: {domains, indicators, ...} (meta lists). domainsDoc: optional parsed top-level fields of domains.json (default_domain).
export function mountHomeDashboard(html, {store, data, loadScorecard, declaredDomain = null, doc = globalThis.document}) {
  const {root, slots, domainHeading, legend} = buildSkeleton(html, doc);

  const subs = new Set();
  const result = {scorecard: null, error: null, loading: false, domainId: null};
  const context = () => {
    const state = store.get();
    return {state, ...effectiveSelection(state, {domains: data.domains, indicators: data.indicators, declaredDomain}), ...result};
  };
  const emitted = []; // render counter for tests: root.dataset.renders = number of emits (store changes and scorecard results)
  const emit = () => {
    emitted.push(1);
    root.dataset.renders = String(emitted.length);
    const ctx = context();
    for (const fn of [...subs]) {
      try {
        fn(ctx);
      } catch {
        // one card's failure must not stop the other cards (amendment 5, item 2); each card shows its own error block
      }
    }
  };

  let current = null; // a late answer for a domain that is no longer selected is ignored
  const sync = () => {
    const {domainId, domain} = effectiveSelection(store.get(), {domains: data.domains, indicators: data.indicators, declaredDomain});
    domainHeading.textContent = domain?.name ?? domainId ?? "";
    if (domainId === result.domainId) return emit();
    result.domainId = domainId;
    result.scorecard = null;
    result.error = null;
    if (domainId === null) return emit();
    result.loading = true;
    const mine = {};
    current = mine;
    emit();
    loadScorecard(domainId).then(
      (sc) => mine === current && Object.assign(result, {scorecard: sc, error: null, loading: false}),
      (err) => mine === current && Object.assign(result, {scorecard: null, error: err, loading: false})
    ).then((applied) => applied && emit());
  };
  store.subscribe(() => sync());
  store.attach?.(); // AC-DB-02: re-read the hash on hashchange (links, Back/Forward, a manual edit); the page cell no longer runs filterGenerator

  const api = {
    root,
    slots,
    legend,
    onDomainScorecard: loadScorecard,
    onChange(fn) {
      subs.add(fn);
      fn(context());
      return () => subs.delete(fn);
    },
    fill(slot, ...nodes) {
      slot.replaceChildren(...nodes);
      slot.setAttribute("aria-busy", "false");
    },
    busy(slot) {
      slot.setAttribute("aria-busy", "true");
    }
  };
  sync();
  return api;
}
