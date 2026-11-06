// T109 / AC-UX-15: percentile bins are lower-inclusive with constant edges; null has no bin; out of range is an error.
import assert from "node:assert/strict";
import {test} from "node:test";
import {BIN_EDGES, BinError, binLabel, binOf} from "../src/lib/bins.js";
import {BIN_LABELS} from "../src/lib/copy.js";

test("edges are the constants 0.2, 0.4, 0.6, 0.8", () => assert.deepEqual([...BIN_EDGES], [0.2, 0.4, 0.6, 0.8]));

test("boundary values: 0, 0.1999, 0.2, 0.4, 0.5, 0.6, 0.8, 0.9999, 1.0", () => {
  const cases = [[0, 1], [0.1999, 1], [0.2, 2], [0.3999, 2], [0.4, 3], [0.5, 3], [0.6, 4], [0.7999, 4], [0.8, 5], [0.9999, 5], [1, 5]];
  for (const [p, bin] of cases) assert.equal(binOf(p), bin, String(p));
});

test("null and undefined have no bin; values outside [0, 1] or non-numbers throw, never clamp", () => {
  assert.equal(binOf(null), null);
  assert.equal(binOf(undefined), null);
  for (const bad of [-0.01, 1.0001, 2, Number.NaN, Infinity, "0.5"]) assert.throws(() => binOf(bad), BinError, String(bad));
});

test("each bin has its label, the first and last are the approved ones", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(binLabel), [...BIN_LABELS]);
  assert.equal(binLabel(1), "lowest fifth of the panel");
  assert.equal(binLabel(5), "highest fifth of the panel");
  assert.equal(binLabel(null), null);
});
