// T108 / AC-UX-2 DOM half: every state of brief section 5 has a unique (visible code, signature) pair; exhaustive over the
// statuses scorecard.js can assign; a status without a mapping throws.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {CELL_STATUSES, SUMMARY_STATUSES, indicatorCell} from "../src/lib/scorecard.js";
import {GLYPH_NAMES, glyph, glyphSprite} from "../src/lib/glyphs.js";
import {DECORATIONS, STATES, StateError, cellState, summaryState} from "../src/lib/states.js";
import {html} from "./support/html-standin.mjs";

const ind = (o = {}) => ({indicator_id: "M09", value: 3.1, rank_mode: "monotone_good", is_stale: false, alignment: "aligned", inherited: false, published: true, publish_scope: "ranked", percentile: 0.9, ref_period_end: "2026-09-30", ...o});
const cell = (o = {}, domainRanked = true) => indicatorCell(ind(o), {domainRanked, indicator: {name: "Unemployment rate", unit_label: "%"}});

// One fixture cell per row of the brief section 5 table (feed states are T128).
const FIXTURES = {
  ranked: cell(),
  stale: cell({is_stale: true, age_days: 400, stale_limit_days: 120}),
  lagging: cell({alignment: "lagging", percentile: null}),
  unaligned: cell({alignment: "unaligned", percentile: null}),
  ahead: cell({alignment: "ahead"}),
  descriptive: cell({rank_mode: "descriptive_only", percentile: null}),
  na: cell({value: null, percentile: null}),
  not_published: cell({published: false, publish_scope: "excluded", value: null}),
  inherited: cell({inherited: true, percentile: null}),
  estimate: cell({value_kind: "estimate"}),
  alert_watch: cell({alert_level: "watch"}),
  alert_alert: cell({alert_level: "alert"})
};
const SUMMARY = {
  aggregate: {status: "aggregate", meanText: "aggregate (not ranked)"},
  low_coverage: {status: "low_coverage", meanText: "0.50"}
};

test("every row of the brief table has a distinct (code, signature) pair and signature", () => {
  const states = [...Object.values(FIXTURES).map(cellState), ...Object.values(SUMMARY).map(summaryState)];
  assert.equal(new Set(states.map((s) => `${s.code}|${s.signature}`)).size, states.length);
  assert.equal(new Set(states.map((s) => s.signature)).size, states.length);
  assert.equal(states.length, 14);
});

test("codes are the approved wording and a mark never claims a rank", () => {
  assert.equal(cellState(FIXTURES.stale).code, "stale");
  assert.equal(cellState(FIXTURES.lagging).code, "lagging");
  assert.equal(cellState(FIXTURES.unaligned).code, "unaligned");
  assert.equal(cellState(FIXTURES.na).code, "n/a");
  assert.equal(cellState(FIXTURES.not_published).code, "np");
  assert.equal(cellState(FIXTURES.ahead).code, "ahead");
  assert.equal(cellState(FIXTURES.ahead).accessibleName.includes("ranked at its latest value, ahead of the common period"), true);
  assert.equal(cellState(FIXTURES.lagging).accessibleName, "not ranked (lagging)");
  assert.equal(cellState(FIXTURES.unaligned).accessibleName, "not ranked (unaligned)");
  assert.equal(cellState(FIXTURES.stale).accessibleName, "stale: no rank (400 days old, limit 120 days)");
  assert.equal(cellState(FIXTURES.descriptive).accessibleName, "descriptive, not ranked");
  assert.equal(cellState(FIXTURES.ranked).accessibleName, "0.90, percentile vs all ranked countries");
  // AC-DASH-9: even a stored percentile cannot make a lagging or unaligned cell "ranked"
  assert.equal(cellState({...FIXTURES.lagging, status: "ranked", percentile: 0.5}).key, "lagging");
  assert.equal(cellState({...FIXTURES.unaligned, status: "ranked", percentile: 0.5}).key, "unaligned");
});

test("estimate and alert marks are decorations with their own signature and a visible word", () => {
  assert.deepEqual(cellState(FIXTURES.estimate).decorations.map((d) => d.code), ["e"]);
  assert.equal(cellState(FIXTURES.estimate).signature, "solid+e-suffix");
  assert.equal(cellState(FIXTURES.alert_watch).decorations[0].glyph, "triangle");
  assert.equal(cellState(FIXTURES.alert_alert).decorations[0].glyph, "diamond");
  assert.equal(cellState(FIXTURES.alert_alert).decorations[0].code, "alert level: alert");
  assert.equal(cellState(FIXTURES.na).decorations.length, 0);
});

test("exhaustive: every status of scorecard.js maps, and the exports list every status literal in the file", () => {
  const sample = {ranked: FIXTURES.ranked, stale: FIXTURES.stale, unranked: cell({percentile: null}), descriptive: FIXTURES.descriptive, missing: FIXTURES.na, not_published: FIXTURES.not_published};
  assert.deepEqual(Object.keys(sample).sort(), [...CELL_STATUSES].sort());
  for (const [status, c] of Object.entries(sample)) assert.equal(c.status, status), assert.ok(cellState(c).signature);
  const summary = {ranked: {status: "ranked", meanText: "0.85"}, low_coverage: SUMMARY.low_coverage, "n/a": {status: "n/a"}, aggregate: SUMMARY.aggregate, unranked_domain: {status: "unranked_domain", meanText: "unranked"}};
  assert.deepEqual(Object.keys(summary).sort(), [...SUMMARY_STATUSES].sort());
  for (const s of Object.values(summary)) assert.ok(summaryState(s).signature);
  // a status literal added to scorecard.js without being listed in CELL_STATUSES or SUMMARY_STATUSES fails here
  const src = readFileSync(new URL("../src/lib/scorecard.js", import.meta.url), "utf8");
  const literals = new Set(src.split("\n").filter((l) => /\bstatus(?:: | = )/.test(l)).flatMap((l) => [...l.matchAll(/"([a-z_/]+)"/g)].map((m) => m[1])));
  literals.delete("ok");
  assert.deepEqual([...literals].sort(), [...new Set([...CELL_STATUSES, ...SUMMARY_STATUSES])].sort());
});

test("a status without a mapping throws", () => {
  assert.throws(() => cellState({status: "brand_new"}), StateError);
  assert.throws(() => summaryState({status: "brand_new"}), StateError);
});

test("an unranked-domain value is plain (neutral surface), with its value and the confirmed text in the name", () => {
  const c = cell({percentile: 0.5}, false);
  assert.equal(cellState(c).key, "plain");
  assert.equal(cellState(c).accessibleName, "3.1, unranked domain");
});

test("glyphs are inline SVG, aria-hidden, defined once; an unknown glyph throws", () => {
  const sprite = glyphSprite(html).s;
  for (const n of GLYPH_NAMES) assert.ok(sprite.includes(`id="mm-g-${n}"`), n);
  assert.ok(sprite.includes('aria-hidden="true"'));
  const g = glyph(html, "clock").s;
  assert.ok(g.startsWith("<svg") && g.includes('aria-hidden="true"') && g.includes('href="#mm-g-clock"'));
  assert.throws(() => glyph(html, "smiley"));
  for (const s of [...Object.values(STATES), ...Object.values(DECORATIONS)]) assert.ok(s.glyph === null || GLYPH_NAMES.includes(s.glyph));
});
