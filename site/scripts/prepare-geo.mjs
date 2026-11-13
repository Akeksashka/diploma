// Prepare the C6 map geometry (ADR-037 A2.2, plan V50): Natural Earth admin-0 shapefile -> Europe GeoJSON.
// No dependency. The input is untrusted data and is only parsed.
// Usage: node scripts/prepare-geo.mjs --shp <file.shp> --dbf <file.dbf> [--version-file <VERSION.txt>]
//        [--out src/geo/europe-countries.geojson] [--source-out src/geo/geo-source.json] [--accessed YYYY-MM-DD]
//        [--simplify <degrees>]  Douglas-Peucker tolerance applied before rounding (0 or absent = off)
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {basename, dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {EUROPE_EXTENT, buildEuropeCollection, readDbf, readShp} from "./lib/geo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
for (const k of ["shp", "dbf"]) {
  if (!args[k]) {
    console.error("prepare-geo: --shp and --dbf are required");
    process.exit(2);
  }
}
const out = resolve(args.out ?? resolve(here, "..", "src/geo/europe-countries.geojson"));
const sourceOut = resolve(args["source-out"] ?? resolve(here, "..", "src/geo/geo-source.json"));
const simplify = args.simplify ? Number(args.simplify) : 0;
if (!(simplify >= 0)) {
  console.error("prepare-geo: --simplify must be a number >= 0");
  process.exit(2);
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

const shpBuf = readFileSync(args.shp);
const dbfBuf = readFileSync(args.dbf);
console.log(`prepare-geo: reading ${basename(args.shp)} (${shpBuf.length} bytes) and ${basename(args.dbf)}`);
const attrs = readDbf(dbfBuf);
const idField = "ADM0_A3";
const nameField = "NAME";
const {collection, dropped} = buildEuropeCollection(readShp(shpBuf), attrs, {idField, nameField, simplify});
collection.features.sort((a, b) => a.properties.id.localeCompare(b.properties.id));
const json = JSON.stringify(collection);
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, json + "\n");
const version = args["version-file"] && existsSync(args["version-file"]) ? readFileSync(args["version-file"], "utf8").trim() : null;
const prev = existsSync(sourceOut) ? JSON.parse(readFileSync(sourceOut, "utf8")) : {};
const source = {
  source: "Natural Earth admin-0 countries, Ukraine point of view (ne_10m_admin_0_countries_ukr), 1:10m",
  url: "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/",
  terms_url: "https://www.naturalearthdata.com/about/terms-of-use/",
  licence: "public domain",
  version,
  accessed: args.accessed ?? prev.accessed ?? null,
  input_file: basename(args.shp),
  input_sha256: {shp: sha(shpBuf), dbf: sha(dbfBuf)},
  feature_id_field: idField,
  extent: EUROPE_EXTENT,
  coordinate_decimals: 2,
  simplify_tolerance_degrees: simplify,
  ring_winding: "exterior clockwise (shapefile and d3-geo convention, not RFC 7946)",
  features: collection.features.length,
  asset_bytes: Buffer.byteLength(json) + 1,
  asset_gzip_bytes: gzipSync(json + "\n", {level: 9}).length,
  // Set only by the user after inspecting the asset (plan V52, gate G-CRIMEA); this script never sets it.
  crimea_checked_by_user: prev.crimea_checked_by_user ?? null,
  crimea_checked_date: prev.crimea_checked_date ?? null,
};
writeFileSync(sourceOut, JSON.stringify(source, null, 2) + "\n");
console.log(`prepare-geo: ${source.features} features, ${source.asset_bytes} bytes, ${source.asset_gzip_bytes} gzipped; dropped (outside extent): ${dropped.length}`);
