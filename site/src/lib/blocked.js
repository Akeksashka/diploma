// V18 to V21 (spec 6.2 as amended by A1.6; AC-V2-31, 41, 71, 76): the shared markup of a blocked chart and of the notes the compatibility check reports. Input is the result of
// compat.js checkCompatible (stored field names and values); this module only lays it out. Nothing is converted or inferred.
import {DRAFT_BLOCKED_FIELD_LABELS, DRAFT_BLOCKED_MESSAGE, DRAFT_COMPAT_SKIPPED, DRAFT_MARKED_SEASONAL} from "./copy.js";

// The stored-field message of a blocked selection, with the differing stored values of each field in a list (A to Z).
export function blockedState(html, compat) {
  const labels = (compat?.blocked ?? []).map((b) => DRAFT_BLOCKED_FIELD_LABELS[b.field] ?? b.field);
  const values = (compat?.blocked ?? []).map((b) => html`<li data-field="${b.field}">${DRAFT_BLOCKED_FIELD_LABELS[b.field] ?? b.field}: ${b.values.join(", ")}</li>`);
  return html`<p class="mm-state mm-state-blocked" data-state="blocked">${DRAFT_BLOCKED_MESSAGE(labels)}</p><ul class="mm-blocked-fields">${values}</ul>`;
}

// The notes of a drawn selection: a seasonal-adjustment mix (marked, never blocked; spec 6.6) and the fields absent from every series (skipped; A1.6).
export function compatNotes(html, compat) {
  const marked = (compat?.marked ?? []).length > 0 ? html`<p class="mm-note" data-field="seasonal-mix">${DRAFT_MARKED_SEASONAL}</p>` : "";
  const skipped = (compat?.skipped ?? []).length > 0 ? html`<p class="mm-note" data-field="compat-skipped">${DRAFT_COMPAT_SKIPPED(compat.skipped)}</p>` : "";
  return html`${marked}${skipped}`;
}
