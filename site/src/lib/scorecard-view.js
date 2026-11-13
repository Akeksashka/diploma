// Renders a domainView() result (T111, T112). `html` is htl's tag, passed in, so this file imports only local modules (no
// off-origin dependency). Display only: nothing is computed here. The country x indicator heatmap replaces the old summary
// table and dot plot; the detail table (country x indicator in rows, with the reference-period facts) stays in the DOM inside a
// <details>, so every fact shown on focus is also in a table.
import {DETAILS_SUMMARY, DRAFT_FACT_LABELS as FACT, NA, NOT_DOMAIN_PERCENTILE, NOT_PUBLISHED, SKIP_TO_TABLE, UNRANKED_DOMAIN_STATEMENT} from "./copy.js";
import {glyphSprite} from "./glyphs.js";
import {heatmapFigure} from "./heatmap-view.js";
import {heatmapModel} from "./heatmap.js";
import {legendBlock} from "./legend.js";

export function detailTable(html, view) {
  return html`<table id="domain-detail"><thead><tr><th>Country</th><th>Indicator</th><th class="mm-num">${FACT.value}</th><th>${FACT.refPeriod}</th><th>${view.percentileColumn}</th><th>${FACT.flags}</th><th class="mm-num">${FACT.refOffset}</th><th>${FACT.release}</th><th class="mm-num">${FACT.age}</th></tr></thead><tbody>${view.cells.map(
    (c) => html`<tr data-entity="${c.entityId}" data-indicator="${c.indicatorId}" data-status="${c.status}"><td>${c.entity}</td><td>${c.name}</td><td class="mm-num${c.valueText === NA || c.valueText === NOT_PUBLISHED ? " mm-na" : ""}">${c.valueText}${c.unit && c.status !== "missing" && c.status !== "not_published" ? html` <span class="mm-na">${c.unit}</span>` : ""}</td><td>${c.refPeriod ?? NA}</td><td class="mm-num${c.status === "ranked" ? "" : " mm-na"}">${c.percentileText}</td><td>${c.flags.map((f) => html`<span class="mm-flag">${f}</span>`)}</td><td class="mm-num">${c.refOffsetDays ?? NA}</td><td>${typeof c.releaseAt === "string" ? c.releaseAt.slice(0, 10) : NA}</td><td class="mm-num">${c.ageDays ?? NA}</td></tr>`
  )}</tbody></table>`;
}

export function alignmentTable(html, view) {
  const rows = view.alignment.filter((a) => a.rankReferencePeriod !== null || a.spreadDays !== null);
  if (rows.length === 0) return "";
  return html`<table id="domain-alignment"><thead><tr><th>Indicator</th><th>Common reference period of the ranking</th><th class="mm-num">Reference-period spread (days)</th><th class="mm-num">Countries ranked</th><th class="mm-num">Not aligned</th></tr></thead><tbody>${rows.map(
    (a) => html`<tr><td>${a.name}</td><td>${a.rankReferencePeriod ?? "n/a"}</td><td class="mm-num">${a.spreadDays ?? "n/a"}</td><td class="mm-num">${a.nRanked ?? "n/a"}</td><td class="mm-num">${a.nUnaligned ?? "n/a"}</td></tr>`
  )}</tbody></table>`;
}

// Order on the page (ADR-026 decision 3): notices, the standing caveat, the peer-set note, the description of the figure, the
// heatmap, then the legend (orientation note first), the alignment table and the detail table in <details>.
// card: true (L24) puts the block inside a card under a band: the name becomes the card title (h3) because the band carries the h2.
// `orientation`: the percentile layer is visible (pc on), so the orientation sentence is printed (ADR-037 decision 3); off by default.
export function domainBlock(html, view, {card = false, orientation = false} = {}) {
  const model = heatmapModel(view);
  const root = html`<div class="mm-sc">
${glyphSprite(html)}
${card ? html`<h3>${view.name}</h3>` : html`<h2>${view.name}</h2>`}
${view.notices.map((n) => html`<p class="mm-notice">${n}</p>`)}
<p class="mm-caveat" id="caveat">${view.caveat}</p>
${view.peerNote ? html`<p class="mm-peer-note" id="peer-set-note">${view.peerNote}</p>` : ""}
${view.ranked ? html`<p>The country figure is the ${view.label}. ${NOT_DOMAIN_PERCENTILE}</p>` : html`<p>${UNRANKED_DOMAIN_STATEMENT}</p>`}
<p class="mm-skip-values"><a href="#domain-values" id="skip-to-values">${SKIP_TO_TABLE}</a></p>
${heatmapFigure(html, model, {orientation})}
${legendBlock(html, {states: model.states, bins: model.hasBins, orientation})}
${alignmentTable(html, view)}
<details class="mm-values" id="domain-values"><summary>${DETAILS_SUMMARY}</summary>${detailTable(html, view)}</details></div>`;
  if (typeof root?.addEventListener === "function") {
    // The skip link opens the closed <details> and moves focus to its summary; the table stays in the DOM either way.
    root.querySelector("#skip-to-values").addEventListener("click", (e) => {
      e.preventDefault(); // the default fragment jump would drop the focus placed below
      const d = root.querySelector("#domain-values");
      d.open = true;
      d.scrollIntoView();
      d.querySelector("summary").focus();
    });
  }
  return root;
}
