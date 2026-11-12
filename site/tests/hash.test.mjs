import assert from "node:assert/strict";
import {test} from "node:test";
import {emptyHashState, parseHash, serializeHash} from "../src/lib/hash.js";
import {focusFromHash} from "../src/lib/peers.js";

const st = (o) => ({...emptyHashState(), ...o});
const known = {indicators: new Set(["M09", "M10"]), entities: new Set(["DEU", "USA", "FRA"]), groups: new Set(["advanced"])};

test("full syntax parses and round-trips", () => {
  const s = parseHash("#i=M09&c=DEU,USA&g=advanced", known);
  assert.deepEqual(s, st({i: "M09", c: ["DEU", "USA"], g: "advanced"}));
  assert.equal(serializeHash(s), "#i=M09&c=DEU,USA&g=advanced");
});
test("each part is optional", () => {
  assert.deepEqual(parseHash("#i=M09", known), st({i: "M09", c: [], g: null, note: false}));
  assert.deepEqual(parseHash("#g=advanced", known), st({i: null, c: [], g: "advanced", note: false}));
  assert.equal(serializeHash({}), "");
});
test("old peers form #c=<entity_id> is accepted and agrees with peers.js", () => {
  assert.deepEqual(parseHash("#c=DEU", known), st({i: null, c: ["DEU"], g: null, note: false}));
  assert.equal(focusFromHash("#c=DEU", known.entities), parseHash("#c=DEU", known).c[0]);
});
test("empty hash is the default without a note", () => {
  for (const h of ["", "#", null, undefined]) assert.deepEqual(parseHash(h, known), st({i: null, c: [], g: null, note: false}));
});
test("invalid parts fall back with note, never throw", () => {
  for (const h of ["#i=XXX", "#c=XXX", "#c=DEU,XXX", "#c=DEU&c=USA", "#z=1", "#i", "#c=DEU/../", "?c=DEU", "c=DEU", 5, "#c=,", "#c=DEU,DEU"]) {
    const s = parseHash(h, known);
    assert.equal(s.note, true, String(h));
  }
  assert.deepEqual(parseHash("#c=DEU,XXX", known), st({i: null, c: ["DEU"], g: null, note: true}));
  assert.deepEqual(parseHash("#i=XXX&c=USA", known), st({i: null, c: ["USA"], g: null, note: true}));
});
test("without known sets only the id shape is checked; maxEntities caps c", () => {
  assert.deepEqual(parseHash("#c=AAA,BBB,CCC", {}, {maxEntities: 2}), st({i: null, c: ["AAA", "BBB"], g: null, note: true}));
  assert.equal(parseHash("#i=M09", {}).i, "M09");
});

// L4 (layout amendment 2.3): d, f, from, to; fixed order i, c, g, d, f, from, to.
const known2 = {...known, domains: new Set(["growth", "labour"]), bounds: {from: 1990, to: 2025}};
const FULL = "#i=M09&c=DEU,USA&g=advanced&d=growth&f=M&from=2015&to=2025";
test("L4: full extended hash parses and round-trips", () => {
  const s = parseHash(FULL, known2);
  assert.deepEqual(s, st({i: "M09", c: ["DEU", "USA"], g: "advanced", d: "growth", f: "M", from: 2015, to: 2025}));
  assert.equal(serializeHash(s), FULL);
});
test("L4: serialization order is fixed whatever the input order", () => {
  const s = parseHash("#to=2025&f=Q&d=labour&from=2015&g=advanced&c=FRA&i=M10", known2);
  assert.equal(s.note, false);
  assert.equal(serializeHash(s), "#i=M10&c=FRA&g=advanced&d=labour&f=Q&from=2015&to=2025");
});
test("L4: partial-valid keeps the valid parts", () => {
  const s = parseHash("#d=nope&f=M&from=2015&to=2020", known2);
  assert.deepEqual(s, st({f: "M", from: 2015, to: 2020, note: true}));
  assert.equal(parseHash("#f=X&d=growth", known2).f, null);
  assert.equal(parseHash("#f=X&d=growth", known2).d, "growth");
});
test("L4: malformed values are ignored with the note", () => {
  for (const h of ["#f=m", "#f=", "#d=../x", "#from=20x5&to=2020", "#from=2015&to=abc", "#from=&to=", "#from=1989&to=2000", "#from=2000&to=2026"]) {
    const s = parseHash(h, known2);
    assert.equal(s.note, true, h);
    assert.equal(s.from, null, h);
    assert.equal(s.to, null, h);
  }
});
test("L4: from greater than to ignores both", () => {
  const s = parseHash("#from=2020&to=2015", known2);
  assert.deepEqual(s, st({note: true}));
  assert.equal(parseHash("#from=2020&to=2020", known2).from, 2020);
});
test("L4: a lone from or to is ignored with the note", () => {
  assert.deepEqual(parseHash("#from=2015", known2), st({note: true}));
  assert.deepEqual(parseHash("#to=2015", known2), st({note: true}));
  assert.equal(serializeHash({from: 2015}), "");
});
test("L4: duplicate keys keep the first, set the note", () => {
  assert.deepEqual(parseHash("#d=growth&d=labour", known2), st({d: "growth", note: true}));
  const s = parseHash("#from=2015&to=2020&from=2016", known2);
  assert.equal(s.note, true);
  assert.equal(s.from, 2015);
});
test("L4: an unknown key is ignored with the note; unused known parameters pass through a rewrite", () => {
  assert.deepEqual(parseHash("#z=1&d=growth", known2), st({d: "growth", note: true}));
  const read = parseHash("#i=M09&d=growth&f=M&from=2015&to=2020", known2); // a page that uses only i and c rewrites c
  assert.equal(serializeHash({...read, c: ["DEU"]}), "#i=M09&c=DEU&d=growth&f=M&from=2015&to=2020");
});
test("L4: without bounds only the year shape and the pair order are checked", () => {
  assert.equal(parseHash("#from=1900&to=2999", {}).to, 2999);
});
test("L4: PG-SERIES keeps its rule: g is not written when the page drops it", () => {
  const read = parseHash("#i=M09&c=DEU&g=advanced&f=M", known2);
  assert.equal(serializeHash({...read, g: null}), "#i=M09&c=DEU&f=M");
});
