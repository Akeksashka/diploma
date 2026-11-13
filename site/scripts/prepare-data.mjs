// Copies the manifest-listed files of an export tree (default ../data, or EXPORT_DIR) into src/data (git-ignored).
// The export contract is unchanged by the toolkit; this is the only coupling.
import {copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {dirname, isAbsolute, join, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {firstDomainId, indicatorsWithoutDomain, storedPercentileDifferences, storedTransformId} from "../src/lib/indicator-model.js";
import {indicatorPageSource, countryPageSource, domainPageSource, explorerPageSource,revisionsPageSource, homePageSource, domainsPageSource, countryListPageSource, comparePageSource} from "./lib.mjs";

// Copies manifest.json plus every manifest.files[].path from the export into dst (after clearing dst); nothing else
// (a README or status.json in the export dir would become a page). Throws on an unsafe path, a missing file or a sha256 mismatch.
export function copyExport(src, dst) {
  const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest.files)) throw new Error("manifest.json has no files list");
  const listed = [];
  for (const f of manifest.files) {
    const p = f?.path;
    if (typeof p !== "string" || p === "" || isAbsolute(p) || p.startsWith("/") || p.includes("\\") || p.includes("..")) {
      throw new Error(`manifest file path is not a safe relative path: ${JSON.stringify(p)}`);
    }
    const full = join(src, p);
    if (!existsSync(full)) throw new Error(`manifest lists ${p} but it is missing from ${src}`);
    if (lstatSync(full).isSymbolicLink()) throw new Error(`${p}: a symlink is not allowed`);
    if (!realpathSync(full).startsWith(realpathSync(src) + sep)) throw new Error(`${p}: resolves outside the export`);
    if (!statSync(full).isFile()) throw new Error(`${p}: not a regular file`);
    if (typeof f.sha256 !== "string" || f.sha256 === "") throw new Error(`${p}: manifest entry has no sha256`);
    const got = createHash("sha256").update(readFileSync(full)).digest("hex");
    if (got !== f.sha256) throw new Error(`${p}: sha256 ${got} differs from the manifest ${f.sha256}`);
    listed.push(p);
  }
  rmSync(dst, {recursive: true, force: true});
  mkdirSync(dst, {recursive: true});
  for (const p of ["manifest.json", ...listed]) {
    mkdirSync(dirname(join(dst, p)), {recursive: true});
    copyFileSync(join(src, p), join(dst, p));
  }
  return listed.length + 1;
}

const here = dirname(fileURLToPath(import.meta.url));
function main() {
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
try {
  const n = copyExport(src, dst);
  console.log(`prepare-data: ${src} -> ${dst} (${n} files)`);
} catch (e) {
  console.error(`prepare-data: ${e.message}`);
  process.exit(1);
}

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
  if (kind === "indicator") {
    // AC-RD-01: one page per indicator, no exceptions; an indicator without a domain has no scorecard (export spec section 4).
    const none = indicatorsWithoutDomain(list);
    if (none.length) {
      for (const id of none) console.error(`prepare-data: indicator ${id} has no domain_ids`);
      process.exit(1);
    }
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
writeFileSync(join(here, "..", "src", "index.md"), homePageSource({entities: metaList("entities", "entities"), indicators: metaList("indicators", "indicators"), domains, manifest: JSON.parse(readFileSync(join(dst, "manifest.json"), "utf8"))}));
console.log("prepare-data: home and domains pages written");

// V64 / V8: the country list page (/country) and the Compare page (/compare); git-ignored, regenerated every run.
writeFileSync(join(here, "..", "src", "country.md"), countryListPageSource(metaList("entities", "entities")));
writeFileSync(join(here, "..", "src", "compare.md"), comparePageSource(countryManifest, domains.map((d) => d.domain_id)));
console.log("prepare-data: country list and compare pages written");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
