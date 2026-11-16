// Filter view-model (layout amendment 2.2, AC-DB-03). Pure functions over stored fields only: they select, order by a stored
// field's position, and clip. Nothing here computes a statistic, a rank or a percentile; the one count is countHiddenRowsByReason (D6, AC-RD-50, AC-DB-36, ADR-036 Amendment 1).
// Hiding rows is selection. The only count is countHiddenRowsByReason (amendment 2.2, AC-DB-36, ADR-036 Amendment 1).
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

// The Period rule of one row: true when its stored date has a year outside from..to. A row without a date (or no valid range) is never outside.
const outsidePeriod = (row, from, to, dateKey) => {
  const y = yearOf(row?.[dateKey]);
  return hasRange(from, to) && y !== null && !inRange(y, from, to);
};

// Scorecard rows whose latest ref_period_end year is outside from..to are hidden (user answer to ADR-034 Q3). A row without a
// reference date (a state row: n/a, not published) is never hidden. Returns the kept rows and the hidden rows as lists.
export function splitByPeriod(rows = [], from = null, to = null, {dateKey = "ref_period_end"} = {}) {
  if (!hasRange(from, to)) return {kept: rows, hidden: []};
  const kept = [];
  const hidden = [];
  for (const r of rows) (outsidePeriod(r, from, to, dateKey) ? hidden : kept).push(r);
  return {kept, hidden};
}

// Hidden-row reasons, in precedence order (ADR-037 A1.4): a hidden row is in exactly one category, the first that applies.
export const HIDDEN_REASONS = Object.freeze(["no_data", "stale", "other_period", "other"]);

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

// One selection function per chart (ADR-037 A1.4; builds on splitByPeriod's Period rule). Returns {drawn, hidden}; `drawn` keeps the input order and
// `hidden` is a list of {row, reason}, `reason` one of HIDDEN_REASONS, assigned from stored fields only. The list renders `hidden` and the counts come
// from countHiddenRowsByReason(hidden): one array, one source. Nothing here reads a value except to test that a stored value exists.
// context (every key optional; with none of the coverage keys the result is the Period split alone):
//   from, to, dateKey          Period years (as splitByPeriod; a row without the date is never hidden by Period)
//   requireValue               true: a row without a stored finite value is `no_data` (also `hasValue(row)` = false, or `hasSeries(row)` = false).
//                              Defaults to true when referencePeriod or hideStale is set (a snapshot chart: a row with no value is `no_data`, which takes
//                              precedence over `stale` and `other_period`); pass false explicitly to keep value-less rows.
//   hideStale                  true: a row whose stored `is_stale` is true is `stale` (snapshot charts; time-series charts and K1 leave it false)
//   referencePeriod            the chart's stored reference period; a row whose stored `dateKey` value differs, or whose stored `alignment` is
//                              "unaligned", is `other_period` unless includeOtherPeriods is true
//   includeOtherPeriods        true: such rows are drawn (the `oth` toggle); the Period filter still applies
//   isOther(row)               stored state that removes the row for another reason (for example not ranked where ranking is shown)
export function splitByCoverage(rows = [], context = {}) {
  const {from = null, to = null, dateKey = "ref_period_end", hideStale = false, referencePeriod = null, includeOtherPeriods = false, hasSeries = null, hasValue = null, isOther = null} = context;
  const requireValue = context.requireValue ?? (referencePeriod !== null || hideStale === true);
  const drawn = [];
  const hidden = [];
  for (const row of rows) {
    let reason = null;
    if (requireValue && (hasSeries?.(row) === false || (hasValue ? !hasValue(row) : !isNumber(row?.value)))) reason = "no_data";
    else if (hideStale && row?.is_stale === true) reason = "stale";
    else if (outsidePeriod(row, from, to, dateKey)) reason = "other_period";
    else if (!includeOtherPeriods && referencePeriod !== null && (row?.alignment === "unaligned" || row?.[dateKey] !== referencePeriod)) reason = "other_period";
    else if (isOther?.(row) === true) reason = "other";
    if (reason === null) drawn.push(row);
    else hidden.push({row, reason});
  }
  return {drawn, hidden};
}

// The one named browser-side count (ADR-036 Amendment 1, ADR-037 A1.4; AC-DB-36): a tally of the stored rows of ONE hidden array by their stored
// reason, nothing else. Returns {total, no_data, stale, other_period, other}; total = the sum of the four, each row in exactly one (an unknown reason
// counts as `other`). The scans whitelist exactly this function; callers render the sentence from copy.js and render nothing at total 0 (I7).
export function countHiddenRowsByReason(hidden = []) {
  const counts = {total: 0, no_data: 0, stale: 0, other_period: 0, other: 0};
  for (const h of hidden) { counts.total += 1; counts[HIDDEN_REASONS.includes(h?.reason) ? h.reason : "other"] += 1; }
  return counts;
}
