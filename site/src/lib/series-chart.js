// V12 / V13 (spec L1, L2, 6.3, 6.5, 6.8; AC-V2-14..20, 72, 73, 75, 86): one line of one indicator for one country, as a small panel (L1 facet) or the expanded
// long line (L2). Pure model plus the Plot drawing and the figure block. Stored values only: nothing is computed here. A value is plotted as stored (a null
// value is a gap, never bridged); the only transform is the display-only rebase to 100, offered only when stored metadata says scale_hint = index (A1.5; today's
// export has no such field, so the control is absent). Observed points are solid, EST/PROV hollow, the last point of a stale series is a square (A1.1; no
// dash, no hatch), a zero rule is drawn only when the plotted values cross zero. One Plot per panel: Plot facets share one y scale (V1 finding), so panels
// with different units never share an axis. `html` (htl) and `Plot` are passed in; this module imports local modules only.
import {DRAFT_COUNTRY_CARD_TITLES, DRAFT_NOT_STATED, DRAFT_REBASE_STATEMENT, DRAFT_REVISIONS_LINK_LABEL, DRAFT_STALE_CODE, DRAFT_STALE_TIP, DRAFT_UNIT_MISSING_SENTENCE, REBASE_TOGGLE_LABEL} from "./copy.js";
import {buildCaption} from "./caption.js";
import {captionBlock} from "./caption-view.js";
import {autoBase, valueText} from "./explorer.js";
import {chartFigure, seriesFigureLabel, viewAsTable} from "./figure.js";
import {yearOf} from "./filter-model.js";
import {periodLabel} from "./period.js";
import {rebase, rebaseOffered} from "./rebase.js";
import {sortRows} from "./sort.js";
import {seriesTipLines, tipText} from "./tip.js";
import {token} from "./tokens.js";
import {indicatorUnit, rebaseUnit, seriesUnit} from "./units.js";
import {codeText, unitLabelText, xTickFormat} from "./code-text.js";

export const isEstimateStatus = (s) => s === "EST" || s === "PROV";
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const present = (v) => v !== null && v !== undefined && v !== "";
const hasWindow = (from, to) => Number.isInteger(from) && Number.isInteger(to);

// The hash form of a period (A1.3): annual YYYY, quarterly YYYY-Qn, monthly YYYY-MM. A label of period.js with a space is the quarterly form.
export function hashPeriod(isoDate, frequency) {
  const label = periodLabel(isoDate, frequency);
  return label === null ? null : label.replace(" ", "-");
}

// Display text of a stored value: the stored `published_precision` (a display hint) when it is an integer, else the stored number without float noise.
function shown(value, meta) {
  const p = meta?.published_precision;
  return Number.isInteger(p) && p >= 0 && p <= 20 ? value.toFixed(p) : valueText(value);
}

// input: rows (series file rows after explorer.js normalisation: entity, seriesId, end, frequency, value, status, knownAt, loadKind), entityId, entityName,
// meta (the stored meta/series.json row), indicator (meta/indicators.json row), stale (stored is_stale of the scorecard cell), from/to (Period years: they clip the
// x-domain, the stored points outside are not drawn), knownCutoff (manifest), rb (stored-format base period; used only when rebaseOffered).
export function seriesFacet({rows = [], entityId, entityName = null, meta = null, indicator = null, stale = false, from = null, to = null, knownCutoff = null, rb = null} = {}) {
  const own = rows.filter((r) => r.entity === entityId);
  const byId = own.filter((r) => meta?.series_id !== undefined && r.seriesId === meta.series_id);
  const chosen = sortRows(byId.length > 0 ? byId : own.filter((r) => !meta?.frequency || r.frequency === meta.frequency), "end");
  const frequency = meta?.frequency ?? chosen[0]?.frequency ?? null;
  const all = chosen.map((r) => ({ms: r.end, date: new Date(r.end), iso: iso(r.end), value: r.value, status: r.status, knownAt: r.knownAt, loadKind: r.loadKind}));
  const windowed = hasWindow(from, to) ? all.filter((p) => yearOf(p.iso) >= from && yearOf(p.iso) <= to) : all;
  const allLive = all.filter((p) => p.value !== null);
  const rebased = rebaseOffered(indicator) && present(rb);
  let points = windowed;
  let baseIso = null;
  if (rebased && allLive.length > 0) {
    const wanted = windowed.find((p) => p.value !== null && hashPeriod(p.iso, frequency) === rb);
    const baseMs = wanted?.ms ?? autoBase([{points: windowed.map((p) => ({...p}))}]);
    baseIso = baseMs === null ? null : iso(baseMs);
    points = baseMs === null ? [] : rebase(windowed.map((p) => ({...p, period: p.ms})), baseMs);
  }
  const live = points.filter((p) => p.value !== null).map((p) => ({...p, text: rebased ? p.value.toFixed(1) : shown(p.value, meta), period: periodLabel(p.iso, frequency) ?? p.iso}));
  const byMs = new Map(live.map((p) => [p.ms, p]));
  const plotted = points.map((p) => byMs.get(p.ms) ?? {...p, text: null, period: periodLabel(p.iso, frequency) ?? p.iso});
  const lastLive = live.at(-1) ?? null;
  // The stale point is the last of ALL stored live points, not of the Period window (A1.1): its stored period is always printed; the square is drawn only when it is inside the window.
  const lastStored = allLive.at(-1) ?? null;
  const stalePoint = stale === true && lastStored !== null ? (byMs.get(lastStored.ms) ?? {...lastStored, text: rebased ? null : shown(lastStored.value, meta), period: periodLabel(lastStored.iso, frequency) ?? lastStored.iso}) : null;
  const staleDrawn = stalePoint !== null ? (byMs.get(stalePoint.ms) ?? null) : null;
  const unit = rebased && baseIso ? rebaseUnit(baseIso) : (indicatorUnit(indicator) ?? seriesUnit(meta));
  const name = indicator?.name ?? meta?.indicator_id ?? DRAFT_NOT_STATED;
  const statuses = live.map((p) => p.status).filter(isEstimateStatus);
  const first = live[0] ?? null;
  return {
    indicatorId: indicator?.indicator_id ?? meta?.indicator_id ?? null,
    seriesId: meta?.series_id ?? null,
    entityId,
    entityName: entityName ?? entityId,
    name,
    frequency,
    unit,
    seasonal: meta?.seasonal_adjustment ?? null,
    meta,
    stale: stalePoint !== null,
    stalePoint,
    staleDrawn,
    hasValue: allLive.length > 0,
    points: plotted,
    live,
    first,
    lastLive,
    crossesZero: live.some((p) => p.value < 0) && live.some((p) => p.value > 0),
    rebased: rebased && baseIso !== null,
    baseIso,
    basePeriod: baseIso === null ? null : hashPeriod(baseIso, frequency),
    caption: buildCaption({indicator, series: meta ? [meta] : [], range: first && lastLive ? {from: first.iso, to: lastLive.iso} : null, knownCutoff, statuses})
  };
}

// The tip of a plotted point (one text source, tip.js): name, period label per stored frequency, value with unit, EST/PROV line, stored seasonal adjustment,
// "stale" with the stored period on the last point of a stale series, known_at line.
export function facetTipLines(m, p) {
  const base = seriesTipLines({name: m.name, ms: p.ms, text: p.text, status: p.status, knownAt: p.knownAt}, {name: m.name, frequency: m.frequency, unit: m.unit});
  const extra = [...(present(m.seasonal) ? [m.seasonal] : []), ...(m.stale && p === m.staleDrawn ? [DRAFT_STALE_TIP(m.stalePoint.period)] : [])];
  return [...base.slice(0, -1), ...extra, base.at(-1)];
}

// x-domain (display clip of the Period control): the stored years as dates; none without a Period (Plot then uses the stored extent of the facet).
export function xDomainOf(from, to) {
  return hasWindow(from, to) ? [new Date(Date.UTC(from, 0, 1)), new Date(Date.UTC(to, 11, 31))] : null;
}

// One Plot per panel. `domain` (optional [Date, Date]) is the shared x-domain of the card; `mini` draws the compact size of an L1 facet.
export function facetChart(Plot, m, {domain = null, mini = true} = {}) {
  const ink = token("--mm-text");
  const bg = token("--mm-bg");
  const rule = token("--mm-border");
  const sparse = m.frequency !== "M";
  const filled = m.live.filter((p) => !isEstimateStatus(p.status) && (sparse || p === m.lastLive) && p !== m.staleDrawn);
  const hollow = m.live.filter((p) => isEstimateStatus(p.status) && p !== m.staleDrawn);
  const staleDot = m.staleDrawn ? [m.staleDrawn] : [];
  const tipTitle = (p) => tipText(facetTipLines(m, p));
  return Plot.plot({
    style: {fontSize: "12px", background: "transparent"},
    width: mini ? 420 : 960,
    height: mini ? 200 : 380,
    marginLeft: 56,
    marginRight: 16,
    marginBottom: 30,
    x: {type: "utc", label: null, ...xTickFormat(), ...(domain ? {domain} : {}), ticks: 5},
    y: {grid: true, label: m.unit || DRAFT_UNIT_MISSING_SENTENCE},
    marks: [
      ...(m.crossesZero ? [Plot.ruleY([0], {stroke: rule, strokeWidth: 1.5})] : []),
      Plot.line(m.points, {x: "date", y: "value", stroke: ink, strokeWidth: 2, clip: true}),
      Plot.dot(filled, {x: "date", y: "value", r: 3, stroke: ink, fill: ink, clip: true}),
      Plot.dot(hollow, {x: "date", y: "value", r: 4, stroke: ink, strokeWidth: 2, fill: bg, clip: true}),
      Plot.dot(staleDot, {x: "date", y: "value", symbol: "square", r: 6, stroke: ink, strokeWidth: 2, fill: isEstimateStatus(m.staleDrawn?.status) ? bg : ink}),
      Plot.tip(m.live, Plot.pointer({x: "date", y: "value", title: tipTitle}))
    ]
  });
}

export const facetFigureLabel = (m) => seriesFigureLabel({
  title: `${m.name}, ${m.entityName}`,
  yLabel: m.unit || DRAFT_UNIT_MISSING_SENTENCE,
  series: m.live.length === 0 ? [] : [{name: m.entityName, first: m.first.period, last: m.lastLive.period, latestText: `${m.lastLive.text} ${m.unit || DRAFT_UNIT_MISSING_SENTENCE}`}]
});

// The "View as table" rows: every plotted point (a stored null is not a point), the stored status or the "not stated" marker, never a bare "n/a".
export const facetTableRows = (m) => m.live.map((p) => ({entity: m.entityId, name: m.entityName, date: p.period, valueText: p.text, status: p.status ?? DRAFT_NOT_STATED}));

// One figure block: the figure (role="img", generated name), the caption block, the table alternative. `id` must be unique on the page.
export function facetBody(html, Plot, m, {id, domain = null, mini = true} = {}) {
  const figure = chartFigure(html, {id: `${id}-figure`, label: facetFigureLabel(m), chart: facetChart(Plot, m, {domain, mini})});
  return html`${figure}${captionBlock(html, m.caption, {id: `${id}-caption`})}${viewAsTable(html, {id: `${id}-table`, title: `${m.name}, ${m.entityName}`, rows: facetTableRows(m), valueUnit: m.unit || null, n: null})}`;
}

// The "stale" text code with the stored period, beside a title (a second, visible channel next to the square marker; the tip carries the same words).
export const staleCode = (html, m) => (m.stale ? html`<span class="mm-stale" data-flag="stale"><span class="mm-square" aria-hidden="true"></span>${DRAFT_STALE_CODE} <span class="mm-stale-period">${m.stalePoint.period}</span></span>` : "");

// L2 (V13): the expanded long line of one facet: figure, caption, table, the link to the revisions page, and the rebase control only when the stored metadata
// marks an index (scale_hint = index; absent today). `href` is the revisions page link; `onRebase(checked)` receives the control's change.
export function l2Block(html, Plot, m, {id, revisionsHref = null, domain = null, indicator = null, onRebase = null, rebaseControl = true} = {}) {
  const offered = rebaseControl && rebaseOffered(indicator); // rebaseControl=false: the host does not wire a rebase (PG-COUNTRY until CR-18)
  const control = offered ? html`<label class="mm-l2-rebase"><input type="checkbox" id="${id}-rebase" checked=${m.rebased}> ${REBASE_TOGGLE_LABEL}</label>` : "";
  const statement = m.rebased && m.baseIso ? html`<p class="mm-note" id="${id}-rebase-statement">${DRAFT_REBASE_STATEMENT(m.baseIso)}</p>` : "";
  const link = revisionsHref ? html`<p class="mm-l2-links"><a href="${revisionsHref}" data-link="revisions">${DRAFT_REVISIONS_LINK_LABEL(m.name)}</a></p>` : "";
  const root = html`<div class="mm-l2" id="${id}" data-card="l2"><h4>${DRAFT_COUNTRY_CARD_TITLES.l2}: ${m.name}</h4>${staleCode(html, m)}${control}${statement}${facetBody(html, Plot, m, {id, domain, mini: false})}${link}</div>`;
  if (offered && onRebase && typeof root?.querySelector === "function") root.querySelector(`input[type=checkbox]`)?.addEventListener("change", (e) => onRebase(e.target.checked));
  return root;
}

