// Renders the V3 explorer. `html` (htl) and `Plot` are passed in, so this file imports only local modules:
// the pure view-model and the token reader. Controls are plain elements read with Generators.input (no Inputs import).
// D6: every number drawn or printed is a stored column (or the display-only rebase of one); no statistic is computed here.
import {entityChoices, groupChoices, isoDate, nameOf, periodsOf, selectedEntities, transformChoices, yearsOf} from "./explorer.js";
import {
  ALERTS_HEADING, ALERT_NOT_DRAWN, DRAFT_CHART_MARKS, DRAFT_CHART_SHOWS, DRAFT_CHOOSE_COUNTRIES_HINT, HASH_FALLBACK_NOTE, HASH_NO_ROWS_NOTE, DRAFT_FACET_STATEMENT, DRAFT_FREE_Y_LABEL, DRAFT_NEXT_SERIES, DRAFT_REBASE_MARKS, DRAFT_REGIONS,
  DRAFT_SELECT_GROUP, DRAFT_SUBREGION_CONSEQUENCE, DRAFT_TITLE_UNIT, DRAFT_Y_MODE, NO_SERIES, NO_SERIES_FILE, REBASE_NOTE, REBASE_TOGGLE_LABEL, SELECTION_LABEL
} from "./copy.js";
import {chartFigure, seriesFigureLabel, viewAsTable} from "./figure.js";
import {installTipDismiss, pointReader} from "./point-reader.js";
import {aboutSeriesTable} from "./series-meta.js";
import {emptyBlock, errorBlock} from "./state-blocks.js";
import {pointValueText, readerText, seriesTipLines, tipText, valueWithUnit} from "./tip.js";
import {token} from "./tokens.js";

// Five hues (tokens, both themes, 3:1 on the page and surface colours), each paired with a dash pattern and a marker shape so
// that colour is never the only cue. Diamond and triangle are kept for the alert marks. Assigned by selection order.
export const SERIES_STYLES = Object.freeze([
  {token: "--mm-series-1", dash: null, symbol: "circle"},
  {token: "--mm-series-2", dash: "8 4", symbol: "square"},
  {token: "--mm-series-3", dash: "2 4", symbol: "star"},
  {token: "--mm-series-4", dash: "10 4 2 4", symbol: "cross"},
  {token: "--mm-series-5", dash: "20 4 2 4 2 4", symbol: "wye"}
]);
export const styleOf = (order) => SERIES_STYLES[order] ?? SERIES_STYLES[0];
export const isEstimate = (p) => p.status === "EST" || p.status === "PROV";

// `groups` ({id, label, options}) render as <optgroup>s (a group with a null label is rendered flat); otherwise `options` are flat.
export function selectBox(html, {id, label, options, groups, value}) {
  const opt = (o) => html`<option value="${o.id}">${o.label}</option>`;
  const body = groups ? groups.map((g) => (g.label ? html`<optgroup label="${g.label}">${g.options.map(opt)}</optgroup>` : g.options.map(opt))) : options.map(opt);
  const el = html`<label>${label} <select id="${id}">${body}</select></label>`;
  if (value !== undefined) el.querySelector("select").value = value;
  return el;
}

// A group of checkboxes that behaves like one input: `.value` is the array of checked ids IN SELECTION ORDER (the order in which they
// were checked; it fixes the hue of a series) and a bubbling "input" event fires on change, so Generators.input(el) works.
// `groups` ({id, label, members}) add "select group" buttons; a button only toggles checkboxes (all members on, or all off if all were on).
export function checkBoxes(html, {id, label, options, value, groups = [], hint = null}) {
  const boxes = () => [...el.querySelectorAll("input[type=checkbox]")];
  let order = [...value];
  const toggle = (members) => {
    const mine = boxes().filter((b) => members.includes(b.value));
    const allOn = mine.every((b) => b.checked);
    for (const b of mine) b.checked = !allOn;
    el.dispatchEvent(new Event("input", {bubbles: true}));
  };
  const el = html`<fieldset id="${id}"><legend>${label}</legend>${hint ? html`<p class="mm-hint" id="${id}-hint">${hint}</p>` : ""}${groups.length ? html`<div class="mm-group-buttons" id="${id}-groups">${groups.map(
    (g) => html`<button type="button" class="mm-group-btn" data-group="${g.id}" onclick=${() => toggle(g.members)}>${DRAFT_SELECT_GROUP}: ${g.label}</button>`
  )}</div>` : ""}${options.map((o) => html`<label><input type="checkbox" value="${o.id}"> ${o.label}</label>`)}</fieldset>`;
  for (const box of boxes()) box.checked = value.includes(box.value);
  Object.defineProperty(el, "value", {
    get: () => {
      const on = boxes().filter((b) => b.checked).map((b) => b.value);
      order = [...order.filter((v) => on.includes(v)), ...on.filter((v) => !order.includes(v))];
      return [...order];
    }
  });
  return el;
}

// Controls that depend on the loaded rows (re-created when the indicator changes). `initial` ({indicator, entities, note}, from
// initialSelection) supplies the countries checked at first load; with none, no country is checked and the hint is shown.
// `initial.entities` are the countries wanted (from the address, or the current selection when the indicator changes).
// `box.note` is true when the address had an unrecognised part; `box.noRows` lists the names of valid countries with no rows in this
// indicator's file (a separate note); `box.order` is the picker's display order of country ids; `box.start` the countries checked when the box was made.
export function explorerControls(html, ctx, indicatorId, rows, initial = {indicator: null, entities: [], note: false}) {
  const tfs = transformChoices(ctx, indicatorId, rows);
  const ents = entityChoices(ctx, rows);
  const years = yearsOf(rows).map((y) => ({id: String(y), label: String(y)}));
  const toggle = html`<label><input type="checkbox" id="explorer-rebase"> ${REBASE_TOGGLE_LABEL}</label>`;
  const free = html`<label><input type="checkbox" id="explorer-free-y"> ${DRAFT_FREE_Y_LABEL}</label>`;
  const sel = selectedEntities(initial, indicatorId, ents);
  return {
    note: initial.note,
    noRows: sel.missing.map((id) => nameOf(ctx, id)),
    order: ents.map((c) => c.id),
    start: sel.entities,
    entities: checkBoxes(html, {id: "explorer-entities", label: "Countries", options: ents, value: sel.entities, groups: groupChoices(ctx, ents), hint: DRAFT_CHOOSE_COUNTRIES_HINT}),
    transform: selectBox(html, {id: "explorer-transform", label: "Transform", options: tfs.length ? tfs : [{id: "value", label: "Level"}]}),
    from: selectBox(html, {id: "explorer-from", label: "From year", options: [{id: "", label: "first"}, ...years]}),
    to: selectBox(html, {id: "explorer-to", label: "To year", options: [{id: "", label: "last"}, ...years]}),
    rebase: toggle,
    base: selectBox(html, {id: "explorer-base", label: "Base period", options: [{id: "auto", label: "first common period"}, ...periodsOf(rows)]}),
    free
  };
}

// Left rail on wide screens, a `<details>` "Selection" above the chart on compact ones. The rail is open from 40 rem up and
// closed below (and follows a change of the window); the chart goes into `main`. No data is read here.
export function explorerLayout(html, {indicator, box}) {
  const note = box.note ? html`<p class="mm-note" id="explorer-hash-note" role="status">${HASH_FALLBACK_NOTE}</p>` : "";
  const noRows = box.noRows?.length ? html`<p class="mm-note" id="explorer-norows-note" role="status">${HASH_NO_ROWS_NOTE(box.noRows)}</p>` : "";
  const rail = html`<details class="mm-selection" id="explorer-selection" open><summary>${SELECTION_LABEL}</summary>${note}${noRows}<div class="mm-controls">${indicator}${box.transform}${box.from}${box.to}${box.rebase}${box.base}${box.free}</div><div class="mm-controls">${box.entities}</div></details>`;
  const main = html`<div class="mm-explorer-main" id="explorer-main"></div>`;
  const el = html`<div class="mm-explorer mm-explorer-layout">${rail}${main}</div>`;
  if (typeof matchMedia === "function") {
    const wide = matchMedia("(min-width: 40rem)");
    rail.open = wide.matches;
    wide.addEventListener?.("change", (e) => { rail.open = e.matches; });
  }
  return {el, rail, main};
}

// Year ticks: every year for 3 to 12 distinct years, about ten year ticks above that, Plot's own ticks for a short range.
export function xAxis(plotted) {
  const years = new Set(plotted.map((p) => p.date.getUTCFullYear())).size;
  if (years > 12) return {ticks: 10, tickFormat: "%Y"};
  if (years > 2) return {ticks: "year", tickFormat: "%Y"};
  return {};
}

const labelOf = (s) => `${s.name}: ${valueWithUnit(pointValueText(s.latest), s.unit)}`;

// All marks of one series: line (null points are gaps), latest-observation hairline, rings on revised-data history, markers
// (every point of a non-monthly series; the last point and every estimate or provisional point otherwise; hollow = estimate or
// provisional), and the end label with the latest stored value and unit. `fy` puts the marks in a facet by country name.
function seriesMarks(Plot, s, {color, symbol, dash, bg, ink, muted, fy, endLabel, hl = null}) {
  const live = s.lines.filter((p) => p.value !== null);
  const opts = fy ? {fy: "name"} : {};
  const sparse = s.frequency !== "M";
  const filled = live.filter((p) => !isEstimate(p) && (sparse || p.ms === s.latest.ms));
  const hollow = live.filter(isEstimate);
  return [
    Plot.ruleX([s.latest], {...opts, x: "date", stroke: color, strokeOpacity: 0.45, strokeWidth: 1}),
    Plot.line(s.lines, {...opts, x: "date", y: "value", stroke: color, strokeWidth: 2, strokeDasharray: dash ?? undefined}),
    Plot.dot(live.filter((p) => p.loadKind === "revision"), {...opts, x: "date", y: "value", r: 7, stroke: muted, strokeWidth: 1.5, fill: "none"}),
    Plot.dot(filled, {...opts, x: "date", y: "value", symbol, r: 4, stroke: color, strokeWidth: 1.5, fill: color}),
    Plot.dot(hollow, {...opts, x: "date", y: "value", symbol, r: 5, stroke: color, strokeWidth: 2, fill: bg}),
    ...(endLabel ? [Plot.text([s.latest], {x: "date", y: "value", text: () => labelOf(s), dx: 12, textAnchor: "start", fill: ink, stroke: bg, strokeWidth: 4, paintOrder: "stroke"})] : []),
    ...highlightMarks(Plot, s, live, hl, opts)
  ];
}

// The tip text of a plotted point: one function for the pointer tip, the static highlight and the reader (tip.js).
const tipTitle = (seriesOf) => (p) => tipText(seriesTipLines(p, seriesOf(p)));

// Static highlight of the point chosen in "Read a value" (visual only): a ring and a tip that is always shown. `hl` = {entity, ms}.
function highlightMarks(Plot, s, live, hl, opts) {
  const at = hl && hl.entity === s.entity ? live.find((p) => p.ms === hl.ms) : null;
  if (!at) return [];
  return [
    Plot.dot([at], {...opts, x: "date", y: "value", r: 9, stroke: token("--mm-focus"), strokeWidth: 3, fill: "none"}),
    Plot.tip([at], {...opts, x: "date", y: "value", title: tipTitle(() => s), className: "mm-static-tip"})
  ];
}

// The pointer tip: ONE mark per chart so that the nearest point of all drawn series is the one described.
const pointerTip = (Plot, points, seriesOf, opts) => Plot.tip(points, Plot.pointer({...opts, x: "date", y: "value", title: tipTitle(seriesOf)}));

// Alert marks keep their shapes (diamond = alert, triangle = watch) and the title of each.
function alertMarks(Plot, model, ink, fy) {
  const opts = fy ? {fy: "name"} : {};
  return [
    Plot.dot(model.markers.filter((m) => m.level === "alert"), {...opts, x: "date", y: "value", symbol: "diamond", r: 7, fill: token("--mm-alert-alert"), stroke: ink, title: (m) => `${m.name}: alert, z = ${m.z}`}),
    Plot.dot(model.markers.filter((m) => m.level === "watch"), {...opts, x: "date", y: "value", symbol: "triangle", r: 7, fill: token("--mm-alert-watch"), stroke: ink, title: (m) => `${m.name}: watch, z = ${m.z}`})
  ];
}

function rebaseRules(Plot, model, rule) {
  if (!model.rebase) return [];
  return [Plot.ruleY([100], {stroke: rule, strokeWidth: 1.5}), ...(model.baseMs === null ? [] : [Plot.ruleX([new Date(model.baseMs)], {stroke: rule, strokeWidth: 1.5})])];
}

const BASE_PLOT = {style: {fontSize: "13px", background: "transparent"}};

// One line chart for up to 5 series; above that, one chart per country: a single faceted plot (shared y-axis) or one plot per
// country (free y-axis, each its own scale). `free` only matters above 5 series. Returns null when there is nothing to draw.
export function chart(Plot, model, {html = null, free = false, highlight = null} = {}) {
  if (model.plotted.length === 0) return null;
  const ink = token("--mm-text");
  const bg = token("--mm-bg");
  const muted = token("--mm-text-muted");
  const rule = token("--mm-border");
  const x = {type: "utc", label: null, ...xAxis(model.plotted)};
  const palette = {bg, ink, muted};
  const seriesByEntity = new Map(model.series.map((s) => [s.entity, s]));
  const seriesOf = (p) => seriesByEntity.get(p.entity);
  if (!model.facets) {
    const marks = [
      ...rebaseRules(Plot, model, rule),
      ...model.series.flatMap((s) => seriesMarks(Plot, s, {...palette, ...paint(s), fy: false, endLabel: true, hl: highlight})),
      ...alertMarks(Plot, model, ink, false),
      pointerTip(Plot, model.plotted, seriesOf, {})
    ];
    return Plot.plot({...BASE_PLOT, width: 960, height: 460, marginLeft: 64, marginRight: 290, marginBottom: 36, x, y: {grid: true, label: model.yLabel}, marks});
  }
  const title = (s, bg) => Plot.text([{name: s.name, label: labelOf(s)}], {...(free ? {} : {fy: "name"}), text: "label", frameAnchor: "top-left", dx: 0, dy: -8, fill: ink, stroke: bg, strokeWidth: 4, paintOrder: "stroke", fontWeight: 600});
  if (!free) {
    const marks = [
      ...rebaseRules(Plot, model, rule),
      ...model.series.flatMap((s) => [...seriesMarks(Plot, s, {...palette, ...paint(s, 0), fy: true, endLabel: false, hl: highlight}), title(s, bg)]),
      ...alertMarks(Plot, model, ink, true),
      pointerTip(Plot, model.plotted, seriesOf, {fy: "name"})
    ];
    return Plot.plot({...BASE_PLOT, width: 960, marginTop: 28, marginLeft: 64, marginRight: 24, x, y: {grid: true, label: model.yLabel}, fy: {axis: null, padding: 0.3, domain: model.series.map((s) => s.name)}, marks});
  }
  const cells = model.series.map((s) => {
    const mine = {...model, markers: model.markers.filter((m) => m.entity === s.entity)};
    const marks = [...rebaseRules(Plot, model, rule), ...seriesMarks(Plot, s, {...palette, ...paint(s, 0), fy: false, endLabel: false, hl: highlight}), title(s, bg), ...alertMarks(Plot, mine, ink, false), pointerTip(Plot, s.lines.filter((p) => p.value !== null), seriesOf, {})];
    return Plot.plot({...BASE_PLOT, width: 460, height: 230, marginTop: 30, marginLeft: 56, marginRight: 24, x, y: {grid: true, label: model.yLabel}, marks});
  });
  return html`<div class="mm-facets" id="explorer-facets">${cells}</div>`;
}

// The paint of a series: hue, dash and marker by selection order; every country in a facet uses the first style.
function paint(s, order = s.order) {
  const st = styleOf(order);
  return {color: token(st.token), symbol: st.symbol, dash: st.dash};
}

export function alertLines(html, model) {
  const rows = [...model.markers, ...model.unplacedAlerts];
  if (rows.length === 0) return "";
  return html`<section id="alert-markers"><h3>${ALERTS_HEADING}</h3><ul>${rows.map((m) => html`<li data-entity="${m.entity}" data-level="${m.level}">${m.name}: ${m.level}, z = ${m.z === null ? "n/a" : m.z}, reference period ${m.ref}${model.unplacedAlerts.includes(m) ? ALERT_NOT_DRAWN : ""}</li>`)}</ul></section>`;
}

// The rows of "View as table": every plotted point (spec 5.6, AC-RD-30d: every plotted value is also in a table, and the "Read a
// value" control steps the same points), per series, in date order.
export function tableRowsOf(model) {
  return model.series.flatMap((s) => s.lines.filter((p) => p.value !== null).map((p) => ({entity: s.entity, name: s.name, date: isoDate(p.ms), valueText: pointValueText(p), unit: s.unit, status: p.status})));
}

// The one unit of all drawn series (goes in the "View as table" value header), or null when they differ (then each cell carries its own).
export function uniformUnit(model) {
  const units = new Set(model.series.map((s) => s.unit));
  return units.size === 1 ? [...units][0] : null;
}

export function figureLabel(model) {
  return seriesFigureLabel({
    title: model.title,
    yLabel: model.yLabel,
    series: model.series.map((s) => ({name: s.name, first: isoDate(s.lines.find((p) => p.value !== null).ms), last: isoDate(s.latest.ms), latestText: valueWithUnit(pointValueText(s.latest), s.unit)}))
  });
}

// The chart figure and the "Read a value" control after it (outside the figure). Pointer: Plot's tip. Keyboard: the reader's output
// has the same words (tip.js); while focus is in the reader the chart is redrawn with a static highlight; Escape hides the pointer
// tip until the next pointer move (WCAG 1.4.13). Without a DOM (unit tests with the htl stand-in) only the figure is built.
function figureAndReader(html, Plot, model, c, label, free) {
  const figure = chartFigure(html, {id: "explorer-figure", label, chart: c});
  if (typeof figure?.replaceChildren !== "function") return {figure, reader: ""};
  const entries = model.series.map((s) => {
    const live = s.lines.filter((p) => p.value !== null);
    return {id: s.entity, name: s.name, points: live, texts: live.map((p) => readerText(seriesTipLines(p, s))), periods: live.map((p) => seriesTipLines(p, s)[1])};
  });
  const st = {active: false, sel: null};
  const redraw = () => {
    const hl = st.active && st.sel ? {entity: st.sel.entry.id, ms: st.sel.entry.points[st.sel.index].ms} : null;
    figure.replaceChildren(chart(Plot, model, {html, free, highlight: hl}));
  };
  const reader = pointReader(html, {
    id: "explorer-reader",
    entries,
    onChange: (sel) => {
      st.sel = sel;
      if (st.active) redraw();
    },
    onActive: (active) => {
      st.active = active;
      redraw();
    }
  });
  installTipDismiss();
  return {figure, reader: reader.el};
}

// opts: {free: boolean (free y-axis checkbox), href: string | null (the data file of the indicator)}
export function explorerBlock(html, Plot, model, error, {free = false, href = null} = {}) {
  const c = chart(Plot, model, {html, free});
  const title = `${model.indicatorName}: ${model.transformLabel}${model.rebase && model.baseDate ? `, rebased to 100 at ${model.baseDate}` : ""}${DRAFT_TITLE_UNIT(model.titleUnit)}`;
  const m = {...model, title};
  const {figure, reader} = c ? figureAndReader(html, Plot, model, c, figureLabel(m), free) : {figure: "", reader: ""};
  return html`<div class="mm-explorer">
${error ? errorBlock(html, {region: DRAFT_REGIONS.series, kind: "missing", id: "explorer-error", consequence: error === NO_SERIES_FILE ? `${NO_SERIES_FILE} ${DRAFT_SUBREGION_CONSEQUENCE}` : DRAFT_SUBREGION_CONSEQUENCE}) : ""}
<h3 id="explorer-title">${model.indicatorName}: ${model.transformLabel}${model.rebase && model.baseDate ? html`, rebased to 100 at ${model.baseDate}` : ""}${DRAFT_TITLE_UNIT(model.titleUnit)}</h3>
${model.rebase ? html`<p class="mm-note" id="rebase-note">${REBASE_NOTE}</p>` : ""}
${model.notShown.length ? html`<ul id="not-shown">${model.notShown.map((n) => html`<li data-entity="${n.entity}">${n.name}: not shown, ${n.reason}.</li>`)}</ul>` : ""}
${c ? html`<p class="mm-figure-note" id="chart-explain">${DRAFT_CHART_SHOWS} ${DRAFT_CHART_MARKS}${model.rebase ? ` ${DRAFT_REBASE_MARKS}` : ""}</p>
${model.facets ? html`<p class="mm-figure-note" id="y-mode" data-free="${free}">${DRAFT_FACET_STATEMENT} ${DRAFT_Y_MODE(free)}</p>` : ""}
${figure}
${reader}
${viewAsTable(html, {id: "explorer-view-table", title, rows: tableRowsOf(m), href, n: null, valueUnit: uniformUnit(m), lazy: true})}` : (error ? "" : emptyBlock(html, {id: "no-series", text: NO_SERIES, next: DRAFT_NEXT_SERIES}))}
${alertLines(html, model)}
${aboutSeriesTable(html, model)}</div>`;
}
