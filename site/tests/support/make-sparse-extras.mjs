// Deterministic generator of the SYNTHETIC files that make tests/fixtures/sparse_export a complete export
// (manifest.json, meta/groups.json, alerts.json, revisions_recent.json, status.json), so the site can be built from it directly:
//   EXPORT_DIR=tests/fixtures/sparse_export node scripts/prepare-data.mjs
// The manifest lists the files that exist in the directory with their real size and sha256; no series files (the T.. indicators
// have no history). Nothing here is a measurement. Run `node tests/support/make-sparse-extras.mjs` to rewrite the files.
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

export const SPARSE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sparse_export");
const FIXED = {generated_at: "2026-11-03T00:05:00Z", known_cutoff: "2026-11-03T00:00:00Z"};
const json = (o) => JSON.stringify(o, null, 2) + "\n";
const load = (p) => JSON.parse(readFileSync(join(SPARSE_DIR, p), "utf8"));

// Files that are not derived from the others: path -> text.
export function baseExtras() {
  const entities = load("meta/entities.json").entities;
  const countries = entities.filter((e) => e.kind === "country").map((e) => e.entity_id);
  const member = (entity_id) => ({entity_id, valid_from: "1991-01-01", valid_to: null});
  return {
    "meta/groups.json": json({schema_version: "1.0", groups: [{group_id: "synthetic_a", name: "synthetic_a", members: countries.slice(0, 3).map(member)}, {group_id: "synthetic_b", name: "synthetic_b", members: countries.slice(3, 10).map(member)}]}),
    "alerts.json": json({schema_version: "1.0", analysis_run_id: 0, alerts: []}),
    "revisions_recent.json": json({schema_version: "1.0", known_cutoff: FIXED.known_cutoff, edition_summaries: [], revisions: []}),
    "status.json": json({
      schema_version: "1.0",
      backlog: {n_unloaded: 0, oldest_age_days: null},
      groups: [],
      last_run: {alerts_opened: 0, finished_at: FIXED.known_cutoff, ingest_run_id: 0, mode: "refresh", new_observations: 0, new_raw_objects: 0, revisions: 0, started_at: FIXED.known_cutoff},
      manual_sources: [],
      schedule_check: {generated_at: FIXED.generated_at, text: "Synthetic fixture; no schedule."},
      validation: {counts: [], cov01: [], open_drift: {by_kind: {}, n_open: 0}}
    })
  };
}

const ROWS = {
  "meta/domains.json": (o) => o.domains.length,
  "meta/entities.json": (o) => o.entities.length,
  "meta/groups.json": (o) => o.groups.length,
  "meta/indicators.json": (o) => o.indicators.length,
  "meta/series.json": (o) => o.series.length
};

export function manifestText(text) {
  const paths = ["alerts.json", "meta/domains.json", "meta/entities.json", "meta/groups.json", "meta/indicators.json", "meta/series.json", "revisions_recent.json", "scorecard/agri.json", "scorecard/fin.json", "scorecard/growth.json", "status.json"];
  const files = paths.map((path) => {
    const t = text(path);
    const o = JSON.parse(t);
    const rows = path.startsWith("scorecard/") ? o.entities.length : ROWS[path] ? ROWS[path](o) : null;
    return {bytes: Buffer.byteLength(t), format: "json", path, rows, sha256: createHash("sha256").update(t).digest("hex")};
  });
  return json({
    analysis_run_id: 0,
    build_id: "synthetic-sparse-fixture",
    code_version: "0.0.0",
    files,
    generated_at: FIXED.generated_at,
    history_start: "1991-01-01",
    ingest_run_id: 0,
    known_cutoff: FIXED.known_cutoff,
    schema_version: "1.0",
    totals: {bytes: files.reduce((n, f) => n + f.bytes, 0), files: files.length}
  });
}

// Everything the generator owns: path -> text (the manifest is computed over the on-disk files plus the extras).
export function allExtras() {
  const extras = baseExtras();
  const text = (p) => extras[p] ?? readFileSync(join(SPARSE_DIR, p), "utf8");
  return {...extras, "manifest.json": manifestText(text)};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [p, t] of Object.entries(allExtras())) writeFileSync(join(SPARSE_DIR, p), t);
  console.log("make-sparse-extras: wrote manifest.json, meta/groups.json, alerts.json, revisions_recent.json, status.json");
}
