// V19 (C2, spec 4, 6.2, 6.3, 7; AC-V2-35, 36, 37, 38, 80, 81): the ranked bar of the latest aligned period. Horizontal bars with a zero baseline and a neutral fill, ordered by a
// stored field (the stored value, A to Z, or the stored percentile only while pc is on). Only rows aligned to the printed stored `rank_reference_period` are drawn; every other
// row (stale, another period, no value, another frequency) is in the hidden-rows disclosure unless `oth` is on, when another period is drawn hollow with its own period in the
// label. Aggregates sit under the countries as dashed reference rows. There is no total, mean or rank row; the percentile column and bin chip exist only with pc. A selection
// whose stored series fields differ is blocked with the stored-field message. `html` (htl) and `Plot` are passed in. Display only: nothing is computed here.
import {defaultCountryHref} from "./multi-line.b1a02a4f.js";
import {
  COUNTRY_HEADER, DRAFT_C2_FIGURE_LABEL, DRAFT_C2_MARKS, DRAFT_C2_NO_RANK_REFERENCE, DRAFT_C2_TABLE_CAPTION, DRAFT_COMPARE_CARD_TITLES, DRAFT_COMPARE_CONTROL_LABELS, DRAFT_COMPARE_SORTS, DRAFT_FACT_LABELS, DRAFT_NOT_STATED, DRAFT_NO_ALIGNED, DRAFT_P1A_NO_REFERENCE,
  DRAFT_P1A_REFERENCE, DRAFT_REVISIONS_LINK_LABEL, DRAFT_STALE_PERIOD, DRAFT_STATE_COLUMN, DRAFT_UNIT_MISSING_SENTENCE, DRAFT_VALUE_HEADER_UNIT, PERCENTILE_COLUMN_LABEL, VIEW_AS_TABLE
} from "./copy.11b4a285.js";
import {binLabel, binOf} from "./bins.04d14116.js";
import {blockedState, compatNotes} from "./blocked.83709a6b.js";
import {buildCaption, captionTitle} from "./caption.efba8170.js";
import {captionBlock} from "./caption-view.5fa7e18b.js";
import {alignmentOf, cellIndex, chosenFrequency, entitySet, isNum} from "./compare-data.27349a39.js";
import {checkCompatible} from "./compat.b6f64b1c.js";
import {valueText} from "./explorer.8bfe86f4.js";
import {chartFigure} from "./figure.39e330d9.js";
import {splitByCoverage} from "./filter-model.08517389.js";
import {hiddenRowsRegion} from "./hidden-rows.3a139033.js";
import {mapCellState, seriesDefinedSet} from "./missing.1677e491.js";
import {periodLabel} from "./period.354df927.js";
import {formatPercentile} from "./scorecard.7832fb4d.js";
import {sortRows} from "./sort.6c0c3800.js";
import {token} from "./tokens.0779967f.js";
import {valueWithUnit} from "./tip.5281e05d.js";
import {indicatorUnit, seriesUnit} from "./units.648eaacc.js";
import {i18n} from "./i18n.4f9e47d5.js";
const X = (key, params) => i18n.t(key, params);

export const BAR_LIST_SORTS = Object.freeze({value: {field: "value", dir: "desc"}, name: {field: "name", dir: "asc"}, percentile: {field: "percentile", dir: "desc"}});
export const DEFAULT_BAR_LIST_SORT = "value";
export const barListSortOptions = (percentile) => Object.keys(BAR_LIST_SORTS).filter((k) => k !== "percentile" || percentile === true).map((id) => ({id, label: DRAFT_COMPARE_SORTS[id]}));

// input: indicator, scorecards ({domain_id: scorecard}), entities, groups, series (meta/series.json), state (g, c, f, pc, oth), sort (a key of BAR_LIST_SORTS), knownCutoff.
export function barListModel({indicator = null, scorecards = {}, entities = [], groups = [], series = [], state = {}, sort = DEFAULT_BAR_LIST_SORT, knownCutoff = null} = {}) {
  const id = indicator?.indicator_id ?? null;
  const {countries, references} = entitySet({entities, groups, groupId: state.g ?? null, focusIds: state.c ?? []});
  const cells = cellIndex(scorecards, indicator);
  const {alignment, ranked: domainRanked} = alignmentOf(scorecards, indicator);
  const seriesDefined = seriesDefinedSet(series);
  const referencePeriod = typeof alignment?.rank_reference_period === "string" ? alignment.rank_reference_period : null;
  const frequency = state.f ? chosenFrequency(indicator, state.f) : null;
  const percentile = state.pc === true;
  const rows = [...countries, ...references].map((e) => {
    const cell = cells.get(e.entity_id) ?? {indicator_id: id, value: null};
    const meta = series.find((s) => s.series_id === cell.series_id && s.indicator_id === id) ?? series.find((s) => s.indicator_id === id && s.entity_id === e.entity_id) ?? null;
    const hasValue = isNum(cell.value) && cell.published !== false && cell.publish_scope !== "excluded";
    const entityKind = e.kind === "aggregate" ? "aggregate" : "country";
    const p = hasValue && isNum(cell.percentile) ? cell.percentile : null;
    return {
      entityId: e.entity_id,
      name: e.name ?? e.entity_id,
      kind: entityKind,
      value: hasValue ? cell.value : null,
      hasValue,
      is_stale: cell.is_stale === true,
      ref_period_end: hasValue ? (cell.ref_period_end ?? null) : null,
      alignment: cell.alignment ?? null,
      periodText: hasValue ? periodLabel(cell.ref_period_end, meta?.frequency) : null,
      estimate: hasValue && cell.value_kind === "estimate",
      valueKind: hasValue ? (cell.value_kind ?? null) : null,
      percentile: p,
      percentileText: p === null ? null : formatPercentile(p),
      bin: p === null ? null : binOf(p),
      frequency: meta?.frequency ?? null,
      state: mapCellState(cell, {entityId: e.entity_id, entityKind, domainRanked, seriesDefined}),
      meta
    };
  });
  // One selection (A1.4). A value is required (no_data); stale rows are hidden (a snapshot chart); only the stored reference period is drawn (other_period) unless oth is on;
  // a row of another stored frequency than the Frequency control is `other`. A scorecard with no stored reference period draws nothing (D2: the sentence DRAFT_C2_NO_RANK_REFERENCE; `oth` does not apply; the table still lists every row).
  const {drawn, hidden} = splitByCoverage(rows, {requireValue: true, hasValue: (r) => r.hasValue, hideStale: true, referencePeriod: referencePeriod ?? "", includeOtherPeriods: state.oth === true && referencePeriod !== null, isOther: (r) => frequency !== null && r.frequency !== frequency});
  const s = BAR_LIST_SORTS[sort === "percentile" && !percentile ? DEFAULT_BAR_LIST_SORT : sort] ?? BAR_LIST_SORTS[DEFAULT_BAR_LIST_SORT];
  const order = (list) => sortRows(list, s.field, {dir: s.dir});
  const withCountry = order(drawn.filter((r) => r.kind === "country"));
  const reference = order(drawn.filter((r) => r.kind === "aggregate"));
  const bars = [...withCountry, ...reference].map((r) => ({...r, other: referencePeriod === null ? true : r.ref_period_end !== referencePeriod, label: referencePeriod === null || r.ref_period_end !== referencePeriod ? `${r.name} (${r.periodText || DRAFT_NOT_STATED})` : r.name}));
  const metas = bars.map((r) => r.meta).filter(Boolean);
  const compat = checkCompatible(metas);
  const label = referenceText(referencePeriod, frequency ?? chosenFrequency(indicator, null));
  return {
    indicator,
    indicatorId: id,
    name: indicator?.name ?? id ?? DRAFT_NOT_STATED,
    unit: indicatorUnit(indicator) ?? seriesUnit(metas[0] ?? null),
    sortId: Object.keys(BAR_LIST_SORTS).find((k) => BAR_LIST_SORTS[k] === s),
    percentile,
    referencePeriod,
    noReference: referencePeriod === null, // D2: an empty chart and a plain sentence; no fallback period is chosen (oth does not apply either)
    referenceLabel: label,
    rows,
    bars,
    countries: withCountry,
    references: reference,
    hidden,
    metas,
    compat,
    blocked: compat.status === "blocked",
    crossesZero: bars.some((r) => r.value < 0), // a bar below the zero baseline: the zero rule is drawn in ink (spec 6.3); with none it is the quiet baseline
    domainId: indicator?.domain_ids?.[0] ?? null,
    caption: buildCaption({indicator, series: metas, range: referencePeriod ? {from: referencePeriod, to: referencePeriod} : null, knownCutoff, statuses: bars.some((r) => r.estimate) ? ["EST"] : []})
  };
}

// The reference period as printed: the stored period in the stored frequency's label form, or null when the scorecard states none.
function referenceText(referencePeriod, frequency) {
  return referencePeriod === null ? null : (periodLabel(referencePeriod, frequency) ?? referencePeriod);
}

const tipOf = (m, r) => [r.name, r.hasValue ? valueWithUnit(valueText(r.value), m.unit) : DRAFT_NOT_STATED, r.periodText ?? DRAFT_NOT_STATED, ...(r.estimate ? [X("TIP_STATUS.EST")] : [])].join("\n");

export function barListChart(Plot, m) {
  const ink = token("--mm-text");
  const bg = token("--mm-bg");
  const fill = token("--mm-text-muted");
  const rule = token("--mm-border");
  const countries = m.bars.filter((r) => r.kind === "country");
  const refs = m.bars.filter((r) => r.kind === "aggregate");
  const solid = countries.filter((r) => !r.other && !r.estimate);
  const hollow = countries.filter((r) => r.other || r.estimate);
  return Plot.plot({
    style: {fontSize: "12px", background: "transparent"},
    width: 960,
    marginLeft: 190,
    marginRight: m.percentile ? 190 : 90,
    marginBottom: 36,
    x: {grid: true, label: m.unit || DRAFT_UNIT_MISSING_SENTENCE},
    y: {label: null, domain: m.bars.map((r) => r.label), type: "band"},
    marks: [
      Plot.barX(solid, {y: "label", x: "value", fill, insetTop: 2, insetBottom: 2}),
      Plot.barX(hollow, {y: "label", x: "value", fill: bg, stroke: fill, strokeWidth: 2, insetTop: 2, insetBottom: 2}),
      Plot.barX(refs, {y: "label", x: "value", fill: (r) => (r.other ? bg : fill), fillOpacity: (r) => (r.other ? 1 : 0.5), stroke: ink, strokeWidth: (r) => (r.other ? 2 : 1), strokeDasharray: "4 3", insetTop: 2, insetBottom: 2}), // another period: hollow like a country row, dashed as a reference row
      Plot.ruleX([0], {stroke: m.crossesZero ? ink : rule, strokeWidth: 1.5}),
      // dx and textAnchor are constants in Plot 0.6 (a function gives translate(NaN, ...)): the label of a bar below zero is placed just right of the zero rule.
      Plot.text(m.bars, {y: "label", x: (r) => (r.value < 0 ? 0 : r.value), text: (r) => valueText(r.value), dx: 4, textAnchor: "start", fill: ink}),
      ...(m.percentile ? [Plot.text(m.bars, {y: "label", frameAnchor: "right", dx: 12, textAnchor: "start", text: (r) => (r.percentileText === null ? DRAFT_NOT_STATED : `${r.percentileText} (${binLabel(r.bin) || DRAFT_NOT_STATED})`), fill: ink})] : []),
      Plot.tip(m.bars, Plot.pointer({y: "label", x: "value", title: (r) => tipOf(m, r)}))
    ]
  });
}

const accessors = {label: (r) => r.name, id: (r) => r.entityId, period: (r) => r.periodText, sentence: (r) => r.state?.sentence, href: (r) => `../country/${r.entityId}`};

// The table alternative: every row of the comparison set, the drawn ones first, then the hidden ones with their stored state (7.3).
export function barListTableRows(m) {
  const hiddenIds = new Set(m.hidden.map((h) => h.row.entityId));
  const shown = m.rows.filter((r) => !hiddenIds.has(r.entityId));
  const rest = m.rows.filter((r) => hiddenIds.has(r.entityId));
  return [...shown, ...rest].map((r) => ({
    entityId: r.entityId,
    name: r.name,
    value: r.hasValue ? valueText(r.value) : DRAFT_NOT_STATED,
    period: r.periodText ?? DRAFT_NOT_STATED,
    percentile: r.percentileText ?? DRAFT_NOT_STATED,
    state: hiddenIds.has(r.entityId) ? (r.is_stale && r.hasValue ? DRAFT_STALE_PERIOD(r.periodText ?? DRAFT_NOT_STATED) : (r.state?.sentence || DRAFT_NOT_STATED)) : (r.hasValue ? (r.valueKind ?? DRAFT_NOT_STATED) : (r.state?.sentence || DRAFT_NOT_STATED))
  }));
}

export function barListTable(html, m, {id}) {
  const rows = barListTableRows(m);
  const unit = m.unit ?? DRAFT_UNIT_MISSING_SENTENCE;
  return html`<details class="mm-view-table" id="${id}-view"><summary>${VIEW_AS_TABLE}</summary><table id="${id}-table"><caption>${DRAFT_C2_TABLE_CAPTION(m.name, m.referenceLabel ?? DRAFT_NOT_STATED)}</caption><thead><tr><th scope="col">${COUNTRY_HEADER}</th><th scope="col">${DRAFT_FACT_LABELS.refPeriod}</th><th scope="col" class="mm-num">${DRAFT_VALUE_HEADER_UNIT(unit)}</th>${m.percentile ? html`<th scope="col" class="mm-num">${PERCENTILE_COLUMN_LABEL}</th>` : ""}<th scope="col">${DRAFT_STATE_COLUMN}</th></tr></thead><tbody>${rows.map((r) => html`<tr data-entity="${r.entityId}"><th scope="row">${r.name}</th><td>${r.period}</td><td class="mm-num">${r.value}</td>${m.percentile ? html`<td class="mm-num">${r.percentile}</td>` : ""}<td>${r.state}</td></tr>`)}</tbody></table></details>`;
}

// The card. `controls`: the control strip node; `sortControl`: the local sort select (not a hash key). The percentile column and chip exist only while m.percentile.
export function barListBlock(html, Plot, m, {countryHref = defaultCountryHref, id = "c2", controls = "", sortControl = "", revisionsHref = null} = {}) {
  const title = html`<h3>${DRAFT_COMPARE_CARD_TITLES.c2}: ${captionTitle(m.indicator)}</h3>`;
  const reference = m.referenceLabel === null ? html`<p class="mm-note" data-field="reference-period">${DRAFT_P1A_NO_REFERENCE}</p>` : html`<p class="mm-note" data-field="reference-period">${DRAFT_P1A_REFERENCE(m.referenceLabel)}</p>`;
  const region = hiddenRowsRegion(html, m.hidden, {...accessors, href: (r) => countryHref(r.entityId)});
  const link = revisionsHref ? html`<p class="mm-l2-links"><a href="${revisionsHref}" data-link="revisions">${DRAFT_REVISIONS_LINK_LABEL(m.name)}</a></p>` : "";
  const table = barListTable(html, m, {id});
  if (m.bars.length === 0) return html`<div class="mm-compare-card" id="${id}" data-card="c2" data-state="empty">${title}${controls}${m.noReference ? "" : reference}${region}<p class="mm-state mm-state-empty" data-state="empty">${m.noReference ? DRAFT_C2_NO_RANK_REFERENCE : DRAFT_NO_ALIGNED}</p>${table}</div>`;
  if (m.blocked) return html`<div class="mm-compare-card" id="${id}" data-card="c2" data-state="blocked">${title}${controls}${reference}${region}${blockedState(html, m.compat)}${table}</div>`;
  const figure = chartFigure(html, {id: `${id}-figure`, label: DRAFT_C2_FIGURE_LABEL(m.name, m.referenceLabel ?? DRAFT_NOT_STATED, m.unit ?? DRAFT_UNIT_MISSING_SENTENCE), chart: barListChart(Plot, m)});
  return html`<div class="mm-compare-card" id="${id}" data-card="c2" data-pc="${m.percentile}">${title}${controls}${reference}${region}<p class="mm-compare-sort"><label>${DRAFT_COMPARE_CONTROL_LABELS.sort} ${sortControl}</label></p>${compatNotes(html, m.compat)}${figure}<p class="mm-figure-note">${DRAFT_C2_MARKS}</p>${captionBlock(html, m.caption, {id: `${id}-caption`})}${table}${link}</div>`;
}
