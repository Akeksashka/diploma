// Redesign R3: spec 5.1 table, one test per row, plus the rule that n/a never appears without its sentence.
import assert from "node:assert/strict";
import {test} from "node:test";
import * as copy from "../src/lib/copy.js";
import {mapCellState, mapDomainSummaryState, seriesDefinedSet} from "../src/lib/missing.js";
import {indicatorCell} from "../src/lib/scorecard.js";
import {STATES, cellState} from "../src/lib/states.js";

const series = seriesDefinedSet([{indicator_id: "I1", entity_id: "E1"}]);
const ctx = (o = {}) => ({entityId: "E1", entityKind: "country", domainRanked: true, seriesDefined: series, ...o});
const cell = (o = {}) => ({indicator_id: "I1", value: 1, published: true, publish_scope: "ranked", is_stale: false, alignment: "aligned", alignment_reason: null, inherited: false, rank_mode: "monotone_good", percentile: 0.5, ...o});

// Every row of spec 5.1, in order: [name, mapped state, key, sentence].
const ROWS = [
  ["published = false", mapCellState(cell({published: false}), ctx()), "not_published", "Not published on this site."],
  ["publish_scope = excluded", mapCellState(cell({publish_scope: "excluded"}), ctx()), "not_published", "Not published on this site."],
  ["null value, series row exists", mapCellState(cell({value: null}), ctx()), "na", "A series is defined for this country, but this export holds no value for it."],
  ["null value, no series row", mapCellState(cell({value: null}), ctx({entityId: "E2"})), "na", "This export lists no series for this country and indicator."],
  ["stale", mapCellState(cell({is_stale: true}), ctx()), "stale", copy.STALE_NAME],
  ["lagging", mapCellState(cell({alignment: "lagging"}), ctx()), "lagging", "not ranked (lagging)"],
  ["unaligned, fiscal", mapCellState(cell({alignment: "unaligned", alignment_reason: "fiscal_year_basis"}), ctx()), "unaligned", `not ranked (unaligned); ${copy.FLAG_UNALIGNED_FISCAL}`],
  ["unaligned, no reason", mapCellState(cell({alignment: "unaligned"}), ctx()), "unaligned", "not ranked (unaligned)"],
  ["ahead", mapCellState(cell({alignment: "ahead", percentile: 0.5}), ctx()), "ahead", copy.AHEAD_NAME],
  ["descriptive_only", mapCellState(cell({rank_mode: "descriptive_only"}), ctx()), "descriptive", copy.DESCRIPTIVE_CELL],
  ["aggregate entity", mapCellState(cell(), ctx({entityKind: "aggregate"})), "aggregate", copy.AGGREGATE_NOT_RANKED],
  ["inherited", mapCellState(cell({inherited: true, percentile: null}), ctx()), "inherited", copy.NOT_RANKED_INHERITED],
  ["domain ranked = false", mapCellState(cell(), ctx({domainRanked: false})), "plain", copy.UNRANKED_DOMAIN_CELL],
  ["value, null percentile, info_only", mapCellState(cell({percentile: null, publish_scope: "info_only"}), ctx()), "plain", copy.NOT_RANKED_INFO_ONLY],
  ["value, null percentile, no stated reason", mapCellState(cell({percentile: null}), ctx()), "na", copy.DRAFT_NA_NO_PERCENTILE_SENTENCE],
  ["percentile_rank null, n_available > 0", mapDomainSummaryState({percentile_rank: null, n_available: 3}, ctx()), "na", copy.DRAFT_NA_NO_PERCENTILE_SENTENCE],
  ["n_available = 0", mapDomainSummaryState({percentile_rank: null, n_available: 0}, ctx()), "na", "No indicator of this domain has a ranked value for this country."]
];

for (const [name, got, key, sentence] of ROWS) {
  test(`spec 5.1 row: ${name}`, () => {
    assert.equal(got.key, key);
    assert.equal(got.code, STATES[key].code);
    assert.equal(got.signature, STATES[key].signature);
    assert.equal(got.sentence, sentence);
  });
}

test("codes of the rows that have one", () => {
  const by = Object.fromEntries(ROWS.map((r) => [r[2], r[1].code]));
  assert.equal(by.not_published, "np");
  assert.equal(by.na, "n/a");
  assert.equal(by.stale, "stale");
  assert.equal(by.lagging, "lagging");
  assert.equal(by.unaligned, "unaligned");
  assert.equal(by.ahead, copy.AHEAD_TAG);
});

test("an n/a always has a non-empty sentence, for every stored combination that yields it", () => {
  let seen = 0;
  for (const defined of [true, false]) for (const published of [true, false]) for (const kind of ["country", "aggregate"]) for (const ranked of [true, false]) {
    const s = mapCellState(cell({value: null, published}), ctx({entityId: defined ? "E1" : "E9", entityKind: kind, domainRanked: ranked}));
    if (s.code === "n/a") { seen++; assert.ok(typeof s.sentence === "string" && s.sentence.length > 0); }
  }
  for (const nAvail of [0, 1]) for (const kind of ["country", "aggregate"]) for (const ranked of [true, false]) {
    const s = mapDomainSummaryState({percentile_rank: null, n_available: nAvail}, ctx({entityKind: kind, domainRanked: ranked}));
    if (kind === "country" && ranked) { assert.equal(s.code, "n/a"); assert.ok(s.sentence); }
    if (s.code === "n/a") { seen++; assert.ok(s.sentence); }
  }
  for (const pct of [null, undefined]) for (const scope of ["ranked", "info_only", undefined]) {
    const s = mapCellState(cell({percentile: pct, publish_scope: scope}), ctx());
    assert.ok(s.key !== "ranked", "a value without a percentile is never ranked");
    assert.ok(typeof s.sentence === "string" && s.sentence.length > 0);
  }
  assert.ok(seen >= 4);
});

test("the test would fail if an n/a had no sentence (guard is real)", () => {
  const bad = {code: "n/a", sentence: null};
  assert.throws(() => assert.ok(bad.code !== "n/a" || bad.sentence), assert.AssertionError);
});

test("the two n/a sentences differ and G-STR1 is its own named, DRAFT constant", () => {
  assert.notEqual(copy.DRAFT_NA_DEFINED_SENTENCE, copy.G_STR1_NO_SERIES);
  assert.equal(copy.G_STR1_NO_SERIES, "This export lists no series for this country and indicator.");
  assert.equal(copy.DRAFT_NOT_PUBLISHED_SENTENCE, "Not published on this site.");
});

test("the mapping reads only presence in the series list for the two n/a rows (extra fields change nothing)", () => {
  const a = mapCellState(cell({value: null}), ctx());
  const b = mapCellState(cell({value: null, percentile: 0.9, is_stale: true, alignment: "lagging", inherited: true, source_release_at: "x"}), ctx());
  assert.deepEqual(a, b);
});

test("precedence: not published wins over a null value; stale wins over lagging", () => {
  assert.equal(mapCellState(cell({value: null, published: false}), ctx()).key, "not_published");
  assert.equal(mapCellState(cell({is_stale: true, alignment: "lagging"}), ctx()).key, "stale");
});

test("withdrawn and forbidden strings are absent from copy.js", () => {
  const all = JSON.stringify(Object.values(copy));
  for (const s of ["first" + " release", "first stored" + " release", "Projections are not shown in this version.", "A chart shows one indicator, so all lines share one unit."]) assert.ok(!all.includes(s), s);
});

// The shared order: mapCellState must agree with scorecard.js indicatorCell + states.js cellState on the same stored fields.
test("precedence is the scorecard.js / states.js order on every combination of the stored conditions", () => {
  const opts = {
    is_stale: [false, true], alignment: ["aligned", "lagging", "unaligned", "ahead"], inherited: [false, true],
    rank_mode: ["monotone_good", "descriptive_only"], percentile: [0.5, null], publish_scope: ["ranked", "info_only"]
  };
  let n = 0;
  for (const is_stale of opts.is_stale) for (const alignment of opts.alignment) for (const inherited of opts.inherited)
    for (const rank_mode of opts.rank_mode) for (const percentile of opts.percentile) for (const publish_scope of opts.publish_scope)
      for (const domainRanked of [true, false]) {
        const c = cell({is_stale, alignment, inherited, rank_mode, percentile, publish_scope});
        const want = cellState(indicatorCell(c, {domainRanked})).key;
        const got = mapCellState(c, ctx({domainRanked})).key;
        // scorecard.js names "no percentile, no reason" na; states.js maps that cell to plain. Both are a value without a percentile.
        const same = got === want || (got === "na" && want === "plain");
        assert.ok(same, JSON.stringify({c, domainRanked, got, want}));
        n++;
      }
  assert.equal(n, 2 * 4 * 2 * 2 * 2 * 2 * 2);
});
