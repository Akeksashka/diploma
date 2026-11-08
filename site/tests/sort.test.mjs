import assert from "node:assert/strict";
import {test} from "node:test";
import {ariaSort, sortRows} from "../src/lib/sort.js";

const rows = [
  {name: "Chile", v: 2, p: "2026-08-31"},
  {name: "Albania", v: null, p: "2026-07-31"},
  {name: "Brazil", v: 2, p: null},
  {name: "Denmark", v: 1, p: "2026-08-31"}
];
const names = (r) => r.map((x) => x.name);

test("ascending: nulls last, ties by name", () => {
  assert.deepEqual(names(sortRows(rows, "v")), ["Denmark", "Brazil", "Chile", "Albania"]);
});
test("descending: nulls still last, ties still by name ascending", () => {
  assert.deepEqual(names(sortRows(rows, "v", {dir: "desc"})), ["Brazil", "Chile", "Denmark", "Albania"]);
});
test("date strings and name field", () => {
  assert.deepEqual(names(sortRows(rows, "p")), ["Albania", "Chile", "Denmark", "Brazil"]);
  assert.deepEqual(names(sortRows(rows, "name")), ["Albania", "Brazil", "Chile", "Denmark"]);
});
test("input not mutated; stable for identical keys", () => {
  const before = names(rows);
  sortRows(rows, "v");
  assert.deepEqual(names(rows), before);
  const same = [{name: "A", v: 1, k: 1}, {name: "A", v: 1, k: 2}];
  assert.deepEqual(sortRows(same, "v").map((x) => x.k), [1, 2]);
});
test("aria-sort reflects state", () => {
  assert.equal(ariaSort({field: "v", dir: "desc"}, "v"), "descending");
  assert.equal(ariaSort({field: "v", dir: "asc"}, "v"), "ascending");
  assert.equal(ariaSort({field: "v", dir: "asc"}, "p"), "none");
  assert.equal(ariaSort(null, "p"), "none");
});
