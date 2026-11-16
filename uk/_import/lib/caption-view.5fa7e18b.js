// V12 to V14 (spec 1.5, 6.1; AC-V2-70): the markup of a chart card's caption block. Input is the result of caption.js buildCaption (stored fields and the
// "not stated" marker already resolved); this module only lays it out. Nothing is computed or inferred. `html` (htl) is passed in.
export function captionBlock(html, caption, {id = null} = {}) {
  const {fields = [], legend = []} = caption ?? {};
  return html`<div class="mm-caption" id="${id}"><dl>${fields.map(({key, label, value: text}) => html`<div data-field="${key}"><dt>${label}</dt><dd>${text}</dd></div>`)}</dl>${
    legend.length === 0 ? "" : html`<ul class="mm-caption-legend">${legend.map((l) => html`<li data-code="${l.code}"><span class="mm-code">${l.code}</span> ${l.text}</li>`)}</ul>`
  }</div>`;
}
