// L8 (AC-DB-01, 04): Country chip model. Pure functions; the DOM behaviour (keyboard, Escape, outside close) is in smoke/filterbar.smoke.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {countryChipLists, countrySummaryValue, matchesText, MAX_COUNTRIES, toggleCountry} from "../src/lib/filter-country.js";
import {wireChip} from "../src/lib/filter-chip.js";
import {createFilterStore} from "../src/lib/filter-store.js";
import {CONTROLS_BY_PAGE} from "../src/lib/filter-bar-options.js";
import {DRAFT_COUNTRY_SELECTED, DRAFT_FILTER_ALL} from "../src/lib/copy.js";

const entities = [
  {entity_id: "POL", name: "Poland", kind: "country"},
  {entity_id: "DEU", name: "Germany", kind: "country"},
  {entity_id: "FRA", name: "France", kind: "country"},
  {entity_id: "EA", name: "Euro area", kind: "aggregate"},
  {entity_id: "WLD", name: "World", kind: "aggregate", is_global: true},
  {entity_id: "G20", name: "G20", kind: "aggregate"}
];
const groups = [{group_id: "eu", name: "EU", members: [{entity_id: "DEU", valid_to: null}, {entity_id: "FRA", valid_to: null}]}];

test("countries alphabetical by stored name, aggregates in their own list, global entities excluded", () => {
  const l = countryChipLists({entities, groups});
  assert.deepEqual(l.countries.map((e) => e.entity_id), ["FRA", "DEU", "POL"]);
  assert.deepEqual(l.aggregates.map((e) => e.entity_id), ["EA", "G20"]);
  assert.ok(![...l.countries, ...l.aggregates].some((e) => e.is_global));
});

test("restricted to the Group's members when g is set; a selected id outside the Group stays listed", () => {
  assert.deepEqual(countryChipLists({entities, groups, groupId: "eu"}).countries.map((e) => e.entity_id), ["FRA", "DEU"]);
  assert.deepEqual(countryChipLists({entities, groups, groupId: "eu", selected: ["POL"]}).countries.map((e) => e.entity_id), ["FRA", "DEU", "POL"]);
  assert.deepEqual(countryChipLists({entities, groups, selected: ["WLD"]}).aggregates.map((e) => e.entity_id), ["EA", "G20"], "global never offered");
});

test("up to five selected; the sixth is refused and nothing changes; unchecking works; re-checking is a no-op", () => {
  assert.equal(MAX_COUNTRIES, 5);
  const five = ["A", "B", "C", "D", "E"];
  assert.deepEqual(toggleCountry(five, "F", true), {refused: true});
  assert.deepEqual(toggleCountry(five, "C", false), {c: ["A", "B", "D", "E"]});
  assert.deepEqual(toggleCountry(five, "A", true), {c: five});
  assert.deepEqual(toggleCountry(["A"], "B", true), {c: ["A", "B"]});
});

test("summary value: All countries / the name / n selected", () => {
  assert.equal(countrySummaryValue([], entities), DRAFT_FILTER_ALL.countries);
  assert.equal(countrySummaryValue(["DEU"], entities), "Germany");
  assert.equal(countrySummaryValue(["DEU", "FRA"], entities), DRAFT_COUNTRY_SELECTED(2));
});

test("text filter is a case-insensitive substring of the name; empty matches all", () => {
  assert.ok(matchesText(entities[0], "pol") && matchesText(entities[0], "  ") && !matchesText(entities[0], "ger"));
});

test("the chip writes c through the store: hash c=..., cap 5 enforced by the store, other keys untouched", () => {
  const win = {location: {pathname: "/", search: "", hash: "#g=eu"}, history: {state: null, replaceState(_s, _t, u) { win.location.hash = u.slice(u.indexOf("#")); }}, addEventListener() {}, removeEventListener() {}};
  const store = createFilterStore({win, maxEntities: 5});
  store.set({c: ["DEU", "FRA"]});
  assert.equal(win.location.hash, "#c=DEU,FRA&g=eu");
  store.set({c: ["A", "B", "C", "D", "E", "F"]});
  assert.equal(store.get().c.length, 5);
});

test("applicability: the chip is built only where the matrix lists Country and the page is home or series (amendment 2.4)", () => {
  for (const p of ["home", "series"]) assert.ok(CONTROLS_BY_PAGE[p].includes("country"));
  assert.ok(!CONTROLS_BY_PAGE.domain.includes("country"));
});

test("wireChip: Escape closes an open chip and focuses the summary; outside press and focus close it; inside do not; no trap", () => {
  const listeners = {};
  const docL = {};
  const doc = {addEventListener: (t, f) => (docL[t] = f), removeEventListener() {}};
  let focused = 0;
  const summary = {focus: () => focused++};
  const inside = {};
  const details = {open: true, ownerDocument: doc, querySelector: () => summary, addEventListener: (t, f) => (listeners[t] = f), contains: (n) => n === inside};
  wireChip(details);
  let prevented = false;
  listeners.keydown({key: "a", preventDefault() {}});
  assert.equal(details.open, true);
  listeners.keydown({key: "Escape", preventDefault: () => (prevented = true)});
  assert.deepEqual([details.open, focused, prevented], [false, 1, true]);
  details.open = true;
  docL.pointerdown({target: inside});
  docL.focusin({target: inside});
  assert.equal(details.open, true);
  docL.focusin({target: {}});
  assert.equal(details.open, false);
  details.open = true;
  docL.pointerdown({target: {}});
  assert.equal(details.open, false);
});
