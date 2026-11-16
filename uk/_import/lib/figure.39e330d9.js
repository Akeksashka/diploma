// Shared chart wrapper (T120): a `<figure role="img">` whose aria-label is generated from stored fields, and a "View as table"
// disclosure that lists the plotted points. `html` (htl) is passed in; this file imports only local modules. D6: nothing is
// computed here. "Latest 24 periods" is a display slice of an already date-sorted list, not a statistic.
import {COUNTRY_HEADER, DRAFT_DOWNLOAD, DRAFT_EXPLORER_FIGURE_LABEL, DRAFT_SERIES_LABEL_PART, DRAFT_TABLE_CAPTION, DRAFT_TABLE_CAPTION_ALL, DRAFT_TABLE_HEADERS, DRAFT_UNIT_MISSING_SENTENCE, DRAFT_VALUE_HEADER_UNIT, DRAFT_FACT_LABELS, VIEW_AS_TABLE} from "./copy.11b4a285.js";

export const LATEST_PERIODS = 24;

// The figure itself holds only the chart (role="img" makes its children presentational), so the table and links sit outside it.
export function chartFigure(html, {id, label, chart}) {
  return html`<figure class="mm-figure" id="${id}" role="img" aria-label="${label}">${chart}</figure>`;
}

// series: [{name, first, last, latestText}] with ISO dates and the stored latest value text (value and unit).
export function seriesFigureLabel({title, yLabel, series}) {
  return DRAFT_EXPLORER_FIGURE_LABEL(title, yLabel, series.map((s) => DRAFT_SERIES_LABEL_PART(s.name, s.first, s.last, s.latestText)));
}

// The plotted points of one series that the table lists: the latest `n` points that have a value (a slice, in date order).
export function latestPoints(points, n = LATEST_PERIODS) {
  return points.filter((p) => p.value !== null).slice(-n);
}

// rows: [{entity, name, date, valueText, status, unit?}] in the order shown. `valueUnit`: the unit text for the value column
// header (AC-RD-42); without it a row's own `unit` is printed in its value cell, and a row with no unit keeps its value and adds
// the stated defect sentence (AC-RD-30: the same values as the chart; AC-RD-42: never a bare number). `lazy`: with a DOM the body
// rows are built on the first open of the disclosure (a large series can have thousands of points); every row is then present.
export function viewAsTable(html, {id, title, rows, href = null, n = LATEST_PERIODS, valueUnit = null, lazy = false}) {
  const deferred = lazy && typeof document !== "undefined";
  const rowHtml = (r) => html`<tr data-entity="${r.entity}"><th scope="row">${r.name}</th><td>${r.date}</td><td class="mm-num">${valueUnit ? r.valueText : r.unit ? `${r.valueText} ${r.unit}` : `${r.valueText} ${DRAFT_UNIT_MISSING_SENTENCE}`}</td><td>${r.status ?? "n/a"}</td></tr>`;
  const el = html`<details class="mm-view-table" id="${id}"><summary>${VIEW_AS_TABLE}</summary>
<table id="${id}-table"><caption>${n === null ? DRAFT_TABLE_CAPTION_ALL(title) : DRAFT_TABLE_CAPTION(title, n)}</caption><thead><tr><th scope="col">${COUNTRY_HEADER}</th><th scope="col">${DRAFT_FACT_LABELS.refPeriod}</th><th scope="col" class="mm-num">${valueUnit ? DRAFT_VALUE_HEADER_UNIT(valueUnit) : DRAFT_TABLE_HEADERS.value}</th><th scope="col">${DRAFT_TABLE_HEADERS.status}</th></tr></thead><tbody>${deferred ? "" : rows.map(rowHtml)}</tbody></table>
${href ? html`<p><a href="${href}" download id="${id}-download">${DRAFT_DOWNLOAD}</a></p>` : ""}</details>`;
  if (deferred) fillOnOpen(el, el.querySelector("tbody"), () => rows.map(rowHtml));
  return el;
}

// Fill `tbody` once, the first time `details` is open (the "toggle" event); progressive: closed, the page holds no rows.
export function fillOnOpen(details, tbody, makeRows) {
  let done = false;
  details.addEventListener("toggle", () => {
    if (done || !details.open) return;
    done = true;
    tbody.replaceChildren(...makeRows());
  });
}
