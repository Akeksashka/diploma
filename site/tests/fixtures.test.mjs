// Redesign R3: sanity of the SYNTHETIC sparse fixture (invented data; not a measurement, plan gate G-Q4).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {allExtras} from "./support/make-sparse-extras.mjs";
import {mapCellState, mapDomainSummaryState, seriesDefinedSet} from "../src/lib/missing.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sparse_export");
const load = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const entities = load("meta/entities.json").entities;
const kind = Object.fromEntries(entities.map((e) => [e.entity_id, e.kind]));
const series = load("meta/series.json").series;
const defined = seriesDefinedSet(series);
const sc = {growth: load("scorecard/growth.json"), fin: load("scorecard/fin.json"), agri: load("scorecard/agri.json")};
const cellOf = (d, e, i) => sc[d].entities.find((x) => x.entity_id === e).indicators.find((c) => c.indicator_id === i);

test("the fixture is labelled synthetic and says it is not a measurement", () => {
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  assert.match(readme, /SYNTHETIC/);
  assert.match(readme, /not a measurement/);
  assert.ok(entities.every((e) => /^SY/.test(e.entity_id)));
  assert.ok(series.every((s) => s.source_name === "Synthetic"));
});

test("44 entities, 3 aggregates, in every scorecard", () => {
  assert.equal(entities.length, 44);
  assert.equal(entities.filter((e) => e.kind === "aggregate").length, 3);
  for (const d of Object.values(sc)) assert.equal(d.entities.length, 44);
});

test("growth has exactly 3 domain percentiles; fin and agri have none", () => {
  const n = (d) => sc[d].entities.filter((e) => e.percentile_rank !== null).length;
  assert.equal(n("growth"), 3);
  assert.equal(n("fin"), 0);
  assert.equal(n("agri"), 0);
});

test("the two-domain indicator has equal stored percentiles in both scorecards", () => {
  const dom = load("meta/domains.json").domains.filter((d) => d.indicator_ids.includes("T01")).map((d) => d.domain_id).sort();
  assert.deepEqual(dom, ["fin", "growth"]);
  let nonNull = 0;
  for (const e of entities) {
    const a = cellOf("growth", e.entity_id, "T01").percentile;
    const b = cellOf("fin", e.entity_id, "T01").percentile;
    assert.equal(a, b, e.entity_id);
    if (a !== null) nonNull++;
  }
  assert.equal(nonNull, 3);
});

test("defined-but-empty and undefined pairs map to their two different sentences", () => {
  assert.equal(cellOf("growth", "SY07", "T04").value, null);
  assert.equal(cellOf("growth", "SY08", "T04").value, null);
  assert.ok(defined.has("T04|SY07"));
  assert.ok(!defined.has("T04|SY08"));
  const m = (e) => mapCellState(cellOf("growth", e, "T04"), {entityId: e, entityKind: kind[e], domainRanked: true, seriesDefined: defined});
  assert.equal(m("SY07").code, "n/a");
  assert.equal(m("SY08").code, "n/a");
  assert.notEqual(m("SY07").sentence, m("SY08").sentence);
});

test("each state of spec 5.1 occurs in the fixture and maps as expected", () => {
  const m = (d, e, i) => mapCellState(cellOf(d, e, i), {entityId: e, entityKind: kind[e], domainRanked: sc[d].ranked, seriesDefined: defined}).key;
  assert.equal(m("growth", "SY01", "T02"), "ranked"); // estimate
  assert.equal(cellOf("growth", "SY01", "T02").value_kind, "estimate");
  assert.equal(m("growth", "SY02", "T02"), "inherited");
  assert.equal(m("growth", "SY03", "T02"), "stale");
  assert.equal(m("growth", "SY04", "T02"), "lagging");
  assert.equal(m("growth", "SY05", "T02"), "unaligned");
  assert.equal(m("growth", "SY06", "T02"), "ahead");
  assert.equal(m("growth", "SY09", "T02"), "not_published");
  assert.equal(m("growth", "SY01", "T03"), "descriptive");
  assert.equal(m("growth", "SYA1", "T01"), "aggregate");
  assert.equal(m("agri", "SY01", "T05"), "plain");
});

test("n_available = 0 occurs and maps to its sentence; ranked rows do not", () => {
  const s = (e) => mapDomainSummaryState(sc.growth.entities.find((x) => x.entity_id === e), {entityId: e, entityKind: kind[e], domainRanked: true});
  assert.equal(sc.growth.entities.find((x) => x.entity_id === "SY20").n_available, 0);
  assert.equal(s("SY20").code, "n/a");
  assert.equal(s("SY02").key, "ranked");
});

test("every null-valued published cell of the fixture maps to an n/a with a sentence", () => {
  let n = 0;
  for (const [d, o] of Object.entries(sc)) for (const e of o.entities) for (const c of e.indicators) {
    if (c.value === null && c.published) {
      const s = mapCellState(c, {entityId: e.entity_id, entityKind: kind[e.entity_id], domainRanked: o.ranked, seriesDefined: defined});
      assert.equal(s.code, "n/a");
      assert.ok(s.sentence);
      n++;
    }
  }
  assert.ok(n > 100);
});

test("the build-completeness files are the generator output, and the manifest hashes match the files", () => {
  for (const [p, t] of Object.entries(allExtras())) assert.equal(readFileSync(join(dir, p), "utf8"), t, `${p} drifted from tests/support/make-sparse-extras.mjs`);
  const m = load("manifest.json");
  assert.equal(m.schema_version, "1.0");
  assert.ok(m.files.length > 0 && m.files.every((f) => f.format === "json"), "no series files");
  for (const f of m.files) {
    const bytes = readFileSync(join(dir, f.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, f.path);
    assert.equal(bytes.length, f.bytes, f.path);
  }
  assert.ok(load("meta/groups.json").groups.every((g) => g.members.every((x) => /^SY/.test(x.entity_id))));
});

// V7 (dashboard v2 analytical plan): the SYNTHETIC v2 fixture tests/fixtures/v2_export. Invented data, not a measurement, not a real export (G-REAL).
import {allFiles, V2_DIR, COUNTRY_IDS} from "./support/make-v2-fixture.mjs";
const v2 = (p) => JSON.parse(readFileSync(join(V2_DIR, p), "utf8"));
const v2series = v2("meta/series.json").series;
const v2rows = (ind) => v2(`series/${ind}.json`).rows;
const seriesOf = (ind) => v2series.filter((s) => s.indicator_id === ind);
const v2cell = (domain, e, i) => v2(`scorecard/${domain}.json`).entities.find((x) => x.entity_id === e)?.indicators.find((c) => c.indicator_id === i);

test("v2: labelled synthetic, equals the generator output, and the manifest hashes match the files", () => {
  assert.match(readFileSync(join(V2_DIR, "README.md"), "utf8"), /SYNTHETIC[\s\S]*not a measurement/);
  assert.ok(v2series.every((s) => s.source_name === "Synthetic source"));
  for (const [p, t] of Object.entries(allFiles())) assert.equal(readFileSync(join(V2_DIR, p), "utf8"), t, `${p} drifted from tests/support/make-v2-fixture.mjs`);
  const m = v2("manifest.json");
  for (const f of m.files) {
    const bytes = readFileSync(join(V2_DIR, f.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, f.path);
    assert.equal(bytes.length, f.bytes, f.path);
  }
  assert.ok(m.files.some((f) => f.path === "series/M09.json"));
});

test("v2: 42 countries and 3 aggregates (one global); no G20 or EU27 group (decisions D-9)", () => {
  const e = v2("meta/entities.json").entities;
  assert.equal(e.filter((x) => x.kind === "country").length, 42);
  assert.equal(COUNTRY_IDS.length, 42);
  assert.deepEqual(e.filter((x) => x.kind === "aggregate").map((x) => x.entity_id), ["EU27", "EA", "WLD"]);
  assert.equal(e.filter((x) => x.is_global).length, 1);
  assert.deepEqual(v2("meta/groups.json").groups.map((g) => g.group_id), ["euro_area", "g7", "advanced", "emerging", "non_euro_eu"]);
});

test("v2: configured coverage pattern (28 / 28 / 42 / 25 / 27 countries)", () => {
  const n = (ind) => new Set(seriesOf(ind).filter((s) => COUNTRY_IDS.includes(s.entity_id)).map((s) => s.entity_id)).size;
  assert.deepEqual(["M09", "M10", "A05", "A04", "A02", "Q08", "A01"].map(n), [28, 28, 42, 42, 25, 27, 42]);
});

test("v2: two unit codes in one indicator; unit_mult differs too", () => {
  const s = seriesOf("V01");
  assert.ok(new Set(s.map((x) => x.unit_code)).size === 2);
  assert.ok(new Set(s.map((x) => x.unit_mult)).size === 2);
});

test("v2: SA and NSA mix in one indicator", () => {
  assert.deepEqual([...new Set(seriesOf("V02").map((s) => s.seasonal_adjustment))].sort(), ["NSA", "SA"]);
});

test("v2: pairs for C3: monthly overlap, annual overlap, one frequency mismatch", () => {
  const ents = (ind) => new Set(seriesOf(ind).map((s) => s.entity_id));
  const both = (a, b) => [...ents(a)].filter((e) => ents(b).has(e)).length;
  assert.ok(both("M09", "M10") >= 5);
  assert.ok(both("A04", "A05") >= 5);
  const freq = (i) => seriesOf(i)[0].frequency;
  assert.notEqual(freq("M09"), freq("A05"));
  assert.notEqual(freq("M09"), freq("Q08"));
});

test("v2: index series carry base_period (two different ones in V03); no scale_hint anywhere", () => {
  assert.ok(seriesOf("P01").every((s) => s.base_period === "2015"));
  assert.deepEqual([...new Set(seriesOf("V03").map((s) => s.base_period))].sort(), ["2010", "2015"]);
  assert.ok(seriesOf("M09").every((s) => s.base_period === null));
  assert.ok(v2("meta/indicators.json").indicators.every((i) => !("scale_hint" in i)));
});

test("v2: flow_basis is absent for some series of V04 and present for others", () => {
  const s = seriesOf("V04");
  assert.ok(s.some((x) => "flow_basis" in x) && s.some((x) => !("flow_basis" in x)));
});

test("v2: EST, PROV and MISS rows occur; a series with only MISS rows exists", () => {
  const st = (ind) => new Set(v2rows(ind).map((r) => r[8]));
  assert.ok(st("A05").has("EST") && st("M09").has("PROV") && st("M09").has("MISS"));
  assert.ok(v2rows("M10").filter((r) => r[0] === "ITA").every((r) => r[5] === null && r[8] === "MISS"));
});

test("v2: stale, lagging, unaligned and no-value scorecard cases (C4 stl cases)", () => {
  assert.equal(v2cell("labour", "FRA", "M09").is_stale, true);
  assert.equal(v2cell("labour", "ITA", "M09").is_stale, true);
  assert.equal(v2cell("fiscal", "ROU", "A05").is_stale, true);
  assert.equal(v2cell("labour", "DEU", "M09").is_stale, false);
  assert.equal(v2cell("labour", "USA", "M09").alignment, "lagging");
  assert.equal(v2cell("fiscal", "TUR", "A05").alignment, "unaligned");
  assert.equal(v2cell("labour", "ITA", "M10").value, null);
  assert.equal(v2cell("labour", "POL", "M09").alignment, "aligned");
  assert.equal(v2cell("labour", "DEU", "M09").value_kind, "estimate"); // PROV is not observed
});

test("v2: pairs with no series have no scorecard entry (the row is drawn, A1.1)", () => {
  assert.equal(v2cell("labour", "CHN", "M09"), undefined);
  assert.equal(v2cell("labour", "DEU", "M09") !== undefined, true);
});

test("v2: an indicator with more than one frequency (V06) and series in both", () => {
  const ind = v2("meta/indicators.json").indicators.find((i) => i.indicator_id === "V06");
  assert.deepEqual(ind.frequency_set, ["M", "Q"]);
  assert.deepEqual([...new Set(seriesOf("V06").map((s) => s.frequency))].sort(), ["M", "Q"]);
  assert.ok(seriesOf("V06").filter((s) => s.entity_id === "DEU").length === 2);
});

test("v2: stored value_yoy occurs only where the series stores it", () => {
  const rows = v2rows("V05");
  assert.ok(rows.some((r) => r[0] === "DEU" && r[7] !== null));
  assert.ok(rows.filter((r) => r[0] === "ITA").every((r) => r[7] === null));
});

test("v2: every series row has the contract columns and its series_id is in meta/series.json", () => {
  const ids = new Set(v2series.map((s) => s.series_id));
  for (const s of v2series) assert.ok(v2rows(s.indicator_id).some((r) => r[1] === s.series_id), s.series_key);
  for (const ind of new Set(v2series.map((s) => s.indicator_id))) {
    const f = v2(`series/${ind}.json`);
    assert.deepEqual(f.columns, ["entity_id", "series_id", "ref_period_start", "ref_period_end", "frequency", "value", "value_default_tf", "value_yoy", "value_status", "known_at", "load_kind"]);
    assert.ok(f.rows.every((r) => ids.has(r[1]) && r.length === f.columns.length));
  }
});
