// prepare-data copies manifest.json and the manifest-listed files only, and refuses unsafe or missing paths.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, symlinkSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {copyExport} from "../scripts/prepare-data.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");

function makeExport(files, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "mm-prep-"));
  const src = join(root, "export");
  const entries = [];
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(src, path)), {recursive: true});
    writeFileSync(join(src, path), body);
    entries.push({path, sha256: sha(body)});
  }
  for (const [path, body] of Object.entries(extra)) {
    mkdirSync(dirname(join(src, path)), {recursive: true});
    writeFileSync(join(src, path), body);
  }
  mkdirSync(src, {recursive: true});
  return {root, src, dst: join(root, "dst"), entries};
}
const writeManifest = (src, files) => writeFileSync(join(src, "manifest.json"), JSON.stringify({schema_version: "1.0", files}));

test("copies manifest.json and listed files only; README.md and status.json stay out", () => {
  const e = makeExport({"meta/a.json": "{}", "scorecard/x.json": "[]"}, {"README.md": "hi", "status.json": "{}", "meta/unlisted.json": "{}"});
  try {
    writeManifest(e.src, e.entries);
    mkdirSync(e.dst, {recursive: true});
    writeFileSync(join(e.dst, "stale.json"), "{}");
    assert.equal(copyExport(e.src, e.dst), 3);
    assert.ok(existsSync(join(e.dst, "manifest.json")));
    assert.ok(existsSync(join(e.dst, "meta", "a.json")));
    assert.ok(existsSync(join(e.dst, "scorecard", "x.json")));
    assert.ok(!existsSync(join(e.dst, "README.md")));
    assert.ok(!existsSync(join(e.dst, "status.json")));
    assert.ok(!existsSync(join(e.dst, "meta", "unlisted.json")));
    assert.ok(!existsSync(join(e.dst, "stale.json")), "stale content removed");
    assert.deepEqual(readdirSync(e.dst).sort(), ["manifest.json", "meta", "scorecard"]);
  } finally {
    rmSync(e.root, {recursive: true, force: true});
  }
});

test("rejects absolute paths and paths containing ..", () => {
  for (const bad of ["/etc/passwd", "../outside.json", "meta/../../x.json", "C:\\x.json"]) {
    const e = makeExport({"meta/a.json": "{}"});
    try {
      writeManifest(e.src, [...e.entries, {path: bad}]);
      assert.throws(() => copyExport(e.src, e.dst), /not a safe relative path/, bad);
      assert.ok(!existsSync(e.dst), "nothing copied on rejection");
    } finally {
      rmSync(e.root, {recursive: true, force: true});
    }
  }
});

test("fails clearly when a listed file is missing or its sha256 differs", () => {
  const e = makeExport({"meta/a.json": "{}"});
  try {
    writeManifest(e.src, [...e.entries, {path: "meta/gone.json"}]);
    assert.throws(() => copyExport(e.src, e.dst), /meta\/gone\.json but it is missing/);
    writeManifest(e.src, [{path: "meta/a.json", sha256: "0".repeat(64)}]);
    assert.throws(() => copyExport(e.src, e.dst), /sha256/);
  } finally {
    rmSync(e.root, {recursive: true, force: true});
  }
});

test("requires a sha256 for every listed file", () => {
  const e = makeExport({"meta/a.json": "{}"});
  try {
    for (const bad of [undefined, "", 5]) {
      writeManifest(e.src, [{path: "meta/a.json", sha256: bad}]);
      assert.throws(() => copyExport(e.src, e.dst), /no sha256/, String(bad));
    }
    assert.ok(!existsSync(e.dst));
  } finally {
    rmSync(e.root, {recursive: true, force: true});
  }
});

test("rejects a listed symlink (to a file inside or outside the export)", () => {
  const e = makeExport({"meta/a.json": "{}"}, {"../outside.json": "{}"});
  try {
    symlinkSync(join(e.src, "meta", "a.json"), join(e.src, "meta", "inside.json"));
    symlinkSync(join(e.root, "outside.json"), join(e.src, "meta", "out.json"));
    for (const p of ["meta/inside.json", "meta/out.json"]) {
      writeManifest(e.src, [{path: p, sha256: sha("{}")}]);
      assert.throws(() => copyExport(e.src, e.dst), /symlink/, p);
    }
    // a listed file under a symlinked directory resolves outside the export
    symlinkSync(e.root, join(e.src, "linkdir"));
    writeManifest(e.src, [{path: "linkdir/outside.json", sha256: sha("{}")}]);
    assert.throws(() => copyExport(e.src, e.dst), /outside the export/);
    assert.ok(!existsSync(e.dst));
  } finally {
    rmSync(e.root, {recursive: true, force: true});
  }
});

test("a listed directory is rejected before dst is cleared", () => {
  const e = makeExport({"meta/a.json": "{}"});
  try {
    mkdirSync(join(e.src, "meta", "subdir"));
    writeManifest(e.src, [{path: "meta/subdir", sha256: sha("")}]);
    mkdirSync(e.dst, {recursive: true});
    writeFileSync(join(e.dst, "keep.json"), "{}");
    assert.throws(() => copyExport(e.src, e.dst), /not a regular file/);
    assert.ok(existsSync(join(e.dst, "keep.json")), "dst untouched");
  } finally {
    rmSync(e.root, {recursive: true, force: true});
  }
});
