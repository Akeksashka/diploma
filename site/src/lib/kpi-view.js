// L14 (layout amendment 4.6, AC-DB-20, AC-DB-21): renders a kpiModel() result into the "overview" slot of the home dashboard. `html` (htl) is passed
// in. Display only: every number printed is a stored field formatted by kpi-model.js. No delta, arrow, rank or count; no colour by direction;
// the percentile chip colour is the stored bin token, every other state keeps its code, glyph and sentence (AC-UX-2).
import {
  AGGREGATE_NOT_RANKED, DRAFT_KPI_ERROR_CONSEQUENCE, DRAFT_OFFSET_FLAG, DRAFT_REGIONS as R, DRAFT_UNIT_MISSING_SENTENCE, FLAG_ESTIMATE, FLAG_LOW_COVERAGE, INDICATOR_SERIES_LINK,
  NA, NO_POSITION_LOW_COVERAGE, PERCENTILE_COLUMN_LABEL, SERIES_LINK_LABEL
} from "./copy.js";
import {binLabel} from "./bins.js";
import {glyph, glyphSprite} from "./glyphs.js";
import {kpiModel} from "./kpi-model.js";
import {busyBlock, errorBlock, failureKind} from "./state-blocks.js";
import {STATES} from "./states.js";

const mark = (html, t) =>
  t.estimate
    ? html`<span class="mm-mark" data-mark="estimate"><span class="mm-hollow" aria-hidden="true"></span><span aria-hidden="true">e</span><span class="mm-visually-hidden">${FLAG_ESTIMATE}</span></span>`
    : t.inherited
      ? html`<span class="mm-mark" data-mark="inherited"><span class="mm-hollow" aria-hidden="true"></span></span>`
      : "";

// State code with its glyph and sentence (rows without a value, and the state beside a value).
const stateLine = (html, st) => {
  const base = STATES[st.key];
  return html`<span class="mm-cell">${base.glyph ? glyph(html, base.glyph) : ""}${base.code ? html`<span class="mm-code">${base.code}</span>` : ""}</span>${st.sentence ? html` <span class="mm-sentence">${st.sentence}</span>` : ""}`;
};

// Percentile chip: the bin colour only for a ranked or ahead value; every other state shows its code, glyph and sentence.
function pctChip(html, t) {
  const st = t.state;
  const coloured = (st.key === "ranked" || st.key === "ahead") && t.percentileText !== null;
  if (coloured) {
    return html`<div class="mm-tile-pct" data-state="${st.key}" data-signature="${st.signature}" data-bin="${t.bin ?? "none"}"><span class="mm-cell"><span class="mm-fig">${t.percentileText}</span><span class="mm-visually-hidden">${PERCENTILE_COLUMN_LABEL}, ${binLabel(t.bin) ?? ""}</span></span> <span class="mm-sentence">${PERCENTILE_COLUMN_LABEL}</span></div>`;
  }
  if (st.key === "plain" && !st.sentence) return "";
  return html`<div class="mm-tile-pct" data-state="${st.key}" data-signature="${st.signature}" data-bin="none">${stateLine(html, st)}</div>`;
}

export function indicatorTileCard(html, t) {
  const head = html`<h3><a href="${t.href}" data-link="indicator-name" data-carry>${t.name}</a></h3>`;
  const link = html`<p class="mm-tile-link"><a href="${t.seriesHref}" data-link="series" aria-label="${SERIES_LINK_LABEL(t.name, t.entityName)}">${INDICATOR_SERIES_LINK}</a></p>`;
  if (!t.hasValue) {
    const st = t.state;
    return html`<div class="mm-card mm-card--tile mm-card--span-3 mm-tile" data-tile="indicator" data-indicator="${t.indicatorId}" data-has-value="false" data-state="${st.key}">${head}<div class="mm-tile-pct" data-state="${st.key}" data-signature="${st.signature}" data-bin="none">${stateLine(html, st)}</div>${link}</div>`;
  }
  return html`<div class="mm-card mm-card--tile mm-card--span-3 mm-tile" data-tile="indicator" data-indicator="${t.indicatorId}" data-has-value="true" data-state="${t.state.key}">${head}
<p class="mm-tile-value"><span class="mm-tile-number">${t.valueText}</span> <span class="mm-unit">${t.unit || DRAFT_UNIT_MISSING_SENTENCE}</span>${mark(html, t) === "" ? "" : html` ${mark(html, t)}`}</p>
<p class="mm-card-sub">${t.periodText ?? ""}${t.offsetFlag ? html` <span class="mm-flag" data-flag="offset">${DRAFT_OFFSET_FLAG(t.refOffsetDays)}</span>` : ""}</p>
${pctChip(html, t)}${link}</div>`;
}

// Domain-figure tile (ranked domains only). Two stored numbers are printed as text; no bar, no percent sign, no combination of domains.
// opts (L22, PG-COUNTRY): {span, href, carry}; defaults are the home tile.
export function domainFigureCard(html, f, {span = 3, href = `./domain/${f.domainId}`, carry = false} = {}) {
  const st = f.state;
  let body;
  if (st.key === "aggregate") body = html`<p class="mm-tile-state" data-state="aggregate"><span class="mm-code">${AGGREGATE_NOT_RANKED}</span></p>`;
  else if (st.key === "na") body = html`<p class="mm-tile-state" data-state="na">${glyph(html, STATES.na.glyph)}<span class="mm-code">${NA}</span> <span class="mm-sentence">${st.sentence}</span></p>`;
  else {
    const position = f.lowCoverage ? html`<span class="mm-flag">${FLAG_LOW_COVERAGE}</span> ${NO_POSITION_LOW_COVERAGE}` : f.positionText ?? "";
    body = html`<p class="mm-tile-value"><span class="mm-tile-number" data-field="percentile-rank">${f.percentileText}</span></p>
<p class="mm-card-sub">${f.label ?? ""}</p>
<p class="mm-tile-coverage">${f.coverageText ?? ""}${f.coverageText && position ? "; " : ""}${position}</p>`;
  }
  const link = carry ? html`<a href="${href}" data-link="domain" data-carry>${f.name}</a>` : html`<a href="${href}" data-link="domain">${f.name}</a>`;
  return html`<div class="mm-card mm-card--tile mm-card--span-${span} mm-tile" data-tile="domain-figure" data-domain="${f.domainId}" data-state="${st.key}"><h3>${link}</h3>${body}</div>`;
}

// {kind, nodes}: nodes go into the slot; `tiles` kinds use plain grid cards (the slot is then layout-only, never a card around cards).
export function kpiNodes(html, model) {
  if (model.kind === "tiles") return {kind: "tiles", nodes: [...(model.figure ? [domainFigureCard(html, model.figure)] : []), ...model.tiles.map((t) => indicatorTileCard(html, t))]};
  return {kind: model.kind, nodes: [html`<p class="mm-kpi-note" id="kpi-${model.kind}" data-state="${model.kind}">${model.text}</p>`]};
}

// Wires the card to the dashboard (slot API of home-dashboard.js). data: {entities, indicators, series}. Returns the off function.
export function mountKpi(html, dash, {data, doc = globalThis.document}) {
  const slot = dash.slots.overview;
  return dash.onChange((ctx) => {
    slot.classList.remove("mm-card--tiles");
    const focusIds = ctx.state.c ?? [];
    const needsScorecard = focusIds.length === 1;
    if (needsScorecard && ctx.error) {
      dash.fill(slot, errorBlock(html, {region: R.scorecard, kind: failureKind(ctx.error, "missing"), consequence: DRAFT_KPI_ERROR_CONSEQUENCE, id: "mm-error-kpi"}));
      return;
    }
    if (needsScorecard && ctx.scorecard === null) {
      dash.fill(slot, busyBlock(html, R.scorecard, {id: "mm-loading-kpi"}));
      dash.busy(slot);
      return;
    }
    let out;
    try {
      const model = kpiModel({focusIds, pinnedId: ctx.state.i ?? null, entities: data.entities, indicators: data.indicators, domain: ctx.domain, scorecard: ctx.scorecard, series: data.series ?? [], frequency: ctx.state.f ?? null});
      out = kpiNodes(html, model);
    } catch (e) {
      dash.fill(slot, errorBlock(html, {region: R.scorecard, kind: "invalid", consequence: DRAFT_KPI_ERROR_CONSEQUENCE, id: "mm-error-kpi"}));
      return;
    }
    const sprite = out.kind === "tiles" && doc && !doc.getElementById("mm-g-dash") ? [glyphSprite(html)] : [];
    if (out.kind === "tiles") slot.classList.add("mm-card--tiles");
    dash.fill(slot, ...sprite, ...out.nodes);
  });
}
