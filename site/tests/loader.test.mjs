import assert from "node:assert/strict";
import {test} from "node:test";
import {ManifestError, manifestMajor, parseManifest} from "../src/lib/manifest.js";
import {STALE_DAYS, bannerMessage, staleness, utcDate} from "../src/lib/stale.js";
import {safeUrl, sourceAttributions} from "../src/lib/attribution.js";

const ok = {schema_version: "1.0", known_cutoff: "2026-11-01T04:23:41Z", files: []};

test("manifest: major 1 accepted, minor bump and extra fields accepted", () => {
  assert.equal(parseManifest(ok), ok);
  assert.doesNotThrow(() => parseManifest({...ok, schema_version: "1.7", new_field: 1}));
});

test("manifest: unknown major refused", () => {
  for (const v of ["2.0", "0.9", "10.0", "2"]) {
    assert.throws(() => parseManifest({...ok, schema_version: v}), ManifestError, v);
  }
  assert.match(String(assertThrowsMessage(() => parseManifest({...ok, schema_version: "2.0"}))), /Unsupported manifest major version 2/);
});

test("manifest: malformed input refused", () => {
  for (const m of [null, [], "x", {files: []}, {...ok, schema_version: 1}, {...ok, schema_version: "v1"}, {schema_version: "1.0"}]) {
    assert.throws(() => parseManifest(m), ManifestError);
  }
  assert.equal(manifestMajor("1.2.3"), 1);
  assert.equal(manifestMajor(undefined), null);
});

function assertThrowsMessage(fn) {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  return "";
}

const day = 86400000;
const cutoff = "2026-09-20T00:00:00Z";
const t0 = Date.parse(cutoff);

test("stale: boundary at 45 days", () => {
  assert.equal(STALE_DAYS, 45);
  assert.equal(staleness(cutoff, t0 + 44 * day).stale, false);
  assert.equal(staleness(cutoff, t0 + 45 * day).stale, false);
  assert.equal(staleness(cutoff, t0 + 45 * day + 1000).stale, true);
  assert.equal(staleness(cutoff, new Date(t0 + 60 * day)).stale, true);
});

test("stale: future cutoff is fresh, missing or garbage cutoff is stale", () => {
  assert.equal(staleness(cutoff, t0 - 10 * day).stale, false);
  for (const bad of [undefined, null, "", "not a date", 12345]) {
    const s = staleness(bad, t0);
    assert.equal(s.stale, true);
    assert.equal(s.reason, "unreadable");
    assert.match(bannerMessage(s), /freshness unknown/);
  }
});

test("stale: banner text names the data cut-off date and age, none when fresh", () => {
  assert.equal(bannerMessage(staleness(cutoff, t0 + day)), null);
  const msg = bannerMessage(staleness(cutoff, t0 + 50.5 * day));
  assert.match(msg, /the data cut-off \(2026-09-20\) is 50 days old, more than 45 days\./);
  assert.ok(!msg.includes("known_cutoff"));
  assert.match(msg, /50 days old/);
});

test("attribution: dedupe per source, public only, sorted, indicator filter", () => {
  const rows = [
    {indicator_id: "M09", publish: "public", source_id: "B", source_name: "Beta", licence_attribution: "Beta licence", source_url: "https://b.example/x"},
    {indicator_id: "M09", publish: "public", source_id: "B", source_name: "Beta"},
    {indicator_id: "M10", publish: "public", source_id: "A", source_name: "Alpha", source_url: "javascript:alert(1)"},
    {indicator_id: "M09", publish: "withheld", source_id: "W", source_name: "Withheld"}
  ];
  const all = sourceAttributions(rows);
  assert.deepEqual(all.map((s) => s.name), ["Alpha", "Beta"]);
  assert.equal(all[0].url, null);
  assert.equal(all[1].attribution, "Beta licence");
  assert.deepEqual(sourceAttributions(rows, ["M09"]).map((s) => s.sourceId), ["B"]);
  assert.equal(safeUrl("ftp://x"), null);
  assert.equal(safeUrl("not a url"), null);
});

test("utcDate: ISO timestamps give the UTC calendar date; unparsable strings are returned as stored; non-strings give null", () => {
  assert.equal(utcDate("2026-09-20T23:30:00-02:00"), "2026-09-21");
  assert.equal(utcDate("2026-09-20"), "2026-09-20");
  assert.equal(utcDate("not a date"), "not a date");
  assert.equal(utcDate(""), "");
  for (const v of [undefined, null, 12345, {}, new Date(0)]) assert.equal(utcDate(v), null);
});

test("utcDate and staleness: a zone-less date-time ('YYYY-MM-DD HH:MM' or with T) is read as UTC in any timezone", () => {
  assert.equal(utcDate("2026-09-20 23:30"), "2026-09-20");
  assert.equal(utcDate("2026-09-20T23:30:15"), "2026-09-20");
  assert.equal(utcDate("2026-09-20 00:10"), "2026-09-20");
  const st = staleness("2026-09-20 12:00", Date.parse("2026-09-21T12:00:00Z"));
  assert.equal(st.ageDays, 1);
  assert.equal(staleness("2026-09-20 12:00", Date.parse("2026-09-20T12:00:00Z")).ageDays, 0);
});
