// T120: the shared figure wrapper, the generated aria-label and the "View as table" disclosure.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {LATEST_PERIODS, chartFigure, latestPoints, seriesFigureLabel, viewAsTable} from "../src/lib/figure.js";
import {html} from "./support/html-standin.mjs";
import {computeHits} from "./support/static-scan.mjs";

test("chartFigure is a figure with role img and the generated label, holding only the chart", () => {
  const out = chartFigure(html, {id: "f1", label: 'A "quoted" label', chart: html`<svg></svg>`}).s;
  assert.equal(out, '<figure class="mm-figure" id="f1" role="img" aria-label="A &quot;quoted&quot; label"><svg></svg></figure>');
});

test("the label names the indicator, each country, its range and its stored latest value", () => {
  const label = seriesFigureLabel({
    title: "Unemployment rate: Level",
    yLabel: "PCT (% of labour force)",
    series: [{name: "Germany", first: "2024-01-31", last: "2025-03-31", latestText: "24 % of labour force"}, {name: "France", first: "2024-01-31", last: "2025-02-28", latestText: "34 % of labour force"}]
  });
  for (const part of ["Unemployment rate: Level", "PCT (% of labour force)", "Germany, 2024-01-31 to 2025-03-31, latest stored value 24 % of labour force", "France, 2024-01-31 to 2025-02-28, latest stored value 34 % of labour force"]) assert.ok(label.includes(part), part);
  assert.ok(label.endsWith("The table under the chart lists the plotted points."));
});

test("latestPoints is a slice: the last 24 points that have a value, in date order, nothing computed", () => {
  const pts = Array.from({length: 30}, (_, i) => ({ms: i, value: i === 10 ? null : i}));
  const out = latestPoints(pts);
  assert.equal(LATEST_PERIODS, 24);
  assert.equal(out.length, 24);
  assert.deepEqual(out.map((p) => p.ms), pts.filter((p) => p.value !== null).slice(-24).map((p) => p.ms));
  assert.ok(out.every((p) => p.value !== null));
  assert.equal(latestPoints(pts.slice(0, 3)).length, 3);
});

test("viewAsTable: a details with the confirmed summary, caption, th scope, the rows given and an optional download link", () => {
  const rows = [{entity: "DEU", name: "Germany", date: "2025-03-31", valueText: "24", status: "EST"}, {entity: "FRA", name: "France", date: "2025-03-31", valueText: "34", status: null}];
  const out = viewAsTable(html, {id: "t", title: "Unemployment rate: Level", rows, href: "/_file/x.parquet", valueUnit: "u"}).s;
  assert.match(out, /<details class="mm-view-table" id="t"><summary>View as table<\/summary>/);
  assert.ok(!/<details[^>]* open/.test(out), "closed by default");
  assert.ok(out.includes("<caption>Unemployment rate: Level: plotted values, latest 24 periods of each series</caption>"));
  assert.equal(out.match(/<th scope="col"/g).length, 4);
  assert.equal(out.match(/<th scope="row">/g).length, 2);
  assert.ok(out.includes('<td class="mm-num">24</td><td>EST</td>') && out.includes("<td>n/a</td>"));
  assert.ok(out.includes('href="/_file/x.parquet" download'));
  assert.ok(!viewAsTable(html, {id: "t", title: "x", rows, valueUnit: "u"}).s.includes("download"));
  // n: null lists every plotted period (spec 5.6); a cell without any unit states the defect instead of a bare value (AC-RD-42)
  const all = viewAsTable(html, {id: "t", title: "x", rows, n: null}).s;
  assert.ok(all.includes("<caption>x: plotted values, every plotted period of each series</caption>"));
  assert.ok(!all.includes('<td class="mm-num">24</td>') && all.includes('<td class="mm-num">24 This export holds no unit for this value.</td>'), "the value is kept, the defect sentence follows (AC-RD-30, AC-RD-42)");
});

test("figure.js computes nothing (static scan) and imports only local modules", () => {
  const src = readFileSync(new URL("../src/lib/figure.js", import.meta.url), "utf8");
  assert.deepEqual(computeHits(src), []);
  assert.ok(!/https?:\/\//.test(src));
  for (const m of src.matchAll(/^import .* from "(.*)";$/gm)) assert.match(m[1], /^\.\//);
});
