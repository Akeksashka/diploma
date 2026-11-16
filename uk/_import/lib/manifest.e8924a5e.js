// Manifest loader contract (docs/specs/dashboard-export-spec.md section 3): the front-end refuses an
// unknown major `schema_version`. Pure functions, no imports, testable with `node --test`.
export const SUPPORTED_MAJORS = Object.freeze([1]);

export class ManifestError extends Error {
  constructor(message, kind = "invalid") {
    super(message);
    this.name = "ManifestError";
    this.kind = kind; // "version" for an unknown major, "invalid" otherwise (the state block shows only the kind)
  }
}

export function manifestMajor(schemaVersion) {
  const m = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(String(schemaVersion ?? ""));
  return m ? Number(m[1]) : null;
}

// Validates the fields the shell needs and returns the manifest unchanged. Unknown extra fields are
// allowed (a minor bump adds nullable fields).
export function parseManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new ManifestError("manifest.json is not an object");
  }
  const major = manifestMajor(manifest.schema_version);
  if (major === null) throw new ManifestError(`manifest schema_version is missing or malformed: ${JSON.stringify(manifest.schema_version ?? null)}`);
  if (!SUPPORTED_MAJORS.includes(major)) {
    throw new ManifestError(`Unsupported manifest major version ${major} (supported: ${SUPPORTED_MAJORS.join(", ")}). Rebuild the site with a matching front-end.`, "version");
  }
  if (!Array.isArray(manifest.files)) throw new ManifestError("manifest files list is missing");
  return manifest;
}
