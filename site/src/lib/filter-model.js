// Filter view-model (layout amendment 2.2, AC-DB-03). Pure functions over stored fields only: they select, order by a stored
// field's position, and clip. Nothing here computes a statistic, a rank or a percentile; the one count is countPeriodHiddenRows (D6, AC-RD-50, AC-DB-36).
// Hiding rows is selection. The only count is countPeriodHiddenRows (amendment 2.2, AC-DB-36).
const FREQUENCY_ORDER = ["D", "M", "Q", "A"];

const yearOf = (isoDate) => {
  const y = /^(\d{4})/.exec(String(isoDate ?? ""));
  return y ? Number(y[1]) : null;
};
export {yearOf};

// Calendar years the Period selects can offer: from the year of manifest.history_start to the year of manifest.known_cutoff.
export function periodBounds(manifest) {
  const from = yearOf(manifest?.history_start);
  const to = yearOf(manifest?.known_cutoff);
  return from === null || to === null || from > to ? null : {from, to};
}

// Presets of the Period chip. "all" clears the range (null/null); the others are calendar arithmetic on the stored cut-off year,
// never on data. `from` is held at the first available year.
export function presetRange(preset, bounds) {
  if (!bounds || preset === "all") return {from: null, to: null};
  const n = {last10: 10, last5: 5}[preset];
  if (!n) return {from: null, to: null};
  const from = bounds.to - (n - 1);
  return {from: from < bounds.from ? bounds.from : from, to: bounds.to};
}

const memberIds = (group) => (group?.members ?? []).filter((m) => m.valid_to == null).map((m) => m.entity_id);

// Comparison set (amendment 2.2). Group "All countries" (groupId null) = entities with kind = country. A Group = its current members
// with kind = country. Aggregates (kind = aggregate, not global) are always the separate reference rows. A focus Country outside the
// Group stays selected and is returned in `outside` (shown as the outlined "in focus" row). Order is the stored order of `entities`.
export function comparisonSet({entities = [], groups = [], groupId = null, focusIds = []} = {}) {
  const countries = entities.filter((e) => e.kind === "country" && !e.is_global);
  const group = groupId ? groups.find((g) => g.group_id === groupId) : null;
  const members = group ? new Set(memberIds(group)) : null;
  const inSet = members ? countries.filter((e) => members.has(e.entity_id)) : countries;
  const references = entities.filter((e) => e.kind === "aggregate" && !e.is_global);
  const shown = new Set([...inSet, ...references].map((e) => e.entity_id));
  const outside = focusIds.map((id) => entities.find((e) => e.entity_id === id)).filter((e) => e && !e.is_global && !shown.has(e.entity_id));
  return {countries: inSet, references, outside};
}

// Entities offered by the Country control: not global; restricted to the Group's members when g is set (plus the aggregates sub-list).
export function countryOptions({entities = [], groups = [], groupId = null} = {}) {
  const {countries, references} = comparisonSet({entities, groups, groupId});
  return {countries, aggregates: references};
}

// Domain: the indicators a domain lists (its stored indicator_ids order); no domain = every indicator in stored order.
export function indicatorsOfDomain(indicators = [], domains = [], domainId = null) {
  if (!domainId) return indicators;
  const ids = domains.find((d) => d.domain_id === domainId)?.indicator_ids;
  const set = new Set(ids ?? []);
  const byId = new Map(indicators.map((i) => [i.indicator_id, i]));
  const stored = (ids ?? []).map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(stored);
  return [...stored, ...indicators.filter((i) => !seen.has(i) && (i.domain_ids ?? []).includes(domainId))];
}

// Frequency keeps indicators whose stored frequency_set[] contains the value. No resampling.
export function indicatorsOfFrequency(indicators = [], frequency = null) {
  return frequency ? indicators.filter((i) => (i.frequency_set ?? []).includes(frequency)) : indicators;
}

// The Indicator list: narrowed by Domain, then Frequency.
export function indicatorList({indicators = [], domains = [], domainId = null, frequency = null} = {}) {
  return indicatorsOfFrequency(indicatorsOfDomain(indicators, domains, domainId), frequency);
}

// Frequencies present in the stored indicators, in the order D, M, Q, A.
export function frequencyOptions(indicators = []) {
  const present = new Set(indicators.flatMap((i) => i.frequency_set ?? []));
  return FREQUENCY_ORDER.filter((f) => present.has(f));
}

// Series: keep those whose stored `frequency` equals the filter. No resampling.
export function seriesOfFrequency(series = [], frequency = null) {
  return frequency ? series.filter((s) => s.frequency === frequency) : series;
}

const inRange = (year, from, to) => year !== null && year >= from && year <= to;
const hasRange = (from, to) => Number.isInteger(from) && Number.isInteger(to);

// Period clips a list of dated values to the years from..to inclusive of the year of ref_period_end. Stored values are not altered.
export function clipToPeriod(values = [], from = null, to = null, {dateKey = "ref_period_end"} = {}) {
  if (!hasRange(from, to)) return values;
  return values.filter((v) => inRange(yearOf(v?.[dateKey]), from, to));
}

// Scorecard rows whose latest ref_period_end year is outside from..to are hidden (user answer to ADR-034 Q3). A row without a
// reference date (a state row: n/a, not published) is never hidden. Returns the kept rows and the hidden rows as lists.
export function splitByPeriod(rows = [], from = null, to = null, {dateKey = "ref_period_end"} = {}) {
  if (!hasRange(from, to)) return {kept: rows, hidden: []};
  const kept = [];
  const hidden = [];
  for (const r of rows) {
    const y = yearOf(r?.[dateKey]);
    (y === null || inRange(y, from, to) ? kept : hidden).push(r);
  }
  return {kept, hidden};
}

// The one named browser-side count (amendment 2.2, AC-DB-36): rows before minus rows after the Period row filter of ONE card, from the
// card's loaded rows and from/to only. The scans whitelist exactly this function. Callers render DRAFT_HIDDEN_ROWS(n): no sentence at 0.
export function countPeriodHiddenRows(rows = [], from = null, to = null, opts = {}) {
  return rows.length - splitByPeriod(rows, from, to, opts).kept.length;
}
