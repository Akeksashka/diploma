// Copies an export tree (default ../data, or EXPORT_DIR) into src/data (git-ignored).
// The export contract is unchanged by the toolkit; this is the only coupling.
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {firstDomainId, storedPercentileDifferences, storedTransformId} from "../src/lib/indicator-model.js";
import {indicatorPageSource, countryPageSource, domainPageSource, explorerPageSource,revisionsPageSource, homePageSource, domainsPageSource} from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.env.EXPORT_DIR ?? join(here, "..", "..", "data"));
const dst = join(here, "..", "src", "data");
if (!existsSync(join(src, "manifest.json"))) {
  console.error(`prepare-data: no manifest.json in ${src}`);
  process.exit(1);
}
const major = String(JSON.parse(readFileSync(join(src, "manifest.json"), "utf8")).schema_version).split(".")[0];
if (major !== "1") {
  console.error(`prepare-data: unsupported manifest major version ${major}`);
  process.exit(1);
}
rmSync(dst, {recursive: true, force: true});
cpSync(src, dst, {recursive: true});
console.log(`prepare-data: ${src} -> ${dst}`);

// One page per domain of meta/domains.json (a missing or malformed file is an error, not a skip).
const pages = join(here, "..", "src", "domain");
rmSync(pages, {recursive: true, force: true});
mkdirSync(pages, {recursive: true});
// R12: the peers/ pages are gone; remove a stale directory left by an earlier build.
rmSync(join(here, "..", "src", "peers"), {recursive: true, force: true});
if (!existsSync(join(dst, "meta", "groups.json"))) {
  console.error("prepare-data: meta/groups.json is missing");
  process.exit(1);
}
const domains = JSON.parse(readFileSync(join(dst, "meta", "domains.json"), "utf8")).domains;
if (!Array.isArray(domains)) {
  console.error("prepare-data: meta/domains.json has no domains list");
  process.exit(1);
}
for (const d of domains) {
  if (!existsSync(join(dst, "scorecard", `${d.domain_id}.json`))) {
    console.error(`prepare-data: scorecard/${d.domain_id}.json is missing`);
    process.exit(1);
  }
  writeFileSync(join(pages, `${d.domain_id}.md`), domainPageSource(d.domain_id, d.name));
}
console.log(`prepare-data: ${domains.length} domain pages -> ${pages}`);

// The explorer page lists the series files of the manifest (FileAttachment needs literal paths).
writeFileSync(join(here, "..", "src", "explorer.md"), explorerPageSource(JSON.parse(readFileSync(join(dst, "manifest.json"), "utf8"))));
console.log("prepare-data: explorer page written");

// The revisions page lists the revision files of the manifest (FileAttachment needs literal paths).
if (!existsSync(join(dst, "revisions_recent.json"))) {
  console.error("prepare-data: revisions_recent.json is missing");
  process.exit(1);
}
writeFileSync(join(here, "..", "src", "revisions.md"), revisionsPageSource(JSON.parse(readFileSync(join(dst, "manifest.json"), "utf8"))));
console.log("prepare-data: revisions page written");

const countryManifest = JSON.parse(readFileSync(join(dst, "manifest.json"), "utf8"));
const countryGroups = JSON.parse(readFileSync(join(dst, "meta", "groups.json"), "utf8")).groups;
// R6: country pages and R9: indicator pages are real (git-ignored, regenerated every run): one per non-global entity and one per indicator.
const scorecards = Object.fromEntries(domains.map((d) => [d.domain_id, JSON.parse(readFileSync(join(dst, "scorecard", `${d.domain_id}.json`), "utf8"))]));
for (const [dir, kind, file, key, idKey, skip] of [["country", "country", "entities", "entities", "entity_id", (e) => e.is_global], ["indicator", "indicator", "indicators", "indicators", "indicator_id", () => false]]) {
  const out = join(here, "..", "src", dir);
  rmSync(out, {recursive: true, force: true});
  mkdirSync(out, {recursive: true});
  const list = JSON.parse(readFileSync(join(dst, "meta", `${file}.json`), "utf8"))[key];
  if (!Array.isArray(list)) {
    console.error(`prepare-data: meta/${file}.json has no ${key} list`);
    process.exit(1);
  }
  let n = 0;
  for (const e of list) {
    if (skip(e)) continue;
    let source;
    if (kind === "country") source = countryPageSource(e, countryGroups, domains.map((d) => d.domain_id), countryManifest);
    else {
      // AC-RD-24: the page reads the first domain's scorecard; the build fails when another domain stores a different percentile.
      const first = firstDomainId(e);
      if (!scorecards[first]) {
        console.error(`prepare-data: scorecard/${first}.json (first domain of ${e.indicator_id}) is missing`);
        process.exit(1);
      }
      const bad = storedPercentileDifferences(e, scorecards);
      if (bad.length) {
        console.error(`prepare-data: ${e.indicator_id}: stored percentile differs between domains ${bad.map((b) => `${b.entityId} (${b.domains.join("/")}: ${b.percentiles.join("/")})`).join(", ")}`);
        process.exit(1);
      }
      source = indicatorPageSource(e, domains, storedTransformId(scorecards[first], e.indicator_id), countryManifest);
    }
    writeFileSync(join(out, `${e[idKey]}.md`), source);
    n++;
  }
  console.log(`prepare-data: ${n} ${kind} pages -> ${out}`);
}

// R17/R18: the home and domains pages carry static lists built from meta/*.json (git-ignored, regenerated every run).
const metaList = (file, key) => {
  const list = JSON.parse(readFileSync(join(dst, "meta", `${file}.json`), "utf8"))[key];
  if (!Array.isArray(list)) {
    console.error(`prepare-data: meta/${file}.json has no ${key} list`);
    process.exit(1);
  }
  return list;
};
writeFileSync(join(here, "..", "src", "domains.md"), domainsPageSource(domains));
writeFileSync(join(here, "..", "src", "index.md"), homePageSource({entities: metaList("entities", "entities"), indicators: metaList("indicators", "indicators"), domains}));
console.log("prepare-data: home and domains pages written");
