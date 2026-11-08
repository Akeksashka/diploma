// R1 (dashboard redesign plan): pins the CURRENT URL-hash behaviour so later tasks (R4) can map old to new.
// Spec syntax is `#i=&c=&g=`. Differences found in the existing code:
//  - Explorer page (as at R1): NO hash parameters at all. R13 changed this: it now reads #i and #c (see the last test).
//  - Peers page (the removed src/peers/<domain>.md, R12; PG-INDICATOR keeps the form): only `#c=<entity_id>` (country focus). `i` and `g` are not in the hash: the indicator,
//    peer group and sort are in-page controls only. `c` matches the spec name; the value must be a known entity id.
//  - Anything else (empty, malformed, unknown id, extra or repeated keys, `?` form) is ignored (null).
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {focusFromHash, focusHash} from "../src/lib/peers.js";
import {explorerPageSource} from "../scripts/lib.mjs";

const ids = new Set(["DEU", "USA", "EA20"]);

test("peers focus hash is #c=<entity_id> and round-trips", () => {
  assert.equal(focusHash("DEU"), "#c=DEU");
  assert.equal(focusFromHash("#c=DEU", ids), "DEU");
});

test("peers focus hash ignores everything else", () => {
  for (const h of ["", "#", "#c=", "#c=XXX", "#c=DEU&c=USA", "#c=DEU&i=M09", "#i=M09", "#g=advanced", "?c=DEU", "c=DEU", "#c=DEU/../", null, undefined, 5]) {
    assert.equal(focusFromHash(h, ids), null, String(h));
  }
});

test("only the c parameter exists today; i and g are not read from the hash", () => {
  const src = readFileSync(new URL("../src/lib/peers.js", import.meta.url), "utf8");
  assert.match(src, /#c=/);
  assert.doesNotMatch(src, /#i=|#g=|&i=|&g=/);
});

test("explorer page reads #i and #c through initialSelection (R13, AC-RD-34), no query string", () => {
  const page = explorerPageSource({files: [{path: "series/M09.json"}]});
  assert.match(page, /initialSelection\(ctx, pHash\)/);
  assert.doesNotMatch(page, /searchParams|location\.search/);
  const view = readFileSync(new URL("../src/lib/explorer-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(view, /location\.hash|searchParams/);
});
