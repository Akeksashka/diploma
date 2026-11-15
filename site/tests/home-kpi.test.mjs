// V57 (AC-V2-120 strip part, 121): the Home KPI strip on the SYNTHETIC v2 fixture. Constants are DRAFT; a missing id is a disclosure, never an error.
import assert from "node:assert/strict";
import {test} from "node:test";
import {HOME_KPI_IDS, resolveHome} from "../src/lib/home-config.js";
import {DRAFT_HOME_KPI_NO_VALUE, DRAFT_HOME_MISSING_SUMMARY} from "../src/lib/copy.js";
import {homeKpiModel, homeKpiStrip, homeLandingDomains, homeMissingDisclosure} from "../src/lib/home-page.js";
import {html} from "./support/html-standin.mjs";
import {entities, indicators, scorecards, series} from "./support/load-v2.mjs";

const resolved = resolveHome({indicators, entities});
const model = (extra = {}) => homeKpiModel({resolved, entities, indicators, scorecards, series, ...extra});

test("every resolved KPI id is a card or in the hidden list, never both and never dropped", () => {
  const m = model();
  assert.equal(m.entity.id, resolved.kpiEntity);
  const ids = [...m.cards.map((c) => c.indicatorId), ...m.hidden.map((h) => h.row.indicatorId)];
  assert.deepEqual([...ids].sort(), [...resolved.kpiIds].sort());
  assert.ok(m.hidden.every((h) => h.reason === "no_data" && h.row.reasonSentence === DRAFT_HOME_KPI_NO_VALUE));
});

test("cards keep the constant's order; no sparkline, delta or percentile in the markup", () => {
  const m = model();
  const order = HOME_KPI_IDS.filter((id) => m.cards.some((c) => c.indicatorId === id));
  assert.deepEqual(m.cards.map((c) => c.indicatorId), order);
  const out = String(homeKpiStrip(html, m));
  assert.match(out, /id="home-kpi"/);
  assert.doesNotMatch(out, /<svg|sparkline|mm-tile-pct|delta/i);
  assert.equal((out.match(/data-tile="k1"/g) ?? []).length, m.cards.length);
});

test("a card without a value goes to the strip's hidden-rows disclosure with its count", () => {
  const m = model();
  assert.ok(m.hidden.length > 0, "the fixture has KPI ids without a value for the aggregate");
  const out = String(homeKpiStrip(html, m));
  assert.match(out, /class="mm-hidden-rows"/);
  assert.ok(m.hidden.every((h) => out.includes(h.row.name)));
});

test("a failed scorecard moves its cards to the disclosure with the not-read sentence, no throw", () => {
  const m = homeKpiModel({resolved, entities, indicators, scorecards: {}, series, failed: new Set(homeLandingDomains(resolved, indicators))});
  assert.equal(m.cards.length, 0);
  assert.equal(m.hidden.length, resolved.kpiIds.length);
  assert.doesNotThrow(() => String(homeKpiStrip(html, m)));
});

test("an id the export does not carry is listed in the missing disclosure, not thrown", () => {
  const without = indicators.filter((i) => i.indicator_id !== "M09");
  const r = resolveHome({indicators: without, entities});
  assert.ok(r.missing.some((x) => x.constant === "HOME_KPI_IDS" && x.id === "M09"));
  const m = homeKpiModel({resolved: r, entities, indicators: without, scorecards, series});
  const out = String(homeKpiStrip(html, m));
  assert.ok(out.includes(DRAFT_HOME_MISSING_SUMMARY));
  assert.equal(String(homeMissingDisclosure(html, [])), "");
});

test("no entity at all: the strip still builds (every id hidden), the sparse case", () => {
  const r = resolveHome({indicators, entities: []});
  const m = homeKpiModel({resolved: r, entities: [], indicators, scorecards, series});
  assert.equal(m.entity, null);
  assert.equal(m.cards.length, 0);
});

test("the landing reads the scorecard of each KPI indicator's domain and of the default Indicator, each once", () => {
  const d = homeLandingDomains(resolved, indicators);
  assert.equal(new Set(d).size, d.length);
  const A05 = indicators.find((i) => i.indicator_id === resolved.defaultIndicator);
  assert.ok(d.includes(A05.domain_ids[0]));
});
