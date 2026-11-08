// T103 helper (not a test; not matched by `npm test`): dumps the rendered text of every page of dist/ to a
// JSON file, for the before/after comparison of the T89-T93 confirmed strings.
//   node tests/snapshot-rendered.mjs <out.json>            write a snapshot
//   node tests/snapshot-rendered.mjs --compare <a.json> <b.json>   exit 1 and list differences
// Needs a built dist/ and a browser (MM_SMOKE_CHANNEL=chrome), like the smoke tests. Fixed clock, no network.
import {readFileSync, writeFileSync} from "node:fs";
import {launchBrowser, openPage, serve} from "./smoke/support.mjs";

const NOW = "2026-11-02T00:00:00Z";
const PAGES = [
  ["/", "#country-list li"],
  ["/domain/labour", "#domain-heatmap tbody tr"],
  ["/domain/prices", "#domain-heatmap tbody tr"],
  ["/domain/agri", "#domain-heatmap tbody tr"],
  ["/domain/global", "#domain-heatmap tbody tr"],
  ["/domain/fin", "#domain-heatmap tbody tr"],
  ["/indicator/M09", "#indicator-table tbody tr"],
  ["/country/DEU", ".mm-country-domain table tbody tr"],
  ["/explorer#i=M09&c=FRA,DEU,IND,ITA,JPN", "#series-captions tbody tr"],
  ["/revisions", "#recent-revisions tbody tr"]
];
const text = (page) => page.evaluate(() => document.body.innerText + "\n[selects]\n" + [...document.querySelectorAll("select")].map((s) => s.id + ": " + [...s.options].map((o) => o.text).join(" | ")).join("\n"));

async function snapshot(out) {
  const {browser, reason} = await launchBrowser();
  if (!browser) throw new Error(reason);
  const site = await serve();
  const snap = {};
  try {
    for (const [path, ready] of PAGES) {
      const {page, context} = await openPage(browser, site.origin, {fixedTime: NOW});
      await page.goto(site.origin + path);
      await page.waitForSelector(ready, {timeout: 30000});
      await page.waitForLoadState("networkidle");
      snap[path] = await text(page);
      if (path === "/explorer") {
        await page.check("#explorer-rebase");
        await page.waitForTimeout(500);
        snap[path + "#rebase"] = await text(page);
      }
      if (path === "/revisions") {
        for (const k of ["regular", "reestimation"]) {
          await page.selectOption("#revision-kind", k);
          await page.waitForTimeout(300);
          snap[`${path}#${k}`] = await text(page);
        }
        await page.selectOption("#vintage-indicator", "M09");
        await page.waitForSelector("#vintage-history, #vintage-none, #vintage-empty, #vintage-error", {timeout: 30000});
        snap[path + "#vintage"] = await text(page);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await site.close();
  }
  writeFileSync(out, JSON.stringify(snap, null, 1));
  console.log(`wrote ${out}: ${Object.keys(snap).length} page states, ${Object.values(snap).join("").length} characters`);
}

function compare(a, b) {
  const x = JSON.parse(readFileSync(a, "utf8"));
  const y = JSON.parse(readFileSync(b, "utf8"));
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  const diffs = [...keys].filter((k) => x[k] !== y[k]);
  for (const k of diffs) console.log(`DIFF ${k}`);
  console.log(`${keys.size} page states compared, ${diffs.length} differ`);
  process.exit(diffs.length ? 1 : 0);
}

if (process.argv[2] === "--compare") compare(process.argv[3], process.argv[4]);
else await snapshot(process.argv[2]);
