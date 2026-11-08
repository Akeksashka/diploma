// Redesign R7: renders a countryModel() result (spec 4.2, C-CTRY-1 to C-CTRY-5, 5.1). `html` (htl) and `Plot` are passed in; this
// file imports only local modules. Display only: nothing is computed here (D6). Every number printed is a stored field formatted
// by country-model.js; the filter only hides rows; no count of hidden rows exists anywhere on the page.
import {
  AGGREGATE_NOT_RANKED, AHEAD_TAG, DRAFT_COMPARE_COUNTRIES, DRAFT_COMPARE_COUNTRIES_LABEL, DRAFT_INDICATOR_SERIES_LINK, DRAFT_SERIES_LINK_LABEL, DRAFT_COUNTRY_COLUMNS as COL, DRAFT_COUNTRY_FILTER_ALL, DRAFT_COUNTRY_FILTER_LEGEND,
  DRAFT_COUNTRY_FILTER_VALUE, DRAFT_COUNTRY_SWITCHER_GO, DRAFT_COUNTRY_SWITCHER_LABEL, DRAFT_COUNTRY_TABLE_CAPTION, DRAFT_OFFSET_FLAG, FLAG_AHEAD, FLAG_ESTIMATE, FLAG_LAGGING, FLAG_LOW_COVERAGE, FLAG_UNALIGNED,
  DRAFT_UNIT_MISSING_SENTENCE, NA, NO_POSITION_LOW_COVERAGE, PERCENTILE_COLUMN_LABEL
} from "./copy.js";
import {aboutDetails} from "./about-value.js";
import {binLabel} from "./bins.js";
import {glyph, glyphSprite} from "./glyphs.js";
import {serializeHash} from "./hash.js";
import {attachHistory, historyButton, historyKey, historyPanel} from "./history.js";
import {profileFigure} from "./profile-chart.js";
import {STATES} from "./states.js";

const ALIGNMENT_TAGS = Object.freeze({ahead: FLAG_AHEAD, lagging: FLAG_LAGGING, unaligned: FLAG_UNALIGNED});

// Links of one row (relative to /country/<id>): PG-INDICATOR, PG-DOMAIN, PG-SERIES (explorer). Hash parts use hash.js.
export const indicatorHref = (indicatorId, entityId) => `../indicator/${indicatorId}${serializeHash({c: [entityId]})}`;
export const domainHref = (domainId) => `../domain/${domainId}`;
export const seriesHref = (indicatorId, entityId) => `../explorer${serializeHash({i: indicatorId, c: [entityId]})}`;

// Switcher options: every country page of the build, in the given order (the page passes meta/entities.json minus the global entity).
export const switcherOptions = (entities) => entities.map((e) => ({id: e.entity_id, label: e.name ?? e.entity_id}));

// WCAG 3.2.2: choosing an option (arrow keys fire `change` in some browsers) never navigates; the explicit Go button, or Enter on the select, does.
export function countrySwitcher(html, options, currentId) {
  const root = html`<label class="mm-country-switch">${DRAFT_COUNTRY_SWITCHER_LABEL} <select id="country-switcher">${options.map((o) => html`<option value="${o.id}" selected=${o.id === currentId}>${o.label}</option>`)}</select></label> <button type="button" id="country-switcher-go" class="mm-country-go">${DRAFT_COUNTRY_SWITCHER_GO}</button>`;
  if (typeof root?.querySelector === "function" && typeof location !== "undefined") {
    const go = () => location.assign(`./${root.querySelector("select").value}`);
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

export function countryFilter(html) {
  return html`<fieldset id="country-filter" class="mm-radios"><legend>${DRAFT_COUNTRY_FILTER_LEGEND}</legend>${Object.entries(FILTER_MODES).map(
    ([id, label]) => html`<label class="mm-radio"><input type="radio" name="country-filter" value="${id}" checked=${id === "all"}> <span>${label}</span></label>`
  )}</fieldset>`;
}

// The filter only hides the group of rows without a value (one tbody per section); it shows nothing about what it hid.
export function applyFilter(root, mode) {
  for (const tb of root.querySelectorAll('tbody[data-group="without-value"]')) tb.hidden = mode === "value";
  root.setAttribute("data-filter", mode);
}

// Domain figure line (C-CTRY-1): ranked domains only. Label, percentile, "n of N", position, all as stored.
function figureLine(html, fig) {
  const st = fig.state;
  const g = STATES[st.key].glyph;
  let body;
  if (st.key === "aggregate") body = html`<span class="mm-code">${AGGREGATE_NOT_RANKED}</span>`;
  else if (st.key === "na") body = html`${glyph(html, g)}<span class="mm-code">${NA}</span> <span class="mm-sentence">${st.sentence}</span>`;
  else {
    const position = fig.lowCoverage ? html`<span class="mm-flag">${FLAG_LOW_COVERAGE}</span> ${NO_POSITION_LOW_COVERAGE}` : fig.positionText ?? "";
    body = html`<span class="mm-fig">${fig.percentileText}</span>${fig.coverageText ? ", " : ""}${fig.coverageText ?? ""}${fig.coverageText && position ? "; " : ""}${position}`;
  }
  return html`<p class="mm-figure-line" data-state="${st.key}" data-signature="${st.signature}"><span class="mm-figure-label">${fig.label ?? ""}</span>: ${body}</p>`;
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

export function sourceCell(html, r) {
  return html`<td data-label="${COL.source}">${r.sourceName ? (r.sourceUrl ? html`<a href="${r.sourceUrl}" rel="noopener">${r.sourceName}</a>` : r.sourceName) : ""}</td>`;
}

function actionsCell(html, r, entityId, countryName, history = null, domainId = "") {
  return html`<td class="mm-actions" data-label="${COL.actions}">${history ? historyButton(html, history, domainId, r) : ""}<a href="${indicatorHref(r.indicatorId, entityId)}" data-link="indicator" aria-label="${DRAFT_COMPARE_COUNTRIES_LABEL(r.name)}">${DRAFT_COMPARE_COUNTRIES}</a> <a href="${seriesHref(r.indicatorId, entityId)}" data-link="series" aria-label="${DRAFT_SERIES_LINK_LABEL(r.name, countryName)}">${DRAFT_INDICATOR_SERIES_LINK}</a></td>`;
}

function indicatorHead(html, r) {
  return html`<th scope="row" class="mm-ind"><a href="../indicator/${r.indicatorId}" data-link="indicator-name">${r.name}</a>${r.directionText ? html` <span class="mm-hm-dir">${r.directionText}</span>` : ""} <span class="mm-id">${r.indicatorId}</span></th>`;
}

// A value row is followed by one sub-row holding its "About this value" details and the (hidden) history panel; the sub-row has
// no data-indicator, so the one-row-per-indicator rule of the table is unchanged.
function valueRow(html, r, entityId, entityName, domainId, history) {
  const id = `about-${historyKey(domainId, r.indicatorId)}`;
  return html`<tr data-indicator="${r.indicatorId}" data-has-value="true" data-state="${r.state.key}">${indicatorHead(html, r)}${valueCell(html, r)}${periodCell(html, r)}${chip(html, r)}${sourceCell(html, r)}${actionsCell(html, r, entityId, entityName, history, domainId)}</tr><tr class="mm-sub-row" data-for="${r.indicatorId}"><td colspan="6">${aboutDetails(html, r, entityName, id)}${history && historyButton(html, history, domainId, r) !== "" ? historyPanel(html, domainId, r) : ""}</td></tr>`;
}

// A row without a value: the code, its signature and the one reason sentence of spec 5.1, in one cell that spans the value columns.
function reasonRow(html, r, entityId, countryName) {
  const st = r.state;
  const base = STATES[st.key];
  return html`<tr data-indicator="${r.indicatorId}" data-has-value="false" data-state="${st.key}">${indicatorHead(html, r)}<td colspan="4" class="mm-reason" data-label="${COL.reason}" data-state="${st.key}" data-signature="${st.signature}"><span class="mm-cell">${base.glyph ? glyph(html, base.glyph) : ""}<span class="mm-code">${base.code ?? ""}</span></span> <span class="mm-sentence">${st.sentence}</span></td>${actionsCell(html, r, entityId, countryName)}</tr>`;
}

export function domainTable(html, d, countryName, entityId, history = null) {
  const head = html`<thead><tr><th scope="col">${COL.indicator}</th><th scope="col" class="mm-num">${COL.value}</th><th scope="col">${COL.period}</th><th scope="col">${COL.percentile}</th><th scope="col">${COL.source}</th><th scope="col">${COL.actions}</th></tr></thead>`;
  const withGroup = d.withValue.length === 0 ? "" : html`<tbody data-group="with-value">${d.withValue.map((r) => valueRow(html, r, entityId, countryName, d.domainId, history))}</tbody>`;
  const withoutGroup = d.withoutValue.length === 0 ? "" : html`<tbody data-group="without-value"><tr class="mm-group-row"><th scope="rowgroup" colspan="6">${d.withoutValueHeading}</th></tr>${d.withoutValue.map((r) => reasonRow(html, r, entityId, countryName))}</tbody>`;
  return html`<div class="mm-ctry-scroll" tabindex="0" role="region" aria-label="${DRAFT_COUNTRY_TABLE_CAPTION(d.name, countryName)}"><table class="mm-country-table" id="table-${d.domainId}"><caption>${DRAFT_COUNTRY_TABLE_CAPTION(d.name, countryName)}</caption>${head}${withGroup}${withoutGroup}</table></div>`;
}

export function domainSection(html, Plot, d, header, withoutValueHeading, history = null) {
  const section = {...d, withoutValueHeading};
  return html`<section class="mm-country-domain" id="domain-${d.domainId}" data-domain="${d.domainId}" aria-labelledby="h-${d.domainId}">
<h2 id="h-${d.domainId}"><a href="${domainHref(d.domainId)}" data-link="domain">${d.name}</a></h2>
${d.notices.map((n) => html`<p class="mm-notice">${n}</p>`)}
${d.figure ? figureLine(html, d.figure) : ""}
${d.ranked ? profileFigure(html, Plot, d, header.name) : ""}
${domainTable(html, section, header.name, header.entityId, history)}</section>`;
}

// model: countryModel() result; options: switcherOptions(); the filter and the switcher sit above the sections.
// history: historySource(manifest, files) or null (no "Show history" buttons).
export function countryBlock(html, Plot, model, options, history = null) {
  const h = model.header;
  const root = html`<div class="mm-country" data-filter="all" data-entity="${h.entityId}">
${glyphSprite(html)}
<div class="mm-country-controls">${countrySwitcher(html, options, h.entityId)}${countryFilter(html)}</div>
${model.domains.map((d) => domainSection(html, Plot, d, h, model.withoutValueHeading, history))}</div>`;
  if (typeof root?.addEventListener === "function") {
    root.querySelector("#country-filter").addEventListener("change", (e) => applyFilter(root, e.target.value));
    if (history) {
      const rowsByKey = new Map(model.domains.flatMap((d) => d.withValue.map((r) => [historyKey(d.domainId, r.indicatorId), r])));
      attachHistory(root, {html, Plot, source: history, entityId: h.entityId, entityName: h.name, rowsByKey});
    }
  }
  return root;
}
