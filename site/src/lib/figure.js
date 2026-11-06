// Shared chart wrapper (T120): a `<figure role="img">` whose aria-label is generated from stored fields, and a "View as table"
// disclosure that lists the plotted points. `html` (htl) is passed in; this file imports only local modules. D6: nothing is
// computed here. "Latest 24 periods" is a display slice of an already date-sorted list, not a statistic.
import {COUNTRY_HEADER, DRAFT_DOWNLOAD, DRAFT_EXPLORER_FIGURE_LABEL, DRAFT_SERIES_LABEL_PART, DRAFT_TABLE_CAPTION, DRAFT_TABLE_HEADERS, DRAFT_FACT_LABELS, VIEW_AS_TABLE} from "./copy.js";

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

// rows: [{entity, name, date, valueText, status}] in the order shown.
export function viewAsTable(html, {id, title, rows, href = null, n = LATEST_PERIODS}) {
  return html`<details class="mm-view-table" id="${id}"><summary>${VIEW_AS_TABLE}</summary>
<table id="${id}-table"><caption>${DRAFT_TABLE_CAPTION(title, n)}</caption><thead><tr><th scope="col">${COUNTRY_HEADER}</th><th scope="col">${DRAFT_FACT_LABELS.refPeriod}</th><th scope="col" class="mm-num">${DRAFT_TABLE_HEADERS.value}</th><th scope="col">${DRAFT_TABLE_HEADERS.status}</th></tr></thead><tbody>${rows.map(
    (r) => html`<tr data-entity="${r.entity}"><th scope="row">${r.name}</th><td>${r.date}</td><td class="mm-num">${r.valueText}</td><td>${r.status ?? "n/a"}</td></tr>`
  )}</tbody></table>
${href ? html`<p><a href="${href}" download id="${id}-download">${DRAFT_DOWNLOAD}</a></p>` : ""}</details>`;
}
