// L7 (AC-DB-01 part, AC-DB-03): option builders, applicability matrix, and the pinned rule for a selected indicator that falls out of a
// narrowed Indicator list.
import test from "node:test";
import assert from "node:assert/strict";
import {CONTROLS_BY_PAGE, controlsFor, domainOptions, frequencySelectOptions, groupOptions, indicatorIdsOffered, indicatorLabel, indicatorOptionGroups, patchWithIndicatorRule, summaryParts} from "../src/lib/filter-bar-options.js";
import {DRAFT_FILTER_ALL, DRAFT_FILTER_LABELS as L, DRAFT_FREQUENCY_NAMES} from "../src/lib/copy.js";

const domains = [{domain_id: "growth", name: "Growth"}, {domain_id: "prices", name: "Prices"}, {domain_id: "labour", name: "Labour"}];
const indicators = [
  {indicator_id: "gdp", name: "GDP", unit_label: "index", domain_ids: ["growth"], frequency_set: ["Q", "A"]},
  {indicator_id: "cpi", name: "CPI", unit_label: "% y/y", domain_ids: ["prices"], frequency_set: ["M"]},
  {indicator_id: "unemp", name: "Unemployment", unit_label: "%", domain_ids: ["labour", "growth"], frequency_set: ["M", "Q"]},
  {indicator_id: "orphan", name: "Orphan", unit_label: null, frequency_set: ["A"]}
];
const data = {indicators, domains};

test("applicability matrix (amendment 2.4): Group not on country/series, Indicator only on home/indicator/series, Domain not on indicator/domain pages", () => {
  assert.deepEqual(controlsFor("home"), ["group", "country", "domain", "indicator", "period", "frequency"]);
  assert.ok(!controlsFor("country").includes("group") && !controlsFor("country").includes("indicator"));
  assert.ok(!controlsFor("series").includes("group"));
  assert.deepEqual(controlsFor("domain"), ["group", "frequency"]);
  assert.ok(!controlsFor("indicator").includes("domain") && !controlsFor("indicator").includes("frequency") && !controlsFor("indicator").includes("period"));
  assert.deepEqual(controlsFor("nope"), []);
  assert.ok(Object.isFrozen(CONTROLS_BY_PAGE));
});

test("group/domain/frequency options: 'All' first with an empty value, then stored order; frequencies only those present, as D M Q A names", () => {
  assert.deepEqual(groupOptions([{group_id: "g7", name: "G7"}, {group_id: "eu"}]), [{value: "", label: DRAFT_FILTER_ALL.countries}, {value: "g7", label: "G7"}, {value: "eu", label: "eu"}]);
  assert.deepEqual(domainOptions(domains).map((o) => o.value), ["", "growth", "prices", "labour"]);
  assert.equal(domainOptions(domains)[0].label, DRAFT_FILTER_ALL.domains);
  assert.deepEqual(frequencySelectOptions(indicators), [{value: "", label: DRAFT_FILTER_ALL.frequencies}, {value: "M", label: DRAFT_FREQUENCY_NAMES.M}, {value: "Q", label: DRAFT_FREQUENCY_NAMES.Q}, {value: "A", label: DRAFT_FREQUENCY_NAMES.A}]);
});

test("indicator options: unit beside the name; grouped by the first domain, in domains order; no-domain indicator in a final flat group", () => {
  assert.equal(indicatorLabel(indicators[0]), "GDP (index)");
  assert.equal(indicatorLabel(indicators[3]), "Orphan");
  const r = indicatorOptionGroups(data);
  assert.deepEqual(r.empty, {value: "", label: L.all});
  assert.deepEqual(r.groups.map((g) => [g.label, g.options.map((o) => o.value)]), [["Growth", ["gdp"]], ["Prices", ["cpi"]], ["Labour", ["unemp"]], [null, ["orphan"]]]);
});

test("indicator options are narrowed by Domain (listed under that domain) and by Frequency", () => {
  const byDomain = indicatorOptionGroups({...data, domainId: "growth"});
  assert.deepEqual(byDomain.groups.map((g) => [g.label, g.options.map((o) => o.value)]), [["Growth", ["gdp", "unemp"]]]);
  assert.deepEqual(indicatorIdsOffered({...data, frequency: "M"}), ["cpi", "unemp"]);
  assert.deepEqual(indicatorIdsOffered({...data, domainId: "growth", frequency: "A"}), ["gdp"]);
  assert.deepEqual(indicatorIdsOffered({...data, domainId: "prices", frequency: "A"}), []);
});

test("RULE: a Domain or Frequency change that drops the selected indicator from the list clears it (i = null)", () => {
  const cases = [
    {name: "domain narrows it out", state: {i: "gdp", d: null, f: null}, patch: {d: "prices"}, want: {d: "prices", i: null}},
    {name: "frequency narrows it out", state: {i: "cpi", d: null, f: null}, patch: {f: "A"}, want: {f: "A", i: null}},
    {name: "domain keeps it (indicator in two domains)", state: {i: "unemp", d: null, f: null}, patch: {d: "growth"}, want: {d: "growth"}},
    {name: "frequency keeps it", state: {i: "gdp", d: null, f: null}, patch: {f: "Q"}, want: {f: "Q"}},
    {name: "combined domain and frequency narrow it out", state: {i: "unemp", d: "labour", f: null}, patch: {f: "A"}, want: {f: "A", i: null}},
    {name: "no indicator selected: nothing to clear", state: {i: null, d: null, f: null}, patch: {d: "prices"}, want: {d: "prices"}},
    {name: "widening to All keeps it", state: {i: "gdp", d: "growth", f: null}, patch: {d: null}, want: {d: null}},
    {name: "a Group change never touches it", state: {i: "gdp", d: "growth", f: null}, patch: {g: "g7"}, want: {g: "g7"}},
    {name: "choosing an indicator directly is not reconciled", state: {i: null, d: "prices", f: null}, patch: {i: "gdp"}, want: {i: "gdp"}}
  ];
  for (const c of cases) assert.deepEqual(patchWithIndicatorRule(c.state, c.patch, data), c.want, c.name);
});

test("the rule does not mutate its inputs", () => {
  const state = Object.freeze({i: "gdp", d: null, f: null});
  const patch = Object.freeze({d: "prices"});
  patchWithIndicatorRule(state, patch, data);
  assert.deepEqual(patch, {d: "prices"});
});

test("L10 summaryParts: active filters only, matrix order, names from meta, page-aware", () => {
  const meta = {groups: [{group_id: "g7", name: "G7"}], entities: [{entity_id: "DEU", name: "Germany"}, {entity_id: "FRA", name: "France"}], domains, indicators};
  assert.deepEqual(summaryParts({g: null, c: [], d: null, i: null, f: null, from: null, to: null}, "home", meta), []);
  const all = {g: "g7", c: ["DEU", "FRA"], d: "prices", i: "gdp", f: "Q", from: 2015, to: 2025};
  assert.deepEqual(summaryParts(all, "home", meta), ["Group: G7", "Country: Germany, France", "Domain: Prices", "Indicator: GDP", "Period: 2015 to 2025", "Frequency: Quarterly"]);
  assert.deepEqual(summaryParts(all, "domain", meta), ["Group: G7", "Frequency: Quarterly"], "controls the page does not render are left out");
  assert.deepEqual(summaryParts({c: ["XXX"], from: 2015, to: null}, "home", meta), ["Country: XXX"], "unknown id shows the id; half a period pair is not a period");
});
