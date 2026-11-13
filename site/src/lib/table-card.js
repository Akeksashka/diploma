// L17 (layout amendment 4.9 phase A, 5, AC-DB-03, AC-DB-26, ADR-036): the indicator table card of PG-HOME ("Indicators" band). It reuses the RD C-CTRY-3
// table builder of country-view.js (domainTable) for the selected Domain's indicators and the one focus Country, with Frequency and Period applied.
// Phase A: no Trend column and no sparkline (no `recent` field in the export); nothing here reads one. Display only (D6): every cell is a stored field
// formatted by country-model.js. The band exists only when exactly one known Country is in focus (otherwise the band is hidden).
// Period row-filters this card (ADR-036, A1.4): rows whose latest ref_period_end year is outside from..to are hidden and listed in the hidden-rows region
// (hidden-rows.js: label, reason category, stored period, stored reason sentence); the count and the list come from the one `hidden` array of this card's
// split. Rows without a value (no date) are never hidden by Period.
import {DRAFT_EMPTY_CARD, DRAFT_REGIONS, DRAFT_SUBREGION_CONSEQUENCE} from "./copy.js";
import {applyFilter, COUNTRY_TABLE_HREFS, countryFilter, domainTable} from "./country-view.js";
import {countryModel} from "./country-model.js";
import {indicatorsOfFrequency, splitByCoverage} from "./filter-model.js";
import {glyphSprite} from "./glyphs.js";
import {serializeHash} from "./hash.js";
import {hiddenRowsRegion} from "./hidden-rows.js";
import {busyBlock, errorBlock, failureKind} from "./state-blocks.js";

// Links from the home page (the page sits at the site root); data-carry keeps the filter hash (L10).
export const HOME_TABLE_HREFS = Object.freeze({
  indicatorName: (indicatorId) => `./indicator/${indicatorId}`,
  indicator: (indicatorId, entityId) => `./indicator/${indicatorId}${serializeHash({c: [entityId]})}`,
  series: (indicatorId, entityId) => `./explorer${serializeHash({i: indicatorId, c: [entityId]})}`
});
export {COUNTRY_TABLE_HREFS};

// Indicator ids of the table: the Domain's own list in stored order, narrowed by Frequency (stored frequency_set, no resampling).
export function tableIndicatorIds({domain, indicators = [], frequency = null} = {}) {
  const ids = domain?.indicator_ids ?? [];
  if (!frequency) return [...ids];
  const kept = new Set(indicatorsOfFrequency(indicators.filter((i) => ids.includes(i.indicator_id)), frequency).map((i) => i.indicator_id));
  return ids.filter((id) => kept.has(id));
}

// input: {focusIds, entities, domain, scorecard, indicators, series, groups, state: {f, from, to}}. Returns one of
//   {kind: "hidden"}                                        (not exactly one known entity in focus: the band is omitted)
//   {kind: "empty", text, hidden}        (nothing to show)
//   {kind: "table", entity, domain, hidden}   (hidden: [{row, reason}] of splitByCoverage)
export function tableModel({focusIds = [], entities = [], domain = null, scorecard = null, indicators = [], series = [], groups = [], state = {}} = {}) {
  const entity = focusIds.length === 1 ? entities.find((e) => e.entity_id === focusIds[0]) ?? null : null;
  if (!entity || !domain) return {kind: "hidden"};
  const ids = tableIndicatorIds({domain, indicators, frequency: state.f ?? null});
  const cm = countryModel({entity, domains: [{...domain, indicator_ids: ids}], scorecards: {[domain.domain_id]: scorecard}, indicators, series, groups});
  const built = cm.domains[0] ?? null;
  const none = {kind: "empty", text: DRAFT_EMPTY_CARD, hidden: []};
  if (!built || built.rows.length === 0) return none;
  // Period (ADR-036): one split per render; the count and the list come from the same arguments.
  const split = splitByCoverage(built.withValue, {from: state.from ?? null, to: state.to ?? null, dateKey: "refPeriodEnd"});
  const kept = split.drawn;
  const hidden = split.hidden;
  const shown = {...built, withValue: kept, rows: [...kept, ...built.withoutValue], withoutValueHeading: cm.withoutValueHeading};
  if (shown.rows.length === 0) return {...none, hidden};
  return {kind: "table", entity: {id: entity.entity_id, name: entity.name ?? entity.entity_id}, domain: shown, hidden};
}

// The hidden-rows region of the rows the Period filter hid (A1.4): the persistent role="status" wrapper, empty at N = 0 (ADR-036 I3, I5, I7).
export const hiddenRowsBlock = (html, model, hrefs = HOME_TABLE_HREFS) => hiddenRowsRegion(html, model.hidden, {href: (row) => hrefs.indicatorName(row.indicatorId)});

// Mounts the card into dash.slots.indicators. `data`: the meta lists (entities, indicators, series, groups).
export function mountTableCard(html, dash, {data, doc = globalThis.document}) {
  const slot = dash.slots.indicators;
  const band = slot.closest?.(".mm-dband") ?? null;
  slot.classList.add("mm-card--table");
  const title = doc.createElement("h3");
  const status = doc.createElement("div"); // persistent live region: a changed summary is announced (ADR-036 I5); it holds the content of hiddenRowsRegion
  status.setAttribute("role", "status");
  status.className = "mm-hidden-slot";
  const filter = countryFilter(html);
  const controls = doc.createElement("div");
  controls.className = "mm-country-controls";
  controls.append(filter);
  const body = doc.createElement("div");
  body.className = "mm-country mm-table-body";
  body.setAttribute("data-filter", "all");
  dash.fill(slot, title, status, controls, body);
  dash.busy(slot);
  let mode = "all";
  filter.addEventListener("change", (e) => {
    mode = e.target.value;
    applyFilter(body, mode);
  });

  const show = (on) => {
    if (band) band.hidden = !on;
  };

  return dash.onChange((ctx) => {
    const focusIds = ctx.state.c ?? [];
    const needs = focusIds.length === 1;
    show(needs);
    if (!needs) {
      body.replaceChildren();
      status.replaceChildren();
      dash.fill(slot);
      return;
    }
    dash.fill(slot, title, status, controls, body);
    title.textContent = ctx.domain?.name ?? ctx.domainId ?? "";
    if (ctx.error) {
      status.replaceChildren();
      body.replaceChildren(errorBlock(html, {region: DRAFT_REGIONS.scorecard, kind: failureKind(ctx.error, "missing"), consequence: DRAFT_SUBREGION_CONSEQUENCE, id: "table-error"}));
      return;
    }
    if (ctx.loading || !ctx.scorecard) {
      status.replaceChildren();
      body.replaceChildren(busyBlock(html, DRAFT_REGIONS.scorecard, {id: "table-loading"}));
      dash.busy(slot);
      return;
    }
    try {
      const model = tableModel({focusIds, entities: data.entities, domain: ctx.domain, scorecard: ctx.scorecard, indicators: data.indicators, series: data.series ?? [], groups: data.groups ?? [], state: ctx.state});
      status.replaceChildren(...hiddenRowsBlock(html, model).childNodes);
      if (model.kind === "table") {
        const sprite = doc.getElementById("mm-g-dash") ? [] : [glyphSprite(html)];
        body.replaceChildren(...sprite, domainTable(html, model.domain, model.entity.name, model.entity.id, null, HOME_TABLE_HREFS, {percentile: ctx.state.pc === true}));
        applyFilter(body, mode);
      } else {
        body.replaceChildren(html`<p class="mm-state mm-state-empty" id="table-empty" data-state="empty">${model.text}</p>`);
      }
    } catch {
      status.replaceChildren();
      body.replaceChildren(errorBlock(html, {region: DRAFT_REGIONS.scorecard, kind: "invalid", consequence: DRAFT_SUBREGION_CONSEQUENCE, id: "table-error"}));
    }
  });
}
