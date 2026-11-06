import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {checkPairs, contrastRatio, meets, parseHex, parseTokenBlocks, relativeLuminance, resolveThemes} from "../scripts/lib/contrast.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => join(here, "fixtures", "contrast", n);
const run = (css) =>
  spawnSync(process.execPath, [join(here, "..", "scripts", "check-contrast.mjs"), "--css", css, "--pairs", fx("pairs.mjs")], {encoding: "utf8"});

test("reference ratios: black/white 21, #767676 on white about 4.54, symmetric", () => {
  assert.equal(relativeLuminance("#ffffff"), 1);
  assert.equal(relativeLuminance("#000"), 0);
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio("#ffffff", "#000000") - 21) < 1e-9);
  const r = contrastRatio("#767676", "#ffffff");
  assert.ok(r > 4.54 && r < 4.55);
  assert.deepEqual(parseHex("#abc"), [0xaa, 0xbb, 0xcc]);
});

test("thresholds use unrounded ratios: 4.499 fails 4.5, 4.5 passes", () => {
  assert.equal(meets(4.499, 4.5), false);
  assert.equal(meets(4.4999999, 4.5), false);
  assert.equal(meets(4.5, 4.5), true);
  // #777777 on white is 4.478 (would not round up to 4.5); #767676 is 4.542 and fails a 4.543 limit.
  assert.equal(meets(contrastRatio("#777777", "#fff"), 4.5), false);
  assert.equal(meets(contrastRatio("#767676", "#fff"), 4.543), false);
});

test("invalid colours throw", () => {
  for (const v of ["rgb(0,0,0)", "red", "#12345", "#11223344", "color-mix(in srgb, #000, #fff)", "var(--x)"]) {
    assert.throws(() => parseHex(v), /not a flat hex/);
  }
});

test("parser: light block, dark overrides, comments, non-colour tokens", () => {
  const css = readFileSync(fx("good.css"), "utf8");
  const blocks = parseTokenBlocks(css);
  assert.equal(blocks.light["--mm-bg"], "#ffffff");
  assert.deepEqual(Object.keys(blocks.dark).sort(), ["--mm-bg", "--mm-border", "--mm-text"]);
  const themes = resolveThemes(css, ["--mm-space-"]);
  assert.equal(themes.light["--mm-text"], "#111");
  assert.equal(themes.dark["--mm-bg"], "#121212");
  assert.ok(!("--mm-space-1" in themes.light));
  assert.throws(() => resolveThemes(css, []), /--mm-space-1.*not a flat hex/);
});

test("parser: other rules ignored, but hidden or unsupported --mm- declarations and bad values fail loudly", () => {
  assert.deepEqual(parseTokenBlocks("a { color: red } @import url(x); :root { --mm-a: #fff; }").light, {"--mm-a": "#fff"});
  assert.throws(() => parseTokenBlocks(':root[data-theme="dark"] { --mm-a: #000; }'), /unsupported rule/);
  assert.throws(() => parseTokenBlocks("@media print { :root { --mm-a: #000; } }"), /unsupported rule|nested/);
  assert.deepEqual(parseTokenBlocks(":root { --mm-a: #fff; } @media screen and (prefers-color-scheme: dark) { :root { --mm-a: #000; } }").dark, {"--mm-a": "#000"}); // T130: print keeps light
  assert.throws(() => parseTokenBlocks(":root { --mm-a: #000; --mm-a: #111; }"), /duplicate/);
  assert.throws(() => parseTokenBlocks(":root { --mm-a: #000;"), /unbalanced/);
  assert.throws(() => resolveThemes(":root { --mm-a: rgb(0 0 0); }"), /not a flat hex/);
  assert.throws(() => resolveThemes(":root { --mm-a: #000; } @media (prefers-color-scheme: dark) { :root { --mm-b: #fff; } }"), /no light-theme declaration/);
});

test("pair checker: pass, fail, undeclared token, missing token", () => {
  const pairs = [{fg: "--mm-text", bg: "--mm-bg", min: 4.5, kind: "text"}];
  const ok = checkPairs({light: {"--mm-text": "#000000", "--mm-bg": "#ffffff"}, dark: {"--mm-text": "#fff", "--mm-bg": "#000"}}, pairs);
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.results.every((r) => r.ok));
  const bad = checkPairs({light: {"--mm-text": "#777777", "--mm-bg": "#ffffff"}, dark: {"--mm-text": "#fff", "--mm-bg": "#000"}}, pairs);
  assert.equal(bad.results.filter((r) => !r.ok).length, 1);
  const extra = checkPairs({light: {"--mm-text": "#000", "--mm-bg": "#fff", "--mm-new": "#f00"}, dark: {}}, pairs);
  assert.ok(extra.errors.some((e) => /--mm-new has no declared contrast pair/.test(e)));
  const missing = checkPairs({light: {"--mm-text": "#000"}, dark: {"--mm-text": "#000"}}, pairs);
  assert.ok(missing.errors.some((e) => /undeclared token/.test(e)));
});

test("CLI: good fixture exits 0, failing pair, undeclared token, color-mix and absent file exit non-zero", () => {
  const good = run(fx("good.css"));
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /4 pair checks passed/);
  const bad = run(fx("bad-pair.css"));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL light --mm-border on --mm-bg/);
  const undeclared = run(fx("undeclared.css"));
  assert.equal(undeclared.status, 1);
  assert.match(undeclared.stderr, /--mm-extra has no declared contrast pair/);
  const mix = run(fx("color-mix.css"));
  assert.equal(mix.status, 1);
  assert.match(mix.stderr, /not a flat hex/);
  const absent = run(fx("nope.css"));
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /does not exist yet/);
});

test("default pair table is well formed", async () => {
  const {PAIRS} = await import("../scripts/contrast-pairs.mjs");
  assert.ok(PAIRS.length > 20);
  for (const p of PAIRS) {
    assert.match(p.fg, /^--mm-/);
    assert.match(p.bg, /^--mm-/);
    assert.ok(p.min === 4.5 || p.min === 3);
  }
});

// T101: the real repository tokens.
const REAL_CSS = join(here, "..", "src", "style.css");
const realCss = () => readFileSync(REAL_CSS, "utf8");

test("repository tokens: every declared pair passes in both themes, no undeclared token", async () => {
  const {PAIRS, NON_COLOUR_PREFIXES} = await import("../scripts/contrast-pairs.mjs");
  const report = checkPairs(resolveThemes(realCss(), NON_COLOUR_PREFIXES), PAIRS);
  assert.deepEqual(report.errors, []);
  assert.equal(report.results.length, PAIRS.length * 2);
  const failed = report.results.filter((r) => !r.ok).map((r) => `${r.theme} ${r.fg} on ${r.bg} ${r.ratio}`);
  assert.deepEqual(failed, []);
});

test("repository tokens: names from brief section 3.1 exist in both themes", async () => {
  const {NON_COLOUR_PREFIXES} = await import("../scripts/contrast-pairs.mjs");
  const themes = resolveThemes(realCss(), NON_COLOUR_PREFIXES);
  const required = [
    "--mm-bg", "--mm-surface", "--mm-text", "--mm-text-muted", "--mm-border",
    ...[1, 2, 3, 4, 5].flatMap((n) => [`--mm-pct-${n}`, `--mm-pct-${n}-ink`]),
    "--mm-div-neg", "--mm-div-pos", "--mm-div-mid",
    "--mm-alert-watch", "--mm-alert-alert", "--mm-alert-watch-ink", "--mm-alert-alert-ink",
    "--mm-feed-fresh", "--mm-feed-late", "--mm-feed-stale", "--mm-feed-broken", "--mm-focus"
  ];
  for (const theme of ["light", "dark"]) for (const n of required) assert.ok(Object.hasOwn(themes[theme], n), `${theme}: ${n}`);
  const raw = parseTokenBlocks(realCss()).light;
  for (let i = 1; i <= 6; i++) assert.ok(Object.hasOwn(raw, `--mm-space-${i}`), `--mm-space-${i}`);
  for (const n of ["--mm-radius", "--mm-font", "--mm-fs-small", "--mm-fs-base"]) assert.ok(Object.hasOwn(raw, n), n);
});

test("AC-UX-3: bin luminance orders with percentile bin (darker up in light, lighter up in dark)", async () => {
  const {NON_COLOUR_PREFIXES} = await import("../scripts/contrast-pairs.mjs");
  const themes = resolveThemes(realCss(), NON_COLOUR_PREFIXES);
  for (const [theme, sign] of [["light", -1], ["dark", 1]]) {
    const lum = [1, 2, 3, 4, 5].map((n) => relativeLuminance(themes[theme][`--mm-pct-${n}`]));
    for (let i = 1; i < lum.length; i++) assert.ok(sign * (lum[i] - lum[i - 1]) > 0, `${theme}: bin ${i + 1} vs ${i}: ${lum[i]} vs ${lum[i - 1]}`);
  }
});

test("style.css: system font stack, no remote or font-file reference, only local observablehq imports", () => {
  const css = realCss();
  assert.doesNotMatch(css, /@font-face|https?:|\.woff2?|\.ttf|\.otf/i);
  const imports = [...css.matchAll(/@import\s+url\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  assert.deepEqual(imports, ["observablehq:default.css", "observablehq:theme-air.css", "observablehq:theme-near-midnight.css"]);
  assert.equal([...css.matchAll(/@import/g)].length, imports.length);
  assert.match(css, /--mm-font:\s*system-ui,/);
  const config = readFileSync(join(here, "..", "observablehq.config.js"), "utf8");
  assert.match(config, /style:\s*"style\.css"/);
  assert.match(config, /globalStylesheets:\s*\[\]/);
});

test("built dist (if present): stylesheet linked same-origin and no off-origin URL in CSS", { skip: !existsSync(join(here, "..", "dist", "index.html")) }, () => {
  const dist = join(here, "..", "dist");
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length > 0);
  for (const l of links) assert.doesNotMatch(l, /href="(https?:)?\/\//, l);
  assert.ok(links.some((l) => /href="(\.\/|\/)_import\/style\.[^"]+\.css"/.test(l)), links.join("\n"));
  const dir = join(dist, "_import");
  for (const f of readdirSync(dir).filter((x) => /^style\..+\.css$/.test(x))) {
    const css = readFileSync(join(dir, f), "utf8");
    // The only absolute URL Framework's own CSS carries is the SVG namespace inside data: URIs (not a request).
    const urls = [...css.matchAll(/https?:\/\/[^"') ]*/g)].map((m) => m[0]).filter((u) => !u.startsWith("http://www.w3.org/2000/svg"));
    assert.deepEqual(urls, []);
    assert.doesNotMatch(css, /googleapis|@font-face/);
    assert.match(css, /--mm-pct-1-ink/);
  }
});

test("var(--mm-x) uses in ordinary rules are allowed; a --mm- declaration there is still rejected", async () => {
  const {parseTokenBlocks} = await import("../scripts/lib/contrast.mjs");
  const base = ":root{--mm-a:#ffffff;}";
  assert.deepEqual(parseTokenBlocks(`${base} .x{color:var(--mm-a);}`).light, {"--mm-a": "#ffffff"});
  assert.throws(() => parseTokenBlocks(`${base} .x{--mm-b:#000000;}`), /unsupported rule/);
});
