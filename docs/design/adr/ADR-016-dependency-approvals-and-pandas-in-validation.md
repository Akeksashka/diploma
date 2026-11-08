---
status: approved   # approved by the user on 2026-10-25 (stated in session) after read-only review
---
# ADR-016: Approved additional dependencies; pandas is allowed in `validation/` for pandera frames as well as in `analytics/`, and nowhere else (amends ADR-004)

Date: 2026-10-25 (Phase 2 amendment batch). Repository facts from ADR-004, ADR-006, ADR-007 and the v1 plan (BL-11), read 2026-10-25. External facts carry their source; unverified ones are marked.

## Context
- ADR-004 (Consequences, last bullet) confines pandas to `analytics/` ("parsers and loaders use pyarrow/plain Python"). ADR-004 and ADR-007 also adopt `pandera` for staging-frame contracts in `validation/`. Pandera validates dataframes, and its default backend is pandas, so the two statements conflict unless `validation/` may hold pandas frames (plan BL-11).
- Dependencies used by the approved specs but missing from every ADR dependency list: JSON-Schema validation of `config/` and of the export files (source-config spec, export spec EXP-01), pytest plugins for the `unit` no-network rule and for hanging two-session database tests, and a browser test tool for the headless smoke test of the dashboard (AC-DASH-1).
- External facts: pandera 0.30.0 is reported to add pandas 3 support [SEARCH, third-party aggregator: https://newreleases.io/project/pypi/pandera/release/0.30.0, accessed 2026-10-25; the tooling research pins pandera 0.34.1]. Playwright documents `npx playwright install --with-deps` for CI and recommends the CLI over its archived GitHub Action [SEARCH: https://playwright.dev/docs/browsers, accessed 2026-10-25]; its docs footer states the Apache License 2.0. pytest-socket is MIT-licensed [SEARCH: https://pypi.org/project/pytest-socket, accessed 2026-10-25]. Licences of `jsonschema` and `pytest-timeout` were not checked here [UNVERIFIED; both are believed permissive].

## Options considered
1. Drop pandera and write contracts by hand. Removes the pandas question, but ADR-007 chose pandera and a hand-written contract layer is more code.
2. Allow pandas everywhere. Violates the reason for the original confinement (pandas 3 compatibility unchecked, BB13) and lets pandas spread into the loader.
3. Allow pandas in `validation/` (frames for pandera) and `analytics/`, nothing else.
4. Reject a browser test tool and test the site only by JS unit tests. AC-DASH-1 requires a headless browser smoke test.

## Decision
Option 3 plus these approvals (user decision 2026-10-25):
1. Approved runtime dependencies: `jsonschema` (config and export schema validation; also used by the export tests), `pandera` (as in ADR-004/007), `pandas` (needed by pandera and by `analytics/`; version pinned by the lockfile after spike T04 / BB13).
2. Approved dev/test dependencies (minimal set): `pytest-socket` (enforces "no network" for `unit` tests), `pytest-timeout` (bounds the two-session database tests that wait on advisory locks). Nothing else: no `pytest-cov`, `pytest-xdist`, `hypothesis` or `pytest-asyncio`; property-style tests use seeded standard-library randomness. Adding another plugin needs a new ADR.
3. Approved site test tool: Playwright (npm `devDependency` of `site/`, Chromium only, installed in CI with the Playwright CLI, locked by `site/package-lock.json`). It is a build/test-time tool on the Actions runner and never part of the deployed site or the pipeline; Node stays a build-time tool for `site/` (ADR-006). This approval does not choose the dashboard toolkit (plan BL-10 / ADR-010 update remains open).
4. Boundary rule: `import pandas` (and `import pandera`) is allowed only under `src/macro_monitor/analytics/` and `src/macro_monitor/validation/`. Everything else (`ingestion/`, `storage/`, `registry/`, `models/`, `monitoring/`, `publish/`, `cli.py`) uses plain Python, `Decimal`, and `pyarrow`. In `validation/` a frame is created only in `contracts.py` from staged rows at the validation boundary and is not returned to callers; the functions in other modules receive and return plain types. The same rule applies to `statsmodels` (analytics only).
5. Enforcement: a unit test parses every module under `src/macro_monitor/` with the `ast` module and fails on a pandas or pandera import outside the two allowed packages (acceptance criterion AC-DEP-1 in `docs/specs/ingestion-interfaces-spec.md` section 8).
6. Fallback unchanged from the design register BB13: if the T04 spike shows pandera and pandas 3 do not work together, pin an older pandas; if pandera fails altogether, replace the contracts layer with hand-written checks; this does not reopen the boundary rule.

## Consequences
- Pro: resolves the ADR-004 versus ADR-007 conflict with a mechanically tested rule; the loader and export stay free of pandas; the test tool set is two small plugins and one browser tool.
- Con: two more third-party test plugins and a browser download (hundreds of MB, cached) in the `export-and-site` CI job; Playwright browser binaries come from an external download at CI time (network at CI build only, never at pipeline run time); pandas becomes a direct dependency, so the lockfile carries numpy.
- ADR-004 stays `approved` and its text unchanged; this ADR amends only the sentence "pandas is confined to `analytics/`" and extends its dependency list. ADR-007's pandera decision is unchanged.
- Open and not decided here: the property-test library (hypothesis is not approved), the dashboard toolkit, and the Playwright version pin (set by the lockfile at implementation).
