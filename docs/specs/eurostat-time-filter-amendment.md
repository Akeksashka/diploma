---
status: approved   # approved by the user on 2026-11-04 (stated in session: "adopt recommendations"); merging the text edits into the approved documents is a separate Phase 2 step
amends:
  - docs/design/adr/ADR-004-ingestion-framework-and-connectors.md   # lines 23-24 (wording and one fact; the decision is unchanged)
  - docs/specs/source-config-schema.md                              # line 93 (example), optional new rule
  - docs/specs/ingestion-interfaces-spec.md                         # section 6, one added sentence
  - docs/design/macro-monitor-platform-design.md                    # line 259 (table cell), line 608 (note)
  - docs/plans/macro-monitor-v1-implementation-plan.md              # line 310 (T23 acceptance wording)
inputs:
  - docs/ops/spike-results.md                                       # sections "Real Eurostat slice" and "Eurostat time filter fixed", lines 351-367
  - tests/fixtures/raw/eurostat/une_rt_m_live_20261104.json         # with its .meta.yaml
  - docs/design/adr/ADR-002-bitemporal-append-only-observation-store.md
  - docs/design/adr/ADR-003-raw-archive-github-immutable-releases.md
  - docs/specs/frequency-downgrade-amendment.md                     # style precedent
  - docs/specs/g02-domain-move-amendment.md                         # style precedent
---
# Amendment: Eurostat time filter is `sinceTimePeriod`; Eurostat gives no HTTP validators, so content hash decides

Date: 2026-11-04. Repository facts were read on 2026-11-04 (file paths and line numbers are the citations; line numbers are as of this date). Live API facts come from the operator-authorised probe of 2026-11-04 recorded in `docs/ops/spike-results.md:356-364` and the fixture `tests/fixtures/raw/eurostat/une_rt_m_live_20261104.json` (source URL, fetch timestamp and sha256 are in its `.meta.yaml`); they were not re-probed by this document. No ADR is proposed: the ladder decision of ADR-004 (validators, then marker, then hash against the LATEST object) is unchanged; only a request parameter spelling and two premises about Eurostat were wrong. The text of sections 1 and 3 is enough for an ADR if the user wants one (question D-1).

## 0. Facts (verified live 2026-11-04, `spike-results.md:362`)
| # | Fact | Evidence |
|---|---|---|
| F1 | `c[TIME_PERIOD]=ge:1991` and `c[TIME_PERIOD]=ge:1991-01` return HTTP 500 `GET_FILTERED_DIMENSIONS: Error during the filtering of the constraint` on `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m` | `spike-results.md:356`, `:362` |
| F2 | `sinceTimePeriod=1991-01` returns HTTP 200, JSON-stat 2.0 (429 time points 1991-01..2026-09, 31.8 KB for DE, ES, FR) | `spike-results.md:362` |
| F3 | The time dimension id in the response is `time`, not `TIME_PERIOD` (dimension ids in order `freq, s_adj, age, unit, sex, geo, time`) | `spike-results.md:362` |
| F4 | The response carries no `ETag` and no `Last-Modified`; conditional requests are impossible for this API. The dataset's `updated` field (2026-10-30T11:00:00+0100 in the capture) is inside the JSON body | `spike-results.md:362` |
| F5 | `robots.txt` does not disallow `/eurostat/api/` | `spike-results.md:362` |

Independent documentation: Eurostat's Statistics API guide names `sinceTimePeriod`, `untilTimePeriod` (both bounds inclusive) and `lastTimePeriod` as the time filters of the `statistics/1.0/data` endpoint (https://ec.europa.eu/eurostat/en/web/user-guides/data-browser/api-data-access/api-getting-started/api and https://wikis.ec.europa.eu/x/KgWyBQ, found by web search 2026-11-04, pages not fully read; secondary R package docs at https://ropengov.github.io/eurostat/reference/get_eurostat_json.html agree). The `c[TIME_PERIOD]` form belongs to the SDMX 2.1/3.0 data endpoint family, not to this endpoint [INFERENCE from F1; not verified in Eurostat documentation].

Scope of F4: verified for ONE dataset (`une_rt_m`, one request) on one day. Treat it as the working assumption for every Eurostat `statistics/1.0/data` request; the rule in section 3 does not depend on it, because it applies whenever validators are absent. [UNVERIFIED for other datasets and for async responses.]

Code state (read-only, 2026-11-04): `src/macro_monitor/ingestion/connectors/sdmx.py:44` `TIME_FILTER_PARAM = "sinceTimePeriod"`, required in the request template by `plan` (`:120-121`, error `ConnectorConfigError`); `config/sources.yaml:36` `change_detection: [update_marker, content_hash]` and `:42` `sinceTimePeriod: "1991-01"`. The code and config are already correct; the documents are stale.

## 1. Rule: the Eurostat time filter
Every Eurostat `statistics/1.0/data` request carries `sinceTimePeriod=<YYYY-MM>` (monthly, in the form the dataset's time dimension uses; `1991-01` verified for monthly) plus an explicit country list. `c[TIME_PERIOD]=...` is not used on this endpoint. The sizing rule of ADR-004 (stay below 500,000 cells) is unchanged. The parser reads the time dimension by its response id (`time`) and must not hard-code `TIME_PERIOD` [see `spike-results.md:30`, an older spike note, which names `TIME_PERIOD` for a different response form; informational only].

## 2. Exact edits in approved documents (applied only after approval, by a later Phase 2 merge step; none applied here)

| # | File:line (2026-11-04) | Old text | New text |
|---|---|---|---|
| E1 | `docs/design/adr/ADR-004-ingestion-framework-and-connectors.md:24` | "Eurostat requests always carry a time filter (`c[TIME_PERIOD]=ge:1991`) and a country list to stay below 500,000 cells;" | "Eurostat requests always carry a time filter (`sinceTimePeriod=1991-01`; the SDMX-style `c[TIME_PERIOD]=ge:1991` is rejected by this endpoint with HTTP 500, verified 2026-11-04) and a country list to stay below 500,000 cells;" |
| E2 | `ADR-004:23`, step (2) | "(2) source-declared update marker probed cheaply (Eurostat `updated`, OECD `UpdatedAfter`/content constraint, BIS bulk file date, FAO release calendar);" | "(2) source-declared update marker, where the source offers a separate cheap probe (OECD `UpdatedAfter`/content constraint, BIS bulk file date, FAO release calendar); for Eurostat the `updated` timestamp exists only inside the response body, so it is recorded as a diagnostic after the download and does not skip the request;" |
| E3 | `ADR-004:23`, step (1) | "(1) HTTP validators (`If-None-Match`/`If-Modified-Since`) with validators persisted in Neon `ingest.request_state`;" | same, plus: "sources that return no `ETag`/`Last-Modified` (Eurostat `statistics/1.0/data`, verified 2026-11-04) never get conditional headers and fall through to steps (2) and (3);" |
| E4 | `ADR-004:31` | "Conditional-request support per source is untested (tooling research, risk 2); the ladder degrades gracefully to hash comparison, at the cost of a download." | Append: "Eurostat `statistics/1.0/data`: tested 2026-11-04, no validators; every run downloads each request once (31.8 KB for the first slice) and compares sha256 with the latest object." (Optional; the sentence is true as written.) |
| E5 | `docs/specs/source-config-schema.md:93` | `params: {format: JSON, "c[TIME_PERIOD]": "ge:1991", geo: "{entities}"}` | `params: {format: JSON, sinceTimePeriod: "1991-01", geo: "{entities}"}` |
| E6 | `source-config-schema.md:87` (comment on `change_detection`) | "ordered ladder; any of http_validators \| update_marker \| content_hash ; automated kinds only (rule 4)" | append: "; a step the source cannot serve is simply skipped (see ingestion-interfaces-spec section 6); `content_hash` is always the last step" . The Eurostat example value `[update_marker, content_hash]` stays. |
| E7 | `source-config-schema.md`, after the last numbered rule (next free number at merge; 44 or 45 depending on whether `g02-domain-move-amendment.md` E6 is merged first) | none | OPTIONAL rule: "A group of an `sdmx` source whose `base_url` is the Eurostat `statistics/1.0` API has `sinceTimePeriod` in `request_template.params` and no key starting with `c[`. Error names group and key." The connector already enforces the first half at `plan` (`sdmx.py:120`); the rule makes `validate-config` catch it earlier. See D-4. |
| E8 | `docs/specs/ingestion-interfaces-spec.md`, section 6, after line 173 | none | New bullet: the no-validator rule of section 3 below, verbatim. |
| E9 | `ingestion-interfaces-spec.md:35` | "# source-declared (e.g. Eurostat 'updated')" | "# source-declared (e.g. Eurostat 'updated', read from the response body)" |
| E10 | `docs/design/macro-monitor-platform-design.md:259` (SDMX row, change detection column) | "Eurostat `updated`; OECD `UpdatedAfter`/content constraint; hash" | "Eurostat `updated` (in the body; diagnostic) then hash; OECD `UpdatedAfter`/content constraint; hash" |
| E11 | `platform-design.md:259` (same row, access column) | "one request per dataset with time filter `>=1991` and country list" | "one request per dataset with time filter (Eurostat `sinceTimePeriod=1991-01`; OECD `startPeriod`) and country list" |
| E12 | `platform-design.md:608` | "(M09, dataset `une_rt_m` [UNVERIFIED filter values, confirmed at fixture capture])" | "(M09, dataset `une_rt_m`; filter values confirmed by the live capture of 2026-11-04)" |
| E13 | `docs/plans/macro-monitor-v1-implementation-plan.md:310` (T23 acceptance) | "request carries `c[TIME_PERIOD]=ge:1991` and a country list; ... `updated` probe;" | "request carries `sinceTimePeriod=1991-01` and a country list; ... `updated` read from the body into `update_marker`;" (T23 is done; this is a record correction. Plan edit resets plan status per the project rules, so batch it with other plan edits.) |

No edit needed (checked 2026-11-04):
- `docs/design/adr/ADR-001-pipeline-orchestration-github-actions.md:12` and `docs/specs/workflows-spec.md:56`: generic "ETag, last-modified, last-seen update marker"; still true for sources that have them.
- `docs/design/adr/ADR-003-raw-archive-github-immutable-releases.md:43`: manifest column "ETag/Last-Modified" (nullable); already allows null (`ingestion-interfaces-spec.md:97` shows `"etag": null`). `ddl-neon-schema.md:337`, `:350`, `:375`: columns are nullable `text`.
- `docs/design/adr/ADR-005-web-collection-policy-and-manual-inbox.md:24`: "conditional requests" is a default for `kind: web` sources; Eurostat is an API source (ADR-005 line 27), not covered.
- `docs/design/adr/ADR-008-neon-operating-model.md`: no statement about Eurostat filters or conditional requests (grep 2026-11-04).
- `ingestion-interfaces-spec.md:80`: `lastTimePeriod` as an example of an incremental Eurostat parameter; valid per the Eurostat guide cited above [secondary check only]. `:85`: "when the ladder includes `http_validators`" stays correct.
- `docs/design/macro-monitor-platform-design.md:133`, `:263`: Eurostat `updated` timestamp fact and web-source conditional GET; unaffected.
- Research (`docs/research/tooling-collection-analysis-viz.md:216`, `data-sources-support-series-reserves-targets.md`): approved and not edited. This document is the erratum for "conditional-request support per source is untested": for Eurostat `statistics/1.0/data` it is now tested and absent (F4). Untested for the other sources.
- `CLAUDE.md` rule "Cache and use conditional requests": not edited; read as "where the source supports them" (F4 shows one that does not). No change requested.
- Non-approved or non-design: `docs/ops/spike-results.md` (already records the fix), `config/sources.yaml`, `src/.../sdmx.py` (already correct).

## 3. Rule: change detection when a source gives no validators
Applies to any request whose latest response (or stored state) has neither `ETag` nor `Last-Modified`, and in particular to Eurostat `statistics/1.0/data`.

1. Step 1 (`http_validators`) is skipped for that request: no `If-None-Match` or `If-Modified-Since` is sent. If the config ladder lists `http_validators` for such a source it is harmless; if it does not, nothing changes. This is already the behaviour: `archive.py:247-256` returns no headers when no validator is stored and `sdmx.py:156-160` passes `validators=None`.
2. Step 2 (`update_marker`): when the marker is available only inside the response body (Eurostat), it cannot decide whether to fetch. It is parsed from a copy of the bytes, stored in `request_state.update_marker` and `fetch_attempt`/pointer rows as a diagnostic, and never overrides step 3.
3. Step 3 (`content_hash`) decides: the connector downloads once per request per run; `sha256` of the received bytes is compared with `sha256` of the LATEST `ingest.raw_object` of the request key (revert-safe, ADR-003, `archive.py:270-282`). Equal: outcome `unchanged`, a `fetch_attempt` row only, no new blob, no new `raw_object`. Different: outcome `new`, store the bytes (blob reuse by hash per ADR-003), write `raw_object` and staging rows in one transaction, then advance pointers. No bytes are ever overwritten (ADR-002, ADR-003).
4. The hash is authoritative over the marker. Marker changed and hash equal: `unchanged` (marker advances). Marker equal and hash different: `new` (the marker did not reflect the change); implementation SHOULD log this combination as a warning, because it means the source changed bytes without moving `updated`.
5. Cost bound: one GET per request per run (31.8 KB for the verified slice). With monthly or at most daily runs this is inside polite use; Eurostat publishes no numeric rate limit (`macro-monitor-platform-design.md:133`). Large datasets are bounded by the cell limits of ADR-004 (500,000 cells, async above).
6. Byte stability caveat: the content-hash fallback only works if the same data yields the same bytes. If Eurostat embeds a volatile field in the JSON-stat body (for example a per-request timestamp or id) every run would be `new`. The capture shows `updated` as a dataset-level timestamp; a second capture of the same request on a different day with unchanged data has NOT been compared. [UNVERIFIED]; see AC-ETF-5.

Code facts relevant to this rule (read-only, 2026-11-04): `archive.py:259-267` defines `marker_unchanged` (a skip-the-fetch check) but `grep` finds no caller in `src/`; `archive.py:400` classifies with `decide`, which uses the hash only. So the ADR wording "probed cheaply" was never implemented and, for Eurostat, cannot be (F4: no separate probe exists; none was verified). See D-3.

## 4. Acceptance criteria
- AC-ETF-1 (docs): after the merge step, `grep -rn "c\[TIME_PERIOD\]" docs/design docs/specs docs/plans` returns only this amendment and historical notes that mark it as rejected.
- AC-ETF-2 (config): the shipped `config/sources.yaml` Eurostat request templates carry `sinceTimePeriod` and no `c[` key (already true); a unit test with a `c[TIME_PERIOD]` template expects `ConnectorConfigError` at `plan` (extend the existing test of `sdmx.py:120` if absent).
- AC-ETF-3 (no validators): a unit test with a mocked transport returning 200 and no `ETag`/`Last-Modified` asserts the request carries neither conditional header, on the first and on the second fetch.
- AC-ETF-4 (hash decides): two consecutive fetches with identical bytes yield outcomes `new` then `unchanged` (one `raw_object`, two `fetch_attempt` rows); bytes A, B, A yield `new`, `new`, `new` (revert-safe); identical bytes with a different `updated` give `unchanged`; different bytes with an equal `updated` give `new` and a logged warning.
- AC-ETF-5 (byte stability, network, operator-run, only when the user asks): two live fetches of the same `une_rt_m` request, at least one day apart and no data update in between (`updated` equal), give an identical sha256. If they differ, a normalising step (strip the volatile field before hashing) needs its own ADR and this rule is suspended for Eurostat.
- AC-ETF-6 (fixture): the parser reads the live fixture's time dimension as `time` (already covered by the two unit tests named in `spike-results.md:364`).
- AC-ETF-7 (state): on `unchanged`, `ingest.request_state` fetch-side pointers refresh and load-side pointers do not move (`ingestion-interfaces-spec.md:170-171`, unchanged).

## 5. Decisions the user must make
- D-1: approve this amendment as the record (recommended; no ADR), or have it turned into a new ADR / an in-place revision of ADR-004 (resets ADR-004 to draft).
- D-2: keep `update_marker` in the Eurostat ladder in `config/sources.yaml:36` as a diagnostic (recommended: it feeds the freshness view and the E4-style warning) or drop it so the ladder reads `[content_hash]`.
- D-3: `archive.marker_unchanged` has no caller. Options: (a) keep it for sources with a genuinely separate cheap probe (BIS file date, OECD) and let the spec say so (recommended); (b) remove it until such a connector exists (code change, implementation phase).
- D-4: add the optional validation rule E7 (Eurostat template must use `sinceTimePeriod`, no `c[` keys), or rely on the connector check at `plan`.
- D-5: whether AC-ETF-5 (a second live Eurostat fetch to prove byte stability) may be run, and when. It needs your explicit request for network use.

## 6. Non-blocking note: stale statements in approved ADR-025 and the dashboard plan
Not edited here; these became stale on 2026-11-04 (the slice ran to export and site build, `spike-results.md:365-367`):
- `docs/design/adr/ADR-025-dashboard-ui-ux-design-system.md:11`: "No real export exists yet: the Eurostat throwaway run stopped at the `fetch` step (`c[TIME_PERIOD]=ge:1991` rejected by the live API ...)". Now: a real 21-file, 3.09 MB export of the 3-series Eurostat slice exists on a throwaway database, built from a scratch config that moved G02 to `global` (the repo config still gives G02 domain `agri`; see `g02-domain-move-amendment.md`). The sizes in ADR-025 may now be re-checked against that export (it is small: 3 series).
- `ADR-025:76` (Q11): "should the Eurostat `TIME_PERIOD` fetch fix come first, or should Stage 0 start on the fixture?" The fix is done (F2), so the question is moot; only "start Stage 0 on the real 3-series export or wait for more series" remains.
- `docs/plans/dashboard-ux-implementation-plan.md:36` (gate G0): "the Eurostat `TIME_PERIOD` fetch fix lands and a real export (or a larger recorded export) exists". Satisfied in the narrow sense (a small real export exists); whether it is "larger" enough for token tuning is the user's call. The recorded fallback (start Stage 0 on the fixture, re-run T114 and T133 on the first real export) stays valid.
These can be corrected in the next ADR-025 / plan revision; nothing blocks on them.

## User decisions recorded 2026-11-04 (stated in session: "adopt recommendations")
- D-1: this amendment is approved as the record; no new ADR and no in-place ADR-004 revision.
- D-2: keep `update_marker` in the Eurostat ladder as a diagnostic only. Correction to the D-2 text above: the marker feeds the section 3 rule 4 warning; "freshness view" is unverified and is not part of the decision.
- D-3: keep the unused `marker_unchanged` for sources that have a separate cheap probe.
- D-4: add the optional validation rule E7 (Eurostat templates must use `sinceTimePeriod` and no `c[` keys); implementation is a later data-engineer task.
- D-5: run AC-ETF-5 (a second live Eurostat fetch at least one day after 2026-11-04) when the user explicitly asks for network use then; not run now.
