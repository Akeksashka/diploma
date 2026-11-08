// Redesign R16 (amendment AC-RD-30a, 30c): the one text source of the tip, the "Read a value" output and the table value cell.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {chartFigure} from "../src/lib/figure.js";
import {html} from "./support/html-standin.mjs";
import {installTipDismiss} from "../src/lib/point-reader.js";
import {valueFigure} from "../src/lib/value-chart.js";
import {markedValue} from "../src/lib/series-meta.js";
import {pointValueText, readerText, seriesTipLines, tipText, valueTipLines, valueWithUnit} from "../src/lib/tip.js";
import {valueCell} from "../src/lib/country-view.js";
import {computeHits} from "./support/static-scan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const series = {name: "Germany", frequency: "M", unit: "%"};
const at = (status) => ({ms: Date.UTC(2026, 8, 30), text: "3.4", status, knownAt: Date.UTC(2026, 9, 15)});

test("OBS: country, period label, value with unit, known_at; no status line (AC-RD-30a)", () => {
  assert.deepEqual(seriesTipLines(at("OBS"), series), ["Germany", "2026-09", "3.4 %", "Known at 2026-10-15"]);
});

test("EST and PROV add a status line and the e mark", () => {
  assert.deepEqual(seriesTipLines(at("EST"), series), ["Germany", "2026-09", "3.4 e %", "estimate", "Known at 2026-10-15"]);
  assert.deepEqual(seriesTipLines(at("PROV"), series), ["Germany", "2026-09", "3.4 e %", "provisional", "Known at 2026-10-15"]);
});

test("a rebased value is shown with its index unit; quarterly period label", () => {
  const lines = seriesTipLines({...at("OBS"), text: "101.2"}, {name: "France", frequency: "Q", unit: "index, 2020-01 = 100"});
  assert.deepEqual(lines.slice(0, 3), ["France", "2026 Q3", "101.2 index, 2020-01 = 100"]);
});

test("a missing unit is a stated defect, never a bare value, never a throw (AC-RD-42)", () => {
  const stated = "This export holds no unit for this value.";
  for (const unit of [null, undefined, ""]) {
    assert.equal(seriesTipLines(at("OBS"), {...series, unit})[2], `3.4 ${stated}`); // AC-RD-30: the value is kept
    assert.equal(valueTipLines({label: "X", valueText: "1", unit, periodText: "2026"})[1], `1 ${stated}`);
  }
  assert.equal(valueWithUnit("1", null), `1 ${stated}`);
});

test("the tip, the reader output and the table value cell use the same value text", () => {
  assert.equal(pointValueText(at("OBS")), "3.4");
  assert.equal(pointValueText(at("EST")), "3.4 e");
  assert.equal(pointValueText(at("PROV")), "3.4 e");
  assert.equal(seriesTipLines(at("OBS"), series)[2], "3.4 %");
  assert.equal(seriesTipLines(at("PROV"), series)[2], "3.4 e %");
  const lines = seriesTipLines(at("EST"), series);
  assert.equal(tipText(lines), "Germany\n2026-09\n3.4 e %\nestimate\nKnown at 2026-10-15");
  assert.equal(readerText(lines), "Germany; 2026-09; 3.4 e %; estimate; Known at 2026-10-15");
});

// The visible text of a rendered cell: tags removed, visually hidden spans dropped, whitespace collapsed.
const cellText = (out) => String(out).replace(/<span class="mm-visually-hidden">.*?<\/span>/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

test("PG-INDICATOR: the table value cell and the tip value line have the same text, estimate mark in the same place", () => {
  for (const estimate of [false, true]) {
    const row = {label: "Germany", valueText: "3.4", unit: "%", periodText: "2026-09", estimate, inherited: false};
    assert.equal(cellText(valueCell(html, row)), valueTipLines(row)[1]);
  }
  assert.equal(cellText(valueCell(html, {valueText: "3.4", unit: "%", estimate: true})), "3.4 e %");
  assert.equal(cellText(valueCell(html, {valueText: "3.4", unit: "%", estimate: false})), "3.4 %");
});

test("AC-RD-30c: tip.js and point-reader.js compute no number", () => {
  for (const f of ["tip.js", "point-reader.js"]) {
    // Plain index arithmetic (a list length minus one) is the only thing allowed, by line; value arithmetic is not.
    const hits = computeHits(readFileSync(join(root, "src", "lib", f), "utf8")).filter((h) => !(f === "point-reader.js" && h.rule === "subtraction" && h.text.includes("entry.texts.length - 1")));
    assert.deepEqual(hits, [], `${f}: ${JSON.stringify(hits)}`);
  }
  assert.ok(computeHits("const d = a.value - b.value;").length > 0, "the scan must catch a seeded subtraction");
});

test("AC-RD-30c builder check only: the figure builders emit no focusable element into their string output (stub Plot; the real check is the smoke tabindex count in the browser)", () => {
  const figure = (out) => String(out).match(/<figure[\s\S]*?<\/figure>/)?.[0] ?? "";
  const fakePlot = {plot: () => "<svg></svg>", barX: () => ({}), ruleX: () => ({}), text: () => ({}), tip: () => ({}), pointerY: (o) => o};
  const rows = [{entityId: "A", name: "A", label: "A", value: 1, valueText: "1", periodText: "2026", unit: "u", bin: null, estimate: false, inherited: false, focus: true}];
  for (const out of [valueFigure(html, fakePlot, rows, {name: "N", unit: "u", tipRow: "A"}), chartFigure(html, {id: "f", label: "l", chart: "<svg></svg>"})]) {
    const fig = figure(out);
    assert.ok(fig.startsWith("<figure"), "the figure was built");
    assert.doesNotMatch(fig, /tabindex|<a[\s>]|<button|<input|<select|<details/i);
  }
});

test("WCAG 1.4.13: Escape hides the pointer tip and the static reader tip; a pointer move restores the pointer tip; the CSS keeps the output", () => {
  const mkFigure = () => {
    const set = new Set();
    return {classList: {add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)), has: (c) => set.has(c)}, closest: (sel) => (sel === ".mm-figure" ? fig : null)};
  };
  const fig = mkFigure();
  const handlers = {};
  installTipDismiss({addEventListener: (type, fn) => { handlers[type] = fn; }, querySelectorAll: () => [fig]});
  handlers.keydown({key: "a"});
  assert.ok(!fig.classList.has("mm-static-hidden"), "other keys do nothing");
  handlers.keydown({key: "Escape"});
  assert.ok(fig.classList.has("mm-static-hidden") && fig.classList.has("mm-tip-hidden"));
  handlers.pointermove({target: fig});
  assert.ok(!fig.classList.has("mm-tip-hidden"), "the pointer tip returns on pointer move");
  const css = readFileSync(join(root, "src", "style.css"), "utf8");
  assert.match(css, /\.mm-figure\.mm-static-hidden g\.mm-static-tip \{ display: none; \}/);
  assert.doesNotMatch(css, /mm-static-hidden[^{]*output/, "the reader output is never hidden");
  const reader = readFileSync(join(root, "src", "lib", "point-reader.js"), "utf8");
  assert.match(reader, /restoreStatic\(\);\s*onActive\(true\)/, "re-entering focus restores the static tip");
});
