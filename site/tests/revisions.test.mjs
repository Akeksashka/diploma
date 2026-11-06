import assert from "node:assert/strict";
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {listOf} from "../src/lib/meta.js";
import {
  EARLIEST_LABEL, KIND_OPTIONS, VINTAGE_TEXT, indicatorChoices, historyView, loadRevisions, parseRecent, periodChoices, recentView, revisionFileEntries, revisionsContext, seriesChoices, versionsFromTable, withThousands
} from "../src/lib/revisions.js";
import {editionsBlock, historyBlock, historyControls, noticeBlock, ordinaryBlock, selectBox, stepChart, stepPoints} from "../src/lib/revisions-view.js";
import {revisionPaths, revisionsPageSource} from "../scripts/lib.mjs";

// Minimal htl stand-in (same idea as peers.test.mjs).
class Raw {
  constructor(s) {
    this.s = s;
  }
  querySelector() {
    return {value: ""};
  }
}
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : v == null ? "" : esc(v));
const html = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? part(vals[i]) : ""), ""));

// The two forbidden phrases are built at run time so that this file does not contain them (the scan test below).
const FORBIDDEN = [["first", "release"], ["first", "stored", "release"]].map((w) => w.join(" "));

const MS = (iso) => Date.parse(iso);
const indicators = [
  {indicator_id: "M09", name: "Unemployment rate"},
  {indicator_id: "P01", name: "CPI inflation"},
  {indicator_id: "M10", name: "Employment rate"}
];
const entities = [{entity_id: "DEU", name: "Germany"}, {entity_id: "FRA", name: "France"}];
const sm = (series_id, indicator_id, entity_id) => ({series_id, indicator_id, entity_id, source_name: "Src", frequency: "M", seasonal_adjustment: "SA", unit_code: "PCT", unit_mult: 0});
const seriesMeta = [sm(100, "M09", "DEU"), sm(101, "M09", "FRA"), sm(401, "P01", "FRA"), sm(200, "M10", "DEU")];
const manifest = {files: [{path: "revisions/M09.parquet", format: "parquet", bytes: 5000}, {path: "revisions/M10.parquet", format: "parquet", bytes: 9000}, {path: "revisions/X99.parquet", format: "parquet", bytes: 1}, {path: "revisions_recent.json", format: "json", bytes: 10}, {path: "series/M09.parquet", format: "parquet", bytes: 3}]};
const ctx = () => revisionsContext({manifest, seriesMeta, entities, indicators});

const rrow = (o) => ({indicator_id: "M09", entity_id: "DEU", series_id: 100, ref_period_start: "2026-06-01", known_at: "2026-08-04T00:00:00Z", previous_value: 5, value: 5.2, revision_abs: 0.2, revision_pct: 4, load_kind: "revision", revision_class: "regular", ...o});
const doc = (revisions, editions = []) => ({schema_version: "1.0", known_cutoff: "2026-11-01T04:23:41Z", revisions, edition_summaries: editions});
const edition = {source_id: "imf_weo_manual", vintage_label: "WEO-2026-10", first_known_at: "2026-10-14T00:00:00Z", n_series: 25, n_keys_revised: 8123, max_abs_pct: 41.7, median_abs_pct: 0.9, top_revisions: [rrow({indicator_id: "M10", series_id: 200, revision_pct: 41.7}), rrow({indicator_id: "M10", series_id: 200, revision_pct: 3})]};

test("the fixed vintage text is exactly the spec text and carries no forbidden phrase", () => {
  assert.equal(
    VINTAGE_TEXT,
    "Vintages are recorded from this system's first fetch and are collected once a month. A revision that happens and is corrected between two fetches is not visible, and the earliest stored version is not necessarily the value the source published first. History before the first fetch is revised data, not real time."
  );
  const spec = readFileSync(new URL("../../docs/specs/dashboard-export-spec.md", import.meta.url), "utf8");
  assert.ok(spec.includes(`"${VINTAGE_TEXT}"`), "the text must be the quoted sentence of spec section 7");
  assert.equal(EARLIEST_LABEL, "earliest stored version");
  for (const p of FORBIDDEN) assert.ok(!VINTAGE_TEXT.toLowerCase().includes(p));
});

test("recent view: ordinary rows keep export order, regular vs reestimation filter, class distinguishable", () => {
  const rows = [rrow({revision_pct: 12.5}), rrow({entity_id: "FRA", series_id: 101, revision_pct: -6.25}), rrow({indicator_id: "P01", entity_id: "FRA", series_id: 401, revision_pct: 1.2, revision_class: "reestimation"})];
  const recent = parseRecent(doc(rows));
  const all = recentView(recent, ctx(), {kind: "all"});
  assert.deepEqual(all.rows.map((r) => r.pct), ["12.5 %", "-6.25 %", "1.2 %"]); // stored, as exported, not re-sorted
  assert.equal(all.nShown, 3);
  const reest = recentView(recent, ctx(), {kind: "reestimation"});
  assert.deepEqual(reest.rows.map((r) => r.cls), ["reestimation"]);
  assert.equal(reest.nTotal, 3);
  const reg = recentView(recent, ctx(), {kind: "regular"});
  assert.deepEqual(reg.rows.map((r) => r.cls), ["regular", "regular"]);
  assert.equal(recentView(recent, ctx(), {kind: "nonsense"}).kind, "all");
  assert.deepEqual(KIND_OPTIONS.map((o) => o.id), ["all", "regular", "reestimation"]);
  const out = ordinaryBlock(html, all).s;
  assert.match(out, /data-class="reestimation"[^]*?data-class-mark="reestimation">re-estimation</);
  assert.match(out, /data-class="regular"/);
  assert.ok(!/data-class="regular"[^]*?data-class-mark[^]*?<\/tr>/.exec(out)[0].split("</tr>")[0].includes("data-class-mark"));
});

test("display only: revision_abs and revision_pct are shown as exported, nothing recomputed (D6)", () => {
  const r = rrow({previous_value: 1, value: 2, revision_abs: 0.123456789, revision_pct: 77.5}); // inconsistent on purpose
  const v = recentView(parseRecent(doc([r])), ctx()).rows[0];
  assert.equal(v.abs, "0.123456789");
  assert.equal(v.pct, "77.5 %");
  for (const f of ["revisions.js", "revisions-view.js"]) {
    const src = readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/percentile|rankOf|\.sort\(\(a, b\) => b\./i.test(src), f);
    assert.ok(!/\bprevious\s*[-/*]\s*|\bvalue\s*-\s*r\.previous|Math\.(abs|round)/.test(src), `${f}: no recomputation`);
  }
});

test("tombstone and null values are shown as removed / n/a, not as zero", () => {
  const t = rrow({load_kind: "tombstone", value: null, revision_abs: null, revision_pct: null});
  const v = recentView(parseRecent(doc([t])), ctx()).rows[0];
  assert.equal(v.value, "removed");
  assert.equal(v.abs, "n/a");
  assert.equal(v.pct, "n/a");
});

test("headline series of published indicators only: stray rows are omitted and counted", () => {
  const rows = [rrow({}), rrow({series_id: 999}), rrow({indicator_id: "ZZZ", series_id: 100}), rrow({indicator_id: "M09", series_id: 200})];
  const rv = recentView(parseRecent(doc(rows)), ctx());
  assert.equal(rv.nTotal, 1);
  assert.equal(rv.omitted, 3);
  assert.match(ordinaryBlock(html, rv).s, /3 rows are not shown because they are not a headline series/);
  // only indicators known to meta/indicators.json get a revision file entry; X99 is not offered
  assert.deepEqual([...ctx().files.keys()], ["M09", "M10"]);
  assert.deepEqual(indicatorChoices(ctx()).map((c) => c.id), ["", "M09", "M10"]);
});

test("edition line follows the spec example and sits below a non-empty ordinary list", () => {
  const rv = recentView(parseRecent(doc([rrow({})], [edition])), ctx());
  assert.equal(rv.editions[0].line, "WEO-2026-10: 8,123 keys revised in 25 series, largest change 41.7 %, median 0.9 %");
  assert.deepEqual(rv.editions[0].indicatorIds, ["M10"]);
  const ordinary = ordinaryBlock(html, rv).s;
  const editions = editionsBlock(html, rv, {M10: "/_file/data/revisions/M10.abc.parquet"}).s;
  assert.ok(ordinary.includes('id="recent-revisions"'), "the ordinary list is not empty");
  const page = ordinary + editions; // page order: ordinary list, then editions
  assert.ok(page.indexOf('id="recent-revisions"') < page.indexOf('id="edition-lines"'));
  assert.match(editions, /<li data-source="imf_weo_manual" data-edition="WEO-2026-10"><span class="mm-edition-line">WEO-2026-10: 8,123 keys/);
  assert.match(editions, /<a href="\/_file\/data\/revisions\/M10\.abc\.parquet" download>M10<\/a>/);
  // edition rows are never in the ordinary list
  assert.ok(!ordinary.includes("WEO-2026-10"));
  assert.equal(withThousands(1234567), "1,234,567");
  assert.equal(withThousands(999), "999");
});

test("an empty ordinary list says so and the edition line is still shown", () => {
  const rv = recentView(parseRecent(doc([], [edition])), ctx());
  assert.match(ordinaryBlock(html, rv).s, /No ordinary revisions in the last 12 months/);
  assert.match(editionsBlock(html, rv).s, /WEO-2026-10: 8,123 keys/);
  assert.match(editionsBlock(html, recentView(parseRecent(doc([])), ctx())).s, /No named edition/);
  const none = editionView0();
  assert.equal(none.line, "WEO-2026-10: 0 keys revised in 0 series, largest change n/a, median n/a");
});

function editionView0() {
  const rv = recentView(parseRecent(doc([], [{...edition, n_series: 0, n_keys_revised: 0, max_abs_pct: null, median_abs_pct: null, top_revisions: []}])), ctx());
  return rv.editions[0];
}

test("an unknown major version of revisions_recent.json is refused", () => {
  assert.throws(() => parseRecent({...doc([]), schema_version: "2.0"}), /unsupported schema_version/);
  assert.throws(() => parseRecent({schema_version: "1.0", revisions: []}), /edition_summaries/);
});

// ---- the per-indicator revision file
const vrow = (o) => ({entity_id: "DEU", series_id: 100, ref_period_start: MS("2026-06-01"), ref_period_end: MS("2026-06-30"), known_at: MS("2026-07-02"), source_release_at: null, vintage_label: null, value: 5, value_status: "OBS", load_kind: "initial", is_base_version: true, revision_class: "regular", edition_ordered: false, revision_abs: null, revision_pct: null, ...o});
const fileRows = () =>
  versionsFromTable([
    vrow({}),
    vrow({known_at: MS("2026-08-04"), value: 5.2, load_kind: "revision", is_base_version: false, revision_abs: 0.2, revision_pct: 4}),
    vrow({known_at: MS("2026-10-05"), value: 5.1, load_kind: "revision", is_base_version: false, revision_abs: -0.1, revision_pct: -1.92, revision_class: "reestimation"}),
    vrow({ref_period_start: MS("2026-07-01"), ref_period_end: MS("2026-07-31"), known_at: MS("2026-08-04"), value: 5.1}),
    vrow({ref_period_start: MS("2026-07-01"), ref_period_end: MS("2026-07-31"), known_at: MS("2026-09-03"), value: null, value_status: "DEL", load_kind: "tombstone", is_base_version: false}),
    vrow({entity_id: "FRA", series_id: 101, value: 7.4})
  ]);

test("vintage history: earliest stored version label, later versions, tombstone, class marks", () => {
  const hv = historyView(ctx(), "M09", fileRows(), {series: "100"});
  assert.equal(hv.caption.country, "Germany");
  assert.equal(hv.nKeys, 2);
  const june = hv.keys[0];
  assert.deepEqual(june.versions.map((v) => v.label), [EARLIEST_LABEL, "later version 2 of 3", "later version 3 of 3"]);
  assert.deepEqual(june.versions.map((v) => v.value), ["5", "5.2", "5.1"]);
  assert.equal(june.versions[0].revisedData, true); // load_kind initial: revised-data history (D10)
  assert.equal(hv.keys[1].versions[1].value, "removed");
  const out = historyBlock(html, hv, {chosen: true}).s;
  assert.ok(out.includes(VINTAGE_TEXT));
  assert.ok(out.includes('id="vintage-text"'));
  assert.equal(out.split(`>${EARLIEST_LABEL}`).length - 1, 2);
  assert.match(out, /data-class="reestimation"[^]*?data-class-mark="reestimation"/);
  assert.match(out, /initial \(revised-data history\)/);
  for (const p of FORBIDDEN) assert.ok(!out.toLowerCase().includes(p));
});

test("vintage history: the series and period selectors choose the key; FRA is a different series", () => {
  const rows = fileRows();
  assert.deepEqual(seriesChoices(ctx(), "M09", rows).map((c) => c.label), ["France", "Germany"]);
  assert.equal(historyView(ctx(), "M09", rows, {series: "101"}).caption.country, "France");
  assert.equal(historyView(ctx(), "M09", rows, {series: "100", period: "2026-07-01"}).nKeys, 1);
  assert.equal(historyView(ctx(), "M09", rows, {series: "100", period: "2030-01-01"}).nKeys, 0);
  assert.match(historyBlock(html, historyView(ctx(), "M09", rows, {series: "100", period: "2030-01-01"}), {chosen: true}).s, /No stored versions of this series for that reference period/);
  assert.deepEqual(periodChoices(rows).map((c) => c.id), ["all", "2026-06-01", "2026-07-01"]);
  assert.equal(historyView(ctx(), "M09", rows, {series: "bogus"}).seriesId, 101); // falls back to the first choice (France)
  const sel = historyControls(html, ctx(), "M09", rows);
  assert.ok(sel.series.s.includes("France") && sel.period.s.includes("2026-07-01"));
  assert.ok(selectBox(html, {id: "x", label: "A<b>", options: [{id: "a", label: "A"}]}).s.includes("A&lt;b&gt;"));
});

test("vintage history of rows that are not headline series is empty", () => {
  const stray = versionsFromTable([vrow({series_id: 555})]);
  const hv = historyView(ctx(), "M09", stray, {});
  assert.equal(hv.seriesId, null);
  assert.match(historyBlock(html, hv, {chosen: true}).s, /No revised key of a headline series/);
  assert.match(historyBlock(html, hv, {chosen: false}).s, /Choose an indicator/);
  const failed = historyBlock(html, hv, {error: "boom"}).s;
  assert.ok(failed.includes('role="alert"') && failed.includes("revision file of this indicator") && !/boom/.test(failed)); // T105: no raw error text
  assert.ok(historyBlock(html, hv, {chosen: false}).s.includes(VINTAGE_TEXT)); // the fixed text is always on the vintage view
});

test("loadRevisions: size limit and format checks; no file is read without a choice", async () => {
  const att = {parquet: async () => [vrow({})], calls: 0};
  assert.deepEqual(await loadRevisions(undefined, undefined), {rows: [], error: null});
  assert.match((await loadRevisions({path: "revisions/M09.parquet", format: "parquet", bytes: 5_000_001}, att)).error, /above the 5000000 byte limit/);
  assert.match((await loadRevisions({path: "revisions/M09.parquet", format: "parquet", bytes: null}, att)).error, /gives no size/);
  assert.match((await loadRevisions({path: "revisions/M09.json", format: "json", bytes: 5}, att)).error, /Unsupported/);
  const ok = await loadRevisions({path: "revisions/M09.parquet", format: "parquet", bytes: 5000}, att);
  assert.equal(ok.rows.length, 1);
  const bad = await loadRevisions({path: "p", format: "parquet", bytes: 5}, {parquet: async () => { throw new Error("nope"); }});
  assert.match(bad.error, /Could not read p: nope/);
});

test("notice: revised data, not a real-time record", () => {
  assert.match(noticeBlock(html).s, /id="revised-data-notice">Revised data: this view is not a real-time record/);
});

// ---- generated page
test("revisions page: one lazy FileAttachment per revision file, called in the page, no variable named view", () => {
  const src = revisionsPageSource(manifest);
  assert.match(src, /"M09": FileAttachment\("data\/revisions\/M09\.parquet"\)/);
  assert.match(src, /"M10": FileAttachment\("data\/revisions\/M10\.parquet"\)/);
  assert.ok(src.includes('FileAttachment("data/revisions_recent.json")'));
  assert.ok(!/\b(const|let|var)\s+view\b/.test(src));
  assert.ok(!src.includes("series/M09"));
  assert.deepEqual(revisionPaths(manifest).map((p) => p.id), ["M09", "M10", "X99"]);
  assert.throws(() => revisionPaths({files: [{path: "revisions/../x.parquet"}]}), /unsafe revisions path/);
  assert.ok(!/FileAttachment/.test(readFileSync(new URL("../src/lib/revisions.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "")), "FileAttachment only in the page");
  assert.deepEqual([...revisionFileEntries(manifest).keys()], ["M09", "M10", "X99"]);
  assert.match(revisionsPageSource({files: []}), /const revisionFiles = \{\n\n\};/);
});

// ---- AC-EXP-12: neither phrase anywhere in site/ source
function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".observablehq", "package-lock.json"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else yield p;
  }
}

test("AC-EXP-12: neither forbidden phrase appears anywhere in site/ source", () => {
  const root = new URL("..", import.meta.url).pathname;
  let n = 0;
  for (const f of sourceFiles(root)) {
    if (!/\.(md|js|mjs|json|css|html|lock|yml)$/.test(f) && !f.endsWith(".gitignore")) continue;
    const text = readFileSync(f, "utf8").toLowerCase().replace(/[\s_-]+/g, " ");
    for (const p of FORBIDDEN) assert.ok(!text.includes(p), `${f} contains "${p}"`);
    n++;
  }
  assert.ok(n > 20, `scanned ${n} files`);
});

test("rendered fixture: ordinary list first, then one edition line, both regular and reestimation rows (generated fixture)", () => {
  const dir = process.env.MM_FIXTURE_EXPORT;
  if (!dir) return; // set by tests/unit/test_site_spike.py
  const load = (p) => JSON.parse(readFileSync(`${dir}/${p}`, "utf8"));
  const c = revisionsContext({manifest: load("manifest.json"), seriesMeta: listOf(load("meta/series.json"), "series"), entities: listOf(load("meta/entities.json"), "entities"), indicators: listOf(load("meta/indicators.json"), "indicators")});
  const rv = recentView(parseRecent(load("revisions_recent.json")), c);
  assert.ok(rv.nTotal > 0 && rv.omitted === 0);
  assert.ok(rv.nReestimation > 0 && rv.nReestimation < rv.nTotal);
  assert.equal(rv.editions.length, 1);
  assert.match(rv.editions[0].line, /^WEO-2026-10: 12 keys revised in 2 series, largest change 41\.7 %, median 5\.5 %$/);
  assert.deepEqual([...c.files.keys()], ["M09", "M10", "P01"]);
  const page = ordinaryBlock(html, rv).s + editionsBlock(html, rv, {}).s;
  assert.ok(page.indexOf('id="recent-revisions"') > 0 && page.indexOf('id="recent-revisions"') < page.indexOf('id="edition-lines"'));
  assert.ok(!page.includes('data-indicator="M10"'), "the WEO rebase is not in the ordinary list");
  // regular rows come before reestimation rows, as exported
  const classes = rv.rows.map((r) => r.cls);
  assert.equal(classes.indexOf("reestimation"), classes.lastIndexOf("regular") + 1);
});

test("T126: signed value with true minus, triangle, labelled bar relative to the largest shown, class mark as text", () => {
  const rows = [rrow({revision_abs: 0.2, revision_pct: 10}), rrow({entity_id: "FRA", series_id: 101, revision_abs: -0.1, revision_pct: -5, revision_class: "reestimation"}), rrow({revision_abs: 0, revision_pct: 0})];
  const rv = recentView(parseRecent(doc(rows)), ctx());
  assert.equal(rv.rows[1].pct, "-5 %"); // view model keeps the stored text
  const out = ordinaryBlock(html, rv).s;
  assert.match(out, /id="bar-label"[^>]*>Bar length \(revision %\) is relative to the largest revision shown\./);
  assert.ok(out.includes("+0.2") && out.includes("+10 %"));
  assert.ok(out.includes("−0.1") && out.includes("−5 %"));
  assert.ok(!/>-5 %|>-0\.1</.test(out), "no hyphen-minus in a signed cell");
  assert.match(out, /data-sign="pos"[^]*?<use href="#mm-g-triangle">/);
  assert.match(out, /class="mm-bar" data-sign="pos" data-bar="100\.0"/);
  assert.match(out, /class="mm-bar" data-sign="neg" data-bar="50\.0"/); // 5 of the largest 10
  assert.match(out, /data-sign="zero" data-bar="0\.0"/);
  assert.equal((out.match(/class="mm-signed" data-sign="zero"/g) ?? []).length, 2); // zero: no sign, no triangle
  assert.match(out, /data-class-mark="reestimation">re-estimation</);
  assert.match(out, /<td>regular<\/td>/);
});

test("T126: a null revision has no sign, no triangle and no bar", () => {
  const t = rrow({load_kind: "tombstone", value: null, revision_abs: null, revision_pct: null});
  const out = ordinaryBlock(html, recentView(parseRecent(doc([t])), ctx())).s;
  assert.ok(!out.includes("mm-bar\"") && !out.includes("mm-signed"));
});

// ---- T127 step chart
// Plot stand-in: records the marks so that the plotted points can be compared with the version table.
const fakePlot = {
  plot: (o) => ({plotted: o.marks, o}),
  line: (d, o) => ({k: "line", d, o}),
  dot: (d, o) => ({k: "dot", d, o}),
  text: (d, o) => ({k: "text", d, o}),
  ruleX: (d, o) => ({k: "ruleX", d, o})
};
class Chart extends Raw {}
const htmlC = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? part(vals[i]) : ""), ""));

test("step chart: plotted points equal the version table rows of the key; earliest hollow and labelled, tombstone is a cross with the word removed", () => {
  const hv = historyView(ctx(), "M09", fileRows(), {series: "100", period: "2026-07-01"}); // base, then a tombstone
  const pts = stepPoints(hv.keys[0]);
  assert.deepEqual(pts.map((p) => p.valueText), ["5.1", "removed"]);
  assert.deepEqual(pts.map((p) => p.tombstone), [false, true]);
  const out = historyBlock(htmlC, hv, {chosen: true, Plot: fakePlot}).s;
  const rows = out.split("<tbody>")[2].split("<tr ").slice(1); // history table body (caption table is first)
  assert.equal(rows.length, pts.length);
  pts.forEach((p, i) => assert.ok(rows[i].includes(p.knownAt) && rows[i].includes(`>${p.valueText}<`)));
  assert.match(out, /id="step-figure"[^>]*role="img"[^>]*aria-label="Step chart of M09 Unemployment rate for Germany, reference period 2026-07-01/);
  assert.ok(out.includes('href="#vintage-history"'));
  const chart = stepChart(fakePlot, pts, "PCT").plotted;
  assert.equal(chart.find((m) => m.k === "line").o.curve, "step-after");
  const hollow = chart.find((m) => m.k === "dot" && m.o.fill === "none");
  assert.deepEqual(hollow.d.map((p) => p.base), [true]);
  assert.equal(chart.find((m) => m.k === "text" && m.d[0].base).o.text(), EARLIEST_LABEL);
  assert.equal(chart.find((m) => m.k === "ruleX").d.length, 1);
  assert.equal(chart.find((m) => m.k === "text" && m.d[0].tombstone).o.text(), "\u00d7 removed");
  assert.ok(!chart.find((m) => m.k === "line").d.some((p) => p.tombstone), "no value is invented for a tombstone");
});

test("step chart: three versions plotted in stored order with stored values; several periods ask for one", () => {
  const hv = historyView(ctx(), "M09", fileRows(), {series: "100", period: "2026-06-01"});
  const pts = stepPoints(hv.keys[0]);
  assert.deepEqual(pts.map((p) => p.valueText), ["5", "5.2", "5.1"]);
  assert.deepEqual(pts.map((p) => p.date.getTime()), [MS("2026-07-02"), MS("2026-08-04"), MS("2026-10-05")]);
  const all = historyBlock(htmlC, historyView(ctx(), "M09", fileRows(), {series: "100"}), {chosen: true, Plot: fakePlot}).s;
  assert.ok(all.includes('id="step-choose"') && !all.includes("step-figure"));
  assert.ok(all.includes(VINTAGE_TEXT)); // FIXED text stays visible
  for (const p of FORBIDDEN) assert.ok(!all.toLowerCase().includes(p));
});

test("history summary line pluralises: one reference period and two stored versions, several periods", () => {
  const one = historyBlock(htmlC, historyView(ctx(), "M09", fileRows(), {series: "100", period: "2026-07-01"}), {chosen: true, Plot: fakePlot}).s;
  assert.ok(one.includes("1 reference period, 2 stored versions shown."), one.slice(0, 400));
  assert.ok(!one.includes("1 reference periods"));
  const all = historyBlock(htmlC, historyView(ctx(), "M09", fileRows(), {series: "100"}), {chosen: true, Plot: fakePlot}).s;
  assert.match(all, /\d+ reference periods, \d+ stored versions shown\./);
});
