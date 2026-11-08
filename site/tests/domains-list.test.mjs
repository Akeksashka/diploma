// Redesign R17: PG-DOMAINS static list (spec 4.5; AC-RD-01, 05), offline, including the sparse fixture.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {domainsPageSource} from "../scripts/lib.mjs";
import {DRAFT_HOME_DOMAINS_TITLE, INFORMATIONAL_NOTICE} from "../src/lib/copy.js";
import {DOMAINS_TITLE, domainsListHtml} from "../src/lib/domains-list.js";

const sparse = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sparse_export", "meta", "domains.json"), "utf8")).domains;

test("title is the DRAFT constant", () => assert.equal(DOMAINS_TITLE, DRAFT_HOME_DOMAINS_TITLE));

test("one link per domain, ordered by domain_id, no table", () => {
  const h = domainsListHtml([{domain_id: "prices", name: "Prices", ranked: true, notices: []}, {domain_id: "agri", name: "Agri", ranked: true, notices: []}]);
  assert.ok(h.indexOf("domain/agri") < h.indexOf("domain/prices"));
  assert.equal((h.match(/<a href="\.\/domain\/[a-z]+">/g) ?? []).length, 2);
  assert.ok(!/<table|<td|<th/.test(h));
});

test("notices shown for any domain, escaped; unranked without notices gets the informational wording; ranked without notices none", () => {
  const h = domainsListHtml([
    {domain_id: "a", name: "A", ranked: true, notices: ["n <1>", "n2"]},
    {domain_id: "b", name: "B", ranked: false, notices: []},
    {domain_id: "c", name: "C", ranked: true, notices: []}
  ]);
  assert.ok(h.includes("<em>(n &lt;1&gt;; n2)</em>"));
  assert.ok(h.includes(`<em>(${INFORMATIONAL_NOTICE})</em>`));
  assert.equal((h.match(/<em>/g) ?? []).length, 2);
});

test("sparse fixture: every domain linked, notices from meta, page source has no other prose", () => {
  const h = domainsListHtml(sparse);
  for (const d of sparse) {
    assert.ok(h.includes(`href="./domain/${d.domain_id}"`), d.domain_id);
    for (const n of d.notices) assert.ok(h.includes(n), n);
  }
  const s = domainsPageSource(sparse);
  assert.ok(!/<p[ >]/.test(s));
  assert.equal((s.match(/<h1>/g) ?? []).length, 1);
});

test("empty and missing notices do not throw", () => {
  assert.ok(domainsListHtml([]).includes('id="domain-list"'));
  assert.ok(domainsListHtml([{domain_id: "x", ranked: false}]).includes(">x</a>"));
});
