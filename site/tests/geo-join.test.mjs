import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {checkGeoJoin} from "../scripts/check-geo-join.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const asset = read("src/geo/europe-countries.geojson");
const join_ = read("src/geo/entity_geo_join.json");
const dense = read("tests/fixtures/v2_export/meta/entities.json").entities;
const sparse = read("tests/fixtures/sparse_export/meta/entities.json").entities;
const panel = readFileSync(join(root, "..", "config/entities.yaml"), "utf8")
  .split("\n")
  .map((l) => l.match(/\{id: (\w+),.*kind: country/))
  .filter(Boolean)
  .map((m) => ({entity_id: m[1], kind: "country"}));

test("join: dense fixture (real ISO ids) and the 42-country panel config are fully covered", () => {
  assert.equal(panel.length, 42);
  for (const ents of [dense, panel]) {
    const r = checkGeoJoin({entities: ents, join: join_, asset});
    assert.deepEqual(r.errors, []);
    assert.ok(r.ok);
  }
});

test("join: markers include Malta, Luxembourg, Cyprus; USA, JPN, IND flagged outside extent; no aggregate rows", () => {
  const rows = Object.fromEntries(join_.rows.map((r) => [r.entity_id, r]));
  for (const id of ["MLT", "LUX", "CYP"]) assert.equal(rows[id].marker, true, id);
  for (const id of ["USA", "JPN", "IND"]) assert.deepEqual([rows[id].outside_extent, rows[id].feature_id], [true, null], id);
  for (const id of ["EU27", "EA", "WLD"]) assert.equal(rows[id], undefined, id);
  assert.ok(join_.rows.every((r) => Object.keys(r).sort().join() === "entity_id,feature_id,marker,outside_extent"));
});

test("join: removing a row fails; unknown feature_id fails; outside_extent inconsistencies fail", () => {
  const without = {rows: join_.rows.filter((r) => r.entity_id !== "DEU")};
  const r1 = checkGeoJoin({entities: dense, join: without, asset});
  assert.ok(!r1.ok);
  assert.match(r1.errors.join("\n"), /DEU: kind=country entity has neither a join row nor outside_extent/);
  const unknown = {rows: join_.rows.map((r) => (r.entity_id === "FRA" ? {...r, feature_id: "ZZZ"} : r))};
  assert.match(checkGeoJoin({entities: dense, join: unknown, asset}).errors.join("\n"), /FRA: feature_id ZZZ is not in the asset/);
  const bad = {rows: join_.rows.map((r) => (r.entity_id === "USA" ? {...r, feature_id: "USA"} : r))};
  assert.ok(!checkGeoJoin({entities: dense, join: bad, asset}).ok);
  const agg = {rows: [...join_.rows, {entity_id: "WLD", feature_id: "FRA", marker: false, outside_extent: false}]};
  assert.match(checkGeoJoin({entities: dense, join: agg, asset}).errors.join("\n"), /WLD: aggregates must not have a join row/);
  const dup = {rows: [...join_.rows, join_.rows[0]]};
  assert.match(checkGeoJoin({entities: dense, join: dup, asset}).errors.join("\n"), /duplicate join row/);
});

test("join: the sparse fixture (synthetic SYnn ids, no geometry) passes with an explicit not_applicable count; real-looking entities stay strict", () => {
  const r = checkGeoJoin({entities: sparse, join: join_, asset});
  assert.ok(r.ok, r.errors.join("\n"));
  assert.equal(r.report.not_applicable, 41);
  assert.equal(r.report.not_applicable_ids.length, 41);
  assert.equal(r.report.countries, 0);
  assert.deepEqual(r.report.missing_join, []);
  // strictness: a country without iso3 whose id is not SYnn, or a SYnn id with an iso3, is still required to have a join row
  const real = [{entity_id: "XYZ", kind: "country", iso3: null}, {entity_id: "SY99", kind: "country", iso3: "SYX"}];
  const r2 = checkGeoJoin({entities: real, join: join_, asset});
  assert.ok(!r2.ok);
  assert.equal(r2.report.not_applicable, 0);
  assert.deepEqual(r2.report.missing_join, ["XYZ", "SY99"]);
  // the dense fixture reports zero not_applicable
  assert.equal(checkGeoJoin({entities: dense, join: join_, asset}).report.not_applicable, 0);
});
