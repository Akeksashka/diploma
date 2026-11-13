// V3: compatibility and basis check on the synthetic v2_export fixture (stored fields only).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {checkCompatible} from "../src/lib/compat.js";

const meta = JSON.parse(readFileSync(new URL("./fixtures/v2_export/meta/series.json", import.meta.url), "utf8")).series;
const pick = (ind, ents, freq) => meta.filter((s) => s.indicator_id === ind && ents.includes(s.entity_id) && (!freq || s.frequency === freq));
const fields = (r) => r.blocked.map((b) => b.field);

test("V3: two unit codes block, reason names the stored field", () => {
  const r = checkCompatible(pick("V01", ["DEU", "ITA"]));
  assert.equal(r.status, "blocked");
  assert.deepEqual(fields(r), ["unit_code"]);
  assert.deepEqual(r.blocked[0].values, ["EUR_BN", "PCT"]);
});

test("V3: unit_mult differs blocks", () => {
  const r = checkCompatible(pick("V01", ["DEU", "POL"]));
  assert.equal(r.status, "blocked");
  assert.deepEqual(fields(r), ["unit_mult"]);
});

test("V3: base_period differs blocks; same base is allowed", () => {
  assert.deepEqual(fields(checkCompatible(pick("V03", ["DEU", "ITA"]))), ["base_period"]);
  assert.equal(checkCompatible(pick("V03", ["DEU", "FRA", "ESP"])).status, "allowed");
});

test("V3: SA and NSA mix is marked, not blocked", () => {
  const r = checkCompatible(pick("V02", ["DEU", "FRA"]));
  assert.equal(r.status, "marked");
  assert.deepEqual(r.blocked, []);
  assert.deepEqual(r.marked.map((m) => m.field), ["seasonal_adjustment"]);
  assert.equal(checkCompatible(pick("V02", ["DEU", "ITA"])).status, "allowed");
});

test("V3: flow_basis absent for some blocks; absent for all is skipped and reported", () => {
  const some = checkCompatible(pick("V04", ["DEU", "ITA"]));
  assert.equal(some.status, "blocked");
  assert.deepEqual(some.blocked, [{field: "flow_basis", values: ["n/a"], absent_for_some: true}]);
  assert.equal(checkCompatible(pick("V04", ["DEU", "FRA"])).status, "allowed");
  const none = pick("V04", ["ITA", "ESP"]);
  assert.ok(none.every((s) => !("flow_basis" in s)));
  const r = checkCompatible(none);
  assert.equal(r.status, "allowed");
  assert.ok(r.skipped.includes("flow_basis"));
  const copy = pick("V04", ["DEU", "FRA"]).map(({flow_basis, ...rest}) => rest);
  assert.ok(checkCompatible(copy).skipped.includes("flow_basis"));
});

test("V3: differing frequency blocks", () => {
  const r = checkCompatible([...pick("M09", ["DEU"]), ...pick("A05", ["DEU"])]);
  assert.equal(r.status, "blocked");
  assert.ok(fields(r).includes("frequency"));
});

test("V3: unit_label and unit_text are never read; currency_basis is not compared", () => {
  const a = {unit_code: "PCT", unit_mult: 0, frequency: "M", unit_label: "x", unit_text: "a", currency_basis: "EUR"};
  const b = {unit_code: "PCT", unit_mult: 0, frequency: "M", unit_label: "y", unit_text: "b", currency_basis: "USD"};
  assert.equal(checkCompatible([a, b]).status, "allowed");
  const src = readFileSync(new URL("../src/lib/compat.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /unit_label|unit_text|currency_basis/);
});

test("V3: fewer than two series is allowed", () => {
  assert.equal(checkCompatible([]).status, "allowed");
  assert.equal(checkCompatible(pick("V01", ["DEU"])).status, "allowed");
});
