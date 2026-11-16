// L24 (layout amendment 4.5, AC-DB-01/10/11): the PG-DOMAIN arrangement. One band (h2: the domain name, with the link to PG-DOMAINS) over one card (h3) that
// holds the V1 heatmap block (scorecard-view.js). The filter bar shows Group (the peer set) and Frequency (the heatmap columns); both only select
// rows and columns of the stored scorecard (cardView, L13). Display only (D6): nothing is computed here.
import {DRAFT_ALL_DOMAINS_LINK, DRAFT_COMPARE_CARD_TITLES, DRAFT_COMPARE_SECONDARY} from "./copy.11b4a285.js";
import {pcSwitch} from "./compare-controls.352a78ad.js";
import {glyphSprite} from "./glyphs.a14b04e8.js";
import {cardView} from "./heatmap.8d634dcc.js";
import {domainBlock} from "./scorecard-view.fad76ad7.js";
import {codeText, unitLabelText, xTickFormat} from "./code-text.538effeb.js";

// V22 (ADR-037 decision 3, A1.7; AC-V2-51 amended): the domain heatmap C5 is the percentile layer. It is rendered on this page only while `pc` is on, as a secondary block that is
// collapsed (a closed <details>); the orientation sentence goes with it. Without pc the page holds the domain's indicator links and the "Show percentile" switch.
// view: the unfiltered domainView() (name, indicatorIds, ...); inputs: {scorecard, entities, groups, indicators, domains}; store: the filter store (g, f, pc).
export function domainPage(html, view, {store, inputs, allDomainsHref = "../domains", indicatorHref = (id) => `../indicator/${id}`}) {
  // c is cleared: Country is not a control of this page (amendment 2.4), so a carried c must not mark or filter the heatmap.
  const heat = () => domainBlock(html, cardView(inputs.scorecard, {...inputs, state: {...store.get(), c: []}}), {card: true, orientation: true});
  const links = () => html`<ul class="mm-domain-indicators" id="domain-indicators">${(view.indicatorIds ?? []).map((id) => (inputs.indicators ?? []).find((i) => i.indicator_id === id)).filter(Boolean).map((i) => html`<li><a href="${indicatorHref(i.indicator_id)}" data-link="indicator" data-carry>${i.name ?? i.indicator_id}</a>${i.unit_label ? html` (${unitLabelText(i.unit_label)})` : ""}</li>`)}</ul>`;
  const render = () => html`${links()}${store.get().pc === true ? html`<details class="mm-secondary" id="c5-secondary" data-card="c5"><summary>${DRAFT_COMPARE_SECONDARY(DRAFT_COMPARE_CARD_TITLES.c5)}</summary>${heat()}</details>` : ""}`;
  const root = html`<div class="mm-domain-page">
${glyphSprite(html)}
<section class="mm-dband" id="band-domain" aria-labelledby="band-domain-heading"><div class="mm-band"><h2 id="band-domain-heading">${view.name}</h2><a href="${allDomainsHref}">${DRAFT_ALL_DOMAINS_LINK}</a></div><div class="mm-grid"><div class="mm-card mm-card--span-12" id="domain-card"><div class="mm-compare-controls">${pcSwitch(html, store)}</div><div id="domain-body">${render()}</div></div></div></section></div>`;
  if (typeof root?.querySelector !== "function") return root;
  store.subscribe(() => root.querySelector("#domain-body").replaceChildren(render()));
  return root;
}
