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
