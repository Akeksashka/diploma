// V9 (ADR-037 A1.2, spec 5.1 as replaced, AC-V2-60, 61, 62): the native entity picker. Offline; the DOM behaviour (keyboard, optgroups in the
// browser) is exercised by tests/smoke/picker.smoke.mjs.
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {pickerHref, pickerLists} from "../src/lib/picker.js";
import {DRAFT_PICKER_LABELS} from "../src/lib/copy.js";
import {countryListPageSource, countryPageSource} from "../scripts/lib.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const entities = JSON.parse(readFileSync(join(here, "fixtures", "v2_export", "meta", "entities.json"), "utf8")).entities;
const groups = JSON.parse(readFileSync(join(here, "fixtures", "v2_export", "meta", "groups.json"), "utf8")).groups;

test("pickerLists: countries then aggregates, each A to Z by stored name, no global entity", () => {
  const l = pickerLists({entities, groups});
  const want = (kind) => entities.filter((e) => !e.is_global && (kind === "country" ? e.kind === "country" : e.kind === "aggregate")).map((e) => e.name ?? e.entity_id);
  assert.deepEqual(l.countries.map((x) => x.label), want("country").sort((a, b) => a.localeCompare(b, "en")));
  assert.deepEqual(l.aggregates.map((x) => x.label), want("aggregate").sort((a, b) => a.localeCompare(b, "en")));
  const all = [...l.countries, ...l.aggregates].map((x) => x.id);
  assert.equal(all.length, entities.filter((e) => !e.is_global).length, "every entity with a country page is offered once");
  assert.ok(!all.some((id) => entities.find((e) => e.entity_id === id).is_global));
});

test("pickerLists: the Group limits the countries to its current members; aggregates stay; the current entity stays listed", () => {
  const g = groups.find((x) => (x.members ?? []).length > 0 && (x.members ?? []).length < entities.filter((e) => e.kind === "country").length);
  assert.ok(g, "fixture has a proper subset group");
  const ids = new Set(g.members.filter((m) => m.valid_to == null).map((m) => m.entity_id));
  const l = pickerLists({entities, groups, groupId: g.group_id});
  assert.deepEqual(l.countries.map((x) => x.id).sort(), [...ids].filter((id) => entities.find((e) => e.entity_id === id)?.kind === "country").sort());
  assert.equal(l.aggregates.length, pickerLists({entities, groups}).aggregates.length);
  const outside = entities.find((e) => e.kind === "country" && !ids.has(e.entity_id));
  assert.ok(pickerLists({entities, groups, groupId: g.group_id, currentId: outside.entity_id}).countries.some((x) => x.id === outside.entity_id), "current entity is kept");
});

test("pickerLists: empty input and a missing aggregate list do not throw", () => {
  assert.deepEqual(pickerLists({}), {countries: [], aggregates: []});
  assert.deepEqual(pickerLists({entities: [{entity_id: "X", kind: "country", name: "Xland"}]}).aggregates, []);
});

test("Go: the Country keys of the current hash are kept, Compare-only keys dropped, c is the chosen entity", () => {
  assert.equal(pickerHref("./country/DEU", "#i=M09&g=g7&stl=1&c=FRA", "DEU"), "./country/DEU#i=M09&g=g7&c=DEU");
  assert.equal(pickerHref("../country/POL", "", "POL"), "../country/POL#c=POL");
});

test("labels come from the DRAFT picker constants", () => {
  assert.deepEqual({...DRAFT_PICKER_LABELS}, {country: "Country", group: "Group", countries: "Countries", aggregates: "Aggregates", placeholder: "Choose a country"});
  const src = readFileSync(join(here, "..", "src", "lib", "picker.js"), "utf8");
  for (const k of ["P.countries", "P.aggregates", "P.placeholder", "P.group", "P.country"]) assert.ok(src.includes(k), k);
});

test("no hand-built combobox: no role=combobox or listbox, no aria-activedescendant, no datalist, in any module or generated page (comments aside)", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const lib = join(here, "..", "src", "lib");
  const files = readdirSync(lib).filter((n) => n.endsWith(".js")).map((n) => [n, readFileSync(join(lib, n), "utf8")]);
  files.push(["country page", countryPageSource({entity_id: "DEU", name: "Germany", kind: "country", group_ids: []}, [], ["labour"])], ["list page", countryListPageSource([])]);
  for (const [name, text] of files) assert.doesNotMatch(strip(text), /role\s*=\s*["']?(combobox|listbox)|aria-activedescendant|<datalist|datalist/i, name);
  assert.ok(files.length > 20);
});

test("the picker adds no request: it reads only the two meta lists it is given, and the list page loads only the manifest and those two files", () => {
  const picker = readFileSync(join(here, "..", "src", "lib", "picker.js"), "utf8");
  assert.doesNotMatch(strip(picker), /fetch\(|FileAttachment|XMLHttpRequest|import\(/);
  const page = countryListPageSource([]);
  const files = [...page.matchAll(/FileAttachment\("([^"]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(files, ["data/manifest.json", "data/meta/entities.json", "data/meta/groups.json"]);
});
function strip(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("navigation is explicit: choosing an option never navigates (WCAG 3.2.2); Go and Enter do", () => {
  const src = strip(readFileSync(join(here, "..", "src", "lib", "picker.js"), "utf8"));
  const changeBlocks = [...src.matchAll(/addEventListener\("change", \(\) => \{[\s\S]*?\n  \}\);/g)].map((m) => m[0]);
  assert.equal(changeBlocks.length, 2);
  for (const b of changeBlocks) assert.doesNotMatch(b, /location|assign|go\(\)/);
  assert.match(src, /e\.key !== "Enter"/);
  assert.match(src, /"click", go/);
});
