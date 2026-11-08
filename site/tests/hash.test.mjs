import assert from "node:assert/strict";
import {test} from "node:test";
import {parseHash, serializeHash} from "../src/lib/hash.js";
import {focusFromHash} from "../src/lib/peers.js";

const known = {indicators: new Set(["M09", "M10"]), entities: new Set(["DEU", "USA", "FRA"]), groups: new Set(["advanced"])};

test("full syntax parses and round-trips", () => {
  const s = parseHash("#i=M09&c=DEU,USA&g=advanced", known);
  assert.deepEqual(s, {i: "M09", c: ["DEU", "USA"], g: "advanced", note: false});
  assert.equal(serializeHash(s), "#i=M09&c=DEU,USA&g=advanced");
});
test("each part is optional", () => {
  assert.deepEqual(parseHash("#i=M09", known), {i: "M09", c: [], g: null, note: false});
  assert.deepEqual(parseHash("#g=advanced", known), {i: null, c: [], g: "advanced", note: false});
  assert.equal(serializeHash({}), "");
});
test("old peers form #c=<entity_id> is accepted and agrees with peers.js", () => {
  assert.deepEqual(parseHash("#c=DEU", known), {i: null, c: ["DEU"], g: null, note: false});
  assert.equal(focusFromHash("#c=DEU", known.entities), parseHash("#c=DEU", known).c[0]);
});
test("empty hash is the default without a note", () => {
  for (const h of ["", "#", null, undefined]) assert.deepEqual(parseHash(h, known), {i: null, c: [], g: null, note: false});
});
test("invalid parts fall back with note, never throw", () => {
  for (const h of ["#i=XXX", "#c=XXX", "#c=DEU,XXX", "#c=DEU&c=USA", "#z=1", "#i", "#c=DEU/../", "?c=DEU", "c=DEU", 5, "#c=,", "#c=DEU,DEU"]) {
    const s = parseHash(h, known);
    assert.equal(s.note, true, String(h));
  }
  assert.deepEqual(parseHash("#c=DEU,XXX", known), {i: null, c: ["DEU"], g: null, note: true});
  assert.deepEqual(parseHash("#i=XXX&c=USA", known), {i: null, c: ["USA"], g: null, note: true});
});
test("without known sets only the id shape is checked; maxEntities caps c", () => {
  assert.deepEqual(parseHash("#c=AAA,BBB,CCC", {}, {maxEntities: 2}), {i: null, c: ["AAA", "BBB"], g: null, note: true});
  assert.equal(parseHash("#i=M09", {}).i, "M09");
});
