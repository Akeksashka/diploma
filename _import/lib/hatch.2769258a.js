// V21 (A1.1, AC-V2-48): the SVG pattern that fills a BLANK cell of C4 (a cell with no stored value: neither white nor zero). Added to the svg that Plot returns, because a Plot
// has no built-in pattern fill (V1 finding: with a legend or caption Plot returns a figure whose first child is the svg). This module is for blank cells only; it never takes a row state.
import {token} from "./tokens.0779967f.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// The fill reference of a blank cell for the pattern `id`.
export const blankFill = (id) => `url(#${id})`;

// Prepends <defs><pattern id> to the svg of `chart`; returns the chart. No-op outside a browser (unit tests give a string stand-in).
export function addBlankPattern(chart, id) {
  if (typeof document === "undefined" || !chart || typeof chart.querySelector !== "function") return chart;
  const svg = chart.tagName?.toLowerCase() === "svg" ? chart : chart.querySelector("svg");
  if (!svg || svg.querySelector(`#${id}`)) return chart;
  const defs = document.createElementNS(SVG_NS, "defs");
  const pattern = document.createElementNS(SVG_NS, "pattern");
  pattern.setAttribute("id", id);
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("width", "6");
  pattern.setAttribute("height", "6");
  pattern.setAttribute("patternTransform", "rotate(45)");
  const ground = document.createElementNS(SVG_NS, "rect");
  ground.setAttribute("width", "6");
  ground.setAttribute("height", "6");
  ground.setAttribute("fill", token("--mm-bg"));
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", "0");
  line.setAttribute("y1", "0");
  line.setAttribute("x2", "0");
  line.setAttribute("y2", "6");
  line.setAttribute("stroke", token("--mm-text-muted"));
  line.setAttribute("stroke-width", "1.5");
  pattern.append(ground, line);
  defs.append(pattern);
  svg.prepend(defs);
  return chart;
}
