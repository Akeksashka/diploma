// V44 (AC-V2-102, 106, 108): writes i18n-report.json for the Ukrainian tree: every UI string that renders as English because its Ukrainian entry is not
// `reviewed` (or is missing), and every domain, indicator, entity and source of the export that lacks a reviewed Ukrainian name. Reads the dictionaries and
// the export meta copied by prepare-data (src/data/meta); computes nothing about data. Usage: node scripts/i18n-report.mjs [out.json] [meta-dir].
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const isReviewed = (e) => e?.status === "reviewed" && typeof e.t === "string" && e.t !== "";

// Stable ids of the export that need a Ukrainian name, per names section (sources by source_id, the key of names.uk.json).
export function exportNameKeys(metaDir) {
  const list = (file, key, id) => readJson(join(metaDir, file))[key].map((r) => r[id]);
  return {
    domains: list("domains.json", "domains", "domain_id"),
    indicators: list("indicators.json", "indicators", "indicator_id"),
    entities: list("entities.json", "entities", "entity_id"),
    sources: [...new Set(readJson(join(metaDir, "series.json")).series.map((s) => s.source_id).filter(Boolean))]
  };
}

export function buildReport({en, uk, names, keys}) {
  const fallbacks = [];
  for (const key of Object.keys(en)) if (!isReviewed(uk[key])) fallbacks.push({kind: "ui", key, reason: uk[key] ? "not_reviewed" : "missing"});
  const missing = {};
  for (const section of Object.keys(keys)) {
    missing[section] = [];
    for (const id of keys[section]) {
      const e = names[section]?.[id];
      if (!isReviewed(e)) {
        missing[section].push({id, reason: e ? "not_reviewed" : "missing"});
        fallbacks.push({kind: `name:${section}`, key: id, reason: e ? "not_reviewed" : "missing"});
      }
    }
  }
  return {
    language: "uk",
    summary: {
      ui_total: Object.keys(en).length,
      ui_fallbacks: fallbacks.filter((f) => f.kind === "ui").length,
      names_missing: Object.fromEntries(Object.entries(missing).map(([k, v]) => [k, v.length]))
    },
    fallbacks,
    missing_names: missing
  };
}

export function writeReport(out, metaDir) {
  const src = join(here, "..", "src", "i18n");
  const report = buildReport({en: readJson(join(src, "en.json")), uk: readJson(join(src, "uk.json")), names: readJson(join(src, "names.uk.json")), keys: exportNameKeys(metaDir)});
  mkdirSync(dirname(resolve(out)), {recursive: true});
  writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out = join(here, "..", "dist-uk", "i18n-report.json"), metaDir = join(here, "..", "src", "data", "meta")] = process.argv.slice(2);
  if (!existsSync(metaDir)) {
    console.error(`i18n-report: ${metaDir} is missing: run prepare-data first`);
    process.exit(1);
  }
  const r = writeReport(out, metaDir);
  console.log(`i18n-report: ${out} (${r.summary.ui_fallbacks}/${r.summary.ui_total} UI strings fall back to English; missing names ${JSON.stringify(r.summary.names_missing)})`);
}
