import assert from "node:assert/strict";
import {test} from "node:test";
import {PERIOD_FORMATS, periodLabel} from "../src/lib/period.js";

test("pinned formats (spec 5.3)", () => {
  assert.equal(PERIOD_FORMATS.M.example, "2026-08");
  assert.equal(PERIOD_FORMATS.Q.example, "2026 Q3");
  assert.equal(PERIOD_FORMATS.A.example, "2025");
  assert.equal(periodLabel("2026-08-31", "M"), PERIOD_FORMATS.M.example);
  assert.equal(periodLabel("2026-09-30", "Q"), PERIOD_FORMATS.Q.example);
  assert.equal(periodLabel("2025-12-31", "A"), PERIOD_FORMATS.A.example);
});
test("quarters from period end month", () => {
  assert.deepEqual(["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"].map((d) => periodLabel(d, "Q")), ["2026 Q1", "2026 Q2", "2026 Q3", "2026 Q4"]);
});
test("daily and invalid input", () => {
  assert.equal(periodLabel("2026-08-31", "D"), "2026-08-31");
  for (const [d, f] of [[null, "M"], ["", "M"], ["2026-13-01", "M"], ["bad", "A"], ["2026-08-31", "W"], ["2026-08-31", undefined], [5, "M"]]) assert.equal(periodLabel(d, f), null);
});
