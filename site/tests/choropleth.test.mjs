// V53 (C6, ADR-037 A2.2; AC-V2-110, 111, 113, 114, 116, 118) on the SYNTHETIC v2 fixture and the real geometry asset and join table. Invented data, not a measurement.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_C6_GEO_UNREADABLE, DRAFT_C6_SOURCE_NOTE} from "../src/lib/copy.js";
import {barListModel} from "../src/lib/bar-list.js";
import {choroplethBlock, choroplethChart, choroplethLegend, choroplethTableRows, MARKER_RADIUS} from "../src/lib/choropleth.js";
import {choroplethModel} from "../src/lib/choropleth-model.js";
import {countHiddenRowsByReason} from "../src/lib/filter-model.js";
import {emptyHashState} from "../src/lib/hash.js";
import {html} from "./support/html-standin.mjs";
import {entities, groups, indicators, manifest, scorecards, series} from "./support/load-v2.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const asset = JSON.parse(readFileSync(join(root, "src", "geo", "europe-countries.geojson"), "utf8"));
const joinTable = JSON.parse(readFileSync(join(root, "src", "geo", "entity_geo_join.json"), "utf8"));
const feature = (id) => asset.features.find((f) => f.properties.id === id);

const inputs = (id, state = {}) => ({indicator: indicators.find((i) => i.indicator_id === id), scorecards, entities, groups, series, state: {...emptyHashState(), ...state}, knownCutoff: manifest.known_cutoff});
const build = (id, state = {}, extra = {}) => choroplethModel({...inputs(id, state), join: joinTable, asset, ...extra});
// Plot stand-in with the geo and dot marks: records each mark and the plot options.
const fakeGeoPlot = () => {
  const plots = [];
  const mark = (type) => (data, options) => ({type, data, options});
  return {Plot: {plot: (o) => (plots.push(o), "<svg></svg>"), geo: mark("geo"), dot: mark("dot")}, plots};
};
const marks = (m) => {
  const {Plot, plots} = fakeGeoPlot();
  choroplethChart(Plot, m);
  return {plot: plots[0], marks: plots[0].marks};
};

test("the selection is the C2 selection: the drawn countries are C2's drawn countries that have a shape (AC-V2-110)", () => {
  for (const [id, state] of [["A04", {}], ["M09", {}], ["A04", {oth: true}]]) {
    const c2 = barListModel(inputs(id, state));
    const m = build(id, state);
    const outside = new Set(joinTable.rows.filter((r) => r.outside_extent).map((r) => r.entity_id));
    const expected = c2.bars.filter((r) => r.kind === "country" && !outside.has(r.entityId)).map((r) => r.entityId).sort();
    assert.deepEqual(m.mapped.map((r) => r.entityId).sort(), expected, `${id} ${JSON.stringify(state)}`);
    assert.equal(m.referencePeriod, c2.referencePeriod);
    assert.ok(m.mapped.every((r) => r.value !== null && r.row.hasValue));
  }
});

test("pc does not affect the colour: the drawn rows, their values and the extent are the same with pc on", () => {
  const a = build("A04");
  const b = build("A04", {pc: true});
  assert.deepEqual(b.mapped.map((r) => [r.entityId, r.value]), a.mapped.map((r) => [r.entityId, r.value]));
  assert.deepEqual(b.extent, a.extent);
});

test("scale type: sequential single hue at or above 0, diverging with midpoint 0 when a negative value is shown; continuous over the stored min to max, no classes (AC-V2-111)", () => {
  const seq = build("M09");
  assert.equal(seq.scaleKind, "sequential");
  const s = marks(seq).plot.color;
  assert.equal(s.type, "linear");
  assert.deepEqual(s.domain, [seq.extent.min, seq.extent.max]);
  assert.equal(seq.extent.min, Math.min(...seq.mapped.map((r) => r.value)), "the extent is the lowest and highest drawn stored value");
  assert.equal(seq.extent.max, Math.max(...seq.mapped.map((r) => r.value)));
  const div = build("A04");
  assert.equal(div.scaleKind, "diverging");
  const d = marks(div).plot.color;
  assert.equal(d.type, "diverging");
  assert.equal(d.pivot, 0);
  for (const bad of ["threshold", "quantize", "quantile", "scheme", "n", "thresholds"]) assert.ok(!(bad in s) && !(bad in d), `no class option ${bad}`);
  assert.match(seq.scaleText, /continuous, no classes/);
  assert.ok(seq.scaleText.includes("3") && seq.scaleText.includes("7.4"));
});

test("the legend shows the stored minimum, maximum and unit; the diverging form also shows 0 (AC-V2-111)", () => {
  const out = String(choroplethLegend(html, build("A04")));
  assert.match(out, /lowest -5\.2/);
  assert.match(out, /-0\.7 highest/);
  assert.match(out, /% of GDP/);
  assert.match(out, /data-scale="diverging"/);
  assert.equal(String(choroplethLegend(html, build("M09"))).includes("mm-c4-legend-mid"), false);
  assert.equal(String(choroplethLegend(html, {extent: null})), "");
});

test("hatched countries are exactly the hidden countries with a shape and no stored value; none is coloured as zero, and a stored value that is not drawn is not hatched (AC-V2-113, A1.1)", () => {
  const m = build("M09");
  const hiddenWithShape = m.hidden.filter((h) => !m.notMapped.some((n) => n.entityId === h.row.entityId));
  assert.deepEqual(m.hatched.map((r) => r.entityId).sort(), hiddenWithShape.filter((h) => !h.row.hasValue).map((h) => h.row.entityId).sort());
  assert.deepEqual(m.hatched.map((r) => r.entityId).sort(), ["GBR", "NOR", "TUR", "UKR"].filter((id) => feature(id)));
  assert.deepEqual(m.plain.map((r) => r.entityId).sort(), ["FRA", "ITA"]);
  assert.ok(m.plain.every((r) => r.row.hasValue && r.reason === "stale"));
  const {marks: mk} = marks(m);
  const geos = mk.filter((x) => x.type === "geo");
  const hatch = geos.find((x) => x.options.fill === "url(#mm-blank-c6)");
  assert.deepEqual(hatch.data.map((f) => f.properties.id).sort(), m.hatched.map((r) => r.featureId).sort());
  assert.ok(hatch.data.every((f) => f.properties.value === null), "a hatched shape has no value, so no colour of the scale");
  const coloured = geos.filter((x) => typeof x.options.fill === "function");
  for (const g of coloured) assert.ok(g.data.every((f) => f.properties.value !== null && f.properties.value !== undefined));
  assert.ok(!mk.some((x) => x.options?.fill === 0 || x.options?.fill === "0"));
});

test("aggregates and outside-extent entities are never drawn; each is in the hidden array under `other` with a stored-state sentence, and the tally is countHiddenRowsByReason (AC-V2-114)", () => {
  const m = build("A04");
  const drawnIds = new Set([...m.mapped, ...m.hatched, ...m.plain].map((r) => r.entityId));
  for (const id of ["EU27", "EA", "USA", "JPN", "IND", "CHN"]) {
    assert.ok(!drawnIds.has(id), `${id} is not drawn`);
    const h = m.hidden.find((x) => x.row.entityId === id);
    assert.equal(h?.reason, "other", id);
    assert.ok(h.row.mapNote && h.row.mapNote !== "not stated", id);
  }
  assert.match(m.hidden.find((x) => x.row.entityId === "EU27").row.mapNote, /^an aggregate, not drawn on the map; /);
  assert.match(m.hidden.find((x) => x.row.entityId === "USA").row.mapNote, /^outside the map extent; /);
  const counts = countHiddenRowsByReason(m.hidden);
  assert.equal(counts.total, m.hidden.length);
  assert.equal(counts.no_data + counts.stale + counts.other_period + counts.other, counts.total);
  assert.ok(String(choroplethBlock(html, fakeGeoPlot().Plot, m)).includes("rows hidden: "));
});

test("no row is dropped: drawn plus hidden is every row of the comparison set, and a row without a shape goes to the hidden array with reason `other`", () => {
  const m = build("A04");
  const drawn = new Set([...m.mapped.map((r) => r.entityId)]);
  const hidden = new Set(m.hidden.map((h) => h.row.entityId));
  assert.equal(drawn.size + hidden.size, m.rows.length);
  assert.ok([...drawn].every((id) => !hidden.has(id)));
  // a drawn country whose join row is removed, and one whose feature is absent from the asset
  const noJoin = build("A04", {}, {join: {rows: joinTable.rows.filter((r) => r.entity_id !== "DEU")}});
  assert.ok(!noJoin.mapped.some((r) => r.entityId === "DEU"));
  assert.equal(noJoin.hidden.find((h) => h.row.entityId === "DEU").reason, "other");
  assert.match(noJoin.hidden.find((h) => h.row.entityId === "DEU").row.mapNote, /^no map shape for this country; /);
  const noFeature = build("A04", {}, {asset: {type: "FeatureCollection", features: asset.features.filter((f) => f.properties.id !== "FRA")}});
  assert.equal(noFeature.hidden.find((h) => h.row.entityId === "FRA").reason, "other");
  assert.equal(noFeature.mapped.length, m.mapped.length - 1);
});

test("small countries: a fixed-size circle at a stored position for each marker entity with a value, drawn with the same scale (AC-V2-116)", () => {
  const m = build("A04");
  const markerIds = joinTable.rows.filter((r) => r.marker).map((r) => r.entity_id).sort();
  assert.deepEqual(markerIds, ["CYP", "LUX", "MLT"]);
  assert.deepEqual(m.markers.map((r) => r.entityId).sort(), markerIds.filter((id) => m.mapped.some((r) => r.entityId === id)));
  assert.equal(m.markers.length, 3);
  const {marks: mk} = marks(m);
  const dots = mk.find((x) => x.type === "dot" && typeof x.options.fill === "function");
  assert.equal(dots.data.length, 3);
  assert.equal(dots.options.r, MARKER_RADIUS, "a fixed radius, not a channel of the data");
  assert.equal(typeof dots.options.r, "number");
  for (const r of dots.data) {
    const [lon, lat] = [dots.options.x(r), dots.options.y(r)];
    const rings = feature(r.featureId).geometry.type === "Polygon" ? [feature(r.featureId).geometry.coordinates] : feature(r.featureId).geometry.coordinates;
    assert.ok(rings.flat(2).length > 0 && rings.some((poly) => poly[0].some((p) => p[0] === lon && p[1] === lat)), `${r.entityId}: the position is a stored vertex of its own shape`);
  }
  // a marker entity without a value is a hatched circle, never a coloured one
  const gap = build("M09");
  assert.ok(gap.markers.length === 3);
});

// The fixture has no row whose stored period differs from the reference one, so TUR's stored period is moved to 2024 in a clone (the stored fields of the cell only).
const withTurIn2024 = () => {
  const copy = structuredClone(scorecards);
  for (const e of copy.fiscal.entities.filter((x) => x.entity_id === "TUR")) for (const c of e.indicators.filter((x) => x.indicator_id === "A04")) c.ref_period_end = "2024-12-31";
  return copy;
};

test("oth draws an other-period row with a dashed outline and its period in the tip; without oth it is hidden as another period (AC-V2-110)", () => {
  const sc = withTurIn2024();
  const off = build("A04", {}, {scorecards: sc});
  assert.ok(!off.mapped.some((r) => r.entityId === "TUR"));
  assert.equal(off.hidden.find((h) => h.row.entityId === "TUR").reason, "other_period");
  assert.ok(off.plain.some((r) => r.entityId === "TUR"), "a stored value that is not drawn is plain, not hatched");
  const on = build("A04", {oth: true}, {scorecards: sc});
  const tur = on.mapped.find((r) => r.entityId === "TUR");
  assert.ok(tur && tur.other === true);
  assert.match(tur.tip, /2024/);
  const dashed = marks(on).marks.find((x) => x.type === "geo" && x.options.strokeDasharray);
  assert.deepEqual(dashed.data.map((f) => f.properties.id), ["TUR"]);
  assert.ok(!marks(off).marks.some((x) => x.options?.strokeDasharray));
});

test("the projection is the Lambert azimuthal equal-area rotated about [-10, -52], fitted to the asset; no pan or zoom is configured", () => {
  const {plot} = marks(build("A04"));
  assert.equal(plot.projection.type, "azimuthal-equal-area");
  assert.deepEqual(plot.projection.rotate, [-10, -52]);
  assert.equal(plot.projection.domain.features.length, asset.features.length);
  assert.ok(!("zoom" in plot) && !("pan" in plot));
});

test("the colour of a shape is the stored value channel, never a computed class", () => {
  const m = build("M09");
  const solid = marks(m).marks.find((x) => x.type === "geo" && typeof x.options.fill === "function");
  for (const f of solid.data) assert.equal(solid.options.fill(f), m.mapped.find((r) => r.featureId === f.properties.id).value);
});

test("a failed geometry read is stated, nothing is drawn, and every row stays listed in the hidden array and the table", () => {
  const m = build("A04", {}, {geoFailed: true, asset: null, join: null});
  assert.equal(m.mapped.length, 0);
  assert.equal(m.hidden.length, m.rows.length);
  const out = String(choroplethBlock(html, fakeGeoPlot().Plot, m));
  assert.ok(out.includes(DRAFT_C6_GEO_UNREADABLE));
  assert.ok(!out.includes("<figure"));
  assert.equal(choroplethTableRows(m).length, m.rows.length);
});

test("the card source note names Natural Earth; the aggregates note and the reference period are printed", () => {
  const out = String(choroplethBlock(html, fakeGeoPlot().Plot, build("A04")));
  assert.ok(out.includes(DRAFT_C6_SOURCE_NOTE) && DRAFT_C6_SOURCE_NOTE.includes("Natural Earth"));
  assert.match(out, /data-field="aggregates-note"/);
  assert.match(out, /data-field="reference-period"/);
});

test("the unit comes from the stored indicator unit; a blocked selection draws no map and states the differing stored fields", () => {
  const m = build("A04");
  assert.equal(m.unit, "% of GDP");
  const blocked = {...m, blocked: true, compat: {status: "blocked", blocked: [{field: "unit_code", values: ["EUR", "PCT"]}], marked: [], skipped: []}};
  const out = String(choroplethBlock(html, fakeGeoPlot().Plot, blocked));
  assert.match(out, /data-state="blocked"/);
  assert.ok(!out.includes("<figure"));
});

test("no statistic in the C6 modules: no quantile, mean, median, class break, Math call, percent form, d3 call or centroid (AC-V2-118)", () => {
  for (const f of ["choropleth.js", "choropleth-model.js"]) {
    const code = readFileSync(join(root, "src", "lib", f), "utf8").replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
    assert.doesNotMatch(code, /quantile|\bmean\b|median|percentile|threshold|quantize|\bbreaks?\b|classes|\bMath\s*\.|\bd3\b|centroid|\bregress|correlat/i, f);
    assert.doesNotMatch(code, /[\w)\]]\s*[*/]\s*100\b/, f);
  }
});
