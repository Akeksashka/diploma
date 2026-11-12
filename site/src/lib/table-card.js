// L17 (layout amendment 4.9 phase A, 5, AC-DB-03, AC-DB-26, ADR-036): the indicator table card of PG-HOME ("Indicators" band). It reuses the RD C-CTRY-3
// table builder of country-view.js (domainTable) for the selected Domain's indicators and the one focus Country, with Frequency and Period applied.
// Phase A: no Trend column and no sparkline (no `recent` field in the export); nothing here reads one. Display only (D6): every cell is a stored field
// formatted by country-model.js. The band exists only when exactly one known Country is in focus (otherwise the band is hidden).
// Period row-filters this card (ADR-036): rows whose latest ref_period_end year is outside from..to are hidden and listed in a disclosure; the one
// count is countPeriodHiddenRows over this card's rows (same arguments as the split). Rows without a value (no date) are never hidden by Period.
import {DRAFT_EMPTY_CARD, DRAFT_HIDDEN_ROW_ITEM, DRAFT_HIDDEN_ROWS, DRAFT_REGIONS, DRAFT_SUBREGION_CONSEQUENCE} from "./copy.js";
import {applyFilter, COUNTRY_TABLE_HREFS, countryFilter, domainTable} from "./country-view.js";
import {countryModel} from "./country-model.js";
import {countPeriodHiddenRows, indicatorsOfFrequency, splitByPeriod} from "./filter-model.js";
import {glyphSprite} from "./glyphs.js";
import {serializeHash} from "./hash.js";
import {sortRows} from "./sort.js";
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
//   {kind: "empty", text, hiddenSentence, hiddenRows}        (nothing to show)
//   {kind: "table", entity, domain, hiddenSentence, hiddenRows}
export function tableModel({focusIds = [], entities = [], domain = null, scorecard = null, indicators = [], series = [], groups = [], state = {}} = {}) {
  const entity = focusIds.length === 1 ? entities.find((e) => e.entity_id === focusIds[0]) ?? null : null;
  if (!entity || !domain) return {kind: "hidden"};
  const ids = tableIndicatorIds({domain, indicators, frequency: state.f ?? null});
  const cm = countryModel({entity, domains: [{...domain, indicator_ids: ids}], scorecards: {[domain.domain_id]: scorecard}, indicators, series, groups});
  const built = cm.domains[0] ?? null;
  const none = {kind: "empty", text: DRAFT_EMPTY_CARD, hiddenSentence: "", hiddenRows: []};
  if (!built || built.rows.length === 0) return none;
  // Period (ADR-036): one split per render; the count and the list come from the same arguments.
  const opts = {dateKey: "refPeriodEnd"};
  const from = state.from ?? null;
  const to = state.to ?? null;
  const {kept, hidden} = splitByPeriod(built.withValue, from, to, opts);
  const hiddenSentence = DRAFT_HIDDEN_ROWS(countPeriodHiddenRows(built.withValue, from, to, opts));
  // Hidden rows: by name A to Z, ties by id (ADR-036 I4, as rank-model.js does).
  const hiddenRows = sortRows(sortRows(hidden, "indicatorId", {nameKey: "indicatorId"}), "name").map((r) => ({indicatorId: r.indicatorId, text: DRAFT_HIDDEN_ROW_ITEM(r.name, r.periodText ?? r.refPeriodEnd ?? "")}));
  const shown = {...built, withValue: kept, rows: [...kept, ...built.withoutValue], withoutValueHeading: cm.withoutValueHeading};
  if (shown.rows.length === 0) return {...none, hiddenSentence, hiddenRows};
  return {kind: "table", entity: {id: entity.entity_id, name: entity.name ?? entity.entity_id}, domain: shown, hiddenSentence, hiddenRows};
}

// The disclosure of the rows the Period filter hid. Visible only when the model's sentence is non-empty (ADR-036 I3).
export function hiddenRowsBlock(html, model, hrefs = HOME_TABLE_HREFS) {
  if (!model.hiddenSentence) return "";
  return html`<details class="mm-hidden-rows"><summary>${model.hiddenSentence}</summary><ul>${model.hiddenRows.map((h) => html`<li data-indicator="${h.indicatorId}"><a href="${hrefs.indicatorName(h.indicatorId)}" data-link="indicator-name" data-carry>${h.text}</a></li>`)}</ul></details>`;
}

// Mounts the card into dash.slots.indicators. `data`: the meta lists (entities, indicators, series, groups).
export function mountTableCard(html, dash, {data, doc = globalThis.document}) {
  const slot = dash.slots.indicators;
  const band = slot.closest?.(".mm-dband") ?? null;
  slot.classList.add("mm-card--table");
  const title = doc.createElement("h3");
  const status = doc.createElement("div"); // persistent live region: a changed sentence is announced (ADR-036 I5)
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
      status.replaceChildren(...(model.hiddenSentence ? [hiddenRowsBlock(html, model)] : []));
      if (model.kind === "table") {
        const sprite = doc.getElementById("mm-g-dash") ? [] : [glyphSprite(html)];
        body.replaceChildren(...sprite, domainTable(html, model.domain, model.entity.name, model.entity.id, null, HOME_TABLE_HREFS));
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
