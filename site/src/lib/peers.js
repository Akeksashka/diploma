// V2 peer comparison view-model (docs/specs/dashboard-export-spec.md sections 5 and 12; AC-DASH-9).
// D6: the browser never computes a rank, percentile, n or spread. The peer-group filter only
// FILTERS rows and sorts them; every percentile shown is the stored `percentile` ("percentile vs all
// ranked countries"), whatever the filter. The optional `peer_group_percentile` is not built.
import {AGGREGATE_NOT_RANKED, ALL_LABEL, CAVEAT, FILTER_NOTE, GROUP_LABELS, NON_EURO_MARK, PERCENTILE_COLUMN_LABEL, SORT_LABELS} from "./copy.js";
import {directionOf, indicatorCell, validateScorecard} from "./scorecard.js";
import {i18n} from "./i18n.js";
const X = (key, params) => i18n.t(key, params);

export {ALL_LABEL, CAVEAT, FILTER_NOTE, GROUP_LABELS, NON_EURO_MARK, PERCENTILE_COLUMN_LABEL};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export const ALL_GROUP = "all";
// Display names for the group ids of config/entities.yaml live in copy.js (GROUP_LABELS); unknown ids fall back to the exported name.
export const EURO_GROUP = "euro_area";
export const SORT_OPTIONS = Object.entries(SORT_LABELS).map(([id, label]) => ({id, label}));

export function groupLabel(g) {
  return GROUP_LABELS[g.group_id] ?? g.name ?? g.group_id;
}

export function groupOptions(groups) {
  return [{id: ALL_GROUP, label: ALL_LABEL}, ...groups.map((g) => ({id: g.group_id, label: groupLabel(g)}))];
}

// Members of a group on a date (ISO yyyy-mm-dd compares as text). An unreadable date keeps only
// open-ended memberships. Date logic only selects rows; nothing is computed from values.
export function groupMembers(group, onDate) {
  const day = typeof onDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(onDate) ? onDate.slice(0, 10) : null;
  const out = new Set();
  for (const m of group?.members ?? []) {
    if (day === null) {
      if (m.valid_to == null) out.add(m.entity_id);
    } else if (m.valid_from <= day && (m.valid_to == null || m.valid_to >= day)) out.add(m.entity_id);
  }
  return out;
}

// Peer rows of one indicator. `ctx`: {entityById, indicator (meta row), domainRanked, euro (Set|null)}.
function peerRow(e, ind, ctx) {
  const entityMeta = ctx.entityById.get(e.entity_id);
  const cell = indicatorCell(ind, {domainRanked: ctx.domainRanked, indicator: ctx.indicator});
  const aggregate = entityMeta?.kind === "aggregate";
  const flags = [...cell.flags];
  const hasNotes = (ctx.indicator?.notes ?? []).length > 0;
  if (hasNotes && !aggregate && ctx.euro && !ctx.euro.has(e.entity_id)) flags.push(NON_EURO_MARK);
  let mark = null;
  if (ind.alignment === "lagging" || ind.alignment === "unaligned") mark = ind.alignment;
  let status = cell.status;
  let percentileText = cell.percentileText;
  if (aggregate && status !== "not_published" && status !== "missing") {
    status = "aggregate";
    percentileText = AGGREGATE_NOT_RANKED;
  }
  return {
    entityId: e.entity_id,
    name: entityMeta?.name ?? e.entity_id,
    kind: entityMeta?.kind ?? null,
    valueText: cell.valueText,
    valueNum: isNum(ind.value) ? ind.value : null,
    unit: cell.unit,
    refPeriod: cell.refPeriod,
    refOffsetDays: cell.refOffsetDays,
    hollow: cell.estimate || cell.inherited,
    status,
    mark,
    flags,
    percentileText,
    percentile: status === "ranked" && isNum(ind.percentile) ? ind.percentile : null
  };
}

// Everything a V2 page needs: per indicator the rows, the stored alignment figures and the notes.
// `groups`: meta/groups.json list; `knownCutoff`: manifest value (date of the membership test).
export function peerView(scIn, {entities = [], indicators = [], groups = [], knownCutoff = null} = {}) {
  const sc = validateScorecard(scIn);
  const entityById = new Map(entities.map((x) => [x.entity_id, x]));
  const indById = new Map(indicators.map((x) => [x.indicator_id, x]));
  const members = new Map(groups.map((g) => [g.group_id, groupMembers(g, knownCutoff)]));
  const euro = members.has(EURO_GROUP) ? members.get(EURO_GROUP) : null;
  const alignById = new Map((sc.alignment ?? []).map((a) => [a.indicator_id, a]));
  const ids = [...new Set(sc.entities.flatMap((e) => e.indicators.map((i) => i.indicator_id)))].sort();
  const out = ids.map((id) => {
    const meta = indById.get(id);
    const rows = [];
    for (const e of sc.entities) {
      const ind = e.indicators.find((i) => i.indicator_id === id);
      if (ind) rows.push(peerRow(e, ind, {entityById, indicator: meta, domainRanked: sc.ranked, euro}));
    }
    const a = alignById.get(id);
    return {
      indicatorId: id,
      name: meta?.name ?? id,
      unit: meta?.unit_label ?? null,
      direction: directionOf(meta)?.text ?? null,
      rankMode: meta?.rank_mode ?? (rows.some((r) => r.status === "descriptive") ? "descriptive_only" : null),
      notes: [...(meta?.notes ?? [])],
      rankReferencePeriod: a?.rank_reference_period ?? null,
      spreadDays: isNum(a?.reference_period_spread_days) ? a.reference_period_spread_days : null,
      maxSpreadDays: isNum(a?.max_ref_spread_days) ? a.max_ref_spread_days : null,
      nRanked: isNum(a?.n_ranked) ? a.n_ranked : null,
      nUnaligned: isNum(a?.n_unaligned) ? a.n_unaligned : null,
      rows
    };
  });
  return {
    domainId: sc.domain_id,
    ranked: sc.ranked,
    label: sc.percentile_rank_label,
    percentileColumn: PERCENTILE_COLUMN_LABEL,
    caveat: CAVEAT,
    filterNote: FILTER_NOTE,
    groupOptions: groupOptions(groups),
    entityIds: new Set(sc.entities.map((e) => e.entity_id)),
    members,
    indicators: out,
    sortOptions: SORT_OPTIONS
  };
}

// FILTER: keeps the rows of one group in their order; unknown group id keeps all rows.
export function filterRows(rows, groupId, members) {
  if (groupId === ALL_GROUP || !members.has(groupId)) return rows;
  const set = members.get(groupId);
  return rows.filter((r) => set.has(r.entityId));
}

// SORT: ordering by stored fields only (percentile, value, name); missing values last.
export function sortRows(rows, key) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const num = (f, dir) => (a, b) => {
    const x = a[f];
    const y = b[f];
    if (x === null && y === null) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return dir * (x - y) || byName(a, b);
  };
  const cmp = key === "name" ? byName : key === "value_desc" ? num("valueNum", -1) : key === "value_asc" ? num("valueNum", 1) : num("percentile", -1);
  return [...rows].sort(cmp);
}

// The state of one panel: selected indicator, group and sort, each validated against the view.
export function panelState(pv, {indicator, group, sort, focus = null} = {}) {
  const ind = pv.indicators.find((i) => i.indicatorId === indicator) ?? pv.indicators.find((i) => i.rankMode !== "descriptive_only") ?? pv.indicators[0] ?? null;
  const g = pv.groupOptions.some((o) => o.id === group) ? group : ALL_GROUP;
  const s = pv.sortOptions.some((o) => o.id === sort) ? sort : "percentile";
  if (ind === null) return {indicator: null, group: g, sort: s, focus: null, rows: [], empty: true};
  const rows = sortRows(filterRows(ind.rows, g, pv.members), s);
  return {indicator: ind, group: g, sort: s, focus: rows.some((r) => r.entityId === focus) ? focus : null, rows, empty: rows.length === 0};
}

// Text for the stored spread; null when the indicator has no ranking (descriptive or unranked).
export function spreadText(ind) {
  if (ind.spreadDays === null && ind.rankReferencePeriod === null) return null;
  const lim = ind.maxSpreadDays === null ? "" : X("X_SPREAD_LIMIT", {days: ind.maxSpreadDays});
  const spread = ind.spreadDays === null ? X("X_SPREAD_NA") : i18n.tp("X_SPREAD_DAYS", ind.spreadDays);
  const common = ind.rankReferencePeriod === null ? "" : X("X_SPREAD_COMMON", {period: ind.rankReferencePeriod});
  const n = ind.nRanked === null ? "" : X("X_SPREAD_RANKED", {n: ind.nRanked});
  const un = ind.nUnaligned ? X("X_SPREAD_UNALIGNED", {n: ind.nUnaligned}) : "";
  return `${X("X_SPREAD_HEAD", {spread})}${lim}${common}${n}${un}.`;
}

// URL-hash focus (T118): `#c=<entity_id>`. Returns the id only when it is one of `ids`; anything else (empty, malformed,
// unknown, repeated or extra keys) is ignored (null). Nothing is stored anywhere but the address.
export function focusFromHash(hash, ids) {
  const m = /^#c=([A-Za-z0-9_.-]{1,40})$/.exec(typeof hash === "string" ? hash : "");
  return m && ids.has(m[1]) ? m[1] : null;
}

export const focusHash = (entityId) => `#c=${entityId}`;
