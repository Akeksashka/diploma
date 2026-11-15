// V47: sheet -> names.uk.json. Only rows the sheet marks `reviewed` are imported, and only with Ukrainian text, a reviewer and a date.
// Agents never mark a row reviewed. Usage: node scripts/names-import.mjs [sheet.md] [names.uk.json]
import {readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const SECTIONS = ["domains", "indicators", "entities", "sources"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Parses sheet rows: | # | Section | ID | Kind | English | Ukrainian | Source | Status | Reviewer | Reviewed on | Listed in |
export function parseSheet(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    if (c.length !== 11 || !SECTIONS.includes(c[1])) continue;
    rows.push({section: c[1], id: c[2].replace(/`/g, ""), en: c[4], uk: c[5], status: c[7], reviewer: c[8], date: c[9]});
  }
  return rows;
}

// Returns a new names object; throws on a bad `reviewed` row. Existing entries are kept unless the sheet reviews the same id.
export function importNames(rows, names) {
  const out = Object.fromEntries(SECTIONS.map((s) => [s, {...(names?.[s] ?? {})}]));
  for (const r of rows) {
    const where = `${r.section}.${r.id}`;
    if (r.status === "reviewed") {
      if (r.uk === "") throw new Error(`${where}: reviewed row has no Ukrainian text`);
      if (r.reviewer === "") throw new Error(`${where}: reviewed row has no reviewer`);
      if (!DATE.test(r.date)) throw new Error(`${where}: reviewed row needs a date YYYY-MM-DD`);
      out[r.section][r.id] = {t: r.uk, status: "reviewed", reviewed_on: r.date, reviewer: r.reviewer};
    } else if (r.status !== "proposed") throw new Error(`${where}: unknown status ${JSON.stringify(r.status)}`);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const sheet = process.argv[2] ?? join(here, "../../docs/ops/dashboard-v2-uk-names-review.md");
  const target = process.argv[3] ?? join(here, "../src/i18n/names.uk.json");
  const result = importNames(parseSheet(readFileSync(sheet, "utf8")), JSON.parse(readFileSync(target, "utf8")));
  writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
  console.log(`names-import: ${SECTIONS.map((s) => `${s} ${Object.keys(result[s]).length}`).join(", ")}`);
}
