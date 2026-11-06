// ADR-025 decision 13 / AC-UX-1: WCAG 2.x contrast maths and a flat-hex token parser. Node built-ins only.
// Ratios are never rounded; a threshold is met only if the exact ratio is >= the limit.

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function parseHex(value) {
  const m = HEX.exec(String(value).trim());
  if (!m) throw new Error(`not a flat hex colour (#rgb or #rrggbb): ${JSON.stringify(value)}`);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function channel(v8) {
  const c = v8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function meets(ratio, min) {
  return ratio >= min;
}

// Remove /* */ comments, keeping offsets irrelevant.
function stripComments(css) {
  if (/\/\*(?![\s\S]*\*\/)/.test(css)) throw new Error("unterminated CSS comment");
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Split a CSS fragment into top-level {prelude, body} rules by brace matching.
function topLevelRules(css) {
  const rules = [];
  let depth = 0;
  let start = 0;
  let bodyStart = -1;
  let prelude = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        prelude = css.slice(start, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) throw new Error("unbalanced '}' in CSS");
      if (depth === 0) {
        rules.push({prelude, body: css.slice(bodyStart, i)});
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      start = i + 1; // top-level statement such as @import
    }
  }
  if (depth !== 0) throw new Error("unbalanced '{' in CSS");
  return rules;
}

// Declarations of --mm-* custom properties in a flat rule body (nested blocks are not allowed to hide any).
function mmDeclarations(body, where) {
  if (/[{}]/.test(body)) {
    if (/--mm-/.test(body)) throw new Error(`${where}: nested block containing --mm- tokens is not supported`);
    return {};
  }
  const out = {};
  for (const decl of body.split(";")) {
    const m = /^\s*(--mm-[\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(decl);
    if (!m) continue;
    if (Object.hasOwn(out, m[1])) throw new Error(`${where}: duplicate declaration of ${m[1]}`);
    out[m[1]] = m[2];
  }
  return out;
}

// A declaration of a --mm- token (not a var(--mm-x) use inside an ordinary rule).
const MM_DECL = /(?:^|[;{\s])--mm-[\w-]+\s*:/;

const DARK_MEDIA = /^@media\s*(?:screen\s+and\s+)?\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/;

// Returns {light, dark, raw}: raw values per block, plus nothing resolved. Dark here holds only overrides.
export function parseTokenBlocks(css) {
  const rules = topLevelRules(stripComments(css));
  const light = {};
  const dark = {};
  for (const {prelude, body} of rules) {
    if (prelude === ":root") {
      for (const [k, v] of Object.entries(mmDeclarations(body, ":root"))) {
        if (Object.hasOwn(light, k)) throw new Error(`duplicate declaration of ${k} across :root blocks`);
        light[k] = v;
      }
    } else if (DARK_MEDIA.test(prelude)) {
      for (const inner of topLevelRules(body)) {
        if (inner.prelude === ":root") {
          for (const [k, v] of Object.entries(mmDeclarations(inner.body, "dark :root"))) {
            if (Object.hasOwn(dark, k)) throw new Error(`duplicate dark declaration of ${k}`);
            dark[k] = v;
          }
        } else if (MM_DECL.test(inner.body)) {
          throw new Error(`--mm- tokens declared under unsupported selector in dark block: ${inner.prelude}`);
        }
      }
    } else if (MM_DECL.test(body)) {
      throw new Error(`--mm- tokens declared under unsupported rule: ${prelude}`);
    }
  }
  return {light, dark};
}

// Resolve tokens per theme to flat hex. Values for tokens with a non-colour prefix are skipped;
// anything else that is not flat hex throws (color-mix, rgb(), var(), named colours, alpha hex).
export function resolveThemes(css, nonColourPrefixes = []) {
  const {light, dark} = parseTokenBlocks(css);
  const isNonColour = (name) => nonColourPrefixes.some((p) => name.startsWith(p));
  const build = (raw, theme) => {
    const out = {};
    for (const [name, value] of Object.entries(raw)) {
      if (isNonColour(name)) continue;
      if (!HEX.test(value)) throw new Error(`${theme}: ${name}: ${JSON.stringify(value)} is not a flat hex colour`);
      out[name] = value.toLowerCase();
    }
    return out;
  };
  const lightColours = build(light, "light");
  const darkOverrides = build(dark, "dark");
  for (const name of Object.keys(darkOverrides)) {
    if (!Object.hasOwn(lightColours, name)) throw new Error(`dark: ${name} has no light-theme declaration`);
  }
  return {light: lightColours, dark: {...lightColours, ...darkOverrides}};
}

// pairs: [{fg, bg, min, kind}]. Returns {results, errors}; errors are structural (undeclared or missing tokens).
export function checkPairs(themes, pairs) {
  const results = [];
  const errors = [];
  const used = new Set();
  for (const p of pairs) {
    used.add(p.fg);
    used.add(p.bg);
  }
  for (const theme of ["light", "dark"]) {
    const tokens = themes[theme];
    for (const name of Object.keys(tokens)) {
      if (!used.has(name)) errors.push(`${theme}: token ${name} has no declared contrast pair`);
    }
    for (const p of pairs) {
      const missing = [p.fg, p.bg].filter((t) => !Object.hasOwn(tokens, t));
      if (missing.length) {
        errors.push(`${theme}: pair ${p.fg} on ${p.bg} references undeclared token(s) ${missing.join(", ")}`);
        continue;
      }
      const ratio = contrastRatio(tokens[p.fg], tokens[p.bg]);
      results.push({theme, fg: p.fg, bg: p.bg, kind: p.kind, min: p.min, ratio, ok: meets(ratio, p.min)});
    }
  }
  return {results, errors};
}
