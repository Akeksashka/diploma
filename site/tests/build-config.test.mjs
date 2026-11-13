// V42: per-language build settings, link helper, tree merge (offline, temp dirs). Built-tree checks run when both trees exist.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {langSettings, resolveLang, withBase} from "../scripts/lib/lang-config.mjs";
import {mergeTrees} from "../scripts/merge-trees.mjs";

test("English is the default and keeps today's paths", () => {
  assert.deepEqual(langSettings(undefined), {lang: "en", base: "/", output: "dist"});
  assert.deepEqual(langSettings(""), {lang: "en", base: "/", output: "dist"});
  assert.deepEqual(langSettings("en"), {lang: "en", base: "/", output: "dist"});
});
test("Ukrainian builds under /uk/ into dist-uk", () => {
  assert.deepEqual(langSettings("uk"), {lang: "uk", base: "/uk/", output: "dist-uk"});
});
test("an unknown language fails loudly", () => {
  for (const v of ["de", "UK", "en-GB", "uk "]) assert.throws(() => resolveLang(v), /MM_LANG/);
});
test("withBase prefixes root-relative paths only", () => {
  assert.equal(withBase("/country"), "/country");
  assert.equal(withBase("/", "/uk/"), "/uk/");
  assert.equal(withBase("/country/PL#c=1", "/uk/"), "/uk/country/PL#c=1");
  for (const bad of ["country", "//evil.example/x", "https://x.example/"]) assert.throws(() => withBase(bad, "/uk/"));
});
test("mergeTrees puts the Ukrainian tree under uk/ of a separate out dir, leaves inputs alone, is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "mm-merge-"));
  const en = join(root, "dist"), uk = join(root, "dist-uk"), out = join(root, "dist-site");
  for (const d of [en, uk]) mkdirSync(join(d, "country"), {recursive: true});
  writeFileSync(join(en, "index.html"), "<html>en</html>");
  writeFileSync(join(uk, "index.html"), "<html>uk</html>");
  writeFileSync(join(uk, "country", "a.html"), "<html>a</html>");
  mergeTrees(en, uk, out);
  mergeTrees(en, uk, out);
  assert.equal(readFileSync(join(out, "index.html"), "utf8"), "<html>en</html>");
  assert.equal(readFileSync(join(out, "uk", "index.html"), "utf8"), "<html>uk</html>");
  assert.ok(existsSync(join(out, "uk", "country", "a.html")));
  assert.ok(!existsSync(join(out, "uk", "uk")));
  assert.ok(!existsSync(join(en, "uk")));
});
test("mergeTrees refuses a missing tree or an out dir equal to an input", () => {
  const root = mkdtempSync(join(tmpdir(), "mm-merge-"));
  assert.throws(() => mergeTrees(join(root, "dist"), join(root, "dist-uk"), join(root, "o")), /missing/);
  mkdirSync(join(root, "dist"));
  mkdirSync(join(root, "dist-uk"));
  writeFileSync(join(root, "dist", "index.html"), "<html></html>");
  writeFileSync(join(root, "dist-uk", "index.html"), "<html></html>");
  assert.throws(() => mergeTrees(join(root, "dist"), join(root, "dist-uk"), join(root, "dist")), /differ/);
});
describe("config reads MM_LANG", () => {
  test("observablehq.config.js base and output follow MM_LANG", async () => {
    const prev = process.env.MM_LANG;
    try {
      process.env.MM_LANG = "uk";
      const uk = (await import(`../observablehq.config.js?uk=${Date.now()}`)).default;
      assert.equal(uk.base, "/uk/");
      assert.equal(uk.output, "dist-uk");
      process.env.MM_LANG = "en";
      const en = (await import(`../observablehq.config.js?en=${Date.now()}`)).default;
      assert.equal(en.base, "/");
      assert.equal(en.output, "dist");
    } finally {
      if (prev === undefined) delete process.env.MM_LANG;
      else process.env.MM_LANG = prev;
    }
  });
});
