// V11 (K1 latest-value cards; AC-V2-10, 11, 12, 13, 125 absence part): card model, markup and hidden-rows disclosure on the SYNTHETIC v2 fixture.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {DRAFT_HIDDEN_SUMMARY, DRAFT_STALE_PERIOD} from "../src/lib/copy.js";
import {k1Model} from "../src/lib/country-model.js";
import {countHiddenRowsByReason} from "../src/lib/filter-model.js";
import {k1Block, k1Card} from "../src/lib/kpi-view.js";
import {html} from "./support/html-standin.mjs";
import {modelOf, scorecards} from "./support/load-v2.mjs";

const domainOf = (entityId, domainId) => modelOf(entityId).domains.find((d) => d.domainId === domainId);
const cell = (entityId, domainId, indicatorId) => scorecards[domainId].entities.find((e) => e.entity_id === entityId).indicators.find((c) => c.indicator_id === indicatorId);

test("V11: one card per indicator with a stored value, in the stored indicator order; the rest are hidden with reason no_data (AC-V2-13)", () => {
  const d = domainOf("ITA", "labour");
  const k = k1Model(d);
  const withValue = d.rows.filter((r) => r.hasValue).map((r) => r.indicatorId);
  assert.deepEqual(k.cards.map((c) => c.indicatorId), withValue);
  assert.deepEqual(k.hidden.map((h) => h.row.indicatorId), d.rows.filter((r) => !r.hasValue).map((r) => r.indicatorId));
  assert.ok(k.hidden.length > 0, "ITA M10 has only MISS rows in the fixture");
  assert.ok(k.hidden.every((h) => h.reason === "no_data"));
  assert.equal(k.cards.length + k.hidden.length, d.rows.length, "every indicator is a card or in the disclosure");
});

test("V11: the disclosure count equals the hidden list and comes from countHiddenRowsByReason on the same array (AC-V2-80)", () => {
  const k = k1Model(domainOf("ITA", "labour"));
  const out = String(k1Block(html, k, {domainId: "labour"}));
  const n = countHiddenRowsByReason(k.hidden).total;
  assert.ok(n > 0);
  assert.ok(out.includes(`<summary>${DRAFT_HIDDEN_SUMMARY(countHiddenRowsByReason(k.hidden))}</summary>`));
  assert.equal(out.split("<li data-reason=").length - 1, n);
  assert.match(out, /<div role="status" class="mm-hidden-slot"><details class="mm-hidden-rows">/);
  const none = String(k1Block(html, k1Model(domainOf("DEU", "prices")), {domainId: "prices"}));
  assert.match(none, /<div role="status" class="mm-hidden-slot"><\/div>/, "nothing is rendered at N = 0 (ADR-036 I7)");
  assert.doesNotMatch(none, /mm-hidden-rows/);
});

test("V11: a card prints name, stored value, unit, reference period and source (AC-V2-10)", () => {
  const d = domainOf("DEU", "labour");
  const r = d.rows.find((x) => x.indicatorId === "M10");
  const out = String(k1Card(html, {...r, stale: false}));
  assert.ok(out.includes(`>${r.name}</a>`));
  assert.ok(out.includes(`<span class="mm-tile-number" data-field="value">${r.valueText}</span>`));
  assert.ok(out.includes(`data-field="unit">${r.unit}</span>`));
  assert.ok(out.includes(`data-field="period">${r.periodText}</p>`));
  assert.ok(out.includes(r.sourceName));
  assert.equal(r.valueText, String(cell("DEU", "labour", "M10").value).replace(/^(\d+)\.0+$/, "$1"), "the value is the stored number");
  assert.match(out, /data-stale="false"/);
  assert.doesNotMatch(out, /mm-stale/);
});

test("V11: a stale card is drawn (never hidden) with the stale marker and the stored period; the stored is_stale decides (A1.1, E-3)", () => {
  const d = domainOf("FRA", "labour");
  assert.equal(cell("FRA", "labour", "M09").is_stale, true);
  const k = k1Model(d);
  const card = k.cards.find((c) => c.indicatorId === "M09");
  assert.ok(card, "stale M09 of FRA is a card");
  assert.equal(card.stale, true);
  assert.ok(!k.hidden.some((h) => h.row.indicatorId === "M09"), "stale is not a hide reason in K1");
  const out = String(k1Card(html, card));
  assert.match(out, /data-stale="true"/);
  assert.ok(out.includes(`<p class="mm-stale" data-flag="stale"><span class="mm-square" aria-hidden="true"></span> ${DRAFT_STALE_PERIOD(card.periodText)}</p>`));
  assert.ok(String(k1Card(html, k.cards.find((c) => c.indicatorId === "M10"))).indexOf("mm-stale") < 0, "a current card has no marker");
});

test("V11: an estimate or provisional value carries the hollow marker (AC-V2-12)", () => {
  const d = domainOf("DEU", "fiscal");
  const k = k1Model(d);
  const est = k.cards.filter((c) => c.estimate);
  assert.ok(est.length > 0, "A04/A05 last rows are EST in the fixture");
  for (const c of est) assert.match(String(k1Card(html, c)), /<span class="mm-mark" data-mark="estimate"><span class="mm-hollow" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(String(k1Card(html, k.cards.find((c) => !c.estimate && !c.inherited) ?? {...k.cards[0], estimate: false, inherited: false})), /data-mark=/);
});

test("V11 (AC-V2-11, 125): no delta, arrow, direction word or direction colour on any card of any domain, no stored delta in the fixture rows", () => {
  const out = ["labour", "prices", "fiscal", "growth", "agri", "qa"].map((id) => String(k1Block(html, k1Model(domainOf("DEU", id)), {domainId: id}))).join("\n");
  assert.ok(out.includes('data-tile="k1"'));
  assert.doesNotMatch(out, /y\/y \(stored\)|delta|arrow|[↑↓▲▼]|\b(up|down|rising|falling)\b|data-direction|mm-delta/i);
  for (const sc of Object.values(scorecards)) for (const e of sc.entities) for (const c of e.indicators) assert.ok(!("prev_value" in c) && !("change" in c) && !("value_yoy" in c), "the scorecard stores no delta");
});

test("V11: the K1 modules read only stored fields: no arithmetic, no count, no sparkline (D6, OQ-12)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const code = ["country-model.js", "kpi-view.js"].map((n) => readFileSync(join(here, "..", "src", "lib", n), "utf8")).join("\n");
  const k1 = code.slice(code.indexOf("// V11 (K1"));
  assert.doesNotMatch(k1.replace(/\/\/.*$/gm, ""), /sparkline|d3\.line|\.length\s*[-+*/]|\bMath\./);
});
