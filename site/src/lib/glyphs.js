// Inline SVG glyphs, defined once per page as a sprite and referenced with <use> (brief section 5: "inline SVG, not Unicode
// characters, each aria-hidden next to a visible word"). Shapes use currentColor, so the colour comes from the stylesheet.
// `html` is htl's tag, passed in; this module has no imports.

export const GLYPH_NAMES = Object.freeze(["clock", "info", "ring", "triangle", "diamond", "crossed", "dash"]);

// Put once on the page, before any glyph. Zero size and aria-hidden: it is a definition, not content.
export function glyphSprite(html) {
  return html`<svg class="mm-sprite" aria-hidden="true" focusable="false" width="0" height="0"><defs>
<symbol id="mm-g-clock" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></symbol>
<symbol id="mm-g-info" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M8 7.2V11.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path><circle cx="8" cy="4.9" r="1" fill="currentColor"></circle></symbol>
<symbol id="mm-g-ring" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2"></circle></symbol>
<symbol id="mm-g-triangle" viewBox="0 0 16 16"><path d="M8 2.2L14.2 13.2H1.8Z" fill="currentColor"></path></symbol>
<symbol id="mm-g-diamond" viewBox="0 0 16 16"><path d="M8 1.5L14.5 8L8 14.5L1.5 8Z" fill="currentColor"></path></symbol>
<symbol id="mm-g-crossed" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"></rect><path d="M2 14L14 2" fill="none" stroke="currentColor" stroke-width="1.5"></path></symbol>
<symbol id="mm-g-dash" viewBox="0 0 16 16"><path d="M3 8H13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></symbol>
</defs></svg>`;
}

export function glyph(html, name) {
  if (!GLYPH_NAMES.includes(name)) throw new Error(`unknown glyph: ${name}`);
  return html`<svg class="mm-glyph" aria-hidden="true" focusable="false" viewBox="0 0 16 16"><use href="#mm-g-${name}"></use></svg>`;
}
