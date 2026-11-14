// V56 / G-HOME-CONST: Home constants in one place. DRAFT: the user confirms or changes them (G-HOME-CONST blocks release).
// Display defaults only; nothing is computed here. A constant that names an id the export does not carry is reported, never thrown.
import {DRAFT_HOME_COUNTRIES} from "./home-constants.js";

export const HOME_DEFAULT_INDICATOR = "A05"; // decided by the user 2026-11-13 (ADR-037 A2.3, AC-V2-121); the confirmation of the rest is open
export const HOME_KPI_ENTITY = "EA"; // DRAFT; if absent, the first aggregate (resolveHome)
export const HOME_KPI_IDS = Object.freeze(["M09", "M10", "M11", "P01", "A01", "M18"]); // DRAFT
export const HOME_HIGHLIGHT = DRAFT_HOME_COUNTRIES; // DRAFT, cap 5
export const HOME_HIGHLIGHT_CAP = 5;

// Resolve the constants against the stored meta lists. Returns the effective ids and `missing`: [{constant, id}] for the disclosure.
// `indicators` / `entities` are the meta lists (indicator_id, entity_id, kind). No rows are needed: an indicator that is present in the
// catalogue but has no series or scorecard row still resolves; the cards then show their own "no data" state.
export function resolveHome({indicators = [], entities = []} = {}) {
  const missing = [];
  const hasInd = new Set(indicators.map((i) => i.indicator_id));
  const hasEnt = new Map(entities.map((e) => [e.entity_id, e]));
  const defaultIndicator = hasInd.has(HOME_DEFAULT_INDICATOR) ? HOME_DEFAULT_INDICATOR : null;
  if (!defaultIndicator) missing.push({constant: "HOME_DEFAULT_INDICATOR", id: HOME_DEFAULT_INDICATOR});
  let kpiEntity = hasEnt.has(HOME_KPI_ENTITY) ? HOME_KPI_ENTITY : null;
  if (!kpiEntity) {
    missing.push({constant: "HOME_KPI_ENTITY", id: HOME_KPI_ENTITY});
    kpiEntity = entities.find((e) => e.kind === "aggregate")?.entity_id ?? null;
  }
  const kpiIds = [];
  for (const id of HOME_KPI_IDS) (hasInd.has(id) ? kpiIds : missing).push(hasInd.has(id) ? id : {constant: "HOME_KPI_IDS", id});
  const highlight = [];
  for (const id of HOME_HIGHLIGHT) (hasEnt.has(id) ? highlight : missing).push(hasEnt.has(id) ? id : {constant: "HOME_HIGHLIGHT", id});
  return {defaultIndicator, kpiEntity, kpiIds, highlight: highlight.slice(0, HOME_HIGHLIGHT_CAP), missing};
}
