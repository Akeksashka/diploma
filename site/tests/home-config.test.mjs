// V56: Home constants and their resolution (G-HOME-CONST, DRAFT), offline.
import assert from "node:assert/strict";
import {test} from "node:test";
import {HOME_DEFAULT_INDICATOR, HOME_HIGHLIGHT, HOME_KPI_IDS, resolveHome} from "../src/lib/home-config.js";
import {effectiveSelection} from "../src/lib/home-dashboard.js";

const domains = [
  {domain_id: "growth", name: "Growth", ranked: true, indicator_ids: ["G01"]},
  {domain_id: "fiscal", name: "Fiscal", ranked: true, indicator_ids: ["A05"]}
];
const withA05 = [{indicator_id: "G01", domain_ids: ["growth"]}, {indicator_id: "A05", domain_ids: ["fiscal"]}];

test("constants are the DRAFT list of the plan", () => {
  assert.equal(HOME_DEFAULT_INDICATOR, "A05");
  assert.deepEqual([...HOME_KPI_IDS], ["M09", "M10", "M11", "P01", "A01", "M18"]);
  assert.deepEqual([...HOME_HIGHLIGHT], ["DEU", "FRA", "ITA", "ESP", "POL"]);
});

test("A05 in the catalogue without any rows is still the Home default (no throw, no row needed)", () => {
  const sel = effectiveSelection({d: null, i: null}, {domains, indicators: withA05});
  assert.equal(sel.indicatorId, "A05");
  assert.equal(sel.domainId, "fiscal");
});

test("A05 absent from the catalogue: previous default stands", () => {
  const sel = effectiveSelection({d: null, i: null}, {domains, indicators: [withA05[0]]});
  assert.equal(sel.domainId, "growth");
  assert.equal(sel.indicatorId, "G01");
});

test("an explicit Indicator, Domain or Frequency is never overridden by the Home default", () => {
  assert.equal(effectiveSelection({d: null, i: "G01"}, {domains, indicators: withA05}).indicatorId, "G01");
  assert.equal(effectiveSelection({d: "growth", i: null}, {domains, indicators: withA05}).indicatorId, "G01");
  const f = effectiveSelection({d: null, i: null, f: "A"}, {domains, indicators: withA05});
  assert.equal(f.domainId, "fiscal"); // a Frequency alone keeps A05's Domain; the Indicator is the first one offered
  const bad = [{indicator_id: "A05", domain_ids: ["ghost"]}, withA05[0]];
  assert.equal(effectiveSelection({d: null, i: null}, {domains, indicators: bad}).domainId, "growth"); // unknown domain: previous default
});

test("resolveHome: missing ids go to the disclosure list, never an error; aggregate fallback; cap 5", () => {
  const entities = [{entity_id: "DEU", kind: "country"}, {entity_id: "FRA", kind: "country"}, {entity_id: "EU27", kind: "aggregate"}];
  const r = resolveHome({indicators: [{indicator_id: "M09"}], entities});
  assert.equal(r.defaultIndicator, null);
  assert.equal(r.kpiEntity, "EU27");
  assert.deepEqual(r.kpiIds, ["M09"]);
  assert.deepEqual(r.highlight, ["DEU", "FRA"]);
  assert.ok(r.missing.some((m) => m.constant === "HOME_DEFAULT_INDICATOR" && m.id === "A05"));
  assert.ok(r.missing.some((m) => m.constant === "HOME_KPI_ENTITY"));
  assert.equal(r.missing.filter((m) => m.constant === "HOME_KPI_IDS").length, 5);
  assert.deepEqual(resolveHome().kpiIds, []);
  assert.equal(resolveHome({indicators: withA05}).defaultIndicator, "A05");
});
