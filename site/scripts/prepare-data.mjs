// Copies an export tree (default ../data, or EXPORT_DIR) into src/data (git-ignored).
// The export contract is unchanged by the toolkit; this is the only coupling.
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {domainPageSource, explorerPageSource, peersPageSource, revisionsPageSource} from "./lib.mjs";

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
const peerPages = join(here, "..", "src", "peers");
rmSync(peerPages, {recursive: true, force: true});
mkdirSync(peerPages, {recursive: true});
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
  writeFileSync(join(peerPages, `${d.domain_id}.md`), peersPageSource(d.domain_id, d.name));
}
console.log(`prepare-data: ${domains.length} domain pages -> ${pages}, peer pages -> ${peerPages}`);

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
