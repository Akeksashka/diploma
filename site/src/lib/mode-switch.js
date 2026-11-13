// V8 (ADR-037 decision 1, spec 2, A1.3): the Country / Compare mode switch at the top of the filter bar. The mode comes from the ROUTE, never from a hash
// key (`m` is removed): /country and /country/<id> are Country, /compare and /indicator/<id> are Compare. The switch is a group of two plain links with
// aria-current="page" on the current one (a link set, not the ARIA tabs pattern: each tab is a page, so a real link works without JavaScript and keeps
// Back/Forward). It is a labelled group, not a second <nav> landmark: the header nav stays the only navigation landmark (T104). It is built as one HTML string from one model, so the same markup is in the built page (no JavaScript) and in the live filter bar.
// Display only: nothing is computed. Targets keep c, i, g, p, ... through data-carry (carry.js CARRY_KEYS); a page that fixes a key says so in `set`.
import {DRAFT_MODE_LABELS, DRAFT_MODE_SWITCH_LABEL} from "./copy.js";

export const MODES = Object.freeze(["country", "compare"]);

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const ID = /^[A-Za-z0-9_.-]+$/;

// Route -> mode: "country" for /country and /country/<id>, "compare" for /compare and /indicator/<id>, null for any other page (no mode switch there).
// `base` is the tree's configured base ("/" or "/uk/", scripts/lib/lang-config.mjs langSettings); it is stripped first, so /uk/country/PL is Country.
export function stripBase(path, base = "/") {
  const p = String(path ?? "");
  if (base === "/" || base === "") return p;
  const b = base.replace(/\/+$/, ""); // "/uk"
  if (p === b) return "/";
  return p.startsWith(`${b}/`) ? p.replace(b, "") : p; // the first match is the leading prefix
}

export function modeOfPath(path, base = "/") {
  const p = stripBase(path, base).replace(/\/index$/, "").replace(/\/+$/, "") || "/";
  if (p === "/country" || p.startsWith("/country/")) return "country";
  if (p === "/compare" || p.startsWith("/indicator/")) return "compare";
  return null;
}

// {mode, hrefs: {country, compare}, set?: {country?: {k: v}, compare?: {k: v}}} -> {label, tabs: [{mode, label, href, current, set}]}. Labels are the DRAFT copy constants.
export function modeSwitchModel({mode, hrefs, set = {}}) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode: ${JSON.stringify(mode)}`);
  return {
    label: DRAFT_MODE_SWITCH_LABEL,
    tabs: MODES.map((m) => {
      const fixed = Object.entries(set[m] ?? {});
      for (const [k, v] of fixed) if (!/^[a-z]+$/.test(k) || !ID.test(String(v))) throw new Error(`unsafe carry-set: ${k}=${v}`);
      return {mode: m, label: DRAFT_MODE_LABELS[m], href: hrefs[m], current: m === mode, set: fixed.map(([k, v]) => `${k}=${v}`).join("&")};
    })
  };
}

// One line of HTML (it is written into the generated page's slot and into the filter bar).
export function modeSwitchHtml(opts) {
  const model = modeSwitchModel(opts);
  const items = model.tabs.map((t) => `<li><a href="${esc(t.href)}" data-carry="${t.mode}"${t.set ? ` data-carry-set="${esc(t.set)}"` : ""}${t.current ? ' aria-current="page"' : ""}>${esc(t.label)}</a></li>`).join("");
  return `<div class="mm-mode-switch" role="group" aria-label="${esc(model.label)}"><ul>${items}</ul></div>`;
}

// Browser: the same markup as a node, for the live filter bar (`html` is the htl tag; the node is parsed from the string, so there is one source).
export function mountModeSwitch(html, opts) {
  const holder = html`<div></div>`;
  holder.innerHTML = modeSwitchHtml(opts);
  return holder.firstElementChild;
}
