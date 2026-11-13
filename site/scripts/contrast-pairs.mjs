// The ONE declared pair table for AC-UX-1 (ADR-025 decisions 1 and 13; brief section 3 and 7).
// Every colour token in site/src/style.css must appear in at least one pair, in both themes.
// Limits: text and bin ink 4.5 (WCAG 1.4.3); borders, glyphs, focus, chart colours 3 (WCAG 1.4.11).
const TEXT = 4.5;
const UI = 3;

const t = (fg, bg, min, kind) => ({fg, bg, min, kind});
const text = (fg, bg) => t(fg, bg, TEXT, "text");
const ui = (fg, bg) => t(fg, bg, UI, "ui");
// Light theme only (spec A2.5: the dark pairs of new tokens are not asserted; the existing dark block is untouched).
const lightOnly = (pair) => ({...pair, lightOnly: true});

// Token name prefixes that hold lengths or font stacks, not colours.
export const NON_COLOUR_PREFIXES = ["--mm-space-", "--mm-radius", "--mm-font", "--mm-fs-", "--mm-tile-"];

export const PAIRS = [
  text("--mm-text", "--mm-bg"),
  text("--mm-text", "--mm-surface"),
  text("--mm-text-muted", "--mm-bg"),
  text("--mm-text-muted", "--mm-surface"),
  ui("--mm-border", "--mm-bg"),
  ui("--mm-border", "--mm-surface"),
  ...[1, 2, 3, 4, 5].map((n) => text(`--mm-pct-${n}-ink`, `--mm-pct-${n}`)),
  ui("--mm-div-neg", "--mm-surface"),
  ui("--mm-div-pos", "--mm-surface"),
  ui("--mm-div-mid", "--mm-surface"),
  // C4 and C6 value ramp (ADR-026): the dark end and the two diverging ends stand out from the page and the card; cell text (--mm-text, with a page-colour halo) is read on the light end.
  lightOnly(ui("--mm-val-seq-2", "--mm-bg")),
  lightOnly(ui("--mm-val-seq-2", "--mm-card")),
  lightOnly(ui("--mm-val-neg", "--mm-bg")),
  lightOnly(ui("--mm-val-neg", "--mm-card")),
  lightOnly(ui("--mm-val-pos", "--mm-bg")),
  lightOnly(ui("--mm-val-pos", "--mm-card")),
  lightOnly(text("--mm-text", "--mm-val-seq-1")),
  ui("--mm-alert-watch", "--mm-surface"),
  ui("--mm-alert-alert", "--mm-surface"),
  text("--mm-alert-watch-ink", "--mm-alert-watch"),
  text("--mm-alert-alert-ink", "--mm-alert-alert"),
  text("--mm-warn-ink", "--mm-warn-bg"),
  ui("--mm-warn-border", "--mm-warn-bg"),
  ui("--mm-warn-border", "--mm-bg"),
  text("--mm-text", "--mm-warn-tint"),
  // T104 focus ring: 2 px outline with 2 px offset (style.css :focus-visible), so the ring sits on the page surface, or on the
  // surface behind the skip link, never directly on the control fill.
  ui("--mm-focus", "--mm-bg"),
  ui("--mm-focus", "--mm-surface"),
  // T121 explorer series hues (lines and markers, 3:1 on the page and on the surface the chart sits on).
  ...[1, 2, 3, 4, 5].flatMap((n) => [ui(`--mm-series-${n}`, "--mm-bg"), ui(`--mm-series-${n}`, "--mm-surface")]),
  // L2 layout surface (amendment section 3): body text on canvas and card, control borders and focus on both, charts sit on the card.
  text("--mm-text", "--mm-canvas"),
  text("--mm-text", "--mm-card"),
  text("--mm-text-muted", "--mm-canvas"),
  text("--mm-text-muted", "--mm-card"),
  text("--mm-band-ink", "--mm-band-bg"),
  ui("--mm-border", "--mm-canvas"),
  ui("--mm-border", "--mm-card"),
  ui("--mm-focus", "--mm-canvas"),
  ui("--mm-focus", "--mm-card"),
  ui("--mm-focus", "--mm-band-bg"),
  ...[1, 2, 3, 4, 5].map((n) => ui(`--mm-series-${n}`, "--mm-card")),
  // The card edge is held to the 3:1 non-text limit on the card and on the canvas (the tests allow only 4.5 and 3); the fill difference is not relied on.
  ui("--mm-card-border", "--mm-card"),
  ui("--mm-card-border", "--mm-canvas")
];
