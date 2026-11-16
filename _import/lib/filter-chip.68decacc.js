// L8/L9 (layout amendment 2.5): shared chip behaviour for the Country and Period controls. A chip is <details><summary>. Escape closes an open chip
// and returns focus to its summary; a pointer press or focus outside closes it; there is no focus trap. `doc` is the Document (injected for tests).
export function wireChip(details, doc = details.ownerDocument) {
  const summary = details.querySelector("summary");
  const close = () => {
    details.open = false;
  };
  details.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !details.open) return;
    e.preventDefault();
    close();
    summary.focus();
  });
  const outside = (e) => {
    if (details.open && !details.contains(e.target)) close();
  };
  doc.addEventListener("pointerdown", outside);
  doc.addEventListener("focusin", outside);
  return () => {
    doc.removeEventListener("pointerdown", outside);
    doc.removeEventListener("focusin", outside);
  };
}
