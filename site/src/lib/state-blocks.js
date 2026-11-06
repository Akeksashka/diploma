// Shared state blocks (T105, ADR-025 decision 10, AC-UX-8): loading, empty, error and no-JS. `html` is htl's tag,
// passed in, so this module imports only copy.js. Rules every block follows:
//   - an error names the logical region (copy.js DRAFT_REGIONS), says what is not shown, and carries role="alert";
//   - it never contains a URL, a file path, an error message or a number from the failed file;
//   - a failed region renders no table, chart or figure of its own (no partial numbers).
import {DRAFT_ERROR_INVALID, DRAFT_ERROR_TITLE, DRAFT_ERROR_VERSION, DRAFT_LOADING, DRAFT_NOSCRIPT} from "./copy.js";

// kind: "missing" (file could not be fetched), "invalid" (unreadable or failed the schema check),
// "version" (unknown manifest major).
export function failureKind(error, fallback = "invalid") {
  if (error && typeof error === "object" && error.kind === "version") return "version";
  if (error instanceof SyntaxError) return "invalid";
  return fallback;
}

// Runs one region: load() fetches, parse(raw) validates and shapes. Never throws; the error text is dropped on purpose.
export async function settle({key, region, load, parse = (x) => x}) {
  let raw;
  try {
    raw = await load();
  } catch (e) {
    return {ok: false, key, region, kind: failureKind(e, "missing")};
  }
  try {
    return {ok: true, key, region, value: await parse(raw)};
  } catch (e) {
    return {ok: false, key, region, kind: failureKind(e, "invalid")};
  }
}

// Loads every spec in parallel, then runs derive(data) (view-model construction) in the same guard.
// Returns {ok, data, derived, failures}; on any failure `data` still holds the regions that did load.
export async function loadAll(specs, derive = null, deriveRegion = null) {
  const results = await Promise.all(specs.map(settle));
  const data = {};
  const failures = [];
  for (const r of results) {
    if (r.ok) data[r.key] = r.value;
    else failures.push({key: r.key, region: r.region, kind: r.kind});
  }
  let derived = null;
  if (failures.length === 0 && derive) {
    const d = await settle({key: "derived", region: deriveRegion ?? specs[0].region, load: async () => data, parse: derive});
    if (d.ok) derived = d.value;
    else failures.push({key: d.key, region: d.region, kind: "invalid"});
  }
  return {ok: failures.length === 0, data, derived, failures};
}

export const errorTitle = (region, kind) => (kind === "version" ? DRAFT_ERROR_VERSION(region) : kind === "invalid" ? DRAFT_ERROR_INVALID(region) : DRAFT_ERROR_TITLE(region));

// One alert block for one failed region.
export function errorBlock(html, {region, kind = "missing", consequence, id = "mm-error"}) {
  return html`<div class="mm-state mm-state-error" role="alert" data-state="error" data-kind="${kind}" id="${id}"><p class="mm-state-title">${errorTitle(region, kind)}</p><p>${consequence}</p></div>`;
}

// One alert per failed region of loadAll().
export function failureBlocks(html, failures, consequence) {
  return html`<div class="mm-state-list">${failures.map((f) => errorBlock(html, {region: f.region, kind: f.kind, consequence, id: `mm-error-${f.key}`}))}</div>`;
}

// Loading container: reserves height in CSS (.mm-loading), aria-busy="true" while it waits. `visible: false` creates it idle
// and hidden, for a region that loads later (the series file of a chosen indicator).
// (htl drops an attribute whose value is false, so `hidden` is set only for the idle form.)
export function busyBlock(html, what, {id = "mm-loading", visible = true} = {}) {
  return html`<div class="mm-state mm-loading" role="status" data-state="loading" id="${id}" aria-busy="${visible ? "true" : "false"}" hidden=${!visible}><p>${DRAFT_LOADING(what)}</p></div>`;
}

export function setBusy(el, on) {
  if (!el) return;
  el.setAttribute("aria-busy", on ? "true" : "false");
  el.hidden = !on;
}

// Empty state: the confirmed sentence, then a next step. `id` stays on the paragraph (existing selectors keep working).
export function emptyBlock(html, {id, text, next}) {
  return html`<p class="mm-state mm-state-empty" id="${id}" data-state="empty">${text} <span class="mm-next">${next}</span></p>`;
}

// Static markup for the header (Framework's `header` option puts it in the built HTML, so it exists without JavaScript).
export const noscriptHtml = () => `<noscript><p class="mm-noscript" role="note">${DRAFT_NOSCRIPT}</p></noscript>`;
