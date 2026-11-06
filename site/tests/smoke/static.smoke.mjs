// T94, no browser needed: AC-DASH-2 (sizes), AC-DASH-8 (no secret pattern in the site output, the
// EXP-07 scanner idea) and the file part of AC-SYS-10 (build id). Runs on a built dist/ (fixture or real).
import assert from "node:assert/strict";
import {existsSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {CSS_LIMIT_BYTES, INTERACTION_LIMIT_BYTES, LANDING_LIMIT_BYTES, LANDING_TARGET_BYTES, interactionBudget, landingBudget, landingSet, sumGzip, walk} from "../../scripts/lib.mjs";
import {FONT_FILE, distFindings} from "../support/static-scan.mjs";
import {DIST, builtManifestPath, distBuilt, scanSecrets} from "./support.mjs";

const SKIP = distBuilt() ? false : `no built site at ${DIST} (run npm run build with a fixture export first)`;
const SITE_LIMIT_BYTES = 300_000_000; // export spec section 8: whole built site

test("AC-DASH-2: every page's first load is within 1.5 MB gzip -9", {skip: SKIP}, () => {
  const pages = walk(DIST)
    .map((p) => p.slice(DIST.length + 1))
    .filter((p) => p.endsWith(".html") && !p.startsWith("_"));
  assert.ok(pages.length >= 10, `expected the V1-V5 pages, found ${pages.length}`);
  for (const page of pages) {
    const total = sumGzip(landingSet(DIST, page));
    assert.ok(total > 0 && total <= LANDING_LIMIT_BYTES, `${page}: ${total} bytes gzipped (limit ${LANDING_LIMIT_BYTES})`);
  }
});

test("AC-DASH-2: the first explorer interaction is within 5 MB and the whole site within 300 MB", {skip: SKIP}, () => {
  const b = interactionBudget(DIST);
  assert.ok(b.firstInteraction.gzip <= INTERACTION_LIMIT_BYTES, `first interaction ${b.firstInteraction.gzip} gz`);
  const total = walk(DIST).reduce((n, p) => n + statSync(p).size, 0);
  assert.ok(total <= SITE_LIMIT_BYTES, `site is ${total} bytes`);
});

test("AC-DASH-8 / EXP-07: no DB credential or secret pattern anywhere in the site output", {skip: SKIP}, () => {
  const hits = [];
  let n = 0;
  for (const p of walk(DIST)) {
    n += 1;
    const names = scanSecrets(readFileSync(p).toString("latin1"));
    if (names.length) hits.push(`${p.slice(DIST.length + 1)}: ${names.join(", ")}`); // names only, never the match
  }
  assert.ok(n > 20, `scanned only ${n} files`);
  assert.deepEqual(hits, []);
  // The scanner must catch what it claims to (synthetic strings built here, not real credentials).
  assert.deepEqual(scanSecrets("postgres" + "ql://u:p@h/db"), ["connection URL", "URL with credentials"]);
  assert.deepEqual(scanSecrets("Authorization: Bearer " + "a".repeat(20)), ["bearer token"]);
  assert.deepEqual(scanSecrets("x ghp_" + "A".repeat(24)), ["GitHub token"]);
});

test("AC-DASH-8: the exported data files hold no database or secret reference", {skip: SKIP}, () => {
  const bad = [];
  for (const p of walk(join(DIST, "_file", "data")).filter((f) => f.endsWith(".json"))) {
    if (/DATABASE_URL|NEON_URL|MM_TEST_DATABASE_URL/.test(readFileSync(p, "utf8"))) bad.push(p);
  }
  assert.deepEqual(bad, []);
});

test("AC-SYS-10 (file part): the deployed manifest build_id is the build id of the run", {skip: SKIP}, () => {
  const mp = builtManifestPath();
  assert.ok(mp, "no manifest in dist/_file/data");
  const built = JSON.parse(readFileSync(mp, "utf8"));
  assert.match(String(built.build_id), /^\S+$/);
  const exportDir = process.env.EXPORT_DIR;
  const expected = process.env.MM_EXPECT_BUILD_ID ?? (exportDir && existsSync(join(exportDir, "manifest.json")) ? JSON.parse(readFileSync(join(exportDir, "manifest.json"), "utf8")).build_id : undefined);
  assert.ok(expected, "set MM_EXPECT_BUILD_ID or EXPORT_DIR (the export of this run) so the build id can be compared");
  assert.equal(built.build_id, expected);
});

test("T104: every built page has the static shell (skip link first, header/nav/main/footer, one h1)", {skip: SKIP}, () => {
  const pages = walk(DIST)
    .map((p) => p.slice(DIST.length + 1))
    .filter((p) => p.endsWith(".html") && !p.startsWith("_"));
  assert.ok(pages.length >= 10, `expected the V1-V5 pages, found ${pages.length}`);
  for (const page of pages) {
    const html = readFileSync(join(DIST, page), "utf8");
    const body = html.slice(html.indexOf("<body"));
    const at = (re) => body.search(re);
    assert.equal((body.match(/<h1[\s>]/g) ?? []).length, 1, `${page}: h1 count`);
    assert.equal((body.match(/<main[\s>]/g) ?? []).length, 1, `${page}: main count`);
    assert.ok(at(/<a class="mm-skip"/) >= 0, `${page}: skip link missing`);
    assert.equal(body.search(/<a [^>]*href/), at(/<a class="mm-skip"/), `${page}: skip link is not the first link`);
    const order = [/<header[\s>]/, /<nav[\s>]/, /<main[\s>]/, /<footer[\s>]/].map(at);
    assert.ok(order.every((n) => n >= 0) && order.every((n, i) => i === 0 || n > order[i - 1]), `${page}: landmark order ${order}`);
    assert.equal((body.match(/<nav[\s>]/g) ?? []).length, 1, `${page}: exactly one nav (no Framework chrome duplicate)`);
  }
});

test("AC-UX-11: dist has no URL outside the allowed namespaces, no remote @import, no @font-face and no font file", {skip: SKIP}, () => {
  const hits = [];
  let n = 0;
  let css = 0;
  for (const p of walk(DIST)) {
    const name = p.slice(DIST.length + 1);
    if (FONT_FILE(name)) hits.push(`${name}: font file`);
    // Exported data files and binaries are not code or style; their source URLs are attribution text (AC-DASH-8 covers secrets).
    if (name.startsWith("_file/") || /\.(parquet|wasm|png|ico)$/.test(name)) continue;
    n += 1;
    if (name.endsWith(".css")) css += 1;
    for (const f of distFindings(name, readFileSync(p, "utf8"))) hits.push(`${name}: ${f}`);
  }
  assert.ok(n > 20 && css >= 1, `scanned ${n} files, ${css} stylesheets`);
  assert.deepEqual(hits, []);
});

test("AC-UX-12: per page, CSS within 20 KB gzip and the landing set within 600 KB (target) and 1.5 MB (limit)", {skip: SKIP}, (t) => {
  const pages = walk(DIST)
    .map((p) => p.slice(DIST.length + 1))
    .filter((p) => p.endsWith(".html") && !p.startsWith("_"));
  assert.ok(pages.length >= 10, `expected the V1-V5 pages, found ${pages.length}`);
  let maxCss = 0;
  let maxTotal = 0;
  for (const page of pages) {
    const b = landingBudget(landingSet(DIST, page));
    maxCss = Math.max(maxCss, b.cssGzip);
    maxTotal = Math.max(maxTotal, b.totalGzip);
    assert.ok(b.cssOk, `${page}: css ${b.cssGzip} B gz in ${b.cssFiles} file(s) (limit ${CSS_LIMIT_BYTES}, at least one required)`);
    assert.ok(b.targetOk, `${page}: landing set ${b.totalGzip} B gz over the ${LANDING_TARGET_BYTES} B internal target`);
    assert.ok(b.limitOk, `${page}: landing set ${b.totalGzip} B gz over the ${LANDING_LIMIT_BYTES} B limit`);
  }
  t.diagnostic(`largest css ${maxCss} B gz (limit ${CSS_LIMIT_BYTES}); largest landing set ${maxTotal} B gz (target ${LANDING_TARGET_BYTES}, limit ${LANDING_LIMIT_BYTES})`);
});
