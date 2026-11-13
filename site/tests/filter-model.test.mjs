// L5 (AC-DB-03, AC-DB-36): filter view-model. Table-driven; stored fields only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HIDDEN_REASONS, clipToPeriod, comparisonSet, countHiddenRowsByReason, countryOptions, frequencyOptions, indicatorList, indicatorsOfDomain,
  indicatorsOfFrequency, periodBounds, presetRange, seriesOfFrequency, splitByCoverage, splitByPeriod
} from "../src/lib/filter-model.js";
import {DRAFT_HIDDEN_ROWS} from "../src/lib/copy.js";

const ent = (id, kind = "country", extra = {}) => ({entity_id: id, kind, is_global: false, ...extra});
const entities = [ent("DE"), ent("FR"), ent("PL"), ent("US"), ent("EU27", "aggregate"), ent("EA", "aggregate"), ent("WLD", "aggregate", {is_global: true})];
const groups = [
  {group_id: "eu", members: [{entity_id: "DE", valid_to: null}, {entity_id: "FR", valid_to: null}, {entity_id: "PL", valid_to: "2000-01-01"}]},
  {group_id: "empty", members: []}
];
const ids = (l) => l.map((e) => e.entity_id);

test("AC-DB-03 group: All countries = kind country; a Group = current members; aggregates always separate reference rows", () => {
  const cases = [
    {groupId: null, countries: ["DE", "FR", "PL", "US"]},
    {groupId: "eu", countries: ["DE", "FR"]},
    {groupId: "empty", countries: []},
    {groupId: "unknown", countries: ["DE", "FR", "PL", "US"]}
  ];
  for (const c of cases) {
    const r = comparisonSet({entities, groups, groupId: c.groupId});
    assert.deepEqual(ids(r.countries), c.countries, String(c.groupId));
    assert.deepEqual(ids(r.references), ["EU27", "EA"], `reference rows regardless of Group ${c.groupId}`);
    assert.ok(![...r.countries, ...r.references].some((e) => e.entity_id === "WLD"), "global entity never listed");
  }
  assert.deepEqual(ids(countryOptions({entities, groups, groupId: "eu"}).aggregates), ["EU27", "EA"]);
});

test("AC-DB-03 group: a focus country outside the group stays selected as the 'in focus' row (not in the list, not dropped)", () => {
  const r = comparisonSet({entities, groups, groupId: "eu", focusIds: ["US", "DE", "EU27", "WLD", "ZZ"]});
  assert.deepEqual(ids(r.outside), ["US"]);
  assert.deepEqual(ids(r.countries), ["DE", "FR"]);
  assert.deepEqual(ids(comparisonSet({entities, groups, groupId: null, focusIds: ["US"]}).outside), []);
});

const indicators = [
  {indicator_id: "gdp", domain_ids: ["growth"], frequency_set: ["Q", "A"]},
  {indicator_id: "cpi", domain_ids: ["prices"], frequency_set: ["M"]},
  {indicator_id: "unemp", domain_ids: ["labour", "growth"], frequency_set: ["M", "Q"]},
  {indicator_id: "orphan", frequency_set: ["A"]}
];
const domains = [{domain_id: "growth", indicator_ids: ["unemp", "gdp"]}, {domain_id: "prices", indicator_ids: ["cpi"]}, {domain_id: "labour", indicator_ids: []}];
const idl = (l) => l.map((i) => i.indicator_id);

test("AC-DB-03 domain: by indicator_ids order, then domain_ids; none = all in stored order; no input mutated", () => {
  const before = JSON.stringify(indicators);
  assert.deepEqual(idl(indicatorsOfDomain(indicators, domains, null)), ["gdp", "cpi", "unemp", "orphan"]);
  assert.deepEqual(idl(indicatorsOfDomain(indicators, domains, "growth")), ["unemp", "gdp"]);
  assert.deepEqual(idl(indicatorsOfDomain(indicators, domains, "prices")), ["cpi"]);
  assert.deepEqual(idl(indicatorsOfDomain(indicators, domains, "labour")), ["unemp"], "domain_ids on the indicator also selects");
  assert.deepEqual(idl(indicatorsOfDomain(indicators, domains, "nope")), []);
  assert.equal(JSON.stringify(indicators), before);
});

test("AC-DB-03 frequency: frequency_set contains the value (mixed-frequency indicator is kept under each of its frequencies)", () => {
  const cases = [["M", ["cpi", "unemp"]], ["Q", ["gdp", "unemp"]], ["A", ["gdp", "orphan"]], ["D", []], [null, ["gdp", "cpi", "unemp", "orphan"]]];
  for (const [f, want] of cases) assert.deepEqual(idl(indicatorsOfFrequency(indicators, f)), want, String(f));
  assert.deepEqual(frequencyOptions(indicators), ["M", "Q", "A"]);
  assert.deepEqual(idl(indicatorList({indicators, domains, domainId: "growth", frequency: "M"})), ["unemp"]);
  assert.deepEqual(idl(indicatorList({indicators, domains, domainId: "growth", frequency: "A"})), ["gdp"]);
  assert.deepEqual(idl(indicatorList({indicators, domains})), ["gdp", "cpi", "unemp", "orphan"]);
});

test("AC-DB-03 series frequency: stored frequency only, no resampling, values untouched (mixed-unit indicator keeps both units)", () => {
  const series = [
    {series_key: "a", frequency: "M", unit: "index"},
    {series_key: "b", frequency: "Q", unit: "percent"},
    {series_key: "c", frequency: "Q", unit: "index"}
  ];
  assert.deepEqual(seriesOfFrequency(series, "Q").map((s) => s.series_key), ["b", "c"]);
  assert.deepEqual(seriesOfFrequency(series, "Q").map((s) => s.unit), ["percent", "index"]);
  assert.equal(seriesOfFrequency(series, null), series);
  assert.deepEqual(seriesOfFrequency(series, "D"), []);
});

test("AC-DB-03 period: bounds from manifest, presets are calendar arithmetic on the cut-off year", () => {
  const b = periodBounds({history_start: "1990-01-01", known_cutoff: "2026-10-31T00:00:00Z"});
  assert.deepEqual(b, {from: 1990, to: 2026});
  assert.equal(periodBounds({history_start: "2030-01-01", known_cutoff: "2026-10-31"}), null);
  assert.equal(periodBounds({}), null);
  assert.deepEqual(presetRange("last10", b), {from: 2017, to: 2026});
  assert.deepEqual(presetRange("last5", b), {from: 2022, to: 2026});
  assert.deepEqual(presetRange("all", b), {from: null, to: null});
  assert.deepEqual(presetRange("last10", {from: 2022, to: 2026}), {from: 2022, to: 2026}, "from held at the first available year");
  assert.deepEqual(presetRange("last10", null), {from: null, to: null});
  assert.deepEqual(presetRange("bogus", b), {from: null, to: null});
});

const pts = [{ref_period_end: "2014-12-31", value: 1}, {ref_period_end: "2015-03-31", value: 2}, {ref_period_end: "2020-12-31", value: 3}, {ref_period_end: "2021-01-31", value: 4}, {value: 5}];

test("AC-DB-03 period: clip is inclusive of the year of ref_period_end and never alters a value", () => {
  assert.deepEqual(clipToPeriod(pts, 2015, 2020).map((p) => p.value), [2, 3]);
  assert.deepEqual(clipToPeriod(pts, 2020, 2020).map((p) => p.value), [3]);
  assert.deepEqual(clipToPeriod(pts, 2030, 2031), []);
  assert.equal(clipToPeriod(pts, null, null), pts);
  assert.equal(clipToPeriod(pts, 2015, null), pts, "a lone bound is no range");
  assert.deepEqual(clipToPeriod(pts, 2015, 2020).map((p) => p.value), [2, 3]);
  assert.deepEqual(pts.map((p) => p.value), [1, 2, 3, 4, 5]);
});

test("AC-DB-03 period: scorecard rows with a latest year outside from..to are hidden and returned as a list; state rows are kept", () => {
  const rows = [{id: "a", ref_period_end: "2026-06-30"}, {id: "b", ref_period_end: "2019-12-31"}, {id: "c", ref_period_end: "2012-12-31"}, {id: "n/a", ref_period_end: null}];
  const r = splitByPeriod(rows, 2017, 2026);
  assert.deepEqual(r.kept.map((x) => x.id), ["a", "b", "n/a"]);
  assert.deepEqual(r.hidden.map((x) => x.id), ["c"]);
  assert.ok(Array.isArray(r.hidden));
  assert.deepEqual(splitByPeriod(rows, 2020, 2026).hidden.map((x) => x.id), ["b", "c"]);
  const none = splitByPeriod(rows, null, null);
  assert.equal(none.kept, rows);
  assert.deepEqual(none.hidden, []);
  assert.deepEqual(splitByPeriod(rows, 2013, 2013, {dateKey: "x"}).hidden, [], "a row without the date key is never hidden");
});

const tally = (rows, from, to, opts = {}) => countHiddenRowsByReason(splitByCoverage(rows, {from, to, ...opts}).hidden);

test("AC-DB-36 / ADR-036 Amendment 1: the Period-only split counts as other_period; N = 0 renders no sentence; no percentage or total", () => {
  const rows = [{ref_period_end: "2026-06-30"}, {ref_period_end: "2019-12-31"}, {ref_period_end: "2012-12-31"}, {ref_period_end: null}];
  assert.equal(tally(rows, 2017, 2026).total, 1);
  assert.deepEqual(tally(rows, 2020, 2026), {total: 2, no_data: 0, stale: 0, other_period: 2, other: 0});
  assert.equal(tally(rows, 2000, 2026).total, 0);
  assert.equal(tally(rows, null, null).total, 0);
  assert.equal(tally([], 2017, 2026).total, 0);
  assert.equal(tally(rows, 2020, 2026).total, splitByPeriod(rows, 2020, 2026).hidden.length, "same Period rule as splitByPeriod");
  assert.deepEqual(splitByCoverage(rows, {from: 2020, to: 2026}).drawn, splitByPeriod(rows, 2020, 2026).kept);
  assert.equal(DRAFT_HIDDEN_ROWS(tally(rows, 2000, 2026).total), "");
  assert.equal(DRAFT_HIDDEN_ROWS(tally(rows, 2020, 2026).total), "2 rows hidden by the period filter");
  assert.ok(!/%|total|of \d/.test(DRAFT_HIDDEN_ROWS(2)));
  assert.deepEqual(countHiddenRowsByReason(), {total: 0, no_data: 0, stale: 0, other_period: 0, other: 0});
});

const cov = [
  {id: "ok", value: 1, ref_period_end: "2025-12-31", is_stale: false, alignment: "aligned"},
  {id: "nov", value: null, ref_period_end: null, is_stale: false},
  {id: "nov-stale", value: null, ref_period_end: "2025-12-31", is_stale: true},
  {id: "stale", value: 2, ref_period_end: "2025-12-31", is_stale: true},
  {id: "stale-old", value: 3, ref_period_end: "2023-12-31", is_stale: true},
  {id: "uns", value: 4, ref_period_end: "2025-12-31", alignment: "unaligned"},
  {id: "old", value: 5, ref_period_end: "2024-12-31", alignment: "aligned"},
  {id: "far", value: 6, ref_period_end: "2012-12-31", alignment: "aligned"},
  {id: "nr", value: 7, ref_period_end: "2025-12-31", alignment: "aligned", ranked: false}
];
const snap = {requireValue: true, hideStale: true, referencePeriod: "2025-12-31", from: 2020, to: 2026, isOther: (r) => r.ranked === false};
const reasons = (res) => Object.fromEntries(res.hidden.map((h) => [h.row.id, h.reason]));

test("V4 splitByCoverage: each hidden row has exactly one reason by precedence no_data, stale, other_period, other", () => {
  const r = splitByCoverage(cov, snap);
  assert.deepEqual(r.drawn.map((x) => x.id), ["ok"]);
  assert.deepEqual(reasons(r), {nov: "no_data", "nov-stale": "no_data", stale: "stale", "stale-old": "stale", uns: "other_period", old: "other_period", far: "other_period", nr: "other"});
  assert.equal(r.drawn.length + r.hidden.length, cov.length, "drawn and hidden partition the input");
  assert.deepEqual(r.drawn, [cov[0]], "drawn rows are the input objects, unaltered, in input order");
});

test("V4 splitByCoverage: no_data comes from a missing series or a missing stored value, never from a computation", () => {
  const rows = [{id: "a", value: 0}, {id: "b", value: NaN}, {id: "c", value: "x"}, {id: "d", value: 1, series: false}];
  const r = splitByCoverage(rows, {requireValue: true, hasSeries: (x) => x.series !== false});
  assert.deepEqual(r.drawn.map((x) => x.id), ["a"], "a stored zero is a value");
  assert.deepEqual(r.hidden.map((h) => h.row.id), ["b", "c", "d"]);
  assert.ok(r.hidden.every((h) => h.reason === "no_data"));
  assert.deepEqual(splitByCoverage([{id: "z", hasValue: false}], {requireValue: true, hasValue: (x) => x.hasValue}).hidden.map((h) => h.reason), ["no_data"]);
  assert.equal(splitByCoverage([{id: "n"}], {}).hidden.length, 0, "without requireValue a row with no value is not hidden (tables keep such rows)");
});

test("V4 splitByCoverage: with referencePeriod or hideStale set, requireValue defaults to true so no_data wins over other_period and stale", () => {
  const rows = [{id: "a", value: null, ref_period_end: "2024-12-31", alignment: "unaligned", is_stale: true}, {id: "b", ref_period_end: "2024-12-31"}, {id: "ok", value: 1, ref_period_end: "2025-12-31"}];
  const byRef = splitByCoverage(rows, {referencePeriod: "2025-12-31"});
  assert.deepEqual(reasons(byRef), {a: "no_data", b: "no_data"});
  assert.deepEqual(byRef.drawn.map((x) => x.id), ["ok"]);
  assert.deepEqual(reasons(splitByCoverage(rows, {hideStale: true})), {a: "no_data", b: "no_data"});
  assert.deepEqual(reasons(splitByCoverage(rows, {referencePeriod: "2025-12-31", hideStale: true, requireValue: false})), {a: "stale", b: "other_period"}, "an explicit false is respected");
  assert.equal(splitByCoverage(rows, {}).hidden.length, 0, "neither key set: default stays false");
  assert.equal(splitByCoverage(rows, {from: 2020, to: 2026}).hidden.length, 0, "Period alone does not require a value");
});

test("V4 splitByCoverage: time-series charts keep stale rows (hideStale off); the stl toggle and oth toggle remove rows from the hidden array", () => {
  const off = splitByCoverage(cov, {...snap, hideStale: false});
  assert.ok(!Object.values(reasons(off)).includes("stale"));
  assert.ok(off.drawn.some((x) => x.id === "stale"), "stale row is drawn when staleness does not hide");
  const oth = splitByCoverage(cov, {...snap, includeOtherPeriods: true});
  assert.ok(oth.drawn.some((x) => x.id === "uns") && oth.drawn.some((x) => x.id === "old"), "other-period rows are drawn with oth=1");
  assert.deepEqual(oth.hidden.map((h) => h.row.id).sort(), ["far", "nov", "nov-stale", "nr", "stale", "stale-old"].sort(), "far is still outside the Period filter");
  assert.equal(reasons(oth).far, "other_period");
});

test("V4 property: total equals the hidden array length and the four categories sum to total, for generated inputs", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let n = 0; n < 200; n += 1) {
    const rows = Array.from({length: Math.floor(rnd() * 30)}, (_, i) => ({id: i, value: rnd() < 0.3 ? null : rnd(), is_stale: rnd() < 0.3, alignment: rnd() < 0.3 ? "unaligned" : "aligned", ref_period_end: `${2010 + Math.floor(rnd() * 17)}-12-31`, ranked: rnd() < 0.8}));
    const ctx = {requireValue: rnd() < 0.8, hideStale: rnd() < 0.5, referencePeriod: rnd() < 0.5 ? "2025-12-31" : null, includeOtherPeriods: rnd() < 0.3, from: rnd() < 0.5 ? 2015 : null, to: rnd() < 0.5 ? 2026 : null, isOther: (r) => r.ranked === false};
    const {drawn, hidden} = splitByCoverage(rows, ctx);
    const c = countHiddenRowsByReason(hidden);
    assert.equal(c.total, hidden.length);
    assert.equal(c.no_data + c.stale + c.other_period + c.other, c.total);
    assert.equal(drawn.length + hidden.length, rows.length);
    for (const k of HIDDEN_REASONS) assert.equal(c[k], hidden.filter((h) => h.reason === k).length);
  }
});

test("V4 countHiddenRowsByReason: a tally of stored reasons; an unknown reason is counted as other so each row is in one category", () => {
  assert.deepEqual(countHiddenRowsByReason([{reason: "stale"}, {reason: "stale"}, {reason: "no_data"}, {reason: "weird"}, {}]), {total: 5, no_data: 1, stale: 2, other_period: 0, other: 2});
  assert.deepEqual([...HIDDEN_REASONS], ["no_data", "stale", "other_period", "other"]);
});
