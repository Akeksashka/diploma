// Redesign R10: renders an indicatorModel() result (spec 4.3, C-IND-1 to C-IND-7, 5.1, 5.2). `html` (htl) and `Plot` are passed in; this
// file imports only local modules. Display only: nothing is computed here (D6). The peer-group control only filters and sorts rows
// (the V2 helpers of peers.js); the sort select orders by a stored field, nulls last, ties by name; every number printed is a stored
// field formatted by indicator-model.js. R16: pointer tip on the value chart; "Read a value" (the country in focus select) for the keyboard.
import {
  BIN_LABELS, DRAFT_DOWNLOAD, DRAFT_INDICATOR_COLUMNS as ICOL, DRAFT_INDICATOR_COLUMNS_MORE as MORE, DRAFT_INDICATOR_GROUP_LEGEND,
  DRAFT_INDICATOR_SERIES_LINK, DRAFT_INDICATOR_SORT_LABEL, DRAFT_INDICATOR_SORT_LABELS, DRAFT_INDICATOR_SWITCHER_GO, DRAFT_INDICATOR_SWITCHER_LABEL, DRAFT_LEGEND_BINS,
  DRAFT_NEXT_GROUP, DRAFT_OFFSET_FLAG, DRAFT_OPEN_AS_SERIES, DRAFT_PEER_FIGURE_LABEL, DRAFT_READER_NONE, DRAFT_SERIES_LINK_LABEL, DRAFT_TRANSFORMED_HEADER, DRAFT_VALUE_NEUTRAL_LEGEND, EMPTY_GROUP,
  FILTER_NOTE, FLAG_AHEAD, FLAG_INHERITED, FLAG_LAGGING, FLAG_UNALIGNED, NO_RANKING_SPREAD, PERCENTILE_COLUMN_LABEL
} from "./copy.js";
import {aboutDetails} from "./about-value.js";
import {chip, sourceCell, valueCell} from "./country-view.js";
import {chartFigure} from "./figure.js";
import {glyph, glyphSprite} from "./glyphs.js";
import {parseHash, serializeHash} from "./hash.js";
import {filterRows, groupMembers, groupOptions, spreadText} from "./peers.js";
import {installTipDismiss, pointReader} from "./point-reader.js";
import {peerChart, radioGroup, selectBox} from "./peers-view.js";
import {ariaSort, sortRows} from "./sort.js";
import {emptyBlock} from "./state-blocks.js";
import {STATES} from "./states.js";
import {readerText, valueTipLines} from "./tip.js";
import {valueFigure, valueRows} from "./value-chart.js";

const ALIGNMENT_TAGS = Object.freeze({ahead: FLAG_AHEAD, lagging: FLAG_LAGGING, unaligned: FLAG_UNALIGNED});

// Sort select (C-IND-1): option id -> the stored field of a row and the direction. Country is A-Z; the other three list the
// highest value, the highest stored percentile and the latest reference period first. Null values always come last.
export const SORTS = Object.freeze({
  name: Object.freeze({field: "name", dir: "asc"}),
  value: Object.freeze({field: "value", dir: "desc"}),
  percentile: Object.freeze({field: "percentile", dir: "desc"}),
  period: Object.freeze({field: "refPeriodEnd", dir: "desc"})
});
export const SORT_OPTIONS = Object.freeze(Object.keys(SORTS).map((id) => ({id, label: DRAFT_INDICATOR_SORT_LABELS[id]})));
export const DEFAULT_SORT = "name";
const MAX_SERIES_COUNTRIES = 5;
const BIN_IDS = Object.freeze([1, 2, 3, 4, 5]);

// Links of the page. From /indicator/<id> the explorer is ../explorer and a country page is ../country/<id>.
export const countryHref = (entityId) => `../country/${entityId}`;
export const seriesHref = (indicatorId, entityIds) => `../explorer${serializeHash({i: indicatorId, c: entityIds})}`;

// Switcher options: every indicator of the build, by name (a sort by the stored name, nothing else).
export const indicatorOptions = (indicators) => sortRows(indicators.map((i) => ({id: i.indicator_id, label: i.name ?? i.indicator_id})), "label", {nameKey: "label"});

// Peer-group data: option list and the member sets on the manifest's known cutoff (the V2 helpers; date logic only selects rows).
export function peerGroups(groups, knownCutoff) {
  return {options: groupOptions(groups), members: new Map(groups.map((g) => [g.group_id, groupMembers(g, knownCutoff)]))};
}

// Rows to show for a state {group, sort}: the filter keeps the rows of one group; the sort orders each of the two row groups.
export function viewRows(model, {group = "all", sort = DEFAULT_SORT} = {}, members = new Map()) {
  const s = SORTS[sort] ?? SORTS[DEFAULT_SORT];
  const order = (rows) => sortRows(filterRows(rows, group, members), s.field, {dir: s.dir});
  return {withValue: order(model.withValue), withoutValue: order(model.withoutValue), sort: s};
}

// C-IND-6: the country in focus, otherwise the first five by name (A-Z) among the rows shown that have a value, whatever the sort
// select says. Never a choice by percentile or value.
export function seriesCountries(rows, focus) {
  if (focus) return [focus];
  return sortRows(rows.filter((r) => r.hasValue), "name").slice(0, MAX_SERIES_COUNTRIES).map((r) => r.entityId);
}

// The state read from the address: `#c=<entity_id>` is the country in focus (only a country of this page), `#g=<group_id>` a peer group.
export function initialState(hash, entityIds, groupIds) {
  const h = parseHash(hash, {entities: new Set(entityIds), groups: new Set(groupIds)});
  return {focus: h.c[0] ?? null, group: h.g ?? "all", sort: DEFAULT_SORT, reading: false};
}

// The address for a state: #c= (the country in focus) and #g= (the group, omitted for "all"). Decisions record section 3 item 5.
export const stateHash = (state) => serializeHash({c: state.focus ? [state.focus] : [], g: state.group === "all" ? null : state.group});

// Reference-period line (C-IND-2): the stored figures, or the not-ranked wording when both are null.
export function referenceLineText(line) {
  if (!line.ranked) return NO_RANKING_SPREAD;
  return spreadText({spreadDays: line.spreadDays, rankReferencePeriod: line.commonPeriod, maxSpreadDays: line.maxRefSpreadDays, nRanked: line.nRanked, nUnaligned: line.nUnaligned});
}

// WCAG 3.2.2: choosing an option never navigates; the explicit Go button, or Enter on the select, does.
export function indicatorSwitcher(html, options, currentId) {
  const root = html`<label class="mm-country-switch">${DRAFT_INDICATOR_SWITCHER_LABEL} <select id="indicator-switcher">${options.map((o) => html`<option value="${o.id}" selected=${o.id === currentId}>${o.label}</option>`)}</select></label> <button type="button" id="indicator-switcher-go" class="mm-country-go">${DRAFT_INDICATOR_SWITCHER_GO}</button>`;
  if (typeof root?.querySelector === "function" && typeof location !== "undefined") {
    const go = () => location.assign(`./${root.querySelector("select").value}`);
    root.querySelector("#indicator-switcher-go").addEventListener("click", go);
    root.querySelector("select").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        go();
      }
    });
  }
  return root;
}

const headerCell = (html, label, field, sortState, cls = "") => {
  const attrs = field ? ariaSort(sortState, field) : null;
  return attrs === null ? html`<th scope="col" class="${cls}">${label}</th>` : html`<th scope="col" class="${cls}" aria-sort="${attrs}">${label}</th>`;
};

function countryCell(html, r) {
  return html`<th scope="row" class="mm-country" data-label="${ICOL.country}">${r.hasCountryPage ? html`<a href="${countryHref(r.entityId)}" data-link="country">${r.name}</a>` : r.name}</th>`;
}

function periodCell(html, r) {
  return html`<td data-label="${ICOL.period}">${r.periodText ?? r.refPeriodEnd ?? ""}</td>`;
}

function offsetCell(html, r) {
  return html`<td class="mm-num" data-label="${ICOL.offset}">${r.refOffsetDays ?? ""}</td>`;
}

function flagsCell(html, r) {
  const tag = ALIGNMENT_TAGS[r.alignment] ?? null;
  return html`<td data-label="${MORE.flags}">${r.offsetFlag ? html`<span class="mm-flag" data-flag="offset">${DRAFT_OFFSET_FLAG(r.refOffsetDays)}</span> ` : ""}${tag ? html`<span class="mm-flag" data-flag="alignment">${tag}</span> ` : ""}${r.inherited ? html`<span class="mm-flag" data-flag="inherited">${FLAG_INHERITED}</span>` : ""}</td>`;
}

// Transformed value (C-IND-5): only with its transform label; no unit exists for it yet (CR-6).
function transformedCell(html, r, label) {
  return html`<td class="mm-num" data-label="${DRAFT_TRANSFORMED_HEADER(label)}">${r.transformedText ?? ""}${r.transformedText === null ? "" : html` <span class="mm-unit">${r.transformLabel ?? label}</span>`}</td>`;
}

function valueRow(html, r, ctx) {
  const about = {...r, indicatorId: ctx.indicatorId, name: ctx.indicatorName};
  const id = `about-${ctx.indicatorId}-${r.entityId}`;
  return html`<tr role="row" data-entity="${r.entityId}" data-has-value="true" data-state="${r.state.key}" data-focus="${ctx.focus === r.entityId}">${countryCell(html, r)}${valueCell(html, r)}${periodCell(html, r)}${offsetCell(html, r)}${ctx.transformed ? transformedCell(html, r, ctx.transformLabel) : ""}${chip(html, r)}${flagsCell(html, r)}${sourceCell(html, r)}<td class="mm-actions" data-label="${MORE.actions}"><a href="${seriesHref(ctx.indicatorId, [r.entityId])}" data-link="series" aria-label="${DRAFT_SERIES_LINK_LABEL(ctx.indicatorName, r.name)}">${DRAFT_INDICATOR_SERIES_LINK}</a></td></tr><tr class="mm-sub-row" data-for-entity="${r.entityId}"><td colspan="${ctx.columns}">${aboutDetails(html, about, r.name, id)}</td></tr>`;
}

// A row without a value: the code, its signature and the one reason sentence of spec 5.1, in one cell that spans the other columns.
function reasonRow(html, r, ctx) {
  const st = r.state;
  const base = STATES[st.key];
  return html`<tr role="row" data-entity="${r.entityId}" data-has-value="false" data-state="${st.key}" data-focus="${ctx.focus === r.entityId}">${countryCell(html, r)}<td colspan="${ctx.reasonSpan}" class="mm-reason" data-label="${MORE.reason}" data-state="${st.key}" data-signature="${st.signature}"><span class="mm-cell">${base.glyph ? glyph(html, base.glyph) : ""}<span class="mm-code">${base.code ?? ""}</span></span> <span class="mm-sentence">${st.sentence}</span></td></tr>`;
}

export function indicatorTable(html, model, rows, sortState, focus) {
  const h = model.header;
  const transformed = rows.withValue.some((r) => r.transformedText !== null);
  const columns = transformed ? 9 : 8;
  const reasonSpan = transformed ? 8 : 7;
  const ctx = {indicatorId: h.indicatorId, indicatorName: h.name, focus, transformed, transformLabel: h.transformLabel ?? h.transformId, columns, reasonSpan};
  const head = html`<thead><tr>${headerCell(html, ICOL.country, "name", sortState)}${headerCell(html, ICOL.value, "value", sortState, "mm-num")}${headerCell(html, ICOL.period, "refPeriodEnd", sortState)}${headerCell(html, ICOL.offset, null, sortState, "mm-num")}${transformed ? headerCell(html, DRAFT_TRANSFORMED_HEADER(ctx.transformLabel), null, sortState, "mm-num") : ""}${headerCell(html, ICOL.percentile, "percentile", sortState, "mm-num")}${headerCell(html, MORE.flags, null, sortState)}${headerCell(html, MORE.source, null, sortState)}${headerCell(html, MORE.actions, null, sortState)}</tr></thead>`;
  const withGroup = rows.withValue.length === 0 ? "" : html`<tbody data-group="with-value">${rows.withValue.map((r) => valueRow(html, r, ctx))}</tbody>`;
  const withoutGroup = rows.withoutValue.length === 0 ? "" : html`<tbody data-group="without-value"><tr class="mm-group-row"><th scope="rowgroup" colspan="${columns}">${model.withoutValueHeading}</th></tr>${rows.withoutValue.map((r) => reasonRow(html, r, ctx))}</tbody>`;
  return html`<div class="mm-ind-scroll" tabindex="0" role="region" aria-label="${model.labels.caption}"><table class="mm-indicator-table" id="indicator-table"><caption>${model.labels.caption}</caption>${head}${withGroup}${withoutGroup}</table></div>`;
}

// Dot plot of the stored percentile (V2 chart, kept): rows whose table cell shows a percentile number. The V2 drawing function takes
// its own row shape.
export function dotRows(rows, focus) {
  return rows
    .filter((r) => r.percentile !== null && (r.state?.key === "ranked" || r.state?.key === "ahead"))
    .map((r) => ({entityId: r.entityId, name: r.name, valueText: r.valueText, valueNum: r.value, unit: r.unit, percentile: r.percentile, hollow: r.estimate || r.inherited}))
    .map((r) => ({...r, focus: r.entityId === focus}));
}

function dotFigure(html, Plot, model, rows, focus) {
  if (!model.domainRanked) return "";
  const dots = dotRows(rows, focus);
  const chart = peerChart(Plot, {percentileColumn: PERCENTILE_COLUMN_LABEL}, {rows: dots, focus});
  if (chart === null) return "";
  return chartFigure(html, {id: "indicator-dot-figure", label: DRAFT_PEER_FIGURE_LABEL(model.header.name, dots.length, PERCENTILE_COLUMN_LABEL), chart});
}

function binLegend(html) {
  return html`<div class="mm-legend mm-ind-legend" id="indicator-legend"><p class="mm-legend-head">${DRAFT_LEGEND_BINS}</p><ol class="mm-legend-bins">${BIN_LABELS.map((label, k) => html`<li data-bin="${BIN_IDS[k]}"><span class="mm-swatch" data-bin="${BIN_IDS[k]}"></span> ${label}</li>`)}<li data-bin="none"><span class="mm-swatch" data-bin="none"></span> ${DRAFT_VALUE_NEUTRAL_LEGEND}</li></ol></div>`;
}

// The part that follows the controls: links, charts, table. state: {group, sort, focus}.
// "Read a value" on this page (amendment 5.6 item 3): the country-in-focus select. Choosing a country calls hooks.onFocus(id | null);
// while focus is inside the fieldset the value chart shows a static tip for the country in focus. DOM only (not built under the
// htl stand-in of the unit tests).
function valueReader(html, Plot, bars, state, h, hooks, figureId) {
  const draw = (tipRow) => valueFigure(html, Plot, bars.map((b) => ({...b, focus: b.entityId === state.focus})), {name: h.name, unit: h.unit, id: figureId, tipRow});
  let current = draw(state.reading ? state.focus : null);
  let ready = false;
  if (current === "" || typeof current?.replaceWith !== "function") return {figure: current, reader: ""};
  installTipDismiss();
  const swap = (tipRow) => {
    const next = draw(tipRow);
    if (next === "" || !current.parentNode) return;
    current.replaceWith(next);
    current = next;
  };
  const entries = bars.map((b) => ({id: b.entityId, name: b.label, texts: [readerText(valueTipLines(b))], periods: []}));
  const inFocus = bars.some((b) => b.entityId === state.focus);
  const reader = pointReader(html, {
    id: "value-reader",
    entries,
    range: false,
    none: DRAFT_READER_NONE,
    value: inFocus ? state.focus : null,
    // Only the figure (outline and static tip), the table's focus marks and the output text change; the reader fieldset, its live
    // <output> and the keyboard focus are never rebuilt (so the new text is announced).
    onChange: (sel) => {
      hooks.onFocus(sel === null ? null : sel.entry.id);
      if (ready) swap(state.reading ? state.focus : null);
    },
    onActive: (active) => {
      if (state.reading === active) return;
      state.reading = active;
      swap(active ? state.focus : null);
    }
  });
  ready = true;
  if (!inFocus) reader.select.value = "";
  return {get figure() { return current; }, reader: reader.el};
}

export function resultsBlock(html, Plot, model, state, groups, downloadHref = null, hooks = {onFocus: () => {}}) {
  const rows = viewRows(model, state, groups.members);
  const shown = [...rows.withValue, ...rows.withoutValue];
  const h = model.header;
  const links = html`<p class="mm-ind-links"><a href="${seriesHref(h.indicatorId, seriesCountries(shown, state.focus))}" id="open-series" data-link="series-all">${DRAFT_OPEN_AS_SERIES}</a>${downloadHref ? html` <a href="${downloadHref}" download id="indicator-download" data-link="download">${DRAFT_DOWNLOAD}</a>` : ""}</p>`;
  if (shown.length === 0) return html`<div class="mm-ind-results" data-group="${state.group}" data-sort="${state.sort}">${links}${emptyBlock(html, {id: "empty-group", text: EMPTY_GROUP, next: DRAFT_NEXT_GROUP})}</div>`;
  const bars = valueRows(rows.withValue, state.focus);
  const {figure: barFigure, reader} = valueReader(html, Plot, bars, state, h, hooks, "value-figure");
  const legend = barFigure !== "" && bars.some((b) => b.bin !== null) ? binLegend(html) : "";
  return html`<div class="mm-ind-results" data-group="${state.group}" data-sort="${state.sort}">${links}${barFigure}${reader}${legend}${dotFigure(html, Plot, model, rows.withValue, state.focus)}${indicatorTable(html, model, rows, rows.sort, state.focus)}</div>`;
}

// opts: {options (indicatorOptions), groups (meta/groups.json list), knownCutoff, downloadHref}. The state lives in the controls and the
// address only; nothing is stored.
export function indicatorBlock(html, Plot, model, {options = [], groups = [], knownCutoff = null, downloadHref = null} = {}) {
  const h = model.header;
  const pg = peerGroups(groups, knownCutoff);
  const entityIds = model.rows.map((r) => r.entityId);
  const hash = typeof location !== "undefined" ? location.hash : "";
  const state = initialState(hash, entityIds, groups.map((g) => g.group_id));
  const groupBox = radioGroup(html, {id: "indicator-group", legend: DRAFT_INDICATOR_GROUP_LEGEND, options: pg.options, value: state.group});
  const sortBox = selectBox(html, {id: "indicator-sort", label: DRAFT_INDICATOR_SORT_LABEL, options: SORT_OPTIONS});
  const line = referenceLineText(model.referenceLine);
  // replaceState: no hashchange event, no history entry per click.
  const writeHash = () => {
    if (typeof location === "undefined" || typeof history === "undefined") return;
    const hash = stateHash(state);
    if (location.hash !== hash) history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`);
  };
  const hooks = {
    // The reader select is the country in focus: it outlines the bar, marks the table row and writes #c= (replaceState, no hashchange).
    onFocus: (id) => {
      if (id === state.focus) return;
      state.focus = id;
      state.reading = true;
      if (typeof location !== "undefined" && typeof history !== "undefined") {
        writeHash();
      }
      syncFocus();
    }
  };
  let refresh = () => {};
  // The country in focus changed (reader select): update the table's focus marks, the dot figure and the "open as series" link in
  // place. The value figure and the reader are handled by the reader itself (valueReader).
  const syncFocus = () => {
    if (typeof root?.querySelectorAll !== "function") return;
    for (const tr of root.querySelectorAll("tr[data-entity]")) tr.setAttribute("data-focus", String(tr.getAttribute("data-entity") === state.focus));
    const rows = viewRows(model, state, pg.members);
    const link = root.querySelector("#open-series");
    if (link) link.setAttribute("href", seriesHref(h.indicatorId, seriesCountries([...rows.withValue, ...rows.withoutValue], state.focus)));
    const dot = root.querySelector("#indicator-dot-figure");
    const next = dotFigure(html, Plot, model, rows.withValue, state.focus);
    if (dot && next !== "") dot.replaceWith(next);
  };
  const root = html`<div class="mm-indicator" data-indicator="${h.indicatorId}">
${glyphSprite(html)}
<div class="mm-ind-controls">${indicatorSwitcher(html, options, h.indicatorId)}${groupBox}${sortBox}</div>
<p class="mm-filter-note" id="filter-note">${FILTER_NOTE}</p>
<p class="mm-spread" id="reference-spread">${line}</p>
${resultsBlock(html, Plot, model, state, pg, downloadHref, hooks)}</div>`;
  if (typeof root?.addEventListener === "function") {
    refresh = () => root.querySelector(".mm-ind-results").replaceWith(resultsBlock(html, Plot, model, state, pg, downloadHref, hooks));
    groupBox.addEventListener("change", () => {
      state.group = groupBox.value;
      writeHash();
      refresh();
    });
    root.querySelector("#indicator-sort").addEventListener("change", (e) => {
      state.sort = e.target.value;
      refresh();
    });
    if (typeof addEventListener === "function") {
      addEventListener("hashchange", () => {
        const next = initialState(location.hash, entityIds, pg.options.map((o) => o.id));
        state.focus = next.focus;
        state.group = next.group;
        const radio = groupBox.querySelector(`input[value="${state.group}"]`);
        if (radio) radio.checked = true;
        refresh();
      });
    }
  }
  return root;
}
