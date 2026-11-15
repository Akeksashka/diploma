import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {AGGREGATE_PROPOSALS, ISO3_TO_ISO2, proposeName, resolveName} from "../src/lib/names-uk.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const panel = [...readFileSync(join(root, "config/entities.yaml"), "utf8").matchAll(/\{id: (\w+), name: ([^,]+), kind: country/g)].map((m) => ({id: m[1], en: m[2].trim()}));
const fixture = JSON.parse(readFileSync(join(root, "site/tests/fixtures/v2_export/meta/entities.json"), "utf8")).entities;

test("static table covers the 42 panel countries and every fixture country", () => {
  assert.equal(panel.length, 42);
  for (const c of panel) assert.ok(ISO3_TO_ISO2[c.id], c.id);
  for (const e of fixture.filter((x) => x.kind === "country")) assert.ok(ISO3_TO_ISO2[e.entity_id], e.entity_id);
});

test("Intl.DisplayNames('uk') gives each panel country a non-empty name differing from English (OQ-21)", () => {
  assert.ok(Intl.DisplayNames.supportedLocalesOf(["uk"]).length > 0, "ICU lacks uk on this Node");
  const dn = new Intl.DisplayNames(["uk"], {type: "region"});
  for (const c of panel) {
    const p = proposeName(c.id, dn, c.en);
    assert.equal(p.source, "intl", c.id);
    assert.notEqual(p.uk, c.en);
    assert.equal(p.status, "proposed");
  }
});

test("aggregates are hand-proposed and never go through Intl", () => {
  const dn = {of: () => { throw new Error("must not be called"); }};
  for (const id of Object.keys(AGGREGATE_PROPOSALS)) assert.equal(proposeName(id, dn, "x").source, "hand");
});

test("unknown id or missing Intl gives an empty proposal", () => {
  assert.equal(proposeName("XXX", null, "x").uk, "");
  assert.equal(proposeName("DEU", null, "Germany").uk, "");
});

test("resolveName falls back to English inside lang=en unless reviewed", () => {
  const de = {entity_id: "DEU", name: "Germany"};
  assert.deepEqual(resolveName(de, "en", {DEU: {uk: "Німеччина", status: "reviewed"}}), {text: "Germany", lang: "en"});
  assert.deepEqual(resolveName(de, "uk", {DEU: {uk: "Німеччина", status: "proposed"}}), {text: "Germany", lang: "en"});
  assert.deepEqual(resolveName(de, "uk", {}), {text: "Germany", lang: "en"});
  assert.deepEqual(resolveName(de, "uk", {DEU: {uk: "", status: "reviewed"}}), {text: "Germany", lang: "en"});
  assert.deepEqual(resolveName(de, "uk", {DEU: {uk: "Німеччина", status: "reviewed"}}), {text: "Німеччина", lang: "uk"});
});
