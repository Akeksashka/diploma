// PG-COUNTRY arrangement (Dashboard v2, ADR-037, plan V11 to V16). One band per domain in the stored order of meta/domains.json; in each band: K1 latest-value cards with their
// hidden-rows disclosure, L1 domain small multiples of lines (loaded on demand; the first two bands open), an expanded panel adds L2 (the long line of one indicator) and P1a (the
// strip plot of that indicator among countries), and T1 the latest-values table. The percentile layer (domain tile, percentile strip, percentile column and chip, orientation
// sentence) is present if and only if `pc` is on (ADR-037 decision 3; default off); the standing caveat is shown on every page, whatever pc is. Display only (D6): every number is a stored field formatted by the view modules.
// `live` = {store, inputs} makes the page react to the filter store: Domain shows only that band, Frequency narrows the table rows and the panels (stored frequency_set),
// Period clips the panels' x-domain and hides table rows with the A1.4 hidden-rows region, Group limits P1a. Without `live` the page is the unfiltered arrangement (the Country switcher
// sits above the bands; `v2.inputs` may still supply the inputs of L1 and P1a; `v2.percentile` stands for `pc`).
// inputs: {entity, entities, domains, scorecards, indicators, series, groups, knownCutoff, bounds}. history: historySource() (the manifest's series files and the page's lazy
// FileAttachments) or null: without it no series file is read and L1 shows the stated unreadable sentence for each panel.
import {CAVEAT, DRAFT_EMPTY_CARD, DRAFT_COUNTRY_CARD_TITLES, ORIENTATION_NOTE, PERCENTILE_COLUMN_LABEL} from "./copy.js";
import {applyFilter, COUNTRY_TABLE_HREFS, countryFilter, countrySwitcher, domainHref, domainTable, pcToggle} from "./country-view.js";
import {k1Model} from "./country-model.js";
import {loadSeries} from "./explorer.js";
import {glyphSprite} from "./glyphs.js";
import {attachHistory, hasHistory, historyKey} from "./history.js";
import {domainFigureCard, k1Block} from "./kpi-view.js";
import {l1Build, l1Card, l1Domain, l1Panels} from "./l1-card.js";
import {peerStripBlock, peerStripModel} from "./peer-strip.js";
import {profileFigure} from "./profile-chart.js";
import {l2Block} from "./series-chart.js";
import {l1Items, l1Reveal} from "./small-multiples.js";
import {hiddenRowsBlock, tableModel} from "./table-card.js";

// The table of one domain for one state: {kind, domain|text, hidden}. With `inputs` (live) the shared tableModel applies
// Frequency and Period; without them the domain's rows are shown as stored.
function tableFor(d, header, inputs, withoutValueHeading, state) {
  if (!inputs) return {kind: "table", entity: {id: header.entityId, name: header.name}, domain: {...d, withoutValueHeading}, hidden: []};
  const domain = inputs.domains.find((x) => x.domain_id === d.domainId);
  return tableModel({focusIds: [inputs.entity.entity_id], entities: [inputs.entity], domain, scorecard: inputs.scorecards[d.domainId], indicators: inputs.indicators, series: inputs.series, groups: inputs.groups, state});
}

function tableParts(html, d, header, inputs, withoutValueHeading, history, state, percentile) {
  const m = tableFor(d, header, inputs, withoutValueHeading, state);
  const status = hiddenRowsBlock(html, m, COUNTRY_TABLE_HREFS); // the persistent role="status" region of A1.4 (empty at N = 0)
  const body = m.kind === "table"
    ? domainTable(html, m.domain, header.name, header.entityId, history, COUNTRY_TABLE_HREFS, {percentile})
    : html`<p class="mm-state mm-state-empty" data-state="empty">${m.text}</p>`;
  return {status, body};
}

// The percentile layer of one band (pc on): the domain-figure tile and the percentile strip.
function pcLayerParts(html, Plot, d, header) {
  const tile = d.figure ? domainFigureCard(html, {...d.figure, domainId: d.domainId, name: d.name}, {span: 4, href: domainHref(d.domainId), carry: true}) : "";
  const fig = d.ranked ? profileFigure(html, Plot, d, header.name) : "";
  const strip = fig === "" ? "" : html`<div class="mm-card mm-card--span-8 mm-card--strip" data-card="strip"><h3>${PERCENTILE_COLUMN_LABEL}</h3>${fig}</div>`;
  return [tile, strip];
}

// C-CTRY-6 / AC-RD-62: the standing caveat is printed once per page, whatever pc is; the orientation sentence follows it whenever pc=1 (decided by the user 2026-11-13, even if no row has a stored percentile).
const pcNotes = (html, on) => html`<p class="mm-caveat">${CAVEAT}</p>${on ? html`<p class="mm-orientation">${ORIENTATION_NOTE}</p>` : ""}`;

// model: countryModel() result; options: switcherOptions(); history: historySource() or null; live: {store, inputs} or null; v2: {inputs, percentile, state} (without live).
export function countryPage(html, Plot, model, options, history = null, live = null, v2 = {}) {
  const h = model.header;
  const inputs = live?.inputs ?? v2.inputs ?? null;
  const read = () => (live ? live.store.get() : (v2.state ?? {}));
  const isPercentile = (s) => (live ? s.pc === true : v2.percentile === true);
  const state0 = read();
  const pc0 = isPercentile(state0);
  const loaded = new Map(); // indicator_id -> normalised series rows (a series file is read at most once)
  const failed = new Set();
  const loading = new Set();
  const want = new Set(); // indicators whose series an open L1 card waits for; read after the page has loaded (the series files are never part of the landing weight)
  let started = false;
  let timer = null;
  const ui = new Map(model.domains.map((d, i) => [d.domainId, {open: i < 2, expanded: null, shown: []}]));

  const k1Of = (d) => k1Block(html, k1Model(d), {domainId: d.domainId});
  const l1State = (d, s) => {
    const u = ui.get(d.domainId);
    const found = l1Items({domain: d, indicators: inputs.indicators, series: inputs.series, entityId: h.entityId, frequency: s.f ?? null});
    u.shown = l1Reveal(found.items, u.shown, false);
    return {u, found};
  };
  // L2 and P1a of the expanded panel; placed under the grid of the card.
  const detailOf = (d, s, build, key) => {
    const panel = l1Panels(build).find((p) => p.item.key === key);
    if (!panel) return null;
    const indicator = inputs.indicators.find((i) => i.indicator_id === panel.item.row.indicatorId) ?? null;
    const l2 = l2Block(html, Plot, panel.facet, {id: `l2-${d.domainId}`, revisionsHref: "../revisions", domain: l1Domain(s, inputs.bounds), indicator, rebaseControl: false}); // no rebase on PG-COUNTRY until CR-18 (the L1 panels and this L2 are not wired to `rb`)
    const strip = peerStripBlock(html, Plot, peerStripModel({indicator, scorecard: inputs.scorecards[d.domainId], domainRanked: d.ranked, entities: inputs.entities ?? [inputs.entity], groups: inputs.groups, series: inputs.series, focusId: h.entityId, groupId: s.g ?? null, includeOther: s.oth === true}), {id: `p1-${d.domainId}`, knownCutoff: inputs.knownCutoff});
    return [l2, strip];
  };
  const l1Of = (d, s) => {
    if (!inputs) return "";
    const {u, found} = l1State(d, s);
    const build = l1Build({items: found.items, none: found.none, loaded, failed, indicators: inputs.indicators, entity: inputs.entity, state: s, knownCutoff: inputs.knownCutoff, shown: u.shown});
    if (u.open) for (const item of build.pending) want.add(item.row.indicatorId);
    return l1Card(html, Plot, {domain: d, build, bounds: inputs.bounds, state: s, open: u.open, expandedKey: u.expanded, detail: u.expanded ? detailOf(d, s, build, u.expanded) : null});
  };
  const tableCard = (d, s, pc) => {
    const parts = tableParts(html, d, h, inputs, model.withoutValueHeading, history, s, pc);
    return html`<div class="mm-card mm-card--span-12 mm-card--table" data-table-card="${d.domainId}"><h3>${DRAFT_COUNTRY_CARD_TITLES.t1}: ${d.name}</h3>${parts.status}<div class="mm-country-controls">${countryFilter(html, d.domainId)}</div><div class="mm-country mm-table-body" data-filter="all">${parts.body}</div></div>`;
  };
  const section = (d, s, pc) => html`<section class="mm-dband mm-country-domain" id="domain-${d.domainId}" data-domain="${d.domainId}" aria-labelledby="h-${d.domainId}">
<div class="mm-band"><h2 id="h-${d.domainId}"><a href="${domainHref(d.domainId)}" data-link="domain" data-carry>${d.name}</a></h2></div>
${d.notices.map((n) => html`<p class="mm-notice">${n}</p>`)}
<div class="mm-grid"><div class="mm-slot mm-k1-slot" data-slot="k1">${k1Of(d)}</div><div class="mm-slot" data-slot="pc">${pc ? pcLayerParts(html, Plot, d, h) : ""}</div><div class="mm-slot" data-slot="l1">${l1Of(d, s)}</div>${tableCard(d, s, pc)}</div></section>`;

  const root = html`<div class="mm-country mm-country-page" data-entity="${h.entityId}">
${glyphSprite(html)}
${live ? "" : html`<div class="mm-country-controls">${countrySwitcher(html, options, h.entityId)}</div>`}
<div class="mm-country-controls" data-slot="percentile-control">${live ? pcToggle(html, live.store) : ""}</div>
<div class="mm-pc-notes" data-slot="pc-notes">${pcNotes(html, pc0)}</div>
${model.domains.map((d) => section(d, state0, pc0))}
<div class="mm-grid"><div class="mm-card mm-card--span-12" id="country-empty" hidden><p class="mm-state mm-state-empty" data-state="empty">${DRAFT_EMPTY_CARD}</p></div></div></div>`;
  if (typeof root?.addEventListener !== "function") return root;

  // One series file at most once per indicator; a finished load repaints the L1 cards that wait for it.
  function fetchSeries(indicatorId) {
    if (loaded.has(indicatorId) || failed.has(indicatorId) || loading.has(indicatorId)) return;
    if (!hasHistory(history, indicatorId)) {
      failed.add(indicatorId);
      later();
      return;
    }
    loading.add(indicatorId);
    loadSeries(history.entries.get(indicatorId), history.files[indicatorId])
      .then((res) => (res.error ? failed.add(indicatorId) : loaded.set(indicatorId, res.rows)))
      .catch(() => failed.add(indicatorId))
      .finally(() => {
        loading.delete(indicatorId);
        later();
      });
  }
  // Finished loads repaint the L1 cards once per burst, not once per file.
  function later() {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      repaintL1(read());
    }, 30);
  }
  function flush() {
    started = true;
    for (const id of [...want]) fetchSeries(id);
    want.clear();
  }
  function repaintL1(s, only = null) {
    if (!inputs) return;
    for (const sec of root.querySelectorAll("section[data-domain]")) {
      const d = model.domains.find((x) => x.domainId === sec.getAttribute("data-domain"));
      if (only && d.domainId !== only) continue;
      sec.querySelector('[data-slot="l1"]').replaceChildren(l1Of(d, s));
    }
    if (started) flush();
  }
  // Show all / only with a value: a control of each table card.
  root.addEventListener("change", (e) => {
    const card = e.target?.closest?.("[data-table-card]");
    if (card && String(e.target.name).startsWith("country-filter-")) applyFilter(card.querySelector(".mm-table-body"), e.target.value);
  });
  root.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-action]");
    const sec = btn?.closest?.("section[data-domain]");
    if (!btn || !sec || !inputs) return;
    const d = model.domains.find((x) => x.domainId === sec.getAttribute("data-domain"));
    const u = ui.get(d.domainId);
    if (btn.getAttribute("data-action") === "expand") {
      const key = btn.getAttribute("data-facet-key");
      u.expanded = u.expanded === key ? null : key;
    } else if (btn.getAttribute("data-action") === "more") {
      const found = l1Items({domain: d, indicators: inputs.indicators, series: inputs.series, entityId: h.entityId, frequency: read().f ?? null});
      u.shown = l1Reveal(found.items, u.shown, true);
    } else return;
    repaintL1(read(), d.domainId);
  });
  // `toggle` does not bubble: capture it to remember which L1 cards are open, and load the series of a card that has just been opened.
  root.addEventListener("toggle", (e) => {
    const det = e.target;
    if (!det?.matches?.("details.mm-l1")) return;
    const u = ui.get(det.getAttribute("data-domain"));
    if (!u || u.open === det.open) return;
    u.open = det.open;
    if (det.open) repaintL1(read(), det.getAttribute("data-domain"));
  }, true);
  if (history) {
    const rowsByKey = new Map(model.domains.flatMap((d) => d.withValue.map((r) => [historyKey(d.domainId, r.indicatorId), r])));
    attachHistory(root, {html, Plot, source: history, entityId: h.entityId, entityName: h.name, rowsByKey});
  }
  if (live) {
    const paint = (s) => {
      let any = false;
      const pc = isPercentile(s);
      root.querySelector('[data-slot="pc-notes"]').replaceChildren(pcNotes(html, pc));
      for (const sec of root.querySelectorAll("section[data-domain]")) {
        const d = model.domains.find((x) => x.domainId === sec.getAttribute("data-domain"));
        sec.hidden = Boolean(s.d) && s.d !== d.domainId;
        if (sec.hidden) continue;
        any = true;
        sec.querySelector('[data-slot="pc"]').replaceChildren(...(pc ? pcLayerParts(html, Plot, d, h) : []));
        const card = sec.querySelector("[data-table-card]");
        const parts = tableParts(html, d, h, inputs, model.withoutValueHeading, history, s, pc);
        card.querySelector(".mm-hidden-slot").replaceChildren(...parts.status.childNodes);
        const body = card.querySelector(".mm-table-body");
        body.replaceChildren(parts.body);
        applyFilter(body, card.querySelector("input[type=radio]:checked")?.value ?? "all");
        sec.querySelector('[data-slot="l1"]').replaceChildren(l1Of(d, s));
      }
      root.querySelector("#country-empty").hidden = any;
      if (started) flush();
    };
    paint(state0);
    live.store.subscribe(paint);
  }
  if (inputs && history) {
    if (globalThis.document?.readyState === "complete") setTimeout(flush, 0);
    else globalThis.addEventListener?.("load", () => setTimeout(flush, 0), {once: true});
  }
  return root;
}
