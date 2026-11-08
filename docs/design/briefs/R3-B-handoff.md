# R3-B handoff (review round 3, agent B) - 2026-10-18

Why handed off: the Edit tool is not available in this session (only Read/Write/Grep/Glob). Surgical edits to the large specs would need full-file rewrites, which risks transcription errors and exceeds the context budget. Draft text is below, ready to paste with an Edit tool. Nothing here sets `status: approved`.

## DONE
- ADR-009 (`/Users/oleksandrdzuba/macro-monitor/docs/design/adr/ADR-009-series-mapping-and-authoritative-source.md`): finding 8 done (euro-area composition rule, CHANGING vs FIXED, `ref.series.composition` per ddl spec line 191, succession plus drift event, headline switch by reviewed config only); change-log line added.
- ADR-011 (`.../ADR-011-forecast-and-projection-storage.md`): finding 6 ADR part done (`first_stored_release`, views renamed, vintage-resolution limit, `release_cadence_note`/`vintage_resolution`, archives/source vintages ALFRED and OECD MEI [UNVERIFIED], V4 text requirement, change log).

## REMAINING (all in `/Users/oleksandrdzuba/macro-monitor/docs/`)

### A. specs/analytics-and-r-contract-spec.md
New amendments are numbered P7-P12 in section 9 (append after P6, line ~148). Each: cautious interpretation applied meanwhile.

A1 (finding 1, P7). Append to end of section 2 paragraph (after "A03 ... no alert."):
> WEO estimate/projection boundary and A02 (review round 3; PROPOSED AMENDMENT P7). The WEO parser maps each year <= the country's `Estimates Start After` attribute [UNVERIFIED for the manual file; confirm on the first real file] to `value_status = 'EST'` and later years to `'PROJ'`. For A02 (NGAP_NPGDP) an output gap is never an outturn: "latest observed" is the latest EST year of the latest WEO edition, labelled `estimate` (`value_kind = 'estimate'`) in snapshot and export; PROJ years are excluded from ranks and alerts. If the attribute is missing or unparseable, A02 fails closed (n/a) and a `schema_drift` event is raised (check WEO-01). Until P7 is approved A02 is shown as a labelled estimate and not alerted (cautious reading of D18). Test AC-AN-15.
P7 entry in section 9: "A02 'latest observed' = latest EST year of the latest WEO edition, labelled estimate, no alerts; PROJ excluded. Touches D18/D22 wording."

A2 (finding 2, section 4.4, append after the min-coverage paragraph):
> Heterogeneous peer sets (round 3). Each domain score reports `peer_set_size_by_indicator` = {min, max} of `n_ranked` over its ranked indicators, and sets `heterogeneous_peer_set = true` when max/min > 1.5 (example A02: 25 vs 42 ranked countries). The coverage-weighted domain percentile is NOT adopted. Instead (PROPOSED P8, optional config) `min_coverage_for_rank` also requires that the available indicators include at least one from each declared `core_pillar` when the domain defines pillars (`ref.domain.core_pillars`, default none = rule off). Bias note: missingness is not random; slow reporters (typically emerging economies) are systematically missing, so a domain percentile is computed on a different, more advanced-economy-weighted panel; see the `missing_not_at_random` report in the validation spec (MON-NMAR). The browser peer-group filter in V2 only filters/sorts the full-universe percentile and never recomputes it; the UI labels it "percentile vs all ranked countries".
Standing caveat (finding 9, same section, P9): "Percentiles are relative position in the covered panel, not a judgement of structural quality; advanced and emerging economies share one panel (D6)." Optional `peer_group_percentile` (precomputed in Python for G7, euro area, non-euro EU, advanced, emerging; same definition as 4.3 step 4 over the peer subset; never computed in the browser): PROPOSED P9, export contract optional minor/version-bump item (see dashboard-export-spec).

A3 (finding 3, section 3 after the `SUM12_PCT_GDP` table, P10):
> Denominator age and inflation-regime guard (round 3; PROPOSED P10). Per transform config `max_denominator_age_days`: default for the four-quarter sum, the denominator's last quarter-end must be <= 120 days before the numerator's `ref_period_end`; the annual fallback is allowed only when the entity's trailing-12-month YoY CPI < 10 %, else the value is n/a. `inflation_regime_guard`: entities with YoY CPI > `hi_inflation_threshold` (proposed 25 %) or `ref.entity.fx_regime_flag` set (new optional attribute, proposed values `managed`, `multiple`; default NULL) get n/a for USD-flow over USD-GDP ratios and for LCU ratios that use the annual fallback. COMP-05 (warn) names the reason (`denominator_age`, `high_inflation`, `fx_regime`). Changes the behaviour of approved indicators for those entities, hence P10; cautious reading applied meanwhile (guard ON with the defaults). Test AC-AN-13.

A4 (finding 4, section 4.3 step 2, after "no back-casting"; AC-AN-14):
> Fiscal-year basis (round 3). Series with `calendar_basis <> 'CAL'` (India; WEO fiscal-year items [UNVERIFIED]; Australia/Japan fiscal items) are `unaligned` in rankings: shown, not ranked, reason `fiscal_year_basis`, not counted in `n_available`/`n_ranked`, and never treated as "ahead" of a calendar-year peer (a fiscal year ending March is not later than a calendar year). Calendarisation is out of v1.

A5 (finding 5, section 5; keep D19 |z|>=2.0, watch 1.5 untouched; PROPOSED P11):
- `stationarity_class` per indicator in `indicators.yaml`: `stationary | trending_level | rate_of_change`. For `trending_level` indicators (debt/GDP, unemployment rate level, policy rate, reserve cover) z is computed on DIFF12 (or YoY change), not the level, unless `alert_override` fixed thresholds apply (those still evaluate on the level).
- Effective sample: overlapping YoY windows are autocorrelated, `n_eff` ~ n/12 for monthly YoY (n/4 quarterly YoY). PROPOSED default: minimum-observation rule and `confidence` additionally need n_eff-based thresholds, e.g. monthly min 60 AND >= 5 independent years (non-overlapping). Below this: `reason = below_min_obs`.
- Regime breaks: window start = max(1991-01-01, `regime_start` of the entity, optional config for hyperinflation/transition breaks). Persistent shift: after 3 consecutive alerts on the same series the level is reported as `persistent_shift` and the window is re-based at the first alert of the run (documented, proposed default). 
- Tests: AC-AN-16 (trending_level uses DIFF12; fixed override still applies to level), AC-AN-17 (n_eff rule: 60 monthly obs spanning < 5 years -> below_min_obs), AC-AN-18 (regime_start truncates the window; 3rd consecutive alert gives `persistent_shift` and a re-based window).

A6 (finding 7, section 3 transform list): replace "`REAL_RATE` (policy rate minus core YoY)" with "`REAL_RATE` (policy rate minus core YoY; ex-post real rate on backward-looking core inflation, labelled 'ex-post real policy rate' in meta/indicators.json.notes and UI; an ex-ante variant only when an expectations series exists, not in v1)".

A7 (finding 6, section 10 line ~155): replace "the first release of the target period" with "the first stored release of the target period (`first_stored_release`, fetch-time quantised; true first prints only from archives or source vintages, see ADR-011)".

A8 (acceptance, append after AC-AN-12 in section 6):
- AC-AN-13: SUM12_PCT_GDP fixtures: denominator quarter-end 130 days before numerator end -> n/a (`denominator_age`); annual fallback with trailing YoY CPI 12 % -> n/a; entity CPI YoY 30 % -> n/a (`high_inflation`); `fx_regime_flag = 'managed'` with USD flow over USD GDP -> n/a (`fx_regime`); CPI 5 % with 100-day-old denominator -> computed. COMP-05 text names the reason.
- AC-AN-14: a `calendar_basis = 'FY_MAR'` annual series (India) is shown, not ranked, reason `fiscal_year_basis`, absent from n_ranked and from `reference_period_spread_days`; a calendar-year peer is never flagged `lagging` because of it.
- AC-AN-15: WEO fixture with `Estimates Start After = 2024`: 2024 -> EST, 2025+ -> PROJ; A02 latest observed = 2024 with `value_kind = 'estimate'`; 2025 value absent from rank and alert; fixture without the attribute -> A02 n/a for all entities and a drift event.
- AC-AN-19: domain with A02 (25) and a 42-country indicator -> `heterogeneous_peer_set = true` (42/25 = 1.68); 36/25 = 1.44 -> false; with `core_pillars` declared and no pillar-covered indicators -> `low_coverage = true`.

A9 section 9 (P7-P12): P7 above; P8 core_pillar coverage rule; P9 caveat + `peer_group_percentile`; P10 denominator/inflation guard and `fx_regime_flag`; P11 stationarity_class, n_eff thresholds, regime_start, persistent_shift; P12 (finding 2d/ADR-011) none needed. Also add `fiscal_year_basis` unalignment note to P2 if the user wants.
A10: change log line: "2026-10-18, review round 3: sections 2, 3, 4.3, 4.4, 5, 6, 9, 10 per findings 1-5, 7, 9."

### B. specs/dashboard-export-spec.md (anchors: section 5 scorecard JSON, section 6 series files, section 11 acceptance, change log at end)
- Flags (finding 4): add `fiscal_year_basis` (shown, not ranked) and `estimate` (A02, `value_kind`) and `heterogeneous_peer_set`, `peer_set_size_by_indicator` {min,max}, `persistent_shift`, `alert_reason` values to the scorecard/status JSON field list.
- Finding 2c/9: UI text rule: V2 peer-group filter filters/sorts only; label "percentile vs all ranked countries"; standing caveat "Percentiles are relative position in the covered panel, not a judgement of structural quality." Optional `peer_group_percentile` (object keyed by group id: g7, ea, eu_non_ea, advanced, emerging) in scorecard JSON as an OPTIONAL version-bump item (minor, additive, PROPOSED P9); absent until approved; the browser must never compute it.
- Finding 6: V4 (vintage view) must display "vintage resolution: monthly fetch" (from `vintage_resolution` of the series; other values per ADR-011) and must label the first stored version `first stored release`, never "first release".
- Acceptance: export validation fails if a ranked-percentile field is present without the label key; V4 text test.
- Change log line dated 2026-10-18 review round 3.

### C. specs/validation-monitoring-spec.md (anchors: section 1 check catalogue, section 6 acceptance)
- New check WEO-01 (error -> A02 n/a): WEO file has `Estimates Start After` per country and parses to an integer year; missing = fail closed, drift event. Acceptance: fixture without the attribute.
- COMP-05 reason codes: `denominator_age`, `high_inflation`, `fx_regime`, `currency_mismatch`, `missing_or_stale`.
- New report MON-NMAR `missing_not_at_random` (info/warn, monthly): per domain, share of (indicator, entity) pairs unavailable (missing, stale, lagging) by group advanced vs emerging (`ref.entity` group attribute); warn when the difference exceeds 20 percentage points [proposed threshold]; written to `ops` report and shown in the monitoring page, never changes ranks.
- Change log line.

### D. specs/source-config-schema.md (anchors: section 2 manual WEO example lines 109-144; section 3 indicators.yaml entry lines 145-198; section 6 acceptance)
- Section 2 WEO parser expectation: `parser.expect.estimates_start_after: required`; years <= attribute -> EST, later -> PROJ; absence = drift event `schema_drift` plus A02 n/a; [UNVERIFIED] for the manual file, confirm on first real file.
- Section 3 indicators.yaml new optional keys: `stationarity_class` (default `stationary`), `core_pillars`/domain-level in domains file, `inputs[].max_denominator_age_days` (default 120), `hi_inflation_threshold` (global default 0.25), `calendar_basis`, `regime_start` (entity-level, optional, in the entities file), `fx_regime_flag` (entity-level optional: managed|multiple), `vintage_resolution`/`release_cadence_note` per source/series group. Config rules: `stationarity_class: trending_level` requires `transform` in {DIFF12, YOY_PCT_POINT_CHANGE} for alerting or an `alert_override`.
- Section 6: acceptance tests for the new keys' validation (unknown enum rejected; threshold bounds 0-1).
- Change log line.

### E. Not done / notes
- Main design doc section 14 should list P7-P11 (owned by the other agent).
- Main design doc and other docs that still say "first release" for FD5 use should be aligned to `first_stored_release` (other agent).
