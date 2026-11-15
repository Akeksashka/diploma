// Ukrainian entity names (V47, OQ-21 / D-6). Pure, no imports.
// ISO3-to-ISO2 is a committed static table (not computed): Intl.DisplayNames 'region' is keyed by ISO2.
// Aggregates are hand-proposed and never sent through Intl ("EA" is an ISO2 code for Ceuta and Melilla).
// Every name is `proposed`; only the user sets `reviewed` (G-LANG-STR).
export const ISO3_TO_ISO2 = Object.freeze({
  ARG: "AR", AUS: "AU", AUT: "AT", BEL: "BE", BGR: "BG", BRA: "BR", CAN: "CA", CHN: "CN", CYP: "CY", CZE: "CZ",
  DEU: "DE", DNK: "DK", ESP: "ES", EST: "EE", FIN: "FI", FRA: "FR", GBR: "GB", GRC: "GR", HRV: "HR", HUN: "HU",
  IDN: "ID", IND: "IN", IRL: "IE", ITA: "IT", JPN: "JP", KOR: "KR", LTU: "LT", LUX: "LU", LVA: "LV", MEX: "MX",
  MLT: "MT", NLD: "NL", NOR: "NO", POL: "PL", PRT: "PT", ROU: "RO", SAU: "SA", SVK: "SK", SVN: "SI", SWE: "SE",
  TUR: "TR", UKR: "UA", USA: "US", ZAF: "ZA",
});

// Hand proposals for aggregates; status `proposed`.
export const AGGREGATE_PROPOSALS = Object.freeze({
  EU27: "Європейський Союз (27)",
  EA: "Єврозона",
  WLD: "Світ",
});

// proposeName(entityId, displayNames): displayNames is `new Intl.DisplayNames(['uk'], {type: 'region'})` or null.
// Returns {uk, source, status:'proposed'}; uk is "" when nothing could be proposed.
export function proposeName(entityId, displayNames, english) {
  if (Object.hasOwn(AGGREGATE_PROPOSALS, entityId)) return {uk: AGGREGATE_PROPOSALS[entityId], source: "hand", status: "proposed"};
  const iso2 = Object.hasOwn(ISO3_TO_ISO2, entityId) ? ISO3_TO_ISO2[entityId] : null;
  if (iso2 && displayNames) {
    let n;
    try { n = displayNames.of(iso2); } catch { n = undefined; }
    if (typeof n === "string" && n !== "" && n !== iso2 && n !== english) return {uk: n, source: "intl", status: "proposed"};
  }
  return {uk: "", source: "none", status: "proposed"};
}

// resolveName(entity, lang, names): names = {ID: {uk, status}} (status "reviewed" only when the user set it).
// Returns {text, lang}; lang is the value for the element's lang attribute.
export function resolveName(entity, lang, names = {}) {
  const en = entity.name;
  if (lang !== "uk") return {text: en, lang: "en"};
  const row = Object.hasOwn(names, entity.entity_id) ? names[entity.entity_id] : null;
  if (row && row.status === "reviewed" && typeof row.uk === "string" && row.uk !== "") return {text: row.uk, lang: "uk"};
  return {text: en, lang: "en"};
}
