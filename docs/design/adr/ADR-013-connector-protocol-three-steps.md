---
status: approved   # approved by the user on 2026-10-24 (stated in session)
---
# ADR-013: The connector protocol has three steps (`plan`, `fetch`, `parse`); series metadata is part of the parse output (amends ADR-004)

Date: 2026-10-24 (Phase 2 rework after the planning pass). Based on a read of ADR-004 and `docs/specs/ingestion-interfaces-spec.md` section 2 on 2026-10-24; no external facts.

## Context
ADR-004 (Decision, first bullet) defines a `Connector` protocol with four steps: `plan(state) -> list[RequestSpec]`, `fetch(RequestSpec, state) -> FetchResult`, `parse(raw_object) -> Iterable[ParsedObservation]` and `describe_series(raw_object) -> Iterable[SeriesMeta]`. The ingestion interfaces spec (section 2) defines three: `plan(group, state, mode)`, `fetch(spec, http, state)` and `parse(raw, series_filter) -> ParseOutput`, where `ParseOutput` is "(metas, observations)". There is no `describe_series` in the spec, and the spec's signatures also differ from ADR-004 in the arguments (`group` and `mode` for `plan`; the shared `HttpClient` passed to `fetch`). The spec's loader (step on staging, `staging.series_meta_load` and `staging.observation_load` written in one transaction) and the replay invariant I-CUR-7 only work with the three-step form. The conflict is a plain contradiction between an approved ADR and an approved-then-reset spec, so implementers cannot tell which is intended.

## Options considered
1. Four steps as in ADR-004: `describe_series` separate from `parse`. Bytes are parsed twice (the largest raw objects are tens of MB, for example OECD KEI at about 35 MB per call per the data-sources research F13); the metadata function and the value function can disagree on the same bytes after a parser edit; two functions must each be versioned and registered.
2. Three steps, `parse` returns both series metadata and observations (the spec). One pass, one parser version per object (`raw_object.parser_id`), one registry entry; metadata and values are by construction consistent.
3. Two steps (`plan`+`fetch` merged). Mixes request planning (a pure function of config and state) with network I/O; harder to unit test offline.

## Decision
Option 2. The protocol is exactly:
- `plan(group: GroupConfig, state: StateStore, mode: Mode) -> list[RequestSpec]` (pure; no network).
- `fetch(spec: RequestSpec, http: HttpClient, state: StateStore) -> FetchResult` (bytes untouched; the shared `HttpClient` of ADR-004 is injected, connectors never build their own client).
- `parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput` with `ParseOutput = (metas: Iterable[ParsedSeriesMeta], observations: Iterable[ParsedObservation])`; a pure function of the bytes, the parser version and `series_filter`.
`describe_series` is not a protocol member. Series discovery (`discover: true` groups, source-config schema) is `parse` called with a filter that yields `metas` and no observations. All other ADR-004 decisions (own HTTP layer, change-detection ladder, request sizing, parser registry, dependencies) are unchanged.

## Consequences
- The ingestion spec section 2 is already in this form and needs no change. ADR-004 stays `approved` with its text unchanged; this ADR is `approved` (front matter: approved by the user on 2026-10-24) and amends only the first Decision bullet of ADR-004 (step list and signatures).
- The conformance test is AC-ING-20 in `docs/specs/ingestion-interfaces-spec.md` section 8: the `Connector` protocol has exactly the members `source_id`, `plan`, `fetch`, `parse`, and `parse` output for every non-discovery fixture contains both `metas` and `observations`; a `discover: true` fixture yields `metas` and no observations, as the Decision says.
- Parsers that today are written against ADR-004's `describe_series` do not exist yet (nothing is implemented), so there is no migration cost.
- Reversal: splitting `parse` later into two functions is a non-breaking addition if the registry key stays `parser_id`.
- Bookkeeping notes, 2026-10-25 (no decision text changed). (1) The earlier text of the first bullet said "this ADR is `proposed`", which contradicted the front matter; only that word was corrected. (2) The earlier text of the second bullet read: "A conformance test is proposed for the next revision of the ingestion spec (proposed id AC-ING-20, not yet written into that spec because the spec was not edited in this rework)". That is stale: the round-6 amendment batch wrote AC-ING-20 into the ingestion spec (with the clarification about `discover: true` fixtures), and a later review found the bullet still described it as unwritten. The bullet now states the current fact; the sentence above is kept here as the record. A previous version of this note called the superseded sentence "the third bullet"; it is the second.
