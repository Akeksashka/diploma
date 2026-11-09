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

test("measure-pages: firstLoadSizes counts each URL once, sorts by kind and computes gzip locally", async () => {
  const {firstLoadSizes, gzipBytes} = await import("../scripts/lib.mjs");
  const html = Buffer.from("<html>" + "a".repeat(500) + "</html>");
  const css = Buffer.from("body{color:red}".repeat(50));
  const js = Buffer.from("export const x = 1;".repeat(20));
  const data = Buffer.from(JSON.stringify({rows: [1, 2, 3]}));
  const o = "http://127.0.0.1:1";
  const r = firstLoadSizes([
    {url: `${o}/country/DEU`, body: html},
    {url: `${o}/_observablehq/theme.css`, body: css},
    {url: `${o}/_observablehq/stdlib.js`, body: js},
    {url: `${o}/_file/data/manifest.abc.json`, body: data},
    {url: `${o}/_file/data/manifest.abc.json`, body: data}
  ]);
  assert.equal(r.files, 4);
  assert.equal(r.raw, html.length + css.length + js.length + data.length);
  assert.equal(r.byKind.html, gzipBytes(html));
  assert.equal(r.byKind.data, gzipBytes(data));
  assert.equal(r.css, gzipBytes(css));
  assert.equal(r.gzip, gzipBytes(html) + gzipBytes(css) + gzipBytes(js) + gzipBytes(data));
});

test("measure-pages: evaluateTargets marks PASS/FAIL/N/A and only a hard-limit miss is a breach", async () => {
  const {evaluateTargets, hardBreach} = await import("../scripts/lib.mjs");
  const ok = evaluateTargets({pages: {home: {gzip: 600_000, css: 20_000, cls: 0.1}}, history: {gzip: 5_000_000}});
  assert.ok(ok.every((r) => r.status === "PASS"), "limits are inclusive");
  assert.equal(hardBreach(ok), false);
  const miss = evaluateTargets({pages: {country: {gzip: 700_000, css: 25_000, cls: 0.2}}, history: null});
  const by = Object.fromEntries(miss.map((r) => [r.id, r.status]));
  assert.equal(by["first-load:country"], "FAIL");
  assert.equal(by["limit:country"], "PASS");
  assert.equal(by["css:country"], "FAIL");
  assert.equal(by["cls:country"], "FAIL");
  assert.equal(by.history, "N/A");
  assert.equal(hardBreach(miss), false, "target misses do not fail the run");
  const over = evaluateTargets({pages: {home: {gzip: 1_500_001, css: 1, cls: 0}}, history: null});
  assert.equal(hardBreach(over), true);
});

test("measure-pages: reader and series file are split from the page-own files (AC-RD-53 amendment)", async () => {
  const {evaluateTargets, hardBreach, firstLoadSizes} = await import("../scripts/lib.mjs");
  const body = (n) => Buffer.alloc(n, 7);
  const r = firstLoadSizes([
    {url: "http://x/explorer", body: Buffer.from("<html>explorer</html>")},
    {url: "http://x/_npm/parquet-wasm@0.9.0/esm/a.wasm", body: Buffer.from(Array.from({length: 4000}, (_, i) => (i * 7919) % 251))},
    {url: "http://x/_npm/apache-arrow@21.2.0/a.js", body: body(100)},
    {url: "http://x/_npm/htl@1.0.0/h.js", body: body(100)},
    {url: "http://x/_file/data/series/M09.abc.parquet", body: body(100)},
    {url: "http://x/_file/data/meta/series.json", body: body(100)},
  ]);
  assert.equal(r.own + r.reader, r.gzip);
  assert.ok(r.reader > r.own, "wasm, Arrow and the series file are reader bytes; htl, meta and HTML are page-own");
  const by = (m) => Object.fromEntries(evaluateTargets({pages: {"series (explorer)": m}, history: null}).map((x) => [x.id, x]));
  const ok = by({gzip: 5_300_000, own: 600_000, reader: 4_700_000, css: 1, cls: 0});
  assert.equal(ok["first-load:series (explorer)"].status, "PASS");
  assert.equal(ok["reader:series (explorer)"].status, "PASS");
  assert.equal(hardBreach(Object.values(ok)), false);
  const ownMiss = by({gzip: 2_100_000, own: 700_000, reader: 1_400_000, css: 1, cls: 0});
  assert.equal(ownMiss["first-load:series (explorer)"].status, "FAIL");
  assert.equal(hardBreach(Object.values(ownMiss)), false, "a target miss is not a breach");
  assert.equal(hardBreach(Object.values(by({gzip: 1, own: 1_500_001, reader: 0, css: 1, cls: 0}))), true);
  assert.equal(hardBreach(Object.values(by({gzip: 1, own: 1, reader: 5_000_001, css: 1, cls: 0}))), true);
});

test("measure-pages: formatReport prints status, value, limit and the hard flag", async () => {
  const {evaluateTargets, formatReport} = await import("../scripts/lib.mjs");
  const rows = evaluateTargets({pages: {home: {gzip: 650_000, css: 1000, cls: 0.0123456}}, history: null});
  const text = formatReport(rows, {buildId: "b1", buildSeconds: 12.34, distBytes: 99});
  assert.match(text, /^build_id: b1\nbuild time: 12\.3 s\ndist size: 99 B raw/);
  assert.match(text, /FAIL home first load \(target\): 650000 B gz \(limit 600000 B gz\)\n/);
  assert.match(text, /PASS home first load \(hard limit\): 650000 B gz \(limit 1500000 B gz\) \[hard\]/);
  assert.match(text, /PASS home CLS: 0\.0123 \(limit 0\.1\)/);
  assert.match(text, /N\/A  one history interaction \(country page\): n\/a/);
});
