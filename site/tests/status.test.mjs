import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {COV01_NOT_YET, NOT_EXPORTED, NO_ANALYSIS_RUN, NO_WINDOW, StatusError, parseStatus, statusView, withThousands} from "../src/lib/status.js";
import {statusPage} from "../src/lib/status-view.js";

class Raw {
  constructor(s) {
    this.s = s;
  }
}
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : v == null ? "" : esc(v));
const html = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? part(vals[i]) : ""), ""));

const ERR = "Traceback: connection refused to db host secret-host:5432";
const doc = () => ({
  schema_version: "1.0",
  last_run: {ingest_run_id: 7, started_at: "2026-11-01T04:00:03Z", finished_at: "2026-11-01T04:21:40Z", mode: "monthly", new_raw_objects: 1234, new_observations: 1834000, revisions: 17, alerts_opened: 3},
  groups: [
    {source_group: "eurostat", series_group: "labour", state: "fresh", expected_period_end: "2026-09-30", latest_period_end: "2026-09-30", evaluated_at: "2026-11-01T04:20:00Z", load_result: null},
    {source_group: "oecd_withheld", series_group: "prices", state: "stale", expected_period_end: "2026-08-31", latest_period_end: null, evaluated_at: "2026-11-01T04:20:00Z", load_result: null}
  ],
  backlog: {n_unloaded: 2, oldest_age_days: 5},
  validation: {
    counts: [{check_family: "CUR", severity: "warn", n_results: 410, n_failed: 6}],
    cov01: [{indicator_id: "M09", state: "not_yet_measurable", n_qualifying: 3}, {indicator_id: "P01", state: "measured", n_qualifying: 8, n_results: 8, n_failed: 1}],
    open_drift: {n_open: 2, by_kind: {schema_change: 1, unit_change: 1}}
  },
  manual_sources: [
    {source_id: "imf_weo_manual", last_edition_date: "2026-04-14", last_ingested_at: "2026-04-20T09:00:00Z", next_expected: {window_from: "2026-10-10", window_to: "2026-10-25", remind_on: "2026-10-15"}},
    {source_id: "x_manual", last_edition_date: null, last_ingested_at: null, next_expected: null}
  ],
  schedule_check: {generated_at: "2026-11-01T04:23:41Z", text: "Monthly check on the 2nd (about two minutes): (1) open the Actions tab."}
});
const page = (d) => statusPage(html, statusView(d)).s;

test("counts are shown as exported (no recomputation), alerts from last_run", () => {
  const vm = statusView(doc());
  assert.equal(vm.lastRun.newObservations, "1,834,000");
  assert.equal(vm.lastRun.revisions, "17");
  assert.equal(vm.alerts.value, "3");
  assert.deepEqual(vm.counts[0], {family: "CUR", severity: "warn", results: "410", failed: "6"});
  assert.equal(vm.backlog.unloaded, "2");
  assert.equal(vm.backlog.oldest, "5 days");
  assert.equal(vm.drift.open, "2");
  const out = page(doc());
  assert.match(out, /id="active-alerts"[^>]*>3</);
  assert.match(out, /id="drift-open">2 open: schema_change 1, unit_change 1\./);
  assert.equal(withThousands(1234567), "1,234,567");
});

test("alerts_opened null means no analysis run, not zero", () => {
  const d = doc();
  d.last_run.alerts_opened = null;
  assert.equal(statusView(d).alerts.value, NO_ANALYSIS_RUN);
  assert.match(page(d), new RegExp(NO_ANALYSIS_RUN));
});

test("COV-01 not yet measurable is shown, measured shows only exported numbers", () => {
  const vm = statusView(doc());
  assert.equal(vm.cov01[0].stateLabel, COV01_NOT_YET);
  assert.equal(vm.cov01[0].results, "n/a");
  assert.deepEqual([vm.cov01[1].qualifying, vm.cov01[1].results, vm.cov01[1].failed], ["8", "8", "1"]);
  const out = page(doc());
  assert.match(out, /data-state="not_yet_measurable"><td>M09<\/td><td>not yet measurable</);
  assert.ok(!/%/.test(out.replace(/<style>[^]*?<\/style>/, "")), "no share is computed or shown");
});

test("null load_result shows fixed wording; export gaps are stated on the page", () => {
  const vm = statusView(doc());
  assert.ok(vm.groups.every((g) => g.load === NOT_EXPORTED));
  const out = page(doc());
  assert.match(out, /not part of the export yet/);
  assert.match(out, /no backlog per group/);
  assert.match(out, /share of entities that were stale on arrival is not part of the export/);
  assert.equal(vm.groups[0].latest, "n/a"); // null date (the stale group sorts first)
});

test("a withheld group carries state and dates only; stray fields never render", () => {
  const d = doc();
  const dirty = {error: ERR, message: ERR, value: 4.2, z: 3.1, old: {x: 1}, new: {x: 2}};
  Object.assign(d.groups[1], dirty);
  Object.assign(d.last_run, dirty);
  Object.assign(d.backlog, dirty);
  Object.assign(d.validation.cov01[0], dirty);
  Object.assign(d.validation.open_drift, dirty);
  Object.assign(d.manual_sources[0], dirty);
  Object.assign(d.schedule_check, {error: ERR});
  const out = page(d);
  for (const needle of ["Traceback", "secret-host", "4.2", "3.1", "connection refused"]) assert.ok(!out.includes(needle), needle);
});

test("error-like text in enum or code fields is replaced by fixed wording", () => {
  const d = doc();
  d.groups[0].state = ERR;
  d.groups[0].load_result = ERR;
  d.groups[0].source_group = ERR;
  d.last_run.mode = ERR;
  d.validation.cov01[0].state = ERR;
  d.validation.open_drift.by_kind = {[ERR]: 1};
  d.manual_sources[0].next_expected.window_from = ERR;
  d.last_run.started_at = ERR;
  const out = page(d);
  assert.ok(!out.includes("Traceback") && !out.includes("secret-host"));
  assert.match(out, /unrecognised state/);
  assert.match(out, /not shown/);
});

test("next manual download and the monthly check text", () => {
  const vm = statusView(doc());
  assert.equal(vm.manual[0].next, "between 2026-10-10 and 2026-10-25 (reminder on 2026-10-15)");
  assert.equal(vm.manual[1].next, NO_WINDOW);
  assert.match(page(doc()), /id="monthly-check-text">Monthly check on the 2nd/);
});

test("unknown major and malformed documents are refused", () => {
  assert.throws(() => parseStatus({...doc(), schema_version: "2.0"}), StatusError);
  assert.throws(() => parseStatus(null), StatusError);
  const d = doc();
  delete d.groups;
  assert.throws(() => statusView(d), StatusError);
});

test("page source: FileAttachment in the page only, no page variable named view, no recomputation", () => {
  const md = readFileSync(new URL("../src/status.md", import.meta.url), "utf8");
  assert.match(md, /FileAttachment\("data\/status\.json"\)/);
  assert.ok(!/\b(const|let|var)\s+view\b/.test(md));
  for (const f of ["status.js", "status-view.js"]) {
    const src = readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/FileAttachment/.test(src));
    assert.ok(!/\.reduce\(|Math\./.test(src), "no arithmetic over counts");
  }
});

test("T128: groups are ordered by stored severity (exported order within a state); chips carry word, glyph and signature; no overall state", () => {
  const d = doc();
  const g = (state, n) => ({source_group: n, series_group: "x", state, expected_period_end: "2026-09-30", latest_period_end: null, evaluated_at: "2026-11-01T04:20:00Z", load_result: null});
  d.groups = [g("fresh", "a"), g("late", "b"), g("weird", "c"), g("broken", "d"), g("stale", "e"), g("broken", "f"), g("fresh", "h")];
  const vm = statusView(d);
  assert.deepEqual(vm.groups.map((x) => x.source), ["d", "f", "e", "b", "c", "a", "h"]);
  assert.equal(vm.groups[4].stateLabel, "unrecognised state");
  const out = page(d);
  assert.equal((out.match(/class="mm-feed"/g) ?? []).length, 7);
  for (const w of ["fresh", "late", "stale", "broken"]) assert.match(out, new RegExp(`class="mm-feed-word">${w}<`));
  assert.ok(!/<svg[^>]*class="mm-glyph"(?![^>]*aria-hidden="true")/.test(out), "every chip glyph is aria-hidden");
  assert.ok(/id="mm-fg-hourglass"/.test(out) && /id="mm-fg-check"/.test(out));
  assert.ok(!/overall|traffic/i.test(out), "no overall indicator (D6, B2)");
  assert.match(out, /not part of the export yet/);
});
