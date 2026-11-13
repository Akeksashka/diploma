// V4 (ADR-036 Amendment 1, ADR-037 A1.4; AC-V2-80, 81, 88, 89, 90): the hidden-rows disclosure of a v2 chart card. Renders the list of ONE hidden
// array (the `hidden` of filter-model.js splitByCoverage); the counts come from countHiddenRowsByReason on that same array. Stored fields only.
// Nothing is rendered at N = 0 (I7). The persistent role="status" wrapper (I5) is hiddenRowsRegion; it is empty at N = 0.
import {DRAFT_HIDDEN_LIST_ITEM, DRAFT_HIDDEN_REASON_LABELS, DRAFT_HIDDEN_SUMMARY, DRAFT_NOT_STATED} from "./copy.js";
import {HIDDEN_REASONS, countHiddenRowsByReason} from "./filter-model.js";
import {periodLabel} from "./period.js";
import {sortRows} from "./sort.js";

const text = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);

// accessors (all optional): label(row), id(row), period(row), sentence(row), href(row). Defaults read the stored fields of a view row or an export row.
export function hiddenRowsModel(hidden = [], {label, id, period, sentence} = {}) {
  const counts = countHiddenRowsByReason(hidden);
  const items = hidden.map(({row, reason}) => {
    const r = HIDDEN_REASONS.includes(reason) ? reason : "other";
    const key = label ? label(row) : (row?.name ?? row?.label ?? row?.entityId ?? row?.entity_id ?? row?.indicatorId ?? row?.indicator_id);
    const stored = period ? period(row) : (row?.periodText ?? periodLabel(row?.ref_period_end ?? row?.refPeriodEnd, row?.frequency));
    const reasonSentence = sentence ? sentence(row) : (row?.reasonSentence ?? row?.state?.sentence);
    return {
      id: String(id ? id(row) : (row?.entityId ?? row?.entity_id ?? row?.indicatorId ?? row?.indicator_id ?? "")),
      label: text(key) ?? DRAFT_NOT_STATED,
      reason: r,
      reasonLabel: DRAFT_HIDDEN_REASON_LABELS[r],
      period: text(stored) ?? DRAFT_NOT_STATED,
      sentence: text(reasonSentence) ?? DRAFT_NOT_STATED,
      order: HIDDEN_REASONS.indexOf(r),
      row
    };
  });
  // Order: reason category in precedence order, then label A to Z (ties by id): sortRows orders by the stored field `order`, then by name.
  const ordered = sortRows(sortRows(items, "id", {nameKey: "id"}), "order", {nameKey: "label"});
  return {counts, summary: DRAFT_HIDDEN_SUMMARY(counts), items: ordered};
}

// The `<details class="mm-hidden-rows">` or "" at N = 0.
export function hiddenRowsDisclosure(html, hidden, opts = {}) {
  const m = hiddenRowsModel(hidden, opts);
  if (m.counts.total === 0) return "";
  const href = opts.href;
  return html`<details class="mm-hidden-rows"><summary>${m.summary}</summary><ul>${m.items.map((i) => {
    const line = DRAFT_HIDDEN_LIST_ITEM(i.label, i.reasonLabel, i.period, i.sentence);
    const url = href ? href(i.row) : null;
    return html`<li data-reason="${i.reason}" data-id="${i.id}">${url ? html`<a href="${url}" data-carry>${line}</a>` : line}</li>`;
  })}</ul></details>`;
}

// The persistent live region around the disclosure (ADR-036 I5): present always, content only when N > 0.
export function hiddenRowsRegion(html, hidden, opts = {}) {
  return html`<div role="status" class="mm-hidden-slot">${hiddenRowsDisclosure(html, hidden, opts)}</div>`;
}
