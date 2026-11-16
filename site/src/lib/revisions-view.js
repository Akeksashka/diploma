// Renders the V4 vintage and revision view. `html` (htl) is passed in, so this file imports only the
// pure view-model. Display only (D6): every number is the stored value as exported.
import {EARLIEST_LABEL, EDITIONS_INTRO, NAMED_EDITION_MARK, NO_EDITIONS, NO_ORDINARY, NO_ORDINARY_CLASS, REESTIMATION_NOTE, REVISED_DATA_HISTORY_MARK, REVISED_DATA_NOTICE, VINTAGE_CHOOSE, VINTAGE_EMPTY, VINTAGE_NONE, VINTAGE_TEXT} from "./copy.js";
import {DRAFT_BAND_REVISIONS, DRAFT_BAR_LABEL, DRAFT_CARD_REVISIONS, DRAFT_REGIONS, DRAFT_STEP_CHOOSE_PERIOD, DRAFT_STEP_FIGURE_LABEL, DRAFT_STEP_FIGURE_PART, DRAFT_STEP_NOTE, DRAFT_STEP_REMOVED, DRAFT_STEP_SKIP, DRAFT_SUBREGION_CONSEQUENCE} from "./copy.js";
import {chartFigure} from "./figure.js";
import {token} from "./tokens.js";
import {glyph, glyphSprite} from "./glyphs.js";
import {errorBlock} from "./state-blocks.js";
import {periodChoices, seriesChoices} from "./revisions.js";
import {i18n} from "./i18n.js";
import {codeText, unitLabelText, xTickFormat} from "./code-text.js";
const X = (key, params) => i18n.t(key, params);

const escText = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);

// L24: the opening markup of the PG-REVISIONS band and card (band h2, card h3); the generated page closes it with </div></div></section>.
export const revisionsBandOpen = () => `<section class="mm-dband" id="band-revisions"><div class="mm-band"><h2>${escText(DRAFT_BAND_REVISIONS)}</h2></div><div class="mm-grid"><div class="mm-card mm-card--span-12 mm-card--revisions" id="revisions-card"><h3>${escText(DRAFT_CARD_REVISIONS)}</h3>`;

export function selectBox(html, {id, label, options, value}) {
  const el = html`<label>${label} <select id="${id}">${options.map((o) => html`<option value="${o.id}">${o.label}</option>`)}</select></label>`;
  if (value !== undefined) el.querySelector("select").value = value;
  return el;
}

const classCell = (html, cls, label) => (cls === "reestimation" ? html`<span class="mm-flag" data-class-mark="reestimation">${label}</span>` : label);

// Sign of a stored number (V4, brief 3.3): the printed sign and the triangle carry it; the blue-orange colour is the second channel.
const signOf = (n) => (n === null || n === undefined ? "none" : n < 0 ? "neg" : n > 0 ? "pos" : "zero");
const MINUS = "\u2212"; // true minus sign, not a hyphen
const signedText = (text, n) => (n > 0 ? `+${text}` : n < 0 ? text.replace(/^-/, MINUS) : text);
const signedCell = (html, text, n) => {
  const sign = signOf(n);
  return sign === "none" ? text : html`<span class="mm-signed" data-sign="${sign}">${sign === "zero" ? "" : glyph(html, "triangle")}<span class="mm-signed-text">${signedText(text, n)}</span></span>`;
};

// Bar scale (display only, labelled): the largest absolute stored revision_pct among the rows shown.
function barScale(rows) {
  let top = 0;
  for (const r of rows) {
    const a = r.pctNum < 0 ? -r.pctNum : r.pctNum;
    if (a > top) top = a;
  }
  return top;
}
const barPercent = (n, top) => (top > 0 && n !== null ? ((n < 0 ? -n : n) / top) * 100 : 0);
const barCell = (html, text, n, top) => {
  const sign = signOf(n);
  const w = barPercent(n, top).toFixed(1);
  return html`${signedCell(html, text, n)}${sign === "none" ? "" : html`<svg class="mm-bar" data-sign="${sign}" data-bar="${w}" aria-hidden="true" focusable="false" viewBox="0 0 100 6" preserveAspectRatio="none"><rect class="mm-bar-fill" x="0" y="0" width="${w}" height="6"></rect></svg>`}`;
};

export const noticeBlock = (html) => html`<div class="mm-revisions"><p class="mm-note" id="revised-data-notice">${REVISED_DATA_NOTICE}</p></div>`;

// The ordinary list: the part of revisions_recent.json with named editions removed by the exporter.
export function ordinaryBlock(html, rv) {
  const top = barScale(rv.rows);
  const table = rv.rows.length
    ? html`${glyphSprite(html)}<p class="mm-note" id="bar-label">${DRAFT_BAR_LABEL}</p><table id="recent-revisions"><thead><tr><th>${X("DRAFT_FILTER_LABELS.indicator")}</th><th>${X("COUNTRY_HEADER")}</th><th>${X("DRAFT_FACT_LABELS.refPeriod")}</th><th class="mm-num">${X("X_REV_PREVIOUS")}</th><th class="mm-num">${X("X_REV_NEW")}</th><th class="mm-num">${X("X_REV_ABS")}</th><th class="mm-num">${X("X_REV_PCT")}</th><th>${X("X_REV_KIND")}</th><th>${X("X_REV_CLASS")}</th><th>${X("X_REV_KNOWN_AT")}</th></tr></thead><tbody>${rv.rows.map(
        (r) => html`<tr data-indicator="${r.indicatorId}" data-entity="${r.entity}" data-class="${r.cls}"><td>${r.hasIndicatorPage ? html`<a href="indicator/${r.indicatorId}" data-link="indicator">${r.indicator}</a>` : r.indicator}</td><td>${r.hasCountryPage ? html`<a href="country/${r.entity}" data-link="country">${r.name}</a>` : r.name}</td><td>${r.period}</td><td class="mm-num">${r.previous}</td><td class="mm-num">${r.value}</td><td class="mm-num">${signedCell(html, r.abs, r.absNum)}</td><td class="mm-num mm-bar-cell">${barCell(html, r.pct, r.pctNum, top)}</td><td>${codeText("load", r.loadKind)}</td><td>${classCell(html, r.cls, r.clsLabel)}</td><td>${r.knownAt}</td></tr>`
      )}</tbody></table>`
    : html`<p id="no-ordinary">${rv.nTotal === 0 ? NO_ORDINARY : NO_ORDINARY_CLASS}</p>`;
  return html`<section class="mm-revisions" id="ordinary-list"><h2>${X("X_REV_RECENT")}</h2>
<p>${X("X_REV_RECENT_INTRO", {shown: rv.nShown, of: rv.nTotal})}${rv.omitted ? ` ${X("X_REV_OMITTED", {omitted: rv.omitted})}` : ""}</p>
<p class="mm-note" id="reestimation-note">${REESTIMATION_NOTE}</p>
${table}</section>`;
}

// One line per named edition, below the ordinary list. The line is the stored summary; no recount.
export function editionsBlock(html, rv, urls = {}) {
  if (rv.editions.length === 0) return html`<section class="mm-revisions" id="edition-lines"><h2>${X("X_REV_EDITIONS")}</h2><p id="no-editions">${NO_EDITIONS}</p></section>`;
  return html`<section class="mm-revisions" id="edition-lines"><h2>${X("X_REV_EDITIONS")}</h2>
<p>${EDITIONS_INTRO}</p>
<ul>${rv.editions.map(
    (e) => html`<li data-source="${e.sourceId}" data-edition="${e.label}"><span class="mm-edition-line">${e.line}</span> (first stored ${e.firstKnownAt}).${e.indicatorIds.length ? html` Details, revision files: ${e.indicatorIds.map((id, i) => html`${i ? ", " : ""}${urls[id] ? html`<a href="${urls[id]}" download>${id}</a>` : id}`)}.` : ""}</li>`
  )}</ul></section>`;
}

export function historyControls(html, ctx, indicatorId, rows) {
  const series = seriesChoices(ctx, indicatorId, rows);
  return {
    series: selectBox(html, {id: "vintage-series", label: X("X_REV_SERIES_COUNTRY"), options: series.length ? series : [{id: "", label: X("DRAFT_PRINT_FILTERS_NONE")}]}),
    period: selectBox(html, {id: "vintage-period", label: X("DRAFT_FACT_LABELS.refPeriod"), options: periodChoices(rows)})
  };
}

export function captionLine(html, c) {
  return html`<table id="vintage-caption"><thead><tr><th>${X("COUNTRY_HEADER")}</th><th>${X("DRAFT_ABOUT_LABELS.seriesId")}</th><th>${X("DRAFT_ABOUT_LABELS.source")}</th><th>${X("DRAFT_ABOUT_LABELS.frequency")}</th><th>${X("DRAFT_ABOUT_LABELS.seasonal")}</th><th>${X("DRAFT_ABOUT_LABELS.unit")}</th></tr></thead><tbody><tr><td>${c.country}</td><td>${c.seriesId}</td><td>${c.source}</td><td>${c.frequency}</td><td>${c.sa}</td><td>${c.unit}</td></tr></tbody></table>`;
}

export function historyTable(html, hv) {
  return html`<table id="vintage-history"><thead><tr><th>${X("DRAFT_FACT_LABELS.refPeriod")}</th><th>${X("X_REV_VERSION")}</th><th>${X("X_REV_KNOWN_AT")}</th><th>${X("X_REV_VINTAGE_LABEL")}</th><th>${X("X_REV_SOURCE_TS")}</th><th class="mm-num">${X("DRAFT_TABLE_HEADERS.value")}</th><th>${X("DRAFT_TABLE_HEADERS.status")}</th><th>${X("X_REV_LOAD_KIND")}</th><th class="mm-num">${X("X_REV_ABS")}</th><th class="mm-num">${X("X_REV_PCT")}</th><th>${X("X_REV_CLASS")}</th></tr></thead><tbody>${hv.keys.flatMap((k) =>
    k.versions.map(
      (v, i) =>
        html`<tr data-period="${k.period}" data-base="${v.base ? "true" : "false"}" data-class="${v.base ? "base" : v.cls}"><td>${i === 0 ? k.period : ""}</td><td>${v.label}${v.edition ? NAMED_EDITION_MARK : ""}</td><td>${v.knownAt}</td><td>${v.vintageLabel}</td><td>${v.releaseAt}</td><td class="mm-num">${v.value}</td><td>${codeText("status", v.status)}</td><td>${codeText("load", v.loadKind)}${v.revisedData ? REVISED_DATA_HISTORY_MARK : ""}</td><td class="mm-num">${v.abs}</td><td class="mm-num">${v.pct}</td><td>${v.base ? "n/a" : classCell(html, v.cls, v.clsLabel)}</td></tr>`
    )
  )}</tbody></table>`;
}

// ---- V4 step chart (T127): value against known_at for ONE reference period. Every point is a stored version.
// Plotted points of one key, in stored known_at order; the version table lists the same versions in the same order.
export function stepPoints(key) {
  return key.versions.map((v) => ({date: new Date(v.knownMs), knownAt: v.knownAt, value: v.valueNum, valueText: v.value, label: v.label, base: v.base, tombstone: v.tombstone}));
}

// Step chart (Plot passed in). Line = stored versions with a value, step-after; the earliest stored version is a labelled
// hollow point; a tombstone is a cross and the word "removed" at its known_at (no value, so no y position of its own).
export function stepChart(Plot, points, yLabel) {
  const ink = token("--mm-text");
  const line = token("--mm-pct-4");
  const valued = points.filter((p) => !p.tombstone && p.value !== null);
  const later = valued.filter((p) => !p.base);
  const first = valued.filter((p) => p.base);
  const gone = points.filter((p) => p.tombstone);
  return Plot.plot({
    style: {fontSize: "13px", background: "transparent"},
    marginLeft: 72,
    marginRight: 40,
    marginTop: 28,
    marginBottom: 56,
    x: {type: "utc", ...xTickFormat(), label: X("X_REV_KNOWN_AT"), labelAnchor: "center", labelOffset: 44},
    y: {grid: true, label: yLabel, tickFormat: (d) => String(Number(d.toPrecision(6)))},
    marks: [
      Plot.line(valued, {x: "date", y: "value", curve: "step-after", stroke: line, strokeWidth: 2}),
      Plot.dot(later, {x: "date", y: "value", r: 4, stroke: line, strokeWidth: 1.5, fill: line}),
      Plot.dot(first, {x: "date", y: "value", r: 6, stroke: line, strokeWidth: 2.5, fill: "none"}),
      Plot.text(first, {x: "date", y: "value", text: () => EARLIEST_LABEL, textAnchor: "start", dx: 10, dy: -12, fill: ink, stroke: token("--mm-bg"), strokeWidth: 4, paintOrder: "stroke"}),
      Plot.ruleX(gone, {x: "date", stroke: ink, strokeWidth: 1.5, strokeDasharray: "4 3"}),
      Plot.text(gone, {x: "date", frameAnchor: "top", text: () => `\u00d7 ${DRAFT_STEP_REMOVED}`, dy: -2, fill: ink, stroke: token("--mm-bg"), strokeWidth: 4, paintOrder: "stroke"})
    ]
  });
}

function stepBlock(html, Plot, hv) {
  if (hv.nKeys !== 1) return html`<p class="mm-note" id="step-choose">${DRAFT_STEP_CHOOSE_PERIOD}</p>`;
  const key = hv.keys[0];
  const pts = stepPoints(key);
  const unit = hv.caption.unit;
  const label = DRAFT_STEP_FIGURE_LABEL(hv.indicatorName, hv.caption.country, key.period, unit, pts.map((p) => DRAFT_STEP_FIGURE_PART(p.knownAt, p.tombstone ? DRAFT_STEP_REMOVED : `${p.valueText} ${unit}`)));
  const chart = Plot ? stepChart(Plot, pts, unit) : "";
  return html`<div class="mm-step" id="step-block"><p class="mm-figure-note" id="step-note">${DRAFT_STEP_NOTE}</p>
<p class="mm-skip-values"><a href="#vintage-history" id="step-skip">${DRAFT_STEP_SKIP}</a></p>
${chartFigure(html, {id: "step-figure", label, chart})}</div>`;
}

// `error` is a message from loadRevisions; `chosen` is false until an indicator is selected.
export function historyBlock(html, hv, {error = null, chosen = false, Plot = null} = {}) {
  const body = error
    ? errorBlock(html, {region: DRAFT_REGIONS.revisionFile, kind: "missing", id: "vintage-error", consequence: DRAFT_SUBREGION_CONSEQUENCE})
    : !chosen
      ? html`<p id="vintage-choose">${VINTAGE_CHOOSE}</p>`
      : hv.seriesId === null
        ? html`<p id="vintage-none">${VINTAGE_NONE}</p>`
        : hv.nKeys === 0
          ? html`<p id="vintage-empty">${VINTAGE_EMPTY}</p>`
        : html`<p>${X("X_REV_SUMMARY", {indicator: hv.indicatorName, periods: i18n.tp("X_REV_PERIODS", hv.nKeys), versions: i18n.tp("X_REV_VERSIONS", hv.nVersions), earliest: EARLIEST_LABEL})}</p>${captionLine(html, hv.caption)}${stepBlock(html, Plot, hv)}${historyTable(html, hv)}`;
  return html`<section class="mm-revisions" id="vintage-view"><h2>${X("X_REV_VINTAGE_ONE")}</h2>
<p class="mm-note" id="vintage-text">${VINTAGE_TEXT}</p>
${body}</section>`;
}
