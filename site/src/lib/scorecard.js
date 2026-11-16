// V1 country scorecard view-model (docs/specs/dashboard-export-spec.md section 5, AC-DASH-4).
// D6: the browser never computes a rank, percentile, mean, position or n/N. Every number shown is a
// stored field of scorecard/<domain>.json; this module only chooses wording, flags and sort order.
// Sorting by the stored `rank_position` is ordering, not ranking. Fixed wording comes from copy.js; pure functions.

import {AGGREGATE_NOT_RANKED, ALERT_LEVEL_PREFIX, CAVEAT, DIRECTION_LABELS, directionWithTarget, DESCRIPTIVE_CELL, FLAG_AHEAD, FLAG_ESTIMATE, FLAG_INHERITED, FLAG_LAGGING, FLAG_UNALIGNED, FLAG_UNALIGNED_FISCAL, INFORMATIONAL_NOTICE, NA, NOT_PUBLISHED, NOT_RANKED_INFO_ONLY, NOT_RANKED_INHERITED, NO_POSITION, NO_POSITION_LOW_COVERAGE, NO_RANK_STALE, PEER_NOTE_HEAD, PEER_NOTE_TAIL, PERCENTILE_COLUMN_LABEL, UNRANKED, UNRANKED_DOMAIN_CELL, notRankedCell} from "./copy.js";
import {i18n} from "./i18n.js";
const X = (key, params) => i18n.t(key, params);

export {CAVEAT, PERCENTILE_COLUMN_LABEL};

export class ScorecardError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScorecardError";
  }
}

// The states this module can assign. states.js maps every one of them (a test fails when one is added here without a mapping).
export const CELL_STATUSES = Object.freeze(["ranked", "stale", "unranked", "descriptive", "missing", "not_published"]);
export const SUMMARY_STATUSES = Object.freeze(["ranked", "low_coverage", "n/a", "aggregate", "unranked_domain"]);

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v !== "";

// Fails loud on a file that cannot be shown correctly. The label key is required wherever
// `percentile_rank` appears (spec, round 3).
export function validateScorecard(sc) {
  if (sc === null || typeof sc !== "object" || Array.isArray(sc)) throw new ScorecardError("scorecard is not an object");
  if (!isStr(sc.domain_id)) throw new ScorecardError("scorecard has no domain_id");
  if (typeof sc.ranked !== "boolean") throw new ScorecardError(`scorecard ${sc.domain_id}: ranked is not a boolean`);
  if (!isStr(sc.percentile_rank_label)) throw new ScorecardError(`scorecard ${sc.domain_id}: percentile_rank_label is missing`);
  if (!Array.isArray(sc.entities)) throw new ScorecardError(`scorecard ${sc.domain_id}: entities is not a list`);
  for (const e of sc.entities) {
    if (!isStr(e?.entity_id) || !Array.isArray(e.indicators)) throw new ScorecardError(`scorecard ${sc.domain_id}: malformed entity`);
    if (!isStr(e.percentile_rank_label)) throw new ScorecardError(`scorecard ${sc.domain_id}: entity ${e.entity_id} has no percentile_rank_label`);
  }
  return sc;
}

export function formatPercentile(p) {
  return isNum(p) ? p.toFixed(2) : null;
}

export function formatValue(v) {
  if (!isNum(v)) return null;
  return String(Number(v.toPrecision(7)));
}

// Heterogeneous peer set note. Wording is this implementation's (the spec fixes no text, only that the
// note is shown); sizes are the stored `peer_set_size_by_indicator`.
export function peerSetNote(sc) {
  if (sc.heterogeneous_peer_set !== true) return null;
  const {min, max} = sc.peer_set_size_by_indicator ?? {};
  const range = isNum(min) && isNum(max) ? (min === max ? X("X_PEER_RANGE_SAME", {n: min}) : X("X_PEER_RANGE", {min, max})) : "";
  return `${PEER_NOTE_HEAD}${range}${PEER_NOTE_TAIL}`;
}

export function domainNotices(sc, domainMeta) {
  const out = [...(domainMeta?.notices ?? [])];
  if (sc.ranked === false && out.length === 0) out.push(INFORMATIONAL_NOTICE);
  return out;
}

// Direction label of an indicator column (ADR-026 decision 4): a lookup of the stored fields rank_mode, good_dir and target
// of meta/indicators.json. The alert-direction and display-hint fields are not read (ADR-026 decision 4). Returns null when the indicator is unknown or the
// stored combination has no label.
export function directionOf(meta) {
  if (meta === undefined || meta === null) return null;
  if (meta.rank_mode === "descriptive_only") return {key: "descriptive", text: DIRECTION_LABELS.descriptive};
  if (meta.rank_mode === "target_distance") {
    const stored = meta.target?.value;
    const text = isNum(stored) ? directionWithTarget(DIRECTION_LABELS.target, formatValue(stored), meta.unit_label ?? "") : DIRECTION_LABELS.target;
    return {key: "target", text};
  }
  if (meta.rank_mode === "monotone_good" && meta.good_dir === 1) return {key: "higher", text: DIRECTION_LABELS.higher};
  if (meta.rank_mode === "monotone_good" && meta.good_dir === -1) return {key: "lower", text: DIRECTION_LABELS.lower};
  return null;
}

// One indicator cell. `ctx`: {domainRanked, indicator (meta/indicators row or undefined)}. Besides the display texts the cell
// carries the stored fields the heatmap needs (percentile only when it is the one shown); nothing here is derived.
export function indicatorCell(ind, ctx) {
  const meta = ctx.indicator;
  const unit = meta?.unit_label ?? null;
  const base = {
    indicatorId: ind.indicator_id,
    name: meta?.name ?? ind.indicator_id,
    unit,
    refPeriod: ind.ref_period_end ?? null,
    flags: [],
    status: "ok",
    valueText: null,
    percentileText: null,
    percentile: null,
    alignment: ind.alignment ?? null,
    inherited: ind.inherited === true,
    estimate: ind.value_kind === "estimate",
    alertLevel: ind.alert_level === "watch" || ind.alert_level === "alert" ? ind.alert_level : null,
    refOffsetDays: isNum(ind.ref_offset_days) ? ind.ref_offset_days : null,
    releaseAt: typeof ind.source_release_at === "string" ? ind.source_release_at : null,
    ageDays: isNum(ind.age_days) ? ind.age_days : null,
    staleLimitDays: isNum(ind.stale_limit_days) ? ind.stale_limit_days : null,
    staleDetail: null
  };
  if (ind.published === false || ind.publish_scope === "excluded") {
    return {...base, status: "not_published", valueText: NOT_PUBLISHED, percentileText: NOT_PUBLISHED};
  }
  const value = formatValue(ind.value);
  if (value === null) return {...base, status: "missing", valueText: NA, percentileText: NA};
  const flags = [];
  let staleDetail = null;
  if (ind.is_stale === true) {
    const lim = isNum(ind.stale_limit_days) ? `, limit ${ind.stale_limit_days} days` : "";
    const age = isNum(ind.age_days) ? `${ind.age_days} days old` : "age unknown";
    staleDetail = `${age}${lim}`;
    flags.push(`stale (${staleDetail})`);
  }
  if (ind.alignment === "lagging") flags.push(FLAG_LAGGING);
  if (ind.alignment === "ahead") flags.push(FLAG_AHEAD);
  if (ind.alignment === "unaligned") flags.push(ind.alignment_reason === "fiscal_year_basis" ? FLAG_UNALIGNED_FISCAL : FLAG_UNALIGNED);
  if (ind.inherited === true) flags.push(FLAG_INHERITED);
  if (ind.value_kind === "estimate") flags.push(FLAG_ESTIMATE);
  if (ind.alert_level === "watch" || ind.alert_level === "alert") flags.push(`${ALERT_LEVEL_PREFIX}${ind.alert_level}`);
  let status = "ranked";
  let pct;
  let shown = null;
  if (ind.is_stale === true) {
    status = "stale";
    pct = NO_RANK_STALE;
  } else if (ctx.domainRanked === false) {
    status = "unranked";
    pct = UNRANKED_DOMAIN_CELL;
  } else if (ind.rank_mode === "descriptive_only") {
    status = "descriptive";
    pct = DESCRIPTIVE_CELL;
  } else if (!isNum(ind.percentile)) {
    status = "unranked";
    if (ind.inherited === true) pct = NOT_RANKED_INHERITED;
    else if (ind.alignment === "lagging" || ind.alignment === "unaligned") pct = notRankedCell(ind.alignment);
    else if (ind.publish_scope === "info_only") pct = NOT_RANKED_INFO_ONLY;
    else pct = NA;
  } else {
    pct = formatPercentile(ind.percentile);
    shown = ind.percentile;
  }
  return {...base, status, flags, valueText: value, percentileText: pct, percentile: shown, staleDetail};
}

// One row of the domain table. `entityMeta`: meta/entities.json row or undefined.
export function entitySummary(e, sc, entityMeta) {
  const name = entityMeta?.name ?? e.entity_id;
  const coverage = isNum(e.n_available) && isNum(e.n_defined) ? `${e.n_available}/${e.n_defined}` : NA;
  const staleCount = e.indicators.filter((i) => i.is_stale === true).length;
  const row = {entityId: e.entity_id, name, kind: entityMeta?.kind ?? null, hasCountryPage: entityMeta !== undefined && entityMeta !== null && entityMeta.is_global !== true, aggregate: entityMeta?.kind === "aggregate", rankPosition: isNum(e.rank_position) ? e.rank_position : null, coverageText: coverage, staleCount, meanPercentile: null, meanText: null, positionText: NO_POSITION, status: "ranked"};
  if (sc.ranked === false) return {...row, status: "unranked_domain", meanText: UNRANKED, positionText: UNRANKED};
  const mean = e.n_available === 0 || !isNum(e.percentile_rank) ? null : e.percentile_rank;
  if (mean === null) {
    const aggregate = entityMeta?.kind === "aggregate";
    return {...row, status: aggregate ? "aggregate" : "n/a", meanText: aggregate ? AGGREGATE_NOT_RANKED : NA, positionText: NO_POSITION};
  }
  const meanText = formatPercentile(mean);
  if (e.low_coverage === true) return {...row, status: "low_coverage", meanPercentile: mean, meanText, positionText: NO_POSITION_LOW_COVERAGE};
  const pos = isNum(e.rank_position) && isNum(e.n_ranked_entities) ? `${e.rank_position} of ${e.n_ranked_entities}` : NO_POSITION;
  return {...row, meanPercentile: mean, meanText, positionText: pos};
}

// Display order only: stored rank_position ascending, then the rest by name.
export function sortSummaries(rows, positions) {
  const pos = (r) => positions.get(r.entityId);
  return [...rows].sort((a, b) => {
    const pa = isNum(pos(a)) ? pos(a) : Infinity;
    const pb = isNum(pos(b)) ? pos(b) : Infinity;
    return pa - pb || a.name.localeCompare(b.name);
  });
}

// Default display order of the domain page (ADR-026 decision 7): alphabetical by name, then entity id. No stored figure is used.
const byName = (a, b) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId);

// Everything a domain page shows, from the scorecard plus meta lists (plain arrays).
export function domainView(scIn, {entities = [], indicators = [], domains = []} = {}) {
  const sc = validateScorecard(scIn);
  const entityById = new Map(entities.map((x) => [x.entity_id, x]));
  const indById = new Map(indicators.map((x) => [x.indicator_id, x]));
  const domainMeta = domains.find((d) => d.domain_id === sc.domain_id);
  const positions = new Map(sc.entities.map((e) => [e.entity_id, e.rank_position]));
  const summaries = sortSummaries(sc.entities.map((e) => entitySummary(e, sc, entityById.get(e.entity_id))), positions);
  const order = new Map(summaries.map((s, i) => [s.entityId, i]));
  const cells = sc.entities
    .flatMap((e) => e.indicators.map((i) => ({entityId: e.entity_id, entity: entityById.get(e.entity_id)?.name ?? e.entity_id, ...indicatorCell(i, {domainRanked: sc.ranked, indicator: indById.get(i.indicator_id)})})))
    .sort((a, b) => order.get(a.entityId) - order.get(b.entityId) || a.indicatorId.localeCompare(b.indicatorId));
  const alignment = (sc.alignment ?? []).map((a) => ({
    indicatorId: a.indicator_id,
    name: indById.get(a.indicator_id)?.name ?? a.indicator_id,
    rankReferencePeriod: a.rank_reference_period ?? null,
    spreadDays: isNum(a.reference_period_spread_days) ? a.reference_period_spread_days : null,
    nRanked: isNum(a.n_ranked) ? a.n_ranked : null,
    nUnaligned: isNum(a.n_unaligned) ? a.n_unaligned : null
  }));
  // Heatmap columns: the indicators of the domain in the stored order of meta/domains.json, then any other indicator that has
  // a cell. Rows: one per scorecard entity in the default alphabetical order, each with one slot per column (null if absent).
  const cellIds = [...new Set(cells.map((c) => c.indicatorId))].sort();
  const listed = Array.isArray(domainMeta?.indicator_ids) ? domainMeta.indicator_ids.filter((id) => cellIds.includes(id)) : [];
  const columnIds = [...listed, ...cellIds.filter((id) => !listed.includes(id))];
  const columns = columnIds.map((id) => {
    const m = indById.get(id);
    return {indicatorId: id, name: m?.name ?? id, unit: m?.unit_label ?? null, direction: directionOf(m)};
  });
  const rows = [...summaries].sort(byName).map((summary) => ({
    entityId: summary.entityId,
    name: summary.name,
    aggregate: summary.aggregate,
    summary,
    cells: columnIds.map((id) => cells.find((c) => c.entityId === summary.entityId && c.indicatorId === id) ?? null)
  }));
  return {
    domainId: sc.domain_id,
    percentileColumn: PERCENTILE_COLUMN_LABEL,
    name: domainMeta?.name ?? sc.domain_id,
    ranked: sc.ranked,
    label: sc.percentile_rank_label,
    caveat: CAVEAT,
    peerNote: peerSetNote(sc),
    notices: domainNotices(sc, domainMeta),
    summaries,
    columns,
    rows,
    cells,
    alignment,
    indicatorIds: [...new Set(cells.map((c) => c.indicatorId))]
  };
}
