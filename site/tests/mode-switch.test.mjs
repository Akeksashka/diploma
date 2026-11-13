// V8 (ADR-037 decision 1, spec 2, A1.3): the Country / Compare mode switch. Offline; the route is the mode, never a hash key.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {DRAFT_MODE_LABELS, DRAFT_MODE_SWITCH_LABEL} from "../src/lib/copy.js";
import {MODES, modeOfPath, modeSwitchHtml, modeSwitchModel, stripBase} from "../src/lib/mode-switch.js";
import {mountFilterBar} from "../src/lib/filter-bar.js";
import {parseHash, serializeHash} from "../src/lib/hash.js";
import {countryListPageSource, comparePageSource, countryPageSource, indicatorPageSource} from "../scripts/lib.mjs";

const hrefs = {country: "../country", compare: "../compare"};

test("the mode comes from the route: /country and /country/<id> are Country, /compare and /indicator/<id> are Compare, other pages have no mode", () => {
  for (const p of ["/country", "/country/DEU", "/country/", "/country/index"]) assert.equal(modeOfPath(p), "country", p);
  for (const p of ["/compare", "/compare/", "/indicator/M09"]) assert.equal(modeOfPath(p), "compare", p);
  for (const p of ["/", "/explorer", "/domains", "/domain/labour", "/revisions", "/countryx", "/comparex", "", null, undefined]) assert.equal(modeOfPath(p), null, String(p));
});

test("the mode is classified under both bases: '/' and '/uk/' (the base is stripped first)", () => {
  for (const base of ["/", "/uk/"]) {
    const at = (p) => (base === "/" ? p : `/uk${p === "/" ? "/" : p}`);
    for (const p of ["/country", "/country/DEU", "/country/index"]) assert.equal(modeOfPath(at(p), base), "country", at(p));
    for (const p of ["/compare", "/compare/", "/indicator/M09"]) assert.equal(modeOfPath(at(p), base), "compare", at(p));
    for (const p of ["/", "/explorer", "/domains", "/revisions", "/countryx"]) assert.equal(modeOfPath(at(p), base), null, at(p));
  }
  assert.equal(modeOfPath("/uk"), null);
  assert.equal(modeOfPath("/uk/country", "/"), null, "without the base the /uk prefix is not stripped");
  assert.equal(modeOfPath("/country", "/uk/"), "country", "a path outside the base is left as is");
  assert.equal(stripBase("/uk", "/uk/"), "/");
  assert.equal(stripBase("/ukraine/x", "/uk/"), "/ukraine/x");
});

test("no m hash key: m=compare and m=country are ignored by the hash grammar and never written", () => {
  assert.equal(parseHash("#m=compare&i=M09", {}).i, "M09");
  assert.equal(serializeHash(parseHash("#m=country", {})), "");
  assert.doesNotMatch(readFileSync(new URL("../src/lib/mode-switch.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, ""), /\bm=|[?&#]m\b|\.m\b/);
});

test("two links with the DRAFT labels in order, exactly one aria-current=page, inside a labelled group", () => {
  assert.deepEqual([...MODES], ["country", "compare"]);
  const country = modeSwitchHtml({mode: "country", hrefs});
  assert.equal(country, `<div class="mm-mode-switch" role="group" aria-label="${DRAFT_MODE_SWITCH_LABEL}"><ul><li><a href="../country" data-carry="country" aria-current="page">${DRAFT_MODE_LABELS.country}</a></li><li><a href="../compare" data-carry="compare">${DRAFT_MODE_LABELS.compare}</a></li></ul></div>`);
  const compare = modeSwitchHtml({mode: "compare", hrefs});
  assert.equal((compare.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(compare, /<a href="\.\.\/compare" data-carry="compare" aria-current="page">Compare<\/a>/);
  assert.doesNotMatch(country, /role="(tab|tablist|tabpanel)"|<nav/, "a labelled group of plain links: not the ARIA tabs pattern, and not a second nav landmark (the header nav is the only one)");
});

test("a page that fixes a key passes it on to the other mode through data-carry-set; unsafe or unknown input is refused", () => {
  assert.match(modeSwitchHtml({mode: "country", hrefs, set: {compare: {c: "DEU"}}}), /<a href="\.\.\/compare" data-carry="compare" data-carry-set="c=DEU">/);
  assert.match(modeSwitchHtml({mode: "compare", hrefs, set: {compare: {i: "M09"}}}), /data-carry-set="i=M09" aria-current="page"/);
  assert.throws(() => modeSwitchModel({mode: "compare", hrefs, set: {compare: {c: "a&b"}}}), /unsafe/);
  assert.throws(() => modeSwitchModel({mode: "map", hrefs}), /unknown mode/);
});

test("escapes hrefs and labels", () => {
  assert.ok(modeSwitchHtml({mode: "country", hrefs: {country: '"><x', compare: "c"}}).includes("&quot;&gt;&lt;x"));
});

test("generated pages hold the static switch in the filter-bar slot (built HTML, no JavaScript): real links, the right current mode", () => {
  const list = countryListPageSource([{entity_id: "DEU", name: "Germany", kind: "country"}]);
  const cmp = comparePageSource();
  const country = countryPageSource({entity_id: "DEU", name: "Germany", kind: "country", group_ids: []}, [], ["labour"]);
  const ind = indicatorPageSource({indicator_id: "M09", name: "Unemployment", domain_ids: ["labour"]}, [{domain_id: "labour", name: "Labour"}]);
  const slot = (src) => src.match(/<div class="mm-filterbar-slot" id="filterbar-slot" data-mode="(\w+)">(<div class="mm-mode-switch"[\s\S]*?<\/ul><\/div>)<\/div>/);
  for (const [name, src, mode, current, set] of [["list", list, "country", "Country", null], ["compare", cmp, "compare", "Compare", null], ["country", country, "country", "Country", "c=DEU"], ["indicator", ind, "compare", "Compare", "i=M09"]]) {
    const m = slot(src);
    assert.ok(m, `${name}: slot with static switch`);
    assert.equal(m[1], mode, name);
    assert.ok(new RegExp(`aria-current="page">${current}</a>`).test(m[2]), `${name}: current is ${current}`);
    assert.equal(m[2].includes("\n"), false, `${name}: one line, so Markdown keeps it one HTML block`);
    if (set) assert.ok(m[2].includes(`data-carry-set="${set}"`), `${name}: ${set}`);
  }
  assert.ok(list.includes('href="./country"') && cmp.includes('href="./compare"'), "root pages use ./ links");
  assert.ok(country.includes('href="../country"') && country.includes('href="../compare"'), "second-level pages use ../ links");
});

test("the live filter bar takes the same switch as its first child, above the controls", () => {
  const src = readFileSync(new URL("../src/lib/filter-bar.js", import.meta.url), "utf8");
  assert.match(src, /mode = null/);
  assert.match(src, /\$\{mode \? mountModeSwitch\(html, mode\) : ""\}\$\{more\}/, "the switch precedes the controls <details>");
  assert.equal(typeof mountFilterBar, "function");
});

test("generated pages never write a mode into the address", () => {
  for (const src of [countryListPageSource([]), comparePageSource()]) assert.doesNotMatch(src, /[#&]m=|"m"\s*:/);
});
