// Reusable Playwright helpers for the UX checks (T107; ADR-025 AC-UX-3, 4, 6, 7, 12). Nothing here needs network beyond
// 127.0.0.1. Pages come from support.mjs `openPage`; these helpers only emulate media, sample the DOM and write files.
import {mkdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {contrastRatio} from "../../scripts/lib/contrast.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// Git-ignored (site/.gitignore). TODO(OP-07, blocker B5): upload this directory as a CI artifact once the user supplies a
// verified commit SHA for actions/upload-artifact. No upload step exists until then; screenshots stay local.
export const ARTIFACT_DIR = resolve(process.env.MM_SMOKE_ARTIFACTS ?? join(here, "..", "..", "test-artifacts"));

export const VIEWPORTS = [320, 390, 768, 1280, 1920];
export const SCHEMES = ["light", "dark"];

// ---- emulation -------------------------------------------------------------------------------------------------------
export const setTheme = (page, colorScheme) => page.emulateMedia({colorScheme});
export const setViewport = (page, width, height = 900) => page.setViewportSize({width, height});
export const setForcedColors = (page, on = true) => page.emulateMedia({forcedColors: on ? "active" : "none"});
export const setPrint = (page, on = true) => page.emulateMedia({media: on ? "print" : "screen"});
export const setReducedMotion = (page, on = true) => page.emulateMedia({reducedMotion: on ? "reduce" : "no-preference"});

// ---- colour ----------------------------------------------------------------------------------------------------------
// Computed colours are "rgb(r, g, b)" or "rgba(r, g, b, a)" (or "color(srgb ...)" in newer Chrome). Returns {hex, alpha} or null.
export function cssToHex(value) {
  const m = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+%?))?\s*\)$/.exec(value.trim());
  let ch;
  let a = 1;
  if (m) {
    ch = [m[1], m[2], m[3]].map(Number);
    if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4]);
  } else {
    const c = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value.trim());
    if (!c) return null;
    ch = [c[1], c[2], c[3]].map((v) => Math.round(Number(v) * 255));
    if (c[4] !== undefined) a = Number(c[4]);
  }
  return {hex: `#${ch.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`, alpha: a};
}
export const ratioOfCss = (fg, bg) => {
  const f = cssToHex(fg);
  const b = cssToHex(bg);
  return f && b ? contrastRatio(f.hex, b.hex) : null;
};

// Browser-side function (serialised by Playwright, so it must be self-contained). Samples every visible element that owns
// text, and returns its colour, the effective opaque background found by walking up the ancestors, and size facts.
export function sampleTextColours(page) {
  return page.evaluate(() => {
    const out = [];
    // Newer Chrome returns oklch()/color() for computed colours; a 1 px canvas converts any CSS colour to sRGB (gamut-clipped).
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", {willReadFrequently: true});
    const rgb = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    };
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "OPTION"]);
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const bgOf = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage !== "none") return {value: null, why: `background-image on <${n.localName}>`};
        const c = rgb(cs.backgroundColor);
        const alpha = Number(/,\s*([\d.]+)\)$/.exec(c)[1]);
        if (alpha === 1) return {value: c};
        if (alpha > 0) return {value: null, why: `translucent background on <${n.localName}>`};
      }
      return {value: "rgb(255, 255, 255)"}; // canvas default when nothing paints a background
    };
    const label = (el) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
      return `${el.localName}${id}${cls}`;
    };
    for (const el of document.body.querySelectorAll("*")) {
      if (skip.has(el.tagName.toUpperCase()) || el.closest("svg")) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own || !visible(el) || el.matches(":disabled")) continue;
      const cs = getComputedStyle(el);
      const bg = bgOf(el);
      out.push({
        el: label(el),
        text: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 40),
        color: rgb(cs.color),
        bg: bg.value,
        why: bg.why ?? null,
        px: parseFloat(cs.fontSize),
        bold: Number(cs.fontWeight) >= 700
      });
    }
    return out;
  });
}
// WCAG large text: >= 24 px, or >= 18.66 px bold. Everything else needs 4.5, large text 3.
export const requiredTextRatio = (s) => (s.px >= 24 || (s.bold && s.px >= 18.66) ? 3 : 4.5);

// Tokens as computed in the page, as hex, for comparison with resolveThemes() of style.css.
export function computedTokens(page, names) {
  return page.evaluate((list) => Object.fromEntries(list.map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])), names);
}

// ---- keyboard --------------------------------------------------------------------------------------------------------
// Every element the browser can reach with Tab, in DOM-derived order (rendered, not disabled, tabindex >= 0).
export function focusables(page) {
  return page.evaluate(() => {
    const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]';
    return [...document.querySelectorAll(sel)]
      .filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        // A radio group is one Tab stop (the checked radio, else the first); the others are reached with the arrow keys.
        if (el.type === "radio") {
          const group = [...document.querySelectorAll(`input[type="radio"][name="${el.name}"]`)];
          if (el !== (group.find((x) => x.checked) ?? group[0])) return false;
        }
        // Content of a closed <details> is not focusable; its own summary is, unless an ancestor <details> is closed too (nested: Browse > per-domain lists).
        const closed = (el.localName === "summary" && el.parentElement?.localName === "details" ? el.parentElement.parentElement : el)?.closest("details:not([open])");
        if (closed) return false;
        return !el.matches(":disabled") && el.tabIndex >= 0 && cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0;
      })
      .map((el) => el.localName + (el.id ? `#${el.id}` : ""));
  });
}

// Browser-side snapshot of the focused element: outline, background, box, and any fixed/sticky box covering it.
const FOCUS_SNAPSHOT = () => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const ctx = cv.getContext("2d", {willReadFrequently: true});
  const rgb = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [cr, cg, cb, ca] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${cr}, ${cg}, ${cb}, ${ca / 255})`;
  };
  let bg = "rgb(255, 255, 255)";
  for (let n = el.parentElement; n; n = n.parentElement) {
    const b = rgb(getComputedStyle(n).backgroundColor);
    if (b.endsWith(", 1)")) {
      bg = b;
      break;
    }
  }
  const covering = [];
  for (const o of document.querySelectorAll("body *")) {
    const p = getComputedStyle(o).position;
    if ((p !== "fixed" && p !== "sticky") || o.contains(el) || el.contains(o)) continue;
    const q = o.getBoundingClientRect();
    if (q.width === 0 || q.height === 0 || getComputedStyle(o).visibility === "hidden") continue;
    const w = Math.min(r.right, q.right) > Math.max(r.left, q.left);
    const h = Math.min(r.bottom, q.bottom) > Math.max(r.top, q.top);
    if (w && h) covering.push(`${o.localName}${o.id ? `#${o.id}` : ""}`);
  }
  const wrapsLabel = el.closest("label");
  return {
    id: `${el.localName}${el.id ? `#${el.id}` : ""}${el.getAttribute("href") ? `[href=${el.getAttribute("href")}]` : ""}${el.getAttribute("name") ? `[name=${el.getAttribute("name")}]` : ""}`,
    outlineStyle: cs.outlineStyle,
    outlineWidth: parseFloat(cs.outlineWidth),
    outlineColor: rgb(cs.outlineColor),
    bg,
    box: {top: r.top, bottom: r.bottom, left: r.left, right: r.right},
    inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    covering,
    label: Boolean(wrapsLabel)
  };
};

// Presses Tab from the top of the document until focus leaves the page (or `max` presses). Returns the snapshots in order, plus
// `trap` (the same element held focus on two consecutive presses, so Tab could not move on) and `left` (focus reached the
// browser chrome/body again, i.e. there was no trap).
export async function tabTraversal(page, {max = 400} = {}) {
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  const stops = [];
  let trap = null;
  let left = false;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(FOCUS_SNAPSHOT);
    if (!s) {
      left = true;
      break;
    }
    if (stops.length && stops.at(-1).id === s.id && stops.at(-1).box.top === s.box.top && stops.at(-1).box.left === s.box.left) {
      trap = s.id;
      break;
    }
    stops.push(s);
  }
  return {stops, trap, left, pressed: stops.length};
}

export function interactiveTargets(page) {
  return page.evaluate(() => {
    const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || el.matches(":disabled")) continue;
      if (el.classList.contains("mm-skip")) continue; // only on screen when focused; measured separately via the focus walk
      // WCAG 2.5.8 inline exception: a link inside a sentence is exempt.
      const parent = el.parentElement;
      const sentence = el.localName === "a" && cs.display === "inline" && [...(parent?.childNodes ?? [])].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (sentence) continue;
      out.push({el: `${el.localName}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""} "${(el.textContent ?? "").trim().slice(0, 24)}"`, w: r.width, h: r.height});
    }
    return out;
  });
}

// ---- layout ----------------------------------------------------------------------------------------------------------
// Page-level horizontal overflow, and the elements that reach past the viewport but are NOT inside a scrollable container.
export function horizontalOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollW = document.documentElement.scrollWidth;
    const offenders = [];
    const scrolls = (n) => {
      const o = getComputedStyle(n).overflowX;
      return (o === "auto" || o === "scroll" || o === "hidden") && n !== document.documentElement && n !== document.body;
    };
    if (scrollW > vw) {
      for (const el of document.body.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 0.5) continue;
        let inside = false;
        for (let n = el.parentElement; n; n = n.parentElement) if (scrolls(n)) inside = true;
        if (!inside) offenders.push(`${el.localName}${el.id ? `#${el.id}` : ""} right=${Math.round(r.right)}`);
        if (offenders.length >= 8) break;
      }
    }
    return {vw, scrollW, offenders};
  });
}

// ---- layout stability ------------------------------------------------------------------------------------------------
// Call BEFORE page.goto. Collects layout-shift entries (buffered) without recent input.
export const installCls = (page) =>
  page.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({type: "layout-shift", buffered: true});
    } catch {
      window.__clsUnsupported = true;
    }
  });
export const readCls = (page) => page.evaluate(() => ({cls: window.__cls ?? null, unsupported: Boolean(window.__clsUnsupported)}));

// ---- screenshots -----------------------------------------------------------------------------------------------------
export async function screenshot(page, name, mode) {
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  const path = join(ARTIFACT_DIR, `${name}-${mode}.png`);
  await page.screenshot({path, fullPage: true});
  return path;
}
