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
    a.setAttribute("href", carryHref(plain, win.location.hash));
  };
  doc.addEventListener("click", on, true);
  doc.addEventListener("auxclick", on, true);
  return true;
}
