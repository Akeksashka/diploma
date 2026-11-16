// Shared page chrome. `html` is the htl template tag provided by Framework to pages and passed in,
// so this module has no imports and no off-origin dependency.
import {bannerMessage, staleness, utcDate} from "./stale.ac9ba480.js";
import {sourceAttributions} from "./attribution.a296f2f6.js";
import {DRAFT_CONSEQUENCE, FRESHNESS_LINE, NAV_LABEL, SKIP_LINK_TEXT} from "./copy.11b4a285.js";
import {failureBlocks, noscriptHtml} from "./state-blocks.81d10981.js";
import {installCarry} from "./carry.5a787523.js";
import {langSwitchHtml} from "./lang-switch.e5b7f9b7.js";
import {i18n} from "./i18n.4f9e47d5.js";
const X = (key, params) => i18n.t(key, params);

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
// V8: the mode pages carry only the keys that stay meaningful for them (carry.js CARRY_KEYS); every other header link carries the whole hash as before.
const CARRY_TARGET = {"/country": "country", "/compare": "compare"};
const norm = (p) => (String(p ?? "").replace(/\/index$/, "").replace(/\/+$/, "") || "/");
// A Country page fixes the country: its header Compare link forces c to that entity (data-carry-set), so a stale c in the hash never disagrees with the page.
const COUNTRY_PAGE = /^\/country\/([A-Za-z][A-Za-z0-9_.-]{0,40})$/;

// Static header markup (a string, for Framework's `header` option, so it is in the built HTML without
// JavaScript): skip link first in DOM order, then the site title and the `pages` navigation, then the language switch (V46: a link outside the nav landmark, so the nav stays the six pages), then the <noscript> notice
// (T105: the only no-JS content, because Framework renders every cell in the browser). It adds no
// heading: the page's own h1 is the only h1. `path` is the page path; the matching link gets aria-current.
export function headerHtml({title, pages, path, lang = "en"}) {
  const here = norm(path);
  const fixed = COUNTRY_PAGE.exec(here)?.[1] ?? null;
  const set = (p) => (fixed && norm(p.path) === "/compare" ? ` data-carry-set="c=${esc(fixed)}"` : "");
  const items = pages.map((p) => `<li><a href="${esc(p.path)}" data-carry${CARRY_TARGET[norm(p.path)] ? `="${CARRY_TARGET[norm(p.path)]}"` : ""}${set(p)}${norm(p.path) === here ? ' aria-current="page"' : ""}>${esc(p.name)}</a></li>`).join("");
  return `<a class="mm-skip" href="#observablehq-main">${esc(SKIP_LINK_TEXT)}</a>\n<div class="mm-header"><a class="mm-site-title" href="${esc(pages[0]?.path ?? "/")}">${esc(title)}</a>\n<nav class="mm-nav" aria-label="${esc(NAV_LABEL)}"><ul>${items}</ul></nav>\n${langSwitchHtml({path, lang})}</div>\n${noscriptHtml()}`;
}

export function statusBlock(html, manifest, now = Date.now()) {
  const msg = bannerMessage(staleness(manifest.known_cutoff, now));
  return html`<div class="mm-status">${msg ? html`<p class="mm-banner" id="stale-banner" role="alert">${msg}</p>` : ""}<p class="mm-asof">${FRESHNESS_LINE(utcDate(manifest.known_cutoff), manifest.build_id)}</p><p class="mm-print-filters" id="print-filters"></p></div>`;
}

// Top of every page after loading (T105): the freshness line and stale banner when the manifest loaded, then one alert per
// failed region (`boot` is the result of loadAll). With no failure and a manifest it equals statusBlock.
export function pageHead(html, boot, page, now = Date.now()) {
  installCarry(); // L10: data-carry links get the current hash on click (a no-op without a document)
  return html`${boot.data.manifest ? statusBlock(html, boot.data.manifest, now) : ""}${boot.ok ? "" : failureBlocks(html, boot.failures, DRAFT_CONSEQUENCE[page])}`;
}

export function attributionBlock(html, seriesMeta, indicatorIds = null) {
  const list = sourceAttributions(seriesMeta, indicatorIds);
  return html`<section class="mm-attribution" id="source-attribution"><h2>${X("X_SOURCES_HEADING")}</h2>${list.length === 0 ? html`<p>${X("X_NO_ATTRIBUTION")}</p>` : html`<ul>${list.map((s) => html`<li>${s.url ? html`<a href="${s.url}" rel="noopener">${s.name}</a>` : s.name}${s.attribution ? html`: ${s.attribution}` : ""}</li>`)}</ul>`}</section>`;
}
