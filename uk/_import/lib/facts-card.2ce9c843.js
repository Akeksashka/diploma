// L12 (layout amendment 4.1, "facts card", span 4): the stored facts of the selected indicator, printed as stored and nothing else: `unit_label`,
// the frequency set, the direction label (ADR-026 decision 4), the stored reference-period line (RD C-IND-2) and `notes[]` verbatim. The card
// adds no prose (RD 1.6). Its title is the indicator name (visually hidden: the card sits beside the comparison card of the same name).
import {DRAFT_FACT_LABELS, DRAFT_FREQUENCY_NAMES, DRAFT_INDICATOR_FACT_LABELS as L} from "./copy.11b4a285.js";
import {referenceLineText} from "./indicator-view.d0c3dcee.js";

const present = (v) => typeof v === "string" && v.trim() !== "";

// header: indicatorHeader() result (name, unit, frequencies, directionText, notes). referenceLine: indicatorModel().referenceLine or null
// (the scorecard has not loaded). Returns [{key, label, text} | {key, label, items}] in display order; absent facts are left out.
export function factRows(header, referenceLine = null) {
  const rows = [];
  if (present(header.unit)) rows.push({key: "unit", label: L.unit, text: header.unit});
  if (header.frequencies.some(Boolean)) rows.push({key: "frequency", label: L.frequency, text: header.frequencies.map((f) => DRAFT_FREQUENCY_NAMES[f] ?? f).join(", ")});
  if (present(header.directionText)) rows.push({key: "direction", label: L.direction, text: header.directionText});
  if (referenceLine) rows.push({key: "refPeriod", label: DRAFT_FACT_LABELS.refPeriod, text: referenceLineText(referenceLine)});
  if (header.notes.some(Boolean)) rows.push({key: "notes", label: L.notes, items: header.notes});
  return rows;
}

export function factsCard(html, header, referenceLine = null) {
  const rows = factRows(header, referenceLine);
  return html`<h3 class="mm-visually-hidden">${header.name}</h3><dl class="mm-facts">${rows.map((r) => html`<div class="mm-fact" data-fact="${r.key}"><dt>${r.label}</dt><dd>${r.items ? html`<ul class="mm-fact-notes">${r.items.map((n) => html`<li>${n}</li>`)}</ul>` : r.text}</dd></div>`)}</dl>`;
}
