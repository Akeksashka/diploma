// V64 (A1.7, AC-V2-92, 61): the static country list. Offline.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {COUNTRY_LIST_TITLE, countryListHtml} from "../src/lib/country-list.js";
import {countryListPageSource} from "../scripts/lib.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const entities = JSON.parse(readFileSync(join(here, "fixtures", "v2_export", "meta", "entities.json"), "utf8")).entities;

test("lists every entity that has a country page, countries first, aggregates in a labelled sub-list, each linking to country/<id>", () => {
  const html = countryListHtml(entities);
  const shown = entities.filter((e) => e.is_global !== true);
  for (const e of shown) assert.ok(html.includes(`href="./country/${e.entity_id}"`), e.entity_id);
  for (const e of entities.filter((x) => x.is_global === true)) assert.ok(!html.includes(`/${e.entity_id}"`), `global ${e.entity_id} has no page`);
  assert.equal((html.match(/<a /g) ?? []).length, shown.length, "one link per entity");
  assert.ok(html.indexOf('id="country-list"') < html.indexOf('id="aggregate-list"'));
  assert.match(html, /<h3 id="aggregates">Aggregates<\/h3>/);
  assert.match(html, /<h2 id="countries-heading">Choose a country<\/h2>/);
});

test("a list with no aggregates has no empty sub-list; entity ids that are unsafe are refused", () => {
  const html = countryListHtml([{entity_id: "DEU", name: "Germany", kind: "country"}]);
  assert.ok(!html.includes("aggregate-list") && !html.includes("Aggregates"));
  assert.throws(() => countryListHtml([{entity_id: '"><x', name: "x", kind: "country"}]), /unsafe/);
});

test("the generated page has one static h1, the list in built HTML, and links carry the Country keys", () => {
  const page = countryListPageSource(entities);
  assert.equal((page.match(/<h1[ >]/g) ?? []).length, 1);
  assert.ok(page.includes(`<h1>${COUNTRY_LIST_TITLE}</h1>`));
  assert.ok(page.indexOf("<h1>") < page.indexOf("```js"), "h1 before any cell");
  for (const e of entities.filter((x) => !x.is_global)) assert.ok(page.includes(`href="./country/${e.entity_id}" data-carry="country"`), e.entity_id);
  assert.ok(page.includes('id="picker-slot"'));
  // Part 0: each link forces c to its own entity, so a stale hash c never disagrees with the page it opens
  for (const e of entities.filter((x) => !x.is_global)) assert.ok(page.includes(`href="./country/${e.entity_id}" data-carry="country" data-carry-set="c=${e.entity_id}"`), e.entity_id);
});
