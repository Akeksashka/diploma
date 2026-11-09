// Redesign R16 (spec 5.6 items 1-5): the "Read a value" form control placed after a chart, outside its role="img" figure. `html` (htl)
// is passed in; imports local modules only. Display only: the text of a choice is given by the caller (tip.js); nothing is computed here.
import {COUNTRY_HEADER, DRAFT_FACT_LABELS, POINT_READER_LEGEND} from "./copy.js";

// entries: [{id, name, texts: [string]}] one per country; `texts` are the output texts of its plotted points, in date order, with
// `periods` [string] the period labels (aria-valuetext). With `range: false` (PG-INDICATOR) there is only the country select, whose
// first option may be `none` ({label}): choosing it reads nothing. onChange({entry, index} | null) is called on every change;
// onActive(boolean) when focus enters or leaves the fieldset.
const lastIndex = (entry) => (entry && entry.texts.length > 0 ? entry.texts.length - 1 : 0); // index of the last plotted point

export function pointReader(html, {id, entries, range = true, none = null, value = null, onChange = () => {}, onActive = () => {}}) {
  const options = [...(none ? [html`<option value="">${none}</option>`] : []), ...entries.map((e) => html`<option value="${e.id}">${e.name}</option>`)];
  const select = html`<select id="${id}-country">${options}</select>`;
  const slider = range ? html`<input type="range" id="${id}-period" min="0" max="0" step="1" value="0">` : null;
  const output = html`<output id="${id}-output" aria-live="polite" for="${id}-country"></output>`;
  const root = html`<fieldset class="mm-point-reader" id="${id}"><legend>${POINT_READER_LEGEND}</legend><label>${COUNTRY_HEADER} ${select}</label>${range ? html` <label>${DRAFT_FACT_LABELS.refPeriod} ${slider}</label>` : ""} ${output}</fieldset>`;
  const current = () => entries.find((e) => e.id === select.value) ?? null;
  // WCAG 1.4.13: Escape hid the static highlight tip (class on the figures); a new choice or re-entering focus brings it back.
  const restoreStatic = () => {
    for (const f of root.ownerDocument.querySelectorAll(".mm-figure.mm-static-hidden")) f.classList.remove("mm-static-hidden");
  };
  const show = (index) => {
    restoreStatic();
    const entry = current();
    if (entry === null) {
      output.textContent = "";
      onChange(null);
      return;
    }
    if (range) {
      slider.max = String(lastIndex(entry));
      slider.value = String(index);
      slider.setAttribute("aria-valuetext", entry.periods[index]);
    }
    output.textContent = entry.texts[index];
    onChange({entry, index});
    restoreStatic(); // onChange may redraw the figure
  };
  select.addEventListener("change", () => show(range ? lastIndex(current()) : 0)); // default: the latest plotted point
  if (range) slider.addEventListener("input", () => show(Number(slider.value)));
  root.addEventListener("focusin", () => {
    restoreStatic();
    onActive(true);
  });
  root.addEventListener("focusout", (e) => {
    if (!root.contains(e.relatedTarget)) onActive(false);
  });
  if (value !== null || !none) {
    select.value = value ?? entries[0]?.id ?? "";
    show(range ? lastIndex(current()) : 0);
  }
  return {el: root, select, slider, output, show};
}

// WCAG 1.4.13 (dismissible): Escape hides the pointer tips (and the static highlight tip of the reader, class `mm-static-hidden`) of every chart figure until the next pointer move over a figure.
// Installed once per document; the CSS hides `g[aria-label="tip"]` (not the static one) under `.mm-tip-hidden`.
let dismissInstalled = false;
export function installTipDismiss(doc = typeof document === "undefined" ? null : document) {
  if (doc === null || dismissInstalled) return;
  dismissInstalled = true;
  const figures = () => doc.querySelectorAll(".mm-figure");
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape") for (const f of figures()) f.classList.add("mm-tip-hidden", "mm-static-hidden");
  });
  doc.addEventListener("pointermove", (e) => {
    const fig = e.target?.closest?.(".mm-figure");
    if (fig) fig.classList.remove("mm-tip-hidden");
  });
}
