// L24 (layout amendment 4.5, AC-DB-01/10/11): the PG-DOMAIN arrangement. One band (h2: the domain name, with the link to PG-DOMAINS) over one card (h3) that
// holds the V1 heatmap block (scorecard-view.js). The filter bar shows Group (the peer set) and Frequency (the heatmap columns); both only select
// rows and columns of the stored scorecard (cardView, L13). Display only (D6): nothing is computed here.
import {DRAFT_ALL_DOMAINS_LINK} from "./copy.js";
import {glyphSprite} from "./glyphs.js";
import {cardView} from "./heatmap.js";
import {domainBlock} from "./scorecard-view.js";

// view: the unfiltered domainView() (name, ...); inputs: {scorecard, entities, groups, indicators, domains}; store: the filter store (g, f).
export function domainPage(html, view, {store, inputs, allDomainsHref = "../domains"}) {
  // c is cleared: Country is not a control of this page (amendment 2.4), so a carried c must not mark or filter the heatmap.
  const render = () => domainBlock(html, cardView(inputs.scorecard, {...inputs, state: {...store.get(), c: []}}), {card: true});
  const root = html`<div class="mm-domain-page">
${glyphSprite(html)}
<section class="mm-dband" id="band-domain" aria-labelledby="band-domain-heading"><div class="mm-band"><h2 id="band-domain-heading">${view.name}</h2><a href="${allDomainsHref}">${DRAFT_ALL_DOMAINS_LINK}</a></div><div class="mm-grid"><div class="mm-card mm-card--span-12" id="domain-card">${render()}</div></div></section></div>`;
  if (typeof root?.querySelector !== "function") return root;
  store.subscribe(() => root.querySelector("#domain-card").replaceChildren(render()));
  return root;
}
