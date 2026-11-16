// Redesign R14 (spec C-SER-6, AC-RD-32/33/42/45): the unit text of PG-SERIES and the "About these series" table.
// Stored fields only, printed as stored; nothing is computed. `html` (htl) is passed in; imports local modules only.
import {safeUrl} from "./attribution.a296f2f6.js";
import {DRAFT_ABOUT_SERIES_COLUMNS as C, DRAFT_ABOUT_SERIES_HEADING, DRAFT_REESTIMATED_MARK, DRAFT_VALUE_ESTIMATE_MARK} from "./copy.11b4a285.js";
import {transformLabel} from "./indicator-model.8c928951.js";
import {periodLabel} from "./period.354df927.js";
import {indicatorUnit, rebaseUnit, seriesUnit} from "./units.648eaacc.js";
import {codeText, unitLabelText, xTickFormat} from "./code-text.538effeb.js";

export const NA = "n/a";
const present = (v) => v !== null && v !== undefined && v !== "";
const orNA = (v) => (present(v) ? String(v) : NA);

// Estimate or provisional (AC-RD-45: value_status EST or PROV).
export const isEstimateStatus = (status) => status === "EST" || status === "PROV";

// A value text with the estimate mark ("e") beside it when the stored status is EST or PROV.
export const markedValue = (text, status) => (isEstimateStatus(status) ? `${text} ${DRAFT_VALUE_ESTIMATE_MARK}` : text);

// Short unit for titles, end labels, tips and table headers; null when none is stored (a unit-less value is a defect, AC-RD-42:
// callers print DRAFT_UNIT_MISSING_SENTENCE, never a bare value and never "n/a"). Rebased: the index text of the base period;
// year-on-year: "%"; the indicator default transform when it is not LEVEL: the stored transform label (transform_options, else
// the transform id) and no unit, because transformed_value has no stored unit (CR-6) and unit_label describes the level; otherwise
// the indicator's stored unit_label, else the series unit_code. CR-5: whether unit_label carries a scale is unconfirmed.
export const isLevelDefault = (indicator) => (indicator?.default_transform ?? "LEVEL") === "LEVEL";
export function shortUnit({indicator, series, column, rebaseBase}) {
  if (rebaseBase != null) return rebaseUnit(rebaseBase);
  if (column === "value_yoy") return "%";
  if (column === "value_default_tf" && !isLevelDefault(indicator)) return transformLabel(indicator, null);
  return indicatorUnit(indicator) ?? seriesUnit(series);
}

// Rows of the table, one per drawn series of the view-model (same order). `model.series[i]` carries the series metadata,
// `model.captions[i]` the stored unit text, reference date and known_at already formatted.
export function aboutSeriesRows(model) {
  return model.series.map((s) => {
    const cap = model.captions.find((c) => c.entity === s.entity);
    const meta = s.meta ?? {};
    const frequency = s.frequency ?? meta.frequency ?? null;
    const last = s.latest;
    return {
      entity: s.entity,
      country: s.name,
      source: orNA(meta.source_name),
      sourceUrl: safeUrl(meta.source_url),
      attribution: orNA(meta.licence_attribution),
      frequency: orNA(frequency),
      unit: orNA(cap?.unit),
      seasonal: orNA(codeText("seasonal", meta.seasonal_adjustment)),
      priceBasis: orNA(meta.price_basis),
      lastPeriod: last ? (periodLabel(cap?.refDate, frequency) ?? cap?.refDate ?? NA) : NA,
      knownAt: last ? orNA(cap?.vintage === "n/a" ? null : cap?.vintage) : NA,
      reestimated: meta.reestimating === true
    };
  });
}

export function aboutSeriesTable(html, model) {
  const rows = aboutSeriesRows(model);
  if (rows.length === 0) return "";
  return html`<section class="mm-about-series" id="about-series"><h3>${DRAFT_ABOUT_SERIES_HEADING}</h3><table id="series-captions"><thead><tr><th scope="col">${C.country}</th><th scope="col">${C.source}</th><th scope="col">${C.attribution}</th><th scope="col">${C.frequency}</th><th scope="col">${C.unit}</th><th scope="col">${C.seasonal}</th><th scope="col">${C.priceBasis}</th><th scope="col">${C.lastPeriod}</th><th scope="col">${C.knownAt}</th><th scope="col">${C.reestimating}</th></tr></thead><tbody>${rows.map(
    (r) => html`<tr data-entity="${r.entity}"><th scope="row">${r.country}</th><td>${r.sourceUrl ? html`<a href="${r.sourceUrl}" rel="noopener">${r.source}</a>` : r.source}</td><td>${r.attribution}</td><td>${r.frequency}</td><td>${r.unit}</td><td>${r.seasonal}</td><td>${r.priceBasis}</td><td>${r.lastPeriod}</td><td>${r.knownAt}</td><td>${r.reestimated ? DRAFT_REESTIMATED_MARK : ""}</td></tr>`
  )}</tbody></table></section>`;
}
