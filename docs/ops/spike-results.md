# Dependency compatibility spikes (plan task T04)

Run date: 2026-10-27. Environment: macOS arm64, CPython 3.12.2, versions from `uv.lock`
(no dependency was added or changed). Tests: `tests/unit/test_compat_*.py`, offline, fixtures only.
Synthetic SDMX-ML fixtures (hand-written, not source data): `tests/fixtures/sdmx/`.

| Spike | Result | Versions | Tests |
|---|---|---|---|
| BB13 pandas 3 + pandera + pyarrow | PASS | pandas 3.1.0, pandera 0.35.0, pyarrow 26.0.0, numpy 2.5.4 | `test_compat_pandas_pandera.py` |
| BB13 pandera on staged-row frames | PASS | same | same |
| BB27 sdmx1 reads SDMX-ML from `BytesIO` | PASS | sdmx1 2.28.0, lxml 6.1.3 | `test_compat_sdmx.py` |
| BB17 lock tool (uv) | PASS | uv 0.13.5; lock `revision = 5`, `requires-python = "==3.12.*"` | `test_compat_lock_tool.py` |
| jsonschema draft support | PASS | jsonschema 4.26.0 | `test_compat_jsonschema.py` |

No spike failed, so no fallback decision is needed from the user.

## Notes and caveats
- pandera: the locked version is 0.35.0, not the 0.34.x named in the plan. The spike covers 0.35.0 only;
  0.34.x was not tested (that would need a dependency change, out of scope for T04).
- BB13 details: Decimal values survive in object columns through `pandera` validation; lazy validation
  reports all failures; a strict schema rejects extra columns (raised as `SchemaErrors` in this version, so
  contract code must catch `SchemaErrors`, not only `SchemaError`). Pandas string columns infer pyarrow-backed
  strings under pandas 3.
- BB13 pyarrow: a `decimal128(18,4)` column converted `to_pandas()` and back via `Table.from_pandas` comes back
  as `decimal128(7,4)` (precision narrowed from the data, scale kept, values exact). Contracts that need a fixed
  precision must pass an explicit schema when going back to Arrow. Consistent with ADR-016: frames live only in
  `validation/contracts.py`, and rows to storage stay plain Python / pyarrow.
- BB27: `sdmx.read_sdmx(io.BytesIO(bytes))` parses a SDMX-ML 2.1 generic data message and a structure message.
  Observation values arrive as strings (lossless `Decimal`), series key `str()` is `(FREQ=M, GEO=XX)`,
  observation time is `obs.dimension["TIME_PERIOD"].value`, series and observation attributes merge into
  `obs.attrib`. Only the generic data and codelist structure forms were tested; StructureSpecific data (needs a
  DSD) and real Eurostat/IMF/ECB payloads are NOT covered; the first SDMX parser task should re-check on a real
  recorded payload.
- BB17: `uv` is not on PATH; it runs as `python3 -m uv` (uv 0.13.5). `uv lock --check` and
  `uv sync --locked --dry-run` both succeeded (52 packages resolved, 51 checked, no changes). The `.venv` has no
  uv module. The test checks the lockfile statically (pins Python 3.12.*, contains the key packages and every
  declared dependency); it does not run uv. The "fallback pip-tools" condition (first CI run, Q11) is not
  triggered locally; the CI run itself is still unobserved.
- jsonschema: validators for drafts 2020-12, 2019-09, 7 and 4 exist; `validator_for` selects 2020-12 and
  draft-07 from `$schema`; 2020-12 keywords (`prefixItems`) work; invalid schemas are rejected by `check_schema`.
  Recommendation for schema authors: declare `$schema` explicitly (2020-12) in every schema file.
- The AC-DEP-1 boundary rule (pandas/pandera only in `analytics/` and `validation/`) is untouched. The compat
  tests import pandas and pandera under `tests/`, which that rule does not cover.

## Fallbacks (for reference, not triggered)
- BB13: pin an older pandas; if pandera fails altogether, hand-written checks (ADR-016 item 6).
- BB27: small direct XML parser for the three structures needed.
- BB17: pip-tools.

---

# Site toolkit spike AC-DASH-0 (plan task T87)

Run date: 2026-11-04. Environment: macOS arm64, Node v20.18.1, npm 10.8.2, Google Chrome (headless) for a
manual render check. Local build only; nothing was pushed, deployed or changed in repo or Pages settings.
This section is written for the user to decide (OP-10, BL-10). ADR-010 is NOT edited and nothing is marked approved.

## Outcome in one paragraph
Toolkit A1 (Observable Framework + Observable Plot) works locally: a scorecard page and an explorer page build from a
fixture export, and both render in headless Chrome without errors, with the Parquet series file read in the
browser. Because A1 did not fail locally, A2 (Quarto) and A3 were not tried. The deployment half of AC-DASH-0
(build in Actions, deploy to Pages, gzip and `Accept-Ranges` on Pages) is [UNVERIFIED]; it needs OP-01 and a push.
Therefore AC-DASH-0 is only partly met and ADR-010 should not yet be updated to "A1 chosen" until the manual
steps below are done.

## What was built (all under `site/`, no data files committed)
- `site/package.json`, `site/package-lock.json` (exact pins, `.npmrc` `save-exact`), `site/observablehq.config.js`
  (`globalStylesheets: []`, see finding 2), `site/.gitignore` (`node_modules/`, `dist/`, `src/data/`, `.observablehq/`,
  `src/.observablehq/`), `site/scripts/prepare-data.mjs` (copies an export tree to the git-ignored `src/data/`;
  refuses a manifest with a major version other than 1), `site/src/index.md` (scorecard: table plus Plot dot chart,
  stale marker, "n/a (unranked)" for null percentiles, stale banner on `known_cutoff` older than 45 days),
  `site/src/explorer.md` (country checkboxes, transform select Level/Default/YoY, rebase-to-100 toggle, Plot lines
  from `series/M09.parquet` via `FileAttachment(...).parquet()`), `site/src/lib/rebase.js`.
- Fixture export: `tests/fixtures/site_spike/make_export.py` writes a small SYNTHETIC export tree (hand-written
  numbers, three entities, one indicator M09, 36 months) in the file shapes of `docs/specs/dashboard-export-spec.md`
  (manifest, `meta/*`, `scorecard/labour.json`, `series/M09.parquet` with the spec columns, zstd). It is NOT the
  output of the `export` CLI: that needs a database (T82-T86 db tests, MM_TEST_DATABASE_URL not set in this
  session), and the repository holds no recorded export tree, only `tests/fixtures/export/golden_manifest_t86.json`
  and the config fixtures. Before relying on the spike, re-run it on a real `export` output (manual step 3).
- Build check: `tests/unit/test_site_spike.py` (4 tests; run in the unit suite; no network in the pytest process).
  Three tests always run (exact version pins and lockfile/ignore entries; fixture export determinism; manifest
  major-version refusal needs node). The build test runs `prepare-data` and `observable build` in a subprocess and
  asserts both pages and the data files exist and that the output contains no off-origin URL. It is SKIPPED, with
  the reason shown, when node, `site/node_modules` or the Observable import cache (`site/src/.observablehq`) is
  missing. The cache is filled by one `npm run build` WITH network (see finding 1), so a clean CI runner must run
  that first or the test skips.

## Verified locally
| Check | Result |
|---|---|
| `npm run build` from a fixture export | PASS, 2 pages (`index.html`, `explorer.html`), about 6.2 MB `dist/` in total (JS libraries, parquet-wasm, Arrow, data) |
| Headless Chrome `--dump-dom` of both pages served by `python3 -m http.server` | PASS: scorecard renders table and chart, explorer renders 4 checkboxes, selects and the Plot SVG with series paths, no `observablehq--error` element |
| Parquet read in the browser (`FileAttachment().parquet()`; parquet-wasm 0.9.0 + apache-arrow 21.2.0, self-hosted in `dist/_npm`) | PASS on the 4.6 KB zstd fixture file |
| Off-origin URLs in the built site | none after `globalStylesheets: []` (before: `fonts.googleapis.com`, `fonts.gstatic.com`; AC-DASH-1 needs none). Only the W3C namespace URIs and one comment URL (`jsdelivr.com/using-sri...`, text only) remain, both allowed by the test |
| Gzip sizes (local `gzip -c`, per file) | `index.html` 7,094 -> 2,293 bytes; `explorer.html` 6,347 -> 2,125; whole `dist/` 6,181,340 -> about 1.96 MB as the sum of per-file gzip. This is only a local proxy; it does NOT show what Pages sends |
| Manifest major refusal | unit-tested in `prepare-data.mjs` (build time) only; the browser-side loader refusal is in `index.md` and was not exercised by a test in a browser |
| Python | `ruff check`, `ruff format --check`, `mypy --strict src` clean; unit suite 905 passed, 2 skipped (both network); no Python dependency added |

## Findings that matter for the decision
1. Build needs network once. Framework resolves its `npm:` imports (Plot, d3, Arrow, parquet-wasm, htl, ...) from
   jsDelivr at build time into `site/src/.observablehq/cache` and then self-hosts them in `dist/_npm`. The deployed
   site makes no call to jsDelivr. A CI build has network, so this works, but it adds a third-party fetch at build time
   (supply chain; versions are not covered by `package-lock.json`, they come from the Framework's own version
   resolution). Consider caching `site/src/.observablehq` in CI and pinning, or ask whether this is acceptable.
2. The default Framework theme loads Google Fonts. This would break AC-DASH-1 ("no request leaves the origin") and
   is a privacy concern for visitors. Disabled with `globalStylesheets: []`; the page then uses system fonts.
3. Page weight: Framework reports 593 kB (scorecard) and 877 kB (explorer) of JavaScript imports (uncompressed),
   against the AC-DASH-2 landing limit of 1.5 MB gzipped. Plausible but unmeasured with a real landing set;
   DuckDB-Wasm was NOT used (Arrow + parquet-wasm read the per-indicator file instead). Whether parquet-wasm 0.9.0 reads
   the real writer settings (zstd, v2, dictionary encoding, `date32`, `timestamp[us, UTC]`) is verified only on this
   small fixture written by the pinned pyarrow with the same compression, not on a real export.
4. Transitive footprint is large: 335 packages in the lockfile (80 optional platform binaries, mostly esbuild;
   259 installed on this machine). `npm audit` reports 7 vulnerabilities (3 low, 4 moderate) in the dev/build tree;
   not fixed (no `npm audit fix`), not assessed for relevance (build-time only, nothing from it ships to the browser
   except the self-hosted libraries).
5. ADR-016 approves only Playwright as a site npm tool; the Framework and its tree were installed only because the
   task permitted `npm install` for the spike. If A1 is chosen, ADR-016 needs the approval recorded. Playwright
   itself was not installed or used.
6. Node pin: `site/package.json` `engines` is `>=20.18.1 <21`; the repository has no Node version file. Framework 1.13.4
   declares `node >=18`. A `.node-version` or `actions/setup-node` pin is a later task.

## Packages and versions fetched
npm install (registry), exact direct dependency: `@observablehq/framework` 1.13.4 (only entry in `package.json`).
`package-lock.json` holds 335 packages; installed 259. Direct dependencies of the Framework (ranges, resolved in
the lockfile): `@clack/prompts`, `@observablehq/inputs`, `@observablehq/inspector`, `@observablehq/runtime`,
`@rollup/plugin-commonjs`, `@rollup/plugin-json`, `@rollup/plugin-node-resolve`, `@rollup/plugin-virtual`,
`@sindresorhus/slugify`, `acorn`, `acorn-walk`, `ci-info`, `cross-spawn`, `d3-array`, `d3-hierarchy`, `esbuild`
(0.27.7), `fast-array-diff`, `fast-deep-equal`, `glob`, `gray-matter`, `he`, `highlight.js`, `is-docker`, `is-wsl`,
`jsdom`, `jszip`, `markdown-it`, `markdown-it-anchor`, `mime`, `minisearch`, `open`, `picocolors`, `pkg-dir`,
`resolve.exports`, `rollup`, `rollup-plugin-esbuild`, `semver`, `send`, `tar`, `tar-stream`, `tsx`, `untildify`,
`wrap-ansi`, `ws`. Exact resolved versions of all 335 are in `site/package-lock.json`.
Fetched from jsDelivr at build time (cache `site/src/.observablehq/cache`, not in the lockfile): `@observablehq/plot`
0.6.18, `apache-arrow` 21.2.0, `parquet-wasm` 0.9.0, `flatbuffers` 25.9.23, `tslib` 2.9.1, `htl` 1.0.0, `isoformat` 0.2.1,
`d3` 7.9.2 and the d3 modules d3-array 3.2.5, d3-axis 3.0.1, d3-brush 3.0.1, d3-chord 3.0.2, d3-color 3.1.1,
d3-contour 4.0.3, d3-delaunay 6.0.6, d3-dispatch 3.0.2, d3-drag 3.0.1, d3-dsv 3.0.2, d3-ease 3.0.2, d3-fetch 3.0.2,
d3-force 3.0.1, d3-format 3.1.3, d3-geo 3.1.2, d3-hierarchy 3.1.3, d3-interpolate 3.0.2, d3-path 3.1.1, d3-polygon 3.0.2,
d3-quadtree 3.0.2, d3-random 3.0.2, d3-scale 4.0.3, d3-scale-chromatic 3.1.1, d3-selection 3.0.1, d3-shape 3.2.1,
d3-time 3.1.1, d3-time-format 4.1.1, d3-timer 3.0.2, d3-transition 3.0.2, d3-zoom 3.0.1.

## [UNVERIFIED] (not possible from here)
- A GitHub Actions build of the spike and a deployment to GitHub Pages (`actions/configure-pages`,
  `upload-pages-artifact`, `deploy-pages`; no workflow was written, so actionlint was not run).
- Whether Pages serves gzip (or brotli) for `.json`, `.js`, `.wasm` and `.parquet` files, and whether it sends
  `Accept-Ranges: bytes` for them (the export spec budgets assume whole-file, possibly uncompressed fetches).
- Chromium via Playwright (only the installed Google Chrome was used, headless, manually); Firefox and Safari.
- Behaviour on a real `export` output, on the full size budgets, and on the real Parquet writer settings.
- Quarto (A2) and A3 were not tried because A1 did not fail locally; their behaviour is unknown.

## Manual steps for the user
1. Review this section and decide (OP-10, BL-10): accept A1 provisionally, or ask for A2. ADR-010 stays unchanged until you decide; the update is not the implementer's to make.
2. OP-01: set the Pages source to "GitHub Actions" and enable immutable releases (repo settings, done by you).
3. Produce a real export with the fixture database or Neon test branch (`macro-monitor export ...`, the T86 db test builds one), then locally:
   `cd site && PATH=/Users/oleksandrdzuba/.local/node/bin:$PATH EXPORT_DIR=<export dir containing manifest.json> npm run build`, open `site/dist` through any static server and check both pages against that export.
4. Approve a deploy of the spike (a throwaway workflow with `pages: write`, `id-token: write`, SHA-pinned actions, `npm ci` then `npm run build`, upload `site/dist`), or ask for it to be written as a follow-up task. Pushing and dispatching are yours to do.
5. After a Pages deploy, measure from a terminal (replace the host and use a path that exists):
   `curl -sI -H 'Accept-Encoding: gzip' https://<user>.github.io/<repo>/_file/data/scorecard/<file>.json` and the same for the `.parquet` and the `_npm/parquet-wasm@0.9.0/esm/*.wasm` file; record `content-encoding`, `content-length` and `accept-ranges`; then `curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -H 'Range: bytes=0-99' <url>` (206 with 100 bytes means range requests work, 200 with the full size means they do not).
6. Decide on the build-time jsDelivr fetch (finding 1), the Node pin, and an ADR-016 amendment for the Framework before any T88+ work.

---

# Site shell (plan task T88)

Run date: 2026-11-04. Node v20.18.1, npm 10.8.2. Local build from the synthetic fixture export (`tests/fixtures/site_spike/make_export.py`), not a real export (ADR-023 C3 still open). Nothing pushed or deployed.

## What changed
- `site/src/lib/`: `manifest.js` (refuses a manifest with an unknown major `schema_version`, supported: 1), `stale.js` (45 days on `known_cutoff`, evaluated in the browser; a missing or unreadable cutoff counts as stale), `attribution.js` (per-source list from `meta/series.json`, public rows only, http/https links only), `shell.js` (status block with banner, as-of line, sources block). `index.md` and `explorer.md` use them. `observablehq.config.js` keeps `globalStylesheets: []`.
- `FileAttachment` inside an imported module is NOT rewritten by Framework 1.13.4 (the built module kept a bare `FileAttachment(...)` call and the data files were not registered), so each page calls `FileAttachment` itself and passes the results to the pure library functions.
- Scripts: `site/scripts/measure-landing.mjs` (real `gzip -9` of the landing set), `check-npm-imports.mjs` (P2), `audit-gate.mjs`, shared `lib.mjs`. JS tests: `site/tests/*.test.mjs` (`node --test`, 14 tests).

## ADR-023 decision 5: P1 result and P2 fallback
- P1 works for what the pages import explicitly. With `@observablehq/plot` 0.6.18 and `d3` 7.9.2 as exact-pinned direct dependencies, `import * as Plot from "@observablehq/plot"` and `import * as d3 from "d3"` are bundled from `node_modules` into `dist/_node/` (Plot and all 30 d3 modules), and the lockfile covers them.
- P1 cannot cover Framework's own default imports. `html` (htl 1.0.0), `Inputs` (isoformat 0.2.1) and `FileAttachment().parquet()` (apache-arrow 21.2.0, parquet-wasm 0.9.0, flatbuffers 25.9.23, tslib 2.9.1) are still resolved by the stdlib from jsDelivr at build time into `dist/_npm/`. Direct dependencies on apache-arrow and parquet-wasm were tried and removed again: they did not change what the stdlib fetches, and nothing imports them directly (the reader choice is ADR-023 C6, T91).
- Therefore P2 is also in place for `dist/_npm`: committed `site/npm-imports.lock` (7 entries: sha256, bytes, path), checked by `npm run check:imports`; a rebuild after the lock was written matched it. Updating the lock is a reviewed change (`node scripts/check-npm-imports.mjs --update`). This does not remove the build-time jsDelivr fetch, it detects changed content. Whether the hashes are stable on a clean CI runner (clean cache) is [UNVERIFIED]; only a rebuild on this machine with a warm cache was compared.

## Measurements
- Landing view (`index.html`, scorecard), real `gzip -9` per fetched file: 49 files, 218,281 bytes gzipped (limit 1,500,000). Largest: Plot 72,279; stdlib inputs 10,453; runtime 9,319. Method: the HTML, its `./` references (stylesheets, module preloads, registered data files) and static imports of those scripts, recursively; dynamic `import()` is not followed (Arrow, parquet-wasm and the wasm are not fetched on the landing page). Pages' own gzip is not Pages' compression (ADR-023 C2 still [UNVERIFIED]); data files are the fixture's few KB, so a real export will add its scorecard and meta size.
- Explorer (not the landing view): Framework reports 875 kB of JS imports uncompressed (spike: 877 kB).
- Headless Chrome render of both built pages via a local static server: no `observablehq--error`, scorecard has its Plot SVG and the sources block, explorer has its Plot SVG with series paths and the sources block.
- Off-origin URLs in `dist/`: none other than the W3C namespaces and the jsDelivr comment URL already allowed by the unit test.
- Banner: unit-tested on the boundary (45 days not stale, just over is stale), future cutoff, missing/garbage cutoff, and the rendered block. It was not exercised in a browser with a stale fixture (the fixture cutoff is 2026-11-01).

## Licence and install scripts
- `@observablehq/framework` 1.13.4: `license` field in its `package.json` is `ISC`, and its `LICENSE` file is the ISC text (Copyright 2023-2024 Observable, Inc.). This closes the "unverified" note in ADR-024 decision 3 for the Framework. Licence listing of the whole shipped tree (decision 3, "before the first deploy") is not done.
- Install scripts of the 335+ packages were not enumerated; `npm ci --ignore-scripts` was not tried in CI.

## Node pin
`site/.nvmrc` = `20.18.1` (the only Node installed here, the one the spike and T88 were tested on) and `engines` `>=20.18.1 <21`. ADR-023 decision 8 asked whether the Node 20 line is still supported: to my knowledge Node 20 reached end of life in April 2026 (not verified against nodejs.org in this session). The pin should move to a current LTS by a reviewed PR; no other Node was available here to test it, so it was not changed.

## npm audit
7 findings (3 low, 4 moderate, 0 high or critical), all in build tooling, none shipped; advisory ids in `docs/ops/site-dependency-exceptions.md`. No exception is needed. `npm audit fix` was not run.

## V1 country scorecards (T89)
- Pages: `site/src/index.md` (domain list from `meta/domains.json`, the standing caveat, status banner) and one page per domain, `site/src/domain/<domain_id>.md`. Framework resolves `FileAttachment` paths statically, so `scripts/prepare-data.mjs` writes these small pages (git-ignored) from `domainPageSource()` in `scripts/lib.mjs`; the domain id must match `^[a-z][a-z0-9_]{0,40}$`, otherwise the script fails. `prepare-data` also fails when a domain in `meta/domains.json` has no scorecard file.
- View-model `site/src/lib/scorecard.js` (pure, display only, D6: no rank, percentile, mean, position or n/N is computed; sorting by the stored `rank_position` is ordering only) and renderer `scorecard-view.js`; `meta.js` unwraps `meta/*.json` (`{schema_version, <key>: [...]}`). The T87 spike read bare arrays; the fixture now has the real shapes and `tests/unit/test_site_spike.py` validates every fixture JSON against `src/macro_monitor/publish/schemas/`. `explorer.md` was adjusted to the wrapped shape.
- Wording that the spec fixes: the standing caveat, the label (stored `percentile_rank_label`, required), "percentile vs all ranked countries". Wording chosen here because the spec fixes none: the heterogeneous-peer-set note, "no rank (stale)", "descriptive, not ranked", "unranked domain", "no position (low coverage)", "aggregate (not ranked)". "n/N" is read as `n_available/n_defined` indicators; "position" as `rank_position of n_ranked_entities`.
- Measured (real `gzip -9`, `scripts/measure-landing.mjs`, fixture export): `index.html` 31,495 bytes (13 files; no Plot on the landing page), `domain/labour.html` 212,834 bytes (51 files), `explorer.html` 289,639 bytes (54 files); limit 1,500,000. `landingSet` now follows `../` references so pages in a subdirectory are measured correctly (before, a nested page showed 1 file). `check-npm-imports.mjs`: 7 files match `npm-imports.lock`; the lock was not changed (no new imports from jsDelivr).
- Headless Chrome (`--dump-dom`, local static server) on `domain/labour`, `domain/agri`, `domain/prices`: no `observablehq--error`; labour shows rows with status ranked, low_coverage, n/a, aggregate, the peer-set note and a Plot SVG; agri shows only `unranked_domain` rows and no SVG. Gotcha found: a page variable named `view` collides with Framework's builtin `view` and breaks the page; the template uses `dv`.

## V2 peer comparison (T90)
- User confirmation (2026-11-04): the T89 wording choices above (peer-set note, the cell texts, n/N = `n_available/n_defined`, position = `rank_position` of `n_ranked_entities`, domain-list landing with one page per domain) were confirmed by the user. T90 reuses the same cell texts.
- Pages: one generated page per domain, `site/src/peers/<domain_id>.md` (git-ignored, written by `prepare-data` from `peersPageSource()`), linked from the V1 domain page ("Compare countries (peer groups)") and back. View-model `site/src/lib/peers.js`, renderer `peers-view.js`. The controls (indicator, peer group, sort) are plain `select` elements read with `Generators.input`: no `Inputs` import, so no new jsDelivr module and `npm-imports.lock` is unchanged (7 files match). No new dependency.
- D6: the group filter keeps or drops rows and the sort orders them by stored fields; each percentile shown is the stored `percentile`, the same with or without a filter (unit test compares the rendered row). `peer_group_percentile` is not built. A static test checks the two modules for arithmetic helpers.
- Group membership: `meta/groups.json` members are tested against the date of `manifest.known_cutoff` (`valid_from <= date`, `valid_to` null or `>= date`); an unreadable date keeps only open-ended memberships. The real group ids are `euro_area`, `g7`, `advanced`, `emerging`, `non_euro_eu` (config/entities.yaml); the spec's proposed `peer_group_percentile` keys (`ea`, `eu_non_ea`) differ from them, which matters only if that object is ever approved.
- Spec points taken as follows: the spread shown is `reference_period_spread_days` of the indicator's `alignment[]` entry together with the stored `rank_reference_period`, `max_ref_spread_days`, `n_ranked` ("n shown") and `n_unaligned`; lagging and unaligned entities keep their value and show "not ranked (lagging)" / "not ranked (unaligned)" with a flag and a `data-mark`; aggregates are listed with "aggregate (not ranked)" (they appear only when no group filter excludes them); the chart draws only rows with a stored percentile. M18: the exported `notes[]` of the indicator (`Non-euro countries: local-currency yield spread (includes inflation/FX expectations), not sovereign credit risk`) is shown verbatim above the table.
- NEW WORDING CHOICES (CONFIRMED by the user on 2026-11-04; the spec fixes none): group labels "All countries", "G7", "Euro area", "EU members outside the euro area", "Advanced economies", "Emerging economies"; sort labels "Percentile (stored), highest first", "Latest value, highest first", "Latest value, lowest first", "Country name"; the filter note "The group filter only filters and sorts the list. Every percentile shown is the percentile vs all ranked countries; it is not recomputed within the group."; the per-row mark "non-euro: see the note above" (set on a country that is not a member of `euro_area` when the indicator has notes; today only M18 has notes, so any future note on another indicator would get the same mark); the spread sentence ("Reference-period spread of the ranked set: N days (limit M days); common reference period of the ranking D; countries ranked n; shown but not ranked because unaligned k."); "No ranking for this indicator, so there is no common reference period or spread."; the empty-group message "No countries of this group have a value for this indicator in this domain.".
- Spec gaps, not worked around: (1) the spec says the V2 view lists "all 42 countries" and an indicator picker, but fixes no layout; the per-domain page with an indicator select is this implementation's reading; (2) the lagging/unaligned marks reuse the V1 flag texts; (3) the spec does not say whether the non-euro wording belongs per row or per indicator: the export has it per indicator only, so the row mark is derived from `euro_area` membership as above; (4) the earlier T89 fixture stored a percentile for a lagging entity, contradicting AC-EXP-6; the T90 fixture follows the spec (lagging/unaligned: percentile null).
- Fixture: `tests/fixtures/site_spike/make_export.py` now has `meta/groups.json` (5 groups), entities JPN, IND, POL, a lagging (USA) and an unaligned fiscal-year-basis (IND) M09, a fifth domain `fin` (unranked, M18 with the real wording from `publish/meta.py`), and derived `n_ranked`/`n_unaligned` counts in the fixture only. 12 JSON files validate against the published schemas.
- Measured (real `gzip -9`, `measure-landing.mjs`, fixture export): `index.html` 31,617 bytes, `domain/labour.html` 213,417, `peers/labour.html` 216,622, `peers/fin.html` 216,099, `explorer.html` 289,754 (limit 1,500,000). Headless Chrome (`--dump-dom`) on `peers/labour` and `peers/fin`: no `observablehq--error`, rows with lagging and unaligned marks, all group options, the spread sentence, the M18 note. Not tested in a browser: changing a select (the re-render on input); that needs the T94 Playwright test.

---

# V3 time-series explorer and rebase (T91)

Run date: 2026-11-04. Node v20.18.1. Local build from the synthetic fixture export; one extra scratch build from a realistic-size series file (below). Nothing pushed or deployed. ADR-023 and ADR-010 are NOT edited and nothing is marked approved.

## ADR-023 condition C6: the series reader (decision for the user)
Recommendation: keep Arrow + parquet-wasm (the already-approved path, ADR-024). DuckDB-Wasm was not added and is not needed; the JSON tier stays the fallback through the manifest `format` field. Evidence:
- Correctness on the real writer. The fixture series files are now written by the REAL producer code (`publish.series.build_table` and `publish.export.parquet_bytes`: dictionary columns, `date32`, `timestamp[us, UTC]`, format 2.6, data page v2, zstd level 3, dictionary encoding, statistics, one row group per entity). `FileAttachment().parquet()` (apache-arrow 21.2.0, parquet-wasm 0.9.0) reads them in headless Chrome with the right values, dates and `known_at` (the old T87 file had plain string columns). This closes the "real writer settings" part of finding 3 of the T87 section for the writer, still on synthetic values.
- Realistic size. 44 entities x 420 months = 18,480 rows, random-walk values (high entropy, so a pessimistic compression case), written with the same code: 712,644 bytes (the spec's analyst estimate is under 300 KB for a typical indicator). Chrome rendered it, and the transform, entity, rebase and select interactions worked on it. Far below 5 MB (`tests/unit/test_rebase_golden.py` asserts the size bound).
- Weight, measured (real `gzip -9`, `scripts/measure-explorer.mjs`): the Parquet reader libraries (Arrow, flatbuffers, tslib, parquet-wasm) are 1,818,762 bytes gzipped, 5,536,481 raw; of that `parquet_wasm_bg.wasm` is 5,254,537 raw, 1,659,824 gzipped. They load once, lazily, on the first series read; they are not in the landing set (index.html 31,665 bytes gzipped, limit 1,500,000). First explorer interaction: 1,822,000 bytes gzipped / 5,546,672 raw (libraries + the largest fixture series file); a later interaction: one series file only (3,238 gzipped / 10,191 raw on the fixture; 712,644 for the realistic file).
- Memory: not measured (no mobile device or memory profiler here). The working set is one indicator file (about 18k rows as JS objects for the realistic case); the Wasm memory risk of the plan stays "desktop-first" and unmeasured on mobile.
- Range requests: not needed. Each indicator has its own file and the page fetches it whole; whether Pages sends `Accept-Ranges` or gzip is still ADR-023 C2, [UNVERIFIED]. The reader choice does not depend on it.
- DuckDB-Wasm: not installed, not measured. From general knowledge its Wasm bundles are several times the size of parquet-wasm [UNVERIFIED, not checked in this session], and it adds a worker and a second dependency tree that ADR-024 does not approve. Nothing found requires it (no join, no aggregation, no SQL on the client: selectors are column picks, a year range and a pure rescale).
- Open point for the user: if Pages does NOT gzip `.wasm`, the first interaction is 5,546,672 raw bytes, slightly above the 5 MB wording of the budget although only 22,000 bytes of it are data. The budget table says "data fetched by one explorer interaction", so this implementation counts the reader libraries separately and checks gzip -9 (1.8 MB) as a proxy for the total; if the user wants the raw wasm counted, the budget or the reader needs a decision.

## What was built (all under `site/`; allowed write locations only)
- `src/lib/explorer.js` (pure view-model), `src/lib/explorer-view.js` (renderer and controls), `src/lib/rebase.js` (the display rebase). The page `src/explorer.md` is now GENERATED by `scripts/prepare-data.mjs` (`explorerPageSource()` in `scripts/lib.mjs`, git-ignored like the domain pages) because `FileAttachment` needs literal paths: one lazy `FileAttachment` per `series/<id>.parquet|json` entry of the manifest `files` list, called in the page (not in an imported module). Only the chosen indicator's file is fetched; verified in headless Chrome over the DevTools protocol: selecting another indicator issued one request, for that one parquet file, and none else.
- Selectors: indicator, countries (checkbox group, first five by name preselected), transform (Level = `value`, Indicator default = `value_default_tf`, Year-on-year = `value_yoy`), date range (from and to year), rebase toggle and base period. Controls are plain elements read with `Generators.input` (no `Inputs` import), so `isoformat` is no longer fetched from jsDelivr: `npm-imports.lock` changed legitimately from 7 to 6 entries (the `isoformat@0.2.1` entry removed with `check-npm-imports --update`; the other 6 hashes unchanged). No new dependency, no new import source, no off-origin URL.
- Per-series caption table under every chart (AC-DASH-5): country, unit, frequency, seasonal adjustment, base period, source, latest reference date, vintage (`known_at` of that observation).
- Alert markers: only the alerts of `alerts.json` (current run) for the chosen indicator and the shown countries; a diamond (alert) or triangle (watch) on the plotted value of that period (the rebased value when rebase is on); an alert whose period has no plotted value is listed under the chart, not drawn. `z` is the stored value, nothing is recomputed. D6: no rank, percentile or transform is computed in the browser (a static test checks the modules for the words).
- NSA rule (AC-DASH-4): the Default transform is offered only when some series of the indicator may use it: an indicator whose default transform id starts with MOM, QOQ or M3M3 is not offered for a series whose `seasonal_adjustment` is not SA or SCA; the explorer also draws nothing for such a series if a file nonetheless carried values. The export has no MoM/QoQ columns, so MoM/QoQ can only appear as the indicator default.
- Budget: `loadSeries` refuses to fetch a file whose manifest `bytes` is above 5,000,000 or unknown, and says so on the page. `scripts/measure-explorer.mjs` (`npm run` not added; run `node scripts/measure-explorer.mjs`) prints the sizes above and fails above 5 MB gzipped.
- AC-DASH-6: golden values come from a Python reference (`reference_rebase` in `tests/unit/test_rebase_golden.py`, `Decimal` arithmetic), checked in as `tests/fixtures/site_spike/rebase_golden.json` (20 cases, 349 non-null expected numbers compared); `site/tests/explorer.test.mjs` compares the JS rebase to it within the file's tolerance, 1e-9. A Python test fails if the golden file differs from the reference.

## Spec gaps and decisions for the user (nothing guessed silently)
1. There is NO Python rebase function in `analytics/transforms.py` or elsewhere in `src/` (the task named it as the reference). The spec only says "pure scaling, checked against Python on fixtures". The reference lives in the test file (allowed write location) and implements value / base * 100. If a shared Python function is wanted (so a reference exists in `src/`), that is a separate task.
2. Rebase rule when the base is zero or negative: the spec is silent. Chosen: no values (the series is listed as "not shown", never drawn as zero or with a flipped sign); a base must be a finite number above zero. Previously (T87 code) only zero was refused. Needs your confirmation. Also: the spec does not say rebase is limited to Level, so a Year-on-year series can be rebased too (meaningless for a rate; left as the spec allows; a later restriction is your call).
3. No JSON layout is specified for a series file when the manifest `format` is `json`. Assumption implemented and unit-tested: a bare array of row objects, or `{"rows": [...]}`, with the Parquet column names and ISO date strings. Needs confirmation (or a spec line) before the exporter ever writes it.
4. The export has no per-transform unit. Shown unit text: Level = the series `unit_code` (with `x 10^unit_mult` when not zero) plus the indicator `unit_label` in brackets; Year-on-year = "% change on the same period a year earlier"; Default = the indicator `unit_label` with the default transform id; rebased = "index, base period = 100". If `unit_label` already describes the default transform and not the level, the Level text could mislead; only a spec line can settle it.
5. "Vintage/release date" in AC-DASH-5 is shown as the observation's `known_at` (the series file has no `source_release_at`).
6. Mixed frequencies in one indicator are drawn at native points (no resampling); the frequency is in the caption table and non-monthly series also get dots. Unit tested with a monthly and a quarterly series; not seen in a browser.

## NEW WORDING for the user to confirm
Control labels "Indicator", "Countries", "Transform" (options "Level", "Indicator default (<id>)", "Year-on-year"), "From year", "To year", "Rebase to 100 (display only)", "Base period" (option "first common period"); the note "Rebasing is a display scaling only (value / value at the base period x 100). It needs a positive value at the base period."; "Current alerts (latest run only)"; "(not drawn: no plotted value at that period)"; not-shown reasons "this transform is not offered for a series that is not seasonally adjusted", "no values for this transform in the chosen range", "no usable (positive) value at the base period, so it cannot be rebased"; "No series to draw for this selection."; caption headings (country, unit, frequency, seasonal adjustment, base period, source, latest reference date, vintage (known at)); the title "<indicator>: <transform>, rebased to 100 at <date>".

## Checks and limits
- Not covered: Firefox and Safari; touch/mobile; memory; a real `export` output (the fixture is synthetic, though now written with the real Parquet code); Pages compression and range behaviour (C2). Interaction was exercised in headless Chrome by a throwaway DevTools-protocol script in the scratchpad (not committed; it used `ws`, a transitive dependency of Framework, nothing added). The committed Playwright smoke belongs to T94.
- The Observable import cache was warm; a clean runner still needs the network build (T88 finding 1).
- The CI `site` job and the Dependabot entry remain a separate step.

---

# V4 vintage and revision view (T92)

Run date: 2026-11-04. Node v20.18.1. Local build from the synthetic fixture export. Nothing pushed or deployed. ADR-010, ADR-023 and ADR-024 are NOT edited and nothing is marked approved.

## User decisions of 2026-11-04 recorded here (stated in session)
- ADR-023 condition C6: ACCEPTED as recommended. Keep Arrow + parquet-wasm; DuckDB-Wasm is not added. The JSON tier stays the fallback through the manifest `format` field.
- The 5 MB per-interaction limit is counted on the GZIPPED size for now (the raw 5.5 MB of the parquet-wasm `.wasm` is therefore not against the limit; the real gzip -9 figures of the T91 section are the measure). Revisit if the C2 measurement on Pages (compression) shows Pages does not gzip `.wasm`.
- The T91 wording choices (control labels, notes, not-shown reasons, caption headings, chart title in the T91 section "NEW WORDING for the user to confirm") are CONFIRMED.
- The T91 spec gaps (no Python rebase function in `src/`, rebase of a zero or negative base, JSON series layout, per-transform unit, vintage as `known_at`, mixed frequencies) are ACCEPTED as listed; nothing further to do for them in v1.

## What was built (all under `site/`; allowed write locations only)
- `src/lib/revisions.js` (pure view-model), `src/lib/revisions-view.js` (renderer). The page `src/revisions.md` is GENERATED by `scripts/prepare-data.mjs` (`revisionsPageSource()` in `scripts/lib.mjs`, git-ignored): one lazy `FileAttachment` per `revisions/<id>.parquet` of the manifest, called in the page (never in an imported module); `prepare-data` fails when `revisions_recent.json` is missing or a `revisions/` path is not `revisions/<id>.parquet`. No page variable is named `view`.
- Landing = `revisions_recent.json`: the ordinary list first (stored order, nothing re-sorted), then below it one line per edition built from `edition_summaries[]` in the spec's form, "WEO-2026-10: 12 keys revised in 2 series, largest change 41.7 %, median 5.5 %" (thousands separators added; `n/a` for a null maximum or median). Revision class filter: all / regular only / re-estimation only (`revision_class`); re-estimation rows carry a visible mark and a tinted row (`data-class="reestimation"`). Empty ordinary list: "No ordinary revisions in the last 12 months." and the edition lines are still shown. Edition rows are never in the ordinary list (the exporter keeps them out; the page does not move them).
- Vintage history: indicator select (default "choose an indicator", so no revision file and no Wasm is read until the user chooses; the Arrow and parquet-wasm JS wrappers are in the first-load set, the 5.2 MB `.wasm` is not), then series (country) and reference-period selects. Table: reference period, version, known at, vintage label, source timestamp, value, status, load kind, revision abs and %, class. The base version (`is_base_version`) is labelled "earliest stored version"; later rows "later version k of n"; a tombstone shows "removed". A series caption (country, series id, source, frequency, seasonal adjustment, unit) is shown above the table. The FIXED vintage text is on the vintage view at all times (also before an indicator is chosen), identical to the quoted sentence of spec section 7 (a JS test compares it to the spec file). `loadRevisions` refuses a file above 5,000,000 bytes (manifest `bytes`) or without a size.
- "Headline series of scored indicators only" is enforced twice: the exporter's view, and the page, which shows only rows whose `series_id` is in `meta/series.json` with the same `indicator_id` that is in `meta/indicators.json`, and offers only revision files of indicators in `meta/indicators.json`. Rows that fail are omitted and counted on the page ("n rows are not shown because ...").
- D6: the browser displays `revision_abs`/`revision_pct` exactly as exported (no rounding, no arithmetic); a JS test feeds an inconsistent row and checks that the stored numbers are shown, and a static check looks for recomputation.
- `scripts/lib.mjs`: `landingSet` no longer follows registered `.parquet` files (they are read lazily after a selection, and `interactionBudget` now covers `revisions/` as well as `series/`). This changes the T91 explorer first-load figure (see below); it was needed so that the landing measure of a real export (many registered Parquet files) does not count files that are not fetched on load.
- Fixture: `tests/fixtures/site_spike/make_export.py` now writes `revisions/M09|M10|P01.parquet` and `revisions_recent.json` through the REAL producer code (`publish.revisions.build_versions`, `build_table`, `ordinary_revisions`, `edition_summaries`, `parquet_bytes`). Content (invented values): M09 regular revisions including a key with three versions and a tombstone; P01 two regular revisions and a 10-key re-estimation family; M10 stands in for a WEO-fed indicator with two editions (WEO-2026-04 initial, WEO-2026-10 rebases 12 keys of 2 series, `edition_ordered`), one summary with max 41.7 and median 5.5. M10 series rows in `meta/series.json` now have source `imf_weo_manual` and frequency `A`, plus a new M10 FRA series (id 300). 13 JSON files validate against the published schemas (`revisions-recent` added).

## Measured (real `gzip -9`, `scripts/measure-landing.mjs`, fixture export)
`revisions.html` first load 115,456 bytes gzipped in 24 files (limit 1,500,000; includes the Arrow and parquet-wasm JS wrappers, not the wasm); `index.html` 31,909; `domain/labour.html` 213,767; `peers/labour.html` 216,974; `explorer.html` 284,201 (was 290,418 before registered Parquet files stopped counting). `measure-explorer`: reader libraries 1,818,762 gz / 5,536,481 raw, unchanged. `check-npm-imports`: 6 files match `npm-imports.lock`; the lock was NOT changed (no new jsDelivr import: the page uses `html`, `Generators` and `FileAttachment` only). No new dependency; no off-origin URL in `dist/`.
Headless Chrome (DevTools protocol, throwaway script in the scratchpad, not committed): the page renders without error; the ordinary list shows 18 rows; the class filter gives 10 re-estimation rows (all with `data-class="reestimation"`) and 8 regular rows; choosing M09 fetched exactly one file, `revisions/M09.<hash>.parquet`; the history table, the "earliest stored version" label, the series select, the M10 named-edition rows and the fixed text rendered; no off-origin request; the visible text contains neither forbidden phrase.

## NEW WORDING for the user to confirm (the spec fixes none of it)
- Revised-data notice at the top of the page: "Revised data: this view is not a real-time record. Early periods show few revisions because versions exist only from this system's first fetch, and history before that fetch is shown as it stood at that fetch." (the spec only says the view must say that earlier history is revised data, not real time; the fixed text already ends with that sentence).
- Section titles "Recent revisions", "Named editions", "Vintage history of one series"; the line "Revisions of the last 12 months, in the order of the export. Showing N of M."; the named-edition explanation "A named edition (for example an IMF WEO release) can rebase history for thousands of keys at once, so it is shown as one line and never ranked among the ordinary revisions."; "(first stored <time>)" after an edition line; "Details, revision files: M10, ..."; the re-estimation note "Re-estimation revisions come from sources that re-estimate a whole history at once; they are marked and can be hidden so that they do not crowd out ordinary revisions."
- Filter label "Revision class" with options "All revisions", "Regular revisions only", "Re-estimation revisions only"; class text "regular" and "re-estimation"; empty texts ("No revisions of this class in the last 12 months.", "No named edition revised published history in the last 12 months.", "Choose an indicator to load its revision file (one file per indicator).", "No revised key of a headline series in this file.", "No stored versions of this series for that reference period."); "removed" for a tombstone; "later version k of n"; "(named edition)" after the version label; "(revised-data history)" after load kind `initial` (spec line on `load_kind`, D10); the sentence under the history heading: `A version labelled "earliest stored version" is the starting value of that period's history, not a revision.`; the omitted-rows sentence.

## Spec gaps, not worked around
1. The edition summary has no list of the indicators or files it touches. The page links "the per-indicator revision files" for the indicators found in `top_revisions[]` only (at most 10 rows), so an edition can touch more indicators than are linked; the vintage selector still reaches every file. A spec line (for example `indicator_ids[]` in the summary) would settle it; the exporter was not changed.
2. The links are plain download links to the Parquet files (`FileAttachment().url()`), not in-page navigation: Framework pages are static, and a link cannot preselect the indicator without more client code. Needs your decision if in-page navigation is wanted.
3. "earliest stored version" is applied to `is_base_version = true`. For a key whose earlier versions were projections (excluded from the view), the base is the first non-projection version, which the label reads as the earliest stored although a projection was stored earlier; the spec defines the base this way, the label is as the spec says.
4. Where the class filter applies: only to the ordinary list. In the vintage history every row is shown with its class marked (hiding rows would remove base versions and break a key's history). The spec says "the revision view lets the user hide systematic re-estimation families" without saying where.
5. `revisions_recent.json` rows carry `ref_period_start` but no `ref_period_end` or frequency, so the list shows the period start only.
6. The spec's AC-EXP-12 and AC-EXP-13(g) are tested here on the fixture with a JS render test, the built page and the Python build test; the committed browser smoke is T94. The class filter and the indicator/series selects were exercised only in the ad hoc headless Chrome run.

## Checks and limits
- Not covered: Firefox and Safari; touch/mobile; memory; a real `export` output; Pages compression (C2). The Observable import cache was warm.
- The CI `site` job and the Dependabot entry remain a separate step.

# V5 data freshness and status (T93)

Run date: 2026-11-04. Local build from the synthetic fixture export. Nothing pushed or deployed.

## User confirmation of 2026-11-04 recorded here (stated in session)
- The V4 wording choices listed in the T92 section "NEW WORDING for the user to confirm" are CONFIRMED.
- The V4 spec gaps listed in the T92 section "Spec gaps, not worked around" are ACCEPTED as listed; nothing further to do for them in v1.

- The V5 wording choices listed in the T93 section "NEW WORDING for the user to confirm" are CONFIRMED, and the V5 spec gaps listed in "Spec gaps, not worked around" are ACCEPTED as listed (user, 2026-11-04, stated in session; recorded by the T94 implementer).

## What was built (all under `site/`; allowed write locations only)
- `src/lib/status.js` (pure view-model, whitelist of fields), `src/lib/status-view.js` (renderer), static page `src/status.md` (no generated page: the paths are fixed; `FileAttachment("data/status.json")` is called in the page; no page variable named `view`). Linked from the landing page and added to `pages` in `observablehq.config.js`.
- Shows: last run (id, mode, start, finish, new raw objects, new observations, revisions), active alert count (`last_run.alerts_opened`; null reads "no analysis run for this ingest run", not zero), group table (state fresh/late/stale/broken, expected and latest period end, evaluated at, load result), backlog (unloaded count, oldest age in days), validation counts by family and severity, COV-01 per indicator ("not yet measurable" or the exported n_qualifying, n_results, n_failed), open drift events with kinds, next manual download per manual source (window and reminder date), the monthly check text and its generation time.
- Counts are shown as exported (thousands separators only); a static test rejects `.reduce(` and `Math.` in the view-model. Withheld groups carry state and dates only in the export, and the page renders only whitelisted fields, so a stray `value`, `error` or `message` field is not rendered (JS test). Free text is never shown, except the producer's fixed monthly check text; enum and code fields (state, load result, mode, group ids, drift kinds, dates) that do not have the expected form are replaced by "unrecognised state", "not exported" or "not shown".
- Fixture: `tests/fixtures/site_spike/make_export.py` writes `status.json` in the real producer's shape (same constants `STATUS_JSON_SCHEMA_VERSION`, `SCHEDULE_CHECK_TEXT`; validated against `status.schema.json`): four groups (fresh, late, stale, broken; one named `oecd_withheld`), `load_result` null everywhere, COV-01 one not-yet-measurable and one measured entry, two open drift kinds, a manual source with and without an expected window. The status producer itself needs a database session, so it was not run. The schema forbids extra fields, so the error-text-like fields that must not render are injected in `site/tests/status.test.mjs`, not written into the fixture export.

## Measured (real `gzip -9`, `scripts/measure-landing.mjs`, fixture export)
`status.html` first load 35,969 bytes in 14 files (limit 1,500,000); `index.html` 31,951; `domain/labour.html` 213,811; `revisions.html` 115,503; `explorer.html` 284,244. `check-npm-imports`: 6 files match, `npm-imports.lock` NOT changed (the page uses `html` and `FileAttachment` only). No new dependency, no off-origin URL.

## NEW WORDING for the user to confirm (the spec fixes none of it)
- Section titles "Last run", "Source groups", "Backlog", "Validation", "Coverage (COV-01)", "Open drift events", "Next manual download", "Monthly check"; "Active alerts"; state labels as exported; load result labels "ok", "warnings", "failed", "skipped" and "not exported".
- Notes: "Counts cover the published scope only (withheld sources are not counted). They are shown as exported."; "The load result of a group is not part of the export yet; the column is empty until it is."; "One figure for all sources together; the export has no backlog per group."; "COV-01 reports, per indicator, how many entities qualify and whether the check can be measured yet. The share of entities that were stale on arrival is not part of the export."; "Expected release windows come from the source configuration; the release months are not verified against the publisher."
- "no analysis run for this ingest run", "no expected window configured", "between X and Y (reminder on Z)", "unrecognised state", "not shown".

## Spec gaps, not worked around
1. `groups[].load_result` is always null (T83 gap): the column shows "not exported" and a note says so.
2. COV-01 carries state, n_qualifying, n_results, n_failed only; the spec's share of qualifying entities stale on arrival is not exported. The page shows the four numbers and does not compute a share.
3. The backlog is one aggregate block; the spec text for `groups[]` implies one per group. Shown as one block with a note.
4. `status.json` has no field that marks a group as withheld, so the page cannot label one; withheld groups appear as ordinary rows with state and dates.
5. "Active alert count" is read as `last_run.alerts_opened` (published watch or alert rows of the run's analysis); `status.json` has no other alert figure.
6. The spec does not say what the dashboard shows for `mode` or `severity`/`check_family` codes beyond showing them; they are shown as codes.

## Checks and limits
- Not covered: a browser run (no headless Chrome check of `status.html` this time; the built page and the JS render test only), Firefox, Safari, mobile, a real `export` output, Pages compression (C2). The CI `site` job and the Dependabot entry remain a separate step.

# Playwright smoke, golden numbers, size tests (T94)

Run date: 2026-11-04. Fixture export only (`tests/fixtures/site_spike/make_export.py`); nothing pushed, dispatched or deployed.

## What was built
- Dependency: `playwright` 1.64.1 (the package ADR-024 names; exact pin, `devDependency`), installed with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --save-dev --save-exact --ignore-scripts`; `site/package-lock.json` changed by the Playwright entries only; `npm-imports.lock` unchanged (6 files match). `npm audit` after the change: 3 low, 3 moderate, 0 high/critical; `audit-gate` passes. No browser binary downloaded by this task.
- Tests use `node:test` plus the Playwright library (no `@playwright/test` runner, so no second dependency): `site/tests/smoke/support.mjs` (127.0.0.1 static server over `dist/`, browser launch, off-origin blocking, JS port of the EXP-07 secret patterns), `static.smoke.mjs` (no browser: AC-DASH-2, AC-DASH-8, AC-SYS-10 file part), `browser.smoke.mjs` (20 tests). `npm test` now runs `tests/*.test.mjs` only; `npm run smoke` runs the smoke files.
- Browser choice: Playwright-managed Chromium (CI installs it with `npx playwright install --with-deps --only-shell chromium`, `scripts/ci/site-smoke.sh`); locally `MM_SMOKE_CHANNEL=chrome` or `MM_SMOKE_CHROME_PATH`. With no browser the browser tests SKIP with the reason; `MM_SMOKE_REQUIRE_BROWSER=1` (set by the wrapper) turns that into a failure.
- Covered: all V1-V5 pages (11 page loads) render with no page or console error, no failed request and no off-origin request (off-origin requests are aborted and recorded); landing first load measured in the browser (gzip -9 of served bodies) within 1.5 MB; V2 group filter (members only) and sort (name, value ascending); V3 indicator change fetches exactly one more series file, NSA series offers no seasonal-only transform, transform and rebase reach the chart title; V4 class filter and indicator choice (no revision file before the choice, exactly one after); V5 renders four groups, backlog equals `status.json`; stale banner absent on the fresh fixture (browser clock fixed at 2026-11-04) and present on a stale manifest (served `known_cutoff` 2025-06-01); AC-DASH-4 stale cells show their flag and "no rank (stale)", agri and global show no position; AC-DASH-3: ten pairs sampled evenly over all published numeric cells of the five domain scorecards, displayed value and percentile compared with the published scorecard JSON (percentile only where the domain is ranked, value not stale or descriptive; elsewhere no number may be shown); AC-DASH-8: no secret pattern in any file of `dist/` (names only reported) and no DB variable name in the data JSON; AC-SYS-10 on the fixture: the built manifest `build_id` equals the export's (`EXPORT_DIR/manifest.json` or `MM_EXPECT_BUILD_ID`) and every page shows and fetches that id.

## Decisions and spec gaps (not worked around)
1. The task says "the stale fixture": no separate stale export is built. The stale case is the same build served with a rewritten manifest `known_cutoff`, which is what the banner reads. A real stale export build is not done.
2. AC-DASH-3 says "published tables (`analytics.*_published`)". The fixture has no database, so the golden source is the published `scorecard/<domain>.json` of the export (which the export spec derives from those tables). Golden values for a real export need T80's database fixture.
3. AC-SYS-10 is checked only as "the served manifest has the run's build id". "The Pages site serves it" and "no Neon connection" cannot be tested before the first deploy (AC-DASH-8 beyond the file scan is likewise a post-deploy check, not shown by Playwright).
4. The CI job is named `site` in `ci.yml` (the task text), not `export-and-site`; the workflows spec's pipeline `site` job is a different job (T74+).
5. `actions/setup-node` has no verified commit SHA in the repository, so it is NOT used (OP-07 open). The `site` job checks that the runner's preinstalled Node has the major version of `site/.nvmrc` (20) and fails otherwise. If the runner image drifts to another major, the job fails loudly; the fix is a SHA-pinned `setup-node` from OP-07. Likewise no `actions/cache` for the browser directory (no verified SHA); BB30/OQ-18 (download time) is untested.
6. The job uses `npm ci --ignore-scripts`; verified in a clean copy that it installs, builds, passes `check:imports` (6 files match the lock), the audit gate and the 25 smoke tests (no browser download).

## Checks and limits
- Not covered: a real CI run (BB30, actionlint-clean YAML only), Firefox and Safari (manual, BB16), a real export (C3), Pages compression (C2), a Playwright assertion for AC-DASH-6 (rebase equivalence, other task), the `--with-deps` apt step (needs a runner).

---

# Real Eurostat slice on a throwaway Neon database (2026-11-04)

Operator-authorised run (live network for Eurostat only). Database `mm_dev_slice_20261104` on the Neon test branch (roles `mm_{owner,ingest,analytics,r,reader}_mm_dev_slice_20261104`); `neondb` and `postgres` untouched. Scratch scripts are outside the repo. Config was a scratch git copy with `eurostat.enabled: true` (the repo config stays `false`).

- `migrate`: ok, versions 0..11 applied. `sync-config`: ok (mapped=0, pending=11 first-sight series).
- `fetch --group eurostat_labour`: FAILED. The planned URL carries `c[TIME_PERIOD]=ge:1991` (`TIME_FILTER_PARAM` in `src/macro_monitor/ingestion/connectors/sdmx.py`, request template in `config/sources.yaml`). The live API answers HTTP 500 `GET_FILTERED_DIMENSIONS: Error during the filtering of the constraint` for it (also for `ge:1991-01`); the connector retried 4 times, one `ingest.fetch_attempt` row with status 500, nothing archived. The same request with `sinceTimePeriod=2024-01` instead returns HTTP 200 (5.6 KB) in a single probe. This is the OP-04 `[UNVERIFIED]` query syntax proving wrong; the fix (config param plus the connector's required-param check, possibly spec/ADR-004 wording) was not made here.
- load, analyze, export, site build: not run. The database was NOT dropped. Drop: `.venv/bin/python -I <scratchpad>/setup_db.py drop 20261104`, or as superuser `DROP DATABASE mm_dev_slice_20261104 WITH (FORCE);` then `DROP ROLE` for the five roles above.
- Also: `.gitignore` gained `data/raw_dev_slice/` and `data/export/` (only `data/raw|staging|curated` were ignored).

## Eurostat time filter fixed and slice completed (2026-11-04, second run)

- Live probe (polite, 1 request for the full slice; robots.txt does not disallow `/eurostat/api/`; the API returned no ETag/Last-Modified, so conditional requests are not available for it): `.../statistics/1.0/data/une_rt_m?format=JSON&freq=M&s_adj=SA&age=TOTAL&unit=PC_ACT&sex=T&geo=DE&geo=ES&geo=FR&sinceTimePeriod=1991-01` returns HTTP 200, JSON-stat 2.0 (`version 2.0`, `class dataset`), `updated` 2026-10-30T11:00:00+0100, 31.8 KB. Dimension ids in order `freq, s_adj, age, unit, sex, geo, time` (the time dimension id is `time`, not `TIME_PERIOD`); sizes 1,1,1,1,1,3,429 (1991-01..2026-09). The series keys `M.SA.TOTAL.PC_ACT.T.{DE,FR,ES}` in `config/series_map/eurostat_labour.yaml` are CONFIRMED against the live response; the parser needed no change. `c[TIME_PERIOD]=ge:1991` and `ge:1991-01` give HTTP 500.
- Recorded fixture: `tests/fixtures/raw/eurostat/une_rt_m_live_20261104.json` plus `.meta.yaml` (source URL, fetch timestamp, sha256 f7779496...b9908a). The older synthetic fixtures are unchanged.
- Fix: `TIME_FILTER_PARAM = "sinceTimePeriod"` (`src/macro_monitor/ingestion/connectors/sdmx.py`), request template value `"1991-01"` in `config/sources.yaml`, tests updated; two new unit tests parse the live capture and check its sidecar hash.
- Pipeline on throwaway DB `mm_dev_slice_20261104b` (first DB `mm_dev_slice_20261104` is kept, but see the finding below; neither dropped): fetch 1 raw object (1 fetch attempt, 200), load 1 raw_load, 1287 curated observations (3 series x 429, 1991-01..2026-09), staging.rejected 0, 7 validation results all pass (REV-01..05, DB-04, DB-05), drift events 0; analyze: snapshot 3434 rows (scaffold, 3 with values), 3 alerts, scorecard 210 rows; export: 21 files, 3.09 MB, checks EXP-01..10 pass, 0 warnings; record-export: ok.
- FINDING (not fixed, design/config issue): the first export attempt failed `EXP-02: global entity ['WLD'] in domain agri`. `config/indicators.yaml` gives G02 (`scope: global`) the domain `agri`, but the export rule (WLD only in the `global` domain) forbids it; it would fail on any export with a G02 WLD snapshot row. The second DB was run from a scratch config copy with G02 moved to `global` (scratch only; repo config untouched). Moving it in the first DB was not possible because config sync never removes domain links.
- Site: built with `EXPORT_DIR=<export>/data` (the directory that holds `manifest.json`, not its parent); 36 links validated. Headless Chrome: scorecard, domain labour, explorer (3 country boxes, Plot SVG with series paths) and status render with no exceptions and no off-origin requests. Screenshots are in the session scratchpad (not committed).

## G02 domain move applied in code (2026-11-04, per the approved `docs/specs/g02-domain-move-amendment.md`)

- The finding "EXP-02: global entity WLD in domain agri" (section "Eurostat time filter fixed and slice completed") is fixed in the repo: `config/indicators.yaml` G02 now has `domains: [{id: global, ranked: false}]`; the golden `resolved_indicators.csv` row 26 changed in the domain cell only (`global:U`).
- New config rule 44 (`registry/indicators.py`): a `scope: global` indicator belongs to domain `global` only; no other indicator belongs to `global`. Unit tests cover the shipped file, G02 in `agri`, G02 in `agri` and `global`, G02 with no membership, and a country-scope indicator in `global`; the `global` domain members are asserted to be exactly M24 and G02.
- Migration `0012_g02_remove_agri_domain_link.sql` deletes the stale (G02, agri) row of `ref.indicator_domain` (sync-config never deletes links). The 0002 feeder trigger records it as one `op = delete` row in `ref.config_history` (git_sha `migration-0012`); no history, curated or raw-manifest row is updated or deleted. It was NOT applied to `neondb` or `postgres`; applying it to `neondb` needs the user's explicit request. Databases created before this change (for example `mm_dev_slice_20261104`) get the fix through `macro-monitor migrate`.
- A unit test with a G02 `WLD` snapshot row (membership read from the shipped config) exports under `scorecard/global.json` without EXP-02; the old `agri` membership still raises EXP-02 (negative control).

## Operator probes OP-04 for five parked groups (2026-11-06)

Authorised live probes, geo=DE only (World Bank: DEU, `per_page=100`, first page). URLs were built from each group's own `plan()` and then narrowed to one country; sent through `HttpClient` (generic client name, `min_interval_s` honoured, retries capped at 1, robots gate on). All five groups stay `enabled: false`; no database, no workflow, no fetch/load command.

- Requests: ec.europa.eu 6 (robots.txt 1, data 5), api.worldbank.org 3 (robots.txt 1, data 2). All data requests HTTP 200 on the first try; no retry, no 403/429/challenge, robots allowed. Bodies (7-33 KB) are stored unmodified with `.meta.yaml` sidecars as `tests/fixtures/raw/eurostat/probe_*_DE_2026-11-06.json` and `tests/fixtures/raw/worldbank/probe_*_DE_2026-11-06.json`. Golden parses: `tests/unit/test_probe_fixtures_op04.py`.
- Confirmed (verified by probe 2026-11-06, DE):
  - `sts_trtu_m` (indic_bt=VOL_SLS, nace_r2=G47, s_adj=SCA, unit=I21): dimension order `freq, indic_bt, nace_r2, s_adj, unit, geo, time`, key `M.VOL_SLS.G47.SCA.I21.DE`, 393 values 1994-01..2026-09 (period `YYYY-MM`), updated 2026-11-05. Every value carries flag `p`, so all load as PROV.
  - `prc_hicp_minr` (unit=I25, coicop18 TOTAL, TOT_X_NRG_FOOD, CP01): order `freq, unit, coicop18, geo, time`, keys `M.I25.{TOTAL,TOT_X_NRG_FOOD,CP01}.DE`, 1996-01..2026-10 (370 months; 1109 values, one CP01 2026-10 missing), labels "Index, 2025=100". Flags `d` (252, definition differs) and `b` (1, break) map to OBS, `e` (2, 2026-10) to EST. Updated 2026-11-04.
  - `gov_10q_ggdebt`: 106 values 2000-Q1..2026-Q2 (period `YYYY-Qn`, `sinceTimePeriod=1991-Q1` accepted), unit PC_GDP, flag `p` on 34. Updated 2026-10-21.
  - `namq_10_gdp` (unit=CP_MNAC, s_adj=SCA, na_item=B1GQ): order `freq, unit, s_adj, na_item, geo, time`, key `Q.CP_MNAC.SCA.B1GQ.DE` unchanged, 143 values 1991-Q1..2026-Q3 (flag `p` on 15), `jsonstat_v2@2` yields PERIOD_FLOW. Updated 2026-11-05.
  - `NY.GDP.MKTP.CN` / `NY.GDP.MKTP.CD` (DEU): HTTP 200, 35 annual values 1991..2025, `lastupdated` 2026-10-08, row `unit` empty, parser fills LCU / USD and PERIOD_FLOW as expected; keys `NY.GDP.MKTP.CN.DEU`, `NY.GDP.MKTP.CD.DEU` unchanged.
  - Units I21, I25, PC_GDP, CP_MNAC, LCU, USD exist in the ref.unit seeds (0001, 0013, 0015); no new unit row needed.
- Differed:
  - `gov_10q_ggdebt` dimension order is `freq, na_item, sector, unit, geo, time`, not `freq, unit, sector, na_item`. Series keys corrected from `Q.PC_GDP.S13.GD.<geo>` to `Q.GD.S13.PC_GDP.<geo>` (27 entries in `config/series_map/eurostat_gov_debt.yaml`, `scripts/eurostat_proposal_csv.py`, the synthetic fixture `gov_10q_ggdebt_synthetic.json` and its sidecar, the T53 golden test). The request URL is unaffected.
  - `sts_inpr_m` with `indic_bt=PROD`: HTTP 200 but an EMPTY cube (`indic_bt` size 0, no values). The code is wrong; the probe does not reveal the right one (likely `PRD`, not verified), so `eurostat_sts` keys for sts_inpr_m (M01) are NOT changed and `sts_inpr_m` stays unconfirmed. Needs one more authorised probe (for example `indic_bt=PRD`).
- Still unverified: all non-DE geo codes and coverage (EL/GR, Turkiye in sts/hicp, BG/HR currency history for X01), `expected_series_min` placeholders, `freshness` lags (observed: namq_10_gdp Q3 2026 already present on 2026-11-05, HICP 2026-10 present on 2026-11-04, sts 2026-09 on 2026-11-05; the configured lags are untouched), `reestimating`/revision behaviour, the async status body, `base_period` (the parser leaves it null for I21/I25), World Bank coverage of the other 41 countries. Retail `p`-on-everything for DE is a data fact to weigh for the revision rules.

Review follow-ups (OP-04, 2026-11-06):
- HICP mixed edge: the latest month 2026-10 is a flash estimate (flag `e`) for all-items and core, while CP01 (food, G01) has no 2026-10 value. G01 therefore trails M06/M07 by a month, and the EST values will be revised at the full release.
- Core HICP break: the `b` (break) flag at 2017-01 in TOT_X_NRG_FOOD maps to status OBS, so the break lives only in `source_flags`; long-history analytics (z-scores) do not see it.
- German `NY.GDP.MKTP.CN` history is in euros for the whole period (1991 value about 1.59e12), which supports research F2 for DE.
- Freshness lags, configured vs observed (DE only, 2026-11-06):

  | group | configured typical_lag_days | observed |
  |---|---|---|
  | eurostat_gdp_q | 115 | about 36 d |
  | eurostat_sts | 46 | about 36 d |
  | eurostat_hicp | 17 | about 4 d (flash) |
  | eurostat_gov_debt | 100 | 113 d (observed is LONGER than configured: a false "late" is possible once enabled) |

  Configured values are unchanged; to be revisited with multi-country evidence.
- Licence point: the committed real World Bank response bytes (`tests/fixtures/raw/worldbank/probe_*`) sit in the repo while `redistribution_of_raw` for worldbank is `[UNVERIFIED]`. To confirm before treating them as public archive material.
