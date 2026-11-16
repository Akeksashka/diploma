// V44 (ADR-037 A2.1): dictionary lookup with the Ukrainian review gate. Entry shape {t, status, reviewed_on}; English entries carry {t} only.
// Production: a Ukrainian entry renders only when status === "reviewed"; any other entry (proposed, missing) renders the English text, which the
// caller must put inside an element with lang="en" (renderHtml does it). MM_SHOW_PROPOSED=1 (preview build) renders `proposed` entries with a visible marker.
// Nothing here computes a statistic: it only picks and fills text. Agents never set `reviewed`; only the user (or a reviewer the user names) does.
import {dictionaries} from "../i18n/dictionaries.3d035f38.js"; // generated from en.json / uk.json by scripts/prepare-i18n.mjs (Framework cannot bundle JSON import attributes)

export const LANGS = ["en", "uk"];
export const PLURAL_CATEGORIES = Object.freeze({en: ["one", "other"], uk: ["one", "few", "many", "other"]});
export const PROPOSED_MARK = "[uk?] ";

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
export const placeholders = (tpl) => [...String(tpl).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const fill = (key, tpl, params) =>
  String(tpl).replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in params)) throw new Error(`i18n: ${key} needs parameter {${name}}`);
    return String(params[name]);
  });

export function makeI18n({lang = "en", showProposed = false, dicts = dictionaries} = {}) {
  if (!LANGS.includes(lang)) throw new Error(`i18n: unknown language ${JSON.stringify(lang)}`);
  const fallbacks = new Map(); // key -> reason ("missing" | "not_reviewed")
  const usable = (e) => e && typeof e.t === "string" && (e.status === "reviewed" || (showProposed && e.status === "proposed"));

  const english = (key, reason) => {
    if (!(key in dicts.en)) throw new Error(`i18n: unknown key ${key}`);
    return {key, text: dicts.en[key].t, lang: "en", status: reason ?? "reviewed", fallback: reason !== undefined, marked: false};
  };
  // The Ukrainian entry of `key` when it may render (reviewed, or proposed in a preview build), else null.
  const ukrainian = (key) => {
    const e = dicts.uk[key];
    if (!usable(e)) return null;
    const marked = e.status !== "reviewed";
    return {key, text: marked ? `${PROPOSED_MARK}${e.t}` : e.t, lang: "uk", status: e.status, fallback: false, marked};
  };
  const why = (key) => (dicts.uk[key] ? "not_reviewed" : "missing");

  // Resolve one concrete dictionary key. {key, text, lang: language of the text, status, fallback, marked}
  function resolve(key) {
    if (lang !== "uk") return english(key);
    const u = ukrainian(key);
    if (u) return u;
    fallbacks.set(key, why(key));
    return english(key, why(key));
  }

  const category = (n, l) => new Intl.PluralRules(l).select(n);
  // Plural entries are keyed `base#category`; the category comes from the language of the entry that ends up rendering.
  function resolvePlural(base, n) {
    if (lang === "uk") {
      const k = `${base}#${category(n, "uk")}`;
      const u = ukrainian(k);
      if (u) return u;
      fallbacks.set(k, why(k));
      const enKey = `${base}#${dicts.en[`${base}#${category(n, "en")}`] ? category(n, "en") : "other"}`;
      return english(enKey, why(k));
    }
    const cat = category(n, lang);
    return english(`${base}#${dicts.en[`${base}#${cat}`] ? cat : "other"}`);
  }

  return {
    lang,
    showProposed,
    resolve,
    resolvePlural,
    t: (key, params = {}) => fill(key, resolve(key).text, params),
    tp: (base, n, params = {}) => fill(base, resolvePlural(base, n).text, {n, ...params}),
    // HTML for a text node: when the text is not in the page language it is wrapped in an element with its own lang (WCAG 3.1.2).
    renderHtml(key, params = {}) {
      const r = resolve(key);
      const text = esc(fill(key, r.text, params));
      return r.lang === lang ? text : `<span lang="${r.lang}">${text}</span>`;
    },
    fallbacks: () => new Map(fallbacks)
  };
}

function detect() {
  const env = typeof process !== "undefined" ? process.env ?? {} : {};
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  let lang = env.MM_LANG;
  if (!lang && typeof document !== "undefined") lang = document.documentElement?.lang;
  return {lang: lang === "uk" ? "uk" : "en", showProposed: env.MM_SHOW_PROPOSED === "1" || g.__MM_SHOW_PROPOSED__ === true};
}

export const i18n = makeI18n(detect());
