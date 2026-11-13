// V21 (C4, spec 4, 7; AC-V2-46..50, 84, 85): the heatmap of one indicator, countries by period. Rows are countries ordered by the latest stored value (default) or A to Z; the columns are the
// stored periods of ONE frequency inside the Period window, capped per frequency (annual 35, quarterly 40, monthly 36; the latest columns are kept); no resampling. The colour is the
// stored value through a single-hue scale when the displayed range holds no negative value and through a diverging scale with its midpoint at 0 when it holds a negative value (D3); the domain is the displayed
// lowest and highest stored value, stated beside the figure. A cell with no stored value is blank (hatched, never zero, never counted). A row whose stored `is_stale` (scorecard cell)
// is true is hidden by default and listed in the disclosure with reason `stale`; with `stl` it is drawn with a dashed outline round its cells and the text code after its label and is no
// longer in the hidden array (A1.1). A row without a scorecard cell is not flagged and is drawn. `oth` does not apply: the columns are the periods. There is no projection column.
// `html` and `Plot` are passed in. Display only: stored values are positioned and coloured, never transformed.
import {defaultCountryHref} from "./multi-line.js";
import {
  DRAFT_C4_BLANK, DRAFT_C4_FIGURE_LABEL, DRAFT_C4_LEGEND, DRAFT_C4_MARKS, DRAFT_C4_OUTLINE_MARK, DRAFT_C4_SCALE, DRAFT_C4_TABLE_CAPTION, DRAFT_COMPARE_CARD_TITLES, DRAFT_COMPARE_CHOOSE_INDICATOR, DRAFT_COMPARE_CONTROL_LABELS, DRAFT_COMPARE_SORTS, DRAFT_NOT_STATED, DRAFT_NO_ALIGNED,
  DRAFT_REVISIONS_LINK_LABEL, DRAFT_STALE_CODE, DRAFT_STALE_PERIOD, DRAFT_UNIT_MISSING_SENTENCE
} from "./copy.js";
import {blockedState, compatNotes} from "./blocked.js";
import {buildCaption, captionTitle} from "./caption.js";
import {captionBlock} from "./caption-view.js";
import {cellIndex, chosenFrequency, entitySet, isNum, rowsByEntity, seriesMetaFor, statusesOf, valueExtent} from "./compare-data.js";
import {checkCompatible} from "./compat.js";
import {valueText} from "./explorer.js";
import {chartFigure, viewAsTable} from "./figure.js";
import {splitByCoverage, yearOf} from "./filter-model.js";
import {addBlankPattern, blankFill} from "./hatch.js";
import {hiddenRowsRegion} from "./hidden-rows.js";
import {mapCellState, seriesDefinedSet} from "./missing.js";
import {periodLabel} from "./period.js";
import {sortRows} from "./sort.js";
import {token} from "./tokens.js";
import {indicatorUnit, seriesUnit} from "./units.js";

// Window caps per stored frequency (spec C4, AC-V2-49): annual, quarterly and monthly only. The spec states no daily cap, so a daily (or unknown) frequency is not drawn (the empty state).
export const WINDOW_CAPS = Object.freeze({A: 35, Q: 40, M: 36});
export const TEXT_IN_CELL_MAX_COLUMNS = 24; // cell text appears when the cell width permits
export const C4_SORTS = Object.freeze({value: {field: "latest", dir: "desc"}, name: {field: "name", dir: "asc"}});
export const DEFAULT_C4_SORT = "value";
export const c4SortOptions = () => Object.keys(C4_SORTS).map((id) => ({id, label: DRAFT_COMPARE_SORTS[id]}));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const hasWindow = (from, to) => Number.isInteger(from) && Number.isInteger(to);

// The kind of colour scale for the displayed stored range: diverging with the midpoint 0 whenever the range holds a negative value (it crosses 0 or lies wholly below it, decision D3),
// else sequential single-hue (AC-V2-47 as amended).
export const scaleKind = (extent) => (extent !== null && extent.min < 0 ? "diverging" : "sequential");

// Spec 5.2: with a Domain chosen, C4 uses it and the indicator list is limited to it. The rows of C4 are countries, so Domain narrows the indicator, not the rows: an indicator the chosen domain
// does not list (its stored indicator_ids or the indicator's own domain_ids) is not drawn (the Domain control clears such an Indicator on a user change; a hash can still hold the pair).
export function inChosenDomain(indicator, domainId, domains = []) {
  if (!domainId || !indicator) return true;
  const listed = domains.find((d) => d.domain_id === domainId)?.indicator_ids ?? [];
  return listed.includes(indicator.indicator_id) || (indicator.domain_ids ?? []).includes(domainId);
}

// input: indicator, rows (normalised series rows), entities, groups, domains, series, scorecards, state (d, f, g, from, to, stl), sort (a key of C4_SORTS), knownCutoff.
export function timeHeatmapModel({indicator = null, rows = [], entities = [], groups = [], domains = [], series = [], scorecards = {}, state = {}, sort = DEFAULT_C4_SORT, knownCutoff = null} = {}) {
  const outOfDomain = !inChosenDomain(indicator, state.d ?? null, domains);
  const frequency = chosenFrequency(indicator, state.f ?? null);
  const unsupported = !Object.hasOwn(WINDOW_CAPS, frequency ?? "");
  if (outOfDomain || unsupported) {
    rows = [];
    entities = [];
  }
  const id = indicator?.indicator_id ?? null;
  const {countries} = entitySet({entities, groups, groupId: state.g ?? null, focusIds: []});
  const byEntity = rowsByEntity(rows, series, id, frequency);
  const cells = cellIndex(scorecards, indicator);
  const defined = seriesDefinedSet(series);
  const from = state.from ?? null;
  const to = state.to ?? null;
  const showStale = state.stl === true;
  const inWindow = (r) => !hasWindow(from, to) || (yearOf(iso(r.end)) >= from && yearOf(iso(r.end)) <= to);
  // Columns: the stored periods inside the window that any country has a value for, newest WINDOW_CAPS[frequency] kept, oldest first.
  const live = (list) => (list ?? []).filter((r) => isNum(r.value) && inWindow(r));
  const periods = sortRows([...new Set(countries.flatMap((e) => live(byEntity.get(e.entity_id)).map((r) => r.end)))].map((ms) => ({ms})), "ms").map((p) => p.ms);
  const cap = WINDOW_CAPS[frequency] ?? null;
  const columns = (cap === null ? [] : periods.slice(-cap)).map((ms) => ({ms, period: periodLabel(iso(ms), frequency) ?? iso(ms)}));
  const kept = new Set(columns.map((c) => c.ms));
  const items = countries.map((e) => {
    const stored = byEntity.get(e.entity_id) ?? [];
    const own = new Map(live(stored).filter((r) => kept.has(r.end)).map((r) => [r.end, r]));
    const lastStored = stored.filter((r) => isNum(r.value)).at(-1) ?? null;
    const values = columns.map((c) => {
      const r = own.get(c.ms);
      return {entityId: e.entity_id, name: e.name ?? e.entity_id, ms: c.ms, period: c.period, value: r ? r.value : null, text: r ? valueText(r.value) : null, status: r?.status ?? null, blank: !r};
    });
    const latest = [...values].reverse().find((v) => v.value !== null) ?? null;
    const cell = cells.get(e.entity_id) ?? null;
    return {
      entityId: e.entity_id,
      name: e.name ?? e.entity_id,
      meta: seriesMetaFor(series, id, e.entity_id, frequency),
      values,
      latest: latest ? latest.value : null,
      hasValue: latest !== null,
      is_stale: cell?.is_stale === true,
      periodText: lastStored ? periodLabel(iso(lastStored.end), frequency) : null,
      state: mapCellState(cell ?? {indicator_id: id, value: null}, {entityId: e.entity_id, entityKind: "country", domainRanked: false, seriesDefined: defined}),
      label: e.name ?? e.entity_id
    };
  });
  // One selection (A1.4): no stored value in the window is `no_data`; a stale row is `stale` unless `stl` is on (then it is drawn and not in the hidden array).
  const {drawn, hidden} = splitByCoverage(items, {requireValue: true, hasValue: (r) => r.hasValue, hideStale: !showStale});
  const s = C4_SORTS[sort] ?? C4_SORTS[DEFAULT_C4_SORT];
  const rowsShown = sortRows(drawn, s.field, {dir: s.dir}).map((r) => ({...r, stale: showStale && r.is_stale, label: showStale && r.is_stale ? `${r.name} ${DRAFT_STALE_CODE}` : r.name}));
  const cellsShown = rowsShown.flatMap((r) => r.values.map((v) => ({...v, label: r.label, stale: r.stale})));
  const extent = valueExtent(cellsShown.map((c) => c.value));
  const kind = scaleKind(extent);
  const metas = rowsShown.map((r) => r.meta).filter(Boolean);
  const compat = checkCompatible(metas);
  const scaleText = extent === null ? null : DRAFT_C4_SCALE(valueText(extent.min), valueText(extent.max));
  const first = columns[0] ?? null;
  const last = columns.at(-1) ?? null;
  return {
    indicator,
    indicatorId: id,
    outOfDomain,
    unsupported,
    name: indicator?.name ?? id ?? DRAFT_NOT_STATED,
    frequency,
    unit: indicatorUnit(indicator) ?? seriesUnit(metas[0] ?? null),
    cap,
    columns,
    rows: rowsShown,
    cells: cellsShown,
    filled: cellsShown.filter((c) => c.value !== null),
    blanks: cellsShown.filter((c) => c.value === null),
    outlined: cellsShown.filter((c) => c.stale),
    hidden,
    allItems: items,
    extent,
    scaleKind: kind,
    scaleText,
    showText: columns.length <= TEXT_IN_CELL_MAX_COLUMNS,
    sortId: C4_SORTS[sort] ? sort : DEFAULT_C4_SORT,
    showStale,
    metas,
    compat,
    blocked: compat.status === "blocked",
    caption: buildCaption({indicator, series: metas, range: first && last ? {from: iso(first.ms), to: iso(last.ms)} : null, knownCutoff, statuses: statusesOf(cellsShown.map((c) => ({status: c.status}))), scale: scaleText})
  };
}

export const colourScale = (m) => {
  if (m.extent === null) return {};
  if (m.scaleKind === "diverging") return {type: "diverging", pivot: 0, symmetric: false, range: [token("--mm-val-neg"), token("--mm-bg"), token("--mm-val-pos")]};
  return {type: "linear", domain: [m.extent.min, m.extent.max], range: [token("--mm-val-seq-1"), token("--mm-val-seq-2")]};
};

const tipOf = (m, c) => [c.name, c.period, c.value === null ? DRAFT_C4_BLANK : `${c.text} ${m.unit || DRAFT_UNIT_MISSING_SENTENCE}`, ...(c.stale ? [DRAFT_STALE_CODE] : [])].join("\n");

export function timeHeatmapChart(Plot, m, {patternId = "mm-blank-c4"} = {}) {
  const ink = token("--mm-text");
  const bg = token("--mm-bg");
  const labels = m.rows.map((r) => r.label);
  const periods = m.columns.map((c) => c.period);
  const chart = Plot.plot({
    style: {fontSize: "11px", background: "transparent"},
    width: 960,
    marginLeft: 150,
    marginTop: 40,
    marginBottom: 20,
    padding: 0.04,
    x: {type: "band", domain: periods, label: null, axis: "top", tickRotate: m.columns.length > TEXT_IN_CELL_MAX_COLUMNS ? -60 : 0},
    y: {type: "band", domain: labels, label: null},
    color: colourScale(m),
    marks: [
      Plot.cell(m.filled, {x: "period", y: "label", fill: "value"}),
      Plot.cell(m.blanks, {x: "period", y: "label", fill: blankFill(patternId), stroke: bg}),
      ...(m.outlined.length ? [Plot.cell(m.outlined, {x: "period", y: "label", fill: "none", stroke: ink, strokeDasharray: "4 2", strokeWidth: 2})] : []),
      ...(m.showText ? [Plot.text(m.filled, {x: "period", y: "label", text: "text", fill: ink, stroke: bg, strokeWidth: 3, fontSize: 10})] : []),
      Plot.tip(m.cells, Plot.pointer({x: "period", y: "label", title: (c) => tipOf(m, c)}))
    ]
  });
  return addBlankPattern(chart, patternId);
}

// The legend: the lowest and highest displayed stored value at the ends of a ramp (and 0 for the diverging form).
export function timeHeatmapLegend(html, m) {
  if (m.extent === null) return "";
  return html`<div class="mm-c4-legend" data-scale="${m.scaleKind}"><span class="mm-c4-legend-end" data-end="min">${DRAFT_C4_LEGEND.min} ${valueText(m.extent.min)}</span><span class="mm-c4-ramp" data-scale="${m.scaleKind}" aria-hidden="true"></span>${m.scaleKind === "diverging" && m.extent.max > 0 ? html`<span class="mm-c4-legend-mid">0</span>` : ""}<span class="mm-c4-legend-end" data-end="max">${valueText(m.extent.max)} ${DRAFT_C4_LEGEND.max}</span></div>`;
}

// The table alternative rows: every stored cell of the drawn rows, then the hidden rows (their stored points, else one row with the stored reason), as the other cards (7.3).
export function timeHeatmapTableRows(m) {
  const drawn = m.rows.flatMap((r) => r.values.filter((v) => v.value !== null).map((v) => ({entity: r.entityId, name: r.label, date: v.period, valueText: v.text, status: v.status ?? DRAFT_NOT_STATED})));
  const rest = m.hidden.flatMap(({row}) => {
    const pts = row.values.filter((v) => v.value !== null);
    const why = row.is_stale && row.hasValue ? DRAFT_STALE_PERIOD(row.periodText ?? DRAFT_NOT_STATED) : (row.state?.sentence || DRAFT_NOT_STATED);
    return pts.length > 0 ? pts.map((v) => ({entity: row.entityId, name: row.name, date: v.period, valueText: v.text, status: why})) : [{entity: row.entityId, name: row.name, date: row.periodText ?? DRAFT_NOT_STATED, valueText: DRAFT_NOT_STATED, status: why}];
  });
  return [...drawn, ...rest];
}

const accessors = {label: (r) => r.name, id: (r) => r.entityId, period: (r) => r.periodText, sentence: (r) => r.state?.sentence, href: (r) => `../country/${r.entityId}`};

// The card. `controls`: the control strip; `sortControl`: the local sort select. Blocked or empty selections show their stored message and still the disclosure.
export function timeHeatmapBlock(html, Plot, m, {countryHref = defaultCountryHref, id = "c4", controls = "", sortControl = "", revisionsHref = null, patternId = "mm-blank-c4"} = {}) {
  const title = html`<h3>${DRAFT_COMPARE_CARD_TITLES.c4}: ${captionTitle(m.indicator)}</h3>`;
  const region = hiddenRowsRegion(html, m.hidden, {...accessors, href: (r) => countryHref(r.entityId)});
  const link = revisionsHref ? html`<p class="mm-l2-links"><a href="${revisionsHref}" data-link="revisions">${DRAFT_REVISIONS_LINK_LABEL(m.name)}</a></p>` : "";
  const card = (state, body) => html`<div class="mm-compare-card" id="${id}" data-card="c4" data-state="${state}">${title}${controls}${region}${body}</div>`;
  if (m.outOfDomain) return card("empty", html`<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_COMPARE_CHOOSE_INDICATOR}</p>`);
  if (m.blocked) return card("blocked", blockedState(html, m.compat));
  if (m.rows.length === 0) return card("empty", html`<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_NO_ALIGNED}</p>`);
  const first = m.columns[0].period;
  const last = m.columns.at(-1).period;
  const figure = chartFigure(html, {id: `${id}-figure`, label: DRAFT_C4_FIGURE_LABEL(m.name, m.unit || DRAFT_UNIT_MISSING_SENTENCE, first, last), chart: timeHeatmapChart(Plot, m, {patternId})});
  const table = viewAsTable(html, {id: `${id}-table`, title: m.name, rows: timeHeatmapTableRows(m), valueUnit: m.unit || null, n: null, lazy: true});
  return card("ok", html`<p class="mm-compare-sort"><label>${DRAFT_COMPARE_CONTROL_LABELS.sort} ${sortControl}</label></p>${compatNotes(html, m.compat)}${figure}${timeHeatmapLegend(html, m)}<p class="mm-figure-note">${DRAFT_C4_MARKS}</p><p class="mm-figure-note">${DRAFT_C4_OUTLINE_MARK}</p>${captionBlock(html, m.caption, {id: `${id}-caption`})}${table}${link}`);
}
