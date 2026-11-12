// L22 (layout amendment 4.2, AC-DB-01/11/20/21): the PG-COUNTRY arrangement. One band per domain in the stored order of meta/domains.json; in each band a domain-figure
// tile (span 4, kpi-view.js), the dot strip (span 8, profile-chart.js) and a full-width table card (table-card.js model and the RD C-CTRY-3 table builder of
// country-view.js). No Trend column. Display only (D6): every number is a stored field formatted by country-model.js.
// `live` = {store, inputs} makes the page react to the filter store: Domain shows only that band, Frequency narrows the table rows (stored frequency_set),
// Period hides table rows with the ADR-036 disclosure (hidden rows are listed, the one count is countPeriodHiddenRows). Without `live` the page is the unfiltered
// arrangement and the Country switcher sits above the bands (the filter bar carries it when live).
import {DRAFT_EMPTY_CARD, PERCENTILE_COLUMN_LABEL} from "./copy.js";
import {applyFilter, COUNTRY_TABLE_HREFS, countryFilter, countrySwitcher, domainHref, domainTable} from "./country-view.js";
import {glyphSprite} from "./glyphs.js";
import {attachHistory, historyKey} from "./history.js";
import {domainFigureCard} from "./kpi-view.js";
import {profileFigure} from "./profile-chart.js";
import {hiddenRowsBlock, tableModel} from "./table-card.js";

// The table of one domain for one state: {kind, domain|text, hiddenSentence, hiddenRows}. With `inputs` (live) the shared tableModel applies
// Frequency and Period; without them the domain's rows are shown as stored.
function tableFor(d, header, inputs, withoutValueHeading, state) {
  if (!inputs) return {kind: "table", entity: {id: header.entityId, name: header.name}, domain: {...d, withoutValueHeading}, hiddenSentence: "", hiddenRows: []};
  const domain = inputs.domains.find((x) => x.domain_id === d.domainId);
  return tableModel({focusIds: [inputs.entity.entity_id], entities: [inputs.entity], domain, scorecard: inputs.scorecards[d.domainId], indicators: inputs.indicators, series: inputs.series, groups: inputs.groups, state});
}

function tableParts(html, d, header, inputs, withoutValueHeading, history, state) {
  const m = tableFor(d, header, inputs, withoutValueHeading, state);
  const status = m.hiddenSentence ? hiddenRowsBlock(html, m, COUNTRY_TABLE_HREFS) : "";
  const body = m.kind === "table"
    ? domainTable(html, m.domain, header.name, header.entityId, history)
    : html`<p class="mm-state mm-state-empty" data-state="empty">${m.text}</p>`;
  return {status, body};
}

function band(html, Plot, d, header, inputs, withoutValueHeading, history, state) {
  const tile = d.figure ? domainFigureCard(html, {...d.figure, domainId: d.domainId, name: d.name}, {span: 4, href: domainHref(d.domainId), carry: true}) : "";
  const fig = d.ranked ? profileFigure(html, Plot, d, header.name) : "";
  const strip = fig === "" ? "" : html`<div class="mm-card mm-card--span-8 mm-card--strip" data-card="strip"><h3>${PERCENTILE_COLUMN_LABEL}</h3>${fig}</div>`;
  const parts = tableParts(html, d, header, inputs, withoutValueHeading, history, state);
  const table = html`<div class="mm-card mm-card--span-12 mm-card--table" data-table-card="${d.domainId}"><h3>${d.name}</h3><div role="status" class="mm-hidden-slot">${parts.status}</div><div class="mm-country-controls">${countryFilter(html, d.domainId)}</div><div class="mm-country mm-table-body" data-filter="all">${parts.body}</div></div>`;
  return html`<section class="mm-dband mm-country-domain" id="domain-${d.domainId}" data-domain="${d.domainId}" aria-labelledby="h-${d.domainId}">
<div class="mm-band"><h2 id="h-${d.domainId}"><a href="${domainHref(d.domainId)}" data-link="domain" data-carry>${d.name}</a></h2></div>
${d.notices.map((n) => html`<p class="mm-notice">${n}</p>`)}
<div class="mm-grid">${tile}${strip}${table}</div></section>`;
}

// model: countryModel() result; options: switcherOptions(); history: historySource() or null; live: {store, inputs} or null.
// inputs: {entity, domains, scorecards, indicators, series, groups} (the countryModel() inputs).
export function countryPage(html, Plot, model, options, history = null, live = null) {
  const h = model.header;
  const inputs = live?.inputs ?? null;
  const state = live ? live.store.get() : {};
  const root = html`<div class="mm-country mm-country-page" data-entity="${h.entityId}">
${glyphSprite(html)}
${live ? "" : html`<div class="mm-country-controls">${countrySwitcher(html, options, h.entityId)}</div>`}
${model.domains.map((d) => band(html, Plot, d, h, inputs, model.withoutValueHeading, history, state))}
<div class="mm-grid"><div class="mm-card mm-card--span-12" id="country-empty" hidden><p class="mm-state mm-state-empty" data-state="empty">${DRAFT_EMPTY_CARD}</p></div></div></div>`;
  if (typeof root?.addEventListener !== "function") return root;
  // Show all / only with a value: a control of each table card.
  root.addEventListener("change", (e) => {
    const card = e.target?.closest?.("[data-table-card]");
    if (card && String(e.target.name).startsWith("country-filter-")) applyFilter(card.querySelector(".mm-table-body"), e.target.value);
  });
  if (history) {
    const rowsByKey = new Map(model.domains.flatMap((d) => d.withValue.map((r) => [historyKey(d.domainId, r.indicatorId), r])));
    attachHistory(root, {html, Plot, source: history, entityId: h.entityId, entityName: h.name, rowsByKey});
  }
  if (live) {
    const paint = (s) => {
      let any = false;
      for (const sec of root.querySelectorAll("section[data-domain]")) {
        const d = model.domains.find((x) => x.domainId === sec.getAttribute("data-domain"));
        sec.hidden = Boolean(s.d) && s.d !== d.domainId;
        if (sec.hidden) continue;
        any = true;
        const card = sec.querySelector("[data-table-card]");
        const parts = tableParts(html, d, h, inputs, model.withoutValueHeading, history, s);
        card.querySelector(".mm-hidden-slot").replaceChildren(parts.status);
        const body = card.querySelector(".mm-table-body");
        body.replaceChildren(parts.body);
        applyFilter(body, card.querySelector("input[type=radio]:checked")?.value ?? "all");
      }
      root.querySelector("#country-empty").hidden = any;
    };
    paint(state);
    live.store.subscribe(paint);
  }
  return root;
}
