// Redesign R10: renders an indicatorModel() result (spec 4.3, C-IND-1 to C-IND-7, 5.1, 5.2). `html` (htl) and `Plot` are passed in; this
// file imports only local modules. Display only: nothing is computed here (D6). The peer-group control only filters and sorts rows
// (the V2 helpers of peers.js); the sort select orders by a stored field, nulls last, ties by name; every number printed is a stored
// field formatted by indicator-model.js. R16: pointer tip on the value chart; "Read a value" (the country in focus select) for the keyboard.
import {
  BIN_LABELS, DRAFT_BAND_TABLE, DRAFT_BAND_TITLES, DRAFT_DOWNLOAD, DRAFT_EMPTY_CARD, DRAFT_INDICATOR_COLUMNS as ICOL, DRAFT_INDICATOR_COLUMNS_MORE as MORE,
  INDICATOR_SERIES_LINK, DRAFT_LEGEND_BINS,
  DRAFT_NEXT_GROUP, DRAFT_OFFSET_FLAG, DRAFT_OPEN_AS_SERIES, DRAFT_PEER_FIGURE_LABEL, SERIES_LINK_LABEL, DRAFT_TRANSFORMED_HEADER, DRAFT_VALUE_NEUTRAL_LEGEND, EMPTY_GROUP,
  FILTER_NOTE, FLAG_AHEAD, FLAG_INHERITED, FLAG_LAGGING, FLAG_UNALIGNED, NO_RANKING_SPREAD, PERCENTILE_COLUMN_LABEL
} from "./copy.js";
import {aboutDetails} from "./about-value.js";
import {chip, sourceCell, valueCell} from "./country-view.js";
import {chartFigure} from "./figure.js";
import {glyph, glyphSprite} from "./glyphs.js";
import {serializeHash} from "./hash.js";
import {filterRows, groupMembers, groupOptions, spreadText} from "./peers.js";
import {peerChart} from "./peers-view.js";
import {INDICATOR_SORT_OPTIONS} from "./rank-model.js";
import {mountRankCard} from "./rank-view.js";
import {ariaSort, sortRows} from "./sort.js";
import {emptyBlock} from "./state-blocks.js";
import {STATES} from "./states.js";

const ALIGNMENT_TAGS = Object.freeze({ahead: FLAG_AHEAD, lagging: FLAG_LAGGING, unaligned: FLAG_UNALIGNED});

// Sort select (C-IND-1): option id -> the stored field of a row and the direction. Country is A-Z; the other three list the
// highest value, the highest stored percentile and the latest reference period first. Null values always come last.
export const SORTS = Object.freeze({
  name: Object.freeze({field: "name", dir: "asc"}),
  value: Object.freeze({field: "value", dir: "desc"}),
  percentile: Object.freeze({field: "percentile", dir: "desc"}),
  period: Object.freeze({field: "refPeriodEnd", dir: "desc"})
});
export const DEFAULT_SORT = "name";
const MAX_SERIES_COUNTRIES = 5;
const BIN_IDS = Object.freeze([1, 2, 3, 4, 5]);

// Links of the page. From /indicator/<id> the explorer is ../explorer and a country page is ../country/<id>.
export const countryHref = (entityId) => `../country/${entityId}`;
export const seriesHref = (indicatorId, entityIds) => `../explorer${serializeHash({i: indicatorId, c: entityIds})}`;

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

// Reference-period line (C-IND-2): the stored figures, or the not-ranked wording when both are null.
export function referenceLineText(line) {
  if (!line.ranked) return NO_RANKING_SPREAD;
  return spreadText({spreadDays: line.spreadDays, rankReferencePeriod: line.commonPeriod, maxSpreadDays: line.maxRefSpreadDays, nRanked: line.nRanked, nUnaligned: line.nUnaligned});
}

const headerCell = (html, label, field, sortState, cls = "") => {
  const attrs = field ? ariaSort(sortState, field) : null;
  return attrs === null ? html`<th scope="col" class="${cls}">${label}</th>` : html`<th scope="col" class="${cls}" aria-sort="${attrs}">${label}</th>`;
};

function countryCell(html, r) {
  return html`<th scope="row" class="mm-country" data-label="${ICOL.country}">${r.hasCountryPage ? html`<a href="${countryHref(r.entityId)}" data-link="country" data-carry>${r.name}</a>` : r.name}</th>`;
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
  return html`<tr role="row" data-entity="${r.entityId}" data-has-value="true" data-state="${r.state.key}" data-focus="${ctx.focus === r.entityId}">${countryCell(html, r)}${valueCell(html, r)}${periodCell(html, r)}${offsetCell(html, r)}${ctx.transformed ? transformedCell(html, r, ctx.transformLabel) : ""}${chip(html, r)}${flagsCell(html, r)}${sourceCell(html, r)}<td class="mm-actions" data-label="${MORE.actions}"><a href="${seriesHref(ctx.indicatorId, [r.entityId])}" data-link="series" aria-label="${SERIES_LINK_LABEL(ctx.indicatorName, r.name)}">${INDICATOR_SERIES_LINK}</a></td></tr><tr class="mm-sub-row" data-for-entity="${r.entityId}"><td colspan="${ctx.columns}">${aboutDetails(html, about, r.name, id)}</td></tr>`;
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

// Rows the Table band and the dot plot show for a state {group, sort, focus}.
// L23 (layout amendment 4.3): the page is a header card, a "Compare" band (the C-RANK card of rank-view.js with the dot plot beside it) and a "Table" band.
const emptyCard = (html, id) => html`<p class="mm-state mm-state-empty" id="${id}" data-state="empty">${DRAFT_EMPTY_CARD}</p>`;

// The dot plot card body (C-IND-4) and, when any bar has a percentile bin, the bin legend. "" parts are left out; a card with no dot has the empty sentence.
export function dotCardBody(html, Plot, model, rows, focus) {
  const dot = dotFigure(html, Plot, model, rows.withValue, focus);
  const legend = rows.withValue.some((r) => r.bin !== null) ? binLegend(html) : "";
  return html`<div class="mm-ind-dot" id="indicator-dot-body">${dot === "" ? emptyCard(html, "indicator-dot-empty") : dot}${legend}</div>`;
}

// The Table band card body: the links (C-IND-6, C-IND-7) and the all-country table (C-IND-5) or the empty state of a group with no members.
export function resultsBlock(html, model, state, groups, downloadHref = null) {
  const rows = viewRows(model, state, groups.members);
  const shown = [...rows.withValue, ...rows.withoutValue];
  const h = model.header;
  const links = html`<p class="mm-ind-links"><a href="${seriesHref(h.indicatorId, seriesCountries(shown, state.focus))}" id="open-series" data-link="series-all">${DRAFT_OPEN_AS_SERIES}</a>${downloadHref ? html` <a href="${downloadHref}" download id="indicator-download" data-link="download">${DRAFT_DOWNLOAD}</a>` : ""}</p>`;
  if (shown.length === 0) return html`<div class="mm-ind-results" data-group="${state.group}" data-sort="${state.sort}">${links}${emptyBlock(html, {id: "empty-group", text: EMPTY_GROUP, next: DRAFT_NEXT_GROUP})}</div>`;
  return html`<div class="mm-ind-results" data-group="${state.group}" data-sort="${state.sort}">${links}${indicatorTable(html, model, rows, rows.sort, state.focus)}</div>`;
}

// The page links of the C-RANK card, one level down from the site root.
export const INDICATOR_LINKS = Object.freeze({country: countryHref, series: (indicatorId, entityId) => seriesHref(indicatorId, [entityId])});

// The state of the page, read from the filter store: Group (`g`, "all" when unset), the country in focus (`c`, only a country of this page) and the
// sort, which lives in the C-RANK card header and is not in the address.
export function pageState(storeState, entityIds, sort = DEFAULT_SORT) {
  const c = storeState.c?.[0] ?? null;
  return {group: storeState.g ?? "all", focus: c !== null && entityIds.includes(c) ? c : null, sort, reading: false};
}

// The adapter that lets mountRankCard run on this page: the two slots it needs, and a context built from the store and the loaded scorecard.
// `quiet()` marks the next store change as caused by the card itself (the reader's country), so the card is not rebuilt under the user's keyboard.
function compareHost(store, {indicatorId, domainId, scorecard, slots}) {
  const subs = new Set();
  let quiet = false;
  const context = () => ({state: store.get(), domainId, indicatorId, scorecard, error: null, loading: false});
  store.subscribe(() => {
    if (quiet) return;
    for (const fn of [...subs]) fn(context());
  });
  return {
    slots,
    quiet: (fn) => {
      quiet = true;
      try {
        fn();
      } finally {
        quiet = false;
      }
    },
    fill(slot, ...nodes) {
      slot.replaceChildren(...nodes);
      slot.setAttribute("aria-busy", "false");
    },
    busy(slot) {
      slot.setAttribute("aria-busy", "true");
    },
    onChange(fn) {
      subs.add(fn);
      fn(context());
      return () => subs.delete(fn);
    }
  };
}

// opts: {groups (meta/groups.json list), knownCutoff, downloadHref, store (the filter store; Group and the country in focus come from it),
// meta ({entities, indicators, domains, groups} lists), series (meta/series.json list), scorecard (the first domain's scorecard), domainId, Plot}.
// The state lives in the controls, the card header and the address only; nothing is stored.
export function indicatorBlock(html, Plot, model, {groups = [], knownCutoff = null, downloadHref = null, store, meta = null, series = [], scorecard = null, domainId = null} = {}) {
  const h = model.header;
  const pg = peerGroups(groups, knownCutoff);
  const entityIds = model.rows.map((r) => r.entityId);
  let sort = DEFAULT_SORT;
  const view = () => pageState(store.get(), entityIds, sort);
  const line = referenceLineText(model.referenceLine);
  const s0 = view();
  const rows0 = viewRows(model, s0, pg.members);
  const ranked = model.domainRanked;
  const B = DRAFT_BAND_TITLES;
  const root = html`<div class="mm-indicator" data-indicator="${h.indicatorId}">
${glyphSprite(html)}
<p class="mm-filter-note" id="filter-note">${FILTER_NOTE}</p>
<p class="mm-spread" id="reference-spread">${line}</p>
<section class="mm-dband" id="band-compare" aria-labelledby="band-compare-heading"><div class="mm-band"><h2 id="band-compare-heading">${B.compare}</h2></div><div class="mm-grid"><div class="mm-card mm-card--slot mm-card--rank mm-card--span-${ranked ? 8 : 12}" id="indicator-compare" data-slot="compare" aria-busy="true"></div>${ranked ? html`<div class="mm-card mm-card--span-4 mm-card--dot" id="indicator-dot-card"><h3>${PERCENTILE_COLUMN_LABEL}</h3>${dotCardBody(html, Plot, model, rows0, s0.focus)}</div>` : ""}</div></section>
<section class="mm-dband" id="band-table" aria-labelledby="band-table-heading"><div class="mm-band"><h2 id="band-table-heading">${DRAFT_BAND_TABLE}</h2></div><div class="mm-grid"><div class="mm-card mm-card--table mm-card--span-12" id="indicator-table-card"><h3>${model.labels.caption}</h3><div id="indicator-table-body">${resultsBlock(html, model, s0, pg, downloadHref)}</div></div></div></section></div>`;
  if (typeof root?.querySelector !== "function") return root; // the string stand-in of the unit tests has no DOM: the cards above are the static markup
  const swap = (selector, next) => {
    const el = root.querySelector(selector);
    if (el) el.replaceWith(next);
  };
  const refresh = () => {
    const state = view();
    const rows = viewRows(model, state, pg.members);
    const body = html`<div id="indicator-table-body">${resultsBlock(html, model, state, pg, downloadHref)}</div>`;
    swap("#indicator-table-body", body);
    if (ranked) swap("#indicator-dot-body", dotCardBody(html, Plot, model, rows, state.focus));
  };
  store.subscribe(refresh);
  if (meta) {
    const dash = compareHost(store, {indicatorId: h.indicatorId, domainId, scorecard, slots: {compare: root.querySelector("#indicator-compare")}});
    mountRankCard(html, Plot, dash, {
      data: meta,
      series,
      links: INDICATOR_LINKS,
      facts: false,
      sorts: INDICATOR_SORT_OPTIONS,
      focusReader: true,
      onSort: (id) => {
        sort = id;
        refresh();
      },
      // The reader's country is the country in focus: it is written to the address as `c` through the store (Group and the other keys are kept).
      onFocus: (id) => dash.quiet(() => store.set({c: id === null ? [] : [id]}))
    });
  }
  return root;
}
