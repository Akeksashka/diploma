// V20 (C3, spec 4, 6.2; AC-V2-41, 42, 43, 44, 45, 87 `p`): the scatter of two indicators. The join is on the identical (entity, period) of two stored series files; a country is a dot
// only when BOTH stored values exist in the chosen period, and every other country is listed with "no value for <indicator>". The two indicators must have the same chosen stored frequency
// (otherwise blocked with the stored reason; no resampling). The period (`p`, one reference period, A1.3) is chosen from the stored common periods; the default is the latest common
// period stored for x and y (no point threshold; the user's decision D1). Each axis is titled with its unit, starts at the data extent (no forced zero), and a zero rule is
// drawn only where the plotted range crosses zero. No regression, trend line or correlation, no third variable in size or colour. Aggregates are excluded. `html` and `Plot` are passed in.
// Display only: stored values are positioned, never transformed.
import {defaultCountryHref} from "./multi-line.js";
import {
  DRAFT_C3_FIGURE_LABEL, DRAFT_C3_MARKS, DRAFT_C3_NO_COMMON, DRAFT_C3_TABLE_CAPTION, DRAFT_COMPARE_CARD_TITLES, DRAFT_COMPARE_CHOOSE_PAIR, DRAFT_NO_ALIGNED, DRAFT_NO_VALUE_FOR, DRAFT_P1A_REFERENCE,
  DRAFT_NOT_STATED, DRAFT_STATE_COLUMN, DRAFT_UNIT_MISSING_SENTENCE, DRAFT_VALUE_HEADER_UNIT, COUNTRY_HEADER, DRAFT_FACT_LABELS, DRAFT_BLOCKED_FIELD_LABELS, DRAFT_BLOCKED_MESSAGE, VIEW_AS_TABLE
} from "./copy.js";
import {buildCaption} from "./caption.js";
import {captionBlock} from "./caption-view.js";
import {blockedState, compatNotes} from "./blocked.js";
import {chosenFrequency, entitySet, isNum, rowsByEntity, seriesMetaFor} from "./compare-data.js";
import {checkCompatible} from "./compat.js";
import {valueText} from "./explorer.js";
import {chartFigure} from "./figure.js";
import {splitByCoverage} from "./filter-model.js";
import {hiddenRowsRegion} from "./hidden-rows.js";
import {periodLabel} from "./period.js";
import {hashPeriod, isEstimateStatus} from "./series-chart.js";
import {sortRows} from "./sort.js";
import {token} from "./tokens.js";
import {valueWithUnit} from "./tip.js";
import {indicatorUnit, seriesUnit} from "./units.js";

export const MAX_LABELS = 8; // spec C3: labels for the highlighted countries only
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// input: x, y (meta/indicators.json rows or null), rowsX, rowsY (normalised series rows), entities, groups, series (meta/series.json), state (x, y, p, f, g, c), knownCutoff.
export function scatterModel({x = null, y = null, rowsX = [], rowsY = [], entities = [], groups = [], series = [], state = {}, knownCutoff = null} = {}) {
  if (!x || !y) return {status: "choose", x, y};
  // With no f, the default is the first stored frequency common to x and y; the pair is blocked on frequency only when no common frequency exists (no resampling).
  const setX = x.frequency_set ?? [];
  const setY = y.frequency_set ?? [];
  const common = setX.filter((q) => setY.includes(q));
  const fx = state.f && common.includes(state.f) ? state.f : (common[0] ?? chosenFrequency(x, state.f ?? null));
  const fy = common.length > 0 ? fx : chosenFrequency(y, state.f ?? null);
  const frequencyCompat = checkCompatible([{frequency: fx}, {frequency: fy}]);
  if (common.length === 0 || frequencyCompat.status === "blocked") return {status: "blocked", x, y, compat: frequencyCompat, frequencies: [fx, fy], blockedMessage: DRAFT_BLOCKED_MESSAGE([DRAFT_BLOCKED_FIELD_LABELS.frequency])};
  const {countries} = entitySet({entities, groups, groupId: state.g ?? null, focusIds: state.c ?? []});
  const byX = rowsByEntity(rowsX, series, x.indicator_id, fx);
  const byY = rowsByEntity(rowsY, series, y.indicator_id, fx);
  const live = (rows) => new Map((rows ?? []).filter((r) => isNum(r.value)).map((r) => [r.end, r]));
  const pairsAt = new Map(); // ms -> [{entity, x row, y row}]
  for (const e of countries) {
    const ax = live(byX.get(e.entity_id));
    const ay = live(byY.get(e.entity_id));
    for (const [ms, rx] of ax) {
      const ry = ay.get(ms);
      if (!ry) continue;
      if (!pairsAt.has(ms)) pairsAt.set(ms, []);
      pairsAt.get(ms).push({e, rx, ry});
    }
  }
  // The stored common periods, newest first; the label of the control is the stored period label, the value the hash form (A1.3).
  const periods = sortRows([...pairsAt.keys()].map((ms) => ({ms, value: hashPeriod(iso(ms), fx), label: periodLabel(iso(ms), fx) ?? iso(ms)})), "ms", {dir: "desc", nameKey: "value"});
  if (periods.length === 0) return {status: "none", x, y, frequency: fx, periods, reason: DRAFT_C3_NO_COMMON};
  const requested = periods.find((p) => p.value === state.p) ?? null; // an invalid or unstored p is absent (A1.3)
  const chosen = requested ?? periods[0]; // the default is the latest common period stored for x and y (no threshold)
  const pairs = pairsAt.get(chosen.ms);
  const ux = indicatorUnit(x) ?? seriesUnit(seriesMetaFor(series, x.indicator_id, pairs[0].e.entity_id, fx));
  const uy = indicatorUnit(y) ?? seriesUnit(seriesMetaFor(series, y.indicator_id, pairs[0].e.entity_id, fy));
  const focus = new Set((state.c ?? []).slice(0, MAX_LABELS));
  const points = sortRows(pairs.map(({e, rx, ry}) => ({
    entityId: e.entity_id,
    name: e.name ?? e.entity_id,
    x: rx.value,
    y: ry.value,
    xText: valueText(rx.value),
    yText: valueText(ry.value),
    ms: chosen.ms,
    period: chosen.label,
    hollow: isEstimateStatus(rx.status) || isEstimateStatus(ry.status),
    focus: focus.has(e.entity_id),
    metaX: seriesMetaFor(series, x.indicator_id, e.entity_id, fx),
    metaY: seriesMetaFor(series, y.indicator_id, e.entity_id, fx)
  })), "name");
  // The countries left out (no stored value of one or both indicators in the chosen period), by the one selection function (A1.4).
  const present = new Set(points.map((p) => p.entityId));
  const rows = countries.map((e) => {
    const lacks = [...(live(byX.get(e.entity_id)).has(chosen.ms) ? [] : [x.name ?? x.indicator_id]), ...(live(byY.get(e.entity_id)).has(chosen.ms) ? [] : [y.name ?? y.indicator_id])];
    const sx = live(byX.get(e.entity_id)).get(chosen.ms);
    const sy = live(byY.get(e.entity_id)).get(chosen.ms);
    return {entityId: e.entity_id, name: e.name ?? e.entity_id, hasBoth: present.has(e.entity_id), periodText: chosen.label, xText: sx ? valueText(sx.value) : null, yText: sy ? valueText(sy.value) : null, reasonSentence: DRAFT_NO_VALUE_FOR(lacks)};
  });
  const split = splitByCoverage(rows, {requireValue: true, hasValue: (r) => r.hasBoth});
  const compatX = checkCompatible(points.map((p) => p.metaX).filter(Boolean));
  const compatY = checkCompatible(points.map((p) => p.metaY).filter(Boolean));
  const blocked = compatX.status === "blocked" || compatY.status === "blocked";
  const range = {from: iso(chosen.ms), to: iso(chosen.ms)};
  return {
    status: blocked ? "blocked-series" : "ok",
    x, y, frequency: fx,
    periods,
    period: chosen,
    defaulted: requested === null,
    points,
    labelled: points.filter((p) => p.focus),
    hidden: split.hidden,
    xUnit: ux,
    yUnit: uy,
    compat: compatX.status === "blocked" ? compatX : compatY,
    compatX,
    compatY,
    crossesZeroX: points.some((p) => p.x < 0) && points.some((p) => p.x > 0),
    crossesZeroY: points.some((p) => p.y < 0) && points.some((p) => p.y > 0),
    captions: {
      x: buildCaption({indicator: x, series: points.map((p) => p.metaX).filter(Boolean), range, knownCutoff, statuses: []}),
      y: buildCaption({indicator: y, series: points.map((p) => p.metaY).filter(Boolean), range, knownCutoff, statuses: []})
    }
  };
}

const axisLabel = (name, unit) => `${name} (${unit || DRAFT_UNIT_MISSING_SENTENCE})`;
const tipOf = (m, p) => [p.name, `${m.x.name}: ${valueWithUnit(p.xText, m.xUnit)}`, `${m.y.name}: ${valueWithUnit(p.yText, m.yUnit)}`, p.period].join("\n");

export function scatterChart(Plot, m) {
  const ink = token("--mm-text");
  const bg = token("--mm-bg");
  const rule = token("--mm-border");
  const solid = m.points.filter((p) => !p.hollow);
  const hollow = m.points.filter((p) => p.hollow);
  return Plot.plot({
    style: {fontSize: "12px", background: "transparent"},
    width: 720,
    height: 460,
    marginLeft: 64,
    marginBottom: 48,
    x: {grid: true, nice: true, label: axisLabel(m.x.name, m.xUnit)},
    y: {grid: true, nice: true, label: axisLabel(m.y.name, m.yUnit)},
    marks: [
      ...(m.crossesZeroX ? [Plot.ruleX([0], {stroke: rule, strokeWidth: 1.5})] : []),
      ...(m.crossesZeroY ? [Plot.ruleY([0], {stroke: rule, strokeWidth: 1.5})] : []),
      Plot.dot(solid, {x: "x", y: "y", r: 4, fill: ink, stroke: ink}),
      Plot.dot(hollow, {x: "x", y: "y", r: 4, fill: bg, stroke: ink, strokeWidth: 2}),
      Plot.dot(m.labelled, {x: "x", y: "y", r: 8, fill: "none", stroke: ink, strokeWidth: 2}),
      Plot.text(m.labelled, {x: "x", y: "y", text: "name", dy: -14, fill: ink, fontWeight: 700}),
      Plot.tip(m.points, Plot.pointer({x: "x", y: "y", title: (p) => tipOf(m, p)}))
    ]
  });
}

// The table alternative: every dot, then the hidden rows with the stored value they do have and the stored reason sentence (spec 7.3).
export const scatterTableRows = (m) => [
  ...m.points.map((p) => ({entityId: p.entityId, name: p.name, period: p.period, x: p.xText, y: p.yText, state: ""})),
  ...m.hidden.map(({row}) => ({entityId: row.entityId, name: row.name, period: row.periodText ?? DRAFT_NOT_STATED, x: row.xText ?? DRAFT_NOT_STATED, y: row.yText ?? DRAFT_NOT_STATED, state: row.reasonSentence || DRAFT_NOT_STATED}))
];

export function scatterTable(html, m, {id}) {
  return html`<details class="mm-view-table" id="${id}-view"><summary>${VIEW_AS_TABLE}</summary><table id="${id}-table"><caption>${DRAFT_C3_TABLE_CAPTION(m.x.name, m.y.name, m.period.label)}</caption><thead><tr><th scope="col">${COUNTRY_HEADER}</th><th scope="col">${DRAFT_FACT_LABELS.refPeriod}</th><th scope="col" class="mm-num">${DRAFT_VALUE_HEADER_UNIT(axisLabel(m.x.name, m.xUnit))}</th><th scope="col" class="mm-num">${DRAFT_VALUE_HEADER_UNIT(axisLabel(m.y.name, m.yUnit))}</th><th scope="col">${DRAFT_STATE_COLUMN}</th></tr></thead><tbody>${scatterTableRows(m).map((r) => html`<tr data-entity="${r.entityId}"><th scope="row">${r.name}</th><td>${r.period}</td><td class="mm-num">${r.x}</td><td class="mm-num">${r.y}</td><td>${r.state}</td></tr>`)}</tbody></table></details>`;
}

const accessors = {label: (r) => r.name, id: (r) => r.entityId, period: (r) => r.periodText, sentence: (r) => r.reasonSentence, href: (r) => `../country/${r.entityId}`};

// The card. `controls`: the control strip node. A model of status "choose", "none" or "blocked" renders its stored message instead of the figure.
export function scatterBlock(html, Plot, m, {countryHref = defaultCountryHref, id = "c3", controls = ""} = {}) {
  const title = html`<h3>${DRAFT_COMPARE_CARD_TITLES.c3}</h3>`;
  const card = (state, body) => html`<div class="mm-compare-card" id="${id}" data-card="c3" data-state="${state}">${title}${controls}${body}</div>`;
  if (m.status === "choose") return card("choose", html`<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_COMPARE_CHOOSE_PAIR}</p>`);
  if (m.status === "blocked") return card("blocked", html`<p class="mm-state mm-state-blocked" data-state="blocked">${m.blockedMessage}</p><ul class="mm-blocked-fields"><li data-field="frequency">${DRAFT_BLOCKED_FIELD_LABELS.frequency}: ${m.frequencies.join(", ")}</li></ul>`);
  if (m.status === "none") return card("empty", html`<p class="mm-state mm-state-empty" data-state="empty">${m.reason}</p>`);
  const region = hiddenRowsRegion(html, m.hidden, {...accessors, href: (r) => countryHref(r.entityId)});
  const reference = html`<p class="mm-note" data-field="reference-period">${DRAFT_P1A_REFERENCE(m.period.label)}</p>`;
  if (m.status === "blocked-series") return card("blocked", html`${reference}${region}${blockedState(html, m.compat)}`);
  const figure = chartFigure(html, {id: `${id}-figure`, label: DRAFT_C3_FIGURE_LABEL(m.x.name, m.xUnit || DRAFT_UNIT_MISSING_SENTENCE, m.y.name, m.yUnit || DRAFT_UNIT_MISSING_SENTENCE, m.period.label), chart: scatterChart(Plot, m)});
  const empty = m.points.length === 0 ? html`<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_NO_ALIGNED}</p>` : "";
  return card("ok", html`${reference}${region}${empty || figure}${empty ? "" : html`<p class="mm-figure-note">${DRAFT_C3_MARKS}</p>`}${compatNotes(html, m.compatX)}${compatNotes(html, m.compatY)}${captionBlock(html, m.captions.x, {id: `${id}-caption-x`})}${captionBlock(html, m.captions.y, {id: `${id}-caption-y`})}${empty ? "" : scatterTable(html, m, {id})}`);
}
