// V12 (L1, spec 3; AC-V2-14..18, 72, 75, 82, 86): the domain small multiples card of the COUNTRY page. Pure model plus markup. One Plot per panel (Plot facets share one y
// scale, V1 finding), so no panel shares an axis with another and each carries its own unit and caption. Stored values only: a null value is a gap, a stale series is
// drawn with all its stored points (square last-point marker, "stale" in the tip and beside the title). `html` (htl) and `Plot` are passed in.
import {DRAFT_COUNTRY_CARD_TITLES, DRAFT_EMPTY_CARD, DRAFT_FACET_COLLAPSE, DRAFT_FACET_EXPAND, DRAFT_L1_SUMMARY, DRAFT_REGIONS, DRAFT_SERIES_UNREADABLE, DRAFT_SHOW_MORE} from "./copy.js";
import {hiddenRowsRegion} from "./hidden-rows.js";
import {facetBody, seriesFacet, staleCode, xDomainOf} from "./series-chart.js";
import {l1Split, l1Stale} from "./small-multiples.js";
import {busyBlock} from "./state-blocks.js";

// The visible panels (the first `count` items) and what is known of each: built from a loaded series file, still loading, or failed.
// input: {items, none, loaded: Map(indicator_id -> normalised series rows), failed: Set(indicator_id), indicators, entity, state ({from, to}), knownCutoff, shown (keys of the panels shown, small-multiples.js l1Reveal)}.
export function l1Build({items = [], none = [], loaded = new Map(), failed = new Set(), indicators = [], entity, state = {}, knownCutoff = null, shown = []} = {}) {
  const visible = items.filter((it) => shown.includes(it.key));
  const byId = new Map(indicators.map((i) => [i.indicator_id, i]));
  const built = [];
  const pending = [];
  const broken = [];
  for (const item of visible) {
    const id = item.row.indicatorId;
    if (failed.has(id)) broken.push(item);
    else if (!loaded.has(id)) pending.push(item);
    else built.push({item, facet: seriesFacet({rows: loaded.get(id), entityId: entity.entity_id, entityName: entity.name ?? entity.entity_id, meta: item.meta, indicator: byId.get(id) ?? null, stale: l1Stale(item), from: state.from ?? null, to: state.to ?? null, knownCutoff})});
  }
  const split = l1Split({none, built});
  const order = new Map(built.map((b) => [b.facet, b.item]));
  return {visible, built, pending, broken, drawn: split.drawn, hidden: split.hidden, items: order, more: items.length > visible.length};
}

// The facets that are drawn, with their item (for the key and the title), in stored order.
export const l1Panels = (build) => build.drawn.map((facet) => ({facet, item: build.items.get(facet)}));

const hiddenAccessors = {
  label: (e) => e.row.name,
  id: (e) => e.row.indicatorId,
  period: (e) => e.row.periodText,
  sentence: (e) => e.row.state?.sentence,
  href: (e) => `../indicator/${e.row.indicatorId}`
};

// The shared x domain of the card: the Period years when set, else the stored manifest bounds (both are stored values; nothing is derived from the points).
export const l1Domain = (state, bounds) => xDomainOf(state?.from ?? bounds?.from ?? null, state?.to ?? bounds?.to ?? null);

// `detail`: nodes of the expanded panel (L2 and P1a), placed under the grid. `expandedKey`: the key of the expanded panel, if any.
export function l1Card(html, Plot, {domain, build, bounds = null, state = {}, open = false, expandedKey = null, detail = null} = {}) {
  const x = l1Domain(state, bounds);
  const panels = l1Panels(build).map(({facet, item}) => {
    const expanded = item.key === expandedKey;
    const id = `l1-${domain.domainId}-${item.key}`;
    return html`<div class="mm-facet" data-facet="${item.key}" data-indicator="${item.row.indicatorId}" data-stale="${facet.stale ? "true" : "false"}"><div class="mm-facet-head"><h4>${facet.name}</h4>${staleCode(html, facet)}<button type="button" class="mm-facet-expand" data-action="expand" data-facet-key="${item.key}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? DRAFT_FACET_COLLAPSE : DRAFT_FACET_EXPAND}</button></div>${facetBody(html, Plot, facet, {id, domain: x, mini: true})}</div>`;
  });
  // A closed card reads nothing (its series are read when it is opened), so it prints no loading block: nothing would be busy.
  const waiting = build.pending.length === 0 || !open ? "" : busyBlock(html, DRAFT_REGIONS.loadingSeries, {id: `l1-${domain.domainId}-loading`});
  const broken = build.broken.map((item) => html`<p class="mm-state mm-state-empty" data-state="empty" data-indicator="${item.row.indicatorId}">${item.row.name}: ${DRAFT_SERIES_UNREADABLE}</p>`);
  const empty = panels.length === 0 && build.pending.length === 0 && build.broken.length === 0 ? html`<p class="mm-state mm-state-empty" data-state="empty">${DRAFT_EMPTY_CARD}</p>` : "";
  const more = build.more ? html`<p class="mm-l1-more"><button type="button" data-action="more" data-domain="${domain.domainId}">${DRAFT_SHOW_MORE}</button></p>` : "";
  return html`<details class="mm-card mm-card--span-12 mm-l1" data-card="l1" data-domain="${domain.domainId}" open=${open}><summary>${DRAFT_L1_SUMMARY(domain.name)}</summary><h3 class="mm-visually-hidden">${DRAFT_COUNTRY_CARD_TITLES.l1}</h3>${hiddenRowsRegion(html, build.hidden, hiddenAccessors)}<div class="mm-l1-grid" data-slot="facets">${panels}${broken}${waiting}${empty}</div>${more}<div class="mm-l1-detail" data-slot="detail" aria-live="polite">${detail ?? ""}</div></details>`;
}
