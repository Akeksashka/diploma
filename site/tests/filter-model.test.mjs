// L5 (AC-DB-03, AC-DB-36): filter view-model. Table-driven; stored fields only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  clipToPeriod, comparisonSet, countPeriodHiddenRows, countryOptions, frequencyOptions, indicatorList, indicatorsOfDomain,
  indicatorsOfFrequency, periodBounds, presetRange, seriesOfFrequency, splitByPeriod
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

test("AC-DB-36: countPeriodHiddenRows = rows before minus rows after; N = 0 renders no sentence; no percentage or total", () => {
  const rows = [{ref_period_end: "2026-06-30"}, {ref_period_end: "2019-12-31"}, {ref_period_end: "2012-12-31"}, {ref_period_end: null}];
  assert.equal(countPeriodHiddenRows(rows, 2017, 2026), 1);
  assert.equal(countPeriodHiddenRows(rows, 2020, 2026), 2);
  assert.equal(countPeriodHiddenRows(rows, 2000, 2026), 0);
  assert.equal(countPeriodHiddenRows(rows, null, null), 0);
  assert.equal(countPeriodHiddenRows([], 2017, 2026), 0);
  assert.equal(countPeriodHiddenRows(rows, 2020, 2026), splitByPeriod(rows, 2020, 2026).hidden.length);
  assert.equal(DRAFT_HIDDEN_ROWS(countPeriodHiddenRows(rows, 2000, 2026)), "");
  assert.equal(DRAFT_HIDDEN_ROWS(countPeriodHiddenRows(rows, 2020, 2026)), "2 rows hidden by the period filter");
  assert.ok(!/%|total|of \d/.test(DRAFT_HIDDEN_ROWS(2)));
});
