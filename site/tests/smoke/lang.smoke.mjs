// V46 browser smoke (AC-V2-103): the language switch on the merged deploy tree (dist-site, built by npm run build:all). Without JavaScript it lands on the same path
// in the other tree with no hash; with JavaScript the hash of the page being left is appended. Skips without a browser unless MM_SMOKE_REQUIRE_BROWSER=1.
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {after, before, test} from "node:test";
import {fileURLToPath} from "node:url";
import {REQUIRE_BROWSER, launchBrowser, openPage, serve} from "./support.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MERGED = resolve(process.env.MM_SMOKE_MERGED ?? join(here, "..", "..", "dist-site"));
let browser = null;
let reason = existsSync(join(MERGED, "uk", "index.html")) ? "browser not started" : `no merged tree at ${MERGED} (run npm run build:all with a fixture export first)`;
let site = null;

before(async () => {
  if (!existsSync(join(MERGED, "uk", "index.html"))) {
    if (REQUIRE_BROWSER) assert.fail(reason);
    return;
  }
  ({browser, reason} = await launchBrowser());
  if (!browser) {
    if (REQUIRE_BROWSER) assert.fail(reason);
    return;
  }
  site = await serve(MERGED);
});
after(async () => {
  await browser?.close();
  await site?.close();
});

const CASES = [["/", "/uk/"], ["/country", "/uk/country"], ["/country/AUS", "/uk/country/AUS"], ["/compare", "/uk/compare"]];

for (const [en, uk] of CASES) {
  test(`without JavaScript ${en} <-> ${uk}: the switch lands on the same page of the other tree, no hash`, async (t) => {
    if (!browser) return t.skip(reason);
    const context = await browser.newContext({javaScriptEnabled: false});
    try {
      const page = await context.newPage();
      await page.goto(`${site.origin}${en}#c=PL`);
      assert.equal(await page.getAttribute("html", "lang"), "en");
      await page.click("a.mm-lang");
      assert.equal(new URL(page.url()).pathname.replace(/(.)\/$/, "$1"), uk.replace(/(.)\/$/, "$1"));
      assert.equal(new URL(page.url()).hash, "");
      assert.equal(await page.getAttribute("html", "lang"), "uk");
      await page.click("a.mm-lang");
      assert.equal(new URL(page.url()).pathname.replace(/(.)\/$/, "$1"), en);
    } finally {
      await context.close();
    }
  });
}

test("with JavaScript the current hash follows the switch, in both directions", async (t) => {
  if (!browser) return t.skip(reason);
  const {page, context} = await openPage(browser, site.origin);
  try {
    await page.goto(`${site.origin}/country/AUS`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => { location.hash = "#from=2015&to=2020"; });
    await page.click("a.mm-lang");
    assert.equal(new URL(page.url()).pathname, "/uk/country/AUS");
    assert.equal(new URL(page.url()).hash, "#from=2015&to=2020");
    await page.waitForLoadState("networkidle");
    await page.click("a.mm-lang");
    assert.equal(new URL(page.url()).pathname, "/country/AUS");
    assert.equal(new URL(page.url()).hash, "#from=2015&to=2020");
  } finally {
    await context.close();
  }
});
