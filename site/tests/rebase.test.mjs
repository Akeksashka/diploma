// V13 (A1.5, AC-V2-73 amended, 74, 91): the display-only rebase stays in the code, but is offered only when stored metadata marks an index (scale_hint = index, CR-18).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {isRebasable, rebase, rebaseOffered} from "../src/lib/rebase.js";
import {buildModel, explorerContext} from "../src/lib/explorer.js";
import {indicators, manifest, series} from "./support/load-v2.mjs";

test("A1.5: the rebase is offered only for scale_hint = index; nothing else switches it on", () => {
  assert.equal(rebaseOffered({scale_hint: "index"}), true);
  for (const i of [{}, null, undefined, {scale_hint: "level"}, {scale_hint: "rate"}, {scale_hint: "change"}, {scale_hint: "INDEX"}, {unit_label: "index"}, {unit_label: "index, 2015 = 100"}, {base_period: "2015"}, {unit_label: "index", base_period: "2015"}]) {
    assert.equal(rebaseOffered(i), false, JSON.stringify(i));
  }
});

test("A1.5: no indicator of the fixture is offered a rebase, including the index series with a base_period and a unit_label that reads index (AC-V2-73)", () => {
  assert.ok(indicators.some((i) => i.unit_label === "index"), "the fixture has indicators whose unit_label reads index");
  assert.ok(series.some((s) => s.base_period), "and series with a base_period");
  assert.deepEqual(indicators.filter((i) => rebaseOffered(i)).map((i) => i.indicator_id), []);
});

test("A1.5: PG-SERIES builds the rebase toggle and the base-period select only behind rebaseOffered (the browser check is in tests/smoke/series.smoke.mjs)", () => {
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "explorer-view.js"), "utf8");
  assert.match(code, /const offered = rebaseOffered\(ctx\.indicatorById\.get\(indicatorId\)\);/);
  assert.match(code, /const toggle = offered \? html`/);
  assert.match(code, /base: offered \? selectBox\(/);
  assert.match(code, /\$\{box\.rebase \?\? ""\}\$\{box\.base \?\? ""\}/);
});

test("A1.5: the explorer ignores a rebase request for a non-index indicator, so no hidden path draws a false index", () => {
  const ctx = explorerContext({manifest, seriesMeta: series, entities: [{entity_id: "DEU", name: "Germany"}], indicators, alerts: []});
  const rows = [{entity: "DEU", seriesId: series.find((s) => s.indicator_id === "P01" && s.entity_id === "DEU").series_id, end: Date.UTC(2024, 0, 31), frequency: "M", value: 120, value_default_tf: 120, value_yoy: null, status: "OBS", knownAt: 0, loadKind: "initial"}];
  const m = buildModel(ctx, "P01", rows, {entities: ["DEU"], transform: "value", from: "", to: "", rebase: true, base: "auto"});
  assert.equal(m.rebase, false);
  assert.equal(m.plotted[0].value, 120);
});

test("the pure scaling is unchanged: value / base * 100 at the base period; an unusable base gives null, never zero (AC-DASH-6)", () => {
  const rows = [{period: 1, value: 50}, {period: 2, value: 75}, {period: 3, value: null}];
  assert.deepEqual(rebase(rows, 1).map((r) => r.value), [100, 150, null]);
  assert.deepEqual(rebase([{period: 1, value: 0}, {period: 2, value: 5}], 1).map((r) => r.value), [null, null]);
  assert.deepEqual(rebase([{period: 1, value: -4}, {period: 2, value: 5}], 1).map((r) => r.value), [null, null]);
  assert.equal(isRebasable(0.0001), true);
  assert.equal(isRebasable(0), false);
});

test("the rebase module reads no unit text: it never tests unit_label or unit_text (AC-V2-91)", () => {
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "rebase.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /unit_label|unit_text|base_period/);
});
