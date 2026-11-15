// V42 (ADR-037 A2.1, spec 13): per-language build settings. MM_LANG selects the tree: "en" (default) builds at "/" into dist (existing
// English paths unchanged); "uk" builds under "/uk/" into dist-uk. scripts/merge-trees.mjs copies dist-uk into dist/uk for deploy.
export const LANGS = ["en", "uk"];
export const DEFAULT_LANG = "en";

export function resolveLang(value) {
  const v = value === undefined || value === "" ? DEFAULT_LANG : String(value);
  if (!LANGS.includes(v)) throw new Error(`MM_LANG must be one of ${LANGS.join(", ")}; got ${JSON.stringify(v)}`);
  return v;
}

// Optional deploy prefix for hosting under a sub-path (GitHub project pages: "/diploma"). "" or undefined = none.
export function resolvePrefix(value) {
  if (value === undefined || value === "" || value === "/") return "";
  const v = String(value);
  if (v.split("/").some((seg) => /^\.+$/.test(seg)) || !/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*\/?$/.test(v)) throw new Error(`MM_BASE_PREFIX must look like "/name"; got ${JSON.stringify(v)}`);
  return v.replace(/\/+$/, "");
}

// {lang, base, output}: base always starts and ends with "/". The prefix changes base only; output dirs stay the same.
export function langSettings(value, prefix) {
  const lang = resolveLang(value);
  const pre = resolvePrefix(prefix);
  return lang === DEFAULT_LANG ? {lang, base: `${pre}/`, output: "dist"} : {lang, base: `${pre}/${lang}/`, output: `dist-${lang}`};
}

// The single internal-link helper: a root-relative path ("/country", "/", "/country/PL#c=1") under the tree's base.
export function withBase(path, base = "/") {
  const p = String(path);
  if (!p.startsWith("/") || p.startsWith("//")) throw new Error(`withBase needs a root-relative path; got ${JSON.stringify(p)}`);
  return base === "/" ? p : `${base.slice(0, -1)}${p}`;
}
