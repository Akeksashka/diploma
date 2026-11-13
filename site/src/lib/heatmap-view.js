// Renders a heatmapModel() result as an accessible HTML table (T110) and wires sorting and the cell facts (T112).
// `html` is htl's tag, passed in. The table has a caption, th scope on rows and columns, text in every cell, one tbody per row
// group (aggregates have their own, with no colour), a sticky header and first column inside its own scroll container with a
// visible hint. Colours and patterns come from style.css through data-bin, data-state and data-signature; no colour here.
import {AGGREGATE_NOT_RANKED, AHEAD_TAG, COUNTRY_HEADER, COVERAGE_HEADER, DRAFT_FACT_LABELS as FACT, DRAFT_HEATMAP_CAPTION, DRAFT_HEATMAP_CAPTION_INFO, DRAFT_SCROLL_HINT, HEATMAP_INDICATOR_LINK, HEATMAP_INDICATOR_LINK_LABEL, INFORMATIONAL_NOTICE, NA, ORIENTATION_NOTE, POSITION_HEADER} from "./copy.js";
import {glyph} from "./glyphs.js";
import {nextSort, sortRows} from "./heatmap.js";

// Links to the other pages (R11). The page is /domain/<id>, so a sibling folder is "../".
export const countryHref = (entityId) => `../country/${entityId}`;
export const indicatorPageHref = (indicatorId) => `../indicator/${indicatorId}`;

const shown = (v) => (v === null || v === undefined ? NA : v);

// The marks and words inside one cell, by state. The stored figure is the content wherever there is one.
function cellContent(html, st, c, isMean = false) {
  const decor = st.decorations.map((d) => html`<span class="mm-mark" data-mark="${d.key}">${d.glyph ? glyph(html, d.glyph) : ""}${d.code}</span>`);
  switch (st.key) {
    case "ranked":
      return html`<span class="mm-fig">${isMean ? c.meanText : c.percentileText}</span>${decor}`;
    case "ahead":
      return html`<span class="mm-fig">${c.percentileText}</span><span class="mm-tag">${AHEAD_TAG}</span>${decor}`;
    case "low_coverage":
      return html`${glyph(html, st.glyph)}<span class="mm-fig">${c.meanText}</span><span class="mm-code">${st.code}</span>`;
    case "stale":
      return html`${glyph(html, st.glyph)}<span class="mm-fig">${c.valueText}</span><span class="mm-code">${st.code}</span>${decor}`;
    case "lagging":
    case "unaligned":
      return html`<span class="mm-code">${st.code}</span>${decor}`;
    case "inherited":
      return html`${glyph(html, st.glyph)}<span class="mm-code">${st.code}</span>${decor}`;
    case "descriptive":
      return html`<span class="mm-fig">${c.valueText}</span>${decor}`;
    case "na":
    case "not_published":
      return html`${glyph(html, st.glyph)}<span class="mm-code">${st.code}</span>`;
    case "aggregate":
      return html`<span class="mm-code">${AGGREGATE_NOT_RANKED}</span>`;
    default:
      return html`<span class="mm-fig">${isMean ? c.meanText : c.valueText}</span>${decor}`;
  }
}

// The name read for a cell: the state's own wording, then the bin label and the direction of the column.
function cellName(row, col, st, binText) {
  const tail = [binText, col.direction?.text].filter((x) => x && !st.accessibleName.includes(x));
  return [`${row.name}, ${col.name}: ${st.accessibleName}`, ...tail].join("; ");
}

function indicatorCell(html, row, entry, col) {
  if (entry === null) return html`<td class="mm-hm-cell" data-state="na" data-signature="dash"><span class="mm-cell">${NA}</span></td>`;
  const {state: st, cell: c, bin} = entry;
  const inner = cellContent(html, st, c);
  const name = cellName(row, col, st, entry.binLabel);
  const interactive = st.key !== "na" && st.key !== "not_published";
  const invalid = entry.invalid ? "true" : "false";
  const colour = bin === null ? "none" : String(bin);
  return interactive
    ? html`<td class="mm-hm-cell" data-indicator="${c.indicatorId}" data-state="${st.key}" data-signature="${st.signature}" data-bin="${colour}" data-invalid="${invalid}"><button type="button" class="mm-cell" aria-label="${name}">${inner}</button></td>`
    : html`<td class="mm-hm-cell" data-indicator="${c.indicatorId}" data-state="${st.key}" data-signature="${st.signature}" data-bin="${colour}" data-invalid="${invalid}"><span class="mm-cell"><span aria-hidden="true">${inner}</span><span class="mm-visually-hidden">${name}</span></span></td>`;
}

function domainFigureCells(html, row) {
  const {state: st, bin} = row.mean;
  const s = row.summary;
  const colour = bin === null ? "none" : String(bin);
  // One template per cell: htl wraps a fragment that starts with a table cell in its own row.
  return [
    html`<td class="mm-hm-mean" data-state="${st.key}" data-signature="${st.signature}" data-bin="${colour}"><span class="mm-cell"><span aria-hidden="true">${cellContent(html, st, s, true)}</span><span class="mm-visually-hidden">${st.accessibleName}</span></span></td>`,
    html`<td class="mm-num mm-hm-n">${s.coverageText}</td>`,
    html`<td class="mm-hm-pos${st.key === "ranked" ? "" : " mm-na"}">${s.positionText}</td>`
  ];
}

// Options of the table (L13): `hrefs` {country, indicator} builders (the home page sits at the site root), `carry` marks links with data-carry (L10),
// `orientation` false leaves the orientation note out of the header (the home card prints it once, in the legend above the card).
// The defaults are the PG-DOMAIN behaviour.
const DEFAULTS = {hrefs: {country: countryHref, indicator: indicatorPageHref}, carry: false, orientation: false};
const countryLink = (html, opts, row) =>
  opts.carry
    ? html`<a href="${opts.hrefs.country(row.entityId)}" data-link="country" data-carry>${row.name}</a>`
    : html`<a href="${opts.hrefs.country(row.entityId)}" data-link="country">${row.name}</a>`;
const indicatorLink = (html, opts, c) =>
  opts.carry
    ? html`<a class="mm-hm-open" href="${opts.hrefs.indicator(c.indicatorId)}" data-link="indicator" data-carry aria-label="${HEATMAP_INDICATOR_LINK_LABEL(c.name)}">${HEATMAP_INDICATOR_LINK}</a>`
    : html`<a class="mm-hm-open" href="${opts.hrefs.indicator(c.indicatorId)}" data-link="indicator" aria-label="${HEATMAP_INDICATOR_LINK_LABEL(c.name)}">${HEATMAP_INDICATOR_LINK}</a>`;

function bodyRow(html, model, row, opts = DEFAULTS) {
  return html`<tr data-entity="${row.entityId}" data-status="${row.summary.status}"><th scope="row" class="mm-hm-country">${row.summary.hasCountryPage ? countryLink(html, opts, row) : row.name}</th>${model.informational ? [] : domainFigureCells(html, row)}${row.cells.map((e, k) => indicatorCell(html, row, e, model.columns[k]))}</tr>`;
}

function headCells(html, model, ids, sortState, opts = DEFAULTS) {
  const aria = (key) => (sortState.key === key ? (sortState.dir === "asc" ? "ascending" : "descending") : "none");
  const sortable = !model.informational;
  const head = (key, content) => (sortable || key === "name" ? html`<button type="button" class="mm-sort" data-sort="${key}">${content}</button>` : content);
  const country = html`<th scope="col" class="mm-hm-country" aria-sort="${aria("name")}">${head("name", COUNTRY_HEADER)}${model.informational ? html` <span class="mm-hm-note">${INFORMATIONAL_NOTICE}</span>` : ""}</th>`;
  // One template per header cell (see domainFigureCells).
  const figure = model.informational
    ? []
    : [
        opts.orientation
          ? html`<th scope="col" class="mm-hm-mean" aria-sort="${aria("mean")}" aria-describedby="${ids.orient}" title="${ORIENTATION_NOTE}">${head("mean", model.label)}<span id="${ids.orient}" class="mm-visually-hidden">${ORIENTATION_NOTE}</span></th>`
          : html`<th scope="col" class="mm-hm-mean" aria-sort="${aria("mean")}">${head("mean", model.label)}</th>`,
        html`<th scope="col" class="mm-hm-n">${COVERAGE_HEADER}</th>`,
        html`<th scope="col" class="mm-hm-pos">${POSITION_HEADER}</th>`
      ];
  const indicators = model.columns.map(
    (c) => html`<th scope="col" class="mm-hm-ind" data-indicator="${c.indicatorId}" aria-sort="${model.informational ? "none" : aria(c.indicatorId)}" title="${c.name}${c.unit ? ` (${c.unit})` : ""}">${head(c.indicatorId, html`<span class="mm-hm-name">${c.name}</span>`)}${c.unit ? html`<span class="mm-hm-unit">${c.unit}</span>` : ""}${c.direction ? html`<span class="mm-hm-dir" data-direction="${c.direction.key}">${c.direction.text}</span>` : ""}${indicatorLink(html, opts, c)}</th>`
  );
  return [country, ...figure, ...indicators];
}

const captionOf = (model) => (model.informational ? DRAFT_HEATMAP_CAPTION_INFO(model.name) : DRAFT_HEATMAP_CAPTION(model.name, model.label));

// The static table (also what the unit tests read). `sortState`: {key, dir}; the default is alphabetical by country name.
export function heatmapTable(html, model, {idPrefix = "domain-heatmap", sortState = {key: "name", dir: "asc"}, ...rest} = {}) {
  const opts = {...DEFAULTS, ...rest};
  const ids = {orient: `${idPrefix}-orientation`};
  const countries = sortRows(model, sortState);
  const aggregates = model.rows.filter((r) => r.aggregate);
  const span = [COUNTRY_HEADER, ...(model.informational ? [] : [1, 2, 3]), ...model.columns].length; // columns of the table
  return html`<table class="mm-heatmap-table" id="${idPrefix}" data-informational="${model.informational ? "true" : "false"}"><caption>${captionOf(model)}</caption><thead><tr>${headCells(html, model, ids, sortState, opts)}</tr></thead><tbody data-group="countries">${countries.map((r) => bodyRow(html, model, r, opts))}</tbody>${
    aggregates.length === 0 ? "" : html`<tbody data-group="aggregates" class="mm-hm-aggregates"><tr><th scope="rowgroup" colspan="${span}">${AGGREGATE_NOT_RANKED}</th></tr>${aggregates.map((r) => bodyRow(html, model, r, opts))}</tbody>`
  }</table>`;
}

// Facts of one cell, from its stored fields (T112). The same facts are columns of the detail table.
export function factsView(html, row, col, entry) {
  const c = entry.cell;
  const release = typeof c.releaseAt === "string" ? c.releaseAt.slice(0, 10) : null;
  const items = [
    [FACT.value, c.valueText === null ? NA : `${c.valueText}${c.unit ? ` ${c.unit}` : ""}`],
    [FACT.refPeriod, shown(c.refPeriod)],
    [FACT.refOffset, shown(c.refOffsetDays)],
    [FACT.release, shown(release)],
    [FACT.age, shown(c.ageDays)],
    [FACT.limit, shown(c.staleLimitDays)],
    [FACT.flags, c.flags.length === 0 ? NA : c.flags.join(", ")]
  ];
  return html`<p class="mm-facts-title">${row.name}, ${col.name}</p><dl>${items.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

// The figure: scroll hint, scroll container with the table, and the facts panel. In a browser (html returns a DOM node) it
// also wires sorting and the facts; with a string stand-in it is plain markup.
export function heatmapFigure(html, model, {idPrefix = "domain-heatmap", ...rest} = {}) {
  const factsId = `${idPrefix}-facts`;
  const root = html`<div class="mm-heatmap" data-id="${idPrefix}"><p class="mm-scroll-hint">${DRAFT_SCROLL_HINT}</p><div class="mm-heatmap-scroll" tabindex="0" role="region" aria-label="${captionOf(model)}">${heatmapTable(html, model, {idPrefix, ...rest})}</div><div class="mm-facts" id="${factsId}" aria-hidden="true" data-active="false"></div></div>`;
  if (typeof root?.addEventListener === "function") wire(html, root, model, idPrefix, factsId);
  return root;
}

function wire(html, root, model, idPrefix, factsId) {
  const panel = root.querySelector(`#${factsId}`);
  const lookup = new Map();
  for (const r of model.rows) r.cells.forEach((e, k) => e !== null && lookup.set(`${r.entityId}|${e.cell.indicatorId}`, {row: r, col: model.columns[k], entry: e}));
  const hide = () => panel.setAttribute("data-active", "false");
  const show = (target) => {
    const td = target.closest?.("td[data-indicator]");
    const tr = td?.closest("tr[data-entity]");
    const hit = td && tr ? lookup.get(`${tr.getAttribute("data-entity")}|${td.getAttribute("data-indicator")}`) : undefined;
    if (!hit || td.getAttribute("data-state") === "na" || td.getAttribute("data-state") === "not_published") return hide();
    panel.replaceChildren(factsView(html, hit.row, hit.col, hit.entry));
    panel.setAttribute("data-active", "true");
  };
  root.addEventListener("focusin", (e) => show(e.target));
  root.addEventListener("focusout", hide);
  root.addEventListener("mouseover", (e) => show(e.target));
  root.addEventListener("mouseout", hide);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide(); // dismiss without moving focus (WCAG 1.4.13); no trap
  });

  let sortState = {key: "name", dir: "asc"};
  const table = root.querySelector(`#${idPrefix}`);
  const tbody = table.querySelector('tbody[data-group="countries"]');
  const rowEls = new Map([...tbody.children].map((tr) => [tr.getAttribute("data-entity"), tr]));
  table.querySelector("thead").addEventListener("click", (e) => {
    const b = e.target.closest?.("button[data-sort]");
    if (!b) return;
    sortState = nextSort(sortState, b.getAttribute("data-sort"));
    tbody.append(...sortRows(model, sortState).map((r) => rowEls.get(r.entityId)));
    for (const th of table.querySelectorAll("thead th[aria-sort]")) {
      const key = th.querySelector("button[data-sort]")?.getAttribute("data-sort");
      th.setAttribute("aria-sort", key === sortState.key ? (sortState.dir === "asc" ? "ascending" : "descending") : "none");
    }
  });
}
