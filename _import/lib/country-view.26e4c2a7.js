// Redesign R7: the C-CTRY-3 table builder and its cells (spec 4.2, 5.1); L22 moved the page arrangement to country-page.js. `html` (htl) and `Plot` are passed in; this
// file imports only local modules. Display only: nothing is computed here (D6). Every number printed is a stored field formatted
// by country-model.js; the filter only hides rows; the count of hidden rows is countHiddenRowsByReason over one hidden array (A1.4), shown by hidden-rows.js.
import {
  AHEAD_TAG, COMPARE_COUNTRIES, COMPARE_COUNTRIES_LABEL, INDICATOR_SERIES_LINK, SERIES_LINK_LABEL, DRAFT_COUNTRY_COLUMNS as COL, DRAFT_COUNTRY_FILTER_ALL, DRAFT_COUNTRY_FILTER_LEGEND,
  DRAFT_COUNTRY_FILTER_VALUE, DRAFT_COUNTRY_SWITCHER_GO, DRAFT_COUNTRY_SWITCHER_LABEL, DRAFT_COUNTRY_TABLE_CAPTION, DRAFT_OFFSET_FLAG, FLAG_AHEAD, FLAG_ESTIMATE, FLAG_LAGGING, FLAG_UNALIGNED,
  DRAFT_SHOW_PERCENTILE, DRAFT_STATE_COLUMN, DRAFT_UNIT_MISSING_SENTENCE, PERCENTILE_COLUMN_LABEL
} from "./copy.11b4a285.js";
import {carryHref} from "./carry.5a787523.js";
import {aboutDetails} from "./about-value.4bc9532a.js";
import {binLabel} from "./bins.04d14116.js";
import {glyph} from "./glyphs.a14b04e8.js";
import {serializeHash} from "./hash.54a4e297.js";
import {historyButton, historyKey, historyPanel} from "./history.0b12c899.js";
import {STATES} from "./states.465c23b4.js";

const ALIGNMENT_TAGS = Object.freeze({ahead: FLAG_AHEAD, lagging: FLAG_LAGGING, unaligned: FLAG_UNALIGNED});

// Links of one row (relative to /country/<id>): PG-INDICATOR, PG-DOMAIN, PG-SERIES (explorer). Hash parts use hash.js.
export const indicatorHref = (indicatorId, entityId) => `../indicator/${indicatorId}${serializeHash({c: [entityId]})}`;
export const domainHref = (domainId) => `../domain/${domainId}`;
export const seriesHref = (indicatorId, entityId) => `../explorer${serializeHash({i: indicatorId, c: [entityId]})}`;

// Switcher options: every country page of the build, in the given order (the page passes meta/entities.json minus the global entity).
// L17: the same table is mounted on PG-HOME (site root), where the page-relative links differ. The default is the country page's own set,
// so PG-COUNTRY output is unchanged byte for byte.
export const COUNTRY_TABLE_HREFS = Object.freeze({indicatorName: (indicatorId) => `../indicator/${indicatorId}`, indicator: indicatorHref, series: seriesHref});

export const switcherOptions = (entities) => entities.map((e) => ({id: e.entity_id, label: e.name ?? e.entity_id}));

// WCAG 3.2.2: choosing an option (arrow keys fire `change` in some browsers) never navigates; the explicit Go button, or Enter on the select, does.
export function countrySwitcher(html, options, currentId) {
  const root = html`<label class="mm-country-switch">${DRAFT_COUNTRY_SWITCHER_LABEL} <select id="country-switcher">${options.map((o) => html`<option value="${o.id}" selected=${o.id === currentId}>${o.label}</option>`)}</select></label> <button type="button" id="country-switcher-go" class="mm-country-go">${DRAFT_COUNTRY_SWITCHER_GO}</button>`;
  if (typeof root?.querySelector === "function" && typeof location !== "undefined") {
    const go = () => location.assign(carryHref(`./${root.querySelector("select").value}`, location.hash));
    root.querySelector("#country-switcher-go").addEventListener("click", go);
    root.querySelector("select").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        go();
      }
    });
  }
  return root;
}

export const FILTER_MODES = Object.freeze({all: DRAFT_COUNTRY_FILTER_ALL, value: DRAFT_COUNTRY_FILTER_VALUE});

// L22: one control per table card, so `suffix` (the domain id) keeps ids and radio group names unique on a page with several cards.
export function countryFilter(html, suffix = "") {
  const key = suffix ? `country-filter-${suffix}` : "country-filter";
  return html`<fieldset id="${key}" class="mm-radios"><legend>${DRAFT_COUNTRY_FILTER_LEGEND}</legend>${Object.entries(FILTER_MODES).map(
    ([id, label]) => html`<label class="mm-radio"><input type="radio" name="${key}" value="${id}" checked=${id === "all"}> <span>${label}</span></label>`
  )}</fieldset>`;
}

// The filter only hides the group of rows without a value (one tbody per section); it shows nothing about what it hid.
export function applyFilter(root, mode) {
  for (const tb of root.querySelectorAll('tbody[data-group="without-value"]')) tb.hidden = mode === "value";
  root.setAttribute("data-filter", mode);
}

export function valueCell(html, r) {
  const mark = r.estimate
    ? html`<span class="mm-mark" data-mark="estimate"><span class="mm-hollow" aria-hidden="true"></span><span aria-hidden="true">e</span><span class="mm-visually-hidden">${FLAG_ESTIMATE}</span></span>`
    : r.inherited
      ? html`<span class="mm-mark" data-mark="inherited"><span class="mm-hollow" aria-hidden="true"></span></span>`
      : "";
  return html`<td class="mm-num" data-label="${COL.value}"><span class="mm-fig">${r.valueText}</span>${mark === "" ? "" : html` ${mark}`} <span class="mm-unit">${r.unit || DRAFT_UNIT_MISSING_SENTENCE}</span></td>`;
}

function periodCell(html, r) {
  const tag = ALIGNMENT_TAGS[r.alignment] ?? null;
  return html`<td data-label="${COL.period}">${r.periodText ?? r.refPeriodEnd ?? ""}${r.offsetFlag ? html` <span class="mm-flag" data-flag="offset">${DRAFT_OFFSET_FLAG(r.refOffsetDays)}</span>` : ""}${tag ? html` <span class="mm-flag" data-flag="alignment">${tag}</span>` : ""}</td>`;
}

// Percentile chip: bin colour only for a ranked or ahead cell; every other state shows its code and glyph (AC-UX-2 signatures).
export function chip(html, r) {
  const st = r.state;
  const base = STATES[st.key];
  const coloured = st.key === "ranked" || st.key === "ahead";
  const inner = coloured
    ? html`<span class="mm-fig">${r.percentileText}</span>${st.key === "ahead" ? html`<span class="mm-tag">${AHEAD_TAG}</span>` : ""}<span class="mm-visually-hidden">${PERCENTILE_COLUMN_LABEL}, ${binLabel(r.bin) ?? ""}</span>`
    : html`${base.glyph ? glyph(html, base.glyph) : ""}${base.code ? html`<span class="mm-code">${base.code}</span>` : ""}`;
  return html`<td class="mm-pct" data-label="${COL.percentile}" data-state="${st.key}" data-signature="${st.signature}" data-bin="${coloured && r.bin !== null ? r.bin : "none"}"><span class="mm-cell">${inner}</span>${st.sentence ? html` <span class="mm-sentence">${st.sentence}</span>` : ""}</td>`;
}

// T1 without the percentile layer (V15, ADR-037 decision 3): the stored state of a value row that bears on its currency or alignment (stale, ahead, lagging, unaligned,
// inherited), as code, glyph and sentence. The cell keeps the data-state and data-signature of the row; rank-dependent states print nothing here.
const CURRENCY_STATES = Object.freeze(["stale", "ahead", "lagging", "unaligned", "inherited"]);
export function stateCell(html, r) {
  const st = r.state;
  const base = STATES[st.key];
  const shown = CURRENCY_STATES.includes(st.key);
  const inner = shown ? html`<span class="mm-cell">${base.glyph ? glyph(html, base.glyph) : ""}${base.code ? html`<span class="mm-code">${base.code}</span>` : ""}</span>${st.sentence ? html` <span class="mm-sentence">${st.sentence}</span>` : ""}` : "";
  return html`<td class="mm-state-cell" data-label="${DRAFT_STATE_COLUMN}" data-state="${st.key}" data-signature="${st.signature}">${inner}</td>`;
}

export function sourceCell(html, r) {
  return html`<td data-label="${COL.source}">${r.sourceName ? (r.sourceUrl ? html`<a href="${r.sourceUrl}" rel="noopener">${r.sourceName}</a>` : r.sourceName) : ""}</td>`;
}

function actionsCell(html, r, entityId, countryName, history = null, domainId = "", hrefs = COUNTRY_TABLE_HREFS) {
  return html`<td class="mm-actions" data-label="${COL.actions}">${history ? historyButton(html, history, domainId, r) : ""}<a href="${hrefs.indicator(r.indicatorId, entityId)}" data-link="indicator" aria-label="${COMPARE_COUNTRIES_LABEL(r.name)}">${COMPARE_COUNTRIES}</a> <a href="${hrefs.series(r.indicatorId, entityId)}" data-link="series" aria-label="${SERIES_LINK_LABEL(r.name, countryName)}">${INDICATOR_SERIES_LINK}</a></td>`;
}

function indicatorHead(html, r, hrefs = COUNTRY_TABLE_HREFS) {
  return html`<th scope="row" class="mm-ind"><a href="${hrefs.indicatorName(r.indicatorId)}" data-link="indicator-name" data-carry>${r.name}</a>${r.directionText ? html` <span class="mm-hm-dir">${r.directionText}</span>` : ""} <span class="mm-id">${r.indicatorId}</span></th>`;
}

// A value row is followed by one sub-row holding its "About this value" details and the (hidden) history panel; the sub-row has
// no data-indicator, so the one-row-per-indicator rule of the table is unchanged.
function valueRow(html, r, entityId, entityName, domainId, history, hrefs = COUNTRY_TABLE_HREFS, percentile = false) {
  const id = `about-${historyKey(domainId, r.indicatorId)}`;
  return html`<tr data-indicator="${r.indicatorId}" data-has-value="true" data-state="${r.state.key}">${indicatorHead(html, r, hrefs)}${valueCell(html, r)}${periodCell(html, r)}${percentile ? chip(html, r) : stateCell(html, r)}${sourceCell(html, r)}${actionsCell(html, r, entityId, entityName, history, domainId, hrefs)}</tr><tr class="mm-sub-row" data-for="${r.indicatorId}"><td colspan="6">${aboutDetails(html, r, entityName, id)}${history && historyButton(html, history, domainId, r) !== "" ? historyPanel(html, domainId, r) : ""}</td></tr>`;
}

// A row without a value: the code, its signature and the one reason sentence of spec 5.1, in one cell that spans the value columns.
function reasonRow(html, r, entityId, countryName, hrefs = COUNTRY_TABLE_HREFS) {
  const st = r.state;
  const base = STATES[st.key];
  return html`<tr data-indicator="${r.indicatorId}" data-has-value="false" data-state="${st.key}">${indicatorHead(html, r, hrefs)}<td colspan="4" class="mm-reason" data-label="${COL.reason}" data-state="${st.key}" data-signature="${st.signature}"><span class="mm-cell">${base.glyph ? glyph(html, base.glyph) : ""}<span class="mm-code">${base.code ?? ""}</span></span> <span class="mm-sentence">${st.sentence}</span></td>${actionsCell(html, r, entityId, countryName, null, "", hrefs)}</tr>`;
}

// `percentile` (V15, pc=1): the percentile column and bin chip; off by default, the column is then the stored state (T1).
export function domainTable(html, d, countryName, entityId, history = null, hrefs = COUNTRY_TABLE_HREFS, {percentile = false} = {}) {
  // The percentile column header is printed only if some row of the table holds a stored percentile; otherwise the column stays the stored state (decided 2026-11-13, D3).
  const pctHeader = percentile && [...d.withValue, ...d.withoutValue].some((r) => r.percentile !== null && r.percentile !== undefined);
  const head = html`<thead><tr><th scope="col">${COL.indicator}</th><th scope="col" class="mm-num">${COL.value}</th><th scope="col">${COL.period}</th><th scope="col">${pctHeader ? COL.percentile : DRAFT_STATE_COLUMN}</th><th scope="col">${COL.source}</th><th scope="col">${COL.actions}</th></tr></thead>`;
  const withGroup = d.withValue.length === 0 ? "" : html`<tbody data-group="with-value">${d.withValue.map((r) => valueRow(html, r, entityId, countryName, d.domainId, history, hrefs, percentile))}</tbody>`;
  const withoutGroup = d.withoutValue.length === 0 ? "" : html`<tbody data-group="without-value"><tr class="mm-group-row"><th scope="rowgroup" colspan="6">${d.withoutValueHeading}</th></tr>${d.withoutValue.map((r) => reasonRow(html, r, entityId, countryName, hrefs))}</tbody>`;
  return html`<div class="mm-ctry-scroll" tabindex="0" role="region" aria-label="${DRAFT_COUNTRY_TABLE_CAPTION(d.name, countryName)}"><table class="mm-country-table" id="table-${d.domainId}"><caption>${DRAFT_COUNTRY_TABLE_CAPTION(d.name, countryName)}</caption>${head}${withGroup}${withoutGroup}</table></div>`;
}

// V15 (AC-V2-25, 26; ADR-037 decision 3): the "Show percentile" control of the country page. A native checkbox that writes the hash key `pc` through the filter store.
export function pcToggle(html, store) {
  const root = html`<label class="mm-percentile-toggle"><input type="checkbox" id="show-percentile" checked=${Boolean(store?.get?.().pc)}> ${DRAFT_SHOW_PERCENTILE}</label>`;
  if (store && typeof root?.querySelector === "function") {
    const box = root.querySelector("input");
    box.addEventListener("change", () => store.set({pc: box.checked}));
    store.subscribe((s) => {
      box.checked = Boolean(s.pc);
    });
  }
  return root;
}
