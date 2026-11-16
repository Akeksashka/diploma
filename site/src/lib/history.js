// Redesign R8 (spec C-CTRY-3, AC-RD-14): the lazy "Show history" of one value row of PG-COUNTRY. Nothing is fetched until the
// button is activated; then exactly one `series/<indicator_id>.parquet` (the manifest entry of that indicator), read by the same
// loader as the explorer (explorer.js loadSeries, unchanged). The Parquet reader is the runtime's own lazy import behind
// `attachment.parquet()`, so it is first loaded by that call and not before. The chart shows the page's entity only, with the
// unit on the axis. A failure shows an inline error block in the row and leaves the rest of the page intact. Compute nothing:
// rows are filtered by entity and sorted by date, values are the stored `value` column printed as stored.
import {DRAFT_HISTORY_CONSEQUENCE, DRAFT_HISTORY_FIGURE_LABEL, DRAFT_HISTORY_HIDE, DRAFT_HISTORY_REGION, DRAFT_HISTORY_SHOW, DRAFT_HISTORY_TABLE_TITLE, DRAFT_NA_DEFINED_SENTENCE, DRAFT_REGIONS, DRAFT_UNIT_MISSING_SENTENCE} from "./copy.js";
import {isoDate, loadSeries, seriesFileEntries, valueText} from "./explorer.js";
import {chartFigure, latestPoints, viewAsTable} from "./figure.js";
import {errorBlock, busyBlock, setBusy} from "./state-blocks.js";
import {token} from "./tokens.js";
import {valueWithUnit} from "./tip.js";
import {seriesUnit} from "./units.js";
import {codeText, unitLabelText, xTickFormat} from "./code-text.js";

// entries: manifest series files; files: {indicator_id: FileAttachment} registered in the page (each one lazy). null disables the feature.
export function historySource(manifest, files) {
  return {entries: seriesFileEntries(manifest), files};
}

// A button is offered only for an indicator whose series file is listed in the manifest and registered on the page.
export const hasHistory = (source, indicatorId) => Boolean(source && source.entries.has(indicatorId) && source.files?.[indicatorId]);

export const historyKey = (domainId, indicatorId) => `${domainId}-${indicatorId}`;
export const historyPanelId = (domainId, indicatorId) => `history-${historyKey(domainId, indicatorId)}`;

export function historyButton(html, source, domainId, row) {
  if (!hasHistory(source, row.indicatorId)) return "";
  return html`<button type="button" class="mm-history-btn" data-history="${historyKey(domainId, row.indicatorId)}" aria-expanded="false" aria-controls="${historyPanelId(domainId, row.indicatorId)}">${DRAFT_HISTORY_SHOW}</button>`;
}

// The (initially hidden) panel under the row; the page's status region for this history.
export function historyPanel(html, domainId, row) {
  return html`<div class="mm-history" id="${historyPanelId(domainId, row.indicatorId)}" data-state="idle" hidden></div>`;
}

// Pure: the points of the page's entity (and of the row's series when the file holds it), by date.
export function historyPoints(rows, entityId, seriesId = null) {
  const own = rows.filter((r) => r.entity === entityId);
  const narrowed = typeof seriesId === "number" && own.some((r) => r.seriesId === seriesId) ? own.filter((r) => r.seriesId === seriesId) : own;
  return [...narrowed].sort((a, b) => (a.end < b.end ? -1 : 1)).map((r) => ({ms: r.end, date: new Date(r.end), value: r.value, status: r.status}));
}

export function historyModel({rows, row, entityId, entityName}) {
  const unit = row.unit ?? seriesUnit(row.seriesMeta);
  const points = historyPoints(rows, entityId, typeof row.cell?.series_id === "number" ? row.cell.series_id : row.seriesId);
  return {indicatorId: row.indicatorId, name: row.name, entityId, entityName, unit, points: points.map((p) => ({...p, text: p.value === null ? null : valueWithUnit(valueText(p.value), unit)}))};
}

export function historyChart(Plot, m) {
  const ink = token("--mm-text");
  const bg = token("--mm-bg");
  const live = m.points.filter((p) => p.value !== null);
  return Plot.plot({
    style: {fontSize: "14px", background: "transparent"},
    width: 720,
    marginLeft: 64,
    marginRight: 24,
    marginBottom: 36,
    x: {type: "utc", label: null, ...xTickFormat()},
    y: {grid: true, label: m.unit || DRAFT_UNIT_MISSING_SENTENCE},
    marks: [
      Plot.line(m.points, {x: "date", y: "value", stroke: ink, strokeWidth: 2}),
      Plot.dot(live, {x: "date", y: "value", r: 3, stroke: ink, fill: bg, strokeWidth: 1.5, title: (p) => `${m.name}: ${p.text}, ${isoDate(p.ms)}`})
    ]
  });
}

export function historyBlock(html, Plot, m, id) {
  const live = m.points.filter((p) => p.value !== null);
  if (live.length === 0) return html`<p class="mm-state mm-state-empty" data-state="empty"><span class="mm-code">n/a</span> <span class="mm-sentence">${DRAFT_NA_DEFINED_SENTENCE}</span></p>`;
  const fig = chartFigure(html, {id: `${id}-figure`, label: DRAFT_HISTORY_FIGURE_LABEL(m.name, m.entityName, m.unit || DRAFT_UNIT_MISSING_SENTENCE), chart: historyChart(Plot, m)});
  const rows = latestPoints(m.points).map((p) => ({entity: m.entityId, name: m.entityName, date: isoDate(p.ms), valueText: p.text, status: p.status}));
  return html`<div class="mm-history-body">${fig}${viewAsTable(html, {id: `${id}-view`, title: DRAFT_HISTORY_TABLE_TITLE(m.name, m.entityName), rows, valueUnit: m.unit || null})}</div>`;
}

// Wires every history button under `root`. rowsByKey: Map(historyKey -> countryModel row). One fetch per button at most; a
// failed load is shown inline and the next activation tries again; a loaded panel is only hidden and shown again.
export function attachHistory(root, {html, Plot, source, entityId, entityName, rowsByKey}) {
  const loading = new Set();
  root.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("button[data-history]");
    if (!btn || !root.contains(btn)) return;
    const key = btn.getAttribute("data-history");
    const row = rowsByKey.get(key);
    const panel = root.querySelector(`[id="${btn.getAttribute("aria-controls")}"]`);
    if (!row || !panel || loading.has(key)) return;
    const opening = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", opening ? "true" : "false");
    btn.textContent = opening ? DRAFT_HISTORY_HIDE : DRAFT_HISTORY_SHOW;
    panel.hidden = !opening;
    if (!opening || panel.getAttribute("data-state") === "loaded") return;
    loading.add(key);
    const busy = busyBlock(html, DRAFT_REGIONS.loadingSeries, {id: `${panel.id}-loading`});
    panel.replaceChildren(busy);
    panel.setAttribute("data-state", "loading");
    let node;
    let state = "loaded";
    try {
      const res = await loadSeries(source.entries.get(row.indicatorId), source.files[row.indicatorId]);
      if (res.error) throw new Error("series file");
      node = historyBlock(html, Plot, historyModel({rows: res.rows, row, entityId, entityName}), panel.id);
    } catch {
      state = "error";
      node = errorBlock(html, {region: DRAFT_HISTORY_REGION, kind: "missing", consequence: DRAFT_HISTORY_CONSEQUENCE, id: `${panel.id}-error`});
    }
    setBusy(busy, false);
    panel.replaceChildren(node);
    panel.setAttribute("data-state", state);
    loading.delete(key);
  });
}
