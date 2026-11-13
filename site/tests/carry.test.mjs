// L10 (AC-DB-07): carry helpers and the installer, offline with a stand-in document.
import assert from "node:assert/strict";
import {test} from "node:test";
import {carryHref, installCarry} from "../src/lib/carry.js";

test("carryHref appends the current hash to a plain href", () => {
  assert.equal(carryHref("../country/DEU", "#i=M09&c=DEU"), "../country/DEU#i=M09&c=DEU");
  assert.equal(carryHref("./explorer", "i=M09"), "./explorer#i=M09");
});

test("carryHref leaves an empty hash, a '#' alone, a missing href and a link with its own fragment unchanged", () => {
  assert.equal(carryHref("../country/DEU", ""), "../country/DEU");
  assert.equal(carryHref("../country/DEU", "#"), "../country/DEU");
  assert.equal(carryHref("../country/DEU", null), "../country/DEU");
  assert.equal(carryHref("", "#i=M09"), "");
  assert.equal(carryHref("../country/DEU#h-labour", "#i=M09"), "../country/DEU#h-labour");
});

function fakeDoc() {
  const listeners = {};
  return {addEventListener: (t, fn) => (listeners[t] = fn), listeners};
}
function fakeLink(href, carry = true) {
  const attrs = new Map([["href", href]]);
  if (carry) attrs.set("data-carry", "");
  const a = {
    hasAttribute: (k) => attrs.has(k),
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, v),
    closest: (sel) => (sel === "a[data-carry]" && carry ? a : null)
  };
  return a;
}

test("installCarry rewrites a data-carry link on click and on auxclick, without stacking hashes", () => {
  const doc = fakeDoc();
  const win = {location: {hash: "#i=M09&c=DEU"}};
  assert.equal(installCarry(doc, win), true);
  assert.equal(installCarry(doc, win), false, "idempotent");
  const a = fakeLink("../country/DEU");
  doc.listeners.click({target: a});
  assert.equal(a.getAttribute("href"), "../country/DEU#i=M09&c=DEU");
  win.location.hash = "#g=EU";
  doc.listeners.auxclick({target: a});
  assert.equal(a.getAttribute("href"), "../country/DEU#g=EU");
  win.location.hash = "";
  doc.listeners.click({target: a});
  assert.equal(a.getAttribute("href"), "../country/DEU", "back to the plain href when the hash is empty");
});

test("installCarry ignores links without data-carry and targets that are not elements", () => {
  const doc = fakeDoc();
  installCarry(doc, {location: {hash: "#i=M09"}});
  const a = fakeLink("../country/DEU", false);
  doc.listeners.click({target: a});
  assert.equal(a.getAttribute("href"), "../country/DEU");
  doc.listeners.click({target: null});
  doc.listeners.click({target: {}});
});

test("installCarry is a no-op without a document (node, no JavaScript environment)", () => {
  assert.equal(installCarry(undefined, undefined), false);
});

// V2 (A1.3, spec 2): the mode switch keeps the keys that stay meaningful.
import {carryHashFor, carryHrefFor, carryHrefForAttrs} from "../src/lib/carry.js";
test("v2: carryHashFor country drops compare-only keys (not g) and keeps the rest in order", () => {
  assert.equal(carryHashFor("#i=M09&c=DEU&g=g7&x=M09&y=M10&p=2025-03&pc=1&ctx=1&oth=1&stl=1&rb=2015", "country"), "#i=M09&c=DEU&g=g7&p=2025-03&pc=1", "g stays for Country (spec 5.3: Group for P1)");
});
test("v2: carryHashFor compare keeps every key; unknown keys, m and proj are dropped; nothing kept gives empty", () => {
  const h = "#i=M09&c=DEU&g=g7&d=labour&f=M&from=2000&to=2020&x=M09&y=M10&p=2025-03&pc=1&ctx=1&oth=1&stl=1&rb=2015";
  assert.equal(carryHashFor(h, "compare"), h);
  assert.equal(carryHashFor("#m=compare&proj=1&z=1&i=M09", "compare"), "#i=M09");
  assert.equal(carryHashFor("#g=g7&stl=1", "country"), "#g=g7");
  assert.equal(carryHashFor("#stl=1&x=M09&ctx=1", "country"), "");
  assert.equal(carryHashFor("", "compare"), "");
  assert.equal(carryHashFor("#i=M09", "nowhere"), "");
});
test("v2: carryHrefFor appends the filtered hash and leaves a link with its own fragment alone", () => {
  assert.equal(carryHrefFor("../country/DEU", "#c=DEU&stl=1&p=2024", "country"), "../country/DEU#c=DEU&p=2024");
  assert.equal(carryHrefFor("../country/DEU#h", "#c=DEU", "country"), "../country/DEU#h");
});

// V8: a page that fixes one key forces it on the way to the other mode; a link names its target and its forced keys in attributes.
test("v8: carryHashFor set forces a key the target keeps (replace in place, else append) and ignores others and unsafe values", () => {
  assert.equal(carryHashFor("", "compare", {c: "DEU"}), "#c=DEU");
  assert.equal(carryHashFor("#i=M09&c=FRA&g=g7", "compare", {c: "DEU"}), "#i=M09&c=DEU&g=g7");
  assert.equal(carryHashFor("#i=M09&stl=1", "compare", {i: "M10"}), "#i=M10&stl=1");
  assert.equal(carryHashFor("#i=M09", "country", {stl: "1"}), "#i=M09", "stl is not a Country key");
  assert.equal(carryHashFor("#i=M09", "compare", {c: "a&b=1"}), "#i=M09", "an unsafe value is not applied");
  assert.equal(carryHashFor("#i=M09", "nowhere", {c: "DEU"}), "");
});
test("v8: carryHrefForAttrs filters by data-carry target, applies data-carry-set, and keeps the whole hash for a bare data-carry", () => {
  assert.equal(carryHrefForAttrs("../compare", "#i=M09&d=labour&stl=1", "compare", "c=DEU"), "../compare#i=M09&d=labour&stl=1&c=DEU");
  assert.equal(carryHrefForAttrs("../country", "#i=M09&stl=1&c=DEU", "country", null), "../country#i=M09&c=DEU");
  assert.equal(carryHrefForAttrs("./explorer", "#i=M09&stl=1", "", null), "./explorer#i=M09&stl=1");
});
test("v8: installCarry honours data-carry target and data-carry-set on click", () => {
  const doc = fakeDoc();
  const win = {location: {hash: "#i=M09&g=g7&ctx=1"}};
  installCarry(doc, win);
  const a = fakeLink("../compare");
  a.setAttribute("data-carry", "compare");
  a.setAttribute("data-carry-set", "c=DEU");
  doc.listeners.click({target: a});
  assert.equal(a.getAttribute("href"), "../compare#i=M09&g=g7&ctx=1&c=DEU");
  win.location.hash = "#i=M10&ctx=1&stl=1";
  doc.listeners.click({target: a});
  assert.equal(a.getAttribute("href"), "../compare#i=M10&ctx=1&stl=1&c=DEU", "recomputed from the plain href, not stacked");
});
