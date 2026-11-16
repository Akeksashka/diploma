// Ukrainian tree (proposed entries shown, as in a preview build): stored codes get display text; an unknown code is shown as stored; month ticks are Ukrainian.
process.env.MM_LANG = "uk";
process.env.MM_SHOW_PROPOSED = "1";
import {test} from "node:test";
import assert from "node:assert/strict";
const {codeText, unitLabelText, xTickFormat} = await import("../src/lib/code-text.js");
const strip = (s) => String(s).replace(/^\[uk\?\] /, "");

test("Ukrainian: unit, seasonal, status, load kind and transform codes have display text", () => {
  assert.equal(strip(codeText("unit", "PCT_GDP")), "% ВВП");
  assert.equal(strip(codeText("seasonal", "NSA")), "без сезонного коригування");
  assert.equal(strip(codeText("status", "PROV")), "попередні дані");
  assert.equal(strip(codeText("load", "revision")), "ревізія");
  assert.equal(strip(codeText("transform", "YOY")), "зміна до року тому, %");
  assert.equal(strip(codeText("freq", "M")), "Щомісячна");
});

test("Ukrainian: an unknown code is shown as stored; a unit_label list is mapped part by part", () => {
  assert.equal(codeText("unit", "XYZ"), "XYZ");
  assert.equal(codeText("unit", null), null);
  assert.equal(strip(unitLabelText("I25, IDX")).includes("індекс, 2025 = 100, "), true);
});

test("Ukrainian: time ticks use year at January, Ukrainian month names, day numbers", () => {
  const {tickFormat} = xTickFormat();
  assert.equal(tickFormat(new Date(Date.UTC(2026, 0, 1))), "2026");
  assert.equal(tickFormat(new Date(Date.UTC(2026, 3, 1))), "квіт");
  assert.equal(tickFormat(new Date(Date.UTC(2026, 3, 15))), "15");
});
