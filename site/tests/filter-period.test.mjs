// L9 (AC-DB-01, 02, 03, 04): Period chip model. DOM behaviour (refusal message, preset, reset, disabled state) is in smoke/filterbar.smoke.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {periodSummaryValue, periodYears, validatePair} from "../src/lib/filter-period.js";
import {periodBounds, presetRange} from "../src/lib/filter-model.js";
import {createFilterStore} from "../src/lib/filter-store.js";
import {DRAFT_PERIOD_PRESETS} from "../src/lib/copy.js";

const bounds = periodBounds({history_start: "1991-01-01", known_cutoff: "2026-11-04T00:00:00Z"});

test("years run from the year of history_start to the year of known_cutoff; absent history_start gives no bounds and no years", () => {
  assert.deepEqual(bounds, {from: 1991, to: 2026});
  const y = periodYears(bounds);
  assert.equal(y[0], 1991);
  assert.equal(y.at(-1), 2026);
  assert.equal(y.length, 36);
  assert.equal(periodBounds({known_cutoff: "2026-11-04"}), null);
  assert.deepEqual(periodYears(null), []);
});

test("a pair is valid only with from <= to inside the bounds; from > to is refused", () => {
  assert.deepEqual(validatePair("2015", "2025", bounds), {ok: true, from: 2015, to: 2025});
  assert.deepEqual(validatePair(2020, 2020, bounds), {ok: true, from: 2020, to: 2020});
  assert.equal(validatePair(2025, 2015, bounds).ok, false);
  assert.equal(validatePair(1980, 2015, bounds).ok, false);
  assert.equal(validatePair(2015, 2030, bounds).ok, false);
  assert.equal(validatePair(2015, 2020, null).ok, false);
  assert.equal(validatePair("x", 2020, bounds).ok, false);
});

test("presets: All clears, Last 10 / Last 5 years end at the cut-off year (calendar arithmetic)", () => {
  assert.deepEqual(presetRange("all", bounds), {from: null, to: null});
  assert.deepEqual(presetRange("last10", bounds), {from: 2017, to: 2026});
  assert.deepEqual(presetRange("last5", bounds), {from: 2022, to: 2026});
});

test("summary value follows the 'Period: 2015 to 2025' pattern; no pair shows All", () => {
  assert.equal(periodSummaryValue({from: 2015, to: 2025}), "2015 to 2025");
  assert.equal(periodSummaryValue({from: null, to: null}), DRAFT_PERIOD_PRESETS.all);
});

test("the store writes from/to only as a pair, in the fixed order, and reset clears both", () => {
  const win = {location: {pathname: "/", search: "", hash: ""}, history: {state: null, calls: [], replaceState(_s, _t, u) { this.calls.push(u); win.location.hash = u.includes("#") ? u.slice(u.indexOf("#")) : ""; }}, addEventListener() {}, removeEventListener() {}};
  const store = createFilterStore({win, known: {bounds}});
  store.set({from: 2015, to: 2025});
  assert.equal(win.location.hash, "#from=2015&to=2025");
  store.reset();
  assert.equal(win.location.hash, "");
});

test("a hash pair outside the bounds or reversed is ignored with the note (nothing invented)", async () => {
  const {parseHash} = await import("../src/lib/hash.js");
  for (const h of ["#from=2025&to=2015", "#from=1980&to=2000", "#from=2015"]) {
    const s = parseHash(h, {bounds});
    assert.deepEqual([s.from, s.to, s.note], [null, null, true], h);
  }
});
