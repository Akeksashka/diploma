// L13 (layout amendment 4.8, AC-DB-24, ADR-036): the heatmap card (C-HEAT) of PG-HOME. It wraps the V1 heatmap (heatmap-view.js) for the selected
// Domain and the comparison set. The legend and the orientation note are printed once, in `dash.legend` directly above the card. Period does not
// apply here (ADR-036), so there is no hidden-rows disclosure. No overall column, no row aggregate, no composite. Display only (D6): every cell,
// bin and state comes from heatmapModel() over the stored scorecard; nothing is computed here.
import {DRAFT_EMPTY_CARD, DRAFT_REGIONS, DRAFT_SUBREGION_CONSEQUENCE} from "./copy.js";
import {glyphSprite} from "./glyphs.js";
import {cardView, heatmapModel} from "./heatmap.js";
import {heatmapFigure} from "./heatmap-view.js";
import {legendBlock} from "./legend.js";
import {busyBlock, errorBlock, failureKind} from "./state-blocks.js";

export const HOME_HEATMAP_ID = "home-heatmap";
// Links from the home page (the page sits at the site root); data-carry keeps the filter hash (L10).
export const HOME_HREFS = Object.freeze({country: (id) => `./country/${id}`, indicator: (id) => `./indicator/${id}`});

const emptyCard = (html) => html`<p class="mm-state mm-state-empty" id="heatmap-empty" data-state="empty">${DRAFT_EMPTY_CARD}</p>`;

// Mounts the card into dash.slots.domain and the legend into dash.legend. `data`: the meta lists (entities, groups, indicators, domains).
export function mountHeatmapCard(html, dash, {data, doc = globalThis.document}) {
  const slot = dash.slots.domain;
  // mm-sc: the V1 heatmap table rules of style.css are scoped to it.
  slot.classList.add("mm-card--heat", "mm-sc");
  const body = doc.createElement("div");
  body.className = "mm-heat-body";
  dash.fill(slot, body);
  dash.busy(slot);

  function render(ctx) {
    dash.legend.replaceChildren();
    if (ctx.error) {
      body.replaceChildren(errorBlock(html, {region: DRAFT_REGIONS.scorecard, kind: failureKind(ctx.error, "missing"), consequence: DRAFT_SUBREGION_CONSEQUENCE, id: "heatmap-error"}));
      slot.setAttribute("aria-busy", "false");
      return;
    }
    if (ctx.loading || !ctx.scorecard) {
      body.replaceChildren(busyBlock(html, DRAFT_REGIONS.scorecard, {id: "heatmap-loading"}));
      dash.busy(slot);
      return;
    }
    try {
      const view = cardView(ctx.scorecard, {entities: data.entities, groups: data.groups, indicators: data.indicators, domains: data.domains, state: ctx.state});
      if (view.rows.length === 0 || view.columns.length === 0) {
        body.replaceChildren(emptyCard(html));
        slot.setAttribute("aria-busy", "false");
        return;
      }
      const model = heatmapModel(view);
      const sprite = doc.getElementById("mm-g-dash") ? [] : [glyphSprite(html)];
      dash.legend.replaceChildren(...sprite, legendBlock(html, {states: model.states, bins: model.hasBins, idPrefix: "home-legend"}));
      body.replaceChildren(heatmapFigure(html, model, {idPrefix: HOME_HEATMAP_ID, hrefs: HOME_HREFS, carry: true, orientation: false}));
    } catch {
      dash.legend.replaceChildren();
      body.replaceChildren(errorBlock(html, {region: DRAFT_REGIONS.scorecard, kind: "invalid", consequence: DRAFT_SUBREGION_CONSEQUENCE, id: "heatmap-error"}));
    }
    slot.setAttribute("aria-busy", "false");
  }

  return dash.onChange(render);
}
