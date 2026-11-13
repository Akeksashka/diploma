import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {buildEuropeCollection, clipRing, featureContains, readDbf, readShp, simplifyLine} from "../scripts/lib/geo.mjs";
import {ccw, cw, makeDbf, makeShp} from "./support/make-shapefile.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIELDS = [{name: "ADM0_A3", len: 3}, {name: "NAME", len: 20}];
// Invented layout: AAA mainland (square with a hole) + an overseas island; BBB straddles the east edge; CCC is overseas only;
// DDD is a tiny country; EEE has no shape.
const records = [
  [cw(0, 40, 10), ccw(3, 43, 2), cw(-60, 5, 3)],
  [cw(40, 50, 10)],
  [cw(100, 10, 5)],
  [cw(12, 50, 0.05)],
  [],
];
const attrs = [
  {ADM0_A3: "AAA", NAME: "Alpha"},
  {ADM0_A3: "BBB", NAME: "Beta"},
  {ADM0_A3: "CCC", NAME: "Gamma"},
  {ADM0_A3: "DDD", NAME: "Delta"},
  {ADM0_A3: "EEE", NAME: "Empty"},
];
const shp = makeShp(records);
const dbf = makeDbf(attrs, FIELDS);
const build = (opts = {}) => buildEuropeCollection(readShp(shp), readDbf(dbf), {idField: "ADM0_A3", nameField: "NAME", ...opts});

test("reader: records, rings and attributes round trip", () => {
  const recs = readShp(shp);
  assert.equal(recs.length, 5);
  assert.equal(recs[0].length, 3);
  assert.deepEqual(recs[1][0][0], [40, 50]);
  assert.deepEqual(recs[4], []);
  assert.deepEqual(readDbf(dbf).map((r) => r.ADM0_A3), ["AAA", "BBB", "CCC", "DDD", "EEE"]);
  assert.equal(readDbf(dbf)[0].NAME, "Alpha");
});

test("reader: refuses truncated, wrong-type and out-of-bounds input", () => {
  assert.throws(() => readShp(Buffer.alloc(10)), /bad .shp header/);
  const wrongType = Buffer.from(shp);
  wrongType.writeInt32LE(3, 32);
  assert.throws(() => readShp(wrongType), /not Polygon/);
  assert.throws(() => readShp(shp.subarray(0, shp.length - 20)), /out of bounds/);
  const badCount = Buffer.from(shp);
  badCount.writeInt32LE(1e9, 100 + 8 + 40);
  assert.throws(() => readShp(badCount), /counts out of bounds/);
  assert.throws(() => readDbf(dbf.subarray(0, 100)), /out of bounds/);
});

test("build: overseas parts and countries dropped, straddling polygon clipped, hole kept", () => {
  const {collection, dropped} = build();
  const ids = collection.features.map((f) => f.properties.id);
  assert.deepEqual(ids, ["AAA", "BBB", "DDD"]);
  assert.deepEqual(dropped.map((d) => d.id), ["CCC", "EEE"]);
  const [a, b] = collection.features;
  assert.equal(a.geometry.type, "Polygon", "overseas island part of AAA removed");
  assert.equal(a.geometry.coordinates.length, 2, "exterior plus hole");
  const xs = b.geometry.coordinates[0].map((p) => p[0]);
  assert.equal(Math.max(...xs), 45);
  assert.ok(featureContains(a, [1, 41]) && !featureContains(a, [4, 44]) && !featureContains(a, [-59, 6]));
});

test("build: tiny country kept (largest part never dropped), coordinates rounded to 2 decimals", () => {
  const {collection} = build();
  const d = collection.features.find((f) => f.properties.id === "DDD");
  assert.ok(d);
  const odd = buildEuropeCollection(
    readShp(makeShp([[cw(1.23456, 41.98765, 3.14159)]])),
    readDbf(makeDbf([attrs[0]], FIELDS)),
    {idField: "ADM0_A3", nameField: "NAME"},
  ).collection;
  for (const [x, y] of odd.features[0].geometry.coordinates[0]) {
    assert.equal(x, Math.round(x * 100) / 100);
    assert.equal(y, Math.round(y * 100) / 100);
  }
});

test("build: simplification keeps small rings and reduces points", () => {
  const wavy = [[0, 40], [0, 50]];
  for (let i = 1; i < 100; i++) wavy.push([i / 10, 50 + (i % 2) * 0.001]);
  wavy.push([10, 40], [0, 40]);
  const make = (simplify) =>
    buildEuropeCollection(readShp(makeShp([[wavy], [cw(12, 50, 0.05)]])), readDbf(makeDbf(attrs.slice(0, 2), FIELDS)), {idField: "ADM0_A3", nameField: "NAME", simplify}).collection;
  const n = (c) => c.features[0].geometry.coordinates[0].length;
  assert.ok(n(make(0.01)) < n(make(0)));
  assert.equal(make(0.01).features.length, 2, "tiny ring survives simplification");
  assert.deepEqual(simplifyLine([[0, 0], [1, 0.001], [2, 0]], 0.01), [[0, 0], [2, 0]]);
  assert.deepEqual(simplifyLine([[0, 0], [1, 1], [2, 0]], 0), [[0, 0], [1, 1], [2, 0]]);
});

test("clipRing: fully outside gives null, fully inside is unchanged", () => {
  assert.equal(clipRing(cw(100, 10, 5)), null);
  assert.deepEqual(clipRing(cw(0, 40, 1)).length, 5);
});

test("CLI: writes the asset and a provenance sidecar with crimea fields null; keeps a user-set value", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-"));
  writeFileSync(join(dir, "t.shp"), shp);
  writeFileSync(join(dir, "t.dbf"), dbf);
  writeFileSync(join(dir, "v.txt"), "9.9.9\n");
  const run = () =>
    spawnSync(process.execPath, [join(root, "scripts/prepare-geo.mjs"), "--shp", join(dir, "t.shp"), "--dbf", join(dir, "t.dbf"), "--version-file", join(dir, "v.txt"), "--out", join(dir, "o.geojson"), "--source-out", join(dir, "s.json"), "--accessed", "2026-01-02"], {encoding: "utf8"});
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /reading t\.shp/);
  const src = JSON.parse(readFileSync(join(dir, "s.json"), "utf8"));
  assert.equal(src.crimea_checked_by_user, null);
  assert.equal(src.crimea_checked_date, null);
  assert.equal(src.licence, "public domain");
  assert.equal(src.version, "9.9.9");
  assert.equal(JSON.parse(readFileSync(join(dir, "o.geojson"), "utf8")).features.length, 3);
  writeFileSync(join(dir, "s.json"), JSON.stringify({...src, crimea_checked_by_user: "user", crimea_checked_date: "2026-02-03"}));
  assert.equal(run().status, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, "s.json"), "utf8")).crimea_checked_by_user, "user", "a rerun never overwrites the user's value");
  assert.equal(spawnSync(process.execPath, [join(root, "scripts/prepare-geo.mjs")], {encoding: "utf8"}).status, 2);
});

test("AC-V2-112: committed asset within 100 KB gzipped, provenance sidecar present, no new npm package", () => {
  const asset = readFileSync(join(root, "src/geo/europe-countries.geojson"));
  const gz = gzipSync(asset, {level: 9}).length;
  assert.ok(gz <= 100 * 1024, `asset is ${gz} bytes gzipped`);
  const src = JSON.parse(readFileSync(join(root, "src/geo/geo-source.json"), "utf8"));
  for (const k of ["source", "url", "version", "accessed", "licence", "input_sha256", "feature_id_field", "crimea_checked_by_user", "crimea_checked_date"]) assert.ok(k in src, k);
  assert.equal(src.licence, "public domain");
  assert.equal(src.asset_gzip_bytes, gz, "sidecar matches the asset: rerun prepare-geo");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@observablehq/framework", "@observablehq/plot", "d3"]);
  assert.deepEqual(Object.keys(pkg.devDependencies), ["playwright"]);
});
