// L12 (layout amendment 4.7, AC-DB-22, AC-DB-23, AC-DB-36, ADR-036): the ranked comparison card (C-RANK) of PG-HOME. Renders a buildComparison() result.
// `html` (htl) and `Plot` are passed in; this file imports only local modules. Display only (D6): every number printed is a stored field formatted
// by indicator-model.js; bar lengths are drawn by Plot from the stored values on the axis domain the model picked. Nothing here counts or ranks;
// the hidden-rows disclosure reads only the sentence of the model (ADR-036 I3): it never reads a length.
import {
  DRAFT_GROUP_REFERENCE_ROWS, DRAFT_INDICATOR_COLUMNS as ICOL, DRAFT_INDICATOR_COLUMNS_MORE as MORE, DRAFT_INDICATOR_SORT_LABEL, DRAFT_INDICATOR_TABLE_CAPTION,
  DRAFT_EMPTY_CARD, DRAFT_OFFSET_FLAG, DRAFT_RANK_COLUMNS, DRAFT_REGIONS, DRAFT_SUBREGION_CONSEQUENCE, DRAFT_TRANSFORMED_HEADER, FLAG_AHEAD, FLAG_INHERITED, FLAG_LAGGING,
  FLAG_UNALIGNED, INDICATOR_SERIES_LINK, READER_NONE, SERIES_LINK_LABEL, VIEW_AS_TABLE
} from "./copy.11b4a285.js";
import {aboutDetails} from "./about-value.4bc9532a.js";
import {chip, sourceCell, valueCell} from "./country-view.26e4c2a7.js";
import {fillOnOpen} from "./figure.39e330d9.js";
import {glyph} from "./glyphs.a14b04e8.js";
import {serializeHash} from "./hash.54a4e297.js";
import {pointReader} from "./point-reader.c43738a4.js";
import {buildComparison, RANK_SORT_OPTIONS} from "./rank-model.390651f3.js";
import {ariaSort} from "./sort.6c0c3800.js";
import {busyBlock, errorBlock, failureKind} from "./state-blocks.81d10981.js";
import {STATES} from "./states.465c23b4.js";
import {readerText, tipText, valueTipLines} from "./tip.5281e05d.js";
import {factsCard} from "./facts-card.2ce9c843.js";
import {indicatorHeader} from "./indicator-model.8c928951.js";
import {codeText, unitLabelText, xTickFormat} from "./code-text.538effeb.js";

const ALIGNMENT_TAGS = Object.freeze({ahead: FLAG_AHEAD, lagging: FLAG_LAGGING, unaligned: FLAG_UNALIGNED});
const BAR_WIDTH = 150;
const BAR_HEIGHT = 18;
const EDGE = 8; // left and right plot margin, identical for the rows and the axis so they line up

// Links from the home page (the page sits at the site root).
export const countryHref = (entityId) => `./country/${entityId}`;
export const seriesHref = (indicatorId, entityId) => `./explorer${serializeHash({i: indicatorId, c: [entityId]})}`;
// The link builders of a page; the default is the home page. PG-INDICATOR (L23) sits one level down and passes its own.
export const HOME_LINKS = Object.freeze({country: countryHref, series: seriesHref});

// One bar (shared axis) or one percentile dot (units differ). "" when the row has nothing to draw: a state code in the next cells says why.
export function barPlot(Plot, model, r) {
  const common = {width: BAR_WIDTH, height: BAR_HEIGHT, marginTop: 2, marginBottom: 2, marginLeft: EDGE, marginRight: EDGE, y: {axis: null}};
  if (model.form === "bar") {
    if (!r.hasValue || model.domain === null || typeof r.value !== "number") return "";
    return Plot.plot({...common, x: {axis: null, domain: model.domain}, marks: [Plot.barX([r], {x: "value"})]});
  }
  if (r.percentile === null || r.percentile === undefined) return "";
  return Plot.plot({...common, x: {axis: null, domain: [0, 1]}, marks: [Plot.dot([r], {x: "percentile", y: 0, r: 5})]});
}

// The shared axis drawn once in the header cell (bar form only); the plot margins match the rows.
function axisPlot(Plot, model) {
  if (model.form !== "bar" || model.domain === null) return "";
  return Plot.plot({width: BAR_WIDTH, height: 30, marginTop: 24, marginBottom: 0, marginLeft: EDGE, marginRight: EDGE, style: {fontSize: "10px"}, x: {domain: model.domain, ticks: 3, label: null}, marks: [Plot.axisX({anchor: "top", ticks: 3})]});
}

const tipOf = (r) => tipText(valueTipLines({label: r.name, valueText: r.valueText, unit: r.unit, estimate: r.estimate, periodText: r.periodText}));

function nameCell(html, r, links = HOME_LINKS) {
  return html`<th scope="row" class="mm-country" data-label="${ICOL.country}">${r.hasCountryPage ? html`<a href="${links.country(r.entityId)}" data-link="country" data-carry>${r.name}</a>` : r.name}</th>`;
}

function periodCell(html, r) {
  const tag = ALIGNMENT_TAGS[r.alignment] ?? null;
  return html`<td data-label="${ICOL.period}">${r.periodText ?? r.refPeriodEnd ?? ""}${r.offsetFlag ? html` <span class="mm-flag" data-flag="offset">${DRAFT_OFFSET_FLAG(r.refOffsetDays)}</span>` : ""}${tag ? html` <span class="mm-flag" data-flag="alignment">${tag}</span>` : ""}</td>`;
}

function reasonCells(html, r, span) {
  const st = r.state;
  const base = STATES[st.key];
  return html`<td colspan="${span}" class="mm-reason" data-label="${MORE.reason}" data-state="${st.key}" data-signature="${st.signature}"><span class="mm-cell">${base.glyph ? glyph(html, base.glyph) : ""}<span class="mm-code">${base.code ?? ""}</span></span> <span class="mm-sentence">${st.sentence}</span></td>`;
}

const COLUMNS = 5; // name, bar, value, period, percentile
const REASON_SPAN = 4; // the reason cell spans every column after the name

// A row is a list of single-root nodes (the row and, for a row with a value, its sub-row): htl wraps a fragment of several nodes in a <span>,
// which a table body cannot hold, so the lists are flattened by the caller.
function comparisonRow(html, Plot, model, r, links = HOME_LINKS) {
  const id = `rank-about-${model.header.indicatorId}-${r.entityId}`;
  const about = {...r, indicatorId: model.header.indicatorId, name: model.header.name};
  if (!r.hasValue) {
    return [html`<tr role="row" data-entity="${r.entityId}" data-has-value="false" data-state="${r.state.key}" data-focus="${r.inFocus}">${nameCell(html, r, links)}${reasonCells(html, r, REASON_SPAN)}</tr>`];
  }
  const drawn = barPlot(Plot, model, r);
  return [
    html`<tr role="row" data-entity="${r.entityId}" data-has-value="true" data-state="${r.state.key}" data-focus="${r.inFocus}">${nameCell(html, r, links)}<td class="mm-rank-bar"><span class="mm-rank-bar-wrap" aria-hidden="true" data-bin="${r.fillBin ?? "none"}" data-form="${model.form}" title="${tipOf(r)}">${drawn}</span></td>${valueCell(html, r)}${periodCell(html, r)}${chip(html, r)}</tr>`,
    html`<tr class="mm-sub-row" data-for-entity="${r.entityId}"><td colspan="${COLUMNS}">${aboutDetails(html, about, r.name, id)}</td></tr>`
  ];
}

function headerCell(html, label, field, sortState, cls = "") {
  const aria = field ? ariaSort(sortState, field) : null;
  return aria === null ? html`<th scope="col" class="${cls}">${label}</th>` : html`<th scope="col" class="${cls}" aria-sort="${aria}">${label}</th>`;
}

// The scroll container with the sticky header row, the countries, then the "Reference rows" group (stored aggregates, styled apart).
export function comparisonTable(html, Plot, model, links = HOME_LINKS) {
  const sortState = model.sort;
  const caption = DRAFT_INDICATOR_TABLE_CAPTION(model.header.name);
  const axis = axisPlot(Plot, model);
  const barHead = model.form === "bar" ? html`<th scope="col" class="mm-rank-bar-head"><span class="mm-visually-hidden">${DRAFT_RANK_COLUMNS.bar}</span><span aria-hidden="true">${axis}</span></th>` : html`<th scope="col" class="mm-rank-bar-head">${DRAFT_RANK_COLUMNS.dot}</th>`;
  const head = html`<thead><tr>${headerCell(html, ICOL.country, "name", sortState)}${barHead}${headerCell(html, ICOL.value, "value", sortState, "mm-num")}${headerCell(html, ICOL.period, null, sortState)}${headerCell(html, ICOL.percentile, "percentile", sortState, "mm-num")}</tr></thead>`;
  const countries = model.countries.flatMap((r) => comparisonRow(html, Plot, model, r, links));
  const references = model.references.flatMap((r) => comparisonRow(html, Plot, model, r, links));
  const refBody = !model.hasReferences ? "" : html`<tbody data-group="reference"><tr class="mm-group-row"><th scope="rowgroup" colspan="${COLUMNS}">${DRAFT_GROUP_REFERENCE_ROWS}</th></tr>${references}</tbody>`;
  return html`<div class="mm-rank-scroll" tabindex="0" role="region" aria-label="${caption}"><table class="mm-rank-table" data-axis="${model.form === "bar" ? "shared" : "none"}" data-form="${model.form}"><caption class="mm-visually-hidden">${caption}</caption>${head}<tbody data-group="countries">${countries}</tbody>${refBody}</table></div>`;
}

// ADR-036: the disclosure of the rows the Period filter hid. Visibility only by the sentence (I3); the list is the model's hidden array.
export function hiddenRowsBlock(html, model, links = HOME_LINKS) {
  if (model.hiddenSentence === "") return "";
  return html`<details class="mm-hidden-rows"><summary>${model.hiddenSentence}</summary><ul>${model.hiddenRows.map((h) => html`<li data-entity="${h.entityId}">${h.hasCountryPage ? html`<a href="${links.country(h.entityId)}" data-link="country" data-carry>${h.text}</a>` : h.text}</li>`)}</ul></details>`;
}

// "View as table" (RD C-IND-5 columns): the same rows as the card, built on the first open of the disclosure.
function flagsCell(html, r) {
  const tag = ALIGNMENT_TAGS[r.alignment] ?? null;
  return html`<td data-label="${MORE.flags}">${r.offsetFlag ? html`<span class="mm-flag" data-flag="offset">${DRAFT_OFFSET_FLAG(r.refOffsetDays)}</span> ` : ""}${tag ? html`<span class="mm-flag" data-flag="alignment">${tag}</span> ` : ""}${r.inherited ? html`<span class="mm-flag" data-flag="inherited">${FLAG_INHERITED}</span>` : ""}</td>`;
}

function transformedCell(html, r, label) {
  return html`<td class="mm-num" data-label="${DRAFT_TRANSFORMED_HEADER(label)}">${r.transformedText ?? ""}${r.transformedText === null ? "" : html` <span class="mm-unit">${r.transformLabel ?? label}</span>`}</td>`;
}

function tableRow(html, model, r, transformed, label, links = HOME_LINKS) {
  const span = transformed ? 8 : 7;
  if (!r.hasValue) return html`<tr data-entity="${r.entityId}" data-has-value="false" data-state="${r.state.key}">${nameCell(html, r, links)}${reasonCells(html, r, span)}</tr>`;
  return html`<tr data-entity="${r.entityId}" data-has-value="true" data-state="${r.state.key}">${nameCell(html, r, links)}${valueCell(html, r)}${periodCell(html, r)}<td class="mm-num" data-label="${ICOL.offset}">${r.refOffsetDays ?? ""}</td>${transformed ? transformedCell(html, r, label) : ""}${chip(html, r)}${flagsCell(html, r)}${sourceCell(html, r)}<td class="mm-actions" data-label="${MORE.actions}"><a href="${links.series(model.header.indicatorId, r.entityId)}" data-link="series" aria-label="${SERIES_LINK_LABEL(model.header.name, r.name)}">${INDICATOR_SERIES_LINK}</a></td></tr>`;
}

export function tableAlternative(html, model, links = HOME_LINKS) {
  const label = model.header.transformLabel ?? model.header.transformId;
  const transformed = model.withValue.some((r) => r.transformedText !== null);
  const caption = DRAFT_INDICATOR_TABLE_CAPTION(model.header.name);
  const sortState = model.sort;
  const head = html`<thead><tr>${headerCell(html, ICOL.country, "name", sortState)}${headerCell(html, ICOL.value, "value", sortState, "mm-num")}${headerCell(html, ICOL.period, null, sortState)}${headerCell(html, ICOL.offset, null, sortState, "mm-num")}${transformed ? headerCell(html, DRAFT_TRANSFORMED_HEADER(label), null, sortState, "mm-num") : ""}${headerCell(html, ICOL.percentile, "percentile", sortState, "mm-num")}${headerCell(html, MORE.flags, null, sortState)}${headerCell(html, MORE.source, null, sortState)}${headerCell(html, MORE.actions, null, sortState)}</tr></thead>`;
  const rows = () => model.shown.map((r) => tableRow(html, model, r, transformed, label, links));
  const el = html`<details class="mm-view-table mm-rank-alt" id="rank-table-alt"><summary>${VIEW_AS_TABLE}</summary><div class="mm-rank-alt-scroll"><table class="mm-indicator-table" id="rank-table"><caption>${caption}</caption>${head}<tbody>${typeof document === "undefined" ? rows() : ""}</tbody></table></div></details>`;
  if (typeof document !== "undefined" && typeof el?.addEventListener === "function") fillOnOpen(el, el.querySelector("tbody"), rows);
  return el;
}

function readerEntries(model) {
  return model.withValue.map((r) => ({id: r.entityId, name: r.name, texts: [readerText(valueTipLines({label: r.name, valueText: r.valueText, unit: r.unit, estimate: r.estimate, periodText: r.periodText}))], periods: []}));
}

const emptyCard = (html) => html`<p class="mm-state mm-state-empty" id="rank-empty" data-state="empty">${DRAFT_EMPTY_CARD}</p>`;

// Mounts the card into dash.slots.compare (and the facts card into dash.slots.facts). `series`: the meta/series.json list (reference-period
// labels and the "no series" wording need it); null when it failed to load (the card then shows its own error). `data`: the meta lists.
// Options for PG-INDICATOR (L23): `links` (page-relative hrefs), `facts: false` (the facts are in the header card there), `sorts` (the option list),
// `onSort(id)` and `onFocus(id | null)` (user changes of the sort select and of the reader's country), `focusReader` (the reader starts on the country in focus, hash c).
export function mountRankCard(html, Plot, dash, {data, series, doc = globalThis.document, links = HOME_LINKS, facts = true, sorts = RANK_SORT_OPTIONS, onSort = () => {}, onFocus = () => {}, focusReader = false}) {
  const slot = dash.slots.compare;
  const factsSlot = dash.slots.facts ?? null;
  slot.classList.add("mm-card--rank");
  if (facts) factsSlot.classList.add("mm-card--facts");
  let sort = "name";
  let last = null;
  const title = doc.createElement("h3");
  const sub = doc.createElement("p");
  sub.className = "mm-card-sub";
  const select = html`<select id="rank-sort">${sorts.map((o) => html`<option value="${o.id}">${o.label}</option>`)}</select>`;
  const head = html`<div class="mm-rank-head"><label>${DRAFT_INDICATOR_SORT_LABEL} ${select}</label></div>`;
  const status = doc.createElement("div"); // persistent live region: a changed sentence is announced (ADR-036 I5)
  status.setAttribute("role", "status");
  status.className = "mm-hidden-slot";
  const body = doc.createElement("div");
  body.className = "mm-rank-body";
  dash.fill(slot, title, status, sub, head, body); // the Period hidden-rows disclosure sits directly under the title (ADR-036, amendment 2.2)
  select.addEventListener("change", () => {
    sort = select.value;
    onSort(sort);
    if (last) render(last);
  });

  function setReading(id, focusIds) {
    for (const tr of body.querySelectorAll("tr[data-entity]")) tr.setAttribute("data-focus", String(focusIds.has(tr.getAttribute("data-entity")) || tr.getAttribute("data-entity") === id));
  }

  function render(ctx) {
    last = ctx;
    const indicator = data.indicators.find((i) => i.indicator_id === ctx.indicatorId) ?? null;
    title.textContent = indicator?.name ?? ctx.indicatorId ?? "";
    sub.textContent = unitLabelText(indicator?.unit_label) ?? "";
    sub.hidden = !indicator?.unit_label;
    const header = indicator ? indicatorHeader(indicator, data.domains) : null;
    const failed = ctx.error ?? (series === null ? new Error("series") : null);
    if (failed || !indicator) {
      status.replaceChildren();
      if (failed) body.replaceChildren(errorBlock(html, {region: series === null ? DRAFT_REGIONS.meta : DRAFT_REGIONS.scorecard, kind: failureKind(failed, "missing"), consequence: DRAFT_SUBREGION_CONSEQUENCE, id: "rank-error"}));
      else body.replaceChildren(emptyCard(html));
      if (facts) dash.fill(factsSlot, header ? factsCard(html, header, null) : "");
      slot.setAttribute("aria-busy", "false");
      return;
    }
    if (ctx.loading || !ctx.scorecard) {
      status.replaceChildren();
      body.replaceChildren(busyBlock(html, DRAFT_REGIONS.scorecard, {id: "rank-loading"}));
      if (facts) dash.fill(factsSlot, factsCard(html, header, null));
      dash.busy(slot);
      return;
    }
    try {
      const model = buildComparison({indicator, domainId: ctx.domainId, domains: data.domains, scorecard: ctx.scorecard, entities: data.entities, groups: data.groups, series, state: ctx.state, sort});
      select.value = model.sortId;
      status.replaceChildren(...(model.hiddenSentence === "" ? [] : [hiddenRowsBlock(html, model, links)]));
      const focusIds = new Set(model.shown.filter((r) => r.inFocus).map((r) => r.entityId));
      if (model.empty) body.replaceChildren(emptyCard(html));
      else {
        const parts = [comparisonTable(html, Plot, model, links)];
        const entries = readerEntries(model);
        const focusId = focusReader ? (entries.find((e) => focusIds.has(e.id))?.id ?? null) : null; // PG-INDICATOR: the country in focus (hash c) starts selected
        const reader = pointReader(html, {id: "rank-reader", entries, range: false, none: READER_NONE, value: focusId, onChange: (sel) => {
          const id = sel === null ? null : sel.entry.id;
          setReading(id, focusIds);
          if (id !== focusId) onFocus(id); // a user choice only: the first call (the start value) equals focusId and writes nothing
        }});
        parts.push(reader.el, tableAlternative(html, model, links));
        body.replaceChildren(...parts);
      }
      if (facts) dash.fill(factsSlot, factsCard(html, model.header, model.referenceLine));
    } catch {
      // a scorecard that loaded but does not have the expected shape: this card shows its own invalid-data alert (amendment 5, item 2)
      status.replaceChildren();
      body.replaceChildren(errorBlock(html, {region: DRAFT_REGIONS.scorecard, kind: "invalid", consequence: DRAFT_SUBREGION_CONSEQUENCE, id: "rank-error"}));
      if (facts) dash.fill(factsSlot, factsCard(html, header, null));
    }
    slot.setAttribute("aria-busy", "false");
  }

  return dash.onChange(render);
}

