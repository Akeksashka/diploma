// Renders the V2 peer comparison. `html` (htl) and `Plot` are passed in so this file imports only local modules.
// Display only: nothing is computed here (D6). The state ({indicator, group, sort, focus}) comes from the page's
// controls and the URL hash; `panelState` validates it. Every number drawn or printed is a stored field.
import {focusHash, panelState, spreadText} from "./peers.js";
import {
  COUNTRY_HEADER, DRAFT_FACT_LABELS as FACT, DRAFT_NEXT_GROUP, DRAFT_PEER_DIRECTION, DRAFT_PEER_FIGURE_LABEL, DRAFT_PEER_FOCUS_HINT, DRAFT_PEER_GUIDES, DRAFT_PEER_MARKS,
  DRAFT_PEER_NOT_DRAWN, DRAFT_PEER_TABLE_CAPTION, EMPTY_GROUP, NO_INDICATORS, NO_RANKING_SPREAD, ORIENTATION_NOTE, SKIP_TO_TABLE
} from "./copy.js";
import {chartFigure} from "./figure.js";
import {emptyBlock} from "./state-blocks.js";
import {token} from "./tokens.js";

// Constant guide positions on the 0..1 scale (neutral, not statistics of the data).
export const GUIDES = Object.freeze([0.25, 0.5, 0.75]);
export const TICKS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

export function selectBox(html, {id, label, options}) {
  return html`<label>${label} <select id="${id}">${options.map((o) => html`<option value="${o.id}">${o.label}</option>`)}</select></label>`;
}

// Radio group in a fieldset with a legend. The element carries a `value` (the checked radio) and re-emits `input`, so
// Generators.input(fieldset) works like it does for a select. Choosing only filters (AC-DASH-9).
export function radioGroup(html, {id, legend, options, value}) {
  const set = html`<fieldset id="${id}" class="mm-radios"><legend>${legend}</legend>${options.map(
    (o) => html`<label class="mm-radio"><input type="radio" name="${id}" value="${o.id}" checked=${o.id === (value ?? options[0]?.id)}> <span>${o.label}</span></label>`
  )}</fieldset>`;
  Object.defineProperty(set, "value", {get: () => set.querySelector("input:checked")?.value ?? options[0]?.id ?? null});
  return set;
}

const cellText = (r) => (r.unit && r.valueNum !== null ? `${r.valueText} ${r.unit}` : r.valueText);

export function peerTable(html, pv, st, {onFocus = null} = {}) {
  const name = st.indicator?.name ?? "";
  return html`<table id="peer-table" role="table"><caption>${DRAFT_PEER_TABLE_CAPTION(name)}</caption><thead><tr role="row"><th scope="col" role="columnheader">${COUNTRY_HEADER}</th><th scope="col" role="columnheader" class="mm-num">${FACT.value}</th><th scope="col" role="columnheader">${FACT.refPeriod}</th><th scope="col" role="columnheader" class="mm-num">${FACT.refOffset}</th><th scope="col" role="columnheader" class="mm-num">${pv.percentileColumn}</th><th scope="col" role="columnheader">${FACT.flags}</th></tr></thead><tbody>${st.rows.map(
    (r) => html`<tr role="row" data-entity="${r.entityId}" data-status="${r.status}" data-mark="${r.mark ?? ""}" data-focus="${st.focus === r.entityId}"><th scope="row" role="rowheader" class="mm-country" data-label="${COUNTRY_HEADER}"><button type="button" class="mm-focus-btn" data-entity="${r.entityId}" aria-pressed="${st.focus === r.entityId}" onclick=${() => onFocus?.(r.entityId)}>${r.name}</button></th><td role="cell" data-label="${FACT.value}" class="mm-num${r.valueNum === null ? " mm-na" : ""}">${r.valueText}${r.unit && r.valueNum !== null ? html` <span class="mm-na">${r.unit}</span>` : ""}</td><td role="cell" data-label="${FACT.refPeriod}">${r.refPeriod ?? "n/a"}</td><td role="cell" data-label="${FACT.refOffset}" class="mm-num${r.refOffsetDays === null ? " mm-na" : ""}">${r.refOffsetDays ?? "n/a"}</td><td role="cell" data-label="${pv.percentileColumn}" class="mm-num${r.status === "ranked" ? "" : " mm-na"}">${r.percentileText}</td><td role="cell" data-label="${FACT.flags}">${r.flags.map((f) => html`<span class="mm-flag">${f}</span>`)}</td></tr>`
  )}</tbody></table>`;
}

// Dot plot of the stored percentile of the rows shown (rows without one are not drawn). The label of a row is the
// country name followed by its stored value. Filled = observed, hollow = estimate or inherited; a ring marks the focus.
export function peerChart(Plot, pv, st) {
  const rows = st.rows.filter((r) => r.percentile !== null).map((r) => ({...r, label: `${r.name}: ${cellText(r)}`}));
  if (rows.length === 0) return null;
  const ink = token("--mm-pct-4");
  const focus = rows.filter((r) => r.entityId === st.focus);
  return Plot.plot({
    style: {fontSize: "14px", background: "transparent"},
    marginLeft: 290,
    marginRight: 28,
    marginBottom: 46,
    x: {domain: [0, 1], ticks: [...TICKS], tickFormat: ".2f", label: pv.percentileColumn, labelAnchor: "center"},
    y: {label: null, domain: rows.map((r) => r.label), step: 34},
    marks: [
      Plot.ruleX([...GUIDES], {stroke: token("--mm-border"), strokeWidth: 1.5}),
      Plot.dot(rows, {x: "percentile", y: "label", r: 8, stroke: ink, strokeWidth: 2.5, fill: (r) => (r.hollow ? "none" : ink)}),
      Plot.dot(focus, {x: "percentile", y: "label", r: 14, stroke: token("--mm-focus"), strokeWidth: 3, fill: "none"})
    ]
  });
}

function chartBlock(html, Plot, pv, st) { // only called while pc is on (peersBlock): the orientation sentence belongs to the percentile layer
  const chart = peerChart(Plot, pv, st);
  if (chart === null) return "";
  const n = st.rows.filter((r) => r.percentile !== null).length;
  return html`<section class="mm-peer-chart" id="peer-chart-block">
<p class="mm-orientation" id="peer-orientation">${ORIENTATION_NOTE}${st.indicator.direction ? html` <span id="peer-direction">${DRAFT_PEER_DIRECTION(st.indicator.direction)}</span>` : ""}</p>
<p class="mm-skip-values"><a href="#peer-table" id="peer-skip">${SKIP_TO_TABLE}</a></p>
${chartFigure(html, {id: "peer-figure", label: DRAFT_PEER_FIGURE_LABEL(st.indicator.name, n, pv.percentileColumn), chart})}
<p class="mm-figure-note" id="peer-figure-note">${DRAFT_PEER_MARKS} ${DRAFT_PEER_GUIDES} ${DRAFT_PEER_NOT_DRAWN}</p>
<p class="mm-figure-note" id="peer-focus-hint">${DRAFT_PEER_FOCUS_HINT}</p></section>`;
}

// `state.onFocus(entityId)` is called by a country button; the default sets or clears the hash (browser only).
export function peersBlock(html, Plot, pv, state) {
  const st = panelState(pv, state);
  const ind = st.indicator;
  const spread = ind ? spreadText(ind) : null;
  const onFocus = state?.onFocus ?? ((id) => {
    if (typeof location !== "undefined") location.hash = st.focus === id ? "" : focusHash(id);
  });
  return html`<div class="mm-peers">
<p class="mm-caveat" id="caveat">${pv.caveat}</p>
<p class="mm-filter-note" id="filter-note">${pv.filterNote}</p>
${ind === null ? html`<p id="no-indicators">${NO_INDICATORS}</p>` : html`<h3 id="peer-indicator-name">${ind.name}</h3>
${ind.notes.map((n) => html`<p class="mm-indicator-note" id="indicator-note">${n}</p>`)}
${spread ? html`<p class="mm-spread" id="reference-spread">${spread}</p>` : html`<p class="mm-spread" id="reference-spread">${NO_RANKING_SPREAD}</p>`}
${st.empty ? emptyBlock(html, {id: "empty-group", text: EMPTY_GROUP, next: DRAFT_NEXT_GROUP}) : html`${pv.ranked && state?.pc === true ? chartBlock(html, Plot, pv, st) : ""}${peerTable(html, pv, st, {onFocus})}`}`}</div>`;
}
