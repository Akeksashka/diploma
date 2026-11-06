// Reads a --mm-* colour token from the page at runtime so chart marks use the stylesheet palette in both themes.
// Outside a browser (unit tests) it returns "currentColor".
export function token(name) {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return "currentColor";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "currentColor";
}
