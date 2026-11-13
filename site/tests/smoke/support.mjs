// Shared helpers for the browser smoke tests (T94). Nothing here needs network beyond 127.0.0.1.
// Browser choice: the Playwright-managed Chromium (installed in CI with `npx playwright install
// chromium`), or, for local runs, MM_SMOKE_CHROME_PATH (an executable) or MM_SMOKE_CHANNEL (for
// example "chrome"). Playwright never downloads a browser by itself.
import {createServer} from "node:http";
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {dirname, extname, join, normalize, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DIST = resolve(process.env.MM_SMOKE_DIST ?? join(here, "..", "..", "dist"));
export const REQUIRE_BROWSER = process.env.MM_SMOKE_REQUIRE_BROWSER === "1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".parquet": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm"
};

export const distBuilt = () => existsSync(join(DIST, "index.html"));

// The manifest that the build copied into dist/_file/data (name carries a content hash).
export function builtManifestPath(dist = DIST) {
  const dir = join(dist, "_file", "data");
  const f = existsSync(dir) ? readdirSync(dir).find((n) => /^manifest\.[0-9a-f]+\.json$/.test(n)) : undefined;
  return f ? join(dir, f) : null;
}

// Static server for dist/. `manifestOverride(obj) -> obj` rewrites the manifest response (used for
// the stale-fixture case). Binds to 127.0.0.1 only. Returns {origin, close, served}.
export async function serve(dist = DIST, {manifestOverride = null} = {}) {
  const root = resolve(dist);
  const served = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    let file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (existsSync(`${file}.html`)) file = `${file}.html`;
      else {
        res.writeHead(404).end("not found");
        return;
      }
    }
    let body = readFileSync(file);
    if (manifestOverride && /\/_file\/data\/manifest\.[0-9a-f]+\.json$/.test(url.pathname)) {
      body = Buffer.from(JSON.stringify(manifestOverride(JSON.parse(body.toString("utf8")))));
    }
    served.push({path: url.pathname, bytes: body});
    res.writeHead(200, {"content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store"});
    res.end(body);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const {port} = server.address();
  return {origin: `http://127.0.0.1:${port}`, served, close: () => new Promise((ok) => server.close(ok))};
}

// Returns {browser, reason}. browser is null (with the reason) when none can be started.
export async function launchBrowser() {
  let chromium;
  try {
    ({chromium} = await import("playwright"));
  } catch (e) {
    return {browser: null, reason: `playwright is not installed (run npm ci in site/): ${e.code ?? e.message}`};
  }
  const opts = {headless: true};
  if (process.env.MM_SMOKE_CHROME_PATH) opts.executablePath = process.env.MM_SMOKE_CHROME_PATH;
  else if (process.env.MM_SMOKE_CHANNEL) opts.channel = process.env.MM_SMOKE_CHANNEL;
  try {
    return {browser: await chromium.launch(opts), reason: null};
  } catch (e) {
    const first = String(e.message).split("\n")[0];
    return {
      browser: null,
      reason: `no browser available (${first}). Install one with \`npx playwright install chromium\`, or set MM_SMOKE_CHANNEL=chrome or MM_SMOKE_CHROME_PATH.`
    };
  }
}

// A page that records every request, aborts anything off-origin, and collects page errors.
export async function openPage(browser, origin, {fixedTime = null} = {}) {
  const context = await browser.newContext();
  const log = {offOrigin: [], requests: [], errors: [], failed: []};
  await context.route(
    (u) => !(u.origin === origin) && u.protocol !== "data:" && u.protocol !== "blob:",
    (route) => {
      log.offOrigin.push(route.request().url());
      return route.abort();
    }
  );
  if (fixedTime) await context.clock.setFixedTime(new Date(fixedTime));
  const page = await context.newPage();
  page.on("request", (r) => log.requests.push(r.url()));
  page.on("pageerror", (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") log.errors.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => log.failed.push(r.url()));
  return {page, context, log};
}

// A1.5 / CR-18: no stored indicator carries `scale_hint = index` today, so the rebase control is absent on every built export. To exercise the active-rebase path in a real
// browser without a second build, the page's request for meta/indicators.json is answered with the same file in which the named indicators carry the SYNTHETIC marker
// `scale_hint: "index"` (nothing else changes; the served files on disk are untouched). Call before page.goto.
export async function markIndex(context, ids) {
  await context.route(/\/_file\/data\/meta\/indicators\.[0-9a-f]+\.json$/, async (route) => {
    const res = await route.fetch();
    const doc = await res.json();
    for (const i of doc.indicators) if (ids.includes(i.indicator_id)) i.scale_hint = "index";
    await route.fulfill({response: res, json: doc});
  });
}

// EXP-07 scanner idea, ported to JS: names of secret-like patterns found. Only the NAME is returned.
export const SECRET_PATTERNS = [
  ["connection URL", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\//],
  ["URL with credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:[^\s/@"']+@/],
  ["bearer token", /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/i],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["credential assignment", /["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret|passwd|password)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i]
];
export const scanSecrets = (text) => SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
