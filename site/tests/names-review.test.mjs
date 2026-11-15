import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {importNames, parseSheet} from "../scripts/names-import.mjs";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const sheet = readFileSync(join(site, "..", "docs/ops/dashboard-v2-uk-names-review.md"), "utf8");
const empty = {domains: {}, indicators: {}, entities: {}, sources: {}};
const edit = (id, status, reviewer, date, uk) =>
  sheet.split("\n").map((l) => {
    if (!l.includes(`| \`${id}\` |`)) return l;
    const c = l.split("|");
    if (uk !== undefined) c[6] = ` ${uk} `;
    c[8] = ` ${status} `; c[9] = ` ${reviewer} `; c[10] = ` ${date} `;
    return c.join("|");
  }).join("\n");

test("sheet has domains, indicators, sources and entities; only the 47 entity rows with Ukrainian text are reviewed (by the user, 2026-11-15)", () => {
  const rows = parseSheet(sheet);
  const n = (s) => rows.filter((r) => r.section === s).length;
  assert.equal(n("domains"), 11);
  assert.ok(n("indicators") >= 80);
  assert.ok(n("entities") >= 45);
  assert.ok(n("sources") > 0);
  const reviewed = rows.filter((r) => r.status === "reviewed");
  assert.equal(reviewed.length, 47);
  assert.ok(reviewed.every((r) => r.section === "entities" && r.uk !== "" && r.reviewer === "user" && r.date === "2026-11-15"));
  assert.ok(rows.filter((r) => r.status !== "reviewed").every((r) => r.status === "proposed" && r.uk === ""));
});

test("importing the sheet gives exactly the committed names.uk.json", () => {
  assert.deepEqual(importNames(parseSheet(sheet), empty), JSON.parse(readFileSync(join(site, "src/i18n/names.uk.json"), "utf8")));
});

test("round trip: only the row the user marks reviewed is written, with reviewer and date", () => {
  const out = importNames(parseSheet(edit("DEU", "reviewed", "User", "2026-11-15")), empty);
  assert.deepEqual(out.entities.DEU, {t: "Німеччина", status: "reviewed", reviewed_on: "2026-11-15", reviewer: "User"});
  assert.equal(Object.keys(out.entities).length, 47);
  assert.deepEqual(out.domains, {});
});

test("a reviewed flag without reviewer, date or Ukrainian text is rejected", () => {
  assert.throws(() => importNames(parseSheet(edit("DEU", "reviewed", "", "2026-11-15")), empty), /no reviewer/);
  assert.throws(() => importNames(parseSheet(edit("DEU", "reviewed", "User", "")), empty), /needs a date/);
  assert.throws(() => importNames(parseSheet(edit("DEU", "reviewed", "User", "15.11.2026")), empty), /needs a date/);
  assert.throws(() => importNames(parseSheet(edit("growth", "reviewed", "User", "2026-11-15")), empty), /no Ukrainian text/);
  assert.throws(() => importNames(parseSheet(edit("DEU", "done", "", "")), empty), /unknown status/);
});

test("CLI writes the target file for an edited sheet", () => {
  const d = mkdtempSync(join(tmpdir(), "names-"));
  writeFileSync(join(d, "sheet.md"), edit("growth", "reviewed", "User", "2026-11-15", "Зростання"));
  writeFileSync(join(d, "names.json"), JSON.stringify(empty));
  execFileSync(process.execPath, [join(site, "scripts/names-import.mjs"), join(d, "sheet.md"), join(d, "names.json")]);
  assert.equal(JSON.parse(readFileSync(join(d, "names.json"), "utf8")).domains.growth.t, "Зростання");
  assert.equal(JSON.parse(readFileSync(join(site, "src/i18n/names.uk.json"), "utf8")).domains.growth, undefined); // the committed file is untouched by a CLI run on another target
});
