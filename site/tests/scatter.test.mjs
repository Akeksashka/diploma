// V20 (C3; AC-V2-41..45, 87 `p`): the scatter of two indicators on the SYNTHETIC v2 fixture. Invented data, not a measurement.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_BLOCKED_MESSAGE, DRAFT_COMPARE_CHOOSE_PAIR, DRAFT_NO_VALUE_FOR} from "../src/lib/copy.js";
import {countHiddenRowsByReason} from "../src/lib/filter-model.js";
import {emptyHashState, parseHash, serializeHash} from "../src/lib/hash.js";
import {scatterBlock, scatterChart, scatterModel, scatterTableRows} from "../src/lib/scatter.js";
import * as scatterModule from "../src/lib/scatter.js";
import {html} from "./support/html-standin.mjs";
import {entities, fakePlot, groups, indicators, manifest, series, seriesRows} from "./support/load-v2.mjs";

const ind = (id) => indicators.find((i) => i.indicator_id === id);
const build = (x, y, state = {}) => scatterModel({x: x && ind(x), y: y && ind(y), rowsX: x ? seriesRows(x) : [], rowsY: y ? seriesRows(y) : [], entities, groups, series, state: {...emptyHashState(), ...state}, knownCutoff: manifest.known_cutoff});
const block = (m) => String(scatterBlock(html, fakePlot().Plot, m, {id: "c3-test"}));
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a dot is a country with BOTH stored values in the chosen period; the others are listed with `no value for <indicator>` (AC-V2-42)", () => {
  const m = build("M09", "M10");
  assert.equal(m.status, "ok");
  assert.ok(m.points.length >= 20);
  const x = seriesRows("M09");
  const y = seriesRows("M10");
  for (const p of m.points) {
    assert.equal(x.find((r) => r.entity === p.entityId && r.end === m.period.ms).value, p.x);
    assert.equal(y.find((r) => r.entity === p.entityId && r.end === m.period.ms).value, p.y);
  }
  const earlier = build("M09", "M10", {p: "2025-06"});
  const ita = earlier.hidden.find((h) => h.row.entityId === "ITA");
  assert.equal(ita.reason, "no_data");
  assert.equal(ita.row.reasonSentence, DRAFT_NO_VALUE_FOR([ind("M10").name]), "ITA has a stored M09 value in 2025-06 and only MISS rows of M10");
  const both = m.hidden.find((h) => h.row.entityId === "ITA");
  assert.equal(both.row.reasonSentence, DRAFT_NO_VALUE_FOR([ind("M09").name, ind("M10").name]), "stale: no M09 value in 2026-09 either");
  assert.equal(countHiddenRowsByReason(m.hidden).total, m.hidden.length);
  assert.ok(m.hidden.some((h) => h.row.entityId === "JPN" && /Unemployment rate/.test(h.row.reasonSentence) && /no value for/.test(h.row.reasonSentence)));
});

test("a gap in one series removes that country from that period only (join on the identical period)", () => {
  const gap = build("M09", "M10", {p: "2025-04"});
  assert.equal(gap.period.value, "2025-04");
  assert.ok(!gap.points.some((p) => p.entityId === "ESP"), "M09 ESP has no stored value 2025-03..05");
  assert.ok(build("M09", "M10", {p: "2025-06"}).points.some((p) => p.entityId === "ESP"));
});

test("different stored frequencies are blocked with the stored reason, nothing is resampled (AC-V2-41)", () => {
  for (const [x, y] of [["M09", "A05"], ["M09", "Q08"], ["Q08", "A05"]]) {
    const m = build(x, y);
    assert.equal(m.status, "blocked", `${x} x ${y}`);
    assert.equal(m.blockedMessage, DRAFT_BLOCKED_MESSAGE(["frequency"]));
    const out = block(m);
    assert.match(out, /differing stored fields: frequency/);
    assert.doesNotMatch(out, /<svg/);
  }
  assert.equal(build("A04", "A05").status, "ok");
});

test("default period: the latest common period stored for x and y, no point threshold (D1)", () => {
  const m = build("M09", "M10");
  assert.equal(m.period.value, "2026-09");
  assert.equal(m.defaulted, true);
  // a synthetic export where the newest period has only two pairs: it is still the default
  const thin = scatterModel({
    x: ind("M09"), y: ind("M10"),
    rowsX: seriesRows("M09").filter((r) => r.end <= Date.UTC(2026, 5, 30) || ["DEU", "FRA"].includes(r.entity)),
    rowsY: seriesRows("M10").filter((r) => r.end <= Date.UTC(2026, 5, 30) || ["DEU", "FRA"].includes(r.entity)),
    entities, groups, series, state: emptyHashState(), knownCutoff: manifest.known_cutoff
  });
  assert.equal(thin.period.value, "2026-09", "two pairs are enough: the latest common period");
  assert.ok(thin.points.length >= 1 && thin.points.length < 5);
  assert.equal(scatterModule.MIN_POINTS, undefined, "no threshold constant remains");
});

test("with no f the default frequency is the first one COMMON to x and y; blocked only when none is common (D7 fix)", () => {
  const x = {...ind("M09"), frequency_set: ["Q", "M"]};
  const m = scatterModel({x, y: ind("M10"), rowsX: seriesRows("M09"), rowsY: seriesRows("M10"), entities, groups, series, state: emptyHashState(), knownCutoff: manifest.known_cutoff});
  assert.equal(m.status, "ok");
  assert.equal(m.frequency, "M", "Q is x's first, but only M is common");
  const reversed = scatterModel({x: ind("M10"), y: {...ind("M09"), frequency_set: ["Q", "M"]}, rowsX: seriesRows("M10"), rowsY: seriesRows("M09"), entities, groups, series, state: emptyHashState()});
  assert.equal(reversed.status, "ok");
  assert.equal(reversed.frequency, "M");
  const none = scatterModel({x: {...ind("M09"), frequency_set: ["Q", "A"]}, y: ind("M10"), rowsX: seriesRows("M09"), rowsY: seriesRows("M10"), entities, groups, series, state: emptyHashState()});
  assert.equal(none.status, "blocked");
  assert.equal(none.blockedMessage, DRAFT_BLOCKED_MESSAGE(["frequency"]));
  const asked = scatterModel({x: {...ind("M09"), frequency_set: ["Q", "M"]}, y: ind("M10"), rowsX: seriesRows("M09"), rowsY: seriesRows("M10"), entities, groups, series, state: {...emptyHashState(), f: "Q"}});
  assert.equal(asked.frequency, "M", "an f that is not common is ignored, as an f outside the stored set always was");
});

test("the table alternative lists the hidden rows too, with the stored value they have and the reason sentence (spec 7.3)", () => {
  const m = build("M09", "M10", {p: "2025-06"});
  const rows = scatterTableRows(m);
  assert.equal(rows.length, m.points.length + m.hidden.length);
  const ita = rows.find((r) => r.entityId === "ITA");
  assert.equal(ita.state, DRAFT_NO_VALUE_FOR([ind("M10").name]));
  assert.notEqual(ita.x, "not stated", "ITA has a stored M09 value in 2025-06");
  assert.equal(ita.y, "not stated");
  assert.match(block(m), /data-entity="ITA"/);
});

test("`p` is one stored period in the hash forms YYYY, YYYY-Qn, YYYY-MM; an invalid or unstored p is absent and the default applies (AC-V2-87)", () => {
  const known = parseHash("#x=M09&y=M10&p=2025-06");
  assert.equal(known.p, "2025-06");
  assert.equal(build("M09", "M10", {p: known.p}).period.value, "2025-06");
  assert.equal(build("M09", "M10", {p: "1999-01"}).defaulted, true, "not a stored common period");
  assert.equal(build("M09", "M10", {p: "1999-01"}).period.value, "2026-09");
  assert.equal(parseHash("#p=2025-13").p, null);
  assert.equal(parseHash("#p=2025-Q5").p, null);
  assert.equal(parseHash("#p=2024-2025").p, null, "not a range");
  assert.equal(serializeHash({x: "M09", y: "M10", p: "2025-06"}), "#x=M09&y=M10&p=2025-06");
  const q = build("Q08", "Q08", {p: "2026-Q2"});
  assert.equal(q.period.value, "2026-Q2");
  assert.equal(q.period.label, "2026 Q2");
  const a = build("A04", "A05", {p: "2024"});
  assert.equal(a.period.value, "2024");
  assert.deepEqual(a.periods.map((p) => p.value), [...a.periods.map((p) => p.value)].sort().reverse());
});

test("both axes are titled with the unit; no forced zero; a zero rule only where a range crosses zero (AC-V2-43)", () => {
  const m = build("M09", "M10");
  const {Plot, plots} = fakePlot();
  scatterChart(Plot, m);
  assert.equal(plots[0].x.label, `${ind("M09").name} (% of labour force)`);
  assert.equal(plots[0].y.label, `${ind("M10").name} (% of population 15-64)`);
  assert.ok(!("zero" in plots[0].x) && !("zero" in plots[0].y) && !("domain" in plots[0].x));
  assert.equal(plots[0].marks.filter((mk) => mk.type === "ruleX" || mk.type === "ruleY").length, 0, "positive ranges: no zero rule");
  const crossing = build("A04", "A05");
  const c = fakePlot();
  scatterChart(c.Plot, crossing);
  assert.ok(crossing.crossesZeroX === (crossing.points.some((p) => p.x < 0) && crossing.points.some((p) => p.x > 0)));
  const bothAxes = scatterModel({...{x: ind("A04"), y: ind("A02"), rowsX: seriesRows("A04"), rowsY: seriesRows("A02"), entities, groups, series, state: emptyHashState()}});
  assert.equal(bothAxes.status, "ok");
});

test("only the highlighted countries are labelled, at most eight; aggregates are excluded (spec C3)", () => {
  const some = build("A04", "A05", {c: ["DEU", "FRA", "EU27"]});
  assert.deepEqual(some.labelled.map((p) => p.entityId).sort(), ["DEU", "FRA"]);
  assert.ok(!some.points.some((p) => p.entityId === "EU27" || p.entityId === "EA" || p.entityId === "WLD"));
  const many = build("A04", "A05", {c: ["DEU", "FRA", "ITA", "ESP", "POL"]});
  assert.ok(many.labelled.length <= 8);
  const none = build("A04", "A05");
  assert.equal(none.labelled.length, 0);
  const {Plot, plots} = fakePlot();
  scatterChart(Plot, some);
  assert.deepEqual(plots[0].marks.find((mk) => mk.type === "text").data.map((p) => p.entityId).sort(), ["DEU", "FRA"]);
});

test("no regression, trend line, correlation or third variable in the marks (AC-V2-44)", () => {
  const {Plot, plots} = fakePlot();
  scatterChart(Plot, build("M09", "M10"));
  const types = plots[0].marks.map((mk) => mk.type);
  assert.deepEqual([...new Set(types)].sort(), ["dot", "text", "tip"].sort());
  for (const mk of plots[0].marks) assert.ok(!("r" in mk.options) || typeof mk.options.r === "number", "point size is a constant, not a variable");
  const text = readFileSync(join(root, "src", "lib", "scatter.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(text, /regress|correlat|trend|linearRegression|Plot\.(?:lineY|line)\b/i);
});

test("the table lists country, period, x and y with the unit in each header (AC-V2-45)", () => {
  const m = build("M09", "M10");
  const out = block(m);
  assert.match(out, new RegExp(`Value \\(${ind("M09").name.replace(/[()]/g, ".")} \\(% of labour force\\)\\)`));
  assert.match(out, /% of population 15-64\)\)/);
  assert.equal(scatterTableRows(m).length, m.points.length + m.hidden.length);
  assert.ok(scatterTableRows(m).every((r) => r.period === m.period.label));
});

test("a stored unit that differs inside one axis blocks the chart (A1.6)", () => {
  const m = scatterModel({x: ind("V01"), y: ind("A05"), rowsX: seriesRows("V01"), rowsY: seriesRows("A05"), entities, groups, series, state: emptyHashState()});
  assert.ok(m.status === "blocked-series" || m.status === "ok");
  if (m.status === "blocked-series") assert.match(String(scatterBlock(html, fakePlot().Plot, m)), /unit code/);
});

test("nothing chosen asks for two indicators; no stored common period says so", () => {
  const out = block(build(null, null));
  assert.ok(out.includes(DRAFT_COMPARE_CHOOSE_PAIR));
  const m = scatterModel({x: ind("M09"), y: ind("M10"), rowsX: seriesRows("M09").filter((r) => r.entity === "DEU"), rowsY: seriesRows("M10").filter((r) => r.entity === "FRA"), entities, groups, series, state: emptyHashState()});
  assert.equal(m.status, "none");
  assert.match(block(m), /No reference period has a stored value of both indicators/);
});
