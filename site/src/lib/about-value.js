// Redesign R8 (spec 5.5): the "About this value" field list of one value row of PG-COUNTRY. A native <details> (keyboard-operable,
// not tooltip-only). Stored fields only, printed as stored: no computation, no prose. A field the export does not hold is left out.
// `html` (htl) is passed in; this file imports only local modules.
import {safeUrl} from "./attribution.js";
import {multText, seriesUnit} from "./units.js";
import {DRAFT_ABOUT_LABELS as L, DRAFT_ABOUT_SUMMARY, DRAFT_OFFSET_FLAG, DRAFT_REESTIMATED_MARK, FLAG_AHEAD, FLAG_ESTIMATE, FLAG_LAGGING, FLAG_UNALIGNED} from "./copy.js";
import {codeText, unitLabelText, xTickFormat} from "./code-text.js";

const present = (v) => v !== null && v !== undefined && v !== "";
const ALIGNMENT_TAGS = Object.freeze({ahead: FLAG_AHEAD, lagging: FLAG_LAGGING, unaligned: FLAG_UNALIGNED});

// The flags of a row as short stored-field markers: the spec 5.1 state sentence, the offset flag, the alignment tag, the estimate mark.
export function aboutFlags(row) {
  const out = [];
  if (row.state?.sentence) out.push(row.state.sentence);
  if (row.offsetFlag) out.push(DRAFT_OFFSET_FLAG(row.refOffsetDays));
  if (ALIGNMENT_TAGS[row.alignment]) out.push(ALIGNMENT_TAGS[row.alignment]);
  if (row.estimate) out.push(FLAG_ESTIMATE);
  return out;
}

// Ordered [{key, label, value, href?}] for one value row (a countryModel() row) of the country `entityName`.
export function aboutFields(row, entityName) {
  const c = row.cell ?? {};
  const s = row.seriesMeta ?? {};
  const f = [];
  const add = (key, value, extra = {}) => {
    if (present(value) && !(Array.isArray(value) && value.length === 0)) f.push({key, label: L[key], value, ...extra});
  };
  add("indicator", row.name);
  add("country", entityName);
  add("seriesId", c.series_id ?? s.series_id);
  add("source", s.source_name ?? row.sourceName, {href: safeUrl(s.source_url ?? row.sourceUrl)});
  add("attribution", s.licence_attribution);
  add("frequency", s.frequency);
  // Series-level (spec 5.2): unit_code, plus the "values in <unit_code> x 10^<unit_mult>" text when unit_mult is not 0.
  const unitCode = seriesUnit(s);
  add("unit", unitCode === null ? null : [unitCode, multText(s)].filter(Boolean).join("; "));
  add("seasonal", codeText("seasonal", s.seasonal_adjustment));
  add("priceBasis", s.price_basis);
  add("refPeriod", row.periodText ?? row.refPeriodEnd);
  add("knownAt", c.known_at);
  add("sourceRelease", c.source_release_at);
  add("age", c.age_days);
  add("staleLimit", c.stale_limit_days);
  add("transform", codeText("transform", c.transform_id));
  add("flags", aboutFlags(row));
  if (s.reestimating === true) add("reestimating", DRAFT_REESTIMATED_MARK);
  return f;
}

const valueNode = (html, field) =>
  Array.isArray(field.value)
    ? html`<ul class="mm-about-flags">${field.value.map((v) => html`<li>${v}</li>`)}</ul>`
    : field.href
      ? html`<a href="${field.href}" rel="noopener">${field.value}</a>`
      : String(field.value);

// `id` must be unique on the page (domain + indicator).
export function aboutDetails(html, row, entityName, id) {
  const fields = aboutFields(row, entityName);
  return html`<details class="mm-about" id="${id}" data-for="${row.indicatorId}"><summary>${DRAFT_ABOUT_SUMMARY}</summary><dl class="mm-about-list">${fields.map(
    (x) => html`<div class="mm-about-field" data-field="${x.key}"><dt>${x.label}</dt><dd>${valueNode(html, x)}</dd></div>`
  )}</dl></details>`;
}
