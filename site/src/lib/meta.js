// meta/*.json files are objects {schema_version, <key>: [...]} (docs/specs/dashboard-export-spec.md
// section 4). `listOf` checks the major version and returns the list; no imports.
import {SUPPORTED_MAJORS, manifestMajor} from "./manifest.js";

export function listOf(doc, key) {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`meta file is not an object (expected key "${key}")`);
  const major = manifestMajor(doc.schema_version);
  if (major === null || !SUPPORTED_MAJORS.includes(major)) throw new Error(`meta file has an unsupported schema_version: ${JSON.stringify(doc.schema_version ?? null)}`);
  if (!Array.isArray(doc[key])) throw new Error(`meta file has no "${key}" list`);
  return doc[key];
}
