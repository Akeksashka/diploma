// AC-V2-119, plan V52 (G-CRIMEA): Crimea and Sevastopol are Ukraine in the prepared asset. Hard requirement [USER 2026-11-13].
// Reference points are [lon, lat], recorded here.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {crimeaReleaseProblems, featureContains} from "../scripts/lib/geo.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const asset = JSON.parse(readFileSync(join(root, "src/geo/europe-countries.geojson"), "utf8"));
const source = JSON.parse(readFileSync(join(root, "src/geo/geo-source.json"), "utf8"));
const POINTS = {
  Simferopol: [34.1, 44.95],
  Sevastopol: [33.52, 44.6],
  Kerch: [36.47, 45.35],
  Yalta: [34.17, 44.5],
  Bakhchysarai: [33.88, 44.75],
  Dzhankoi: [34.4, 45.71],
};
const coveredBy = (pt) => asset.features.filter((f) => featureContains(f, pt)).map((f) => f.properties.id);

test("AC-V2-119: every Crimea and Sevastopol reference point lies in UKR and in no other feature", () => {
  for (const [name, pt] of Object.entries(POINTS)) assert.deepEqual(coveredBy(pt), ["UKR"], name);
});

test("AC-V2-119: no separate Crimea or Sevastopol feature; Russia does not cover Crimea", () => {
  assert.ok(!asset.features.some((f) => /crim|sevast|krym/i.test(`${f.properties.id} ${f.properties.name}`)));
  assert.equal(asset.features.filter((f) => f.properties.id === "UKR").length, 1);
  const rus = asset.features.find((f) => f.properties.id === "RUS");
  for (const pt of Object.values(POINTS)) assert.ok(!featureContains(rus, pt));
});

test("AC-V2-119: control points outside Crimea behave (Moscow in RUS, Kyiv in UKR)", () => {
  assert.deepEqual(coveredBy([37.62, 55.75]), ["RUS"]);
  assert.deepEqual(coveredBy([30.52, 50.45]), ["UKR"]);
});

test("release gate logic: null or missing values are problems, a value and a date pass", () => {
  assert.equal(crimeaReleaseProblems({crimea_checked_by_user: null, crimea_checked_date: null}).length, 2);
  assert.equal(crimeaReleaseProblems({crimea_checked_by_user: "user", crimea_checked_date: "soon"}).length, 1);
  assert.deepEqual(crimeaReleaseProblems({crimea_checked_by_user: "user", crimea_checked_date: "2026-11-20"}), []);
  assert.ok(crimeaReleaseProblems(null).length > 0);
});

// Runs only for a release build (MM_RELEASE=1); it fails while the user has not recorded the inspection. An agent never sets the field.
test("release: crimea_checked_by_user and its date are recorded by the user", {skip: process.env.MM_RELEASE !== "1" && "MM_RELEASE is not 1 (not a release build)"}, () => {
  assert.deepEqual(crimeaReleaseProblems(source), []);
});

test("sidecar: the field exists in geo-source.json (null until the user records it)", () => {
  assert.ok("crimea_checked_by_user" in source && "crimea_checked_date" in source);
});
