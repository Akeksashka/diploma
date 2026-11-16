// V53, V54 (ADR-037 A2.2; AC-V2-110, 111, 113, 114, 116, 117, 118): the C6 choropleth map. Plot.geo on the stored geometry (a Plot projection: Lambert azimuthal equal-area rotated
// about [-10, -52], fitted to the asset; no zoom or pan). Colour is the stored value on a continuous scale (the C4 rule: sequential single hue, diverging with midpoint 0 when a negative
// value is shown); a country with a shape that the C2 selection hides is hatched (the hatch is never a value colour); a small country (join `marker`) is a fixed-size circle at the
// stored anchor of its shape; aggregates and countries outside the extent are never drawn. The SVG is one image with an accessible name; the countries are not tab stops; tips are
// pointer-only; the table alternative lists every stored row and a skip link reaches it. `html` (htl) and `Plot` are passed in. Display only: nothing is computed here.
import {
  COUNTRY_HEADER, DRAFT_C2_NO_RANK_REFERENCE, DRAFT_C4_LEGEND, DRAFT_C6_AGGREGATES_NOTE, DRAFT_C6_CARD_TITLE, DRAFT_C6_FIGURE_LABEL, DRAFT_C6_GEO_UNREADABLE, DRAFT_C6_LEGEND_UNIT, DRAFT_C6_MARKS, DRAFT_C6_SKIP_TO_TABLE,
  DRAFT_C6_SOURCE_NOTE, DRAFT_C6_TABLE_CAPTION, DRAFT_FACT_LABELS, DRAFT_NOT_STATED, DRAFT_NO_ALIGNED, DRAFT_P1A_NO_REFERENCE, DRAFT_P1A_REFERENCE, DRAFT_REVISIONS_LINK_LABEL, DRAFT_STATE_COLUMN,
  DRAFT_UNIT_MISSING_SENTENCE, DRAFT_VALUE_HEADER_UNIT, VIEW_AS_TABLE
} from "./copy.11b4a285.js";
import {barListTableRows} from "./bar-list.91fbd676.js";
import {blockedState, compatNotes} from "./blocked.83709a6b.js";
import {captionBlock} from "./caption-view.5fa7e18b.js";
import {valueText} from "./explorer.8bfe86f4.js";
import {chartFigure} from "./figure.39e330d9.js";
import {addBlankPattern, blankFill} from "./hatch.2769258a.js";
import {hiddenRowsRegion} from "./hidden-rows.3a139033.js";
import {defaultCountryHref} from "./multi-line.b1a02a4f.js";
import {token} from "./tokens.0779967f.js";
import {colourScale} from "./time-heatmap.5346feb2.js";

export const MARKER_RADIUS = 6; // pixels: a fixed size, not scaled by any value

const feature = (r) => ({type: "Feature", properties: {id: r.featureId, name: r.name, value: r.value ?? null, tip: r.tip ?? r.name}, geometry: r.geometry});
const hidden = (r) => ({...feature(r), properties: {id: r.featureId, name: r.name, value: null, tip: r.tip}});

export function choroplethChart(Plot, m, {patternId = "mm-blank-c6"} = {}) {
  const ink = token("--mm-text");
  const bg = token("--mm-bg");
  const rule = token("--mm-border");
  const solid = m.mapped.filter((r) => !r.other).map(feature);
  const dashed = m.mapped.filter((r) => r.other).map(feature);
  const hatched = m.hatched.map(hidden);
  const plain = m.plain.map(hidden);
  const at = {x: (r) => r.position[0], y: (r) => r.position[1], r: MARKER_RADIUS, stroke: ink, strokeWidth: 1, title: (r) => r.tip ?? r.name, tip: true};
  const byValue = (d) => d.properties.value;
  const tip = (d) => d.properties.tip;
  const chart = Plot.plot({
    style: {fontSize: "11px", background: "transparent"},
    width: 800,
    margin: 4,
    projection: {type: "azimuthal-equal-area", rotate: [-10, -52], domain: m.outline, inset: 6},
    color: colourScale(m),
    marks: [
      Plot.geo(m.outline.features, {fill: bg, stroke: rule, strokeWidth: 0.5}),
      ...(solid.length ? [Plot.geo(solid, {fill: byValue, stroke: bg, strokeWidth: 0.5, title: tip, tip: true})] : []),
      ...(dashed.length ? [Plot.geo(dashed, {fill: byValue, stroke: ink, strokeDasharray: "4 2", strokeWidth: 1.5, title: tip, tip: true})] : []),
      ...(plain.length ? [Plot.geo(plain, {fill: bg, stroke: rule, strokeWidth: 0.5, title: tip, tip: true})] : []),
      ...(hatched.length ? [Plot.geo(hatched, {fill: blankFill(patternId), stroke: rule, strokeWidth: 0.5, title: tip, tip: true})] : []),
      ...(m.markers.length ? [Plot.dot(m.markers, {...at, fill: (r) => r.value})] : []),
      ...(m.plainMarkers.length ? [Plot.dot(m.plainMarkers, {...at, fill: bg})] : []),
      ...(m.hatchedMarkers.length ? [Plot.dot(m.hatchedMarkers, {...at, fill: blankFill(patternId)})] : [])
    ]
  });
  return addBlankPattern(chart, patternId);
}

// The legend: a gradient bar with the lowest and highest shown stored value at its ends, the midpoint 0 for the diverging form, and the stored unit (AC-V2-111).
export function choroplethLegend(html, m) {
  if (m.extent === null) return "";
  return html`<div class="mm-c4-legend mm-c6-legend" data-scale="${m.scaleKind}"><span class="mm-c4-legend-end" data-end="min">${DRAFT_C4_LEGEND.min} ${valueText(m.extent.min)}</span><span class="mm-c4-ramp" data-scale="${m.scaleKind}" aria-hidden="true"></span>${m.scaleKind === "diverging" && m.extent.max > 0 ? html`<span class="mm-c4-legend-mid">0</span>` : ""}<span class="mm-c4-legend-end" data-end="max">${valueText(m.extent.max)} ${DRAFT_C4_LEGEND.max}</span><span class="mm-c6-legend-unit">${DRAFT_C6_LEGEND_UNIT(m.unit || DRAFT_UNIT_MISSING_SENTENCE)}</span></div>`;
}

// The table alternative: every stored row of the comparison set (the drawn ones first, then the hidden ones, aggregates and outside-extent countries included), with its state.
export function choroplethTableRows(m) {
  const notes = new Map(m.notMapped.map((r) => [r.entityId, r.mapNote]));
  return barListTableRows({rows: m.rows, hidden: m.hidden}).map((r) => (notes.has(r.entityId) ? {...r, state: notes.get(r.entityId)} : r));
}

export function choroplethTable(html, m, {id}) {
  const rows = choroplethTableRows(m);
  const unit = m.unit ?? DRAFT_UNIT_MISSING_SENTENCE;
  return html`<details class="mm-view-table" id="${id}-view"><summary>${VIEW_AS_TABLE}</summary><table id="${id}-table"><caption>${DRAFT_C6_TABLE_CAPTION(m.name, m.referenceLabel ?? DRAFT_NOT_STATED)}</caption><thead><tr><th scope="col">${COUNTRY_HEADER}</th><th scope="col">${DRAFT_FACT_LABELS.refPeriod}</th><th scope="col" class="mm-num">${DRAFT_VALUE_HEADER_UNIT(unit)}</th><th scope="col">${DRAFT_STATE_COLUMN}</th></tr></thead><tbody>${rows.map((r) => html`<tr data-entity="${r.entityId}"><th scope="row">${r.name}</th><td>${r.period}</td><td class="mm-num">${r.value}</td><td>${r.state}</td></tr>`)}</tbody></table></details>`;
}

const accessors = {label: (r) => r.name, id: (r) => r.entityId, period: (r) => r.periodText, sentence: (r) => r.mapNote ?? r.state?.sentence};

// The card. Same selection as C2 and no control of its own: Indicator, Group, Frequency and `oth` are the shared state (the C2 strip writes them).
export function choroplethBlock(html, Plot, m, {countryHref = defaultCountryHref, id = "c6", revisionsHref = null} = {}) {
  const title = html`<h3>${DRAFT_C6_CARD_TITLE}: ${m.name}</h3>`;
  const reference = m.referenceLabel === null ? html`<p class="mm-note" data-field="reference-period">${DRAFT_P1A_NO_REFERENCE}</p>` : html`<p class="mm-note" data-field="reference-period">${DRAFT_P1A_REFERENCE(m.referenceLabel)}</p>`;
  const region = hiddenRowsRegion(html, m.hidden, {...accessors, href: (r) => countryHref(r.entityId)});
  const table = choroplethTable(html, m, {id});
  const link = revisionsHref ? html`<p class="mm-l2-links"><a href="${revisionsHref}" data-link="revisions">${DRAFT_REVISIONS_LINK_LABEL(m.name)}</a></p>` : "";
  const source = html`<p class="mm-figure-note" data-field="map-source">${DRAFT_C6_SOURCE_NOTE}</p>`;
  const card = (state, body) => html`<div class="mm-compare-card" id="${id}" data-card="c6" data-state="${state}">${title}${body}</div>`;
  if (m.mapped.length === 0) return card("empty", html`${m.noReference ? "" : reference}${region}<p class="mm-state mm-state-empty" data-state="empty">${m.geoFailed ? DRAFT_C6_GEO_UNREADABLE : m.noReference ? DRAFT_C2_NO_RANK_REFERENCE : DRAFT_NO_ALIGNED}</p>${table}`);
  if (m.blocked) return card("blocked", html`${reference}${region}${blockedState(html, m.compat)}${table}`);
  const skip = html`<a href="#${id}-view" id="${id}-skip">${DRAFT_C6_SKIP_TO_TABLE}</a>`;
  if (typeof skip?.addEventListener === "function" && typeof table?.addEventListener === "function") skip.addEventListener("click", () => { table.open = true; });
  const figure = chartFigure(html, {id: `${id}-figure`, label: DRAFT_C6_FIGURE_LABEL(m.name, m.referenceLabel ?? DRAFT_NOT_STATED, m.unit ?? DRAFT_UNIT_MISSING_SENTENCE), chart: choroplethChart(Plot, m)});
  return html`<div class="mm-compare-card" id="${id}" data-card="c6" data-state="ok">${title}${reference}${region}<p class="mm-skip-values">${skip}</p>${compatNotes(html, m.compat)}${figure}${choroplethLegend(html, m)}<p class="mm-figure-note">${DRAFT_C6_MARKS}</p><p class="mm-figure-note" data-field="aggregates-note">${DRAFT_C6_AGGREGATES_NOTE}</p>${source}${captionBlock(html, m.caption, {id: `${id}-caption`})}${table}${link}</div>`;
}
