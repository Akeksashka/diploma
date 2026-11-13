// Entity-to-geometry join check (ADR-037 A2.2 item 9, plan V51). Fails when a kind=country entity has neither a
// join row nor outside_extent, when a join row's feature_id is not in the asset, or when a row is inconsistent.
// Usage: node scripts/check-geo-join.mjs [--entities <entities.json>] [--join <join.json>] [--asset <geojson>] [--report <out.json>]
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");

// Synthetic test-fixture entities (tests/fixtures/sparse_export: SY01..SY41, iso3 null) have no geometry by design. Only this exact shape
// (iso3 null AND an id of the form SY<digits>, which no real 3-letter ISO id matches) is reported as not_applicable; anything else stays strict.
export const isSyntheticEntity = (e) => e.iso3 === null && /^SY\d+$/.test(String(e.entity_id));

/** entities: entity list; join: {rows: [...]}; asset: FeatureCollection. Aggregates never need a row. */
export function checkGeoJoin({entities, join, asset}) {
  const errors = [];
  const features = new Set(asset.features.map((f) => f.properties.id));
  const rows = join.rows ?? [];
  const byEntity = new Map();
  for (const r of rows) {
    if (byEntity.has(r.entity_id)) errors.push(`duplicate join row for ${r.entity_id}`);
    byEntity.set(r.entity_id, r);
    if (r.outside_extent === true) {
      if (r.feature_id !== null) errors.push(`${r.entity_id}: outside_extent rows must have feature_id null`);
      if (r.marker) errors.push(`${r.entity_id}: outside_extent rows cannot be markers`);
    } else if (!features.has(r.feature_id)) {
      errors.push(`${r.entity_id}: feature_id ${r.feature_id} is not in the asset`);
    }
  }
  const notApplicable = entities.filter((e) => e.kind === "country" && isSyntheticEntity(e) && !byEntity.has(e.entity_id)).map((e) => e.entity_id);
  const countries = entities.filter((e) => e.kind === "country" && !notApplicable.includes(e.entity_id));
  const missing = countries.filter((e) => !byEntity.has(e.entity_id)).map((e) => e.entity_id);
  for (const id of missing) errors.push(`${id}: kind=country entity has neither a join row nor outside_extent`);
  const aggregateRows = entities.filter((e) => e.kind !== "country" && byEntity.has(e.entity_id)).map((e) => e.entity_id);
  for (const id of aggregateRows) errors.push(`${id}: aggregates must not have a join row`);
  const report = {
    countries: countries.length,
    not_applicable: notApplicable.length,
    not_applicable_ids: notApplicable,
    joined: countries.filter((e) => byEntity.get(e.entity_id)?.outside_extent === false).length,
    outside_extent: countries.filter((e) => byEntity.get(e.entity_id)?.outside_extent === true).map((e) => e.entity_id),
    markers: rows.filter((r) => r.marker).map((r) => r.entity_id),
    missing_join: missing,
    join_rows_not_in_export: rows.filter((r) => !entities.some((e) => e.entity_id === r.entity_id)).map((r) => r.entity_id),
    features_without_entity: [...features].filter((id) => !rows.some((r) => r.feature_id === id)).length,
    errors,
  };
  return {ok: errors.length === 0, errors, report};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  const entities = read(args.entities ?? resolve(site, "src/data/meta/entities.json")).entities;
  const join = read(args.join ?? resolve(site, "src/geo/entity_geo_join.json"));
  const asset = read(args.asset ?? resolve(site, "src/geo/europe-countries.geojson"));
  const {ok, errors, report} = checkGeoJoin({entities, join, asset});
  const out = resolve(args.report ?? resolve(site, "test-artifacts/geo-join-report.json"));
  mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  if (!ok) {
    console.error(`check-geo-join: ${errors.length} problem(s):\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log(`check-geo-join: ${report.joined} joined, ${report.outside_extent.length} outside extent, ${report.markers.length} markers`);
}
