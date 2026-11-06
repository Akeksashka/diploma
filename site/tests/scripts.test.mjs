import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {auditGate, diffLock, formatLock, landingSet, npmImportsManifest, parseLock, shippedPackages, sumGzip} from "../scripts/lib.mjs";

function fakeDist() {
  const d = mkdtempSync(join(tmpdir(), "mm-dist-"));
  for (const p of ["_npm/htl@1.0.0", "_node/@observablehq/plot@0.6.18", "_node/d3@7.9.2", "_observablehq", "_file/data"]) mkdirSync(join(d, p), {recursive: true});
  writeFileSync(join(d, "_npm/htl@1.0.0/a.js"), "export const html = 1;\n");
  writeFileSync(join(d, "_node/@observablehq/plot@0.6.18/index.js"), 'import "../../d3@7.9.2/index.js";\nexport const x = 1;\n');
  writeFileSync(join(d, "_node/d3@7.9.2/index.js"), "export const y = 2;\n");
  writeFileSync(join(d, "_observablehq/client.js"), 'import {a} from "./rt.js";\n');
  writeFileSync(join(d, "_observablehq/rt.js"), "export const a = 1;\n");
  writeFileSync(join(d, "_observablehq/lazy.js"), "export const z = 1;\n");
  writeFileSync(join(d, "_file/data/manifest.json"), '{"a":1}');
  writeFileSync(
    join(d, "index.html"),
    '<link rel="modulepreload" href="./_observablehq/client.js"><link rel="modulepreload" href="./_node/@observablehq/plot@0.6.18/index.js"><script>registerFile("data/manifest.json", {path: "./_file/data/manifest.json"}); import("./_observablehq/lazy.js")</script>'
  );
  return d;
}

test("landing set follows preloads, static imports and data files, not dynamic import()", () => {
  const set = landingSet(fakeDist());
  const paths = set.map((e) => e.path);
  assert.deepEqual(paths, [
    "_file/data/manifest.json",
    "_node/@observablehq/plot@0.6.18/index.js",
    "_node/d3@7.9.2/index.js",
    "_observablehq/client.js",
    "_observablehq/rt.js",
    "index.html"
  ]);
  assert.ok(sumGzip(set) > 0);
});

test("npm-imports lock: round trip, drift is reported", () => {
  const d = fakeDist();
  const entries = npmImportsManifest(d);
  assert.equal(entries.length, 1);
  const lock = parseLock(formatLock(entries));
  assert.deepEqual(diffLock(lock, entries), []);
  writeFileSync(join(d, "_npm/htl@1.0.0/a.js"), "export const html = 2;\n");
  writeFileSync(join(d, "_npm/htl@1.0.0/b.js"), "x\n");
  const diffs = diffLock(lock, npmImportsManifest(d));
  assert.deepEqual(diffs, ["hash differs: htl@1.0.0/a.js", "not in lock: htl@1.0.0/b.js"]);
  assert.deepEqual(diffLock([...lock, {path: "gone.js", sha256: "0", bytes: 0}], entries), ["in lock but not built: gone.js"]);
  assert.throws(() => parseLock("garbage\n"));
});

test("audit gate (stubbed report): fails only on high/critical in shipped packages", () => {
  const shipped = shippedPackages(fakeDist());
  assert.ok(shipped.has("htl") && shipped.has("d3") && shipped.has("@observablehq/plot"));
  const mk = (name, severity) => ({vulnerabilities: {[name]: {severity}}, metadata: {vulnerabilities: {[severity]: 1}}});
  assert.equal(auditGate(mk("d3", "high"), shipped).fail, true);
  assert.equal(auditGate(mk("@observablehq/plot", "critical"), shipped).fail, true);
  const buildOnly = auditGate(mk("rollup", "critical"), shipped);
  assert.equal(buildOnly.fail, false);
  assert.deepEqual(buildOnly.buildOnlyHigh, ["rollup (critical)"]);
  assert.equal(auditGate(mk("d3", "moderate"), shipped).fail, false);
  assert.equal(auditGate({}, shipped).fail, false);
});

test("landing set follows ../ references of a page in a subdirectory", () => {
  const d = fakeDist();
  mkdirSync(join(d, "domain"), {recursive: true});
  writeFileSync(join(d, "domain/x.html"), '<link rel="modulepreload" href="../_observablehq/client.js"><script>registerFile("../data/m.json", {path: "../_file/data/manifest.json"})</script>');
  const paths = landingSet(d, "domain/x.html").map((e) => e.path);
  assert.deepEqual(paths, ["_file/data/manifest.json", "_observablehq/client.js", "_observablehq/rt.js", "domain/x.html"]);
});

test("interactionBudget sums the Parquet reader libraries and the largest series file", async () => {
  const {interactionBudget} = await import("../scripts/lib.mjs");
  const d = mkdtempSync(join(tmpdir(), "mm-int-"));
  for (const p of ["_npm/parquet-wasm@0.9.0", "_npm/apache-arrow@21.2.0", "_npm/htl@1.0.0", "_file/data/series"]) mkdirSync(join(d, p), {recursive: true});
  writeFileSync(join(d, "_npm/parquet-wasm@0.9.0/a.wasm"), "x".repeat(1000));
  writeFileSync(join(d, "_npm/apache-arrow@21.2.0/a.js"), "y".repeat(500));
  writeFileSync(join(d, "_npm/htl@1.0.0/h.js"), "z".repeat(9999));
  writeFileSync(join(d, "_file/data/series/A.1.parquet"), "p".repeat(300));
  writeFileSync(join(d, "_file/data/series/B.2.parquet"), "q".repeat(700));
  const b = interactionBudget(d);
  assert.equal(b.libs.files, 2);
  assert.equal(b.libs.raw, 1500);
  assert.equal(b.largest.path, "_file/data/series/B.2.parquet");
  assert.equal(b.firstInteraction.raw, 2200);
  assert.equal(b.laterInteraction.raw, 700);
  assert.deepEqual(interactionBudget(join(d, "missing")).firstInteraction, {raw: 0, gzip: 0});
});

test("landing set does not count lazily read Parquet files; the interaction budget does", async () => {
  const {interactionBudget} = await import("../scripts/lib.mjs");
  const d = fakeDist();
  mkdirSync(join(d, "_file/data/revisions"), {recursive: true});
  mkdirSync(join(d, "_file/data/series"), {recursive: true});
  writeFileSync(join(d, "_file/data/revisions/M09.1.parquet"), "r".repeat(900));
  writeFileSync(join(d, "_file/data/series/M09.2.parquet"), "s".repeat(100));
  writeFileSync(join(d, "rev.html"), '<script>registerFile("data/revisions/M09.parquet", {path: "./_file/data/revisions/M09.1.parquet"}); registerFile("data/m.json", {path: "./_file/data/manifest.json"})</script>');
  const paths = landingSet(d, "rev.html").map((e) => e.path);
  assert.deepEqual(paths, ["_file/data/manifest.json", "rev.html"]);
  const b = interactionBudget(d);
  assert.equal(b.largest.path, "_file/data/revisions/M09.1.parquet");
  assert.equal(b.laterInteraction.raw, 900);
});
