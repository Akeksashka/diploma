import assert from "node:assert/strict";
import {test} from "node:test";
import {PERCENTILE_LABEL, indicatorUnit, multText, rebaseUnit, seriesUnit, unitText} from "../src/lib/units.js";

test("indicator unit is unit_label as stored; missing is null", () => {
  assert.equal(indicatorUnit({unit_label: "% y/y"}), "% y/y");
  for (const i of [{}, {unit_label: ""}, {unit_label: null}, null, undefined]) assert.equal(indicatorUnit(i), null);
});
test("unit_mult text only when not 0", () => {
  assert.equal(multText({unit_code: "USD", unit_mult: 6}), "values in USD x 10^6");
  assert.equal(multText({unit_code: "USD", unit_mult: 0}), null);
  assert.equal(multText({unit_code: "USD", unit_mult: null}), null);
  assert.equal(multText({unit_code: "", unit_mult: 3}), null);
  assert.deepEqual(unitText({series: {unit_code: "EUR", unit_mult: 3}}), {unit: "EUR", note: "values in EUR x 10^3"});
  assert.deepEqual(unitText({series: {unit_code: "EUR", unit_mult: 0}}), {unit: "EUR", note: null});
  assert.equal(seriesUnit({}), null);
});
test("rebase replaces the unit", () => {
  assert.equal(rebaseUnit("2020-01"), "index, 2020-01 = 100");
  assert.equal(rebaseUnit(null), null);
  assert.deepEqual(unitText({indicator: {unit_label: "%"}, series: {unit_code: "EUR", unit_mult: 3}, rebaseBase: "2020"}), {unit: "index, 2020 = 100", note: null});
});
test("indicator-level selection and percentile label", () => {
  assert.deepEqual(unitText({indicator: {unit_label: "%"}}), {unit: "%", note: null});
  assert.deepEqual(unitText({indicator: {}}), {unit: null, note: null});
  assert.equal(PERCENTILE_LABEL, "percentile vs all ranked countries");
});
