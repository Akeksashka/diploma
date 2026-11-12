// L6: filter store (seeded from the hash, never written on load, replaceState only on a user change and only when the hash differs,
// hashchange re-read, subscribe/reset) and the Generators bridge. A fake window stands in for the browser.
import test from "node:test";
import assert from "node:assert/strict";
import {createFilterStore, filterGenerator} from "../src/lib/filter-store.js";

function fakeWin(hash = "") {
  const listeners = new Set();
  const win = {
    location: {pathname: "/", search: "", hash},
    history: {length: 1, state: null, calls: [], replaceState(_s, _t, url) { this.calls.push(url); win.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; }},
    addEventListener: (t, fn) => t === "hashchange" && listeners.add(fn),
    removeEventListener: (t, fn) => t === "hashchange" && listeners.delete(fn),
    listeners,
    navigate(h) { win.location.hash = h; for (const fn of [...listeners]) fn(); } // a push or Back: hashchange, never replaceState
  };
  return win;
}
const known = {indicators: new Set(["M09", "P01"]), entities: new Set(["DEU", "FRA", "USA", "POL", "ITA", "JPN"]), groups: new Set(["g7"]), domains: new Set(["labour"])};

test("seeded from the hash; nothing is written on load, not even for a non-canonical hash", () => {
  const w = fakeWin("#g=g7&i=M09&zz=1");
  const s = createFilterStore({win: w, known});
  assert.equal(s.get().g, "g7");
  assert.equal(s.get().i, "M09");
  assert.equal(s.get().note, true);
  assert.deepEqual(w.history.calls, []);
});

test("set: notifies once, writes the canonical hash with replaceState once; history.length unchanged", () => {
  const w = fakeWin("");
  const s = createFilterStore({win: w, known});
  const seen = [];
  s.subscribe((st) => seen.push(st.g));
  assert.equal(s.set({g: "g7"}), true);
  assert.deepEqual(seen, ["g7"]);
  assert.deepEqual(w.history.calls, ["/#g=g7"]);
  assert.equal(w.history.length, 1);
  assert.equal(w.location.hash, "#g=g7");
});

test("set: an unchanged state notifies nothing and writes nothing", () => {
  const w = fakeWin("#g=g7");
  const s = createFilterStore({win: w, known});
  let n = 0;
  s.subscribe(() => n++);
  assert.equal(s.set({g: "g7"}), false);
  assert.equal(n, 0);
  assert.deepEqual(w.history.calls, []);
});

test("set: serialized order is fixed and parts the page did not touch are kept", () => {
  const w = fakeWin("#f=M&d=labour&from=2015&to=2020");
  const s = createFilterStore({win: w, known: {...known, bounds: {from: 2000, to: 2025}}});
  s.set({i: "M09", c: ["DEU", "FRA"]});
  assert.equal(w.location.hash, "#i=M09&c=DEU,FRA&d=labour&f=M&from=2015&to=2020");
});

test("set: more entities than maxEntities are cut; states are frozen snapshots", () => {
  const s = createFilterStore({win: fakeWin(), known, maxEntities: 5});
  s.set({c: ["DEU", "FRA", "USA", "POL", "ITA", "JPN"]});
  assert.equal(s.get().c.length, 5);
  assert.ok(Object.isFrozen(s.get()) && Object.isFrozen(s.get().c));
});

test("reset clears every part, writes the empty hash, and is a no-op when already empty", () => {
  const w = fakeWin("#i=M09&g=g7");
  const s = createFilterStore({win: w, known});
  assert.equal(s.reset(), true);
  assert.deepEqual(w.history.calls, ["/"]);
  assert.equal(s.reset(), false);
  assert.equal(w.history.calls.length, 1);
});

test("hashchange (link, Back, Forward) is re-read and notified but never written", () => {
  const w = fakeWin("#g=g7");
  const s = createFilterStore({win: w, known});
  const detach = s.attach();
  const seen = [];
  s.subscribe((st) => seen.push([st.g, st.i]));
  w.navigate("#i=M09");
  w.navigate("#i=M09"); // same address again: nothing to pass on
  w.navigate("");
  assert.deepEqual(seen, [[null, "M09"], [null, null]]);
  assert.deepEqual(w.history.calls, []);
  detach();
  assert.equal(w.listeners.size, 0);
  w.navigate("#g=g7");
  assert.equal(seen.length, 2);
});

test("unsubscribe stops notifications", () => {
  const s = createFilterStore({win: fakeWin(), known});
  let n = 0;
  const off = s.subscribe(() => n++);
  s.set({g: "g7"});
  off();
  s.set({g: null});
  assert.equal(n, 1);
});

// Stand-in for the Framework's Generators.observe: yields every value passed to `change`, disposes on return().
function observe(init) {
  const values = [];
  const dispose = init((v) => values.push(v));
  return {values, dispose};
}
test("filterGenerator yields the current state, then every change; dispose detaches listener and subscription", () => {
  const w = fakeWin("#g=g7");
  const s = createFilterStore({win: w, known});
  const gen = filterGenerator({observe}, s);
  s.set({i: "M09"});
  w.navigate("#d=labour");
  assert.deepEqual(gen.values.map((v) => [v.g, v.i, v.d]), [["g7", null, null], ["g7", "M09", null], [null, null, "labour"]]);
  gen.dispose();
  assert.equal(w.listeners.size, 0);
  s.set({g: "g7"});
  assert.equal(gen.values.length, 3);
});
