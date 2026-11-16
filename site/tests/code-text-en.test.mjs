// English tree: code-text returns stored codes unchanged and leaves Plot's default time axis alone.
import {test} from "node:test";
import assert from "node:assert/strict";
const {codeText, unitLabelText, xTickFormat} = await import("../src/lib/code-text.js");

test("English: codes and unit labels pass through unchanged", () => {
  assert.equal(codeText("unit", "PCT_GDP"), "PCT_GDP");
  assert.equal(codeText("seasonal", "SA"), "SA");
  assert.equal(codeText("status", "EST"), "EST");
  assert.equal(codeText("unit", null), null);
  assert.equal(unitLabelText("I25, IDX"), "I25, IDX");
  assert.deepEqual(xTickFormat(), {});
});
