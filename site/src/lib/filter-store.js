// L6 (ADR-034, layout amendment 2.3): the filter store. One state object {i, c, g, d, f, from, to, note} (the parseHash shape).
// - Seeded from the hash when created; NEVER written on load.
// - set()/reset() are user changes: they notify subscribers, then write the hash with history.replaceState, only when the serialized
//   hash differs from the current one (so history.length never changes and an unchanged state writes nothing).
// - attach() re-reads the hash on `hashchange` (links, Back/Forward, a manual edit); a re-read never writes.
// - subscribe(fn) calls fn(state) on every change (not on subscribe). States are frozen snapshots; a change creates a new object.
// Nothing here uses the DOM beyond the injected `win` ({location, history, addEventListener, removeEventListener}), so it runs in node tests.
import {emptyHashState, parseHash, serializeHash} from "./hash.js";

const same = (a, b) => serializeHash(a) === serializeHash(b);
const norm = (h) => (h === "#" ? "" : (h ?? ""));
const snapshot = (s) => Object.freeze({...s, c: Object.freeze([...(s.c ?? [])])});

// ignore: state keys this page does not use (PG-SERIES: ["g"], amendment 2.3). They are read as empty, never set and so never written;
// ignoring a part is not an error (it sets no fallback note).
export function createFilterStore({win = globalThis, known = {}, maxEntities = Infinity, ignore = []} = {}) {
  const drop = (s) => {
    const out = {...s};
    for (const k of ignore) out[k] = emptyHashState()[k];
    return out;
  };
  let state = snapshot(drop(parseHash(win.location.hash, known, {maxEntities})));
  const subs = new Set();
  const notify = () => {
    for (const fn of [...subs]) fn(state);
  };
  // Write the hash only when it differs. replaceState fires no hashchange.
  const write = () => {
    const next = serializeHash(state);
    if (next === norm(win.location.hash)) return false;
    const {pathname, search} = win.location;
    win.history.replaceState(win.history.state, "", `${pathname}${search}${next}`);
    return true;
  };
  const apply = (next) => {
    if (same(state, next)) return false;
    state = snapshot(next);
    notify();
    write();
    return true;
  };
  return {
    get: () => state,
    // patch: any of i, c, g, d, f, from, to. `note` (the fallback-note flag) is cleared by a user change.
    set(patch) {
      return apply(drop({...state, ...patch, c: patch.c ? [...patch.c].slice(0, maxEntities) : state.c, note: false}));
    },
    reset() {
      return apply(emptyHashState());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    // Re-read the address on hashchange; returns the detach function. A re-read notifies but never writes.
    attach() {
      const read = () => {
        const next = snapshot(drop(parseHash(win.location.hash, known, {maxEntities})));
        if (same(state, next) && state.note === next.note) return;
        state = snapshot(next);
        notify();
      };
      win.addEventListener("hashchange", read);
      return () => win.removeEventListener("hashchange", read);
    }
  };
}

// The bridge to the Framework's reactive cells: a Generators.observe generator that yields the current state, then every change.
// `Generators` is the Framework runtime global (passed in, so this module imports nothing and node tests can pass a stand-in).
// A cell that mentions the returned value re-runs on each change; on invalidation the generator's dispose detaches both listeners.
export function filterGenerator(Generators, store) {
  return Generators.observe((change) => {
    const detach = store.attach();
    const off = store.subscribe(change);
    change(store.get());
    return () => {
      off();
      detach();
    };
  });
}
