// V46 (ADR-037 A2.1, AC-V2-103): the language switch. A plain link in the header, outside the nav landmark, to the same path in the other language tree.
// No redirect, no cookie, no storage, no language hash key: the choice is the URL. Works without JavaScript (the path swap is in the HTML, no hash);
// the existing data-carry handler (carry.js) appends the current hash on click when JavaScript runs. The link text is the language's own name, in that
// language (an endonym, fixed, not a translated UI string), and the link carries lang and hreflang of its target.
export const LANG_TREES = Object.freeze({
  en: Object.freeze({code: "en", base: "/", name: "English"}),
  uk: Object.freeze({code: "uk", base: "/uk/", name: "Українська"})
});
export const otherLang = (lang) => (lang === "uk" ? "en" : "uk");

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
// Page path as Framework gives it, relative to the tree base ("/", "/country/PL", "/index", "/404"); never carries the base itself.
const norm = (p) => (String(p ?? "").replace(/\/index$/, "").replace(/\/+$/, "") || "/");

// rel="external" makes Framework leave the href untouched (its html.js skips such links); the page-relative form below is therefore final.
// URL of `path` inside the tree `to`, written relative to the page at `path` in the tree `from`. Framework 1.13.4 re-bases every ordinary header href onto the current
// tree's base (verified: "../" in the Ukrainian tree became "./"), which cannot leave /uk/; a relative path with rel="external" can.
export function treeHref(path, from, to) {
  const p = norm(path);
  const dirs = p.split("/").filter(Boolean).slice(0, -1); // directories between the tree root and the page file
  const lead = [...(from === "uk" ? [".."] : []), ...dirs.map(() => "..")].join("/") || "."; // plus the /uk/ directory when leaving the Ukrainian tree
  const target = `${to === "uk" ? "uk/" : ""}${p === "/" ? "" : p.slice(1)}`;
  return `${lead}/${target}`;
}

// The link to the other tree from a page of `lang` at `path`.
export function langSwitchHtml({path, lang}) {
  const to = LANG_TREES[otherLang(lang)];
  return `<a class="mm-lang" rel="alternate external" href="${esc(treeHref(path, lang, to.code))}" lang="${to.code}" hreflang="${to.code}" data-carry>${esc(to.name)}</a>`;
}
