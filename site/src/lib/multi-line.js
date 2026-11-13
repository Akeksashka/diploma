// V18 (C1, spec 4, 6.2, 6.3, 6.5, 6.6; AC-V2-30, 31, 32, 33, 34, 71, 73, 75, 76, 82, 86): the multi-country line of one indicator. Up to five coloured, directly labelled lines (the
// countries in `c`, else the default countries DEU, FRA, ITA, ESP, POL present in the stored entities, decision D4), stored aggregates as dashed muted lines, optional muted context lines (`ctx`, default off), one y axis in
// one unit. A selection whose stored series fields differ is blocked with the stored-field message (compat.js; no conversion, no resampling). Stale series are drawn in full
// (A1.1): the last stored point has a square marker and the tip prints "stale". A country with no stored value in the plotted period is not drawn and is listed in the
// hidden-rows disclosure. The display-only rebase to 100 stays in the code but is reachable only when stored metadata says scale_hint = index (A1.5; none exists today).
// `html` (htl) and `Plot` are passed in. Display only: every number is a stored field formatted for print; nothing is computed here.
import {
  DRAFT_C1_FIGURE_LABEL, DRAFT_C1_MARKS, DRAFT_COMPARE_CARD_TITLES, DRAFT_COMPARE_DEFAULT_COUNTRIES, DRAFT_NOT_STATED, DRAFT_NO_ALIGNED, DRAFT_NA_DEFINED_SENTENCE, DRAFT_REBASE_STATEMENT, DRAFT_REVISIONS_LINK_LABEL,
  DRAFT_SERIES_LABEL_PART, DRAFT_STALE_TIP, DRAFT_UNIT_MISSING_SENTENCE, G_STR1_NO_SERIES
} from "./copy.js";
import {buildCaption, captionTitle} from "./caption.js";
import {captionBlock} from "./caption-view.js";
import {DRAFT_HOME_COUNTRIES} from "./home-constants.js";
import {blockedState, compatNotes} from "./blocked.js";
import {alignmentOf, cellIndex, chosenFrequency, entitySet, rowsByEntity, seriesMetaFor, statusesOf} from "./compare-data.js";
import {checkCompatible} from "./compat.js";
import {autoBase, valueText} from "./explorer.js";
import {chartFigure, viewAsTable} from "./figure.js";
import {splitByCoverage, yearOf} from "./filter-model.js";
import {hiddenRowsRegion} from "./hidden-rows.js";
import {periodLabel} from "./period.js";
import {rebase, rebaseOffered} from "./rebase.js";
import {hashPeriod, isEstimateStatus, xDomainOf} from "./series-chart.js";
import {sortRows} from "./sort.js";
import {seriesTipLines, tipText} from "./tip.js";
import {token} from "./tokens.js";
import {indicatorUnit, rebaseUnit, seriesUnit} from "./units.js";
import {seriesDefinedSet} from "./missing.js";

export const MAX_COLOURED = 5; // ADR-025 decision 6
const SERIES_TOKENS = Object.freeze(["--mm-series-1", "--mm-series-2", "--mm-series-3", "--mm-series-4", "--mm-series-5"]);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const hasWindow = (from, to) => Number.isInteger(from) && Number.isInteger(to);

// Display text of a stored value: the stored `published_precision` (a display hint) when it is an integer, else the stored number without float noise.
function shown(value, meta) {
  const p = meta?.published_precision;
  return Number.isInteger(p) && p >= 0 && p <= 20 ? value.toFixed(p) : valueText(value);
}

// input: indicator (meta/indicators.json row), rows (normalised series file rows of the indicator), entities, groups, series (meta/series.json), scorecards ({domain_id: scorecard}),
// state (filter store state: c, g, f, from, to, ctx, rb), knownCutoff (manifest).
export function multiLineModel({indicator = null, rows = [], entities = [], groups = [], series = [], scorecards = {}, state = {}, knownCutoff = null} = {}) {
  const id = indicator?.indicator_id ?? null;
  const frequency = chosenFrequency(indicator, state.f ?? null);
  const {countries, references} = entitySet({entities, groups, groupId: state.g ?? null, focusIds: state.c ?? []});
  const byId = new Map([...countries, ...references].map((e) => [e.entity_id, e]));
  const byEntity = rowsByEntity(rows, series, id, frequency);
  const cells = cellIndex(scorecards, indicator);
  const defined = seriesDefinedSet(series);
  const metaOf = (e) => seriesMetaFor(series, id, e.entity_id, frequency);
  const chosen = (state.c ?? []).map((x) => byId.get(x)).filter(Boolean);
  const chosenCountries = chosen.filter((e) => e.kind !== "aggregate").slice(0, MAX_COLOURED);
  const defaulted = chosen.length === 0;
  // No country chosen (D4): the default countries (home-constants.js), only those present in the stored entities, in that order.
  const highlighted = defaulted ? DRAFT_HOME_COUNTRIES.map((id) => countries.find((e) => e.entity_id === id)).filter(Boolean).slice(0, MAX_COLOURED) : chosenCountries;
  const aggregates = chosen.filter((e) => e.kind === "aggregate");
  const marked = new Set([...highlighted, ...aggregates].map((e) => e.entity_id));
  const context = state.ctx === true ? countries.filter((e) => !marked.has(e.entity_id) && metaOf(e) !== null) : [];
  const from = state.from ?? null;
  const to = state.to ?? null;

  const entry = (e, role, slot = null) => {
    const meta = metaOf(e);
    const stored = (byEntity.get(e.entity_id) ?? []).map((r) => ({ms: r.end, date: new Date(r.end), iso: iso(r.end), value: r.value, status: r.status, knownAt: r.knownAt, loadKind: r.loadKind}));
    const windowed = hasWindow(from, to) ? stored.filter((p) => yearOf(p.iso) >= from && yearOf(p.iso) <= to) : stored;
    const lastStored = stored.filter((p) => p.value !== null).at(-1) ?? null;
    return {entityId: e.entity_id, name: e.name ?? e.entity_id, kind: e.kind === "aggregate" ? "aggregate" : "country", role, slot, meta, windowed, lastStored, stale: cells.get(e.entity_id)?.is_stale === true};
  };
  const entries = [...highlighted.map((e, k) => entry(e, "highlight", k)), ...aggregates.map((e) => entry(e, "aggregate")), ...context.map((e) => entry(e, "context"))];

  // Display-only rebase (A1.5): only when the stored marker holds and a base period is chosen or found; otherwise levels as stored.
  const rebased = rebaseOffered(indicator);
  let baseMs = null;
  if (rebased) {
    const first = entries.find((x) => x.role === "highlight");
    const wanted = first?.windowed.find((p) => p.value !== null && state.rb && hashPeriod(p.iso, frequency) === state.rb);
    baseMs = wanted?.ms ?? autoBase(entries.filter((x) => x.role !== "context").map((x) => ({points: x.windowed})));
  }
  const unit = rebased && baseMs !== null ? rebaseUnit(iso(baseMs)) : (indicatorUnit(indicator) ?? seriesUnit(entries[0]?.meta));
  const lines = entries.map((x) => {
    const pts = rebased && baseMs !== null ? rebase(x.windowed.map((p) => ({...p, period: p.ms})), baseMs) : x.windowed;
    const live = pts.filter((p) => p.value !== null).map((p) => ({...p, entityId: x.entityId, name: x.name, text: rebased && baseMs !== null ? p.value.toFixed(1) : shown(p.value, x.meta), period: periodLabel(p.iso, frequency) ?? p.iso}));
    const byMs = new Map(live.map((p) => [p.ms, p]));
    const points = pts.map((p) => byMs.get(p.ms) ?? {...p, entityId: x.entityId, name: x.name, text: null, period: periodLabel(p.iso, frequency) ?? p.iso});
    const lastLive = live.at(-1) ?? null;
    // The stale point is the last of ALL stored live points, not of the Period window (A1.1): its stored period is always printed; the square is drawn only when it is inside the window.
    const stalePoint = x.stale && x.lastStored !== null ? (byMs.get(x.lastStored.ms) ?? {...x.lastStored, text: rebased && baseMs !== null ? null : shown(x.lastStored.value, x.meta), period: periodLabel(x.lastStored.iso, frequency) ?? x.lastStored.iso}) : null;
    const staleDrawn = stalePoint !== null ? (byMs.get(stalePoint.ms) ?? null) : null;
    return {...x, points, live, lastLive, first: live[0] ?? null, hasValue: live.length > 0, stale: stalePoint !== null, stalePoint, staleDrawn, seasonal: x.meta?.seasonal_adjustment ?? null};
  });

  // One selection (A1.4): a highlighted or aggregate series with no stored value in the plotted period is not drawn and is listed. Context lines are never listed.
  const listed = lines.filter((x) => x.role !== "context").map((x) => ({
    ...x,
    periodText: x.lastStored ? periodLabel(x.lastStored.iso, frequency) : null,
    reasonSentence: defined.has(`${id}|${x.entityId}`) ? DRAFT_NA_DEFINED_SENTENCE : G_STR1_NO_SERIES,
    state: {sentence: defined.has(`${id}|${x.entityId}`) ? DRAFT_NA_DEFINED_SENTENCE : G_STR1_NO_SERIES}
  }));
  const split = splitByCoverage(listed, {requireValue: true, hasValue: (r) => r.hasValue});
  const drawnIds = new Set([...split.drawn.map((r) => r.entityId), ...lines.filter((x) => x.role === "context" && x.hasValue).map((x) => x.entityId)]);
  const drawn = lines.filter((x) => drawnIds.has(x.entityId));
  // The compatibility check runs among the chosen series only (spec C1): muted context lines never block the chart.
  const metas = drawn.filter((x) => x.role !== "context").map((x) => x.meta).filter(Boolean);
  const compat = checkCompatible(metas);
  const live = drawn.flatMap((x) => x.live);
  const ordered = sortRows(live.map((p) => ({ms: p.ms, iso: p.iso})), "ms");
  const lastPoints = drawn.filter((x) => x.role !== "context").map((x) => x.lastLive).filter(Boolean);
  const plotted = drawn.filter((x) => x.role !== "context");
  const alignment = alignmentOf(scorecards, indicator);
  return {
    indicator,
    indicatorId: id,
    name: indicator?.name ?? id ?? DRAFT_NOT_STATED,
    frequency,
    unit,
    from,
    to,
    defaulted,
    entries: lines,
    drawn,
    plotted,
    hidden: split.hidden,
    live,
    lastPoints,
    blocked: compat.status === "blocked",
    marked: compat.status === "marked",
    compat,
    metas,
    crossesZero: live.some((p) => p.value < 0) && live.some((p) => p.value > 0),
    rebased: rebased && baseMs !== null,
    baseIso: baseMs === null ? null : iso(baseMs),
    domainId: alignment.domainId,
    caption: buildCaption({indicator, series: metas, range: ordered.length ? {from: ordered[0].iso, to: ordered.at(-1).iso} : null, knownCutoff, statuses: statusesOf(live)})
  };
}

// The tip of a plotted point: name, period label per stored frequency, value with unit, EST/PROV line, stored seasonal adjustment, "stale" with the stored period on the
// last point of a stale series, known_at line.
export function lineTipLines(m, line, p) {
  const base = seriesTipLines({name: line.name, ms: p.ms, text: p.text, status: p.status, knownAt: p.knownAt}, {name: line.name, frequency: m.frequency, unit: m.unit});
  const extra = [...(line.seasonal ? [line.seasonal] : []), ...(line.stale && p === line.staleDrawn ? [DRAFT_STALE_TIP(line.stalePoint.period)] : [])];
  return [...base.slice(0, -1), ...extra, base.at(-1)];
}

// The colour domain and range: one stored entity per colour, the five series tokens in order of the highlighted slots.
export const colourOf = (line) => (line.slot === null ? null : SERIES_TOKENS[line.slot]);

export function multiLineChart(Plot, m) {
  const ink = token("--mm-text");
  const bg = token("--mm-bg");
  const muted = token("--mm-text-muted");
  const light = token("--mm-border");
  const hi = m.plotted.filter((x) => x.role === "highlight");
  const agg = m.plotted.filter((x) => x.role === "aggregate");
  const ctx = m.drawn.filter((x) => x.role === "context");
  const tipPoints = m.drawn.flatMap((line) => line.live.map((p) => ({...p, tip: tipText(lineTipLines(m, line, p))})));
  const sparse = m.frequency !== "M";
  const dots = (lines, hollow) => lines.flatMap((x) => x.live.filter((p) => isEstimateStatus(p.status) === hollow && (sparse || p === x.lastLive) && p !== x.staleDrawn).map((p) => ({...p, series: x.entityId})));
  const colourDomain = hi.map((x) => x.entityId);
  const colourRange = hi.map((x) => token(colourOf(x)));
  const staleDots = m.plotted.filter((x) => x.staleDrawn).map((x) => ({...x.staleDrawn, series: x.entityId}));
  return Plot.plot({
    style: {fontSize: "12px", background: "transparent"},
    width: 960,
    height: 420,
    marginLeft: 56,
    marginRight: 150,
    marginBottom: 30,
    x: {type: "utc", label: null, ticks: 6, ...(xDomainOf(m.from, m.to) ? {domain: xDomainOf(m.from, m.to)} : {})},
    y: {grid: true, label: m.unit || DRAFT_UNIT_MISSING_SENTENCE},
    color: {domain: colourDomain, range: colourRange},
    marks: [
      ...(m.crossesZero ? [Plot.ruleY([0], {stroke: light, strokeWidth: 1.5})] : []),
      ...(ctx.length ? [Plot.line(ctx.flatMap((x) => x.points.filter((p) => p.value !== null)), {x: "date", y: "value", z: "entityId", stroke: light, strokeOpacity: 0.5, strokeWidth: 1, clip: true})] : []),
      ...(agg.length ? [Plot.line(agg.flatMap((x) => x.points), {x: "date", y: "value", z: "entityId", defined: (p) => p.value !== null, stroke: muted, strokeDasharray: "5 3", strokeWidth: 1.5, clip: true})] : []),
      Plot.line(hi.flatMap((x) => x.points), {x: "date", y: "value", z: "entityId", stroke: "entityId", defined: (p) => p.value !== null, strokeWidth: 2, clip: true}),
      Plot.dot(dots(hi, false), {x: "date", y: "value", r: 3, stroke: "series", fill: "series", clip: true}),
      Plot.dot(dots(hi, true), {x: "date", y: "value", r: 4, stroke: "series", strokeWidth: 2, fill: bg, clip: true}),
      Plot.dot(staleDots, {x: "date", y: "value", symbol: "square", r: 6, stroke: ink, strokeWidth: 2, fill: ink}),
      Plot.text(m.lastPoints, {x: "date", y: "value", text: "name", dx: 8, textAnchor: "start", fill: (p) => (colourDomain.includes(p.entityId) ? token(colourOf(hi.find((x) => x.entityId === p.entityId))) : muted), fontWeight: 600}),
      Plot.tip(tipPoints, Plot.pointer({x: "date", y: "value", title: "tip"}))
    ].filter(Boolean)
  });
}

export const multiLineFigureLabel = (m) => DRAFT_C1_FIGURE_LABEL(m.name, m.unit || DRAFT_UNIT_MISSING_SENTENCE, m.plotted.map((x) => DRAFT_SERIES_LABEL_PART(x.name, x.first.period, x.lastLive.period, `${x.lastLive.text} ${m.unit || DRAFT_UNIT_MISSING_SENTENCE}`)));

// The "View as table" rows: every plotted point of every drawn line (a stored null is not a point), the stored status or the "not stated" marker, then the hidden rows
// (one row each with the stored reason sentence; spec 7.3).
export const multiLineTableRows = (m) => [
  ...m.drawn.flatMap((x) => x.live.map((p) => ({entity: x.entityId, name: x.name, date: p.period, valueText: p.text, status: p.status ?? DRAFT_NOT_STATED}))),
  ...m.hidden.map(({row}) => ({entity: row.entityId, name: row.name, date: row.periodText ?? DRAFT_NOT_STATED, valueText: DRAFT_NOT_STATED, status: row.reasonSentence || DRAFT_NOT_STATED}))
];

export const defaultCountryHref = (id) => `../country/${id}`;
const accessors = {label: (r) => r.name, id: (r) => r.entityId, period: (r) => r.periodText, sentence: (r) => r.reasonSentence, href: (r) => `../country/${r.entityId}`};

// The card: title (indicator name and stored unit_label), controls slot, hidden-rows region, the figure or the blocked or empty message, marks note, caption, table, revisions link.
export function multiLineBlock(html, Plot, m, {countryHref = defaultCountryHref, id = "c1", controls = "", revisionsHref = null} = {}) {
  const title = html`<h3>${DRAFT_COMPARE_CARD_TITLES.c1}: ${captionTitle(m.indicator)}</h3>`;
  const region = hiddenRowsRegion(html, m.hidden, {...accessors, href: (r) => countryHref(r.entityId)});
  const note = m.defaulted ? html`<p class="mm-note" data-field="default-countries">${DRAFT_COMPARE_DEFAULT_COUNTRIES}</p>` : "";
  const link = revisionsHref ? html`<p class="mm-l2-links"><a href="${revisionsHref}" data-link="revisions">${DRAFT_REVISIONS_LINK_LABEL(m.name)}</a></p>` : "";
  if (m.blocked) return html`<div class="mm-compare-card" id="${id}" data-card="c1" data-state="blocked">${title}${controls}${region}${blockedState(html, m.compat)}</div>`;
  if (m.plotted.length === 0) return html`<div class="mm-compare-card" id="${id}" data-card="c1" data-state="empty">${title}${controls}${note}${region}<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_NO_ALIGNED}</p></div>`;
  const figure = chartFigure(html, {id: `${id}-figure`, label: multiLineFigureLabel(m), chart: multiLineChart(Plot, m)});
  const seasonal = compatNotes(html, m.compat);
  const statement = m.rebased && m.baseIso ? html`<p class="mm-note" id="${id}-rebase-statement">${DRAFT_REBASE_STATEMENT(m.baseIso)}</p>` : "";
  const table = viewAsTable(html, {id: `${id}-table`, title: m.name, rows: multiLineTableRows(m), valueUnit: m.unit || null, n: null, lazy: true});
  return html`<div class="mm-compare-card" id="${id}" data-card="c1">${title}${controls}${note}${region}${seasonal}${statement}${figure}<p class="mm-figure-note">${DRAFT_C1_MARKS}</p>${captionBlock(html, m.caption, {id: `${id}-caption`})}${table}${link}</div>`;
}
