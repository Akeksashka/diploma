// L10 (layout amendment 2.5, AC-DB-07): carry the current URL hash over links that opt in with data-carry (country names, indicator names, header
// navigation). The link keeps its plain href in the static HTML, so it works without JavaScript; on a click the hash of the page being left is
// appended. A link that already has a hash of its own keeps it. Pure helpers plus one idempotent installer; nothing else reads or writes the hash.
export function carryHref(href, hash) {
  const base = String(href ?? "");
  if (base === "" || base.includes("#")) return base; // no link, or it names its own fragment
  const h = hash == null || hash === "#" ? "" : String(hash);
  return h === "" ? base : `${base}${h.startsWith("#") ? h : `#${h}`}`;
}

// One delegated listener per document. click covers a mouse press, Enter and Space on a focused link and Ctrl/Cmd-click; auxclick covers the middle button.
// The href is rewritten just before the browser follows it, so the address shown on hover is the plain one until the press.
export function installCarry(doc = globalThis.document, win = globalThis.window) {
  if (!doc || !win || doc.__mmCarry) return false;
  doc.__mmCarry = true;
  const on = (e) => {
    const a = e.target?.closest?.("a[data-carry]");
    if (!a || !a.hasAttribute("href")) return;
    const plain = a.getAttribute("data-carry-href") ?? a.getAttribute("href");
    a.setAttribute("data-carry-href", plain); // remember the plain href so repeated presses never stack hashes
    a.setAttribute("href", carryHrefForAttrs(plain, win.location.hash, a.getAttribute("data-carry") ?? "", a.getAttribute("data-carry-set")));
  };
  doc.addEventListener("click", on, true);
  doc.addEventListener("auxclick", on, true);
  return true;
}

// v2 (A1.3, spec 2): keys that stay meaningful when moving to a mode page. Country keeps the country-mode controls (K1, T1, L1, L2: c, i, d, f,
// from, to, p, pc, and g because spec 5.3 lists Group for P1); Compare keeps every key. Compare-only keys (x, y, ctx, oth, stl, rb) are dropped on the way to Country. Pure string filter:
// no value is parsed or changed, and the order of the parts is kept.
export const CARRY_KEYS = {
  country: ["i", "c", "g", "d", "f", "from", "to", "p", "pc"],
  compare: ["i", "c", "g", "d", "f", "from", "to", "x", "y", "p", "pc", "ctx", "oth", "stl", "rb"]
};
// `set` (optional {key: value}): keys to force on the way to the target, for a page that fixes one (Country -> Compare sets c to the page's country,
// Indicator -> Compare sets i to the page's indicator). Only keys the target keeps and plain id values are applied; an existing part is replaced in place.
const SET_VALUE = /^[A-Za-z0-9_.,-]+$/;
export function carryHashFor(hash, target, set = {}) {
  const keys = CARRY_KEYS[target];
  if (!keys) return "";
  const h = hash == null ? "" : String(hash).replace(/^#/, "");
  const kept = h === "" ? [] : h.split("&").filter((part) => keys.includes(part.split("=")[0]));
  for (const [k, v] of Object.entries(set ?? {})) {
    if (!keys.includes(k) || !SET_VALUE.test(String(v))) continue;
    const at = kept.findIndex((part) => part.split("=")[0] === k);
    if (at >= 0) kept[at] = `${k}=${v}`;
    else kept.push(`${k}=${v}`);
  }
  return kept.length ? `#${kept.join("&")}` : "";
}
export const carryHrefFor = (href, hash, target, set = {}) => carryHref(href, carryHashFor(hash, target, set));
// A link's own instruction: data-carry="country|compare" filters by target (CARRY_KEYS); data-carry-set="c=DEU&i=M09" forces keys; a bare data-carry
// carries the whole hash (the pre-v2 behaviour). Pure: no DOM beyond the two attribute strings.
export function carryHrefForAttrs(plain, hash, carryAttr, setAttr) {
  if (!(carryAttr in CARRY_KEYS)) return carryHref(plain, hash);
  const set = Object.fromEntries(String(setAttr ?? "").split("&").filter(Boolean).map((p) => [p.split("=")[0], p.split("=").slice(1).join("=")]));
  return carryHrefFor(plain, hash, carryAttr, set);
}
