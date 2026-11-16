// L18 (layout amendment 4.10, 5; AC-DB-12, AC-DB-03; RD C-SER-4, AC-RD-14, AC-RD-30, AC-RD-32): the time-series card of the "Over time" band of PG-HOME.
// For 1 to 5 selected Countries and the selected Indicator it draws the line chart of PG-SERIES (explorer-view.js chart(): tip, end labels with
// stored value and unit, point reader, "View as table") from `series/<indicator_id>.parquet`. The file is requested ONLY by the explicit
// "Load history" button: one file per activation, nothing before it (the FileAttachment is lazy and neither .url() nor .parquet() is called
// earlier, so the Parquet reader is also first loaded by the first activation). Period clips the x-domain (buildModel from/to, years);
// Frequency keeps the rows whose stored `frequency` equals it (no resampling). Display only (D6): every value is a stored column.
//
// L19 (4.10, AC-DB-27): with no Country selected the same card shows small multiples for the comparison set (small-multiples.js): the same
// "Load history" button and file, then one facet per entity, at most 12, "Show more" adds the next 12. L20 (4.4, AC-DB-28): when exactly one Country
// is selected a "Lines" / "Bars" radio group (bar-chart.js) switches the chart type; the table alternative and the point reader are the same.
//
// API for later tasks:
//   seriesCardPlan(ctx, source)          pure: {kind: "multiples" | "unavailable" | "history", entities, indicatorId}
//                                         "multiples" = no Country selected and the indicator has a series file (button, then facets),
//                                         "unavailable" = no series file for the indicator, "history" = button, then chart.
//   rowsForCard(rows, state)             pure: the loaded rows narrowed by the stored `frequency` (state.f).
//   cardModel(ectx, indicatorId, rows, state, entities)   pure: buildModel() result for the card (entities in selection order, Period applied).
//   cardBlock(html, Plot, model, {mode, toggle, selected}) the chart (lines, or bars when mode is "bars" and one Country is selected), reader and
//                                         table alternative (or the empty-card sentence) for a model; `toggle` is the Lines / Bars radio group.
//   multiplesBlock(html, Plot, built, {onMore})   the facet chart, the no-data list and "Show more" for a multiplesModel() result.
//   mountSeriesCard(html, Plot, dash, {data, files, doc}) -> off   mounts into dash.slots.overTime and returns the unsubscribe function.
//     data: the home meta lists plus `manifest` (md of the home page); files: {indicator_id: FileAttachment} literal in the generated page.
//     Loaded rows are cached per indicator (a later filter change redraws without a request); a failure is not cached.
import {DRAFT_EMPTY_CARD, DRAFT_LOAD_HISTORY, DRAFT_REGIONS, DRAFT_SHOW_MORE, DRAFT_SUBREGION_CONSEQUENCE, DRAFT_TITLE_UNIT} from "./copy.11b4a285.js";
import {barsAvailable, chartModeToggle, modeFor} from "./bar-chart.60a58cbd.js";
import {buildModel, explorerContext, loadSeries} from "./explorer.8bfe86f4.js";
import {chart, figureAndReader, figureLabel, tableRowsOf, uniformUnit} from "./explorer-view.235d883f.js";
import {seriesOfFrequency} from "./filter-model.08517389.js";
import {viewAsTable} from "./figure.39e330d9.js";
import {hasHistory, historySource} from "./history.0b12c899.js";
import {FACET_PAGE, facetOrder, multiplesModel} from "./small-multiples.4f5151bb.js";
import {busyBlock, errorBlock} from "./state-blocks.81d10981.js";

export const SERIES_CARD_MAX = 5; // ADR-025 decision 6: the cap of overlaid lines
export const SERIES_CARD_IDS = Object.freeze({title: "series-card-title", load: "series-card-load", body: "series-card-body", figure: "series-card-figure", reader: "series-card-reader", view: "series-card-view", empty: "series-card-empty", more: "series-card-more", noData: "series-card-nodata", mode: "series-card-mode", error: "series-card-error", loading: "series-card-loading"});

export function seriesCardPlan(ctx, source) {
  const entities = (ctx.state?.c ?? []).slice(0, SERIES_CARD_MAX);
  const indicatorId = ctx.indicatorId ?? null;
  if (!indicatorId || !hasHistory(source, indicatorId)) return {kind: "unavailable", entities, indicatorId};
  return {kind: entities.length === 0 ? "multiples" : "history", entities, indicatorId};
}

export const rowsForCard = (rows, state) => seriesOfFrequency(rows, state?.f ?? null);

export function cardModel(ectx, indicatorId, rows, state, entities) {
  return buildModel(ectx, indicatorId, rowsForCard(rows, state), {entities, transform: "value", from: state?.from ?? "", to: state?.to ?? "", rebase: false});
}

const emptyCard = (html) => html`<p class="mm-state mm-state-empty" id="${SERIES_CARD_IDS.empty}" data-state="empty">${DRAFT_EMPTY_CARD}</p>`;

// The body of a loaded card for one model: not-shown notes, then the chart with its point reader and the table alternative; the
// empty-card sentence when nothing is drawn. Up to 5 series, so the model never facets.
export function cardBlock(html, Plot, model, {mode = "lines", toggle = null, selected = null} = {}) {
  const notShown = model.notShown.length ? html`<ul id="series-card-not-shown">${model.notShown.map((n) => html`<li data-entity="${n.entity}">${n.name}: not shown, ${n.reason}.</li>`)}</ul>` : "";
  if (model.plotted.length === 0) return html`<div class="mm-series-chart">${notShown}${emptyCard(html)}</div>`;
  const title = `${model.indicatorName}: ${model.transformLabel}${DRAFT_TITLE_UNIT(model.titleUnit)}`;
  const m = {...model, title};
  const shownMode = modeFor(selected ?? model.series.length, mode);
  const {figure, reader} = figureAndReader(html, Plot, model, chart(Plot, model, {html, mode: shownMode}), figureLabel(m), false, {figure: SERIES_CARD_IDS.figure, reader: SERIES_CARD_IDS.reader}, shownMode);
  const control = toggle !== null && barsAvailable(selected ?? model.series.length) ? toggle : "";
  return html`<div class="mm-series-chart">${notShown}${control}${figure}${reader}${viewAsTable(html, {id: SERIES_CARD_IDS.view, title, rows: tableRowsOf(m), n: null, valueUnit: uniformUnit(m), lazy: true})}</div>`;
}

// Small multiples (L19): the facet chart of a multiplesModel() result (one Plot, facets by entity name, shared y-axis; chart() facets form), its point reader and
// table alternative (cardBlock), the entities without any stored row (listed with the empty-card sentence, not dropped) and the "Show more" button.
export function multiplesBlock(html, Plot, built, {onMore = null} = {}) {
  const noData = built.noData.length ? html`<ul id="${SERIES_CARD_IDS.noData}">${built.noData.map((n) => html`<li data-entity="${n.id}">${n.name}: ${DRAFT_EMPTY_CARD}</li>`)}</ul>` : "";
  const more = built.more ? html`<button type="button" class="mm-history-btn" id="${SERIES_CARD_IDS.more}" onclick=${() => onMore?.()}>${DRAFT_SHOW_MORE}</button>` : "";
  return html`<div class="mm-series-multiples">${cardBlock(html, Plot, built.model, {selected: built.visible.length})}${noData}${more}</div>`;
}

// Mounts into dash.slots.overTime; returns the function that stops listening.
export function mountSeriesCard(html, Plot, dash, {data, files, doc = globalThis.document}) {
  const slot = dash.slots.overTime;
  slot.classList.add("mm-card--series");
  const source = historySource(data.manifest, files);
  const ectx = explorerContext({manifest: data.manifest, seriesMeta: data.series ?? [], entities: data.entities, indicators: data.indicators, alerts: [], groups: data.groups ?? [], domains: data.domains ?? []});
  const nameOfIndicator = (id) => data.indicators.find((i) => i.indicator_id === id)?.name ?? id;
  const loaded = new Map(); // indicator_id -> rows (a success only)
  const inflight = new Map(); // indicator_id -> Promise
  const failed = new Set(); // indicator ids whose last activation failed
  let last = null; // the latest ctx
  let mode = "lines"; // L20 chart type of a single selected Country; kept across redraws
  let facetCount = FACET_PAGE; // L19 facets drawn; reset when the indicator or the Group changes
  let facetKey = "";
  const toggle = chartModeToggle(html, {id: SERIES_CARD_IDS.mode, value: mode, onChange: (v) => {
    mode = v;
    if (last) render(last);
    doc.getElementById(SERIES_CARD_IDS.mode)?.querySelector("input:checked")?.focus();
  }});
  const nameOfEntity = (id) => data.entities.find((e) => e.entity_id === id)?.name ?? id;
  // The C-RANK sort is a local state of the compare card (rank-view.js); the facets follow its select (#rank-sort) and redraw when it changes.
  const chosenSort = () => doc.getElementById("rank-sort")?.value ?? undefined;
  doc.addEventListener?.("change", (e) => {
    if (e.target?.id === "rank-sort" && last && seriesCardPlan(last, source).kind === "multiples") render(last);
  });

  const heading = (id) => {
    const h = doc.createElement("h3");
    h.id = SERIES_CARD_IDS.title;
    h.tabIndex = -1;
    h.textContent = id ? nameOfIndicator(id) : "";
    return h;
  };

  async function activate(indicatorId) {
    if (loaded.has(indicatorId) || inflight.has(indicatorId)) return;
    failed.delete(indicatorId);
    const p = (async () => {
      try {
        const res = await loadSeries(source.entries.get(indicatorId), source.files[indicatorId]);
        if (res.error) throw new Error("series file");
        loaded.set(indicatorId, res.rows);
      } catch {
        failed.add(indicatorId);
      }
    })();
    inflight.set(indicatorId, p);
    render(last);
    await p;
    inflight.delete(indicatorId);
    const focusTitle = doc.activeElement === doc.body || doc.activeElement === null;
    if (last) render(last);
    if (focusTitle) doc.getElementById(SERIES_CARD_IDS.title)?.focus();
  }

  function render(ctx) {
    last = ctx;
    const plan = seriesCardPlan(ctx, source);
    const body = doc.createElement("div");
    body.className = "mm-series-body";
    body.id = SERIES_CARD_IDS.body;
    let busy = false;
    if (plan.kind === "unavailable") {
      body.append(heading(ctx.indicatorId), emptyCard(html));
    } else {
      const id = plan.indicatorId;
      body.append(heading(id));
      if (loaded.has(id)) {
        try {
          if (plan.kind === "multiples") {
            const key = `${id}|${ctx.state?.g ?? ""}`;
            if (key !== facetKey) {
              facetKey = key;
              facetCount = FACET_PAGE;
            }
            const rank = {indicator: data.indicators.find((i) => i.indicator_id === id), domainId: ctx.domainId, domains: data.domains, scorecard: ctx.scorecard, series: data.series ?? [], sort: chosenSort()};
            const order = facetOrder({entities: data.entities, groups: data.groups ?? [], state: ctx.state, rank});
            const built = multiplesModel(ectx, id, loaded.get(id), ctx.state, order, facetCount);
            body.append(multiplesBlock(html, Plot, {...built, noData: built.noData.map((e) => ({id: e, name: nameOfEntity(e)}))}, {onMore: () => {
              facetCount += FACET_PAGE;
              if (last) render(last);
              (doc.getElementById(SERIES_CARD_IDS.more) ?? doc.getElementById(SERIES_CARD_IDS.title))?.focus();
            }}));
          } else {
            const model = cardModel(ectx, id, loaded.get(id), ctx.state, plan.entities);
            body.append(cardBlock(html, Plot, model, {mode, toggle, selected: plan.entities.length}));
          }
        } catch {
          body.append(errorBlock(html, {region: DRAFT_REGIONS.series, kind: "invalid", consequence: DRAFT_SUBREGION_CONSEQUENCE, id: SERIES_CARD_IDS.error}));
        }
      } else if (inflight.has(id)) {
        busy = true;
        body.append(busyBlock(html, DRAFT_REGIONS.loadingSeries, {id: SERIES_CARD_IDS.loading}));
      } else {
        if (failed.has(id)) body.append(errorBlock(html, {region: DRAFT_REGIONS.series, kind: "missing", consequence: DRAFT_SUBREGION_CONSEQUENCE, id: SERIES_CARD_IDS.error}));
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.id = SERIES_CARD_IDS.load;
        btn.className = "mm-history-btn";
        btn.textContent = DRAFT_LOAD_HISTORY;
        btn.addEventListener("click", () => activate(id));
        body.append(btn);
      }
    }
    dash.fill(slot, body);
    if (busy) dash.busy(slot);
  }

  return dash.onChange(render);
}
