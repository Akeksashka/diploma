// Redesign R3 (spec 5.1): pure mapping of stored fields to {key, code, signature, sentence}. No DOM, no computation of
// values; it reads only the fields named in the spec. `n/a` always carries a sentence. Wording comes from copy.js.
//
// Precedence when several stored conditions hold is NOT stated by spec 5.1; it is the order of scorecard.js indicatorCell and
// states.js cellKey: not published, missing value, stale, then (unranked domain: alignment, inherited, plain) or (descriptive)
// or (no percentile: alignment, inherited, info only, n/a) or (percentile: alignment, ahead, ranked). Aggregate entities are not
// in scorecard.js cells; they are placed after alignment and inherited, before the rank-dependent states. A test pins the order
// against states.js cellState on the same stored fields.
import {AGGREGATE_NOT_RANKED, AHEAD_NAME, DESCRIPTIVE_CELL, DRAFT_G_STR1_NO_SERIES, DRAFT_NA_DEFINED_SENTENCE, DRAFT_NA_NO_PERCENTILE_SENTENCE, DRAFT_NA_NO_RANKED_SENTENCE, DRAFT_NOT_PUBLISHED_SENTENCE, FLAG_UNALIGNED_FISCAL, NOT_RANKED_INFO_ONLY, NOT_RANKED_INHERITED, STALE_NAME, UNRANKED_DOMAIN_CELL, notRankedCell} from "./copy.js";
import {STATES} from "./states.js";

const out = (key, sentence) => Object.freeze({key, code: STATES[key].code, signature: STATES[key].signature, sentence});

// Set of "indicator_id|entity_id" for the rows of meta/series.json: the "series defined" lookup (a read of a stored list).
export function seriesDefinedSet(seriesRows) {
  return new Set(seriesRows.map((r) => `${r.indicator_id}|${r.entity_id}`));
}

// cell: stored indicator row of a scorecard entity. ctx: {entityId, entityKind, domainRanked, seriesDefined: Set}.
export function mapCellState(cell, ctx) {
  if (cell.published === false || cell.publish_scope === "excluded") return out("not_published", DRAFT_NOT_PUBLISHED_SENTENCE);
  if (cell.value === null || cell.value === undefined) {
    const defined = ctx.seriesDefined.has(`${cell.indicator_id}|${ctx.entityId}`);
    return out("na", defined ? DRAFT_NA_DEFINED_SENTENCE : DRAFT_G_STR1_NO_SERIES);
  }
  if (cell.is_stale === true) return out("stale", STALE_NAME);
  const hasPct = typeof cell.percentile === "number" && Number.isFinite(cell.percentile);
  const unrankedDomain = ctx.domainRanked === false;
  if (!unrankedDomain && cell.rank_mode === "descriptive_only") return out("descriptive", DESCRIPTIVE_CELL);
  if (cell.alignment === "lagging") return out("lagging", notRankedCell("lagging"));
  if (cell.alignment === "unaligned") {
    const base = notRankedCell("unaligned");
    return out("unaligned", cell.alignment_reason === "fiscal_year_basis" ? `${base}; ${FLAG_UNALIGNED_FISCAL}` : base);
  }
  if (unrankedDomain || !hasPct) {
    if (cell.inherited === true) return out("inherited", NOT_RANKED_INHERITED);
    if (ctx.entityKind === "aggregate") return out("aggregate", AGGREGATE_NOT_RANKED);
    if (unrankedDomain) return out("plain", UNRANKED_DOMAIN_CELL);
    if (cell.publish_scope === "info_only") return out("plain", NOT_RANKED_INFO_ONLY);
    return out("na", DRAFT_NA_NO_PERCENTILE_SENTENCE);
  }
  if (ctx.entityKind === "aggregate") return out("aggregate", AGGREGATE_NOT_RANKED);
  if (cell.alignment === "ahead") return out("ahead", AHEAD_NAME);
  return out("ranked", null);
}

// Domain figure of a country row: row = stored scorecard entity ({percentile_rank, n_available}).
export function mapDomainSummaryState(row, ctx) {
  if (ctx.entityKind === "aggregate") return out("aggregate", AGGREGATE_NOT_RANKED);
  if (ctx.domainRanked === false) return out("plain", UNRANKED_DOMAIN_CELL);
  const hasPct = typeof row.percentile_rank === "number" && Number.isFinite(row.percentile_rank);
  if (!hasPct) return out("na", row.n_available === 0 ? DRAFT_NA_NO_RANKED_SENTENCE : DRAFT_NA_NO_PERCENTILE_SENTENCE);
  return out("ranked", null);
}
