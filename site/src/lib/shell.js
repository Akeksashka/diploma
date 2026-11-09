// Shared page chrome. `html` is the htl template tag provided by Framework to pages and passed in,
// so this module has no imports and no off-origin dependency.
import {bannerMessage, staleness, utcDate} from "./stale.js";
import {sourceAttributions} from "./attribution.js";
import {DRAFT_CONSEQUENCE, DRAFT_FRESHNESS_LINE, NAV_LABEL, SKIP_LINK_TEXT} from "./copy.js";
import {failureBlocks, noscriptHtml} from "./state-blocks.js";

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const norm = (p) => (String(p ?? "").replace(/\/index$/, "").replace(/\/+$/, "") || "/");

// Static header markup (a string, for Framework's `header` option, so it is in the built HTML without
// JavaScript): skip link first in DOM order, then the site title and the `pages` navigation, then the <noscript> notice
// (T105: the only no-JS content, because Framework renders every cell in the browser). It adds no
// heading: the page's own h1 is the only h1. `path` is the page path; the matching link gets aria-current.
export function headerHtml({title, pages, path}) {
  const here = norm(path);
  const items = pages.map((p) => `<li><a href="${esc(p.path)}"${norm(p.path) === here ? ' aria-current="page"' : ""}>${esc(p.name)}</a></li>`).join("");
  return `<a class="mm-skip" href="#observablehq-main">${esc(SKIP_LINK_TEXT)}</a>\n<div class="mm-header"><a class="mm-site-title" href="${esc(pages[0]?.path ?? "/")}">${esc(title)}</a>\n<nav class="mm-nav" aria-label="${esc(NAV_LABEL)}"><ul>${items}</ul></nav></div>\n${noscriptHtml()}`;
}

export function statusBlock(html, manifest, now = Date.now()) {
  const msg = bannerMessage(staleness(manifest.known_cutoff, now));
  return html`<div class="mm-status">${msg ? html`<p class="mm-banner" id="stale-banner" role="alert">${msg}</p>` : ""}<p class="mm-asof">${DRAFT_FRESHNESS_LINE(utcDate(manifest.known_cutoff), manifest.build_id)}</p></div>`;
}

// Top of every page after loading (T105): the freshness line and stale banner when the manifest loaded, then one alert per
// failed region (`boot` is the result of loadAll). With no failure and a manifest it equals statusBlock.
export function pageHead(html, boot, page, now = Date.now()) {
  return html`${boot.data.manifest ? statusBlock(html, boot.data.manifest, now) : ""}${boot.ok ? "" : failureBlocks(html, boot.failures, DRAFT_CONSEQUENCE[page])}`;
}

export function attributionBlock(html, seriesMeta, indicatorIds = null) {
  const list = sourceAttributions(seriesMeta, indicatorIds);
  return html`<section class="mm-attribution" id="source-attribution"><h2>Sources</h2>${list.length === 0 ? html`<p>No source attribution available.</p>` : html`<ul>${list.map((s) => html`<li>${s.url ? html`<a href="${s.url}" rel="noopener">${s.name}</a>` : s.name}${s.attribution ? html`: ${s.attribution}` : ""}</li>`)}</ul>`}</section>`;
}
