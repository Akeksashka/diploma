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
