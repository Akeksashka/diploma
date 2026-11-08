---
status: approved   # proposed | approved | superseded
---
# ADR-004: Ingestion framework: own thin HTTP layer, connector protocol, sdmx1 for parsing only

Revision note (review fixes): change detection compares with the latest manifest object (revert-safe, A1); parser versions are kept importable (B12).

## Context
- CLAUDE.md: raw stored with URL, fetch timestamp, hash; respect terms, rate limits, robots.txt; cache and use conditional requests.
- Tooling research: `sdmx1` (Apache-2.0, Python >= 3.10) has source definitions for ECB, Eurostat (+Comext), BIS, ILO, IMF, OECD, World Bank, but no raw-capture hook and documented per-source quirks (Eurostat ZIP/async, ILO base URL change, OECD_JSON SSL workaround). `requests-cache` and `hishel` provide HTTP caches and conditional requests, but a cache is not the immutable raw archive, and on ephemeral runners a disk cache is lost between runs. DBnomics client is AGPL-3.0 (user: skip it). `pandasdmx` does not install on Python 3.12. `fredapi` is stale (0.5.2, 2024). httpx 0.28.1 works on 3.12 (tooling research A, B).
- Source facts that shape the design (data-sources research, accessed 2026-10-17): Eurostat returns an `updated` timestamp, has async mode above 500,000 cells and error 413 above 5,000,000, and `lastNObservations` does not reduce extraction size; OECD limits are in conflict (60 downloads/hour vs 20 downloads/hour), `UpdatedAfter` exists, and since March 2026 `lastNObservations`/`firstNObservations` return 413 on twelve large datasets; BIS offers per-topic bulk files; World Bank keyless; IMF new API answers keyless but automated bulk download needs permission (see ADR-005); ECB API returned 503 earlier on 2026-10-17 and 200 on retry.

## Options considered
1. Use sdmx1 end to end (fetch + parse).  Raw bytes are not retained by default; behaviour differs per source.
2. Own HTTP layer (httpx) for every request + format-specific parsers; sdmx1 only to parse SDMX messages and structures where convenient.
3. requests-cache/hishel as the HTTP layer.
4. A generic ingestion framework (dlt, Singer, Airbyte). Not researched; adds a runtime; not justified for about 10 sources.

## Decision
Option 2.
- A `Connector` protocol with four steps: `plan(state) -> list[RequestSpec]`, `fetch(RequestSpec, state) -> FetchResult` (always returns bytes + metadata, never parsed objects), `parse(raw_object) -> Iterable[ParsedObservation]`, `describe_series(raw_object) -> Iterable[SeriesMeta]`. Connector kinds: `sdmx`, `rest`, `bulk`, `web`, `manual` (ADR-005). Interfaces: `docs/specs/ingestion-interfaces-spec.md`.
- One shared `HttpClient` (httpx): identifying User-Agent with repo URL and "non-commercial", timeouts, retries with exponential backoff and jitter on 429/5xx/timeouts (honour `Retry-After`), per-host token bucket from config, one concurrent request per host by default, TLS verification always on (no legacy-SSL workaround; a source needing it is not onboarded).
- Change-detection ladder per request (cheapest first): (1) HTTP validators (`If-None-Match`/`If-Modified-Since`) with validators persisted in Neon `ingest.request_state`; (2) source-declared update marker probed cheaply (Eurostat `updated`, OECD `UpdatedAfter`/content constraint, BIS bulk file date, FAO release calendar); (3) fetch and compare sha256 with the sha256 of the LATEST `ingest.raw_object` of the request (not with any earlier object, so a revert to earlier content is detected as a change; ADR-003). A 304, an unchanged marker, or a hash equal to the latest object's ends the pipeline for that request with a `fetch_attempt` row and no new raw object. The ladder decides only whether to fetch and store; whether stored objects are loaded is tracked separately in `ingest.raw_load`, so a 304 after a failed load cannot hide the unloaded change.
- Request sizing rules are connector config, not code: Eurostat requests always carry a time filter (`c[TIME_PERIOD]=ge:1991`) and a country list to stay below 500,000 cells; async responses are polled with backoff up to a configured ceiling; OECD uses whole-dataflow downloads from 1991 (no wildcards, no `lastNObservations`), budgeted at no more than 8 data downloads per hour (below even the stricter 20/hour reading) via `rate_limit.budget_per_hour`. With that budget the OECD group is the long pole of the fetch phase; its job timeout is set per group (`job_timeout_min`, 300 for OECD, default 120; workflows spec section 1; black box BB28).
- Parsing: SDMX-CSV or JSON-stat where the source offers them, otherwise SDMX-ML via sdmx1 reading the archived bytes [UNVERIFIED that sdmx1 reads from in-memory bytes in the pinned version; spike and fallback in black box BB27: a small direct XML parser for the three structures needed]. Parsers filter to the series whitelist from `config/series_map` before staging, to protect the 1 GB database limit. Parsers are pure functions versioned by `PARSER_VERSION`; every released version stays importable via a registry so that stored raw objects can be re-parsed (re-staging, rebuild; B12).
- Dependencies added: `httpx`, `sdmx1`, `lxml`, `openpyxl` (XLSX: Pink Sheet, WEO/AMECO files), `pyarrow`, `psycopg` (v3, Postgres driver; standard choice, not covered by the tooling research), `pandera`, `PyYAML`, `zstandard`. Not added: requests-cache, hishel, dbnomics client, fredapi, pandasdmx, eurostat/pyrostat wrappers, wbgapi (the World Bank API is simple enough for direct calls; revisit if WDI Archives, db 57, is needed). DBnomics is called by direct REST only for AMECO (data-sources research F5, A02c; U5 rule).

## Consequences
- More code than a client-library approach, but every source behaves the same for archiving, rate limiting and change detection, and unit tests need only recorded bytes.
- Per-source quirks live in connector config and parser modules and are covered by fixture tests; live behaviour is covered by `@pytest.mark.network` smoke tests run by the `preflight` workflow.
- Conditional-request support per source is untested (tooling research, risk 2); the ladder degrades gracefully to hash comparison, at the cost of a download.
- Pinning: a lockfile is required; `uv` is proposed [UNVERIFIED: not covered by research; `pip-tools` is the fallback]. pandas 3 compatibility with statsmodels and pandera is unchecked (tooling research, finding 9), so parsers and loaders use pyarrow/plain Python and pandas is confined to `analytics/`.

## Change log
- Round 5 (2026-10-24): the sdmx1-from-bytes assumption is registered as BB27 with a spike and fallback; the OECD job timeout is a per-group setting (BB28); explicit missing markers are parsed as `MISS` observations (ingestion spec section 1, PARSE-03).
