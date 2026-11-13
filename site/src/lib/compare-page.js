// V23 (ADR-037 decision 1, spec 2, 4; AC-RD-01/02/05): the arrangement of PG-COMPARE (`/compare`) and PG-INDICATOR (`/indicator/<id>`, Compare mode with that indicator fixed).
// Cards in this order: C1 multi-country line, C2 ranked bar, C6 choropleth map (V55; no control of its own, it reads the shared state), C3 scatter, C4 heatmap, T2 indicator table, then the secondary percentile block C5 (a closed <details>, present only while
// `pc` is on). Each card has its own control strip (compare-controls.js: only the controls that act on it) over a body that is rebuilt on a store change, so a control keeps focus.
// The series files are read after the page has loaded, at most once per indicator (never part of the landing weight); a failed file shows the stated sentence in its cards only.
// The standing caveat is printed on every page; the orientation sentence follows it only while pc is on (ADR-026 decision 3). Display only: nothing is computed here.
import {CAVEAT, DRAFT_COMPARE_CARD_TITLES, DRAFT_COMPARE_CHOOSE_INDICATOR, DRAFT_COMPARE_SECONDARY, DRAFT_C6_CARD_TITLE, DRAFT_C6_GEO_PENDING, DRAFT_COMPARE_SERIES_PENDING, DRAFT_SERIES_UNREADABLE, ORIENTATION_NOTE} from "./copy.js";
import {barListBlock, barListModel, barListSortOptions} from "./bar-list.js";
import {choroplethBlock} from "./choropleth.js";
import {choroplethModel} from "./choropleth-model.js";
import {compareControls} from "./compare-controls.js";
import {loadSeries} from "./explorer.js";
import {glyphSprite} from "./glyphs.js";
import {cardView} from "./heatmap.js";
import {hasHistory} from "./history.js";
import {indicatorModel} from "./indicator-model.js";
import {peerGroups, resultsBlock} from "./indicator-view.js";
import {multiLineBlock, multiLineModel} from "./multi-line.js";
import {scatterBlock, scatterModel} from "./scatter.js";
import {domainBlock} from "./scorecard-view.js";
import {domainView} from "./scorecard.js";
import {c4SortOptions, timeHeatmapBlock, timeHeatmapModel} from "./time-heatmap.js";

// The standing caveat on every page; the orientation sentence follows it only while pc is on.
export const pcNotes = (html, on) => html`<p class="mm-caveat">${CAVEAT}</p>${on ? html`<p class="mm-orientation">${ORIENTATION_NOTE}</p>` : ""}`;

const CARDS = Object.freeze(["c1", "c2", "c6", "c3", "c4", "t2"]);
const CARD_TITLES = Object.freeze({...DRAFT_COMPARE_CARD_TITLES, c6: DRAFT_C6_CARD_TITLE});

// A native select for the card's local sort (not a hash key): onChange(id).
function sortSelect(html, options, value, onChange, id) {
  const el = html`<select id="${id}">${options.map((o) => html`<option value="${o.id}">${o.label}</option>`)}</select>`;
  if (typeof el?.addEventListener !== "function") return el;
  el.value = value;
  el.addEventListener("change", () => onChange(el.value));
  return el;
}

// inputs: {entities, groups, domains, indicators, series, scorecards ({domain_id: scorecard}), knownCutoff, bounds, manifest}; history: historySource() or null;
// opts: {store, fixedIndicator (an indicator id or null), links: {country, revisions}, downloadHref (address of the indicator's series file, PG-INDICATOR only), geo ({asset, join}: FileAttachment objects with .json(), or the parsed documents; read once, only when C6 is drawn)}. Without `store` the page is the static arrangement of the default (empty) state.
export function comparePage(html, Plot, inputs, history = null, {store = null, fixedIndicator = null, links = {}, downloadHref = null, geo = null} = {}) {
  const countryHref = links.country ?? ((id) => `./country/${id}`);
  const revisionsHref = links.revisions ?? "./revisions";
  const read = () => (store ? store.get() : {c: [], pc: false, ctx: false, oth: false, stl: false});
  const loaded = new Map();
  const failed = new Set();
  const loading = new Set();
  const sorts = {c2: "value", c4: "value"};
  let timer = null;
  let started = false;
  const want = new Set();
  // The geometry asset and the join table (V54: loaded once, and only here, so only a page that renders C6 fetches them). A failed read is stated; the table still lists every row.
  let geoData = null;
  let geoFailed = geo === null;
  let geoLoading = false;
  let wantGeo = false;
  const docOf = (x) => (typeof x?.json === "function" ? x.json() : Promise.resolve(x));
  if (geo !== null && typeof geo.asset?.json !== "function" && typeof geo.join?.json !== "function") geoData = {asset: geo.asset ?? null, join: geo.join ?? null};
  const indicatorOf = (id) => inputs.indicators.find((i) => i.indicator_id === id) ?? null;
  const effective = (s) => fixedIndicator ?? s.i ?? null;

  // The state of the series file of one indicator: rows, "pending" or "failed".
  const rowsOf = (id) => {
    if (loaded.has(id)) return {rows: loaded.get(id)};
    if (failed.has(id)) return {failed: true};
    want.add(id);
    return {pending: true};
  };
  const message = (kind) => (kind === "failed" ? DRAFT_SERIES_UNREADABLE : DRAFT_COMPARE_SERIES_PENDING);
  const note = (id, text, state) => html`<div class="mm-compare-card" id="${id}" data-state="${state}"><p class="mm-state mm-state-${state === "pending" ? "busy" : "empty"}" data-state="${state}">${text}</p></div>`;

  const bodies = {
    c6(s) {
      const indicator = indicatorOf(effective(s));
      if (!indicator) return html`<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_COMPARE_CHOOSE_INDICATOR}</p>`;
      if (geoData === null && !geoFailed) {
        wantGeo = true;
        return note("c6", DRAFT_C6_GEO_PENDING, "pending");
      }
      const m = choroplethModel({indicator, scorecards: inputs.scorecards, entities: inputs.entities, groups: inputs.groups, series: inputs.series, state: s, knownCutoff: inputs.knownCutoff, join: geoData?.join ?? null, asset: geoData?.asset ?? null, geoFailed});
      return choroplethBlock(html, Plot, m, {countryHref, revisionsHref, id: "c6"});
    },
    c1(s) {
      const indicator = indicatorOf(effective(s));
      if (!indicator) return html`<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_COMPARE_CHOOSE_INDICATOR}</p>`;
      const r = rowsOf(indicator.indicator_id);
      if (!r.rows) return note("c1", message(r.pending ? "pending" : "failed"), r.pending ? "pending" : "failed");
      const m = multiLineModel({indicator, rows: r.rows, entities: inputs.entities, groups: inputs.groups, series: inputs.series, scorecards: inputs.scorecards, state: s, knownCutoff: inputs.knownCutoff});
      return multiLineBlock(html, Plot, m, {id: "c1", countryHref, revisionsHref});
    },
    c2(s) {
      const indicator = indicatorOf(effective(s));
      if (!indicator) return html`<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_COMPARE_CHOOSE_INDICATOR}</p>`;
      const m = barListModel({indicator, scorecards: inputs.scorecards, entities: inputs.entities, groups: inputs.groups, series: inputs.series, state: s, sort: sorts.c2, knownCutoff: inputs.knownCutoff});
      const options = barListSortOptions(s.pc === true);
      const sortControl = sortSelect(html, options, m.sortId, (id) => {
        sorts.c2 = id;
        repaint("c2");
      }, "c2-sort");
      return barListBlock(html, Plot, m, {id: "c2", countryHref, revisionsHref, sortControl});
    },
    c3(s) {
      const x = indicatorOf(s.x ?? effective(s));
      const y = indicatorOf(s.y ?? null);
      if (!x || !y) return scatterBlock(html, Plot, scatterModel({x, y}), {id: "c3", countryHref});
      const rx = rowsOf(x.indicator_id);
      const ry = rowsOf(y.indicator_id);
      if (!rx.rows || !ry.rows) return note("c3", message(rx.failed || ry.failed ? "failed" : "pending"), rx.failed || ry.failed ? "failed" : "pending");
      return scatterBlock(html, Plot, scatterModel({x, y, rowsX: rx.rows, rowsY: ry.rows, entities: inputs.entities, groups: inputs.groups, series: inputs.series, state: s, knownCutoff: inputs.knownCutoff}), {id: "c3", countryHref});
    },
    c4(s) {
      const indicator = indicatorOf(effective(s));
      if (!indicator) return html`<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_COMPARE_CHOOSE_INDICATOR}</p>`;
      const r = rowsOf(indicator.indicator_id);
      if (!r.rows) return note("c4", message(r.pending ? "pending" : "failed"), r.pending ? "pending" : "failed");
      const m = timeHeatmapModel({indicator, rows: r.rows, entities: inputs.entities, groups: inputs.groups, domains: inputs.domains, series: inputs.series, scorecards: inputs.scorecards, state: fixedIndicator === null ? s : {...s, d: null}, sort: sorts.c4, knownCutoff: inputs.knownCutoff});
      const sortControl = sortSelect(html, c4SortOptions(), m.sortId, (id) => {
        sorts.c4 = id;
        repaint("c4");
      }, "c4-sort");
      return timeHeatmapBlock(html, Plot, m, {id: "c4", countryHref, revisionsHref, sortControl});
    },
    t2(s) {
      const indicator = indicatorOf(effective(s));
      const domainId = indicator?.domain_ids?.[0];
      if (!indicator || !inputs.scorecards[domainId]) return "";
      const model = indicatorModel({indicator, domains: inputs.domains, scorecards: inputs.scorecards, entities: inputs.entities, series: inputs.series});
      const pg = peerGroups(inputs.groups, inputs.knownCutoff);
      return html`<div class="mm-compare-card" id="t2" data-card="t2"><h3>${DRAFT_COMPARE_CARD_TITLES.t2}: ${model.header.name}</h3>${resultsBlock(html, model, {group: s.g ?? "all", sort: "name", focus: null, reading: false}, pg, downloadHref, {percentile: s.pc === true})}</div>`;
    }
  };

  // C5: the percentile heatmap of the domain, secondary and closed, present only while pc is on.
  const secondary = (s) => {
    if (s.pc !== true) return "";
    const indicator = indicatorOf(effective(s));
    const domainId = s.d ?? indicator?.domain_ids?.[0] ?? null;
    const scorecard = inputs.scorecards[domainId];
    const domain = inputs.domains.find((d) => d.domain_id === domainId);
    if (!scorecard || !domain) return "";
    const view = cardView(scorecard, {entities: inputs.entities, groups: inputs.groups, indicators: inputs.indicators, domains: inputs.domains, state: {...s, c: []}});
    return html`<details class="mm-secondary" id="c5-secondary" data-card="c5"><summary>${DRAFT_COMPARE_SECONDARY(DRAFT_COMPARE_CARD_TITLES.c5)}</summary>${domainBlock(html, view, {card: true, orientation: false}) /* the page prints the one orientation sentence while pc is on */}</details>`;
  };

  const strip = (chart) => (store ? compareControls(html, chart, {store, data: {indicators: inputs.indicators, domains: inputs.domains, groups: inputs.groups, entities: inputs.entities.filter((e) => e.is_global !== true), bounds: inputs.bounds, periods: () => periodsFor(read())}, fixedIndicator: fixedIndicator !== null}) : "");
  // The stored common periods of C3 for the control (the model computes them; before both files are read there are none).
  const periodsFor = (s) => {
    const x = indicatorOf(s.x ?? effective(s));
    const y = indicatorOf(s.y ?? null);
    const rx = x ? loaded.get(x.indicator_id) : null;
    const ry = y ? loaded.get(y.indicator_id) : null;
    if (!x || !y || !rx || !ry) return [];
    const m = scatterModel({x, y, rowsX: rx, rowsY: ry, entities: inputs.entities, groups: inputs.groups, series: inputs.series, state: s});
    return (m.periods ?? []).map((p) => ({value: p.value, label: p.label}));
  };

  const s0 = read();
  const section = (chart) => html`<section class="mm-compare-section" data-slot="${chart}" aria-labelledby="h-${chart}"><h2 id="h-${chart}" class="mm-visually-hidden">${CARD_TITLES[chart]}</h2>${chart === "t2" || chart === "c6" ? "" : strip(chart)}<div data-slot="${chart}-body">${bodies[chart](s0)}</div></section>`;
  const root = html`<div class="mm-compare-page" data-fixed="${fixedIndicator ?? ""}">
${glyphSprite(html)}
<div class="mm-pc-notes" data-slot="pc-notes">${pcNotes(html, s0.pc === true)}</div>
${CARDS.map(section)}
<div data-slot="c5">${secondary(s0)}</div></div>`;
  if (typeof root?.addEventListener !== "function") return root;

  const body = (chart) => root.querySelector(`[data-slot="${chart}-body"]`);
  function repaint(chart = null, s = read()) {
    for (const c of CARDS) if (!chart || chart === c) body(c).replaceChildren(bodies[c](s));
    if (!chart) {
      root.querySelector('[data-slot="pc-notes"]').replaceChildren(pcNotes(html, s.pc === true));
      root.querySelector('[data-slot="c5"]').replaceChildren(secondary(s));
    }
    for (const f of root.querySelectorAll("form[data-chart-controls]")) f.refresh?.();
    if (started) flush();
  }
  function fetchSeries(id) {
    if (loaded.has(id) || failed.has(id) || loading.has(id)) return;
    if (!history || !hasHistory(history, id)) {
      failed.add(id);
      later();
      return;
    }
    loading.add(id);
    loadSeries(history.entries.get(id), history.files[id])
      .then((res) => (res.error ? failed.add(id) : loaded.set(id, res.rows)))
      .catch(() => failed.add(id))
      .finally(() => {
        loading.delete(id);
        later();
      });
  }
  function fetchGeo() {
    if (geoData !== null || geoFailed || geoLoading) return;
    geoLoading = true;
    Promise.all([docOf(geo.asset), docOf(geo.join)])
      .then(([asset, join]) => {
        geoData = {asset, join};
      })
      .catch(() => {
        geoFailed = true;
      })
      .finally(() => {
        geoLoading = false;
        later();
      });
  }
  function later() {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      repaint();
    }, 30);
  }
  function flush() {
    started = true;
    for (const id of [...want]) fetchSeries(id);
    want.clear();
    if (wantGeo) fetchGeo();
  }
  if (store) store.subscribe((s) => repaint(null, s));
  if (globalThis.document?.readyState === "complete") setTimeout(flush, 0);
  else globalThis.addEventListener?.("load", () => setTimeout(flush, 0), {once: true});
  return root;
}
