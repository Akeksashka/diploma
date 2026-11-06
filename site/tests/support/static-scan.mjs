// Shared static-scan helpers (T102 colour/style scan, T106 computation, URL and budget scans).
// Not a *.test.mjs file, so `node --test tests/*.test.mjs` does not run it. Patterns that would match
// this file's own text are assembled from parts; this file is not scanned (it is under tests/).
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join, relative, sep} from "node:path";

// ---------------------------------------------------------------- colour and inline style (T102, AC-UX-3)
const NAMED = ["steelblue", "black", "white", "red", "green", "blue", "gray", "grey", "orange", "yellow", "purple", "tomato", "navy", "teal", "crimson", "gold", "silver", "maroon", "olive", "lime", "aqua", "fuchsia", "coral", "salmon", "orchid", "indigo", "violet", "brown", "pink"];
export const RULES = {
  "style element": new RegExp("<" + "style\\b", "i"),
  "style attribute": new RegExp("\\bstyle" + "=", "i"),
  "hex colour": new RegExp("#[0-9a-fA-F]{3,8}\\b"),
  "functional colour": new RegExp("\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)" + "\\("),
  // a named colour as a quoted string or as a CSS value after a colon
  "named colour": new RegExp("([\"'`]|:\\s*)(?:" + NAMED.join("|") + ")\\b(?!-)", "i")
};
export const scan = (text) => Object.entries(RULES).filter(([, re]) => re.test(text)).map(([k]) => k);

export function listFiles(dir, accept, skipDirs = []) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n.startsWith(".") || skipDirs.includes(n) ? [] : listFiles(p, accept, skipDirs);
    return accept(n) ? [p] : [];
  });
}
export const rel = (root, p) => relative(root, p).split(sep).join("/");

// ---------------------------------------------------------------- JavaScript without strings, comments, regexes
// Returns the code with comments, string contents, regex literals and the static text of template literals
// replaced by spaces (newlines kept, so line numbers survive). `${...}` expressions inside templates are kept.
export function stripNoise(src) {
  let out = "";
  let i = 0;
  let prev = ""; // previous significant character, to tell a regex from a division
  const stack = []; // brace depth markers for template expressions
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? n : j;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? n : j + 2;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += c + blank(src.slice(i + 1, j)) + c;
      i = j + 1;
      prev = c;
    } else if (c === "`") {
      out += "`";
      i += 1;
      for (;;) {
        let j = i;
        while (j < n && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) j += src[j] === "\\" ? 2 : 1;
        out += blank(src.slice(i, j));
        if (j >= n) { i = n; break; }
        if (src[j] === "`") { out += "`"; i = j + 1; prev = "`"; break; }
        out += "${";
        i = j + 2;
        stack.push(1);
        break;
      }
      if (stack.length && out.endsWith("${")) prev = "{";
    } else if (c === "{" && stack.length) {
      stack[stack.length - 1] += 1;
      out += c; i += 1; prev = c;
    } else if (c === "}" && stack.length) {
      stack[stack.length - 1] -= 1;
      out += c; i += 1; prev = c;
      if (stack[stack.length - 1] === 0) {
        stack.pop();
        // resume the template literal text after the closing brace
        for (;;) {
          let j = i;
          while (j < n && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) j += src[j] === "\\" ? 2 : 1;
          out += blank(src.slice(i, j));
          if (j >= n) { i = n; break; }
          if (src[j] === "`") { out += "`"; i = j + 1; prev = "`"; break; }
          out += "${"; i = j + 2; stack.push(1); prev = "{"; break;
        }
      }
    } else if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev))) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== "\n" && (src[j] !== "/" || cls)) {
        if (src[j] === "\\") j += 1;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        j += 1;
      }
      j += 1;
      while (j < n && /[a-z]/.test(src[j])) j += 1;
      out += "/ /";
      i = j;
      prev = "/";
    } else {
      out += c;
      i += 1;
      if (!/\s/.test(c)) prev = c;
    }
  }
  return out;
}

// ---------------------------------------------------------------- computation of statistics (AC-UX-10, D6)
// Each rule says what it catches. Display formatting (toFixed, toLocaleString, Intl, template text, padding,
// join, String/Number parsing), filtering, `.sort()` and look-ups are deliberately NOT matched.
const KW = /\b(return|case|typeof|void|delete|yield|await|else|in|of|new|throw)\b(?=\s*[-+])/g;
export const COMPUTE_RULES = {
  // `x += n`, `i++`, `a /= b`: running totals, counters, accumulators, rescaling in place.
  "compound assignment or increment": /\+=|-=|\*=|\/=|%=|\*\*=|\+\+|(?<![-\w])--(?![-\w])/,
  // `a * b`, `a / b`, `a % b`, `a ** b`: ratios, shares, percent, rescaling, means by division, modulo ranks.
  "multiply, divide, modulo, power": /[\w)\]]\s*(?:\*\*|[*/%])\s*[\w(\[]/,
  // `a - b`: differences, distances, spreads, z-score numerators, positions from offsets.
  "subtraction": /[\w)\]]\s*-\s*[\w(]/,
  // `a + b` between two operands (strings are blanked so `"x" + y` and template text do not match): sums, totals.
  "addition": /[\w)\]]\s*\+\s*[\w$(]/,
  // Math.min/max/abs/round/floor/sqrt/pow/sign ...: extents, rounding of values, distances.
  "Math function": /\bMath\s*\.\s*\w+/,
  // `.reduce(...)`: sums, means, extents, counts folded over values.
  "array reduction": /\.\s*reduce(?:Right)?\s*\(/,
  // d3 (d3.mean, d3.rank, d3.quantile, d3.extent, d3.group ...): any use, import or Plot reducer/transform.
  "d3 statistics": /\bd3\s*\.|\bPlot\s*\.\s*(?:bin\w*|group\w*|window\w*|normalize\w*|map\w*|select\w*|stack\w*|density|hexbin|centroid|shift)\b/,
  // Calls or definitions with a statistics name: mean(, median(, rank(, quantile(, percentile(, zscore(, sum(,
  // composite(, overall(, weighted..., aggregate..., computeX(, calcX(, deriveX(, anything with Mean/Median/Quantile/...
  "statistics-named function": /(?<![\w$])(?:(?:mean|median|average|quantile|percentile|rank|zscore|stdev|stddev|variance|composite|overall|weighted|aggregate)\w*|mode|avg|cumsum|sum|total|score|compute\w*|calc\w*|calculate\w*|derive\w*|\w*(?:Mean|Median|Quantile|Zscore|Stdev|Variance|Composite|Weighted|Aggregate)\w*)\s*\(/
};
// Import specifiers are strings (blanked above), so d3 imports are matched on the raw line.
const D3_IMPORT = /\b(?:from|import)\s*\(?\s*["'`](?:npm:)?d3(?:-[\w-]+)?(?:@[\w.]+)?(?:\/[^"'`]*)?["'`]/;
// Banned words and fields in ANY text (strings and comments included): judgement words (ADR-025 decision 11,
// AC-UX-13), the removed removed baseline phrasing, and the fields ADR-026 forbids in percentile/direction code.
export const BANNED_WORDS = {
  "judgement word": /\b(?:good|bad|strong|weak|healthy|risky)\b/i,
  "removed baseline phrasing": /\bfirst\s+(?:stored\s+)?release\b/i,
  "adverse_dir or display_dir": /\b(?:adverse_dir|display_dir)\b/
};

// Returns [{rule, line, text}] for a source file.
export function computeHits(source) {
  const code = stripNoise(source).replace(KW, "$1;").replace(/\bimport\s*\*\s*as\b|\bexport\s*\*/g, (m) => " ".repeat(m.length));
  const lines = source.split("\n");
  const hits = [];
  code.split("\n").forEach((l, k) => {
    for (const [rule, re] of Object.entries(COMPUTE_RULES)) if (re.test(l)) hits.push({rule, line: k + 1, text: (lines[k] ?? "").trim()});
    if (D3_IMPORT.test(lines[k] ?? "") && !hits.some((h) => h.line === k + 1 && h.rule === "d3 statistics")) hits.push({rule: "d3 statistics", line: k + 1, text: (lines[k] ?? "").trim()});
  });
  source.split("\n").forEach((l, k) => {
    for (const [rule, re] of Object.entries(BANNED_WORDS)) if (re.test(l)) hits.push({rule, line: k + 1, text: l.trim()});
  });
  return hits;
}

// Applies an explicit allow-list. Each entry {file, rule, contains, clause}; a hit is allowed when file and rule
// are equal and its source line contains `contains`. Returns {violations, unused}: an entry that matches no hit
// is reported too, so the list cannot grow stale or silently widen.
export function applyAllowList(hitsByFile, allow) {
  const used = new Set();
  const violations = [];
  for (const [file, hits] of Object.entries(hitsByFile)) {
    for (const h of hits) {
      const idx = allow.findIndex((a) => a.file === file && a.rule === h.rule && h.text.includes(a.contains));
      if (idx >= 0) used.add(idx);
      else violations.push(`${file}:${h.line}: ${h.rule}: ${h.text.slice(0, 100)}`);
    }
  }
  const unused = allow.filter((_, i) => !used.has(i)).map((a) => `${a.file}: ${a.rule}: ${a.contains}`);
  return {violations, unused};
}

// ---------------------------------------------------------------- built output (AC-UX-11, AC-UX-12)
// Namespace identifiers are strings, not requests. Exact URLs only (no prefix matching).
export const ALLOWED_URLS = new Set([
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/2000/xmlns/",
  // text of a comment in the bundled apache-arrow / flatbuffers sources, never fetched (AC-NPM-3 allow-list)
  "https://www.jsdelivr.com/using-sri-with-dynamic-files"
]);
export const URL_RE = /(?:https?:)?\/\/[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}[A-Za-z0-9._~:/?#@!$&*+,;=%-]*/g;
const FONT_EXT = /\.(?:woff2?|ttf|otf|eot)$/i;
export const FONT_FILE = (name) => FONT_EXT.test(name);

// Text findings for one built or source file: absolute/protocol-relative URLs not on the allow-list, a remote
// @import, and (CSS) a @font-face or font data URI.
export function distFindings(name, text) {
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:)]+$/, "");
    if (/^https?:\/\//.test(u) ? !ALLOWED_URLS.has(u) : !/^\/\/(?:\/|$)/.test(u) && /[\s"'(=]/.test(text[m.index - 1] ?? " ")) out.push(`URL ${u.slice(0, 80)}`);
  }
  if (/\.css$/i.test(name)) {
    if (/@import\s*(?:url\(\s*)?["']?\s*(?:https?:)?\/\//i.test(text)) out.push("remote @import");
    if (/@font-face/i.test(text)) out.push("@font-face");
    if (/data:(?:application\/(?:x-)?font|font\/|application\/vnd\.ms-fontobject)/i.test(text)) out.push("font data URI");
  }
  return out;
}
