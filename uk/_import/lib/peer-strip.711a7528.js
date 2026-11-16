// V14 (P1a, spec 3; AC-V2-21, 80, 81, 93): the strip plot of the COUNTRY page. All countries' STORED latest values of one indicator on one axis, the chosen country
// highlighted, the aggregates as dashed reference ticks. Only rows aligned to the printed reference period (the stored `rank_reference_period` of the scorecard) are
// drawn; every other row is in the hidden-rows disclosure unless `oth` is on (then drawn hollow, with its own period in the tip). No median, quartile or other summary is
// drawn or computed. The vertical slot of a country is its place in the ascending code-point order of entity_id: fixed, never by value, never random (A1.7).
// `html` (htl) and `Plot` are passed in; this module imports local modules only.
import {
  COUNTRY_HEADER, DRAFT_BLOCKED_FIELD_LABELS, DRAFT_BLOCKED_MESSAGE, DRAFT_COUNTRY_CARD_TITLES, DRAFT_FACT_LABELS, DRAFT_NOT_STATED, DRAFT_NO_ALIGNED, DRAFT_P1A_AGGREGATES_NOTE, DRAFT_P1A_FIGURE_LABEL, DRAFT_P1A_MARKS, DRAFT_P1A_NO_REFERENCE,
  DRAFT_P1A_REFERENCE, DRAFT_P1A_TABLE_CAPTION, DRAFT_STALE_PERIOD, DRAFT_STATE_COLUMN, DRAFT_UNIT_MISSING_SENTENCE, DRAFT_VALUE_HEADER_UNIT, VIEW_AS_TABLE
} from "./copy.11b4a285.js";
import {checkCompatible} from "./compat.b6f64b1c.js";
import {buildCaption} from "./caption.efba8170.js";
import {captionBlock} from "./caption-view.5fa7e18b.js";
import {valueText} from "./explorer.8bfe86f4.js";
import {chartFigure} from "./figure.39e330d9.js";
import {comparisonSet, splitByCoverage} from "./filter-model.08517389.js";
import {hiddenRowsModel, hiddenRowsRegion} from "./hidden-rows.3a139033.js";
import {mapCellState, seriesDefinedSet} from "./missing.1677e491.js";
import {periodLabel} from "./period.354df927.js";
import {token} from "./tokens.0779967f.js";
import {tipText} from "./tip.5281e05d.js";
import {indicatorUnit, seriesUnit} from "./units.648eaacc.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// input: {indicator (meta/indicators row), scorecard (the domain's scorecard/<domain>.json), domainRanked, entities (meta/entities.json), groups, series (meta/series.json),
// focusId, groupId (hash g), includeOther (hash oth)}. Returns the model of one strip.
export function peerStripModel({indicator, scorecard, domainRanked = true, entities = [], groups = [], series = [], focusId = null, groupId = null, includeOther = false} = {}) {
  const id = indicator?.indicator_id;
  const set = comparisonSet({entities, groups, groupId, focusIds: focusId ? [focusId] : []});
  const members = [...set.countries, ...set.outside, ...set.references];
  const byEntity = new Map((scorecard?.entities ?? []).map((e) => [e.entity_id, e]));
  const seriesDefined = seriesDefinedSet(series);
  const alignment = (scorecard?.alignment ?? []).find((a) => a.indicator_id === id) ?? null;
  const referencePeriod = typeof alignment?.rank_reference_period === "string" ? alignment.rank_reference_period : null;
  const focusMeta = series.find((s) => s.indicator_id === id && s.entity_id === focusId);
  const frequency = focusMeta?.frequency ?? indicator?.frequency_set?.[0] ?? null;
  const rows = members.map((e) => {
    const cell = (byEntity.get(e.entity_id)?.indicators ?? []).find((c) => c.indicator_id === id) ?? {indicator_id: id, value: null};
    const state = mapCellState(cell, {entityId: e.entity_id, entityKind: e.kind, domainRanked, seriesDefined});
    const hasValue = isNum(cell.value) && cell.published !== false && cell.publish_scope !== "excluded";
    const meta = series.find((s) => s.indicator_id === id && s.entity_id === e.entity_id) ?? null;
    return {
      entityId: e.entity_id,
      name: e.name ?? e.entity_id,
      kind: e.kind === "aggregate" ? "aggregate" : "country",
      focus: e.entity_id === focusId,
      value: hasValue ? cell.value : null,
      hasValue,
      is_stale: cell.is_stale === true,
      ref_period_end: hasValue ? cell.ref_period_end ?? null : null,
      alignment: cell.alignment ?? null,
      periodText: hasValue ? periodLabel(cell.ref_period_end, meta?.frequency ?? frequency) : null,
      estimate: hasValue && cell.value_kind === "estimate",
      valueKind: hasValue ? cell.value_kind ?? null : null,
      state,
      meta
    };
  });
  // One selection (A1.4): value required, stale hidden, only the stored reference period drawn (a scorecard without one draws nothing: every row is another period).
  const {drawn, hidden} = splitByCoverage(rows, {requireValue: true, hasValue: (r) => r.hasValue, hideStale: true, referencePeriod: referencePeriod ?? "", includeOtherPeriods: includeOther});
  const countries = drawn.filter((r) => r.kind === "country");
  const ticks = drawn.filter((r) => r.kind === "aggregate");
  // Slots: ascending code-point order of entity_id among the drawn countries.
  const order = countries.map((r) => r.entityId).sort(byCodePoint);
  const slot = new Map(order.map((entityId, i) => [entityId, i]));
  const points = countries.map((r) => ({...r, slot: slot.get(r.entityId), hollow: r.estimate || (referencePeriod === null ? true : r.ref_period_end !== referencePeriod)}));
  const values = drawn.map((r) => r.value);
  // One axis, one unit (spec 6.2 / A1.6): the drawn rows' stored series fields must agree, else the plot is blocked with the stored-field message (no unit conversion, no subset offered: P1a has none).
  const seriesMetas = drawn.map((r) => r.meta).filter(Boolean);
  const compat = checkCompatible(seriesMetas);
  return {
    indicator,
    indicatorId: id,
    name: indicator?.name ?? id ?? DRAFT_NOT_STATED,
    unit: indicatorUnit(indicator) ?? seriesUnit(focusMeta),
    frequency,
    referencePeriod,
    referenceLabel: referencePeriod === null ? null : periodLabel(referencePeriod, frequency) ?? referencePeriod,
    includeOther,
    order,
    points,
    ticks,
    drawn,
    hidden,
    rows,
    crossesZero: values.some((v) => v < 0) && values.some((v) => v > 0),
    seriesMetas,
    compat,
    blocked: compat.status === "blocked"
  };
}

const tipOf = (m, p) => tipText([p.name, p.hasValue ? [valueText(p.value), m.unit ?? DRAFT_UNIT_MISSING_SENTENCE].join(" ") : DRAFT_NOT_STATED, p.periodText ?? DRAFT_NOT_STATED]);

// One Plot. Dots of the countries on a point scale whose domain is the ascending entity_id order; no y axis (the slot carries no value); aggregates as dashed ticks.
export function peerStripChart(Plot, m) {
  const ink = token("--mm-text");
  const bg = token("--mm-bg");
  const muted = token("--mm-text-muted");
  const rule = token("--mm-border");
  const focus = m.points.filter((p) => p.focus);
  const rest = m.points.filter((p) => !p.focus);
  const solid = rest.filter((p) => !p.hollow);
  const hollow = rest.filter((p) => p.hollow);
  return Plot.plot({
    style: {fontSize: "12px", background: "transparent"},
    width: 720,
    height: 300,
    marginLeft: 16,
    marginRight: 24,
    marginBottom: 40,
    x: {grid: true, label: m.unit ?? DRAFT_UNIT_MISSING_SENTENCE},
    y: {axis: null, domain: m.order, type: "point"},
    marks: [
      ...(m.crossesZero ? [Plot.ruleX([0], {stroke: rule, strokeWidth: 1.5})] : []),
      Plot.ruleX(m.ticks, {x: "value", stroke: muted, strokeDasharray: "5 3", strokeWidth: 1.5}),
      Plot.text(m.ticks, {x: "value", text: "name", frameAnchor: "top", dy: 4, fill: muted, textAnchor: "start", dx: 3}),
      Plot.dot(solid, {x: "value", y: "entityId", r: 4, fill: muted, stroke: muted}),
      Plot.dot(hollow, {x: "value", y: "entityId", r: 4, fill: bg, stroke: muted, strokeWidth: 2}),
      Plot.dot(focus, {x: "value", y: "entityId", r: 7, fill: (p) => (p.hollow ? bg : ink), stroke: ink, strokeWidth: 2}),
      Plot.dot(focus, {x: "value", y: "entityId", r: 10, fill: "none", stroke: ink, strokeWidth: 2}),
      Plot.text(focus, {x: "value", y: "entityId", text: "name", dy: -16, fill: ink, fontWeight: 700}),
      Plot.tip(m.points, Plot.pointer({x: "value", y: "entityId", title: (p) => tipOf(m, p)}))
    ]
  });
}

const accessors = {label: (r) => r.name, id: (r) => r.entityId, period: (r) => r.periodText, sentence: (r) => r.state?.sentence, href: (r) => (r.kind === "country" || r.kind === "aggregate" ? `../country/${r.entityId}` : null)};

// The table alternative: every row of the strip, the drawn ones first then the hidden ones with their state sentence (7.3). Value cells carry the unit in the header.
export function peerTableRows(m) {
  const hiddenIds = new Set(m.hidden.map((h) => h.row.entityId));
  const shown = m.rows.filter((r) => !hiddenIds.has(r.entityId));
  const rest = m.rows.filter((r) => hiddenIds.has(r.entityId));
  return [...shown, ...rest].map((r) => ({
    entityId: r.entityId,
    name: r.name,
    reference: r.kind === "aggregate",
    value: r.hasValue ? valueText(r.value) : DRAFT_NOT_STATED,
    period: r.periodText ?? DRAFT_NOT_STATED,
    state: hiddenIds.has(r.entityId) ? (r.is_stale && r.hasValue ? DRAFT_STALE_PERIOD(r.periodText ?? DRAFT_NOT_STATED) : (r.state?.sentence || DRAFT_NOT_STATED)) : (r.valueKind ?? DRAFT_NOT_STATED)
  }));
}

export function peerStripBlock(html, Plot, m, {id, knownCutoff = null} = {}) {
  const title = html`<h4>${DRAFT_COUNTRY_CARD_TITLES.p1}: ${m.name}</h4>`;
  const reference = m.referenceLabel === null ? html`<p class="mm-note" data-field="reference-period">${DRAFT_P1A_NO_REFERENCE}</p>` : html`<p class="mm-note" data-field="reference-period">${DRAFT_P1A_REFERENCE(m.referenceLabel)}</p>`;
  const region = hiddenRowsRegion(html, m.hidden, accessors);
  const rows = peerTableRows(m);
  const unit = m.unit ?? DRAFT_UNIT_MISSING_SENTENCE;
  const table = html`<details class="mm-view-table" id="${id}-view"><summary>${VIEW_AS_TABLE}</summary><table id="${id}-table"><caption>${DRAFT_P1A_TABLE_CAPTION(m.name, m.referenceLabel ?? DRAFT_NOT_STATED)}</caption><thead><tr><th scope="col">${COUNTRY_HEADER}</th><th scope="col">${DRAFT_FACT_LABELS.refPeriod}</th><th scope="col" class="mm-num">${DRAFT_VALUE_HEADER_UNIT(unit)}</th><th scope="col">${DRAFT_STATE_COLUMN}</th></tr></thead><tbody>${rows.map((r) => html`<tr data-entity="${r.entityId}"><th scope="row">${r.name}</th><td>${r.period}</td><td class="mm-num">${r.value}</td><td>${r.state}</td></tr>`)}</tbody></table></details>`;
  if (m.points.length === 0 && m.ticks.length === 0) return html`<div class="mm-p1" id="${id}" data-card="p1">${title}${reference}<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_NO_ALIGNED}</p>${region}${table}</div>`;
  if (m.blocked) return html`<div class="mm-p1" id="${id}" data-card="p1" data-state="blocked">${title}${reference}<p class="mm-state mm-state-blocked" data-state="blocked">${DRAFT_BLOCKED_MESSAGE(m.compat.blocked.map((b) => DRAFT_BLOCKED_FIELD_LABELS[b.field] ?? b.field))}</p>${region}</div>`;
  const figure = chartFigure(html, {id: `${id}-figure`, label: DRAFT_P1A_FIGURE_LABEL(m.name, m.referenceLabel ?? DRAFT_NOT_STATED, unit), chart: peerStripChart(Plot, m)});
  const caption = buildCaption({indicator: m.indicator, series: m.seriesMetas, range: m.referencePeriod ? {from: m.referencePeriod, to: m.referencePeriod} : null, knownCutoff, statuses: m.drawn.some((r) => r.estimate) ? ["EST"] : []});
  return html`<div class="mm-p1" id="${id}" data-card="p1">${title}${reference}${region}${figure}<p class="mm-figure-note">${DRAFT_P1A_MARKS} ${m.ticks.length === 0 ? "" : DRAFT_P1A_AGGREGATES_NOTE}</p>${captionBlock(html, caption, {id: `${id}-caption`})}${table}</div>`;
}

// hiddenRowsModel is re-exported for the unit test that proves the disclosure list is the hidden array of the model.
export const peerHiddenModel = (m) => hiddenRowsModel(m.hidden, accessors);
