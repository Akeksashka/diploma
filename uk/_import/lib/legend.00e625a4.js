// Legend of the heatmap (T109): the orientation note once, the five percentile bins, and a real list of the cell marks that
// are present on the page (glyph + word). Only states in `states` are listed. Text comes from copy.js; swatches and marks are
// styled by style.css through data-bin and data-state, so there is no colour here.
import {AGGREGATE_NOT_RANKED, AHEAD_NAME, ALERT_LEVEL_PREFIX, BIN_LABELS, DESCRIPTIVE_CELL, DRAFT_LEGEND_BINS, DRAFT_LEGEND_STATES, DRAFT_LEGEND_TITLE, FLAG_ESTIMATE, FLAG_INHERITED, FLAG_LOW_COVERAGE, NA, NOT_PUBLISHED, NO_RANK_STALE, ORIENTATION_NOTE, notRankedCell} from "./copy.11b4a285.js";
import {glyph} from "./glyphs.a14b04e8.js";
import {DECORATIONS, STATES} from "./states.465c23b4.js";

// Meaning printed after the mark, in the confirmed wording; a mark whose code already says it needs no second text.
const MEANING = Object.freeze({
  ahead: AHEAD_NAME,
  stale: NO_RANK_STALE,
  lagging: notRankedCell("lagging"),
  unaligned: notRankedCell("unaligned"),
  inherited: FLAG_INHERITED,
  descriptive: DESCRIPTIVE_CELL,
  na: NA,
  not_published: NOT_PUBLISHED,
  aggregate: AGGREGATE_NOT_RANKED,
  low_coverage: FLAG_LOW_COVERAGE,
  estimate: FLAG_ESTIMATE,
  alert_watch: `${ALERT_LEVEL_PREFIX}watch`,
  alert_alert: `${ALERT_LEVEL_PREFIX}alert`
});

export const LEGEND_KEYS = Object.freeze(Object.keys(MEANING));

// `states`: keys present on the page (heatmapModel().states). `bins`: false for an informational domain (no colour scale).
// `orientation` (ADR-037 decision 3, ADR-026 decision 3): the orientation sentence is printed only when the caller says the percentile layer is visible (pc on); the default is off.
export function legendBlock(html, {states = [], bins = true, idPrefix = "domain-legend", orientation = false} = {}) {
  for (const k of states) if (!(k in MEANING)) throw new Error(`no legend entry for state ${JSON.stringify(k)}`);
  const item = (k) => {
    const base = STATES[k] ?? DECORATIONS[k];
    const word = MEANING[k];
    return html`<li data-state="${k}"><span class="mm-key" data-state="${k}">${base.glyph ? glyph(html, base.glyph) : ""}<span class="mm-code">${base.code ?? word}</span></span>${base.code === null || base.code === word ? "" : html` ${word}`}</li>`;
  };
  return html`<section class="mm-legend" id="${idPrefix}" aria-labelledby="${idPrefix}-title"><h3 id="${idPrefix}-title">${DRAFT_LEGEND_TITLE}</h3>${
    bins
      ? html`${orientation ? html`<p class="mm-orientation">${ORIENTATION_NOTE}</p>` : ""}<p class="mm-legend-head">${DRAFT_LEGEND_BINS}</p><ol class="mm-legend-bins">${BIN_LABELS.map((label, k) => html`<li data-bin="${[1, 2, 3, 4, 5][k]}"><span class="mm-swatch" data-bin="${[1, 2, 3, 4, 5][k]}"></span> ${label}</li>`)}</ol>`
      : ""
  }${states.length === 0 ? "" : html`<p class="mm-legend-head">${DRAFT_LEGEND_STATES}</p><ul class="mm-legend-states">${states.map(item)}</ul>`}</section>`;
}
